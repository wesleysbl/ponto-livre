import { useEffect, useState } from 'react'
import { Lock, ShieldAlert } from 'lucide-react'
import { formatarEspera, segundosDeTrava, verificarPin } from '../lib/pin'
import { useAuth } from '../hooks/useAuth'
import { TAMANHO_PIN, TecladoPin } from './TecladoPin'
import { Aviso, Botao, Painel } from './ui'

/*
 * "Digite seu PIN" — a confirmação de que é a pessoa certa apertando.
 *
 * ESTE COMPONENTE É O ÚLTIMO PASSO DA BATIDA. Ele não sabe nada sobre
 * bater ponto: confere o PIN no servidor, e quando confere devolve o controle —
 * e o valor digitado — para quem o chamou.
 *
 * POR QUE `aoConfirmar` RECEBE O PIN
 * Porque a conferência daqui é da TELA, e tela não é segurança. Quem grava a
 * batida é `ponto_registrar_batida`, no banco, e ela confere o PIN outra vez
 * dentro da mesma transação do INSERT — é essa segunda conferência que impede
 * alguém de chamar a API direto e bater ponto sem PIN nenhum. Para isso a
 * função precisa
 * receber o PIN, e é este componente quem o tem. As duas conferências usam a
 * MESMA contagem de tentativas do banco: não existe contador paralelo.
 *
 * O QUE NUNCA APARECE NA TELA
 * O PIN digitado (só os pontos) e, com a conta bloqueada, o número de tentativas
 * restantes. O banco devolve `tentativas_restantes: 5` junto do bloqueio — ele
 * zera o contador de propósito, para a trava vencer com as cinco chances
 * inteiras. Mostrar esse 5 diria "você tem 5 tentativas" a quem acabou de ser
 * trancado. Com `motivo: 'bloqueado'` o que se mostra é o tempo que falta.
 */

interface Props {
  titulo?: string
  descricao?: string
  /**
   * PIN conferiu e a conta está em ordem. Recebe o valor digitado, porque quem
   * grava a batida confere o PIN de novo no banco — ver o cabeçalho.
   */
  aoConfirmar: (pin: string) => void
  /**
   * O banco disse que esta conta precisa de PIN novo — ou porque não tem PIN,
   * ou porque o admin resetou. Quem chama decide para onde levar.
   */
  aoPedirRedefinicao?: () => void
  /** Some o botão de voltar quando não houver para onde voltar. */
  aoCancelar?: () => void
}

/*
 * A duração do bloqueio não vai na frase: ela cresce com os bloqueios do mesmo
 * dia (15 minutos, 1 hora, 24 horas), e quem a conhece é o banco. A tela de
 * conta bloqueada mostra o tempo que falta, lido de `bloqueado_ate`.
 */
function fraseDeErro(restantes: number): string {
  if (restantes <= 1) {
    return 'PIN incorreto. Esta é a última tentativa antes de a conta bloquear: o primeiro bloqueio do dia dura 15 minutos, e os seguintes, mais.'
  }
  return `PIN incorreto. Você ainda tem ${restantes} tentativas.`
}

