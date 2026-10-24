-- TESTE DE BANCO — O PEDIDO DE BATIDA ESQUECIDA (batida em atraso)
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- batida_esquecida.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve, mede e DESFAZ no
-- fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma linha por
-- caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco `$conferir$`
-- (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA: o pedido de batida esquecida (pela RPC, com PIN e selfie),
-- as recusas, a decisão (recusar com motivo, aprovar), a reordenação do dia
-- pelo relógio, as horas das outras pessoas iguais, a ligação batida-pedido
-- que não se forja e o pedido que não se corrige. E o pedido SEM LOCALIZAÇÃO
-- (T22 a T24): sem coordenada e sem motivo (o app que não manda o parâmetro)
-- e com meia coordenada, a recusa de sempre; com o GPS que demorou, o pedido
-- nasce sem coordenada, precisão, distância, marca e local, e a aprovação
-- cria a batida sem localização. E o teto de pedidos pendentes do dia (T25):
-- o quinto pendente é recusado antes do PIN, e a fila anda quando alguém
-- decide.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. O T19 prova que
-- nem ele corrige um pedido.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto. A Ana pede (ficha e PIN); a Bruna é "a outra",
-- que não lê o pedido da Ana; quem decide é a Rita, do RH, que administra e não
-- é super admin; o dia que a aprovação reordena é o do Caio.
--
-- O DIA DO CAIO, MONTADO AQUI: uma batida do app agora (sem sessão e sem
-- horário, o carimbo dá o horário do servidor e a origem app) e três que o RH
-- lançou no minuto anterior; o pedido aprovado é de dois minutos atrás. Assim
-- a aprovação cai ANTES de todas e o dia inteiro é reordenado, e a batida do
-- app prova que a reordenação não liga a marca de ajuste de ninguém. Tudo
-- cabe em "hoje, antes de agora", que é o que o pedido exige.
--
-- QUANDO NÃO RODA: nos cinco primeiros minutos do dia, no horário de Brasília
-- (America/Sao_Paulo). O pedido só vale para hoje, antes de agora, e o teste
-- usa até quatro minutos de "hoje" antes do minuto de agora; à meia-noite eles
-- cairiam na véspera. A partida recusa com a explicação, e o
-- `scripts/testar-banco.sh` espera esses minutos passarem antes de começar.
--
-- O QUE ELE NÃO TEM, DE PROPÓSITO: nenhuma instrução de apagar ou de esvaziar
-- tabela. Esses caminhos são provados pelos privilégios e pelos bits dos
-- gatilhos (T20).
--
-- SESSÃO FORJADA: `request.jwt.claims` com `sub` e `role`, e
-- `SET LOCAL ROLE authenticated` — exatamente o que o PostgREST faz. O pedido
-- pelo app usa a RPC de verdade, com selfie registrada em `storage.objects`
-- dentro da transação (só a linha do índice; nenhum arquivo sobe) e um PIN
-- conhecido. O pedido do dia do Caio é inserido direto (com a mesma forma que
-- a RPC daria), para o horário declarado ser exatamente o que o teste
-- precisa; a DECISÃO é a RPC de verdade, com a sessão de quem administra.
--
-- O QUE A TRANSAÇÃO DESFEITA NÃO DESFAZ: a sequência de ponto_pin_tentativas
-- (sequência do Postgres não volta no ROLLBACK): o próximo id fica maior,
-- nenhuma linha fica.

BEGIN;
SET LOCAL teste.em_transacao = 'sim';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- A partida: só dentro de BEGIN (fora de uma transação, o SET LOCAL de cima
-- não vale nada), só com a estrutura do ponto aplicada, só como `postgres`,
-- sem superusuário (um superusuário passaria por cima do que se quer provar),
-- e fora dos cinco primeiros minutos do dia de Brasília (ver o cabeçalho).
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
  IF (now() AT TIME ZONE 'America/Sao_Paulo')::time < time '00:05' THEN
    RAISE EXCEPTION 'Sao %h de Brasilia: o pedido de batida esquecida so vale para hoje, antes de agora, e este teste precisa de alguns minutos de hoje. Rode depois das 00h05 (o npm run db:testar espera sozinho).',
      to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'HH24"h"MI')
      USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $partida$;

DO $teste$
DECLARE
  c_pin       constant text := '4321';
  c_fuso      constant text := 'America/Sao_Paulo';
  v_res       text[] := '{}';
  -- As pessoas (elenco fictício).
  v_rita      uuid := gen_random_uuid();   -- RH: decide, não é super admin
  v_ana       uuid := gen_random_uuid();   -- pede (ficha e PIN)
  v_bruna     uuid := gen_random_uuid();   -- a outra (ficha), que não lê o pedido da Ana
  v_caio      uuid := gen_random_uuid();   -- o dono do dia que a aprovação reordena (ficha)
  -- Os horários: o minuto de agora e os de antes dele, todos de hoje.
  v_minuto    timestamptz := date_trunc('minute', now());
  v_hoje_h    timestamptz;   -- o pedido da Ana (T1), dois minutos atrás
  v_livre     timestamptz;   -- um minuto atrás: sem batida nem pedido da Ana até o T23
  v_dia       date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_h_dia     timestamptz;   -- o pedido aprovado do dia do Caio
  v_mes       text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY/MM');
  v_mes_ini   date;
  v_mes_fim   date;
  v_local     public.ponto_local%ROWTYPE;
  v_app_caio  uuid;          -- a batida do app do Caio
  v_pid       uuid;
  v_pid_rec   uuid;
  v_pid_dia   uuid;
  v_pid_sem   uuid;
  v_pid_admin uuid;
  v_caminho   text;
  v_cam_rec   text;
  v_cam_dia   text;
  v_cam_sem   text;
  v_resp      jsonb;
  v_ok        boolean;
  v_n         bigint;
  v_antes     bigint;
  v_falhas    smallint;
  v_falhas2   smallint;
  v_reg       public.ponto_registros%ROWTYPE;
  v_ped       public.ponto_pedidos_atraso%ROWTYPE;
  v_tipos     text;
  v_marcas_antes  text;
  v_marcas_depois text;
  v_horas_antes text;
  v_horas_depois text;
  v_mais_tarde public.ponto_registros%ROWTYPE;
  v_t17       text;
  v_pid_gps   uuid;
  v_cam_gps   text;
  v_h_gps     timestamptz;
