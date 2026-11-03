import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Batida } from './formato'
import {
  ausenciasPorDia,
  juntarDiasEAusencias,
  type Ausencia,
  type ModalidadeDaAusencia,
  type TipoDeAusencia,
} from './ausencias'
import { mesSeguinte, montarEspelho } from './horas'
import { JORNADA_SEMENTE, type Jornada } from './jornada'
import {
  abonadoNoTotal,
  aplicarTolerancia,
  calcularSaldoDoDia,
  calcularSaldoDoMes,
  calcularSaldoDoPeriodo,
  estadoDoDia,
  formatarSaldo,
  horasDoDia,
  inicioDaCobranca,
  juntarDiasDeFalta,
  regrasDoSaldo,
  resumirSaldos,
  rotuloDoAbono,
  trechoDaAusencia,
  type RegrasDoSaldo,
} from './saldo'

/*
 * O SALDO DO PONTO: os 6 critérios de aceite, um `it` nomeado por critério, os
 * casos de borda e o primeiro dia cobrado, que combina a data da ficha com a
 * "Saldo calculado a partir de" da configuração.
 *
 * O CENÁRIO DE SEMPRE: a jornada da empresa é a semente (segunda a sexta,
 * 08:00-12:00 e 13:00-17:00), tolerância de 10 min, a cobrança começa antes
 * do mês e "hoje" é depois de todos os dias testados, menos nos testes que são
 * justamente de hoje e do futuro. 26/10/2026 é segunda-feira.
 */

const SEGUNDA = '2026-10-26'

const REGRAS: RegrasDoSaldo = {
  jornadaDaEmpresa: JORNADA_SEMENTE,
  jornadaPropria: null,
  cobrancaDesde: '2026-09-01',
  toleranciaMinutos: 10,
  hoje: '2026-11-30',
}

/** Uma batida no relógio do fuso do ponto (offset explícito de Brasília: não depende do fuso de quem roda). */
function batida(dia: string, hora: string, ordem = 1): Batida {
  return {
    id: `${dia}T${hora}`,
    registrado_em: `${dia}T${hora}:00.000-03:00`,
    dia_civil: dia,
    tipo: 'entrada',
    ordem_no_dia: ordem,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    distancia_metros: null,
    no_local: null,
    selfie_path: null,
    ajuste_manual: false,
  }
}

/** `batidas(dia, '08:00', '12:00', ...)` */
function batidas(dia: string, ...horas: string[]): Batida[] {
  return horas.map((hora, i) => batida(dia, hora, i + 1))
}

let proximoId = 0

function ausencia(extras: Partial<Ausencia> & { tipo?: TipoDeAusencia; modalidade?: ModalidadeDaAusencia } = {}): Ausencia {
  proximoId += 1
  return {
    id: `a${proximoId}`,
    usuario_id: 'u1',
    dia_inicio: SEGUNDA,
    dia_fim: SEGUNDA,
    tipo: 'atestado_medico',
    modalidade: 'dias',
    hora_inicio: null,
    hora_fim: null,
    observacao: null,
    atestado_path: null,
    lancado_por: 'admin-1',
    lancado_em: '2026-10-20T12:00:00.000Z',
    cancelada_em: null,
    cancelada_por: null,
    motivo_cancelamento: null,
    ...extras,
  }
}

/** Ausência por horário como o PostgREST devolve `time`: com os segundos. */
function porHorario(dia: string, inicio: string, fim: string, extras: Partial<Ausencia> = {}): Ausencia {
  return ausencia({
    dia_inicio: dia,
    dia_fim: dia,
    modalidade: 'horario',
    hora_inicio: `${inicio}:00`,
    hora_fim: `${fim}:00`,
    ...extras,
  })
}

const DIA_NORMAL = ['08:00', '12:00', '13:00', '17:00']

/* ------------------------------------------------------------------ */
/* Os 6 critérios de aceite                                            */
/* ------------------------------------------------------------------ */

