import { randomUUID } from 'crypto';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { autenticar } from '../auth/middleware';
import { rotaAsync } from '../lib/rotaAsync';
import { INCLUDE_SOLICITACAO } from '../lib/solicitacaoInclude';
import {
  asaasConfigurada,
  criarOuObterCliente,
  criarOuObterCobranca,
  ErroAsaas,
  estornarCobranca,
  obterQrCodePix,
  removerCobranca,
} from '../lib/asaas';
import { validarChecksumCpf } from '../validacao/providers';
import { encerrarPagamento } from '../lib/encerrarPagamento';
import { registrarAvaliacao } from '../lib/avaliacoes';
import { sincronizarPagamento, sincronizarPagamentosDoMembro } from '../lib/sincronizarPagamento';

export const solicitacoesRouter = Router();

// Status que realmente seguram o horário na agenda — mesma lista da constraint
// `solicitacoes_sem_sobreposicao` (ver migration 20260910193000_agenda_pagamentos).
const STATUS_QUE_OCUPAM = ['aceita', 'em_andamento', 'concluida'] as const;

// A constraint EXCLUDE do Postgres não tem código mapeado no Prisma (P2002 é só unique), então
// chega como erro cru. Identificar pelo SQLSTATE 23P01 (exclusion_violation) ou pelo nome da
// constraint é o jeito de transformar isso num 409 em vez de num 500.
function ehConflitoDeHorario(erro: unknown): boolean {
  const texto = erro instanceof Error ? `${erro.message}` : String(erro);
  return texto.includes('23P01') || texto.includes('solicitacoes_sem_sobreposicao');
}

function paraData(valor: unknown): Date | null {
  if (typeof valor !== 'string') return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function minutosDoDia(data: Date): number {
  return data.getHours() * 60 + data.getMinutes();
}

function horarioEmMinutos(horario: string): number {
  const [hora, minuto] = horario.split(':').map(Number);
  return hora * 60 + (minuto || 0);
}

// Reserva um horário na agenda do profissional. A cobrança nasce junto, com status `pendente`:
// é o pagamento que libera a visita (modelo de garantia, ver DEV-NOTES.md 2026-09-10).
solicitacoesRouter.post('/', autenticar, rotaAsync(async (req, res) => {
  const { cuidadorId, inicioEm, fimEm, observacoes } = req.body ?? {};

  const inicio = paraData(inicioEm);
  const fim = paraData(fimEm);
  if (typeof cuidadorId !== 'string' || !cuidadorId || !inicio || !fim) {
    res.status(400).json({ erro: 'Campos obrigatórios: cuidadorId, inicioEm, fimEm (datas ISO)' });
    return;
  }
  if (fim <= inicio) {
    res.status(400).json({ erro: 'O término precisa ser depois do início' });
    return;
  }
  if (inicio.getTime() <= Date.now()) {
    res.status(400).json({ erro: 'Não dá para reservar um horário no passado' });
    return;
  }
  if (inicio.toDateString() !== fim.toDateString()) {
    res.status(400).json({ erro: 'A faixa precisa começar e terminar no mesmo dia' });
    return;
  }

  const profissional = await prisma.profissional.findUnique({ where: { id: cuidadorId } });
  if (!profissional) {
    res.status(404).json({ erro: 'Profissional não encontrado' });
    return;
  }

  // Mesmas regras que a tela já aplica, revalidadas aqui: o cliente pode mandar qualquer coisa.
  if (!profissional.diasDisponiveis.includes(inicio.getDay())) {
    res.status(422).json({ erro: 'O profissional não atende neste dia da semana' });
    return;
  }
  if (
    minutosDoDia(inicio) < horarioEmMinutos(profissional.horarioInicio) ||
    minutosDoDia(fim) > horarioEmMinutos(profissional.horarioFim)
  ) {
    res.status(422).json({
      erro: `A faixa precisa estar dentro do expediente (${profissional.horarioInicio} às ${profissional.horarioFim})`,
    });
    return;
  }

  const horas = (fim.getTime() - inicio.getTime()) / (1000 * 60 * 60);
  // Preço congelado agora: se o profissional mudar o valor depois, o combinado com este membro
  // continua valendo.
  const valorHora = profissional.valorVisita;
  const valorTotal = valorHora * horas;

  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuarioId! } });
  if (!usuario) {
    res.status(404).json({ erro: 'Usuário não encontrado' });
    return;
  }

  try {
    const solicitacao = await prisma.solicitacao.create({
      data: {
        id: `sol-${randomUUID()}`,
        cuidadorId,
        usuarioId: usuario.id,
        membroNome: usuario.nome,
        status: 'pendente',
        observacoes: typeof observacoes === 'string' && observacoes.trim() ? observacoes.trim() : null,
        inicioEm: inicio,
        fimEm: fim,
        valorHora,
        valorTotal,
        pagamento: { create: { valor: valorTotal } },
      },
      include: INCLUDE_SOLICITACAO,
    });
    res.status(201).json(solicitacao);
  } catch (erro) {
    if (ehConflitoDeHorario(erro)) {
      res.status(409).json({ erro: 'Esse horário acabou de ser reservado por outra pessoa' });
      return;
    }
    throw erro;
  }
}));

