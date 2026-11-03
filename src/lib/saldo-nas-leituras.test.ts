import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Ausencia } from './ausencias'
import type { BatidaDoAdmin } from './formato'
import type { FuncionarioDoPainel } from './painel'
import type { RegrasDoSaldo, SaldoDoDia } from './saldo'

/*
 * O SALDO NAS LEITURAS DAS TELAS: o espelho de quem bate, o painel da pessoa e
 * o painel geral, num mês de exemplo.
 *
 * O que se prova, com as regras montadas por `regrasDoSaldo`, como nas telas:
 *  • o total do mês soma o abono: o trabalhado do espelho (`montarEspelho`)
 *    mais o abonado (`abonadoNoTotal`), com a conta escrita embaixo;
 *  • os 6 critérios do saldo aparecem nos cartões dos dias com as palavras
 *    certas (previsto, abonado, saldo, a marca com o abono);
 *  • a lista do espelho tem o dia de falta, e só tantos quantos o resumo cobra;
 *  • o resumo diz "Horas extras", "Horas negativas" e as faltas, e é o mesmo
 *    no espelho (o mês) e no painel da pessoa (o período do dia 1 ao último);
 *  • quando o mês começa antes do primeiro dia cobrado, os dias de antes não
 *    entram no saldo, e o resumo diz a data.
 *
 * O MÊS: outubro de 2026, jornada da semente (segunda a sexta, 08:00-12:00 e
 * 13:00-17:00), tolerância de 10 min, a ficha diz que a pessoa passou a bater
 * ponto aqui em 01/10, a "Saldo calculado a partir de" é a mesma data, e
 * "hoje" é sexta, 30/10. Pessoa e dados inventados.
 *
 *   01, 02, 05-09   dia normal (8h00, saldo 0h00)
 *   10 (sábado)     09-13: dia sem jornada, hora extra +4h00
 *   12              falta justificada, dia inteiro (abona 8h00)
 *   13              08-12 e 13-18: +1h00
 *   14              Critério 1: atestado de 1 dia
 *   15              entrada 08:25: atraso 0h25, saldo −0h25
 *   16              "outro motivo" 08-10 (não abona) e trabalho 10-12, 13-17: −2h00
 *   19              três batidas: incompleto, saldo pendente
 *   20              nenhuma batida: falta, −8h00
 *   21-23           Critério 2: atestado de 3 dias (qua a sex); o sábado 24 não entra
 *   26              Critério 3: atestado 14-16, batidas 08-12, 13-14, 16-17
 *   27              Critério 4: atestado 16:00-16:30, saída 16:00 e volta 16:30
 *   28              Critério 5: atestados 08-09 e 15-16, trabalho 09-12, 13-15, 16-17
 *   29              Critério 6: o dia do critério 3 com o atestado CANCELADO: −2h00
 *   30 (hoje)       três batidas: em andamento
 */

vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      throw new Error('O desenho da tela não pode ler o banco.')
    },
    rpc: () => {
      throw new Error('O desenho da tela não pode chamar RPC.')
    },
    storage: {
      from: () => {
        throw new Error('O desenho da tela não pode tocar o bucket.')
      },
    },
    functions: { invoke: () => Promise.reject(new Error('sem rede')) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}))

const { DiaDoEspelho } = await import('../components/DiaDoEspelho')
const { DiaSemBatida } = await import('../components/DiaDoPainel')
const { DiaDeAusencia } = await import('../components/DiaDeAusencia')
const { ComposicaoDoTotal, LinhaDoSaldo, ResumoDoSaldoNaTela } = await import('../components/SaldoDoDia')
const { LinhaDeFuncionario } = await import('../pages/Painel')
const { ausenciasPorDia, ausenciasPorPessoa, juntarDiasEAusencias } = await import('./ausencias')
const { dataBrasileira, formatarDuracao, montarEspelho } = await import('./horas')
const { JORNADA_SEMENTE } = await import('./jornada')
const { montarLinhasDoPainel } = await import('./painel')
const {
  abonadoNoTotal,
  calcularSaldoDoMes,
  calcularSaldoDoPeriodo,
  cobrancaNoRecorte,
  horasDoDia,
  juntarDiasDeFalta,
  regrasDoSaldo,
} = await import('./saldo')

const MES = '2026-10'
const OUTUBRO = { inicio: '2026-10-01', fim: '2026-10-31' }
const HOJE = '2026-10-30'

