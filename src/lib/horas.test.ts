import { describe, expect, it } from 'vitest'
import type { Batida, TipoDeBatida } from './batidas'
import {
  agruparPorDia,
  calcularDia,
  formatarDuracao,
  mesAnterior,
  mesDe,
  mesSeguinte,
  montarEspelho,
  primeiroDiaDoMes,
  resumirDias,
  rotuloDoMes,
  ultimoDiaDoMes,
} from './horas'

/*
 * Os cenários de cálculo de horas, mais os casos de borda que a conta precisa
 * aguentar.
 *
 * O QUE NÃO ESTÁ AQUI, E POR QUÊ
 * Dedução do tipo pela ordem do dia, distância entre coordenadas, ponto na
 * borda do raio, guarda do PIN, contagem de tentativas e duplicidade são lógica
 * de BANCO: vivem em funções e gatilhos PL/pgSQL e são provados contra o banco,
 * nos testes de banco. Reescrevê-los em TypeScript criaria uma segunda
 * implementação que ninguém executa — e um teste verde sobre uma cópia é pior
 * do que teste nenhum, porque dá a impressão de que a regra de verdade está
 * coberta.
 */

/** Uma batida com o mínimo preenchido. O resto do tipo vem com valores neutros. */
function batida(
  dia: string,
  hora: string,
  extras: Partial<Batida> = {},
): Batida {
  return {
    id: `${dia}T${hora}`,
    // Offset explícito de Brasília: a batida é carimbada pelo servidor e lida
    // como `dia_civil` em America/Sao_Paulo. Escrever a hora local com o `-03:00`
    // junto deixa o teste legível sem depender do fuso de quem roda.
    registrado_em: `${dia}T${hora}:00.000-03:00`,
    dia_civil: dia,
    tipo: 'entrada',
    ordem_no_dia: 1,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    distancia_metros: null,
    no_local: null,
    selfie_path: null,
    ajuste_manual: false,
    ...extras,
  }
}

/** Um dia de trabalho normal: entra, sai para o almoço, volta, sai. */
function diaDeQuatroBatidas(dia: string): Batida[] {
  const tipos: TipoDeBatida[] = ['entrada', 'saida_almoco', 'volta_almoco', 'saida']
  return ['08:00', '12:00', '13:00', '18:00'].map((hora, i) =>
    batida(dia, hora, { tipo: tipos[i], ordem_no_dia: i + 1 }),
  )
}

describe('total de horas do dia', () => {
  it('quatro batidas somam dois blocos, com o almoço fora', () => {
    // 08:00–12:00 (4h) + 13:00–18:00 (5h) = 9h. A hora do almoço não entra.
    const resultado = calcularDia('2026-08-03', diaDeQuatroBatidas('2026-08-03'))

    expect(resultado.blocos).toHaveLength(2)
    expect(resultado.incompleto).toBe(false)
    expect(resultado.minutos).toBe(9 * 60)
    expect(formatarDuracao(resultado.minutos)).toBe('9h00')
  })

  it('duas batidas somam um bloco só', () => {
    const resultado = calcularDia('2026-08-04', [
      batida('2026-08-04', '08:00', { tipo: 'entrada', ordem_no_dia: 1 }),
      batida('2026-08-04', '14:30', { tipo: 'saida_almoco', ordem_no_dia: 2 }),
    ])

    expect(resultado.blocos).toHaveLength(1)
    expect(resultado.incompleto).toBe(false)
    expect(resultado.minutos).toBe(6 * 60 + 30)
    expect(formatarDuracao(resultado.minutos)).toBe('6h30')
  })

  it('três batidas marcam o dia incompleto e contribuem com zero', () => {
    // A regra mais fácil de errar: não se soma o par que sobrou.
    // Com número ímpar não dá para saber QUAL batida falta — somar 08:00–12:00
    // seria afirmar que a pessoa entrou às 13:00 e nunca mais saiu, ou que
    // esqueceu a saída do almoço. As duas leituras são chute.
    const resultado = calcularDia('2026-08-05', [
      batida('2026-08-05', '08:00', { tipo: 'entrada', ordem_no_dia: 1 }),
      batida('2026-08-05', '12:00', { tipo: 'saida_almoco', ordem_no_dia: 2 }),
      batida('2026-08-05', '13:00', { tipo: 'volta_almoco', ordem_no_dia: 3 }),
    ])

    expect(resultado.incompleto).toBe(true)
    expect(resultado.minutos).toBe(0)
  })

  it('o dia incompleto some do total do mês, e os completos continuam contando', () => {
    const espelho = montarEspelho('2026-08', [
      ...diaDeQuatroBatidas('2026-08-03'),
      batida('2026-08-04', '08:00'),
      batida('2026-08-04', '12:00'),
      batida('2026-08-04', '13:00'),
      ...diaDeQuatroBatidas('2026-08-05'),
    ])

    expect(espelho.diasComBatida).toBe(3)
    expect(espelho.diasIncompletos).toBe(1)
    // 9h + 0h + 9h.
    expect(espelho.minutos).toBe(18 * 60)
    expect(formatarDuracao(espelho.minutos)).toBe('18h00')
  })

  it('o total do mês é exatamente a soma do que cada linha mostra', () => {
    // Sem isto, arredondar por bloco em vez de por dia faria o número do topo
    // discordar da conta que qualquer pessoa faz somando a coluna na mão.
    const espelho = montarEspelho('2026-08', [
      ...diaDeQuatroBatidas('2026-08-03'),
      ...diaDeQuatroBatidas('2026-08-06'),
    ])

    const somaDasLinhas = espelho.dias.reduce((total, dia) => total + dia.minutos, 0)
    expect(espelho.minutos).toBe(somaDasLinhas)
  })
})

