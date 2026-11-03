/*
 * A JORNADA PREVISTA: o que cada pessoa deve trabalhar em cada dia da semana,
 * sem rede, sem React e sem relógio. O banco guarda a jornada em
 * `ponto_configuracao.jornada` e `ponto_funcionarios.jornada` (em
 * `supabase/migrations/`, na migration da jornada e do saldo).
 *
 * O QUE É: uma lista de blocos `{ dia, inicio, fim }`, com `dia` no padrão
 * `isodow` do Postgres (1 = segunda ... 7 = domingo) e os horários `HH:MM` no
 * relógio de Brasília (o mesmo do `dia_civil` das batidas). Até dois blocos
 * por dia, sem se cruzar (encostar pode: 08:00-12:00 e 12:00-17:00), e cada
 * dia com jornada somando de 60 a 720 min. Dia que não aparece na lista é dia
 * sem jornada (sábado e domingo na semente).
 *
 * DE QUEM É: a da empresa mora em `ponto_configuracao.jornada` (nunca nula); a
 * própria, opcional, em `ponto_funcionarios.jornada`, e NULA quer dizer "segue
 * a da empresa". Quem decide qual vale num dia é `jornadaAplicavel`.
 *
 * QUEM DECIDE É O BANCO. `problemaDaJornada` é o ESPELHO de
 * `ponto_jornada_problema`, na MESMA ordem de conferência (a primeira coisa
 * errada é a que sai), para a tela recusar antes de gravar e para a leitura
 * não aceitar calada um jsonb torto. As frases são as do banco, com acento.
 * Se as duas divergirem, quem manda é o banco, e a divergência é defeito
 * daqui.
 *
 * POR QUE UM MÓDULO SÓ PARA ISTO: a conta do saldo (`saldo.ts`), a tela da
 * jornada e a folha leem a mesma jornada. Se cada uma lesse o jsonb do seu
 * jeito, a primeira que esquecesse de ordenar os blocos mostraria um previsto
 * diferente das outras.
 */

/* ------------------------------------------------------------------ */
/* A jornada, como o banco a guarda                                    */
/* ------------------------------------------------------------------ */

/** `isodow`: 1 = segunda ... 7 = domingo. */
export type DiaDaSemanaIso = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Um bloco da jornada, exatamente como mora no jsonb. */
export interface BlocoDaJornada {
  dia: DiaDaSemanaIso
  /** `HH:MM`, relógio de Brasília. */
  inicio: string
  /** `HH:MM`, depois do início, no mesmo dia. */
  fim: string
}

export type Jornada = BlocoDaJornada[]

/** Um trecho do dia em minutos desde a meia-noite de Brasília: `[inicio, fim)`. */
export interface Trecho {
  inicio: number
  fim: number
}

/** Os mesmos nomes que as frases do banco usam (`c_dias`), com acento. */
export const NOME_DO_DIA_DA_SEMANA: Record<DiaDaSemanaIso, string> = {
  1: 'segunda',
  2: 'terça',
  3: 'quarta',
  4: 'quinta',
  5: 'sexta',
  6: 'sábado',
  7: 'domingo',
}

/** As faixas do banco (as mesmas da carga diária, `ponto_configuracao_carga_diaria_razoavel`). */
export const TOTAL_MINIMO_DO_DIA = 60
export const TOTAL_MAXIMO_DO_DIA = 720
export const BLOCOS_POR_DIA_NO_MAXIMO = 2

/** A semente do banco: segunda a sexta, 08:00-12:00 e 13:00-17:00. */
export const JORNADA_SEMENTE: Jornada = ([1, 2, 3, 4, 5] as const).flatMap((dia) => [
  { dia, inicio: '08:00', fim: '12:00' },
  { dia, inicio: '13:00', fim: '17:00' },
])

/* ------------------------------------------------------------------ */
/* Horários                                                            */
/* ------------------------------------------------------------------ */

/** O formato da jornada: `HH:MM`, de 00:00 a 23:59 (o `c_hora` do banco). */
const FORMATO_DA_HORA_DA_JORNADA = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * O formato de uma coluna `time` como o PostgREST a devolve (`14:00:00`) ou
 * como a tela a digita (`14:00`). Fração de segundo também passa, por
 * garantia: o banco recusa segundos diferentes de zero, mas a leitura não
 * precisa quebrar por causa disso.
 */
const FORMATO_DA_HORA_COM_SEGUNDOS = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/

/** `"14:00"` -> 840. `null` para o que não é hora da jornada. */
export function minutosDaHoraDaJornada(hora: string): number | null {
  const casou = FORMATO_DA_HORA_DA_JORNADA.exec(hora)
  if (!casou) return null
  return Number(casou[1]) * 60 + Number(casou[2])
}

/**
 * `"14:00:00"` ou `"14:00"` -> 840; `"14:00:30"` -> 840,5. `null` para o que
 * não é hora. É a leitura de `hora_inicio` e `hora_fim` da ausência por horário.
 */
