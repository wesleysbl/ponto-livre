import { descreverLocalizacao, formatarMomento, TEXTO_SEM_LOCALIZACAO, type Batida, type OrigemDaLocalizacao } from './formato'
import { lerNumero } from './configuracao'

/*
 * O LOCAL DE TRABALHO À PROVA DE ERRO — as regras, em funções puras.
 *
 * O ERRO QUE ESTE ARQUIVO EXISTE PARA EVITAR
 * Um local ativo com a coordenada errada — um número de exemplo que ficou no
 * lugar, o centro da cidade em vez do endereço — não quebra nada à vista, e
 * TODA batida sai "fora do local". Nada na tela denunciaria: dois números
 * plausíveis no formulário não dizem que a medição nunca foi feita. Cada função
 * daqui fecha uma das portas por onde isso passaria calado:
 *
 *   conferirCoordenada    latitude e longitude trocadas, sinal esquecido,
 *                         ponto fora do Brasil — tudo isso o banco ACEITA
 *                         (uma latitude de -46,63 é válida no planeta), e
 *                         marcaria todo mundo como fora;
 *   lerParDeCoordenadas   o par colado do Google Maps ("-23.55, -46.63") num
 *                         campo só, que viraria NaN ou metade de um número;
 *   escolherMelhorLeitura e avaliarLeitura
 *                         a medição pelo celular com várias leituras, aceita só
 *                         com precisão boa — a primeira leitura de um GPS que
 *                         acabou de acordar erra centenas de metros;
 *   resumirLocalizacoes   a porcentagem de batidas "fora" nos últimos dias, com
 *                         alerta: 100% fora por semanas a fio é o sinal que
 *                         ninguém estaria olhando;
 *   descreverMedicao      quem mediu, quando, ou "nunca foi medido".
 *
 * ⚠ NADA DAQUI É PROTEÇÃO DO BANCO. Quem recusa coordenada impossível é o CHECK
 * da tabela (`ponto_local_latitude_valida`, ...). Estas regras são AVISOS:
 * um local de trabalho fora do Brasil é implausível, mas não é impossível, e a
 * tela não pode dizer "o banco recusa" sobre o que o banco aceita (ver o
 * cabeçalho de `configuracao.ts`). Por isso o aviso pede
 * confirmação em vez de travar para sempre.
 */

/* ------------------------------------------------------------------ */
/* Faixas                                                              */
/* ------------------------------------------------------------------ */

/**
 * O Brasil inteiro, com folga, em graus decimais: do Chuí (-33,75) ao Monte
 * Caburaí (+5,27) na latitude; da Serra do Divisor (-73,99) às ilhas de
 * Martim Vaz (-28,85) na longitude. Folga de meio grau para não acusar a
 * fronteira.
 *
 * A propriedade que importa para a troca: as duas faixas quase não se
 * sobrepõem. Toda longitude do Brasil é menor que -28,5, e nenhuma latitude do
 * Brasil é. Então um par trocado nunca cai no Brasil — e destrocado, cai.
 */
export const FAIXA_DO_BRASIL = {
  latitude: { min: -34.25, max: 5.75 },
  longitude: { min: -74.5, max: -28.35 },
} as const

/**
 * A pior precisão aceita para MEDIR o local, em metros.
 *
 * 30 m, e não os 100 m que bastam para mostrar uma batida
 * (`PRECISAO_MAXIMA_CONFIAVEL_METROS`): uma batida é uma pessoa num instante, e
 * um erro de 100 m nela vale só para ela; o local é o centro do raio de
 * TODAS as batidas de agora em diante. 30 m de erro no centro comem 20% do raio
 * de 150 m de todo mundo. Um GPS de celular com céu ou janela por perto chega a
 * 5–15 m em poucos segundos.
 */
export const PRECISAO_MAXIMA_DA_MEDICAO_METROS = 30

/** Acima disto a tela do local avisa que algo está errado com a coordenada. */
export const LIMITE_DE_ALERTA_FORA = 0.2

/** A janela que a tela do local olha para a porcentagem de "fora". */
export const DIAS_DO_RESUMO_DE_FORA = 30

/**
 * OS EXEMPLOS DOS CAMPOS DE LATITUDE E LONGITUDE.
 *
 * O exemplo cinza diz que é exemplo ("ex.:") e não aponta para lugar nenhum
 * que alguém use. Um exemplo com cara de valor salvo, ao lado de campos que
 * guardam o mesmo número, é o jeito mais fácil de ninguém perceber que o local
 * nunca foi medido.
 */
