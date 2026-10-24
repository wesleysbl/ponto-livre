import { describe, expect, it } from 'vitest'
import textoDoApp from './App.tsx?raw'
import textoDoHeaders from '../public/_headers?raw'
import textoDoRedirects from '../public/_redirects?raw'
import textoDaPaginaDe404 from '../public/404.html?raw'
import textoDoVercel from '../vercel.json?raw'
import textoDoCaddyfile from '../exemplos/servidor/Caddyfile?raw'
import { CSP_DO_MODELO } from './lib/politica-de-conteudo'

/*
 * AS TRÊS HOSPEDAGENS DIZEM O MESMO QUE O APP.
 *
 * O build (`dist/`) é um site estático, e cada hospedagem tem o seu jeito de
 * dizer duas coisas: os cabeçalhos de segurança e de cache, e em quais
 * caminhos voltar ao `index.html`.
 *
 *   public/_headers e public/_redirects   Cloudflare Pages e Netlify
 *   vercel.json                           Vercel
 *   exemplos/servidor/Caddyfile           um servidor próprio, com o Caddy
 *
 * O DEFEITO QUE ESTE ARQUIVO SEGURA
 * Nada no build quebra quando os quatro divergem, e a divergência só aparece
 * em produção:
 *   - uma rota nova entra em `src/App.tsx` e a hospedagem responde 404 a ela
 *     num F5 ou num atalho da tela de início;
 *   - um cabeçalho muda num arquivo e não no outro, e o app fica protegido numa
 *     hospedagem e não na outra;
 *   - alguém troca as rotas por uma volta geral (`/*`, `try_files`) e um
 *     `/assets/` inexistente passa a responder 200 com HTML — que o service
 *     worker guardaria como se fosse o JavaScript.
 *
 * COMO SE TESTA
 * Lendo os arquivos como texto (`?raw`) e comparando o que um declara com o
 * que o outro faz. O comportamento de cada hospedagem (o 404 de verdade, o
 * cabeçalho na resposta) é conferido nela, depois de publicar.
 */

/* ------------------------------------------------------------------ */
/* As rotas                                                            */
/* ------------------------------------------------------------------ */

/** Parâmetro de rota (`/:usuarioId`) vira `/*`: as hospedagens casam o caminho todo. */
function comCuringa(caminho: string): string {
  return caminho.replace(/\/:[A-Za-z]+$/, '/*')
}

/** As rotas de `src/App.tsx`, sem a rota curinga e com o parâmetro como `/*`. */
const ROTAS_DO_APP = [...textoDoApp.matchAll(/path="([^"]+)"/g)]
  .map((achado) => achado[1])
  .filter((caminho) => caminho !== '*')
  .map(comCuringa)

/** A raiz já é o `index.html` em toda hospedagem: as outras precisam de regra. */
const ROTAS_QUE_PRECISAM_DE_REGRA = ROTAS_DO_APP.filter((caminho) => caminho !== '/')

function ordenadas(lista: readonly string[]): string[] {
  return [...lista].sort()
}

/** Linhas que contam: sem as vazias e sem os comentários (`#` no começo). */
function linhasUteis(texto: string): string[] {
  return texto
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '' && !linha.startsWith('#'))
}

/** As regras de `_redirects`: origem, destino e status. */
const REGRAS = linhasUteis(textoDoRedirects).map((linha) => {
  const [origem, destino, status, ...sobra] = linha.split(/\s+/)
  return { origem, destino, status, sobra }
})

interface RegraDoVercel {
  source: string
  destination: string
}
interface CabecalhosDoVercel {
  source: string
  headers: { key: string; value: string }[]
}
const VERCEL = JSON.parse(textoDoVercel) as { rewrites: RegraDoVercel[]; headers: CabecalhosDoVercel[] }

const CADDY = linhasUteis(textoDoCaddyfile)

/** Os caminhos de um matcher de uma linha só do Caddyfile: `@nome path /a /b`. */
function caminhosDoMatcher(nome: string): string[] {
  const linha = CADDY.find((l) => l.startsWith(`@${nome} path `))
  expect(linha, `@${nome} path ... no Caddyfile`).toBeDefined()
  return linha!.split(/\s+/).slice(2)
}

