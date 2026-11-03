/*
 * O SALDO DO PONTO: previsto, trabalhado, abonado, atraso, falta e saldo de
 * uma pessoa num dia, e o resumo do mês.
 *
 * POR QUE UMA CONTA SÓ
 * O espelho do funcionário, os painéis do admin, a folha impressa e o CSV
 * mostram estes números. Se cada tela fizesse a sua conta, a primeira correção
 * feita num lado deixaria o espelho e a folha assinada discordando sobre o
 * débito de alguém, o pior defeito possível num registro de ponto. Por isso,
 * como `horas.ts`: sem React, sem Supabase, sem relógio. "Hoje" é PARÂMETRO,
 * nunca `new Date()` aqui dentro.
 *
 * AS IMPORTAÇÕES
 * `horas.ts`, `formato.ts`, `ausencias.ts`, `feriados.ts` e `jornada.ts` são
 * puros (nenhum puxa `supabase.ts`), então daqui se importa valor deles sem
 * arrastar rede para o teste. De `configuracao.ts` e `cadastro.ts` vêm só
 * tipos. NÃO importe valor de `batidas.ts`, `faltas.ts` ou de qualquer módulo
 * que fale com o banco: o teste deste arquivo para de rodar em Node.
 *
 * O TRABALHADO NÃO MUDA
 * É o `minutos` de `calcularDia` (`horas.ts`), o mesmo número do espelho: todos
 * os pares, dentro ou fora da jornada, e zero no dia incompleto. Esta conta
 * só ACRESCENTA previsto, abono e saldo por cima dele.
 *
 * O DIA INCOMPLETO FICA COM O SALDO SUSPENSO
 * Dia passado com número ímpar de batidas não é cobrado: o trabalhado dele é
 * zero até alguém corrigir a batida, e cobrar a jornada inteira seria acusar
 * de falta quem só esqueceu de bater a saída (e, com atestado no dia, cobrar
 * duas vezes). O dia fica no estado `pendente`: previsto, trabalhado e abonado
 * continuam à vista, saldo, crédito, débito e atraso ficam zero, e o resumo do
 * mês conta à parte quantos dias ficaram de fora (`diasIncompletos`), para a
 * tela dizer que o saldo do mês ainda não os inclui.
 *
 * AS REGRAS (medidas em minutos)
 *   • Jornada: a própria da ficha, se houver; senão a da empresa
 *     (`jornadaAplicavel`). Previsto = soma dos blocos do dia da semana.
 *   • O primeiro dia cobrado (`cobrancaDesde`) é a mais nova entre a data da
 *     ficha e a "Saldo calculado a partir de" da configuração. Quem a monta é
 *     `regrasDoSaldo`, e só ela (ver lá).
 *   • Estado do dia (`estadoDoDia`):
 *       fora          antes de `cobrancaDesde`, sem `cobrancaDesde`, ou
 *                     depois de hoje: nada de previsto, atraso, falta ou
 *                     saldo; só o trabalhado, as marcas das ausências e, se
 *                     o dia não é futuro, o abono;
 *       em_andamento  hoje: previsto, trabalhado, abonado e atraso calculados,
 *                     mas sem falta, sem débito e SEM CRÉDITO (o dia não
 *                     acabou; saldo, crédito e débito ficam 0 e o
 *                     `saldoBruto` mostra a conta parcial). Não entra no
 *                     resumo do mês;
 *       pendente      dia passado desde `cobrancaDesde` com número ímpar de
 *                     batidas: previsto, trabalhado e abonado calculados,
 *                     saldo e atraso suspensos (zero, sem falta e sem a marca
 *                     de atraso). Fora do saldo do mês, contado em
 *                     `diasIncompletos`;
 *       cobranca      dia passado desde `cobrancaDesde`: a conta inteira.
 *   • Abonam: atestado médico e falta justificada. "Outro motivo" só marca.
 *   • Cobertura: por dias = o dia inteiro; por horário = [hora_inicio, hora_fim).
 *   • Abonado = a parte da JORNADA coberta por ausência que abona e NÃO
 *     trabalhada. Fora da jornada não abona; trabalho dentro do atestado conta
 *     como trabalho, uma vez só.
 *   • O ABONO VALE EM TODO DIA QUE JÁ CHEGOU, inclusive no estado `fora` por
 *     falta de `cobrancaDesde` ou antes dele. O abono não acusa ninguém: é a
 *     hora do atestado que quem administra lançou, e ela precisa somar no
 *     total do dia (`horasDoDia`) para o fechamento. Só o dia futuro fica sem
 *     abono. Previsto, atraso, falta e saldo continuam só na cobrança.
 *   • Feriado nacional (`feriados.ts`) é dia sem jornada, como o sábado e o
 *     domingo: nada de previsto nem de falta, o trabalhado vira crédito e o
 *     atestado só marca. O dia leva o nome do feriado (`feriado`), para a
 *     tela e a folha dizerem FERIADO onde diriam "dia sem jornada".
 *   • Horas do dia = trabalhado + abonado (zero no dia incompleto, como o
 *     trabalhado dele). É o número grande do cartão do dia e do total do
 *     período nas telas; a coluna "Trabalhado" da folha e do CSV continua
 *     sendo só o das batidas.
 *   • Saldo bruto = trabalhado + abonado - previsto. Tolerância (CLT, art. 58,
 *     §1º): |bruto| <= tolerância vira 0; acima dela vale o bruto INTEIRO.
 *   • Falta = previsto > 0, nenhuma batida no dia e abonado < previsto.
 *   • Atraso (informativo, para a marca): por bloco, a entrada esperada é o
 *     início do bloco empurrado para depois do trecho inicial coberto por
 *     ausência que abona; atraso = início do primeiro par que alcança o bloco
 *     menos a entrada esperada. Bloco sem par não tem atraso (é débito). O dia
 *     tem a marca quando o atraso passa da tolerância. NÃO entra no saldo à
 *     parte: o saldo já enxerga o tempo não trabalhado.
 *   • Resumo do mês: só os dias "cobrança"; sem acúmulo entre meses. Os
 *     "pendente" ficam de fora e são contados à parte.
 *
 * O RELÓGIO É O DO FUSO DO PONTO
 * Minuto do dia de uma batida = hora de parede em `FUSO` (Brasília), pela
 * mesma `Intl` de `formatarHora`, e nada de `getHours()`, que é o fuso de quem
 * olha. A jornada e a ausência por horário já estão nesse relógio.
 */
