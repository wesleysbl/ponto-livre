import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarCheck,
  CalendarDays,
  Camera,
  Clock,
  LogOut,
  MapPinOff,
  PencilLine,
  RotateCcw,
  SlidersHorizontal,
  Users,
  WifiOff,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { ConfirmacaoDePin } from '../components/ConfirmacaoDePin'
import { CapturaDeSelfie } from '../components/CapturaDeSelfie'
import { Comprovante } from '../components/Comprovante'
import { BatidasDoDia } from '../components/BatidasDoDia'
import { MeusPedidosDeAtraso } from '../components/MeusPedidosDeAtraso'
import {
  FormularioDeAtraso,
  ReciboDoPedido,
  type DadosDoFormulario,
} from '../components/PedidoDeAtraso'
import { MarcaDoTopo } from '../components/Marca'
import { Aviso, Botao, Painel } from '../components/ui'
import { marcaDoApp } from '../lib/marca-do-app'
import {
  ErroDeLocalizacao,
  pedirCoordenada,
  podeBaterSemLocalizacao,
  type LocalDaBatida,
} from '../lib/localizacao'
import {
  diaCivilDeHoje,
  ErroDeBatida,
  ErroDoPedido,
  formatarHora,
  lerBatidasDoDia,
  pedirBatidaEmAtraso,
  registrarBatida,
  type Batida,
  type PedidoGravado,
} from '../lib/batidas'
import {
  descricaoDoPin,
  deveVoltarAoInicio,
  preverBotao,
  rodapeDaFalhaDeLocalizacao,
  textoDaConfirmacaoDaExtra,
  textoDaFalhaDeLocalizacao,
  textoDeBaterSemLocalizacao,
  valeTentarALocalizacaoDeNovo,
  type FalhaQueValeTentarDeNovo,
} from '../lib/tela-de-bater'
import { aprovadoresDosPedidos, momentoDaHoraDeHoje, pedidosPendentes, type PedidoDeAtraso } from '../lib/atraso'
import { rotuloDoCorrigirPonto } from '../lib/corrigir'
import { lerMeusPedidos, lerNomesDeQuemDecidiu, lerPedidosPendentes } from '../lib/pedidos'
import { BATIDA_INCERTA, PEDIDO_INCERTO } from '../lib/descarte'
import { podeBater, primeiroNomeDaConta, rotuloDaConta, ROTULO_SEM_CARGO } from '../lib/acesso'
import { formatarEspera, segundosDeTrava } from '../lib/pin'

/*
 * A TELA DA BATIDA.
 *
 * A ORDEM DOS PASSOS NÃO É ESTÉTICA
 *   selfie -> localização -> PIN -> gravação
 * As duas permissões vêm primeiro porque são as que podem ser NEGADAS, e negar
 * qualquer uma delas tem que terminar sem nada gravado — nem foto no bucket,
 * nem linha na tabela. Só depois de as duas responderem é que o PIN é pedido,
 * porque ele é o último passo antes de gravar: pedir o PIN antes faria a pessoa
 * digitar quatro dígitos para descobrir em seguida que a câmera estava
 * bloqueada. E a gravação só acontece depois de tudo isso reunido.
 *
 * O PIN É CONFERIDO DUAS VEZES, E ISSO É DE PROPÓSITO
 * `ConfirmacaoDePin` confere pelo servidor (`ponto_verificar_pin`) para poder
 * mostrar "faltam N tentativas" e a contagem regressiva da trava. Depois,
 * `ponto_registrar_batida` confere DE NOVO, dentro da transação que grava —
 * porque a primeira conferência é da tela, e tela não é segurança: sem a
 * segunda, quem chamasse a API direto bateria ponto sem PIN. A segunda
 * conferência é a que vale. As duas usam a mesma
 * contagem de tentativas do banco, então não existe contador paralelo.
 * O custo é uma verificação bcrypt a mais por batida — cerca de 100 ms.
 *
 * A BATIDA EM ATRASO É O MESMO FLUXO COM UMA PORTA ANTES
 *   horário e motivo -> selfie -> localização -> PIN -> pedido
 * Quem esqueceu de bater escolhe o horário (só hoje, antes de agora) e escreve o
 * motivo; daí em diante os passos são os da batida, pelas mesmas razões. O que
 * se grava não é batida: é um PEDIDO (`ponto_pedir_batida_em_atraso`), que só
 * vira batida quando um administrador aprova. A etapa carrega `atraso` (nulo na
 * batida comum) e é isso que decide, no fim, qual RPC chamar e qual recibo
 * mostrar.
 *
 * OFFLINE NÃO EXISTE AQUI
 * Sem internet a batida não acontece e a tela diz isso. Nada de fila local
 * fingindo que gravou: num sistema que serve de prova trabalhista, "achei que
 * tinha batido" é pior do que "não bateu". O aviso vem ANTES da selfie: a
 * tela ouve `online`/`offline`, e
 * sem conexão o botão fica desabilitado, com "aguardando internet". O aviso
 * não guarda nada para depois; a conexão voltou, o botão volta.
 *
 * QUEM NÃO BATE NÃO VÊ O BOTÃO DE BATER
 * No banco do ponto, entrar e bater são degraus diferentes: quem administra
 * sem ficha (o RH, por exemplo) entra e não bate. Para essa conta, esta tela
 * troca o botão de bater, a batida em atraso, a lista do dia e o espelho pelo
 * caminho do painel — e o banco recusaria a batida de qualquer jeito. A linha
 * de cima da saudação diz o cargo da ficha, ou "Administração do ponto"; o
 * nome e o cargo vêm de `ponto_meu_acesso()`.
 *
 * BATER NO CELULAR SEM RECOMEÇAR NEM LEVAR SUSTO
 *  • O GPS que não respondeu (ou demorou) não joga a selfie fora: a etapa
 *    `localizacao_falhou` guarda a foto — que ainda não subiu, porque o envio
 *    só acontece depois do PIN — e "Tentar a localização de novo" pede a
 *    coordenada no modo rápido, indo direto ao PIN. Permissão negada segue no
 *    erro.
 *
 * BATER SEM LOCALIZAÇÃO
 * Na mesma `localizacao_falhou` — e só nela, isto é, só quando o GPS não
 * respondeu —, "Bater sem localização" leva ao PIN com a MESMA selfie, e a
 * gravação vai sem coordenada, com o motivo da falha em `p_sem_localizacao`.
 * A selfie e o PIN continuam obrigatórios (o banco exige a foto). Permissão
 * negada, sem HTTPS e sem suporte não chegam a essa etapa: continuam no erro,
 * com o "como liberar". Vale igual para o pedido de batida em atraso. A etapa
 * do PIN carrega `local` — a coordenada, ou o motivo de não ter —, e é ele que
 * vira os parâmetros da RPC (`argumentosDaLocalizacao`).
 *  • O app reaberto relê as batidas e os pedidos de hoje, e volta ao início
 *    quando o dia mudou ou depois de 10 minutos numa etapa final — nunca no
 *    meio de um passo (`deveVoltarAoInicio`, em `lib/tela-de-bater.ts`).
 *  • O botão diz qual batida a ordem do dia prevê ("Bater volta do almoço",
 *    "3ª de 4 hoje"). É só a previsão: o tipo continua saindo do servidor, e o
 *    botão diz "Bater ponto" quando a previsão pode errar.
 *  • Com o dia completo, uma batida a mais pede confirmação antes da câmera.
 */

