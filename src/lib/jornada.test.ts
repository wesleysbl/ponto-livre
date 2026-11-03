import { describe, expect, it } from 'vitest'
import {
  cargaDeReferencia,
  diaDaSemanaIso,
  horaDosMinutos,
  JORNADA_SEMENTE,
  jornadaAplicavel,
  lerJornada,
  lerJornadaPropria,
  minutosDaHora,
  minutosDaHoraDaJornada,
  problemaDaJornada,
  totalDoDiaDaSemana,
  trechosDoDia,
  type Jornada,
} from './jornada'

/*
 * A JORNADA: a leitura do jsonb e o espelho de `ponto_jornada_problema` (na
 * migration da jornada e do saldo). Cada recusa do banco tem aqui a mesma
 * recusa, na mesma ordem: a primeira coisa errada é a que sai.
 */

describe('as horas', () => {
  it('a hora da jornada é HH:MM de 00:00 a 23:59, e só isso', () => {
    expect(minutosDaHoraDaJornada('08:00')).toBe(480)
    expect(minutosDaHoraDaJornada('23:59')).toBe(1439)
    expect(minutosDaHoraDaJornada('24:00')).toBeNull()
    expect(minutosDaHoraDaJornada('8:00')).toBeNull()
    expect(minutosDaHoraDaJornada('08:00:00')).toBeNull()
  })

  it('a hora da ausência vem com ou sem segundos (o PostgREST devolve "14:00:00")', () => {
    expect(minutosDaHora('14:00:00')).toBe(840)
    expect(minutosDaHora('14:00')).toBe(840)
    expect(minutosDaHora('14:00:30')).toBe(840.5)
    expect(minutosDaHora('14:00:00.000000')).toBe(840)
    expect(minutosDaHora('25:00')).toBeNull()
    expect(minutosDaHora('')).toBeNull()
  })

  it('horaDosMinutos escreve de volta', () => {
    expect(horaDosMinutos(840)).toBe('14:00')
    expect(horaDosMinutos(0)).toBe('00:00')
    expect(horaDosMinutos(1440)).toBe('24:00')
  })
})

