/*
 * A MATEMÁTICA DO ESPELHO DE PONTO.
 *
 * POR QUE ISTO É UM MÓDULO, E NÃO UM PEDAÇO DA TELA
 * O app precisa exatamente desta conta em três lugares: no espelho, no painel
 * do admin e na exportação em CSV. Se ela morasse dentro de um componente
 * React, o painel teria que reescrevê-la — e a partir do primeiro conserto feito num dos lados
 * o espelho do funcionário e o relatório do patrão passariam a discordar sobre
 * quantas horas a pessoa trabalhou. Num sistema de prova trabalhista essa
 * divergência é o pior defeito possível. Por isso: sem React, sem Supabase, sem
 * relógio — só funções puras, e um teste para cada regra.
 *
 * A ÚNICA IMPORTAÇÃO É DE TIPO, DE PROPÓSITO
 * `import type` some por inteiro na compilação. É isso que deixa este arquivo
 * ser carregado num teste de Node sem arrastar `batidas.ts` -> `supabase.ts`,
 * que exige variáveis de ambiente e uma rede. NÃO troque por importação de
 * valor: os testes param de rodar na hora. (O import aponta para `formato.ts`,
 * que é onde o tipo mora — mesmo motivo, um degrau a menos de indireção.)
 */
import type { Batida } from './formato'

/* ------------------------------------------------------------------ */
/* Meses: `YYYY-MM`, o mesmo recorte que a consulta usa                */
/* ------------------------------------------------------------------ */

const FORMATO_DO_MES = /^(\d{4})-(\d{2})$/
const FORMATO_DO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/

function partesDoMes(mes: string): { ano: number; mes: number } {
  const casou = FORMATO_DO_MES.exec(mes)
  if (!casou) throw new Error(`Mês inválido: "${mes}". O formato é AAAA-MM.`)
  const numeroDoMes = Number(casou[2])
  if (numeroDoMes < 1 || numeroDoMes > 12) throw new Error(`Mês inválido: "${mes}".`)
  return { ano: Number(casou[1]), mes: numeroDoMes }
}

/**
 * `2026-13` é mês? `31/08/2026` é dia?
 *
 * ESTAS DUAS PERGUNTAS SÃO A BORDA DA URL
 * `montarEspelho`, `primeiroDiaDoMes` e `dataLocal` levantam exceção com
 * entrada malformada, e isso é certo — o que não pode é a exceção subir dentro
 * do render de uma tela. Se o mês nascesse só das setas do espelho, o caso
 * seria inalcançável; mas o painel do admin lê o período da URL, e
 * `?de=2026-13-40` é digitável por qualquer um. Quem lê a URL pergunta ANTES,
 * com estas funções, e cai no período padrão em vez de na tela branca.
 */
export function ehMesValido(valor: string): boolean {
  const casou = FORMATO_DO_MES.exec(valor)
  if (!casou) return false
  const numeroDoMes = Number(casou[2])
  return numeroDoMes >= 1 && numeroDoMes <= 12
}

export function ehDiaValido(valor: string): boolean {
  const casou = FORMATO_DO_DIA.exec(valor)
  if (!casou) return false
  // `Date.UTC` aceita 31 de fevereiro e devolve 3 de março — por isso a volta:
  // só é dia de verdade quando o `Date` resultante se escreve igual à entrada.
  const data = new Date(Date.UTC(Number(casou[1]), Number(casou[2]) - 1, Number(casou[3])))
  return data.toISOString().slice(0, 10) === valor
}

/** `2026-08-31` -> `2026-08`. O dia vem do banco (`dia_civil`), já no fuso certo. */
export function mesDe(diaISO: string): string {
  const casou = FORMATO_DO_DIA.exec(diaISO)
  if (!casou) throw new Error(`Dia inválido: "${diaISO}". O formato é AAAA-MM-DD.`)
  return `${casou[1]}-${casou[2]}`
}

/**
 * Anda `passo` meses. Vai pelo `Date` em vez de somar 1 no número do mês porque
 * é ele que sabe que dezembro + 1 é janeiro do ano seguinte.
 */
function deslocarMes(mes: string, passo: number): string {
  const { ano, mes: numeroDoMes } = partesDoMes(mes)
  const data = new Date(ano, numeroDoMes - 1 + passo, 1)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
}

export function mesAnterior(mes: string): string {
  return deslocarMes(mes, -1)
}

export function mesSeguinte(mes: string): string {
  return deslocarMes(mes, 1)
}

export function primeiroDiaDoMes(mes: string): string {
  partesDoMes(mes)
  return `${mes}-01`
}

/**
 * Último dia do mês. `new Date(ano, mes, 0)` é o dia 0 do mês SEGUINTE, ou seja,
 * o último do mês pedido — e é assim que fevereiro de ano bissexto sai com 29
 * sem nenhuma tabela de dias no código.
 */
