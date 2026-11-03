import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, CalendarX2, FileUp, Paperclip, Trash2, X } from 'lucide-react'
import {
  OBSERVACAO_MAXIMA,
  PERIODO_MAXIMO_EM_DIAS,
  previaDoHorario,
  previaDosDias,
  ROTULO_DO_TIPO_DE_AUSENCIA,
  TIPOS_DE_AUSENCIA,
  validarRascunhoDoLancamento,
  type ModalidadeDaAusencia,
  type Previa,
} from '../lib/ausencias'
import { lancarAusencia, prepararAtestado, resumoDoAtestado, type AtestadoPronto } from '../lib/faltas'
import { diaCivilDeHoje } from '../lib/formato'
import { dataBrasileira, formatarDuracao } from '../lib/horas'
import { Aviso, Botao, Escolha, Modal } from './ui'

/*
 * "LANÇAR FALTA JUSTIFICADA", no painel da pessoa.
 *
 * Por dias ou por horário, o tipo, a observação e o atestado. O atestado vem da
 * CÂMERA (o botão abre a traseira, para fotografar o papel) ou de um ARQUIVO
 * (o PDF que chegou por e-mail, a foto que chegou por WhatsApp). A foto que o
 * navegador abre é refeita em JPEG no aparelho antes de subir, e deixa para
 * trás os metadados da câmera (ver `prepararAtestado`); PDF sobe como veio.
 *
 * AQUI, DIFERENTE DA SELFIE, ESCOLHER ARQUIVO É CERTO. A selfie prova "fui eu,
 * agora", e por isso não aceita galeria. O atestado prova "o médico disse", e o
 * documento existe antes do lançamento: vem de onde vier.
 *
 * AS REGRAS SÃO CONFERIDAS ANTES DE SUBIR O ARQUIVO, porque o bucket não deixa
 * apagar: um atestado que subiu para uma ausência que o banco recusou fica lá
 * para sempre. `validarRascunhoDoLancamento` repete as regras do gatilho; a
 * sobreposição com outra ausência e a trava da própria ausência, só o banco
 * sabe, e aí o arquivo fica, sem dono. A tela da própria ficha nem abre esta
 * caixa (`PainelDaPessoa`).
 *
 * O ID DA AUSÊNCIA NASCE AQUI E SOBREVIVE ÀS TENTATIVAS. Ele dá nome ao
 * arquivo, e o bucket não sobrescreve: tentar de novo com o mesmo id reaproveita
 * o arquivo que já subiu. Trocar de arquivo sorteia outro id; senão o arquivo
 * velho é que ficaria anexado.
 *
 * POR DIAS OU POR HORÁRIO. "Por dias" pede a data de início e QUANTOS dias, e
 * mostra a data final calculada (dias corridos: 3 dias são a data de início e
 * as duas seguintes); "Por horário" pede a data e os dois horários, e mostra a
 * duração. Nenhum dos dois pede o dia final nem a quantidade de horas: o que
 * sai de conta não se digita. A data é a mesma nas duas (trocar de modalidade
 * não a perde); os campos da outra modalidade somem da tela e não vão para o
 * banco. As contas e as recusas são de `previaDosDias`, `previaDoHorario` e
 * `validarRascunhoDoLancamento`.
 *
 * O FORMULÁRIO É `noValidate`: quem recusa é a validação daqui, com frase em
 * português, e não o balão do navegador (que diria "Preencha este campo" num
 * idioma qualquer, e não diria nada sobre "1,5 dia").
 */

/**
 * O porquê, no lugar dos botões de lançar e de cancelar, na tela da pessoa que
 * é a própria conta de quem está logado. A regra é do banco (a trava da
 * própria ausência), para todo mundo, inclusive o super admin.
 */
export const POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA =
  'Esta ficha é a sua. Quem é dono do ponto não lança nem cancela a própria ausência: outra pessoa que administra o ponto faz isso.'

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
  'w-full min-w-0 min-h-11 rounded-xl border border-plat/40 bg-ink-2 px-3 py-2.5 text-sm text-plat ' +
  'placeholder:text-faint transition-colors [color-scheme:dark] ' +
  'focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25'

/*
 * O HORÁRIO NO PAR ESTREITO PERDE O ÍCONE DO RELÓGIO, como no editor da semana
 * (`EditorDaSemana`). Com o ícone, o campo pede uns 100 px para mostrar "08:00"
 * inteiro. O par mora num `@container`; abaixo de 15rem (240 px), cada campo
 * fica com menos de 116 px e o ícone sai. No celular o seletor nativo abre ao
 * tocar no campo, com ou sem ele. `min-w-0` no campo e na coluna: sem eles, o
 * `<input>` guarda a largura mínima que o navegador dá a ele e empurra a linha
 * para fora da caixa.
 */
