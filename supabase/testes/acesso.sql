-- TESTE DE BANCO — SUPER ADMIN, AS LISTAS DE ADMINISTRAÇÃO E O ACESSO PELA FICHA
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- acesso.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve, mede e DESFAZ no
-- fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma linha por
-- caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco `$conferir$`
-- (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA
--   • As listas de administração numa instalação nova (L1 a L6): com as duas
--     listas vazias, apagar uma conta funciona (o gatilho de comando das listas
--     dispara na cascata de auth.users mesmo sem linha nelas, e não pode
--     recusar esse DELETE vazio); o último administrador e o último super
--     admin não saem, nem apagando a conta; e nenhuma das duas listas se
--     esvazia por TRUNCATE, nem pelo dono das tabelas.
--   • O papel de cada um (T1 a T13): quem só administra lê as listas e não
--     mexe nelas; o super admin concede, e o carimbo da concessão é do banco;
--     ninguém altera a lista de super admins pela API; cada conta de
--     ponto_contas() tem exatamente o acesso que a ficha e o papel dão; a
--     ficha desligada não entra.
--   • O acesso só pela ficha (T14 a T25): ligar a ficha, reativá-la ou tirar o
--     desligamento é do super admin; com a ficha ligada, a conta define o PIN,
--     sobe a selfie e bate; desativada, perde o acesso; o funcionário não mexe
--     na própria ficha.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. É também quem
-- apaga uma conta pelo editor SQL, e quem um TRUNCATE "por fora" usaria.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto; fichas, PIN e listas de administração gravados
-- sem sessão, como a instalação os gravaria. O nome de cada conta mora em
-- `raw_app_meta_data`, onde a função de contas o guarda. Sérgio é o super
-- admin; Rita, do RH, administra e não é super admin; a conta do Vítor nasce
-- sem ficha e sem papel (com o nome curto guardado na conta, "Vítor"), e a
-- ficha dele ("Vítor Campos") nasce sem conta, pelo RH.
--
-- A INSTALAÇÃO NOVA, NUM BANCO QUE JÁ TEM ADMINISTRAÇÃO: os casos L1 a L6
-- precisam das duas listas vazias, e rodam dentro de um bloco que SEMPRE volta
-- atrás no fim (exceção própria, P0099), antes do resto do arquivo. Se o banco
-- já tem administradores (a pessoa criou o primeiro super admin para usar o
-- app, por exemplo), o bloco esvazia as listas com as guardas desligadas só
-- para isso (ALTER TABLE ... DISABLE TRIGGER), religa as guardas antes do
-- primeiro caso, e tudo volta no fim do bloco; a conferência logo depois dele
-- prova que voltou. No banco zerado (`npm run db:zerar`, e no CI), as listas
-- já começam vazias e nada disso acontece.
--
-- SESSÃO FORJADA, como o PostgREST faz por requisição: o JWT vai em
-- `request.jwt.claims` com `sub` e `role` (e `request.jwt.claim.sub` fica
-- vazio: o auth.uid() lê os dois), e o papel muda com
-- `SET LOCAL ROLE authenticated` (ou service_role, no L5) — fora dos blocos
-- com EXCEPTION, menos onde o caso é justamente a recusa.
--
-- A RESPOSTA não traz e-mail de ninguém (`nome` e `cargo` saem do jsonb antes
-- de imprimir): só booleanos, contagens e, numa falha do T12, o começo do id
-- da conta errada.
--
-- O QUE A TRANSAÇÃO DESFEITA NÃO DESFAZ: a sequência de ponto_pin_tentativas
-- (sequência do Postgres não volta no ROLLBACK). A batida do T19 conta uma
-- tentativa de PIN: o próximo id fica maior, nenhuma linha fica.

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

-- ===========================================================================
-- L1 a L6. AS LISTAS DE ADMINISTRAÇÃO NUMA INSTALAÇÃO NOVA, num bloco que
-- sempre volta atrás no fim (ver o cabeçalho).
-- ===========================================================================
DO $listas$
DECLARE
  v_res          text[] := '{}';
  v_admins_antes bigint := (SELECT count(*) FROM public.ponto_admins);
  v_supers_antes bigint := (SELECT count(*) FROM public.ponto_super_admins);
  v_sergio       uuid := gen_random_uuid();   -- o super admin
  v_rita         uuid := gen_random_uuid();   -- quem administra
  v_rafael       uuid := gen_random_uuid();   -- conta com ficha e PIN, apagada no L1
  v_tiago        uuid := gen_random_uuid();   -- conta sem papel, apagada no L2
  v_gustavo      uuid := gen_random_uuid();   -- segundo administrador, que sai no L3
  v_ana          uuid := gen_random_uuid();   -- segunda super admin, que sai no L4
  v_ficha        uuid;
  v_esvaziadas   boolean := false;
  v_n            bigint;
  v_ok           boolean;
  v_ok2          boolean;
  v_ok3          boolean;
  v_erro         text;
  v_erro2        text;
BEGIN
  BEGIN
    -- As duas listas vazias, como numa instalação nova.
    IF v_admins_antes > 0 OR v_supers_antes > 0 THEN
      v_esvaziadas := true;
      ALTER TABLE public.ponto_admins
        DISABLE TRIGGER trg_ponto_admins_guardar_regras,
        DISABLE TRIGGER trg_ponto_admins_exigir_ao_menos_um;
      ALTER TABLE public.ponto_super_admins
        DISABLE TRIGGER trg_ponto_super_admins_guardar_regras,
        DISABLE TRIGGER trg_ponto_super_admins_exigir_ao_menos_um;
      DELETE FROM public.ponto_admins;
      DELETE FROM public.ponto_super_admins;
      ALTER TABLE public.ponto_admins
        ENABLE TRIGGER trg_ponto_admins_guardar_regras,
        ENABLE TRIGGER trg_ponto_admins_exigir_ao_menos_um;
      ALTER TABLE public.ponto_super_admins
        ENABLE TRIGGER trg_ponto_super_admins_guardar_regras,
        ENABLE TRIGGER trg_ponto_super_admins_exigir_ao_menos_um;
    END IF;

    INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', v_sergio,  'authenticated', 'authenticated', 'sergio.teste@example.invalid',  '{}', '{"full_name": "Sérgio Almeida"}',    now(), now()),
      ('00000000-0000-0000-0000-000000000000', v_rita,    'authenticated', 'authenticated', 'rita.teste@example.invalid',    '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
      ('00000000-0000-0000-0000-000000000000', v_rafael,  'authenticated', 'authenticated', 'rafael.teste@example.invalid',  '{}', '{"full_name": "Rafael Nunes"}',      now(), now()),
      ('00000000-0000-0000-0000-000000000000', v_tiago,   'authenticated', 'authenticated', 'tiago.teste@example.invalid',   '{}', '{"full_name": "Tiago Moreira"}',     now(), now()),
      ('00000000-0000-0000-0000-000000000000', v_gustavo, 'authenticated', 'authenticated', 'gustavo.teste@example.invalid', '{}', '{"full_name": "Gustavo Ramos"}',     now(), now()),
      ('00000000-0000-0000-0000-000000000000', v_ana,     'authenticated', 'authenticated', 'ana.teste@example.invalid',     '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now());
    INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
    VALUES (v_rafael, 'Rafael Nunes', 'Compras')
    RETURNING id INTO v_ficha;
    INSERT INTO public.ponto_pin (usuario_id, pin_hash) VALUES (v_rafael, extensions.crypt('1357', extensions.gen_salt('bf')));

    -- L1. As duas listas vazias: apagar uma conta funciona. A cascata leva o
    --     PIN, deixa a ficha sem conta, e passa pelos gatilhos de comando das
    --     duas listas sem linha nenhuma nelas.
    v_erro := NULL;
    BEGIN
      DELETE FROM auth.users WHERE id = v_rafael;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_n := 0;
      v_erro := SQLERRM;
    END;
    v_ok := v_n = 1 AND v_erro IS NULL
        AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_rafael)
        AND NOT EXISTS (SELECT 1 FROM public.ponto_pin p WHERE p.usuario_id = v_rafael)
        AND EXISTS (SELECT 1 FROM public.ponto_funcionarios f WHERE f.id = v_ficha AND f.usuario_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM public.ponto_admins)
        AND NOT EXISTS (SELECT 1 FROM public.ponto_super_admins);
    v_res := v_res || format('%s L1 instalacao nova, as duas listas vazias (%s): apagar uma conta funciona, o PIN sai junto e a ficha fica sem conta%s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END,
      CASE WHEN v_esvaziadas THEN 'esvaziadas aqui dentro' ELSE 'desde o comeco' END,
      CASE WHEN v_erro IS NOT NULL THEN ' (recusado: ' || left(v_erro, 80) || ')' ELSE '' END);

    -- L2. Com um administrador e um super admin nas listas, apagar a conta de
    --     quem não está nelas também funciona (o DELETE vazio nas listas passa).
    INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: administra');
    INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_sergio, 'teste do banco: super admin');
    v_erro := NULL;
    BEGIN
      DELETE FROM auth.users WHERE id = v_tiago;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_n := 0;
      v_erro := SQLERRM;
    END;
    v_ok := v_n = 1 AND v_erro IS NULL
        AND (SELECT count(*) FROM public.ponto_admins) = 1
        AND (SELECT count(*) FROM public.ponto_super_admins) = 1;
    v_res := v_res || format('%s L2 com as listas preenchidas, apagar a conta de quem nao administra funciona%s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END,
      CASE WHEN v_erro IS NOT NULL THEN ' (recusado: ' || left(v_erro, 80) || ')' ELSE '' END);

    -- L3. O último administrador não sai: nem apagando a conta (a cascata),
    --     nem tirando da lista. Com dois, um sai (aqui, pela conta apagada).
    v_ok := false;
    BEGIN
      DELETE FROM auth.users WHERE id = v_rita;
      v_erro := 'a conta do ultimo administrador foi apagada';
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLSTATE = '23514' AND SQLERRM LIKE 'O ponto ficaria sem nenhum administrador%';
      v_erro := SQLERRM;
    END;
    v_ok2 := false;
    BEGIN
      DELETE FROM public.ponto_admins WHERE usuario_id = v_rita;
      v_erro2 := 'o ultimo administrador saiu da lista';
    EXCEPTION WHEN OTHERS THEN
      v_ok2 := SQLSTATE = '23514' AND SQLERRM LIKE 'O ponto ficaria sem nenhum administrador%';
      v_erro2 := SQLERRM;
    END;
    INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_gustavo, 'teste do banco: segundo administrador');
    v_ok3 := true;
    BEGIN
      DELETE FROM auth.users WHERE id = v_gustavo;
    EXCEPTION WHEN OTHERS THEN
      v_ok3 := false;
    END;
    v_ok := v_ok AND v_ok2 AND v_ok3
        AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_rita)
        AND (SELECT array_agg(a.usuario_id) FROM public.ponto_admins a) = ARRAY[v_rita];
    v_res := v_res || format('%s L3 o ultimo administrador nao sai (pela conta: %s; pela lista: %s); com dois, um sai=%s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(v_erro, 45), left(v_erro2, 45), v_ok3);

    -- L4. O último super admin não sai: nem apagando a conta, nem tirando da
    --     lista. Com dois, um sai (pela conta apagada).
    v_ok := false;
    BEGIN
      DELETE FROM auth.users WHERE id = v_sergio;
      v_erro := 'a conta do ultimo super admin foi apagada';
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLSTATE = '23514' AND SQLERRM LIKE 'O ponto ficaria sem nenhum super admin%';
      v_erro := SQLERRM;
    END;
    v_ok2 := false;
    BEGIN
      DELETE FROM public.ponto_super_admins WHERE usuario_id = v_sergio;
      v_erro2 := 'o ultimo super admin saiu da lista';
    EXCEPTION WHEN OTHERS THEN
      v_ok2 := SQLSTATE = '23514' AND SQLERRM LIKE 'O ponto ficaria sem nenhum super admin%';
      v_erro2 := SQLERRM;
    END;
    INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_ana, 'teste do banco: segunda super admin');
    v_ok3 := true;
    BEGIN
      DELETE FROM auth.users WHERE id = v_ana;
    EXCEPTION WHEN OTHERS THEN
      v_ok3 := false;
    END;
    v_ok := v_ok AND v_ok2 AND v_ok3
        AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_sergio)
        AND (SELECT array_agg(s.usuario_id) FROM public.ponto_super_admins s) = ARRAY[v_sergio];
    v_res := v_res || format('%s L4 o ultimo super admin nao sai (pela conta: %s; pela lista: %s); com dois, um sai=%s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(v_erro, 45), left(v_erro2, 45), v_ok3);

    -- L5. TRUNCATE da lista de administradores: recusado para o dono das
    --     tabelas (postgres) e para o service_role, que tem o privilégio
    --     (quem segura é o gatilho, e não a falta de permissão).
    v_ok := false;
    BEGIN
      TRUNCATE public.ponto_admins;
      v_erro := 'o postgres esvaziou a lista';
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLSTATE = '23514' AND SQLERRM = 'A lista de administradores do ponto nao se esvazia.';
      v_erro := SQLERRM;
    END;
    v_ok2 := false;
    BEGIN
      SET LOCAL ROLE service_role;
      TRUNCATE public.ponto_admins;
      v_erro2 := 'o service_role esvaziou a lista';
    EXCEPTION WHEN OTHERS THEN
      v_ok2 := SQLSTATE = '23514' AND SQLERRM = 'A lista de administradores do ponto nao se esvazia.';
      v_erro2 := SQLERRM;
    END;
    RESET ROLE;
    v_ok := v_ok AND v_ok2
        AND has_table_privilege('service_role', 'public.ponto_admins', 'TRUNCATE')
        AND NOT has_table_privilege('authenticated', 'public.ponto_admins', 'TRUNCATE')
        AND (SELECT count(*) FROM public.ponto_admins) = 1;
    v_res := v_res || format('%s L5 TRUNCATE de ponto_admins recusado (postgres: %s; service_role, que tem o privilegio: %s); a lista fica',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(v_erro, 50), left(v_erro2, 50));

    -- L6. TRUNCATE da lista de super admins: recusado para o dono (pelo
    --     gatilho); o service_role nem tem o privilégio.
    v_ok := false;
    BEGIN
      TRUNCATE public.ponto_super_admins;
      v_erro := 'o postgres esvaziou a lista';
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLSTATE = '23514' AND SQLERRM = 'A lista de super admins do ponto nao se esvazia.';
      v_erro := SQLERRM;
    END;
    v_ok2 := false;
    BEGIN
      SET LOCAL ROLE service_role;
      TRUNCATE public.ponto_super_admins;
      v_erro2 := 'o service_role esvaziou a lista';
    EXCEPTION WHEN OTHERS THEN
      v_ok2 := SQLSTATE = '42501';
      v_erro2 := SQLSTATE;
    END;
    RESET ROLE;
    v_ok := v_ok AND v_ok2
        AND NOT has_table_privilege('service_role', 'public.ponto_super_admins', 'TRUNCATE')
        AND (SELECT count(*) FROM public.ponto_super_admins) = 1;
    v_res := v_res || format('%s L6 TRUNCATE de ponto_super_admins recusado (postgres: %s; service_role sem o privilegio: %s); a lista fica',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(v_erro, 50), v_erro2);

    -- Tudo o que este bloco fez volta atrás aqui (contas, fichas, listas e,
    -- se foi preciso, o desligar e religar das guardas).
    RAISE EXCEPTION 'desfazer o bloco das listas' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    NULL;
  END;

  -- O bloco voltou mesmo: as contas do bloco sumiram, as listas têm o que
  -- tinham, as quatro guardas estão ligadas e o papel é o de sempre.
  v_ok := NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id IN (v_sergio, v_rita, v_rafael, v_tiago, v_gustavo, v_ana))
      AND (SELECT count(*) FROM public.ponto_admins) = v_admins_antes
      AND (SELECT count(*) FROM public.ponto_super_admins) = v_supers_antes
      AND (SELECT count(*) FROM pg_trigger t
           WHERE t.tgrelid IN ('public.ponto_admins'::regclass, 'public.ponto_super_admins'::regclass)
             AND t.tgname IN ('trg_ponto_admins_guardar_regras', 'trg_ponto_admins_exigir_ao_menos_um',
                              'trg_ponto_super_admins_guardar_regras', 'trg_ponto_super_admins_exigir_ao_menos_um')
             AND t.tgenabled = 'O') = 4
      AND current_user = 'postgres';
  IF NOT v_ok THEN
    v_res := v_res || 'FALHOU L0 o bloco das listas nao voltou atras inteiro'::text;
  END IF;

  PERFORM set_config('teste.resultado', array_to_string(v_res, E'\n'), true);
