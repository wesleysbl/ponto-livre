import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CalendarOff, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { DiaDoEspelho } from '../components/DiaDoEspelho'
import { AusenciasDoPeriodo } from '../components/AusenciasDoPeriodo'
import { DiaDeAusencia } from '../components/DiaDeAusencia'
import { DiaSemBatida } from '../components/DiaDoPainel'
import { ComposicaoDoTotal, ResumoDoSaldoNaTela } from '../components/SaldoDoDia'
import { VisorDeAtestado } from '../components/VisorDeAtestado'
import { MeusPedidosDeAtraso } from '../components/MeusPedidosDeAtraso'
import { VisorDeSelfie } from '../components/VisorDeSelfie'
import { MarcaDoTopo } from '../components/Marca'
import { Aviso, Botao, Painel } from '../components/ui'
import { diaCivilDeHoje, lerBatidasDoMes, type Batida } from '../lib/batidas'
import {
  dataBrasileira,
  formatarDuracao,
  mesAnterior,
  mesDe,
  mesSeguinte,
  montarEspelho,
  primeiroDiaDoMes,
  rotuloDoMes,
  ultimoDiaDoMes,
  type EspelhoDoMes,
} from '../lib/horas'
import { aprovadoresDosPedidos, type PedidoDeAtraso } from '../lib/atraso'
import { lerMeusPedidos, lerNomesDeQuemDecidiu } from '../lib/pedidos'
import {
  ausenciasPorDia,
  descreverPeriodo,
  ehAtiva,
  juntarDiasEAusencias,
  ROTULO_DO_TIPO_DE_AUSENCIA,
  type Ausencia,
} from '../lib/ausencias'
import { lerAusenciasDoPeriodo } from '../lib/faltas'
import { lerConfiguracao, lerFichas } from '../lib/administracao'
import type { ConfiguracaoDoPonto } from '../lib/configuracao'
import { mesmaConta, type FichaDoFuncionario } from '../lib/cadastro'
import {
  abonadoNoTotal,
  calcularSaldoDoMes,
  cobrancaNoRecorte,
  juntarDiasDeFalta,
  regrasDoSaldo,
  type SaldoDoDia,
} from '../lib/saldo'

