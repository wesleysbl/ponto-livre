import { supabase } from './supabase'
import { ErroDoPainel, lerNomesDasContas } from './admin'
import { ErroDoPedido } from './batidas'
import { lerTodasAsPaginas } from './paginacao'
import { aprovadoresDosPedidos, type PedidoDeAtraso } from './atraso'
import type { BatidaDoAdmin } from './formato'
import type { Periodo } from './periodo'

/*
 * A CONVERSA COM OS PEDIDOS DE BATIDA EM ATRASO (no banco,
 * `ponto_pedidos_atraso` e as RPCs de pedir e de decidir).
 *
 * O pedido em si nasce em `batidas.ts` (`pedirBatidaEmAtraso`), ao lado da
 * batida, porque os dois sobem a selfie pelo mesmo caminho. Aqui moram as
 * leituras — a do colaborador e a do admin — e a decisão do admin.
 *
 * QUEM LÊ O QUÊ É A RLS. A policy "Ponto: dono ou admin le o pedido de atraso"
 * tem o mesmo desenho da leitura de batidas: quem administra o ponto lê todos;
 * o dono, com acesso ao ponto, lê os seus. O app só lê — `authenticated` não
 * tem INSERT, UPDATE nem DELETE na tabela, e quem escreve são as duas RPCs.
 *
 * NADA SE APAGA. Pedido recusado continua guardado, com o motivo; a selfie
 * dele também. Por isso não há "cancelar pedido" nesta tela: o colaborador que
 * pediu errado pede de novo, e o admin recusa o errado com motivo.
 */

/** Colunas explícitas, numa linha só (senão o supabase-js perde a tipagem). */
const COLUNAS_DO_PEDIDO =
  'id, usuario_id, horario_declarado, dia_civil, motivo, pedido_em, selfie_path, latitude, longitude, precisao_metros, distancia_metros, no_local, estado, decidido_por, decidido_em, motivo_decisao, registro_id, funcionario_nome, funcionario_email'

const traduzirParaOPainel = (mensagem: string) => new ErroDoPainel(mensagem)
const traduzirParaOColaborador = (mensagem: string) => new ErroDoPedido(mensagem)

/**
 * Os pedidos de uma pessoa num intervalo de dias civis — para a tela de bater
 * (o dia de hoje) e o espelho (o mês). A RLS limita ao dono; o filtro por
 * `usuario_id` é porque um admin enxerga todo mundo e esta lista é "os MEUS".
 */
export async function lerMeusPedidos(
  usuarioId: string,
  inicio: string,
  fim: string,
): Promise<PedidoDeAtraso[]> {
  const linhas = await lerTodasAsPaginas(
    (de, ate) =>
      supabase
        .from('ponto_pedidos_atraso')
        .select(COLUNAS_DO_PEDIDO)
        .eq('usuario_id', usuarioId)
        .gte('dia_civil', inicio)
        .lte('dia_civil', fim)
        .order('horario_declarado', { ascending: true })
        .order('id', { ascending: true })
        .range(de, ate),
    traduzirParaOColaborador,
  )
  return linhas as unknown as PedidoDeAtraso[]
}

/**
 * Todos os pedidos pendentes, de todo mundo, do mais antigo para o mais novo —
 * a caixa de pendências do admin. Sem recorte de período: pendência de ontem
 * continua pendência (a regra do "mesmo dia" é para PEDIR, não para decidir).
 */
export async function lerPedidosPendentes(): Promise<PedidoDeAtraso[]> {
  const linhas = await lerTodasAsPaginas(
    (de, ate) =>
      supabase
        .from('ponto_pedidos_atraso')
        .select(COLUNAS_DO_PEDIDO)
        .eq('estado', 'pendente')
        .order('pedido_em', { ascending: true })
        .order('id', { ascending: true })
        .range(de, ate),
    traduzirParaOPainel,
  )
  return linhas as unknown as PedidoDeAtraso[]
}

/**
 * Os pedidos APROVADOS de um período (de todo mundo ou de uma pessoa) — é
 * deles que sai o nome de quem aprovou cada batida de atraso no painel, na
 * folha e no CSV. Pendente e recusado não entram: não têm batida.
 */
export async function lerPedidosAprovadosDoPeriodo(
  periodo: Periodo,
  usuarioId?: string,
): Promise<PedidoDeAtraso[]> {
  const linhas = await lerTodasAsPaginas((de, ate) => {
    const consulta = supabase
      .from('ponto_pedidos_atraso')
      .select(COLUNAS_DO_PEDIDO)
      .eq('estado', 'aprovado')
      .gte('dia_civil', periodo.inicio)
      .lte('dia_civil', periodo.fim)
      .order('horario_declarado', { ascending: true })
      .order('id', { ascending: true })
      .range(de, ate)
    return usuarioId ? consulta.eq('usuario_id', usuarioId) : consulta
  }, traduzirParaOPainel)
  return linhas as unknown as PedidoDeAtraso[]
}