import {
  calcularDia,
  ehDiaValido,
  formatarDuracao,
  primeiroDiaDoMes,
  ultimoDiaDoMes,
  type DiaDoEspelho,
} from './horas'
import { diaCivilDoInstante, FUSO, type Batida } from './formato'
import { diasDoPeriodo, ehAtiva, type Ausencia, type DiaComAusencia, type TipoDeAusencia } from './ausencias'
import { feriadoNacional } from './feriados'
import {
  diaDaSemanaIso,
  jornadaAplicavel,
  minutosDaHora,
  trechosDoDiaDaSemana,
  type Jornada,
  type Trecho,
} from './jornada'
import type { ConfiguracaoDoPonto } from './configuracao'
import type { FichaDoFuncionario } from './cadastro'

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type EstadoDoDia = 'fora' | 'em_andamento' | 'pendente' | 'cobranca'

/** Por que o dia está fora da cobrança. */
export type MotivoDeFora = 'sem_bate_ponto' | 'antes_da_cobranca' | 'futuro'

/** O que a conta precisa saber da pessoa e da empresa. Quem monta é `regrasDoSaldo`. */
export interface RegrasDoSaldo {
  /** `ponto_configuracao.jornada`, já lida por `lerJornada`. */
  jornadaDaEmpresa: Jornada
  /** `ponto_funcionarios.jornada`, por `lerJornadaPropria`. Nula (ou vazia) = a da empresa. */
  jornadaPropria: Jornada | null
  /**
   * O primeiro dia cobrado (`AAAA-MM-DD`): a mais nova entre a data da ficha
   * ("Passou a bater ponto aqui em") e a "Saldo calculado a partir de" da
   * configuração (`inicioDaCobranca`). Nulo = a ficha ainda não tem a data, e
   * nenhum dia da pessoa é cobrado.
   */
  cobrancaDesde: string | null
  /** `ponto_configuracao.tolerancia_minutos`. */
  toleranciaMinutos: number
  /** O dia civil de hoje no fuso do ponto (`diaCivilDeHoje()`), dado por quem chama. */
  hoje: string
  /**
   * O nome do feriado do dia, ou `null`. Sem ela, valem os feriados nacionais
   * (`feriadoNacional`): nenhuma tela precisa lembrar de passá-la, e por isso
   * nenhuma tela diverge da outra. Os testes que querem um mês sem feriado
   * passam `() => null`.
   */
  feriadoDoDia?: (dia: string) => string | null
}

/** Os tipos de ausência que abonam. "Outro motivo" só marca o dia. */
export const TIPOS_QUE_ABONAM: readonly TipoDeAusencia[] = ['atestado_medico', 'falta_justificada']

export function ausenciaAbona(tipo: TipoDeAusencia): boolean {
  return TIPOS_QUE_ABONAM.includes(tipo)
}

