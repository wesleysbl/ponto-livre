/*
 * A DEMONSTRAÇÃO: GENTE FICTÍCIA E UM MÊS DE BATIDAS NO SUPABASE LOCAL
 *
 *   npm run demo:semear               semeia num banco local sem a demonstração
 *   npm run demo:semear -- --zerar    APAGA o banco local inteiro e semeia do zero
 *
 * Depois, `npm run demo:prints` tira os prints de `docs/imagens/` com estes
 * dados. O app de desenvolvimento (`npm run dev`) também abre com eles.
 *
 * SÓ NO SUPABASE LOCAL. A URL da API (de `npx supabase status`) tem de ser de
 * loopback, e o SQL roda pelo psql de dentro do contêiner do banco local. Nada
 * aqui fala com um Supabase da nuvem.
 *
 * ---------------------------------------------------------------------------
 * A SENHA E O PIN DE DEMONSTRAÇÃO — SÓ PARA O BANCO LOCAL
 *
 * Todas as contas abaixo entram com a mesma senha e batem com o mesmo PIN:
 *
 *     senha  demo-ponto-2026
 *     PIN    1234
 *
 * São públicos de propósito (estão no repositório e em docs/RODAR-LOCAL.md):
 * servem para qualquer um abrir a demonstração na própria máquina. Nunca use
 * esta senha, este PIN nem estas contas num ponto de verdade.
 * ---------------------------------------------------------------------------
 *
 * QUEM ESTÁ NA DEMONSTRAÇÃO (o elenco fictício do projeto; e-mails no domínio
 * reservado example.com, sem CPF e sem CNPJ, rostos desenhados em demo/rostos/):
 *   • Sérgio Almeida, admin@example.com — o super admin, que instalou o ponto;
 *   • Rita Moraes, rh@example.com — o RH: administra o ponto e não bate (sem ficha);
 *   • Ana Beatriz Rocha (Vendas), Bruna Costa (Compras), Caio Mendes
 *     (Operações), Daniela Freitas (Administrativo) e Gustavo Ramos
 *     (Logística) — conta e ficha, batem ponto;
 *   • Fernanda Teles — só a ficha, desativada e com data de desligamento: o
 *     histórico de quem saiu (a ficha não se apaga: é dela o nome completo que
 *     sai nas folhas já assinadas; o resto do cabeçalho da folha são os dados
 *     da empresa e o e-mail da conta).
 * A empresa é a Empresa Exemplo Ltda (Rua das Flores, 100, Campinas/SP, sem
 * CNPJ), jornada de 8h com 10 min de tolerância e janela de 60 s, e o local é
 * a "Sede da Empresa Exemplo", no centro de São Paulo, com raio de 150 m.
 *
 * O MÊS DE BATIDAS. Os dias úteis do mês corrente até ontem (sem sábado,
 * domingo e os feriados nacionais de data fixa), 4 batidas por dia, com
 * variação de minutos de pessoa para pessoa e de dia para dia; cada batida com
 * a selfie desenhada da pessoa e uma coordenada a poucos metros do local. Se o
 * mês corrente ainda tem menos de 10 dias úteis passados (o começo do mês), o
 * "mês da demonstração" é o anterior, inteiro, e os dias do corrente vêm
 * junto. O sorteio é fixo (a semente do sorteio é a pessoa e o dia): rodar de
 * novo dá os mesmos horários.
 *
 * E OS CASOS QUE AS TELAS PRECISAM MOSTRAR, todos no mês da demonstração:
 *   • a Ana bate a volta do almoço do 1º dia útil sem localização (o GPS não
 *     respondeu), e a entrada e a saída para o almoço do 2º na Av. Paulista do
 *     elenco, a 2,6 km do local ("fora do local");
 *   • a Bruna bate a entrada do 5º dia útil às 8h47, e o RH corrige para 8h00,
 *     com motivo — a correção fica na trilha;
 *   • o Gustavo esquece a volta do almoço do 6º dia útil, e o RH a insere, com
 *     motivo; ele também bate duas vezes da Paulista no penúltimo dia útil;
 *   • o Caio falta no 9º dia útil, com atestado médico (o papel é
 *     `demo/atestado.html`, fictício e dizendo isso em letras grandes);
 *   • a Daniela esquece a saída do 4º dia útil antes do fim: um dia
 *     incompleto, para o "Antes de fechar" do painel;
 *   • e o Caio pede, hoje, uma batida esquecida, que fica esperando decisão.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AS BATIDAS DO PASSADO ENTRAM COMO ENTRAM
 *
 * O banco não deixa nascer uma batida "do app" fora de agora: a origem `app`
 * só sai da RPC `ponto_registrar_batida`, e quem põe o horário é o gatilho
 * `trg_ponto_carimbar_registro`, que usa o relógio do servidor. Um INSERT com
 * horário no passado, por qualquer papel, vira lançamento de quem administra
 * (`ajuste_admin`, com motivo e a marca "ajuste do admin"). É a defesa que
 * impede alguém de forjar batida — e é por isso que um mês de histórico não
 * se cria pela API.
 *
 * O caminho escolhido, e o único que não mente nem enfraquece a defesa:
 *   1. TUDO QUE TEM PORTA NO APP PASSA PELA PORTA DO APP, com a sessão de quem
 *      faz: as contas nascem pela função `ponto-contas` (o nome vai para o
 *      `app_metadata`), o super admin pelo `supabase/primeiro-super-admin.sql`,
 *      fichas, configuração, local e administração pelo super admin, o PIN pela
 *      RPC de cada um, e a correção, a inserção e a falta com atestado pela
 *      sessão do RH. O pedido de batida esquecida de hoje é do próprio Caio, pela
 *      RPC, com selfie e PIN — como no celular.
 *   2. SÓ O HISTÓRICO "DO APP" ENTRA COMO O DONO DO BANCO, numa transação só,
 *      pelo psql do contêiner. Nela, e só nela, o `postgres` (dono da tabela)
 *      desliga UM gatilho, o do carimbo, e preenche cada coluna que ele
 *      preencheria, com as mesmas funções do banco: dia civil no fuso do ponto,
 *      tipo e ordem pela ordem do dia, distância por `ponto_distancia_metros`
 *      contra o local ativo arredondada ao centímetro, a marca no local / fora
 *      dele, o nome por `ponto_nome_da_conta`, o e-mail da conta, a própria
 *      pessoa como autora e o horário da batida como criação. Os outros
 *      gatilhos ficam ligados e conferem a carga: a trava de futuro recusaria
 *      um horário depois de agora, a ligação com pedido de atraso recusaria uma
 *      batida pendurada num pedido, e a reordenação do dia, que roda depois de
 *      cada linha, regravaria tipo e ordem (deixando trilha) se a conta daqui
 *      divergisse da do banco. O gatilho volta ligado antes do COMMIT, e a
 *      transação confere: não foi preciso reordenar nada, nenhuma trilha
 *      nasceu, toda selfie está no bucket. Se algo não bate, nada fica.
 *      ALTER TABLE segura a tabela até o COMMIT: nenhuma outra sessão grava
 *      batida enquanto o gatilho está desligado, nem chega a vê-lo desligado.
 *   3. As selfies desse histórico sobem pela chave de serviço (a regra do
 *      bucket limita 20 fotos por hora a quem sobe pelo app), e a mesma
 *      transação põe a data de cada uma no momento da batida: é a idade da
 *      foto que o teto por hora e por dia conta, e um mês de fotos com a data
 *      de hoje travaria a pessoa de bater por 24 horas.
 * ---------------------------------------------------------------------------
 *
 * SEM --zerar, a semente recusa um banco que já tem as contas da demonstração
 * (não dá para semear duas vezes por cima). COM --zerar, ela roda `npx
 * supabase db reset`: o banco local volta ao zero (contas, batidas, arquivos)
 * e recebe a estrutura de novo.
 *
 * NENHUMA CHAVE É IMPRESSA, nem no erro. As chaves locais vêm de `npx supabase
 * status -o env` (as mesmas de `e2e/apoio.ts`, que este arquivo repete por ser
 * JavaScript puro, sem o TypeScript dos testes).
 *
 * PRECISA de: o Supabase local de pé (`npm run db:iniciar`) e o Google Chrome,
 * que desenha as selfies e o atestado (o mesmo dos testes de ponta a ponta;
 * outro da família: PLAYWRIGHT_CHANNEL=msedge).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const FUSO = 'America/Sao_Paulo'

/* ------------------------------------------------------------------ */
/* O elenco, a empresa e o lugar                                       */
/* ------------------------------------------------------------------ */

