import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  atender,
  executarPassos,
  type AbrirPortas,
  type Passo,
  type RespostaHttp,
} from '../supabase/functions/ponto-contas/atendimento.ts'
import {
  criarPortas,
  type AtributosDoLogin,
  type ClienteDoSupabase,
  type ConsultaDoSupabase,
  type ErroDoSupabase,
  type LinhaDoBanco,
  type RespostaDoSupabase,
  type TabelaDoSupabase,
  type UsuarioDoAuth,
} from '../supabase/functions/ponto-contas/portas.ts'
import {
  ACOES,
  CHAVES_DE_SENHA,
  COLUNAS_DA_TRILHA,
  CORPO_MAXIMO_BYTES,
  ErroDePorta,
  corpoDeclaradoGrandeDemais,
} from '../supabase/functions/ponto-contas/regras.ts'

/*
 * A EDGE FUNCTION DE CONTAS, DE PONTA A PONTA, CONTRA UM SUPABASE SIMULADO.
 *
 * O caminho testado é o de produção inteiro, menos o `Deno.serve` e o
 * `createClient`: `atender` (atendimento.ts) → `criarPortas` (portas.ts) →
 * os mesmos métodos do supabase-js que a função chama. Quem responde é o
 * banco simulado abaixo: logins (Admin API do login), fichas, super admins, a
 * trilha — e uma sessão por token. Nada de rede.
 *
 * O SIMULADO É O BANCO DO PONTO, e só conhece o que a função usa: o login
 * (Admin API), a ficha, a lista de super admins e a trilha. Qualquer outra
 * tabela ou RPC responde erro e fica anotada — e o teste "a função só toca o
 * login, a ficha, a lista de super admins e a trilha" passa as quatro ações
 * por ele.
 *
 * O SIMULADO IMITA O QUE IMPORTA, e foi escrito para pegar o erro mais caro:
 *   • `ponto_sou_super_admin()` responde false para o cliente de SERVIÇO (lá
 *     não há `auth.uid()`). Se a função perguntasse com a chave de serviço, o
 *     super admin levaria 403 aqui — e o teste do super admin quebraria.
 *   • a ficha só muda pela sessão de quem administra (a RLS), ligar a ficha a
 *     uma conta exige super admin (o gatilho da ficha), e o cliente de
 *     serviço nem a enxerga: se a função passar a usar a chave de serviço
 *     para a ficha, o teste quebra.
 *   • a trilha aceita só as colunas do `GRANT INSERT (...)` do SQL da trilha e
 *     recusa as chaves de senha do CHECK de lá — lidas DO ARQUIVO, não
 *     copiadas para cá.
 *   • `ponto_registros` responde erro e fica anotado: a função não pode
 *     tocar nas batidas ("as batidas antigas guardam o nome e o e-mail da
 *     época").
 *
 * O que se prova, item a item:
 *   • criar conta (com e sem ficha ligada no mesmo pedido);
 *   • trocar nome, em conta com ficha (login e ficha) e sem ficha (só login);
 *   • trocar e-mail (só no login) e recusar e-mail repetido (pelo login);
 *   • redefinir senha;
 *   • sem sessão: 401; quem não é super admin: 403, e nada muda.
 * O que só um Supabase de verdade prova (o login, a RLS e os gatilhos reais)
 * não passa por aqui: este arquivo não usa rede.
 */

/* ------------------------------------------------------------------ */
/* O SQL da trilha (a migration da estrutura), de onde o simulado tira as regras */
/* ------------------------------------------------------------------ */

const lerPasta = (arquivos: Record<string, string>) =>
  Object.fromEntries(Object.entries(arquivos).map(([caminho, texto]) => [caminho.split('/').pop() ?? caminho, texto]))

