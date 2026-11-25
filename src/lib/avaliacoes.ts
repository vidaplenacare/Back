import { Prisma, type AutorAvaliacao } from '@prisma/client';
import { prisma } from './prisma';
import { INCLUDE_SOLICITACAO, type SolicitacaoComRelacoes } from './solicitacaoInclude';

// Avaliações de atendimento (2026-09-30) — regra ÚNICA para as duas pontas:
// - só atendimento CONCLUÍDO pode ser avaliado;
// - cada ponta avalia uma vez (único por solicitação + autor);
// - nota inteira de 1 a 5, comentário opcional (até 500 caracteres);
// - avaliação do MEMBRO recalcula a nota do cuidador no catálogo (média REAL de todas as avaliações
//   de membros; os números de demonstração do seed deixam de valer assim que chega a primeira).

const TAMANHO_MAXIMO_COMENTARIO = 500;

export type ResultadoAvaliacao =
  | { ok: true; solicitacao: SolicitacaoComRelacoes }
  | { ok: false; status: number; erro: string };

export async function registrarAvaliacao(
  solicitacao: SolicitacaoComRelacoes,
  autor: AutorAvaliacao,
  corpo: unknown
): Promise<ResultadoAvaliacao> {
  const { nota, comentario } = (corpo ?? {}) as { nota?: unknown; comentario?: unknown };
  if (typeof nota !== 'number' || !Number.isInteger(nota) || nota < 1 || nota > 5) {
    return { ok: false, status: 400, erro: 'A nota precisa ser de 1 a 5 estrelas' };
  }
  if (comentario !== undefined && comentario !== null && typeof comentario !== 'string') {
    return { ok: false, status: 400, erro: 'Comentário inválido' };
  }
  const texto = typeof comentario === 'string' ? comentario.trim().slice(0, TAMANHO_MAXIMO_COMENTARIO) : '';
  if (solicitacao.status !== 'concluida') {
    return { ok: false, status: 409, erro: 'Só dá para avaliar depois que o atendimento for concluído' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.avaliacao.create({
        data: { solicitacaoId: solicitacao.id, autor, nota, comentario: texto || null },
      });
      if (autor === 'membro') {
        const media = await tx.avaliacao.aggregate({
          where: { autor: 'membro', solicitacao: { cuidadorId: solicitacao.cuidadorId } },
          _avg: { nota: true },
          _count: { _all: true },
        });
        await tx.profissional.update({
          where: { id: solicitacao.cuidadorId },
          data: {
            avaliacao: Math.round((media._avg.nota ?? 0) * 10) / 10,
            totalAvaliacoes: media._count._all,
          },
        });
      }
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      return { ok: false, status: 409, erro: 'Você já avaliou este atendimento' };
    }
    throw erro;
  }

  const atualizada = await prisma.solicitacao.findUniqueOrThrow({
    where: { id: solicitacao.id },
    include: INCLUDE_SOLICITACAO,
  });
  return { ok: true, solicitacao: atualizada };
}
