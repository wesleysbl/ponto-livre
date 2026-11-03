import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ausencia } from './lib/ausencias'
import type { BatidaDoAdmin } from './lib/formato'
import type { FuncionarioDoPainel } from './lib/painel'
import type { SaldoDoDia } from './lib/saldo'

/*
 * O SALDO NAS TELAS, no desenho de `telas-de-ausencias.test.ts`: em Node, com
 * `renderToString`, o Supabase simulado levantando se o DESENHO tentar ler o
 * banco, e qualquer `console.error` reprovando.
 *
 * O CENÁRIO: outubro de 2026, a jornada da semente (seg a sex, 08:00-12:00 e
 * 13:00-17:00), tolerância de 10 min, a ficha diz que a pessoa passou a bater
 * ponto aqui em 01/10, a "Saldo calculado a partir de" é a mesma data e "hoje"
 * é 28/10 (quarta). As regras saem de `regrasDoSaldo`, como nas telas. 26/10 é
 * segunda.
 *   • 26/10: atestados 08:00-10:00 e 15:00-17:00, trabalho 10-12 e 13-15
 *     (quatro batidas): abonado 4h00, saldo 0h00.
 *   • 27/10: 3 batidas (esqueceu a saída): saldo pendente.
 *   • 28/10: hoje, só a entrada: em andamento.
 *   • 24/10: sábado, 08-12 trabalhado: hora extra em dia sem jornada.
 *   • 12/10: o feriado nacional de Nossa Senhora Aparecida, sem batida.
 * A prova de que o espelho e o painel da pessoa mostram o mesmo saldo nas
 * telas de verdade (com as leituras) está na fumaça das rotas.
 */

