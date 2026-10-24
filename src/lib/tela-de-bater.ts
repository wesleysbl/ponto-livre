import { calcularDia, formatarDuracao } from './horas'
import { formatarHora, proximoTipo, ROTULO_CURTO, ROTULO_DO_TIPO, type Batida, type TipoDeBatida } from './formato'
import type { MotivoDaFalhaDeLocalizacao } from './localizacao'

/*
 * O QUE A TELA DE BATER DIZ, SEM REACT.
 *
 * `Bater.tsx` desenha; as decisões ficam aqui, puras e testadas: o que o botão
 * diz, quando o dia está completo, quando o app reaberto volta ao início, o que
 * a falha de localização oferece (com "Bater sem localização") e as frases do
 * formulário de batida em atraso.
 *
 * NENHUMA DESTAS FUNÇÕES DECIDE O TIPO DA BATIDA. O tipo continua saindo do
 * gatilho do banco, na hora de gravar (README: "o funcionário não escolhe o
 * tipo"). O botão só mostra a PREVISÃO, pela mesma escada de `proximoTipo`, e
 * se cala ("Bater ponto") sempre que a previsão pode mentir: enquanto a lista
 * carrega, quando ela não veio, ou com um pedido em atraso esperando — que,
 * aprovado, entra no meio do dia e muda o nome das batidas.
 */

/* ------------------------------------------------------------------ */
/* O botão de bater                                                    */
/* ------------------------------------------------------------------ */

/** As quatro batidas de um dia normal: o "de 4" do subtítulo. */
export const BATIDAS_DE_UM_DIA = 4

const DETALHE_DO_FLUXO = 'selfie, localização e PIN'

export type ModoDoBotao =
  /** A lista de hoje (ou os pedidos) ainda não chegou: nada de previsão. */
  | 'carregando'
  /** A lista de hoje não veio: dá para bater, mas não para prever. */
  | 'sem_leitura'
  /** Há pedido em atraso esperando: os nomes de hoje ainda podem mudar. */
  | 'com_pedido'
  /** Da 1ª à 4ª batida: o botão diz qual é. */
  | 'proxima'
  /** Número par de batidas, a partir de 4: o dia fechou, e a extra pede confirmação. */
  | 'completo'
  /** Número ímpar a partir de 5: falta fechar o par da extra. */
  | 'extra_aberta'

export interface PrevisaoDoBotao {
  modo: ModoDoBotao
  titulo: string
  subtitulo: string
  /** A linha sob o botão, quando há o que explicar. */
  aviso: string | null
  /** Botão verde (a ação do momento) ou secundário (o dia já fechou). */
  principal: boolean
  /** Tocar no botão abre "Você já fechou o dia" antes da câmera. */
  pedeConfirmacao: boolean
  /** "08:02 → 18:01 · 8h59", no cartão do dia completo. */
  resumoDoDia: string | null
}

export interface EntradaDaPrevisao {
  /** A lista de hoje (ou os pedidos de hoje) ainda está a caminho. */
  carregando: boolean
  /** A leitura da lista falhou. */
  erro: string | null
  batidas: readonly Batida[]
  /** Quantos pedidos de batida em atraso de hoje esperam decisão. */
  pedidosPendentes: number
}

/** "Bater saída para o almoço": o verbo e o nome do tipo, em minúsculas. */
export function rotuloDoTipoNoBotao(tipo: TipoDeBatida): string {
  return `Bater ${ROTULO_DO_TIPO[tipo].toLowerCase()}`
}

/** "08:02 → 18:01 · 8h59": a primeira e a última batida, e as horas do dia (`calcularDia`). */
export function resumoDoDiaCompleto(batidas: readonly Batida[]): string | null {
  if (batidas.length === 0) return null
  const dia = calcularDia(batidas[0].dia_civil, [...batidas])
  const primeira = dia.batidas[0]
  const ultima = dia.batidas[dia.batidas.length - 1]
  return `${formatarHora(primeira.registrado_em)} → ${formatarHora(ultima.registrado_em)} · ${formatarDuracao(dia.minutos)}`
}

