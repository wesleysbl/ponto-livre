/*
 * Pedido da coordenada ao aparelho.
 *
 * O QUE ESTE MÓDULO GUARDA E O QUE ELE NÃO FAZ
 * Ele devolve latitude, longitude e a PRECISÃO que o aparelho informou — e
 * nada mais. Distância até o local de trabalho e marca dentro/fora são
 * calculadas no servidor, pelo gatilho do banco, com a coordenada do local
 * ativo em `ponto_local`. Se a conta fosse feita aqui, cada celular carregaria
 * uma cópia do endereço do local e uma batida poderia nascer com a distância
 * que o aparelho quisesse.
 *
 * PRECISÃO RUIM NÃO É ERRO
 * GPS impreciso grava a batida com a precisão registrada, e quem diz
 * "localização imprecisa" é o painel do admin. Então este módulo
 * nunca recusa uma leitura por causa do valor de `accuracy` — ele só a repassa.
 *
 * E LOCALIZAÇÃO NEGADA TAMBÉM NÃO GRAVA NADA
 * A recusa vira exceção com uma frase e um "como resolver". Quem chama para o
 * fluxo antes de qualquer envio de foto.
 *
 * A EXCEÇÃO É A MEDIÇÃO DO LOCAL, no fim do arquivo: lá a precisão
 * decide se a leitura serve, porque o que se mede é o centro do raio de todo
 * mundo, e não uma batida.
 */

import { escolherMelhorLeitura } from './coordenada'

export interface Coordenada {
  latitude: number
  longitude: number
  /** `accuracy` do aparelho, em metros. Nulo quando ele não informa. */
  precisaoMetros: number | null
}

/*
 * POR QUE A FALHA CARREGA UM MOTIVO
 *
 * Só com a frase e o "como resolver", a tela de bater não teria como separar
 * "você negou" de "o GPS não respondeu": as duas iriam para o mesmo "Batida não
 * registrada", e a selfie iria junto para o lixo. Só que as duas pedem caminhos
 * diferentes. Negar não melhora tentando de novo (é preciso
 * mexer na permissão); o GPS que não respondeu dentro de uma sala costuma
 * responder na segunda vez, perto da janela — e aí a foto já tirada serve.
 *
 *   negada        a pessoa (ou o aparelho) recusou a permissão
 *   indisponivel  o aparelho não achou a posição (GPS desligado, sem sinal),
 *                 ou devolveu um código que a especificação não conhece
 *   demora        o prazo do pedido venceu sem resposta
 *   sem_https     a página não está em conexão segura
 *   sem_suporte   o navegador não oferece localização
 */
export type MotivoDaFalhaDeLocalizacao = 'negada' | 'indisponivel' | 'demora' | 'sem_https' | 'sem_suporte'

/** Erro já traduzido, com a instrução de como reabilitar a permissão e o motivo da falha. */
export class ErroDeLocalizacao extends Error {
  comoResolver: string | null
  readonly motivo: MotivoDaFalhaDeLocalizacao

  constructor(mensagem: string, comoResolver: string | null, motivo: MotivoDaFalhaDeLocalizacao) {
    super(mensagem)
    this.name = 'ErroDeLocalizacao'
    this.comoResolver = comoResolver
    this.motivo = motivo
  }
}

const SEM_SUPORTE = () => new ErroDeLocalizacao('Este navegador não oferece localização.', null, 'sem_suporte')

// Sem HTTPS o navegador nem chama o callback de erro em alguns casos — melhor
// dizer a verdade antes de esperar 20 segundos por nada.
const SEM_HTTPS = () =>
  new ErroDeLocalizacao(
    'A localização só funciona em conexão segura (HTTPS).',
    'Abra o app pelo endereço oficial, com https://, e não por IP local.',
    'sem_https',
  )

const COMO_LIBERAR =
  'No iPhone: Ajustes › Safari › Localização › Perguntar ou Permitir. No Android: toque no ' +
  'cadeado ao lado do endereço › Permissões › Localização. Depois recarregue o app.'

