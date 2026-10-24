import { describe, expect, it } from 'vitest'
import { aprovadoresDosPedidos, type PedidoDeAtraso } from './atraso'
import { CABECALHO, gerarCsvDoPeriodo, SEPARADOR } from './csv'
import { montarFolha } from './folha'
import type { BatidaDoAdmin } from './formato'
import { montarEspelho } from './horas'
import { montarLinhasDoPainel } from './painel'

/*
 * A BATIDA EM ATRASO NAS QUATRO LEITURAS — espelho, painel, folha e CSV.
 *
 * O que se prova: a folha e o CSV marcam a batida de atraso aprovada e não
 * contam pedido pendente. As duas metades, provadas aqui:
 *
 *  • A APROVADA é uma batida em `ponto_registros`, com `pedido_atraso_id`. Ela
 *    conta hora como qualquer outra (é a mesma conta de `horas.ts`) e leva a
 *    marca "em atraso, aprovada por…" na folha e na coluna "Origem" do CSV.
 *  • A PENDENTE não é batida. Ela chega às telas só como pedido, e os pedidos
 *    só alimentam o mapa de quem aprovou — que só lê os pedidos aprovados.
 *    Passar pedidos pendentes junto não acrescenta linha, hora nem marca.
 */

const DIA = '2026-10-15'

function batida(hora: string, extras: Partial<BatidaDoAdmin> = {}): BatidaDoAdmin {
  return {
    id: `b-${hora}`,
    usuario_id: 'u1',
    registrado_em: `${DIA}T${hora}:00.000-03:00`,
    dia_civil: DIA,
    tipo: 'entrada',
    ordem_no_dia: 1,
    // Com coordenada, como toda batida do app em que o GPS respondeu: sem ela,
    // a batida é "sem localização" e ganha marca.
    latitude: -23.56,
    longitude: -46.61,
    precisao_metros: 10,
    distancia_metros: 20,
    no_local: true,
    selfie_path: `u1/2026/10/b-${hora}.jpg`,
    ajuste_manual: false,
    origem: 'app',
    motivo_ajuste: null,
    funcionario_nome: 'Fulana',
    funcionario_email: 'fulana@example.com',
    pedido_atraso_id: null,
    ...extras,
  }
}

