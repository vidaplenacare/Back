-- Habilita Row Level Security (RLS) em todas as tabelas do schema public.
--
-- Motivo: todo projeto Supabase expõe automaticamente uma API REST pública (PostgREST) por cima
-- de qualquer tabela do schema `public`, acessível com a chave "anon" (pensada para ser pública/
-- embutida em apps). Sem RLS, essa API dá acesso de leitura/escrita direto nas tabelas para
-- qualquer um com essa chave — mesmo este projeto nunca usando o SDK do Supabase (o backend só
-- acessa o banco via conexão direta do Postgres, com DATABASE_URL, que roda como dono do banco e
-- ignora RLS). Sem nenhuma política definida aqui de propósito: o objetivo é bloquear totalmente
-- o acesso via PostgREST (ninguém usa essa via hoje), não liberar acesso granular por role.
--
-- Verificado em 2026-09-28: as 17 tabelas abaixo estavam com `relrowsecurity = false` (consulta a
-- pg_class/pg_namespace), sinalizado como CRITICAL pelo Security Advisor do Supabase para pelo
-- menos `_prisma_migrations`.

-- Condicional: no "shadow database" que o `prisma migrate dev` usa pra reaplicar as migrations,
-- `_prisma_migrations` não existe — um ALTER direto quebrava a criação de qualquer migration nova.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
ALTER TABLE "public"."cadastro_documentos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cadastro_quiz_respostas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cadastros_cuidador" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."condicoes_medicas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."contatos_emergencia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cuidadores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."localizacao_pings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."medicamentos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."membros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."pagamentos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."profissionais" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."resgates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sessoes_dispositivo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."solicitacoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;
