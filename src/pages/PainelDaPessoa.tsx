import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarOff,
  CalendarX2,
  Download,
  KeyRound,
  PencilLine,
  Plus,
  Printer,
  RefreshCw,
  UserX,
} from 'lucide-react'
import { AjusteDeBatida, type GravacaoDoAjuste, type ModoDoAjuste } from '../components/AjusteDeBatida'
import { AusenciasDoPeriodo, CaixaDeCancelamento } from '../components/AusenciasDoPeriodo'
import { DiaDeAusencia } from '../components/DiaDeAusencia'
import { LancamentoDeAusencia } from '../components/LancamentoDeAusencia'
import { VisorDeAtestado } from '../components/VisorDeAtestado'
import { BotaoDoDia, DiaDoPainel, DiaSemBatida, PedidosEsperandoNoDia } from '../components/DiaDoPainel'
import { PendenciasDeAtraso, type PedidoDecidido } from '../components/PendenciasDeAtraso'
import { SeletorDePeriodo } from '../components/SeletorDePeriodo'
import { VisorDeSelfie } from '../components/VisorDeSelfie'
import { MarcaDoTopo } from '../components/Marca'
import { Aviso, Botao, Painel as Cartao, Pagina, Recado } from '../components/ui'
import {
  lerBatidasDoPeriodo,
  lerCorrecoesDoUsuario,
  lerGenteDoPainel,
  nomeDoAdmin,
  type Correcao,
} from '../lib/admin'
import { gerarCsvDoPeriodo, nomeDoArquivoCsv } from '../lib/csv'
import { descreverSemLocalizacaoDaPessoa, resumirLocalizacoes } from '../lib/coordenada'
import {
  ausenciasPorDia,
  descreverPeriodo,
  ROTULO_DO_TIPO_DE_AUSENCIA,
  type Ausencia,
} from '../lib/ausencias'
import {
  ancoraDoDia,
  diaDoBotaoDoTopo,
  listarDiasDoPeriodo,
  TETO_DE_DIAS_NA_LISTA,
} from '../lib/corrigir'
import { lerAusenciasDoPeriodo } from '../lib/faltas'
import { lerAprovadoresDoPeriodo } from '../lib/pedidos'
import { baixarCsv } from '../lib/download'
import type { PedidoDeAtraso } from '../lib/atraso'
import { diaCivilDeHoje, formatarHora, type BatidaDoAdmin } from '../lib/formato'
import { agruparPorDia, ehDiaValido, formatarDuracao, mesDe, resumirDias, rotuloDoMes } from '../lib/horas'
import { resetarPinDeUsuario } from '../lib/pin'
import {
  ANCORA_DOS_PEDIDOS_DA_PESSOA,
  ancoraDoPedido,
  fraseDoRecado,
  GENTE_VAZIA,
  pessoaDoPainel,
  primeiroNome,
  type AcaoDoRecado,
  type FuncionarioDoPainel,
  type GenteDoPainel,
} from '../lib/painel'
import {
  lerPeriodo,
  parametrosDoPeriodo,
  periodoPadrao,
  rotuloDoPeriodo,
  type Periodo,
} from '../lib/periodo'