END $listas$;

DO $teste$
DECLARE
  c_pin        constant text := '2468';
  v_res        text[] := '{}';
  -- As pessoas (elenco fictício).
  v_sergio     uuid := gen_random_uuid();   -- super admin
  v_rita       uuid := gen_random_uuid();   -- RH: administra, não é super admin (o "admin comum")
  v_ana        uuid := gen_random_uuid();   -- ficha ligada que libera
  v_bruna      uuid := gen_random_uuid();   -- ficha que libera; recebe a administração no T5
  v_caio       uuid := gen_random_uuid();   -- ficha que libera; vira super admin no T9
  v_fernanda   uuid := gen_random_uuid();   -- ficha ligada que já não libera (desligada ontem)
  v_vitor      uuid := gen_random_uuid();   -- sem ficha e sem papel
  v_local      public.ponto_local%ROWTYPE;
  v_adm        public.ponto_admins%ROWTYPE;
  v_ficha_ana  uuid;
  v_ficha      uuid;
  v_n          bigint;
  v_m          bigint;
  v_total_adm  bigint;
  v_total_sup  bigint;
  v_ok         boolean;
  v_resp       jsonb;
  v_id         uuid;
  v_caminho    text;
  v_hoje       date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_usuario    uuid;
  v_contas     uuid[];
  v_e_ficha    boolean;
  v_e_adm      boolean;
  v_e_super    boolean;
  v_batem      int := 0;
  v_so_adm     int := 0;
  v_sem        int := 0;
  v_erradas    text[] := '{}';
