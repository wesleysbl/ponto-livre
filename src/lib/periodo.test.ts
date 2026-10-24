import { describe, expect, it } from 'vitest'
import {
  apelidoDoPeriodo,
  ehMesInteiro,
  ehPeriodoValido,
  lerPeriodo,
  parametrosDoPeriodo,
  periodoDoMes,
  rotuloDoPeriodo,
} from './periodo'
import { ehDiaValido, ehMesValido } from './horas'

/*
 * A BORDA DO PERÍODO QUE VEM DA URL.
 *
 * `montarEspelho` e `primeiroDiaDoMes` levantam exceção com entrada
 * malformada — e é certo que levantem. O que não pode é isso acontecer dentro
 * do render. Pelas setas do espelho o caso é inalcançável; no painel do admin,
 * o período mora na URL e qualquer pessoa digita `?de=2026-13-40`. Estes testes
 * são o contrato de que a leitura da URL NUNCA levanta e sempre devolve um
 * período utilizável.
 */

const AGOSTO = { inicio: '2026-08-01', fim: '2026-08-31' }

describe('o que é dia e o que é mês', () => {
  it('reconhece o formato certo e recusa o resto', () => {
    expect(ehDiaValido('2026-08-31')).toBe(true)
    expect(ehDiaValido('2028-02-29')).toBe(true) // ano bissexto existe
    expect(ehDiaValido('2026-8-1')).toBe(false)
    expect(ehDiaValido('31/08/2026')).toBe(false)
    expect(ehDiaValido('')).toBe(false)
  })

  it('recusa a data que o calendário não tem, e não a empurra para o mês seguinte', () => {
    // `new Date(2026, 1, 30)` devolve 2 de março calado. Aqui, 30 de fevereiro
    // simplesmente não é dia — senão o painel mostraria março achando que é
    // fevereiro.
    expect(ehDiaValido('2026-02-30')).toBe(false)
    expect(ehDiaValido('2026-02-29')).toBe(false) // 2026 não é bissexto
    expect(ehDiaValido('2026-13-01')).toBe(false)
    expect(ehDiaValido('2026-04-31')).toBe(false)
  })

  it('mês só existe de 01 a 12', () => {
    expect(ehMesValido('2026-08')).toBe(true)
    expect(ehMesValido('2026-13')).toBe(false)
    expect(ehMesValido('2026-00')).toBe(false)
    expect(ehMesValido('2026-8')).toBe(false)
  })
})

describe('leitura do período que veio da URL', () => {
  it('lê os dois lados quando os dois são válidos', () => {
    expect(lerPeriodo('2026-08-01', '2026-08-31', AGOSTO)).toEqual(AGOSTO)
  })

  it('período de um dia só é período', () => {
    expect(lerPeriodo('2026-08-15', '2026-08-15', AGOSTO)).toEqual({
      inicio: '2026-08-15',
      fim: '2026-08-15',
    })
  })

  it('datas invertidas são trocadas, não recusadas', () => {
    // Arrastar as duas datas na ordem errada é acidente comum, e o que a pessoa
    // quis dizer é óbvio.
    expect(lerPeriodo('2026-08-31', '2026-08-01', AGOSTO)).toEqual(AGOSTO)
  })

  it('URL malformada cai no padrão em vez de derrubar a tela', () => {
    // A armadilha do cabeçalho, fechada: nenhum destes levanta.
    expect(lerPeriodo('2026-13', '2026-13-40', AGOSTO)).toEqual(AGOSTO)
    expect(lerPeriodo('lixo', 'lixo', AGOSTO)).toEqual(AGOSTO)
    expect(lerPeriodo('2026-02-30', '2026-03-01', AGOSTO)).toEqual(AGOSTO)
    expect(lerPeriodo(null, null, AGOSTO)).toEqual(AGOSTO)
    expect(lerPeriodo(undefined, undefined, AGOSTO)).toEqual(AGOSTO)
    expect(lerPeriodo('', '', AGOSTO)).toEqual(AGOSTO)
  })

  it('metade válida também cai no padrão inteiro', () => {
    // Aproveitar só a metade boa daria um período que ninguém pediu, com cara
    // de escolhido. Voltar ao padrão é visível: a tela mostra o mês por extenso.
    expect(lerPeriodo('2026-08-01', 'lixo', AGOSTO)).toEqual(AGOSTO)
    expect(lerPeriodo(null, '2026-08-31', AGOSTO)).toEqual(AGOSTO)
  })

  it('a ida e a volta pela URL preservam o período', () => {
    const escolhido = { inicio: '2026-07-26', fim: '2026-08-25' }
    const { de, ate } = parametrosDoPeriodo(escolhido)
    expect(lerPeriodo(de, ate, AGOSTO)).toEqual(escolhido)
  })
})

describe('o período por extenso', () => {
  it('mês fechado sai como mês, não como duas datas', () => {
    expect(rotuloDoPeriodo(AGOSTO)).toBe('Agosto de 2026')
    expect(rotuloDoPeriodo(periodoDoMes('2026-02'))).toBe('Fevereiro de 2026')
  })

  it('um dia só sai como o dia', () => {
    expect(rotuloDoPeriodo({ inicio: '2026-08-15', fim: '2026-08-15' })).toBe('15/08/2026')
  })

  it('recorte livre sai com as duas pontas em DD/MM/AAAA', () => {
    expect(rotuloDoPeriodo({ inicio: '2026-07-26', fim: '2026-08-25' })).toBe(
      '26/07/2026 a 25/08/2026',
    )
  })

  it('período impossível vira frase, e não exceção dentro do render', () => {
    expect(rotuloDoPeriodo({ inicio: '2026-13-40', fim: 'lixo' })).toBe('período inválido')
    expect(ehPeriodoValido({ inicio: '2026-08-31', fim: '2026-08-01' })).toBe(false)
  })
})

describe('mês inteiro e nome de arquivo', () => {
  it('reconhece o mês fechado, inclusive fevereiro', () => {
    expect(ehMesInteiro(AGOSTO)).toBe(true)
    expect(ehMesInteiro(periodoDoMes('2028-02'))).toBe(true)
    expect(ehMesInteiro({ inicio: '2026-08-01', fim: '2026-08-30' })).toBe(false)
    expect(ehMesInteiro({ inicio: '2026-08-02', fim: '2026-08-31' })).toBe(false)
  })

  it('o apelido do período ordena sozinho na pasta de downloads', () => {
    expect(apelidoDoPeriodo(AGOSTO)).toBe('2026-08')
    expect(apelidoDoPeriodo({ inicio: '2026-08-26', fim: '2026-09-25' })).toBe(
      '2026-08-26-a-2026-09-25',
    )
  })
})
