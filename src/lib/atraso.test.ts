import { describe, expect, it } from 'vitest'
import {
  aprovadoresDosPedidos,
  atrasoDoPedido,
  descreverDecisao,
  ehBatidaDeAtraso,
  horaMaximaDeHoje,
  localizacaoDoPedido,
  marcaDaBatida,
  momentoDaHoraDeHoje,
  MOTIVO_MAXIMO,
  MOTIVO_MINIMO,
  pedidosPendentes,
  ROTULO_DO_ESTADO,
  validarHorarioDeclarado,
  validarMotivo,
  validarMotivoDaRecusa,
  type PedidoDeAtraso,
} from './atraso'
import { diaCivilDoInstante } from './formato'

/*
 * A BATIDA EM ATRASO — AS REGRAS DO HORÁRIO DECLARADO E OS RÓTULOS.
 *
 * O centro da suíte são as três regras do horário declarado, por extenso:
 *   • 23h50 pedindo 08h00 do mesmo dia é aceito;
 *   • 00h10 pedindo 23h00 da véspera é recusado;
 *   • horário futuro é recusado.
 * Tudo no fuso de Brasília. Os instantes levam o deslocamento de Brasília
 * (-03:00) por extenso, e as regras não podem depender do fuso de quem roda o
 * teste — é o mesmo defeito que pegaria o admin num notebook com fuso errado.
 */

/** Um instante em Brasília: `('2026-10-17', '23:50')`. */
function brasilia(dia: string, hora: string): Date {
  return new Date(`${dia}T${hora}-03:00`)
}

function pedido(extras: Partial<PedidoDeAtraso> = {}): PedidoDeAtraso {
  return {
    id: 'p1',
    usuario_id: 'u1',
    horario_declarado: '2026-10-17T11:00:00.000Z',
    dia_civil: '2026-10-17',
    motivo: 'Cheguei às 8h e esqueci de bater.',
    pedido_em: '2026-10-17T13:15:00.000Z',
    selfie_path: 'u1/2026/10/p1.jpg',
    latitude: -23.56,
    longitude: -46.61,
    precisao_metros: 12,
    distancia_metros: 30,
    no_local: true,
    estado: 'pendente',
    decidido_por: null,
    decidido_em: null,
    motivo_decisao: null,
    registro_id: null,
    funcionario_nome: 'Fulana',
    funcionario_email: 'fulana@example.com',
    ...extras,
  }
}

