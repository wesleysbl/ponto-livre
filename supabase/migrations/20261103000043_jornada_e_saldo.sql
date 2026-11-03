-- PONTO LIVRE: A JORNADA, O INÍCIO DO SALDO E A TRAVA DA PRÓPRIA FICHA
--
-- A segunda migration do ponto, aplicada depois da estrutura
-- (`..._ponto_livre_estrutura.sql`, que nunca é editada). Ela guarda o que o
-- saldo de horas precisa para ser calculado: a jornada da empresa, a jornada
-- própria de quem tem uma, e o dia a partir do qual o saldo é cobrado. E
-- estende ao cadastro a regra que o ponto já aplica à batida: quem é dono da
-- ficha não decide a própria jornada nem a data em que passou a bater ponto.
-- Cria 5 funções, 3 gatilhos, 3 restrições e 3 colunas; nenhuma tabela, regra
-- de acesso nem privilégio de tabela.
--
-- COMO APLICAR: como a estrutura (`npx supabase db push` no Supabase
-- hospedado; `npm run db:zerar` no local), ANTES de publicar o app que lê as
-- colunas novas. Roda como `postgres`, sem superusuário, na transação que o CLI
-- abre: o primeiro erro, ou a conferência do fim que não bate, desfaz tudo.
--
-- O QUE MUDA
--   • `ponto_configuracao.jornada` (jsonb, obrigatória): a jornada da EMPRESA,
--     por dia da semana, com até dois blocos por dia. A linha que nasce depois
--     desta migration (pela tela) vem com a semente: segunda a sexta, das 08:00
--     às 12:00 e das 13:00 às 17:00, 8 h por dia; sábado e domingo sem jornada.
--   • `ponto_funcionarios.jornada` (jsonb, nula): a jornada PRÓPRIA da pessoa,
--     no mesmo formato. Nula = segue a da empresa (é o caso de todo mundo
--     depois da atualização).
--   • `ponto_configuracao.saldo_a_partir_de` (date, obrigatória): o primeiro dia
--     em que o saldo é cobrado. O saldo de cada pessoa começa na mais nova
--     entre esta data e a da ficha ("Passou a bater ponto aqui em"); a linha
--     nasce com o dia de Brasília em que nasce.
--   • `ponto_configuracao.carga_diaria_minutos` deixa de ser digitada: o banco
--     a calcula da jornada da empresa (o maior total de um dia). A coluna fica,
--     com o mesmo nome e a mesma faixa, porque o app guardado no celular de
--     alguém ainda a lê e a manda.
--
-- O FORMATO (o mesmo nas duas colunas de jornada): uma lista de blocos,
--   [{"dia": 1, "inicio": "08:00", "fim": "12:00"},
--    {"dia": 1, "inicio": "13:00", "fim": "17:00"}, ...]
-- com `dia` de 1 (segunda) a 7 (domingo), como o `isodow` do PostgreSQL, e os
-- horários em HH:MM, de 00:00 a 23:59, no horário de Brasília (o mesmo do
-- `dia_civil` das batidas). Dia que não aparece na lista não tem jornada. Uma
-- coluna jsonb, e não uma tabela de blocos, porque a tela grava a semana
-- inteira de uma vez e uma coluna se confere INTEIRA num CHECK, sem gatilho de
-- restrição adiado nem bloco velho para apagar; e porque é o que cada um já
-- lê: a configuração (quem tem acesso ao ponto) e a própria ficha.
--
-- AS REGRAS (`ponto_jornada_problema`, que devolve a primeira coisa errada ou
-- nulo): lista não vazia; cada bloco com dia, inicio e fim, e nada mais; dia de
-- 1 a 7; horário HH:MM; fim depois do início (bloco de duração zero também é
-- recusado); no máximo dois blocos por dia, sem se cruzar (encostar pode:
-- 08:00-12:00 e 12:00-17:00); e cada dia com jornada somando de 60 a 720 min,
-- a faixa que a carga diária já tinha. A jornada própria vazia ([]) é recusada
-- de propósito: "seguir a da empresa" é a coluna nula, e a lista vazia seria um
-- terceiro estado ("não trabalha nunca") que ninguém pediu.
--
-- A CARGA DE REFERÊNCIA (`ponto_jornada_carga_de_referencia`): o MAIOR total
-- entre os dias com jornada. Determinística (não há empate a desempatar),
-- nunca abaixo de 60, e igual à carga de sempre quando os dias úteis são
-- iguais. O saldo do dia usa os blocos de cada dia, e não este número.
--
-- QUEM JÁ USA O PONTO. A linha da configuração que já existe ganha a jornada
-- montada da carga que estava gravada (`ponto_jornada_da_carga`): segunda a
-- sexta, das 08:00 às 12:00 e, à tarde, das 13:00 até completar a carga; com
-- carga de até 4 h, um bloco só, das 08:00 até completar. A carga continua
-- EXATAMENTE a mesma, e o saldo do dia sai certo desde o primeiro dia; os
-- horários são aproximados até quem administra conferir a jornada na tela (a
-- marca de atraso depende deles; o saldo, não). E o saldo dela passa a ser
-- calculado a partir do dia em que esta migration roda: a data da ficha pode
-- ser a admissão de anos atrás, e sem isso a atualização acusaria falta em
-- todos os meses anteriores. Quem administra pode recuar a data depois. Na
-- instalação que ainda não tem a linha, não há o que montar: ela nasce pela
-- tela, com a semente e o dia em que nascer.
--
-- A TRAVA DA PRÓPRIA FICHA (`ponto_funcionarios_guardar_propria_ficha`). O
-- ponto já recusa que o dono da batida a lance ou a corrija, inclusive o super
-- admin. A jornada própria e a data em que a pessoa passou a bater ponto
-- decidem o saldo dela tanto quanto a batida, então a mesma regra vale aqui:
-- com sessão, ninguém grava as duas na ficha ligada à própria conta. Nem
-- criando a ficha já ligada a si, nem ligando a si uma ficha que já as tem
-- (senão bastaria preparar a ficha sem conta e ligá-la depois). A ficha dos
-- outros continua editável por quem administra, e a jornada da empresa também,
-- porque vale para todos. Troca: numa empresa com uma pessoa só administrando,
-- a jornada e a data dela são gravadas por uma segunda pessoa com
-- administração.
--
-- O APP QUE ESTÁ NO CELULAR CONTINUA FUNCIONANDO. Ele grava a configuração com
-- `carga_diaria_minutos`, `tolerancia_minutos` e `janela_duplicidade_segundos`:
-- o gatilho `trg_ponto_configuracao_jornada` recalcula a carga a partir da
-- jornada em todo INSERT e UPDATE, por cima do número que veio. A gravação dá
-- certo, a tolerância e a janela ficam, e a linha devolvida já traz a carga da
-- jornada; o número digitado só não vale. O CHECK
-- `ponto_configuracao_carga_da_jornada` segura a regra também sem os gatilhos.
-- A ficha: o app grava as colunas que conhece, a jornada própria fica como
-- está, e a data da ficha que ele manda de volta igual não conta como mudança.
--
-- PERMISSÕES: nenhuma tabela nova, então nenhum GRANT novo em tabela. As
-- colunas entram em tabelas que já têm RLS e o privilégio de sempre: a
-- configuração, quem tem acesso ao ponto lê e só quem administra cria e edita;
-- a ficha, quem administra lê todas e edita, e cada um lê a própria. `anon` não
-- tem nada em nenhuma das duas. As duas funções puras que os CHECKs chamam têm
-- EXECUTE para `authenticated` (o CHECK roda como o papel que grava) e
-- `service_role`; as outras três, só `service_role`, como toda função de
-- gatilho e todo ajudante do banco.
--
-- O fim confere as colunas, a semente, as restrições, os gatilhos e os
-- privilégios das funções novas, e que toda carga aceita vira uma jornada
-- válida com a mesma carga; se algo não bater, nada fica.
-- ---------------------------------------------------------------------------

