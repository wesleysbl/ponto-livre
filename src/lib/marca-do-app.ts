import { lerMarca, type MarcaDoApp } from './marca'

/*
 * A marca que as telas mostram: as duas variáveis do build, com os padrões de
 * `marca.ts`.
 *
 * MORA SEPARADA DE `marca.ts` porque lê `import.meta.env`, que só existe no
 * código que o Vite transforma (o app e os testes). `marca.ts` também é lido
 * pelo `vite.config.ts`, que roda no Node, onde `import.meta.env` não existe.
 *
 * As duas chaves vêm escritas uma a uma, e não `import.meta.env` inteiro: no
 * build, o Vite troca cada `import.meta.env.VITE_...` pelo texto da variável, e
 * só o que é usado entra no JavaScript.
 *
 * É lida a cada chamada (é barato) para o teste de tela poder trocar a variável
 * com `vi.stubEnv` sem recarregar os módulos.
 */
export function marcaDoApp(): MarcaDoApp {
  return lerMarca({
    VITE_NOME_DO_APP: import.meta.env.VITE_NOME_DO_APP,
    VITE_SLOGAN_DO_APP: import.meta.env.VITE_SLOGAN_DO_APP,
  })
}
