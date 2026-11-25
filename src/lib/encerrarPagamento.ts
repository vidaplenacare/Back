import type { StatusPagamento } from '@prisma/client';
import { ErroAsaas, estornarCobranca, removerCobranca } from './asaas';

// O que acontece com o pagamento quando uma solicitação é ENCERRADA sem atendimento (recusada pelo
// cuidador, cancelada pelo membro ou pelo cuidador). Regra ÚNICA para as três rotas (2026-09-30).
//
// Por quê: o pagamento nasce junto com a solicitação, como `pendente`. Antes, recusar deixava esse
// pagamento `pendente` para sempre — o app do membro continuava mostrando "pagamento pendente" de
// um pedido recusado. E o cancelamento feito pelo CUIDADOR marcava `estornado` sem pedir o estorno
// na Asaas (o dinheiro do membro não voltaria).
//
//   pago               → estorno de verdade na Asaas → `estornado`
//   pendente c/ cobrança aberta → cobrança removida na Asaas → `cancelado`
//   pendente sem cobrança       → `cancelado` (nunca houve cobrança)
//   liberado/estornado/cancelado → nada muda
//
// Asaas PRIMEIRO: se o estorno falhar, o erro sobe e a solicitação continua ativa, em vez de
// marcarmos "estornado" sem o dinheiro ter voltado.
/** Encerramento que não pode ser feito automaticamente — a rota responde 409 com a mensagem. */
export class ErroEncerramento extends Error {}

export async function encerrarPagamento(pagamento: {
  status: StatusPagamento;
  asaasCobrancaId: string | null;
} | null): Promise<StatusPagamento | null> {
  if (!pagamento) return null;

  if (pagamento.status === 'pago') {
    if (pagamento.asaasCobrancaId) {
      await estornarCobranca(pagamento.asaasCobrancaId).catch((erro) => {
        // A Asaas recusa estornar algumas cobranças (ex.: pagas por boleto — só estorna Pix e
        // cartão). Vira um erro claro para o app em vez de "Erro interno" (2026-09-30).
        if (erro instanceof ErroAsaas && erro.status < 500) {
          throw new ErroEncerramento(
            `Não foi possível devolver o pagamento automaticamente (${erro.message}). Fale com o suporte para cancelar.`
          );
        }
        throw erro;
      });
    }
    return 'estornado';
  }

  if (pagamento.status === 'pendente') {
    if (pagamento.asaasCobrancaId) {
      await removerCobranca(pagamento.asaasCobrancaId).catch((erro) => {
        // Cobrança já paga/removida do lado da Asaas não impede encerrar; o webhook resolve o
        // estado final se ela tiver sido paga no meio do caminho.
        if (!(erro instanceof ErroAsaas) || erro.status >= 500) throw erro;
      });
    }
    return 'cancelado';
  }

  return null;
}
