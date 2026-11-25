import { randomUUID } from 'crypto';
import { Router, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { autenticar } from '../auth/middleware';
import { rotaAsync } from '../lib/rotaAsync';
import { INCLUDE_SOLICITACAO, type SolicitacaoComRelacoes } from '../lib/solicitacaoInclude';
import { asaasConfigurada, ErroAsaas, tipoDaChavePix, transferirPix } from '../lib/asaas';
import { validarChecksumCpf } from '../validacao/providers';
import { hashSenha, verificarSenha } from '../auth/senha';
import { decodificarJpeg, ErroImagem, salvarImagem } from '../lib/armazenamento';
import { compararRosto } from '../lib/verificacaoFacial';
import { encerrarPagamento } from '../lib/encerrarPagamento';
import { registrarAvaliacao } from '../lib/avaliacoes';
import { Prisma } from '@prisma/client';

export const cuidadorRouter = Router();

// Tudo aqui é a visão do cuidador logado sobre o próprio trabalho. A autorização se apoia na
// ligação `profissionais.usuarioId` (migration 20260910201500): o perfil público do catálogo
// pertence a uma conta, e é isso que responde "esta solicitação é deste cuidador?".

const CATEGORIAS_VALIDAS = ['cuidador', 'enfermeiro', 'fisioterapeuta', 'acompanhante'] as const;
type CategoriaValida = (typeof CATEGORIAS_VALIDAS)[number];

function ehHorario(valor: unknown): valor is string {
  return typeof valor === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(valor);
}

// Cria ou atualiza o perfil público do cuidador logado — é o que faz a conta dele aparecer no
// catálogo que os membros contratam. Sem isso a conta existe mas ninguém consegue contratá-la.
cuidadorRouter.put('/perfil', autenticar, rotaAsync(async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.usuarioId! },
    include: { cuidador: true, perfilProfissional: true },
  });
  if (!usuario) {
    res.status(404).json({ erro: 'Usuário não encontrado' });
    return;
  }
  if (usuario.tipo !== 'cuidador') {
    res.status(403).json({ erro: 'Só contas de cuidador têm perfil público' });
    return;
  }

  const {
    especialidade, categoria, experiencia, bio, formacao,
    areasAtuacao, disponibilidade, diasDisponiveis,
    horarioInicio, horarioFim, valorHora, telefone,
  } = req.body ?? {};

  if (
    typeof especialidade !== 'string' || !especialidade.trim() ||
    typeof categoria !== 'string' || !(CATEGORIAS_VALIDAS as readonly string[]).includes(categoria) ||
    !ehHorario(horarioInicio) || !ehHorario(horarioFim) ||
    typeof valorHora !== 'number' || !Number.isFinite(valorHora) || valorHora <= 0 ||
    !Array.isArray(diasDisponiveis) ||
    diasDisponiveis.some((dia: unknown) => typeof dia !== 'number' || dia < 0 || dia > 6)
  ) {
    res.status(400).json({
      erro: 'Campos obrigatórios: especialidade, categoria, horarioInicio/horarioFim (HH:MM), valorHora (> 0), diasDisponiveis (0 a 6)',
    });
    return;
  }
  if (horarioFim <= horarioInicio) {
    res.status(400).json({ erro: 'O fim do expediente precisa ser depois do início' });
    return;
  }

  const dados = {
    nome: usuario.nome,
    especialidade: especialidade.trim(),
    categoria: categoria as CategoriaValida,
    experiencia: typeof experiencia === 'string' ? experiencia : '',
    bio: typeof bio === 'string' ? bio : '',
    formacao: typeof formacao === 'string' ? formacao : '',
    areasAtuacao: Array.isArray(areasAtuacao)
      ? areasAtuacao.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    disponibilidade: typeof disponibilidade === 'string' ? disponibilidade : '',
    diasDisponiveis: diasDisponiveis as number[],
    horarioInicio,
    horarioFim,
    // ⚠️ A coluna ainda se chama `valorVisita` no banco, mas desde 2026-09-10 guarda o valor por
    // HORA (renomear exige migração, está como pendência). A API já fala `valorHora`.
    valorVisita: valorHora,
    // A foto não vem mais do app: só a câmera, por POST /fotos/perfil (2026-09-30). Aqui só
    // aproveita a foto que a conta já tirou, para o perfil novo já nascer com ela.
    foto: usuario.fotoPerfil ?? usuario.perfilProfissional?.foto ?? '',
    telefone: typeof telefone === 'string' ? telefone : usuario.telefone,
  };

  const perfil = await prisma.profissional.upsert({
    where: { usuarioId: usuario.id },
    create: {
      id: usuario.perfilProfissional?.id ?? `prof-${randomUUID()}`,
      usuarioId: usuario.id,
      avaliacao: 0,
      totalAvaliacoes: 0,
      nivelOcupacao: 'livre',
      ...dados,
    },
    update: dados,
  });
  res.json(perfil);
}));

