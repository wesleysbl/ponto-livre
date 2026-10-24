import { describe, expect, it } from 'vitest'
import {
  ancoraDoDia,
  diaDoBotaoDoTopo,
  diaInicialDaCaixa,
  ehFimDeSemana,
  limitesDaCaixa,
  listarDiasDoPeriodo,
  rotuloDoCorrigirPonto,
  TETO_DE_DIAS_NA_LISTA,
  validarMomentoDaCaixa,
} from './corrigir'
import { ausenciasPorDia, type Ausencia } from './ausencias'
import type { Batida } from './formato'
import { agruparPorDia, resumirDias } from './horas'

/*
 * CORRIGIR QUALQUER DIA.
 *
 * O defeito que estes testes evitam: se a tela da pessoa listasse só os dias
 * com batida, o RH não teria onde lançar um sábado vazio (nos testes, o sábado
 * 17/10, visto na terça 20/10/2026). Os testes fixam:
 *  • a lista de dias: meses de 28, 30 e 31 dias, o mês corrente cortado em
 *    hoje, o teto de 62 dias, o fim de semana, o dia vazio e o dia só com
 *    ausência;
 *  • o resumo do topo, que não muda com os dias vazios;
 *  • a data da caixa e os limites dela, ao inserir e ao corrigir.
 *
 * "Hoje" e "agora" são injetados, sempre com o deslocamento de Brasília por
 * extenso: as regras não podem depender do relógio nem do fuso de quem roda o
 * teste — o mesmo defeito pegaria o RH num notebook com o fuso errado.
 */

const HOJE = '2026-10-20'

/** Um instante em Brasília: `('2026-10-20', '10:05:30')`. */
function brasilia(dia: string, hora: string): Date {
  return new Date(`${dia}T${hora}-03:00`)
}

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

function diaCompleto(dia: string): Batida[] {
  return ['08:00', '12:00', '13:00', '18:00'].map((hora, i) => batida(dia, hora, i + 1))
}

function ausencia(inicio: string, fim: string, extras: Partial<Ausencia> = {}): Ausencia {
  return {
    id: `a-${inicio}`,
    usuario_id: 'u1',
    dia_inicio: inicio,
    dia_fim: fim,
    tipo: 'atestado_medico',
    observacao: null,
    atestado_path: null,
    lancado_por: 'admin-1',
    lancado_em: '2026-10-17T12:00:00.000Z',
    cancelada_em: null,
    cancelada_por: null,
    motivo_cancelamento: null,
    ...extras,
  }
}

/** A lista como a tela da pessoa a monta: batidas agrupadas e ausências do período. */
function lista(periodo: { inicio: string; fim: string }, batidas: Batida[] = [], ausencias: Ausencia[] = [], hoje = HOJE) {
  return listarDiasDoPeriodo({
    periodo,
    dias: agruparPorDia(batidas),
    ausenciasPorDia: ausenciasPorDia(ausencias, periodo),
    hoje,
  })
}

