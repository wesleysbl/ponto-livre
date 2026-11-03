import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Ausencia } from './ausencias'
import type { DadosDaEmpresa } from './configuracao'
import type { FolhaDePonto, LinhaDaFolha } from './folha'
import type { BatidaDoAdmin } from './formato'
import type { FuncionarioDoPainel } from './painel'
import type { RegrasDoSaldo, SaldoDoDia } from './saldo'

/*
 * O SALDO NAS LEITURAS: o espelho de quem bate, o painel da pessoa, o painel
 * geral, a folha impressa e o CSV, num mês de exemplo.
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
 *    entram no saldo, e o resumo diz a data;
 *  • a folha traz o trabalhado, o previsto, o abonado e o saldo de cada dia, o
 *    total com abono e o "Resumo do mês" com os mesmos números das telas;
 *  • a coluna Abonado da folha soma o "Total do mês" dela, que é o abono do
 *    "Total com abono", mesmo com o saldo começando no meio do mês;
 *  • o CSV mantém as 18 colunas de antes, com o mesmo conteúdo, e traz as 9 do
 *    saldo no fim, com o saldo negativo como número da planilha.
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
const { ComposicaoDoTotal, LinhaDoSaldo, ResumoDoSaldoNaTela, TotalDoDia } = await import('../components/SaldoDoDia')
const { LinhaDeFuncionario } = await import('../pages/Painel')
const { FolhaParaImprimir } = await import('../components/FolhaParaImprimir')
const { montarFolha } = await import('./folha')
const {
  CABECALHO,
  COLUNAS_ANTES_DO_SALDO,
  FIM_DE_LINHA,
  gerarCsvDoPeriodo,
  neutralizarFormula,
  SEPARADOR,
  TIPO_DA_LINHA_DE_AUSENCIA,
  TIPO_DA_LINHA_DE_FALTA,
} = await import('./csv')
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
/* A folha impressa                                                    */
/* ------------------------------------------------------------------ */

/** A empresa fictícia da demonstração (`demo/semear.mjs`), sem CNPJ. */
const EMPRESA: DadosDaEmpresa = {
  razaoSocial: 'Empresa Exemplo Ltda',
  nomeFantasia: 'Empresa Exemplo',
  cnpj: null,
  endereco: 'Rua das Flores, 100 - Centro',
  cidade: 'Campinas',
  uf: 'SP',
}

const FOLHA = montarFolha({ empresa: EMPRESA, funcionario, mes: MES, batidas: BATIDAS, ausencias: AUSENCIAS, regras: REGRAS })

function linhaDa(folha: FolhaDePonto, dia: number): LinhaDaFolha | undefined {
  return folha.linhas.find((linha) => linha.dia === `2026-10-${String(dia).padStart(2, '0')}`)
}
const linha = (dia: number) => linhaDa(FOLHA, dia)

/** O papel, como `FolhaParaImprimir` o desenha. */
function papel(folha: FolhaDePonto): string {
  return renderToStaticMarkup(createElement(FolhaParaImprimir, { folha, emitidaEm: '30/10/2026 18:00' }))
}

/** O valor de um item do "Resumo do mês": o `<dd>` logo depois do `<dt>` com o rótulo. */
function valorDoResumo(html: string, rotulo: string): string | undefined {
  return html.match(new RegExp(`<dt>${rotulo}</dt><dd[^>]*>([^<]*)</dd>`))?.[1]
}

/** `8h00` -> 480: a duração do papel, em minutos. */
function minutosDaDuracao(texto: string): number {
  const [horas, minutos] = texto.split('h').map(Number)
  return horas * 60 + minutos
}

/** A coluna Abonado somada célula a célula, como quem confere o papel na calculadora. */
function somaDaColunaAbonado(folha: FolhaDePonto): number {
  return folha.linhas.reduce((soma, l) => soma + (l.saldo?.abonado ? minutosDaDuracao(l.saldo.abonado) : 0), 0)
}

/** As células do "Total do mês" da tabela, em ordem: o rótulo, o trabalhado, o previsto, o abonado e o saldo. */
function totalDaTabela(html: string): string[] {
  return trechos(html.match(/<tfoot[^>]*>([\s\S]*?)<\/tfoot>/)?.[1] ?? '')
}

