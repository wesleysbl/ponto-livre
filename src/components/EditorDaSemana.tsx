import { Plus, X } from 'lucide-react'
import { formatarDuracao } from '../lib/horas'
import { totalDoDiaDaSemana, type DiaDaSemanaIso, type Jornada } from '../lib/jornada'
import {
  DIAS_DA_SEMANA,
  acrescentarBloco,
  horariosDoDia,
  mudarBloco,
  nomeDoDia,
  ordinalDoBloco,
  podeAcrescentarBloco,
  tirarBloco,
  totalDaSemanaNoRascunho,
  totalDoDiaNoRascunho,
  totalForaDaFaixa,
  type RascunhoDaSemana,
} from '../lib/semana-da-jornada'

/*
 * O EDITOR DA SEMANA: os sete dias da jornada, cada um com até dois blocos de
 * início e fim, e o total do dia calculado enquanto se digita.
 *
 * SERVE ÀS DUAS TELAS: a jornada da empresa (administração) e a jornada própria
 * (ficha do funcionário). Quem lê e confere o que foi digitado é
 * `semana-da-jornada.ts`; aqui só se desenha e se repassa a mudança.
 *
 * CABE EM 320 px SEM ROLAR DE LADO: os dias são EMPILHADOS (um cartão por dia) e
 * só passam a dividir a linha quando o PRÓPRIO editor tem largura (`@container`,
 * e não a tela: no computador o editor da ficha mora num diálogo estreito). Cada
 * bloco é uma linha com o início, o fim e o botão de tirar, de 44 px.
 *
 * O TERCEIRO BLOCO NÃO EXISTE: com dois blocos no dia o botão de acrescentar
 * some. A regra é do banco (no máximo dois por dia), e a leitura também a
 * confere, com a frase dele.
 */

/** "na segunda", "no sábado": o rótulo do botão diz de que dia ele é. */
function noDia(dia: DiaDaSemanaIso): string {
  return `${dia >= 6 ? 'no' : 'na'} ${nomeDoDia(dia).toLowerCase()}`
}

/**
 * O campo de horário: o de `ui.tsx` com menos folga dos lados, para caber o par.
 *
 * NO CARTÃO ESTREITO O ÍCONE DO RELÓGIO SAI (`@max-[17rem]`, medido no cartão do
 * dia, que é um `@container`). Com ele, o campo pede uns 98 px para mostrar
 * "08:00" inteiro; sem ele, 67. Num celular de 320 a 360 px o par de campos
 * ganha de 71 a 91 px cada, e o horário aparecia cortado ("08:0"). No celular o
 * seletor nativo abre ao tocar no campo, com ou sem o ícone; onde há largura o
 * ícone continua.
 *
 * `min-w-0` no campo e na coluna: sem eles, o `<input>` guarda a largura
 * mínima que o navegador dá a ele e empurra a linha para fora do cartão.
 */
const CAMPO_DE_HORA =
  'w-full min-w-0 min-h-11 rounded-xl border border-plat/40 bg-ink-1 px-2.5 py-2.5 text-sm text-plat ' +
  '@max-[17rem]:[&::-webkit-calendar-picker-indicator]:hidden ' +
  'tabular-nums transition-colors focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25 ' +
  'disabled:opacity-60'

function TotalDoDia({ minutos, semBlocos }: { minutos: number | null; semBlocos: boolean }) {
  if (semBlocos) return <span className="text-faint">Sem jornada</span>
  if (minutos === null) return <span className="text-warn">Confira os horários</span>
  if (totalForaDaFaixa(minutos)) {
    return <span className="text-warn">{formatarDuracao(minutos)}, fora de 1h a 12h</span>
  }
  return <span className="text-plat-dim">{formatarDuracao(minutos)}</span>
}

