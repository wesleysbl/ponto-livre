import { useEffect } from 'react'
import { Delete } from 'lucide-react'

/*
 * Teclado numérico do PIN.
 *
 * POR QUE NÃO UM <input type="tel">
 * O PIN é digitado em pé, no corredor, muitas vezes com uma mão só. O teclado
 * do sistema cobre metade da tela, sobe e desce a cada foco, e no Android
 * oferece autopreenchimento e colar — coisas que não deveriam existir num
 * campo de 4 dígitos que confirma presença. Um teclado próprio garante alvos
 * de 44px, a tela inteira sempre visível, e nenhum caminho para colar valor.
 *
 * MAS O TECLADO FÍSICO CONTINUA VALENDO
 * O listener de `keydown` aceita dígitos e Backspace. Sem ele, testar o app no
 * navegador do computador viraria um exercício de clique.
 */

export const TAMANHO_PIN = 4

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'apagar'] as const

const TECLA_BASE =
  'flex h-16 items-center justify-center rounded-xl text-2xl font-medium select-none ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-40'

interface Props {
  valor: string
  aoMudar: (valor: string) => void
  desabilitado?: boolean
}

export function TecladoPin({ valor, aoMudar, desabilitado = false }: Props) {
  useEffect(() => {
    if (desabilitado) return

    function aoTeclar(evento: KeyboardEvent) {
      // Não sequestra atalhos do navegador nem combinações do sistema.
      if (evento.metaKey || evento.ctrlKey || evento.altKey) return

      if (evento.key >= '0' && evento.key <= '9') {
        evento.preventDefault()
        if (valor.length < TAMANHO_PIN) aoMudar(valor + evento.key)
        return
      }
      if (evento.key === 'Backspace') {
        evento.preventDefault()
        aoMudar(valor.slice(0, -1))
      }
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [valor, desabilitado, aoMudar])

  function digitar(numero: string) {
    if (valor.length < TAMANHO_PIN) aoMudar(valor + numero)
  }

  return (
    <div>
      {/* Os pontos. Só a quantidade aparece — o valor nunca é mostrado. */}
      <div
        className="flex justify-center gap-4"
        role="status"
        aria-label={`${valor.length} de ${TAMANHO_PIN} dígitos`}
      >
        {Array.from({ length: TAMANHO_PIN }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`h-3.5 w-3.5 rounded-full border transition-colors ${
              i < valor.length ? 'border-luz bg-luz' : 'border-hair-3'
            }`}
          />
        ))}
      </div>

      <div className="mt-8 grid grid-cols-3 gap-3">
        {TECLAS.map((tecla, indice) => {
          if (tecla === '') return <div key={`vazio-${indice}`} />

          if (tecla === 'apagar') {
            return (
              <button
                key="apagar"
                type="button"
                onClick={() => aoMudar(valor.slice(0, -1))}
                disabled={desabilitado || valor.length === 0}
                aria-label="Apagar o último dígito"
                className={`${TECLA_BASE} text-mute hover:text-plat active:text-plat`}
              >
                <Delete size={22} aria-hidden="true" />
              </button>
            )
          }

          return (
            <button
              key={tecla}
              type="button"
              onClick={() => digitar(tecla)}
              disabled={desabilitado || valor.length >= TAMANHO_PIN}
              className={`${TECLA_BASE} border border-hair bg-ink-2 text-plat hover:border-hair-2 hover:bg-ink-3 active:bg-ink-3`}
            >
              {tecla}
            </button>
          )
        })}
      </div>
    </div>
  )
}
