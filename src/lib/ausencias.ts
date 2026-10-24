/*
 * AS AUSÊNCIAS COM ATESTADO — as regras, os rótulos e a costura com o mês, sem
 * rede e sem React (no banco, `ponto_ausencias` e o bucket dos atestados).
 *
 * O QUE É: o admin lança uma falta justificada — um dia ou um período, o tipo,
 * uma observação e, se houver, o atestado (foto ou PDF). A ausência mora em
 * `ponto_ausencias`, ao lado das batidas, e NÃO É BATIDA: não tem horário, não
 * entra na ordem do dia e não muda conta nenhuma.
 *
 * ⚠ A SOMA DE HORAS DO MÊS NÃO MUDA POR CAUSA DE UMA AUSÊNCIA. É a regra que
 * este módulo existe para segurar. O espelho, o painel, a folha e o CSV
 * continuam somando as MESMAS batidas, por `horas.ts`; a ausência só ACRESCENTA
 * a marca do dia. Saldo e abono são assunto da folha — a ausência já fica
 * pronta para ser lida por eles, mas hoje ela não abona nada.
 *
 * QUEM DECIDE É O BANCO. As regras de `validarLancamento` são as MESMAS do
 * gatilho `ponto_ausencias_guardar`, repetidas aqui para a tela recusar antes
 * de subir o atestado (que, uma vez no bucket, não sai mais). Se as duas
 * divergirem, quem manda é o gatilho, e a tela traduz a recusa:
 *   • o dia final não vem antes do inicial;
 *   • no máximo 120 dias contando o primeiro e o último;
 *   • de um ano atrás a um ano à frente (366 dias) — o "2062" da digitação;
 *   • `outro` exige observação; observação até 1000 caracteres;
 *   • cancelar exige motivo, até 500 caracteres.
 *
 * AUSÊNCIA CANCELADA NÃO MARCA DIA NENHUM. Ela continua guardada (nada se
 * apaga), aparece na lista do admin com quem cancelou e por quê — e some do
 * espelho, da folha e do CSV.
 */

/* ------------------------------------------------------------------ */
/* A ausência, como o banco a guarda                                   */
/* ------------------------------------------------------------------ */

export type TipoDeAusencia = 'atestado_medico' | 'falta_justificada' | 'outro'

/** Uma linha de `ponto_ausencias`, com as colunas que o app lê. */
export interface Ausencia {
  id: string
  usuario_id: string
  /** Dias civis no fuso do ponto (`AAAA-MM-DD`), inclusive nas duas pontas. */
  dia_inicio: string
  dia_fim: string
  tipo: TipoDeAusencia
  observacao: string | null
  /** `{usuario_id}/{id}.{jpg|jpeg|png|webp|heic|pdf}` no bucket `ponto-atestados`. */
  atestado_path: string | null
  /** Carimbados pelo banco: o app não manda. */
  lancado_por: string
  lancado_em: string
  /** Os três juntos ou nenhum (CHECK do banco). */
  cancelada_em: string | null
  cancelada_por: string | null
  motivo_cancelamento: string | null
}

export const TIPOS_DE_AUSENCIA: readonly TipoDeAusencia[] = [
  'atestado_medico',
  'falta_justificada',
  'outro',
]

export const ROTULO_DO_TIPO_DE_AUSENCIA: Record<TipoDeAusencia, string> = {
  atestado_medico: 'Atestado médico',
  falta_justificada: 'Falta justificada',
  outro: 'Outro motivo',
}

/** Os limites do gatilho e dos CHECKs de `ponto_ausencias`. */
export const PERIODO_MAXIMO_EM_DIAS = 120
export const JANELA_EM_DIAS = 366
export const OBSERVACAO_MAXIMA = 1000
export const MOTIVO_DO_CANCELAMENTO_MAXIMO = 500
/** O teto do bucket `ponto-atestados` (10 MB). */
export const TAMANHO_MAXIMO_DO_ATESTADO = 10 * 1024 * 1024

/* ------------------------------------------------------------------ */
/* Dias                                                                */
/* ------------------------------------------------------------------ */

const FORMATO_DO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/
const UM_DIA_MS = 86_400_000

/**
 * O dia como número de dias desde 1970, em UTC. A conta é de CALENDÁRIO, e não
 * de relógio: um dia civil não tem fuso, e somar 24 h num `Date` local erraria
 * na troca do horário de verão de quem tiver o aparelho num fuso que ainda o
 * usa. `null` para texto que não é dia de verdade (31 de fevereiro incluso).
 */
