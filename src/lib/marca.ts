/*
 * A MARCA DO APP: O NOME, O SLOGAN E O MANIFESTO, LIDOS DO BUILD.
 *
 * O app serve a qualquer empresa, então o nome não mora no código. Ele vem de
 * duas variáveis de ambiente, lidas na hora do build (e no `npm run dev`):
 *
 *   VITE_NOME_DO_APP    o nome na tela de entrar, no topo das telas, no título
 *                       da aba, no ícone instalado e no manifesto.
 *                       Padrão: "Ponto".
 *   VITE_SLOGAN_DO_APP  uma linha embaixo do nome, na tela de entrar, e no pé
 *                       da tela de bater. Padrão: nenhuma (as duas somem).
 *
 * Espaços nas pontas saem, e quebra de linha ou espaço repetido no meio vira um
 * espaço só: o nome vai para o título da aba e para o ícone, que têm uma linha.
 * Variável vazia (ou só com espaços) é o mesmo que não definida — vale o padrão.
 *
 * POR QUE AS REGRAS MORAM AQUI, PURAS
 * Três lugares leem a marca, em três momentos: o `vite.config.ts` (o título do
 * `index.html` e o `manifest.webmanifest`), as telas (por `marcaDoApp()`, em
 * `marca-do-app.ts`) e os testes. Se cada um aplicasse o padrão por conta
 * própria, bastaria uma variável em branco para a aba dizer "Ponto" e a tela de
 * entrar não dizer nada. Este arquivo não lê ambiente, não toca no DOM e não usa
 * nada do Node: recebe os valores e devolve o resultado, e por isso roda igual
 * no build, no navegador e no teste.
 *
 * O QUE NÃO MUDA COM A MARCA
 * A cara do app: o fundo escuro e o verde de destaque (`--color-luz`, em
 * `index.css`). Os ícones de `public/` são desenhos neutros; quem quiser a
 * própria marca troca os arquivos de lá, mantendo os nomes e os tamanhos que o
 * manifesto abaixo declara.
 */

export const VARIAVEL_DO_NOME = 'VITE_NOME_DO_APP'
export const VARIAVEL_DO_SLOGAN = 'VITE_SLOGAN_DO_APP'

/** O nome quando a variável não vem, ou vem em branco. */
export const NOME_PADRAO = 'Ponto'

/** O que o app é, numa frase: vai no `<meta name="description">` e no manifesto. */
export const DESCRICAO_DO_APP = 'Registro de ponto pelo celular, com selfie, PIN e localização.'

/**
 * O fundo do app (`--color-ink-0` de `index.css`). É também a cor da barra do
 * sistema e da tela de abertura do app instalado: se fosse outra, a abertura
 * piscaria uma cor diferente antes da primeira tela.
 */
export const COR_DO_FUNDO = '#050506'

/** Onde o manifesto é servido. O `index.html` e o `public/sw.js` apontam para cá. */
export const CAMINHO_DO_MANIFESTO = '/manifest.webmanifest'

/** Os marcadores do `index.html` que o build troca pelo valor. */
export const MARCADOR_DO_NOME = '%NOME_DO_APP%'
export const MARCADOR_DA_DESCRICAO = '%DESCRICAO_DO_APP%'

export interface MarcaDoApp {
  nome: string
  /** Vazio quando não há slogan: a tela não desenha a linha. */
  slogan: string
}

/** Texto de uma linha: sem espaço nas pontas e sem quebra nem espaço repetido no meio. */
function umaLinha(valor: unknown): string {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : ''
}

/**
 * A marca a partir das variáveis do ambiente, com os padrões aplicados.
 *
 * Recebe o objeto inteiro (o `config.env` do Vite, ou só as duas chaves que o
 * app lê de `import.meta.env`): o que não for texto conta como ausente.
 */
export function lerMarca(ambiente: Readonly<Record<string, unknown>>): MarcaDoApp {
  const nome = umaLinha(ambiente[VARIAVEL_DO_NOME])
  return {
    nome: nome === '' ? NOME_PADRAO : nome,
    slogan: umaLinha(ambiente[VARIAVEL_DO_SLOGAN]),
  }
}

export interface IconeDoManifesto {
  src: string
  sizes: string
  type: 'image/png'
  purpose: 'any' | 'maskable'
}

export interface ManifestoDoApp {
  name: string
  short_name: string
  description: string
  lang: string
  dir: 'ltr'
  id: string
  start_url: string
  scope: string
  display: 'standalone'
  orientation: 'portrait'
  background_color: string
  theme_color: string
  categories: string[]
  icons: IconeDoManifesto[]
}

/**
 * Os ícones do app instalado. Ficam em `public/`, com estes nomes e tamanhos.
 *
 * O "maskable" é um arquivo à parte, e não o mesmo de 512: o Android recorta o
 * ícone maskable no formato do aparelho (círculo, gota, quadrado arredondado),
 * e só o miolo, um círculo de 80% do lado, é garantido. O desenho dele é menor,
 * para caber inteiro nesse miolo; o de 512 comum ocupa mais a tela de início.
 */
export const ICONES_DO_MANIFESTO: readonly IconeDoManifesto[] = [
  { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

/**
 * O manifesto do app instalado (o que o Chrome lê para oferecer "instalar").
 *
 * `id`, `start_url` e `scope` são "/": o app mora na raiz do endereço em que for
 * publicado, qualquer que seja ele. `short_name` repete o nome, porque é o que
 * aparece embaixo do ícone; nome longo é cortado pelo próprio celular.
 */
export function montarManifesto(marca: MarcaDoApp): ManifestoDoApp {
  return {
    name: marca.nome,
    short_name: marca.nome,
    description: DESCRICAO_DO_APP,
    lang: 'pt-BR',
    dir: 'ltr',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: COR_DO_FUNDO,
    theme_color: COR_DO_FUNDO,
    categories: ['business', 'productivity'],
    icons: ICONES_DO_MANIFESTO.map((icone) => ({ ...icone })),
  }
}

/** O arquivo `manifest.webmanifest`, pronto para gravar ou servir. */
export function textoDoManifesto(marca: MarcaDoApp): string {
  return `${JSON.stringify(montarManifesto(marca), null, 2)}\n`
}

/** Escapa o texto para entrar no HTML, seja no conteúdo de uma tag ou num atributo entre aspas. */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Troca os marcadores do `index.html` pelos valores da marca, já escapados.
 *
 * Uma passada só, com função de troca: com texto no lugar da função, um `$&` ou
 * `$'` no nome seria lido como padrão de substituição e viraria outro texto; e,
 * numa passada por marcador, um nome que contivesse o outro marcador seria
 * trocado de novo.
 */
export function aplicarMarcaNoHtml(html: string, marca: MarcaDoApp): string {
  const valores: Record<string, string> = {
    [MARCADOR_DO_NOME]: escaparHtml(marca.nome),
    [MARCADOR_DA_DESCRICAO]: escaparHtml(DESCRICAO_DO_APP),
  }
  // Os marcadores só têm letras, `_` e `%`: nenhum caractere especial de regex.
  const qualquerMarcador = new RegExp(Object.keys(valores).join('|'), 'g')
  return html.replace(qualquerMarcador, (marcador) => valores[marcador])
}