export function minutosDaHora(hora: string): number | null {
  const casou = FORMATO_DA_HORA_COM_SEGUNDOS.exec(hora)
  if (!casou) return null
  return Number(casou[1]) * 60 + Number(casou[2]) + (casou[3] ? Number(casou[3]) / 60 : 0)
}

/** 840 -> `"14:00"`. Para os rótulos; arredonda para o minuto. */
export function horaDosMinutos(minutos: number): string {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutos)))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* O espelho de `ponto_jornada_problema`                               */
/* ------------------------------------------------------------------ */

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Como o `format('%s', v_bloco -> 'dia')` do banco escreve um valor jsonb. */
function comoJson(valor: unknown): string {
  return JSON.stringify(valor) ?? 'null'
}

/**
 * A primeira coisa errada da jornada, numa frase, ou `null` quando ela vale.
 *
 * A ORDEM É A DO BANCO: primeiro a lista (nula, não lista, vazia); depois cada
 * bloco sozinho, na ordem da lista (chaves, dia, formato dos horários, fim
 * depois do início); por fim cada dia da semana, de segunda a domingo
 * (quantidade de blocos, cruzamento, total). É isso que faz a tela e o banco
 * apontarem o MESMO defeito quando há mais de um.
 *
 * A LISTA VAZIA É RECUSADA DE PROPÓSITO (como no banco): "seguir a da empresa"
 * é a jornada própria NULA; `[]` seria um terceiro estado, "não trabalha
 * nunca", que ninguém pediu.
 */
export function problemaDaJornada(valor: unknown): string | null {
  if (valor === null || valor === undefined) return 'Jornada inválida: a jornada está vazia.'
  if (!Array.isArray(valor)) {
    return 'Jornada inválida: a jornada é uma lista de blocos, como [{"dia": 1, "inicio": "08:00", "fim": "12:00"}].'
  }
  if (valor.length === 0) {
    return 'Jornada inválida: nenhum bloco. Para seguir a jornada da empresa, deixe a jornada própria vazia (nula).'
  }

  const lidos: { dia: DiaDaSemanaIso; inicio: string; fim: string; ini: number; fimMin: number }[] = []
  for (const bloco of valor) {
    if (!ehObjeto(bloco)) return 'Jornada inválida: cada bloco tem dia, início e fim, e nada mais.'
    const chaves = Object.keys(bloco).sort()
    if (chaves.length !== 3 || chaves[0] !== 'dia' || chaves[1] !== 'fim' || chaves[2] !== 'inicio') {
      return 'Jornada inválida: cada bloco tem dia, início e fim, e nada mais.'
    }
    const dia = bloco.dia
    if (typeof dia !== 'number' || !Number.isInteger(dia) || dia < 1 || dia > 7) {
      return `Jornada inválida: o dia da semana ${comoJson(dia)} não existe (1 = segunda a 7 = domingo).`
    }
    const diaIso = dia as DiaDaSemanaIso
    const { inicio, fim } = bloco
    const ini = typeof inicio === 'string' ? minutosDaHoraDaJornada(inicio) : null
    const fimMin = typeof fim === 'string' ? minutosDaHoraDaJornada(fim) : null
    if (ini === null || fimMin === null) {
      return `Jornada inválida: no dia ${diaIso} (${NOME_DO_DIA_DA_SEMANA[diaIso]}), o horário ${comoJson(inicio)} a ${comoJson(fim)} não está no formato HH:MM (de 00:00 a 23:59).`
    }
    if (fimMin <= ini) {
      return `Jornada inválida: no dia ${diaIso} (${NOME_DO_DIA_DA_SEMANA[diaIso]}), o bloco ${inicio as string}-${fim as string} não termina depois de começar (o fim precisa ser depois do início).`
    }
    lidos.push({ dia: diaIso, inicio: inicio as string, fim: fim as string, ini, fimMin })
  }

  for (const dia of [1, 2, 3, 4, 5, 6, 7] as const) {
    const doDia = lidos
      .filter((bloco) => bloco.dia === dia)
      .sort((a, b) => a.ini - b.ini || a.fimMin - b.fimMin)
    if (doDia.length === 0) continue
    const nome = NOME_DO_DIA_DA_SEMANA[dia]
    if (doDia.length > BLOCOS_POR_DIA_NO_MAXIMO) {
      return `Jornada inválida: no dia ${dia} (${nome}) há ${doDia.length} blocos (no máximo dois por dia).`
    }
    if (doDia.length === 2 && doDia[1].ini < doDia[0].fimMin) {
      const [a, b] = doDia
      return `Jornada inválida: no dia ${dia} (${nome}), os blocos ${a.inicio}-${a.fim} e ${b.inicio}-${b.fim} se cruzam (encostar pode, como 08:00-12:00 e 12:00-17:00).`
    }
    const total = doDia.reduce((soma, bloco) => soma + (bloco.fimMin - bloco.ini), 0)
    if (total < TOTAL_MINIMO_DO_DIA || total > TOTAL_MAXIMO_DO_DIA) {
      return `Jornada inválida: o dia ${dia} (${nome}) soma ${total} min; um dia com jornada soma de 60 a 720 min (de 1 h a 12 h).`
    }
  }

  return null
}

