import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, CalendarX2, FileUp, Paperclip, Trash2, X } from 'lucide-react'
import {
  OBSERVACAO_MAXIMA,
  ROTULO_DO_TIPO_DE_AUSENCIA,
  TIPOS_DE_AUSENCIA,
  validarLancamento,
} from '../lib/ausencias'
import { lancarAusencia, prepararAtestado, resumoDoAtestado, type AtestadoPronto } from '../lib/faltas'
import { diaCivilDeHoje } from '../lib/formato'
import { Aviso, Botao, Escolha, Modal } from './ui'

/*
 * "LANÇAR FALTA JUSTIFICADA" — no painel da pessoa.
 *
 * O dia ou o período, o tipo, a observação e o atestado. O atestado vem da
 * CÂMERA (o botão abre a traseira, para fotografar o papel) ou de um ARQUIVO
 * (o PDF que chegou por e-mail, a foto que chegou por WhatsApp). A foto que o
 * navegador abre é refeita em JPEG no aparelho antes de subir, e deixa para
 * trás os metadados da câmera (ver `prepararAtestado`); PDF sobe como veio.
 *
 * AQUI, DIFERENTE DA SELFIE, ESCOLHER ARQUIVO É CERTO. A selfie prova "fui eu,
 * agora", e por isso não aceita galeria. O atestado prova "o médico disse", e o
 * documento existe antes do lançamento — vem de onde vier.
 *
 * AS REGRAS SÃO CONFERIDAS ANTES DE SUBIR O ARQUIVO, porque o bucket não deixa
 * apagar: um atestado que subiu para uma ausência que o banco recusou fica lá
 * para sempre. `validarLancamento` repete as regras do gatilho; a sobreposição
 * com outra ausência, só o banco sabe — e aí o arquivo fica, sem dono.
 *
 * O ID DA AUSÊNCIA NASCE AQUI E SOBREVIVE ÀS TENTATIVAS. Ele dá nome ao
 * arquivo, e o bucket não sobrescreve: tentar de novo com o mesmo id reaproveita
 * o arquivo que já subiu. Trocar de arquivo sorteia outro id — senão o arquivo
 * velho é que ficaria anexado.
 */

interface Props {
  usuarioId: string
  nomeDoFuncionario: string
  /**
   * O dia que abre no formulário: o da linha clicada ("Lançar falta neste
   * dia") ou, pelo botão do topo, hoje ou o último dia do período.
   */
  diaSugerido: string
  aoFechar: () => void
  aoLancada: () => void
}

// Borda `plat/40` (3,5:1), como o `Campo` de `ui.tsx`.
const CAMPO =
  'w-full min-h-11 rounded-xl border border-plat/40 bg-ink-2 px-3 py-2.5 text-sm text-plat ' +
  'placeholder:text-faint transition-colors [color-scheme:dark] ' +
  'focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25'

type EstadoDoArquivo =
  | { nome: 'nenhum' }
  | { nome: 'preparando'; arquivo: string }
  | { nome: 'pronto'; arquivo: string; atestado: AtestadoPronto }

