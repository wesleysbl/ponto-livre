import { describe, expect, it, vi } from 'vitest'
import { comPrazo, PRAZO_PADRAO_MS } from './prazo'

/*
 * O caso que interessa aqui é o único que não dá erro: a promessa que NUNCA
 * settla. Contra ela não há `await` que volte, e é ela que deixaria o botão
 * "Tirar foto" desabilitado sob um spinner mudo. Os testes usam relógio falso
 * porque esperar 12 segundos de verdade em cada `npm test` seria trocar um
 * defeito por outro.
 */

/** A promessa que nunca resolve nem rejeita — a câmera que não abre. */
function nuncaVolta<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

const EXPIROU = Symbol('expirou')

describe('comPrazo', () => {
  it('devolve o resultado quando a tarefa chega dentro do prazo', async () => {
    await expect(
      comPrazo<string | typeof EXPIROU>(Promise.resolve('fluxo'), EXPIROU),
    ).resolves.toBe('fluxo')
  })

  it('devolve o sentinel quando a tarefa nunca volta', async () => {
    vi.useFakeTimers()
    try {
      const corrida = comPrazo<string | typeof EXPIROU>(nuncaVolta<string>(), EXPIROU)
      await vi.advanceTimersByTimeAsync(PRAZO_PADRAO_MS)
      await expect(corrida).resolves.toBe(EXPIROU)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejeição ANTES do prazo continua sendo rejeição — só o silêncio vira valor', async () => {
    const negada = Object.assign(new Error('negada'), { name: 'NotAllowedError' })
    await expect(comPrazo(Promise.reject(negada), EXPIROU)).rejects.toThrow('negada')
  })

  it('aceita prazo próprio, para uma segunda espera herdar o que sobrou da primeira', async () => {
    vi.useFakeTimers()
    try {
      const corrida = comPrazo<string | typeof EXPIROU>(nuncaVolta<string>(), EXPIROU, 500)
      await vi.advanceTimersByTimeAsync(499)
      // Ainda dentro do prazo: nada resolveu.
      let resolvida = false
      void corrida.then(() => {
        resolvida = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(resolvida).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(corrida).resolves.toBe(EXPIROU)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prazo zero resolve com o sentinel sem travar', async () => {
    vi.useFakeTimers()
    try {
      const corrida = comPrazo<string | typeof EXPIROU>(nuncaVolta<string>(), EXPIROU, 0)
      await vi.advanceTimersByTimeAsync(0)
      await expect(corrida).resolves.toBe(EXPIROU)
    } finally {
      vi.useRealTimers()
    }
  })

  it('desarma o relógio quando a tarefa chega primeiro', async () => {
    vi.useFakeTimers()
    try {
      const limpar = vi.spyOn(globalThis, 'clearTimeout')
      await comPrazo<string | typeof EXPIROU>(Promise.resolve('ok'), EXPIROU)
      // Sem isto, um app que espera muitas coisas acumula relógios pendurados
      // e, em Node, segura o processo aberto.
      expect(limpar).toHaveBeenCalled()
      limpar.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
