import type { CategoriaCuidador, TipoDocumentoCadastro } from '@prisma/client';
import { consultarAntecedentes, consultarCoren, validarChecksumCpf } from './providers';

export interface QuizRespostaInput {
  questaoId: string;
  respostaId: string;
  correta: boolean;
  critica: boolean;
}

export interface AvaliarCadastroInput {
  cpf: string;
  categoria: CategoriaCuidador;
  corenNumero?: string | null;
  chavePix: string;
  aceiteResponsabilidade: boolean;
  documentosEnviados: TipoDocumentoCadastro[];
  quizRespostas: QuizRespostaInput[];
}

export interface AvaliarCadastroResultado {
  statusVerificacao: 'aprovado' | 'reprovado';
  motivos: string[];
}

// Motor de regras — decide aprovação/reprovação automaticamente, sem precisar de um humano da
// equipe revisando cada cadastro. Critérios comuns a todas as categorias + critérios extras por
// categoria (cuidador não tem registro profissional; técnico/enfermeiro precisam de COREN ativo).
export async function avaliarCadastro(input: AvaliarCadastroInput): Promise<AvaliarCadastroResultado> {
  const motivos: string[] = [];
  const documentoEnviado = (tipo: TipoDocumentoCadastro) => input.documentosEnviados.includes(tipo);

  if (!documentoEnviado('rg_cnh')) motivos.push('Documento de identificação (RG ou CNH) não foi enviado.');
  if (!documentoEnviado('comprovante_endereco')) motivos.push('Comprovante de residência não foi enviado.');
  if (!documentoEnviado('antecedentes_criminais')) motivos.push('Certidão de antecedentes criminais não foi enviada.');
  if (!input.chavePix.trim()) motivos.push('Chave Pix para recebimento não foi informada.');
  if (!input.aceiteResponsabilidade) motivos.push('Termo de responsabilidade não foi aceito.');

  if (!validarChecksumCpf(input.cpf)) {
    motivos.push('CPF inválido — dígito verificador não confere.');
  } else {
    const antecedentes = await consultarAntecedentes(input.cpf);
    if (antecedentes.situacao === 'ocorrencia_encontrada') {
      motivos.push(
        'Consulta de antecedentes criminais encontrou ocorrência — cadastro não pode ser aprovado automaticamente.'
      );
    }
  }

  const perguntaCriticaErrada = input.quizRespostas.some((resposta) => resposta.critica && !resposta.correta);
  if (perguntaCriticaErrada) {
    motivos.push('Uma ou mais respostas críticas do questionário de aptidão estão incorretas.');
  }

  if (input.categoria === 'cuidador') {
    if (!documentoEnviado('certificado_cuidador')) {
      motivos.push('Certificado de curso de cuidador de idosos não foi enviado.');
    }
  } else {
    const corenInformado = Boolean(input.corenNumero && input.corenNumero.trim());
    if (!corenInformado) motivos.push('Número de inscrição no COREN não foi informado.');
    if (!documentoEnviado('coren_comprovante')) motivos.push('Comprovante de inscrição no COREN não foi enviado.');
    if (!documentoEnviado('diploma')) motivos.push('Diploma ou certificado de formação não foi enviado.');
    if (!documentoEnviado('situacao_cadastral'))
      motivos.push('Certidão de situação cadastral (regularidade ética, financeira e eleitoral) não foi enviada.');

    if (corenInformado) {
      const coren = await consultarCoren(input.corenNumero as string, input.categoria);
      if (!coren.ativo) {
        motivos.push('Registro COREN informado não está ativo na consulta ao conselho.');
      }
    }
  }

  return { statusVerificacao: motivos.length === 0 ? 'aprovado' : 'reprovado', motivos };
}
