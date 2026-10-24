import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarX2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  EyeOff,
  IdCard,
  ListChecks,
  LocateOff,
  MapPinOff,
  PencilLine,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'
import { MarcaDoTopo } from '../components/Marca'
import { useAuth } from '../hooks/useAuth'
import { podeBater } from '../lib/acesso'
import { PendenciasDeAtraso } from '../components/PendenciasDeAtraso'
import { SeletorDePeriodo } from '../components/SeletorDePeriodo'
import { Aviso, Botao, Painel as Cartao, Etiqueta, Pagina } from '../components/ui'
import { lerBatidasDoPeriodo, lerGenteDoPainel } from '../lib/admin'
import { lerConfiguracao } from '../lib/administracao'
import type { PedidoDeAtraso } from '../lib/atraso'
import type { DadosDaEmpresa } from '../lib/configuracao'
import { gerarCsvDoPeriodo, nomeDoArquivoCsv } from '../lib/csv'
import { lerAprovadoresDoPeriodo, lerContasComPedidoNoPeriodo } from '../lib/pedidos'
import { ausenciasPorPessoa, type Ausencia } from '../lib/ausencias'
import { descreverForaDaPessoa, descreverSemLocalizacaoDaPessoa } from '../lib/coordenada'
import { lerAusenciasDoPeriodo } from '../lib/faltas'
import { baixarCsv } from '../lib/download'
import { diaCivilDeHoje, type BatidaDoAdmin } from '../lib/formato'
import { formatarDuracao, mesDe } from '../lib/horas'
import {
  contasComFichaNoPeriodo,
  GENTE_VAZIA,
  montarLinhasDoPainel,
  pendenciasDoFechamento,
  totalizarPainel,
  type FechamentoDoPeriodo,
  type GenteDoPainel,
  type ItemDoFechamento,
  type LinhaDoPainel,
} from '../lib/painel'
import {
  lerPeriodo,
  parametrosDoPeriodo,
  periodoPadrao,
  rotuloDoPeriodo,
  type Periodo,
} from '../lib/periodo'

/*
 * O PAINEL DO ADMIN — a lista de todo mundo no período escolhido.
 *
 * O PERÍODO MORA NA URL
 * `/painel?de=2026-08-01&ate=2026-08-31`. Assim o recorte sobrevive ao F5, o
 * link é colável e a tela da pessoa herda o mesmo período sem inventar outro. A
 * contrapartida é que a URL passa a ser entrada de usuário — `?de=2026-13-40` é
 * digitável —, e por isso ela passa inteira por `lerPeriodo`, que nunca levanta
 * e cai no mês corrente quando não entende. A armadilha é conhecida:
 * `montarEspelho` explode com mês malformado e é chamado dentro do render. Este
 * painel não chama `montarEspelho` — usa `agruparPorDia` e `resumirDias`, que
 * não têm recorte mensal nenhum — e ainda valida a URL antes de qualquer coisa.
 *
 * SÓ QUEM É DO PONTO, E DESSES NINGUÉM SOME
 * A lista é de quem tem ficha de RH ligada à conta ou tem batida, ausência ou
 * pedido de batida em atraso no período (`montarLinhasDoPainel`) — e não de
 * toda conta de login, que poria quem bate ponto no meio de cartões zerados de
 * quem não bate. Dos que são do ponto, quem não
 * bateu, quem não pode bater e a batida de conta já desligada aparecem os três,
 * cada um com sua marca: quem fecha o mês precisa ver o zero de alguém tanto
 * quanto as horas de outro — e a diferença entre "não bateu" e "não consegue
 * bater".
 *
 * NENHUMA REGRA DE ACESSO É DECIDIDA AQUI
 * A guarda de rota só evita desenhar um painel vazio para quem não é admin.
 * Quem recusa cada consulta é a RLS, no Postgres.
 *
 * ⚠ A LISTA É DE CARTÕES, E NÃO DE TABELA — EM QUALQUER LARGURA
 * A tentação, no computador, é virar tabela: nome, e-mail, horas, dias, marcas.
 * Não vira, e a razão é o celular. Cinco colunas em 320 px dão 56 px cada, o que
 * transforma "Ana Beatriz Gonçalves da Silva" em "Ana Bea…", "sem acesso ao
 * ponto" em um ícone sem legenda e "180h00" em duas linhas. O cartão já
 * responde as mesmas cinco perguntas com o nome inteiro e as marcas escritas por
 * extenso, e ele cresce para duas colunas no computador em vez de virar outra
 * coisa. Uma tela só, um componente só, nada para manter em dobro.
 *
 * A única tabela de verdade do app é a FOLHA IMPRESSA — lá o papel é A4 fixo, e
 * ela rola dentro do próprio contêiner quando a tela é menor que a folha.
 *
 * FECHAR O MÊS SEM SURPRESA
 * A ordem da tela é a ordem do fechamento: logo abaixo do título, os pedidos
 * de batida em atraso (eles ainda vão mudar o total); depois o período e o
 * total; depois o bloco "Antes de fechar {mês}", que junta numa lista só o que
 * falta resolver — pedidos, dias com batida faltando (com o link direto para o
 * dia) e o cabeçalho da folha incompleto (`pendenciasDoFechamento`). A
 * contagem dos pedidos sai da própria caixa (`aoLer`), sem uma segunda leitura.
 */

