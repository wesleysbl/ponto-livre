import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * O APOIO DOS TESTES DE PONTA A PONTA (`e2e/`).
 *
 * Os testes de `e2e/` abrem o app de verdade, no Chrome da máquina, contra o
 * Supabase LOCAL de verdade (`npm run db:iniciar`). Este arquivo é a ponte com
 * o que não é tela:
 *   • as chaves do Supabase local, lidas de `npx supabase status -o env`;
 *   • a API de administração do login, que cria a conta do mesmo jeito que o
 *     "Add user" do painel do Supabase com "Auto Confirm User";
 *   • o SQL rodado como `postgres` pelo psql de DENTRO do contêiner do banco
 *     (`supabase_db_<project_id>`). É assim que o primeiro super admin nasce
 *     (`supabase/primeiro-super-admin.sql`): nem a chave de serviço grava na
 *     lista de super admins, só o dono do banco.
 *
 * NENHUMA CHAVE É IMPRESSA. Nem no erro: as mensagens daqui dizem o nome da
 * variável que faltou, nunca o valor. As chaves do Supabase local são as de
 * demonstração do CLI, e mesmo assim não vão para log nem para o repositório.
 *
 * SÓ O SUPABASE LOCAL. O teste cria contas e batidas de verdade; por isso a
 * URL da API tem de ser de loopback (127.0.0.1 ou localhost), ou o apoio
 * recusa antes de criar qualquer coisa.
 *
 * Roda no Node (o processo do Playwright), e não no navegador.
 */

/** A raiz do repositório (este arquivo mora em `e2e/`). */
export const RAIZ = fileURLToPath(new URL('..', import.meta.url))

/* ------------------------------------------------------------------ */
/* As chaves do Supabase local                                         */
/* ------------------------------------------------------------------ */

export interface SupabaseLocal {
  /** `API_URL`: o endereço do gateway local (login, banco, storage e funções). */
  urlDaApi: string
  /** `PUBLISHABLE_KEY`: a chave pública que o app usa no navegador. */
  chavePublicavel: string
  /** `ANON_KEY`: o JWT do papel `anon` — serve para provar que ele não vale como sessão. */
  chaveAnonima: string
  /** `SERVICE_ROLE_KEY`: a da API de administração do login. Nunca vai para o navegador. */
  chaveDeServico: string
}

let lido: SupabaseLocal | null = null

/**
 * As chaves, de `npx supabase status -o env` (o CLI do projeto, em
 * `node_modules`). Lidas uma vez por processo.
 *
 * A saída do comando nunca é repassada: o que não se reconhece é ignorado, e
 * a falha diz o que fazer sem mostrar o que o comando respondeu.
 */
export function supabaseLocal(): SupabaseLocal {
  if (lido) return lido

  let saida: string
  try {
    saida = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    })
  } catch {
    throw new Error(
      'O Supabase local não respondeu a `npx supabase status`. Ligue o Docker e suba o Supabase local com `npm run db:iniciar`.',
    )
  }

  const valores = new Map<string, string>()
  for (const linha of saida.split('\n')) {
    const achado = /^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/.exec(linha.trim())
    if (achado) valores.set(achado[1], achado[2] ?? achado[3] ?? '')
  }
  const pegar = (nome: string): string => {
    const valor = valores.get(nome)
    if (!valor) {
      throw new Error(`\`npx supabase status -o env\` não trouxe ${nome}. Confira se o Supabase local subiu inteiro (npm run db:iniciar).`)
    }
    return valor
  }

  const urlDaApi = pegar('API_URL').replace(/\/+$/, '')
  const host = new URL(urlDaApi).hostname
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
    throw new Error('Os testes de ponta a ponta só rodam no Supabase local: a API_URL do `supabase status` não é de loopback.')
  }

  lido = {
    urlDaApi,
    chavePublicavel: pegar('PUBLISHABLE_KEY'),
    chaveAnonima: pegar('ANON_KEY'),
    chaveDeServico: pegar('SERVICE_ROLE_KEY'),
  }
  return lido
}

