import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Botao, Moldura, Painel } from './ui'

/** Espera enquanto a sessão, o acesso ao ponto e o status do PIN ainda estão chegando. */
export function TelaCarregando() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <div
        className="h-9 w-9 animate-spin rounded-full border-2 border-hair-3 border-t-luz"
        role="status"
        aria-label="Carregando"
      />
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-faint">Carregando</p>
    </div>
  )
}

/**
 * Existe sessão, mas o acesso ao ponto ou o status do PIN não puderam ser lidos.
 *
 * Falha FECHADA: sem saber se a pessoa tem acesso, nada protegido aparece.
 * E não redireciona para o login — a sessão continua válida, então o login
 * mandaria de volta para cá e viraria laço. As duas saídas honestas são tentar
 * de novo e sair da conta.
 */
export function LeituraIndisponivel({ motivo }: { motivo?: string }) {
  const { sair } = useAuth()

  async function aoSair() {
    try {
      await sair()
    } finally {
      // Recarrega para não sobrar nada da sessão anterior em memória.
      window.location.replace('/entrar')
    }
  }

  return (
    <Moldura comSlogan={false}>
      <Painel>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-warn">
          <AlertTriangle size={22} aria-hidden="true" />
        </div>

        <h1 className="text-center text-lg font-semibold text-plat">
          Não deu para carregar seus dados
        </h1>

        <p className="mt-2 text-center text-sm leading-relaxed text-mute">
          {motivo ?? 'Verifique sua conexão e tente de novo.'}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Botao onClick={() => window.location.reload()}>
            <RefreshCw size={16} aria-hidden="true" />
            Tentar de novo
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