/** Ver o cabeçalho: só para o banco local. */
const SENHA_DA_DEMONSTRACAO = 'demo-ponto-2026'
const PIN_DA_DEMONSTRACAO = '1234'

const SUPER_ADMIN = { chave: 'sergio', nome: 'Sérgio Almeida', email: 'admin@example.com' }
const RH = { chave: 'rita', nome: 'Rita Moraes', email: 'rh@example.com' }

/*
 * Quem bate ponto. `entrada` e `saida` são o costume de cada um (minutos do
 * dia); o sorteio mexe alguns minutos para cada lado, todo dia.
 */
const QUEM_BATE = [
  { chave: 'ana', nome: 'Ana Beatriz Rocha', email: 'ana@example.com', cargo: 'Vendas', matricula: '0012', admissao: '2021-02-01', entrada: 7 * 60 + 56, saida: 17 * 60 + 4 },
  { chave: 'bruna', nome: 'Bruna Costa', email: 'bruna@example.com', cargo: 'Compras', matricula: '0018', admissao: '2022-06-13', entrada: 8 * 60, saida: 17 * 60 + 25 },
  { chave: 'caio', nome: 'Caio Mendes', email: 'caio@example.com', cargo: 'Operações', matricula: '0023', admissao: '2023-08-07', entrada: 8 * 60 + 4, saida: 17 * 60 + 52 },
  { chave: 'daniela', nome: 'Daniela Freitas', email: 'daniela@example.com', cargo: 'Administrativo', matricula: '0027', admissao: '2024-01-15', entrada: 7 * 60 + 58, saida: 17 * 60 + 12 },
  { chave: 'gustavo', nome: 'Gustavo Ramos', email: 'gustavo@example.com', cargo: 'Logística', matricula: '0031', admissao: '2025-03-10', entrada: 8 * 60 + 9, saida: 18 * 60 + 3 },
]

/** A ficha de quem saiu: sem conta, desativada, com o desligamento no fim do mês anterior ao da demonstração. */
const DESLIGADA = { nome: 'Fernanda Teles', cargo: 'Vendas', matricula: '0015', admissao: '2022-04-04' }

const EMPRESA = {
  id: 1,
  razao_social: 'Empresa Exemplo Ltda',
  nome_fantasia: 'Empresa Exemplo',
  // Sem CNPJ: documento inventado pode ser o de alguém. A folha imprime o campo em branco.
  cnpj: null,
  endereco: 'Rua das Flores, 100 - Centro',
  cidade: 'Campinas',
  uf: 'SP',
  carga_diaria_minutos: 480,
  tolerancia_minutos: 10,
  janela_duplicidade_segundos: 60,
}

/** O local do elenco (centro de São Paulo) e a Av. Paulista, a 2,6 km dele. */
const LOCAL = { nome: 'Sede da Empresa Exemplo', latitude: -23.55052, longitude: -46.633308, raio_metros: 150 }
const PAULISTA = { latitude: -23.5614, longitude: -46.6559 }

/** Os feriados nacionais de data fixa (MM-DD). Os móveis (Carnaval, Paixão, Corpus Christi) não entram: é só demonstração. */
const FERIADOS = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'])

/** Abaixo disto o mês corrente é curto demais para ser "o mês" da demonstração. */
const DIAS_UTEIS_MINIMOS = 10

/* ------------------------------------------------------------------ */
/* Saída                                                               */
/* ------------------------------------------------------------------ */

function passo(texto) {
  console.log(`• ${texto}`)
}

function abortar(texto) {
  console.error(`\nDEMONSTRAÇÃO NÃO SEMEADA: ${texto}`)
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* O Supabase local: as chaves, o psql e a API                         */
/* ------------------------------------------------------------------ */

/** As chaves de `npx supabase status -o env`. A saída do comando nunca é repassada. */
function lerSupabaseLocal() {
  let saida
  try {
    saida = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    })
  } catch {
    abortar('o Supabase local não respondeu a `npx supabase status`. Ligue o Docker e suba o Supabase local com `npm run db:iniciar`.')
  }
  const valores = new Map()
  for (const linha of saida.split('\n')) {
    const achado = /^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/.exec(linha.trim())
    if (achado) valores.set(achado[1], achado[2] ?? achado[3] ?? '')
  }
  const pegar = (nome) => valores.get(nome) || abortar(`\`npx supabase status -o env\` não trouxe ${nome}. Confira se o Supabase local subiu inteiro.`)

  const urlDaApi = pegar('API_URL').replace(/\/+$/, '')
  const host = new URL(urlDaApi).hostname
  // A demonstração cria contas e batidas: só num banco de loopback, nunca num da nuvem.
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
    abortar('a API_URL do `supabase status` não é de loopback (127.0.0.1 ou localhost). A demonstração só roda no Supabase local.')
  }
  return { urlDaApi, chavePublicavel: pegar('PUBLISHABLE_KEY'), chaveDeServico: pegar('SERVICE_ROLE_KEY') }
}