function numeroDoDia(dia: string): number | null {
  const casou = FORMATO_DO_DIA.exec(dia)
  if (!casou) return null
  const ms = Date.UTC(Number(casou[1]), Number(casou[2]) - 1, Number(casou[3]))
  if (new Date(ms).toISOString().slice(0, 10) !== dia) return null
  return ms / UM_DIA_MS
}

function diaDoNumero(numero: number): string {
  return new Date(numero * UM_DIA_MS).toISOString().slice(0, 10)
}

/** `2026-10-31` + 1 = `2026-11-01`. Levanta para dia inválido. */
export function somarDias(dia: string, dias: number): string {
  const numero = numeroDoDia(dia)
  if (numero === null) throw new Error(`Dia inválido: "${dia}". O formato é AAAA-MM-DD.`)
  return diaDoNumero(numero + dias)
}

/** `fim - inicio` em dias — a mesma conta do `dia_fim - dia_inicio` do banco. */
export function diferencaEmDias(inicio: string, fim: string): number {
  const a = numeroDoDia(inicio)
  const b = numeroDoDia(fim)
  if (a === null || b === null) throw new Error(`Dia inválido: "${a === null ? inicio : fim}".`)
  return b - a
}

/**
 * Os dias de um período, das duas pontas inclusive: um atestado de 3 dias é
 * UMA ausência e TRÊS dias marcados. Período invertido devolve lista vazia —
 * quem o recusa com frase é `validarLancamento`, e quem o impede de existir é
 * o CHECK do banco.
 */
export function diasDoPeriodo(inicio: string, fim: string): string[] {
  const a = numeroDoDia(inicio)
  const b = numeroDoDia(fim)
  if (a === null || b === null || b < a) return []
  const dias: string[] = []
  for (let numero = a; numero <= b; numero++) dias.push(diaDoNumero(numero))
  return dias
}

/** Quantos dias o período cobre, das duas pontas inclusive. */
export function duracaoEmDias(ausencia: Pick<Ausencia, 'dia_inicio' | 'dia_fim'>): number {
  return diferencaEmDias(ausencia.dia_inicio, ausencia.dia_fim) + 1
}

/* ------------------------------------------------------------------ */
/* A ausência no mês                                                   */
/* ------------------------------------------------------------------ */

export function ehAtiva(ausencia: Pick<Ausencia, 'cancelada_em'>): boolean {
  return ausencia.cancelada_em === null
}

export interface Recorte {
  inicio: string
  fim: string
}

/**
 * `dia -> ausências ATIVAS que cobrem o dia`, só os dias dentro do recorte.
 *
 * O RECORTE É OBRIGATÓRIO NA PRÁTICA: um atestado de 28/10 a 05/11 é lido
 * pelas duas folhas, e a de outubro não pode listar 1º de novembro debaixo do
 * título "Outubro de 2026" — a mesma garantia que `montarFolha` dá às batidas.
 *
 * A lista de cada dia vem na ordem do lançamento. Duas ausências ativas no
 * mesmo dia o banco não deixa existir (gatilho com trava por pessoa); se um
 * dia acontecer, as duas aparecem, que é melhor do que esconder uma.
 */
export function ausenciasPorDia<T extends Ausencia>(
  ausencias: readonly T[],
  recorte?: Recorte,
): Map<string, T[]> {
  const porDia = new Map<string, T[]>()
  const ordenadas = [...ausencias]
    .filter(ehAtiva)
    .sort((a, b) => a.lancado_em.localeCompare(b.lancado_em) || a.id.localeCompare(b.id))
  for (const ausencia of ordenadas) {
    for (const dia of diasDoPeriodo(ausencia.dia_inicio, ausencia.dia_fim)) {
      if (recorte && (dia < recorte.inicio || dia > recorte.fim)) continue
      const doDia = porDia.get(dia)
      if (doDia) doDia.push(ausencia)
      else porDia.set(dia, [ausencia])
    }
  }
  return porDia
}

/** O mesmo mapa, separado por pessoa — para o painel de todo mundo e o CSV. */
export function ausenciasPorPessoa<T extends Ausencia>(
  ausencias: readonly T[],
  recorte?: Recorte,
): Map<string, Map<string, T[]>> {
  const porPessoa = new Map<string, T[]>()
  for (const ausencia of ausencias) {
    const daPessoa = porPessoa.get(ausencia.usuario_id)
    if (daPessoa) daPessoa.push(ausencia)
    else porPessoa.set(ausencia.usuario_id, [ausencia])
  }
  const resultado = new Map<string, Map<string, T[]>>()
  for (const [usuarioId, daPessoa] of porPessoa) {
    const porDia = ausenciasPorDia(daPessoa, recorte)
    if (porDia.size > 0) resultado.set(usuarioId, porDia)
  }
  return resultado
}