describe('a folha com o saldo', () => {
  it('o total trabalhado é o do espelho, dia a dia, e o alto da folha soma o abono', () => {
    expect(FOLHA.resumo.minutos).toBe(ESPELHO.minutos)
    expect(FOLHA.resumo.minutos).toBe(SALDO.trabalhadoNoMes)
    expect(FOLHA.total).toBe('108h05')
    for (const dia of ESPELHO.dias) expect(FOLHA.linhas.find((l) => l.dia === dia.dia)?.minutos).toBe(dia.minutos)
    expect(FOLHA.abono).toEqual({ minutos: 44 * 60 + 30, total: '152h35', composicao: '108h05 trabalhadas + 44h30 abonadas' })
  })

  it('os dias são os da lista do espelho: com batida, de ausência e de falta', () => {
    const lista = juntarDiasDeFalta(juntarDiasEAusencias(ESPELHO.dias, DO_MES), SALDO.dias)
    expect(FOLHA.linhas.map((l) => l.dia)).toEqual(lista.map((l) => l.dia))
  })

  it('Critério 1: atestado de 1 dia: previsto 8h00, abonado 8h00, saldo 0h00, sem falta, e a marca com o período', () => {
    expect(linha(14)?.saldo).toEqual({ estado: 'cobranca', previsto: '8h00', abonado: '8h00', saldo: '0h00' })
    expect(linha(14)).toMatchObject({ horarios: [], total: '0h00', falta: false, ausencia: true })
    expect(linha(14)?.marcas).toEqual(['Atestado, dia inteiro (atestado anexado)'])
  })

  it('Critério 2: atestado de 3 dias (qua a sex): os três abonados; o sábado seguinte não entra', () => {
    for (const dia of [21, 22, 23]) {
      expect(linha(dia)?.saldo).toMatchObject({ previsto: '8h00', abonado: '8h00', saldo: '0h00' })
      expect(linha(dia)?.marcas).toEqual(['Atestado, dia inteiro (atestado anexado)'])
    }
    expect(linha(24)).toBeUndefined()
  })

  it('Critério 3: atestado 14:00-16:00 com batidas 08-12, 13-14 e 16-17: trabalhado 6h00, abonado 2h00, saldo 0h00', () => {
    expect(linha(26)?.horarios).toEqual(['08:00', '12:00', '13:00', '14:00', '16:00', '17:00'])
    expect(linha(26)?.total).toBe('6h00')
    expect(linha(26)?.saldo).toMatchObject({ previsto: '8h00', abonado: '2h00', saldo: '0h00' })
    expect(linha(26)?.marcas).toEqual(['Atestado 14:00-16:00 (atestado anexado)'])
  })

  it('Critério 4: atestado 16:00-16:30 com saída às 16:00 e volta às 16:30: abonado 0h30', () => {
    expect(linha(27)?.total).toBe('7h30')
    expect(linha(27)?.saldo).toMatchObject({ abonado: '0h30', saldo: '0h00' })
    expect(linha(27)?.marcas).toEqual(['Atestado 16:00-16:30 (atestado anexado)'])
  })

  it('Critério 5: atestados 08-09 e 15-16 com trabalho no meio: as seis batidas e as duas marcas, em ordem', () => {
    expect(linha(28)?.horarios).toHaveLength(6)
    expect(linha(28)?.total).toBe('6h00')
    expect(linha(28)?.saldo).toMatchObject({ abonado: '2h00', saldo: '0h00' })
    expect(linha(28)?.marcas).toEqual(['Atestado 08:00-09:00 (atestado anexado)', 'Atestado 15:00-16:00 (atestado anexado)'])
    expect(FOLHA.colunasDeHorario).toBe(6)
  })

  it('Critério 6: o dia do critério 3 com o atestado cancelado: saldo −2h00, e nenhuma marca do cancelado', () => {
    expect(linha(29)?.total).toBe('6h00')
    expect(linha(29)?.saldo).toEqual({ estado: 'cobranca', previsto: '8h00', abonado: '', saldo: '−2h00' })
    expect(linha(29)?.ausencia).toBe(false)
    expect(FOLHA.linhas.flatMap((l) => l.marcas).join(' ')).not.toContain('dia errado')
  })

  it('o dia incompleto: saldo pendente; hoje: em andamento, e a marca de hoje não diz "pendente"', () => {
    expect(linha(19)?.saldo).toMatchObject({ estado: 'pendente', previsto: '8h00', saldo: 'pendente' })
    expect(linha(19)?.marcas).toEqual(['Incompleto: fora do total, saldo pendente'])
    expect(linha(30)?.saldo).toMatchObject({ estado: 'em_andamento', saldo: 'em andamento' })
    expect(linha(30)?.marcas).toEqual(['Incompleto: fora do total'])
  })

  it('o dia de falta entra como no espelho, sem horário: "Falta" e −8h00, tantos quantos o resumo cobra', () => {
    expect(linha(20)).toMatchObject({ horarios: [], total: '0h00', falta: true, ausencia: false, marcas: ['Falta'] })
    expect(linha(20)?.saldo).toMatchObject({ previsto: '8h00', saldo: '−8h00' })
    expect(FOLHA.linhas.filter((l) => l.falta)).toHaveLength(SALDO.resumo.faltas)
  })

  it('atraso, "outro motivo", falta justificada e dia sem jornada, com as palavras das telas', () => {
    expect(linha(15)?.marcas).toEqual(['Atraso 0h25'])
    expect(linha(15)?.saldo?.saldo).toBe('−0h25')
    expect(linha(16)?.marcas).toEqual(['Outro motivo 08:00-10:00: reunião na escola do filho', 'Atraso 2h00'])
    expect(linha(16)?.saldo).toMatchObject({ abonado: '', saldo: '−2h00' })
    expect(linha(12)?.marcas).toEqual(['Falta justificada, dia inteiro'])
    expect(linha(12)?.saldo).toMatchObject({ abonado: '8h00', saldo: '0h00' })
    // O sábado: previsto zero, e a marca diz por quê.
    expect(linha(10)?.saldo).toMatchObject({ previsto: '0h00', abonado: '', saldo: '+4h00' })
    expect(linha(10)?.marcas).toEqual(['Dia sem jornada'])
    expect(linha(13)?.saldo?.saldo).toBe('+1h00')
  })

  it('o resumo do mês é o da conta e o das telas: horas extras +5h00, horas negativas −12h25, 1 falta, saldo −7h25', () => {
    expect(FOLHA.saldo?.resumo).toEqual(SALDO.resumo)
    expect(FOLHA.saldo).toMatchObject({
      saldo: '−7h25',
      previsto: '160h00',
      abonadoDaColuna: '44h30',
      extras: '+5h00',
      negativas: '−12h25',
      faltas: '1 dia',
      notaDoInicio: null,
      notaDeHoje: 'Hoje entra no saldo quando o dia acabar.',
      toleranciaMinutos: 10,
    })
    expect(FOLHA.saldo?.notaDosIncompletos).toBe(
      'O saldo não inclui 1 dia incompleto: falta batida, e o saldo dele fica pendente até a correção.',
    )
    expect(FOLHA.semSaldo).toBeNull()
  })

  it('o total da coluna Abonado é a soma das células e o abono do total com abono, o mesmo 44h30 de antes', () => {
    // Cobrado desde o dia 1, todo dia que abonou é de cobrança: a coluna, o alto e o resumo dizem o mesmo.
    expect(somaDaColunaAbonado(FOLHA)).toBe(44 * 60 + 30)
    expect(FOLHA.abono?.minutos).toBe(somaDaColunaAbonado(FOLHA))
    expect(FOLHA.saldo?.abonadoDaColuna).toBe(formatarDuracao(SALDO.resumo.abonado))
    expect(totalDaTabela(papel(FOLHA))).toEqual(['Total do mês', '108h05', '160h00', '44h30', '−7h25'])
  })

  it('o papel desenha as colunas novas, o total com abono, o "Resumo do mês" e nenhum travessão', () => {
    const html = papel(FOLHA)
    for (const cabecalho of ['Trabalhado', 'Previsto', 'Abonado', 'Saldo']) expect(html).toContain(`>${cabecalho}</th>`)
    expect(html).not.toContain('>Observações</th>')
    expect(html).toContain('Total com abono')
    expect(html).toContain('152h35')
    expect(html).toContain('108h05 trabalhadas + 44h30 abonadas')
    expect(html).toContain('Resumo do mês')
    expect(valorDoResumo(html, 'Horas extras')).toBe('+5h00')
    expect(valorDoResumo(html, 'Horas negativas')).toBe('−12h25')
    expect(valorDoResumo(html, 'Faltas')).toBe('1 dia')
    expect(valorDoResumo(html, 'Saldo do mês')).toBe('−7h25')
    // O total da tabela: trabalhado, previsto, abonado e saldo.
    expect(html).toContain('>108h05</td>')
    expect(html).toContain('>160h00</td>')
    expect(html).toContain('>44h30</td>')
    expect(html).toContain('Atestado 14:00-16:00 (atestado anexado)')
    expect(html).toContain('em andamento')
    expect(html).not.toContain('não soma nem desconta horas')
    expect(html).not.toMatch(/[\u2013\u2014]/)
    // Debaixo do saldo do mês, só os dias com jornada: o sábado 10 é dia de cobrança, mas não entra nesse número.
    expect(SALDO.resumo.diasComJornada).toBeLessThan(SALDO.resumo.diasDeCobranca)
    expect(html).toContain(`${SALDO.resumo.diasComJornada} dias de jornada na conta`)
    // O papel assinado continua com os dois campos de assinatura e a marca do app.
    expect(html).toContain('Assinatura do funcionário')
    expect(html).toContain('Assinatura do responsável')
  })

  it('a legenda só com o que o mês usa, com a frase das horas extras e das negativas', () => {
    expect(FOLHA.legenda).toEqual({
      incompleto: true,
      ajustado: false,
      batidaEmAtraso: false,
      ausencia: true,
      falta: true,
      atrasoDaEntrada: true,
      foraDoSaldo: true,
      feriado: false,
      abono: true,
    })
    const html = corrido(papel(FOLHA))
    expect(html).toContain('No resumo do mês, horas extras somam o saldo positivo dos dias e horas negativas somam o negativo, faltas inclusive.')
    expect(html).toContain('Falta é dia da jornada sem batida e sem abono que cubra o dia.')
    expect(html).toContain('Atraso é entrada depois do início da jornada além da tolerância')
    expect(html).toContain('Incompleto: fora do total, porque o dia tem número ímpar de batidas')
    expect(html).toContain('Atestado e falta justificada abonam a parte da jornada que cobrem')
    expect(html).toContain('O total com abono, no alto da folha, soma o trabalhado e o abonado.')
    // O que o mês não usa não entra.
    expect(html).not.toContain('Ajustado pelo administrador:')
    expect(html).not.toContain('Em atraso, aprovada:')
    expect(html).not.toContain('Feriado:')
  })

  it('o resumo sai mesmo sem nada a somar: 0h00 e "nenhuma"; duas faltas no plural', () => {
    // Só o sábado 31 é cobrado, sem jornada e sem batida: nada a mais nem a menos.
    const desde = (dia: string) => semFeriado(regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: dia }, '2026-11-02'))
    const vazio = montarFolha({ empresa: null, funcionario, mes: MES, batidas: [], regras: desde('2026-10-31') })
    expect(vazio.saldo).toMatchObject({ extras: '0h00', negativas: '0h00', faltas: 'nenhuma', saldo: '0h00' })
    const html = papel(vazio)
    expect(valorDoResumo(html, 'Horas extras')).toBe('0h00')
    expect(valorDoResumo(html, 'Horas negativas')).toBe('0h00')
    expect(valorDoResumo(html, 'Faltas')).toBe('nenhuma')
    const duas = montarFolha({ empresa: null, funcionario, mes: MES, batidas: [], regras: desde('2026-10-29') })
    expect(duas.saldo).toMatchObject({ faltas: '2 dias', extras: '0h00', negativas: '−16h00', saldo: '−16h00' })
  })

  it('sem as regras, a folha é a de antes e diz por quê; o total trabalhado não muda', () => {
    const semRegras = montarFolha({ empresa: EMPRESA, funcionario, mes: MES, batidas: BATIDAS, ausencias: AUSENCIAS })
    expect(semRegras.saldo).toBeNull()
    expect(semRegras.semSaldo).toBe('Esta folha não traz previsto, abonado e saldo: a jornada da empresa não está cadastrada no sistema.')
    expect(semRegras.linhas.every((l) => l.saldo === null)).toBe(true)
    // Sem a conta, o dia de falta não tem como entrar, e não há abono no alto.
    expect(semRegras.linhas.map((l) => l.dia)).not.toContain('2026-10-20')
    expect(semRegras.abono).toBeNull()
    expect(semRegras.total).toBe(FOLHA.total)
    const html = papel(semRegras)
    expect(html).toContain('>Observações</th>')
    expect(html).not.toContain('>Abonado</th>')
    expect(html).not.toContain('Resumo do mês')
    expect(html).toContain('Esta folha não traz previsto, abonado e saldo')

    const semData = montarFolha({
      empresa: EMPRESA,
      funcionario,
      mes: MES,
      batidas: BATIDAS,
      regras: semFeriado(regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: null }, HOJE)),
    })
    expect(semData.saldo).toBeNull()
    expect(semData.semSaldo).toBe(
      'Esta folha não traz previsto, abonado e saldo: a ficha desta pessoa não tem a data em que ela passou a bater ponto aqui, então nenhum dia é cobrado.',
    )
  })
})