/*
 * 20 segundos. O primeiro fix de GPS num celular que acabou de sair do bolso
 * leva mais que os 5 s que costumam ser o padrão dos exemplos, e um timeout
 * curto vira "localização indisponível" para quem está simplesmente dentro de
 * um prédio. `maximumAge: 0` porque uma coordenada em cache pode ser de horas
 * atrás — e a batida está afirmando onde a pessoa está AGORA.
 */
const OPCOES: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
}

/*
 * O MODO RÁPIDO: a segunda tentativa, depois
 * de o GPS não responder. `enableHighAccuracy: false` deixa o aparelho usar o
 * que tiver à mão — Wi-Fi, antena — em vez de esperar o satélite, que dentro de
 * uma sala é justamente o que não chega. A leitura pode vir menos precisa, e
 * tudo bem: precisão ruim não é erro (ver o topo), ela vai gravada e o painel
 * julga. `maximumAge` continua 0 pelo mesmo motivo de sempre: a batida diz onde
 * a pessoa está AGORA, e não onde estava há uma hora.
 */
const OPCOES_RAPIDAS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 15_000,
  maximumAge: 0,
}

/** A leitura do navegador no formato do app. */
function daPosicao(posicao: GeolocationPosition): Coordenada {
  const { latitude, longitude, accuracy } = posicao.coords
  return {
    latitude,
    longitude,
    precisaoMetros: Number.isFinite(accuracy) ? accuracy : null,
  }
}

/*
 * Os códigos de `GeolocationPositionError`, pelo número da especificação. Lidos
 * pelo número, e não por `falha.PERMISSION_DENIED`, para a tradução valer também
 * para o duplê dos testes, que não é um erro de navegador de verdade.
 */
const PERMISSAO_NEGADA = 1
const POSICAO_INDISPONIVEL = 2
const DEMOROU_DEMAIS = 3

/** A falha do navegador, traduzida. Uma só, para os dois pedidos deste módulo. */
function traduzirFalha(falha: Pick<GeolocationPositionError, 'code'>): ErroDeLocalizacao {
  switch (falha.code) {
    case PERMISSAO_NEGADA:
      /*
       * A FRASE NÃO DIZ "então a batida não foi registrada".
       *
       * Este módulo tem DOIS chamadores: a tela de bater e o botão que mede a
       * coordenada do local na área de administração. Naquela tela a
       * consequência é a batida não sair; nesta, não há batida nenhuma — o
       * admin está preenchendo dois campos. Dizer "a batida não foi registrada"
       * para quem está configurando o local afirma um efeito que não existe, e
       * manda procurar um problema no lugar errado.
       *
       * As outras três recusas abaixo são neutras pelo mesmo motivo:
       * quem sabe a consequência é a tela, que a escreve no seu contexto.
       */
      return new ErroDeLocalizacao('Você negou o acesso à localização.', COMO_LIBERAR, 'negada')
    case POSICAO_INDISPONIVEL:
      return new ErroDeLocalizacao(
        'O aparelho não conseguiu descobrir onde você está.',
        'Verifique se o GPS está ligado e tente de novo perto de uma janela ou na rua.',
        'indisponivel',
      )
    case DEMOROU_DEMAIS:
      return new ErroDeLocalizacao(
        'A localização demorou demais para responder.',
        'Tente de novo. Em ambiente fechado o GPS pode levar alguns segundos a mais.',
        'demora',
      )
    default:
      // Código fora da especificação: para quem bate, é o aparelho que não
      // deu a posição — o mesmo caminho de "indisponível", com tentar de novo.
      return new ErroDeLocalizacao('Não deu para obter sua localização agora.', null, 'indisponivel')
  }
}

export interface OpcoesDoPedido {
  /**
   * A segunda tentativa da tela de bater, depois de o GPS não responder:
   * precisão baixa e prazo de 15 s (`OPCOES_RAPIDAS`).
   */
  rapida?: boolean
}

/* ------------------------------------------------------------------ */
/* A batida sem localização                                            */
/* ------------------------------------------------------------------ */