/** O contêiner do banco, `supabase_db_<project_id>` (o mesmo de scripts/testar-banco.sh). */
function conteinerDoBanco() {
  const config = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8')
  const projeto = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
  if (!projeto || !/^[A-Za-z0-9_.-]+$/.test(projeto)) abortar('não achei o project_id em supabase/config.toml.')
  return `supabase_db_${projeto}`
}

/**
 * SQL como `postgres` (o papel do SQL Editor), pelo psql de dentro do
 * contêiner e pelo socket local: nenhuma senha é lida. ON_ERROR_STOP: o
 * primeiro erro para tudo, e a transação aberta volta atrás.
 */
function sqlComoPostgres(sql) {
  try {
    return execFileSync(
      'docker',
      ['exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', conteinerDoBanco(), 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
    )
  } catch (erro) {
    if (erro.code === 'ENOENT') abortar('o docker não está no PATH: o SQL roda pelo psql do contêiner do Supabase local.')
    throw new Error(`o SQL como postgres falhou: ${erro.stderr?.trim() || erro.message}`)
  }
}

/** Um literal de texto do SQL. */
const textoSql = (valor) => (valor === null || valor === undefined ? 'NULL' : `'${String(valor).replaceAll("'", "''")}'`)

let local = null

/**
 * Um pedido à API do Supabase local. `token` é a sessão de quem faz; sem ele,
 * o pedido vai só com a chave (a de serviço, quando é ela). O erro diz o
 * método, o caminho, o status e a frase de quem recusou — nunca a chave nem o
 * token.
 */
async function api(metodo, caminho, { chave = local.chavePublicavel, token, corpo, tipo, cabecalhos = {} } = {}) {
  const bruto = corpo instanceof Uint8Array
  // O portador é a sessão de quem faz; sem sessão, só a chave de serviço (que é
  // um JWT) vai como portador. A chave publicável vai só como `apikey`, como no app.
  const portador = token ?? (chave === local.chaveDeServico ? chave : null)
  const resposta = await fetch(`${local.urlDaApi}${caminho}`, {
    method: metodo,
    headers: {
      apikey: chave,
      ...(portador ? { Authorization: `Bearer ${portador}` } : {}),
      ...(corpo === undefined ? {} : { 'Content-Type': tipo ?? 'application/json' }),
      ...cabecalhos,
    },
    body: corpo === undefined ? undefined : bruto ? corpo : JSON.stringify(corpo),
  })
  const texto = await resposta.text()
  let dados = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = texto
  }
  if (!resposta.ok) {
    const frase = typeof dados === 'string' ? dados : dados?.message ?? dados?.mensagem ?? dados?.msg ?? dados?.error_description ?? dados?.error ?? ''
    throw new Error(`${metodo} ${caminho.split('?')[0]}: HTTP ${resposta.status} ${String(frase).slice(0, 300)}`)
  }
  return dados
}

/** Entra com e-mail e senha, como o app depois do "Entrar". Devolve o token de acesso. */
async function entrar(email) {
  const dados = await api('POST', '/auth/v1/token?grant_type=password', { corpo: { email, password: SENHA_DA_DEMONSTRACAO } })
  return dados.access_token
}

/** Espera a API do Supabase local responder (depois do `db reset`, os serviços levam alguns segundos). */
async function esperarAApi() {
  const prazo = Date.now() + 120_000
  let ultima = ''
  while (Date.now() < prazo) {
    try {
      await api('GET', '/auth/v1/health')
      await api('GET', '/rest/v1/ponto_local?select=id&limit=1', { chave: local.chaveDeServico })
      await api('GET', '/storage/v1/bucket/ponto-selfies', { chave: local.chaveDeServico })
      return
    } catch (erro) {
      ultima = erro.message
      await new Promise((pronto) => setTimeout(pronto, 2_000))
    }
  }
  abortar(`a API do Supabase local não respondeu em 2 minutos (${ultima}).`)
}

/* ------------------------------------------------------------------ */
/* O calendário, no fuso do ponto                                      */
/* ------------------------------------------------------------------ */

/** `AAAA-MM-DD` de um instante, no fuso do ponto. */
function diaNoPonto(instante) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante)
}

function somarDias(dia, dias) {
  const data = new Date(`${dia}T12:00:00Z`)
  data.setUTCDate(data.getUTCDate() + dias)
  return data.toISOString().slice(0, 10)
}

function ehDiaUtil(dia) {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay()
  return semana !== 0 && semana !== 6 && !FERIADOS.has(dia.slice(5))
}

function diasUteis(inicio, fim) {
  const dias = []
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) if (ehDiaUtil(dia)) dias.push(dia)
  return dias
}

function mesAnterior(mes) {
  const [ano, numero] = mes.split('-').map(Number)
  return numero === 1 ? `${ano - 1}-12` : `${ano}-${String(numero - 1).padStart(2, '0')}`
}

function ultimoDiaDoMes(mes) {
  const [ano, numero] = mes.split('-').map(Number)
  return new Date(Date.UTC(ano, numero, 0)).toISOString().slice(0, 10)
}

/**
 * O mês da demonstração e os dias com batida. Ver o cabeçalho: o corrente até
 * ontem, ou — no começo do mês — o anterior inteiro mais os dias do corrente.
 */
function calendarioDaDemonstracao(hoje) {
  const mesAtual = hoje.slice(0, 7)
  const ontem = somarDias(hoje, -1)
  const doMesAtual = ontem.startsWith(mesAtual) ? diasUteis(`${mesAtual}-01`, ontem) : []
  if (doMesAtual.length >= DIAS_UTEIS_MINIMOS) return { mes: mesAtual, diasDoMes: doMesAtual, todosOsDias: doMesAtual }
  const anterior = mesAnterior(mesAtual)
  const doAnterior = diasUteis(`${anterior}-01`, ultimoDiaDoMes(anterior))
  return { mes: anterior, diasDoMes: doAnterior, todosOsDias: [...doAnterior, ...doMesAtual] }
}

