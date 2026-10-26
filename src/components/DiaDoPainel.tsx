import { useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarX2, Camera, CameraOff, Clock, LocateOff, MapPin, PencilLine, Plus } from 'lucide-react'
import { descreverLocalizacao, formatarHora, type BatidaDoAdmin } from '../lib/formato'
import { formatarDuracao, rotuloDoDia, type DiaDoEspelho } from '../lib/horas'
import { ancoraDoDia } from '../lib/corrigir'
import { rotuloNaLista } from '../lib/painel'
import { useMiniaturasDoDia } from '../hooks/useMiniaturasDoDia'
import { MarcaDeAjuste, MarcaDeAtraso } from './MarcaDaBatida'
import { MarcaDeAusencia } from './DiaDeAusencia'
import { Botao, Etiqueta } from './ui'
import type { Ausencia } from '../lib/ausencias'
import type { PedidoDeAtraso } from '../lib/atraso'

/*
 * UM DIA VISTO PELO ADMIN.
 *
 * POR QUE NÃO É O `DiaDoEspelho`
 * A conta é a mesma — vem toda de `horas.ts`, e nenhuma linha dela foi
 * reescrita. O que muda é o que se pode FAZER: aqui cada batida é um botão que
 * abre a correção, e cada dia tem o botão de inserir a que faltou. Enfiar essas
 * afordâncias no componente do funcionário significaria pôr, na tela dele,
 * botões que a RLS recusa — e um botão que só existe para dar erro é pior do
 * que botão nenhum.
 *
 * O QUE ESTA TELA DIZ SOBRE A FOTO
 * Batida do app tem selfie; batida inserida pelo admin não tem, porque não
 * houve foto. Isso aparece escrito ("sem foto — inserida pelo admin") em vez de
 * um quadrado quebrado: o bucket não tem policy de UPDATE, então nem existe
 * caminho para alguém colar uma foto depois.
 *
 * A SELFIE APARECE EM MINIATURA. O botão da foto mostra a própria selfie, no
 * quadrado de 44 px, para quem administra conferir quem bateu sem abrir foto
 * por foto; o clique abre o visor grande. As assinaturas saem em lote, só
 * quando o dia chega perto da tela (`useMiniaturasDoDia`); até lá, ou se a
 * assinatura falhar, fica o ícone da câmera.
 *
 * TODO DIA TEM ÂNCORA E "INSERIR BATIDA NESTE DIA". A tela da pessoa lista
 * todos os dias do período até hoje (`listarDiasDoPeriodo`,
 * src/lib/corrigir.ts), e o dia sem batida é a linha compacta `DiaSemBatida`,
 * logo abaixo. Cada dia leva o id
 * `dia-AAAA-MM-DD` (`ancoraDoDia`), e o sábado e o domingo levam a etiqueta
 * "fim de semana".
 *
 * NÃO HÁ AVISO DE RÓTULO TROCADO. A batida inserida depois não entra no fim da
 * fila com o rótulo errado: o banco (`ponto_reordenar_dia`) reorganiza entrada,
 * almoço, volta e saída pelo horário a cada inserção ou correção do admin.
 *
 * CORRIGIR SEM ERRAR
 *  • "CORRIGIR" À VISTA EM CADA BATIDA. Um lápis apagado no canto ninguém lê
 *    como botão; por isso é um rótulo com cara de botão secundário —
 *    um `<span>`, DENTRO do botão da linha, e não outro botão: botão dentro de
 *    botão é HTML inválido (o React acusa no console). A linha inteira continua
 *    sendo o alvo, o `aria-label` dela já diz "Corrigir a batida das HH:MM", e
 *    o rótulo fica `aria-hidden` para não ser lido duas vezes.
 *  • O DIA ÍMPAR DE ANTES DE HOJE ORIENTA. Diz o que falta ("Falta 1 batida
 *    neste dia…"), troca o nome das batidas pela posição (`rotuloNaLista`: o
 *    banco chamaria a saída das 17:00 de "Volta", e isso leva a corrigir a
 *    batida errada) e ganha o botão primário "Inserir a batida que falta".
 *  • HOJE ÍMPAR É "EM ANDAMENTO", e não incompleto: às 10h a pessoa bateu a
 *    entrada e ainda vai bater o resto. Sem o botão primário — ele convidaria a
 *    inserir a saída de quem ainda está trabalhando, e batida não se apaga.
 *
 * O PEDIDO ESPERANDO DECISÃO APARECE NO DIA:
 * "Pedido esperando decisão: 13:05 — Decidir", que rola até o cartão do pedido
 * na mesma tela. No dia ímpar com pedido, o caminho é decidir o pedido, e não
 * inserir: o botão de inserir deixa de ser o primário — inserir a 13:05 à mão e
 * depois aprovar a 13:05 pedida daria batida dobrada, que não se apaga.
 */