/* ------------------------------------------------------------------ */
/* SQL como postgres, no contêiner do banco                            */
/* ------------------------------------------------------------------ */

/**
 * O contêiner do banco: `supabase_db_<project_id>`, o nome que o Supabase CLI
 * dá a partir de `supabase/config.toml` (o mesmo de `scripts/testar-banco.sh`).
 */
export function conteinerDoBanco(): string {
  const config = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8')
  const projeto = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
  if (!projeto || !/^[A-Za-z0-9_.-]+$/.test(projeto)) {
    throw new Error('Não achei o project_id em supabase/config.toml.')
  }
  return `supabase_db_${projeto}`
}

/**
 * Roda SQL como `postgres` — o papel do SQL Editor do painel do Supabase —,
 * pelo psql de dentro do contêiner, pelo socket local: nenhuma senha é lida
 * nem passada. Devolve a saída do psql (`-At`: só os valores, separados por |).
 *
 * `ON_ERROR_STOP`: o primeiro erro para o arquivo, e a falha vem com a frase
 * do banco (que é texto do ponto, não segredo).
 */
export function rodarComoPostgres(sql: string): string {
  try {
    return execFileSync(
      'docker',
      [
        'exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', conteinerDoBanco(),
        'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-',
      ],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 },
    )
  } catch (erro) {
    const falha = erro as NodeJS.ErrnoException & { stderr?: string }
    if (falha.code === 'ENOENT') {
      throw new Error('O docker não está no PATH: o SQL como postgres roda pelo psql do contêiner do Supabase local.')
    }
    throw new Error(`O SQL como postgres falhou: ${falha.stderr?.trim() || falha.message}`)
  }
}

/* ------------------------------------------------------------------ */
/* Contas e o primeiro super admin                                     */
/* ------------------------------------------------------------------ */

/**
 * Cria a conta como o "Add user" do painel do Supabase, com "Auto Confirm
 * User": e-mail, senha e o e-mail já confirmado — e mais nada. Sem nome, como
 * no painel; quem quiser o nome troca pelo app ("Trocar o nome").
 *
 * `autoConfirmar: false` é o mesmo "Add user" com a caixa desmarcada: a conta
 * nasce com o e-mail por confirmar.
 */
export async function criarContaComoNoPainel(
  email: string,
  senha: string,
  { autoConfirmar = true }: { autoConfirmar?: boolean } = {},
): Promise<string> {
  const { urlDaApi, chaveDeServico } = supabaseLocal()
  const resposta = await fetch(`${urlDaApi}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: chaveDeServico,
      Authorization: `Bearer ${chaveDeServico}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: senha, email_confirm: autoConfirmar }),
  })
  const corpo = (await resposta.json().catch(() => null)) as { id?: unknown; msg?: unknown } | null
  if (!resposta.ok || typeof corpo?.id !== 'string') {
    throw new Error(`A API de administração do login não criou ${email}: HTTP ${resposta.status} ${String(corpo?.msg ?? '')}`.trim())
  }
  return corpo.id
}

/** O e-mail de exemplo do arquivo do primeiro super admin: o único lugar que quem instala troca. */
export const EMAIL_DE_EXEMPLO = 'voce@example.com'

/**
 * O `supabase/primeiro-super-admin.sql` com o e-mail trocado — a mesma troca
 * única que quem instala faz à mão no SQL Editor.
 *
 * O arquivo tem de ter o e-mail de exemplo UMA VEZ SÓ: é a promessa que ele
 * faz a quem instala ("é o único lugar"), e este teste a segura.
 */
export function sqlDoPrimeiroSuperAdmin(email: string): string {
  const modelo = readFileSync(join(RAIZ, 'supabase', 'primeiro-super-admin.sql'), 'utf8')
  const vezes = modelo.split(EMAIL_DE_EXEMPLO).length - 1
  if (vezes !== 1) {
    throw new Error(`supabase/primeiro-super-admin.sql tem de ter ${EMAIL_DE_EXEMPLO} uma vez só (a troca única de quem instala); tem ${vezes}.`)
  }
  // O e-mail entra num literal de texto do SQL: nada de aspas nem barra.
  if (!/^[^\s'"\\]+@[^\s'"\\]+\.[^\s'"\\]+$/.test(email)) {
    throw new Error(`E-mail fora do formato esperado: ${email}`)
  }
  return modelo.replace(EMAIL_DE_EXEMPLO, email)
}

