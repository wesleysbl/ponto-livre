import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type ConsoleMessage, type Locator, type Page } from '@playwright/test'
import { criarContaComoNoPainel, emailDaExecucao, supabaseLocal, tornarSuperAdmin } from './apoio.ts'

/*
 * O APP INTEIRO SOB A POLÍTICA DE CONTEÚDO (CSP), SEM NENHUMA RECUSA.
 *
 * Roda no BUILD de produção (o projeto `csp` do `playwright.config.ts`:
 * `vite build` + `vite preview`), que é onde a política existe: a meta no
 * `index.html` e, como no Cloudflare Pages e no Netlify, os cabeçalhos do
 * `dist/_headers` em toda resposta — o service worker incluído, que obedece ao
 * cabeçalho da própria resposta e não à meta da página.
 *
 * O CAMINHO PASSA POR TUDO QUE A POLÍTICA PODERIA BARRAR:
 *   - entrar e criar o PIN: o login e as funções do banco (connect-src);
 *   - a administração cria a conta e a ficha de quem bate: a função de contas;
 *   - a pessoa bate com a câmera e o GPS simulados: o vídeo ao vivo
 *     (`srcObject`), a prévia da selfie e a miniatura do comprovante
 *     (`blob:`), a foto subindo para o storage;
 *   - o espelho e o painel abrem a selfie pela URL assinada do storage
 *     (img-src);
 *   - o CSV baixado (`blob:`), a folha para imprimir e a administração;
 *   - as fontes do próprio app, o manifesto e o service worker guardando a
 *     casca do app.
 *
 * O QUE REPROVA: um `securitypolicyviolation` no documento; uma mensagem de
 * console com "Content Security Policy" ou "Refused to", da página ou do
 * service worker; um pedido barrado pela política; erro de página; erro ou
 * aviso de console; e um pedido para qualquer endereço que não seja o app ou
 * o Supabase local (as fontes, por exemplo, não podem vir do Google). O
 * primeiro teste prova que o vigia pega uma recusa de verdade.
 *
 * As contas são do elenco fictício, com o carimbo da execução nos e-mails,
 * como no cadastro. O teste não mexe na configuração da empresa nem no local.
 *
 * EM SÉRIE: a pessoa que bate é criada pela administração no teste anterior.
 */

test.describe.configure({ mode: 'serial' })

const local = supabaseLocal()

/** Senha que nunca aparece: vive só na memória do teste. */
const senhaAleatoria = () => `Ponto-${randomBytes(9).toString('base64url')}`

const sergio = { email: emailDaExecucao('sergio.csp'), senha: senhaAleatoria(), pin: '4826' }
// A senha da Ana é a provisória que a tela do super admin mostra.
const ana = { nome: 'Ana Beatriz Rocha', email: emailDaExecucao('ana.csp'), senha: '', pin: '2580' }
/** Uns 10 metros do local do elenco (centro de São Paulo). */
const ONDE_A_ANA_BATE = { latitude: -23.550601, longitude: -46.633251, accuracy: 8 }
/** O horário da batida da Ana, como o comprovante mostra. */
let horaDaBatida = ''

/* ------------------------------------------------------------------ */
/* O vigia da política                                                 */
/* ------------------------------------------------------------------ */

interface Vigia {
  /** O que a política recusou, de qualquer fonte. Tem de terminar vazio. */
  recusas: string[]
  /** Erro de página, e erro ou aviso de console que não é da política. Também. */
  erros: string[]
  /** Todo endereço que o navegador pediu: nada pode sair para terceiros. */
  enderecos: string[]
}

function ehRecusaDaPolitica(texto: string): boolean {
  return /content security policy|refused to/i.test(texto)
}

/**
 * Liga o vigia ao contexto, ANTES da primeira navegação: o ouvinte de
 * `securitypolicyviolation` entra em todo documento antes de qualquer script
 * da página, e o console é ouvido no contexto inteiro e em cada service worker.
 *
 * O mesmo script troca `window.print` por um contador: a caixa de impressão
 * do navegador não abre no teste, e o teste confere que o app a pediu.
 */
