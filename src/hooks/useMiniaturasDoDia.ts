import { useEffect, useState, type RefObject } from 'react'
import { urlsAssinadasDasSelfies } from '../lib/batidas'

/*
 * AS MINIATURAS DAS SELFIES DE UM DIA DO PAINEL.
 *
 * ASSINA SÓ QUANDO O DIA CHEGA PERTO DA TELA
 * O link da selfie vive dois minutos (`SEGUNDOS_DE_VALIDADE_DA_SELFIE`). Um mês
 * no painel tem vinte e tantos dias; assinar tudo ao abrir a página entregaria
 * links que vencem antes de a pessoa rolar até o dia 28, e baixaria fotos que
 * ninguém olhou. Por isso o dia só pede as assinaturas quando entra (ou está a
 * 200 px de entrar) na tela, e pede as do dia inteiro de uma vez. A imagem
 * baixa na hora, dentro da validade, e depois fica na memória do navegador.
 *
 * O MAPA VEM MARCADO COM OS CAMINHOS QUE ASSINOU
 * Se o dia mudar (uma batida corrigida ou inserida), a chave muda e o mapa
 * velho deixa de valer sem precisar zerar estado dentro do efeito, coisa que a
 * regra `set-state-in-effect` recusa.
 *
 * FALHOU, FICA A CÂMERA
 * Sem rede ou sem permissão, o dia segue com o ícone de antes: o clique abre o
 * visor, que assina de novo e diz o motivo. Miniatura é conveniência.
 */

const NENHUMA: ReadonlyMap<string, string> = new Map()

export function useMiniaturasDoDia(
  alvo: RefObject<Element | null>,
  caminhos: readonly string[],
): ReadonlyMap<string, string> {
  const chave = caminhos.join('\n')
  const [assinadas, setAssinadas] = useState<{
    chave: string
    urls: ReadonlyMap<string, string>
  }>({ chave: '', urls: NENHUMA })

  useEffect(() => {
    const elemento = alvo.current
    if (!elemento || chave === '') return
    let vivo = true

    const assinar = () => {
      urlsAssinadasDasSelfies(chave.split('\n'))
        .then((urls) => {
          if (vivo) setAssinadas({ chave, urls })
        })
        .catch(() => {
          // Fica a câmera; o visor explica a falha quando a pessoa clicar.
        })
    }

    // Navegador sem IntersectionObserver (antigo): assina já, sem esperar a rolagem.
    if (typeof IntersectionObserver === 'undefined') {
      assinar()
      return () => {
        vivo = false
      }
    }

    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((entrada) => entrada.isIntersecting)) return
        observador.disconnect()
        assinar()
      },
      { rootMargin: '200px 0px' },
    )
    observador.observe(elemento)

    return () => {
      vivo = false
      observador.disconnect()
    }
  }, [alvo, chave])

  return assinadas.chave === chave ? assinadas.urls : NENHUMA
}
