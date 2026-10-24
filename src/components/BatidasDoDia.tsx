import { MapPin, RefreshCw } from 'lucide-react'
import { formatarDistancia, formatarHora, ROTULO_CURTO, type Batida } from '../lib/batidas'
import { MarcaDeAjuste, MarcaDeAtraso, MarcaSemLocalizacao } from './MarcaDaBatida'
import { Aviso, Botao } from './ui'

/*
 * As batidas de hoje, embaixo do botão.
 *
 * SÓ O DIA DE HOJE, DE PROPÓSITO
 * O mês inteiro é o espelho ("Meu espelho de ponto"), com total de horas e troca
 * de mês. Aqui a pergunta é outra e é imediata: "eu já bati?". Uma lista de
 * quatro linhas responde isso de relance, e é ela que evita a batida duplicada
 * por dúvida — que o banco recusaria, mas depois de a pessoa ter tirado a foto
 * e digitado o PIN à toa.
 *
 * A MARCA DE AJUSTE MANUAL JÁ APARECE AQUI
 * Nenhuma batida nasce ajustada pelo app: a marca vem de linha inserida ou
 * corrigida pelo admin. O funcionário tem de enxergar esse ajuste no próprio
 * espelho, e o espelho começa nesta lista.
 *
 * E A DE "SEM LOCALIZAÇÃO" TAMBÉM: a batida que saiu
 * com a selfie e o PIN, sem coordenada, porque o GPS não respondeu. No lugar de
 * "no local" / "fora", que ela não tem.
 */

interface Props {
  batidas: Batida[]
  carregando: boolean
  erro: string | null
  aoTentarDeNovo: () => void
  /** `pedido_id -> quem aprovou`, para a marca da batida em atraso. */
  aprovadores?: ReadonlyMap<string, string | null>
  /**
   * "HH:MM" da última vez que a lista veio do servidor. O app fica aberto de
   * um dia para o outro: a linha diz de quando é o que está na tela.
   */
  atualizadoEm?: string | null
}

export function BatidasDoDia({ batidas, carregando, erro, aoTentarDeNovo, aprovadores, atualizadoEm }: Props) {
  return (
    <section className="mt-8">
      <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
        Suas batidas de hoje
      </h2>

      {erro && (
        <div className="mt-3 space-y-2">
          <Aviso tom="atencao">{erro}</Aviso>
          <Botao tom="secundario" onClick={aoTentarDeNovo} disabled={carregando}>
            <RefreshCw size={15} aria-hidden="true" />
            {carregando ? 'Carregando…' : 'Tentar de novo'}
          </Botao>
        </div>
      )}

      {!erro && carregando && (
        <p className="mt-3 text-sm text-mute">Carregando…</p>
      )}

      {!erro && !carregando && batidas.length === 0 && (
        <p className="mt-3 text-sm leading-relaxed text-mute">
          Nenhuma batida hoje ainda. A primeira do dia entra como entrada.
        </p>
      )}

      {!erro && batidas.length > 0 && (
        <ul className="mt-3 divide-y divide-hair rounded-2xl border border-hair bg-ink-1">
          {batidas.map((batida) => (
            <li key={batida.id} className="flex items-center gap-3 px-4 py-3">
              <span className="font-mono text-base text-plat tabular-nums">
                {formatarHora(batida.registrado_em)}
              </span>

              <span className="min-w-0 flex-1">
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

              <span className="font-mono text-[0.68rem] text-faint tabular-nums">
                {batida.ordem_no_dia}ª
              </span>
            </li>
          ))}
        </ul>
      )}

      {!erro && !carregando && atualizadoEm && (
        <p className="mt-2 text-xs text-mute">Atualizado às {atualizadoEm}</p>
      )}
    </section>
  )
}