/** Põe a conta na lista de super admins rodando o arquivo da instalação como `postgres`. */
export function tornarSuperAdmin(email: string): string {
  return rodarComoPostgres(sqlDoPrimeiroSuperAdmin(email))
}

/** Apaga a conta pela API de administração do login (a conta de prova que não deve ficar). */
export async function apagarConta(id: string): Promise<void> {
  const { urlDaApi, chaveDeServico } = supabaseLocal()
  const resposta = await fetch(`${urlDaApi}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: chaveDeServico, Authorization: `Bearer ${chaveDeServico}` },
  })
  if (!resposta.ok) throw new Error(`A API de administração do login não apagou a conta: HTTP ${resposta.status}`)
}

/** Os dois tokens de uma sessão do login: o de acesso e o de renovar. */
export interface SessaoDoLogin {
  acesso: string
  renovacao: string
}

/**
 * Entra pela API do login, com e-mail e senha, e devolve os dois tokens da
 * sessão — os mesmos que o app guarda depois do "Entrar".
 */
export async function entrarComSessao(email: string, senha: string): Promise<SessaoDoLogin> {
  const { urlDaApi, chavePublicavel } = supabaseLocal()
  const resposta = await fetch(`${urlDaApi}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: chavePublicavel, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  })
  const corpo = (await resposta.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown } | null
  if (!resposta.ok || typeof corpo?.access_token !== 'string' || typeof corpo?.refresh_token !== 'string') {
    throw new Error(`O login recusou ${email}: HTTP ${resposta.status}`)
  }
  return { acesso: corpo.access_token, renovacao: corpo.refresh_token }
}

/**
 * Entra pela API do login e devolve só o token de acesso. Para os testes que
 * chamam a função de contas direto, sem tela.
 */
export async function entrarPelaApi(email: string, senha: string): Promise<string> {
  return (await entrarComSessao(email, senha)).acesso
}

/**
 * Tenta renovar uma sessão com o token de renovar, como o app faz sozinho a
 * cada hora. Devolve o status HTTP e o código do login (`refresh_token_not_found`
 * quando a sessão foi encerrada), nunca o token novo.
 */
export async function renovarSessao(renovacao: string): Promise<{ status: number; codigo: string }> {
  const { urlDaApi, chavePublicavel } = supabaseLocal()
  const resposta = await fetch(`${urlDaApi}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: chavePublicavel, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: renovacao }),
  })
  const corpo = (await resposta.json().catch(() => null)) as { error_code?: unknown; code?: unknown } | null
  return { status: resposta.status, codigo: String(corpo?.error_code ?? corpo?.code ?? '') }
}

/* ------------------------------------------------------------------ */
/* Datas e nomes da execução                                           */
/* ------------------------------------------------------------------ */

/**
 * O carimbo desta execução: AAMMDDhhmmss, em UTC. Vai nos e-mails
 * (`ana+260101120000@example.com`, numa execução de 1º/1/2026 às 12h00 UTC),
 * para o teste rodar de novo no mesmo banco sem esbarrar nas contas da vez
 * anterior — o login não aceita dois e-mails iguais. Um por processo: todos os
 * testes da execução usam o mesmo.
 */
export const CARIMBO = new Date().toISOString().replace(/\D/g, '').slice(2, 14)

/** `nome+carimbo@example.com`: o domínio reservado para exemplo, e o mesmo nome do elenco. */
export function emailDaExecucao(nome: string): string {
  return `${nome}+${CARIMBO}@example.com`
}

/** Hoje no fuso do ponto (America/Sao_Paulo), como `AAAA-MM-DD` — o valor de um `<input type="date">`. */
export function hojeNoPonto(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
