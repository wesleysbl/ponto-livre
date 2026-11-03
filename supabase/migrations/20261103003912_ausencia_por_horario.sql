-- PONTO LIVRE: A AUSÊNCIA POR HORÁRIO E A TRAVA DA PRÓPRIA AUSÊNCIA
--
-- A terceira migration do ponto, aplicada depois da jornada
-- (`..._jornada_e_saldo.sql`; as anteriores nunca são editadas). Até aqui uma
-- ausência cobria sempre DIAS INTEIROS (`dia_inicio` a `dia_fim`): um atestado
-- das 14:00 às 16:00 virava o dia inteiro, ou não era lançado e a saída
-- parecia atraso. Esta migration dá à ausência uma MODALIDADE: "por dias" (a
-- de sempre) ou "por horário" (um intervalo exato de um dia só, e várias no
-- mesmo dia). E estende à ausência a regra que o ponto já aplica à batida e à
-- ficha: quem é dono da ausência não a lança nem a cancela.
-- Cria 3 colunas e 2 restrições em `ponto_ausencias`, troca a função do
-- gatilho das ausências (`ponto_ausencias_guardar`, CREATE OR REPLACE: a mesma
-- função, com o mesmo gatilho) e concede o INSERT das colunas novas; nenhuma
-- tabela, função, gatilho nem regra de acesso nova.
--
-- COMO APLICAR: como as outras (`npx supabase db push` no Supabase hospedado;
-- `npm run db:zerar` no local), ANTES de publicar o app que lança por horário.
-- Roda como `postgres`, sem superusuário, na transação que o CLI abre: o
-- primeiro erro, ou a conferência do fim que não bate, desfaz tudo.
--
-- O QUE MUDA EM `ponto_ausencias`
--   • `modalidade` (text, obrigatória, padrão 'dias'): 'dias' ou 'horario'.
--   • `hora_inicio` e `hora_fim` (time without time zone, nulas): o intervalo
--     da ausência por horário, no dia `dia_inicio` (igual a `dia_fim`). Nulas
--     na ausência por dias.
--
-- POR QUE `time` NO DIA, E NÃO `timestamptz`. O dia da ausência já é um dia
-- civil de Brasília (`dia_inicio`, o mesmo do `dia_civil` das batidas), e o que
-- quem administra digita é o relógio da parede daquele dia ("das 14:00 às
-- 16:00"). É isso que se guarda: o dia e duas horas do relógio de Brasília.
-- Com `time`, o intervalo fica num dia só sem regra a mais (o fim depois do
-- início não atravessa a meia-noite), nada depende do fuso da sessão que grava
-- ou lê, e o intervalo se cruza direto com os blocos da jornada, que também
-- são HH:MM de Brasília. Minuto exato: o banco recusa segundos (o atestado não
-- fala em segundos, e dois intervalos que se encostam precisam encostar no
-- mesmo minuto). E 24:00, que o tipo `time` aceita, é recusado, como na
-- jornada (de 00:00 a 23:59).
--
-- AS REGRAS DA MODALIDADE (no gatilho, com frase própria, e nos CHECKs, que as
-- seguram também sem o gatilho):
--   • a modalidade é 'dias' ou 'horario';
--   • por dias não leva horário (as duas horas nulas);
--   • por horário leva as duas horas e é de UM dia só (dia_fim = dia_inicio);
--   • o fim vem depois do início (intervalo de duração zero também é recusado);
--   • as horas são em minuto exato, de 00:00 a 23:59.
-- O tipo, a observação, o atestado, a janela de um ano e o teto de 120 dias
-- continuam iguais nas duas modalidades.
--
-- A SOBREPOSIÇÃO (no lugar da regra "uma ausência ativa por dia"). Duas
-- ausências ATIVAS da mesma pessoa (as canceladas não contam) não cobrem o
-- mesmo tempo:
--   • por dias contra por dias: períodos que dividem um dia, com a MESMA frase
--     de sempre ("Ja existe ausencia ativa desta pessoa em parte deste periodo");
--   • por horário num dia coberto por uma ausência por dias: recusada;
--   • por dias sobre um dia que tem uma ausência por horário: recusada, com o
--     dia e o intervalo dela;
--   • por horário contra por horário no mesmo dia: recusada quando os
--     intervalos se CRUZAM, com o intervalo cruzado. Intervalos que só se
--     ENCOSTAM valem: 14:00-16:00 e 16:00-16:30 (o fim de um é o início do
--     outro, e nenhum minuto conta duas vezes).
-- Recusar, e não unir: a conta do saldo soma cada ausência uma vez, e sem
-- sobreposição não há regra de união a acertar; o caminho para corrigir é o de
-- sempre (cancelar com motivo e lançar de novo). A trava por pessoa continua
-- antes de qualquer leitura de sobreposição (`pg_advisory_xact_lock` pela
-- pessoa, até o fim da transação): dois lançamentos ao mesmo tempo para a
-- mesma pessoa passam um de cada vez, e o segundo vê o primeiro. Código 23P01
-- (exclusion_violation) nas quatro, como sempre.
--
-- A TRAVA DA PRÓPRIA AUSÊNCIA. O ponto já recusa que o dono da batida a lance
-- ou a corrija, e que o dono da ficha mude a própria jornada ou a data em que
-- passou a bater ponto. A ausência decide o saldo da pessoa tanto quanto a
-- batida (abonada, a ausência em causa própria vira crédito), então a mesma
-- regra vale aqui, para todo mundo, inclusive o super admin: ninguém lança
-- ausência para a própria conta, nem cancela a própria ausência. Editar uma
-- ausência é cancelar e lançar de novo, então as duas ficam com outra pessoa
-- que administra. A ausência dos outros continua com quem administra. Sem
-- sessão a regra não se aplica, como a da própria ficha; mas a ausência já
-- exige a sessão de quem administra (o autor é carimbado pelo banco), então
-- nenhuma ausência nasce nem é cancelada sem sessão. Troca: numa empresa com
-- uma pessoa só administrando, o atestado dela é lançado por uma segunda
-- pessoa com administração. Código 42501, como as outras duas travas.
--
-- AS AUSÊNCIAS QUE JÁ EXISTEM NÃO MUDAM. ADD COLUMN com padrão constante não
-- reescreve a tabela: cada linha antiga passa a LER 'dias' e as duas horas
-- nulas, sem UPDATE e sem passar pelo gatilho. A partida guarda a impressão de
-- todas as linhas (md5 das linhas inteiras, em ordem de id) e o fim exige a
-- mesma impressão sem as três colunas novas, e as três colunas novas em
-- 'dias', nula e nula; se uma linha antiga mudasse, nada fica. Elas continuam
-- valendo como foram lançadas, inclusive a que alguém tenha lançado para si
-- antes desta migration: a trava vale para o que se lança e se cancela daqui
-- em diante.
--
-- A IMUTABILIDADE CONTINUA A MESMA. O gatilho compara, no UPDATE, a linha
-- INTEIRA menos as três colunas do cancelamento (`to_jsonb(NEW) - ...`): as
-- colunas novas entram nessa comparação sem uma linha de código a mais, e a
-- modalidade e o horário de uma ausência lançada não mudam, nem pelo dono das
-- tabelas. O UPDATE do app continua só em `motivo_cancelamento`.
--
-- O APP QUE ESTÁ NO CELULAR CONTINUA LANÇANDO. Ele manda só `id, usuario_id,
-- dia_inicio, dia_fim, tipo, observacao, atestado_path`: a modalidade vem do
-- padrão ('dias'), as horas ficam nulas, e a ausência entra por dias, com as
-- mesmas regras e a mesma frase de sobreposição (que ele reconhece na nova
-- tentativa com o mesmo id).
--
-- PERMISSÕES: nenhuma tabela nova. O INSERT por coluna de `authenticated`
-- ganha as três colunas novas (o app que lança por horário as manda); o UPDATE
-- continua só em `motivo_cancelamento`. A leitura é a da tabela, que já
-- existe: quem lê a ausência (quem administra, e a pessoa, as dela) lê também
-- a modalidade e as horas. `anon` continua sem nada. A função do gatilho
-- continua SECURITY DEFINER com search_path fixo, só com EXECUTE para
-- `service_role`.
--
-- O fim confere as ausências antigas linha a linha, as colunas, as restrições,
-- o gatilho, a função e os privilégios; se algo não bater, nada fica.
-- ---------------------------------------------------------------------------

-- Valem até o fim da transação do arquivo, como nas outras.
SET LOCAL lock_timeout = '10s';
SET LOCAL check_function_bodies = on;
SET LOCAL search_path = public, extensions;

-- 0. A partida. Só lê, e aborta com a explicação antes da primeira mudança.
DO $partida$
DECLARE
  v_linhas    bigint;
  v_ativas    bigint;
  v_impressao text;
BEGIN
  -- A estrutura do ponto: a tabela e a função das ausências e a sessão do
  -- login, que a trava da própria ausência lê. E a jornada, que vem antes
  -- desta: o horário da ausência se cruza com os blocos dela.
  IF to_regclass('public.ponto_ausencias') IS NULL
     OR to_regprocedure('public.ponto_ausencias_guardar()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Ausencia por horario nao aplicada: falta a estrutura do ponto (a migration _ponto_livre_estrutura) neste banco.'
      USING ERRCODE = '42P01';
  END IF;
  IF to_regprocedure('public.ponto_jornada_problema(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Ausencia por horario nao aplicada: falta a migration da jornada (_jornada_e_saldo), que vem antes desta.'
      USING ERRCODE = '42P01';
  END IF;
  -- A função trocada aqui é a do gatilho que já existe: sem ele, a troca não
  -- guardaria nada.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgrelid = 'public.ponto_ausencias'::regclass AND NOT t.tgisinternal
                   AND t.tgname = 'trg_ponto_ausencias_guardar'
                   AND t.tgfoid = 'public.ponto_ausencias_guardar()'::regprocedure) THEN
    RAISE EXCEPTION 'Ausencia por horario nao aplicada: ponto_ausencias nao tem o gatilho trg_ponto_ausencias_guardar com a funcao ponto_ausencias_guardar.'
      USING ERRCODE = '42P01';
  END IF;

  -- Quem roda é o postgres, dono da tabela e da função: só o dono acrescenta
  -- coluna e restrição e troca a função.
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Ausencia por horario nao aplicada: rode como postgres, e nao como % (o postgres e dono das tabelas do ponto).', current_user
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c
             WHERE c.oid = 'public.ponto_ausencias'::regclass AND pg_get_userbyid(c.relowner) <> 'postgres')
     OR EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.oid = 'public.ponto_ausencias_guardar()'::regprocedure AND pg_get_userbyid(p.proowner) <> 'postgres') THEN
    RAISE EXCEPTION 'Ausencia por horario nao aplicada: ponto_ausencias e ponto_ausencias_guardar precisam ser do postgres.'
      USING ERRCODE = '42501';
  END IF;

  -- Uma vez só. O CLI não aplica a mesma migration duas vezes; quem a rodou à
  -- mão pelo editor de SQL e roda de novo recebe a frase, e não um erro de
  -- coluna repetida no meio do caminho.
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.ponto_ausencias'::regclass
               AND a.attname IN ('modalidade', 'hora_inicio', 'hora_fim') AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint k
                WHERE k.conrelid = 'public.ponto_ausencias'::regclass
                  AND k.conname IN ('ponto_ausencias_modalidade_coerente', 'ponto_ausencias_horario_no_minuto')) THEN
    RAISE EXCEPTION 'Ausencia por horario nao aplicada: a ausencia por horario ja existe neste banco (esta migration ja foi aplicada).'
      USING ERRCODE = '42701';
  END IF;

  -- A impressão das ausências que já existem: as linhas inteiras, em ordem de
  -- id. O fim a refaz sem as colunas novas e exige a mesma. Vale até o fim da
  -- transação, como os SET LOCAL de cima.
  SELECT count(*), count(*) FILTER (WHERE a.cancelada_em IS NULL),
         md5(coalesce(string_agg(to_jsonb(a)::text, E'\n' ORDER BY a.id), ''))
    INTO v_linhas, v_ativas, v_impressao
    FROM public.ponto_ausencias a;
  PERFORM set_config('ponto.ausencias_antes_do_horario', v_linhas::text || ' ' || v_impressao, true);
  RAISE NOTICE 'Ausencia por horario, partida: % ausencia(s) gravada(s), % ativa(s), todas por dias.', v_linhas, v_ativas;
