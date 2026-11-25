-- CreateEnum
CREATE TYPE "CategoriaCuidador" AS ENUM ('cuidador', 'tecnico', 'enfermeiro');

-- CreateEnum
CREATE TYPE "StatusVerificacaoCadastro" AS ENUM ('em_analise', 'aprovado', 'reprovado');

-- CreateEnum
CREATE TYPE "TipoDocumentoCadastro" AS ENUM ('rg_cnh', 'comprovante_endereco', 'antecedentes_criminais', 'certificado_cuidador', 'coren_comprovante', 'diploma');

-- CreateTable
CREATE TABLE "cadastros_cuidador" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "categoria" "CategoriaCuidador" NOT NULL,
    "corenNumero" TEXT,
    "chavePix" TEXT NOT NULL,
    "statusVerificacao" "StatusVerificacaoCadastro" NOT NULL DEFAULT 'em_analise',
    "motivos" TEXT[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cadastros_cuidador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadastro_documentos" (
    "id" TEXT NOT NULL,
    "cadastroId" TEXT NOT NULL,
    "tipo" "TipoDocumentoCadastro" NOT NULL,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cadastro_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadastro_quiz_respostas" (
    "id" TEXT NOT NULL,
    "cadastroId" TEXT NOT NULL,
    "questaoId" TEXT NOT NULL,
    "respostaId" TEXT NOT NULL,
    "correta" BOOLEAN NOT NULL,
    "critica" BOOLEAN NOT NULL,

    CONSTRAINT "cadastro_quiz_respostas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cadastros_cuidador_cpf_key" ON "cadastros_cuidador"("cpf");

-- AddForeignKey
ALTER TABLE "cadastro_documentos" ADD CONSTRAINT "cadastro_documentos_cadastroId_fkey" FOREIGN KEY ("cadastroId") REFERENCES "cadastros_cuidador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadastro_quiz_respostas" ADD CONSTRAINT "cadastro_quiz_respostas_cadastroId_fkey" FOREIGN KEY ("cadastroId") REFERENCES "cadastros_cuidador"("id") ON DELETE CASCADE ON UPDATE CASCADE;
