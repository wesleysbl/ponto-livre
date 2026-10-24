-- TESTE DE BANCO — O LOCAL À PROVA DE ERRO
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- local.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve, mede e DESFAZ no
-- fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma linha por
-- caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco `$conferir$`
-- (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA
--   • o carimbo de quem mediu (`trg_ponto_local_carimbar_medicao`): mudar a
--     coordenada ou o raio carimba a sessão e o instante; mudar só o nome não
--     carimba; o cliente não forja `medido_por` nem `medido_em`; local novo
--     nasce carimbado; quem não administra o ponto não muda o local;
--   • o app lê o local com as colunas de sempre, e há um só local ativo;
--   • a distância gravada na batida é congelada (mudar o local não a
--     reescreve), e recalculá-la é operação do sistema: uma linha de trilha
--     por batida, só distância, marca e local, sem marca de ajuste e sem mexer
--     em horário, dia, tipo ou ordem;
--   • privilégios: o gatilho não é chamável pelo app; o local não se esvazia.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. O recálculo do
-- T9 roda como ele, com o canal do sistema aberto, como uma migration faria.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto. Quem mede é a Rita, do RH, que administra e não é
-- super admin; a Ana e a Bruna têm ficha, não administram, e cada uma tem uma
-- batida do app (sem sessão e sem horário: o carimbo dá o horário do servidor
-- e a origem app). Num banco que já tem dados, o teste usa o local ativo que
-- houver; senão, cria um.
--
-- O QUE ELE NÃO TEM, DE PROPÓSITO: nenhum DELETE e nenhum TRUNCATE.
--
-- SESSÃO FORJADA: o JWT vai em `request.jwt.claims` com `sub` e `role`, e o
-- papel muda com `SET LOCAL ROLE authenticated`.

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
  c_motivo   constant text := 'teste do banco - recalculo da distancia contra o local movido';
  v_res      text[] := '{}';
  -- As pessoas (elenco fictício).
  v_rita     uuid := gen_random_uuid();   -- RH: mede o local
  v_ana      uuid := gen_random_uuid();   -- não administra; tem uma batida
  v_bruna    uuid := gen_random_uuid();   -- não administra; tem uma batida
  v_local    public.ponto_local%ROWTYPE;
  v_depois   public.ponto_local%ROWTYPE;
  v_novo     public.ponto_local%ROWTYPE;
  v_bat_ana  uuid;
  v_bat_bruna uuid;
  v_dist_antes  text;
  v_dist_movido text;
  v_dist_depois text;
  v_esperado text;
  v_n        bigint;
  v_m        bigint;
  v_ok       boolean;
  v_pode     boolean;
BEGIN
  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria).
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_rita,  'authenticated', 'authenticated', 'rita.teste@example.invalid',  '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,   'authenticated', 'authenticated', 'ana.teste@example.invalid',   '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_bruna, 'authenticated', 'authenticated', 'bruna.teste@example.invalid', '{}', '{"full_name": "Bruna Costa"}',       now(), now());
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: o RH mede o local');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
  VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas'),
         (v_bruna, 'Bruna Costa', 'Compras');

  -- O local: o ativo da instalação, se houver; senão, um sintético.
  SELECT * INTO v_local FROM public.ponto_local WHERE ativo ORDER BY criado_em LIMIT 1;
  IF v_local.id IS NULL THEN
    INSERT INTO public.ponto_local (nome, latitude, longitude, raio_metros)
    VALUES ('Sede da Empresa Exemplo', -23.550520, -46.633308, 150)
    RETURNING * INTO v_local;
  END IF;

  -- As batidas do app: a da Ana a uns 100 m do local, a da Bruna no local.
  INSERT INTO public.ponto_registros (usuario_id, latitude, longitude, precisao_metros)
  VALUES (v_ana, v_local.latitude + 0.0009, v_local.longitude, 10)
  RETURNING id INTO v_bat_ana;
  INSERT INTO public.ponto_registros (usuario_id, latitude, longitude, precisao_metros)
  VALUES (v_bruna, v_local.latitude, v_local.longitude, 10)
  RETURNING id INTO v_bat_bruna;
  SELECT string_agg(id::text || '=' || coalesce(distancia_metros::text, '-') || '/' || coalesce(no_local::text, '-'), ',' ORDER BY id)
    INTO v_dist_antes
  FROM public.ponto_registros WHERE id IN (v_bat_ana, v_bat_bruna);

  -- =========================================================================
  -- O CARIMBO DE QUEM MEDIU, com sessão de admin (o que a tela faz)
  -- =========================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T1. Mudar a coordenada carimba quem e quando.
  UPDATE public.ponto_local
     SET latitude = v_local.latitude + 0.000001
   WHERE id = v_local.id
  RETURNING * INTO v_depois;
  v_ok := v_depois.medido_por = v_rita AND v_depois.medido_em = now()
          AND v_depois.latitude = v_local.latitude + 0.000001;
  v_res := v_res || format('%s T1 coordenada nova carimba: medido_por e o admin=%s, medido_em=now()=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_depois.medido_por = v_rita, v_depois.medido_em = now());

  -- T2. Sem sessão (migration, backend) o carimbo fica sem autor; e mudar só o
  --     raio, com sessão, carimba de novo (a medição inclui o raio).
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  UPDATE public.ponto_local
     SET latitude = v_local.latitude
   WHERE id = v_local.id
  RETURNING * INTO v_depois;
  v_ok := v_depois.medido_por IS NULL AND v_depois.medido_em = now();
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_local
     SET raio_metros = v_local.raio_metros + 1
   WHERE id = v_local.id
  RETURNING * INTO v_depois;
  v_ok := v_ok AND v_depois.medido_por = v_rita AND v_depois.medido_em = now();
  v_res := v_res || format('%s T2 sem sessao carimba sem autor; raio novo com sessao carimba o admin=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_depois.medido_por = v_rita);

  -- T3. Mudar só o nome não carimba, e o cliente não forja as duas colunas.
  UPDATE public.ponto_local
     SET nome = 'teste do banco - so o nome',
         medido_por = gen_random_uuid(),
         medido_em = '2000-01-01 00:00:00+00'
   WHERE id = v_local.id
  RETURNING * INTO v_novo;
  v_ok := v_novo.nome = 'teste do banco - so o nome'
          AND v_novo.medido_por IS NOT DISTINCT FROM v_depois.medido_por
          AND v_novo.medido_em IS NOT DISTINCT FROM v_depois.medido_em;
  v_res := v_res || format('%s T3 so o nome (com medido_* forjados): medicao intacta=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_ok);

  -- T4. Local novo nasce carimbado pela sessão, e o valor do cliente é ignorado.
  INSERT INTO public.ponto_local (nome, latitude, longitude, raio_metros, ativo, medido_por, medido_em)
  VALUES ('teste do banco - local novo', -23.561400, -46.655900, 100, false, gen_random_uuid(), '2000-01-01 00:00:00+00')
  RETURNING * INTO v_novo;
  v_ok := v_novo.medido_por = v_rita AND v_novo.medido_em = now();
  v_res := v_res || format('%s T4 local novo carimbado pela sessao: medido_por e o admin=%s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_novo.medido_por = v_rita);

  -- T5. O app lê o local com as colunas de sempre, e há um só ativo (o índice
  --     idx_ponto_local_um_ativo).
  SELECT count(*) INTO v_n
  FROM (SELECT id, nome, latitude, longitude, raio_metros, ativo FROM public.ponto_local WHERE ativo) l;
  v_res := v_res || format('%s T5 leitura do local pelo app: %s linha(s) ativa(s)',
    CASE WHEN v_n = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);
  RESET ROLE;

  -- T6. Quem não administra o ponto não muda o local (a RLS esconde a linha:
  --     zero linhas, sem erro), e por isso não carimba nada.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_pode := public.ponto_pode_administrar();
  UPDATE public.ponto_local SET latitude = 0 WHERE id = v_local.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  v_res := v_res || format('%s T6 quem nao administra nao muda o local: %s linha(s) alterada(s)',
    CASE WHEN v_n = 0 AND NOT v_pode THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- =========================================================================
  -- A DISTÂNCIA CONGELADA E O RECÁLCULO PELO CANAL DO SISTEMA
  -- =========================================================================
  -- T9. O RH muda o local de lugar (uns 1,1 km): as batidas que já existiam
  --     guardam a distância e a marca de quando foram feitas. Recalcular é
  --     operação do sistema (como uma migration faria depois de trocar o
  --     local): uma linha de trilha 'sistema' por batida, só distância, marca
  --     e local; horário, dia, tipo, ordem, marca de ajuste e motivo ficam.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ponto_local SET latitude = v_local.latitude + 0.01 WHERE id = v_local.id;
  RESET ROLE;
  SELECT string_agg(id::text || '=' || coalesce(distancia_metros::text, '-') || '/' || coalesce(no_local::text, '-'), ',' ORDER BY id)
    INTO v_dist_movido
  FROM public.ponto_registros WHERE id IN (v_bat_ana, v_bat_bruna);

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.ponto_abrir_operacao_do_sistema(c_motivo);
  UPDATE public.ponto_registros r
     SET distancia_metros = round(public.ponto_distancia_metros(r.latitude, r.longitude, l.latitude, l.longitude)::numeric, 2)::double precision,
         no_local         = round(public.ponto_distancia_metros(r.latitude, r.longitude, l.latitude, l.longitude)::numeric, 2)::double precision <= l.raio_metros,
         local_id         = l.id
    FROM public.ponto_local l
   WHERE l.id = v_local.id AND r.id IN (v_bat_ana, v_bat_bruna);
  PERFORM public.ponto_fechar_operacao_do_sistema();

  SELECT string_agg(r.id::text || '=' || coalesce(r.distancia_metros::text, '-') || '/' || coalesce(r.no_local::text, '-'), ',' ORDER BY r.id),
         string_agg(r.id::text || '=' || round(public.ponto_distancia_metros(r.latitude, r.longitude, l.latitude, l.longitude)::numeric, 2)::double precision::text
                    || '/' || (round(public.ponto_distancia_metros(r.latitude, r.longitude, l.latitude, l.longitude)::numeric, 2)::double precision <= l.raio_metros)::text,
                    ',' ORDER BY r.id)
    INTO v_dist_depois, v_esperado
  FROM public.ponto_registros r, public.ponto_local l
  WHERE l.id = v_local.id AND r.id IN (v_bat_ana, v_bat_bruna);

  SELECT count(*), count(DISTINCT registro_id) INTO v_n, v_m
  FROM public.ponto_correcoes
  WHERE motivo = c_motivo AND natureza = 'sistema';
  v_ok := v_dist_movido = v_dist_antes AND v_dist_depois = v_esperado AND v_dist_depois <> v_dist_antes
          AND v_n = 2 AND v_m = 2;
  SELECT count(*) INTO v_n
  FROM public.ponto_correcoes
  WHERE motivo = c_motivo
    AND (   (valores_depois ->> 'ajuste_manual') IS DISTINCT FROM (valores_antes ->> 'ajuste_manual')
         OR (valores_depois ->> 'ajuste_manual')::boolean
         OR NOT (campos <@ ARRAY['distancia_metros', 'no_local', 'local_id'])
         OR (valores_depois -> 'registrado_em') IS DISTINCT FROM (valores_antes -> 'registrado_em')
         OR (valores_depois -> 'dia_civil')     IS DISTINCT FROM (valores_antes -> 'dia_civil')
         OR (valores_depois -> 'tipo')          IS DISTINCT FROM (valores_antes -> 'tipo')
         OR (valores_depois -> 'ordem_no_dia')  IS DISTINCT FROM (valores_antes -> 'ordem_no_dia')
         OR (valores_depois -> 'motivo_ajuste') IS DISTINCT FROM (valores_antes -> 'motivo_ajuste')
         OR natureza <> 'sistema');
  v_res := v_res || format('%s T9 distancia congelada ao mover o local=%s; recalculo pelo canal do sistema (%s batida(s), uma linha cada=%s): %s linha(s) fora da regra',
    CASE WHEN v_ok AND v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_dist_movido = v_dist_antes, v_m, v_ok, v_n);

  -- =========================================================================
  -- PRIVILÉGIOS
  -- =========================================================================
  -- T11. Gatilho fora do alcance do app; local sem esvaziar nem estrutura.
  v_ok := NOT has_function_privilege('authenticated', 'public.ponto_local_carimbar_medicao()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.ponto_local_carimbar_medicao()', 'EXECUTE')
      AND NOT has_table_privilege('authenticated', 'public.ponto_local', 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', 'public.ponto_local', 'TRIGGER')
      AND NOT has_table_privilege('authenticated', 'public.ponto_local', 'REFERENCES')
      AND NOT has_table_privilege('anon', 'public.ponto_local', 'SELECT');
  v_res := v_res || format('%s T11 privilegios do local e do gatilho',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- T12. O gatilho está ligado no evento certo (BEFORE INSERT OR UPDATE, de linha).
  SELECT count(*) INTO v_n
  FROM pg_trigger
  WHERE tgrelid = 'public.ponto_local'::regclass
    AND tgname = 'trg_ponto_local_carimbar_medicao' AND tgenabled = 'O' AND tgtype = 23;
  v_res := v_res || format('%s T12 gatilho de medicao ligado',
    CASE WHEN v_n = 1 THEN 'OK' ELSE 'FALHOU' END);

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
