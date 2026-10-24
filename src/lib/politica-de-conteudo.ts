/*
 * A POLÍTICA DE CONTEÚDO DO APP (CSP), MONTADA NO BUILD.
 *
 * O QUE ELA SEGURA
 * A sessão do Supabase mora no localStorage do aparelho (ver `supabase.ts`):
 * um script que conseguisse rodar dentro do app leria o token e falaria com o
 * banco como a pessoa. Hoje não se conhece brecha para isso — o React escapa o
 * que desenha e nenhuma tela monta HTML cru —, e a política é o que deixa um
 * defeito futuro (uma dependência adulterada, um HTML cru esquecido) sem
 * efeito: o navegador só executa o JavaScript do build, só aplica o CSS do
 * build e só conversa com o próprio endereço e com o Supabase configurado.
 *
 * POR QUE NO BUILD
 * Duas peças mudam de instalação para instalação, ou de build para build: a
 * origem do Supabase (VITE_SUPABASE_URL) e o hash dos `<style>` em linha do
 * `index.html` e do `404.html` (o do `index.html` o Vite ainda minifica no
 * build). Uma política escrita à mão erraria uma das duas na primeira mudança,
 * e o erro só apareceria no ar, com o app sem estilo ou sem falar com o banco.
 * Trocar o Supabase exige um build novo, com a variável nova.
 *
 * ONDE ELA É APLICADA (quem liga isto ao build é o `vite.config.ts`)
 *   - numa `<meta http-equiv="Content-Security-Policy">`, a primeira coisa do
 *     `<head>` do `index.html` e do `404.html` do build. Vale em qualquer
 *     hospedagem, até na que não manda cabeçalho nenhum;
 *   - no cabeçalho `Content-Security-Policy` do `dist/_headers` (Cloudflare
 *     Pages e Netlify): o mesmo texto, mais `frame-ancestors 'none'`, que numa
 *     meta não vale. A meta e o cabeçalho se somam (o navegador aplica os
 *     dois), e por isso são o mesmo texto;
 *   - na Vercel e no Caddy, o cabeçalho estático (`vercel.json` e
 *     `exemplos/servidor/Caddyfile`) leva só o `frame-ancestors 'none'`, e o
 *     resto chega pela meta. Quem quiser a política inteira também no
 *     cabeçalho copia a linha do `dist/_headers` (ver os comentários de
 *     `public/_headers` e do Caddyfile) e a refaz a cada troca do Supabase.
 *
 * CADA DIRETIVA, E POR QUÊ (ver `montarPolitica`)
 *   default-src 'none'   o que não está liberado abaixo é proibido.
 *   script-src 'self'    só os arquivos do build. Nada em linha, nada de eval.
 *   style-src 'self' + hashes
 *                        o CSS do build e os `<style>` do index.html e do
 *                        404.html, pelo hash exato do texto. O `style={...}`
 *                        do React passa pelo CSSOM, que a política não barra.
 *   font-src 'self'      as fontes do próprio app (`index.css`).
 *   img-src 'self' blob: <supabase>
 *                        os ícones; `blob:` é a prévia da selfie, a miniatura
 *                        do comprovante e a foto do atestado que o navegador
 *                        abre para reduzir; o Supabase serve a selfie e o
 *                        atestado pela URL assinada.
 *   connect-src 'self' <supabase>
 *                        login, dados, arquivos e a função de contas; `'self'`
 *                        é o service worker buscando a casca do app.
 *   worker-src 'self'    o service worker (`/sw.js`).
 *   manifest-src 'self'  o manifesto gerado no build.
 *   frame-src 'none', object-src 'none'
 *                        o app não embute nada. O PDF do atestado abre numa
 *                        aba nova, e navegação não passa por aqui.
 *   base-uri 'none'      ninguém troca a base dos endereços relativos com uma
 *                        `<base>` injetada.
 *   form-action 'none'   todo formulário do app é tratado pelo React
 *                        (`preventDefault`); nenhum é enviado pelo navegador.
 *   upgrade-insecure-requests
 *                        só com o Supabase em https. Com um Supabase em http,
 *                        a diretiva trocaria os pedidos dele para https e o
 *                        app deixaria de falar com o banco. (O Chrome poupa o
 *                        127.0.0.1 do Supabase local; um http em outro
 *                        endereço, não.)
 *   frame-ancestors 'none' (só no cabeçalho)
 *                        ninguém põe o app dentro de um iframe.
 *
 * O QUE FICA DE FORA, DE PROPÓSITO
 *   - `media-src`: a câmera chega ao `<video>` por `srcObject`, que não é
 *     endereço e não passa pela política; o app não toca mídia por URL;
 *   - `data:`: nada do app usa, e o build não embute arquivo como `data:` (ver
 *     `assetsInlineLimit` no `vite.config.ts`);
 *   - `ws:`/`wss:`: o app não usa o Realtime do Supabase;
 *   - `'unsafe-inline'` e `'unsafe-eval'`, que desligariam a proteção.
 *
 * ESTE ARQUIVO É PURO: não lê ambiente nem arquivo, não toca no DOM e não usa
 * nada só do Node. O hash usa o Web Crypto, que existe igual no Node do build,
 * no navegador e no teste.
 */