/*
 * MEU ESPELHO DE PONTO — o mês inteiro, conferido pelo próprio funcionário.
 *
 * A PERGUNTA DESTA TELA É OUTRA
 * A tela de bater responde "eu já bati hoje?". Esta responde "meu mês fecha?",
 * e a diferença muda tudo: aqui o que importa é o total, o dia que ficou torto e
 * a prova de que a batida é sua. Por isso o total do mês fica no topo, antes de
 * qualquer lista — é o número que a pessoa veio buscar.
 *
 * A CONTA NÃO MORA AQUI
 * Tudo o que é soma de horas vem de `lib/horas.ts`. Este arquivo lê linhas,
 * escolhe o mês e desenha. O painel do admin e o CSV usam o MESMO
 * `montarEspelho` — e é isso que garante que o espelho do
 * funcionário e o relatório do patrão nunca discordem sobre quantas horas ele
 * trabalhou.
 *
 * OS PEDIDOS DE BATIDA EM ATRASO FICAM SEPARADOS DAS BATIDAS
 * Embaixo dos dias, numa lista própria: pendente, aprovado ou recusado com o
 * motivo. O pendente não entra no total — ele não é batida. O aprovado já é uma
 * batida, e aparece no dia dele com a marca "em atraso, aprovada por…".
 * A leitura dos pedidos é à parte: se ela falhar, o mês continua de pé e só a
 * lista de pedidos mostra o erro.
 *
 * AS AUSÊNCIAS MARCAM O DIA, E O QUE ELAS ABONAM SOMA NO TOTAL
 * A falta justificada que o admin lançou aparece no dia dela (com batida ou
 * sem) e numa lista embaixo, com o atestado. O total do mês é o trabalhado de
 * `montarEspelho` mais o abonado dos dias que entram no total
 * (`abonadoNoTotal`, de `saldo.ts`), com a conta escrita embaixo: a mesma do
 * painel da pessoa, para quem bate e quem administra lerem o mesmo total. A
 * leitura das ausências é à parte, como a dos pedidos: se ela falhar, o mês
 * continua de pé e o aviso diz que as ausências não vieram. A cancelada não
 * aparece aqui: ela não vale mais.
 *
 * O SALDO É OUTRA CONTA, POR CIMA DO TOTAL
 * `calcularSaldoDoMes` (`saldo.ts`, a mesma do painel da pessoa) compara o
 * trabalhado com a jornada e abona o período do atestado. Cada dia ganha a
 * linha de previsto, abonado e saldo, e o cartão do total ganha o saldo do
 * mês. As regras saem de `regrasDoSaldo`, e só dela: a configuração (a jornada
 * da empresa, a tolerância e a "Saldo calculado a partir de") e a ficha da
 * pessoa (a data em que ela passou a bater ponto aqui e a jornada própria),
 * lidas à parte, uma vez: o banco deixa todo mundo com sessão ler a
 * configuração e cada um ler a própria ficha. O saldo só aparece com as três
 * leituras certas (regras, batidas e ausências): sem as ausências, o dia do
 * atestado sairia como débito, e isso é pior do que não mostrar. Sem saldo, o
 * cartão diz por quê; quando o mês começa antes do primeiro dia cobrado, o
 * resumo diz a partir de que dia o saldo conta (`cobrancaNoRecorte`).
 *
 * O DIA DE FALTA APARECE NA LISTA
 * O resumo cobraria faltas em dias que a lista não mostra, porque ela só tem
 * os dias com batida ou ausência. Por isso cada dia que `saldo.ts` marcou com
 * falta entra na ordem das datas (`juntarDiasDeFalta`), na linha compacta do
 * painel da pessoa (`DiaSemBatida`), sem os botões de quem administra: "Sem
 * batida" e "Previsto 8h00 · Falta · Saldo −8h00". Hoje, o futuro, o dia sem
 * jornada e o dia antes do primeiro dia cobrado nunca são falta, e não
 * entram. Como a falta depende do saldo, ela só aparece com as três leituras
 * certas, e o aviso de "nenhuma batida" espera por elas para não piscar antes
 * da lista.
 *
 * NENHUMA DATA É DEDUZIDA DO APARELHO
 * O agrupamento por dia usa `dia_civil`, que o banco calculou em
 * `America/Sao_Paulo`. O relógio do celular só entra numa coisa: saber qual é o
 * mês corrente para abrir nele e para não deixar navegar para o futuro.
 */

/**
 * A leitura mora fora do componente e devolve o erro como VALOR em vez de
 * lançar — mesmo desenho de `Bater.tsx`. Assim o efeito que a dispara não
 * precisa de try/catch nem de um `setState` no próprio corpo.
 */
async function buscarMes(
  usuarioId: string,
  mes: string,
): Promise<{ batidas: Batida[]; erro: string | null }> {
  try {
    return { batidas: await lerBatidasDoMes(usuarioId, mes), erro: null }
  } catch (falha) {
    return {
      batidas: [],
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar este mês.',
    }
  }
}

/**
 * Os pedidos do mês, e os nomes de quem os decidiu. O erro volta como valor.
 * Os nomes só para quem administra: vêm da lista de contas do ponto, que o
 * banco só entrega a quem administra (ver `buscarPedidosDoDia`, em `Bater.tsx`).
 */
async function buscarPedidosDoMes(
  usuarioId: string,
  mes: string,
  administra: boolean,
): Promise<{ pedidos: PedidoDeAtraso[]; nomes: Map<string, string>; erro: string | null }> {
  try {
    const pedidos = await lerMeusPedidos(usuarioId, primeiroDiaDoMes(mes), ultimoDiaDoMes(mes))
    return { pedidos, nomes: administra ? await lerNomesDeQuemDecidiu(pedidos) : new Map(), erro: null }
  } catch (falha) {
    return {
      pedidos: [],
      nomes: new Map(),
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar seus pedidos deste mês.',
    }
  }
}

/** O que `regrasDoSaldo` lê: a configuração do ponto e a ficha ligada à conta. */
interface BaseDoSaldo {
  /** Nula = a linha de configuração não existe, e o saldo não aparece. */
  configuracao: ConfiguracaoDoPonto | null
  /** Nula = nenhuma ficha ligada a esta conta: nenhum dia é cobrado. */
  ficha: FichaDoFuncionario | null
}