interface Dados {
  /**
   * As contas do ponto (com o nome da regra única e o "pode bater": ficha que
   * libera OU super admin) e o que das fichas decide quem é do ponto
   * (`juntarGenteEFichas`).
   */
  gente: GenteDoPainel
  batidas: BatidaDoAdmin[]
  /**
   * As ausências que tocam o período. Parte da carga, e não de melhor
   * esforço: o CSV sai daqui, e um CSV sem as faltas não avisa ninguém.
   */
  ausencias: Ausencia[]
  /** As contas com pedido de batida em atraso no período, em qualquer estado. Parte da carga. */
  contasComPedido: Set<string>
  /** Quem aprovou cada batida em atraso. De melhor esforço: vazio não é erro. */
  aprovadores: Map<string, string | null>
  /**
   * Os dados da empresa, para o bloco "Antes de fechar" dizer se o cabeçalho
   * da folha está completo. De melhor esforço: `undefined` quando a
   * leitura falhou, e aí o bloco não fala do cabeçalho — o painel não morre
   * por causa dele.
   */
  empresa: DadosDaEmpresa | null | undefined
  erro: string | null
}

const VAZIO: Dados = {
  gente: GENTE_VAZIA,
  batidas: [],
  ausencias: [],
  contasComPedido: new Set(),
  aprovadores: new Map(),
  empresa: undefined,
  erro: null,
}

/**
 * A leitura mora fora do componente e devolve o erro como VALOR — mesmo
 * desenho de `Bater.tsx` e `Espelho.tsx`. Assim o efeito que a dispara não
 * precisa de try/catch nem de um `setState` no próprio corpo.
 */
async function buscar(periodo: Periodo): Promise<Dados> {
  try {
    const [gente, batidas, ausencias, contasComPedido, empresa] = await Promise.all([
      lerGenteDoPainel(),
      lerBatidasDoPeriodo(periodo),
      lerAusenciasDoPeriodo(periodo),
      lerContasComPedidoNoPeriodo(periodo),
      lerConfiguracao().catch(() => undefined),
    ])
    const nomes = new Map(gente.funcionarios.map((pessoa) => [pessoa.usuarioId, pessoa.nome]))
    const aprovadores = await lerAprovadoresDoPeriodo(periodo, nomes)
    return { gente, batidas, ausencias, contasComPedido, aprovadores, empresa, erro: null }
  } catch (falha) {
    return {
      ...VAZIO,
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar o painel.',
    }
  }
}