/**
 * As contas que têm pedido de batida em atraso num período, em QUALQUER estado
 * (pendente, aprovado ou recusado).
 *
 * É uma das portas de "quem é do ponto" no painel (`montarLinhasDoPainel`):
 * quem pediu batida no mês aparece mesmo sem ficha e sem batida. O recusado
 * conta também: a pessoa tentou bater, e o fechamento precisa vê-la.
 *
 * Só `usuario_id`: o painel não usa o resto, e a caixa de pendências tem a
 * leitura dela. PARTE DA CARGA, e não de melhor esforço, como as fichas: se
 * falhar, o painel mostra o erro em vez de uma lista sem alguém.
 */
export async function lerContasComPedidoNoPeriodo(periodo: Periodo): Promise<Set<string>> {
  const linhas = await lerTodasAsPaginas(
    (de, ate) =>
      supabase
        .from('ponto_pedidos_atraso')
        .select('id, usuario_id')
        .gte('dia_civil', periodo.inicio)
        .lte('dia_civil', periodo.fim)
        // Ordem estável, exigida pela paginação.
        .order('id', { ascending: true })
        .range(de, ate),
    traduzirParaOPainel,
  )
  return new Set((linhas as unknown as { usuario_id: string }[]).map((linha) => linha.usuario_id))
}

/**
 * Os nomes de quem decidiu (conta -> nome), pela lista de contas do ponto
 * (`lerNomesDasContas`: `ponto_contas()` e as fichas, pela regra única —
 * ficha, nome guardado na conta, e-mail).
 *
 * DE MELHOR ESFORÇO, E ISSO É DE PROPÓSITO. O nome é o enfeite da marca — "em
 * atraso, aprovada POR FULANO". O fato ("em atraso, aprovada") vem da própria
 * batida. Se a leitura falhar, a marca sai sem o nome em vez de derrubar o
 * espelho inteiro.
 *
 * SÓ QUEM ADMINISTRA LÊ AS CONTAS: para o colaborador, `ponto_contas()`
 * recusa. As telas dele (bater e espelho) nem chamam esta função — ver
 * `Bater.tsx` e `Espelho.tsx` —, e a marca dele sai "Aprovado."
 *
 * @param conhecidos nomes que a tela já tem na mão (a lista de funcionários do
 *   painel): com todos conhecidos, nada é lido.
 */
export async function lerNomesDeQuemDecidiu(
  pedidos: readonly Pick<PedidoDeAtraso, 'decidido_por'>[],
  conhecidos: ReadonlyMap<string, string> = new Map(),
): Promise<Map<string, string>> {
  const nomes = new Map(conhecidos)
  const faltam = [
    ...new Set(
      pedidos
        .map((pedido) => pedido.decidido_por)
        .filter((id): id is string => Boolean(id) && !nomes.has(id as string)),
    ),
  ]
  if (faltam.length === 0) return nomes

  try {
    const daLista = await lerNomesDasContas()
    for (const usuarioId of faltam) {
      const nome = daLista.get(usuarioId)
      if (nome !== undefined) nomes.set(usuarioId, nome)
    }
  } catch (falha) {
    console.warn('Nomes de quem decidiu os pedidos de atraso não foram lidos:', falha)
  }
  return nomes
}

/**
 * Quem aprovou cada batida em atraso de um período (`pedido_id -> nome`), para
 * o painel, a folha e o CSV. NUNCA LEVANTA: falhou, devolve o mapa vazio, e as
 * batidas de atraso saem marcadas sem o nome — a marca vem da própria batida.
 * Derrubar o fechamento do mês por causa de um nome seria trocar o essencial
 * pelo enfeite.
 */
export async function lerAprovadoresDoPeriodo(
  periodo: Periodo,
  conhecidos: ReadonlyMap<string, string>,
  usuarioId?: string,
): Promise<Map<string, string | null>> {
  try {
    const pedidos = await lerPedidosAprovadosDoPeriodo(periodo, usuarioId)
    return aprovadoresDosPedidos(pedidos, await lerNomesDeQuemDecidiu(pedidos, conhecidos))
  } catch (falha) {
    console.warn('Quem aprovou as batidas em atraso do período não foi lido:', falha)
    return new Map()
  }
}

/* ------------------------------------------------------------------ */
/* A decisão do admin                                                  */
/* ------------------------------------------------------------------ */

/**
 * Retorno de `ponto_decidir_pedido_atraso`. Na aprovação vem também a batida
 * criada — já com tipo e ordem do dia DEPOIS da reordenação pelo relógio.
 */
