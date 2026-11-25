import type { CategoriaCuidador } from '@prisma/client';

// Adaptadores de verificação externa — cada um isolado atrás de uma função própria pra poder
// trocar por um provedor real depois sem mexer em regras.ts nem nas rotas. Ver
// INTEGRACOES-EXTERNAS.md #5.

// Validação real do dígito verificador do CPF (algoritmo padrão da Receita Federal) — não é mock,
// não depende de nenhum provedor externo, só confirma que o número é matematicamente válido.
export function validarChecksumCpf(cpf: string): boolean {
  const digitos = cpf.replace(/\D/g, '');
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;

  const calcularDigito = (base: string) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * (base.length + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const digito1 = calcularDigito(digitos.slice(0, 9));
  const digito2 = calcularDigito(digitos.slice(0, 10));
  return digito1 === Number(digitos[9]) && digito2 === Number(digitos[10]);
}

export interface ResultadoAntecedentes {
  situacao: 'sem_ocorrencia' | 'ocorrencia_encontrada';
}

// ⚠️ MOCK: nenhum provedor de consulta de antecedentes criminais foi contratado ainda (candidatos
// em INTEGRACOES-EXTERNAS.md #5: Bhub, Neoway, SintegraWS, Serasa Experian). Regra de teste
// **arbitrária**, só pra demonstrar os dois caminhos do fluxo de aprovação: CPF cujo último dígito
// é ímpar simula ocorrência encontrada, par simula "sem ocorrência". Substituir o corpo desta
// função pela chamada HTTP real ao provedor escolhido — a assinatura já é a interface esperada.
export async function consultarAntecedentes(cpf: string): Promise<ResultadoAntecedentes> {
  const digitos = cpf.replace(/\D/g, '');
  const ultimoDigito = Number(digitos[digitos.length - 1]);
  return { situacao: ultimoDigito % 2 === 0 ? 'sem_ocorrencia' : 'ocorrencia_encontrada' };
}

export interface ResultadoCoren {
  ativo: boolean;
}

// ⚠️ MOCK: nenhuma integração com o portal do COFEN/COREN foi feita ainda. Mesma regra de teste
// arbitrária: número de inscrição terminado em dígito ímpar simula registro inativo/irregular,
// par simula ativo. Só se aplica a `tecnico`/`enfermeiro` (cuidador não tem registro profissional).
export async function consultarCoren(numero: string, categoria: CategoriaCuidador): Promise<ResultadoCoren> {
  if (categoria === 'cuidador') return { ativo: true };
  const digitos = numero.replace(/\D/g, '');
  const ultimoDigito = Number(digitos[digitos.length - 1] ?? '0');
  return { ativo: !Number.isNaN(ultimoDigito) && ultimoDigito % 2 === 0 };
}