describe('os critérios de aceite', () => {
  it('Critério 1: atestado de 1 dia num dia útil → previsto 480, abonado 480, saldo 0, sem falta', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [ausencia()], REGRAS)
    expect(dia.estado).toBe('cobranca')
    expect(dia.previsto).toBe(480)
    expect(dia.abonado).toBe(480)
    expect(dia.trabalhado).toBe(0)
    expect(dia.saldo).toBe(0)
    expect(dia.debito).toBe(0)
    expect(dia.falta).toBe(false)
    expect(dia.coberturas).toHaveLength(1)
    expect(dia.coberturas[0]).toMatchObject({ diaInteiro: true, abona: true, inicio: 0, fim: 1440, minutosAbonados: 480 })
  })

  it('Critério 2: atestado de 3 dias (qua, qui, sex) → os três abonados; o sábado seguinte não entra', () => {
    const atestado = ausencia({ dia_inicio: '2026-10-28', dia_fim: '2026-10-30' })
    const mes = calcularSaldoDoMes('2026-10', [], [atestado], REGRAS)
    const doDia = (d: string) => mes.dias.find((dia) => dia.dia === d)!

    for (const d of ['2026-10-28', '2026-10-29', '2026-10-30']) {
      expect(doDia(d)).toMatchObject({ previsto: 480, abonado: 480, saldo: 0, falta: false })
      expect(doDia(d).coberturas).toHaveLength(1)
    }
    const sabado = doDia('2026-10-31')
    expect(sabado.coberturas).toEqual([])
    expect(sabado).toMatchObject({ previsto: 0, abonado: 0, saldo: 0, falta: false })
    // A terça antes do atestado continua sendo falta: o atestado não vaza.
    expect(doDia('2026-10-27')).toMatchObject({ falta: true, debito: 480, coberturas: [] })
  })

  it('Critério 3: atestado 14:00-16:00 com batidas 08-12, 13-14 e 16-17 → abonado 120, trabalhado 360, saldo 0, sem atraso', () => {
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '08:00', '12:00', '13:00', '14:00', '16:00', '17:00'),
      [porHorario(SEGUNDA, '14:00', '16:00')],
      REGRAS,
    )
    expect(dia.previsto).toBe(480)
    expect(dia.abonado).toBe(120)
    expect(dia.trabalhado).toBe(360)
    expect(dia.saldo).toBe(0)
    expect(dia.atraso).toBe(0)
    expect(dia.temAtraso).toBe(false)
    expect(dia.falta).toBe(false)
    expect(dia.coberturas[0]).toMatchObject({ diaInteiro: false, inicio: 840, fim: 960, minutosAbonados: 120 })
  })

  it('Critério 4: atestado 16:00-16:30 com saída às 16:00 e volta às 16:30 → abonado 30', () => {
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '08:00', '12:00', '13:00', '16:00', '16:30', '17:00'),
      [porHorario(SEGUNDA, '16:00', '16:30')],
      REGRAS,
    )
    expect(dia.abonado).toBe(30)
    expect(dia.trabalhado).toBe(450)
    expect(dia.saldo).toBe(0)
  })

  it('Critério 5: atestados 08-09 e 15-16 com trabalho 09-12, 13-15 e 16-17 → abonado 120, trabalhado 360, saldo 0, as 6 batidas mantidas', () => {
    const doDia = batidas(SEGUNDA, '09:00', '12:00', '13:00', '15:00', '16:00', '17:00')
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      doDia,
      [porHorario(SEGUNDA, '08:00', '09:00'), porHorario(SEGUNDA, '15:00', '16:00')],
      REGRAS,
    )
    expect(dia.abonado).toBe(120)
    expect(dia.trabalhado).toBe(360)
    expect(dia.saldo).toBe(0)
    expect(dia.atraso).toBe(0)
    expect(dia.espelho.batidas).toHaveLength(6)
    expect(dia.espelho.batidas.map((b) => b.id)).toEqual(doDia.map((b) => b.id))
    expect(dia.coberturas.map((c) => [c.inicio, c.fim, c.minutosAbonados])).toEqual([
      [480, 540, 60],
      [900, 960, 60],
    ])
  })

  it('Critério 6: o dia do critério 3 com o atestado cancelado → saldo -120', () => {
    const doDia = batidas(SEGUNDA, '08:00', '12:00', '13:00', '14:00', '16:00', '17:00')
    const atestado = porHorario(SEGUNDA, '14:00', '16:00')
    const cancelado: Ausencia = {
      ...atestado,
      cancelada_em: '2026-10-27T12:00:00.000Z',
      cancelada_por: 'admin-1',
      motivo_cancelamento: 'lançado na pessoa errada',
    }
    expect(calcularSaldoDoDia(SEGUNDA, doDia, [atestado], REGRAS).saldo).toBe(0)
    const sem = calcularSaldoDoDia(SEGUNDA, doDia, [cancelado], REGRAS)
    expect(sem.abonado).toBe(0)
    expect(sem.saldo).toBe(-120)
    expect(sem.debito).toBe(120)
    expect(sem.coberturas).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Tolerância e atraso                                                 */
/* ------------------------------------------------------------------ */

describe('a tolerância', () => {
  it('saída 8 min antes → saldo 0', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00', '12:00', '13:00', '16:52'), [], REGRAS)
    expect(dia.saldoBruto).toBe(-8)
    expect(dia.saldo).toBe(0)
    expect(dia.debito).toBe(0)
  })

  it('saída 11 min antes → saldo -11 (o bruto inteiro, sem descontar a tolerância)', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00', '12:00', '13:00', '16:49'), [], REGRAS)
    expect(dia.saldo).toBe(-11)
    expect(dia.debito).toBe(11)
  })

  it('vale para o crédito também: 10 min a mais é 0, 15 a mais é +15', () => {
    expect(calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00', '12:00', '13:00', '17:10'), [], REGRAS).saldo).toBe(0)
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00', '12:00', '13:00', '17:15'), [], REGRAS)
    expect(dia.saldo).toBe(15)
    expect(dia.credito).toBe(15)
    expect(dia.debito).toBe(0)
  })

  it('aplicarTolerancia: a borda é inclusiva', () => {
    expect(aplicarTolerancia(10, 10)).toBe(0)
    expect(aplicarTolerancia(-10, 10)).toBe(0)
    expect(aplicarTolerancia(11, 10)).toBe(11)
    expect(aplicarTolerancia(-1, 0)).toBe(-1)
  })
})

describe('o atraso', () => {
  it('atraso coberto: atestado 08:00-10:00 e entrada às 10:00 → sem atraso, saldo 0', () => {
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '10:00', '12:00', '13:00', '17:00'),
      [porHorario(SEGUNDA, '08:00', '10:00')],
      REGRAS,
    )
    expect(dia.atraso).toBe(0)
    expect(dia.temAtraso).toBe(false)
    expect(dia.abonado).toBe(120)
    expect(dia.saldo).toBe(0)
  })

  it('atraso real: entrada 08:25 → atraso 25, marca, saldo -25', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:25', '12:00', '13:00', '17:00'), [], REGRAS)
    expect(dia.atraso).toBe(25)
    expect(dia.temAtraso).toBe(true)
    expect(dia.saldo).toBe(-25)
  })

  it('atraso até a tolerância não marca, mas o número continua lá', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:07', '12:00', '13:00', '17:00'), [], REGRAS)
    expect(dia.atraso).toBe(7)
    expect(dia.temAtraso).toBe(false)
    expect(dia.saldo).toBe(0)
  })

  it('soma os blocos: 5 min na entrada e 8 min na volta do almoço → 13, marca', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:05', '12:00', '13:08', '17:00'), [], REGRAS)
    expect(dia.atraso).toBe(13)
    expect(dia.temAtraso).toBe(true)
    expect(dia.saldo).toBe(-13)
  })

  it('atestado que cobre só o meio do bloco não empurra a entrada esperada', () => {
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '08:30', '12:00', '13:00', '17:00'),
      [porHorario(SEGUNDA, '09:00', '10:00')],
      REGRAS,
    )
    expect(dia.atraso).toBe(30)
    expect(dia.temAtraso).toBe(true)
  })

  it('"outro motivo" não empurra a entrada esperada: 08-10 por outro motivo e entrada às 10 é atraso', () => {
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '10:00', '12:00', '13:00', '17:00'),
      [porHorario(SEGUNDA, '08:00', '10:00', { tipo: 'outro', observacao: 'banco' })],
      REGRAS,
    )
    expect(dia.atraso).toBe(120)
    expect(dia.saldo).toBe(-120)
  })

  it('bloco sem par não é atraso: só a manhã trabalhada é débito, não atraso', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00', '12:00'), [], REGRAS)
    expect(dia.atraso).toBe(0)
    expect(dia.temAtraso).toBe(false)
    expect(dia.falta).toBe(false)
    expect(dia.saldo).toBe(-240)
  })

  it('o dia inteiro sem almoço (um par só, 08-17) não é atraso na volta', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00', '17:00'), [], REGRAS)
    expect(dia.atraso).toBe(0)
    expect(dia.trabalhado).toBe(540)
    expect(dia.saldo).toBe(60)
  })
})

/* ------------------------------------------------------------------ */
/* A jornada e o estado do dia                                         */
/* ------------------------------------------------------------------ */

describe('a jornada própria', () => {
  const SEIS_HORAS: Jornada = ([1, 2, 3, 4, 5] as const).map((dia) => ({ dia, inicio: '09:00', fim: '15:00' }))
  const REGRAS_PROPRIAS: RegrasDoSaldo = { ...REGRAS, jornadaPropria: SEIS_HORAS }

  it('a jornada própria (09:00-15:00, 6 h) vale no lugar da da empresa', () => {
    const doDia = batidas(SEGUNDA, '09:00', '15:00')
    const proprio = calcularSaldoDoDia(SEGUNDA, doDia, [], REGRAS_PROPRIAS)
    expect(proprio.blocosPrevistos).toEqual([{ inicio: 540, fim: 900 }])
    expect(proprio.previsto).toBe(360)
    expect(proprio.saldo).toBe(0)
    expect(proprio.atraso).toBe(0)
    // Com a da empresa, o mesmo dia é débito de 2 h e chegada atrasada.
    const daEmpresa = calcularSaldoDoDia(SEGUNDA, doDia, [], REGRAS)
    expect(daEmpresa.saldo).toBe(-120)
    expect(daEmpresa.atraso).toBe(60)
  })

  it('com jornada própria, o atestado de 1 dia abona as 6 h dela', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [ausencia()], REGRAS_PROPRIAS)
    expect(dia).toMatchObject({ previsto: 360, abonado: 360, saldo: 0, falta: false })
  })

  it('a entrada esperada da jornada própria é a dela: 09:20 é 20 min de atraso', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '09:20', '15:00'), [], REGRAS_PROPRIAS)
    expect(dia.atraso).toBe(20)
    expect(dia.temAtraso).toBe(true)
  })
})