/**
 * O jsonb lido do banco, conferido e em ordem (dia, depois início).
 *
 * LEVANTA para jornada inválida, com a frase de `problemaDaJornada`: o banco
 * não deixa uma dessas existir, então chegar aqui torto é defeito de leitura,
 * e calcular saldo em cima dele seria cobrar alguém por uma jornada inventada.
 * Devolve cópias limpas (só as três chaves), nunca o objeto que veio.
 */
export function lerJornada(valor: unknown): Jornada {
  const problema = problemaDaJornada(valor)
  if (problema) throw new Error(problema)
  return (valor as BlocoDaJornada[])
    .map(({ dia, inicio, fim }) => ({ dia, inicio, fim }))
    .sort((a, b) => a.dia - b.dia || a.inicio.localeCompare(b.inicio))
}

/**
 * A jornada própria da ficha: nula (ou ausente na leitura) = segue a da empresa.
 *
 * A LISTA VAZIA TAMBÉM VALE COMO "SEGUE A DA EMPRESA", e só aqui, na leitura.
 * O banco e a tela recusam `[]` ao gravar (`problemaDaJornada`), mas se um
 * dia ela chegar, tratá-la como "não trabalha nunca" zeraria o previsto da
 * pessoa calado; levantar derrubaria a ficha inteira por um estado que só tem
 * um sentido razoável.
 */
export function lerJornadaPropria(valor: unknown): Jornada | null {
  if (valor === null || valor === undefined) return null
  if (Array.isArray(valor) && valor.length === 0) return null
  return lerJornada(valor)
}

/* ------------------------------------------------------------------ */
/* A jornada de um dia                                                 */
/* ------------------------------------------------------------------ */

/**
 * A própria, quando a ficha tem uma; senão, a da empresa. Vale em todos os dias.
 * A própria vazia (`[]`) conta como "sem própria", como em `lerJornadaPropria`.
 */
export function jornadaAplicavel(daEmpresa: Jornada, propria: Jornada | null | undefined): Jornada {
  return propria && propria.length > 0 ? propria : daEmpresa
}

const FORMATO_DO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `2026-10-26` -> 1 (segunda). Conta de CALENDÁRIO, em UTC: o dia civil não tem
 * fuso, e `new Date('2026-10-26').getDay()` num aparelho em fuso negativo
 * devolveria domingo.
 */
export function diaDaSemanaIso(dia: string): DiaDaSemanaIso {
  const casou = FORMATO_DO_DIA.exec(dia)
  if (!casou) throw new Error(`Dia inválido: "${dia}". O formato é AAAA-MM-DD.`)
  const ms = Date.UTC(Number(casou[1]), Number(casou[2]) - 1, Number(casou[3]))
  if (new Date(ms).toISOString().slice(0, 10) !== dia) {
    throw new Error(`Dia inválido: "${dia}" não existe no calendário.`)
  }
  const domingoZero = new Date(ms).getUTCDay()
  return (domingoZero === 0 ? 7 : domingoZero) as DiaDaSemanaIso
}

/** Os blocos de um dia da semana, em minutos, em ordem. Vazio = sem jornada. */
export function trechosDoDiaDaSemana(jornada: Jornada, diaDaSemana: DiaDaSemanaIso): Trecho[] {
  return jornada
    .filter((bloco) => bloco.dia === diaDaSemana)
    .map((bloco) => ({
      inicio: minutosDaHoraDaJornada(bloco.inicio) ?? 0,
      fim: minutosDaHoraDaJornada(bloco.fim) ?? 0,
    }))
    .filter((trecho) => trecho.fim > trecho.inicio)
    .sort((a, b) => a.inicio - b.inicio || a.fim - b.fim)
}

/** Os blocos previstos para uma data (`AAAA-MM-DD`). */
export function trechosDoDia(jornada: Jornada, dia: string): Trecho[] {
  return trechosDoDiaDaSemana(jornada, diaDaSemanaIso(dia))
}

/** Minutos previstos num dia da semana: a soma dos blocos (0 sem jornada). */
export function totalDoDiaDaSemana(jornada: Jornada, diaDaSemana: DiaDaSemanaIso): number {
  return trechosDoDiaDaSemana(jornada, diaDaSemana).reduce(
    (soma, trecho) => soma + (trecho.fim - trecho.inicio),
    0,
  )
}

/**
 * O espelho de `ponto_jornada_carga_de_referencia`: o MAIOR total entre os dias
 * com jornada (480 na semente). É o número que o banco grava em
 * `carga_diaria_minutos`; o saldo NÃO o usa: usa os blocos de cada dia.
 */
export function cargaDeReferencia(jornada: Jornada): number {
  return Math.max(0, ...([1, 2, 3, 4, 5, 6, 7] as const).map((dia) => totalDoDiaDaSemana(jornada, dia)))
}