/** Uma ausência ativa no dia, com o trecho que ela cobre, para a marca da tela. */
export interface CoberturaDoDia {
  ausencia: Ausencia
  /** Minutos desde a meia-noite do fuso do ponto: `[inicio, fim)`. Dia inteiro = 0 a 1440. */
  inicio: number
  fim: number
  /** Por dias (o dia inteiro) ou por horário. */
  diaInteiro: boolean
  /** Atestado médico ou falta justificada. */
  abona: boolean
  /**
   * Quanto DESTA ausência virou abono: a parte dela dentro da jornada e não
   * trabalhada. Zero fora da jornada, no dia sem jornada (fim de semana e
   * feriado), para "outro motivo" e no dia futuro.
   */
  minutosAbonados: number
}

export interface SaldoDoDia<T extends Batida = Batida> {
  dia: string
  estado: EstadoDoDia
  /** Só no estado `fora`. */
  motivoDeFora: MotivoDeFora | null
  /** O dia das batidas, intacto, de `calcularDia`. */
  espelho: DiaDoEspelho<T>
  /** Os blocos previstos (vazio fora da cobrança e no dia sem jornada). */
  blocosPrevistos: Trecho[]
  /**
   * Dia cobrado (em andamento, pendente ou cobrança) sem nenhum bloco previsto:
   * o sábado e o domingo da semente, e o feriado. O que se trabalha nele é
   * crédito inteiro, e a tela diz por quê ("dia sem jornada", ou "feriado").
   */
  semJornada: boolean
  /** O nome do feriado (`feriados.ts`), em qualquer estado; `null` no dia comum. */
  feriado: string | null
  previsto: number
  /** = `espelho.minutos`. Mostrado em qualquer estado. */
  trabalhado: number
  /**
   * A parte da jornada coberta por atestado ou falta justificada e não
   * trabalhada. Calculado em todo dia que não é futuro, inclusive no estado
   * `fora` (sem `cobrancaDesde`, ou antes dele): ver o cabeçalho.
   */
  abonado: number
  /**
   * trabalhado + abonado - previsto, antes da tolerância. Zero nos estados
   * `fora` e `pendente`. Em `em_andamento` é a conta parcial de hoje, que a
   * tela NUNCA mostra como débito.
   */
  saldoBruto: number
  /** Depois da tolerância. Só não é zero na cobrança. */
  saldo: number
  credito: number
  debito: number
  /** Minutos de atraso somados nos blocos (informativo). Zero fora da cobrança e no dia pendente. */
  atraso: number
  /** A marca: atraso do dia acima da tolerância. */
  temAtraso: boolean
  falta: boolean
  /** Número ímpar de batidas (o trabalhado é zero até alguém corrigir). Hoje também. */
  incompleto: boolean
  /** As ausências ativas que tocam o dia, abonem ou não, em ordem de início. */
  coberturas: CoberturaDoDia[]
}

export interface ResumoDoSaldo {
  /** Somas dos dias de cobrança. */
  previsto: number
  trabalhado: number
  abonado: number
  /** As horas extras do recorte: a soma dos créditos dos dias. */
  credito: number
  /** As horas negativas do recorte: a soma dos débitos dos dias, com as faltas. */
  debito: number
  /** crédito - débito. */
  saldo: number
  faltas: number
  diasComAtraso: number
  diasDeCobranca: number
  /**
   * Dos dias de cobrança, os que têm jornada prevista (`!semJornada`). É o
   * número que a folha mostra debaixo do saldo do mês: `diasDeCobranca` conta
   * também o sábado e o domingo sem jornada, e ao lado de "17 dias com batida"
   * isso confunde.
   */
  diasComJornada: number
  /** Dias `pendente`: passados, com batida faltando, FORA das somas acima. */
  diasIncompletos: number
}

export interface SaldoDoMes<T extends Batida = Batida> {
  mes: string
  /** Todos os dias do mês, do 1º ao último, tenham batida ou não. */
  dias: SaldoDoDia<T>[]
  resumo: ResumoDoSaldo
  /**
   * Os minutos trabalhados de TODOS os dias do mês, de qualquer estado. É o
   * mesmo total do espelho (`montarEspelho`) quando as batidas que entram são
   * as do mês (as de fora dele são ignoradas aqui, e `montarEspelho` também as
   * deixa de fora). O `resumo.trabalhado` soma só os dias de cobrança.
   */
  trabalhadoNoMes: number
}

/** Um recorte qualquer (o período livre do painel da pessoa), com a mesma conta do mês. */
export interface SaldoDoPeriodo<T extends Batida = Batida> {
  inicio: string
  fim: string
  /** Todos os dias de `inicio` a `fim`, tenham batida ou não. */
  dias: SaldoDoDia<T>[]
  resumo: ResumoDoSaldo
}

