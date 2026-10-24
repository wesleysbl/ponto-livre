import { describe, expect, it } from 'vitest'

/*
 * O BANCO DO PONTO, LIDO COMO TEXTO: AS REGRAS QUE TODA PEÇA DA ESTRUTURA SEGUE.
 *
 * A estrutura inteira do banco é uma migration só, no formato do Supabase CLI
 * (`supabase/migrations/<version>_ponto_livre_estrutura.sql`). Os testes de
 * banco de verdade rodam num Supabase local; estes leem o arquivo e conferem as
 * invariantes que valem para qualquer peça, a de hoje e a que vier depois,
 * antes de ela chegar a um banco:
 *   • o arquivo existe, tem nome de migration do CLI e não está vazio;
 *   • roda inteiro na transação que o CLI abre, como postgres, sem superusuário
 *     e sem troca de papel; a partida confere os pré-requisitos antes da
 *     primeira mudança;
 *   • toda tabela e toda sequência nascem com REVOKE ALL dos quatro papéis (o
 *     padrão do Supabase dá tudo a todos) e, as tabelas, com RLS ligada;
 *   • toda função tem search_path fixo, nasce com REVOKE ALL dos quatro papéis
 *     e devolve EXECUTE só a service_role e a authenticated;
 *   • nada é concedido a anon nem a PUBLIC; toda regra de acesso é só para
 *     authenticated, e as de storage.objects filtram pelo bucket do ponto;
 *   • o que o postgres criar depois em public nasce sem nada para anon,
 *     authenticated e PUBLIC (os privilégios padrão);
 *   • a conferência do fim e o cabeçalho contam o que o arquivo cria.
 *
 * As invariantes de segurança (transação do CLI, nenhuma troca de papel,
 * REVOKE antes de GRANT, RLS ligada e nunca desligada, search_path fixo, nada
 * para anon nem PUBLIC, nem pelos privilégios padrão, regras só para
 * authenticated) valem para TODA migration da pasta, em ordem: a de quem
 * estender o ponto não passa por fora delas. As contagens e a partida são só
 * da estrutura, que é a primeira.
 *
 * E os arquivos dos testes de banco (`supabase/testes/*.sql`, que o
 * `npm run db:testar` roda no Supabase local e o CI roda no trabalho `banco`),
 * antes de eles chegarem a um banco:
 *   • existem os oito, com o nome no padrão que o script aceita, e nenhum está
 *     vazio;
 *   • cada um abre com BEGIN, põe a marca de transação logo depois e termina
 *     em ROLLBACK, sem COMMIT em lugar nenhum (nem dentro de um DO): o que o
 *     teste escreve nunca fica;
 *   • a partida confere a marca e exige `postgres` sem superusuário; o bloco
 *     `$conferir$` transforma qualquer FALHOU em erro;
 *   • só troca de papel para os do app e o da função de contas, com SET LOCAL;
 *   • as contas sintéticas só usam e-mail no domínio reservado example.invalid;
 *   • a conferência da estrutura (`estrutura.sql`) conta o que a migration cria.
 *
 * Pelo `import.meta.glob` do Vite (`?raw`): o `tsc -b` do app não conhece
 * `node:fs`. Cada detector tem um teste com SQL de exemplo, para que um
 * detector quebrado não deixe tudo passar.
 */

const migrations = import.meta.glob<string>('../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const nomeDoArquivo = (caminho: string) => caminho.split('/').pop() ?? caminho
const ARQUIVOS = Object.keys(migrations).map(nomeDoArquivo).sort()
const ESTRUTURA = Object.entries(migrations).find(([caminho]) => /_ponto_livre_estrutura\.sql$/.test(caminho))?.[1] ?? ''
/** Todas as migrations, na ordem em que o CLI as aplica (o nome começa pela data). */
const MIGRATIONS = Object.entries(migrations)
  .map(([caminho, sql]) => ({ nome: nomeDoArquivo(caminho), sql }))
  .sort((a, b) => a.nome.localeCompare(b.nome))

const testesDeBanco = import.meta.glob<string>('../supabase/testes/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const TESTES_DE_BANCO = Object.entries(testesDeBanco)
  .map(([caminho, sql]) => ({ nome: nomeDoArquivo(caminho), sql }))
  .sort((a, b) => a.nome.localeCompare(b.nome))
/** Os oito arquivos de testes de banco: a blindagem, as regras de cada parte do ponto e a conferência da estrutura. */
const TESTES_ESPERADOS = [
  'acesso.sql',
  'ausencias.sql',
  'batida_esquecida.sql',
  'blindagem.sql',
  'estrutura.sql',
  'local.sql',
  'trava_de_futuro.sql',
  'trilha_de_contas.sql',
]

const PAPEIS = ['public', 'anon', 'authenticated', 'service_role']

/* ------------------------------------------------------------------ */
/* Leitura do SQL                                                      */
/* ------------------------------------------------------------------ */

/**
 * O SQL sem comentários (`--` e `/* *\/`). Com `semTexto`, também sem o
 * conteúdo dos literais de string (`'...'`, `E'...'`) e dos identificadores
 * entre aspas duplas: sobra só o que executa. O corpo `$...$` de uma função
 * ou de um DO é código e fica. As quebras de linha ficam todas.
 */
function limpar(sql: string, semTexto: boolean): string {
  let saida = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const fim = sql.indexOf('*/', i + 2)
      const comentario = sql.slice(i, fim < 0 ? sql.length : fim + 2)
      saida += comentario.replace(/[^\n]/g, ' ')
      i += comentario.length
      continue
    }
    if (c === "'" || c === '"') {
      // Em E'...' a barra escapa a aspa; nos outros, a aspa se escapa dobrada.
      const comBarra = c === "'" && /(?:^|\W)E$/i.test(saida.slice(-2))
      let j = i + 1
      while (j < sql.length) {
        if (comBarra && sql[j] === '\\') j += 2
        else if (sql[j] === c && sql[j + 1] === c) j += 2
        else if (sql[j] === c) break
        else j++
      }
      const literal = sql.slice(i, j + 1)
      saida += semTexto ? c + literal.slice(1, -1).replace(/[^\n]/g, '') + c : literal
      i = j + 1
      continue
    }
    saida += c
    i++
  }
  return saida
}

/** Só o que executa: sem comentários e sem o conteúdo dos textos. */
const soCodigo = (sql: string) => limpar(sql, true)

