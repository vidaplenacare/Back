import type { Server } from 'socket.io';
import { prisma } from './lib/prisma';

interface AtualizarLocalizacaoPayload {
  solicitacaoId: string;
  latitude: number;
  longitude: number;
}

// Handler de socket que faz `await` precisa engolir a própria falha: o Socket.IO não tem
// middleware de erro como o Express, então uma Promise rejeitada aqui vira unhandled rejection e
// derruba o processo inteiro. O ping de GPS roda a cada atualização de posição durante o
// atendimento — é o handler mais chamado do servidor, e um id inexistente ou uma instabilidade do
// banco não pode matar o back-end junto.
function comErroTratado<T>(nome: string, handler: (payload: T) => Promise<void>) {
  return (payload: T) => {
    handler(payload).catch((erro) => {
      console.error(`Erro no evento "${nome}" do Socket.IO:`, erro);
    });
  };
}

export function configurarRealtime(io: Server): void {
  io.on('connection', (socket) => {
    socket.on('entrar-sala', ({ solicitacaoId }: { solicitacaoId: string }) => {
      socket.join(solicitacaoId);
    });

    socket.on(
      'atualizar-localizacao',
      comErroTratado('atualizar-localizacao', async (payload: AtualizarLocalizacaoPayload) => {
        const { solicitacaoId, latitude, longitude } = payload;
        const atualizadoEm = new Date();

        await prisma.solicitacao.update({
          where: { id: solicitacaoId },
          data: { ultimaLatitude: latitude, ultimaLongitude: longitude, atualizadoEm },
        });
        await prisma.localizacaoPing.create({
          data: { solicitacaoId, latitude, longitude },
        });

        io.to(solicitacaoId).emit('localizacao-atualizada', {
          latitude,
          longitude,
          atualizadoEm: atualizadoEm.toISOString(),
        });
      })
    );

    socket.on(
      'autorizar-compartilhamento',
      comErroTratado('autorizar-compartilhamento', async ({ solicitacaoId }: { solicitacaoId: string }) => {
        await prisma.solicitacao.update({
          where: { id: solicitacaoId },
          data: { compartilhamentoAutorizado: true },
        });
      })
    );
  });
}