export function LancamentoDeAusencia({ usuarioId, nomeDoFuncionario, diaSugerido, aoFechar, aoLancada }: Props) {
  const [ausenciaId, setAusenciaId] = useState(() => crypto.randomUUID())
  const [diaInicio, setDiaInicio] = useState(diaSugerido)
  const [diaFim, setDiaFim] = useState(diaSugerido)
  const [tipo, setTipo] = useState<string>('atestado_medico')
  const [observacao, setObservacao] = useState('')
  const [arquivo, setArquivo] = useState<EstadoDoArquivo>({ nome: 'nenhum' })
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const camera = useRef<HTMLInputElement>(null)
  const seletor = useRef<HTMLInputElement>(null)

  async function aoEscolher(evento: ChangeEvent<HTMLInputElement>) {
    const escolhido = evento.target.files?.[0]
    // Limpa o input: escolher o MESMO arquivo de novo tem de disparar o evento.
    evento.target.value = ''
    if (!escolhido) return
    setErro(null)
    setArquivo({ nome: 'preparando', arquivo: escolhido.name })
    try {
      const atestado = await prepararAtestado(escolhido)
      // Arquivo novo, id novo: ver o cabeçalho.
      setAusenciaId(crypto.randomUUID())
      setArquivo({ nome: 'pronto', arquivo: escolhido.name, atestado })
    } catch (falha) {
      setArquivo({ nome: 'nenhum' })
      setErro(falha instanceof Error ? falha.message : 'Não deu para preparar este arquivo.')
    }
  }

  function removerArquivo() {
    setAusenciaId(crypto.randomUUID())
    setArquivo({ nome: 'nenhum' })
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    setErro(null)
    if (arquivo.nome === 'preparando') return

    const conferido = validarLancamento({ diaInicio, diaFim, tipo, observacao }, diaCivilDeHoje())
    if (!conferido.ok) {
      setErro(conferido.erro)
      return
    }

    setGravando(true)
    try {
      await lancarAusencia({
        id: ausenciaId,
        usuarioId,
        diaInicio: conferido.valores.dia_inicio,
        diaFim: conferido.valores.dia_fim,
        tipo: conferido.valores.tipo,
        observacao: conferido.valores.observacao,
        atestado: arquivo.nome === 'pronto' ? arquivo.atestado : null,
      })
      aoLancada()
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não deu para lançar a ausência.')
      setGravando(false)
    }
  }

  const ocupado = gravando || arquivo.nome === 'preparando'

  return (
    <Modal rotulo="Lançar falta justificada" aoFechar={aoFechar} podeFechar={!gravando}>
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              Falta justificada
            </p>
            <h2 className="mt-1 truncate text-base font-semibold text-plat">{nomeDoFuncionario}</h2>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            disabled={gravando}
            aria-label="Fechar"
            className="-mt-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat disabled:opacity-40"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5 text-xs leading-relaxed text-mute">
          A ausência <span className="text-plat">marca os dias</span> no espelho, no painel, na folha e
          no CSV, mas <span className="text-plat">não soma nem desconta horas</span>. Depois de
          lançada ela não muda: para corrigir, cancele com motivo e lance de novo.
        </p>

        <form onSubmit={(evento) => void enviar(evento)} className="mt-4 space-y-3">
          {/* Mesmo par de campos do ajuste de batida, pela mesma razão: empilha
              quando a CAIXA é estreita, e não quando a janela é. */}
          <div className="@container">
            <div className="grid grid-cols-1 gap-2 @min-[20rem]:grid-cols-2">
              <div>
                <label htmlFor="ausencia-inicio" className="mb-1 block text-sm font-medium text-plat-dim">
                  Primeiro dia
                </label>
                <input
                  id="ausencia-inicio"
                  type="date"
                  value={diaInicio}
                  onChange={(evento) => {
                    const novo = evento.target.value
                    // Dia único é o caso comum: o fim acompanha o início
                    // enquanto ninguém mexeu nele para formar um período.
                    if (diaFim === diaInicio || diaFim < novo) setDiaFim(novo)
                    setDiaInicio(novo)
                  }}
                  required
                  disabled={gravando}
                  className={CAMPO}
                />
              </div>
              <div>
                <label htmlFor="ausencia-fim" className="mb-1 block text-sm font-medium text-plat-dim">
                  Último dia
                </label>
                <input
                  id="ausencia-fim"
                  type="date"
                  value={diaFim}
                  min={diaInicio}
                  onChange={(evento) => setDiaFim(evento.target.value)}
                  required
                  disabled={gravando}
                  className={CAMPO}
                />
              </div>
            </div>
          </div>

          <Escolha id="ausencia-tipo" rotulo="Tipo" value={tipo} onChange={setTipo} disabled={gravando}>
            {TIPOS_DE_AUSENCIA.map((opcao) => (
              <option key={opcao} value={opcao}>
                {ROTULO_DO_TIPO_DE_AUSENCIA[opcao]}
              </option>
            ))}
          </Escolha>

          <div>
            <label htmlFor="ausencia-observacao" className="mb-1 block text-sm font-medium text-plat-dim">
              Observação{' '}
              {tipo === 'outro' ? (
                <span className="text-warn">(obrigatória neste tipo)</span>
              ) : (
                <span className="text-faint">(opcional)</span>
              )}
            </label>
            <textarea
              id="ausencia-observacao"
              value={observacao}
              onChange={(evento) => setObservacao(evento.target.value)}
              rows={2}
              maxLength={OBSERVACAO_MAXIMA}
              disabled={gravando}
              placeholder="Ex.: consulta às 9h, atestado de meio período"
              className={`${CAMPO} resize-y`}
            />
          </div>

          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-plat-dim">
              Atestado <span className="text-faint">(foto ou PDF, opcional)</span>
            </legend>

            {/* Os dois inputs ficam escondidos; quem os abre são os botões. O
                da câmera pede a TRASEIRA — é papel, não rosto. */}
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(evento) => void aoEscolher(evento)}
            />
            <input
              ref={seletor}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf"
              className="hidden"
              onChange={(evento) => void aoEscolher(evento)}
            />

            {arquivo.nome === 'pronto' ? (
              <div className="flex items-center gap-2 rounded-xl border border-hair-2 bg-ink-2 px-3 py-2">
                <Paperclip size={14} aria-hidden="true" className="shrink-0 text-luz" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-plat">{arquivo.arquivo}</span>
                  <span className="block text-[0.68rem] text-faint">{resumoDoAtestado(arquivo.atestado)}</span>
                </span>
                <button
                  type="button"
                  onClick={removerArquivo}
                  disabled={gravando}
                  aria-label="Tirar o atestado escolhido"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-warn disabled:opacity-40"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Botao
                  type="button"
                  tom="secundario"
                  onClick={() => camera.current?.click()}
                  disabled={ocupado}
                >
                  <Camera size={15} aria-hidden="true" />
                  Fotografar
                </Botao>
                <Botao
                  type="button"
                  tom="secundario"
                  onClick={() => seletor.current?.click()}
                  disabled={ocupado}
                >
                  <FileUp size={15} aria-hidden="true" />
                  Arquivo
                </Botao>
              </div>
            )}

            {arquivo.nome === 'preparando' && (
              <p className="mt-1.5 text-[0.68rem] text-mute" role="status">
                Preparando {arquivo.arquivo}…
              </p>
            )}

            <p className="mt-1.5 text-[0.68rem] leading-relaxed text-faint">
              {tipo === 'atestado_medico' && arquivo.nome === 'nenhum'
                ? 'Sem o arquivo a ausência é aceita, mas o atestado NÃO se anexa depois: quando ele chegar, cancele esta e lance de novo, com ele.'
                : 'A foto é refeita em JPG no aparelho antes de subir. Depois de lançado, o atestado não se troca nem se apaga.'}
            </p>
          </fieldset>

          {erro && <Aviso tom="erro">{erro}</Aviso>}

          <div className="flex flex-col gap-2 pt-1">
            <Botao type="submit" disabled={ocupado}>
              <CalendarX2 size={16} aria-hidden="true" />
              {gravando ? 'Lançando…' : 'Lançar falta justificada'}
            </Botao>
            <Botao type="button" tom="discreto" onClick={aoFechar} disabled={gravando}>
              Cancelar
            </Botao>
          </div>
        </form>
      </>
    </Modal>
  )
}
