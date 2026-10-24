import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { Marca } from './Marca'

/*
 * As peças repetidas das telas de acesso.
 *
 * Sem shadcn de propósito: este app tem quatro telas e cinco componentes. Uma
 * biblioteca de UI aqui seria mais código de configuração do que de interface.
 * As classes ficam em constantes de módulo em vez de espalhadas pelas páginas,
 * para que "o botão verde" seja um lugar só.
 *
 * Regra que atravessa tudo: `min-h-11` = 44px, o alvo de toque mínimo que a
 * Apple e o Google pedem. Este app é usado em pé, no celular, muitas vezes com
 * a mão ocupada.
 *
 * ---------------------------------------------------------------------------
 * A RESPONSIVIDADE MORA AQUI, E NÃO ESPALHADA POR TELA
 *
 * Toda folga que muda com o tamanho da tela — padding do cartão, padding do
 * botão, moldura da página, moldura de diálogo — está neste arquivo. O motivo é
 * o mesmo que fez as cores virarem constante de módulo: se cada tela escolher a
 * sua, a quarta tela vai escolher diferente e ninguém vai perceber até alguém
 * abrir as quatro no mesmo celular.
 *
 * O CELULAR PEQUENO DE VERDADE É 320 px. Um iPhone SE de primeira geração, ou
 * um Android barato, ou qualquer aparelho com a fonte do sistema aumentada. Com
 * `px-5` de página + `p-6` de cartão sobravam 232 px de conteúdo — e é dentro
 * desses 232 px que precisavam caber duas datas, dois botões lado a lado e um
 * nome completo. Daí `p-4 sm:p-6`: 16 px a mais de cada lado onde eles fazem
 * diferença, e o desenho de sempre a partir de 640 px.
 * ---------------------------------------------------------------------------
 */

const BOTAO_BASE =
  /*
   * `px-3 sm:px-4`: em 320 px, dois botões lado a lado ficam com ~104 px cada.
   * Os 8 px de padding que este `px-3` devolve são a diferença entre "Conceder
   * admin" numa linha e "Conceder" / "admin" em duas.
   *
   * `text-center leading-snug`: quando o rótulo QUEBRA mesmo assim, ele quebra
   * centrado e com entrelinha curta, dentro do mesmo alvo de 44 px — em vez de
   * empurrar o botão para 60 px de altura e desalinhar o par ao lado.
   */
  'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 py-3 sm:px-4 ' +
  'text-center text-sm leading-snug font-semibold transition-colors select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-45 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-ink-0'

const BOTAO_TOM = {
  /* O verde de destaque sobre preto — a única ação principal de cada tela. */
  primario: 'bg-luz text-ink-0 hover:bg-luz-deep active:bg-luz-deep',
  secundario: 'border border-hair-2 bg-ink-2 text-plat-dim hover:border-hair-3 hover:text-plat',
  discreto: 'text-mute hover:text-plat-dim',
} as const

