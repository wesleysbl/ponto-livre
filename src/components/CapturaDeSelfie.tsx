import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Check, RefreshCw } from 'lucide-react'
import { Aviso, Botao, Painel } from './ui'
import { comPrazo, PRAZO_PADRAO_MS } from '../lib/prazo'

/*
 * A selfie da batida: câmera frontal, pré-visualização e opção de refazer.
 *
 * A FOTO É EVIDÊNCIA, NÃO BIOMETRIA
 * Não há reconhecimento facial nenhum aqui, de propósito (ver o item 2 de
 * `docs/DEFESA.md`, "A foto é evidência, não biometria"). A foto
 * responde "foi você que apertou", e quem a olha é uma pessoa, no painel do
 * admin. Por isso também não existe filtro, retoque nem "melhorar imagem".
 *
 * POR QUE getUserMedia E NÃO <input type="file" capture="user">
 * O input abre o app de câmera do sistema, que no Android deixa escolher a
 * galeria e no iPhone permite reenviar uma foto antiga — uma selfie de terça
 * comprovaria a presença de quinta. Com getUserMedia o quadro sai do sensor
 * naquele instante e não há caminho para anexar arquivo.
 *
 * O QUADRO É RECORTADO EM QUADRADO E LIMITADO A 720 px
 * Selfie de celular sai em 12 MP; o bucket aceita 3 MB e a rede é 4G no
 * corredor. 720×720 em JPEG 0,82 fica na casa de 100 KB, mostra o rosto com
 * folga e sobe rápido — que é o que importa para quem está batendo ponto de pé.
 *
 * O ESPELHO É SÓ DA PRÉ-VISUALIZAÇÃO AO VIVO
 * Vídeo ao vivo não espelhado dá a sensação de que a mão está do lado errado.
 * O que é GRAVADO é o quadro verdadeiro, sem espelhamento — a evidência tem que
 * ser o que a câmera viu, não o que a pessoa está acostumada a ver no espelho.
 */

const LADO_MAXIMO = 720
const QUALIDADE_JPEG = 0.82

const COMO_LIBERAR =
  'No iPhone: Ajustes › Safari › Câmera › Perguntar ou Permitir. No Android: toque no cadeado ' +
  'ao lado do endereço › Permissões › Câmera. Depois recarregue o app.'

interface FalhaDaCamera {
  mensagem: string
  comoResolver: string | null
}

/*
 * PRAZO PARA A CÂMERA ABRIR.
 *
 * `getUserMedia` pode simplesmente NÃO RESOLVER: nem sucesso nem erro. E
 * `video.play()` idem. Como `setEstado('ao_vivo')` só roda depois dos dois, sem
 * prazo o botão "Tirar foto" ficaria desabilitado sob um spinner mudo — acontece
 * numa concessão fria de câmera do macOS, por exemplo. Há "Cancelar", então não
 * é beco sem saída, mas num celular lento a pessoa veria girar sem saber por
 * quê.
 *
 * O prazo cobre a abertura INTEIRA, não cada metade: `limite` é calculado uma
 * vez e o `play()` herda o que sobrou. Assim o pior caso continua sendo 12 s, e
 * não 12 + 12.
 *
 * `EXPIROU` é um sentinel, e não `null`, porque `null` é um valor que
 * `getUserMedia` poderia teoricamente devolver — o sentinel não se confunde com
 * resultado nenhum.
 */
const EXPIROU = Symbol('camera-nao-abriu')

const CAMERA_DEMOROU: FalhaDaCamera = {
  mensagem: `A câmera não abriu em ${PRAZO_PADRAO_MS / 1000} segundos.`,
  comoResolver:
    'Se apareceu um aviso pedindo permissão, toque em "Permitir" e use "Tentar de novo" — ' +
    'num aparelho lento, tentar de novo costuma resolver.',
}

