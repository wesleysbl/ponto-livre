import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { RAIZ, hojeNoPonto, rodarComoPostgres } from './apoio.ts'

/*
 * OS PRINTS DA DEMONSTRAÇÃO: `npm run demo:prints`.
 *
 * Grava em `docs/imagens/` as 18 telas que o README e o manual mostram, e a
 * capa do README, com as pessoas fictícias e o mês de batidas de
 * `demo/semear.mjs`. Roda só com DEMO_PRINTS=1, que `demo/prints.mjs` liga
 * (ver `playwright.config.ts`): o `npm run e2e` de sempre não passa por aqui.
 *
 * ANTES: `npm run demo:semear -- --zerar`. O roteiro não cria nada no banco
 * fora o que a tela faz de verdade: a Ana bate a entrada de hoje (o
 * comprovante sai de uma batida real, com o horário do servidor), e as caixas
 * de corrigir e de lançar falta são preenchidas e canceladas. Por isso ele
 * recusa um banco em que a Ana já bateu hoje: a tela de bater precisa da
 * primeira batida do dia. Rodar de novo é semear de novo.
 *
 * OS HORÁRIOS DE HOJE SÃO OS DO RELÓGIO. O comprovante, o espelho e o pedido
 * de batida esquecida mostram a hora em que os prints rodaram (o horário é
 * sempre o do servidor, e isso não se finge). Para prints com cara de dia de
 * trabalho, rode os dois comandos num dia útil, em horário comercial.
 *
 * O QUE CADA PRINT MOSTRA está no `docs/MANUAL.md` e no README, ao lado de
 * cada imagem. Os tamanhos:
 *   • celular: 390×844 com densidade 2 (a imagem sai 780×1688), a Ana;
 *   • computador: 1440×900, a Rita (o RH) e o Sérgio (o super admin). As
 *     telas saem na largura da coluna do conteúdo, sem as faixas pretas dos
 *     lados; a página inteira só quando a tela é uma lista ou um documento (o
 *     painel, os dias de uma pessoa, a folha). As caixas, o cartão do pedido,
 *     a lista de pessoas e o local saem recortados, com uma margem. Tudo para
 *     ficar legível no tamanho em que o manual mostra a imagem;
 *   • a capa: `demo/capa.html`, uma composição com os prints já tirados,
 *     fotografada a 1200×630 com densidade 2 (2400×1260).
 *
 * NENHUM ERRO DE CONSOLE: cada tela é vigiada (erro de console e erro de
 * página), e o teste reprova se aparecer algum.
 *
 * Câmera e GPS simulados, como no cadastro: a câmera falsa mostra o rosto
 * desenhado da Ana (`camera-falsa.ts`), e o GPS do contexto a põe a uns 10 m
 * do local. Para "sem localização", o GPS é trocado antes de a página abrir
 * (`addInitScript`) por um que responde "posição indisponível".
 */

test.describe.configure({ mode: 'serial' })

/** A senha e o PIN de demonstração de `demo/semear.mjs` — só do banco local. */
const SENHA = 'demo-ponto-2026'
const PIN = '1234'

const EMAIL = {
  sergio: 'admin@example.com',
  rita: 'rh@example.com',
  ana: 'ana@example.com',
  caio: 'caio@example.com',
  daniela: 'daniela@example.com',
  gustavo: 'gustavo@example.com',
} as const

const PASTA = join(RAIZ, 'docs', 'imagens')

/** Onde a Ana está quando bate: uns 10 m do local da demonstração, dentro do raio de 150 m. */
const ONDE_A_ANA_BATE = { latitude: -23.550601, longitude: -46.633251, accuracy: 8 }

/** Um iPhone com o Safari: é para ele que o convite de instalar mostra o passo a passo. */
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

/* ------------------------------------------------------------------ */
/* O que a semente deixou no banco                                     */
/* ------------------------------------------------------------------ */

interface Demonstracao {
  /** O mês dos casos da demonstração (`AAAA-MM`): o da correção do RH. */
  mes: string
  inicio: string
  fim: string
  ids: Record<keyof typeof EMAIL, string>
  /** O dia em que a Daniela esqueceu a saída. */
  diaIncompleto: string
  /** A falta do Caio, para a caixa de lançar falta repetir o que o RH lançou. */
  falta: { dia: string; observacao: string }
}

const hoje = hojeNoPonto()