const CAMPO_DE_HORA = `${CAMPO} tabular-nums @max-[15rem]:[&::-webkit-calendar-picker-indicator]:hidden`

const ROTULO = 'mb-1 block text-sm font-medium text-plat-dim'

const MODALIDADES: readonly { valor: ModalidadeDaAusencia; rotulo: string }[] = [
  { valor: 'dias', rotulo: 'Por dias' },
  { valor: 'horario', rotulo: 'Por horário' },
]

/** A linha da conta (data final ou duração), discreta enquanto falta campo. */
function LinhaDaConta<T>({
  id,
  rotulo,
  previa,
  valor,
}: {
  id: string
  rotulo: string
  previa: Previa<T>
  valor: (pronta: { ok: true } & T) => string
}) {
  return (
    <p id={id} aria-live="polite" className="mt-1.5 text-xs leading-relaxed">
      <span className="text-mute">{`${rotulo}: `}</span>
      {previa.ok ? (
        <span className="font-mono font-medium text-plat tabular-nums">{valor(previa)}</span>
      ) : (
        <span className={previa.falta ? 'text-faint' : 'text-warn'}>{previa.erro}</span>
      )}
    </p>
  )
}

type EstadoDoArquivo =
  | { nome: 'nenhum' }
  | { nome: 'preparando'; arquivo: string }
  | { nome: 'pronto'; arquivo: string; atestado: AtestadoPronto }

