/*
 * O FORMULÁRIO DA SEMANA: a jornada como a tela a edita, sete dias, cada um
 * com zero, um ou dois blocos de início e fim.
 *
 * SERVE ÀS DUAS TELAS: a jornada da empresa (configuração do ponto, em
 * `configuracao.ts`) e a jornada própria da ficha (`cadastro.ts`). As duas
 * gravam o mesmo jsonb e esbarram na mesma regra do banco, então leem o
 * formulário pela mesma função.
 *
 * O MESMO DESENHO DE `configuracao.ts`: o rascunho é texto, como sai de um
 * `<input type="time">`; a leitura devolve `{ ok, valor }` ou `{ ok: false,
 * erros }`, sem exceção. Nada de React, Supabase ou relógio.
 *
 * QUEM DECIDE É O BANCO (`ponto_jornada_problema`). A leitura daqui confere o
 * que é da tela (campo em branco, horário que não é horário) e, para o resto,
 * pergunta a `problemaDaJornada`, que é o espelho do banco com as MESMAS
 * frases, com acento. Assim a tela recusa antes da viagem com a frase que o
 * banco daria, e nunca com uma regra mais apertada que a dele.
 */
import type { Leitura } from './configuracao'
import {
  BLOCOS_POR_DIA_NO_MAXIMO,
  NOME_DO_DIA_DA_SEMANA,
  TOTAL_MAXIMO_DO_DIA,
  TOTAL_MINIMO_DO_DIA,
  minutosDaHoraDaJornada,
  problemaDaJornada,
  type BlocoDaJornada,
  type DiaDaSemanaIso,
  type Jornada,
} from './jornada'

/* ------------------------------------------------------------------ */
/* O rascunho                                                          */
/* ------------------------------------------------------------------ */

/** Segunda a domingo, na ordem do `isodow`. */
export const DIAS_DA_SEMANA: readonly DiaDaSemanaIso[] = [1, 2, 3, 4, 5, 6, 7]

/** Um bloco como a tela o guarda: os dois textos dos campos de horário. */
export interface RascunhoDoBloco {
  inicio: string
  fim: string
}

/** Os blocos de cada dia. Dia sem bloco = dia sem jornada. */
export type RascunhoDaSemana = Record<DiaDaSemanaIso, RascunhoDoBloco[]>