describe('a folha quando o saldo começa no meio do mês', () => {
  // A ficha é antiga; a "Saldo calculado a partir de" é 15/10, e ela ganha.
  const regras = semFeriado(
    regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: '2026-10-15' }, { jornada: null, batePontoDesde: '2025-03-10' }, HOJE),
  )
  const folha = montarFolha({ empresa: EMPRESA, funcionario, mes: MES, batidas: BATIDAS, ausencias: AUSENCIAS, regras })

  it('os dias antes do dia 15 ficam sem previsto, saldo e falta; o abono deles ainda soma no total com abono', () => {
    const antes = folha.linhas.filter((l) => l.dia < '2026-10-15')
    expect(antes.length).toBeGreaterThan(0)
    for (const l of antes) {
      expect(l.saldo).toMatchObject({ estado: 'fora', previsto: '', saldo: '' })
      expect(l.falta).toBe(false)
      expect(l.marcas.filter((marca) => marca === 'Falta' || marca === 'Dia sem jornada' || marca.startsWith('Atraso'))).toEqual([])
    }
    expect(linhaDa(folha, 14)?.saldo?.abonado).toBe('8h00')
    expect(linhaDa(folha, 15)?.saldo).toEqual({ estado: 'cobranca', previsto: '8h00', abonado: '', saldo: '−0h25' })
    expect(folha.linhas.filter((l) => l.falta).map((l) => l.dia)).toEqual(['2026-10-20'])
    expect(folha.abono?.total).toBe('152h35')
  })

  it('o resumo é o da conta com a data nova, e a folha diz, perto dele, a partir de que dia o saldo conta', () => {
    expect(folha.saldo?.resumo).toEqual(calcularSaldoDoMes(MES, BATIDAS, AUSENCIAS, regras).resumo)
    expect(folha.saldo).toMatchObject({ extras: '0h00', negativas: '−12h25', faltas: '1 dia', saldo: '−12h25', previsto: '80h00' })
    expect(folha.saldo?.notaDoInicio).toBe(
      `Saldo calculado a partir de ${dataBrasileira('2026-10-15')}. Os dias antes dessa data ficam fora do saldo.`,
    )
    const html = corrido(papel(folha))
    const frase = html.indexOf('Saldo calculado a partir de 15/10/2026. Os dias antes dessa data ficam fora do saldo.')
    expect(frase).toBeGreaterThan(html.indexOf('Resumo do mês'))
    expect(frase).toBeLessThan(html.indexOf('Previsto, abonado e saldo:'))
    // O mês que começa no primeiro dia cobrado não traz a frase.
    expect(corrido(papel(FOLHA))).not.toContain('Saldo calculado a partir de')
  })

  it('o total da coluna Abonado soma a coluna inteira, os dias de antes inclusive, e é o abono do total com abono', () => {
    // A falta justificada de 12/10 e o atestado de 14/10 são de antes do dia 15: estão na coluna e no alto.
    expect(linhaDa(folha, 12)?.saldo).toMatchObject({ estado: 'fora', abonado: '8h00' })
    expect(somaDaColunaAbonado(folha)).toBe(44 * 60 + 30)
    expect(folha.abono?.minutos).toBe(somaDaColunaAbonado(folha))
    expect(folha.saldo?.abonadoDaColuna).toBe('44h30')
    // O resumo do saldo não muda: soma só os dias cobrados, como a tela ("Previsto 80h00 · Abonado 28h30").
    expect(formatarDuracao(folha.saldo?.resumo.abonado ?? 0)).toBe('28h30')
    const html = papel(folha)
    expect(totalDaTabela(html)).toEqual(['Total do mês', '108h05', '80h00', '44h30', '−12h25'])
    expect(corrido(html)).toContain('108h05 trabalhadas + 44h30 abonadas')
    expect(valorDoResumo(html, 'Saldo do mês')).toBe('−12h25')
  })

  it('com o mês inteiro antes do primeiro dia cobrado, a folha sai sem as colunas do saldo e diz que nenhum dia do mês entra', () => {
    // Quem passou a bater ponto aqui em 03/11 não tem dia cobrado em outubro.
    const depois = montarFolha({
      empresa: EMPRESA,
      funcionario,
      mes: MES,
      batidas: BATIDAS,
      ausencias: AUSENCIAS,
      regras: semFeriado(regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: '2026-11-03' }, '2026-11-03')),
    })
    expect(depois.saldo).toBeNull()
    expect(depois.semSaldo).toBe(
      'Esta folha não traz previsto, abonado e saldo: o saldo é calculado a partir de 03/11/2026, e nenhum dia deste mês entra nele.',
    )
    expect(depois.linhas.every((l) => l.saldo === null && !l.falta)).toBe(true)
    const html = papel(depois)
    expect(html).toContain('>Observações</th>')
    expect(html).not.toContain('Resumo do mês')
    expect(corrido(html)).toContain('nenhum dia deste mês entra nele.')
  })
})

