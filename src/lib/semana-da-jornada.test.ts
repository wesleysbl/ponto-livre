import { describe, expect, it } from 'vitest'
import { JORNADA_SEMENTE, problemaDaJornada, type Jornada } from './jornada'
import {
  acrescentarBloco,
  horaDoCampo,
  horariosDoDia,
  lerSemana,
  mudarBloco,
  podeAcrescentarBloco,
  rascunhoDaSemana,
  semanaEstaVazia,
  semanaVazia,
  tirarBloco,
  totalDaSemanaNoRascunho,
  totalDoDiaNoRascunho,
  totalForaDaFaixa,
  traduzirRecusaDaJornada,
  type RascunhoDaSemana,
} from './semana-da-jornada'

/*
 * O FORMULÁRIO DA SEMANA, sem tela:
 *   • montar a jornada a partir do rascunho, em ordem, e voltar dela;
 *   • o total do dia e da semana enquanto se digita;
 *   • o bloco invertido recusado com a frase do banco (com acento);
 *   • o terceiro bloco impossível, no formulário e na leitura;
 *   • a frase do banco, sem acento, volta igual à da tela.
 */

const SEM = 'semana vazia'

function so(dia: keyof RascunhoDaSemana, blocos: { inicio: string; fim: string }[]): RascunhoDaSemana {
  return { ...semanaVazia(), [dia]: blocos }
}

describe('rascunhoDaSemana e lerSemana: ida e volta', () => {
  it('a semente vira sete dias, seg a sex com dois blocos, e volta igual', () => {
    const semana = rascunhoDaSemana(JORNADA_SEMENTE)
    expect(semana[1]).toEqual([
      { inicio: '08:00', fim: '12:00' },
      { inicio: '13:00', fim: '17:00' },
    ])
    expect(semana[6]).toEqual([])
    expect(semana[7]).toEqual([])
    expect(lerSemana(semana, SEM)).toEqual({ ok: true, valor: JORNADA_SEMENTE })
  })

  it('jornada nula é a semana vazia', () => {
    expect(rascunhoDaSemana(null)).toEqual(semanaVazia())
    expect(semanaEstaVazia(rascunhoDaSemana(null))).toBe(true)
    expect(semanaEstaVazia(rascunhoDaSemana(JORNADA_SEMENTE))).toBe(false)
  })

  it('monta a jornada em ordem de dia e de início, mesmo digitada fora de ordem', () => {
    const semana: RascunhoDaSemana = {
      ...semanaVazia(),
      6: [{ inicio: '08:00', fim: '12:00' }],
      2: [
        { inicio: '13:00', fim: '18:00' },
        { inicio: '07:00', fim: '11:00' },
      ],
    }
    expect(lerSemana(semana, SEM)).toEqual({
      ok: true,
      valor: [
        { dia: 2, inicio: '07:00', fim: '11:00' },
        { dia: 2, inicio: '13:00', fim: '18:00' },
        { dia: 6, inicio: '08:00', fim: '12:00' },
      ],
    })
  })

  it('aceita os segundos zerados que o campo de horário pode mandar, e grava HH:MM', () => {
    const leitura = lerSemana(so(1, [{ inicio: '08:00:00', fim: '12:00:00' }]), SEM)
    expect(leitura).toEqual({ ok: true, valor: [{ dia: 1, inicio: '08:00', fim: '12:00' }] })
    expect(horaDoCampo('08:00:30')).toBeNull()
    expect(horaDoCampo('24:00')).toBeNull()
  })

  it('semana sem nenhum bloco: a frase de quem chama', () => {
    expect(lerSemana(semanaVazia(), SEM)).toEqual({ ok: false, erros: [SEM] })
  })
})