/**
 * A configuração e a ficha da pessoa, para as regras do saldo. O erro volta
 * como valor. `lerFichas` devolve, a quem bate ponto, só a própria ficha (a
 * RLS esconde as outras), e a quem administra, todas: por isso a ficha é
 * escolhida pela conta.
 */
async function buscarBaseDoSaldo(usuarioId: string): Promise<{ base: BaseDoSaldo | null; erro: string | null }> {
  try {
    const [configuracao, fichas] = await Promise.all([lerConfiguracao(), lerFichas()])
    const ficha = fichas.find((umaFicha) => mesmaConta(umaFicha.usuarioId, usuarioId)) ?? null
    return { base: { configuracao, ficha }, erro: null }
  } catch (falha) {
    return {
      base: null,
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar a sua jornada.',
    }
  }
}

/** As ausências do mês. O erro volta como valor, como o dos pedidos. */
async function buscarAusenciasDoMes(
  usuarioId: string,
  mes: string,
): Promise<{ ausencias: Ausencia[]; erro: string | null }> {
  try {
    const periodo = { inicio: primeiroDiaDoMes(mes), fim: ultimoDiaDoMes(mes) }
    return { ausencias: await lerAusenciasDoPeriodo(periodo, usuarioId), erro: null }
  } catch (falha) {
    return {
      ausencias: [],
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar suas ausências deste mês.',
    }
  }
}