const codigoDaFuncao = lerPasta(
  import.meta.glob<string>('../supabase/functions/ponto-contas/*.ts', { query: '?raw', import: 'default', eager: true }),
)
const migrations = lerPasta(
  import.meta.glob<string>('../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }),
)

/** O package-lock do app: diz qual supabase-js está instalado — é contra ele que o `tsc` confere `portas.ts`. */
const PACOTE_TRAVADO =
  Object.values(import.meta.glob<string>('../package-lock.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '{}'

/*
 * A trilha de contas nasce na migration da estrutura do banco, uma só, com o
 * banco inteiro: `<version>_ponto_livre_estrutura.sql`. Ela é achada pelo
 * nome; sem ela (ou com duas), o texto fica vazio e os testes da trilha
 * quebram, em vez de passar no vazio.
 */
const ARQUIVOS_DA_TRILHA = Object.keys(migrations).filter((nome) => /^\d{14}_ponto_livre_estrutura\.sql$/.test(nome))
const SQL_DA_TRILHA = ARQUIVOS_DA_TRILHA.length === 1 ? migrations[ARQUIVOS_DA_TRILHA[0]] : ''

const colunasDoGrant = (/GRANT\s+INSERT\s*\(([^)]*)\)\s*ON\s+public\.ponto_contas_trilha\s+TO\s+service_role/i.exec(SQL_DA_TRILHA)?.[1] ?? '')
  .split(',')
  .map((coluna) => coluna.trim())
  .filter(Boolean)

// O CHECK sem senha é uma linha só no CREATE TABLE da trilha.
const trechoDoCheckSemSenha = /CONSTRAINT\s+ponto_contas_trilha_sem_senha\s+CHECK\s*\((.*)\)/i.exec(SQL_DA_TRILHA)?.[1] ?? ''
/*
 * O CHECK chama `ponto_contas_tem_chave_de_senha(jsonb)`, que compara sem
 * diferenciar maiúsculas (o que um `jsonb_path_exists` não faria). As chaves
 * moram no corpo da função, em `lower(v_chave) = ANY (ARRAY[...])`.
 */
const corpoDaFuncaoDoCheck =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.ponto_contas_tem_chave_de_senha\s*\([\s\S]*?\bAS\s+\$\$([\s\S]*?)\$\$/i.exec(SQL_DA_TRILHA)?.[1] ?? ''
const chavesDoCheckSemSenha = [
  ...(/lower\(\s*v_chave\s*\)\s*=\s*ANY\s*\(\s*ARRAY\[([^\]]*)\]/i.exec(corpoDaFuncaoDoCheck)?.[1] ?? '').matchAll(/'(\w+)'/g),
].map((casamento) => casamento[1])

// As ações do CHECK, como o banco as escreve: `acao = ANY (ARRAY['criar_conta'::text, ...])`.
const acoesDoCheck = [
  ...(/ponto_contas_trilha_acao_valida\s+CHECK\s*\(\(acao\s*=\s*ANY\s*\(ARRAY\[([^\]]*)\]/i.exec(SQL_DA_TRILHA)?.[1] ?? '').matchAll(/'(\w+)'/g),
].map((casamento) => casamento[1])

/* ------------------------------------------------------------------ */
/* O banco do ponto, simulado                                          */
/* ------------------------------------------------------------------ */

const SUPER = '00000000-0000-4000-8000-000000000001'
/** Admin do ponto sem ficha: só administra. O nome dele mora só no login. */
const ADMIN = '00000000-0000-4000-8000-000000000002'
const BRUNA = '00000000-0000-4000-8000-000000000003'
const OUTRO = '00000000-0000-4000-8000-000000000004'
/** Conta criada sem ficha e sem papel no ponto (a tela ainda não ligou a ficha). */
const SO_LOGIN = '00000000-0000-4000-8000-000000000005'
const FICHA_DA_BRUNA = '00000000-0000-4000-8000-0000000000f1'
/** Ficha ativa sem conta: a que a conta nova liga. */
const FICHA_LIVRE = '00000000-0000-4000-8000-0000000000f2'
const NINGUEM = '00000000-0000-4000-8000-0000000000ee'

const TOKEN_DO_SUPER = 'token-do-super'
const TOKEN_DO_ADMIN = 'token-do-admin'
const TOKEN_DA_BRUNA = 'token-da-bruna'

interface LoginSimulado {
  id: string
  email: string
  senha: string
  app_metadata: Record<string, unknown>
  email_confirmado: boolean
}
interface FichaSimulada {
  id: string
  usuario_id: string | null
  nome_completo: string
}

interface Banco {
  logins: LoginSimulado[]
  fichas: FichaSimulada[]
  superAdmins: string[]
  admins: string[]
  trilha: LinhaDoBanco[]
  /** `ausente` = o SQL da trilha não foi aplicado: a pergunta nem existe. */
  trilhaPronta: boolean | 'ausente'
  sessoes: Record<string, string>
  minimoDaSenhaNoLogin: number
  /** O teto de página do login: ele pode devolver MENOS que o `perPage` pedido sem a lista ter acabado. */
  tetoDaPaginaDoLogin?: number
  proximoId: number
  /** Cada chamada, como `papel:operacao`. */
  chamadas: string[]
  /** Erro forçado para uma operação (`sessao:ponto_funcionarios.update`), ou null. */
  falhar: (operacao: string) => ErroDoSupabase | null
}

function novoBanco(mudancas: Partial<Banco> = {}): Banco {
  return {
    logins: [
      { id: SUPER, email: 'admin@example.com', senha: 'senha-do-super', app_metadata: { full_name: 'Sérgio' }, email_confirmado: true },
      { id: ADMIN, email: 'administracao@example.com', senha: 'senha-do-admin', app_metadata: { full_name: 'Admin Comum' }, email_confirmado: true },
      { id: BRUNA, email: 'bruna@example.com', senha: 'senha-da-bruna', app_metadata: { full_name: 'Bruna Costa' }, email_confirmado: true },
      { id: OUTRO, email: 'outro@example.com', senha: 'senha-do-outro', app_metadata: {}, email_confirmado: true },
      { id: SO_LOGIN, email: 'so-login@example.com', senha: 'senha-so-login', app_metadata: { full_name: 'Só Login' }, email_confirmado: true },
    ],
    fichas: [
      { id: FICHA_DA_BRUNA, usuario_id: BRUNA, nome_completo: 'Bruna Costa' },
      { id: FICHA_LIVRE, usuario_id: null, nome_completo: 'Pessoa Sem Conta' },
    ],
    superAdmins: [SUPER],
    admins: [SUPER, ADMIN],
    trilha: [],
    trilhaPronta: true,
    sessoes: { [TOKEN_DO_SUPER]: SUPER, [TOKEN_DO_ADMIN]: ADMIN, [TOKEN_DA_BRUNA]: BRUNA },
    minimoDaSenhaNoLogin: 6,
    proximoId: 100,
    chamadas: [],
    falhar: () => null,
    ...mudancas,
  }
}

/** Tudo o que a função poderia mudar, para conferir "nada muda". */
const fotografia = (banco: Banco) => JSON.stringify([banco.logins, banco.fichas, banco.trilha])

interface EstadoDaConsulta {
  tabela: string
  operacao: 'select' | 'update' | 'insert'
  colunas: string | null
  valores: LinhaDoBanco | null
  filtros: [string, unknown][]
}

function consulta(
  estado: EstadoDaConsulta,
  executar: (estado: EstadoDaConsulta) => RespostaDoSupabase<LinhaDoBanco[]>,
): ConsultaDoSupabase {
  const eu: ConsultaDoSupabase = {
    eq(coluna, valor) {
      estado.filtros.push([coluna, valor])
      return eu
    },
    // `IS NULL`: na comparação estrita de `lerLinhas`, nulo só casa com nulo.
    is(coluna, valor) {
      estado.filtros.push([coluna, valor])
      return eu
    },
    select(colunas) {
      estado.colunas = colunas
      return eu
    },
    then(aoCumprir, aoFalhar) {
      return Promise.resolve(executar(estado)).then(aoCumprir, aoFalhar)
    },
  }
  return eu
}

function projetar(linha: LinhaDoBanco, colunas: string | null): LinhaDoBanco {
  if (!colunas) return { ...linha }
  return Object.fromEntries(colunas.split(',').map((coluna) => [coluna.trim(), linha[coluna.trim()]]))
}

function lerLinhas(linhas: LinhaDoBanco[], estado: EstadoDaConsulta): LinhaDoBanco[] {
  return linhas.filter((linha) => estado.filtros.every(([coluna, valor]) => linha[coluna] === valor))
}

/** Como a função do CHECK: em qualquer nível, sem diferenciar maiúsculas (`lower()`). */
function temChaveDeSenha(valor: unknown, chaves: readonly string[]): boolean {
  if (Array.isArray(valor)) return valor.some((item) => temChaveDeSenha(item, chaves))
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor).some(([chave, item]) => chaves.includes(chave.toLowerCase()) || temChaveDeSenha(item, chaves))
  }
  return false
}

function clienteSimulado(banco: Banco, papel: 'sessao' | 'servico', token: string | null): ClienteDoSupabase {
  const uid = papel === 'sessao' && token ? (banco.sessoes[token] ?? null) : null
  const administra = uid !== null && (banco.admins.includes(uid) || banco.superAdmins.includes(uid))
  const superAdmin = uid !== null && banco.superAdmins.includes(uid)

  const registrar = (operacao: string): ErroDoSupabase | null => {
    banco.chamadas.push(`${papel}:${operacao}`)
    return banco.falhar(`${papel}:${operacao}`)
  }
  const ok = <T,>(data: T): RespostaDoSupabase<T> => ({ data, error: null })
  const erro = <T,>(e: ErroDoSupabase): RespostaDoSupabase<T> => ({ data: null, error: e })
  const naoEAdmin: ErroDoSupabase = { message: 'User not allowed', status: 403, code: 'not_admin', name: 'AuthApiError' }
  const paraUsuario = (login: LoginSimulado): UsuarioDoAuth => ({ id: login.id, email: login.email, app_metadata: { ...login.app_metadata } })
  const acharLogin = (id: string) => banco.logins.find((login) => login.id === id)
  const emailUsado = (email: string, exceto: string | null) =>
    banco.logins.some((login) => login.id !== exceto && login.email.toLowerCase() === email.toLowerCase())
  const senhaFraca = (senha: string): ErroDoSupabase | null =>
    senha.length < banco.minimoDaSenhaNoLogin
      ? { message: `Password should be at least ${banco.minimoDaSenhaNoLogin} characters.`, status: 422, code: 'weak_password', reasons: ['length'] }
      : null

  function executar(estado: EstadoDaConsulta): RespostaDoSupabase<LinhaDoBanco[]> {
    const falha = registrar(`${estado.tabela}.${estado.operacao}`)
    if (falha) return erro(falha)

    if (estado.tabela === 'ponto_funcionarios') {
      // A RLS da ficha: quem administra lê e muda todas; o resto, só lê a própria.
      // O cliente de serviço da função não deveria nem passar por aqui.
      if (papel === 'servico') return erro({ message: 'simulado: a função não mexe na ficha com a chave de serviço', code: 'simulado' })
      const fichas = banco.fichas as unknown as LinhaDoBanco[]
      const visiveis = fichas.filter((ficha) => administra || ficha.usuario_id === uid)
      if (estado.operacao === 'insert') return erro({ message: 'simulado: a função não cria ficha', code: 'simulado' })
      const linhas = lerLinhas(visiveis, estado)
      if (estado.operacao === 'update') {
        if (!administra) return ok([])
        const valores = estado.valores ?? {}
        // O gatilho da ficha: ligar a ficha a uma conta (dar acesso) é do super admin.
        const liga = 'usuario_id' in valores && valores.usuario_id !== null
        if (liga && linhas.some((linha) => linha.usuario_id !== valores.usuario_id) && !superAdmin) {
          return erro({ message: 'Liberar acesso ao ponto pela ficha e exclusivo do super admin', code: '42501' })
        }
        linhas.forEach((linha) => Object.assign(linha, valores))
      }
      return ok(linhas.map((linha) => projetar(linha, estado.colunas)))
    }

    if (estado.tabela === 'ponto_super_admins') {
      if (estado.operacao !== 'select') return erro({ message: 'permission denied for table ponto_super_admins', code: '42501' })
      const linhas = banco.superAdmins.map((usuario_id) => ({ usuario_id }))
      return ok(lerLinhas(papel === 'servico' ? linhas : linhas.filter((linha) => linha.usuario_id === uid), estado).map((linha) => projetar(linha, estado.colunas)))
    }

    if (estado.tabela === 'ponto_contas_trilha') {
      if (estado.operacao === 'select') {
        const visiveis = papel === 'servico' || superAdmin ? banco.trilha : []
        return ok(lerLinhas(visiveis, estado).map((linha) => projetar(linha, estado.colunas)))
      }
      if (estado.operacao !== 'insert' || papel !== 'servico') {
        return erro({ message: 'permission denied for table ponto_contas_trilha', code: '42501' })
      }
      const valores = estado.valores ?? {}
      // O GRANT INSERT por coluna do SQL da trilha.
      const foraDoGrant = Object.keys(valores).filter((coluna) => !colunasDoGrant.includes(coluna))
      if (foraDoGrant.length > 0) return erro({ message: `permission denied for table ponto_contas_trilha (${foraDoGrant.join(', ')})`, code: '42501' })
      // O gatilho de carimbo e os CHECK do SQL da trilha.
      if (!banco.superAdmins.includes(String(valores.autor_id))) {
        return erro({ message: 'Autor da trilha de contas precisa ser super admin do ponto', code: '23514' })
      }
      if (temChaveDeSenha(valores, chavesDoCheckSemSenha)) {
        return erro({ message: 'new row violates check constraint "ponto_contas_trilha_sem_senha"', code: '23514' })
      }
      if (!acoesDoCheck.includes(String(valores.acao))) {
        return erro({ message: 'new row violates check constraint "ponto_contas_trilha_acao_valida"', code: '23514' })
      }
      if (valores.resultado !== 'feito' && !(typeof valores.detalhe === 'string' && valores.detalhe.trim())) {
        return erro({ message: 'new row violates check constraint "ponto_contas_trilha_falha_explicada"', code: '23514' })
      }
      const linha = { ...valores, id: `trilha-${banco.proximoId++}`, feito_em: '2026-10-20T18:00:00Z' }
      banco.trilha.push(linha)
      return ok([projetar(linha, estado.colunas)])
    }

    // `ponto_registros`, `ponto_admins` e qualquer outra: a função não tem o que fazer lá.
    return erro({ message: `simulado: a função não deveria tocar em ${estado.tabela}`, code: 'PGRST205' })
  }

  const tabela = (nome: string): TabelaDoSupabase => {
    const estado = (operacao: EstadoDaConsulta['operacao'], valores: LinhaDoBanco | null, colunas: string | null): EstadoDaConsulta => ({
      tabela: nome,
      operacao,
      colunas,
      valores,
      filtros: [],
    })
    return {
      select: (colunas) => consulta(estado('select', null, colunas), executar),
      update: (valores) => consulta(estado('update', valores, null), executar),
      insert: (valores) => consulta(estado('insert', valores, null), executar),
    }
  }

  const exigirServico = <T,>(operacao: string, fazer: () => RespostaDoSupabase<T>): Promise<RespostaDoSupabase<T>> => {
    const falha = registrar(operacao)
    if (falha) return Promise.resolve(erro<T>(falha))
    if (papel !== 'servico') return Promise.resolve(erro<T>(naoEAdmin))
    return Promise.resolve(fazer())
  }

  return {
    from: tabela,

    rpc(funcao) {
      const falha = registrar(`rpc:${funcao}`)
      if (falha) return Promise.resolve(erro<unknown>(falha))
      if (papel === 'sessao' && uid === null) return Promise.resolve(erro<unknown>({ message: 'JWT expired', code: 'PGRST301' }))
      if (funcao === 'ponto_sou_super_admin') {
        // Como no banco: sem auth.uid() (a chave de serviço), false.
        return Promise.resolve(ok<unknown>(superAdmin))
      }
      if (funcao === 'ponto_contas_trilha_pronta') {
        if (papel !== 'servico') return Promise.resolve(erro<unknown>({ message: 'permission denied for function ponto_contas_trilha_pronta', code: '42501' }))
        if (banco.trilhaPronta === 'ausente') {
          return Promise.resolve(erro<unknown>({ message: 'Could not find the function public.ponto_contas_trilha_pronta without parameters in the schema cache', code: 'PGRST202' }))
        }
        return Promise.resolve(ok<unknown>(banco.trilhaPronta))
      }
      return Promise.resolve(erro<unknown>({ message: `simulado: rpc desconhecida ${funcao}`, code: 'PGRST202' }))
    },

    auth: {
      getUser(jwt) {
        const falha = registrar('auth.getUser')
        if (falha) return Promise.resolve(erro(falha))
        const id = jwt ? banco.sessoes[jwt] : undefined
        const login = id ? acharLogin(id) : undefined
        if (!login) return Promise.resolve(erro({ message: 'invalid JWT: unable to parse or verify signature', status: 403, code: 'bad_jwt' }))
        return Promise.resolve(ok({ user: paraUsuario(login) }))
      },

      admin: {
        getUserById: (id) =>
          exigirServico('auth.admin.getUserById', () => {
            const login = acharLogin(id)
            return login ? ok({ user: paraUsuario(login) }) : erro({ message: 'User not found', status: 404, code: 'user_not_found' })
          }),

        listUsers: ({ page, perPage }) =>
          exigirServico('auth.admin.listUsers', () => {
            const tamanho = Math.min(perPage, banco.tetoDaPaginaDoLogin ?? perPage)
            return ok({ users: banco.logins.slice((page - 1) * tamanho, page * tamanho).map(paraUsuario) })
          }),

        // O login criado é a conta inteira: o nome vai no app_metadata, e o
        // acesso vem da ficha e das listas de administração do ponto.
        createUser: (atributos: AtributosDoLogin) =>
          exigirServico('auth.admin.createUser', () => {
            const email = (atributos.email ?? '').toLowerCase()
            if (emailUsado(email, null)) {
              return erro({ message: 'A user with this email address has already been registered', status: 422, code: 'email_exists' })
            }
            const fraca = senhaFraca(atributos.password ?? '')
            if (fraca) return erro(fraca)
            const login: LoginSimulado = {
              id: `00000000-0000-4000-8000-${String(banco.proximoId++).padStart(12, '0')}`,
              email,
              senha: atributos.password ?? '',
              app_metadata: { ...atributos.app_metadata },
              email_confirmado: atributos.email_confirm === true,
            }
            banco.logins.push(login)
            return ok({ user: paraUsuario(login) })
          }),

        updateUserById: (id, atributos: AtributosDoLogin) =>
          exigirServico('auth.admin.updateUserById', () => {
            const login = acharLogin(id)
            if (!login) return erro({ message: 'User not found', status: 404, code: 'user_not_found' })
            if (atributos.email !== undefined) {
              if (emailUsado(atributos.email, id)) {
                return erro({ message: 'A user with this email address has already been registered', status: 422, code: 'email_exists' })
              }
              login.email = atributos.email.toLowerCase()
            }
            if (atributos.password !== undefined) {
              const fraca = senhaFraca(atributos.password)
              if (fraca) return erro(fraca)
              login.senha = atributos.password
            }
            if (atributos.app_metadata) {
              // O login MESCLA o app_metadata; valor nulo tira a chave.
              for (const [chave, valor] of Object.entries(atributos.app_metadata)) {
                if (valor === null) delete login.app_metadata[chave]
                else login.app_metadata[chave] = valor
              }
            }
            return ok({ user: paraUsuario(login) })
          }),

        deleteUser: (id) =>
          exigirServico<unknown>('auth.admin.deleteUser', () => {
            const login = acharLogin(id)
            if (!login) return erro({ message: 'User not found', status: 404, code: 'user_not_found' })
            banco.logins = banco.logins.filter((outro) => outro.id !== id)
            return ok({ user: paraUsuario(login) })
          }),
      },
    },
  }
}

function montar(banco: Banco) {
  const anotacoes: { evento: string; dados: Record<string, unknown> }[] = []
  let portasAbertas = 0
  const abrir: AbrirPortas = (token) => {
    portasAbertas++
    return criarPortas(
      { sessao: clienteSimulado(banco, 'sessao', token), servico: clienteSimulado(banco, 'servico', null) },
      token,
      (evento, dados) => anotacoes.push({ evento, dados }),
    )
  }
  const chamar = (corpo: unknown, opcoes: { token?: string | null; metodo?: string } = {}): Promise<RespostaHttp> => {
    const token = opcoes.token === undefined ? TOKEN_DO_SUPER : opcoes.token
    return atender(
      {
        metodo: opcoes.metodo ?? 'POST',
        autorizacao: token === null ? null : `Bearer ${token}`,
        corpo: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      },
      abrir,
    )
  }
  return { chamar, anotacoes, portasAbertas: () => portasAbertas }
}

const chamadasDeServico = (banco: Banco) => banco.chamadas.filter((chamada) => chamada.startsWith('servico:'))
const corpoDe = (resposta: RespostaHttp) => resposta.corpo as Record<string, unknown>
const loginDe = (banco: Banco, id: string) => banco.logins.find((login) => login.id === id)
const fichaDe = (banco: Banco, id: string) => banco.fichas.find((ficha) => ficha.id === id)

/* ------------------------------------------------------------------ */
/* A porta: 401, 403 e nada muda                                       */
/* ------------------------------------------------------------------ */

const PEDIDO_VALIDO = { acao: 'trocar_nome', usuario_id: BRUNA, nome: 'Bruna Exemplo' }
const SENHA = 'Provisoria#2026'
const NOVA = { acao: 'criar_conta', email: '  Nova.Pessoa@Example.com ', nome: ' Nova   Pessoa ', senha_provisoria: SENHA }

describe('a porta da função', () => {
  it('sem sessão (sem token): 401, e nem cliente se cria', async () => {
    const banco = novoBanco()
    const { chamar, portasAbertas } = montar(banco)
    const resposta = await chamar(PEDIDO_VALIDO, { token: null })
    expect(resposta.status).toBe(401)
    expect(corpoDe(resposta)).toMatchObject({ ok: false, codigo: 'sem_sessao' })
    expect(portasAbertas()).toBe(0)
    expect(banco.chamadas).toEqual([])
  })

  it('token que o login não reconhece: 401, e a chave de serviço não é usada', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar(PEDIDO_VALIDO, { token: 'token-vencido' })
    expect(resposta.status).toBe(401)
    expect(corpoDe(resposta).codigo).toBe('sessao_invalida')
    expect(chamadasDeServico(banco)).toEqual([])
  })

  it.each([
    ['admin do ponto que não é super admin', TOKEN_DO_ADMIN],
    ['colaborador', TOKEN_DA_BRUNA],
  ])('%s: 403, nada muda e a chave de serviço nem é usada', async (_quem, token) => {
    const banco = novoBanco()
    const antes = fotografia(banco)
    const { chamar } = montar(banco)
    for (const pedido of [
      PEDIDO_VALIDO,
      { acao: 'criar_conta', email: 'nova@example.com', nome: 'Nova', senha_provisoria: 'Provisoria#2026', ficha_id: FICHA_LIVRE },
      { acao: 'trocar_email', usuario_id: BRUNA, email: 'nova@example.com' },
      { acao: 'redefinir_senha', usuario_id: BRUNA, senha_provisoria: 'Provisoria#2026' },
    ]) {
      const resposta = await chamar(pedido, { token })
      expect(resposta.status, pedido.acao).toBe(403)
      expect(corpoDe(resposta)).toMatchObject({ ok: false, codigo: 'nao_e_super_admin' })
    }
    expect(fotografia(banco)).toBe(antes)
    expect(chamadasDeServico(banco)).toEqual([])
  })

  it('a pergunta "é super admin?" vai ao banco COM A SESSÃO do chamador, nunca com a chave de serviço', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar(PEDIDO_VALIDO)
    expect(resposta.status).toBe(200)
    expect(banco.chamadas).toContain('sessao:rpc:ponto_sou_super_admin')
    expect(banco.chamadas).not.toContain('servico:rpc:ponto_sou_super_admin')
    // E a ordem: login confere o token, o banco confere o papel, e só então a
    // chave de serviço entra.
    expect(banco.chamadas.slice(0, 3)).toEqual(['sessao:auth.getUser', 'sessao:rpc:ponto_sou_super_admin', 'servico:rpc:ponto_contas_trilha_pronta'])
  })

  it('se o banco não responde a conferência: 503, falha fechada, nada muda', async () => {
    const banco = novoBanco({
      falhar: (operacao) =>
        operacao === 'sessao:rpc:ponto_sou_super_admin' ? { message: 'canceling statement due to statement timeout', code: '57014' } : null,
    })
    const antes = fotografia(banco)
    const { chamar, anotacoes } = montar(banco)
    const resposta = await chamar(PEDIDO_VALIDO)
    expect(resposta.status).toBe(503)
    expect(corpoDe(resposta).codigo).toBe('conferencia_indisponivel')
    expect(fotografia(banco)).toBe(antes)
    expect(anotacoes.map((anotacao) => anotacao.evento)).toEqual(['conferencia_de_super_admin_falhou'])
  })

  it('OPTIONS responde ao navegador sem tocar em nada; outro método é 405', async () => {
    const banco = novoBanco()
    const { chamar, portasAbertas } = montar(banco)
    expect(await chamar('', { metodo: 'OPTIONS', token: null })).toEqual({ status: 204, corpo: null })
    expect((await chamar('', { metodo: 'GET' })).status).toBe(405)
    expect(portasAbertas()).toBe(0)
  })

  it('pedido inválido (depois do 403): 400 com a lista; JSON quebrado; corpo grande demais', async () => {
    const banco = novoBanco()
    const { chamar } = montar(banco)
    const invalido = await chamar({ acao: 'criar_conta', email: 'x', nome: '', senha_provisoria: '1' })
    expect(invalido.status).toBe(400)
    expect(corpoDe(invalido).erros).toHaveLength(3)
    expect((await chamar('{não é json')).status).toBe(400)
    expect((await chamar({ acao: 'trocar_nome', usuario_id: BRUNA, nome: 'x'.repeat(20_000) })).status).toBe(413)
    // Quem não é super admin leva 403 mesmo com pedido torto: não descobre as regras.
    expect((await chamar({ acao: 'xyz' }, { token: TOKEN_DA_BRUNA })).status).toBe(403)
  })

  it.each([
    ['o SQL da trilha não foi aplicado (a pergunta não existe)', 'ausente' as const],
    ['a trilha foi desfeita (a pergunta responde false)', false],
  ])('sem trilha — %s: 503 e nada muda', async (_caso, trilhaPronta) => {
    const banco = novoBanco({ trilhaPronta })
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ acao: 'redefinir_senha', usuario_id: BRUNA, senha_provisoria: 'nova-senha-1' })
    expect(resposta.status).toBe(503)
    expect(corpoDe(resposta).codigo).toBe('trilha_indisponivel')
    expect(fotografia(banco)).toBe(antes)
    expect(banco.chamadas.filter((chamada) => chamada.includes('auth.admin'))).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* A lista permitida: o login, a ficha, os super admins e a trilha     */
/* ------------------------------------------------------------------ */

/**
 * Cada chamada que a função pode fazer, como o simulado a anota
 * (`papel:operação`), e o lugar em que ela mexe.
 */
const LUGAR_DA_CHAMADA: Record<string, 'login' | 'ficha' | 'super admins' | 'trilha'> = {
  'sessao:auth.getUser': 'login',
  'servico:auth.admin.getUserById': 'login',
  'servico:auth.admin.listUsers': 'login',
  'servico:auth.admin.createUser': 'login',
  'servico:auth.admin.updateUserById': 'login',
  'servico:auth.admin.deleteUser': 'login',
  'sessao:ponto_funcionarios.select': 'ficha',
  'sessao:ponto_funcionarios.update': 'ficha',
  'sessao:rpc:ponto_sou_super_admin': 'super admins',
  'servico:ponto_super_admins.select': 'super admins',
  'servico:rpc:ponto_contas_trilha_pronta': 'trilha',
  'servico:ponto_contas_trilha.insert': 'trilha',
}

describe('a função só toca o login, a ficha, a lista de super admins e a trilha', () => {
  it('as quatro ações, com e sem ficha: toda chamada está na lista permitida, e a trilha registra o login e a ficha', async () => {
    const banco = novoBanco({ admins: [SUPER, ADMIN] })
    const { chamar } = montar(banco)
    const respostas = [
      await chamar({ acao: 'criar_conta', email: 'com.ficha@example.com', nome: 'Com Ficha', senha_provisoria: SENHA, ficha_id: FICHA_LIVRE }),
      await chamar({ acao: 'criar_conta', email: 'sem.ficha@example.com', nome: 'Sem Ficha', senha_provisoria: SENHA }),
      await chamar({ acao: 'trocar_nome', usuario_id: BRUNA, nome: 'Bruna Exemplo' }),
      await chamar({ acao: 'trocar_nome', usuario_id: ADMIN, nome: 'Admin Novo' }),
      await chamar({ acao: 'trocar_email', usuario_id: BRUNA, email: 'bruna.exemplo@example.com' }),
      await chamar({ acao: 'redefinir_senha', usuario_id: SO_LOGIN, senha_provisoria: SENHA }),
    ]
    expect(respostas.map((resposta) => resposta.status)).toEqual([200, 200, 200, 200, 200, 200])
    expect(banco.chamadas.filter((chamada) => !(chamada in LUGAR_DA_CHAMADA))).toEqual([])
    // E as quatro ações passam pelos quatro lugares (a lista não passa no vazio).
    expect([...new Set(banco.chamadas.map((chamada) => LUGAR_DA_CHAMADA[chamada]))].sort()).toEqual([
      'ficha',
      'login',
      'super admins',
      'trilha',
    ])
    expect(banco.trilha).toHaveLength(6)
    // Os lugares que a trilha registra, no antes, no depois e nos passos: o login e a ficha.
    const lugaresDaTrilha = banco.trilha.flatMap((linha) => [
      ...Object.keys(linha.antes as Record<string, unknown>),
      ...Object.keys(linha.depois as Record<string, unknown>),
      ...((linha.passos as { passo: string }[] | null) ?? []).map((passo) => passo.passo),
    ])
    expect([...new Set(lugaresDaTrilha)].sort()).toEqual(['ficha', 'login'])
  })
})

/* ------------------------------------------------------------------ */
/* criar_conta                                                         */
/* ------------------------------------------------------------------ */

describe('criar_conta', () => {
  it('sem ficha: cria o login (e-mail confirmado, senha provisória, nome no login) e grava a trilha sem a senha', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar(NOVA)
    expect(resposta.status).toBe(200)
    const corpo = corpoDe(resposta)
    expect(corpo).toMatchObject({ ok: true, acao: 'criar_conta' })
    expect(String(corpo.mensagem)).toMatch(/ligue a ficha dela a esta conta/)

    const login = banco.logins.find((item) => item.email === 'nova.pessoa@example.com')
    expect(login).toMatchObject({ senha: SENHA, email_confirmado: true, app_metadata: { full_name: 'Nova Pessoa' } })
    expect(corpo.usuario_id).toBe(login?.id)
    expect(corpo.passos).toEqual([{ passo: 'login', estado: 'feito', nota: 'login criado com o e-mail confirmado e a senha provisória' }])
    // Nenhuma ficha mexida.
    expect(banco.chamadas.some((chamada) => chamada.includes('ponto_funcionarios'))).toBe(false)

    expect(banco.trilha).toEqual([
      expect.objectContaining({
        acao: 'criar_conta',
        resultado: 'feito',
        autor_id: SUPER,
        autor_email: 'admin@example.com',
        alvo_usuario_id: login?.id,
        antes: {},
        depois: { login: { email: 'nova.pessoa@example.com', nome: 'Nova Pessoa' } },
        detalhe: null,
      }),
    ])
    expect(corpo.trilha_id).toBe(banco.trilha[0].id)
  })

  it('com ficha_id: cria o login e liga a ficha sem conta no mesmo pedido, pela sessão do super admin', async () => {
    const banco = novoBanco()
    const { chamar } = montar(banco)
    const resposta = await chamar({ ...NOVA, ficha_id: FICHA_LIVRE.toUpperCase() })
    expect(resposta.status).toBe(200)
    const corpo = corpoDe(resposta)
    const nova = String(corpo.usuario_id)
    expect(loginDe(banco, nova)).toMatchObject({ email: 'nova.pessoa@example.com', app_metadata: { full_name: 'Nova Pessoa' } })

    // A ficha ganhou a conta, e só isso: o nome de RH continua o dela.
    expect(fichaDe(banco, FICHA_LIVRE)).toEqual({ id: FICHA_LIVRE, usuario_id: nova, nome_completo: 'Pessoa Sem Conta' })
    expect(banco.chamadas).toContain('sessao:ponto_funcionarios.update')
    expect(banco.chamadas.some((chamada) => chamada.startsWith('servico:ponto_funcionarios'))).toBe(false)

    expect(corpo.mensagem).toBe(
      'Conta criada para nova.pessoa@example.com, com o e-mail já confirmado, e ligada à ficha “Pessoa Sem Conta”. Passe a senha provisória à pessoa por um canal seguro.',
    )
    expect(banco.trilha).toEqual([
      expect.objectContaining({
        acao: 'criar_conta',
        resultado: 'feito',
        alvo_usuario_id: nova,
        antes: { ficha: { id: FICHA_LIVRE, nome: 'Pessoa Sem Conta', usuario_id: null } },
        depois: { login: { email: 'nova.pessoa@example.com', nome: 'Nova Pessoa' }, ficha: { id: FICHA_LIVRE, nome: 'Pessoa Sem Conta' } },
        passos: [
          { passo: 'login', estado: 'feito', nota: 'login criado com o e-mail confirmado e a senha provisória' },
          { passo: 'ficha', estado: 'feito', nota: 'ficha “Pessoa Sem Conta” ligada à conta nova' },
        ],
      }),
    ])

    // Daí em diante, trocar o nome da conta nova muda o login e a ficha.
    const nome = await chamar({ acao: 'trocar_nome', usuario_id: nova, nome: 'Pessoa Com Conta' })
    expect(nome.status).toBe(200)
    expect(fichaDe(banco, FICHA_LIVRE)?.nome_completo).toBe('Pessoa Com Conta')
    expect(loginDe(banco, nova)?.app_metadata.full_name).toBe('Pessoa Com Conta')
  })

  it.each([
    ['de uma conta sem ficha', 'So-Login@example.com'],
    ['de uma conta com ficha, com espaço e outra caixa', ' Bruna@Example.com'],
  ])('e-mail já usado no login (%s): 409 dizendo onde, e nada muda', async (_caso, email) => {
    const banco = novoBanco()
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ ...NOVA, email, ficha_id: FICHA_LIVRE })
    expect(resposta.status).toBe(409)
    expect(corpoDe(resposta)).toMatchObject({ ok: false, codigo: 'email_ja_usado', onde: 'login' })
    expect(String(corpoDe(resposta).mensagem)).toMatch(/já é o login de outra conta\. Nada mudou/)
    expect(fotografia(banco)).toBe(antes)
    expect(banco.chamadas).not.toContain('servico:auth.admin.createUser')
  })

  it('ficha que não existe: 404, nada criado', async () => {
    const banco = novoBanco()
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ ...NOVA, ficha_id: NINGUEM })
    expect(resposta.status).toBe(404)
    expect(corpoDe(resposta).codigo).toBe('ficha_nao_encontrada')
    expect(fotografia(banco)).toBe(antes)
    expect(banco.chamadas).not.toContain('servico:auth.admin.createUser')
  })

  it('ficha que já tem conta: 409, nada criado e a ficha não troca de dono', async () => {
    const banco = novoBanco()
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ ...NOVA, ficha_id: FICHA_DA_BRUNA })
    expect(resposta.status).toBe(409)
    expect(corpoDe(resposta)).toMatchObject({ codigo: 'ficha_ja_ligada' })
    expect(String(corpoDe(resposta).mensagem)).toMatch(/“Bruna Costa” já está ligada a outra conta[\s\S]*Nada foi alterado/)
    expect(fotografia(banco)).toBe(antes)
    expect(banco.chamadas).not.toContain('servico:auth.admin.createUser')
  })

  it('ficha_id fora do formato: 400 junto com os outros erros do pedido', async () => {
    const resposta = await montar(novoBanco()).chamar({ ...NOVA, ficha_id: 'ficha-1' })
    expect(resposta.status).toBe(400)
    expect(corpoDe(resposta).erros).toEqual(['O ficha_id não é o identificador de uma ficha.'])
  })

  it('a regra do login mais dura que a nossa: 400 em português, nada criado, nada na trilha', async () => {
    const banco = novoBanco({ minimoDaSenhaNoLogin: 20 })
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ ...NOVA, ficha_id: FICHA_LIVRE })
    expect(resposta.status).toBe(400)
    expect(corpoDe(resposta)).toMatchObject({
      codigo: 'senha_recusada',
      mensagem: 'O login recusou a senha provisória: ela é curta demais para a regra do login. Escolha outra. Nada foi alterado.',
    })
    expect(fotografia(banco)).toBe(antes)
  })

  it('outra aba liga a ficha entre a conferência e a ligação: o login criado é removido, a ficha fica com quem ligou, a trilha diz "desfeito"', async () => {
    const banco = novoBanco()
    banco.falhar = (operacao) => {
      // No instante em que o login nasce, outra aba liga a mesma ficha a OUTRO.
      if (operacao === 'servico:auth.admin.createUser') fichaDe(banco, FICHA_LIVRE)!.usuario_id = OUTRO
      return null
    }
    const resposta = await montar(banco).chamar({ ...NOVA, ficha_id: FICHA_LIVRE })
    expect(resposta.status).toBe(500)
    expect(corpoDe(resposta)).toMatchObject({ ok: false, codigo: 'falhou_e_desfez' })
    expect(String(corpoDe(resposta).mensagem)).toMatch(/ela já tem conta/)
    expect(banco.logins).toHaveLength(5)
    expect(fichaDe(banco, FICHA_LIVRE)?.usuario_id).toBe(OUTRO)
    expect(banco.trilha).toEqual([expect.objectContaining({ acao: 'criar_conta', resultado: 'desfeito' })])
    expect(banco.trilha[0].passos).toEqual([
      expect.objectContaining({ passo: 'login', estado: 'desfeito' }),
      expect.objectContaining({ passo: 'ficha', estado: 'falhou' }),
    ])
  })

  it('e se remover o login também falhar: "incompleto", com o estado exato na resposta, na trilha e no log', async () => {
    const banco = novoBanco({
      falhar: (operacao) => {
        if (operacao === 'sessao:ponto_funcionarios.update') return { message: 'canceling statement due to lock timeout', code: '55P03' }
        if (operacao === 'servico:auth.admin.deleteUser') return { message: 'fetch failed', status: 0 }
        return null
      },
    })
    const { chamar, anotacoes } = montar(banco)
    const resposta = await chamar({ ...NOVA, ficha_id: FICHA_LIVRE })
    expect(resposta.status).toBe(500)
    expect(corpoDe(resposta).codigo).toBe('falhou_no_meio')
    expect(String(corpoDe(resposta).mensagem)).toMatch(/O login MUDOU E NÃO VOLTOU e a ficha não mudou\./)
    expect(banco.logins).toHaveLength(6)
    expect(fichaDe(banco, FICHA_LIVRE)?.usuario_id).toBeNull()
    expect(banco.trilha[0]).toMatchObject({ resultado: 'incompleto' })
    expect(anotacoes.map((anotacao) => anotacao.evento)).toEqual(['acao_incompleta'])
  })
})

