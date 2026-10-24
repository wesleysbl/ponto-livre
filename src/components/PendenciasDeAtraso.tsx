import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, Clock, LocateOff, MapPin, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  atrasoDoPedido,
  localizacaoDoPedido,
  pedidosPendentes,
  validarMotivoDaRecusa,
  type PedidoDeAtraso,
} from '../lib/atraso'
import { formatarHora, TEXTO_SEM_LOCALIZACAO, type Batida } from '../lib/formato'
import { nomeDeQuemPediu } from '../lib/nomes'
import { rotuloDoDia } from '../lib/horas'
import { ANCORA_DOS_PEDIDOS, ancoraDoPedido, previaDaAprovacao, type PreviaDaAprovacao } from '../lib/painel'
import {
  decidirPedido,
  desfechoDaFalhaDaDecisao,
  lerPedidosPendentes,
  type AvisoDaLista,
} from '../lib/pedidos'
import { VisorDeSelfie } from './VisorDeSelfie'
import { Aviso, Botao, Etiqueta, Modal } from './ui'

/*
 * A CAIXA DE PENDÊNCIAS DE BATIDA EM ATRASO — o lado do admin.
 *
 * O CONTADOR É A PRIMEIRA COISA, e é o motivo de a caixa morar no topo do
 * painel: o admin abre o painel para fechar o mês, e pedido esperando decisão é
 * o que ele precisa ver antes de olhar total nenhum — pedido pendente não conta
 * hora, e o total que ele vê embaixo ainda vai mudar quando ele aprovar.
 *
 * CADA PEDIDO MOSTRA O QUE O ADMIN PRECISA PARA DECIDIR: quem pediu, o horário
 * declarado e o horário REAL do pedido (e quanto tempo depois), o motivo, a
 * selfie e onde a pessoa estava no momento do pedido.
 *
 * QUEM DECIDE É O BANCO. A tela não deixa o admin decidir o próprio pedido (o
 * botão nem aparece), mas quem recusa de verdade é
 * `ponto_decidir_pedido_atraso` — que também recusa pedido já decidido por
 * outra pessoa, recusa sem motivo, e aprovação sem a selfie no bucket.
 *
 * DEPOIS DE DECIDIR, A LISTA É RELIDA, e o painel também (`aoDecidir`): a
 * aprovação cria uma batida e reordena o dia, e costurar isso na memória seria
 * reimplementar o banco no navegador.
 *
 * A MESMA CAIXA SERVE À TELA DA PESSOA. Lá ela
 * mostra só os pedidos daquela conta (`usuarioId`, filtrado na tela: a RLS já
 * deixa quem administra ler todos), some quando não há pedido, e quem conta a
 * decisão é o recado do rodapé da tela (`recadoNaTela`). Cada leitura sobe
 * pela `aoLer` — o bloco "Antes de fechar" do painel, o cartão do dia e a caixa
 * de inserir usam esta leitura, sem uma segunda.
 *
 * O CARTÃO MOSTRA COMO O DIA FICA COM A APROVAÇÃO (`batidasDoDia`): "Neste dia
 * já tem: 08:00 · 12:00 · 17:00 (dia incompleto)" e "Com a aprovação: 4
 * batidas, 8h00." É o que evita a batida dobrada — quem já inseriu a 13:05 à
 * mão vê isso antes de aprovar a mesma 13:05.
 */

type Estado =
  | { nome: 'carregando' }
  | { nome: 'pronto'; pedidos: PedidoDeAtraso[] }
  | { nome: 'falhou'; mensagem: string }

async function buscar(usuarioId: string | undefined): Promise<Estado> {
  try {
    const pendentes = pedidosPendentes(await lerPedidosPendentes())
    return {
      nome: 'pronto',
      pedidos: usuarioId ? pendentes.filter((pedido) => pedido.usuario_id === usuarioId) : pendentes,
    }
  } catch (falha) {
    return {
      nome: 'falhou',
      mensagem: falha instanceof Error ? falha.message : 'Não deu para carregar os pedidos.',
    }
  }
}

type Decisao = {
  pedido: PedidoDeAtraso
  aprovar: boolean
  /** O nome de exibição de quem pediu (`nomeDeQuemPediu`, `lib/nomes.ts`). Sem ele, a caixa usa o congelado no pedido. */
  nome?: string
}