describe('as mudanças do formulário', () => {
  it('acrescentar põe a manhã e depois a tarde da semente', () => {
    const um = acrescentarBloco(semanaVazia(), 6)
    expect(um[6]).toEqual([{ inicio: '08:00', fim: '12:00' }])
    const dois = acrescentarBloco(um, 6)
    expect(dois[6]).toEqual([
      { inicio: '08:00', fim: '12:00' },
      { inicio: '13:00', fim: '17:00' },
    ])
    // Os outros dias não mudam.
    expect(dois[1]).toEqual([])
  })

  it('o terceiro bloco é impossível: acrescentar devolve a semana como estava', () => {
    const dois = rascunhoDaSemana(JORNADA_SEMENTE)
    expect(podeAcrescentarBloco(dois, 1)).toBe(false)
    expect(acrescentarBloco(dois, 1)).toBe(dois)
    expect(podeAcrescentarBloco(dois, 6)).toBe(true)
  })

  it('tirar e mudar mexem só no bloco pedido', () => {
    const semana = rascunhoDaSemana(JORNADA_SEMENTE)
    expect(tirarBloco(semana, 1, 0)[1]).toEqual([{ inicio: '13:00', fim: '17:00' }])
    expect(mudarBloco(semana, 1, 1, 'fim', '18:00')[1][1]).toEqual({ inicio: '13:00', fim: '18:00' })
    expect(semana[1][1].fim).toBe('17:00')
  })
})

describe('o total do dia, na hora', () => {
  it('soma os blocos; dia sem bloco é zero', () => {
    expect(totalDoDiaNoRascunho(rascunhoDaSemana(JORNADA_SEMENTE)[1])).toBe(480)
    expect(totalDoDiaNoRascunho([{ inicio: '08:00', fim: '11:30' }])).toBe(210)
    expect(totalDoDiaNoRascunho([])).toBe(0)
  })

  it('não inventa total com horário em branco, torto ou invertido', () => {
    expect(totalDoDiaNoRascunho([{ inicio: '08:00', fim: '' }])).toBeNull()
    expect(totalDoDiaNoRascunho([{ inicio: '8h', fim: '12:00' }])).toBeNull()
    expect(totalDoDiaNoRascunho([{ inicio: '12:00', fim: '08:00' }])).toBeNull()
  })

  it('a semana soma os dias, e espera todos terem total', () => {
    expect(totalDaSemanaNoRascunho(rascunhoDaSemana(JORNADA_SEMENTE))).toBe(2400)
    expect(totalDaSemanaNoRascunho(so(3, [{ inicio: '', fim: '' }]))).toBeNull()
  })

  it('a faixa do banco (de 1 h a 12 h) vira aviso; zero é dia sem jornada, sem aviso', () => {
    expect(totalForaDaFaixa(30)).toBe(true)
    expect(totalForaDaFaixa(721)).toBe(true)
    expect(totalForaDaFaixa(60)).toBe(false)
    expect(totalForaDaFaixa(720)).toBe(false)
    expect(totalForaDaFaixa(0)).toBe(false)
  })
})

describe('lerSemana: as recusas, com a frase do banco', () => {
  it('bloco invertido', () => {
    expect(lerSemana(so(1, [{ inicio: '12:00', fim: '08:00' }]), SEM)).toEqual({
      ok: false,
      erros: [
        'Jornada inválida: no dia 1 (segunda), o bloco 12:00-08:00 não termina depois de começar (o fim precisa ser depois do início).',
      ],
    })
  })

  it('terceiro bloco no mesmo dia (a tela não deixa; a leitura também não)', () => {
    const tres = so(2, [
      { inicio: '07:00', fim: '08:00' },
      { inicio: '09:00', fim: '10:00' },
      { inicio: '11:00', fim: '12:00' },
    ])
    expect(lerSemana(tres, SEM)).toEqual({
      ok: false,
      erros: ['Jornada inválida: no dia 2 (terça) há 3 blocos (no máximo dois por dia).'],
    })
  })

  it('blocos que se cruzam; e os que só se encostam valem', () => {
    const cruzam = lerSemana(
      so(3, [
        { inicio: '08:00', fim: '12:30' },
        { inicio: '12:00', fim: '17:00' },
      ]),
      SEM,
    )
    expect(cruzam.ok === false && cruzam.erros[0]).toMatch(/os blocos 08:00-12:30 e 12:00-17:00 se cruzam/)
    const encostam = lerSemana(
      so(3, [
        { inicio: '08:00', fim: '12:00' },
        { inicio: '12:00', fim: '17:00' },
      ]),
      SEM,
    )
    expect(encostam.ok).toBe(true)
  })

  it('total do dia fora de 1 h a 12 h', () => {
    const leitura = lerSemana(so(4, [{ inicio: '08:00', fim: '08:30' }]), SEM)
    expect(leitura).toEqual({
      ok: false,
      erros: ['Jornada inválida: o dia 4 (quinta) soma 30 min; um dia com jornada soma de 60 a 720 min (de 1 h a 12 h).'],
    })
  })

  it('campo em branco é da tela, e todos os dias errados aparecem de uma vez', () => {
    const semana: RascunhoDaSemana = {
      ...semanaVazia(),
      1: [{ inicio: '08:00', fim: '' }],
      5: [{ inicio: '18:00', fim: '17:00' }],
      6: [{ inicio: 'oito', fim: '12:00' }],
    }
    const leitura = lerSemana(semana, SEM)
    expect(leitura.ok).toBe(false)
    if (leitura.ok) return
    expect(leitura.erros).toEqual([
      'Segunda, primeiro bloco: preencha o início e o fim.',
      'Jornada inválida: no dia 5 (sexta), o bloco 18:00-17:00 não termina depois de começar (o fim precisa ser depois do início).',
      'Sábado, primeiro bloco: escreva o horário como HH:MM, de 00:00 a 23:59.',
    ])
  })
})

