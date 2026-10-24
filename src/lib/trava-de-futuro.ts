/*
 * A RECUSA DA TRAVA DE FUTURO, COM AS PALAVRAS DO APP.
 *
 * O banco recusa batida com horário mais de 1 minuto à frente do
 * relógio dele, na inserção e na correção que muda o horário. A mensagem do
 * gatilho já sai legível ("Horário no futuro: a batida precisa ser de agora ou
 * de antes, e chegou com 21/10/2026 às 08:00 (horário de Brasília). Confira a
 * data e a hora."), para quem lê o texto do banco como veio. O app a reconhece
 * aqui e responde com a frase dele, guardando o horário que o banco recusou —
 * é ele que mostra a quem corrige qual campo errou.
 *
 * Na prática quase nunca chega aqui: o próprio formulário recusa data futura e,
 * para hoje, hora futura (`src/lib/corrigir.ts`). Chega quando o relógio do
 * computador está adiantado, ou quando o dia virou com o formulário aberto.
 *
 * Puro: sem banco, sem tela. Quem chama é `traduzirErro`, em `admin.ts`.
 */

/**
 * A frase do gatilho, com ou sem acento. "Horario declarado no futuro" (a
 * recusa do PEDIDO de batida em atraso, que o colaborador vê) não casa: tem
 * "declarado" no meio, e a tradução dela mora em `batidas.ts`.
 */
const DA_TRAVA = /Hor[aá]rio no futuro/i

/** O horário recusado, como o gatilho o escreve: `21/10/2026 às 08:00`. */
const QUANDO = /(\d{2}\/\d{2}\/\d{4}) [àa]s (\d{2}:\d{2})/

/**
 * A frase do app para a recusa da trava de futuro, ou `null` se a mensagem não
 * é dela. Sem o horário na mensagem, a frase vai sem ele, em vez de inventar um.
 */
export function traduzirHorarioNoFuturo(mensagem: string): string | null {
  if (!DA_TRAVA.test(mensagem)) return null
  const quando = QUANDO.exec(mensagem)
  const recusado = quando ? ` (${quando[1]} às ${quando[2]})` : ''
  return `Esse horário${recusado} está no futuro. A batida precisa ser de agora ou de antes: confira a data e a hora.`
}
