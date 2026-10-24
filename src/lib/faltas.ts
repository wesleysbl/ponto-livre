import { supabase } from './supabase'
import { ErroDoPainel } from './admin'
import { lerTodasAsPaginas } from './paginacao'
import {
  caminhoDoAtestado,
  dimensoesReduzidas,
  formatarTamanho,
  planoDoAtestado,
  QUALIDADE_DO_ATESTADO,
  TAMANHO_MAXIMO_DO_ATESTADO,
  TIPO_DA_EXTENSAO,
  validarMotivoDoCancelamento,
  type Ausencia,
  type ExtensaoDoAtestado,
  type TipoDeAusencia,
} from './ausencias'
import type { Periodo } from './periodo'

/*
 * A CONVERSA COM AS AUSÊNCIAS E COM O BUCKET DE ATESTADOS. As regras e os
 * rótulos, puros, moram em `ausencias.ts`.
 *
 * QUEM PODE O QUÊ É A RLS, NÃO ESTE ARQUIVO
 *   SELECT ponto_ausencias   admin do ponto lê todas; a pessoa, com acesso ao
 *                            ponto, lê as próprias
 *   INSERT ponto_ausencias   só admin, e só as colunas
 *                            id, usuario_id, dia_inicio, dia_fim, tipo,
 *                            observacao, atestado_path (privilégio por coluna)
 *   UPDATE ponto_ausencias   só admin, e só `motivo_cancelamento`
 *   DELETE                   ninguém (nem policy, nem privilégio, e um gatilho
 *                            recusa para todo papel)
 *   bucket ponto-atestados   admin sobe no caminho combinado; admin lê tudo; a
 *                            pessoa lê a própria pasta; NINGUÉM sobrescreve ou
 *                            apaga (sem policy de UPDATE nem de DELETE)
 *
 * O QUE O GATILHO FAZ SOZINHO, E QUE ESTE MÓDULO NÃO REPETE
 * `ponto_ausencias_guardar` carimba quem lançou e quando, confere período,
 * tipo, sobreposição com outra ausência ativa e — quando há atestado — que o
 * arquivo EXISTE no bucket, no caminho combinado, com o tipo batendo com a
 * extensão. No cancelamento, carimba quem cancelou e quando. Nada disso vai
 * daqui: autor escrito pelo cliente é autor que o cliente pode inventar.
 */

/** Colunas explícitas, numa linha só (senão o supabase-js perde a tipagem). */
const COLUNAS_DA_AUSENCIA =
  'id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path, lancado_por, lancado_em, cancelada_em, cancelada_por, motivo_cancelamento'

const BUCKET = 'ponto-atestados'

/**
 * Quanto tempo vive o link do atestado. Dois minutos, como a selfie
 * (`SEGUNDOS_DE_VALIDADE_DA_SELFIE`), e pela mesma razão: o link assinado é uma
 * chave ao portador, e o conteúdo aqui é ainda mais sensível que um rosto — é
 * um documento médico. Cada abertura assina de novo.
 */
export const SEGUNDOS_DE_VALIDADE_DO_ATESTADO = 120

/**
 * As recusas do gatilho e do storage, pelas frases do banco. O
 * que não é próprio da ausência — sessão, RLS, rede — cai na tradução do
 * painel.
 */