// Carrega o perfil público do cuidador logado e garante que ele existe. Toda ação abaixo depende
// disso: sem perfil no catálogo, não há solicitação possível para essa conta.
async function perfilDoCuidadorLogado(usuarioId: string) {
  return prisma.profissional.findUnique({ where: { usuarioId } });
}

// Solicitações recebidas pelo cuidador logado (a agenda de trabalho dele).
cuidadorRouter.get('/solicitacoes', autenticar, rotaAsync(async (req, res) => {
  const perfil = await perfilDoCuidadorLogado(req.usuarioId!);
  if (!perfil) {
    res.status(404).json({ erro: 'Você ainda não tem um perfil público — complete seu perfil primeiro' });
    return;
  }

  const solicitacoes = await prisma.solicitacao.findMany({
    where: { cuidadorId: perfil.id },
    include: INCLUDE_SOLICITACAO,
    orderBy: { inicioEm: 'asc' },
  });
  res.json(solicitacoes);
}));

// Transições do lado do cuidador. Cada uma confere que a solicitação pertence ao perfil dele —
// é exatamente o que não era possível antes da ligação com a conta.
type ErroDeAcesso = 'sem_perfil' | 'nao_encontrada' | 'nao_e_sua';
type AcessoSolicitacao =
  | { ok: false; erro: ErroDeAcesso }
  | { ok: true; solicitacao: SolicitacaoComRelacoes };

async function carregarSolicitacaoDoCuidador(
  usuarioId: string,
  solicitacaoId: string
): Promise<AcessoSolicitacao> {
  const perfil = await perfilDoCuidadorLogado(usuarioId);
  if (!perfil) return { ok: false, erro: 'sem_perfil' };

  const solicitacao = await prisma.solicitacao.findUnique({
    where: { id: solicitacaoId },
    include: INCLUDE_SOLICITACAO,
  });
  if (!solicitacao) return { ok: false, erro: 'nao_encontrada' };
  if (solicitacao.cuidadorId !== perfil.id) return { ok: false, erro: 'nao_e_sua' };

  return { ok: true, solicitacao };
}

function responderErroDeAcesso(res: Response, erro: ErroDeAcesso): void {
  if (erro === 'sem_perfil') {
    res.status(404).json({ erro: 'Você ainda não tem um perfil público — complete seu perfil primeiro' });
    return;
  }
  if (erro === 'nao_encontrada') {
    res.status(404).json({ erro: 'Solicitação não encontrada' });
    return;
  }
  res.status(403).json({ erro: 'Esta solicitação não é sua' });
}

