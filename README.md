# Vida Plena — Back-end

O servidor (Express/Socket.IO) roda **local**, na máquina de quem está desenvolvendo (ainda sem
deploy em nuvem — isso é um passo pendente). O **banco de dados já está na nuvem**, hospedado no
**Supabase** (Postgres gerenciado, projeto criado em 2026-08-14) — só o banco está lá; não
precisa de Docker/Postgres local nenhum. Ver
[`vida-plena-app/BACKEND-ARQUITETURA.md`](../vida-plena-app/BACKEND-ARQUITETURA.md) para o modelo
de dados completo, e `RELATORIO-BACKEND.md`/`RELATORIO-ATIVIDADES-2026-09.md` (na raiz do
repositório) para o histórico do que já foi construído — este projeto já passou da fatia mínima
inicial (só `GET /profissionais`) e hoje cobre autenticação, cadastro/verificação de cuidador,
solicitações/agenda, pagamentos (mock) e perfil de membro/cuidador (ver `src/routes/`).

## Stack

- Node.js + TypeScript + Express + Socket.IO
- Prisma ORM
- PostgreSQL gerenciado pelo Supabase (não local)

## Como rodar

1. Instalar dependências:
   ```
   npm install
   ```
2. Conferir se `.env` tem o `DATABASE_URL` do Supabase configurado (já deve estar, é compartilhado
   pelo projeto — não precisa criar um banco novo).
3. Aplicar migrations pendentes (primeira vez, ou depois de puxar mudanças de schema):
   ```
   npm run prisma:migrate
   ```
4. Popular com os profissionais mock, se o banco ainda não tiver (mesmos dados de
   `vida-plena-app/src/data/profissionais.ts`):
   ```
   npm run prisma:seed
   ```
5. Rodar o servidor:
   ```
   npm run dev
   ```
   Sobe em `http://localhost:3000`. Para o app no celular/tablet (Expo Go) conseguir acessar, o
   aparelho precisa estar na **mesma rede Wi-Fi** que este computador, e você acessa pelo IP local
   da máquina (ex.: `http://192.168.0.72:3000` — descubra o seu com `ipconfig`, procure "IPv4" da
   sua rede Wi-Fi). Atualize `API_BASE_URL` em `vida-plena-app/src/services/api.ts` se o IP for
   diferente do que já está lá.

`npm run docker:up`/`docker:down` continuam existindo no `package.json` como alternativa pra rodar
um Postgres local (útil só se algum dia for preciso testar isolado do Supabase) — não fazem parte
do fluxo normal de hoje.

## Se o celular não conseguir conectar

O Firewall do Windows pode ter bloqueado a porta 3000 na primeira vez que o Node abriu essa
porta. Verifique se apareceu um prompt de permissão do Firewall e libere para redes privadas.

## Endpoints

Bem mais do que `/health` e `/profissionais` hoje — ver `src/routes/` (`auth`, `profissionais`,
`pushTokens`, `membro`, `solicitacoes`, `cuidador`, `cuidadoresCadastro`) para a lista completa e
atualizada, em vez de manter uma lista solta aqui que fica desatualizada.
