-- CreateEnum
CREATE TYPE "StatusSolicitacao" AS ENUM ('pendente', 'aceita', 'em_andamento', 'concluida', 'recusada', 'cancelada');

-- CreateTable
CREATE TABLE "solicitacoes" (
    "id" TEXT NOT NULL,
    "cuidadorId" TEXT NOT NULL,
    "membroNome" TEXT NOT NULL,
    "status" "StatusSolicitacao" NOT NULL DEFAULT 'aceita',
    "ultimaLatitude" DOUBLE PRECISION,
    "ultimaLongitude" DOUBLE PRECISION,
    "atualizadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "localizacao_pings" (
    "id" TEXT NOT NULL,
    "solicitacaoId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "localizacao_pings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "localizacao_pings_solicitacaoId_criadoEm_idx" ON "localizacao_pings"("solicitacaoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_cuidadorId_fkey" FOREIGN KEY ("cuidadorId") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "localizacao_pings" ADD CONSTRAINT "localizacao_pings_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