export function LancamentoDeAusencia({ usuarioId, nomeDoFuncionario, diaSugerido, aoFechar, aoLancada }: Props) {
  const [ausenciaId, setAusenciaId] = useState(() => crypto.randomUUID())
  const [modalidade, setModalidade] = useState<ModalidadeDaAusencia>('dias')
  const [dia, setDia] = useState(diaSugerido)
  const [quantidadeDeDias, setQuantidadeDeDias] = useState('1')
  const [horaInicio, setHoraInicio] = useState('')
  const [horaFim, setHoraFim] = useState('')
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

    const conferido = validarRascunhoDoLancamento(
      { modalidade, dia, quantidadeDeDias, horaInicio, horaFim, tipo, observacao },
      diaCivilDeHoje(),
    )
    if (!conferido.ok) {
      setErro(conferido.erro)
      return
    }

    setGravando(true)
    try {
      await lancarAusencia({
        id: ausenciaId,
        usuarioId,
        modalidade: conferido.valores.modalidade,
        diaInicio: conferido.valores.dia_inicio,
        diaFim: conferido.valores.dia_fim,
        horaInicio: conferido.valores.hora_inicio,
        horaFim: conferido.valores.hora_fim,
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
  const previaDias = previaDosDias(dia, quantidadeDeDias)
  const previaHorario = previaDoHorario(horaInicio, horaFim)

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
          Atestado médico e falta justificada{' '}
          <span className="text-plat">abonam a parte da jornada que cobrem e que não foi trabalhada</span>,
          sem apagar nenhuma batida: o que a pessoa trabalhou nesse tempo continua contando como
          trabalho. <span className="text-plat">Outro motivo só marca o dia</span>, sem abonar. Depois
          de lançada, a ausência não muda: para corrigir, cancele com motivo e lance de novo.
        </p>

        <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-4 space-y-3">
          {/* A modalidade: dois rádios de verdade, com cara de controle
              segmentado. Setas trocam a escolha, como em qualquer grupo de
              rádio; o foco aparece no segmento. */}
          <fieldset disabled={gravando}>
            <legend className={ROTULO}>Como lançar</legend>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-plat/40 bg-ink-2 p-1">
              {MODALIDADES.map((opcao) => (
                <label key={opcao.valor} className="relative min-w-0">
                  <input
                    type="radio"
                    name="ausencia-modalidade"
                    id={`ausencia-modalidade-${opcao.valor}`}
                    value={opcao.valor}
                    checked={modalidade === opcao.valor}
                    onChange={() => {
                      setModalidade(opcao.valor)
                      setErro(null)
                    }}
                    className="peer sr-only"
                  />
                  <span
                    className={
                      'flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-sm font-semibold leading-snug transition-colors select-none ' +
                      'text-mute hover:text-plat-dim peer-checked:bg-luz peer-checked:text-ink-0 ' +
                      'peer-focus-visible:ring-2 peer-focus-visible:ring-luz/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink-2 ' +
                      'peer-disabled:cursor-not-allowed peer-disabled:opacity-60'
                    }
                  >
                    {opcao.rotulo}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {modalidade === 'dias' ? (
            <div>
              {/* A data e a quantidade dividem a linha quando a CAIXA tem
                  largura (e não a janela); a quantidade é curta, a data não. */}
              <div className="@container">
                <div className="grid grid-cols-1 gap-2 @min-[15rem]:grid-cols-[minmax(0,1fr)_6.5rem]">
                  <div className="min-w-0">
                    <label htmlFor="ausencia-dia" className={ROTULO}>
                      Data de início
                    </label>
                    <input
                      id="ausencia-dia"
                      type="date"
                      value={dia}
                      onChange={(evento) => setDia(evento.target.value)}
                      required
                      disabled={gravando}
                      aria-describedby="ausencia-data-final"
                      className={CAMPO}
                    />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="ausencia-quantidade" className={ROTULO}>
                      Quantos dias
                    </label>
                    {/* Texto com teclado numérico, e não `type="number"`: o
                        número do navegador entrega VAZIO para "1,5", e a tela
                        diria "informe a quantidade" para quem informou. */}
                    <input
                      id="ausencia-quantidade"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={quantidadeDeDias}
                      onChange={(evento) => setQuantidadeDeDias(evento.target.value)}
                      required
                      maxLength={4}
                      disabled={gravando}
                      aria-describedby="ausencia-data-final"
                      className={`${CAMPO} tabular-nums`}
                    />
                  </div>
                </div>
              </div>
              <LinhaDaConta
                id="ausencia-data-final"
                rotulo="Data final"
                previa={previaDias}
                valor={(pronta) =>
                  pronta.dias === 1
                    ? `${dataBrasileira(pronta.diaFim)} (um dia só)`
                    : `${dataBrasileira(pronta.diaFim)} (${pronta.dias} dias)`
                }
              />
              <p className="mt-0.5 text-[0.68rem] leading-relaxed text-faint">
                A data de início conta como o primeiro dia, e os dias são corridos (sábado,
                domingo e feriado contam). No máximo {PERIODO_MAXIMO_EM_DIAS} dias.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label htmlFor="ausencia-dia" className={ROTULO}>
                  Data
                </label>
                <input
                  id="ausencia-dia"
                  type="date"
                  value={dia}
                  onChange={(evento) => setDia(evento.target.value)}
                  required
                  disabled={gravando}
                  className={CAMPO}
                />
              </div>
              <div>
                <div className="@container">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <label htmlFor="ausencia-hora-inicio" className={ROTULO}>
                        Das
                      </label>
                      <input
                        id="ausencia-hora-inicio"
                        type="time"
                        step={60}
                        value={horaInicio}
                        onChange={(evento) => setHoraInicio(evento.target.value)}
                        required
                        disabled={gravando}
                        aria-describedby="ausencia-duracao"
                        className={CAMPO_DE_HORA}
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="ausencia-hora-fim" className={ROTULO}>
                        Até
                      </label>
                      <input
                        id="ausencia-hora-fim"
                        type="time"
                        step={60}
                        value={horaFim}
                        onChange={(evento) => setHoraFim(evento.target.value)}
                        required
                        disabled={gravando}
                        aria-describedby="ausencia-duracao"
                        className={CAMPO_DE_HORA}
                      />
                    </div>
                  </div>
                </div>
                <LinhaDaConta
                  id="ausencia-duracao"
                  rotulo="Duração"
                  previa={previaHorario}
                  valor={(pronta) => formatarDuracao(pronta.minutos)}
                />
              </div>
            </div>
          )}

          <Escolha id="ausencia-tipo" rotulo="Tipo" value={tipo} onChange={setTipo} disabled={gravando}>
            {TIPOS_DE_AUSENCIA.map((opcao) => (
              <option key={opcao} value={opcao}>
                {ROTULO_DO_TIPO_DE_AUSENCIA[opcao]}
              </option>
            ))}
          </Escolha>

          <div>
            <label htmlFor="ausencia-observacao" className={ROTULO}>
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
              placeholder="Ex.: consulta médica, exame de rotina"
              className={`${CAMPO} resize-y`}
            />
          </div>

          <fieldset>
            <legend className={ROTULO}>
              Atestado <span className="text-faint">(foto ou PDF, opcional)</span>
            </legend>

            {/* Os dois inputs ficam escondidos; quem os abre são os botões. O
                da câmera pede a TRASEIRA: é papel, não rosto. */}
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