-- Valem até o fim da transação do arquivo, como na estrutura.
SET LOCAL lock_timeout = '10s';
SET LOCAL check_function_bodies = on;
SET LOCAL search_path = public, extensions;

-- 0. A partida. Só lê, e aborta com a explicação antes da primeira mudança.
DO $partida$
DECLARE
  v_carga integer;
BEGIN
  -- A estrutura do ponto: as duas tabelas que ganham coluna e a sessão do
  -- login, que a trava da própria ficha lê.
  IF to_regclass('public.ponto_configuracao') IS NULL OR to_regclass('public.ponto_funcionarios') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Jornada do ponto nao aplicada: falta a estrutura do ponto (a migration _ponto_livre_estrutura) neste banco.'
      USING ERRCODE = '42P01';
  END IF;

  -- Quem roda é o postgres, dono das duas tabelas: só o dono acrescenta
  -- coluna, restrição e gatilho, e as funções novas nascem dele, como as da
  -- estrutura.
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Jornada do ponto nao aplicada: rode como postgres, e nao como % (o postgres e dono das tabelas do ponto).', current_user
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c
             WHERE c.oid IN ('public.ponto_configuracao'::regclass, 'public.ponto_funcionarios'::regclass)
               AND pg_get_userbyid(c.relowner) <> 'postgres') THEN
    RAISE EXCEPTION 'Jornada do ponto nao aplicada: ponto_configuracao e ponto_funcionarios precisam ser do postgres.'
      USING ERRCODE = '42501';
  END IF;

  -- Uma vez só. O CLI não aplica a mesma migration duas vezes; quem a rodou à
  -- mão pelo editor de SQL e roda de novo recebe a frase, e não um erro de
  -- coluna repetida no meio do caminho.
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid IN ('public.ponto_configuracao'::regclass, 'public.ponto_funcionarios'::regclass)
               AND a.attname IN ('jornada', 'saldo_a_partir_de') AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace
                  AND (p.proname LIKE 'ponto_jornada%' OR p.proname = 'ponto_funcionarios_guardar_propria_ficha')) THEN
    RAISE EXCEPTION 'Jornada do ponto nao aplicada: a jornada ja existe neste banco (esta migration ja foi aplicada).'
      USING ERRCODE = '42701';
  END IF;

  SELECT c.carga_diaria_minutos INTO v_carga FROM public.ponto_configuracao c WHERE c.id = 1;
  RAISE NOTICE 'Jornada do ponto, partida: carga diaria gravada: %.',
    coalesce(v_carga::text || ' min', 'nenhuma (a configuracao ainda nao tem a linha)');
END $partida$;

