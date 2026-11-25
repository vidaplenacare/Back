-- Agenda (faixa de horário contratada) + dinheiro (cobrança retida e saque do cuidador).
-- Ver DEV-NOTES.md 2026-09-10 e RELATORIO-ATIVIDADES-2026-09.md.
--
-- Escrita à mão (não gerada por `prisma migrate dev`) porque precisa preencher as colunas novas
-- NOT NULL nas linhas que já existem e porque a constraint EXCLUDE não é representável no schema
-- do Prisma.

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('pix', 'cartao');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('pendente', 'pago', 'liberado', 'estornado');

-- CreateEnum
CREATE TYPE "StatusResgate" AS ENUM ('processando', 'concluido', 'falhou');

-- AlterTable: `dataHoraAgendada` é o início da faixa contratada — renomeado em vez de duplicado.
ALTER TABLE "solicitacoes" RENAME COLUMN "dataHoraAgendada" TO "inicioEm";
ALTER TABLE "solicitacoes" ALTER COLUMN "inicioEm" DROP DEFAULT;

ALTER TABLE "solicitacoes" ADD COLUMN "usuarioId" TEXT;
ALTER TABLE "solicitacoes" ADD COLUMN "observacoes" TEXT;
ALTER TABLE "solicitacoes" ADD COLUMN "fimEm" TIMESTAMP(3);
ALTER TABLE "solicitacoes" ADD COLUMN "valorHora" DOUBLE PRECISION;
ALTER TABLE "solicitacoes" ADD COLUMN "valorTotal" DOUBLE PRECISION;

-- Backfill das linhas que já existem (a solicitação-ponte `sol-1` e qualquer teste antigo):
-- 3h de duração como padrão e o preço atual do profissional como valor/hora.
UPDATE "solicitacoes" s
SET "fimEm" = s."inicioEm" + INTERVAL '3 hours',
    "valorHora" = p."valorVisita",
    "valorTotal" = p."valorVisita" * 3
FROM "profissionais" p
WHERE p."id" = s."cuidadorId"
  AND (s."fimEm" IS NULL OR s."valorHora" IS NULL OR s."valorTotal" IS NULL);

ALTER TABLE "solicitacoes" ALTER COLUMN "fimEm" SET NOT NULL;
ALTER TABLE "solicitacoes" ALTER COLUMN "valorHora" SET NOT NULL;
ALTER TABLE "solicitacoes" ALTER COLUMN "valorTotal" SET NOT NULL;

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" TEXT NOT NULL,
    "solicitacaoId" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "forma" "FormaPagamento",
    "status" "StatusPagamento" NOT NULL DEFAULT 'pendente',
    "pagoEm" TIMESTAMP(3),
    "liberadoEm" TIMESTAMP(3),
    "asaasCobrancaId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resgates" (
    "id" TEXT NOT NULL,
    "cuidadorId" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "chavePix" TEXT NOT NULL,
    "status" "StatusResgate" NOT NULL DEFAULT 'processando',
    "asaasTransferenciaId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "resgates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitacoes_cuidadorId_inicioEm_idx" ON "solicitacoes"("cuidadorId", "inicioEm");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_solicitacaoId_key" ON "pagamentos"("solicitacaoId");

-- CreateIndex
CREATE INDEX "pagamentos_status_idx" ON "pagamentos"("status");

-- CreateIndex
CREATE INDEX "resgates_cuidadorId_criadoEm_idx" ON "resgates"("cuidadorId", "criadoEm");

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resgates" ADD CONSTRAINT "resgates_cuidadorId_fkey" FOREIGN KEY ("cuidadorId") REFERENCES "cuidadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Agenda sem sobreposição: o banco recusa duas reservas do mesmo profissional que se cruzem no
-- tempo. É o que impede dois membros diferentes de fecharem o mesmo horário ao mesmo tempo — a
-- checagem na tela do app sozinha não garante isso (dois aparelhos podem enviar juntos).
--
-- `[)` = início incluído, fim excluído: uma visita das 12h às 14h e outra das 14h às 17h NÃO se
-- sobrepõem. Só vale para os status que realmente seguram o horário — `pendente` fica de fora de
-- propósito (vários membros podem pedir o mesmo horário; só um vai ser aceito), assim como
-- `recusada` e `cancelada`, que liberam a vaga.
--
-- `btree_gist` é necessário para combinar a igualdade em "cuidadorId" com a sobreposição de range
-- no mesmo índice GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "solicitacoes"
  ADD CONSTRAINT "solicitacoes_sem_sobreposicao"
  EXCLUDE USING gist (
    "cuidadorId" WITH =,
    tsrange("inicioEm", "fimEm", '[)') WITH &&
  )
  WHERE ("status" IN ('aceita', 'em_andamento', 'concluida'));
