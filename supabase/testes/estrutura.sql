-- TESTE DE BANCO — A CONFERÊNCIA DA ESTRUTURA E O CONTRATO DE ACESSO
--
-- COMO RODAR: `npm run db:testar` roda todos os arquivos desta pasta, e
-- `npm run db:testar -- estrutura.sql` só este. O script
-- (`scripts/testar-banco.sh`) manda o arquivo para o psql de dentro do
-- contêiner do banco do Supabase local, como `postgres`, com ON_ERROR_STOP. O
-- arquivo abre a transação, lê o catálogo, cria as contas do teste, escreve,
-- mede e DESFAZ no fim (`ROLLBACK`): nada fica no banco. A resposta é
-- `resultado`, uma linha por caso: "OK ..." ou "FALHOU ...". Qualquer FALHOU
-- aborta no bloco `$conferir$` (o psql sai com erro e a transação é desfeita
-- do mesmo jeito).
--
-- O QUE ELE CONFERE
--   1. O catálogo (E1 a E18, só leitura): as 13 tabelas do ponto e nada mais
--      com o prefixo; as contagens de funções, gatilhos (todos ligados),
--      regras de acesso e buckets; RLS ligada (e não forçada) em toda tabela;
--      restrições validadas; dono `postgres` em tudo; search_path fixo em toda
--      função; `anon` sem nada e PUBLIC sem EXECUTE; os privilégios exatos de
--      cada tabela, coluna, sequência e função; as regras só para
--      `authenticated`, as de storage.objects presas ao bucket do ponto; os
--      dois buckets privados; o pgcrypto em `extensions`; a assinatura das
--      duas RPCs do colaborador, que é o contrato com o app; e os privilégios
--      padrão do `postgres`, que não dão nada a anon, authenticated e PUBLIC.
--   2. O que nasce depois (N1 a N3): uma tabela, uma sequência e uma função
--      novas em public, criadas sem GRANT, como numa migration de quem
--      estende o ponto, não dão nada a anon, authenticated e PUBLIC.
--   3. O contrato de acesso, com contas sintéticas (C1 a C23, C12b, C14b a
--      C14d e A1): o que ponto_meu_acesso responde a cada tipo de conta (super
--      admin sem ficha, administrador sem ficha, ficha ativa, ficha desligada,
--      nem ficha nem papel, e sem sessão), quem lê ponto_contas(), de onde vem
--      o nome da conta, quem lê o local e a configuração, a fotografia do nome
--      na batida, a trava de futuro, a convenção e os tetos do envio da
--      selfie, a batida e o pedido sem localização pelas RPCs de verdade, e
--      toda conta das listas de administração com acesso.
--
-- AS CONTAGENS ficam em constantes no começo do bloco do catálogo. Mudou a
-- migration, mudam os números aqui; o teste estático (`src/banco.test.ts`)
-- confere que elas batem com o que a migration cria. O corpo das funções não
-- é conferido aqui: os testes de comportamento dos outros arquivos são a
-- prova dele.
--
-- POR QUE `postgres`: é o papel que aplica a migration no Supabase hospedado,
-- dono das tabelas e das funções do ponto, sem superusuário. É também o papel
-- que o catálogo tem de mostrar como dono de tudo.
--
-- AS PESSOAS são sintéticas, criadas aqui dentro e desfeitas no ROLLBACK:
-- contas em auth.users com e-mail em example.invalid (domínio reservado: não
-- entrega e-mail e não colide com as contas de demonstração), com os nomes do
-- elenco fictício do projeto. O nome guardado na conta mora em
-- `raw_app_meta_data`, que só a chave de serviço grava (é onde a função de
-- contas o põe). A conta da Ana guarda o nome curto ("Ana") e a ficha dela, o
-- completo: o teste prova de onde cada tela tira o nome. A Rita e o Sérgio
-- trocaram o próprio `raw_user_meta_data` (a pessoa faz isso sozinha, pela API
-- do login), e esse nome não vale em lugar nenhum: o Sérgio, super admin, não
-- tem nome guardado pela função, e o nome dele é o e-mail.
--
-- O QUE A TRANSAÇÃO DESFEITA NÃO DESFAZ: a sequência de ponto_pin_tentativas
-- (sequência do Postgres não volta no ROLLBACK). Os casos sem localização
-- conferem o PIN: o próximo id fica maior, nenhuma linha fica.

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
-- 1. O CATÁLOGO (só lê)
-- ===========================================================================
DO $catalogo$
DECLARE
  -- O que a migration cria (o teste estático confere estes números com ela).
  c_tabelas         constant text[] := ARRAY[
    'ponto_admins', 'ponto_ausencias', 'ponto_configuracao', 'ponto_contas_trilha', 'ponto_correcoes',
    'ponto_funcionarios', 'ponto_local', 'ponto_pedidos_atraso', 'ponto_pin', 'ponto_pin_tentativas',
    'ponto_registros', 'ponto_registros_apagados', 'ponto_super_admins'
  ];
  c_funcoes         constant integer := 50;
  c_gatilhos        constant integer := 38;
  c_regras_tabelas  constant integer := 27;
  c_regras_storage  constant integer := 6;
  c_buckets         constant integer := 2;
  -- Os privilégios de cada tabela, sem o dono (postgres): o app (authenticated)
  -- só o que usa; a função de contas (service_role) o que precisa; anon nada.
  c_acl_tabelas     constant text[] := ARRAY[
    'ponto_admins|authenticated:DELETE,authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE,service_role:DELETE,service_role:INSERT,service_role:MAINTAIN,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'ponto_ausencias|authenticated:SELECT,service_role:SELECT',
    'ponto_configuracao|authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE,service_role:DELETE,service_role:INSERT,service_role:MAINTAIN,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'ponto_contas_trilha|authenticated:SELECT,service_role:SELECT',
    'ponto_correcoes|authenticated:SELECT,service_role:DELETE,service_role:INSERT,service_role:MAINTAIN,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'ponto_funcionarios|authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE,service_role:DELETE,service_role:INSERT,service_role:MAINTAIN,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'ponto_local|authenticated:DELETE,authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE,service_role:DELETE,service_role:INSERT,service_role:MAINTAIN,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'ponto_pedidos_atraso|authenticated:SELECT,service_role:SELECT',
    'ponto_pin|service_role:DELETE,service_role:INSERT,service_role:MAINTAIN,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'ponto_pin_tentativas|service_role:DELETE,service_role:INSERT,service_role:MAINTAIN,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'ponto_registros|authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE,service_role:DELETE,service_role:INSERT,service_role:MAINTAIN,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'ponto_registros_apagados|authenticated:SELECT,service_role:SELECT',
    'ponto_super_admins|authenticated:SELECT,service_role:SELECT'
  ];
  -- As colunas com privilégio próprio: o app lança e cancela ausência só pelas
  -- colunas do formulário; a função de contas grava a trilha sem escolher id
  -- nem momento.
  c_acl_colunas     constant text[] := ARRAY[
    'ponto_ausencias.atestado_path|authenticated:INSERT',
    'ponto_ausencias.dia_fim|authenticated:INSERT',
    'ponto_ausencias.dia_inicio|authenticated:INSERT',
    'ponto_ausencias.id|authenticated:INSERT',
    'ponto_ausencias.motivo_cancelamento|authenticated:UPDATE',
    'ponto_ausencias.observacao|authenticated:INSERT',
    'ponto_ausencias.tipo|authenticated:INSERT',
    'ponto_ausencias.usuario_id|authenticated:INSERT',
    'ponto_contas_trilha.acao|service_role:INSERT',
    'ponto_contas_trilha.alvo_usuario_id|service_role:INSERT',
    'ponto_contas_trilha.antes|service_role:INSERT',
    'ponto_contas_trilha.autor_email|service_role:INSERT',
    'ponto_contas_trilha.autor_id|service_role:INSERT',
    'ponto_contas_trilha.depois|service_role:INSERT',
    'ponto_contas_trilha.detalhe|service_role:INSERT',
    'ponto_contas_trilha.passos|service_role:INSERT',
    'ponto_contas_trilha.resultado|service_role:INSERT'
  ];
  -- As funções que o app chama (EXECUTE para authenticated); as outras são do
  -- banco (gatilhos e ajudantes) e só o service_role executa.
  c_exec_app        constant text[] := ARRAY[
    'ponto_ator_aprovado', 'ponto_contas', 'ponto_decidir_pedido_atraso', 'ponto_definir_pin',
    'ponto_distancia_metros', 'ponto_estado_do_pin', 'ponto_ficha_libera_acesso', 'ponto_meu_acesso',
    'ponto_pedir_batida_em_atraso', 'ponto_pin_status', 'ponto_pode_administrar', 'ponto_registrar_batida',
    'ponto_resetar_pin', 'ponto_selfie_pode_subir', 'ponto_selfie_sem_batida', 'ponto_sou_super_admin',
    'ponto_verificar_pin'
  ];
  -- As duas RPCs do colaborador, com a assinatura do contrato com o app: o
  -- p_sem_localizacao no fim, com DEFAULT NULL, para o app que não manda o
  -- parâmetro continuar achando a função.
  c_assinaturas     constant text[] := ARRAY[
    'ponto_pedir_batida_em_atraso(p_pin text, p_pedido_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision, p_horario_declarado timestamp with time zone, p_motivo text, p_sem_localizacao text DEFAULT NULL::text)',
    'ponto_registrar_batida(p_pin text, p_registro_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision DEFAULT NULL::double precision, p_sem_localizacao text DEFAULT NULL::text)'
  ];
  c_buckets_config  constant text[] := ARRAY[
    'ponto-atestados|false|10485760|{image/jpeg,image/png,image/webp,image/heic,application/pdf}',
    'ponto-selfies|false|3145728|{image/jpeg,image/png,image/webp}'
  ];
  v_res   text[] := '{}';
  v_vivo  text[];
  v_n     bigint;
  v_m     bigint;
  v_ok    boolean;
  v_txt   text;
