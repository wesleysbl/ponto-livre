import { randomBytes } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  CARIMBO,
  criarContaComoNoPainel,
  emailDaExecucao,
  hojeNoPonto,
  rodarComoPostgres,
  tornarSuperAdmin,
} from './apoio.ts'
import { BOCHECHA_NA_SELFIE, PELE_DA_ANA } from './camera-falsa.ts'
import { print } from './prints.ts'

/*
 * O CADASTRO DE PONTA A PONTA, PELA TELA, NUMA INSTALAÇÃO NOVA.
 *
 * É o caminho de quem instala o ponto, na ordem em que ele acontece:
 *
 *   0. (fora do app) a conta do super admin nasce como no painel do Supabase
 *      ("Add user", com "Auto Confirm User") e entra na lista de super admins
 *      pelo `supabase/primeiro-super-admin.sql`, rodado como `postgres` — o
 *      mesmo arquivo e a mesma troca única do e-mail que quem instala faz;
 *   1. o super admin entra, cria o PIN, põe o próprio nome e configura a
 *      empresa, a jornada e o local de trabalho;
 *   2. cria a conta da Ana (e guarda a senha provisória que a tela mostra),
 *      a ficha de RH dela, e liga uma à outra;
 *   3. cria a conta da Rita, do RH, e a faz administrar o ponto, sem ficha;
 *   4. a Ana entra no celular com a senha provisória, cria o PIN e bate a
 *      entrada: selfie da câmera falsa (o rosto ilustrado dela), localização
 *      perto do local, PIN; vê o comprovante e o espelho com a entrada de hoje;
 *   5. a Rita entra no computador, cria o PIN e vê a Ana no painel, com a
 *      batida de hoje e a selfie.
 *
 * Tudo com o elenco fictício (Sérgio Almeida, Ana Beatriz Rocha, Rita Moraes,
 * Empresa Exemplo Ltda) e e-mails `example.com` com o carimbo da execução: o
 * teste roda de novo no mesmo banco sem esbarrar na vez anterior, e cada
 * passo acha a SUA pessoa pelo e-mail, mesmo com as das outras vezes na lista.
 *
 * EM SÉRIE: cada teste é uma pessoa num aparelho, e depende do anterior.
 */

test.describe.configure({ mode: 'serial' })

/** O local de trabalho do elenco (centro de São Paulo), digitado no formulário. */
const LOCAL = { latitude: '-23.550520', longitude: '-46.633308' }
/** Onde a Ana está quando bate: uns 10 metros do local, dentro do raio de 150 m. */
const ONDE_A_ANA_BATE = { latitude: -23.550601, longitude: -46.633251, accuracy: 8 }

/** Senha que nunca aparece: vive só na memória do teste. */
const senhaAleatoria = () => `Ponto-${randomBytes(9).toString('base64url')}`

const sergio = { nome: 'Sérgio Almeida', email: emailDaExecucao('sergio'), senha: senhaAleatoria(), pin: '4826' }
// As senhas da Ana e da Rita são as provisórias que a tela do super admin mostra.
const ana = { nome: 'Ana Beatriz Rocha', email: emailDaExecucao('ana'), senha: '', pin: '2580', matricula: CARIMBO.slice(-5) }
const rita = { nome: 'Rita Moraes', email: emailDaExecucao('rita'), senha: '', pin: '1357' }
const hoje = hojeNoPonto()
/** O horário da entrada da Ana, como o comprovante mostra (o do servidor). */
let horaDaBatida = ''

/* ------------------------------------------------------------------ */
/* Peças da tela                                                       */
/* ------------------------------------------------------------------ */

/** A linha de uma pessoa (com conta) na lista de pessoas da administração, pelo e-mail. */
function linhaDaPessoa(pagina: Page, email: string): Locator {
  return pagina.locator('li').filter({ has: pagina.getByText(email, { exact: true }) })
}

/** Abre a linha (o cabeçalho é o botão com `aria-expanded`), se ainda estiver fechada. */
async function abrirLinha(linha: Locator): Promise<void> {
  const cabecalho = linha.locator('button[aria-expanded]')
  if ((await cabecalho.getAttribute('aria-expanded')) !== 'true') await cabecalho.click()
  await expect(cabecalho).toHaveAttribute('aria-expanded', 'true')
}