export function Botao({
  tom = 'primario',
  className = '',
  ...props
}: { tom?: keyof typeof BOTAO_TOM } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${BOTAO_BASE} ${BOTAO_TOM[tom]} ${className}`} {...props} />
}

/*
 * A BORDA DO CAMPO É `plat/40`, E NÃO `hair-2`.
 * `hair-2` dá 1,5:1 sobre o fundo do campo: no celular ao sol, o campo de
 * hora sumiria na caixa. `plat/40` dá 3,5:1 sobre `ink-2` — acima do 3:1 que a
 * borda de um componente de formulário precisa ter para ser achada.
 */
const CAMPO =
  'w-full min-h-11 rounded-xl border border-plat/40 bg-ink-2 px-4 py-3 text-sm text-plat ' +
  'placeholder:text-faint transition-colors ' +
  'focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25'

export function Campo({
  rotulo,
  id,
  ...props
}: { rotulo: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-plat-dim">
        {rotulo}
      </label>
      <input id={id} className={CAMPO} {...props} />
    </div>
  )
}

/**
 * Um `<select>` com o visual de `Campo`. Mora aqui porque várias caixas o usam
 * (o tipo da ausência, a ficha ao criar ou ligar uma conta).
 *
 * É um `select` NATIVO, e não uma lista feita à mão: no celular ele abre a roda
 * do sistema, que é acessível, funciona com teclado e não precisa de nenhum
 * código para fechar ao rolar a página.
 */
export function Escolha({
  id,
  rotulo,
  value,
  onChange,
  disabled,
  children,
}: {
  id: string
  rotulo: string
  value: string
  onChange: (valor: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-plat-dim">
        {rotulo}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(evento) => onChange(evento.target.value)}
        className={`${CAMPO} disabled:opacity-60`}
      >
        {children}
      </select>
    </div>
  )
}

const ETIQUETA_TOM = {
  aviso: 'border-warn/35 bg-warn-soft text-warn',
  neutro: 'border-hair-2 bg-ink-2 text-mute',
  bom: 'border-luz/35 bg-luz-soft text-luz',
} as const

/**
 * A etiqueta curta das listas ("administra o ponto", "sem PIN", "ficha
 * desativada").
 *
 * `0.7rem` (11,2 px), e não `0.62rem`: ela carrega informação ("fim de
 * semana", "Em andamento"), e 10 px no celular é texto para adivinhar.
 */
export function Etiqueta({
  tom,
  children,
}: {
  tom: keyof typeof ETIQUETA_TOM
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium ${ETIQUETA_TOM[tom]}`}
    >
      {children}
    </span>
  )
}

const AVISO_TOM = {
  erro: 'border-err/35 bg-err-soft text-err',
  atencao: 'border-warn/35 bg-warn-soft text-warn',
  bom: 'border-luz/35 bg-luz-soft text-luz',
  neutro: 'border-hair-2 bg-ink-2 text-plat-dim',
} as const

/**
 * Caixa de mensagem. `role="alert"` para o leitor de tela anunciar o erro
 * assim que ele aparece — quem erra o PIN não está olhando para o rodapé.
 *
 * SÓ O ERRO E A ATENÇÃO INTERROMPEM. O `alert` corta o que o leitor de tela
 * está lendo; uma confirmação ("PIN resetado") ou um texto neutro não merecem
 * isso, e vão com `status`, que espera a vez.
 */
export function Aviso({
  tom = 'erro',
  children,
}: {
  tom?: keyof typeof AVISO_TOM
  children: ReactNode
}) {
  return (
    <div
      role={tom === 'erro' || tom === 'atencao' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${AVISO_TOM[tom]}`}
    >
      {children}
    </div>
  )
}

/**
 * Cartão escuro com fio — o corpo de cada tela.
 *
 * `p-4 sm:p-6` e não `p-6`: no celular de 320 px o cartão da área de
 * administração aninha três níveis de padding (página + cartão + linha da
 * pessoa), e 24 px de cada lado em todos os três apertariam o conteúdo. Acima
 * de 640 px o cartão tem os 24 px.
 */
export function Painel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-hair bg-ink-1 p-4 sm:p-6 ${className}`}>
      {children}
    </div>
  )
}

/*
 * A MOLDURA DAS TELAS DE ADMINISTRAÇÃO — painel, pessoa e configuração.
 *
 * As três usam a MESMA moldura, e ela mora aqui, num lugar só: com pontos de
 * quebra, uma classe copiada em três telas é a que fica para trás, numa delas,
 * no próximo ajuste.
 *
 * POR QUE A LARGURA CRESCE SÓ EM `lg` (1024 px), E NÃO EM `sm`
 * Entre 640 e 1024 px estão o iPad em pé e o celular deitado — telas em que a
 * coluna de 448 px continua sendo a leitura certa, porque a linha longa demais
 * cansa e porque o polegar continua alcançando tudo. É no notebook que a coluna
 * estreita vira desperdício: 1280 px de tela para 448 px de conteúdo com 400 px
 * de vazio de cada lado, e a lista de pessoas rolando por três telas.
 *
 * `min-h-dvh` e não `min-h-screen`: no celular a barra do navegador entra e sai,
 * e `100vh` deixa o rodapé pulando.
 */
