import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `public/sw.js` é service worker: roda fora da janela, com `self` e
  // `caches`, e não é código do bundle.
  globalIgnores(['dist', 'public/sw.js']),
  {
    files: ['**/*.{ts,tsx}'],
    // `supabase/` é outro runtime (Deno, no servidor do Supabase) e tem o bloco
    // próprio logo abaixo. Sem esta linha, as Edge Functions herdariam os
    // globais do NAVEGADOR (`document`, `localStorage`) e as regras de React.
    // Para o app, nada muda: a configuração calculada para `src/` é a mesma com
    // ou sem esta linha (dá para conferir com `eslint --print-config`), e
    // `src/configuracao-do-lint.test.ts` segura as duas metades.
    ignores: ['supabase/**'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      // `configs.flat.recommended`, e não `configs['recommended-latest']`: na
      // v7 do plugin o segundo ainda vem no formato antigo (`plugins` como
      // array de strings) e o ESLint 9 recusa a configuração inteira.
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // ---------------------------------------------------------------------
    // O BANCO DO PONTO MORA EM `supabase/`
    //
    // Lá ficam as migrations (.sql, que o ESLint não lê) e as Edge Functions,
    // em TypeScript para o Deno. Elas recebem um bloco próprio, e não um
    // `globalIgnores`, porque ignorar a pasta desligaria TODA a checagem do
    // código que roda com a chave de serviço — justamente o que mais precisa
    // dela. Aqui entram as mesmas regras de JavaScript e de TypeScript do app,
    // sem as de React (não há componente no servidor) e com os globais do
    // Deno (`Deno.serve`, `Deno.env`, sem `document` nem `window`).
    //
    // O QUE ESTE BLOCO NÃO FAZ
    // Não confere tipos. O `tsc -b` do build só enxerga `src/` e os dois
    // arquivos de configuração (ver tsconfig.app.json e tsconfig.node.json), e
    // é bom que seja assim: import por `jsr:`/`npm:` e o global `Deno` não
    // existem para o TypeScript do Vite e quebrariam o build do app. A exceção
    // são os módulos PUROS de uma Edge Function, sem `Deno` e sem import de
    // rede: os testes de `src/` os importam, e o `tsc` os confere junto
    // (`src/ponto-contas.test.ts` segura a pureza). O `index.ts` de cada
    // função continua sendo trabalho do `deno check`.
    // ---------------------------------------------------------------------
    files: ['supabase/**/*.{ts,mts,js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.denoBuiltin,
    },
  },
])
