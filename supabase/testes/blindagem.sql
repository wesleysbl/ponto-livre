-- TESTE DE BANCO — A BLINDAGEM DA BATIDA
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- blindagem.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve, mede e DESFAZ no
-- fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma linha por
-- caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco `$conferir$`
-- (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA: batida não se apaga (o app não tem DELETE nem TRUNCATE),
-- correção exige motivo próprio e deixa trilha, a marca de ajuste não se
-- desliga, o canal do sistema não se forja por sessão de usuário e não mexe no
-- horário, a coordenada corrigida refaz distância e marca (a localização nunca
-- bloqueia), a selfie de batida não se descarta (a foto é evidência), o
-- horário da batida pelo app é o do servidor e o tipo sai da ordem do dia, e o
-- bloqueio do PIN. E a batida SEM LOCALIZAÇÃO (T19 e T20): sem coordenada e sem
-- motivo (o app que não manda o parâmetro), com o motivo da permissão negada e
-- com meia coordenada, a recusa de sempre, antes do PIN; com o GPS
-- indisponível, a batida sai pelo app, com selfie e PIN, sem coordenada,
-- precisão, distância, marca e local. Quem bate sem localização é OUTRA pessoa
-- (a do T15 já bateu nesta transação, e a janela de duplicidade recusaria).
--
-- E AS GARANTIAS DE SEGURANÇA DA BATIDA (T21 a T31):
--   • o INSERT direto de uma sessão é sempre lançamento de quem administra
--     (T21 a T24): sem horário ou sem motivo é recusado, com frase própria; a
--     origem e a marca de ajuste são do banco, mesmo que o INSERT mande
--     outras; quem não administra não lança. A origem 'app' só nasce pela RPC
--     (T15);
--   • quem é dono da batida não lança nem corrige o próprio ponto, nem o super
--     admin, que corrige o dos outros (T25 a T27);
--   • a correção não troca a origem da batida (T28);
--   • a selfie com menos de 16 minutos não se apaga, nem pela dona nem por quem
--     administra, porque uma batida pode estar sendo gravada com ela (T29 e
--     T30);
--   • o bloqueio do PIN endurece no mesmo dia: 15 minutos, 1 hora, 24 horas; o
--     reset do PIN e o dia seguinte zeram a conta (T17 e T31).
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. O "caminho do
-- sistema" (T8 a T10) roda como ele: como dentro de uma função DEFINER do
-- ponto, não é `authenticated` nem `anon`, então vale como sistema.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto; fichas, PIN e a lista de administração gravados
-- sem sessão, como a instalação os gravaria. O nome de cada conta mora em
-- `raw_app_meta_data` (só a chave de serviço grava ali), como a função de
-- contas o guarda. Quem corrige o ponto é a Rita, do RH, que administra, NÃO é
-- super admin e tem ficha (bate ponto); o Sérgio é o super admin, e o Gustavo
-- recebe as batidas que a Rita lança (T21 a T23). As batidas de partida (a da Ana, a da
-- Bruna, a da Rita e a do Sérgio) nascem sem sessão e sem horário: o carimbo dá
-- o horário do servidor e a origem app, como numa batida do aplicativo. Num
-- banco que já tem dados, o teste usa o local ativo que houver e não depende
-- de mais nada dele.
--
-- O QUE ELE NÃO TEM, DE PROPÓSITO: nenhum DELETE de batida e nenhum TRUNCATE.
-- Os dois caminhos são provados aqui pelos privilégios (T11). O único DELETE é
-- o das selfies (T29 e T30), feito como a API do storage o faz
-- (`storage.allow_delete_query` ligado), e desfeito no mesmo bloco.
--
-- SESSÃO FORJADA, como o PostgREST faz por requisição: o JWT vai em
-- `request.jwt.claims` com `sub` e `role`, e o papel muda com
-- `SET LOCAL ROLE authenticated` — fora dos blocos com EXCEPTION. A trilha é
-- sempre contada por DIFERENÇA (antes/depois) ou presa a um motivo do próprio
-- teste, nunca por total fixo.
--
-- O QUE A TRANSAÇÃO DESFEITA NÃO DESFAZ: a sequência de ponto_pin_tentativas
-- (sequência do Postgres não volta no ROLLBACK). T15, T17, T18, T20 e T31
-- contam tentativas de PIN: o próximo id fica maior, nenhuma linha fica.

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
  c_pin      constant text := '4321';
  c_fuso     constant text := 'America/Sao_Paulo';
  v_res      text[] := '{}';
  -- As pessoas (elenco fictício).
  v_rita     uuid := gen_random_uuid();   -- RH: administra, não é super admin, tem ficha (T24 e T25)
  v_ana      uuid := gen_random_uuid();   -- dona da batida 1, corrigida pelo RH
  v_bruna    uuid := gen_random_uuid();   -- dona da batida 2 (canal do sistema) e da batida esquecida
  v_caio     uuid := gen_random_uuid();   -- bate pelo app, com PIN (T15 a T19, T30)
  v_daniela  uuid := gen_random_uuid();   -- bate sem localização (T20)
  v_sergio   uuid := gen_random_uuid();   -- super admin, com uma batida (T26)
  v_gustavo  uuid := gen_random_uuid();   -- recebe as batidas que a Rita lança (T21 a T23)
  v_mes      text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY/MM');
  v_local    public.ponto_local%ROWTYPE;
  v_lat_fora double precision;
  v_cam_r1   text;
  v_cam_solta text;
  v_cam_velha text;
  v_cam_velha2 text;
  v_r1       public.ponto_registros%ROWTYPE;
  v_r2       public.ponto_registros%ROWTYPE;
  v_r_rita   public.ponto_registros%ROWTYPE;
  v_r_sergio public.ponto_registros%ROWTYPE;
  v_r_gustavo public.ponto_registros%ROWTYPE;
  v_depois   public.ponto_registros%ROWTYPE;
  v_corr     public.ponto_correcoes%ROWTYPE;
  v_n        bigint;
  v_m        bigint;
  v_antes    bigint;
  v_trilha_antes bigint;
  v_id       uuid;
  v_caminho  text;
  v_resp     jsonb;
  v_ok       boolean;
  v_t        text;
  v_t2       text;
  v_t3       text;
  v_apagadas text[];
  v_t19      text[] := '{}';
BEGIN
  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria).
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_rita,    'authenticated', 'authenticated', 'rita.teste@example.invalid',    '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,     'authenticated', 'authenticated', 'ana.teste@example.invalid',     '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_bruna,   'authenticated', 'authenticated', 'bruna.teste@example.invalid',   '{}', '{"full_name": "Bruna Costa"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_caio,    'authenticated', 'authenticated', 'caio.teste@example.invalid',    '{}', '{"full_name": "Caio Mendes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_daniela, 'authenticated', 'authenticated', 'daniela.teste@example.invalid', '{}', '{"full_name": "Daniela Freitas"}',   now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_sergio,  'authenticated', 'authenticated', 'sergio.teste@example.invalid',  '{}', '{"full_name": "Sérgio Almeida"}',    now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_gustavo, 'authenticated', 'authenticated', 'gustavo.teste@example.invalid', '{}', '{"full_name": "Gustavo Ramos"}',     now(), now());
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: o RH corrige o ponto');
  INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_sergio, 'teste do banco: super admin');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
  VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas'),
         (v_bruna, 'Bruna Costa', 'Compras'),
         (v_caio, 'Caio Mendes', 'Operações'),
         (v_daniela, 'Daniela Freitas', 'Administrativo'),
         (v_rita, 'Rita Moraes', 'RH'),
         (v_gustavo, 'Gustavo Ramos', 'Logística');
  INSERT INTO public.ponto_pin (usuario_id, pin_hash)
  SELECT u, extensions.crypt(c_pin, extensions.gen_salt('bf')) FROM unnest(ARRAY[v_caio, v_daniela]) u;

  -- O local: o ativo da instalação, se houver; senão, um sintético.
  SELECT * INTO v_local FROM public.ponto_local WHERE ativo ORDER BY criado_em LIMIT 1;
  IF v_local.id IS NULL THEN
    INSERT INTO public.ponto_local (nome, latitude, longitude, raio_metros)
    VALUES ('Sede da Empresa Exemplo', -23.550520, -46.633308, 150)
    RETURNING * INTO v_local;
  END IF;
  -- Um ponto bem fora do raio, qualquer que seja o local: duas vezes o raio e
  -- mais 1 km na direção do equador (1 grau de latitude ~ 111,32 km).
  v_lat_fora := v_local.latitude - sign(v_local.latitude) * (2 * v_local.raio_metros + 1000) / 111320.0;
  IF v_local.latitude = 0 THEN
    v_lat_fora := (2 * v_local.raio_metros + 1000) / 111320.0;
  END IF;

  -- A batida 1 (da Ana): do app, longe do local, com a selfie no bucket (só a
  -- linha do índice; nenhum arquivo sobe). E uma foto solta da Ana, que nunca
  -- virou batida, para o T12 ter o que o dono PODE descartar.
  v_id := gen_random_uuid();
  v_cam_r1 := v_ana::text || '/' || v_mes || '/' || v_id::text || '.jpg';
  v_cam_solta := v_ana::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg';
  -- E duas fotos soltas da Ana enviadas há 17 minutos, que nenhuma RPC aceita
  -- mais (T28 e T29).
  v_cam_velha := v_ana::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg';
  v_cam_velha2 := v_ana::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_cam_r1, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1)),
         ('ponto-selfies', v_cam_solta, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata, created_at)
  VALUES ('ponto-selfies', v_cam_velha, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1), now() - interval '17 minutes'),
         ('ponto-selfies', v_cam_velha2, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1), now() - interval '17 minutes');
  INSERT INTO public.ponto_registros (id, usuario_id, latitude, longitude, precisao_metros, selfie_path)
  VALUES (v_id, v_ana, v_lat_fora, v_local.longitude, 12, v_cam_r1)
  RETURNING * INTO v_r1;
  -- A batida 2 (da Bruna): do app, sem coordenada.
  INSERT INTO public.ponto_registros (usuario_id) VALUES (v_bruna) RETURNING * INTO v_r2;
  -- A da Rita e a do Sérgio (T25 e T26), do mesmo jeito.
  INSERT INTO public.ponto_registros (usuario_id) VALUES (v_rita) RETURNING * INTO v_r_rita;
  INSERT INTO public.ponto_registros (usuario_id) VALUES (v_sergio) RETURNING * INTO v_r_sergio;

  IF v_r1.origem <> 'app' OR v_r1.ajuste_manual OR v_r1.no_local IS DISTINCT FROM false
     OR v_r2.origem <> 'app' OR v_r2.ajuste_manual
     OR v_r_rita.origem <> 'app' OR v_r_sergio.origem <> 'app' THEN
    RAISE EXCEPTION 'As batidas de partida nao nasceram como batidas do app longe e sem coordenada: %, %',
      row_to_json(v_r1)::jsonb - 'funcionario_email', row_to_json(v_r2)::jsonb - 'funcionario_email';
  END IF;

  -- T13 (antes). A trilha da dona da batida 1 ANTES de qualquer teste, lida
  -- como o T13 a lê: na sessão dela, pela RLS. É a base da diferença do T13.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_trilha_antes FROM public.ponto_correcoes WHERE usuario_id = v_ana;
  RESET ROLE;

  -- =========================================================================
  -- CAMINHO DO ADMIN, COM SESSÃO DE USUÁRIO (o que o app faz)
  -- =========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T1. corrigirHorario: UPDATE de registrado_em + motivo_ajuste (um minuto
  --     para trás: a batida é de agora, e um minuto à frente encostaria na
  --     tolerância da trava de futuro).
  UPDATE public.ponto_registros
     SET registrado_em = v_r1.registrado_em - interval '1 minute',
         motivo_ajuste = 'teste do banco - horario'
   WHERE id = v_r1.id;
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_r1.id;
  SELECT * INTO v_corr FROM public.ponto_correcoes WHERE registro_id = v_r1.id ORDER BY criado_em DESC LIMIT 1;
  v_ok := v_depois.ajuste_manual AND v_corr.natureza = 'admin' AND v_corr.campos[1] = 'registrado_em'
          AND v_corr.autor_id = v_rita AND v_corr.motivo = 'teste do banco - horario'
          AND (v_corr.valores_antes ->> 'registrado_em')::timestamptz = v_r1.registrado_em
          AND v_depois.dia_civil = (v_depois.registrado_em AT TIME ZONE c_fuso)::date;
  v_res := v_res || format('%s T1 corrigir horario: ajuste_manual=%s natureza=%s campos=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_depois.ajuste_manual, v_corr.natureza, v_corr.campos);

  -- T2. Motivo repetido continua recusado, com a mesma frase.
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = v_r1.registrado_em - interval '2 minutes',
           motivo_ajuste = 'teste do banco - horario'
     WHERE id = v_r1.id;
    v_res := v_res || 'FALHOU T2 motivo repetido foi aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T2 motivo repetido recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Motivo repetido:%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 40));
  END;

  -- T3. Sem motivo continua recusado, com a mesma frase.
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = v_r2.registrado_em - interval '1 minute'
     WHERE id = v_r2.id;
    v_res := v_res || 'FALHOU T3 correcao sem motivo foi aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T3 sem motivo recusado (%s)',
      CASE WHEN SQLERRM = 'Correcao de ponto exige motivo' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- T4. Corrigir a coordenada recalcula distância, marca e local.
  UPDATE public.ponto_registros
     SET latitude = v_local.latitude, longitude = v_local.longitude,
         motivo_ajuste = 'teste do banco - coordenada'
   WHERE id = v_r1.id;
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_r1.id;
  SELECT * INTO v_corr FROM public.ponto_correcoes WHERE registro_id = v_r1.id ORDER BY criado_em DESC LIMIT 1;
  v_ok := v_depois.distancia_metros = 0 AND v_depois.no_local AND v_depois.local_id = v_local.id
          AND 'coordenada' = ANY (v_corr.campos) AND v_corr.natureza = 'admin'
          AND 'distancia_metros' = ANY (v_corr.campos) AND 'no_local' = ANY (v_corr.campos);
  v_res := v_res || format('%s T4 coordenada: distancia %s -> %s, no_local %s -> %s, campos=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END,
    v_r1.distancia_metros, v_depois.distancia_metros, v_r1.no_local, v_depois.no_local, v_corr.campos);

  -- T5. Admin com sessão de usuário que abre o canal à mão NÃO vira sistema.
  PERFORM set_config('ponto.operacao_do_sistema', 'forjado pelo admin', true);
  UPDATE public.ponto_registros
     SET ordem_no_dia = v_r1.ordem_no_dia + 50,
         motivo_ajuste = 'teste do banco - canal forjado'
   WHERE id = v_r1.id;
  PERFORM set_config('ponto.operacao_do_sistema', '', true);
  SELECT * INTO v_corr FROM public.ponto_correcoes WHERE registro_id = v_r1.id ORDER BY criado_em DESC LIMIT 1;
  v_ok := v_corr.natureza = 'admin' AND v_corr.motivo = 'teste do banco - canal forjado'
          AND v_corr.campos = ARRAY['ordem_no_dia'];
  v_res := v_res || format('%s T5 canal forjado por sessao de usuario: natureza=%s motivo=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_corr.natureza, v_corr.motivo);

  -- T6. ajuste_manual não volta para false, e isso não gera trilha.
  SELECT count(*) INTO v_antes FROM public.ponto_correcoes WHERE registro_id = v_r1.id;
  UPDATE public.ponto_registros SET ajuste_manual = false WHERE id = v_r1.id;
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_r1.id;
  SELECT count(*) INTO v_n FROM public.ponto_correcoes WHERE registro_id = v_r1.id;
  v_res := v_res || format('%s T6 ajuste_manual continua %s; trilha %s -> %s',
    CASE WHEN v_depois.ajuste_manual AND v_n = v_antes THEN 'OK' ELSE 'FALHOU' END,
    v_depois.ajuste_manual, v_antes, v_n);

  -- T7. O admin lê a trilha de apagamentos sem erro.
  SELECT count(*) INTO v_n FROM public.ponto_registros_apagados;
  v_res := v_res || format('OK T7 admin le ponto_registros_apagados: %s linha(s)', v_n);

  RESET ROLE;

  -- =========================================================================
  -- CAMINHO DO SISTEMA (como uma função DEFINER do ponto chamada pelo admin)
  -- =========================================================================
  -- auth.uid() continua sendo a Rita (a sessão é dela); quem executa o UPDATE
  -- é o postgres, que não é sessão de usuário.
  PERFORM public.ponto_abrir_operacao_do_sistema('teste do banco - reordenar');

  -- T8. Reordenar: trilha 'sistema', sem ajuste manual, motivo da batida intacto.
  UPDATE public.ponto_registros
     SET tipo = 'extra', ordem_no_dia = v_r2.ordem_no_dia + 50
   WHERE id = v_r2.id;
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_r2.id;
  SELECT * INTO v_corr FROM public.ponto_correcoes WHERE registro_id = v_r2.id ORDER BY criado_em DESC LIMIT 1;
  v_ok := v_corr.natureza = 'sistema' AND v_corr.motivo = 'teste do banco - reordenar'
          AND v_corr.campos = ARRAY['tipo', 'ordem_no_dia'] AND v_corr.autor_id = v_rita
          AND NOT v_depois.ajuste_manual
          AND v_depois.motivo_ajuste IS NOT DISTINCT FROM v_r2.motivo_ajuste;
  v_res := v_res || format('%s T8 operacao do sistema: natureza=%s campos=%s ajuste_manual=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_corr.natureza, v_corr.campos, v_depois.ajuste_manual);

  -- T9. Com o canal aberto, o sistema não corrige horário.
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = v_r2.registrado_em - interval '1 minute'
     WHERE id = v_r2.id;
    v_res := v_res || 'FALHOU T9 sistema corrigiu horario'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T9 sistema nao corrige horario (%s)',
      CASE WHEN SQLERRM LIKE 'Operacao do sistema nao mexe em registrado_em%' THEN 'OK' ELSE 'FALHOU' END,
      left(SQLERRM, 60));
  END;

  -- T10. Canal fechado: o mesmo papel volta a precisar de motivo.
  PERFORM public.ponto_fechar_operacao_do_sistema();
  BEGIN
    UPDATE public.ponto_registros SET tipo = 'saida' WHERE id = v_r2.id;
    v_res := v_res || 'FALHOU T10 canal fechado e mesmo assim passou sem motivo'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T10 canal fechado exige motivo (%s)',
      CASE WHEN SQLERRM = 'Correcao de ponto exige motivo' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- =========================================================================
  -- O QUE A API ALCANÇA (privilégios)
  -- =========================================================================
  -- T11. Sem DELETE e sem TRUNCATE para o app; o resto do que ele usa, intacto.
  v_ok := NOT has_table_privilege('authenticated', 'public.ponto_registros', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.ponto_registros', 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', 'public.ponto_local', 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', 'public.ponto_correcoes', 'DELETE')
      AND NOT has_table_privilege('anon', 'public.ponto_registros', 'SELECT')
      AND has_table_privilege('authenticated', 'public.ponto_registros', 'SELECT')
      AND has_table_privilege('authenticated', 'public.ponto_registros', 'INSERT')
      AND has_table_privilege('authenticated', 'public.ponto_registros', 'UPDATE');
  v_res := v_res || format('%s T11 privilegios: app sem DELETE/TRUNCATE, com SELECT/INSERT/UPDATE',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- T12. A parte da regra de descarte que olha a PROVA: avaliada como a dona,
  --      sem DELETE, ponto_selfie_sem_batida não solta a selfie de batida, e
  --      solta a foto que nunca virou batida (sem isso, o zero da selfie da
  --      batida não provaria nada). A regra inteira, com o prazo de 16
  --      minutos, é provada com DELETE de verdade no T28 e no T29.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) FILTER (WHERE o.name = v_cam_r1), count(*) FILTER (WHERE o.name = v_cam_solta)
    INTO v_n, v_m
  FROM storage.objects o
  WHERE o.bucket_id = 'ponto-selfies'
    AND (storage.foldername(o.name))[1] = (auth.uid())::text
    AND public.ponto_ator_aprovado()
    AND public.ponto_selfie_sem_batida(o.name);
  RESET ROLE;
  v_res := v_res || format('%s T12 a dona poderia descartar %s selfie(s) de batida e %s foto(s) solta(s)',
    CASE WHEN v_n = 0 AND v_m = 1 THEN 'OK' ELSE 'FALHOU' END, v_n, v_m);

  -- T13. A dona lê a trilha das próprias batidas: as três correções de admin
  --      deste teste (T1, T4 e T5; o T6 não gera trilha) aparecem para ela.
  --      Conta a DIFERENÇA desde o começo do teste, e não o total.
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ponto_correcoes WHERE usuario_id = v_ana;
  SELECT count(*) INTO v_m FROM public.ponto_correcoes
   WHERE usuario_id = v_ana AND natureza = 'admin' AND motivo LIKE 'teste do banco - %';
  RESET ROLE;
  v_res := v_res || format('%s T13 dona le as proprias correcoes: %s antes, %s depois (+%s), %s do teste',
    CASE WHEN v_n - v_trilha_antes = 3 AND v_m = 3 THEN 'OK' ELSE 'FALHOU' END,
    v_trilha_antes, v_n, v_n - v_trilha_antes, v_m);

  -- T14. inserirBatida: o admin insere a batida esquecida por INSERT direto.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_r2.usuario_id, v_r2.registrado_em - interval '3 hours', 'teste do banco - inserir')
  RETURNING * INTO v_depois;
  RESET ROLE;
  v_ok := v_depois.origem = 'ajuste_admin' AND v_depois.ajuste_manual AND v_depois.criado_por = v_rita
          AND v_depois.selfie_path IS NULL AND v_depois.usuario_id = v_bruna
          AND v_depois.funcionario_nome = 'Bruna Costa';
  v_res := v_res || format('%s T14 admin insere batida esquecida: origem=%s ajuste_manual=%s nome da ficha gravado=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_depois.origem, v_depois.ajuste_manual, v_depois.funcionario_nome = 'Bruna Costa');

  -- =========================================================================
  -- O APP CONTINUA BATENDO (RPC de verdade, selfie válida)
  -- =========================================================================
  -- Quem bate: o Caio, com ficha que libera acesso e PIN.
  v_id := gen_random_uuid();
  v_caminho := v_caio::text || '/' || v_mes || '/' || v_id::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_caminho, v_caio, v_caio::text,
          jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));

  SELECT count(*) INTO v_antes
  FROM public.ponto_registros
  WHERE usuario_id = v_caio AND dia_civil = (now() AT TIME ZONE c_fuso)::date;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_caio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_registrar_batida(c_pin, v_id, v_caminho, v_local.latitude, v_local.longitude, 12);
  RESET ROLE;

  -- T15. Horário do servidor, tipo pela ordem do dia, dentro do local, e a
  --      origem 'app', que só a RPC dá.
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_id;
  v_ok := (v_resp ->> 'gravado')::boolean
      AND (v_resp -> 'registro' ->> 'ordem_no_dia')::int = v_antes + 1
      AND v_resp -> 'registro' ->> 'tipo' = CASE v_antes WHEN 0 THEN 'entrada' WHEN 1 THEN 'saida_almoco'
                                                         WHEN 2 THEN 'volta_almoco' WHEN 3 THEN 'saida' ELSE 'extra' END
      AND (v_resp -> 'registro' ->> 'registrado_em')::timestamptz = now()
      AND (v_resp -> 'registro' ->> 'no_local')::boolean
      AND NOT (v_resp -> 'registro' ->> 'ajuste_manual')::boolean
      AND v_depois.origem = 'app' AND v_depois.criado_por = v_caio;
  v_res := v_res || format('%s T15 batida pelo app: gravado=%s tipo=%s ordem=%s no_local=%s origem=%s, horario do servidor',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'gravado', v_resp -> 'registro' ->> 'tipo',
    v_resp -> 'registro' ->> 'ordem_no_dia', v_resp -> 'registro' ->> 'no_local', v_depois.origem);

  -- T16. A selfie que acabou de virar batida não é mais "órfã".
  v_res := v_res || format('%s T16 selfie da batida nova ligada',
    CASE WHEN NOT public.ponto_selfie_sem_batida(v_caminho) THEN 'OK' ELSE 'FALHOU' END);

  -- =========================================================================
  -- PIN: o bloqueio responde 0 tentativas restantes
  -- =========================================================================
  -- T17. O quinto erro tranca. É o primeiro bloqueio do dia: 15 minutos.
  UPDATE public.ponto_pin SET tentativas_falhas = 4, bloqueado_ate = NULL WHERE usuario_id = v_caio;
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_verificar_pin('0000');
  RESET ROLE;
  v_ok := v_resp ->> 'motivo' = 'bloqueado' AND (v_resp ->> 'tentativas_restantes')::int = 0
          AND (v_resp ->> 'bloqueado_ate')::timestamptz = now() + interval '15 minutes';
  v_res := v_res || format('%s T17 quinto erro de PIN: motivo=%s tentativas_restantes=%s, bloqueio de %s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'motivo', v_resp ->> 'tentativas_restantes',
    (v_resp ->> 'bloqueado_ate')::timestamptz - now());

  -- T18. Um erro antes do bloqueio continua dizendo quantas faltam.
  UPDATE public.ponto_pin SET tentativas_falhas = 1, bloqueado_ate = NULL WHERE usuario_id = v_caio;
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_verificar_pin('0000');
  RESET ROLE;
  v_ok := v_resp ->> 'motivo' = 'pin_incorreto' AND (v_resp ->> 'tentativas_restantes')::int = 3;
  v_res := v_res || format('%s T18 segundo erro de PIN: motivo=%s tentativas_restantes=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'motivo', v_resp ->> 'tentativas_restantes');

  -- =========================================================================
  -- SEM LOCALIZAÇÃO
  -- =========================================================================
  -- T19. Sem coordenada e sem motivo (o app que não manda o parâmetro), com o
  --      motivo da permissão negada e com meia coordenada: a recusa de sempre,
  --      antes do PIN (nenhuma tentativa conta).
  SELECT count(*) INTO v_antes FROM public.ponto_pin_tentativas WHERE usuario_id = v_caio;
  v_id := gen_random_uuid();
  v_caminho := v_caio::text || '/' || v_mes || '/' || v_id::text || '.jpg';
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_id, p_selfie_path => v_caminho,
                p_latitude => NULL, p_longitude => NULL, p_precisao_metros => NULL);
    v_t19 := v_t19 || 'sem motivo aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Batida pelo app exige latitude e longitude' THEN v_t19 := v_t19 || ('sem motivo: ' || SQLERRM); END IF;
  END;
  BEGIN
    v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_id, p_selfie_path => v_caminho,
                p_latitude => NULL, p_longitude => NULL, p_precisao_metros => NULL, p_sem_localizacao => 'negada');
    v_t19 := v_t19 || 'permissao negada aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Batida pelo app exige latitude e longitude' THEN v_t19 := v_t19 || ('permissao negada: ' || SQLERRM); END IF;
  END;
  BEGIN
    v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_id, p_selfie_path => v_caminho,
                p_latitude => NULL, p_longitude => v_local.longitude, p_precisao_metros => NULL, p_sem_localizacao => 'indisponivel');
    v_t19 := v_t19 || 'meia coordenada aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Batida pelo app exige latitude e longitude' THEN v_t19 := v_t19 || ('meia coordenada: ' || SQLERRM); END IF;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.ponto_pin_tentativas WHERE usuario_id = v_caio;
  v_res := v_res || format('%s T19 sem coordenada sem motivo, com permissao negada e com meia coordenada: recusadas antes do PIN (%s; tentativas +%s)',
    CASE WHEN cardinality(v_t19) = 0 AND v_n = v_antes THEN 'OK' ELSE 'FALHOU' END,
    coalesce(nullif(array_to_string(v_t19, '; '), ''), 'as tres com a frase de sempre'), v_n - v_antes);

  -- T20. O GPS do aparelho não respondeu: a batida da Daniela sai pelo app,
  --      com selfie e PIN, no horário do servidor e na ordem do dia, sem
  --      coordenada, precisão (a que veio é descartada), distância, marca e
  --      local.
  v_id := gen_random_uuid();
  v_caminho := v_daniela::text || '/' || v_mes || '/' || v_id::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_caminho, v_daniela, v_daniela::text,
          jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));

  SELECT count(*) INTO v_antes
  FROM public.ponto_registros
  WHERE usuario_id = v_daniela AND dia_civil = (now() AT TIME ZONE c_fuso)::date;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_daniela, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_id, p_selfie_path => v_caminho,
              p_latitude => NULL, p_longitude => NULL, p_precisao_metros => 40, p_sem_localizacao => 'indisponivel');
  RESET ROLE;
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_id;

  v_ok := coalesce((v_resp ->> 'gravado')::boolean, false)
      AND v_depois.usuario_id = v_daniela AND v_depois.origem = 'app' AND NOT v_depois.ajuste_manual
      AND v_depois.registrado_em = now()
      AND v_depois.ordem_no_dia = v_antes + 1
      AND v_depois.tipo = CASE v_antes WHEN 0 THEN 'entrada' WHEN 1 THEN 'saida_almoco'
                                       WHEN 2 THEN 'volta_almoco' WHEN 3 THEN 'saida' ELSE 'extra' END
      AND v_depois.selfie_path = v_caminho
      AND v_depois.latitude IS NULL AND v_depois.longitude IS NULL AND v_depois.precisao_metros IS NULL
      AND v_depois.distancia_metros IS NULL AND v_depois.no_local IS NULL AND v_depois.local_id IS NULL
      AND v_resp -> 'registro' ->> 'latitude' IS NULL AND v_resp -> 'registro' ->> 'no_local' IS NULL
      AND NOT public.ponto_selfie_sem_batida(v_caminho);
  v_res := v_res || format('%s T20 batida sem localizacao (GPS indisponivel): gravado=%s origem=%s tipo=%s coordenada nula=%s marca nula=%s selfie ligada=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'gravado', v_depois.origem, v_depois.tipo,
    v_depois.latitude IS NULL AND v_depois.longitude IS NULL, v_depois.no_local IS NULL,
    NOT public.ponto_selfie_sem_batida(v_caminho));

  -- =========================================================================
  -- O INSERT DIRETO É SEMPRE LANÇAMENTO DE QUEM ADMINISTRA
  -- =========================================================================
  -- Fora da RPC, a porta é a da batida esquecida, e só ela: horário e motivo
  -- obrigatórios, origem e marca de ajuste decididas pelo banco. Quem lança é
  -- a Rita; as batidas são do Gustavo, que não tem nenhuma.
  SELECT count(*) INTO v_antes FROM public.ponto_registros WHERE usuario_id = v_gustavo;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T21. Sem horário e sem motivo, com coordenada no local e caminho de selfie
  --      escolhidos por quem insere: sairia uma batida "de agora" com cara de
  --      batida do app, sem PIN. Recusada, com a frase própria.
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, latitude, longitude, precisao_metros, selfie_path)
    VALUES (v_gustavo, v_local.latitude, v_local.longitude, 5,
            v_gustavo::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg')
    RETURNING * INTO v_depois;
    v_t := format('aceita: origem=%s ajuste_manual=%s', v_depois.origem, v_depois.ajuste_manual);
  EXCEPTION WHEN OTHERS THEN
    v_t := CASE WHEN SQLSTATE = '23502' AND SQLERRM LIKE 'Batida lancada por quem administra exige o horario%' THEN NULL
                ELSE SQLSTATE || ' ' || left(SQLERRM, 70) END;
  END;

  -- T22. Com horário e sem motivo, ou com motivo em branco: recusada, com a
  --      frase própria (e não só com o CHECK genérico da tabela).
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em)
    VALUES (v_gustavo, now() - interval '2 hours');
    v_t2 := 'sem motivo aceita';
  EXCEPTION WHEN OTHERS THEN
    v_t2 := CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE 'Batida lancada por quem administra exige motivo%' THEN NULL
                 ELSE 'sem motivo: ' || SQLSTATE || ' ' || left(SQLERRM, 60) END;
  END;
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_gustavo, now() - interval '2 hours', '   ');
    v_t2 := concat_ws('; ', v_t2, 'motivo em branco aceito');
  EXCEPTION WHEN OTHERS THEN
    IF NOT (SQLSTATE = '23514' AND SQLERRM LIKE 'Batida lancada por quem administra exige motivo%') THEN
      v_t2 := concat_ws('; ', v_t2, 'motivo em branco: ' || SQLSTATE || ' ' || left(SQLERRM, 60));
    END IF;
  END;

  -- T23. Com horário e motivo, mandando origem 'app' e a marca desligada: o
  --      banco grava 'ajuste_admin', com a marca ligada.
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste, origem, ajuste_manual)
    VALUES (v_gustavo, now() - interval '3 hours', 'teste do banco - batida esquecida do Gustavo', 'app', false)
    RETURNING * INTO v_r_gustavo;
    v_t3 := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_t3 := SQLSTATE || ' ' || left(SQLERRM, 70);
  END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.ponto_registros WHERE usuario_id = v_gustavo;
  v_res := v_res || format('%s T21 insercao direta sem horario e sem motivo recusada (%s)',
    CASE WHEN v_t IS NULL THEN 'OK' ELSE 'FALHOU' END, coalesce(v_t, 'com a frase propria'));
  v_res := v_res || format('%s T22 insercao direta sem motivo, ou com motivo em branco, recusada (%s)',
    CASE WHEN v_t2 IS NULL THEN 'OK' ELSE 'FALHOU' END, coalesce(v_t2, 'com a frase propria'));
  v_res := v_res || format('%s T23 insercao direta com origem forjada: origem=%s ajuste_manual=%s; batidas do Gustavo %s -> %s',
    CASE WHEN v_t3 IS NULL AND v_r_gustavo.origem = 'ajuste_admin' AND v_r_gustavo.ajuste_manual
              AND v_r_gustavo.criado_por = v_rita AND v_n = v_antes + 1
         THEN 'OK' ELSE 'FALHOU' END,
    coalesce(v_r_gustavo.origem, v_t3), v_r_gustavo.ajuste_manual, v_antes, v_n);

  -- T24. Quem não administra não lança batida direto, nem a própria: a porta
  --      dela é a tela de bater, com selfie e PIN.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_ana, now() - interval '1 hour', 'teste do banco - a colaboradora tenta lancar a propria');
    v_t := 'aceita';
  EXCEPTION WHEN OTHERS THEN
    v_t := CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'Batida lancada direto e exclusiva de quem administra o ponto%' THEN NULL
                ELSE SQLSTATE || ' ' || left(SQLERRM, 70) END;
  END;
  RESET ROLE;
  v_res := v_res || format('%s T24 quem nao administra nao lanca batida direto (%s)',
    CASE WHEN v_t IS NULL THEN 'OK' ELSE 'FALHOU' END, coalesce(v_t, 'com a frase propria'));

  -- =========================================================================
  -- QUEM É DONO DA BATIDA NÃO LANÇA NEM CORRIGE O PRÓPRIO PONTO
  -- =========================================================================
  -- T25. A Rita administra e tem ficha: lançar uma batida retroativa para ela
  --      mesma é recusado.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_antes FROM public.ponto_registros WHERE usuario_id = v_rita;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_rita, now() - interval '2 hours', 'teste do banco - cheguei cedo e esqueci de bater');
    v_t := 'aceita';
  EXCEPTION WHEN OTHERS THEN
    v_t := CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'Quem e dono da batida nao lanca o proprio ponto%' THEN NULL
                ELSE SQLSTATE || ' ' || left(SQLERRM, 70) END;
  END;

  -- T26. ... e corrigir o horário da própria batida também.
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = v_r_rita.registrado_em - interval '1 hour',
           motivo_ajuste = 'teste do banco - na verdade cheguei uma hora antes'
     WHERE id = v_r_rita.id;
    v_t2 := 'aceita';
  EXCEPTION WHEN OTHERS THEN
    v_t2 := CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'Quem e dono da batida nao corrige o proprio ponto%' THEN NULL
                 ELSE SQLSTATE || ' ' || left(SQLERRM, 70) END;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.ponto_registros WHERE usuario_id = v_rita;
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_r_rita.id;
  v_res := v_res || format('%s T25 quem administra nao lanca a propria batida (%s; batidas %s -> %s)',
    CASE WHEN v_t IS NULL AND v_n = v_antes THEN 'OK' ELSE 'FALHOU' END, coalesce(v_t, 'com a frase propria'), v_antes, v_n);
  v_res := v_res || format('%s T26 quem administra nao corrige a propria batida (%s; horario intacto=%s)',
    CASE WHEN v_t2 IS NULL AND v_depois.registrado_em = v_r_rita.registrado_em AND NOT v_depois.ajuste_manual
         THEN 'OK' ELSE 'FALHOU' END,
    coalesce(v_t2, 'com a frase propria'), v_depois.registrado_em = v_r_rita.registrado_em);

  -- T27. O super admin corrige a batida de outra pessoa, e não a própria.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = v_r_gustavo.registrado_em - interval '5 minutes',
           motivo_ajuste = 'teste do banco - o super admin corrige a batida de outra pessoa'
     WHERE id = v_r_gustavo.id;
    v_t := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_t := 'a dos outros: ' || SQLSTATE || ' ' || left(SQLERRM, 60);
  END;
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = v_r_sergio.registrado_em - interval '1 hour',
           motivo_ajuste = 'teste do banco - o super admin corrige a propria'
     WHERE id = v_r_sergio.id;
    v_t2 := 'a propria aceita';
  EXCEPTION WHEN OTHERS THEN
    v_t2 := CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'Quem e dono da batida nao corrige o proprio ponto%' THEN NULL
                 ELSE 'a propria: ' || SQLSTATE || ' ' || left(SQLERRM, 60) END;
  END;
  RESET ROLE;
  SELECT * INTO v_corr FROM public.ponto_correcoes WHERE registro_id = v_r_gustavo.id ORDER BY criado_em DESC LIMIT 1;
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_r_sergio.id;
  v_res := v_res || format('%s T27 super admin corrige a de outra pessoa (autor=%s) e nao a propria (%s)',
    CASE WHEN v_t IS NULL AND v_t2 IS NULL AND v_corr.autor_id = v_sergio AND v_corr.natureza = 'admin'
              AND v_corr.motivo = 'teste do banco - o super admin corrige a batida de outra pessoa'
              AND v_depois.registrado_em = v_r_sergio.registrado_em
         THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN v_corr.autor_id = v_sergio THEN 'o super admin' ELSE coalesce(v_t, 'outro') END,
    coalesce(v_t2, 'com a frase propria'));

  -- =========================================================================
  -- A CORREÇÃO NÃO TROCA A ORIGEM
  -- =========================================================================
  -- T28. Nem 'app' -> 'ajuste_admin' junto de uma correção de horário (o
  --      horário muda, a origem fica, e a trilha não lista a origem), nem
  --      'ajuste_admin' -> 'app' sozinha (congelada em silêncio, ou o UPDATE
  --      recusado pelo gatilho de motivo e marca: os dois desfechos valem).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SELECT * INTO v_depois FROM public.ponto_registros WHERE id = v_r1.id;
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ponto_registros
       SET registrado_em = v_depois.registrado_em - interval '5 minutes', origem = 'ajuste_admin',
           motivo_ajuste = 'teste do banco - horario e origem forjada'
     WHERE id = v_r1.id;
    v_t := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_t := 'correcao de horario recusada: ' || left(SQLERRM, 60);
  END;
  BEGIN
    UPDATE public.ponto_registros
       SET origem = 'app', motivo_ajuste = 'teste do banco - so a origem forjada'
     WHERE id = v_r_gustavo.id;
    v_t2 := 'congelada em silencio';
  EXCEPTION WHEN OTHERS THEN
    v_t2 := CASE WHEN SQLERRM LIKE 'Motivo da batida so muda junto com a correcao%'
                 THEN 'UPDATE recusado pelo gatilho de motivo e marca'
                 ELSE 'erro inesperado: ' || left(SQLERRM, 60) END;
  END;
  RESET ROLE;
  -- A linha desta correção, pelo motivo: depois dela vem a da reordenação do
  -- dia (natureza sistema), porque o horário mudou.
  SELECT * INTO v_corr FROM public.ponto_correcoes
   WHERE registro_id = v_r1.id AND motivo = 'teste do banco - horario e origem forjada';
  v_ok := v_t IS NULL
      AND (SELECT r.origem FROM public.ponto_registros r WHERE r.id = v_r1.id) = 'app'
      AND (SELECT r.registrado_em FROM public.ponto_registros r WHERE r.id = v_r1.id) = v_depois.registrado_em - interval '5 minutes'
      AND v_corr.motivo = 'teste do banco - horario e origem forjada'
      AND 'registrado_em' = ANY (v_corr.campos) AND NOT ('origem' = ANY (v_corr.campos))
      AND (SELECT r.origem FROM public.ponto_registros r WHERE r.id = v_r_gustavo.id) = 'ajuste_admin'
      AND v_t2 NOT LIKE 'erro inesperado%';
  v_res := v_res || format('%s T28 a correcao nao troca a origem: app continua app (campos=%s), ajuste_admin continua ajuste_admin (%s)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_corr.campos, coalesce(v_t, v_t2));

  -- =========================================================================
  -- A SELFIE RECÉM-ENVIADA NÃO SE APAGA
  -- =========================================================================
  -- Uma batida pode estar sendo gravada com a foto: a RPC confere a selfie,
  -- confere o PIN e só então grava, e até o COMMIT a foto parece solta. Por
  -- isso ninguém apaga foto com menos de 16 minutos (os 15 que as RPCs aceitam
  -- e um de folga). O DELETE é o da API do storage, que liga
  -- `storage.allow_delete_query`, e volta atrás no fim de cada bloco.
  -- A selfie da batida da Ana fica velha também: o que a segura é a prova.
  UPDATE storage.objects SET created_at = now() - interval '17 minutes'
   WHERE bucket_id = 'ponto-selfies' AND name = v_cam_r1;
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  -- T29. A dona: só a foto solta com mais de 16 minutos sai.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  v_apagadas := NULL;
  v_t := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    WITH apagadas AS (
      DELETE FROM storage.objects
       WHERE bucket_id = 'ponto-selfies' AND name IN (v_cam_solta, v_cam_velha, v_cam_r1)
      RETURNING name
    )
    SELECT coalesce(array_agg(a.name ORDER BY a.name), '{}') INTO v_apagadas FROM apagadas a;
    RAISE EXCEPTION 'desfazer o descarte do teste' USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN NULL;
    WHEN OTHERS THEN v_t := SQLSTATE || ' ' || left(SQLERRM, 70);
  END;
  RESET ROLE;
  v_res := v_res || format('%s T29 a dona descarta so a foto solta com mais de 16 minutos: %s de 3 (recem-enviada=%s, velha=%s, de batida=%s)%s',
    CASE WHEN v_t IS NULL AND v_apagadas = ARRAY[v_cam_velha] THEN 'OK' ELSE 'FALHOU' END,
    coalesce(cardinality(v_apagadas), 0),
    CASE WHEN v_cam_solta = ANY (v_apagadas) THEN 'apagada' ELSE 'fica' END,
    CASE WHEN v_cam_velha = ANY (v_apagadas) THEN 'apagada' ELSE 'fica' END,
    CASE WHEN v_cam_r1 = ANY (v_apagadas) THEN 'apagada' ELSE 'fica' END,
    CASE WHEN v_t IS NULL THEN '' ELSE ' erro: ' || v_t END);

  -- T30. Quem administra também não apaga a foto recém-enviada: a solta com
  --      mais de 16 minutos sai, a recém-enviada e a de batida ficam.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  v_apagadas := NULL;
  v_t := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    WITH apagadas AS (
      DELETE FROM storage.objects
       WHERE bucket_id = 'ponto-selfies' AND name IN (v_cam_solta, v_cam_velha2, v_cam_r1)
      RETURNING name
    )
    SELECT coalesce(array_agg(a.name ORDER BY a.name), '{}') INTO v_apagadas FROM apagadas a;
    RAISE EXCEPTION 'desfazer o descarte do teste' USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN NULL;
    WHEN OTHERS THEN v_t := SQLSTATE || ' ' || left(SQLERRM, 70);
  END;
  RESET ROLE;
  PERFORM set_config('storage.allow_delete_query', '', true);
  v_res := v_res || format('%s T30 quem administra apaga so a foto solta com mais de 16 minutos: %s de 3 (recem-enviada=%s, velha=%s, de batida=%s)%s',
    CASE WHEN v_t IS NULL AND v_apagadas = ARRAY[v_cam_velha2] THEN 'OK' ELSE 'FALHOU' END,
    coalesce(cardinality(v_apagadas), 0),
    CASE WHEN v_cam_solta = ANY (v_apagadas) THEN 'apagada' ELSE 'fica' END,
    CASE WHEN v_cam_velha2 = ANY (v_apagadas) THEN 'apagada' ELSE 'fica' END,
    CASE WHEN v_cam_r1 = ANY (v_apagadas) THEN 'apagada' ELSE 'fica' END,
    CASE WHEN v_t IS NULL THEN '' ELSE ' erro: ' || v_t END);

  -- =========================================================================
  -- O BLOQUEIO DO PIN ENDURECE NO MESMO DIA
  -- =========================================================================
  -- T31. O Caio já foi bloqueado uma vez hoje (T17, 15 minutos). O segundo
  --      bloqueio do dia dura 1 hora; o terceiro, 24 horas. O reset do PIN por
  --      quem administra zera a conta (o próximo volta aos 15 minutos), e o dia
  --      seguinte também (com o último bloqueio ontem, volta aos 15 minutos).
  --      A trava "vencida" é simulada tirando `bloqueado_ate`.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_caio, 'role', 'authenticated')::text, true);
  UPDATE public.ponto_pin SET tentativas_falhas = 4, bloqueado_ate = NULL WHERE usuario_id = v_caio;
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_verificar_pin('0000');
  RESET ROLE;
  v_t := round(extract(epoch FROM (v_resp ->> 'bloqueado_ate')::timestamptz - now()) / 60)::text;
  v_ok := v_resp ->> 'motivo' = 'bloqueado' AND (v_resp ->> 'bloqueado_ate')::timestamptz = now() + interval '1 hour';

  UPDATE public.ponto_pin SET tentativas_falhas = 4, bloqueado_ate = NULL WHERE usuario_id = v_caio;
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_verificar_pin('0000');
  RESET ROLE;
  v_t := v_t || ', ' || round(extract(epoch FROM (v_resp ->> 'bloqueado_ate')::timestamptz - now()) / 60)::text;
  v_ok := v_ok AND v_resp ->> 'motivo' = 'bloqueado' AND (v_resp ->> 'bloqueado_ate')::timestamptz = now() + interval '24 hours';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_resetar_pin(v_caio);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_caio, 'role', 'authenticated')::text, true);
  UPDATE public.ponto_pin SET tentativas_falhas = 4 WHERE usuario_id = v_caio;
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_verificar_pin('0000');
  RESET ROLE;
  v_t := v_t || ', depois do reset ' || round(extract(epoch FROM (v_resp ->> 'bloqueado_ate')::timestamptz - now()) / 60)::text;
  v_ok := v_ok AND v_resp ->> 'motivo' = 'bloqueado' AND (v_resp ->> 'bloqueado_ate')::timestamptz = now() + interval '15 minutes';

  BEGIN
    UPDATE public.ponto_pin
       SET tentativas_falhas = 4, bloqueado_ate = NULL, bloqueios_no_dia = 2, ultimo_bloqueio_em = now() - interval '1 day'
     WHERE usuario_id = v_caio;
    SET LOCAL ROLE authenticated;
    v_resp := public.ponto_verificar_pin('0000');
    RESET ROLE;
    v_t := v_t || ', no dia seguinte ' || round(extract(epoch FROM (v_resp ->> 'bloqueado_ate')::timestamptz - now()) / 60)::text;
    v_ok := v_ok AND v_resp ->> 'motivo' = 'bloqueado' AND (v_resp ->> 'bloqueado_ate')::timestamptz = now() + interval '15 minutes';
  EXCEPTION WHEN OTHERS THEN
    v_t := v_t || ', no dia seguinte: ' || left(SQLERRM, 50);
    v_ok := false;
  END;
  v_res := v_res || format('%s T31 bloqueios do dia em minutos: %s (esperado 60, 1440, depois do reset 15, no dia seguinte 15)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_t);

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