/* ------------------------------------------------------------------ */
/* trocar_nome                                                         */
/* ------------------------------------------------------------------ */

describe('trocar_nome', () => {
  it('conta com ficha: troca no login e na ficha ligada — a ficha pela sessão do super admin — e não toca nas batidas', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar({ acao: 'trocar_nome', usuario_id: BRUNA, nome: '  Bruna   Exemplo ' })
    expect(resposta.status).toBe(200)
    expect(corpoDe(resposta).mensagem).toBe('Nome trocado para “Bruna Exemplo” (mudou o login e a ficha).')
    expect(loginDe(banco, BRUNA)?.app_metadata.full_name).toBe('Bruna Exemplo')
    expect(fichaDe(banco, FICHA_DA_BRUNA)?.nome_completo).toBe('Bruna Exemplo')
    expect(banco.chamadas).toContain('sessao:ponto_funcionarios.update')
    expect(banco.chamadas.some((chamada) => chamada.includes('ponto_registros'))).toBe(false)

    expect(banco.trilha).toEqual([
      expect.objectContaining({
        acao: 'trocar_nome',
        resultado: 'feito',
        alvo_usuario_id: BRUNA,
        antes: { login: { nome: 'Bruna Costa' }, ficha: { id: FICHA_DA_BRUNA, nome: 'Bruna Costa' } },
        depois: { login: { nome: 'Bruna Exemplo' }, ficha: { id: FICHA_DA_BRUNA, nome: 'Bruna Exemplo' } },
        passos: [
          { passo: 'login', estado: 'feito' },
          { passo: 'ficha', estado: 'feito' },
        ],
      }),
    ])
  })

  it('conta sem ficha (quem só administra): o nome mora só no login, e nenhuma ficha é tocada', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar({ acao: 'trocar_nome', usuario_id: ADMIN, nome: 'Admin do Ponto' })
    expect(resposta.status).toBe(200)
    expect(corpoDe(resposta).mensagem).toBe('Nome trocado para “Admin do Ponto” (mudou o login).')
    expect(corpoDe(resposta).passos).toEqual([{ passo: 'login', estado: 'feito' }])
    expect(loginDe(banco, ADMIN)?.app_metadata.full_name).toBe('Admin do Ponto')
    expect(banco.chamadas).not.toContain('sessao:ponto_funcionarios.update')
    expect(banco.trilha[0]).toMatchObject({
      antes: { login: { nome: 'Admin Comum' }, ficha: null },
      depois: { login: { nome: 'Admin do Ponto' }, ficha: null },
    })
  })

  it('só onde o nome é outro: a ficha já com o nome novo, muda só o login (e o login sem nome ganha um)', async () => {
    const banco = novoBanco()
    fichaDe(banco, FICHA_DA_BRUNA)!.nome_completo = 'Bruna Exemplo'
    const resposta = await montar(banco).chamar({ acao: 'trocar_nome', usuario_id: BRUNA, nome: 'Bruna Exemplo' })
    expect(resposta.status).toBe(200)
    expect(corpoDe(resposta).passos).toEqual([{ passo: 'login', estado: 'feito' }])
    expect(loginDe(banco, BRUNA)?.app_metadata.full_name).toBe('Bruna Exemplo')

    const semNome = novoBanco()
    const outra = await montar(semNome).chamar({ acao: 'trocar_nome', usuario_id: OUTRO, nome: 'Outro Nome' })
    expect(outra.status).toBe(200)
    expect(semNome.trilha[0]).toMatchObject({ antes: { login: { nome: null }, ficha: null } })
  })

  it.each([
    ['com ficha', BRUNA, 'Bruna Costa', 'no login e na ficha'],
    ['sem ficha', ADMIN, 'Admin Comum', 'no login'],
  ])('o mesmo nome em todo lugar (%s): 400, nada a mudar, nada na trilha', async (_caso, alvo, nome, onde) => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar({ acao: 'trocar_nome', usuario_id: alvo, nome })
    expect(resposta.status).toBe(400)
    expect(corpoDe(resposta).codigo).toBe('nada_a_mudar')
    expect(corpoDe(resposta).mensagem).toBe(`“${nome}” já é o nome desta conta ${onde}. Nada foi alterado.`)
    expect(banco.trilha).toEqual([])
  })

  it('a ficha recusa no meio: o login volta ao que era, e a trilha diz "desfeito"', async () => {
    const banco = novoBanco({
      falhar: (operacao) =>
        operacao === 'sessao:ponto_funcionarios.update'
          ? { message: 'new row violates row-level security policy for table "ponto_funcionarios"', code: '42501' }
          : null,
    })
    const antes = JSON.stringify([banco.logins, banco.fichas])
    const resposta = await montar(banco).chamar({ acao: 'trocar_nome', usuario_id: BRUNA, nome: 'Bruna Exemplo' })
    expect(resposta.status).toBe(500)
    expect(corpoDe(resposta).codigo).toBe('falhou_e_desfez')
    expect(JSON.stringify([banco.logins, banco.fichas])).toBe(antes)
    expect(banco.trilha[0].passos).toEqual([
      { passo: 'login', estado: 'desfeito' },
      expect.objectContaining({ passo: 'ficha', estado: 'falhou' }),
    ])
  })

  it('conta que não existe: 404, nada muda', async () => {
    const banco = novoBanco()
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ acao: 'trocar_nome', usuario_id: NINGUEM, nome: 'Alguém' })
    expect(resposta.status).toBe(404)
    expect(corpoDe(resposta).codigo).toBe('conta_nao_encontrada')
    expect(fotografia(banco)).toBe(antes)
  })

  it('conta ligada a duas fichas (o banco não deveria deixar): 409 antes de mexer', async () => {
    const banco = novoBanco()
    fichaDe(banco, FICHA_LIVRE)!.usuario_id = BRUNA
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ acao: 'trocar_nome', usuario_id: BRUNA, nome: 'Bruna Exemplo' })
    expect(resposta.status).toBe(409)
    expect(corpoDe(resposta).codigo).toBe('ficha_duplicada')
    expect(fotografia(banco)).toBe(antes)
  })
})

