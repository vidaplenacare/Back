import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { hashToken } from './token';

declare global {
  namespace Express {
    interface Request {
      usuarioId?: string;
    }
  }
}

async function usuarioDoToken(token: string): Promise<string | null> {
  if (!token) return null;
  const sessao = await prisma.sessaoDispositivo.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!sessao || sessao.revogadoEm) return null;
  return sessao.usuarioId;
}

async function resolverUsuarioId(req: Request): Promise<string | null> {
  const cabecalho = req.headers.authorization;
  if (!cabecalho?.startsWith('Bearer ')) return null;
  return usuarioDoToken(cabecalho.slice('Bearer '.length).trim());
}

// Só para EXIBIR imagens (GET /fotos/...): aceita o token também em `?token=`. O <Image> do React
// Native no Android não mandou o cabeçalho Authorization (2026-09-30), e baixar à parte com
// fetch/blob gerava aviso de desempenho. ⚠️ Não usar em nenhuma outra rota: token em URL pode
// parar em log. Quando entrar o Cloudflare R2, isto vira URL assinada de curta duração do próprio R2.
export async function autenticarImagem(req: Request, res: Response, next: NextFunction): Promise<void> {
  const doQuery = typeof req.query.token === 'string' ? req.query.token : '';
  const usuarioId = (await resolverUsuarioId(req)) ?? (await usuarioDoToken(doQuery));
  if (!usuarioId) {
    res.status(401).json({ erro: 'Não autenticado' });
    return;
  }
  req.usuarioId = usuarioId;
  next();
}

// Exige login — usado nas rotas de conta (/auth/me, /auth/logout).
export async function autenticar(req: Request, res: Response, next: NextFunction): Promise<void> {
  const usuarioId = await resolverUsuarioId(req);
  if (!usuarioId) {
    res.status(401).json({ erro: 'Não autenticado' });
    return;
  }
  req.usuarioId = usuarioId;
  next();
}

// Não bloqueia sem token — usado em /cuidadores-cadastro, que continua funcionando sem conta
// (comportamento de 2026-08-14), mas liga o resultado à conta quando há uma sessão válida.
export async function autenticacaoOpcional(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.usuarioId = (await resolverUsuarioId(req)) ?? undefined;
  next();
}