// Solicitações do membro logado — alimenta Home, Perfil e a tela de Pagamentos.
solicitacoesRouter.get('/', autenticar, rotaAsync(async (req, res) => {
  // Rede de segurança do webhook: confere na Asaas os pagamentos ainda `pendente` (se o aviso se
  // perdeu, o app atualiza mesmo assim ao recarregar a tela). Nunca derruba a listagem.
  await sincronizarPagamentosDoMembro(req.usuarioId!);
  const solicitacoes = await prisma.solicitacao.findMany({
    where: { usuarioId: req.usuarioId! },
    include: INCLUDE_SOLICITACAO,
    orderBy: { inicioEm: 'desc' },
  });
  res.json(solicitacoes);
}));

// Inicia o pagamento da visita na Asaas. NÃO marca como pago: cria (ou reaproveita) a cobrança e
// devolve o QR code Pix (pago dentro do app) ou o link da página da Asaas (cartão — o número do
// cartão nunca passa por aqui). O status só vira `pago` quando o webhook da Asaas confirma
// (ver routes/webhooks.ts). Chamar de novo é seguro: devolve a mesma cobrança.
solicitacoesRouter.post('/:id/pagamento', autenticar, rotaAsync(async (req, res) => {
  const { forma, cpf } = req.body ?? {};
  if (forma !== 'pix' && forma !== 'cartao') {
    res.status(400).json({ erro: "Campo obrigatório: forma ('pix' ou 'cartao')" });
    return;
  }
  if (!asaasConfigurada()) {
    res.status(503).json({ erro: 'Pagamentos indisponíveis no momento (Asaas não configurada no servidor)' });
    return;
  }

  const solicitacao = await prisma.solicitacao.findUnique({
    where: { id: req.params.id },
    include: INCLUDE_SOLICITACAO,
  });
  if (!solicitacao) {
    res.status(404).json({ erro: 'Solicitação não encontrada' });
    return;
  }
  if (solicitacao.usuarioId !== req.usuarioId) {
    res.status(403).json({ erro: 'Esta solicitação não é sua' });
    return;
  }
  if (solicitacao.status !== 'aceita') {
    res.status(409).json({ erro: 'Só dá para pagar depois que o cuidador aceitar a solicitação' });
    return;
  }
  if (!solicitacao.pagamento || solicitacao.pagamento.status !== 'pendente') {
    res.status(409).json({ erro: 'Esta solicitação não está aguardando pagamento' });
    return;
  }

  // A Asaas exige CPF do pagador. No cadastro do membro o CPF é opcional, então ele pode chegar
  // aqui sem — o app manda junto nessa hora (código CPF_OBRIGATORIO avisa o app pra pedir).
  let usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: req.usuarioId! } });
  if (!usuario.cpf) {
    const cpfDigitos = typeof cpf === 'string' ? cpf.replace(/\D/g, '') : '';
    if (!cpfDigitos) {
      res.status(422).json({ erro: 'Informe seu CPF para pagar', codigo: 'CPF_OBRIGATORIO' });
      return;
    }
    if (!validarChecksumCpf(cpfDigitos)) {
      res.status(422).json({ erro: 'CPF inválido', codigo: 'CPF_OBRIGATORIO' });
      return;
    }
    const emUso = await prisma.usuario.findUnique({ where: { cpf: cpfDigitos } });
    if (emUso && emUso.id !== usuario.id) {
      res.status(409).json({ erro: 'Este CPF já está cadastrado em outra conta', codigo: 'CPF_OBRIGATORIO' });
      return;
    }
    usuario = await prisma.usuario.update({ where: { id: usuario.id }, data: { cpf: cpfDigitos } });
  }

  const pagamentoId = solicitacao.pagamento.id;
  const dadosCliente = {
    usuarioId: usuario.id,
    nome: usuario.nome,
    cpf: usuario.cpf!,
    email: usuario.email,
    telefone: usuario.telefone,
  };

  // Trava por pagamento: dois toques rápidos em "Pagar" não podem criar duas cobranças.
  const pagamento = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pagamentoId}))`;
      const atual = await tx.pagamento.findUniqueOrThrow({ where: { id: pagamentoId } });
      if (atual.asaasCobrancaId && atual.asaasUrlPagamento) {
        return tx.pagamento.update({ where: { id: pagamentoId }, data: { forma } });
      }

      let clienteAsaasId = usuario.asaasClienteId;
      if (!clienteAsaasId) {
        clienteAsaasId = await criarOuObterCliente(dadosCliente);
        await tx.usuario.update({ where: { id: usuario.id }, data: { asaasClienteId: clienteAsaasId } });
      }

      const cobranca = await criarOuObterCobranca({
        pagamentoId,
        clienteAsaasId,
        valor: atual.valor,
        descricao: `Vida Plena — visita com ${solicitacao.cuidador.nome}`,
      });
      return tx.pagamento.update({
        where: { id: pagamentoId },
        data: { forma, asaasCobrancaId: cobranca.id, asaasUrlPagamento: cobranca.invoiceUrl },
      });
    },
    { timeout: 45000, maxWait: 10000 },
  );

  // Cobrança que já existia pode ter sido paga sem o webhook ter chegado: confere antes de oferecer
  // pagar de novo (antes a Asaas respondia "Esta cobrança não pode mais ser paga" e virava 500).
  if (await sincronizarPagamento(pagamento).catch(() => false)) {
    res.status(409).json({ erro: 'Este pagamento já foi confirmado. Volte à tela anterior para ver.', codigo: 'JA_PAGO' });
    return;
  }

  let pix: { copiaECola: string; qrCodeBase64: string; expiraEm: string } | null = null;
  if (forma === 'pix') {
    const qr = await obterQrCodePix(pagamento.asaasCobrancaId!).catch(async (erro) => {
      // Última checagem: se a Asaas recusou o QR porque já foi paga, sincroniza e avisa o app.
      if (erro instanceof ErroAsaas && erro.status < 500 && (await sincronizarPagamento(pagamento).catch(() => false))) {
        return null;
      }
      throw erro;
    });
    if (!qr) {
      res.status(409).json({ erro: 'Este pagamento já foi confirmado. Volte à tela anterior para ver.', codigo: 'JA_PAGO' });
      return;
    }
    pix = { copiaECola: qr.payload, qrCodeBase64: qr.encodedImage, expiraEm: qr.expirationDate };
  }

  res.json({ pagamento, pix, urlPagamento: pagamento.asaasUrlPagamento });
}));

// Cancelar libera o horário na agenda (o status sai da lista que ocupa). Se já tinha sido pago,
// pede o estorno na Asaas e o pagamento vai para `estornado`; se a cobrança ainda estava em aberto,
// ela é removida na Asaas pra não poder mais ser paga.
solicitacoesRouter.post('/:id/cancelar', autenticar, rotaAsync(async (req, res) => {
  const solicitacao = await prisma.solicitacao.findUnique({
    where: { id: req.params.id },
    include: INCLUDE_SOLICITACAO,
  });
  if (!solicitacao) {
    res.status(404).json({ erro: 'Solicitação não encontrada' });
    return;
  }
  if (solicitacao.usuarioId !== req.usuarioId) {
    res.status(403).json({ erro: 'Esta solicitação não é sua' });
    return;
  }
  if (!STATUS_QUE_OCUPAM.includes(solicitacao.status as (typeof STATUS_QUE_OCUPAM)[number]) &&
      solicitacao.status !== 'pendente') {
    res.status(409).json({ erro: 'Esta solicitação já foi encerrada' });
    return;
  }
  if (solicitacao.status === 'em_andamento' || solicitacao.status === 'concluida') {
    res.status(409).json({ erro: 'O atendimento já começou — não dá para cancelar por aqui' });
    return;
  }

  // Regra única de encerramento do pagamento (estorno/remoção na Asaas primeiro — ver
  // lib/encerrarPagamento.ts). Pagamento nunca pago vira `cancelado` (antes ficava `pendente`).
  const statusPagamento = await encerrarPagamento(solicitacao.pagamento);

  const atualizada = await prisma.solicitacao.update({
    where: { id: solicitacao.id },
    data: {
      status: 'cancelada',
      ...(statusPagamento ? { pagamento: { update: { status: statusPagamento } } } : {}),
    },
    include: INCLUDE_SOLICITACAO,
  });
  res.json(atualizada);
}));

// O membro avalia o cuidador depois do atendimento concluído (2026-09-30). A avaliação aparece
// para os dois lados e entra na nota do cuidador no catálogo (lib/avaliacoes.ts).
solicitacoesRouter.post('/:id/avaliacao', autenticar, rotaAsync(async (req, res) => {
  const solicitacao = await prisma.solicitacao.findUnique({
    where: { id: req.params.id },
    include: INCLUDE_SOLICITACAO,
  });
  if (!solicitacao) {
    res.status(404).json({ erro: 'Solicitação não encontrada' });
    return;
  }
  if (solicitacao.usuarioId !== req.usuarioId) {
    res.status(403).json({ erro: 'Esta solicitação não é sua' });
    return;
  }
  const resultado = await registrarAvaliacao(solicitacao, 'membro', req.body);
  if (!resultado.ok) {
    res.status(resultado.status).json({ erro: resultado.erro });
    return;
  }
  res.status(201).json(resultado.solicitacao);
}));

// ⚠️ Rota SEM login (usada pela Home para o horário real): não devolve dados do membro nem as
// avaliações — só a contratação em si (2026-09-30, quando esses dados entraram no INCLUDE).
solicitacoesRouter.get('/:id', rotaAsync(async (req, res) => {
  const solicitacao = await prisma.solicitacao.findUnique({
    where: { id: req.params.id },
    include: INCLUDE_SOLICITACAO,
  });
  if (!solicitacao) {
    res.status(404).json({ erro: 'Solicitação não encontrada' });
    return;
  }
  const { usuario: _usuario, avaliacoes: _avaliacoes, selfieInicio: _selfie, ...publico } = solicitacao;
  res.json(publico);
}));