vi.mock('./lib/supabase', () => ({
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

const { DiaDoEspelho } = await import('./components/DiaDoEspelho')
const { DiaDoPainel, DiaSemBatida } = await import('./components/DiaDoPainel')
const { DiaDeAusencia } = await import('./components/DiaDeAusencia')
const { ComposicaoDoTotal, LinhaDoSaldo, ResumoDoSaldoNaTela, TotalDoDia } = await import(
  './components/SaldoDoDia'
)
const { LinhaDeFuncionario } = await import('./pages/Painel')
const { abonadoNoTotal, calcularSaldoDoMes, calcularSaldoDoPeriodo, regrasDoSaldo } = await import('./lib/saldo')
const { JORNADA_SEMENTE } = await import('./lib/jornada')
const { ausenciasPorPessoa } = await import('./lib/ausencias')
const { montarLinhasDoPainel } = await import('./lib/painel')

/* ------------------------------------------------------------------ */

let errosDoConsole: unknown[][] = []

beforeEach(() => {
  errosDoConsole = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errosDoConsole.push(args)
  })
})

afterEach(() => {
  expect(errosDoConsole).toEqual([])
  vi.restoreAllMocks()
})

function desenhar(elemento: ReactElement): string {
  return renderToString(createElement(MemoryRouter, null, elemento))
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

/** O texto como o navegador o mostra (`textContent`): as tags somem sem deixar espaço. */
function corrido(html: string): string {
  return texto(html.replace(/<[^>]+>/g, ''))
}

const nada = () => {}

/** A configuração como `lerConfiguracao` a entrega, só com o que o saldo lê. */
const CONFIGURACAO = { jornada: JORNADA_SEMENTE, toleranciaMinutos: 10, saldoAPartirDe: '2026-10-01' }
const FICHA = { jornada: null, batePontoDesde: '2026-10-01' }
const HOJE = '2026-10-28'
const REGRAS = regrasDoSaldo(CONFIGURACAO, FICHA, HOJE)

const TIPOS = ['entrada', 'saida_almoco', 'volta_almoco', 'saida'] as const

function batidasDoDia(dia: string, ...horas: string[]): BatidaDoAdmin[] {
  return horas.map((hora, indice) => ({
    id: `b-${dia}-${hora}`,
    usuario_id: 'u1',
    registrado_em: `${dia}T${hora}:00.000-03:00`,
    dia_civil: dia,
    tipo: TIPOS[indice] ?? 'extra',
    ordem_no_dia: indice + 1,
    // No local fictício do elenco (centro de São Paulo).
    latitude: -23.55052,
    longitude: -46.633308,
    precisao_metros: 10,
    distancia_metros: 20,
    no_local: true,
    selfie_path: null,
    ajuste_manual: false,
    origem: 'app',
    motivo_ajuste: null,
    funcionario_nome: 'Fulana',
    funcionario_email: 'fulana@example.com',
    pedido_atraso_id: null,
  }))
}

function porHorario(id: string, dia: string, inicio: string, fim: string, extras: Partial<Ausencia> = {}): Ausencia {
  return {
    id,
    usuario_id: 'u1',
    dia_inicio: dia,
    dia_fim: dia,
    tipo: 'atestado_medico',
    modalidade: 'horario',
    hora_inicio: `${inicio}:00`,
    hora_fim: `${fim}:00`,
    observacao: null,
    atestado_path: null,
    lancado_por: 'admin-1',
    lancado_em: '2026-10-26T20:00:00.000Z',
    cancelada_em: null,
    cancelada_por: null,
    motivo_cancelamento: null,
    ...extras,
  }
}

function porDias(id: string, dia: string, extras: Partial<Ausencia> = {}): Ausencia {
  return porHorario(id, dia, '08:00', '17:00', { modalidade: 'dias', hora_inicio: null, hora_fim: null, ...extras })
}

const AUSENCIAS: Ausencia[] = [
  // De propósito fora de ordem: a marca da tarde não pode vir antes da da manhã.
  porHorario('a-tarde', '2026-10-26', '15:00', '17:00'),
  porHorario('a-manha', '2026-10-26', '08:00', '10:00'),
]

const BATIDAS: BatidaDoAdmin[] = [
  ...batidasDoDia('2026-10-24', '08:00', '12:00'),
  ...batidasDoDia('2026-10-26', '10:00', '12:00', '13:00', '15:00'),
  ...batidasDoDia('2026-10-27', '08:00', '12:00', '13:00'),
  ...batidasDoDia('2026-10-28', '08:00'),
]

const MES = calcularSaldoDoMes('2026-10', BATIDAS, AUSENCIAS, REGRAS)
const saldoDe = (dia: string, recorte: { dias: readonly SaldoDoDia<BatidaDoAdmin>[] } = MES) => {
  const saldo = recorte.dias.find((umDia) => umDia.dia === dia)
  if (!saldo) throw new Error(`sem saldo para ${dia}`)
  return saldo
}

/* ------------------------------------------------------------------ */

describe('um dia com duas ausências por horário e trabalho entre elas', () => {
  const saldo = saldoDe('2026-10-26')

  it('a conta: quatro batidas, duas coberturas, abonado 4h00 e saldo 0', () => {
    expect(saldo.espelho.batidas).toHaveLength(4)
    expect(saldo.coberturas).toHaveLength(2)
    expect(saldo).toMatchObject({ estado: 'cobranca', previsto: 480, trabalhado: 240, abonado: 240, saldo: 0 })
  })

  it('no espelho de quem bate: as quatro batidas e as duas marcas, em ordem, com o saldo do dia e o total com abono', () => {
    const cru = desenhar(
      createElement(DiaDoEspelho, {
        dia: saldo.espelho,
        aoAbrirSelfie: nada,
        ausencias: AUSENCIAS,
        aoAbrirAtestado: nada,
        saldo,
      }),
    )
    const html = corrido(cru)
    for (const hora of ['10:00', '12:00', '13:00', '15:00']) expect(html).toContain(hora)
    expect(html).toContain('4 batidas')
    expect(html).toContain('Atestado 08:00-10:00 · abonou 2h00')
    expect(html).toContain('Atestado 15:00-17:00 · abonou 2h00')
    expect(html.indexOf('Atestado 08:00-10:00')).toBeLessThan(html.indexOf('Atestado 15:00-17:00'))
    const partes = texto(cru)
    expect(partes).toContain('Previsto 8h00')
    expect(partes).toContain('Abonado 4h00')
    expect(partes).toContain('Saldo 0h00')
    // O total do cabeçalho soma o abono, com a conta embaixo.
    expect(partes).toContain('8h00 4h00 trabalhadas + 4h00 de atestado')
    // O intervalo de cada marca fica inteiro numa linha.
    expect(cru).toContain('<span class="whitespace-nowrap">08:00-10:00</span>')
    expect(cru).toContain('<span class="whitespace-nowrap">15:00-17:00</span>')
  })

  it('no painel da pessoa: o mesmo dia, as mesmas batidas, as mesmas marcas e os mesmos números', () => {
    const cru = desenhar(
      createElement(DiaDoPainel, {
        dia: saldo.espelho,
        aoAbrirSelfie: nada,
        aoCorrigir: nada,
        aoInserirNesteDia: nada,
        ausencias: AUSENCIAS,
        aoAbrirAtestado: nada,
        saldo,
      }),
    )
    const html = texto(cru)
    // Cada batida continua sendo um botão de corrigir.
    for (const hora of ['10:00', '12:00', '13:00', '15:00']) {
      expect(cru).toContain(`aria-label="Corrigir a batida das ${hora}"`)
    }
    expect(corrido(cru)).toContain('Atestado 08:00-10:00 · abonou 2h00')
    expect(corrido(cru)).toContain('Atestado 15:00-17:00 · abonou 2h00')
    expect(html).toContain('Previsto 8h00')
    expect(html).toContain('Abonado 4h00')
    expect(html).toContain('Saldo 0h00')
    expect(html).toContain('4h00 trabalhadas + 4h00 de atestado')
  })
})

describe('o dia incompleto, hoje, o dia sem jornada e o feriado', () => {
  it('dia passado com 3 batidas: "Incompleto: saldo pendente", sem débito, e as 3 batidas à vista', () => {
    const saldo = saldoDe('2026-10-27')
    for (const elemento of [
      createElement(DiaDoEspelho, { dia: saldo.espelho, aoAbrirSelfie: nada, saldo }),
      createElement(DiaDoPainel, {
        dia: saldo.espelho,
        aoAbrirSelfie: nada,
        aoCorrigir: nada,
        aoInserirNesteDia: nada,
        saldo,
      }),
    ]) {
      const html = texto(desenhar(elemento))
      expect(html).toContain('Incompleto: saldo pendente')
      expect(html).toContain('Previsto 8h00')
      expect(html).not.toMatch(/Saldo [+−]/)
      for (const hora of ['08:00', '12:00', '13:00']) expect(html).toContain(hora)
    }
  })

  it('hoje: "em andamento", nunca a conta parcial como débito', () => {
    const saldo = saldoDe('2026-10-28')
    expect(saldo.saldoBruto).toBeLessThan(0)
    for (const elemento of [
      createElement(DiaDoEspelho, { dia: saldo.espelho, aoAbrirSelfie: nada, ehHoje: true, saldo }),
      createElement(DiaDoPainel, {
        dia: saldo.espelho,
        aoAbrirSelfie: nada,
        aoCorrigir: nada,
        aoInserirNesteDia: nada,
        ehHoje: true,
        saldo,
      }),
    ]) {
      const html = texto(desenhar(elemento))
      expect(html).toContain('Saldo: em andamento')
      expect(html).not.toContain('−')
      expect(html).not.toContain('saldo pendente')
    }
  })

  it('o sábado trabalhado é hora extra com nome próprio: "Dia sem jornada" e "Hora extra +4h00"', () => {
    const saldo = saldoDe('2026-10-24')
    const html = texto(desenhar(createElement(LinhaDoSaldo, { saldo })))
    expect(html).toContain('Dia sem jornada')
    expect(html).toContain('Hora extra +4h00')
    expect(html).not.toContain('Previsto')
  })

  it('o feriado nacional é dia sem jornada no saldo: sem previsto e sem falta, e o trabalho nele é hora extra', () => {
    const vazio = saldoDe('2026-10-12')
    expect(vazio).toMatchObject({ feriado: 'Nossa Senhora Aparecida', semJornada: true, previsto: 0, falta: false })
    expect(texto(desenhar(createElement(LinhaDoSaldo, { saldo: vazio })))).toBe(' Feriado ')
    // A linha do dia sem batida não fala de saldo no feriado, como no domingo.
    const linha = texto(
      desenhar(
        createElement(DiaSemBatida, {
          dia: '2026-10-12',
          feriado: vazio.feriado,
          aoInserirNesteDia: nada,
          aoLancarFaltaNesteDia: nada,
          saldo: vazio,
        }),
      ),
    )
    expect(linha).toContain('feriado · Nossa Senhora Aparecida')
    expect(linha).not.toContain('Falta')
    expect(linha).not.toContain('Previsto')
    expect(linha).not.toContain('Saldo')

    const trabalhado = calcularSaldoDoMes('2026-10', batidasDoDia('2026-10-12', '08:00', '12:00'), [], REGRAS)
    const html = texto(desenhar(createElement(LinhaDoSaldo, { saldo: saldoDe('2026-10-12', trabalhado) })))
    expect(html).toContain('Feriado')
    expect(html).toContain('Hora extra +4h00')
    expect(html).not.toContain('Dia sem jornada')
    // O mês sem o feriado (os testes de mês sem feriado passam `() => null`) cobraria o dia como falta.
    const semFeriado = calcularSaldoDoMes('2026-10', [], [], { ...REGRAS, feriadoDoDia: () => null })
    expect(saldoDe('2026-10-12', semFeriado)).toMatchObject({ falta: true, debito: 480 })
    expect(MES.resumo.faltas).toBeLessThan(semFeriado.resumo.faltas)
  })

  it('o dia útil sem nada no painel mostra a falta e o débito dela; o domingo vazio, nada', () => {
    const terca = texto(
      desenhar(
        createElement(DiaSemBatida, {
          dia: '2026-10-20',
          aoInserirNesteDia: nada,
          aoLancarFaltaNesteDia: nada,
          saldo: saldoDe('2026-10-20'),
        }),
      ),
    )
    expect(terca).toContain('Falta')
    expect(terca).toContain('Saldo −8h00')
    expect(terca).toContain('Inserir batida neste dia')
    expect(terca).toContain('Lançar falta neste dia')
    const domingo = texto(
      desenhar(
        createElement(DiaSemBatida, {
          dia: '2026-10-25',
          fimDeSemana: true,
          aoInserirNesteDia: nada,
          aoLancarFaltaNesteDia: nada,
          saldo: saldoDe('2026-10-25'),
        }),
      ),
    )
    expect(domingo).not.toContain('Saldo')
    expect(domingo).not.toContain('Previsto')
  })

  it('no espelho de quem bate, o dia de falta é a mesma linha, com "Falta" e o débito, e sem os botões de quem administra', () => {
    const cru = desenhar(createElement(DiaSemBatida, { dia: '2026-10-20', saldo: saldoDe('2026-10-20') }))
    const html = texto(cru)
    expect(html).toContain('Sem batida')
    expect(html).toContain('Previsto 8h00')
    expect(html).toContain('Falta')
    expect(html).toContain('Saldo −8h00')
    expect(cru).not.toContain('<button')
    expect(html).not.toContain('Inserir batida')
    expect(html).not.toContain('Lançar falta')
    expect(cru).not.toMatch(/[\u2013\u2014]/)
  })

  it('antes do primeiro dia cobrado o dia não fala em saldo', () => {
    // A configuração recuada não adianta: a ficha diz que a pessoa só passou a bater ponto aqui em 01/11.
    const regras = regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: '2026-01-01' }, { jornada: null, batePontoDesde: '2026-11-01' }, HOJE)
    const fora = calcularSaldoDoMes('2026-10', BATIDAS, AUSENCIAS, regras)
    expect(desenhar(createElement(LinhaDoSaldo, { saldo: saldoDe('2026-10-26', fora) }))).toBe('')
    expect(desenhar(createElement(LinhaDoSaldo, { saldo: saldoDe('2026-10-20', fora) }))).toBe('')
  })
})