describe('o espelho de ponto_jornada_problema', () => {
  it('a semente vale', () => {
    expect(problemaDaJornada(JORNADA_SEMENTE)).toBeNull()
    expect(JORNADA_SEMENTE).toHaveLength(10)
  })

  it('nula, não lista e vazia', () => {
    expect(problemaDaJornada(null)).toBe('Jornada inválida: a jornada está vazia.')
    expect(problemaDaJornada({ dia: 1 })).toMatch(/é uma lista de blocos/)
    expect(problemaDaJornada([])).toMatch(/nenhum bloco\. Para seguir a jornada da empresa/)
  })

  it('cada bloco tem dia, início e fim, e nada mais', () => {
    expect(problemaDaJornada(['08:00'])).toMatch(/cada bloco tem dia, início e fim/)
    expect(problemaDaJornada([{ dia: 1, inicio: '08:00' }])).toMatch(/cada bloco tem dia, início e fim/)
    expect(problemaDaJornada([{ dia: 1, inicio: '08:00', fim: '12:00', extra: true }])).toMatch(
      /cada bloco tem dia, início e fim/,
    )
  })

  it('o dia da semana vai de 1 a 7, como número', () => {
    expect(problemaDaJornada([{ dia: 8, inicio: '08:00', fim: '12:00' }])).toBe(
      'Jornada inválida: o dia da semana 8 não existe (1 = segunda a 7 = domingo).',
    )
    expect(problemaDaJornada([{ dia: '1', inicio: '08:00', fim: '12:00' }])).toMatch(/o dia da semana "1" não existe/)
    expect(problemaDaJornada([{ dia: 0, inicio: '08:00', fim: '12:00' }])).toMatch(/o dia da semana 0 não existe/)
    expect(problemaDaJornada([{ dia: 1.5, inicio: '08:00', fim: '12:00' }])).toMatch(/não existe/)
  })

  it('horário fora do formato', () => {
    expect(problemaDaJornada([{ dia: 1, inicio: '8:00', fim: '12:00' }])).toBe(
      'Jornada inválida: no dia 1 (segunda), o horário "8:00" a "12:00" não está no formato HH:MM (de 00:00 a 23:59).',
    )
    expect(problemaDaJornada([{ dia: 6, inicio: '08:00', fim: '24:00' }])).toMatch(/no dia 6 \(sábado\)/)
  })

  it('o fim precisa ser depois do início (duração zero também é recusada)', () => {
    expect(problemaDaJornada([{ dia: 3, inicio: '12:00', fim: '08:00' }])).toBe(
      'Jornada inválida: no dia 3 (quarta), o bloco 12:00-08:00 não termina depois de começar (o fim precisa ser depois do início).',
    )
    expect(problemaDaJornada([{ dia: 3, inicio: '08:00', fim: '08:00' }])).toMatch(/não termina depois de começar/)
  })

  it('no máximo dois blocos por dia', () => {
    expect(
      problemaDaJornada([
        { dia: 2, inicio: '08:00', fim: '10:00' },
        { dia: 2, inicio: '10:00', fim: '12:00' },
        { dia: 2, inicio: '13:00', fim: '15:00' },
      ]),
    ).toBe('Jornada inválida: no dia 2 (terça) há 3 blocos (no máximo dois por dia).')
  })

  it('blocos do mesmo dia não se cruzam; encostar pode', () => {
    expect(
      problemaDaJornada([
        { dia: 1, inicio: '13:00', fim: '17:00' },
        { dia: 1, inicio: '08:00', fim: '13:30' },
      ]),
    ).toBe(
      'Jornada inválida: no dia 1 (segunda), os blocos 08:00-13:30 e 13:00-17:00 se cruzam (encostar pode, como 08:00-12:00 e 12:00-17:00).',
    )
    expect(
      problemaDaJornada([
        { dia: 1, inicio: '08:00', fim: '12:00' },
        { dia: 1, inicio: '12:00', fim: '17:00' },
      ]),
    ).toBeNull()
  })

  it('o total do dia fica entre 60 e 720 min', () => {
    expect(problemaDaJornada([{ dia: 7, inicio: '08:00', fim: '08:59' }])).toBe(
      'Jornada inválida: o dia 7 (domingo) soma 59 min; um dia com jornada soma de 60 a 720 min (de 1 h a 12 h).',
    )
    expect(problemaDaJornada([{ dia: 7, inicio: '08:00', fim: '09:00' }])).toBeNull()
    expect(problemaDaJornada([{ dia: 7, inicio: '06:00', fim: '18:00' }])).toBeNull()
    expect(problemaDaJornada([{ dia: 7, inicio: '06:00', fim: '18:01' }])).toMatch(/soma 721 min/)
  })

  it('a ordem é a do banco: os blocos sozinhos antes dos dias, e os dias de segunda a domingo', () => {
    // O dia 5 tem três blocos, mas o bloco invertido do dia 6, que vem depois
    // na lista, é conferido antes (passada dos blocos sozinhos).
    const jornada = [
      { dia: 5, inicio: '08:00', fim: '09:00' },
      { dia: 5, inicio: '09:00', fim: '10:00' },
      { dia: 5, inicio: '10:00', fim: '11:00' },
      { dia: 6, inicio: '12:00', fim: '11:00' },
    ]
    expect(problemaDaJornada(jornada)).toMatch(/no dia 6 \(sábado\), o bloco 12:00-11:00/)
    // Dois dias com problema: o de número menor sai primeiro.
    expect(
      problemaDaJornada([
        { dia: 4, inicio: '08:00', fim: '08:30' },
        { dia: 2, inicio: '08:00', fim: '08:10' },
      ]),
    ).toMatch(/o dia 2 \(terça\) soma 10 min/)
  })
})

