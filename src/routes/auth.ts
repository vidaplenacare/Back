import { Router } from 'express';
import type { CategoriaCuidador } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { autenticar } from '../auth/middleware';
import { hashSenha, verificarSenha } from '../auth/senha';
import { gerarToken, hashToken } from '../auth/token';
import { rotaAsync } from '../lib/rotaAsync';

export const authRouter = Router();

const CATEGORIAS: CategoriaCuidador[] = ['cuidador', 'tecnico', 'enfermeiro'];

// Versão dos termos aceita no cadastro, no formato da data do documento ("2026-10-16"). Sem ela a
// conta não é criada: o aceite precisa ficar registrado (ver `Usuario.termosVersao`).
function versaoTermosValida(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

function usuarioPublico<T extends { senhaHash: string }>(usuario: T): Omit<T, 'senhaHash'> {
  const { senhaHash, ...resto } = usuario;
  return resto;
}

// O app precisa saber se a conta de cuidador já tem perfil público (sem ele ninguém consegue
// contratá-la) — antes isso era uma flag local do app que começava "incompleto" em todo aparelho.
const INCLUDE_SESSAO = { cuidador: true, perfilProfissional: { select: { id: true } } } as const;

function respostaSessao(usuario: {
  senhaHash: string;
  cuidador: object | null;
  perfilProfissional: { id: string } | null;
}) {
  const { perfilProfissional, cuidador, ...resto } = usuario;
  return {
    usuario: usuarioPublico(resto),
    cuidador: cuidador ? { ...cuidador, perfilPublicoId: perfilProfissional?.id ?? null } : null,
  };
}

async function criarSessao(usuarioId: string): Promise<string> {
  const token = gerarToken();
  await prisma.sessaoDispositivo.create({ data: { usuarioId, tokenHash: hashToken(token) } });
  return token;
}

function extrairToken(req: { headers: { authorization?: string } }): string {
  return (req.headers.authorization ?? '').slice('Bearer '.length).trim();
}

// Conta de Membro — login real (ver DEV-NOTES.md 2026-08-15). `cpf` opcional de propósito: não
// travar a criação da conta atrás de um campo que não passa por nenhuma validação hoje mesmo.
authRouter.post('/cadastro-membro', rotaAsync(async (req, res) => {
  const { nome, email, senha, telefone, cpf, versaoTermos } = req.body ?? {};
  if (
    typeof nome !== 'string' || !nome.trim() ||
    typeof email !== 'string' || !email.trim() ||
    typeof senha !== 'string' || senha.length < 6 ||
    typeof telefone !== 'string' || !telefone.trim()
  ) {
    res.status(400).json({ erro: 'Campos obrigatórios: nome, email, senha (mín. 6 caracteres), telefone' });
    return;
  }
  if (!versaoTermosValida(versaoTermos)) {
    res.status(400).json({ erro: 'É preciso aceitar os termos para criar a conta. Atualize o aplicativo e tente de novo.' });
    return;
  }

  const emailExistente = await prisma.usuario.findUnique({ where: { email } });
  if (emailExistente) {
    res.status(409).json({ erro: 'Já existe uma conta com esse e-mail' });
    return;
  }

  const usuario = await prisma.usuario.create({
    data: {
      tipo: 'membro',
      nome,
      email,
      senhaHash: await hashSenha(senha),
      telefone,
      cpf: typeof cpf === 'string' && cpf.trim() ? cpf.trim() : null,
      termosVersao: versaoTermos,
      termosAceitosEm: new Date(),
    },
  });
  const token = await criarSessao(usuario.id);
  res.status(201).json({ usuario: usuarioPublico(usuario), token });
}));

// Conta de Cuidador — leve de propósito: só nome/email/senha/telefone/categoria. CPF, COREN,
// documentos, quiz e chave Pix ficam pra verificação profissional opcional depois (ver
// `/cuidadores-cadastro`) — não travam a criação da conta nem o login.
authRouter.post('/cadastro-cuidador', rotaAsync(async (req, res) => {
  const { nome, email, senha, telefone, categoria, cpf, versaoTermos } = req.body ?? {};
  if (
    typeof nome !== 'string' || !nome.trim() ||
    typeof email !== 'string' || !email.trim() ||
    typeof senha !== 'string' || senha.length < 6 ||
    typeof telefone !== 'string' || !telefone.trim() ||
    typeof categoria !== 'string' || !(CATEGORIAS as string[]).includes(categoria)
  ) {
    res.status(400).json({ erro: 'Campos obrigatórios: nome, email, senha (mín. 6 caracteres), telefone, categoria' });
    return;
  }
  if (!versaoTermosValida(versaoTermos)) {
    res.status(400).json({ erro: 'É preciso aceitar os termos para criar a conta. Atualize o aplicativo e tente de novo.' });
    return;
  }

  const emailExistente = await prisma.usuario.findUnique({ where: { email } });
  if (emailExistente) {
    res.status(409).json({ erro: 'Já existe uma conta com esse e-mail' });
    return;
  }

  const usuario = await prisma.usuario.create({
    data: {
      tipo: 'cuidador',
      nome,
      email,
      senhaHash: await hashSenha(senha),
      telefone,
      cpf: typeof cpf === 'string' && cpf.trim() ? cpf.trim() : null,
      termosVersao: versaoTermos,
      termosAceitosEm: new Date(),
      cuidador: { create: { categoria: categoria as CategoriaCuidador } },
    },
    include: INCLUDE_SESSAO,
  });
  const token = await criarSessao(usuario.id);
  res.status(201).json({ ...respostaSessao(usuario), token });
}));

authRouter.post('/login', rotaAsync(async (req, res) => {
  const { email, senha } = req.body ?? {};
  if (typeof email !== 'string' || typeof senha !== 'string') {
    res.status(400).json({ erro: 'Campos obrigatórios: email, senha' });
    return;
  }

  const usuario = await prisma.usuario.findUnique({ where: { email }, include: INCLUDE_SESSAO });
  if (!usuario || !(await verificarSenha(senha, usuario.senhaHash))) {
    res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    return;
  }

  await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } });
  const token = await criarSessao(usuario.id);
  res.json({ ...respostaSessao(usuario), token });
}));

authRouter.post('/logout', autenticar, rotaAsync(async (req, res) => {
  await prisma.sessaoDispositivo.updateMany({
    where: { tokenHash: hashToken(extrairToken(req)), revogadoEm: null },
    data: { revogadoEm: new Date() },
  });
  res.status(204).send();
}));

// Usado pelo app pra restaurar a sessão salva no aparelho quando abre — ver AuthContext.tsx.
authRouter.get('/me', autenticar, rotaAsync(async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuarioId! }, include: INCLUDE_SESSAO });
  if (!usuario) {
    res.status(404).json({ erro: 'Usuário não encontrado' });
    return;
  }
  res.json(respostaSessao(usuario));
}));