function pedido(id: string, extras: Partial<PedidoDeAtraso>): PedidoDeAtraso {
  return {
    id,
    usuario_id: 'u1',
    horario_declarado: `${DIA}T11:00:00.000Z`,
    dia_civil: DIA,
    motivo: 'Cheguei às 8h e esqueci de bater.',
    pedido_em: `${DIA}T13:00:00.000Z`,
    selfie_path: `u1/2026/10/${id}.jpg`,
    latitude: -23.56,
    longitude: -46.61,
    precisao_metros: 10,
    distancia_metros: 20,
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

/** O dia: a entrada das 08h00 veio de pedido aprovado; o resto, do app. */
const BATIDAS: BatidaDoAdmin[] = [
  batida('08:00', {
    id: 'b-atraso',
    ajuste_manual: true,
    origem: 'ajuste_admin',
    motivo_ajuste: 'Batida em atraso aprovada: Cheguei às 8h e esqueci de bater.',
    pedido_atraso_id: 'pedido-aprovado',
  }),
  batida('12:00', { tipo: 'saida_almoco', ordem_no_dia: 2 }),
  batida('13:00', { tipo: 'volta_almoco', ordem_no_dia: 3 }),
  batida('17:00', { tipo: 'saida', ordem_no_dia: 4 }),
]

/** Os pedidos do período: o aprovado, um pendente (para as 17h30) e um recusado. */
const PEDIDOS: PedidoDeAtraso[] = [
  pedido('pedido-aprovado', {
    estado: 'aprovado',
    decidido_por: 'admin-1',
    decidido_em: `${DIA}T14:00:00.000Z`,
    registro_id: 'b-atraso',
  }),
  pedido('pedido-pendente', { horario_declarado: `${DIA}T20:30:00.000Z` }),
  pedido('pedido-recusado', {
    estado: 'recusado',
    decidido_por: 'admin-1',
    decidido_em: `${DIA}T14:00:00.000Z`,
    motivo_decisao: 'Duplicado',
  }),
]

const APROVADORES = aprovadoresDosPedidos(PEDIDOS, new Map([['admin-1', 'Sérgio']]))

describe('o mapa de quem aprovou não deixa pedido pendente entrar', () => {
  it('só o aprovado está no mapa', () => {
    expect([...APROVADORES.keys()]).toEqual(['pedido-aprovado'])
  })
})

describe('a folha', () => {
  const folha = montarFolha({
    empresa: null,
    funcionario: { nome: 'Fulana', email: null },
    mes: '2026-10',
    batidas: BATIDAS,
    aprovadores: APROVADORES,
  })

  it('marca a batida em atraso aprovada, com quem aprovou e a hora dela', () => {
    expect(folha.linhas).toHaveLength(1)
    expect(folha.linhas[0].atraso).toBe(true)
    expect(folha.linhas[0].marcas).toContain('Em atraso, aprovada por Sérgio: 08:00')
  })

  it('não diz "ajustado" só por causa da batida em atraso', () => {
    expect(folha.linhas[0].ajustado).toBe(false)
    expect(folha.linhas[0].marcas).not.toContain('Ajustado pelo administrador')
  })

  it('o pedido pendente não conta: 4 batidas, 8h00 — e o total é o do espelho', () => {
    expect(folha.linhas[0].horarios).toEqual(['08:00', '12:00', '13:00', '17:00'])
    expect(folha.resumo.minutos).toBe(8 * 60)
    expect(folha.resumo.minutos).toBe(montarEspelho('2026-10', BATIDAS).minutos)
  })

  it('um ajuste DE VERDADE no mesmo dia continua aparecendo como ajuste', () => {
    const comAjuste = montarFolha({
      empresa: null,
      funcionario: { nome: 'Fulana', email: null },
      mes: '2026-10',
      batidas: BATIDAS.map((item) =>
        item.id === 'b-17:00' ? { ...item, ajuste_manual: true, origem: 'ajuste_admin' as const } : item,
      ),
      aprovadores: APROVADORES,
    })
    expect(comAjuste.linhas[0].marcas).toEqual([
      'Ajustado pelo administrador',
      'Em atraso, aprovada por Sérgio: 08:00',
    ])
  })

  it('sem o mapa de aprovadores, a marca sai sem o nome — mas sai', () => {
    const semNomes = montarFolha({
      empresa: null,
      funcionario: { nome: 'Fulana', email: null },
      mes: '2026-10',
      batidas: BATIDAS,
    })
    expect(semNomes.linhas[0].marcas).toContain('Em atraso, aprovada: 08:00')
  })
})

describe('o CSV', () => {
  const csv = gerarCsvDoPeriodo([{ nome: 'Fulana', email: null, batidas: BATIDAS }], APROVADORES)
  const linhas = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n')
  const ORIGEM = CABECALHO.indexOf('Origem')
  const AJUSTE = CABECALHO.indexOf('Ajuste manual')
  const HORAS = CABECALHO.indexOf('Horas do dia')

  it('continua com as mesmas 18 colunas', () => {
    expect(CABECALHO).toHaveLength(18)
    for (const linha of linhas) expect(linha.split(SEPARADOR)).toHaveLength(18)
  })

  it('marca a batida em atraso na coluna "Origem", com quem aprovou', () => {
    const atraso = linhas[1].split(SEPARADOR)
    expect(atraso[ORIGEM]).toBe('Em atraso, aprovada por Sérgio')
    // "Ajuste manual" é o que o banco grava: a aprovação nasce pelo caminho do admin.
    expect(atraso[AJUSTE]).toBe('SIM')
    expect(linhas[2].split(SEPARADOR)[ORIGEM]).toBe('App')
  })

  it('o pedido pendente não vira linha nem hora: 4 batidas, 8:00 no dia', () => {
    expect(linhas).toHaveLength(1 + BATIDAS.length)
    expect(linhas[4].split(SEPARADOR)[HORAS]).toBe('8:00')
  })

  it('sem o mapa, a origem sai "Em atraso, aprovada"', () => {
    const semNomes = gerarCsvDoPeriodo([{ nome: 'Fulana', email: null, batidas: BATIDAS }])
    expect(semNomes).toContain(`${SEPARADOR}Em atraso, aprovada${SEPARADOR}`)
  })
})

describe('o painel', () => {
  it('conta a batida em atraso à parte, e não como ajuste', () => {
    const [linha] = montarLinhasDoPainel(
      [
        {
          usuarioId: 'u1',
          nome: 'Fulana',
          nomeDaConta: 'Fulana',
          email: null,
          podeBater: true,
          contaApagada: false,
          temFicha: false,
        },
      ],
      BATIDAS,
    )
    expect(linha.atrasos).toBe(1)
    expect(linha.ajustes).toBe(0)
    expect(linha.resumo.minutos).toBe(8 * 60)
  })
})