/**
 * O recado do rodapé, que confirma a ação da lista de pessoas ("Conta criada
 * para…"): ele tem de dizer o que foi feito, e é fechado em seguida. Fechar
 * é o que o RH faria; e o recado, que fica preso ao rodapé por 8 segundos,
 * não cobre o print do passo seguinte.
 */
async function conferirRecado(pagina: Page, texto: string | RegExp): Promise<void> {
  const recado = pagina.getByRole('status').filter({ hasText: texto })
  await expect(recado).toBeVisible()
  await recado.getByRole('button', { name: 'Fechar o recado' }).click()
  await expect(recado).toHaveCount(0)
}

/** O formulário de entrar, preenchido (o print sai antes do clique). */
async function preencherEntrada(pagina: Page, email: string, senha: string): Promise<void> {
  await pagina.goto('/entrar')
  await expect(pagina.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await pagina.getByLabel('E-mail', { exact: true }).fill(email)
  await pagina.getByLabel('Senha', { exact: true }).fill(senha)
}

/** O teclado do PIN, tecla por tecla, como no celular. */
async function digitarPin(pagina: Page, pin: string): Promise<void> {
  for (const digito of pin) await pagina.getByRole('button', { name: digito, exact: true }).click()
}

/** "Crie seu PIN" e "Repita o PIN": a tela que o app abre na primeira entrada. */
async function criarPin(pagina: Page, pin: string): Promise<void> {
  await expect(pagina.getByRole('heading', { name: 'Crie seu PIN' })).toBeVisible()
  await digitarPin(pagina, pin)
  await expect(pagina.getByRole('heading', { name: 'Repita o PIN' })).toBeVisible()
  await digitarPin(pagina, pin)
}

/**
 * A cor média de um quadrado de uma imagem já carregada, lida num canvas. É
 * como o teste confere que a selfie é o rosto da câmera falsa (a pele do
 * desenho), e não o quadro de teste padrão do Chrome nem um quadro preto.
 *
 * A imagem é BAIXADA de novo (`fetch`) em vez de desenhada direto da `<img>`:
 * a selfie que o RH abre vem do storage, que é outra origem, e desenhar a
 * `<img>` dela no canvas o "contaminaria" (o navegador proíbe ler os pixels).
 * Pelo `fetch`, o storage responde com CORS aberto, e os pixels se leem.
 */
async function corMedia(imagem: Locator): Promise<{ largura: number; altura: number; cor: number[] }> {
  await expect.poll(() => imagem.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  return imagem.evaluate(async (img: HTMLImageElement, { x, y, lado }) => {
    const quadro = await createImageBitmap(await (await fetch(img.currentSrc)).blob())
    const tela = document.createElement('canvas')
    tela.width = quadro.width
    tela.height = quadro.height
    const pincel = tela.getContext('2d')
    if (!pincel) throw new Error('Sem canvas 2D.')
    pincel.drawImage(quadro, 0, 0)
    const px = pincel.getImageData(x - lado / 2, y - lado / 2, lado, lado).data
    const soma = [0, 0, 0]
    for (let i = 0; i < px.length; i += 4) {
      soma[0] += px[i]
      soma[1] += px[i + 1]
      soma[2] += px[i + 2]
    }
    const pontos = px.length / 4
    return { largura: quadro.width, altura: quadro.height, cor: soma.map((canal) => canal / pontos) }
  }, BOCHECHA_NA_SELFIE)
}

/** A selfie é o rosto da Ana: 480×480 (o recorte do app) e a pele do desenho na bochecha. */
async function conferirSelfieDaAna(imagem: Locator): Promise<void> {
  const { largura, altura, cor } = await corMedia(imagem)
  expect({ largura, altura }).toEqual({ largura: 480, altura: 480 })
  cor.forEach((canal, i) => expect(Math.abs(canal - PELE_DA_ANA[i])).toBeLessThan(28))
}

/* ------------------------------------------------------------------ */
/* 0. O primeiro super admin, como quem instala                        */
/* ------------------------------------------------------------------ */

test.beforeAll(async () => {
  await criarContaComoNoPainel(sergio.email, sergio.senha)
  // A lista que o arquivo mostra no fim tem de trazer a conta.
  expect(tornarSuperAdmin(sergio.email)).toContain(sergio.email)
})

/* ------------------------------------------------------------------ */
/* 1 a 3. O super admin, no computador                                 */
/* ------------------------------------------------------------------ */

test.describe('a administração, no computador', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('o super admin entra, configura o ponto, cadastra a Ana e faz a Rita administrar', async ({ page }) => {
    await test.step('entra com a conta criada no painel do Supabase', async () => {
      await preencherEntrada(page, sergio.email, sergio.senha)
      await print(page, '01-super-admin-entra')
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    })

    await test.step('o app pede um PIN de 4 dígitos na primeira entrada', async () => {
      await expect(page).toHaveURL(/\/definir-pin$/)
      await expect(page.getByRole('heading', { name: 'Crie seu PIN' })).toBeVisible()
      await print(page, '02-super-admin-cria-o-pin')
      await criarPin(page, sergio.pin)
    })

    await test.step('abre a tela inicial e, dela, a administração', async () => {
      // O super admin entra pela administração e pode bater (só para teste).
      await expect(page.getByText('Administração do ponto', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Bater entrada/ })).toBeVisible()
      await print(page, '03-super-admin-tela-inicial')
      await page.getByRole('button', { name: 'Administração', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Administração do ponto' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Nova conta', exact: true })).toBeVisible()
    })

    await test.step('põe o próprio nome na conta (o painel do Supabase cria a conta sem nome)', async () => {
      const linha = linhaDaPessoa(page, sergio.email)
      await expect(linha.getByText('super admin', { exact: true })).toBeVisible()
      await abrirLinha(linha)
      await linha.getByRole('button', { name: 'Trocar o nome' }).click()
      const caixa = page.getByRole('dialog', { name: 'Trocar o nome' })
      await caixa.getByLabel('Nome', { exact: true }).fill(sergio.nome)
      await print(page, '04-super-admin-poe-o-proprio-nome')
      await caixa.getByRole('button', { name: 'Trocar o nome' }).click()
      await expect(caixa).toBeHidden()
      await conferirRecado(page, `Nome trocado para “${sergio.nome}”`)
      await expect(linha.getByText(sergio.nome, { exact: true })).toBeVisible()
    })

    await test.step('preenche a empresa, a jornada e o local de trabalho', async () => {
      await page.getByLabel('Razão social', { exact: true }).fill('Empresa Exemplo Ltda')
      await page.getByLabel('Nome de fantasia', { exact: true }).fill('Empresa Exemplo')
      // Sem CNPJ: dado de exemplo não leva documento que pode ser de alguém.
      await page.getByLabel('CNPJ', { exact: true }).fill('')
      await page.getByLabel('Endereço', { exact: true }).fill('Rua das Flores, 100 - Centro')
      await page.getByLabel('Cidade', { exact: true }).fill('Campinas')
      await page.getByLabel('UF', { exact: true }).fill('SP')
      await page.getByRole('button', { name: 'Salvar os dados da empresa' }).click()
      await expect(page.getByText('Dados da empresa salvos. Ainda falta preencher: CNPJ.')).toBeVisible()

      await page.getByLabel('Carga diária esperada (horas:minutos)', { exact: true }).fill('08:00')
      await page.getByLabel('Tolerância, em minutos', { exact: true }).fill('10')
      await page.getByLabel('Janela que recusa batida repetida, em segundos', { exact: true }).fill('60')
      await page.getByRole('button', { name: 'Salvar as regras' }).click()
      await expect(page.getByText(/^Regras salvas\./)).toBeVisible()

      await page.getByLabel('Nome do local', { exact: true }).fill('Sede da Empresa Exemplo')
      await page.getByLabel('Latitude', { exact: true }).fill(LOCAL.latitude)
      await page.getByLabel('Longitude', { exact: true }).fill(LOCAL.longitude)
      await page.getByLabel('Raio, em metros', { exact: true }).fill('150')
      await page.getByRole('button', { name: 'Salvar o local' }).click()
      await expect(page.getByText('Local salvo: Sede da Empresa Exemplo, raio de 150 m.')).toBeVisible()
      await print(page, '05-administracao-empresa-jornada-e-local', { inteira: true })
    })

    await test.step('cria a conta da Ana e guarda a senha provisória que a tela mostra', async () => {
      await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
      const caixa = page.getByRole('dialog', { name: 'Criar conta' })
      await caixa.getByLabel('Nome da pessoa', { exact: true }).fill(ana.nome)
      await caixa.getByLabel('E-mail para entrar', { exact: true }).fill(ana.email)
      // A ficha nasce no passo seguinte, pelo formulário inteiro da ficha.
      await caixa.getByLabel('Ficha do ponto', { exact: true }).selectOption({ label: 'Sem ficha por enquanto' })
      ana.senha = await caixa.getByLabel('Senha provisória', { exact: true }).inputValue()
      expect(ana.senha.length).toBeGreaterThanOrEqual(8)
      await print(page, '06-super-admin-cria-a-conta-da-ana')
      await caixa.getByRole('button', { name: 'Criar a conta' }).click()
      await expect(caixa).toBeHidden()
      await conferirRecado(page, `Conta criada para ${ana.email}`)
      const linha = linhaDaPessoa(page, ana.email)
      await expect(linha.getByText('sem ficha', { exact: true })).toBeVisible()
    })

    await test.step('cria a ficha de RH da Ana: cargo, admissão e bate ponto desde hoje', async () => {
      await page.getByRole('button', { name: 'Nova ficha sem conta' }).click()
      const caixa = page.getByRole('dialog', { name: 'Nova ficha de funcionário' })
      await caixa.getByLabel('Nome completo', { exact: true }).fill(ana.nome)
      await caixa.getByLabel('Matrícula', { exact: true }).fill(ana.matricula)
      await caixa.getByLabel('Cargo', { exact: true }).fill('Vendas')
      await caixa.getByLabel('Admissão', { exact: true }).fill(hoje)
      await caixa.getByLabel('Passou a bater ponto aqui em', { exact: true }).fill(hoje)
      // A ficha é a caixa mais alta do cadastro: numa janela de 900 px, o botão
      // "Criar a ficha" ficaria fora do print.
      await print(page, '07-super-admin-cria-a-ficha-da-ana', { altura: 1180 })
      await caixa.getByRole('button', { name: 'Criar a ficha' }).click()
      await expect(caixa).toBeHidden()
      await conferirRecado(page, `Ficha de ${ana.nome} criada.`)
    })

    await test.step('liga a ficha à conta da Ana', async () => {
      // A busca acha a ficha pela matrícula: a ficha desta execução, e não a de outra.
      const busca = page.getByLabel('Buscar pessoa por nome, e-mail, CPF, cargo ou matrícula')
      await busca.fill(ana.matricula)
      const ficha = page.locator('li').filter({ hasText: 'ficha sem conta' }).filter({ hasText: ana.nome })
      await expect(ficha).toHaveCount(1)
      await abrirLinha(ficha)
      await ficha.getByRole('button', { name: 'Ligar a uma conta' }).click()

      const caixa = page.getByRole('dialog', { name: 'Ligar a uma conta' })
      // A conta certa pelo e-mail, entre as que combinam pelo nome.
      await caixa.getByRole('button').filter({ hasText: ana.email }).click()
      await expect(caixa.getByText(`passa a ser da conta ${ana.nome} (${ana.email})`, { exact: false })).toBeVisible()
      await print(page, '08-super-admin-liga-a-ficha-a-conta-da-ana')
      await caixa.getByRole('button', { name: 'Ligar', exact: true }).click()
      await expect(caixa).toBeHidden()
      await conferirRecado(page, `A ficha “${ana.nome}” agora é da conta ${ana.email}: a pessoa já bate ponto por ela.`)

      await busca.fill('')
      const linha = linhaDaPessoa(page, ana.email)
      await expect(linha.getByText('com ficha', { exact: true })).toBeVisible()
    })

    await test.step('cria a conta da Rita, do RH, e faz ela administrar o ponto, sem ficha', async () => {
      await page.getByRole('button', { name: 'Nova conta', exact: true }).click()
      const caixa = page.getByRole('dialog', { name: 'Criar conta' })
      await caixa.getByLabel('Nome da pessoa', { exact: true }).fill(rita.nome)
      await caixa.getByLabel('E-mail para entrar', { exact: true }).fill(rita.email)
      await caixa.getByLabel('Ficha do ponto', { exact: true }).selectOption({ label: 'Sem ficha por enquanto' })
      rita.senha = await caixa.getByLabel('Senha provisória', { exact: true }).inputValue()
      expect(rita.senha.length).toBeGreaterThanOrEqual(8)
      await print(page, '09-super-admin-cria-a-conta-da-rita')
      await caixa.getByRole('button', { name: 'Criar a conta' }).click()
      await expect(caixa).toBeHidden()
      await conferirRecado(page, `Conta criada para ${rita.email}`)

      // A linha da conta nova abre sozinha quando a lista volta.
      const linha = linhaDaPessoa(page, rita.email)
      await abrirLinha(linha)
      await linha.getByRole('button', { name: 'Conceder admin' }).click()
      const concessao = page.getByRole('dialog', { name: 'Conceder a administração do ponto' })
      await concessao.getByLabel('Por que esta pessoa? (opcional)').fill('cuida do RH e fecha a folha do mês')
      await print(page, '10-super-admin-faz-a-rita-administrar')
      await concessao.getByRole('button', { name: 'Conceder a administração' }).click()
      await expect(concessao).toBeHidden()
      await conferirRecado(page, `${rita.nome} passou a administrar o ponto.`)
      await expect(linha.getByText('administra o ponto', { exact: true })).toBeVisible()
      await expect(linha.getByText('só administra — não bate ponto', { exact: true })).toBeVisible()
    })

    await test.step('a lista de pessoas e o banco ficam como o cadastro mandou', async () => {
      // O print é a seção da lista inteira (ela tem âncora própria): as três
      // pessoas, com a linha da Rita ainda aberta, que o guia descreve. Só a
      // janela cortaria a Ana, que fica abaixo da linha aberta.
      await print(page, '11-pessoas-depois-do-cadastro', { elemento: page.locator('#secao-pessoas') })
      const banco = rodarComoPostgres(`
        SELECT
          (SELECT count(*) FROM public.ponto_funcionarios f JOIN auth.users u ON u.id = f.usuario_id
            WHERE u.email = '${ana.email}' AND f.ativo AND f.cargo = 'Vendas'
              AND f.admissao = '${hoje}' AND f.bate_ponto_desde = '${hoje}' AND f.matricula = '${ana.matricula}'),
          (SELECT count(*) FROM public.ponto_admins a JOIN auth.users u ON u.id = a.usuario_id WHERE u.email = '${rita.email}'),
          (SELECT count(*) FROM public.ponto_funcionarios f JOIN auth.users u ON u.id = f.usuario_id WHERE u.email = '${rita.email}'),
          (SELECT u.raw_app_meta_data->>'full_name' FROM auth.users u WHERE u.email = '${sergio.email}');
      `).trim()
      // A Ana com a ficha ligada; a Rita administra e não tem ficha; o super admin com o nome
      // (no app_metadata, onde a função de contas o guarda).
      expect(banco).toBe(`1|1|0|${sergio.nome}`)
    })
  })
})

