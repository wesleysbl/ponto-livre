import { createContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { StatusDoPin } from '../lib/pin'
import type { AcessoAoPonto } from '../lib/acesso'

/*
 * O contrato do estado de acesso — tipos e o objeto de contexto, sem nenhum
 * componente.
 *
 * POR QUE ESTE ARQUIVO É SEPARADO DE AuthContext.tsx
 * O Fast Refresh do Vite só preserva estado quando um módulo exporta apenas
 * componentes. Um arquivo que exporta `<AuthProvider>` e mais um contexto ou um
 * hook perde essa garantia e o app remonta a cada salvamento — o que, num app
 * de PIN, significa perder o que estava digitado. Daí a divisão em três:
 * este arquivo tem o contrato, `AuthContext.tsx` tem só o provedor, e
 * `hooks/useAuth.ts` tem só o hook.
 */

export type LeituraDoPin =
  | { estado: 'carregando' }
  | { estado: 'ok'; status: StatusDoPin }
  | { estado: 'falhou'; erro: string }

/**
 * Esta pessoa administra o ponto?
 *
 * Administrar o ponto é estar em `public.ponto_admins` ou ser super admin, e a
 * pergunta é a mesma das policies. Assim, quem entra em `/painel` é quem a RLS
 * deixa ler as batidas de todos. A RLS recusa calada, como deve: com outra
 * pergunta, a tela de nomes abriria com zero batidas para todos, sem mensagem
 * de erro.
 *
 * A resposta certa vem da RPC `ponto_pode_administrar()`, que é assíncrona.
 * Por isso ela é um ESTADO com `carregando`, e não um booleano: um booleano
 * começaria em `false`, e a guarda piscaria o redirecionamento antes de saber.
 */
export type LeituraDaAdministracao =
  | { estado: 'carregando' }
  | { estado: 'ok'; administra: boolean }
  | { estado: 'falhou'; erro: string }

/**
 * O acesso ao ponto, como o BANCO o responde.
 *
 * `ponto_meu_acesso()` diz, com a sessão de quem chama, se ela entra no ponto
 * (ficha que libera OU administração), de onde vem o acesso, se ela administra,
 * se é super admin, se bate ponto, e o nome e o cargo pelos quais a tela a
 * chama. Três estados, como a administração: começar em `false` faria a guarda
 * piscar o redirecionamento antes de saber. Ver `lib/acesso.ts`.
 */
export type LeituraDoAcesso =
  | { estado: 'carregando' }
  | { estado: 'ok'; acesso: AcessoAoPonto }
  | { estado: 'falhou'; erro: string }

export interface ValorDoContexto {
  usuario: User | null
  pin: LeituraDoPin
  /**
   * O acesso ao ponto, o papel (admin, super admin), se bate ponto, o nome e o
   * cargo, lidos de `ponto_meu_acesso()`. É o que a guarda de rota decide — e
   * a única leitura da conta além do PIN.
   */
  acesso: LeituraDoAcesso
  /**
   * Se esta sessão administra o ponto (a lista `ponto_admins`, ou super
   * admin). É DERIVADA de `acesso` (`administracaoDoAcesso`): a mesma resposta,
   * sem uma segunda ida ao banco.
   */
  administracao: LeituraDaAdministracao
  /** Verdadeiro até a primeira resposta sobre a sessão chegar. */
  carregando: boolean
  entrar: (email: string, senha: string) => Promise<{ erro: string | null }>
  sair: () => Promise<void>
  /**
   * Relê o status do PIN e o acesso ao ponto. É como um reset feito pelo
   * admin chega aqui — e também como uma concessão ou revogação de
   * administração chega: "revogar fecha o painel na recarga seguinte" depende
   * desta releitura. É também como a ficha ligada pelo super admin chega a quem
   * estava na tela "sem acesso".
   */
  recarregar: () => Promise<void>
}

export const ContextoDeAutenticacao = createContext<ValorDoContexto | null>(null)