/**
 * Um dia da lista do mês: com batidas, com ausência, ou com os dois.
 *
 * "UM DIA COM AUSÊNCIA E BATIDA MOSTRA OS DOIS" é caso de borda: a
 * pessoa foi ao médico de manhã e voltou à tarde, ou o admin lançou o atestado
 * por cima de um dia que já tinha batida. A tela não escolhe um: mostra as
 * batidas (que contam hora) e a marca (que não conta), e o admin decide.
 */
export interface DiaComAusencia<D> {
  dia: string
  /** O dia das batidas (de `horas.ts`), ou `null` quando só há ausência. */
  batidas: D | null
  ausencias: Ausencia[]
}

/**
 * Junta os dias com batida (de `agruparPorDia`/`montarEspelho`) com os dias de
 * ausência, em ordem crescente. Os dias com batida vêm INTACTOS — mesmo
 * objeto, mesmos minutos: quem soma continua sendo `horas.ts`.
 */
export function juntarDiasEAusencias<D extends { dia: string }>(
  dias: readonly D[],
  porDia: ReadonlyMap<string, Ausencia[]>,
): DiaComAusencia<D>[] {
  const juntos = new Map<string, DiaComAusencia<D>>()
  for (const dia of dias) juntos.set(dia.dia, { dia: dia.dia, batidas: dia, ausencias: [] })
  for (const [dia, ausencias] of porDia) {
    const existente = juntos.get(dia)
    if (existente) existente.ausencias = ausencias
    else juntos.set(dia, { dia, batidas: null, ausencias })
  }
  return [...juntos.values()].sort((a, b) => a.dia.localeCompare(b.dia))
}

/* ------------------------------------------------------------------ */
/* Os rótulos                                                          */
/* ------------------------------------------------------------------ */

/**
 * A marca do dia: "Falta justificada — atestado médico".
 *
 * O tipo `falta_justificada` não repete a palavra ("Falta justificada — falta
 * justificada" não diz nada a mais). O tipo `outro` leva a observação, que o
 * banco exige justamente para "outro" dizer alguma coisa no papel.
 */
export function marcaDaAusencia(ausencia: Pick<Ausencia, 'tipo' | 'observacao'>): string {
  switch (ausencia.tipo) {
    case 'atestado_medico':
      return 'Falta justificada — atestado médico'
    case 'falta_justificada':
      return 'Falta justificada'
    case 'outro': {
      const observacao = ausencia.observacao?.trim()
      return observacao ? `Falta justificada — ${observacao}` : 'Falta justificada — outro motivo'
    }
  }
}

/**
 * A marca para o papel e para a planilha, que não têm botão de "ver atestado":
 * diz por escrito se o documento está guardado.
 */
export function marcaDaAusenciaPorExtenso(
  ausencia: Pick<Ausencia, 'tipo' | 'observacao' | 'atestado_path'>,
): string {
  return ausencia.atestado_path
    ? `${marcaDaAusencia(ausencia)} (atestado anexado)`
    : marcaDaAusencia(ausencia)
}

/** O atestado é PDF? Aí a tela mostra o link, e não a miniatura. */
export function atestadoEhPdf(caminho: string | null): boolean {
  return Boolean(caminho && /\.pdf$/i.test(caminho))
}

/**
 * O atestado abre como LINK, e não como miniatura? O PDF sempre; e o HEIC
 * também: ele só sobe sem compressão quando o navegador de quem lançou NÃO
 * soube abri-lo (ver `prepararAtestado`), e num `<img>` fora do Safari vira
 * imagem quebrada — que a tela leria como "link expirou". O link abre no
 * leitor do aparelho, que costuma saber mostrar ou salvar.
 */
export function atestadoAbreComoLink(caminho: string | null): boolean {
  return Boolean(caminho && /\.(pdf|heic)$/i.test(caminho))
}