/*
 * QUANDO A BATIDA PODE SAIR SEM COORDENADA
 *
 * Só quando o GPS NÃO RESPONDEU: `indisponivel` ou `demora`. A selfie e o PIN
 * continuam obrigatórios (o banco exige a foto da própria pessoa no bucket, com
 * até 15 minutos). Permissão negada, página sem HTTPS e navegador sem
 * localização continuam sem bater: os três se resolvem mexendo no aparelho, e
 * aceitar a batida neles transformaria "negar o GPS" num jeito de bater sem ser
 * localizado. Vale para a batida e para o pedido de batida em atraso.
 *
 * O motivo vai para o banco (`p_sem_localizacao`), que é quem decide de verdade:
 * sem latitude e longitude, ele só aceita um destes dois valores.
 */
export type MotivoSemLocalizacao = Extract<MotivoDaFalhaDeLocalizacao, 'indisponivel' | 'demora'>

/** A falha deixa bater sem localização? Só o GPS que não respondeu. */
export function podeBaterSemLocalizacao(motivo: MotivoDaFalhaDeLocalizacao): motivo is MotivoSemLocalizacao {
  return motivo === 'indisponivel' || motivo === 'demora'
}

/** O que a batida (ou o pedido) leva de localização: a coordenada, ou o motivo de não ter. */
export type LocalDaBatida =
  | { tipo: 'coordenada'; coordenada: Coordenada }
  | { tipo: 'sem_localizacao'; motivo: MotivoSemLocalizacao }

/** Os parâmetros de localização das RPCs de bater e de pedir batida em atraso. */
export interface ArgumentosDaLocalizacao {
  p_latitude: number | null
  p_longitude: number | null
  p_precisao_metros: number | null
  /** Só quando a batida sai sem coordenada — ver `argumentosDaLocalizacao`. */
  p_sem_localizacao?: MotivoSemLocalizacao
}

/**
 * A localização como as RPCs a recebem.
 *
 * `p_sem_localizacao` SÓ VIAJA QUANDO É O CASO. Com coordenada, o parâmetro
 * nem vai: a chamada comum leva só latitude, longitude e precisão, e o
 * PostgREST escolhe a função pelo nome dos argumentos que chegam. Sem
 * coordenada, latitude, longitude e precisão vão nulas, e o motivo vai junto.
 */
export function argumentosDaLocalizacao(local: LocalDaBatida): ArgumentosDaLocalizacao {
  if (local.tipo === 'coordenada') {
    return {
      p_latitude: local.coordenada.latitude,
      p_longitude: local.coordenada.longitude,
      p_precisao_metros: local.coordenada.precisaoMetros,
    }
  }
  return { p_latitude: null, p_longitude: null, p_precisao_metros: null, p_sem_localizacao: local.motivo }
}

export function pedirCoordenada(opcoes: OpcoesDoPedido = {}): Promise<Coordenada> {
  return new Promise((resolver, recusar) => {
    if (!('geolocation' in navigator)) {
      recusar(SEM_SUPORTE())
      return
    }

    if (!window.isSecureContext) {
      recusar(SEM_HTTPS())
      return
    }

    navigator.geolocation.getCurrentPosition(
      (posicao) => resolver(daPosicao(posicao)),
      (falha) => recusar(traduzirFalha(falha)),
      opcoes.rapida ? OPCOES_RAPIDAS : OPCOES,
    )
  })
}

/* ------------------------------------------------------------------ */
/* Medir o local com várias leituras                                   */
/* ------------------------------------------------------------------ */

/*
 * POR QUE A TELA DO LOCAL NÃO USA `pedirCoordenada`
 *
 * Uma batida é uma pessoa num instante: uma leitura basta, e a precisão vai
 * gravada junto para o painel julgar. O local é o CENTRO do raio de todas as
 * batidas dali em diante — e a primeira leitura de um GPS que acabou de acordar
 * costuma ser a pior (triangulação de antena, centenas de metros). Aceitar essa
 * primeira leitura, qualquer que fosse o erro, mediria o local errado.
 *
 * Aqui o aparelho é observado por até 20 segundos (`watchPosition`), cada
 * leitura entra na conta e fica a de MENOR erro declarado
 * (`escolherMelhorLeitura`). Se uma leitura chega já boa o bastante
 * (`precisaoAlvoMetros`), a medição para antes. Quem decide se a melhor serve
 * é `avaliarLeitura`, em `coordenada.ts`: este módulo continua só repassando o
 * que o aparelho disse.
 *
 * AS FALHAS NO MEIO DO CAMINHO NÃO MATAM A MEDIÇÃO. `watchPosition` pode chamar
 * o callback de erro (sinal perdido, demora) entre duas leituras boas; isso só
 * vira recusa se, no fim da janela, não houver leitura nenhuma. Permissão
 * negada é diferente: encerra na hora, porque não vai melhorar esperando.
 */