export const EXEMPLOS_DOS_CAMPOS = {
  latitude: 'ex.: -12,345678',
  longitude: 'ex.: -45,678901',
} as const

/* ------------------------------------------------------------------ */
/* Conferência da coordenada                                           */
/* ------------------------------------------------------------------ */

export interface ParDeCoordenadas {
  latitude: number
  longitude: number
}

export type AvisoDeCoordenada =
  | { tipo: 'zerada'; texto: string; sugestao: null }
  | { tipo: 'trocada'; texto: string; sugestao: ParDeCoordenadas }
  | { tipo: 'sem_sinal'; texto: string; sugestao: ParDeCoordenadas }
  | { tipo: 'fora_do_brasil'; texto: string; sugestao: null }

export function dentroDoBrasil(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= FAIXA_DO_BRASIL.latitude.min &&
    latitude <= FAIXA_DO_BRASIL.latitude.max &&
    longitude >= FAIXA_DO_BRASIL.longitude.min &&
    longitude <= FAIXA_DO_BRASIL.longitude.max
  )
}

/**
 * O que há de estranho num par de coordenadas, do mais provável ao mais genérico.
 *
 * Devolve no máximo UM aviso: quem trocou os campos não precisa ler também que o
 * ponto está fora do Brasil — é a mesma causa, e a primeira frase já diz o
 * conserto. Lista vazia = nada a avisar.
 *
 * A ORDEM DOS TESTES É A ORDEM DA CAUSA MAIS COMUM:
 *   1. (0, 0): campo que ficou zerado, ou aparelho que devolveu o "ponto nulo";
 *   2. trocada: os dois números certos, nos campos errados;
 *   3. sem sinal: no Brasil as duas são negativas (exceto o extremo norte na
 *      latitude), e o "-" é o caractere que o teclado do celular mais esconde;
 *   4. fora do Brasil: sobrou o que não tem conserto óbvio.
 */
export function conferirCoordenada(latitude: number, longitude: number): AvisoDeCoordenada[] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
  if (dentroDoBrasil(latitude, longitude)) return []

  if (latitude === 0 && longitude === 0) {
    return [
      {
        tipo: 'zerada',
        texto:
          'Latitude e longitude estão zeradas: esse ponto fica no meio do oceano, longe do local. Meça de novo ou digite a coordenada.',
        sugestao: null,
      },
    ]
  }

  if (dentroDoBrasil(longitude, latitude)) {
    return [
      {
        tipo: 'trocada',
        texto: `Latitude e longitude parecem trocadas. No Brasil a latitude fica entre ${formatarGrau(FAIXA_DO_BRASIL.latitude.min)} e ${formatarGrau(FAIXA_DO_BRASIL.latitude.max)}, e a longitude entre ${formatarGrau(FAIXA_DO_BRASIL.longitude.min)} e ${formatarGrau(FAIXA_DO_BRASIL.longitude.max)} — trocando as duas, o ponto cai no Brasil.`,
        sugestao: { latitude: longitude, longitude: latitude },
      },
    ]
  }

  const comSinal: ParDeCoordenadas[] = [
    { latitude: -latitude, longitude },
    { latitude, longitude: -longitude },
    { latitude: -latitude, longitude: -longitude },
  ]
  const consertada = comSinal.find((par) => dentroDoBrasil(par.latitude, par.longitude))
  if (consertada) {
    return [
      {
        tipo: 'sem_sinal',
        texto:
          'Parece faltar o sinal de menos: no Brasil a longitude é sempre negativa, e a latitude também, do Amapá para o sul. Com o sinal, o ponto cai no Brasil.',
        sugestao: consertada,
      },
    ]
  }

  return [
    {
      tipo: 'fora_do_brasil',
      texto:
        'Esta coordenada fica fora do Brasil. Se o local de trabalho não fica em outro país, confira os dois números — a batida de quem estiver lá dentro sairia "fora".',
      sugestao: null,
    },
  ]
}

function formatarGrau(valor: number): string {
  return String(valor).replace('.', ',')
}

/* ------------------------------------------------------------------ */
/* O par colado                                                        */
/* ------------------------------------------------------------------ */

