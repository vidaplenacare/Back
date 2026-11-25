import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { autenticar } from '../auth/middleware';
import { rotaAsync } from '../lib/rotaAsync';

export const membroRouter = Router();

// Perfil e dados de saúde de quem recebe cuidado. Tudo aqui é do membro logado sobre ele mesmo —
// a visão que o CUIDADOR tem desses mesmos dados fica em `/cuidador/solicitacoes/:id/ficha`, com
// regra de acesso própria.

const INCLUDE_COMPLETO = {
  condicoesMedicas: { orderBy: { nome: 'asc' } },
  medicamentos: { orderBy: { nome: 'asc' } },
  contatosEmergencia: { orderBy: { principal: 'desc' } },
} as const;

// Cria o perfil na primeira vez que for pedido: a conta pode ter sido criada antes destas tabelas
// existirem, e não faz sentido obrigar o membro a "ativar" o próprio perfil.
async function perfilDoMembro(usuarioId: string) {
  const existente = await prisma.membro.findUnique({
    where: { usuarioId },
    include: INCLUDE_COMPLETO,
  });
  if (existente) return existente;

  return prisma.membro.create({
    data: { usuarioId },
    include: INCLUDE_COMPLETO,
  });
}

function ehListaDeTexto(valor: unknown): valor is string[] {
  return Array.isArray(valor) && valor.every((item) => typeof item === 'string');
}

membroRouter.get('/perfil', autenticar, rotaAsync(async (req, res) => {
  res.json(await perfilDoMembro(req.usuarioId!));
}));

membroRouter.put('/perfil', autenticar, rotaAsync(async (req, res) => {
  // `fotoUrl` não é mais aceito aqui (2026-09-30): a foto só muda pela câmera, em POST /fotos/perfil.
  const { idade, endereco, alergias } = req.body ?? {};

  if (idade !== undefined && idade !== null && (typeof idade !== 'number' || idade < 0 || idade > 130)) {
    res.status(400).json({ erro: 'idade precisa ser um número entre 0 e 130' });
    return;
  }
  if (alergias !== undefined && !ehListaDeTexto(alergias)) {
    res.status(400).json({ erro: 'alergias precisa ser uma lista de textos' });
    return;
  }

  const perfil = await perfilDoMembro(req.usuarioId!);
  const atualizado = await prisma.membro.update({
    where: { id: perfil.id },
    data: {
      ...(idade !== undefined ? { idade } : {}),
      ...(typeof endereco === 'string' ? { endereco } : {}),
      ...(alergias !== undefined ? { alergias } : {}),
    },
    include: INCLUDE_COMPLETO,
  });
  res.json(atualizado);
}));

// --- Condições médicas ---

membroRouter.post('/condicoes', autenticar, rotaAsync(async (req, res) => {
  const { nome } = req.body ?? {};
  if (typeof nome !== 'string' || !nome.trim()) {
    res.status(400).json({ erro: 'Campo obrigatório: nome' });
    return;
  }
  const perfil = await perfilDoMembro(req.usuarioId!);
  const condicao = await prisma.condicaoMedica.create({
    data: { membroId: perfil.id, nome: nome.trim() },
  });
  res.status(201).json(condicao);
}));

membroRouter.delete('/condicoes/:id', autenticar, rotaAsync(async (req, res) => {
  const perfil = await perfilDoMembro(req.usuarioId!);
  // `deleteMany` com o membroId no filtro em vez de `delete` pelo id: assim um id de outra pessoa
  // simplesmente não apaga nada, em vez de apagar dado alheio.
  const { count } = await prisma.condicaoMedica.deleteMany({
    where: { id: req.params.id, membroId: perfil.id },
  });
  if (count === 0) {
    res.status(404).json({ erro: 'Condição não encontrada' });
    return;
  }
  res.status(204).send();
}));

// --- Medicamentos ---

membroRouter.post('/medicamentos', autenticar, rotaAsync(async (req, res) => {
  const { nome, dosagem, horarios, ativo } = req.body ?? {};
  if (
    typeof nome !== 'string' || !nome.trim() ||
    typeof dosagem !== 'string' || !dosagem.trim() ||
    !ehListaDeTexto(horarios)
  ) {
    res.status(400).json({ erro: 'Campos obrigatórios: nome, dosagem, horarios (lista de "HH:MM")' });
    return;
  }
  const perfil = await perfilDoMembro(req.usuarioId!);
  const medicamento = await prisma.medicamento.create({
    data: {
      membroId: perfil.id,
      nome: nome.trim(),
      dosagem: dosagem.trim(),
      horarios,
      ativo: typeof ativo === 'boolean' ? ativo : true,
    },
  });
  res.status(201).json(medicamento);
}));