export function ConfirmacaoDePin({
  titulo = 'Digite seu PIN',
  descricao = 'São os 4 dígitos que você cadastrou.',
  aoConfirmar,
  aoPedirRedefinicao,
  aoCancelar,
}: Props) {
  const { pin: statusDoPin } = useAuth()

  const [valor, setValor] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  /*
   * A trava já pode estar em curso quando esta tela abre — o status lido no
   * login traz `bloqueado_ate`. Uma data no passado vira zero segundos em
   * `segundosDeTrava`, então um valor velho se resolve sozinho.
   */
  const [bloqueadoAte, setBloqueadoAte] = useState<string | null>(
    statusDoPin.estado === 'ok' ? statusDoPin.status.bloqueado_ate : null,
  )

  /*
   * A contagem regressiva é DERIVADA de `bloqueadoAte` a cada render; o estado
   * abaixo não guarda os segundos, só serve de batida do relógio para forçar o
   * render de um em um segundo. Guardar os segundos em estado significaria
   * escrevê-los dentro do efeito, e um setState síncrono no corpo de um efeito
   * é exatamente a cascata de renders que o React pede para evitar.
   */
  const [, tique] = useState(0)

  useEffect(() => {
    if (!bloqueadoAte) return
    const relogio = setInterval(() => {
      // Trava vencida: solta o estado e o intervalo se desmonta com ele.
      if (segundosDeTrava(bloqueadoAte) === 0) setBloqueadoAte(null)
      else tique((n) => n + 1)
    }, 1000)
    return () => clearInterval(relogio)
  }, [bloqueadoAte])

  const segundos = segundosDeTrava(bloqueadoAte)
  const travado = segundos > 0

  async function conferir(digitado: string) {
    setVerificando(true)
    setErro(null)
    try {
      const resposta = await verificarPin(digitado)
      setValor('')

      if (resposta.confere) {
        // O admin resetou enquanto a pessoa ainda sabia o PIN antigo: confere,
        // mas não vale — tem que definir um novo antes de seguir.
        if (resposta.precisa_redefinir) {
          aoPedirRedefinicao?.()
          return
        }
        aoConfirmar(digitado)
        return
      }

      switch (resposta.motivo) {
        case 'pin_nao_definido':
          aoPedirRedefinicao?.()
          return
        case 'bloqueado':
          // `tentativas_restantes` existe aqui e é ignorado de propósito.
          setBloqueadoAte(resposta.bloqueado_ate)
          return
        case 'pin_incorreto':
          setErro(fraseDeErro(resposta.tentativas_restantes))
          return
      }
    } catch (falha) {
      setValor('')
      setErro(falha instanceof Error ? falha.message : 'Não deu para conferir o PIN agora.')
    } finally {
      setVerificando(false)
    }
  }

  function aoMudar(novo: string) {
    if (travado || verificando) return
    setErro(null)
    setValor(novo)
    // Quatro dígitos já são a resposta inteira: não existe botão "confirmar".
    if (novo.length === TAMANHO_PIN) void conferir(novo)
  }

  if (travado) {
    return (
      <Painel>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-err-soft text-err">
          <ShieldAlert size={22} aria-hidden="true" />
        </div>
        <h2 className="text-center text-lg font-semibold text-plat">Conta bloqueada</h2>
        <p className="mt-2 text-center text-sm leading-relaxed text-mute">
          Foram cinco tentativas erradas seguidas. Tente de novo em{' '}
          <span className="font-mono text-plat">{formatarEspera(segundos)}</span>.
        </p>
        <p className="mt-4 text-center text-xs leading-relaxed text-faint">
          O bloqueio é da sua conta, não deste aparelho — trocar de celular não adianta. Se você
          esqueceu o PIN, peça ao RH para resetar seu PIN.
        </p>
        {aoCancelar && (
          <div className="mt-6">
            <Botao tom="secundario" onClick={aoCancelar}>
              Voltar
            </Botao>
          </div>
        )}
      </Painel>
    )
  }

  return (
    <Painel>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-luz-soft text-luz">
        <Lock size={20} aria-hidden="true" />
      </div>
      <h2 className="text-center text-lg font-semibold text-plat">{titulo}</h2>
      <p className="mt-1 text-center text-sm text-mute">{descricao}</p>

      <div className="mt-7">
        <TecladoPin valor={valor} aoMudar={aoMudar} desabilitado={verificando} />
      </div>

      {verificando && (
        <p className="mt-5 text-center font-mono text-[0.68rem] uppercase tracking-[0.2em] text-faint">
          Conferindo
        </p>
      )}

      {erro && !verificando && (
        <div className="mt-5">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}

      {aoCancelar && (
        <div className="mt-5">
          <Botao tom="discreto" onClick={aoCancelar} disabled={verificando}>
            Voltar
          </Botao>
        </div>
      )}
    </Painel>
  )
}