/** A configuração como `lerConfiguracao` a entrega, só com o que o saldo lê. */
const CONFIGURACAO = { jornada: JORNADA_SEMENTE, toleranciaMinutos: 10, saldoAPartirDe: '2026-10-01' }
const FICHA = { jornada: null, batePontoDesde: '2026-10-01' }

/**
 * O mês de exemplo é de outubro sem feriado: a segunda 12/10 é um dia útil com
 * falta justificada. O feriado tem os testes dele em `saldo.test.ts` e no fim
 * deste arquivo.
 */
function semFeriado(regras: RegrasDoSaldo): RegrasDoSaldo {
  return { ...regras, feriadoDoDia: () => null }
}

const REGRAS = semFeriado(regrasDoSaldo(CONFIGURACAO, FICHA, HOJE))

const funcionario = { nome: 'Bruna Costa', email: 'bruna@example.com' }

let ordem = 0
function batidasDoDia(dia: string, ...horas: string[]): BatidaDoAdmin[] {
  return horas.map((hora, indice) => ({
    id: `b${(ordem += 1)}`,
    usuario_id: 'u-bruna',
    registrado_em: `${dia}T${hora}:00.000-03:00`,
    dia_civil: dia,
    tipo: (['entrada', 'saida_almoco', 'volta_almoco', 'saida'] as const)[indice] ?? 'extra',
    ordem_no_dia: indice + 1,
    // No local fictício do elenco, com GPS: o mês de exemplo não testa a marca de localização.
    latitude: -23.55052,
    longitude: -46.633308,
    precisao_metros: 12,
    distancia_metros: 3,
    no_local: true,
    selfie_path: `u-bruna/2026/10/b${ordem}.jpg`,
    ajuste_manual: false,
    origem: 'app',
    motivo_ajuste: null,
    funcionario_nome: funcionario.nome,
    funcionario_email: funcionario.email,
    pedido_atraso_id: null,
  }))
}

function ausencia(id: string, extras: Partial<Ausencia>): Ausencia {
  return {
    id,
    usuario_id: 'u-bruna',
    dia_inicio: '2026-10-14',
    dia_fim: '2026-10-14',
    tipo: 'atestado_medico',
    modalidade: 'dias',
    hora_inicio: null,
    hora_fim: null,
    observacao: null,
    atestado_path: `u-bruna/${id}.pdf`,
    lancado_por: 'u-rh',
    lancado_em: '2026-10-29T12:00:00.000Z',
    cancelada_em: null,
    cancelada_por: null,
    motivo_cancelamento: null,
    ...extras,
  }
}

function porHorario(id: string, dia: string, inicio: string, fim: string, extras: Partial<Ausencia> = {}): Ausencia {
  return ausencia(id, {
    dia_inicio: dia,
    dia_fim: dia,
    modalidade: 'horario',
    hora_inicio: `${inicio}:00`,
    hora_fim: `${fim}:00`,
    ...extras,
  })
}

const NORMAL = ['08:00', '12:00', '13:00', '17:00']

const BATIDAS: BatidaDoAdmin[] = [
  ...['01', '02', '05', '06', '07', '08', '09'].flatMap((dia) => batidasDoDia(`2026-10-${dia}`, ...NORMAL)),
  ...batidasDoDia('2026-10-10', '09:00', '13:00'),
  ...batidasDoDia('2026-10-13', '08:00', '12:00', '13:00', '18:00'),
  ...batidasDoDia('2026-10-15', '08:25', '12:00', '13:00', '17:00'),
  ...batidasDoDia('2026-10-16', '10:00', '12:00', '13:00', '17:00'),
  ...batidasDoDia('2026-10-19', '08:00', '12:00', '13:00'),
  ...batidasDoDia('2026-10-26', '08:00', '12:00', '13:00', '14:00', '16:00', '17:00'),
  ...batidasDoDia('2026-10-27', '08:00', '12:00', '13:00', '16:00', '16:30', '17:00'),
  ...batidasDoDia('2026-10-28', '09:00', '12:00', '13:00', '15:00', '16:00', '17:00'),
  ...batidasDoDia('2026-10-29', '08:00', '12:00', '13:00', '14:00', '16:00', '17:00'),
  ...batidasDoDia('2026-10-30', '08:00', '12:00', '13:00'),
]

