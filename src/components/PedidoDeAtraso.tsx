import { useState, type FormEvent } from 'react'
import { ArrowRight, Hourglass, LocateOff, MapPin, X } from 'lucide-react'
import {
  horaMaximaDeHoje,
  momentoDaHoraDeHoje,
  MOTIVO_MAXIMO,
  MOTIVO_MINIMO,
  validarMotivo,
} from '../lib/atraso'
import { formatarDistancia, formatarHora, SEM_LOCALIZACAO_POR_EXTENSO, type Batida } from '../lib/formato'
import type { PedidoGravado } from '../lib/batidas'
import { ondeFicaOHorario, resumoDeHojeNoFormulario } from '../lib/tela-de-bater'
import { Aviso, Botao, Campo, Painel } from './ui'

/*
 * O PEDIDO DE BATIDA EM ATRASO, DO LADO DO COLABORADOR.
 *
 * DUAS PEÇAS: o formulário (horário e motivo), que abre o fluxo, e o recibo
 * ("pedido enviado, aguardando aprovação"), que o fecha. Entre as duas, o fluxo
 * é o da batida, na mesma ordem e pelo mesmo motivo — selfie, localização e
 * PIN —, e mora em `Bater.tsx`.
 *
 * O FORMULÁRIO VEM ANTES DA SELFIE, e não depois: horário e motivo são o que
 * pode estar ERRADO (futuro, outro dia, motivo curto). Conferir isso depois da
 * foto e do PIN faria a pessoa tirar a selfie e digitar o PIN para descobrir
 * que escolheu 23h00 às 00h10. A conferência é a mesma da RPC
 * (`lib/atraso.ts`), e a RPC confere de novo — a da tela é conforto.
 *
 * SÓ HOJE, E A QUEM RECORRER PARA OUTRO DIA.
 * O formulário mostra as batidas de hoje ("Hoje você já bateu: 08:02 Entrada ·
 * 12:01 Almoço") e onde a hora escolhida cai entre elas, para a pessoa não
 * pedir a batida que já existe. E diz o que fazer quando o esquecimento foi em
 * outro dia: avisar o RH, que corrige pelo painel — o pedido não serve para isso.
 *
 * SEM LOCALIZAÇÃO, COMO A BATIDA. Quando o
 * GPS não responde, o pedido também pode sair sem coordenada, com a selfie e o
 * PIN — pelo mesmo botão da falha de localização, em `Bater.tsx`. O recibo diz
 * "Sem localização (o GPS não respondeu)", e a aprovação cria a batida assim.
 */

export interface DadosDoFormulario {
  hora: string
  motivo: string
}

interface PropsDoFormulario {
  /** O que a pessoa já tinha digitado, quando volta de um erro. */
  inicial?: DadosDoFormulario
  aoContinuar: (dados: DadosDoFormulario) => void
  aoCancelar: () => void
  /**
   * As batidas de hoje, quando a lista foi lida. Sem ela (carregando ou com
   * erro), o formulário não afirma nada sobre o dia.
   */
  batidasDeHoje?: readonly Batida[]
  /** O relógio, injetável para o teste de tela. */
  agora?: () => Date
}