export const VARIAVEL_DO_SUPABASE = 'VITE_SUPABASE_URL'

/** O cabeçalho a mais, que só vale na resposta HTTP (numa meta o navegador o ignora). */
export const FRAME_ANCESTORS = "frame-ancestors 'none'"

/** O valor de `Content-Security-Policy` em `public/_headers`, antes do build. */
export const CSP_DO_MODELO = FRAME_ANCESTORS

export interface SupabaseDoBuild {
  /** `https://<ref>.supabase.co`, sem caminho nem barra no fim; `null` sem a variável. */
  origem: string | null
  /** O Supabase é https: só então entra `upgrade-insecure-requests`. */
  https: boolean
}

/**
 * A origem do Supabase a partir das variáveis do build.
 *
 * Variável vazia, ou só com espaços, conta como ausente: o build sai sem
 * origem do Supabase (é o build do CI, que não vai para o ar; o app nem abre
 * sem a variável). Com valor, ele TEM de ser um endereço http(s): um valor
 * torto gravaria uma política torta, e o erro aparece aqui, no build, e não no
 * ar. A mensagem não repete o valor: se alguém colou a chave no lugar do
 * endereço, ela não vai parar no log do build.
 */
export function lerSupabaseDoBuild(ambiente: Readonly<Record<string, unknown>>): SupabaseDoBuild {
  const bruto = ambiente[VARIAVEL_DO_SUPABASE]
  const valor = typeof bruto === 'string' ? bruto.trim() : ''
  if (valor === '') return { origem: null, https: false }

  let endereco: URL
  try {
    endereco = new URL(valor)
  } catch {
    throw new Error(`${VARIAVEL_DO_SUPABASE} não é um endereço (exemplo: https://seu-projeto.supabase.co).`)
  }
  if (endereco.protocol !== 'https:' && endereco.protocol !== 'http:') {
    throw new Error(`${VARIAVEL_DO_SUPABASE} tem de começar com https:// (exemplo: https://seu-projeto.supabase.co).`)
  }
  // A gramática de origem da CSP só aceita nome e IPv4: um IPv6 entre
  // colchetes não tem como ser escrito na política.
  if (endereco.hostname.startsWith('[')) {
    throw new Error(`${VARIAVEL_DO_SUPABASE} com IPv6 não cabe na política de conteúdo: use um nome (ou 127.0.0.1).`)
  }
  return { origem: endereco.origin, https: endereco.protocol === 'https:' }
}

