/*
 * PRAZO PARA UMA PROMESSA QUE PODE NÃO VOLTAR NUNCA.
 *
 * REDE CAÍDA E REDE LENTA SÃO DEFEITOS DIFERENTES
 * Caiu, o navegador conta na hora: o `fetch` rejeita e quem chamou trata. Lenta,
 * não conta nada — a promessa fica pendurada, sem erro, para sempre. É o mesmo
 * defeito da câmera que não abre: `getUserMedia` pode simplesmente não resolver,
 * e quem espera não recebe nem sucesso nem falha. Do lado de fora os dois casos
 * aparecem como um spinner que gira sozinho, e a pessoa não tem nem o que ler
 * nem o que apertar.
 *
 * A MESMA SOLUÇÃO DO PRAZO DAS LEITURAS DA CONTA (`AuthContext`)
 * Lá, `comPrazo` tem esta forma exata — `Promise.race` com um `setTimeout` que
 * resolve com um valor combinado, e `clearTimeout` no `finally` para o relógio
 * não segurar o processo. Esta é a versão em módulo próprio, para a câmera,
 * que precisa dela também. `AuthContext` mantém a dele: é código já provado, e
 * reescrevê-lo para importar daqui seria mexer nele só por estética.
 *
 * O PRAZO NÃO CANCELA A TAREFA — ELE SÓ PARA DE ESPERAR
 * JavaScript não tem como abortar uma promessa alheia. Se a tarefa chegar
 * depois, ela chega; quem chamou é que decide o que fazer com o resultado
 * atrasado (a câmera, por exemplo, apaga a luz desligando as trilhas do fluxo
 * que chegou tarde). Se ela REJEITAR depois, a rejeição já está tratada pelo
 * `race` e não vira "unhandled rejection".
 *
 * REJEIÇÃO ANTES DO PRAZO CONTINUA SENDO REJEIÇÃO. Só o silêncio vira valor.
 */

/**
 * 12 segundos.
 *
 * Mais que o pior caso razoável de uma operação que costuma levar menos de
 * 300 ms, e menos que a paciência de quem está de pé, no corredor, querendo
 * bater o ponto e ir trabalhar. É o mesmo número do prazo das leituras da
 * conta, e mantê-los iguais é de propósito: dois prazos diferentes
 * no mesmo app viram duas explicações diferentes para a mesma espera.
 */
export const PRAZO_PADRAO_MS = 12_000

/**
 * Espera `tarefa` por no máximo `ms`. Estourado o prazo, resolve com
 * `aoEstourar` em vez de continuar esperando.
 *
 * @param aoEstourar o valor que substitui o resultado quando o prazo vence.
 *   Quem chama usa um sentinel (`=== EXPIROU`) quando precisa distinguir, ou um
 *   estado de falha já montado quando não precisa.
 */
export function comPrazo<T>(
  tarefa: PromiseLike<T>,
  aoEstourar: T,
  ms: number = PRAZO_PADRAO_MS,
): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<T>((resolver) => {
    relogio = setTimeout(() => resolver(aoEstourar), ms)
  })
  return Promise.race([tarefa, limite]).finally(() => clearTimeout(relogio))
}
