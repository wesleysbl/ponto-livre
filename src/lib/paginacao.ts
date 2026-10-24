/*
 * O LAÇO QUE LÊ TUDO — um só, para as três consultas do painel.
 *
 * O PROBLEMA QUE ELE EXISTE PARA RESOLVER
 * O PostgREST corta a resposta num teto configurado no projeto (o padrão do
 * Supabase é 1000 linhas) e NÃO avisa que cortou. Não vem erro, não vem
 * cabeçalho que a gente esteja lendo: vêm 1000 linhas com cara de resposta
 * inteira. Num relatório de ponto isso é o pior desfecho possível — horas que
 * existem somem do fechamento e ninguém desconfia, porque não há nada na tela
 * dizendo que faltou. Um erro seria melhor que isso.
 *
 * POR QUE ESTE ARQUIVO EM VEZ DE TRÊS LAÇOS
 * Paginar só as batidas, e não as contas nem as correções, não morderia de
 * início — poucas contas, poucas correções —, mas é do tipo de assimetria que
 * envelhece calada: no dia em que uma lista passar de 1000 linhas, metade do
 * painel desaparece sem uma linha de log. Copiar o
 * laço uma terceira vez só espalharia o mesmo `if` para três lugares que
 * poderiam divergir. Aqui ele mora uma vez.
 *
 * POR QUE ELE É PURO — SEM `supabase` IMPORTADO
 * Quem sabe montar a consulta é `admin.ts`; o que este módulo sabe é contar
 * páginas. Sem o cliente do Supabase aqui dentro, o laço roda num teste de Node
 * sem variável de ambiente nenhuma, contra um duplê que corta em 1000 — que é
 * exatamente o comportamento que ninguém consegue reproduzir de propósito
 * contra o banco de verdade sem antes ter 1001 linhas lá.
 *
 * A ORDEM ESTÁVEL É RESPONSABILIDADE DE QUEM CHAMA
 * Paginar sem `ORDER BY` determinístico faz o Postgres ficar livre para
 * devolver as linhas em ordens diferentes a cada página — e aí a página 2
 * repete parte da 1 e pula parte da 3. Toda consulta que passa por aqui ordena
 * por uma coluna única (ou tem uma como desempate).
 */

/** O teto do PostgREST. Uma página cheia é o sinal de que pode haver mais. */
export const TAMANHO_DA_PAGINA = 1000

/**
 * O formato que o supabase-js devolve. Declarado aqui, e não importado, para
 * este módulo não puxar o SDK — o `PostgrestResponse` real encaixa neste
 * formato estruturalmente.
 */
export interface RespostaDePagina<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Lê uma consulta paginada inteira.
 *
 * @param buscarPagina recebe o intervalo fechado de linhas (o que o
 *   `.range(de, ate)` do supabase-js espera) e devolve a resposta daquela
 *   página.
 * @param aoFalhar transforma a mensagem de erro do banco no erro que a tela de
 *   quem chamou sabe mostrar (`ErroDoPainel`, hoje). Fica como parâmetro para
 *   este módulo não conhecer nenhuma tela.
 *
 * A parada é `lote.length < TAMANHO_DA_PAGINA`: página incompleta é a última.
 * Quando o total é múltiplo exato do tamanho da página, isso custa uma consulta
 * a mais, que volta vazia — o preço de não existir contagem confiável sem pedir
 * `count`, que cobra um `COUNT(*)` em toda chamada.
 */
export async function lerTodasAsPaginas<T>(
  buscarPagina: (de: number, ate: number) => PromiseLike<RespostaDePagina<T>>,
  aoFalhar: (mensagem: string) => Error,
): Promise<T[]> {
  const todas: T[] = []

  for (let pagina = 0; ; pagina++) {
    const { data, error } = await buscarPagina(
      pagina * TAMANHO_DA_PAGINA,
      (pagina + 1) * TAMANHO_DA_PAGINA - 1,
    )

    if (error) throw aoFalhar(error.message)

    const lote = data ?? []
    todas.push(...lote)
    if (lote.length < TAMANHO_DA_PAGINA) return todas
  }
}