membroRouter.patch('/medicamentos/:id', autenticar, rotaAsync(async (req, res) => {
  const { nome, dosagem, horarios, ativo } = req.body ?? {};
  if (horarios !== undefined && !ehListaDeTexto(horarios)) {
    res.status(400).json({ erro: 'horarios precisa ser uma lista de textos' });
    return;
  }

  const perfil = await perfilDoMembro(req.usuarioId!);
  const { count } = await prisma.medicamento.updateMany({
    where: { id: req.params.id, membroId: perfil.id },
    data: {
      ...(typeof nome === 'string' && nome.trim() ? { nome: nome.trim() } : {}),
      ...(typeof dosagem === 'string' && dosagem.trim() ? { dosagem: dosagem.trim() } : {}),
      ...(horarios !== undefined ? { horarios } : {}),
      ...(typeof ativo === 'boolean' ? { ativo } : {}),
    },
  });
  if (count === 0) {
    res.status(404).json({ erro: 'Medicamento não encontrado' });
    return;
  }
  res.json(await prisma.medicamento.findUnique({ where: { id: req.params.id } }));
}));

membroRouter.delete('/medicamentos/:id', autenticar, rotaAsync(async (req, res) => {
  const perfil = await perfilDoMembro(req.usuarioId!);
  const { count } = await prisma.medicamento.deleteMany({
    where: { id: req.params.id, membroId: perfil.id },
  });
  if (count === 0) {
    res.status(404).json({ erro: 'Medicamento não encontrado' });
    return;
  }
  res.status(204).send();
}));

// --- Contatos de emergência ---

membroRouter.post('/contatos', autenticar, rotaAsync(async (req, res) => {
  const { nome, relacao, telefone, principal } = req.body ?? {};
  if (
    typeof nome !== 'string' || !nome.trim() ||
    typeof relacao !== 'string' || !relacao.trim() ||
    typeof telefone !== 'string' || !telefone.trim()
  ) {
    res.status(400).json({ erro: 'Campos obrigatórios: nome, relacao, telefone' });
    return;
  }
  const perfil = await perfilDoMembro(req.usuarioId!);

  // O primeiro contato vira principal automaticamente: o SOS da Home liga para o principal, e um
  // membro com contato cadastrado mas nenhum marcado ficaria sem ninguém para acionar.
  const jaTemContato = perfil.contatosEmergencia.length > 0;
  const marcarPrincipal = principal === true || !jaTemContato;

  const criar = prisma.contatoEmergencia.create({
    data: {
      membroId: perfil.id,
      nome: nome.trim(),
      relacao: relacao.trim(),
      telefone: telefone.trim(),
      principal: marcarPrincipal,
    },
  });

  // Só um principal por membro: se este novo é o principal, os outros são desmarcados na mesma
  // transação — senão dá para acabar com dois e o SOS não saber para quem ligar.
  const contato = marcarPrincipal
    ? (
        await prisma.$transaction([
          prisma.contatoEmergencia.updateMany({
            where: { membroId: perfil.id },
            data: { principal: false },
          }),
          criar,
        ])
      )[1]
    : await criar;

  res.status(201).json(contato);
}));

// Editar nome/relação/telefone de um contato (2026-09-30: o app já tinha a tela de editar, mas a
// rota não existia — a edição ficava só no celular). "Principal" continua na rota própria abaixo.
membroRouter.patch('/contatos/:id', autenticar, rotaAsync(async (req, res) => {
  const { nome, relacao, telefone } = req.body ?? {};
  const perfil = await perfilDoMembro(req.usuarioId!);
  const { count } = await prisma.contatoEmergencia.updateMany({
    where: { id: req.params.id, membroId: perfil.id },
    data: {
      ...(typeof nome === 'string' && nome.trim() ? { nome: nome.trim() } : {}),
      ...(typeof relacao === 'string' && relacao.trim() ? { relacao: relacao.trim() } : {}),
      ...(typeof telefone === 'string' && telefone.trim() ? { telefone: telefone.trim() } : {}),
    },
  });
  if (count === 0) {
    res.status(404).json({ erro: 'Contato não encontrado' });
    return;
  }
  res.json(await prisma.contatoEmergencia.findUnique({ where: { id: req.params.id } }));
}));

membroRouter.post('/contatos/:id/principal', autenticar, rotaAsync(async (req, res) => {
  const perfil = await perfilDoMembro(req.usuarioId!);
  const alvo = await prisma.contatoEmergencia.findFirst({
    where: { id: req.params.id, membroId: perfil.id },
  });
  if (!alvo) {
    res.status(404).json({ erro: 'Contato não encontrado' });
    return;
  }

  await prisma.$transaction([
    prisma.contatoEmergencia.updateMany({
      where: { membroId: perfil.id },
      data: { principal: false },
    }),
    prisma.contatoEmergencia.update({ where: { id: alvo.id }, data: { principal: true } }),
  ]);
  res.json(await prisma.contatoEmergencia.findMany({
    where: { membroId: perfil.id },
    orderBy: { principal: 'desc' },
  }));
}));

membroRouter.delete('/contatos/:id', autenticar, rotaAsync(async (req, res) => {
  const perfil = await perfilDoMembro(req.usuarioId!);
  const { count } = await prisma.contatoEmergencia.deleteMany({
    where: { id: req.params.id, membroId: perfil.id },
  });
  if (count === 0) {
    res.status(404).json({ erro: 'Contato não encontrado' });
    return;
  }
  res.status(204).send();
}));