export type RespostaDaDecisao =
  | {
      decidido: true
      estado: 'recusado'
      pedido: Pick<
        PedidoDeAtraso,
        'id' | 'usuario_id' | 'horario_declarado' | 'dia_civil' | 'estado' | 'decidido_por' | 'decidido_em' | 'motivo_decisao'
      >
    }
  | {
      decidido: true
      estado: 'aprovado'
      pedido: Pick<
        PedidoDeAtraso,
        | 'id'
        | 'usuario_id'
        | 'horario_declarado'
        | 'dia_civil'
        | 'estado'
        | 'decidido_por'
        | 'decidido_em'
        | 'motivo_decisao'
        | 'registro_id'
      >
      registro: Pick<
        BatidaDoAdmin,
        | 'id'
        | 'registrado_em'
        | 'dia_civil'
        | 'tipo'
        | 'ordem_no_dia'
        | 'distancia_metros'
        | 'no_local'
        | 'origem'
        | 'ajuste_manual'
        | 'pedido_atraso_id'
      >
    }

/**
 * As recusas da decisão, pelas frases da RPC de decidir o pedido. O
 * resto — sessão, "exclusivo de quem administra o ponto", rede — é a tradução
 * do painel.
 */
function traduzirErroDaDecisao(mensagem: string): string {
  if (/Quem pediu a batida em atraso nao decide o proprio pedido/.test(mensagem)) {
    return 'Você não pode decidir o seu próprio pedido. Peça a outra pessoa que administra o ponto.'
  }
  if (/Pedido de batida em atraso ja decidido/.test(mensagem)) {
    return 'Este pedido já foi decidido — talvez por outra pessoa, agora há pouco. A lista foi atualizada.'
  }
  if (/Pedido de batida em atraso nao encontrado/.test(mensagem)) {
    return 'Este pedido não foi encontrado. A lista foi atualizada.'
  }
  if (/Recusar pedido de batida em atraso exige motivo/.test(mensagem)) {
    return 'Escreva o motivo da recusa — a pessoa vai ler esse texto.'
  }
  if (/Selfie do pedido nao esta mais no bucket/.test(mensagem)) {
    return 'A selfie deste pedido não está mais guardada. Sem a prova, a batida não é criada: recuse o pedido com motivo.'
  }
  if (/Ja existe batida desta pessoa no mesmo minuto do pedido/.test(mensagem)) {
    return 'Esta pessoa já tem uma batida neste mesmo minuto — aprovar duplicaria a batida. Recuse o pedido com motivo.'
  }
  if (/Decisao exige o pedido/.test(mensagem)) {
    return 'A decisão não chegou inteira ao servidor. Tente de novo.'
  }
  return new ErroDoPainel(mensagem).message
}

/** Erro da decisão, já traduzido. `releitura` diz se a lista na tela ficou velha. */
export class ErroDaDecisao extends Error {
  readonly releitura: boolean
  constructor(mensagem: string) {
    super(traduzirErroDaDecisao(mensagem))
    this.name = 'ErroDaDecisao'
    this.releitura = /ja decidido|nao encontrado/.test(mensagem)
  }
}

/** O aviso acima da lista: o de decisão gravada, ou o de lista que ficou velha. */
export type AvisoDaLista = { tom: 'bom' | 'atencao'; texto: string }

/**
 * O que fazer com a falha de uma decisão. "Já decidido" e "não encontrado"
 * querem dizer que a lista na tela ficou velha — outra pessoa decidiu antes.
 * Aí a caixa fecha e a lista é relida, mas A FRASE TEM DE APARECER: sem ela, o
 * pedido some da lista como se a decisão DESTE admin tivesse sido gravada — e
 * pode ter sido o contrário (ele aprovou, o outro tinha recusado).
 */
export function desfechoDaFalhaDaDecisao(
  falha: unknown,
): { nome: 'lista_velha'; aviso: AvisoDaLista } | { nome: 'erro'; mensagem: string } {
  if (falha instanceof ErroDaDecisao && falha.releitura) {
    return { nome: 'lista_velha', aviso: { tom: 'atencao', texto: falha.message } }
  }
  return {
    nome: 'erro',
    mensagem: falha instanceof Error ? falha.message : 'Não deu para gravar a decisão.',
  }
}

/**
 * Aprova ou recusa um pedido. O banco confere tudo de novo: quem administra,
 * que não é o próprio pedido, que está pendente (travado `FOR UPDATE`: duas
 * decisões ao mesmo tempo não passam), o motivo da recusa e, na aprovação, que
 * a selfie ainda está no bucket e que a pessoa não tem batida naquele minuto.
 */
export async function decidirPedido(entrada: {
  pedidoId: string
  aprovar: boolean
  motivo: string
}): Promise<RespostaDaDecisao> {
  const motivo = entrada.motivo.trim()
  if (!entrada.aprovar && !motivo) {
    throw new ErroDaDecisao('Recusar pedido de batida em atraso exige motivo')
  }

  const { data, error } = await supabase.rpc('ponto_decidir_pedido_atraso', {
    p_pedido_id: entrada.pedidoId,
    p_aprovar: entrada.aprovar,
    // Aprovar sem motivo vai como nulo: o banco guarda `motivo_decisao` nulo,
    // e não uma string vazia que pareceria motivo.
    p_motivo: motivo || null,
  })
  if (error) throw new ErroDaDecisao(error.message)
  return data as RespostaDaDecisao
}
