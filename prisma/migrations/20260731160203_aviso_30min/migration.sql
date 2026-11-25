-- AlterTable
ALTER TABLE "solicitacoes" ADD COLUMN     "avisoEnviadoEm" TIMESTAMP(3),
ADD COLUMN     "compartilhamentoAutorizado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dataHoraAgendada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