const AUSENCIAS: Ausencia[] = [
  ausencia('a-12', { dia_inicio: '2026-10-12', dia_fim: '2026-10-12', tipo: 'falta_justificada', atestado_path: null }),
  ausencia('a-14', {}),
  porHorario('a-16', '2026-10-16', '08:00', '10:00', { tipo: 'outro', observacao: 'reunião na escola do filho', atestado_path: null }),
  ausencia('a-21', { dia_inicio: '2026-10-21', dia_fim: '2026-10-23' }),
  porHorario('a-26', '2026-10-26', '14:00', '16:00'),
  porHorario('a-27', '2026-10-27', '16:00', '16:30'),
  porHorario('a-28a', '2026-10-28', '08:00', '09:00'),
  porHorario('a-28b', '2026-10-28', '15:00', '16:00'),
  porHorario('a-29', '2026-10-29', '14:00', '16:00', {
    cancelada_em: '2026-10-29T18:00:00.000Z',
    cancelada_por: 'u-rh',
    motivo_cancelamento: 'lançado no dia errado',
  }),
]

/* ------------------------------------------------------------------ */

const nada = () => {}

function desenhar(elemento: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, elemento))
}

/** O texto como o navegador o mostra (`textContent`), com os espaços colapsados. */
function corrido(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Os trechos de texto, um por nó, na ordem da tela. */
function trechos(html: string): string[] {
  return html
    .split(/<[^>]+>/)
    .map((trecho) => trecho.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
    .filter((trecho) => trecho !== '')
}

const DO_MES = ausenciasPorDia(AUSENCIAS, OUTUBRO)
const SALDO = calcularSaldoDoMes(MES, BATIDAS, AUSENCIAS, REGRAS)
const ESPELHO = montarEspelho(MES, BATIDAS)

function saldoDe(dia: number, dias: readonly SaldoDoDia<BatidaDoAdmin>[] = SALDO.dias): SaldoDoDia<BatidaDoAdmin> {
  const achado = dias.find((umDia) => umDia.dia === `2026-10-${String(dia).padStart(2, '0')}`)
  if (!achado) throw new Error(`sem saldo para ${dia}`)
  return achado
}

/** O cartão do dia como o espelho de quem bate o desenha: com batida, só com ausência, ou o dia de falta. */
function cartaoDoEspelho(dia: number, saldos: readonly SaldoDoDia<BatidaDoAdmin>[] = SALDO.dias): string {
  const saldo = saldoDe(dia, saldos)
  const ausencias = DO_MES.get(saldo.dia) ?? []
  if (saldo.espelho.batidas.length > 0) {
    return desenhar(
      createElement(DiaDoEspelho, {
        dia: saldo.espelho,
        aoAbrirSelfie: nada,
        ausencias,
        aoAbrirAtestado: nada,
        ehHoje: saldo.dia === HOJE,
        saldo,
      }),
    )
  }
  if (ausencias.length > 0) return desenhar(createElement(DiaDeAusencia, { dia: saldo.dia, ausencias, saldo }))
  return desenhar(createElement(DiaSemBatida, { dia: saldo.dia, saldo }))
}

/* ------------------------------------------------------------------ */
/* O total do mês                                                      */
/* ------------------------------------------------------------------ */

describe('o total do mês soma o abono', () => {
  it('o trabalhado é o do espelho e o da conta do saldo; o abonado soma por cima', () => {
    expect(ESPELHO.minutos).toBe(SALDO.trabalhadoNoMes)
    expect(formatarDuracao(ESPELHO.minutos)).toBe('108h05')
    const abonado = abonadoNoTotal(SALDO.dias)
    expect(formatarDuracao(abonado)).toBe('44h30')
    // O total com abono é a soma das horas de cada dia (o incompleto soma zero).
    expect(ESPELHO.minutos + abonado).toBe(SALDO.dias.reduce((soma, dia) => soma + horasDoDia(dia), 0))
    expect(formatarDuracao(ESPELHO.minutos + abonado)).toBe('152h35')
  })

  it('a conta embaixo do total: atestado e falta justificada no mesmo mês são "abonadas"', () => {
    const html = desenhar(
      createElement(ComposicaoDoTotal, { trabalhado: ESPELHO.minutos, abonado: abonadoNoTotal(SALDO.dias), dias: SALDO.dias }),
    )
    expect(corrido(html)).toBe('108h05 trabalhadas + 44h30 abonadas')
  })
})

/* ------------------------------------------------------------------ */
/* Os dias                                                             */
/* ------------------------------------------------------------------ */

describe('os 6 critérios nos cartões dos dias', () => {
  it('Critério 1: atestado de 1 dia: previsto 8h00, abonado 8h00, saldo 0h00, e o dia soma 8h00 de atestado', () => {
    expect(trechos(cartaoDoEspelho(14))).toEqual([
      'Qua, 14 de out',
      'ausência',
      '8h00',
      'horas de atestado',
      'Previsto 8h00',
      'Abonado 8h00',
      'Saldo 0h00',
      'Atestado, dia inteiro',
      '· abonou 8h00',
    ])
  })

  it('Critério 2: atestado de 3 dias (qua a sex): os três abonados; o sábado seguinte não é cobrado nem listado', () => {
    for (const dia of [21, 22, 23]) {
      const html = corrido(cartaoDoEspelho(dia))
      expect(html).toContain('Previsto 8h00Abonado 8h00Saldo 0h00')
      expect(html).toContain('Atestado, dia inteiro · abonou 8h00')
    }
    expect(saldoDe(24)).toMatchObject({ semJornada: true, abonado: 0, falta: false })
    expect(DO_MES.get('2026-10-24')).toBeUndefined()
  })

  it('Critério 3: atestado 14:00-16:00 com batidas 08-12, 13-14 e 16-17: 6h00 trabalhadas + 2h00, saldo 0h00, sem atraso', () => {
    const html = corrido(cartaoDoEspelho(26))
    expect(html).toContain('6 batidas')
    expect(html).toContain('8h006h00 trabalhadas + 2h00 de atestado')
    expect(html).toContain('Saldo 0h00')
    expect(html).toContain('Atestado 14:00-16:00 · abonou 2h00')
    expect(html).not.toContain('Atraso')
  })

  it('Critério 4: atestado 16:00-16:30 com saída às 16:00 e volta às 16:30: abonado 0h30', () => {
    const html = corrido(cartaoDoEspelho(27))
    expect(html).toContain('8h007h30 trabalhadas + 0h30 de atestado')
    expect(html).toContain('Abonado 0h30')
    expect(html).toContain('Saldo 0h00')
    expect(html).toContain('Atestado 16:00-16:30 · abonou 0h30')
  })

  it('Critério 5: atestados 08-09 e 15-16 com trabalho no meio: as seis batidas e as duas marcas, em ordem', () => {
    const html = corrido(cartaoDoEspelho(28))
    expect(html).toContain('6 batidas')
    expect(html).toContain('8h006h00 trabalhadas + 2h00 de atestado')
    expect(html).toContain('Atestado 08:00-09:00 · abonou 1h00')
    expect(html).toContain('Atestado 15:00-16:00 · abonou 1h00')
    expect(html.indexOf('08:00-09:00')).toBeLessThan(html.indexOf('15:00-16:00'))
  })

  it('Critério 6: o dia do critério 3 com o atestado cancelado: saldo −2h00, e nenhuma marca', () => {
    const html = corrido(cartaoDoEspelho(29))
    expect(html).toContain('Saldo −2h00')
    expect(html).not.toContain('Atestado')
    expect(html).not.toContain('trabalhadas')
    expect(html).not.toContain('dia errado')
  })

  it('o incompleto fica pendente; hoje, em andamento; o dia de falta, com o débito e sem botão', () => {
    expect(corrido(cartaoDoEspelho(19))).toContain('Incompleto: saldo pendente')
    expect(corrido(cartaoDoEspelho(30))).toContain('Saldo: em andamento')
    const falta = cartaoDoEspelho(20)
    expect(trechos(falta)).toEqual(['Ter, 20 de out', '· Sem batida', 'Previsto 8h00', 'Falta', 'Saldo −8h00'])
    expect(falta).not.toContain('<button')
  })

  it('atraso, "outro motivo", falta justificada e dia sem jornada, com as palavras das telas', () => {
    expect(corrido(cartaoDoEspelho(15))).toContain('Atraso 0h25Saldo −0h25')
    const outro = corrido(cartaoDoEspelho(16))
    expect(outro).toContain('Outro motivo 08:00-10:00: reunião na escola do filho · não abona')
    expect(outro).toContain('Atraso 2h00Saldo −2h00')
    const justificada = corrido(cartaoDoEspelho(12))
    expect(justificada).toContain('8h00horas de falta justificada')
    expect(justificada).toContain('Falta justificada, dia inteiro · abonou 8h00')
    expect(corrido(cartaoDoEspelho(10))).toContain('Dia sem jornadaHora extra +4h00')
    expect(corrido(cartaoDoEspelho(13))).toContain('Saldo +1h00')
  })

  it('nenhum cartão do mês usa o travessão', () => {
    const lista = juntarDiasDeFalta(juntarDiasEAusencias(ESPELHO.dias, DO_MES), SALDO.dias)
    const todos = lista.map((linha) => cartaoDoEspelho(Number(linha.dia.slice(8)))).join('')
    expect(todos).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('a lista do espelho tem os dias de falta, tantos quantos o resumo cobra', () => {
  const lista = juntarDiasDeFalta(juntarDiasEAusencias(ESPELHO.dias, DO_MES), SALDO.dias)

  it('os dias com batida, os de ausência e o de falta, em ordem de data; nada do fim de semana vazio nem do futuro', () => {
    expect(lista.map((linha) => linha.dia.slice(8))).toEqual([
      '01', '02', '05', '06', '07', '08', '09', '10', '12', '13', '14', '15', '16',
      '19', '20', '21', '22', '23', '26', '27', '28', '29', '30',
    ])
    const deFalta = lista.filter((linha) => linha.batidas === null && linha.ausencias.length === 0)
    expect(deFalta.map((linha) => linha.dia)).toEqual(['2026-10-20'])
    expect(deFalta).toHaveLength(SALDO.resumo.faltas)
  })
})

/* ------------------------------------------------------------------ */
/* O resumo                                                            */
/* ------------------------------------------------------------------ */

describe('o resumo do mês e do período', () => {
  it('o espelho mostra o saldo do mês com "Horas extras", "Horas negativas", a falta, o incompleto e hoje', () => {
    const html = desenhar(createElement(ResumoDoSaldoNaTela, { resumo: SALDO.resumo, rotulo: 'Saldo do mês', comHoje: true }))
    expect(trechos(html)).toEqual([
      'Saldo do mês',
      '−7h25',
      'Previsto 160h00 · Abonado 44h30 · Horas extras +5h00 · Horas negativas −12h25 · 1 falta',
      'O saldo não inclui 1 dia incompleto: falta batida, e o saldo dele fica pendente até a correção.',
      'Hoje entra no saldo quando o dia acabar.',
    ])
  })

  it('o painel da pessoa (o período do dia 1 ao último) dá o mesmo resumo e o mesmo total do espelho', () => {
    const periodo = calcularSaldoDoPeriodo(OUTUBRO.inicio, OUTUBRO.fim, BATIDAS, AUSENCIAS, REGRAS)
    expect(periodo.resumo).toEqual(SALDO.resumo)
    expect(abonadoNoTotal(periodo.dias)).toBe(abonadoNoTotal(SALDO.dias))
    const doEspelho = desenhar(createElement(ResumoDoSaldoNaTela, { resumo: SALDO.resumo, rotulo: 'Saldo' }))
    const doPainel = desenhar(createElement(ResumoDoSaldoNaTela, { resumo: periodo.resumo, rotulo: 'Saldo' }))
    expect(doPainel).toBe(doEspelho)
  })

  it('o painel geral: o cartão da pessoa soma o abono do mês e diz de onde ele veio', () => {
    const pessoa: FuncionarioDoPainel = {
      usuarioId: 'u-bruna',
      nome: funcionario.nome,
      nomeDaConta: funcionario.nome,
      email: funcionario.email,
      podeBater: true,
      contaApagada: false,
      temFicha: true,
    }
    const [linha] = montarLinhasDoPainel([pessoa], BATIDAS, ausenciasPorPessoa(AUSENCIAS, OUTUBRO))
    const saldos = calcularSaldoDoPeriodo(OUTUBRO.inicio, OUTUBRO.fim, BATIDAS, AUSENCIAS, REGRAS).dias
    const cartao = corrido(desenhar(createElement(LinhaDeFuncionario, { linha, periodo: OUTUBRO, saldos })))
    expect(cartao).toContain('152h35')
    expect(cartao).toContain('+ 44h30 abonadas')
  })

  it('o mês começa antes do primeiro dia cobrado: os dias de antes ficam fora, e o resumo diz a data', () => {
    // A ficha é antiga; a "Saldo calculado a partir de" é 15/10, e ela ganha.
    const regras = semFeriado(
      regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: '2026-10-15' }, { jornada: null, batePontoDesde: '2025-03-10' }, HOJE),
    )
    const mes = calcularSaldoDoMes(MES, BATIDAS, AUSENCIAS, regras)
    const cobranca = cobrancaNoRecorte(regras.cobrancaDesde, OUTUBRO.inicio, OUTUBRO.fim)
    expect(cobranca).toEqual({ caso: 'no_meio', desde: '2026-10-15' })
    // De 15 a 29, menos o 19 (pendente): 10 dias úteis.
    expect(mes.resumo).toMatchObject({ previsto: 10 * 480, faltas: 1, diasIncompletos: 1 })
    const html = corrido(
      desenhar(
        createElement(ResumoDoSaldoNaTela, {
          resumo: mes.resumo,
          rotulo: 'Saldo do mês',
          aPartirDe: cobranca.caso === 'no_meio' ? cobranca.desde : null,
        }),
      ),
    )
    expect(html).toContain(`Saldo calculado a partir de ${dataBrasileira('2026-10-15')}. Os dias antes dessa data ficam fora do saldo.`)
    // O atestado de 14/10 não é cobrado, mas ainda soma no total do dia.
    expect(desenhar(createElement(LinhaDoSaldo, { saldo: saldoDe(14, mes.dias) }))).toBe('')
    expect(corrido(cartaoDoEspelho(14, mes.dias))).toContain('8h00horas de atestado')
    // O dia de antes sem batida não é falta.
    expect(saldoDe(13, mes.dias)).toMatchObject({ estado: 'fora', motivoDeFora: 'antes_da_cobranca', falta: false })
  })
})

/* ------------------------------------------------------------------ */
/* O atestado que soma no total, e o feriado                           */
/* ------------------------------------------------------------------ */

describe('o atestado soma no total do dia, e o feriado nacional aparece como feriado', () => {
  // Terça 06/10: 08:00-12:00 e 13:00-15:01 (6h01), atestado das 15:00 às 16:00. A
  // jornada vai até as 17:00: o abono é 15:01-16:00 (0h59). A segunda 12/10 é feriado, trabalhada 08-12.
  const doDia = [...batidasDoDia('2026-10-06', '08:00', '12:00', '13:00', '15:01'), ...batidasDoDia('2026-10-12', '08:00', '12:00')]
  const atestados = [porHorario('tarde-curta', '2026-10-06', '15:00', '16:00', { atestado_path: null })]
  const comFeriados = regrasDoSaldo(CONFIGURACAO, FICHA, HOJE)

  it('o dia soma 7h00, com a conta escrita, e o feriado trabalhado diz "Feriado" e "Hora extra +4h00"', () => {
    const mes = calcularSaldoDoMes(MES, doDia, atestados, comFeriados)
    const dia = saldoDe(6, mes.dias)
    const html = corrido(desenhar(createElement(DiaDoEspelho, { dia: dia.espelho, aoAbrirSelfie: nada, ausencias: atestados, saldo: dia })))
    expect(html).toContain('7h006h01 trabalhadas + 0h59 de atestado')
    expect(html).toContain('Atestado 15:00-16:00 · abonou 0h59')
    const feriado = saldoDe(12, mes.dias)
    expect(feriado).toMatchObject({ feriado: 'Nossa Senhora Aparecida', semJornada: true, previsto: 0, credito: 240 })
    expect(trechos(desenhar(createElement(LinhaDoSaldo, { saldo: feriado })))).toEqual(['Feriado', 'Hora extra +4h00'])
  })

  it('sem a data na ficha: o dia não é cobrado, mas o atestado ainda soma no total e no período', () => {
    const regras = regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: null }, HOJE)
    const mes = calcularSaldoDoMes(MES, doDia, atestados, regras)
    const dia = saldoDe(6, mes.dias)
    expect(dia.estado).toBe('fora')
    const html = corrido(desenhar(createElement(DiaDoEspelho, { dia: dia.espelho, aoAbrirSelfie: nada, ausencias: atestados, saldo: dia })))
    expect(html).toContain('7h006h01 trabalhadas + 0h59 de atestado')
    expect(html).not.toContain('Previsto')
    const espelho = montarEspelho(MES, doDia)
    expect(corrido(desenhar(createElement(ComposicaoDoTotal, { trabalhado: espelho.minutos, abonado: abonadoNoTotal(mes.dias), dias: mes.dias })))).toBe(
      '10h01 trabalhadas + 0h59 de atestado',
    )
  })
})