function avisoDoPedido(pendentes: number): string {
  return pendentes === 1
    ? 'Você tem 1 pedido em atraso aguardando aprovação. Quando ele for aprovado, os nomes das batidas de hoje se ajustam sozinhos.'
    : `Você tem ${pendentes} pedidos em atraso aguardando aprovação. Quando eles forem aprovados, os nomes das batidas de hoje se ajustam sozinhos.`
}

/**
 * O que o botão de bater diz.
 *
 * A ORDEM DOS CASOS É A ORDEM DE CONFIANÇA NA PREVISÃO: sem lista, nada se
 * afirma; com o dia completo, a confirmação vale mesmo com pedido esperando
 * (bater de novo deixaria o dia ímpar do mesmo jeito); com pedido esperando, o
 * nome da próxima batida pode mudar e o botão não arrisca.
 */
export function preverBotao({ carregando, erro, batidas, pedidosPendentes }: EntradaDaPrevisao): PrevisaoDoBotao {
  const neutro = {
    titulo: 'Bater ponto',
    subtitulo: DETALHE_DO_FLUXO,
    principal: true,
    pedeConfirmacao: false,
    resumoDoDia: null,
  }
  if (carregando) return { ...neutro, modo: 'carregando', aviso: null }
  if (erro) {
    return {
      ...neutro,
      modo: 'sem_leitura',
      aviso: 'Não deu para ler suas batidas de hoje. Pode bater normalmente: o tipo é definido na gravação.',
    }
  }

  const quantas = batidas.length
  if (quantas >= BATIDAS_DE_UM_DIA && quantas % 2 === 0) {
    return {
      modo: 'completo',
      titulo: rotuloDoTipoNoBotao('extra'),
      subtitulo: DETALHE_DO_FLUXO,
      aviso: 'Só se você voltou a trabalhar depois da saída.',
      principal: false,
      pedeConfirmacao: true,
      resumoDoDia: resumoDoDiaCompleto(batidas),
    }
  }
  if (pedidosPendentes > 0) return { ...neutro, modo: 'com_pedido', aviso: avisoDoPedido(pedidosPendentes) }
  if (quantas > BATIDAS_DE_UM_DIA) {
    return {
      ...neutro,
      modo: 'extra_aberta',
      titulo: rotuloDoTipoNoBotao('extra'),
      subtitulo: `${quantas + 1}ª batida de hoje · ${DETALHE_DO_FLUXO}`,
      aviso: 'Esta fecha o par da batida extra.',
    }
  }
  return {
    ...neutro,
    modo: 'proxima',
    titulo: rotuloDoTipoNoBotao(proximoTipo(quantas)),
    subtitulo: `${quantas + 1}ª de ${BATIDAS_DE_UM_DIA} hoje · ${DETALHE_DO_FLUXO}`,
    aviso: null,
  }
}

/** O texto de "Você já fechou o dia", antes da câmera. */
export function textoDaConfirmacaoDaExtra(batidas: readonly Batida[]): string {
  const ultima = batidas[batidas.length - 1]
  const quando = ultima ? ` (última às ${formatarHora(ultima.registrado_em)})` : ''
  return (
    `Suas ${batidas.length} batidas de hoje já estão registradas${quando}. ` +
    'Uma batida a mais entra como extra e deixa o dia incompleto até a próxima.'
  )
}

/* ------------------------------------------------------------------ */
/* O app reaberto                                                      */
/* ------------------------------------------------------------------ */

/*
 * QUANDO A TELA VOLTA SOZINHA AO INÍCIO
 *
 * O PWA fica aberto no celular de um dia para o outro. Sem esta regra, quem o
 * abrisse de manhã veria o comprovante da saída de ontem, ou a lista de ontem
 * sob o botão — e o botão prevendo "extra". Ao voltar para o app
 * (`visibilitychange`), a tela
 * relê as batidas e os pedidos de hoje e volta ao início se o dia mudou desde a
 * última leitura, ou se ficou mais de 10 minutos numa etapa FINAL (comprovante,
 * recibo do pedido, erro): ali não há nada a perder.
 *
 * NUNCA NO MEIO DE UM PASSO. Voltar ao início no meio da câmera, da
 * localização, do PIN ou da gravação jogaria fora a foto, o motivo digitado ou
 * — pior — esconderia o desfecho de uma gravação em andamento. O mesmo vale para
 * o formulário do pedido em atraso (o motivo está sendo escrito), para a falha
 * de localização (a foto está guardada para tentar de novo) e para a
 * confirmação da batida extra (a pessoa está decidindo).
 */
