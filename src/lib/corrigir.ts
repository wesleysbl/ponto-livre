/*
 * CORRIGIR QUALQUER DIA — as regras da tela da pessoa e da caixa de batida,
 * sem React e sem rede.
 *
 * O CASO QUE ESTE MÓDULO EXISTE PARA RESOLVER
 * O RH precisa lançar o sábado em que alguém trabalhou e esqueceu de bater. Se
 * a tela da pessoa listasse só dias COM batida ou ausência, o sábado vazio não
 * teria linha, e por isso não teria botão; o único caminho seria o botão do
 * topo, que abre no último dia com batida — e ninguém adivinha que dá para
 * trocar a data ali dentro. Por isso a lista tem todos os dias do período até
 * hoje, e cada um tem o seu "Inserir batida neste dia".
 *
 * A CONTA NÃO MUDA. `listarDiasDoPeriodo` só decide QUE LINHAS a tela mostra.
 * O total, os dias com batida e os incompletos continuam saindo de
 * `resumirDias(agruparPorDia(batidas))`, como no espelho do funcionário: se o
 * resumo lesse esta lista, o topo diria "31 dias com batida" num mês em que a
 * pessoa bateu em dois. Os dias com batida entram aqui INTACTOS (mesmo objeto,
 * mesmos minutos), e os vazios não têm minuto nenhum para somar.
 *
 * O FUSO É O DO PONTO (`FUSO`, em `formato.ts`). "Hoje" e "agora" são os
 * desse fuso, nunca os do aparelho — a mesma regra de `atraso.ts` e de
 * `momentoNoFusoDoLocal`.
 */
import {
  diaCivilDoInstante,
  formatarHora,
  momentoNoFusoDoLocal,
} from './formato'
import { diasDoPeriodo, juntarDiasEAusencias, type Ausencia, type DiaComAusencia } from './ausencias'
import { feriadoNacional } from './feriados'
import { ehDiaValido } from './horas'
import type { Periodo } from './periodo'

/* ------------------------------------------------------------------ */
/* A lista de dias da tela da pessoa                                   */
/* ------------------------------------------------------------------ */

/**
 * Até quantos dias de período a tela lista dia a dia. Dois meses de 31 dias
 * (julho e agosto) cabem; um período maior — "o ano inteiro", colado de um
 * link — viraria centenas de linhas vazias, e aí a tela mostra só os dias com
 * batida ou ausência.
 */
export const TETO_DE_DIAS_NA_LISTA = 62

/** Um dia da lista: o de `juntarDiasEAusencias`, mais o que a tela precisa saber da data. */
export interface DiaDaLista<D> extends DiaComAusencia<D> {
  /** Sábado ou domingo. A tela sinaliza: um sábado com batida é o que o RH vai procurar. */
  fimDeSemana: boolean
  /**
   * O nome do feriado nacional (`feriados.ts`), ou `null`. A tela põe a
   * etiqueta "feriado", como a do fim de semana: sem ela, o feriado numa
   * segunda-feira parecia um dia útil sem batida.
   */
  feriado: string | null
  /**
   * Depois de hoje. Só aparece com conteúdo (a ausência lançada adiante, ou uma
   * batida com horário no futuro, que precisa ser corrigida), e nunca com o
   * botão de inserir — o formulário recusaria qualquer horário nele.
   */
  futuro: boolean
}

export interface ListaDeDias<D> {
  dias: DiaDaLista<D>[]
  /**
   * `true` quando a lista tem todos os dias do início do período até o fim
   * dele ou até hoje; `false` quando o período passou do teto e a lista tem só
   * os dias com conteúdo (a tela diz isso, para ninguém achar que os outros
   * dias sumiram).
   */
  todosOsDias: boolean
}

/** Sábado ou domingo, pela data — sem fuso, porque um dia civil não tem fuso. */
export function ehFimDeSemana(dia: string): boolean {
  if (!ehDiaValido(dia)) return false
  const [ano, mes, numero] = dia.split('-').map(Number)
  const semana = new Date(Date.UTC(ano, mes - 1, numero)).getUTCDay()
  return semana === 0 || semana === 6
}