export function ultimoDiaDoMes(mes: string): string {
  const { ano, mes: numeroDoMes } = partesDoMes(mes)
  const ultimo = new Date(ano, numeroDoMes, 0).getDate()
  return `${mes}-${String(ultimo).padStart(2, '0')}`
}

/**
 * `Date` à meia-noite LOCAL. `new Date('2026-08-03')` seria lido como UTC e, em
 * fuso negativo, voltaria um dia — o rótulo diria 2 de agosto.
 */
function dataLocal(diaISO: string): Date {
  const casou = FORMATO_DO_DIA.exec(diaISO)
  if (!casou) throw new Error(`Dia inválido: "${diaISO}". O formato é AAAA-MM-DD.`)
  return new Date(Number(casou[1]), Number(casou[2]) - 1, Number(casou[3]))
}

function comInicialMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** `2026-08` -> "Agosto de 2026". */
export function rotuloDoMes(mes: string): string {
  const { ano, mes: numeroDoMes } = partesDoMes(mes)
  const formatado = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(ano, numeroDoMes - 1, 1))
  return comInicialMaiuscula(formatado)
}

/** `2026-08-03` -> "seg, 03 de ago". */
export function rotuloDoDia(diaISO: string): string {
  const formatado = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(dataLocal(diaISO))
  // pt-BR devolve "seg., 03 de ago." — os pontos abreviativos só fazem barulho
  // numa lista de 22 linhas.
  return comInicialMaiuscula(formatado.replace(/\./g, ''))
}

/**
 * `2026-08-31` -> "31/08/2026".
 *
 * É esta forma, e não a ISO, que vai para o CSV: o Excel em português lê
 * `31/08/2026` como data na hora, e lê `2026-08-31` como texto — ou, pior, o
 * reinterpreta em `MM/DD` e transforma 08/09 em 9 de agosto.
 */
export function dataBrasileira(diaISO: string): string {
  const casou = FORMATO_DO_DIA.exec(diaISO)
  if (!casou) throw new Error(`Dia inválido: "${diaISO}". O formato é AAAA-MM-DD.`)
  return `${casou[3]}/${casou[2]}/${casou[1]}`
}

/** `2026-08-31` -> "segunda-feira". Coluna do CSV: sábado e domingo saltam à vista. */
export function diaDaSemana(diaISO: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(dataLocal(diaISO))
}

/* ------------------------------------------------------------------ */
/* O cálculo                                                           */
/* ------------------------------------------------------------------ */

/*
 * OS GENÉRICOS ABAIXO NÃO MUDAM UMA LINHA DE COMPORTAMENTO.
 *
 * O espelho do funcionário passa `Batida`; o painel do admin passa
 * `BatidaDoAdmin`, que é a mesma linha com nome, e-mail, origem e motivo do
 * ajuste por cima. Sem o parâmetro de tipo, `agruparPorDia` devolveria os dias
 * com as batidas estreitadas de volta para `Batida` e o CSV perderia justamente
 * as colunas que precisa. `<T extends Batida = Batida>` resolve isso com valor
 * padrão: quem só usa `Batida` (o espelho) nem escreve o parâmetro de tipo.
 */

/** Um par entrada/saída. Duas batidas viram um bloco; quatro viram dois. */
export interface BlocoTrabalhado<T extends Batida = Batida> {
  inicio: T
  fim: T
  /** Duração do bloco em milissegundos. Nunca negativa. */
  duracaoMs: number
}

export interface DiaDoEspelho<T extends Batida = Batida> {
  /** `dia_civil` do banco, em `America/Sao_Paulo`. Nunca recalculado aqui. */
  dia: string
  /** Todas as batidas do dia, da primeira para a última. */
  batidas: T[]
  blocos: BlocoTrabalhado<T>[]
  /**
   * Número ímpar de batidas: falta uma para fechar algum par. Zero batidas NÃO
   * é dia incompleto — é dia sem trabalho (folga, fim de semana, feriado), e
   * marcar o sábado de vermelho seria ruído, não informação.
   */
  incompleto: boolean
  /**
   * Minutos trabalhados no dia. **Zero quando o dia está incompleto**: com um
   * número ímpar de batidas não dá para saber QUAL delas falta, então somar os
   * pares que sobraram seria inventar um horário. Quem conserta é o admin, no
   * painel, e aí o dia volta a contar sozinho.
   */
  minutos: number
  /** Alguma batida do dia foi criada ou corrigida pelo admin. */
  temAjuste: boolean
}

/** O que se diz sobre um conjunto de dias — de um mês ou de qualquer período. */
export interface ResumoDeDias {
  /** Soma dos minutos dos dias — que já excluem os incompletos. */
  minutos: number
  diasComBatida: number
  diasIncompletos: number
}

export interface EspelhoDoMes<T extends Batida = Batida> extends ResumoDeDias {
  mes: string
  /** Só os dias que têm batida, em ordem crescente. Dia sem batida não vira linha. */
  dias: DiaDoEspelho<T>[]
}