export const ETAPAS_QUE_NUNCA_VOLTAM_SOZINHAS = [
  'atraso',
  'confirmar_extra',
  'camera',
  'localizando',
  'localizacao_falhou',
  'pin',
  'gravando',
] as const

export const ETAPAS_FINAIS = ['comprovante', 'pedido_enviado', 'erro'] as const

export type NomeDaEtapa =
  | 'inicio'
  | (typeof ETAPAS_QUE_NUNCA_VOLTAM_SOZINHAS)[number]
  | (typeof ETAPAS_FINAIS)[number]

export const MINUTOS_ATE_VOLTAR_AO_INICIO = 10

export interface EntradaDoRetorno {
  etapa: NomeDaEtapa
  /** Quando a tela entrou na etapa de agora (ms). */
  desdeMs: number
  agoraMs: number
  /** O dia civil da última leitura da lista; nulo se ela ainda não aconteceu. */
  diaDaLeitura: string | null
  hoje: string
}

/** O app voltou a aparecer: a tela deve ir para o início? */
export function deveVoltarAoInicio({ etapa, desdeMs, agoraMs, diaDaLeitura, hoje }: EntradaDoRetorno): boolean {
  if (!(ETAPAS_FINAIS as readonly string[]).includes(etapa)) return false
  if (diaDaLeitura !== null && diaDaLeitura !== hoje) return true
  return agoraMs - desdeMs > MINUTOS_ATE_VOLTAR_AO_INICIO * 60_000
}

/* ------------------------------------------------------------------ */
/* A falha de localização                                              */
/* ------------------------------------------------------------------ */

/** As falhas que tentar de novo pode resolver: o GPS que não respondeu, ou demorou. */
export type FalhaQueValeTentarDeNovo = Extract<MotivoDaFalhaDeLocalizacao, 'indisponivel' | 'demora'>

/**
 * Só "indisponível" e "demora" vão para "Não achamos sua localização", com a
 * foto guardada. Permissão negada, página sem HTTPS e navegador sem localização
 * não melhoram tentando de novo: continuam no erro de sempre, com o "como
 * resolver" de cada um.
 */
export function valeTentarALocalizacaoDeNovo(motivo: MotivoDaFalhaDeLocalizacao): motivo is FalhaQueValeTentarDeNovo {
  return motivo === 'indisponivel' || motivo === 'demora'
}

/** O texto de "Não achamos sua localização", pelo motivo e pela vez. */
export function textoDaFalhaDeLocalizacao(motivo: FalhaQueValeTentarDeNovo, tentativas: number): string {
  if (tentativas >= 2) {
    return 'Ainda não deu. Chegue perto de uma janela ou saia da sala, confira se a localização do celular está ligada e tente de novo.'
  }
  return motivo === 'demora'
    ? 'A localização está demorando. Vamos tentar de novo de um jeito mais rápido.'
    : 'O GPS não respondeu. Chegue perto de uma janela ou saia da sala e tente de novo.'
}

/*
 * BATER SEM LOCALIZAÇÃO.
 *
 * Em "Não achamos sua localização" — e SÓ lá, ou seja, só quando o GPS não
 * respondeu (`podeBaterSemLocalizacao`, em `localizacao.ts`) —, a pessoa pode
 * seguir sem a coordenada, com a MESMA selfie, para o PIN. O botão vem depois
 * de "Tentar a localização de novo", que continua sendo o caminho principal, e a
 * linha embaixo dele diz o que acontece e o que é melhor fazer. Permissão
 * negada, sem HTTPS e sem suporte nunca chegam a esta tela: continuam no erro,
 * com o "como liberar".
 */