describe('o estado do dia: antes do primeiro dia cobrado, hoje e futuro', () => {
  it('antes do primeiro dia cobrado: fora, sem previsto, sem falta, mas o trabalhado aparece', () => {
    const regras = { ...REGRAS, cobrancaDesde: '2026-10-27' }
    const semBatida = calcularSaldoDoDia(SEGUNDA, [], [], regras)
    expect(semBatida).toMatchObject({
      estado: 'fora',
      motivoDeFora: 'antes_da_cobranca',
      previsto: 0,
      abonado: 0,
      saldo: 0,
      debito: 0,
      falta: false,
    })
    const comBatida = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:30', '12:00'), [], regras)
    expect(comBatida.trabalhado).toBe(210)
    expect(comBatida.atraso).toBe(0)
    expect(comBatida.saldo).toBe(0)
  })

  it('sem o primeiro dia cobrado (a ficha sem a data): fora, nada é cobrado', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [], { ...REGRAS, cobrancaDesde: null })
    expect(dia).toMatchObject({ estado: 'fora', motivoDeFora: 'sem_bate_ponto', falta: false, debito: 0 })
  })

  it('o primeiro dia cobrado já é cobrado', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [], { ...REGRAS, cobrancaDesde: SEGUNDA })
    expect(dia).toMatchObject({ estado: 'cobranca', falta: true, debito: 480 })
  })

  it('hoje: previsto, trabalhado e abonado calculados, sem falta e sem débito', () => {
    const regras = { ...REGRAS, hoje: SEGUNDA }
    const semBatida = calcularSaldoDoDia(SEGUNDA, [], [], regras)
    expect(semBatida).toMatchObject({ estado: 'em_andamento', previsto: 480, falta: false, saldo: 0, debito: 0, credito: 0 })

    const meioDoDia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '08:00', '12:00', '13:00', '14:00'),
      [porHorario(SEGUNDA, '14:00', '16:00')],
      regras,
    )
    expect(meioDoDia).toMatchObject({ trabalhado: 300, abonado: 120, saldoBruto: -60, saldo: 0, debito: 0 })
  })

  it('hoje: a entrada atrasada já aparece, mesmo com o dia ainda aberto (batida ímpar)', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:30'), [], { ...REGRAS, hoje: SEGUNDA })
    expect(dia.incompleto).toBe(true)
    expect(dia.atraso).toBe(30)
    expect(dia.temAtraso).toBe(true)
    expect(dia.debito).toBe(0)
  })

  it('futuro: fora, sem previsto nem falta; a marca do atestado já aparece', () => {
    const dia = calcularSaldoDoDia('2026-10-28', [], [ausencia({ dia_inicio: '2026-10-28', dia_fim: '2026-10-28' })], {
      ...REGRAS,
      hoje: SEGUNDA,
    })
    expect(dia).toMatchObject({ estado: 'fora', motivoDeFora: 'futuro', previsto: 0, abonado: 0, falta: false, saldo: 0 })
    expect(dia.coberturas).toHaveLength(1)
    expect(dia.coberturas[0].minutosAbonados).toBe(0)
  })

  it('estadoDoDia: futuro ganha de "sem bate ponto"', () => {
    expect(estadoDoDia('2026-10-27', null, SEGUNDA)).toEqual({ estado: 'fora', motivoDeFora: 'futuro' })
    expect(estadoDoDia('2026-10-25', '2026-10-01', SEGUNDA)).toEqual({ estado: 'cobranca', motivoDeFora: null })
  })
})

/* ------------------------------------------------------------------ */
/* Casos de borda                                                      */
/* ------------------------------------------------------------------ */