function traduzirErro(mensagem: string): string {
  if (/Ja existe ausencia ativa desta pessoa em parte deste periodo/.test(mensagem)) {
    return 'Já existe uma ausência lançada para esta pessoa em parte deste período. Para corrigir, cancele a anterior (com motivo) e lance de novo.'
  }
  if (/Periodo invertido/.test(mensagem)) {
    return 'O dia final não pode ser antes do inicial.'
  }
  if (/Periodo longo demais/.test(mensagem)) {
    return 'Uma ausência cobre no máximo 120 dias. Lance o período em partes.'
  }
  if (/Periodo fora da janela aceita/.test(mensagem)) {
    return 'O período tem de estar entre um ano atrás e um ano à frente. Confira o ano digitado.'
  }
  if (/Ausencia exige o dia inicial e o dia final/.test(mensagem)) {
    return 'Informe o dia inicial e o dia final.'
  }
  if (/Ausencia do tipo outro exige observacao/.test(mensagem)) {
    return 'No tipo “outro motivo”, escreva a observação — é ela que explica a falta na folha.'
  }
  if (/Tipo de ausencia invalido/.test(mensagem)) {
    return 'Escolha o tipo da ausência.'
  }
  if (/Atestado nao encontrado no bucket/.test(mensagem)) {
    return 'O atestado não chegou inteiro ao servidor. Tente lançar de novo.'
  }
  if (/Atestado com tipo de arquivo/.test(mensagem)) {
    return 'O arquivo do atestado não bate com o tipo informado. Escolha o arquivo de novo.'
  }
  if (/Caminho do atestado fora da convencao/.test(mensagem)) {
    return 'O atestado não foi guardado no lugar certo. Feche esta caixa e lance de novo.'
  }
  if (/Pessoa nao encontrada/.test(mensagem)) {
    return 'Esta pessoa não tem conta de login. A ausência precisa ser de uma conta existente.'
  }
  if (/Ausencia ja cancelada/.test(mensagem)) {
    return 'Esta ausência já foi cancelada — o cancelamento é definitivo. A lista foi atualizada.'
  }
  if (/Cancelar ausencia exige motivo/.test(mensagem)) {
    return 'Escreva o motivo do cancelamento — ele fica guardado com o seu nome.'
  }
  // A tentativa anterior gravou, mas a resposta se perdeu (rede caiu no meio):
  // o mesmo id bate na chave primária. Nada se duplicou.
  if (/ponto_ausencias_pkey/.test(mensagem)) {
    return 'Esta ausência já tinha sido gravada na tentativa anterior. Feche esta caixa e confira a lista.'
  }
  // As duas abaixo o app nunca provoca (ele não manda cancelamento no INSERT
  // nem apaga); se aparecerem, é chamada de fora da tela — mesmo assim, em
  // português.
  if (/Ausencia nao nasce cancelada/.test(mensagem)) {
    return 'A ausência não pode nascer cancelada: lance primeiro e cancele depois, com motivo.'
  }
  if (/ausencia lancada nao se apaga nem se esvazia/.test(mensagem)) {
    return 'Ausência lançada não se apaga. Para tirá-la da folha, cancele com motivo.'
  }
  if (/Ausencia lancada nao muda/.test(mensagem)) {
    return 'Ausência lançada não muda: só pode ser cancelada, com motivo. Para corrigir, cancele e lance de novo.'
  }
  if (/ponto_ausencias_observacao_preenchida_e_curta/.test(mensagem)) {
    return 'A observação pode ter no máximo 1000 caracteres.'
  }
  if (/ponto_ausencias_motivo_cancelamento_curto/.test(mensagem)) {
    return 'O motivo do cancelamento pode ter no máximo 500 caracteres.'
  }
  if (/So admin do ponto lanca ou cancela ausencia|Ausencia exige sessao de admin do ponto/.test(mensagem)) {
    return 'Só quem administra o ponto lança ou cancela ausência. Entre de novo; se persistir, peça a alguém da lista para conceder a administração.'
  }
  if (/exceeded the maximum|payload too large|entity too large/i.test(mensagem)) {
    return 'O arquivo do atestado passa de 10 MB. Tire uma foto do atestado ou digitalize com resolução menor.'
  }
  if (/mime type .* is not supported|invalid_mime_type/i.test(mensagem)) {
    return 'O atestado tem de ser uma foto (JPEG, PNG, WebP ou HEIC) ou um PDF.'
  }
  /*
   * Assinatura recusada: o storage responde a mesma coisa para "não existe" e
   * para "existe, mas não é seu" — a policy de SELECT esconde a linha. Uma
   * frase só para os dois, como na selfie.
   */
  if (/object not found|not_found/i.test(mensagem)) {
    return 'Este atestado não está disponível para você.'
  }
  // O UPDATE do cancelamento que não acha a linha (ou que a RLS esconde) volta
  // como "nenhuma linha" do `.single()`. A frase do painel diria "batida".
  if (/JSON object requested|multiple \(or no\) rows|PGRST116/i.test(mensagem)) {
    return 'Esta ausência não foi encontrada. Recarregue a lista e tente de novo.'
  }
  return new ErroDoPainel(mensagem).message
}

/** Erro das ausências, já traduzido para a tela. */
export class ErroDaAusencia extends Error {
  constructor(mensagem: string) {
    super(traduzirErro(mensagem))
    this.name = 'ErroDaAusencia'
  }
}

const traduzir = (mensagem: string) => new ErroDaAusencia(mensagem)

/* ------------------------------------------------------------------ */
/* Leituras                                                            */
/* ------------------------------------------------------------------ */