describe('o dia só de ausência', () => {
  it('"outro motivo" marca com a observação e diz que não abona', () => {
    const outro = porDias('a-outro', '2026-10-21', { tipo: 'outro', observacao: 'doação de sangue' })
    const mes = calcularSaldoDoMes('2026-10', [], [outro], REGRAS)
    const html = texto(
      desenhar(createElement(DiaDeAusencia, { dia: '2026-10-21', ausencias: [outro], saldo: saldoDe('2026-10-21', mes) })),
    )
    expect(html).toContain('Outro motivo, dia inteiro: doação de sangue')
    expect(html).toContain('não abona')
    expect(html).toContain('Saldo −8h00')
    expect(html).toContain('sem horas')
  })

  it('o atestado por dias abona o dia inteiro: saldo 0h00, e o total do dia é o abono, no lugar do "sem horas"', () => {
    const atestado = porDias('a-dia', '2026-10-22')
    const mes = calcularSaldoDoMes('2026-10', [], [atestado], REGRAS)
    const html = texto(
      desenhar(createElement(DiaDeAusencia, { dia: '2026-10-22', ausencias: [atestado], saldo: saldoDe('2026-10-22', mes) })),
    )
    expect(html).toContain('Atestado, dia inteiro')
    expect(html).toContain('abonou 8h00')
    expect(html).toContain('Abonado 8h00')
    expect(html).toContain('Saldo 0h00')
    expect(html).toContain('8h00 horas de atestado')
    expect(html).not.toContain('sem horas')
  })

  it('sem o saldo do dia (as regras não carregaram), o cartão é só a marca e o "sem horas"', () => {
    const atestado = porDias('a-dia', '2026-10-22')
    const html = texto(desenhar(createElement(DiaDeAusencia, { dia: '2026-10-22', ausencias: [atestado] })))
    expect(html).toContain('sem horas')
    expect(html).not.toMatch(/abonou|Previsto|Saldo/)
  })
})