/**
 * O id do dia na página: `dia-2026-10-17`. É a âncora que a tela usa para abrir
 * o mês corrente rolado em hoje, e a que os links que levam direto a um dia
 * usam.
 */
export function ancoraDoDia(dia: string): string {
  return `dia-${dia}`
}

/**
 * As linhas da tela da pessoa.
 *
 * AS REGRAS, NESTA ORDEM
 *  1. Período com mais de `TETO_DE_DIAS_NA_LISTA` dias: só os dias com batida
 *     ou ausência.
 *  2. Senão, todos os dias do início do período até o fim dele ou até hoje, o
 *     que vier primeiro. Dia futuro vazio não aparece: no mês corrente, a lista
 *     termina hoje.
 *  3. Dia futuro COM conteúdo continua aparecendo. Esconder uma ausência
 *     lançada para a semana que vem, ou uma batida com horário no futuro (que
 *     precisa ser corrigida), seria apagar da tela algo que existe.
 *
 * Os dias com batida vêm de `agruparPorDia` e as ausências de `ausenciasPorDia`
 * (as ativas, já recortadas ao período); a costura é a de
 * `juntarDiasEAusencias`, a mesma do espelho.
 */
export function listarDiasDoPeriodo<D extends { dia: string }>(entrada: {
  periodo: Periodo
  dias: readonly D[]
  ausenciasPorDia: ReadonlyMap<string, Ausencia[]>
  /** O dia civil de hoje no fuso do ponto (`diaCivilDeHoje`), injetado para o teste não depender do relógio. */
  hoje: string
}): ListaDeDias<D> {
  const { periodo, dias, ausenciasPorDia, hoje } = entrada
  const comConteudo = juntarDiasEAusencias(dias, ausenciasPorDia)
  const marcar = (dia: DiaComAusencia<D>): DiaDaLista<D> => ({
    ...dia,
    fimDeSemana: ehFimDeSemana(dia.dia),
    feriado: feriadoNacional(dia.dia),
    futuro: dia.dia > hoje,
  })

  if (diasDoPeriodo(periodo.inicio, periodo.fim).length > TETO_DE_DIAS_NA_LISTA) {
    return { dias: comConteudo.map(marcar), todosOsDias: false }
  }

  const fimDaLista = periodo.fim < hoje ? periodo.fim : hoje
  const juntos = new Map<string, DiaComAusencia<D>>()
  // Período inteiro no futuro: `diasDoPeriodo` devolve vazio, e só o conteúdo entra.
  for (const dia of diasDoPeriodo(periodo.inicio, fimDaLista)) {
    juntos.set(dia, { dia, batidas: null, ausencias: [] })
  }
  for (const dia of comConteudo) juntos.set(dia.dia, dia)

  return {
    dias: [...juntos.values()].sort((a, b) => a.dia.localeCompare(b.dia)).map(marcar),
    todosOsDias: true,
  }
}

/* ------------------------------------------------------------------ */
/* A data e a hora da caixa de batida — ao inserir e ao corrigir        */
/* ------------------------------------------------------------------ */

/**
 * O dia que a caixa de inserir abre pelo botão do topo: hoje, se hoje está no
 * período; senão o último dia do período.
 *
 * NÃO É O ÚLTIMO DIA COM BATIDA, de propósito: esse nunca sugeriria o sábado
 * vazio, que é justamente o dia que precisa da caixa. Hoje é o dia mais provável
 * de quem abre o mês corrente; num mês passado, o fim dele é o mais perto do
 * fechamento. O período inteiro no futuro
 * (só dá para chegar nele pela URL) abre em hoje, que é o dia mais próximo que
 * o formulário aceita.
 */
export function diaDoBotaoDoTopo(periodo: Periodo, hoje: string): string {
  if (periodo.fim < hoje) return periodo.fim
  return hoje
}

/** A caixa de batida: corrigir uma batida que existe, ou inserir uma num dia. */
export type ModoDaCaixa =
  | { nome: 'corrigir'; batida: { dia_civil: string } }
  | { nome: 'inserir'; diaSugerido: string }

/**
 * O dia com que a caixa abre: o da batida, ao corrigir; o dia escolhido (o da
 * linha clicada, ou o do botão do topo), ao inserir.
 */
