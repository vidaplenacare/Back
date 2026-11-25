-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "asaasUrlPagamento" TEXT,
ADD COLUMN     "valorRepasse" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "resgates" ADD COLUMN     "motivoFalha" TEXT;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "asaasClienteId" TEXT;

-- CreateTable
CREATE TABLE "webhook_asaas_eventos" (
    "id" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_asaas_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_asaasCobrancaId_key" ON "pagamentos"("asaasCobrancaId");

-- CreateIndex
CREATE UNIQUE INDEX "resgates_asaasTransferenciaId_key" ON "resgates"("asaasTransferenciaId");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_asaasClienteId_key" ON "usuarios"("asaasClienteId");


-- Mesma regra de 2026-09-28 (migration habilitar_rls_tabelas_publicas): toda tabela do schema
-- public com RLS ligado e sem política, pra não ficar exposta pela API REST pública do Supabase.
ALTER TABLE "public"."webhook_asaas_eventos" ENABLE ROW LEVEL SECURITY;