/** Ordem cronológica de verdade, pelo carimbo do servidor. */
function porMomento(a: Batida, b: Batida): number {
  return new Date(a.registrado_em).getTime() - new Date(b.registrado_em).getTime()
}

/**
 * O dia de uma pessoa.
 *
 * O PAREAMENTO É POSICIONAL, NÃO PELO `tipo`
 * 1ª com 2ª, 3ª com 4ª, e assim por diante. Não se olha se o banco chamou a
 * batida de `entrada` ou de `extra`: a 5ª batida do dia nasce `extra` de
 * propósito (para não quebrar a sequência das quatro primeiras), e parear por
 * rótulo faria a 5ª ficar órfã enquanto o dia continuava "completo". Contando
 * por posição, cinco batidas são cinco — ímpar, portanto incompleto —, que é
 * exatamente a regra.
 */
export function calcularDia<T extends Batida>(dia: string, batidasDoDia: T[]): DiaDoEspelho<T> {
  const batidas = [...batidasDoDia].sort(porMomento)
  const incompleto = batidas.length % 2 === 1

  const blocos: BlocoTrabalhado<T>[] = []
  for (let i = 0; i + 1 < batidas.length; i += 2) {
    const inicio = batidas[i]
    const fim = batidas[i + 1]
    // `Math.max(0, ...)` é rede de segurança: a ordenação acima já garante o
    // sinal, mas uma correção do admin com horário fora da sequência não pode
    // virar hora negativa no espelho de ninguém.
    const duracaoMs = Math.max(
      0,
      new Date(fim.registrado_em).getTime() - new Date(inicio.registrado_em).getTime(),
    )
    blocos.push({ inicio, fim, duracaoMs })
  }

  const somaMs = blocos.reduce((total, bloco) => total + bloco.duracaoMs, 0)

  return {
    dia,
    batidas,
    blocos,
    incompleto,
    // Arredonda UMA vez, no dia. O total do mês é a soma destes números
    // arredondados — assim a coluna da tela fecha com o número do topo, que é
    // a primeira coisa que alguém confere com a calculadora do celular.
    minutos: incompleto ? 0 : Math.round(somaMs / 60000),
    temAjuste: batidas.some((batida) => batida.ajuste_manual),
  }
}

/**
 * Batidas soltas viram dias, em ordem crescente.
 *
 * O AGRUPAMENTO É POR `dia_civil`, QUE VEM DO BANCO
 * Nada aqui deduz o dia a partir de `registrado_em`: isso usaria o fuso do
 * aparelho, e uma batida das 22h aberta num celular na Europa cairia no dia
 * seguinte. O `dia_civil` foi carimbado pelo gatilho do banco em
 * `America/Sao_Paulo` e é a única verdade sobre a que dia a batida pertence.
 *
 * Uma jornada que atravessa a meia-noite não é caso especial nenhum: a entrada
 * fica num dia e a saída no outro, os dois ficam com uma batida só, os dois
 * saem ímpares e nenhum dos dois entra no total. É o desenho, não um defeito —
 * quem corrige é o admin.
 *
 * Não recebe recorte de período de propósito: quem limita o intervalo é a
 * consulta. Assim esta função serve tanto ao mês do funcionário quanto ao
 * período livre que o painel e o CSV exportam.
 */
export function agruparPorDia<T extends Batida>(batidas: T[]): DiaDoEspelho<T>[] {
  const porDia = new Map<string, T[]>()
  for (const batida of batidas) {
    const doDia = porDia.get(batida.dia_civil)
    if (doDia) doDia.push(batida)
    else porDia.set(batida.dia_civil, [batida])
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, doDia]) => calcularDia(dia, doDia))
}

/** O cabeçalho de qualquer período: total, dias com batida e dias tortos. */
export function resumirDias<T extends Batida>(dias: DiaDoEspelho<T>[]): ResumoDeDias {
  return {
    minutos: dias.reduce((total, dia) => total + dia.minutos, 0),
    diasComBatida: dias.length,
    diasIncompletos: dias.filter((dia) => dia.incompleto).length,
  }
}

/** O mês inteiro, a partir das linhas que a consulta trouxe. */
export function montarEspelho<T extends Batida>(mes: string, batidas: T[]): EspelhoDoMes<T> {
  partesDoMes(mes)
  const dias = agruparPorDia(batidas)
  return { mes, dias, ...resumirDias(dias) }
}

/* ------------------------------------------------------------------ */
/* Rótulos                                                             */
/* ------------------------------------------------------------------ */

/** `492` -> "8h12". Compacto porque a tela é de celular e a fonte é tabular. */
export function formatarDuracao(minutos: number): string {
  const total = Math.max(0, Math.round(minutos))
  const horas = Math.floor(total / 60)
  const resto = total % 60
  return `${horas}h${String(resto).padStart(2, '0')}`
}
