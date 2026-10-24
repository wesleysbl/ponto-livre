import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  argumentosDaLocalizacao,
  ErroDeLocalizacao,
  medirCoordenada,
  pedirCoordenada,
  podeBaterSemLocalizacao,
  type FonteDeLocalizacao,
  type MotivoDaFalhaDeLocalizacao,
} from './localizacao'

/*
 * A medição do local com várias leituras.
 *
 * O aparelho é um duplê: `emitir` entrega uma leitura com a precisão que o teste
 * quiser, `falhar` entrega um erro com o código da especificação. O relógio é
 * falso porque a janela de verdade é de 20 segundos.
 */

interface Duple {
  fonte: FonteDeLocalizacao
  emitir: (latitude: number, longitude: number, precisao: number | null) => void
  falhar: (codigo: 1 | 2 | 3) => void
  vigiasAbertos: () => number
}

function duple(): Duple {
  let aoLer: PositionCallback | null = null
  let aoFalhar: PositionErrorCallback | null | undefined = null
  const abertos = new Set<number>()
  let proximo = 1

  const fonte: FonteDeLocalizacao = {
    watchPosition(sucesso, falha) {
      aoLer = sucesso
      aoFalhar = falha
      const id = proximo++
      abertos.add(id)
      return id
    },
    clearWatch(id) {
      abertos.delete(id)
    },
  }

  return {
    fonte,
    emitir(latitude, longitude, precisao) {
      aoLer?.({
        coords: { latitude, longitude, accuracy: precisao ?? Number.NaN },
        timestamp: Date.now(),
      } as unknown as GeolocationPosition)
    },
    falhar(codigo) {
      aoFalhar?.({ code: codigo, message: 'duplê' } as unknown as GeolocationPositionError)
    },
    vigiasAbertos: () => abertos.size,
  }
}

describe('medirCoordenada', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('observa a janela inteira e fica com a leitura de menor erro', async () => {
    const aparelho = duple()
    const progresso: number[] = []
    const medicao = medirCoordenada({
      fonte: aparelho.fonte,
      janelaMs: 20_000,
      aoLer: (melhor) => progresso.push(Math.round(melhor.precisaoMetros ?? -1)),
    })

    aparelho.emitir(-23.56, -46.64, 900) // primeira leitura: antena
    await vi.advanceTimersByTimeAsync(3_000)
    aparelho.emitir(-23.5505, -46.6333, 22)
    await vi.advanceTimersByTimeAsync(3_000)
    aparelho.emitir(-23.5504, -46.6332, 35)
    await vi.advanceTimersByTimeAsync(14_000)

    const resultado = await medicao
    expect(resultado.leituras).toBe(3)
    expect(resultado.melhor).toEqual({ latitude: -23.5505, longitude: -46.6333, precisaoMetros: 22 })
    expect(progresso).toEqual([900, 22, 22])
    expect(aparelho.vigiasAbertos()).toBe(0)
  })

  it('para antes da hora quando uma leitura chega boa o bastante', async () => {
    const aparelho = duple()
    const medicao = medirCoordenada({ fonte: aparelho.fonte, precisaoAlvoMetros: 10 })
    aparelho.emitir(-23.56, -46.64, 60)
    aparelho.emitir(-23.55052, -46.633308, 6)
    const resultado = await medicao
    expect(resultado.melhor.precisaoMetros).toBe(6)
    expect(resultado.leituras).toBe(2)
    expect(aparelho.vigiasAbertos()).toBe(0)
  })

  it('devolve a leitura ruim também — quem decide se ela serve é avaliarLeitura', async () => {
    const aparelho = duple()
    const medicao = medirCoordenada({ fonte: aparelho.fonte, janelaMs: 5_000 })
    aparelho.emitir(-23.56, -46.64, 140)
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await medicao).melhor.precisaoMetros).toBe(140)
  })

  it('permissão negada encerra na hora, traduzida', async () => {
    const aparelho = duple()
    const medicao = medirCoordenada({ fonte: aparelho.fonte })
    const verificacao = expect(medicao).rejects.toThrow('Você negou o acesso à localização.')
    aparelho.falhar(1)
    await verificacao
    await expect(medicao).rejects.toBeInstanceOf(ErroDeLocalizacao)
    await expect(medicao).rejects.toMatchObject({ motivo: 'negada' })
    expect(aparelho.vigiasAbertos()).toBe(0)
  })

  it('uma falha no meio do caminho não mata a medição que já tem leitura', async () => {
    const aparelho = duple()
    const medicao = medirCoordenada({ fonte: aparelho.fonte, janelaMs: 10_000 })
    aparelho.emitir(-23.5505, -46.6333, 18)
    aparelho.falhar(3)
    aparelho.falhar(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await medicao).melhor.precisaoMetros).toBe(18)
  })

  it('sem leitura nenhuma no fim da janela, recusa com a última falha', async () => {
    const aparelho = duple()
    const medicao = medirCoordenada({ fonte: aparelho.fonte, janelaMs: 10_000 })
    const verificacao = expect(medicao).rejects.toThrow('O aparelho não conseguiu descobrir onde você está.')
    aparelho.falhar(2)
    await vi.advanceTimersByTimeAsync(10_000)
    await verificacao
    expect(aparelho.vigiasAbertos()).toBe(0)
  })

  it('sem leitura e sem falha, recusa como demora', async () => {
    const aparelho = duple()
    const medicao = medirCoordenada({ fonte: aparelho.fonte, janelaMs: 10_000 })
    const verificacao = expect(medicao).rejects.toThrow('A localização demorou demais para responder.')
    await vi.advanceTimersByTimeAsync(10_000)
    await verificacao
  })

  it('leitura depois do fim é ignorada', async () => {
    const aparelho = duple()
    const medicao = medirCoordenada({ fonte: aparelho.fonte, janelaMs: 1_000 })
    aparelho.emitir(-23.5505, -46.6333, 25)
    await vi.advanceTimersByTimeAsync(1_000)
    aparelho.emitir(-23.5, -46.6, 3)
    const resultado = await medicao
    expect(resultado.leituras).toBe(1)
    expect(resultado.melhor.precisaoMetros).toBe(25)
  })
})

