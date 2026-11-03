-- TESTE DE BANCO: A JORNADA, O INÍCIO DO SALDO E A TRAVA DA PRÓPRIA FICHA
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- jornada_e_saldo.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve, mede e DESFAZ no
-- fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma linha por
-- caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco `$conferir$`
-- (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA (a migration `..._jornada_e_saldo.sql`)
--   • A jornada da empresa (T1 a T24): quem administra grava a semana, que
--     volta em ordem; a carga diária é a do maior dia e não se digita mais
--     (nem pelo app guardado no celular, que ainda manda a carga); cada
--     jornada errada é recusada com a frase do problema.
--   • A jornada própria, na ficha (T25 a T32): quem administra a grava e a
--     tira (nula = segue a da empresa), com as mesmas regras; quem bate lê a
--     da empresa e a própria e não grava nenhuma.
--   • A chave pública (T33 a T35), sem nada; os CHECKs que seguram as regras
--     sem os gatilhos (T36 a T38); e a ordem dos gatilhos da ficha (T39).
--   • Quem já usava o ponto (J1 a J7): a jornada montada das cargas de 3 h,
--     4 h, 6 h, 8 h, 8h48 e 12 h, pela mesma instrução que a migration roda na
--     linha que já existe, com os blocos certos e a carga igual.
--   • O início do saldo (S1 a S6): a data na linha que já existe e na linha
--     nova; quem administra recua a data, quem bate não; o app guardado no
--     celular não a desfaz; nula é recusada.
--   • A trava da própria ficha (P1 a P14): ninguém muda a jornada própria nem
--     a data em que passou a bater ponto na ficha ligada à própria conta, nem
--     quem administra, nem o super admin, nem criando a ficha já ligada, nem
--     ligando a si uma ficha que já as tem, nem pelo upsert (INSERT ... ON
--     CONFLICT DO UPDATE); a ficha dos outros continua editável, e a jornada
--     da empresa também.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. Os casos J1 a J7
-- rodam como ele e sem sessão, como a migration roda; os T36 a T38 desligam os
-- gatilhos da jornada (ALTER TABLE ... DISABLE TRIGGER, como um restore com os
-- gatilhos desligados faria) e os religam antes do T39, que confere.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto; fichas e listas de administração gravadas sem
-- sessão, como a instalação as gravaria. A Rita, do RH, administra, não é
-- super admin e tem a própria ficha; o Sérgio é o super admin e começa sem
-- ficha (a dele nasce sem conta, pelo RH); "a pessoa" é a Ana e "a outra" é a
-- Bruna, as duas com ficha que libera acesso e sem administrar.
--
-- A LINHA DA CONFIGURAÇÃO: a da instalação, se houver; senão, nasce aqui, sem
-- sessão (no banco zerado, e no CI, ela não existe quando a migration roda, e
-- o caminho da linha que já existe é provado pelos casos J, com a instrução da
-- migration, e pela conferência dentro da própria migration). O S2 apaga a
-- linha dentro de um bloco que SEMPRE volta atrás (exceção própria, P0099),
-- para provar a linha que nasce pela tela; logo depois, confere que ela voltou.
--
-- SESSÃO FORJADA, como o PostgREST faz por requisição: o JWT vai em
-- `request.jwt.claims` com `sub` e `role`, e o papel muda com
-- `SET LOCAL ROLE authenticated` (ou anon). A gravação da configuração é a do
-- app: o upsert (`INSERT ... ON CONFLICT (id) DO UPDATE`) de `salvarJornada`
-- e `salvarEmpresa`, ou o UPDATE da linha 1.

BEGIN;
SET LOCAL teste.em_transacao = 'sim';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- A partida: só dentro de BEGIN (fora de uma transação, o SET LOCAL de cima
-- não vale nada), só com a estrutura e a migration da jornada aplicadas e só
-- como `postgres`, sem superusuário (um superusuário passaria por cima do que
-- se quer provar).
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
  IF to_regprocedure('public.ponto_jornada_problema(jsonb)') IS NULL OR to_regprocedure('public.ponto_jornada_da_carga(integer)') IS NULL THEN
    RAISE EXCEPTION 'A migration da jornada nao esta aplicada neste banco: rode npm run db:zerar.'
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
  c_semente     constant jsonb := '[{"dia": 1, "inicio": "08:00", "fim": "12:00"}, {"dia": 1, "inicio": "13:00", "fim": "17:00"},
                                    {"dia": 2, "inicio": "08:00", "fim": "12:00"}, {"dia": 2, "inicio": "13:00", "fim": "17:00"},
                                    {"dia": 3, "inicio": "08:00", "fim": "12:00"}, {"dia": 3, "inicio": "13:00", "fim": "17:00"},
                                    {"dia": 4, "inicio": "08:00", "fim": "12:00"}, {"dia": 4, "inicio": "13:00", "fim": "17:00"},
                                    {"dia": 5, "inicio": "08:00", "fim": "12:00"}, {"dia": 5, "inicio": "13:00", "fim": "17:00"}]';
  -- Fora de ordem de propósito: a gravação devolve os blocos em ordem.
  c_propria     constant jsonb := '[{"dia": 3, "inicio": "14:00", "fim": "18:00"}, {"dia": 3, "inicio": "09:00", "fim": "13:00"}]';
  c_dono_muda   constant text := 'Quem e dono da ficha nao muda a propria jornada nem a data em que passou a bater ponto: peca a outra pessoa que administra o ponto ou ao super admin';
  c_dono_liga   constant text := 'Quem e dono da ficha nao a cria nem a liga a propria conta com jornada propria ou com a data em que passou a bater ponto: grave a ficha sem as duas e peca a outra pessoa que administra o ponto que as preencha';
  v_res         text[] := '{}';
  -- As pessoas (elenco fictício).
  v_rita        uuid := gen_random_uuid();   -- RH: administra, não é super admin, tem ficha
  v_sergio      uuid := gen_random_uuid();   -- super admin, começa sem ficha
  v_ana         uuid := gen_random_uuid();   -- a pessoa
  v_bruna       uuid := gen_random_uuid();   -- a outra
  v_ficha_rita  uuid;
  v_ficha_serg  uuid;
  v_hoje        date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_tinha_linha boolean;
  v_saldo_antes date;
  v_n           bigint;
  v_n2          bigint;
  v_carga       integer;
  v_tol         integer;
  v_jornada     jsonb;
  v_esperada    jsonb;
  v_data        date;
  v_data2       date;
  v_ok          boolean;
  v_erro        text;
  v_caso        record;
