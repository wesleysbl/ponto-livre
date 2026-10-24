-- PONTO LIVRE — A ESTRUTURA DO BANCO DO PONTO
--
-- Uma migration só, no formato do Supabase CLI, com tudo o que o ponto guarda
-- e as regras que o próprio banco impõe: 13 tabelas, 50 funções, 38 gatilhos,
-- 33 regras de acesso (27 nas tabelas e 6 em storage.objects), os dois
-- buckets privados (selfies e atestados) e a extensão pgcrypto em
-- `extensions`. Nenhuma linha de dado.
--
-- COMO APLICAR
--   • No Supabase local: `npm run db:iniciar` na primeira vez; `npm run
--     db:zerar` recria o banco do zero.
--   • No Supabase hospedado (supabase.com): `npx supabase link` e
--     `npx supabase db push`.
-- Os dois rodam este arquivo como `postgres`, numa transação só, que o CLI
-- abre e fecha: por isso não há BEGIN nem COMMIT aqui. O primeiro erro desfaz
-- o arquivo inteiro, e o histórico de migrations só registra o que deu certo.
--
-- QUEM RODA É O `postgres`, QUE NÃO É SUPERUSUÁRIO. No Supabase, hospedado ou
-- local, ninguém tem superusuário, e nada aqui precisa dele: o `postgres` cria
-- as tabelas e as funções e fica dono delas; tem BYPASSRLS, que as funções
-- SECURITY DEFINER do ponto usam para ler storage.objects e auth.users; cria
-- as regras de storage.objects e grava em storage.buckets. A partida (item 0)
-- confere tudo isso antes da primeira mudança e diz o que falta.
--
-- INSTALAÇÃO NOVA. A configuração (a linha única de ponto_configuracao) e o
-- local do ponto nascem vazios e são gravados pela tela de administração. Até
-- lá a batida usa o padrão das colunas (janela de duplicidade de 60 s) e sai
-- sem distância nem marca dentro/fora, e o app mostra os dois como "ainda não
-- configurado". As contas nascem pela função `ponto-contas`, que guarda o nome
-- de cada uma no app_metadata do login (`raw_app_meta_data`), onde só a chave
-- de serviço grava: o user_metadata a própria pessoa edita, e por isso nada
-- aqui o lê. A lista de super admins só muda por SQL do dono do banco (nem o
-- service_role grava nela): é assim que o primeiro super admin entra, na
-- instalação.
--
-- AS DEFESAS, EM CAMADAS (o porquê de cada uma está no comentário dela):
--   • RLS ligada em toda tabela, com regras só para `authenticated`. `anon`
--     não tem privilégio nenhum, em tabela, sequência ou função.
--   • Toda tabela e toda função nascem com REVOKE ALL de PUBLIC, anon,
--     authenticated e service_role (o padrão do Supabase dá tudo a todos,
--     TRUNCATE e MAINTAIN incluídos) e recebem de volta só o que o app e a
--     função de contas usam. E o que o postgres criar DEPOIS em public também
--     nasce sem nada para anon, authenticated e PUBLIC (item 13): quem
--     estender o ponto concede o que precisar com GRANT explícito.
--   • Toda função tem search_path fixo; as SECURITY DEFINER conferem a sessão
--     antes de olhar o papel.
--   • O horário da batida é o do servidor. Tipo, dia civil, distância e marca
--     dentro/fora são calculados pelo banco, nunca mandados pelo aparelho. A
--     origem 'app' só nasce pela RPC da batida (selfie, PIN e localização);
--     o INSERT direto é sempre lançamento de quem administra, com horário e
--     motivo, e ninguém lança nem corrige o próprio ponto.
--   • Batida não se apaga por sessão de ninguém, e toda correção vira linha
--     permanente em ponto_correcoes, com a linha de antes e a de depois.
--   • A selfie sobe só no caminho da convenção, com teto por hora e por dia, e
--     a recém-enviada não se apaga (uma batida pode estar sendo gravada com
--     ela).
--   • O PIN só existe como hash bcrypt, só é tocado pelas funções do PIN e
--     tranca depois de cinco erros: 15 minutos no primeiro bloqueio do dia, 1
--     hora no segundo e 24 horas do terceiro em diante.
--   • Ausência e pedido de batida em atraso não se apagam (cancelam-se ou
--     recusam-se, com motivo), e as trilhas são permanentes.
--
-- O fim (item 14) confere as contagens, a RLS, a falta de privilégio de
-- `anon`, os privilégios padrão e o CHECK sem senha da trilha de contas; se
-- algo não bater, nada fica.
-- ---------------------------------------------------------------------------

-- Valem até o fim da transação do arquivo. lock_timeout: num projeto em uso,
-- esperar um lock por mais de 10 s é desistir (e tentar de novo), e não deixar
-- o banco parado atrás da migration. check_function_bodies: o corpo de cada
-- função sql é conferido ao nascer. search_path: os nomes sem esquema das
-- regras de acesso (ponto_pode_administrar(), por exemplo) se resolvem em
-- public, e as extensões em extensions.
SET LOCAL lock_timeout = '10s';
SET LOCAL check_function_bodies = on;
SET LOCAL search_path = public, extensions;

-- 0. A partida. Só lê, e aborta com a explicação antes da primeira mudança.
DO $partida$
BEGIN
  -- PostgreSQL 17 ou mais. O padrão do Supabase dá a anon e a authenticated
  -- também o privilégio MAINTAIN (VACUUM, ANALYZE, LOCK TABLE...), que só
  -- existe do 17 em diante, e os REVOKE ALL abaixo o tiram; a estrutura e os
  -- testes do banco foram escritos e conferidos no 17.
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'Estrutura do ponto nao aplicada: o banco e PostgreSQL % e ela precisa do 17 ou mais.', current_setting('server_version')
      USING ERRCODE = '0A000',
            HINT = 'Crie o projeto Supabase com PostgreSQL 17; no Supabase local, major_version = 17 em supabase/config.toml.';
  END IF;

  -- O login e o storage do Supabase: as tabelas do ponto apontam para
  -- auth.users, as regras usam auth.uid() e storage.foldername(), e as selfies
  -- e os atestados moram em storage.objects.
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL
     OR to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR to_regprocedure('storage.foldername(text)') IS NULL THEN
    RAISE EXCEPTION 'Estrutura do ponto nao aplicada: faltam auth.users, auth.uid(), storage.objects, storage.buckets ou storage.foldername (ela roda num projeto Supabase, com o login e o storage ligados).'
      USING ERRCODE = '42P01';
  END IF;

  -- Os papéis do Supabase, a quem as permissões são dadas e tiradas.
  IF (SELECT count(*) FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'Estrutura do ponto nao aplicada: faltam os papeis anon, authenticated ou service_role do Supabase.'
      USING ERRCODE = '42704';
  END IF;

  -- Quem roda é o postgres: ele fica dono de tudo o que nasce, e as funções
  -- SECURITY DEFINER do ponto rodam como ele. Não é superusuário, mas tem
  -- BYPASSRLS (as funções DEFINER leem storage.objects e auth.users sem as
  -- regras de quem chamou), lê as duas tabelas e grava em storage.buckets.
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Estrutura do ponto nao aplicada: rode como postgres, e nao como % (o postgres fica dono das tabelas e das funcoes do ponto).', current_user
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'postgres' AND r.rolbypassrls) THEN
    RAISE EXCEPTION 'Estrutura do ponto nao aplicada: o papel postgres precisa de BYPASSRLS (as funcoes SECURITY DEFINER do ponto leem storage.objects e auth.users).'
      USING ERRCODE = '42501';
  END IF;
  IF NOT has_table_privilege('auth.users', 'SELECT')
     OR NOT has_table_privilege('storage.objects', 'SELECT')
     OR NOT has_table_privilege('storage.buckets', 'INSERT') THEN
    RAISE EXCEPTION 'Estrutura do ponto nao aplicada: o postgres precisa ler auth.users e storage.objects e gravar em storage.buckets.'
      USING ERRCODE = '42501';
  END IF;

  -- O PIN é guardado com extensions.crypt e extensions.gen_salt (pgcrypto),
  -- chamadas com o esquema escrito: instalada em outro esquema, a extensão não
  -- seria achada.
  IF to_regnamespace('extensions') IS NULL THEN
    RAISE EXCEPTION 'Estrutura do ponto nao aplicada: falta o esquema extensions do Supabase.'
      USING ERRCODE = '3F000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension e WHERE e.extname = 'pgcrypto'
             AND e.extnamespace <> 'extensions'::regnamespace) THEN
    RAISE EXCEPTION 'Estrutura do ponto nao aplicada: pgcrypto esta instalada fora do esquema extensions (o PIN chama extensions.crypt).'
      USING ERRCODE = '55000';
  END IF;
END $partida$;

-- 1. A extensão do PIN (extensions.crypt e extensions.gen_salt). O Supabase já
--    a traz em extensions; IF NOT EXISTS só confirma, ou cria se faltar.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. A função que o CHECK de ponto_contas_trilha chama vem antes da tabela.
CREATE FUNCTION public.ponto_contas_tem_chave_de_senha(p_valor jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_chave text;
  v_filho jsonb;
BEGIN
  IF p_valor IS NULL THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_valor) = 'object' THEN
    FOR v_chave, v_filho IN SELECT e.key, e.value FROM jsonb_each(p_valor) AS e LOOP
      IF lower(v_chave) = ANY (ARRAY['senha', 'password', 'senha_provisoria', 'senhaprovisoria', 'nova_senha']) THEN
        RETURN true;
      END IF;
      IF public.ponto_contas_tem_chave_de_senha(v_filho) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_valor) = 'array' THEN
    FOR v_filho IN SELECT a.value FROM jsonb_array_elements(p_valor) AS a LOOP
      IF public.ponto_contas_tem_chave_de_senha(v_filho) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_contas_tem_chave_de_senha(p_valor jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_contas_tem_chave_de_senha(p_valor jsonb) TO service_role;
COMMENT ON FUNCTION public.ponto_contas_tem_chave_de_senha(p_valor jsonb) IS 'CHECK ponto_contas_trilha_sem_senha: true se o JSON tem, em qualquer nivel, uma chave de senha (senha, password, senha_provisoria, senhaprovisoria, nova_senha), sem diferenciar maiusculas. A mesma lista de CHAVES_DE_SENHA da Edge Function ponto-contas.';

-- 3. As tabelas. Os nomes das restrições aparecem nas mensagens de erro e nos
--    testes do banco; a FK circular batida <-> pedido entra por ALTER depois
--    das duas tabelas.
CREATE SEQUENCE public.ponto_pin_tentativas_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1 NO CYCLE;

CREATE TABLE public.ponto_local (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  raio_metros integer NOT NULL DEFAULT 150,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  medido_por uuid,
  medido_em timestamp with time zone,
  CONSTRAINT ponto_local_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_local_latitude_valida CHECK (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))),
  CONSTRAINT ponto_local_longitude_valida CHECK (((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))),
  CONSTRAINT ponto_local_nome_preenchido CHECK ((btrim(nome) <> ''::text)),
  CONSTRAINT ponto_local_raio_positivo CHECK ((raio_metros > 0))
);
REVOKE ALL ON public.ponto_local FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ponto_local TO authenticated;
GRANT ALL ON public.ponto_local TO service_role;
ALTER TABLE public.ponto_local ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_registros (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  funcionario_nome text,
  funcionario_email text,
  registrado_em timestamp with time zone NOT NULL,
  dia_civil date NOT NULL,
  tipo text NOT NULL,
  ordem_no_dia integer NOT NULL,
  latitude double precision,
  longitude double precision,
  precisao_metros double precision,
  distancia_metros double precision,
  no_local boolean,
  local_id uuid,
  selfie_path text,
  origem text NOT NULL DEFAULT 'app'::text,
  ajuste_manual boolean NOT NULL DEFAULT false,
  motivo_ajuste text,
  criado_por uuid,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  pedido_atraso_id uuid,
  CONSTRAINT ponto_registros_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_registros_ajuste_exige_motivo CHECK (((NOT ajuste_manual) OR ((motivo_ajuste IS NOT NULL) AND (btrim(motivo_ajuste) <> ''::text)))),
  CONSTRAINT ponto_registros_coordenada_completa CHECK (((latitude IS NULL) = (longitude IS NULL))),
  CONSTRAINT ponto_registros_latitude_valida CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)))),
  CONSTRAINT ponto_registros_longitude_valida CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))),
  CONSTRAINT ponto_registros_origem_check CHECK ((origem = ANY (ARRAY['app'::text, 'ajuste_admin'::text]))),
  CONSTRAINT ponto_registros_precisao_positiva CHECK (((precisao_metros IS NULL) OR (precisao_metros >= (0)::double precision))),
  CONSTRAINT ponto_registros_tipo_check CHECK ((tipo = ANY (ARRAY['entrada'::text, 'saida_almoco'::text, 'volta_almoco'::text, 'saida'::text, 'extra'::text]))),
  CONSTRAINT ponto_registros_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.ponto_local(id) ON DELETE RESTRICT
);
REVOKE ALL ON public.ponto_registros FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.ponto_registros TO authenticated;
GRANT ALL ON public.ponto_registros TO service_role;
ALTER TABLE public.ponto_registros ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_correcoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  motivo text NOT NULL,
  campos text[] NOT NULL,
  valores_antes jsonb NOT NULL,
  valores_depois jsonb NOT NULL,
  autor_id uuid,
  criado_em timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  natureza text NOT NULL DEFAULT 'admin'::text,
  CONSTRAINT ponto_correcoes_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_correcoes_campos_nao_vazio CHECK ((cardinality(campos) > 0)),
  CONSTRAINT ponto_correcoes_motivo_nao_vazio CHECK ((btrim(motivo) <> ''::text)),
  CONSTRAINT ponto_correcoes_natureza_valida CHECK ((natureza = ANY (ARRAY['admin'::text, 'sistema'::text]))),
  CONSTRAINT ponto_correcoes_registro_id_fkey FOREIGN KEY (registro_id) REFERENCES public.ponto_registros(id) ON DELETE RESTRICT
);
REVOKE ALL ON public.ponto_correcoes FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.ponto_correcoes TO service_role;
GRANT SELECT ON public.ponto_correcoes TO authenticated;
ALTER TABLE public.ponto_correcoes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_pin (
  usuario_id uuid NOT NULL,
  pin_hash text NOT NULL,
  hash_versao smallint NOT NULL DEFAULT 1,
  definido_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  precisa_redefinir boolean NOT NULL DEFAULT false,
  tentativas_falhas smallint NOT NULL DEFAULT 0,
  bloqueado_ate timestamp with time zone,
  resetado_por uuid,
  resetado_em timestamp with time zone,
  bloqueios_no_dia smallint NOT NULL DEFAULT 0,
  ultimo_bloqueio_em timestamp with time zone,
  CONSTRAINT ponto_pin_pkey PRIMARY KEY (usuario_id),
  CONSTRAINT ponto_pin_bloqueios_nao_negativos CHECK ((bloqueios_no_dia >= 0)),
  CONSTRAINT ponto_pin_hash_e_bcrypt CHECK ((pin_hash ~ '^\$2[aby]?\$'::text)),
  CONSTRAINT ponto_pin_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
REVOKE ALL ON public.ponto_pin FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.ponto_pin TO service_role;
ALTER TABLE public.ponto_pin ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_pin_tentativas (
  id bigint NOT NULL DEFAULT nextval('public.ponto_pin_tentativas_id_seq'::regclass),
  usuario_id uuid NOT NULL,
  sucesso boolean NOT NULL,
  bloqueado boolean NOT NULL DEFAULT false,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ponto_pin_tentativas_pkey PRIMARY KEY (id)
);
REVOKE ALL ON public.ponto_pin_tentativas FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.ponto_pin_tentativas TO service_role;
ALTER TABLE public.ponto_pin_tentativas ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_admins (
  usuario_id uuid NOT NULL,
  concedido_por uuid,
  concedido_em timestamp with time zone NOT NULL DEFAULT now(),
  observacao text,
  CONSTRAINT ponto_admins_pkey PRIMARY KEY (usuario_id),
  CONSTRAINT ponto_admins_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
REVOKE ALL ON public.ponto_admins FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.ponto_admins TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ponto_admins TO authenticated;
ALTER TABLE public.ponto_admins ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_configuracao (
  id integer NOT NULL DEFAULT 1,
  razao_social text,
  nome_fantasia text,
  cnpj text,
  endereco text,
  cidade text,
  uf text,
  carga_diaria_minutos integer NOT NULL DEFAULT 480,
  tolerancia_minutos integer NOT NULL DEFAULT 10,
  janela_duplicidade_segundos integer NOT NULL DEFAULT 60,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ponto_configuracao_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_configuracao_carga_diaria_razoavel CHECK (((carga_diaria_minutos >= 60) AND (carga_diaria_minutos <= 720))),
  CONSTRAINT ponto_configuracao_cnpj_com_14_digitos CHECK (((cnpj IS NULL) OR (cnpj ~ '^[0-9]{14}$'::text))),
  CONSTRAINT ponto_configuracao_janela_protege CHECK (((janela_duplicidade_segundos >= 10) AND (janela_duplicidade_segundos <= 900))),
  CONSTRAINT ponto_configuracao_linha_unica CHECK ((id = 1)),
  CONSTRAINT ponto_configuracao_tolerancia_razoavel CHECK (((tolerancia_minutos >= 0) AND (tolerancia_minutos <= 60))),
  CONSTRAINT ponto_configuracao_uf_com_2_letras CHECK (((uf IS NULL) OR (uf ~ '^[A-Z]{2}$'::text)))
);
REVOKE ALL ON public.ponto_configuracao FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.ponto_configuracao TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ponto_configuracao TO authenticated;
ALTER TABLE public.ponto_configuracao ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_funcionarios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid,
  nome_completo text NOT NULL,
  cpf text,
  matricula text,
  cargo text,
  admissao date,
  desligamento date,
  ctps text,
  ctps_serie text,
  centro_custo text,
  ativo boolean NOT NULL DEFAULT true,
  bate_ponto_desde date,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ponto_funcionarios_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_funcionarios_cpf_com_11_digitos CHECK (((cpf IS NULL) OR (cpf ~ '^[0-9]{11}$'::text))),
  CONSTRAINT ponto_funcionarios_desligamento_depois_da_admissao CHECK (((desligamento IS NULL) OR (admissao IS NULL) OR (desligamento >= admissao))),
  CONSTRAINT ponto_funcionarios_nome_preenchido CHECK ((btrim(nome_completo) <> ''::text)),
  CONSTRAINT ponto_funcionarios_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE SET NULL
);
REVOKE ALL ON public.ponto_funcionarios FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.ponto_funcionarios TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ponto_funcionarios TO authenticated;
ALTER TABLE public.ponto_funcionarios ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_registros_apagados (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  motivo text NOT NULL,
  papel text NOT NULL,
  linha jsonb NOT NULL,
  apagado_em timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ponto_registros_apagados_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_registros_apagados_motivo_nao_vazio CHECK ((btrim(motivo) <> ''::text))
);
REVOKE ALL ON public.ponto_registros_apagados FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ponto_registros_apagados TO authenticated;
GRANT SELECT ON public.ponto_registros_apagados TO service_role;
ALTER TABLE public.ponto_registros_apagados ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_pedidos_atraso (
  id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  horario_declarado timestamp with time zone NOT NULL,
  dia_civil date NOT NULL,
  motivo text NOT NULL,
  pedido_em timestamp with time zone NOT NULL DEFAULT now(),
  selfie_path text NOT NULL,
  latitude double precision,
  longitude double precision,
  precisao_metros double precision,
  distancia_metros double precision,
  no_local boolean,
  local_id uuid,
  funcionario_nome text,
  funcionario_email text,
  estado text NOT NULL DEFAULT 'pendente'::text,
  decidido_por uuid,
  decidido_em timestamp with time zone,
  motivo_decisao text,
  registro_id uuid,
  CONSTRAINT ponto_pedidos_atraso_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_pedidos_atraso_registro_id_key UNIQUE (registro_id),
  CONSTRAINT ponto_pedidos_atraso_antes_do_pedido CHECK ((horario_declarado <= pedido_em)),
  CONSTRAINT ponto_pedidos_atraso_batida_so_se_aprovado CHECK (((registro_id IS NULL) OR (estado = 'aprovado'::text))),
  CONSTRAINT ponto_pedidos_atraso_coordenada_completa CHECK (((latitude IS NULL) = (longitude IS NULL))),
  CONSTRAINT ponto_pedidos_atraso_decisao_coerente CHECK (((estado = 'pendente'::text) = ((decidido_por IS NULL) AND (decidido_em IS NULL)))),
  CONSTRAINT ponto_pedidos_atraso_estado_valido CHECK ((estado = ANY (ARRAY['pendente'::text, 'aprovado'::text, 'recusado'::text]))),
  CONSTRAINT ponto_pedidos_atraso_latitude_valida CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)))),
  CONSTRAINT ponto_pedidos_atraso_longitude_valida CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))),
  CONSTRAINT ponto_pedidos_atraso_motivo_tamanho CHECK (((char_length(btrim(motivo)) >= 10) AND (char_length(btrim(motivo)) <= 500))),
  CONSTRAINT ponto_pedidos_atraso_precisao_positiva CHECK (((precisao_metros IS NULL) OR (precisao_metros >= (0)::double precision))),
  CONSTRAINT ponto_pedidos_atraso_recusa_tem_motivo CHECK (((estado <> 'recusado'::text) OR ((motivo_decisao IS NOT NULL) AND (btrim(motivo_decisao) <> ''::text)))),
  CONSTRAINT ponto_pedidos_atraso_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.ponto_local(id),
  CONSTRAINT ponto_pedidos_atraso_registro_id_fkey FOREIGN KEY (registro_id) REFERENCES public.ponto_registros(id)
);
REVOKE ALL ON public.ponto_pedidos_atraso FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ponto_pedidos_atraso TO authenticated;
GRANT SELECT ON public.ponto_pedidos_atraso TO service_role;
ALTER TABLE public.ponto_pedidos_atraso ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_super_admins (
  usuario_id uuid NOT NULL,
  concedido_em timestamp with time zone NOT NULL DEFAULT now(),
  observacao text,
  CONSTRAINT ponto_super_admins_pkey PRIMARY KEY (usuario_id),
  CONSTRAINT ponto_super_admins_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
REVOKE ALL ON public.ponto_super_admins FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ponto_super_admins TO authenticated;
GRANT SELECT ON public.ponto_super_admins TO service_role;
ALTER TABLE public.ponto_super_admins ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_ausencias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  dia_inicio date NOT NULL,
  dia_fim date NOT NULL,
  tipo text NOT NULL,
  observacao text,
  atestado_path text,
  lancado_por uuid NOT NULL,
  lancado_em timestamp with time zone NOT NULL DEFAULT now(),
  cancelada_em timestamp with time zone,
  cancelada_por uuid,
  motivo_cancelamento text,
  CONSTRAINT ponto_ausencias_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_ausencias_atestado_no_caminho_combinado CHECK (((atestado_path IS NULL) OR (atestado_path ~ (((('^'::text || (usuario_id)::text) || '/'::text) || (id)::text) || '\.(jpg|jpeg|png|webp|heic|pdf)$'::text)))),
  CONSTRAINT ponto_ausencias_cancelamento_completo CHECK ((((cancelada_em IS NULL) AND (cancelada_por IS NULL) AND (motivo_cancelamento IS NULL)) OR ((cancelada_em IS NOT NULL) AND (cancelada_por IS NOT NULL) AND (motivo_cancelamento IS NOT NULL) AND (btrim(motivo_cancelamento) <> ''::text)))),
  CONSTRAINT ponto_ausencias_motivo_cancelamento_curto CHECK (((motivo_cancelamento IS NULL) OR (char_length(motivo_cancelamento) <= 500))),
  CONSTRAINT ponto_ausencias_observacao_preenchida_e_curta CHECK (((observacao IS NULL) OR ((btrim(observacao) <> ''::text) AND (char_length(observacao) <= 1000)))),
  CONSTRAINT ponto_ausencias_outro_tem_observacao CHECK (((tipo <> 'outro'::text) OR (observacao IS NOT NULL))),
  CONSTRAINT ponto_ausencias_periodo_ate_120_dias CHECK (((dia_fim - dia_inicio) <= 119)),
  CONSTRAINT ponto_ausencias_periodo_em_ordem CHECK ((dia_fim >= dia_inicio)),
  CONSTRAINT ponto_ausencias_tipo_valido CHECK ((tipo = ANY (ARRAY['atestado_medico'::text, 'falta_justificada'::text, 'outro'::text])))
);
REVOKE ALL ON public.ponto_ausencias FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ponto_ausencias TO authenticated;
GRANT SELECT ON public.ponto_ausencias TO service_role;
ALTER TABLE public.ponto_ausencias ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ponto_contas_trilha (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  acao text NOT NULL,
  resultado text NOT NULL,
  autor_id uuid NOT NULL,
  autor_email text,
  alvo_usuario_id uuid NOT NULL,
  antes jsonb NOT NULL DEFAULT '{}'::jsonb,
  depois jsonb NOT NULL DEFAULT '{}'::jsonb,
  passos jsonb NOT NULL DEFAULT '[]'::jsonb,
  detalhe text,
  feito_em timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ponto_contas_trilha_pkey PRIMARY KEY (id),
  CONSTRAINT ponto_contas_trilha_acao_valida CHECK ((acao = ANY (ARRAY['criar_conta'::text, 'trocar_nome'::text, 'trocar_email'::text, 'redefinir_senha'::text]))),
  CONSTRAINT ponto_contas_trilha_detalhe_curto CHECK (((detalhe IS NULL) OR (char_length(detalhe) <= 2000))),
  CONSTRAINT ponto_contas_trilha_falha_explicada CHECK (((resultado = 'feito'::text) OR ((detalhe IS NOT NULL) AND (btrim(detalhe) <> ''::text)))),
  CONSTRAINT ponto_contas_trilha_formato CHECK (((jsonb_typeof(antes) = 'object'::text) AND (jsonb_typeof(depois) = 'object'::text) AND (jsonb_typeof(passos) = 'array'::text))),
  CONSTRAINT ponto_contas_trilha_resultado_valido CHECK ((resultado = ANY (ARRAY['feito'::text, 'desfeito'::text, 'incompleto'::text]))),
  CONSTRAINT ponto_contas_trilha_sem_senha CHECK (((NOT public.ponto_contas_tem_chave_de_senha(antes)) AND (NOT public.ponto_contas_tem_chave_de_senha(depois)) AND (NOT public.ponto_contas_tem_chave_de_senha(passos))))
);
REVOKE ALL ON public.ponto_contas_trilha FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ponto_contas_trilha TO authenticated;
GRANT SELECT ON public.ponto_contas_trilha TO service_role;
ALTER TABLE public.ponto_contas_trilha ENABLE ROW LEVEL SECURITY;

