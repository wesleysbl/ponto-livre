/*
 * OS FERIADOS NACIONAIS DA DEMONSTRAÇÃO E DA AUTOMAÇÃO DOS PRINTS
 *
 * A mesma regra de `src/lib/feriados.ts`, em JavaScript puro: a semente
 * (`demo/semear.mjs`) e o passo do relógio de `.github/workflows/prints.yml`
 * rodam no Node, sem o TypeScript do app. São os dez feriados nacionais que o
 * app conta: os nove de data fixa (a Consciência Negra de 2024 em diante) e a
 * Paixão de Cristo, a sexta antes do domingo de Páscoa.
 *
 * POR QUE A MESMA REGRA: no saldo, o feriado é dia sem jornada. Com outra
 * lista, a semente poria batidas num dia que as telas mostram como feriado (e
 * que o saldo conta como hora extra), ou deixaria sem batida um dia útil (uma
 * falta que ninguém pediu); e o "hoje" falso da automação poderia cair num
 * feriado, com o espelho e o comprovante de um dia sem jornada.
 *
 * `src/lib/feriados.test.ts` compara este arquivo com o do app, dia a dia, de
 * 1900 a 2199: mudou um, muda o outro.
 *
 * Rodado direto, escreve o nome do feriado do dia, ou nada:
 *
 *   node demo/feriados.mjs 2026-04-03      Paixão de Cristo
 *   node demo/feriados.mjs 2026-04-06      (nada)
 */
import { pathToFileURL } from 'node:url'

/** `[MM-DD, nome, ano em que passou a valer]`, como em `src/lib/feriados.ts`. */
const DATAS_FIXAS = [
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

const doisDigitos = (numero) => String(numero).padStart(2, '0')

/** O domingo de Páscoa do ano (Meeus/Jones/Butcher), em `AAAA-MM-DD`: a conta do app. */
export function domingoDePascoa(ano) {
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

/** A sexta antes do domingo de Páscoa. */
function paixaoDeCristo(ano) {
  const [, mes, dia] = domingoDePascoa(ano).split('-').map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, dia - 2))
  return `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}`
}

/** O nome do feriado nacional do dia (`AAAA-MM-DD`), ou `null`. */
export function feriadoNacional(dia) {
  if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null
  const ano = Number(dia.slice(0, 4))
  if (dia === paixaoDeCristo(ano)) return 'Paixão de Cristo'
  const fixo = DATAS_FIXAS.find(([mesDia, , desde]) => mesDia === dia.slice(5) && ano >= desde)
  return fixo ? fixo[1] : null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dia = process.argv[2] ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    console.error('Uso: node demo/feriados.mjs AAAA-MM-DD')
    process.exit(2)
  }
  const nome = feriadoNacional(dia)
  if (nome) console.log(nome)
}
