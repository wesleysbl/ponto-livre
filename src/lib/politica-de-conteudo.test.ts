import { describe, expect, it } from 'vitest'
import textoDoIndex from '../../index.html?raw'
import textoDaPaginaDe404 from '../../public/404.html?raw'
import textoDoHeaders from '../../public/_headers?raw'
import {
  aplicarPoliticaNoHeaders,
  aplicarPoliticaNoHtml,
  CSP_DO_MODELO,
  estilosEmLinha,
  FRAME_ANCESTORS,
  hashDoEstilo,
  hashesDosEstilos,
  lerBlocosDoHeaders,
  lerSupabaseDoBuild,
  montarPolitica,
  politicaDoCabecalho,
  problemasParaAPolitica,
} from './politica-de-conteudo'

/*
 * A POLÍTICA DE CONTEÚDO (CSP): as regras puras de `politica-de-conteudo.ts`.
 *
 * O plugin do `vite.config.ts` só liga estas funções ao build. O que se confere
 * aqui é o texto da política, a meta no HTML e a linha do `_headers`; o que se
 * confere no navegador (o app inteiro sob a política, sem nenhuma recusa) é o
 * `e2e/csp.spec.ts`, contra o build de verdade.
 *
 * Os hashes esperados abaixo foram calculados fora daqui (Python, hashlib), e
 * não por este código: um erro no cálculo não confirma a si mesmo.
 */

