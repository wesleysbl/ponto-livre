/*
 * DESCARTAR A SELFIE, OU NÃO — a decisão de `registrarBatida`, pura, para poder
 * ser testada no Node sem `supabase.ts`.
 *
 * A FOTO SOBE ANTES DA BATIDA
 * `ponto_registrar_batida` só grava se a selfie já estiver no bucket. Quando a
 * batida não acontece, a foto fica sem batida, e o app PEDE para jogá-la fora
 * (`descartarSelfie`, pela policy "dono descarta selfie sem batida").
 *
 * O BANCO NÃO APAGA FOTO RECÉM-ENVIADA
 * As duas policies de DELETE do bucket (a do dono e a de quem administra) só
 * soltam a foto com mais de 16 minutos: a RPC aceita a foto por 15 e só a liga
 * à batida no COMMIT, e um DELETE no meio apagaria a prova de uma batida que
 * está sendo gravada. Por isso o pedido que o app faz logo depois da recusa não
 * apaga nada: o storage responde sem erro, com zero arquivos, e a foto fica no
 * bucket, solta. Ela não vira ponto de ninguém (só ocupa espaço e conta no
 * teto de envios); depois dos 16 minutos a dona ou quem administra pode
 * apagá-la, e quem quiser o bucket limpo apaga as soltas mais velhas com a
 * chave de serviço.
 *
 * O DEFEITO QUE A REGRA DESTE ARQUIVO EVITA
 * Pedir o descarte em QUALQUER falha da RPC pediria para apagar também quando
 * a resposta só se perdeu: o 4G caiu, o gateway devolveu 504, o `fetch` falhou
 * depois de a requisição chegar. Nesses casos o servidor pode ter gravado a
 * batida (e, com ela, ligado a foto) ou pode estar gravando naquele instante.
 * O banco segura a foto recém-enviada (acima), e a selfie de batida gravada
 * nenhuma policy solta; mesmo assim, o app só pede o descarte quando sabe que
 * nenhuma batida existe nem vai existir.
 *
 * A REGRA
 * Só se pede o descarte depois de uma recusa DEFINITIVA, que prova que nenhuma
 * batida existe e nenhuma vai existir:
 *   • a RPC respondeu `{gravado: false}` com um motivo que o app conhece (PIN
 *     errado, bloqueio, duplicidade, PIN a definir ou a redefinir);
 *   • a RPC respondeu com um erro do PRÓPRIO Postgres (código SQLSTATE de 5
 *     caracteres) num status 4xx — a recusa veio de dentro da função, e a
 *     transação inteira voltou: "Conta sem acesso", "Selfie nao
 *     encontrada", "Coordenada fora"...
 * Todo o resto é INCERTO: rede (status 0), 5xx, 408, 429, código do PostgREST,
 * erro sem código, exceção, resposta sem forma. Aí a foto fica — órfã, ela é
 * inofensiva: não vira ponto de ninguém — e a tela pede para conferir a lista
 * de hoje antes de bater de novo.
 */

/** O que voltou da chamada da RPC de batida. */
export type DesfechoDaGravacao =
  /** O banco respondeu (o corpo da resposta, ainda sem conferir a forma). */
  | { tipo: 'resposta'; dados: unknown }
  /** O supabase-js devolveu `{ error }`, com o status HTTP e o código. */
  | { tipo: 'erro'; status: number | null; codigo: string | null }
  /** A chamada lançou exceção. */
  | { tipo: 'excecao' }

/**
 * `descartar`: recusa definitiva, a foto é órfã de verdade.
 * `manter`:    a batida foi gravada (a foto é a prova), ou o banco recusou com
 *              um motivo que este app não conhece — a foto fica, por via das
 *              dúvidas.
 * `incerto`:   não se sabe se gravou. A foto fica e a tela manda conferir.
 */
export type DestinoDaSelfie = 'descartar' | 'manter' | 'incerto'

/** Os motivos de `{gravado: false}` que `ponto_registrar_batida` devolve hoje. */
export const MOTIVOS_DE_RECUSA_DEFINITIVA: readonly string[] = [
  'pin_nao_definido',
  'precisa_redefinir',
  'batida_duplicada',
  'pin_incorreto',
  'bloqueado',
]

