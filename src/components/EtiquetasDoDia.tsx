import { Etiqueta } from './ui'

/**
 * AS ETIQUETAS DO CALENDÁRIO, ao lado da data do dia: "feriado" e "fim de
 * semana". O feriado nacional ficava sem marca nenhuma, e um feriado numa
 * segunda-feira parecia um dia útil sem batida ao lado do sábado e do domingo
 * etiquetados. Agora ele aparece como o fim de semana, com o nome junto
 * ("feriado · Nossa Senhora Aparecida"), de `feriados.ts`, pela lista do dia
 * (`DiaDaLista`).
 */
export function EtiquetasDoDia({
  fimDeSemana = false,
  feriado = null,
}: {
  fimDeSemana?: boolean
  feriado?: string | null
}) {
  return (
    <>
      {feriado && <Etiqueta tom="neutro">feriado · {feriado}</Etiqueta>}
      {fimDeSemana && <Etiqueta tom="neutro">fim de semana</Etiqueta>}
    </>
  )
}
