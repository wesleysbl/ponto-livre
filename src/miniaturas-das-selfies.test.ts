// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatidaDoAdmin } from './lib/formato'

/*
 * AS MINIATURAS DAS SELFIES NO DIA DO PAINEL.
 *
 * O que se prova, com o Supabase e o IntersectionObserver simulados:
 *   • A ASSINATURA É EM LOTE: as fotos do dia vão num `createSignedUrls` só,
 *     no bucket `ponto-selfies`, com os mesmos dois minutos do visor. A foto
 *     que o storage recusa fica de fora do mapa; a falha do pedido inteiro
 *     vira `ErroDeBatida`. Lista vazia nem viaja.
 *   • SÓ ASSINA QUANDO O DIA CHEGA PERTO DA TELA: antes disso, nenhum pedido
 *     e a câmera de sempre. Quando o dia aparece, a miniatura entra dentro do
 *     mesmo botão ("Ver a selfie das 08:00"), com `alt` vazio, e o clique
 *     segue abrindo o visor.
 *   • A BATIDA INSERIDA PELO ADMIN não entra no pedido: não houve foto.
 *   • FALHOU, FICA A CÂMERA: sem assinatura, ou com a imagem recusada depois
 *     (`onError`), a lista não mostra quadrado quebrado nem erro de console.
 */

const simulado = vi.hoisted(() => {
  const estado = {
    pedidos: [] as { bucket: string; caminhos: string[]; segundos: number }[],
    recusados: [] as string[],
    falhaDoPedido: null as { message: string } | null,
  }
  const supabase = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: (caminhos: string[], segundos: number) => {
          estado.pedidos.push({ bucket, caminhos, segundos })
          if (estado.falhaDoPedido) return Promise.resolve({ data: null, error: estado.falhaDoPedido })
          return Promise.resolve({
            data: caminhos.map((caminho) =>
              estado.recusados.includes(caminho)
                ? { path: caminho, error: 'Object not found', signedURL: null, signedUrl: null }
                : {
                    path: caminho,
                    error: null,
                    signedURL: `/object/sign/${bucket}/${caminho}`,
                    signedUrl: `https://assinado.invalid/${caminho}`,
                  },
            ),
            error: null,
          })
        },
      }),
    },
  }
  return { estado, supabase }
})

vi.mock('./lib/supabase', () => ({ supabase: simulado.supabase }))

const { urlsAssinadasDasSelfies, ErroDeBatida, SEGUNDOS_DE_VALIDADE_DA_SELFIE } = await import(
  './lib/batidas'
)
const { DiaDoPainel } = await import('./components/DiaDoPainel')
const { agruparPorDia } = await import('./lib/horas')

const { estado } = simulado

/** O IntersectionObserver de mentira: guarda quem observa, e `mostrarTudo` faz o dia entrar na tela. */
const observadores: { chamar: IntersectionObserverCallback; alvos: Element[]; ligado: boolean }[] = []
class ObservadorSimulado {
  private registro: (typeof observadores)[number]
  constructor(chamar: IntersectionObserverCallback) {
    this.registro = { chamar, alvos: [], ligado: true }
    observadores.push(this.registro)
  }
  observe(alvo: Element) {
    this.registro.alvos.push(alvo)
  }
  disconnect() {
    this.registro.ligado = false
  }
  unobserve() {}
  takeRecords() {
    return []
  }
}

function mostrarTudo() {
  for (const registro of observadores.filter((r) => r.ligado)) {
    registro.chamar(
      registro.alvos.map((alvo) => ({ isIntersecting: true, target: alvo }) as IntersectionObserverEntry),
      registro as unknown as IntersectionObserver,
    )
  }
}

function batida(hora: string, ordem: number, extras: Partial<BatidaDoAdmin> = {}): BatidaDoAdmin {
  const tipos = ['entrada', 'saida_almoco', 'volta_almoco', 'saida'] as const
  return {
    id: `b-${hora}`,
    usuario_id: 'u1',
    registrado_em: `2026-10-01T${hora}:00.000-03:00`,
    dia_civil: '2026-10-01',
    tipo: tipos[ordem - 1],
    ordem_no_dia: ordem,
    latitude: -23.56,
    longitude: -46.61,
    precisao_metros: 10,
    distancia_metros: 20,
    no_local: true,
    selfie_path: `u1/2026/10/b-${hora}.jpg`,
    ajuste_manual: false,
    origem: 'app',
    motivo_ajuste: null,
    funcionario_nome: 'Ana Beatriz Rocha',
    funcionario_email: 'ana@example.com',
    pedido_atraso_id: null,
    ...extras,
  }
}