/* ------------------------------------------------------------------ */
/* trocar_email                                                        */
/* ------------------------------------------------------------------ */

describe('trocar_email', () => {
  it('troca só no login, e a trilha guarda o antes e o depois', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar({ acao: 'trocar_email', usuario_id: BRUNA, email: 'Bruna.Exemplo@Example.com' })
    expect(resposta.status).toBe(200)
    expect(corpoDe(resposta).mensagem).toBe(
      'E-mail trocado para bruna.exemplo@example.com. A pessoa passa a entrar com o e-mail novo; a senha continua a mesma.',
    )
    expect(loginDe(banco, BRUNA)?.email).toBe('bruna.exemplo@example.com')
    expect(banco.trilha).toEqual([
      expect.objectContaining({
        acao: 'trocar_email',
        resultado: 'feito',
        antes: { login: { email: 'bruna@example.com' } },
        depois: { login: { email: 'bruna.exemplo@example.com' } },
        passos: [{ passo: 'login', estado: 'feito' }],
      }),
    ])
    expect(banco.chamadas.some((chamada) => chamada.includes('ponto_registros'))).toBe(false)
    expect(banco.chamadas.some((chamada) => chamada.includes('ponto_funcionarios'))).toBe(false)
  })

  it.each([
    ['de uma conta sem ficha', 'So-Login@example.com'],
    ['de um admin, com espaço e outra caixa', ' ADMINISTRACAO@example.com '],
  ])('e-mail já usado no login (%s): 409 dizendo onde, e nada muda', async (_caso, email) => {
    const banco = novoBanco()
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ acao: 'trocar_email', usuario_id: BRUNA, email })
    expect(resposta.status).toBe(409)
    expect(corpoDe(resposta)).toMatchObject({ codigo: 'email_ja_usado', onde: 'login' })
    expect(String(corpoDe(resposta).mensagem)).toMatch(/já é o login de outra conta\. Nada mudou/)
    expect(fotografia(banco)).toBe(antes)
    expect(banco.chamadas).not.toContain('servico:auth.admin.updateUserById')
  })

  it('o login recusa por repetido mesmo depois da conferência (corrida): 409, nada muda', async () => {
    const banco = novoBanco({
      falhar: (operacao) =>
        operacao === 'servico:auth.admin.updateUserById'
          ? { message: 'A user with this email address has already been registered', status: 422, code: 'email_exists' }
          : null,
    })
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ acao: 'trocar_email', usuario_id: BRUNA, email: 'livre@example.com' })
    expect(resposta.status).toBe(409)
    expect(corpoDe(resposta)).toMatchObject({ codigo: 'email_ja_usado', onde: 'login' })
    expect(fotografia(banco)).toBe(antes)
  })

  it('o e-mail de um super admin não se troca por aqui (quem cuida da instalação troca direto no Supabase)', async () => {
    const banco = novoBanco()
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ acao: 'trocar_email', usuario_id: SUPER, email: 'novo@example.com' })
    expect(resposta.status).toBe(409)
    expect(corpoDe(resposta).codigo).toBe('super_admin_protegido')
    expect(fotografia(banco)).toBe(antes)
  })

  it('o mesmo e-mail (com outra caixa): 400, nada a mudar, sem nem listar os logins', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar({ acao: 'trocar_email', usuario_id: BRUNA, email: 'BRUNA@example.com' })
    expect(resposta.status).toBe(400)
    expect(corpoDe(resposta).codigo).toBe('nada_a_mudar')
    expect(banco.chamadas).not.toContain('servico:auth.admin.listUsers')
  })
})