/**
 * `"-23.550520, -46.633308"` -> as duas coordenadas. Nulo se o texto não for
 * claramente um PAR.
 *
 * É o formato que o Google Maps copia ao tocar num ponto, e a coisa mais natural
 * de colar no campo da latitude. Sem isto, o campo receberia o par inteiro, o
 * `lerNumero` devolveria nulo e a tela diria "digite um número" a quem acabou de
 * colar dois números certos.
 *
 * ACEITA: separador `, ` (vírgula e espaço), `;` ou espaço; vírgula ou ponto
 * decimal em cada número; parênteses em volta. Sem espaço nenhum, `a,b` com
 * ponto decimal e `a,b,c,d` com vírgula decimal (cada número tem exatamente
 * uma vírgula). Qualquer outra coisa — um número só, três números, texto
 * sobrando — é nulo, e o campo fica com o que foi digitado.
 */
export function lerParDeCoordenadas(texto: string): ParDeCoordenadas | null {
  const limpo = texto.trim().replace(/^\(\s*/, '').replace(/\s*\)$/, '').trim()
  if (limpo === '') return null

  let partes = limpo.split(/\s*;\s*|,\s+|\s+/).filter((parte) => parte !== '')
  if (partes.length === 1) {
    const porVirgula = limpo.split(',')
    // `a,b` só é par quando os dois têm PONTO decimal: `-23,550520` sozinho é UM
    // número com vírgula decimal, e lê-lo como (-23, 550520) seria o defeito
    // que `lerNumero` existe para evitar.
    if (porVirgula.length === 2 && porVirgula.every((parte) => parte.includes('.'))) {
      partes = porVirgula
    } else if (porVirgula.length === 4) {
      partes = [`${porVirgula[0]},${porVirgula[1]}`, `${porVirgula[2]},${porVirgula[3]}`]
    }
  }
  if (partes.length !== 2) return null

  const latitude = lerNumero(partes[0])
  const longitude = lerNumero(partes[1])
  if (latitude === null || longitude === null) return null
  // Fora do planeta não é par de coordenadas, é outra coisa colada no campo.
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

/* ------------------------------------------------------------------ */
/* A medição pelo aparelho                                             */
/* ------------------------------------------------------------------ */

/** Uma leitura do aparelho — o mesmo formato de `Coordenada` em `localizacao.ts`. */
export interface LeituraDoAparelho {
  latitude: number
  longitude: number
  precisaoMetros: number | null
}

/**
 * A leitura de MENOR erro declarado. Leitura sem precisão conta como a pior:
 * quem não diz o próprio erro não pode ganhar de quem diz "8 m".
 *
 * Empate fica com a MAIS NOVA: com o mesmo erro declarado, a última leitura é a
 * de um GPS que já teve mais tempo para assentar.
 */
export function escolherMelhorLeitura<T extends LeituraDoAparelho>(leituras: readonly T[]): T | null {
  let melhor: T | null = null
  for (const leitura of leituras) {
    if (!Number.isFinite(leitura.latitude) || !Number.isFinite(leitura.longitude)) continue
    const erro = leitura.precisaoMetros ?? Number.POSITIVE_INFINITY
    const erroDoMelhor = melhor ? (melhor.precisaoMetros ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
    if (melhor === null || erro <= erroDoMelhor) melhor = leitura
  }
  return melhor
}

export type AvaliacaoDaLeitura =
  | { aceita: true; texto: string }
  | { aceita: false; texto: string }

/** A leitura serve para medir o local? E a frase que diz isso com o número real. */
export function avaliarLeitura(
  leitura: LeituraDoAparelho | null,
  leituras: number,
  limite = PRECISAO_MAXIMA_DA_MEDICAO_METROS,
): AvaliacaoDaLeitura {
  const qual = leituras === 1 ? 'a única leitura' : `a melhor de ${leituras} leituras`
  if (leitura === null) {
    return { aceita: false, texto: 'O aparelho não devolveu nenhuma leitura. Tente de novo.' }
  }
  if (leitura.precisaoMetros === null) {
    return {
      aceita: false,
      texto: `O aparelho não informou a precisão (${qual}). Sem saber o erro, a coordenada não serve para medir o local: tente de novo, de preferência perto de uma janela.`,
    }
  }
  const metros = Math.round(leitura.precisaoMetros)
  if (leitura.precisaoMetros > limite) {
    return {
      aceita: false,
      texto: `Precisão de cerca de ${metros} m (${qual}), pior que os ${limite} m exigidos para medir o local. Meça de novo perto de uma janela, com o GPS ligado, ou digite a coordenada à mão.`,
    }
  }
  return {
    aceita: true,
    texto: `Coordenada deste aparelho preenchida, com precisão de cerca de ${metros} m (${qual}). Confira e salve.`,
  }
}

/* ------------------------------------------------------------------ */
/* Pode salvar?                                                        */
/* ------------------------------------------------------------------ */

export interface SituacaoDoFormularioDoLocal {
  /**
   * A captura que preencheu os campos e ainda vale (nula quando os campos foram
   * digitados à mão depois dela, ou quando nunca houve captura).
   */
  captura: AvaliacaoDaLeitura | null
  avisos: readonly AvisoDeCoordenada[]
  /** A pessoa marcou "a coordenada está certa mesmo assim". */
  confirmouAvisos: boolean
}

export type DecisaoDeGravacao = { pode: true; motivo: null } | { pode: false; motivo: string }

/**
 * O botão "Salvar o local" fica habilitado?
 *
 * 1. Captura com precisão pior que o limite NÃO habilita salvar. Os números
 *    ficam à vista (a pessoa vê o que o aparelho
 *    mediu), mas gravar exige medir de novo ou digitar à mão, e digitar é uma
 *    decisão consciente: tira a captura do caminho.
 * 2. Coordenada com aviso (trocada, sem sinal, fora do Brasil) exige a
 *    confirmação explícita. O banco aceitaria; a tela não deixa passar calado.
 */
export function decidirGravacaoDoLocal(situacao: SituacaoDoFormularioDoLocal): DecisaoDeGravacao {
  if (situacao.captura && !situacao.captura.aceita) {
    return { pode: false, motivo: situacao.captura.texto }
  }
  if (situacao.avisos.length > 0 && !situacao.confirmouAvisos) {
    return {
      pode: false,
      motivo: 'Confira o aviso sobre a coordenada antes de salvar — ou marque que ela está certa mesmo assim.',
    }
  }
  return { pode: true, motivo: null }
}

/* ------------------------------------------------------------------ */
/* Quantas batidas saíram "fora"                                       */
/* ------------------------------------------------------------------ */

/**
 * As colunas que decidem onde a batida estava. A latitude e a origem são
 * opcionais: com elas, a batida sem localização conta à
 * parte (`semGps`); a tela do local lê só as três primeiras, e lá ela cai em
 * `semLocalizacao` — fora da porcentagem do mesmo jeito.
 */
export type LocalizacaoDaBatida = Pick<Batida, 'distancia_metros' | 'no_local' | 'precisao_metros'> &
  OrigemDaLocalizacao

export interface ResumoDeLocalizacoes {
  total: number
  noLocal: number
  fora: number
  imprecisas: number
  /** Sem coordenada por não ter havido celular (a inserida pelo admin), ou sem local ativo. */
  semLocalizacao: number
  /**
   * As do app (ou de pedido aprovado) que saíram sem localização porque o GPS
   * não respondeu: o "2 sem localização" do painel.
   */
  semGps: number
  /**
   * `fora / (noLocal + fora)`: só as batidas com localização CONFIÁVEL entram
   * na conta. Uma batida com ±800 m de erro marcada "fora" não diz nada sobre a
   * coordenada do local, e a sem coordenada (inserida pelo admin, ou a que
   * saiu sem localização porque o GPS não respondeu) muito menos.
   * Nulo quando não há nenhuma confiável — "0%" seria afirmar o que não se sabe.
   */
  porcentagemFora: number | null
  /** Passou de `LIMITE_DE_ALERTA_FORA`. */
  alerta: boolean
}

/**
 * Conta as batidas por onde a tela pode HONESTAMENTE dizer que elas estavam —
 * com a MESMA régua do espelho, do painel e do CSV (`descreverLocalizacao`),
 * para que "fora" aqui seja o mesmo "fora" que o funcionário lê.
 */
export function resumirLocalizacoes(
  batidas: readonly LocalizacaoDaBatida[],
  limite = LIMITE_DE_ALERTA_FORA,
): ResumoDeLocalizacoes {
  let noLocal = 0
  let fora = 0
  let imprecisas = 0
  let semLocalizacao = 0
  let semGps = 0

  for (const batida of batidas) {
    switch (descreverLocalizacao(batida).nome) {
      case 'no_local':
        noLocal++
        break
      case 'fora':
        fora++
        break
      case 'imprecisa':
        imprecisas++
        break
      case 'ausente':
        semLocalizacao++
        break
      case 'sem_gps':
        semGps++
        break
    }
  }

  const confiaveis = noLocal + fora
  const porcentagemFora = confiaveis === 0 ? null : fora / confiaveis
  return {
    total: batidas.length,
    noLocal,
    fora,
    imprecisas,
    semLocalizacao,
    semGps,
    porcentagemFora,
    alerta: porcentagemFora !== null && porcentagemFora > limite,
  }
}

/**
 * A etiqueta de "fora" de uma pessoa no painel do mês. Nula quando
 * nenhuma batida confiável saiu fora — etiqueta de "0 fora" em toda linha seria
 * ruído, e o ruído é o que faz ninguém ler a etiqueta que importa.
 *
 * O alerta é o mesmo da tela do local (acima de `LIMITE_DE_ALERTA_FORA`): uma
 * pessoa com metade das batidas "fora" ou trabalha em outro lugar — e o admin
 * sabe —, ou está batendo dentro de um local cuja coordenada está errada.
 * As imprecisas e as sem localização não entram, pelo mesmo motivo de lá.
 */
export function descreverForaDaPessoa(
  resumo: ResumoDeLocalizacoes,
): { texto: string; alerta: boolean } | null {
  if (resumo.fora === 0 || resumo.porcentagemFora === null) return null
  const confiaveis = resumo.fora + resumo.noLocal
  return {
    texto: `${resumo.fora} de ${confiaveis} fora do local (${formatarPorcentagem(resumo.porcentagemFora)})`,
    alerta: resumo.alerta,
  }
}

/**
 * "2 sem localização": quantas batidas de uma pessoa saíram sem localização no
 * período, porque o GPS não respondeu. Nula quando
 * nenhuma — pelo mesmo motivo da etiqueta de "fora": "0" em toda linha é ruído.
 * Etiqueta neutra: sair sem localização é permitido; o número só deixa à vista
 * quem anda batendo assim.
 */
export function descreverSemLocalizacaoDaPessoa(resumo: Pick<ResumoDeLocalizacoes, 'semGps'>): string | null {
  if (resumo.semGps === 0) return null
  return `${resumo.semGps} ${TEXTO_SEM_LOCALIZACAO}`
}

/** 0.2 -> "20%"; 0.123 -> "12%"; abaixo de 1% e acima de zero -> "menos de 1%". */
export function formatarPorcentagem(fracao: number): string {
  if (fracao > 0 && fracao < 0.01) return 'menos de 1%'
  return `${Math.round(fracao * 100)}%`
}

/* ------------------------------------------------------------------ */
/* Quem mediu                                                          */
/* ------------------------------------------------------------------ */

export type EstadoDaMedicao =
  | { tipo: 'nunca'; texto: string }
  | { tipo: 'sem_medicao_no_local'; texto: string }
  | { tipo: 'medido'; texto: string }

/**
 * O que a tela diz sobre a medição do local.
 *
 * `medido_por` NULO COM `medido_em` PREENCHIDO não é "nunca medido": é
 * coordenada gravada sem sessão (direto no banco, por SQL ou por um script). A
 * tela diz isso com todas as letras, porque "gravada à mão no banco" e "medida
 * de dentro do local" são graus de confiança diferentes.
 *
 * `nomeDeQuemMediu` INDEFINIDO = o nome ainda está sendo lido. A frase sai sem
 * o "por", em vez de dizer "por uma conta que não está na lista" durante a
 * leitura e trocar de ideia meio segundo depois — afirmar que a conta sumiu
 * antes de perguntar é a tela inventando. Nulo = perguntou, e não veio nome
 * (a conta não está mais entre as do ponto, ou a leitura falhou).
 */
export function descreverMedicao(
  medidoEm: string | null,
  medidoPor: string | null,
  nomeDeQuemMediu: string | null | undefined,
): EstadoDaMedicao {
  if (!medidoEm) {
    return {
      tipo: 'nunca',
      texto:
        'Este local nunca foi medido. Meça de dentro do local, pelo celular, com "Usar a localização deste aparelho" — até lá, a marca "no local" das batidas depende de uma coordenada que ninguém conferiu.',
    }
  }
  const quando = formatarMomento(medidoEm)
  if (!medidoPor) {
    return {
      tipo: 'sem_medicao_no_local',
      texto: `Coordenada gravada direto no banco em ${quando}, sem medição feita no local: nenhum aparelho dentro do local a conferiu. Para o ajuste fino, meça pelo celular.`,
    }
  }
  return {
    tipo: 'medido',
    texto: `Medido em ${quando}${
      nomeDeQuemMediu === undefined
        ? ''
        : nomeDeQuemMediu
          ? ` por ${nomeDeQuemMediu}`
          : ' por uma conta que não está na lista do ponto'
    }.`,
  }
}

/** Link para conferir a coordenada num mapa. Ponto decimal, sempre. */
export function linkDoMapa(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}