// Aceitar/recusar: só faz sentido enquanto está pendente. Aceitar é o que abre a cobrança para o
// membro (o pagamento já nasceu junto com a solicitação, em `pendente`).
for (const [acao, statusFinal] of [
  ['aceitar', 'aceita'],
  ['recusar', 'recusada'],
] as const) {
  cuidadorRouter.post(`/solicitacoes/:id/${acao}`, autenticar, rotaAsync(async (req, res) => {
    const resultado = await carregarSolicitacaoDoCuidador(req.usuarioId!, req.params.id);
    if (!resultado.ok) {
      responderErroDeAcesso(res, resultado.erro);
      return;
    }
    if (resultado.solicitacao.status !== 'pendente') {
      res.status(409).json({ erro: 'Esta solicitação já foi respondida' });
      return;
    }

    try {
      // Recusar encerra o pagamento que nasceu junto com o pedido (vira `cancelado`) — antes ele
      // ficava `pendente` e o membro via "pagamento pendente" de um pedido recusado (2026-09-30).
      const statusPagamento = statusFinal === 'recusada' ? await encerrarPagamento(resultado.solicitacao.pagamento) : null;
      const atualizada = await prisma.solicitacao.update({
        where: { id: resultado.solicitacao.id },
        data: {
          status: statusFinal,
          ...(statusPagamento ? { pagamento: { update: { status: statusPagamento } } } : {}),
        },
        include: INCLUDE_SOLICITACAO,
      });
      res.json(atualizada);
    } catch (erro) {
      // Aceitar é o momento em que o horário passa a ocupar a agenda — se outra reserva já tinha
      // sido aceita no mesmo intervalo, a constraint do banco barra aqui.
      const texto = erro instanceof Error ? erro.message : String(erro);
      if (texto.includes('23P01') || texto.includes('solicitacoes_sem_sobreposicao')) {
        res.status(409).json({ erro: 'Você já tem outro atendimento aceito nesse horário' });
        return;
      }
      throw erro;
    }
  }));
}

// Desmarcar um atendimento já aceito (o membro tem a rota equivalente em /solicitacoes). Libera o
// horário na agenda e estorna o que o membro tiver pago — a devolução em si depende da Asaas.
// Não vale para atendimento já iniciado: aí o combinado já está em andamento.
cuidadorRouter.post('/solicitacoes/:id/cancelar', autenticar, rotaAsync(async (req, res) => {
  const resultado = await carregarSolicitacaoDoCuidador(req.usuarioId!, req.params.id);
  if (!resultado.ok) {
    responderErroDeAcesso(res, resultado.erro);
    return;
  }
  const { solicitacao } = resultado;

  if (solicitacao.status !== 'aceita') {
    res.status(409).json({
      erro:
        solicitacao.status === 'pendente'
          ? 'Use recusar para um pedido que você ainda não aceitou'
          : 'Só dá para cancelar um atendimento aceito que ainda não começou',
    });
    return;
  }

  // ⚠️ Antes marcava `estornado` SEM pedir o estorno na Asaas — o membro não receberia o dinheiro de
  // volta. Agora usa a mesma regra do cancelamento feito pelo membro (lib/encerrarPagamento.ts).
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

// Check-in: só depois de o membro pagar (é o pagamento que libera a visita — modelo de garantia).
cuidadorRouter.post('/solicitacoes/:id/iniciar', autenticar, rotaAsync(async (req, res) => {
  const resultado = await carregarSolicitacaoDoCuidador(req.usuarioId!, req.params.id);
  if (!resultado.ok) {
    responderErroDeAcesso(res, resultado.erro);
    return;
  }
  const { solicitacao } = resultado;

  if (solicitacao.status !== 'aceita') {
    res.status(409).json({ erro: 'Só dá para iniciar um atendimento aceito' });
    return;
  }
  if (solicitacao.pagamento?.status !== 'pago') {
    res.status(409).json({ erro: 'O atendimento só começa depois que o pagamento do membro cair' });
    return;
  }

  // Verificação do rosto (fluxo definido pelo usuário em 2026-09-30): ao deslizar "iniciar", o
  // profissional tira uma selfie na hora; ela é comparada com a foto da verificação profissional e
  // só então o atendimento começa. A comparação ainda é provisória (lib/verificacaoFacial.ts).
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuarioId! }, select: { fotoPerfil: true } });
  if (!usuario?.fotoPerfil) {
    res.status(409).json({
      erro: 'Faça a verificação profissional (com a foto do seu rosto) antes de iniciar atendimentos',
      codigo: 'SEM_FOTO_VERIFICACAO',
    });
    return;
  }
  let selfie: Buffer;
  try {
    selfie = decodificarJpeg(req.body?.selfieBase64);
  } catch (erro) {
    if (erro instanceof ErroImagem) {
      res.status(400).json({ erro: 'Tire uma foto do seu rosto para iniciar o atendimento', codigo: 'SELFIE_OBRIGATORIA' });
      return;
    }
    throw erro;
  }
  const verificacao = await compararRosto(selfie, usuario.fotoPerfil);
  if (!verificacao.confere) {
    res.status(403).json({
      erro: verificacao.motivo ?? 'O rosto da foto não confere com o da sua verificação. Tente de novo, de frente e com boa luz.',
      codigo: 'ROSTO_NAO_CONFERE',
    });
    return;
  }
  const chaveSelfie = await salvarImagem('selfie', selfie);

  const atualizada = await prisma.solicitacao.update({
    where: { id: solicitacao.id },
    data: { status: 'em_andamento', selfieInicio: chaveSelfie, selfieInicioEm: new Date() },
    include: INCLUDE_SOLICITACAO,
  });
  res.json(atualizada);
}));