/* ------------------------------------------------------------------ */
/* redefinir_senha                                                     */
/* ------------------------------------------------------------------ */

describe('redefinir_senha', () => {
  it('troca a senha do login; a trilha diz de quem, e só isso', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar({ acao: 'redefinir_senha', usuario_id: BRUNA, senha_provisoria: SENHA })
    expect(resposta.status).toBe(200)
    expect(loginDe(banco, BRUNA)?.senha).toBe(SENHA)
    expect(banco.trilha).toEqual([
      expect.objectContaining({
        acao: 'redefinir_senha',
        resultado: 'feito',
        antes: { login: { email: 'bruna@example.com' } },
        depois: { login: { email: 'bruna@example.com' } },
        passos: [{ passo: 'login', estado: 'feito' }],
      }),
    ])
  })

  it('senha igual ao e-mail da conta: 400, conferido no servidor depois de ler o login', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar({ acao: 'redefinir_senha', usuario_id: BRUNA, senha_provisoria: 'Bruna@Example.com' })
    expect(resposta.status).toBe(400)
    expect(corpoDe(resposta).mensagem).toBe('A senha provisória não pode ser o próprio e-mail.')
    expect(loginDe(banco, BRUNA)?.senha).toBe('senha-da-bruna')
  })

  it('conta que não existe: 404, nada muda', async () => {
    const banco = novoBanco()
    const antes = fotografia(banco)
    const resposta = await montar(banco).chamar({ acao: 'redefinir_senha', usuario_id: NINGUEM, senha_provisoria: SENHA })
    expect(resposta.status).toBe(404)
    expect(corpoDe(resposta).codigo).toBe('conta_nao_encontrada')
    expect(fotografia(banco)).toBe(antes)
  })
})

