import { Clock, RefreshCw } from 'lucide-react'
import { descreverDecisao, ROTULO_DO_ESTADO, type PedidoDeAtraso } from '../lib/atraso'
import { formatarHora } from '../lib/formato'
import { rotuloDoDia } from '../lib/horas'
import { Aviso, Botao, Etiqueta } from './ui'

/*
 * OS PEDIDOS DE BATIDA EM ATRASO DA PRÓPRIA PESSOA — na tela de bater
 * (os de hoje) e no espelho (os do mês).
 *
 * SEPARADOS DAS BATIDAS, DE PROPÓSITO. Pedido não é batida: o pendente não
 * conta hora nenhuma, o recusado nunca vai contar, e o aprovado já virou uma
 * batida que aparece na lista de batidas com a marca dela. Misturar as duas
 * listas faria "08:00 · aguardando" parecer uma batida que vale — e a pessoa
 * acharia que o dia fechou.
 *
 * O RECUSADO MOSTRA O MOTIVO. "Recusado" sozinho não diz o que fazer; o motivo
 * que o admin escreveu, sim.
 */

const TOM_DO_ESTADO = {
  pendente: 'aviso',
  aprovado: 'bom',
  recusado: 'neutro',
} as const

interface Props {
  titulo: string
  pedidos: PedidoDeAtraso[]
  /** Conta -> nome, para "aprovado por…". Pode vir vazio: a frase sai sem o nome. */
  nomes?: ReadonlyMap<string, string>
  /** No espelho, cada pedido diz o dia; na tela de bater, todos são de hoje. */
  mostrarDia?: boolean
  erro?: string | null
  carregando?: boolean
  aoTentarDeNovo?: () => void
}

export function MeusPedidosDeAtraso({
  titulo,
  pedidos,
  nomes,
  mostrarDia = false,
  erro = null,
  carregando = false,
  aoTentarDeNovo,
}: Props) {
  // Sem pedido e sem erro, a seção nem aparece: quase todo dia é assim, e um
  // "nenhum pedido" fixo na tela de bater seria ruído para quem nunca esquece.
  if (!erro && pedidos.length === 0) return null

  return (
    <section className="mt-8">
      <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">{titulo}</h2>

      {erro && (
        <div className="mt-3 space-y-2">
          <Aviso tom="atencao">{erro}</Aviso>
          {aoTentarDeNovo && (
            <Botao tom="secundario" onClick={aoTentarDeNovo} disabled={carregando}>
              <RefreshCw size={15} aria-hidden="true" />
              {carregando ? 'Carregando…' : 'Tentar de novo'}
            </Botao>
          )}
        </div>
      )}

      {!erro && (
        <ul className="mt-3 divide-y divide-hair rounded-2xl border border-hair bg-ink-1">
          {pedidos.map((pedido) => (
            <li key={pedido.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Clock size={15} aria-hidden="true" className="shrink-0 text-mute" />
                <span className="font-mono text-base text-plat tabular-nums">
                  {formatarHora(pedido.horario_declarado)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-mute">
                  {mostrarDia ? `${rotuloDoDia(pedido.dia_civil)} · ` : ''}pedido às{' '}
                  {formatarHora(pedido.pedido_em)}
                </span>
                <Etiqueta tom={TOM_DO_ESTADO[pedido.estado]}>{ROTULO_DO_ESTADO[pedido.estado]}</Etiqueta>
              </div>
              <p className="mt-1.5 text-[0.7rem] leading-relaxed break-words text-faint italic">
                “{pedido.motivo}”
              </p>
              <p
                className={`mt-1 text-[0.7rem] leading-relaxed break-words ${
                  pedido.estado === 'recusado' ? 'text-warn' : 'text-mute'
                }`}
              >
                {descreverDecisao(pedido, nomes)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
