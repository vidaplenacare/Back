import 'dotenv/config';
import http from 'http';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { healthRouter } from './routes/health';
import { profissionaisRouter } from './routes/profissionais';
import { pushTokensRouter } from './routes/pushTokens';
import { solicitacoesRouter } from './routes/solicitacoes';
import { cuidadoresCadastroRouter } from './routes/cuidadoresCadastro';
import { authRouter } from './routes/auth';
import { cuidadorRouter } from './routes/cuidador';
import { membroRouter } from './routes/membro';
import { webhooksRouter } from './routes/webhooks';
import { fotosRouter } from './routes/fotos';
import { ErroEncerramento } from './lib/encerrarPagamento';
import { configurarRealtime } from './realtime';
import { configurarScheduler } from './scheduler';

const app = express();
app.use(cors());
// 5 MB: as fotos da câmera chegam em base64 dentro do JSON (~1/3 maior que o arquivo). O app já
// reduz a foto antes de enviar; `lib/armazenamento.ts` barra acima de 3 MB depois de decodificar.
app.use(express.json({ limit: '5mb' }));

app.use('/health', healthRouter);
app.use('/profissionais', profissionaisRouter);
app.use('/push-tokens', pushTokensRouter);
app.use('/solicitacoes', solicitacoesRouter);
app.use('/cuidadores-cadastro', cuidadoresCadastroRouter);
app.use('/auth', authRouter);
app.use('/cuidador', cuidadorRouter);
app.use('/membro', membroRouter);
app.use('/webhooks', webhooksRouter);
app.use('/fotos', fotosRouter);

// Último middleware: recebe o que os handlers `async` rejeitarem (encaminhado pelo `rotaAsync`) e
// responde 500 em vez de deixar virar unhandled rejection, que encerraria o processo inteiro —
// levando junto o Socket.IO do GPS. A mensagem crua fica só no log do servidor: devolver detalhe
// de erro de banco para o cliente é vazamento de informação.
// A assinatura precisa dos 4 parâmetros (incluindo `_next`) — é assim que o Express reconhece um
// middleware de erro.
app.use((erro: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  // Erros do leitor de JSON (express.json) são culpa do PEDIDO, não do servidor: antes viravam
  // 500 "Erro interno" (achado em teste em 2026-09-30) — e uma foto grande demais também.
  const tipo = (erro as { type?: string } | null)?.type;
  if (tipo === 'entity.parse.failed') {
    res.status(400).json({ erro: 'Os dados enviados estão em formato inválido' });
    return;
  }
  if (tipo === 'entity.too.large') {
    res.status(413).json({ erro: 'Arquivo grande demais para enviar' });
    return;
  }
  // Cancelamento que não dá para fazer automaticamente (ex.: Asaas não estorna boleto) — mensagem
  // clara para o app, em vez de "Erro interno" (2026-09-30). Ver lib/encerrarPagamento.ts.
  if (erro instanceof ErroEncerramento) {
    console.warn('[encerramento]', erro.message);
    res.status(409).json({ erro: erro.message, codigo: 'ESTORNO_MANUAL' });
    return;
  }
  console.error('Erro não tratado em rota:', erro);
  res.status(500).json({ erro: 'Erro interno no servidor' });
});

// Rede de segurança final: por padrão o Node ENCERRA o processo numa Promise rejeitada sem
// tratamento, e este servidor não pode cair — junto dele vai o Socket.IO que acompanha o cuidador
// a caminho do atendimento. As rotas (`rotaAsync`), o scheduler e os handlers de socket já tratam
// seus próprios erros; isto cobre o que escapar. Fica barulhento no log de propósito: é sinal de
// que falta tratamento em algum lugar.
process.on('unhandledRejection', (motivo) => {
  console.error('[unhandledRejection] servidor seguiu de pé, mas isto precisa ser investigado:', motivo);
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
configurarRealtime(io);
configurarScheduler(io);

const port = Number(process.env.PORT) || 3000;
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Vida Plena back-end (HTTP + Socket.IO) rodando em http://0.0.0.0:${port}`);
});
