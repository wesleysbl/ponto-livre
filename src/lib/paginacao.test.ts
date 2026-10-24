import { describe, expect, it } from 'vitest'
import { lerTodasAsPaginas, TAMANHO_DA_PAGINA, type RespostaDePagina } from './paginacao'

/*
 * O DEFEITO QUE ESTES TESTES EXISTEM PARA PEGAR NÃO DÁ ERRO.
 *
 * O PostgREST corta a resposta em 1000 linhas e devolve 200 OK. Contra o banco
 * de verdade isso só aparece com 1001 linhas lá dentro — e quando aparecer, vai
 * aparecer no fechamento do mês de alguém, não num teste. Por isso o duplê
 * abaixo corta EXATAMENTE como o PostgREST corta: dado um acervo, ele devolve a
 * fatia pedida, no máximo `TAMANHO_DA_PAGINA` linhas, sem avisar que cortou.
 *
 * Um único `it` seria enganoso: o caso que quebra implementação ingênua não é
 * "tem mais de mil", é o múltiplo exato — 1000 linhas com um laço que para
 * quando a página vem cheia lê para sempre, e um que para quando vem vazia lê
 * uma vez a mais. Os dois estão aqui.
 */

/** Um acervo de `total` linhas numeradas, para conferir ordem e ausência. */
function acervo(total: number): number[] {
  return Array.from({ length: total }, (_, i) => i)
}

/**
 * O duplê do PostgREST: corta em `TAMANHO_DA_PAGINA` e não conta que cortou.
 * Devolve também quantas idas ao "banco" aconteceram.
 */
function bancoFalso(linhas: number[]) {
  const chamadas: Array<[number, number]> = []

  const buscarPagina = (de: number, ate: number): Promise<RespostaDePagina<number>> => {
    chamadas.push([de, ate])
    const pedido = ate - de + 1
    const fatia = linhas.slice(de, de + Math.min(pedido, TAMANHO_DA_PAGINA))
    return Promise.resolve({ data: fatia, error: null })
  }

  return { buscarPagina, chamadas }
}

const aoFalhar = (mensagem: string) => new Error(mensagem)

describe('lerTodasAsPaginas', () => {
  it('devolve tudo quando o acervo cabe numa página só, com uma ida ao banco', async () => {
    const { buscarPagina, chamadas } = bancoFalso(acervo(30))

    const lidas = await lerTodasAsPaginas(buscarPagina, aoFalhar)

    expect(lidas).toHaveLength(30)
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]).toEqual([0, 999])
  })

  it('devolve tudo acima do corte do PostgREST — o caso que, sem paginar, sumiria calado', async () => {
    const { buscarPagina, chamadas } = bancoFalso(acervo(2350))

    const lidas = await lerTodasAsPaginas(buscarPagina, aoFalhar)

    expect(lidas).toHaveLength(2350)
    // Nada repetido, nada pulado, na ordem em que o banco entregou.
    expect(lidas).toEqual(acervo(2350))
    expect(chamadas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('para no múltiplo exato do tamanho da página, sem laço infinito', async () => {
    const { buscarPagina, chamadas } = bancoFalso(acervo(TAMANHO_DA_PAGINA))

    const lidas = await lerTodasAsPaginas(buscarPagina, aoFalhar)

    expect(lidas).toHaveLength(TAMANHO_DA_PAGINA)
    // A página cheia obriga a perguntar de novo; a vazia é que encerra.
    expect(chamadas).toHaveLength(2)
  })

  it('acervo vazio devolve lista vazia, não erro', async () => {
    const { buscarPagina, chamadas } = bancoFalso([])

    await expect(lerTodasAsPaginas(buscarPagina, aoFalhar)).resolves.toEqual([])
    expect(chamadas).toHaveLength(1)
  })

  it('trata `data` nulo como página vazia — é o que o supabase-js manda no erro', async () => {
    const lidas = await lerTodasAsPaginas<number>(
      () => Promise.resolve({ data: null, error: null }),
      aoFalhar,
    )

    expect(lidas).toEqual([])
  })

  it('erro na primeira página levanta pelo tradutor de quem chamou, sem devolver meia lista', async () => {
    let idas = 0
    const buscarPagina = (): Promise<RespostaDePagina<number>> => {
      idas++
      return Promise.resolve({ data: null, error: { message: 'permission denied' } })
    }

    await expect(lerTodasAsPaginas(buscarPagina, aoFalhar)).rejects.toThrow('permission denied')
    expect(idas).toBe(1)
  })

  it('erro na SEGUNDA página também levanta — meia lista é pior que erro', async () => {
    const linhas = acervo(1500)
    let idas = 0
    const buscarPagina = (de: number, ate: number): Promise<RespostaDePagina<number>> => {
      idas++
      if (idas === 1) return Promise.resolve({ data: linhas.slice(de, ate + 1), error: null })
      return Promise.resolve({ data: null, error: { message: 'timeout' } })
    }

    await expect(lerTodasAsPaginas(buscarPagina, aoFalhar)).rejects.toThrow('timeout')
  })
})