interface Props {
  dia: DiaDoEspelho<BatidaDoAdmin>
  aoAbrirSelfie: (batida: BatidaDoAdmin) => void
  aoCorrigir: (batida: BatidaDoAdmin) => void
  aoInserirNesteDia: (dia: string) => void
  /**
   * Falso para dia depois de hoje (`DiaDaLista.futuro`): a caixa recusaria
   * qualquer horário nele, e um botão que só existe para dar erro é pior do que
   * botão nenhum. As batidas continuam corrigíveis.
   */
  podeInserir?: boolean
  /** Sábado ou domingo (`DiaDaLista.fimDeSemana`): ganha a etiqueta. */
  fimDeSemana?: boolean
  /** `pedido_id -> quem aprovou`, para a marca da batida em atraso. */
  aprovadores?: ReadonlyMap<string, string | null>
  /** Ausências ativas que cobrem este dia: a marca aparece, as horas não mudam. */
  ausencias?: readonly Ausencia[]
  aoAbrirAtestado?: (ausencia: Ausencia) => void
  /**
   * Este dia é hoje (`diaCivilDeHoje`). Ímpar e hoje é "Em andamento": a
   * pessoa ainda pode bater, e a tela não empurra ninguém a inserir nada.
   */
  ehHoje?: boolean
  /** O dia que acabou de ser mexido: ganha o contorno verde por alguns segundos. */
  destacado?: boolean
  /** Os pedidos de batida em atraso deste dia que esperam decisão. */
  pedidos?: readonly PedidoDeAtraso[]
  /** "Decidir", no pedido do dia: rola até o cartão dele. */
  aoVerPedido?: (pedido: PedidoDeAtraso) => void
}

const COR_DO_PINO: Record<Exclude<ReturnType<typeof descreverLocalizacao>['nome'], 'sem_gps'>, string> = {
  ausente: 'text-faint',
  imprecisa: 'text-warn',
  no_local: 'text-luz',
  fora: 'text-warn',
}