describe('os casos de borda', () => {
  it('atestado fora da jornada (18:00-20:00) → abonado 0, marca presente nos dados', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, ...DIA_NORMAL), [porHorario(SEGUNDA, '18:00', '20:00')], REGRAS)
    expect(dia.abonado).toBe(0)
    expect(dia.saldo).toBe(0)
    expect(dia.coberturas).toHaveLength(1)
    expect(dia.coberturas[0]).toMatchObject({ inicio: 1080, fim: 1200, abona: true, minutosAbonados: 0 })
  })

  it('atestado cobrindo parte de um bloco (16:00-18:00, jornada até 17:00) → abona 60', () => {
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '08:00', '12:00', '13:00', '16:00'),
      [porHorario(SEGUNDA, '16:00', '18:00')],
      REGRAS,
    )
    expect(dia.abonado).toBe(60)
    expect(dia.saldo).toBe(0)
  })

  it('"outro motivo" → não abona: a marca aparece e o tempo vira débito', () => {
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '08:00', '12:00', '13:00', '14:00', '16:00', '17:00'),
      [porHorario(SEGUNDA, '14:00', '16:00', { tipo: 'outro', observacao: 'reunião na escola' })],
      REGRAS,
    )
    expect(dia.abonado).toBe(0)
    expect(dia.saldo).toBe(-120)
    expect(dia.debito).toBe(120)
    expect(dia.coberturas[0]).toMatchObject({ abona: false, minutosAbonados: 0 })
  })

  it('"outro motivo" por dias num dia útil sem batida é falta', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [ausencia({ tipo: 'outro', observacao: 'x' })], REGRAS)
    expect(dia).toMatchObject({ abonado: 0, falta: true, debito: 480 })
  })

  it('falta justificada abona como o atestado', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [ausencia({ tipo: 'falta_justificada' })], REGRAS)
    expect(dia).toMatchObject({ abonado: 480, falta: false, saldo: 0 })
  })

  it('por dias num sábado sem jornada → cobertura presente, abono 0, sem falta', () => {
    const sabado = '2026-10-31'
    const dia = calcularSaldoDoDia(sabado, [], [ausencia({ dia_inicio: sabado, dia_fim: sabado })], REGRAS)
    expect(dia.coberturas).toHaveLength(1)
    expect(dia).toMatchObject({ previsto: 0, abonado: 0, falta: false, saldo: 0, estado: 'cobranca' })
  })

  it('trabalho dentro do intervalo do atestado conta como trabalhado e não duplica', () => {
    // Trabalhou o dia inteiro apesar do atestado 14-16: 480 trabalhados, 0 abonados.
    const inteiro = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, ...DIA_NORMAL), [porHorario(SEGUNDA, '14:00', '16:00')], REGRAS)
    expect(inteiro).toMatchObject({ trabalhado: 480, abonado: 0, saldo: 0 })
    expect(inteiro.coberturas[0].minutosAbonados).toBe(0)

    // Trabalhou até as 15h: a hora das 14 às 15 é trabalho, só a das 15 às 16 é abono.
    const parte = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '08:00', '12:00', '13:00', '15:00'),
      [porHorario(SEGUNDA, '14:00', '16:00')],
      REGRAS,
    )
    expect(parte).toMatchObject({ trabalhado: 360, abonado: 60, saldoBruto: -60, saldo: -60 })
  })

  it('ausência por horário cobrindo a jornada inteira → dia abonado inteiro, sem falta', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [porHorario(SEGUNDA, '07:00', '18:00')], REGRAS)
    expect(dia).toMatchObject({ abonado: 480, falta: false, saldo: 0 })
  })

  it('abono parcial sem batida nenhuma: é falta (o abono não cobre o dia) e o débito é o que sobrou', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [porHorario(SEGUNDA, '08:00', '12:00')], REGRAS)
    expect(dia).toMatchObject({ abonado: 240, falta: true, debito: 240, saldo: -240 })
  })

  it('domingo sem batida e sem jornada não é nada', () => {
    const dia = calcularSaldoDoDia('2026-10-25', [], [], REGRAS)
    expect(dia).toMatchObject({ estado: 'cobranca', previsto: 0, falta: false, saldo: 0, coberturas: [] })
  })

  it('trabalho no sábado sem jornada é crédito inteiro', () => {
    const dia = calcularSaldoDoDia('2026-10-31', batidas('2026-10-31', '08:00', '12:00'), [], REGRAS)
    expect(dia).toMatchObject({ previsto: 0, trabalhado: 240, saldo: 240, credito: 240 })
  })

  it('a hora da ausência vale com e sem segundos ("14:00:00" e "14:00")', () => {
    const doDia = batidas(SEGUNDA, '08:00', '12:00', '13:00', '14:00', '16:00', '17:00')
    const semSegundos = porHorario(SEGUNDA, '14:00', '16:00', { hora_inicio: '14:00', hora_fim: '16:00' })
    expect(calcularSaldoDoDia(SEGUNDA, doDia, [semSegundos], REGRAS).abonado).toBe(120)
    expect(trechoDaAusencia(semSegundos, SEGUNDA)).toEqual({ inicio: 840, fim: 960 })
    expect(trechoDaAusencia(porHorario(SEGUNDA, '14:00', '16:00'), SEGUNDA)).toEqual({ inicio: 840, fim: 960 })
  })

  it('ausência por horário de outro dia não toca este; a por dias vale nas duas pontas', () => {
    expect(trechoDaAusencia(porHorario('2026-10-27', '14:00', '16:00'), SEGUNDA)).toBeNull()
    const periodo = ausencia({ dia_inicio: '2026-10-24', dia_fim: SEGUNDA })
    expect(trechoDaAusencia(periodo, '2026-10-24')).toEqual({ inicio: 0, fim: 1440 })
    expect(trechoDaAusencia(periodo, SEGUNDA)).toEqual({ inicio: 0, fim: 1440 })
    expect(trechoDaAusencia(periodo, '2026-10-27')).toBeNull()
  })

  // O trabalhado do dia ímpar é zero, e cobrar a jornada inteira daria -480.
  // O saldo fica suspenso: o dia é `pendente`, sem débito, até quem
  // administra corrigir a batida.
  it('dia incompleto: o trabalhado é zero (como no espelho), o par fechado dentro do atestado não vira abono, e o saldo fica suspenso', () => {
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      batidas(SEGUNDA, '08:00', '12:00', '13:00'),
      [porHorario(SEGUNDA, '08:00', '10:00')],
      REGRAS,
    )
    expect(dia.incompleto).toBe(true)
    expect(dia.estado).toBe('pendente')
    expect(dia.previsto).toBe(480)
    expect(dia.trabalhado).toBe(0)
    expect(dia.abonado).toBe(0)
    expect(dia.falta).toBe(false)
    expect(dia).toMatchObject({ saldoBruto: 0, saldo: 0, debito: 0, credito: 0 })
  })

  it('segundos nas batidas: o abono usa o minuto exato e arredonda uma vez', () => {
    const doDia = [
      batida(SEGUNDA, '08:00'),
      batida(SEGUNDA, '12:00'),
      batida(SEGUNDA, '13:00'),
      { ...batida(SEGUNDA, '14:00'), registrado_em: `${SEGUNDA}T14:00:40.000-03:00` },
      batida(SEGUNDA, '16:00'),
      batida(SEGUNDA, '17:00'),
    ]
    const dia = calcularSaldoDoDia(SEGUNDA, doDia, [porHorario(SEGUNDA, '14:00', '16:00')], REGRAS)
    expect(dia.abonado).toBe(119)
    expect(dia.trabalhado).toBe(361)
  })
})

/* ------------------------------------------------------------------ */
/* O mês                                                               */
/* ------------------------------------------------------------------ */

describe('o resumo do mês', () => {
  it('soma só os dias de cobrança; hoje e o futuro não entram', () => {
    const regras = { ...REGRAS, cobrancaDesde: '2026-10-26', hoje: '2026-10-29' }
    const todas = [
      ...batidas('2026-10-23', ...DIA_NORMAL), // antes do primeiro dia cobrado: fora
      ...batidas('2026-10-26', '08:25', '12:00', '13:00', '17:00'), // atraso 25, -25
      // 27/10: sem batida e sem ausência → falta, -480
      ...batidas('2026-10-28', '08:00', '12:00', '13:00', '17:30'), // +30
      ...batidas('2026-10-29', '08:00', '12:00'), // hoje: em andamento
    ]
    const mes = calcularSaldoDoMes('2026-10', todas, [], regras)
    expect(mes.dias).toHaveLength(31)
    expect(mes.dias[0].dia).toBe('2026-10-01')
    expect(mes.dias[30].dia).toBe('2026-10-31')
    expect(mes.resumo).toEqual({
      previsto: 1440,
      trabalhado: 455 + 0 + 510,
      abonado: 0,
      credito: 30,
      debito: 505,
      saldo: -475,
      faltas: 1,
      diasComAtraso: 1,
      diasDeCobranca: 3,
      diasComJornada: 3,
      diasIncompletos: 0,
    })
    // O total trabalhado do mês é o mesmo do espelho.
    expect(mes.trabalhadoNoMes).toBe(montarEspelho('2026-10', todas).minutos)
  })

  it('não acumula entre meses: as batidas e o saldo de setembro não entram em outubro', () => {
    const setembro = batidas('2026-09-30', '08:00', '12:00') // -240 em setembro
    const mes = calcularSaldoDoMes('2026-10', setembro, [], { ...REGRAS, cobrancaDesde: '2026-10-26' })
    expect(mes.trabalhadoNoMes).toBe(0)
    expect(mes.resumo.trabalhado).toBe(0)
    expect(calcularSaldoDoMes('2026-09', setembro, [], REGRAS).resumo.debito).toBeGreaterThanOrEqual(240)
  })

  it('o mês dos 6 critérios fecha com saldo 0 nos dias de atestado', () => {
    const ausencias = [porHorario(SEGUNDA, '14:00', '16:00'), ausencia({ dia_inicio: '2026-10-28', dia_fim: '2026-10-30' })]
    const mes = calcularSaldoDoMes(
      '2026-10',
      batidas(SEGUNDA, '08:00', '12:00', '13:00', '14:00', '16:00', '17:00'),
      ausencias,
      { ...REGRAS, cobrancaDesde: SEGUNDA, hoje: '2026-11-02' },
    )
    // 26 (atestado parcial), 27 (falta), 28-30 (atestado), 31 (sábado).
    expect(mes.resumo).toMatchObject({ previsto: 2400, abonado: 120 + 1440, faltas: 1, debito: 480, credito: 0, saldo: -480 })
    // O sábado 31 é dia de cobrança, mas sem jornada: entra em `diasDeCobranca` e não em `diasComJornada`.
    expect(mes.resumo).toMatchObject({ diasDeCobranca: 6, diasComJornada: 5 })
  })

  it('juntarDiasDeFalta: a lista do espelho ganha cada dia de falta, em ordem, e nenhum outro dia vazio', () => {
    // "Hoje" é quarta, 21/10; a cobrança começa na quinta, 08/10.
    const regras = { ...REGRAS, cobrancaDesde: '2026-10-08', hoje: '2026-10-21' }
    const todas = [...batidas('2026-10-12', ...DIA_NORMAL), ...batidas('2026-10-14', '08:00', '12:00', '13:00')]
    const ausencias = [
      ausencia({ dia_inicio: '2026-10-15', dia_fim: '2026-10-15' }), // atestado do dia inteiro: abona, não é falta
      porHorario('2026-10-16', '08:00', '10:00'), // atestado de 2h, sem batida: falta, já listada pela ausência
    ]
    const mes = calcularSaldoDoMes('2026-10', todas, ausencias, regras)
    const comConteudo = juntarDiasEAusencias(montarEspelho('2026-10', todas).dias, ausenciasPorDia(ausencias))
    const lista = juntarDiasDeFalta(comConteudo, mes.dias)

    expect(lista.map((linha) => linha.dia)).toEqual([
      '2026-10-08', // falta (quinta)
      '2026-10-09', // falta (sexta)
      '2026-10-12', // dia completo
      '2026-10-13', // falta
      '2026-10-14', // incompleto: pendente, não é falta, mas tem batida
      '2026-10-15', // atestado do dia inteiro
      '2026-10-16', // falta com atestado parcial: uma linha só
      '2026-10-19', // falta
      '2026-10-20', // falta
    ])
    // Fora: antes do primeiro dia cobrado (01 a 07), fins de semana, hoje (21) e o futuro.
    const faltas = mes.dias.filter((dia) => dia.falta).map((dia) => dia.dia)
    expect(faltas).toEqual(['2026-10-08', '2026-10-09', '2026-10-13', '2026-10-16', '2026-10-19', '2026-10-20'])
    expect(mes.resumo.faltas).toBe(faltas.length)
    for (const dia of faltas) expect(lista.some((linha) => linha.dia === dia)).toBe(true)
    // Os dias de falta novos entram vazios; os que já estavam continuam o mesmo objeto.
    expect(lista.find((linha) => linha.dia === '2026-10-13')).toEqual({ dia: '2026-10-13', batidas: null, ausencias: [] })
    expect(lista.find((linha) => linha.dia === '2026-10-12')).toBe(comConteudo[0])
    // Sem saldo (as leituras ainda não voltaram), a lista é a de antes.
    expect(juntarDiasDeFalta(comConteudo, [])).toEqual(comConteudo)
  })

  it('resumirSaldos de nada é tudo zero', () => {
    expect(resumirSaldos([])).toEqual({
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
    })
  })
})