// Check-out: conclui e LIBERA o dinheiro retido — é aqui que o valor vira saldo do cuidador.
cuidadorRouter.post('/solicitacoes/:id/concluir', autenticar, rotaAsync(async (req, res) => {
  const resultado = await carregarSolicitacaoDoCuidador(req.usuarioId!, req.params.id);
  if (!resultado.ok) {
    responderErroDeAcesso(res, resultado.erro);
    return;
  }
  const { solicitacao } = resultado;

  if (solicitacao.status !== 'em_andamento') {
    res.status(409).json({ erro: 'Só dá para concluir um atendimento em andamento' });
    return;
  }

  const pagamento = solicitacao.pagamento;
  const atualizada = await prisma.solicitacao.update({
    where: { id: solicitacao.id },
    data: {
      status: 'concluida',
      ...(pagamento?.status === 'pago'
        ? {
            pagamento: {
              update: {
                status: 'liberado',
                liberadoEm: new Date(),
                valorRepasse: valorDoRepasse(pagamento.valor),
              },
            },
          }
        : {}),
    },
    include: INCLUDE_SOLICITACAO,
  });
  res.json(atualizada);
}));

// O cuidador avalia a família depois do atendimento concluído (2026-09-30). Aparece para os dois
// lados (lib/avaliacoes.ts). Antes, "Avaliar família" só guardava no celular do cuidador.
cuidadorRouter.post('/solicitacoes/:id/avaliacao', autenticar, rotaAsync(async (req, res) => {
  const resultado = await carregarSolicitacaoDoCuidador(req.usuarioId!, req.params.id);
  if (!resultado.ok) {
    responderErroDeAcesso(res, resultado.erro);
    return;
  }
  const avaliacao = await registrarAvaliacao(resultado.solicitacao, 'cuidador', req.body);
  if (!avaliacao.ok) {
    res.status(avaliacao.status).json({ erro: avaliacao.erro });
    return;
  }
  res.status(201).json(avaliacao.solicitacao);
}));

// Comissão da plataforma ainda não foi decidida (2026-09-28): fica em variável de ambiente, padrão 0.
// O percentual é gravado por pagamento na liberação, então mudar a variável não altera o que já foi
// liberado.
function valorDoRepasse(valor: number): number {
  const percentual = Number(process.env.PLATAFORMA_COMISSAO_PERCENTUAL ?? 0);
  const comissao = Number.isFinite(percentual) && percentual > 0 ? percentual : 0;
  return Math.round(valor * (1 - comissao / 100) * 100) / 100;
}