export function Espelho() {
  const navegar = useNavigate()
  const { usuario, administracao } = useAuth()
  const usuarioId = usuario?.id ?? null
  /** Quem administra lê os nomes de quem decidiu os pedidos; o colaborador, não. */
  const administra = administracao.estado === 'ok' && administracao.administra

  /*
   * O mês corrente sai do dia civil do ponto, não de `new Date().getMonth()`:
   * quem abrir o app às 22h do dia 31 em outro fuso veria o mês seguinte, vazio,
   * e concluiria que perdeu o mês inteiro. Fixado na montagem — uma tela aberta
   * na passagem da meia-noite não precisa trocar de mês sozinha debaixo do
   * dedo. O mesmo `hoje` decide qual dia ímpar está "Em andamento".
   */
  const hoje = useMemo(() => diaCivilDeHoje(), [])
  const mesCorrente = mesDe(hoje)
  const [mes, setMes] = useState(mesCorrente)

  const [batidas, setBatidas] = useState<Batida[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [selfieAberta, setSelfieAberta] = useState<Batida | null>(null)

  const [pedidos, setPedidos] = useState<PedidoDeAtraso[]>([])
  const [nomes, setNomes] = useState<Map<string, string>>(() => new Map())
  const [erroDosPedidos, setErroDosPedidos] = useState<string | null>(null)

  const [ausencias, setAusencias] = useState<Ausencia[]>([])
  const [erroDasAusencias, setErroDasAusencias] = useState<string | null>(null)
  /** As ausências DESTE mês já chegaram: antes disso o saldo não aparece (o atestado viraria débito). */
  const [ausenciasProntas, setAusenciasProntas] = useState(false)
  const [atestadoAberto, setAtestadoAberto] = useState<Ausencia | null>(null)

  /** A configuração e a ficha, para as regras do saldo: `undefined` enquanto a leitura não voltou. */
  const [baseDoSaldo, setBaseDoSaldo] = useState<BaseDoSaldo | null | undefined>(undefined)
  const [erroDoSaldo, setErroDoSaldo] = useState<string | null>(null)

  useEffect(() => {
    if (!usuarioId) return
    // A guarda `vivo` evita escrever estado numa tela que já saiu — o caso real
    // é trocar de mês duas vezes rápido e a resposta antiga chegar por último.
    let vivo = true
    void buscarMes(usuarioId, mes).then((resultado) => {
      if (!vivo) return
      setBatidas(resultado.batidas)
      setErro(resultado.erro)
      setCarregando(false)
    })
    return () => {
      vivo = false
    }
  }, [usuarioId, mes, tentativa])

  useEffect(() => {
    if (!usuarioId) return
    let vivo = true
    void buscarPedidosDoMes(usuarioId, mes, administra).then((resultado) => {
      if (!vivo) return
      setPedidos(resultado.pedidos)
      setNomes(resultado.nomes)
      setErroDosPedidos(resultado.erro)
    })
    return () => {
      vivo = false
    }
  }, [usuarioId, mes, administra, tentativa])

  useEffect(() => {
    if (!usuarioId) return
    let vivo = true
    void buscarAusenciasDoMes(usuarioId, mes).then((resultado) => {
      if (!vivo) return
      setAusencias(resultado.ausencias)
      setErroDasAusencias(resultado.erro)
      setAusenciasProntas(true)
    })
    return () => {
      vivo = false
    }
  }, [usuarioId, mes, tentativa])

  // A configuração e a ficha não mudam de um mês para o outro: uma leitura por conta (e por "Tentar de novo").
  useEffect(() => {
    if (!usuarioId) return
    let vivo = true
    void buscarBaseDoSaldo(usuarioId).then((resultado) => {
      if (!vivo) return
      setBaseDoSaldo(resultado.base)
      setErroDoSaldo(resultado.erro)
    })
    return () => {
      vivo = false
    }
  }, [usuarioId, tentativa])

  const espelho: EspelhoDoMes = useMemo(() => montarEspelho(mes, batidas), [mes, batidas])
  /*
   * O cabeçalho conta os dias incompletos SEM o de hoje: às 10h, com a
   * entrada batida, hoje é ímpar e está só em
   * andamento. O total continua o de `montarEspelho` — hoje ímpar soma zero lá
   * também, e entra no total quando fechar o par.
   */
  const incompletosAntesDeHoje = useMemo(
    () => espelho.dias.filter((dia) => dia.incompleto && dia.dia !== hoje).length,
    [espelho.dias, hoje],
  )
  const ausenciasDoDia = useMemo(
    () => ausenciasPorDia(ausencias, { inicio: primeiroDiaDoMes(mes), fim: ultimoDiaDoMes(mes) }),
    [ausencias, mes],
  )
  const ausenciasAtivas = useMemo(() => ausencias.filter(ehAtiva), [ausencias])

  /*
   * AS REGRAS DO SALDO, montadas por `regrasDoSaldo` e só por ela: a
   * configuração e a ficha desta conta, e hoje. Nulas sem a configuração.
   */
  const regras = useMemo(
    () => (baseDoSaldo?.configuracao ? regrasDoSaldo(baseDoSaldo.configuracao, baseDoSaldo.ficha, hoje) : null),
    [baseDoSaldo, hoje],
  )
  /*
   * O SALDO DO MÊS, da mesma conta do painel da pessoa. Nulo enquanto falta
   * alguma das três leituras, ou quando uma delas falhou.
   */
  const saldoDoMes = useMemo(() => {
    if (!regras || carregando || erro || !ausenciasProntas || erroDasAusencias) return null
    return calcularSaldoDoMes(mes, batidas, ausencias, regras)
  }, [regras, carregando, erro, ausenciasProntas, erroDasAusencias, mes, batidas, ausencias])
  const saldoPorDia = useMemo(
    () => new Map<string, SaldoDoDia>((saldoDoMes?.dias ?? []).map((dia) => [dia.dia, dia])),
    [saldoDoMes],
  )
  /** O abonado que soma no total do mês, da mesma conta do painel da pessoa. */
  const abonadoDoMes = useMemo(() => abonadoNoTotal(saldoDoMes?.dias ?? []), [saldoDoMes])
  /** Os dias com batida ou ausência e, com o saldo na mão, os dias de falta, em ordem de data. */
  const diasDaLista = useMemo(
    () => juntarDiasDeFalta(juntarDiasEAusencias(espelho.dias, ausenciasDoDia), saldoDoMes?.dias ?? []),
    [espelho.dias, ausenciasDoDia, saldoDoMes],
  )
  /**
   * As leituras de que a lista depende já voltaram (a configuração, a ficha e
   * as ausências, além das batidas): antes disso, um mês sem batida ainda pode
   * ter falta.
   */
  const listaDecidida = baseDoSaldo !== undefined && ausenciasProntas
  /** Onde o primeiro dia cobrado cai neste mês: a data que o resumo diz, ou o motivo de não haver saldo. */
  const cobranca = regras ? cobrancaNoRecorte(regras.cobrancaDesde, primeiroDiaDoMes(mes), ultimoDiaDoMes(mes)) : null
  /** Por que o saldo do mês não está no cartão, quando não está e não é só espera. */
  const semSaldo = erroDoSaldo
    ? 'O saldo deste mês não aparece porque a sua jornada não carregou.'
    : erroDasAusencias
      ? 'O saldo deste mês não aparece porque as suas ausências não carregaram.'
      : baseDoSaldo === undefined
        ? null
        : !baseDoSaldo?.configuracao
          ? 'O saldo aparece quando a jornada da empresa estiver cadastrada.'
          : !baseDoSaldo.ficha
            ? 'O saldo aparece quando a sua conta tiver uma ficha, com a data em que você passou a bater ponto aqui.'
            : cobranca?.caso === 'sem_data'
              ? 'O saldo aparece quando quem administra o ponto preencher, na sua ficha, a data em que você passou a bater ponto aqui.'
              : cobranca?.caso === 'depois'
                ? `Saldo calculado a partir de ${dataBrasileira(cobranca.desde)}: nenhum dia deste mês entra no saldo.`
                : null
  const aprovadores = useMemo(() => aprovadoresDosPedidos(pedidos, nomes), [pedidos, nomes])

  /** Troca de mês: limpa a lista para não mostrar agosto sob o rótulo de julho. */
  function irPara(novoMes: string) {
    setSelfieAberta(null)
    setBatidas([])
    setPedidos([])
    setErroDosPedidos(null)
    setAusencias([])
    setErroDasAusencias(null)
    setAusenciasProntas(false)
    setAtestadoAberto(null)
    setErro(null)
    setCarregando(true)
    setMes(novoMes)
  }

  function recarregar() {
    setCarregando(true)
    setErro(null)
    setTentativa((n) => n + 1)
  }

  // Não existe ponto no futuro. O botão para no mês corrente.
  const podeAvancar = mes < mesCorrente

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-5 py-8">
      <header className="flex items-center justify-between">
        <button
          onClick={() => navegar('/')}
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-mute transition-colors hover:text-plat-dim"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Bater ponto
        </button>
        <MarcaDoTopo />
      </header>

      <div className="mt-8">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
          Meu espelho de ponto
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-plat">Seu mês</h1>
      </div>

      {/* Troca de mês */}
      <nav className="mt-6 flex items-center justify-between gap-2" aria-label="Escolha do mês">
        <button
          onClick={() => irPara(mesAnterior(mes))}
          aria-label={`Ver ${rotuloDoMes(mesAnterior(mes))}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-hair-2 bg-ink-2 text-plat-dim transition-colors hover:border-hair-3 hover:text-plat"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>

        <p aria-live="polite" className="text-center text-sm font-semibold text-plat">
          {rotuloDoMes(mes)}
        </p>

        <button
          onClick={() => irPara(mesSeguinte(mes))}
          disabled={!podeAvancar}
          aria-label={
            podeAvancar ? `Ver ${rotuloDoMes(mesSeguinte(mes))}` : 'Não há ponto depois deste mês'
          }
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-hair-2 bg-ink-2 text-plat-dim transition-colors hover:border-hair-3 hover:text-plat disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-hair-2 disabled:hover:text-plat-dim"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </nav>

      {/* Total do mês */}
      <Painel className="mt-4 text-center">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
          Total do mês
        </p>
        <p className="mt-2 font-mono text-4xl font-medium tracking-tight text-plat tabular-nums">
          {carregando || erro ? '—' : formatarDuracao(espelho.minutos + abonadoDoMes)}
        </p>
        {!carregando && !erro && (
          <ComposicaoDoTotal trabalhado={espelho.minutos} abonado={abonadoDoMes} dias={saldoDoMes?.dias ?? []} />
        )}
        {!carregando && !erro && (
          <p className="mt-2 text-xs leading-relaxed text-mute">
            {espelho.diasComBatida}{' '}
            {espelho.diasComBatida === 1 ? 'dia com batida' : 'dias com batida'}
            {incompletosAntesDeHoje > 0 && (
              <span className="text-warn">
                {' · '}
                {incompletosAntesDeHoje}{' '}
                {incompletosAntesDeHoje === 1 ? 'incompleto' : 'incompletos'}, fora do total
              </span>
            )}
            {ausenciasDoDia.size > 0 && (
              <>
                {' · '}
                {ausenciasDoDia.size}{' '}
                {ausenciasDoDia.size === 1 ? 'dia de ausência' : 'dias de ausência'}
              </>
            )}
          </p>
        )}
        {saldoDoMes && !semSaldo && (
          <ResumoDoSaldoNaTela
            resumo={saldoDoMes.resumo}
            rotulo="Saldo do mês"
            comHoje={mes === mesCorrente}
            aPartirDe={cobranca?.caso === 'no_meio' ? cobranca.desde : null}
          />
        )}
        {!carregando && !erro && semSaldo && (
          <p className="mt-4 border-t border-hair pt-4 text-xs leading-relaxed text-mute">{semSaldo}</p>
        )}
      </Painel>

      <main className="mt-6 flex-1">
        {erro && (
          <div className="space-y-2">
            <Aviso tom="atencao">{erro}</Aviso>
            <Botao tom="secundario" onClick={recarregar} disabled={carregando}>
              <RefreshCw size={15} aria-hidden="true" />
              {carregando ? 'Carregando…' : 'Tentar de novo'}
            </Botao>
          </div>
        )}

        {!erro && carregando && <p className="text-sm text-mute">Carregando…</p>}

        {/* Mês sem batida é estado vazio, não erro: quem entrou na empresa no
            meio do ano tem todos os meses anteriores assim, e eles estão certos. */}
        {!erro && !carregando && listaDecidida && diasDaLista.length === 0 && (
          <Painel className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ink-2 text-mute">
              <CalendarOff size={22} aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-plat">Nenhuma batida em {rotuloDoMes(mes)}</h2>
            <p className="mt-2 text-sm leading-relaxed text-mute">
              Este mês não tem nenhum registro seu. Use as setas acima para ver outro período.
            </p>
          </Painel>
        )}

        {!erro && !carregando && diasDaLista.length > 0 && (
          <ul className="space-y-3">
            {diasDaLista.map(({ dia: diaCivil, batidas: dia, ausencias: doDia }) =>
              dia ? (
                <DiaDoEspelho
                  key={diaCivil}
                  dia={dia}
                  ehHoje={diaCivil === hoje}
                  aoAbrirSelfie={setSelfieAberta}
                  aprovadores={aprovadores}
                  ausencias={doDia}
                  aoAbrirAtestado={setAtestadoAberto}
                  saldo={saldoPorDia.get(diaCivil)}
                />
              ) : doDia.length > 0 ? (
                <DiaDeAusencia
                  key={diaCivil}
                  dia={diaCivil}
                  ausencias={doDia}
                  aoAbrirAtestado={setAtestadoAberto}
                  saldo={saldoPorDia.get(diaCivil)}
                />
              ) : (
                // O dia de falta (`juntarDiasDeFalta`): sem os botões de quem administra, que a RLS recusaria.
                <DiaSemBatida key={diaCivil} dia={diaCivil} saldo={saldoPorDia.get(diaCivil)} />
              ),
            )}
          </ul>
        )}

        {!erro && !carregando && erroDasAusencias && (
          <div className="mt-4">
            <Aviso tom="atencao">{erroDasAusencias}</Aviso>
          </div>
        )}

        {!erro && !carregando && (
          <AusenciasDoPeriodo
            titulo={`Ausências em ${rotuloDoMes(mes).toLowerCase()}`}
            ausencias={ausenciasAtivas}
            aoAbrirAtestado={setAtestadoAberto}
          />
        )}

        {!erro && !carregando && (
          <MeusPedidosDeAtraso
            titulo={`Pedidos de batida em atraso em ${rotuloDoMes(mes).toLowerCase()}`}
            pedidos={pedidos}
            nomes={nomes}
            mostrarDia
            erro={erroDosPedidos}
            aoTentarDeNovo={recarregar}
          />
        )}
      </main>

      <footer className="mt-10 text-center">
        <p className="text-[0.68rem] leading-relaxed text-faint">
          As horas saem das suas batidas, com o horário oficial do ponto, mais as horas abonadas por
          atestado ou falta justificada. Dia com batida faltando não entra no total até ser
          corrigido, e o saldo dele fica pendente até lá. O saldo compara as horas com a sua
          jornada: atestado médico e falta justificada abonam a parte da jornada que cobrem. O dia
          da jornada que passou sem batida e sem abono aparece na lista como falta.
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
    </div>
  )
}
