-- Avaliações de atendimento concluído (2026-09-30): membro avalia o cuidador e cuidador avalia a
-- família, uma vez cada por solicitação. Antes só existiam no celular de quem avaliava.

-- CreateEnum
CREATE TYPE "AutorAvaliacao" AS ENUM ('membro', 'cuidador');

-- CreateTable
CREATE TABLE "avaliacoes" (
    "id" TEXT NOT NULL,
    "solicitacaoId" TEXT NOT NULL,
    "autor" "AutorAvaliacao" NOT NULL,
    "nota" INTEGER NOT NULL,
    "comentario" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avaliacoes_pkey" PRIMARY KEY ("id"),
    -- Nota de 1 a 5 também no banco (a rota já valida; isto é a última barreira).
    CONSTRAINT "avaliacoes_nota_1_a_5" CHECK ("nota" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE UNIQUE INDEX "avaliacoes_solicitacaoId_autor_key" ON "avaliacoes"("solicitacaoId", "autor");

-- AddForeignKey
ALTER TABLE "avaliacoes" ADD CONSTRAINT "avaliacoes_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tabela nova = RLS ligado (bloqueia a API pública automática do Supabase; ver BD/README.md).
ALTER TABLE "avaliacoes" ENABLE ROW LEVEL SECURITY;
