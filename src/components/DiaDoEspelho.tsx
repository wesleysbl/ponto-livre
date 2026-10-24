import { AlertTriangle, Camera, MapPin } from 'lucide-react'
import { formatarDistancia, formatarHora, ROTULO_CURTO, type Batida } from '../lib/batidas'
import { formatarDuracao, rotuloDoDia, type DiaDoEspelho as Dia } from '../lib/horas'
import { MarcaDeAjuste, MarcaDeAtraso, MarcaSemLocalizacao } from './MarcaDaBatida'
import { MarcaDeAusencia } from './DiaDeAusencia'
import { Etiqueta } from './ui'
import type { Ausencia } from '../lib/ausencias'

/*
 * Um dia do espelho: o cabeçalho com a data e o total, e as batidas embaixo.
 *
 * O TOTAL E A MARCA DE INCOMPLETO ANDAM JUNTOS
 * Quando o número de batidas é ímpar, o total do dia é zero — e mostrar "0h00"
 * sozinho pareceria defeito ("trabalhei o dia inteiro e o app diz zero"). Por
 * isso, no dia incompleto, o lugar do total é ocupado pela marca e pela frase
 * que diz o que aconteceu e o que fazer: falta batida, o dia não entra no
 * total, e quem conserta é o RH. Sem essa frase, o funcionário fica com um
 * número errado e nenhuma pista.
 *
 * HOJE NÃO É DIA INCOMPLETO. Às 10h, com a entrada batida, o dia de hoje tem
 * número ímpar de batidas — e é só um dia em andamento. A marca de alarme e o
 * "avise o RH" mandariam a pessoa reclamar de um dia que ainda não acabou. Hoje
 * ímpar ganha a etiqueta neutra "Em andamento"; a regra das horas (`horas.ts`)
 * não muda: o dia só soma quando fechar o par.
 *
 * A FOTO SAI DE CADA LINHA
 * Cada batida com selfie é um botão. A imagem em si só é pedida ao servidor
 * quando alguém toca — carregar 22 dias de miniaturas privadas exigiria uma URL
 * assinada por foto e derrubaria o 4G de quem só quer conferir horário.
 *
 * A BATIDA SEM LOCALIZAÇÃO ganha a etiqueta neutra
 * "sem localização" no lugar de "no local" / a distância: o GPS não
 * respondeu, e ela saiu com a selfie e o PIN.
 */

interface Props {
  dia: Dia
  aoAbrirSelfie: (batida: Batida) => void
  /** `pedido_id -> quem aprovou`, para a marca da batida em atraso. */
  aprovadores?: ReadonlyMap<string, string | null>
  /** Ausências ativas que cobrem este dia: a marca aparece, as horas não mudam. */
  ausencias?: readonly Ausencia[]
  aoAbrirAtestado?: (ausencia: Ausencia) => void
  /** Este dia é hoje: ímpar, ele está "Em andamento", e não incompleto. */
  ehHoje?: boolean
}

export function DiaDoEspelho({
  dia,
  aoAbrirSelfie,
  aprovadores,
  ausencias = [],
  aoAbrirAtestado,
  ehHoje = false,
}: Props) {
  const emAndamento = dia.incompleto && ehHoje
  const faltaBatida = dia.incompleto && !ehHoje

  return (
    <li className="rounded-2xl border border-hair bg-ink-1">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-plat">{rotuloDoDia(dia.dia)}</p>
          <p className="mt-0.5 font-mono text-[0.62rem] tracking-wider text-faint tabular-nums">
            {dia.batidas.length} {dia.batidas.length === 1 ? 'batida' : 'batidas'}
          </p>
        </div>

        {faltaBatida && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-warn/35 bg-warn-soft px-2 py-1 text-xs font-medium text-warn">
            <AlertTriangle size={12} aria-hidden="true" />
            Dia incompleto
          </span>
        )}
        {emAndamento && <Etiqueta tom="neutro">Em andamento</Etiqueta>}
        {!dia.incompleto && (
          <span className="shrink-0 font-mono text-lg text-plat tabular-nums">
            {formatarDuracao(dia.minutos)}
          </span>
        )}
      </div>

      {faltaBatida && (
        <p className="px-4 pb-1 text-xs leading-relaxed text-mute">
          Falta uma batida neste dia, por isso as horas dele não entram no total. Avise o RH qual
          horário faltou.
        </p>
      )}
      {emAndamento && (
        <p className="px-4 pb-1 text-xs leading-relaxed text-mute">
          Dia em andamento. As horas de hoje entram no total quando você bater a próxima.
        </p>
      )}

      <MarcaDeAusencia ausencias={ausencias} aoAbrirAtestado={aoAbrirAtestado} />

      <ul className="mt-1 divide-y divide-hair border-t border-hair">
        {dia.batidas.map((batida) => {
          const temFoto = Boolean(batida.selfie_path)

          const conteudo = (
            <>
              <span className="font-mono text-sm text-plat tabular-nums">
                {formatarHora(batida.registrado_em)}
              </span>

              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm text-plat-dim">
                  {ROTULO_CURTO[batida.tipo]}
                  <MarcaDeAjuste batida={batida} />
                </span>
                <MarcaDeAtraso batida={batida} aprovadores={aprovadores} />
                <MarcaSemLocalizacao batida={batida} />
                {batida.distancia_metros !== null && (
                  <span className="mt-0.5 flex items-center gap-1 text-[0.7rem] text-faint">
                    <MapPin
                      size={11}
                      aria-hidden="true"
                      className={batida.no_local ? 'text-luz' : 'text-warn'}
                    />
                    {batida.no_local ? 'no local' : formatarDistancia(batida.distancia_metros)}
                  </span>
                )}
              </span>

              {temFoto ? (
                <Camera size={15} aria-hidden="true" className="shrink-0 text-mute" />
              ) : (
                <span className="shrink-0 text-[0.62rem] text-faint">sem foto</span>
              )}
            </>
          )

          return (
            <li key={batida.id}>
              {temFoto ? (
                <button
                  onClick={() => aoAbrirSelfie(batida)}
                  aria-label={`Ver a selfie da batida das ${formatarHora(batida.registrado_em)}`}
                  className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-2 focus-visible:bg-ink-2 focus-visible:outline-none"
                >
                  {conteudo}
                </button>
              ) : (
                <div className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5">{conteudo}</div>
              )}
            </li>
          )
        })}
      </ul>
    </li>
  )
}