/*
 * O DIA A DIA DE UMA PESSOA, COM AS QUATRO AÇÕES DO FECHAMENTO:
 * corrigir um horário, inserir a batida que faltou, resetar o PIN e exportar.
 *
 * A CONTA É A MESMA DO ESPELHO DELA
 * `agruparPorDia` + `resumirDias`, os mesmos de `Espelho.tsx`. Não existe
 * segunda fórmula: se existisse, o número que o admin usa para fechar a folha
 * poderia divergir do número que o funcionário confere no celular, e num
 * sistema de prova trabalhista essa é a pior divergência possível.
 *
 * O QUE ACONTECE DEPOIS DE GRAVAR UM AJUSTE
 * A lista é relida do banco inteira, e não remendada na memória. Uma correção
 * de horário pode mudar o `dia_civil` da batida (o gatilho recalcula), o que
 * significa que ela pode SAIR do dia em que estava e entrar em outro — ou sair
 * do período. Costurar isso à mão seria reimplementar o gatilho no navegador.
 *
 * AS AUSÊNCIAS ENTRAM NA MESMA LISTA DE DIAS, SEM ENTRAR NA CONTA
 * O dia de falta justificada aparece — com batida ou sem —, e o total do
 * período continua sendo o de `resumirDias`, que só vê batidas. Lançar e
 * cancelar relêem a tela inteira, como o ajuste. A leitura das ausências é
 * parte da carga: se ela falhar, a tela mostra o erro em vez de um mês sem as
 * faltas — o CSV sairia daqui sem elas, e ninguém desconfiaria.
 *
 * TODOS OS DIAS DO PERÍODO ATÉ HOJE
 * A lista mostra cada dia, do início do período até o fim dele ou até hoje
 * (`listarDiasDoPeriodo`): o sábado vazio é uma linha compacta com "Inserir
 * batida neste dia" e "Lançar falta neste dia", e o dia só com ausência também
 * tem o seu "Inserir". Se só aparecessem os dias com batida ou ausência, o RH
 * não acharia como lançar o sábado esquecido de alguém. Período com mais de 62
 * dias volta a mostrar só os dias com conteúdo. O total do topo continua saindo
 * de `resumirDias(agruparPorDia(batidas))`, que não vê dia vazio nenhum — a
 * lista decide as linhas, não a conta. O mês corrente abre rolado em hoje.
 *
 * DEPOIS DE GRAVAR, A TELA NÃO PERDE O LUGAR
 * Um ajuste não zera a tela (a lista sumindo num "Carregando…", voltando do
 * topo, sem nada dizer o que foi gravado). A releitura troca os
 * dados por baixo da lista que está na tela (com um "Atualizando…" discreto ao
 * lado do total), um recado no rodapé diz o que aconteceu ("Batida das 13:00
 * inserida em sex., 16/10. O dia agora soma 8h00.") e a tela rola até o dia
 * mexido, que fica com o contorno verde por 3 s. Só a troca de período começa
 * do zero — aí os dados de antes são de outro recorte.
 *
 * OS PEDIDOS DESTA PESSOA, E A ÂNCORA DA URL
 * Acima dos dias, os pedidos de batida em atraso dela que esperam decisão, com
 * os mesmos cartões e a mesma caixa de decidir do painel (`PendenciasDeAtraso`
 * filtrada pela conta); decidir relê a tela e conta no recado. Cada dia com
 * pedido mostra "Pedido esperando decisão: 13:05 — Decidir", e a caixa de
 * inserir avisa quando o dia já tem pedido. A tela chega aqui também pelos
 * links do bloco "Antes de fechar" e da folha, com a âncora do dia
 * (`#dia-2026-10-16`) ou a dos pedidos: quando os dados chegam, ela rola até a
 * âncora (no lugar de hoje) e destaca o dia por 3 s.
 */

interface Dados {
  /**
   * As contas do ponto, com o nome da regra única e o "pode bater", e o que
   * das fichas dá nome e acesso a esta pessoa quando ela não está entre elas.
   */
  gente: GenteDoPainel
  batidas: BatidaDoAdmin[]
  correcoes: Correcao[]
  /** As ausências que tocam o período, canceladas inclusive. */
  ausencias: Ausencia[]
  /** Quem aprovou cada batida em atraso. De melhor esforço: vazio não é erro. */
  aprovadores: Map<string, string | null>
  erro: string | null
}

const VAZIO: Dados = {
  gente: GENTE_VAZIA,
  batidas: [],
  correcoes: [],
  ausencias: [],
  aprovadores: new Map(),
  erro: null,
}

async function buscar(periodo: Periodo, usuarioId: string): Promise<Dados> {
  try {
    const [gente, batidas, correcoes, ausencias] = await Promise.all([
      lerGenteDoPainel(),
      lerBatidasDoPeriodo(periodo, usuarioId),
      lerCorrecoesDoUsuario(usuarioId),
      lerAusenciasDoPeriodo(periodo, usuarioId),
    ])
    const nomes = new Map(gente.funcionarios.map((pessoa) => [pessoa.usuarioId, pessoa.nome]))
    const aprovadores = await lerAprovadoresDoPeriodo(periodo, nomes, usuarioId)
    return { gente, batidas, correcoes, ausencias, aprovadores, erro: null }
  } catch (falha) {
    return {
      ...VAZIO,
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar esta pessoa.',
    }
  }
}