describe('a lista de dias da tela da pessoa', () => {
  it('agosto de 2026 (31 dias), visto em outubro, lista os 31 — com e sem batida', () => {
    const agosto = { inicio: '2026-08-01', fim: '2026-08-31' }
    const { dias, todosOsDias } = lista(agosto, [...diaCompleto('2026-08-03'), ...diaCompleto('2026-08-04')])
    expect(dias).toHaveLength(31)
    expect(todosOsDias).toBe(true)
    expect(dias[0].dia).toBe('2026-08-01')
    expect(dias.at(-1)?.dia).toBe('2026-08-31')
    expect(dias.filter((dia) => dia.batidas !== null).map((dia) => dia.dia)).toEqual(['2026-08-03', '2026-08-04'])
    expect(dias.some((dia) => dia.futuro)).toBe(false)
  })

  it('setembro de 2026 tem 30 dias, e fevereiro de 2026, 28 (de 2028, 29)', () => {
    expect(lista({ inicio: '2026-09-01', fim: '2026-09-30' }).dias).toHaveLength(30)
    expect(lista({ inicio: '2026-02-01', fim: '2026-02-28' }).dias).toHaveLength(28)
    expect(lista({ inicio: '2028-02-01', fim: '2028-02-29' }, [], [], '2028-03-10').dias).toHaveLength(29)
  })

  it('o mês corrente termina hoje: outubro visto em 20/10 tem 20 dias, nenhum futuro', () => {
    const { dias, todosOsDias } = lista({ inicio: '2026-10-01', fim: '2026-10-31' }, diaCompleto('2026-10-16'))
    expect(dias).toHaveLength(20)
    expect(todosOsDias).toBe(true)
    expect(dias.at(-1)?.dia).toBe(HOJE)
    expect(dias.every((dia) => !dia.futuro)).toBe(true)
  })

  it('o dia futuro só aparece com conteúdo — e marcado como futuro, para não ter o botão de inserir', () => {
    // Uma ausência lançada para a semana que vem continua na tela: escondê-la
    // apagaria da tela algo que existe. O dia vazio depois de hoje, não.
    const { dias } = lista({ inicio: '2026-10-01', fim: '2026-10-31' }, [], [ausencia('2026-10-26', '2026-10-26')])
    expect(dias).toHaveLength(21)
    const segunda = dias.find((dia) => dia.dia === '2026-10-26')
    expect(segunda?.futuro).toBe(true)
    expect(segunda?.ausencias).toHaveLength(1)
    expect(dias.filter((dia) => dia.futuro)).toHaveLength(1)
    expect(dias.some((dia) => dia.dia === '2026-10-21')).toBe(false)
  })

  it('o período inteiro no futuro não lista dia vazio nenhum', () => {
    expect(lista({ inicio: '2026-11-01', fim: '2026-11-30' }).dias).toEqual([])
  })

  it('o dia vazio vem sem batidas e sem ausências; o dia só com ausência, com ela e sem batidas', () => {
    const outubro = { inicio: '2026-10-01', fim: '2026-10-31' }
    const { dias } = lista(outubro, diaCompleto('2026-10-16'), [ausencia('2026-10-14', '2026-10-15')])
    const porDia = new Map(dias.map((dia) => [dia.dia, dia]))
    expect(porDia.get('2026-10-17')).toMatchObject({ batidas: null, ausencias: [] })
    expect(porDia.get('2026-10-14')?.batidas).toBeNull()
    expect(porDia.get('2026-10-14')?.ausencias.map((a) => a.id)).toEqual(['a-2026-10-14'])
    expect(porDia.get('2026-10-16')?.batidas?.batidas).toHaveLength(4)
  })

  it('a ausência cancelada não marca o dia: ele volta a ser um dia vazio', () => {
    const { dias } = lista({ inicio: '2026-10-01', fim: '2026-10-31' }, [], [
      ausencia('2026-10-14', '2026-10-14', { cancelada_em: '2026-10-18T10:00:00.000Z', cancelada_por: 'admin-1', motivo_cancelamento: 'lançada errada' }),
    ])
    expect(dias.find((dia) => dia.dia === '2026-10-14')).toMatchObject({ batidas: null, ausencias: [] })
  })

  it('sábado e domingo vêm marcados: 17 e 18/10 sim, sexta 16 e segunda 19 não', () => {
    const { dias } = lista({ inicio: '2026-10-16', fim: '2026-10-19' })
    expect(dias.map((dia) => [dia.dia, dia.fimDeSemana])).toEqual([
      ['2026-10-16', false],
      ['2026-10-17', true],
      ['2026-10-18', true],
      ['2026-10-19', false],
    ])
  })

  it(`até ${TETO_DE_DIAS_NA_LISTA} dias lista todos; com um a mais, só os dias com conteúdo`, () => {
    // Julho e agosto: 62 dias.
    const doisMeses = lista({ inicio: '2026-07-01', fim: '2026-08-31' }, diaCompleto('2026-08-03'))
    expect(doisMeses.dias).toHaveLength(62)
    expect(doisMeses.todosOsDias).toBe(true)

    const passou = lista(
      { inicio: '2026-07-01', fim: '2026-09-01' },
      diaCompleto('2026-08-03'),
      [ausencia('2026-07-10', '2026-07-10')],
    )
    expect(passou.todosOsDias).toBe(false)
    expect(passou.dias.map((dia) => dia.dia)).toEqual(['2026-07-10', '2026-08-03'])
  })

  it('o ano inteiro, colado de um link, também volta a mostrar só os dias com conteúdo', () => {
    const ano = lista({ inicio: '2026-01-01', fim: '2026-12-31' }, diaCompleto('2026-10-16'))
    expect(ano.todosOsDias).toBe(false)
    expect(ano.dias.map((dia) => dia.dia)).toEqual(['2026-10-16'])
  })
})