BEGIN
  v_hoje_h := v_minuto - interval '2 minutes';
  v_livre  := v_minuto - interval '1 minute';
  v_h_dia  := v_minuto - interval '2 minutes';
  v_mes_ini := date_trunc('month', v_dia)::date;
  v_mes_fim := (date_trunc('month', v_dia) + interval '1 month')::date;

  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria).
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_rita,  'authenticated', 'authenticated', 'rita.teste@example.invalid',  '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,   'authenticated', 'authenticated', 'ana.teste@example.invalid',   '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_bruna, 'authenticated', 'authenticated', 'bruna.teste@example.invalid', '{}', '{"full_name": "Bruna Costa"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_caio,  'authenticated', 'authenticated', 'caio.teste@example.invalid',  '{}', '{"full_name": "Caio Mendes"}',       now(), now());
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: o RH decide os pedidos');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
  VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas'),
         (v_bruna, 'Bruna Costa', 'Compras'),
         (v_caio, 'Caio Mendes', 'Operações');
  INSERT INTO public.ponto_pin (usuario_id, pin_hash) VALUES (v_ana, extensions.crypt(c_pin, extensions.gen_salt('bf')));

  -- O local: o ativo da instalação, se houver; senão, um sintético.
  SELECT * INTO v_local FROM public.ponto_local WHERE ativo ORDER BY criado_em LIMIT 1;
  IF v_local.id IS NULL THEN
    INSERT INTO public.ponto_local (nome, latitude, longitude, raio_metros)
    VALUES ('Sede da Empresa Exemplo', -23.550520, -46.633308, 150)
    RETURNING * INTO v_local;
  END IF;

  -- O dia do Caio: a batida do app de agora...
  INSERT INTO public.ponto_registros (usuario_id) VALUES (v_caio) RETURNING id INTO v_app_caio;
  -- ... e três que o RH lançou no minuto anterior. E duas da Bruna, mais
  -- cedo, para o T14c ter horas de outra pessoa para comparar.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_caio, v_minuto - interval '50 seconds', 'teste do banco - lancada pelo RH (1)');
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_caio, v_minuto - interval '40 seconds', 'teste do banco - lancada pelo RH (2)');
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_caio, v_minuto - interval '30 seconds', 'teste do banco - lancada pelo RH (3)');
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_bruna, v_minuto - interval '4 minutes', 'teste do banco - entrada da Bruna');
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_bruna, v_minuto - interval '3 minutes', 'teste do banco - saida da Bruna');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- Selfies dos pedidos do app (só a linha do índice; nenhum arquivo sobe).
  v_pid     := gen_random_uuid();
  v_pid_rec := gen_random_uuid();
  v_caminho := v_ana::text || '/' || v_mes || '/' || v_pid::text || '.jpg';
  v_cam_rec := v_ana::text || '/' || v_mes || '/' || v_pid_rec::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_caminho, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1)),
         ('ponto-selfies', v_cam_rec, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));

  -- ========================================================================
  -- O PEDIDO, PELA RPC, COMO A COLABORADORA
  -- ========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_antes FROM public.ponto_registros WHERE usuario_id = v_ana;

  -- T1. Pedido válido grava pendente, com o horário real do servidor e o
  --     horário declarado truncado ao minuto.
  v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid, v_caminho,
              v_local.latitude, v_local.longitude, 10, v_hoje_h + interval '17 seconds',
              '  teste do banco - esqueci de bater na chegada  ');
  v_ok := (v_resp ->> 'gravado')::boolean
          AND v_resp -> 'pedido' ->> 'estado' = 'pendente'
          AND (v_resp -> 'pedido' ->> 'horario_declarado')::timestamptz = v_hoje_h
          AND (v_resp -> 'pedido' ->> 'pedido_em')::timestamptz = now()
          AND v_resp -> 'pedido' ->> 'motivo' = 'teste do banco - esqueci de bater na chegada'
          AND (v_resp -> 'pedido' ->> 'no_local')::boolean
          AND (v_resp -> 'pedido' ->> 'distancia_metros')::double precision = 0;
  v_res := v_res || format('%s T1 pedido valido: gravado=%s estado=%s no_local=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'gravado',
    v_resp -> 'pedido' ->> 'estado', v_resp -> 'pedido' ->> 'no_local');

  -- T2. Horário de ontem.
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid_rec, v_cam_rec,
                v_local.latitude, v_local.longitude, 10, v_hoje_h - interval '1 day',
                'teste do banco - horario de ontem');
    v_res := v_res || format('FALHOU T2 horario de ontem aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T2 horario de ontem recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Horario declarado fora do dia de hoje%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T3. Horário futuro.
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid_rec, v_cam_rec,
                v_local.latitude, v_local.longitude, 10, now() + interval '2 minutes',
                'teste do banco - horario futuro');
    v_res := v_res || format('FALHOU T3 horario futuro aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T3 horario futuro recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Horario declarado no futuro%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T4. Motivo vazio e motivo curto.
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid_rec, v_cam_rec,
                v_local.latitude, v_local.longitude, 10, v_livre, '   ');
    v_res := v_res || format('FALHOU T4a motivo vazio aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T4a motivo vazio recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Motivo do pedido de batida em atraso precisa de pelo menos 10%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid_rec, v_cam_rec,
                v_local.latitude, v_local.longitude, 10, v_livre, '  curto   ');
    v_res := v_res || format('FALHOU T4b motivo curto aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T4b motivo curto recusado',
      CASE WHEN SQLERRM LIKE 'Motivo do pedido de batida em atraso precisa de pelo menos 10%' THEN 'OK' ELSE 'FALHOU' END);
  END;

  -- T5. PIN errado conta tentativa, como na batida, e não grava.
  RESET ROLE;
  SELECT tentativas_falhas INTO v_falhas FROM public.ponto_pin WHERE usuario_id = v_ana;
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_pedir_batida_em_atraso('0000', v_pid_rec, v_cam_rec,
              v_local.latitude, v_local.longitude, 10, v_livre,
              'teste do banco - pin errado');
  RESET ROLE;
  SELECT tentativas_falhas INTO v_falhas2 FROM public.ponto_pin WHERE usuario_id = v_ana;
  SELECT count(*) INTO v_n FROM public.ponto_pedidos_atraso WHERE id = v_pid_rec;
  v_ok := NOT (v_resp ->> 'gravado')::boolean AND v_resp ->> 'motivo' = 'pin_incorreto'
          AND (v_resp ->> 'tentativas_restantes')::int = 4 AND v_falhas2 = v_falhas + 1 AND v_n = 0;
  v_res := v_res || format('%s T5 PIN errado: motivo=%s restantes=%s falhas %s -> %s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'motivo', v_resp ->> 'tentativas_restantes', v_falhas, v_falhas2);
  UPDATE public.ponto_pin SET tentativas_falhas = 0 WHERE usuario_id = v_ana;
  SET LOCAL ROLE authenticated;

  -- T6. Segundo pedido pendente para o mesmo minuto.
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid_rec, v_cam_rec,
                v_local.latitude, v_local.longitude, 10, v_hoje_h + interval '40 seconds',
                'teste do banco - mesmo minuto de novo');
    v_res := v_res || format('FALHOU T6 pedido pendente duplicado aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T6 pendente no mesmo minuto recusado',
      CASE WHEN SQLERRM LIKE 'Ja existe um pedido pendente seu para este mesmo horario%' THEN 'OK' ELSE 'FALHOU' END);
  END;

  -- T7. Pendente não aparece em nenhuma leitura de batida.
  SELECT count(*) INTO v_n FROM public.ponto_registros WHERE usuario_id = v_ana;
  v_res := v_res || format('%s T7 pedido pendente fora de ponto_registros (%s -> %s batidas)',
    CASE WHEN v_n = v_antes THEN 'OK' ELSE 'FALHOU' END, v_antes, v_n);

  -- T8. A batida pelo app continua igual (tipo e ordem certos, sem trilha de
  --     sistema) — e um pedido no mesmo minuto dela é recusado como duplicado.
  RESET ROLE;
  SELECT count(*) INTO v_antes FROM public.ponto_registros
   WHERE usuario_id = v_ana AND dia_civil = v_dia;
  SELECT count(*) INTO v_n FROM public.ponto_correcoes WHERE usuario_id = v_ana;
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_registrar_batida(c_pin, v_pid_rec, v_cam_rec, v_local.latitude, v_local.longitude, 12);
  v_ok := (v_resp ->> 'gravado')::boolean
      AND (v_resp -> 'registro' ->> 'ordem_no_dia')::int = v_antes + 1
      AND v_resp -> 'registro' ->> 'tipo' = CASE v_antes WHEN 0 THEN 'entrada' WHEN 1 THEN 'saida_almoco'
                                                         WHEN 2 THEN 'volta_almoco' WHEN 3 THEN 'saida' ELSE 'extra' END
      AND NOT (v_resp -> 'registro' ->> 'ajuste_manual')::boolean;
  RESET ROLE;
  SELECT count(*) INTO v_antes FROM public.ponto_correcoes WHERE usuario_id = v_ana;
  v_res := v_res || format('%s T8 batida pelo app intacta: gravado=%s tipo=%s ordem=%s trilha nova=%s',
    CASE WHEN v_ok AND v_antes = v_n THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'gravado',
    v_resp -> 'registro' ->> 'tipo', v_resp -> 'registro' ->> 'ordem_no_dia', v_antes - v_n);

  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, gen_random_uuid(), v_caminho,
                v_local.latitude, v_local.longitude, 10, v_minuto,
                'teste do banco - minuto da batida');
    v_res := v_res || format('FALHOU T8b pedido no minuto de uma batida aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    -- O caminho da selfie é de outro pedido: a convenção recusa antes. Isso já
    -- é a prova de que a foto não se reaproveita. O duplicado vem abaixo.
    v_res := v_res || format('%s T8b selfie de outro pedido recusada (%s)',
      CASE WHEN SQLERRM LIKE 'Caminho de selfie fora da convencao%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 40));
  END;
  RESET ROLE;
  v_pid_sem := gen_random_uuid();
  v_cam_sem := v_ana::text || '/' || v_mes || '/' || v_pid_sem::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_cam_sem, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid_sem, v_cam_sem,
                v_local.latitude, v_local.longitude, 10, v_minuto,
                'teste do banco - minuto da batida');
    v_res := v_res || format('FALHOU T8c pedido no minuto de uma batida aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T8c pedido no minuto de uma batida recusado',
      CASE WHEN SQLERRM LIKE 'Ja existe uma batida sua neste mesmo minuto%' THEN 'OK' ELSE 'FALHOU' END);
  END;

  -- T9. Leitura: a dona vê o seu; a outra não vê; o app não escreve.
  SELECT count(*) INTO v_n FROM public.ponto_pedidos_atraso WHERE id = v_pid;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bruna, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_antes FROM public.ponto_pedidos_atraso WHERE id = v_pid;
  BEGIN
    INSERT INTO public.ponto_pedidos_atraso (id, usuario_id, horario_declarado, dia_civil, motivo, selfie_path, latitude, longitude)
    VALUES (gen_random_uuid(), v_bruna, now() - interval '1 hour', current_date, 'teste do banco - insert direto', 'x', 0, 0);
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  RESET ROLE;
  v_res := v_res || format('%s T9 dona le %s, outra le %s, insert direto recusado=%s',
    CASE WHEN v_n = 1 AND v_antes = 0 AND v_ok THEN 'OK' ELSE 'FALHOU' END, v_n, v_antes, v_ok);

  -- T10. A selfie do pedido não é mais "órfã" (a dona não a descarta); uma foto
  --      que nunca virou nada continua órfã.
  v_res := v_res || format('%s T10 selfie do pedido ligada=%s; foto solta continua orfa=%s',
    CASE WHEN NOT public.ponto_selfie_sem_batida(v_caminho) AND public.ponto_selfie_sem_batida(v_cam_sem)
         THEN 'OK' ELSE 'FALHOU' END,
    NOT public.ponto_selfie_sem_batida(v_caminho), public.ponto_selfie_sem_batida(v_cam_sem));

  -- ========================================================================
  -- A DECISÃO
  -- ========================================================================
  -- T11. Quem não administra não decide.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_decidir_pedido_atraso(v_pid, true, NULL);
    v_res := v_res || format('FALHOU T11 nao admin decidiu: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T11 nao admin nao decide',
      CASE WHEN SQLERRM LIKE '%exclusivo de quem administra o ponto%' THEN 'OK' ELSE 'FALHOU' END);
  END;
  RESET ROLE;

  -- T12. Recusar sem motivo é recusado; com motivo, recusa; decidir de novo não.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_decidir_pedido_atraso(v_pid, false, '   ');
    v_res := v_res || format('FALHOU T12a recusa sem motivo aceita: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T12a recusa sem motivo recusada',
      CASE WHEN SQLERRM LIKE 'Recusar pedido de batida em atraso exige motivo%' THEN 'OK' ELSE 'FALHOU' END);
  END;
  v_resp := public.ponto_decidir_pedido_atraso(v_pid, false, 'teste do banco - nao confere com a camera');
  v_ok := v_resp ->> 'estado' = 'recusado' AND (v_resp -> 'pedido' ->> 'decidido_por')::uuid = v_rita;
  BEGIN
    v_resp := public.ponto_decidir_pedido_atraso(v_pid, true, NULL);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND SQLERRM LIKE 'Pedido de batida em atraso ja decidido%';
  END;
  RESET ROLE;
  SELECT * INTO v_ped FROM public.ponto_pedidos_atraso WHERE id = v_pid;
  v_res := v_res || format('%s T12b recusa com motivo: estado=%s; segunda decisao recusada; nenhuma batida=%s',
    CASE WHEN v_ok AND v_ped.estado = 'recusado' AND v_ped.registro_id IS NULL THEN 'OK' ELSE 'FALHOU' END,
    v_ped.estado, v_ped.registro_id IS NULL);

  -- T13. Quem pediu não decide o próprio pedido (pedido de quem administra,
  --      inserido direto — a regra da decisão não depende de como nasceu).
  v_pid_admin := gen_random_uuid();
  INSERT INTO public.ponto_pedidos_atraso (id, usuario_id, horario_declarado, dia_civil, motivo, selfie_path, latitude, longitude)
  VALUES (v_pid_admin, v_rita, v_hoje_h, (v_hoje_h AT TIME ZONE c_fuso)::date,
          'teste do banco - pedido da propria administradora',
          v_rita::text || '/' || v_mes || '/' || v_pid_admin::text || '.jpg',
          v_local.latitude, v_local.longitude);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_decidir_pedido_atraso(v_pid_admin, true, NULL);
    v_res := v_res || format('FALHOU T13 admin aprovou o proprio pedido: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T13 quem pediu nao decide o proprio',
      CASE WHEN SQLERRM LIKE 'Quem pediu a batida em atraso nao decide o proprio pedido%' THEN 'OK' ELSE 'FALHOU' END);
  END;
  RESET ROLE;

  -- ------------------------------------------------------------------------
  -- T14. APROVAR no dia do Caio, que já tinha quatro batidas: a entrada
  --      esquecida fica em 1º, o resto do dia é reordenado pelo relógio, e as
  --      outras batidas não trocam de marca nem de motivo (a do app continua
  --      sem ajuste), com trilha de natureza 'sistema'.
  -- ------------------------------------------------------------------------
  -- As horas do mês de cada OUTRA pessoa, antes — a conta de src/lib/horas.ts
  -- (pareamento posicional pelo relógio, dia ímpar vale zero, arredonda no
  -- dia). Sem o dono do dia aprovado e sem quem pediu no T8.
  SELECT md5(coalesce(string_agg(usuario_id::text || '=' || minutos::text, ',' ORDER BY usuario_id), '')),
         count(*)
    INTO v_horas_antes, v_n
  FROM (
    SELECT usuario_id, sum(minutos) AS minutos
    FROM (
      SELECT usuario_id, dia_civil,
             CASE WHEN count(*) % 2 = 1 THEN 0
                  ELSE round(sum(CASE WHEN n % 2 = 0 THEN ms ELSE -ms END) / 60000.0) END AS minutos
      FROM (
        SELECT usuario_id, dia_civil,
               floor(extract(epoch FROM registrado_em) * 1000) AS ms,
               row_number() OVER (PARTITION BY usuario_id, dia_civil ORDER BY registrado_em) AS n
        FROM public.ponto_registros
        WHERE usuario_id <> v_caio AND usuario_id <> v_ana
          AND dia_civil >= v_mes_ini AND dia_civil < v_mes_fim
      ) b
      GROUP BY usuario_id, dia_civil
    ) d
    GROUP BY usuario_id
  ) t;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'O T14c ficou sem outra pessoa com horas no mes (a Bruna deveria ter duas batidas)';
  END IF;

  SELECT string_agg(id::text || ':' || ajuste_manual::text || ':' || coalesce(motivo_ajuste, '-'), ',' ORDER BY id)
    INTO v_marcas_antes
  FROM public.ponto_registros WHERE usuario_id = v_caio AND dia_civil = v_dia;
  SELECT count(*) INTO v_antes FROM public.ponto_correcoes WHERE usuario_id = v_caio AND natureza = 'sistema';
  v_pid_dia := gen_random_uuid();
  v_cam_dia := v_caio::text || '/' || v_mes || '/' || v_pid_dia::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_cam_dia, v_caio, v_caio::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
  INSERT INTO public.ponto_pedidos_atraso (id, usuario_id, horario_declarado, dia_civil, motivo, selfie_path, latitude, longitude, precisao_metros)
  VALUES (v_pid_dia, v_caio, v_h_dia, v_dia, 'teste do banco - cheguei e o celular estava sem bateria', v_cam_dia,
          v_local.latitude, v_local.longitude, 8);

  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_decidir_pedido_atraso(v_pid_dia, true, 'teste do banco - conferido na camera');
  RESET ROLE;

  SELECT * INTO v_reg FROM public.ponto_registros WHERE pedido_atraso_id = v_pid_dia;
  SELECT * INTO v_ped FROM public.ponto_pedidos_atraso WHERE id = v_pid_dia;
  v_ok := v_resp ->> 'estado' = 'aprovado'
          AND v_reg.registrado_em = v_h_dia AND v_reg.dia_civil = v_dia
          AND v_reg.tipo = 'entrada' AND v_reg.ordem_no_dia = 1
          AND v_reg.origem = 'ajuste_admin' AND v_reg.ajuste_manual AND v_reg.criado_por = v_rita
          AND v_reg.motivo_ajuste = 'Batida em atraso aprovada: teste do banco - cheguei e o celular estava sem bateria'
          AND v_reg.selfie_path = v_cam_dia AND v_reg.no_local AND v_reg.distancia_metros = 0
          AND v_ped.registro_id = v_reg.id AND v_ped.decidido_por = v_rita
          AND v_ped.motivo_decisao = 'teste do banco - conferido na camera';
  v_res := v_res || format('%s T14a aprovar cria a batida no horario declarado: tipo=%s ordem=%s origem=%s ajuste=%s ligada=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_reg.tipo, v_reg.ordem_no_dia, v_reg.origem,
    v_reg.ajuste_manual, v_ped.registro_id = v_reg.id);

  SELECT string_agg(tipo || ':' || ordem_no_dia, ',' ORDER BY registrado_em) INTO v_tipos
  FROM public.ponto_registros WHERE usuario_id = v_caio AND dia_civil = v_dia;
  SELECT string_agg(id::text || ':' || ajuste_manual::text || ':' || coalesce(motivo_ajuste, '-'), ',' ORDER BY id)
    INTO v_marcas_depois
  FROM public.ponto_registros WHERE usuario_id = v_caio AND dia_civil = v_dia AND id <> v_reg.id;
  v_ok := v_tipos = 'entrada:1,saida_almoco:2,volta_almoco:3,saida:4,extra:5'
          AND v_marcas_depois = v_marcas_antes
          AND EXISTS (SELECT 1 FROM public.ponto_registros r
                      WHERE r.id = v_app_caio AND r.origem = 'app' AND NOT r.ajuste_manual AND r.motivo_ajuste IS NULL);
  SELECT count(*) INTO v_n FROM public.ponto_correcoes
   WHERE usuario_id = v_caio AND natureza = 'sistema';
  v_ok := v_ok AND v_n - v_antes = 5
          AND NOT EXISTS (SELECT 1 FROM public.ponto_correcoes c
                          WHERE c.usuario_id = v_caio AND c.natureza = 'sistema'
                            AND c.criado_em >= now()
                            AND (c.campos <> ARRAY['tipo', 'ordem_no_dia'] OR c.motivo NOT LIKE 'Reordenacao do dia pelo relogio%'));
  v_res := v_res || format('%s T14b dia reordenado pelo relogio: %s; trilha sistema +%s; as outras com a marca e o motivo de antes, a do app sem ajuste',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_tipos, v_n - v_antes);

  -- As horas das outras pessoas não mudaram.
  SELECT md5(coalesce(string_agg(usuario_id::text || '=' || minutos::text, ',' ORDER BY usuario_id), '')) INTO v_horas_depois
  FROM (
    SELECT usuario_id, sum(minutos) AS minutos
    FROM (
      SELECT usuario_id, dia_civil,
             CASE WHEN count(*) % 2 = 1 THEN 0
                  ELSE round(sum(CASE WHEN n % 2 = 0 THEN ms ELSE -ms END) / 60000.0) END AS minutos
      FROM (
        SELECT usuario_id, dia_civil,
               floor(extract(epoch FROM registrado_em) * 1000) AS ms,
               row_number() OVER (PARTITION BY usuario_id, dia_civil ORDER BY registrado_em) AS n
        FROM public.ponto_registros
        WHERE usuario_id <> v_caio AND usuario_id <> v_ana
          AND dia_civil >= v_mes_ini AND dia_civil < v_mes_fim
      ) b
      GROUP BY usuario_id, dia_civil
    ) d
    GROUP BY usuario_id
  ) t;
  v_res := v_res || format('%s T14c horas do mes (%s) das outras pessoas identicas antes e depois da aprovacao',
    CASE WHEN v_horas_antes = v_horas_depois THEN 'OK' ELSE 'FALHOU' END, to_char(v_mes_ini, 'MM/YYYY'));

  -- T15. Sem a selfie no bucket, a aprovação é recusada e o pedido continua pendente.
  INSERT INTO public.ponto_pedidos_atraso (id, usuario_id, horario_declarado, dia_civil, motivo, selfie_path, latitude, longitude)
  VALUES (gen_random_uuid(), v_caio, v_h_dia - interval '1 minute', v_dia, 'teste do banco - a selfie sumiu',
          v_caio::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg', v_local.latitude, v_local.longitude)
  RETURNING * INTO v_ped;
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_decidir_pedido_atraso(v_ped.id, true, NULL);
    v_res := v_res || format('FALHOU T15 aprovou sem selfie: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T15 aprovacao sem selfie recusada',
      CASE WHEN SQLERRM LIKE 'Selfie do pedido nao esta mais no bucket%' THEN 'OK' ELSE 'FALHOU' END);
  END;

  -- T16. A ligação não se forja: INSERT de admin com pedido_atraso_id.
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste, pedido_atraso_id, selfie_path)
    VALUES (v_caio, v_ped.horario_declarado, 'teste do banco - forjar ligacao', v_ped.id, v_ped.selfie_path);
    v_res := v_res || 'FALHOU T16 batida ligada a pedido pendente foi aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T16 ligacao forjada recusada',
      CASE WHEN SQLERRM LIKE 'Batida ligada a pedido de atraso so nasce da aprovacao%' THEN 'OK' ELSE 'FALHOU' END);
  END;

  -- T17. A ligação não muda num UPDATE (congelada em silêncio, ou o UPDATE
  --      inteiro recusado pelo gatilho de motivo e marca). Os dois desfechos
  --      valem: o que se prova aqui é a ligação.
  BEGIN
    UPDATE public.ponto_registros
       SET pedido_atraso_id = NULL, motivo_ajuste = 'teste do banco - tentar desligar'
     WHERE id = v_reg.id;
    v_t17 := 'congelada em silencio';
  EXCEPTION WHEN OTHERS THEN
    v_t17 := CASE WHEN SQLERRM LIKE 'Motivo da batida so muda junto com a correcao%'
                  THEN 'UPDATE recusado pelo gatilho de motivo e marca'
                  ELSE 'erro inesperado: ' || left(SQLERRM, 60) END;
  END;
  RESET ROLE;
  SELECT * INTO v_reg FROM public.ponto_registros WHERE id = v_reg.id;
  v_res := v_res || format('%s T17 ligacao congelada: pedido_atraso_id=%s (%s)',
    CASE WHEN v_reg.pedido_atraso_id = v_pid_dia AND v_t17 NOT LIKE 'erro inesperado%' THEN 'OK' ELSE 'FALHOU' END,
    v_reg.pedido_atraso_id IS NOT NULL, v_t17);

  -- T18. Correção de horário do admin que troca a ordem (a batida mais tarde
  --      do dia, a do app, vai para antes de todas): o dia é reordenado; a
  --      corrigida tem trilha 'admin', as outras só 'sistema', e nenhuma delas
  --      troca de marca nem de motivo.
  SELECT * INTO v_mais_tarde FROM public.ponto_registros
   WHERE usuario_id = v_caio AND dia_civil = v_dia ORDER BY registrado_em DESC LIMIT 1;
  SELECT string_agg(id::text || ':' || ajuste_manual::text || ':' || coalesce(motivo_ajuste, '-'), ',' ORDER BY id)
    INTO v_marcas_antes
  FROM public.ponto_registros WHERE usuario_id = v_caio AND dia_civil = v_dia AND id <> v_mais_tarde.id;
  SELECT count(*) INTO v_antes FROM public.ponto_correcoes WHERE usuario_id = v_caio;
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_registros
     SET registrado_em = v_h_dia - interval '30 seconds',
         motivo_ajuste = 'teste do banco - horario corrigido para antes de todas'
   WHERE id = v_mais_tarde.id;
  RESET ROLE;
  SELECT string_agg(tipo || ':' || ordem_no_dia, ',' ORDER BY registrado_em) INTO v_tipos
  FROM public.ponto_registros WHERE usuario_id = v_caio AND dia_civil = v_dia;
  SELECT * INTO v_mais_tarde FROM public.ponto_registros WHERE id = v_mais_tarde.id;
  SELECT string_agg(id::text || ':' || ajuste_manual::text || ':' || coalesce(motivo_ajuste, '-'), ',' ORDER BY id)
    INTO v_marcas_depois
  FROM public.ponto_registros WHERE usuario_id = v_caio AND dia_civil = v_dia AND id <> v_mais_tarde.id;
  v_ok := v_tipos = 'entrada:1,saida_almoco:2,volta_almoco:3,saida:4,extra:5'
          AND v_mais_tarde.id = v_app_caio
          AND v_mais_tarde.tipo = 'entrada' AND v_mais_tarde.ajuste_manual
          AND v_marcas_depois = v_marcas_antes
          AND EXISTS (SELECT 1 FROM public.ponto_correcoes c WHERE c.registro_id = v_mais_tarde.id
                        AND c.natureza = 'admin' AND 'registrado_em' = ANY (c.campos))
          AND (SELECT count(*) FROM public.ponto_correcoes c WHERE c.usuario_id = v_caio) - v_antes >= 5;
  v_res := v_res || format('%s T18 correcao de horario reordena o dia: %s; corrigida=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_tipos, v_mais_tarde.tipo);

  -- T19. O pedido não se corrige e a decisão não se desfaz (nem pelo dono das
  --      tabelas).
  BEGIN
    UPDATE public.ponto_pedidos_atraso SET motivo = 'teste do banco - motivo trocado depois' WHERE id = v_pid_dia;
    v_res := v_res || 'FALHOU T19a pedido corrigido'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE 'Pedido de batida em atraso nao se corrige%';
    BEGIN
      UPDATE public.ponto_pedidos_atraso SET estado = 'recusado', motivo_decisao = 'teste do banco - voltar atras' WHERE id = v_pid_dia;
      v_ok := false;
    EXCEPTION WHEN OTHERS THEN
      v_ok := v_ok AND SQLERRM LIKE 'Pedido de batida em atraso ja decidido%';
    END;
    v_res := v_res || format('%s T19 pedido nao se corrige e decisao nao se desfaz',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);
  END;

  -- T20. O que a API alcança.
  v_ok := has_table_privilege('authenticated', 'public.ponto_pedidos_atraso', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.ponto_pedidos_atraso', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.ponto_pedidos_atraso', 'UPDATE')
      AND NOT has_table_privilege('anon', 'public.ponto_pedidos_atraso', 'SELECT')
      -- Nenhum privilégio além da leitura para o app, de qualquer tipo.
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = 'public.ponto_pedidos_atraso'::regclass
          AND (a.grantee = 0
               OR a.grantee = 'anon'::regrole
               OR (a.grantee = 'authenticated'::regrole AND a.privilege_type <> 'SELECT')))
      AND NOT has_function_privilege('authenticated', 'public.ponto_reordenar_dia(uuid,date)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.ponto_decidir_pedido_atraso(uuid,boolean,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.ponto_pedir_batida_em_atraso(text,uuid,text,double precision,double precision,double precision,timestamptz,text,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.ponto_pedir_batida_em_atraso(text,uuid,text,double precision,double precision,double precision,timestamptz,text,text)', 'EXECUTE')
      -- O gatilho de guarda pega o apagar de linha (bit 8) e o esvaziar (bit 32).
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ponto_pedidos_atraso'::regclass
                    AND tgname = 'trg_ponto_pedido_atraso_guardar' AND (tgtype & 8) = 8 AND tgenabled = 'O')
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ponto_pedidos_atraso'::regclass
                    AND tgname = 'trg_ponto_pedido_atraso_nao_esvazia' AND (tgtype & 32) = 32 AND tgenabled = 'O');
  v_res := v_res || format('%s T20 privilegios: o app so le pedidos; gatilhos de apagar e de esvaziar ligados',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- T21. Nenhum canal do sistema ficou aberto.
  v_res := v_res || format('%s T21 canal do sistema fechado no fim',
    CASE WHEN nullif(btrim(coalesce(current_setting('ponto.operacao_do_sistema', true), '')), '') IS NULL
         THEN 'OK' ELSE 'FALHOU' END);

  -- ========================================================================
  -- SEM LOCALIZAÇÃO: quando o GPS do aparelho não responde, o pedido sai sem
  -- coordenada, com selfie e PIN, e a aprovação cria a batida sem
  -- localização. Argumentos por nome, como o PostgREST manda.
  -- ========================================================================
  v_pid_gps := gen_random_uuid();
  v_h_gps   := v_livre;
  v_cam_gps := v_ana::text || '/' || v_mes || '/' || v_pid_gps::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_cam_gps, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
  SELECT tentativas_falhas INTO v_falhas FROM public.ponto_pin WHERE usuario_id = v_ana;
  SELECT count(*) INTO v_antes FROM public.ponto_pin_tentativas WHERE usuario_id = v_ana;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T22. Sem coordenada e sem motivo (o app que não manda o parâmetro) e com
  --      meia coordenada: a recusa de sempre, antes do PIN.
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(p_pin => c_pin, p_pedido_id => v_pid_gps, p_selfie_path => v_cam_gps,
                p_latitude => NULL, p_longitude => NULL, p_precisao_metros => NULL,
                p_horario_declarado => v_h_gps, p_motivo => 'teste do banco - o GPS nao respondeu');
    v_res := v_res || format('FALHOU T22a pedido sem coordenada e sem motivo aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T22a pedido sem coordenada e sem motivo recusado (%s)',
      CASE WHEN SQLERRM = 'Pedido de batida em atraso exige latitude e longitude' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(p_pin => c_pin, p_pedido_id => v_pid_gps, p_selfie_path => v_cam_gps,
                p_latitude => v_local.latitude, p_longitude => NULL, p_precisao_metros => NULL,
                p_horario_declarado => v_h_gps, p_motivo => 'teste do banco - o GPS nao respondeu',
                p_sem_localizacao => 'demora');
    v_res := v_res || format('FALHOU T22b pedido com meia coordenada aceito: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T22b pedido com meia coordenada recusado (%s)',
      CASE WHEN SQLERRM = 'Pedido de batida em atraso exige latitude e longitude' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;

  -- T23. O GPS demorou: o pedido grava pendente, com a selfie, sem coordenada,
  --      precisão (a que veio é descartada), distância, marca e local; as
  --      recusas do T22 não contaram tentativa de PIN.
  v_resp := public.ponto_pedir_batida_em_atraso(p_pin => c_pin, p_pedido_id => v_pid_gps, p_selfie_path => v_cam_gps,
              p_latitude => NULL, p_longitude => NULL, p_precisao_metros => 25,
              p_horario_declarado => v_h_gps, p_motivo => 'teste do banco - o GPS nao respondeu',
              p_sem_localizacao => 'demora');
  RESET ROLE;
  SELECT * INTO v_ped FROM public.ponto_pedidos_atraso WHERE id = v_pid_gps;
  SELECT count(*) INTO v_n FROM public.ponto_pin_tentativas WHERE usuario_id = v_ana;
  SELECT tentativas_falhas INTO v_falhas2 FROM public.ponto_pin WHERE usuario_id = v_ana;
  v_ok := coalesce((v_resp ->> 'gravado')::boolean, false) AND v_ped.estado = 'pendente'
          AND v_ped.horario_declarado = v_h_gps AND v_ped.selfie_path = v_cam_gps
          AND v_ped.latitude IS NULL AND v_ped.longitude IS NULL AND v_ped.precisao_metros IS NULL
          AND v_ped.distancia_metros IS NULL AND v_ped.no_local IS NULL AND v_ped.local_id IS NULL
          AND v_resp -> 'pedido' ->> 'latitude' IS NULL AND v_resp -> 'pedido' ->> 'no_local' IS NULL
          AND v_n = v_antes + 1 AND v_falhas2 = v_falhas;
  v_res := v_res || format('%s T23 pedido sem localizacao (GPS demorou): gravado=%s estado=%s coordenada nula=%s local nulo=%s tentativas de PIN +%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_resp ->> 'gravado', v_ped.estado,
    v_ped.latitude IS NULL AND v_ped.longitude IS NULL, v_ped.local_id IS NULL, v_n - v_antes);

  -- T24. A aprovação cria a batida sem localização, ligada ao pedido, no
  --      horário declarado; e o canal do sistema fecha de novo.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_decidir_pedido_atraso(v_pid_gps, true, 'teste do banco - conferido na camera, sem GPS');
  RESET ROLE;
  SELECT * INTO v_reg FROM public.ponto_registros WHERE pedido_atraso_id = v_pid_gps;
  SELECT * INTO v_ped FROM public.ponto_pedidos_atraso WHERE id = v_pid_gps;
  v_ok := v_resp ->> 'estado' = 'aprovado' AND v_reg.id IS NOT NULL AND v_ped.registro_id = v_reg.id
          AND v_reg.usuario_id = v_ana AND v_reg.registrado_em = v_h_gps
          AND v_reg.origem = 'ajuste_admin' AND v_reg.ajuste_manual AND v_reg.criado_por = v_rita
          AND v_reg.motivo_ajuste = 'Batida em atraso aprovada: teste do banco - o GPS nao respondeu'
          AND v_reg.selfie_path = v_cam_gps
          AND v_reg.latitude IS NULL AND v_reg.longitude IS NULL AND v_reg.precisao_metros IS NULL
          AND v_reg.distancia_metros IS NULL AND v_reg.no_local IS NULL AND v_reg.local_id IS NULL
          AND nullif(btrim(coalesce(current_setting('ponto.operacao_do_sistema', true), '')), '') IS NULL;
  v_res := v_res || format('%s T24 aprovar o pedido sem localizacao cria a batida sem localizacao: origem=%s ajuste=%s ligada=%s coordenada nula=%s marca nula=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_reg.origem, v_reg.ajuste_manual, v_ped.registro_id = v_reg.id,
    v_reg.latitude IS NULL AND v_reg.longitude IS NULL, v_reg.no_local IS NULL);

  -- ========================================================================
  -- T25. O TETO DE PEDIDOS PENDENTES DO DIA: quatro por pessoa. Com quatro
  --      pendentes hoje (inseridos aqui com a forma que a RPC daria), o quinto
  --      é recusado com a frase própria, antes do PIN (nenhuma tentativa
  --      conta). Recusado um deles, a fila anda e o pedido passa.
  -- ========================================================================
  SELECT count(*) INTO v_n FROM public.ponto_pedidos_atraso WHERE usuario_id = v_ana AND estado = 'pendente';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'O T25 esperava a Ana sem pedido pendente (tem %)', v_n;
  END IF;
  INSERT INTO public.ponto_pedidos_atraso (id, usuario_id, horario_declarado, dia_civil, motivo, selfie_path, latitude, longitude)
  SELECT gen_random_uuid(), v_ana, v_minuto - interval '4 minutes' + make_interval(secs => k * 5), v_dia,
         'teste do banco - pedido pendente da fila ' || k,
         v_ana::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg', v_local.latitude, v_local.longitude
  FROM generate_series(1, 4) k;
  v_pid_rec := gen_random_uuid();
  v_cam_rec := v_ana::text || '/' || v_mes || '/' || v_pid_rec::text || '.jpg';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('ponto-selfies', v_cam_rec, v_ana, v_ana::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
  SELECT count(*) INTO v_antes FROM public.ponto_pin_tentativas WHERE usuario_id = v_ana;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid_rec, v_cam_rec,
                v_local.latitude, v_local.longitude, 10, v_hoje_h,
                'teste do banco - o quinto pedido do dia');
    v_t17 := 'o quinto pedido entrou: ' || left(v_resp::text, 40);
  EXCEPTION WHEN OTHERS THEN
    v_t17 := CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE 'Pedidos pendentes demais hoje%' THEN NULL
                  ELSE SQLSTATE || ' ' || left(SQLERRM, 60) END;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.ponto_pin_tentativas WHERE usuario_id = v_ana;
  v_ok := v_t17 IS NULL AND v_n = v_antes
      AND NOT EXISTS (SELECT 1 FROM public.ponto_pedidos_atraso WHERE id = v_pid_rec);
  -- Quem administra recusa um da fila: o quinto passa.
  SELECT * INTO v_ped FROM public.ponto_pedidos_atraso
   WHERE usuario_id = v_ana AND estado = 'pendente' ORDER BY horario_declarado LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_resp := public.ponto_decidir_pedido_atraso(v_ped.id, false, 'teste do banco - repetido, um basta');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(c_pin, v_pid_rec, v_cam_rec,
                v_local.latitude, v_local.longitude, 10, v_hoje_h,
                'teste do banco - o quinto pedido do dia');
  EXCEPTION WHEN OTHERS THEN
    v_resp := jsonb_build_object('erro', left(SQLERRM, 60));
  END;
  RESET ROLE;
  v_ok := v_ok AND coalesce((v_resp ->> 'gravado')::boolean, false);
  v_res := v_res || format('%s T25 teto de 4 pedidos pendentes no dia: o quinto recusado antes do PIN (%s; tentativas +%s); com um recusado, passa (%s)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, coalesce(v_t17, 'com a frase propria'), v_n - v_antes,
    coalesce(v_resp ->> 'erro', 'gravado=' || (v_resp ->> 'gravado')));

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