async function vigiar(contexto: BrowserContext): Promise<Vigia> {
  const vigia: Vigia = { recusas: [], erros: [], enderecos: [] }
  await contexto.exposeBinding('__avisarRecusaDaPolitica', (_fonte, texto: string) => {
    vigia.recusas.push(texto)
  })
  await contexto.addInitScript(() => {
    const janela = window as unknown as { __avisarRecusaDaPolitica: (texto: string) => void; __impressoes: number }
    document.addEventListener(
      'securitypolicyviolation',
      (evento) =>
        janela.__avisarRecusaDaPolitica(
          `${evento.effectiveDirective}: ${evento.blockedURI || 'em linha'} (em ${evento.sourceFile || evento.documentURI})`,
        ),
      true,
    )
    janela.__impressoes = 0
    window.print = () => {
      janela.__impressoes++
    }
  })

  const ouvir = (origem: string) => (mensagem: ConsoleMessage) => {
    const texto = `${origem}: ${mensagem.text()}`
    if (ehRecusaDaPolitica(texto)) vigia.recusas.push(texto)
    else if (mensagem.type() === 'error' || mensagem.type() === 'warning') vigia.erros.push(texto)
  }
  contexto.on('console', ouvir('console'))
  contexto.on('serviceworker', (worker) => worker.on('console', ouvir('service worker')))
  contexto.on('weberror', (erro) => vigia.erros.push(`erro de página: ${erro.error().message}`))
  contexto.on('requestfailed', (pedido) => {
    const falha = pedido.failure()?.errorText ?? ''
    if (/csp/i.test(falha)) vigia.recusas.push(`pedido barrado (${falha}): ${pedido.url()}`)
  })
  contexto.on('request', (pedido) => vigia.enderecos.push(pedido.url()))
  return vigia
}

/**
 * O vigia do teste em curso. Se um passo falhar antes da conferência do fim
 * (uma imagem que não carregou, por exemplo), o que ele viu sai junto com a
 * falha: quase sempre é ali que está a causa.
 */
let vigiaDoTeste: Vigia | null = null

test.afterEach(async () => {
  const info = test.info()
  const vigia = vigiaDoTeste
  vigiaDoTeste = null
  if (!vigia || info.status === info.expectedStatus) return
  console.error(`O vigia da política viu, até a falha:\n${JSON.stringify({ recusas: vigia.recusas, erros: vigia.erros }, null, 2)}`)
  await info.attach('vigia-da-politica.json', { body: JSON.stringify(vigia, null, 2), contentType: 'application/json' })
})

/** Nada recusado, nada quebrado, e nenhum pedido para fora do app e do Supabase local. */
function conferirVigia(vigia: Vigia, origemDoApp: string, quando: string): void {
  expect(vigia.recusas, `recusas da política ${quando}`).toEqual([])
  expect(vigia.erros, `erros ${quando}`).toEqual([])
  const deFora = vigia.enderecos.filter(
    (endereco) =>
      !endereco.startsWith(`${origemDoApp}/`) && !endereco.startsWith(`${local.urlDaApi}/`) && !endereco.startsWith('blob:'),
  )
  expect(deFora, `pedidos para fora do app e do Supabase ${quando}`).toEqual([])
}

/* ------------------------------------------------------------------ */
/* Peças da tela (as mesmas do cadastro)                               */
/* ------------------------------------------------------------------ */

