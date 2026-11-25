// Cliente mínimo da API v3 da Asaas — só o que o fluxo de garantia usa (ver DEV-NOTES/Cérebro,
// decisão de 2026-09-28): conta única da plataforma recebe as cobranças; o repasse ao cuidador é
// uma transferência Pix sob demanda (saque). Sem subcontas/split.
//
// ASAAS_API_KEY só existe no backend. ASAAS_BASE_URL permite trocar sandbox → produção sem código.

const BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';

export class ErroAsaas extends Error {
  constructor(
    mensagem: string,
    public readonly status: number,
    public readonly detalhes?: unknown,
  ) {
    super(mensagem);
  }
}

export function asaasConfigurada(): boolean {
  return Boolean(process.env.ASAAS_API_KEY);
}

async function chamar<T>(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<T> {
  const chave = process.env.ASAAS_API_KEY;
  if (!chave) throw new ErroAsaas('ASAAS_API_KEY não configurada no .env do backend', 500);

  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    method: metodo,
    headers: {
      access_token: chave,
      'Content-Type': 'application/json',
      'User-Agent': 'vida-plena-backend',
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20000),
  });

  const texto = await resposta.text();
  const json = texto ? JSON.parse(texto) : {};
  if (!resposta.ok) {
    // A Asaas devolve { errors: [{ code, description }] } — a descrição é legível em português.
    const descricao = json?.errors?.[0]?.description ?? `Erro ${resposta.status} na Asaas`;
    throw new ErroAsaas(descricao, resposta.status, json);
  }
  return json as T;
}

// ---- Clientes ----------------------------------------------------------------------------------

interface ClienteAsaas {
  id: string;
}

interface Lista<T> {
  data: T[];
}

export async function criarOuObterCliente(dados: {
  usuarioId: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
}): Promise<string> {
  // Procura antes de criar: se o id da Asaas não chegou a ser salvo no nosso banco (queda no meio),
  // não duplica o cliente.
  const existentes = await chamar<Lista<ClienteAsaas>>(
    'GET',
    `/customers?externalReference=${encodeURIComponent(dados.usuarioId)}`,
  );
  if (existentes.data[0]) return existentes.data[0].id;

  const criado = await chamar<ClienteAsaas>('POST', '/customers', {
    name: dados.nome,
    cpfCnpj: dados.cpf.replace(/\D/g, ''),
    email: dados.email,
    mobilePhone: dados.telefone.replace(/\D/g, ''),
    externalReference: dados.usuarioId,
    // O app já faz as notificações — sem isso a Asaas manda e-mail/SMS próprio ao membro.
    notificationDisabled: true,
  });
  return criado.id;
}

// ---- Cobranças ---------------------------------------------------------------------------------

export interface CobrancaAsaas {
  id: string;
  status: string;
  value: number;
  invoiceUrl: string;
  billingType: string;
}

export interface PixAsaas {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

function dataDeHojeMaisDias(dias: number): string {
  const data = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  // Data no fuso de Brasília — a Asaas interpreta `dueDate` como data local brasileira.
  return data.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Idempotente pelo `externalReference` (= id do nosso Pagamento): se uma cobrança pra esse pagamento
 * já existe na Asaas (ex.: a resposta da criação se perdeu antes de salvarmos o id), devolve ela em
 * vez de criar outra. Quem chama ainda deve serializar chamadas concorrentes pro mesmo pagamento.
 *
 * `billingType: 'UNDEFINED'`: uma cobrança só serve pros dois caminhos — o QR code Pix mostrado
 * dentro do app e a página da Asaas onde o membro paga com cartão.
 */
export async function criarOuObterCobranca(dados: {
  pagamentoId: string;
  clienteAsaasId: string;
  valor: number;
  descricao: string;
}): Promise<CobrancaAsaas> {
  const existentes = await chamar<Lista<CobrancaAsaas>>(
    'GET',
    `/payments?externalReference=${encodeURIComponent(dados.pagamentoId)}`,
  );
  if (existentes.data[0]) return existentes.data[0];

  return chamar<CobrancaAsaas>('POST', '/payments', {
    customer: dados.clienteAsaasId,
    billingType: 'UNDEFINED',
    value: Math.round(dados.valor * 100) / 100,
    dueDate: dataDeHojeMaisDias(1),
    description: dados.descricao,
    externalReference: dados.pagamentoId,
  });
}

export function obterCobranca(cobrancaId: string): Promise<CobrancaAsaas> {
  return chamar<CobrancaAsaas>('GET', `/payments/${cobrancaId}`);
}

export function obterQrCodePix(cobrancaId: string): Promise<PixAsaas> {
  return chamar<PixAsaas>('GET', `/payments/${cobrancaId}/pixQrCode`);
}

export function estornarCobranca(cobrancaId: string): Promise<CobrancaAsaas> {
  return chamar<CobrancaAsaas>('POST', `/payments/${cobrancaId}/refund`, {});
}

export function removerCobranca(cobrancaId: string): Promise<unknown> {
  return chamar('DELETE', `/payments/${cobrancaId}`);
}

// ---- Transferências (saque do cuidador) --------------------------------------------------------

export interface TransferenciaAsaas {
  id: string;
  status: string;
  failReason?: string | null;
}

type TipoChavePix = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';

/** A Asaas exige o tipo da chave. 11 dígitos é ambíguo (CPF ou celular): decide pelo dígito
 * verificador do CPF. */
export function tipoDaChavePix(chave: string, cpfValido: (cpf: string) => boolean): TipoChavePix {
  const texto = chave.trim();
  if (texto.includes('@')) return 'EMAIL';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(texto)) return 'EVP';
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length === 14) return 'CNPJ';
  if (digitos.length === 11 && cpfValido(digitos)) return 'CPF';
  return 'PHONE';
}

export function transferirPix(dados: {
  resgateId: string;
  valor: number;
  chavePix: string;
  tipoChave: TipoChavePix;
}): Promise<TransferenciaAsaas> {
  const chave = ['CPF', 'CNPJ', 'PHONE'].includes(dados.tipoChave)
    ? dados.chavePix.replace(/\D/g, '')
    : dados.chavePix.trim();
  return chamar<TransferenciaAsaas>('POST', '/transfers', {
    value: Math.round(dados.valor * 100) / 100,
    operationType: 'PIX',
    pixAddressKey: chave,
    pixAddressKeyType: dados.tipoChave,
    description: 'Vida Plena — resgate de saldo',
    externalReference: dados.resgateId,
  });
}
