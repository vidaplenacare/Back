# Asaas — o que a documentação oficial confirma (e como o Vida Plena usa)

> Consultado em 2026-09-28 em https://docs.asaas.com. Tudo aqui foi lido na documentação, não
> suposto — quando algo não estiver aqui, conferir a doc antes de afirmar. Implementação:
> `src/lib/asaas.ts`, `src/routes/solicitacoes.ts`, `src/routes/webhooks.ts`, `src/routes/cuidador.ts`.

## Modelo adotado (decisão do projeto, 2026-09-28)

Conta única da plataforma recebe todas as cobranças; o valor fica retido até a visita ser concluída;
o cuidador saca via transferência Pix (`POST /v3/transfers`) quando quiser. Sem subcontas/split.
Cartão é pago na página da própria Asaas (`invoiceUrl`) — o número do cartão nunca passa pelo nosso
backend. Comissão da plataforma: `PLATAFORMA_COMISSAO_PERCENTUAL` (padrão 0).

## Idempotência

- **Não existe cabeçalho de idempotência** (`Idempotency-Key` ou similar) documentado na API.
- Recomendação oficial ([Boas práticas gerais](https://docs.asaas.com/docs/boas-pr%C3%A1ticas-gerais)):
  manter um identificador único no nosso sistema e enviá-lo em `externalReference`; antes de uma
  nova tentativa, verificar se a operação já foi registrada; **em timeout, não reenviar direto** —
  consultar primeiro, porque reenviar sem verificar pode gerar cobrança duplicada.
- No Vida Plena: `externalReference` = id do nosso `Pagamento` / `Usuario` / `Resgate`; antes de
  criar, `GET /payments?externalReference=...` (e `/customers?externalReference=...`); e trava
  `pg_advisory_xact_lock` por pagamento/cuidador contra dois toques simultâneos.

## Webhooks

Fontes: [Introdução - Webhooks](https://docs.asaas.com/docs/sobre-os-webhooks),
[Idempotência em Webhooks](https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks).

- Entrega **"at least once"**: o mesmo evento pode chegar mais de uma vez. Cada evento tem um `id`
  único e estável (formato `evt_...&...`) — persistir esse id como chave única. No Vida Plena:
  tabela `webhook_asaas_eventos`, gravada na mesma transação que aplica o efeito.
- Autenticação: o token definido no cadastro do webhook chega no header **`asaas-access-token`**
  (no Vida Plena: `ASAAS_WEBHOOK_TOKEN`).
- Responder **HTTP 200**. Após **15 falhas consecutivas** a fila do webhook pode ser interrompida
  (eventos continuam sendo gerados mas não enviados até reativar). Eventos ficam guardados por
  **14 dias**. Por isso o nosso endpoint responde 200 até pra evento desconhecido/alheio.
- Até 10 webhooks por conta; cada um recebe só os eventos selecionados na configuração.
- Formato: `{ "id": "evt_...", "event": "PAYMENT_RECEIVED", "dateCreated": "...", "account": {...},
  "payment": { "id": "pay_...", "status": "...", ... } }` — transferências vêm em `transfer`.

### Eventos de cobrança ([doc](https://docs.asaas.com/docs/webhook-para-cobrancas))

- `PAYMENT_CONFIRMED`: pagamento efetuado, **saldo ainda não disponível**.
- `PAYMENT_RECEIVED`: recebido, saldo disponível.
- **Pix** vai direto de `PAYMENT_CREATED` para `PAYMENT_RECEIVED`. **Cartão** passa por
  `PAYMENT_CONFIRMED` e só vira `PAYMENT_RECEIVED` depois de **32 dias (crédito)** / 3 dias (débito).
- Estorno: `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`.
- Remoção: `PAYMENT_DELETED` / `PAYMENT_RESTORED`. Vencimento: `PAYMENT_OVERDUE`.
- Cartão: `PAYMENT_AWAITING_RISK_ANALYSIS`, `PAYMENT_REPROVED_BY_RISK_ANALYSIS`,
  `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`. Chargeback: `PAYMENT_CHARGEBACK_REQUESTED`,
  `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`.
- No Vida Plena: `CONFIRMED` **ou** `RECEIVED` → `pago` (libera a visita); `REFUNDED` → `estornado`;
  `DELETED` com pagamento pendente → limpa o vínculo. Chargeback ainda **não tratado** (só ignorado).

### Eventos de transferência ([doc](https://docs.asaas.com/docs/webhook-para-transferencias))

`TRANSFER_CREATED`, `TRANSFER_PENDING`, `TRANSFER_IN_BANK_PROCESSING`, `TRANSFER_BLOCKED`,
`TRANSFER_DONE`, `TRANSFER_FAILED`, `TRANSFER_CANCELLED` — sem sequência obrigatória. Motivo de
falha em `transfer.failReason`. No Vida Plena: `DONE` → `concluido`; `FAILED`/`CANCELLED` →
`falhou` (valor volta ao saldo do cuidador); os demais mantêm `processando`.

## Transferências Pix ([doc](https://docs.asaas.com/docs/pix-4))

- `POST /v3/transfers` com `pixAddressKey` + `pixAddressKeyType` (`CPF`, `CNPJ`, `EMAIL`, `PHONE`,
  `EVP`) — validar que o tipo bate com o formato da chave antes de enviar. `externalReference` aceito.
- ⚠️ Se a conta tiver **validação de eventos críticos por Token APP/SMS** ligada, a transferência
  fica pendente até alguém validar manualmente.
- ⚠️ Se a conta tiver o **[mecanismo de validação de saque via webhook](https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks)**
  configurado, **toda** transferência via API é enviada 5s depois pra uma URL nossa que precisa
  aprovar; sem resposta 3 vezes seguidas, a transferência é **cancelada**. O Vida Plena **não
  implementa** esse endpoint — manter o mecanismo desligado ou implementar antes de ligar.
- ⚠️ Consequência do modelo de conta única + cartão: dinheiro de cartão só fica disponível ~32 dias
  depois (`PAYMENT_RECEIVED`). Um saque do cuidador pode falhar por saldo insuficiente na conta da
  plataforma nesse intervalo — o resgate vira `falhou` e o valor volta ao saldo dele.

## Pix nas cobranças ([doc](https://docs.asaas.com/docs/cobrancas-via-pix))

- `GET /v3/payments/{id}/pixQrCode` funciona para cobranças `PIX`, `BOLETO` **ou `UNDEFINED`** —
  devolve imagem Base64, `payload` (copia e cola) e expiração. QR dinâmico, pago uma vez só.
- Com `UNDEFINED`, o pagador escolhe a forma (entre as habilitadas na conta) ao abrir a fatura
  (`invoiceUrl`). O Vida Plena usa `UNDEFINED`: uma cobrança só serve pro QR no app e pro cartão.
- A conta precisa ter **chave Pix cadastrada** para receber Pix.

## Onde fica cada configuração no painel

Tudo começa no **menu do usuário** (canto superior direito). O menu **Integrações** só aparece
para usuário **administrador** da conta.

| O quê | Caminho | Fonte |
|---|---|---|
| Chave de API | Menu do usuário → Integrações → Chave de API → **Gerar nova chave de API** (aparece só uma vez — copiar na hora) | [Chaves de API](https://docs.asaas.com/docs/chaves-de-api) |
| Webhook | Menu do usuário → Integrações → Webhooks → **Criar Webhook** (campos: Nome, URL, E-mail, API Version, Auth Token de 32–255 caracteres, Enabled, Interrupted, Send Type) | [Criar webhook pela aplicação web](https://docs.asaas.com/docs/criar-novo-webhook-pela-aplicacao-web) |
| Chave Pix da conta | Menu **Pix** → **Minhas Chaves** (cobranças Pix geradas antes de cadastrar a chave não são corrigidas — gerar novas) | [Cobranças via Pix](https://docs.asaas.com/docs/cobrancas-via-pix) |
| Token de ação crítica (APP/SMS) e validação de saque via webhook | Menu do usuário → Integrações → **Mecanismos de segurança** (no sandbox o token de ação crítica pode ser desabilitado para testar transferências) | [Como testar ações críticas](https://docs.asaas.com/docs/como-testar-a%C3%A7%C3%B5es-cr%C3%ADticas) |
| Recursos do sandbox | Menu do usuário → Minha conta → Configurações → Sandbox | [Configurar conta no Sandbox](https://docs.asaas.com/docs/como-configurar-sua-conta-no-sandbox) |

## Configuração atual do sandbox (conferida via API em 2026-09-28)

Segredos (chave de API e token do webhook) ficam **só** no `.env` (`ASAAS_API_KEY`,
`ASAAS_WEBHOOK_TOKEN`) — nunca neste arquivo.

- **Webhook** `532f2fe1-f175-487f-aa66-389a1a916acb` — "Vida Plena (sandbox)", API v3, envio
  sequencial, fila ativada, com token. Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
  `PAYMENT_REFUNDED`, `PAYMENT_DELETED`, `TRANSFER_DONE`, `TRANSFER_FAILED`, `TRANSFER_CANCELLED`.
- **URL do webhook é temporária**: aponta para um túnel `cloudflared` (`*.trycloudflare.com` →
  `localhost:3000`) que muda a cada reinício. O túnel é desligado ao fim de cada sessão de teste
  (enquanto ligado, o backend inteiro fica acessível pela internet). Ao subir um túnel novo, atualizar a URL no painel ou
  via `PUT /v3/webhooks/532f2fe1-f175-487f-aa66-389a1a916acb`. Conferir o estado atual com
  `GET /v3/webhooks`.
- **Chave Pix da conta**: EVP (aleatória) ativa, herdada do projeto antigo.
- **Validação de saque via webhook**: desabilitada — manter assim.
- Saldo sandbox em 2026-09-28: R$ 498,43.

## Testes no sandbox

- **Confirmar pagamento de uma cobrança:** não há endpoint — usar os botões **CONFIRMAR PAGAMENTO**
  / **RECEBER PAGAMENTO** na interface do sandbox
  ([doc](https://docs.asaas.com/docs/testando-pagamento-com-cart%C3%A3o-de-cr%C3%A9dito)).
- Cartão no sandbox: aprovado automaticamente; há números de cartão de teste pra simular erro.
- Pagar QR Pix de verdade no sandbox exige uma **segunda conta sandbox** pagadora
  (`POST /v3/pix/qrCodes/pay`) ([doc](https://docs.asaas.com/docs/testar-pagamento-de-qrcodes-pix)).
- **Transferências:** chaves Pix fictícias como `cliente-a00001@pix.bcb.gov.br` concluem sozinhas
  como sucesso; precisa de saldo na conta
  ([doc](https://docs.asaas.com/docs/testando-transfer%C3%AAncias),
  [adicionar saldo](https://docs.asaas.com/docs/como-adicionar-dinheiro-para-testes)).

## Ainda não verificado na documentação

- Limites de requisição (rate limit) e exigência de `User-Agent` — o cliente envia
  `User-Agent: vida-plena-backend` por precaução.
