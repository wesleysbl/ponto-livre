import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  apagarConta,
  criarContaComoNoPainel,
  emailDaExecucao,
  entrarComSessao,
  entrarPelaApi,
  renovarSessao,
  rodarComoPostgres,
  supabaseLocal,
  tornarSuperAdmin,
} from './apoio.ts'

/*
 * A FUNÇÃO DE CONTAS (`ponto-contas`) PELO CAMINHO REAL, SEM TELA.
 *
 * Os testes de `src/ponto-contas*.test.ts` provam as regras da função contra
 * um Supabase simulado. Aqui é o caminho de verdade: o gateway do Supabase
 * local, o `verify_jwt` de `supabase/config.toml`, o login, a pergunta
 * "é super admin?" feita ao banco com a sessão de quem chama, a API de
 * administração do login e a trilha de contas.
 *
 *   • sem sessão — sem cabeçalho nenhum, só com a chave publicável, ou com a
 *     chave anônima (um JWT válido, mas de ninguém) no lugar da sessão: 401;
 *   • com a sessão de quem não é super admin: 403, e nada muda;
 *   • com a sessão do super admin: cria a conta, troca o nome, troca o e-mail,
 *     redefine a senha (a conta entra com o e-mail e a senha novos) e cria
 *     outra conta já ligando a ficha sem conta; cada ação vira uma linha na
 *     trilha;
 *   • o nome mora no app_metadata, que só a chave de serviço grava: a pessoa
 *     troca o próprio user_metadata pela API do login, e o nome que o admin vê
 *     não muda;
 *   • redefinir a senha encerra as sessões abertas da pessoa: o token de
 *     renovar dos aparelhos logados não renova mais;
 *   • o arquivo do primeiro super admin recusa conta sem e-mail confirmado.
 *
 * São contas fictícias (Vítor Campos, Bruna Exemplo), com o carimbo da
 * execução nos e-mails.
 */

test.describe.configure({ mode: 'serial' })

const senhaAleatoria = () => `Ponto-${randomBytes(9).toString('base64url')}`

const superAdmin = { email: emailDaExecucao('admin.api'), senha: senhaAleatoria(), token: '', id: '' }
const comum = { email: emailDaExecucao('vitor.api'), senha: senhaAleatoria(), token: '', id: '' }

interface Resposta {
  status: number
  corpo: Record<string, unknown> | null
}