END $partida$;

-- 1. As colunas. ADD COLUMN com padrão constante não reescreve a tabela: as
--    linhas antigas passam a ler 'dias' e as duas horas nulas.
ALTER TABLE public.ponto_ausencias
  ADD COLUMN modalidade text NOT NULL DEFAULT 'dias'::text,
  ADD COLUMN hora_inicio time without time zone,
  ADD COLUMN hora_fim time without time zone;

-- 2. As restrições. Elas seguram as regras também sem o gatilho (um restore
--    com os gatilhos desligados, o SQL do dono do banco). As linhas antigas
--    ('dias', horas nulas) valem nas duas, então elas nascem validadas. Duas, e
--    não uma por regra: `modalidade_coerente` já recusa a modalidade que não é
--    'dias' nem 'horario' (nenhum dos dois lados do OR vale), e uma terceira
--    só para isso nunca seria a que recusa.
ALTER TABLE public.ponto_ausencias
  ADD CONSTRAINT ponto_ausencias_modalidade_coerente CHECK ((((modalidade = 'dias'::text) AND (hora_inicio IS NULL) AND (hora_fim IS NULL))
    OR ((modalidade = 'horario'::text) AND (hora_inicio IS NOT NULL) AND (hora_fim IS NOT NULL) AND (dia_fim = dia_inicio) AND (hora_fim > hora_inicio)))),
  ADD CONSTRAINT ponto_ausencias_horario_no_minuto CHECK ((((hora_inicio IS NULL) OR ((EXTRACT(second FROM hora_inicio) = (0)::numeric) AND (hora_inicio <= '23:59:00'::time without time zone)))
    AND ((hora_fim IS NULL) OR ((EXTRACT(second FROM hora_fim) = (0)::numeric) AND (hora_fim <= '23:59:00'::time without time zone)))));

