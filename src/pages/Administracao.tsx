import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  Clock,
  RefreshCw,
  Save,
} from 'lucide-react'
import { MarcaDoTopo } from '../components/Marca'
import { FormularioDoLocal } from '../components/FormularioDoLocal'
import { InicioDaAdministracao } from '../components/InicioDaAdministracao'
import { ListaDePessoas } from '../components/ListaDePessoas'
import { Aviso, Botao, Campo, Painel as Cartao, Pagina } from '../components/ui'
import { lerConfiguracao, lerLocalAtivo, salvarEmpresa, salvarJornada } from '../lib/administracao'
import {
  camposFaltandoDaEmpresa,
  escreverDuracao,
  formatarCnpj,
  validarEmpresa,
  validarJornada,
  type ConfiguracaoDoPonto,
  type LocalDoPonto,
  type RascunhoDaEmpresa,
  type RascunhoDaJornada,
} from '../lib/configuracao'
import { formatarMomento } from '../lib/formato'
import {
  ID_DA_SECAO,
  type Contagem,
  type EntradaDoInicio,
  type ResumoDePessoas,
} from '../lib/inicio-da-administracao'

/*
 * A ÁREA DE ADMINISTRAÇÃO — a página inicial, a lista de pessoas e três
 * formulários.
 *
 * ELA ABRE PELA PÁGINA INICIAL: seis
 * cartões com contador — pendências de atraso, pessoas, ausências, local,
 * empresa e jornada (`components/InicioDaAdministracao.tsx`). O cartão diz
 * onde há trabalho esperando e leva até lá: as três seções que moram nesta
 * página rolam até o bloco dela; atraso e ausência abrem o painel, que é onde
 * se decide o pedido e onde se escolhe a pessoa para lançar a falta. A porta
 * desta página fica no painel e na tela de bater, para quem administra.
 *
 * O QUE ESTA TELA EXISTE PARA RESOLVER: sem ela, a coordenada do local e as
 * regras de jornada só mudariam por SQL. Quem opera o ponto não abre o banco,
 * e não deveria precisar. A outra metade é a das
 * pessoas: resetar PIN, conceder e revogar administração, cuidar das contas e
 * das fichas e alcançar a correção de batidas saem todos daqui, e não de três
 * lugares diferentes.
 *
 * A LISTA DE PESSOAS MORA EM `components/ListaDePessoas.tsx`, e não aqui. Ela
 * tem período próprio, seis leituras, as ações de conta, ficha, administração
 * e PIN e as caixas de cada uma — somadas aos três formulários abaixo, dariam
 * um arquivo em que ninguém acha nada. Esta tela continua sendo a dona da rota.
 *
 * É UMA LISTA SÓ. Cada linha é uma pessoa — conta, ficha, administração e PIN
 * —, e a ficha sem conta é pessoa também. Ver o cabeçalho de `ListaDePessoas`.
 *
 * A ORDEM DAS SEÇÕES É A ORDEM DE USO, e não a de implementação: pessoas em
 * cima, porque é a parte que se mexe toda semana; local, empresa e jornada
 * embaixo, porque se mexem uma vez por ano.
 *
 * A GUARDA DE ROTA NÃO PROTEGE ISTO. Ela evita desenhar formulários que não
 * vão gravar; quem recusa cada gravação é a RLS, no Postgres, a cada chamada.
 * Um não-administrador que force `/administracao` vê a tela montar e cada
 * "Salvar" voltar recusado com a frase do banco.
 *
 * CADA FORMULÁRIO SALVA SOZINHO, E ISSO É DE PROPÓSITO
 * Um botão único no rodapé gravaria as três coisas juntas e faria uma recusa
 * de CNPJ derrubar o ajuste do raio que já estava certo. São três assuntos
 * independentes, com três consequências diferentes: o local muda onde a
 * batida é "dentro", a empresa muda o cabeçalho impresso, e a jornada muda a
 * janela que recusa batida repetida (a carga e a tolerância só ficam
 * guardadas). Salvar em bloco misturaria as três.
 *
 * O QUE VOLTA DO BANCO REPÕE O QUE ESTÁ NA TELA. É o caso de borda das duas
 * abas: vence a última gravação, e a aba que perdeu a corrida passa a mostrar
 * o valor gravado em vez do próprio texto com cara de salvo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ESTA TELA TEM UMA TAREFA QUE SÓ EXISTE NO CELULAR
 *
 * "Usar a localização deste aparelho", no formulário do local, mede a
 * coordenada de ONDE O APARELHO ESTÁ. Ela só dá a resposta certa se quem aperta
 * estiver dentro do local de trabalho — ou seja, no telefone, em pé, no meio do
 * escritório. Um notebook em casa mediria a casa. É a única função do app em que
 * o celular não é uma conveniência: é o instrumento.
 *
 * Por isso o formulário do local é o que NUNCA pode espremer. Ele foi conferido
 * em 320 px de largura, com o botão de captura em alvo de 44 px e os campos de
 * latitude e longitude legíveis por inteiro depois de a captura preenchê-los —
 * conferir o número medido é metade do trabalho.
 *
 * OS TRÊS FORMULÁRIOS FICAM LADO A LADO NO COMPUTADOR, e empilhados no celular.
 * São três assuntos independentes, que se salvam sozinhos e nunca se leem juntos
 * — a leitura de cima para baixo não perde nada ao virar da esquerda para a
 * direita. E a alternativa, uma coluna de 448 px num monitor de 1280, obrigava a
 * rolar três telas para chegar às regras de jornada.
 * ---------------------------------------------------------------------------
 */

