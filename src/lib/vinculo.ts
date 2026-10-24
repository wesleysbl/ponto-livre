/*
 * O VÍNCULO ENTRE FICHA E CONTA, SUGERIDO PELO NOME.
 *
 * O QUE RESOLVE: quando o RH cadastra as fichas antes das contas (ou o
 * contrário), as contas existem no login com o nome escrito de outro jeito —
 * sem acento, sem o nome do meio, às vezes só o e-mail. Ligar cada ficha
 * procurando a conta certa numa lista comprida é o trabalho que esta sugestão
 * poupa.
 *
 * ⚠ NADA É LIGADO SOZINHO. A sugestão só ordena e marca as candidatas; quem
 * liga é o super admin, uma ficha por vez, numa caixa de confirmação. E ligar
 * tem consequência séria: a ficha ativa ligada LIBERA o acesso
 * ao ponto para aquela conta, e a folha impressa sai com o nome completo
 * daquela ficha. Um vínculo errado dá a jornada de uma pessoa para outra.
 *
 * ⚠ NUNCA SUGERE CONTA JÁ LIGADA. Uma conta bate ponto por uma ficha só (o
 * índice `ponto_funcionarios_conta_unica` recusa a segunda), então sugerir uma
 * conta que já tem ficha seria oferecer um caminho que termina em erro — ou,
 * pior, induzir alguém a desligar a ficha certa para ligar a errada.
 *
 * COMO OS NOMES SÃO COMPARADOS
 *   • sem acento, sem caixa, sem pontuação: "José" = "jose";
 *   • sem os conectivos (da, de, do, das, dos, e) e sem iniciais soltas:
 *     "Maria J. da Silva" = "maria silva";
 *   • e-mail vale pelo que vem antes da arroba: "ana.lima@…" = "ana lima";
 *   • o PRIMEIRO nome tem de ser o mesmo — é o que as pessoas não abreviam.
 * A força da sugestão:
 *   `exata`   — os mesmos nomes, na mesma ordem;
 *   `forte`   — mesmo primeiro e mesmo último nome, e um dos dois só omite
 *               nomes do meio: "Maria Souza" ~ "Maria Aparecida de Souza";
 *   `parcial` — mesmo primeiro nome, e todo nome do mais curto aparece no mais
 *               longo, mas o último não bate: "Ana" ~ "Ana Paula Lima".
 * Nome do meio que CONFLITA ("Maria Clara Souza" × "Maria Luiza Souza") não é
 * sugestão: podem ser irmãs.
 */
import type { FichaDoFuncionario } from './cadastro'

export type ForcaDaSugestao = 'exata' | 'forte' | 'parcial'

export interface Sugestao<T> {
  item: T
  forca: ForcaDaSugestao
}

/** O que a sugestão precisa saber de uma conta. */
export interface ContaParaVinculo {
  usuarioId: string
  nome: string
  email: string | null
}

const CONECTIVOS = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])

const ORDEM: Record<ForcaDaSugestao, number> = { exata: 0, forte: 1, parcial: 2 }

/** Ordem alfabética de gente de verdade: acento não vai para o fim da lista. */
const POR_NOME = new Intl.Collator('pt-BR', { sensitivity: 'base' })

/** Os nomes que contam, normalizados. E-mail vale pela parte antes da arroba. */
export function tokensDoNome(texto: string): string[] {
  const base = texto.includes('@') ? texto.slice(0, texto.indexOf('@')) : texto
  return base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((parte) => parte.length > 1 && !CONECTIVOS.has(parte))
}

/** A força com que dois nomes parecem ser da mesma pessoa, ou nulo. */
export function compararNomes(um: string, outro: string): ForcaDaSugestao | null {
  const a = tokensDoNome(um)
  const b = tokensDoNome(outro)
  if (a.length === 0 || b.length === 0) return null
  if (a.join(' ') === b.join(' ')) return 'exata'
  if (a[0] !== b[0]) return null

  const [menor, maior] = a.length <= b.length ? [a, b] : [b, a]
  const doMaior = new Set(maior)
  if (!menor.every((parte) => doMaior.has(parte))) return null

  if (menor.length >= 2 && menor[menor.length - 1] === maior[maior.length - 1]) return 'forte'
  return 'parcial'
}

