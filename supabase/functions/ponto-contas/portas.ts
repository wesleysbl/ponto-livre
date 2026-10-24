/*
 * PONTO-CONTAS — AS PORTAS SOBRE O SUPABASE-JS.
 *
 * Cada função abaixo é UMA chamada do supabase-js, e só. A regra (ordem,
 * desfazer, trilha, tradução) está em `atendimento.ts` e `regras.ts`.
 *
 * DOIS CLIENTES, E A SEGURANÇA DA FUNÇÃO ESTÁ NA DIFERENÇA ENTRE ELES
 *   `sessao`  — chave pública + o token DO CHAMADOR. O PostgREST roda como
 *               `authenticated`, com `auth.uid()` = o chamador, e a RLS vale.
 *               É por ele que se pergunta `ponto_sou_super_admin()` e que se
 *               renomeia e se liga a ficha (a policy de UPDATE da ficha é de
 *               quem administra, e o gatilho da ficha exige super admin
 *               para ligar — com `auth.uid()` nulo, ele deixaria passar).
 *   `servico` — chave de serviço, sem token de ninguém. Só para o que o app
 *               não pode: a Admin API do login, a lista de super admins e a
 *               trilha de contas. Aqui `auth.uid()` é NULO, e por isso
 *               nenhuma pergunta de permissão passa por este cliente.
 *
 * AS PORTAS TOCAM O LOGIN, A FICHA, A LISTA DE SUPER ADMINS E A TRILHA (e só
 * eles: `src/ponto-contas.test.ts` confere a lista). O nome mora no login e na
 * ficha; o e-mail, no login.
 *
 * O NOME DO LOGIN MORA NO `app_metadata`, E NÃO NO `user_metadata`. O
 * `user_metadata` a própria pessoa edita pela API do login, sem esta função e
 * sem trilha; o `app_metadata` só a chave de serviço grava. É dele que o banco
 * tira o nome que o admin vê (`ponto_contas()`) e o que a batida fotografa
 * (`ponto_nome_da_conta`), e é só nele que esta função escreve e lê.
 *
 * POR QUE O TIPO DO CLIENTE É ESCRITO AQUI, E NÃO IMPORTADO DO SUPABASE-JS
 * Este arquivo é importado pelo Vitest e pelo `tsc` do app (ver o cabeçalho de
 * `regras.ts`), e lá não existe `npm:@supabase/supabase-js`. A interface
 * abaixo é o pedaço do supabase-js 2.x que estas portas usam, com os mesmos
 * nomes e formatos; `index.ts` entrega o cliente de verdade, e os testes
 * entregam o Supabase simulado. Se o supabase-js mudar o formato de `auth` ou
 * de `rpc`, quem pega é o `tsc -b` do build: `src/ponto-contas.test.ts` confere
 * esta interface contra o `SupabaseClient` instalado, e exige que ele seja a
 * mesma versão que `index.ts` importa. O formato de `from()` (PostgREST) fica
 * com o Supabase simulado de `src/ponto-contas.test.ts`.
 */
import { ErroDePorta } from './regras.ts'
import type { Ficha, Login, Portas, PortasDaSessao, PortasDoServico } from './atendimento.ts'

/* ------------------------------------------------------------------ */
/* O pedaço do supabase-js que as portas usam                          */
/* ------------------------------------------------------------------ */

export interface ErroDoSupabase {
  message: string
  code?: string | null
  status?: number | null
  name?: string
  /** `AuthWeakPasswordError.reasons`: `length`, `characters`, `pwned`. */
  reasons?: string[]
  details?: string | null
  hint?: string | null
}

export interface RespostaDoSupabase<T> {
  data: T | null
  error: ErroDoSupabase | null
}

export interface UsuarioDoAuth {
  id: string
  email?: string | null
  app_metadata?: Record<string, unknown> | null
}

export type LinhaDoBanco = Record<string, unknown>

/** O construtor de consulta do PostgREST: encadeia filtros e, no `await`, responde. */
export interface ConsultaDoSupabase extends PromiseLike<RespostaDoSupabase<LinhaDoBanco[]>> {
  eq(coluna: string, valor: unknown): ConsultaDoSupabase
  /** `IS NULL` do PostgREST: é o que faz a ligação da ficha só acontecer se ela ainda não tiver conta. */
  is(coluna: string, valor: null): ConsultaDoSupabase
  select(colunas: string): ConsultaDoSupabase
}

export interface TabelaDoSupabase {
  select(colunas: string): ConsultaDoSupabase
  update(valores: LinhaDoBanco): ConsultaDoSupabase
  insert(valores: LinhaDoBanco): ConsultaDoSupabase
}

export interface AtributosDoLogin {
  email?: string
  password?: string
  email_confirm?: boolean
  app_metadata?: Record<string, unknown>
}