const QUATRO = [
  batida('08:00', 1),
  batida('12:00', 2),
  batida('13:00', 3),
  // Inserida pelo admin: sem foto.
  batida('17:00', 4, { selfie_path: null, ajuste_manual: true, origem: 'ajuste_admin', motivo_ajuste: 'esqueceu' }),
]

let montadas: { root: Root; raiz: HTMLElement }[] = []
let errosDoConsole: unknown[][] = []
let abertas: BatidaDoAdmin[] = []

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  estado.pedidos = []
  estado.recusados = []
  estado.falhaDoPedido = null
  observadores.length = 0
  abertas = []
  errosDoConsole = []
  vi.stubGlobal('IntersectionObserver', ObservadorSimulado)
  for (const nivel of ['error', 'warn'] as const) {
    vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
      errosDoConsole.push([nivel, ...args])
    })
  }
})

afterEach(() => {
  for (const { root, raiz } of montadas) {
    act(() => root.unmount())
    raiz.remove()
  }
  montadas = []
  expect(errosDoConsole).toEqual([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function assentar() {
  for (let volta = 0; volta < 5; volta++) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0))
    })
  }
}

async function desenharDia(batidas: BatidaDoAdmin[] = QUATRO) {
  const [dia] = agruparPorDia(batidas)
  const raiz = document.createElement('ul')
  document.body.appendChild(raiz)
  const root = createRoot(raiz)
  montadas.push({ root, raiz })
  await act(async () => {
    root.render(
      createElement(DiaDoPainel, {
        dia,
        aoAbrirSelfie: (aberta: BatidaDoAdmin) => abertas.push(aberta),
        aoCorrigir: () => {},
        aoInserirNesteDia: () => {},
      }),
    )
  })
  await assentar()
  return raiz
}

const botaoDaSelfie = (raiz: HTMLElement, hora: string) =>
  raiz.querySelector<HTMLButtonElement>(`button[aria-label="Ver a selfie das ${hora}"]`)

describe('urlsAssinadasDasSelfies: o lote de links do dia', () => {
  it('assina tudo num pedido só, no bucket das selfies, com os dois minutos do visor', async () => {
    const urls = await urlsAssinadasDasSelfies(['u1/2026/10/a.jpg', 'u1/2026/10/b.jpg'])
    expect(estado.pedidos).toEqual([
      {
        bucket: 'ponto-selfies',
        caminhos: ['u1/2026/10/a.jpg', 'u1/2026/10/b.jpg'],
        segundos: SEGUNDOS_DE_VALIDADE_DA_SELFIE,
      },
    ])
    expect(SEGUNDOS_DE_VALIDADE_DA_SELFIE).toBe(120)
    expect([...urls]).toEqual([
      ['u1/2026/10/a.jpg', 'https://assinado.invalid/u1/2026/10/a.jpg'],
      ['u1/2026/10/b.jpg', 'https://assinado.invalid/u1/2026/10/b.jpg'],
    ])
  })

  it('a foto que o storage recusa fica de fora, e as outras seguem', async () => {
    estado.recusados = ['u2/2026/10/de-outra-pessoa.jpg']
    const urls = await urlsAssinadasDasSelfies(['u1/2026/10/a.jpg', 'u2/2026/10/de-outra-pessoa.jpg'])
    expect([...urls.keys()]).toEqual(['u1/2026/10/a.jpg'])
  })

  it('lista vazia não viaja', async () => {
    expect((await urlsAssinadasDasSelfies([])).size).toBe(0)
    expect(estado.pedidos).toEqual([])
  })

  it('a falha do pedido inteiro vira ErroDeBatida, com a frase do storage', async () => {
    estado.falhaDoPedido = { message: 'sem rede' }
    await expect(urlsAssinadasDasSelfies(['u1/2026/10/a.jpg'])).rejects.toThrow(ErroDeBatida)
    await expect(urlsAssinadasDasSelfies(['u1/2026/10/a.jpg'])).rejects.toThrow('sem rede')
  })
})