/*
 * O PEDIDO DE BATIDA EM ATRASO SEGUE A MESMA REGRA.
 * `ponto_pedir_batida_em_atraso` também sobe a foto antes e devolve
 * `{gravado: false}` com as recusas do PIN (as mesmas da batida, pela mesma
 * `ponto_verificar_pin`) e uma própria, `pedido_duplicado` — o índice único
 * recusou, e nenhum pedido NOVO existe com esta foto. Não tem
 * `batida_duplicada`: a duplicidade com batida do mesmo minuto vem como erro
 * levantado pela RPC (recusa do banco, que já descarta).
 * A resposta perdida é tão incerta quanto na batida: o pedido pode ter sido
 * gravado com esta foto, e descartá-la apagaria a prova do pedido.
 */
export const MOTIVOS_DE_RECUSA_DEFINITIVA_DO_PEDIDO: readonly string[] = [
  'pin_nao_definido',
  'precisa_redefinir',
  'pedido_duplicado',
  'pin_incorreto',
  'bloqueado',
]

/*
 * Classes de SQLSTATE que não são recusa da regra, mesmo que cheguem num 4xx:
 * conexão (08), transação desfeita por concorrência (40), recursos (53),
 * intervenção do operador e tempo esgotado (57), sistema (58), interno (XX).
 */
const CLASSES_QUE_NAO_SAO_RECUSA = /^(?:08|40|53|57|58|XX)/

/** Erro levantado pelo Postgres dentro da RPC: a transação voltou e não há batida. */
export function ehRecusaDoBanco(status: number | null, codigo: string | null): boolean {
  if (status === null || status < 400 || status >= 500 || status === 408 || status === 429) return false
  if (codigo === null || !/^[0-9A-Z]{5}$/.test(codigo)) return false
  return !CLASSES_QUE_NAO_SAO_RECUSA.test(codigo)
}

/**
 * `motivos`: as recusas definitivas da RPC em questão — a da batida por padrão,
 * `MOTIVOS_DE_RECUSA_DEFINITIVA_DO_PEDIDO` no pedido de batida em atraso.
 */
export function destinoDaSelfie(
  desfecho: DesfechoDaGravacao,
  motivos: readonly string[] = MOTIVOS_DE_RECUSA_DEFINITIVA,
): DestinoDaSelfie {
  switch (desfecho.tipo) {
    case 'resposta': {
      const dados = desfecho.dados
      if (typeof dados !== 'object' || dados === null || !('gravado' in dados)) return 'incerto'
      const { gravado, motivo } = dados as { gravado: unknown; motivo?: unknown }
      if (gravado === true) return 'manter'
      if (gravado !== false) return 'incerto'
      return typeof motivo === 'string' && motivos.includes(motivo) ? 'descartar' : 'manter'
    }
    case 'erro':
      return ehRecusaDoBanco(desfecho.status, desfecho.codigo) ? 'descartar' : 'incerto'
    case 'excecao':
      return 'incerto'
  }
}

/** O que a tela diz quando não dá para saber se a batida foi gravada. */
export const BATIDA_INCERTA = {
  titulo: 'Batida não confirmada',
  mensagem: 'A resposta do servidor não chegou, e a batida pode ter sido gravada.',
  comoResolver:
    'Confira suas batidas de hoje antes de bater de novo: se ela estiver na lista, valeu. Se não estiver, bata outra vez.',
  rodape: 'Não dá para saber daqui se o servidor gravou. Ao voltar, a lista de hoje é lida de novo do servidor.',
} as const

/** O mesmo, para o pedido de batida em atraso: o pedido pode ter sido gravado. */
export const PEDIDO_INCERTO = {
  titulo: 'Pedido não confirmado',
  mensagem: 'A resposta do servidor não chegou, e o pedido pode ter sido gravado.',
  comoResolver:
    'Confira seus pedidos de hoje antes de pedir de novo: se ele estiver na lista, valeu. Se não estiver, peça outra vez.',
  rodape: 'Não dá para saber daqui se o servidor gravou. Ao voltar, os pedidos de hoje são lidos de novo do servidor.',
} as const
