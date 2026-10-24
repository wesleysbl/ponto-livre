import { CheckCircle2, LocateOff, MapPin } from 'lucide-react'
import { formatarDistancia, formatarHora, ROTULO_DO_TIPO, type Batida } from '../lib/batidas'
import { SEM_LOCALIZACAO_POR_EXTENSO, saiuSemLocalizacao } from '../lib/formato'
import { Botao, Painel } from './ui'

/*
 * O comprovante — a única coisa que o funcionário leva da batida.
 *
 * TUDO AQUI VEIO DO SERVIDOR, E ISSO É O PONTO
 * Horário, tipo, distância e a marca dentro/fora são o que o banco DEVOLVEU
 * depois de gravar, não o que o app supôs antes de mandar. Se o relógio do
 * celular estiver adiantado, o comprovante mostra a hora do servidor mesmo
 * assim; se a pessoa previu "entrada" e o banco deduziu outra coisa, o que
 * aparece é a do banco. A única exceção é a miniatura, que é o arquivo local
 * ainda em memória — a foto do bucket é privada e só sai por link assinado.
 *
 * A PRECISÃO É MOSTRADA CRUA, SEM ADJETIVO
 * "± 2.400 m" diz sozinho que a leitura foi ruim. Quem escreve "localização
 * imprecisa" com todas as letras é o painel do admin — aqui o
 * funcionário só precisa saber o que foi registrado no nome dele.
 *
 * A BATIDA SEM LOCALIZAÇÃO diz isso com todas as
 * letras — "Sem localização (o GPS não respondeu)" — e o que valeu no lugar: a
 * foto e o PIN. É o mesmo texto da folha e do CSV.
 */

interface Props {
  batida: Batida
  /** URL local (objectURL) da foto recém-tirada. Nula se já foi liberada. */
  miniatura: string | null
  aoFechar: () => void
}

export function Comprovante({ batida, miniatura, aoFechar }: Props) {
  const temLocal = batida.distancia_metros !== null
  const semLocalizacao = saiuSemLocalizacao(batida)

  return (
    <Painel>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-luz-soft text-luz">
        <CheckCircle2 size={24} aria-hidden="true" />
      </div>

      <h2 className="text-center text-lg font-semibold text-plat">Batida registrada</h2>
      <p className="mt-1 text-center text-sm text-mute">
        {ROTULO_DO_TIPO[batida.tipo]} · {batida.ordem_no_dia}ª do dia
      </p>

      <p className="mt-6 text-center font-mono text-5xl font-medium tracking-tight text-plat tabular-nums">
        {formatarHora(batida.registrado_em)}
      </p>
      <p className="mt-1.5 text-center font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
        Horário do servidor
      </p>

      {miniatura && (
        <div className="mt-6 flex justify-center">
          <img
            src={miniatura}
            alt="Selfie registrada nesta batida"
            className="h-24 w-24 rounded-2xl border border-hair-2 object-cover"
          />
        </div>
      )}

      <div className="mt-6 rounded-xl border border-hair bg-ink-2 px-4 py-3">
        {semLocalizacao ? (
          <div className="flex items-start gap-2.5">
            <LocateOff size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-mute" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-plat">{SEM_LOCALIZACAO_POR_EXTENSO}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-mute">
                A batida valeu com a sua foto e o PIN, e fica marcada assim no seu ponto.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2.5">
            <MapPin
              size={16}
              aria-hidden="true"
              className={`mt-0.5 shrink-0 ${batida.no_local ? 'text-luz' : 'text-warn'}`}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-plat">
                {/* Com coordenada e sem local ativo, não há distância — mas há
                    localização: "Sem localização" é a do GPS que não
                    respondeu, logo acima. */}
                {batida.no_local === null
                  ? 'Localização registrada'
                  : batida.no_local
                    ? 'No local'
                    : 'Fora do local'}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-mute">
                {temLocal
                  ? `${formatarDistancia(batida.distancia_metros)} do local`
                  : 'A batida foi registrada sem distância calculada.'}
                {batida.precisao_metros !== null && (
                  <>
                    {' · '}
                    <span className="font-mono">
                      ± {formatarDistancia(batida.precisao_metros)}
                    </span>{' '}
                    de precisão
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-faint">
        A localização não bloqueia a batida — ela só registra onde você estava.
      </p>

      <div className="mt-6">
        <Botao tom="secundario" onClick={aoFechar}>
          Concluir
        </Botao>
      </div>
    </Painel>
  )
}
