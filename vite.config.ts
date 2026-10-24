import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { aplicarMarcaNoHtml, CAMINHO_DO_MANIFESTO, lerMarca, textoDoManifesto } from './src/lib/marca.ts'
import {
  aplicarPoliticaNoHeaders,
  aplicarPoliticaNoHtml,
  hashesDosEstilos,
  lerBlocosDoHeaders,
  lerSupabaseDoBuild,
  montarPolitica,
  politicaDoCabecalho,
  problemasParaAPolitica,
  type SupabaseDoBuild,
} from './src/lib/politica-de-conteudo.ts'

/*
 * A MARCA ENTRA NO BUILD POR ESTE PLUGIN.
 *
 * O nome do app vem de VITE_NOME_DO_APP e VITE_SLOGAN_DO_APP (ver
 * `src/lib/marca.ts`, que tem as regras e os padrões). O plugin só liga as
 * regras aos dois arquivos que o navegador lê ANTES do JavaScript:
 *
 *   - o `index.html`: os marcadores `%NOME_DO_APP%` e `%DESCRICAO_DO_APP%`
 *     viram o texto, no build e no `npm run dev`. É o título da aba e o nome que
 *     o iPhone dá ao ícone;
 *   - o `manifest.webmanifest`: gerado a partir das mesmas variáveis. No build
 *     ele sai como arquivo em `dist/`; no `npm run dev`, é servido direto da
 *     memória. Por isso ele não existe em `public/`.
 *
 * `config.env` traz as VITE_* do ambiente e dos arquivos `.env`, com a mesma
 * precedência que o app enxerga em `import.meta.env`: o nome do título e o da
 * tela de entrar nunca divergem.
 */
function pluginDaMarca(): Plugin {
  let marca = lerMarca({})
  return {
    name: 'ponto:marca',
    configResolved(config) {
      marca = lerMarca(config.env)
    },
    transformIndexHtml(html) {
      return aplicarMarcaNoHtml(html, marca)
    },
    configureServer(server) {
      server.middlewares.use((pedido, resposta, seguir) => {
        if (pedido.url?.split('?')[0] !== CAMINHO_DO_MANIFESTO) return seguir()
        resposta.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
        resposta.setHeader('Cache-Control', 'no-cache')
        resposta.end(textoDoManifesto(marca))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: CAMINHO_DO_MANIFESTO.slice(1),
        source: textoDoManifesto(marca),
      })
    },
  }
}

/*
 * A POLÍTICA DE CONTEÚDO (CSP) ENTRA NO BUILD POR ESTE PLUGIN.
 *
 * As regras (cada diretiva e o porquê) moram em
 * `src/lib/politica-de-conteudo.ts`. Aqui só se liga a regra ao build:
 *
 *   1. a origem do Supabase sai de VITE_SUPABASE_URL (`config.env`, a mesma
 *      que o app grava no bundle). Valor torto derruba o build;
 *   2. o hash de cada `<style>` em linha é calculado sobre o `index.html` JÁ
 *      PROCESSADO pelo Vite (que minifica o CSS em linha), e sobre o
 *      `public/404.html`, que sai do jeito que está. Por isso o gancho é
 *      `order: 'post'` num plugin `enforce: 'post'`: ele recebe o HTML final,
 *      com o script e o CSS do build já citados;
 *   3. a meta entra no `index.html` e no `404.html` do build, e a mesma
 *      política, com `frame-ancestors 'none'`, entra no `dist/_headers` (o
 *      `public/_headers` é o modelo: só a linha da CSP do bloco `/*` muda).
 *
 * SÓ NO BUILD (`apply: 'build'`): o `npm run dev` roda com scripts em linha e
 * com a recarga a quente do Vite, que esta política recusaria. Quem confere o
 * app com a política é o `npm run preview` (ver o plugin abaixo) e o teste
 * `e2e/csp.spec.ts`.
 */