describe('casos de borda', () => {
  it('dia sem batida nenhuma vale zero e NÃO é dia incompleto', () => {
    // Zero é par. Se a folga contasse como incompleta, todo sábado e domingo
    // apareceria marcado de amarelo e a marca perderia o sentido.
    const resultado = calcularDia('2026-08-09', [])

    expect(resultado.batidas).toHaveLength(0)
    expect(resultado.blocos).toHaveLength(0)
    expect(resultado.incompleto).toBe(false)
    expect(resultado.minutos).toBe(0)
  })

  it('dia com 5 batidas: a extra deixa o dia ímpar, e a sequência continua legível', () => {
    const cinco = [
      ...diaDeQuatroBatidas('2026-08-07'),
      batida('2026-08-07', '20:00', { tipo: 'extra', ordem_no_dia: 5 }),
    ]
    const resultado = calcularDia('2026-08-07', cinco)

    expect(resultado.incompleto).toBe(true)
    expect(resultado.minutos).toBe(0)
    // A 5ª não some nem embaralha as outras: as quatro primeiras seguem com o
    // tipo que o banco deduziu, na ordem, e a extra fica no fim.
    expect(resultado.batidas.map((b) => b.tipo)).toEqual([
      'entrada',
      'saida_almoco',
      'volta_almoco',
      'saida',
      'extra',
    ])
  })

  it('mês inteiro sem batida devolve espelho vazio, não erro', () => {
    const espelho = montarEspelho('2026-07', [])

    expect(espelho.mes).toBe('2026-07')
    expect(espelho.dias).toEqual([])
    expect(espelho.minutos).toBe(0)
    expect(espelho.diasComBatida).toBe(0)
    expect(espelho.diasIncompletos).toBe(0)
  })

  it('jornada que atravessa a meia-noite deixa os DOIS dias incompletos', () => {
    // Cada batida pertence ao dia em que foi feita — `dia_civil` vem do banco.
    // Os dois dias ficam com uma batida só, ímpares, e nenhum entra no total.
    const espelho = montarEspelho('2026-08', [
      batida('2026-08-10', '23:30', { tipo: 'entrada', ordem_no_dia: 1 }),
      batida('2026-08-11', '01:15', { tipo: 'entrada', ordem_no_dia: 1 }),
    ])

    expect(espelho.dias.map((dia) => dia.dia)).toEqual(['2026-08-10', '2026-08-11'])
    expect(espelho.dias.every((dia) => dia.incompleto)).toBe(true)
    expect(espelho.minutos).toBe(0)
  })

  it('o dia nunca sai com hora negativa, mesmo com as batidas embaralhadas', () => {
    const resultado = calcularDia('2026-08-12', [
      batida('2026-08-12', '18:00', { tipo: 'saida', ordem_no_dia: 2 }),
      batida('2026-08-12', '09:00', { tipo: 'entrada', ordem_no_dia: 1 }),
    ])

    expect(resultado.minutos).toBe(9 * 60)
    expect(resultado.batidas[0].tipo).toBe('entrada')
  })

  it('marca o dia que tem batida ajustada pelo admin', () => {
    // O painel e a folha dependem desta marca: o funcionário precisa enxergar o
    // ajuste no próprio espelho.
    const comAjuste = diaDeQuatroBatidas('2026-08-13')
    comAjuste[3] = { ...comAjuste[3], ajuste_manual: true }

    expect(calcularDia('2026-08-13', comAjuste).temAjuste).toBe(true)
    expect(calcularDia('2026-08-13', diaDeQuatroBatidas('2026-08-13')).temAjuste).toBe(false)
  })
})