export function PainelDaPessoa() {
  const navegar = useNavigate()
  const { usuarioId = '' } = useParams()
  const [parametros, setParametros] = useSearchParams()

  const padrao = useMemo(() => periodoPadrao(), [])
  // O dia civil do ponto, lido uma vez: a lista termina nele e o botão do topo abre nele.
  const hoje = useMemo(() => diaCivilDeHoje(), [])
  const mesCorrente = useMemo(() => mesDe(hoje), [hoje])
  const periodo = lerPeriodo(parametros.get('de'), parametros.get('ate'), padrao)

  const [dados, setDados] = useState<Dados>(VAZIO)
  /** Sem dados na tela: a primeira leitura, a troca de período ou a volta de um erro. */
  const [carregando, setCarregando] = useState(true)
  /** Relendo depois de um ajuste, com a lista de antes ainda na tela. */
  const [atualizando, setAtualizando] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  /** O recado do rodapé: o que foi gravado, e de que dia (para "O dia agora soma…" e "Ver o dia"). */
  const [recado, setRecado] = useState<{ chave: number; acao: AcaoDoRecado; dia: string | null } | null>(
    null,
  )
  /** O dia para onde a tela rola e que fica destacado, assim que a releitura chega e a caixa fecha. */
  const [diaEmFoco, setDiaEmFoco] = useState<{ dia: string; vez: number } | null>(null)
  const vezes = useRef(0)

  const [selfieAberta, setSelfieAberta] = useState<BatidaDoAdmin | null>(null)
  const [ajuste, setAjuste] = useState<ModoDoAjuste | null>(null)
  const [pinResetado, setPinResetado] = useState<string | null>(null)
  const [erroDoReset, setErroDoReset] = useState<string | null>(null)
  const [resetando, setResetando] = useState(false)
  /** A caixa de ausência aberta, com o dia com que ela abre (`null`: fechada). */
  const [lancandoEm, setLancandoEm] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<Ausencia | null>(null)
  const [atestadoAberto, setAtestadoAberto] = useState<Ausencia | null>(null)
  /** Os pedidos desta pessoa que esperam decisão, como a caixa de pedidos os leu (`null`: ainda não). */
  const [pedidos, setPedidos] = useState<PedidoDeAtraso[] | null>(null)

  /*
   * A ÂNCORA DA URL: `#dia-2026-10-16`, dos links do bloco "Antes de
   * fechar" e da folha, ou a da seção de pedidos. O dia da âncora fica
   * destacado por 3 s depois que os dados chegam; `ancoraApagada` guarda a
   * âncora cujo destaque já acabou.
   */
  const ancora = useLocation().hash.slice(1)
  const diaDaAncora = ancora.startsWith('dia-') && ehDiaValido(ancora.slice(4)) ? ancora.slice(4) : null
  const [ancoraApagada, setAncoraApagada] = useState<string | null>(null)
  const destaqueDaAncora = diaDaAncora !== null && ancoraApagada !== ancora ? diaDaAncora : null

  useEffect(() => {
    if (!usuarioId) return
    let vivo = true
    void buscar({ inicio: periodo.inicio, fim: periodo.fim }, usuarioId).then((resultado) => {
      if (!vivo) return
      setDados(resultado)
      setCarregando(false)
      setAtualizando(false)
    })
    return () => {
      vivo = false
    }
  }, [usuarioId, periodo.inicio, periodo.fim, tentativa])

  const dias = useMemo(() => agruparPorDia(dados.batidas), [dados.batidas])
  const resumo = useMemo(() => resumirDias(dias), [dias])
  /** "2 sem localização" no período: a régua do painel do mês. */
  const semLocalizacao = useMemo(
    () => descreverSemLocalizacaoDaPessoa(resumirLocalizacoes(dados.batidas)),
    [dados.batidas],
  )
  // Só as ativas, só os dias do período: é isto que marca os dias e vai ao CSV.
  const ausenciasDoDia = useMemo(
    () => ausenciasPorDia(dados.ausencias, { inicio: periodo.inicio, fim: periodo.fim }),
    [dados.ausencias, periodo.inicio, periodo.fim],
  )
  const lista = useMemo(
    () =>
      listarDiasDoPeriodo({
        periodo: { inicio: periodo.inicio, fim: periodo.fim },
        dias,
        ausenciasPorDia: ausenciasDoDia,
        hoje,
      }),
    [dias, ausenciasDoDia, periodo.inicio, periodo.fim, hoje],
  )
  const diasDaLista = lista.dias
  /** Nenhuma batida e nenhuma ausência no período: o aviso de "nenhuma batida" aparece acima da lista. */
  const periodoSemNada = dias.length === 0 && ausenciasDoDia.size === 0

  /*
   * O MÊS CORRENTE ABRE ROLADO EM HOJE. Uma vez por período (a chave), e não a
   * cada releitura: depois de gravar um ajuste a tela relê, e pular para hoje
   * tiraria quem corrige do dia que acabou de mexer. `block: 'center'` deixa os
   * dias de antes à vista, acima. O `?.()` é pelo navegador sem a função (o
   * jsdom da fumaça) — rolar é conforto, nunca motivo de erro.
   *
   * COM ÂNCORA NA URL, ELA GANHA DE HOJE: quem clicou "Corrigir" no
   * dia 16/10 do bloco "Antes de fechar" chega no dia 16, e não em hoje.
   */
  const roladoNoPeriodo = useRef<string | null>(null)
  useEffect(() => {
    if (carregando || dados.erro) return
    const chave = `${periodo.inicio}|${periodo.fim}|${ancora}`
    if (roladoNoPeriodo.current === chave) return
    roladoNoPeriodo.current = chave
    const alvo = ancora ? document.getElementById(ancora) : null
    if (alvo) {
      alvo.scrollIntoView?.({ block: diaDaAncora ? 'center' : 'start' })
      return
    }
    if (hoje < periodo.inicio || hoje > periodo.fim) return
    document.getElementById(ancoraDoDia(hoje))?.scrollIntoView?.({ block: 'center' })
  }, [carregando, dados.erro, periodo.inicio, periodo.fim, hoje, ancora, diaDaAncora])

  /* O destaque do dia da âncora dura 3 s, contados a partir da chegada dos dados. */
  useEffect(() => {
    if (!destaqueDaAncora || carregando || dados.erro) return
    const relogio = setTimeout(() => setAncoraApagada(ancora), 3000)
    return () => clearTimeout(relogio)
  }, [destaqueDaAncora, carregando, dados.erro, ancora])

  /** Os pedidos que esperam decisão, por dia: a linha do cartão do dia e o aviso da caixa de inserir. */
  const pedidosPorDia = useMemo(() => {
    const mapa = new Map<string, PedidoDeAtraso[]>()
    for (const pedido of pedidos ?? []) {
      const doDia = mapa.get(pedido.dia_civil)
      if (doDia) doDia.push(pedido)
      else mapa.set(pedido.dia_civil, [pedido])
    }
    return mapa
  }, [pedidos])

  /** "Decidir", no dia: rola até o cartão do pedido, na seção de cima, e põe o foco nele. */
  function verPedido(pedido: PedidoDeAtraso) {
    const cartao = document.getElementById(ancoraDoPedido(pedido.id))
    cartao?.scrollIntoView?.({ block: 'center' })
    cartao?.focus({ preventScroll: true })
  }

  /*
   * A TELA VAI ATÉ O DIA MEXIDO, quando a releitura chega e nenhuma caixa está
   * aberta ("Inserir e continuar" mantém a caixa aberta: a tela espera o
   * "Concluir"). O destaque dura 3 s. Mesmo `?.()` de cima, pelo jsdom.
   */
  useEffect(() => {
    if (!diaEmFoco || carregando || atualizando || ajuste || dados.erro) return
    document.getElementById(ancoraDoDia(diaEmFoco.dia))?.scrollIntoView?.({ block: 'center' })
    const relogio = setTimeout(() => setDiaEmFoco(null), 3000)
    return () => clearTimeout(relogio)
  }, [diaEmFoco, carregando, atualizando, ajuste, dados.erro])

  /*
   * O texto do recado: a frase da ação e, quando a releitura já chegou, quanto
   * o dia mexido soma agora (`fraseDoRecado`). Escondido enquanto uma caixa
   * está aberta — ele ficaria atrás do fundo escuro, contando os 8 s sozinho;
   * aparece quando ela fecha.
   */
  const textoDoRecado =
    recado && !ajuste
      ? fraseDoRecado(
          recado.acao,
          recado.dia === null || atualizando || carregando
            ? undefined
            : (dias.find((dia) => dia.dia === recado.dia) ?? null),
        )
      : null
  const diaDoRecado = recado?.dia ?? null

  /** "Ver o dia", no recado: rola de novo até o dia e o destaca. */
  function verODia(dia: string) {
    vezes.current += 1
    setDiaEmFoco({ dia, vez: vezes.current })
  }

  /*
   * Quem é esta pessoa (`pessoaDoPainel`). O nome é o da regra única
   * (`nomes.ts`): a ficha de RH ligada à conta, depois o nome guardado na
   * conta, depois o nome gravado nas batidas, depois o e-mail. Fora da lista de
   * contas, a mesma ordem com o que a batida congelou. A batida sobrevive ao
   * desligamento (desenho do banco), e o nome também. O "pode bater"
   * é ficha que libera OU super admin.
   */
  const funcionario: FuncionarioDoPainel = useMemo(
    () => pessoaDoPainel(usuarioId, dados.gente, dados.batidas),
    [dados.gente, dados.batidas, usuarioId],
  )

  const nomesDosAutores = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const pessoa of dados.gente.funcionarios) mapa.set(pessoa.usuarioId, pessoa.nome)
    return mapa
  }, [dados.gente])

  const correcoesPorBatida = useMemo(() => {
    const mapa = new Map<string, Correcao[]>()
    for (const correcao of dados.correcoes) {
      const daBatida = mapa.get(correcao.registro_id)
      if (daBatida) daBatida.push(correcao)
      else mapa.set(correcao.registro_id, [correcao])
    }
    return mapa
  }, [dados.correcoes])

  /*
   * RELER SEM ZERAR. Com dados na tela, a lista fica e só o "Atualizando…"
   * aparece; o erro de antes (sem lista nenhuma) volta ao "Carregando…".
   */
  function recarregar() {
    if (dados.erro) setCarregando(true)
    else setAtualizando(true)
    setTentativa((n) => n + 1)
  }

  /** Mostra o recado de uma ação gravada e marca o dia para onde a tela vai rolar. */
  function contar(acao: AcaoDoRecado, dia: string | null) {
    vezes.current += 1
    setRecado({ chave: vezes.current, acao, dia })
    if (dia) setDiaEmFoco({ dia, vez: vezes.current })
  }

  function aoGravarAjuste({ acao, continuar }: GravacaoDoAjuste) {
    if (!continuar) setAjuste(null)
    contar(acao, acao.nome === 'inserida' || acao.nome === 'corrigida' ? acao.dia : null)
    recarregar()
  }

  /*
   * O pedido decidido aqui: a aprovação cria uma batida e reordena o
   * dia, então a tela relê; o recado diz o que aconteceu e, na aprovação, vai
   * ao dia. Lista velha (alguém decidiu antes): só relê — a caixa de pedidos
   * mostra a frase.
   */
  function aoDecidirPedido(decidido: PedidoDecidido | null) {
    if (decidido) {
      const hora = formatarHora(decidido.pedido.horario_declarado)
      if (decidido.aprovar) contar({ nome: 'pedido_aprovado', dia: decidido.pedido.dia_civil, hora }, decidido.pedido.dia_civil)
      else contar({ nome: 'pedido_recusado', hora }, null)
    }
    recarregar()
  }

  /* As batidas que a tela já leu do dia de um pedido, para o cartão mostrar como o dia fica. */
  function batidasDoDiaDoPedido(pedido: PedidoDeAtraso) {
    if (carregando || dados.erro) return null
    if (pedido.dia_civil < periodo.inicio || pedido.dia_civil > periodo.fim) return null
    return dados.batidas.filter((batida) => batida.dia_civil === pedido.dia_civil)
  }

  function trocarPeriodo(novo: Periodo) {
    setCarregando(true)
    setDados(VAZIO)
    setParametros(parametrosDoPeriodo(novo), { replace: true })
  }

  /*
   * A FOLHA É SEMPRE DE UM MÊS FECHADO, e o painel navega por período livre —
   * "de 26 a 25", "só a semana passada". Os dois recortes não se convertem um
   * no outro, então a folha abre no mês em que o período TERMINA, que é o mês
   * que o admin está fechando em praticamente todo uso real. A tela da folha
   * mostra o mês em letras garrafais e tem as setas para corrigir, e o rótulo
   * do botão aqui embaixo já diz qual mês vai abrir — ninguém imprime agosto
   * achando que é julho.
   */
  const mesDaFolha = mesDe(periodo.fim)

  /*
   * `?imprimir=1` faz a tela da folha abrir a caixa de impressão sozinha assim
   * que os dados chegarem. A navegação vem
   * antes de propósito: imprimir a partir DAQUI mandaria para o papel o painel
   * de correção, não a folha.
   */
  function imprimirFolha() {
    navegar(`/folha/${usuarioId}?mes=${mesDaFolha}&imprimir=1`)
  }

  function exportar() {
    const csv = gerarCsvDoPeriodo([
      {
        nome: funcionario.nome,
        email: funcionario.email,
        batidas: dados.batidas,
        ausencias: ausenciasDoDia,
      },
    ], dados.aprovadores)
    baixarCsv(csv, nomeDoArquivoCsv(periodo, funcionario.nome))
  }

  async function resetarPin() {
    const confirmado = window.confirm(
      `Resetar o PIN de ${funcionario.nome}?\n\n` +
        'Na próxima entrada, o app vai pedir que ela crie um PIN novo. ' +
        'O bloqueio por tentativas erradas, se houver, também é liberado.',
    )
    if (!confirmado) return

    setResetando(true)
    setErroDoReset(null)
    setPinResetado(null)
    try {
      const resultado = await resetarPinDeUsuario(usuarioId)
      setPinResetado(
        resultado.tinha_pin
          ? `PIN resetado. Na próxima entrada, ${funcionario.nome} define um PIN novo.`
          : `Esta conta ainda não tinha PIN cadastrado. Na próxima entrada, ${funcionario.nome} define o primeiro.`,
      )
    } catch (falha) {
      setErroDoReset(falha instanceof Error ? falha.message : 'Não deu para resetar o PIN.')
    } finally {
      setResetando(false)
    }
  }

  /*
   * O dia com que as caixas abrem pelos botões do topo (`diaDoBotaoDoTopo`):
   * hoje, se hoje está no período; senão o último dia dele — e não o último
   * dia COM batida, que nunca sugeriria o sábado vazio. Pela lista, cada dia
   * abre a caixa com a própria data.
   */
  const diaDoTopo = diaDoBotaoDoTopo(periodo, hoje)

  return (
    <Pagina largura="ampla">
      <header className="flex items-center justify-between">
        <button
          onClick={() => navegar(`/painel?${new URLSearchParams(parametrosDoPeriodo(periodo))}`)}
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-mute transition-colors hover:text-plat-dim"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Todos
        </button>
        <MarcaDoTopo />
      </header>

      {/* `max-w-2xl` e `break-words`: no computador a página vai a 1024 px e o
          aviso de quem não tem acesso viraria uma linha de 1024 px, ilegível. O
          `break-words` é pelo e-mail — endereço corporativo longo não tem espaço
          onde quebrar e, em 320 px, empurraria a página para o lado. */}
      <div className="mt-8 max-w-2xl">
        <p className="font-mono text-[0.62rem] break-words uppercase tracking-[0.2em] text-faint">
          {funcionario.email ?? 'sem e-mail'}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-plat">
          {funcionario.nome}
        </h1>

        {/*
          "Pode bater" é ficha que libera OU super admin (o `bate_ponto` do
          banco do ponto). O caminho que o RH tem é a ficha, e é ele que o
          aviso diz.
        */}
        {!funcionario.podeBater && (
          <p className="mt-3 flex gap-2 rounded-xl border border-warn/35 bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
            {funcionario.contaApagada ? (
              <UserX size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            )}
            <span>
              {funcionario.contaApagada
                ? 'Esta conta não aparece mais entre as contas do ponto, e o app não deixa bater por ela. As batidas dela continuam valendo — guardam o nome de quem bateu — e entram no total e na folha.'
                : 'Esta conta não bate ponto: sem uma ficha de RH ativa ligada a ela, o app não deixa bater. A ficha se liga em Administração, na lista de pessoas.'}
            </span>
          </p>
        )}
      </div>

      {/*
        Mesma barra de comando do painel de todos, e pela mesma razão: no celular
        a ordem é "escolho o período, leio o total, ajo"; no computador o total
        vai para a direita e fica à vista enquanto se mexe nas datas. As posições
        são ditas à mão (`col-start`/`row-start`) porque as duas ordens de leitura
        são certas e o fluxo automático só sabe uma.
      */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="lg:col-start-1 lg:row-start-1">
          <SeletorDePeriodo
            periodo={periodo}
            aoTrocar={trocarPeriodo}
            mesCorrente={mesCorrente}
            desabilitado={carregando}
          />
        </div>

        <Cartao className="text-center lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
            Total do período
          </p>
          <p className="mt-2 font-mono text-4xl font-medium tracking-tight text-plat tabular-nums">
            {carregando || dados.erro ? '—' : formatarDuracao(resumo.minutos)}
          </p>
          {atualizando && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-mute">
              <RefreshCw size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              Atualizando…
            </p>
          )}
          {!carregando && !dados.erro && (
            <p className="mt-2 text-xs leading-relaxed text-mute">
              {resumo.diasComBatida}{' '}
              {resumo.diasComBatida === 1 ? 'dia com batida' : 'dias com batida'}
              {resumo.diasIncompletos > 0 && (
                <span className="text-warn">
                  {' · '}
                  {resumo.diasIncompletos}{' '}
                  {resumo.diasIncompletos === 1 ? 'incompleto' : 'incompletos'}, fora do total
                </span>
              )}
              {ausenciasDoDia.size > 0 && (
                <>
                  {' · '}
                  {ausenciasDoDia.size}{' '}
                  {ausenciasDoDia.size === 1 ? 'dia de ausência' : 'dias de ausência'}, sem horas
                </>
              )}
              {semLocalizacao && (
                <>
                  {' · '}
                  {semLocalizacao}
                </>
              )}
            </p>
          )}

          {/* As duas confirmações do reset ficam DENTRO do cartão do total, que
              é o vizinho do botão que as produz em qualquer largura. Soltas na
              página, no computador elas apareceriam a meia tela do botão. */}
          {pinResetado && (
            <div className="mt-3 text-left">
              <Aviso tom="bom">{pinResetado}</Aviso>
            </div>
          )}
          {erroDoReset && (
            <div className="mt-3 text-left">
              <Aviso tom="erro">{erroDoReset}</Aviso>
            </div>
          )}
        </Cartao>

        <div className="grid gap-2 lg:col-start-1 lg:row-start-2">
          <Botao
            onClick={() => setAjuste({ nome: 'inserir', diaSugerido: diaDoTopo })}
            disabled={carregando || Boolean(dados.erro)}
          >
            <Plus size={16} aria-hidden="true" />
            Inserir batida esquecida
          </Botao>

          <Botao
            tom="secundario"
            onClick={() => setLancandoEm(diaDoTopo)}
            disabled={carregando || Boolean(dados.erro)}
          >
            <CalendarX2 size={15} aria-hidden="true" />
            Lançar falta justificada
          </Botao>

          {/*
            A FOLHA E O CSV CONVIVEM, e não se substituem: o CSV é da
            contabilidade — uma linha por batida, abre no Excel —, e a folha é da
            assinatura — uma linha por dia, legível em preto e branco, com espaço
            para caneta. São dois leitores e dois formatos.
          */}
          <Botao
            tom="secundario"
            onClick={imprimirFolha}
            disabled={carregando || Boolean(dados.erro)}
          >
            <Printer size={15} aria-hidden="true" />
            Folha de {rotuloDoMes(mesDaFolha).toLowerCase()} para assinar
          </Botao>

          {/* "CSV" e "Resetar PIN" são os dois rótulos mais curtos da tela e
              cabem lado a lado até em 320 px — este par não precisa empilhar. */}
          <div className="grid grid-cols-2 gap-2">
            <Botao tom="secundario" onClick={exportar} disabled={carregando || Boolean(dados.erro)}>
              <Download size={15} aria-hidden="true" />
              CSV
            </Botao>
            <Botao tom="secundario" onClick={() => void resetarPin()} disabled={resetando}>
              <KeyRound size={15} aria-hidden="true" />
              {resetando ? 'Resetando…' : 'Resetar PIN'}
            </Botao>
          </div>
        </div>
      </div>

      {/*
        OS PEDIDOS DESTA PESSOA, ACIMA DOS DIAS. A moldura com a
        âncora existe sempre, mesmo sem pedido (aí a caixa some): é para onde o
        "Decidir" da folha leva, e a tela rola até ela assim que os dados chegam.
      */}
      <div id={ANCORA_DOS_PEDIDOS_DA_PESSOA} className="scroll-mt-4">
        <PendenciasDeAtraso
          usuarioId={usuarioId}
          titulo={
            carregando || dados.erro
              ? 'Pedidos de batida em atraso esperando decisão'
              : `Pedidos de batida em atraso de ${primeiroNome(funcionario.nome)} esperando decisão`
          }
          idDoTitulo="pedidos-da-pessoa"
          esconderSemPedidos
          recadoNaTela
          nomes={new Map([[usuarioId, funcionario.nome]])}
          aoLer={setPedidos}
          batidasDoDia={batidasDoDiaDoPedido}
          hoje={hoje}
          aoDecidir={aoDecidirPedido}
        />
      </div>

      <main className="mt-6 flex-1">
        {dados.erro && (
          <div className="space-y-2">
            <Aviso tom="atencao">{dados.erro}</Aviso>
            <Botao tom="secundario" onClick={recarregar} disabled={carregando}>
              <RefreshCw size={15} aria-hidden="true" />
              {carregando ? 'Carregando…' : 'Tentar de novo'}
            </Botao>
          </div>
        )}

        {!dados.erro && carregando && <p className="text-sm text-mute">Carregando…</p>}

        {!dados.erro && !carregando && periodoSemNada && (
          <Cartao className="mb-3 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ink-2 text-mute">
              <CalendarOff size={22} aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-plat">
              Nenhuma batida em {rotuloDoPeriodo(periodo)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-mute">
              {funcionario.podeBater ? 'Se era para ter batido, ' : 'Era de se esperar: sem acesso ao ponto, o app não deixa bater. Se a pessoa trabalhou, '}
              {diasDaLista.length > 0
                ? 'use “Inserir batida neste dia” no dia certo, na lista abaixo — o motivo fica gravado com o seu nome.'
                : 'use “Inserir batida esquecida” — o motivo fica gravado com o seu nome.'}
            </p>
          </Cartao>
        )}

        {!dados.erro && !carregando && !lista.todosOsDias && diasDaLista.length > 0 && (
          <p className="mb-3 text-xs leading-relaxed text-mute">
            Período com mais de {TETO_DE_DIAS_NA_LISTA} dias: aparecem só os dias com batida ou
            ausência. Para ver e lançar em todos os dias, escolha um mês.
          </p>
        )}

        {!dados.erro && !carregando && diasDaLista.length > 0 && (
          <p className="mb-3 text-xs leading-relaxed text-mute">
            Para mudar um horário, use “Corrigir” ao lado dele. Para um horário que ninguém bateu, use
            “Inserir batida neste dia” (no dia incompleto, “Inserir a batida que falta”).
          </p>
        )}

        {!dados.erro && !carregando && diasDaLista.length > 0 && (
          /*
            UMA COLUNA, DE CIMA PARA BAIXO, EM QUALQUER LARGURA. Com todos os
            dias do período, duas colunas leriam "1 | 2, 3 | 4" e poriam a linha
            compacta do sábado vazio ao lado de um cartão de quatro batidas. Um mês é uma lista, e
            o dia vazio compacto (`DiaSemBatida`) é o que a deixa curta.
          */
          <ul className="grid grid-cols-1 gap-2">
            {diasDaLista.map(({ dia: diaCivil, batidas: dia, ausencias, fimDeSemana, feriado, futuro }) => {
              const inserirNesteDia = (diaDoBotao: string) =>
                setAjuste({ nome: 'inserir', diaSugerido: diaDoBotao })
              if (dia) {
                return (
                  <DiaDoPainel
                    key={diaCivil}
                    dia={dia}
                    fimDeSemana={fimDeSemana}
                    feriado={feriado}
                    podeInserir={!futuro}
                    ehHoje={diaCivil === hoje}
                    destacado={diaEmFoco?.dia === diaCivil || destaqueDaAncora === diaCivil}
                    pedidos={pedidosPorDia.get(diaCivil)}
                    aoVerPedido={verPedido}
                    aoAbrirSelfie={setSelfieAberta}
                    aprovadores={dados.aprovadores}
                    ausencias={ausencias}
                    aoAbrirAtestado={setAtestadoAberto}
                    aoCorrigir={(batida) => setAjuste({ nome: 'corrigir', batida })}
                    aoInserirNesteDia={inserirNesteDia}
                  />
                )
              }
              if (ausencias.length > 0) {
                return (
                  <DiaDeAusencia
                    key={diaCivil}
                    dia={diaCivil}
                    fimDeSemana={fimDeSemana}
                    feriado={feriado}
                    ausencias={ausencias}
                    aoAbrirAtestado={setAtestadoAberto}
                  >
                    {pedidosPorDia.has(diaCivil) && (
                      <PedidosEsperandoNoDia
                        pedidos={pedidosPorDia.get(diaCivil) ?? []}
                        aoVer={verPedido}
                        className=""
                      />
                    )}
                    {!futuro && (
                      <BotaoDoDia aoClicar={() => inserirNesteDia(diaCivil)}>
                        <PencilLine size={13} aria-hidden="true" />
                        Inserir batida neste dia
                      </BotaoDoDia>
                    )}
                  </DiaDeAusencia>
                )
              }
              return (
                <DiaSemBatida
                  key={diaCivil}
                  dia={diaCivil}
                  fimDeSemana={fimDeSemana}
                  feriado={feriado}
                  aoInserirNesteDia={inserirNesteDia}
                  aoLancarFaltaNesteDia={setLancandoEm}
                  pedidos={pedidosPorDia.get(diaCivil)}
                  aoVerPedido={verPedido}
                />
              )
            })}
          </ul>
        )}

        {/* A lista inteira das ausências, canceladas inclusive: é aqui que se
            vê quem lançou, quem cancelou e por quê, e que se cancela. */}
        {!dados.erro && !carregando && (
          <AusenciasDoPeriodo
            titulo={`Ausências em ${rotuloDoPeriodo(periodo)}`}
            ausencias={dados.ausencias}
            nomeDe={(id) => nomesDosAutores.get(id) ?? null}
            aoAbrirAtestado={setAtestadoAberto}
            aoCancelar={setCancelando}
          />
        )}
      </main>

      <footer className="mt-10 text-center">
        <p className="mx-auto max-w-2xl text-xs leading-relaxed text-faint">
          Toda correção e toda inserção exigem motivo, e guardam quem fez, quando e o valor
          anterior. O funcionário passa a ver a marca de ajuste no próprio espelho.
        </p>
      </footer>

      {selfieAberta && (
        <VisorDeSelfie batida={selfieAberta} aoFechar={() => setSelfieAberta(null)} />
      )}

      {atestadoAberto?.atestado_path && (
        <VisorDeAtestado
          caminho={atestadoAberto.atestado_path}
          descricao={`${ROTULO_DO_TIPO_DE_AUSENCIA[atestadoAberto.tipo]} · ${descreverPeriodo(atestadoAberto)}`}
          aoFechar={() => setAtestadoAberto(null)}
        />
      )}

      {lancandoEm && (
        <LancamentoDeAusencia
          usuarioId={usuarioId}
          nomeDoFuncionario={funcionario.nome}
          diaSugerido={lancandoEm}
          aoFechar={() => setLancandoEm(null)}
          aoLancada={() => {
            setLancandoEm(null)
            contar({ nome: 'ausencia_lancada' }, null)
            recarregar()
          }}
        />
      )}

      {cancelando && (
        <CaixaDeCancelamento
          ausencia={cancelando}
          nomeDaPessoa={funcionario.nome}
          aoFechar={() => setCancelando(null)}
          aoCancelada={() => {
            setCancelando(null)
            contar({ nome: 'ausencia_cancelada' }, null)
            recarregar()
          }}
        />
      )}

      {ajuste && (
        <AjusteDeBatida
          modo={ajuste}
          usuarioId={usuarioId}
          nomeDoFuncionario={funcionario.nome}
          correcoes={
            ajuste.nome === 'corrigir' ? (correcoesPorBatida.get(ajuste.batida.id) ?? []) : []
          }
          /*
           * Só para correção de admin: a trilha de natureza 'sistema' sai como
           * "Sistema" dentro da caixa (`rotuloDoAutor`, src/lib/trilha.ts).
           */
          nomeDoAutor={(autorId) => nomeDoAdmin(autorId, nomesDosAutores)}
          batidasDaTela={{ periodo: { inicio: periodo.inicio, fim: periodo.fim }, batidas: dados.batidas }}
          pedidosPendentes={pedidos ?? []}
          aoFechar={() => setAjuste(null)}
          aoGravar={aoGravarAjuste}
        />
      )}

      <Recado
        chave={recado?.chave ?? 0}
        texto={textoDoRecado}
        aoFechar={() => setRecado(null)}
        acao={diaDoRecado ? { rotulo: 'Ver o dia', aoClicar: () => verODia(diaDoRecado) } : null}
      />
    </Pagina>
  )
}