export interface TextoDeBaterSemLocalizacao {
  botao: string
  linha: string
}

/** O botão e a linha de "Bater sem localização" — no pedido em atraso, o mesmo botão fala do pedido. */
export function textoDeBaterSemLocalizacao(doPedido: boolean): TextoDeBaterSemLocalizacao {
  return doPedido
    ? {
        botao: 'Enviar o pedido sem localização',
        linha:
          'O pedido sai com a sua foto e o PIN, marcado como sem localização. Prefira tentar de novo perto de uma janela.',
      }
    : {
        botao: 'Bater sem localização',
        linha:
          'A batida sai com a sua foto e o PIN, marcada como sem localização. Prefira tentar de novo perto de uma janela.',
      }
}

/**
 * O rodapé de "Não achamos sua localização". Diz só o que é verdade nos dois
 * caminhos (tentar de novo ou bater sem localização): nada foi gravado ainda, e
 * a distância não bloqueia.
 */
export function rodapeDaFalhaDeLocalizacao(doPedido: boolean): string {
  return doPedido
    ? 'Nada foi enviado ainda. A distância até o local não bloqueia o pedido.'
    : 'Nada foi gravado ainda. A distância até o local não bloqueia a batida.'
}

/** A frase do PIN, pelo que vai ser gravado: batida ou pedido, com ou sem localização. */
export function descricaoDoPin(horaDoPedido: string | null, semLocalizacao: boolean): string {
  const sem = semLocalizacao ? ', sem localização' : ''
  return horaDoPedido
    ? `Último passo antes de enviar o pedido de batida das ${horaDoPedido}${sem}.`
    : `Último passo antes de gravar a batida${sem}.`
}

/* ------------------------------------------------------------------ */
/* O formulário da batida em atraso                                    */
/* ------------------------------------------------------------------ */

/** "Hoje você já bateu: 08:02 Entrada · 12:01 Almoço". */
export function resumoDeHojeNoFormulario(batidas: readonly Batida[]): string {
  if (batidas.length === 0) return 'Hoje você ainda não bateu nenhuma.'
  const lista = batidas.map((batida) => `${formatarHora(batida.registrado_em)} ${ROTULO_CURTO[batida.tipo]}`)
  return `Hoje você já bateu: ${lista.join(' · ')}`
}

/** "do Almoço", "da Entrada": o artigo de cada rótulo curto. */
const DO_TIPO: Record<TipoDeBatida, string> = {
  entrada: 'da',
  saida_almoco: 'do',
  volta_almoco: 'da',
  saida: 'da',
  extra: 'da',
}

/**
 * Onde a hora escolhida cai entre as batidas de hoje: "Esse horário fica
 * depois do Almoço (12:01).". Nulo sem hora válida ou sem batida nenhuma.
 *
 * As horas comparam como texto (`HH:MM`, sempre com dois dígitos e no fuso do
 * ponto). No mesmo minuto de uma batida, o banco recusaria o pedido — a frase
 * avisa antes.
 */
export function ondeFicaOHorario(hora: string, batidas: readonly Batida[]): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora) || batidas.length === 0) return null
  const comHora = batidas
    .map((batida) => ({ batida, hora: formatarHora(batida.registrado_em) }))
    .sort((a, b) => a.hora.localeCompare(b.hora))
  const mesmoMinuto = comHora.find((item) => item.hora === hora)
  if (mesmoMinuto) {
    return `Você já tem uma batida às ${hora} (${ROTULO_CURTO[mesmoMinuto.batida.tipo]}). Escolha o horário em que esqueceu de bater.`
  }
  const antes = comHora.filter((item) => item.hora < hora)
  if (antes.length === 0) return 'Esse horário fica antes de todas as suas batidas de hoje.'
  const anterior = antes[antes.length - 1]
  const tipo = anterior.batida.tipo
  return `Esse horário fica depois ${DO_TIPO[tipo]} ${ROTULO_CURTO[tipo]} (${anterior.hora}).`
}