const LARGURA_DA_PAGINA = {
  /** Coluna única sempre. Para tela que não ganha nada em ficar larga. */
  coluna: 'max-w-md',
  /** Coluna no celular e no tablet, mesa de trabalho no computador. */
  ampla: 'max-w-md lg:max-w-5xl',
} as const

export function Pagina({
  largura = 'coluna',
  children,
}: {
  largura?: keyof typeof LARGURA_DA_PAGINA
  children: ReactNode
}) {
  return (
    <div
      className={`mx-auto flex min-h-dvh w-full flex-col px-4 py-8 sm:px-5 ${LARGURA_DA_PAGINA[largura]}`}
    >
      {children}
    </div>
  )
}

/**
 * A MOLDURA DE QUALQUER DIÁLOGO — confirmação, ajuste de batida, visor de foto.
 *
 * ⚠ O QUE ELA RESOLVE, E QUE NÃO É ESTÉTICA
 * Centralizar por flex E rolar no MESMO elemento (`fixed inset-0 flex
 * items-center justify-center overflow-y-auto`) tem um defeito conhecido:
 * quando o conteúdo é mais alto que a janela, o navegador corta o TOPO e não
 * deixa rolar até ele — `justify-content`/`align-items` empurram o excesso para
 * fora do início do contêiner, e a barra de rolagem só alcança o que está
 * DEPOIS do início. Num iPhone SE (320×568), a caixa de ajuste com trilha de
 * correções passa de 700 px de altura: o título e o campo do dia ficariam
 * inalcançáveis.
 *
 * Por isso os dois papéis ficam em dois elementos: o de fora só rola, o de
 * dentro (`min-h-full` + flex) só centraliza. Quando cabe, centraliza; quando
 * não cabe, vira uma coluna que rola do topo ao fim.
 *
 * O CLIQUE DE FORA FECHA, e é o elemento do MEIO que o recebe — ele cobre a
 * janela inteira. O conteúdo para a propagação, então clicar dentro não fecha.
 * Clicar fora nunca CONFIRMA nada: fechar é sempre a saída segura.
 */
const LARGURA_DO_MODAL = {
  /** O padrão: uma confirmação, um ajuste de batida, uma foto. */
  estreita: 'max-w-sm',
  /**
   * Formulário longo — a ficha do funcionário, com onze campos.
   *
   * `max-w-sm` (384 px) é a largura certa para uma pergunta com dois botões, e
   * é a errada para um cadastro inteiro: no computador, onze campos empilhados
   * numa coluna de 384 px viram uma caixa que rola por duas telas, com 900 px
   * de vazio de cada lado. `max-w-lg` (512 px) cabe dois campos por linha a
   * partir de `sm` e continua sendo uma coluna no celular, onde o `w-full`
   * manda antes de qualquer teto.
   */
  ampla: 'max-w-lg',
} as const

/*
 * O TECLADO É DO DIÁLOGO, E NÃO DE CADA CAIXA.
 *
 * Com um ouvinte de Esc em cada caixa, nenhuma cuidaria do resto: o foco
 * ficaria no botão que abriu (atrás do fundo escuro), o Tab passearia pela
 * página escondida e, ao fechar, o foco iria para o topo do documento. O
 * `Modal` faz as quatro coisas para todas as caixas que o usam:
 *
 *  1. AO ABRIR, O FOCO ENTRA. Com mouse ou trackpad (`pointer: fine`), no
 *     elemento marcado com `data-foco-inicial` (a Hora, na caixa de corrigir)
 *     ou, sem marca, no primeiro focável — e, sem nenhum, na própria caixa. NO
 *     TOQUE, NO TÍTULO: focar um campo no celular abre o teclado ou a roda de
 *     horário do iOS por cima da caixa, escondendo justamente o que a pessoa
 *     precisa ler antes de digitar (as batidas do dia, a prévia).
 *  2. TAB E SHIFT+TAB FICAM DENTRO da caixa, dando a volta.
 *  3. ESC FECHA, quando `podeFechar` (nunca no meio de uma gravação).
 *  4. AO FECHAR, O FOCO VOLTA A QUEM ABRIU (se ele ainda estiver na tela).
 *
 * Só o diálogo de CIMA responde ao teclado (`DIALOGOS_ABERTOS`): uma caixa
 * aberta por cima de outra fecha sozinha no Esc, sem levar a de baixo junto.
 */