BEGIN
  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria).
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_sergio,   'authenticated', 'authenticated', 'sergio.teste@example.invalid',   '{}', '{"full_name": "Sérgio Almeida"}',    now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_rita,     'authenticated', 'authenticated', 'rita.teste@example.invalid',     '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,      'authenticated', 'authenticated', 'ana.teste@example.invalid',      '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_bruna,    'authenticated', 'authenticated', 'bruna.teste@example.invalid',    '{}', '{"full_name": "Bruna Costa"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_caio,     'authenticated', 'authenticated', 'caio.teste@example.invalid',     '{}', '{"full_name": "Caio Mendes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_fernanda, 'authenticated', 'authenticated', 'fernanda.teste@example.invalid', '{}', '{"full_name": "Fernanda Teles"}',    now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_vitor,    'authenticated', 'authenticated', 'vitor.teste@example.invalid',    '{}', '{"full_name": "Vítor"}',             now(), now());
  INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_sergio, 'teste do banco: super admin');
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: o RH administra');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
  VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas')
  RETURNING id INTO v_ficha_ana;
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo, desligamento)
  VALUES (v_bruna, 'Bruna Costa', 'Compras', NULL),
         (v_caio, 'Caio Mendes', 'Operações', NULL),
         (v_fernanda, 'Fernanda Teles', 'Vendas', v_hoje - 1);

  -- O local: o ativo da instalação, se houver; senão, um sintético.
  SELECT * INTO v_local FROM public.ponto_local WHERE ativo ORDER BY criado_em LIMIT 1;
  IF v_local.id IS NULL THEN
    INSERT INTO public.ponto_local (nome, latitude, longitude, raio_metros)
    VALUES ('Sede da Empresa Exemplo', -23.550520, -46.633308, 150)
    RETURNING * INTO v_local;
  END IF;

  SELECT count(*) INTO v_total_adm FROM public.ponto_admins;
  SELECT count(*) INTO v_total_sup FROM public.ponto_super_admins;

  -- =========================================================================
  -- ADMIN COMUM: vê a lista, não mexe nela
  -- =========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T1. Admin comum lê a lista de admins e a de super admins, inteiras.
  SELECT count(*) INTO v_n FROM public.ponto_admins;
  SELECT count(*) INTO v_m FROM public.ponto_super_admins;
  v_ok := v_n = v_total_adm AND v_m = v_total_sup AND public.ponto_pode_administrar() AND NOT public.ponto_sou_super_admin();
  v_res := v_res || format('%s T1 admin comum le as listas (admins %s de %s, super admins %s de %s), administra e nao e super admin',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_n, v_total_adm, v_m, v_total_sup);

  -- T2. Admin comum tenta conceder admin: recusado pela RLS.
  BEGIN
    INSERT INTO public.ponto_admins (usuario_id, concedido_por, observacao)
    VALUES (v_bruna, v_rita, 'teste do banco - comum concede');
    v_res := v_res || 'FALHOU T2 admin comum concedeu admin'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T2 admin comum nao concede admin (%s: %s)',
      CASE WHEN SQLERRM LIKE '%row-level security%' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE, left(SQLERRM, 60));
  END;

  -- T3. Admin comum tenta editar uma concessão: a RLS esconde a linha.
  UPDATE public.ponto_admins SET observacao = 'teste do banco - comum edita' WHERE usuario_id = v_rita;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_res := v_res || format('%s T3 admin comum nao edita concessao (%s linha(s) afetada(s))',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- T4. Revogar: a policy de DELETE, avaliada como esta sessão, não deixa
  --     passar nenhuma linha (sem DELETE de verdade).
  SELECT count(*) INTO v_n FROM public.ponto_admins a
  WHERE (auth.uid() IS NOT NULL) AND public.ponto_sou_super_admin();
  v_ok := v_n = 0 AND EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ponto_admins'
      AND cmd = 'DELETE'
      -- O texto da regra sai com ou sem o esquema de uid(), conforme o
      -- search_path de quem lê o catálogo.
      AND regexp_replace(qual, '\mauth\.uid\(\)', 'uid()', 'g') = '((uid() IS NOT NULL) AND ponto_sou_super_admin())');
  v_res := v_res || format('%s T4 admin comum nao revoga admin (policy de DELETE deixaria %s linha(s))',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_n);
  RESET ROLE;

  -- =========================================================================
  -- SUPER ADMIN: concede, e o carimbo é do banco
  -- =========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T5. Concede mandando autor e data FALSOS: o banco carimba os dele.
  INSERT INTO public.ponto_admins (usuario_id, concedido_por, concedido_em, observacao)
  VALUES (v_bruna, v_rita, '2020-01-01 00:00:00+00', 'teste do banco - super concede')
  RETURNING * INTO v_adm;
  v_ok := v_adm.concedido_por = v_sergio AND v_adm.concedido_em = now();
  v_res := v_res || format('%s T5 super admin concede; autor carimbado e o dele (%s), data e a do banco (%s)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_adm.concedido_por = v_sergio, v_adm.concedido_em = now());

  -- T6. Edita a observação tentando reescrever autor e data: só a observação muda.
  UPDATE public.ponto_admins
     SET observacao = 'teste do banco - super edita', concedido_por = v_rita, concedido_em = '2020-01-01 00:00:00+00'
   WHERE usuario_id = v_bruna
  RETURNING * INTO v_adm;
  v_ok := v_adm.observacao = 'teste do banco - super edita' AND v_adm.concedido_por = v_sergio AND v_adm.concedido_em = now();
  v_res := v_res || format('%s T6 editar a concessao nao reescreve autor nem data',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- T7. A concessão não troca de dono.
  BEGIN
    UPDATE public.ponto_admins SET usuario_id = v_caio WHERE usuario_id = v_bruna;
    v_res := v_res || 'FALHOU T7 concessao transferida'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T7 concessao nao muda de dono (%s)',
      CASE WHEN SQLERRM LIKE '%nao pode ser transferida%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T8. Nem o super admin altera a lista de super admins pela API.
  BEGIN
    INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_bruna, 'teste do banco');
    v_res := v_res || 'FALHOU T8a super admin inseriu super admin pela API'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T8a lista de super admins sem INSERT pela API (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;
  BEGIN
    UPDATE public.ponto_super_admins SET observacao = 'teste do banco' WHERE usuario_id = v_sergio;
    v_res := v_res || 'FALHOU T8b super admin alterou a lista pela API'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T8b lista de super admins sem UPDATE pela API (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;
  v_ok := NOT has_table_privilege('authenticated', 'public.ponto_super_admins', 'DELETE')
      AND NOT has_table_privilege('service_role', 'public.ponto_super_admins', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.ponto_super_admins', 'TRUNCATE');
  v_res := v_res || format('%s T8c lista de super admins sem DELETE/TRUNCATE para authenticated e service_role',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);
  RESET ROLE;

  -- T9. Super admin administra e bate mesmo fora de ponto_admins (posto na
  --     lista como o dono do banco poria, dentro da transação).
  INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_caio, 'teste do banco');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_caio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_meu_acesso();
  v_ok := public.ponto_sou_super_admin() AND public.ponto_pode_administrar()
      AND (v_resp ->> 'super_admin')::boolean AND (v_resp ->> 'administra')::boolean
      AND (v_resp ->> 'bate_ponto')::boolean AND (v_resp ->> 'tem_acesso')::boolean;
  RESET ROLE;
  v_res := v_res || format('%s T9 super admin fora de ponto_admins administra e bate: %s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp - 'nome' - 'cargo');

  -- T10. A lista de super admins não se reponta.
  BEGIN
    UPDATE public.ponto_super_admins SET usuario_id = v_bruna WHERE usuario_id = v_caio;
    v_res := v_res || 'FALHOU T10 super admin transferido'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T10 super admin nao se transfere (%s)',
      CASE WHEN SQLERRM LIKE 'Super admin do ponto nao se transfere%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T11. Sem sessão: ninguém é super admin, ninguém administra, e
  --      ponto_meu_acesso responde "não" nas sete chaves.
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_meu_acesso();
  v_ok := NOT public.ponto_sou_super_admin() AND NOT public.ponto_pode_administrar()
      AND v_resp = jsonb_build_object('tem_acesso', false, 'origem', NULL, 'administra', false, 'super_admin', false,
                                      'bate_ponto', false, 'nome', NULL, 'cargo', NULL);
  RESET ROLE;
  v_res := v_res || format('%s T11 sem sessao: %s', CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp);

  -- =========================================================================
  -- ACESSO: cada conta tem exatamente o que a ficha e o papel dão
  -- =========================================================================
  -- T12. A lista vem de ponto_contas(), lida pelo super admin; o esperado de
  --      cada conta sai das tabelas (ficha que libera, ponto_admins,
  --      ponto_super_admins), e a resposta, da sessão dela. Vale para toda
  --      conta do banco, e não só para as do teste.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(c.usuario_id ORDER BY c.usuario_id) INTO v_contas FROM public.ponto_contas() c;
  RESET ROLE;
  SELECT count(*) INTO v_m FROM auth.users u WHERE u.deleted_at IS NULL;
  v_n := 0;
  FOREACH v_usuario IN ARRAY coalesce(v_contas, '{}'::uuid[]) LOOP
    v_e_ficha := coalesce(public.ponto_ficha_libera_acesso(v_usuario), false);
    v_e_super := EXISTS (SELECT 1 FROM public.ponto_super_admins s WHERE s.usuario_id = v_usuario);
    v_e_adm   := v_e_super OR EXISTS (SELECT 1 FROM public.ponto_admins a WHERE a.usuario_id = v_usuario);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_resp := public.ponto_meu_acesso();
    v_ok := public.ponto_ator_aprovado() = (v_e_ficha OR v_e_adm);
    RESET ROLE;
    -- ponto_pode_bater não é do app (só service_role); a sessão é a mesma.
    v_ok := v_ok AND public.ponto_pode_bater() = (v_e_ficha OR v_e_super)
        AND (v_resp ->> 'tem_acesso')::boolean = (v_e_ficha OR v_e_adm)
        AND (v_resp ->> 'administra')::boolean = v_e_adm
        AND (v_resp ->> 'super_admin')::boolean = v_e_super
        AND (v_resp ->> 'bate_ponto')::boolean = (v_e_ficha OR v_e_super)
        AND (v_resp ->> 'origem') IS NOT DISTINCT FROM CASE WHEN v_e_ficha THEN 'ficha' WHEN v_e_adm THEN 'administracao' END
        AND coalesce(v_resp ->> 'nome', '') <> '';
    IF v_ok THEN
      v_n := v_n + 1;
    ELSE
      v_erradas := v_erradas || left(v_usuario::text, 8);
    END IF;
    IF v_e_ficha OR v_e_super THEN
      v_batem := v_batem + 1;
    ELSIF v_e_adm THEN
      v_so_adm := v_so_adm + 1;
    ELSE
      v_sem := v_sem + 1;
    END IF;
  END LOOP;
  v_ok := v_n = cardinality(v_contas) AND v_n = v_m AND v_batem > 0 AND v_so_adm > 0 AND v_sem > 0
      AND cardinality(v_erradas) = 0;
  v_res := v_res || format('%s T12 cada conta de ponto_contas(), uma a uma: %s de %s com o acesso da ficha e do papel (%s batem, %s so administram, %s sem acesso; auth.users: %s)%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_n, cardinality(v_contas), v_batem, v_so_adm, v_sem, v_m,
    CASE WHEN cardinality(v_erradas) > 0 THEN ' erradas: ' || array_to_string(v_erradas, ', ') ELSE '' END);

  -- T12b. Ficha ligada que já não libera (desligada ontem): não entra, não
  --       bate, e a ficha continua dando o nome ao histórico.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fernanda, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_meu_acesso();
  v_ok := NOT public.ponto_ator_aprovado();
  RESET ROLE;
  v_ok := v_ok AND NOT (v_resp ->> 'tem_acesso')::boolean AND NOT (v_resp ->> 'bate_ponto')::boolean
      AND v_resp ->> 'origem' IS NULL AND v_resp ->> 'nome' = 'Fernanda Teles';
  v_res := v_res || format('%s T12b ficha desligada: sem acesso, sem bater, nome da ficha (%s)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp - 'nome' - 'cargo');

  -- T13. Origem: ficha ligada -> 'ficha'; administrador sem ficha -> 'administracao'.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_meu_acesso();
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_ok := v_resp ->> 'origem' = 'ficha'
      AND public.ponto_meu_acesso() ->> 'origem' = 'administracao';
  RESET ROLE;
  v_res := v_res || format('%s T13 origem do acesso: ficha ligada -> %s; administrador sem ficha -> administracao',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'origem');

  -- =========================================================================
  -- ACESSO SÓ PELA FICHA
  -- =========================================================================
  -- T14. Conta sem ficha e sem papel: sem acesso, e o nome é o guardado na conta.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vitor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_meu_acesso();
  v_ok := NOT public.ponto_ator_aprovado() AND NOT (v_resp ->> 'tem_acesso')::boolean AND v_resp ->> 'origem' IS NULL
      AND v_resp ->> 'nome' = 'Vítor';
  RESET ROLE;
  v_res := v_res || format('%s T14 sem ficha e sem papel: sem acesso (%s)', CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp - 'nome' - 'cargo');

  -- T15. Admin comum tenta liberar acesso criando ficha ligada: recusado.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ponto_funcionarios (nome_completo, usuario_id) VALUES ('Vítor Campos', v_vitor);
    v_res := v_res || 'FALHOU T15 admin comum ligou ficha a conta'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T15 admin comum nao libera acesso pela ficha (%s)',
      CASE WHEN SQLERRM LIKE 'Liberar acesso ao ponto pela ficha e exclusivo do super admin%' THEN 'OK' ELSE 'FALHOU' END,
      left(SQLERRM, 60));
  END;
  -- ... mas cria ficha SEM conta, como sempre.
  INSERT INTO public.ponto_funcionarios (nome_completo) VALUES ('Vítor Campos') RETURNING id INTO v_ficha;
  -- ... e não liga a ficha sem conta depois, por UPDATE.
  BEGIN
    UPDATE public.ponto_funcionarios SET usuario_id = v_vitor WHERE id = v_ficha;
    v_res := v_res || 'FALHOU T15b admin comum ligou ficha por UPDATE'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T15b admin comum nao liga ficha existente (%s)',
      CASE WHEN SQLERRM LIKE 'Liberar acesso ao ponto pela ficha e exclusivo do super admin%' THEN 'OK' ELSE 'FALHOU' END,
      left(SQLERRM, 40));
  END;
  RESET ROLE;

  -- T16. Super admin liga a ficha à conta: a conta ganha acesso, origem
  --      'ficha', bate, e o nome passa a ser o da ficha (e não o curto, da conta).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_funcionarios SET usuario_id = v_vitor WHERE id = v_ficha;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vitor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_meu_acesso();
  v_ok := v_n = 1 AND public.ponto_ator_aprovado()
      AND v_resp = jsonb_build_object('tem_acesso', true, 'origem', 'ficha', 'administra', false, 'super_admin', false,
                                      'bate_ponto', true, 'nome', 'Vítor Campos', 'cargo', NULL);
  v_res := v_res || format('%s T16 super admin liga a ficha: a conta ganha acesso (%s)', CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp - 'nome' - 'cargo');

  -- T17. Só pela ficha: define o PIN.
  BEGIN
    PERFORM public.ponto_definir_pin(c_pin);
    v_res := v_res || 'OK T17 acesso so pela ficha define o PIN'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T17 definir PIN recusado: %s', SQLERRM);
  END;

  -- T18. Só pela ficha: sobe a selfie (a policy de INSERT do bucket, de verdade).
  v_id := gen_random_uuid();
  v_caminho := v_vitor::text || '/' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY/MM') || '/' || v_id::text || '.jpg';
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
    VALUES ('ponto-selfies', v_caminho, v_vitor, v_vitor::text,
            jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
    v_res := v_res || 'OK T18 acesso so pela ficha sobe a selfie'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T18 selfie recusada: %s %s', SQLSTATE, left(SQLERRM, 80));
  END;

  -- T19. Só pela ficha: bate o ponto pela RPC de verdade.
  BEGIN
    v_resp := public.ponto_registrar_batida(c_pin, v_id, v_caminho, v_local.latitude, v_local.longitude, 10);
    v_ok := (v_resp ->> 'gravado')::boolean AND v_resp -> 'registro' ->> 'tipo' = 'entrada'
        AND (v_resp -> 'registro' ->> 'ordem_no_dia')::int = 1;
    v_res := v_res || format('%s T19 acesso so pela ficha bate o ponto: gravado=%s tipo=%s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'gravado', v_resp -> 'registro' ->> 'tipo');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T19 batida recusada: %s', SQLERRM);
  END;

  -- T20. Só pela ficha: lê a própria batida e a própria selfie.
  SELECT count(*) INTO v_n FROM public.ponto_registros WHERE usuario_id = v_vitor;
  v_ok := v_n = 1;
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'ponto-selfies' AND name = v_caminho;
  v_res := v_res || format('%s T20 le a propria batida e a propria selfie (selfie visivel: %s)',
    CASE WHEN v_ok AND v_n = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  RESET ROLE;

  -- T21. Admin comum DESATIVA a ficha (tirar acesso é de qualquer admin): a
  --      conta perde o acesso, e o PIN e a batida são recusados, cada um com a
  --      frase inteira dele, que manda pedir a liberação a quem cuida do ponto.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_funcionarios SET ativo = false WHERE id = v_ficha;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vitor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_meu_acesso();
  v_ok := v_n = 1 AND NOT public.ponto_ator_aprovado() AND NOT (v_resp ->> 'tem_acesso')::boolean;
  BEGIN
    PERFORM public.ponto_definir_pin(c_pin);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND SQLSTATE = '42501'
      AND SQLERRM = 'Conta sem acesso ao ponto: peca liberacao a quem cuida do ponto';
  END;
  BEGIN
    PERFORM public.ponto_registrar_batida(c_pin, gen_random_uuid(), v_caminho, v_local.latitude, v_local.longitude, 10);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND SQLSTATE = '42501'
      AND SQLERRM = 'Conta sem acesso para bater ponto: so quem tem ficha ativa no ponto bate ponto e pede batida em atraso; peca liberacao a quem cuida do ponto';
  END;
  RESET ROLE;
  v_res := v_res || format('%s T21 ficha desativada: perde o acesso, e o PIN e a batida sao recusados (%s)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'tem_acesso');

  -- T22. Admin comum tenta REATIVAR: recusado. Super admin reativa: volta.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ponto_funcionarios SET ativo = true WHERE id = v_ficha;
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE 'Liberar acesso ao ponto pela ficha e exclusivo do super admin%';
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_funcionarios SET ativo = true WHERE id = v_ficha;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vitor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_ok := v_ok AND public.ponto_ator_aprovado();
  RESET ROLE;
  v_res := v_res || format('%s T22 reativar e do super admin; reativada, o acesso volta', CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- T23. Desligamento: ontem tira o acesso (qualquer admin); hoje ainda vale,
  --      e pôr de volta para hoje é liberar (só o super admin).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_funcionarios SET desligamento = v_hoje - 1 WHERE id = v_ficha;
  BEGIN
    UPDATE public.ponto_funcionarios SET desligamento = v_hoje WHERE id = v_ficha;
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE 'Liberar acesso ao ponto pela ficha e exclusivo do super admin%';
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vitor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_ok := v_ok AND NOT public.ponto_ator_aprovado();
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_funcionarios SET desligamento = v_hoje WHERE id = v_ficha;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vitor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_ok := v_ok AND public.ponto_ator_aprovado();
  RESET ROLE;
  v_res := v_res || format('%s T23 desligada ontem: sem acesso; desligamento hoje: acesso, e so o super admin devolve',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- T24. Admin comum continua editando cadastro de ficha que já libera
  --      (cargo): não é liberação.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ponto_funcionarios SET cargo = 'Coordenação' WHERE id = v_ficha_ana;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_res := v_res || format('%s T24 admin comum edita cadastro de ficha ligada (%s linha)',
      CASE WHEN v_n = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU T24 edicao de cadastro recusada: %s', SQLERRM);
  END;
  RESET ROLE;

  -- T25. O funcionário não se libera sozinho: sem policy de escrita na ficha.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vitor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_funcionarios SET ativo = true, desligamento = NULL WHERE id = v_ficha;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  v_res := v_res || format('%s T25 o proprio funcionario nao edita a ficha (%s linha(s))',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_n);

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('teste.resultado',
    concat_ws(E'\n', nullif(current_setting('teste.resultado', true), ''), array_to_string(v_res, E'\n')), true);
END
$teste$;

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