/* ------------------------------------------------------------------ */
/* As regras, montadas num lugar só                                    */
/* ------------------------------------------------------------------ */

/*
 * POR QUE AS REGRAS NASCEM AQUI, E NÃO EM CADA TELA
 * O espelho, os dois painéis, a folha e o CSV calculam o saldo da mesma
 * pessoa. Se cada um montasse `RegrasDoSaldo` à mão, a primeira tela que
 * esquecesse a "Saldo calculado a partir de" passaria a cobrar desde a data
 * da ficha, que pode ser a admissão de anos atrás: faltas falsas em todos os
 * meses anteriores, só naquela tela. Montadas por esta função, as regras são
 * as mesmas em todo lugar, e o campo `cobrancaDesde` (que não existe na ficha
 * nem na configuração) obriga quem monta as regras a passar por aqui.
 *
 * Ela fica ao lado do tipo que devolve, e não em `configuracao.ts` ou em
 * `cadastro.ts`, porque junta as duas coisas e só o saldo precisa dela.
 */

/** O que `regrasDoSaldo` lê da configuração. */
export type ConfiguracaoDoSaldo = Pick<ConfiguracaoDoPonto, 'jornada' | 'toleranciaMinutos' | 'saldoAPartirDe'>

/** O que `regrasDoSaldo` lê da ficha da pessoa. */
export type FichaDoSaldo = Pick<FichaDoFuncionario, 'jornada' | 'batePontoDesde'>

/**
 * O primeiro dia cobrado: a MAIS NOVA entre a data da ficha
 * (`batePontoDesde`) e a "Saldo calculado a partir de" da configuração. Sem a
 * data da ficha, `null`: a pessoa continua sem cobrança, por mais antiga que
 * seja a da configuração. As duas são `AAAA-MM-DD`, comparadas como texto (a
 * forma ISO ordena).
 */
export function inicioDaCobranca(batePontoDesde: string | null, saldoAPartirDe: string): string | null {
  if (!batePontoDesde) return null
  return batePontoDesde > saldoAPartirDe ? batePontoDesde : saldoAPartirDe
}

/**
 * As regras do saldo de uma pessoa: a jornada e a tolerância da empresa, a
 * jornada própria e a data da ficha, e hoje. `ficha` nula (a conta sem ficha
 * ligada) = segue a jornada da empresa e não tem dia cobrado.
 */
export function regrasDoSaldo(
  configuracao: ConfiguracaoDoSaldo,
  ficha: FichaDoSaldo | null,
  hoje: string,
): RegrasDoSaldo {
  return {
    jornadaDaEmpresa: configuracao.jornada,
    jornadaPropria: ficha?.jornada ?? null,
    cobrancaDesde: inicioDaCobranca(ficha?.batePontoDesde ?? null, configuracao.saldoAPartirDe),
    toleranciaMinutos: configuracao.toleranciaMinutos,
    hoje,
  }
}

/* ------------------------------------------------------------------ */
/* Trechos                                                             */
/* ------------------------------------------------------------------ */

const MINUTOS_NO_DIA = 24 * 60

/** Junta trechos que se cruzam ou se encostam. Devolve em ordem, sem vazios. */
function unir(trechos: readonly Trecho[]): Trecho[] {
  const ordenados = trechos.filter((t) => t.fim > t.inicio).sort((a, b) => a.inicio - b.inicio)
  const unidos: Trecho[] = []
  for (const trecho of ordenados) {
    const ultimo = unidos[unidos.length - 1]
    if (ultimo && trecho.inicio <= ultimo.fim) ultimo.fim = Math.max(ultimo.fim, trecho.fim)
    else unidos.push({ ...trecho })
  }
  return unidos
}

/** Interseção de duas uniões (cada uma já em ordem e sem cruzamento). */
function intersecao(a: readonly Trecho[], b: readonly Trecho[]): Trecho[] {
  const resultado: Trecho[] = []
  for (const x of a) {
    for (const y of b) {
      const inicio = Math.max(x.inicio, y.inicio)
      const fim = Math.min(x.fim, y.fim)
      if (fim > inicio) resultado.push({ inicio, fim })
    }
  }
  return unir(resultado)
}

function medida(trechos: readonly Trecho[]): number {
  return trechos.reduce((soma, t) => soma + (t.fim - t.inicio), 0)
}

/* ------------------------------------------------------------------ */
/* O relógio do fuso do ponto                                          */
/* ------------------------------------------------------------------ */

const RELOGIO_DO_PONTO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
})

