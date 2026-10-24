/*
 * CONFERE A CONTAGEM DE TESTES ESCRITA NO README
 *
 * O DEFEITO QUE ESTE ARQUIVO SEGURA
 * O README diz, na linha do `npm test`, quantos testes e quantos arquivos de
 * teste o projeto tem. Esse número envelhece calado: cada teste novo o deixa
 * falso, e nada quebra. Basta um arquivo de teste novo para a linha ficar
 * errada sem ninguém voltar ao README.
 *
 * O QUE ELE FAZ
 * Pergunta ao próprio Vitest quantos testes existem (`vitest list`, que coleta
 * os testes sem rodá-los, com a mesma configuração do `npm test`) e compara
 * com a linha do README. Se não bater, sai com erro e diz a linha certa. Roda
 * no CI Conferir, logo depois do `npm test`.
 *
 * POR QUE NÃO É UM TESTE DO VITEST
 * Os testes de `src/` passam pelo `tsc` do app, que não tem os tipos do Node
 * (`tsconfig.app.json` só carrega os de `vite/client`): um teste de lá não
 * abre outro processo. E nenhum teste sabe quantos testes a rodada inteira tem.
 *
 * Rodar à mão, da raiz do repositório: `node scripts/conferir-readme.mjs`.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
// O `vitest.mjs` é o mesmo executável que o `npm test` chama. O pacote não o
// exporta pelo nome, então o caminho sai do `package.json` dele.
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')

// A lista vai para um arquivo, e não para a saída padrão: um `console.log` no
// topo de algum arquivo de teste sujaria o JSON.
const pasta = mkdtempSync(join(tmpdir(), 'conferir-readme-'))
let testes
try {
  const arquivoDaLista = join(pasta, 'testes.json')
  execFileSync(process.execPath, [vitest, 'list', `--json=${arquivoDaLista}`], {
    cwd: raiz,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  testes = JSON.parse(readFileSync(arquivoDaLista, 'utf8'))
} finally {
  rmSync(pasta, { recursive: true, force: true })
}

const total = testes.length
const arquivos = new Set(testes.map((teste) => teste.file)).size

const LINHA_DO_README = /^npm test\s+#\s*(\d+) testes, (\d+) arquivos\s*$/m
const achado = readFileSync(join(raiz, 'README.md'), 'utf8').match(LINHA_DO_README)
const linhaCerta = `npm test          # ${total} testes, ${arquivos} arquivos`

if (!achado) {
  console.error(
    'README.md: não achei a linha do `npm test` com a contagem ' +
      '("npm test  # N testes, M arquivos"), na seção "Testes".\n' +
      `Com a contagem de hoje, ela fica assim:\n\n    ${linhaCerta}\n`,
  )
  process.exit(1)
}

const testesNoReadme = Number(achado[1])
const arquivosNoReadme = Number(achado[2])

if (testesNoReadme !== total || arquivosNoReadme !== arquivos) {
  console.error(
    `README.md diz "${testesNoReadme} testes, ${arquivosNoReadme} arquivos", ` +
      `mas o Vitest acha ${total} testes em ${arquivos} arquivos.\n` +
      `Troque a linha do \`npm test\` na seção "Testes" por:\n\n    ${linhaCerta}\n`,
  )
  process.exit(1)
}

console.log(`README.md confere com o Vitest: ${total} testes, ${arquivos} arquivos.`)
