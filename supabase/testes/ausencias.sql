-- TESTE DE BANCO — AUSÊNCIAS COM ATESTADO
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- ausencias.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, cria as pessoas do teste, escreve, mede e DESFAZ no
-- fim (`ROLLBACK`): nada fica no banco. A resposta é `resultado`, uma linha por
-- caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU aborta no bloco `$conferir$`
-- (o psql sai com erro e a transação é desfeita do mesmo jeito).
--
-- O QUE ELE PROVA: quem administra sobe o atestado e lança a ausência, e o
-- banco carimba quem e quando; as recusas de período, tipo, pessoa e arquivo
-- (caminho fora da convenção, arquivo que não está no bucket, de outra pessoa,
-- extensão que mente); cancelar exige motivo e é definitivo; cada pessoa lê só
-- as suas ausências e os seus atestados; ninguém muda o que foi lançado nem
-- apaga nada, nem o dono das tabelas.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. Os casos T17b a
-- T22 rodam como ele: sem a ajuda da RLS e dos privilégios, só o gatilho.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto. Quem lança é a Rita, do RH, que administra e não
-- é super admin; "a pessoa" é a Ana e "a outra" é a Bruna, as duas com ficha
-- que libera acesso e sem administrar.
--
-- O QUE ELE NÃO TEM, DE PROPÓSITO: nenhum DELETE e nenhum TRUNCATE. Esses
-- dois caminhos são provados aqui pelos privilégios, pela ausência de policy e
-- pelos gatilhos (T23).
--
-- SESSÃO FORJADA, como o PostgREST faz por requisição: o JWT vai em
-- `request.jwt.claims` e o papel muda com `SET LOCAL ROLE authenticated`.
-- Upload no Storage = INSERT em `storage.objects` com o papel `authenticated`:
-- o mesmo INSERT, com as mesmas policies, que a API do Storage faz. Só a linha
-- do índice: nenhum arquivo sobe. Os períodos ficam perto de um ano atrás,
-- dentro da janela aceita, e as pessoas do teste não têm ausência nenhuma
-- antes dele.

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
  v_res      text[] := '{}';
  -- As pessoas (elenco fictício).
  v_rita     uuid := gen_random_uuid();   -- RH: lança e cancela
  v_ana      uuid := gen_random_uuid();   -- a pessoa
  v_bruna    uuid := gen_random_uuid();   -- a outra
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_base     date;
  v_a1       uuid := gen_random_uuid();   -- da Ana, com foto do atestado
  v_a2       uuid := gen_random_uuid();   -- da Bruna, com PDF
  v_a3       uuid := gen_random_uuid();   -- da Bruna, 120 dias
  v_x        uuid := gen_random_uuid();   -- ids que não devem gravar
  v_foto1    text;
  v_pdf2     text;
  v_aus      public.ponto_ausencias%ROWTYPE;
  v_n        bigint;
  v_n2       bigint;
  v_cont     bigint;
  v_ok       boolean;
  v_item     text;
