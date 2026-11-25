-- Fotos tiradas pela câmera do app na hora (2026-09-30): foto de perfil da conta e selfie do
-- cuidador ao iniciar cada atendimento. As colunas guardam só a chave do arquivo no armazenamento.

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "fotoPerfil" TEXT,
ADD COLUMN     "fotoPerfilEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "solicitacoes" ADD COLUMN     "selfieInicio" TEXT,
ADD COLUMN     "selfieInicioEm" TIMESTAMP(3);