/**
 * O minuto do dia `dia` em que o relógio do fuso do ponto marcava o instante
 * (com fração de segundo). Instante de outro dia civil vai para a borda: 0 se
 * é de antes, 1440 se é de depois. `calcularDia` só pareia batidas do mesmo
 * `dia_civil`, então isto só acontece com dado torto, e aí a borda não inventa
 * trabalho fora do dia.
 */
function minutoDoDia(dia: string, iso: string): number {
  const civil = diaCivilDoInstante(iso)
  if (civil < dia) return 0
  if (civil > dia) return MINUTOS_NO_DIA
  const instante = new Date(iso)
  const partes = RELOGIO_DO_PONTO.formatToParts(instante)
  const numero = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((parte) => parte.type === tipo)?.value ?? '0')
  return (
    (numero('hour') % 24) * 60 +
    numero('minute') +
    numero('second') / 60 +
    instante.getUTCMilliseconds() / 60000
  )
}

/* ------------------------------------------------------------------ */
/* As peças da conta                                                   */
/* ------------------------------------------------------------------ */

/**
 * Em que estado o dia está para a cobrança. `cobrancaDesde` e `hoje` são
 * dias civis `AAAA-MM-DD`, comparados como texto (a forma ISO ordena).
 */
export function estadoDoDia(
  dia: string,
  cobrancaDesde: string | null,
  hoje: string,
): { estado: EstadoDoDia; motivoDeFora: MotivoDeFora | null } {
  if (dia > hoje) return { estado: 'fora', motivoDeFora: 'futuro' }
  if (!cobrancaDesde) return { estado: 'fora', motivoDeFora: 'sem_bate_ponto' }
  if (dia < cobrancaDesde) return { estado: 'fora', motivoDeFora: 'antes_da_cobranca' }
  if (dia === hoje) return { estado: 'em_andamento', motivoDeFora: null }
  return { estado: 'cobranca', motivoDeFora: null }
}

/**
 * O trecho que uma ausência ATIVA cobre no dia, ou `null` se ela não toca o
 * dia. Por horário com hora ilegível também dá `null`: o banco não deixa uma
 * dessas existir (CHECK `ponto_ausencias_modalidade_coerente`), e abonar um
 * intervalo inventado seria pior que não abonar.
 */
export function trechoDaAusencia(ausencia: Ausencia, dia: string): Trecho | null {
  if (!ehAtiva(ausencia)) return null
  if (ausencia.modalidade === 'horario') {
    if (ausencia.dia_inicio !== dia) return null
    const inicio = ausencia.hora_inicio === null ? null : minutosDaHora(ausencia.hora_inicio)
    const fim = ausencia.hora_fim === null ? null : minutosDaHora(ausencia.hora_fim)
    if (inicio === null || fim === null || fim <= inicio) return null
    return { inicio, fim }
  }
  if (dia < ausencia.dia_inicio || dia > ausencia.dia_fim) return null
  return { inicio: 0, fim: MINUTOS_NO_DIA }
}

/** Aplica a tolerância: diferença de até `tolerancia` no dia vira zero. */
export function aplicarTolerancia(saldoBruto: number, toleranciaMinutos: number): number {
  return Math.abs(saldoBruto) <= toleranciaMinutos ? 0 : saldoBruto
}

/** `-0` vira `0`: o `toEqual` do teste e o `formatar` da tela não precisam saber dele. */
function semZeroNegativo(valor: number): number {
  return valor === 0 ? 0 : valor
}

/**
 * O atraso de cada bloco, somado.
 *
 * `pares` são os trechos trabalhados (com o par aberto do dia incompleto indo
 * até o infinito: a entrada dele aconteceu, e é ela que diz se houve atraso).
 */
function calcularAtraso(blocos: readonly Trecho[], cobertura: readonly Trecho[], pares: readonly Trecho[]): number {
  let total = 0
  for (const bloco of blocos) {
    let esperada = bloco.inicio
    // `cobertura` é uma união (em ordem e sem cruzamento): uma passada basta,
    // e o `for` cobre também dois trechos encostados que a união já juntou.
    for (const trecho of cobertura) {
      if (trecho.inicio <= esperada && trecho.fim > esperada) esperada = trecho.fim
    }
    if (esperada >= bloco.fim) continue
    const par = pares.find((p) => p.fim > esperada && p.inicio < bloco.fim)
    if (!par) continue
    total += Math.max(0, par.inicio - esperada)
  }
  return total
}

/* ------------------------------------------------------------------ */
/* O dia                                                               */
/* ------------------------------------------------------------------ */

/**
 * O saldo de uma pessoa num dia.
 *
 * `batidasDoDia` são as batidas DESTE dia (`dia_civil`), de uma pessoa só;
 * `ausencias` podem ser todas as da pessoa: as canceladas e as de outros dias
 * ficam de fora aqui dentro. Quem filtra por pessoa é quem chama.
 */