// A ficha do membro que o cuidador vai atender — é a informação do MEMBRO aparecendo dentro da
// área do CUIDADOR (as duas áreas são visões dos mesmos dados).
//
// ⚠️ Aqui sai dado de saúde de pessoa idosa, então o acesso é estreito de propósito:
//   1. só o cuidador dono da solicitação (mesma checagem das outras rotas);
//   2. nada de ficha em solicitação `recusada`/`cancelada` — o vínculo acabou;
//   3. enquanto está `pendente`, vai só o necessário para ele decidir se aceita (idade, condições,
//      alergias, observações). Endereço, telefone, contatos de emergência e a lista de
//      medicamentos só depois de aceita, quando a visita de fato existe.
cuidadorRouter.get('/solicitacoes/:id/ficha', autenticar, rotaAsync(async (req, res) => {
  const resultado = await carregarSolicitacaoDoCuidador(req.usuarioId!, req.params.id);
  if (!resultado.ok) {
    responderErroDeAcesso(res, resultado.erro);
    return;
  }
  const { solicitacao } = resultado;

  if (solicitacao.status === 'recusada' || solicitacao.status === 'cancelada') {
    res.status(403).json({ erro: 'Esta solicitação não está mais ativa' });
    return;
  }
  if (!solicitacao.usuarioId) {
    res.status(404).json({ erro: 'Esta solicitação não tem um membro cadastrado' });
    return;
  }

  const membro = await prisma.membro.findUnique({
    where: { usuarioId: solicitacao.usuarioId },
    include: {
      usuario: { select: { nome: true, telefone: true } },
      condicoesMedicas: { orderBy: { nome: 'asc' } },
      medicamentos: { where: { ativo: true }, orderBy: { nome: 'asc' } },
      contatosEmergencia: { orderBy: { principal: 'desc' } },
    },
  });
  if (!membro) {
    res.status(404).json({ erro: 'Membro sem perfil preenchido' });
    return;
  }

  const aceita = solicitacao.status !== 'pendente';
  res.json({
    solicitacaoId: solicitacao.id,
    nome: membro.usuario.nome,
    idade: membro.idade,
    fotoUrl: membro.fotoUrl,
    condicoesMedicas: membro.condicoesMedicas.map((condicao) => condicao.nome),
    alergias: membro.alergias,
    observacoes: solicitacao.observacoes,
    // Só depois de aceitar:
    telefone: aceita ? membro.usuario.telefone : null,
    endereco: aceita ? membro.endereco : null,
    medicamentos: aceita
      ? membro.medicamentos.map(({ nome, dosagem, horarios }) => ({ nome, dosagem, horarios }))
      : [],
    contatosEmergencia: aceita
      ? membro.contatosEmergencia.map(({ nome, relacao, telefone, principal }) => ({
          nome,
          relacao,
          telefone,
          principal,
        }))
      : [],
  });
}));

// Saldo = tudo que já foi liberado menos o que já foi sacado. Calculado na hora, sem coluna de
// saldo: guardar um número acumulado é o tipo de dado que sai de sincronia sem ninguém perceber.
async function calcularSaldo(
  perfilId: string,
  cuidadorContaId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<number> {
  const [liberados, sacado] = await Promise.all([
    db.pagamento.findMany({
      where: { status: 'liberado', solicitacao: { cuidadorId: perfilId } },
      select: { valor: true, valorRepasse: true },
    }),
    db.resgate.aggregate({
      _sum: { valor: true },
      where: { cuidadorId: cuidadorContaId, status: { in: ['processando', 'concluido'] } },
    }),
  ]);
  // `valorRepasse` nulo = liberado antes da comissão existir → vale o valor inteiro.
  const liberado = liberados.reduce((soma, p) => soma + (p.valorRepasse ?? p.valor), 0);
  return Math.round((liberado - (sacado._sum.valor ?? 0)) * 100) / 100;
}

cuidadorRouter.get('/saldo', autenticar, rotaAsync(async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.usuarioId! },
    include: { cuidador: true, perfilProfissional: true },
  });
  if (!usuario?.cuidador || !usuario.perfilProfissional) {
    res.status(404).json({ erro: 'Conta de cuidador sem perfil público' });
    return;
  }

  const [saldo, resgates] = await Promise.all([
    calcularSaldo(usuario.perfilProfissional.id, usuario.cuidador.id),
    prisma.resgate.findMany({
      where: { cuidadorId: usuario.cuidador.id },
      orderBy: { criadoEm: 'desc' },
    }),
  ]);
  res.json({
    saldoDisponivel: saldo,
    chavePix: usuario.cuidador.chavePix,
    temSenhaResgate: Boolean(usuario.cuidador.senhaResgateHash),
    resgates,
  });
}));