ALTER SEQUENCE public.ponto_pin_tentativas_id_seq OWNED BY public.ponto_pin_tentativas.id;
REVOKE ALL ON SEQUENCE public.ponto_pin_tentativas_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.ponto_pin_tentativas_id_seq TO service_role;

ALTER TABLE public.ponto_registros ADD CONSTRAINT ponto_registros_pedido_atraso_id_fkey FOREIGN KEY (pedido_atraso_id) REFERENCES public.ponto_pedidos_atraso(id);

GRANT INSERT (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path) ON public.ponto_ausencias TO authenticated;
GRANT UPDATE (motivo_cancelamento) ON public.ponto_ausencias TO authenticated;
GRANT INSERT (acao, resultado, autor_id, autor_email, alvo_usuario_id, antes, depois, passos, detalhe) ON public.ponto_contas_trilha TO service_role;

-- 4. Índices (os que não nascem de restrição).
CREATE INDEX idx_ponto_ausencias_periodo ON public.ponto_ausencias USING btree (dia_inicio, dia_fim);
CREATE INDEX idx_ponto_ausencias_usuario_periodo ON public.ponto_ausencias USING btree (usuario_id, dia_inicio, dia_fim);
CREATE INDEX idx_ponto_contas_trilha_alvo ON public.ponto_contas_trilha USING btree (alvo_usuario_id, feito_em DESC);
CREATE INDEX idx_ponto_contas_trilha_feito_em ON public.ponto_contas_trilha USING btree (feito_em DESC);
CREATE INDEX idx_ponto_correcoes_registro ON public.ponto_correcoes USING btree (registro_id, criado_em DESC);
CREATE INDEX idx_ponto_correcoes_usuario ON public.ponto_correcoes USING btree (usuario_id, criado_em DESC);
CREATE UNIQUE INDEX idx_ponto_local_um_ativo ON public.ponto_local USING btree (ativo) WHERE ativo;
CREATE INDEX idx_ponto_pedidos_atraso_pendentes ON public.ponto_pedidos_atraso USING btree (pedido_em) WHERE (estado = 'pendente'::text);
CREATE INDEX idx_ponto_pedidos_atraso_selfie ON public.ponto_pedidos_atraso USING btree (selfie_path);
CREATE INDEX idx_ponto_pedidos_atraso_usuario ON public.ponto_pedidos_atraso USING btree (usuario_id, horario_declarado DESC);
CREATE INDEX idx_ponto_pin_tentativas_conta ON public.ponto_pin_tentativas USING btree (usuario_id, criado_em DESC);
CREATE INDEX idx_ponto_registros_apagados_usuario ON public.ponto_registros_apagados USING btree (usuario_id, apagado_em DESC);
CREATE INDEX idx_ponto_registros_dia ON public.ponto_registros USING btree (dia_civil);
CREATE INDEX idx_ponto_registros_selfie_path ON public.ponto_registros USING btree (selfie_path);
CREATE INDEX idx_ponto_registros_usuario_dia ON public.ponto_registros USING btree (usuario_id, dia_civil);
CREATE INDEX idx_ponto_registros_usuario_momento ON public.ponto_registros USING btree (usuario_id, registrado_em DESC);
CREATE UNIQUE INDEX ponto_funcionarios_conta_unica ON public.ponto_funcionarios USING btree (usuario_id) WHERE (usuario_id IS NOT NULL);
CREATE UNIQUE INDEX ponto_funcionarios_cpf_unico_entre_ativos ON public.ponto_funcionarios USING btree (cpf) WHERE (ativo AND (cpf IS NOT NULL));
CREATE UNIQUE INDEX uq_ponto_pedidos_atraso_pendente_por_minuto ON public.ponto_pedidos_atraso USING btree (usuario_id, horario_declarado) WHERE (estado = 'pendente'::text);
CREATE UNIQUE INDEX uq_ponto_registros_pedido_atraso ON public.ponto_registros USING btree (pedido_atraso_id) WHERE (pedido_atraso_id IS NOT NULL);

-- 5. Funções LANGUAGE sql, em ordem de dependência: com check_function_bodies
--    ligado, o corpo de uma função sql é conferido ao nascer, e o que ele chama
--    já tem de existir.

CREATE FUNCTION public.ponto_distancia_metros(p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = public
AS $$
  -- 6371000 = raio médio da Terra em metros.
  -- O least(1.0, ...) contém erro de ponto flutuante: para coordenadas quase
  -- idênticas a soma pode passar de 1 por arredondamento e asin() estouraria
  -- com "input is out of range" justamente no caso mais comum (bater ponto
  -- parado no mesmo lugar).
  SELECT 6371000.0 * 2.0 * asin(least(1.0, sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2.0), 2.0)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lon2 - p_lon1) / 2.0), 2.0)
  )));