describe('a coluna Abonado da folha no dia incompleto e no de hoje', () => {
  /*
   * A cobrança começa na segunda 26/10 (a data da ficha), e hoje é sexta, 30/10:
   *   22 (antes da cobrança)  08:00, 12:00, 13:00 e atestado 14:00-17:00: incompleto
   *   27 (pendente)           08:00, 12:00, 13:00 e atestado 14:00-17:00: incompleto
   *   28                      atestado do dia inteiro: 8h00
   *   30 (hoje)               08:00, 12:00, 13:00 e atestado 15:00-17:00: incompleto
   */
  const regras = semFeriado(regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: '2026-10-26' }, HOJE))
  const batidas = ['22', '27', '30'].flatMap((dia) => batidasDoDia(`2026-10-${dia}`, '08:00', '12:00', '13:00'))
  const ausencias = [
    porHorario('i-22', '2026-10-22', '14:00', '17:00'),
    porHorario('i-27', '2026-10-27', '14:00', '17:00'),
    ausencia('i-28', { dia_inicio: '2026-10-28', dia_fim: '2026-10-28' }),
    porHorario('i-30', '2026-10-30', '15:00', '17:00'),
  ]
  const mes = calcularSaldoDoMes(MES, batidas, ausencias, regras)
  const folha = montarFolha({ empresa: EMPRESA, funcionario, mes: MES, batidas, ausencias, regras })

  it('o dia incompleto deixa a célula em branco (antes da cobrança, pendente ou hoje), como o total do dia da tela', () => {
    // A conta vê o abono dos três dias; ele só não soma no total enquanto falta batida.
    expect([22, 27, 30].map((dia) => saldoDe(dia, mes.dias)).map((s) => [s.estado, s.incompleto, s.abonado])).toEqual([
      ['fora', true, 180],
      ['pendente', true, 180],
      ['em_andamento', true, 120],
    ])
    expect(linhaDa(folha, 22)?.saldo).toEqual({ estado: 'fora', previsto: '', abonado: '', saldo: '' })
    expect(linhaDa(folha, 27)?.saldo).toEqual({ estado: 'pendente', previsto: '8h00', abonado: '', saldo: 'pendente' })
    expect(linhaDa(folha, 30)?.saldo).toEqual({ estado: 'em_andamento', previsto: '8h00', abonado: '', saldo: 'em andamento' })
    // A tela também não soma: o total do dia pendente é o trabalhado dele, zero.
    expect(corrido(desenhar(createElement(TotalDoDia, { trabalhado: 0, saldo: saldoDe(27, mes.dias) })))).toBe('0h00')
    // A marca da ausência continua no dia, com a do incompleto.
    expect(linhaDa(folha, 27)?.marcas).toEqual(['Atestado 14:00-17:00 (atestado anexado)', 'Incompleto: fora do total, saldo pendente'])
  })

  it('a coluna, o total dela e o total com abono dizem o mesmo número: só o atestado de 28/10', () => {
    expect(somaDaColunaAbonado(folha)).toBe(480)
    expect(folha.abono).toEqual({ minutos: 480, total: '8h00', composicao: '0h00 trabalhadas + 8h00 de atestado' })
    expect(folha.saldo?.abonadoDaColuna).toBe('8h00')
    // Previsto e saldo do resumo: 26, 28 e 29 (26 e 29 são faltas).
    expect(totalDaTabela(papel(folha))).toEqual(['Total do mês', '0h00', '24h00', '8h00', '−16h00'])
  })

  it('hoje com o par fechado e atestado à tarde: a célula, o total da coluna e o alto somam o abono de hoje; o resumo não', () => {
    const deHoje = batidasDoDia('2026-10-30', '08:00', '12:00')
    const comHoje = [ausencias[2], porHorario('h-30', '2026-10-30', '13:00', '17:00')]
    const folhaDeHoje = montarFolha({ empresa: EMPRESA, funcionario, mes: MES, batidas: deHoje, ausencias: comHoje, regras })
    expect(linhaDa(folhaDeHoje, 30)?.saldo).toEqual({ estado: 'em_andamento', previsto: '8h00', abonado: '4h00', saldo: 'em andamento' })
    expect(somaDaColunaAbonado(folhaDeHoje)).toBe(12 * 60)
    expect(folhaDeHoje.abono?.minutos).toBe(12 * 60)
    expect(folhaDeHoje.saldo?.abonadoDaColuna).toBe('12h00')
    // Hoje fica fora do saldo do mês, e o abonado do resumo é só o de 28/10.
    expect(formatarDuracao(folhaDeHoje.saldo?.resumo.abonado ?? 0)).toBe('8h00')
  })
})

