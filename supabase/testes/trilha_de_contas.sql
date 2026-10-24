-- TESTE DE BANCO — A TRILHA DA FUNÇÃO DE CONTAS (ponto-contas)
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- trilha_de_contas.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve, mede e DESFAZ no
-- fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma linha por
-- caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco `$conferir$`
-- (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA: a trilha das ações da Edge Function ponto-contas só é
-- escrita pelo service_role (o papel da função), com autor super admin, sem
-- senha em nenhum nível do JSON e com id e momento dados pelo banco; ninguém a
-- altera, nem o dono das tabelas; só o super admin a lê; `anon` nem a vê.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. O T8 prova que
-- nem ele altera a trilha (o gatilho vale para o dono).
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto. Sérgio é o super admin (o autor da trilha); a
-- Ana, com ficha que libera acesso e sem ser super admin, é "a conta comum".
--
-- O QUE ELE NÃO TEM, DE PROPÓSITO: nenhum DELETE e nenhum TRUNCATE.
--
-- SESSÃO FORJADA. O service_role é o papel da função de contas: `role =
-- service_role` no JWT, sem `sub`, e `SET LOCAL ROLE service_role` — fora dos
-- blocos com EXCEPTION. As sessões do app: `sub` e `role` no JWT e
-- `SET LOCAL ROLE authenticated` (ou anon, no T13).

BEGIN;
SET LOCAL teste.em_transacao = 'sim';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- A partida: só dentro de BEGIN (fora de uma transação, o SET LOCAL de cima
-- não vale nada), só com a estrutura do ponto aplicada e só como `postgres`,
-- sem superusuário (um superusuário passaria por cima do que se quer provar).
DO $partida$
BEGIN
  IF coalesce(current_setting('teste.em_transacao', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'Teste de banco fora de transacao: rode o arquivo inteiro (npm run db:testar), que abre com BEGIN e fecha com ROLLBACK.'
      USING ERRCODE = '25P01';
  END IF;
  IF to_regclass('public.ponto_registros') IS NULL OR to_regclass('public.ponto_super_admins') IS NULL THEN
    RAISE EXCEPTION 'A estrutura do ponto nao esta aplicada neste banco: rode npm run db:zerar.'
      USING ERRCODE = '42P01';
  END IF;
  IF current_user <> 'postgres'
     OR coalesce((SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user), true) THEN
    RAISE EXCEPTION 'Rode como postgres, sem superusuario (o papel que aplica a migration no Supabase), e nao como %.', current_user
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $partida$;

DO $teste$
DECLARE
  v_res    text[] := '{}';
  v_sergio uuid := gen_random_uuid();   -- super admin: o autor da trilha
  v_ana    uuid := gen_random_uuid();   -- a conta comum (ficha que libera, não é super admin)
  v_linha  public.ponto_contas_trilha%ROWTYPE;
  v_n      bigint;
  v_ok     boolean;
  v_antes  timestamptz := clock_timestamp();
  v_estado text;
  v_quem   text;
  v_caso   record;
BEGIN
  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria).
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_sergio, 'authenticated', 'authenticated', 'sergio.teste@example.invalid', '{}', '{"full_name": "Sérgio Almeida"}',    now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,    'authenticated', 'authenticated', 'ana.teste@example.invalid',    '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now());
  INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_sergio, 'teste do banco: super admin');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo) VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas');

  -- =========================================================================
  -- O SERVICE_ROLE (a função de contas)
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;

  -- T1. A pergunta da função responde true.
  v_res := v_res || format('%s T1 ponto_contas_trilha_pronta() para o service_role: %s',
    CASE WHEN public.ponto_contas_trilha_pronta() THEN 'OK' ELSE 'FALHOU' END, public.ponto_contas_trilha_pronta());

  -- T2. Uma linha como a função grava: id e feito_em vêm do banco.
  INSERT INTO public.ponto_contas_trilha (acao, resultado, autor_id, autor_email, alvo_usuario_id, antes, depois, passos, detalhe)
  VALUES ('trocar_nome', 'feito', v_sergio, 'sergio.teste@example.invalid', v_ana,
          '{"login": {"nome": "Antes"}}'::jsonb, '{"login": {"nome": "Depois"}}'::jsonb,
          '[{"passo": "login", "estado": "feito"}]'::jsonb, 'teste do banco - T2')
  RETURNING * INTO v_linha;
  v_ok := v_linha.id IS NOT NULL AND v_linha.feito_em >= v_antes AND v_linha.autor_id = v_sergio;
  v_res := v_res || format('%s T2 service_role grava a linha da funcao (feito_em do banco: %s)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_linha.feito_em >= v_antes);

  -- T3. A função não escolhe o id nem o momento (GRANT por coluna).
  BEGIN
    INSERT INTO public.ponto_contas_trilha (acao, resultado, autor_id, alvo_usuario_id, feito_em, detalhe)
    VALUES ('trocar_nome', 'feito', v_sergio, v_ana, '2020-01-01', 'teste do banco - T3');
    v_res := v_res || 'FALHOU T3 service_role escolheu feito_em'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T3 service_role nao escolhe feito_em (%s)', CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- T4. Autor que não é super admin: recusado.
  BEGIN
    INSERT INTO public.ponto_contas_trilha (acao, resultado, autor_id, alvo_usuario_id, detalhe)
    VALUES ('trocar_nome', 'feito', v_ana, v_ana, 'teste do banco - T4');
    v_res := v_res || 'FALHOU T4 a trilha aceitou autor que nao e super admin'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T4 autor fora de ponto_super_admins recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Autor da trilha de contas precisa ser super admin%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;

  -- T5. Senha no JSON — no topo, escondida, em camelCase e em maiúsculas —
  --     recusada PELO CHECK sem senha: a prova é o nome da constraint.
  FOR v_caso IN
    SELECT * FROM (VALUES
      ('T5a senha_provisoria',             '{"login": {"senha_provisoria": "x"}}'::jsonb, '[]'::jsonb),
      ('T5b senhaProvisoria (camelCase)',  '{"login": {"senhaProvisoria": "x"}}'::jsonb, '[]'::jsonb),
      ('T5c Password (maiuscula)',         '{"Password": "x"}'::jsonb, '[]'::jsonb),
      ('T5d NOVA_SENHA numa lista',        '{}'::jsonb, '[{"passo": "login", "lista": [{"NOVA_SENHA": "x"}]}]'::jsonb)
    ) AS c(nome, depois, passos)
  LOOP
    BEGIN
      INSERT INTO public.ponto_contas_trilha (acao, resultado, autor_id, alvo_usuario_id, depois, passos, detalhe)
      VALUES ('redefinir_senha', 'feito', v_sergio, v_ana, v_caso.depois, v_caso.passos, 'teste do banco - T5');
      v_res := v_res || format('FALHOU %s: a trilha aceitou a senha', v_caso.nome);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_quem = CONSTRAINT_NAME;
      v_res := v_res || format('%s %s recusada (%s, constraint %s)',
        CASE WHEN v_estado = '23514' AND v_quem = 'ponto_contas_trilha_sem_senha' THEN 'OK' ELSE 'FALHOU' END,
        v_caso.nome, v_estado, coalesce(nullif(v_quem, ''), 'nenhuma'));
    END;
  END LOOP;

  -- T5e. E não recusa demais: chave parecida, mas que não é de senha, passa.
  BEGIN
    INSERT INTO public.ponto_contas_trilha (acao, resultado, autor_id, alvo_usuario_id, depois, detalhe)
    VALUES ('trocar_nome', 'feito', v_sergio, v_ana, '{"login": {"nome": "Senhorinha"}, "senhas_trocadas": 0}'::jsonb, 'teste do banco - T5e');
    v_res := v_res || 'OK T5e chave que nao e de senha passa'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T5e chave que nao e de senha recusada (%s)', left(SQLERRM, 60));
  END;

  -- T6. Ação que não terminou feita sem dizer por quê: recusada.
  BEGIN
    INSERT INTO public.ponto_contas_trilha (acao, resultado, autor_id, alvo_usuario_id)
    VALUES ('trocar_email', 'desfeito', v_sergio, v_ana);
    v_res := v_res || 'FALHOU T6 desfeito sem detalhe aceito'::text;
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || 'OK T6 desfeito sem detalhe recusado'::text;
  END;

  -- T7. O service_role não altera a linha (sem privilégio).
  BEGIN
    UPDATE public.ponto_contas_trilha SET detalhe = 'teste do banco - T7' WHERE id = v_linha.id;
    v_res := v_res || 'FALHOU T7 service_role alterou a trilha'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T7 service_role nao altera a trilha (%s)', CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  RESET ROLE;

  -- T8. Nem o dono das tabelas (postgres) altera: o gatilho é permanente.
  BEGIN
    UPDATE public.ponto_contas_trilha SET detalhe = 'teste do banco - T8' WHERE id = v_linha.id;
    v_res := v_res || 'FALHOU T8 o dono das tabelas alterou a trilha'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T8 nem o dono das tabelas altera a trilha (%s)',
      CASE WHEN SQLERRM LIKE 'UPDATE em ponto_contas_trilha: a trilha do ponto e permanente%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;

  -- =========================================================================
  -- SESSÕES DO APP
  -- =========================================================================
  -- T9. Super admin lê a linha; não escreve; não usa a pergunta da função.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ponto_contas_trilha WHERE id = v_linha.id;
  v_res := v_res || format('%s T9 super admin le a trilha (%s linha)', CASE WHEN v_n = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  BEGIN
    INSERT INTO public.ponto_contas_trilha (acao, resultado, autor_id, alvo_usuario_id, detalhe)
    VALUES ('trocar_nome', 'feito', v_sergio, v_ana, 'teste do banco - T10');
    v_res := v_res || 'FALHOU T10 super admin gravou na trilha pela API'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T10 super admin nao grava na trilha pela API (%s)', CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;
  BEGIN
    PERFORM public.ponto_contas_trilha_pronta();
    v_res := v_res || 'FALHOU T11 authenticated executou ponto_contas_trilha_pronta'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T11 authenticated nao executa a pergunta da funcao (%s)', CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;
  RESET ROLE;

  -- T12. Quem não é super admin não lê nada (a RLS esconde, sem erro).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ponto_contas_trilha;
  v_res := v_res || format('%s T12 conta que nao e super admin le %s linha(s)', CASE WHEN v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_n);
  RESET ROLE;

  -- T13. anon: sem privilégio.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.ponto_contas_trilha;
    v_res := v_res || 'FALHOU T13 anon leu a trilha de contas'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T13 anon nao le a trilha (%s)', CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('teste.resultado',
    concat_ws(E'\n', nullif(current_setting('teste.resultado', true), ''), array_to_string(v_res, E'\n')), true);
END $teste$;

SELECT current_setting('teste.resultado', true) AS resultado;

-- Qualquer FALHOU (ou nenhum OK) aborta aqui: o psql sai com erro, e a
-- transação é desfeita do mesmo jeito.
DO $conferir$
DECLARE
  v_resultado text := coalesce(current_setting('teste.resultado', true), '');
BEGIN
  IF v_resultado !~ '(^|\n)OK ' OR v_resultado ~ '(^|\n)FALHOU' THEN
    RAISE EXCEPTION 'Teste de banco FALHOU (veja o resultado acima). Nada foi gravado: a transacao e desfeita.'
      USING ERRCODE = 'P0001';
  END IF;
END $conferir$;

ROLLBACK;
