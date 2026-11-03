-- TESTE DE BANCO: A AUSÊNCIA POR HORÁRIO E A TRAVA DA PRÓPRIA AUSÊNCIA
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- ausencia_por_horario.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve, mede e DESFAZ no
-- fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma linha por
-- caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco `$conferir$`
-- (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA (a migration `..._ausencia_por_horario.sql`)
--   • O lançamento por horário (T1 a T25): o app que está no celular (as sete
--     colunas de sempre) continua lançando por dias; 14:00-16:00 entra, e
--     16:00-16:30 e 13:00-14:00 também (encostando); dois intervalos no mesmo
--     dia entram; todo intervalo que cruza é recusado com o intervalo cruzado
--     (por dentro, por fora, igual, um minuto dentro); horário em dia coberto
--     por ausência por dias, e por dias sobre um dia com horário, são
--     recusados; por dias sobre por dias, com a frase de sempre; cada regra da
--     modalidade com a frase dela; a sobreposição é por pessoa; a trava por
--     pessoa continua; a cancelada não conta; o app não muda a hora nem a
--     modalidade.
--   • A trava da própria ausência (P1 a P12): ninguém lança ausência para a
--     própria conta nem cancela a própria ausência, nem quem administra, nem
--     o super admin, nem pelo upsert; a ausência de outra pessoa continua
--     aceita e cancelável pelos dois; editar (cancelar e lançar de novo) fica
--     com outra pessoa; sem sessão, a ausência continua exigindo sessão.
--   • Quem bate e a chave pública (T26 a T29): a pessoa lê a própria ausência
--     por horário e nenhuma alheia, e não lança; anon sem nada; os privilégios
--     por coluna.
--   • Sem a ajuda da RLS e dos privilégios (T30 a T33): nem o dono das tabelas
--     muda a hora ou a modalidade de uma ausência lançada; sem o gatilho, os
--     CHECKs seguram a modalidade; o gatilho é o da migration; e as ausências
--     que já existiam continuam iguais, linha a linha.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. Os casos T30 a T33
-- e P12 rodam como ele: sem a ajuda da RLS e dos privilégios, só o gatilho e os
-- CHECKs. O T31 desliga o gatilho das ausências (ALTER TABLE ... DISABLE
-- TRIGGER, como um restore com os gatilhos desligados faria) e o religa no fim
-- dele.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto; fichas e listas de administração gravadas sem
-- sessão, como a instalação as gravaria. A Rita, do RH, administra e não é
-- super admin; o Sérgio é o super admin; "a pessoa" é a Ana e "a outra" é a
-- Bruna, as duas com ficha que libera acesso e sem administrar. Os dias ficam
-- perto de dez meses atrás, dentro da janela de um ano do gatilho, e as pessoas
-- do teste não têm ausência nenhuma antes dele.
--
-- SESSÃO FORJADA, como o PostgREST faz por requisição: o JWT vai em
-- `request.jwt.claims` com `sub` e `role`, e o papel muda com
-- `SET LOCAL ROLE authenticated` (ou anon). O INSERT por horário é o que o app
-- que lança por horário manda: as sete colunas de sempre mais `modalidade`,
-- `hora_inicio` e `hora_fim`.

BEGIN;
SET LOCAL teste.em_transacao = 'sim';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- A partida: só dentro de BEGIN (fora de uma transação, o SET LOCAL de cima
-- não vale nada), só com a estrutura e a migration da ausência por horário
-- aplicadas e só como `postgres`, sem superusuário (um superusuário passaria
-- por cima do que se quer provar).
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
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.ponto_ausencias'::regclass
                 AND a.attname = 'modalidade' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'A migration da ausencia por horario nao esta aplicada neste banco: rode npm run db:zerar.'
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
  c_dono_lanca   constant text := 'Quem e dono da ausencia nao lanca a propria ausencia: peca a outra pessoa que administra o ponto ou ao super admin';
  c_dono_cancela constant text := 'Quem e dono da ausencia nao cancela a propria ausencia: peca a outra pessoa que administra o ponto ou ao super admin';
  v_res        text[] := '{}';
  -- As pessoas (elenco fictício).
  v_rita       uuid := gen_random_uuid();   -- RH: administra, não é super admin
  v_sergio     uuid := gen_random_uuid();   -- super admin
  v_ana        uuid := gen_random_uuid();   -- a pessoa
  v_bruna      uuid := gen_random_uuid();   -- a outra
  v_hoje       date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_d1         date;   -- o dia dos horários 14:00-16:00, 16:00-16:30 e 13:00-14:00
  v_d2         date;   -- o dia de 08:00-09:00 e 15:00-16:00
  v_d3         date;   -- o começo da ausência por dias do app que está no celular
  v_dp         date;   -- o dia das ausências da Rita e do Sérgio (a trava da própria)
  v_a1         uuid := gen_random_uuid();   -- da Ana, 14:00-16:00 em d1 (cancelada no T24)
  v_a2         uuid := gen_random_uuid();   -- da Ana, 16:00-16:30 em d1
  v_a3         uuid := gen_random_uuid();   -- da Ana, por dias, do app que está no celular, em d3
  v_aus_serg   uuid := gen_random_uuid();   -- do Sérgio, lançada pela Rita
  v_aus_rita   uuid := gen_random_uuid();   -- da Rita, lançada pelo Sérgio
  v_aus_rita2  uuid := gen_random_uuid();   -- da Rita, lançada de novo pelo Sérgio
  v_antes      text;
  v_depois     text;
  v_antigas    bigint;
  v_fora       bigint;
  v_chave      bigint;
  v_aus        public.ponto_ausencias%ROWTYPE;
  v_n          bigint;
  v_ok         boolean;
  v_erro       text;
  v_caso       record;
BEGIN
  v_d1 := v_hoje - 300;
  v_d2 := v_hoje - 299;
  v_d3 := v_hoje - 298;
  v_dp := v_hoje - 250;

  -- As ausências que já existem, cada linha INTEIRA, antes de qualquer
  -- lançamento do teste. O T33 compara no fim.
  SELECT count(*), md5(coalesce(string_agg(to_jsonb(a)::text, E'\n' ORDER BY a.id), ''))
    INTO v_antigas, v_antes FROM public.ponto_ausencias a;

  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria).
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_rita,   'authenticated', 'authenticated', 'rita.teste@example.invalid',   '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_sergio, 'authenticated', 'authenticated', 'sergio.teste@example.invalid', '{}', '{"full_name": "Sérgio Almeida"}',    now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,    'authenticated', 'authenticated', 'ana.teste@example.invalid',    '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_bruna,  'authenticated', 'authenticated', 'bruna.teste@example.invalid',  '{}', '{"full_name": "Bruna Costa"}',       now(), now());
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: o RH lanca as ausencias');
  INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_sergio, 'teste do banco: super admin');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
  VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas'),
         (v_bruna, 'Bruna Costa', 'Compras');

  -- =========================================================================
  -- QUEM ADMINISTRA LANÇA
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T1. O app que está no celular (as sete colunas, sem a modalidade): entra
  --     por dias, como antes.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path)
    VALUES (v_a3, v_ana, v_d3, v_d3 + 2, 'falta_justificada', 'teste do banco - o app de antes', NULL);
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_a3;
    v_ok := v_aus.modalidade = 'dias' AND v_aus.hora_inicio IS NULL AND v_aus.hora_fim IS NULL
            AND v_aus.lancado_por = v_rita AND v_aus.dia_fim = v_d3 + 2;
    v_res := v_res || format('%s T1 o app de antes (sete colunas) lanca por dias: modalidade %s, horas %s/%s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_aus.modalidade, coalesce(v_aus.hora_inicio::text, 'nula'), coalesce(v_aus.hora_fim::text, 'nula'));
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T1 o app de antes nao lanca: ' || SQLERRM);
  END;

  -- T2. 14:00-16:00 por horário.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_a1, v_ana, v_d1, v_d1, 'atestado_medico', 'teste do banco - 14 as 16', 'horario', '14:00', '16:00');
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_a1;
    v_ok := v_aus.modalidade = 'horario' AND v_aus.hora_inicio = '14:00' AND v_aus.hora_fim = '16:00' AND v_aus.lancado_por = v_rita;
    v_res := v_res || format('%s T2 aceita 14:00-16:00: modalidade %s, de %s a %s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_aus.modalidade, v_aus.hora_inicio, v_aus.hora_fim);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T2 14:00-16:00 recusado: ' || SQLERRM);
  END;

  -- T3. 16:00-16:30 no mesmo dia, encostando.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_a2, v_ana, v_d1, v_d1, 'atestado_medico', 'teste do banco - 16 as 16h30', 'horario', '16:00', '16:30');
    v_res := v_res || 'OK T3 aceita 16:00-16:30 no mesmo dia, encostando em 14:00-16:00'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T3 16:00-16:30 encostando recusado: ' || SQLERRM);
  END;

  -- T4. 13:00-14:00, encostando pelo outro lado.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_ana, v_d1, v_d1, 'falta_justificada', 'teste do banco - 13 as 14', 'horario', '13:00', '14:00');
    v_res := v_res || 'OK T4 aceita 13:00-14:00, encostando no inicio de 14:00-16:00'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T4 13:00-14:00 encostando recusado: ' || SQLERRM);
  END;

  -- T5. 08:00-09:00 e 15:00-16:00 no mesmo dia.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_ana, v_d2, v_d2, 'atestado_medico', 'teste do banco - 8 as 9', 'horario', '08:00', '09:00');
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_ana, v_d2, v_d2, 'atestado_medico', 'teste do banco - 15 as 16', 'horario', '15:00', '16:00');
    SELECT count(*) INTO v_n FROM public.ponto_ausencias
     WHERE usuario_id = v_ana AND dia_inicio = v_d2 AND modalidade = 'horario' AND cancelada_em IS NULL;
    v_res := v_res || format('%s T5 aceita 08:00-09:00 e 15:00-16:00 no mesmo dia: %s ausencia(s) no dia',
      CASE WHEN v_n = 2 THEN 'OK' ELSE 'FALHOU' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T5 dois intervalos no mesmo dia recusados: ' || SQLERRM);
  END;

  -- T6 a T10. Os cruzamentos no dia 1 (14:00-16:00, 16:00-16:30 e 13:00-14:00
  -- de pé), cada um com a frase e o primeiro intervalo cruzado.
  FOR v_caso IN
    SELECT * FROM (VALUES
      ('T6 15:00-17:00 sobre 14:00-16:00', '15:00'::time, '17:00'::time, '(de 14:00 a 16:00)'),
      ('T7 14:30-15:00, dentro de 14:00-16:00', '14:30', '15:00', '(de 14:00 a 16:00)'),
      ('T8 12:00-18:00, por fora dos tres', '12:00', '18:00', '(de 13:00 a 14:00)'),
      ('T9 14:00-16:00 de novo, igual', '14:00', '16:00', '(de 14:00 a 16:00)'),
      ('T10 16:29-17:00, um minuto dentro de 16:00-16:30', '16:29', '17:00', '(de 16:00 a 16:30)')
    ) AS c(rotulo, inicio, fim, cruzado)
  LOOP
    BEGIN
      INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
      VALUES (v_ana, v_d1, v_d1, 'atestado_medico', 'teste do banco - cruza', 'horario', v_caso.inicio, v_caso.fim);
      v_res := v_res || ('FALHOU ' || v_caso.rotulo || ': entrou');
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s %s recusado: %s',
        CASE WHEN SQLSTATE = '23P01'
              AND SQLERRM LIKE 'Ja existe ausencia por horario desta pessoa que cruza este horario ' || v_caso.cruzado || ': intervalos que so se encostam valem%'
             THEN 'OK' ELSE 'FALHOU' END, v_caso.rotulo, SQLERRM);
    END;
  END LOOP;

  -- T11. Por horário num dia coberto pela ausência por dias (T1).
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_ana, v_d3 + 1, v_d3 + 1, 'atestado_medico', 'teste do banco - horario em dia inteiro', 'horario', '10:00', '11:00');
    v_res := v_res || 'FALHOU T11 horario em dia coberto por ausencia por dias entrou'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T11 horario em dia coberto por ausencia de dia inteiro recusado: %s',
      CASE WHEN SQLSTATE = '23P01' AND SQLERRM LIKE 'Ja existe ausencia de dia inteiro desta pessoa neste dia%' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- T12. Por dias sobre os dias dos horários (d1 e d2): recusado, com o
  --      primeiro deles.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ana, v_d1 - 2, v_d2, 'falta_justificada', 'teste do banco - dias sobre horario');
    v_res := v_res || 'FALHOU T12 por dias sobre dia com horario entrou'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T12 por dias sobre dia com ausencia por horario recusado: %s',
      CASE WHEN SQLSTATE = '23P01'
            AND SQLERRM LIKE 'Ja existe ausencia por horario desta pessoa em parte deste periodo (dia ' || to_char(v_d1, 'DD/MM/YYYY') || ', de 13:00 a 14:00)%'
           THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- T13. Por dias sobre por dias: a regra e a frase de sempre.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ana, v_d3 + 2, v_d3 + 4, 'falta_justificada', 'teste do banco - dias sobre dias');
    v_res := v_res || 'FALHOU T13 por dias sobre por dias entrou'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T13 por dias sobre por dias recusado com a frase de sempre: %s',
      CASE WHEN SQLSTATE = '23P01' AND SQLERRM = 'Ja existe ausencia ativa desta pessoa em parte deste periodo: cancele a anterior antes de lancar de novo'
           THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- T14 a T21. As regras da modalidade, cada uma com a frase (num dia livre).
  FOR v_caso IN
    SELECT * FROM (VALUES
      ('T14 fim antes do inicio (16:00-14:00)', 'horario', 0, '16:00'::time, '14:00'::time, '23514',
       'Horario invertido: o horario final tem de ser depois do inicial'),
      ('T15 fim igual ao inicio (14:00-14:00)', 'horario', 0, '14:00', '14:00', '23514',
       'Horario invertido: o horario final tem de ser depois do inicial'),
      ('T16 por horario em dois dias', 'horario', 1, '14:00', '16:00', '23514',
       'Ausencia por horario e de um dia so: o dia final tem de ser o mesmo do inicial'),
      ('T17 por horario sem o horario final', 'horario', 0, '14:00', NULL, '23502',
       'Ausencia por horario exige o horario inicial e o final'),
      ('T18 por dias com horario', 'dias', 0, '14:00', '16:00', '23514',
       'Ausencia por dias nao leva horario: para um intervalo do dia, lance por horario'),
      ('T19 modalidade que nao existe', 'meio_dia', 0, NULL, NULL, '23514',
       'Modalidade de ausencia invalida: use dias ou horario'),
      ('T20 horario com segundos (14:00:30)', 'horario', 0, '14:00:30', '16:00', '23514',
       'Horario fora do formato: use horas e minutos exatos, de 00:00 a 23:59'),
      ('T21 fim 24:00', 'horario', 0, '20:00', '24:00', '23514',
       'Horario fora do formato: use horas e minutos exatos, de 00:00 a 23:59')
    ) AS c(rotulo, modalidade, dias_a_mais, inicio, fim, codigo, frase)
  LOOP
    BEGIN
      INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
      VALUES (v_ana, v_d3 + 30, v_d3 + 30 + v_caso.dias_a_mais, 'atestado_medico', 'teste do banco - regra',
              v_caso.modalidade, v_caso.inicio, v_caso.fim);
      v_res := v_res || ('FALHOU ' || v_caso.rotulo || ': entrou');
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s %s recusado: %s',
        CASE WHEN SQLSTATE = v_caso.codigo AND SQLERRM = v_caso.frase THEN 'OK' ELSE 'FALHOU' END, v_caso.rotulo, SQLERRM);
    END;
  END LOOP;

  -- T22. A outra pessoa não é afetada: 15:00-17:00 no dia 1 entra para ela.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_bruna, v_d1, v_d1, 'atestado_medico', 'teste do banco - outra pessoa', 'horario', '15:00', '17:00');
    v_res := v_res || 'OK T22 a sobreposicao e por pessoa: 15:00-17:00 no mesmo dia entra para a outra'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T22 a outra pessoa foi travada pela ausencia da pessoa: ' || SQLERRM);
  END;

  -- T23. A trava por pessoa continua: depois dos lançamentos, esta transação
  --      segura a trava da pessoa (a mesma chave do gatilho), e um segundo
  --      lançamento para ela esperaria por esta transação antes de ler a
  --      sobreposição. A chave de 64 bits aparece em pg_locks partida em duas:
  --      os 32 bits de cima em classid, os de baixo em objid, e objsubid 1.
  v_chave := hashtextextended('ponto_ausencias:' || v_ana::text, 0);
  SELECT count(*) INTO v_n FROM pg_locks l
   WHERE l.locktype = 'advisory' AND l.granted AND l.pid = pg_backend_pid()
     AND l.classid::bigint = ((v_chave >> 32) & 4294967295)
     AND l.objid::bigint = (v_chave & 4294967295)
     AND l.objsubid = 1;
  v_res := v_res || format('%s T23 a trava por pessoa continua: a transacao segura a trava da pessoa (%s)',
    CASE WHEN v_n = 1 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- T24. Cancelada não conta: cancela 14:00-16:00 e 15:00-15:30 entra.
  BEGIN
    UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - cancelar' WHERE id = v_a1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_ana, v_d1, v_d1, 'atestado_medico', 'teste do banco - depois de cancelar', 'horario', '15:00', '15:30');
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_a1;
    v_res := v_res || format('%s T24 a cancelada nao conta: cancelou %s linha(s), e 15:00-15:30 entrou; a cancelada continua 14:00-16:00? %s',
      CASE WHEN v_n = 1 AND v_aus.cancelada_em IS NOT NULL AND v_aus.hora_inicio = '14:00' AND v_aus.hora_fim = '16:00' THEN 'OK' ELSE 'FALHOU' END,
      v_n, v_aus.hora_inicio = '14:00' AND v_aus.hora_fim = '16:00');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T24 depois de cancelar, o intervalo continuou travado: ' || SQLERRM);
  END;

  -- T25. O app não alcança a modalidade nem as horas no UPDATE (privilégio de
  --      coluna).
  BEGIN
    UPDATE public.ponto_ausencias SET hora_fim = '17:00' WHERE id = v_a2;
    v_res := v_res || 'FALHOU T25 o app mudou a hora pela API'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLSTATE = '42501';
    BEGIN
      UPDATE public.ponto_ausencias SET modalidade = 'dias', hora_inicio = NULL, hora_fim = NULL WHERE id = v_a2;
      v_res := v_res || 'FALHOU T25 o app mudou a modalidade pela API'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s T25 a hora e a modalidade nao mudam pela API (%s)',
        CASE WHEN v_ok AND SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
    END;
  END;

  -- =========================================================================
  -- A TRAVA DA PRÓPRIA AUSÊNCIA
  -- =========================================================================
  -- P1 e P2. Quem administra (a Rita) não lança ausência para a própria conta:
  --     nem pelo app de antes (por dias), nem por horário.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_rita, v_dp, v_dp, 'falta_justificada', 'teste do banco - a propria, por dias');
    v_res := v_res || 'FALHOU P1 quem administra lancou a propria ausencia por dias'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P1 quem administra nao lanca a propria ausencia por dias: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_lanca THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_rita, v_dp, v_dp, 'atestado_medico', 'teste do banco - a propria, por horario', 'horario', '09:00', '10:00');
    v_res := v_res || 'FALHOU P2 quem administra lancou a propria ausencia por horario'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s P2 quem administra nao lanca a propria ausencia por horario: %s',
      CASE WHEN SQLSTATE = '42501' AND SQLERRM = c_dono_lanca THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- P3. A ausência de outra pessoa continua aceita: a Rita lança a do Sérgio.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_aus_serg, v_sergio, v_dp, v_dp, 'falta_justificada', 'teste do banco - do super admin, pelo RH');
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_aus_serg;
    v_res := v_res || format('%s P3 quem administra lanca a ausencia de outra pessoa (o super admin): lancado_por=RH? %s',
      CASE WHEN v_aus.lancado_por = v_rita AND v_aus.cancelada_em IS NULL THEN 'OK' ELSE 'FALHOU' END, v_aus.lancado_por = v_rita);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P3 a ausencia de outra pessoa foi recusada a quem administra: ' || SQLERRM);
  END;

  -- O super admin (o Sérgio).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);

  -- P4. Nem o super admin lança ausência para a própria conta, por dias ou por
  --     horário.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_sergio, v_dp + 10, v_dp + 10, 'falta_justificada', 'teste do banco - a propria do super admin, por dias');
    v_res := v_res || 'FALHOU P4 o super admin lancou a propria ausencia por dias'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLSTATE = '42501' AND SQLERRM = c_dono_lanca;
    v_erro := SQLERRM;
    BEGIN
      INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
      VALUES (v_sergio, v_dp + 10, v_dp + 10, 'atestado_medico', 'teste do banco - a propria do super admin, por horario', 'horario', '10:00', '11:00');
      v_res := v_res || 'FALHOU P4 o super admin lancou a propria ausencia por horario'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s P4 o super admin nao lanca a propria ausencia, por dias nem por horario: %s',
        CASE WHEN v_ok AND SQLSTATE = '42501' AND SQLERRM = c_dono_lanca THEN 'OK' ELSE 'FALHOU' END,
        CASE WHEN v_erro = SQLERRM THEN SQLERRM ELSE v_erro || ' / ' || SQLERRM END);
    END;
  END;

  -- P5. Nem cancela a própria ausência, a que o RH lançou para ele (editar é
  --     cancelar e lançar de novo, e as duas ficam com outra pessoa).
  BEGIN
    UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - o super admin cancela a propria' WHERE id = v_aus_serg;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_res := v_res || format('FALHOU P5 o super admin cancelou a propria ausencia (%s linha(s))', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
    v_ok := SQLSTATE = '42501' AND SQLERRM = c_dono_cancela;
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_aus_serg;
    v_res := v_res || format('%s P5 o super admin nao cancela a propria ausencia, e ela continua ativa (%s): %s',
      CASE WHEN v_ok AND v_aus.cancelada_em IS NULL THEN 'OK' ELSE 'FALHOU' END, v_aus.cancelada_em IS NULL, v_erro);
  END;

  -- P6. O super admin lança a ausência de outra pessoa: a da Rita.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_aus_rita, v_rita, v_dp, v_dp, 'atestado_medico', 'teste do banco - do RH, pelo super admin', 'horario', '09:00', '10:00');
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_aus_rita;
    v_res := v_res || format('%s P6 o super admin lanca a ausencia de outra pessoa (quem administra): lancado_por=super admin? %s',
      CASE WHEN v_aus.lancado_por = v_sergio AND v_aus.modalidade = 'horario' THEN 'OK' ELSE 'FALHOU' END, v_aus.lancado_por = v_sergio);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P6 a ausencia de outra pessoa foi recusada ao super admin: ' || SQLERRM);
  END;

  -- De volta a quem administra (a Rita).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);

  -- P7. Quem administra não cancela a própria ausência, a que o super admin
  --     lançou para ela.
  BEGIN
    UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - o RH cancela a propria' WHERE id = v_aus_rita;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_res := v_res || format('FALHOU P7 quem administra cancelou a propria ausencia (%s linha(s))', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
    v_ok := SQLSTATE = '42501' AND SQLERRM = c_dono_cancela;
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_aus_rita;
    v_res := v_res || format('%s P7 quem administra nao cancela a propria ausencia, e ela continua ativa (%s): %s',
      CASE WHEN v_ok AND v_aus.cancelada_em IS NULL THEN 'OK' ELSE 'FALHOU' END, v_aus.cancelada_em IS NULL, v_erro);
  END;

  -- P8. O upsert não contorna a trava. (a) A linha proposta é de outra pessoa
  --     (a Bruna, num dia livre dela) e o conflito cai na própria ausência: o
  --     UPDATE do conflito é um cancelamento da própria, recusado. (b) A
  --     linha proposta é da própria conta: recusada já no INSERT.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_aus_rita, v_bruna, v_dp + 20, v_dp + 20, 'falta_justificada', 'teste do banco - upsert de outra pessoa')
    ON CONFLICT (id) DO UPDATE SET motivo_cancelamento = 'teste do banco - cancelar a propria pelo upsert';
    v_res := v_res || 'FALHOU P8 o upsert cancelou a propria ausencia'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLSTATE = '42501' AND SQLERRM = c_dono_cancela;
    v_erro := SQLERRM;
    BEGIN
      INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao)
      VALUES (v_aus_rita, v_rita, v_dp + 20, v_dp + 20, 'falta_justificada', 'teste do banco - upsert da propria')
      ON CONFLICT (id) DO UPDATE SET motivo_cancelamento = 'teste do banco - cancelar a propria pelo upsert';
      v_res := v_res || 'FALHOU P8 o upsert da propria conta passou'::text;
    EXCEPTION WHEN OTHERS THEN
      SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_aus_rita;
      v_res := v_res || format('%s P8 o upsert nao contorna a trava (conflito na propria: %s; linha proposta propria: %s); a ausencia continua ativa e da Rita? %s',
        CASE WHEN v_ok AND SQLSTATE = '42501' AND SQLERRM = c_dono_lanca AND v_aus.cancelada_em IS NULL AND v_aus.usuario_id = v_rita
             THEN 'OK' ELSE 'FALHOU' END,
        v_erro, SQLERRM, v_aus.cancelada_em IS NULL AND v_aus.usuario_id = v_rita);
    END;
  END;

  -- P9. A ausência de outra pessoa continua cancelável: a Rita cancela a do
  --     Sérgio, e o banco carimba que foi ela.
  BEGIN
    UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - o RH cancela a do super admin' WHERE id = v_aus_serg;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_aus_serg;
    v_res := v_res || format('%s P9 quem administra cancela a ausencia de outra pessoa: %s linha(s), cancelada_por=RH? %s',
      CASE WHEN v_n = 1 AND v_aus.cancelada_por = v_rita AND v_aus.cancelada_em IS NOT NULL THEN 'OK' ELSE 'FALHOU' END,
      v_n, v_aus.cancelada_por = v_rita);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P9 quem administra nao cancelou a ausencia de outra pessoa: ' || SQLERRM);
  END;

  -- P10 e P11. O super admin cancela a ausência da Rita (de outra pessoa) e
  --     lança de novo, corrigida: editar fica com outra pessoa, e funciona.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sergio, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - o super admin cancela a do RH' WHERE id = v_aus_rita;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_aus_rita;
    v_res := v_res || format('%s P10 o super admin cancela a ausencia de outra pessoa: %s linha(s), cancelada_por=super admin? %s',
      CASE WHEN v_n = 1 AND v_aus.cancelada_por = v_sergio AND v_aus.cancelada_em IS NOT NULL THEN 'OK' ELSE 'FALHOU' END,
      v_n, v_aus.cancelada_por = v_sergio);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P10 o super admin nao cancelou a ausencia de outra pessoa: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_aus_rita2, v_rita, v_dp, v_dp, 'atestado_medico', 'teste do banco - do RH, corrigida', 'horario', '09:00', '10:30');
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_aus_rita2;
    v_res := v_res || format('%s P11 editar e cancelar e lancar de novo, por outra pessoa: a nova entra (de %s a %s)',
      CASE WHEN v_aus.lancado_por = v_sergio AND v_aus.hora_fim = '10:30' AND v_aus.cancelada_em IS NULL THEN 'OK' ELSE 'FALHOU' END,
      v_aus.hora_inicio, v_aus.hora_fim);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU P11 a ausencia corrigida nao entrou: ' || SQLERRM);
  END;

  -- =========================================================================
  -- QUEM BATE: LÊ A SUA, NÃO LANÇA
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);

  -- T26. A pessoa lê as próprias ausências, com a modalidade e as horas.
  SELECT count(*) FILTER (WHERE a.id = v_a2 AND a.modalidade = 'horario' AND a.hora_inicio = '16:00' AND a.hora_fim = '16:30'),
         count(*) FILTER (WHERE a.usuario_id <> v_ana)
    INTO v_n, v_fora FROM public.ponto_ausencias a;
  v_res := v_res || format('%s T26 a pessoa le a propria ausencia por horario (%s) e nenhuma alheia (%s)',
    CASE WHEN v_n = 1 AND v_fora = 0 THEN 'OK' ELSE 'FALHOU' END, v_n, v_fora);

  -- T27. Quem não administra não lança por horário (nem para si): a recusa é
  --      a do papel, antes da trava da própria ausência.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, modalidade, hora_inicio, hora_fim)
    VALUES (v_ana, v_d3 + 40, v_d3 + 40, 'atestado_medico', 'teste do banco - pela pessoa', 'horario', '08:00', '09:00');
    v_res := v_res || 'FALHOU T27 quem nao administra lancou por horario'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T27 quem nao administra nao lanca por horario (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;

  -- T28. anon não lê a tabela, e não tem privilégio nas colunas novas.
  PERFORM set_config('request.jwt.claims', '', true);
  RESET ROLE;
  SET LOCAL ROLE anon;
  v_ok := false;
  BEGIN
    SELECT count(*) INTO v_n FROM public.ponto_ausencias a WHERE a.modalidade = 'horario';
    v_erro := format('anon leu ponto_ausencias (%s linhas)', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLSTATE = '42501';
    v_erro := SQLERRM;
  END;
  RESET ROLE;
  v_ok := v_ok
    AND NOT has_column_privilege('anon', 'public.ponto_ausencias', 'modalidade', 'SELECT, INSERT, UPDATE, REFERENCES')
    AND NOT has_column_privilege('anon', 'public.ponto_ausencias', 'hora_inicio', 'SELECT, INSERT, UPDATE, REFERENCES')
    AND NOT has_column_privilege('anon', 'public.ponto_ausencias', 'hora_fim', 'SELECT, INSERT, UPDATE, REFERENCES');
  v_res := v_res || format('%s T28 anon sem acesso a ponto_ausencias nem as colunas novas (%s)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(v_erro, 50));

  -- T29. Os privilégios por coluna: INSERT nas três novas para authenticated;
  --      UPDATE só no motivo do cancelamento; sem DELETE.
  v_ok := has_column_privilege('authenticated', 'public.ponto_ausencias', 'modalidade', 'INSERT')
      AND has_column_privilege('authenticated', 'public.ponto_ausencias', 'hora_inicio', 'INSERT')
      AND has_column_privilege('authenticated', 'public.ponto_ausencias', 'hora_fim', 'INSERT')
      AND NOT has_column_privilege('authenticated', 'public.ponto_ausencias', 'modalidade', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.ponto_ausencias', 'hora_inicio', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.ponto_ausencias', 'hora_fim', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.ponto_ausencias', 'motivo_cancelamento', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.ponto_ausencias', 'lancado_por', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.ponto_ausencias', 'DELETE');
  v_res := v_res || format('%s T29 INSERT por coluna inclui modalidade e horas; UPDATE so no motivo; sem DELETE',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- =========================================================================
  -- O GATILHO E OS CHECKS, SEM A AJUDA DA RLS E DOS PRIVILÉGIOS (o dono das
  -- tabelas, como uma migration ou o editor SQL)
  -- =========================================================================
  -- T30. Nem o dono das tabelas muda a hora ou a modalidade de uma ausência
  --      lançada (com a sessão de quem administra, que o gatilho exige).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE public.ponto_ausencias SET hora_fim = '17:00' WHERE id = v_a2;
    v_res := v_res || 'FALHOU T30 a hora mudou depois de lancada'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE 'Ausencia lancada nao muda%';
    BEGIN
      UPDATE public.ponto_ausencias SET modalidade = 'horario', hora_inicio = '08:00', hora_fim = '09:00', dia_fim = dia_inicio WHERE id = v_a3;
      v_res := v_res || 'FALHOU T30 a ausencia por dias virou por horario depois de lancada'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s T30 a hora e a modalidade nao mudam depois de lancadas (%s)',
        CASE WHEN v_ok AND SQLERRM LIKE 'Ausencia lancada nao muda%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
    END;
  END;

  -- T31. Sem o gatilho das ausências, os CHECKs recusam a ausência incoerente
  --      com a modalidade. Como dono das tabelas, sem sessão; religado no fim.
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    ALTER TABLE public.ponto_ausencias DISABLE TRIGGER trg_ponto_ausencias_guardar;
    FOR v_caso IN
      SELECT * FROM (VALUES
        ('por horario sem as horas', 'horario', 0, NULL::time, NULL::time, 'ponto_ausencias_modalidade_coerente'),
        ('por horario em dois dias', 'horario', 1, '14:00', '16:00', 'ponto_ausencias_modalidade_coerente'),
        ('por horario invertido', 'horario', 0, '16:00', '14:00', 'ponto_ausencias_modalidade_coerente'),
        ('por dias com horario', 'dias', 0, '14:00', '16:00', 'ponto_ausencias_modalidade_coerente'),
        ('modalidade que nao existe', 'meio_dia', 0, NULL, NULL, 'ponto_ausencias_modalidade_coerente'),
        ('horario com segundos', 'horario', 0, '14:00:30', '16:00', 'ponto_ausencias_horario_no_minuto'),
        ('fim 24:00', 'horario', 0, '20:00', '24:00', 'ponto_ausencias_horario_no_minuto')
      ) AS c(rotulo, modalidade, dias_a_mais, inicio, fim, restricao)
    LOOP
      BEGIN
        INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, lancado_por, modalidade, hora_inicio, hora_fim)
        VALUES (v_ana, v_d3 + 50, v_d3 + 50 + v_caso.dias_a_mais, 'atestado_medico', 'teste do banco - sem gatilho', v_rita,
                v_caso.modalidade, v_caso.inicio, v_caso.fim);
        v_res := v_res || ('FALHOU T31 sem gatilho, ' || v_caso.rotulo || ': entrou');
      EXCEPTION WHEN OTHERS THEN
        v_res := v_res || format('%s T31 sem gatilho, o CHECK recusa %s (%s)',
          CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE '%' || v_caso.restricao || '%' THEN 'OK' ELSE 'FALHOU' END, v_caso.rotulo, SQLERRM);
      END;
    END LOOP;
    ALTER TABLE public.ponto_ausencias ENABLE TRIGGER trg_ponto_ausencias_guardar;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T31 nao rodou: ' || SQLERRM);
  END;

  -- T32. O gatilho das ausências é o desta migration, ligado de novo, com a
  --      função de sempre: SECURITY DEFINER, search_path fixo, EXECUTE só do
  --      service_role; e nenhum gatilho novo em ponto_ausencias (os três da
  --      estrutura).
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.ponto_ausencias'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O';
  SELECT p.prosecdef
         AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg WHERE cfg = 'search_path=public')
         AND p.prosrc LIKE '%' || c_dono_lanca || '%'
         AND p.prosrc LIKE '%' || c_dono_cancela || '%'
         AND obj_description(p.oid, 'pg_proc') LIKE '%recusa (42501) lancar ausencia para a propria conta e cancelar a propria ausencia%'
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    INTO v_ok
    FROM pg_proc p WHERE p.oid = 'public.ponto_ausencias_guardar()'::regprocedure;
  v_ok := v_ok AND EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = 'public.ponto_ausencias'::regclass AND t.tgname = 'trg_ponto_ausencias_guardar'
                             AND t.tgfoid = 'public.ponto_ausencias_guardar()'::regprocedure AND t.tgenabled = 'O');
  v_res := v_res || format('%s T32 o gatilho das ausencias e o da migration, ligado, com a funcao DEFINER, search_path fixo e EXECUTE so do service_role; %s gatilhos ligados na tabela (esperado 3)',
    CASE WHEN coalesce(v_ok, false) AND v_n = 3 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- P12. Sem sessão (o backend sem o token de ninguém), a trava da própria
  --      ausência não é a que recusa: a ausência continua exigindo a sessão de
  --      quem administra, para lançar e para cancelar.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_rita, v_dp + 30, v_dp + 30, 'falta_justificada', 'teste do banco - sem sessao');
    v_res := v_res || 'FALHOU P12 sem sessao, a ausencia foi lancada'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLSTATE = '42501' AND SQLERRM LIKE 'Ausencia exige sessao%';
    v_erro := SQLERRM;
    BEGIN
      UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - sem sessao' WHERE id = v_aus_rita2;
      v_res := v_res || 'FALHOU P12 sem sessao, a ausencia foi cancelada'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s P12 sem sessao, a ausencia nao nasce nem e cancelada, pela regra da sessao (%s / %s)',
        CASE WHEN v_ok AND SQLSTATE = '42501' AND SQLERRM LIKE 'Ausencia exige sessao%' THEN 'OK' ELSE 'FALHOU' END,
        left(v_erro, 40), left(SQLERRM, 40));
    END;
  END;

  -- T33. As ausências que já existiam continuam iguais: a impressão de cada
  --      linha inteira, sem as que este teste lançou, é a do começo; e todas
  --      são por dias, sem horário.
  SELECT md5(coalesce(string_agg(to_jsonb(a)::text, E'\n' ORDER BY a.id), '')),
         count(*) FILTER (WHERE a.modalidade <> 'dias' OR a.hora_inicio IS NOT NULL OR a.hora_fim IS NOT NULL),
         count(*)
    INTO v_depois, v_fora, v_n
    FROM public.ponto_ausencias a
   WHERE a.usuario_id NOT IN (v_rita, v_sergio, v_ana, v_bruna);
  v_res := v_res || format('%s T33 as %s ausencia(s) que ja existiam continuam iguais, linha inteira (%s), e todas por dias (%s fora)',
    CASE WHEN v_depois = v_antes AND v_n = v_antigas AND v_fora = 0 THEN 'OK' ELSE 'FALHOU' END,
    v_antigas, CASE WHEN v_depois = v_antes THEN 'mesma impressao' ELSE 'MUDOU' END, v_fora);

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
