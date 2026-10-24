import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import { atestadoAbreComoLink, atestadoEhPdf } from '../lib/ausencias'
import { SEGUNDOS_DE_VALIDADE_DO_ATESTADO, urlAssinadaDoAtestado } from '../lib/faltas'
import { Aviso, Botao, Modal } from './ui'

/*
 * O ATESTADO DE UMA AUSÊNCIA, ABERTO POR LINK TEMPORÁRIO.
 *
 * O mesmo desenho do `VisorDeSelfie`, e pelas mesmas razões: o bucket
 * `ponto-atestados` é privado, cada abertura pede ao storage uma URL assinada
 * que vive dois minutos, e quem decide se a pessoa vê é a policy do bucket
 * (admin, ou o dono da pasta) — não esta tela.
 *
 * FOTO MOSTRA, PDF VIRA LINK. Um PDF dentro de um `<img>` é um quadrado
 * quebrado, e dentro de um `<iframe>` o Safari do iPhone mostra só a primeira
 * página, sem rolar. O link abre no leitor do próprio aparelho, que sabe
 * aproximar, rolar e salvar. A foto, diferente da selfie, NÃO é recortada em
 * quadrado: o atestado é uma folha em pé, e cortar as pontas cortaria o
 * carimbo ou a assinatura.
 */

interface Props {
  caminho: string
  /** O que é este atestado — "Atestado médico · 28/10/2026". */
  descricao: string
  aoFechar: () => void
}

type Estado =
  | { nome: 'assinando' }
  | { nome: 'pronto'; url: string }
  | { nome: 'falhou'; motivo: string }

export function VisorDeAtestado({ caminho, descricao, aoFechar }: Props) {
  const pdf = atestadoEhPdf(caminho)
  // PDF e HEIC viram link (ver `atestadoAbreComoLink`); o resto, miniatura.
  const comoLink = atestadoAbreComoLink(caminho)
  const [estado, setEstado] = useState<Estado>({ nome: 'assinando' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let vivo = true
    void urlAssinadaDoAtestado(caminho)
      .then((url) => {
        if (vivo) setEstado({ nome: 'pronto', url })
      })
      .catch((falha: unknown) => {
        if (!vivo) return
        setEstado({
          nome: 'falhou',
          motivo: falha instanceof Error ? falha.message : 'Não deu para abrir este atestado.',
        })
      })
    return () => {
      vivo = false
    }
  }, [caminho, tentativa])

  return (
    <Modal rotulo={`Atestado: ${descricao}`} aoFechar={aoFechar}>
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              Atestado {pdf ? '(PDF)' : ''}
            </p>
            <p className="mt-1 text-sm break-words text-plat">{descricao}</p>
          </div>
          <button
            onClick={aoFechar}
            aria-label="Fechar o atestado"
            className="-mt-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4">
          {estado.nome === 'assinando' && (
            <div className="flex h-40 items-center justify-center rounded-xl border border-hair-2 bg-ink-2">
              <div
                className="h-8 w-8 animate-spin rounded-full border-2 border-hair-3 border-t-luz"
                role="status"
                aria-label="Carregando o atestado"
              />
            </div>
          )}

          {estado.nome === 'pronto' && comoLink && (
            <a
              href={estado.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-luz px-3 py-3 text-center text-sm font-semibold text-ink-0 transition-colors hover:bg-luz-deep"
            >
              <ExternalLink size={16} aria-hidden="true" />
              {pdf ? 'Abrir o PDF do atestado' : 'Abrir a foto do atestado'}
            </a>
          )}

          {estado.nome === 'pronto' && !comoLink && (
            <div className="overflow-hidden rounded-xl border border-hair-2 bg-ink-2">
              <img
                src={estado.url}
                alt={`Atestado: ${descricao}`}
                className="max-h-[70dvh] w-full object-contain"
                onError={() =>
                  setEstado({
                    nome: 'falhou',
                    motivo: 'O link deste atestado expirou. Gere um novo para ver de novo.',
                  })
                }
              />
            </div>
          )}

          {estado.nome === 'falhou' && (
            <div className="space-y-3">
              <Aviso tom="atencao">{estado.motivo}</Aviso>
              <Botao
                tom="secundario"
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
        </div>

        <p className="mt-3 text-center text-[0.68rem] leading-relaxed text-faint">
          O link deste atestado vale por {Math.round(SEGUNDOS_DE_VALIDADE_DO_ATESTADO / 60)} minutos e
          depois deixa de funcionar.
        </p>
      </>
    </Modal>
  )
}