const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Os diálogos abertos, do de baixo para o de cima. */
const DIALOGOS_ABERTOS: object[] = []

function focaveisDe(caixa: HTMLElement): HTMLElement[] {
  return [...caixa.querySelectorAll<HTMLElement>(FOCAVEIS)]
}

/** Mouse ou trackpad. Sem `matchMedia` (o jsdom da fumaça), vale o toque. */
function temPonteiroFino(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches
}

function focarAoAbrir(caixa: HTMLElement) {
  if (temPonteiroFino()) {
    const alvo = caixa.querySelector<HTMLElement>('[data-foco-inicial]') ?? focaveisDe(caixa)[0] ?? caixa
    alvo.focus()
    return
  }
  const titulo = caixa.querySelector<HTMLElement>('h1, h2, h3')
  if (!titulo) {
    caixa.focus()
    return
  }
  // O título não é focável por natureza: `tabindex="-1"` deixa o foco chegar
  // nele sem pôr o título na ordem do Tab.
  if (!titulo.hasAttribute('tabindex')) titulo.setAttribute('tabindex', '-1')
  titulo.focus()
}

export function Modal({
  rotulo,
  aoFechar,
  /** Enquanto grava, nem o clique de fora nem o Esc fecham — a gravação está em andamento. */
  podeFechar = true,
  /**
   * Há texto digitado: o clique de fora deixa de fechar, para um
   * toque errado no fundo não jogar fora o motivo escrito. "Fechar",
   * "Cancelar" e o Esc continuam fechando — são pedidos explícitos.
   */
  temAlteracao = false,
  largura = 'estreita',
  children,
}: {
  rotulo: string
  aoFechar: () => void
  podeFechar?: boolean
  temAlteracao?: boolean
  largura?: keyof typeof LARGURA_DO_MODAL
  children: ReactNode
}) {
  const caixa = useRef<HTMLDivElement>(null)
  // O ouvinte do teclado é registrado uma vez, na abertura; o que ele precisa
  // saber de agora (fechar pode ter mudado de função, podeFechar de valor) vem
  // desta referência, atualizada a cada desenho.
  const atual = useRef({ aoFechar, podeFechar })
  useEffect(() => {
    atual.current = { aoFechar, podeFechar }
  })

  useEffect(() => {
    const painel = caixa.current
    if (!painel) return
    const eu = {}
    DIALOGOS_ABERTOS.push(eu)
    const quemAbriu = document.activeElement instanceof HTMLElement ? document.activeElement : null
    focarAoAbrir(painel)

    function aoTeclar(evento: KeyboardEvent) {
      if (DIALOGOS_ABERTOS.at(-1) !== eu || !painel) return
      if (evento.key === 'Escape') {
        if (atual.current.podeFechar) {
          evento.preventDefault()
          atual.current.aoFechar()
        }
        return
      }
      if (evento.key !== 'Tab') return
      const focaveis = focaveisDe(painel)
      if (focaveis.length === 0) {
        evento.preventDefault()
        painel.focus()
        return
      }
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      const ativo = document.activeElement
      const dentro = ativo instanceof Node && painel.contains(ativo)
      if (evento.shiftKey && (!dentro || ativo === primeiro || ativo === painel)) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && (!dentro || ativo === ultimo)) {
        evento.preventDefault()
        primeiro.focus()
      }
    }

    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      DIALOGOS_ABERTOS.splice(DIALOGOS_ABERTOS.indexOf(eu), 1)
      if (quemAbriu?.isConnected) quemAbriu.focus()
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={rotulo}
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-ink-0/90 backdrop-blur-sm"
    >
      <div
        className="flex min-h-full items-center justify-center p-3 sm:p-6"
        onClick={() => podeFechar && !temAlteracao && aoFechar()}
      >
        <div
          ref={caixa}
          tabIndex={-1}
          className={`w-full ${LARGURA_DO_MODAL[largura]} rounded-2xl border border-hair bg-ink-1 p-4 focus:outline-none sm:p-5`}
          onClick={(evento) => evento.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * O RECADO DO QUE ACABOU DE ACONTECER.
 *
 * Depois de gravar um ajuste, a tela da pessoa relê tudo. Se a lista sumisse
 * num "Carregando…" e voltasse sem dizer nada, quem corrigiu não saberia se
 * gravou, nem onde estava. Por isso a lista fica, e este recado diz o que foi
 * feito ("Batida das 13:00 inserida em sex., 16/10."), preso ao rodapé, com
 * "Ver o dia" e "Fechar". Some sozinho em 8 s — mas não enquanto o foco estiver nele,
 * para quem chega pelo teclado conseguir usar os botões.
 *
 * A REGIÃO `role="status"` EXISTE SEMPRE, vazia quando não há recado: o leitor
 * de tela só anuncia com segurança a mudança de uma região que já estava na
 * página. `status`, e não `alert`: é uma confirmação, não interrompe nada.
 *
 * `chave` muda a cada recado novo (e não quando o mesmo recado ganha o
 * complemento "O dia agora soma 8h00."): é ela que recomeça o estado da caixa.
 */
export function Recado({
  chave,
  texto,
  aoFechar,
  acao,
}: {
  chave: number
  texto: string | null
  aoFechar: () => void
  acao?: { rotulo: string; aoClicar: () => void } | null
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
    >
      {texto && <CaixaDoRecado key={chave} texto={texto} aoFechar={aoFechar} acao={acao ?? null} />}
    </div>
  )
}

function CaixaDoRecado({
  texto,
  aoFechar,
  acao,
}: {
  texto: string
  aoFechar: () => void
  acao: { rotulo: string; aoClicar: () => void } | null
}) {
  const [emFoco, setEmFoco] = useState(false)
  const fechar = useRef(aoFechar)
  useEffect(() => {
    fechar.current = aoFechar
  })
  useEffect(() => {
    if (emFoco) return
    const relogio = setTimeout(() => fechar.current(), 8000)
    return () => clearTimeout(relogio)
  }, [texto, emFoco])

  return (
    <div
      className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-luz/35 bg-ink-2 py-2 pr-1 pl-4 text-sm leading-relaxed text-plat shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
      onFocus={() => setEmFoco(true)}
      onBlur={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setEmFoco(false)
      }}
    >
      <CheckCircle2 size={18} aria-hidden="true" className="mt-2.5 shrink-0 text-luz" />
      <div className="min-w-0 flex-1 py-1.5">
        <p>{texto}</p>
        {acao && (
          <button
            type="button"
            onClick={acao.aoClicar}
            className="-ml-1 mt-0.5 inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-semibold text-luz underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
          >
            {acao.rotulo}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={aoFechar}
        aria-label="Fechar o recado"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Moldura de tela cheia, centralizada, com a marca do app no topo (o nome
 * configurado no build e, com `comSlogan`, o slogan, se houver um).
 * `min-h-dvh` e não `min-h-screen`: no celular a barra do navegador entra e sai,
 * e `100vh` deixa a tela pulando.
 */
export function Moldura({
  children,
  comMarca = true,
  comSlogan = true,
}: {
  children: ReactNode
  comMarca?: boolean
  comSlogan?: boolean
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        {comMarca && (
          <div className="mb-8">
            <Marca comSlogan={comSlogan} />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