describe('o resumo do topo não muda com os dias vazios', () => {
  it('31 linhas na lista, e o topo continua dizendo 2 dias com batida, com os mesmos minutos', () => {
    const batidas = [...diaCompleto('2026-08-03'), batida('2026-08-04', '08:00')]
    const dias = agruparPorDia(batidas)
    const doAgrupamento = resumirDias(dias)
    const { dias: linhas } = lista({ inicio: '2026-08-01', fim: '2026-08-31' }, batidas)

    expect(linhas).toHaveLength(31)
    expect(doAgrupamento).toEqual({ minutos: 9 * 60, diasComBatida: 2, diasIncompletos: 1 })
    // Os dias com batida entram INTACTOS — o mesmo objeto de `agruparPorDia` —,
    // e o resumo feito com eles é o mesmo que sai direto do agrupamento.
    const comBatida = linhas.flatMap((linha) => (linha.batidas ? [linha.batidas] : []))
    expect(resumirDias(comBatida)).toEqual(doAgrupamento)
    expect(comBatida.map((dia) => dia.minutos)).toEqual(dias.map((dia) => dia.minutos))
  })
})

describe('a âncora e o fim de semana', () => {
  it('a âncora de cada dia é "dia-AAAA-MM-DD"', () => {
    expect(ancoraDoDia('2026-10-17')).toBe('dia-2026-10-17')
  })

  it('fim de semana pela data, sem depender do fuso; texto que não é dia não é fim de semana', () => {
    expect(ehFimDeSemana('2026-10-17')).toBe(true)
    expect(ehFimDeSemana('2026-10-18')).toBe(true)
    expect(ehFimDeSemana('2026-10-20')).toBe(false)
    expect(ehFimDeSemana('2026-02-30')).toBe(false)
  })
})

describe('a data com que a caixa de batida abre', () => {
  it('pelo botão do topo: hoje, se hoje está no período', () => {
    expect(diaDoBotaoDoTopo({ inicio: '2026-10-01', fim: '2026-10-31' }, HOJE)).toBe(HOJE)
  })

  it('pelo botão do topo: o último dia do período, se o período já passou', () => {
    expect(diaDoBotaoDoTopo({ inicio: '2026-08-01', fim: '2026-08-31' }, HOJE)).toBe('2026-08-31')
  })

  it('pelo botão do topo, num período inteiro no futuro: hoje, o dia mais perto que a caixa aceita', () => {
    expect(diaDoBotaoDoTopo({ inicio: '2026-11-01', fim: '2026-11-30' }, HOJE)).toBe(HOJE)
  })

  it('ao inserir num dia da lista, o dia escolhido — o sábado vazio inclusive', () => {
    expect(diaInicialDaCaixa({ nome: 'inserir', diaSugerido: '2026-10-17' })).toBe('2026-10-17')
  })

  it('ao corrigir, o dia da batida', () => {
    expect(diaInicialDaCaixa({ nome: 'corrigir', batida: { dia_civil: '2026-10-16' } })).toBe('2026-10-16')
  })
})