describe('horariosDoDia', () => {
  it('escreve os blocos do dia em ordem, e vazio no dia sem jornada', () => {
    expect(horariosDoDia(JORNADA_SEMENTE, 1)).toBe('08:00-12:00 e 13:00-17:00')
    expect(horariosDoDia(JORNADA_SEMENTE, 7)).toBe('')
  })
})

describe('traduzirRecusaDaJornada: a frase do banco volta com o acento da tela', () => {
  /** O banco escreve a mesma frase de `problemaDaJornada`, sem acento (é o espelho). */
  const semAcento = (frase: string) => frase.normalize('NFD').replace(/[̀-ͯ]/g, '')

  const TORTAS: unknown[] = [
    null,
    { dia: 1 },
    [],
    [{ dia: 1, inicio: '08:00' }],
    [{ dia: 8, inicio: '08:00', fim: '12:00' }],
    [{ dia: 2, inicio: '8:00', fim: '12:00' }],
    [{ dia: 1, inicio: '12:00', fim: '08:00' }],
    [{ dia: 6, inicio: '08:00', fim: '08:30' }],
    [
      { dia: 2, inicio: '08:00', fim: '09:00' },
      { dia: 2, inicio: '09:00', fim: '10:00' },
      { dia: 2, inicio: '10:00', fim: '11:00' },
    ],
    [
      { dia: 6, inicio: '08:00', fim: '12:30' },
      { dia: 6, inicio: '12:00', fim: '17:00' },
    ],
    [{ dia: 7, inicio: '06:00', fim: '19:00' }],
  ]

  it.each(TORTAS.map((jornada) => [JSON.stringify(jornada), jornada]))(
    'a frase sem acento de %s volta igual à de problemaDaJornada',
    (_nome, jornada) => {
      const daTela = problemaDaJornada(jornada) as string
      expect(daTela).toMatch(/^Jornada inválida:/)
      expect(traduzirRecusaDaJornada(semAcento(daTela))).toBe(daTela)
    },
  )

  it('o exemplo de jsonb da frase fica como está ("inicio" é o nome da chave)', () => {
    const frase = traduzirRecusaDaJornada(
      'Jornada invalida: a jornada e uma lista de blocos, como [{"dia": 1, "inicio": "08:00", "fim": "12:00"}].',
    )
    expect(frase).toBe(problemaDaJornada({}))
    expect(frase).toContain('"inicio"')
  })

  it('o prefixo que o PostgREST põe antes da frase não chega à tela', () => {
    expect(
      traduzirRecusaDaJornada('ERROR: Jornada invalida: no dia 3 (quarta) ha 3 blocos (no maximo dois por dia).'),
    ).toBe('Jornada inválida: no dia 3 (quarta) há 3 blocos (no máximo dois por dia).')
  })

  it('outra mensagem qualquer não é dela', () => {
    expect(traduzirRecusaDaJornada('permission denied for table ponto_configuracao')).toBeNull()
  })

  it('a semente é válida (a lista de jornadas tortas acima não tem nenhuma boa por engano)', () => {
    const boa: Jornada = JORNADA_SEMENTE
    expect(problemaDaJornada(boa)).toBeNull()
  })
})