/** Nulo na batida comum; o horário e o motivo, no pedido de batida em atraso. */
type Atraso = DadosDoFormulario | null

/*
 * O NOME DE CADA ETAPA TEM DE ESTAR NUMA DAS LISTAS de `lib/tela-de-bater.ts`
 * (as que nunca voltam sozinhas ao início e as finais): `deveVoltarAoInicio`
 * recebe `etapa.nome` com o tipo daquelas listas, e uma etapa nova fora delas
 * para o build.
 */
type Etapa =
  | { nome: 'inicio' }
  | { nome: 'atraso'; inicial?: DadosDoFormulario }
  /** "Você já fechou o dia": a batida depois do dia completo pede confirmação. */
  | { nome: 'confirmar_extra' }
  | { nome: 'camera'; atraso: Atraso }
  /** `rapida`: a segunda tentativa, depois de o GPS não responder. */
  | { nome: 'localizando'; foto: Blob; atraso: Atraso; rapida: boolean }
  /** O GPS não respondeu: a foto fica guardada para tentar de novo. `tentativas`: quantas falharam. */
  | {
      nome: 'localizacao_falhou'
      foto: Blob
      atraso: Atraso
      motivo: FalhaQueValeTentarDeNovo
      tentativas: number
    }
  /** `local`: a coordenada, ou — quando o GPS não respondeu e a pessoa escolheu — o motivo de bater sem ela. */
  | { nome: 'pin'; foto: Blob; local: LocalDaBatida; atraso: Atraso }
  | { nome: 'gravando'; atraso: Atraso }
  | { nome: 'comprovante'; batida: Batida }
  | { nome: 'pedido_enviado'; pedido: PedidoGravado }
  /**
   * `incerto`: a resposta da gravação se perdeu e a batida (ou o pedido, com
   * `atraso`) PODE ter sido gravada. A tela não diz "nada foi gravado" — manda
   * conferir a lista.
   */
  | { nome: 'erro'; mensagem: string; comoResolver: string | null; atraso: Atraso; incerto?: boolean }

/*
 * A leitura da lista mora FORA do componente, e devolve o erro como valor em
 * vez de lançar. Assim o efeito que a dispara não precisa de try/catch nem de
 * um `setState` no próprio corpo — o que a regra `set-state-in-effect` recusa,
 * e com razão: seria uma cascata de renders a cada montagem.
 */
async function buscarListaDoDia(
  usuarioId: string,
): Promise<{ batidas: Batida[]; erro: string | null }> {
  try {
    return { batidas: await lerBatidasDoDia(usuarioId), erro: null }
  } catch (falha) {
    return {
      batidas: [],
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar suas batidas de hoje.',
    }
  }
}

/**
 * Os pedidos de batida em atraso de hoje, e os nomes de quem os decidiu — no
 * mesmo molde: o erro volta como valor. Falhar aqui não esconde as batidas; a
 * seção dos pedidos mostra o erro dela.
 *
 * OS NOMES SÓ PARA QUEM ADMINISTRA: eles vêm
 * da lista de contas do ponto, que o banco só entrega a quem administra. Para
 * o colaborador a leitura seria uma recusa certa; a decisão dele sai sem o
 * nome ("Aprovado. Já está no seu ponto.").
 */
async function buscarPedidosDoDia(usuarioId: string, administra: boolean): Promise<{
  pedidos: PedidoDeAtraso[]
  nomes: Map<string, string>
  erro: string | null
}> {
  try {
    const hoje = diaCivilDeHoje()
    const pedidos = await lerMeusPedidos(usuarioId, hoje, hoje)
    return { pedidos, nomes: administra ? await lerNomesDeQuemDecidiu(pedidos) : new Map(), erro: null }
  } catch (falha) {
    return {
      pedidos: [],
      nomes: new Map(),
      erro:
        falha instanceof Error ? falha.message : 'Não deu para carregar seus pedidos de hoje.',
    }
  }
}

/**
 * O lugar do botão de bater, para quem entra e não bate: quem administra o
 * ponto sem ficha. A tela diz o que esta conta
 * faz e por que não há botão — em vez de um botão que o banco recusaria.
 * O caminho do painel é o "Corrigir ponto" logo acima e as portas do pé.
 */
function ContaQueNaoBate({ administra }: { administra: boolean }) {
  return (
    <Painel className="text-center">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
        Esta conta não bate ponto
      </p>
      <p className="mt-2 text-lg font-semibold tracking-tight text-plat">
        {administra ? 'Você administra o ponto' : 'Sem batida por esta conta'}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-mute">
        {administra
          ? 'No painel você corrige batidas, decide os pedidos de batida em atraso e fecha o mês. Para bater ponto, esta conta precisaria de uma ficha de funcionário ativa.'
          : 'Para bater ponto, esta conta precisa de uma ficha de funcionário ativa. Fale com quem cuida do ponto na sua empresa.'}
      </p>
    </Painel>
  )
}

/** Espera com nome: quem está de pé no corredor precisa saber o que trava. */
function PainelDeEspera({
  titulo,
  detalhe,
  children,
}: {
  titulo: string
  detalhe: string
  children?: ReactNode
}) {
  return (
    <Painel className="text-center">
      <div
        className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-hair-3 border-t-luz"
        role="status"
        aria-label={titulo}
      />
      <h2 className="mt-5 text-base font-semibold text-plat">{titulo}</h2>
      <p className="mt-2 text-sm leading-relaxed text-mute">{detalhe}</p>
      {children}
    </Painel>
  )
}

/** Depois de quanto tempo a espera da localização diz que pode demorar, e oferece "Cancelar". */
const SEGUNDOS_ATE_AVISAR_A_DEMORA = 6

/**
 * A espera da localização. A frase diz que a DISTÂNCIA não bloqueia; o que
 * acontece se o GPS não responder é a tela seguinte que diz (tentar de novo,
 * ou bater sem localização). Depois de 6 s, a tela avisa quanto pode levar (o prazo do
 * pedido) e oferece "Cancelar" — a resposta que ainda vier do GPS é ignorada
 * (`pedidoDeLocalizacao`, na tela).
 */