$$;
REVOKE ALL ON FUNCTION public.ponto_distancia_metros(p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_distancia_metros(p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision) TO authenticated, service_role;

CREATE FUNCTION public.ponto_ficha_libera_acesso(p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p_usuario_id IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM public.ponto_funcionarios f
           WHERE f.usuario_id = p_usuario_id
             AND f.ativo
             -- No dia do desligamento a pessoa ainda bate a saída.
             AND (f.desligamento IS NULL
                  OR f.desligamento >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
         );
$$;
REVOKE ALL ON FUNCTION public.ponto_ficha_libera_acesso(p_usuario_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_ficha_libera_acesso(p_usuario_id uuid) TO authenticated, service_role;

CREATE FUNCTION public.ponto_pode_administrar()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (
           EXISTS (
             SELECT 1 FROM public.ponto_admins
             WHERE usuario_id = auth.uid()
           )
           -- O super admin administra mesmo fora de ponto_admins.
           OR EXISTS (
             SELECT 1 FROM public.ponto_super_admins
             WHERE usuario_id = auth.uid()
           )
         );
$$;
REVOKE ALL ON FUNCTION public.ponto_pode_administrar() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_pode_administrar() TO authenticated, service_role;

CREATE FUNCTION public.ponto_sou_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  -- Sessão antes de papel: sem auth.uid(), false (nunca o "backend confiável"
  -- de ponto_ator_aprovado).
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM public.ponto_super_admins s
           WHERE s.usuario_id = auth.uid()
         );
$$;
REVOKE ALL ON FUNCTION public.ponto_sou_super_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_sou_super_admin() TO authenticated, service_role;

CREATE FUNCTION public.ponto_pode_bater()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Bate ponto e pede batida em atraso quem tem ficha que libera acesso OU é
  -- super admin (este, para testar o fluxo: a folha sai por ficha, e a batida
  -- de quem não tem ficha não entra na folha de ninguém). Quem só administra
  -- não bate.
  SELECT auth.uid() IS NOT NULL
     AND (public.ponto_ficha_libera_acesso(auth.uid())
          OR public.ponto_sou_super_admin());
$$;
REVOKE ALL ON FUNCTION public.ponto_pode_bater() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_pode_bater() TO service_role;

CREATE FUNCTION public.ponto_ator_aprovado()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Entrar no app e definir ou conferir o PIN = ficha que libera acesso OU
  -- administrar (ponto_pode_administrar, que já cobre o super admin). Sem
  -- sessão (`auth.uid() IS NULL`) a resposta é true: é o backend confiável
  -- (service_role, migration). Por isso toda função que a usa exige sessão
  -- antes. Bater e pedir batida em atraso pedem mais: ponto_pode_bater.
  SELECT auth.uid() IS NULL
      OR public.ponto_ficha_libera_acesso(auth.uid())
      OR public.ponto_pode_administrar();
$$;
REVOKE ALL ON FUNCTION public.ponto_ator_aprovado() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_ator_aprovado() TO authenticated, service_role;

CREATE FUNCTION public.ponto_nome_da_conta(p_usuario_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- O nome de uma conta é o da ficha ligada a ela (ativa ou não: a ficha
  -- desligada continua dando nome ao histórico);
  -- sem ficha, o nome guardado na conta pela função de contas
  -- (raw_app_meta_data->>'full_name', que só a chave de serviço grava);
  -- sem os dois, o e-mail. O raw_user_meta_data NÃO entra: a própria pessoa o
  -- edita pela API do login, e o nome escolhido por ela iria para a lista do
  -- admin e para a fotografia da batida sem passar pela função nem pela
  -- trilha de contas.
  SELECT coalesce(
           (SELECT nullif(btrim(f.nome_completo), '')
              FROM public.ponto_funcionarios f
             WHERE f.usuario_id = p_usuario_id),
           (SELECT nullif(btrim(u.raw_app_meta_data ->> 'full_name'), '')
              FROM auth.users u
             WHERE u.id = p_usuario_id),
           (SELECT u.email::text
              FROM auth.users u
             WHERE u.id = p_usuario_id)
         );
$$;
REVOKE ALL ON FUNCTION public.ponto_nome_da_conta(p_usuario_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_nome_da_conta(p_usuario_id uuid) TO service_role;

CREATE FUNCTION public.ponto_ordem_do_dia(p_usuario uuid, p_dia date)
RETURNS TABLE(registro_id uuid, ordem_atual integer, tipo_atual text, ordem_certa integer, tipo_certo text, muda boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pelo_relogio AS (
    SELECT r.id, r.ordem_no_dia, r.tipo,
           row_number() OVER (ORDER BY r.registrado_em, r.criado_em, r.id)::integer AS n
    FROM public.ponto_registros r
    WHERE r.usuario_id = p_usuario
      AND r.dia_civil = p_dia
  )
  SELECT id, ordem_no_dia, tipo, n,
         -- O mesmo mapeamento do item 5 de ponto_carimbar_registro.
         CASE n WHEN 1 THEN 'entrada'
                WHEN 2 THEN 'saida_almoco'
                WHEN 3 THEN 'volta_almoco'
                WHEN 4 THEN 'saida'
                ELSE        'extra'
         END,
         ordem_no_dia IS DISTINCT FROM n
           OR tipo IS DISTINCT FROM CASE n WHEN 1 THEN 'entrada'
                                           WHEN 2 THEN 'saida_almoco'
                                           WHEN 3 THEN 'volta_almoco'
                                           WHEN 4 THEN 'saida'
                                           ELSE        'extra'
                                    END
  FROM pelo_relogio;
$$;
REVOKE ALL ON FUNCTION public.ponto_ordem_do_dia(p_usuario uuid, p_dia date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_ordem_do_dia(p_usuario uuid, p_dia date) TO service_role;

CREATE FUNCTION public.ponto_pin_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'definido',          EXISTS (SELECT 1 FROM public.ponto_pin WHERE usuario_id = auth.uid()),
    'precisa_redefinir', coalesce((SELECT precisa_redefinir FROM public.ponto_pin WHERE usuario_id = auth.uid()), true),
    'bloqueado_ate',     (SELECT bloqueado_ate FROM public.ponto_pin
                           WHERE usuario_id = auth.uid() AND bloqueado_ate > now())
  );
$$;
REVOKE ALL ON FUNCTION public.ponto_pin_status() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_pin_status() TO authenticated, service_role;

CREATE FUNCTION public.ponto_selfie_sem_batida(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Nenhuma batida aponta para o arquivo.
  SELECT NOT EXISTS (
    SELECT 1 FROM public.ponto_registros WHERE selfie_path = p_name
  )
  -- Nem apontou um dia, antes ou depois de uma correção. Sem isso, zerar
  -- o selfie_path por correção "soltava" a foto para ser apagada.
  AND NOT EXISTS (
    SELECT 1 FROM public.ponto_correcoes c
    WHERE c.valores_antes ->> 'selfie_path' = p_name
       OR c.valores_depois ->> 'selfie_path' = p_name
  )
  -- Nem é a foto de uma batida que o backend apagou com trilha.
  AND NOT EXISTS (
    SELECT 1 FROM public.ponto_registros_apagados a
    WHERE a.linha ->> 'selfie_path' = p_name
  )
  -- Nem é a foto de um pedido de batida em atraso, em qualquer estado.
  -- O pedido recusado também guarda a prova do que foi pedido.
  AND NOT EXISTS (
    SELECT 1 FROM public.ponto_pedidos_atraso p
    WHERE p.selfie_path = p_name
  );
$$;
REVOKE ALL ON FUNCTION public.ponto_selfie_sem_batida(p_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_selfie_sem_batida(p_name text) TO authenticated, service_role;

CREATE FUNCTION public.ponto_contas_trilha_pronta()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT has_column_privilege('service_role', 'public.ponto_contas_trilha', 'autor_id', 'INSERT')
     AND EXISTS (
           SELECT 1 FROM pg_trigger t
           WHERE t.tgrelid = 'public.ponto_contas_trilha'::regclass
             AND t.tgname = 'trg_ponto_contas_trilha_carimbar'
             AND t.tgenabled = 'O'
         );
$$;
REVOKE ALL ON FUNCTION public.ponto_contas_trilha_pronta() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_contas_trilha_pronta() TO service_role;

-- 6. Funções plpgsql (a ordem não importa: o corpo de uma plpgsql só é
--    conferido ao rodar).

CREATE FUNCTION public.ponto_abrir_operacao_do_sistema(p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- O motivo vira o `motivo` da trilha (NOT NULL e não vazio lá também). Melhor
  -- recusar aqui, com mensagem própria, do que no INSERT do gatilho.
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Operacao do sistema exige motivo: ele vira o motivo da trilha de cada batida tocada'
      USING ERRCODE = '22023';
  END IF;

  -- `true` = só até o fim desta transação. Nunca vaza para a próxima.
  PERFORM set_config('ponto.operacao_do_sistema', btrim(p_motivo), true);
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_abrir_operacao_do_sistema(p_motivo text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_abrir_operacao_do_sistema(p_motivo text) TO service_role;

CREATE FUNCTION public.ponto_admins_carimbar_concessao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Com sessão, o autor é a sessão — nunca o que veio no corpo do INSERT.
    IF auth.uid() IS NOT NULL THEN
      NEW.concedido_por := auth.uid();
    END IF;
    NEW.concedido_em := now();
    RETURN NEW;
  END IF;

  -- UPDATE: quem concedeu e quando não se reescrevem.
  NEW.concedido_por := OLD.concedido_por;
  NEW.concedido_em  := OLD.concedido_em;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_admins_carimbar_concessao() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_admins_carimbar_concessao() TO service_role;

CREATE FUNCTION public.ponto_admins_exigir_ao_menos_um()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restantes integer;
BEGIN
  -- TRUNCATE (BEFORE): esvazia sem passar pelo gatilho de linha nem pelo de
  -- DELETE, e o service_role tem o privilégio. Recusa sempre, como na lista de
  -- super admins.
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'A lista de administradores do ponto nao se esvazia.'
      USING ERRCODE = '23514';
  END IF;

  -- DELETE (AFTER STATEMENT): só conta o DELETE que tirou alguém da lista.
  -- Apagar uma conta em auth.users cascateia para esta tabela e dispara este
  -- gatilho de comando mesmo quando a conta não estava aqui; com a lista vazia
  -- (instalação nova, ou o ponto administrado só pelo super admin), recusar
  -- esse DELETE vazio impediria apagar qualquer conta do projeto.
  IF NOT EXISTS (SELECT 1 FROM removidas) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_restantes FROM public.ponto_admins;

  IF v_restantes = 0 THEN
    RAISE EXCEPTION
      'O ponto ficaria sem nenhum administrador: conceda a administracao a outra pessoa antes de remover a ultima.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_admins_exigir_ao_menos_um() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_admins_exigir_ao_menos_um() TO service_role;

CREATE FUNCTION public.ponto_admins_guardar_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restantes integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.usuario_id IS DISTINCT FROM OLD.usuario_id THEN
      RAISE EXCEPTION
        'Uma concessao de administracao do ponto nao pode ser transferida para outra pessoa: conceda a administracao a ela e depois revogue a desta.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_restantes FROM public.ponto_admins;

  IF v_restantes <= 1 THEN
    RAISE EXCEPTION
      'O ponto ficaria sem nenhum administrador: conceda a administracao a outra pessoa antes de remover a ultima.'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_admins_guardar_regras() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_admins_guardar_regras() TO service_role;

CREATE FUNCTION public.ponto_anotar_papel_do_comando()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- current_user, aqui, é quem executou o INSERT, o UPDATE ou o DELETE:
  -- `authenticated` para o app, `postgres` para uma função DEFINER do ponto ou
  -- migration, `service_role` para o backend. Não há tabela lida nem escrita.
  PERFORM set_config('ponto.papel_do_comando', current_user::text, true);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_anotar_papel_do_comando() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_anotar_papel_do_comando() TO service_role;

CREATE FUNCTION public.ponto_ausencias_guardar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- As três colunas que o cancelamento pode mudar. Todo o resto da linha é
  -- imutável depois de lançada, inclusive coluna que uma versão futura acrescentar.
  c_colunas_do_cancelamento constant text[] := ARRAY['cancelada_em', 'cancelada_por', 'motivo_cancelamento'];
  v_ator          uuid := auth.uid();
  v_hoje          date;
  v_extensao      text;
  v_mime          text;
  v_mime_esperado text;
BEGIN
  -- 1. SESSÃO, antes de qualquer papel: as funções de papel do ponto tratam
  --    auth.uid() nulo como backend confiável, e aqui o carimbo precisa de um
  --    autor de verdade.
  IF v_ator IS NULL THEN
    RAISE EXCEPTION 'Ausencia exige sessao de admin do ponto: o autor e carimbado pelo banco'
      USING ERRCODE = '42501';
  END IF;

  -- 2. PAPEL. A policy já filtra o app; isto segura quem chega sem RLS
  --    (service_role com o token de alguém).
  IF NOT public.ponto_pode_administrar() THEN
    RAISE EXCEPTION 'So admin do ponto lanca ou cancela ausencia'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- 3u. Cancelada uma vez, cancelada para sempre.
    IF OLD.cancelada_em IS NOT NULL THEN
      RAISE EXCEPTION 'Ausencia ja cancelada: o cancelamento e definitivo'
        USING ERRCODE = '42501';
    END IF;

    -- 4u. A prova não muda. Compara a linha inteira menos o cancelamento.
    IF (to_jsonb(NEW) - c_colunas_do_cancelamento) IS DISTINCT FROM (to_jsonb(OLD) - c_colunas_do_cancelamento) THEN
      RAISE EXCEPTION 'Ausencia lancada nao muda: so pode ser cancelada, com motivo. Para corrigir, cancele e lance de novo'
        USING ERRCODE = '42501';
    END IF;

    -- 5u. Cancelar exige motivo; autor e momento são do banco.
    IF NEW.motivo_cancelamento IS NULL OR btrim(NEW.motivo_cancelamento) = '' THEN
      RAISE EXCEPTION 'Cancelar ausencia exige motivo'
        USING ERRCODE = '23514';
    END IF;

    NEW.motivo_cancelamento := btrim(NEW.motivo_cancelamento);
    NEW.cancelada_por       := v_ator;
    NEW.cancelada_em        := now();
    RETURN NEW;
  END IF;

  -- ===== INSERT =====

  -- 3. Não nasce cancelada.
  IF NEW.cancelada_em IS NOT NULL OR NEW.cancelada_por IS NOT NULL OR NEW.motivo_cancelamento IS NOT NULL THEN
    RAISE EXCEPTION 'Ausencia nao nasce cancelada: lance primeiro, cancele depois, com motivo'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Carimbo.
  NEW.lancado_por   := v_ator;
  NEW.lancado_em    := now();
  NEW.observacao    := nullif(btrim(NEW.observacao), '');
  NEW.atestado_path := nullif(btrim(NEW.atestado_path), '');

  -- 5. A pessoa existe. Leitura de auth.users, nunca escrita.
  IF NEW.usuario_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.usuario_id) THEN
    RAISE EXCEPTION 'Pessoa nao encontrada: a ausencia precisa ser de uma conta existente'
      USING ERRCODE = '23503';
  END IF;

  -- 6. Tipo e período, com frase própria (os CHECKs da tabela continuam sendo
  --    a garantia; isto só troca a mensagem genérica por uma que a tela traduz).
  IF NEW.tipo IS NULL OR NEW.tipo NOT IN ('atestado_medico', 'falta_justificada', 'outro') THEN
    RAISE EXCEPTION 'Tipo de ausencia invalido: use atestado_medico, falta_justificada ou outro'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.tipo = 'outro' AND NEW.observacao IS NULL THEN
    RAISE EXCEPTION 'Ausencia do tipo outro exige observacao'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.dia_inicio IS NULL OR NEW.dia_fim IS NULL THEN
    RAISE EXCEPTION 'Ausencia exige o dia inicial e o dia final'
      USING ERRCODE = '23502';
  END IF;
  IF NEW.dia_fim < NEW.dia_inicio THEN
    RAISE EXCEPTION 'Periodo invertido: o dia final nao pode ser antes do inicial'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.dia_fim - NEW.dia_inicio > 119 THEN
    RAISE EXCEPTION 'Periodo longo demais: uma ausencia cobre no maximo 120 dias; lance em partes'
      USING ERRCODE = '23514';
  END IF;

  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  IF NEW.dia_inicio < v_hoje - 366 OR NEW.dia_fim > v_hoje + 366 THEN
    RAISE EXCEPTION 'Periodo fora da janela aceita: de um ano atras ate um ano a frente'
      USING ERRCODE = '23514';
  END IF;

  -- 7. Sem duas ausências ativas da mesma pessoa no mesmo dia. A trava por
  --    pessoa vale até o fim da transação: dois lançamentos simultâneos para a
  --    mesma pessoa passam um de cada vez, e o segundo vê o primeiro.
  PERFORM pg_advisory_xact_lock(hashtextextended('ponto_ausencias:' || NEW.usuario_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.ponto_ausencias a
    WHERE a.usuario_id = NEW.usuario_id
      AND a.cancelada_em IS NULL
      AND a.dia_inicio <= NEW.dia_fim
      AND a.dia_fim   >= NEW.dia_inicio
  ) THEN
    RAISE EXCEPTION 'Ja existe ausencia ativa desta pessoa em parte deste periodo: cancele a anterior antes de lancar de novo'
      USING ERRCODE = '23P01';
  END IF;

  -- 8. O atestado: caminho combinado, objeto no bucket, tipo batendo com a
  --    extensão.
  IF NEW.atestado_path IS NOT NULL THEN
    IF NEW.atestado_path !~ ('^' || NEW.usuario_id::text || '/' || NEW.id::text || '\.(jpg|jpeg|png|webp|heic|pdf)$') THEN
      RAISE EXCEPTION 'Caminho do atestado fora da convencao: esperado {usuario_id}/{id-da-ausencia}.{jpg|jpeg|png|webp|heic|pdf}'
        USING ERRCODE = '22023';
    END IF;

    SELECT o.metadata ->> 'mimetype' INTO v_mime
    FROM storage.objects o
    WHERE o.bucket_id = 'ponto-atestados' AND o.name = NEW.atestado_path;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Atestado nao encontrado no bucket: envie o arquivo antes de lancar a ausencia'
        USING ERRCODE = '22023';
    END IF;

    v_extensao := substring(NEW.atestado_path FROM '\.([a-z]+)$');
    v_mime_esperado := CASE v_extensao
                         WHEN 'jpg'  THEN 'image/jpeg'
                         WHEN 'jpeg' THEN 'image/jpeg'
                         WHEN 'png'  THEN 'image/png'
                         WHEN 'webp' THEN 'image/webp'
                         WHEN 'heic' THEN 'image/heic'
                         WHEN 'pdf'  THEN 'application/pdf'
                       END;
    IF v_mime IS DISTINCT FROM v_mime_esperado THEN
      RAISE EXCEPTION 'Atestado com tipo de arquivo (%) diferente da extensao (.%)', coalesce(v_mime, 'desconhecido'), v_extensao
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_ausencias_guardar() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_ausencias_guardar() TO service_role;

CREATE FUNCTION public.ponto_ausencias_nao_se_apagam()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% em ponto_ausencias: ausencia lancada nao se apaga nem se esvazia; cancele com motivo',
    TG_OP
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_ausencias_nao_se_apagam() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_ausencias_nao_se_apagam() TO service_role;

CREATE FUNCTION public.ponto_carimbar_registro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ator       uuid    := auth.uid();
  -- Quem administra é a lista do ponto (ponto_admins e ponto_super_admins).
  -- Sem sessão (`v_ator IS NULL`) é o backend (service_role, migration), que
  -- informa dono e horário explicitamente: vale como quem administra.
  v_admin      boolean := (v_ator IS NULL) OR public.ponto_pode_administrar();
  -- Quem executou o INSERT, anotado por ponto_anotar_papel_do_comando
  -- (SECURITY INVOKER, roda antes deste): `postgres` dentro de uma função
  -- DEFINER do ponto (a RPC da batida, a decisão do pedido de atraso) ou no
  -- SQL do dono do banco; `authenticated` no INSERT direto do app;
  -- `service_role` no do backend. Aqui dentro current_user é sempre o dono da
  -- função e não serve para isso.
  v_papel      text    := coalesce(current_setting('ponto.papel_do_comando', true), '');
  v_anteriores integer;
  -- A janela de duplicidade é dado (ponto_configuracao), não constante.
  v_janela     integer;
  v_local      public.ponto_local%ROWTYPE;
BEGIN
  -- A anotação é desta linha; a próxima linha ganha a dela.
  PERFORM set_config('ponto.papel_do_comando', '', true);

  IF v_papel <> 'postgres' THEN
    -- 1 e 2 NO INSERT DIRETO (o do app, pelo PostgREST, ou o do backend). Ele
    -- é sempre o lançamento de quem administra (a batida esquecida) e nunca
    -- uma batida "do app": essa só nasce pela RPC ponto_registrar_batida, que
    -- confere selfie, PIN e localização e roda como postgres. Sem esta
    -- separação, quem administra mandaria um INSERT sem horário e o banco
    -- gravaria uma batida de agora com origem 'app', sem PIN, com a coordenada
    -- e a selfie que quisesse. Anotação vazia (o gatilho da anotação fora do
    -- lugar) cai aqui também: na dúvida, fecha.
    IF v_papel IN ('authenticated', 'anon') AND v_ator IS NULL THEN
      RAISE EXCEPTION 'Registro de ponto exige sessao de usuario'
        USING ERRCODE = '42501';
    END IF;
    IF v_ator IS NOT NULL AND NOT v_admin THEN
      RAISE EXCEPTION 'Batida lancada direto e exclusiva de quem administra o ponto: quem bate usa a tela de bater, com selfie e PIN'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.usuario_id IS NULL THEN
      RAISE EXCEPTION 'Registro de ponto sem dono: informe usuario_id'
        USING ERRCODE = '23502';
    END IF;
    -- Quem é dono da batida não decide o próprio ponto, como no pedido de
    -- batida em atraso: a batida retroativa de quem administra é lançada por
    -- outra pessoa que administra (ou pelo super admin).
    IF NEW.usuario_id = v_ator THEN
      RAISE EXCEPTION 'Quem e dono da batida nao lanca o proprio ponto: peca a outra pessoa que administra o ponto ou ao super admin'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.registrado_em IS NULL THEN
      RAISE EXCEPTION 'Batida lancada por quem administra exige o horario (registrado_em): a batida de agora, com selfie e PIN, nasce pela tela de bater'
        USING ERRCODE = '23502';
    END IF;
    IF NEW.motivo_ajuste IS NULL OR btrim(NEW.motivo_ajuste) = '' THEN
      RAISE EXCEPTION 'Batida lancada por quem administra exige motivo: ele fica gravado na batida e aparece no espelho da pessoa'
        USING ERRCODE = '23514';
    END IF;
    NEW.origem        := 'ajuste_admin';
    NEW.ajuste_manual := true;
  ELSE
    -- 1. DONO, dentro de uma função DEFINER do ponto (ou no SQL do dono do
    --    banco) — um funcionário comum só grava para si mesmo, mesmo que
    --    tente mandar outro usuario_id. Admin pode gravar para outro (a
    --    aprovação do pedido de atraso). O dono do banco sem sessão
    --    (migration, SQL Editor) informa explicitamente.
    IF v_ator IS NOT NULL AND NOT v_admin THEN
      NEW.usuario_id := v_ator;
    END IF;
    IF NEW.usuario_id IS NULL THEN
      RAISE EXCEPTION 'Registro de ponto sem dono: informe usuario_id'
        USING ERRCODE = '23502';
    END IF;

    -- 2. HORÁRIO — relógio de celular é editável, então ele não vale. A RPC
    --    da batida não manda horário: é aqui que nasce a origem 'app'.
    IF NEW.registrado_em IS NULL OR NOT v_admin THEN
      NEW.registrado_em := now();
      NEW.origem        := 'app';
      NEW.ajuste_manual := false;
      NEW.motivo_ajuste := NULL;
    ELSE
      NEW.origem        := 'ajuste_admin';
      NEW.ajuste_manual := true;
    END IF;
  END IF;
  NEW.criado_por := v_ator;

  -- 3. DIA CIVIL — o dia de quem bateu, não o dia do UTC.
  NEW.dia_civil := (NEW.registrado_em AT TIME ZONE 'America/Sao_Paulo')::date;

  -- 4. DUPLICIDADE — dedo tremido, duplo toque, retry do app.
  --
  --    A janela vem de `ponto_configuracao`, editável pela área de
  --    administração. Numa instalação nova a linha ainda não existe (a
  --    primeira gravação pela tela a cria): `coalesce(..., 60)` usa o mesmo
  --    padrão da coluna. A mensagem carrega o número real porque a tela a lê
  --    para explicar a recusa, e "60 segundos" fixo passaria a mentir no
  --    primeiro ajuste.
  SELECT c.janela_duplicidade_segundos INTO v_janela
  FROM public.ponto_configuracao c
  WHERE c.id = 1;

  v_janela := coalesce(v_janela, 60);

  IF NEW.origem = 'app' AND EXISTS (
       SELECT 1 FROM public.ponto_registros r
       WHERE r.usuario_id = NEW.usuario_id
         AND r.registrado_em >  NEW.registrado_em - make_interval(secs => v_janela)
         AND r.registrado_em <= NEW.registrado_em
     ) THEN
    RAISE EXCEPTION
      'Batida duplicada: ja existe um registro deste funcionario ha menos de % segundos', v_janela
      USING ERRCODE = '23505';
  END IF;

  -- 5. TIPO — sai da ordem do dia, o funcionário não escolhe.
  SELECT count(*) INTO v_anteriores
  FROM public.ponto_registros r
  WHERE r.usuario_id = NEW.usuario_id
    AND r.dia_civil  = NEW.dia_civil;

  NEW.ordem_no_dia := v_anteriores + 1;
  NEW.tipo := CASE v_anteriores
                WHEN 0 THEN 'entrada'
                WHEN 1 THEN 'saida_almoco'
                WHEN 2 THEN 'volta_almoco'
                WHEN 3 THEN 'saida'
                ELSE        'extra'
              END;

  -- 6. DISTÂNCIA E MARCA — calculadas no servidor, arredondadas ao centímetro
  --    antes de gravar e de comparar: a marca dentro/fora sai do mesmo número
  --    que fica gravado e que a tela mostra, e o ruído do ponto flutuante não
  --    decide quem está na borda do raio. Sem local ativo (instalação nova),
  --    distância, marca e local ficam nulos.
  SELECT * INTO v_local
  FROM public.ponto_local
  WHERE ativo
  ORDER BY criado_em
  LIMIT 1;

  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL AND v_local.id IS NOT NULL THEN
    NEW.local_id         := v_local.id;
    NEW.distancia_metros := round(
                              public.ponto_distancia_metros(
                                NEW.latitude, NEW.longitude,
                                v_local.latitude, v_local.longitude
                              )::numeric, 2
                            )::double precision;
    -- <= : ponto exatamente na borda do raio conta como DENTRO.
    NEW.no_local         := (NEW.distancia_metros <= v_local.raio_metros);
  ELSE
    NEW.local_id         := NULL;
    NEW.distancia_metros := NULL;
    NEW.no_local         := NULL;
  END IF;

  -- 7. FOTOGRAFIA DO FUNCIONÁRIO: o nome da ficha ligada à conta; sem ficha,
  --    o nome guardado na conta; sem os dois, o e-mail (ponto_nome_da_conta).
  --    O e-mail é o da conta. Os dois ficam como eram na hora da batida.
  NEW.funcionario_nome  := public.ponto_nome_da_conta(NEW.usuario_id);
  NEW.funcionario_email := (SELECT u.email::text FROM auth.users u WHERE u.id = NEW.usuario_id);

  NEW.criado_em     := now();
  NEW.atualizado_em := now();

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_carimbar_registro() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_carimbar_registro() TO service_role;

CREATE FUNCTION public.ponto_configuracao_normalizar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.razao_social  := nullif(btrim(coalesce(NEW.razao_social,  '')), '');
  NEW.nome_fantasia := nullif(btrim(coalesce(NEW.nome_fantasia, '')), '');
  NEW.endereco      := nullif(btrim(coalesce(NEW.endereco,      '')), '');
  NEW.cidade        := nullif(btrim(coalesce(NEW.cidade,        '')), '');
  NEW.uf            := nullif(upper(btrim(coalesce(NEW.uf,      ''))), '');
  -- `[./ -]`: ponto, barra, espaço e o hífen POR ÚLTIMO, que é como se escreve
  -- um hífen literal dentro de colchetes sem escapar nada. Só a máscara sai —
  -- letra nenhuma é removida, para que "12.345.678/0001-9X" continue sendo
  -- recusado pelo CHECK em vez de virar um CNPJ de 13 dígitos calado.
  NEW.cnpj          := nullif(regexp_replace(coalesce(NEW.cnpj, ''), '[./ -]', '', 'g'), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_configuracao_normalizar() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_configuracao_normalizar() TO service_role;

CREATE FUNCTION public.ponto_contas()
RETURNS TABLE(usuario_id uuid, email text, nome text, criado_em timestamp with time zone, ultimo_login timestamp with time zone)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- A lista de contas que a tela de pessoas, a caixa de vínculo e os nomes de
  -- quem decidiu ou mediu leem: auth.users não é exposto ao app, e esta função
  -- devolve só estas cinco colunas. Sessão antes de papel, e só para quem
  -- administra. O nome é o que a função de contas guardou no app_metadata
  -- (só a chave de serviço grava ali); o user_metadata, que a própria pessoa
  -- edita, não entra.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Lista de contas exige sessao de usuario'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.ponto_pode_administrar() THEN
    RAISE EXCEPTION 'Lista de contas e exclusiva de quem administra o ponto'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id,
           u.email::text,
           u.raw_app_meta_data ->> 'full_name',
           u.created_at,
           u.last_sign_in_at
      FROM auth.users u
     WHERE u.deleted_at IS NULL
     ORDER BY lower(u.email::text), u.id;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_contas() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_contas() TO authenticated, service_role;

CREATE FUNCTION public.ponto_contas_trilha_carimbar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sessão de usuário, de qualquer jeito que ela chegue (auth.uid(), ou o
  -- papel da sessão — este pega o token sem `sub`), nunca escreve aqui.
  IF auth.uid() IS NOT NULL
     OR coalesce(current_setting('role', true), '') IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'A trilha de contas so e escrita pela Edge Function ponto-contas (chave de servico), nunca por sessao de usuario'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.autor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.ponto_super_admins s WHERE s.usuario_id = NEW.autor_id) THEN
    RAISE EXCEPTION 'Autor da trilha de contas precisa ser super admin do ponto'
      USING ERRCODE = '23514';
  END IF;

  NEW.id       := gen_random_uuid();
  NEW.feito_em := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_contas_trilha_carimbar() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_contas_trilha_carimbar() TO service_role;

CREATE FUNCTION public.ponto_decidir_pedido_atraso(p_pedido_id uuid, p_aprovar boolean, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ator     uuid := auth.uid();
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_pedido   public.ponto_pedidos_atraso%ROWTYPE;
  v_registro public.ponto_registros%ROWTYPE;
BEGIN
  -- 1. SESSÃO antes de papel.
  IF v_ator IS NULL THEN
    RAISE EXCEPTION 'Decisao de pedido de batida em atraso exige sessao de usuario'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Só quem administra o ponto.
  IF NOT public.ponto_pode_administrar() THEN
    RAISE EXCEPTION 'Decidir pedido de batida em atraso e exclusivo de quem administra o ponto'
      USING ERRCODE = '42501';
  END IF;

  IF p_pedido_id IS NULL OR p_aprovar IS NULL THEN
    RAISE EXCEPTION 'Decisao exige o pedido e se ele e aprovado ou recusado'
      USING ERRCODE = '22023';
  END IF;

  -- 3. O pedido, travado: duas decisões ao mesmo tempo não passam.
  SELECT * INTO v_pedido
  FROM public.ponto_pedidos_atraso
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de batida em atraso nao encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_pedido.usuario_id = v_ator THEN
    RAISE EXCEPTION 'Quem pediu a batida em atraso nao decide o proprio pedido: peca a outra pessoa que administra o ponto'
      USING ERRCODE = '42501';
  END IF;

  IF v_pedido.estado <> 'pendente' THEN
    RAISE EXCEPTION 'Pedido de batida em atraso ja decidido: esta %', v_pedido.estado
      USING ERRCODE = '55000';
  END IF;

  -- 4. RECUSA.
  IF NOT p_aprovar THEN
    IF v_motivo IS NULL THEN
      RAISE EXCEPTION 'Recusar pedido de batida em atraso exige motivo'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.ponto_pedidos_atraso
       SET estado = 'recusado', decidido_por = v_ator, decidido_em = now(), motivo_decisao = v_motivo
     WHERE id = v_pedido.id
    RETURNING * INTO v_pedido;

    RETURN jsonb_build_object(
      'decidido', true,
      'estado',   v_pedido.estado,
      'pedido',   jsonb_build_object(
        'id', v_pedido.id, 'usuario_id', v_pedido.usuario_id,
        'horario_declarado', v_pedido.horario_declarado, 'dia_civil', v_pedido.dia_civil,
        'estado', v_pedido.estado, 'decidido_por', v_pedido.decidido_por,
        'decidido_em', v_pedido.decidido_em, 'motivo_decisao', v_pedido.motivo_decisao
      )
    );
  END IF;

  -- 5. APROVAÇÃO. Sem a prova, não nasce batida.
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'ponto-selfies' AND o.name = v_pedido.selfie_path
  ) THEN
    RAISE EXCEPTION 'Selfie do pedido nao esta mais no bucket: sem a prova, a batida em atraso nao e criada. Recuse o pedido com motivo'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ponto_registros r
    WHERE r.usuario_id = v_pedido.usuario_id
      AND r.registrado_em >= v_pedido.horario_declarado
      AND r.registrado_em <  v_pedido.horario_declarado + interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'Ja existe batida desta pessoa no mesmo minuto do pedido: a aprovacao duplicaria a batida. Recuse o pedido com motivo'
      USING ERRCODE = '23505';
  END IF;

  -- 5a. O pedido fica aprovado ANTES de a batida nascer: é o que o gatilho da
  --     ligação (ponto_vinculo_do_pedido_atraso) confere. Se qualquer coisa
  --     abaixo falhar, tudo volta, e o gatilho de fim de transação não deixa
  --     aprovado sem batida.
  UPDATE public.ponto_pedidos_atraso
     SET estado = 'aprovado', decidido_por = v_ator, decidido_em = now(), motivo_decisao = v_motivo
   WHERE id = v_pedido.id
  RETURNING * INTO v_pedido;

  -- 5b. A batida, como inserção do admin: o carimbo mantém o horário
  --     declarado, grava origem 'ajuste_admin', liga ajuste_manual, calcula
  --     distância e marca contra o local ativo e tira a fotografia do nome.
  INSERT INTO public.ponto_registros
    (id, usuario_id, registrado_em, latitude, longitude, precisao_metros,
     selfie_path, motivo_ajuste, pedido_atraso_id)
  VALUES
    (gen_random_uuid(), v_pedido.usuario_id, v_pedido.horario_declarado,
     v_pedido.latitude, v_pedido.longitude, v_pedido.precisao_metros,
     v_pedido.selfie_path, 'Batida em atraso aprovada: ' || v_pedido.motivo, v_pedido.id)
  RETURNING * INTO v_registro;

  UPDATE public.ponto_pedidos_atraso
     SET registro_id = v_registro.id
   WHERE id = v_pedido.id
  RETURNING * INTO v_pedido;

  -- 5c. O gatilho AFTER INSERT já reordenou se a batida não era a última; a
  --     chamada explícita cobre o resto (e não escreve nada se o dia já está
  --     na ordem).
  PERFORM public.ponto_reordenar_dia(v_registro.usuario_id, v_registro.dia_civil);

  SELECT * INTO v_registro FROM public.ponto_registros WHERE id = v_registro.id;

  RETURN jsonb_build_object(
    'decidido', true,
    'estado',   v_pedido.estado,
    'pedido',   jsonb_build_object(
      'id', v_pedido.id, 'usuario_id', v_pedido.usuario_id,
      'horario_declarado', v_pedido.horario_declarado, 'dia_civil', v_pedido.dia_civil,
      'estado', v_pedido.estado, 'decidido_por', v_pedido.decidido_por,
      'decidido_em', v_pedido.decidido_em, 'motivo_decisao', v_pedido.motivo_decisao,
      'registro_id', v_pedido.registro_id
    ),
    'registro', jsonb_build_object(
      'id',               v_registro.id,
      'registrado_em',    v_registro.registrado_em,
      'dia_civil',        v_registro.dia_civil,
      'tipo',             v_registro.tipo,
      'ordem_no_dia',     v_registro.ordem_no_dia,
      'distancia_metros', v_registro.distancia_metros,
      'no_local',         v_registro.no_local,
      'origem',           v_registro.origem,
      'ajuste_manual',    v_registro.ajuste_manual,
      'pedido_atraso_id', v_registro.pedido_atraso_id
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_decidir_pedido_atraso(p_pedido_id uuid, p_aprovar boolean, p_motivo text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_decidir_pedido_atraso(p_pedido_id uuid, p_aprovar boolean, p_motivo text) TO authenticated, service_role;

CREATE FUNCTION public.ponto_definir_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ator  uuid := auth.uid();
  v_atual public.ponto_pin%ROWTYPE;
BEGIN
  IF v_ator IS NULL THEN
    RAISE EXCEPTION 'Definicao de PIN exige sessao de usuario'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.ponto_ator_aprovado() THEN
    RAISE EXCEPTION 'Conta sem acesso ao ponto: peca liberacao a quem cuida do ponto'
      USING ERRCODE = '42501';
  END IF;

  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN invalido: informe exatamente 4 digitos'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.ponto_pin WHERE usuario_id = v_ator;

  IF FOUND AND NOT v_atual.precisa_redefinir THEN
    RAISE EXCEPTION 'PIN ja definido: peca ao administrador para resetar antes de definir outro'
      USING ERRCODE = '42501';
  END IF;

  -- PIN novo, castigo do zero: a conta dos bloqueios do dia também recomeça.
  INSERT INTO public.ponto_pin (usuario_id, pin_hash)
  VALUES (v_ator, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  ON CONFLICT (usuario_id) DO UPDATE
    SET pin_hash           = EXCLUDED.pin_hash,
        atualizado_em      = now(),
        precisa_redefinir  = false,
        tentativas_falhas  = 0,
        bloqueado_ate      = NULL,
        bloqueios_no_dia   = 0,
        ultimo_bloqueio_em = NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_definir_pin(p_pin text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_definir_pin(p_pin text) TO authenticated, service_role;

CREATE FUNCTION public.ponto_estado_do_pin()
RETURNS TABLE(usuario_id uuid, tem_pin boolean, precisa_redefinir boolean, bloqueado_ate timestamp with time zone)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Consulta do estado do PIN exige sessao de usuario'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.ponto_pode_administrar() THEN
    RAISE EXCEPTION 'Consulta do estado do PIN e exclusiva de quem administra o ponto'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.usuario_id,
         p.pin_hash IS NOT NULL AS tem_pin,
         p.precisa_redefinir,
         p.bloqueado_ate
    FROM public.ponto_pin p;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_estado_do_pin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_estado_do_pin() TO authenticated, service_role;

CREATE FUNCTION public.ponto_fechar_operacao_do_sistema()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('ponto.operacao_do_sistema', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_fechar_operacao_do_sistema() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_fechar_operacao_do_sistema() TO service_role;

CREATE FUNCTION public.ponto_funcionarios_acesso_pelo_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje           date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_libera_depois  boolean;
  v_liberava_antes boolean := false;
BEGIN
  -- A MESMA regra de ponto_ficha_libera_acesso, aplicada à linha que está
  -- sendo gravada (a função lê a tabela, e a linha nova ainda não está lá).
  v_libera_depois := NEW.usuario_id IS NOT NULL
                     AND NEW.ativo
                     AND (NEW.desligamento IS NULL OR NEW.desligamento >= v_hoje);

  IF NOT v_libera_depois THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_liberava_antes := OLD.usuario_id IS NOT DISTINCT FROM NEW.usuario_id
                        AND OLD.ativo
                        AND (OLD.desligamento IS NULL OR OLD.desligamento >= v_hoje);
  END IF;

  -- Já liberava a mesma conta: é edição de cadastro, não liberação.
  IF v_liberava_antes THEN
    RETURN NEW;
  END IF;

  -- Sem sessão: migration ou backend. As policies da ficha exigem sessão, então
  -- o app nunca chega aqui sem ela.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.ponto_sou_super_admin() THEN
    RAISE EXCEPTION 'Liberar acesso ao ponto pela ficha e exclusivo do super admin: ligar a ficha a uma conta, reativa-la ou tirar o desligamento da acesso ao ponto a essa conta.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_funcionarios_acesso_pelo_super_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_funcionarios_acesso_pelo_super_admin() TO service_role;

CREATE FUNCTION public.ponto_funcionarios_normalizar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.nome_completo := btrim(coalesce(NEW.nome_completo, ''));
  NEW.matricula     := nullif(btrim(coalesce(NEW.matricula,    '')), '');
  NEW.cargo         := nullif(btrim(coalesce(NEW.cargo,        '')), '');
  NEW.ctps          := nullif(btrim(coalesce(NEW.ctps,         '')), '');
  NEW.ctps_serie    := nullif(btrim(coalesce(NEW.ctps_serie,   '')), '');
  NEW.centro_custo  := nullif(btrim(coalesce(NEW.centro_custo, '')), '');
  -- `[./ -]`: ponto, barra, espaço e o hífen POR ÚLTIMO, que é como se escreve
  -- um hífen literal dentro de colchetes sem escapar nada. Letra nenhuma é
  -- removida, para que "529.982.247-2X" continue sendo recusado pelo CHECK em
  -- vez de virar um CPF de dez dígitos calado.
  NEW.cpf           := nullif(regexp_replace(coalesce(NEW.cpf, ''), '[./ -]', '', 'g'), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_funcionarios_normalizar() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_funcionarios_normalizar() TO service_role;

CREATE FUNCTION public.ponto_guardar_apagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Anotado por ponto_anotar_papel_do_comando, que roda antes deste.
  v_papel           text := coalesce(current_setting('ponto.papel_do_comando', true), '');
  -- O `role` da sessão: `authenticated` em qualquer coisa chamada pelo app,
  -- mesmo dentro de função DEFINER.
  v_papel_da_sessao text := coalesce(current_setting('role', true), '');
  v_motivo          text := nullif(btrim(coalesce(current_setting('ponto.operacao_do_sistema', true), '')), '');
BEGIN
  -- A anotação é desta linha; a próxima linha ganha a dela.
  PERFORM set_config('ponto.papel_do_comando', '', true);

  -- 1. SESSÃO DE USUÁRIO, DE QUALQUER JEITO QUE ELA CHEGUE. Anotação vazia
  --    também é recusa: na dúvida, fecha.
  IF auth.uid() IS NOT NULL
     OR v_papel = ''
     OR v_papel IN ('authenticated', 'anon')
     OR v_papel_da_sessao IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Batida de ponto nao se apaga por sessao de usuario: corrija o horario com motivo, a trilha guarda o original'
      USING ERRCODE = '42501';
  END IF;

  -- 2. O BACKEND PRECISA DIZER POR QUÊ.
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Apagar batida exige o canal do sistema aberto com motivo (ponto_abrir_operacao_do_sistema)'
      USING ERRCODE = '42501';
  END IF;

  -- 3. BATIDA COM TRILHA NÃO SAI. A trilha aponta para ela, e a trilha é
  --    permanente.
  IF EXISTS (SELECT 1 FROM public.ponto_correcoes c WHERE c.registro_id = OLD.id) THEN
    RAISE EXCEPTION 'Batida com trilha de correcao nao se apaga: a trilha aponta para ela e e permanente'
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.ponto_registros_apagados (registro_id, usuario_id, motivo, papel, linha)
  VALUES (OLD.id, OLD.usuario_id, v_motivo, v_papel, to_jsonb(OLD));

  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_guardar_apagamento() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_guardar_apagamento() TO service_role;

CREATE FUNCTION public.ponto_guardar_correcao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campos         text[] := '{}';
  -- Quem executou o UPDATE, anotado por ponto_anotar_papel_do_comando
  -- (SECURITY INVOKER, roda antes deste). Aqui dentro current_user é sempre o
  -- dono da função e não serve para isso.
  v_papel          text := coalesce(current_setting('ponto.papel_do_comando', true), '');
  v_motivo_sistema text := nullif(btrim(coalesce(current_setting('ponto.operacao_do_sistema', true), '')), '');
  v_sistema        boolean;
  v_fora           text[];
  v_local          public.ponto_local%ROWTYPE;
BEGIN
  -- A anotação é desta linha; a próxima linha ganha a dela.
  PERFORM set_config('ponto.papel_do_comando', '', true);

  -- Canal do sistema = motivo no canal E comando que não veio de
  -- sessão de usuário. Anotação vazia não é sistema: na dúvida, admin.
  v_sistema := v_motivo_sistema IS NOT NULL
               AND v_papel <> ''
               AND v_papel NOT IN ('authenticated', 'anon');

  -- Colunas de identidade e de origem não se corrigem. A origem diz como a
  -- batida nasceu (pela RPC, com selfie e PIN, ou lançada por quem
  -- administra), e isso é fato, não dado editável: trocá-la faria uma batida
  -- lançada à mão passar por batida do app. Reposta em silêncio, porque um
  -- UPDATE de painel manda a linha inteira de volta.
  NEW.id         := OLD.id;
  NEW.usuario_id := OLD.usuario_id;
  NEW.criado_por := OLD.criado_por;
  NEW.criado_em  := OLD.criado_em;
  NEW.origem     := OLD.origem;

  -- A marca de ajuste não se desliga. Reposta em silêncio, como a
  -- identidade, porque um UPDATE de painel manda a linha inteira de volta.
  IF OLD.ajuste_manual THEN
    NEW.ajuste_manual := true;
  END IF;

  IF v_sistema THEN
    -- Operação do sistema não é ajuste do admin: a marca e o motivo que o
    -- funcionário vê no espelho ficam como estavam.
    NEW.ajuste_manual := OLD.ajuste_manual;
    NEW.motivo_ajuste := OLD.motivo_ajuste;
  ELSE
    IF NEW.registrado_em IS DISTINCT FROM OLD.registrado_em THEN
      -- Mudou o horário, muda o dia a que a batida pertence.
      NEW.dia_civil := (NEW.registrado_em AT TIME ZONE 'America/Sao_Paulo')::date;
    END IF;

    -- Mudou a coordenada, refaz distância, marca e local contra o
    -- local ATIVO — a mesma conta do item 6 de ponto_carimbar_registro.
    IF NEW.latitude IS DISTINCT FROM OLD.latitude
       OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN
      SELECT * INTO v_local
      FROM public.ponto_local
      WHERE ativo
      ORDER BY criado_em
      LIMIT 1;

      IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL AND v_local.id IS NOT NULL THEN
        NEW.local_id         := v_local.id;
        NEW.distancia_metros := round(
                                  public.ponto_distancia_metros(
                                    NEW.latitude, NEW.longitude,
                                    v_local.latitude, v_local.longitude
                                  )::numeric, 2
                                )::double precision;
        -- <= : ponto exatamente na borda do raio conta como DENTRO.
        NEW.no_local         := (NEW.distancia_metros <= v_local.raio_metros);
      ELSE
        NEW.local_id         := NULL;
        NEW.distancia_metros := NULL;
        NEW.no_local         := NULL;
      END IF;
    END IF;
  END IF;

  -- Os quatro campos que a tela corrige: horário, tipo, coordenada e selfie.
  IF NEW.registrado_em IS DISTINCT FROM OLD.registrado_em THEN
    v_campos := array_append(v_campos, 'registrado_em');
  END IF;
  IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    v_campos := array_append(v_campos, 'tipo');
  END IF;
  IF NEW.latitude IS DISTINCT FROM OLD.latitude
     OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN
    v_campos := array_append(v_campos, 'coordenada');
  END IF;
  IF NEW.selfie_path IS DISTINCT FROM OLD.selfie_path THEN
    v_campos := array_append(v_campos, 'selfie_path');
  END IF;
  -- E os que mudam por consequência (dia, ordem, precisão, distância, marca,
  -- local) ou que nunca deveriam mudar (o nome e o e-mail fotografados):
  -- nenhuma mudança passa sem trilha. A origem não está aqui porque não muda
  -- (acima).
  IF NEW.dia_civil IS DISTINCT FROM OLD.dia_civil THEN
    v_campos := array_append(v_campos, 'dia_civil');
  END IF;
  IF NEW.ordem_no_dia IS DISTINCT FROM OLD.ordem_no_dia THEN
    v_campos := array_append(v_campos, 'ordem_no_dia');
  END IF;
  IF NEW.precisao_metros IS DISTINCT FROM OLD.precisao_metros THEN
    v_campos := array_append(v_campos, 'precisao_metros');
  END IF;
  IF NEW.distancia_metros IS DISTINCT FROM OLD.distancia_metros THEN
    v_campos := array_append(v_campos, 'distancia_metros');
  END IF;
  IF NEW.no_local IS DISTINCT FROM OLD.no_local THEN
    v_campos := array_append(v_campos, 'no_local');
  END IF;
  IF NEW.local_id IS DISTINCT FROM OLD.local_id THEN
    v_campos := array_append(v_campos, 'local_id');
  END IF;
  IF NEW.funcionario_nome IS DISTINCT FROM OLD.funcionario_nome THEN
    v_campos := array_append(v_campos, 'funcionario_nome');
  END IF;
  IF NEW.funcionario_email IS DISTINCT FROM OLD.funcionario_email THEN
    v_campos := array_append(v_campos, 'funcionario_email');
  END IF;

  NEW.atualizado_em := now();

  -- Nada relevante mudou (por exemplo, só o texto do motivo): segue sem trilha.
  IF cardinality(v_campos) = 0 THEN
    RETURN NEW;
  END IF;

  -- O caminho do sistema.
  IF v_sistema THEN
    v_fora := ARRAY(
      SELECT c FROM unnest(v_campos) AS c
      WHERE c <> ALL (ARRAY['tipo', 'ordem_no_dia', 'distancia_metros', 'no_local', 'local_id'])
    );
    IF cardinality(v_fora) > 0 THEN
      RAISE EXCEPTION 'Operacao do sistema nao mexe em %: isso e correcao de admin, com motivo',
        array_to_string(v_fora, ', ')
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.ponto_correcoes
      (registro_id, usuario_id, motivo, campos, valores_antes, valores_depois, autor_id, natureza)
    VALUES
      (OLD.id, OLD.usuario_id, v_motivo_sistema, v_campos,
       to_jsonb(OLD), to_jsonb(NEW), auth.uid(), 'sistema');

    RETURN NEW;
  END IF;

  -- O caminho do admin.

  -- Quem é dono da batida não corrige o próprio ponto, nem o super admin: o
  -- horário de quem administra é corrigido por outra pessoa que administra.
  -- Vale só para a correção com sessão (o caminho do sistema, acima, não é
  -- decisão de ninguém: a reordenação do dia roda até na sessão do dono).
  IF auth.uid() IS NOT NULL AND OLD.usuario_id = auth.uid() THEN
    RAISE EXCEPTION 'Quem e dono da batida nao corrige o proprio ponto: peca a outra pessoa que administra o ponto ou ao super admin'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.motivo_ajuste IS NULL OR btrim(NEW.motivo_ajuste) = '' THEN
    RAISE EXCEPTION 'Correcao de ponto exige motivo'
      USING ERRCODE = '23514';
  END IF;

  -- O motivo tem de ser DESTA correção, não o que já estava na
  -- linha. A mensagem começa por "Motivo repetido" e NÃO contém a frase
  -- 'Correcao de ponto exige motivo': `admin.ts` casa aquela por substring.
  IF NEW.motivo_ajuste IS NOT DISTINCT FROM OLD.motivo_ajuste THEN
    RAISE EXCEPTION 'Motivo repetido: cada correcao precisa do proprio motivo, e este e igual ao que ja estava gravado'
      USING ERRCODE = '23514';
  END IF;

  NEW.ajuste_manual := true;

  INSERT INTO public.ponto_correcoes
    (registro_id, usuario_id, motivo, campos, valores_antes, valores_depois, autor_id, natureza)
  VALUES
    (OLD.id, OLD.usuario_id, btrim(NEW.motivo_ajuste), v_campos,
     to_jsonb(OLD), to_jsonb(NEW), auth.uid(), 'admin');

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_guardar_correcao() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_guardar_correcao() TO service_role;

CREATE FUNCTION public.ponto_local_carimbar_medicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Local novo é local medido agora, por quem está gravando.
    NEW.medido_por := auth.uid();
    NEW.medido_em  := now();
    RETURN NEW;
  END IF;

  IF NEW.latitude    IS DISTINCT FROM OLD.latitude
     OR NEW.longitude   IS DISTINCT FROM OLD.longitude
     OR NEW.raio_metros IS DISTINCT FROM OLD.raio_metros THEN
    NEW.medido_por := auth.uid();
    NEW.medido_em  := now();
  ELSE
    -- Só o nome (ou nada) mudou: a medição continua a de antes, venha o que
    -- vier do cliente nessas duas colunas.
    NEW.medido_por := OLD.medido_por;
    NEW.medido_em  := OLD.medido_em;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_local_carimbar_medicao() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_local_carimbar_medicao() TO service_role;

CREATE FUNCTION public.ponto_local_em_uso_nao_sai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ponto_registros r WHERE r.local_id = OLD.id) THEN
    RAISE EXCEPTION 'Local com batidas nao se apaga: as batidas perderiam a referencia da distancia. Edite a coordenada ou cadastre outro local.'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_local_em_uso_nao_sai() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_local_em_uso_nao_sai() TO service_role;

CREATE FUNCTION public.ponto_meu_acesso()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_ficha boolean;
  v_adm   boolean;
  v_super boolean;
  v_cargo text;
BEGIN
  -- Sessão antes de tudo: aqui, sem sessão, a resposta é "não", e não o
  -- "backend confiável" de ponto_ator_aprovado.
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'tem_acesso',  false,
      'origem',      NULL,
      'administra',  false,
      'super_admin', false,
      'bate_ponto',  false,
      'nome',        NULL,
      'cargo',       NULL
    );
  END IF;

  -- Entrar: ficha que libera OU quem administra
  -- (o super admin administra). Bater: ficha que libera OU super admin.
  v_ficha := coalesce(public.ponto_ficha_libera_acesso(v_uid), false);
  v_adm   := coalesce(public.ponto_pode_administrar(), false);
  v_super := coalesce(public.ponto_sou_super_admin(), false);

  -- O cargo da ficha ligada à conta (no máximo uma, ponto_funcionarios_conta_unica).
  SELECT f.cargo INTO v_cargo FROM public.ponto_funcionarios f WHERE f.usuario_id = v_uid;

  RETURN jsonb_build_object(
    'tem_acesso',  v_ficha OR v_adm,
    'origem',      CASE WHEN v_ficha THEN 'ficha'
                        WHEN v_adm   THEN 'administracao'
                        ELSE              NULL END,
    'administra',  v_adm,
    'super_admin', v_super,
    'bate_ponto',  v_ficha OR v_super,
    'nome',        public.ponto_nome_da_conta(v_uid),
    'cargo',       v_cargo
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_meu_acesso() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_meu_acesso() TO authenticated, service_role;

CREATE FUNCTION public.ponto_motivo_e_marca_so_com_correcao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A linha nova sem o que este gatilho guarda (motivo e marca) e sem o
  -- carimbo de atualização, que a trilha refaz a todo UPDATE.
  v_resto public.ponto_registros%ROWTYPE;
BEGIN
  v_resto := NEW;
  v_resto.motivo_ajuste := OLD.motivo_ajuste;
  v_resto.ajuste_manual := OLD.ajuste_manual;
  v_resto.atualizado_em := OLD.atualizado_em;

  -- Mudou um campo da batida: é correção, e a trilha (que roda antes deste
  -- gatilho) já gravou a linha com o motivo, ou já recusou.
  IF v_resto IS DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  -- Nada da batida mudou: o motivo e a marca não andam sozinhos.
  IF NEW.motivo_ajuste IS DISTINCT FROM OLD.motivo_ajuste THEN
    RAISE EXCEPTION 'Motivo da batida so muda junto com a correcao de um campo dela (horario, tipo, coordenada ou selfie): sozinho, ele trocaria a justificativa sem deixar trilha'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.ajuste_manual AND NOT OLD.ajuste_manual THEN
    RAISE EXCEPTION 'Marca de ajuste so liga junto com a correcao de um campo da batida: sozinha, ela diria ajustada sem correcao nenhuma na trilha'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_motivo_e_marca_so_com_correcao() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_motivo_e_marca_so_com_correcao() TO service_role;

CREATE FUNCTION public.ponto_pedido_atraso_aprovado_tem_batida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ponto_pedidos_atraso p
    WHERE p.id = NEW.id AND p.estado = 'aprovado' AND p.registro_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pedido de batida em atraso aprovado sem batida: a aprovacao volta atras inteira'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_pedido_atraso_aprovado_tem_batida() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_pedido_atraso_aprovado_tem_batida() TO service_role;

CREATE FUNCTION public.ponto_pedido_atraso_guardar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '% em ponto_pedidos_atraso: pedido de batida em atraso nao se apaga; recuse com motivo',
      TG_OP
      USING ERRCODE = '42501';
  END IF;

  -- UPDATE. O que o colaborador declarou e o que o servidor mediu no pedido
  -- são a prova; não se corrigem.
  IF NEW.id                IS DISTINCT FROM OLD.id
     OR NEW.usuario_id        IS DISTINCT FROM OLD.usuario_id
     OR NEW.horario_declarado IS DISTINCT FROM OLD.horario_declarado
     OR NEW.dia_civil         IS DISTINCT FROM OLD.dia_civil
     OR NEW.motivo            IS DISTINCT FROM OLD.motivo
     OR NEW.pedido_em         IS DISTINCT FROM OLD.pedido_em
     OR NEW.selfie_path       IS DISTINCT FROM OLD.selfie_path
     OR NEW.latitude          IS DISTINCT FROM OLD.latitude
     OR NEW.longitude         IS DISTINCT FROM OLD.longitude
     OR NEW.precisao_metros   IS DISTINCT FROM OLD.precisao_metros
     OR NEW.distancia_metros  IS DISTINCT FROM OLD.distancia_metros
     OR NEW.no_local          IS DISTINCT FROM OLD.no_local
     OR NEW.local_id          IS DISTINCT FROM OLD.local_id
     OR NEW.funcionario_nome  IS DISTINCT FROM OLD.funcionario_nome
     OR NEW.funcionario_email IS DISTINCT FROM OLD.funcionario_email THEN
    RAISE EXCEPTION 'Pedido de batida em atraso nao se corrige: horario, motivo, selfie e local sao a prova do pedido'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.estado = 'pendente' THEN
    -- Pendente só sai para uma decisão (as CHECKs exigem autor, momento e, na
    -- recusa, motivo). Continuar pendente sem mudar nada é inofensivo.
    IF NEW.estado = 'pendente' AND NEW.registro_id IS NOT NULL THEN
      RAISE EXCEPTION 'Pedido pendente nao tem batida'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Já decidido: a decisão não volta nem muda. Só a batida da aprovação pode
  -- nascer, uma vez.
  IF NEW.estado         IS DISTINCT FROM OLD.estado
     OR NEW.decidido_por   IS DISTINCT FROM OLD.decidido_por
     OR NEW.decidido_em    IS DISTINCT FROM OLD.decidido_em
     OR NEW.motivo_decisao IS DISTINCT FROM OLD.motivo_decisao
     OR (OLD.registro_id IS NOT NULL AND NEW.registro_id IS DISTINCT FROM OLD.registro_id) THEN
    RAISE EXCEPTION 'Pedido de batida em atraso ja decidido (%): a decisao nao se desfaz', OLD.estado
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_pedido_atraso_guardar() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_pedido_atraso_guardar() TO service_role;

CREATE FUNCTION public.ponto_pedir_batida_em_atraso(p_pin text, p_pedido_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision, p_horario_declarado timestamp with time zone, p_motivo text, p_sem_localizacao text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A mesma folga da batida (ponto_registrar_batida).
  c_idade_maxima   constant interval := interval '15 minutes';
  c_motivo_minimo  constant integer  := 10;
  c_motivo_maximo  constant integer  := 500;
  -- Pedidos pendentes de hoje por pessoa: um dia de quatro batidas esquecidas
  -- cabe; uma fila sem fim de pedidos (cada um com a sua selfie) não.
  c_pendentes_no_dia constant integer := 4;

  v_ator      uuid := auth.uid();
  v_pendentes integer;
  v_padrao    text;
  v_criada_em timestamptz;
  v_horario   timestamptz;
  v_motivo    text;
  v_pin       jsonb;
  v_local     public.ponto_local%ROWTYPE;
  v_nome      text;
  v_email     text;
  v_distancia double precision;
  -- Sem localização, a precisão que o aparelho mandou não vale nada: nula.
  v_precisao  double precision := CASE WHEN p_latitude IS NULL THEN NULL ELSE p_precisao_metros END;
  v_pedido    public.ponto_pedidos_atraso%ROWTYPE;
BEGIN
  -- -------------------------------------------------------------------------
  -- Tudo que pode levantar exceção vem ANTES da verificação do PIN, como na
  -- batida: depois dela há escrita na transação (a tentativa de PIN) que um
  -- RAISE tardio desfaria.
  -- -------------------------------------------------------------------------

  -- 1. SESSÃO, antes de qualquer checagem de papel (ponto_ator_aprovado trata
  --    auth.uid() nulo como backend confiável).
  IF v_ator IS NULL THEN
    RAISE EXCEPTION 'Pedido de batida em atraso exige sessao de usuario'
      USING ERRCODE = '42501';
  END IF;

  -- 2. QUEM PEDE: ficha que libera acesso OU super admin (ponto_pode_bater).
  --    Quem só administra entra no app, mas não bate nem pede. A frase começa
  --    como a da batida, que o app já traduz.
  IF NOT public.ponto_pode_bater() THEN
    RAISE EXCEPTION 'Conta sem acesso para bater ponto: so quem tem ficha ativa no ponto bate ponto e pede batida em atraso; peca liberacao a quem cuida do ponto'
      USING ERRCODE = '42501';
  END IF;

  -- 3. COORDENADA, como na batida (ponto_registrar_batida, item 3): sem as
  --    duas, só quando o GPS do aparelho não respondeu (p_sem_localizacao
  --    'indisponivel' ou 'demora'), e o pedido nasce sem localização. Meia
  --    coordenada nunca.
  IF p_latitude IS NULL AND p_longitude IS NULL THEN
    IF coalesce(p_sem_localizacao, '') NOT IN ('indisponivel', 'demora') THEN
      RAISE EXCEPTION 'Pedido de batida em atraso exige latitude e longitude'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Pedido de batida em atraso exige latitude e longitude'
      USING ERRCODE = '22023';
  ELSIF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Coordenada fora do intervalo valido'
      USING ERRCODE = '22023';
  END IF;
  IF v_precisao IS NOT NULL AND v_precisao < 0 THEN
    RAISE EXCEPTION 'Precisao informada nao pode ser negativa'
      USING ERRCODE = '22023';
  END IF;

  -- 4. SELFIE, com a convenção e a idade da batida. O id do pedido dá nome à
  --    foto, como o id da batida.
  IF p_pedido_id IS NULL THEN
    RAISE EXCEPTION 'Pedido exige o identificador do pedido'
      USING ERRCODE = '22023';
  END IF;

  v_padrao := '^' || v_ator::text || '/[0-9]{4}/[0-9]{2}/' || p_pedido_id::text || '\.jpg$';

  IF p_selfie_path IS NULL OR p_selfie_path !~ v_padrao THEN
    RAISE EXCEPTION 'Caminho de selfie fora da convencao: esperado {user_id}/{aaaa}/{mm}/{id-do-pedido}.jpg'
      USING ERRCODE = '22023';
  END IF;

  -- Um id que já é de batida faria a foto de uma batida virar a de um pedido.
  IF EXISTS (SELECT 1 FROM public.ponto_registros r WHERE r.id = p_pedido_id) THEN
    RAISE EXCEPTION 'Identificador do pedido ja usado por uma batida: gere outro'
      USING ERRCODE = '22023';
  END IF;

  SELECT o.created_at INTO v_criada_em
  FROM storage.objects o
  WHERE o.bucket_id = 'ponto-selfies' AND o.name = p_selfie_path;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selfie nao encontrada no bucket: envie a foto antes de gravar o pedido'
      USING ERRCODE = '22023';
  END IF;

  IF v_criada_em IS NULL OR v_criada_em < now() - c_idade_maxima THEN
    RAISE EXCEPTION 'Selfie fora do prazo: a foto precisa ter sido enviada nos ultimos % minutos',
      round(extract(epoch FROM c_idade_maxima)::numeric / 60)
      USING ERRCODE = '22023';
  END IF;

  -- 5. HORÁRIO DECLARADO. "Só hoje, antes de agora", no fuso do ponto
  --    (America/Sao_Paulo).
  IF p_horario_declarado IS NULL THEN
    RAISE EXCEPTION 'Pedido de batida em atraso exige o horario declarado'
      USING ERRCODE = '22023';
  END IF;
  -- O cru, e não o truncado: 10h05m59 pedido às 10h05m30 é futuro.
  IF p_horario_declarado >= now() THEN
    RAISE EXCEPTION 'Horario declarado no futuro: o pedido em atraso e para uma batida que ja passou'
      USING ERRCODE = '22023';
  END IF;

  -- Truncado ao minuto sem depender do fuso da sessão.
  v_horario := date_trunc('minute', p_horario_declarado AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF (v_horario AT TIME ZONE 'America/Sao_Paulo')::date
     <> (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Horario declarado fora do dia de hoje: o pedido em atraso so vale para o mesmo dia (horario de Brasilia)'
      USING ERRCODE = '22023';
  END IF;

  -- 6. MOTIVO.
  v_motivo := btrim(coalesce(p_motivo, ''));
  IF char_length(v_motivo) < c_motivo_minimo THEN
    RAISE EXCEPTION 'Motivo do pedido de batida em atraso precisa de pelo menos % caracteres', c_motivo_minimo
      USING ERRCODE = '23514';
  END IF;
  IF char_length(v_motivo) > c_motivo_maximo THEN
    RAISE EXCEPTION 'Motivo do pedido de batida em atraso pode ter no maximo % caracteres', c_motivo_maximo
      USING ERRCODE = '23514';
  END IF;

  -- 7. DUPLICADOS: batida no mesmo minuto, ou outro pedido pendente para ele.
  IF EXISTS (
    SELECT 1 FROM public.ponto_registros r
    WHERE r.usuario_id = v_ator
      AND r.registrado_em >= v_horario
      AND r.registrado_em <  v_horario + interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'Ja existe uma batida sua neste mesmo minuto: o pedido seria duplicado'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ponto_pedidos_atraso p
    WHERE p.usuario_id = v_ator AND p.estado = 'pendente' AND p.horario_declarado = v_horario
  ) THEN
    RAISE EXCEPTION 'Ja existe um pedido pendente seu para este mesmo horario'
      USING ERRCODE = '23505';
  END IF;

  -- 7b. TETO DE PENDENTES DO DIA. A trava por pessoa vale até o fim da
  --     transação: dois pedidos simultâneos da mesma pessoa contam um de cada
  --     vez, e o segundo vê o primeiro. Quando quem administra decide um, a
  --     fila anda.
  PERFORM pg_advisory_xact_lock(hashtextextended('ponto_pedidos_atraso:' || v_ator::text, 0));
  SELECT count(*) INTO v_pendentes
  FROM public.ponto_pedidos_atraso p
  WHERE p.usuario_id = v_ator AND p.estado = 'pendente'
    AND p.dia_civil = (v_horario AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_pendentes >= c_pendentes_no_dia THEN
    RAISE EXCEPTION 'Pedidos pendentes demais hoje: voce ja tem % pedidos de batida em atraso esperando decisao, e o teto e %. Espere quem administra o ponto decidir os que ja estao na fila',
      v_pendentes, c_pendentes_no_dia
      USING ERRCODE = '23514';
  END IF;

  -- -------------------------------------------------------------------------
  -- 8. PIN. Daqui para baixo, nenhuma recusa levanta exceção.
  -- -------------------------------------------------------------------------
  v_pin := public.ponto_verificar_pin(p_pin);

  IF coalesce((v_pin->>'confere')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('gravado', false) || (v_pin - 'confere'::text);
  END IF;

  IF coalesce((v_pin->>'precisa_redefinir')::boolean, false) THEN
    RETURN jsonb_build_object('gravado', false, 'motivo', 'precisa_redefinir');
  END IF;

  -- 9. DISTÂNCIA E MARCA do momento do pedido — a conta do carimbo. Sem
  --    localização, distância, marca e local ficam nulos, como no carimbo da
  --    batida sem coordenada.
  SELECT * INTO v_local
  FROM public.ponto_local
  WHERE ativo
  ORDER BY criado_em
  LIMIT 1;

  IF p_latitude IS NOT NULL AND v_local.id IS NOT NULL THEN
    v_distancia := round(
                     public.ponto_distancia_metros(
                       p_latitude, p_longitude, v_local.latitude, v_local.longitude
                     )::numeric, 2
                   )::double precision;
  END IF;

  -- 10. FOTOGRAFIA DE QUEM PEDIU: o nome da ficha; sem ficha, o nome guardado
  --     na conta; sem os dois, o e-mail. O e-mail é o da conta.
  v_nome  := public.ponto_nome_da_conta(v_ator);
  SELECT u.email::text INTO v_email FROM auth.users u WHERE u.id = v_ator;

  -- 11. GRAVAÇÃO, numa subtransação: se o INSERT colidir (reenvio do mesmo
  --     pedido depois de um timeout, ou dois toques no mesmo minuto), só ele
  --     volta atrás — a tentativa de PIN permanece.
  BEGIN
    INSERT INTO public.ponto_pedidos_atraso
      (id, usuario_id, horario_declarado, dia_civil, motivo, selfie_path,
       latitude, longitude, precisao_metros, distancia_metros, no_local, local_id,
       funcionario_nome, funcionario_email)
    VALUES
      (p_pedido_id, v_ator, v_horario, (v_horario AT TIME ZONE 'America/Sao_Paulo')::date,
       v_motivo, p_selfie_path,
       p_latitude, p_longitude, v_precisao, v_distancia,
       CASE WHEN v_distancia IS NULL THEN NULL ELSE v_distancia <= v_local.raio_metros END,
       CASE WHEN v_distancia IS NULL THEN NULL ELSE v_local.id END,
       v_nome, v_email)
    RETURNING * INTO v_pedido;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('gravado', false, 'motivo', 'pedido_duplicado');
  END;

  -- Lista explícita: o e-mail não volta ao navegador.
  RETURN jsonb_build_object(
    'gravado', true,
    'pedido', jsonb_build_object(
      'id',                v_pedido.id,
      'horario_declarado', v_pedido.horario_declarado,
      'dia_civil',         v_pedido.dia_civil,
      'motivo',            v_pedido.motivo,
      'pedido_em',         v_pedido.pedido_em,
      'estado',            v_pedido.estado,
      'latitude',          v_pedido.latitude,
      'longitude',         v_pedido.longitude,
      'precisao_metros',   v_pedido.precisao_metros,
      'distancia_metros',  v_pedido.distancia_metros,
      'no_local',          v_pedido.no_local,
      'selfie_path',       v_pedido.selfie_path
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_pedir_batida_em_atraso(p_pin text, p_pedido_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision, p_horario_declarado timestamp with time zone, p_motivo text, p_sem_localizacao text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_pedir_batida_em_atraso(p_pin text, p_pedido_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision, p_horario_declarado timestamp with time zone, p_motivo text, p_sem_localizacao text) TO authenticated, service_role;

CREATE FUNCTION public.ponto_registrar_batida(p_pin text, p_registro_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision DEFAULT NULL::double precision, p_sem_localizacao text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A folga da conferência de idade. Fica numa constante para o número aparecer
  -- uma vez só: ele é usado na comparação e na mensagem de recusa, e os dois
  -- têm de andar juntos se um dia alguém apertar ou afrouxar o prazo.
  c_idade_maxima constant interval := interval '15 minutes';

  v_ator      uuid := auth.uid();
  v_padrao    text;
  v_criada_em timestamptz;
  v_pin       jsonb;
  -- Sem localização, a precisão que o aparelho mandou não vale nada: nula.
  v_precisao  double precision := CASE WHEN p_latitude IS NULL THEN NULL ELSE p_precisao_metros END;
  v_registro  public.ponto_registros%ROWTYPE;
BEGIN
  -- -------------------------------------------------------------------------
  -- Tudo que pode levantar exceção vem ANTES da verificação do PIN, e é
  -- deliberado: a partir do momento em que ponto_verificar_pin roda, existe
  -- escrita na transação que não pode ser desfeita por um RAISE tardio.
  -- -------------------------------------------------------------------------

  -- 1. SESSÃO. Mesmo padrão de ponto_definir_pin: exigida antes de qualquer
  --    checagem de papel, porque ponto_ator_aprovado trata auth.uid() nulo
  --    como backend confiável.
  IF v_ator IS NULL THEN
    RAISE EXCEPTION 'Registro de ponto exige sessao de usuario'
      USING ERRCODE = '42501';
  END IF;

  -- 2. QUEM BATE: ficha que libera acesso OU super admin, este para testar o
  --    fluxo (ponto_pode_bater). Quem só administra entra no app e define o
  --    PIN, mas não bate.
  IF NOT public.ponto_pode_bater() THEN
    RAISE EXCEPTION 'Conta sem acesso para bater ponto: so quem tem ficha ativa no ponto bate ponto e pede batida em atraso; peca liberacao a quem cuida do ponto'
      USING ERRCODE = '42501';
  END IF;

  -- 3. COORDENADA. A localização nunca BLOQUEIA a batida por estar longe, e a
  --    batida feita pelo app traz coordenada, porque é ela que produz a
  --    distância e a marca dentro/fora.
  --
  --    A exceção: quando o GPS do aparelho NÃO RESPONDE, o app manda
  --    p_sem_localizacao = 'indisponivel'
  --    (o aparelho não conseguiu a posição) ou 'demora' (o tempo acabou), sem
  --    latitude e sem longitude, e a batida sai SEM LOCALIZAÇÃO: coordenada,
  --    precisão, distância, marca e local nulos (o carimbo já faz isso sem
  --    coordenada). É a origem 'app' com latitude nula que o painel, o espelho,
  --    a folha e o CSV mostram como "sem localização"; não há coluna própria.
  --    A selfie e o PIN continuam obrigatórios, logo abaixo. Permissão negada,
  --    falta de HTTPS e navegador sem suporte não são motivo aceito: continuam
  --    recusados com a frase de sempre, como a chamada que não manda o
  --    parâmetro. Com coordenada, p_sem_localizacao é ignorado (a batida tem
  --    localização). Meia coordenada (só uma das duas) é sempre recusada.
  IF p_latitude IS NULL AND p_longitude IS NULL THEN
    IF coalesce(p_sem_localizacao, '') NOT IN ('indisponivel', 'demora') THEN
      RAISE EXCEPTION 'Batida pelo app exige latitude e longitude'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Batida pelo app exige latitude e longitude'
      USING ERRCODE = '22023';
  ELSIF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Coordenada fora do intervalo valido'
      USING ERRCODE = '22023';
  END IF;
  -- Precisão ruim é aceita e GRAVADA como veio: quem interpreta "localização
  -- imprecisa" é o painel de administração, não esta função. Só o absurdo é
  -- recusado.
  IF v_precisao IS NOT NULL AND v_precisao < 0 THEN
    RAISE EXCEPTION 'Precisao informada nao pode ser negativa'
      USING ERRCODE = '22023';
  END IF;

  -- 4. SELFIE. A convenção do caminho, conferida caractere a caractere.
  --
  --    O `{aaaa}/{mm}` é conferido no FORMATO (quatro dígitos, dois dígitos) e
  --    não no VALOR, de propósito: quem nomeia a pasta é o relógio do aparelho,
  --    e recusar por causa dele contrariaria a regra de que relógio torto não
  --    muda nada. O que impede foto pré-estocada é a idade do objeto, no 4b.
  IF p_registro_id IS NULL THEN
    RAISE EXCEPTION 'Batida exige o identificador do registro'
      USING ERRCODE = '22023';
  END IF;

  v_padrao := '^' || v_ator::text || '/[0-9]{4}/[0-9]{2}/' || p_registro_id::text || '\.jpg$';

  IF p_selfie_path IS NULL OR p_selfie_path !~ v_padrao THEN
    RAISE EXCEPTION 'Caminho de selfie fora da convencao: esperado {user_id}/{aaaa}/{mm}/{id-do-registro}.jpg'
      USING ERRCODE = '22023';
  END IF;

  -- 4b. O OBJETO E A IDADE DELE. Uma leitura só serve às duas
  --     perguntas: "existe?" e "é de agora?".
  SELECT o.created_at INTO v_criada_em
  FROM storage.objects o
  WHERE o.bucket_id = 'ponto-selfies' AND o.name = p_selfie_path;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selfie nao encontrada no bucket: envie a foto antes de gravar a batida'
      USING ERRCODE = '22023';
  END IF;

  -- created_at é anulável no schema do Storage (tem DEFAULT now(), mas a coluna
  -- aceita nulo). Sem carimbo não há como afirmar que a foto é de agora, e
  -- "não sei" aqui tem que valer "não".
  IF v_criada_em IS NULL OR v_criada_em < now() - c_idade_maxima THEN
    -- round(): sem ele o extract devolve numeric com 16 casas e a mensagem sai
    -- "nos ultimos 15.0000000000000000 minutos".
    RAISE EXCEPTION 'Selfie fora do prazo: a foto precisa ter sido enviada nos ultimos % minutos',
      round(extract(epoch FROM c_idade_maxima)::numeric / 60)
      USING ERRCODE = '22023';
  END IF;

  -- -------------------------------------------------------------------------
  -- 5. PIN. Daqui para baixo, nenhuma recusa levanta exceção.
  -- -------------------------------------------------------------------------
  v_pin := public.ponto_verificar_pin(p_pin);

  IF coalesce((v_pin->>'confere')::boolean, false) IS NOT TRUE THEN
    -- pin_nao_definido / pin_incorreto / bloqueado, com as chaves que cada um
    -- traz. `confere` sai porque `gravado` já responde a mesma pergunta.
    RETURN jsonb_build_object('gravado', false) || (v_pin - 'confere'::text);
  END IF;

  -- PIN certo, mas o admin resetou: a pessoa tem que definir um PIN novo antes
  -- de bater. Sem esta guarda, "após o reset a próxima entrada pede PIN novo"
  -- seria só uma regra de tela, contornável por chamada direta.
  IF coalesce((v_pin->>'precisa_redefinir')::boolean, false) THEN
    RETURN jsonb_build_object('gravado', false, 'motivo', 'precisa_redefinir');
  END IF;

  -- -------------------------------------------------------------------------
  -- 6. GRAVAÇÃO. O bloco com EXCEPTION é uma subtransação: se o INSERT falhar,
  --    só ele volta atrás — a tentativa de PIN registrada acima permanece.
  --    unique_violation cobre os dois casos que interessam e que o funcionário
  --    lê da mesma forma ("essa batida já foi"): a recusa de duplicidade em
  --    60 s levantada pelo gatilho (ERRCODE 23505) e o reenvio da MESMA
  --    chamada depois de um timeout de rede, que colide na chave primária.
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.ponto_registros
      (id, usuario_id, latitude, longitude, precisao_metros, selfie_path)
    VALUES
      (p_registro_id, v_ator, p_latitude, p_longitude, v_precisao, p_selfie_path)
    RETURNING * INTO v_registro;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('gravado', false, 'motivo', 'batida_duplicada');
  END;

  -- Lista explícita, e não to_jsonb(v_registro): a linha carrega
  -- funcionario_email e criado_por, que o comprovante não usa e o
  -- navegador não precisa receber.
  RETURN jsonb_build_object(
    'gravado', true,
    'registro', jsonb_build_object(
      'id',               v_registro.id,
      'registrado_em',    v_registro.registrado_em,
      'dia_civil',        v_registro.dia_civil,
      'tipo',             v_registro.tipo,
      'ordem_no_dia',     v_registro.ordem_no_dia,
      'latitude',         v_registro.latitude,
      'longitude',        v_registro.longitude,
      'precisao_metros',  v_registro.precisao_metros,
      'distancia_metros', v_registro.distancia_metros,
      'no_local',         v_registro.no_local,
      'selfie_path',      v_registro.selfie_path,
      'ajuste_manual',    v_registro.ajuste_manual
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_registrar_batida(p_pin text, p_registro_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision, p_sem_localizacao text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_registrar_batida(p_pin text, p_registro_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision, p_sem_localizacao text) TO authenticated, service_role;

CREATE FUNCTION public.ponto_reordenar_dia(p_usuario uuid, p_dia date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_motivo      constant text := 'Reordenacao do dia pelo relogio depois de batida retroativa: tipo e ordem seguem o horario das batidas';
  -- Quem chamou pode estar com o canal aberto (uma migration, outra operação
  -- do sistema). Fechar no fim sem olhar apagaria o canal dele.
  v_canal_antes text := nullif(btrim(coalesce(current_setting('ponto.operacao_do_sistema', true), '')), '');
  v_n           integer := 0;
BEGIN
  IF p_usuario IS NULL OR p_dia IS NULL THEN
    RETURN 0;
  END IF;

  -- Uma reordenação por pessoa+dia de cada vez.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ponto_reordenar_dia|' || p_usuario::text || '|' || p_dia::text, 0));

  -- As batidas do dia ficam paradas até o fim da transação.
  PERFORM 1
  FROM public.ponto_registros r
  WHERE r.usuario_id = p_usuario AND r.dia_civil = p_dia
  ORDER BY r.id
  FOR UPDATE;

  -- Nada fora de ordem: sai sem abrir o canal e sem escrever.
  IF NOT EXISTS (SELECT 1 FROM public.ponto_ordem_do_dia(p_usuario, p_dia) o WHERE o.muda) THEN
    RETURN 0;
  END IF;

  PERFORM public.ponto_abrir_operacao_do_sistema(c_motivo);

  UPDATE public.ponto_registros r
     SET ordem_no_dia = o.ordem_certa,
         tipo         = o.tipo_certo
    FROM public.ponto_ordem_do_dia(p_usuario, p_dia) o
   WHERE r.id = o.registro_id
     AND o.muda;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM public.ponto_fechar_operacao_do_sistema();
  IF v_canal_antes IS NOT NULL THEN
    PERFORM public.ponto_abrir_operacao_do_sistema(v_canal_antes);
  END IF;

  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_reordenar_dia(p_usuario uuid, p_dia date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_reordenar_dia(p_usuario uuid, p_dia date) TO service_role;

CREATE FUNCTION public.ponto_reordenar_dia_apos_mudanca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A reordenação não se re-dispara; a guarda é para qualquer caminho futuro.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A batida do app é sempre a última do dia, e sai aqui.
    IF EXISTS (
      SELECT 1 FROM public.ponto_registros r
      WHERE r.usuario_id = NEW.usuario_id
        AND r.dia_civil  = NEW.dia_civil
        AND r.id <> NEW.id
        AND (r.registrado_em, r.criado_em, r.id) > (NEW.registrado_em, NEW.criado_em, NEW.id)
    ) THEN
      PERFORM public.ponto_reordenar_dia(NEW.usuario_id, NEW.dia_civil);
    END IF;
    RETURN NULL;
  END IF;

  -- UPDATE de horário ou de dia: o dia de onde saiu e, se for outro, o de
  -- destino.
  PERFORM public.ponto_reordenar_dia(OLD.usuario_id, OLD.dia_civil);
  IF NEW.dia_civil IS DISTINCT FROM OLD.dia_civil OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id THEN
    PERFORM public.ponto_reordenar_dia(NEW.usuario_id, NEW.dia_civil);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_reordenar_dia_apos_mudanca() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_reordenar_dia_apos_mudanca() TO service_role;

CREATE FUNCTION public.ponto_resetar_pin(p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ator      uuid := auth.uid();
  v_agora     timestamptz := now();
  v_tinha_pin boolean;
BEGIN
  IF v_ator IS NULL THEN
    RAISE EXCEPTION 'Reset de PIN exige sessao de usuario'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.ponto_pode_administrar() THEN
    RAISE EXCEPTION 'Reset de PIN e exclusivo de quem administra o ponto'
      USING ERRCODE = '42501';
  END IF;

  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Reset de PIN exige o usuario alvo'
      USING ERRCODE = '22023';
  END IF;

  -- O reset solta a trava e zera a conta dos bloqueios do dia: quem
  -- administra conferiu com a pessoa, e o PIN novo começa sem castigo.
  UPDATE public.ponto_pin
     SET precisa_redefinir  = true,
         tentativas_falhas  = 0,
         bloqueado_ate      = NULL,
         bloqueios_no_dia   = 0,
         ultimo_bloqueio_em = NULL,
         resetado_por       = v_ator,
         resetado_em        = v_agora,
         atualizado_em      = v_agora
   WHERE usuario_id = p_usuario_id;

  v_tinha_pin := FOUND;

  -- Sem linha em ponto_pin o reset é inócuo, mas NÃO é erro: `ponto_pin_status`
  -- já devolve `precisa_redefinir: true` por coalesce quando não há linha, então
  -- a próxima entrada daquela conta cai na tela de definir PIN de qualquer jeito.
  -- O admin não precisa saber se a pessoa chegou a cadastrar um PIN antes de
  -- pedir o reset; `tinha_pin` conta isso a quem quiser mostrar na tela.
  RETURN jsonb_build_object(
    'resetado',    true,
    'usuario_id',  p_usuario_id,
    'tinha_pin',   v_tinha_pin,
    'resetado_em', v_agora
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_resetar_pin(p_usuario_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_resetar_pin(p_usuario_id uuid) TO authenticated, service_role;

CREATE FUNCTION public.ponto_selfie_pode_subir(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Uma batida é uma foto; com PIN errado, rede ruim e pedido de batida em
  -- atraso, um dia normal não passa de uma dúzia. O teto só segura quem sobe
  -- arquivo pela API para encher o bucket (até 3 MB cada).
  c_teto_na_hora constant integer := 20;
  c_teto_no_dia  constant integer := 60;
  v_ator         uuid := auth.uid();
  v_na_hora      integer;
  v_no_dia       integer;
BEGIN
  -- As regras de INSERT de storage.objects valem para todo bucket do projeto
  -- e se somam com OU; a ordem em que o banco avalia as partes de cada uma não
  -- é garantida. Por isso esta função só responde (e só recusa com frase)
  -- pela selfie que a própria sessão sobe na própria pasta: para qualquer
  -- outro objeto (o atestado, outro bucket), ela diz "não é comigo" (false),
  -- sem erro, e as outras regras decidem.
  IF v_ator IS NULL OR p_bucket IS DISTINCT FROM 'ponto-selfies' OR p_name IS NULL
     OR split_part(p_name, '/', 1) <> v_ator::text THEN
    RETURN false;
  END IF;

  -- A convenção das RPCs da batida e do pedido: {conta}/{aaaa}/{mm}/{uuid}.jpg,
  -- com o uuid que vira o id da batida ou do pedido. Um arquivo fora dela nunca
  -- vira prova de nada, e só ocuparia o bucket.
  IF p_name !~ ('^' || v_ator::text || '/[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') THEN
    RAISE EXCEPTION 'Caminho de selfie fora da convencao: esperado {user_id}/{aaaa}/{mm}/{uuid}.jpg'
      USING ERRCODE = '42501';
  END IF;

  -- O teto, contado pelos objetos da pasta da pessoa (a API do storage
  -- devolve a frase do 42501 como veio).
  SELECT count(*) FILTER (WHERE o.created_at > now() - interval '1 hour'),
         count(*)
    INTO v_na_hora, v_no_dia
    FROM storage.objects o
   WHERE o.bucket_id = 'ponto-selfies'
     AND o.name LIKE v_ator::text || '/%'
     AND o.created_at > now() - interval '24 hours';

  IF v_na_hora >= c_teto_na_hora THEN
    RAISE EXCEPTION 'Selfies demais nesta conta: % na ultima hora, e o teto e %. Espere um pouco e tente de novo',
      v_na_hora, c_teto_na_hora
      USING ERRCODE = '42501';
  END IF;
  IF v_no_dia >= c_teto_no_dia THEN
    RAISE EXCEPTION 'Selfies demais nesta conta: % nas ultimas 24 horas, e o teto e %. Tente de novo mais tarde',
      v_no_dia, c_teto_no_dia
      USING ERRCODE = '42501';
  END IF;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_selfie_pode_subir(p_bucket text, p_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_selfie_pode_subir(p_bucket text, p_name text) TO authenticated, service_role;

CREATE FUNCTION public.ponto_super_admins_exigir_ao_menos_um()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restantes integer;
BEGIN
  -- TRUNCATE (BEFORE): a contagem ainda está cheia, então a recusa é sem conta.
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'A lista de super admins do ponto nao se esvazia.'
      USING ERRCODE = '23514';
  END IF;

  -- DELETE (AFTER STATEMENT): só conta o que tirou alguém da lista. Apagar
  -- uma conta em auth.users cascateia para esta tabela e dispara este gatilho
  -- de comando mesmo quando a conta não estava aqui; numa instalação nova,
  -- com a lista ainda vazia, recusar esse DELETE vazio impediria apagar
  -- qualquer conta do projeto. Tirou alguém: conta o que sobrou de verdade.
  IF NOT EXISTS (SELECT 1 FROM removidas) THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_restantes FROM public.ponto_super_admins;
  IF v_restantes = 0 THEN
    RAISE EXCEPTION 'O ponto ficaria sem nenhum super admin: acrescente outra conta a lista antes de remover a ultima.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_super_admins_exigir_ao_menos_um() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_super_admins_exigir_ao_menos_um() TO service_role;

CREATE FUNCTION public.ponto_super_admins_guardar_regras()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restantes integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.usuario_id IS DISTINCT FROM OLD.usuario_id THEN
      RAISE EXCEPTION 'Super admin do ponto nao se transfere para outra conta: acrescente a nova por migration e depois tire a antiga.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_restantes FROM public.ponto_super_admins;
  IF v_restantes <= 1 THEN
    RAISE EXCEPTION 'O ponto ficaria sem nenhum super admin: acrescente outra conta a lista antes de remover a ultima.'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_super_admins_guardar_regras() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_super_admins_guardar_regras() TO service_role;

CREATE FUNCTION public.ponto_tocar_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_tocar_atualizado_em() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_tocar_atualizado_em() TO service_role;

CREATE FUNCTION public.ponto_trilha_e_permanente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% em %: a trilha do ponto e permanente e nao se altera, nao se apaga e nao se esvazia',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_trilha_e_permanente() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_trilha_e_permanente() TO service_role;

CREATE FUNCTION public.ponto_verificar_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_limite        constant smallint := 5;
  v_ator          uuid := auth.uid();
  v_guarda        public.ponto_pin%ROWTYPE;
  v_confere       boolean;
  v_falhas        smallint;
  v_bloqueado_ate timestamptz;
  v_bloqueios     smallint;
  v_hoje          date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF v_ator IS NULL THEN
    RAISE EXCEPTION 'Verificacao de PIN exige sessao de usuario'
      USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: duas tentativas ao mesmo tempo não podem ler o mesmo contador
  -- e gravar 1 as duas.
  SELECT * INTO v_guarda FROM public.ponto_pin WHERE usuario_id = v_ator FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('confere', false, 'motivo', 'pin_nao_definido');
  END IF;

  IF v_guarda.bloqueado_ate IS NOT NULL AND v_guarda.bloqueado_ate > now() THEN
    INSERT INTO public.ponto_pin_tentativas (usuario_id, sucesso, bloqueado)
    VALUES (v_ator, false, true);
    RETURN jsonb_build_object('confere', false, 'motivo', 'bloqueado',
                              'bloqueado_ate', v_guarda.bloqueado_ate);
  END IF;

  v_confere := (v_guarda.pin_hash = extensions.crypt(coalesce(p_pin, ''), v_guarda.pin_hash));

  IF v_confere THEN
    UPDATE public.ponto_pin
       SET tentativas_falhas = 0, bloqueado_ate = NULL
     WHERE usuario_id = v_ator;
    INSERT INTO public.ponto_pin_tentativas (usuario_id, sucesso) VALUES (v_ator, true);
    RETURN jsonb_build_object('confere', true,
                              'precisa_redefinir', v_guarda.precisa_redefinir);
  END IF;

  v_falhas := v_guarda.tentativas_falhas + 1;
  IF v_falhas >= c_limite THEN
    -- O CASTIGO CRESCE COM OS BLOQUEIOS DO MESMO DIA (America/Sao_Paulo): 15
    -- minutos no primeiro, 1 hora no segundo, 24 horas do terceiro em diante.
    -- Quatro dígitos são poucos: assim, quem tem a sessão aberta de outra
    -- pessoa (um celular esquecido desbloqueado) testa uns 15 PINs por dia. O
    -- acerto não zera a conta (seria o dono, no meio das tentativas de outro);
    -- zeram o reset do PIN por quem administra e o dia seguinte.
    v_bloqueios := CASE
                     WHEN v_guarda.ultimo_bloqueio_em IS NOT NULL
                          AND (v_guarda.ultimo_bloqueio_em AT TIME ZONE 'America/Sao_Paulo')::date = v_hoje
                       THEN v_guarda.bloqueios_no_dia + 1
                     ELSE 1
                   END;
    v_bloqueado_ate := now() + CASE v_bloqueios
                                 WHEN 1 THEN interval '15 minutes'
                                 WHEN 2 THEN interval '1 hour'
                                 ELSE        interval '24 hours'
                               END;
    -- Zera o contador junto com o bloqueio: quando o castigo vencer, a conta
    -- volta com as cinco chances inteiras, não trancando no primeiro erro.
    v_falhas := 0;
  END IF;

  UPDATE public.ponto_pin
     SET tentativas_falhas  = v_falhas,
         bloqueado_ate      = coalesce(v_bloqueado_ate, bloqueado_ate),
         bloqueios_no_dia   = coalesce(v_bloqueios, bloqueios_no_dia),
         ultimo_bloqueio_em = CASE WHEN v_bloqueado_ate IS NULL THEN ultimo_bloqueio_em ELSE now() END
   WHERE usuario_id = v_ator;

  INSERT INTO public.ponto_pin_tentativas (usuario_id, sucesso, bloqueado)
  VALUES (v_ator, false, v_bloqueado_ate IS NOT NULL);

  RETURN jsonb_build_object(
    'confere', false,
    'motivo', CASE WHEN v_bloqueado_ate IS NOT NULL THEN 'bloqueado' ELSE 'pin_incorreto' END,
    -- No erro que tranca, v_falhas acabou de ser zerado (para a trava
    -- vencer com as cinco chances inteiras), e a conta daria 5. Quem acabou de
    -- ser trancado tem 0 tentativas, e é isso que a resposta diz.
    'tentativas_restantes', CASE WHEN v_bloqueado_ate IS NOT NULL THEN 0 ELSE c_limite - v_falhas END,
    'bloqueado_ate', v_bloqueado_ate
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_verificar_pin(p_pin text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_verificar_pin(p_pin text) TO authenticated, service_role;

CREATE FUNCTION public.ponto_vinculo_do_pedido_atraso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Congelada em silêncio: um painel que mande a linha inteira de volta não
    -- quer desligar (nem trocar) a origem da batida.
    NEW.pedido_atraso_id := OLD.pedido_atraso_id;
    RETURN NEW;
  END IF;

  -- INSERT. A batida do app e a do admin chegam sem pedido: passa direto.
  IF NEW.pedido_atraso_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Só a aprovação, nesta mesma transação, liga batida a pedido.
  IF NOT EXISTS (
    SELECT 1 FROM public.ponto_pedidos_atraso p
    WHERE p.id = NEW.pedido_atraso_id
      AND p.estado = 'aprovado'
      AND p.registro_id IS NULL
      AND p.decidido_em = now()
      AND p.usuario_id = NEW.usuario_id
      AND p.horario_declarado = NEW.registrado_em
      AND p.selfie_path IS NOT DISTINCT FROM NEW.selfie_path
  ) THEN
    RAISE EXCEPTION 'Batida ligada a pedido de atraso so nasce da aprovacao do pedido (ponto_decidir_pedido_atraso)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_vinculo_do_pedido_atraso() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_vinculo_do_pedido_atraso() TO service_role;

-- 7. Comentários. Eles ficam no catálogo do banco (o \d+ do psql e o painel do
--    Supabase os mostram): cada um diz o que a peça garante, e por quê.
COMMENT ON FUNCTION public.ponto_abrir_operacao_do_sistema(p_motivo text) IS 'Abre, ate o fim da transacao ou ate ponto_fechar_operacao_do_sistema(), o canal em que UPDATEs de ponto_registros feitos por codigo do banco (funcao DEFINER do ponto, migration, backend) geram trilha de natureza sistema, sem exigir motivo_ajuste e sem ligar ajuste_manual. Sessao de usuario (authenticated/anon) nunca usa o canal, mesmo com ele aberto. Sem EXECUTE para o app.';
COMMENT ON FUNCTION public.ponto_admins_carimbar_concessao() IS 'Gatilho BEFORE INSERT OR UPDATE de ponto_admins. INSERT: concedido_por = auth.uid() (com sessao) e concedido_em = now(), ignorando o cliente. UPDATE: concedido_por e concedido_em ficam como estavam.';
COMMENT ON FUNCTION public.ponto_admins_exigir_ao_menos_um() IS 'Gatilho de comando da ponto_admins: recusa TRUNCATE sempre (BEFORE) e e a rede de seguranca para o DELETE que apaga varias linhas de uma vez (AFTER STATEMENT), onde o gatilho de linha nao enxerga o esvaziamento. So olha o DELETE que tirou alguem (tabela de transicao removidas): o DELETE vazio, como o que cascateia de auth.users ao apagar uma conta que nao administra, passa.';
COMMENT ON FUNCTION public.ponto_admins_guardar_regras() IS 'Gatilho de linha da ponto_admins: recusa remover o ultimo administrador e recusa repontar uma concessao para outra pessoa.';
COMMENT ON FUNCTION public.ponto_anotar_papel_do_comando() IS 'Gatilho BEFORE INSERT OR UPDATE OR DELETE de ponto_registros, SECURITY INVOKER de proposito: anota em ponto.papel_do_comando o papel que executou o comando (current_user so diz isso numa funcao invoker). Os gatilhos DEFINER do carimbo, da trilha e do apagamento leem a anotacao: no INSERT, ela separa a RPC da batida (postgres, dentro da funcao DEFINER) do INSERT direto (authenticated, service_role), que e sempre lancamento de quem administra; no UPDATE e no DELETE, separa sessao de usuario de operacao do sistema. Roda antes deles pela ordem alfabetica do nome do gatilho.';
COMMENT ON FUNCTION public.ponto_ator_aprovado() IS 'A sessao entra no ponto (app e PIN)? Ficha do ponto que libera acesso (ponto_ficha_libera_acesso) OU quem administra (ponto_pode_administrar, que cobre o super admin). Sem auth.uid() devolve TRUE (backend confiavel: service_role, migration) — por isso quem chama exige sessao antes. Bater e pedir batida em atraso: ponto_pode_bater.';
COMMENT ON FUNCTION public.ponto_ausencias_guardar() IS 'BEFORE INSERT OR UPDATE de ponto_ausencias. Exige sessao de admin do ponto. INSERT: carimba lancado_por/lancado_em, confere pessoa, tipo, periodo (ordem, 120 dias, janela de um ano), sobreposicao com ausencia ativa e o atestado no bucket ponto-atestados. UPDATE: so o cancelamento, uma vez, com motivo; autor e momento carimbados.';
COMMENT ON FUNCTION public.ponto_ausencias_nao_se_apagam() IS 'Recusa sempre. Ligado a DELETE (linha) e TRUNCATE (comando) de ponto_ausencias: vale para qualquer papel, inclusive o dono e o service_role. A ausencia so se cancela, com motivo.';
COMMENT ON FUNCTION public.ponto_configuracao_normalizar() IS 'Gatilho de ponto_configuracao: apara espacos, transforma texto vazio em NULL, tira a mascara do CNPJ e sobe a UF para maiuscula. Nao corrige valor errado — disso cuidam os CHECKs.';
COMMENT ON FUNCTION public.ponto_contas_trilha_carimbar() IS 'Gatilho BEFORE INSERT de ponto_contas_trilha: recusa sessao de usuario (auth.uid() ou papel authenticated/anon), recusa autor fora de ponto_super_admins e carimba id e feito_em pelo banco.';
COMMENT ON FUNCTION public.ponto_contas_trilha_pronta() IS 'A Edge Function ponto-contas pode agir? true = o service_role grava na trilha de contas e o carimbo esta ligado. A funcao pergunta antes de cada acao e recusa tudo (503) se a resposta nao for true.';
COMMENT ON FUNCTION public.ponto_decidir_pedido_atraso(p_pedido_id uuid, p_aprovar boolean, p_motivo text) IS 'Admin do ponto (nunca quem pediu) decide um pedido pendente. Recusar exige motivo. Aprovar exige a selfie no bucket e nenhuma batida da pessoa no mesmo minuto; cria a batida no horario declarado (origem ajuste_admin, ajuste_manual, motivo "Batida em atraso aprovada: ...", selfie e coordenada do pedido, pedido_atraso_id), liga o pedido a ela e reordena o dia.';
COMMENT ON FUNCTION public.ponto_distancia_metros(p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision) IS 'Distância haversine em metros entre duas coordenadas. Sem dependência de cube/earthdistance.';
COMMENT ON FUNCTION public.ponto_estado_do_pin() IS 'Estado do PIN de todo mundo, para a area de administracao: tem PIN, precisa redefinir e ate quando esta bloqueado. NAO devolve pin_hash, hash_versao nem tentativas_falhas. Exige sessao e ponto_pode_administrar().';
COMMENT ON FUNCTION public.ponto_fechar_operacao_do_sistema() IS 'Fecha o canal aberto por ponto_abrir_operacao_do_sistema(). Quem abre fecha logo depois do UPDATE: aberto, o canal valeria para tudo o que viesse depois na mesma transacao.';
COMMENT ON FUNCTION public.ponto_ficha_libera_acesso(p_usuario_id uuid) IS 'A conta tem ficha do ponto que libera acesso (ativa, ligada a ela, sem desligamento passado no fuso America/Sao_Paulo)? SECURITY INVOKER: dentro das funcoes DEFINER do ponto ve todas as fichas; pelo app, so o que a RLS de ponto_funcionarios deixa a sessao ver.';
COMMENT ON FUNCTION public.ponto_funcionarios_acesso_pelo_super_admin() IS 'Gatilho BEFORE INSERT OR UPDATE de ponto_funcionarios: se a linha nova libera acesso ao ponto a uma conta (ativa, ligada, sem desligamento passado) e a antiga nao liberava a mesma conta, exige super admin. Tirar acesso e editar cadastro continuam com qualquer admin; sem sessao, passa.';
COMMENT ON FUNCTION public.ponto_funcionarios_normalizar() IS 'Gatilho de ponto_funcionarios: apara espacos, transforma texto vazio em NULL e tira a mascara do CPF. Nao corrige valor errado — disso cuidam os CHECKs e a tela.';
COMMENT ON FUNCTION public.ponto_guardar_apagamento() IS 'BEFORE DELETE de ponto_registros. Recusa sessao de usuario (auth.uid(), papel do comando ou papel da sessao authenticated/anon), recusa o backend sem o canal do sistema aberto e recusa batida com trilha de correcao. Passando, guarda a linha inteira em ponto_registros_apagados antes de ela sumir.';
COMMENT ON FUNCTION public.ponto_guardar_correcao() IS 'BEFORE UPDATE de ponto_registros. Congela identidade e origem, nao deixa ajuste_manual voltar a false, recalcula dia_civil quando o horario muda e distancia/no_local/local_id quando a coordenada muda, e grava em ponto_correcoes toda mudanca relevante com a linha anterior e a nova. Caminho do admin: recusa quem e dono da batida (ninguem corrige o proprio ponto, nem o super admin), exige motivo_ajuste novo e liga ajuste_manual (natureza admin). Caminho do sistema (canal aberto + comando fora de sessao de usuario): motivo do canal, sem tocar ajuste_manual nem motivo_ajuste, so tipo/ordem/distancia/marca/local (natureza sistema).';
COMMENT ON FUNCTION public.ponto_local_carimbar_medicao() IS 'BEFORE INSERT OR UPDATE de ponto_local. Carimba medido_por = auth.uid() e medido_em = now() quando o local nasce ou quando latitude, longitude ou raio mudam; senao repoe os valores antigos. O cliente nunca escolhe quem mediu nem quando.';
COMMENT ON FUNCTION public.ponto_local_em_uso_nao_sai() IS 'BEFORE DELETE de ponto_local: recusa apagar local que alguma batida referencia (local_id), com uma mensagem que diz o que fazer. A FK ponto_registros_local_id_fkey (ON DELETE RESTRICT) recusaria do mesmo jeito, com o erro generico de chave estrangeira; o gatilho roda antes dela.';
COMMENT ON FUNCTION public.ponto_meu_acesso() IS 'Para a guarda de rota e a sessao do app: {tem_acesso, origem (ficha|administracao|null), administra, super_admin, bate_ponto, nome, cargo} da sessao. tem_acesso = ficha que libera OU ponto_pode_administrar(); bate_ponto = ficha que libera OU super admin; nome = ficha, depois o nome guardado na conta, depois o e-mail; cargo = o da ficha ou null. Sem sessao: tudo false. SECURITY DEFINER porque o nome e o e-mail moram em auth.users; so responde sobre a propria sessao.';
COMMENT ON FUNCTION public.ponto_motivo_e_marca_so_com_correcao() IS 'BEFORE UPDATE OF motivo_ajuste, ajuste_manual de ponto_registros, depois de ponto_guardar_correcao (ordem do nome do gatilho). Se, tirando motivo, marca e atualizado_em, a linha nova e igual a antiga (nenhum campo da batida mudou, nenhuma trilha), recusa mudar motivo_ajuste e recusa ligar ajuste_manual. Correcao de campo, linha devolvida igual e operacao do sistema passam.';
COMMENT ON FUNCTION public.ponto_ordem_do_dia(p_usuario uuid, p_dia date) IS 'Para cada batida do dia da pessoa: ordem e tipo atuais, ordem e tipo pelo relogio (registrado_em, criado_em, id; 1 entrada, 2 saida_almoco, 3 volta_almoco, 4 saida, 5+ extra), e se muda. Unica definicao de ordem certa: usada pela reordenacao e pelos testes do banco.';
COMMENT ON FUNCTION public.ponto_pedido_atraso_aprovado_tem_batida() IS 'CONSTRAINT TRIGGER adiado de ponto_pedidos_atraso: no fim da transacao, pedido aprovado precisa ter registro_id.';
COMMENT ON FUNCTION public.ponto_pedido_atraso_guardar() IS 'Gatilho de ponto_pedidos_atraso. Recusa DELETE e TRUNCATE de qualquer papel; recusa UPDATE do que foi declarado ou medido no pedido; deixa o estado andar uma vez (pendente -> aprovado/recusado) e, depois, so registro_id nascer.';
COMMENT ON FUNCTION public.ponto_pedir_batida_em_atraso(p_pin text, p_pedido_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision, p_horario_declarado timestamp with time zone, p_motivo text, p_sem_localizacao text) IS 'O colaborador pede uma batida esquecida: horario declarado (mesmo dia civil, antes de agora, truncado ao minuto), motivo (10 a 500), selfie recente no bucket com a convencao da batida, coordenada e PIN (a mesma verificacao, que conta tentativa). Sem latitude e sem longitude, so com p_sem_localizacao indisponivel ou demora (o GPS nao respondeu): o pedido nasce sem localizacao (coordenada, precisao, distancia, marca e local nulos). Com coordenada, p_sem_localizacao e ignorado; meia coordenada e recusada. No maximo 4 pedidos pendentes de hoje por pessoa: o quinto e recusado antes do PIN, e a fila anda quando quem administra decide. Grava pendente em ponto_pedidos_atraso; nao cria batida. Responde {gravado, pedido} ou {gravado:false, motivo}.';
COMMENT ON FUNCTION public.ponto_pode_administrar() IS 'Quem esta chamando administra o ponto (esta em ponto_admins ou em ponto_super_admins)? Exige sessao: chamador sem auth.uid() recebe FALSE — ao contrario de ponto_ator_aprovado(), que devolve TRUE nesse caso.';
COMMENT ON FUNCTION public.ponto_registrar_batida(p_pin text, p_registro_id uuid, p_selfie_path text, p_latitude double precision, p_longitude double precision, p_precisao_metros double precision, p_sem_localizacao text) IS 'Unica porta de gravacao de batida para funcionario comum, e a unica que da origem app (o INSERT direto e sempre lancamento de quem administra, com horario e motivo). Confere o PIN por ponto_verificar_pin (respeitando tentativas e trava), recusa conta com precisa_redefinir, e exige selfie ja no bucket, na convencao do caminho (pasta do proprio chamador, uuid do arquivo = id do registro) e com menos de 15 minutos de created_at — a foto e evidencia do momento, nao arquivo pre-estocado. O mes da pasta NAO e conferido contra o calendario: quem nomeia a pasta e o relogio do aparelho, e a idade do objeto ja impede o pre-estoque. Exige latitude e longitude; sem as duas, so com p_sem_localizacao indisponivel ou demora (o GPS do aparelho nao respondeu), e a batida sai sem localizacao (coordenada, precisao, distancia, marca e local nulos). Com coordenada, p_sem_localizacao e ignorado; meia coordenada e recusada. O gatilho carimba horario, tipo, dia civil e distancia. Recusa de PIN volta como retorno, nunca como excecao, para o contador de tentativas nao ser desfeito pelo rollback.';
COMMENT ON FUNCTION public.ponto_reordenar_dia(p_usuario uuid, p_dia date) IS 'Reescreve tipo e ordem_no_dia das batidas do dia da pessoa na ordem do relogio (ponto_ordem_do_dia), so nas linhas que mudam, dentro do canal do sistema (trilha natureza sistema, sem ajuste_manual). Sem mudanca, nao abre o canal nem escreve. Preserva canal aberto por quem chamou. Devolve quantas linhas mudou. Sem EXECUTE para o app.';
COMMENT ON FUNCTION public.ponto_reordenar_dia_apos_mudanca() IS 'AFTER INSERT (so quando a batida nova nao e a ultima do dia) e AFTER UPDATE OF registrado_em, dia_civil (quando mudou de fato) em ponto_registros: chama ponto_reordenar_dia no dia afetado (e no de destino). A batida do app, sempre a ultima, nao reordena nada.';
COMMENT ON FUNCTION public.ponto_resetar_pin(p_usuario_id uuid) IS 'Reset do PIN de um funcionario por quem administra o ponto (public.ponto_admins). Marca precisa_redefinir, registra autor e momento, solta a trava de tentativas e zera a conta dos bloqueios do dia. A proxima entrada daquela conta exige PIN novo.';
COMMENT ON FUNCTION public.ponto_selfie_pode_subir(p_bucket text, p_name text) IS 'Parte da regra de INSERT da selfie: a sessao sobe na propria pasta so no caminho da convencao das RPCs ({conta}/{aaaa}/{mm}/{uuid}.jpg), e no maximo 20 fotos na ultima hora e 60 nas ultimas 24 horas. Recusa com frase propria (42501, que a API do storage repassa). Para qualquer objeto que nao seja a selfie da propria sessao devolve false, sem erro: as regras de storage.objects se somam com OU, e as outras decidem.';
COMMENT ON FUNCTION public.ponto_selfie_sem_batida(p_name text) IS 'O objeto do bucket ponto-selfies NUNCA foi prova de nada? Falso se alguma batida aponta para ele, se ele aparece na trilha de correcoes (antes ou depois), numa batida apagada pelo backend ou num pedido de batida em atraso. Sustenta o descarte da foto orfa pelo dono e por quem administra (as duas regras de DELETE ainda exigem a foto com mais de 16 minutos, quando nenhuma RPC a aceita mais); nenhuma selfie que virou prova volta a ser orfa.';
COMMENT ON FUNCTION public.ponto_sou_super_admin() IS 'A sessao e super admin do ponto? Exige sessao (sem auth.uid(): false). SECURITY INVOKER de proposito: a sessao le a propria linha pela policy, e sem a policy a resposta e false (falha fechada).';
COMMENT ON FUNCTION public.ponto_super_admins_exigir_ao_menos_um() IS 'Gatilho de comando de ponto_super_admins: recusa TRUNCATE sempre (BEFORE) e recusa o DELETE que deixaria a lista vazia (AFTER STATEMENT), que o gatilho de linha nao enxerga. So olha o DELETE que tirou alguem (tabela de transicao removidas): o DELETE vazio, como o que cascateia de auth.users ao apagar uma conta que nao e super admin, passa.';
COMMENT ON FUNCTION public.ponto_super_admins_guardar_regras() IS 'Gatilho de linha (BEFORE UPDATE OR DELETE) de ponto_super_admins: recusa remover o ultimo super admin e recusa repontar a linha para outra conta.';
COMMENT ON FUNCTION public.ponto_trilha_e_permanente() IS 'Recusa sempre. Ligado a UPDATE/DELETE/TRUNCATE de ponto_correcoes e ponto_registros_apagados e a TRUNCATE de ponto_registros: vale para qualquer papel, inclusive o dono e o service_role. Tambem e o que impede a FK ON DELETE CASCADE de levar a trilha junto com a batida.';
COMMENT ON FUNCTION public.ponto_vinculo_do_pedido_atraso() IS 'BEFORE INSERT OR UPDATE OF pedido_atraso_id em ponto_registros. INSERT com pedido_atraso_id so passa se o pedido foi aprovado nesta transacao, ainda sem batida, mesma pessoa, mesmo horario e mesma selfie (so a RPC de decisao faz isso). UPDATE congela a ligacao.';
COMMENT ON TABLE public.ponto_admins IS 'Quem administra o ponto (o super admin administra mesmo fora desta lista). Quem so administra entra no app e define o PIN, mas nao bate ponto.';
COMMENT ON COLUMN public.ponto_admins.concedido_por IS 'Quem concedeu. Nulo em concessao feita sem sessao (SQL direto ou backend). Sem FK de proposito: e trilha.';
COMMENT ON COLUMN public.ponto_admins.observacao IS 'Texto livre do motivo da concessao. Serve para a lista da tela explicar por que aquela pessoa esta ali.';
COMMENT ON COLUMN public.ponto_admins.usuario_id IS 'auth.users.id de quem administra. Chave primaria: uma pessoa aparece no maximo uma vez.';
COMMENT ON TABLE public.ponto_ausencias IS 'Faltas justificadas do ponto: pessoa, periodo de dias civis, tipo, observacao e o atestado no bucket ponto-atestados. Lancadas so por admin do ponto, com autor e momento carimbados pelo banco; depois de lancada, so o cancelamento logico (motivo, autor, momento) muda; nada se apaga. A pessoa le as proprias.';
COMMENT ON COLUMN public.ponto_ausencias.atestado_path IS 'Caminho no bucket ponto-atestados: {usuario_id}/{id}.{jpg|jpeg|png|webp|heic|pdf}. Conferido no lancamento: o objeto existe e o tipo do arquivo bate com a extensao. Nao se anexa depois.';
COMMENT ON TABLE public.ponto_configuracao IS 'Configuracao do sistema de ponto: dados da empresa (cabecalho da folha) e regras de jornada. LINHA UNICA, garantida por CHECK (id = 1). Numa instalacao nova a linha nao existe ate a primeira gravacao pela tela de administracao; ate la valem os padroes das colunas (o carimbo da batida usa 60 s de janela de duplicidade).';
COMMENT ON COLUMN public.ponto_configuracao.carga_diaria_minutos IS 'Jornada diaria esperada, em minutos (480 = 8h). Faixa aceita: 60 a 720. Hoje e guardada e mostrada na administracao; nada no banco nem no app calcula saldo, atraso ou hora extra com ela (fica como base para um calculo futuro).';
COMMENT ON COLUMN public.ponto_configuracao.cnpj IS 'Apenas os 14 digitos, sem mascara. Nulo enquanto ninguem preencher — inventar documento e pior que deixar vazio.';
COMMENT ON COLUMN public.ponto_configuracao.janela_duplicidade_segundos IS 'Janela em que uma segunda batida da mesma pessoa e recusada como duplicidade. Lida por ponto_carimbar_registro(). Faixa aceita: 10 a 900 — zero e recusado de proposito.';
COMMENT ON COLUMN public.ponto_configuracao.tolerancia_minutos IS 'Tolerancia diaria, em minutos. Faixa aceita: 0 a 60. Hoje e guardada e mostrada na administracao; nada no banco nem no app calcula atraso ou hora extra com ela (fica como base para um calculo futuro).';
COMMENT ON TABLE public.ponto_contas_trilha IS 'Trilha das acoes da Edge Function ponto-contas: quem (super admin), o que (acao), quando (feito_em, do banco), antes, depois e o resultado de cada passo (login, ficha). Nunca a senha (CHECK). Escrita so pelo service_role, nas colunas da funcao; lida pelo super admin; permanente (UPDATE, DELETE e TRUNCATE recusados por gatilho).';
COMMENT ON COLUMN public.ponto_contas_trilha.alvo_usuario_id IS 'auth.users.id da conta mexida. Sem FK de proposito: a trilha e prova e nao cai em cascata com a conta.';
COMMENT ON COLUMN public.ponto_contas_trilha.passos IS 'Lista de {passo: login|ficha, estado: feito|falhou|desfeito|nao_desfeito, nota?, erro?}: o estado exato de cada lugar depois da acao.';
COMMENT ON TABLE public.ponto_correcoes IS 'Trilha permanente de toda mudanca relevante em ponto_registros: as correcoes do admin (natureza admin) e as operacoes do sistema (natureza sistema). Escrita so pelo gatilho ponto_guardar_correcao; UPDATE, DELETE e TRUNCATE recusados por gatilho.';
COMMENT ON COLUMN public.ponto_correcoes.autor_id IS 'auth.uid() de quem corrigiu. Nulo em contexto de backend (service_role).';
COMMENT ON COLUMN public.ponto_correcoes.criado_em IS 'Momento da correcao, pelo relogio de INSTRUCAO (clock_timestamp), nao pelo da transacao. Duas correcoes no mesmo BEGIN/COMMIT precisam de carimbos distintos: a trilha da tela ordena por esta coluna, e empate em ORDER BY e ordem indefinida.';
COMMENT ON COLUMN public.ponto_correcoes.natureza IS 'admin = correcao com motivo_ajuste, que liga ajuste_manual na batida. sistema = operacao do banco aberta por ponto_abrir_operacao_do_sistema (reordenar o dia, recalcular o local): motivo vem do canal e a batida nao ganha ajuste_manual.';
COMMENT ON COLUMN public.ponto_correcoes.valores_antes IS 'Linha inteira do registro como estava antes da correção.';
COMMENT ON TABLE public.ponto_funcionarios IS 'Ficha do funcionario do PONTO: a identificacao que a folha assinada imprime e o nome que as telas mostram. O vinculo com a conta (usuario_id) e opcional: a pessoa pode ter folha antes de ter conta para bater ponto.';
COMMENT ON COLUMN public.ponto_funcionarios.ativo IS 'Ficha em uso. Desativar e como se desliga alguem aqui: a ficha NAO se apaga, porque e dela o nome completo que sai nas folhas ja assinadas. Nao existe policy de DELETE.';
COMMENT ON COLUMN public.ponto_funcionarios.bate_ponto_desde IS 'Data em que esta pessoa passou a bater ponto NESTE sistema, informada pelo RH. NULO = ainda nao informada. Hoje e guardada e mostrada (na ficha e na lista de pessoas: "bate ponto aqui desde ..."); nao libera nem bloqueia o ponto (quem libera e a ficha ativa ligada a conta), e nada no banco nem no app calcula falta ou horas previstas com ela. Fica como base para um calculo futuro, que nao deve acusar falta antes desta data.';
COMMENT ON COLUMN public.ponto_funcionarios.centro_custo IS 'Centro de custo, para o cabecalho da folha impressa. Opcional: nulo quando a empresa nao usa.';
COMMENT ON COLUMN public.ponto_funcionarios.cpf IS 'Apenas os 11 digitos, sem mascara. Nulo enquanto ninguem preencher — inventar documento e pior que deixar vazio. Unico entre as fichas ATIVAS.';
COMMENT ON COLUMN public.ponto_funcionarios.ctps IS 'Numero da CTPS, para o cabecalho da folha impressa. Opcional: nulo quando nao informado, nunca com texto de exemplo.';
COMMENT ON COLUMN public.ponto_funcionarios.matricula IS 'Codigo do funcionario na empresa (matricula), para o cabecalho da folha impressa. Opcional: nulo quando a empresa nao usa.';
COMMENT ON COLUMN public.ponto_funcionarios.usuario_id IS 'auth.users.id de quem bate ponto por esta ficha. NULO = a pessoa e funcionaria, tem folha, e ainda nao tem conta para bater ponto. Unico onde nao e nulo: duas fichas na mesma conta emitiriam duas folhas para a mesma jornada.';
COMMENT ON TABLE public.ponto_local IS 'Locais reconhecidos do ponto. No máximo um ativo por vez.';
COMMENT ON COLUMN public.ponto_local.latitude IS 'Latitude do local, em graus decimais (-90 a 90): a referencia da distancia de cada batida. Gravada pela tela de administracao, de preferencia medida de dentro do local (ver medido_por e medido_em).';
COMMENT ON COLUMN public.ponto_local.medido_em IS 'Quando a coordenada ou o raio foram gravados pela ultima vez (now() da transacao, carimbado pelo gatilho). Nulo = nunca medido. Diferente de atualizado_em, que muda tambem quando so o nome muda.';
COMMENT ON COLUMN public.ponto_local.medido_por IS 'Quem gravou a coordenada ou o raio pela ultima vez: auth.uid() da sessao, carimbado pelo gatilho ponto_local_carimbar_medicao (o cliente nao escolhe). Nulo = gravado sem sessao (SQL direto ou backend), e nao uma medicao feita no local.';
COMMENT ON COLUMN public.ponto_local.nome IS 'Nome do local como o funcionario le no comprovante. Nao guarda recado de desenvolvedor.';
COMMENT ON COLUMN public.ponto_local.raio_metros IS 'Raio em metros. Ponto exatamente na borda conta como DENTRO.';
COMMENT ON TABLE public.ponto_pedidos_atraso IS 'Pedidos de batida em atraso. O colaborador pede pela RPC ponto_pedir_batida_em_atraso, com horario declarado, motivo, selfie, PIN e coordenada (ou sem localizacao, quando o GPS nao respondeu); o admin decide por ponto_decidir_pedido_atraso. So o aprovado vira batida (registro_id). Pedido pendente nao aparece em nenhuma leitura de ponto_registros. Nada se apaga: DELETE/TRUNCATE recusados por gatilho para qualquer papel.';
COMMENT ON COLUMN public.ponto_pedidos_atraso.distancia_metros IS 'Distancia ao local ativo NO MOMENTO DO PEDIDO (mesma conta do carimbo). A batida aprovada tem a sua, calculada pelo carimbo na aprovacao.';
COMMENT ON COLUMN public.ponto_pedidos_atraso.horario_declarado IS 'O horario que o colaborador diz ter chegado/saido, truncado ao minuto. Mesmo dia civil (America/Sao_Paulo) do pedido e anterior a ele.';
COMMENT ON COLUMN public.ponto_pedidos_atraso.latitude IS 'Coordenada do aparelho no momento do pedido. Nula (com a longitude) = pedido sem localizacao: o GPS nao respondeu (p_sem_localizacao indisponivel ou demora); a batida aprovada sai sem localizacao tambem.';
COMMENT ON COLUMN public.ponto_pedidos_atraso.pedido_em IS 'Horario REAL do pedido, carimbado pelo servidor (now()). Nunca vem do aparelho.';
COMMENT ON COLUMN public.ponto_pedidos_atraso.registro_id IS 'A batida criada na aprovacao. Nasce na mesma transacao da decisao; pedido aprovado sem batida nao chega a existir.';
COMMENT ON TABLE public.ponto_pin IS 'Guarda do PIN de 4 dígitos. Só hash bcrypt, nunca o valor. Deny-all: acesso só pelas funções ponto_definir_pin / ponto_verificar_pin / ponto_pin_status.';
COMMENT ON COLUMN public.ponto_pin.precisa_redefinir IS 'Ligado pelo reset do admin. Enquanto verdadeiro, o app obriga a definir PIN novo.';
COMMENT ON COLUMN public.ponto_pin.bloqueios_no_dia IS 'Quantos bloqueios por PIN errado esta conta teve no dia de ultimo_bloqueio_em (America/Sao_Paulo). Decide o castigo do proximo: 15 minutos no primeiro do dia, 1 hora no segundo, 24 horas do terceiro em diante. Zerado pelo reset do PIN e pelo PIN novo; o acerto nao o zera.';
COMMENT ON COLUMN public.ponto_pin.ultimo_bloqueio_em IS 'Quando a conta foi bloqueada pela ultima vez (now() do erro que trancou). Bloqueio de outro dia nao conta para o castigo de hoje.';
COMMENT ON TABLE public.ponto_pin_tentativas IS 'Tentativas de PIN por conta. Sustenta o bloqueio temporário e serve de trilha.';
COMMENT ON TABLE public.ponto_registros IS 'Batidas de ponto. Imutáveis para o funcionário; só admin corrige, e toda correção vira linha em ponto_correcoes.';
COMMENT ON COLUMN public.ponto_registros.dia_civil IS 'Dia civil em America/Sao_Paulo, não UTC. É ele que agrupa o dia e deduz o tipo.';
COMMENT ON COLUMN public.ponto_registros.distancia_metros IS 'Distância até o local ativo no momento da batida. Congelada: mudar ponto_local depois não reescreve isto.';
COMMENT ON COLUMN public.ponto_registros.funcionario_nome IS 'Fotografia do nome no momento da batida (ficha, depois o nome guardado na conta, depois o e-mail), para o registro continuar legivel mesmo que a conta mude. Nome antigo gravado e prova: nao se corrige.';
COMMENT ON COLUMN public.ponto_registros.latitude IS 'Coordenada do aparelho na batida. Nula (com a longitude) numa batida de origem app, ou nascida de pedido aprovado, = batida SEM LOCALIZACAO: o GPS nao respondeu (p_sem_localizacao indisponivel ou demora), e o painel, o espelho, a folha e o CSV a marcam assim. Nula numa insercao do admin = batida lancada a mao.';
COMMENT ON COLUMN public.ponto_registros.no_local IS 'distancia_metros <= raio do local. Borda conta como DENTRO. Nulo quando não há coordenada.';
COMMENT ON COLUMN public.ponto_registros.ordem_no_dia IS 'Quantidade de batidas do dia no instante da gravação, + 1. Explica o tipo; não é um ranking recalculável se o admin inserir batida fora de ordem.';
COMMENT ON COLUMN public.ponto_registros.pedido_atraso_id IS 'O pedido de batida em atraso de que esta batida nasceu (aprovado por ponto_decidir_pedido_atraso). NULL para toda batida do app e do admin. So nasce na aprovacao e nao muda depois.';
COMMENT ON COLUMN public.ponto_registros.precisao_metros IS 'Precisão que o aparelho informou (accuracy do GPS), em metros. Nulo é aceito.';
COMMENT ON COLUMN public.ponto_registros.registrado_em IS 'Horário do SERVIDOR. Cliente comum nunca decide este valor.';
COMMENT ON TABLE public.ponto_registros_apagados IS 'Batidas que o backend apagou de ponto_registros, com a linha inteira, o motivo (canal do sistema) e o papel. Escrita so pelo gatilho ponto_guardar_apagamento; permanente (UPDATE, DELETE e TRUNCATE recusados por gatilho). Sessao de usuario nunca apaga batida.';
COMMENT ON TABLE public.ponto_super_admins IS 'Super admins do ponto: o unico papel que concede e revoga a administracao do ponto (ponto_admins), libera acesso pela ficha e mexe em contas. Tambem administra. Nao e alteravel pela API (nem pelo service_role, que so le): so por SQL do dono do banco (postgres), numa migration ou no editor SQL. Depois do primeiro, nao fica vazia: o banco recusa tirar o ultimo.';
COMMENT ON COLUMN public.ponto_super_admins.observacao IS 'Por que esta conta e super admin. Texto livre, escrito por quem a pos aqui.';
COMMENT ON COLUMN public.ponto_super_admins.usuario_id IS 'auth.users.id do super admin. FK ON DELETE CASCADE como ponto_admins: e concessao viva. Excluir a conta do ULTIMO super admin e recusado pelo gatilho.';
COMMENT ON FUNCTION public.ponto_pode_bater() IS 'A sessao pode bater ponto e pedir batida em atraso? Ficha que libera acesso OU super admin. Exige sessao (sem auth.uid(): false). Usada por ponto_registrar_batida, ponto_pedir_batida_em_atraso e ponto_meu_acesso; o app nao a chama.';
COMMENT ON FUNCTION public.ponto_nome_da_conta(p_usuario_id uuid) IS 'O nome de exibicao de uma conta — ficha ligada, depois o nome guardado na conta pela funcao de contas (app_metadata.full_name, que so a chave de servico grava; o user_metadata, que a pessoa edita, nao entra), depois o e-mail. Grava a fotografia do nome na batida e no pedido de atraso e responde o nome em ponto_meu_acesso. Interna: o app nao a chama.';
COMMENT ON FUNCTION public.ponto_contas() IS 'As contas do ponto (usuario_id, email, nome = app_metadata.full_name, guardado pela funcao de contas e nunca o user_metadata que a pessoa edita, criado_em, ultimo_login), so para quem administra (ponto_pode_administrar; os outros recebem 42501). E por ela, e nao por auth.users, que o app le as contas.';

-- 8. Gatilhos. Entre os gatilhos de uma tabela que disparam no mesmo momento
--    (BEFORE ou AFTER, por linha ou por comando), o PostgreSQL roda na ordem
--    alfabética do nome. É ela que põe a anotação do papel
--    (trg_ponto_anotar_papel_do_comando) antes do carimbo, da trilha e do
--    apagamento, a trilha (trg_ponto_guardar_correcao) antes da guarda do motivo
--    (trg_ponto_guardar_motivo_e_marca) e o carimbo antes da trava de futuro
--    (trg_ponto_trava_de_futuro): os nomes fazem parte do desenho.
CREATE TRIGGER trg_ponto_admins_carimbar_concessao BEFORE INSERT OR UPDATE ON public.ponto_admins FOR EACH ROW EXECUTE FUNCTION public.ponto_admins_carimbar_concessao();
CREATE TRIGGER trg_ponto_admins_exigir_ao_menos_um AFTER DELETE ON public.ponto_admins REFERENCING OLD TABLE AS removidas FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_admins_exigir_ao_menos_um();
CREATE TRIGGER trg_ponto_admins_guardar_regras BEFORE DELETE OR UPDATE ON public.ponto_admins FOR EACH ROW EXECUTE FUNCTION public.ponto_admins_guardar_regras();
CREATE TRIGGER trg_ponto_admins_nao_esvazia BEFORE TRUNCATE ON public.ponto_admins FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_admins_exigir_ao_menos_um();
CREATE TRIGGER trg_ponto_anotar_papel_do_comando BEFORE INSERT OR DELETE OR UPDATE ON public.ponto_registros FOR EACH ROW EXECUTE FUNCTION public.ponto_anotar_papel_do_comando();
CREATE TRIGGER trg_ponto_ausencias_guardar BEFORE INSERT OR UPDATE ON public.ponto_ausencias FOR EACH ROW EXECUTE FUNCTION public.ponto_ausencias_guardar();
CREATE TRIGGER trg_ponto_ausencias_nao_esvazia BEFORE TRUNCATE ON public.ponto_ausencias FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_ausencias_nao_se_apagam();
CREATE TRIGGER trg_ponto_ausencias_nao_se_apagam BEFORE DELETE ON public.ponto_ausencias FOR EACH ROW EXECUTE FUNCTION public.ponto_ausencias_nao_se_apagam();
CREATE TRIGGER trg_ponto_carimbar_registro BEFORE INSERT ON public.ponto_registros FOR EACH ROW EXECUTE FUNCTION public.ponto_carimbar_registro();
CREATE TRIGGER trg_ponto_configuracao_atualizado_em BEFORE UPDATE ON public.ponto_configuracao FOR EACH ROW EXECUTE FUNCTION public.ponto_tocar_atualizado_em();
CREATE TRIGGER trg_ponto_configuracao_normalizar BEFORE INSERT OR UPDATE ON public.ponto_configuracao FOR EACH ROW EXECUTE FUNCTION public.ponto_configuracao_normalizar();
CREATE TRIGGER trg_ponto_congelar_pedido_atraso BEFORE INSERT OR UPDATE OF pedido_atraso_id ON public.ponto_registros FOR EACH ROW EXECUTE FUNCTION public.ponto_vinculo_do_pedido_atraso();
CREATE TRIGGER trg_ponto_contas_trilha_carimbar BEFORE INSERT ON public.ponto_contas_trilha FOR EACH ROW EXECUTE FUNCTION public.ponto_contas_trilha_carimbar();
CREATE TRIGGER trg_ponto_contas_trilha_nao_esvazia BEFORE TRUNCATE ON public.ponto_contas_trilha FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_trilha_e_permanente();
CREATE TRIGGER trg_ponto_contas_trilha_permanente BEFORE DELETE OR UPDATE ON public.ponto_contas_trilha FOR EACH ROW EXECUTE FUNCTION public.ponto_trilha_e_permanente();
CREATE TRIGGER trg_ponto_correcoes_nao_esvazia BEFORE TRUNCATE ON public.ponto_correcoes FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_trilha_e_permanente();
CREATE TRIGGER trg_ponto_correcoes_permanente BEFORE DELETE OR UPDATE ON public.ponto_correcoes FOR EACH ROW EXECUTE FUNCTION public.ponto_trilha_e_permanente();
CREATE TRIGGER trg_ponto_funcionarios_acesso_pelo_super_admin BEFORE INSERT OR UPDATE ON public.ponto_funcionarios FOR EACH ROW EXECUTE FUNCTION public.ponto_funcionarios_acesso_pelo_super_admin();
CREATE TRIGGER trg_ponto_funcionarios_atualizado_em BEFORE UPDATE ON public.ponto_funcionarios FOR EACH ROW EXECUTE FUNCTION public.ponto_tocar_atualizado_em();
CREATE TRIGGER trg_ponto_funcionarios_normalizar BEFORE INSERT OR UPDATE ON public.ponto_funcionarios FOR EACH ROW EXECUTE FUNCTION public.ponto_funcionarios_normalizar();
CREATE TRIGGER trg_ponto_guardar_apagamento BEFORE DELETE ON public.ponto_registros FOR EACH ROW EXECUTE FUNCTION public.ponto_guardar_apagamento();
CREATE TRIGGER trg_ponto_guardar_correcao BEFORE UPDATE ON public.ponto_registros FOR EACH ROW EXECUTE FUNCTION public.ponto_guardar_correcao();
CREATE TRIGGER trg_ponto_guardar_motivo_e_marca BEFORE UPDATE OF motivo_ajuste, ajuste_manual ON public.ponto_registros FOR EACH ROW EXECUTE FUNCTION public.ponto_motivo_e_marca_so_com_correcao();
CREATE TRIGGER trg_ponto_local_atualizado_em BEFORE UPDATE ON public.ponto_local FOR EACH ROW EXECUTE FUNCTION public.ponto_tocar_atualizado_em();
CREATE TRIGGER trg_ponto_local_carimbar_medicao BEFORE INSERT OR UPDATE ON public.ponto_local FOR EACH ROW EXECUTE FUNCTION public.ponto_local_carimbar_medicao();
CREATE TRIGGER trg_ponto_local_em_uso_nao_sai BEFORE DELETE ON public.ponto_local FOR EACH ROW EXECUTE FUNCTION public.ponto_local_em_uso_nao_sai();
CREATE CONSTRAINT TRIGGER trg_ponto_pedido_atraso_aprovado_tem_batida AFTER INSERT OR UPDATE ON public.ponto_pedidos_atraso DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ponto_pedido_atraso_aprovado_tem_batida();
CREATE TRIGGER trg_ponto_pedido_atraso_guardar BEFORE DELETE OR UPDATE ON public.ponto_pedidos_atraso FOR EACH ROW EXECUTE FUNCTION public.ponto_pedido_atraso_guardar();
CREATE TRIGGER trg_ponto_pedido_atraso_nao_esvazia BEFORE TRUNCATE ON public.ponto_pedidos_atraso FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_pedido_atraso_guardar();
CREATE TRIGGER trg_ponto_registros_apagados_nao_esvazia BEFORE TRUNCATE ON public.ponto_registros_apagados FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_trilha_e_permanente();
CREATE TRIGGER trg_ponto_registros_apagados_permanente BEFORE DELETE OR UPDATE ON public.ponto_registros_apagados FOR EACH ROW EXECUTE FUNCTION public.ponto_trilha_e_permanente();
CREATE TRIGGER trg_ponto_registros_nao_esvazia BEFORE TRUNCATE ON public.ponto_registros FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_trilha_e_permanente();
CREATE TRIGGER trg_ponto_reordenar_dia_apos_correcao AFTER UPDATE OF registrado_em, dia_civil ON public.ponto_registros FOR EACH ROW WHEN (((old.registrado_em IS DISTINCT FROM new.registrado_em) OR (old.dia_civil IS DISTINCT FROM new.dia_civil))) EXECUTE FUNCTION public.ponto_reordenar_dia_apos_mudanca();
CREATE TRIGGER trg_ponto_reordenar_dia_apos_insercao AFTER INSERT ON public.ponto_registros FOR EACH ROW EXECUTE FUNCTION public.ponto_reordenar_dia_apos_mudanca();
CREATE TRIGGER trg_ponto_super_admins_exigir_ao_menos_um AFTER DELETE ON public.ponto_super_admins REFERENCING OLD TABLE AS removidas FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_super_admins_exigir_ao_menos_um();
CREATE TRIGGER trg_ponto_super_admins_guardar_regras BEFORE DELETE OR UPDATE ON public.ponto_super_admins FOR EACH ROW EXECUTE FUNCTION public.ponto_super_admins_guardar_regras();
CREATE TRIGGER trg_ponto_super_admins_nao_esvazia BEFORE TRUNCATE ON public.ponto_super_admins FOR EACH STATEMENT EXECUTE FUNCTION public.ponto_super_admins_exigir_ao_menos_um();

-- 9. A trava de futuro: batida com horário no futuro é recusada, na inserção e
--    na correção que muda o horário. Ela mora num gatilho próprio, e não no
--    carimbo, porque vale também para o horário que quem administra digita (o
--    carimbo já garante o horário do servidor para quem bate pelo app).
CREATE FUNCTION public.ponto_recusar_horario_no_futuro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Relógio do computador de quem administra um pouco à frente do servidor:
  -- até 1 minuto ainda é "agora".
  c_tolerancia constant interval := interval '1 minute';
BEGIN
  -- Correção que não mexe no horário (a reordenação nem chega aqui, porque o
  -- gatilho é UPDATE OF registrado_em; um UPDATE que repete o mesmo horário
  -- chega, e passa).
  IF TG_OP = 'UPDATE' AND NEW.registrado_em IS NOT DISTINCT FROM OLD.registrado_em THEN
    RETURN NEW;
  END IF;

  IF NEW.registrado_em > now() + c_tolerancia THEN
    -- Legível sem tradução: o app em cache mostra este texto como veio.
    RAISE EXCEPTION 'Horário no futuro: a batida precisa ser de agora ou de antes, e chegou com % (horário de Brasília). Confira a data e a hora.',
      to_char(NEW.registrado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_recusar_horario_no_futuro() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_recusar_horario_no_futuro() TO service_role;
COMMENT ON FUNCTION public.ponto_recusar_horario_no_futuro() IS
  'Recusa batida com horario no futuro (mais de 1 minuto a frente do servidor), na insercao e na correcao que muda o horario. Gatilho trg_ponto_trava_de_futuro, separado do carimbo; a reordenacao do dia nao passa por aqui. Mensagem legivel porque um app em cache, de versao anterior, nao a traduz.';

-- O nome o põe depois de todos os BEFORE da tabela (ordem alfabética): quando
-- ele roda, o carimbo já decidiu o horário.
CREATE TRIGGER trg_ponto_trava_de_futuro
  BEFORE INSERT OR UPDATE OF registrado_em ON public.ponto_registros
  FOR EACH ROW EXECUTE FUNCTION public.ponto_recusar_horario_no_futuro();
COMMENT ON TRIGGER trg_ponto_trava_de_futuro ON public.ponto_registros IS
  'Batida com horario no futuro e recusada. Roda depois de todos os BEFORE da tabela (ordem alfabetica do nome), quando o carimbo ja decidiu o horario, e so quando o horario e gravado ou muda de fato.';

-- 10. Regras de acesso (RLS) das tabelas: 27, todas só para `authenticated`
--     (anon não tem nenhuma). Quem administra é decidido pelas funções de
--     papel (ponto_pode_administrar, ponto_sou_super_admin), nunca pelo app.
CREATE POLICY "Ponto: admin le a lista de administradores" ON public.ponto_admins AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: super admin concede administracao" ON public.ponto_admins AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_sou_super_admin()));
CREATE POLICY "Ponto: super admin edita a concessao" ON public.ponto_admins AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_sou_super_admin()))
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_sou_super_admin()));
CREATE POLICY "Ponto: super admin revoga administracao" ON public.ponto_admins AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_sou_super_admin()));
CREATE POLICY "Ponto: admin ou dono le ausencia" ON public.ponto_ausencias AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (ponto_pode_administrar() OR ((usuario_id = auth.uid()) AND ponto_ator_aprovado()))));
CREATE POLICY "Ponto: so admin cancela ausencia" ON public.ponto_ausencias AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()))
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: so admin lanca ausencia" ON public.ponto_ausencias AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: admin cria a configuracao" ON public.ponto_configuracao AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: admin edita a configuracao" ON public.ponto_configuracao AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()))
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
-- A configuração (razão social, CNPJ, endereço) e o local (coordenada e raio)
-- são de quem tem acesso ao ponto (ponto_ator_aprovado: ficha que libera ou
-- quem administra). A conta que entrou sem ficha e sem papel cai na tela "sem
-- acesso", que não lê nenhum dos dois; a batida e o carimbo leem o local por
-- dentro das funções DEFINER.
CREATE POLICY "Ponto: quem tem acesso le a configuracao" ON public.ponto_configuracao AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_ator_aprovado()));
CREATE POLICY "Ponto: super admin le a trilha de contas" ON public.ponto_contas_trilha AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_sou_super_admin()));
CREATE POLICY "Ponto: admin ou dono le as correcoes" ON public.ponto_correcoes AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (ponto_pode_administrar() OR ((usuario_id = auth.uid()) AND ponto_ator_aprovado()))));
CREATE POLICY "Ponto: admin cria ficha" ON public.ponto_funcionarios AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: admin edita ficha" ON public.ponto_funcionarios AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()))
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: admin le todas as fichas" ON public.ponto_funcionarios AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: cada um le a propria ficha" ON public.ponto_funcionarios AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (usuario_id = auth.uid())));
CREATE POLICY "Ponto: admin cadastra local" ON public.ponto_local AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: admin edita local" ON public.ponto_local AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()))
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: admin remove local" ON public.ponto_local AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: quem tem acesso le o local" ON public.ponto_local AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_ator_aprovado()));
CREATE POLICY "Ponto: dono ou admin le o pedido de atraso" ON public.ponto_pedidos_atraso AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (ponto_pode_administrar() OR ((usuario_id = auth.uid()) AND ponto_ator_aprovado()))));
CREATE POLICY "Ponto: funcionario le os proprios registros" ON public.ponto_registros AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (ponto_pode_administrar() OR ((usuario_id = auth.uid()) AND ponto_ator_aprovado()))));
CREATE POLICY "Ponto: so admin altera registro" ON public.ponto_registros AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()))
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: so admin insere registro direto" ON public.ponto_registros AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: admin le as batidas apagadas" ON public.ponto_registros_apagados AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));
CREATE POLICY "Ponto: cada um ve se e super admin" ON public.ponto_super_admins AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (usuario_id = auth.uid())));
CREATE POLICY "Ponto: quem administra le os super admins" ON public.ponto_super_admins AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ponto_pode_administrar()));

-- 11. Os dois buckets privados. Selfie até 3 MB, só imagem (a câmera do app
--     manda JPEG); atestado até 10 MB, imagem ou PDF (o heic é a foto do
--     iPhone). Privados: toda leitura passa pelas regras de storage.objects.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('ponto-selfies', 'ponto-selfies', false, 3145728, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('ponto-atestados', 'ponto-atestados', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);

-- 12. As 6 regras de storage.objects do ponto. Toda regra filtra pelo bucket
--     (as regras de storage.objects valem para todos os buckets do projeto);
--     quem não administra só alcança a própria pasta (o primeiro nível do
--     caminho é o usuario_id); a selfie sobe só no caminho da convenção e
--     dentro do teto (ponto_selfie_pode_subir); nenhuma selfie que virou
--     prova pode ser apagada (ponto_selfie_sem_batida); e ninguém apaga a
--     selfie com menos de 16 minutos. As RPCs da batida e do pedido aceitam a
--     foto por 15 minutos e só a ligam no COMMIT: até lá, ela parece solta, e
--     um DELETE no meio apagaria a prova de uma batida que está sendo gravada.
--     Com 16 minutos, nenhuma RPC aceita mais a foto, e o minuto de folga
--     cobre com sobra o tempo máximo de um comando do app (8 segundos no
--     Supabase). A limpeza da foto que não virou batida, logo depois da
--     recusa, deixa de apagar: a foto fica no bucket (só ocupa espaço, não
--     vira ponto de ninguém), e quem quiser limpa as soltas mais velhas.
CREATE POLICY "Ponto: admin ou dono le atestado" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'ponto-atestados'::text) AND (auth.uid() IS NOT NULL) AND (ponto_pode_administrar() OR (((storage.foldername(name))[1] = (auth.uid())::text) AND ponto_ator_aprovado()))));
CREATE POLICY "Ponto: admin sobe atestado" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'ponto-atestados'::text) AND (auth.uid() IS NOT NULL) AND ponto_pode_administrar() AND (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|pdf)$'::text)));
CREATE POLICY "Ponto: dono descarta selfie sem batida" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'ponto-selfies'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND ponto_ator_aprovado() AND (created_at < (now() - '00:16:00'::interval)) AND ponto_selfie_sem_batida(name)));
CREATE POLICY "Ponto: dono ou admin le a selfie" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (bucket_id = 'ponto-selfies'::text) AND (ponto_pode_administrar() OR (((storage.foldername(name))[1] = (auth.uid())::text) AND ponto_ator_aprovado()))));
CREATE POLICY "Ponto: funcionario sobe a propria selfie" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'ponto-selfies'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND ponto_ator_aprovado() AND ponto_selfie_pode_subir(bucket_id, name)));
CREATE POLICY "Ponto: so admin apaga selfie" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (bucket_id = 'ponto-selfies'::text) AND ponto_pode_administrar() AND (created_at < (now() - '00:16:00'::interval)) AND ponto_selfie_sem_batida(name)));

