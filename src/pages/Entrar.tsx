import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { telaInicial } from '../lib/acesso'
import { TelaCarregando } from '../components/EstadoDeAcesso'
import { Aviso, Botao, Campo, Moldura, Painel } from '../components/ui'
import { ConviteParaInstalar } from '../components/ConviteParaInstalar'

/*
 * Entrada no app.
 *
 * AS CONTAS SÃO DO PONTO: o login é o do próprio banco do ponto, com e-mail
 * e senha. Não existe cadastro aqui, nem "esqueci a senha": quem cria a conta e
 * redefine a senha é o super admin, pela lista de pessoas da administração —
 * não o RH, que reseta o PIN e corrige o ponto. Quem chega aqui não sabe quem
 * é o super admin da empresa, então a tela não nomeia o papel: manda falar com
 * quem cuida do ponto na empresa.
 *
 * Depois de entrar, a tela só escolhe a PRIMEIRA tela (`telaInicial`): quem
 * administra e não bate cai no painel; o resto, na tela de bater. Quem roteia
 * de verdade continua sendo a RotaProtegida, que olha o acesso e o PIN — e leva
 * quem não tem PIN para criá-lo antes.
 */
export function Entrar() {
  const { usuario, acesso, carregando, entrar } = useAuth()

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  /*
   * A espera vem ANTES do formulário de propósito. O app instalado reabre com a
   * sessão guardada no aparelho, e mostrar o login por um instante antes de
   * restaurá-la faria parecer que o login não ficou salvo.
   */
  if (carregando) return <TelaCarregando />
  if (usuario) {
    // Entrou: espera o acesso chegar para não mandar para a tela de bater e,
    // um instante depois, para o painel.
    const destino = telaInicial(acesso)
    return destino === null ? <TelaCarregando /> : <Navigate to={destino} replace />
  }

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    if (enviando) return

    setErro(null)
    setEnviando(true)
    const { erro: falha } = await entrar(email, senha)
    if (falha) {
      setErro(falha)
      setEnviando(false)
    }
    // Deu certo: o contexto troca de estado e o <Navigate> acima assume. Não
    // desligamos `enviando`, para o botão não voltar ao normal por um quadro
    // antes da tela trocar.
  }

  return (
    <Moldura>
      {/*
        O convite para instalar vem ANTES do cartão de entrar: no iPhone, o
        ícone da tela de início não aproveita o login feito no Safari. Some
        sozinho no computador, no app instalado e por 7 dias depois do "Agora
        não" (ver o cabeçalho de ConviteParaInstalar).
      */}
      <ConviteParaInstalar />

      <Painel>
        <h1 className="text-center text-lg font-semibold text-plat">Entrar</h1>
        <p className="mt-1 text-center text-sm text-mute">
          Use o e-mail e a senha da sua conta do ponto.
        </p>

        <form onSubmit={aoEnviar} className="mt-6 flex flex-col gap-4">
          <Campo
            id="email"
            rotulo="E-mail"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@example.com"
            disabled={enviando}
          />

          <Campo
            id="senha"
            rotulo="Senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="••••••••"
            disabled={enviando}
          />

          {erro && <Aviso tom="erro">{erro}</Aviso>}

          <Botao type="submit" disabled={enviando || !email || !senha}>
            <LogIn size={16} aria-hidden="true" />
            {enviando ? 'Entrando…' : 'Entrar'}
          </Botao>
        </form>
      </Painel>

      <p className="mt-6 text-center text-xs leading-relaxed text-faint">
        Esqueceu a senha ou ainda não tem conta? Fale com quem cuida do ponto na sua empresa.
      </p>
    </Moldura>
  )
}