/* ------------------------------------------------------------------ */
/* 4. A Ana, no celular                                                */
/* ------------------------------------------------------------------ */

test.describe('o ponto, no celular de quem bate', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    geolocation: ONDE_A_ANA_BATE,
    permissions: ['geolocation', 'camera'],
  })

  test('a Ana entra com a senha provisória, cria o PIN e bate a entrada com selfie, localização e PIN', async ({ page }) => {
    await test.step('entra com o e-mail e a senha provisória', async () => {
      await preencherEntrada(page, ana.email, ana.senha)
      await print(page, '12-ana-entra-com-a-senha-provisoria')
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    })

    await test.step('o app pede o PIN (e não pede para trocar a senha)', async () => {
      await expect(page).toHaveURL(/\/definir-pin$/)
      await expect(page.getByRole('heading', { name: 'Crie seu PIN' })).toBeVisible()
      await print(page, '13-ana-cria-o-pin')
      await criarPin(page, ana.pin)
    })

    await test.step('a tela de bater chama a Ana pelo nome da ficha e prevê a entrada', async () => {
      await expect(page.getByRole('heading', { name: 'Olá, Ana' })).toBeVisible()
      await expect(page.getByText('Vendas', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Bater entrada/ })).toBeVisible()
      await expect(page.getByText('Nenhuma batida hoje')).toBeVisible()
      await print(page, '14-ana-tela-de-bater')
    })

    await test.step('tira a selfie com a câmera (o rosto ilustrado da Ana)', async () => {
      await page.getByRole('button', { name: /^Bater entrada/ }).click()
      await expect(page.getByRole('heading', { name: 'Olhe para a câmera' })).toBeVisible()
      const tirar = page.getByRole('button', { name: 'Tirar foto' })
      await expect(tirar).toBeEnabled()
      await print(page, '15-ana-olha-para-a-camera')
      await tirar.click()
      await expect(page.getByRole('heading', { name: 'Ficou boa?' })).toBeVisible()
      await conferirSelfieDaAna(page.getByAltText('Prévia da sua selfie'))
      await print(page, '16-ana-confere-a-selfie')
      await page.getByRole('button', { name: 'Usar esta foto' }).click()
    })

    await test.step('confirma com o PIN, depois da localização', async () => {
      await expect(page.getByRole('heading', { name: 'Confirme com seu PIN' })).toBeVisible()
      await print(page, '17-ana-confirma-com-o-pin')
      await digitarPin(page, ana.pin)
    })

    await test.step('o comprovante traz o horário do servidor e "no local"', async () => {
      await expect(page.getByRole('heading', { name: 'Batida registrada' })).toBeVisible()
      await expect(page.getByText('Entrada · 1ª do dia')).toBeVisible()
      await expect(page.getByText('No local', { exact: true })).toBeVisible()
      await expect(page.getByAltText('Selfie registrada nesta batida')).toBeVisible()
      horaDaBatida = (await page.getByText(/^\d{2}:\d{2}$/).first().textContent())?.trim() ?? ''
      expect(horaDaBatida).toMatch(/^\d{2}:\d{2}$/)
      await print(page, '18-ana-comprovante')
      await page.getByRole('button', { name: 'Concluir' }).click()
    })

    await test.step('o espelho do mês mostra a entrada de hoje', async () => {
      await page.getByRole('button', { name: 'Ver meu espelho do mês' }).click()
      await expect(page.getByRole('heading', { name: 'Seu mês' })).toBeVisible()
      const entrada = page.getByRole('button', { name: `Ver a selfie da batida das ${horaDaBatida}` })
      await expect(entrada).toBeVisible()
      await expect(entrada).toContainText('Entrada')
      await expect(page.getByText('Em andamento', { exact: true })).toBeVisible()
      await print(page, '19-ana-espelho-do-mes')
    })

    await test.step('no banco: uma batida, no local, com selfie guardada', async () => {
      const banco = rodarComoPostgres(`
        SELECT count(*), bool_and(r.no_local), bool_and(r.selfie_path IS NOT NULL),
               bool_and(EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ponto-selfies' AND o.name = r.selfie_path)),
               bool_and(r.dia_civil = '${hoje}')
          FROM public.ponto_registros r JOIN auth.users u ON u.id = r.usuario_id
         WHERE u.email = '${ana.email}';
      `).trim()
      expect(banco).toBe('1|t|t|t|t')
    })
  })
})