/**
 * As ausências que TOCAM um período (de todo mundo ou de uma pessoa),
 * canceladas inclusive — a lista do admin mostra quem cancelou e por quê; o
 * espelho, a folha e o CSV filtram com `ausenciasPorDia`, que só conta as
 * ativas.
 *
 * "Tocam" e não "começam": um atestado de 28/09 a 02/10 é de outubro também.
 * Por isso o filtro é de sobreposição (`dia_inicio <= fim` e `dia_fim >=
 * inicio`), e o recorte dia a dia é de `ausenciasPorDia`.
 *
 * PAGINA, como todas as leituras do painel: o PostgREST corta calado.
 */
export async function lerAusenciasDoPeriodo(periodo: Periodo, usuarioId?: string): Promise<Ausencia[]> {
  const linhas = await lerTodasAsPaginas((de, ate) => {
    const consulta = supabase
      .from('ponto_ausencias')
      .select(COLUNAS_DA_AUSENCIA)
      .lte('dia_inicio', periodo.fim)
      .gte('dia_fim', periodo.inicio)
      .order('dia_inicio', { ascending: true })
      .order('id', { ascending: true })
      .range(de, ate)
    return usuarioId ? consulta.eq('usuario_id', usuarioId) : consulta
  }, traduzir)
  return linhas as unknown as Ausencia[]
}

/* ------------------------------------------------------------------ */
/* O atestado: compressão no aparelho, envio e link                    */
/* ------------------------------------------------------------------ */

/** O arquivo pronto para subir: o conteúdo, a extensão e o tipo que batem. */
export interface AtestadoPronto {
  conteudo: Blob
  extensao: ExtensaoDoAtestado
  tipo: string
  /**
   * Refeito em JPEG no aparelho (toda imagem que o navegador abre), ou foi como
   * veio (PDF, ou imagem que o navegador não abre). Refeito não quer dizer
   * menor: a refeita pode sair uns kB maior, e sobe assim mesmo (ver
   * `prepararAtestado`). Quem diz se diminuiu é `resumoDoAtestado`.
   */
  comprimido: boolean
  tamanhoOriginal: number
}

/**
 * A linha da caixa de lançar falta sobre o arquivo escolhido:
 *  • "reduzida de 4,8 MB para 412 KB" só quando o arquivo de fato ficou menor,
 *    e a diferença aparece na tela (nada de "reduzida de 69 KB para 69 KB");
 *  • refeita e não menor, "convertida para JPG · 73 KB", sem prometer redução;
 *  • o que vai como veio (PDF, imagem que o navegador não abre), o formato e o
 *    tamanho: "PDF · 781 KB".
 */
export function resumoDoAtestado(atestado: AtestadoPronto): string {
  const formato = atestado.extensao.toUpperCase()
  const depois = formatarTamanho(atestado.conteudo.size)
  if (!atestado.comprimido) return `${formato} · ${depois}`
  const antes = formatarTamanho(atestado.tamanhoOriginal)
  if (atestado.conteudo.size < atestado.tamanhoOriginal && antes !== depois) {
    return `reduzida de ${antes} para ${depois}`
  }
  return `convertida para ${formato} · ${depois}`
}

