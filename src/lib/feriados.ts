/*
 * OS FERIADOS NACIONAIS — que dia é feriado em todo o Brasil, sem banco e sem
 * rede.
 *
 * O CASO QUE ESTE MÓDULO RESOLVE
 * Um feriado numa segunda-feira (12/10/2026, por exemplo) aparecia na tela da
 * pessoa como um dia útil qualquer, "Sem batida", logo abaixo do sábado e do
 * domingo marcados como "fim de semana". Quem fecha o mês olhava aquele dia
 * vazio e precisava lembrar, de cabeça, que era feriado. Daqui sai o nome do
 * feriado de cada data, e a tela põe a etiqueta "feriado", como já põe "fim de
 * semana" no sábado e no domingo.
 *
 * SÓ OS NACIONAIS, E POR QUÊ
 * São os dez que o governo federal publica todo ano como feriado nacional: os
 * nove de data fixa e a Paixão de Cristo, que anda com a Páscoa. Carnaval,
 * Quarta-feira de Cinzas e Corpus Christi são ponto facultativo, não feriado,
 * e por isso não estão aqui. Os feriados do estado e da cidade mudam de lugar
 * para lugar e ficam para um cadastro próprio.
 *
 * O Dia Nacional de Zumbi e da Consciência Negra (20/11) é feriado nacional
 * desde a Lei 14.759/2023: vale de 2024 em diante.
 *
 * A CONTA NÃO MUDA. A etiqueta só marca o dia; o total de horas continua
 * saindo das batidas, como no sábado e no domingo.
 *
 * SEM RELÓGIO E SEM FUSO. Um dia civil (`AAAA-MM-DD`) não tem fuso, e a conta
 * da Páscoa é aritmética de calendário: o mesmo resultado em qualquer aparelho.
 */
import { ehDiaValido } from './horas'

export interface Feriado {
  /** `AAAA-MM-DD`. */
  dia: string
  /** "Nossa Senhora Aparecida". */
  nome: string
}

/** `[MM-DD, nome, ano em que passou a valer]`. */
const DATAS_FIXAS: ReadonlyArray<readonly [string, string, number]> = [
  ['01-01', 'Confraternização Universal', 0],
  ['04-21', 'Tiradentes', 0],
  ['05-01', 'Dia do Trabalho', 0],
  ['09-07', 'Independência do Brasil', 0],
  ['10-12', 'Nossa Senhora Aparecida', 0],
  ['11-02', 'Finados', 0],
  ['11-15', 'Proclamação da República', 0],
  ['11-20', 'Consciência Negra', 2024],
  ['12-25', 'Natal', 0],
]

const doisDigitos = (numero: number) => String(numero).padStart(2, '0')

/**
 * O domingo de Páscoa do ano, pelo calendário gregoriano (o algoritmo de
 * Meeus/Jones/Butcher, o "anônimo gregoriano"). Devolve `AAAA-MM-DD`.
 */
export function domingoDePascoa(ano: number): string {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`
}

/** A data `dias` dias depois (ou antes, com número negativo) de `dia`. */
function somarDias(dia: string, dias: number): string {
  const [ano, mes, numero] = dia.split('-').map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, numero + dias))
  return `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}`
}

const PORANO = new Map<number, ReadonlyMap<string, string>>()

/** Os feriados nacionais de um ano, por data. Guardados depois da primeira conta. */
function feriadosPorData(ano: number): ReadonlyMap<string, string> {
  const guardado = PORANO.get(ano)
  if (guardado) return guardado
  const mapa = new Map<string, string>()
  for (const [mesDia, nome, desde] of DATAS_FIXAS) {
    if (ano >= desde) mapa.set(`${ano}-${mesDia}`, nome)
  }
  mapa.set(somarDias(domingoDePascoa(ano), -2), 'Paixão de Cristo')
  PORANO.set(ano, mapa)
  return mapa
}

/** Os feriados nacionais de um ano, em ordem de data. */
export function feriadosNacionais(ano: number): Feriado[] {
  return [...feriadosPorData(ano)]
    .map(([dia, nome]) => ({ dia, nome }))
    .sort((x, y) => x.dia.localeCompare(y.dia))
}

/**
 * O nome do feriado nacional do dia, ou `null` se o dia não é feriado (ou não
 * é uma data válida). É a função que a lista de dias da tela usa
 * (`listarDiasDoPeriodo`, em `corrigir.ts`).
 */
export function feriadoNacional(dia: string): string | null {
  if (!ehDiaValido(dia)) return null
  return feriadosPorData(Number(dia.slice(0, 4))).get(dia) ?? null
}