/** O que foi decidido, para a tela contar no recado e reler o que mudou. */
export interface PedidoDecidido {
  pedido: PedidoDeAtraso
  aprovar: boolean
}

interface Props {
  /**
   * Chamado depois de cada decisão gravada, para a tela reler as batidas — com
   * o pedido e o sentido, ou com `null` quando a lista estava velha (alguém
   * decidiu antes).
   */
  aoDecidir?: (decidido: PedidoDecidido | null) => void
  /** Conta -> nome de exibição, do painel. Sem ele, vale o nome congelado no pedido. */
  nomes?: ReadonlyMap<string, string>
  /** Só os pedidos desta conta: a tela da pessoa. */
  usuarioId?: string
  /** O título da seção na tela da pessoa. Sem ele, "Batidas em atraso para decidir". */
  titulo?: string
  /** O id do título — a âncora para onde os links levam. */
  idDoTitulo?: string
  /** Sem nenhum pedido, a seção não aparece (a tela da pessoa). */
  esconderSemPedidos?: boolean
  /** Cada leitura que chega, ou `null` quando ela falha. */
  aoLer?: (pedidos: PedidoDeAtraso[] | null) => void
  /** As batidas do dia de cada pedido, como a tela já as leu. `null`: a tela não sabe. */
  batidasDoDia?: (pedido: PedidoDeAtraso) => readonly Batida[] | null
  /** O dia civil de hoje, para a prévia dizer "em andamento". */
  hoje?: string
  /** A tela conta a decisão no próprio recado: a seção não repete a frase de sucesso. */
  recadoNaTela?: boolean
}