/** "28/10/2026" ou "28/10/2026 a 30/10/2026 (3 dias)". */
export function descreverPeriodo(ausencia: Pick<Ausencia, 'dia_inicio' | 'dia_fim'>): string {
  const brasileiro = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`
  if (ausencia.dia_inicio === ausencia.dia_fim) return brasileiro(ausencia.dia_inicio)
  return `${brasileiro(ausencia.dia_inicio)} a ${brasileiro(ausencia.dia_fim)} (${duracaoEmDias(ausencia)} dias)`
}

/* ------------------------------------------------------------------ */
/* As regras do lançamento e do cancelamento                           */
/* ------------------------------------------------------------------ */

export interface EntradaDoLancamento {
  diaInicio: string
  diaFim: string
  tipo: string
  observacao: string
}

export type ResultadoDoLancamento =
  | {
      ok: true
      valores: {
        dia_inicio: string
        dia_fim: string
        tipo: TipoDeAusencia
        /** Nula quando em branco: o CHECK do banco recusa observação só de espaços. */
        observacao: string | null
      }
    }
  | { ok: false; erro: string }

/**
 * As regras do gatilho `ponto_ausencias_guardar`, na mesma ordem, antes de
 * subir o atestado.
 *
 * @param hoje o dia civil no fuso do ponto (`diaCivilDeHoje()`), a mesma base do
 *   `(now() AT TIME ZONE 'America/Sao_Paulo')::date` do banco.
 */
export function validarLancamento(entrada: EntradaDoLancamento, hoje: string): ResultadoDoLancamento {
  if (!TIPOS_DE_AUSENCIA.includes(entrada.tipo as TipoDeAusencia)) {
    return { ok: false, erro: 'Escolha o tipo da ausência.' }
  }
  const tipo = entrada.tipo as TipoDeAusencia
  const observacao = entrada.observacao.trim()

  if (tipo === 'outro' && !observacao) {
    return { ok: false, erro: 'No tipo “outro motivo”, escreva a observação — é ela que explica a falta na folha.' }
  }
  if (observacao.length > OBSERVACAO_MAXIMA) {
    return { ok: false, erro: `A observação pode ter no máximo ${OBSERVACAO_MAXIMA} caracteres.` }
  }

  const inicio = numeroDoDia(entrada.diaInicio)
  const fim = numeroDoDia(entrada.diaFim)
  if (inicio === null || fim === null) {
    return { ok: false, erro: 'Informe o dia inicial e o dia final.' }
  }
  if (fim < inicio) {
    return { ok: false, erro: 'O dia final não pode ser antes do inicial.' }
  }
  if (fim - inicio > PERIODO_MAXIMO_EM_DIAS - 1) {
    return {
      ok: false,
      erro: `Uma ausência cobre no máximo ${PERIODO_MAXIMO_EM_DIAS} dias. Lance o período em partes.`,
    }
  }

  const numeroDeHoje = numeroDoDia(hoje)
  if (numeroDeHoje === null) throw new Error(`Dia de hoje inválido: "${hoje}".`)
  if (inicio < numeroDeHoje - JANELA_EM_DIAS || fim > numeroDeHoje + JANELA_EM_DIAS) {
    return {
      ok: false,
      erro: 'O período tem de estar entre um ano atrás e um ano à frente. Confira o ano digitado.',
    }
  }

  return {
    ok: true,
    valores: { dia_inicio: entrada.diaInicio, dia_fim: entrada.diaFim, tipo, observacao: observacao || null },
  }
}

export type ResultadoDoMotivo = { ok: true; motivo: string } | { ok: false; erro: string }

/** O motivo do cancelamento: obrigatório e com até 500 caracteres, como no banco. */
export function validarMotivoDoCancelamento(texto: string): ResultadoDoMotivo {
  const motivo = texto.trim()
  if (!motivo) return { ok: false, erro: 'Escreva o motivo do cancelamento — ele fica guardado com o seu nome.' }
  if (motivo.length > MOTIVO_DO_CANCELAMENTO_MAXIMO) {
    return { ok: false, erro: `O motivo pode ter no máximo ${MOTIVO_DO_CANCELAMENTO_MAXIMO} caracteres.` }
  }
  return { ok: true, motivo }
}

/* ------------------------------------------------------------------ */
/* O arquivo do atestado                                               */
/* ------------------------------------------------------------------ */

export type ExtensaoDoAtestado = 'jpg' | 'png' | 'webp' | 'heic' | 'pdf'

/**
 * O tipo do arquivo como o bucket o aceita. A extensão do caminho TEM de bater
 * com o tipo gravado no storage — o gatilho confere (`.pdf` com
 * `application/pdf`, `.jpg` com `image/jpeg`…), e é pela extensão que a tela
 * decide entre miniatura e link.
 */
export const TIPO_DA_EXTENSAO: Record<ExtensaoDoAtestado, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
}

/**
 * A extensão de um arquivo escolhido, pelo tipo que o navegador informa e, na
 * falta dele, pelo nome. O nome entra porque o Chrome do Android e o do
 * computador mandam `type` VAZIO para `.heic` — a foto do iPhone repassada por
 * WhatsApp ou e-mail. `null` para o que o bucket não aceita.
 */
export function extensaoDoArquivo(tipo: string, nome: string): ExtensaoDoAtestado | null {
  const porTipo: Record<string, ExtensaoDoAtestado> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heic',
    'application/pdf': 'pdf',
  }
  const doTipo = porTipo[tipo.trim().toLowerCase()]
  if (doTipo) return doTipo
  const doNome = /\.([a-z0-9]+)$/i.exec(nome.trim())?.[1]?.toLowerCase()
  if (doNome === 'jpeg' || doNome === 'jpg') return 'jpg'
  if (doNome === 'heif') return 'heic'
  if (doNome === 'png' || doNome === 'webp' || doNome === 'heic' || doNome === 'pdf') return doNome
  return null
}

/** `{usuario_id}/{id-da-ausencia}.{extensão}` — a convenção da policy e do CHECK. */
export function caminhoDoAtestado(usuarioId: string, ausenciaId: string, extensao: ExtensaoDoAtestado): string {
  return `${usuarioId}/${ausenciaId}.${extensao}`
}

/**
 * O lado maior da foto do atestado depois da compressão.
 *
 * 2000 px, e não os 720 da selfie: a selfie mostra um rosto, o atestado mostra
 * LETRA — o CID, o carimbo do CRM, a assinatura. Uma folha A4 fotografada a
 * 2000 px no lado maior continua legível com zoom, e em JPEG 0,85 fica na casa
 * de 300 a 600 KB, em vez dos 3 a 5 MB que a câmera entrega.
 */
export const LADO_MAXIMO_DO_ATESTADO = 2000
export const QUALIDADE_DO_ATESTADO = 0.85

/** As dimensões reduzidas, na proporção. Nunca aumenta uma foto pequena. */
export function dimensoesReduzidas(
  largura: number,
  altura: number,
  ladoMaximo: number = LADO_MAXIMO_DO_ATESTADO,
): { largura: number; altura: number } {
  if (largura <= 0 || altura <= 0) return { largura: 0, altura: 0 }
  const escala = Math.min(1, ladoMaximo / Math.max(largura, altura))
  return {
    largura: Math.max(1, Math.round(largura * escala)),
    altura: Math.max(1, Math.round(altura * escala)),
  }
}

export type PlanoDoAtestado =
  | { acao: 'enviar'; extensao: 'pdf' }
  | { acao: 'comprimir'; extensao: ExtensaoDoAtestado }
  | { acao: 'recusar'; erro: string }

/**
 * O que fazer com o arquivo escolhido.
 *  • PDF vai como está — não há como "comprimir" um PDF no aparelho sem
 *    reescrevê-lo, e reescrever a prova é o que não se faz. Acima de 10 MB, o
 *    bucket recusaria: a tela diz antes.
 *  • Imagem é comprimida (ver `LADO_MAXIMO_DO_ATESTADO`), seja qual for o
 *    tamanho. Se o navegador não conseguir abri-la (HEIC fora do Safari), ela
 *    vai como está, desde que caiba nos 10 MB — quem decide é `faltas.ts`.
 *  • O resto (Word, planilha, vídeo) é recusado com frase.
 */
export function planoDoAtestado(tipo: string, nome: string, tamanho: number): PlanoDoAtestado {
  const extensao = extensaoDoArquivo(tipo, nome)
  if (!extensao) {
    return { acao: 'recusar', erro: 'O atestado tem de ser uma foto (JPEG, PNG, WebP ou HEIC) ou um PDF.' }
  }
  if (tamanho <= 0) return { acao: 'recusar', erro: 'O arquivo escolhido está vazio.' }
  if (extensao === 'pdf') {
    return tamanho > TAMANHO_MAXIMO_DO_ATESTADO
      ? { acao: 'recusar', erro: 'O PDF passa de 10 MB. Digitalize de novo com resolução menor, ou tire uma foto do atestado.' }
      : { acao: 'enviar', extensao }
  }
  return { acao: 'comprimir', extensao }
}

/** "312 KB", "2,4 MB" — para a tela dizer o que vai subir. */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}
