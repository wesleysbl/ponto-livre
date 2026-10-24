import { useState, type FormEvent } from 'react'
import { Ban, CalendarX2, FileText, X } from 'lucide-react'
import {
  descreverPeriodo,
  ehAtiva,
  MOTIVO_DO_CANCELAMENTO_MAXIMO,
  ROTULO_DO_TIPO_DE_AUSENCIA,
  validarMotivoDoCancelamento,
  type Ausencia,
} from '../lib/ausencias'
import { cancelarAusencia } from '../lib/faltas'
import { formatarMomento } from '../lib/formato'
import { Aviso, Botao, Modal } from './ui'

/*
 * AS AUSÊNCIAS DO PERÍODO, UMA POR CARTÃO — no painel da pessoa (com
 * as canceladas e o botão de cancelar) e no espelho do colaborador (só as
 * ativas, sem botão).
 *
 * POR QUE UMA LISTA, ALÉM DA MARCA NO DIA: a marca diz "este dia teve falta";
 * o cartão diz a ausência INTEIRA — o período (um atestado de 3 dias é uma
 * ausência só), o tipo, a observação, o atestado, quem lançou e quando. E, se
 * cancelada, quem cancelou, quando e por quê: nada se apaga, e o cancelamento
 * é o único jeito de corrigir (cancela e lança de novo).
 */

interface Props {
  titulo: string
  ausencias: readonly Ausencia[]
  /** O nome de quem lançou ou cancelou. O admin tem a lista; o colaborador, não. */
  nomeDe?: (usuarioId: string) => string | null
  aoAbrirAtestado: (ausencia: Ausencia) => void
  /** Só para quem administra: abre a caixa de cancelamento. */
  aoCancelar?: (ausencia: Ausencia) => void
}

export function AusenciasDoPeriodo({ titulo, ausencias, nomeDe, aoAbrirAtestado, aoCancelar }: Props) {
  if (ausencias.length === 0) return null

  return (
    <section className="mt-6" aria-label={titulo}>
      <h2 className="mb-2 flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
        <CalendarX2 size={12} aria-hidden="true" />
        {titulo}
      </h2>
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
        {ausencias.map((ausencia) => (
          <CartaoDaAusencia
            key={ausencia.id}
            ausencia={ausencia}
            nomeDe={nomeDe}
            aoAbrirAtestado={aoAbrirAtestado}
            aoCancelar={aoCancelar}
          />
        ))}
      </ul>
    </section>
  )
}