-- 1. As funções puras. Vêm antes das colunas porque os CHECKs as chamam, e em
--    ordem de dependência: com check_function_bodies ligado, o corpo de uma
--    função sql é conferido ao nascer.
CREATE FUNCTION public.ponto_jornada_problema(p_jornada jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  c_dias   constant text[] := ARRAY['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
  c_hora   constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  v_bloco  jsonb;
  v_chaves text[];
  v_dia    integer;
  v_ini    integer;
  v_fim    integer;
  v_n      integer;
  v_total  integer;
  v_a      record;
  v_b      record;
BEGIN
  -- A primeira coisa errada, numa frase sem acento (como as outras do banco),
  -- ou NULL quando a jornada vale. O gatilho manda a mesma frase para a tela,
  -- que a traduz; o CHECK sozinho só daria o nome da restrição.
  IF p_jornada IS NULL THEN
    RETURN 'Jornada invalida: a jornada esta vazia.';
  END IF;
  IF jsonb_typeof(p_jornada) <> 'array' THEN
    RETURN 'Jornada invalida: a jornada e uma lista de blocos, como [{"dia": 1, "inicio": "08:00", "fim": "12:00"}].';
  END IF;
  IF jsonb_array_length(p_jornada) = 0 THEN
    RETURN 'Jornada invalida: nenhum bloco. Para seguir a jornada da empresa, deixe a jornada propria vazia (nula).';
  END IF;

  -- Cada bloco sozinho: as três chaves, o dia, os horários e o fim depois do
  -- início. A chave a mais é recusada, e não ignorada: um "intervalo" ou uma
  -- "tolerancia" escondidos no bloco seriam regra que ninguém confere.
  FOR v_bloco IN SELECT e.value FROM jsonb_array_elements(p_jornada) AS e LOOP
    IF jsonb_typeof(v_bloco) <> 'object' THEN
      RETURN 'Jornada invalida: cada bloco tem dia, inicio e fim, e nada mais.';
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_chaves FROM jsonb_object_keys(v_bloco) AS k;
    IF v_chaves IS DISTINCT FROM ARRAY['dia', 'fim', 'inicio'] THEN
      RETURN 'Jornada invalida: cada bloco tem dia, inicio e fim, e nada mais.';
    END IF;
    -- Número inteiro de 1 a 7: o texto "1" e o 1.5 são recusados, e não
    -- convertidos.
    IF jsonb_typeof(v_bloco -> 'dia') <> 'number' OR (v_bloco ->> 'dia') !~ '^[1-7]$' THEN
      RETURN format('Jornada invalida: o dia da semana %s nao existe (1 = segunda a 7 = domingo).', v_bloco -> 'dia');
    END IF;
    v_dia := (v_bloco ->> 'dia')::integer;
    IF jsonb_typeof(v_bloco -> 'inicio') <> 'string' OR (v_bloco ->> 'inicio') !~ c_hora
       OR jsonb_typeof(v_bloco -> 'fim') <> 'string' OR (v_bloco ->> 'fim') !~ c_hora THEN
      RETURN format('Jornada invalida: no dia %s (%s), o horario %s a %s nao esta no formato HH:MM (de 00:00 a 23:59).',
        v_dia, c_dias[v_dia], v_bloco -> 'inicio', v_bloco -> 'fim');
    END IF;
    -- Em minutos do dia, para a conta não depender da ordenação de texto.
    v_ini := split_part(v_bloco ->> 'inicio', ':', 1)::integer * 60 + split_part(v_bloco ->> 'inicio', ':', 2)::integer;
    v_fim := split_part(v_bloco ->> 'fim', ':', 1)::integer * 60 + split_part(v_bloco ->> 'fim', ':', 2)::integer;
    IF v_fim <= v_ini THEN
      RETURN format('Jornada invalida: no dia %s (%s), o bloco %s-%s nao termina depois de comecar (o fim precisa ser depois do inicio).',
        v_dia, c_dias[v_dia], v_bloco ->> 'inicio', v_bloco ->> 'fim');
    END IF;
  END LOOP;

  -- Cada dia: até dois blocos, sem se cruzar, e o total na faixa da carga
  -- diária. Bloco que vira a meia-noite não existe: o fim depois do início,
  -- acima, já o recusa.
  FOR v_dia IN 1..7 LOOP
    SELECT count(*)::integer, sum(b.fim - b.ini)::integer
      INTO v_n, v_total
      FROM (SELECT split_part(e ->> 'inicio', ':', 1)::integer * 60 + split_part(e ->> 'inicio', ':', 2)::integer AS ini,
                   split_part(e ->> 'fim', ':', 1)::integer * 60 + split_part(e ->> 'fim', ':', 2)::integer AS fim
              FROM jsonb_array_elements(p_jornada) AS e
             WHERE (e ->> 'dia')::integer = v_dia) AS b;
    CONTINUE WHEN v_n = 0;
    IF v_n > 2 THEN
      RETURN format('Jornada invalida: no dia %s (%s) ha %s blocos (no maximo dois por dia).', v_dia, c_dias[v_dia], v_n);
    END IF;
    IF v_n = 2 THEN
      SELECT b.inicio, b.fim, b.ini, b.fim_min INTO v_a
        FROM (SELECT e ->> 'inicio' AS inicio, e ->> 'fim' AS fim,
                     split_part(e ->> 'inicio', ':', 1)::integer * 60 + split_part(e ->> 'inicio', ':', 2)::integer AS ini,
                     split_part(e ->> 'fim', ':', 1)::integer * 60 + split_part(e ->> 'fim', ':', 2)::integer AS fim_min
                FROM jsonb_array_elements(p_jornada) AS e
               WHERE (e ->> 'dia')::integer = v_dia) AS b
       ORDER BY b.ini, b.fim_min LIMIT 1;
      SELECT b.inicio, b.fim, b.ini, b.fim_min INTO v_b
        FROM (SELECT e ->> 'inicio' AS inicio, e ->> 'fim' AS fim,
                     split_part(e ->> 'inicio', ':', 1)::integer * 60 + split_part(e ->> 'inicio', ':', 2)::integer AS ini,
                     split_part(e ->> 'fim', ':', 1)::integer * 60 + split_part(e ->> 'fim', ':', 2)::integer AS fim_min
                FROM jsonb_array_elements(p_jornada) AS e
               WHERE (e ->> 'dia')::integer = v_dia) AS b
       ORDER BY b.ini, b.fim_min OFFSET 1 LIMIT 1;
      -- Encostar pode (o segundo começa quando o primeiro acaba); cruzar, não.
      IF v_b.ini < v_a.fim_min THEN
        RETURN format('Jornada invalida: no dia %s (%s), os blocos %s-%s e %s-%s se cruzam (encostar pode, como 08:00-12:00 e 12:00-17:00).',
          v_dia, c_dias[v_dia], v_a.inicio, v_a.fim, v_b.inicio, v_b.fim);
      END IF;
    END IF;
    IF v_total < 60 OR v_total > 720 THEN
      RETURN format('Jornada invalida: o dia %s (%s) soma %s min; um dia com jornada soma de 60 a 720 min (de 1 h a 12 h).',
        v_dia, c_dias[v_dia], v_total);
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_jornada_problema(p_jornada jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_jornada_problema(p_jornada jsonb) TO authenticated, service_role;

CREATE FUNCTION public.ponto_jornada_carga_de_referencia(p_jornada jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  -- O maior total entre os dias com jornada (ver o cabeçalho). Jornada
  -- inválida responde nulo: quem recusa é o CHECK da jornada, com a frase dela.
  SELECT CASE WHEN public.ponto_jornada_problema(p_jornada) IS NULL THEN (
    SELECT max(t.total)::integer FROM (
      SELECT sum((split_part(e ->> 'fim', ':', 1)::integer * 60 + split_part(e ->> 'fim', ':', 2)::integer)
               - (split_part(e ->> 'inicio', ':', 1)::integer * 60 + split_part(e ->> 'inicio', ':', 2)::integer)) AS total
        FROM jsonb_array_elements(p_jornada) AS e
       GROUP BY e ->> 'dia'
    ) AS t)
  END;
$$;
REVOKE ALL ON FUNCTION public.ponto_jornada_carga_de_referencia(p_jornada jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_jornada_carga_de_referencia(p_jornada jsonb) TO authenticated, service_role;

CREATE FUNCTION public.ponto_jornada_da_carga(p_carga integer)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  -- A jornada de quem já usava o ponto, montada da carga gravada (ver o
  -- cabeçalho): segunda a sexta, 08:00 às 12:00 e, à tarde, das 13:00 até
  -- completar a carga; até 4 h, um bloco só, das 08:00 até completar. A tarde
  -- começa às 13:00 porque é o almoço de uma hora mais comum, e a carga máxima
  -- (12 h) termina às 21:00, dentro do dia. Os horários saem em HH:MM pela
  -- conta em minutos. Fora da faixa da carga (60 a 720), nulo.
  SELECT CASE WHEN p_carga BETWEEN 60 AND 720 THEN (
    SELECT jsonb_agg(jsonb_build_object('dia', b.dia, 'inicio', b.inicio, 'fim',
                                        lpad((b.fim / 60)::text, 2, '0') || ':' || lpad((b.fim % 60)::text, 2, '0'))
                     ORDER BY b.dia, b.inicio)
      FROM (
        SELECT d AS dia, '08:00' AS inicio, CASE WHEN p_carga <= 240 THEN 480 + p_carga ELSE 720 END AS fim
          FROM generate_series(1, 5) AS d
        UNION ALL
        SELECT d, '13:00', 780 + (p_carga - 240)
          FROM generate_series(1, 5) AS d
         WHERE p_carga > 240
      ) AS b)
  END;
$$;
REVOKE ALL ON FUNCTION public.ponto_jornada_da_carga(p_carga integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_jornada_da_carga(p_carga integer) TO service_role;

-- 2. As funções dos gatilhos. SECURITY INVOKER as duas: nenhuma lê tabela, e
--    as funções que a da jornada chama são as puras, que quem grava já executa.
CREATE FUNCTION public.ponto_jornada_conferir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_problema text;
BEGIN
  -- Na ficha, nula = segue a jornada da empresa.
  IF TG_TABLE_NAME = 'ponto_funcionarios' AND NEW.jornada IS NULL THEN
    RETURN NEW;
  END IF;

  -- A frase do problema chega inteira à tela. 23514 = check_violation, o
  -- mesmo código do CHECK que segura a regra sem o gatilho.
  v_problema := public.ponto_jornada_problema(NEW.jornada);
  IF v_problema IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problema USING ERRCODE = '23514';
  END IF;

  -- Os blocos em ordem (dia, depois início), cada um só com as três chaves:
  -- quem lê não precisa ordenar, a mesma semana grava sempre o mesmo valor, e
  -- a trava da própria ficha compara a jornada nova com a antiga sem acusar a
  -- mudança que não houve. (HH:MM com dois dígitos, já conferido; COLLATE "C"
  -- ordena como o relógio.)
  SELECT jsonb_agg(jsonb_build_object('dia', (e ->> 'dia')::integer, 'inicio', e ->> 'inicio', 'fim', e ->> 'fim')
                   ORDER BY (e ->> 'dia')::integer, (e ->> 'inicio') COLLATE "C")
    INTO NEW.jornada
    FROM jsonb_array_elements(NEW.jornada) AS e;

  -- Na configuração, a carga diária é a da jornada, por cima do número que
  -- veio (o app guardado no celular ainda manda carga_diaria_minutos).
  IF TG_TABLE_NAME = 'ponto_configuracao' THEN
    NEW.carga_diaria_minutos := public.ponto_jornada_carga_de_referencia(NEW.jornada);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_jornada_conferir() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_jornada_conferir() TO service_role;

CREATE FUNCTION public.ponto_funcionarios_guardar_propria_ficha()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ator       uuid := auth.uid();
  v_era_minha  boolean := false;
  v_fica_minha boolean;
BEGIN
  -- Sem sessão é a migration, o SQL do dono do banco ou o backend sem o token
  -- de ninguém: quem grava ali não é dono de ficha nenhuma. As regras de
  -- acesso da ficha exigem sessão, então o app nunca chega aqui sem ela.
  IF v_ator IS NULL THEN
    RETURN NEW;
  END IF;

  -- Ficha da sessão = ligada à conta de quem está logado, antes ou depois do
  -- comando. Não há exceção de papel: quem administra e o super admin também
  -- são donos da própria ficha, como são donos da própria batida.
  IF TG_OP = 'UPDATE' THEN
    v_era_minha := OLD.usuario_id IS NOT DISTINCT FROM v_ator;
  END IF;
  v_fica_minha := NEW.usuario_id IS NOT DISTINCT FROM v_ator;

  -- 1. A ficha que já era da sessão: a jornada própria e a data ficam como
  --    estavam, inclusive no comando que a desliga da conta. Mandar o mesmo
  --    valor de volta (a tela grava a ficha inteira) não é mudança.
  IF v_era_minha
     AND (NEW.jornada IS DISTINCT FROM OLD.jornada OR NEW.bate_ponto_desde IS DISTINCT FROM OLD.bate_ponto_desde) THEN
    RAISE EXCEPTION 'Quem e dono da ficha nao muda a propria jornada nem a data em que passou a bater ponto: peca a outra pessoa que administra o ponto ou ao super admin'
      USING ERRCODE = '42501';
  END IF;

  -- 2. A ficha que passa a ser da sessão (criada já ligada a ela, ou ligada
  --    agora) chega sem as duas. Sem isto, bastaria preparar a ficha sem
  --    conta, com a jornada e a data que se quer, e ligá-la a si depois; ou
  --    desligar a própria ficha, mudar e ligar de novo.
  IF v_fica_minha AND NOT v_era_minha
     AND (NEW.jornada IS NOT NULL OR NEW.bate_ponto_desde IS NOT NULL) THEN
    RAISE EXCEPTION 'Quem e dono da ficha nao a cria nem a liga a propria conta com jornada propria ou com a data em que passou a bater ponto: grave a ficha sem as duas e peca a outra pessoa que administra o ponto que as preencha'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ponto_funcionarios_guardar_propria_ficha() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ponto_funcionarios_guardar_propria_ficha() TO service_role;

-- 3. As colunas. A jornada da empresa nasce com a semente, constante (a linha
--    que já existe lê a semente até o passo 4 trocá-la). A data do saldo nasce
--    com o dia de Brasília, do mesmo jeito que a estrutura calcula o dia civil
--    da batida; o padrão não é constante, então o PostgreSQL o grava na linha
--    que já existe ao acrescentar a coluna: ela fica com o dia em que esta
--    migration roda.
ALTER TABLE public.ponto_configuracao
  ADD COLUMN jornada jsonb NOT NULL DEFAULT '[{"dia": 1, "fim": "12:00", "inicio": "08:00"}, {"dia": 1, "fim": "17:00", "inicio": "13:00"}, {"dia": 2, "fim": "12:00", "inicio": "08:00"}, {"dia": 2, "fim": "17:00", "inicio": "13:00"}, {"dia": 3, "fim": "12:00", "inicio": "08:00"}, {"dia": 3, "fim": "17:00", "inicio": "13:00"}, {"dia": 4, "fim": "12:00", "inicio": "08:00"}, {"dia": 4, "fim": "17:00", "inicio": "13:00"}, {"dia": 5, "fim": "12:00", "inicio": "08:00"}, {"dia": 5, "fim": "17:00", "inicio": "13:00"}]'::jsonb,
  ADD COLUMN saldo_a_partir_de date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date;
ALTER TABLE public.ponto_funcionarios
  ADD COLUMN jornada jsonb;

-- 4. Quem já usa o ponto: a linha que já existe troca a semente pela jornada
--    montada da carga gravada, e a carga fica exatamente a mesma. Antes das
--    restrições, que já encontram a linha coerente. O bloco confere o que
--    gravou e aborta a migration inteira se a carga, a jornada ou a data não
--    ficaram como o cabeçalho promete.
DO $linha_existente$
DECLARE
  v_carga  integer;
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_depois record;
BEGIN
  SELECT c.carga_diaria_minutos INTO v_carga FROM public.ponto_configuracao c WHERE c.id = 1;
  IF NOT FOUND THEN
    RAISE NOTICE 'Jornada do ponto: a configuracao ainda nao tem a linha; ela nasce pela tela, com a jornada semente e o dia em que nascer.';
    RETURN;
  END IF;

  UPDATE public.ponto_configuracao
     SET jornada = public.ponto_jornada_da_carga(carga_diaria_minutos)
   WHERE id = 1
  RETURNING carga_diaria_minutos, jornada, saldo_a_partir_de INTO v_depois;

  IF v_depois.jornada IS NULL
     OR public.ponto_jornada_problema(v_depois.jornada) IS NOT NULL
     OR public.ponto_jornada_carga_de_referencia(v_depois.jornada) IS DISTINCT FROM v_carga
     OR v_depois.carga_diaria_minutos IS DISTINCT FROM v_carga
     OR v_depois.saldo_a_partir_de IS DISTINCT FROM v_hoje THEN
    RAISE EXCEPTION 'Jornada do ponto desfeita: a configuracao que ja existia nao ficou com a jornada da carga de % min, a mesma carga e o saldo a partir de hoje.', v_carga
      USING ERRCODE = '23514';
  END IF;
  RAISE NOTICE 'Jornada do ponto: a configuracao que ja existia ganhou a jornada montada da carga de % min (a carga nao mudou) e o saldo calculado a partir de %.',
    v_carga, to_char(v_hoje, 'DD/MM/YYYY');
END $linha_existente$;

-- 5. As restrições. Elas seguram as regras também quando os gatilhos não
--    rodam.
ALTER TABLE public.ponto_configuracao
  ADD CONSTRAINT ponto_configuracao_jornada_valida CHECK ((public.ponto_jornada_problema(jornada) IS NULL)),
  ADD CONSTRAINT ponto_configuracao_carga_da_jornada CHECK ((carga_diaria_minutos = public.ponto_jornada_carga_de_referencia(jornada)));
ALTER TABLE public.ponto_funcionarios
  ADD CONSTRAINT ponto_funcionarios_jornada_valida CHECK (((jornada IS NULL) OR (public.ponto_jornada_problema(jornada) IS NULL)));

-- 6. Os gatilhos. Entre os BEFORE de uma tabela, o PostgreSQL roda na ordem
--    alfabética do nome, e aqui ela faz parte do desenho: na ficha, a jornada
--    (trg_ponto_funcionarios_jornada) põe os blocos em ordem antes de a trava
--    da própria ficha (trg_ponto_funcionarios_propria_ficha) compará-los com
--    os de antes. A jornada da ficha só confere quando ela é gravada; a trava,
--    em todo INSERT e UPDATE, porque ligar a ficha a uma conta também conta.
CREATE TRIGGER trg_ponto_configuracao_jornada BEFORE INSERT OR UPDATE ON public.ponto_configuracao
  FOR EACH ROW EXECUTE FUNCTION public.ponto_jornada_conferir();
CREATE TRIGGER trg_ponto_funcionarios_jornada BEFORE INSERT OR UPDATE OF jornada ON public.ponto_funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.ponto_jornada_conferir();
CREATE TRIGGER trg_ponto_funcionarios_propria_ficha BEFORE INSERT OR UPDATE ON public.ponto_funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.ponto_funcionarios_guardar_propria_ficha();

-- 7. Os comentários (sem acento, como os da estrutura). Os três primeiros
--    substituem os da estrutura, que diziam que a carga e a tolerância não
--    entravam em conta nenhuma e que a data da ficha era só registro.
COMMENT ON COLUMN public.ponto_configuracao.carga_diaria_minutos IS 'Carga diaria de referencia, em minutos, PREENCHIDA PELO BANCO a partir da jornada da empresa: o maior total entre os dias com jornada (ponto_jornada_carga_de_referencia). O numero que o app manda e trocado pelo da jornada (gatilho trg_ponto_configuracao_jornada; CHECK ponto_configuracao_carga_da_jornada). Faixa: 60 a 720. E o resumo da jornada; o saldo do dia usa os blocos de cada dia da semana, e nao este numero.';
COMMENT ON COLUMN public.ponto_configuracao.tolerancia_minutos IS 'Tolerancia diaria do saldo de horas, em minutos. Faixa aceita: 0 a 60. No dia cobrado, a diferenca entre o que a pessoa fez (trabalhado mais abonado) e o previsto pela jornada vira zero quando fica dentro da tolerancia, para mais ou para menos; acima dela vale a diferenca inteira. Tambem e o limite da marca de atraso. A conta e a mesma no espelho, no painel, na folha e no CSV.';
COMMENT ON COLUMN public.ponto_funcionarios.bate_ponto_desde IS 'Data em que esta pessoa passou a bater ponto NESTE sistema, informada pelo RH. NULO = ainda nao informada, e a pessoa nao tem dia cobrado no saldo. Nao libera nem bloqueia o ponto (quem libera e a ficha ativa ligada a conta). O saldo de horas da pessoa (previsto, falta e saldo do dia) comeca na mais nova entre esta data e ponto_configuracao.saldo_a_partir_de: antes dela, nenhum dia gera falta nem saldo. Quem e dono da ficha nao a grava (gatilho trg_ponto_funcionarios_propria_ficha).';
COMMENT ON COLUMN public.ponto_configuracao.jornada IS 'A jornada da EMPRESA, que vale para quem nao tem jornada propria na ficha. Lista de blocos [{"dia": 1..7 (1 = segunda, como o isodow), "inicio": "HH:MM", "fim": "HH:MM"}], ate dois por dia, sem se cruzar (encostar pode), cada dia com jornada somando de 60 a 720 min; dia que nao aparece nao tem jornada. Horario de Brasilia, o mesmo do dia_civil das batidas. Semente: segunda a sexta, 08:00-12:00 e 13:00-17:00; a linha que ja existia ganhou a jornada montada da carga gravada (ponto_jornada_da_carga). Regras em ponto_jornada_problema; o gatilho trg_ponto_configuracao_jornada poe os blocos em ordem e recalcula a carga diaria. Quem administra edita.';
COMMENT ON COLUMN public.ponto_configuracao.saldo_a_partir_de IS 'Saldo calculado a partir de: o primeiro dia em que o saldo de horas e cobrado na empresa. O saldo de cada pessoa comeca na mais nova entre esta data e a da ficha (ponto_funcionarios.bate_ponto_desde); antes dela, nenhum dia gera previsto, falta nem saldo. Nasce com o dia de Brasilia em que a linha nasce; a linha que ja existia ficou com o dia em que a migration da jornada rodou, para a atualizacao nao acusar falta nos meses anteriores. Quem administra muda a data: recuar passa a cobrar os dias desde ela, inclusive as faltas.';
COMMENT ON COLUMN public.ponto_funcionarios.jornada IS 'A jornada PROPRIA da pessoa, no mesmo formato de ponto_configuracao.jornada. NULA = segue a jornada da empresa. Lista vazia e recusada (para seguir a da empresa, deixe nula). Quem administra grava a da ficha dos outros; ninguem grava a da ficha ligada a propria conta (gatilho trg_ponto_funcionarios_propria_ficha).';
COMMENT ON FUNCTION public.ponto_jornada_problema(p_jornada jsonb) IS 'A primeira coisa errada de uma jornada (frase sem acento que comeca por "Jornada invalida:") ou NULL quando ela vale. Lista nao vazia; blocos so com dia (1 a 7), inicio e fim (HH:MM, 00:00 a 23:59); fim depois do inicio; ate dois blocos por dia, sem se cruzar (encostar pode); cada dia com jornada somando de 60 a 720 min. Pura: os CHECKs a chamam como o papel que grava, por isso authenticated a executa.';
COMMENT ON FUNCTION public.ponto_jornada_carga_de_referencia(p_jornada jsonb) IS 'A carga diaria de referencia de uma jornada: o maior total, em minutos, entre os dias com jornada. NULL para jornada invalida. Pura: o CHECK ponto_configuracao_carga_da_jornada a chama como o papel que grava.';
COMMENT ON FUNCTION public.ponto_jornada_da_carga(p_carga integer) IS 'A jornada montada de uma carga diaria (60 a 720 min; fora disso, NULL): segunda a sexta, 08:00-12:00 e 13:00 ate completar a carga; com carga de ate 240 min, um bloco so, das 08:00 ate completar. A carga de referencia dela e a propria carga. Foi o que a linha da configuracao que ja existia ganhou na migration da jornada. Interna: o app nao a chama.';
COMMENT ON FUNCTION public.ponto_jornada_conferir() IS 'Gatilho de ponto_configuracao (trg_ponto_configuracao_jornada) e de ponto_funcionarios (trg_ponto_funcionarios_jornada). Recusa a jornada invalida com a frase de ponto_jornada_problema (23514), poe os blocos em ordem de dia e inicio e, na configuracao, preenche carga_diaria_minutos com a carga da jornada, por cima do numero que veio. Na ficha, jornada nula passa (segue a da empresa).';
COMMENT ON FUNCTION public.ponto_funcionarios_guardar_propria_ficha() IS 'Gatilho BEFORE INSERT OR UPDATE de ponto_funcionarios (trg_ponto_funcionarios_propria_ficha). Com sessao, para todo mundo, inclusive o super admin: recusa (42501) mudar jornada ou bate_ponto_desde na ficha ligada a propria conta (tambem no comando que a desliga), e criar ou ligar a propria conta uma ficha que ja as tem. A ficha dos outros e livre para quem administra. Sem sessao (migration, backend), passa.';
COMMENT ON CONSTRAINT ponto_configuracao_jornada_valida ON public.ponto_configuracao IS 'A jornada da empresa segue as regras de ponto_jornada_problema, tambem sem os gatilhos.';
COMMENT ON CONSTRAINT ponto_configuracao_carga_da_jornada ON public.ponto_configuracao IS 'A carga diaria e sempre a da jornada da empresa (dois numeros que podiam discordar viram um so), tambem sem os gatilhos.';
COMMENT ON CONSTRAINT ponto_funcionarios_jornada_valida ON public.ponto_funcionarios IS 'A jornada propria e nula (segue a da empresa) ou segue as regras de ponto_jornada_problema, tambem sem os gatilhos.';
COMMENT ON TRIGGER trg_ponto_configuracao_jornada ON public.ponto_configuracao IS 'Confere e ordena a jornada da empresa e preenche a carga diaria a partir dela, em todo INSERT e UPDATE.';
COMMENT ON TRIGGER trg_ponto_funcionarios_jornada ON public.ponto_funcionarios IS 'Confere e ordena a jornada propria quando ela e gravada. Roda antes da trava da propria ficha (ordem alfabetica do nome), que compara os blocos ja em ordem.';
COMMENT ON TRIGGER trg_ponto_funcionarios_propria_ficha ON public.ponto_funcionarios IS 'Ninguem grava a jornada propria nem a data em que passou a bater ponto na ficha ligada a propria conta, nem o super admin. Roda depois da jornada (ordem alfabetica do nome).';

-- 8. Fim: a conferência do que nasceu. Só lê; se algo não bater, a migration
--    inteira volta atrás. Depois, o aviso ao PostgREST para reler o esquema
--    (as colunas novas aparecem na API; só chega se a transação for
--    confirmada).
DO $fim$
DECLARE
  c_funcoes   constant text[] := ARRAY['ponto_funcionarios_guardar_propria_ficha', 'ponto_jornada_carga_de_referencia',
                                       'ponto_jornada_conferir', 'ponto_jornada_da_carga', 'ponto_jornada_problema'];
  -- As duas que os CHECKs chamam como o papel que grava.
  c_do_app    constant text[] := ARRAY['ponto_jornada_carga_de_referencia', 'ponto_jornada_problema'];
  v_n         integer;
  v_txt       text;
  v_jornada   jsonb;
  v_data      date;
  v_carga     integer;
BEGIN
  -- 8a. As três colunas, com o tipo, a obrigatoriedade e o padrão.
  SELECT count(*) INTO v_n FROM pg_attribute a
  WHERE a.attnum > 0 AND NOT a.attisdropped
    AND ((a.attrelid = 'public.ponto_configuracao'::regclass AND a.attname = 'jornada'
          AND a.atttypid = 'jsonb'::regtype AND a.attnotnull AND a.atthasdef)
      OR (a.attrelid = 'public.ponto_configuracao'::regclass AND a.attname = 'saldo_a_partir_de'
          AND a.atttypid = 'date'::regtype AND a.attnotnull AND a.atthasdef)
      OR (a.attrelid = 'public.ponto_funcionarios'::regclass AND a.attname = 'jornada'
          AND a.atttypid = 'jsonb'::regtype AND NOT a.attnotnull AND NOT a.atthasdef));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Jornada do ponto desfeita: as colunas jornada (configuracao e ficha) e saldo_a_partir_de nao nasceram como deviam (% de 3).', v_n
      USING ERRCODE = '23514';
  END IF;

  -- 8b. Os padrões: a semente vale e dá 480 min; a data é o dia de Brasília.
  --     Uma semente errada recusaria a primeira gravação de toda instalação
  --     nova.
  EXECUTE 'SELECT ' || (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                         WHERE d.adrelid = 'public.ponto_configuracao'::regclass AND a.attname = 'jornada')
    INTO v_jornada;
  EXECUTE 'SELECT ' || (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                         WHERE d.adrelid = 'public.ponto_configuracao'::regclass AND a.attname = 'saldo_a_partir_de')
    INTO v_data;
  IF public.ponto_jornada_problema(v_jornada) IS NOT NULL
     OR public.ponto_jornada_carga_de_referencia(v_jornada) IS DISTINCT FROM 480
     OR v_data IS DISTINCT FROM (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Jornada do ponto desfeita: a semente da jornada nao vale 480 min ou a data do saldo nao nasce com o dia de Brasilia.'
      USING ERRCODE = '23514';
  END IF;

  -- 8c. Toda carga que a configuração aceita (60 a 720 min) vira uma jornada
  --     válida, com a mesma carga.
  FOR v_carga IN 60..720 LOOP
    v_jornada := public.ponto_jornada_da_carga(v_carga);
    IF public.ponto_jornada_problema(v_jornada) IS NOT NULL
       OR public.ponto_jornada_carga_de_referencia(v_jornada) IS DISTINCT FROM v_carga THEN
      RAISE EXCEPTION 'Jornada do ponto desfeita: a jornada montada da carga de % min nao vale ou nao tem a mesma carga.', v_carga
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- 8d. As três restrições, validadas, e os três gatilhos, ligados.
  SELECT count(*) INTO v_n FROM pg_constraint k
  WHERE k.contype = 'c' AND k.convalidated
    AND ((k.conrelid = 'public.ponto_configuracao'::regclass AND k.conname IN ('ponto_configuracao_jornada_valida', 'ponto_configuracao_carga_da_jornada'))
      OR (k.conrelid = 'public.ponto_funcionarios'::regclass AND k.conname = 'ponto_funcionarios_jornada_valida'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Jornada do ponto desfeita: % de 3 restricoes da jornada nasceram validadas.', v_n
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_n FROM pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
    AND ((t.tgrelid = 'public.ponto_configuracao'::regclass AND t.tgname = 'trg_ponto_configuracao_jornada')
      OR (t.tgrelid = 'public.ponto_funcionarios'::regclass AND t.tgname IN ('trg_ponto_funcionarios_jornada', 'trg_ponto_funcionarios_propria_ficha')));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Jornada do ponto desfeita: % de 3 gatilhos da jornada nasceram ligados.', v_n
      USING ERRCODE = '23514';
  END IF;

  -- 8e. As cinco funções: search_path fixo; nada para anon nem PUBLIC
  --     (has_function_privilege olha também o que vem de PUBLIC); EXECUTE de
  --     authenticated só nas duas que os CHECKs chamam; service_role em todas.
  SELECT count(*) INTO v_n FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (c_funcoes);
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_txt
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (c_funcoes)
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE') <> (p.proname = ANY (c_do_app))
         OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
         OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg WHERE cfg LIKE 'search_path=%'));
  IF v_n <> cardinality(c_funcoes) OR v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Jornada do ponto desfeita: % de % funcoes nasceram, e estas tem privilegio ou search_path fora da regra: %.',
      v_n, cardinality(c_funcoes), coalesce(v_txt, 'nenhuma')
      USING ERRCODE = '42501';
  END IF;

  -- 8f. anon sem nada nas colunas novas.
  IF has_column_privilege('anon', 'public.ponto_configuracao', 'jornada', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_column_privilege('anon', 'public.ponto_configuracao', 'saldo_a_partir_de', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_column_privilege('anon', 'public.ponto_funcionarios', 'jornada', 'SELECT, INSERT, UPDATE, REFERENCES') THEN
    RAISE EXCEPTION 'Jornada do ponto desfeita: anon tem privilegio numa coluna nova.'
      USING ERRCODE = '42501';
  END IF;

  RAISE NOTICE 'Jornada do ponto aplicada: 3 colunas, 5 funcoes, 3 restricoes e 3 gatilhos.';
END $fim$;

NOTIFY pgrst, 'reload schema';