export function diaInicialDaCaixa(modo: ModoDaCaixa): string {
  return modo.nome === 'corrigir' ? modo.batida.dia_civil : modo.diaSugerido
}

export interface LimitesDaCaixa {
  /** O `max` do campo de dia: hoje, no fuso do ponto. */
  diaMaximo: string
  /** O `max` do campo de hora: o minuto de agora quando o dia é hoje; sem limite nos outros dias. */
  horaMaxima: string | undefined
}

/**
 * Os limites dos campos. São CONFORTO, e não regra: o `max` de um
 * `<input type="date">` ou `type="time"` não impede digitar. Quem recusa é
 * `validarMomentoDaCaixa`, no envio — e, depois dela, a trava de futuro do
 * banco.
 */
export function limitesDaCaixa(dia: string, agora: Date): LimitesDaCaixa {
  const hoje = diaCivilDoInstante(agora)
  return {
    diaMaximo: hoje,
    horaMaxima: dia === hoje ? formatarHora(agora.toISOString()) : undefined,
  }
}

export type ResultadoDoMomento = { ok: true; momentoISO: string } | { ok: false; erro: string }

const FORMATO_DA_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * O dia e a hora da caixa valem? Nenhum dia depois de hoje e, hoje, nenhuma
 * hora depois de agora — ao inserir E ao corrigir. A caixa é a mesma para os
 * dois, e a trava de futuro do banco recusa os dois: corrigir uma batida para
 * amanhã é tão impossível quanto inserir uma amanhã.
 *
 * A ORDEM DAS PERGUNTAS: formato, calendário, dia, hora. Assim "amanhã às
 * 08:00" recebe "esse dia ainda não chegou", que é a frase do caso, e não uma
 * frase sobre a hora.
 *
 * A hora é a do relógio do ponto (`momentoNoFusoDoLocal`), e a comparação
 * é com o instante de agora sem arredondar: às 10h05m30, "10:05" passa e
 * "10:06" não.
 */
export function validarMomentoDaCaixa(entrada: {
  modo: ModoDaCaixa['nome']
  dia: string
  hora: string
  agora: Date
}): ResultadoDoMomento {
  const { modo, dia, hora, agora } = entrada

  if (!FORMATO_DA_HORA.test(hora)) {
    return { ok: false, erro: 'Informe a hora no formato HH:MM, entre 00:00 e 23:59.' }
  }
  if (!ehDiaValido(dia)) {
    return { ok: false, erro: 'Escolha um dia que exista no calendário.' }
  }

  const hoje = diaCivilDoInstante(agora)
  if (dia > hoje) {
    return {
      ok: false,
      erro:
        modo === 'corrigir'
          ? 'Esse dia ainda não chegou: a batida só pode ser corrigida para hoje ou um dia antes (horário de Brasília).'
          : 'Esse dia ainda não chegou: só dá para inserir batida até hoje (horário de Brasília).',
    }
  }

  const momentoISO = momentoNoFusoDoLocal(dia, hora)
  if (new Date(momentoISO).getTime() > agora.getTime()) {
    const limite = formatarHora(agora.toISOString())
    return {
      ok: false,
      erro:
        modo === 'corrigir'
          ? `Esse horário ainda não chegou. Hoje, a correção pode ir até ${limite}.`
          : `Esse horário ainda não chegou. Hoje, a batida inserida pode ser até ${limite}.`,
    }
  }
  return { ok: true, momentoISO }
}

/* ------------------------------------------------------------------ */
/* O botão "Corrigir ponto" da tela de bater                           */
/* ------------------------------------------------------------------ */

/**
 * O rótulo do botão de quem administra: "Corrigir ponto", e a contagem quando
 * há pedido de batida em atraso esperando decisão ("Corrigir ponto · 2 pedidos
 * esperando"). Sem a contagem (`null`: ainda lendo, ou a leitura falhou), o
 * botão continua — ele é o caminho, a contagem é o empurrão.
 */
export function rotuloDoCorrigirPonto(pedidosEsperando: number | null): string {
  if (!pedidosEsperando || pedidosEsperando < 1) return 'Corrigir ponto'
  return `Corrigir ponto · ${pedidosEsperando} ${pedidosEsperando === 1 ? 'pedido esperando' : 'pedidos esperando'}`
}