/** O pedaço de `navigator.geolocation` que a medição usa — injetável nos testes. */
export type FonteDeLocalizacao = Pick<Geolocation, 'watchPosition' | 'clearWatch'>

export interface OpcoesDaMedicao {
  /** Quanto tempo observar o aparelho, no máximo. */
  janelaMs?: number
  /** Leitura com erro igual ou menor que este encerra a medição antes da hora. */
  precisaoAlvoMetros?: number
  /** Chamado a cada leitura, com a melhor até agora — a tela mostra o progresso. */
  aoLer?: (melhor: Coordenada, leituras: number) => void
  /** Para os testes. No app, `navigator.geolocation`. */
  fonte?: FonteDeLocalizacao
}

export interface ResultadoDaMedicao {
  melhor: Coordenada
  leituras: number
}

/** `navigator.geolocation`, ou a recusa já traduzida de quem não o tem. */
function fonteDoNavegador(): FonteDeLocalizacao | ErroDeLocalizacao {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return SEM_SUPORTE()
  if (typeof window !== 'undefined' && !window.isSecureContext) return SEM_HTTPS()
  return navigator.geolocation
}

export const JANELA_DA_MEDICAO_MS = 20_000
export const PRECISAO_ALVO_DA_MEDICAO_METROS = 10

export function medirCoordenada(opcoes: OpcoesDaMedicao = {}): Promise<ResultadoDaMedicao> {
  const janelaMs = opcoes.janelaMs ?? JANELA_DA_MEDICAO_MS
  const alvo = opcoes.precisaoAlvoMetros ?? PRECISAO_ALVO_DA_MEDICAO_METROS

  return new Promise((resolver, recusar) => {
    const fonte = opcoes.fonte ?? fonteDoNavegador()
    if (fonte instanceof ErroDeLocalizacao) {
      recusar(fonte)
      return
    }

    const leituras: Coordenada[] = []
    let ultimaFalha: ErroDeLocalizacao | null = null
    let encerrada = false
    let vigia: number | null = null
    let prazo: ReturnType<typeof setTimeout> | null = null

    const encerrar = (falhaFatal: ErroDeLocalizacao | null) => {
      if (encerrada) return
      encerrada = true
      if (prazo !== null) clearTimeout(prazo)
      if (vigia !== null) fonte.clearWatch(vigia)

      const melhor = escolherMelhorLeitura(leituras)
      if (falhaFatal) recusar(falhaFatal)
      else if (melhor) resolver({ melhor, leituras: leituras.length })
      else recusar(ultimaFalha ?? traduzirFalha({ code: DEMOROU_DEMAIS }))
    }

    prazo = setTimeout(() => encerrar(null), janelaMs)

    vigia = fonte.watchPosition(
      (posicao) => {
        if (encerrada) return
        leituras.push(daPosicao(posicao))
        const melhor = escolherMelhorLeitura(leituras)
        if (melhor) opcoes.aoLer?.(melhor, leituras.length)
        if (melhor && melhor.precisaoMetros !== null && melhor.precisaoMetros <= alvo) {
          encerrar(null)
        }
      },
      (falha) => {
        if (encerrada) return
        ultimaFalha = traduzirFalha(falha)
        if (falha.code === PERMISSAO_NEGADA) encerrar(ultimaFalha)
      },
      // `timeout` do navegador = a janela inteira: quem corta antes é o `prazo`.
      { enableHighAccuracy: true, maximumAge: 0, timeout: janelaMs },
    )
    // Uma fonte que encerrou de dentro do `watchPosition` (leitura boa síncrona,
    // num duplê) já limpou o que havia; aqui só falta o vigia que acabou de nascer.
    if (encerrada) fonte.clearWatch(vigia)
  })
}
