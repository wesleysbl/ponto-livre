import { useContext } from 'react'
import { ContextoDeAutenticacao, type ValorDoContexto } from '../contexts/autenticacao'

/**
 * Estado de acesso da pessoa logada: sessão, acesso ao ponto (`ponto_meu_acesso()`:
 * se entra, se bate, se administra, nome e cargo) e status do PIN. Todo
 * componente entra por aqui — ninguém importa o contexto direto.
 */
export function useAuth(): ValorDoContexto {
  const contexto = useContext(ContextoDeAutenticacao)
  if (!contexto) throw new Error('useAuth precisa estar dentro de um AuthProvider')
  return contexto
}

export type {
  LeituraDaAdministracao,
  LeituraDoAcesso,
  LeituraDoPin,
  ValorDoContexto,
} from '../contexts/autenticacao'