BEGIN
  -- E1. As 13 tabelas, e nada mais com o prefixo em public (nem visão, nem
  --     tabela a mais).
  SELECT array_agg(c.relname::text || CASE WHEN c.relkind = 'r' THEN '' ELSE ' (' || c.relkind::text || ')' END ORDER BY c.relname)
    INTO v_vivo
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p', 'f') AND c.relname LIKE 'ponto%';
  v_ok := v_vivo = (SELECT array_agg(t ORDER BY t) FROM unnest(c_tabelas) t);
  v_res := v_res || format('%s E1 as %s tabelas do ponto, e nada mais com o prefixo: %s encontrada(s)',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, cardinality(c_tabelas), coalesce(cardinality(v_vivo), 0));

  -- E2. As funções, sem sobrecarga (o app chama pelo nome).
  SELECT count(*), count(DISTINCT p.proname) INTO v_n, v_m
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ponto%';
  v_res := v_res || format('%s E2 %s funcoes do ponto (esperado %s), %s nomes distintos',
    CASE WHEN v_n = c_funcoes AND v_m = c_funcoes THEN 'OK' ELSE 'FALHOU' END, v_n, c_funcoes, v_m);

  -- E3. Os gatilhos, todos ligados.
  SELECT count(*), count(*) FILTER (WHERE t.tgenabled = 'O') INTO v_n, v_m
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'ponto%' AND NOT t.tgisinternal;
  v_res := v_res || format('%s E3 %s gatilhos nas tabelas do ponto (esperado %s), %s ligados',
    CASE WHEN v_n = c_gatilhos AND v_m = c_gatilhos THEN 'OK' ELSE 'FALHOU' END, v_n, c_gatilhos, v_m);

  -- E4. As regras de acesso: nas tabelas do ponto e em storage.objects.
  SELECT count(*) FILTER (WHERE p.schemaname = 'public'), count(*) FILTER (WHERE p.schemaname = 'storage')
    INTO v_n, v_m
  FROM pg_policies p
  WHERE (p.schemaname = 'public' AND p.tablename LIKE 'ponto%')
     OR (p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname LIKE 'Ponto:%');
  v_res := v_res || format('%s E4 regras de acesso: %s nas tabelas (esperado %s) e %s em storage.objects (esperado %s)',
    CASE WHEN v_n = c_regras_tabelas AND v_m = c_regras_storage THEN 'OK' ELSE 'FALHOU' END,
    v_n, c_regras_tabelas, v_m, c_regras_storage);

  -- E5. Os dois buckets, privados, com o limite de tamanho e os tipos de hoje.
  SELECT array_agg(b.id || '|' || b.public || '|' || coalesce(b.file_size_limit::text, '') || '|' || coalesce(b.allowed_mime_types::text, '') ORDER BY b.id)
    INTO v_vivo
  FROM storage.buckets b WHERE b.id LIKE 'ponto%';
  v_ok := coalesce(cardinality(v_vivo), 0) = c_buckets AND v_vivo = c_buckets_config;
  v_res := v_res || format('%s E5 %s buckets do ponto (esperado %s), privados, com os limites e os tipos de arquivo',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, coalesce(cardinality(v_vivo), 0), c_buckets);

  -- E6. RLS ligada em toda tabela, e não forçada (forçada, ela valeria também
  --     para o dono, e as funções DEFINER do ponto deixariam de ver as linhas).
  SELECT count(*) FILTER (WHERE c.relrowsecurity AND NOT c.relforcerowsecurity), count(*) INTO v_n, v_m
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'ponto%';
  v_res := v_res || format('%s E6 RLS ligada, e nao forcada, em %s de %s tabelas',
    CASE WHEN v_n = v_m AND v_m = cardinality(c_tabelas) THEN 'OK' ELSE 'FALHOU' END, v_n, v_m);

  -- E7. Nenhuma restrição das tabelas do ponto ficou sem validar (NOT VALID).
  SELECT count(*) INTO v_n
  FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'ponto%' AND NOT k.convalidated;
  v_res := v_res || format('%s E7 restricoes sem validar: %s',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- E8. Dono postgres em toda tabela, sequência e função do ponto.
  SELECT count(*) INTO v_n FROM (
    SELECT c.relowner AS dono FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'ponto%' AND c.relkind IN ('r', 'S', 'v', 'm', 'p', 'f')
    UNION ALL
    SELECT p.proowner FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ponto%'
  ) d
  WHERE pg_get_userbyid(d.dono) <> 'postgres';
  v_res := v_res || format('%s E8 objetos do ponto com dono diferente de postgres: %s',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- E9. search_path fixo em toda função: uma função DEFINER sem ele rodaria
  --     com o caminho de quem chama, e um INVOKER de gatilho, com o de quem
  --     disparou.
  SELECT count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg WHERE cfg LIKE 'search_path=%'))
    INTO v_n, v_m
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ponto%';
  v_res := v_res || format('%s E9 search_path fixo em %s de %s funcoes',
    CASE WHEN v_n = v_m AND v_n = c_funcoes THEN 'OK' ELSE 'FALHOU' END, v_m, v_n);

  -- E10. anon sem nada (tabela, coluna, sequência, função), e PUBLIC sem
  --      EXECUTE nem privilégio de tabela. has_*_privilege olha também o que
  --      vem de PUBLIC.
  -- O CASE põe a ordem: o WHERE não garante qual condição o banco avalia
  -- primeiro, e has_sequence_privilege recusa o que não é sequência.
  SELECT array_agg(o ORDER BY o) INTO v_vivo FROM (
    SELECT CASE WHEN c.relkind = 'r' THEN 'tabela ' ELSE 'sequencia ' END || c.relname AS o FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'S') AND c.relname LIKE 'ponto%'
      AND CASE WHEN c.relkind = 'r'
               THEN has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                    OR has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
               ELSE has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE') END
    UNION ALL
    SELECT 'funcao ' || p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ponto%'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
    UNION ALL
    SELECT 'PUBLIC executa ' || p.proname FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ponto%' AND a.grantee = 0
    UNION ALL
    SELECT 'PUBLIC em ' || c.relname FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'S') AND c.relname LIKE 'ponto%' AND a.grantee = 0
  ) s;
  v_res := v_res || format('%s E10 anon sem nada e PUBLIC sem nada no ponto%s',
    CASE WHEN v_vivo IS NULL THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN v_vivo IS NULL THEN '' ELSE ': ' || array_to_string(v_vivo, ', ') END);

  -- E11. Os privilégios de cada tabela, exatos (sem o dono).
  SELECT array_agg(c.relname || '|' || coalesce((
           SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ','
                             ORDER BY (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type) COLLATE "C")
           FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
           WHERE a.grantee <> c.relowner), '') ORDER BY c.relname COLLATE "C")
    INTO v_vivo
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'ponto%';
  -- A diferença simétrica (o que sobra de um lado e falta do outro), com os
  -- parênteses: sem eles, EXCEPT e UNION se resolvem da esquerda para a direita.
  SELECT string_agg(DISTINCT split_part(d.linha, '|', 1), ', ') INTO v_txt
  FROM ((SELECT x FROM unnest(v_vivo) x EXCEPT SELECT y FROM unnest(c_acl_tabelas) y)
        UNION
        (SELECT y FROM unnest(c_acl_tabelas) y EXCEPT SELECT x FROM unnest(v_vivo) x)) d(linha);
  v_res := v_res || format('%s E11 privilegios de cada tabela, exatos%s',
    CASE WHEN v_txt IS NULL THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN v_txt IS NULL THEN '' ELSE ': diferem em ' || v_txt END);

  -- E12. As colunas com privilégio próprio, exatas.
  SELECT array_agg(c.relname || '.' || at.attname || '|' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type) INTO v_vivo
  FROM pg_class c
  JOIN pg_attribute at ON at.attrelid = c.oid AND at.attnum > 0 AND at.attacl IS NOT NULL
  CROSS JOIN LATERAL aclexplode(at.attacl) a
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'ponto%';
  SELECT string_agg(DISTINCT split_part(d.linha, '|', 1), ', ') INTO v_txt
  FROM ((SELECT x FROM unnest(v_vivo) x EXCEPT SELECT y FROM unnest(c_acl_colunas) y)
        UNION
        (SELECT y FROM unnest(c_acl_colunas) y EXCEPT SELECT x FROM unnest(v_vivo) x)) d(linha);
  v_res := v_res || format('%s E12 privilegios de coluna, exatos (%s)%s',
    CASE WHEN v_txt IS NULL THEN 'OK' ELSE 'FALHOU' END, cardinality(c_acl_colunas),
    CASE WHEN v_txt IS NULL THEN '' ELSE ': diferem em ' || v_txt END);

  -- E13. A sequência das tentativas de PIN: só o service_role.
  SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ','
                    ORDER BY (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type) COLLATE "C")
    INTO v_txt
  FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
  WHERE c.oid = 'public.ponto_pin_tentativas_id_seq'::regclass AND a.grantee <> c.relowner;
  v_res := v_res || format('%s E13 sequencia das tentativas de PIN so do service_role (%s)',
    CASE WHEN v_txt = 'service_role:SELECT,service_role:UPDATE,service_role:USAGE' THEN 'OK' ELSE 'FALHOU' END, v_txt);

  -- E14. EXECUTE: o service_role em todas; o authenticated só nas que o app
  --      chama; ninguém mais.
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_vivo FROM (
    SELECT p.proname,
           coalesce((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ','
                                       ORDER BY (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C")
                     FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee <> p.proowner AND a.privilege_type = 'EXECUTE'), '') AS quem
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ponto%'
  ) p
  WHERE p.quem <> CASE WHEN p.proname = ANY (c_exec_app) THEN 'authenticated,service_role' ELSE 'service_role' END;
  SELECT count(*) INTO v_n FROM unnest(c_exec_app) x
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = x);
  v_res := v_res || format('%s E14 EXECUTE: authenticated so nas %s funcoes que o app chama, service_role em todas%s',
    CASE WHEN v_vivo IS NULL AND v_n = 0 THEN 'OK' ELSE 'FALHOU' END, cardinality(c_exec_app),
    CASE WHEN v_vivo IS NULL THEN '' ELSE ': diferem em ' || array_to_string(v_vivo, ', ') END
      || CASE WHEN v_n = 0 THEN '' ELSE format('; faltam %s funcao(oes) que o app chama', v_n) END);

  -- E15. Toda regra do ponto é PERMISSIVE e só para authenticated; as de
  --      storage.objects filtram pelo bucket do ponto (as regras de
  --      storage.objects valem para todos os buckets do projeto).
  SELECT array_agg(p.policyname ORDER BY p.policyname) INTO v_vivo
  FROM pg_policies p
  WHERE ((p.schemaname = 'public' AND p.tablename LIKE 'ponto%')
         OR (p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname LIKE 'Ponto:%'))
    AND (p.permissive <> 'PERMISSIVE' OR p.roles <> '{authenticated}'::name[]
         OR (p.schemaname = 'storage'
             AND (coalesce(p.qual, '') || coalesce(p.with_check, '')) !~ 'bucket_id = ''ponto-(selfies|atestados)''::text'));
  v_res := v_res || format('%s E15 regras PERMISSIVE so para authenticated, as de storage.objects presas ao bucket do ponto%s',
    CASE WHEN v_vivo IS NULL THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN v_vivo IS NULL THEN '' ELSE ': ' || array_to_string(v_vivo, ', ') END);

  -- E16. O pgcrypto em extensions, com as duas funções que o PIN chama pelo
  --      nome completo.
  v_ok := EXISTS (SELECT 1 FROM pg_extension e WHERE e.extname = 'pgcrypto' AND e.extnamespace = 'extensions'::regnamespace)
      AND to_regprocedure('extensions.crypt(text,text)') IS NOT NULL
      AND to_regprocedure('extensions.gen_salt(text)') IS NOT NULL
      AND to_regprocedure('extensions.gen_salt(text,integer)') IS NOT NULL;
  v_res := v_res || format('%s E16 pgcrypto em extensions, com crypt e gen_salt',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- E17. A assinatura das duas RPCs do colaborador (o contrato com o app).
  SELECT array_agg(p.proname || '(' || pg_get_function_arguments(p.oid) || ')' ORDER BY p.proname) INTO v_vivo
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('ponto_registrar_batida', 'ponto_pedir_batida_em_atraso');
  v_res := v_res || format('%s E17 assinatura das RPCs do colaborador: p_sem_localizacao no fim, com DEFAULT NULL',
    CASE WHEN v_vivo = c_assinaturas THEN 'OK' ELSE 'FALHOU' END);

  -- E18. Os privilégios padrão do postgres: o que ele criar em public depois
  --      da migration não dá nada a anon nem a authenticated, e função nova
  --      não dá EXECUTE a PUBLIC (o padrão de PUBLIC é global: sem a linha
  --      global de funções, ele valeria). O service_role continua com o
  --      padrão em tabela, sequência e função.
  SELECT array_agg(DISTINCT p) INTO v_vivo FROM (
    SELECT CASE d.defaclobjtype WHEN 'r' THEN 'tabela' WHEN 'S' THEN 'sequencia' WHEN 'f' THEN 'funcao' ELSE d.defaclobjtype::text END
           || CASE WHEN d.defaclnamespace = 0 THEN ' (todo esquema)' ELSE '' END
           || ' para ' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS p
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
     WHERE d.defaclrole = 'postgres'::regrole
       AND (d.defaclnamespace = 'public'::regnamespace OR d.defaclnamespace = 0)
       AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
    UNION ALL
    SELECT 'funcao (todo esquema) para PUBLIC, pelo padrao do PostgreSQL'
     WHERE NOT EXISTS (SELECT 1 FROM pg_default_acl d
                        WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
  ) x;
  SELECT count(DISTINCT d.defaclobjtype) INTO v_n
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
     AND a.grantee = 'service_role'::regrole AND d.defaclobjtype IN ('r', 'S', 'f');
  v_res := v_res || format('%s E18 privilegios padrao do postgres: nada para anon, authenticated e PUBLIC no que nascer depois; service_role em %s de 3 tipos%s',
    CASE WHEN v_vivo IS NULL AND v_n = 3 THEN 'OK' ELSE 'FALHOU' END, v_n,
    CASE WHEN v_vivo IS NULL THEN '' ELSE ': ainda dao ' || array_to_string(v_vivo, ', ') END);

  PERFORM set_config('teste.resultado', array_to_string(v_res, E'\n'), true);
END $catalogo$;

-- ===========================================================================
-- 2. O QUE NASCE DEPOIS EM public (os privilégios padrão, na prática)
-- ===========================================================================
-- Uma tabela, uma sequência e uma função novas, criadas pelo postgres sem
-- GRANT nenhum, como numa migration de quem estende o ponto. O ROLLBACK do fim
-- as desfaz. O nome não começa com `ponto` para não se misturar com as peças
-- que o catálogo conta.
DO $padrao$
DECLARE
  v_res text[] := '{}';
  v_ok  boolean;
BEGIN
  CREATE TABLE public.teste_padrao_tabela (id integer PRIMARY KEY, segredo text);
  CREATE SEQUENCE public.teste_padrao_sequencia;
  CREATE FUNCTION public.teste_padrao_funcao() RETURNS integer LANGUAGE sql SET search_path = public AS $corpo$ SELECT 1 $corpo$;

  -- N1. A tabela nova: nada para anon nem authenticated (nem TRUNCATE); o
  --     service_role com o padrão. RLS continua a cargo de quem cria.
  v_ok := NOT has_table_privilege('anon', 'public.teste_padrao_tabela', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
      AND NOT has_table_privilege('authenticated', 'public.teste_padrao_tabela', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
      AND has_table_privilege('service_role', 'public.teste_padrao_tabela', 'SELECT, INSERT, UPDATE, DELETE');
  v_res := v_res || format('%s N1 tabela nova em public, sem GRANT: nada para anon e authenticated; service_role com o padrao',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- N2. A sequência nova: o mesmo.
  v_ok := NOT has_sequence_privilege('anon', 'public.teste_padrao_sequencia', 'USAGE, SELECT, UPDATE')
      AND NOT has_sequence_privilege('authenticated', 'public.teste_padrao_sequencia', 'USAGE, SELECT, UPDATE')
      AND has_sequence_privilege('service_role', 'public.teste_padrao_sequencia', 'USAGE');
  v_res := v_res || format('%s N2 sequencia nova em public, sem GRANT: nada para anon e authenticated; service_role com o padrao',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  -- N3. A função nova: sem EXECUTE para anon, authenticated e PUBLIC; o
  --     service_role executa.
  v_ok := NOT has_function_privilege('anon', 'public.teste_padrao_funcao()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.teste_padrao_funcao()', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.teste_padrao_funcao()', 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE p.oid = 'public.teste_padrao_funcao()'::regprocedure AND a.grantee = 0);
  v_res := v_res || format('%s N3 funcao nova em public, sem GRANT: sem EXECUTE para anon, authenticated e PUBLIC; service_role executa',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END);

  PERFORM set_config('teste.resultado',
    concat_ws(E'\n', nullif(current_setting('teste.resultado', true), ''), array_to_string(v_res, E'\n')), true);
END $padrao$;

-- ===========================================================================
-- 3. O CONTRATO DE ACESSO, COM CONTAS SINTÉTICAS
-- ===========================================================================
DO $contrato$
DECLARE
  c_pin       constant text := '4321';
  c_fuso      constant text := 'America/Sao_Paulo';
  c_sem_coordenada constant text := 'Batida pelo app exige latitude e longitude';
  c_pedido_sem_coordenada constant text := 'Pedido de batida em atraso exige latitude e longitude';
  v_res       text[] := '{}';
  -- As pessoas (elenco fictício).
  v_admin     uuid := gen_random_uuid();   -- Rita: administra, sem ficha (trocou o próprio user_metadata)
  v_super     uuid := gen_random_uuid();   -- Sérgio: super admin, sem ficha e sem nome guardado pela função
  v_ficha     uuid := gen_random_uuid();   -- Ana: ficha ativa (a conta guarda o nome curto)
  v_deslig    uuid := gen_random_uuid();   -- Fernanda: ficha desligada ontem
  v_nada      uuid := gen_random_uuid();   -- Vítor: nem ficha nem papel
  v_sem_gps   uuid := gen_random_uuid();   -- Caio: ficha e PIN, bate sem localização
  v_com_gps   uuid := gen_random_uuid();   -- Daniela: ficha e PIN, bate com coordenada e motivo
  v_ped_gps   uuid := gen_random_uuid();   -- Gustavo: ficha e PIN, pede sem localização
  v_teto_hora uuid := gen_random_uuid();   -- Tiago: ficha, encosta no teto de selfies da hora (C14c)
  v_teto_dia  uuid := gen_random_uuid();   -- Bruna Exemplo: ficha, encosta no teto de selfies do dia (C14d)
  v_hoje      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mes       text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY/MM');
  v_bat_sem   uuid := gen_random_uuid();
  v_bat_com   uuid := gen_random_uuid();
  v_ped_id    uuid := gen_random_uuid();
  v_local     public.ponto_local%ROWTYPE;
  v_a         jsonb;
  v_n         bigint;
  v_ok        boolean;
  v_txt       text;
  v_h         timestamptz;
  v_resp      jsonb;
  v_linha     public.ponto_registros%ROWTYPE;
  v_pedido    public.ponto_pedidos_atraso%ROWTYPE;
  v_reg       record;
  v_conta     record;
  v_erros     text[] := '{}';
  v_t         text;
  v_t2        text;
  v_ok2       boolean;
BEGIN
  -- ------------------------------------------------------------------------
  -- As pessoas do teste, sem sessão (como a instalação as gravaria). O nome
  -- guardado na conta mora em raw_app_meta_data (a coluna da direita); o que
  -- a Rita e o Sérgio puseram no raw_user_meta_data é o que a própria pessoa
  -- escreve pela API do login, e não vale.
  -- ------------------------------------------------------------------------
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin,     'authenticated', 'authenticated', 'rita.teste@example.invalid',     '{"full_name": "Nome Escolhido Pela Pessoa"}', '{"full_name": "Rita Moraes"}',   now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_super,     'authenticated', 'authenticated', 'sergio.teste@example.invalid',   '{"full_name": "Nome Escolhido Pela Pessoa"}', '{}',                             now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ficha,     'authenticated', 'authenticated', 'ana.teste@example.invalid',      '{}',                                          '{"full_name": "Ana"}',           now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_deslig,    'authenticated', 'authenticated', 'fernanda.teste@example.invalid', '{}',                                          '{}',                             now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_nada,      'authenticated', 'authenticated', 'vitor.teste@example.invalid',    '{}',                                          '{"full_name": "Vítor Campos"}',  now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_sem_gps,   'authenticated', 'authenticated', 'caio.teste@example.invalid',     '{}',                                          '{}',                             now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_com_gps,   'authenticated', 'authenticated', 'daniela.teste@example.invalid',  '{}',                                          '{}',                             now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ped_gps,   'authenticated', 'authenticated', 'gustavo.teste@example.invalid',  '{}',                                          '{}',                             now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_teto_hora, 'authenticated', 'authenticated', 'tiago.teste@example.invalid',    '{}',                                          '{"full_name": "Tiago Moreira"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_teto_dia,  'authenticated', 'authenticated', 'bruna.teste@example.invalid',    '{}',                                          '{"full_name": "Bruna Exemplo"}', now(), now());
  INSERT INTO public.ponto_admins (usuario_id, observacao) VALUES (v_admin, 'teste do banco: administra');
  INSERT INTO public.ponto_super_admins (usuario_id, observacao) VALUES (v_super, 'teste do banco: super admin');
  INSERT INTO public.ponto_funcionarios (usuario_id, nome_completo, cargo, admissao, desligamento)
  VALUES (v_ficha,     'Ana Beatriz Rocha', 'Vendas', v_hoje - 30, NULL),
         (v_deslig,    'Fernanda Teles',    'Vendas', v_hoje - 60, v_hoje - 1),
         (v_sem_gps,   'Caio Mendes',       'Operações', v_hoje - 30, NULL),
         (v_com_gps,   'Daniela Freitas',   'Administrativo', v_hoje - 30, NULL),
         (v_ped_gps,   'Gustavo Ramos',     'Logística', v_hoje - 30, NULL),
         (v_teto_hora, 'Tiago Moreira',     'Compras', v_hoje - 30, NULL),
         (v_teto_dia,  'Bruna Exemplo',     'Compras', v_hoje - 30, NULL);
  -- A linha de configuração: a da instalação, se houver; senão, a do padrão
  -- das colunas (o C12b precisa de uma para provar quem a lê).
  INSERT INTO public.ponto_configuracao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.ponto_pin (usuario_id, pin_hash)
  SELECT u, extensions.crypt(c_pin, extensions.gen_salt('bf')) FROM unnest(ARRAY[v_sem_gps, v_com_gps, v_ped_gps]) u;
  -- As selfies das batidas e do pedido sem localização (só a linha do índice,
  -- como a API do storage a gravaria; nenhum arquivo sobe).
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'ponto-selfies', d.u::text || '/' || v_mes || '/' || d.id::text || '.jpg', d.u, d.u::text,
         jsonb_build_object('mimetype', 'image/jpeg', 'size', 1)
  FROM (VALUES (v_sem_gps, v_bat_sem), (v_com_gps, v_bat_com), (v_ped_gps, v_ped_id)) d(u, id);
  -- O local: o ativo da instalação, se houver; senão, um sintético. Com ele,
  -- "sem distância, marca e local" prova alguma coisa.
  SELECT * INTO v_local FROM public.ponto_local WHERE ativo ORDER BY criado_em LIMIT 1;
  IF v_local.id IS NULL THEN
    INSERT INTO public.ponto_local (nome, latitude, longitude, raio_metros)
    VALUES ('Sede da Empresa Exemplo', -23.550520, -46.633308, 150)
    RETURNING * INTO v_local;
  END IF;

  -- C1. Sem sessão, ponto_meu_acesso responde "não" em tudo.
  v_a := public.ponto_meu_acesso();
  v_res := v_res || format('%s C1 sem sessao: nao nas sete chaves',
    CASE WHEN v_a = jsonb_build_object('tem_acesso', false, 'origem', NULL, 'administra', false, 'super_admin', false,
                                       'bate_ponto', false, 'nome', NULL, 'cargo', NULL)
         THEN 'OK' ELSE 'FALHOU' END);

  -- ===================================================== super admin sem ficha
  -- C2. Entra, administra e bate; sem ficha e sem nome guardado pela função
  --     de contas, o nome é o e-mail (o que ele mesmo escreveu no
  --     user_metadata não conta).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super, 'role', 'authenticated')::text, true);
  v_a := public.ponto_meu_acesso();
  v_res := v_res || format('%s C2 super admin sem ficha entra, administra e bate (%s)',
    CASE WHEN v_a = jsonb_build_object('tem_acesso', true, 'origem', 'administracao', 'administra', true, 'super_admin', true,
                                       'bate_ponto', true, 'nome', 'sergio.teste@example.invalid', 'cargo', NULL)
              AND public.ponto_pode_bater()
         THEN 'OK' ELSE 'FALHOU' END, v_a - 'nome' - 'cargo');

  -- C3. A batida que ele lança para a pessoa da ficha grava a fotografia do
  --     nome da FICHA e o e-mail da conta.
  INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
  VALUES (v_ficha, now() - interval '2 hours', 'teste do banco - batida lancada pelo super admin')
  RETURNING funcionario_nome, funcionario_email, origem, criado_por INTO v_reg;
  v_res := v_res || format('%s C3 fotografia da batida lancada pelo super admin: nome da ficha=%s, e-mail da conta=%s, origem=%s',
    CASE WHEN v_reg.funcionario_nome = 'Ana Beatriz Rocha' AND v_reg.funcionario_email = 'ana.teste@example.invalid'
              AND v_reg.origem = 'ajuste_admin' AND v_reg.criado_por = v_super
         THEN 'OK' ELSE 'FALHOU' END,
    v_reg.funcionario_nome = 'Ana Beatriz Rocha', v_reg.funcionario_email = 'ana.teste@example.invalid', v_reg.origem);

  -- C4. Ele lança uma ausência.
  BEGIN
    INSERT INTO public.ponto_ausencias (usuario_id, dia_inicio, dia_fim, tipo, observacao)
    VALUES (v_ficha, v_hoje - 3, v_hoje - 3, 'falta_justificada', 'teste do banco - ausencia lancada pelo super admin');
    v_res := v_res || 'OK C4 o super admin lanca ausencia'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU C4 o super admin nao lancou a ausencia: %s %s', SQLSTATE, SQLERRM);
  END;

  -- C5. Ele sobe a própria selfie, como o app (papel authenticated, regras do
  --     storage, o caminho da convenção: {conta}/{aaaa}/{mm}/{uuid}.jpg).
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('ponto-selfies', v_super::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg', v_super::text);
    v_res := v_res || 'OK C5 o super admin sobe a propria selfie'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU C5 o super admin nao subiu a selfie: %s %s', SQLSTATE, SQLERRM);
  END;
  RESET ROLE;

  -- C6. A trava de futuro recusa a batida de amanhã.
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_ficha, now() + interval '1 day', 'teste do banco - batida no futuro');
    v_res := v_res || 'FALHOU C6 a batida de amanha entrou'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s C6 trava de futuro recusa a batida de amanha (%s)',
      CASE WHEN SQLSTATE = '23514' AND SQLERRM LIKE 'Horário no futuro:%' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- ===================================================== administrador sem ficha
  -- C7. Entra e administra, mas não bate.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_a := public.ponto_meu_acesso();
  v_res := v_res || format('%s C7 administrador sem ficha entra e administra, nao bate (%s)',
    CASE WHEN v_a = jsonb_build_object('tem_acesso', true, 'origem', 'administracao', 'administra', true, 'super_admin', false,
                                       'bate_ponto', false, 'nome', 'Rita Moraes', 'cargo', NULL)
              AND public.ponto_ator_aprovado() AND NOT public.ponto_pode_bater()
         THEN 'OK' ELSE 'FALHOU' END, v_a - 'nome' - 'cargo');

  -- C8. Ele lê as contas do ponto, com o nome guardado em cada conta pela
  --     função de contas (e não o da ficha: a tela de pessoas mostra os
  --     dois). O nome que a Rita e o Sérgio escreveram no próprio
  --     user_metadata não aparece: a Rita sai com o nome guardado, e o
  --     Sérgio, sem nome.
  SELECT count(*) INTO v_n FROM public.ponto_contas() c
  WHERE (c.usuario_id, c.email, c.nome) IN ((v_admin, 'rita.teste@example.invalid', 'Rita Moraes'),
                                            (v_ficha, 'ana.teste@example.invalid', 'Ana'))
     OR (c.usuario_id = v_super AND c.nome IS NULL AND c.criado_em IS NOT NULL);
  v_res := v_res || format('%s C8 ponto_contas() para quem administra: %s de 3 linhas esperadas',
    CASE WHEN v_n = 3 THEN 'OK' ELSE 'FALHOU' END, v_n);

  -- ===================================================== ficha ativa
  -- C9. Entra e bate; nome e cargo da ficha.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ficha, 'role', 'authenticated')::text, true);
  v_a := public.ponto_meu_acesso();
  v_res := v_res || format('%s C9 ficha ativa entra e bate, com o nome e o cargo da ficha (%s)',
    CASE WHEN v_a = jsonb_build_object('tem_acesso', true, 'origem', 'ficha', 'administra', false, 'super_admin', false,
                                       'bate_ponto', true, 'nome', 'Ana Beatriz Rocha', 'cargo', 'Vendas')
              AND public.ponto_ator_aprovado() AND public.ponto_pode_bater()
         THEN 'OK' ELSE 'FALHOU' END, v_a - 'nome' - 'cargo');

  -- C10. Não lê as contas.
  BEGIN
    PERFORM * FROM public.ponto_contas();
    v_res := v_res || 'FALHOU C10 ponto_contas() respondeu a quem nao administra'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s C10 ponto_contas() recusa quem nao administra (%s)',
      CASE WHEN SQLSTATE = '42501' THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- ===================================================== ficha desligada e sem papel
  -- C11. Ficha desligada: não entra, não bate, e a ficha continua dando o nome.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_deslig, 'role', 'authenticated')::text, true);
  v_a := public.ponto_meu_acesso();
  v_res := v_res || format('%s C11 ficha desligada nao entra nem bate, e a ficha continua dando o nome (%s)',
    CASE WHEN v_a = jsonb_build_object('tem_acesso', false, 'origem', NULL, 'administra', false, 'super_admin', false,
                                       'bate_ponto', false, 'nome', 'Fernanda Teles', 'cargo', 'Vendas')
              AND NOT public.ponto_ator_aprovado() AND NOT public.ponto_pode_bater()
         THEN 'OK' ELSE 'FALHOU' END, v_a - 'nome' - 'cargo');

  -- C12. Nem ficha nem papel: não entra; o nome é o guardado na conta.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nada, 'role', 'authenticated')::text, true);
  v_a := public.ponto_meu_acesso();
  v_res := v_res || format('%s C12 nem ficha nem papel: nao entra, nome guardado na conta (%s)',
    CASE WHEN v_a = jsonb_build_object('tem_acesso', false, 'origem', NULL, 'administra', false, 'super_admin', false,
                                       'bate_ponto', false, 'nome', 'Vítor Campos', 'cargo', NULL)
         THEN 'OK' ELSE 'FALHOU' END, v_a - 'nome' - 'cargo');

  -- C12b. O local (coordenada e raio) e a configuração (razão social, CNPJ,
  --       endereço) são de quem tem acesso ao ponto: a conta sem ficha e sem
  --       papel, e a da ficha desligada, leem zero linhas; a ficha ativa e
  --       quem administra leem as duas. É a regra de SELECT, pela sessão.
  v_erros := '{}';
  FOR v_conta IN
    SELECT * FROM (VALUES (v_nada, 'sem ficha e sem papel', false), (v_deslig, 'ficha desligada', false),
                          (v_ficha, 'ficha ativa', true), (v_admin, 'administra sem ficha', true)) c(id, quem, ve)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_conta.id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_ok := (SELECT count(*) FROM public.ponto_local) > 0;
    v_ok2 := (SELECT count(*) FROM public.ponto_configuracao) > 0;
    RESET ROLE;
    IF v_ok IS DISTINCT FROM v_conta.ve OR v_ok2 IS DISTINCT FROM v_conta.ve THEN
      v_erros := v_erros || format('%s le local=%s configuracao=%s', v_conta.quem, v_ok, v_ok2);
    END IF;
  END LOOP;
  v_res := v_res || format('%s C12b local e configuracao so para quem tem acesso%s',
    CASE WHEN cardinality(v_erros) = 0 THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN cardinality(v_erros) = 0 THEN ' (sem ficha e sem papel e ficha desligada: 0 linhas; ficha ativa e administracao: leem)'
         ELSE ': ' || array_to_string(v_erros, '; ') END);
  v_erros := '{}';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nada, 'role', 'authenticated')::text, true);

  -- ===================================================== a sessão da pessoa da ficha
  -- C13. Com a sessão da pessoa da ficha, a batida é sempre dela e do app,
  --      mesmo mandando outro dono e outro horário (um INSERT que chegasse por
  --      fora da RLS, com o token dela): conta dela, horário do servidor,
  --      origem app, sem marca nem motivo, nome da ficha.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ficha, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.ponto_registros (usuario_id, registrado_em, motivo_ajuste)
    VALUES (v_admin, now() - interval '3 hours', 'teste do banco - dono e horario forjados')
    RETURNING usuario_id, registrado_em, origem, ajuste_manual, motivo_ajuste, funcionario_nome INTO v_reg;
    v_res := v_res || format('%s C13 a batida pela sessao da ficha e dela e do app: dona=%s horario do servidor=%s origem=%s nome da ficha=%s',
      CASE WHEN v_reg.usuario_id = v_ficha AND v_reg.registrado_em = now() AND v_reg.origem = 'app'
                AND NOT v_reg.ajuste_manual AND v_reg.motivo_ajuste IS NULL AND v_reg.funcionario_nome = 'Ana Beatriz Rocha'
           THEN 'OK' ELSE 'FALHOU' END,
      v_reg.usuario_id = v_ficha, v_reg.registrado_em = now(), v_reg.origem, v_reg.funcionario_nome = 'Ana Beatriz Rocha');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU C13 a batida pela sessao da ficha foi recusada: %s %s', SQLSTATE, SQLERRM);
  END;

  -- C14. A pessoa da ficha sobe a própria selfie (papel authenticated), no
  --      caminho da convenção.
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('ponto-selfies', v_ficha::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg', v_ficha::text);
    v_res := v_res || 'OK C14 a pessoa da ficha sobe a propria selfie'::text;
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('FALHOU C14 a selfie da pessoa da ficha foi recusada: %s %s', SQLSTATE, SQLERRM);
  END;

  -- C14b. Fora da convenção, nem na própria pasta: sem o ano e o mês, com
  --       outro nome que não um uuid, ou outra extensão. As RPCs só aceitam
  --       a convenção, então um arquivo fora dela nunca vira prova e só
  --       ocuparia o bucket.
  v_erros := '{}';
  FOR v_txt IN
    SELECT unnest(ARRAY[
      v_ficha::text || '/' || gen_random_uuid()::text || '.jpg',
      v_ficha::text || '/' || v_mes || '/foto-qualquer.jpg',
      v_ficha::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.png',
      v_ficha::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg/extra.jpg'
    ])
  LOOP
    BEGIN
      INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('ponto-selfies', v_txt, v_ficha::text);
      v_erros := v_erros || ('aceito: ' || substr(v_txt, 38));
    EXCEPTION WHEN OTHERS THEN
      IF NOT (SQLSTATE = '42501' AND SQLERRM LIKE 'Caminho de selfie fora da convencao%') THEN
        v_erros := v_erros || (substr(v_txt, 38) || ': ' || SQLSTATE || ' ' || left(SQLERRM, 50));
      END IF;
    END;
  END LOOP;
  RESET ROLE;
  v_res := v_res || format('%s C14b selfie fora da convencao recusada com a frase propria (4 caminhos)%s',
    CASE WHEN cardinality(v_erros) = 0 THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN cardinality(v_erros) = 0 THEN '' ELSE ': ' || array_to_string(v_erros, '; ') END);
  v_erros := '{}';

  -- C14c. O teto da hora: 20 selfies por conta na última hora. Com 19 já
  --       enviadas (gravadas aqui sem sessão, como o storage as guardaria), a
  --       20ª passa e a 21ª é recusada, com a frase própria.
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata, created_at)
  SELECT 'ponto-selfies', v_teto_hora::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg',
         v_teto_hora, v_teto_hora::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1),
         now() - make_interval(mins => k)
  FROM generate_series(1, 19) k;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teto_hora, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('ponto-selfies', v_teto_hora::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg', v_teto_hora::text);
    v_t := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_t := 'a 20a recusada: ' || SQLSTATE || ' ' || left(SQLERRM, 60);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('ponto-selfies', v_teto_hora::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg', v_teto_hora::text);
    v_t2 := 'a 21a aceita';
  EXCEPTION WHEN OTHERS THEN
    v_t2 := CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'Selfies demais nesta conta%' THEN NULL
                 ELSE 'a 21a: ' || SQLSTATE || ' ' || left(SQLERRM, 60) END;
  END;
  RESET ROLE;
  v_res := v_res || format('%s C14c teto de selfies da hora: a 20a passa, a 21a e recusada com a frase propria%s',
    CASE WHEN v_t IS NULL AND v_t2 IS NULL THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN v_t IS NULL AND v_t2 IS NULL THEN '' ELSE ' (' || concat_ws('; ', v_t, v_t2) || ')' END);

  -- C14d. O teto do dia: 60 selfies por conta em 24 horas. Com 59 enviadas
  --       entre 2 e 23 horas atrás (fora do teto da hora) e uma de 30 horas
  --       atrás (fora das 24), a 60ª passa e a 61ª é recusada.
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata, created_at)
  SELECT 'ponto-selfies', v_teto_dia::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg',
         v_teto_dia, v_teto_dia::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1),
         now() - interval '2 hours' - make_interval(mins => k * 20)
  FROM generate_series(1, 59) k;
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata, created_at)
  VALUES ('ponto-selfies', v_teto_dia::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg',
          v_teto_dia, v_teto_dia::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1), now() - interval '30 hours');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teto_dia, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('ponto-selfies', v_teto_dia::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg', v_teto_dia::text);
    v_t := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_t := 'a 60a recusada: ' || SQLSTATE || ' ' || left(SQLERRM, 60);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('ponto-selfies', v_teto_dia::text || '/' || v_mes || '/' || gen_random_uuid()::text || '.jpg', v_teto_dia::text);
    v_t2 := 'a 61a aceita';
  EXCEPTION WHEN OTHERS THEN
    v_t2 := CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'Selfies demais nesta conta%' THEN NULL
                 ELSE 'a 61a: ' || SQLSTATE || ' ' || left(SQLERRM, 60) END;
  END;
  RESET ROLE;
  v_res := v_res || format('%s C14d teto de selfies do dia: a 60a passa, a 61a e recusada com a frase propria%s',
    CASE WHEN v_t IS NULL AND v_t2 IS NULL THEN 'OK' ELSE 'FALHOU' END,
    CASE WHEN v_t IS NULL AND v_t2 IS NULL THEN '' ELSE ' (' || concat_ws('; ', v_t, v_t2) || ')' END);

  -- ===================================================== sem localização
  -- Quando o GPS do aparelho não responde ('indisponivel' ou 'demora'), a
  -- batida e o pedido de batida esquecida saem SEM LOCALIZAÇÃO, com selfie e
  -- PIN. Sem motivo aceito (o app que não manda o parâmetro, ou a permissão
  -- negada) e com meia coordenada, a recusa de sempre, antes do PIN. Pela RPC
  -- de verdade, como o app (papel authenticated, argumentos por nome, como o
  -- PostgREST manda).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sem_gps, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- C15. Sem coordenada e sem motivo.
  BEGIN
    v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_bat_sem,
                p_selfie_path => v_sem_gps::text || '/' || v_mes || '/' || v_bat_sem::text || '.jpg',
                p_latitude => NULL, p_longitude => NULL, p_precisao_metros => NULL);
    v_res := v_res || format('FALHOU C15 a batida sem coordenada e sem motivo entrou: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s C15 batida sem coordenada e sem motivo recusada (%s)',
      CASE WHEN SQLSTATE = '22023' AND SQLERRM = c_sem_coordenada THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- C16. Com a permissão negada.
  BEGIN
    v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_bat_sem,
                p_selfie_path => v_sem_gps::text || '/' || v_mes || '/' || v_bat_sem::text || '.jpg',
                p_latitude => NULL, p_longitude => NULL, p_precisao_metros => NULL, p_sem_localizacao => 'negada');
    v_res := v_res || format('FALHOU C16 a batida com a permissao negada entrou: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s C16 batida com a permissao negada recusada (%s)',
      CASE WHEN SQLSTATE = '22023' AND SQLERRM = c_sem_coordenada THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- C17. Com meia coordenada.
  BEGIN
    v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_bat_sem,
                p_selfie_path => v_sem_gps::text || '/' || v_mes || '/' || v_bat_sem::text || '.jpg',
                p_latitude => v_local.latitude, p_longitude => NULL, p_precisao_metros => NULL, p_sem_localizacao => 'demora');
    v_res := v_res || format('FALHOU C17 a batida com meia coordenada entrou: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s C17 batida com meia coordenada recusada (%s)',
      CASE WHEN SQLSTATE = '22023' AND SQLERRM = c_sem_coordenada THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- C18. O GPS demorou: a batida sai, de origem app, no horário do servidor,
  --      com a selfie e sem coordenada, precisão (a que veio é descartada),
  --      distância, marca e local; as três recusas acima não contaram
  --      tentativa de PIN.
  BEGIN
    v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_bat_sem,
                p_selfie_path => v_sem_gps::text || '/' || v_mes || '/' || v_bat_sem::text || '.jpg',
                p_latitude => NULL, p_longitude => NULL, p_precisao_metros => 12, p_sem_localizacao => 'demora');
  EXCEPTION WHEN OTHERS THEN
    v_resp := jsonb_build_object('erro', SQLERRM);
  END;
  RESET ROLE;
  SELECT * INTO v_linha FROM public.ponto_registros WHERE id = v_bat_sem;
  SELECT count(*) INTO v_n FROM public.ponto_pin_tentativas WHERE usuario_id = v_sem_gps;
  v_ok := (v_resp ->> 'gravado') IS NOT DISTINCT FROM 'true' AND v_linha.id IS NOT NULL
      AND v_linha.origem = 'app' AND NOT v_linha.ajuste_manual AND v_linha.registrado_em = now()
      AND v_linha.latitude IS NULL AND v_linha.longitude IS NULL AND v_linha.precisao_metros IS NULL
      AND v_linha.distancia_metros IS NULL AND v_linha.no_local IS NULL AND v_linha.local_id IS NULL
      AND v_linha.selfie_path = v_sem_gps::text || '/' || v_mes || '/' || v_bat_sem::text || '.jpg'
      AND v_linha.funcionario_nome = 'Caio Mendes'
      AND v_resp -> 'registro' ->> 'latitude' IS NULL AND v_resp -> 'registro' ->> 'no_local' IS NULL
      AND v_n = 1;
  v_res := v_res || format('%s C18 batida sem localizacao (GPS demorou): %s; tentativas de PIN %s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(coalesce(v_resp ->> 'erro', 'gravado=' || (v_resp ->> 'gravado')), 80), v_n);

  -- C19. Com coordenada, o motivo é ignorado: a batida tem localização.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_com_gps, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_registrar_batida(p_pin => c_pin, p_registro_id => v_bat_com,
                p_selfie_path => v_com_gps::text || '/' || v_mes || '/' || v_bat_com::text || '.jpg',
                p_latitude => v_local.latitude, p_longitude => v_local.longitude, p_precisao_metros => 12,
                p_sem_localizacao => 'demora');
  EXCEPTION WHEN OTHERS THEN
    v_resp := jsonb_build_object('erro', SQLERRM);
  END;
  RESET ROLE;
  SELECT * INTO v_linha FROM public.ponto_registros WHERE id = v_bat_com;
  v_ok := (v_resp ->> 'gravado') IS NOT DISTINCT FROM 'true' AND v_linha.id IS NOT NULL
      AND v_linha.latitude = v_local.latitude AND v_linha.longitude = v_local.longitude
      AND v_linha.precisao_metros = 12 AND v_linha.distancia_metros = 0 AND v_linha.no_local
      AND v_linha.local_id = v_local.id;
  v_res := v_res || format('%s C19 com coordenada, o motivo sem localizacao e ignorado: %s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(coalesce(v_resp ->> 'erro', 'gravado=' || (v_resp ->> 'gravado')), 80));

  -- O pedido de batida esquecida: as mesmas recusas e o pedido sem
  -- localização, num minuto de hoje antes de agora (no primeiro minuto do dia,
  -- a meia-noite).
  v_h := greatest(date_trunc('minute', now() - interval '1 minute'),
                  ((now() AT TIME ZONE c_fuso)::date)::timestamp AT TIME ZONE c_fuso);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ped_gps, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- C20. Pedido sem coordenada e sem motivo.
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(p_pin => c_pin, p_pedido_id => v_ped_id,
                p_selfie_path => v_ped_gps::text || '/' || v_mes || '/' || v_ped_id::text || '.jpg',
                p_latitude => NULL, p_longitude => NULL, p_precisao_metros => NULL,
                p_horario_declarado => v_h, p_motivo => 'teste do banco - o GPS nao respondeu');
    v_res := v_res || format('FALHOU C20 o pedido sem coordenada e sem motivo entrou: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s C20 pedido sem coordenada e sem motivo recusado (%s)',
      CASE WHEN SQLSTATE = '22023' AND SQLERRM = c_pedido_sem_coordenada THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- C21. Pedido com meia coordenada.
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(p_pin => c_pin, p_pedido_id => v_ped_id,
                p_selfie_path => v_ped_gps::text || '/' || v_mes || '/' || v_ped_id::text || '.jpg',
                p_latitude => NULL, p_longitude => v_local.longitude, p_precisao_metros => NULL,
                p_horario_declarado => v_h, p_motivo => 'teste do banco - o GPS nao respondeu',
                p_sem_localizacao => 'indisponivel');
    v_res := v_res || format('FALHOU C21 o pedido com meia coordenada entrou: %s', v_resp);
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || format('%s C21 pedido com meia coordenada recusado (%s)',
      CASE WHEN SQLSTATE = '22023' AND SQLERRM = c_pedido_sem_coordenada THEN 'OK' ELSE 'FALHOU' END, SQLSTATE);
  END;

  -- C22. O GPS não respondeu: o pedido nasce pendente e sem localização.
  BEGIN
    v_resp := public.ponto_pedir_batida_em_atraso(p_pin => c_pin, p_pedido_id => v_ped_id,
                p_selfie_path => v_ped_gps::text || '/' || v_mes || '/' || v_ped_id::text || '.jpg',
                p_latitude => NULL, p_longitude => NULL, p_precisao_metros => 30,
                p_horario_declarado => v_h, p_motivo => 'teste do banco - o GPS nao respondeu',
                p_sem_localizacao => 'indisponivel');
  EXCEPTION WHEN OTHERS THEN
    v_resp := jsonb_build_object('erro', SQLERRM);
  END;
  RESET ROLE;
  SELECT * INTO v_pedido FROM public.ponto_pedidos_atraso WHERE id = v_ped_id;
  v_ok := (v_resp ->> 'gravado') IS NOT DISTINCT FROM 'true' AND v_pedido.id IS NOT NULL AND v_pedido.estado = 'pendente'
      AND v_pedido.horario_declarado = v_h
      AND v_pedido.latitude IS NULL AND v_pedido.longitude IS NULL AND v_pedido.precisao_metros IS NULL
      AND v_pedido.distancia_metros IS NULL AND v_pedido.no_local IS NULL AND v_pedido.local_id IS NULL
      AND v_resp -> 'pedido' ->> 'latitude' IS NULL AND v_resp -> 'pedido' ->> 'no_local' IS NULL;
  v_res := v_res || format('%s C22 pedido sem localizacao (GPS indisponivel): %s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(coalesce(v_resp ->> 'erro', 'gravado=' || (v_resp ->> 'gravado')), 80));

  -- C23. A aprovação, por quem administra, cria a batida sem localização.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_resp := public.ponto_decidir_pedido_atraso(v_ped_id, true, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_resp := jsonb_build_object('erro', SQLERRM);
  END;
  RESET ROLE;
  SELECT * INTO v_linha FROM public.ponto_registros WHERE pedido_atraso_id = v_ped_id;
  SELECT * INTO v_pedido FROM public.ponto_pedidos_atraso WHERE id = v_ped_id;
  v_ok := v_resp ->> 'estado' = 'aprovado' AND v_linha.id IS NOT NULL AND v_pedido.registro_id = v_linha.id
      AND v_linha.usuario_id = v_ped_gps AND v_linha.registrado_em = v_h
      AND v_linha.origem = 'ajuste_admin' AND v_linha.ajuste_manual
      AND v_linha.selfie_path = v_pedido.selfie_path
      AND v_linha.latitude IS NULL AND v_linha.longitude IS NULL AND v_linha.precisao_metros IS NULL
      AND v_linha.distancia_metros IS NULL AND v_linha.no_local IS NULL AND v_linha.local_id IS NULL;
  v_res := v_res || format('%s C23 aprovar o pedido sem localizacao cria a batida sem localizacao: %s',
    CASE WHEN v_ok THEN 'OK' ELSE 'FALHOU' END, left(coalesce(v_resp ->> 'erro', 'estado=' || (v_resp ->> 'estado')), 80));

  -- ===================================================== as listas de administração
  -- A1. Toda conta das listas de administração (as do teste e as que o banco
  --     já tiver) entra e administra, e todo super admin bate.
  v_n := 0;
  FOR v_conta IN
    SELECT u AS usuario_id, bool_or(s) AS super
    FROM (SELECT a.usuario_id AS u, false AS s FROM public.ponto_admins a
          UNION ALL
          SELECT s.usuario_id, true FROM public.ponto_super_admins s) x
    GROUP BY u ORDER BY u
  LOOP
    v_n := v_n + 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_conta.usuario_id, 'role', 'authenticated')::text, true);
    v_a := public.ponto_meu_acesso();
    IF NOT (v_a ->> 'tem_acesso')::boolean OR NOT (v_a ->> 'administra')::boolean OR v_a ->> 'origem' IS NULL
       OR (v_conta.super AND NOT ((v_a ->> 'super_admin')::boolean AND (v_a ->> 'bate_ponto')::boolean)) THEN
      v_erros := v_erros || left(v_conta.usuario_id::text, 8);
    END IF;
  END LOOP;
  v_res := v_res || format('%s A1 %s conta(s) das listas de administracao, todas entram e administram, e o super admin bate%s',
    CASE WHEN v_n >= 2 AND cardinality(v_erros) = 0 THEN 'OK' ELSE 'FALHOU' END, v_n,
    CASE WHEN cardinality(v_erros) = 0 THEN '' ELSE '; sem acesso: ' || array_to_string(v_erros, ', ') END);

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('teste.resultado',
    concat_ws(E'\n', nullif(current_setting('teste.resultado', true), ''), array_to_string(v_res, E'\n')), true);
END $contrato$;

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
