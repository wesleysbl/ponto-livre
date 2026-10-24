import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { RAIZ } from './apoio.ts'

/*
 * OS PRINTS DO CADASTRO, SÓ COM `PRINTS=1`.
 *
 * `PRINTS=1 npm run e2e` grava um print por passo do cadastro em
 * `docs/imagens/cadastro/NN-descricao.png` — as imagens do guia de cadastro.
 * Sem a variável, o teste não grava nada na pasta do projeto: os resultados
 * do Playwright vão para a pasta temporária do sistema (ver
 * `playwright.config.ts`).
 *
 * Para prints de uma instalação nova, rode antes `npm run db:zerar`: com o
 * banco de execuções anteriores, as listas mostram as pessoas delas também.
 */

export const PRINTS = process.env.PRINTS === '1'

export const PASTA_DOS_PRINTS = join(RAIZ, 'docs', 'imagens', 'cadastro')

/**
 * O print do passo. `inteira`: a página toda, rolando (a administração, que é
 * longa); `elemento`: só ele, inteiro, mesmo que passe da altura da janela (a
 * lista de pessoas com uma linha aberta); sem nenhum dos dois, só o que cabe na
 * tela — é o caso das caixas, que ficam presas no meio da janela.
 *
 * Antes do print, o mouse sai de cima de tudo e o campo que acabou de ser
 * preenchido perde o foco: sem isso, o clique anterior deixaria o mouse parado
 * em cima de uma tecla do PIN, que sairia no print com a cor de "passando por
 * cima", e o campo de data sairia com o dia selecionado.
 */
export async function print(
  pagina: Page,
  nome: string,
  { inteira = false, elemento, altura }: { inteira?: boolean; elemento?: Locator; altura?: number } = {},
): Promise<void> {
  if (!PRINTS) return
  await pagina.mouse.move(0, 0)
  await pagina.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const caminho = join(PASTA_DOS_PRINTS, `${nome}.png`)
  if (elemento) {
    await elemento.screenshot({ path: caminho, animations: 'disabled' })
    return
  }
  // `altura`: a janela cresce só para este print. É o caso da caixa mais alta
  // do cadastro (a ficha nova): presa no meio da janela, ela rola por dentro, e
  // a página inteira não a mostraria inteira.
  const janela = pagina.viewportSize()
  if (altura && janela) await pagina.setViewportSize({ width: janela.width, height: altura })
  await pagina.screenshot({ path: caminho, fullPage: inteira, animations: 'disabled' })
  if (altura && janela) await pagina.setViewportSize(janela)
}
