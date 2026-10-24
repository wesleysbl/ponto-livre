import { describe, expect, it } from 'vitest'
import {
  descreverLocalizacao,
  saiuSemLocalizacao,
  formatarDistancia,
  formatarHora,
  momentoNoFusoDoLocal,
  PRECISAO_MAXIMA_CONFIAVEL_METROS,
  type Batida,
} from './formato'

/*
 * DUAS REGRAS QUE SÓ APARECEM NA HORA ERRADA.
 *
 * 1. A HORA QUE O ADMIN DIGITA É A HORA DO LOCAL (FUSO DE BRASÍLIA). O
 *    formulário de correção recebe "08:00" e precisa gravar o instante em que o
 *    relógio do local marcava 08:00 — não o instante em que o relógio DO ADMIN
 *    marcava isso. Se a máquina dele estiver em outro fuso (ou o super admin
 *    estiver viajando), a diferença desloca a batida em horas e o `dia_civil`
 *    que o banco recalcula pode até cair no dia anterior. Erro silencioso, e
 *    num campo que serve de prova trabalhista.
 *
 * 2. PRECISÃO RUIM NÃO VIRA DISTÂNCIA AFIRMADA. Caso de borda: a batida é
 *    gravada com a precisão que veio, e o painel diz "localização imprecisa" em
 *    vez de "42 m do local".
 */