/**
 * O instante de um horário de parede no fuso do ponto. O fuso é pedido ao
 * próprio `Intl`, e não escrito como -03:00: se o horário de verão voltar, a
 * conta continua certa.
 */
function momentoNoPonto(dia, minutosDoDia, segundos = 0) {
  const [ano, mes, numero] = dia.split('-').map(Number)
  const comoUtc = Date.UTC(ano, mes - 1, numero, Math.floor(minutosDoDia / 60), minutosDoDia % 60, segundos)
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: FUSO,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(comoUtc))
      .map((parte) => [parte.type, parte.value]),
  )
  const vistoNoFuso = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second)
  return new Date(comoUtc - (vistoNoFuso - comoUtc))
}

/** `dd/mm/aaaa`, como as telas escrevem. */
const dataBrasileira = (dia) => dia.split('-').reverse().join('/')

/* ------------------------------------------------------------------ */
/* O sorteio fixo                                                      */
/* ------------------------------------------------------------------ */

/**
 * Um sorteio que sempre dá o mesmo resultado para o mesmo texto (FNV-1a para
 * a semente, mulberry32 para a sequência). Assim os horários da demonstração
 * não mudam de uma execução para outra, e os prints também não.
 */
function sorteio(texto) {
  let semente = 0x811c9dc5
  for (const caractere of texto) semente = Math.imul(semente ^ caractere.codePointAt(0), 0x01000193) >>> 0
  const proximo = () => {
    semente = (semente + 0x6d2b79f5) >>> 0
    let t = semente
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    inteiro: (de, ate) => de + Math.floor(proximo() * (ate - de + 1)),
    real: (de, ate) => de + proximo() * (ate - de),
  }
}

/* ------------------------------------------------------------------ */
/* As selfies e o atestado, desenhados pelo Chrome                     */
/* ------------------------------------------------------------------ */

/**
 * A selfie de cada pessoa como o app a guardaria: o quadrado do meio do
 * quadro (480×480, a faixa entre o alto da cabeça e os ombros do desenho),
 * em JPEG com a qualidade da captura do app (0,82). E o atestado fictício.
 */
async function desenharArquivos(rostos, atestado) {
  let navegador
  try {
    navegador = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
  } catch {
    abortar('o Google Chrome não abriu. Ele desenha as selfies e o atestado (outro da família do Chrome: PLAYWRIGHT_CHANNEL=msedge).')
  }
  try {
    const pagina = await navegador.newPage({ viewport: { width: 480, height: 640 } })
    const selfies = new Map()
    for (const rosto of rostos) {
      await pagina.goto(pathToFileURL(join(RAIZ, 'demo', 'rostos', `${rosto}.svg`)).href)
      selfies.set(rosto, await pagina.screenshot({ type: 'jpeg', quality: 82, clip: { x: 0, y: 60, width: 480, height: 480 } }))
    }
    await pagina.setViewportSize({ width: 900, height: 1200 })
    const endereco = new URL(pathToFileURL(join(RAIZ, 'demo', 'atestado.html')).href)
    endereco.searchParams.set('nome', atestado.nome)
    endereco.searchParams.set('dia', atestado.dia)
    await pagina.goto(endereco.href)
    const papel = await pagina.screenshot({ type: 'jpeg', quality: 80 })
    return { selfies, papel }
  } finally {
    await navegador.close()
  }
}

/* ------------------------------------------------------------------ */
/* O histórico                                                         */
/* ------------------------------------------------------------------ */

/** Uma coordenada a poucos metros de um ponto (até uns 50 m, com a folga padrão), e a precisão do aparelho. */
function perto(ponto, sorte, folgaGraus = 0.00035) {
  return {
    latitude: Number((ponto.latitude + sorte.real(-folgaGraus, folgaGraus)).toFixed(6)),
    longitude: Number((ponto.longitude + sorte.real(-folgaGraus, folgaGraus)).toFixed(6)),
    precisao: sorte.inteiro(5, 24),
  }
}

/**
 * As batidas do app de uma pessoa num dia: entrada, saída para o almoço, volta
 * e saída, cada uma com horário, coordenada (ou nenhuma) e o caminho da
 * selfie. `ajustes` muda o dia de quem tem um caso especial.
 */
function batidasDoDia(pessoa, usuarioId, dia, ajustes = {}) {
  const sorte = sorteio(`${pessoa.chave}|${dia}`)
  const entrada = pessoa.entrada + sorte.inteiro(-6, 6)
  const almoco = 12 * 60 + sorte.inteiro(-4, 8)
  const volta = almoco + 60 + sorte.inteiro(0, 8)
  const saida = pessoa.saida + sorte.inteiro(-8, 10)
  const horarios = { entrada, saida_almoco: almoco, volta_almoco: volta, saida, ...(ajustes.horarios ?? {}) }

  const batidas = []
  for (const tipo of ['entrada', 'saida_almoco', 'volta_almoco', 'saida']) {
    if (ajustes.sem?.includes(tipo)) continue
    const id = randomUUID()
    const onde = ajustes.semLocalizacao?.includes(tipo)
      ? null
      : ajustes.naPaulista?.includes(tipo)
        ? perto(PAULISTA, sorte, 0.00008)
        : perto(LOCAL, sorte)
    batidas.push({
      id,
      usuarioId,
      tipo,
      dia,
      momento: momentoNoPonto(dia, horarios[tipo], sorte.inteiro(0, 59)),
      onde,
      // A convenção da RPC: {conta}/{aaaa}/{mm}/{id-da-batida}.jpg, com o mês do dia da batida no fuso do ponto.
      selfie: `${usuarioId}/${dia.slice(0, 4)}/${dia.slice(5, 7)}/${id}.jpg`,
      rosto: pessoa.chave,
    })
  }
  return batidas
}

/** Sobe os arquivos com no máximo `paralelos` envios ao mesmo tempo. */
async function emLotes(itens, paralelos, fazer) {
  let proximo = 0
  const trabalhadores = Array.from({ length: Math.min(paralelos, itens.length) }, async () => {
    while (proximo < itens.length) {
      const item = itens[proximo++]
      await fazer(item)
    }
  })
  await Promise.all(trabalhadores)
}

/**
 * A carga do histórico, como o dono do banco, numa transação só. Ver
 * "POR QUE AS BATIDAS DO PASSADO ENTRAM COMO ENTRAM", no cabeçalho.
 */
