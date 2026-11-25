-- CreateEnum
CREATE TYPE "TipoUsuario" AS ENUM ('membro', 'cuidador');

-- AlterTable
ALTER TABLE "cadastros_cuidador" ADD COLUMN     "usuarioId" TEXT;

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "tipo" "TipoUsuario" NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "cpf" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoLoginEm" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes_dispositivo" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadoEm" TIMESTAMP(3),

    CONSTRAINT "sessoes_dispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuidadores" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "categoria" "CategoriaCuidador" NOT NULL,
    "corenNumero" TEXT,
    "chavePix" TEXT,
    "statusVerificacao" "StatusVerificacaoCadastro" NOT NULL DEFAULT 'em_analise',
    "motivos" TEXT[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuidadores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_cpf_key" ON "usuarios"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_dispositivo_tokenHash_key" ON "sessoes_dispositivo"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "cuidadores_usuarioId_key" ON "cuidadores"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "cadastros_cuidador_usuarioId_key" ON "cadastros_cuidador"("usuarioId");

-- AddForeignKey
ALTER TABLE "cadastros_cuidador" ADD CONSTRAINT "cadastros_cuidador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_dispositivo" ADD CONSTRAINT "sessoes_dispositivo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuidadores" ADD CONSTRAINT "cuidadores_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

