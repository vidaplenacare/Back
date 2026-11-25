import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

// Onde as imagens do app (foto de perfil, selfie de início de atendimento) ficam guardadas.
//
// ⚠️ TEMPORÁRIO (decidido em 2026-09-30): hoje é uma pasta local do back-end
// (`PASTA_UPLOADS`, padrão `vida-plena-backend/uploads/`). Serve para desenvolvimento e testes,
// NÃO para produção — a pasta some a cada servidor/deploy novo e não tem cópia de segurança.
// Antes de produção: contratar o Cloudflare R2 (escolhido em 2026-08-19, INTEGRACOES-EXTERNAS.md
// §7) e trocar só as duas funções abaixo (`salvarImagem`/`lerImagem`) por chamadas S3 ao R2, com
// bucket PRIVADO. As chaves ("perfil/<uuid>.jpg") continuam as mesmas, então banco e app não mudam.

export type PastaImagem = 'perfil' | 'selfie';

const PASTA_RAIZ = path.resolve(process.env.PASTA_UPLOADS ?? path.join(process.cwd(), 'uploads'));

// Só JPEG: o app sempre converte a foto da câmera para JPEG antes de enviar.
const TAMANHO_MAXIMO_BYTES = 3 * 1024 * 1024;
const FORMATO_CHAVE = /^(perfil|selfie)\/[0-9a-f-]{36}\.jpg$/;

export class ErroImagem extends Error {}

/** Converte o base64 que o app manda e confere que é mesmo um JPEG de tamanho razoável. */
export function decodificarJpeg(base64: unknown): Buffer {
  if (typeof base64 !== 'string' || !base64) throw new ErroImagem('Imagem não enviada');
  const limpo = base64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(limpo, 'base64');
  if (buffer.length === 0) throw new ErroImagem('Imagem inválida');
  if (buffer.length > TAMANHO_MAXIMO_BYTES) throw new ErroImagem('Imagem grande demais (máximo 3 MB)');
  // Assinatura do JPEG (FF D8 FF): barra qualquer outro tipo de arquivo disfarçado de foto.
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    throw new ErroImagem('O arquivo enviado não é uma foto JPEG');
  }
  return buffer;
}

export async function salvarImagem(pasta: PastaImagem, conteudo: Buffer): Promise<string> {
  const chave = `${pasta}/${randomUUID()}.jpg`;
  const destino = path.join(PASTA_RAIZ, chave);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, conteudo);
  return chave;
}

export function chaveValida(chave: string): boolean {
  return FORMATO_CHAVE.test(chave);
}

/** Lê o arquivo de uma chave. `null` se a chave é inválida ou o arquivo não existe. */
export async function lerImagem(chave: string): Promise<Buffer | null> {
  // A chave vem da URL — o formato fixo impede sair da pasta (`../`) e ler outro arquivo do servidor.
  if (!chaveValida(chave)) return null;
  try {
    return await fs.readFile(path.join(PASTA_RAIZ, chave));
  } catch {
    return null;
  }
}