function EsperaDaLocalizacao({ rapida, aoCancelar }: { rapida: boolean; aoCancelar: () => void }) {
  const [demorando, setDemorando] = useState(false)
  useEffect(() => {
    const relogio = setTimeout(() => setDemorando(true), SEGUNDOS_ATE_AVISAR_A_DEMORA * 1000)
    return () => clearTimeout(relogio)
  }, [])

  return (
    <PainelDeEspera
      titulo="Buscando sua localização"
      detalhe="A distância até o local não bloqueia a batida."
    >
      {demorando && (
        <>
          <p className="mt-3 text-xs leading-relaxed text-mute">
            Em lugar fechado pode levar até {rapida ? 15 : 20} segundos.
          </p>
          <div className="mt-4">
            <Botao tom="discreto" onClick={aoCancelar}>
              Cancelar
            </Botao>
          </div>
        </>
      )}
    </PainelDeEspera>
  )
}

/**
 * "Não achamos sua localização": o GPS não
 * respondeu, ou demorou, e a selfie já tirada continua guardada. O caminho
 * principal tenta a localização de novo, no modo rápido, e vai direto ao PIN;
 * tirar outra foto e cancelar ficam embaixo.
 *
 * "BATER SEM LOCALIZAÇÃO" vem logo depois do
 * "tentar de novo", como botão secundário, com a linha que diz o que acontece:
 * a batida sai com a foto e o PIN, marcada como sem localização. Só aparece com
 * `aoBaterSemLocalizacao` e quando o motivo deixa (`podeBaterSemLocalizacao`:
 * o GPS que não respondeu). No pedido de batida em atraso, o mesmo botão fala
 * do pedido.
 */
export function FalhaDeLocalizacao({
  motivo,
  tentativas = 1,
  doPedido = false,
  aoTentarDeNovo,
  aoBaterSemLocalizacao,
  aoTirarOutraFoto,
  aoCancelar,
}: {
  motivo: FalhaQueValeTentarDeNovo
  /** Quantas tentativas já falharam: da segunda em diante, o texto muda. */
  tentativas?: number
  /** No pedido de batida em atraso, o rodapé e o botão sem localização falam do pedido. */
  doPedido?: boolean
  aoTentarDeNovo: () => void
  /** Segue para o PIN com a mesma selfie, sem coordenada. Sem ele, o botão não aparece. */
  aoBaterSemLocalizacao?: () => void
  aoTirarOutraFoto: () => void
  aoCancelar: () => void
}) {
  const semLocalizacao = textoDeBaterSemLocalizacao(doPedido)
  const podeSeguirSem = aoBaterSemLocalizacao !== undefined && podeBaterSemLocalizacao(motivo)

  return (
    <Painel>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-warn">
        <MapPinOff size={22} aria-hidden="true" />
      </div>
      <h2 className="text-center text-lg font-semibold text-plat">Não achamos sua localização</h2>
      <p className="mt-2 text-center text-sm leading-relaxed text-plat-dim">
        {textoDaFalhaDeLocalizacao(motivo, tentativas)}
      </p>
      <p className="mt-3 text-center text-xs leading-relaxed text-mute">
        Sua selfie está guardada: tentar de novo não abre a câmera.
      </p>
      <div className="mt-6 space-y-2">
        <Botao onClick={aoTentarDeNovo}>
          <RotateCcw size={16} aria-hidden="true" />
          Tentar a localização de novo
        </Botao>
        {podeSeguirSem && (
          <div>
            <Botao tom="secundario" onClick={aoBaterSemLocalizacao}>
              <MapPinOff size={16} aria-hidden="true" />
              {semLocalizacao.botao}
            </Botao>
            <p className="mt-1.5 mb-1 text-center text-xs leading-relaxed text-mute">{semLocalizacao.linha}</p>
          </div>
        )}
        <Botao tom="secundario" onClick={aoTirarOutraFoto}>
          <Camera size={16} aria-hidden="true" />
          Tirar outra foto
        </Botao>
        <Botao tom="discreto" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
      <p className="mt-4 text-center text-xs leading-relaxed text-faint">
        {rodapeDaFalhaDeLocalizacao(doPedido)}
      </p>
    </Painel>
  )
}

/**
 * "Você já fechou o dia": com o dia completo
 * (4 batidas, ou outro número par a partir de 4), a batida a mais pede
 * confirmação ANTES da câmera. Não é trava: "Bater mesmo assim" segue o fluxo
 * de sempre, e o tipo continua saindo do servidor.
 */
export function ConfirmacaoDaExtra({
  batidas,
  aoVoltar,
  aoConfirmar,
}: {
  batidas: readonly Batida[]
  aoVoltar: () => void
  aoConfirmar: () => void
}) {
  return (
    <Painel>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-luz-soft text-luz">
        <CalendarCheck size={22} aria-hidden="true" />
      </div>
      <h2 className="text-center text-lg font-semibold text-plat">Você já fechou o dia</h2>
      <p className="mt-2 text-center text-sm leading-relaxed text-mute">{textoDaConfirmacaoDaExtra(batidas)}</p>
      <div className="mt-6 space-y-2">
        <Botao onClick={aoVoltar}>Voltar</Botao>
        <Botao tom="secundario" onClick={aoConfirmar}>
          Bater mesmo assim
        </Botao>
      </div>
    </Painel>
  )
}

/** "07:58": a hora de agora no fuso do ponto, para "Atualizado às". */
function horaDeAgora(): string {
  return formatarHora(new Date().toISOString())
}

/**
 * Quantos pedidos de batida em atraso esperam decisão — a contagem do botão
 * "Corrigir ponto". A mesma leitura da caixa
 * de pendências do painel (`lerPedidosPendentes`, todos os pendentes, de
 * qualquer dia).
 *
 * DE MELHOR ESFORÇO, E NUNCA LEVANTA: falhou, o botão fica sem a contagem e
 * continua levando ao painel, onde a caixa de pendências diz o erro dela.
 */
async function contarPedidosEsperando(): Promise<number | null> {
  try {
    return pedidosPendentes(await lerPedidosPendentes()).length
  } catch (falha) {
    console.warn('Os pedidos esperando decisão não foram lidos; o botão sai sem a contagem:', falha)
    return null
  }
}

