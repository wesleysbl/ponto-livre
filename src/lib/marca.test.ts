import { describe, expect, it } from 'vitest'
import textoDoIndex from '../../index.html?raw'
import textoDoServiceWorker from '../../public/sw.js?raw'
import {
  aplicarMarcaNoHtml,
  CAMINHO_DO_MANIFESTO,
  COR_DO_FUNDO,
  DESCRICAO_DO_APP,
  escaparHtml,
  ICONES_DO_MANIFESTO,
  lerMarca,
  MARCADOR_DA_DESCRICAO,
  MARCADOR_DO_NOME,
  montarManifesto,
  NOME_PADRAO,
  textoDoManifesto,
} from './marca'

/*
 * A MARCA DO APP: as regras puras de `marca.ts` e os arquivos que dependem
 * delas — o `index.html` com os marcadores, o manifesto e os ícones de
 * `public/`. O plugin do `vite.config.ts` só liga estas funções ao build; o
 * build com o nome configurado se confere à parte, rodando `npm run build` com
 * as variáveis do nome definidas e lendo o `dist/`.
 */

/** Os PNGs de `public/`, como data URL (`?inline`), pelo nome do arquivo. */
const PNGS_DE_PUBLIC = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../public/*.png', { query: '?inline', import: 'default', eager: true }),
  ).map(([caminho, dados]) => [caminho.replace('../../public', ''), dados]),
)

/** Os arquivos de `public/` que não são PNG, pelo nome. */
const OUTROS_DE_PUBLIC = Object.keys(
  import.meta.glob(['../../public/*', '!../../public/*.png'], { query: '?raw', import: 'default', eager: true }),
).map((caminho) => caminho.replace('../../public', ''))

/** Largura e altura de um PNG, lidas do cabeçalho IHDR (bytes 16 a 23). */
function tamanhoDoPng(dataUrl: string): string {
  const binario = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const byte = (i: number) => binario.charCodeAt(i)
  expect(binario.slice(1, 4), 'assinatura PNG').toBe('PNG')
  expect(binario.slice(12, 16), 'cabeçalho IHDR').toBe('IHDR')
  const largura = (byte(16) << 24) | (byte(17) << 16) | (byte(18) << 8) | byte(19)
  const altura = (byte(20) << 24) | (byte(21) << 16) | (byte(22) << 8) | byte(23)
  return `${largura}x${altura}`
}

describe('lerMarca — o nome e o slogan com os padrões', () => {
  it('sem variável nenhuma: "Ponto", sem slogan', () => {
    expect(lerMarca({})).toEqual({ nome: 'Ponto', slogan: '' })
    expect(NOME_PADRAO).toBe('Ponto')
  })

  it('variável vazia, ou só com espaços, vale o mesmo que não definida', () => {
    expect(lerMarca({ VITE_NOME_DO_APP: '', VITE_SLOGAN_DO_APP: '' })).toEqual({ nome: 'Ponto', slogan: '' })
    expect(lerMarca({ VITE_NOME_DO_APP: '   ', VITE_SLOGAN_DO_APP: ' \n ' })).toEqual({ nome: 'Ponto', slogan: '' })
  })

  it('com as variáveis: o nome e o slogan configurados, sem espaço nas pontas', () => {
    expect(
      lerMarca({ VITE_NOME_DO_APP: '  Padaria Pão Quente ', VITE_SLOGAN_DO_APP: ' fresquinho todo dia  ' }),
    ).toEqual({ nome: 'Padaria Pão Quente', slogan: 'fresquinho todo dia' })
  })

  it('quebra de linha e espaço repetido no meio viram um espaço só: o nome vai para o título da aba', () => {
    expect(lerMarca({ VITE_NOME_DO_APP: 'Padaria\n  Pão\tQuente' }).nome).toBe('Padaria Pão Quente')
  })

  it('o que não é texto conta como ausente (o `config.env` do Vite traz booleanos, como DEV e PROD)', () => {
    expect(lerMarca({ VITE_NOME_DO_APP: true, VITE_SLOGAN_DO_APP: 42 })).toEqual({ nome: 'Ponto', slogan: '' })
  })

  it('só o slogan, sem nome: o nome padrão com o slogan configurado', () => {
    expect(lerMarca({ VITE_SLOGAN_DO_APP: 'nós chegamos cedo' })).toEqual({ nome: 'Ponto', slogan: 'nós chegamos cedo' })
  })
})

