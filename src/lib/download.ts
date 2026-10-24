/*
 * BAIXAR UM ARQUIVO SEM SERVIDOR NENHUM.
 *
 * Este PWA é estático: não existe rota que devolva `Content-Disposition`. O que
 * existe é o navegador — um Blob em memória, uma URL temporária apontando para
 * ele e uma âncora com `download`. É o caminho padrão, e o único disponível.
 *
 * POR QUE A FUNÇÃO É TÃO PEQUENA E MESMO ASSIM MORA SOZINHA
 * Porque ela é a única parte impura da exportação. `csv.ts` gera o texto e é
 * testado de ponta a ponta; aqui só se entrega o texto ao navegador. Misturar
 * as duas coisas tornaria o CSV intestável, que é exatamente o que não pode
 * acontecer com um arquivo que só é conferido na mesa da contabilidade.
 *
 * O `charset=utf-8` do MIME e o BOM que `csv.ts` põe no começo do conteúdo
 * dizem a mesma coisa por dois caminhos. Os dois são necessários: o MIME
 * orienta o navegador, e o BOM é o que o Excel do Windows lê ao abrir o arquivo
 * já salvo em disco, quando o MIME não existe mais.
 */

export function baixarTexto(conteudo: string, nomeDoArquivo: string, tipoMime: string): void {
  const blob = new Blob([conteudo], { type: tipoMime })
  const url = URL.createObjectURL(blob)

  const ancora = document.createElement('a')
  ancora.href = url
  ancora.download = nomeDoArquivo
  document.body.appendChild(ancora)
  ancora.click()
  ancora.remove()

  /*
   * A URL temporária segura o Blob inteiro na memória da aba até ser revogada,
   * e um fechamento de mês pode ter alguns megabytes. Revogar no mesmo tique
   * cancelaria o download em alguns navegadores, que ainda estão lendo o Blob;
   * o próximo tique é tarde o bastante para o download ter começado e cedo o
   * bastante para a memória não ficar presa.
   */
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** O CSV do painel. O tipo declara o charset; o BOM está dentro do conteúdo. */
export function baixarCsv(conteudo: string, nomeDoArquivo: string): void {
  baixarTexto(conteudo, nomeDoArquivo, 'text/csv;charset=utf-8')
}