function sqlDaCarga(batidas) {
  const linhas = batidas.map((batida) =>
    [
      `${textoSql(batida.id)}::uuid`,
      `${textoSql(batida.usuarioId)}::uuid`,
      `${textoSql(batida.momento.toISOString())}::timestamptz`,
      batida.onde ? batida.onde.latitude : 'NULL::double precision',
      batida.onde ? batida.onde.longitude : 'NULL::double precision',
      batida.onde ? batida.onde.precisao : 'NULL::double precision',
      textoSql(batida.selfie),
    ].join(', '),
  )

  return `
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE demo_carga (
  id uuid PRIMARY KEY, usuario_id uuid NOT NULL, registrado_em timestamptz NOT NULL,
  latitude double precision, longitude double precision, precisao_metros double precision,
  selfie_path text NOT NULL
) ON COMMIT DROP;
INSERT INTO demo_carga VALUES
(${linhas.join('),\n(')});

-- O tamanho da trilha de correções antes da carga: no fim, ele tem de ser o
-- mesmo — é o que prova que a reordenação do dia não precisou mexer em nada.
CREATE TEMP TABLE demo_trilha_antes ON COMMIT DROP AS SELECT count(*) AS n FROM public.ponto_correcoes;

-- Só o carimbo sai, e só nesta transação (o dono da tabela pode; a trava de
-- ALTER TABLE segura qualquer outra gravação de batida até o COMMIT).
ALTER TABLE public.ponto_registros DISABLE TRIGGER trg_ponto_carimbar_registro;

-- Cada coluna que o carimbo preencheria, com as funções dele.
WITH lugar AS (
  SELECT l.id, l.latitude, l.longitude, l.raio_metros
    FROM public.ponto_local l WHERE l.ativo ORDER BY l.criado_em LIMIT 1
), no_dia AS (
  SELECT c.*,
         (c.registrado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia_civil,
         row_number() OVER (PARTITION BY c.usuario_id, (c.registrado_em AT TIME ZONE 'America/Sao_Paulo')::date
                            ORDER BY c.registrado_em, c.id)::integer AS ordem
    FROM demo_carga c
), medida AS (
  SELECT d.*, lugar.id AS local_id, lugar.raio_metros,
         CASE WHEN d.latitude IS NULL THEN NULL
              ELSE round(public.ponto_distancia_metros(d.latitude, d.longitude, lugar.latitude, lugar.longitude)::numeric, 2)::double precision
         END AS distancia
    FROM no_dia d CROSS JOIN lugar
)
INSERT INTO public.ponto_registros
  (id, usuario_id, funcionario_nome, funcionario_email, registrado_em, dia_civil, tipo, ordem_no_dia,
   latitude, longitude, precisao_metros, distancia_metros, no_local, local_id, selfie_path,
   origem, ajuste_manual, motivo_ajuste, criado_por, criado_em, atualizado_em)
SELECT m.id, m.usuario_id, public.ponto_nome_da_conta(m.usuario_id), u.email::text,
       m.registrado_em, m.dia_civil,
       CASE m.ordem WHEN 1 THEN 'entrada' WHEN 2 THEN 'saida_almoco' WHEN 3 THEN 'volta_almoco'
                    WHEN 4 THEN 'saida' ELSE 'extra' END,
       m.ordem, m.latitude, m.longitude, m.precisao_metros,
       m.distancia, CASE WHEN m.distancia IS NULL THEN NULL ELSE m.distancia <= m.raio_metros END,
       CASE WHEN m.distancia IS NULL THEN NULL ELSE m.local_id END,
       m.selfie_path,
       'app', false, NULL, m.usuario_id, m.registrado_em, m.registrado_em
  FROM medida m JOIN auth.users u ON u.id = m.usuario_id
 ORDER BY m.registrado_em;

ALTER TABLE public.ponto_registros ENABLE TRIGGER trg_ponto_carimbar_registro;

-- A foto nasce com a batida: a idade dela é a do momento da batida.
UPDATE storage.objects o
   SET created_at = c.registrado_em - interval '25 seconds'
  FROM demo_carga c
 WHERE o.bucket_id = 'ponto-selfies' AND o.name = c.selfie_path;

-- A conferência: se algo não bate, a exceção desfaz a transação inteira.
DO $conferir$
DECLARE
  v_carga     integer := (SELECT count(*) FROM demo_carga);
  v_gravadas  integer;
  v_fora      integer;
  v_trilha    integer;
  v_sem_foto  integer;
  v_futuro    integer;
  v_gatilho   "char";
BEGIN
  SELECT count(*) INTO v_gravadas FROM public.ponto_registros r JOIN demo_carga c USING (id) WHERE r.origem = 'app';
  IF v_gravadas <> v_carga THEN
    RAISE EXCEPTION 'carga: % batidas preparadas e % gravadas como do app', v_carga, v_gravadas;
  END IF;

  -- A ordem do dia que o banco calcula (a mesma função da reordenação) é a gravada.
  SELECT count(*) INTO v_fora
    FROM (SELECT DISTINCT r.usuario_id, r.dia_civil FROM public.ponto_registros r JOIN demo_carga c USING (id)) d
    CROSS JOIN LATERAL public.ponto_ordem_do_dia(d.usuario_id, d.dia_civil) o
   WHERE o.muda;
  IF v_fora > 0 THEN
    RAISE EXCEPTION 'carga: % batidas com tipo ou ordem diferentes da ordem do dia do banco', v_fora;
  END IF;

  -- Nenhuma reordenação precisou corrigir nada (ela deixaria trilha).
  SELECT count(*) - (SELECT n FROM demo_trilha_antes) INTO v_trilha FROM public.ponto_correcoes;
  IF v_trilha <> 0 THEN
    RAISE EXCEPTION 'carga: a reordenação do dia mexeu em % batidas', v_trilha;
  END IF;

  SELECT count(*) INTO v_sem_foto
    FROM demo_carga c
   WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ponto-selfies' AND o.name = c.selfie_path AND o.created_at < c.registrado_em);
  IF v_sem_foto > 0 THEN
    RAISE EXCEPTION 'carga: % batidas sem a selfie no bucket (ou com a foto mais nova que a batida)', v_sem_foto;
  END IF;

  SELECT count(*) INTO v_futuro FROM demo_carga c WHERE c.registrado_em > now();
  IF v_futuro > 0 THEN
    RAISE EXCEPTION 'carga: % batidas no futuro', v_futuro;
  END IF;

  SELECT t.tgenabled INTO v_gatilho FROM pg_trigger t
   WHERE t.tgrelid = 'public.ponto_registros'::regclass AND t.tgname = 'trg_ponto_carimbar_registro';
  IF v_gatilho IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'carga: o gatilho do carimbo não voltou ligado';
  END IF;
END $conferir$;

-- O que esta carga gravou (só ela: o banco pode ter batidas de antes, de outra pessoa).
SELECT count(*) FROM public.ponto_registros r JOIN demo_carga c USING (id) WHERE r.origem = 'app';

COMMIT;
`
}