export function EditorDaSemana({
  idBase,
  semana,
  aoMudar,
  desabilitado = false,
}: {
  /** Prefixo dos `id` dos campos: dois editores na mesma página não podem repetir. */
  idBase: string
  semana: RascunhoDaSemana
  aoMudar: (semana: RascunhoDaSemana) => void
  desabilitado?: boolean
}) {
  const totalDaSemana = totalDaSemanaNoRascunho(semana)

  return (
    <div className="@container">
      <ul className="grid grid-cols-1 gap-2 @min-[34rem]:grid-cols-2 @min-[56rem]:grid-cols-4">
        {DIAS_DA_SEMANA.map((dia) => {
          const blocos = semana[dia]
          const nome = nomeDoDia(dia)
          const idDoDia = `${idBase}-dia-${dia}`
          return (
            <li
              key={dia}
              aria-labelledby={idDoDia}
              className="@container min-w-0 rounded-xl border border-hair bg-ink-2 px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p id={idDoDia} className="text-sm font-medium text-plat">
                  {nome}
                </p>
                {/* `aria-live`: quem usa leitor de tela ouve o total mudar ao
                    trocar um horário, como quem enxerga vê. */}
                <p className="font-mono text-xs tabular-nums" aria-live="polite">
                  <span className="sr-only">Total de {nome.toLowerCase()}: </span>
                  <TotalDoDia minutos={totalDoDiaNoRascunho(blocos)} semBlocos={blocos.length === 0} />
                </p>
              </div>

              {blocos.map((bloco, indice) => {
                const ordinal = ordinalDoBloco(indice)
                const idDoBloco = `${idBase}-${dia}-${indice}`
                return (
                  <div
                    key={indice}
                    role="group"
                    aria-label={`${nome}, ${ordinal} bloco`}
                    className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-end gap-2"
                  >
                    <div className="min-w-0">
                      <label htmlFor={`${idDoBloco}-inicio`} className="mb-1 block text-[0.7rem] text-plat-dim">
                        Início
                      </label>
                      <input
                        id={`${idDoBloco}-inicio`}
                        type="time"
                        step={60}
                        value={bloco.inicio}
                        disabled={desabilitado}
                        onChange={(evento) => aoMudar(mudarBloco(semana, dia, indice, 'inicio', evento.target.value))}
                        className={CAMPO_DE_HORA}
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={`${idDoBloco}-fim`} className="mb-1 block text-[0.7rem] text-plat-dim">
                        Fim
                      </label>
                      <input
                        id={`${idDoBloco}-fim`}
                        type="time"
                        step={60}
                        value={bloco.fim}
                        disabled={desabilitado}
                        onChange={(evento) => aoMudar(mudarBloco(semana, dia, indice, 'fim', evento.target.value))}
                        className={CAMPO_DE_HORA}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => aoMudar(tirarBloco(semana, dia, indice))}
                      disabled={desabilitado}
                      aria-label={`Tirar o ${ordinal} bloco de ${nome.toLowerCase()}`}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat disabled:opacity-40"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                )
              })}

              {podeAcrescentarBloco(semana, dia) ? (
                <button
                  type="button"
                  onClick={() => aoMudar(acrescentarBloco(semana, dia))}
                  disabled={desabilitado}
                  aria-label={`${blocos.length === 0 ? 'Acrescentar horário' : 'Acrescentar o segundo bloco'} ${noDia(dia)}`}
                  className="mt-1 -ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-luz transition-colors hover:text-plat disabled:opacity-40"
                >
                  <Plus size={14} aria-hidden="true" />
                  {blocos.length === 0 ? 'Acrescentar horário' : 'Acrescentar o segundo bloco'}
                </button>
              ) : (
                <p className="mt-2 text-[0.68rem] text-faint">Dois blocos, o máximo por dia.</p>
              )}
            </li>
          )
        })}
      </ul>

      <p className="mt-3 font-mono text-xs tabular-nums text-mute" aria-live="polite">
        Total da semana:{' '}
        {totalDaSemana === null ? (
          <span className="text-warn">confira os horários</span>
        ) : (
          <span className="text-plat-dim">{formatarDuracao(totalDaSemana)}</span>
        )}
      </p>
    </div>
  )
}

/**
 * A jornada só para ler: um dia por linha, com os horários e o total. É a
 * referência que a ficha mostra quando a pessoa segue a jornada da empresa, e
 * a jornada da ficha da própria sessão, que não se edita.
 */
export function ResumoDaJornada({ jornada }: { jornada: Jornada }) {
  return (
    <ul className="space-y-1">
      {DIAS_DA_SEMANA.map((dia) => {
        const horarios = horariosDoDia(jornada, dia)
        return (
          <li key={dia} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="shrink-0 text-plat-dim">{nomeDoDia(dia)}</span>
            {horarios ? (
              <span className="min-w-0 text-right font-mono tabular-nums text-plat">
                {horarios}{' '}
                <span className="text-mute">· {formatarDuracao(totalDoDiaDaSemana(jornada, dia))}</span>
              </span>
            ) : (
              <span className="text-faint">sem jornada</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
