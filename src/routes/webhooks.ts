import { timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { rotaAsync } from '../lib/rotaAsync';

export const webhooksRouter = Router();

function tokenValido(recebido: unknown): boolean {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado || typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface EventoAsaas {
  id?: string;
  event: string;
  payment?: { id: string; externalReference?: string | null; billingType?: string };
  transfer?: { id: string; externalReference?: string | null; failReason?: string | null };
}

// Webhook da Asaas (configurado no painel com o token de ASAAS_WEBHOOK_TOKEN, enviado no header
// `asaas-access-token`). Regras:
// - Idempotente: o id do evento é gravado em `webhook_asaas_eventos` na MESMA transação que aplica o
//   efeito; um reenvio cai na chave primária duplicada e é ignorado.
// - Só avança estado (pendente→pago, pago→estornado, processando→concluido/falhou) — evento fora de
//   ordem ou repetido nunca faz um pagamento/resgate voltar.
// - Responde 200 mesmo pra evento desconhecido ou de cobrança que não é nossa (o sandbox foi
//   reaproveitado de outro projeto): um erro faria a Asaas pausar a fila inteira de webhooks.
webhooksRouter.post('/asaas', rotaAsync(async (req, res) => {
  if (!tokenValido(req.header('asaas-access-token'))) {
    res.status(401).json({ erro: 'Token do webhook inválido' });
    return;
  }

  const corpo = req.body as EventoAsaas;
  const eventoId = corpo.id ?? `${corpo.event}:${corpo.payment?.id ?? corpo.transfer?.id ?? 'sem-id'}`;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookAsaasEvento.create({ data: { id: eventoId, evento: corpo.event } });

      if (corpo.payment) {
        const pagamento = await tx.pagamento.findFirst({
          where: {
            OR: [
              { asaasCobrancaId: corpo.payment.id },
              ...(corpo.payment.externalReference ? [{ id: corpo.payment.externalReference }] : []),
            ],
          },
        });
        if (!pagamento) return;

        if (
          (corpo.event === 'PAYMENT_CONFIRMED' || corpo.event === 'PAYMENT_RECEIVED') &&
          pagamento.status === 'pendente'
        ) {
          await tx.pagamento.update({
            where: { id: pagamento.id },
            data: {
              status: 'pago',
              pagoEm: new Date(),
              asaasCobrancaId: corpo.payment.id,
              ...(corpo.payment.billingType === 'PIX' ? { forma: 'pix' as const } : {}),
              ...(corpo.payment.billingType === 'CREDIT_CARD' ? { forma: 'cartao' as const } : {}),
            },
          });
        } else if (corpo.event === 'PAYMENT_REFUNDED' && pagamento.status === 'pago') {
          await tx.pagamento.update({ where: { id: pagamento.id }, data: { status: 'estornado' } });
        } else if (corpo.event === 'PAYMENT_REFUNDED' && pagamento.status === 'liberado') {
          // Estorno depois do dinheiro já ter virado saldo do cuidador: não dá pra resolver
          // automaticamente sem decidir de quem sai o valor — fica registrado pra conferência manual.
          console.warn(`[webhook asaas] estorno de pagamento já liberado ao cuidador: ${pagamento.id}`);
        } else if (
          (corpo.event === 'PAYMENT_CONFIRMED' || corpo.event === 'PAYMENT_RECEIVED') &&
          pagamento.status === 'cancelado'
        ) {
          // Pago no instante em que a solicitação foi encerrada (a remoção da cobrança chegou tarde).
          // O dinheiro entrou numa contratação que não existe mais: precisa ser devolvido —
          // fica registrado pra conferência manual (2026-09-30).
          console.warn(`[webhook asaas] pagamento recebido de solicitação já encerrada — devolver: ${pagamento.id}`);
        } else if (corpo.event === 'PAYMENT_DELETED' && pagamento.status === 'pendente') {
          // Cobrança removida na Asaas: limpa o vínculo pra uma nova poder ser criada.
          await tx.pagamento.update({
            where: { id: pagamento.id },
            data: { asaasCobrancaId: null, asaasUrlPagamento: null },
          });
        }
      }

      if (corpo.transfer) {
        const resgate = await tx.resgate.findFirst({
          where: {
            OR: [
              { asaasTransferenciaId: corpo.transfer.id },
              ...(corpo.transfer.externalReference ? [{ id: corpo.transfer.externalReference }] : []),
            ],
          },
        });
        if (!resgate || resgate.status !== 'processando') return;

        if (corpo.event === 'TRANSFER_DONE') {
          await tx.resgate.update({
            where: { id: resgate.id },
            data: { status: 'concluido', concluidoEm: new Date() },
          });
        } else if (corpo.event === 'TRANSFER_FAILED' || corpo.event === 'TRANSFER_CANCELLED') {
          // `falhou` sai da soma do saldo "sacado" — o valor volta a ficar disponível pro cuidador.
          await tx.resgate.update({
            where: { id: resgate.id },
            data: { status: 'falhou', motivoFalha: corpo.transfer.failReason ?? corpo.event },
          });
        }
      }
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      res.json({ ok: true, repetido: true });
      return;
    }
    throw erro;
  }

  res.json({ ok: true });
}));