interface Dados {
  configuracao: ConfiguracaoDoPonto | null
  local: LocalDoPonto | null
  erro: string | null
}

const VAZIO: Dados = { configuracao: null, local: null, erro: null }

/**
 * A leitura mora fora do componente e devolve o erro como VALOR — mesmo
 * desenho de `Painel.tsx` e `PainelDaPessoa.tsx`.
 */
async function buscar(): Promise<Dados> {
  try {
    const [configuracao, local] = await Promise.all([lerConfiguracao(), lerLocalAtivo()])
    return { configuracao, local, erro: null }
  } catch (falha) {
    return {
      ...VAZIO,
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar a configuração.',
    }
  }
}

/** Título de seção, no mesmo tom das outras telas do app. */
function Secao({ icone, titulo, descricao }: { icone: ReactNode; titulo: string; descricao: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-2 text-luz">
        {icone}
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-plat">{titulo}</h2>
        <p className="mt-0.5 text-[0.7rem] leading-relaxed text-mute">{descricao}</p>
      </div>
    </div>
  )
}

/** As frases de recusa, todas de uma vez. Uma por linha, com `role="alert"`. */
function Recusas({ erros }: { erros: string[] }) {
  if (erros.length === 0) return null
  return (
    <Aviso tom="erro">
      {erros.length === 1 ? (
        erros[0]
      ) : (
        <ul className="list-disc space-y-1 pl-4">
          {erros.map((frase) => (
            <li key={frase}>{frase}</li>
          ))}
        </ul>
      )}
    </Aviso>
  )
}

/** "Salvo às 10:32" — some sozinho não, some na próxima edição. */
function Confirmacao({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <Aviso tom="bom">
      <span className="inline-flex items-center gap-1.5">
        <Check size={14} aria-hidden="true" />
        {texto}
      </span>
    </Aviso>
  )
}

/** Extrai a frase de uma falha qualquer, sem deixar `[object Object]` na tela. */
function fraseDe(falha: unknown, padrao: string): string {
  return falha instanceof Error ? falha.message : padrao
}

/*
 * O FORMULÁRIO DO LOCAL mora em `components/FormularioDoLocal.tsx` (quem
 * mediu, mapa, porcentagem de "fora", medição com várias leituras e aviso de
 * coordenada trocada).
 */

/* ------------------------------------------------------------------ */
/* Formulário da empresa                                               */
/* ------------------------------------------------------------------ */

