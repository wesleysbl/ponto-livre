/*
 * O CONVITE PARA INSTALAR O APP.
 *
 * Quem abre o ponto pela primeira vez abre no navegador, e o app só vira ícone
 * na tela de início se a pessoa instalar. Aqui mora a decisão de MOSTRAR o
 * convite e o que ela consulta; a tela é `components/ConviteParaInstalar.tsx`.
 *
 * Quando o convite aparece: o app NÃO está instalado, o aparelho é iPhone (ou
 * iPad) ou Android, e a pessoa não tocou em "Agora não" nos últimos 7 dias.
 *
 * POR QUE SÓ NO CELULAR
 * As instruções são por aparelho, e a batida acontece no celular (câmera e
 * localização, no local de trabalho). No computador quem abre o ponto é o RH,
 * para o painel e a folha: um convite para instalar ali só atrapalharia, e não
 * há passo a passo de celular que sirva para ele.
 */

export type Aparelho = 'ios' | 'android' | 'outro'

/** "Agora não" esconde o convite por 7 dias. */
export const DIAS_SEM_CONVITE = 7
const MS_SEM_CONVITE = DIAS_SEM_CONVITE * 24 * 60 * 60 * 1000

/** Onde o "Agora não" fica guardado, neste aparelho, como instante em ms. */
export const CHAVE_DO_ADIAMENTO = 'ponto:convite-instalar-adiado-em'

/**
 * iPhone, iPad ou Android, pelo `navigator.userAgent`.
 *
 * O iPad desde o iPadOS 13 se apresenta como um Mac ("Macintosh") para receber
 * os sites de computador. O que o separa de um Mac de verdade é a tela de
 * toque (`maxTouchPoints` > 1) — e para instalar ele segue o caminho do iPhone,
 * pelo Safari.
 */
export function identificarAparelho(userAgent: string, pontosDeToque = 0): Aparelho {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if (/Macintosh/i.test(userAgent) && pontosDeToque > 1) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'outro'
}

/**
 * O app está aberto pelo ícone da tela de início?
 *
 * O Android (e o computador) dizem pelo `display-mode: standalone` do
 * manifesto. O Safari do iPhone NÃO lê o manifesto para isso: ele diz por
 * `navigator.standalone`, que só existe lá. Basta um dos dois.
 */
export function estaInstalado(sinais: { modoStandalone: boolean; navigatorStandalone?: boolean }): boolean {
  return sinais.modoStandalone || sinais.navigatorStandalone === true
}

export interface AmbienteDeInstalacao {
  instalado: boolean
  aparelho: Aparelho
  /** Quando a pessoa tocou em "Agora não" (ms), ou `null` se nunca tocou. */
  adiadoEm: number | null
  /** O instante da decisão (ms). */
  agora: number
}

export function deveMostrarConvite({ instalado, aparelho, adiadoEm, agora }: AmbienteDeInstalacao): boolean {
  if (instalado || aparelho === 'outro') return false
  if (adiadoEm === null) return true
  /*
   * Um adiamento no FUTURO só nasce de relógio errado (o aparelho estava
   * adiantado quando a pessoa tocou). Tratá-lo como válido esconderia o convite
   * por tempo indeterminado; ele é ignorado.
   */
  if (adiadoEm > agora) return true
  return agora - adiadoEm >= MS_SEM_CONVITE
}

/**
 * Lê o "Agora não" guardado. Qualquer coisa estranha — armazenamento
 * bloqueado (aba anônima do Safari, dados do site apagados), valor que não é
 * número — conta como "nunca adiou": no pior caso o convite aparece de novo.
 */
export function lerAdiamento(armazenamento: Pick<Storage, 'getItem'> | null): number | null {
  try {
    const valor = armazenamento?.getItem(CHAVE_DO_ADIAMENTO)
    if (valor === null || valor === undefined || valor.trim() === '') return null
    const instante = Number(valor)
    return Number.isFinite(instante) ? instante : null
  } catch {
    return null
  }
}

/**
 * Guarda o "Agora não". Devolve `false` se não deu para guardar — e quem chama
 * esconde o convite assim mesmo, só que até a próxima abertura.
 */
export function gravarAdiamento(armazenamento: Pick<Storage, 'setItem'> | null, agora: number): boolean {
  try {
    if (!armazenamento) return false
    armazenamento.setItem(CHAVE_DO_ADIAMENTO, String(agora))
    return true
  } catch {
    return false
  }
}

/**
 * O `localStorage`, ou `null` quando não há janela (teste em Node) ou quando o
 * simples acesso a ele lança — o Safari com dados de site bloqueados faz isso.
 */
export function armazenamentoDoAparelho(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * Lê do navegador tudo o que `deveMostrarConvite` consulta. Fora do navegador
 * (teste em Node), ou num navegador sem `matchMedia` (o jsdom da fumaça), o
 * aparelho sai 'outro' ou o modo sai "não instalado" — e o convite, no
 * máximo, não aparece.
 */
export function lerAmbienteDoNavegador(): AmbienteDeInstalacao {
  const agora = Date.now()
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { instalado: false, aparelho: 'outro', adiadoEm: null, agora }
  }
  const modoStandalone =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return {
    instalado: estaInstalado({ modoStandalone, navigatorStandalone }),
    aparelho: identificarAparelho(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0),
    adiadoEm: lerAdiamento(armazenamentoDoAparelho()),
    agora,
  }
}