describe('o total do dia e do período somam o abono', () => {
  // Quarta 21/10: 08:00-12:00 e 13:00-15:01 (6h01), atestado das 15:00 às 16:00. A
  // jornada vai até as 17:00: o abono é 15:01-16:00, porque o minuto das 15:00 já é trabalho.
  const QUARTA = '2026-10-21'
  const batidas = batidasDoDia(QUARTA, '08:00', '12:00', '13:00', '15:01')
  const atestado = porHorario('a-tarde-curta', QUARTA, '15:00', '16:00')

  it('o dia soma 7h00 e escreve a conta: "6h01 trabalhadas + 0h59 de atestado"', () => {
    const saldo = saldoDe(QUARTA, calcularSaldoDoMes('2026-10', batidas, [atestado], REGRAS))
    const html = texto(desenhar(createElement(TotalDoDia, { trabalhado: saldo.trabalhado, saldo })))
    expect(html).toBe(' 7h00 6h01 trabalhadas + 0h59 de atestado ')
    // No celular a conta quebra em duas linhas: numa só, a 320 px, o nome do dia ao lado virava "Seg, …".
    expect(desenhar(createElement(TotalDoDia, { trabalhado: saldo.trabalhado, saldo }))).toMatch(
      /<span class="[^"]*\bmax-w-28\b[^"]*\bsm:max-w-none\b[^"]*">6h01 trabalhadas/,
    )
    // Sem saldo, o total é o trabalhado.
    expect(texto(desenhar(createElement(TotalDoDia, { trabalhado: saldo.trabalhado })))).toBe(' 6h01 ')
  })

  it('sem a data na ficha, o dia não é cobrado, mas o atestado soma no total e na conta do período', () => {
    const regras = regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: null }, HOJE)
    const periodo = calcularSaldoDoPeriodo('2026-10-19', '2026-10-23', batidas, [atestado], regras)
    const saldo = saldoDe(QUARTA, periodo)
    expect(saldo.estado).toBe('fora')
    expect(desenhar(createElement(LinhaDoSaldo, { saldo }))).toBe('')
    expect(texto(desenhar(createElement(TotalDoDia, { trabalhado: saldo.trabalhado, saldo })))).toContain(
      '6h01 trabalhadas + 0h59 de atestado',
    )
    const abonado = abonadoNoTotal(periodo.dias)
    expect(abonado).toBe(59)
    expect(texto(desenhar(createElement(ComposicaoDoTotal, { trabalhado: 361, abonado, dias: periodo.dias })))).toBe(
      ' 6h01 trabalhadas + 0h59 de atestado ',
    )
    expect(desenhar(createElement(ComposicaoDoTotal, { trabalhado: 361, abonado: 0, dias: [] }))).toBe('')
  })

  it('no painel geral, o cartão da pessoa soma o abono e diz quanto foi', () => {
    const periodo = { inicio: '2026-10-19', fim: '2026-10-23' }
    const pessoa: FuncionarioDoPainel = {
      usuarioId: 'u1',
      nome: 'Fulana',
      nomeDaConta: 'Fulana',
      email: 'fulana@example.com',
      podeBater: true,
      contaApagada: false,
      temFicha: true,
    }
    const [linha] = montarLinhasDoPainel([pessoa], batidas, ausenciasPorPessoa([atestado], periodo))
    const saldos = calcularSaldoDoPeriodo(periodo.inicio, periodo.fim, batidas, [atestado], REGRAS).dias
    const comAbono = texto(desenhar(createElement(LinhaDeFuncionario, { linha, periodo, saldos })))
    expect(comAbono).toContain('7h00')
    expect(comAbono).toContain('+ 0h59 de atestado')
    // Sem os dias do saldo (a configuração não carregou), o total é o trabalhado.
    const semAbono = texto(desenhar(createElement(LinhaDeFuncionario, { linha, periodo })))
    expect(semAbono).toContain('6h01')
    expect(semAbono).not.toContain('de atestado')
  })
})

