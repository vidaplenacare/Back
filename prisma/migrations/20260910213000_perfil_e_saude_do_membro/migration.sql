-- Perfil e dados de saúde do membro — o que era mock dentro do app (`DadosPessoais`,
-- `Medicamento`, `CondicaoMedica`, `ContatoEmergencia` no AppContext).
--
-- Motivo: a área do cuidador precisa mostrar a ficha de quem ele vai atender (idade, endereço,
-- condições, medicamentos, alergias). São duas visões da mesma informação, e sem essas tabelas
-- não havia de onde tirar isso — o cuidador só enxergaria nome e horário.
--
-- Segue o modelo do BACKEND-ARQUITETURA.md §3.2, com dois desvios documentados no schema.prisma:
-- `endereco` continua texto livre (a tabela estruturada depende de geocodificação, ainda não
-- contratada) e os horários de medicamento são lista de strings em vez de tabela própria.

-- CreateEnum
CREATE TYPE "StatusDocumentoMembro" AS ENUM ('pendente', 'verificado');

-- CreateTable
CREATE TABLE "membros" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "idade" INTEGER,
    "fotoUrl" TEXT,
    "endereco" TEXT,
    "alergias" TEXT[],
    "documentoStatus" "StatusDocumentoMembro" NOT NULL DEFAULT 'pendente',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "condicoes_medicas" (
    "id" TEXT NOT NULL,
    "membroId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "condicoes_medicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicamentos" (
    "id" TEXT NOT NULL,
    "membroId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "dosagem" TEXT NOT NULL,
    "horarios" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "medicamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contatos_emergencia" (
    "id" TEXT NOT NULL,
    "membroId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "relacao" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contatos_emergencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membros_usuarioId_key" ON "membros"("usuarioId");

-- CreateIndex
CREATE INDEX "condicoes_medicas_membroId_idx" ON "condicoes_medicas"("membroId");

-- CreateIndex
CREATE INDEX "medicamentos_membroId_idx" ON "medicamentos"("membroId");

-- CreateIndex
CREATE INDEX "contatos_emergencia_membroId_idx" ON "contatos_emergencia"("membroId");

-- AddForeignKey
ALTER TABLE "membros" ADD CONSTRAINT "membros_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "condicoes_medicas" ADD CONSTRAINT "condicoes_medicas_membroId_fkey" FOREIGN KEY ("membroId") REFERENCES "membros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicamentos" ADD CONSTRAINT "medicamentos_membroId_fkey" FOREIGN KEY ("membroId") REFERENCES "membros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contatos_emergencia" ADD CONSTRAINT "contatos_emergencia_membroId_fkey" FOREIGN KEY ("membroId") REFERENCES "membros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