/* ------------------------------------------------------------------ */
/* O CSV                                                               */
/* ------------------------------------------------------------------ */

/** Lê o CSV como uma planilha leria: aspas da RFC 4180, `;` e CRLF. */
function lerCsv(csv: string): string[][] {
  const linhas: string[][] = []
  let campo = ''
  let linhaAtual: string[] = []
  let entreAspas = false
  const texto = csv.replace(/^\uFEFF/, '')
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"'
        i += 1
      } else if (c === '"') entreAspas = false
      else campo += c
    } else if (c === '"') entreAspas = true
    else if (c === SEPARADOR) {
      linhaAtual.push(campo)
      campo = ''
    } else if (c === '\r' && texto[i + 1] === '\n') {
      linhaAtual.push(campo)
      linhas.push(linhaAtual)
      linhaAtual = []
      campo = ''
      i += 1
    } else campo += c
  }
  return linhas
}

/** `8:00` -> 480, `-0:25` -> -25: a duração da planilha em minutos, com o sinal. */
function minutosDaPlanilha(valor: string): number {
  const [horas, minutos] = valor.replace(/^-/, '').split(':').map(Number)
  return (valor.startsWith('-') ? -1 : 1) * (horas * 60 + minutos)
}

describe('o CSV com o saldo', () => {
  const saldos = calcularSaldoDoPeriodo(OUTUBRO.inicio, OUTUBRO.fim, BATIDAS, AUSENCIAS, REGRAS).dias
  const pessoa = { ...funcionario, batidas: BATIDAS, ausencias: DO_MES, saldos }
  const csv = gerarCsvDoPeriodo([pessoa])
  const [cabecalho, ...linhas] = lerCsv(csv)
  const col = (nome: (typeof CABECALHO)[number]) => CABECALHO.indexOf(nome)
  /** A linha que fecha o dia: a última dele. */
  const fecha = (dia: number) => linhas.filter((l) => l[col('Data')] === `${String(dia).padStart(2, '0')}/10/2026`).at(-1)
  const soma = (nome: (typeof CABECALHO)[number]) =>
    linhas.map((l) => l[col(nome)]).filter(Boolean).reduce((total, valor) => total + minutosDaPlanilha(valor), 0)

  it('as 18 primeiras colunas são as de hoje: o cabeçalho e as linhas de um dia de batida, campo por campo', () => {
    expect(cabecalho.slice(0, COLUNAS_ANTES_DO_SALDO)).toEqual([
      'Funcionário',
      'E-mail',
      'Data',
      'Dia da semana',
      'Hora',
      'Tipo',
      'Ordem no dia',
      'Origem',
      'Ajuste manual',
      'Motivo do ajuste',
      'Local',
      'Distância (m)',
      'Precisão (m)',
      'Selfie',
      'Batidas no dia',
      'Dia incompleto',
      'Horas do dia',
      'Horas do dia (decimal)',
    ])
    const doDia = (hora: string, tipo: string, ordem: string, fechamento: string[]) => [
      'Bruna Costa',
      'bruna@example.com',
      '01/10/2026',
      'quinta-feira',
      hora,
      tipo,
      ordem,
      'App',
      'NÃO',
      '',
      'No local',
      '3,00',
      '12',
      'SIM',
      ...fechamento,
    ]
    const emBranco = ['', '', '', '']
    expect(linhas.filter((l) => l[col('Data')] === '01/10/2026').map((l) => l.slice(0, COLUNAS_ANTES_DO_SALDO))).toEqual([
      doDia('08:00', 'Entrada', '1', emBranco),
      doDia('12:00', 'Saída para o almoço', '2', emBranco),
      doDia('13:00', 'Volta do almoço', '3', emBranco),
      // Só a última batida fecha o dia, como sempre.
      doDia('17:00', 'Saída', '4', ['4', 'NÃO', '8:00', '8,00']),
    ])
    // O texto cru da linha começa como sempre começou, com o `;` e sem aspas.
    expect(csv.split(FIM_DE_LINHA)[1]).toMatch(/^Bruna Costa;bruna@example\.com;01\/10\/2026;quinta-feira;08:00;Entrada;1;App;NÃO;;No local;3,00;12;SIM;;;;;/)
  })

  it('as 9 colunas do saldo vêm no fim, e toda linha tem 27 campos', () => {
    expect(cabecalho).toEqual([...CABECALHO])
    expect(CABECALHO.slice(COLUNAS_ANTES_DO_SALDO)).toEqual([
      'Previsto do dia',
      'Abonado do dia',
      'Saldo do dia',
      'Crédito do dia',
      'Débito do dia',
      'Falta no dia',
      'Atraso do dia',
      'Ausências do dia',
      'Estado do dia',
    ])
    for (const l of linhas) expect(l).toHaveLength(27)
    expect(csv.endsWith(FIM_DE_LINHA)).toBe(true)
  })

  it('o total trabalhado é o do espelho, e créditos, débitos e saldos somam o resumo do mês', () => {
    expect(soma('Horas do dia')).toBe(ESPELHO.minutos)
    expect(soma('Crédito do dia')).toBe(SALDO.resumo.credito)
    expect(soma('Débito do dia')).toBe(SALDO.resumo.debito)
    expect(soma('Saldo do dia')).toBe(SALDO.resumo.saldo)
    expect(soma('Previsto do dia')).toBe(SALDO.resumo.previsto + 480 + 480) // + o pendente (19) e hoje (30)
  })

  it('cada dia fecha uma vez só, inclusive o de duas ausências por horário', () => {
    const dia28 = linhas.filter((l) => l[col('Data')] === '28/10/2026')
    expect(dia28.map((l) => l[col('Tipo')])).toEqual([
      TIPO_DA_LINHA_DE_AUSENCIA,
      TIPO_DA_LINHA_DE_AUSENCIA,
      'Entrada',
      'Saída para o almoço',
      'Volta do almoço',
      'Saída',
      'Batida extra',
      'Batida extra',
    ])
    expect(dia28.filter((l) => l[col('Previsto do dia')] !== '')).toHaveLength(1)
    expect(dia28.filter((l) => l[col('Horas do dia')] !== '')).toHaveLength(1)
  })

  it('os 6 critérios, na linha que fecha o dia', () => {
    // Previsto, abonado, saldo, crédito, débito, falta, atraso.
    const saldo = (dia: number) => fecha(dia)?.slice(COLUNAS_ANTES_DO_SALDO, COLUNAS_ANTES_DO_SALDO + 7)
    expect(saldo(14)).toEqual(['8:00', '8:00', '0:00', '0:00', '0:00', 'NÃO', '0:00'])
    for (const dia of [21, 22, 23]) expect(saldo(dia)).toEqual(['8:00', '8:00', '0:00', '0:00', '0:00', 'NÃO', '0:00'])
    expect(fecha(24)).toBeUndefined()
    expect(saldo(26)).toEqual(['8:00', '2:00', '0:00', '0:00', '0:00', 'NÃO', '0:00'])
    expect(fecha(26)?.[col('Horas do dia')]).toBe('6:00')
    expect(fecha(26)?.[col('Ausências do dia')]).toBe('Atestado 14:00-16:00 (atestado anexado)')
    expect(saldo(27)?.slice(0, 3)).toEqual(['8:00', '0:30', '0:00'])
    expect(saldo(28)?.slice(0, 3)).toEqual(['8:00', '2:00', '0:00'])
    expect(fecha(28)?.[col('Ausências do dia')]).toBe('Atestado 08:00-09:00 (atestado anexado) · Atestado 15:00-16:00 (atestado anexado)')
    expect(saldo(29)).toEqual(['8:00', '0:00', '-2:00', '0:00', '2:00', 'NÃO', '0:00'])
    expect(fecha(29)?.[col('Ausências do dia')]).toBe('')
    for (const dia of [14, 26, 27, 28, 29]) expect(fecha(dia)?.[col('Estado do dia')]).toBe('Fechado')
  })

  it('a falta vira linha própria; o pendente e hoje ficam sem saldo; o atraso e o "outro motivo" aparecem', () => {
    const dia20 = linhas.filter((l) => l[col('Data')] === '20/10/2026')
    expect(dia20).toHaveLength(1)
    expect(dia20[0][col('Tipo')]).toBe(TIPO_DA_LINHA_DE_FALTA)
    expect(dia20[0][col('Hora')]).toBe('')
    expect(dia20[0][col('Batidas no dia')]).toBe('0')
    expect(dia20[0][col('Horas do dia')]).toBe('0:00')
    expect(dia20[0][col('Falta no dia')]).toBe('SIM')
    expect(dia20[0][col('Saldo do dia')]).toBe('-8:00')
    expect(dia20[0][col('Débito do dia')]).toBe('8:00')
    expect(dia20[0][col('Estado do dia')]).toBe('Fechado')

    expect(fecha(19)?.slice(COLUNAS_ANTES_DO_SALDO)).toEqual(['8:00', '0:00', '', '', '', '', '', '', 'Saldo pendente'])
    expect(fecha(30)?.slice(COLUNAS_ANTES_DO_SALDO)).toEqual(['8:00', '0:00', '', '', '', '', '', '', 'Em andamento'])
    expect(fecha(15)?.[col('Atraso do dia')]).toBe('0:25')
    expect(fecha(15)?.[col('Saldo do dia')]).toBe('-0:25')
    expect(fecha(16)?.[col('Ausências do dia')]).toBe('Outro motivo 08:00-10:00: reunião na escola do filho')
    expect(fecha(16)?.[col('Abonado do dia')]).toBe('0:00')
    expect(fecha(16)?.[col('Atraso do dia')]).toBe('2:00')
    // O sábado: o que se trabalhou é saldo positivo, sem previsto.
    expect(fecha(10)?.slice(COLUNAS_ANTES_DO_SALDO, COLUNAS_ANTES_DO_SALDO + 4)).toEqual(['0:00', '0:00', '4:00', '4:00'])
    // O futuro (31) não tem linha: nada aconteceu nele.
    expect(fecha(31)).toBeUndefined()
  })

  it('o saldo negativo sai com o menos comum, como número: a neutralização não o toca, e o positivo vai sem sinal', () => {
    expect(fecha(29)?.[col('Saldo do dia')].charCodeAt(0)).toBe(0x2d)
    expect(neutralizarFormula('-8:00')).toBe('-8:00')
    expect(fecha(13)?.[col('Saldo do dia')]).toBe('1:00')
    // Na planilha, as células do saldo são todas número: nenhuma ganhou o apóstrofo nem o "−" das telas.
    const doSaldo = linhas.map((l) => l[col('Saldo do dia')]).filter(Boolean)
    expect(doSaldo.length).toBeGreaterThan(0)
    for (const celula of doSaldo) expect(celula).toMatch(/^-?\d+:\d{2}$/)
  })

  it('nenhuma célula começa com sinal de fórmula sem o apóstrofo; a que começa com "-" é número', () => {
    const todas = [cabecalho, ...linhas].flat()
    expect(todas.filter((celula) => /^[=+@\t\r]/.test(celula))).toEqual([])
    expect(todas.filter((celula) => celula.startsWith('-')).every((celula) => /^-\d+:\d{2}$/.test(celula))).toBe(true)
    expect(csv).not.toMatch(/[\u2013\u2014\u2212]/)
  })

  it('sem o saldo, as colunas novas ficam em branco (menos as ausências) e as 18 de antes são as mesmas', () => {
    const sem = lerCsv(gerarCsvDoPeriodo([{ ...pessoa, saldos: undefined }])).slice(1)
    const antes = (l: string[]) => l.slice(0, COLUNAS_ANTES_DO_SALDO)
    // Sem a conta, só a linha da falta (20/10) some.
    expect(linhas.filter((l) => l[col('Tipo')] !== TIPO_DA_LINHA_DE_FALTA).map(antes)).toEqual(sem.map(antes))
    for (const l of sem) {
      const novas = l.slice(COLUNAS_ANTES_DO_SALDO)
      expect([...novas.slice(0, 7), novas[8]].every((celula) => celula === '')).toBe(true)
    }
    expect(sem.find((l) => l[col('Data')] === '14/10/2026')?.[col('Ausências do dia')]).toBe('Atestado, dia inteiro (atestado anexado)')
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

  it('na folha, com as colunas do saldo: o alto diz o total com abono, e o feriado trabalhado diz "Feriado"', () => {
    const folha = montarFolha({ empresa: null, funcionario, mes: MES, batidas: doDia, ausencias: atestados, regras: comFeriados })
    expect(folha.total).toBe('10h01')
    expect(folha.abono).toEqual({ minutos: 59, total: '11h00', composicao: '10h01 trabalhadas + 0h59 de atestado' })
    expect(linhaDa(folha, 6)?.saldo?.abonado).toBe('0h59')
    expect(linhaDa(folha, 6)?.marcas).toEqual(['Atestado 15:00-16:00'])
    expect(linhaDa(folha, 12)?.marcas).toEqual(['Feriado: Nossa Senhora Aparecida'])
    expect(linhaDa(folha, 12)?.saldo).toMatchObject({ previsto: '0h00', saldo: '+4h00' })
    expect(folha.legenda).toMatchObject({ feriado: true, abono: true })
    const html = corrido(papel(folha))
    expect(html).toContain('Total com abono')
    expect(html).toContain('11h00')
    expect(html).toContain('10h01 trabalhadas + 0h59 de atestado')
    expect(html).toContain('Feriado: Nossa Senhora Aparecida')
    expect(html).toContain('Feriado: feriado nacional. É dia sem jornada, como o sábado e o domingo')
    // A tabela continua com o "Total do mês" das batidas.
    expect(html).toContain('Total do mês')
  })

  it('na folha, sem a data na ficha: sem as colunas do saldo, mas com o total com abono e a marca "Abonado" no dia', () => {
    const regras = regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: null }, HOJE)
    const folha = montarFolha({ empresa: null, funcionario, mes: MES, batidas: doDia, ausencias: atestados, regras })
    expect(folha.saldo).toBeNull()
    expect(folha.semSaldo).toContain('não tem a data em que ela passou a bater ponto aqui')
    expect(folha.abono?.total).toBe('11h00')
    expect(linhaDa(folha, 6)?.saldo).toBeNull()
    expect(linhaDa(folha, 6)?.marcas).toEqual(['Atestado 15:00-16:00', 'Abonado 0h59'])
    expect(linhaDa(folha, 12)?.marcas).toEqual(['Feriado: Nossa Senhora Aparecida'])
    // Mês sem abono: o alto da folha é o "Total do mês" de sempre.
    const semAbono = montarFolha({ empresa: null, funcionario, mes: MES, batidas: doDia, regras: comFeriados })
    expect(semAbono.abono).toBeNull()
    expect(papel(semAbono)).not.toContain('Total com abono')
  })

  it('no CSV, o abonado do dia aparece mesmo fora da cobrança', () => {
    const regras = regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: null }, HOJE)
    const saldos = calcularSaldoDoPeriodo(OUTUBRO.inicio, OUTUBRO.fim, doDia, atestados, regras).dias
    const [cabecalho, ...linhas] = lerCsv(
      gerarCsvDoPeriodo([{ ...funcionario, batidas: doDia, ausencias: ausenciasPorDia(atestados, OUTUBRO), saldos }]),
    )
    const col = (nome: string) => cabecalho.indexOf(nome)
    const doDia06 = linhas.filter((l) => l[col('Data')] === '06/10/2026').at(-1)
    expect(doDia06?.[col('Abonado do dia')]).toBe('0:59')
    expect(doDia06?.[col('Estado do dia')]).toBe('Não cobrado')
    expect(doDia06?.[col('Saldo do dia')]).toBe('')
    expect(doDia06?.[col('Previsto do dia')]).toBe('')
  })
})
