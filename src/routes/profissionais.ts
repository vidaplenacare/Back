import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { rotaAsync } from '../lib/rotaAsync';

export const profissionaisRouter = Router();

profissionaisRouter.get('/', rotaAsync(async (_req, res) => {
  const profissionais = await prisma.profissional.findMany({ orderBy: { nome: 'asc' } });
  res.json(profissionais);
}));

profissionaisRouter.get('/:id', rotaAsync(async (req, res) => {
  const profissional = await prisma.profissional.findUnique({ where: { id: req.params.id } });
  if (!profissional) {
    res.status(404).json({ erro: 'Profissional não encontrado' });
    return;
  }
  res.json(profissional);
}));

// Agenda ocupada do profissional — o que a tela de contratação usa para riscar os horários que já
// estão reservados. Devolve SÓ as faixas de tempo, sem nome de quem reservou nem observações:
// qualquer pessoa pode consultar a agenda de um profissional, então nada de dado de outro membro
// pode vazar por aqui.
//
// `pendente` fica de fora de propósito (mesma regra da constraint no banco): enquanto o cuidador
// não aceita, o horário ainda está em disputa e não deve aparecer como ocupado para os outros.
profissionaisRouter.get('/:id/agenda', rotaAsync(async (req, res) => {
  const { de, ate } = req.query;

  const inicioJanela = typeof de === 'string' ? new Date(de) : new Date();
  if (Number.isNaN(inicioJanela.getTime())) {
    res.status(400).json({ erro: "Parâmetro 'de' precisa ser uma data ISO" });
    return;
  }
  // Sem `ate`, olha 30 dias à frente — cobre com folga a tira de 21 dias que a tela mostra.
  const fimJanela =
    typeof ate === 'string'
      ? new Date(ate)
      : new Date(inicioJanela.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(fimJanela.getTime())) {
    res.status(400).json({ erro: "Parâmetro 'ate' precisa ser uma data ISO" });
    return;
  }

  const profissional = await prisma.profissional.findUnique({ where: { id: req.params.id } });
  if (!profissional) {
    res.status(404).json({ erro: 'Profissional não encontrado' });
    return;
  }

  const reservas = await prisma.solicitacao.findMany({
    where: {
      cuidadorId: req.params.id,
      status: { in: ['aceita', 'em_andamento', 'concluida'] },
      inicioEm: { lt: fimJanela },
      fimEm: { gt: inicioJanela },
    },
    select: { inicioEm: true, fimEm: true },
    orderBy: { inicioEm: 'asc' },
  });

  res.json({
    cuidadorId: profissional.id,
    de: inicioJanela.toISOString(),
    ate: fimJanela.toISOString(),
    expediente: {
      diasDisponiveis: profissional.diasDisponiveis,
      horarioInicio: profissional.horarioInicio,
      horarioFim: profissional.horarioFim,
    },
    ocupado: reservas,
  });
}));