describe('o dia do painel mostra as selfies em miniatura', () => {
  it('antes de o dia chegar perto da tela, nenhum pedido e a câmera de sempre', async () => {
    const raiz = await desenharDia()
    expect(estado.pedidos).toEqual([])
    expect(raiz.querySelector('img')).toBeNull()
    expect(botaoDaSelfie(raiz, '08:00')?.querySelector('svg')).not.toBeNull()
  })

  it('quando o dia aparece, um pedido só com as fotos do dia, e cada miniatura dentro do seu botão', async () => {
    const raiz = await desenharDia()
    await act(async () => mostrarTudo())
    await assentar()

    // A das 17:00 foi inserida pelo admin: não houve foto, e ela não entra no pedido.
    expect(estado.pedidos.map((pedido) => pedido.caminhos)).toEqual([
      ['u1/2026/10/b-08:00.jpg', 'u1/2026/10/b-12:00.jpg', 'u1/2026/10/b-13:00.jpg'],
    ])
    for (const hora of ['08:00', '12:00', '13:00']) {
      const imagem = botaoDaSelfie(raiz, hora)?.querySelector('img')
      expect(imagem?.getAttribute('src'), hora).toBe(`https://assinado.invalid/u1/2026/10/b-${hora}.jpg`)
      // O nome para o leitor de tela é o do botão; a imagem não repete.
      expect(imagem?.getAttribute('alt'), hora).toBe('')
    }
    expect(raiz.querySelectorAll('img')).toHaveLength(3)
    expect(raiz.textContent).toContain('Sem foto — batida inserida pelo administrador')
  })

  it('o clique na miniatura segue abrindo o visor da batida certa', async () => {
    const raiz = await desenharDia()
    await act(async () => mostrarTudo())
    await assentar()
    await act(async () => botaoDaSelfie(raiz, '12:00')?.click())
    expect(abertas.map((aberta) => aberta.id)).toEqual(['b-12:00'])
  })

  it('o dia assina uma vez só, mesmo que volte a aparecer', async () => {
    const raiz = await desenharDia()
    await act(async () => mostrarTudo())
    await assentar()
    await act(async () => mostrarTudo())
    await assentar()
    expect(estado.pedidos).toHaveLength(1)
    expect(raiz.querySelectorAll('img')).toHaveLength(3)
  })

  it('a foto recusada pelo storage fica com a câmera, e as outras ganham a miniatura', async () => {
    estado.recusados = ['u1/2026/10/b-12:00.jpg']
    const raiz = await desenharDia()
    await act(async () => mostrarTudo())
    await assentar()
    expect(botaoDaSelfie(raiz, '12:00')?.querySelector('img')).toBeNull()
    expect(botaoDaSelfie(raiz, '12:00')?.querySelector('svg')).not.toBeNull()
    expect(botaoDaSelfie(raiz, '08:00')?.querySelector('img')).not.toBeNull()
  })

  it('sem rede, o dia inteiro fica com a câmera e nada aparece no console', async () => {
    estado.falhaDoPedido = { message: 'sem rede' }
    const raiz = await desenharDia()
    await act(async () => mostrarTudo())
    await assentar()
    expect(estado.pedidos).toHaveLength(1)
    expect(raiz.querySelector('img')).toBeNull()
  })

  it('a imagem que o navegador não consegue baixar (link vencido) volta a ser a câmera', async () => {
    const raiz = await desenharDia()
    await act(async () => mostrarTudo())
    await assentar()
    const imagem = botaoDaSelfie(raiz, '08:00')?.querySelector('img')
    await act(async () => imagem?.dispatchEvent(new Event('error')))
    expect(botaoDaSelfie(raiz, '08:00')?.querySelector('img')).toBeNull()
    expect(botaoDaSelfie(raiz, '08:00')?.querySelector('svg')).not.toBeNull()
    expect(botaoDaSelfie(raiz, '13:00')?.querySelector('img')).not.toBeNull()
  })

  it('navegador sem IntersectionObserver assina na hora, sem esperar a rolagem', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const raiz = await desenharDia()
    expect(estado.pedidos).toHaveLength(1)
    expect(raiz.querySelectorAll('img')).toHaveLength(3)
  })

  it('dia só com batidas inseridas pelo admin não pede nada', async () => {
    await desenharDia([
      batida('08:00', 1, { selfie_path: null, origem: 'ajuste_admin', ajuste_manual: true }),
      batida('17:00', 2, { selfie_path: null, origem: 'ajuste_admin', ajuste_manual: true }),
    ])
    await act(async () => mostrarTudo())
    await assentar()
    expect(estado.pedidos).toEqual([])
    expect(observadores).toHaveLength(0)
  })
})
