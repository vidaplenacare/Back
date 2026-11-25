import { prisma } from './prisma';
import { obterCobranca } from './asaas';

// Rede de segurança do webhook (2026-09-30): se o aviso da Asaas se perder (ex.: túnel do webhook
// fora do ar no teste), a cobrança fica PAGA na Asaas e `pendente` no nosso banco — o app nunca
// atualizava e a tela de pagar dava erro 500 ("Esta cobrança não pode mais ser paga"). Aqui o
// servidor pergunta direto à Asaas e aplica o mesmo efeito do webhook PAYMENT_RECEIVED.

const STATUS_PAGOS_ASAAS = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

/** Confere na Asaas um pagamento `pendente` com cobrança; se já foi pago lá, marca `pago`. */
export async function sincronizarPagamento(pagamento: {
  id: string;
  status: string;
  asaasCobrancaId: string | null;
}): Promise<boolean> {
  if (pagamento.status !== 'pendente' || !pagamento.asaasCobrancaId) return false;
  const cobranca = await obterCobranca(pagamento.asaasCobrancaId);
  if (!STATUS_PAGOS_ASAAS.has(cobranca.status)) return false;

  // `updateMany` com status pendente no filtro: se o webhook chegar ao mesmo tempo, só um aplica.
  const { count } = await prisma.pagamento.updateMany({
    where: { id: pagamento.id, status: 'pendente' },
    data: {
      status: 'pago',
      pagoEm: new Date(),
      ...(cobranca.billingType === 'PIX' ? { forma: 'pix' as const } : {}),
      ...(cobranca.billingType === 'CREDIT_CARD' ? { forma: 'cartao' as const } : {}),
    },
  });
  if (count > 0) console.warn(`[asaas] pagamento ${pagamento.id} marcado pago pela conferência direta (webhook não tinha chegado)`);
  return true;
}

/** Confere todos os pagamentos pendentes com cobrança de um membro. Nunca lança erro. */
export async function sincronizarPagamentosDoMembro(usuarioId: string): Promise<void> {
  const pendentes = await prisma.pagamento.findMany({
    where: { status: 'pendente', asaasCobrancaId: { not: null }, solicitacao: { usuarioId } },
    select: { id: true, status: true, asaasCobrancaId: true },
  });
  for (const p of pendentes) {
    await sincronizarPagamento(p).catch((e) => console.warn('[asaas] falha ao conferir pagamento', p.id, e));
  }
}