/* ------------------------------------------------------------------ */
/* 5. A Rita, do RH, no computador                                     */
/* ------------------------------------------------------------------ */

test.describe('o painel do RH, no computador', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a Rita entra, cria o PIN e vê no painel a entrada da Ana, com a selfie', async ({ page }) => {
    await test.step('entra com a senha provisória e cria o PIN', async () => {
      await preencherEntrada(page, rita.email, rita.senha)
      await print(page, '20-rita-entra')
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await expect(page).toHaveURL(/\/definir-pin$/)
      await print(page, '21-rita-cria-o-pin')
      await criarPin(page, rita.pin)
    })

    await test.step('quem administra e não bate cai direto no painel, e a Ana está lá', async () => {
      await expect(page).toHaveURL(/\/painel/)
      await expect(page.getByRole('heading', { name: 'Fechamento do período' })).toBeVisible()
      const cartao = page.getByRole('link').filter({ hasText: ana.email })
      await expect(cartao).toContainText(ana.nome)
      await print(page, '22-rita-painel')
      await cartao.click()
    })

    await test.step('o dia da Ana tem a entrada de hoje, em andamento', async () => {
      await expect(page.getByRole('heading', { name: ana.nome })).toBeVisible()
      await expect(page.getByRole('button', { name: `Corrigir a batida das ${horaDaBatida}` })).toBeVisible()
      await expect(page.getByText('Em andamento', { exact: true })).toBeVisible()
      // A página inteira: a tela do mês corrente abre rolada em hoje, e só a
      // janela deixaria de fora o nome da Ana, lá em cima.
      await print(page, '23-rita-dia-da-ana', { inteira: true })
    })

    await test.step('a selfie da batida abre', async () => {
      await page.getByRole('button', { name: `Ver a selfie das ${horaDaBatida}` }).click()
      const visor = page.getByRole('dialog', { name: `Selfie da batida das ${horaDaBatida}` })
      const selfie = visor.getByAltText(`Selfie registrada na batida das ${horaDaBatida}`)
      await conferirSelfieDaAna(selfie)
      await print(page, '24-rita-ve-a-selfie-da-ana')
    })
  })
})