function CartaoDaAusencia({
  ausencia,
  nomeDe,
  aoAbrirAtestado,
  aoCancelar,
}: {
  ausencia: Ausencia
  nomeDe?: (usuarioId: string) => string | null
  aoAbrirAtestado: (ausencia: Ausencia) => void
  aoCancelar?: (ausencia: Ausencia) => void
}) {
  const ativa = ehAtiva(ausencia)
  const quemLancou = nomeDe?.(ausencia.lancado_por)
  const quemCancelou = ausencia.cancelada_por ? nomeDe?.(ausencia.cancelada_por) : null

  return (
    <li className={`rounded-2xl border border-hair bg-ink-1 px-4 py-3 ${ativa ? '' : 'opacity-75'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-plat">{ROTULO_DO_TIPO_DE_AUSENCIA[ausencia.tipo]}</p>
        <p className="font-mono text-[0.7rem] text-plat-dim tabular-nums">{descreverPeriodo(ausencia)}</p>
      </div>

      {!ativa && (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-warn/35 bg-warn-soft px-1.5 py-0.5 text-[0.62rem] font-medium text-warn">
          <Ban size={10} aria-hidden="true" />
          cancelada — não marca a folha
        </p>
      )}

      {ausencia.observacao && (
        <p className="mt-1.5 text-xs leading-relaxed break-words text-plat-dim">{ausencia.observacao}</p>
      )}

      <p className="mt-1.5 text-[0.68rem] leading-relaxed text-faint">
        Lançada {quemLancou ? `por ${quemLancou} ` : ''}em {formatarMomento(ausencia.lancado_em)}
        {ausencia.atestado_path ? ' · com atestado' : ' · sem atestado'}
      </p>

      {!ativa && ausencia.cancelada_em && (
        <p className="mt-1 text-[0.68rem] leading-relaxed break-words text-mute">
          Cancelada {quemCancelou ? `por ${quemCancelou} ` : ''}em {formatarMomento(ausencia.cancelada_em)}
          {ausencia.motivo_cancelamento ? `: “${ausencia.motivo_cancelamento}”` : ''}
        </p>
      )}

      {(ausencia.atestado_path || (ativa && aoCancelar)) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {ausencia.atestado_path && (
            <button
              type="button"
              onClick={() => aoAbrirAtestado(ausencia)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-hair-2 bg-ink-2 px-3 text-xs text-plat-dim transition-colors hover:border-hair-3 hover:text-plat"
            >
              <FileText size={13} aria-hidden="true" />
              Ver o atestado
            </button>
          )}
          {ativa && aoCancelar && (
            <button
              type="button"
              onClick={() => aoCancelar(ausencia)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs text-mute transition-colors hover:text-warn"
            >
              <Ban size={13} aria-hidden="true" />
              Cancelar
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* O cancelamento                                                      */
/* ------------------------------------------------------------------ */

interface PropsDoCancelamento {
  ausencia: Ausencia
  nomeDaPessoa: string
  aoFechar: () => void
  aoCancelada: () => void
}

/**
 * Cancelar exige motivo, e é para sempre: a ausência continua guardada, com o
 * motivo, quem cancelou e quando, e deixa de marcar a folha. Para corrigir um
 * período errado, cancela-se e lança-se de novo.
 */
export function CaixaDeCancelamento({ ausencia, nomeDaPessoa, aoFechar, aoCancelada }: PropsDoCancelamento) {
  const [motivo, setMotivo] = useState('')
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    setErro(null)
    const conferido = validarMotivoDoCancelamento(motivo)
    if (!conferido.ok) {
      setErro(conferido.erro)
      return
    }
    setGravando(true)
    try {
      await cancelarAusencia({ ausenciaId: ausencia.id, motivo: conferido.motivo })
      aoCancelada()
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não deu para cancelar a ausência.')
      setGravando(false)
    }
  }

  return (
    <Modal rotulo="Cancelar ausência" aoFechar={aoFechar} podeFechar={!gravando}>
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              Cancelar ausência
            </p>
            <h2 className="mt-1 truncate text-base font-semibold text-plat">{nomeDaPessoa}</h2>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            disabled={gravando}
            aria-label="Fechar"
            className="-mt-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat disabled:opacity-40"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5 text-xs leading-relaxed text-mute">
          {ROTULO_DO_TIPO_DE_AUSENCIA[ausencia.tipo]} ·{' '}
          <span className="font-mono text-plat">{descreverPeriodo(ausencia)}</span>. O cancelamento
          é definitivo: a ausência continua guardada, com o motivo e o seu nome, e deixa de marcar a
          folha. O atestado, se houver, também fica guardado.
        </p>

        <form onSubmit={(evento) => void enviar(evento)} className="mt-4 space-y-3">
          <div>
            <label htmlFor="cancelamento-motivo" className="mb-1 block text-sm font-medium text-plat-dim">
              Motivo <span className="text-warn">(obrigatório)</span>
            </label>
            <textarea
              id="cancelamento-motivo"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              rows={3}
              maxLength={MOTIVO_DO_CANCELAMENTO_MAXIMO}
              disabled={gravando}
              placeholder="Ex.: período lançado errado; lançado de novo com o dia certo"
              className="w-full min-h-11 resize-y rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5 text-sm text-plat placeholder:text-faint focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25"
            />
          </div>

          {erro && <Aviso tom="erro">{erro}</Aviso>}

          <div className="flex flex-col gap-2 pt-1">
            <Botao type="submit" disabled={gravando}>
              <Ban size={16} aria-hidden="true" />
              {gravando ? 'Cancelando…' : 'Cancelar a ausência'}
            </Botao>
            <Botao type="button" tom="discreto" onClick={aoFechar} disabled={gravando}>
              Voltar
            </Botao>
          </div>
        </form>
      </>
    </Modal>
  )
}
