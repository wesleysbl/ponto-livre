import { describe, expect, it } from 'vitest'
import { domingoDePascoa, feriadoNacional, feriadosNacionais } from './feriados'

/*
 * OS FERIADOS NACIONAIS: a segunda 12/10/2026 é Nossa Senhora Aparecida, e a
 * tela tem de dizer "feriado" nela, como diz "fim de semana" no sábado.
 */

describe('domingoDePascoa', () => {
  it('bate com as datas publicadas da Páscoa', () => {
    expect(domingoDePascoa(2000)).toBe('2000-04-23')
    expect(domingoDePascoa(2019)).toBe('2019-04-21')
    expect(domingoDePascoa(2024)).toBe('2024-03-31')
    expect(domingoDePascoa(2025)).toBe('2025-04-20')
    expect(domingoDePascoa(2026)).toBe('2026-04-05')
    expect(domingoDePascoa(2027)).toBe('2027-03-28')
    expect(domingoDePascoa(2038)).toBe('2038-04-25')
  })
})

describe('feriadoNacional', () => {
  it('o caso que abriu o módulo: 12/10/2026 é Nossa Senhora Aparecida', () => {
    expect(feriadoNacional('2026-10-12')).toBe('Nossa Senhora Aparecida')
  })

  it('o dia comum não é feriado', () => {
    expect(feriadoNacional('2026-10-13')).toBeNull()
    expect(feriadoNacional('2026-10-11')).toBeNull()
  })

  it('a Paixão de Cristo anda com a Páscoa: a sexta antes do domingo', () => {
    expect(feriadoNacional('2026-04-03')).toBe('Paixão de Cristo')
    expect(feriadoNacional('2027-03-26')).toBe('Paixão de Cristo')
    expect(feriadoNacional('2026-04-05')).toBeNull() // o domingo de Páscoa em si não é feriado à parte
  })

  it('Carnaval e Corpus Christi são ponto facultativo, não feriado', () => {
    expect(feriadoNacional('2026-02-16')).toBeNull() // segunda de Carnaval
    expect(feriadoNacional('2026-02-17')).toBeNull() // terça de Carnaval
    expect(feriadoNacional('2026-06-04')).toBeNull() // Corpus Christi
  })

  it('a Consciência Negra é feriado nacional de 2024 em diante', () => {
    expect(feriadoNacional('2023-11-20')).toBeNull()
    expect(feriadoNacional('2024-11-20')).toBe('Consciência Negra')
    expect(feriadoNacional('2026-11-20')).toBe('Consciência Negra')
  })

  it('data inválida não é feriado (e não quebra)', () => {
    expect(feriadoNacional('')).toBeNull()
    expect(feriadoNacional('2026-13-01')).toBeNull()
    expect(feriadoNacional('12/10/2026')).toBeNull()
  })
})

describe('feriadosNacionais', () => {
  it('2026 tem os dez, em ordem de data', () => {
    expect(feriadosNacionais(2026)).toEqual([
      { dia: '2026-01-01', nome: 'Confraternização Universal' },
      { dia: '2026-04-03', nome: 'Paixão de Cristo' },
      { dia: '2026-04-21', nome: 'Tiradentes' },
      { dia: '2026-05-01', nome: 'Dia do Trabalho' },
      { dia: '2026-09-07', nome: 'Independência do Brasil' },
      { dia: '2026-10-12', nome: 'Nossa Senhora Aparecida' },
      { dia: '2026-11-02', nome: 'Finados' },
      { dia: '2026-11-15', nome: 'Proclamação da República' },
      { dia: '2026-11-20', nome: 'Consciência Negra' },
      { dia: '2026-12-25', nome: 'Natal' },
    ])
  })

  it('2023 tem nove: a Consciência Negra ainda não era nacional', () => {
    expect(feriadosNacionais(2023)).toHaveLength(9)
  })
})
