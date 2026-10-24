import { beforeEach, describe, expect, it } from 'vitest'
import textoDoServiceWorker from '../public/sw.js?raw'

/*
 * O SERVICE WORKER, INCLUSIVE COM APP E API NO MESMO ENDEREÇO.
 *
 * O DEFEITO QUE ESTE ARQUIVO SEGURA
 * Quando um mesmo domínio serve o app e o Supabase, um worker que guardasse
 * como casca "/" a resposta de QUALQUER navegação para o mesmo endereço
 * guardaria também o atestado — abri-lo (URL assinada
 * `/storage/v1/object/sign/...`, numa aba nova) é navegação. O PDF do
 * atestado, dado de saúde, viraria "o app" guardado no aparelho.
 *
 * COMO SE TESTA, E POR QUE ASSIM
 * Executando o PRÓPRIO `public/sw.js` — o texto dele entra por `?raw` (recurso
 * do Vite) e roda dentro de uma função que recebe `self`, `caches` e `fetch`
 * simulados. As alternativas eram piores:
 *   - extrair a regra para um módulo do app e importá-lo no `sw.js` exigiria
 *     service worker de módulo (`type: 'module'`), que não é garantido em todo
 *     navegador de celular, ou um passo de build novo só para ele;
 *   - copiar a regra para um arquivo testável faria o teste conferir a cópia, e
 *     não o que roda no celular;
 *   - procurar trechos no texto (`toContain('/storage/v1/')`) passaria com a
 *     rota escrita num comentário e a regra apagada.
 * Assim, o que se afirma é COMPORTAMENTO: dado um pedido, o worker responde ou
 * não, e a casca guardada muda ou não.
 */

const ORIGEM = 'https://ponto.example.com'
const CASCA_ANTIGA = '<!doctype html><title>casca de antes</title>'

type Pedido = { url: string; method: string; mode: string }
type Ouvinte = (evento: unknown) => void

/** Cache Storage em memória, com as mesmas chaves que o navegador usaria (a URL). */
function cacheSimulado() {
  const caches = new Map<string, Map<string, Response>>()
  const chave = (pedido: string | Pedido) => new URL(typeof pedido === 'string' ? pedido : pedido.url, ORIGEM).href

  function abrir(nome: string) {
    if (!caches.has(nome)) caches.set(nome, new Map())
    const guardados = caches.get(nome)!
    return {
      put: async (pedido: string | Pedido, resposta: Response) => {
        guardados.set(chave(pedido), resposta)
      },
      match: async (pedido: string | Pedido) => guardados.get(chave(pedido))?.clone(),
      addAll: async (lista: string[]) => {
        for (const caminho of lista) guardados.set(chave(caminho), html(`precache ${caminho}`))
      },
    }
  }

  return {
    caches,
    api: {
      open: async (nome: string) => abrir(nome),
      keys: async () => [...caches.keys()],
      delete: async (nome: string) => caches.delete(nome),
      match: async (pedido: string | Pedido) => {
        for (const guardados of caches.values()) {
          const achado = guardados.get(chave(pedido))
          if (achado) return achado.clone()
        }
        return undefined
      },
    },
    /** O texto da casca guardada em "/", em qualquer versão de cache. */
    async casca(): Promise<string | null> {
      for (const guardados of caches.values()) {
        const resposta = guardados.get(`${ORIGEM}/`)
        if (resposta) return resposta.clone().text()
      }
      return null
    },
  }
}

