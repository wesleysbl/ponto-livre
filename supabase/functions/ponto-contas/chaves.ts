/*
 * PONTO-CONTAS — AS CHAVES DO PROJETO, LIDAS DO AMBIENTE DA FUNÇÃO.
 *
 * O Supabase põe as chaves em toda Edge Function, sem ninguém configurar nada,
 * de dois jeitos:
 *   • as NOVAS, em `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS`. Cada
 *     variável é um DICIONÁRIO JSON de chaves com nome (`{"default": "..."}`), e
 *     a chave padrão do projeto é a entrada `default`;
 *   • as LEGADAS, em `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`, em texto
 *     puro. Existem nos projetos que ainda têm as chaves legadas e no Supabase
 *     local (CLI). Projeto criado sem as chaves legadas não as tem.
 *
 * A REGRA, PARA CADA UMA DAS DUAS (a pública e a de serviço): a nova primeiro;
 * se ela falta, não é um dicionário JSON ou não tem a entrada `default` em
 * texto, a legada. Uma decide sem olhar a outra. Sem nenhuma das duas (ou sem
 * `SUPABASE_URL`), a função não atende: `index.ts` responde 500
 * `configuracao_incompleta`, e nada muda.
 *
 * SÓ A ENTRADA `default`. Uma chave com outro nome pode ser a de outro serviço
 * do projeto (o painel deixa criar várias), e esta função não adivinha.
 *
 * NENHUMA CHAVE SAI DAQUI PARA LOG OU RESPOSTA. O diagnóstico diz só o ESTADO
 * de cada variável (`ok`, `ausente`, `json_invalido`, `sem_default`) e de onde
 * cada chave saiu, nunca um pedaço do valor: nem o do JSON inválido, que pode
 * ser a chave inteira colada pela metade. O erro do `JSON.parse` também fica
 * aqui dentro: a mensagem dele repete o texto que recebeu.
 *
 * Puro, como `regras.ts`: sem `Deno` e sem import de rede. Quem lê o ambiente
 * é `index.ts`, que entrega o `Deno.env.get` para cá, e
 * `src/ponto-contas-chaves.test.ts` prova cada caso sem Deno.
 */

/** Os nomes das variáveis que o Supabase põe na função. */
export const VARIAVEIS_DAS_CHAVES = {
  url: 'SUPABASE_URL',
  publicavelNova: 'SUPABASE_PUBLISHABLE_KEYS',
  secretaNova: 'SUPABASE_SECRET_KEYS',
  anonLegada: 'SUPABASE_ANON_KEY',
  servicoLegada: 'SUPABASE_SERVICE_ROLE_KEY',
} as const

/** A entrada dos dicionários que é a chave padrão do projeto. */
export const ENTRADA_PADRAO = 'default'

/** Como estava a variável da chave nova. */
export type EstadoDaChaveNova = 'ok' | 'ausente' | 'json_invalido' | 'sem_default'

/** De onde uma chave saiu: da variável nova, da legada, ou de nenhuma. */
export type FonteDaChave = 'nova' | 'legada' | 'nenhuma'

export interface DiagnosticoDaChave {
  usada: FonteDaChave
  nova: EstadoDaChaveNova
  legada: 'ok' | 'ausente'
}

/** O que vai para o log quando falta alguma coisa. Só estados, nunca valores. */
export interface DiagnosticoDasChaves {
  url: 'ok' | 'ausente'
  chavePublica: DiagnosticoDaChave
  chaveDeServico: DiagnosticoDaChave
}

export type ChavesDoProjeto =
  | { ok: true; url: string; chavePublica: string; chaveDeServico: string; diagnostico: DiagnosticoDasChaves }
  | { ok: false; diagnostico: DiagnosticoDasChaves }

/** A leitura de uma variável do ambiente (`Deno.env.get`, na função). */
export type LerVariavel = (nome: string) => string | null | undefined

const limpo = (valor: string | null | undefined): string => (typeof valor === 'string' ? valor.trim() : '')

/** A entrada `default` de um dicionário de chaves, ou o porquê de não haver uma. */
export function lerChaveNova(
  valor: string | null | undefined,
): { estado: 'ok'; chave: string } | { estado: Exclude<EstadoDaChaveNova, 'ok'> } {
  const texto = limpo(valor)
  if (!texto) return { estado: 'ausente' }

  let dicionario: unknown
  try {
    dicionario = JSON.parse(texto)
  } catch {
    return { estado: 'json_invalido' }
  }
  if (typeof dicionario !== 'object' || dicionario === null || Array.isArray(dicionario)) {
    return { estado: 'json_invalido' }
  }

  const chave = Object.hasOwn(dicionario, ENTRADA_PADRAO) ? (dicionario as Record<string, unknown>)[ENTRADA_PADRAO] : undefined
  if (typeof chave !== 'string' || !chave.trim()) return { estado: 'sem_default' }
  return { estado: 'ok', chave: chave.trim() }
}

/** Uma das duas chaves: a nova, se ela vale; senão a legada; senão nenhuma. */
function escolher(nova: string | null | undefined, legada: string | null | undefined) {
  const lida = lerChaveNova(nova)
  const legadaLimpa = limpo(legada)
  const estados = { nova: lida.estado, legada: legadaLimpa ? ('ok' as const) : ('ausente' as const) }
  if (lida.estado === 'ok') return { chave: lida.chave, diagnostico: { usada: 'nova' as const, ...estados } }
  if (legadaLimpa) return { chave: legadaLimpa, diagnostico: { usada: 'legada' as const, ...estados } }
  return { chave: null, diagnostico: { usada: 'nenhuma' as const, ...estados } }
}

/**
 * O endereço e as duas chaves da função, pela regra do cabeçalho. Sem um dos
 * três, `ok: false` com o diagnóstico, e só ele.
 */
export function resolverChaves(ler: LerVariavel): ChavesDoProjeto {
  const url = limpo(ler(VARIAVEIS_DAS_CHAVES.url))
  const publica = escolher(ler(VARIAVEIS_DAS_CHAVES.publicavelNova), ler(VARIAVEIS_DAS_CHAVES.anonLegada))
  const servico = escolher(ler(VARIAVEIS_DAS_CHAVES.secretaNova), ler(VARIAVEIS_DAS_CHAVES.servicoLegada))
  const diagnostico: DiagnosticoDasChaves = {
    url: url ? 'ok' : 'ausente',
    chavePublica: publica.diagnostico,
    chaveDeServico: servico.diagnostico,
  }
  if (!url || publica.chave === null || servico.chave === null) return { ok: false, diagnostico }
  return { ok: true, url, chavePublica: publica.chave, chaveDeServico: servico.chave, diagnostico }
}