-- 13. Os privilégios padrão do que o postgres criar DEPOIS. O padrão do
--     Supabase dá a anon e a authenticated tudo (TRUNCATE incluído) em toda
--     tabela, sequência e função nova em public, e o PostgreSQL dá EXECUTE a
--     PUBLIC em toda função nova; a tabela nova ainda nasce sem RLS. Uma
--     migration de quem estender o ponto que esquecesse o REVOKE abriria a
--     tabela para a internet pela chave pública. Daqui em diante, o que o
--     postgres criar em public nasce sem nada para anon, authenticated e
--     PUBLIC: quem estender concede o que o app usar com GRANT explícito (como
--     cada peça deste arquivo faz) e liga a RLS na tabela nova. O service_role
--     (o backend) continua com o padrão.
--     O EXECUTE de PUBLIC é um padrão GLOBAL do PostgreSQL e não se tira por
--     esquema: a quarta linha vale para as funções que o postgres criar em
--     qualquer esquema. É mais um motivo para o projeto do Supabase ser só do
--     ponto. O que outro papel cria (os papéis internos dos serviços do
--     Supabase) segue o padrão dele.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 14. Fim: a conferência do que nasceu. Só lê; se algo não bater, a migration
--     inteira volta atrás. Depois, o aviso ao PostgREST para reler o esquema
--     (só chega se a transação for confirmada).
DO $fim$
DECLARE
  v_tabelas  int;
  v_funcoes  int;
  v_gatilhos int;
  v_regras   int;
  v_buckets  int;
  v_txt      text;
  v_check    text;
  v_caso     record;
