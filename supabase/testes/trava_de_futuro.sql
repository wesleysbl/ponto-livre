-- TESTE DE BANCO — A TRAVA DE FUTURO: o banco recusa batida com horário no
-- futuro
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- trava_de_futuro.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve como quem
-- administra e como colaboradora (sessões forjadas, locais à transação), mede e
-- DESFAZ no fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma
-- linha por caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco
-- `$conferir$` (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA
--   T1  a trava existe: gatilho BEFORE INSERT OR UPDATE OF registrado_em,
--       ligado, o último BEFORE da tabela; a função não é executável pelo app;
--   T2  inserção de quem administra com horário de amanhã: recusada, com a
--       mensagem legível e o horário de Brasília nela; nada gravado;
--   T3  inserção 2 minutos à frente: recusada;
--   T4  inserção com horário de agora: aceita;
--   T5  inserção 30 segundos à frente: aceita (tolerância);
--   T6  correção para amanhã: recusada, e o horário fica;
--   T7  correção para agora: aceita, com trilha de admin;
--   T8  REORDENAÇÃO: num dia com três batidas (08:00, 12:00 e 17:00), inserir
--       13:00 deixa entrada 1, saída do almoço 2, volta do almoço 3 e saída 4,
--       e a de 17:00 ganha uma linha de trilha 'sistema';
--   T9  a batida pelo app (a RPC de verdade, com PIN e selfie) continua
--       passando, com o horário do servidor.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto. Quem lança e corrige é a Rita, do RH, que
-- administra e não é super admin; as batidas lançadas são da Ana, num dia de
-- anteontem em que ela não tem batida; quem bate pelo app é a Bruna (ficha e
-- PIN). Num banco que já tem dados, o teste usa o local ativo que houver.
--
-- O QUE ELE NÃO TEM, DE PROPÓSITO: nenhuma instrução de apagar ou de esvaziar
-- tabela.
--
-- O QUE A TRANSAÇÃO DESFEITA NÃO DESFAZ: a sequência de ponto_pin_tentativas
-- (sequência do Postgres não volta no ROLLBACK): o próximo id fica maior,
-- nenhuma linha fica.

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
  c_fuso    constant text := 'America/Sao_Paulo';
  c_pin     constant text := '4321';
  v_res     text[] := '{}';
  -- As pessoas (elenco fictício).
  v_rita    uuid := gen_random_uuid();   -- RH: lança e corrige
  v_ana     uuid := gen_random_uuid();   -- as batidas lançadas e corrigidas
  v_bruna   uuid := gen_random_uuid();   -- bate pelo app (ficha e PIN)
  v_dia     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - 2;
  v_local   public.ponto_local%ROWTYPE;
  v_r08     uuid;
  v_r12     uuid;
  v_r13     uuid;
  v_r17     uuid;
  v_agora   uuid;
  v_tol     uuid;
  v_id      uuid;
  v_caminho text;
  v_resp    jsonb;
  v_ok      boolean;
  v_n       bigint;
  v_antes   bigint;
  v_depois  bigint;
  v_txt     text;
  v_tipos   text;
  v_esperado text;
  v_reg     public.ponto_registros%ROWTYPE;
BEGIN
  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria).
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_rita,  'authenticated', 'authenticated', 'rita.teste@example.invalid',  '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,   'authenticated', 'authenticated', 'ana.teste@example.invalid',   '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_bruna, 'authenticated', 'authenticated', 'bruna.teste@example.invalid', '{}', '{"full_name": "Bruna Costa"}',       now(), now());
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: o RH lanca e corrige');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
  VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas'),
         (v_bruna, 'Bruna Costa', 'Compras');
  INSERT INTO public.ponto_pin (usuario_id, pin_hash) VALUES (v_bruna, extensions.crypt(c_pin, extensions.gen_salt('bf')));

  -- O local: o ativo da instalação, se houver; senão, um sintético.
  SELECT * INTO v_local FROM public.ponto_local WHERE ativo ORDER BY criado_em LIMIT 1;
  IF v_local.id IS NULL THEN
    INSERT INTO public.ponto_local (nome, latitude, longitude, raio_metros)
    VALUES ('Sede da Empresa Exemplo', -23.550520, -46.633308, 150)
    RETURNING * INTO v_local;
  END IF;

  -- ========================================================================
  -- T1. A trava existe e é a última porta antes de gravar.
  -- ========================================================================
  v_ok := EXISTS (
            SELECT 1 FROM pg_trigger t
            WHERE t.tgrelid = 'public.ponto_registros'::regclass AND t.tgname = 'trg_ponto_trava_de_futuro'
              AND t.tgenabled = 'O' AND t.tgtype = 23
              AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a
                                    WHERE a.attrelid = 'public.ponto_registros'::regclass AND a.attname = 'registrado_em')
              AND t.tgfoid = to_regprocedure('public.ponto_recusar_horario_no_futuro()'))
      AND NOT EXISTS (
            SELECT 1 FROM pg_trigger t
            WHERE t.tgrelid = 'public.ponto_registros'::regclass AND NOT t.tgisinternal
              AND (t.tgtype & 3) = 3 AND (t.tgtype & 20) <> 0
              AND t.tgname > 'trg_ponto_trava_de_futuro')
      AND NOT has_function_privilege('authenticated', to_regprocedure('public.ponto_recusar_horario_no_futuro()'), 'EXECUTE')
      AND NOT has_function_privilege('anon', to_regprocedure('public.ponto_recusar_horario_no_futuro()'), 'EXECUTE');
  v_ok := coalesce(v_ok, false);
  v_res := v_res || format('%s T1 trava ligada: gatilho BEFORE INSERT OR UPDATE OF registrado_em, o ultimo BEFORE da tabela; funcao fora do alcance do app',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- ========================================================================
  -- QUEM ADMINISTRA, PELA POLICY, COMO O APP FAZ
  -- ========================================================================
  -- O dia do T8: três batidas lançadas pelo RH.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_ana, (v_dia + time '08:00') AT TIME ZONE c_fuso, 'teste do banco - entrada do dia de tres batidas')
  RETURNING id INTO v_r08;
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_ana, (v_dia + time '12:00') AT TIME ZONE c_fuso, 'teste do banco - saida do almoco do dia de tres batidas')
  RETURNING id INTO v_r12;
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_ana, (v_dia + time '17:00') AT TIME ZONE c_fuso, 'teste do banco - saida do dia de tres batidas')
  RETURNING id INTO v_r17;
  RESET ROLE;

  SELECT count(*) INTO v_antes FROM public.ponto_registros WHERE usuario_id = v_ana;

  -- T2. Inserção com horário de amanhã.
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_ana, now() + interval '1 day', 'teste do banco - inserir amanha');
    v_res := v_res || 'FALHOU T2 insercao de amanha aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T2 insercao de amanha recusada (%s)',
      CASE WHEN SQLERRM LIKE 'Horário no futuro:%'
            AND position(to_char((now() + interval '1 day') AT TIME ZONE c_fuso, 'DD/MM/YYYY "às" HH24:MI') IN SQLERRM) > 0
            AND SQLSTATE = '23514'
           THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- T3. Inserção 2 minutos à frente: passa da tolerância.
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_ana, now() + interval '2 minutes', 'teste do banco - inserir dois minutos a frente');
    v_res := v_res || 'FALHOU T3 insercao dois minutos a frente aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T3 insercao dois minutos a frente recusada',
      CASE WHEN SQLERRM LIKE 'Horário no futuro:%' THEN 'OK' ELSE 'FALHOU' END);
  END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.ponto_registros WHERE usuario_id = v_ana;
  IF v_n <> v_antes THEN
    v_res := v_res || format('FALHOU T2/T3 uma insercao recusada deixou linha (%s -> %s)', v_antes, v_n);
  END IF;

  -- T4. Inserção com horário de agora.
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_ana, now(), 'teste do banco - inserir agora')
    RETURNING id INTO v_agora;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T4 insercao de agora recusada (%s)', SQLERRM);
  END;

  -- T5. Inserção 30 segundos à frente: dentro da tolerância.
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_ana, now() + interval '30 seconds', 'teste do banco - inserir trinta segundos a frente')
    RETURNING id INTO v_tol;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T5 insercao trinta segundos a frente recusada (%s)', SQLERRM);
  END;
  RESET ROLE;
  SELECT * INTO v_reg FROM public.ponto_registros WHERE id = v_agora;
  v_res := v_res || format('%s T4 insercao de agora aceita: origem=%s ajuste=%s',
    CASE WHEN v_reg.registrado_em = now() AND v_reg.origem = 'ajuste_admin' AND v_reg.ajuste_manual THEN 'OK' ELSE 'FALHOU' END,
    v_reg.origem, v_reg.ajuste_manual);
  SELECT * INTO v_reg FROM public.ponto_registros WHERE id = v_tol;
  v_res := v_res || format('%s T5 insercao trinta segundos a frente aceita (tolerancia de 1 minuto)',
    CASE WHEN v_reg.registrado_em = now() + interval '30 seconds' THEN 'OK' ELSE 'FALHOU' END);

  -- T6. Correção para amanhã: recusada, e o horário fica.
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = now() + interval '1 day', motivo_ajuste = 'teste do banco - corrigir para amanha'
     WHERE id = v_agora;
    v_res := v_res || 'FALHOU T6 correcao para amanha aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    v_txt := SQLERRM;
  END;
  RESET ROLE;
  IF v_txt IS NOT NULL THEN
    SELECT * INTO v_reg FROM public.ponto_registros WHERE id = v_agora;
    v_res := v_res || format('%s T6 correcao para amanha recusada, horario intacto (%s)',
      CASE WHEN v_txt LIKE 'Horário no futuro:%' AND v_reg.registrado_em = now() THEN 'OK' ELSE 'FALHOU' END, left(v_txt, 60));
  END IF;

  -- T7. Correção para agora: aceita, com trilha de admin.
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = now(), motivo_ajuste = 'teste do banco - corrigir para agora'
     WHERE id = v_tol;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T7 correcao para agora recusada (%s)', SQLERRM);
  END;
  RESET ROLE;
  SELECT * INTO v_reg FROM public.ponto_registros WHERE id = v_tol;
  v_res := v_res || format('%s T7 correcao para agora aceita, com trilha de admin',
    CASE WHEN v_reg.registrado_em = now()
          AND EXISTS (SELECT 1 FROM public.ponto_correcoes c
                      WHERE c.registro_id = v_tol AND c.natureza = 'admin' AND 'registrado_em' = ANY (c.campos)
                        AND c.motivo = 'teste do banco - corrigir para agora')
         THEN 'OK' ELSE 'FALHOU' END);

  -- ========================================================================
  -- T8. REORDENAÇÃO: 13:00 num dia com três batidas.
  -- ========================================================================
  SELECT string_agg(to_char(registrado_em AT TIME ZONE c_fuso, 'HH24:MI') || '=' || tipo || ':' || ordem_no_dia, ',' ORDER BY registrado_em)
    INTO v_txt
  FROM public.ponto_registros WHERE usuario_id = v_ana AND dia_civil = v_dia;
  SELECT count(*) INTO v_antes FROM public.ponto_correcoes WHERE registro_id = v_r17 AND natureza = 'sistema';

  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_ana, (v_dia + time '13:00') AT TIME ZONE c_fuso, 'teste do banco - volta do almoco esquecida')
    RETURNING id INTO v_r13;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T8 insercao das 13:00 recusada (%s)', SQLERRM);
  END;
  RESET ROLE;

  SELECT string_agg(to_char(registrado_em AT TIME ZONE c_fuso, 'HH24:MI') || '=' || tipo || ':' || ordem_no_dia, ',' ORDER BY registrado_em)
    INTO v_tipos
  FROM public.ponto_registros WHERE usuario_id = v_ana AND dia_civil = v_dia;
  SELECT count(*) INTO v_depois FROM public.ponto_correcoes WHERE registro_id = v_r17 AND natureza = 'sistema';
  v_esperado := '08:00=entrada:1,12:00=saida_almoco:2,13:00=volta_almoco:3,17:00=saida:4';
  v_ok := v_tipos = v_esperado
      AND v_depois - v_antes = 1
      AND EXISTS (SELECT 1 FROM public.ponto_correcoes c
                  WHERE c.registro_id = v_r17 AND c.natureza = 'sistema'
                    AND c.campos = ARRAY['tipo', 'ordem_no_dia'] AND c.motivo LIKE 'Reordenacao do dia pelo relogio%');
  v_res := v_res || format('%s T8 reordenacao: antes %s; depois de inserir 13:00, %s; trilha sistema da de 17:00 +%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_txt, v_tipos, v_depois - v_antes);

  -- ========================================================================
  -- T9. A batida pelo app continua passando (RPC de verdade, PIN e selfie).
  -- ========================================================================
  v_id := gen_random_uuid();
  v_caminho := v_bruna::text || '/' || to_char(now() AT TIME ZONE c_fuso, 'YYYY/MM') || '/' || v_id::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_caminho, v_bruna, v_bruna::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bruna, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_registrar_batida(c_pin, v_id, v_caminho, v_local.latitude, v_local.longitude, 12);
  EXCEPTION WHEN OTHERS THEN
    v_resp := jsonb_build_object('erro', SQLERRM);
  END;
  RESET ROLE;
  SELECT * INTO v_reg FROM public.ponto_registros WHERE id = v_id;
  v_res := v_res || format('%s T9 batida pelo app intacta: resposta=%s origem=%s',
    CASE WHEN coalesce((v_resp ->> 'gravado')::boolean, false) AND v_reg.registrado_em = now() AND v_reg.origem = 'app'
         THEN 'OK' ELSE 'FALHOU' END,
    left(coalesce(v_resp ->> 'erro', 'gravado=' || (v_resp ->> 'gravado')), 80), v_reg.origem);

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
