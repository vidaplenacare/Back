-- Aceite dos termos no cadastro (2026-10-22): versão aceita (data do documento, ex. "2026-10-16")
-- e quando. Contas anteriores ficam nulas — aceitaram o rascunho antigo, que não era registrado.

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "termosAceitosEm" TIMESTAMP(3),
ADD COLUMN     "termosVersao" TEXT;