export function Bater() {
  const navegar = useNavigate()
  const { usuario, acesso, administracao, sair, recarregar } = useAuth()

  const [etapa, setEtapa] = useState<Etapa>({ nome: 'inicio' })
  const [miniatura, setMiniatura] = useState<string | null>(null)

  const [batidas, setBatidas] = useState<Batida[]>([])
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [erroDaLista, setErroDaLista] = useState<string | null>(null)

  const [pedidos, setPedidos] = useState<PedidoDeAtraso[]>([])
  const [nomes, setNomes] = useState<Map<string, string>>(() => new Map())
  const [erroDosPedidos, setErroDosPedidos] = useState<string | null>(null)
  const [tentativaDosPedidos, setTentativaDosPedidos] = useState(0)
  /** A primeira leitura dos pedidos já respondeu: até lá, o botão não prevê o tipo. */
  const [pedidosLidos, setPedidosLidos] = useState(false)

  /** "HH:MM" da última leitura da lista que deu certo — "Atualizado às". */
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null)
  /** O aparelho diz que tem conexão? Sem ela, o aviso vem antes da selfie. */
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)

  /*
   * AS REFERÊNCIAS DA TELA — nenhuma delas desenha.
   *
   * `versaoDaLista`: cada leitura da lista leva um número, e só a mais nova
   * escreve na tela. Sem isso, a releitura que saiu antes de uma batida podia
   * chegar depois dela e apagar a batida recém-gravada da lista.
   * `diaDaLista`: o dia civil da última leitura — é por ele que o app reaberto
   * sabe que o dia mudou.
   * `listaBoa`: o que está na tela veio do servidor sem erro. A releitura em
   * silêncio que falha não apaga uma lista boa.
   * `pedidoDeLocalizacao`: cada pedido ao GPS leva um número; cancelar (ou
   * voltar ao início) muda o número, e a resposta atrasada não leva a tela a
   * lugar nenhum.
   * `etapaDesde`: quando a tela entrou na etapa de agora, para os 10 minutos.
   */
  const versaoDaLista = useRef(0)
  const diaDaLista = useRef<string | null>(null)
  const listaBoa = useRef(false)
  const pedidoDeLocalizacao = useRef(0)
  const etapaDesde = useRef(0)

  /** Quem administra o ponto, pela pergunta do banco (`ponto_meu_acesso`). Enquanto ela não responde, falso. */
  const administra = administracao.estado === 'ok' && administracao.administra
  /** Pedidos de atraso esperando decisão, para o botão "Corrigir ponto". `null`: ainda lendo, ou falhou. */
  const [pedidosEsperando, setPedidosEsperando] = useState<number | null>(null)

  // A RotaProtegida já garantiu sessão e acesso ao ponto antes de chegar aqui.
  const conta = acesso.estado === 'ok' ? acesso.acesso : null
  const usuarioId = usuario?.id ?? null
  /** Bate ponto (ficha que libera, ou super admin)? Quem só administra, não. */
  const bate = podeBater(acesso)
  /*
   * O nome que o banco dá à conta: o da ficha de RH, depois o nome guardado na
   * conta — nunca o e-mail. Uma conta de setor (`rh@`, `vendas@`) que passou de
   * uma pessoa para outra diz o nome de quem está com a ficha hoje, e não o de
   * quem criou a conta.
   */
  const saudacao = conta ? primeiroNomeDaConta(conta) : null
  const rotulo = conta ? rotuloDaConta(conta) : ROTULO_SEM_CARGO
  /* O pé da tela é o slogan configurado (VITE_SLOGAN_DO_APP); sem ele, a tela não tem pé. */
  const { slogan } = marcaDoApp()

  /*
   * As batidas e os pedidos de hoje só são lidos por quem bate: quem só
   * administra não tem lista do dia nesta tela, e não há por que perguntar.
   */
  useEffect(() => {
    if (!usuarioId || !bate) return
    // A guarda `vivo` evita escrever estado numa tela que já saiu — o caso
    // real é sair da conta enquanto a consulta ainda está a caminho.
    let vivo = true
    const versao = ++versaoDaLista.current
    const dia = diaCivilDeHoje()
    void buscarListaDoDia(usuarioId).then((resultado) => {
      if (!vivo || versao !== versaoDaLista.current) return
      setBatidas(resultado.batidas)
      setErroDaLista(resultado.erro)
      setCarregandoLista(false)
      diaDaLista.current = dia
      listaBoa.current = !resultado.erro
      if (!resultado.erro) setAtualizadoEm(horaDeAgora())
    })
    return () => {
      vivo = false
    }
  }, [usuarioId, bate])

  useEffect(() => {
    if (!usuarioId || !bate) return
    let vivo = true
    void buscarPedidosDoDia(usuarioId, administra).then((resultado) => {
      if (!vivo) return
      setPedidos(resultado.pedidos)
      setNomes(resultado.nomes)
      setErroDosPedidos(resultado.erro)
      setPedidosLidos(true)
    })
    return () => {
      vivo = false
    }
  }, [usuarioId, bate, administra, tentativaDosPedidos])

  /* A contagem só é lida para quem administra: o colaborador nem vê o botão. */
  useEffect(() => {
    if (!administra) return
    let vivo = true
    void contarPedidosEsperando().then((quantos) => {
      if (vivo) setPedidosEsperando(quantos)
    })
    return () => {
      vivo = false
    }
  }, [administra])

  /** Quem aprovou cada batida de atraso de hoje — para a marca na lista. */
  const aprovadores = aprovadoresDosPedidos(pedidos, nomes)

  /*
   * O QUE O BOTÃO DIZ: a previsão pela ordem do dia, só enquanto ela
   * não pode mentir. Os pedidos entram porque um pedido em atraso esperando,
   * quando aprovado, entra no meio do dia e muda o nome das batidas.
   */
  const previsao = preverBotao({
    carregando: carregandoLista || !pedidosLidos,
    erro: erroDaLista,
    batidas,
    pedidosPendentes: erroDosPedidos ? 0 : pedidosPendentes(pedidos).length,
  })

  /**
   * Releitura da lista de hoje.
   *  • `mostrando`: o "tentar de novo" da lista e a conferência depois de uma
   *    resposta perdida — a tela diz "Carregando…".
   *  • `do_zero`: o dia mudou — a lista de ontem sai da tela antes.
   *  • `em_silencio`: o app voltou a aparecer, ou a conexão voltou.
   *    A lista fica onde está e só muda se a leitura der certo; se falhar, a
   *    lista boa fica, e "Atualizado às" continua dizendo de quando ela é.
   */
  async function recarregarLista(modo: 'mostrando' | 'do_zero' | 'em_silencio' = 'mostrando') {
    if (!usuarioId) return
    const versao = ++versaoDaLista.current
    const dia = diaCivilDeHoje()
    if (modo === 'do_zero') {
      setBatidas([])
      setErroDaLista(null)
    }
    if (modo !== 'em_silencio') {
      listaBoa.current = false
      setCarregandoLista(true)
    }
    const resultado = await buscarListaDoDia(usuarioId)
    if (versao !== versaoDaLista.current) return
    if (modo === 'em_silencio' && resultado.erro && listaBoa.current) return
    setBatidas(resultado.batidas)
    setErroDaLista(resultado.erro)
    setCarregandoLista(false)
    diaDaLista.current = dia
    listaBoa.current = !resultado.erro
    if (!resultado.erro) setAtualizadoEm(horaDeAgora())
  }

  /* A etapa mudou: o relógio dos 10 minutos recomeça. */
  useEffect(() => {
    etapaDesde.current = Date.now()
  }, [etapa])

  /*
   * O APP REABERTO MOSTRA HOJE.
   *
   * O ouvinte é registrado uma vez; o que ele precisa saber de agora (a etapa,
   * quem bate) vem desta referência, atualizada a cada desenho — o mesmo
   * desenho do teclado do `Modal`, em `ui.tsx`.
   *
   * Ao voltar a aparecer, a tela relê as batidas e os pedidos de hoje e volta
   * ao início só quando `deveVoltarAoInicio` diz (dia mudou, ou 10 minutos
   * numa etapa final). A conexão que volta só relê, em silêncio.
   */
  const aoVoltarParaOApp = useRef<() => void>(() => {})
  const aoVoltarAConexao = useRef<() => void>(() => {})
  useEffect(() => {
    aoVoltarParaOApp.current = () => {
      if (!usuarioId || !bate) return
      const hoje = diaCivilDeHoje()
      const voltar = deveVoltarAoInicio({
        etapa: etapa.nome,
        desdeMs: etapaDesde.current,
        agoraMs: Date.now(),
        diaDaLeitura: diaDaLista.current,
        hoje,
      })
      if (voltar) voltarAoInicio()
      const virouODia = diaDaLista.current !== null && diaDaLista.current !== hoje
      void recarregarLista(virouODia ? 'do_zero' : 'em_silencio')
      setTentativaDosPedidos((n) => n + 1)
    }
    aoVoltarAConexao.current = () => {
      if (!usuarioId || !bate) return
      void recarregarLista('em_silencio')
    }
  })

  useEffect(() => {
    function aoMudarAVisibilidade() {
      // 'hidden' é o app indo para o fundo. Qualquer outro estado é ele de volta.
      if (document.visibilityState !== 'hidden') aoVoltarParaOApp.current()
    }
    function aoFicarOnline() {
      setOnline(true)
      aoVoltarAConexao.current()
    }
    function aoFicarOffline() {
      setOnline(false)
    }
    document.addEventListener('visibilitychange', aoMudarAVisibilidade)
    window.addEventListener('online', aoFicarOnline)
    window.addEventListener('offline', aoFicarOffline)
    return () => {
      document.removeEventListener('visibilitychange', aoMudarAVisibilidade)
      window.removeEventListener('online', aoFicarOnline)
      window.removeEventListener('offline', aoFicarOffline)
    }
  }, [])

  /*
   * A miniatura é um objectURL: sem revogar, cada batida deixa a foto inteira
   * presa na memória da aba até o app ser fechado. Este efeito revoga a
   * anterior quando uma nova entra e a última quando a tela sai.
   */
  useEffect(() => {
    if (!miniatura) return
    return () => URL.revokeObjectURL(miniatura)
  }, [miniatura])

  function falhar(mensagem: string, comoResolver: string | null = null, atraso: Atraso = null) {
    setEtapa({ nome: 'erro', mensagem, comoResolver, atraso })
  }

  function voltarAoInicio() {
    // Um pedido de localização ainda no ar não leva mais a tela ao PIN.
    pedidoDeLocalizacao.current++
    setMiniatura(null)
    setEtapa({ nome: 'inicio' })
  }

  /**
   * Depois de uma batida não confirmada, a lista de hoje é relida do servidor:
   * é nela que a pessoa confere se a batida gravou antes de bater de novo.
   */
  function voltarEConferir() {
    voltarAoInicio()
    void recarregarLista()
    setTentativaDosPedidos((n) => n + 1)
  }

  async function aoSair() {
    try {
      await sair()
    } finally {
      window.location.replace('/entrar')
    }
  }

  /**
   * Selfie confirmada (ou guardada, na segunda tentativa): agora a coordenada.
   * Nada foi enviado ainda.
   *
   * O GPS QUE NÃO RESPONDEU NÃO JOGA A FOTO FORA: "indisponível" e
   * "demora" vão para `localizacao_falhou`, com a foto; dali, "Tentar a
   * localização de novo" volta aqui com `rapida` e, dando certo, segue direto
   * ao PIN. As outras falhas (permissão negada, sem HTTPS, sem suporte) não
   * melhoram tentando de novo e continuam no erro, com o "como resolver".
   */
  async function localizar(foto: Blob, atraso: Atraso, rapida: boolean, falhasAntes: number) {
    const vez = ++pedidoDeLocalizacao.current
    setEtapa({ nome: 'localizando', foto, atraso, rapida })
    try {
      const coordenada = await pedirCoordenada({ rapida })
      if (vez !== pedidoDeLocalizacao.current) return
      setEtapa({ nome: 'pin', foto, local: { tipo: 'coordenada', coordenada }, atraso })
    } catch (falha) {
      if (vez !== pedidoDeLocalizacao.current) return
      if (falha instanceof ErroDeLocalizacao) {
        if (valeTentarALocalizacaoDeNovo(falha.motivo)) {
          setEtapa({ nome: 'localizacao_falhou', foto, atraso, motivo: falha.motivo, tentativas: falhasAntes + 1 })
          return
        }
        falhar(falha.message, falha.comoResolver, atraso)
        return
      }
      falhar('Não deu para obter sua localização agora.', null, atraso)
    }
  }

  /**
   * O último passo do PEDIDO de batida em atraso: o mesmo desenho de `gravar`.
   *
   * O HORÁRIO É CONFERIDO DE NOVO AQUI, com o relógio de agora: entre o
   * formulário e o PIN a pessoa pode ter demorado — e, perto da meia-noite, o
   * "hoje" do formulário pode já ter virado ontem. A RPC confere também; esta
   * conferência só poupa a viagem e a tentativa de PIN.
   */
  async function enviarPedido(pin: string, foto: Blob, local: LocalDaBatida, atraso: DadosDoFormulario) {
    if (!usuarioId) {
      falhar('Sua sessão expirou. Entre de novo.', null, atraso)
      return
    }
    const horario = momentoDaHoraDeHoje(atraso.hora, new Date())
    if (!horario.ok) {
      falhar(horario.erro, 'Volte e escolha outro horário.', atraso)
      return
    }

    setEtapa({ nome: 'gravando', atraso })
    try {
      const resposta = await pedirBatidaEmAtraso({
        usuarioId,
        pin,
        foto,
        local,
        horarioDeclaradoISO: horario.momentoISO,
        motivo: atraso.motivo,
      })

      if (resposta.gravado) {
        setMiniatura(URL.createObjectURL(foto))
        setEtapa({ nome: 'pedido_enviado', pedido: resposta.pedido })
        // Relê os pedidos de hoje: o novo entra na lista com o estado do banco.
        setTentativaDosPedidos((n) => n + 1)
        return
      }

      switch (resposta.motivo) {
        case 'pedido_duplicado':
          falhar(
            'Você já tem um pedido aguardando aprovação para este mesmo horário.',
            'O pedido anterior continua valendo. Acompanhe a resposta na lista de pedidos de hoje.',
            atraso,
          )
          setTentativaDosPedidos((n) => n + 1)
          return
        case 'pin_nao_definido':
        case 'precisa_redefinir':
          falhar(
            'Seu PIN precisa ser redefinido antes de pedir a batida.',
            'Vamos te levar para a tela de criar um PIN novo.',
            atraso,
          )
          void recarregar()
          return
        case 'pin_incorreto':
          falhar(
            `PIN incorreto — o pedido não foi enviado. Você ainda tem ${resposta.tentativas_restantes} tentativas.`,
            null,
            atraso,
          )
          return
        case 'bloqueado': {
          const segundos = segundosDeTrava(resposta.bloqueado_ate)
          falhar(
            `Conta bloqueada por tentativas erradas de PIN. Tente de novo em ${formatarEspera(segundos)}.`,
            'O bloqueio é da sua conta, não deste aparelho. Se esqueceu o PIN, peça ao RH para resetar seu PIN.',
            atraso,
          )
          return
        }
        default:
          // Motivo que este app ainda não conhece: como na batida, o pedido não
          // foi gravado e a foto fica no bucket, por via das dúvidas.
          falhar('O servidor recusou este pedido.', 'Tente de novo. Se continuar, avise o RH.', atraso)
          return
      }
    } catch (falha) {
      if (falha instanceof ErroDoPedido && falha.incerto) {
        setEtapa({
          nome: 'erro',
          mensagem: falha.message,
          comoResolver: PEDIDO_INCERTO.comoResolver,
          atraso,
          incerto: true,
        })
        return
      }
      falhar(
        falha instanceof Error ? falha.message : 'Não deu para enviar o pedido agora.',
        null,
        atraso,
      )
    }
  }

  /** Último passo: sobe a foto, grava a batida, e desfaz a foto se não gravar. */
  async function gravar(pin: string, foto: Blob, local: LocalDaBatida) {
    if (!usuarioId) {
      falhar('Sua sessão expirou. Entre de novo.')
      return
    }

    setEtapa({ nome: 'gravando', atraso: null })
    try {
      const resposta = await registrarBatida({ usuarioId, pin, foto, local })

      if (resposta.gravado) {
        setMiniatura(URL.createObjectURL(foto))
        setEtapa({ nome: 'comprovante', batida: resposta.registro })
        /*
         * A linha entra na lista sem nova consulta — e não é atalho: o objeto
         * devolvido é a linha COMO O BANCO A GRAVOU, com horário do servidor,
         * tipo deduzido, distância e marca dentro/fora. Reler seria pedir de
         * volta o que já está na mão, e no 4G do corredor isso é meio segundo
         * de lista vazia depois do comprovante.
         *
         * SÓ QUANDO A LISTA NA TELA É BOA. Com a lista em erro, a
         * tela tem zero batidas: acrescentar a nova faria o botão prever a
         * "2ª de 4" para quem já bateu três vezes. Aí a lista é relida.
         */
        if (listaBoa.current) {
          versaoDaLista.current++
          setBatidas((anteriores) => [...anteriores, resposta.registro])
          setErroDaLista(null)
          diaDaLista.current = resposta.registro.dia_civil
          setAtualizadoEm(horaDeAgora())
        } else {
          void recarregarLista('em_silencio')
        }
        return
      }

      // Recusas do servidor. Nos motivos conhecidos abaixo, a selfie já foi
      // descartada dentro de `registrarBatida` — não sobra foto órfã.
      switch (resposta.motivo) {
        case 'batida_duplicada':
          /*
           * SEM NÚMERO NA FRASE. A janela é configuração
           * (`ponto_configuracao.janela_duplicidade_segundos`) e a RPC devolve
           * só o motivo, sem o valor — dizer "menos de um minuto" aqui seria
           * repetir de cabeça um número que a área de administração pode ter
           * mudado. Buscar a configuração só para escrever esta frase custaria
           * uma consulta a cada abertura da tela de bater, e o funcionário não
           * precisa do número: ele precisa saber que a batida anterior valeu.
           */
          falhar(
            'Essa batida foi recusada como duplicidade: já existe um registro seu de pouco tempo atrás.',
            'A batida anterior continua valendo. Se precisar bater de novo, espere um pouco e tente outra vez.',
          )
          return
        case 'pin_nao_definido':
        case 'precisa_redefinir':
          falhar(
            'Seu PIN precisa ser redefinido antes de bater o ponto.',
            'Vamos te levar para a tela de criar um PIN novo.',
          )
          // Relê o status; a RotaProtegida leva para /definir-pin sozinha.
          void recarregar()
          return
        case 'pin_incorreto':
          falhar(
            `PIN incorreto — a batida não foi registrada. Você ainda tem ${resposta.tentativas_restantes} tentativas.`,
          )
          return
        case 'bloqueado': {
          // `tentativas_restantes` pode vir aqui e é ignorado de propósito:
          // o banco o zera junto com a trava, e mostrá-lo diria "você tem 5
          // tentativas" a quem acabou de ser trancado.
          const segundos = segundosDeTrava(resposta.bloqueado_ate)
          falhar(
            `Conta bloqueada por tentativas erradas de PIN. Tente de novo em ${formatarEspera(segundos)}.`,
            'O bloqueio é da sua conta, não deste aparelho. Se esqueceu o PIN, peça ao RH para resetar seu PIN.',
          )
          return
        }
        default:
          /*
           * Recusa com um motivo que este app ainda não conhece (o banco pode
           * ser mais novo que o app guardado no aparelho). A batida não foi
           * gravada; a foto fica no bucket, por via das dúvidas (`descarte.ts`).
           * Sem este caso a tela ficaria parada em "Gravando sua batida".
           */
          falhar('O servidor recusou esta batida.', 'Tente de novo. Se continuar, avise o RH.')
          return
      }
    } catch (falha) {
      if (falha instanceof ErroDeBatida && falha.incerto) {
        setEtapa({
          nome: 'erro',
          mensagem: falha.message,
          comoResolver: BATIDA_INCERTA.comoResolver,
          atraso: null,
          incerto: true,
        })
        return
      }
      falhar(falha instanceof Error ? falha.message : 'Não deu para gravar a batida agora.')
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-5 py-8">
      <header className="flex items-center justify-between">
        <MarcaDoTopo />
        <button
          onClick={aoSair}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-mute transition-colors hover:text-plat-dim"
        >
          <LogOut size={15} aria-hidden="true" />
          Sair
        </button>
      </header>

      <div className="mt-8">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">{rotulo}</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-plat">
          {saudacao ? `Olá, ${saudacao}` : 'Olá'}
        </h1>
      </div>

      <main className="mt-8 flex-1">
        {etapa.nome === 'inicio' && (
          <>
            {/*
              "CORRIGIR PONTO", O PRIMEIRO BOTÃO DE QUEM ADMINISTRA. O RH abre
              o app para corrigir, não para bater, e o "Painel do
              administrador", no pé da tela, tem um nome que não diz o que se
              faz lá. Este botão leva direto à lista de pessoas do mês e diz quantos pedidos de
              batida em atraso esperam decisão. Mesma condição dos botões de
              administração do pé, que continuam onde estavam.
            */}
            {administra && (
              <div className="mb-4">
                <Botao tom="secundario" onClick={() => navegar('/painel')}>
                  <PencilLine size={16} aria-hidden="true" />
                  {rotuloDoCorrigirPonto(pedidosEsperando)}
                </Botao>
              </div>
            )}

            {!bate && <ContaQueNaoBate administra={administra} />}

            {bate && (
              <>
                {/*
                  SEM INTERNET, O AVISO VEM ANTES: sem ele, a pessoa tiraria a
                  selfie, esperaria o GPS, digitaria o PIN e só então leria "Sem
                  internet". O botão fica desabilitado já aqui. Nada é guardado para depois: não
                  existe fila, e o texto diz isso.
                */}
                {!online && (
                  <div className="mb-4">
                    <Aviso tom="atencao">
                      <span className="flex items-start gap-2">
                        <WifiOff size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                        <span>Sem internet. A batida não acontece sem conexão, e nada fica guardado para depois.</span>
                      </span>
                    </Aviso>
                  </div>
                )}

                {/*
                  O DIA COMPLETO: com 4 batidas (ou outro número par a
                  partir de 4), o cartão diz o dia — da primeira à última batida
                  e as horas, pela mesma conta do espelho (`calcularDia`) — e o
                  botão de bater desce para secundário. Não há cartão de
                  "próxima batida": quem diz qual batida é o próprio botão.
                */}
                {previsao.modo === 'completo' && (
                  <Painel className="mb-4 text-center">
                    <p className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.2em] text-luz">
                      <CalendarCheck size={13} aria-hidden="true" />
                      Dia completo
                    </p>
                    <p className="mt-2 font-mono text-xl text-plat tabular-nums">{previsao.resumoDoDia}</p>
                  </Painel>
                )}

                {/*
                  O BOTÃO DIZ QUAL BATIDA: "Bater saída para o almoço",
                  "2ª de 4 hoje". É a previsão pela ordem do dia, para conferir
                  de relance — quem decide o tipo continua sendo o servidor, na
                  gravação. Enquanto a lista carrega, quando ela não veio ou com
                  um pedido em atraso esperando, ele diz só "Bater ponto".
                */}
                <button
                  onClick={() =>
                    setEtapa(previsao.pedeConfirmacao ? { nome: 'confirmar_extra' } : { nome: 'camera', atraso: null })
                  }
                  disabled={!online}
                  className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl px-4 transition-colors select-none focus-visible:ring-2 focus-visible:ring-luz/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45 ${
                    previsao.principal
                      ? 'bg-luz py-7 text-ink-0 hover:bg-luz-deep active:bg-luz-deep disabled:hover:bg-luz'
                      : 'border border-hair-2 bg-ink-2 py-5 text-plat-dim hover:border-hair-3 hover:text-plat disabled:hover:border-hair-2 disabled:hover:text-plat-dim'
                  }`}
                >
                  <Camera size={previsao.principal ? 26 : 22} aria-hidden="true" />
                  <span className="text-base font-semibold tracking-tight">{previsao.titulo}</span>
                  <span className="text-xs font-medium opacity-70">
                    {online ? previsao.subtitulo : 'aguardando internet'}
                  </span>
                </button>
                {previsao.aviso && (
                  <p className="mt-2 text-center text-xs leading-relaxed text-mute">{previsao.aviso}</p>
                )}

                {/*
                  A PORTA DA BATIDA EM ATRASO. Logo abaixo do botão
                  principal, e mais discreta que ele: é a exceção, não o caminho do
                  dia a dia. Ela abre o formulário de horário e motivo; daí em diante
                  os passos são os da batida.

                  SÓ HOJE, E A QUEM RECORRER: o nome diz "hoje", e a
                  linha de baixo diz o que fazer quando o esquecimento foi em
                  outro dia — o pedido não serve para isso.
                */}
                <div className="mt-2">
                  <Botao tom="discreto" onClick={() => setEtapa({ nome: 'atraso' })} disabled={!online}>
                    <Clock size={15} aria-hidden="true" />
                    Esqueci de bater hoje
                  </Botao>
                  <p className="text-center text-xs leading-relaxed text-mute">
                    Esqueceu em outro dia? Avise o RH, que corrige pelo painel.
                  </p>
                </div>

                <BatidasDoDia
                  batidas={batidas}
                  carregando={carregandoLista}
                  erro={erroDaLista}
                  aoTentarDeNovo={() => void recarregarLista()}
                  aprovadores={aprovadores}
                  atualizadoEm={atualizadoEm}
                />

                <MeusPedidosDeAtraso
                  titulo="Seus pedidos de batida em atraso"
                  pedidos={pedidos}
                  nomes={nomes}
                  erro={erroDosPedidos}
                  aoTentarDeNovo={() => setTentativaDosPedidos((n) => n + 1)}
                />
              </>
            )}

            {/*
              A porta para o mês inteiro. Fica DEPOIS da lista de hoje
              de propósito: quem abre o app está aqui para bater, e a conferência
              do mês é a segunda pergunta, não a primeira. `useNavigate` em vez
              de `<Link>` para não haver dois estilos de botão no app.
            */}
            <div className="mt-6 space-y-2">
              {/* O espelho é o mês das PRÓPRIAS batidas: quem não bate não tem o que conferir. */}
              {bate && (
                <Botao tom="secundario" onClick={() => navegar('/espelho')}>
                  <CalendarDays size={16} aria-hidden="true" />
                  Ver meu espelho do mês
                </Botao>
              )}

              {/*
                A porta do painel, visível só para quem administra o ponto. Não
                é a proteção — a guarda de rota e, acima dela, a RLS é que são.
                Aqui é só descoberta: sem este botão, o único caminho para o
                painel seria digitar /painel de cabeça.

                A pergunta é a do banco (quem administra o ponto), a mesma da
                guarda: com outra regra, o botão apareceria a quem a guarda
                devolve para cá, e o convite se repetiria na volta. Enquanto a
                RPC não responde, o botão não aparece — melhor
                aparecer meio segundo depois do que piscar para quem não pode.
              */}
              {administra && (
                <>
                  <Botao tom="secundario" onClick={() => navegar('/painel')}>
                    <Users size={16} aria-hidden="true" />
                    Painel do administrador
                  </Botao>
                  {/*
                    A página inicial da administração (pendências, pessoas,
                    ausências, local, empresa e jornada) tem porta própria
                    aqui. Quem administra abre o app para bater e vê,
                    no mesmo lugar, o caminho para o que espera por ele — sem
                    passar pelo painel do mês. Mesma condição do botão acima.
                  */}
                  <Botao tom="secundario" onClick={() => navegar('/administracao')}>
                    <SlidersHorizontal size={16} aria-hidden="true" />
                    Administração
                  </Botao>
                </>
              )}
            </div>
          </>
        )}

        {etapa.nome === 'atraso' && (
          <FormularioDeAtraso
            inicial={etapa.inicial}
            aoContinuar={(dados) => setEtapa({ nome: 'camera', atraso: dados })}
            aoCancelar={voltarAoInicio}
            // As batidas de hoje só entram no formulário quando a lista veio:
            // carregando ou com erro, ele não afirma nada sobre o dia.
            batidasDeHoje={carregandoLista || erroDaLista ? undefined : batidas}
          />
        )}

        {etapa.nome === 'confirmar_extra' && (
          <ConfirmacaoDaExtra
            batidas={batidas}
            aoVoltar={voltarAoInicio}
            aoConfirmar={() => setEtapa({ nome: 'camera', atraso: null })}
          />
        )}

        {etapa.nome === 'camera' && (
          <CapturaDeSelfie
            aoCapturar={(foto) => void localizar(foto, etapa.atraso, false, 0)}
            aoCancelar={voltarAoInicio}
          />
        )}

        {etapa.nome === 'localizando' && <EsperaDaLocalizacao rapida={etapa.rapida} aoCancelar={voltarAoInicio} />}

        {etapa.nome === 'localizacao_falhou' && (
          <FalhaDeLocalizacao
            motivo={etapa.motivo}
            tentativas={etapa.tentativas}
            doPedido={etapa.atraso !== null}
            aoTentarDeNovo={() => void localizar(etapa.foto, etapa.atraso, true, etapa.tentativas)}
            aoBaterSemLocalizacao={() =>
              setEtapa({
                nome: 'pin',
                foto: etapa.foto,
                local: { tipo: 'sem_localizacao', motivo: etapa.motivo },
                atraso: etapa.atraso,
              })
            }
            aoTirarOutraFoto={() => setEtapa({ nome: 'camera', atraso: etapa.atraso })}
            aoCancelar={voltarAoInicio}
          />
        )}

        {etapa.nome === 'pin' && (
          <ConfirmacaoDePin
            titulo="Confirme com seu PIN"
            descricao={descricaoDoPin(etapa.atraso?.hora ?? null, etapa.local.tipo === 'sem_localizacao')}
            aoConfirmar={(pin) => {
              const atraso = etapa.atraso
              if (atraso) void enviarPedido(pin, etapa.foto, etapa.local, atraso)
              else void gravar(pin, etapa.foto, etapa.local)
            }}
            /*
             * Sem esta prop os casos `precisa_redefinir` e `pin_nao_definido`
             * ficariam MUDOS — o componente a chama com `?.()` e a pessoa
             * travaria olhando o teclado sem mensagem nenhuma.
             */
            aoPedirRedefinicao={() => {
              falhar(
                'Seu PIN precisa ser redefinido antes de bater o ponto.',
                'Vamos te levar para a tela de criar um PIN novo.',
                etapa.atraso,
              )
              void recarregar()
            }}
            aoCancelar={voltarAoInicio}
          />
        )}

        {etapa.nome === 'gravando' &&
          (etapa.atraso ? (
            <PainelDeEspera
              titulo="Enviando seu pedido"
              detalhe="Enviando a selfie e o pedido de batida em atraso. Não feche o app."
            />
          ) : (
            <PainelDeEspera
              titulo="Gravando sua batida"
              detalhe="Enviando a selfie e registrando o horário do servidor. Não feche o app."
            />
          ))}

        {etapa.nome === 'comprovante' && (
          <Comprovante batida={etapa.batida} miniatura={miniatura} aoFechar={voltarAoInicio} />
        )}

        {etapa.nome === 'pedido_enviado' && (
          <ReciboDoPedido pedido={etapa.pedido} miniatura={miniatura} aoFechar={voltarAoInicio} />
        )}

        {etapa.nome === 'erro' && (
          <Painel>
            <h2 className="text-center text-lg font-semibold text-plat">
              {etapa.incerto
                ? (etapa.atraso ? PEDIDO_INCERTO : BATIDA_INCERTA).titulo
                : etapa.atraso
                  ? 'Pedido não enviado'
                  : 'Batida não registrada'}
            </h2>
            <div className="mt-5">
              <Aviso tom="erro">
                {etapa.mensagem}
                {etapa.comoResolver && (
                  <span className="mt-2 block text-xs leading-relaxed opacity-80">
                    {etapa.comoResolver}
                  </span>
                )}
              </Aviso>
            </div>
            <p className="mt-4 text-center text-xs leading-relaxed text-faint">
              {etapa.incerto
                ? (etapa.atraso ? PEDIDO_INCERTO : BATIDA_INCERTA).rodape
                : etapa.atraso
                  ? 'Nada foi gravado: nenhum pedido novo e nenhuma foto guardada.'
                  : 'Nada foi gravado: nenhuma linha no seu ponto e nenhuma foto guardada.'}
            </p>
            <div className="mt-6">
              {/* No pedido, "tentar de novo" volta ao formulário com o horário
                  e o motivo já preenchidos — quem errou o PIN não precisa
                  reescrever o motivo. Na resposta perdida, o botão volta ao
                  início e relê do servidor as batidas e os pedidos de hoje. */}
              <Botao
                onClick={() => {
                  const atraso = etapa.atraso
                  if (etapa.incerto) voltarEConferir()
                  else if (atraso) {
                    setMiniatura(null)
                    setEtapa({ nome: 'atraso', inicial: atraso })
                  } else voltarAoInicio()
                }}
              >
                <RotateCcw size={16} aria-hidden="true" />
                {etapa.incerto ? 'Voltar e conferir a lista' : 'Voltar e tentar de novo'}
              </Botao>
            </div>
          </Painel>
        )}
      </main>

      {/*
        A FRASE DO PÉ É A DA EMPRESA QUE INSTALA, e não do app: o slogan
        configurado no build (ver `lib/marca.ts`), o mesmo da tela de entrar.
        Sem slogan, não há pé — uma frase fixa aqui apareceria igual em toda
        instalação.
      */}
      {slogan !== '' && (
        <footer className="mt-10 text-center">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-faint">{slogan}</p>
        </footer>
      )}
    </div>
  )
}