describe('os limites da caixa, ao inserir e ao corrigir', () => {
  // Terça, 20/10/2026, 10h05m30 em Brasília.
  const AGORA = brasilia(HOJE, '10:05:30')

  it('os campos: o dia vai até hoje; a hora só tem teto quando o dia é hoje', () => {
    expect(limitesDaCaixa(HOJE, AGORA)).toEqual({ diaMaximo: HOJE, horaMaxima: '10:05' })
    expect(limitesDaCaixa('2026-10-17', AGORA)).toEqual({ diaMaximo: HOJE, horaMaxima: undefined })
  })

  it.each(['inserir', 'corrigir'] as const)('%s: dia passado aceita qualquer hora, 23:59 inclusive', (modo) => {
    const resultado = validarMomentoDaCaixa({ modo, dia: '2026-10-17', hora: '23:59', agora: AGORA })
    expect(resultado).toEqual({ ok: true, momentoISO: '2026-10-18T02:59:00.000Z' })
  })

  it.each(['inserir', 'corrigir'] as const)('%s: dia futuro é recusado, com a frase do dia', (modo) => {
    const resultado = validarMomentoDaCaixa({ modo, dia: '2026-10-21', hora: '08:00', agora: AGORA })
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) expect(resultado.erro).toMatch(/Esse dia ainda não chegou/)
  })

  it.each(['inserir', 'corrigir'] as const)('%s: hoje, hora futura é recusada; o minuto de agora e antes passam', (modo) => {
    const futura = validarMomentoDaCaixa({ modo, dia: HOJE, hora: '10:06', agora: AGORA })
    expect(futura.ok).toBe(false)
    if (!futura.ok) expect(futura.erro).toMatch(/Esse horário ainda não chegou.*10:05/)

    expect(validarMomentoDaCaixa({ modo, dia: HOJE, hora: '10:05', agora: AGORA }).ok).toBe(true)
    expect(validarMomentoDaCaixa({ modo, dia: HOJE, hora: '08:00', agora: AGORA }).ok).toBe(true)
  })

  it('a frase diz o que se estava fazendo: inserir ou corrigir', () => {
    const inserir = validarMomentoDaCaixa({ modo: 'inserir', dia: HOJE, hora: '23:00', agora: AGORA })
    const corrigir = validarMomentoDaCaixa({ modo: 'corrigir', dia: HOJE, hora: '23:00', agora: AGORA })
    expect(inserir.ok || inserir.erro).toMatch(/batida inserida/)
    expect(corrigir.ok || corrigir.erro).toMatch(/correção/)
  })

  it('"hoje" é o de Brasília: às 23h30 de 20/10 em Brasília (já 21/10 em UTC), 21/10 ainda é futuro', () => {
    const quaseMeiaNoite = brasilia(HOJE, '23:30:00')
    expect(quaseMeiaNoite.toISOString().slice(0, 10)).toBe('2026-10-21')
    expect(limitesDaCaixa(HOJE, quaseMeiaNoite)).toEqual({ diaMaximo: HOJE, horaMaxima: '23:30' })
    expect(validarMomentoDaCaixa({ modo: 'inserir', dia: '2026-10-21', hora: '00:10', agora: quaseMeiaNoite }).ok).toBe(false)
    expect(validarMomentoDaCaixa({ modo: 'inserir', dia: HOJE, hora: '23:15', agora: quaseMeiaNoite }).ok).toBe(true)
  })

  it('hora fora do formato e dia que não existe são recusados antes de virar instante', () => {
    const hora = validarMomentoDaCaixa({ modo: 'inserir', dia: '2026-10-17', hora: '8:00', agora: AGORA })
    expect(hora.ok || hora.erro).toMatch(/HH:MM/)
    const dia = validarMomentoDaCaixa({ modo: 'corrigir', dia: '2026-02-30', hora: '08:00', agora: AGORA })
    expect(dia.ok || dia.erro).toMatch(/calendário/)
  })
})

describe('o botão "Corrigir ponto" da tela de bater', () => {
  it('sem pedido esperando (ou sem a contagem), só "Corrigir ponto"', () => {
    expect(rotuloDoCorrigirPonto(null)).toBe('Corrigir ponto')
    expect(rotuloDoCorrigirPonto(0)).toBe('Corrigir ponto')
  })

  it('com pedido esperando, a contagem, no singular e no plural', () => {
    expect(rotuloDoCorrigirPonto(1)).toBe('Corrigir ponto · 1 pedido esperando')
    expect(rotuloDoCorrigirPonto(2)).toBe('Corrigir ponto · 2 pedidos esperando')
  })
})