describe('reuso pelo painel e pelo CSV — período livre, sem passar pelo mês', () => {
  it('agrupa e resume um intervalo que atravessa a troca do mês', () => {
    // O painel do admin e o CSV exportam "o período escolhido", que não é
    // necessariamente um mês. `agruparPorDia` + `resumirDias` são a mesma conta
    // do espelho, sem o recorte mensal — e é por elas que o painel e o CSV
    // entram, em vez de reescrever a soma.
    const dias = agruparPorDia([
      ...diaDeQuatroBatidas('2026-08-31'),
      ...diaDeQuatroBatidas('2026-09-01'),
      batida('2026-09-02', '08:00'),
    ])

    expect(dias.map((dia) => dia.dia)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02'])
    expect(resumirDias(dias)).toEqual({
      minutos: 18 * 60,
      diasComBatida: 3,
      diasIncompletos: 1,
    })
  })

  it('o espelho do mês é exatamente agrupar e resumir', () => {
    const batidas = [...diaDeQuatroBatidas('2026-08-03'), batida('2026-08-04', '08:00')]
    const espelho = montarEspelho('2026-08', batidas)
    const dias = agruparPorDia(batidas)

    expect(espelho.dias).toEqual(dias)
    expect({
      minutos: espelho.minutos,
      diasComBatida: espelho.diasComBatida,
      diasIncompletos: espelho.diasIncompletos,
    }).toEqual(resumirDias(dias))
  })
})

describe('recorte e navegação de meses', () => {
  it('o mês sai do dia civil do banco, não do relógio do aparelho', () => {
    expect(mesDe('2026-08-31')).toBe('2026-08')
  })

  it('o intervalo cobre o mês inteiro, inclusive fevereiro bissexto', () => {
    expect(primeiroDiaDoMes('2026-08')).toBe('2026-08-01')
    expect(ultimoDiaDoMes('2026-08')).toBe('2026-08-31')
    expect(ultimoDiaDoMes('2026-02')).toBe('2026-02-28')
    expect(ultimoDiaDoMes('2028-02')).toBe('2028-02-29')
    expect(ultimoDiaDoMes('2026-04')).toBe('2026-04-30')
  })

  it('a troca de mês atravessa a passagem do ano', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12')
    expect(mesSeguinte('2025-12')).toBe('2026-01')
    expect(mesAnterior('2026-09')).toBe('2026-08')
    expect(mesSeguinte('2026-08')).toBe('2026-09')
  })

  it('mês malformado falha alto, em vez de virar NaN na consulta', () => {
    expect(() => primeiroDiaDoMes('2026-8')).toThrow(/Mês inválido/)
    expect(() => ultimoDiaDoMes('2026-13')).toThrow(/Mês inválido/)
    expect(() => mesDe('31/08/2026')).toThrow(/Dia inválido/)
  })

  it('o rótulo do mês sai em português, com inicial maiúscula', () => {
    expect(rotuloDoMes('2026-08')).toBe('Agosto de 2026')
  })
})

describe('formatação da duração', () => {
  it('escreve horas e minutos com dois dígitos no resto', () => {
    expect(formatarDuracao(0)).toBe('0h00')
    expect(formatarDuracao(9)).toBe('0h09')
    expect(formatarDuracao(60)).toBe('1h00')
    expect(formatarDuracao(492)).toBe('8h12')
    expect(formatarDuracao(10_125)).toBe('168h45')
  })
})