describe('as frases do banco, palavra por palavra', () => {
  /*
   * Cada frase que `ponto_jornada_problema` pode devolver, tirada da migration
   * da jornada (o texto entre aspas simples depois de `RETURN`, com os `%s`
   * trocados por um valor de exemplo), volta com o acento da tela. Se o banco
   * mudar uma palavra, a tradução para de bater aqui, e não na tela de alguém.
   */
  const migrations = import.meta.glob<string>('../../supabase/migrations/*_jornada_e_saldo.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  it('a migration da jornada existe e tem as dez frases', () => {
    expect(Object.keys(migrations)).toHaveLength(1)
    const sql = Object.values(migrations)[0]
    const frases = [...sql.matchAll(/RETURN (?:format\()?'(Jornada invalida:[^']*)'/g)].map((casou) => casou[1])
    expect(new Set(frases).size).toBe(10)
  })

  it.each([
    ['Jornada invalida: a jornada esta vazia.', null],
    [
      'Jornada invalida: a jornada e uma lista de blocos, como [{"dia": 1, "inicio": "08:00", "fim": "12:00"}].',
      { dia: 1 },
    ],
    ['Jornada invalida: nenhum bloco. Para seguir a jornada da empresa, deixe a jornada propria vazia (nula).', []],
    ['Jornada invalida: cada bloco tem dia, inicio e fim, e nada mais.', ['08:00']],
    [
      'Jornada invalida: o dia da semana 9 nao existe (1 = segunda a 7 = domingo).',
      [{ dia: 9, inicio: '08:00', fim: '12:00' }],
    ],
    [
      'Jornada invalida: no dia 2 (terca), o horario "8:00" a "12:00" nao esta no formato HH:MM (de 00:00 a 23:59).',
      [{ dia: 2, inicio: '8:00', fim: '12:00' }],
    ],
    [
      'Jornada invalida: no dia 6 (sabado), o bloco 12:00-08:00 nao termina depois de comecar (o fim precisa ser depois do inicio).',
      [{ dia: 6, inicio: '12:00', fim: '08:00' }],
    ],
    [
      'Jornada invalida: no dia 3 (quarta) ha 3 blocos (no maximo dois por dia).',
      [
        { dia: 3, inicio: '07:00', fim: '08:00' },
        { dia: 3, inicio: '09:00', fim: '10:00' },
        { dia: 3, inicio: '11:00', fim: '12:00' },
      ],
    ],
    [
      'Jornada invalida: no dia 1 (segunda), os blocos 08:00-12:30 e 12:00-17:00 se cruzam (encostar pode, como 08:00-12:00 e 12:00-17:00).',
      [
        { dia: 1, inicio: '08:00', fim: '12:30' },
        { dia: 1, inicio: '12:00', fim: '17:00' },
      ],
    ],
    [
      'Jornada invalida: o dia 7 (domingo) soma 30 min; um dia com jornada soma de 60 a 720 min (de 1 h a 12 h).',
      [{ dia: 7, inicio: '08:00', fim: '08:30' }],
    ],
  ])('"%s" volta como a frase da tela', (doBanco, jornada) => {
    expect(traduzirRecusaDaJornada(doBanco)).toBe(problemaDaJornada(jornada))
  })

  it('os textos fixos das frases de exemplo são os da migration', () => {
    const sql = Object.values(migrations)[0]
    for (const fixa of [
      'Jornada invalida: a jornada esta vazia.',
      'Jornada invalida: a jornada e uma lista de blocos, como [{"dia": 1, "inicio": "08:00", "fim": "12:00"}].',
      'Jornada invalida: nenhum bloco. Para seguir a jornada da empresa, deixe a jornada propria vazia (nula).',
      'Jornada invalida: cada bloco tem dia, inicio e fim, e nada mais.',
      'nao existe (1 = segunda a 7 = domingo).',
      'nao esta no formato HH:MM (de 00:00 a 23:59).',
      'nao termina depois de comecar (o fim precisa ser depois do inicio).',
      'se cruzam (encostar pode, como 08:00-12:00 e 12:00-17:00).',
      'um dia com jornada soma de 60 a 720 min (de 1 h a 12 h).',
      'no maximo dois por dia',
    ]) {
      expect(sql).toContain(fixa)
    }
  })
})