function lerDemonstracao(): Demonstracao {
  const linha = rodarComoPostgres(`
    SELECT
      (SELECT string_agg(u.email || '=' || u.id, ',') FROM auth.users u
        WHERE u.email IN (${Object.values(EMAIL).map((email) => `'${email}'`).join(', ')})),
      (SELECT to_char(min(r.dia_civil), 'YYYY-MM') FROM public.ponto_correcoes c
         JOIN public.ponto_registros r ON r.id = c.registro_id WHERE c.natureza = 'admin'),
      (SELECT min(d.dia_civil) FROM (
         SELECT r.dia_civil FROM public.ponto_registros r JOIN auth.users u ON u.id = r.usuario_id
          WHERE u.email = '${EMAIL.daniela}' AND r.dia_civil < '${hoje}'
          GROUP BY r.dia_civil HAVING count(*) % 2 = 1) d),
      (SELECT a.dia_inicio || '~' || a.observacao FROM public.ponto_ausencias a JOIN auth.users u ON u.id = a.usuario_id
        WHERE u.email = '${EMAIL.caio}' AND a.cancelada_em IS NULL ORDER BY a.dia_inicio LIMIT 1),
      (SELECT count(*) FROM public.ponto_registros r JOIN auth.users u ON u.id = r.usuario_id
        WHERE u.email = '${EMAIL.ana}' AND r.dia_civil = '${hoje}'),
      (SELECT count(*) FROM public.ponto_pedidos_atraso WHERE estado = 'pendente');
  `).trim()
  const [contas, mes, diaIncompleto, falta, batidasDeHojeDaAna, pendentes] = linha.split('|')

  const ids = Object.fromEntries((contas || '').split(',').filter(Boolean).map((par) => par.split('=')).map(([email, id]) => [email, id]))
  const semDemonstracao = Object.values(EMAIL).some((email) => !ids[email]) || !mes || !diaIncompleto || !falta
  if (semDemonstracao) {
    throw new Error('A demonstração não está no banco local. Rode antes: npm run demo:semear -- --zerar')
  }
  if (Number(batidasDeHojeDaAna) > 0 || Number(pendentes) < 1) {
    throw new Error(
      'O banco já passou por um roteiro de prints hoje (a Ana já bateu, ou o pedido de batida esquecida foi decidido). ' +
        'Os prints precisam da primeira batida do dia: rode de novo npm run demo:semear -- --zerar.',
    )
  }

  const [ano, numero] = mes.split('-').map(Number)
  const [diaDaFalta, observacao] = falta.split('~')
  return {
    mes,
    inicio: `${mes}-01`,
    fim: new Date(Date.UTC(ano, numero, 0)).toISOString().slice(0, 10),
    ids: Object.fromEntries(Object.entries(EMAIL).map(([chave, email]) => [chave, ids[email]])) as Demonstracao['ids'],
    diaIncompleto,
    falta: { dia: diaDaFalta, observacao },
  }
}

let demo: Demonstracao

/*
 * O banco é lido (e conferido) uma vez, pelo primeiro grupo que precisa dele —
 * antes de a Ana bater. A capa não precisa: ela é só a composição dos prints,
 * e dá para refazê-la sozinha (`npm run demo:prints -- --grep capa`).
 */
function precisarDoBanco(): void {
  test.beforeAll(() => {
    demo ??= lerDemonstracao()
  })
}

test.beforeAll(() => {
  mkdirSync(PASTA, { recursive: true })
})

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

function somarDias(dia: string, dias: number): string {
  const data = new Date(`${dia}T12:00:00Z`)
  data.setUTCDate(data.getUTCDate() + dias)
  return data.toISOString().slice(0, 10)
}

/** Erros de console e de página, de todas as telas do teste: o roteiro reprova com qualquer um. */
function vigiar(pagina: Page): string[] {
  const erros: string[] = []
  pagina.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(`console: ${mensagem.text()}`)
  })
  pagina.on('pageerror', (erro) => erros.push(`página: ${erro.message}`))
  return erros
}

