#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# TESTES DE BANCO NO SUPABASE LOCAL (`npm run db:testar`)
#
# Roda os arquivos de `supabase/testes/` no banco do Supabase local e só sai
# com 0 se todos passarem e se nada ficar gravado. É a mesma prova que o CI
# roda, no trabalho `banco` de `.github/workflows/conferir.yml`.
#
#   npm run db:testar                                todos os arquivos
#   npm run db:testar -- blindagem.sql acesso.sql    só os citados
#
# Antes, o Supabase local tem de estar de pé (`npm run db:iniciar`) e com a
# estrutura aplicada (`npm run db:zerar` recria o banco do zero). O script não
# muda nada no banco: cada arquivo abre a própria transação e a desfaz no fim.
#
# COMO CADA ARQUIVO RODA: pelo psql de DENTRO do contêiner do banco
# (`supabase_db_<project_id>`, o nome que o Supabase CLI dá a partir do
# `project_id` de supabase/config.toml), como `postgres`, pelo socket local do
# contêiner (nenhuma senha é lida nem passada), com ON_ERROR_STOP e
# VERBOSITY=terse, um arquivo por vez. `postgres` porque é o papel que aplica a
# migration no Supabase hospedado, sem superusuário: o que passa aqui passa
# lá. Um arquivo passa só se:
#   1. o psql sai com 0 (um erro, ou um FALHOU, que o bloco `$conferir$` do
#      arquivo transforma em erro, faz o psql sair com 3; a transação é
#      desfeita do mesmo jeito);
#   2. a última linha da saída é ROLLBACK (o próprio arquivo desfez tudo);
#   3. a saída tem linhas "OK" e nenhuma "FALHOU".
#
# NADA FICA: antes e depois de todos os arquivos, o script tira a impressão do
# que os testes poderiam deixar (contagem e md5 de cada tabela public.ponto_*,
# das contas de auth.users e dos objetos dos dois buckets do ponto, lidos numa
# transação só de leitura) e exige as duas iguais. O md5 nunca é impresso: a
# saída mostra só o nome, as contagens e "igual" ou "DIFERENTE".
#
# OS PRIMEIROS MINUTOS DO DIA: o pedido de batida esquecida só vale para hoje,
# antes de agora (no horário de Brasília), e o teste dele usa alguns minutos de
# "hoje" antes do minuto de agora. Se um arquivo for começar antes das 00h05 de
# Brasília, o script espera dar 00h05 (no máximo cinco minutos) em vez de dar
# um falso alarme.
#
# O QUE NÃO VOLTA NO ROLLBACK: a sequência de ponto_pin_tentativas (sequência do
# Postgres não é transacional). Os testes que conferem PIN deixam o próximo id
# maior; nenhuma linha fica, e a impressão compara linhas, não a sequência.
#
# NÃO IMPRIME SEGREDO NEM DADO PESSOAL: as linhas OK e FALHOU dos testes trazem
# só booleanos, contagens e frases de recusa, sobre pessoas sintéticas; a
# impressão sai só com nomes de tabela e contagens. O script não lê `.env` nem
# chave nenhuma.
#
# Compatível com o bash 3.2 do macOS: sem mapfile, sem vetor associativo e sem
# expandir vetor vazio com `set -u`.
# ---------------------------------------------------------------------------
set -euo pipefail
export LC_ALL=C

raiz=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pasta="$raiz/supabase/testes"
config="$raiz/supabase/config.toml"

falha() {
  printf 'ABORTADO: %s\n' "$*" >&2
  exit 1
}

case "${1:-}" in
  -h | --help)
    sed -n '2,/^# ----/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

# ---------------------------------------------------------------------------
# O contêiner do banco, pelo project_id do supabase/config.toml
# ---------------------------------------------------------------------------
[ -f "$config" ] || falha "falta supabase/config.toml (rode o script de dentro do repositório)."
projeto=$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$config" | head -n 1)
[[ "$projeto" =~ ^[A-Za-z0-9_.-]+$ ]] || falha "não achei o project_id em supabase/config.toml."
conteiner="supabase_db_${projeto}"

command -v docker > /dev/null 2>&1 \
  || falha "o docker não está no PATH. O Supabase local roda em contêineres: instale e ligue o Docker e rode npm run db:iniciar."