-- 3. A função do gatilho das ausências, com a trava da própria ausência, a
--    modalidade e a sobreposição nova. O resto (sessão, papel, cancelamento,
--    carimbo, pessoa, tipo, período, janela, atestado) é o da estrutura,
--    palavra por palavra. CREATE OR REPLACE mantém o dono e o gatilho; o
--    REVOKE e o GRANT de depois repetem os privilégios de sempre.
CREATE OR REPLACE FUNCTION public.ponto_ausencias_guardar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- As três colunas que o cancelamento pode mudar. Todo o resto da linha é
  -- imutável depois de lançada, inclusive coluna que uma versão futura
  -- acrescentar (a modalidade e as horas já entram assim).
  c_colunas_do_cancelamento constant text[] := ARRAY['cancelada_em', 'cancelada_por', 'motivo_cancelamento'];
  v_ator          uuid := auth.uid();
  v_hoje          date;
  v_extensao      text;
  v_mime          text;
  v_mime_esperado text;
  v_outra         record;
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

  -- A PRÓPRIA AUSÊNCIA (passos 3u e 3): quem é dono da ausência não a cancela
  -- nem a lança. Não há exceção de papel: quem administra e o super admin
  -- também são donos da própria ausência, como são da própria batida e da
  -- própria ficha. A comparação é com a pessoa da sessão, que o passo 1 já
  -- exigiu.

  IF TG_OP = 'UPDATE' THEN
    -- 3u. Ninguém cancela a própria ausência (cancelar e lançar de novo é o
    --     jeito de editar, e lançar para si também é recusado).
    IF OLD.usuario_id = v_ator THEN
      RAISE EXCEPTION 'Quem e dono da ausencia nao cancela a propria ausencia: peca a outra pessoa que administra o ponto ou ao super admin'
        USING ERRCODE = '42501';
    END IF;

    -- 4u. Cancelada uma vez, cancelada para sempre.
    IF OLD.cancelada_em IS NOT NULL THEN
      RAISE EXCEPTION 'Ausencia ja cancelada: o cancelamento e definitivo'
        USING ERRCODE = '42501';
    END IF;

    -- 5u. A prova não muda. Compara a linha inteira menos o cancelamento (a
    --     modalidade e as horas inclusive).
    IF (to_jsonb(NEW) - c_colunas_do_cancelamento) IS DISTINCT FROM (to_jsonb(OLD) - c_colunas_do_cancelamento) THEN
      RAISE EXCEPTION 'Ausencia lancada nao muda: so pode ser cancelada, com motivo. Para corrigir, cancele e lance de novo'
        USING ERRCODE = '42501';
    END IF;

    -- 6u. Cancelar exige motivo; autor e momento são do banco.
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

  -- 3. Ninguém lança ausência para a própria conta.
  IF NEW.usuario_id = v_ator THEN
    RAISE EXCEPTION 'Quem e dono da ausencia nao lanca a propria ausencia: peca a outra pessoa que administra o ponto ou ao super admin'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Não nasce cancelada.
  IF NEW.cancelada_em IS NOT NULL OR NEW.cancelada_por IS NOT NULL OR NEW.motivo_cancelamento IS NOT NULL THEN
    RAISE EXCEPTION 'Ausencia nao nasce cancelada: lance primeiro, cancele depois, com motivo'
      USING ERRCODE = '22023';
  END IF;

  -- 5. Carimbo.
  NEW.lancado_por   := v_ator;
  NEW.lancado_em    := now();
  NEW.observacao    := nullif(btrim(NEW.observacao), '');
  NEW.atestado_path := nullif(btrim(NEW.atestado_path), '');

  -- 6. A pessoa existe. Leitura de auth.users, nunca escrita.
  IF NEW.usuario_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.usuario_id) THEN
    RAISE EXCEPTION 'Pessoa nao encontrada: a ausencia precisa ser de uma conta existente'
      USING ERRCODE = '23503';
  END IF;

  -- 7. Tipo e período, com frase própria (os CHECKs da tabela continuam sendo
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

  -- 8. A modalidade. O app que não a manda (o que está no celular) recebe o
  --    padrão 'dias' e as horas nulas: lança por dias, como sempre. Os CHECKs
  --    seguram o mesmo; aqui é só a frase que a tela traduz.
  IF NEW.modalidade IS NULL OR NEW.modalidade NOT IN ('dias', 'horario') THEN
    RAISE EXCEPTION 'Modalidade de ausencia invalida: use dias ou horario'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.modalidade = 'dias' THEN
    IF NEW.hora_inicio IS NOT NULL OR NEW.hora_fim IS NOT NULL THEN
      RAISE EXCEPTION 'Ausencia por dias nao leva horario: para um intervalo do dia, lance por horario'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.hora_inicio IS NULL OR NEW.hora_fim IS NULL THEN
      RAISE EXCEPTION 'Ausencia por horario exige o horario inicial e o final'
        USING ERRCODE = '23502';
    END IF;
    IF NEW.dia_fim <> NEW.dia_inicio THEN
      RAISE EXCEPTION 'Ausencia por horario e de um dia so: o dia final tem de ser o mesmo do inicial'
        USING ERRCODE = '23514';
    END IF;
    IF extract(second FROM NEW.hora_inicio) <> 0 OR extract(second FROM NEW.hora_fim) <> 0
       OR NEW.hora_inicio > time '23:59' OR NEW.hora_fim > time '23:59' THEN
      RAISE EXCEPTION 'Horario fora do formato: use horas e minutos exatos, de 00:00 a 23:59'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.hora_fim <= NEW.hora_inicio THEN
      RAISE EXCEPTION 'Horario invertido: o horario final tem de ser depois do inicial'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 9. Sem duas ausências ativas da mesma pessoa cobrindo o mesmo tempo. A
  --    trava por pessoa vale até o fim da transação: dois lançamentos
  --    simultâneos para a mesma pessoa passam um de cada vez, e o segundo vê o
  --    primeiro. As canceladas não contam.
  PERFORM pg_advisory_xact_lock(hashtextextended('ponto_ausencias:' || NEW.usuario_id::text, 0));
  IF NEW.modalidade = 'dias' THEN
    -- 9a. Por dias contra por dias: a regra e a frase de sempre (o app que
    --     está no celular reconhece esta frase na nova tentativa com o mesmo
    --     id).
    IF EXISTS (
      SELECT 1 FROM public.ponto_ausencias a
      WHERE a.usuario_id = NEW.usuario_id
        AND a.cancelada_em IS NULL
        AND a.modalidade = 'dias'
        AND a.dia_inicio <= NEW.dia_fim
        AND a.dia_fim   >= NEW.dia_inicio
    ) THEN
      RAISE EXCEPTION 'Ja existe ausencia ativa desta pessoa em parte deste periodo: cancele a anterior antes de lancar de novo'
        USING ERRCODE = '23P01';
    END IF;
    -- 9b. Por dias sobre um dia que já tem ausência por horário.
    SELECT a.dia_inicio, a.hora_inicio, a.hora_fim INTO v_outra
      FROM public.ponto_ausencias a
     WHERE a.usuario_id = NEW.usuario_id
       AND a.cancelada_em IS NULL
       AND a.modalidade = 'horario'
       AND a.dia_inicio BETWEEN NEW.dia_inicio AND NEW.dia_fim
     ORDER BY a.dia_inicio, a.hora_inicio
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Ja existe ausencia por horario desta pessoa em parte deste periodo (dia %, de % a %): cancele a anterior antes de lancar por dias',
        to_char(v_outra.dia_inicio, 'DD/MM/YYYY'), left(v_outra.hora_inicio::text, 5), left(v_outra.hora_fim::text, 5)
        USING ERRCODE = '23P01';
    END IF;
  ELSE
    -- 9c. Por horário num dia coberto por uma ausência por dias.
    IF EXISTS (
      SELECT 1 FROM public.ponto_ausencias a
      WHERE a.usuario_id = NEW.usuario_id
        AND a.cancelada_em IS NULL
        AND a.modalidade = 'dias'
        AND a.dia_inicio <= NEW.dia_inicio
        AND a.dia_fim   >= NEW.dia_inicio
    ) THEN
      RAISE EXCEPTION 'Ja existe ausencia de dia inteiro desta pessoa neste dia: cancele a anterior antes de lancar por horario'
        USING ERRCODE = '23P01';
    END IF;
    -- 9d. Por horário contra por horário no mesmo dia: cruzar, não; encostar
    --     pode (o fim de uma igual ao início da outra não cruza).
    SELECT a.hora_inicio, a.hora_fim INTO v_outra
      FROM public.ponto_ausencias a
     WHERE a.usuario_id = NEW.usuario_id
       AND a.cancelada_em IS NULL
       AND a.modalidade = 'horario'
       AND a.dia_inicio = NEW.dia_inicio
       AND a.hora_inicio < NEW.hora_fim
       AND a.hora_fim    > NEW.hora_inicio
     ORDER BY a.hora_inicio
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Ja existe ausencia por horario desta pessoa que cruza este horario (de % a %): intervalos que so se encostam valem, como 14:00-16:00 e 16:00-16:30',
        left(v_outra.hora_inicio::text, 5), left(v_outra.hora_fim::text, 5)
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  -- 10. O atestado: caminho combinado, objeto no bucket, tipo batendo com a
  --     extensão.
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

-- 4. O privilégio por coluna. As colunas novas nascem sem privilégio próprio
--    (a leitura é a da tabela, que quem já lê a ausência tem). O REVOKE vem
--    antes do GRANT, como em todo o ponto, e não tira essa leitura: privilégio
--    de tabela não sai por REVOKE de coluna. O INSERT do app ganha as três; o
--    UPDATE continua só em motivo_cancelamento (nada a mudar).
REVOKE ALL (modalidade, hora_inicio, hora_fim) ON public.ponto_ausencias FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT (modalidade, hora_inicio, hora_fim) ON public.ponto_ausencias TO authenticated;

-- 5. Os comentários (sem acento, como os outros do banco). O da tabela e o da
--    função substituem os da estrutura.
COMMENT ON TABLE public.ponto_ausencias IS 'Faltas justificadas do ponto: pessoa, periodo de dias civis (por dias) ou um intervalo de horario num dia so (por horario), tipo, observacao e o atestado no bucket ponto-atestados. Lancadas so por admin do ponto, com autor e momento carimbados pelo banco, e nunca para a propria conta (nem pelo super admin); depois de lancada, so o cancelamento logico (motivo, autor, momento) muda, por outra pessoa que administra; nada se apaga. A pessoa le as proprias.';
COMMENT ON COLUMN public.ponto_ausencias.modalidade IS 'dias (o periodo dia_inicio a dia_fim, dias inteiros; o padrao, e o que o app que nao manda a coluna lanca) ou horario (um intervalo de hora_inicio a hora_fim num dia so, dia_inicio = dia_fim). As ausencias anteriores a migration da ausencia por horario sao todas por dias. Nao muda depois de lancada.';
COMMENT ON COLUMN public.ponto_ausencias.hora_inicio IS 'O inicio da ausencia por horario, no relogio de Brasilia do dia dia_inicio (o mesmo do dia_civil das batidas e dos blocos da jornada). Minuto exato, de 00:00 a 23:59. Nula na ausencia por dias. Nao muda depois de lancada.';
COMMENT ON COLUMN public.ponto_ausencias.hora_fim IS 'O fim da ausencia por horario, depois de hora_inicio, no mesmo dia. Minuto exato, de 00:00 a 23:59. Nula na ausencia por dias. Intervalos ativos da mesma pessoa no mesmo dia nao se cruzam; encostar pode (14:00-16:00 e 16:00-16:30). Nao muda depois de lancada.';
COMMENT ON CONSTRAINT ponto_ausencias_modalidade_coerente ON public.ponto_ausencias IS 'A modalidade e dias (sem horario) ou horario (as duas horas, um dia so, o fim depois do inicio), tambem sem o gatilho.';
COMMENT ON CONSTRAINT ponto_ausencias_horario_no_minuto ON public.ponto_ausencias IS 'As horas da ausencia sao em minuto exato (sem segundos), de 00:00 a 23:59, tambem sem o gatilho.';
COMMENT ON FUNCTION public.ponto_ausencias_guardar() IS 'BEFORE INSERT OR UPDATE de ponto_ausencias. Exige sessao de admin do ponto. Para todo mundo, inclusive o super admin, recusa (42501) lancar ausencia para a propria conta e cancelar a propria ausencia. INSERT: carimba lancado_por/lancado_em, confere pessoa, tipo, periodo (ordem, 120 dias, janela de um ano), a modalidade (por dias sem horario; por horario num dia so, fim depois do inicio, minuto exato), a sobreposicao com ausencia ativa da mesma pessoa (dias com dias, horario em dia de ausencia por dias e o contrario, horarios que se cruzam; encostar pode), com a trava por pessoa, e o atestado no bucket ponto-atestados. UPDATE: so o cancelamento, uma vez, com motivo; autor e momento carimbados; o resto da linha (modalidade e horas inclusive) nao muda.';

-- 6. Fim: a conferência do que mudou. Só lê; se algo não bater, a migration
--    inteira volta atrás. Depois, o aviso ao PostgREST para reler o esquema
--    (as colunas novas aparecem na API; só chega se a transação for
--    confirmada).
DO $fim$
DECLARE
  v_antes  text := current_setting('ponto.ausencias_antes_do_horario', true);
  v_depois text;
  v_fora   bigint;
  v_n      integer;
  v_funcao oid := 'public.ponto_ausencias_guardar()'::regprocedure;
BEGIN
  -- 6a. Nenhuma ausência antiga mudou: a mesma impressão da partida, sem as
  --     três colunas novas, e as três em 'dias', nula e nula.
  SELECT count(*)::text || ' ' || md5(coalesce(string_agg((to_jsonb(a) - ARRAY['modalidade', 'hora_inicio', 'hora_fim'])::text, E'\n' ORDER BY a.id), '')),
         count(*) FILTER (WHERE a.modalidade <> 'dias' OR a.hora_inicio IS NOT NULL OR a.hora_fim IS NOT NULL)
    INTO v_depois, v_fora
    FROM public.ponto_ausencias a;
  IF v_antes IS NULL OR v_antes <> v_depois OR v_fora <> 0 THEN
    RAISE EXCEPTION 'Ausencia por horario desfeita: as ausencias gravadas mudaram (% de antes, % de depois, % fora de "dias" sem horario).',
      coalesce(split_part(v_antes, ' ', 1), 'sem a impressao da partida'), split_part(v_depois, ' ', 1), v_fora
      USING ERRCODE = '23514';
  END IF;

  -- 6b. As três colunas, com o tipo, a obrigatoriedade e o padrão.
  SELECT count(*) INTO v_n FROM pg_attribute a
  WHERE a.attrelid = 'public.ponto_ausencias'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND ((a.attname = 'modalidade' AND a.atttypid = 'text'::regtype AND a.attnotnull AND a.atthasdef)
      OR (a.attname IN ('hora_inicio', 'hora_fim') AND a.atttypid = 'time without time zone'::regtype
          AND NOT a.attnotnull AND NOT a.atthasdef));
  IF v_n <> 3
     OR (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         WHERE d.adrelid = 'public.ponto_ausencias'::regclass AND a.attname = 'modalidade') IS DISTINCT FROM '''dias''::text' THEN
    RAISE EXCEPTION 'Ausencia por horario desfeita: as colunas modalidade, hora_inicio e hora_fim nao nasceram como deviam (% de 3, ou o padrao da modalidade nao e dias).', v_n
      USING ERRCODE = '23514';
  END IF;

  -- 6c. As duas restrições, validadas.
  SELECT count(*) INTO v_n FROM pg_constraint k
  WHERE k.conrelid = 'public.ponto_ausencias'::regclass AND k.contype = 'c' AND k.convalidated
    AND k.conname IN ('ponto_ausencias_modalidade_coerente', 'ponto_ausencias_horario_no_minuto');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Ausencia por horario desfeita: % de 2 restricoes da modalidade nasceram validadas.', v_n
      USING ERRCODE = '23514';
  END IF;

  -- 6d. O gatilho, ligado e com a função trocada; a função do jeito de
  --     sempre: SECURITY DEFINER, search_path fixo, EXECUTE só do
  --     service_role (nada para anon, authenticated nem PUBLIC;
  --     has_function_privilege olha também o que vem de PUBLIC). E o corpo é o
  --     desta migration: tem a trava da própria ausência e a modalidade.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgrelid = 'public.ponto_ausencias'::regclass AND NOT t.tgisinternal
                   AND t.tgname = 'trg_ponto_ausencias_guardar' AND t.tgfoid = v_funcao AND t.tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = v_funcao AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg WHERE cfg LIKE 'search_path=%')
                      AND p.prosrc LIKE '%Quem e dono da ausencia nao lanca a propria ausencia%'
                      AND p.prosrc LIKE '%Quem e dono da ausencia nao cancela a propria ausencia%'
                      AND p.prosrc LIKE '%Modalidade de ausencia invalida%')
     OR has_function_privilege('anon', v_funcao, 'EXECUTE')
     OR has_function_privilege('authenticated', v_funcao, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION 'Ausencia por horario desfeita: o gatilho trg_ponto_ausencias_guardar ou a funcao ponto_ausencias_guardar nao ficaram como deviam (ligado, SECURITY DEFINER, search_path fixo, a trava da propria ausencia, EXECUTE so do service_role).'
      USING ERRCODE = '42501';
  END IF;

  -- 6e. Os privilégios das colunas novas: o app as lança (INSERT) e não as
  --     muda (sem UPDATE); o UPDATE continua só no motivo do cancelamento;
  --     anon sem nada; ninguém do app apaga.
  IF NOT has_column_privilege('authenticated', 'public.ponto_ausencias', 'modalidade', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.ponto_ausencias', 'hora_inicio', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.ponto_ausencias', 'hora_fim', 'INSERT')
     OR has_column_privilege('authenticated', 'public.ponto_ausencias', 'modalidade', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.ponto_ausencias', 'hora_inicio', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.ponto_ausencias', 'hora_fim', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.ponto_ausencias', 'motivo_cancelamento', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.ponto_ausencias', 'lancado_por', 'INSERT')
     OR has_column_privilege('anon', 'public.ponto_ausencias', 'modalidade', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_column_privilege('anon', 'public.ponto_ausencias', 'hora_inicio', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_column_privilege('anon', 'public.ponto_ausencias', 'hora_fim', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_table_privilege('authenticated', 'public.ponto_ausencias', 'DELETE')
     OR has_table_privilege('authenticated', 'public.ponto_ausencias', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Ausencia por horario desfeita: os privilegios das colunas novas nao ficaram como deviam (INSERT do app, sem UPDATE, nada para anon).'
      USING ERRCODE = '42501';
  END IF;

  RAISE NOTICE 'Ausencia por horario aplicada: 3 colunas, 2 restricoes, o gatilho das ausencias com a trava da propria ausencia e a sobreposicao nova, e o INSERT das colunas novas; % ausencia(s) antiga(s) iguais, todas por dias.',
    split_part(v_depois, ' ', 1);
END $fim$;

NOTIFY pgrst, 'reload schema';