/* ------------------------------------------------------------------ */
/* O alvo: nunca outro super admin                                     */
/* ------------------------------------------------------------------ */

const SUPER_2 = '00000000-0000-4000-8000-000000000006'

/** O banco com um segundo super admin: a lista pode ter mais de um. */
function bancoComDoisSuperAdmins(mudancas: Partial<Banco> = {}): Banco {
  const banco = novoBanco(mudancas)
  banco.logins.push({ id: SUPER_2, email: 'outro.super@example.com', senha: 'senha-do-super-2', app_metadata: { full_name: 'Super Dois' }, email_confirmado: true })
  banco.superAdmins.push(SUPER_2)
  return banco
}

describe('o alvo de trocar_nome, trocar_email e redefinir_senha', () => {
  const PEDIDOS = (alvo: string) => [
    { acao: 'trocar_nome', usuario_id: alvo, nome: 'Nome Novo' },
    { acao: 'trocar_email', usuario_id: alvo, email: 'novo.endereco@example.com' },
    { acao: 'redefinir_senha', usuario_id: alvo, senha_provisoria: SENHA },
  ]

  /*
   * No banco do ponto, toda conta do login é do ponto: a função não recusa
   * conta por não ter ficha nem papel no ponto.
   */
  it('qualquer conta do login vale: com ficha, admin sem ficha, sem ficha nem papel, e o próprio super admin', async () => {
    for (const alvo of [BRUNA, ADMIN, SO_LOGIN, OUTRO, SUPER]) {
      const banco = novoBanco()
      const resposta = await montar(banco).chamar({ acao: 'redefinir_senha', usuario_id: alvo, senha_provisoria: SENHA })
      expect(resposta.status, alvo).toBe(200)
      expect(loginDe(banco, alvo)?.senha, alvo).toBe(SENHA)
    }
    const banco = novoBanco()
    const { chamar } = montar(banco)
    expect((await chamar({ acao: 'trocar_email', usuario_id: SO_LOGIN, email: 'pessoa.nova@example.com' })).status).toBe(200)
    expect((await chamar({ acao: 'trocar_nome', usuario_id: SO_LOGIN, nome: 'Pessoa Nova' })).status).toBe(200)
  })

  it('outro super admin: 409 super_admin_protegido nas três ações, nada muda e o login dele nem é lido', async () => {
    for (const pedido of PEDIDOS(SUPER_2)) {
      const banco = bancoComDoisSuperAdmins()
      const antes = fotografia(banco)
      const resposta = await montar(banco).chamar(pedido)
      expect(resposta.status, pedido.acao).toBe(409)
      expect(corpoDe(resposta).codigo, pedido.acao).toBe('super_admin_protegido')
      expect(String(corpoDe(resposta).mensagem)).toMatch(/outro super admin[\s\S]*Nada foi alterado/)
      expect(fotografia(banco)).toBe(antes)
      expect(loginDe(banco, SUPER_2)?.senha).toBe('senha-do-super-2')
      expect(banco.chamadas.filter((chamada) => chamada.includes('auth.admin')), pedido.acao).toEqual([])
    }
  })

  it('o próprio super admin troca o nome e a senha dele; o e-mail, nem ele (só direto no Supabase)', async () => {
    const banco = bancoComDoisSuperAdmins()
    const { chamar } = montar(banco)
    expect((await chamar({ acao: 'trocar_nome', usuario_id: SUPER, nome: 'Sérgio Almeida' })).status).toBe(200)
    expect((await chamar({ acao: 'redefinir_senha', usuario_id: SUPER, senha_provisoria: SENHA })).status).toBe(200)
    expect(loginDe(banco, SUPER)?.senha).toBe(SENHA)
    const email = await chamar({ acao: 'trocar_email', usuario_id: SUPER, email: 'sergio.almeida@example.com' })
    expect(email.status).toBe(409)
    expect(corpoDe(email).codigo).toBe('super_admin_protegido')
    expect(String(corpoDe(email).mensagem)).toMatch(/direto no Supabase/)
  })

  it('a leitura da lista de super admins falha: falha fechada, nada muda', async () => {
    for (const pedido of PEDIDOS(BRUNA)) {
      const banco = novoBanco({
        falhar: (feita) =>
          feita === 'servico:ponto_super_admins.select' ? { message: 'canceling statement due to statement timeout', code: '57014' } : null,
      })
      const antes = fotografia(banco)
      const resposta = await montar(banco).chamar(pedido)
      expect(resposta.status, pedido.acao).toBeGreaterThanOrEqual(500)
      expect(String(corpoDe(resposta).mensagem)).toMatch(/Nada foi alterado/)
      expect(fotografia(banco)).toBe(antes)
    }
  })
})

/* ------------------------------------------------------------------ */
/* listUsers até a página vazia                                        */
/* ------------------------------------------------------------------ */