/** Abre a imagem no navegador. `null` quando ele não sabe ler o formato. */
async function abrirImagem(arquivo: Blob): Promise<{ fonte: CanvasImageSource; largura: number; altura: number; fechar: () => void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` respeita a rotação gravada pela câmera (EXIF): sem isso,
      // o atestado fotografado em pé sobe deitado.
      const bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
      return { fonte: bitmap, largura: bitmap.width, altura: bitmap.height, fechar: () => bitmap.close() }
    } catch {
      /* Cai no <img> abaixo — o Safari antigo não abre HEIC por aqui. */
    }
  }
  const url = URL.createObjectURL(arquivo)
  try {
    const imagem = new Image()
    imagem.src = url
    await imagem.decode()
    return { fonte: imagem, largura: imagem.naturalWidth, altura: imagem.naturalHeight, fechar: () => {} }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Prepara o atestado escolhido: refaz a foto no aparelho (canvas, como a
 * selfie) e deixa o PDF como veio. Ver `planoDoAtestado` e
 * `LADO_MAXIMO_DO_ATESTADO`, em `ausencias.ts`.
 *
 * A COMPRESSÃO NÃO MUDA O QUE O DOCUMENTO DIZ: ela reduz pixels, não corta,
 * não gira à mão, não aplica filtro. É a mesma foto, menor.
 *
 * TODA IMAGEM QUE O NAVEGADOR ABRE SOBE REFEITA, MESMO QUE SAIA MAIOR. O
 * arquivo original de uma foto de celular leva os metadados da câmera (o
 * EXIF): o aparelho, a data e, muitas vezes, o GPS de onde ela foi tirada —
 * não raro, a casa da pessoa. Atestado é dado de saúde, dado sensível na LGPD
 * (art. 5º, II), e o princípio da necessidade (art. 6º, III) pede o mínimo: a
 * localização de quem fotografou não justifica falta nenhuma. O JPEG refeito
 * não leva nada disso: o canvas só guarda os pixels. Por isso o original não
 * sobe "porque ficaria menor": o JPEG pequeno que chegou pelo WhatsApp,
 * refeito em JPEG 0,85, pode sair uns kB maior, e sobe assim mesmo. A tela só
 * não chama isso de redução (`resumoDoAtestado`). O teste "sobe a refeita,
 * nunca o original", em `faltas.test.ts`, segura a regra.
 *
 * Imagem que o navegador não abre (HEIC fora do Safari) sobe como está, se
 * couber nos 10 MB — o bucket aceita HEIC. Se não couber, a tela diz. Essa
 * vai com os metadados que tiver: sem abrir a imagem, não há como tirá-los.
 */
export async function prepararAtestado(arquivo: File): Promise<AtestadoPronto> {
  const plano = planoDoAtestado(arquivo.type, arquivo.name, arquivo.size)
  if (plano.acao === 'recusar') throw new ErroDaAusencia(plano.erro)
  if (plano.acao === 'enviar') {
    return { conteudo: arquivo, extensao: 'pdf', tipo: TIPO_DA_EXTENSAO.pdf, comprimido: false, tamanhoOriginal: arquivo.size }
  }

  const comoVeio = (): AtestadoPronto => {
    if (arquivo.size > TAMANHO_MAXIMO_DO_ATESTADO) {
      throw new ErroDaAusencia(
        'Este navegador não conseguiu abrir a foto para reduzir, e ela passa de 10 MB. Tire a foto pelo botão da câmera, ou envie em JPEG.',
      )
    }
    return {
      conteudo: arquivo,
      extensao: plano.extensao,
      tipo: TIPO_DA_EXTENSAO[plano.extensao],
      comprimido: false,
      tamanhoOriginal: arquivo.size,
    }
  }

  const imagem = await abrirImagem(arquivo)
  if (!imagem) return comoVeio()

  try {
    const alvo = dimensoesReduzidas(imagem.largura, imagem.altura)
    const tela = document.createElement('canvas')
    tela.width = alvo.largura
    tela.height = alvo.altura
    const pincel = tela.getContext('2d')
    if (!pincel || alvo.largura === 0) return comoVeio()
    // Fundo branco: PNG com transparência viraria fundo PRETO no JPEG, e o
    // texto preto do atestado sumiria nele.
    pincel.fillStyle = '#ffffff'
    pincel.fillRect(0, 0, alvo.largura, alvo.altura)
    pincel.drawImage(imagem.fonte, 0, 0, alvo.largura, alvo.altura)

    const comprimida = await new Promise<Blob | null>((resolver) =>
      tela.toBlob(resolver, 'image/jpeg', QUALIDADE_DO_ATESTADO),
    )
    if (!comprimida) return comoVeio()
    // A refeita sobe mesmo maior que o original: ver o comentário da função.
    return {
      conteudo: comprimida,
      extensao: 'jpg',
      tipo: TIPO_DA_EXTENSAO.jpg,
      comprimido: true,
      tamanhoOriginal: arquivo.size,
    }
  } finally {
    imagem.fechar()
  }
}

/**
 * Link temporário para o atestado. Quem decide quem vê é a policy do bucket
 * (admin, ou o dono da pasta) — não há checagem de dono aqui, pelo mesmo
 * motivo de `urlAssinadaDaSelfie`.
 */
export async function urlAssinadaDoAtestado(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(caminho, SEGUNDOS_DE_VALIDADE_DO_ATESTADO)
  if (error) throw new ErroDaAusencia(error.message)
  if (!data?.signedUrl) throw new ErroDaAusencia('Este atestado não está disponível para você.')
  return data.signedUrl
}

/** "Já existe" do storage: o mesmo arquivo subiu numa tentativa anterior. */
function jaExiste(mensagem: string): boolean {
  return /already exists|duplicate/i.test(mensagem)
}

/* ------------------------------------------------------------------ */
/* Lançar e cancelar                                                   */
/* ------------------------------------------------------------------ */

export interface DadosDoLancamento {
  /**
   * O id da ausência, sorteado pela TELA e guardado entre as tentativas: ele dá
   * nome ao arquivo (`{usuario_id}/{id}.jpg`) e o bucket não deixa
   * sobrescrever. Tentar de novo com o MESMO id faz o envio responder "já
   * existe" e a gravação seguir com o arquivo que já subiu. Trocou o arquivo?
   * A tela sorteia outro id — senão o arquivo velho é que ficaria anexado.
   */
  id: string
  usuarioId: string
  diaInicio: string
  diaFim: string
  tipo: TipoDeAusencia
  observacao: string | null
  atestado: AtestadoPronto | null
}

/**
 * Sobe o atestado (se houver) e grava a ausência — nesta ordem, porque o
 * gatilho exige que o arquivo já esteja no bucket.
 *
 * SEM DESCARTE, AO CONTRÁRIO DA SELFIE. O bucket não tem policy de DELETE: o
 * arquivo que subiu e cuja ausência não foi gravada (sobreposição, período
 * errado) FICA. É o preço de "ninguém apaga atestado", e a tela diminui a
 * chance conferindo as regras ANTES de subir (`validarLancamento`).
 */
export async function lancarAusencia(dados: DadosDoLancamento): Promise<Ausencia> {
  if (navigator.onLine === false) {
    throw new ErroDaAusencia('Sem conexão com o servidor. Verifique a internet e tente de novo.')
  }

  let atestadoPath: string | null = null
  if (dados.atestado) {
    atestadoPath = caminhoDoAtestado(dados.usuarioId, dados.id, dados.atestado.extensao)
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(atestadoPath, dados.atestado.conteudo, { contentType: dados.atestado.tipo, upsert: false })
    if (error && !jaExiste(error.message)) throw new ErroDaAusencia(error.message)
  }

  const { data, error } = await supabase
    .from('ponto_ausencias')
    .insert({
      id: dados.id,
      usuario_id: dados.usuarioId,
      dia_inicio: dados.diaInicio,
      dia_fim: dados.diaFim,
      tipo: dados.tipo,
      observacao: dados.observacao,
      atestado_path: atestadoPath,
    })
    .select(COLUNAS_DA_AUSENCIA)
    .single()

  if (error) {
    /*
     * A TENTATIVA ANTERIOR PODE TER GRAVADO. Se a rede caiu depois do INSERT e
     * antes da resposta, tentar de novo com o MESMO id não bate na chave
     * primária: o gatilho roda antes dela e acha a própria ausência como
     * "sobreposta". Dizer "cancele a anterior" levaria o admin a cancelar a
     * falta certa. Por isso, na sobreposição, olha se a linha deste id já
     * existe — se existe, foi esta tentativa que gravou, e é sucesso.
     */
    if (/Ja existe ausencia ativa desta pessoa em parte deste periodo/.test(error.message)) {
      const jaGravada = await lerAusenciaPorId(dados.id)
      if (jaGravada) return jaGravada
    }
    throw new ErroDaAusencia(error.message)
  }
  return data as unknown as Ausencia
}

/** A ausência deste id, ou `null` (não existe, ou a leitura falhou). */
async function lerAusenciaPorId(id: string): Promise<Ausencia | null> {
  const { data, error } = await supabase
    .from('ponto_ausencias')
    .select(COLUNAS_DA_AUSENCIA)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as Ausencia
}

/**
 * Cancela uma ausência, com motivo. O UPDATE manda SÓ `motivo_cancelamento` —
 * o único privilégio de coluna que o app tem; quem cancelou e quando, o
 * gatilho carimba. Cancelada é para sempre.
 */
export async function cancelarAusencia(entrada: { ausenciaId: string; motivo: string }): Promise<Ausencia> {
  const motivo = validarMotivoDoCancelamento(entrada.motivo)
  if (!motivo.ok) throw new ErroDaAusencia(motivo.erro)

  const { data, error } = await supabase
    .from('ponto_ausencias')
    .update({ motivo_cancelamento: motivo.motivo })
    .eq('id', entrada.ausenciaId)
    .select(COLUNAS_DA_AUSENCIA)
    .single()

  if (error) throw new ErroDaAusencia(error.message)
  return data as unknown as Ausencia
}
