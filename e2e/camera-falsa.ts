import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Browser } from '@playwright/test'
import { RAIZ } from './apoio.ts'

/*
 * A CÂMERA FALSA: O ROSTO ILUSTRADO NO LUGAR DA WEBCAM.
 *
 * A selfie da batida sai da câmera (`getUserMedia`, em
 * `src/components/CapturaDeSelfie.tsx`), e não de um arquivo escolhido — é de
 * propósito, e por isso o teste não tem como "anexar" uma foto. O Chrome tem
 * uma câmera de mentira para isso: com `--use-fake-device-for-media-stream` e
 * `--use-file-for-fake-video-capture=<arquivo>`, a webcam passa a mostrar o
 * arquivo; `--use-fake-ui-for-media-stream` responde "Permitir" sozinho.
 *
 * O ARQUIVO NASCE NO PRÓPRIO TESTE, do desenho de `demo/rostos/` (pessoas
 * fictícias, desenhadas para isto). Nenhum vídeo binário entra no repositório
 * e nada depende de ffmpeg: o SVG é desenhado num canvas do próprio Chrome e
 * gravado como JPEG. Um arquivo `.mjpeg` é uma fila de quadros JPEG; com um
 * quadro só, o Chrome repete o mesmo quadro para sempre — uma pessoa parada
 * diante da câmera. (Conferido no Chrome 155: a trilha sai 640×480 com o
 * caminho do arquivo como rótulo, e o quadro é o desenho.)
 *
 * O QUADRO É 640×480, o VGA de uma webcam comum, e o rosto fica no centro:
 * o app recorta o quadrado do meio (480×480), que é exatamente a faixa do
 * desenho entre o alto da cabeça e os ombros. As faixas dos lados repetem a
 * coluna da borda do desenho, que é só o fundo.
 *
 * A FAIXA DE COR. O Chrome lê o JPEG da câmera falsa como vídeo de faixa
 * limitada (16 a 235), e cada canal sai esticado para 0 a 255 — a pele fica
 * mais clara e mais saturada que no desenho. O quadro é gravado já comprimido
 * para a faixa limitada, e a selfie volta com as cores do desenho.
 */

/** O rosto da câmera falsa nesta execução: a Ana Beatriz Rocha, do elenco, é quem bate ponto. */
export const ROSTO_DA_CAMERA = 'ana'

/** Fora do repositório: o teste não grava nada na pasta do projeto (a não ser os prints, com PRINTS=1). */
export const ARQUIVO_DA_CAMERA = join(tmpdir(), 'ponto-livre-e2e', `camera-${ROSTO_DA_CAMERA}.mjpeg`)

/** A cor da pele do desenho da Ana (`#c68a5e` em `demo/rostos/ana.svg`), para conferir a selfie. */
export const PELE_DA_ANA: readonly [number, number, number] = [0xc6, 0x8a, 0x5e]

/**
 * Onde, na selfie quadrada (480×480), cai a bochecha do desenho: o centro de
 * um quadrado de 20 px só de pele, longe do olho, do nariz, da boca e do
 * rosado da bochecha. A selfie é a faixa y 60–540 do desenho (480×640), na
 * largura inteira; o ponto x 178, y 288 do desenho cai em (178, 228).
 */
export const BOCHECHA_NA_SELFIE = { x: 178, y: 228, lado: 20 } as const

/** Os argumentos do Chrome para a webcam mostrar o arquivo. */
export function argumentosDaCameraFalsa(arquivo: string = ARQUIVO_DA_CAMERA): string[] {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${arquivo}`,
  ]
}

const LARGURA = 640
const ALTURA = 480
/** A faixa do desenho que vira o quadro: do alto da cabeça (y 60) aos ombros (y 540). */
const TOPO_DO_RECORTE = 60

/**
 * Desenha `demo/rostos/<rosto>.svg` num quadro 640×480 e grava o `.mjpeg` em
 * `destino`. Usa uma página do navegador que já está aberto para o teste.
 */
export async function gerarCameraFalsa(navegador: Browser, rosto: string, destino: string): Promise<void> {
  const svg = readFileSync(join(RAIZ, 'demo', 'rostos', `${rosto}.svg`), 'utf8')
  const pagina = await navegador.newPage()
  try {
    const base64 = await pagina.evaluate(
      async ({ svg, largura, altura, topo }) => {
        const imagem = new Image()
        imagem.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        await imagem.decode()

        const tela = document.createElement('canvas')
        tela.width = largura
        tela.height = altura
        const pincel = tela.getContext('2d')
        if (!pincel) throw new Error('Sem canvas 2D para desenhar a câmera falsa.')

        // O desenho no tamanho natural, centralizado, com o recorte do topo.
        const x = Math.round((largura - imagem.naturalWidth) / 2)
        pincel.drawImage(imagem, x, -topo)

        const quadro = pincel.getImageData(0, 0, largura, altura)
        const px = quadro.data
        const direita = x + imagem.naturalWidth - 1
        for (let y = 0; y < altura; y++) {
          // As faixas dos lados repetem a coluna da borda do desenho (o fundo).
          for (let coluna = 0; coluna < largura; coluna++) {
            if (coluna >= x && coluna <= direita) continue
            const origem = (y * largura + (coluna < x ? x : direita)) * 4
            const alvo = (y * largura + coluna) * 4
            px[alvo] = px[origem]
            px[alvo + 1] = px[origem + 1]
            px[alvo + 2] = px[origem + 2]
            px[alvo + 3] = 255
          }
        }
        // A faixa limitada (ver o cabeçalho): 0–255 vira 16–235.
        for (let i = 0; i < px.length; i += 4) {
          px[i] = Math.round(16 + (px[i] * 219) / 255)
          px[i + 1] = Math.round(16 + (px[i + 1] * 219) / 255)
          px[i + 2] = Math.round(16 + (px[i + 2] * 219) / 255)
        }
        pincel.putImageData(quadro, 0, 0)
        return tela.toDataURL('image/jpeg', 0.92).split(',')[1]
      },
      { svg, largura: LARGURA, altura: ALTURA, topo: TOPO_DO_RECORTE },
    )
    mkdirSync(dirname(destino), { recursive: true })
    writeFileSync(destino, Buffer.from(base64, 'base64'))
  } finally {
    await pagina.close()
  }
}