function html(corpo: string, status = 200): Response {
  return new Response(corpo, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function arquivo(tipo: string): Response {
  return new Response('%PDF-1.7 atestado', { status: 200, headers: { 'content-type': tipo } })
}

/** Liga o `sw.js` de verdade a um `self`, `caches` e `fetch` simulados. */
function ligarServiceWorker(rede: (pedido: Pedido) => Promise<Response>) {
  const ouvintes: Record<string, Ouvinte> = {}
  const cache = cacheSimulado()
  const pedidosARede: string[] = []
  const self = {
    location: new URL(`${ORIGEM}/sw.js`),
    addEventListener: (tipo: string, ouvinte: Ouvinte) => {
      ouvintes[tipo] = ouvinte
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  }
  const fetchSimulado = (pedido: Pedido) => {
    pedidosARede.push(pedido.url)
    return rede(pedido)
  }
  // O texto do worker roda com estes três nomes no lugar dos globais. `URL` e
  // `Response` são os do Node, iguais aos do navegador.
  new Function('self', 'caches', 'fetch', textoDoServiceWorker)(self, cache.api, fetchSimulado)

  async function despachar(tipo: string, extra: object = {}) {
    // `as`, e não anotação: atribuída dentro do callback, a variável seria
    // estreitada para `null` pelo TypeScript.
    let resposta = null as Promise<Response> | null
    const pendentes: Promise<unknown>[] = []
    ouvintes[tipo]({
      ...extra,
      respondWith: (promessa: Promise<Response>) => {
        resposta = promessa
      },
      waitUntil: (promessa: Promise<unknown>) => {
        pendentes.push(promessa)
      },
    })
    const respondida = resposta ? await resposta : null
    // O `waitUntil` da casca nasce DEPOIS da resposta; espera tudo assentar.
    for (let i = 0; i < pendentes.length; i++) await pendentes[i]
    return respondida
  }

  return {
    cache,
    pedidosARede,
    instalar: () => despachar('install'),
    ativar: () => despachar('activate'),
    /** Devolve `null` quando o worker NÃO responde: o navegador vai direto à rede. */
    pedir: (caminho: string, modo = 'cors', metodo = 'GET') =>
      despachar('fetch', { request: { url: new URL(caminho, ORIGEM).href, method: metodo, mode: modo } }),
  }
}

/** Instala e ativa, e troca a casca do precache por uma conhecida. */
async function workerComCasca(rede: (pedido: Pedido) => Promise<Response>) {
  const sw = ligarServiceWorker(rede)
  await sw.instalar()
  await sw.ativar()
  const [nome] = await sw.cache.api.keys()
  await (await sw.cache.api.open(nome)).put('/', html(CASCA_ANTIGA))
  return sw
}

const URLS_DO_SUPABASE = [
  '/auth/v1/token?grant_type=password',
  '/auth/v1/verify?token=abc&type=recovery&redirect_to=https://ponto.example.com',
  '/rest/v1/ponto_batidas?select=*',
  '/rest/v1/rpc/ponto_bater',
  '/storage/v1/object/sign/ponto-atestados/u1/atestado.pdf?token=assinado',
  '/storage/v1/object/sign/ponto-selfies/u1/selfie.jpg?token=assinado',
  '/functions/v1/ponto-contas',
]

describe('as quatro rotas do Supabase vão direto à rede', () => {
  let sw: Awaited<ReturnType<typeof workerComCasca>>

  beforeEach(async () => {
    sw = await workerComCasca(async () => arquivo('application/pdf'))
  })

  it.each(URLS_DO_SUPABASE)('navegar para %s não passa pelo worker nem altera a casca', async (caminho) => {
    expect(await sw.pedir(caminho, 'navigate')).toBeNull()
    expect(sw.pedidosARede).toEqual([])
    expect(await sw.cache.casca()).toBe(CASCA_ANTIGA)
  })

  it.each(URLS_DO_SUPABASE)('a leitura do app (fetch) em %s também passa direto', async (caminho) => {
    expect(await sw.pedir(caminho, 'cors')).toBeNull()
    expect(sw.pedidosARede).toEqual([])
  })

  it('o caminho exato sem a barra também é do Supabase', async () => {
    for (const rota of ['/auth/v1', '/rest/v1', '/storage/v1', '/functions/v1']) {
      expect(await sw.pedir(rota, 'navigate')).toBeNull()
    }
    expect(await sw.cache.casca()).toBe(CASCA_ANTIGA)
  })

  it('só o prefixo de verdade casa: /rest/v10 e /storage/v1x seguem como rota do app', async () => {
    const respondida = await sw.pedir('/storage/v1x/algo', 'navigate')
    expect(respondida).not.toBeNull()
    expect(sw.pedidosARede).toEqual([`${ORIGEM}/storage/v1x/algo`])
  })

  it('a URL assinada de um atestado não vira casca nem guardada em outra chave', async () => {
    await sw.pedir('/storage/v1/object/sign/ponto-atestados/u1/atestado.pdf?token=assinado', 'navigate')
    const guardado = [...sw.cache.caches.values()].flatMap((mapa) => [...mapa.keys()])
    expect(guardado.some((url) => url.includes('/storage/v1/'))).toBe(false)
  })
})

describe('a casca só é trocada por uma página do app que deu certo', () => {
  it('navegação com 200 e text/html vira a casca nova', async () => {
    const sw = await workerComCasca(async () => html('<!doctype html><title>deploy novo</title>'))
    const respondida = await sw.pedir('/espelho', 'navigate')
    expect(respondida?.status).toBe(200)
    expect(await sw.cache.casca()).toBe('<!doctype html><title>deploy novo</title>')
  })

  it('navegação que deu erro (500 em HTML) chega à tela, mas não substitui a casca', async () => {
    const sw = await workerComCasca(async () => html('<h1>erro da borda</h1>', 500))
    const respondida = await sw.pedir('/', 'navigate')
    expect(respondida?.status).toBe(500)
    expect(await sw.cache.casca()).toBe(CASCA_ANTIGA)
  })

  it('navegação 404 não substitui a casca', async () => {
    const sw = await workerComCasca(async () => html('nada aqui', 404))
    await sw.pedir('/nao-existe', 'navigate')
    expect(await sw.cache.casca()).toBe(CASCA_ANTIGA)
  })

  it.each(['application/pdf', 'image/jpeg', 'application/json', 'text/plain'])(
    'navegação ok que não é HTML (%s) não substitui a casca',
    async (tipo) => {
      const sw = await workerComCasca(async () => arquivo(tipo))
      await sw.pedir('/um-arquivo-qualquer', 'navigate')
      expect(await sw.cache.casca()).toBe(CASCA_ANTIGA)
    },
  )

  it('sem rede, a navegação recebe a última casca boa', async () => {
    const sw = await workerComCasca(async () => {
      throw new TypeError('Failed to fetch')
    })
    const respondida = await sw.pedir('/espelho', 'navigate')
    expect(await respondida?.text()).toBe(CASCA_ANTIGA)
  })
})

describe('versão e limpeza do cache', () => {
  it('a ativação deixa só o cache desta versão e apaga os outros, com a casca que eles guardavam', async () => {
    const sw = ligarServiceWorker(async () => html('ok'))
    // O cache de outra versão (o de um aparelho que vem da anterior), com a
    // casca possivelmente errada, e um de outro nome.
    await (await sw.cache.api.open('ponto-v0')).put('/', arquivo('application/pdf'))
    await (await sw.cache.api.open('outro-cache')).put('/', arquivo('application/pdf'))
    await sw.instalar()
    await sw.ativar()
    const versaoDoArquivo = /const VERSAO = '(ponto-v\d+)'/.exec(textoDoServiceWorker)?.[1]
    expect(versaoDoArquivo).not.toBe('ponto-v0')
    expect(await sw.cache.api.keys()).toEqual([versaoDoArquivo])
    expect(await sw.cache.casca()).toBe('precache /')
  })

  it('o nome do cache é neutro, sem marca de empresa: `ponto-v<número>`', () => {
    expect(textoDoServiceWorker).toMatch(/const VERSAO = 'ponto-v\d+'/)
  })
})

describe('o resto: escrita, outra origem e assets', () => {
  it('escrita e outra origem nunca passam pelo worker', async () => {
    const sw = await workerComCasca(async () => html('ok'))
    expect(await sw.pedir('/rest/v1/ponto_batidas', 'cors', 'POST')).toBeNull()
    expect(await sw.pedir('/', 'navigate', 'POST')).toBeNull()
    expect(await sw.pedir('https://fonts.googleapis.com/css2?family=Quicksand', 'cors')).toBeNull()
    expect(sw.pedidosARede).toEqual([])
  })

  it('asset com hash: guardado só quando ok, e servido do cache depois', async () => {
    let status = 404
    const sw = await workerComCasca(async () => new Response('js', { status }))
    await sw.pedir('/assets/index-abc.js')
    expect(await sw.cache.api.match(`${ORIGEM}/assets/index-abc.js`)).toBeUndefined()
    status = 200
    await sw.pedir('/assets/index-abc.js')
    await sw.pedir('/assets/index-abc.js')
    expect(sw.pedidosARede).toHaveLength(2)
  })
})
