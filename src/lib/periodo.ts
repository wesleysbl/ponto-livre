/*
 * O PERÍODO DO PAINEL — e a borda que impede a URL de virar tela branca.
 *
 * O espelho do funcionário navega por MÊS, com duas setas: o valor nunca vem de
 * fora e por isso nunca é inválido. O painel do admin é outra história — ele
 * fecha o mês, mas também confere "de 26 a 25", "só a semana passada", "o dia do
 * inventário" —, e o período mora na URL para o link ser colável no WhatsApp e
 * sobreviver ao F5. A partir daí, `?de=2026-13-40` é digitável por qualquer um,
 * e `primeiroDiaDoMes`/`dataLocal` levantam exceção com entrada malformada.
 *
 * Este módulo é o único lugar onde essa entrada é lida, e ele NUNCA levanta:
 * o que não é período vira o período padrão. Puro, sem React e sem rede, para
 * a regra ser testável sem montar tela nenhuma.
 */
import {
  dataBrasileira,
  ehDiaValido,
  ehMesValido,
  mesDe,
  primeiroDiaDoMes,
  rotuloDoMes,
  ultimoDiaDoMes,
} from './horas'
import { diaCivilDeHoje } from './formato'

/** Intervalo fechado de dias civis, `AAAA-MM-DD` nas duas pontas. */
export interface Periodo {
  inicio: string
  fim: string
}

/** O mês inteiro como período. É o recorte de fechamento, o mais usado. */
export function periodoDoMes(mes: string): Periodo {
  return { inicio: primeiroDiaDoMes(mes), fim: ultimoDiaDoMes(mes) }
}

/**
 * O mês corrente, medido pelo dia civil do PONTO (`FUSO`, em `formato.ts`).
 *
 * Não é `new Date().getMonth()`: um admin abrindo o painel às 22h do dia 31 de
 * outro fuso veria o mês seguinte, vazio, e concluiria que o mês sumiu.
 */
export function periodoPadrao(): Periodo {
  return periodoDoMes(mesDe(diaCivilDeHoje()))
}

export function ehPeriodoValido(periodo: Periodo): boolean {
  return (
    ehDiaValido(periodo.inicio) && ehDiaValido(periodo.fim) && periodo.inicio <= periodo.fim
  )
}

/**
 * Lê o período de dois textos quaisquer — tipicamente `?de=` e `?ate=`.
 *
 * AS TRÊS REGRAS, NESTA ORDEM
 *  1. Um dos dois faltando ou malformado -> o padrão INTEIRO. Aproveitar só a
 *     metade válida daria um período que ninguém pediu, com cara de escolhido:
 *     "de 01/08 até hoje" quando a pessoa queria "de 01/08 até 31/08" e errou a
 *     digitação. Melhor voltar ao mês corrente, que a tela mostra por extenso.
 *  2. Os dois válidos, mas invertidos -> troca. Quem arrastou as datas ao
 *     contrário quis dizer o intervalo, e recusar seria pedantismo.
 *  3. Os dois válidos e em ordem -> passa.
 *
 * Não levanta nunca. É essa promessa que deixa o componente chamar a função
 * dentro do próprio render sem `try`.
 */
export function lerPeriodo(
  de: string | null | undefined,
  ate: string | null | undefined,
  padrao: Periodo = periodoPadrao(),
): Periodo {
  if (!de || !ate || !ehDiaValido(de) || !ehDiaValido(ate)) return padrao
  return de <= ate ? { inicio: de, fim: ate } : { inicio: ate, fim: de }
}

/** Os parâmetros de URL de um período. O contrário de `lerPeriodo`. */
export function parametrosDoPeriodo(periodo: Periodo): { de: string; ate: string } {
  return { de: periodo.inicio, ate: periodo.fim }
}

/** O período é exatamente um mês do calendário, do dia 1 ao último? */
export function ehMesInteiro(periodo: Periodo): boolean {
  if (!ehPeriodoValido(periodo)) return false
  const mes = periodo.inicio.slice(0, 7)
  return (
    ehMesValido(mes) &&
    periodo.inicio === primeiroDiaDoMes(mes) &&
    periodo.fim === ultimoDiaDoMes(mes)
  )
}

/**
 * O período por extenso, no cabeçalho da tela.
 *
 * Mês fechado sai como "Agosto de 2026" — é assim que se fala do fechamento, e
 * ver "01/08/2026 a 31/08/2026" no topo faria a tela parecer um filtro de
 * relatório em vez do mês da folha. Qualquer outro recorte sai com as duas
 * datas, porque aí a informação É o recorte.
 */
export function rotuloDoPeriodo(periodo: Periodo): string {
  if (!ehPeriodoValido(periodo)) return 'período inválido'
  if (ehMesInteiro(periodo)) return rotuloDoMes(periodo.inicio.slice(0, 7))
  if (periodo.inicio === periodo.fim) return dataBrasileira(periodo.inicio)
  return `${dataBrasileira(periodo.inicio)} a ${dataBrasileira(periodo.fim)}`
}

/**
 * Pedaço de nome de arquivo: `2026-08` para um mês fechado,
 * `2026-08-01-a-2026-09-15` para o resto. Ordena sozinho na pasta de downloads.
 */
export function apelidoDoPeriodo(periodo: Periodo): string {
  if (ehMesInteiro(periodo)) return periodo.inicio.slice(0, 7)
  return `${periodo.inicio}-a-${periodo.fim}`
}