async function entrar(pagina: Page, email: string, senha: string): Promise<void> {
  await pagina.goto('/entrar')
  await expect(pagina.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await pagina.getByLabel('E-mail', { exact: true }).fill(email)
  await pagina.getByLabel('Senha', { exact: true }).fill(senha)
  await pagina.getByRole('button', { name: 'Entrar', exact: true }).click()
}

async function digitarPin(pagina: Page, pin: string): Promise<void> {
  for (const digito of pin) await pagina.getByRole('button', { name: digito, exact: true }).click()
}

async function criarPin(pagina: Page, pin: string): Promise<void> {
  await expect(pagina).toHaveURL(/\/definir-pin$/)
  await expect(pagina.getByRole('heading', { name: 'Crie seu PIN' })).toBeVisible()
  await digitarPin(pagina, pin)
  await expect(pagina.getByRole('heading', { name: 'Repita o PIN' })).toBeVisible()
  await digitarPin(pagina, pin)
}

/** A imagem carregou de verdade (a política não a barrou) e veio de onde devia. */
async function conferirImagem(imagem: Locator, origem: RegExp): Promise<void> {
  await expect(imagem).toBeVisible()
  await expect.poll(() => imagem.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  expect(await imagem.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(origem)
}

/** O começo da URL assinada de um arquivo do storage do Supabase local. */
const URL_ASSINADA = new RegExp(`^${local.urlDaApi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/storage/v1/object/sign/`)

/* ------------------------------------------------------------------ */
/* O super admin, como quem instala (o mesmo caminho do cadastro)      */
/* ------------------------------------------------------------------ */

test.beforeAll(async () => {
  await criarContaComoNoPainel(sergio.email, sergio.senha)
  expect(tornarSuperAdmin(sergio.email)).toContain(sergio.email)
})

/* ------------------------------------------------------------------ */
/* 0. A política chega, e o vigia funciona                             */
/* ------------------------------------------------------------------ */

test('a política chega na meta e no cabeçalho, igual, e o vigia pega uma recusa de verdade', async ({ browser, baseURL }) => {
  const contexto = await browser.newContext({ baseURL })
  try {
    const vigia = await vigiar(contexto)
    const pagina = await contexto.newPage()
    const resposta = await pagina.goto('/entrar')
    expect(resposta?.ok(), 'a tela de entrar abre').toBe(true)

    await test.step('a meta é a primeira coisa do <head> que carrega algo, com o Supabase local', async () => {
      const html = await resposta!.text()
      const achado = /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/.exec(html)
      expect(achado, 'meta da política no index.html servido').not.toBeNull()
      for (const depois of ['<link', '<style', '<script']) {
        expect(html.indexOf(depois), depois).toBeGreaterThan(achado!.index)
      }
      const politica = achado![1]
      expect(politica).toContain(`connect-src 'self' ${local.urlDaApi};`)
      expect(politica).toContain(`img-src 'self' blob: ${local.urlDaApi};`)
      expect(politica).toMatch(/style-src 'self'( 'sha256-[A-Za-z0-9+/]+=*'){2};/)
      // O Supabase local é http: sem upgrade-insecure-requests. E nada que desligue a proteção.
      expect(politica).not.toMatch(/unsafe-|upgrade-insecure-requests|frame-ancestors|data:/)
      await expect(pagina.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', politica)

      // O cabeçalho do dist/_headers: a mesma política, mais o frame-ancestors.
      const cabecalhos = resposta!.headers()
      expect(cabecalhos['content-security-policy']).toBe(`${politica}; frame-ancestors 'none'`)
      expect(cabecalhos['x-frame-options']).toBe('DENY')
      expect(cabecalhos['permissions-policy']).toBe('camera=(self), geolocation=(self), microphone=()')

      // O 404.html do build leva a mesma meta.
      const pagina404 = await pagina.request.get('/404.html')
      expect(await pagina404.text()).toContain(`<meta http-equiv="Content-Security-Policy" content="${politica}" />`)

      // Nenhum arquivo embutido como `data:` no CSS: a política não libera, e
      // a recusa só apareceria na tela que precisasse daquela fonte (um nome
      // em cirílico na fonte mono, por exemplo).
      const folhaDeEstilo = /<link rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1]
      expect(folhaDeEstilo, 'o CSS do build no index.html').toBeTruthy()
      const css = await (await pagina.request.get(folhaDeEstilo!)).text()
      expect(css).toContain('@font-face')
      expect(css).not.toMatch(/url\(\s*["']?data:/)
    })

    await test.step('um script em linha posto na página não roda, e o vigia vê a recusa nas duas pontas', async () => {
      const rodou = await pagina.evaluate(async () => {
        const script = document.createElement('script')
        script.textContent = 'window.__scriptEmLinhaRodou = true'
        document.head.append(script)
        await new Promise((pronto) => setTimeout(pronto, 200))
        return (window as unknown as { __scriptEmLinhaRodou?: boolean }).__scriptEmLinhaRodou === true
      })
      expect(rodou, 'o script em linha rodou: a política não está valendo').toBe(false)
      await expect.poll(() => vigia.recusas.some((recusa) => recusa.startsWith('script-src'))).toBe(true)
      await expect.poll(() => vigia.recusas.some((recusa) => recusa.startsWith('console:'))).toBe(true)
    })
  } finally {
    await contexto.close()
  }
})

/* ------------------------------------------------------------------ */
/* 1. A administração, no computador                                   */
/* ------------------------------------------------------------------ */

test.describe('a administração, no computador', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('o super admin entra, cria o PIN e cadastra quem bate, sem nenhuma recusa', async ({ page, context, baseURL }) => {
    const vigia = (vigiaDoTeste = await vigiar(context))

    await test.step('entra e cria o PIN', async () => {
      await entrar(page, sergio.email, sergio.senha)
      await criarPin(page, sergio.pin)
      await expect(page.getByText('Administração do ponto', { exact: true })).toBeVisible()
    })

    await test.step('abre a administração e cria a conta da Ana, com a ficha junto', async () => {
      await page.getByRole('button', { name: 'Administração', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Administração do ponto' })).toBeVisible()
      await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
      const caixa = page.getByRole('dialog', { name: 'Criar conta' })
      await caixa.getByLabel('Nome da pessoa', { exact: true }).fill(ana.nome)
      await caixa.getByLabel('E-mail para entrar', { exact: true }).fill(ana.email)
      await caixa.getByLabel('Ficha do ponto', { exact: true }).selectOption({ label: 'Criar uma ficha nova com este nome' })
      ana.senha = await caixa.getByLabel('Senha provisória', { exact: true }).inputValue()
      expect(ana.senha.length).toBeGreaterThanOrEqual(8)
      await caixa.getByRole('button', { name: 'Criar a conta' }).click()
      await expect(caixa).toBeHidden()
      await expect(page.getByRole('status').filter({ hasText: `Conta criada para ${ana.email}` })).toBeVisible()
      const linha = page.locator('li').filter({ has: page.getByText(ana.email, { exact: true }) })
      await expect(linha.getByText('com ficha', { exact: true })).toBeVisible()
    })

    await test.step('o service worker se instala e guarda a casca, sob o cabeçalho da política', async () => {
      const casca = await page.evaluate(async () => {
        // Barrado pela política, o worker nunca fica ativo: o prazo faz o teste dizer isso.
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, desistir) => setTimeout(() => desistir(new Error('o service worker não ficou ativo em 15 s')), 15_000)),
        ])
        const nomes = await caches.keys()
        const guardados: string[] = []
        for (const nome of nomes) {
          for (const pedido of await (await caches.open(nome)).keys()) guardados.push(new URL(pedido.url).pathname)
        }
        return { nomes, guardados }
      })
      expect(casca.nomes).toEqual([expect.stringMatching(/^ponto-v\d+$/)])
      // A casca inteira entrou: nenhum pedido do worker foi barrado.
      expect(casca.guardados).toEqual(
        expect.arrayContaining([
          '/',
          '/manifest.webmanifest',
          '/favicon.svg',
          '/icone-192.png',
          '/icone-512.png',
          '/icone-maskable-512.png',
          '/apple-touch-icon.png',
        ]),
      )
    })

    await test.step('o manifesto passa pela política (é ele que faz o Chrome oferecer "instalar")', async () => {
      // O Chrome só baixa o manifesto quando precisa dele (para oferecer a
      // instalação), e nada no teste o pediria: o pedido vem pelo protocolo
      // do próprio Chrome, o mesmo caminho e a mesma regra (manifest-src).
      const cdp = await context.newCDPSession(page)
      try {
        const manifesto = await cdp.send('Page.getAppManifest', {})
        expect(manifesto.errors, 'erros ao ler o manifesto').toEqual([])
        // Barrado pela política, o manifesto volta vazio, e sem erro nenhum.
        expect(manifesto.data, 'o Chrome não conseguiu ler o manifesto').toBeTruthy()
        expect(JSON.parse(manifesto.data!)).toMatchObject({ name: 'Ponto', start_url: '/', display: 'standalone' })
      } finally {
        await cdp.detach()
      }
    })

    await test.step('as fontes carregam, e do próprio app', async () => {
      const carregadas = await page.evaluate(async () => {
        await document.fonts.ready
        return [...document.fonts].filter((fonte) => fonte.status === 'loaded').map((fonte) => fonte.family.replace(/["']/g, ''))
      })
      expect(carregadas).toContain('Quicksand')
      const arquivosDeFonte = vigia.enderecos.filter((endereco) => /\.woff2?$/.test(new URL(endereco).pathname))
      expect(arquivosDeFonte.length).toBeGreaterThan(0)
      for (const arquivo of arquivosDeFonte) expect(arquivo.startsWith(`${baseURL}/assets/`), arquivo).toBe(true)
    })

    conferirVigia(vigia, baseURL!, 'na administração')
  })
})

/* ------------------------------------------------------------------ */
/* 2. A Ana bate, no celular                                           */
/* ------------------------------------------------------------------ */

test.describe('o ponto, no celular de quem bate', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    geolocation: ONDE_A_ANA_BATE,
    permissions: ['geolocation', 'camera'],
  })

  test('a Ana entra, cria o PIN, bate com selfie e abre a selfie no espelho, sem nenhuma recusa', async ({ page, context, baseURL }) => {
    const vigia = (vigiaDoTeste = await vigiar(context))

    await test.step('entra com a senha provisória e cria o PIN', async () => {
      await entrar(page, ana.email, ana.senha)
      await criarPin(page, ana.pin)
      await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
    })

    await test.step('tira a selfie: o vídeo ao vivo e a prévia (blob:)', async () => {
      await page.getByRole('button', { name: /^Bater entrada/ }).click()
      await expect(page.getByRole('heading', { name: 'Olhe para a câmera' })).toBeVisible()
      const tirar = page.getByRole('button', { name: 'Tirar foto' })
      await expect(tirar).toBeEnabled()
      // O vídeo anda (a câmera chega por srcObject, fora da política).
      await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0)
      await tirar.click()
      await expect(page.getByRole('heading', { name: 'Ficou boa?' })).toBeVisible()
      await conferirImagem(page.getByAltText('Prévia da sua selfie'), /^blob:/)
      await page.getByRole('button', { name: 'Usar esta foto' }).click()
    })

    await test.step('confirma com o PIN: a foto sobe ao storage e a batida grava', async () => {
      await expect(page.getByRole('heading', { name: 'Confirme com seu PIN' })).toBeVisible()
      await digitarPin(page, ana.pin)
      await expect(page.getByRole('heading', { name: 'Batida registrada' })).toBeVisible()
      await conferirImagem(page.getByAltText('Selfie registrada nesta batida'), /^blob:/)
      horaDaBatida = (await page.getByText(/^\d{2}:\d{2}$/).first().textContent())?.trim() ?? ''
      expect(horaDaBatida).toMatch(/^\d{2}:\d{2}$/)
      await page.getByRole('button', { name: 'Concluir' }).click()
    })

    await test.step('o espelho abre a selfie pela URL assinada do storage', async () => {
      await page.getByRole('button', { name: 'Ver meu espelho do mês' }).click()
      await expect(page.getByRole('heading', { name: 'Seu mês' })).toBeVisible()
      await page.getByRole('button', { name: `Ver a selfie da batida das ${horaDaBatida}` }).click()
      const visor = page.getByRole('dialog', { name: `Selfie da batida das ${horaDaBatida}` })
      await conferirImagem(visor.getByAltText(`Selfie registrada na batida das ${horaDaBatida}`), URL_ASSINADA)
      await visor.getByRole('button', { name: 'Fechar a foto' }).click()
      await expect(visor).toBeHidden()
    })

    await test.step('as duas fontes do app carregaram, do próprio app', async () => {
      const carregadas = await page.evaluate(async () => {
        await document.fonts.ready
        return [...document.fonts].filter((fonte) => fonte.status === 'loaded').map((fonte) => fonte.family.replace(/["']/g, ''))
      })
      expect(carregadas).toEqual(expect.arrayContaining(['Quicksand', 'JetBrains Mono']))
    })

    conferirVigia(vigia, baseURL!, 'no celular de quem bate')
  })
})

/* ------------------------------------------------------------------ */
/* 3. O painel, a folha e a administração, no computador               */
/* ------------------------------------------------------------------ */

test.describe('o painel, no computador', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('o super admin baixa o CSV, vê a selfie da Ana no painel, a folha e a administração, sem nenhuma recusa', async ({ page, context, baseURL }) => {
    const vigia = (vigiaDoTeste = await vigiar(context))

    await test.step('entra (o PIN já existe)', async () => {
      await entrar(page, sergio.email, sergio.senha)
      await expect(page.getByText('Administração do ponto', { exact: true })).toBeVisible()
    })

    await test.step('o painel exporta o CSV do período (um arquivo blob:)', async () => {
      await page.goto('/painel')
      await expect(page.getByRole('heading', { name: 'Fechamento do período' })).toBeVisible()
      const exportar = page.getByRole('button', { name: /^Exportar CSV de / })
      await expect(exportar).toBeEnabled()
      const [arquivo] = await Promise.all([page.waitForEvent('download'), exportar.click()])
      expect(arquivo.suggestedFilename()).toMatch(/^ponto-.+\.csv$/)
      expect(readFileSync(await arquivo.path(), 'utf8')).toContain(ana.email)
    })

    await test.step('o dia da Ana abre a selfie pela URL assinada', async () => {
      await page.getByRole('link').filter({ hasText: ana.email }).click()
      await expect(page.getByRole('heading', { name: ana.nome })).toBeVisible()
      await page.getByRole('button', { name: `Ver a selfie das ${horaDaBatida}` }).click()
      const visor = page.getByRole('dialog', { name: `Selfie da batida das ${horaDaBatida}` })
      await conferirImagem(visor.getByAltText(`Selfie registrada na batida das ${horaDaBatida}`), URL_ASSINADA)
      await visor.getByRole('button', { name: 'Fechar a foto' }).click()
      await expect(visor).toBeHidden()
    })

    await test.step('a folha do mês abre e pede a impressão', async () => {
      await page.getByRole('button', { name: /para assinar$/ }).click()
      await expect(page).toHaveURL(/\/folha\//)
      await expect(page.getByText('Folha de ponto', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Imprimir ou salvar em PDF' }).click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { __impressoes: number }).__impressoes)).toBeGreaterThan(0)
    })

    await test.step('a administração abre direto pelo endereço', async () => {
      await page.goto('/administracao')
      await expect(page.getByRole('heading', { name: 'Administração do ponto' })).toBeVisible()
    })

    conferirVigia(vigia, baseURL!, 'no painel')
  })
})