# De pé = rodando e, se o contêiner tem verificação de saúde, saudável (o
# Supabase CLI põe uma no banco). "starting" ainda não aceita conexão.
estado=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}sem-verificacao{{end}}' "$conteiner" 2> /dev/null || true)
case "$estado" in
  "running healthy" | "running sem-verificacao") ;;
  *) falha "o banco do Supabase local ($conteiner) não está de pé (estado: ${estado:-não existe}). Suba o Supabase local com: npm run db:iniciar" ;;
esac

# O psql do contêiner, como postgres. PGCLIENTENCODING=UTF8: os nomes do
# elenco têm acento, e o locale do contêiner pode não ser UTF-8.
psql_banco() {
  docker exec -i -e PGCLIENTENCODING=UTF8 "$conteiner" \
    psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse "$@"
}

estrutura=$(psql_banco -At -c "SELECT to_regclass('public.ponto_registros') IS NOT NULL AND to_regclass('public.ponto_super_admins') IS NOT NULL" 2>&1) \
  || falha "o psql do contêiner $conteiner não respondeu: ${estrutura}"
[ "$estrutura" = "t" ] || falha "a estrutura do ponto não está aplicada no banco local. Recrie o banco com: npm run db:zerar"

# ---------------------------------------------------------------------------
# Quais arquivos
# ---------------------------------------------------------------------------
nomes=()
if [ "$#" -gt 0 ]; then
  for argumento in "$@"; do
    nome=$(basename "$argumento")
    case "$nome" in
      *.sql) ;;
      *) nome="$nome.sql" ;;
    esac
    nomes+=("$nome")
  done
