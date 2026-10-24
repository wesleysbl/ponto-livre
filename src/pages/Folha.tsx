import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Printer, RefreshCw } from 'lucide-react'
import { FolhaParaImprimir } from '../components/FolhaParaImprimir'
import { Aviso, Botao } from '../components/ui'
import { lerConfiguracao } from '../lib/administracao'
import { lerBatidasDoPeriodo, lerGenteDoPainel } from '../lib/admin'
import type { PedidoDeAtraso } from '../lib/atraso'
import type { ConfiguracaoDoPonto } from '../lib/configuracao'
import { diaCivilDeHoje, formatarMomento, type BatidaDoAdmin } from '../lib/formato'
import { montarFolha } from '../lib/folha'
import { ehMesValido, mesAnterior, mesDe, mesSeguinte, rotuloDoMes } from '../lib/horas'
import { avisosDaFolha, GENTE_VAZIA, pessoaDoPainel, primeiroNome, type GenteDoPainel } from '../lib/painel'
import { parametrosDoPeriodo, periodoDoMes } from '../lib/periodo'
import { lerAprovadoresDoPeriodo, lerPedidosPendentes } from '../lib/pedidos'
import { lerAusenciasDoPeriodo } from '../lib/faltas'
import type { Ausencia } from '../lib/ausencias'

/*
 * A FOLHA DE PONTO DE UMA PESSOA, PRONTA PARA IMPRIMIR E ASSINAR.
 *
 * POR QUE UMA ROTA PRÓPRIA, E NÃO UM PEDAÇO ESCONDIDO DAS OUTRAS TELAS
 * A folha é "uma pessoa por página, sem menu, sem botão, sem barra de
 * navegação". Isso se consegue de dois jeitos: pendurando a folha invisível
 * dentro do painel e escondendo o resto na impressão, ou dando a ela um
 * endereço. O segundo ganha por três motivos práticos: a folha vira LINK — o
 * admin manda a URL para o RH; ela abre em `?mes=` e navega por mês sozinha,
 * sem herdar o período livre do painel (a folha é mensal por definição); e o
 * que se imprime é exatamente o que está na tela, sem uma segunda árvore de
 * elementos escondida que ninguém revisa.
 *
 * NÃO ENTROU BIBLIOTECA DE PDF, e isso é decisão, não economia. O PDF sai da
 * própria caixa de impressão do navegador — "Salvar como PDF" —, que existe em
 * todo aparelho que abre este app, inclusive no celular. Um gerador de PDF
 * acrescentaria centenas de kB e uma segunda régua de layout, que divergiria do
 * CSS de impressão na primeira mudança.
 *
 * O CSV E A FOLHA CONVIVEM DE PROPÓSITO: o CSV serve à contabilidade (uma linha por batida, abre no Excel), a folha serve à
 * assinatura (uma linha por dia, legível em preto e branco, com espaço para
 * caneta). Unificá-los faria um documento que não serve a nenhum dos dois.
 *
 * ⚠ ESTA ROTA NÃO PROTEGE NADA. `RotaProtegida exigeAdmin` evita desenhar uma
 * folha que viria vazia; quem recusa a leitura das batidas de outra pessoa é a
 * RLS, no Postgres, a cada consulta. Quem forçar a URL sem administrar o ponto
 * vê a folha montar com zero dias.
 *
 * ---------------------------------------------------------------------------
 * ⚠⚠ A FOLHA É A EXCEÇÃO DA RESPONSIVIDADE — E POR QUÊ
 *
 * Todas as outras telas se adaptam à largura. Esta NÃO PODE: ela é um documento
 * A4, medido em milímetros, e o layout de impressão foi ajustado até um mês de
 * 22 dias com batida caber numa folha só. Encolher a folha para caber num
 * celular mudaria o que a pessoa está conferindo antes de mandar imprimir — e
 * ela conferiria uma coisa e imprimiria outra.
 *
 * O PROBLEMA QUE O PISO RESOLVE: o `<article>` da folha é `w-full
 * max-w-[210mm]`, e `w-full` dentro de um contêiner de 320 px dá 320 px, não
 * 210 mm. Sem piso, a folha ENCOLHERIA: a razão social viraria uma torre de
 * cinco linhas, o nome do funcionário passaria por cima do total do mês e a
 * tabela furaria o cartão. O texto logo acima diz "a folha abaixo é exatamente
 * o que vai para o papel", e no celular isso seria mentira.
 *
 * O PISO DE LARGURA — `min-w-[210mm]` — fica dentro do contêiner que já rola na
 * horizontal. A folha tem SEMPRE a largura do papel, e quem se adapta é a
 * janelinha por onde se olha para ela: ela rola dentro do próprio cartão, e a
 * PÁGINA continua sem rolagem horizontal.
 *
 * `print:min-w-0` desfaz o piso na impressão, e não é detalhe: a área útil do
 * A4 com as margens de `@page` (14mm 12mm) é de 186 mm, e um piso de 210 mm ali
 * empurraria a folha para fora do papel e refaria a paginação inteira. Nada
 * dentro de `print:`, neste arquivo ou em `FolhaParaImprimir.tsx`, depende do
 * piso: o limiar de 22 dias por página foi medido com ele no lugar.
 * ---------------------------------------------------------------------------
 *
 * A FOLHA NÃO IMPRIME SOZINHA COM PENDÊNCIA.
 * Dia com batida faltando (hoje fica de fora), pedido de batida em atraso desta
 * pessoa esperando decisão e cabeçalho incompleto viram avisos acima do botão,
 * cada um com o link que resolve (`avisosDaFolha`). Com algum deles, o
 * `?imprimir=1` não abre a caixa de impressão: a folha espera o clique de quem
 * leu. O botão continua imprimindo — a decisão de imprimir assim é de quem
 * está olhando. E o "Voltar" leva à pessoa NO MESMO MÊS, e não no corrente.
 */

