import { defineConfig } from 'vitest/config'

/*
 * Config dedicada aos testes, separada de `vite.config.ts` de propósito.
 *
 * POR QUE NÃO REAPROVEITAR A CONFIG DO APP
 * `vite.config.ts` carrega os plugins de build (react, tailwind e o da marca).
 * Os testes não precisam de nenhum deles: as regras são funções puras, e as
 * telas são desenhadas pelo próprio React (`renderToString`, ou o jsdom da
 * fumaça), sem CSS. Carregar o maquinário do build só acrescentaria tempo e
 * formas novas de a suíte quebrar por motivo que não é o dela.
 *
 * A MARCA DOS TESTES É SEMPRE A PADRÃO
 * As telas leem VITE_NOME_DO_APP e VITE_SLOGAN_DO_APP, e o Vitest, como o Vite,
 * junta às VITE_* as do `.env` e as do ambiente de quem roda. Sem as duas
 * linhas de `env` abaixo, quem configurasse a própria marca veria testes de
 * tela falharem por causa do nome. Vazias, valem os padrões de
 * `src/lib/marca.ts`; o teste que confere um nome configurado troca a variável
 * com `vi.stubEnv`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    env: {
      VITE_NOME_DO_APP: '',
      VITE_SLOGAN_DO_APP: '',
    },
  },
})