else
  for arquivo in "$pasta"/*.sql; do
    [ -e "$arquivo" ] && nomes+=("$(basename "$arquivo")")
  done
fi
[ "${#nomes[@]}" -gt 0 ] || falha "nenhum teste em supabase/testes/."
for nome in "${nomes[@]}"; do
  # O mesmo padrão que o teste estático (src/banco.test.ts) exige dos arquivos.
  [[ "$nome" =~ ^[a-z0-9_]+\.sql$ ]] || falha "nome de teste fora do padrão (letras minúsculas, números e _): $nome"
  [ -f "$pasta/$nome" ] || falha "falta supabase/testes/$nome"
done

# ---------------------------------------------------------------------------
# A impressão do que os testes poderiam deixar, só lendo
# ---------------------------------------------------------------------------
# Uma linha por tabela do ponto ("nome contagem md5"), uma das contas e uma
# dos arquivos dos dois buckets. Ninguém a imprime: só se compara.
impressao() {
  psql_banco -q -At << 'SQL'
BEGIN TRANSACTION READ ONLY;
SELECT c.relname || ' ' || (xpath('/row/i/text()', query_to_xml(format(
         'SELECT count(*)::text || '' '' || md5(coalesce(string_agg(t::text, '','' ORDER BY t::text), '''')) AS i FROM public.%I t',
         c.relname), false, true, '')))[1]::text
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'ponto%'
 ORDER BY c.relname;
SELECT 'auth.users ' || count(*) || ' ' || md5(coalesce(string_agg(
         concat_ws(':', u.id, u.email, u.encrypted_password, u.raw_user_meta_data, u.raw_app_meta_data, u.banned_until, u.deleted_at),
         ',' ORDER BY u.id), ''))
  FROM auth.users u;
SELECT 'storage.objects ' || count(*) || ' ' || md5(coalesce(string_agg(
         concat_ws(':', o.id, o.bucket_id, o.name, o.owner_id, o.metadata), ',' ORDER BY o.id), ''))
  FROM storage.objects o
 WHERE o.bucket_id IN ('ponto-selfies', 'ponto-atestados');
ROLLBACK;
SQL
}

# Compara duas impressões pelo nome de cada linha. Imprime o nome, as duas
# contagens e "igual" ou "DIFERENTE"; sai com 1 se alguma linha mudou.
comparar_impressoes() {
  awk '
    FNR == NR { contagem_antes[$1] = $2; md5_antes[$1] = $3; nomes[++total] = $1; next }
    {
      contagem_depois[$1] = $2; md5_depois[$1] = $3
      if (!($1 in contagem_antes)) nomes[++total] = $1
    }
    END {
      mudou = 0
      for (i = 1; i <= total; i++) {
        nome = nomes[i]
        igual = (nome in contagem_antes) && (nome in contagem_depois) \
                && contagem_antes[nome] == contagem_depois[nome] && md5_antes[nome] == md5_depois[nome]
        if (!igual) mudou = 1
        printf "  %-26s %5s antes, %5s depois: %s\n", nome,
          (nome in contagem_antes) ? contagem_antes[nome] : "-",
          (nome in contagem_depois) ? contagem_depois[nome] : "-",
          igual ? "igual" : "DIFERENTE"
      }
      exit mudou
    }' <(printf '%s\n' "$1") <(printf '%s\n' "$2")
}

# Nos primeiros minutos do dia de Brasília, espera dar 00h05 (ver o cabeçalho).
# A hora é a do próprio banco, a mesma que os testes usam.
esperar_os_primeiros_minutos_do_dia() {
  local segundos
  segundos=$(psql_banco -At -c "SELECT greatest(0, ceil(extract(epoch FROM date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '5 minutes 5 seconds' - (now() AT TIME ZONE 'America/Sao_Paulo'))))::int")
  if [ "$segundos" -gt 0 ]; then
    echo "   (começo do dia em Brasília: o pedido de batida esquecida só vale para hoje, antes de agora; esperando ${segundos}s)"
    sleep "$segundos"
  fi
}

# ---------------------------------------------------------------------------
# Os testes
# ---------------------------------------------------------------------------
echo "Testes de banco no Supabase local ($conteiner): ${#nomes[@]} arquivo(s)"

antes=$(impressao 2>&1) || falha "a impressão de antes não saiu: $antes"

total=0
passaram=0
casos=0
resumo=()
for nome in "${nomes[@]}"; do
  total=$((total + 1))
  esperar_os_primeiros_minutos_do_dia
  status=0
  saida=$(psql_banco -At -f - < "$pasta/$nome" 2>&1) || status=$?
  ultima=$(printf '%s\n' "$saida" | grep -v '^[[:space:]]*$' | tail -n 1 || true)
  oks=$(printf '%s\n' "$saida" | grep -c '^OK ' || true)
  falhas=$(printf '%s\n' "$saida" | grep -c '^FALHOU' || true)

  echo
  echo "== $nome"
  printf '%s\n' "$saida" | grep -E '^(OK|FALHOU) ' || true
  if [ "$status" -eq 0 ] && [ "$ultima" = "ROLLBACK" ] && [ "$oks" -gt 0 ] && [ "$falhas" -eq 0 ]; then
    passaram=$((passaram + 1))
    casos=$((casos + oks))
    echo "-> PASSOU: $oks OK, nenhum FALHOU, terminou em ROLLBACK"
    resumo+=("$(printf '  %-24s PASSOU     %3s OK' "$nome" "$oks")")
  else
    # O erro do psql (a linha que parou o arquivo), para saber onde olhar.
    printf '%s\n' "$saida" | grep -E '(ERROR|FATAL|WARNING):' || true
    echo "-> NÃO PASSOU: o psql saiu com $status, a última linha foi '$ultima', $oks OK e $falhas FALHOU"
    resumo+=("$(printf '  %-24s NÃO PASSOU %3s OK, %s FALHOU (psql: %s)' "$nome" "$oks" "$falhas" "$status")")
  fi
done

depois=$(impressao 2>&1) || falha "a impressão de depois não saiu: $depois"

echo
echo "---- Resumo por arquivo"
for linha in "${resumo[@]}"; do
  printf '%s\n' "$linha"
done

echo
echo "---- O que ficou no banco (contagem e conteúdo antes e depois de todos os testes)"
nada_ficou=1
comparar_impressoes "$antes" "$depois" || nada_ficou=0

echo
if [ "$passaram" -eq "$total" ] && [ "$nada_ficou" -eq 1 ]; then
  echo "TESTES DE BANCO: $passaram de $total arquivo(s) passaram ($casos casos OK), todos terminaram em ROLLBACK, e nada ficou no banco."
  exit 0
fi
if [ "$nada_ficou" -eq 1 ]; then
  echo "TESTES DE BANCO: $passaram de $total arquivo(s) passaram. Nada ficou no banco."
else
  echo "TESTES DE BANCO: $passaram de $total arquivo(s) passaram, e a impressão MUDOU: algo ficou gravado, ou alguém usou o banco durante os testes."
fi
exit 1