function traduzirErroDeCamera(falha: unknown): FalhaDaCamera {
  const nome = falha instanceof Error ? falha.name : ''
  switch (nome) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        mensagem: 'Você negou o acesso à câmera, então nenhuma batida foi registrada.',
        comoResolver: COMO_LIBERAR,
      }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return {
        mensagem: 'Não encontramos uma câmera frontal neste aparelho.',
        comoResolver: 'Tente pelo celular. A batida precisa da selfie.',
      }
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        mensagem: 'A câmera está ocupada por outro aplicativo.',
        comoResolver: 'Feche o outro app que está usando a câmera e tente de novo.',
      }
    default:
      return {
        mensagem:
          falha instanceof Error && falha.message ? falha.message : 'Não deu para abrir a câmera.',
        comoResolver: null,
      }
  }
}

type Estado = 'abrindo' | 'ao_vivo' | 'previa' | 'negada'

interface Props {
  /** A foto foi confirmada pela pessoa. O Blob é JPEG, pronto para subir. */
  aoCapturar: (foto: Blob) => void
  aoCancelar: () => void
}

export function CapturaDeSelfie({ aoCapturar, aoCancelar }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const [estado, setEstado] = useState<Estado>('abrindo')
  const [falha, setFalha] = useState<FalhaDaCamera | null>(null)
  const [foto, setFoto] = useState<Blob | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  /** Muda a cada "tentar de novo" e é o que faz o efeito reabrir a câmera. */
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let vivo = true
    let fluxo: MediaStream | null = null

    async function abrir() {
      setFalha(null)
      setEstado('abrindo')

      // Sem HTTPS o navegador nem expõe mediaDevices. Dizer isso é melhor que
      // um "não deu para abrir a câmera" que não explica nada.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setFalha({
          mensagem: 'A câmera só funciona em conexão segura (HTTPS).',
          comoResolver: 'Abra o app pelo endereço oficial, com https://, e não por IP local.',
        })
        setEstado('negada')
        return
      }

      // Um relógio só para a abertura inteira: getUserMedia + play().
      const limite = Date.now() + PRAZO_PADRAO_MS

      try {
        const pedido = navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        })

        const chegada = await comPrazo<MediaStream | typeof EXPIROU>(pedido, EXPIROU)

        if (chegada === EXPIROU) {
          // O prazo não cancela o pedido — ele só para de esperar. Se a câmera
          // abrir depois, a luz dela não pode ficar acesa atrás de uma tela que
          // já desistiu.
          void pedido
            .then((tardio) => tardio.getTracks().forEach((trilha) => trilha.stop()))
            .catch(() => undefined)

          if (!vivo) return
          setFalha(CAMERA_DEMOROU)
          setEstado('negada')
          return
        }

        fluxo = chegada

        // Desmontou enquanto o navegador perguntava: a luz da câmera não pode
        // ficar acesa por causa de uma tela que já saiu.
        if (!vivo) {
          fluxo.getTracks().forEach((trilha) => trilha.stop())
          return
        }

        const video = videoRef.current
        if (video) {
          video.srcObject = fluxo
          // play() rejeita em algumas políticas de autoplay; o vídeo é mudo e
          // playsInline, então na prática ele anda. Engolir aqui evita uma
          // exceção não tratada por um detalhe que não impede a captura.
          //
          // O prazo aqui usa o que sobrou do limite, e estourar NÃO é falha: o
          // fluxo já está preso ao <video> e os quadros aparecem de qualquer
          // jeito. O que não pode é a promessa pendurada segurar o botão.
          await comPrazo<void>(
            video.play().catch(() => undefined),
            undefined,
            Math.max(0, limite - Date.now()),
          )
        }
        if (!vivo) return
        setEstado('ao_vivo')
      } catch (erro) {
        if (!vivo) return
        setFalha(traduzirErroDeCamera(erro))
        setEstado('negada')
      }
    }

    void abrir()

    return () => {
      vivo = false
      fluxo?.getTracks().forEach((trilha) => trilha.stop())
    }
  }, [tentativa])

  // A URL da prévia é um recurso do navegador, não uma string: sem revogar,
  // cada refazer deixa um Blob preso na memória da aba.
  useEffect(() => {
    if (!previa) return
    return () => URL.revokeObjectURL(previa)
  }, [previa])

  function capturar() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const largura = video.videoWidth
    const altura = video.videoHeight
    const lado = Math.min(largura, altura)
    const alvo = Math.min(lado, LADO_MAXIMO)

    const tela = document.createElement('canvas')
    tela.width = alvo
    tela.height = alvo

    const pincel = tela.getContext('2d')
    if (!pincel) {
      setFalha({ mensagem: 'Não deu para processar a foto neste navegador.', comoResolver: null })
      setEstado('negada')
      return
    }

    // Recorte central: o rosto está no meio do quadro, e um quadrado evita que
    // a foto mude de proporção conforme o aparelho.
    pincel.drawImage(video, (largura - lado) / 2, (altura - lado) / 2, lado, lado, 0, 0, alvo, alvo)

    tela.toBlob(
      (blob) => {
        if (!blob) {
          setFalha({ mensagem: 'A foto não pôde ser gerada. Tente de novo.', comoResolver: null })
          setEstado('negada')
          return
        }
        setFoto(blob)
        setPrevia(URL.createObjectURL(blob))
        setEstado('previa')
      },
      'image/jpeg',
      QUALIDADE_JPEG,
    )
  }

  function refazer() {
    setFoto(null)
    setPrevia(null)
    setEstado('ao_vivo')
  }

  return (
    <Painel>
      <h2 className="text-center text-lg font-semibold text-plat">
        {estado === 'previa' ? 'Ficou boa?' : 'Olhe para a câmera'}
      </h2>
      <p className="mt-1 text-center text-sm leading-relaxed text-mute">
        {estado === 'previa'
          ? 'Esta foto fica guardada como comprovante da batida.'
          : 'A selfie é a evidência de que foi você quem bateu.'}
      </p>

      {/*
        O quadro NUNCA é desmontado, nem no erro: se o <video> saísse do DOM,
        o "tentar de novo" reabriria a câmera com a referência ainda nula e o
        fluxo não teria onde ser exibido.
      */}
      <div className="relative mx-auto mt-6 aspect-square w-full overflow-hidden rounded-2xl border border-hair-2 bg-ink-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full scale-x-[-1] object-cover"
        />

        {estado === 'abrindo' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-0">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-hair-3 border-t-luz"
              role="status"
              aria-label="Abrindo a câmera"
            />
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              Abrindo a câmera
            </p>
          </div>
        )}

        {estado === 'negada' && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-0 text-faint">
            <CameraOff size={34} aria-hidden="true" />
          </div>
        )}

        {estado === 'previa' && previa && (
          <img src={previa} alt="Prévia da sua selfie" className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>

      {falha && (
        <div className="mt-5">
          <Aviso tom="erro">
            {falha.mensagem}
            {falha.comoResolver && (
              <span className="mt-2 block text-xs leading-relaxed opacity-80">
                {falha.comoResolver}
              </span>
            )}
          </Aviso>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {estado === 'previa' && foto ? (
          <>
            <Botao onClick={() => aoCapturar(foto)}>
              <Check size={16} aria-hidden="true" />
              Usar esta foto
            </Botao>
            <Botao tom="secundario" onClick={refazer}>
              <RefreshCw size={16} aria-hidden="true" />
              Refazer
            </Botao>
          </>
        ) : estado === 'negada' ? (
          <Botao onClick={() => setTentativa((n) => n + 1)}>
            <RefreshCw size={16} aria-hidden="true" />
            Tentar de novo
          </Botao>
        ) : (
          <Botao onClick={capturar} disabled={estado !== 'ao_vivo'}>
            <Camera size={16} aria-hidden="true" />
            Tirar foto
          </Botao>
        )}

        <Botao tom="discreto" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </Painel>
  )
}
