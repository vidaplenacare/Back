import { Prisma } from '@prisma/client';

// Forma padrão de devolver uma solicitação pela API — usada tanto no lado do membro quanto no do
// cuidador, porque é a MESMA contratação vista de dois ângulos.
//
// O profissional vem junto (nome, foto, etc.) para o app não precisar cruzar a solicitação com a
// lista de profissionais na mão. `usuarioId` do perfil fica de fora do `select`: é dado de
// autorização interna, não interessa a quem consome a API.
export const INCLUDE_SOLICITACAO = {
  pagamento: true,
  // O membro, do jeito que o cuidador precisa ver na lista ("Pessoas que você atende", pedidos):
  // foto e idade (2026-09-30 — antes vinha só o nome). Dados de saúde continuam só na ficha, com
  // a regra de acesso dela.
  usuario: {
    select: {
      nome: true,
      fotoPerfil: true,
      membro: { select: { idade: true } },
    },
  },
  // As avaliações das duas pontas, para as duas verem (2026-09-30).
  avaliacoes: {
    select: { autor: true, nota: true, comentario: true, criadoEm: true },
  },
  cuidador: {
    select: {
      id: true,
      nome: true,
      foto: true,
      especialidade: true,
      telefone: true,
      valorVisita: true,
    },
  },
} satisfies Prisma.SolicitacaoInclude;

export type SolicitacaoComRelacoes = Prisma.SolicitacaoGetPayload<{
  include: typeof INCLUDE_SOLICITACAO;
}>;