describe('montarManifesto — o manifest.webmanifest gerado no build', () => {
  const padrao = montarManifesto(lerMarca({}))

  it('sem variável, o nome padrão no nome e no nome curto', () => {
    expect(padrao.name).toBe('Ponto')
    expect(padrao.short_name).toBe('Ponto')
  })

  it('com a variável, o nome configurado', () => {
    const manifesto = montarManifesto(lerMarca({ VITE_NOME_DO_APP: 'Padaria Pão Quente' }))
    expect(manifesto.name).toBe('Padaria Pão Quente')
    expect(manifesto.short_name).toBe('Padaria Pão Quente')
  })

  it('os campos do app instalado: tela cheia, em pé, na raiz de qualquer endereço, no fundo escuro', () => {
    expect(padrao).toMatchObject({
      description: DESCRICAO_DO_APP,
      lang: 'pt-BR',
      dir: 'ltr',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#050506',
      theme_color: '#050506',
      categories: ['business', 'productivity'],
    })
  })

  it('o ícone de 192, o de 512 e um maskable, à parte', () => {
    expect(padrao.icons).toEqual([
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ])
  })

  it('o texto do arquivo é JSON válido, igual ao objeto, com quebra de linha no fim', () => {
    const marca = lerMarca({ VITE_NOME_DO_APP: 'Café & Cia "Ltda"' })
    const texto = textoDoManifesto(marca)
    expect(JSON.parse(texto)).toEqual(montarManifesto(marca))
    expect(JSON.parse(texto).name).toBe('Café & Cia "Ltda"')
    expect(texto.endsWith('}\n')).toBe(true)
  })

  it('montar de novo não reaproveita os ícones de antes (cada manifesto é um objeto novo)', () => {
    const um = montarManifesto(lerMarca({}))
    um.icons[0].src = '/outro.png'
    expect(montarManifesto(lerMarca({})).icons[0].src).toBe('/icone-192.png')
  })
})