interface Dados {
  configuracao: ConfiguracaoDoPonto | null
  /**
   * As contas do ponto, com o nome de exibição da regra única, e o que das
   * fichas dá nome a esta pessoa quando ela não está entre elas.
   */
  gente: GenteDoPainel
  batidas: BatidaDoAdmin[]
  /**
   * As ausências da pessoa que tocam o mês. Parte da carga: uma folha
   * assinada sem a falta justificada seria papel errado, e calado.
   */
  ausencias: Ausencia[]
  /** Quem aprovou cada batida em atraso. De melhor esforço: vazio não é erro. */
  aprovadores: Map<string, string | null>
  /**
   * Os pedidos de batida em atraso pendentes (de todo mundo; a tela filtra os
   * desta pessoa). Parte da carga: sem eles, a folha não saberia se
   * pode abrir a impressão sozinha.
   */
  pedidos: PedidoDeAtraso[]
  erro: string | null
}

const VAZIO: Dados = {
  configuracao: null,
  gente: GENTE_VAZIA,
  batidas: [],
  ausencias: [],
  aprovadores: new Map(),
  pedidos: [],
  erro: null,
}

/**
 * As três leituras, com o erro devolvido como VALOR — mesmo desenho do resto do
 * app (`Painel.tsx`, `PainelDaPessoa.tsx`, `Administracao.tsx`).
 *
 * A CONFIGURAÇÃO DA EMPRESA VEM JUNTO, e a folha não morre sem ela: `null` aqui
 * vira o cabeçalho em branco em `montarFolha`. É o caso de borda de toda
 * instalação nova, antes de alguém preencher a razão social e o CNPJ.
 */
async function buscar(usuarioId: string, mes: string): Promise<Dados> {
  try {
    const [configuracao, gente, batidas, ausencias, pedidos] = await Promise.all([
      lerConfiguracao(),
      lerGenteDoPainel(),
      lerBatidasDoPeriodo(periodoDoMes(mes), usuarioId),
      lerAusenciasDoPeriodo(periodoDoMes(mes), usuarioId),
      lerPedidosPendentes(),
    ])
    const nomes = new Map(gente.funcionarios.map((pessoa) => [pessoa.usuarioId, pessoa.nome]))
    const aprovadores = await lerAprovadoresDoPeriodo(periodoDoMes(mes), nomes, usuarioId)
    return { configuracao, gente, batidas, ausencias, aprovadores, pedidos, erro: null }
  } catch (falha) {
    return {
      ...VAZIO,
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar a folha deste mês.',
    }
  }
}