export function FormularioDeAtraso({
  inicial,
  aoContinuar,
  aoCancelar,
  batidasDeHoje,
  agora = () => new Date(),
}: PropsDoFormulario) {
  const [hora, setHora] = useState(inicial?.hora ?? '')
  const [motivo, setMotivo] = useState(inicial?.motivo ?? '')
  const [erro, setErro] = useState<string | null>(null)

  const caracteres = motivo.trim().length
  const ondeFica = batidasDeHoje ? ondeFicaOHorario(hora, batidasDeHoje) : null

  function enviar(evento: FormEvent) {
    evento.preventDefault()
    const horario = momentoDaHoraDeHoje(hora, agora())
    if (!horario.ok) {
      setErro(horario.erro)
      return
    }
    const conferido = validarMotivo(motivo)
    if (!conferido.ok) {
      setErro(conferido.erro)
      return
    }
    setErro(null)
    aoContinuar({ hora, motivo: conferido.motivo })
  }

  return (
    <Painel>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-plat">Registrar batida em atraso</h2>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            Para quando você chegou (ou saiu) e esqueceu de bater. Só vale para hoje e entra no seu
            ponto quando o RH aprovar. Esqueceu em outro dia? Avise o RH, que corrige pelo painel.
          </p>
        </div>
        <button
          type="button"
          onClick={aoCancelar}
          aria-label="Cancelar o pedido"
          className="-mt-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      {batidasDeHoje && (
        <p className="mt-4 rounded-xl border border-hair bg-ink-2 px-3 py-2 font-mono text-xs leading-relaxed text-plat-dim tabular-nums">
          {resumoDeHojeNoFormulario(batidasDeHoje)}
        </p>
      )}

      <form onSubmit={enviar} className="mt-5 space-y-4" noValidate>
        <div>
          <Campo
            id="atraso-hora"
            rotulo="Que horas você chegou ou saiu e esqueceu de bater?"
            type="time"
            required
            value={hora}
            max={horaMaximaDeHoje(agora())}
            onChange={(evento) => setHora(evento.target.value)}
          />
          {ondeFica && <p className="mt-1.5 text-xs leading-relaxed text-mute">{ondeFica}</p>}
        </div>

        <div>
          <label htmlFor="atraso-motivo" className="mb-1.5 block text-sm font-medium text-plat-dim">
            Motivo
          </label>
          <textarea
            id="atraso-motivo"
            required
            rows={3}
            maxLength={MOTIVO_MAXIMO}
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
            placeholder="Ex.: cheguei às 8h, mas o celular estava sem bateria."
            className="w-full min-h-11 rounded-xl border border-hair-2 bg-ink-2 px-4 py-3 text-sm text-plat placeholder:text-faint transition-colors focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25"
          />
          <p
            className={`mt-1 text-right font-mono text-[0.62rem] tabular-nums ${
              caracteres > 0 && caracteres < MOTIVO_MINIMO ? 'text-warn' : 'text-faint'
            }`}
          >
            {caracteres < MOTIVO_MINIMO
              ? `mínimo ${MOTIVO_MINIMO} letras · ${caracteres}`
              : `${caracteres}/${MOTIVO_MAXIMO}`}
          </p>
        </div>

        {erro && <Aviso tom="erro">{erro}</Aviso>}

        <Botao type="submit">
          Continuar: selfie, localização e PIN
          <ArrowRight size={16} aria-hidden="true" />
        </Botao>
      </form>
    </Painel>
  )
}

interface PropsDoRecibo {
  pedido: PedidoGravado
  miniatura: string | null
  aoFechar: () => void
}

/**
 * O recibo do pedido. Tudo aqui veio do SERVIDOR — o horário declarado já
 * truncado ao minuto, o horário real do pedido, a distância do momento do
 * pedido —, como no comprovante da batida.
 */
export function ReciboDoPedido({ pedido, miniatura, aoFechar }: PropsDoRecibo) {
  return (
    <Painel>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-warn">
        <Hourglass size={24} aria-hidden="true" />
      </div>

      <h2 className="text-center text-lg font-semibold text-plat">Pedido enviado</h2>
      <p className="mt-1 text-center text-sm text-mute">Aguardando aprovação do RH</p>

      <p className="mt-6 text-center font-mono text-5xl font-medium tracking-tight text-plat tabular-nums">
        {formatarHora(pedido.horario_declarado)}
      </p>
      <p className="mt-1.5 text-center font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
        Horário pedido · enviado às {formatarHora(pedido.pedido_em)}
      </p>

      {miniatura && (
        <div className="mt-6 flex justify-center">
          <img
            src={miniatura}
            alt="Selfie enviada com o pedido"
            className="h-24 w-24 rounded-2xl border border-hair-2 object-cover"
          />
        </div>
      )}

      <div className="mt-6 rounded-xl border border-hair bg-ink-2 px-4 py-3">
        <p className="text-sm leading-relaxed break-words text-plat-dim italic">“{pedido.motivo}”</p>
        {pedido.latitude === null ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-mute">
            <LocateOff size={13} aria-hidden="true" className="text-mute" />
            {SEM_LOCALIZACAO_POR_EXTENSO}
          </p>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-mute">
            <MapPin
              size={13}
              aria-hidden="true"
              className={pedido.no_local ? 'text-luz' : 'text-warn'}
            />
            {pedido.no_local === null
              ? 'Sem distância calculada'
              : pedido.no_local
                ? 'No local no momento do pedido'
                : `${formatarDistancia(pedido.distancia_metros)} do local no momento do pedido`}
          </p>
        )}
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-faint">
        Enquanto não for aprovado, o pedido não entra no seu ponto nem no total de horas. Você
        acompanha a resposta aqui e no seu espelho.
      </p>

      <div className="mt-6">
        <Botao tom="secundario" onClick={aoFechar}>
          Concluir
        </Botao>
      </div>
    </Painel>
  )
}