const SUPABASE_NA_NUVEM = lerSupabaseDoBuild({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co' })
const SUPABASE_LOCAL = lerSupabaseDoBuild({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321' })
const SEM_SUPABASE = lerSupabaseDoBuild({})

/** As diretivas da política, pelo nome: `{ 'img-src': ["'self'", 'blob:'] }`. */
function diretivas(politica: string): Record<string, string[]> {
  const nomes = politica.split('; ').map((diretiva) => diretiva.split(' ')[0])
  expect(new Set(nomes).size, 'diretiva repetida').toBe(nomes.length)
  return Object.fromEntries(politica.split('; ').map((diretiva) => {
    const [nome, ...fontes] = diretiva.split(' ')
    return [nome, fontes]
  }))
}

describe('lerSupabaseDoBuild — a origem do Supabase, de VITE_SUPABASE_URL', () => {
  it('sem a variável, vazia ou só com espaços: sem origem (é o build do CI, que não vai para o ar)', () => {
    for (const ambiente of [{}, { VITE_SUPABASE_URL: '' }, { VITE_SUPABASE_URL: '  \n ' }, { VITE_SUPABASE_URL: true }]) {
      expect(lerSupabaseDoBuild(ambiente)).toEqual({ origem: null, https: false })
    }
  })

  it('só a origem: sem caminho, sem barra no fim, sem a porta padrão, em minúsculas', () => {
    expect(lerSupabaseDoBuild({ VITE_SUPABASE_URL: ' https://abcdefgh.supabase.co/ ' })).toEqual({
      origem: 'https://abcdefgh.supabase.co',
      https: true,
    })
    expect(lerSupabaseDoBuild({ VITE_SUPABASE_URL: 'HTTPS://Ponto.Example.COM:443/supabase/' }).origem).toBe(
      'https://ponto.example.com',
    )
  })

  it('o Supabase local, em http e com porta: a origem com a porta, e não é https', () => {
    expect(SUPABASE_LOCAL).toEqual({ origem: 'http://127.0.0.1:54321', https: false })
  })

  it('valor que não é endereço http(s) derruba o build — sem repetir o valor na mensagem', () => {
    // O último imita alguém que colou a chave no lugar do endereço (um valor de mentira).
    for (const valor of ['abcdefgh.supabase.co', 'localhost:54321', 'ftp://example.com', 'chave-de-mentira-nao-imprima']) {
      expect(() => lerSupabaseDoBuild({ VITE_SUPABASE_URL: valor }), valor).toThrow(/VITE_SUPABASE_URL/)
      try {
        lerSupabaseDoBuild({ VITE_SUPABASE_URL: valor })
      } catch (erro) {
        expect((erro as Error).message, valor).not.toContain(valor)
      }
    }
  })

  it('IPv6 não cabe na gramática de origem da CSP: o build diz', () => {
    expect(() => lerSupabaseDoBuild({ VITE_SUPABASE_URL: 'http://[::1]:54321' })).toThrow(/IPv6/)
  })
})

describe('os <style> em linha e o hash deles', () => {
  it('pega o texto exato de cada <style>, com ou sem atributo', () => {
    const html = '<head><style>a{}</style>\n<style media="print">\n  b { color: red }\n</style></head>'
    expect(estilosEmLinha(html)).toEqual(['a{}', '\n  b { color: red }\n'])
  })

  it('ignora o que está dentro de comentário (não é elemento)', () => {
    expect(estilosEmLinha('<!-- <style>x{}</style> --><style>y{}</style>')).toEqual(['y{}'])
  })

  it('fim de linha do Windows vira \\n, como o navegador lê o HTML', () => {
    expect(estilosEmLinha('<style>a{}\r\nb{}\r</style>')).toEqual(['a{}\nb{}\n'])
  })

  it('sha256 em base64, igual ao calculado fora daqui', async () => {
    expect(await hashDoEstilo('')).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')
    expect(await hashDoEstilo('html,body{background:#050506}')).toBe('sha256-S5ar3EiAlDyXl7G0ls2oBISTWXrluNEfwVjmBuTFGIE=')
    // O texto vai em UTF-8: acento conta byte a byte.
    expect(await hashDoEstilo('p{content:"ção"}')).toBe('sha256-cG2VT8mBKNBiiJgjkvd+4e6UKLy733hiSWsqlsjXsZY=')
    expect(await hashDoEstilo(estilosEmLinha('<style>a{}\r\nb{}</style>')[0])).toBe(
      'sha256-zed0RLOFY+TcmXcTg8xXzuEuz9LcL/bpBT9mk1CINVo=',
    )
  })

  it('os hashes de várias páginas: sem repetição e em ordem fixa', async () => {
    const pagina = '<style>html,body{background:#050506}</style>'
    expect(await hashesDosEstilos([pagina, `${pagina}<style></style>`])).toEqual([
      'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
      'sha256-S5ar3EiAlDyXl7G0ls2oBISTWXrluNEfwVjmBuTFGIE=',
    ])
  })

  it('o index.html e o 404.html têm um <style> cada (é o que a política libera pelo hash)', () => {
    expect(estilosEmLinha(textoDoIndex)).toHaveLength(1)
    expect(estilosEmLinha(textoDaPaginaDe404)).toHaveLength(1)
  })
})

describe('montarPolitica — o texto da política', () => {
  const HASHES = ['sha256-AAAA', 'sha256-BBBB']

  it('com o Supabase na nuvem: a política inteira, diretiva por diretiva', () => {
    expect(montarPolitica({ supabase: SUPABASE_NA_NUVEM, hashesDeEstilo: HASHES })).toBe(
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'sha256-AAAA' 'sha256-BBBB'",
        "font-src 'self'",
        "img-src 'self' blob: https://abcdefgh.supabase.co",
        "connect-src 'self' https://abcdefgh.supabase.co",
        "worker-src 'self'",
        "manifest-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        'upgrade-insecure-requests',
      ].join('; '),
    )
  })

  it('com o Supabase local (http): a origem com a porta, e SEM upgrade-insecure-requests', () => {
    const politica = diretivas(montarPolitica({ supabase: SUPABASE_LOCAL, hashesDeEstilo: HASHES }))
    expect(politica['connect-src']).toEqual(["'self'", 'http://127.0.0.1:54321'])
    expect(politica['img-src']).toEqual(["'self'", 'blob:', 'http://127.0.0.1:54321'])
    expect(politica).not.toHaveProperty('upgrade-insecure-requests')
  })

  it('sem Supabase: só o próprio endereço', () => {
    const politica = diretivas(montarPolitica({ supabase: SEM_SUPABASE, hashesDeEstilo: [] }))
    expect(politica['connect-src']).toEqual(["'self'"])
    expect(politica['img-src']).toEqual(["'self'", 'blob:'])
    expect(politica['style-src']).toEqual(["'self'"])
  })

  it('nada que desligue a proteção ou que o app não use', () => {
    const texto = montarPolitica({ supabase: SUPABASE_NA_NUVEM, hashesDeEstilo: HASHES })
    for (const proibido of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", 'data:', 'wss:', 'https:', '*', 'media-src', 'frame-ancestors']) {
      expect(texto.split(/[ ;]+/), proibido).not.toContain(proibido)
    }
  })

  it('o cabeçalho é a política da meta mais frame-ancestors, que numa meta não vale', () => {
    const politica = montarPolitica({ supabase: SUPABASE_NA_NUVEM, hashesDeEstilo: HASHES })
    expect(politicaDoCabecalho(politica)).toBe(`${politica}; frame-ancestors 'none'`)
    expect(FRAME_ANCESTORS).toBe("frame-ancestors 'none'")
  })
})

describe('aplicarPoliticaNoHtml — a meta no index.html e no 404.html do build', () => {
  const POLITICA = montarPolitica({ supabase: SUPABASE_NA_NUVEM, hashesDeEstilo: ['sha256-AAAA'] })
  const META = `<meta http-equiv="Content-Security-Policy" content="${POLITICA}" />`

  it('logo depois do charset, com o mesmo recuo', () => {
    const html = '<html>\n  <head>\n    <meta charset="UTF-8" />\n    <link rel="icon" href="/favicon.svg" />\n'
    expect(aplicarPoliticaNoHtml(html, POLITICA)).toBe(
      `<html>\n  <head>\n    <meta charset="UTF-8" />\n    ${META}\n    <link rel="icon" href="/favicon.svg" />\n`,
    )
  })

  it('no index.html de verdade: antes do ícone, do manifesto, do <style> e do script', () => {
    const aplicado = aplicarPoliticaNoHtml(textoDoIndex, POLITICA)
    const posicao = (trecho: string) => {
      const i = aplicado.indexOf(trecho)
      expect(i, trecho).toBeGreaterThan(-1)
      return i
    }
    const meta = posicao(META)
    expect(meta).toBeGreaterThan(posicao('<meta charset="UTF-8" />'))
    for (const depois of ['<link rel="icon"', '<link rel="manifest"', '<style>', '<script']) {
      expect(posicao(depois), depois).toBeGreaterThan(meta)
    }
  })

  it('no 404.html de verdade, também', () => {
    const aplicado = aplicarPoliticaNoHtml(textoDaPaginaDe404, POLITICA)
    expect(aplicado.indexOf(META)).toBeGreaterThan(-1)
    expect(aplicado.indexOf(META)).toBeLessThan(aplicado.indexOf('<style>'))
  })

  it('sem charset, logo depois do <head>; sem <head>, o build para', () => {
    expect(aplicarPoliticaNoHtml('<head>\n<title>x</title>', POLITICA)).toBe(`<head>\n  ${META}\n<title>x</title>`)
    expect(() => aplicarPoliticaNoHtml('<p>sem head</p>', POLITICA)).toThrow(/<head>/)
  })

  it('o texto vai escapado para o atributo, e uma segunda meta de CSP é recusada', () => {
    expect(aplicarPoliticaNoHtml('<head>', 'a "b" <c> & d')).toContain('content="a &quot;b&quot; &lt;c&gt; &amp; d"')
    expect(() => aplicarPoliticaNoHtml(aplicarPoliticaNoHtml(textoDoIndex, POLITICA), POLITICA)).toThrow(/já tem/)
  })
})

describe('problemasParaAPolitica — o que a política recusaria em silêncio derruba o build', () => {
  it('o index.html e o 404.html de verdade estão limpos', () => {
    expect(problemasParaAPolitica(textoDoIndex)).toEqual([])
    expect(problemasParaAPolitica(textoDaPaginaDe404)).toEqual([])
  })

  it('script em linha, manipulador on... e atributo style', () => {
    expect(problemasParaAPolitica('<script>alert(1)</script>')).toHaveLength(1)
    expect(problemasParaAPolitica('<script type="module">import "x"</script>')).toHaveLength(1)
    expect(problemasParaAPolitica('<img src="/a.png" onerror="x()">')).toHaveLength(1)
    expect(problemasParaAPolitica('<body onload="x()">')).toHaveLength(1)
    expect(problemasParaAPolitica('<div style="color: red">')).toHaveLength(1)
  })

  it('script com src, stylesheet, meta com "style" no nome e comentário não são problema', () => {
    expect(
      problemasParaAPolitica(
        [
          '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
          '<link rel="stylesheet" href="/assets/index-abc.css">',
          '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
          '<!-- <script>nada</script> <div style="x"> -->',
          '<style>a{}</style>',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('marcador de arquivo do Vite dentro do <style>: o hash não bateria com o texto publicado', () => {
    expect(problemasParaAPolitica('<style>a{background:url(__VITE_ASSET__abc__)}</style>')).toHaveLength(1)
  })
})

describe('o _headers do build', () => {
  const POLITICA = politicaDoCabecalho(montarPolitica({ supabase: SUPABASE_NA_NUVEM, hashesDeEstilo: ['sha256-AAAA'] }))

  it('o modelo de public/_headers tem a CSP só com frame-ancestors, no bloco /*', () => {
    expect(lerBlocosDoHeaders(textoDoHeaders).get('/*')?.get('Content-Security-Policy')).toBe(CSP_DO_MODELO)
  })

  it('só a linha da CSP do bloco /* muda; todas as outras ficam iguais', () => {
    const gerado = aplicarPoliticaNoHeaders(textoDoHeaders, POLITICA)
    const antes = textoDoHeaders.split('\n')
    const depois = gerado.split('\n')
    expect(depois).toHaveLength(antes.length)
    const mudadas = antes.map((linha, i) => [linha, depois[i]]).filter(([a, b]) => a !== b)
    expect(mudadas).toEqual([[`  Content-Security-Policy: ${CSP_DO_MODELO}`, `  Content-Security-Policy: ${POLITICA}`]])

    const blocos = lerBlocosDoHeaders(gerado)
    expect(blocos.get('/*')?.get('Content-Security-Policy')).toBe(POLITICA)
    expect([...blocos.keys()]).toEqual([...lerBlocosDoHeaders(textoDoHeaders).keys()])
  })

  it('sem a linha do modelo, com ela fora do bloco /*, ou com outra CSP escrita à mão: o build para', () => {
    expect(() => aplicarPoliticaNoHeaders('/*\n  X-Frame-Options: DENY\n', POLITICA)).toThrow(/precisa/)
    expect(() => aplicarPoliticaNoHeaders(`/sw.js\n  Content-Security-Policy: ${CSP_DO_MODELO}\n`, POLITICA)).toThrow(/bloco/)
    expect(() => aplicarPoliticaNoHeaders("/*\n  Content-Security-Policy: default-src 'self'\n", POLITICA)).toThrow(/gerado no build/)
    expect(() =>
      aplicarPoliticaNoHeaders(`/*\n  Content-Security-Policy: ${CSP_DO_MODELO}\n  Content-Security-Policy: ${CSP_DO_MODELO}\n`, POLITICA),
    ).toThrow(/precisa/)
  })

  it('lerBlocosDoHeaders recusa linha de cabeçalho fora de bloco', () => {
    expect(() => lerBlocosDoHeaders('  X-Frame-Options: DENY\n')).toThrow(/fora de bloco/)
  })
})