function pluginDaPolitica(): Plugin {
  let supabase: SupabaseDoBuild = { origem: null, https: false }
  let pastaPublica = ''
  let politica: string | null = null

  /** Um arquivo de `public/`, ou null se ele não existir (ou não houver `public/`). */
  function lerPublico(nome: string): string | null {
    if (!pastaPublica) return null
    const caminho = join(pastaPublica, nome)
    return existsSync(caminho) ? readFileSync(caminho, 'utf8') : null
  }

  return {
    name: 'ponto:politica-de-conteudo',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      supabase = lerSupabaseDoBuild(config.env)
      pastaPublica = config.publicDir
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        const pagina404 = lerPublico('404.html')
        const paginas = pagina404 === null ? [html] : [html, pagina404]
        const problemas = paginas.flatMap(problemasParaAPolitica)
        if (problemas.length > 0) {
          throw new Error(`A política de conteúdo recusaria parte do HTML:\n  - ${problemas.join('\n  - ')}`)
        }
        politica = montarPolitica({ supabase, hashesDeEstilo: await hashesDosEstilos(paginas) })
        return aplicarPoliticaNoHtml(html, politica)
      },
    },
    generateBundle() {
      if (politica === null) {
        this.error('A política de conteúdo não foi montada: o index.html não passou pelo plugin.')
      }
      // O que o Vite copiou de `public/` é sobrescrito por estes, na escrita.
      const headers = lerPublico('_headers')
      if (headers !== null) {
        this.emitFile({
          type: 'asset',
          fileName: '_headers',
          source: aplicarPoliticaNoHeaders(headers, politicaDoCabecalho(politica)),
        })
      }
      const pagina404 = lerPublico('404.html')
      if (pagina404 !== null) {
        this.emitFile({ type: 'asset', fileName: '404.html', source: aplicarPoliticaNoHtml(pagina404, politica) })
      }
    },
  }
}

/*
 * O `npm run preview` RESPONDE COM OS CABEÇALHOS DO `dist/_headers`.
 *
 * Os do bloco `/*` (a CSP com `frame-ancestors`, a Permissions-Policy, o
 * Referrer-Policy...) vão em toda resposta, como no Cloudflare Pages e no
 * Netlify. Assim o preview mostra o app como ele vai para o ar: a meta e o
 * cabeçalho somados, e o service worker também sob a política (worker não
 * herda a meta da página; ele obedece ao cabeçalho da própria resposta). Os
 * blocos de cache (`/sw.js`, `/assets/*`) não são imitados: não mudam o que o
 * navegador deixa rodar.
 */
function pluginDosCabecalhosNoPreview(): Plugin {
  return {
    name: 'ponto:cabecalhos-no-preview',
    configurePreviewServer(server) {
      const arquivo = resolve(server.config.root, server.config.build.outDir, '_headers')
      if (!existsSync(arquivo)) return
      const doSite = lerBlocosDoHeaders(readFileSync(arquivo, 'utf8')).get('/*')
      if (!doSite) return
      // Sem devolver função: o middleware entra ANTES do que serve os
      // arquivos, e os cabeçalhos já estão na resposta quando ela sai.
      server.middlewares.use((_pedido, resposta, seguir) => {
        for (const [nome, valor] of doSite) resposta.setHeader(nome, valor)
        seguir()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pluginDaMarca(),
    pluginDaPolitica(),
    pluginDosCabecalhosNoPreview(),
  ],
  build: {
    /*
     * Nenhum arquivo vira `data:` dentro do CSS ou do JavaScript: a política
     * de conteúdo não libera `data:` nem para fonte nem para imagem. Sem esta
     * linha, os arquivos de fonte de menos de 4 kB (os alfabetos pequenos da
     * JetBrains Mono) entrariam no CSS como `data:font/woff2` e seriam
     * recusados no navegador.
     */
    assetsInlineLimit: 0,
  },
  server: {
    /*
     * Só na própria máquina, o padrão do Vite, escrito para ninguém trocar
     * por `true` sem ler isto. O servidor de desenvolvimento não é feito para
     * ficar exposto: as falhas que aparecem nele (ler arquivo fora do projeto,
     * rodar script vindo de outro endereço) só alcançam quem chega até a
     * porta. Para abrir no celular pela rede local, peça na hora:
     * `npm run dev -- --host`. Pelo IP da rede o endereço é http, e o celular
     * não libera câmera nem GPS fora de https: serve para conferir o layout.
     */
    host: 'localhost',
  },
})