async function entrar(pagina: Page, email: string): Promise<void> {
  await pagina.goto('/entrar')
  await expect(pagina.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await pagina.getByLabel('E-mail', { exact: true }).fill(email)
  await pagina.getByLabel('Senha', { exact: true }).fill(SENHA)
  await pagina.getByRole('button', { name: 'Entrar', exact: true }).click()
}

async function digitarPin(pagina: Page, pin: string): Promise<void> {
  for (const digito of pin) await pagina.getByRole('button', { name: digito, exact: true }).click()
}

interface ComoGuardar {
  /** Só estes elementos (o retângulo que junta todos), com `margem` em volta. */
  recorte?: Locator | Locator[]
  /**
   * A coluna do conteúdo: a largura deste elemento (o cabeçalho da página),
   * com `margem` dos lados, e a altura da janela (ou da página, com `inteira`).
   * As faixas pretas dos lados de uma página de 1440 px não dizem nada, e sem
   * elas o print fica maior — mais legível — onde o manual o mostra.
   */
  coluna?: Locator
  margem?: number
  /** A página toda, rolando. */
  inteira?: boolean
}

/**
 * O print. Sem `recorte` nem `coluna`, o que cabe na janela (ou a página
 * inteira). Antes do print, o mouse sai de cima de tudo e o campo que estava
 * sendo digitado perde o foco: nenhum botão sai com a cor de "passando por cima", e
 * nenhum campo com o contorno de quem está digitando.
 */
async function guardar(pagina: Page, nome: string, { recorte, coluna, margem = 24, inteira = false }: ComoGuardar = {}): Promise<void> {
  const caminho = join(PASTA, `${nome}.png`)
  await pagina.mouse.move(0, 0)
  await pagina.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const janela = pagina.viewportSize()
  if (!janela) throw new Error(`Sem o tamanho da janela para o print ${nome}.`)

  if (coluna) {
    const caixa = await coluna.boundingBox()
    if (!caixa) throw new Error(`Sem medida da coluna do print ${nome}.`)
    const x = Math.max(0, Math.floor(caixa.x - margem))
    const largura = Math.min(janela.width - x, Math.ceil(caixa.width + 2 * margem))
    const altura = inteira ? await pagina.evaluate(() => document.documentElement.scrollHeight) : janela.height
    await pagina.screenshot({ path: caminho, fullPage: inteira, clip: { x, y: 0, width: largura, height: altura }, animations: 'disabled' })
    return
  }

  if (!recorte) {
    await pagina.screenshot({ path: caminho, fullPage: inteira, animations: 'disabled' })
    return
  }

  const partes = Array.isArray(recorte) ? recorte : [recorte]
  await partes[0].scrollIntoViewIfNeeded()
  const caixas = await Promise.all(partes.map((parte) => parte.boundingBox()))
  if (caixas.some((caixa) => !caixa)) throw new Error(`Sem medida para recortar o print ${nome}.`)
  const esquerda = Math.min(...caixas.map((caixa) => caixa!.x))
  const topo = Math.min(...caixas.map((caixa) => caixa!.y))
  const direita = Math.max(...caixas.map((caixa) => caixa!.x + caixa!.width))
  const baixo = Math.max(...caixas.map((caixa) => caixa!.y + caixa!.height))
  const x = Math.max(0, Math.floor(esquerda - margem))
  const largura = Math.min(janela.width - x, Math.ceil(direita - esquerda + 2 * margem))
  const altura = Math.ceil(baixo - topo + 2 * margem)
  if (topo - margem >= 0 && baixo + margem <= janela.height) {
    // Cabe na janela: o recorte é da tela como ela está (as caixas fixas ficam onde estão).
    await pagina.screenshot({ path: caminho, clip: { x, y: Math.floor(topo - margem), width: largura, height: altura }, animations: 'disabled' })
    return
  }
  // Maior que a janela: o recorte sai da página inteira, nas coordenadas dela.
  const rolagem = await pagina.evaluate(() => window.scrollY)
  await pagina.screenshot({
    path: caminho,
    fullPage: true,
    clip: { x, y: Math.max(0, Math.floor(topo + rolagem - margem)), width: largura, height: altura },
    animations: 'disabled',
  })
}

/** A caixa (o cartão) de dentro de um diálogo, para o recorte. */
const caixaDo = (dialogo: Locator) => dialogo.locator(':scope > div > div').first()

/**
 * O atestado fictício de `demo/atestado.html` como uma foto de celular: grande
 * (2700×3600, JPEG de alta qualidade), como a câmera entrega. É o que a caixa
 * de lançar falta recebe, e o app a reduz no aparelho antes de subir — a caixa
 * mostra "reduzida de … para …", o caso de todo dia.
 */
async function fotoDoAtestado(navegador: Browser, nome: string, dia: string): Promise<Buffer> {
  const contexto = await navegador.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 3 })
  try {
    const papel = await contexto.newPage()
    const endereco = new URL(pathToFileURL(join(RAIZ, 'demo', 'atestado.html')).href)
    endereco.searchParams.set('nome', nome)
    endereco.searchParams.set('dia', dia.split('-').reverse().join('/'))
    await papel.goto(endereco.href)
    return await papel.screenshot({ type: 'jpeg', quality: 92 })
  } finally {
    await contexto.close()
  }
}