// ---- Senha de resgate (2026-09-30) -------------------------------------------------------------
// 6 dígitos, exigida em todo resgate. Guardada só como hash bcrypt (mesmo de senha de login): não
// dá pra "ver" depois — esqueceu = criar uma nova (fluxo por e-mail pendente até termos provedor
// de e-mail). 5 erros seguidos bloqueiam por 15 min, contra tentativa e erro.

const FORMATO_SENHA_RESGATE = /^\d{6}$/;
const MAX_TENTATIVAS_SENHA_RESGATE = 5;
const BLOQUEIO_SENHA_RESGATE_MS = 15 * 60 * 1000;

type ResultadoSenhaResgate =
  | { ok: true }
  | { ok: false; status: number; corpo: { erro: string; codigo: string; tentativasRestantes?: number } };

function horaBrasilia(data: Date): string {
  return data.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

async function conferirSenhaResgate(
  cuidador: {
    id: string;
    senhaResgateHash: string | null;
    senhaResgateTentativas: number;
    senhaResgateBloqueadaAte: Date | null;
  },
  senha: unknown
): Promise<ResultadoSenhaResgate> {
  if (!cuidador.senhaResgateHash) {
    return {
      ok: false,
      status: 409,
      corpo: { erro: 'Crie sua senha de resgate antes de continuar', codigo: 'SENHA_RESGATE_NAO_DEFINIDA' },
    };
  }
  if (cuidador.senhaResgateBloqueadaAte && cuidador.senhaResgateBloqueadaAte > new Date()) {
    return {
      ok: false,
      status: 429,
      corpo: {
        erro: `Muitas tentativas com a senha errada. Tente de novo às ${horaBrasilia(cuidador.senhaResgateBloqueadaAte)}.`,
        codigo: 'SENHA_RESGATE_BLOQUEADA',
      },
    };
  }

  const correta = typeof senha === 'string' && (await verificarSenha(senha, cuidador.senhaResgateHash));
  if (!correta) {
    const tentativas = cuidador.senhaResgateTentativas + 1;
    if (tentativas >= MAX_TENTATIVAS_SENHA_RESGATE) {
      const ate = new Date(Date.now() + BLOQUEIO_SENHA_RESGATE_MS);
      await prisma.cuidador.update({
        where: { id: cuidador.id },
        data: { senhaResgateTentativas: 0, senhaResgateBloqueadaAte: ate },
      });
      return {
        ok: false,
        status: 429,
        corpo: {
          erro: `Senha errada ${MAX_TENTATIVAS_SENHA_RESGATE} vezes seguidas. Por segurança, o resgate ficou bloqueado até ${horaBrasilia(ate)}.`,
          codigo: 'SENHA_RESGATE_BLOQUEADA',
        },
      };
    }
    await prisma.cuidador.update({ where: { id: cuidador.id }, data: { senhaResgateTentativas: tentativas } });
    const restantes = MAX_TENTATIVAS_SENHA_RESGATE - tentativas;
    return {
      ok: false,
      status: 403,
      corpo: {
        erro: `Senha de resgate incorreta. ${restantes === 1 ? 'Resta 1 tentativa' : `Restam ${restantes} tentativas`} antes do bloqueio.`,
        codigo: 'SENHA_RESGATE_INCORRETA',
        tentativasRestantes: restantes,
      },
    };
  }

  if (cuidador.senhaResgateTentativas > 0 || cuidador.senhaResgateBloqueadaAte) {
    await prisma.cuidador.update({
      where: { id: cuidador.id },
      data: { senhaResgateTentativas: 0, senhaResgateBloqueadaAte: null },
    });
  }
  return { ok: true };
}

// Cria (primeira vez) ou troca a senha de resgate. Trocar exige a senha atual.
cuidadorRouter.post('/senha-resgate', autenticar, rotaAsync(async (req, res) => {
  const { novaSenha, senhaAtual } = req.body ?? {};
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuarioId! }, include: { cuidador: true } });
  if (!usuario?.cuidador) {
    res.status(404).json({ erro: 'Conta de cuidador não encontrada' });
    return;
  }
  if (typeof novaSenha !== 'string' || !FORMATO_SENHA_RESGATE.test(novaSenha)) {
    res.status(400).json({ erro: 'A senha de resgate precisa ter exatamente 6 números', codigo: 'SENHA_RESGATE_FORMATO' });
    return;
  }
  if (/^(\d)\1{5}$/.test(novaSenha) || '0123456789'.includes(novaSenha) || '9876543210'.includes(novaSenha)) {
    res.status(400).json({
      erro: 'Escolha uma senha mais difícil: nada de números repetidos (111111) ou em sequência (123456)',
      codigo: 'SENHA_RESGATE_FRACA',
    });
    return;
  }
  if (usuario.cuidador.senhaResgateHash) {
    const conferida = await conferirSenhaResgate(usuario.cuidador, senhaAtual);
    if (!conferida.ok) {
      res.status(conferida.status).json(conferida.corpo);
      return;
    }
  }

  await prisma.cuidador.update({
    where: { id: usuario.cuidador.id },
    data: { senhaResgateHash: await hashSenha(novaSenha), senhaResgateTentativas: 0, senhaResgateBloqueadaAte: null },
  });
  res.json({ temSenhaResgate: true });
}));

