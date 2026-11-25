import type { NextFunction, Request, RequestHandler, Response } from 'express';

// O Express 4 não entende handler `async`: se a Promise rejeita, o erro não chega no middleware de
// erro — vira unhandled rejection e o Node encerra o processo inteiro (derrubando junto o
// Socket.IO do GPS). Aconteceu de verdade em 2026-09-10, quando o app consultou uma rota enquanto
// o banco ainda não tinha as colunas novas.
//
// Envolver o handler com isto encaminha a rejeição para o `next()`, que cai no middleware de erro
// registrado em server.ts e vira uma resposta 500 — o servidor continua de pé.
// (Quando o projeto subir para o Express 5, isso passa a ser nativo e este wrapper pode sair.)
export function rotaAsync(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