describe('o resumo do mês e do período', () => {
  it('conta o dia incompleto à parte: "O saldo não inclui 1 dia incompleto"', () => {
    expect(MES.resumo.diasIncompletos).toBe(1)
    const html = texto(
      desenhar(createElement(ResumoDoSaldoNaTela, { resumo: MES.resumo, rotulo: 'Saldo do mês', comHoje: true })),
    )
    expect(html).toContain('Saldo do mês')
    expect(html).toContain('O saldo não inclui 1 dia incompleto')
    expect(html).toContain('Hoje entra no saldo quando o dia acabar.')
    // Num mês passado, hoje não está no recorte e a frase não aparece.
    const passado = texto(desenhar(createElement(ResumoDoSaldoNaTela, { resumo: MES.resumo, rotulo: 'Saldo do mês' })))
    expect(passado).not.toContain('Hoje entra no saldo')
  })

  it('diz "Horas extras" e "Horas negativas", com as faltas, e nunca "créditos" e "débitos"', () => {
    // O sábado 24/10 é +4h00; as 16 faltas dos dias úteis sem nada são as horas negativas.
    expect(MES.resumo.credito).toBe(240)
    expect(MES.resumo.faltas).toBe(16)
    const html = texto(desenhar(createElement(ResumoDoSaldoNaTela, { resumo: MES.resumo, rotulo: 'Saldo do mês' })))
    expect(html).toContain('Horas extras +4h00')
    expect(html).toContain('Horas negativas −128h00')
    expect(html).toContain('16 faltas')
    expect(html).toContain('−124h00')
    expect(html).not.toMatch(/[Cc]rédito|[Dd]ébito/)
    // Sem nada a somar, as duas somem, e o saldo é 0h00.
    const vazio = calcularSaldoDoMes('2026-10', [], [], regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: '2026-10-31' }, '2026-11-02'))
    const semNada = texto(desenhar(createElement(ResumoDoSaldoNaTela, { resumo: vazio.resumo, rotulo: 'Saldo do mês' })))
    expect(semNada).toContain('0h00')
    expect(semNada).not.toMatch(/Horas extras|Horas negativas|falta/)
  })

  it('quando o recorte começa antes do primeiro dia cobrado, diz a partir de que dia o saldo conta', () => {
    const regras = regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: '2026-10-19' }, { jornada: null, batePontoDesde: '2025-03-10' }, HOJE)
    const mes = calcularSaldoDoMes('2026-10', BATIDAS, AUSENCIAS, regras)
    // Nenhum dia antes de 19/10 é cobrado: as faltas são só as de 19 a 23 de outubro.
    expect(mes.resumo.faltas).toBe(5)
    const html = corrido(
      desenhar(createElement(ResumoDoSaldoNaTela, { resumo: mes.resumo, rotulo: 'Saldo do mês', aPartirDe: '2026-10-19' })),
    )
    expect(html).toContain('Saldo calculado a partir de 19/10/2026. Os dias antes dessa data ficam fora do saldo.')
    // Sem a data (o recorte começa no primeiro dia cobrado ou depois), a frase não aparece.
    expect(texto(desenhar(createElement(ResumoDoSaldoNaTela, { resumo: mes.resumo, rotulo: 'Saldo do mês' })))).not.toContain(
      'Saldo calculado a partir de',
    )
  })

  it('o espelho (mês) e o painel da pessoa (período do dia 1 ao último) dão o mesmo resumo, com a mesma frase', () => {
    const periodo = calcularSaldoDoPeriodo('2026-10-01', '2026-10-31', BATIDAS, AUSENCIAS, REGRAS)
    expect(periodo.resumo).toEqual(MES.resumo)
    const doEspelho = texto(desenhar(createElement(ResumoDoSaldoNaTela, { resumo: MES.resumo, rotulo: 'Saldo' })))
    const doPainel = texto(desenhar(createElement(ResumoDoSaldoNaTela, { resumo: periodo.resumo, rotulo: 'Saldo' })))
    expect(doPainel).toBe(doEspelho)
  })

  it('nenhum texto novo do saldo usa o travessão', () => {
    const linhas = MES.dias.map((dia) => desenhar(createElement(LinhaDoSaldo, { saldo: dia }))).join('')
    const resumo = desenhar(
      createElement(ResumoDoSaldoNaTela, { resumo: MES.resumo, rotulo: 'Saldo do mês', comHoje: true, aPartirDe: '2026-10-02' }),
    )
    expect(linhas + resumo).not.toMatch(/[\u2013\u2014]/)
  })
})