export function DiaDoPainel({
  dia,
  aoAbrirSelfie,
  aoCorrigir,
  aoInserirNesteDia,
  podeInserir = true,
  fimDeSemana = false,
  aprovadores,
  ausencias = [],
  aoAbrirAtestado,
  ehHoje = false,
  destacado = false,
  pedidos = [],
  aoVerPedido,
}: Props) {
  const emAndamento = dia.incompleto && ehHoje
  const faltaBatida = dia.incompleto && !ehHoje
  const temPedido = pedidos.length > 0
  const refDoDia = useRef<HTMLLIElement>(null)
  const miniaturas = useMiniaturasDoDia(
    refDoDia,
    dia.batidas.flatMap((batida) => (batida.selfie_path ? [batida.selfie_path] : [])),
  )

  return (
    <li
      ref={refDoDia}
      id={ancoraDoDia(dia.dia)}
      className={`rounded-2xl border bg-ink-1 transition-shadow duration-500 ${
        destacado ? 'border-luz/60 ring-2 ring-luz/40' : 'border-hair'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-plat">
            <span className="truncate">{rotuloDoDia(dia.dia)}</span>
            {fimDeSemana && <Etiqueta tom="neutro">fim de semana</Etiqueta>}
          </p>
          <p className="mt-0.5 font-mono text-xs text-faint tabular-nums">
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

      {faltaBatida && !temPedido && (
        <p className="px-4 pb-1 text-xs leading-relaxed text-plat-dim">
          Falta 1 batida neste dia, e por isso ele não soma horas. Pergunte à pessoa qual horário
          ficou sem bater e use “Inserir a batida que falta”. Não corrija um horário que a pessoa
          bateu: os nomes se arrumam sozinhos quando o dia fechar.
        </p>
      )}
      {faltaBatida && temPedido && (
        <p className="px-4 pb-1 text-xs leading-relaxed text-plat-dim">
          Falta 1 batida neste dia, e por isso ele não soma horas. A pessoa já pediu a batida que
          falta: decida o pedido em vez de inserir.
        </p>
      )}
      <PedidosEsperandoNoDia pedidos={pedidos} aoVer={aoVerPedido} />
      {emAndamento && (
        <p className="px-4 pb-1 text-xs leading-relaxed text-mute">A pessoa ainda pode bater hoje.</p>
      )}

      <MarcaDeAusencia ausencias={ausencias} aoAbrirAtestado={aoAbrirAtestado} />

      <ul className="mt-1 divide-y divide-hair border-t border-hair">
        {dia.batidas.map((batida, indice) => {
          const local = descreverLocalizacao(batida)
          const temFoto = Boolean(batida.selfie_path)

          return (
            <li key={batida.id} className="flex items-center gap-2 px-4 py-2.5">
              <button
                type="button"
                onClick={() => aoCorrigir(batida)}
                aria-label={`Corrigir a batida das ${formatarHora(batida.registrado_em)}`}
                className="group -mx-1 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left transition-colors hover:bg-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
              >
                <span className="font-mono text-sm text-plat tabular-nums">
                  {formatarHora(batida.registrado_em)}
                </span>

                <span className="min-w-0 flex-1">
                  {/* Quebra em vez de cortar: em 320 px, ao lado do "Corrigir" e da
                      selfie, o corte comia justamente o "(última)" do dia ímpar. */}
                  <span className="block text-sm break-words text-plat-dim">
                    {rotuloNaLista(dia, indice, ehHoje)}
                    <MarcaDeAjuste batida={batida} curta />
                  </span>
                  <MarcaDeAtraso batida={batida} aprovadores={aprovadores} />
                  {/* A batida sem localização: etiqueta
                      neutra no lugar do pino — o GPS não respondeu, e ela saiu
                      com a selfie e o PIN. A inserida pelo admin segue como
                      sempre, com o pino apagado. */}
                  {local.nome === 'sem_gps' ? (
                    <span className="mt-0.5 flex">
                      <Etiqueta tom="neutro">
                        <LocateOff size={10} aria-hidden="true" />
                        {local.texto}
                      </Etiqueta>
                    </span>
                  ) : (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-faint">
                      <MapPin size={11} aria-hidden="true" className={COR_DO_PINO[local.nome]} />
                      {local.texto}
                    </span>
                  )}
                  {batida.motivo_ajuste && (
                    <span className="mt-0.5 block truncate text-xs text-mute italic">
                      “{batida.motivo_ajuste}”
                    </span>
                  )}
                </span>

                {/* O "Corrigir" com cara de botão, dentro do botão da linha (ver o cabeçalho). */}
                <span
                  aria-hidden="true"
                  className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-hair-2 bg-ink-2 px-2.5 text-xs font-medium text-plat-dim transition-colors group-hover:border-hair-3 group-hover:text-plat"
                >
                  Corrigir
                </span>
              </button>

              {temFoto ? (
                <BotaoDaSelfie
                  batida={batida}
                  miniatura={batida.selfie_path ? miniaturas.get(batida.selfie_path) : undefined}
                  aoAbrir={() => aoAbrirSelfie(batida)}
                />
              ) : (
                <span
                  title="Batida inserida pelo admin: não houve foto."
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-hair-2 text-faint"
                >
                  <CameraOff size={15} aria-hidden="true" />
                  <span className="sr-only">Sem foto — batida inserida pelo administrador</span>
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {podeInserir && (
        <div className="border-t border-hair px-4 py-2">
          {faltaBatida && !temPedido ? (
            <div className="py-1">
              <Botao onClick={() => aoInserirNesteDia(dia.dia)} className="sm:w-auto">
                <Plus size={16} aria-hidden="true" />
                Inserir a batida que falta
              </Botao>
            </div>
          ) : (
            <BotaoDoDia aoClicar={() => aoInserirNesteDia(dia.dia)}>
              <PencilLine size={13} aria-hidden="true" />
              Inserir batida neste dia
            </BotaoDoDia>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * O botão da foto de uma batida: a miniatura da selfie quando o link já foi
 * assinado, a câmera enquanto não foi. O nome para o leitor de tela é o do
 * botão ("Ver a selfie das 08:00"), e por isso a imagem tem `alt` vazio.
 *
 * O LINK VENCE, A IMAGEM NÃO SOME. Depois de baixada, a miniatura fica na
 * memória do navegador. Se ele precisar baixar de novo depois dos dois minutos,
 * o storage recusa, o `onError` marca aquele link como quebrado e a câmera
 * volta, sem quadrado quebrado na lista.
 */
function BotaoDaSelfie({
  batida,
  miniatura,
  aoAbrir,
}: {
  batida: Pick<BatidaDoAdmin, 'registrado_em'>
  miniatura?: string
  aoAbrir: () => void
}) {
  const [quebrada, setQuebrada] = useState<string | null>(null)
  const mostrarMiniatura = Boolean(miniatura) && miniatura !== quebrada

  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={`Ver a selfie das ${formatarHora(batida.registrado_em)}`}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-hair-2 bg-ink-2 text-mute transition-colors hover:border-hair-3 hover:text-plat focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
    >
      {mostrarMiniatura ? (
        <img
          src={miniatura}
          alt=""
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setQuebrada(miniatura ?? null)}
        />
      ) : (
        <Camera size={15} aria-hidden="true" />
      )}
    </button>
  )
}

/**
 * "Pedido esperando decisão: 13:05 — Decidir", uma linha por pedido
 * do dia. Exportado porque o dia sem batida e o dia só com ausência também têm
 * pedido — é o caso mais comum: a pessoa esqueceu a entrada e pediu.
 */
export function PedidosEsperandoNoDia({
  pedidos,
  aoVer,
  className = 'px-4 pb-1',
}: {
  pedidos: readonly PedidoDeAtraso[]
  aoVer?: (pedido: PedidoDeAtraso) => void
  className?: string
}) {
  if (pedidos.length === 0) return null
  return (
    <div className={className}>
      {pedidos.map((pedido) => (
        <p key={pedido.id} className="flex flex-wrap items-center gap-x-1.5 text-xs text-warn">
          <Clock size={12} aria-hidden="true" className="shrink-0" />
          <span>
            Pedido esperando decisão:{' '}
            <span className="font-mono tabular-nums">{formatarHora(pedido.horario_declarado)}</span>
          </span>
          {aoVer && (
            <>
              <span aria-hidden="true">—</span>
              <button
                type="button"
                onClick={() => aoVer(pedido)}
                aria-label={`Decidir o pedido das ${formatarHora(pedido.horario_declarado)}`}
                className="inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-semibold text-luz underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
              >
                Decidir
              </button>
            </>
          )}
        </p>
      ))}
    </div>
  )
}

/**
 * O botão de texto das ações de um dia: alvo de 44 px, discreto até passar o
 * mouse. Exportado porque o dia só com ausência (`DiaDeAusencia`, que o
 * espelho do colaborador também usa) recebe o dele da tela do painel.
 */
export function BotaoDoDia({ aoClicar, children }: { aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-xs text-mute transition-colors hover:text-luz focus-visible:text-luz focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
    >
      {children}
    </button>
  )
}

interface PropsDoDiaSemBatida {
  dia: string
  fimDeSemana?: boolean
  aoInserirNesteDia: (dia: string) => void
  aoLancarFaltaNesteDia: (dia: string) => void
  /** Os pedidos de batida em atraso deste dia que esperam decisão. */
  pedidos?: readonly PedidoDeAtraso[]
  aoVerPedido?: (pedido: PedidoDeAtraso) => void
}

/**
 * O DIA SEM BATIDA E SEM AUSÊNCIA, numa linha só: "Sáb, 17 de out · Sem
 * batida · Inserir batida neste dia · Lançar falta neste dia".
 *
 * COMPACTA DE PROPÓSITO. Num mês de 31 dias quase metade é vazia (fins de
 * semana, folgas), e 31 cartões do tamanho do dia com batidas passariam de
 * 6.000 px no celular — o dia que importa ficaria a dez rolagens de distância.
 *
 * Só existe para dia de hoje ou de antes: dia futuro vazio não entra na lista.
 * "Lançar falta neste dia" abre a caixa de ausência já com a data; o dia que
 * já tem ausência não ganha o link (o banco recusa duas ausências no mesmo dia).
 */
export function DiaSemBatida({
  dia,
  fimDeSemana = false,
  aoInserirNesteDia,
  aoLancarFaltaNesteDia,
  pedidos = [],
  aoVerPedido,
}: PropsDoDiaSemBatida) {
  return (
    <li
      id={ancoraDoDia(dia)}
      className="flex flex-wrap items-center gap-x-4 rounded-xl border border-dashed border-hair-2 px-4"
    >
      <p className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
        <span className="font-medium text-plat-dim">{rotuloDoDia(dia)}</span>
        {fimDeSemana && <Etiqueta tom="neutro">fim de semana</Etiqueta>}
        <span className="text-xs text-mute">· Sem batida</span>
      </p>
      <PedidosEsperandoNoDia pedidos={pedidos} aoVer={aoVerPedido} className="basis-full" />
      <div className="flex flex-wrap gap-x-4">
        <BotaoDoDia aoClicar={() => aoInserirNesteDia(dia)}>
          <PencilLine size={13} aria-hidden="true" />
          Inserir batida neste dia
        </BotaoDoDia>
        <BotaoDoDia aoClicar={() => aoLancarFaltaNesteDia(dia)}>
          <CalendarX2 size={13} aria-hidden="true" />
          Lançar falta neste dia
        </BotaoDoDia>
      </div>
    </li>
  )
}