describe('aplicarMarcaNoHtml — os marcadores do index.html', () => {
  it('troca o nome e a descrição, em todos os lugares', () => {
    const html = `<title>${MARCADOR_DO_NOME}</title><meta content="${MARCADOR_DO_NOME}"><meta content="${MARCADOR_DA_DESCRICAO}">`
    expect(aplicarMarcaNoHtml(html, lerMarca({ VITE_NOME_DO_APP: 'Padaria Pão Quente' }))).toBe(
      `<title>Padaria Pão Quente</title><meta content="Padaria Pão Quente"><meta content="${DESCRICAO_DO_APP}">`,
    )
  })

  it('sem variável, o nome padrão', () => {
    expect(aplicarMarcaNoHtml(`<title>${MARCADOR_DO_NOME}</title>`, lerMarca({}))).toBe('<title>Ponto</title>')
  })

  it('o nome entra escapado: não fecha atributo nem abre tag', () => {
    const marca = lerMarca({ VITE_NOME_DO_APP: `Café & "Cia" <b>'s` })
    expect(aplicarMarcaNoHtml(`<meta content="${MARCADOR_DO_NOME}">`, marca)).toBe(
      '<meta content="Café &amp; &quot;Cia&quot; &lt;b&gt;&#39;s">',
    )
    expect(escaparHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('padrões de substituição no nome ($&, $\') ficam como texto', () => {
    const marca = lerMarca({ VITE_NOME_DO_APP: "Loja $& $' $1" })
    expect(aplicarMarcaNoHtml(`<title>${MARCADOR_DO_NOME}</title>`, marca)).toBe("<title>Loja $&amp; $&#39; $1</title>")
  })

  it('um nome que contém o outro marcador não é trocado de novo', () => {
    const marca = lerMarca({ VITE_NOME_DO_APP: MARCADOR_DA_DESCRICAO })
    expect(aplicarMarcaNoHtml(`<title>${MARCADOR_DO_NOME}</title>`, marca)).toBe(`<title>${MARCADOR_DA_DESCRICAO}</title>`)
  })

  it('o resto do HTML não muda (o "%" de um CSS, por exemplo)', () => {
    const html = '<style>div { width: 100%; height: 50%; }</style>'
    expect(aplicarMarcaNoHtml(html, lerMarca({}))).toBe(html)
  })
})

describe('o index.html', () => {
  const aplicado = aplicarMarcaNoHtml(textoDoIndex, lerMarca({ VITE_NOME_DO_APP: 'Padaria Pão Quente' }))

  it('tem o nome no título, no nome do ícone do iPhone e no aviso de emergência', () => {
    expect(textoDoIndex).toContain(`<title>${MARCADOR_DO_NOME}</title>`)
    expect(textoDoIndex).toContain(`<meta name="apple-mobile-web-app-title" content="${MARCADOR_DO_NOME}" />`)
    expect(textoDoIndex).toContain(`<meta name="description" content="${MARCADOR_DA_DESCRICAO}" />`)
    expect(aplicado).toContain('<title>Padaria Pão Quente</title>')
    expect(aplicado).toContain('<h1>Não foi possível carregar o app Padaria Pão Quente</h1>')
  })

  it('depois do build, nenhum marcador sobra', () => {
    expect(aplicado).not.toMatch(/%NOME_DO_APP%|%DESCRICAO_DO_APP%/)
  })

  it('aponta para o manifesto gerado, e a cor da barra é a do manifesto', () => {
    expect(textoDoIndex).toContain(`<link rel="manifest" href="${CAMINHO_DO_MANIFESTO}" />`)
    expect(textoDoIndex).toContain(`<meta name="theme-color" content="${COR_DO_FUNDO}" />`)
    expect(montarManifesto(lerMarca({})).theme_color).toBe(COR_DO_FUNDO)
  })

  it('o favicon e o ícone do iPhone que ele cita existem em public/', () => {
    const citados = [...textoDoIndex.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map(
      (achado) => achado[1],
    )
    expect(citados).toEqual(['/favicon.svg', '/apple-touch-icon.png'])
    expect(OUTROS_DE_PUBLIC).toContain('/favicon.svg')
    expect(tamanhoDoPng(PNGS_DE_PUBLIC['/apple-touch-icon.png'])).toBe('180x180')
  })
})

describe('os ícones e o manifesto em public/', () => {
  it.each(ICONES_DO_MANIFESTO.map((icone) => [icone.src, icone.sizes]))(
    '%s existe em public/ e tem %s',
    (src, tamanho) => {
      expect(PNGS_DE_PUBLIC[src], `${src} em public/`).toBeDefined()
      expect(tamanhoDoPng(PNGS_DE_PUBLIC[src])).toBe(tamanho)
    },
  )

  it('o manifesto NÃO existe em public/: ele sai do build, com o nome configurado', () => {
    expect(OUTROS_DE_PUBLIC).not.toContain(CAMINHO_DO_MANIFESTO)
  })

  it('a casca do service worker leva o manifesto e todos os ícones que ele e o index.html citam', () => {
    const lista = textoDoServiceWorker.match(/const CASCA = \[([^\]]*)\]/)
    expect(lista, 'const CASCA = [...] em public/sw.js').not.toBeNull()
    const casca = [...lista![1].matchAll(/'([^']+)'/g)].map((achado) => achado[1])
    for (const caminho of [
      '/',
      CAMINHO_DO_MANIFESTO,
      '/favicon.svg',
      '/apple-touch-icon.png',
      ...ICONES_DO_MANIFESTO.map((icone) => icone.src),
    ]) {
      expect(casca, caminho).toContain(caminho)
    }
    // Tudo o que a casca guarda existe (o manifesto e a raiz saem do build).
    for (const caminho of casca.filter((c) => c !== '/' && c !== CAMINHO_DO_MANIFESTO)) {
      expect([...OUTROS_DE_PUBLIC, ...Object.keys(PNGS_DE_PUBLIC)], caminho).toContain(caminho)
    }
  })
})