export function calcularSaldoDoDia<T extends Batida>(
  dia: string,
  batidasDoDia: T[],
  ausencias: readonly Ausencia[],
  regras: RegrasDoSaldo,
): SaldoDoDia<T> {
  if (!ehDiaValido(dia)) throw new Error(`Dia inválido: "${dia}". O formato é AAAA-MM-DD.`)
  if (!ehDiaValido(regras.hoje)) throw new Error(`Hoje inválido: "${regras.hoje}". O formato é AAAA-MM-DD.`)

  const espelho = calcularDia(dia, batidasDoDia)
  const peloCalendario = estadoDoDia(dia, regras.cobrancaDesde, regras.hoje)
  const { motivoDeFora } = peloCalendario
  // O dia passado com batida faltando fica com o saldo suspenso (ver o cabeçalho).
  const estado: EstadoDoDia =
    peloCalendario.estado === 'cobranca' && espelho.incompleto ? 'pendente' : peloCalendario.estado
  const naCobranca = estado !== 'fora'
  // O abono vale em todo dia que já chegou, cobrado ou não (ver o cabeçalho).
  const comAbono = motivoDeFora !== 'futuro'

  // Feriado é dia sem jornada, como o fim de semana: nenhum bloco, nem para o abono.
  const feriado = (regras.feriadoDoDia ?? feriadoNacional)(dia)
  const jornada = jornadaAplicavel(regras.jornadaDaEmpresa, regras.jornadaPropria)
  const blocosDaJornada = feriado ? [] : trechosDoDiaDaSemana(jornada, diaDaSemanaIso(dia))
  const blocosPrevistos = naCobranca ? blocosDaJornada : []
  const previsto = medida(blocosPrevistos)

  // Os pares fechados, no relógio do fuso do ponto. O par aberto (a última
  // batida do dia ímpar) não é trabalho para o abono, porque não se sabe
  // quando acabou, mas a entrada dele vale para o atraso.
  const paresFechados: Trecho[] = espelho.blocos.map((bloco) => ({
    inicio: minutoDoDia(dia, bloco.inicio.registrado_em),
    fim: minutoDoDia(dia, bloco.fim.registrado_em),
  }))
  const pares = [...paresFechados]
  if (espelho.incompleto) {
    const aberta = espelho.batidas[espelho.batidas.length - 1]
    pares.push({ inicio: minutoDoDia(dia, aberta.registrado_em), fim: Number.POSITIVE_INFINITY })
  }
  pares.sort((a, b) => a.inicio - b.inicio)
  const trabalhados = unir(paresFechados)

  const coberturasBrutas = ausencias
    .map((ausencia) => ({ ausencia, trecho: trechoDaAusencia(ausencia, dia) }))
    .filter((item): item is { ausencia: Ausencia; trecho: Trecho } => item.trecho !== null)
    .sort(
      (a, b) =>
        a.trecho.inicio - b.trecho.inicio ||
        a.ausencia.lancado_em.localeCompare(b.ausencia.lancado_em) ||
        a.ausencia.id.localeCompare(b.ausencia.id),
    )

  /**
   * A parte da jornada coberta e não trabalhada:
   * |cobertura ∩ jornada| - |cobertura ∩ jornada ∩ trabalhado|.
   * A jornada é a do dia da semana mesmo fora da cobrança: o previsto não
   * aparece ali, mas o abono sim.
   */
  const abonoDe = (cobertura: Trecho[]): number => {
    const naJornada = intersecao(cobertura, blocosDaJornada)
    return medida(naJornada) - medida(intersecao(naJornada, trabalhados))
  }

  const coberturas: CoberturaDoDia[] = coberturasBrutas.map(({ ausencia, trecho }) => {
    const abona = ausenciaAbona(ausencia.tipo)
    return {
      ausencia,
      inicio: trecho.inicio,
      fim: trecho.fim,
      diaInteiro: ausencia.modalidade !== 'horario',
      abona,
      minutosAbonados: abona && comAbono ? Math.round(abonoDe([trecho])) : 0,
    }
  })

  const coberturaQueAbona = unir(coberturasBrutas.filter((c) => ausenciaAbona(c.ausencia.tipo)).map((c) => c.trecho))
  const abonado = comAbono ? Math.round(abonoDe(coberturaQueAbona)) : 0
  const trabalhado = espelho.minutos
  // No dia pendente o atraso também fica suspenso: a folha e o CSV não podem
  // mostrar um atraso que a tela não mostra, num dia que ainda vai mudar.
  const atraso =
    naCobranca && estado !== 'pendente' ? Math.round(calcularAtraso(blocosPrevistos, coberturaQueAbona, pares)) : 0

  const saldoBruto = naCobranca && estado !== 'pendente' ? trabalhado + abonado - previsto : 0
  const saldo = estado === 'cobranca' ? semZeroNegativo(aplicarTolerancia(saldoBruto, regras.toleranciaMinutos)) : 0

  return {
    dia,
    estado,
    motivoDeFora,
    espelho,
    blocosPrevistos,
    semJornada: naCobranca && blocosPrevistos.length === 0,
    feriado,
    previsto,
    trabalhado,
    abonado,
    saldoBruto,
    saldo,
    credito: Math.max(0, saldo),
    debito: semZeroNegativo(Math.max(0, -saldo)),
    atraso,
    temAtraso: atraso > regras.toleranciaMinutos,
    falta: estado === 'cobranca' && previsto > 0 && espelho.batidas.length === 0 && abonado < previsto,
    incompleto: espelho.incompleto,
    coberturas,
  }
}