/** O HTML sem os comentários: um `<style>` ou um script dentro de comentário não é elemento. */
function semComentarios(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * O texto de cada `<style>` em linha do HTML, como o navegador o lê.
 *
 * O hash da CSP é do texto EXATO entre as tags: um espaço a mais e ele não
 * bate. O navegador troca `\r\n` (e `\r` sozinho) por `\n` antes de ler o HTML;
 * a troca é feita aqui também, para um arquivo salvo com fim de linha do
 * Windows dar o mesmo hash.
 */
export function estilosEmLinha(html: string): string[] {
  return [...semComentarios(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((achado) =>
    achado[1].replace(/\r\n?/g, '\n'),
  )
}

/** `sha256-<base64>`: a fonte da CSP que libera exatamente este texto de `<style>`. */
export async function hashDoEstilo(texto: string): Promise<string> {
  const resumo = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
  let binario = ''
  for (const byte of resumo) binario += String.fromCharCode(byte)
  return `sha256-${btoa(binario)}`
}

/** Os hashes de todos os `<style>` em linha dos HTMLs, sem repetição e em ordem fixa. */
export async function hashesDosEstilos(htmls: readonly string[]): Promise<string[]> {
  const textos = htmls.flatMap(estilosEmLinha)
  const hashes = await Promise.all(textos.map(hashDoEstilo))
  return [...new Set(hashes)].sort()
}

export interface EntradaDaPolitica {
  supabase: SupabaseDoBuild
  /** De `hashesDosEstilos`: `sha256-...`, sem as aspas. */
  hashesDeEstilo: readonly string[]
}

/**
 * A política da meta: as diretivas na ordem do cabeçalho deste arquivo,
 * separadas por `; `. Sem `frame-ancestors` (ver `politicaDoCabecalho`).
 */
export function montarPolitica({ supabase, hashesDeEstilo }: EntradaDaPolitica): string {
  const doSupabase = supabase.origem ? [supabase.origem] : []
  const diretivas: string[][] = [
    ['default-src', "'none'"],
    ['script-src', "'self'"],
    ['style-src', "'self'", ...hashesDeEstilo.map((hash) => `'${hash}'`)],
    ['font-src', "'self'"],
    ['img-src', "'self'", 'blob:', ...doSupabase],
    ['connect-src', "'self'", ...doSupabase],
    ['worker-src', "'self'"],
    ['manifest-src', "'self'"],
    ['frame-src', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'none'"],
  ]
  if (supabase.https) diretivas.push(['upgrade-insecure-requests'])
  return diretivas.map((partes) => partes.join(' ')).join('; ')
}

/** A política do cabeçalho HTTP: a da meta mais `frame-ancestors 'none'`. */
export function politicaDoCabecalho(politica: string): string {
  return `${politica}; ${FRAME_ANCESTORS}`
}

/** Escapa o texto para um atributo entre aspas duplas. */
function paraAtributo(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Põe a meta da política logo depois do `<meta charset>` (ou, sem ele, logo
 * depois do `<head>`).
 *
 * A POSIÇÃO IMPORTA: a meta só vale para o que vem DEPOIS dela no HTML. Antes
 * do primeiro `<link>` e do primeiro `<style>`, ela cobre o ícone, o manifesto,
 * o estilo em linha e o JavaScript do build.
 */
export function aplicarPoliticaNoHtml(html: string, politica: string): string {
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy/i.test(html)) {
    throw new Error('O HTML já tem uma meta de Content-Security-Policy: a política é gerada no build, só uma.')
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${paraAtributo(politica)}" />`
  const ancora = /<meta\s+charset\s*=[^>]*>/i.exec(html) ?? /<head\b[^>]*>/i.exec(html)
  if (!ancora) throw new Error('O HTML não tem <head>: não há onde pôr a política de conteúdo.')
  const fim = ancora.index + ancora[0].length
  // Mesma indentação da linha da âncora, para o HTML do build continuar legível.
  const inicioDaLinha = html.lastIndexOf('\n', ancora.index) + 1
  const recuo = /^[ \t]*/.exec(html.slice(inicioDaLinha, ancora.index))?.[0] ?? ''
  const recuoDaMeta = /<head\b/i.test(ancora[0]) ? `${recuo}  ` : recuo
  return `${html.slice(0, fim)}\n${recuoDaMeta}${meta}${html.slice(fim)}`
}

/**
 * O que, no HTML, a política recusaria em silêncio — e por isso derruba o
 * build, em vez de sair um app que abre sem estilo ou sem o script:
 *   - script em linha (sem `src`): `script-src 'self'` não libera;
 *   - atributo `on...=` (manipulador em linha): idem;
 *   - atributo `style=`: o hash libera `<style>`, não atributo;
 *   - marcador de arquivo do Vite dentro de um `<style>`: o Vite o troca
 *     DEPOIS de o hash ser calculado, e o hash deixaria de bater com o texto
 *     publicado.
 */
export function problemasParaAPolitica(html: string): string[] {
  const limpo = semComentarios(html)
  const problemas: string[] = []
  for (const [tag, atributos] of limpo.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\ssrc\s*=/i.test(` ${atributos}`)) problemas.push(`script em linha: ${tag}`)
  }
  for (const [trecho] of limpo.matchAll(/<[a-z][^>]*?\son[a-z]+\s*=/gi)) {
    problemas.push(`manipulador em linha: ${trecho}`)
  }
  for (const [trecho] of limpo.matchAll(/<[a-z][^>]*?\sstyle\s*=/gi)) {
    problemas.push(`atributo style: ${trecho}`)
  }
  if (estilosEmLinha(limpo).some((texto) => /__VITE_(?:PUBLIC_)?ASSET__/.test(texto))) {
    problemas.push('marcador de arquivo do Vite num <style> em linha (o hash não bateria com o texto publicado)')
  }
  return problemas
}

/* ------------------------------------------------------------------ */
/* O `_headers` do Cloudflare Pages e do Netlify                       */
/* ------------------------------------------------------------------ */

/**
 * Os blocos de um `_headers`: caminho -> (cabeçalho -> valor).
 *
 * O formato: uma linha sem recuo abre o bloco do caminho; as linhas com recuo
 * logo abaixo são `Nome: valor`. Comentário só em linha que começa com `#`.
 */
export function lerBlocosDoHeaders(texto: string): Map<string, Map<string, string>> {
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
    if (!atual || doisPontos < 0) throw new Error(`Linha de _headers fora de bloco ou sem "Nome: valor": ${linha.trim()}`)
    atual.set(linha.slice(0, doisPontos).trim(), linha.slice(doisPontos + 1).trim())
  }
  return blocos
}

/**
 * O `_headers` do build: o de `public/`, com a política inteira no lugar do
 * `frame-ancestors 'none'` do bloco `/*`. Nada mais muda, nem comentário.
 *
 * O modelo tem de trazer a linha EXATA de `CSP_DO_MODELO`, uma vez, no bloco
 * `/*`: uma CSP escrita à mão em `public/_headers` seria apagada em silêncio
 * pela gerada, e é melhor o build dizer.
 */
export function aplicarPoliticaNoHeaders(texto: string, politicaCompleta: string): string {
  let bloco: string | null = null
  let trocas = 0
  const linhas = texto.split('\n').map((linha) => {
    if (linha.trim() === '' || linha.startsWith('#')) return linha
    if (!/^\s/.test(linha)) {
      bloco = linha.trim()
      return linha
    }
    const achado = /^(\s+)Content-Security-Policy:\s*(.*?)\s*$/i.exec(linha)
    if (!achado) return linha
    if (bloco !== '/*' || achado[2] !== CSP_DO_MODELO) {
      throw new Error(
        `public/_headers: a única Content-Security-Policy é a do bloco /*, com "${CSP_DO_MODELO}" — o resto da política é gerado no build.`,
      )
    }
    trocas++
    return `${achado[1]}Content-Security-Policy: ${politicaCompleta}`
  })
  if (trocas !== 1) {
    throw new Error(`public/_headers precisa de uma linha "Content-Security-Policy: ${CSP_DO_MODELO}" no bloco /*.`)
  }
  return linhas.join('\n')
}
