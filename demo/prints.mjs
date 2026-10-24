/*
 * OS PRINTS DA DEMONSTRAÇÃO: `npm run demo:prints`
 *
 * Roda o roteiro `e2e/demonstracao.spec.ts` no Chrome da máquina, contra o
 * Supabase local com a demonstração (`npm run demo:semear -- --zerar` antes),
 * e grava em `docs/imagens/` as telas que o README e o manual mostram, mais a
 * capa. O roteiro só existe com DEMO_PRINTS=1 (ver `playwright.config.ts`):
 * este arquivo liga a variável — do jeito que funciona em qualquer sistema,
 * sem o `VAR=1 comando` do shell — e repassa o que vier depois de `--` ao
 * Playwright (`npm run demo:prints -- --headed`, por exemplo).
 *
 * NO FIM, A CONFERÊNCIA DAS IMAGENS: as 19 existem e são desta execução, e
 * cada PNG traz só imagem (os blocos IHDR, IDAT e IEND, sem texto nem data
 * escondidos). A lista é a das imagens que a documentação cita. Numa execução
 * parcial (com argumentos, como `-- --grep capa`, que refaz só a capa), as
 * outras não são exigidas novas.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const PASTA = join(RAIZ, 'docs', 'imagens')

/** As imagens que o README e o docs/MANUAL.md citam pelo nome. */
const IMAGENS = [
  'capa',
  'celular-instalar',
  'celular-entrar',
  'celular-bater',
  'celular-camera',
  'celular-pin',
  'celular-comprovante',
  'celular-sem-localizacao',
  'celular-esqueci-de-bater',
  'celular-espelho',
  'painel',
  'painel-pessoa',
  'corrigir-batida',
  'pedido-pendente',
  'falta-com-atestado',
  'folha',
  'administracao',
  'pessoas',
  'local-de-trabalho',
]

/** Os tipos de bloco de um PNG, na ordem, e as medidas do IHDR. */
function lerPng(caminho) {
  const dados = readFileSync(caminho)
  if (dados.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${caminho} não é PNG`)
  const blocos = []
  for (let posicao = 8; posicao < dados.length; ) {
    const tamanho = dados.readUInt32BE(posicao)
    blocos.push(dados.subarray(posicao + 4, posicao + 8).toString('latin1'))
    posicao += 12 + tamanho
  }
  return { blocos, largura: dados.readUInt32BE(16), altura: dados.readUInt32BE(20), bytes: dados.length }
}

const inicio = Date.now()
const argumentos = process.argv.slice(2)
const completa = argumentos.length === 0
const execucao = spawnSync('npx', ['playwright', 'test', ...argumentos], {
  cwd: RAIZ,
  stdio: 'inherit',
  env: { ...process.env, DEMO_PRINTS: '1' },
})
if (execucao.status !== 0) {
  console.error('\nOS PRINTS NÃO SAÍRAM INTEIROS: o roteiro falhou (veja acima). Lembre: npm run demo:semear -- --zerar antes.')
  process.exit(execucao.status ?? 1)
}

let problemas = 0
let total = 0
console.log('\nImagens em docs/imagens/:')
for (const nome of IMAGENS) {
  const caminho = join(PASTA, `${nome}.png`)
  let png
  try {
    png = lerPng(caminho)
  } catch {
    console.log(`  FALTA  ${nome}.png`)
    problemas++
    continue
  }
  total += png.bytes
  const nova = !completa || statSync(caminho).mtimeMs >= inicio
  const soImagem = png.blocos.every((bloco) => ['IHDR', 'IDAT', 'IEND'].includes(bloco))
  const marca = !nova ? 'VELHA ' : !soImagem ? 'BLOCOS' : 'ok    '
  if (!nova || !soImagem) problemas++
  console.log(`  ${marca} ${`${nome}.png`.padEnd(30)} ${`${png.largura}×${png.altura}`.padStart(10)}  ${(png.bytes / 1024).toFixed(0).padStart(5)} kB`)
}
console.log(`  total: ${(total / 1024 / 1024).toFixed(2)} MB`)
if (problemas > 0) {
  console.error(`\n${problemas} imagem(ns) com problema.`)
  process.exit(1)
}