describe('a lista de logins', () => {
  it('pagina até a página VAZIA: o login com teto de página menor não esconde e-mail repetido', async () => {
    // O login devolve 2 por página, embora a função peça 1000: a página curta não é o fim.
    const banco = novoBanco({ tetoDaPaginaDoLogin: 2 })
    const resposta = await montar(banco).chamar({ acao: 'criar_conta', email: 'so-login@example.com', nome: 'Repetida', senha_provisoria: SENHA })
    // O quinto login (SO_LOGIN) só aparece na terceira página.
    expect(resposta.status).toBe(409)
    expect(corpoDe(resposta)).toMatchObject({ codigo: 'email_ja_usado', onde: 'login' })
    // 5 logins em páginas de 2: 2 + 2 + 1, e a quarta, vazia, é a prova do fim.
    expect(banco.chamadas.filter((chamada) => chamada === 'servico:auth.admin.listUsers')).toHaveLength(4)
  })

  it('com o login honrando o perPage, uma página com tudo e a vazia', async () => {
    const banco = novoBanco()
    const resposta = await montar(banco).chamar({ acao: 'criar_conta', email: 'livre@example.com', nome: 'Livre', senha_provisoria: SENHA })
    expect(resposta.status).toBe(200)
    expect(banco.chamadas.filter((chamada) => chamada === 'servico:auth.admin.listUsers')).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/* O teto do corpo antes de ler                                        */
/* ------------------------------------------------------------------ */

describe('o teto do corpo', () => {
  it('corpoDeclaradoGrandeDemais: só o Content-Length acima de 10 kB recusa', () => {
    expect(CORPO_MAXIMO_BYTES).toBe(10_000)
    expect(corpoDeclaradoGrandeDemais(String(CORPO_MAXIMO_BYTES + 1))).toBe(true)
    expect(corpoDeclaradoGrandeDemais('5000000')).toBe(true)
    expect(corpoDeclaradoGrandeDemais(' 10001 ')).toBe(true)
    expect(corpoDeclaradoGrandeDemais(String(CORPO_MAXIMO_BYTES))).toBe(false)
    expect(corpoDeclaradoGrandeDemais('120')).toBe(false)
    // Ausente ou fora do formato: decide a conferência de depois de ler.
    expect(corpoDeclaradoGrandeDemais(null)).toBe(false)
    expect(corpoDeclaradoGrandeDemais(undefined)).toBe(false)
    expect(corpoDeclaradoGrandeDemais('abc')).toBe(false)
    expect(corpoDeclaradoGrandeDemais('-1')).toBe(false)
  })

  it('index.ts confere o Content-Length ANTES de req.text(), e atender continua conferindo depois de ler', () => {
    const index = codigoDaFuncao['index.ts'] ?? ''
    const conferencia = index.search(/corpoDeclaradoGrandeDemais\(\s*req\.headers\.get\(\s*'Content-Length'\s*\)\s*\)/)
    const leitura = index.indexOf('await req.text()')
    expect(conferencia).toBeGreaterThan(-1)
    expect(leitura).toBeGreaterThan(-1)
    expect(conferencia).toBeLessThan(leitura)
    // E a resposta da recusa é a mesma 413 de atender.
    expect(index).toMatch(/return\s+responder\(\s*respostaDoCorpoGrande\(\)\s*\)/)
    expect(codigoDaFuncao['atendimento.ts']).toMatch(/length\s*>\s*CORPO_MAXIMO_BYTES\)\s*return\s+respostaDoCorpoGrande\(\)/)
  })
})

/* ------------------------------------------------------------------ */
/* A trilha e a senha                                                  */
/* ------------------------------------------------------------------ */

describe('a trilha', () => {
  it('a senha não aparece em lugar nenhum além do login: nem na trilha, nem na resposta, nem no log', async () => {
    const banco = novoBanco({
      // Força o log (incompleto: a ficha recusa e o login não sai) para ele também ser revistado.
      falhar: (operacao) => {
        if (operacao === 'sessao:ponto_funcionarios.update') return { message: 'x', code: '55P03' }
        if (operacao === 'servico:auth.admin.deleteUser') return { message: 'fetch failed', status: 0 }
        return null
      },
    })
    const { chamar, anotacoes } = montar(banco)
    const respostas = [
      await chamar({ ...NOVA, ficha_id: FICHA_LIVRE }),
      await chamar({ acao: 'redefinir_senha', usuario_id: BRUNA, senha_provisoria: SENHA }),
      await chamar({ acao: 'criar_conta', email: 'outra.nova@example.com', nome: 'Outra', senha_provisoria: SENHA }),
    ]
    expect(banco.trilha).toHaveLength(3)
    expect(anotacoes.length).toBeGreaterThan(0)
    for (const onde of [banco.trilha, respostas, anotacoes]) {
      expect(JSON.stringify(onde)).not.toContain(SENHA)
    }
    // A senha foi, sim, para o login: a da Bruna e a das duas contas novas.
    expect(loginDe(banco, BRUNA)?.senha).toBe(SENHA)
    expect(banco.logins.filter((login) => login.senha === SENHA)).toHaveLength(3)
  })

  it('a ação foi feita e a linha não gravou: 500 dizendo isso, e a linha inteira (sem senha) vai para o log', async () => {
    const banco = novoBanco({
      falhar: (operacao) =>
        operacao === 'servico:ponto_contas_trilha.insert' ? { message: 'permission denied for table ponto_contas_trilha', code: '42501' } : null,
    })
    const { chamar, anotacoes } = montar(banco)
    const resposta = await chamar({ acao: 'redefinir_senha', usuario_id: BRUNA, senha_provisoria: SENHA })
    expect(resposta.status).toBe(500)
    expect(corpoDe(resposta)).toMatchObject({ ok: false, codigo: 'trilha_nao_gravou', acao_feita: true })
    expect(banco.logins.find((login) => login.id === BRUNA)?.senha).toBe(SENHA)
    expect(anotacoes).toEqual([
      expect.objectContaining({ evento: 'trilha_nao_gravou', dados: expect.objectContaining({ linha: expect.objectContaining({ acao: 'redefinir_senha' }) }) }),
    ])
    expect(JSON.stringify(anotacoes)).not.toContain(SENHA)
  })
})

/* ------------------------------------------------------------------ */
/* Os passos com desfazer                                              */
/* ------------------------------------------------------------------ */

describe('executarPassos', () => {
  const ordem: string[] = []
  /*
   * Os lugares de verdade são dois (login e ficha); o rótulo separa passos do
   * mesmo lugar na ordem anotada, para o teste de "do último para o primeiro"
   * ter três passos.
   */
  const passo = (
    nome: Passo['passo'],
    opcoes: { falha?: boolean; desfazer?: 'ok' | 'falha' | 'nenhum'; rotulo?: string } = {},
  ): Passo => {
    const rotulo = opcoes.rotulo ?? nome
    return {
      passo: nome,
      fazer: async () => {
        ordem.push(`fazer ${rotulo}`)
        if (opcoes.falha) throw new ErroDePorta('banco', `${rotulo} recusado`, { codigo: '42501' })
      },
      ...(opcoes.desfazer === 'nenhum'
        ? {}
        : {
            desfazer: async () => {
              ordem.push(`desfazer ${rotulo}`)
              if (opcoes.desfazer === 'falha') throw new Error('fetch failed')
            },
          }),
    }
  }

  it('tudo certo: feito', async () => {
    expect((await executarPassos([passo('login'), passo('ficha')])).resultado).toBe('feito')
  })

  it('o primeiro falha: nada feito, nada a desfazer', async () => {
    ordem.length = 0
    const execucao = await executarPassos([passo('login', { falha: true }), passo('ficha')])
    expect(execucao.resultado).toBe('nada_feito')
    expect(ordem).toEqual(['fazer login'])
  })

  it('o terceiro falha: desfaz do último para o primeiro', async () => {
    ordem.length = 0
    const execucao = await executarPassos([
      passo('login'),
      passo('ficha', { rotulo: 'ficha 1' }),
      passo('ficha', { rotulo: 'ficha 2', falha: true }),
    ])
    expect(execucao.resultado).toBe('desfeito')
    expect(ordem).toEqual(['fazer login', 'fazer ficha 1', 'fazer ficha 2', 'desfazer ficha 1', 'desfazer login'])
    expect(execucao.registro.map((registro) => registro.estado)).toEqual(['desfeito', 'desfeito', 'falhou'])
  })

  it('desfazer que falha, ou que não existe: incompleto, e continua desfazendo o resto', async () => {
    ordem.length = 0
    const falhaAoDesfazer = await executarPassos([
      passo('login'),
      passo('ficha', { rotulo: 'ficha 1', desfazer: 'falha' }),
      passo('ficha', { rotulo: 'ficha 2', falha: true }),
    ])
    expect(falhaAoDesfazer.resultado).toBe('incompleto')
    expect(ordem).toContain('desfazer login')
    expect(falhaAoDesfazer.registro.map((registro) => registro.estado)).toEqual(['desfeito', 'nao_desfeito', 'falhou'])

    const semDesfazer = await executarPassos([passo('login', { desfazer: 'nenhum' }), passo('ficha', { falha: true })])
    expect(semDesfazer.resultado).toBe('incompleto')
    expect(semDesfazer.registro[0]).toMatchObject({ estado: 'nao_desfeito', erro: 'Este passo não tem como voltar.' })
  })
})

/* ------------------------------------------------------------------ */
/* O código da função e o SQL da trilha andam juntos                   */
/* ------------------------------------------------------------------ */

describe('o código da função ponto-contas', () => {
  const arquivos = Object.keys(codigoDaFuncao).sort()

  it('são os cinco arquivos do deploy', () => {
    expect(arquivos).toEqual(['atendimento.ts', 'chaves.ts', 'index.ts', 'portas.ts', 'regras.ts'])
  })

  it('só index.ts fala com o Deno e com a rede: os outros quatro rodam no Vitest e no tsc do app', () => {
    for (const arquivo of arquivos.filter((nome) => nome !== 'index.ts')) {
      const codigo = codigoDaFuncao[arquivo].replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '')
      expect(codigo, arquivo).not.toMatch(/\bDeno\./)
      expect(codigo, arquivo).not.toMatch(/from\s+['"](?:npm:|jsr:|https?:)/)
    }
    expect(codigoDaFuncao['index.ts']).toMatch(/Deno\.serve\(/)
  })

  /*
   * A REGRA DAS CHAVES MORA EM `chaves.ts` (as novas, senão as legadas),
   * provada em `src/ponto-contas-chaves.test.ts`. Aqui se segura o outro lado:
   * o `index.ts` não lê variável de chave à mão — uma leitura direta da legada
   * deixaria a função sem chave num projeto que só tem as novas — e o log da
   * configuração incompleta leva o diagnóstico, que só tem estados.
   */
  it('index.ts tira o endereço e as chaves só de resolverChaves, e o log da configuração incompleta leva só o diagnóstico', () => {
    const codigo = (codigoDaFuncao['index.ts'] ?? '').replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '')
    expect(codigo).toMatch(/resolverChaves\(\s*\(nome\)\s*=>\s*Deno\.env\.get\(nome\)\s*\)/)
    expect(codigo.match(/Deno\.env\.get\(/g)).toHaveLength(1)
    expect(codigo).not.toMatch(/SUPABASE_[A-Z_]+/)
    expect(codigo).toMatch(/createClient\(\s*chaves\.url,\s*chaves\.chavePublica,/)
    expect(codigo).toMatch(/createClient\(\s*chaves\.url,\s*chaves\.chaveDeServico,/)
    expect(codigo).toMatch(/console\.error\(JSON\.stringify\(\{\s*evento:\s*'configuracao_incompleta',\s*\.\.\.chaves\.diagnostico\s*\}\)\)/)
    for (const chamada of codigo.match(/console\.\w+\([^\n]*/g) ?? []) {
      expect(chamada).not.toMatch(/chaves\.(?:chavePublica|chaveDeServico|url)\b|\bchaves\s*[,)]/)
    }
  })

  it('as tabelas que o código nomeia são a ficha, a lista de super admins e a trilha, todas da migration da estrutura', () => {
    const sql = Object.values(migrations).join('\n')
    expect(sql.trim()).not.toBe('')
    const nomeados = (padrao: RegExp) =>
      [
        ...new Set(
          arquivos.flatMap((arquivo) =>
            [...codigoDaFuncao[arquivo].replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '').matchAll(padrao)].map((casamento) => casamento[1]),
          ),
        ),
      ].sort()
    // Todo `from()` e todo `rpc()` do supabase-js nomeiam o alvo por texto fixo: a lista abaixo é a lista inteira.
    expect(nomeados(/(?<!Array)\.(?:from|rpc)\(\s*(?!')(\S+)/g)).toEqual([])
    const tabelas = nomeados(/\.from\(\s*'(\w+)'/g)
    expect(tabelas).toEqual(['ponto_contas_trilha', 'ponto_funcionarios', 'ponto_super_admins'])
    for (const tabela of tabelas) {
      expect(sql, tabela).toMatch(new RegExp(String.raw`CREATE\s+TABLE\s+public\.${tabela}\s*\(`))
    }
    expect(nomeados(/\.rpc\(\s*'(\w+)'/g)).toEqual(['ponto_contas_trilha_pronta', 'ponto_sou_super_admin'])
  })

  it('é autocontida: só importa da própria pasta, e o supabase-js com versão exata', () => {
    for (const arquivo of arquivos) {
      for (const [, especificador] of codigoDaFuncao[arquivo].matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (especificador.startsWith('./')) {
          expect(arquivos, `${arquivo} importa ${especificador}`).toContain(especificador.slice(2))
        } else {
          expect(arquivo).toBe('index.ts')
          expect(especificador).toMatch(/^npm:@supabase\/supabase-js@\d+\.\d+\.\d+$/)
        }
      }
    }
  })

  it('o cliente escrito à mão em portas.ts é o do supabase-js de verdade, na versão que index.ts importa', () => {
    // index.ts entrega o cliente de verdade com `as unknown as`, e o Deno não
    // roda no CI: sem isto, um formato que mudasse no supabase-js só apareceria
    // na primeira ação de conta em produção. A conferência é de TIPO — quem
    // reprova é o `tsc -b` do build, que lê este arquivo. `from()` fica de
    // fora: o tipo do PostgREST é fundo demais para o tsc comparar inteiro, e
    // o formato das respostas dele é o do simulado.
    const conferir = (real: SupabaseClient) => {
      const auth: ClienteDoSupabase['auth'] = real.auth
      const rpc: ClienteDoSupabase['rpc'] = (funcao, argumentos) => real.rpc(funcao, argumentos)
      return { auth, rpc }
    }
    expect(conferir).toBeTypeOf('function')

    // E o tipo conferido é o da versão publicada: o import de index.ts e o
    // supabase-js instalado (package-lock) andam juntos. Subiu um, suba o outro
    // — e a função ganha deploy de novo.
    const versaoDoIndex = /from\s+['"]npm:@supabase\/supabase-js@([\d.]+)['"]/.exec(codigoDaFuncao['index.ts'] ?? '')?.[1]
    const travado = JSON.parse(PACOTE_TRAVADO) as { packages?: Record<string, { version?: string }> }
    const versaoInstalada = travado.packages?.['node_modules/@supabase/supabase-js']?.version
    expect(versaoInstalada).toBeTruthy()
    expect(versaoDoIndex, 'o supabase-js de index.ts precisa ser o do package-lock do app').toBe(versaoInstalada)
  })

  it('pergunta "é super admin?" pelo cliente da sessão, e nunca pelo de serviço', () => {
    expect(codigoDaFuncao['portas.ts']).toMatch(/clienteDaSessao\.rpc\('ponto_sou_super_admin'\)/)
    expect(codigoDaFuncao['portas.ts']).not.toMatch(/clienteDoServico\.rpc\('ponto_sou_super_admin'\)/)
  })

  it('toda RPC que a função chama existe na migration da estrutura', () => {
    const sql = Object.values(migrations).join('\n')
    expect(sql.trim()).not.toBe('')
    const rpcs = [...codigoDaFuncao['portas.ts'].matchAll(/\.rpc\('(\w+)'/g)].map((casamento) => casamento[1])
    expect(rpcs).toEqual(['ponto_sou_super_admin', 'ponto_contas_trilha_pronta'])
    for (const rpc of rpcs) {
      expect(sql, rpc).toMatch(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${rpc}\\(`))
    }
  })

  it('a trilha de contas nasce uma vez só, na migration da estrutura', () => {
    expect(ARQUIVOS_DA_TRILHA).toEqual(['20261023180000_ponto_livre_estrutura.sql'])
    expect(SQL_DA_TRILHA.trim()).not.toBe('')
    expect(SQL_DA_TRILHA.match(/CREATE\s+TABLE\s+public\.ponto_contas_trilha\s*\(/g)).toHaveLength(1)
    // O lock_timeout vem antes da primeira mudança.
    const tempo = SQL_DA_TRILHA.indexOf('SET LOCAL lock_timeout')
    expect(tempo).toBeGreaterThanOrEqual(0)
    expect(tempo).toBeLessThan(SQL_DA_TRILHA.indexOf('CREATE '))
  })

  it('grava na trilha exatamente as colunas do GRANT INSERT do SQL da trilha', () => {
    expect(colunasDoGrant.length).toBeGreaterThan(0)
    expect([...COLUNAS_DA_TRILHA].sort()).toEqual([...colunasDoGrant].sort())
  })

  it('as chaves de senha da função são as do CHECK do banco, nas três colunas JSON', () => {
    expect(chavesDoCheckSemSenha.sort()).toEqual([...CHAVES_DE_SENHA].sort())
    // O CHECK passa as três colunas JSON pela função das chaves.
    for (const coluna of ['antes', 'depois', 'passos']) {
      expect(trechoDoCheckSemSenha, coluna).toMatch(new RegExp(String.raw`NOT\s+public\.ponto_contas_tem_chave_de_senha\(\s*${coluna}\s*\)`))
    }
  })

  /*
   * POR QUE EM MINÚSCULAS: um CHECK com `jsonb_path_exists(...,
   * 'exists(@.senha) || ...')` compara a chave como está — `senhaProvisoria`,
   * `Senha` e `PASSWORD` passariam. As duas travas comparam em minúsculas.
   */
  it('as chaves de senha valem sem diferenciar maiúsculas, nas duas travas (a função e o CHECK)', () => {
    // A função compara com lower(), e a lista dela está toda em minúsculas.
    expect(corpoDaFuncaoDoCheck).toMatch(/lower\(\s*v_chave\s*\)\s*=\s*ANY/i)
    expect(chavesDoCheckSemSenha.every((chave) => chave === chave.toLowerCase())).toBe(true)
    expect(chavesDoCheckSemSenha).toContain('senhaprovisoria')
    // E desce em objetos e listas.
    expect(corpoDaFuncaoDoCheck).toMatch(/jsonb_each\(/)
    expect(corpoDaFuncaoDoCheck).toMatch(/jsonb_array_elements\(/)
    expect(corpoDaFuncaoDoCheck).toMatch(/public\.ponto_contas_tem_chave_de_senha\(\s*v_filho\s*\)/)
    // IMMUTABLE (exigido para entrar num CHECK com honestidade), search_path fixo,
    // e sem EXECUTE para o app; o service_role, que grava, executa.
    const cabecalho = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.ponto_contas_tem_chave_de_senha[\s\S]*?\bAS\s+\$\$/i.exec(SQL_DA_TRILHA)?.[0] ?? ''
    expect(cabecalho).toMatch(/\bIMMUTABLE\b/)
    expect(cabecalho).toMatch(/SET\s+search_path\s*=\s*pg_catalog/)
    expect(SQL_DA_TRILHA).toMatch(
      /REVOKE\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.ponto_contas_tem_chave_de_senha\((?:p_valor\s+)?jsonb\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated(?:,\s*service_role)?;/,
    )
    expect(SQL_DA_TRILHA).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.ponto_contas_tem_chave_de_senha\((?:p_valor\s+)?jsonb\)\s+TO\s+service_role;/,
    )
    // A função vem antes da tabela: o CHECK a cita.
    const funcao = SQL_DA_TRILHA.search(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.ponto_contas_tem_chave_de_senha\b/)
    const tabela = SQL_DA_TRILHA.search(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.ponto_contas_trilha\b/)
    expect(funcao).toBeGreaterThanOrEqual(0)
    expect(funcao).toBeLessThan(tabela)
  })

  it('a trilha simulada recusa a senha em camelCase e em maiúsculas, como o CHECK', () => {
    for (const valor of [{ senhaProvisoria: 'x' }, { login: { SENHA: 'x' } }, [{ dados: { Nova_Senha: 'x' } }], { PASSWORD: 'x' }]) {
      expect(temChaveDeSenha(valor, chavesDoCheckSemSenha), JSON.stringify(valor)).toBe(true)
    }
    expect(temChaveDeSenha({ login: { email: 'a@example.com' }, senhas_trocadas: 1, nota: 'Senha' }, chavesDoCheckSemSenha)).toBe(false)
  })

  /*
   * A migration não grava linha nenhuma na trilha para provar o CHECK: o
   * gatilho da trilha exige um super admin como autor, e numa instalação nova
   * ainda não há nenhum. A conferência do fim dela acha a constraint pelo NOME
   * (outro CHECK da tabela não provaria nada), exige a função nas três colunas
   * JSON e passa pela função os casos que escapavam de uma comparação sensível
   * a maiúsculas (camelCase, maiúsculas, escondidos num nível de baixo). A
   * recusa da linha inteira, com o nome da constraint no erro, é dos testes de
   * banco.
   */
  it('a conferência do fim da migration acha o CHECK sem senha pelo NOME da constraint e prova a função com a senha escondida e em maiúsculas', () => {
    const inicio = SQL_DA_TRILHA.indexOf('DO $fim$')
    expect(inicio).toBeGreaterThanOrEqual(0)
    const conferencia = SQL_DA_TRILHA.slice(inicio, SQL_DA_TRILHA.indexOf('END $fim$', inicio))
    expect(conferencia).toMatch(/conname\s*=\s*'ponto_contas_trilha_sem_senha'/)
    for (const coluna of ['antes', 'depois', 'passos']) {
      expect(conferencia, coluna).toContain(`ponto_contas_tem_chave_de_senha(${coluna})`)
    }
    expect(conferencia).not.toMatch(/WHEN\s+check_violation\s+THEN/i)
    for (const caso of ['senhaProvisoria', 'SENHA_PROVISORIA', 'Nova_Senha']) expect(conferencia, caso).toContain(caso)
    // E o caso que passasse aborta a migration inteira.
    expect(conferencia).toMatch(/IF NOT public\.ponto_contas_tem_chave_de_senha\(v_caso\.valor\) THEN\s+RAISE EXCEPTION/)
  })

  it('as ações da função são as do CHECK do banco', () => {
    expect(acoesDoCheck).toEqual([...ACOES])
  })
})