/* ------------------------------------------------------------------ */
/* O dia incompleto                                                    */
/* ------------------------------------------------------------------ */

describe('o dia incompleto: saldo suspenso', () => {
  const REGRAS_DO_MES = { ...REGRAS, cobrancaDesde: '2026-10-01', hoje: '2026-10-28' }

  it('dia passado com 3 batidas: saldo suspenso, fora do saldo do mês, e o resumo conta 1 incompleto', () => {
    const terca = '2026-10-27'
    const todas = [
      ...batidas(SEGUNDA, ...DIA_NORMAL), // dia normal: 0
      ...batidas(terca, '08:00', '12:00', '13:00'), // esqueceu a saída: pendente
    ]
    const sem = calcularSaldoDoMes('2026-10', batidas(SEGUNDA, ...DIA_NORMAL), [], REGRAS_DO_MES)
    const com = calcularSaldoDoMes('2026-10', todas, [], REGRAS_DO_MES)

    const dia = com.dias.find((d) => d.dia === terca)
    expect(dia).toMatchObject({
      estado: 'pendente',
      incompleto: true,
      previsto: 480,
      trabalhado: 0,
      saldo: 0,
      debito: 0,
      credito: 0,
      falta: false,
    })
    expect(dia?.espelho.batidas).toHaveLength(3)
    expect(com.resumo.diasIncompletos).toBe(1)
    // A terça não entra em nenhuma soma: sem ela, o resto do mês é igual.
    expect(com.resumo.debito).toBe(sem.resumo.debito - 480)
    expect(com.resumo.previsto).toBe(sem.resumo.previsto - 480)
    expect(com.resumo.faltas).toBe(sem.resumo.faltas - 1)
    expect(com.resumo.diasDeCobranca).toBe(sem.resumo.diasDeCobranca - 1)
    expect(sem.resumo.diasIncompletos).toBe(0)
  })

  it('o mesmo dia com atestado por horário: nenhum débito (antes cobrava duas vezes)', () => {
    const terca = '2026-10-27'
    const ausencias = [porHorario(terca, '14:00', '16:00')]
    const mes = calcularSaldoDoMes('2026-10', batidas(terca, '08:00', '12:00', '13:00'), ausencias, REGRAS_DO_MES)
    const dia = mes.dias.find((d) => d.dia === terca)
    expect(dia).toMatchObject({ estado: 'pendente', previsto: 480, saldo: 0, debito: 0, falta: false })
    // O abono continua à vista (o par 08-12 não toca o atestado; 14-16 não foi trabalhado).
    expect(dia?.abonado).toBe(120)
    expect(dia?.coberturas).toHaveLength(1)
    expect(mes.resumo.diasIncompletos).toBe(1)
    // E o abono do dia pendente também não entra no mês: nenhum dia de cobrança tem atestado.
    expect(mes.resumo.abonado).toBe(0)
    expect(mes.resumo.debito).toBe(calcularSaldoDoMes('2026-10', [], [], REGRAS_DO_MES).resumo.debito - 480)
  })

  it('dia pendente com entrada atrasada: o atraso também fica suspenso (zero, sem a marca)', () => {
    const terca = '2026-10-27'
    const mes = calcularSaldoDoMes('2026-10', batidas(terca, '08:40', '12:00', '13:00'), [], REGRAS_DO_MES)
    const dia = mes.dias.find((d) => d.dia === terca)
    expect(dia).toMatchObject({ estado: 'pendente', atraso: 0, temAtraso: false, saldo: 0, falta: false })
    expect(mes.resumo.diasComAtraso).toBe(0)
    // O mesmo dia, fechado, tem o atraso de 40 min: a suspensão é só do pendente.
    const fechado = calcularSaldoDoDia(terca, batidas(terca, '08:40', '12:00', '13:00', '17:00'), [], REGRAS_DO_MES)
    expect(fechado).toMatchObject({ estado: 'cobranca', atraso: 40, temAtraso: true })
  })

  it('hoje ímpar continua "em andamento", e não pendente; antes do primeiro dia cobrado, fora', () => {
    const hoje = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00'), [], { ...REGRAS, hoje: SEGUNDA })
    expect(hoje.estado).toBe('em_andamento')
    const antes = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00'), [], { ...REGRAS, cobrancaDesde: '2026-10-27' })
    expect(antes.estado).toBe('fora')
    expect(resumirSaldos([hoje, antes]).diasIncompletos).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* O recorte livre, o dia sem jornada e o texto                        */
/* ------------------------------------------------------------------ */

describe('o período, o dia sem jornada e o texto do saldo', () => {
  it('o período do dia 1 ao último é exatamente o mês', () => {
    const todas = [...batidas(SEGUNDA, ...DIA_NORMAL), ...batidas('2026-10-27', '08:00', '12:00', '13:00')]
    const ausencias = [porHorario('2026-10-28', '08:00', '10:00')]
    const regras = { ...REGRAS, cobrancaDesde: '2026-10-01', hoje: '2026-10-29' }
    const mes = calcularSaldoDoMes('2026-10', todas, ausencias, regras)
    const periodo = calcularSaldoDoPeriodo('2026-10-01', '2026-10-31', todas, ausencias, regras)
    expect(periodo.resumo).toEqual(mes.resumo)
    expect(periodo.dias).toEqual(mes.dias)
  })

  it('um recorte de 26/09 a 25/10 passa o mês sem acumular nada fora dele', () => {
    const periodo = calcularSaldoDoPeriodo('2026-09-26', '2026-10-25', batidas(SEGUNDA, '08:00', '12:00'), [], REGRAS)
    expect(periodo.dias).toHaveLength(30)
    expect(periodo.resumo.trabalhado).toBe(0)
  })

  it('dia sem jornada: o sábado da semente tem semJornada, e o trabalho nele é crédito', () => {
    const sabado = calcularSaldoDoDia('2026-10-31', batidas('2026-10-31', '08:00', '12:00'), [], REGRAS)
    expect(sabado).toMatchObject({ semJornada: true, credito: 240 })
    expect(calcularSaldoDoDia(SEGUNDA, [], [], REGRAS).semJornada).toBe(false)
    // Fora da cobrança ninguém fala em jornada.
    expect(calcularSaldoDoDia('2026-10-31', [], [], { ...REGRAS, cobrancaDesde: null }).semJornada).toBe(false)
  })

  it('a jornada própria vazia ([]) segue a da empresa', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, [], [], { ...REGRAS, jornadaPropria: [] })
    expect(dia).toMatchObject({ previsto: 480, falta: true, debito: 480 })
  })

  it('formatarSaldo: zero sem sinal, crédito com +, débito com o sinal de menos (U+2212)', () => {
    expect(formatarSaldo(0)).toBe('0h00')
    expect(formatarSaldo(-0)).toBe('0h00')
    expect(formatarSaldo(90)).toBe('+1h30')
    expect(formatarSaldo(-30)).toBe('\u22120h30')
    expect(formatarSaldo(-480)).toBe('\u22128h00')
    // O sinal é o de menos tipográfico, e não o hífen do teclado.
    expect(formatarSaldo(-30)).not.toContain('-')
  })
})

/* ------------------------------------------------------------------ */
/* O fuso                                                              */
/* ------------------------------------------------------------------ */

describe('o fuso da máquina não muda a conta', () => {
  // `vi.stubEnv` troca o `TZ` do processo (o Node relê o fuso na hora) sem o
  // teste precisar dos tipos do Node, e `unstubAllEnvs` devolve o de antes.
  const trocarFuso = (fuso: string) => vi.stubEnv('TZ', fuso)
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const BATIDAS_DO_CRITERIO_3 = batidas(SEGUNDA, '08:00', '12:00', '13:00', '14:00', '16:00', '17:00')
  const ATESTADO_DO_CRITERIO_3 = porHorario(SEGUNDA, '14:00', '16:00')

  function criterio3() {
    const dia = calcularSaldoDoDia(SEGUNDA, BATIDAS_DO_CRITERIO_3, [ATESTADO_DO_CRITERIO_3], REGRAS)
    return { ...dia, espelho: undefined }
  }

  it('o critério 3 dá o mesmo resultado em Tóquio, Los Angeles, UTC e Kiritimati (UTC+14)', () => {
    trocarFuso('America/Sao_Paulo')
    const referencia = criterio3()
    expect(referencia).toMatchObject({ abonado: 120, trabalhado: 360, saldo: 0 })
    for (const fuso of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC', 'Pacific/Kiritimati']) {
      trocarFuso(fuso)
      expect(criterio3()).toEqual(referencia)
    }
    // A troca de fuso pegou de verdade (senão o teste acima não provaria nada).
    trocarFuso('Asia/Tokyo')
    expect(new Date(2026, 9, 26, 12).getTimezoneOffset()).toBe(-540)
  })

  it('batida carimbada em UTC ("Z") é lida no relógio de Brasília', () => {
    trocarFuso('Asia/Tokyo')
    const emUtc = (hora: string, utc: string): Batida => ({ ...batida(SEGUNDA, hora), registrado_em: `${SEGUNDA}T${utc}:00.000Z` })
    const dia = calcularSaldoDoDia(
      SEGUNDA,
      [emUtc('08:25', '11:25'), emUtc('12:00', '15:00'), emUtc('13:00', '16:00'), emUtc('17:00', '20:00')],
      [],
      REGRAS,
    )
    expect(dia.atraso).toBe(25)
    expect(dia.saldo).toBe(-25)
  })

  it('o dia da semana não depende do fuso: 26/10/2026 é segunda em qualquer lugar', () => {
    for (const fuso of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      trocarFuso(fuso)
      expect(calcularSaldoDoDia(SEGUNDA, [], [], REGRAS).previsto).toBe(480)
      expect(calcularSaldoDoDia('2026-10-25', [], [], REGRAS).previsto).toBe(0)
    }
  })
})

describe('entradas inválidas', () => {
  it('dia ou hoje fora do formato levantam', () => {
    expect(() => calcularSaldoDoDia('26/10/2026', [], [], REGRAS)).toThrow(/Dia inválido/)
    expect(() => calcularSaldoDoDia(SEGUNDA, [], [], { ...REGRAS, hoje: '' })).toThrow(/Hoje inválido/)
  })
})

/* ------------------------------------------------------------------ */
/* O atestado soma nas horas do dia, e o feriado é feriado             */
/* ------------------------------------------------------------------ */

/** Uma jornada que não é a semente: seg a sex, 08:00-12:00 e 13:00-18:00 (9 h). */
const JORNADA_DE_NOVE_HORAS: Jornada = ([1, 2, 3, 4, 5] as const).flatMap((dia) => [
  { dia, inicio: '08:00', fim: '12:00' },
  { dia, inicio: '13:00', fim: '18:00' },
])

describe('o atestado soma nas horas do dia', () => {
  // Terça 06/10/2026: 08:00-12:00 e 13:00-16:31 (7h31), atestado das 16:30 às 17:30.
  const TERCA = '2026-10-06'
  const saidaCedo = batidas(TERCA, '08:00', '12:00', '13:00', '16:31')
  const atestadoDaTarde = () => porHorario(TERCA, '16:30', '17:30')

  it('o dia soma 8h30: 7h31 trabalhadas e 0h59 de atestado (o minuto das 16:30 já é trabalho)', () => {
    const dia = calcularSaldoDoDia(TERCA, saidaCedo, [atestadoDaTarde()], { ...REGRAS, jornadaDaEmpresa: JORNADA_DE_NOVE_HORAS })
    expect(dia).toMatchObject({ estado: 'cobranca', trabalhado: 451, abonado: 59 })
    expect(horasDoDia(dia)).toBe(510)
    expect(dia.coberturas[0].minutosAbonados).toBe(59)
  })

  it('sem a data na ficha, o dia continua fora da cobrança, mas o atestado abona e soma', () => {
    const regras = { ...REGRAS, jornadaDaEmpresa: JORNADA_DE_NOVE_HORAS, cobrancaDesde: null }
    const dia = calcularSaldoDoDia(TERCA, saidaCedo, [atestadoDaTarde()], regras)
    expect(dia).toMatchObject({
      estado: 'fora',
      motivoDeFora: 'sem_bate_ponto',
      previsto: 0,
      trabalhado: 451,
      abonado: 59,
      saldo: 0,
      debito: 0,
      falta: false,
    })
    expect(dia.coberturas[0].minutosAbonados).toBe(59)
    expect(horasDoDia(dia)).toBe(510)
    // O saldo do mês continua sem esse dia: ele não é cobrado.
    expect(resumirSaldos([dia]).abonado).toBe(0)
  })

  it('antes do primeiro dia cobrado também: o atestado de um dia inteiro soma a jornada do dia', () => {
    const regras = { ...REGRAS, cobrancaDesde: '2026-10-27' }
    const dia = calcularSaldoDoDia(SEGUNDA, [], [ausencia()], regras)
    expect(dia).toMatchObject({ estado: 'fora', motivoDeFora: 'antes_da_cobranca', previsto: 0, abonado: 480, falta: false })
    expect(horasDoDia(dia)).toBe(480)
  })

  it('a parte do atestado fora da jornada não soma: 07:30-09:30 com jornada às 08:00 abona 1h30', () => {
    const dia = calcularSaldoDoDia(
      '2026-10-13',
      batidas('2026-10-13', '10:00', '12:00', '13:00', '18:00'),
      [porHorario('2026-10-13', '07:30', '09:30')],
      { ...REGRAS, jornadaDaEmpresa: JORNADA_DE_NOVE_HORAS, cobrancaDesde: null },
    )
    expect(dia).toMatchObject({ trabalhado: 420, abonado: 90 })
    expect(horasDoDia(dia)).toBe(510)
  })

  it('"outro motivo" não soma; o dia futuro não soma', () => {
    const outro = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00', '12:00'), [porHorario(SEGUNDA, '13:00', '17:00', { tipo: 'outro' })], REGRAS)
    expect(horasDoDia(outro)).toBe(240)
    const futuro = calcularSaldoDoDia('2026-12-01', [], [ausencia({ dia_inicio: '2026-12-01', dia_fim: '2026-12-01' })], REGRAS)
    expect(futuro.abonado).toBe(0)
    expect(horasDoDia(futuro)).toBe(0)
  })

  it('o dia incompleto soma zero, com ou sem atestado, e fica fora do abonado do total', () => {
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '08:00', '12:00', '13:00'), [porHorario(SEGUNDA, '16:00', '17:00')], REGRAS)
    expect(dia).toMatchObject({ estado: 'pendente', incompleto: true, abonado: 60 })
    expect(horasDoDia(dia)).toBe(0)
    expect(abonadoNoTotal([dia])).toBe(0)
  })

  it('abonadoNoTotal + o trabalhado do espelho = a soma das horas de cada dia', () => {
    const todas = [
      ...batidas('2026-10-05', ...DIA_NORMAL),
      ...saidaCedo,
      ...batidas('2026-10-07', '08:00', '12:00', '13:00'), // incompleto
    ]
    const ausencias = [atestadoDaTarde(), ausencia({ dia_inicio: '2026-10-08', dia_fim: '2026-10-08' })]
    const periodo = calcularSaldoDoPeriodo('2026-10-05', '2026-10-09', todas, ausencias, { ...REGRAS, cobrancaDesde: null })
    const espelho = montarEspelho('2026-10', todas)
    const somaDosDias = periodo.dias.reduce((soma, dia) => soma + horasDoDia(dia), 0)
    expect(espelho.minutos + abonadoNoTotal(periodo.dias)).toBe(somaDosDias)
    // 05: 8h; 06: 7h31 + 0h29 (16:31-17:00, jornada da semente); 07: incompleto; 08: atestado de 8h.
    expect(somaDosDias).toBe(480 + 451 + 29 + 480)
  })

  it('rotuloDoAbono diz de onde veio o abono', () => {
    const regras = { ...REGRAS, cobrancaDesde: null }
    const deAtestado = calcularSaldoDoDia(SEGUNDA, [], [ausencia()], regras)
    const deFalta = calcularSaldoDoDia('2026-10-27', [], [ausencia({ dia_inicio: '2026-10-27', dia_fim: '2026-10-27', tipo: 'falta_justificada' })], regras)
    expect(rotuloDoAbono([deAtestado])).toBe('de atestado')
    expect(rotuloDoAbono([deFalta])).toBe('de falta justificada')
    expect(rotuloDoAbono([deAtestado, deFalta])).toBe('abonadas')
    expect(rotuloDoAbono([])).toBe('abonadas')
  })
})