// Saque para a chave Pix: transferência Pix real, da conta da plataforma na Asaas. O resgate nasce
// `processando` (já desconta do saldo) e o webhook da Asaas marca `concluido` ou `falhou` — falha
// devolve o valor ao saldo (ver routes/webhooks.ts).
cuidadorRouter.post('/resgates', autenticar, rotaAsync(async (req, res) => {
  if (!asaasConfigurada()) {
    res.status(503).json({ erro: 'Resgates indisponíveis no momento (Asaas não configurada no servidor)' });
    return;
  }
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.usuarioId! },
    include: { cuidador: true, perfilProfissional: true },
  });
  if (!usuario?.cuidador || !usuario.perfilProfissional) {
    res.status(404).json({ erro: 'Conta de cuidador sem perfil público' });
    return;
  }
  if (!usuario.cuidador.chavePix) {
    res.status(409).json({
      erro: 'Cadastre uma chave Pix na verificação profissional antes de resgatar',
    });
    return;
  }

  const conferida = await conferirSenhaResgate(usuario.cuidador, req.body?.senhaResgate);
  if (!conferida.ok) {
    res.status(conferida.status).json(conferida.corpo);
    return;
  }

  const perfilId = usuario.perfilProfissional.id;
  const cuidadorContaId = usuario.cuidador.id;
  const chavePix = usuario.cuidador.chavePix;

  // Trava por cuidador: dois toques em "Resgatar" não podem sacar o mesmo saldo duas vezes.
  const resgate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`resgate:${cuidadorContaId}`}))`;
    const saldo = await calcularSaldo(perfilId, cuidadorContaId, tx);
    if (saldo <= 0) return null;
    return tx.resgate.create({
      data: { cuidadorId: cuidadorContaId, valor: saldo, chavePix, status: 'processando' },
    });
  });
  if (!resgate) {
    res.status(409).json({ erro: 'Não há saldo disponível para resgate' });
    return;
  }

  try {
    const transferencia = await transferirPix({
      resgateId: resgate.id,
      valor: resgate.valor,
      chavePix,
      tipoChave: tipoDaChavePix(chavePix, validarChecksumCpf),
    });
    const atualizado = await prisma.resgate.update({
      where: { id: resgate.id },
      data: {
        asaasTransferenciaId: transferencia.id,
        ...(transferencia.status === 'DONE' ? { status: 'concluido', concluidoEm: new Date() } : {}),
      },
    });
    res.status(201).json(atualizado);
  } catch (erro) {
    // Transferência recusada na hora (chave inválida, saldo insuficiente na conta da plataforma
    // etc.): marca `falhou`, o que devolve o valor ao saldo do cuidador.
    const motivo = erro instanceof ErroAsaas ? erro.message : 'Falha ao contatar a Asaas';
    await prisma.resgate.update({
      where: { id: resgate.id },
      data: { status: 'falhou', motivoFalha: motivo },
    });
    res.status(502).json({ erro: `Não foi possível fazer o resgate: ${motivo}` });
  }
}));
