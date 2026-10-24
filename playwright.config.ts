import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { supabaseLocal } from './e2e/apoio.ts'
import { argumentosDaCameraFalsa } from './e2e/camera-falsa.ts'

/*
 * OS TESTES DE PONTA A PONTA: `npm run e2e` (ver `e2e/cadastro.spec.ts`).
 *
 * PRECISAM DE DUAS COISAS NA MÁQUINA:
 *   • o Supabase local LIGADO (`npm run db:iniciar`, com o Docker): o teste
 *     cria contas, fichas e batidas de verdade no banco local;
 *   • o Google Chrome instalado. O Playwright dirige o Chrome da máquina
 *     (`channel: 'chrome'`) e não baixa navegador nenhum. Outro navegador da
 *     família do Chrome: PLAYWRIGHT_CHANNEL=msedge (ou chrome-beta...).
 * `PRINTS=1 npm run e2e` grava um print por passo em docs/imagens/cadastro/.
 *
 * OS PRINTS DA DEMONSTRAÇÃO (`npm run demo:prints`, que liga DEMO_PRINTS=1)
 * trocam a execução inteira: só o projeto `demonstracao` existe
 * (`e2e/demonstracao.spec.ts`), só o servidor de desenvolvimento sobe, e o
 * banco tem de ter a demonstração (`npm run demo:semear`). Sem a variável, o
 * `npm run e2e` de sempre nem enxerga aquele arquivo.
 *
 * O APP SOBE AQUI MESMO, DE DOIS JEITOS, cada um numa porta só dele,
 * apontando para o Supabase local, com a chave publicável lida de
 * `npx supabase status` (nunca impressa) e a marca padrão ("Ponto"): as
 * variáveis do ambiente valem mais que as do `.env` para o Vite, e assim um
 * `.env` apontado para outro projeto não entra no teste.
 *   • projeto `app`: o servidor de desenvolvimento (`vite`), para o cadastro e
 *     a função de contas;
 *   • projeto `csp`: o BUILD de produção (`vite build` + `vite preview`), o
 *     único com a política de conteúdo (a meta no HTML e os cabeçalhos do
 *     `dist/_headers`; ver `vite.config.ts`). Só o `e2e/csp.spec.ts` roda nele.
 *     O build vai para a pasta temporária do sistema, e não para `dist/`.
 *
 * UM TESTE POR VEZ (`workers: 1`): os testes dividem um banco só, e o
 * cadastro é uma história em ordem — o super admin cria a conta antes de a
 * pessoa entrar.
 *
 * NADA DENTRO DO REPOSITÓRIO: o relatório é a lista no terminal, e os
 * resultados (rastro e print das falhas) vão para a pasta temporária do
 * sistema. A exceção são os prints pedidos com PRINTS=1.
 */

const PORTA = 5180
const ENDERECO_DO_APP = `http://127.0.0.1:${PORTA}`
const PORTA_DO_BUILD = 5181
const ENDERECO_DO_BUILD = `http://127.0.0.1:${PORTA_DO_BUILD}`
const PASTA_DO_BUILD = join(tmpdir(), 'ponto-livre-e2e', 'build')
const local = supabaseLocal()

/** As variáveis do app nos dois servidores: o Supabase local e a marca padrão. */
const VARIAVEIS_DO_APP = {
  VITE_SUPABASE_URL: local.urlDaApi,
  VITE_SUPABASE_PUBLISHABLE_KEY: local.chavePublicavel,
  VITE_NOME_DO_APP: '',
  VITE_SLOGAN_DO_APP: '',
}

/** O teste da política roda no build; os outros, no servidor de desenvolvimento. */
const TESTE_DA_POLITICA = /csp\.spec\.ts$/

/** Os prints da demonstração: um roteiro que só roda quando pedido (ver o cabeçalho). */
const TESTE_DA_DEMONSTRACAO = /demonstracao\.spec\.ts$/
const DEMONSTRACAO = process.env.DEMO_PRINTS === '1'

/** O servidor de desenvolvimento: o app de quase todos os testes e dos prints. */
const SERVIDOR_DO_APP = {
  command: `npx vite --host 127.0.0.1 --port ${PORTA} --strictPort`,
  url: `${ENDERECO_DO_APP}/entrar`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: VARIAVEIS_DO_APP,
}

/** O build de produção servido pelo `vite preview`: só o teste da política usa. */
const SERVIDOR_DO_BUILD = {
  // O mesmo `vite build` do `npm run build` (o `tsc -b` de lá não muda o que sai).
  command:
    `npx vite build --outDir "${PASTA_DO_BUILD}" --emptyOutDir` +
    ` && npx vite preview --outDir "${PASTA_DO_BUILD}" --host 127.0.0.1 --port ${PORTA_DO_BUILD} --strictPort`,
  url: `${ENDERECO_DO_BUILD}/entrar`,
  reuseExistingServer: false,
  timeout: 120_000,
  env: VARIAVEIS_DO_APP,
}

export default defineConfig({
  testDir: 'e2e',
  outputDir: join(tmpdir(), 'ponto-livre-e2e', 'resultados'),
  globalSetup: './e2e/preparar.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: ENDERECO_DO_APP,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    // A câmera falsa vale para o navegador inteiro; só a tela de bater a usa.
    launchOptions: { args: argumentosDaCameraFalsa() },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: DEMONSTRACAO
    ? [{ name: 'demonstracao', testMatch: TESTE_DA_DEMONSTRACAO, use: { baseURL: ENDERECO_DO_APP } }]
    : [
        { name: 'app', testIgnore: [TESTE_DA_POLITICA, TESTE_DA_DEMONSTRACAO], use: { baseURL: ENDERECO_DO_APP } },
        { name: 'csp', testMatch: TESTE_DA_POLITICA, use: { baseURL: ENDERECO_DO_BUILD } },
      ],
  webServer: DEMONSTRACAO ? [SERVIDOR_DO_APP] : [SERVIDOR_DO_APP, SERVIDOR_DO_BUILD],
})