export function PendenciasDeAtraso({
  aoDecidir,
  nomes,
  usuarioId,
  titulo,
  idDoTitulo,
  esconderSemPedidos = false,
  aoLer,
  batidasDoDia,
  hoje,
  recadoNaTela = false,
}: Props) {
  const { usuario } = useAuth()
  const [estado, setEstado] = useState<Estado>({ nome: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [selfie, setSelfie] = useState<PedidoDeAtraso | null>(null)
  const [decisao, setDecisao] = useState<Decisao | null>(null)
  const [aviso, setAviso] = useState<AvisoDaLista | null>(null)
  // A `aoLer` de agora, sem entrar nas dependências da leitura: a tela pai a
  // recria a cada desenho, e isso não é motivo para ler o banco de novo.
  const aoLerAtual = useRef(aoLer)
  useEffect(() => {
    aoLerAtual.current = aoLer
  })

  useEffect(() => {
    let vivo = true
    void buscar(usuarioId).then((resultado) => {
      if (!vivo) return
      setEstado(resultado)
      aoLerAtual.current?.(resultado.nome === 'pronto' ? resultado.pedidos : null)
    })
    return () => {
      vivo = false
    }
  }, [tentativa, usuarioId])

  function reler() {
    setEstado({ nome: 'carregando' })
    setTentativa((n) => n + 1)
  }

  return (
    <ListaDePendencias
      estado={estado}
      usuarioId={usuario?.id ?? null}
      nomes={nomes}
      aviso={aviso}
      titulo={titulo}
      idDoTitulo={idDoTitulo}
      esconderSemPedidos={esconderSemPedidos}
      batidasDoDia={batidasDoDia}
      hoje={hoje}
      aoTentarDeNovo={reler}
      aoAbrirSelfie={setSelfie}
      aoDecidir={(pedido, aprovar) => {
        setAviso(null)
        setDecisao({ pedido, aprovar, nome: nomeDeQuemPediu(pedido, nomes, 'esta pessoa') })
      }}
    >
      {selfie && (
        <VisorDeSelfie
          batida={{
            registrado_em: selfie.horario_declarado,
            selfie_path: selfie.selfie_path,
            distancia_metros: selfie.distancia_metros,
            no_local: selfie.no_local,
          }}
          descricao={`Pedido de batida em atraso · enviado às ${formatarHora(selfie.pedido_em)}`}
          aoFechar={() => setSelfie(null)}
        />
      )}

      {decisao && (
        <CaixaDeDecisao
          decisao={decisao}
          aoFechar={() => setDecisao(null)}
          aoGravar={(mensagem) => {
            const decidido = { pedido: decisao.pedido, aprovar: decisao.aprovar }
            setDecisao(null)
            if (!recadoNaTela) setAviso({ tom: 'bom', texto: mensagem })
            reler()
            aoDecidir?.(decidido)
          }}
          aoListaVelha={(avisoDaLista) => {
            setDecisao(null)
            setAviso(avisoDaLista)
            reler()
            // Quem decidiu antes pode ter aprovado: a batida nova entra no painel.
            aoDecidir?.(null)
          }}
        />
      )}
    </ListaDePendencias>
  )
}

/* ------------------------------------------------------------------ */
/* O desenho, sem efeitos — é o que o teste de tela desenha            */
/* ------------------------------------------------------------------ */

interface PropsDaLista {
  estado: Estado
  /** A conta da sessão: o pedido dela não tem botão de decidir. */
  usuarioId: string | null
  /** Conta -> nome de exibição (do painel). */
  nomes?: ReadonlyMap<string, string>
  aviso?: AvisoDaLista | null
  /** O título na tela da pessoa: "Pedidos … de Ana esperando decisão (1)". */
  titulo?: string
  idDoTitulo?: string
  /** Sem nenhum pedido (ou ainda lendo), a seção não aparece. */
  esconderSemPedidos?: boolean
  batidasDoDia?: (pedido: PedidoDeAtraso) => readonly Batida[] | null
  hoje?: string
  aoTentarDeNovo: () => void
  aoAbrirSelfie: (pedido: PedidoDeAtraso) => void
  aoDecidir: (pedido: PedidoDeAtraso, aprovar: boolean) => void
  children?: ReactNode
}

export function ListaDePendencias({
  estado,
  usuarioId,
  nomes,
  aviso = null,
  titulo,
  idDoTitulo = ANCORA_DOS_PEDIDOS,
  esconderSemPedidos = false,
  batidasDoDia,
  hoje,
  aoTentarDeNovo,
  aoAbrirSelfie,
  aoDecidir,
  children,
}: PropsDaLista) {
  const quantos = estado.nome === 'pronto' ? estado.pedidos.length : null

  // Na tela da pessoa, a seção só existe com pedido (ou com a falha da
  // leitura, que precisa aparecer). As caixas abertas continuam montadas.
  if (esconderSemPedidos && !aviso && (estado.nome === 'carregando' || quantos === 0)) {
    return <>{children}</>
  }

  return (
    <section aria-labelledby={idDoTitulo} className="mt-6 scroll-mt-4">
      <div className="flex items-center justify-between gap-3">
        {titulo ? (
          <h2 id={idDoTitulo} className="flex items-center gap-2 text-sm font-semibold text-plat">
            <Clock size={15} aria-hidden="true" className="shrink-0 text-warn" />
            <span>
              {titulo} ({quantos === null ? '…' : quantos})
            </span>
          </h2>
        ) : (
          <h2
            id={idDoTitulo}
            className="flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint"
          >
            <Clock size={13} aria-hidden="true" />
            Batidas em atraso para decidir
            <span
              className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[0.68rem] tracking-normal tabular-nums ${
                quantos ? 'bg-warn-soft text-warn' : 'bg-ink-2 text-mute'
              }`}
              aria-label={quantos === null ? 'contando' : `${quantos} pendentes`}
            >
              {quantos === null ? '…' : quantos}
            </span>
          </h2>
        )}
        {estado.nome !== 'carregando' && (
          <button
            type="button"
            onClick={aoTentarDeNovo}
            className="inline-flex min-h-11 items-center gap-1.5 text-xs text-mute transition-colors hover:text-plat-dim"
          >
            <RefreshCw size={13} aria-hidden="true" />
            Atualizar
          </button>
        )}
      </div>

      {aviso && (
        <div className="mt-2">
          <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>
        </div>
      )}

      {estado.nome === 'carregando' && <p className="mt-2 text-sm text-mute">Carregando…</p>}

      {estado.nome === 'falhou' && (
        <div className="mt-2">
          <Aviso tom="atencao">{estado.mensagem}</Aviso>
        </div>
      )}

      {estado.nome === 'pronto' && estado.pedidos.length === 0 && (
        <p className="mt-2 text-sm leading-relaxed text-mute">
          Nenhum pedido esperando decisão. Quando alguém pedir uma batida em atraso, ela aparece aqui.
        </p>
      )}

      {estado.nome === 'pronto' && estado.pedidos.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {estado.pedidos.map((pedido) => (
            <CartaoDoPedido
              key={pedido.id}
              pedido={pedido}
              nome={nomeDeQuemPediu(pedido, nomes)}
              proprio={pedido.usuario_id === usuarioId}
              previa={previaDoPedido(pedido, batidasDoDia, hoje)}
              aoAbrirSelfie={() => aoAbrirSelfie(pedido)}
              aoAprovar={() => aoDecidir(pedido, true)}
              aoRecusar={() => aoDecidir(pedido, false)}
            />
          ))}
        </ul>
      )}

      {children}
    </section>
  )
}

/** A prévia do cartão, com as batidas que a tela já leu daquele dia. */
function previaDoPedido(
  pedido: PedidoDeAtraso,
  batidasDoDia: ((pedido: PedidoDeAtraso) => readonly Batida[] | null) | undefined,
  hoje: string | undefined,
): PreviaDaAprovacao | null {
  const batidas = batidasDoDia?.(pedido)
  if (!batidas) return null
  return previaDaAprovacao({ dia: pedido.dia_civil, batidas, hora: formatarHora(pedido.horario_declarado), hoje })
}

const COR_DO_PINO = {
  ausente: 'text-faint',
  imprecisa: 'text-warn',
  no_local: 'text-luz',
  fora: 'text-warn',
} as const

interface PropsDoCartao {
  pedido: PedidoDeAtraso
  /** O nome de exibição de quem pediu. Sem ele, o congelado no pedido (`nomeDeQuemPediu`). */
  nome?: string
  /** O pedido é da própria conta da sessão: quem pediu não decide. */
  proprio: boolean
  /** Como o dia fica com a aprovação. Sem ela, o cartão não fala do dia. */
  previa?: PreviaDaAprovacao | null
  aoAbrirSelfie: () => void
  aoAprovar: () => void
  aoRecusar: () => void
}

export function CartaoDoPedido({ pedido, nome, proprio, previa = null, aoAbrirSelfie, aoAprovar, aoRecusar }: PropsDoCartao) {
  const local = localizacaoDoPedido(pedido)

  return (
    <li
      id={ancoraDoPedido(pedido.id)}
      tabIndex={-1}
      className="scroll-mt-4 rounded-2xl border border-hair bg-ink-1 px-4 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-plat">
            {nome ?? nomeDeQuemPediu(pedido)}
          </p>
          <p className="mt-0.5 text-[0.7rem] text-faint">{rotuloDoDia(pedido.dia_civil)}</p>
        </div>
        <button
          type="button"
          onClick={aoAbrirSelfie}
          aria-label={`Ver a selfie do pedido das ${formatarHora(pedido.horario_declarado)}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-hair-2 bg-ink-2 text-mute transition-colors hover:border-hair-3 hover:text-plat"
        >
          <Camera size={15} aria-hidden="true" />
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-hair bg-ink-2 px-3 py-2">
          <dt className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-faint">
            Horário pedido
          </dt>
          <dd className="mt-0.5 font-mono text-lg text-plat tabular-nums">
            {formatarHora(pedido.horario_declarado)}
          </dd>
        </div>
        <div className="rounded-lg border border-hair bg-ink-2 px-3 py-2">
          <dt className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-faint">
            Pedido às
          </dt>
          <dd className="mt-0.5 font-mono text-lg text-plat tabular-nums">
            {formatarHora(pedido.pedido_em)}
            <span className="ml-1.5 font-sans text-[0.62rem] text-mute">{atrasoDoPedido(pedido)}</span>
          </dd>
        </div>
      </dl>

      <p className="mt-2.5 text-sm leading-relaxed break-words text-plat-dim italic">
        “{pedido.motivo}”
      </p>
      {/* O pedido que saiu sem localização: a etiqueta
          neutra, como na batida, no lugar do pino. Aprovado, ele vira uma
          batida sem localização. */}
      {local.nome === 'sem_gps' ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.7rem] text-faint">
          <Etiqueta tom="neutro">
            <LocateOff size={10} aria-hidden="true" />
            {local.texto}
          </Etiqueta>
          o GPS não respondeu no momento do pedido
        </p>
      ) : (
        <p className="mt-1.5 flex items-center gap-1 text-[0.7rem] text-faint">
          <MapPin size={11} aria-hidden="true" className={COR_DO_PINO[local.nome]} />
          {local.texto} no momento do pedido
        </p>
      )}

      {previa && (
        <div className="mt-2.5 rounded-lg border border-hair bg-ink-2 px-3 py-2 text-xs leading-relaxed text-mute">
          <p>{previa.agora}</p>
          <p className={`mt-1 ${previa.atencao ? 'text-warn' : 'text-luz'}`}>{previa.depois}</p>
        </div>
      )}

      {proprio ? (
        <p className="mt-3 rounded-lg border border-hair-2 bg-ink-2 px-3 py-2 text-[0.7rem] leading-relaxed text-mute">
          Este pedido é seu. Quem decide é outra pessoa que administra o ponto.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Botao tom="secundario" onClick={aoRecusar}>
            <X size={15} aria-hidden="true" />
            Recusar
          </Botao>
          <Botao onClick={aoAprovar}>
            <Check size={15} aria-hidden="true" />
            Aprovar
          </Botao>
        </div>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* A confirmação                                                       */
/* ------------------------------------------------------------------ */

interface PropsDaDecisao {
  decisao: Decisao
  aoFechar: () => void
  aoGravar: (mensagem: string) => void
  /** O banco disse que o pedido já foi decidido ou sumiu: a lista está velha. */
  aoListaVelha: (aviso: AvisoDaLista) => void
}

export function CaixaDeDecisao({ decisao, aoFechar, aoGravar, aoListaVelha }: PropsDaDecisao) {
  const { pedido, aprovar } = decisao
  const [motivo, setMotivo] = useState('')
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const nome = decisao.nome ?? nomeDeQuemPediu(pedido, new Map(), 'esta pessoa')
  const hora = formatarHora(pedido.horario_declarado)

  async function confirmar() {
    if (!aprovar) {
      const conferido = validarMotivoDaRecusa(motivo)
      if (!conferido.ok) {
        setErro(conferido.erro)
        return
      }
    }
    setGravando(true)
    setErro(null)
    try {
      await decidirPedido({ pedidoId: pedido.id, aprovar, motivo })
      aoGravar(
        aprovar
          ? `Aprovado: a batida das ${hora} de ${nome} entrou no ponto, e o dia foi posto na ordem do relógio.`
          : `Recusado: o pedido das ${hora} de ${nome} não entra no ponto. A pessoa vê o motivo.`,
      )
    } catch (falha) {
      setGravando(false)
      const desfecho = desfechoDaFalhaDaDecisao(falha)
      if (desfecho.nome === 'lista_velha') {
        aoListaVelha(desfecho.aviso)
        return
      }
      setErro(desfecho.mensagem)
    }
  }

  return (
    <Modal
      rotulo={aprovar ? 'Aprovar batida em atraso' : 'Recusar batida em atraso'}
      aoFechar={aoFechar}
      podeFechar={!gravando}
    >
      <h2 className="text-lg font-semibold text-plat">
        {aprovar ? 'Aprovar batida em atraso' : 'Recusar batida em atraso'}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-mute">
        {aprovar
          ? `A batida das ${hora} entra no ponto de ${nome}, ${
              pedido.latitude === null
                ? `com a selfie do pedido e marcada como ${TEXTO_SEM_LOCALIZACAO} (o GPS não respondeu)`
                : 'com a selfie e a localização do pedido'
            }. As outras batidas do dia são postas na ordem do relógio.`
          : `O pedido das ${hora} de ${nome} não entra no ponto. Ele continua guardado, com o motivo que você escrever.`}
      </p>

      <div className="mt-4">
        <label htmlFor="decisao-motivo" className="mb-1.5 block text-sm font-medium text-plat-dim">
          {aprovar ? 'Observação (opcional)' : 'Motivo da recusa'}
        </label>
        <textarea
          id="decisao-motivo"
          rows={3}
          value={motivo}
          disabled={gravando}
          onChange={(evento) => setMotivo(evento.target.value)}
          placeholder={aprovar ? 'Ex.: confirmado com a recepção.' : 'Ex.: neste horário você estava de folga.'}
          className="w-full min-h-11 rounded-xl border border-hair-2 bg-ink-2 px-4 py-3 text-sm text-plat placeholder:text-faint transition-colors focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25 disabled:opacity-60"
        />
      </div>

      {erro && (
        <div className="mt-3">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Botao tom="secundario" onClick={aoFechar} disabled={gravando}>
          Voltar
        </Botao>
        <Botao onClick={() => void confirmar()} disabled={gravando}>
          {gravando ? 'Gravando…' : aprovar ? 'Aprovar' : 'Recusar'}
        </Botao>
      </div>
    </Modal>
  )
}
