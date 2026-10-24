import { Clock, LocateOff, PencilLine } from 'lucide-react'
import { marcaDaBatida } from '../lib/atraso'
import { saiuSemLocalizacao, TEXTO_SEM_LOCALIZACAO, type Batida, type OrigemDaLocalizacao } from '../lib/formato'
import { Etiqueta } from './ui'

/*
 * A MARCA DA BATIDA NAS LISTAS — uma regra só, de `lib/atraso.ts`, desenhada
 * igual na tela de bater, no espelho e no painel.
 *
 * DOIS LUGARES, DE PROPÓSITO
 *  • O AJUSTE DO ADMIN é curto ("ajuste do admin") e cabe ao lado do tipo, na
 *    mesma linha.
 *  • A BATIDA EM ATRASO APROVADA diz quem aprovou, e um nome não cabe ao lado
 *    de "Entrada" em 320 px sem cortar. Ela ganha a linha dela, embaixo.
 *
 * As duas nunca aparecem juntas: a batida de atraso nasce com `ajuste_manual`
 * (é assim que o banco a grava, pelo caminho do admin), e a marca de atraso é
 * a que diz o que de fato aconteceu.
 */

interface Props {
  batida: Pick<Batida, 'ajuste_manual' | 'pedido_atraso_id'>
  aprovadores?: ReadonlyMap<string, string | null>
  /** "ajuste" em vez de "ajuste do admin", para o painel — onde todo ajuste é do admin. */
  curta?: boolean
}

/** Ao lado do tipo: só o ajuste do admin. */
export function MarcaDeAjuste({ batida, aprovadores, curta = false }: Props) {
  const marca = marcaDaBatida(batida, aprovadores)
  if (marca?.nome !== 'ajuste') return null
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-[0.68rem] text-warn">
      <PencilLine size={11} aria-hidden="true" />
      {curta ? 'ajuste' : marca.texto}
    </span>
  )
}

/** Embaixo do tipo, numa linha própria: a batida em atraso aprovada. */
export function MarcaDeAtraso({ batida, aprovadores }: Props) {
  const marca = marcaDaBatida(batida, aprovadores)
  if (marca?.nome !== 'atraso') return null
  return (
    <span className="mt-0.5 flex items-start gap-1 text-[0.7rem] text-plat-dim">
      <Clock size={11} aria-hidden="true" className="mt-0.5 shrink-0 text-luz" />
      <span className="min-w-0 break-words">{marca.texto}</span>
    </span>
  )
}

/**
 * "sem localização", embaixo do tipo: a batida do app (ou de pedido aprovado)
 * que saiu sem localização porque o GPS não respondeu. Etiqueta NEUTRA, e não
 * de aviso: bater assim é permitido, com a selfie e o PIN. Ela ocupa o lugar de
 * "no local" / "fora", que essa batida não tem. A inserida pelo admin não ganha
 * a etiqueta — ela nunca teve celular.
 */
export function MarcaSemLocalizacao({ batida }: { batida: OrigemDaLocalizacao }) {
  if (!saiuSemLocalizacao(batida)) return null
  return (
    <span className="mt-0.5 flex">
      <Etiqueta tom="neutro">
        <LocateOff size={10} aria-hidden="true" />
        {TEXTO_SEM_LOCALIZACAO}
      </Etiqueta>
    </span>
  )
}
