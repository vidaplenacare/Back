import type { Server } from 'socket.io';
import { prisma } from './lib/prisma';

function lerMinutos(variavel: string, padrao: number): number {
  const valor = Number(process.env[variavel]);
  return Number.isFinite(valor) ? valor : padrao;
}

const AVISO_MINUTOS_ANTES = lerMinutos('AVISO_MINUTOS_ANTES', 30);
const INICIO_COMPARTILHAMENTO_MINUTOS_ANTES = lerMinutos('INICIO_COMPARTILHAMENTO_MINUTOS_ANTES', 15);
const INTERVALO_VERIFICACAO_MS = 20000;

// Verifica periodicamente se alguma solicitação aceita está a menos de AVISO_MINUTOS_ANTES do
// horário marcado e ainda não foi avisada, disparando o aviso de 30min via Socket.IO — só chega
// em quem estiver com o app aberto e conectado à sala (ver DEV-NOTES.md 2026-07-31: push remoto
// de verdade, que chegaria mesmo com o app fechado, foi adiado por depender de development build).
export function configurarScheduler(io: Server): void {
  setInterval(() => {
    // ⚠️ O `try/catch` cobre TODO o corpo de propósito. Este verificador roda sozinho a cada 20s;
    // sem isso, uma falha de banco aqui vira unhandled rejection dentro do timer e derruba o
    // processo inteiro — sem ninguém sequer acessar o servidor. Aconteceu em 2026-09-10.
    // Errar um ciclo é aceitável: o próximo tenta de novo, e `avisoEnviadoEm` garante que ninguém
    // recebe o aviso duas vezes.
    void (async () => {
      try {
        const agora = new Date();
        const limite = new Date(agora.getTime() + AVISO_MINUTOS_ANTES * 60 * 1000);

        const pendentes = await prisma.solicitacao.findMany({
          where: {
            status: 'aceita',
            avisoEnviadoEm: null,
            inicioEm: { lte: limite, gte: agora },
          },
        });

        for (const solicitacao of pendentes) {
          await prisma.solicitacao.update({
            where: { id: solicitacao.id },
            data: { avisoEnviadoEm: agora },
          });

          const minutosAteInicio = Math.max(0, Math.round((solicitacao.inicioEm.getTime() - agora.getTime()) / 60000));
          io.to(solicitacao.id).emit('aviso-30min', {
            solicitacaoId: solicitacao.id,
            membroNome: solicitacao.membroNome,
            // Minutos que REALMENTE faltam (antes ia sempre "30", mesmo faltando menos).
            minutosAntes: minutosAteInicio,
            iniciarEmMinutos: INICIO_COMPARTILHAMENTO_MINUTOS_ANTES,
            // Instante exato em que o GPS deve começar (horário − 15min). Antes o app esperava 15min
            // FIXOS a partir do aviso, em vez de contar até esse horário (2026-09-30).
            iniciarCompartilhamentoEm: new Date(
              solicitacao.inicioEm.getTime() - INICIO_COMPARTILHAMENTO_MINUTOS_ANTES * 60 * 1000
            ).toISOString(),
          });
        }
      } catch (erro) {
        console.error('Erro no verificador de aviso de 30min (segue no próximo ciclo):', erro);
      }
    })();
  }, INTERVALO_VERIFICACAO_MS);
}