describe('o horário declarado — "só hoje, antes de agora", no fuso de Brasília', () => {
  it('23h50 pedindo 08h00 do mesmo dia é aceito', () => {
    const agora = brasilia('2026-10-17', '23:50:00')
    const resultado = momentoDaHoraDeHoje('08:00', agora)
    expect(resultado).toEqual({ ok: true, momentoISO: '2026-10-17T11:00:00.000Z' })
  })

  it('00h10 pedindo 23h00 da véspera é recusado (pelo instante: fora do dia de hoje)', () => {
    const agora = brasilia('2026-10-18', '00:10:00')
    const resultado = validarHorarioDeclarado(brasilia('2026-10-17', '23:00:00'), agora)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) expect(resultado.erro).toMatch(/mesmo dia/)
  })

  it('00h10 escolhendo "23:00" no relógio da tela vira 23h00 de HOJE — futuro, recusado', () => {
    const agora = brasilia('2026-10-18', '00:10:00')
    const resultado = momentoDaHoraDeHoje('23:00', agora)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) expect(resultado.erro).toMatch(/ainda não chegou/)
  })

  it('horário futuro é recusado, inclusive no mesmo minuto quando os segundos já passaram de agora', () => {
    const agora = brasilia('2026-10-17', '10:05:30')
    expect(momentoDaHoraDeHoje('10:06', agora).ok).toBe(false)
    // O cru, e não o truncado — como a RPC: 10h05m59 pedido às 10h05m30 é futuro.
    expect(validarHorarioDeclarado(brasilia('2026-10-17', '10:05:59'), agora).ok).toBe(false)
    // O próprio instante de agora também não vale: a batida é para o que JÁ passou.
    expect(validarHorarioDeclarado(agora, agora).ok).toBe(false)
  })

  it('o minuto corrente, escolhido no relógio, ainda vale (10:05 às 10h05m30)', () => {
    const agora = brasilia('2026-10-17', '10:05:30')
    expect(momentoDaHoraDeHoje('10:05', agora)).toEqual({
      ok: true,
      momentoISO: '2026-10-17T13:05:00.000Z',
    })
  })

  it('a meia-noite do próprio dia vale; um minuto antes dela, não', () => {
    const agora = brasilia('2026-10-17', '00:30:00')
    expect(momentoDaHoraDeHoje('00:00', agora).ok).toBe(true)
    expect(validarHorarioDeclarado(brasilia('2026-10-16', '23:59:00'), agora).ok).toBe(false)
  })

  it('"hoje" é o dia de Brasília, não o do UTC: às 22h30 (já dia 18 em UTC) 21h00 do dia 17 vale', () => {
    const agora = brasilia('2026-10-17', '22:30:00')
    expect(diaCivilDoInstante(agora)).toBe('2026-10-17')
    expect(agora.toISOString().slice(0, 10)).toBe('2026-10-18')
    expect(momentoDaHoraDeHoje('21:00', agora)).toEqual({
      ok: true,
      momentoISO: '2026-10-18T00:00:00.000Z',
    })
  })

  it('hora malformada é recusada antes de virar instante', () => {
    const agora = brasilia('2026-10-17', '12:00:00')
    for (const hora of ['', '8:00', '25:00', '12:60', 'oito']) {
      expect(momentoDaHoraDeHoje(hora, agora).ok).toBe(false)
    }
  })

  it('instante inválido é recusado com frase, não com exceção', () => {
    const resultado = validarHorarioDeclarado('não é data', brasilia('2026-10-17', '12:00:00'))
    expect(resultado.ok).toBe(false)
  })

  it('o máximo do relógio da tela é o minuto de agora, em Brasília', () => {
    expect(horaMaximaDeHoje(brasilia('2026-10-17', '23:50:12'))).toBe('23:50')
    expect(horaMaximaDeHoje(brasilia('2026-10-18', '00:10:00'))).toBe('00:10')
  })
})

describe('o motivo', () => {
  it('pede pelo menos 10 caracteres, contados sem os espaços das pontas', () => {
    expect(validarMotivo('   curto    ').ok).toBe(false)
    expect(validarMotivo('').ok).toBe(false)
    expect(validarMotivo(`  ${'a'.repeat(MOTIVO_MINIMO)}  `)).toEqual({
      ok: true,
      motivo: 'a'.repeat(MOTIVO_MINIMO),
    })
  })

  it('aceita até 500 e recusa 501', () => {
    expect(validarMotivo('a'.repeat(MOTIVO_MAXIMO)).ok).toBe(true)
    expect(validarMotivo('a'.repeat(MOTIVO_MAXIMO + 1)).ok).toBe(false)
  })

  it('os limites são os da RPC (10 e 500)', () => {
    expect([MOTIVO_MINIMO, MOTIVO_MAXIMO]).toEqual([10, 500])
  })

  it('recusar exige motivo; espaço em branco não é motivo', () => {
    expect(validarMotivoDaRecusa('   ').ok).toBe(false)
    expect(validarMotivoDaRecusa(' folga ')).toEqual({ ok: true, motivo: 'folga' })
  })
})

describe('a marca da batida', () => {
  const aprovadores = new Map<string, string | null>([
    ['p1', 'Sérgio'],
    ['p2', null],
  ])

  it('batida de atraso aprovado diz quem aprovou', () => {
    expect(marcaDaBatida({ ajuste_manual: true, pedido_atraso_id: 'p1' }, aprovadores)).toEqual({
      nome: 'atraso',
      texto: 'em atraso, aprovada por Sérgio',
    })
  })

  it('sem o nome (leitura falhou ou o mapa não veio), a marca continua — sem o nome', () => {
    expect(marcaDaBatida({ ajuste_manual: true, pedido_atraso_id: 'p2' }, aprovadores)?.texto).toBe(
      'em atraso, aprovada',
    )
    expect(marcaDaBatida({ ajuste_manual: true, pedido_atraso_id: 'p9' })?.texto).toBe(
      'em atraso, aprovada',
    )
  })

  it('a de atraso vence a de ajuste (a aprovada nasce com ajuste_manual, pelo caminho do admin)', () => {
    expect(marcaDaBatida({ ajuste_manual: true, pedido_atraso_id: 'p1' })?.nome).toBe('atraso')
  })

  it('ajuste do admin continua "ajuste do admin"; batida do app não tem marca', () => {
    expect(marcaDaBatida({ ajuste_manual: true, pedido_atraso_id: null })).toEqual({
      nome: 'ajuste',
      texto: 'ajuste do admin',
    })
    expect(marcaDaBatida({ ajuste_manual: false })).toBeNull()
    expect(ehBatidaDeAtraso({})).toBe(false)
    expect(ehBatidaDeAtraso({ pedido_atraso_id: 'p1' })).toBe(true)
  })
})