function batida(extras: Partial<Batida> = {}): Batida {
  return {
    id: 'b1',
    registrado_em: '2026-08-03T11:00:00.000Z',
    dia_civil: '2026-08-03',
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

describe('a hora digitada é a hora do local', () => {
  it('08:00 em Campinas é 11:00 em UTC', () => {
    expect(momentoNoFusoDoLocal('2026-08-15', '08:00')).toBe('2026-08-15T11:00:00.000Z')
  })

  it('vale igual em janeiro — o Brasil não tem mais horário de verão', () => {
    // O teste existe para o dia em que voltar a ter: se voltar, ele quebra aqui
    // em vez de deslocar silenciosamente o ponto de todo mundo em uma hora.
    expect(momentoNoFusoDoLocal('2026-01-15', '08:00')).toBe('2026-01-15T11:00:00.000Z')
  })

  it('a meia-noite fica no dia certo, e não vira "24:00" do dia anterior', () => {
    expect(momentoNoFusoDoLocal('2026-08-15', '00:00')).toBe('2026-08-15T03:00:00.000Z')
    expect(formatarHora('2026-08-15T03:00:00.000Z')).toBe('00:00')
  })

  it('escrever e reler devolve a mesma hora, em qualquer hora do dia', () => {
    // A ida e a volta do formulário de correção: o campo mostra HH:MM, o admin
    // altera, e o que volta para o campo depois de gravar tem que bater.
    for (const hora of ['00:00', '07:59', '12:00', '18:30', '23:59']) {
      expect(formatarHora(momentoNoFusoDoLocal('2026-08-15', hora))).toBe(hora)
    }
  })

  it('a batida das 21h30 do dia 31 continua sendo do dia 31', () => {
    // Em UTC ela já é 1º de setembro. O `dia_civil` do banco também usa o fuso
    // do local, então os dois concordam.
    const momento = momentoNoFusoDoLocal('2026-08-31', '21:30')
    expect(momento).toBe('2026-09-01T00:30:00.000Z')
    expect(formatarHora(momento)).toBe('21:30')
  })

  it('recusa data e hora malformadas em vez de gravar NaN', () => {
    expect(() => momentoNoFusoDoLocal('31/08/2026', '08:00')).toThrow(/Data inválida/)
    expect(() => momentoNoFusoDoLocal('2026-02-30', '08:00')).toThrow(/Data inválida/)
    expect(() => momentoNoFusoDoLocal('2026-08-15', '8:00')).toThrow(/Hora inválida/)
    expect(() => momentoNoFusoDoLocal('2026-08-15', '25:00')).toThrow(/Hora inválida/)
  })
})

describe('o que a tela pode afirmar sobre onde a pessoa estava', () => {
  it('sem coordenada não diz nada — é a batida inserida pelo admin', () => {
    expect(descreverLocalizacao(batida())).toEqual({
      nome: 'ausente',
      texto: 'sem localização',
    })
  })

  it('coordenada boa vira "no local" ou a distância', () => {
    expect(
      descreverLocalizacao(batida({ distancia_metros: 12, no_local: true, precisao_metros: 8 })),
    ).toEqual({ nome: 'no_local', texto: 'no local' })

    expect(
      descreverLocalizacao(
        batida({ distancia_metros: 1420, no_local: false, precisao_metros: 15 }),
      ),
    ).toEqual({ nome: 'fora', texto: '1,42 km do local' })
  })

  it('precisão pior que o limite vira "localização imprecisa", com o erro à vista', () => {
    const resultado = descreverLocalizacao(
      batida({ distancia_metros: 42, no_local: true, precisao_metros: 3200 }),
    )
    expect(resultado.nome).toBe('imprecisa')
    expect(resultado.texto).toBe('localização imprecisa (±3,20 km)')
  })

  it('a borda do limite ainda é confiável — só o que passa dele é que não é', () => {
    const noLimite = batida({
      distancia_metros: 42,
      no_local: true,
      precisao_metros: PRECISAO_MAXIMA_CONFIAVEL_METROS,
    })
    const acima = batida({
      distancia_metros: 42,
      no_local: true,
      precisao_metros: PRECISAO_MAXIMA_CONFIAVEL_METROS + 1,
    })

    expect(descreverLocalizacao(noLimite).nome).toBe('no_local')
    expect(descreverLocalizacao(acima).nome).toBe('imprecisa')
  })

  it('sem precisão informada, a marca do servidor vale', () => {
    // Precisão nula é o aparelho que não disse — não é o aparelho dizendo que
    // errou muito. A distância foi calculada no servidor e continua valendo.
    expect(
      descreverLocalizacao(
        batida({ distancia_metros: 42, no_local: true, precisao_metros: null }),
      ).nome,
    ).toBe('no_local')
  })
})

/*
 * A BATIDA SEM LOCALIZAÇÃO: a do app (ou de pedido aprovado) com latitude
 * nula. A inserida pelo admin também não tem coordenada, e continua "ausente"
 * — como sempre.
 */
describe('a batida que saiu sem localização porque o GPS não respondeu', () => {
  const SEM_COORDENADA = { latitude: null, longitude: null, distancia_metros: null, no_local: null }

  it('do app, sem coordenada: "sem localização", em degrau próprio', () => {
    const doApp = batida({ ...SEM_COORDENADA, origem: 'app' })
    expect(saiuSemLocalizacao(doApp)).toBe(true)
    expect(descreverLocalizacao(doApp)).toEqual({ nome: 'sem_gps', texto: 'sem localização' })
  })

  it('de pedido aprovado sem coordenada também — mesmo com origem do admin, que é como a aprovação grava', () => {
    const aprovada = batida({ ...SEM_COORDENADA, origem: 'ajuste_admin', ajuste_manual: true, pedido_atraso_id: 'p1' })
    expect(saiuSemLocalizacao(aprovada)).toBe(true)
    expect(descreverLocalizacao(aprovada).nome).toBe('sem_gps')
  })

  it('a inserida pelo admin continua "ausente": não houve celular', () => {
    const doAdmin = batida({ ...SEM_COORDENADA, origem: 'ajuste_admin', ajuste_manual: true })
    expect(saiuSemLocalizacao(doAdmin)).toBe(false)
    expect(descreverLocalizacao(doAdmin)).toEqual({ nome: 'ausente', texto: 'sem localização' })
  })

  it('a do app corrigida pelo admin continua sem localização: quem decide é a origem, não o ajuste', () => {
    expect(saiuSemLocalizacao(batida({ ...SEM_COORDENADA, origem: 'app', ajuste_manual: true }))).toBe(true)
  })

  it('sem a origem (leitura que não a pediu), não afirma nada', () => {
    expect(saiuSemLocalizacao(batida(SEM_COORDENADA))).toBe(false)
    expect(saiuSemLocalizacao({ distancia_metros: null })).toBe(false)
  })

  it('com coordenada, ou com distância calculada, nunca', () => {
    expect(saiuSemLocalizacao(batida({ origem: 'app', latitude: -23.56, longitude: -46.61 }))).toBe(false)
    const comDistancia = batida({ origem: 'app', distancia_metros: 12, no_local: true, precisao_metros: 8 })
    expect(saiuSemLocalizacao(comDistancia)).toBe(false)
    expect(descreverLocalizacao(comDistancia).nome).toBe('no_local')
  })
})

describe('distância por extenso', () => {
  it('metros até 1 km, depois quilômetros com vírgula', () => {
    expect(formatarDistancia(0)).toBe('0 m')
    expect(formatarDistancia(42.4)).toBe('42 m')
    expect(formatarDistancia(999)).toBe('999 m')
    expect(formatarDistancia(1000)).toBe('1,00 km')
    expect(formatarDistancia(1234.5)).toBe('1,23 km')
    expect(formatarDistancia(null)).toBe('sem localização')
  })
})