describe('o feriado nacional é dia sem jornada, como o fim de semana', () => {
  const FERIADO = '2026-10-12' // segunda-feira, Nossa Senhora Aparecida

  it('sem batida: nada de previsto, nada de falta, e o dia diz o nome do feriado', () => {
    const dia = calcularSaldoDoDia(FERIADO, [], [], REGRAS)
    expect(dia).toMatchObject({
      estado: 'cobranca',
      feriado: 'Nossa Senhora Aparecida',
      semJornada: true,
      previsto: 0,
      falta: false,
      saldo: 0,
      debito: 0,
    })
  })

  it('com batida: o trabalhado é crédito inteiro, como no sábado', () => {
    const dia = calcularSaldoDoDia(FERIADO, batidas(FERIADO, '08:00', '12:00'), [], REGRAS)
    expect(dia).toMatchObject({ semJornada: true, trabalhado: 240, saldo: 240, credito: 240 })
  })

  it('o atestado num feriado só marca: não há jornada para abonar', () => {
    const dia = calcularSaldoDoDia(FERIADO, [], [ausencia({ dia_inicio: FERIADO, dia_fim: FERIADO })], REGRAS)
    expect(dia.abonado).toBe(0)
    expect(dia.coberturas[0].minutosAbonados).toBe(0)
  })

  it('o nome do feriado vem em qualquer estado, até fora da cobrança', () => {
    const dia = calcularSaldoDoDia(FERIADO, [], [], { ...REGRAS, cobrancaDesde: null })
    expect(dia).toMatchObject({ estado: 'fora', feriado: 'Nossa Senhora Aparecida', semJornada: false })
  })

  it('o dia comum não tem feriado', () => {
    expect(calcularSaldoDoDia('2026-10-13', [], [], REGRAS).feriado).toBeNull()
  })

  it('o mês de outubro de 2026 tem uma falta a menos com o feriado', () => {
    const regras = { ...REGRAS, cobrancaDesde: '2026-10-01' }
    const comFeriado = calcularSaldoDoMes('2026-10', [], [], regras)
    const semFeriado = calcularSaldoDoMes('2026-10', [], [], { ...regras, feriadoDoDia: () => null })
    expect(semFeriado.resumo.faltas - comFeriado.resumo.faltas).toBe(1)
    expect(comFeriado.dias.find((dia) => dia.dia === FERIADO)?.falta).toBe(false)
  })

  it('feriadoDoDia troca a lista: um feriado da cidade também vira dia sem jornada', () => {
    const regras = { ...REGRAS, feriadoDoDia: (dia: string) => (dia === '2026-10-13' ? 'Aniversário da cidade' : null) }
    expect(calcularSaldoDoDia('2026-10-13', [], [], regras)).toMatchObject({ feriado: 'Aniversário da cidade', semJornada: true, falta: false })
    expect(calcularSaldoDoDia(FERIADO, [], [], regras)).toMatchObject({ feriado: null, falta: true })
  })
})