export interface ClienteDoSupabase {
  from(tabela: string): TabelaDoSupabase
  rpc(funcao: string, argumentos?: Record<string, unknown>): PromiseLike<RespostaDoSupabase<unknown>>
  auth: {
    getUser(jwt?: string): Promise<RespostaDoSupabase<{ user: UsuarioDoAuth | null }>>
    admin: {
      getUserById(id: string): Promise<RespostaDoSupabase<{ user: UsuarioDoAuth | null }>>
      listUsers(parametros: { page: number; perPage: number }): Promise<RespostaDoSupabase<{ users: UsuarioDoAuth[] }>>
      createUser(atributos: AtributosDoLogin): Promise<RespostaDoSupabase<{ user: UsuarioDoAuth | null }>>
      updateUserById(id: string, atributos: AtributosDoLogin): Promise<RespostaDoSupabase<{ user: UsuarioDoAuth | null }>>
      deleteUser(id: string): Promise<RespostaDoSupabase<unknown>>
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tradução do formato                                                 */
/* ------------------------------------------------------------------ */

const erroDaAuth = (erro: ErroDoSupabase) =>
  new ErroDePorta('auth', erro.message, { codigo: erro.code ?? null, status: erro.status ?? null, motivos: erro.reasons ?? [] })

const erroDoBanco = (erro: ErroDoSupabase) => new ErroDePorta('banco', erro.message, { codigo: erro.code ?? null })

/**
 * O `full_name` do `app_metadata`, que é onde esta função guarda o nome. O do
 * `user_metadata` não vale (a pessoa o escreve sozinha) e não é lido nem como
 * reserva.
 */
function nomeDoLogin(usuario: UsuarioDoAuth): string | null {
  const nome = usuario.app_metadata?.full_name
  return typeof nome === 'string' ? nome : null
}

const paraLogin = (usuario: UsuarioDoAuth): Login => ({
  id: usuario.id,
  email: usuario.email ?? null,
  nome: nomeDoLogin(usuario),
})

const paraFicha = (linha: LinhaDoBanco): Ficha => ({
  id: String(linha.id),
  nome: String(linha.nome_completo ?? ''),
  usuarioId: typeof linha.usuario_id === 'string' ? linha.usuario_id : null,
})

async function linhas(consulta: PromiseLike<RespostaDoSupabase<LinhaDoBanco[]>>): Promise<LinhaDoBanco[]> {
  const { data, error } = await consulta
  if (error) throw erroDoBanco(error)
  return data ?? []
}

/**
 * Escrita que tem de mexer em ao menos uma linha: zero linhas é recusa calada
 * da RLS, linha que sumiu ou (com filtro de condição) linha que já mudou.
 * `porque` troca a explicação genérica pela do caso.
 */
async function exigirLinha(
  consulta: PromiseLike<RespostaDoSupabase<LinhaDoBanco[]>>,
  oQue: string,
  porque = 'a permissão não deixou, ou a linha não existe mais',
): Promise<LinhaDoBanco> {
  const resultado = await linhas(consulta)
  if (resultado.length === 0) {
    throw new ErroDePorta('banco', `O banco não mudou ${oQue}: nenhuma linha foi gravada (${porque}).`, {
      codigo: 'nenhuma_linha',
    })
  }
  return resultado[0]
}

/** Teto de páginas: 1000 por página, 100 páginas. Acima disso é defeito, não crescimento. */
const POR_PAGINA = 1000
const PAGINAS_NO_MAXIMO = 100

/* ------------------------------------------------------------------ */
/* As portas                                                           */
/* ------------------------------------------------------------------ */

const COLUNAS_DA_FICHA = 'id, nome_completo, usuario_id'

export function criarPortas(
  clientes: { sessao: ClienteDoSupabase; servico: ClienteDoSupabase },
  token: string,
  anotar: Portas['anotar'],
): Portas {
  const { sessao: clienteDaSessao, servico: clienteDoServico } = clientes

  const sessao: PortasDaSessao = {
    async quemChama() {
      const { data, error } = await clienteDaSessao.auth.getUser(token)
      if (error || !data?.user) {
        throw new ErroDePorta('sessao', error?.message ?? 'O login não reconheceu o token.', {
          codigo: error?.code ?? null,
          status: error?.status ?? null,
        })
      }
      return { id: data.user.id, email: data.user.email ?? null }
    },

    async souSuperAdmin() {
      const { data, error } = await clienteDaSessao.rpc('ponto_sou_super_admin')
      if (error) throw erroDoBanco(error)
      return data === true
    },

    async lerFichas(usuarioId) {
      const resultado = await linhas(
        clienteDaSessao.from('ponto_funcionarios').select(COLUNAS_DA_FICHA).eq('usuario_id', usuarioId),
      )
      return resultado.map(paraFicha)
    },

    async lerFicha(fichaId) {
      const resultado = await linhas(clienteDaSessao.from('ponto_funcionarios').select(COLUNAS_DA_FICHA).eq('id', fichaId))
      return resultado[0] ? paraFicha(resultado[0]) : null
    },

    async renomearFicha(fichaId, nome) {
      await exigirLinha(
        clienteDaSessao.from('ponto_funcionarios').update({ nome_completo: nome }).eq('id', fichaId).select('id'),
        'a ficha',
      )
    },

    async ligarFicha(fichaId, usuarioId) {
      // Só `usuario_id`, e só onde ele ainda é nulo: a ficha nunca troca de
      // dono em silêncio (o mesmo filtro de `vincularFicha`, no app).
      await exigirLinha(
        clienteDaSessao
          .from('ponto_funcionarios')
          .update({ usuario_id: usuarioId })
          .eq('id', fichaId)
          .is('usuario_id', null)
          .select('id'),
        'a ficha',
        'ela já tem conta — outra aba ligou antes —, não existe mais, ou a permissão não deixou',
      )
    },
  }

  const servico: PortasDoServico = {
    async trilhaPronta() {
      const { data, error } = await clienteDoServico.rpc('ponto_contas_trilha_pronta')
      if (error) throw erroDoBanco(error)
      return data === true
    },

    async lerLogin(usuarioId) {
      const { data, error } = await clienteDoServico.auth.admin.getUserById(usuarioId)
      if (error) {
        if (error.status === 404 || error.code === 'user_not_found') return null
        throw erroDaAuth(error)
      }
      return data?.user ? paraLogin(data.user) : null
    },

    /*
     * ATÉ A PÁGINA VAZIA, E NÃO ATÉ A PÁGINA CURTA. O login pode devolver
     * MENOS que `perPage` sem a lista ter acabado — o servidor tem teto
     * próprio de página, e não promete honrar o pedido. Parar na página curta deixaria logins de fora, e a conferência
     * de e-mail repetido (`acharEmailRepetido`) diria "livre" para um e-mail
     * que já existe. Uma página vazia é a única prova de fim.
     */
    async listarLogins() {
      const todos: Login[] = []
      for (let pagina = 1; pagina <= PAGINAS_NO_MAXIMO; pagina++) {
        const { data, error } = await clienteDoServico.auth.admin.listUsers({ page: pagina, perPage: POR_PAGINA })
        if (error) throw erroDaAuth(error)
        const usuarios = data?.users ?? []
        if (usuarios.length === 0) return todos
        todos.push(...usuarios.map(paraLogin))
      }
      throw new ErroDePorta('auth', `Mais de ${PAGINAS_NO_MAXIMO * POR_PAGINA} logins: a lista não terminou.`)
    },

    async criarLogin({ email, senha, nome }) {
      const { data, error } = await clienteDoServico.auth.admin.createUser({
        email,
        password: senha,
        // E-mail confirmado: a conta entra direto, sem e-mail de confirmação.
        email_confirm: true,
        app_metadata: { full_name: nome },
      })
      if (error) throw erroDaAuth(error)
      if (!data?.user) throw new ErroDePorta('auth', 'O login não devolveu a conta criada.')
      return paraLogin(data.user)
    },

    async trocarEmailDoLogin(usuarioId, email) {
      // `email_confirm: true`: pela Admin API a troca vale na hora, sem o
      // e-mail de confirmação que a troca pela própria pessoa exigiria.
      const { error } = await clienteDoServico.auth.admin.updateUserById(usuarioId, { email, email_confirm: true })
      if (error) throw erroDaAuth(error)
    },

    async trocarNomeDoLogin(usuarioId, nome) {
      // O login MESCLA o `app_metadata`: só `full_name` muda (o `provider` e o
      // `providers` do login ficam). `null` tira a chave.
      const { error } = await clienteDoServico.auth.admin.updateUserById(usuarioId, { app_metadata: { full_name: nome } })
      if (error) throw erroDaAuth(error)
    },

    async trocarSenhaDoLogin(usuarioId, senha) {
      // A troca pela Admin API encerra as sessões abertas da conta: o refresh
      // token de quem estava logado deixa de renovar (o e2e da função de
      // contas confere). O access token já emitido vale até vencer (o
      // `jwt_expiry` do projeto, 1 hora no padrão).
      const { error } = await clienteDoServico.auth.admin.updateUserById(usuarioId, { password: senha })
      if (error) throw erroDaAuth(error)
    },

    async removerLogin(usuarioId) {
      const { error } = await clienteDoServico.auth.admin.deleteUser(usuarioId)
      if (error) throw erroDaAuth(error)
    },

    async contaEhSuperAdmin(usuarioId) {
      const resultado = await linhas(
        clienteDoServico.from('ponto_super_admins').select('usuario_id').eq('usuario_id', usuarioId),
      )
      return resultado.length > 0
    },

    async gravarTrilha(linha) {
      const gravada = await exigirLinha(
        clienteDoServico.from('ponto_contas_trilha').insert({ ...linha }).select('id'),
        'a trilha de contas',
      )
      return String(gravada.id)
    },
  }

  return { sessao, servico, anotar }
}
