import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/*
 * PROTEÇÃO DO `eslint.config.js`
 *
 * O DEFEITO QUE ESTE ARQUIVO SEGURA
 * O banco do ponto mora em `supabase/`, e as Edge Functions de lá são
 * TypeScript para o Deno. Sem um bloco próprio para elas, o bloco do app, que
 * casa com `**\/*.{ts,tsx}`, as pegaria também: uma Edge Function seria
 * conferida como código de NAVEGADOR, com `document` e `localStorage` à
 * vontade, sem o global `Deno` e com as regras de React. Nada quebraria — e é
 * por isso que precisa de teste: se alguém apagar o bloco do Deno ou o `ignores` do bloco do app, o
 * `npm run lint` continua verde e a checagem volta a ser a errada em silêncio.
 *
 * O QUE SE AFIRMA
 * 1. O app (`src/`) continua com o mesmo rigor: React, TypeScript e os globais
 *    do navegador.
 * 2. `supabase/` tem as regras de JavaScript e de TypeScript, os globais do
 *    Deno e nenhuma regra de React.
 * 3. A checagem de lá está LIGADA de verdade: um erro plantado aparece.
 *
 * Os caminhos não precisam existir: o ESLint calcula a configuração pelo nome.
 * O `cwd` padrão do ESLint é o diretório onde o `vitest` roda, a raiz do repo.
 */

const eslint = new ESLint()

const ARQUIVO_DO_APP = 'src/pages/Bater.tsx'
const EDGE_FUNCTION = 'supabase/functions/ponto-contas/index.ts'
const TESTE_DENO = 'supabase/testes/exemplo.test.ts'

function regrasDe(config: { rules?: Record<string, unknown> }): string[] {
  return Object.keys(config.rules ?? {})
}

describe('lint do app', () => {
  it('continua com as regras de React, de TypeScript e os globais do navegador', async () => {
    const config = await eslint.calculateConfigForFile(ARQUIVO_DO_APP)
    const regras = regrasDe(config)
    expect(regras).toContain('react-hooks/rules-of-hooks')
    expect(regras).toContain('react-hooks/exhaustive-deps')
    expect(regras).toContain('react-refresh/only-export-components')
    expect(regras).toContain('@typescript-eslint/no-explicit-any')
    expect(config.languageOptions.globals).toHaveProperty('document')
    expect(config.languageOptions.globals).not.toHaveProperty('Deno')
  })
})

describe('lint de supabase/', () => {
  it.each([EDGE_FUNCTION, TESTE_DENO])(
    '%s usa os globais do Deno, sem React e sem a janela do navegador',
    async (arquivo) => {
      const config = await eslint.calculateConfigForFile(arquivo)
      const regras = regrasDe(config)
      expect(config.languageOptions.globals).toHaveProperty('Deno')
      expect(config.languageOptions.globals).not.toHaveProperty('document')
      expect(config.languageOptions.globals).not.toHaveProperty('window')
      expect(regras.filter((regra) => regra.startsWith('react'))).toEqual([])
      expect(regras).toContain('@typescript-eslint/no-explicit-any')
      expect(regras).toContain('@typescript-eslint/no-unused-vars')
    },
  )

  it('uma Edge Function comum passa limpa', async () => {
    const codigo = [
      "import { createClient } from 'jsr:@supabase/supabase-js@2'",
      '',
      'Deno.serve(async (req: Request) => {',
      "  const url = Deno.env.get('SUPABASE_URL') ?? ''",
      "  const cliente = createClient(url, '', {",
      "    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },",
      '  })',
      "  const { error } = await cliente.rpc('ponto_pode_administrar')",
      '  return new Response(JSON.stringify({ ok: !error }), { status: error ? 403 : 200 })',
      '})',
      '',
    ].join('\n')
    const [resultado] = await eslint.lintText(codigo, { filePath: EDGE_FUNCTION })
    expect(resultado.messages).toEqual([])
  })

  it('a checagem está ligada: um erro plantado aparece', async () => {
    const codigo = 'const sobra: any = 1\nexport {}\n'
    const [resultado] = await eslint.lintText(codigo, { filePath: EDGE_FUNCTION })
    const regras = resultado.messages.map((mensagem) => mensagem.ruleId)
    expect(regras).toContain('@typescript-eslint/no-explicit-any')
    expect(regras).toContain('@typescript-eslint/no-unused-vars')
  })
})