/* ------------------------------------------------------------------ */
/* A semente                                                           */
/* ------------------------------------------------------------------ */

async function semear() {
  const argumentos = process.argv.slice(2)
  if (argumentos.includes('--ajuda') || argumentos.includes('-h') || argumentos.includes('--help')) {
    console.log('Uso: npm run demo:semear [-- --zerar]\nVeja o cabeçalho de demo/semear.mjs e docs/RODAR-LOCAL.md.')
    return
  }
  // `npm run demo:semear --zerar` (sem o `--` do meio) chega como configuração do npm; vale também.
  const zerar = argumentos.includes('--zerar') || process.env.npm_config_zerar === 'true'
  const desconhecidos = argumentos.filter((argumento) => argumento !== '--zerar')
  if (desconhecidos.length > 0) abortar(`argumento desconhecido: ${desconhecidos.join(' ')}. O único é --zerar.`)

  local = lerSupabaseLocal()
  const conteiner = conteinerDoBanco()
  passo(`Supabase local: ${local.urlDaApi} (banco no contêiner ${conteiner})`)

  if (zerar) {
    console.log('\n⚠  --zerar: o banco LOCAL vai ser apagado inteiro (contas, batidas, fichas e arquivos) e recriado com a estrutura do ponto.\n')
    const reset = spawnSync('npx', ['supabase', 'db', 'reset'], { cwd: RAIZ, stdio: 'inherit' })
    if (reset.status !== 0) abortar('`npx supabase db reset` não terminou bem (veja a saída acima).')
  }

  const estrutura = sqlComoPostgres(
    "SELECT to_regclass('public.ponto_super_admins') IS NOT NULL AND to_regclass('public.ponto_registros') IS NOT NULL;",
  ).trim()
  if (estrutura !== 't') abortar('a estrutura do ponto não está no banco local. Rode com --zerar (ou `npm run db:zerar`).')
  await esperarAApi()

  const emails = [SUPER_ADMIN, RH, ...QUEM_BATE].map((pessoa) => pessoa.email)
  const jaExistem = sqlComoPostgres(
    `SELECT string_agg(email, ', ' ORDER BY email) FROM auth.users WHERE lower(email) IN (${emails.map(textoSql).join(', ')});`,
  ).trim()
  if (jaExistem) {
    abortar(`as contas da demonstração já existem neste banco (${jaExistem}). Para semear de novo, do zero: npm run demo:semear -- --zerar`)
  }
  const outras = Number(sqlComoPostgres('SELECT count(*) FROM auth.users;').trim())
  if (outras > 0) {
    console.log(`  (o banco já tem ${outras} conta(s) fora da demonstração; elas aparecem nas telas junto. Para um banco só com a demonstração: --zerar)`)
  }

  const hoje = diaNoPonto(new Date())
  const calendario = calendarioDaDemonstracao(hoje)
  const dias = calendario.diasDoMes
  passo(`Mês da demonstração: ${calendario.mes} (${dias.length} dias úteis com batida; ${calendario.todosOsDias.length} no total, até ontem)`)

  // Os dias dos casos especiais (ver o cabeçalho).
  const caso = {
    anaSemLocalizacao: dias[0],
    anaNaPaulista: dias[1],
    brunaCorrigida: dias[4],
    gustavoSemVolta: dias[5],
    caioComAtestado: dias[8],
    danielaIncompleta: dias[dias.length - 4],
    gustavoNaPaulista: dias[dias.length - 2],
  }

  passo('Desenhando as selfies e o atestado no Chrome')
  const arquivos = await desenharArquivos(
    QUEM_BATE.map((pessoa) => pessoa.chave),
    { nome: 'Caio Mendes', dia: dataBrasileira(caso.caioComAtestado) },
  )

  /* -- O super admin, como na instalação --------------------------- */
  passo(`Super admin: ${SUPER_ADMIN.nome} <${SUPER_ADMIN.email}>, criado como no "Add user" do painel e posto na lista pelo primeiro-super-admin.sql`)
  const criado = await api('POST', '/auth/v1/admin/users', {
    chave: local.chaveDeServico,
    corpo: { email: SUPER_ADMIN.email, password: SENHA_DA_DEMONSTRACAO, email_confirm: true },
  })
  const ids = new Map([[SUPER_ADMIN.chave, criado.id]])
  const modelo = readFileSync(join(RAIZ, 'supabase', 'primeiro-super-admin.sql'), 'utf8')
  if (modelo.split('voce@example.com').length !== 2) abortar('supabase/primeiro-super-admin.sql não tem o e-mail de exemplo uma vez só.')
  sqlComoPostgres(modelo.replace('voce@example.com', SUPER_ADMIN.email))

  const sessaoDoSuperAdmin = await entrar(SUPER_ADMIN.email)
  const comoSuperAdmin = { token: sessaoDoSuperAdmin }
  const contas = async (corpo) => api('POST', '/functions/v1/ponto-contas', { ...comoSuperAdmin, corpo })
  await contas({ acao: 'trocar_nome', usuario_id: ids.get(SUPER_ADMIN.chave), nome: SUPER_ADMIN.nome })
  await api('POST', '/rest/v1/rpc/ponto_definir_pin', { ...comoSuperAdmin, corpo: { p_pin: PIN_DA_DEMONSTRACAO } })

  /* -- A empresa, a jornada e o local, pelo super admin ------------- */
  passo(`Empresa, jornada e local: ${EMPRESA.razao_social}; ${LOCAL.nome}, raio de ${LOCAL.raio_metros} m`)
  await api('POST', '/rest/v1/ponto_configuracao?on_conflict=id', {
    ...comoSuperAdmin,
    corpo: EMPRESA,
    cabecalhos: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  })
  // Como a tela do local: atualiza o ativo, se houver (o banco aceita um ativo por vez), ou cria.
  const [localAtivo] = await api('GET', '/rest/v1/ponto_local?select=id&ativo=is.true&limit=1', comoSuperAdmin)
  if (localAtivo) {
    await api('PATCH', `/rest/v1/ponto_local?id=eq.${localAtivo.id}`, { ...comoSuperAdmin, corpo: LOCAL, cabecalhos: { Prefer: 'return=minimal' } })
  } else {
    await api('POST', '/rest/v1/ponto_local', { ...comoSuperAdmin, corpo: { ...LOCAL, ativo: true }, cabecalhos: { Prefer: 'return=minimal' } })
  }

  /* -- As fichas e as contas --------------------------------------- */
  passo('Fichas de RH, contas (pela função de contas, com o nome no app_metadata) e o RH administrando')
  const primeiroDia = `${calendario.mes}-01`
  for (const pessoa of QUEM_BATE) {
    const [ficha] = await api('POST', '/rest/v1/ponto_funcionarios', {
      ...comoSuperAdmin,
      corpo: {
        nome_completo: pessoa.nome,
        cargo: pessoa.cargo,
        matricula: pessoa.matricula,
        admissao: pessoa.admissao,
        bate_ponto_desde: primeiroDia,
      },
      cabecalhos: { Prefer: 'return=representation' },
    })
    // A conta nasce já ligada à ficha (o "Ficha do ponto" da caixa de criar conta).
    const resposta = await contas({
      acao: 'criar_conta',
      email: pessoa.email,
      nome: pessoa.nome,
      senha_provisoria: SENHA_DA_DEMONSTRACAO,
      ficha_id: ficha.id,
    })
    ids.set(pessoa.chave, resposta.usuario_id)
  }
  await api('POST', '/rest/v1/ponto_funcionarios', {
    ...comoSuperAdmin,
    corpo: {
      nome_completo: DESLIGADA.nome,
      cargo: DESLIGADA.cargo,
      matricula: DESLIGADA.matricula,
      admissao: DESLIGADA.admissao,
      desligamento: ultimoDiaDoMes(mesAnterior(calendario.mes)),
      ativo: false,
    },
    cabecalhos: { Prefer: 'return=minimal' },
  })
  const doRh = await contas({ acao: 'criar_conta', email: RH.email, nome: RH.nome, senha_provisoria: SENHA_DA_DEMONSTRACAO })
  ids.set(RH.chave, doRh.usuario_id)
  await api('POST', '/rest/v1/ponto_admins', {
    ...comoSuperAdmin,
    corpo: { usuario_id: ids.get(RH.chave), observacao: 'Cuida do RH e fecha a folha do mês.' },
    cabecalhos: { Prefer: 'return=minimal' },
  })

  /* -- O PIN de cada um, pela RPC de cada um ------------------------ */
  passo(`PIN de demonstração (${PIN_DA_DEMONSTRACAO}) para o RH e para quem bate`)
  const sessoes = new Map([[SUPER_ADMIN.chave, sessaoDoSuperAdmin]])
  for (const pessoa of [RH, ...QUEM_BATE]) {
    const token = await entrar(pessoa.email)
    sessoes.set(pessoa.chave, token)
    await api('POST', '/rest/v1/rpc/ponto_definir_pin', { token, corpo: { p_pin: PIN_DA_DEMONSTRACAO } })
  }

  /* -- O histórico do app ------------------------------------------ */
  const historico = []
  for (const pessoa of QUEM_BATE) {
    const usuarioId = ids.get(pessoa.chave)
    for (const dia of calendario.todosOsDias) {
      let ajustes = {}
      if (pessoa.chave === 'ana' && dia === caso.anaSemLocalizacao) ajustes = { semLocalizacao: ['volta_almoco'] }
      if (pessoa.chave === 'ana' && dia === caso.anaNaPaulista) ajustes = { naPaulista: ['entrada', 'saida_almoco'] }
      // A Bruna recebeu um fornecedor na portaria antes de bater: a entrada saiu às 8h47.
      if (pessoa.chave === 'bruna' && dia === caso.brunaCorrigida) ajustes = { horarios: { entrada: 8 * 60 + 47 } }
      if (pessoa.chave === 'gustavo' && dia === caso.gustavoSemVolta) ajustes = { sem: ['volta_almoco'] }
      if (pessoa.chave === 'gustavo' && dia === caso.gustavoNaPaulista) ajustes = { naPaulista: ['entrada', 'saida_almoco'] }
      if (pessoa.chave === 'caio' && dia === caso.caioComAtestado) continue
      if (pessoa.chave === 'daniela' && dia === caso.danielaIncompleta) ajustes = { sem: ['saida'] }
      historico.push(...batidasDoDia(pessoa, usuarioId, dia, ajustes))
    }
  }

  passo(`Subindo ${historico.length} selfies ao bucket ponto-selfies (pela chave de serviço)`)
  await emLotes(historico, 8, async (batida) => {
    await api('POST', `/storage/v1/object/ponto-selfies/${batida.selfie}`, {
      chave: local.chaveDeServico,
      corpo: arquivos.selfies.get(batida.rosto),
      tipo: 'image/jpeg',
    })
  })

  passo(`Gravando ${historico.length} batidas do app como o dono do banco (o carimbo desligado só nesta transação; ver o cabeçalho)`)
  const gravadas = sqlComoPostgres(sqlDaCarga(historico)).trim()
  if (Number(gravadas) !== historico.length) abortar(`a carga gravou ${gravadas} batidas, e eram ${historico.length}.`)

  /* -- O que o RH fez no mês, pela sessão do RH --------------------- */
  const comoRh = { token: sessoes.get(RH.chave) }

  const entradaDaBruna = historico.find((batida) => batida.rosto === 'bruna' && batida.dia === caso.brunaCorrigida && batida.tipo === 'entrada')
  passo(`RH corrige a entrada da Bruna em ${dataBrasileira(caso.brunaCorrigida)}: 08:47 → 08:00, com motivo`)
  await api('PATCH', `/rest/v1/ponto_registros?id=eq.${entradaDaBruna.id}`, {
    ...comoRh,
    corpo: {
      registrado_em: momentoNoPonto(caso.brunaCorrigida, 8 * 60).toISOString(),
      motivo_ajuste: 'Chegou às 8h e foi direto receber um fornecedor na portaria; bateu só às 8h47. Horário confirmado com a supervisora.',
    },
    cabecalhos: { Prefer: 'return=minimal' },
  })

  const almocoDoGustavo = historico.find((batida) => batida.rosto === 'gustavo' && batida.dia === caso.gustavoSemVolta && batida.tipo === 'saida_almoco')
  const voltaInserida = new Date(almocoDoGustavo.momento.getTime() + 62 * 60_000)
  voltaInserida.setUTCSeconds(0, 0)
  passo(`RH insere a volta do almoço que o Gustavo esqueceu em ${dataBrasileira(caso.gustavoSemVolta)}, com motivo`)
  await api('POST', '/rest/v1/ponto_registros', {
    ...comoRh,
    corpo: {
      usuario_id: ids.get('gustavo'),
      registrado_em: voltaInserida.toISOString(),
      motivo_ajuste: 'Esqueceu de bater a volta do almoço; avisou a supervisora no mesmo dia.',
    },
    cabecalhos: { Prefer: 'return=minimal' },
  })

  passo(`RH lança a falta do Caio em ${dataBrasileira(caso.caioComAtestado)}, atestado médico com a foto do papel fictício`)
  const ausenciaId = randomUUID()
  const caminhoDoAtestado = `${ids.get('caio')}/${ausenciaId}.jpg`
  await api('POST', `/storage/v1/object/ponto-atestados/${caminhoDoAtestado}`, { ...comoRh, corpo: arquivos.papel, tipo: 'image/jpeg' })
  await api('POST', '/rest/v1/ponto_ausencias', {
    ...comoRh,
    corpo: {
      id: ausenciaId,
      usuario_id: ids.get('caio'),
      dia_inicio: caso.caioComAtestado,
      dia_fim: caso.caioComAtestado,
      tipo: 'atestado_medico',
      observacao: 'Consulta médica; atestado de um dia.',
      atestado_path: caminhoDoAtestado,
    },
    cabecalhos: { Prefer: 'return=minimal' },
  })

  /* -- O pedido de hoje, pela RPC do Caio, com selfie e PIN --------- */
  // "Só hoje, antes de agora": nos primeiros minutos do dia, espera um pouco.
  const inicioDeHoje = momentoNoPonto(hoje, 0)
  const espera = inicioDeHoje.getTime() + 4 * 60_000 - Date.now()
  if (espera > 0) {
    console.log(`  (começo do dia: o pedido de batida esquecida só vale para hoje, antes de agora; esperando ${Math.ceil(espera / 1000)} s)`)
    await new Promise((pronto) => setTimeout(pronto, espera))
  }
  const declarado = new Date(Math.max(Date.now() - 20 * 60_000, inicioDeHoje.getTime() + 60_000))
  declarado.setUTCSeconds(0, 0)
  const horaDeclarada = Number(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hour: '2-digit', hourCycle: 'h23' }).format(declarado))
  const pedidoId = randomUUID()
  const caminhoDoPedido = `${ids.get('caio')}/${hoje.slice(0, 4)}/${hoje.slice(5, 7)}/${pedidoId}.jpg`
  const comoCaio = { token: sessoes.get('caio') }
  passo('Caio pede uma batida esquecida de hoje (selfie, localização e PIN), que fica esperando decisão')
  await api('POST', `/storage/v1/object/ponto-selfies/${caminhoDoPedido}`, { ...comoCaio, corpo: arquivos.selfies.get('caio'), tipo: 'image/jpeg' })
  const ondeOCaioPede = perto(LOCAL, sorteio(`caio|pedido|${hoje}`))
  const pedido = await api('POST', '/rest/v1/rpc/ponto_pedir_batida_em_atraso', {
    ...comoCaio,
    corpo: {
      p_pin: PIN_DA_DEMONSTRACAO,
      p_pedido_id: pedidoId,
      p_selfie_path: caminhoDoPedido,
      p_latitude: ondeOCaioPede.latitude,
      p_longitude: ondeOCaioPede.longitude,
      p_precisao_metros: ondeOCaioPede.precisao,
      p_horario_declarado: declarado.toISOString(),
      // O motivo combina com a hora em que a semente roda.
      p_motivo:
        horaDeclarada >= 7 && horaDeclarada < 19
          ? 'Cheguei e fui direto conferir a mercadoria que chegou; esqueci de bater a entrada.'
          : 'Vim fazer o inventário do estoque fora do horário e esqueci de bater a entrada.',
    },
  })
  if (!pedido?.gravado) abortar(`o pedido de batida esquecida do Caio não gravou (${JSON.stringify(pedido)}).`)

  /* -- O resumo (só das contas da demonstração) --------------------- */
  const daDemonstracao = `(${[...ids.values()].map((id) => `${textoSql(id)}::uuid`).join(', ')})`
  const [app, doRhNoPonto, correcoes, ausencias, pendentes, selfies] = sqlComoPostgres(`
    SELECT (SELECT count(*) FROM public.ponto_registros WHERE origem = 'app' AND usuario_id IN ${daDemonstracao}),
           (SELECT count(*) FROM public.ponto_registros WHERE origem = 'ajuste_admin' AND usuario_id IN ${daDemonstracao}),
           (SELECT count(*) FROM public.ponto_correcoes WHERE usuario_id IN ${daDemonstracao}),
           (SELECT count(*) FROM public.ponto_ausencias WHERE usuario_id IN ${daDemonstracao}),
           (SELECT count(*) FROM public.ponto_pedidos_atraso WHERE estado = 'pendente' AND usuario_id IN ${daDemonstracao}),
           (SELECT count(*) FROM storage.objects WHERE bucket_id = 'ponto-selfies'
              AND split_part(name, '/', 1) IN (${[...ids.values()].map(textoSql).join(', ')}));
  `)
    .trim()
    .split('|')

  console.log(`
Demonstração semeada no Supabase local.
  ${app} batidas do app e ${doRhNoPonto} lançada pelo RH; ${correcoes} linhas na trilha de correções
  (a correção da Bruna e a reorganização do dia do Gustavo); ${ausencias} falta com atestado;
  ${pendentes} pedido de batida esquecida esperando decisão; ${selfies} selfies no bucket.

Contas (senha ${SENHA_DA_DEMONSTRACAO}, PIN ${PIN_DA_DEMONSTRACAO} — só deste banco local):
  ${SUPER_ADMIN.email.padEnd(22)} ${SUPER_ADMIN.nome}, super admin
  ${RH.email.padEnd(22)} ${RH.nome}, RH (administra, não bate)
${QUEM_BATE.map((pessoa) => `  ${pessoa.email.padEnd(22)} ${pessoa.nome}, ${pessoa.cargo}`).join('\n')}

Para os prints: npm run demo:prints`)
}

semear().catch((erro) => abortar(erro instanceof Error ? erro.message : String(erro)))