/* ------------------------------------------------------------------ */
/* As regras, montadas num lugar só                                    */
/* ------------------------------------------------------------------ */

describe('regrasDoSaldo: o primeiro dia cobrado é a mais nova entre a ficha e a configuração', () => {
  /** A configuração como `lerConfiguracao` a entrega, só com o que o saldo lê. */
  const CONFIGURACAO = { jornada: JORNADA_SEMENTE, toleranciaMinutos: 10, saldoAPartirDe: '2026-10-15' }
  const HOJE = '2026-10-30'

  it('ficha mais antiga que a configuração: a cobrança começa na data da configuração', () => {
    const regras = regrasDoSaldo(CONFIGURACAO, { jornada: null, batePontoDesde: '2025-03-10' }, HOJE)
    expect(regras.cobrancaDesde).toBe('2026-10-15')
    const mes = calcularSaldoDoMes('2026-10', [], [], regras)
    const doDia = (d: string) => mes.dias.find((dia) => dia.dia === d)!
    expect(doDia('2026-10-14')).toMatchObject({ estado: 'fora', motivoDeFora: 'antes_da_cobranca', falta: false, debito: 0 })
    expect(doDia('2026-10-15')).toMatchObject({ estado: 'cobranca', falta: true, debito: 480 })
    // De 15 a 29 de outubro: 11 dias úteis sem batida, nenhum feriado.
    expect(mes.resumo.faltas).toBe(11)
  })

  it('configuração mais antiga que a ficha: a cobrança começa na data da ficha', () => {
    const regras = regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: '2026-01-02' }, { jornada: null, batePontoDesde: '2026-10-26' }, HOJE)
    expect(regras.cobrancaDesde).toBe('2026-10-26')
    const mes = calcularSaldoDoMes('2026-10', [], [], regras)
    expect(mes.dias.find((dia) => dia.dia === '2026-10-23')).toMatchObject({ estado: 'fora', motivoDeFora: 'antes_da_cobranca' })
    // 26 a 29 de outubro: segunda a quinta; o dia 30 é hoje.
    expect(mes.resumo.faltas).toBe(4)
  })

  it('as duas datas iguais: a cobrança começa nelas', () => {
    expect(inicioDaCobranca('2026-10-15', '2026-10-15')).toBe('2026-10-15')
  })

  it('ficha sem a data: nenhum dia é cobrado, por mais antiga que seja a da configuração', () => {
    const regras = regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: '2020-01-01' }, { jornada: null, batePontoDesde: null }, HOJE)
    expect(regras.cobrancaDesde).toBeNull()
    expect(inicioDaCobranca(null, '2020-01-01')).toBeNull()
    const mes = calcularSaldoDoMes('2026-10', [], [], regras)
    expect(mes.dias.every((dia) => dia.estado === 'fora' && !dia.falta)).toBe(true)
    expect(mes.resumo).toMatchObject({ faltas: 0, debito: 0, credito: 0, saldo: 0, diasDeCobranca: 0 })
  })

  it('a conta sem ficha ligada segue a jornada da empresa e não tem dia cobrado', () => {
    const regras = regrasDoSaldo(CONFIGURACAO, null, HOJE)
    expect(regras).toEqual({
      jornadaDaEmpresa: JORNADA_SEMENTE,
      jornadaPropria: null,
      cobrancaDesde: null,
      toleranciaMinutos: 10,
      hoje: HOJE,
    })
  })

  it('a configuração recuada passa a cobrar os dias desde ela, inclusive as faltas', () => {
    const ficha = { jornada: null, batePontoDesde: '2020-03-02' }
    const hoje = '2026-10-21'
    // A data que a atualização gravou: hoje. Nada de outubro é cobrado.
    const antes = calcularSaldoDoMes('2026-10', [], [], regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: hoje }, ficha, hoje))
    expect(antes.resumo).toMatchObject({ faltas: 0, debito: 0, diasDeCobranca: 0 })
    // Quem administra recua a data para o começo do mês: os dias úteis de 1 a
    // 20 viram faltas, menos o feriado de 12/10.
    const recuada = regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: '2026-10-01' }, ficha, hoje)
    expect(recuada.cobrancaDesde).toBe('2026-10-01')
    const depois = calcularSaldoDoMes('2026-10', [], [], recuada)
    expect(depois.resumo.faltas).toBe(13)
    expect(depois.resumo.debito).toBe(13 * 480)
    expect(depois.dias.find((dia) => dia.dia === '2026-10-12')).toMatchObject({ feriado: 'Nossa Senhora Aparecida', falta: false })
  })

  it('a jornada própria e a tolerância vêm de onde moram: a ficha e a configuração', () => {
    const propria: Jornada = ([1, 2, 3, 4, 5] as const).map((dia) => ({ dia, inicio: '09:00', fim: '15:00' }))
    const regras = regrasDoSaldo({ ...CONFIGURACAO, toleranciaMinutos: 5 }, { jornada: propria, batePontoDesde: '2026-10-01' }, HOJE)
    expect(regras).toMatchObject({ jornadaDaEmpresa: JORNADA_SEMENTE, jornadaPropria: propria, toleranciaMinutos: 5, hoje: HOJE })
    const dia = calcularSaldoDoDia(SEGUNDA, batidas(SEGUNDA, '09:00', '14:54'), [], regras)
    expect(dia).toMatchObject({ previsto: 360, saldoBruto: -6, saldo: -6 })
  })

  it('ficha de 2020 e configuração de hoje: nenhum mês anterior tem falta nem saldo', () => {
    const hoje = '2026-11-03'
    const regras = regrasDoSaldo({ ...CONFIGURACAO, saldoAPartirDe: hoje }, { jornada: null, batePontoDesde: '2020-03-02' }, hoje)
    expect(regras.cobrancaDesde).toBe(hoje)
    // Um dia curto e um dia sem batida em cada mês: cobrados, seriam débito e falta.
    let meses = 0
    for (let mes = '2020-03'; mes < '2026-11'; mes = mesSeguinte(mes)) {
      const curto = `${mes}-10`
      const doMes = calcularSaldoDoMes(mes, batidas(curto, '08:00', '12:00'), [], regras)
      expect(doMes.dias.every((dia) => dia.estado === 'fora' && dia.motivoDeFora === 'antes_da_cobranca' && !dia.falta)).toBe(true)
      expect(doMes.resumo).toEqual({
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
      })
      // O trabalhado continua à vista: só não é cobrado.
      expect(doMes.trabalhadoNoMes).toBe(240)
      meses += 1
    }
    expect(meses).toBe(80)
    // No mês de hoje, os dias de antes também ficam fora, e hoje já está em andamento.
    const novembro = calcularSaldoDoMes('2026-11', [], [], regras)
    expect(novembro.dias.find((dia) => dia.dia === '2026-11-02')).toMatchObject({ estado: 'fora', motivoDeFora: 'antes_da_cobranca', falta: false })
    expect(novembro.dias.find((dia) => dia.dia === hoje)).toMatchObject({ estado: 'em_andamento', previsto: 480, falta: false, debito: 0 })
    expect(novembro.resumo.faltas).toBe(0)
  })
})
