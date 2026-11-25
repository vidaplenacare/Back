// Comparação do rosto do profissional ao iniciar um atendimento (decidido em 2026-09-30):
// a selfie tirada na hora é conferida com a foto da verificação profissional (Usuario.fotoPerfil).
//
// ⚠️ PROVISÓRIO: ainda não há API de reconhecimento facial contratada (candidatos: Serpro
// Datavalid, Unico, idwall — entra junto com o Cloudflare R2). Por enquanto SEMPRE aprova, e a
// selfie fica guardada em `solicitacoes.selfieInicio` para conferência e para o membro comparar.
// Quando a API existir, é só implementar aqui: a rota de iniciar já recusa quando `confere` é false.

export interface ResultadoVerificacaoFacial {
  confere: boolean;
  /** true enquanto não há API real — ninguém comparou de verdade. */
  provisorio: boolean;
  motivo?: string;
}

export async function compararRosto(_selfie: Buffer, _chaveFotoReferencia: string): Promise<ResultadoVerificacaoFacial> {
  return { confere: true, provisorio: true };
}