/** O primeiro dia do período em que a pessoa tem o dia completo (4 batidas). */
function diaCompleto(usuarioId: string, de: string, ate: string): string {
  const dia = rodarComoPostgres(`
    SELECT dia_civil FROM public.ponto_registros
     WHERE usuario_id = '${usuarioId}' AND dia_civil BETWEEN '${de}' AND '${ate}'
     GROUP BY dia_civil HAVING count(*) = 4 ORDER BY dia_civil LIMIT 1;
  `).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error(`Sem dia completo entre ${de} e ${ate} na demonstração.`)
  return dia
}

/** O horário de uma batida da pessoa, como a tela escreve ("12:07"). */
function horaDaBatida(usuarioId: string, dia: string, tipo: string): string {
  const hora = rodarComoPostgres(`
    SELECT to_char(registrado_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') FROM public.ponto_registros
     WHERE usuario_id = '${usuarioId}' AND dia_civil = '${dia}' AND tipo = '${tipo}' LIMIT 1;
  `).trim()
  if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error(`Sem a batida ${tipo} de ${dia} na demonstração.`)
  return hora
}

/* ------------------------------------------------------------------ */
/* O computador: o RH e o super admin                                  */
/* ------------------------------------------------------------------ */

test.describe('o computador de quem administra', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  precisarDoBanco()

  test('o RH: o painel, os dias de uma pessoa, a correção, o pedido, a falta e a folha', async ({ page, browser }) => {
    const erros = vigiar(page)
    const periodo = `de=${demo.inicio}&ate=${demo.fim}`
    /** O cabeçalho da página (a seta de voltar e a marca): a largura da coluna do conteúdo. */
    const cabecalho = page.locator('header').first()

    await test.step('quem só administra entra direto no painel', async () => {
      await entrar(page, EMAIL.rita)
      await expect(page).toHaveURL(/\/painel/)
    })

    await test.step('painel: o fechamento do mês, com o pedido esperando e o "Antes de fechar"', async () => {
      await page.goto(`/painel?${periodo}`)
      await expect(page.getByRole('heading', { name: 'Fechamento do período' })).toBeVisible()
      await expect(page.getByRole('link').filter({ hasText: EMAIL.gustavo })).toBeVisible()
      await expect(page.getByText(/^Antes de fechar /)).toBeVisible()
      await expect(page.locator('li').filter({ hasText: 'Horário pedido' })).toHaveCount(1)
      await guardar(page, 'painel', { coluna: cabecalho, margem: 40, inteira: true })
    })

    await test.step('pedido-pendente: o cartão do pedido de batida esquecida, com Aprovar e Recusar', async () => {
      const cartao = page.locator('li').filter({ hasText: 'Horário pedido' })
      await expect(cartao.getByRole('button', { name: 'Aprovar' })).toBeVisible()
      await expect(cartao.getByRole('button', { name: 'Recusar' })).toBeVisible()
      // O título da seção ("Batidas em atraso para decidir") e o cartão, sem o vazio à direita.
      const titulo = page.getByRole('heading', { name: /Batidas em atraso para decidir/ })
      await guardar(page, 'pedido-pendente', { recorte: [titulo, cartao] })
    })

    // Os dias da Daniela do sábado antes do dia em que ela esqueceu a saída até
    // ele: o fim de semana vazio (inserir e lançar falta), um dia completo
    // (corrigir) e o incompleto (inserir a que falta). Se o dia incompleto for
    // uma segunda-feira, o período vai até a terça, para ter um dia completo.
    let sabado = somarDias(demo.diaIncompleto, -1)
    while (new Date(`${sabado}T12:00:00Z`).getUTCDay() !== 6) sabado = somarDias(sabado, -1)
    const ate = new Date(`${demo.diaIncompleto}T12:00:00Z`).getUTCDay() === 1 ? somarDias(demo.diaIncompleto, 1) : demo.diaIncompleto
    const completo = diaCompleto(demo.ids.daniela, sabado, ate)

    await test.step('painel-pessoa: os dias de uma pessoa, com Corrigir, Inserir e Lançar falta', async () => {
      await page.goto(`/painel/${demo.ids.daniela}?de=${sabado}&ate=${ate}`)
      await expect(page.getByRole('heading', { name: 'Daniela Freitas' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Inserir a batida que falta' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Lançar falta neste dia' }).first()).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await guardar(page, 'painel-pessoa', { coluna: cabecalho, margem: 40, inteira: true })
    })

    await test.step('corrigir-batida: a caixa de corrigir um horário, com o motivo', async () => {
      const hora = horaDaBatida(demo.ids.daniela, completo, 'saida_almoco')
      // Pelo dia (a âncora `#dia-AAAA-MM-DD` da lista): dois dias podem ter o mesmo horário.
      await page.locator(`#dia-${completo}`).getByRole('button', { name: `Corrigir a batida das ${hora}` }).click()
      const dialogo = page.getByRole('dialog', { name: 'Corrigir o horário da batida' })
      await expect(dialogo).toBeVisible()
      await dialogo.getByLabel('Hora', { exact: true }).fill('12:00')
      await dialogo
        .getByLabel(/^Motivo/)
        .fill('Saiu para o almoço às 12h e só lembrou de bater alguns minutos depois; horário confirmado com a supervisora.')
      await expect(dialogo.getByRole('button', { name: new RegExp(`^Mudar de ${hora} para 12:00`) })).toBeVisible()
      await guardar(page, 'corrigir-batida', { recorte: caixaDo(dialogo) })
      // Só o print: a caixa fecha sem gravar.
      await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await expect(dialogo).toBeHidden()
    })

    await test.step('falta-com-atestado: a caixa de lançar falta, com o tipo, a observação e o atestado', async () => {
      await page.goto(`/painel/${demo.ids.caio}?${periodo}`)
      await expect(page.getByRole('heading', { name: 'Caio Mendes' })).toBeVisible()
      await page.getByRole('button', { name: 'Lançar falta justificada' }).click()
      const dialogo = page.getByRole('dialog', { name: 'Lançar falta justificada' })
      await expect(dialogo).toBeVisible()
      // A mesma falta que o RH da demonstração lançou para o Caio (a caixa não grava).
      await dialogo.getByLabel('Primeiro dia', { exact: true }).fill(demo.falta.dia)
      await dialogo.getByLabel('Último dia', { exact: true }).fill(demo.falta.dia)
      await dialogo.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Atestado médico' })
      await dialogo.getByLabel(/^Observação/).fill(demo.falta.observacao)
      const foto = await fotoDoAtestado(browser, 'Caio Mendes', demo.falta.dia)
      await dialogo
        .locator('input[type="file"]:not([capture])')
        .setInputFiles({ name: 'atestado-caio.jpg', mimeType: 'image/jpeg', buffer: foto })
      await expect(dialogo.getByText('atestado-caio.jpg')).toBeVisible()
      await expect(dialogo.getByText(/^reduzida de /)).toBeVisible()
      await guardar(page, 'falta-com-atestado', { recorte: caixaDo(dialogo) })
      await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await expect(dialogo).toBeHidden()
    })

    await test.step('folha: a folha do mês para imprimir e assinar', async () => {
      await page.goto(`/folha/${demo.ids.gustavo}?mes=${demo.mes}`)
      await expect(page.getByRole('button', { name: 'Imprimir ou salvar em PDF' })).toBeVisible()
      await expect(page.getByText('Gustavo Ramos').first()).toBeVisible()
      await guardar(page, 'folha', { coluna: cabecalho, margem: 40, inteira: true })
    })

    expect(erros).toEqual([])
  })

  test('o super admin: a administração, as pessoas e o local de trabalho', async ({ page }) => {
    const erros = vigiar(page)
    const cabecalho = page.locator('header').first()

    await test.step('o super admin entra e abre a administração', async () => {
      await entrar(page, EMAIL.sergio)
      await expect(page.getByRole('heading', { name: 'Olá, Sérgio' })).toBeVisible()
      await page.goto('/administracao')
      await expect(page.getByRole('heading', { name: 'Administração do ponto' })).toBeVisible()
      // As contas e as fichas chegaram (a lista carrega sozinha, depois dos cartões).
      await expect(page.getByText(EMAIL.gustavo, { exact: true })).toBeVisible()
      await expect(page.getByText('Fernanda Teles', { exact: true })).toBeVisible()
    })

    await test.step('administracao: a página inicial, com os seis cartões', async () => {
      await page.evaluate(() => window.scrollTo(0, 0))
      await guardar(page, 'administracao', { coluna: cabecalho, margem: 40 })
    })

    await test.step('pessoas: a lista, com conta, ficha, administração e PIN', async () => {
      await guardar(page, 'pessoas', { recorte: page.locator('#secao-pessoas'), margem: 12 })
    })

    await test.step('local-de-trabalho: o formulário do local', async () => {
      await expect(page.getByLabel('Nome do local', { exact: true })).toHaveValue('Sede da Empresa Exemplo')
      await guardar(page, 'local-de-trabalho', { recorte: page.locator('#secao-local'), margem: 12 })
    })

    expect(erros).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* O celular de quem bate: a Ana                                       */
/* ------------------------------------------------------------------ */

test.describe('o celular de quem bate', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    geolocation: ONDE_A_ANA_BATE,
    permissions: ['geolocation', 'camera'],
  })
  precisarDoBanco()

  test.describe('num iPhone, antes de instalar', () => {
    test.use({ userAgent: IPHONE })

    test('celular-instalar: o convite para instalar, com o passo a passo do aparelho', async ({ page }) => {
      const erros = vigiar(page)
      await page.goto('/entrar')
      await expect(page.getByRole('heading', { name: 'Instale o app Ponto no celular' })).toBeVisible()
      await expect(page.getByText('Adicionar à Tela de Início')).toBeVisible()
      await guardar(page, 'celular-instalar')
      expect(erros).toEqual([])
    })
  })

  test('a Ana entra, bate a entrada, confere o mês, pede uma batida esquecida e fica sem GPS', async ({ page }) => {
    const erros = vigiar(page)
    let horaDaEntrada = ''

    await test.step('celular-entrar: a tela de entrar, preenchida', async () => {
      await page.goto('/entrar')
      await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
      await page.getByLabel('E-mail', { exact: true }).fill(EMAIL.ana)
      await page.getByLabel('Senha', { exact: true }).fill(SENHA)
      await guardar(page, 'celular-entrar')
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    })

    await test.step('celular-bater: a tela de bater, com o botão verde da entrada', async () => {
      await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Bater entrada/ })).toBeVisible()
      await expect(page.getByText('Nenhuma batida hoje')).toBeVisible()
      await guardar(page, 'celular-bater')
    })

    await test.step('celular-camera: olhe para a câmera', async () => {
      await page.getByRole('button', { name: /^Bater entrada/ }).click()
      await expect(page.getByRole('heading', { name: 'Olhe para a câmera' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Tirar foto' })).toBeEnabled()
      // O quadro da câmera já desenhado (e não o retângulo preto do primeiro instante).
      await expect
        .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState >= 2 && video.currentTime > 0.3))
        .toBe(true)
      await guardar(page, 'celular-camera')
    })

    await test.step('celular-pin: confirme com seu PIN', async () => {
      await page.getByRole('button', { name: 'Tirar foto' }).click()
      await expect(page.getByRole('heading', { name: 'Ficou boa?' })).toBeVisible()
      await page.getByRole('button', { name: 'Usar esta foto' }).click()
      await expect(page.getByRole('heading', { name: 'Confirme com seu PIN' })).toBeVisible()
      await guardar(page, 'celular-pin')
    })

    await test.step('celular-comprovante: a batida registrada, com o horário do servidor', async () => {
      await digitarPin(page, PIN)
      await expect(page.getByRole('heading', { name: 'Batida registrada' })).toBeVisible()
      await expect(page.getByText('Entrada · 1ª do dia')).toBeVisible()
      await expect(page.getByText('No local', { exact: true })).toBeVisible()
      const selfie = page.getByAltText('Selfie registrada nesta batida')
      await expect.poll(() => selfie.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
      horaDaEntrada = (await page.getByText(/^\d{2}:\d{2}$/).first().textContent())?.trim() ?? ''
      expect(horaDaEntrada).toMatch(/^\d{2}:\d{2}$/)
      await guardar(page, 'celular-comprovante')
      await page.getByRole('button', { name: 'Concluir' }).click()
    })

    await test.step('celular-espelho: o mês da Ana, com o total e os dias', async () => {
      await page.getByRole('button', { name: 'Ver meu espelho do mês' }).click()
      await expect(page.getByRole('heading', { name: 'Seu mês' })).toBeVisible()
      if (demo.mes !== hoje.slice(0, 7)) {
        // No começo do mês, o mês da demonstração é o anterior.
        await page.getByRole('button', { name: /^Ver / }).first().click()
      }
      await expect(page.getByText(/^\d+ dias com batida/)).toBeVisible()
      await expect(page.getByText('sem localização').first()).toBeVisible()
      await guardar(page, 'celular-espelho')
      await page.getByRole('button', { name: 'Bater ponto' }).click()
    })

    await test.step('celular-esqueci-de-bater: o pedido de batida esquecida, preenchido', async () => {
      await page.getByRole('button', { name: 'Esqueci de bater hoje' }).click()
      await expect(page.getByRole('heading', { name: 'Registrar batida em atraso' })).toBeVisible()
      await expect(page.getByText(`Hoje você já bateu: ${horaDaEntrada} Entrada`)).toBeVisible()
      // Vinte minutos antes da entrada de agora (e nunca antes da meia-noite).
      const [h, m] = horaDaEntrada.split(':').map(Number)
      const minutos = Math.max(0, h * 60 + m - 20)
      const hora = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
      await page.getByLabel('Que horas você chegou ou saiu e esqueceu de bater?').fill(hora)
      await page.getByLabel('Motivo', { exact: true }).fill('Cheguei vinte minutos antes e só lembrei de bater agora.')
      await expect(page.getByText(/^Esse horário fica /)).toBeVisible()
      await guardar(page, 'celular-esqueci-de-bater')
      // Só o print: o pedido não vai.
      await page.getByRole('button', { name: 'Cancelar o pedido' }).click()
      await expect(page.getByRole('button', { name: 'Esqueci de bater hoje' })).toBeVisible()
    })

    await test.step('celular-sem-localizacao: o GPS não responde, e aparece "Bater sem localização"', async () => {
      // A página volta com um GPS que responde "posição indisponível" (código 2),
      // como um aparelho sem sinal. A sessão continua: ela mora no aparelho.
      await page.addInitScript(() => {
        const falha = { code: 2, message: 'Posição indisponível (GPS simulado)', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }
        Geolocation.prototype.getCurrentPosition = function (_ok: PositionCallback, erro?: PositionErrorCallback | null) {
          setTimeout(() => erro?.(falha as unknown as GeolocationPositionError), 300)
        }
        Geolocation.prototype.watchPosition = function (_ok: PositionCallback, erro?: PositionErrorCallback | null) {
          setTimeout(() => erro?.(falha as unknown as GeolocationPositionError), 300)
          return 1
        }
      })
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
      await page.getByRole('button', { name: /^Bater saída para o almoço/ }).click()
      await expect(page.getByRole('heading', { name: 'Olhe para a câmera' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Tirar foto' })).toBeEnabled()
      await page.getByRole('button', { name: 'Tirar foto' }).click()
      await page.getByRole('button', { name: 'Usar esta foto' }).click()
      await expect(page.getByRole('heading', { name: 'Não achamos sua localização' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Bater sem localização' })).toBeVisible()
      await guardar(page, 'celular-sem-localizacao')
      // Só o print: a batida não acontece (a foto ainda nem subiu).
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    })

    expect(erros).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* A capa                                                              */
/* ------------------------------------------------------------------ */

test.describe('a capa do README', () => {
  test.use({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })

  test('capa: o nome, a frase e as telas, num celular e num computador desenhados', async ({ page }) => {
    const erros = vigiar(page)
    await page.goto(pathToFileURL(join(RAIZ, 'demo', 'capa.html')).href)
    await page.evaluate(() => document.fonts.ready)
    await expect
      .poll(() => page.locator('img').evaluateAll((imagens: HTMLImageElement[]) => imagens.every((img) => img.complete && img.naturalWidth > 0)))
      .toBe(true)
    await page.screenshot({ path: join(PASTA, 'capa.png'), animations: 'disabled' })
    expect(erros).toEqual([])
  })
})
