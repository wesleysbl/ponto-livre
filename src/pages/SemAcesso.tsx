import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { LockKeyhole, LogOut, RefreshCw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { decidirSemAcesso } from '../lib/acesso'
import { LeituraIndisponivel, TelaCarregando } from '../components/EstadoDeAcesso'
import { Botao, Moldura, Painel } from '../components/ui'

/*
 * Conta sem acesso ao ponto.
 *
 * A pessoa ENTROU: o login funcionou, a senha estava certa, a sessão existe.
 * O que não existe é liberação no ponto. Dizer só "acesso negado" aqui seria
 * cruel e inútil: quem chega nesta tela não fez nada errado e não tem como se
 * desbloquear sozinho. Então a tela diz três coisas — que a conta está ok,
 * qual é o e-mail dela (é o que vão procurar na lista de pessoas) e a quem
 * pedir.
 *
 * A PORTA É A FICHA DE RH. Entra quem tem ficha de funcionário ativa ligada à
 * conta, ou quem administra o ponto. Quem chega aqui, então, não tem ficha
 * ligada, ou tem a ficha desativada ou desligada — e quem libera é o super
 * admin: ligar a ficha, reativá-la ou tirar o desligamento dá acesso ao
 * ponto, e o banco só aceita isso dele. Quem bate ponto não sabe quem é o
 * super admin da empresa, então a tela manda pedir a liberação a quem cuida do
 * ponto na empresa.
 *
 * Esta tela é espelho de uma regra que mora no banco, não substituta dela:
 * `ponto_ator_aprovado()` recusa o PIN, e a batida exige ficha que libera.
 * Quem decide se ela aparece é `ponto_meu_acesso()`, a mesma pergunta, lida
 * pelo `AuthContext` (ver `decidirSemAcesso`, em `lib/acesso.ts`).
 */
export function SemAcesso() {
  const { usuario, acesso, carregando, sair, recarregar } = useAuth()
  const [verificando, setVerificando] = useState(false)

  const decisao = decidirSemAcesso({ carregando, temUsuario: usuario !== null, acesso })
  if (decisao.tipo === 'carregando') return <TelaCarregando />
  if (decisao.tipo === 'indisponivel') return <LeituraIndisponivel motivo={decisao.motivo} />
  // Sem sessão: o login. Liberado enquanto olhava esta tela: sai dela sozinho.
  if (decisao.tipo === 'ir') return <Navigate to={decisao.para} replace />

  const email = usuario?.email ?? null
  /*
   * O nome que o banco dá à conta (ficha, nome guardado na conta, e-mail). Só
   * aparece quando é um nome de verdade: o e-mail já está na linha de cima.
   */
  const nome = acesso.estado === 'ok' && acesso.acesso.nome !== email ? acesso.acesso.nome : null

  async function verificarDeNovo() {
    setVerificando(true)
    try {
      await recarregar()
    } finally {
      setVerificando(false)
    }
  }

  async function aoSair() {
    try {
      await sair()
    } finally {
      window.location.replace('/entrar')
    }
  }

  return (
    <Moldura comSlogan={false}>
      <Painel>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-warn">
          <LockKeyhole size={22} aria-hidden="true" />
        </div>

        <h1 className="text-center text-lg font-semibold text-plat">
          Seu acesso ao ponto não está liberado
        </h1>

        <p className="mt-3 text-center text-sm leading-relaxed text-mute">
          Sua senha está certa, mas esta conta não tem uma ficha de funcionário ativa no ponto.{' '}
          <span className="text-plat-dim">Peça a liberação a quem cuida do ponto na sua empresa</span>{' '}
          e depois toque em verificar de novo.
        </p>

        <div className="mt-6 rounded-xl border border-hair bg-ink-2 px-4 py-3">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
            Conta a informar
          </p>
          <p className="mt-1.5 truncate text-sm text-plat">
            {email ?? '—'}
          </p>
          {nome && <p className="truncate text-xs text-mute">{nome}</p>}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <Botao onClick={verificarDeNovo} disabled={verificando}>
            <RefreshCw size={16} aria-hidden="true" />
            {verificando ? 'Verificando…' : 'Já fui liberado, verificar'}
          </Botao>
          <Botao tom="secundario" onClick={aoSair}>
            <LogOut size={16} aria-hidden="true" />
            Sair da conta
          </Botao>
        </div>
      </Painel>
    </Moldura>
  )
}