describe('quem aprovou cada pedido', () => {
  it('só os aprovados entram; o nome sai de quem decidiu, sem espaços', () => {
    const nomes = new Map([
      ['admin-1', '  Sérgio  '],
      ['admin-2', 'Ana'],
    ])
    const mapa = aprovadoresDosPedidos(
      [
        pedido({ id: 'a', estado: 'aprovado', decidido_por: 'admin-1' }),
        pedido({ id: 'b', estado: 'recusado', decidido_por: 'admin-2' }),
        pedido({ id: 'c', estado: 'pendente' }),
        pedido({ id: 'd', estado: 'aprovado', decidido_por: 'admin-sem-nome' }),
      ],
      nomes,
    )
    expect([...mapa.entries()]).toEqual([
      ['a', 'Sérgio'],
      ['d', null],
    ])
  })
})

describe('o que a pessoa lê sobre o próprio pedido', () => {
  const nomes = new Map([['admin-1', 'Sérgio']])

  it('pendente diz que ainda não conta', () => {
    expect(descreverDecisao(pedido())).toMatch(/não entra no seu ponto/)
    expect(ROTULO_DO_ESTADO.pendente).toBe('Aguardando aprovação')
  })

  it('aprovado diz por quem, quando o nome existe', () => {
    expect(
      descreverDecisao(pedido({ estado: 'aprovado', decidido_por: 'admin-1' }), nomes),
    ).toBe('Aprovado por Sérgio. Já está no seu ponto.')
    expect(descreverDecisao(pedido({ estado: 'aprovado', decidido_por: 'admin-x' }), nomes)).toBe(
      'Aprovado. Já está no seu ponto.',
    )
  })

  it('recusado mostra o motivo da recusa', () => {
    expect(
      descreverDecisao(
        pedido({ estado: 'recusado', decidido_por: 'admin-1', motivo_decisao: ' estava de folga ' }),
        nomes,
      ),
    ).toBe('Recusado por Sérgio: estava de folga')
  })
})

describe('a fila de pendências', () => {
  it('só as pendentes, da mais antiga para a mais nova', () => {
    const fila = pedidosPendentes([
      pedido({ id: 'novo', pedido_em: '2026-10-17T15:00:00.000Z' }),
      pedido({ id: 'decidido', estado: 'aprovado', pedido_em: '2026-10-17T09:00:00.000Z' }),
      pedido({ id: 'antigo', pedido_em: '2026-10-17T10:00:00.000Z' }),
    ])
    expect(fila.map((item) => item.id)).toEqual(['antigo', 'novo'])
  })

  it('quanto tempo depois do horário declarado o pedido foi feito', () => {
    expect(atrasoDoPedido(pedido())).toBe('2h15 depois')
    expect(
      atrasoDoPedido(
        pedido({ horario_declarado: '2026-10-17T11:00:00.000Z', pedido_em: '2026-10-17T11:40:20.000Z' }),
      ),
    ).toBe('40 min depois')
  })
})

/*
 * O PEDIDO SEM LOCALIZAÇÃO: o pedido nasce sempre do app, então sem coordenada
 * ele é "sem localização" — o GPS não respondeu —, e nunca o "ausente" da
 * batida inserida pelo admin.
 */
describe('onde a pessoa estava no momento do pedido', () => {
  it('com coordenada, a régua de sempre', () => {
    expect(localizacaoDoPedido(pedido())).toEqual({ nome: 'no_local', texto: 'no local' })
  })

  it('sem coordenada: "sem localização"', () => {
    const semGps = pedido({ latitude: null, longitude: null, precisao_metros: null, distancia_metros: null, no_local: null })
    expect(localizacaoDoPedido(semGps)).toEqual({ nome: 'sem_gps', texto: 'sem localização' })
  })
})