/* ------------------------------------------------------------------ */
/* O mês                                                               */
/* ------------------------------------------------------------------ */

/**
 * Soma os dias de cobrança. Os de hoje e os de fora não entram; os pendentes
 * (passados, com batida faltando) também não, e são contados à parte.
 */
export function resumirSaldos(dias: readonly SaldoDoDia[]): ResumoDoSaldo {
  const resumo: ResumoDoSaldo = {
    previsto: 0,
    trabalhado: 0,
    abonado: 0,
    credito: 0,
    debito: 0,
    saldo: 0,
    faltas: 0,
    diasComAtraso: 0,
    diasDeCobranca: 0,
    diasComJornada: 0,
    diasIncompletos: 0,
  }
  for (const dia of dias) {
    if (dia.estado === 'pendente') resumo.diasIncompletos += 1
    if (dia.estado !== 'cobranca') continue
    resumo.previsto += dia.previsto
    resumo.trabalhado += dia.trabalhado
    resumo.abonado += dia.abonado
    resumo.credito += dia.credito
    resumo.debito += dia.debito
    resumo.faltas += dia.falta ? 1 : 0
    resumo.diasComAtraso += dia.temAtraso ? 1 : 0
    resumo.diasDeCobranca += 1
    resumo.diasComJornada += dia.semJornada ? 0 : 1
  }
  resumo.saldo = resumo.credito - resumo.debito
  return resumo
}

/**
 * Um recorte de dias (`inicio` a `fim`, inclusive) de uma pessoa: um
 * `SaldoDoDia` para cada dia do calendário (o dia sem batida também é
 * cobrado), e o resumo. Batidas de fora do recorte são ignoradas. É a conta
 * do painel da pessoa, que navega por período livre; o mês é este mesmo
 * recorte, do dia 1 ao último (`calcularSaldoDoMes`).
 */
export function calcularSaldoDoPeriodo<T extends Batida>(
  inicio: string,
  fim: string,
  batidas: readonly T[],
  ausencias: readonly Ausencia[],
  regras: RegrasDoSaldo,
): SaldoDoPeriodo<T> {
  const dias = diasDoPeriodo(inicio, fim)
  const porDia = new Map<string, T[]>()
  for (const batida of batidas) {
    const doDia = porDia.get(batida.dia_civil)
    if (doDia) doDia.push(batida)
    else porDia.set(batida.dia_civil, [batida])
  }
  const saldos = dias.map((dia) => calcularSaldoDoDia(dia, porDia.get(dia) ?? [], ausencias, regras))
  return { inicio, fim, dias: saldos, resumo: resumirSaldos(saldos) }
}

/**
 * O mês inteiro de uma pessoa (`calcularSaldoDoPeriodo` do dia 1 ao último).
 * O mês anterior não deixa saldo para este.
 */
export function calcularSaldoDoMes<T extends Batida>(
  mes: string,
  batidas: readonly T[],
  ausencias: readonly Ausencia[],
  regras: RegrasDoSaldo,
): SaldoDoMes<T> {
  const { dias, resumo } = calcularSaldoDoPeriodo(primeiroDiaDoMes(mes), ultimoDiaDoMes(mes), batidas, ausencias, regras)
  return {
    mes,
    dias,
    resumo,
    trabalhadoNoMes: dias.reduce((soma, dia) => soma + dia.trabalhado, 0),
  }
}