BEGIN
  -- 14a. As contagens. Mudou a estrutura, mudam os números aqui (e no
  --      cabeçalho; o teste estático do banco confere os três).
  SELECT count(*) INTO v_tabelas FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'ponto%';
  SELECT count(*) INTO v_funcoes FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ponto%';
  SELECT count(*) INTO v_gatilhos FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'ponto%' AND NOT t.tgisinternal;
  SELECT count(*) INTO v_regras FROM pg_policies p
  WHERE (p.schemaname = 'public' AND p.tablename LIKE 'ponto%') OR (p.schemaname = 'storage' AND p.policyname LIKE 'Ponto:%');
  SELECT count(*) INTO v_buckets FROM storage.buckets b WHERE b.id IN ('ponto-selfies', 'ponto-atestados');

  IF (v_tabelas, v_funcoes, v_gatilhos, v_regras, v_buckets) <> (13, 50, 38, 33, 2) THEN
    RAISE EXCEPTION 'Estrutura do ponto desfeita: nasceram % tabelas, % funcoes, % gatilhos, % regras e % buckets (esperado 13, 50, 38, 33 e 2).',
      v_tabelas, v_funcoes, v_gatilhos, v_regras, v_buckets
      USING ERRCODE = '23514';
  END IF;

  -- 14b. RLS ligada em toda tabela do ponto: sem ela, as regras de acesso não
  --      valem, e o privilégio de tabela vira acesso a todas as linhas.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_txt
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'ponto%'
    AND NOT c.relrowsecurity;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Estrutura do ponto desfeita: tabela do ponto sem RLS (%).', v_txt
      USING ERRCODE = '42501';
  END IF;

  -- 14c. anon sem nada: nenhuma tabela, coluna, sequência ou função do ponto.
  --      has_*_privilege olha também o que vem de PUBLIC.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_txt
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'ponto%'
    AND ((c.relkind = 'r'
          AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
               OR has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')))
      OR (c.relkind = 'S' AND has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Estrutura do ponto desfeita: anon tem privilegio em %.', v_txt
      USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_txt
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ponto%'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Estrutura do ponto desfeita: anon executa %.', v_txt
      USING ERRCODE = '42501';
  END IF;

  -- 14d. O CHECK sem senha da trilha de contas. A constraint é achada pelo
  --      NOME, e não por qualquer CHECK da tabela, e tem de passar a função
  --      nas três colunas JSON; a função tem de achar a chave de senha no
  --      topo, escondida num nível de baixo e sem diferenciar maiúsculas. Sem
  --      gravar linha nenhuma: o gatilho da trilha exige um super admin como
  --      autor, e numa instalação nova ainda não há nenhum (a recusa da linha
  --      inteira é provada nos testes do banco).
  SELECT pg_get_constraintdef(c.oid) INTO v_check
  FROM pg_constraint c
  WHERE c.conrelid = 'public.ponto_contas_trilha'::regclass
    AND c.conname = 'ponto_contas_trilha_sem_senha'
    AND c.contype = 'c';
  IF v_check IS NULL
     OR v_check NOT LIKE '%ponto_contas_tem_chave_de_senha(antes)%'
     OR v_check NOT LIKE '%ponto_contas_tem_chave_de_senha(depois)%'
     OR v_check NOT LIKE '%ponto_contas_tem_chave_de_senha(passos)%' THEN
    RAISE EXCEPTION 'Estrutura do ponto desfeita: o CHECK ponto_contas_trilha_sem_senha nao confere antes, depois e passos.'
      USING ERRCODE = '23514';
  END IF;
  FOR v_caso IN
    SELECT * FROM (VALUES
      ('senha no topo do JSON',                  '{"senha": "x"}'::jsonb),
      ('password escondida dentro de passos',    '[{"passo": "login", "dados": {"password": "x"}}]'::jsonb),
      ('senhaProvisoria em camelCase',           '{"login": {"senhaProvisoria": "x"}}'::jsonb),
      ('SENHA_PROVISORIA em maiusculas',         '{"login": {"SENHA_PROVISORIA": "x"}}'::jsonb),
      ('Nova_Senha numa lista dentro de passos', '[{"passo": "login", "lista": [{"Nova_Senha": "x"}]}]'::jsonb)
    ) AS c(nome, valor)
  LOOP
    IF NOT public.ponto_contas_tem_chave_de_senha(v_caso.valor) THEN
      RAISE EXCEPTION 'Estrutura do ponto desfeita: o CHECK sem senha da trilha de contas deixaria passar %.', v_caso.nome
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  -- E não recusa demais: uma linha comum, sem chave de senha, passa.
  IF public.ponto_contas_tem_chave_de_senha('{"login": {"email": "a@example.com", "nome": "Senhorinha"}, "senhas_trocadas": 1}'::jsonb) THEN
    RAISE EXCEPTION 'Estrutura do ponto desfeita: o CHECK sem senha da trilha de contas recusaria JSON sem chave de senha.'
      USING ERRCODE = '23514';
  END IF;

  -- 14e. Os privilégios padrão do item 13: o que o postgres criar depois não
  --      dá nada a anon, authenticated nem PUBLIC. Sem a linha global de
  --      funções, o EXECUTE de PUBLIC do PostgreSQL continuaria valendo.
  SELECT string_agg(DISTINCT d.defaclobjtype::text || ':'
                    || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ', ') INTO v_txt
  FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclrole = 'postgres'::regrole
    AND (d.defaclnamespace = 'public'::regnamespace OR d.defaclnamespace = 0)
    AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole));
  IF v_txt IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM pg_default_acl d
                    WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f') THEN
    RAISE EXCEPTION 'Estrutura do ponto desfeita: os privilegios padrao do postgres ainda dao % no que nascer depois.',
      coalesce(v_txt, 'f:PUBLIC (o EXECUTE global do PostgreSQL)')
      USING ERRCODE = '42501';
  END IF;

  RAISE NOTICE 'Estrutura do ponto: % tabelas, % funcoes, % gatilhos, % regras e % buckets.',
    v_tabelas, v_funcoes, v_gatilhos, v_regras, v_buckets;
END $fim$;

NOTIFY pgrst, 'reload schema';