export function semanaVazia(): RascunhoDaSemana {
  return { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
}

/** A jornada gravada vira rascunho, em ordem de início. Nula = semana vazia. */
export function rascunhoDaSemana(jornada: Jornada | null | undefined): RascunhoDaSemana {
  const semana = semanaVazia()
  for (const bloco of [...(jornada ?? [])].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    if (semana[bloco.dia]) semana[bloco.dia].push({ inicio: bloco.inicio, fim: bloco.fim })
  }
  return semana
}

/** `true` quando nenhum dia tem bloco. */
export function semanaEstaVazia(semana: RascunhoDaSemana): boolean {
  return DIAS_DA_SEMANA.every((dia) => semana[dia].length === 0)
}

/* ------------------------------------------------------------------ */
/* As mudanças do formulário                                           */
/* ------------------------------------------------------------------ */

/**
 * O bloco que entra quando se aperta "acrescentar". O primeiro do dia é a
 * manhã da semente (08:00-12:00) e o segundo, a tarde (13:00-17:00): é o
 * caso comum, e quem tem outro horário troca dois campos em vez de quatro.
 */
const BLOCO_NOVO: readonly RascunhoDoBloco[] = [
  { inicio: '08:00', fim: '12:00' },
  { inicio: '13:00', fim: '17:00' },
]

export function podeAcrescentarBloco(semana: RascunhoDaSemana, dia: DiaDaSemanaIso): boolean {
  return semana[dia].length < BLOCOS_POR_DIA_NO_MAXIMO
}

/** Acrescenta um bloco ao dia. No terceiro, devolve a semana como estava. */
export function acrescentarBloco(semana: RascunhoDaSemana, dia: DiaDaSemanaIso): RascunhoDaSemana {
  if (!podeAcrescentarBloco(semana, dia)) return semana
  const novo = BLOCO_NOVO[semana[dia].length] ?? BLOCO_NOVO[0]
  return { ...semana, [dia]: [...semana[dia], { ...novo }] }
}

export function tirarBloco(semana: RascunhoDaSemana, dia: DiaDaSemanaIso, indice: number): RascunhoDaSemana {
  return { ...semana, [dia]: semana[dia].filter((_, i) => i !== indice) }
}

export function mudarBloco(
  semana: RascunhoDaSemana,
  dia: DiaDaSemanaIso,
  indice: number,
  campo: keyof RascunhoDoBloco,
  valor: string,
): RascunhoDaSemana {
  return {
    ...semana,
    [dia]: semana[dia].map((bloco, i) => (i === indice ? { ...bloco, [campo]: valor } : bloco)),
  }
}

/* ------------------------------------------------------------------ */
/* Os totais, na hora                                                  */
/* ------------------------------------------------------------------ */

/**
 * `"08:00"` ou `"08:00:00"` (o `<input type="time">` pode mandar os segundos)
 * -> `"08:00"`. `null` para o que não é horário da jornada, inclusive segundos
 * diferentes de zero, que o banco não guarda.
 */
export function horaDoCampo(texto: string): string | null {
  const limpo = texto.trim()
  const semSegundos = /^\d{2}:\d{2}:00$/.test(limpo) ? limpo.slice(0, 5) : limpo
  return minutosDaHoraDaJornada(semSegundos) === null ? null : semSegundos
}

/**
 * O total do dia, em minutos, enquanto a pessoa digita. `0` no dia sem bloco;
 * `null` quando algum bloco está em branco, torto ou termina antes de começar:
 * a tela mostra "confira os horários" em vez de um total que não existe.
 */
export function totalDoDiaNoRascunho(blocos: readonly RascunhoDoBloco[]): number | null {
  let total = 0
  for (const bloco of blocos) {
    const inicio = horaDoCampo(bloco.inicio)
    const fim = horaDoCampo(bloco.fim)
    if (inicio === null || fim === null) return null
    const minutos = (minutosDaHoraDaJornada(fim) as number) - (minutosDaHoraDaJornada(inicio) as number)
    if (minutos <= 0) return null
    total += minutos
  }
  return total
}

/** A soma dos dias. `null` se algum dia ainda não tem total. */
export function totalDaSemanaNoRascunho(semana: RascunhoDaSemana): number | null {
  let total = 0
  for (const dia of DIAS_DA_SEMANA) {
    const doDia = totalDoDiaNoRascunho(semana[dia])
    if (doDia === null) return null
    total += doDia
  }
  return total
}

/** O total do dia está fora da faixa do banco (de 1 h a 12 h)? Só para o aviso da tela. */
export function totalForaDaFaixa(minutos: number): boolean {
  return minutos > 0 && (minutos < TOTAL_MINIMO_DO_DIA || minutos > TOTAL_MAXIMO_DO_DIA)
}

/* ------------------------------------------------------------------ */
/* A leitura                                                           */
/* ------------------------------------------------------------------ */

/** `"segunda"` -> `"Segunda"`, para o começo de frase e o título do dia. */
export function nomeDoDia(dia: DiaDaSemanaIso): string {
  const nome = NOME_DO_DIA_DA_SEMANA[dia]
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

/** "primeiro" e "segundo" bloco; acima disso (que a tela não deixa), o número. */
export function ordinalDoBloco(indice: number): string {
  return ['primeiro', 'segundo'][indice] ?? `${indice + 1}º`
}

/**
 * Lê a semana e devolve a jornada pronta para o jsonb, em ordem de dia e de
 * início, ou TODAS as frases do que está errado, dia a dia.
 *
 * DUAS CAMADAS, NESTA ORDEM, POR DIA:
 *   1. o que é da tela: início ou fim em branco, horário fora de HH:MM;
 *   2. o resto, pela regra do banco (`problemaDaJornada` só com os blocos
 *      daquele dia): fim antes do início, mais de dois blocos, blocos que se
 *      cruzam, total fora de 1 h a 12 h. A frase é a do banco, com acento.
 *
 * CONFERIR DIA A DIA DÁ AS MESMAS FRASES QUE O BANCO, SÓ QUE TODAS: o banco
 * para na primeira coisa errada da lista inteira, e essa primeira é sempre a
 * primeira de algum dia. Quem errou segunda e quarta vê as duas de uma vez.
 *
 * `seVazia` é a frase para a semana sem nenhum bloco. Ela depende de quem
 * chama: a empresa precisa de pelo menos um dia; a ficha tem "usar a da
 * empresa" para isso, e a lista vazia o banco recusa de propósito.
 */
export function lerSemana(semana: RascunhoDaSemana, seVazia: string): Leitura<Jornada> {
  const erros: string[] = []
  const jornada: BlocoDaJornada[] = []

  for (const dia of DIAS_DA_SEMANA) {
    const doDia: BlocoDaJornada[] = []
    const errosDoDia: string[] = []
    semana[dia].forEach((bloco, indice) => {
      const quem = `${nomeDoDia(dia)}, ${ordinalDoBloco(indice)} bloco`
      if (bloco.inicio.trim() === '' || bloco.fim.trim() === '') {
        errosDoDia.push(`${quem}: preencha o início e o fim.`)
        return
      }
      const inicio = horaDoCampo(bloco.inicio)
      const fim = horaDoCampo(bloco.fim)
      if (inicio === null || fim === null) {
        errosDoDia.push(`${quem}: escreva o horário como HH:MM, de 00:00 a 23:59.`)
        return
      }
      doDia.push({ dia, inicio, fim })
    })

    if (errosDoDia.length > 0) {
      erros.push(...errosDoDia)
      continue
    }
    if (doDia.length > 0) {
      const problema = problemaDaJornada(doDia)
      if (problema) erros.push(problema)
    }
    jornada.push(...doDia)
  }

  if (erros.length > 0) return { ok: false, erros }
  if (jornada.length === 0) return { ok: false, erros: [seVazia] }

  // A rede: a lista inteira passa pela mesma regra que o banco vai aplicar.
  // Dia a dia já cobre tudo; se um dia não cobrir, a frase do banco aparece.
  const daLista = problemaDaJornada(jornada)
  if (daLista) return { ok: false, erros: [daLista] }

  return {
    ok: true,
    valor: jornada.sort((a, b) => a.dia - b.dia || a.inicio.localeCompare(b.inicio)),
  }
}

/* ------------------------------------------------------------------ */
/* Para ler                                                            */
/* ------------------------------------------------------------------ */

/**
 * `"08:00-12:00 e 13:00-17:00"`; vazio quando o dia não tem jornada. O hífen
 * entre o início e o fim é o mesmo das frases do banco.
 */
export function horariosDoDia(jornada: Jornada, dia: DiaDaSemanaIso): string {
  return jornada
    .filter((bloco) => bloco.dia === dia)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .map((bloco) => `${bloco.inicio}-${bloco.fim}`)
    .join(' e ')
}

/* ------------------------------------------------------------------ */
/* A frase do banco, com acento                                        */
/* ------------------------------------------------------------------ */

/**
 * As palavras que o banco escreve sem acento nas frases que começam por
 * "Jornada invalida:" (`ponto_jornada_problema`), e como `problemaDaJornada`
 * as escreve. Só palavras inteiras, e nunca dentro de aspas: o exemplo
 * `{"dia": 1, "inicio": ...}` é o nome da chave do jsonb e fica como está.
 */
const ACENTOS_DA_JORNADA: readonly [RegExp, string][] = [
  [/\bJornada invalida\b/g, 'Jornada inválida'],
  [/\besta vazia\b/g, 'está vazia'],
  [/\ba jornada e uma lista\b/g, 'a jornada é uma lista'],
  [/\bpropria\b/g, 'própria'],
  [/(?<!")\binicio\b(?!")/g, 'início'],
  [/\bhorario\b/g, 'horário'],
  [/\bnao\b/g, 'não'],
  [/\besta no formato\b/g, 'está no formato'],
  [/\bcomecar\b/g, 'começar'],
  [/\(terca\)/g, '(terça)'],
  [/\(sabado\)/g, '(sábado)'],
  [/\bha (\d+) blocos\b/g, 'há $1 blocos'],
  [/\bmaximo\b/g, 'máximo'],
]

/**
 * A recusa de jornada do banco (código 23514, frase "Jornada invalida: ...")
 * na mesma forma que a tela mostra quando recusa antes de gravar. `null` para
 * qualquer outra mensagem.
 *
 * É A RESERVA: a tela já confere com `problemaDaJornada` antes de mandar, e
 * esta tradução só aparece quando o banco discorda (outra aba, regra que mudou
 * no banco e ainda não aqui). Ela recorta a partir de "Jornada invalida", para
 * o que vier antes (um prefixo do PostgREST) não chegar à tela.
 */
export function traduzirRecusaDaJornada(mensagem: string): string | null {
  const onde = mensagem.search(/Jornada inv[aá]lida:/)
  if (onde < 0) return null
  return ACENTOS_DA_JORNADA.reduce(
    (frase, [padrao, troca]) => frase.replace(padrao, troca),
    mensagem.slice(onde).trim(),
  )
}