function maisForte(
  uma: ForcaDaSugestao | null,
  outra: ForcaDaSugestao | null,
): ForcaDaSugestao | null {
  if (uma === null) return outra
  if (outra === null) return uma
  return ORDEM[uma] <= ORDEM[outra] ? uma : outra
}

/** As contas que já têm ficha — ativa ou não. Nunca são sugeridas. */
export function contasJaLigadas(fichas: readonly FichaDoFuncionario[]): Set<string> {
  return new Set(
    fichas.map((ficha) => ficha.usuarioId).filter((id): id is string => id !== null),
  )
}

/**
 * As contas que podem ser a dona desta ficha, da mais provável para a menos.
 * Compara o nome da ficha com o nome da conta E com o e-mail dela, e fica com
 * a comparação mais forte: há conta cujo nome guardado diz "Dani" e cujo
 * e-mail diz "daniela.freitas".
 */
export function sugerirContasParaFicha(
  ficha: Pick<FichaDoFuncionario, 'nomeCompleto'>,
  contas: readonly ContaParaVinculo[],
  fichas: readonly FichaDoFuncionario[],
): Sugestao<ContaParaVinculo>[] {
  const ligadas = contasJaLigadas(fichas)
  const sugestoes: Sugestao<ContaParaVinculo>[] = []
  for (const conta of contas) {
    if (ligadas.has(conta.usuarioId)) continue
    const forca = maisForte(
      compararNomes(ficha.nomeCompleto, conta.nome),
      conta.email ? compararNomes(ficha.nomeCompleto, conta.email) : null,
    )
    if (forca) sugestoes.push({ item: conta, forca })
  }
  return sugestoes.sort(
    (x, y) => ORDEM[x.forca] - ORDEM[y.forca] || POR_NOME.compare(x.item.nome, y.item.nome),
  )
}

/**
 * As fichas SEM CONTA que podem ser desta pessoa, pelo nome (e pelo e-mail,
 * quando houver). Serve para a conta que já existe e para a conta que está
 * sendo criada — por isso recebe nome e e-mail, e não uma conta.
 *
 * Entre sugestões da mesma força, a ficha ATIVA vem antes: a desativada é
 * histórico, e ligá-la não dá acesso a nada.
 */
export function sugerirFichasPeloNome(
  nome: string,
  email: string | null,
  fichas: readonly FichaDoFuncionario[],
): Sugestao<FichaDoFuncionario>[] {
  const sugestoes: Sugestao<FichaDoFuncionario>[] = []
  for (const ficha of fichas) {
    if (ficha.usuarioId !== null) continue
    const forca = maisForte(
      compararNomes(ficha.nomeCompleto, nome),
      email ? compararNomes(ficha.nomeCompleto, email) : null,
    )
    if (forca) sugestoes.push({ item: ficha, forca })
  }
  return sugestoes.sort(
    (x, y) =>
      ORDEM[x.forca] - ORDEM[y.forca] ||
      Number(y.item.ativo) - Number(x.item.ativo) ||
      POR_NOME.compare(x.item.nomeCompleto, y.item.nomeCompleto),
  )
}

/** As fichas sem conta para uma conta existente — nenhuma, se a conta já tem ficha. */
export function sugerirFichasParaConta(
  conta: ContaParaVinculo,
  fichas: readonly FichaDoFuncionario[],
): Sugestao<FichaDoFuncionario>[] {
  if (contasJaLigadas(fichas).has(conta.usuarioId)) return []
  return sugerirFichasPeloNome(conta.nome, conta.email, fichas)
}

/** O rótulo curto de uma sugestão, para a tela. */
export function rotuloDaForca(forca: ForcaDaSugestao): string {
  return {
    exata: 'mesmo nome',
    forte: 'mesmo nome e sobrenome',
    parcial: 'nome parecido — confira',
  }[forca]
}
