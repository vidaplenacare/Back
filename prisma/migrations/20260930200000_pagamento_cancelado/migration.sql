-- Pagamento de solicitação encerrada (recusada/cancelada) sem ter sido pago (2026-09-30).
-- Os pagamentos antigos que ficaram `pendente` nessas solicitações são corrigidos por um script
-- separado: o Postgres não deixa usar um valor novo de enum na mesma transação em que ele é criado.

-- AlterEnum
ALTER TYPE "StatusPagamento" ADD VALUE 'cancelado';