BEGIN
  v_base := v_hoje - 360;

  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria).
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_rita,  'authenticated', 'authenticated', 'rita.teste@example.invalid',  '{}', '{"full_name": "Rita Moraes"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ana,   'authenticated', 'authenticated', 'ana.teste@example.invalid',   '{}', '{"full_name": "Ana Beatriz Rocha"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_bruna, 'authenticated', 'authenticated', 'bruna.teste@example.invalid', '{}', '{"full_name": "Bruna Costa"}',       now(), now());
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_rita, 'teste do banco: o RH lanca as ausencias');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo)
  VALUES (v_ana, 'Ana Beatriz Rocha', 'Vendas'),
         (v_bruna, 'Bruna Costa', 'Compras');

  v_foto1 := v_ana::text   || '/' || v_a1::text || '.jpg';
  v_pdf2  := v_bruna::text || '/' || v_a2::text || '.pdf';

  -- =========================================================================
  -- O BUCKET, COM A SESSÃO DE CADA UM
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- T1. O admin sobe a foto do atestado da Ana e o PDF da Bruna.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
    VALUES ('ponto-atestados', v_foto1, v_rita, v_rita::text,
            jsonb_build_object('mimetype', 'image/jpeg', 'size', 1)),
           ('ponto-atestados', v_pdf2, v_rita, v_rita::text,
            jsonb_build_object('mimetype', 'application/pdf', 'size', 1));
    v_res := v_res || 'OK T1 admin sobe atestado (foto e PDF)'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T1 admin nao subiu atestado: ' || SQLERRM);
  END;

  -- T3. Nem o admin sobe fora da convenção.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
    VALUES ('ponto-atestados', v_ana::text || '/atestado.exe', v_rita, v_rita::text,
            jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
    v_res := v_res || 'FALHOU T3 admin subiu atestado fora da convencao'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T3 caminho fora da convencao recusado no upload (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;

  -- T24. Ninguém sobrescreve: sem policy de UPDATE, o UPDATE não acha linha.
  UPDATE storage.objects SET metadata = metadata || '{"sobrescrito": true}'::jsonb
   WHERE bucket_id = 'ponto-atestados' AND name = v_foto1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_res := v_res || format('%s T24 admin nao sobrescreve atestado: %s linha(s) alterada(s)',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- T2. A pessoa não sobe atestado, nem na própria pasta.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
    VALUES ('ponto-atestados', v_ana::text || '/' || v_x::text || '.jpg', v_ana, v_ana::text,
            jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
    v_res := v_res || 'FALHOU T2 quem nao e admin subiu atestado'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T2 quem nao e admin nao sobe atestado (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;

  -- =========================================================================
  -- LANÇAR, COM A SESSÃO DO ADMIN
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);

  -- T4. Lança com atestado: o banco carimba quem e quando.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path)
    VALUES (v_a1, v_ana, v_base, v_base + 2, 'atestado_medico', '  teste do banco - atestado  ', v_foto1);
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_a1;
    v_ok := v_aus.lancado_por = v_rita AND v_aus.lancado_em = now() AND v_aus.cancelada_em IS NULL
            AND v_aus.observacao = 'teste do banco - atestado' AND v_aus.atestado_path = v_foto1;
    v_res := v_res || format('%s T4 admin lanca ausencia com atestado: lancado_por=admin? %s, observacao aparada? %s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_aus.lancado_por = v_rita, v_aus.observacao = 'teste do banco - atestado');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T4 lancamento com atestado recusado: ' || SQLERRM);
  END;

  -- T26. Lança com PDF (e, em T11, sem atestado nenhum).
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path)
    VALUES (v_a2, v_bruna, v_base, v_base, 'falta_justificada', 'teste do banco - pdf', v_pdf2);
    v_res := v_res || 'OK T26 lancamento com PDF aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T26 lancamento com PDF recusado: ' || SQLERRM);
  END;

  -- T11. 120 dias aceitos; 121 recusados.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_a3, v_bruna, v_base + 10, v_base + 129, 'falta_justificada', 'teste do banco - 120 dias');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_item := SQLERRM;
  END;
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ana, v_base + 150, v_base + 270, 'falta_justificada', 'teste do banco - 121 dias');
    v_res := v_res || 'FALHOU T11 periodo de 121 dias aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T11 120 dias aceitos (%s), 121 recusados (%s)',
      CASE WHEN v_ok AND SQLERRM LIKE 'Periodo longo demais%' THEN 'OK' ELSE 'FALHOU' END,
      v_ok, left(coalesce(v_item, SQLERRM), 50));
  END;

  -- T10. Período invertido.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ana, v_base + 160, v_base + 159, 'falta_justificada', 'teste do banco - invertido');
    v_res := v_res || 'FALHOU T10 periodo invertido aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T10 periodo invertido recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Periodo invertido%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T12. Fora da janela de um ano (o ano digitado errado, uma década à frente).
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ana, v_hoje + 400, v_hoje + 401, 'falta_justificada', 'teste do banco - futuro');
    v_res := v_res || 'FALHOU T12 data fora da janela aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T12 data fora da janela recusada (%s)',
      CASE WHEN SQLERRM LIKE 'Periodo fora da janela%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T13. Duas ausências ativas da mesma pessoa no mesmo dia: recusado.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ana, v_base + 1, v_base + 5, 'falta_justificada', 'teste do banco - sobreposta');
    v_res := v_res || 'FALHOU T13 ausencia sobreposta aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T13 ausencia sobreposta recusada (%s)',
      CASE WHEN SQLSTATE = '23P01' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T14. Tipo "outro" sem observação, e tipo que não existe.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo)
    VALUES (v_ana, v_base + 300, v_base + 300, 'outro');
    v_res := v_res || 'FALHOU T14 tipo outro sem observacao aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM = 'Ausencia do tipo outro exige observacao';
    BEGIN
      INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
      VALUES (v_ana, v_base + 300, v_base + 300, 'ferias', 'teste do banco - tipo');
      v_res := v_res || 'FALHOU T14 tipo inexistente aceito'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s T14 outro sem observacao e tipo inexistente recusados (%s)',
        CASE WHEN v_ok AND SQLERRM LIKE 'Tipo de ausencia invalido%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 40));
    END;
  END;

  -- T7. Atestado que não está no bucket.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path)
    VALUES (v_x, v_ana, v_base + 310, v_base + 310, 'atestado_medico', 'teste do banco - sem arquivo',
            v_ana::text || '/' || v_x::text || '.jpg');
    v_res := v_res || 'FALHOU T7 atestado inexistente aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T7 atestado inexistente recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Atestado nao encontrado%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T8. Atestado de outra pessoa (o PDF da Bruna) numa ausência da Ana.
  BEGIN
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path)
    VALUES (v_x, v_ana, v_base + 310, v_base + 310, 'atestado_medico', 'teste do banco - de outra', v_pdf2);
    v_res := v_res || 'FALHOU T8 atestado de outra pessoa aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T8 atestado de outra pessoa recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Caminho do atestado fora da convencao%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T9. Arquivo ".pdf" que é imagem: a extensão mente, recusado.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
    VALUES ('ponto-atestados', v_ana::text || '/' || v_x::text || '.pdf', v_rita, v_rita::text,
            jsonb_build_object('mimetype', 'image/jpeg', 'size', 1));
    INSERT INTO public.ponto_ausencias (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path)
    VALUES (v_x, v_ana, v_base + 310, v_base + 310, 'atestado_medico', 'teste do banco - mime',
            v_ana::text || '/' || v_x::text || '.pdf');
    v_res := v_res || 'FALHOU T9 atestado com extensao mentindo aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T9 tipo do arquivo diferente da extensao recusado (%s)',
      CASE WHEN SQLERRM LIKE 'Atestado com tipo de arquivo (image/jpeg) diferente da extensao (.pdf)%' THEN 'OK' ELSE 'FALHOU' END,
      left(SQLERRM, 70));
  END;

  -- T28. Pessoa que não existe.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (gen_random_uuid(), v_base, v_base, 'falta_justificada', 'teste do banco - ninguem');
    v_res := v_res || 'FALHOU T28 ausencia de conta inexistente aceita'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T28 conta inexistente recusada (%s)',
      CASE WHEN SQLERRM LIKE 'Pessoa nao encontrada%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T5. O app não manda o carimbo: lancado_por não tem privilégio de coluna.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, lancado_por)
    VALUES (v_ana, v_base + 320, v_base + 320, 'falta_justificada', 'teste do banco - carimbo', v_ana);
    v_res := v_res || 'FALHOU T5 app mandou lancado_por'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T5 app nao escolhe quem lancou (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- =========================================================================
  -- MUDAR E CANCELAR
  -- =========================================================================
  -- T17a. O admin, pela API, não muda o período (privilégio de coluna).
  BEGIN
    UPDATE public.ponto_ausencias SET dia_fim = v_base + 3 WHERE id = v_a1;
    v_res := v_res || 'FALHOU T17a admin mudou o periodo pela API'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T17a periodo nao muda pela API (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T18. Cancelar sem motivo (só espaços).
  BEGIN
    UPDATE public.ponto_ausencias SET motivo_cancelamento = '   ' WHERE id = v_a1;
    v_res := v_res || 'FALHOU T18 cancelamento sem motivo aceito'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T18 cancelar sem motivo recusado (%s)',
      CASE WHEN SQLERRM = 'Cancelar ausencia exige motivo' THEN 'OK' ELSE 'FALHOU' END, SQLERRM);
  END;

  -- T21. A pessoa não cancela a própria ausência (RLS: nenhuma linha).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ana, 'role', 'authenticated')::text, true);
  UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - pela pessoa' WHERE id = v_a1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_res := v_res || format('%s T21 quem nao e admin nao cancela: %s linha(s)',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- T6. A pessoa não lança ausência, nem para si.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ana, v_base + 330, v_base + 330, 'falta_justificada', 'teste do banco - pela pessoa');
    v_res := v_res || 'FALHOU T6 quem nao e admin lancou ausencia'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T6 quem nao e admin nao lanca (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 60));
  END;

  -- T15. A pessoa lê a própria ausência e nenhuma de outra pessoa.
  SELECT count(*) FILTER (WHERE id = v_a1), count(*) FILTER (WHERE usuario_id <> v_ana)
    INTO v_n, v_n2
  FROM public.ponto_ausencias;
  v_res := v_res || format('%s T15 a pessoa le a propria (%s) e nenhuma alheia (%s)',
    CASE WHEN v_n = 1 AND v_n2 = 0 THEN 'OK' ELSE 'FALHOU' END, v_n, v_n2);

  -- T16. A pessoa lê o próprio atestado e não o da outra.
  SELECT count(*) FILTER (WHERE name = v_foto1), count(*) FILTER (WHERE name = v_pdf2)
    INTO v_n, v_n2
  FROM storage.objects WHERE bucket_id = 'ponto-atestados';
  v_res := v_res || format('%s T16 a pessoa le o proprio atestado (%s) e nao o da outra (%s)',
    CASE WHEN v_n = 1 AND v_n2 = 0 THEN 'OK' ELSE 'FALHOU' END, v_n, v_n2);

  -- T16b. E a outra, o contrário.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bruna, 'role', 'authenticated')::text, true);
  SELECT count(*) FILTER (WHERE name = v_pdf2), count(*) FILTER (WHERE name = v_foto1)
    INTO v_n, v_n2
  FROM storage.objects WHERE bucket_id = 'ponto-atestados';
  SELECT count(*) INTO v_cont FROM public.ponto_ausencias WHERE id IN (v_a1, v_a2, v_a3);
  v_res := v_res || format('%s T16b a outra le o proprio PDF (%s), nao a foto da pessoa (%s), e as proprias ausencias (%s de 2)',
    CASE WHEN v_n = 1 AND v_n2 = 0 AND v_cont = 2 THEN 'OK' ELSE 'FALHOU' END, v_n, v_n2, v_cont);

  -- =========================================================================
  -- O ADMIN CANCELA
  -- =========================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);

  -- T15b. O admin lê tudo: as três ausências e os dois atestados.
  SELECT count(*) INTO v_n FROM public.ponto_ausencias WHERE id IN (v_a1, v_a2, v_a3);
  SELECT count(*) INTO v_n2 FROM storage.objects WHERE bucket_id = 'ponto-atestados' AND name IN (v_foto1, v_pdf2);
  v_res := v_res || format('%s T15b admin le as ausencias (%s de 3) e os atestados (%s de 2)',
    CASE WHEN v_n = 3 AND v_n2 = 2 THEN 'OK' ELSE 'FALHOU' END, v_n, v_n2);

  -- T19. Cancelar com motivo: o banco carimba quem e quando, e nada mais muda.
  BEGIN
    UPDATE public.ponto_ausencias SET motivo_cancelamento = '  teste do banco - cancelar  ' WHERE id = v_a1;
    SELECT * INTO v_aus FROM public.ponto_ausencias WHERE id = v_a1;
    v_ok := v_aus.cancelada_por = v_rita AND v_aus.cancelada_em = now()
            AND v_aus.motivo_cancelamento = 'teste do banco - cancelar'
            AND v_aus.lancado_por = v_rita AND v_aus.dia_fim = v_base + 2 AND v_aus.atestado_path = v_foto1;
    v_res := v_res || format('%s T19 cancelar com motivo: cancelada_por=admin? %s, motivo aparado? %s',
      CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, v_aus.cancelada_por = v_rita,
      v_aus.motivo_cancelamento = 'teste do banco - cancelar');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T19 cancelamento com motivo recusado: ' || SQLERRM);
  END;

  -- T20. Cancelada é definitivo: nem cancela de novo, nem "descancela".
  BEGIN
    UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - de novo' WHERE id = v_a1;
    v_res := v_res || 'FALHOU T20 cancelou duas vezes'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE 'Ausencia ja cancelada%';
    BEGIN
      UPDATE public.ponto_ausencias SET motivo_cancelamento = NULL WHERE id = v_a1;
      v_res := v_res || 'FALHOU T20 descancelou'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s T20 cancelamento definitivo (%s)',
        CASE WHEN v_ok AND SQLERRM LIKE 'Ausencia ja cancelada%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
    END;
  END;

  -- T13b. Com a anterior cancelada, o mesmo período volta a aceitar ausência.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ana, v_base + 1, v_base + 5, 'falta_justificada', 'teste do banco - depois do cancelamento');
    v_res := v_res || 'OK T13b depois de cancelar, o periodo aceita outra ausencia'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || ('FALHOU T13b periodo continuou travado depois do cancelamento: ' || SQLERRM);
  END;

  -- T29. anon não enxerga a tabela.
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.ponto_ausencias;
    v_res := v_res || format('FALHOU T29 anon leu ponto_ausencias (%s linhas)', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T29 anon sem acesso a ponto_ausencias (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;
  RESET ROLE;

  -- =========================================================================
  -- O GATILHO, SEM A AJUDA DA RLS E DOS PRIVILÉGIOS (o dono das tabelas, como
  -- uma migration ou o editor SQL: tem todos os privilégios e não passa por
  -- RLS)
  -- =========================================================================
  -- T17b. Nem o dono das tabelas muda o período de uma ausência lançada.
  BEGIN
    UPDATE public.ponto_ausencias SET dia_fim = v_base + 1 WHERE id = v_a2;
    v_res := v_res || 'FALHOU T17b o periodo mudou depois de lancado'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T17b periodo nao muda depois de lancado (%s)',
      CASE WHEN SQLERRM LIKE 'Ausencia lancada nao muda%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T17c. Nem tira (ou troca) o atestado depois.
  BEGIN
    UPDATE public.ponto_ausencias SET atestado_path = NULL WHERE id = v_a2;
    v_res := v_res || 'FALHOU T17c o atestado saiu depois de lancado'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T17c atestado nao muda depois de lancado (%s)',
      CASE WHEN SQLERRM LIKE 'Ausencia lancada nao muda%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T17d. Nem o autor do lançamento.
  BEGIN
    UPDATE public.ponto_ausencias SET lancado_por = v_bruna WHERE id = v_a2;
    v_res := v_res || 'FALHOU T17d o autor do lancamento mudou'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T17d autor do lancamento nao muda (%s)',
      CASE WHEN SQLERRM LIKE 'Ausencia lancada nao muda%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T27. Ausência não nasce cancelada.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao, motivo_cancelamento)
    VALUES (v_bruna, v_base + 200, v_base + 200, 'falta_justificada', 'teste do banco - nasce cancelada', 'x');
    v_res := v_res || 'FALHOU T27 ausencia nasceu cancelada'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s T27 ausencia nao nasce cancelada (%s)',
      CASE WHEN SQLERRM LIKE 'Ausencia nao nasce cancelada%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
  END;

  -- T22. Backend sem sessão não lança nem cancela: o autor é carimbado.
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_bruna, v_base + 210, v_base + 210, 'falta_justificada', 'teste do banco - backend');
    v_res := v_res || 'FALHOU T22 backend sem sessao lancou ausencia'::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE 'Ausencia exige sessao%';
    BEGIN
      UPDATE public.ponto_ausencias SET motivo_cancelamento = 'teste do banco - backend' WHERE id = v_a2;
      v_res := v_res || 'FALHOU T22 backend sem sessao cancelou ausencia'::text;
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || format('%s T22 backend sem sessao nao lanca nem cancela (%s)',
        CASE WHEN v_ok AND SQLERRM LIKE 'Ausencia exige sessao%' THEN 'OK' ELSE 'FALHOU' END, left(SQLERRM, 50));
    END;
  END;

  -- =========================================================================
  -- O QUE A API ALCANÇA (privilégios, policies, gatilhos, bucket)
  -- =========================================================================
  -- T23. Ninguém apaga: sem DELETE/TRUNCATE para o app, sem policy de DELETE,
  --      gatilhos que recusam todo papel; bucket sem UPDATE/DELETE.
  v_ok := NOT has_table_privilege('authenticated', 'public.ponto_ausencias', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.ponto_ausencias', 'TRUNCATE')
      AND NOT has_table_privilege('service_role', 'public.ponto_ausencias', 'DELETE')
      AND NOT has_table_privilege('anon', 'public.ponto_ausencias', 'SELECT')
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ponto_ausencias'
                      AND cmd IN ('DELETE', 'ALL'))
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                      AND cmd IN ('UPDATE', 'DELETE', 'ALL')
                      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%ponto-atestados%')
      AND (SELECT count(*) FROM pg_trigger
           WHERE tgrelid = 'public.ponto_ausencias'::regclass AND tgenabled = 'O'
             AND tgname IN ('trg_ponto_ausencias_nao_se_apagam', 'trg_ponto_ausencias_nao_esvazia')) = 2
      AND EXISTS (SELECT 1 FROM storage.buckets
                  WHERE id = 'ponto-atestados' AND NOT public AND file_size_limit = 10485760
                    AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
                    AND cardinality(allowed_mime_types) = 5);
  v_res := v_res || format('%s T23 ninguem apaga ausencia nem atestado; bucket privado, 10 MB, imagem e PDF',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- T25. Nenhuma policy de storage.objects sem filtro de bucket (valeria para
  --      os atestados, e para todo bucket do projeto).
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND position('bucket_id' IN coalesce(qual, '') || coalesce(with_check, '')) = 0;
  v_res := v_res || format('%s T25 policies de storage.objects sem filtro de bucket: %s',
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