/** Um pedido à função, com os cabeçalhos dados — e só eles. */
async function pedir(corpo: unknown, cabecalhos: Record<string, string>): Promise<Resposta> {
  const resposta = await fetch(`${supabaseLocal().urlDaApi}/functions/v1/ponto-contas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecalhos },
    body: JSON.stringify(corpo),
  })
  return { status: resposta.status, corpo: (await resposta.json().catch(() => null)) as Resposta['corpo'] }
}

/** Como o app chama: a chave publicável e a sessão de quem está logado. */
const comSessao = (token: string) => ({ apikey: supabaseLocal().chavePublicavel, Authorization: `Bearer ${token}` })

const criarConta = (email: string, nome: string, extra: Record<string, string> = {}) => ({
  acao: 'criar_conta',
  email,
  nome,
  senha_provisoria: senhaAleatoria(),
  ...extra,
})

test.beforeAll(async () => {
  superAdmin.id = await criarContaComoNoPainel(superAdmin.email, superAdmin.senha)
  expect(tornarSuperAdmin(superAdmin.email)).toContain(superAdmin.email)
  comum.id = await criarContaComoNoPainel(comum.email, comum.senha)
  superAdmin.token = await entrarPelaApi(superAdmin.email, superAdmin.senha)
  comum.token = await entrarPelaApi(comum.email, comum.senha)
})

test('sem sessão, a função responde 401 e não cria nada', async () => {
  const email = emailDaExecucao('bruna.sem-sessao')
  const semNada = await pedir(criarConta(email, 'Bruna Exemplo'), {})
  expect(semNada.status).toBe(401)

  const soAChave = await pedir(criarConta(email, 'Bruna Exemplo'), { apikey: supabaseLocal().chavePublicavel })
  expect(soAChave.status).toBe(401)
  expect(soAChave.corpo).toMatchObject({ ok: false, codigo: 'sem_sessao' })

  const chaveAnonima = supabaseLocal().chaveAnonima
  const anonimo = await pedir(criarConta(email, 'Bruna Exemplo'), { apikey: chaveAnonima, Authorization: `Bearer ${chaveAnonima}` })
  expect(anonimo.status).toBe(401)
  expect(anonimo.corpo).toMatchObject({ ok: false, codigo: 'sessao_invalida' })

  expect(rodarComoPostgres(`SELECT count(*) FROM auth.users WHERE email = '${email}';`).trim()).toBe('0')
})

test('com a sessão de quem não é super admin, a função responde 403 e não cria nada', async () => {
  const email = emailDaExecucao('bruna.comum')
  const resposta = await pedir(criarConta(email, 'Bruna Exemplo'), comSessao(comum.token))
  expect(resposta.status).toBe(403)
  expect(resposta.corpo).toMatchObject({ ok: false, codigo: 'nao_e_super_admin' })
  expect(rodarComoPostgres(`SELECT count(*) FROM auth.users WHERE email = '${email}';`).trim()).toBe('0')
})

test('com a sessão do super admin: cria a conta, troca nome e e-mail, redefine a senha e liga a ficha', async () => {
  const email = emailDaExecucao('bruna.exemplo')
  const criada = await pedir(criarConta(email, 'Bruna Exemplo'), comSessao(superAdmin.token))
  expect(criada.status).toBe(200)
  expect(criada.corpo).toMatchObject({ ok: true, acao: 'criar_conta' })
  const conta = String(criada.corpo?.usuario_id)

  const nome = await pedir({ acao: 'trocar_nome', usuario_id: conta, nome: 'Bruna Exemplo Costa' }, comSessao(superAdmin.token))
  expect(nome.status).toBe(200)

  const emailNovo = emailDaExecucao('bruna.exemplo.novo')
  const trocaDeEmail = await pedir({ acao: 'trocar_email', usuario_id: conta, email: emailNovo }, comSessao(superAdmin.token))
  expect(trocaDeEmail.status).toBe(200)

  const senhaNova = senhaAleatoria()
  const senha = await pedir({ acao: 'redefinir_senha', usuario_id: conta, senha_provisoria: senhaNova }, comSessao(superAdmin.token))
  expect(senha.status).toBe(200)
  // A conta entra com o e-mail e a senha novos.
  await entrarPelaApi(emailNovo, senhaNova)

  // A ficha sem conta nasce como o RH a cria; a conta nova já nasce ligada a ela.
  const ficha = rodarComoPostgres(
    "INSERT INTO public.ponto_funcionarios (nome_completo, cargo) VALUES ('Vítor Campos', 'Vendas') RETURNING id;",
  ).trim()
  const emailDoVitor = emailDaExecucao('vitor.campos')
  const ligada = await pedir(criarConta(emailDoVitor, 'Vítor Campos', { ficha_id: ficha }), comSessao(superAdmin.token))
  expect(ligada.status).toBe(200)

  const banco = rodarComoPostgres(`
    SELECT
      (SELECT u.raw_app_meta_data->>'full_name' FROM auth.users u WHERE u.id = '${conta}'),
      (SELECT u.email FROM auth.users u WHERE u.id = '${conta}'),
      (SELECT u.email FROM public.ponto_funcionarios f JOIN auth.users u ON u.id = f.usuario_id WHERE f.id = '${ficha}'),
      (SELECT string_agg(t.acao || ':' || t.resultado, ',' ORDER BY t.feito_em)
         FROM public.ponto_contas_trilha t WHERE t.autor_id = '${superAdmin.id}');
  `).trim()
  expect(banco).toBe(
    `Bruna Exemplo Costa|${emailNovo}|${emailDoVitor}|criar_conta:feito,trocar_nome:feito,trocar_email:feito,redefinir_senha:feito,criar_conta:feito`,
  )
})

/** Uma chamada à API do banco (PostgREST) com a sessão de alguém, como o app faz. */
async function rpc(funcao: string, token: string): Promise<{ status: number; corpo: unknown }> {
  const { urlDaApi, chavePublicavel } = supabaseLocal()
  const resposta = await fetch(`${urlDaApi}/rest/v1/rpc/${funcao}`, {
    method: 'POST',
    headers: { apikey: chavePublicavel, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  return { status: resposta.status, corpo: await resposta.json().catch(() => null) }
}

test('o nome que a própria pessoa escreve no login não muda o nome que o admin vê', async () => {
  // O super admin dá o nome pela função: ele vai para o app_metadata, que só
  // a chave de serviço grava.
  const nome = await pedir({ acao: 'trocar_nome', usuario_id: comum.id, nome: 'Vítor Campos' }, comSessao(superAdmin.token))
  expect(nome.status).toBe(200)

  // A pessoa troca o próprio user_metadata pela API do login, como qualquer
  // conta consegue, sem a função e sem trilha.
  const { urlDaApi, chavePublicavel } = supabaseLocal()
  const propria = await fetch(`${urlDaApi}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: chavePublicavel, Authorization: `Bearer ${comum.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { full_name: 'Nome Escolhido Pela Pessoa' } }),
  })
  expect(propria.status).toBe(200)

  // Quem administra lê a lista de contas como o app lê, pela sessão dele: o
  // nome é o que a função guardou.
  const contas = await rpc('ponto_contas', superAdmin.token)
  expect(contas.status).toBe(200)
  const linha = (contas.corpo as { usuario_id: string; nome: string | null }[]).find((conta) => conta.usuario_id === comum.id)
  expect(linha?.nome).toBe('Vítor Campos')

  // A própria pessoa também não se vê com o nome escolhido por ela.
  const acesso = await rpc('ponto_meu_acesso', comum.token)
  expect(acesso.corpo).toMatchObject({ tem_acesso: false, nome: 'Vítor Campos' })

  // O nome escolhido existe, mas só no user_metadata, que nada no ponto lê.
  expect(
    rodarComoPostgres(
      `SELECT u.raw_user_meta_data->>'full_name', u.raw_app_meta_data->>'full_name' FROM auth.users u WHERE u.id = '${comum.id}';`,
    ).trim(),
  ).toBe('Nome Escolhido Pela Pessoa|Vítor Campos')
})

test('redefinir a senha pela função encerra as sessões abertas da pessoa', async () => {
  const email = emailDaExecucao('bruna.sessoes')
  const senhaProvisoria = senhaAleatoria()
  const criada = await pedir(
    { acao: 'criar_conta', email, nome: 'Bruna Exemplo', senha_provisoria: senhaProvisoria },
    comSessao(superAdmin.token),
  )
  expect(criada.status).toBe(200)
  const conta = String(criada.corpo?.usuario_id)

  // Dois aparelhos com a sessão aberta, e o login reconhece os dois.
  const celular = await entrarComSessao(email, senhaProvisoria)
  const computador = await entrarComSessao(email, senhaProvisoria)
  const { urlDaApi, chavePublicavel } = supabaseLocal()
  const quemSou = (token: string) => fetch(`${urlDaApi}/auth/v1/user`, { headers: { apikey: chavePublicavel, Authorization: `Bearer ${token}` } })
  expect((await quemSou(celular.acesso)).status).toBe(200)

  const senhaNova = senhaAleatoria()
  const redefinida = await pedir({ acao: 'redefinir_senha', usuario_id: conta, senha_provisoria: senhaNova }, comSessao(superAdmin.token))
  expect(redefinida.status).toBe(200)

  // As duas sessões acabaram: o token de renovar não renova mais, e o login
  // não reconhece mais a sessão do token de acesso.
  for (const sessao of [celular, computador]) {
    expect(await renovarSessao(sessao.renovacao)).toEqual({ status: 400, codigo: 'refresh_token_not_found' })
  }
  expect((await quemSou(celular.acesso)).status).toBe(403)

  // A senha antiga não entra mais; a nova entra.
  await expect(entrarComSessao(email, senhaProvisoria)).rejects.toThrow(/HTTP 400/)
  await entrarComSessao(email, senhaNova)
})

test('o arquivo do primeiro super admin recusa conta sem e-mail confirmado, e diz o que fazer', async () => {
  // O "Add user" do painel com "Auto Confirm User" desmarcado.
  const email = emailDaExecucao('sergio.sem-confirmar')
  const id = await criarContaComoNoPainel(email, senhaAleatoria(), { autoConfirmar: false })
  try {
    expect(() => tornarSuperAdmin(email)).toThrow(/ainda não foi confirmado[\s\S]*"Auto Confirm User"/)
    expect(rodarComoPostgres(`SELECT count(*) FROM public.ponto_super_admins WHERE usuario_id = '${id}';`).trim()).toBe('0')
  } finally {
    await apagarConta(id)
  }
})