export function Folha() {
  const navegar = useNavigate()
  const { usuarioId = '' } = useParams()
  const [parametros, setParametros] = useSearchParams()

  /*
   * O mês corrente sai do dia civil do PONTO, não do relógio do aparelho:
   * quem abrir às 22h do dia 31 em outro fuso pediria a folha do mês seguinte,
   * vazia, e concluiria que o mês sumiu. Fixado na montagem.
   */
  const hoje = useMemo(() => diaCivilDeHoje(), [])
  const mesCorrente = useMemo(() => mesDe(hoje), [hoje])

  /*
   * `?mes=` É ENTRADA DE USUÁRIO, e `montarFolha` levanta com mês malformado —
   * `?mes=2026-13` viraria tela branca. A conferência acontece aqui, uma vez, e
   * o que não é mês cai no mês corrente. Mesma regra de `lerPeriodo`, em
   * `periodo.ts`: quem lê de fora nunca deixa a exceção subir para o render.
   */
  const mesPedido = parametros.get('mes')
  const mes = mesPedido && ehMesValido(mesPedido) ? mesPedido : mesCorrente

  const [dados, setDados] = useState<Dados>(VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (!usuarioId) return
    let vivo = true
    void buscar(usuarioId, mes).then((resultado) => {
      if (!vivo) return
      setDados(resultado)
      setCarregando(false)
    })
    return () => {
      vivo = false
    }
  }, [usuarioId, mes, tentativa])

  /*
   * Quem é esta pessoa — o nome que vai para o PAPEL ASSINADO. É o da regra
   * única (`nomes.ts`): a ficha de RH ligada à conta, depois o nome guardado
   * na conta, depois o nome gravado nas batidas do mês, depois o e-mail
   * (`pessoaDoPainel`). Sem a ficha, a folha de quem usa uma conta de função
   * (`recepcao@`) sairia com o nome do dono anterior da conta. Fora da lista de
   * contas, a mesma ordem com o que a batida congelou. É o desenho do banco: a
   * batida é prova trabalhista e sobrevive ao desligamento, e é
   * justamente o mês do acerto que mais precisa de folha.
   */
  const funcionario = useMemo(() => {
    const pessoa = pessoaDoPainel(usuarioId, dados.gente, dados.batidas)
    return { nome: pessoa.nome, email: pessoa.email }
  }, [dados.gente, dados.batidas, usuarioId])

  const folha = useMemo(
    () =>
      montarFolha({
        empresa: dados.configuracao,
        funcionario,
        mes,
        batidas: dados.batidas,
        aprovadores: dados.aprovadores,
        ausencias: dados.ausencias,
      }),
    [dados.configuracao, funcionario, mes, dados.batidas, dados.aprovadores, dados.ausencias],
  )

  /** O que falta resolver antes de imprimir. Só conta com os dados na mão. */
  const avisos = useMemo(
    () =>
      carregando || dados.erro
        ? []
        : avisosDaFolha({
            usuarioId,
            mes,
            linhas: folha.linhas,
            pedidos: dados.pedidos,
            empresa: dados.configuracao,
            hoje,
          }),
    [carregando, dados.erro, usuarioId, mes, folha.linhas, dados.pedidos, dados.configuracao, hoje],
  )

  /** O momento da emissão, fixado na montagem: a folha não muda de hora sozinha. */
  const emitidaEm = useMemo(() => formatarMomento(new Date().toISOString()), [])

  function imprimir() {
    /*
     * A caixa de impressão do navegador — e é dela que sai o PDF, por "Salvar
     * como PDF". O `try` existe porque `window.print()` levanta em ambiente sem
     * caixa de impressão (uma webview embutida, por exemplo); quando isso
     * acontece a folha continua na tela inteira, que é o essencial.
     */
    try {
      window.print()
    } catch {
      /* Sem caixa de impressão neste ambiente. A folha continua legível na tela. */
    }
  }

  /*
   * ABRIR A CAIXA DE IMPRESSÃO SOZINHA, QUANDO A URL PEDIU.
   *
   * É o que faz o botão da área de administração e o da tela da pessoa
   * "abrirem a caixa de impressão do navegador": eles
   * navegam para cá com `?imprimir=1`.
   *
   * ELA SÓ DISPARA DEPOIS QUE OS DADOS CHEGAM — imprimir antes sairia uma folha
   * em branco com o cabeçalho e nenhum dia, que é indistinguível de um mês sem
   * batida. E dispara UMA VEZ: `jaAbriu` sobrevive à dupla execução de efeito
   * do StrictMode em desenvolvimento, e o parâmetro sai da URL logo em seguida
   * para um F5 não reabrir a caixa por cima de quem só queria conferir.
   *
   * COM AVISO, ELA NÃO ABRE: dia incompleto, pedido pendente ou
   * cabeçalho incompleto ficam na tela, acima do botão, e a impressão espera o
   * clique. A caixa do navegador por cima esconderia justamente os avisos.
   */
  const jaAbriu = useRef(false)
  const pediuImpressao = parametros.get('imprimir') === '1'

  useEffect(() => {
    if (carregando || dados.erro || !pediuImpressao || jaAbriu.current) return
    jaAbriu.current = true

    const proximos = new URLSearchParams(parametros)
    proximos.delete('imprimir')
    setParametros(proximos, { replace: true })

    if (avisos.length > 0) return
    try {
      window.print()
    } catch {
      /* Sem caixa de impressão neste ambiente — o botão continua na tela. */
    }
  }, [carregando, dados.erro, pediuImpressao, parametros, setParametros, avisos.length])

  function irPara(novoMes: string) {
    setCarregando(true)
    setDados(VAZIO)
    setParametros({ mes: novoMes }, { replace: true })
  }

  // Não existe folha de ponto do futuro. O botão para no mês corrente.
  const podeAvancar = mes < mesCorrente

  /*
   * A VOLTA LEVA À PESSOA NO MESMO MÊS: "Voltar para Ana · outubro de 2026", e
   * a tela da pessoa abre em outubro — se caísse no mês corrente, quem veio
   * corrigir um dia da folha de setembro perderia o lugar.
   */
  const rotuloDaVolta = `Voltar para ${carregando || dados.erro ? 'a pessoa' : primeiroNome(funcionario.nome)} · ${rotuloDoMes(mes).toLowerCase()}`
  const destinoDaVolta = `/painel/${usuarioId}?${new URLSearchParams(parametrosDoPeriodo(periodoDoMes(mes))).toString()}`

  return (
    /*
      `lg:max-w-[calc(210mm+2.5rem+2px)]`: a largura exata para o papel de 210 mm
      caber inteiro entre os `px-5` da página (2.5rem) e os dois fios de 1 px da
      borda do cartão, sem barra de rolagem, no computador. `max-w-3xl` (768 px)
      deixaria a folha de 794 px rolando mesmo num monitor com espaço de
      sobra — e os 2 px da borda são a diferença entre rolar e não rolar.
    */
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8 sm:max-w-3xl sm:px-5 lg:max-w-[calc(210mm+2.5rem+2px)] print:min-h-0 print:max-w-none print:p-0">
      {/*
        TUDO O QUE É INTERFACE VIVE DENTRO DESTE `print:hidden`, e é o que
        garante que a pré-visualização de impressão não mostra menu,
        botão nem barra de navegação. O que sobra na página impressa é a folha,
        e só ela.
      */}
      <div className="print:hidden">
        <header className="flex items-center justify-between">
          <button
            onClick={() => navegar(destinoDaVolta)}
            className="-ml-2 inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-xs text-mute transition-colors hover:text-plat-dim"
          >
            <ArrowLeft size={15} aria-hidden="true" className="shrink-0" />
            {rotuloDaVolta}
          </button>
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
            Folha para assinar
          </p>
        </header>

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
              podeAvancar ? `Ver ${rotuloDoMes(mesSeguinte(mes))}` : 'Não há folha depois deste mês'
            }
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-hair-2 bg-ink-2 text-plat-dim transition-colors hover:border-hair-3 hover:text-plat disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-hair-2 disabled:hover:text-plat-dim"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>

        {avisos.length > 0 && (
          <section
            aria-labelledby="antes-de-imprimir"
            className="mt-3 rounded-xl border border-warn/35 bg-warn-soft px-4 py-3"
          >
            <h2 id="antes-de-imprimir" className="flex items-center gap-1.5 text-sm font-semibold text-warn">
              <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
              Antes de imprimir, confira
            </h2>
            <ul className="mt-2 space-y-2.5">
              {avisos.map((aviso) => (
                <li key={aviso.chave} className="text-sm leading-relaxed text-plat-dim">
                  <p>{aviso.texto}</p>
                  <p className="-ml-1 flex flex-wrap gap-x-3">
                    {aviso.links.map((link) => (
                      <Link
                        key={link.destino}
                        to={link.destino}
                        className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-semibold text-luz underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
                      >
                        {link.rotulo}
                      </Link>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs leading-relaxed text-mute">
              Com estes avisos, a folha não abre a impressão sozinha. Para imprimir assim mesmo, use o
              botão abaixo.
            </p>
          </section>
        )}

        <div className="mt-3">
          <Botao onClick={imprimir} disabled={carregando || Boolean(dados.erro)}>
            <Printer size={16} aria-hidden="true" />
            Imprimir ou salvar em PDF
          </Botao>
          <p className="mt-2 text-center text-[0.68rem] leading-relaxed text-faint">
            O PDF sai da própria caixa de impressão do navegador: escolha “Salvar como PDF” no
            lugar da impressora. A folha abaixo é exatamente o que vai para o papel.
          </p>
        </div>

        {dados.erro && (
          <div className="mt-4 space-y-2">
            <Aviso tom="atencao">{dados.erro}</Aviso>
            <Botao
              tom="secundario"
              onClick={() => {
                setCarregando(true)
                setDados(VAZIO)
                setTentativa((n) => n + 1)
              }}
              disabled={carregando}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {carregando ? 'Carregando…' : 'Tentar de novo'}
            </Botao>
          </div>
        )}

        {!dados.erro && carregando && <p className="mt-4 text-sm text-mute">Carregando a folha…</p>}
      </div>

      {/*
        A FOLHA SÓ APARECE COM OS DADOS NA MÃO. Desenhá-la durante o
        carregamento mostraria um mês vazio com cara de mês sem batida — e
        alguém imprimiria isso.
      */}
      {!dados.erro && !carregando && (
        <main className="mt-6 print:mt-0">
          <div className="overflow-x-auto rounded-2xl border border-hair print:overflow-visible print:rounded-none print:border-0">
            {/*
              O PISO DE LARGURA DO PAPEL — ver o cabeçalho desta tela. Ele vive
              AQUI, e não dentro de `FolhaParaImprimir`, de propósito: aquele
              componente é o desenho do documento e não deve saber por qual
              janelinha estão olhando para ele. Quem sabe disso é a tela.

              `print:min-w-0` é obrigatório: 210 mm não cabem nos 186 mm de área
              útil do A4 com as margens do `@page`.
            */}
            <div className="min-w-[210mm] print:min-w-0">
              <FolhaParaImprimir folha={folha} emitidaEm={emitidaEm} />
            </div>
          </div>
          {/*
            A dica de arrastar é DE TELA e só até `lg`, que é a largura em que a
            folha inteira passa a caber sem rolar. `print:hidden` porque este
            parágrafo está FORA do bloco de interface lá de cima — sem ele, "
            arraste-a para o lado" sairia impresso no rodapé de um documento
            assinado.
          */}
          <p className="mt-2 text-center text-[0.68rem] leading-relaxed text-faint lg:hidden print:hidden">
            A folha tem a largura do papel A4 e não encolhe: arraste-a para o lado para ver as
            colunas da direita. É de propósito — o que está aí é o que sai impresso.
          </p>
        </main>
      )}
    </div>
  )
}