describe('a jornada que o banco monta da carga gravada', () => {
  /*
   * A mesma conta de `ponto_jornada_da_carga`, a que monta a jornada de quem
   * já usava o ponto antes de a jornada existir: segunda a sexta, das 08:00 às
   * 12:00 e, à tarde, das 13:00 até completar a carga; até 4 h, um bloco só,
   * das 08:00 até completar. O teste do banco prova a função; este prova que
   * o que ela monta passa na validação daqui e devolve a mesma carga.
   */
  function jornadaDaCarga(carga: number): Jornada {
    return ([1, 2, 3, 4, 5] as const).flatMap((dia) =>
      carga <= 240
        ? [{ dia, inicio: '08:00', fim: horaDosMinutos(480 + carga) }]
        : [
            { dia, inicio: '08:00', fim: '12:00' },
            { dia, inicio: '13:00', fim: horaDosMinutos(780 + carga - 240) },
          ],
    )
  }

  it.each([
    [180, '11:00', null],
    [240, '12:00', null],
    [360, '12:00', '15:00'],
    [480, '12:00', '17:00'],
    // 8h48: as 44 h da semana divididas pelos cinco dias úteis.
    [528, '12:00', '17:48'],
    [720, '12:00', '21:00'],
  ])('a carga de %i min vira uma jornada válida com o mesmo total', (carga, fimDaManha, fimDaTarde) => {
    const jornada = jornadaDaCarga(carga)
    expect(problemaDaJornada(jornada)).toBeNull()
    expect(cargaDeReferencia(jornada)).toBe(carga)
    expect(trechosDoDia(jornada, '2026-10-26').map((trecho) => horaDosMinutos(trecho.fim))).toEqual(
      fimDaTarde === null ? [fimDaManha] : [fimDaManha, fimDaTarde],
    )
    // Sábado e domingo continuam sem jornada.
    expect(totalDoDiaDaSemana(jornada, 6)).toBe(0)
    expect(totalDoDiaDaSemana(jornada, 7)).toBe(0)
  })

  it('a carga de sempre (8 h) monta exatamente a semente', () => {
    expect(lerJornada(jornadaDaCarga(480))).toEqual(JORNADA_SEMENTE)
  })
})

describe('a leitura', () => {
  it('lerJornada devolve em ordem e sem chave a mais', () => {
    const lida = lerJornada([
      { dia: 2, inicio: '13:00', fim: '17:00' },
      { dia: 1, inicio: '13:00', fim: '17:00' },
      { dia: 1, inicio: '08:00', fim: '12:00' },
    ])
    expect(lida).toEqual([
      { dia: 1, inicio: '08:00', fim: '12:00' },
      { dia: 1, inicio: '13:00', fim: '17:00' },
      { dia: 2, inicio: '13:00', fim: '17:00' },
    ])
  })

  it('lerJornada levanta com a frase do problema', () => {
    expect(() => lerJornada([])).toThrow(/nenhum bloco/)
  })

  it('a jornada própria nula segue a da empresa', () => {
    expect(lerJornadaPropria(null)).toBeNull()
    expect(lerJornadaPropria(undefined)).toBeNull()
    // A lista vazia, na leitura, é "segue a da empresa": o banco a recusa ao
    // gravar, e se chegar não pode zerar o previsto calado.
    expect(lerJornadaPropria([])).toBeNull()
    expect(() => lerJornadaPropria([{ dia: 9, inicio: '08:00', fim: '12:00' }])).toThrow(/não existe/)
    const propria: Jornada = [{ dia: 1, inicio: '09:00', fim: '15:00' }]
    expect(jornadaAplicavel(JORNADA_SEMENTE, null)).toBe(JORNADA_SEMENTE)
    expect(jornadaAplicavel(JORNADA_SEMENTE, [])).toBe(JORNADA_SEMENTE)
    expect(jornadaAplicavel(JORNADA_SEMENTE, propria)).toBe(propria)
  })
})

describe('a jornada de um dia', () => {
  it('o dia da semana é o isodow: 26/10/2026 é segunda, 25/10 é domingo', () => {
    expect(diaDaSemanaIso('2026-10-26')).toBe(1)
    expect(diaDaSemanaIso('2026-10-31')).toBe(6)
    expect(diaDaSemanaIso('2026-10-25')).toBe(7)
    expect(() => diaDaSemanaIso('2026-02-30')).toThrow(/não existe/)
  })

  it('os blocos e o total do dia, a partir da semente', () => {
    expect(trechosDoDia(JORNADA_SEMENTE, '2026-10-26')).toEqual([
      { inicio: 480, fim: 720 },
      { inicio: 780, fim: 1020 },
    ])
    expect(trechosDoDia(JORNADA_SEMENTE, '2026-10-31')).toEqual([])
    expect(totalDoDiaDaSemana(JORNADA_SEMENTE, 5)).toBe(480)
    expect(totalDoDiaDaSemana(JORNADA_SEMENTE, 6)).toBe(0)
  })

  it('a carga de referência é o maior total entre os dias (480 na semente)', () => {
    expect(cargaDeReferencia(JORNADA_SEMENTE)).toBe(480)
    expect(
      cargaDeReferencia([
        { dia: 1, inicio: '08:00', fim: '12:00' },
        { dia: 6, inicio: '08:00', fim: '14:00' },
      ]),
    ).toBe(360)
  })
})