/*
 * O pedido da batida (`pedirCoordenada`).
 *
 * O aparelho é um duplê de `navigator.geolocation.getCurrentPosition` que
 * guarda as opções recebidas e responde como o teste mandar. `window` só
 * precisa de `isSecureContext` (o app roda em HTTPS).
 */
describe('pedirCoordenada: o modo rápido e o motivo da falha', () => {
  type Resposta = { leitura: [number, number, number] } | { falha: 1 | 2 | 3 | 99 }

  function aparelho(resposta: Resposta, seguro = true) {
    const opcoes: PositionOptions[] = []
    vi.stubGlobal('window', { isSecureContext: seguro })
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition(sucesso: PositionCallback, falha: PositionErrorCallback, recebidas: PositionOptions) {
          opcoes.push(recebidas)
          if ('leitura' in resposta) {
            const [latitude, longitude, accuracy] = resposta.leitura
            sucesso({ coords: { latitude, longitude, accuracy }, timestamp: 0 } as unknown as GeolocationPosition)
          } else {
            falha({ code: resposta.falha, message: 'duplê' } as unknown as GeolocationPositionError)
          }
        },
      },
    })
    return opcoes
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sem opção, pede alta precisão com 20 s de prazo e nada de leitura guardada', async () => {
    const opcoes = aparelho({ leitura: [-23.5505, -46.6333, 12] })
    await expect(pedirCoordenada()).resolves.toEqual({ latitude: -23.5505, longitude: -46.6333, precisaoMetros: 12 })
    expect(opcoes).toEqual([{ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }])
  })

  it('no modo rápido (a segunda tentativa), pede precisão baixa com 15 s de prazo — e ainda nada guardado', async () => {
    const opcoes = aparelho({ leitura: [-23.56, -46.64, 180] })
    // A leitura menos precisa volta como veio: precisão ruim não é erro.
    await expect(pedirCoordenada({ rapida: true })).resolves.toEqual({
      latitude: -23.56,
      longitude: -46.64,
      precisaoMetros: 180,
    })
    expect(opcoes).toEqual([{ enableHighAccuracy: false, timeout: 15_000, maximumAge: 0 }])
  })

  it.each([
    [1, 'negada', 'Você negou o acesso à localização.'],
    [2, 'indisponivel', 'O aparelho não conseguiu descobrir onde você está.'],
    [3, 'demora', 'A localização demorou demais para responder.'],
    [99, 'indisponivel', 'Não deu para obter sua localização agora.'],
  ] as const)('a falha de código %s chega com o motivo "%s"', async (codigo, motivo, frase) => {
    aparelho({ falha: codigo })
    const pedido = pedirCoordenada()
    await expect(pedido).rejects.toBeInstanceOf(ErroDeLocalizacao)
    await expect(pedido).rejects.toMatchObject({ motivo, message: frase })
  })

  it('sem HTTPS, recusa antes de perguntar ao aparelho, com o motivo "sem_https"', async () => {
    const opcoes = aparelho({ leitura: [0, 0, 1] }, false)
    await expect(pedirCoordenada()).rejects.toMatchObject({ motivo: 'sem_https' })
    expect(opcoes).toEqual([])
  })

  it('sem localização no navegador, o motivo é "sem_suporte"', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', {})
    await expect(pedirCoordenada({ rapida: true })).rejects.toMatchObject({ motivo: 'sem_suporte' })
  })
})

/* ------------------------------------------------------------------ */
/* Bater sem localização                                               */
/* ------------------------------------------------------------------ */

describe('quando a batida pode sair sem localização', () => {
  it.each([
    ['indisponivel', true],
    ['demora', true],
    ['negada', false],
    ['sem_https', false],
    ['sem_suporte', false],
  ] as [MotivoDaFalhaDeLocalizacao, boolean][])('motivo "%s": %s', (motivo, pode) => {
    expect(podeBaterSemLocalizacao(motivo)).toBe(pode)
  })
})

describe('os parâmetros de localização das RPCs', () => {
  it('com coordenada: os três de sempre, e p_sem_localizacao nem viaja', () => {
    const argumentos = argumentosDaLocalizacao({
      tipo: 'coordenada',
      coordenada: { latitude: -23.56, longitude: -46.61, precisaoMetros: 12 },
    })
    expect(argumentos).toEqual({ p_latitude: -23.56, p_longitude: -46.61, p_precisao_metros: 12 })
    expect(Object.keys(argumentos)).not.toContain('p_sem_localizacao')
  })

  it('sem localização: latitude, longitude e precisão nulas, e o motivo da falha', () => {
    expect(argumentosDaLocalizacao({ tipo: 'sem_localizacao', motivo: 'demora' })).toEqual({
      p_latitude: null,
      p_longitude: null,
      p_precisao_metros: null,
      p_sem_localizacao: 'demora',
    })
    expect(argumentosDaLocalizacao({ tipo: 'sem_localizacao', motivo: 'indisponivel' }).p_sem_localizacao).toBe(
      'indisponivel',
    )
  })
})
