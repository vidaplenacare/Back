import { createHash, randomBytes } from 'crypto';

// Token opaco (não é JWT) — só o hash fica no banco (`SessaoDispositivo.tokenHash`), mesmo padrão
// de `refresh_token_hash` já desenhado em BACKEND-ARQUITETURA.md §3.1.
export function gerarToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