function rascunhoDaEmpresa(configuracao: ConfiguracaoDoPonto | null): RascunhoDaEmpresa {
  return {
    razaoSocial: configuracao?.razaoSocial ?? '',
    nomeFantasia: configuracao?.nomeFantasia ?? '',
    // Com máscara no campo: é assim que o CNPJ é lido em voz alta e conferido
    // contra um cartão. O banco guarda só os dígitos, e a conversão é do
    // `validarEmpresa`.
    cnpj: formatarCnpj(configuracao?.cnpj ?? null),
    endereco: configuracao?.endereco ?? '',
    cidade: configuracao?.cidade ?? '',
    uf: configuracao?.uf ?? '',
  }
}

function FormularioDaEmpresa({
  inicial,
  aoSalvar,
}: {
  inicial: ConfiguracaoDoPonto | null
  aoSalvar: (configuracao: ConfiguracaoDoPonto) => void
}) {
  const [rascunho, setRascunho] = useState<RascunhoDaEmpresa>(() => rascunhoDaEmpresa(inicial))
  const [erros, setErros] = useState<string[]>([])
  const [salvo, setSalvo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  function mudar(campo: keyof RascunhoDaEmpresa, valor: string) {
    setRascunho((antes) => ({ ...antes, [campo]: valor }))
    setSalvo(null)
  }

  async function gravar() {
    const leitura = validarEmpresa(rascunho)
    if (!leitura.ok) {
      setErros(leitura.erros)
      setSalvo(null)
      return
    }

    setErros([])
    setSalvando(true)
    try {
      const gravada = await salvarEmpresa(leitura.valor)
      setRascunho(rascunhoDaEmpresa(gravada))
      aoSalvar(gravada)
      const faltando = camposFaltandoDaEmpresa(gravada)
      setSalvo(
        faltando.length === 0
          ? 'Dados da empresa salvos. O cabeçalho da folha está completo.'
          : `Dados da empresa salvos. Ainda falta preencher: ${faltando.join(', ')}.`,
      )
    } catch (falha) {
      setErros([fraseDe(falha, 'Não deu para salvar os dados da empresa.')])
      setSalvo(null)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Cartao>
      <Secao
        icone={<Building2 size={16} aria-hidden="true" />}
        titulo="Dados da empresa"
        descricao="O cabeçalho da folha de ponto que o funcionário assina. Campo em branco imprime em branco — deixar vazio é melhor do que inventar."
      />

      <div className="space-y-3">
        <Campo
          id="empresa-razao"
          rotulo="Razão social"
          value={rascunho.razaoSocial}
          onChange={(evento) => mudar('razaoSocial', evento.target.value)}
          placeholder="como está no contrato social"
        />
        <Campo
          id="empresa-fantasia"
          rotulo="Nome de fantasia"
          value={rascunho.nomeFantasia}
          onChange={(evento) => mudar('nomeFantasia', evento.target.value)}
          placeholder="Empresa Exemplo"
        />
        <Campo
          id="empresa-cnpj"
          rotulo="CNPJ"
          inputMode="numeric"
          value={rascunho.cnpj}
          onChange={(evento) => mudar('cnpj', evento.target.value)}
          placeholder="00.000.000/0000-00"
        />
        <Campo
          id="empresa-endereco"
          rotulo="Endereço"
          value={rascunho.endereco}
          onChange={(evento) => mudar('endereco', evento.target.value)}
          placeholder="rua, número e bairro"
        />
        {/* Cidade e UF continuam sempre na mesma linha: `5rem` é a largura de
            duas letras com folga, e sobram 150 px para a cidade mesmo em 320 px.
            Empilhar a UF sozinha numa linha inteira seria desperdício. */}
        <div className="grid grid-cols-[1fr_4.5rem] gap-2 sm:grid-cols-[1fr_5rem] sm:gap-3">
          <Campo
            id="empresa-cidade"
            rotulo="Cidade"
            value={rascunho.cidade}
            onChange={(evento) => mudar('cidade', evento.target.value)}
            placeholder="Campinas"
          />
          <Campo
            id="empresa-uf"
            rotulo="UF"
            maxLength={2}
            value={rascunho.uf}
            onChange={(evento) => mudar('uf', evento.target.value)}
            placeholder="SP"
          />
        </div>

        <Recusas erros={erros} />
        <Confirmacao texto={salvo} />

        <Botao onClick={() => void gravar()} disabled={salvando}>
          <Save size={16} aria-hidden="true" />
          {salvando ? 'Salvando…' : 'Salvar os dados da empresa'}
        </Botao>
      </div>
    </Cartao>
  )
}

/* ------------------------------------------------------------------ */
/* Formulário das regras de jornada                                    */
/* ------------------------------------------------------------------ */

function rascunhoDaJornada(configuracao: ConfiguracaoDoPonto | null): RascunhoDaJornada {
  return {
    cargaDiaria: escreverDuracao(configuracao?.cargaDiariaMinutos ?? 480),
    toleranciaMinutos: String(configuracao?.toleranciaMinutos ?? 10),
    janelaDuplicidadeSegundos: String(configuracao?.janelaDuplicidadeSegundos ?? 60),
  }
}

function FormularioDaJornada({
  inicial,
  aoSalvar,
}: {
  inicial: ConfiguracaoDoPonto | null
  aoSalvar: (configuracao: ConfiguracaoDoPonto) => void
}) {
  const [rascunho, setRascunho] = useState<RascunhoDaJornada>(() => rascunhoDaJornada(inicial))
  const [erros, setErros] = useState<string[]>([])
  const [salvo, setSalvo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  function mudar(campo: keyof RascunhoDaJornada, valor: string) {
    setRascunho((antes) => ({ ...antes, [campo]: valor }))
    setSalvo(null)
  }

  async function gravar() {
    const leitura = validarJornada(rascunho)
    if (!leitura.ok) {
      setErros(leitura.erros)
      setSalvo(null)
      return
    }

    setErros([])
    setSalvando(true)
    try {
      const gravada = await salvarJornada(leitura.valor)
      setRascunho(rascunhoDaJornada(gravada))
      aoSalvar(gravada)
      setSalvo(
        `Regras salvas. A janela de ${gravada.janelaDuplicidadeSegundos} segundos já vale na próxima batida.`,
      )
    } catch (falha) {
      setErros([fraseDe(falha, 'Não deu para salvar as regras de jornada.')])
      setSalvo(null)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Cartao>
      <Secao
        icone={<Clock size={16} aria-hidden="true" />}
        titulo="Regras de jornada"
        descricao="A janela de duplicidade é lida pelo servidor a cada batida — muda aqui, vale na próxima."
      />

      <div className="space-y-3">
        <Campo
          id="jornada-carga"
          rotulo="Carga diária esperada (horas:minutos)"
          value={rascunho.cargaDiaria}
          onChange={(evento) => mudar('cargaDiaria', evento.target.value)}
          placeholder="08:00"
        />
        <Campo
          id="jornada-tolerancia"
          rotulo="Tolerância, em minutos"
          inputMode="numeric"
          value={rascunho.toleranciaMinutos}
          onChange={(evento) => mudar('toleranciaMinutos', evento.target.value)}
          placeholder="10"
        />
        {/*
          A CARGA E A TOLERÂNCIA SÃO SÓ GUARDADAS. Nenhuma conta do app as lê:
          `horas.ts` soma os pares de batidas, e a folha, o espelho, o painel e
          o CSV saem dessa soma. A tela diz isso para não prometer saldo,
          atraso ou hora extra que ninguém calcula.
        */}
        <p className="text-[0.68rem] leading-relaxed text-faint">
          A carga diária e a tolerância ficam guardadas, mas ainda não entram em conta nenhuma: o
          app não calcula saldo de horas, minutos de atraso nem hora extra. A folha soma só as
          horas trabalhadas.
        </p>
        <Campo
          id="jornada-janela"
          rotulo="Janela que recusa batida repetida, em segundos"
          inputMode="numeric"
          value={rascunho.janelaDuplicidadeSegundos}
          onChange={(evento) => mudar('janelaDuplicidadeSegundos', evento.target.value)}
          placeholder="60"
        />
        <p className="text-[0.68rem] leading-relaxed text-faint">
          A janela existe para o dedo tremido e para o reenvio do app numa rede ruim. Ela não pode
          ser desligada: o banco recusa menos de 10 segundos, e acima de 900 ela passaria a barrar
          batida legítima de quem saiu e voltou.
        </p>

        <Recusas erros={erros} />
        <Confirmacao texto={salvo} />

        <Botao onClick={() => void gravar()} disabled={salvando}>
          <Save size={16} aria-hidden="true" />
          {salvando ? 'Salvando…' : 'Salvar as regras'}
        </Botao>
      </div>
    </Cartao>
  )
}

/* ------------------------------------------------------------------ */
/* A tela                                                              */
/* ------------------------------------------------------------------ */

export function Administracao() {
  const navegar = useNavigate()
  const [dados, setDados] = useState<Dados>(VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [tentativa, setTentativa] = useState(0)
  // O resumo vem da lista de pessoas, da mesma leitura (`aoResumir`).
  const [resumoDePessoas, setResumoDePessoas] = useState<Contagem<ResumoDePessoas>>({
    estado: 'carregando',
  })

  useEffect(() => {
    let vivo = true
    void buscar().then((resultado) => {
      if (!vivo) return
      setDados(resultado)
      setCarregando(false)
    })
    return () => {
      vivo = false
    }
  }, [tentativa])

  /*
   * A lista do que falta vive no TOPO e é atualizada por quem salva a empresa.
   * A área de administração avisa o que falta — e avisar
   * embaixo do formulário, depois de rolar a tela inteira, é avisar quem já
   * está olhando. Quem abre a tela precisa ver a pendência antes de decidir o
   * que fazer nela.
   */
  const faltando = dados.configuracao ? camposFaltandoDaEmpresa(dados.configuracao) : []

  function trocarConfiguracao(configuracao: ConfiguracaoDoPonto) {
    setDados((antes) => ({ ...antes, configuracao }))
  }

  function trocarLocal(local: LocalDoPonto) {
    setDados((antes) => ({ ...antes, local }))
  }

  const leituraDaConfiguracao: EntradaDoInicio['configuracao'] = dados.erro
    ? { estado: 'falhou' }
    : carregando
      ? { estado: 'carregando' }
      : { estado: 'pronto', valor: { configuracao: dados.configuracao, local: dados.local } }

  return (
    <Pagina largura="ampla">
      <header className="flex items-center justify-between">
        <button
          onClick={() => navegar('/painel')}
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-mute transition-colors hover:text-plat-dim"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Painel
        </button>
        <MarcaDoTopo />
      </header>

      {/* `max-w-2xl` no texto de abertura: no computador a página tem 1024 px,
          e um parágrafo de 1024 px de largura é ilegível — o olho perde a linha
          na volta. A régua de leitura não é a da página. */}
      <div className="mt-8 max-w-2xl">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
          Área de administração
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-plat">
          Administração do ponto
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-mute">
          Pessoas, local de trabalho, empresa e jornada, sem SQL nem deploy. Só quem
          administra o ponto grava aqui, e contas, vínculos e administradores são do super admin —
          quem confere isso é o banco, a cada gravação.
        </p>
      </div>

      <main className="mt-6 flex-1 space-y-4">
        {/*
          A PÁGINA INICIAL: os seis contadores, antes de tudo. É a
          resposta a "tem alguma coisa esperando por mim?", que é a pergunta de
          quem abre a administração no celular.
        */}
        <InicioDaAdministracao pessoas={resumoDePessoas} configuracao={leituraDaConfiguracao} />

        {/*
          O QUE FALTA NO CABEÇALHO DA FOLHA FICA ACIMA DE TUDO, inclusive da
          lista de pessoas: uma seção nova acima dele o empurraria para baixo
          da dobra. Avisar depois de
          rolar a tela inteira é avisar quem já está olhando; quem abre a tela
          precisa ver a pendência antes de decidir o que fazer nela.

          `faltando` é `[]` enquanto a configuração não chega e quando ela falha,
          então este bloco simplesmente não aparece nesses dois casos — sem
          precisar de um `carregando` próprio.
        */}
        {faltando.length > 0 && (
          <Aviso tom="atencao">
            <span className="inline-flex items-start gap-1.5">
              <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                A folha de ponto vai imprimir com o cabeçalho incompleto: falta{' '}
                {faltando.join(', ')}.
              </span>
            </span>
          </Aviso>
        )}

        {/*
          A lista de pessoas carrega SOZINHA, fora do `carregando` desta tela.
          É de propósito: ela lê seis consultas (contas, fichas, administradores,
          super admins, estado do PIN e as batidas do período), e prendê-la ao
          mesmo estado dos três formulários faria a configuração da empresa
          esperar a leitura do mês inteiro para aparecer. As duas metades falham
          por motivos diferentes e cada uma mostra o seu erro.

          As fichas dos funcionários moram na lista de pessoas, e não numa
          seção própria: a ficha sem conta é uma pessoa sem conta, e é na linha
          dela que o super admin a liga à conta certa.
        */}
        {/* `scroll-mt-4`: o cartão da página inicial rola até aqui sem colar o
            título na borda da tela. */}
        <div id={ID_DA_SECAO.pessoas} className="scroll-mt-4">
          <ListaDePessoas aoResumir={setResumoDePessoas} />
        </div>

        {/*
          `ID_DA_SECAO.configuracao` nos dois blocos que ocupam o lugar dos
          formulários enquanto eles não estão na tela: o erro e o "Carregando…".
          É para onde os cartões do local, da empresa e da jornada rolam nesses
          dois casos: o botão do cartão sempre tem um bloco na tela para onde ir.
        */}
        {dados.erro && (
          <div id={ID_DA_SECAO.configuracao} className="scroll-mt-4 space-y-2">
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

        {!dados.erro && carregando && (
          <p id={ID_DA_SECAO.configuracao} className="scroll-mt-4 text-sm text-mute">
            Carregando…
          </p>
        )}

        {!dados.erro && !carregando && (
          <>
            {/*
              OS TRÊS FORMULÁRIOS, LADO A LADO A PARTIR DE 1024 px.

              `lg:items-start` é o que impede o cartão mais curto (jornada) de
              esticar até a altura do mais alto (local, que tem o botão de
              captura e a explicação). Três cartões de alturas diferentes lidos
              lado a lado são três assuntos; três cartões esticados até a mesma
              altura parecem um formulário só, com um botão "Salvar" em cada
              rodapé — que é exatamente a leitura errada.

              Em coluna única, o `grid gap-4` empilha os cartões com o mesmo
              espaço de um `space-y-4`: no celular, é uma pilha comum.
            */}
            <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
              <div id={ID_DA_SECAO.local} className="scroll-mt-4">
                <FormularioDoLocal inicial={dados.local} aoSalvar={trocarLocal} />
              </div>
              <div id={ID_DA_SECAO.empresa} className="scroll-mt-4">
                <FormularioDaEmpresa inicial={dados.configuracao} aoSalvar={trocarConfiguracao} />
              </div>
              <div id={ID_DA_SECAO.jornada} className="scroll-mt-4">
                <FormularioDaJornada inicial={dados.configuracao} aoSalvar={trocarConfiguracao} />
              </div>
            </div>

            {dados.configuracao?.atualizadoEm && (
              <p className="text-center text-[0.68rem] text-faint">
                Última alteração da configuração em{' '}
                {formatarMomento(dados.configuracao.atualizadoEm)}.
              </p>
            )}
          </>
        )}
      </main>

      <footer className="mt-10 text-center">
        <p className="mx-auto max-w-2xl text-[0.68rem] leading-relaxed text-faint">
          Reduzir o raio não reescreve o passado: cada batida guarda a distância e a marca
          dentro/fora calculadas no momento em que foi gravada.
        </p>
      </footer>
    </Pagina>
  )
}
