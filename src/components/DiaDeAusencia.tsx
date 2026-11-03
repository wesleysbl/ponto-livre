import type { ReactNode } from 'react'
import { CalendarX2, FileText } from 'lucide-react'
import { marcaNoDia, type Ausencia } from '../lib/ausencias'
import { ancoraDoDia } from '../lib/corrigir'
import { formatarDuracao, rotuloDoDia } from '../lib/horas'
import type { CoberturaDoDia } from '../lib/saldo'
import { EtiquetasDoDia } from './EtiquetasDoDia'

/*
 * A AUSÊNCIA NAS LISTAS DE DIAS, no espelho do colaborador e no painel da
 * pessoa.
 *
 * DOIS DESENHOS, UMA MARCA
 *  • `MarcaDeAusencia`: a faixa no topo de um dia que TEM batidas. É o caso de
 *    borda "ausência e batida no mesmo dia": os dois aparecem, e as horas das
 *    batidas continuam contando: a marca não muda o trabalhado.
 *  • `DiaDeAusencia`: o dia que só tem a ausência. Ganha um cartão próprio, do
 *    mesmo formato do dia com batidas, com "sem horas" no lugar do total
 *    ("0h00" pareceria um dia trabalhado que deu errado).
 *
 * O PERÍODO NA MARCA. A marca diz o tipo e o intervalo ("Atestado 14:00-16:00",
 * "Atestado, dia inteiro", de `marcaNoDia`), uma por ausência, por dias
 * primeiro e os intervalos em ordem de início.
 *
 * O ABONO NA MARCA, QUANDO A TELA O TIVER. Cada marca diz também quanto a
 * ausência abonou ("Atestado 14:00-16:00 · abonou 2h00"), ou que "outro motivo"
 * não abona, a partir das coberturas do saldo do dia (`SaldoDoDia.coberturas`,
 * de `saldo.ts`). A conta é do saldo, e não daqui: sem as coberturas, a marca
 * sai só com o tipo e o período.
 *
 * O botão do atestado abre o `VisorDeAtestado`; quem o desenha é a tela, que
 * sabe se a pessoa pode ver (o admin vê todos; o colaborador, os próprios; e
 * quem recusa de verdade é a policy do bucket).
 *
 * NO PAINEL DA PESSOA, O DIA SÓ COM AUSÊNCIA TAMBÉM GANHA "INSERIR BATIDA
 * NESTE DIA": quem foi ao médico de manhã e voltou à tarde tem batida para
 * lançar nesse dia. O botão chega pelo pé do cartão (`children`), que só a tela
 * do painel preenche; no espelho do colaborador ele não existe, porque a RLS
 * recusaria. O id `dia-AAAA-MM-DD` e a etiqueta do fim de semana são os mesmos
 * dos outros dias do painel.
 */

interface PropsDaMarca {
  ausencias: readonly Ausencia[]
  aoAbrirAtestado?: (ausencia: Ausencia) => void
  /**
   * As coberturas do saldo do dia (`SaldoDoDia.coberturas`): o quanto cada
   * ausência abonou. Sem elas, a marca não fala de abono.
   */
  coberturas?: readonly CoberturaDoDia[]
}

/** "abonou 2h00", "não abona" ou nada (fora da cobrança, ou sem nada abonado). */
function abonoDaMarca(cobertura: CoberturaDoDia | undefined): string | null {
  if (!cobertura) return null
  if (!cobertura.abona) return 'não abona'
  return cobertura.minutosAbonados > 0 ? `abonou ${formatarDuracao(cobertura.minutosAbonados)}` : null
}

export function MarcaDeAusencia({ ausencias, aoAbrirAtestado, coberturas }: PropsDaMarca) {
  if (ausencias.length === 0) return null
  // Por dias primeiro (sem hora), depois os intervalos em ordem de início.
  const emOrdem = [...ausencias].sort((a, b) => (a.hora_inicio ?? '').localeCompare(b.hora_inicio ?? ''))
  return (
    <div className="mx-4 mb-1 space-y-1">
      {emOrdem.map((ausencia) => {
        const abono = abonoDaMarca(coberturas?.find((cobertura) => cobertura.ausencia.id === ausencia.id))
        return (
          <div
            key={ausencia.id}
            className="flex items-start gap-2 rounded-lg border border-luz/30 bg-luz-soft px-3 py-2 text-[0.7rem] leading-relaxed text-luz"
          >
            <CalendarX2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              {marcaNoDia(ausencia)}
              {abono && <span className="text-plat-dim">{` · ${abono}`}</span>}
            </span>
            {ausencia.atestado_path && aoAbrirAtestado && (
              <button
                type="button"
                onClick={() => aoAbrirAtestado(ausencia)}
                className="-my-1 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-1.5 font-medium underline-offset-2 hover:underline"
              >
                <FileText size={12} aria-hidden="true" />
                Atestado
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface PropsDoDia {
  dia: string
  ausencias: readonly Ausencia[]
  aoAbrirAtestado?: (ausencia: Ausencia) => void
  /** Sábado ou domingo (`DiaDaLista.fimDeSemana`, do painel): ganha a etiqueta. */
  fimDeSemana?: boolean
  /** O nome do feriado nacional (`DiaDaLista.feriado`, do painel): ganha a etiqueta. */
  feriado?: string | null
  /** O pé do cartão: as ações do admin sobre o dia. Sem ele, o cartão termina na marca. */
  children?: ReactNode
}

export function DiaDeAusencia({
  dia,
  ausencias,
  aoAbrirAtestado,
  fimDeSemana = false,
  feriado = null,
  children,
}: PropsDoDia) {
  return (
    <li id={ancoraDoDia(dia)} className="rounded-2xl border border-hair bg-ink-1">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-plat">
            <span className="truncate">{rotuloDoDia(dia)}</span>
            <EtiquetasDoDia fimDeSemana={fimDeSemana} feriado={feriado} />
          </p>
          <p className="mt-0.5 font-mono text-[0.62rem] tracking-wider text-faint">ausência</p>
        </div>
        <span className="shrink-0 text-[0.68rem] text-mute">sem horas</span>
      </div>
      <div className="pb-2">
        <MarcaDeAusencia ausencias={ausencias} aoAbrirAtestado={aoAbrirAtestado} />
      </div>
      {children && <div className="border-t border-hair px-4 py-2">{children}</div>}
    </li>
  )
}