BEGIN
  -- ------------------------------------------------------------------------
  -- As pessoas do teste e a linha da configuração, sem sessão.
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_rita,   'authenticated', 'authenticated', 'rita.teste@example.invalid',   '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_sergio, 'authenticated', 'authenticated', 'sergio.teste@example.invalid', '{}', '{"full_name": "Sérgio Almeida"}',    now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,    'authenticated', 'authenticated', 'ana.teste@example.invalid',    '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_bruna,  'authenticated', 'authenticated', 'bruna.teste@example.invalid',  '{}', '{"full_name": "Bruna Costa"}',       now(), now());
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: o RH grava a jornada');
  INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_sergio, 'teste do banco: super admin');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo, bate_ponto_desde)
  VALUES (v_rita, 'Rita Moraes', 'RH', v_hoje - 200)
  RETURNING id INTO v_ficha_rita;
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
  VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas'),
         (v_bruna, 'Bruna Costa', 'Compras');

  v_tinha_linha := EXISTS (SELECT 1 FROM public.ponto_configuracao WHERE id = 1);
  IF NOT v_tinha_linha THEN
    INSERT INTO public.ponto_configuracao (id) VALUES (1);
  END IF;
  SELECT c.saldo_a_partir_de INTO v_saldo_antes FROM public.ponto_configuracao c WHERE c.id = 1;

  -- =========================================================================
  -- QUEM ADMINISTRA GRAVA A JORNADA DA EMPRESA
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T1. A semente, de trás para a frente: grava, volta em ordem e a carga é
  --     480. Quem grava tem a própria ficha: a jornada da empresa não é dela.
  BEGIN
    UPDATE public.ponto_configuracao
       SET jornada = (SELECT jsonb_agg(e ORDER BY (e ->> 'dia')::int DESC, e ->> 'inicio' DESC) FROM jsonb_array_elements(c_semente) e)
     WHERE id = 1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT c.carga_diaria_minutos, c.jornada INTO v_carga, v_jornada FROM public.ponto_configuracao c WHERE c.id = 1;
    v_res := v_res || format('%s T1 quem administra (com ficha) grava a jornada valida (seg a sex, 8h-12h e 13h-17h): %s linha(s), em ordem? %s, carga %s min',
      CASE WHEN v_n = 1 AND v_jornada = c_semente AND v_carga = 480 THEN 'OK' ELSE 'FALHOU' END, v_n, v_jornada = c_semente, v_carga);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T1 quem administra nao gravou a jornada valida: ' || SQLERRM);
  END;

  -- T2. A carga é o maior dia: segunda 9h e sábado 4h dão 540.
  BEGIN
    UPDATE public.ponto_configuracao
       SET jornada = '[{"dia": 1, "inicio": "08:00", "fim": "12:00"}, {"dia": 1, "inicio": "13:00", "fim": "18:00"},
                       {"dia": 6, "inicio": "08:00", "fim": "12:00"}]'
     WHERE id = 1;
    SELECT c.carga_diaria_minutos INTO v_carga FROM public.ponto_configuracao c WHERE c.id = 1;
    v_res := v_res || format('%s T2 carga diaria derivada da jornada (o maior dia): %s min',
      CASE WHEN v_carga = 540 THEN 'OK' ELSE 'FALHOU' END, v_carga);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T2 jornada com sabado recusada: ' || SQLERRM);
  END;

  -- T3. Blocos que só se encostam valem (08:00-12:00 e 12:00-17:00).
  BEGIN
    UPDATE public.ponto_configuracao
       SET jornada = '[{"dia": 2, "inicio": "08:00", "fim": "12:00"}, {"dia": 2, "inicio": "12:00", "fim": "17:00"}]'
     WHERE id = 1;
    SELECT c.carga_diaria_minutos INTO v_carga FROM public.ponto_configuracao c WHERE c.id = 1;
    v_res := v_res || format('%s T3 blocos que se encostam valem: carga %s min', CASE WHEN v_carga = 540 THEN 'OK' ELSE 'FALHOU' END, v_carga);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T3 blocos que se encostam recusados: ' || SQLERRM);
  END;

  -- T4 a T22. As recusas, cada uma com a frase (o gatilho a manda inteira).
  FOR v_caso IN
    SELECT * FROM (VALUES
      ('T4 bloco invertido', '[{"dia": 1, "inicio": "13:00", "fim": "12:00"}]'::jsonb,
       'Jornada invalida: no dia 1 (segunda), o bloco 13:00-12:00 nao termina depois de comecar%'),
      ('T5 bloco de duracao zero', '[{"dia": 1, "inicio": "12:00", "fim": "12:00"}]',
       'Jornada invalida: no dia 1 (segunda), o bloco 12:00-12:00 nao termina depois de comecar%'),
      ('T6 blocos cruzados', '[{"dia": 1, "inicio": "08:00", "fim": "12:00"}, {"dia": 1, "inicio": "11:00", "fim": "13:00"}]',
       'Jornada invalida: no dia 1 (segunda), os blocos 08:00-12:00 e 11:00-13:00 se cruzam%'),
      ('T7 bloco repetido', '[{"dia": 4, "inicio": "08:00", "fim": "12:00"}, {"dia": 4, "inicio": "08:00", "fim": "12:00"}]',
       'Jornada invalida: no dia 4 (quinta), os blocos 08:00-12:00 e 08:00-12:00 se cruzam%'),
      ('T8 tres blocos no dia', '[{"dia": 2, "inicio": "08:00", "fim": "10:00"}, {"dia": 2, "inicio": "10:00", "fim": "12:00"}, {"dia": 2, "inicio": "13:00", "fim": "17:00"}]',
       'Jornada invalida: no dia 2 (terca) ha 3 blocos (no maximo dois por dia).'),
      ('T9 dia da semana 0', '[{"dia": 0, "inicio": "08:00", "fim": "12:00"}]',
       'Jornada invalida: o dia da semana 0 nao existe (1 = segunda a 7 = domingo).'),
      ('T10 dia da semana 8', '[{"dia": 8, "inicio": "08:00", "fim": "12:00"}]',
       'Jornada invalida: o dia da semana 8 nao existe (1 = segunda a 7 = domingo).'),
      ('T11 dia da semana em texto', '[{"dia": "1", "inicio": "08:00", "fim": "12:00"}]',
       'Jornada invalida: o dia da semana "1" nao existe (1 = segunda a 7 = domingo).'),
      ('T12 dia da semana quebrado', '[{"dia": 1.5, "inicio": "08:00", "fim": "12:00"}]',
       'Jornada invalida: o dia da semana 1.5 nao existe (1 = segunda a 7 = domingo).'),
      ('T13 horario sem o zero', '[{"dia": 1, "inicio": "8:00", "fim": "12:00"}]',
       'Jornada invalida: no dia 1 (segunda), o horario "8:00" a "12:00" nao esta no formato HH:MM%'),
      ('T14 horario 24:00', '[{"dia": 1, "inicio": "20:00", "fim": "24:00"}]',
       'Jornada invalida: no dia 1 (segunda), o horario "20:00" a "24:00" nao esta no formato HH:MM%'),
      ('T15 minuto 60', '[{"dia": 1, "inicio": "08:00", "fim": "12:60"}]',
       'Jornada invalida: no dia 1 (segunda), o horario "08:00" a "12:60" nao esta no formato HH:MM%'),
      ('T16 dia com mais de 12h', '[{"dia": 5, "inicio": "07:00", "fim": "12:00"}, {"dia": 5, "inicio": "13:00", "fim": "21:00"}]',
       'Jornada invalida: o dia 5 (sexta) soma 780 min; um dia com jornada soma de 60 a 720 min%'),
      ('T17 dia com menos de 1h', '[{"dia": 7, "inicio": "08:00", "fim": "08:30"}]',
       'Jornada invalida: o dia 7 (domingo) soma 30 min; um dia com jornada soma de 60 a 720 min%'),
      ('T18 lista vazia', '[]',
       'Jornada invalida: nenhum bloco.%'),
      ('T19 objeto em vez de lista', '{"dia": 1, "inicio": "08:00", "fim": "12:00"}',
       'Jornada invalida: a jornada e uma lista de blocos%'),
      ('T20 chave a mais no bloco', '[{"dia": 1, "inicio": "08:00", "fim": "12:00", "intervalo": 60}]',
       'Jornada invalida: cada bloco tem dia, inicio e fim, e nada mais.'),
      ('T21 bloco sem o fim', '[{"dia": 1, "inicio": "08:00"}]',
       'Jornada invalida: cada bloco tem dia, inicio e fim, e nada mais.'),
      ('T22 jornada da empresa nula', NULL,
       'Jornada invalida: a jornada esta vazia.')
    ) AS c(rotulo, jornada, frase)
  LOOP
    BEGIN
      UPDATE public.ponto_configuracao SET jornada = v_caso.jornada WHERE id = 1;
      v_res := v_res || ('FALHOU ' || v_caso.rotulo || ': a jornada foi gravada');
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s %s recusado: %s',
        CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE v_caso.frase THEN 'OK' ELSE 'FALHOU' END, v_caso.rotulo, SQLERRM);
    END;
  END LOOP;

  -- T23. O app guardado no celular (salvarJornada): upsert com a carga
  --      digitada. Grava sem erro, a tolerância fica, a carga continua a da
  --      jornada.
  BEGIN
    UPDATE public.ponto_configuracao SET jornada = c_semente WHERE id = 1;
    INSERT INTO public.ponto_configuracao (id, carga_diaria_minutos, tolerancia_minutos, janela_duplicidade_segundos)
    VALUES (1, 300, 15, 90)
    ON CONFLICT (id) DO UPDATE SET carga_diaria_minutos = EXCLUDED.carga_diaria_minutos,
                                   tolerancia_minutos = EXCLUDED.tolerancia_minutos,
                                   janela_duplicidade_segundos = EXCLUDED.janela_duplicidade_segundos
    RETURNING carga_diaria_minutos, tolerancia_minutos INTO v_carga, v_tol;
    v_res := v_res || format('%s T23 o app guardado no celular grava a configuracao sem erro: carga devolvida %s min (mandou 300), tolerancia %s',
      CASE WHEN v_carga = 480 AND v_tol = 15 THEN 'OK' ELSE 'FALHOU' END, v_carga, v_tol);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T23 o app guardado no celular nao grava a configuracao: ' || SQLERRM);
  END;

  -- T24. A carga sozinha, num UPDATE: também não muda (é a da jornada).
  BEGIN
    UPDATE public.ponto_configuracao SET carga_diaria_minutos = 600 WHERE id = 1;
    SELECT c.carga_diaria_minutos INTO v_carga FROM public.ponto_configuracao c WHERE c.id = 1;
    v_res := v_res || format('%s T24 a carga digitada nao vale: continua %s min', CASE WHEN v_carga = 480 THEN 'OK' ELSE 'FALHOU' END, v_carga);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T24 gravar a carga deu erro: ' || SQLERRM);
  END;

  -- =========================================================================
  -- A JORNADA PRÓPRIA, NA FICHA
  -- =========================================================================
  -- T25. Quem administra grava a jornada própria da Ana; ela volta em ordem.
  BEGIN
    UPDATE public.ponto_funcionarios SET jornada = c_propria WHERE usuario_id = v_ana;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT f.jornada INTO v_jornada FROM public.ponto_funcionarios f WHERE f.usuario_id = v_ana;
    v_ok := v_n = 1 AND v_jornada = '[{"dia": 3, "inicio": "09:00", "fim": "13:00"}, {"dia": 3, "inicio": "14:00", "fim": "18:00"}]'::jsonb;
    v_res := v_res || format('%s T25 quem administra grava a jornada propria da pessoa: %s linha(s), em ordem? %s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_n, v_ok);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T25 quem administra nao gravou a jornada propria da pessoa: ' || SQLERRM);
  END;

  -- T26. A jornada própria segue as mesmas regras (cruzada, recusada).
  BEGIN
    UPDATE public.ponto_funcionarios
       SET jornada = '[{"dia": 1, "inicio": "08:00", "fim": "12:00"}, {"dia": 1, "inicio": "09:00", "fim": "10:00"}]'
     WHERE usuario_id = v_bruna;
    v_res := v_res || 'FALHOU T26 jornada propria cruzada gravada'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T26 jornada propria cruzada recusada: %s',
      CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE 'Jornada invalida: no dia 1 (segunda), os blocos 08:00-12:00 e 09:00-10:00 se cruzam%' THEN 'OK' ELSE 'FALHOU' END,
      SQLERRM);
  END;

  -- T27. Jornada própria vazia ([]) é recusada: seguir a da empresa é a nula.
  BEGIN
    UPDATE public.ponto_funcionarios SET jornada = '[]' WHERE usuario_id = v_bruna;
    v_res := v_res || 'FALHOU T27 jornada propria vazia gravada'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T27 jornada propria vazia recusada: %s',
      CASE WHEN SQLSTATE = '23514' AND SQLERRM = 'Jornada invalida: nenhum bloco. Para seguir a jornada da empresa, deixe a jornada propria vazia (nula).' THEN 'OK' ELSE 'FALHOU' END,
      SQLERRM);
  END;

  -- T28. O app guardado no celular edita a ficha sem mandar a jornada: a
  --      jornada própria fica.
  BEGIN
    UPDATE public.ponto_funcionarios SET matricula = matricula WHERE usuario_id = v_ana;
    SELECT f.jornada INTO v_jornada FROM public.ponto_funcionarios f WHERE f.usuario_id = v_ana;
    v_res := v_res || format('%s T28 editar a ficha sem a jornada mantem a jornada propria',
      CASE WHEN v_jornada IS NOT NULL AND public.ponto_jornada_carga_de_referencia(v_jornada) = 480 THEN 'OK' ELSE 'FALHOU' END);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T28 editar a ficha deu erro: ' || SQLERRM);
  END;

  -- =========================================================================
  -- QUEM BATE: LÊ A SUA, NÃO GRAVA NADA
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);

  -- T29. Quem não administra não grava a jornada da empresa: o UPDATE não acha
  --      linha e o upsert é recusado pela regra de acesso.
  UPDATE public.ponto_configuracao SET jornada = c_propria WHERE id = 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  BEGIN
    INSERT INTO public.ponto_configuracao (id, jornada) VALUES (1, c_propria)
    ON CONFLICT (id) DO UPDATE SET jornada = EXCLUDED.jornada;
    v_res := v_res || format('FALHOU T29 quem nao administra gravou a jornada da empresa (UPDATE em %s linha(s), upsert passou)', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T29 quem nao administra nao grava a jornada da empresa: UPDATE em %s linha(s); upsert recusado: %s',
      CASE WHEN v_n = 0 AND SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, v_n, SQLERRM);
  END;

  -- T30. Nem a própria jornada, nem a da outra pessoa.
  UPDATE public.ponto_funcionarios SET jornada = NULL WHERE usuario_id = v_ana;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.ponto_funcionarios SET jornada = c_semente WHERE usuario_id = v_bruna;
  GET DIAGNOSTICS v_n2 = ROW_COUNT;
  v_res := v_res || format('%s T30 quem nao administra nao grava jornada propria: a sua em %s linha(s), a da outra em %s',
    CASE WHEN v_n = 0 AND v_n2 = 0 THEN 'OK' ELSE 'FALHOU' END, v_n, v_n2);

  -- T31. Lê a jornada da empresa e a própria; a ficha da outra, não.
  SELECT c.jornada INTO v_jornada FROM public.ponto_configuracao c WHERE c.id = 1;
  v_ok := v_jornada = c_semente;
  SELECT f.jornada INTO v_jornada FROM public.ponto_funcionarios f WHERE f.usuario_id = v_ana;
  v_ok := v_ok AND public.ponto_jornada_carga_de_referencia(v_jornada) = 480;
  SELECT count(*) INTO v_n FROM public.ponto_funcionarios f WHERE f.usuario_id = v_bruna;
  v_res := v_res || format('%s T31 quem bate le a jornada da empresa e a propria (%s), e nao le a ficha da outra (%s linha(s))',
    CASE WHEN v_ok AND v_n = 0 THEN 'OK' ELSE 'FALHOU' END, coalesce(v_ok, false), v_n);

  -- T32. Quem administra tira a jornada própria (nula): a pessoa volta a
  --      seguir a da empresa.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE public.ponto_funcionarios SET jornada = NULL WHERE usuario_id = v_ana;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT count(*) INTO v_n2 FROM public.ponto_funcionarios f WHERE f.usuario_id = v_ana AND f.jornada IS NULL;
    v_res := v_res || format('%s T32 jornada propria nula = segue a da empresa: %s linha(s)',
      CASE WHEN v_n = 1 AND v_n2 = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T32 tirar a jornada propria deu erro: ' || SQLERRM);
  END;

  -- =========================================================================
  -- A CHAVE PÚBLICA (anon): NADA
  -- =========================================================================
  -- T33 e T34. anon não lê a jornada da empresa nem grava a da ficha.
  PERFORM set_config('request.jwt.claims', '', true);
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE anon;
    SELECT c.jornada INTO v_jornada FROM public.ponto_configuracao c WHERE c.id = 1;
    v_res := v_res || 'FALHOU T33 anon leu a jornada da empresa'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T33 anon nao le a jornada da empresa: %s', CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE public.ponto_funcionarios SET jornada = c_semente WHERE usuario_id = v_ana;
    v_res := v_res || 'FALHOU T34 anon gravou jornada propria'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T34 anon nao grava jornada propria: %s', CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;
  RESET ROLE;

  -- T35. E nos privilégios: nada para anon (nem pelo PUBLIC) nas colunas e nas
  --      funções novas; authenticated só nas duas puras que os CHECKs chamam.
  v_ok := NOT has_column_privilege('anon', 'public.ponto_configuracao', 'jornada', 'SELECT, INSERT, UPDATE, REFERENCES')
      AND NOT has_column_privilege('anon', 'public.ponto_configuracao', 'saldo_a_partir_de', 'SELECT, INSERT, UPDATE, REFERENCES')
      AND NOT has_column_privilege('anon', 'public.ponto_funcionarios', 'jornada', 'SELECT, INSERT, UPDATE, REFERENCES')
      AND NOT has_function_privilege('anon', 'public.ponto_jornada_problema(jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.ponto_jornada_carga_de_referencia(jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.ponto_jornada_da_carga(integer)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.ponto_jornada_conferir()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.ponto_funcionarios_guardar_propria_ficha()', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.ponto_jornada_problema(jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.ponto_jornada_carga_de_referencia(jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.ponto_jornada_da_carga(integer)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.ponto_jornada_conferir()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.ponto_funcionarios_guardar_propria_ficha()', 'EXECUTE');
  v_res := v_res || format('%s T35 anon sem privilegio nas colunas e nas funcoes da jornada; authenticated so nas duas puras',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- =========================================================================
  -- SEM OS GATILHOS, O CHECK SEGURA
  -- =========================================================================
  -- T36 a T38. Com os gatilhos da jornada desligados, os CHECKs recusam a
  --      jornada inválida (na empresa e na ficha) e a carga que não é a da
  --      jornada. Como dono das tabelas, sem sessão; religados no fim.
  BEGIN
    ALTER TABLE public.ponto_configuracao DISABLE TRIGGER trg_ponto_configuracao_jornada;
    ALTER TABLE public.ponto_funcionarios DISABLE TRIGGER trg_ponto_funcionarios_jornada;
    BEGIN
      UPDATE public.ponto_configuracao SET jornada = '[{"dia": 1, "inicio": "13:00", "fim": "12:00"}]' WHERE id = 1;
      v_res := v_res || 'FALHOU T36 sem gatilho, jornada invertida gravada na empresa'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s T36 sem gatilho, o CHECK recusa a jornada invertida da empresa (%s)',
        CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE '%ponto_configuracao_jornada_valida%' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
    END;
    BEGIN
      UPDATE public.ponto_configuracao SET carga_diaria_minutos = 300 WHERE id = 1;
      v_res := v_res || 'FALHOU T37 sem gatilho, carga diferente da jornada gravada'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s T37 sem gatilho, o CHECK recusa a carga que nao e a da jornada (%s)',
        CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE '%ponto_configuracao_carga_da_jornada%' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
    END;
    BEGIN
      UPDATE public.ponto_funcionarios SET jornada = '[]' WHERE usuario_id = v_bruna;
      v_res := v_res || 'FALHOU T38 sem gatilho, jornada propria vazia gravada'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s T38 sem gatilho, o CHECK recusa a jornada propria vazia (%s)',
        CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE '%ponto_funcionarios_jornada_valida%' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
    END;
    ALTER TABLE public.ponto_configuracao ENABLE TRIGGER trg_ponto_configuracao_jornada;
    ALTER TABLE public.ponto_funcionarios ENABLE TRIGGER trg_ponto_funcionarios_jornada;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T36 a T38 nao rodaram: ' || SQLERRM);
  END;

  -- T39. Os três gatilhos da jornada, ligados de novo; e a ordem da ficha: a
  --      jornada roda antes da trava da própria ficha (ordem alfabética do
  --      nome), que compara os blocos já em ordem.
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND ((t.tgrelid = 'public.ponto_configuracao'::regclass AND t.tgname = 'trg_ponto_configuracao_jornada')
       OR (t.tgrelid = 'public.ponto_funcionarios'::regclass AND t.tgname IN ('trg_ponto_funcionarios_jornada', 'trg_ponto_funcionarios_propria_ficha')));
  SELECT array_position(array_agg(t.tgname::text ORDER BY t.tgname COLLATE "C"), 'trg_ponto_funcionarios_jornada')
         < array_position(array_agg(t.tgname::text ORDER BY t.tgname COLLATE "C"), 'trg_ponto_funcionarios_propria_ficha')
    INTO v_ok
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.ponto_funcionarios'::regclass AND NOT t.tgisinternal;
  v_res := v_res || format('%s T39 os 3 gatilhos da jornada ligados (%s) e, na ficha, a jornada antes da trava da propria ficha (%s)',
    CASE WHEN v_n = 3 AND v_ok THEN 'OK' ELSE 'FALHOU' END, v_n, coalesce(v_ok, false));

  -- =========================================================================
  -- QUEM JÁ USAVA O PONTO: A JORNADA MONTADA DA CARGA GRAVADA
  -- =========================================================================
  -- J1 a J6. Para cada carga, a linha da configuração fica com essa carga
  -- (por uma jornada qualquer de mesmo total: um sábado das 06:00 em diante),
  -- e então roda a MESMA instrução que a migration roda na linha que já
  -- existe. A jornada esperada está escrita aqui por extenso, horário por
  -- horário; a carga tem de ficar igual, e a data do saldo, intocada.
  -- Sem sessão, como a migration.
  SELECT c.saldo_a_partir_de INTO v_data FROM public.ponto_configuracao c WHERE c.id = 1;
  FOR v_caso IN
    SELECT * FROM (VALUES
      ('J1 carga de 3 h',    180, '08:00', '11:00', NULL,    NULL),
      ('J2 carga de 4 h',    240, '08:00', '12:00', NULL,    NULL),
      ('J3 carga de 6 h',    360, '08:00', '12:00', '13:00', '15:00'),
      ('J4 carga de 8 h',    480, '08:00', '12:00', '13:00', '17:00'),
      ('J5 carga de 8h48',   528, '08:00', '12:00', '13:00', '17:48'),
      ('J6 carga de 12 h',   720, '08:00', '12:00', '13:00', '21:00')
    ) AS c(rotulo, carga, manha_inicio, manha_fim, tarde_inicio, tarde_fim)
  LOOP
    BEGIN
      SELECT jsonb_agg(b.bloco ORDER BY (b.bloco ->> 'dia')::integer, b.bloco ->> 'inicio') INTO v_esperada
        FROM (SELECT jsonb_build_object('dia', d, 'inicio', v_caso.manha_inicio, 'fim', v_caso.manha_fim) AS bloco
                FROM generate_series(1, 5) AS d
              UNION ALL
              SELECT jsonb_build_object('dia', d, 'inicio', v_caso.tarde_inicio, 'fim', v_caso.tarde_fim)
                FROM generate_series(1, 5) AS d
               WHERE v_caso.tarde_inicio IS NOT NULL) AS b;

      UPDATE public.ponto_configuracao
         SET jornada = jsonb_build_array(jsonb_build_object('dia', 6, 'inicio', '06:00', 'fim',
                         lpad(((360 + v_caso.carga) / 60)::text, 2, '0') || ':' || lpad(((360 + v_caso.carga) % 60)::text, 2, '0')))
       WHERE id = 1
      RETURNING carga_diaria_minutos INTO v_carga;
      IF v_carga IS DISTINCT FROM v_caso.carga THEN
        RAISE EXCEPTION 'a linha nao ficou com a carga de % min antes da conversao (ficou %)', v_caso.carga, v_carga;
      END IF;

      -- A instrução da migration (passo 4), sem tirar nem pôr.
      UPDATE public.ponto_configuracao
         SET jornada = public.ponto_jornada_da_carga(carga_diaria_minutos)
       WHERE id = 1;

      SELECT c.jornada, c.carga_diaria_minutos, c.saldo_a_partir_de INTO v_jornada, v_carga, v_data2
        FROM public.ponto_configuracao c WHERE c.id = 1;
      v_ok := v_jornada = v_esperada AND v_carga = v_caso.carga
          AND public.ponto_jornada_problema(v_jornada) IS NULL AND v_data2 = v_data;
      v_res := v_res || format('%s %s (%s min): seg a sex, %s-%s%s; carga %s min; data do saldo intocada? %s',
        CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_caso.rotulo, v_caso.carga, v_caso.manha_inicio, v_caso.manha_fim,
        CASE WHEN v_caso.tarde_inicio IS NULL THEN ', um bloco so' ELSE format(' e %s-%s', v_caso.tarde_inicio, v_caso.tarde_fim) END,
        v_carga, v_data2 = v_data);
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('FALHOU %s: %s', v_caso.rotulo, SQLERRM);
    END;
  END LOOP;

  -- J7. Fora da faixa da carga (60 a 720), e sem carga, não há jornada.
  v_ok := public.ponto_jornada_da_carga(59) IS NULL AND public.ponto_jornada_da_carga(721) IS NULL
      AND public.ponto_jornada_da_carga(NULL) IS NULL AND public.ponto_jornada_da_carga(60) IS NOT NULL;
  v_res := v_res || format('%s J7 carga fora da faixa (59, 721, nula) nao vira jornada; 60 vira',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  UPDATE public.ponto_configuracao SET jornada = c_semente WHERE id = 1;

  -- =========================================================================
  -- O INÍCIO DO SALDO ("SALDO CALCULADO A PARTIR DE")
  -- =========================================================================
  -- S1. A linha que já existe tem a data. O padrão da coluna é o dia de hoje
  --     em Brasília, e o ADD COLUMN da migration o gravou na linha que já
  --     existia; a linha que nasceu aqui, sem sessão, pegou o mesmo padrão.
  EXECUTE 'SELECT ' || (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                         WHERE d.adrelid = 'public.ponto_configuracao'::regclass AND a.attname = 'saldo_a_partir_de')
    INTO v_data2;
  v_ok := v_data2 = v_hoje AND v_saldo_antes IS NOT NULL
      AND CASE WHEN v_tinha_linha THEN v_saldo_antes <= v_hoje ELSE v_saldo_antes = v_hoje END;
  v_res := v_res || format('%s S1 a linha que ja existe (%s) tem a data do saldo, %s; o padrao da coluna e hoje em Brasilia? %s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN v_tinha_linha THEN 'a da instalacao' ELSE 'criada pelo teste, sem sessao' END,
    CASE WHEN v_saldo_antes = v_hoje THEN 'hoje' WHEN v_saldo_antes < v_hoje THEN 'antes de hoje' ELSE 'depois de hoje' END,
    v_data2 = v_hoje);

  -- S2. A linha nova, pela tela: a primeira gravação de quem administra (o
  --     upsert de salvarEmpresa) cria a linha com a jornada semente, a carga
  --     de 480 min e o saldo a partir de hoje. Num bloco que sempre volta
  --     atrás: a linha apagada aqui volta no fim dele.
  v_erro := NULL;
  v_jornada := NULL;
  v_carga := NULL;
  v_data2 := NULL;
  BEGIN
    DELETE FROM public.ponto_configuracao WHERE id = 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.ponto_configuracao (id, razao_social) VALUES (1, 'Empresa Exemplo Ltda')
    ON CONFLICT (id) DO UPDATE SET razao_social = EXCLUDED.razao_social
    RETURNING jornada, carga_diaria_minutos, saldo_a_partir_de INTO v_jornada, v_carga, v_data2;
    RAISE EXCEPTION 'desfazer a linha nova do S2' USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN NULL;
    WHEN OTHERS THEN v_erro := SQLERRM;
  END;
  SELECT c.saldo_a_partir_de INTO v_data FROM public.ponto_configuracao c WHERE c.id = 1;
  v_ok := v_erro IS NULL AND v_jornada = c_semente AND v_carga = 480 AND v_data2 = v_hoje
      AND current_user = 'postgres' AND v_data = v_saldo_antes;
  v_res := v_res || format('%s S2 a linha nova, pela tela: jornada semente? %s, carga %s min, saldo a partir de hoje? %s; a linha de antes voltou? %s%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_jornada = c_semente, v_carga, v_data2 = v_hoje, v_data = v_saldo_antes,
    CASE WHEN v_erro IS NULL THEN '' ELSE ': ' || v_erro END);

  -- S3. Quem administra recua a data para o começo do mês passado; a jornada
  --     e a carga não mudam.
  -- Em timestamp sem fuso: a conta do mês não depende do fuso da sessão.
  v_data := date_trunc('month', v_hoje::timestamp - interval '1 month')::date;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ponto_configuracao SET saldo_a_partir_de = v_data WHERE id = 1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT c.saldo_a_partir_de, c.jornada, c.carga_diaria_minutos INTO v_data2, v_jornada, v_carga
      FROM public.ponto_configuracao c WHERE c.id = 1;
    v_res := v_res || format('%s S3 quem administra recua o saldo para o comeco do mes passado: %s linha(s), data gravada? %s, jornada e carga iguais? %s',
      CASE WHEN v_n = 1 AND v_data2 = v_data AND v_jornada = c_semente AND v_carga = 480 THEN 'OK' ELSE 'FALHOU' END,
      v_n, v_data2 = v_data, v_jornada = c_semente AND v_carga = 480);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU S3 quem administra nao recuou a data do saldo: ' || SQLERRM);
  END;

  -- S4. Quem bate não muda a data: o UPDATE não acha linha.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  UPDATE public.ponto_configuracao SET saldo_a_partir_de = v_hoje - 3650 WHERE id = 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_res := v_res || format('%s S4 quem nao administra nao muda a data do saldo: %s linha(s)',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- S5. O app guardado no celular (salvarJornada), que não conhece a data,
  --     grava a configuração e a data recuada fica.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.ponto_configuracao (id, carga_diaria_minutos, tolerancia_minutos, janela_duplicidade_segundos)
    VALUES (1, 360, 10, 60)
    ON CONFLICT (id) DO UPDATE SET carga_diaria_minutos = EXCLUDED.carga_diaria_minutos,
                                   tolerancia_minutos = EXCLUDED.tolerancia_minutos,
                                   janela_duplicidade_segundos = EXCLUDED.janela_duplicidade_segundos
    RETURNING saldo_a_partir_de, carga_diaria_minutos INTO v_data2, v_carga;
    v_res := v_res || format('%s S5 o app guardado no celular grava a configuracao e a data do saldo fica (%s), carga %s min',
      CASE WHEN v_data2 = v_data AND v_carga = 480 THEN 'OK' ELSE 'FALHOU' END,
      CASE WHEN v_data2 = v_data THEN 'a recuada' ELSE 'mudou' END, v_carga);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU S5 o app guardado no celular nao grava a configuracao: ' || SQLERRM);
  END;

  -- S6. A data nula é recusada: o saldo sempre tem um começo.
  BEGIN
    UPDATE public.ponto_configuracao SET saldo_a_partir_de = NULL WHERE id = 1;
    v_res := v_res || 'FALHOU S6 data do saldo nula gravada'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s S6 data do saldo nula recusada (%s)', CASE WHEN SQLSTATE = '23502' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- =========================================================================
  -- A TRAVA DA PRÓPRIA FICHA
  -- =========================================================================
  -- A ficha do Sérgio nasce sem conta, pelo RH (sem sessão aqui), já com a
  -- data em que ele passou a bater ponto.
  PERFORM set_config('request.jwt.claims', '', true);
  RESET ROLE;
  INSERT INTO public.ponto_funcionarios (nome_completo, cargo, bate_ponto_desde)
  VALUES ('Sérgio Almeida', 'Diretoria', v_hoje - 400)
  RETURNING id INTO v_ficha_serg;

  -- Quem administra (a Rita), na própria ficha.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- P1 e P2. Nem a jornada própria, nem a data.
  BEGIN
    UPDATE public.ponto_funcionarios SET jornada = c_propria WHERE id = v_ficha_rita;
    v_res := v_res || 'FALHOU P1 quem administra mudou a propria jornada'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P1 quem administra nao muda a propria jornada: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_muda THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;
  BEGIN
    UPDATE public.ponto_funcionarios SET bate_ponto_desde = v_hoje - 3650 WHERE id = v_ficha_rita;
    v_res := v_res || 'FALHOU P2 quem administra mudou a propria data de inicio'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P2 quem administra nao muda a propria data de inicio: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_muda THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- P3. O resto da própria ficha continua dela: a tela manda a ficha inteira
  --     de volta, com a jornada e a data iguais, e isso não é mudança.
  BEGIN
    UPDATE public.ponto_funcionarios
       SET cargo = 'Recursos Humanos', jornada = jornada, bate_ponto_desde = bate_ponto_desde
     WHERE id = v_ficha_rita;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT count(*) INTO v_n2 FROM public.ponto_funcionarios f
     WHERE f.id = v_ficha_rita AND f.cargo = 'Recursos Humanos' AND f.jornada IS NULL AND f.bate_ponto_desde = v_hoje - 200;
    v_res := v_res || format('%s P3 quem administra edita o resto da propria ficha, mandando a jornada e a data iguais: %s linha(s)',
      CASE WHEN v_n = 1 AND v_n2 = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P3 editar o resto da propria ficha foi recusado: ' || SQLERRM);
  END;

  -- P4. Desligar a própria ficha da conta não abre a porta: a mudança no
  --     mesmo comando é recusada.
  BEGIN
    UPDATE public.ponto_funcionarios SET usuario_id = NULL, bate_ponto_desde = v_hoje - 3650 WHERE id = v_ficha_rita;
    v_res := v_res || 'FALHOU P4 desligou a propria ficha e mudou a data no mesmo comando'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P4 desligar a propria ficha e mudar a data no mesmo comando e recusado: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_muda THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- P5. A ficha da outra pessoa continua editável: a jornada e a data da Ana.
  BEGIN
    UPDATE public.ponto_funcionarios SET jornada = c_propria, bate_ponto_desde = v_hoje - 30 WHERE usuario_id = v_ana;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT count(*) INTO v_n2 FROM public.ponto_funcionarios f
     WHERE f.usuario_id = v_ana AND f.bate_ponto_desde = v_hoje - 30 AND public.ponto_jornada_carga_de_referencia(f.jornada) = 480;
    v_res := v_res || format('%s P5 quem administra grava a jornada e a data da ficha de outra pessoa: %s linha(s)',
      CASE WHEN v_n = 1 AND v_n2 = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P5 a ficha de outra pessoa foi recusada: ' || SQLERRM);
  END;

  -- P6. E a jornada da empresa continua de quem administra, mesmo com ficha.
  BEGIN
    UPDATE public.ponto_configuracao
       SET jornada = '[{"dia": 1, "inicio": "09:00", "fim": "18:00"}]'
     WHERE id = 1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE public.ponto_configuracao SET jornada = c_semente WHERE id = 1;
    GET DIAGNOSTICS v_n2 = ROW_COUNT;
    v_res := v_res || format('%s P6 a jornada da empresa continua editavel por quem administra e tem ficha: %s e %s linha(s)',
      CASE WHEN v_n = 1 AND v_n2 = 1 THEN 'OK' ELSE 'FALHOU' END, v_n, v_n2);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P6 a jornada da empresa foi recusada a quem administra: ' || SQLERRM);
  END;

  -- O super admin (o Sérgio), que começa sem ficha.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);

  -- P7. Criar a própria ficha já com a data: recusado.
  BEGIN
    INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo, bate_ponto_desde)
    VALUES (v_sergio, 'Sérgio Almeida', 'Diretoria', v_hoje - 400);
    v_res := v_res || 'FALHOU P7 o super admin criou a propria ficha com a data de inicio'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P7 o super admin nao cria a propria ficha com a data de inicio: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_liga THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- P8. Ligar a si a ficha sem conta que já tem a data: recusado (senão
  --     bastaria preparar a ficha sem conta e ligá-la depois).
  BEGIN
    UPDATE public.ponto_funcionarios SET usuario_id = v_sergio WHERE id = v_ficha_serg AND usuario_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_res := v_res || format('FALHOU P8 o super admin ligou a si a ficha com a data de inicio (%s linha(s))', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P8 o super admin nao liga a si a ficha que ja tem a data de inicio: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_liga THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- P9. O caminho que vale: o RH tira a data da ficha sem conta (ela não é de
  --     ninguém), o super admin a liga a si, e o RH grava a data e a jornada
  --     própria dele.
  v_erro := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
    UPDATE public.ponto_funcionarios SET bate_ponto_desde = NULL WHERE id = v_ficha_serg;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
    UPDATE public.ponto_funcionarios SET usuario_id = v_sergio WHERE id = v_ficha_serg AND usuario_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
    UPDATE public.ponto_funcionarios SET bate_ponto_desde = v_hoje - 400, jornada = c_semente WHERE id = v_ficha_serg;
    GET DIAGNOSTICS v_n2 = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
  END;
  SELECT count(*) INTO v_n FROM public.ponto_funcionarios f
   WHERE f.id = v_ficha_serg AND f.usuario_id = v_sergio AND f.bate_ponto_desde = v_hoje - 400 AND f.jornada = c_semente;
  v_res := v_res || format('%s P9 o RH tira a data, o super admin liga a ficha a si e o RH grava a data e a jornada dele%s',
    CASE WHEN v_erro IS NULL AND v_n = 1 AND v_n2 = 1 THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN v_erro IS NULL THEN '' ELSE ': ' || v_erro END);

  -- P10 e P11. Ligada, a ficha do super admin também é dele: nem a jornada
  --     própria, nem a data.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE public.ponto_funcionarios SET jornada = '[{"dia": 1, "inicio": "08:00", "fim": "09:00"}]' WHERE id = v_ficha_serg;
    v_res := v_res || 'FALHOU P10 o super admin mudou a propria jornada'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P10 o super admin nao muda a propria jornada: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_muda THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;
  BEGIN
    UPDATE public.ponto_funcionarios SET bate_ponto_desde = v_hoje WHERE id = v_ficha_serg;
    v_res := v_res || 'FALHOU P11 o super admin mudou a propria data de inicio'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P11 o super admin nao muda a propria data de inicio: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_muda THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- P12. A ficha dos outros, o super admin edita: a jornada e a data da Rita.
  BEGIN
    UPDATE public.ponto_funcionarios SET jornada = c_propria, bate_ponto_desde = v_hoje - 100 WHERE id = v_ficha_rita;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT count(*) INTO v_n2 FROM public.ponto_funcionarios f
     WHERE f.id = v_ficha_rita AND f.bate_ponto_desde = v_hoje - 100 AND f.jornada IS NOT NULL;
    v_res := v_res || format('%s P12 o super admin grava a jornada e a data da ficha de outra pessoa: %s linha(s)',
      CASE WHEN v_n = 1 AND v_n2 = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P12 o super admin nao editou a ficha de outra pessoa: ' || SQLERRM);
  END;

  -- P13. Sem sessão (a migration, o backend sem o token de ninguém), a regra
  --      não se aplica: não há dono de ficha nenhuma do outro lado.
  PERFORM set_config('request.jwt.claims', '', true);
  RESET ROLE;
  BEGIN
    UPDATE public.ponto_funcionarios SET jornada = NULL, bate_ponto_desde = v_hoje - 200 WHERE id = v_ficha_rita;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_res := v_res || format('%s P13 sem sessao, a ficha muda: %s linha(s)', CASE WHEN v_n = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P13 sem sessao, a ficha foi recusada: ' || SQLERRM);
  END;

  -- P14. O upsert (INSERT ... ON CONFLICT DO UPDATE) não contorna a trava: o
  --      INSERT do upsert passa pelos gatilhos com a linha proposta, e o
  --      UPDATE do conflito, com a ficha que já existe. Quem administra, na
  --      própria ficha, pelo id (a linha proposta sem a conta, para o conflito
  --      cair no UPDATE): (a) a jornada no SET; (b) a data pelo EXCLUDED. O
  --      super admin, pela conta (a linha proposta já ligada a ele): (c) a
  --      data e a jornada no SET; (d) a data na própria linha proposta. No
  --      fim, as duas fichas continuam como estavam.
  v_ok := true;
  v_erro := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ponto_funcionarios (id, nome_completo, cargo) VALUES (v_ficha_rita, 'Rita Moraes', 'RH')
    ON CONFLICT (id) DO UPDATE SET jornada = c_propria;
    v_ok := false;
    v_erro := concat_ws(' / ', v_erro, '(a) passou');
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND SQLSTATE = '42501' AND SQLERRM = c_dono_muda;
    v_erro := concat_ws(' / ', v_erro, '(a) ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO public.ponto_funcionarios (id, nome_completo, cargo, bate_ponto_desde) VALUES (v_ficha_rita, 'Rita Moraes', 'RH', v_hoje - 3650)
    ON CONFLICT (id) DO UPDATE SET bate_ponto_desde = EXCLUDED.bate_ponto_desde;
    v_ok := false;
    v_erro := concat_ws(' / ', v_erro, '(b) passou');
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND SQLSTATE = '42501' AND SQLERRM = c_dono_muda;
    v_erro := concat_ws(' / ', v_erro, '(b) ' || SQLERRM);
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo) VALUES (v_sergio, 'Sérgio Almeida', 'Diretoria')
    ON CONFLICT (usuario_id) WHERE usuario_id IS NOT NULL
    DO UPDATE SET bate_ponto_desde = v_hoje, jornada = '[{"dia": 1, "inicio": "08:00", "fim": "09:00"}]';
    v_ok := false;
    v_erro := concat_ws(' / ', v_erro, '(c) passou');
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND SQLSTATE = '42501' AND SQLERRM = c_dono_muda;
    v_erro := concat_ws(' / ', v_erro, '(c) ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo, bate_ponto_desde) VALUES (v_sergio, 'Sérgio Almeida', 'Diretoria', v_hoje)
    ON CONFLICT (usuario_id) WHERE usuario_id IS NOT NULL
    DO UPDATE SET bate_ponto_desde = EXCLUDED.bate_ponto_desde;
    v_ok := false;
    v_erro := concat_ws(' / ', v_erro, '(d) passou');
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND SQLSTATE = '42501' AND SQLERRM = c_dono_liga;
    v_erro := concat_ws(' / ', v_erro, '(d) ' || SQLERRM);
  END;
  SELECT count(*) FILTER (WHERE f.id = v_ficha_rita AND f.usuario_id = v_rita AND f.jornada IS NULL AND f.bate_ponto_desde = v_hoje - 200),
         count(*) FILTER (WHERE f.id = v_ficha_serg AND f.usuario_id = v_sergio AND f.jornada = c_semente AND f.bate_ponto_desde = v_hoje - 400)
    INTO v_n, v_n2
    FROM public.ponto_funcionarios f WHERE f.id IN (v_ficha_rita, v_ficha_serg);
  v_res := v_res || format('%s P14 o upsert na propria ficha, mudando a jornada ou a data, e recusado (quem administra e super admin), e as fichas ficam como estavam (%s e %s): %s',
    CASE WHEN v_ok AND v_n = 1 AND v_n2 = 1 THEN 'OK' ELSE 'FALHOU' END, v_n, v_n2, v_erro);
  PERFORM set_config('request.jwt.claims', '', true);
  RESET ROLE;

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
