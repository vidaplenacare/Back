-- CreateEnum
CREATE TYPE "CategoriaProfissional" AS ENUM ('cuidador', 'enfermeiro', 'fisioterapeuta', 'acompanhante');

-- CreateEnum
CREATE TYPE "NivelOcupacao" AS ENUM ('livre', 'parcial', 'lotado');

-- CreateTable
CREATE TABLE "profissionais" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "especialidade" TEXT NOT NULL,
    "categoria" "CategoriaProfissional" NOT NULL,
    "experiencia" TEXT NOT NULL,
    "avaliacao" DOUBLE PRECISION NOT NULL,
    "totalAvaliacoes" INTEGER NOT NULL,
    "foto" TEXT NOT NULL,
    "nivelOcupacao" "NivelOcupacao" NOT NULL,
    "bio" TEXT NOT NULL,
    "formacao" TEXT NOT NULL,
    "areasAtuacao" TEXT[],
    "disponibilidade" TEXT NOT NULL,
    "diasDisponiveis" INTEGER[],
    "horarioInicio" TEXT NOT NULL,
    "horarioFim" TEXT NOT NULL,
    "valorVisita" DOUBLE PRECISION NOT NULL,
    "telefone" TEXT NOT NULL,

    CONSTRAINT "profissionais_pkey" PRIMARY KEY ("id")
);
