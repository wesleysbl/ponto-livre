/*
 * A BATIDA EM ATRASO — as regras e os rótulos, sem rede e sem React.
 *
 * O QUE É: o colaborador chegou, esqueceu de bater, e pede a batida depois —
 * dizendo o horário em que chegou e o motivo, com selfie, localização e PIN. O
 * pedido NÃO é batida: mora em `ponto_pedidos_atraso` e só vira batida quando
 * um admin aprova (`ponto_decidir_pedido_atraso`). Enquanto está pendente, ele
 * não aparece em leitura nenhuma de batida — espelho, painel, folha e CSV
 * leem `ponto_registros` e ficam iguais até a aprovação.
 *
 * QUEM DECIDE É O BANCO. As regras abaixo são as MESMAS de
 * `ponto_pedir_batida_em_atraso` (em `supabase/migrations/`), repetidas aqui
 * para a tela recusar antes da selfie e do PIN — e não para valer no lugar
 * delas. Se as duas divergirem, quem manda é a RPC, e a tela traduz a recusa:
 *   • horário declarado ANTES do momento do pedido (o cru, não o truncado);
 *   • no MESMO dia civil do pedido, em America/Sao_Paulo — "só hoje";
 *   • motivo com 10 a 500 caracteres depois de tirar os espaços das pontas.
 *
 * O FUSO É O DO PONTO, SEMPRE (`FUSO`, em `formato.ts`). "Hoje" é o dia nesse
 * fuso, e não o do aparelho: um celular com o fuso errado, ou um colaborador
 * viajando, pediria "08:00" e gravaria outra hora. A hora digitada passa por
 * `momentoNoFusoDoLocal`, a mesma conversão da correção do admin.
 */
import {
  descreverLocalizacao,
  diaCivilDoInstante,
  formatarHora,
  momentoNoFusoDoLocal,
  type Batida,
  type Localizacao,
} from './formato'

/* ------------------------------------------------------------------ */
/* O pedido, como o banco o guarda                                     */
/* ------------------------------------------------------------------ */

export type EstadoDoPedido = 'pendente' | 'aprovado' | 'recusado'

/**
 * Uma linha de `ponto_pedidos_atraso`, com as colunas que o app lê.
 *
 * `funcionario_nome` e `funcionario_email` são a fotografia de quem pediu,
 * tirada pela RPC no momento do pedido — o mesmo desenho da batida. A caixa de
 * pendências do admin usa o nome; a tela do colaborador não precisa dele.
 */
export interface PedidoDeAtraso {
  id: string
  usuario_id: string
  /** O horário que a pessoa diz ter batido, truncado ao minuto pelo servidor. */
  horario_declarado: string
  /** Dia civil do horário declarado, em America/Sao_Paulo. */
  dia_civil: string
  motivo: string
  /** O horário REAL do pedido, carimbado pelo servidor. */
  pedido_em: string
  selfie_path: string
  /**
   * Nulas no pedido que saiu sem localização: o GPS não respondeu, e a pessoa
   * seguiu com a selfie e o PIN. O banco só
   * aceita as duas juntas — nunca meia coordenada.
   */
  latitude: number | null
  longitude: number | null
  precisao_metros: number | null
  /** Distância ao local ativo no momento do pedido. Nula sem local ativo ou sem localização. */
  distancia_metros: number | null
  no_local: boolean | null
  estado: EstadoDoPedido
  decidido_por: string | null
  decidido_em: string | null
  motivo_decisao: string | null
  /** A batida criada na aprovação. */
  registro_id: string | null
  funcionario_nome: string | null
  funcionario_email: string | null
}

/* ------------------------------------------------------------------ */
/* As regras do pedido                                                 */
/* ------------------------------------------------------------------ */

/** Os limites do motivo — os de `ponto_pedir_batida_em_atraso`. */
export const MOTIVO_MINIMO = 10
export const MOTIVO_MAXIMO = 500

export type ResultadoDoHorario =
  | { ok: true; momentoISO: string }
  | { ok: false; erro: string }

const FORMATO_DA_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * O horário declarado vale? "Só hoje, antes de agora", no fuso do ponto.
 *
 * A ORDEM DAS PERGUNTAS É A DA RPC: primeiro "já passou?", depois "é de hoje?".
 * Assim 00h10 pedindo 23h00 recebe a resposta que o banco daria se a tela
 * entendesse 23h00 de hoje (futuro), e uma chamada com o instante de ontem
 * recebe "fora do dia de hoje" — as duas recusas, com a frase do caso.
 *
 * O instante NÃO é truncado aqui: quem trunca ao minuto é o servidor. E é o
 * cru que se compara com agora, como lá — 10h05m59 pedido às 10h05m30 é futuro.
 */
