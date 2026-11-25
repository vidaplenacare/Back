-- Liga o perfil público do catálogo (`profissionais`) à conta real do cuidador (`usuarios`).
--
-- Sem essa ligação não dava para autorizar nenhuma ação do lado do cuidador: `solicitacoes`
-- aponta para `profissionais`, mas quem faz login é um `usuario`/`cuidador`, e não havia como
-- responder "esta solicitação é deste cuidador?". Era o gap de identidade documentado.
--
-- Nulo é permitido de propósito: os 4 perfis seedados (prof-1..prof-4) são demonstração e não
-- pertencem a ninguém. Perfil criado pelo app (PUT /cuidador/perfil) sempre tem dono.
-- UNIQUE: uma conta tem no máximo um perfil público.

-- AlterTable
ALTER TABLE "profissionais" ADD COLUMN "usuarioId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "profissionais_usuarioId_key" ON "profissionais"("usuarioId");

-- AddForeignKey
ALTER TABLE "profissionais" ADD CONSTRAINT "profissionais_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
