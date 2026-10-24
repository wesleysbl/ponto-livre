import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { decidirRota } from '../lib/acesso'
import { LeituraIndisponivel, TelaCarregando } from './EstadoDeAcesso'

/*
 * A guarda de rota. Ela responde a uma pergunta só — "esta pessoa pode ver esta
 * tela agora?" — e a resposta sai de uma escada de degraus na ordem em que o
 * app fica sabendo das coisas: sessão, acesso ao ponto, administração do
 * ponto, PIN.
 *
 * A ESCADA MORA EM `lib/acesso.ts` (`decidirRota`), pura e testada degrau por
 * degrau. Aqui só se traduz a decisão em tela. O acesso é o do banco do ponto
 * (`ponto_meu_acesso()`: ficha que libera OU administração), com teste dizendo
 * que o administrador sem ficha passa, que a ficha desligada vai para "sem
 * acesso" e que ninguém sem resposta do banco passa.
 *
 * FALHA FECHADA. Enquanto uma leitura não chega, nada protegido é renderizado;
 * se a leitura falha, mostra a tela de retentativa em vez de deixar passar.
 * Vale lembrar que isto é conveniência de interface, não segurança: quem manda
 * é a RLS, no Postgres. Um funcionário que forçasse a rota na marra continuaria
 * sem conseguir inserir batida nem salvar configuração, porque as policies
 * recusam — e as de administração perguntam a `ponto_pode_administrar()`.
 */
export function RotaProtegida({
  children,
  /**
   * A tela de definir PIN precisa de tudo isto MENOS o PIN — é justamente ela
   * que vai criá-lo. Nesse caso a guarda para no degrau do acesso.
   */
  exigePin = true,
  /**
   * O painel do admin e a área de administração.
   *
   * A PERGUNTA É A MESMA DAS POLICIES: quem entra no `/painel` é quem a RLS
   * deixa ler as batidas de todos. Por qualquer outra regra, alguém que as
   * policies recusam veria a lista de nomes com ZERO batidas para todos, sem
   * erro em lugar nenhum — porque a RLS recusa calada, que é exatamente o que
   * ela deve fazer. Um painel que mente é pior do que uma porta fechada.
   *
   * A resposta vem de `ponto_meu_acesso().administra`, que é a mesma
   * `ponto_pode_administrar()` das policies — o super admin incluído. Continua não
   * protegendo nada: quem recusa a consulta, a correção, a inserção e a
   * gravação da configuração é a RLS, a cada chamada. Esta linha existe para
   * não desenhar uma tela vazia para quem não pode usá-la.
   */
  exigeAdmin = false,
}: {
  children: ReactNode
  exigePin?: boolean
  exigeAdmin?: boolean
}) {
  const { usuario, acesso, pin, carregando } = useAuth()

  const decisao = decidirRota(
    { carregando, temUsuario: usuario !== null, acesso, pin },
    { exigePin, exigeAdmin },
  )

  switch (decisao.tipo) {
    case 'carregando':
      return <TelaCarregando />
    case 'indisponivel':
      return <LeituraIndisponivel motivo={decisao.motivo} />
    case 'ir':
      return <Navigate to={decisao.para} replace />
    case 'mostrar':
      return <>{children}</>
  }
}