export function validarHorarioDeclarado(
  momento: Date | string,
  agora: Date,
): ResultadoDoHorario {
  const instante = new Date(momento)
  if (Number.isNaN(instante.getTime())) {
    return { ok: false, erro: 'Escolha o horário em que você deveria ter batido.' }
  }
  if (instante.getTime() >= agora.getTime()) {
    return {
      ok: false,
      erro: 'Esse horário ainda não chegou. A batida em atraso é para um horário que já passou hoje.',
    }
  }
  if (diaCivilDoInstante(instante) !== diaCivilDoInstante(agora)) {
    return {
      ok: false,
      erro: 'A batida em atraso só pode ser pedida no mesmo dia (horário de Brasília). Para outro dia, fale com quem cuida do ponto na sua empresa.',
    }
  }
  return { ok: true, momentoISO: instante.toISOString() }
}

/**
 * A hora escolhida no relógio da tela (`HH:MM`) vira o instante de HOJE, no
 * fuso do ponto, e passa pelas regras acima.
 *
 * "Hoje" é o dia civil de `agora` no fuso do ponto — nunca o do aparelho. Por isso
 * 00h10 pedindo "23:00" vira 23h00 de hoje, que é futuro e é recusado: a tela
 * não tem como pedir a véspera, e é o que a regra quer.
 */
export function momentoDaHoraDeHoje(hora: string, agora: Date): ResultadoDoHorario {
  const limpa = hora.trim()
  if (!FORMATO_DA_HORA.test(limpa)) {
    return { ok: false, erro: 'Escolha o horário em que você deveria ter batido (horas e minutos).' }
  }
  return validarHorarioDeclarado(momentoNoFusoDoLocal(diaCivilDoInstante(agora), limpa), agora)
}

/**
 * O horário mais tarde que o relógio da tela deixa escolher: o minuto de agora,
 * no fuso do ponto. Vai no `max` do campo — é conforto, não regra (o `max` de um
 * `<input type="time">` não impede digitar, e quem recusa é a validação).
 */
export function horaMaximaDeHoje(agora: Date): string {
  return formatarHora(agora.toISOString())
}

export type ResultadoDoMotivo = { ok: true; motivo: string } | { ok: false; erro: string }

/** O motivo vale? 10 a 500 caracteres, contados depois de tirar os espaços das pontas. */
export function validarMotivo(texto: string): ResultadoDoMotivo {
  const motivo = texto.trim()
  if (motivo.length < MOTIVO_MINIMO) {
    return {
      ok: false,
      erro: `Escreva o motivo com pelo menos ${MOTIVO_MINIMO} letras — é ele que o administrador lê para aprovar.`,
    }
  }
  if (motivo.length > MOTIVO_MAXIMO) {
    return { ok: false, erro: `O motivo pode ter no máximo ${MOTIVO_MAXIMO} caracteres.` }
  }
  return { ok: true, motivo }
}

/** Recusar exige motivo, como no banco. Aprovar aceita motivo opcional. */
export function validarMotivoDaRecusa(texto: string): ResultadoDoMotivo {
  const motivo = texto.trim()
  if (!motivo) {
    return { ok: false, erro: 'Escreva o motivo da recusa — a pessoa vai ler esse texto.' }
  }
  return { ok: true, motivo }
}

/* ------------------------------------------------------------------ */
/* Rótulos                                                             */
/* ------------------------------------------------------------------ */

export const ROTULO_DO_ESTADO: Record<EstadoDoPedido, string> = {
  pendente: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
}

/**
 * Quem aprovou cada pedido: `pedido_id -> nome` (ou `null`, quando o nome não
 * pôde ser lido). Só os APROVADOS entram — pendente e recusado não têm batida,
 * e é pela batida que a marca é procurada.
 *
 * O nome sai de `nomes` (conta -> nome), que a tela monta com o que conseguir
 * ler. Faltar o nome não apaga a marca: ela continua dizendo "em atraso,
 * aprovada" — quem sabe que a batida é de atraso é a própria batida
 * (`pedido_atraso_id`), e não esta lista.
 */
export function aprovadoresDosPedidos(
  pedidos: readonly Pick<PedidoDeAtraso, 'id' | 'estado' | 'decidido_por'>[],
  nomes: ReadonlyMap<string, string>,
): Map<string, string | null> {
  const mapa = new Map<string, string | null>()
  for (const pedido of pedidos) {
    if (pedido.estado !== 'aprovado') continue
    const nome = pedido.decidido_por ? nomes.get(pedido.decidido_por)?.trim() : undefined
    mapa.set(pedido.id, nome || null)
  }
  return mapa
}

