import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import {
  formatarDistancia,
  formatarHora,
  ROTULO_DO_TIPO,
  SEGUNDOS_DE_VALIDADE_DA_SELFIE,
  urlAssinadaDaSelfie,
  type Batida,
} from '../lib/batidas'
import { Aviso, Botao, Modal } from './ui'

/*
 * A foto de uma batida, aberta por link temporário.
 *
 * A FOTO NÃO TEM URL FIXA, E ISSO É O DESENHO
 * `ponto-selfies` é um bucket PRIVADO: não existe endereço público de imagem
 * para pôr num `<img src>`. Cada abertura pede ao storage uma URL assinada, que
 * vive poucos minutos e depois deixa de valer. O servidor só assina o que a
 * policy de SELECT deixa a pessoa ver — o próprio caminho (`{user_id}/...`) ou,
 * se for admin, o de qualquer um. Tentar a foto de outro funcionário não devolve
 * link nenhum, e essa recusa é do banco, não desta tela.
 *
 * SEM CACHE ENTRE ABERTURAS, DE PROPÓSITO
 * Guardar o link assinado num estado de longa vida seria guardar uma chave ao
 * portador que envelhece sozinha: na segunda abertura ela já poderia estar
 * vencida, e o quadrado quebrado apareceria sem explicação. Assinar de novo a
 * cada abertura custa um round-trip e sempre entrega um link válido.
 */

/*
 * O visor abre também a selfie de um PEDIDO de batida em atraso — que
 * não é batida e não tem tipo. Por isso recebe só o que desenha, e o tipo é
 * opcional; no lugar dele, `descricao` diz o que é a foto.
 */
interface Props {
  batida: Pick<Batida, 'registrado_em' | 'selfie_path' | 'distancia_metros' | 'no_local'> & {
    tipo?: Batida['tipo']
  }
  /** O que vai no lugar do tipo — "Pedido de batida em atraso". */
  descricao?: string
  aoFechar: () => void
}

type Estado =
  | { nome: 'assinando' }
  | { nome: 'pronta'; url: string }
  | { nome: 'falhou'; motivo: string }

export function VisorDeSelfie({ batida, descricao, aoFechar }: Props) {
  const caminho = batida.selfie_path

  /*
   * Estado inicial calculado uma vez, e não escrito dentro do efeito: a regra
   * `set-state-in-effect` recusa `setState` no corpo de um `useEffect`, e com
   * razão — seria um render a mais toda vez que o visor abrisse. Quem volta ao
   * estado de espera é o botão de "gerar de novo", num manipulador de evento.
   */
  const [estado, setEstado] = useState<Estado>(() =>
    caminho
      ? { nome: 'assinando' }
      : { nome: 'falhou', motivo: 'Esta batida não tem foto guardada.' },
  )
  // Muda a cada "gerar de novo" e é o que faz o efeito rodar outra vez.
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (!caminho) return
    let vivo = true

    void urlAssinadaDaSelfie(caminho)
      .then((url) => {
        if (vivo) setEstado({ nome: 'pronta', url })
      })
      .catch((falha: unknown) => {
        if (!vivo) return
        setEstado({
          nome: 'falhou',
          motivo:
            falha instanceof Error ? falha.message : 'Não deu para abrir a foto desta batida.',
        })
      })

    return () => {
      vivo = false
    }
  }, [caminho, tentativa])

  return (
    /*
     * A moldura vem de `ui.tsx`, e aqui ela resolve um caso concreto: a foto é
     * `aspect-square`, ou seja, tão alta quanto larga. Num celular deitado
     * (568×320) o visor inteiro passa dos 320 px de altura da janela, e sem a
     * rolagem da moldura o excesso ficaria fora de alcance.
     * O clique de dentro não fecha; quem para a propagação é o `Modal`.
     */
    <Modal
      rotulo={`Selfie da batida das ${formatarHora(batida.registrado_em)}`}
      aoFechar={aoFechar}
    >
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-2xl text-plat tabular-nums">
              {formatarHora(batida.registrado_em)}
            </p>
            <p className="mt-0.5 truncate text-xs text-mute">
              {descricao ?? (batida.tipo ? ROTULO_DO_TIPO[batida.tipo] : 'Selfie')}
              {batida.distancia_metros !== null && (
                <>
                  {' · '}
                  {batida.no_local
                    ? 'no local'
                    : `${formatarDistancia(batida.distancia_metros)} do local`}
                </>
              )}
            </p>
          </div>
          <button
            onClick={aoFechar}
            aria-label="Fechar a foto"
            className="-mt-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 aspect-square w-full overflow-hidden rounded-xl border border-hair-2 bg-ink-2">
          {estado.nome === 'assinando' && (
            <div className="flex h-full items-center justify-center">
              <div
                className="h-8 w-8 animate-spin rounded-full border-2 border-hair-3 border-t-luz"
                role="status"
                aria-label="Carregando a foto"
              />
            </div>
          )}

          {estado.nome === 'pronta' && (
            <img
              src={estado.url}
              alt={`Selfie registrada na batida das ${formatarHora(batida.registrado_em)}`}
              className="h-full w-full object-cover"
              /* O link vence sozinho. Se o navegador reler a imagem depois
                 disso, cai aqui e o botão de gerar de novo aparece. */
              onError={() =>
                setEstado({
                  nome: 'falhou',
                  motivo: 'O link desta foto expirou. Gere um novo para ver de novo.',
                })
              }
            />
          )}

          {estado.nome === 'falhou' && (
            <div className="flex h-full items-center justify-center p-5">
              <Aviso tom="atencao">{estado.motivo}</Aviso>
            </div>
          )}
        </div>

        {estado.nome === 'falhou' && (
          <div className="mt-3">
            <Botao
              tom="secundario"
              disabled={!caminho}
              onClick={() => {
                setEstado({ nome: 'assinando' })
                setTentativa((n) => n + 1)
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
              Gerar o link de novo
            </Botao>
          </div>
        )}

        <p className="mt-3 text-center text-[0.68rem] leading-relaxed text-faint">
          O link desta foto vale por {Math.round(SEGUNDOS_DE_VALIDADE_DA_SELFIE / 60)} minutos e
          depois deixa de funcionar.
        </p>
      </>
    </Modal>
  )
}