/** Como `soCodigo`, e com o corpo de toda função e de todo DO em branco (o mesmo tamanho). */
const nivelDeCima = (sql: string) =>
  soCodigo(sql).replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, (corpo) => corpo.replace(/[^\n]/g, ' '))

/** As instruções do nível de cima, em ordem, cada uma com a posição em `soCodigo`. */
function instrucoesDeCima(sql: string): { texto: string; posicao: number }[] {
  const cima = nivelDeCima(sql)
  const instrucoes: { texto: string; posicao: number }[] = []
  let inicio = 0
  for (let k = 0; k <= cima.length; k++) {
    if (k === cima.length || cima[k] === ';') {
      const pedaco = cima.slice(inicio, k)
      const texto = pedaco.trim().replace(/\s+/g, ' ')
      if (texto) instrucoes.push({ texto, posicao: inicio + pedaco.search(/\S/) })
      inicio = k + 1
    }
  }
  return instrucoes
}

/** Instruções de controle de transação no nível de cima (dentro de função ou DO, BEGIN e END são outra coisa). */
const controleDeTransacao = (sql: string) =>
  instrucoesDeCima(sql)
    .map((instrucao) => instrucao.texto)
    .filter((texto) => /^(?:BEGIN|COMMIT|ROLLBACK|END|ABORT|SAVEPOINT|RELEASE|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b/i.test(texto))

/**
 * O que o nível de cima pode fazer numa migration de estrutura: criar,
 * conceder, revogar (inclusive os privilégios padrão), comentar, conferir.
 */
const FORMAS_ACEITAS =
  /^(?:SET LOCAL|DO|CREATE|ALTER (?:TABLE|SEQUENCE)|ALTER DEFAULT PRIVILEGES\b[^;]*\bREVOKE\b|GRANT|REVOKE|COMMENT ON|INSERT INTO storage\.buckets|NOTIFY)\b/i

const instrucoesForaDasFormas = (sql: string) =>
  instrucoesDeCima(sql)
    .map((instrucao) => instrucao.texto)
    .filter((texto) => !FORMAS_ACEITAS.test(texto) || /\bDROP\b/i.test(texto))

/** Onde começa a primeira instrução do nível de cima que muda o banco (SET LOCAL e DO não mudam). */
function primeiraMudanca(sql: string): number {
  const mudanca = instrucoesDeCima(sql).find((instrucao) => !/^(?:SET LOCAL|DO)\b/i.test(instrucao.texto))
  return mudanca?.posicao ?? Number.POSITIVE_INFINITY
}

/* ------------------------------------------------------------------ */
/* As regras de cada peça                                               */
/* ------------------------------------------------------------------ */

/** Tabelas e sequências: REVOKE ALL dos quatro papéis depois do CREATE e antes de qualquer GRANT; RLS nas tabelas. */
function problemasDasRelacoes(sql: string): string[] {
  const codigo = soCodigo(sql)
  const problemas: string[] = []
  for (const m of codigo.matchAll(/\bCREATE\s+(TABLE|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi)) {
    const [tipo, nome] = [m[1].toUpperCase(), m[2]]
    if (!/^ponto_/.test(nome)) problemas.push(`${nome}: fora do prefixo ponto_`)
    const objeto = tipo === 'TABLE' ? String.raw`(?:TABLE\s+)?` : String.raw`SEQUENCE\s+`
    const revoke = new RegExp(
      String.raw`\bREVOKE\s+ALL\s+ON\s+${objeto}public\.${nome}\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role;`,
      'i',
    ).exec(codigo)
    if (!revoke || revoke.index < (m.index ?? 0)) {
      problemas.push(`${nome}: sem REVOKE ALL de PUBLIC, anon, authenticated e service_role depois do CREATE`)
    }
    const grant = new RegExp(String.raw`\bGRANT\b[^;]*\bON\s+${objeto}public\.${nome}\b`, 'i').exec(codigo)
    if (revoke && grant && grant.index < revoke.index) problemas.push(`${nome}: GRANT antes do REVOKE`)
    if (tipo === 'TABLE' && !new RegExp(String.raw`\bALTER\s+TABLE\s+public\.${nome}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;`, 'i').test(codigo)) {
      problemas.push(`${nome}: sem RLS`)
    }
  }
  return problemas
}

/** Os papéis de cada REVOKE ou GRANT de uma função, com a posição. */
function concessoesDaFuncao(codigo: string, verbo: 'REVOKE' | 'GRANT', nome: string) {
  const preposicao = verbo === 'REVOKE' ? 'FROM' : 'TO'
  const expressao = new RegExp(
    String.raw`\b${verbo}\s+(ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+(?:FUNCTION|ROUTINE)\s+public\.${nome}\s*\([^)]*\)\s+${preposicao}\s+([^;]+);`,
    'gi',
  )
  return [...codigo.matchAll(expressao)].map((m) => ({
    privilegio: m[1].toUpperCase(),
    papeis: m[2].split(',').map((papel) => papel.trim().toLowerCase()),
    posicao: m.index ?? 0,
  }))
}

/**
 * Funções: search_path fixo no cabeçalho (toda função, não só as DEFINER: um
 * gatilho INVOKER também roda com o search_path de quem disparou); REVOKE ALL
 * dos quatro papéis depois do CREATE (o padrão do Supabase dá EXECUTE a anon e
 * a authenticated, e o do Postgres, a PUBLIC); EXECUTE de volta só a
 * service_role e a authenticated, depois do REVOKE.
 */
function problemasDasFuncoes(sql: string): string[] {
  const codigo = soCodigo(sql)
  const problemas: string[] = []
  for (const m of codigo.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\([\s\S]*?\bAS\s+\$/gi)) {
    const nome = m[1].replace(/^public\./i, '')
    if (!/^public\./i.test(m[1]) || !/^ponto_/.test(nome)) problemas.push(`${m[1]}: fora de public.ponto_`)
    if (!/\bSET\s+search_path\s*(?:=|\bTO\b)/i.test(m[0])) problemas.push(`${nome}: sem search_path fixo`)
    const revogacao = concessoesDaFuncao(codigo, 'REVOKE', nome).find(
      (r) => r.privilegio.startsWith('ALL') && r.posicao > (m.index ?? 0) && PAPEIS.every((papel) => r.papeis.includes(papel)),
    )
    if (!revogacao) problemas.push(`${nome}: sem REVOKE ALL de PUBLIC, anon, authenticated e service_role depois do CREATE`)
    const concessoes = concessoesDaFuncao(codigo, 'GRANT', nome)
    if (concessoes.length === 0) problemas.push(`${nome}: sem GRANT EXECUTE`)
    for (const concessao of concessoes) {
      const fora = concessao.papeis.filter((papel) => papel !== 'service_role' && papel !== 'authenticated')
      if (fora.length > 0) problemas.push(`${nome}: GRANT para ${fora.join(', ')}`)
      if (revogacao && concessao.posicao < revogacao.posicao) problemas.push(`${nome}: GRANT antes do REVOKE`)
    }
  }
  return problemas
}

/** GRANT de qualquer coisa para anon ou PUBLIC. */
const concessoesAoPublico = (sql: string) =>
  [...soCodigo(sql).matchAll(/\bGRANT\b[^;]*\bTO\s+(?:[\w, ]*,\s*)?(?:anon|PUBLIC)\b[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, ' '))

/** As regras de acesso (CREATE POLICY), com o texto e sem os comentários. */
const regrasDeAcesso = (sql: string) =>
  [...limpar(sql, false).matchAll(/\bCREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([\w.]+)([^;]*);/gi)].map((m) => ({
    nome: m[1],
    alvo: m[2],
    corpo: m[3].replace(/\s+/g, ' '),
  }))

/** Regras só para authenticated; as de storage.objects, presas a um bucket do ponto. */
function problemasDasRegras(sql: string): string[] {
  const problemas: string[] = []
  for (const regra of regrasDeAcesso(sql)) {
    const papeis = /\bTO\s+([\w, ]+?)(?:\s+(?:USING|WITH)\b|$)/i.exec(regra.corpo)?.[1].split(',').map((papel) => papel.trim().toLowerCase()) ?? []
    if (papeis.join(',') !== 'authenticated') problemas.push(`${regra.nome}: para ${papeis.join(', ') || 'todos'}, e não só para authenticated`)
    if (regra.alvo === 'storage.objects' && !/\bbucket_id\s*=\s*'ponto-(?:selfies|atestados)'::text/.test(regra.corpo)) {
      problemas.push(`${regra.nome}: regra de storage.objects sem o bucket do ponto`)
    }
  }
  return problemas
}

/**
 * As invariantes de segurança de UMA migration, qualquer que seja (a da
 * estrutura ou a de quem estender o ponto). Juntas, para cada arquivo da
 * pasta responder de uma vez:
 *   • roda na transação que o CLI abre (nenhum BEGIN, COMMIT nem ROLLBACK no
 *     nível de cima) e ajusta só até o fim dela (SET LOCAL);
 *   • roda como postgres, sem superusuário e sem trocar de papel;
 *   • toda tabela e sequência nasce com REVOKE ALL dos quatro papéis e, a
 *     tabela, com RLS; toda função com search_path fixo, REVOKE ALL e EXECUTE
 *     só para service_role e authenticated;
 *   • nada para anon nem PUBLIC, nem pelos privilégios padrão (e os privilégios
 *     padrão também não voltam para authenticated);
 *   • a RLS nunca é desligada;
 *   • toda regra de acesso é só para authenticated, e as de storage.objects
 *     ficam presas ao bucket do ponto.
 */
function problemasDaMigration(sql: string): string[] {
  const problemas: string[] = []
  const controle = controleDeTransacao(sql)
  if (controle.length > 0) problemas.push(`controle de transação no nível de cima: ${controle.join(', ')}`)
  for (const instrucao of instrucoesDeCima(sql)) {
    if (/^SET\b/i.test(instrucao.texto) && !/^SET LOCAL\b/i.test(instrucao.texto)) problemas.push(`SET que passa da transação: ${instrucao.texto}`)
  }
  if (/supabase_admin/i.test(sql)) problemas.push('cita supabase_admin')
  if (/rolsuper/i.test(sql)) problemas.push('cita rolsuper')
  if (/\b(?:SET|RESET)\s+(?:LOCAL\s+|SESSION\s+)?ROLE\b|\bSESSION\s+AUTHORIZATION\b/i.test(sql)) problemas.push('troca de papel')
  problemas.push(...problemasDasRelacoes(sql), ...problemasDasFuncoes(sql), ...problemasDasRegras(sql))
  for (const concessao of concessoesAoPublico(sql)) problemas.push(`concede a anon ou PUBLIC: ${concessao}`)
  const codigo = soCodigo(sql)
  for (const m of codigo.matchAll(/\bALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*\bGRANT\b[^;]*\bTO\s+[^;]*\bauthenticated\b[^;]*;/gi)) {
    problemas.push(`privilégio padrão para authenticated: ${m[0].replace(/\s+/g, ' ')}`)
  }
  for (const m of codigo.matchAll(/\bALTER\s+TABLE\b[^;]*\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b[^;]*/gi)) {
    problemas.push(`RLS desligada: ${m[0].trim().replace(/\s+/g, ' ')}`)
  }
  return problemas
}

/** O que o arquivo cria, contado no texto. */
function contagemDoArquivo(sql: string) {
  const codigo = soCodigo(sql)
  const conta = (expressao: RegExp) => [...codigo.matchAll(expressao)].length
  const buckets = /\bINSERT\s+INTO\s+storage\.buckets\b[^;]*;/i.exec(limpar(sql, false))?.[0] ?? ''
  return {
    tabelas: conta(/\bCREATE\s+TABLE\b/gi),
    funcoes: conta(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi),
    gatilhos: conta(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b/gi),
    regras: conta(/\bCREATE\s+POLICY\b/gi),
    buckets: [...buckets.matchAll(/\(\s*'ponto-[\w-]+'/g)].length,
  }
}

/* ------------------------------------------------------------------ */
/* As regras dos testes de banco (supabase/testes)                      */
/* ------------------------------------------------------------------ */

/** Os papéis que um teste de banco pode assumir: os do app e o da função de contas. */
const PAPEIS_DOS_TESTES = ['authenticated', 'service_role', 'anon']

/**
 * Os problemas de um arquivo de `supabase/testes/`. Abre com BEGIN e termina em
 * ROLLBACK, sem outro controle de transação no nível de cima e sem COMMIT em
 * lugar nenhum (um COMMIT dentro de um DO também gravaria); a marca de
 * transação vem logo depois do BEGIN, entre os SET LOCAL do começo; o primeiro
 * bloco é a partida, que confere a marca e exige postgres sem superusuário; o
 * bloco `$conferir$` transforma FALHOU, ou a falta de OK, em erro; a troca de
 * papel é só com SET LOCAL e só para os papéis do app e da função de contas;
 * e-mail só em example.invalid, o domínio reservado que não entrega e não
 * colide com as contas de demonstração.
 */
function problemasDoTesteDeBanco(sql: string): string[] {
  const codigo = soCodigo(sql)
  if (!codigo.trim()) return ['vazio']
  const semComentarios = limpar(sql, false)
  const problemas: string[] = []

  const cima = instrucoesDeCima(sql).map((instrucao) => instrucao.texto)
  if (!/^BEGIN$/i.test(cima[0] ?? '')) problemas.push('não abre com BEGIN')
  if (!/^ROLLBACK$/i.test(cima[cima.length - 1] ?? '')) problemas.push('não termina em ROLLBACK')
  const controle = controleDeTransacao(sql).map((texto) => texto.toUpperCase())
  if (controle.join(' ') !== 'BEGIN ROLLBACK') problemas.push(`controle de transação além do BEGIN e do ROLLBACK: ${controle.join(', ')}`)
  if (/\bCOMMIT\b/i.test(codigo)) problemas.push('tem COMMIT')

  // Fora de uma transação, SET LOCAL não vale nada: é a marca que a partida lê.
  const comeco = /^\s*BEGIN\s*;((?:\s*SET\s+LOCAL\s+[^;]+;)*)/i.exec(semComentarios)?.[1] ?? ''
  if (!/\bSET\s+LOCAL\s+teste\.em_transacao\s*=\s*'sim'\s*;/i.test(comeco)) problemas.push('sem a marca de transação logo depois do BEGIN')

  const primeiroBloco = /\bDO\s+\$(\w*)\$/i.exec(semComentarios)?.[1]
  const partida = /\bDO\s+\$partida\$([\s\S]*?)\$partida\$/i.exec(semComentarios)?.[1] ?? ''
  if (primeiroBloco !== 'partida') problemas.push('o primeiro bloco não é a partida')
  if (!partida.includes("current_setting('teste.em_transacao', true)")) problemas.push('a partida não confere a marca de transação')
  if (!partida.includes("current_user <> 'postgres'") || !/\brolsuper\b/.test(partida)) {
    problemas.push('a partida não exige postgres sem superusuário')
  }

  const conferir = /\bDO\s+\$conferir\$([\s\S]*?)\$conferir\$/i.exec(semComentarios)?.[1] ?? ''
  if (!conferir.includes("!~ '(^|\\n)OK '") || !conferir.includes("~ '(^|\\n)FALHOU'") || !/\bRAISE\s+EXCEPTION\b/i.test(conferir)) {
    problemas.push('sem o bloco $conferir$ que transforma FALHOU (ou a falta de OK) em erro')
  }
  if (!semComentarios.includes("SELECT current_setting('teste.resultado', true) AS resultado;")) problemas.push('não mostra o resultado')

  for (const m of semComentarios.matchAll(/\b(SET\s+(?:LOCAL\s+|SESSION\s+)?ROLE)\s+(\w+)/gi)) {
    if (!/^SET\s+LOCAL\s+ROLE$/i.test(m[1]) || !PAPEIS_DOS_TESTES.includes(m[2].toLowerCase())) {
      problemas.push(`troca de papel fora da regra: ${m[0].replace(/\s+/g, ' ')}`)
    }
  }
  if (/supabase_admin|\bSESSION\s+AUTHORIZATION\b/i.test(semComentarios)) problemas.push('cita supabase_admin ou troca a autorização da sessão')

  // Comentários incluídos: nem a explicação pode citar e-mail fora de example.invalid.
  for (const m of sql.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
    if (m[1].toLowerCase() !== 'example.invalid') problemas.push(`e-mail fora de example.invalid: ${m[0]}`)
  }
  return problemas
}

/** As contagens que a conferência da estrutura (`supabase/testes/estrutura.sql`) espera, lidas das constantes dela. */
function contagemDaConferencia(sql: string) {
  const inteiro = (nome: string) => Number(new RegExp(String.raw`\b${nome}\s+constant\s+integer\s*:=\s*(\d+)\s*;`, 'i').exec(sql)?.[1] ?? Number.NaN)
  const lista = (nome: string) =>
    [...(new RegExp(String.raw`\b${nome}\s+constant\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]`, 'i').exec(sql)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    )
  return {
    tabelas: lista('c_tabelas'),
    funcoes: inteiro('c_funcoes'),
    gatilhos: inteiro('c_gatilhos'),
    regrasTabelas: inteiro('c_regras_tabelas'),
    regrasStorage: inteiro('c_regras_storage'),
    buckets: inteiro('c_buckets'),
    funcoesDoApp: lista('c_exec_app'),
  }
}

/* ------------------------------------------------------------------ */
/* Os testes                                                           */
/* ------------------------------------------------------------------ */

describe('a estrutura do banco (a migration única)', () => {
  it('existe, com nome de migration do Supabase CLI, e não está vazia', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(0)
    for (const arquivo of ARQUIVOS) expect(arquivo).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/)
    expect(ARQUIVOS.filter((arquivo) => arquivo.endsWith('_ponto_livre_estrutura.sql'))).toHaveLength(1)
    expect(ESTRUTURA.trim()).not.toBe('')
    expect(ESTRUTURA).toMatch(/\bCREATE TABLE public\.ponto_registros \(/)
  })

  it('roda inteira na transação que o CLI abre: nenhum BEGIN, COMMIT nem ROLLBACK no nível de cima', () => {
    expect(controleDeTransacao(ESTRUTURA)).toEqual([])
    // E o que ela ajusta vale só até o fim dessa transação.
    for (const instrucao of instrucoesDeCima(ESTRUTURA)) {
      if (/^SET\b/i.test(instrucao.texto)) expect(instrucao.texto).toMatch(/^SET LOCAL\b/i)
    }
  })

  it('roda como postgres, sem superusuário: nenhuma troca de papel e nenhuma citação de supabase_admin ou rolsuper', () => {
    expect(ESTRUTURA).not.toMatch(/supabase_admin/i)
    expect(ESTRUTURA).not.toMatch(/rolsuper/i)
    expect(ESTRUTURA).not.toMatch(/\b(?:SET|RESET)\s+(?:LOCAL\s+|SESSION\s+)?ROLE\b/i)
    expect(ESTRUTURA).not.toMatch(/\bSESSION\s+AUTHORIZATION\b/i)
  })

  it('no nível de cima só cria, concede, revoga, comenta e confere: nada se apaga', () => {
    expect(instrucoesForaDasFormas(ESTRUTURA)).toEqual([])
  })

  it('a partida confere os pré-requisitos antes da primeira mudança, a começar pelo PostgreSQL 17', () => {
    const codigo = soCodigo(ESTRUTURA)
    const partida = codigo.indexOf('DO $partida$')
    expect(partida).toBeGreaterThanOrEqual(0)
    expect(partida).toBeLessThan(primeiraMudanca(ESTRUTURA))
    const bloco = ESTRUTURA.slice(ESTRUTURA.indexOf('DO $partida$'), ESTRUTURA.indexOf('END $partida$'))
    // A partida só lê.
    expect(soCodigo(bloco)).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/i)
    expect(bloco).toMatch(/current_setting\('server_version_num'\)::int < 170000/)
    for (const objeto of ['auth.users', 'auth.uid()', 'storage.objects', 'storage.buckets', 'storage.foldername(text)']) {
      expect(bloco, objeto).toContain(`'${objeto}'`)
    }
    expect(bloco).toMatch(/current_user <> 'postgres'/)
    expect(bloco).toMatch(/rolbypassrls/)
    expect(bloco).toMatch(/'anon', 'authenticated', 'service_role'/)
    expect(bloco).toMatch(/e\.extname = 'pgcrypto'/)
  })

  it('toda tabela e toda sequência do ponto nascem sem os privilégios do padrão do Supabase, e toda tabela com RLS ligada', () => {
    expect(contagemDoArquivo(ESTRUTURA).tabelas).toBeGreaterThan(0)
    expect(problemasDasRelacoes(ESTRUTURA)).toEqual([])
  })

  it('toda função do ponto tem search_path fixo, nasce com REVOKE ALL dos quatro papéis e devolve EXECUTE só a service_role e authenticated', () => {
    expect(contagemDoArquivo(ESTRUTURA).funcoes).toBeGreaterThan(0)
    expect(problemasDasFuncoes(ESTRUTURA)).toEqual([])
  })

  it('nada é concedido a anon nem a PUBLIC', () => {
    expect(concessoesAoPublico(ESTRUTURA)).toEqual([])
  })

  it('toda regra de acesso é só para authenticated, e as de storage.objects filtram pelo bucket do ponto', () => {
    const regras = regrasDeAcesso(ESTRUTURA)
    expect(regras.filter((regra) => regra.alvo === 'storage.objects').length).toBeGreaterThan(0)
    expect(regras.filter((regra) => regra.alvo.startsWith('public.ponto_')).length).toBeGreaterThan(0)
    expect(problemasDasRegras(ESTRUTURA)).toEqual([])
  })

  it('a conferência do fim e o cabeçalho contam exatamente o que o arquivo cria', () => {
    const contado = contagemDoArquivo(ESTRUTURA)
    const fim = /\(v_tabelas, v_funcoes, v_gatilhos, v_regras, v_buckets\) <> \((\d+), (\d+), (\d+), (\d+), (\d+)\)/.exec(ESTRUTURA)
    expect(fim).not.toBeNull()
    expect(fim?.slice(1).map(Number)).toEqual([contado.tabelas, contado.funcoes, contado.gatilhos, contado.regras, contado.buckets])
    // O cabeçalho, como texto corrido (os comentários sem os `--`).
    const prosa = ESTRUTURA.split('\n')
      .filter((linha) => linha.startsWith('--'))
      .map((linha) => linha.replace(/^--\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
    const cabecalho = /(\d+) tabelas, (\d+) funções, (\d+) gatilhos, (\d+) regras de acesso/.exec(prosa)
    expect(cabecalho?.slice(1).map(Number)).toEqual([contado.tabelas, contado.funcoes, contado.gatilhos, contado.regras])
  })
})

describe('toda migration de supabase/migrations (a estrutura e a de quem estender o ponto)', () => {
  it('a estrutura é a primeira: as outras rodam depois dela, na ordem do nome', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0)
    expect(MIGRATIONS[0].nome).toMatch(/^\d{14}_ponto_livre_estrutura\.sql$/)
  })

  for (const migration of MIGRATIONS) {
    it(`${migration.nome}: transação do CLI, sem troca de papel, REVOKE antes de GRANT, RLS ligada e nunca desligada, search_path fixo, nada para anon nem PUBLIC, regras só para authenticated`, () => {
      expect(problemasDaMigration(migration.sql)).toEqual([])
    })
  }
})

describe('as garantias de segurança, no texto da estrutura', () => {
  const semComentarios = limpar(ESTRUTURA, false)
  /** A função inteira, do CREATE ao `$$;` que fecha o corpo. */
  const funcao = (nome: string) => new RegExp(String.raw`CREATE FUNCTION public\.${nome}\([\s\S]*?\n\$\$;`).exec(semComentarios)?.[0] ?? ''
  const regra = (nome: string) => regrasDeAcesso(ESTRUTURA).find((r) => r.nome === nome)?.corpo ?? ''

  it('o que o postgres criar depois em public nasce sem nada para anon, authenticated e PUBLIC, e o fim confere', () => {
    for (const objeto of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
      expect(semComentarios, objeto).toContain(
        `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${objeto} FROM anon, authenticated;`,
      )
    }
    // O EXECUTE de PUBLIC é um padrão global do PostgreSQL: por esquema, ele não sai.
    expect(semComentarios).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;')
    expect(semComentarios).not.toMatch(/IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/)
    expect(semComentarios.slice(semComentarios.indexOf('DO $fim$'))).toMatch(/pg_default_acl/)
  })

  it('nada lê o nome que a própria pessoa escreve (user_metadata): o nome da conta vem do app_metadata', () => {
    expect(semComentarios).not.toMatch(/raw_user_meta_data/)
    expect(funcao('ponto_nome_da_conta')).toMatch(/u\.raw_app_meta_data ->> 'full_name'/)
    expect(funcao('ponto_contas')).toMatch(/u\.raw_app_meta_data ->> 'full_name'/)
  })

  it('o INSERT direto é lançamento de quem administra: a anotação do papel cobre o INSERT, e o carimbo a lê', () => {
    expect(semComentarios).toMatch(
      /CREATE TRIGGER trg_ponto_anotar_papel_do_comando BEFORE INSERT OR DELETE OR UPDATE ON public\.ponto_registros FOR EACH ROW/,
    )
    const carimbo = funcao('ponto_carimbar_registro')
    expect(carimbo).toMatch(/current_setting\('ponto\.papel_do_comando', true\)/)
    expect(carimbo).toMatch(/IF v_papel <> 'postgres' THEN/)
  })

  it('a correção congela a origem e recusa quem é dono da batida', () => {
    const correcao = funcao('ponto_guardar_correcao')
    expect(correcao).toMatch(/NEW\.origem\s*:=\s*OLD\.origem;/)
    expect(correcao).toMatch(/OLD\.usuario_id = auth\.uid\(\)/)
  })

  it('ninguém apaga a selfie com menos de 16 minutos, e a selfie sobe só pela convenção e dentro do teto', () => {
    for (const nome of ['Ponto: dono descarta selfie sem batida', 'Ponto: so admin apaga selfie']) {
      expect(regra(nome), nome).toContain("(created_at < (now() - '00:16:00'::interval))")
    }
    expect(regra('Ponto: funcionario sobe a propria selfie')).toContain('ponto_selfie_pode_subir(bucket_id, name)')
  })

  it('o local e a configuração são de quem tem acesso ao ponto', () => {
    expect(regra('Ponto: quem tem acesso le o local')).toContain('ponto_ator_aprovado()')
    expect(regra('Ponto: quem tem acesso le a configuracao')).toContain('ponto_ator_aprovado()')
    expect(semComentarios).not.toMatch(/USING \(true\)/)
  })
})

describe('os detectores do teste da estrutura', () => {
  const funcao = (nome: string, cabecalho: string) =>
    `CREATE FUNCTION public.${nome}(p text)\nRETURNS void\nLANGUAGE plpgsql\n${cabecalho}\nAS $$\nBEGIN\n  RAISE NOTICE 'COMMIT;';\nEND;\n$$;\n`
  const guardas = (nome: string) =>
    `REVOKE ALL ON FUNCTION public.${nome}(p text) FROM PUBLIC, anon, authenticated, service_role;\n` +
    `GRANT EXECUTE ON FUNCTION public.${nome}(p text) TO service_role;\n`

  it('BEGIN e COMMIT só contam no nível de cima: corpo de função, comentário e texto não', () => {
    const certo = `SET LOCAL lock_timeout = '10s';\n-- BEGIN;\n${funcao('ponto_x', 'SET search_path = public')}${guardas('ponto_x')}`
    expect(controleDeTransacao(certo)).toEqual([])
    expect(controleDeTransacao(`BEGIN;\n${certo}COMMIT;\n`)).toEqual(['BEGIN', 'COMMIT'])
    expect(controleDeTransacao('START TRANSACTION;\nSELECT 1;\nEND;')).toEqual(['START TRANSACTION', 'END'])
    expect(instrucoesForaDasFormas(`${certo}DROP TABLE public.ponto_x;\nALTER TABLE public.ponto_y DROP COLUMN z;\n`)).toEqual([
      'DROP TABLE public.ponto_x',
      'ALTER TABLE public.ponto_y DROP COLUMN z',
    ])
    expect(primeiraMudanca(`SET LOCAL a = 1;\nDO $p$ BEGIN INSERT INTO t VALUES (1); END $p$;\nCREATE TABLE public.ponto_x ();`)).toBeGreaterThan(0)
  })

  it('a função sem search_path, sem REVOKE dos quatro ou com GRANT a anon é achada', () => {
    expect(problemasDasFuncoes(funcao('ponto_x', 'SET search_path = public') + guardas('ponto_x'))).toEqual([])
    expect(problemasDasFuncoes(funcao('ponto_x', 'SECURITY DEFINER') + guardas('ponto_x'))).toEqual(['ponto_x: sem search_path fixo'])
    expect(
      problemasDasFuncoes(
        funcao('ponto_x', 'SET search_path = public') +
          'REVOKE ALL ON FUNCTION public.ponto_x(p text) FROM PUBLIC, anon, authenticated;\n' +
          'GRANT EXECUTE ON FUNCTION public.ponto_x(p text) TO service_role;\n',
      ),
    ).toEqual(['ponto_x: sem REVOKE ALL de PUBLIC, anon, authenticated e service_role depois do CREATE'])
    expect(
      problemasDasFuncoes(funcao('ponto_x', 'SET search_path = public') + guardas('ponto_x') + 'GRANT EXECUTE ON FUNCTION public.ponto_x(p text) TO anon;\n'),
    ).toEqual(['ponto_x: GRANT para anon'])
    // O REVOKE e o GRANT de outra função, ou num comentário, não valem.
    const comentadas = guardas('ponto_x')
      .split('\n')
      .map((linha) => (linha ? `-- ${linha}` : linha))
      .join('\n')
    expect(problemasDasFuncoes(funcao('ponto_x', 'SET search_path = public') + guardas('ponto_y') + comentadas)).toEqual([
      'ponto_x: sem REVOKE ALL de PUBLIC, anon, authenticated e service_role depois do CREATE',
      'ponto_x: sem GRANT EXECUTE',
    ])
    expect(concessoesAoPublico('GRANT SELECT ON public.ponto_x TO authenticated, anon;')).toHaveLength(1)
    expect(concessoesAoPublico("-- GRANT SELECT ON public.ponto_x TO anon;\nCOMMENT ON TABLE public.ponto_x IS 'GRANT ALL TO PUBLIC;';")).toEqual([])
  })

  it('a tabela sem REVOKE, com GRANT antes dele ou sem RLS é achada', () => {
    const tabela = 'CREATE TABLE public.ponto_x (id int);\n'
    const revoke = 'REVOKE ALL ON public.ponto_x FROM PUBLIC, anon, authenticated, service_role;\n'
    const rls = 'ALTER TABLE public.ponto_x ENABLE ROW LEVEL SECURITY;\n'
    const grant = 'GRANT SELECT ON public.ponto_x TO authenticated;\n'
    expect(problemasDasRelacoes(tabela + revoke + grant + rls)).toEqual([])
    expect(problemasDasRelacoes(tabela + grant + revoke + rls)).toEqual(['ponto_x: GRANT antes do REVOKE'])
    expect(problemasDasRelacoes(tabela + revoke)).toEqual(['ponto_x: sem RLS'])
    expect(problemasDasRelacoes(tabela + rls)).toEqual([
      'ponto_x: sem REVOKE ALL de PUBLIC, anon, authenticated e service_role depois do CREATE',
    ])
  })

  it('numa cópia da própria migration, cada defeito plantado é achado', () => {
    // Cada troca tem de achar o trecho: se a migration mudar e ele sumir, este
    // teste quebra aqui, e não passa no vazio.
    const plantar = (de: string | RegExp, para: string) => {
      const copia = ESTRUTURA.replace(de, para)
      expect(copia, String(de)).not.toBe(ESTRUTURA)
      return copia
    }
    const revoke = 'REVOKE ALL ON FUNCTION public.ponto_meu_acesso() FROM PUBLIC, anon, authenticated, service_role;\n'
    expect(problemasDasFuncoes(plantar(revoke, ''))).toEqual([
      'ponto_meu_acesso: sem REVOKE ALL de PUBLIC, anon, authenticated e service_role depois do CREATE',
    ])
    expect(problemasDasFuncoes(plantar(/(CREATE FUNCTION public\.ponto_meu_acesso\(\)[\s\S]*?)SET search_path = public\n/, '$1'))).toEqual([
      'ponto_meu_acesso: sem search_path fixo',
    ])
    const paraAnon = plantar(revoke, `${revoke}GRANT EXECUTE ON FUNCTION public.ponto_meu_acesso() TO anon;\n`)
    expect(problemasDasFuncoes(paraAnon)).toEqual(['ponto_meu_acesso: GRANT para anon'])
    expect(concessoesAoPublico(paraAnon)).toHaveLength(1)
    expect(problemasDasRelacoes(plantar('ALTER TABLE public.ponto_pin ENABLE ROW LEVEL SECURITY;\n', ''))).toEqual(['ponto_pin: sem RLS'])
    expect(problemasDasRelacoes(plantar('REVOKE ALL ON public.ponto_pin FROM PUBLIC, anon, authenticated, service_role;\n', ''))).toEqual([
      'ponto_pin: sem REVOKE ALL de PUBLIC, anon, authenticated e service_role depois do CREATE',
    ])
    expect(problemasDasRegras(plantar("(bucket_id = 'ponto-atestados'::text) AND (auth.uid() IS NOT NULL) AND (ponto_pode_administrar() OR", '((auth.uid() IS NOT NULL) AND (ponto_pode_administrar() OR'))).toEqual([
      'Ponto: admin ou dono le atestado: regra de storage.objects sem o bucket do ponto',
    ])
    expect(controleDeTransacao(`BEGIN;\n${ESTRUTURA}\nCOMMIT;\n`)).toEqual(['BEGIN', 'COMMIT'])
  })

  it('a migration de quem estende o ponto, certa, passa; e cada defeito plantado nela é achado', () => {
    const extensao = [
      'CREATE TABLE public.ponto_extra (id int);',
      'REVOKE ALL ON public.ponto_extra FROM PUBLIC, anon, authenticated, service_role;',
      'GRANT SELECT ON public.ponto_extra TO authenticated;',
      'ALTER TABLE public.ponto_extra ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "Ponto: quem tem acesso le o extra" ON public.ponto_extra AS PERMISSIVE FOR SELECT TO authenticated USING (ponto_ator_aprovado());',
      funcao('ponto_extra_conta', 'SET search_path = public') + guardas('ponto_extra_conta'),
    ].join('\n')
    expect(problemasDaMigration(extensao)).toEqual([])
    expect(problemasDaMigration(extensao.replace('ALTER TABLE public.ponto_extra ENABLE ROW LEVEL SECURITY;\n', ''))).toEqual([
      'ponto_extra: sem RLS',
    ])
    expect(problemasDaMigration(`${extensao}ALTER TABLE public.ponto_registros DISABLE ROW LEVEL SECURITY;\n`)).toEqual([
      'RLS desligada: ALTER TABLE public.ponto_registros DISABLE ROW LEVEL SECURITY',
    ])
    expect(problemasDaMigration(`${extensao}GRANT SELECT ON public.ponto_extra TO anon;\n`)).toEqual([
      'concede a anon ou PUBLIC: GRANT SELECT ON public.ponto_extra TO anon;',
    ])
    expect(problemasDaMigration(`${extensao}ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;\n`)).toEqual([
      'concede a anon ou PUBLIC: GRANT EXECUTE ON FUNCTIONS TO PUBLIC;',
    ])
    expect(problemasDaMigration(`${extensao}ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;\n`)).toEqual([
      'privilégio padrão para authenticated: ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;',
    ])
    expect(problemasDaMigration(`BEGIN;\n${extensao}COMMIT;\n`)).toEqual(['controle de transação no nível de cima: BEGIN, COMMIT'])
    expect(problemasDaMigration(`${extensao}SET ROLE authenticated;\n`)).toEqual([
      'SET que passa da transação: SET ROLE authenticated',
      'troca de papel',
    ])
    expect(problemasDaMigration(extensao.replace('SET search_path = public\n', ''))).toEqual(['ponto_extra_conta: sem search_path fixo'])
    expect(problemasDaMigration(extensao.replace('TO authenticated USING', 'TO anon USING'))).toEqual([
      'Ponto: quem tem acesso le o extra: para anon, e não só para authenticated',
    ])
  })

  it('a regra para anon, ou de storage.objects sem o bucket do ponto, é achada', () => {
    const certa = `CREATE POLICY "Ponto: x" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated\n  USING ((bucket_id = 'ponto-selfies'::text));\n`
    expect(problemasDasRegras(certa)).toEqual([])
    expect(problemasDasRegras(certa.replace('TO authenticated', 'TO anon'))).toEqual(['Ponto: x: para anon, e não só para authenticated'])
    expect(problemasDasRegras(certa.replace("'ponto-selfies'", "'avatars'"))).toEqual([
      'Ponto: x: regra de storage.objects sem o bucket do ponto',
    ])
  })
})

describe('os testes de banco (supabase/testes)', () => {
  it('existem os oito, com o nome no padrão que o script aceita, e nenhum está vazio', () => {
    expect(TESTES_DE_BANCO.map((teste) => teste.nome)).toEqual(expect.arrayContaining(TESTES_ESPERADOS))
    for (const teste of TESTES_DE_BANCO) {
      // O mesmo padrão de scripts/testar-banco.sh.
      expect(teste.nome).toMatch(/^[a-z0-9_]+\.sql$/)
      expect(soCodigo(teste.sql).trim(), teste.nome).not.toBe('')
    }
  })

  for (const teste of TESTES_DE_BANCO) {
    it(`${teste.nome}: abre com BEGIN e a marca de transação, termina em ROLLBACK sem COMMIT, tem a partida e o $conferir$, e só cita e-mail em example.invalid`, () => {
      expect(problemasDoTesteDeBanco(teste.sql)).toEqual([])
    })
  }

  it('a conferência da estrutura conta exatamente o que a migration cria', () => {
    const conferencia = contagemDaConferencia(TESTES_DE_BANCO.find((teste) => teste.nome === 'estrutura.sql')?.sql ?? '')
    const codigo = soCodigo(ESTRUTURA)
    const contado = contagemDoArquivo(ESTRUTURA)
    const tabelas = [...codigo.matchAll(/\bCREATE\s+TABLE\s+public\.(\w+)/gi)].map((m) => m[1]).sort()
    const regrasDoStorage = regrasDeAcesso(ESTRUTURA).filter((regra) => regra.alvo === 'storage.objects').length
    const funcoes = [...codigo.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)/gi)].map((m) => m[1])
    const funcoesDoApp = funcoes
      .filter((nome) => concessoesDaFuncao(codigo, 'GRANT', nome).some((concessao) => concessao.papeis.includes('authenticated')))
      .sort()
    expect([...conferencia.tabelas].sort()).toEqual(tabelas)
    expect(conferencia.funcoes).toBe(contado.funcoes)
    expect(conferencia.gatilhos).toBe(contado.gatilhos)
    expect(conferencia.regrasTabelas + conferencia.regrasStorage).toBe(contado.regras)
    expect(conferencia.regrasStorage).toBe(regrasDoStorage)
    expect(conferencia.buckets).toBe(contado.buckets)
    expect([...conferencia.funcoesDoApp].sort()).toEqual(funcoesDoApp)
  })
})

describe('os detectores das regras dos testes de banco', () => {
  // O menor arquivo que segue todas as regras. Comentário e texto entre aspas
  // podem falar de COMMIT: só o código conta.
  const minimo = [
    'BEGIN;',
    "SET LOCAL teste.em_transacao = 'sim';",
    "SET LOCAL lock_timeout = '5s';",
    '-- Um comentário pode falar de COMMIT sem contar como código.',
    'DO $partida$',
    'BEGIN',
    "  IF coalesce(current_setting('teste.em_transacao', true), '') <> 'sim' THEN RAISE EXCEPTION 'fora de transacao'; END IF;",
    "  IF current_user <> 'postgres' OR (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) THEN RAISE EXCEPTION 'papel'; END IF;",
    'END $partida$;',
    'DO $teste$',
    'BEGIN',
    '  SET LOCAL ROLE authenticated;',
    "  RAISE NOTICE 'nada de COMMIT aqui: %', 'ana.teste@example.invalid';",
    '  RESET ROLE;',
    "  PERFORM set_config('teste.resultado', 'OK T1 exemplo', true);",
    'END $teste$;',
    "SELECT current_setting('teste.resultado', true) AS resultado;",
    'DO $conferir$',
    'BEGIN',
    "  IF current_setting('teste.resultado', true) !~ '(^|\\n)OK ' OR current_setting('teste.resultado', true) ~ '(^|\\n)FALHOU' THEN",
    "    RAISE EXCEPTION 'falhou';",
    '  END IF;',
    'END $conferir$;',
    'ROLLBACK;',
    '',
  ].join('\n')

  it('o arquivo mínimo passa; vazio, ou só com comentário, não', () => {
    expect(problemasDoTesteDeBanco(minimo)).toEqual([])
    expect(problemasDoTesteDeBanco('')).toEqual(['vazio'])
    expect(problemasDoTesteDeBanco('-- BEGIN;\n-- ROLLBACK;\n')).toEqual(['vazio'])
  })

  it('o COMMIT é achado no fim, no meio e dentro de um DO; e a segunda transação no meio também', () => {
    expect(problemasDoTesteDeBanco(minimo.replace('ROLLBACK;', 'COMMIT;'))).toEqual([
      'não termina em ROLLBACK',
      'controle de transação além do BEGIN e do ROLLBACK: BEGIN, COMMIT',
      'tem COMMIT',
    ])
    expect(problemasDoTesteDeBanco(minimo.replace('  RESET ROLE;', '  RESET ROLE;\n  COMMIT;'))).toEqual(['tem COMMIT'])
    expect(problemasDoTesteDeBanco(minimo.replace('SELECT current_setting', 'ROLLBACK;\nBEGIN;\nSELECT current_setting'))).toEqual([
      'controle de transação além do BEGIN e do ROLLBACK: BEGIN, ROLLBACK, BEGIN, ROLLBACK',
    ])
  })

  it('a marca de transação que falta, ou que vem depois do primeiro bloco, é achada', () => {
    const semMarca = minimo.replace("SET LOCAL teste.em_transacao = 'sim';\n", '')
    expect(problemasDoTesteDeBanco(semMarca)).toEqual(['sem a marca de transação logo depois do BEGIN'])
    const marcaTarde = semMarca.replace('END $partida$;\n', "END $partida$;\nSET LOCAL teste.em_transacao = 'sim';\n")
    expect(problemasDoTesteDeBanco(marcaTarde)).toEqual(['sem a marca de transação logo depois do BEGIN'])
  })

  it('sem a partida, ou sem o $conferir$, é achado', () => {
    expect(problemasDoTesteDeBanco(minimo.replace(/DO \$partida\$[\s\S]*?END \$partida\$;\n/, ''))).toEqual([
      'o primeiro bloco não é a partida',
      'a partida não confere a marca de transação',
      'a partida não exige postgres sem superusuário',
    ])
    expect(problemasDoTesteDeBanco(minimo.replace(/DO \$conferir\$[\s\S]*?END \$conferir\$;\n/, ''))).toEqual([
      'sem o bloco $conferir$ que transforma FALHOU (ou a falta de OK) em erro',
    ])
  })

  it('a troca de papel fora da regra e o e-mail fora de example.invalid são achados', () => {
    expect(problemasDoTesteDeBanco(minimo.replace('SET LOCAL ROLE authenticated', 'SET LOCAL ROLE supabase_admin'))).toEqual([
      'troca de papel fora da regra: SET LOCAL ROLE supabase_admin',
      'cita supabase_admin ou troca a autorização da sessão',
    ])
    expect(problemasDoTesteDeBanco(minimo.replace('SET LOCAL ROLE authenticated', 'SET ROLE authenticated'))).toEqual([
      'troca de papel fora da regra: SET ROLE authenticated',
    ])
    expect(problemasDoTesteDeBanco(minimo.replace('ana.teste@example.invalid', 'ana@example.com'))).toEqual([
      'e-mail fora de example.invalid: ana@example.com',
    ])
    // No comentário também.
    expect(problemasDoTesteDeBanco(minimo.replace('-- Um comentário', '-- Fale com ana@example.com. Um comentário'))).toEqual([
      'e-mail fora de example.invalid: ana@example.com',
    ])
  })
})