export type MarcaDaBatida =
  | { nome: 'atraso'; texto: string }
  | { nome: 'ajuste'; texto: string }

/**
 * A marca que a batida leva no espelho, no painel, na folha e no CSV.
 *
 * A DE ATRASO VEM ANTES DA DE AJUSTE. A batida aprovada nasce pelo caminho do
 * admin (`origem = 'ajuste_admin'`, `ajuste_manual = true`), o único em que o
 * carimbo do banco mantém o horário declarado — e, para quem só lê esses dois
 * campos, ela é um "ajuste do admin". Esta função sabe mais: a batida tem
 * `pedido_atraso_id`, e a marca própria diz o que de fato aconteceu — a pessoa
 * pediu, alguém conferiu e aprovou.
 *
 * @param aprovadores `pedido_id -> nome`, de `aprovadoresDosPedidos`. Opcional:
 *   sem ele, a marca sai sem o nome.
 */
export function marcaDaBatida(
  batida: Pick<Batida, 'ajuste_manual' | 'pedido_atraso_id'>,
  aprovadores?: ReadonlyMap<string, string | null>,
): MarcaDaBatida | null {
  const pedido = batida.pedido_atraso_id ?? null
  if (pedido) {
    const nome = aprovadores?.get(pedido) ?? null
    return { nome: 'atraso', texto: nome ? `em atraso, aprovada por ${nome}` : 'em atraso, aprovada' }
  }
  if (batida.ajuste_manual) return { nome: 'ajuste', texto: 'ajuste do admin' }
  return null
}

/**
 * Onde a pessoa estava no momento do pedido, com a régua das batidas
 * (`descreverLocalizacao`). O pedido nasce sempre do app — não existe pedido
 * do admin —, então o pedido sem coordenada é o que saiu sem localização porque
 * o GPS não respondeu, e nunca um "ausente".
 */
export function localizacaoDoPedido(
  pedido: Pick<PedidoDeAtraso, 'latitude' | 'distancia_metros' | 'no_local' | 'precisao_metros'>,
): Localizacao {
  return descreverLocalizacao({ ...pedido, origem: 'app' })
}

/** A batida nasceu de um pedido de batida em atraso aprovado? */
export function ehBatidaDeAtraso(batida: Pick<Batida, 'pedido_atraso_id'>): boolean {
  return Boolean(batida.pedido_atraso_id)
}

/**
 * O que a pessoa lê sobre o próprio pedido, numa linha: o estado e, quando há,
 * quem decidiu e o motivo da recusa. O motivo da recusa é a parte que importa
 * — sem ele, "recusado" não diz o que fazer.
 */
export function descreverDecisao(
  pedido: Pick<PedidoDeAtraso, 'estado' | 'decidido_por' | 'motivo_decisao'>,
  nomes?: ReadonlyMap<string, string>,
): string {
  const quem = pedido.decidido_por ? nomes?.get(pedido.decidido_por)?.trim() : undefined
  switch (pedido.estado) {
    case 'pendente':
      return 'Aguardando aprovação de quem cuida do ponto na sua empresa. Enquanto isso, não entra no seu ponto.'
    case 'aprovado':
      return quem ? `Aprovado por ${quem}. Já está no seu ponto.` : 'Aprovado. Já está no seu ponto.'
    case 'recusado': {
      const motivo = pedido.motivo_decisao?.trim()
      const cabeca = quem ? `Recusado por ${quem}` : 'Recusado'
      return motivo ? `${cabeca}: ${motivo}` : `${cabeca}.`
    }
  }
}

/** As pendências, da mais antiga para a mais nova — quem pediu primeiro é atendido primeiro. */
export function pedidosPendentes<T extends Pick<PedidoDeAtraso, 'estado' | 'pedido_em' | 'id'>>(
  pedidos: readonly T[],
): T[] {
  return pedidos
    .filter((pedido) => pedido.estado === 'pendente')
    .sort(
      (a, b) =>
        new Date(a.pedido_em).getTime() - new Date(b.pedido_em).getTime() ||
        a.id.localeCompare(b.id),
    )
}

/**
 * Quanto tempo depois do horário declarado o pedido foi feito — "2h15 depois".
 * É o dado que o admin mais pergunta ("esqueceu às 8h e lembrou quando?").
 */
export function atrasoDoPedido(pedido: Pick<PedidoDeAtraso, 'horario_declarado' | 'pedido_em'>): string {
  const minutos = Math.max(
    0,
    Math.round(
      (new Date(pedido.pedido_em).getTime() - new Date(pedido.horario_declarado).getTime()) / 60000,
    ),
  )
  if (minutos < 60) return `${minutos} min depois`
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')} depois`
}