describe('as rotas do app', () => {
  it('são as nove de src/App.tsx (a leitura do arquivo não perdeu nenhuma)', () => {
    expect(ordenadas(ROTAS_DO_APP)).toEqual(
      ordenadas(['/', '/entrar', '/sem-acesso', '/definir-pin', '/espelho', '/painel', '/painel/*', '/administracao', '/folha/*']),
    )
  })

  it('_redirects (Pages e Netlify) volta ao app exatamente nelas, com 200 e sem mudar o endereço', () => {
    expect(ordenadas(REGRAS.map((regra) => regra.origem))).toEqual(ordenadas(ROTAS_QUE_PRECISAM_DE_REGRA))
    for (const regra of REGRAS) {
      // `/`, e não `/index.html`: o Pages responde este com 308 para `/` e
      // ignora a regra com `*` que aponta para ele (ver o cabeçalho do arquivo).
      expect(regra, regra.origem).toEqual({ origem: regra.origem, destino: '/', status: '200', sobra: [] })
    }
  })

  it('_redirects lista as rotas exatas antes das com `*`', () => {
    const comCuringaPrimeiro = REGRAS.findIndex((regra) => regra.origem.includes('*'))
    expect(REGRAS.slice(comCuringaPrimeiro).every((regra) => regra.origem.includes('*'))).toBe(true)
  })

  it('vercel.json reescreve exatamente as mesmas, para o index.html', () => {
    expect(ordenadas(VERCEL.rewrites.map((regra) => comCuringa(regra.source)))).toEqual(
      ordenadas(ROTAS_QUE_PRECISAM_DE_REGRA),
    )
    for (const regra of VERCEL.rewrites) expect(regra.destination, regra.source).toBe('/index.html')
    // O parâmetro tem o nome do app: as duas listas se leem lado a lado.
    expect(VERCEL.rewrites.map((regra) => regra.source)).toContain('/painel/:usuarioId')
  })

  it('o Caddyfile volta ao index.html exatamente nelas', () => {
    expect(ordenadas(caminhosDoMatcher('app'))).toEqual(ordenadas(ROTAS_QUE_PRECISAM_DE_REGRA))
    expect(CADDY).toContain('rewrite @app /index.html')
  })

  it('nenhuma volta geral ao app: um /assets/ que não existe continua 404', () => {
    const origens = [
      ...REGRAS.map((regra) => regra.origem),
      ...VERCEL.rewrites.map((regra) => regra.source),
      ...caminhosDoMatcher('app'),
    ]
    for (const origem of origens) {
      expect(origem, 'regra que pega qualquer caminho').not.toMatch(/^\/(\*|\(\.\*\)|:[A-Za-z]+\*?)$/)
      expect(origem, 'regra que pega /assets/').not.toMatch(/^\/assets/)
    }
    expect(textoDoCaddyfile).not.toMatch(/^\s*try_files/m)
  })

  it('o 404.html existe, é estático (sem script nem nada de fora) e leva ao app', () => {
    expect(textoDaPaginaDe404).toMatch(/^<!doctype html>/i)
    expect(textoDaPaginaDe404).not.toMatch(/<script|<link|https?:\/\//i)
    expect(textoDaPaginaDe404).toContain('<a href="/">')
    // O Caddyfile responde o 404 com ele.
    const erros = CADDY.indexOf('handle_errors 404 {')
    expect(erros, 'handle_errors 404 no Caddyfile').toBeGreaterThan(-1)
    expect(CADDY.slice(erros + 1, CADDY.indexOf('}', erros))).toEqual(['rewrite * /404.html', 'file_server'])
  })
})

/* ------------------------------------------------------------------ */
/* Os cabeçalhos                                                       */
/* ------------------------------------------------------------------ */

/** Os blocos de `public/_headers`: caminho → (cabeçalho → valor). */
function blocosDoHeaders(texto: string): Map<string, Map<string, string>> {
  const blocos = new Map<string, Map<string, string>>()
  let atual: Map<string, string> | null = null
  for (const linha of texto.split('\n')) {
    if (linha.trim() === '' || linha.startsWith('#')) continue
    if (!/^\s/.test(linha)) {
      atual = new Map()
      blocos.set(linha.trim(), atual)
      continue
    }
    const doisPontos = linha.indexOf(':')
    expect(atual, `cabeçalho fora de bloco: ${linha}`).not.toBeNull()
    atual!.set(linha.slice(0, doisPontos).trim(), linha.slice(doisPontos + 1).trim())
  }
  return blocos
}

const HEADERS = blocosDoHeaders(textoDoHeaders)

/** `/(.*)` do Vercel e `/*` do `_headers` são o mesmo caminho. */
function caminhoDoVercel(source: string): string {
  return source.replace(/\(\.\*\)$/, '*')
}

const BLOCOS_DO_VERCEL = new Map(
  VERCEL.headers.map((bloco) => [
    caminhoDoVercel(bloco.source),
    new Map(bloco.headers.map(({ key, value }) => [key, value])),
  ]),
)

function semAspas(valor: string): string {
  return valor.replace(/^"(.*)"$/, '$1')
}

/** O bloco `header { ... }` do site todo, no Caddyfile. */
function blocoDoSiteNoCaddy(): Map<string, string> {
  const inicio = CADDY.indexOf('header {')
  expect(inicio, 'header { ... } no Caddyfile').toBeGreaterThan(-1)
  const linhas = CADDY.slice(inicio + 1, CADDY.indexOf('}', inicio))
  const bloco = new Map<string, string>()
  for (const linha of linhas) {
    // `defer`, ou uma linha que apaga (`-`), dá padrão (`?`) ou usa `>`, faz o
    // Caddy adiar o bloco INTEIRO, e o adiado não chega à página de 404 (que o
    // `handle_errors` escreve fora desta cadeia): ela sairia sem os oito.
    expect(linha, 'operação que liga o defer no bloco do site').not.toMatch(/^(defer$|[-?>])/)
    const espaco = linha.indexOf(' ')
    const nome = linha.slice(0, espaco)
    expect(bloco.has(nome), `${nome} repetido no bloco do site`).toBe(false)
    bloco.set(nome, semAspas(linha.slice(espaco + 1).trim()))
  }
  return bloco
}

/** O valor de `header <alvo> <Nome> "<valor>"` no Caddyfile, ou undefined. */
function valorNoCaddy(alvo: string | null, nome: string): string | undefined {
  const prefixo = alvo ? `header ${alvo} ${nome} ` : `header ${nome} `
  const linha = CADDY.find((l) => l.startsWith(prefixo))
  return linha === undefined ? undefined : semAspas(linha.slice(prefixo.length))
}

describe('os cabeçalhos', () => {
  it('_headers tem os quatro blocos: o app todo, o service worker, o manifesto e os arquivos do build', () => {
    expect([...HEADERS.keys()]).toEqual(['/*', '/sw.js', '/manifest.webmanifest', '/assets/*'])
    expect(HEADERS.get('/*')!.size).toBe(8)
    expect(HEADERS.get('/*')!.get('Permissions-Policy')).toBe('camera=(self), geolocation=(self), microphone=()')
  })

  it('a CSP dos três arquivos é o modelo, que o build completa no dist/_headers e na meta do HTML', () => {
    // O resto da política depende do Supabase de cada instalação e é gerado
    // no build (`src/lib/politica-de-conteudo.ts`). Os três arquivos daqui
    // ficam iguais entre si (os testes logo abaixo comparam o valor).
    expect(HEADERS.get('/*')!.get('Content-Security-Policy')).toBe(CSP_DO_MODELO)
    expect(CSP_DO_MODELO).toBe("frame-ancestors 'none'")
  })

  it('vercel.json tem os mesmos blocos, com os mesmos cabeçalhos e valores', () => {
    expect([...BLOCOS_DO_VERCEL.keys()]).toEqual([...HEADERS.keys()])
    for (const [caminho, cabecalhos] of HEADERS) {
      expect(Object.fromEntries(BLOCOS_DO_VERCEL.get(caminho)!), caminho).toEqual(Object.fromEntries(cabecalhos))
    }
  })

  it('o Caddyfile manda os oito do app todo, no site inteiro e antes do route, com os mesmos valores', () => {
    expect(Object.fromEntries(blocoDoSiteNoCaddy())).toEqual(Object.fromEntries(HEADERS.get('/*')!))
    // No nível do site, fora do `route`: valem para a página, os arquivos e o 404.
    expect(CADDY.indexOf('header {')).toBeLessThan(CADDY.indexOf('route {'))
  })

  it('o Caddyfile repete o cache de _headers: sw.js sem cache, manifesto revalidando, /assets/ eterno', () => {
    const cache = (caminho: string) => HEADERS.get(caminho)!.get('Cache-Control')
    expect(valorNoCaddy('/sw.js', 'Cache-Control')).toBe(cache('/sw.js'))
    // O padrão do Caddyfile (index.html, rotas do app e manifesto) é o do manifesto.
    expect(valorNoCaddy(null, 'Cache-Control')).toBe(cache('/manifest.webmanifest'))
    expect(valorNoCaddy('@asset_existe', 'Cache-Control')).toBe(cache('/assets/*'))
    // O eterno vale só para o arquivo que EXISTE em /assets/.
    const inicio = CADDY.indexOf('@asset_existe {')
    expect(ordenadas(CADDY.slice(inicio + 1, CADDY.indexOf('}', inicio)))).toEqual(['file', 'path /assets/*'])
  })

  it('no Caddyfile, a ordem dentro do route faz o específico ganhar e a volta ao app vir antes do file_server', () => {
    const posicao = (texto: string) => {
      const i = CADDY.findIndex((l) => l.startsWith(texto))
      expect(i, texto).toBeGreaterThan(-1)
      return i
    }
    expect(posicao('root * ')).toBeLessThan(posicao('route {'))
    expect(posicao('header Cache-Control')).toBeLessThan(posicao('header /sw.js Cache-Control'))
    expect(posicao('header Cache-Control')).toBeLessThan(posicao('header @asset_existe Cache-Control'))
    expect(posicao('respond @config_de_hospedagem 404')).toBeLessThan(posicao('file_server'))
    expect(posicao('rewrite @app /index.html')).toBeLessThan(posicao('file_server'))
    expect(caminhosDoMatcher('config_de_hospedagem')).toEqual(['/_headers', '/_redirects'])
  })
})
