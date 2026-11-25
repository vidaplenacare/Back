import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { rotaAsync } from '../lib/rotaAsync';

export const pushTokensRouter = Router();

pushTokensRouter.post('/', rotaAsync(async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== 'string' || token.trim().length === 0) {
    res.status(400).json({ erro: 'Campo "token" é obrigatório' });
    return;
  }

  const registro = await prisma.pushToken.upsert({
    where: { token },
    create: { token },
    update: {},
  });
  res.status(201).json(registro);
}));