/**
 * As linhas do espelho do colaborador, com os dias de falta. A lista do
 * espelho tem só os dias com batida ou ausência (`juntarDiasEAusencias`), e o
 * resumo cobraria faltas em dias que a pessoa não vê. Aqui entra cada dia que
 * a conta marcou com `falta` e que a lista ainda não tem, vazio (`batidas:
 * null`, nenhuma ausência), em ordem de data. Nenhum critério novo: quem
 * decide o que é falta é `calcularSaldoDoDia` (hoje, futuro, sem jornada e
 * antes de `cobrancaDesde` nunca são). O dia de falta com ausência que não
 * cobre a jornada inteira já está na lista, pela ausência, e não se repete.
 */
export function juntarDiasDeFalta<D>(
  lista: readonly DiaComAusencia<D>[],
  saldos: readonly SaldoDoDia[],
): DiaComAusencia<D>[] {
  const listados = new Set(lista.map((linha) => linha.dia))
  const deFalta = saldos
    .filter((saldo) => saldo.falta && !listados.has(saldo.dia))
    .map((saldo): DiaComAusencia<D> => ({ dia: saldo.dia, batidas: null, ausencias: [] }))
  if (deFalta.length === 0) return [...lista]
  return [...lista, ...deFalta].sort((a, b) => a.dia.localeCompare(b.dia))
}

/* ------------------------------------------------------------------ */
/* As horas do dia: o trabalhado mais o abonado                        */
/* ------------------------------------------------------------------ */

/*
 * QUEM LANÇOU O ATESTADO ESPERA VÊ-LO SOMADO AO DIA. Por isso o número grande
 * do cartão do dia e o total do período são o trabalhado mais o abonado, e a
 * tela escreve a conta embaixo ("7h31 trabalhadas + 0h29 de atestado"), para
 * ninguém confundir abono com batida.
 *
 * O ABONO SEGUE A REGRA DE SEMPRE: só a parte do atestado dentro da jornada e
 * fora do tempo trabalhado. Com a jornada até as 17:00, saída às 16:31 e
 * atestado das 16:30 às 17:30, o minuto das 16:30 já está no trabalhado e não
 * conta duas vezes: o abono vai das 16:31 às 17:00.
 */

/** O que estas contas precisam de um dia: qualquer `SaldoDoDia` serve. */
type HorasDeUmDia = Pick<SaldoDoDia, 'trabalhado' | 'abonado' | 'incompleto'>

/**
 * As horas que o dia soma no total: o trabalhado mais o abonado. O dia
 * incompleto (número ímpar de batidas) soma zero, como já somava o trabalhado
 * dele: ele está "fora do total" até alguém corrigir a batida.
 */
export function horasDoDia(dia: HorasDeUmDia): number {
  return dia.incompleto ? 0 : dia.trabalhado + dia.abonado
}

/**
 * O abonado que entra no total de um recorte (o mês do espelho, o período do
 * painel): a soma do abonado dos dias que entram no total. Somado ao total de
 * `resumirDias` (que já deixa o dia incompleto de fora), dá a soma de
 * `horasDoDia` de cada dia.
 */
export function abonadoNoTotal(dias: readonly HorasDeUmDia[]): number {
  return dias.reduce((soma, dia) => soma + (dia.incompleto ? 0 : dia.abonado), 0)
}

/**
 * De onde veio o abono, para a frase da tela: "de atestado" quando todo ele
 * veio de atestado médico, "de falta justificada" quando todo veio de falta
 * justificada, e "abonadas" quando veio dos dois (ou de nada).
 */
export function rotuloDoAbono(dias: readonly Pick<SaldoDoDia, 'coberturas' | 'incompleto'>[]): string {
  const tipos = new Set<TipoDeAusencia>()
  for (const dia of dias) {
    if (dia.incompleto) continue
    for (const cobertura of dia.coberturas) {
      if (cobertura.minutosAbonados > 0) tipos.add(cobertura.ausencia.tipo)
    }
  }
  if (tipos.size !== 1) return 'abonadas'
  return tipos.has('atestado_medico') ? 'de atestado' : 'de falta justificada'
}

/* ------------------------------------------------------------------ */
/* O texto do saldo                                                    */
/* ------------------------------------------------------------------ */

/** O sinal de menos tipográfico (U+2212), o mesmo das contas. */
const MENOS = '−'

/**
 * O saldo com sinal, no formato de duração do espelho (`formatarDuracao`):
 * 0 -> "0h00", 90 -> "+1h30", -30 -> "0h30" com `MENOS` na frente. O sinal de
 * menos é o U+2212, o mesmo das contas, para não ser lido como hífen.
 */
export function formatarSaldo(minutos: number): string {
  const redondo = Math.round(minutos)
  if (redondo === 0) return formatarDuracao(0)
  return `${redondo > 0 ? '+' : MENOS}${formatarDuracao(Math.abs(redondo))}`
}