export function Painel() {
  const navegar = useNavigate()
  /*
   * A volta do painel é a tela inicial. Para quem bate, ela é a tela de bater;
   * para quem só administra, ela não tem botão
   * de bater — o rótulo "Bater ponto" prometeria o que a tela não oferece.
   */
  const { acesso } = useAuth()
  const rotuloDaVolta = podeBater(acesso) ? 'Bater ponto' : 'Início'
  const [parametros, setParametros] = useSearchParams()

  /*
   * O mês corrente sai do dia civil do PONTO e é fixado na montagem: um
   * painel aberto às 22h de outro fuso não pode achar que já é o mês seguinte,
   * e uma tela aberta na passagem da meia-noite não precisa trocar de mês
   * sozinha debaixo do dedo.
   */
  const padrao = useMemo(() => periodoPadrao(), [])
  const hoje = useMemo(() => diaCivilDeHoje(), [])
  const mesCorrente = useMemo(() => mesDe(hoje), [hoje])
  const periodo = lerPeriodo(parametros.get('de'), parametros.get('ate'), padrao)

  const [dados, setDados] = useState<Dados>(VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [tentativa, setTentativa] = useState(0)
  const [esconderZerados, setEsconderZerados] = useState(false)
  /** Os pedidos pendentes, como a caixa de pendências os leu (`null`: ainda lendo, ou a leitura falhou). */
  const [pedidos, setPedidos] = useState<PedidoDeAtraso[] | null>(null)

  useEffect(() => {
    let vivo = true
    void buscar({ inicio: periodo.inicio, fim: periodo.fim }).then((resultado) => {
      if (!vivo) return
      setDados(resultado)
      setCarregando(false)
    })
    return () => {
      vivo = false
    }
  }, [periodo.inicio, periodo.fim, tentativa])

  /*
   * SÓ QUEM É DO PONTO NO PERÍODO: ficha ligada que vale no período, batida,
   * ausência ou pedido (`montarLinhasDoPainel`). O "pode bater" de quem
   * aparece fora da lista de contas sai de `batemPonto`.
   */
  const linhas = useMemo(
    () =>
      montarLinhasDoPainel(
        dados.gente.funcionarios,
        dados.batidas,
        ausenciasPorPessoa(dados.ausencias, { inicio: periodo.inicio, fim: periodo.fim }),
        {
          nomesDeFicha: dados.gente.nomesDeFicha,
          batemPonto: dados.gente.batemPonto,
          comFichaNoPeriodo: contasComFichaNoPeriodo(dados.gente.fichas, { inicio: periodo.inicio }),
          comPedidoNoPeriodo: dados.contasComPedido,
        },
      ),
    [dados.gente, dados.batidas, dados.ausencias, dados.contasComPedido, periodo.inicio, periodo.fim],
  )
  /*
   * Os nomes já resolvidos, para a caixa de pendências de atraso: o pedido
   * guarda o nome congelado no momento do pedido, que nos pedidos antigos das
   * contas de função é o de outra pessoa. A caixa usa estes e só cai no
   * congelado se a pessoa não estiver aqui. Vão TODAS as contas, e não só quem está na lista:
   * o pedido pendente de um dia de outro período continua na caixa, e a
   * pessoa dele pode não ser do ponto NESTE período.
   */
  const nomesDoPainel = useMemo(
    () =>
      new Map([
        ...dados.gente.nomesDeFicha,
        ...dados.gente.funcionarios.map((pessoa): [string, string] => [pessoa.usuarioId, pessoa.nome]),
        ...linhas.map((linha): [string, string] => [linha.funcionario.usuarioId, linha.funcionario.nome]),
      ]),
    [dados.gente, linhas],
  )
  const total = useMemo(() => totalizarPainel(linhas), [linhas])
  const fechamento = useMemo(
    () =>
      pendenciasDoFechamento({
        periodo: { inicio: periodo.inicio, fim: periodo.fim },
        linhas,
        pedidos,
        empresa: dados.empresa,
        hoje,
      }),
    [periodo.inicio, periodo.fim, linhas, pedidos, dados.empresa, hoje],
  )

  /*
   * As batidas que o painel já leu, para o cartão de cada pedido mostrar como o
   * dia fica com a aprovação. Pedido de um dia fora do período (o de ontem,
   * visto no dia 1º) fica sem a prévia: o painel não leu aquele dia.
   */
  function batidasDoDiaDoPedido(pedido: PedidoDeAtraso) {
    if (carregando || dados.erro) return null
    if (pedido.dia_civil < periodo.inicio || pedido.dia_civil > periodo.fim) return null
    return dados.batidas.filter(
      (batida) => batida.usuario_id === pedido.usuario_id && batida.dia_civil === pedido.dia_civil,
    )
  }
  const visiveis = esconderZerados
    ? linhas.filter((linha) => linha.resumo.diasComBatida > 0)
    : linhas

  function trocarPeriodo(novo: Periodo) {
    setCarregando(true)
    setDados(VAZIO)
    setParametros(parametrosDoPeriodo(novo), { replace: true })
  }

  function exportar() {
    const csv = gerarCsvDoPeriodo(
      linhas.map((linha) => ({
        nome: linha.funcionario.nome,
        email: linha.funcionario.email,
        batidas: linha.dias.flatMap((dia) => dia.batidas),
        ausencias: linha.ausencias,
      })),
      dados.aprovadores,
    )
    baixarCsv(csv, nomeDoArquivoCsv(periodo))
  }

  return (
    <Pagina largura="ampla">
      <header className="flex items-center justify-between">
        <button
          onClick={() => navegar('/')}
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-mute transition-colors hover:text-plat-dim"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          {rotuloDaVolta}
        </button>
        <MarcaDoTopo />
      </header>

      <div className="mt-8">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
          Painel do administrador
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-plat">
          Fechamento do período
        </h1>
      </div>

      {/*
        AS PENDÊNCIAS DE ATRASO VÊM LOGO ABAIXO DO TÍTULO, acima do período.
        Pedido pendente não
        conta hora: o total abaixo ainda vai mudar quando ele for decidido, e
        quem fecha o mês precisa saber disso antes de conferir número nenhum.
        Cada decisão gravada relê o painel — a aprovação cria batida.
      */}
      <PendenciasDeAtraso
        nomes={nomesDoPainel}
        aoLer={setPedidos}
        batidasDoDia={batidasDoDiaDoPedido}
        hoje={hoje}
        aoDecidir={() => {
          setCarregando(true)
          setTentativa((n) => n + 1)
        }}
      />

      {/*
        A BARRA DE COMANDO DO PERÍODO: escolher o recorte, ver o total dele e
        agir sobre ele. No celular é uma pilha, na ordem em que se pensa —
        escolho, leio, ajo. No computador o total vai para o lado, porque ele é o
        número que se confere ENQUANTO se mexe nas datas: com tudo empilhado, o
        total ficaria fora da tela justamente na hora de trocar o mês.
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

        {/*
          A COLUNA E A LINHA SÃO DITAS À MÃO, e não deixadas para o fluxo
          automático, porque a ORDEM DE LEITURA muda com a largura e as duas
          ordens são certas.

          No celular: escolho o período, LEIO O TOTAL, aí decido o que fazer. O
          total é o número pelo qual se abre esta tela, e ele tem de vir antes
          dos botões — que é a ordem do documento, então o celular não precisa de
          regra nenhuma.

          No computador: o total vai para a direita e FICA à vista enquanto se
          mexe nas datas do lado esquerdo. Empilhado numa tela de 1280 px ele
          sairia do campo de visão justamente na hora de trocar o mês, que é
          quando ele muda.
        */}
        <Cartao className="text-center lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
            Total do período
          </p>
          <p className="mt-2 font-mono text-4xl font-medium tracking-tight text-plat tabular-nums">
            {carregando || dados.erro ? '—' : formatarDuracao(total.minutos)}
          </p>
          {!carregando && !dados.erro && (
            <p className="mt-2 text-xs leading-relaxed text-mute">
              {total.pessoas} {total.pessoas === 1 ? 'pessoa bateu' : 'pessoas bateram'} ponto ·{' '}
              {total.diasComBatida} {total.diasComBatida === 1 ? 'dia' : 'dias'}
              {total.diasIncompletos > 0 && (
                <span className="text-warn">
                  {' · '}
                  {total.diasIncompletos}{' '}
                  {total.diasIncompletos === 1 ? 'incompleto' : 'incompletos'}, fora do total
                </span>
              )}
            </p>
          )}
        </Cartao>

        {/*
          Os dois botões viram um par a partir de 640 px, voltam a empilhar
          quando a coluna encolhe para metade da página em `lg`, e viram par de
          novo em `xl`, onde meia página já dá 300 px por botão. É a mesma
          largura útil sendo perguntada três vezes — o `sm:` sozinho não bastaria
          porque a coluna esquerda MUDA de largura em `lg` sem a janela encolher.

          A porta da área de administração fica aqui. Ela é a página inicial
          de quem administra —
          pendências, pessoas, ausências, local, empresa e jornada —, e por isso
          também aparece na tela de bater, para quem administra. A guarda da
          rota é a mesma deste painel, então quem chegou até aqui passa.
        */}
        <div className="grid gap-2 sm:grid-cols-2 lg:col-start-1 lg:row-start-2 lg:grid-cols-1 xl:grid-cols-2">
          <Botao tom="secundario" onClick={() => navegar('/administracao')}>
            <SlidersHorizontal size={16} aria-hidden="true" />
            Administração
          </Botao>

          <Botao tom="secundario" onClick={exportar} disabled={carregando || Boolean(dados.erro)}>
            <Download size={16} aria-hidden="true" />
            Exportar CSV de {rotuloDoPeriodo(periodo)}
          </Botao>
        </div>

        {/*
          A COLUNA DECIMAL É A QUE SOMA. Somar "Horas do dia", que vem como
          "9:00", não dá certo: o Excel soma isso como hora do relógio e vira o
          dia depois de 24h, a menos que a célula tenha o formato [h]:mm —
          ninguém do RH sabe disso, e o total sairia errado.
        */}
        <p className="text-xs leading-relaxed text-faint lg:col-start-1 lg:row-start-3">
          Uma linha por batida e uma por dia de ausência. Para somar as horas no Excel, use a coluna
          “Horas do dia (decimal)” — ela dá o total direto.
        </p>
      </div>

      {!carregando && !dados.erro && <AntesDeFechar fechamento={fechamento} />}

      <main className="mt-6 flex-1">
        {dados.erro && (
          <div className="space-y-2">
            <Aviso tom="atencao">{dados.erro}</Aviso>
            <Botao
              tom="secundario"
              onClick={() => {
                setCarregando(true)
                setTentativa((n) => n + 1)
              }}
              disabled={carregando}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {carregando ? 'Carregando…' : 'Tentar de novo'}
            </Botao>
          </div>
        )}

        {!dados.erro && carregando && <p className="text-sm text-mute">Carregando…</p>}

        {!dados.erro && !carregando && (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
                {visiveis.length} {visiveis.length === 1 ? 'pessoa' : 'pessoas'}
              </h2>
              <button
                onClick={() => setEsconderZerados((antes) => !antes)}
                className="inline-flex min-h-11 items-center gap-1.5 text-xs text-mute transition-colors hover:text-plat-dim"
              >
                <EyeOff size={13} aria-hidden="true" />
                {esconderZerados ? 'Mostrar quem não bateu' : 'Esconder quem não bateu'}
              </button>
            </div>

            {visiveis.length === 0 ? (
              <Cartao className="text-center">
                {/* Os dois vazios são diferentes, e confundi-los faria o painel
                    mentir. Sem ninguém do ponto, o que falta é ficha ligada a
                    uma conta (ou o período não tem nada); com gente escondida
                    pelo botão, o que não houve foi batida. Os dois apontam
                    para o que se resolve dentro do próprio ponto. */}
                <p className="text-sm leading-relaxed text-mute">
                  {linhas.length === 0
                    ? `Ninguém do ponto em ${rotuloDoPeriodo(periodo)}. Esta lista mostra quem tem ficha de RH ligada a uma conta e quem bateu, teve ausência lançada ou pediu batida no período — as fichas se ligam em Administração, na lista de pessoas.`
                    : `Ninguém bateu ponto em ${rotuloDoPeriodo(periodo)}. Isso é resposta, não erro — use as setas acima para ver outro período.`}
                </p>
              </Cartao>
            ) : (
              /* Duas colunas de cartões no computador — ver o cabeçalho desta
                 tela: cartão em toda largura, e não tabela. */
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {visiveis.map((linha) => (
                  <LinhaDeFuncionario key={linha.funcionario.usuarioId} linha={linha} periodo={periodo} />
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      <footer className="mt-10 text-center">
        <p className="mx-auto max-w-2xl text-[0.68rem] leading-relaxed text-faint">
          As horas saem das batidas com o horário do servidor, pela mesma conta que o funcionário
          vê no próprio espelho. Dia com número ímpar de batidas conta zero até ser corrigido.
        </p>
      </footer>
    </Pagina>
  )
}

/** O cartão de uma pessoa. Exportado para o teste das telas. */
export function LinhaDeFuncionario({ linha, periodo }: { linha: LinhaDoPainel; periodo: Periodo }) {
  const { funcionario, resumo, ajustes, atrasos } = linha
  const diasDeAusencia = linha.ausencias.size
  const fora = descreverForaDaPessoa(linha.localizacao)
  const semLocalizacao = descreverSemLocalizacaoDaPessoa(linha.localizacao)
  const parametros = new URLSearchParams(parametrosDoPeriodo(periodo)).toString()

  return (
    <li>
      <Link
        to={`/painel/${funcionario.usuarioId}?${parametros}`}
        /*
         * `h-full`: em duas colunas, a pessoa com três etiquetas faz a linha do
         * grid ficar mais alta, e sem isto o cartão ao lado ficaria flutuando
         * com um vão embaixo. `gap-2 sm:gap-3` e `px-3 sm:px-4` devolvem, em
         * 320 px, os pixels que faltavam ao nome.
         */
        className="flex h-full min-h-11 items-center gap-2 rounded-2xl border border-hair bg-ink-1 px-3 py-3 transition-colors hover:border-hair-2 hover:bg-ink-2 sm:gap-3 sm:px-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-plat">{funcionario.nome}</p>
          <p className="mt-0.5 truncate text-[0.7rem] text-faint">
            {funcionario.email ?? 'sem e-mail'}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {/*
              "Pode bater" é ficha que libera OU super admin (o `bate_ponto` do
              banco do ponto). Quem bate pela ficha não aparece como bloqueado.
            */}
            {!funcionario.podeBater && (
              <Etiqueta tom="aviso">
                <AlertTriangle size={10} aria-hidden="true" />
                sem acesso ao ponto
              </Etiqueta>
            )}
            {/*
              O que importa ao RH é a FICHA — é dela que vem o nome completo
              que a folha imprime. Só para quem BATEU no período e não tem
              ficha: é a folha dessa pessoa que sai com o nome da conta, e não
              o da carteira de trabalho.
            */}
            {!funcionario.temFicha && resumo.diasComBatida > 0 && (
              <Etiqueta tom="aviso">
                <IdCard size={10} aria-hidden="true" />
                sem ficha de RH
              </Etiqueta>
            )}
            {resumo.diasIncompletos > 0 && (
              <Etiqueta tom="aviso">
                <AlertTriangle size={10} aria-hidden="true" />
                {resumo.diasIncompletos}{' '}
                {resumo.diasIncompletos === 1 ? 'dia incompleto' : 'dias incompletos'}
              </Etiqueta>
            )}
            {ajustes > 0 && (
              <Etiqueta tom="neutro">
                <PencilLine size={10} aria-hidden="true" />
                {ajustes} {ajustes === 1 ? 'ajuste' : 'ajustes'}
              </Etiqueta>
            )}
            {atrasos > 0 && (
              <Etiqueta tom="neutro">
                <Clock size={10} aria-hidden="true" />
                {atrasos} em atraso, {atrasos === 1 ? 'aprovada' : 'aprovadas'}
              </Etiqueta>
            )}
            {diasDeAusencia > 0 && (
              <Etiqueta tom="neutro">
                <CalendarX2 size={10} aria-hidden="true" />
                {diasDeAusencia} {diasDeAusencia === 1 ? 'dia de ausência' : 'dias de ausência'}
              </Etiqueta>
            )}
            {/* O indicador de "fora" por pessoa, com a régua da tela do
                local. Em tom de aviso só acima do limite de alerta — "fora" de
                vez em quando é visita a cliente, e não defeito. */}
            {fora && (
              <Etiqueta tom={fora.alerta ? 'aviso' : 'neutro'}>
                <MapPinOff size={10} aria-hidden="true" />
                {fora.texto}
              </Etiqueta>
            )}
            {/* Quantas saíram sem localização porque o
                GPS não respondeu. Neutra, porque é permitido; fica fora da
                porcentagem de "fora" acima. */}
            {semLocalizacao && (
              <Etiqueta tom="neutro">
                <LocateOff size={10} aria-hidden="true" />
                {semLocalizacao}
              </Etiqueta>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-lg text-plat tabular-nums">
            {formatarDuracao(resumo.minutos)}
          </p>
          <p className="mt-0.5 font-mono text-[0.62rem] text-faint tabular-nums">
            {resumo.diasComBatida} {resumo.diasComBatida === 1 ? 'dia' : 'dias'}
          </p>
        </div>

        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-mute" />
      </Link>
    </li>
  )
}

/**
 * O BLOCO "ANTES DE FECHAR {MÊS}": o que falta
 * resolver no período, numa lista só, cada item com o link que resolve. O texto
 * de cada item e o destino do link saem de `pendenciasDoFechamento` — aqui só o
 * desenho. Exportado para o teste das telas.
 */
export function AntesDeFechar({ fechamento }: { fechamento: FechamentoDoPeriodo }) {
  return (
    <section aria-labelledby="antes-de-fechar" className="mt-6">
      <h2
        id="antes-de-fechar"
        className="flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint"
      >
        <ListChecks size={13} aria-hidden="true" />
        {fechamento.titulo}
      </h2>

      {fechamento.itens.length > 0 && (
        <ul className="mt-2 divide-y divide-hair rounded-2xl border border-hair bg-ink-1">
          {fechamento.itens.map((item) => (
            <li key={item.chave} className="flex items-center gap-3 py-0.5 pr-1.5 pl-4">
              <AlertTriangle size={14} aria-hidden="true" className="shrink-0 text-warn" />
              <p className="min-w-0 flex-1 py-2 text-sm leading-snug break-words text-plat-dim">{item.texto}</p>
              <LinkDoFechamento item={item} />
            </li>
          ))}
        </ul>
      )}

      {fechamento.semPendencias && (
        <p className="mt-2 flex gap-2 text-xs leading-relaxed text-mute">
          <CheckCircle2 size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-luz" />
          <span>{fechamento.semPendencias}</span>
        </p>
      )}
      {fechamento.notaDeHoje && (
        <p className="mt-1.5 text-xs leading-relaxed text-faint">{fechamento.notaDeHoje}</p>
      )}
    </section>
  )
}

/**
 * O link de um item. A âncora desta página ("Decidir" → a caixa de pendências,
 * no topo) é um `<a href="#…">` de verdade: o navegador rola sozinho e o
 * período da URL fica. O resto é rota (`Link`), com a âncora do dia — a tela da
 * pessoa rola até ele quando os dados chegam.
 */
function LinkDoFechamento({ item }: { item: ItemDoFechamento }) {
  const classe =
    'inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-2 text-sm font-semibold text-luz ' +
    'underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60'
  const conteudo = (
    <>
      {item.acao}
      <ChevronRight size={14} aria-hidden="true" />
    </>
  )
  const rotulo = `${item.acao}: ${item.texto}`
  return item.destino.startsWith('#') ? (
    <a href={item.destino} aria-label={rotulo} className={classe}>
      {conteudo}
    </a>
  ) : (
    <Link to={item.destino} aria-label={rotulo} className={classe}>
      {conteudo}
    </Link>
  )
}
