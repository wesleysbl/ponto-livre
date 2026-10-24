-- ---------------------------------------------------------------------------
-- O PRIMEIRO SUPER ADMIN DO PONTO
--
-- O QUE FAZ: põe UMA conta que já existe no login do Supabase na lista de
-- super admins do ponto (public.ponto_super_admins). Super admin é quem cria
-- as contas das pessoas pelo app, liga cada ficha de RH à conta certa e
-- escolhe quem administra o ponto. Sem nenhum, ninguém entra: o app diz "sem
-- acesso ao ponto" para todo mundo.
--
-- POR QUE É SQL, E NÃO UM BOTÃO NO APP: a lista de super admins não aceita
-- gravação de ninguém da API (nem da chave de serviço do projeto); só o dono
-- do banco, o papel `postgres`, acrescenta alguém. É de propósito: quem
-- conseguisse se pôr nesta lista pela internet mandaria em todas as contas.
--
-- PASSO A PASSO, NO PAINEL DO SUPABASE (supabase.com/dashboard)
--   1. Authentication › Users › Add user › Create new user: o e-mail e a
--      senha de quem vai ser o super admin, com "Auto Confirm User" marcado
--      (sem isso o login recusa a conta até alguém abrir o e-mail de
--      confirmação).
--   2. SQL Editor › New query: cole este arquivo inteiro.
--   3. Troque o e-mail de exemplo na linha marcada com "TROQUE AQUI" pelo
--      e-mail da conta do passo 1. É o único lugar do arquivo onde ele
--      aparece.
--   4. Run. O SQL Editor roda como `postgres`, o dono do banco.
--   5. O resultado mostra a lista de super admins. Entre no app com o e-mail
--      e a senha do passo 1: ele pede um PIN de 4 dígitos e abre o ponto.
--
-- No Supabase local (Supabase CLI), o mesmo vale pelo Studio
-- (http://127.0.0.1:54323, SQL Editor), ou pelo psql do contêiner do banco:
--   docker exec -i supabase_db_<project_id> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/primeiro-super-admin.sql
-- (o <project_id> está em supabase/config.toml).
--
-- PODE RODAR DE NOVO: se a conta já for super admin, ele avisa e não
-- duplica. Se o e-mail não existir no login, ou se a conta ainda não tiver o
-- e-mail confirmado, ele recusa, diz o que fazer e não muda nada: super admin
-- manda em todas as contas do ponto, e uma conta sem e-mail confirmado é uma
-- conta que ninguém provou ser de quem diz. Para acrescentar outro super
-- admin depois, é o mesmo arquivo com o outro e-mail. Tirar alguém da lista
-- também é SQL do dono do banco, e, depois do primeiro, a lista não fica
-- vazia: o banco recusa tirar o último.
--
-- PRECISA DA ESTRUTURA DO PONTO JÁ APLICADA (a migration de
-- supabase/migrations/, com `npx supabase db push` ou `npx supabase db
-- reset`). Sem ela, ele recusa e diz isso.
-- ---------------------------------------------------------------------------

DO $primeiro_super_admin$
DECLARE
  -- TROQUE AQUI: o e-mail da conta criada em Authentication › Users.
  v_email constant text := 'voce@example.com';

  v_procurado  text := lower(btrim(v_email));
  v_usuario    uuid;
  v_confirmada timestamptz;
BEGIN
  IF to_regclass('public.ponto_super_admins') IS NULL THEN
    RAISE EXCEPTION 'A estrutura do ponto ainda não foi aplicada neste banco: falta a tabela public.ponto_super_admins.'
      USING HINT = 'Aplique a migration de supabase/migrations/ (npx supabase db push, no projeto ligado) e rode este arquivo de novo.';
  END IF;

  -- A conta, pelo e-mail, entre as que existem no login (a apagada não vale).
  SELECT u.id, u.email_confirmed_at
    INTO v_usuario, v_confirmada
    FROM auth.users u
   WHERE lower(u.email) = v_procurado
     AND u.deleted_at IS NULL
   ORDER BY u.created_at
   LIMIT 1;

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Não existe conta com o e-mail "%" no login do Supabase. Nada mudou. Crie a conta em Authentication › Users › Add user › Create new user (com "Auto Confirm User" marcado), troque o e-mail na linha marcada com TROQUE AQUI pelo e-mail dessa conta e rode de novo.', btrim(v_email)
      USING HINT = 'O e-mail tem de ser igual ao da coluna Email em Authentication › Users (maiúsculas não importam).';
  END IF;

  IF v_confirmada IS NULL THEN
    RAISE EXCEPTION 'A conta "%" existe, mas o e-mail dela ainda não foi confirmado. Nada mudou. Confirme o e-mail (pelo link que o Supabase mandou para ele) ou apague a conta em Authentication › Users e crie de novo com "Auto Confirm User" marcado; depois rode este arquivo de novo.', btrim(v_email)
      USING HINT = 'Sem e-mail confirmado o login recusa a conta, e o super admin manda em todas as contas do ponto: ele não nasce de uma conta que ninguém confirmou.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ponto_super_admins s WHERE s.usuario_id = v_usuario) THEN
    RAISE NOTICE 'A conta "%" já é super admin do ponto. Nada mudou.', btrim(v_email);
    RETURN;
  END IF;

  INSERT INTO public.ponto_super_admins (usuario_id, observacao)
  VALUES (v_usuario, 'Super admin posto por supabase/primeiro-super-admin.sql, na instalação.');

  RAISE NOTICE 'A conta "%" agora é super admin do ponto. Entre no app com ela.', btrim(v_email);
END
$primeiro_super_admin$;

-- A lista de super admins, para conferir (é o que o SQL Editor mostra no fim).
-- Este arquivo só acrescenta conta com o e-mail confirmado; `email_confirmado`
-- falso numa linha quer dizer uma conta posta na lista por outro caminho, que
-- o login recusa até a confirmação.
SELECT u.email,
       u.email_confirmed_at IS NOT NULL AS email_confirmado,
       s.concedido_em AS super_admin_desde
  FROM public.ponto_super_admins s
  JOIN auth.users u ON u.id = s.usuario_id
 ORDER BY s.concedido_em, u.email;
