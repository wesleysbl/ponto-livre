// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fluxoDoCi from '../.github/workflows/conferir.yml?raw'
import pacoteCru from '../package.json?raw'
// As fontes da sessão e da guarda, para o bloco que confere por onde elas falam com o banco.
import fonteDoProvedor from './contexts/AuthContext.tsx?raw'
import fonteDoContrato from './contexts/autenticacao.ts?raw'
import fonteDoAcesso from './lib/acesso.ts?raw'
import fonteDaGuarda from './components/RotaProtegida.tsx?raw'
import fonteDasRotas from './App.tsx?raw'

/*
 * TODO o código do app (sem os testes), para a lista permitida: cada tabela,
 * RPC, bucket e função que o app nomeia é do ponto.
 */
const FONTES_DO_APP = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.ts', '!./**/*.test.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ),
)

/*
 * A LISTA PERMITIDA SAI DO SQL DO PONTO: as tabelas, as funções e os buckets
 * que as migrations criam. Toda leitura da fumaça e todo nome no código do app
 * têm de estar nela.
 */
const SQL_DO_PONTO = Object.values(
  import.meta.glob<string>('../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }),
).join('\n')
const criadosPeloSql = (padrao: RegExp, sql = SQL_DO_PONTO) =>
  new Set([...sql.matchAll(padrao)].map((casamento) => casamento[1]))
const TABELAS_DO_PONTO = criadosPeloSql(/^CREATE TABLE public\.(ponto_\w+)/gm)
const FUNCOES_DO_PONTO = criadosPeloSql(/^CREATE FUNCTION public\.(ponto_\w+)\(/gm)
const BUCKETS_DO_PONTO = criadosPeloSql(/\('([\w-]+)',/g, /INSERT INTO storage\.buckets\b[^;]*;/.exec(SQL_DO_PONTO)?.[0] ?? '')

/*
 * TESTE DE FUMAÇA DAS ROTAS.
 *
 * O QUE ELE PROVA QUE OS OUTROS TESTES DE TELA NÃO PROVAM
 * `telas-de-*.test.ts` desenham cada componente com `renderToString`, em Node:
 * é rápido, mas NÃO RODA EFEITO NENHUM. Nenhuma leitura acontece, nenhum
 * `setState` depois da resposta, nenhum redirecionamento da guarda. É
 * justamente aí que mora o erro que só aparece "ao abrir a tela": a lista sem
 * `key` que só tem itens depois da leitura, o `undefined.map` de uma resposta
 * vazia, o efeito que entra em laço, a guarda que manda para a rota errada.
 *
 * Aqui o APP INTEIRO (`App.tsx`, com o `AuthProvider` de verdade e o
 * `BrowserRouter`) monta num DOM simulado (jsdom), com o Supabase SIMULADO no
 * lugar do cliente. Cada rota de admin e de colaborador é aberta, os efeitos
 * rodam até assentar, e o teste reprova com:
 *   • qualquer `console.error` ou `console.warn` (React, jsdom ou do app);
 *   • qualquer frase de falha de leitura na tela ("Não deu para…");
 *   • qualquer gravação (abrir uma tela não grava nada) — menos no caso que
 *     liga `aceitarEscritas` para gravar de propósito (inserir uma batida e
 *     ler o recado);
 *   • qualquer RPC que o simulado não conhece (RPC nova sem fumaça);
 *   • qualquer tabela, RPC ou bucket fora da lista permitida, a do SQL do
 *     ponto (ver `TABELAS_DO_PONTO` e as irmãs, acima).
 * Roda duas vezes: com o banco vazio e com um banco pequeno, com uma pessoa,
 * uma batida, um pedido de atraso pendente e uma ausência.
 *
 * SEM REDE, SEM BANCO. O simulado ignora quase todos os filtros (aplica só
 * `eq` e `in`, para o colaborador ler as próprias batidas) — não é para provar
 * a consulta, que tem teste de contrato em `lib/*.test.ts`, e sim para a tela
 * receber linhas com o formato das colunas que ela pede.
 *
 * O ACESSO É O DO BANCO DO PONTO: o simulado de `ponto_meu_acesso()` responde
 * no formato do contrato — origem 'ficha' ou 'administracao', `bate_ponto`,
 * `nome` e `cargo` —, com o nome e o cargo tirados da ficha ligada à conta da
 * sessão, como o banco faz. A rota sai só dessa resposta e da do PIN: um bloco
 * abaixo prova isso com toda leitura de tabela recusando.
 *
 * AS CONTAS SÃO AS DO BANCO DO PONTO: as listas leem `ponto_contas()`, que só
 * responde a quem administra — para o colaborador, o simulado recusa como o
 * banco.
 *
 * NO CI: roda dentro do `npm test` e também num passo próprio do
 * `.github/workflows/conferir.yml` (`npm run test:fumaca`), para a falha
 * aparecer com nome no resumo do workflow. O último bloco deste arquivo
 * reprova se o passo ou o script sumirem.
 */

type Linha = Record<string, unknown>

const FONTES_DA_SESSAO: Record<string, string> = {
  'contexts/AuthContext.tsx': fonteDoProvedor,
  'contexts/autenticacao.ts': fonteDoContrato,
  'lib/acesso.ts': fonteDoAcesso,
  'components/RotaProtegida.tsx': fonteDaGuarda,
  'App.tsx': fonteDasRotas,
}

interface Sessao {
  user: { id: string; email: string }
}

const simulado = vi.hoisted(() => {
  const estado = {
    sessao: null as Sessao | null,
    tabelas: {} as Record<string, Record<string, unknown>[]>,
    /** A resposta de cada RPC — ou uma função que a monta na hora da chamada. */
    rpcs: {} as Record<string, unknown>,
    escritas: [] as string[],
    desconhecidas: [] as string[],
    /** Toda RPC que o app chamou, na ordem. */
    chamadas: [] as string[],
    /**
     * Os argumentos de cada chamada de RPC, na ordem (a fumaça confere o que a
     * batida sem localização manda ao banco).
     */
    argumentos: [] as { nome: string; args: Record<string, unknown> }[],
    /** Tabelas cuja leitura responde com erro (para provar a tela de falha); `'*'` recusa todas. */
    falham: [] as string[],
    /** Toda tabela que o app abriu com `from()`, na ordem. */
    lidas: [] as string[],
    /** Todo bucket que o app abriu no storage, na ordem. */
    buckets: [] as string[],
    /** A conta que o login simulado aceita, com qualquer senha. Nula: o login recusa. */
    loginAceito: null as Sessao | null,
    /** O assinante de `onAuthStateChange`, para o login simulado avisar a sessão nova. */
    aoMudarSessao: null as ((evento: string, sessao: Sessao | null) => void) | null,
    /**
     * Liga, POR CASO, a gravação de verdade no simulado. Desligado (o padrão),
     * toda escrita vai para `escritas` e reprova a fumaça. Ligado, ela vai para
     * `aceitas`, e o insert em `ponto_registros` acrescenta a linha (com
     * `dia_civil` e a reordenação do dia, como o banco) e é ela que volta do
     * `.select().single()`.
     */
    aceitarEscritas: false,
    aceitas: [] as string[],
    /**
     * Enquanto não for nula, as leituras de lista esperam esta promessa — para
     * o teste afirmar o que está na tela DURANTE a releitura, que com tudo
     * respondendo na hora caberia numa microtarefa.
     */
    segurarLeituras: null as Promise<void> | null,
  }

  /** O dia civil em America/Sao_Paulo, como o gatilho do banco carimba. */
  function diaCivilDe(instante: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(instante))
  }

  /**
   * O insert do admin em `ponto_registros`, como o banco o faz: o gatilho
   * carimba dia, origem e marca de ajuste; a reordenação do dia dá tipo e
   * ordem pelo relógio a todas as batidas do dia (linhas NOVAS, sem mexer nos
   * objetos que a tela já recebeu).
   */
  function inserirBatida(dados: Record<string, unknown>): Record<string, unknown> {
    const registradoEm = String(dados.registrado_em)
    const nova: Record<string, unknown> = {
      id: `inserida-${estado.aceitas.length}`,
      usuario_id: dados.usuario_id,
      registrado_em: registradoEm,
      dia_civil: diaCivilDe(registradoEm),
      tipo: 'extra',
      ordem_no_dia: 99,
      latitude: null,
      longitude: null,
      precisao_metros: null,
      distancia_metros: null,
      no_local: null,
      selfie_path: null,
      ajuste_manual: true,
      origem: 'ajuste_admin',
      motivo_ajuste: dados.motivo_ajuste ?? null,
      funcionario_nome: null,
      funcionario_email: null,
      pedido_atraso_id: null,
    }
    const tabela = [...(estado.tabelas.ponto_registros ?? []), nova]
    const doDia = tabela
      .filter((linha) => linha.usuario_id === nova.usuario_id && linha.dia_civil === nova.dia_civil)
      .sort((a, b) => new Date(String(a.registrado_em)).getTime() - new Date(String(b.registrado_em)).getTime())
    const sequencia = ['entrada', 'saida_almoco', 'volta_almoco', 'saida']
    const reordenadas = new Map(
      doDia.map((linha, indice) => [linha, { ...linha, ordem_no_dia: indice + 1, tipo: sequencia[indice] ?? 'extra' }]),
    )
    estado.tabelas.ponto_registros = tabela.map((linha) => reordenadas.get(linha) ?? linha)
    return reordenadas.get(nova) ?? nova
  }

  type Filtro = (linha: Record<string, unknown>) => boolean
  type Resposta = { data: unknown; error: { message: string } | null; count?: number }

  function consulta(tabela: string): unknown {
    const filtros: Filtro[] = []
    const linhas = () => (estado.tabelas[tabela] ?? []).filter((linha) => filtros.every((f) => f(linha)))
    const responder = (resposta: Resposta) =>
      Promise.resolve(
        estado.falham.includes(tabela) || estado.falham.includes('*')
          ? { data: null, error: { message: `leitura de ${tabela} recusada no simulado` } }
          : resposta,
      )

    const construtor: object = new Proxy(
      {},
      {
        get(_alvo, nome) {
          if (nome === 'then') {
            return (ok: (r: Resposta) => unknown, falha: (e: unknown) => unknown) => {
              const ler = () => responder({ data: linhas(), error: null, count: linhas().length })
              const segurar = estado.segurarLeituras
              return (segurar ? segurar.then(ler) : ler()).then(ok, falha)
            }
          }
          if (nome === 'maybeSingle') return () => responder({ data: linhas()[0] ?? null, error: null })
          if (nome === 'single') {
            return () =>
              responder(
                linhas()[0]
                  ? { data: linhas()[0], error: null }
                  : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } },
              )
          }
          if (nome === 'insert' || nome === 'update' || nome === 'upsert' || nome === 'delete') {
            return (dados?: unknown) => {
              if (!estado.aceitarEscritas) {
                estado.escritas.push(`${String(nome)} em ${tabela}`)
                return construtor
              }
              estado.aceitas.push(`${String(nome)} em ${tabela}`)
              if (nome === 'insert' && tabela === 'ponto_registros') {
                const inserida = inserirBatida(dados as Record<string, unknown>)
                filtros.push((linha) => linha === inserida)
              }
              return construtor
            }
          }
          if (nome === 'eq') {
            return (coluna: string, valor: unknown) => {
              filtros.push((linha) => linha[coluna] === valor)
              return construtor
            }
          }
          if (nome === 'in') {
            return (coluna: string, valores: unknown[]) => {
              filtros.push((linha) => valores.includes(linha[coluna]))
              return construtor
            }
          }
          // select, gte, lte, neq, not, or, order, range, limit…: devolvem a si mesmos.
          return () => construtor
        },
      },
    )
    return construtor
  }

  const cliente = {
    from: (tabela: string) => {
      estado.lidas.push(tabela)
      return consulta(tabela)
    },
    rpc: (nome: string, args: Record<string, unknown> = {}) => {
      estado.chamadas.push(nome)
      estado.argumentos.push({ nome, args })
      if (!(nome in estado.rpcs)) {
        estado.desconhecidas.push(nome)
        return Promise.resolve({ data: null, error: { message: `RPC ${nome} não simulada` } })
      }
      const resposta = estado.rpcs[nome]
      // A função que levanta é a RPC que o banco RECUSA (ex.: `ponto_contas()`
      // para quem não administra): volta como erro, com a frase do banco.
      try {
        return Promise.resolve({
          data:
            typeof resposta === 'function' ? (resposta as (args: Record<string, unknown>) => unknown)(args) : resposta,
          error: null,
        })
      } catch (falha) {
        return Promise.resolve({ data: null, error: { message: falha instanceof Error ? falha.message : String(falha) } })
      }
    },
    storage: {
      from: (bucket: string) => {
        estado.buckets.push(bucket)
        return {
          createSignedUrl: () =>
            Promise.resolve({ data: { signedUrl: `https://simulado.invalid/${bucket}` }, error: null }),
          // As miniaturas do painel: o jsdom não tem IntersectionObserver, então o dia assina na hora.
          createSignedUrls: (caminhos: string[]) =>
            Promise.resolve({
              data: caminhos.map((caminho) => ({
                path: caminho,
                error: null,
                signedUrl: `https://simulado.invalid/${bucket}/${caminho}`,
              })),
              error: null,
            }),
          upload: (caminho: string) => {
            // Com `aceitarEscritas` (a batida que grava de propósito), a foto sobe.
            if (estado.aceitarEscritas) {
              estado.aceitas.push(`upload em ${bucket}`)
              return Promise.resolve({ data: { path: caminho }, error: null })
            }
            estado.escritas.push(`upload em ${bucket}`)
            return Promise.resolve({ data: null, error: { message: 'simulado' } })
          },
          remove: () => {
            estado.escritas.push(`remove em ${bucket}`)
            return Promise.resolve({ data: null, error: { message: 'simulado' } })
          },
        }
      },
    },
    functions: {
      invoke: (nome: string) => {
        estado.escritas.push(`função ${nome}`)
        return Promise.resolve({ data: null, error: { message: 'simulado' } })
      },
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: estado.sessao } }),
      onAuthStateChange: (aoMudar: (evento: string, sessao: Sessao | null) => void) => {
        estado.aoMudarSessao = aoMudar
        // Como o GoTrue: o INITIAL_SESSION chega depois, fora do registro.
        const relogio = setTimeout(() => aoMudar('INITIAL_SESSION', estado.sessao), 0)
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                clearTimeout(relogio)
                if (estado.aoMudarSessao === aoMudar) estado.aoMudarSessao = null
              },
            },
          },
        }
      },
      signInWithPassword: () => {
        const conta = estado.loginAceito
        if (!conta) return Promise.resolve({ error: { message: 'Invalid login credentials' } })
        estado.sessao = conta
        // Como o GoTrue: o SIGNED_IN chega pelo assinante, fora da chamada.
        setTimeout(() => estado.aoMudarSessao?.('SIGNED_IN', conta), 0)
        return Promise.resolve({ error: null })
      },
      signOut: () => Promise.resolve({ error: null }),
    },
  }

  return { estado, cliente }
})

vi.mock('./lib/supabase', () => ({ supabase: simulado.cliente }))

/*
 * A CÂMERA É UM DUPLÊ, como o GPS dos testes de localização: o jsdom não tem
 * `getUserMedia` nem `canvas`, e o que se prova aqui é o caminho DEPOIS da
 * foto — a falha de localização que guarda a selfie e o "tentar de novo" que
 * vai direto ao PIN. `aberturas` conta quantas vezes a câmera abriu. Nenhum
 * outro caso desta fumaça chega à câmera.
 */
const camera = vi.hoisted(() => ({ aberturas: 0 }))
vi.mock('./components/CapturaDeSelfie', async () => {
  const { createElement: elemento, useEffect } = await import('react')
  return {
    CapturaDeSelfie({ aoCapturar, aoCancelar }: { aoCapturar: (foto: Blob) => void; aoCancelar: () => void }) {
      useEffect(() => {
        camera.aberturas++
      }, [])
      return elemento(
        'div',
        null,
        elemento(
          'button',
          { type: 'button', onClick: () => aoCapturar(new Blob(['selfie'], { type: 'image/jpeg' })) },
          'Usar a foto do duplê',
        ),
        elemento('button', { type: 'button', onClick: aoCancelar }, 'Fechar a câmera'),
      )
    },
  }
})

const { default: App } = await import('./App')
const { Modal } = await import('./components/ui')
const { diaCivilDeHoje } = await import('./lib/formato')
const { somarDias } = await import('./lib/ausencias')

/* ------------------------------------------------------------------ */
/* O banco simulado                                                    */
/* ------------------------------------------------------------------ */

const ADMIN = { id: 'u-admin', email: 'admin2@example.com' }
const ANA = { id: 'u-ana', email: 'ana.souza@example.com' }
/** A Rita, do RH: administra o ponto e não tem ficha — entra e não bate. */
const RITA = { id: 'u-rita', email: 'rh@example.com' }
/** A Fernanda: a ficha está ligada à conta, mas desligada — não entra. */
const FERNANDA = { id: 'u-fernanda', email: 'fernanda@example.com' }

/**
 * O nome guardado na conta (`raw_app_meta_data->>'full_name'`), que o
 * banco do ponto usa quando a conta não tem ficha. A Fernanda não tem: o nome
 * dela vem da ficha.
 */
const NOME_GUARDADO_NA_CONTA: Record<string, string> = {
  [ADMIN.id]: 'Sérgio Almeida',
  [ANA.id]: 'Ana Souza',
  [RITA.id]: 'Rita',
}

const hoje = diaCivilDeHoje()
const mes = hoje.slice(0, 7)
const agora = new Date().toISOString()

/**
 * Uma linha de `ponto_contas()`: id, e-mail, o nome guardado na conta,
 * criação e último login. O simulado guarda as contas na "tabela"
 * `contas_do_ponto`, que o app nunca abre com `from()` — só a RPC as lê.
 */
function conta(usuario: { id: string; email: string }, nome: string | null): Linha {
  return { usuario_id: usuario.id, email: usuario.email, nome, criado_em: '2026-09-01T12:00:00Z', ultimo_login: null }
}

const CONTAS = [conta(ADMIN, 'Sérgio Almeida'), conta(ANA, 'Ana Souza'), conta(RITA, 'Rita')]

/*
 * Uma conta do ponto ainda sem ficha nem administração: o Bruno, cuja ficha
 * existe sem conta (Bruno Lima). A lista mostra a conta com "sem acesso ao
 * ponto", e a sugestão de vínculo da ficha tem de achá-la.
 */
const BRUNO = { id: 'u-bruno', email: 'bruno.lima@example.com' }

const LOCAL_DE_TRABALHO = { latitude: -23.550520, longitude: -46.633308 }

/** Um banco pequeno: as linhas com as colunas que cada leitura pede. */
function bancoComDados(): Record<string, Linha[]> {
  return {
    contas_do_ponto: [...CONTAS, conta(BRUNO, 'Bruno Lima')],
    ponto_registros: [
      {
        id: 'r1',
        usuario_id: ANA.id,
        registrado_em: agora,
        dia_civil: hoje,
        tipo: 'entrada',
        ordem_no_dia: 1,
        ...LOCAL_DE_TRABALHO,
        precisao_metros: 12,
        distancia_metros: 3,
        no_local: true,
        selfie_path: `${ANA.id}/${mes.replace('-', '/')}/r1.jpg`,
        ajuste_manual: false,
        origem: 'app',
        motivo_ajuste: null,
        funcionario_nome: 'Ana Souza',
        funcionario_email: ANA.email,
        pedido_atraso_id: null,
      },
    ],
    ponto_pedidos_atraso: [
      {
        id: 'pa1',
        usuario_id: ANA.id,
        horario_declarado: agora,
        dia_civil: hoje,
        motivo: 'Cheguei e esqueci de bater o ponto.',
        pedido_em: agora,
        selfie_path: `${ANA.id}/${mes.replace('-', '/')}/pa1.jpg`,
        ...LOCAL_DE_TRABALHO,
        precisao_metros: 10,
        distancia_metros: 5,
        no_local: true,
        estado: 'pendente',
        decidido_por: null,
        decidido_em: null,
        motivo_decisao: null,
        registro_id: null,
        funcionario_nome: 'Ana Souza',
        funcionario_email: ANA.email,
      },
    ],
    ponto_ausencias: [
      {
        id: 'au1',
        usuario_id: ANA.id,
        dia_inicio: `${mes}-01`,
        dia_fim: `${mes}-01`,
        tipo: 'atestado_medico',
        observacao: null,
        atestado_path: `${ANA.id}/au1.pdf`,
        lancado_por: ADMIN.id,
        lancado_em: agora,
        cancelada_em: null,
        cancelada_por: null,
        motivo_cancelamento: null,
      },
    ],
    ponto_funcionarios: [
      {
        id: 'f1',
        usuario_id: ANA.id,
        nome_completo: 'Ana Souza',
        cpf: null,
        matricula: '7',
        cargo: 'Analista',
        admissao: '2026-01-05',
        desligamento: null,
        ctps: null,
        ctps_serie: null,
        centro_custo: null,
        ativo: true,
        bate_ponto_desde: '2026-09-04',
        atualizado_em: agora,
      },
      {
        id: 'f2',
        usuario_id: null,
        nome_completo: 'Bruno Lima',
        cpf: null,
        matricula: null,
        cargo: null,
        admissao: null,
        desligamento: null,
        ctps: null,
        ctps_serie: null,
        centro_custo: null,
        ativo: true,
        bate_ponto_desde: null,
        atualizado_em: agora,
      },
    ],
    ponto_admins: [
      { usuario_id: ADMIN.id, concedido_por: null, concedido_em: agora, observacao: null },
      { usuario_id: RITA.id, concedido_por: ADMIN.id, concedido_em: agora, observacao: 'RH' },
    ],
    ponto_super_admins: [{ usuario_id: ADMIN.id }],
    ponto_local: [
      {
        id: 'l1',
        nome: 'Empresa Exemplo Ltda',
        ...LOCAL_DE_TRABALHO,
        raio_metros: 150,
        ativo: true,
        medido_em: '2026-10-15T12:00:00.000000+00:00',
        medido_por: null,
      },
    ],
    ponto_configuracao: [
      {
        id: 1,
        razao_social: 'Empresa Exemplo Ltda',
        nome_fantasia: 'Empresa Exemplo',
        cnpj: null,
        endereco: 'Rua Exemplo, 100',
        cidade: 'Campinas',
        uf: 'SP',
        carga_diaria_minutos: 480,
        tolerancia_minutos: 10,
        janela_duplicidade_segundos: 60,
        atualizado_em: agora,
      },
    ],
    ponto_correcoes: [],
  }
}

/**
 * Nenhuma batida, ficha, local nem configuração. Só as contas, que existem no
 * login mesmo com o banco do ponto vazio (`ponto_contas()`).
 */
function bancoVazio(): Record<string, Linha[]> {
  return { contas_do_ponto: CONTAS }
}

/**
 * As contas da fumaça, pelos degraus do banco do ponto (tabela de decisões):
 *   admin            o Sérgio, super admin SEM ficha: entra e bate (para teste)
 *   admin-sem-ficha  a Rita, administra SEM ficha: entra e NÃO bate
 *   colaborador      a Ana, ficha que libera: entra e bate
 *   sem-acesso       a Fernanda, sem ficha que libere: não entra
 */
type Conta = 'admin' | 'admin-sem-ficha' | 'colaborador' | 'sem-acesso'

const USUARIO_DA_CONTA: Record<Conta, { id: string; email: string }> = {
  admin: ADMIN,
  'admin-sem-ficha': RITA,
  colaborador: ANA,
  'sem-acesso': FERNANDA,
}

/**
 * `ponto_meu_acesso()` como o banco do ponto a responde (o contrato de
 * acesso): os degraus saem do tipo de conta; o nome e o cargo, da ficha ligada
 * à conta da SESSÃO — depois do nome guardado na conta, depois do e-mail. É
 * uma função, montada na hora da chamada, porque alguns testes trocam a conta
 * da sessão depois de `entrarComo`.
 */
function acessoDe(conta: Conta) {
  return () => {
    const usuario = simulado.estado.sessao?.user
    if (!usuario) return null
    const ficha = (simulado.estado.tabelas.ponto_funcionarios ?? []).find(
      (linha) => linha.usuario_id === usuario.id,
    )
    return {
      tem_acesso: conta !== 'sem-acesso',
      origem: conta === 'colaborador' ? 'ficha' : conta === 'sem-acesso' ? null : 'administracao',
      administra: conta === 'admin' || conta === 'admin-sem-ficha',
      super_admin: conta === 'admin',
      bate_ponto: conta === 'admin' || conta === 'colaborador',
      nome: (ficha?.nome_completo as string | undefined) ?? NOME_GUARDADO_NA_CONTA[usuario.id] ?? usuario.email,
      cargo: (ficha?.cargo as string | null | undefined) ?? null,
    }
  }
}

function entrarComo(
  conta: Conta | null,
  tabelas: Record<string, Linha[]>,
  pin: { definido: boolean; precisa_redefinir: boolean } = { definido: true, precisa_redefinir: false },
) {
  simulado.estado.sessao = conta === null ? null : { user: USUARIO_DA_CONTA[conta] }
  simulado.estado.tabelas = tabelas
  simulado.estado.rpcs = {
    ponto_meu_acesso: conta === null ? null : acessoDe(conta),
    ponto_pin_status: { ...pin, bloqueado_ate: null },
    ponto_estado_do_pin: [
      { usuario_id: ADMIN.id, tem_pin: true, precisa_redefinir: false, bloqueado_ate: null },
      { usuario_id: ANA.id, tem_pin: true, precisa_redefinir: false, bloqueado_ate: null },
    ],
    // Como o banco do ponto: só quem administra recebe a lista de contas.
    ponto_contas: () => {
      if (conta !== 'admin' && conta !== 'admin-sem-ficha') {
        throw new Error('Lista de contas e exclusiva de quem administra o ponto')
      }
      return simulado.estado.tabelas.contas_do_ponto ?? []
    },
  }
}

/* ------------------------------------------------------------------ */
/* Abrir uma rota                                                      */
/* ------------------------------------------------------------------ */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let console_: unknown[][] = []
let montadas: { root: Root; raiz: HTMLElement }[] = []

beforeEach(() => {
  console_ = []
  simulado.estado.escritas = []
  simulado.estado.desconhecidas = []
  simulado.estado.chamadas = []
  simulado.estado.argumentos = []
  simulado.estado.falham = []
  simulado.estado.lidas = []
  simulado.estado.buckets = []
  simulado.estado.loginAceito = null
  simulado.estado.aceitarEscritas = false
  simulado.estado.aceitas = []
  simulado.estado.segurarLeituras = null
  for (const nivel of ['error', 'warn'] as const) {
    vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
      console_.push([nivel, ...args])
    })
  }
})

afterEach(() => {
  for (const { root, raiz } of montadas) {
    act(() => root.unmount())
    raiz.remove()
  }
  montadas = []
  vi.restoreAllMocks()
})

/** Deixa os efeitos, as leituras simuladas e os redirecionamentos assentarem. */
async function assentar() {
  for (let volta = 0; volta < 15; volta++) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0))
    })
  }
}

async function abrir(caminho: string) {
  window.history.replaceState(null, '', caminho)
  const raiz = document.createElement('div')
  document.body.appendChild(raiz)
  const root = createRoot(raiz)
  montadas.push({ root, raiz })
  await act(async () => {
    root.render(createElement(App))
  })
  await assentar()
  return {
    raiz,
    texto: () => (raiz.textContent ?? '').replace(/\s+/g, ' '),
    caminho: () => window.location.pathname,
  }
}

/** O que reprova qualquer rota, depois de aberta. */
function conferirFumaca(tela: { texto: () => string }) {
  expect(console_, 'erro ou aviso de console').toEqual([])
  expect(simulado.estado.escritas, 'abrir uma tela não grava nada').toEqual([])
  expect(simulado.estado.desconhecidas, 'RPC que o simulado não conhece').toEqual([])
  expect(tela.texto()).not.toMatch(/Não deu para|Não foi possível|não entende|demorou demais/)
  expect(tela.texto()).not.toMatch(/Carregando…/)
  // A lista permitida: em toda rota, para todo mundo, cada tabela que a tela
  // abriu, cada RPC que chamou e cada bucket que abriu nascem no SQL do ponto.
  expect(simulado.estado.lidas.filter((tabela) => !TABELAS_DO_PONTO.has(tabela)), 'tabela fora do SQL do ponto').toEqual([])
  expect(simulado.estado.chamadas.filter((rpc) => !FUNCOES_DO_PONTO.has(rpc)), 'RPC fora do SQL do ponto').toEqual([])
  expect(simulado.estado.buckets.filter((bucket) => !BUCKETS_DO_PONTO.has(bucket)), 'bucket fora do SQL do ponto').toEqual([])
}

/* ------------------------------------------------------------------ */
/* As rotas                                                            */
/* ------------------------------------------------------------------ */

const ROTAS_DO_ADMIN: [string, string, RegExp][] = [
  ['/', '/', /Painel do administrador/],
  ['/espelho', '/espelho', /espelho/i],
  ['/painel', '/painel', /Fechamento do período/],
  [`/painel/${ANA.id}`, `/painel/${ANA.id}`, /Ana Souza/],
  ['/administracao', '/administracao', /Administração do ponto/],
  [`/folha/${ANA.id}`, `/folha/${ANA.id}`, /Ana Souza/],
  // PIN já definido: a tela de criar PIN devolve para a de bater.
  ['/definir-pin', '/', /Painel do administrador/],
  ['/qualquer-coisa', '/', /Painel do administrador/],
]

/*
 * Quem administra e NÃO bate (a Rita, do RH): a raiz é a tela inicial sem o
 * botão de bater, com o caminho do painel; a tela de criar PIN, com o PIN já
 * definido, devolve para a primeira tela dela — o painel.
 */
const ROTAS_DE_QUEM_SO_ADMINISTRA: [string, string, RegExp][] = [
  ['/', '/', /Esta conta não bate ponto/],
  ['/espelho', '/espelho', /espelho/i],
  ['/painel', '/painel', /Fechamento do período/],
  [`/painel/${ANA.id}`, `/painel/${ANA.id}`, /Ana Souza/],
  ['/administracao', '/administracao', /Administração do ponto/],
  [`/folha/${ANA.id}`, `/folha/${ANA.id}`, /Ana Souza/],
  ['/definir-pin', '/painel', /Fechamento do período/],
  ['/qualquer-coisa', '/', /Esta conta não bate ponto/],
]

const ROTAS_DO_COLABORADOR: [string, string, RegExp][] = [
  ['/', '/', /Ver meu espelho do mês/],
  ['/espelho', '/espelho', /espelho/i],
  ['/definir-pin', '/', /Ver meu espelho do mês/],
  // As de admin devolvem para a tela de bater — a dele.
  ['/painel', '/', /Ver meu espelho do mês/],
  [`/painel/${ANA.id}`, '/', /Ver meu espelho do mês/],
  ['/administracao', '/', /Ver meu espelho do mês/],
  [`/folha/${ANA.id}`, '/', /Ver meu espelho do mês/],
]

describe.each([
  ['banco vazio', bancoVazio],
  ['banco com dados', bancoComDados],
])('fumaça com %s', (_nome, banco) => {
  it.each(ROTAS_DO_ADMIN)('admin abre %s (fica em %s)', async (rota, destino, esperado) => {
    entrarComo('admin', banco())
    const tela = await abrir(rota)
    expect(tela.caminho()).toBe(destino)
    expect(tela.texto()).toMatch(esperado)
    conferirFumaca(tela)
  })

  it.each(ROTAS_DE_QUEM_SO_ADMINISTRA)(
    'administrador sem ficha abre %s (fica em %s)',
    async (rota, destino, esperado) => {
      entrarComo('admin-sem-ficha', banco())
      const tela = await abrir(rota)
      expect(tela.caminho()).toBe(destino)
      expect(tela.texto()).toMatch(esperado)
      conferirFumaca(tela)
    },
  )

  it.each(ROTAS_DO_COLABORADOR)('colaborador abre %s (fica em %s)', async (rota, destino, esperado) => {
    entrarComo('colaborador', banco())
    const tela = await abrir(rota)
    expect(tela.caminho()).toBe(destino)
    expect(tela.texto()).toMatch(esperado)
    conferirFumaca(tela)
  })

  it('sem sessão, qualquer rota cai em /entrar', async () => {
    entrarComo(null, banco())
    const tela = await abrir('/administracao')
    expect(tela.caminho()).toBe('/entrar')
    conferirFumaca(tela)
  })

  it.each([
    ['sem PIN', { definido: false, precisa_redefinir: true }],
    ['com redefinição pedida pelo admin', { definido: true, precisa_redefinir: true }],
  ])('%s, qualquer rota cai em /definir-pin, que abre', async (_caso, pin) => {
    entrarComo('colaborador', banco(), pin)
    const tela = await abrir('/espelho')
    expect(tela.caminho()).toBe('/definir-pin')
    expect(tela.texto()).toMatch(/PIN/)
    conferirFumaca(tela)
  })

  it('conta sem acesso ao ponto cai em /sem-acesso', async () => {
    entrarComo('sem-acesso', banco())
    const tela = await abrir('/')
    expect(tela.caminho()).toBe('/sem-acesso')
    expect(tela.texto()).toContain('Seu acesso ao ponto não está liberado')
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* A sessão e a guarda leem só o acesso do ponto                       */
/* ------------------------------------------------------------------ */

describe('a sessão e a guarda leem só o acesso do ponto', () => {
  const botoesDe = (raiz: HTMLElement, seletor = 'button') =>
    [...raiz.querySelectorAll(seletor)].map((botao) => (botao.textContent ?? '').replace(/\s+/g, ' ').trim())

  /** A linha acima da saudação, na tela de bater: o cargo da ficha, ou "Administração do ponto". */
  const linhaDeCima = (raiz: HTMLElement) => (raiz.querySelector('h1')?.previousElementSibling?.textContent ?? '').trim()

  function botaoCom(raiz: HTMLElement, trecho: string): HTMLButtonElement | undefined {
    return [...raiz.querySelectorAll('button')].find((botao) => (botao.textContent ?? '').includes(trecho))
  }

  async function clicar(botao: HTMLElement | undefined) {
    expect(botao).toBeDefined()
    await act(async () => {
      botao?.click()
    })
    await assentar()
  }

  /** Digita num campo controlado pelo React. */
  async function digitar(raiz: HTMLElement, seletor: string, valor: string) {
    const campo = raiz.querySelector<HTMLInputElement>(seletor)
    expect(campo, seletor).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(campo, valor)
      campo?.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  /** Os quatro dígitos no teclado do PIN. */
  async function teclar(raiz: HTMLElement, pin: string) {
    for (const digito of pin) {
      const tecla = [...raiz.querySelectorAll('button')].find((botao) => botao.textContent?.trim() === digito)
      await clicar(tecla)
    }
  }

  /** A volta do painel (o primeiro botão do cabeçalho). */
  const voltaDoPainel = (raiz: HTMLElement) => (raiz.querySelector('header button')?.textContent ?? '').trim()

  it('o administrador sem ficha entra pelo login, define o PIN e cai no painel', async () => {
    entrarComo('admin-sem-ficha', bancoComDados(), { definido: false, precisa_redefinir: false })
    // Ainda sem sessão: o login simulado aceita a conta da Rita.
    simulado.estado.loginAceito = simulado.estado.sessao
    simulado.estado.sessao = null
    let pinGravado: string | null = null
    simulado.estado.rpcs.ponto_pin_status = () => ({
      definido: pinGravado !== null,
      precisa_redefinir: false,
      bloqueado_ate: null,
    })
    simulado.estado.rpcs.ponto_definir_pin = () => {
      pinGravado = 'gravado'
      return null
    }

    const tela = await abrir('/entrar')
    expect(tela.texto()).toContain('Use o e-mail e a senha da sua conta do ponto.')
    // Conta e senha são do super admin (o RH reseta PIN e corrige ponto): a
    // tela manda a quem cuida do ponto na empresa, e é a única a quem ela
    // manda falar.
    expect(tela.texto()).toContain('Esqueceu a senha ou ainda não tem conta? Fale com quem cuida do ponto na sua empresa.')
    expect(tela.texto().match(/Fale com [^.]*\./g)).toEqual(['Fale com quem cuida do ponto na sua empresa.'])

    await digitar(tela.raiz, '#email', RITA.email)
    await digitar(tela.raiz, '#senha', 'senha-da-rita')
    await clicar(botaoCom(tela.raiz, 'Entrar'))

    // Entrou sem PIN: a primeira tela dela é o painel, e a guarda leva antes a criar o PIN.
    expect(tela.caminho()).toBe('/definir-pin')
    expect(tela.texto()).toContain('Crie seu PIN')

    await teclar(tela.raiz, '2468')
    expect(tela.texto()).toContain('Repita o PIN')
    await teclar(tela.raiz, '2468')

    expect(pinGravado).not.toBeNull()
    expect(tela.caminho()).toBe('/painel')
    expect(tela.texto()).toContain('Fechamento do período')
    // A volta do painel não promete um botão de bater que a tela inicial não tem.
    expect(voltaDoPainel(tela.raiz)).toBe('Início')
    conferirFumaca(tela)
  })

  it('com o PIN já criado, o login leva quem só administra direto ao painel, e quem bate à tela de bater', async () => {
    for (const [conta, destino, esperado] of [
      ['admin-sem-ficha', '/painel', /Fechamento do período/],
      ['colaborador', '/', /Ver meu espelho do mês/],
      ['admin', '/', /Painel do administrador/],
    ] as const) {
      entrarComo(conta, bancoComDados())
      simulado.estado.loginAceito = simulado.estado.sessao
      simulado.estado.sessao = null

      const tela = await abrir('/entrar')
      await digitar(tela.raiz, '#email', USUARIO_DA_CONTA[conta].email)
      await digitar(tela.raiz, '#senha', 'qualquer-senha')
      await clicar(botaoCom(tela.raiz, 'Entrar'))

      expect(tela.caminho(), conta).toBe(destino)
      expect(tela.texto(), conta).toMatch(esperado)
      conferirFumaca(tela)
    }
  })

  it('a tela inicial de quem só administra: sem botão de bater, com o caminho do painel', async () => {
    entrarComo('admin-sem-ficha', bancoComDados())
    const tela = await abrir('/')
    expect(tela.caminho()).toBe('/')
    expect(tela.texto()).toContain('Administração do ponto')
    expect(tela.texto()).toContain('Olá, Rita')
    expect(tela.texto()).toContain('Esta conta não bate ponto')

    const doConteudo = botoesDe(tela.raiz, 'main button')
    // O primeiro botão continua sendo o de corrigir, com os pedidos esperando.
    expect(doConteudo[0]).toBe('Corrigir ponto · 1 pedido esperando')
    // Nenhum botão de bater, diga ele "Bater ponto" ou a batida prevista.
    expect(doConteudo.some((rotulo) => /^Bater /.test(rotulo))).toBe(false)
    expect(doConteudo.some((rotulo) => rotulo.includes('Esqueci de bater'))).toBe(false)
    expect(doConteudo).not.toContain('Ver meu espelho do mês')
    expect(doConteudo).toContain('Painel do administrador')
    expect(doConteudo).toContain('Administração')
    // Quem não bate não tem lista do dia: as batidas nem são lidas.
    expect(simulado.estado.lidas).not.toContain('ponto_registros')
    conferirFumaca(tela)

    await clicar(botaoCom(tela.raiz, 'Painel do administrador'))
    expect(tela.caminho()).toBe('/painel')
    expect(voltaDoPainel(tela.raiz)).toBe('Início')
    conferirFumaca(tela)
  })

  it('o super admin sem ficha bate: a tela inicial tem o botão, e a linha de cima diz "Administração do ponto"', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/')
    expect(tela.texto()).toContain('Administração do ponto')
    expect(tela.texto()).toContain('Olá, Sérgio')
    // Sem batida hoje, o botão prevê a entrada.
    expect(botoesDe(tela.raiz, 'main button').some((rotulo) => rotulo.startsWith('Bater entrada'))).toBe(true)
    expect(tela.texto()).not.toContain('Esta conta não bate ponto')
    conferirFumaca(tela)

    const painel = await abrir('/painel')
    expect(voltaDoPainel(painel.raiz)).toBe('Bater ponto')
    conferirFumaca(painel)
  })

  it('quem bate pela ficha vê na linha de cima o cargo da ficha', async () => {
    entrarComo('colaborador', bancoComDados())
    const tela = await abrir('/')
    // A Ana tem a ficha ligada, com o cargo "Analista": a linha de cima é o
    // cargo, e a saudação leva o primeiro nome.
    expect(linhaDeCima(tela.raiz)).toBe('Analista')
    expect(tela.raiz.querySelector('h1')?.textContent).toBe('Olá, Ana')
    conferirFumaca(tela)
  })

  it('a conta com a ficha desligada vai para "sem acesso", que manda pedir a liberação a quem cuida do ponto', async () => {
    const banco = bancoComDados()
    entrarComo('sem-acesso', {
      ...banco,
      ponto_funcionarios: [
        ...banco.ponto_funcionarios,
        {
          ...banco.ponto_funcionarios[0],
          id: 'f-fernanda',
          usuario_id: FERNANDA.id,
          nome_completo: 'Fernanda Teles',
          ativo: false,
          desligamento: '2026-09-15',
        },
      ],
    })
    for (const rota of ['/', '/painel', '/definir-pin', '/espelho']) {
      const tela = await abrir(rota)
      expect(tela.caminho(), rota).toBe('/sem-acesso')
      expect(tela.texto()).toContain('Seu acesso ao ponto não está liberado')
      // Quem libera é o super admin (ligar, reativar, tirar o desligamento): a
      // tela manda pedir a liberação a quem cuida do ponto na empresa, numa
      // frase só.
      expect(tela.texto().match(/Peça a liberação [^.]*\./g)).toEqual([
        'Peça a liberação a quem cuida do ponto na sua empresa e depois toque em verificar de novo.',
      ])
      expect(tela.texto()).toContain(FERNANDA.email)
      // O nome que o banco dá à conta é o da ficha, mesmo desligada.
      expect(tela.texto()).toContain('Fernanda Teles')
      conferirFumaca(tela)
    }
  })

  /*
   * A ROTA SAI DAS DUAS LEITURAS DA CONTA — `ponto_meu_acesso()` e
   * `ponto_pin_status()` — e de mais nada: com TODA tabela e toda outra RPC
   * recusando, entrar, criar o PIN e "sem acesso" levam cada conta à tela
   * certa, e a tela abre. Ela mostra a falha das leituras dela; o que se prova
   * aqui é a decisão da guarda.
   */
  it('a guarda decide pela resposta de ponto_meu_acesso() e ponto_pin_status(): com o resto recusando, entrar, criar o PIN e "sem acesso" funcionam', async () => {
    const casos: [Conta, string, string, RegExp, { definido: boolean; precisa_redefinir: boolean }?][] = [
      ['colaborador', '/', '/', /Ver meu espelho do mês/],
      ['admin', '/', '/', /Painel do administrador/],
      ['admin-sem-ficha', '/', '/', /Esta conta não bate ponto/],
      ['admin-sem-ficha', '/painel', '/definir-pin', /Crie seu PIN/, { definido: false, precisa_redefinir: false }],
      ['sem-acesso', '/', '/sem-acesso', /Seu acesso ao ponto não está liberado/],
    ]
    const DA_SESSAO = ['ponto_meu_acesso', 'ponto_pin_status']
    for (const [conta, rota, destino, esperado, pin] of casos) {
      entrarComo(conta, bancoComDados(), pin)
      simulado.estado.falham = ['*']
      for (const nome of Object.keys(simulado.estado.rpcs).filter((nome) => !DA_SESSAO.includes(nome))) {
        simulado.estado.rpcs[nome] = () => {
          throw new Error(`${nome} recusada no simulado`)
        }
      }
      simulado.estado.chamadas = []
      const tela = await abrir(rota)
      expect(tela.caminho(), `${conta} em ${rota}`).toBe(destino)
      expect(tela.texto(), `${conta} em ${rota}`).toMatch(esperado)
      expect(simulado.estado.chamadas, `${conta} em ${rota}`).toEqual(expect.arrayContaining(DA_SESSAO))
      expect(simulado.estado.desconhecidas, `${conta} em ${rota}`).toEqual([])
      expect(simulado.estado.escritas, `${conta} em ${rota}`).toEqual([])
    }
  })

  /*
   * Os arquivos da sessão e da guarda usam do cliente só o login
   * (`supabase.auth`: entrar, sair, escutar a sessão). A conta é lida pelas
   * duas funções do app que fazem as duas RPCs acima.
   */
  it('o código da sessão e da guarda usa do Supabase só o login, e lê a conta por lerMeuAcesso e lerStatusDoPin', () => {
    const usos = Object.entries(FONTES_DA_SESSAO).flatMap(([arquivo, fonte]) =>
      [...fonte.matchAll(/\bsupabase\s*\.\s*(\w+)/g)].map((casamento) => `${arquivo}: supabase.${casamento[1]}`),
    )
    // A busca acha os usos de verdade (e não uma lista vazia que passaria calada).
    expect(usos).toContain('contexts/AuthContext.tsx: supabase.auth')
    expect(usos.filter((uso) => !uso.endsWith(': supabase.auth'))).toEqual([])
    expect(fonteDoProvedor).toContain("import { lerStatusDoPin } from '../lib/pin'")
    expect(fonteDoProvedor).toContain("import { lerMeuAcesso } from '../lib/administracao'")
    expect(FONTES_DO_APP['./lib/pin.ts']).toMatch(/rpc\('ponto_pin_status'\)/)
    expect(FONTES_DO_APP['./lib/administracao.ts']).toMatch(/rpc\('ponto_meu_acesso'\)/)
  })

  /*
   * A LISTA PERMITIDA DO APP INTEIRO, e não só da sessão: toda tabela que o
   * código abre, toda RPC que ele chama e todo bucket que ele usa nascem no
   * SQL do ponto, e a única Edge Function é a de contas. As listas leem
   * `ponto_contas()`, e quem libera o acesso é a ficha, no banco do ponto.
   */
  it('toda tabela, RPC, bucket e função que o app nomeia é do ponto, criada pelo SQL dele', () => {
    const arquivos = Object.keys(FONTES_DO_APP)
    // A busca alcança o app de verdade, e o SQL também (listas vazias passariam caladas).
    expect(arquivos).toEqual(expect.arrayContaining(['./lib/admin.ts', './lib/pessoas.ts', './components/ListaDePessoas.tsx']))
    expect(arquivos.some((arquivo) => arquivo.includes('.test.'))).toBe(false)
    expect([...TABELAS_DO_PONTO]).toEqual(expect.arrayContaining(['ponto_registros', 'ponto_funcionarios', 'ponto_admins']))
    expect([...FUNCOES_DO_PONTO]).toEqual(expect.arrayContaining(['ponto_meu_acesso', 'ponto_contas', 'ponto_pin_status']))
    expect([...BUCKETS_DO_PONTO].sort()).toEqual(['ponto-atestados', 'ponto-selfies'])

    const nomeados = (padrao: RegExp) =>
      Object.entries(FONTES_DO_APP).flatMap(([arquivo, fonte]) =>
        [...fonte.matchAll(padrao)].map((casamento) => ({ arquivo, nome: casamento[1] })),
      )
    const tabelas = nomeados(/\.from\(\s*'([^']*)'/g)
    const rpcs = nomeados(/\.rpc\(\s*'([^']*)'/g)
    expect(tabelas.length).toBeGreaterThan(0)
    expect(rpcs.length).toBeGreaterThan(0)
    expect(tabelas.filter(({ nome }) => !TABELAS_DO_PONTO.has(nome))).toEqual([])
    expect(rpcs.filter(({ nome }) => !FUNCOES_DO_PONTO.has(nome))).toEqual([])
    // Toda RPC vai pelo nome escrito; todo `from()` sem nome escrito é o do storage, pelo bucket.
    expect(nomeados(/\.rpc\(\s*(?!')(\S*)/g)).toEqual([])
    expect([...new Set(nomeados(/(?<!Array)\.from\(\s*(?!')([^\s,)]+)/g).map(({ nome }) => nome))]).toEqual(['BUCKET'])
    expect(nomeados(/\bBUCKET\s*=\s*'([^']*)'/g).map(({ nome }) => nome).sort()).toEqual(['ponto-atestados', 'ponto-selfies'])
    expect(nomeados(/\bfunctions\s*\.\s*invoke\(\s*'([^']*)'/g).map(({ nome }) => nome)).toEqual(['ponto-contas'])
    expect(FONTES_DO_APP['./lib/admin.ts']).toMatch(/rpc\('ponto_contas'\)/)
  })
})

/* ------------------------------------------------------------------ */
/* A página inicial da administração, montada de verdade               */
/* ------------------------------------------------------------------ */

describe('a página inicial da administração', () => {
  it('mostra os seis contadores com o que o banco tem', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    const texto = tela.texto()
    expect(texto).toContain('1pedido esperando decisão')
    expect(texto).toContain('Pedido pendente não conta hora')
    // As quatro contas do ponto (Sérgio, Ana, Rita e a conta do Bruno, ainda
    // sem ficha) e a ficha do Bruno sem conta. A Rita só administra: não é
    // pendência de acesso nem de PIN.
    expect(texto).toMatch(/Pessoas5pessoas1 conta sem acesso · 1 ficha sem conta/)
    expect(texto).toMatch(/1ausência em /)
    expect(texto).toContain('150 mde raio')
    expect(texto).toContain('sem medição no local')
    expect(texto).toContain('1campo faltando na folha')
    expect(texto).toContain('Falta CNPJ.')
    expect(texto).toContain('08:00de carga diária')
    conferirFumaca(tela)
  })

  it('com o banco vazio, avisa em vez de inventar', async () => {
    entrarComo('admin', bancoVazio())
    const tela = await abrir('/administracao')
    const texto = tela.texto()
    expect(texto).toContain('Nenhum pedido esperando.')
    expect(texto).toContain('Nenhum local ativo')
    expect(texto).toContain('Ainda sem configuração gravada')
    conferirFumaca(tela)
  })

  it('o cartão de atraso leva ao painel, onde se decide', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    const cartao = [...tela.raiz.querySelectorAll('button')].find((botao) =>
      (botao.textContent ?? '').includes('Decidir no painel'),
    )
    expect(cartao).toBeDefined()
    await act(async () => {
      cartao?.click()
    })
    await assentar()
    expect(tela.caminho()).toBe('/painel')
    expect(tela.texto()).toContain('Fechamento do período')
    conferirFumaca(tela)
  })

  it('o cartão das pessoas rola até a lista, na mesma página', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    const rolou = vi.fn()
    const lista = document.getElementById('secao-pessoas')
    expect(lista).not.toBeNull()
    if (lista) lista.scrollIntoView = rolou
    const cartao = [...tela.raiz.querySelectorAll('button')].find((botao) =>
      (botao.textContent ?? '').includes('Ver a lista'),
    )
    await act(async () => {
      cartao?.click()
    })
    expect(rolou).toHaveBeenCalledTimes(1)
    expect(tela.caminho()).toBe('/administracao')
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* A administração não promete conta que o app não faz                 */
/* ------------------------------------------------------------------ */

describe('a administração não promete conta que o app não faz', () => {
  /*
   * Nenhuma conta do app lê a carga diária, a tolerância nem a data "passou a
   * bater ponto aqui em": `horas.ts` soma os pares de batidas, e a folha não
   * acusa falta em dia sem batida. A tela diz isso, e não o contrário.
   */
  it('as regras de jornada dizem o que vale na batida e que a carga e a tolerância só ficam guardadas', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    const regras = (document.getElementById('secao-jornada')?.textContent ?? '').replace(/\s+/g, ' ')
    expect(regras).toContain('A janela de duplicidade é lida pelo servidor a cada batida — muda aqui, vale na próxima.')
    expect(regras).toContain(
      'A carga diária e a tolerância ficam guardadas, mas ainda não entram em conta nenhuma: o app não calcula saldo de horas, minutos de atraso nem hora extra.',
    )
    conferirFumaca(tela)
  })

  it('o aviso das fichas sem a data diz que ela é só registro, que não muda a batida nem a folha', async () => {
    // A ficha do Bruno está ativa, sem conta e sem a data.
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    expect(tela.texto()).toContain(
      '1 ficha(s) ativa(s) ainda sem “passou a bater ponto aqui em”. A data é só registro: aparece nesta lista e não muda a batida nem a folha.',
    )
    conferirFumaca(tela)
  })
})

describe('a lista de pessoas vem das contas do ponto', () => {
  /** O `li` da lista de pessoas cujo texto tem `trecho`. */
  function linhaDe(raiz: HTMLElement, trecho: string): string {
    const linha = [...raiz.querySelectorAll('#secao-pessoas li')].find((item) => (item.textContent ?? '').includes(trecho))
    return (linha?.textContent ?? '').replace(/\s+/g, ' ')
  }

  /** Os nomes das linhas da lista, na ordem. */
  function nomesDaLista(raiz: HTMLElement): string[] {
    return [...raiz.querySelectorAll('#secao-pessoas li > button > div.min-w-0 > p:first-child')].map((p) =>
      (p.textContent ?? '').trim(),
    )
  }

  it('toda conta do ponto aparece, lida de ponto_contas()', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    expect(simulado.estado.chamadas).toContain('ponto_contas')
    expect(tela.texto()).toContain('Ana Souza')
    expect(tela.texto()).toContain(BRUNO.email)
    expect(tela.texto()).toContain(RITA.email)
    // O resumo da lista: as cinco pessoas, os dois administradores, a conta
    // do Bruno sem acesso e a ficha dele sem conta. A Rita não é pendência.
    expect(tela.texto()).toContain('5 pessoas · 2 administram o ponto · 1 sem acesso ao ponto · 1 ficha(s) sem conta')
    // Nem a Rita (só administra) nem a conta do Bruno (sem acesso) contam como "sem PIN".
    expect(tela.texto()).not.toMatch(/\d+ sem PIN/)
    conferirFumaca(tela)
  })

  it('quem só administra: "só administra — não bate ponto", no fim do grupo dos administradores', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    expect(nomesDaLista(tela.raiz)).toEqual(['Sérgio Almeida', 'Rita', 'Bruno Lima', 'Ana Souza', 'Bruno Lima'])
    const daRita = linhaDe(tela.raiz, RITA.email)
    expect(daRita).toContain('só administra — não bate ponto')
    expect(daRita).not.toContain('sem acesso')
    expect(daRita, daRita).not.toContain('sem PIN')
    // A conta sem ficha e sem administrar leva a etiqueta "sem acesso ao ponto".
    expect(linhaDe(tela.raiz, BRUNO.email)).toContain('sem acesso ao ponto')
    conferirFumaca(tela)
  })

  it('a sugestão de vínculo da ficha sem conta acha a conta sem ficha da lista de contas', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    // A ficha "Bruno Lima" (sem conta) sugere a conta do Bruno, que tem o
    // mesmo nome guardado e nenhuma ficha.
    expect(tela.texto()).toContain('conta sugerida: Bruno Lima')
    conferirFumaca(tela)
  })

  it('a busca que não acha ninguém diz isso', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    const campo = tela.raiz.querySelector<HTMLInputElement>('#busca-de-pessoas')
    expect(campo).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(campo, 'carla')
      campo?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await assentar()
    expect(tela.texto()).toContain('Ninguém com “carla” no nome, no e-mail ou na ficha.')
    conferirFumaca(tela)
  })

  it('quem administra sem ficha (a Rita) abre a lista de pessoas e lê as contas', async () => {
    entrarComo('admin-sem-ficha', bancoComDados())
    const tela = await abrir('/administracao')
    expect(simulado.estado.chamadas).toContain('ponto_contas')
    expect(tela.texto()).toContain('Ana Souza')
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* Os nomes de quem decidiu vêm das contas do ponto                    */
/* ------------------------------------------------------------------ */

describe('os nomes de quem decidiu vêm das contas do ponto', () => {
  /** O pedido de hoje da Ana, APROVADO pela Rita, e a batida que nasceu dele. */
  function bancoComPedidoAprovado(): Record<string, Linha[]> {
    const banco = bancoComDados()
    return {
      ...banco,
      ponto_pedidos_atraso: [
        {
          ...banco.ponto_pedidos_atraso[0],
          estado: 'aprovado',
          decidido_por: RITA.id,
          decidido_em: agora,
          registro_id: 'r1',
        },
      ],
      ponto_registros: [
        {
          ...banco.ponto_registros[0],
          ajuste_manual: true,
          origem: 'ajuste_admin',
          motivo_ajuste: 'Batida em atraso aprovada: esqueci',
          pedido_atraso_id: 'pa1',
        },
      ],
    }
  }

  it('no painel da pessoa, a batida em atraso diz quem aprovou — o nome guardado na conta da Rita', async () => {
    entrarComo('admin', bancoComPedidoAprovado())
    const tela = await abrir(`/painel/${ANA.id}`)
    expect(tela.texto()).toContain('em atraso, aprovada por Rita')
    conferirFumaca(tela)
  })

  it('no painel da pessoa, a selfie aparece em miniatura dentro do botão que abre a foto', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir(`/painel/${ANA.id}`)
    const miniatura = tela.raiz.querySelector('button[aria-label^="Ver a selfie das"] img')
    expect(miniatura?.getAttribute('src')).toBe(
      `https://simulado.invalid/ponto-selfies/${ANA.id}/${mes.replace('-', '/')}/r1.jpg`,
    )
    expect(miniatura?.getAttribute('alt')).toBe('')
    conferirFumaca(tela)
  })

  it('o colaborador vê "Aprovado." sem o nome, e a tela nem pede a lista de contas (o banco recusaria)', async () => {
    entrarComo('colaborador', bancoComPedidoAprovado())
    for (const rota of ['/', '/espelho']) {
      simulado.estado.chamadas = []
      const tela = await abrir(rota)
      expect(tela.texto(), rota).toContain('Aprovado. Já está no seu ponto.')
      expect(simulado.estado.chamadas, rota).not.toContain('ponto_contas')
      conferirFumaca(tela)
    }
  })
})

describe('a página inicial com a configuração sem leitura', () => {
  it('o cartão do local rola até o aviso de erro, e não até um formulário que não está na tela', async () => {
    // Com a configuração sem leitura, os três formulários somem: o botão "Ver
    // o local" não pode procurar (`getElementById`) um bloco inexistente.
    entrarComo('admin', bancoComDados())
    simulado.estado.falham = ['ponto_configuracao']
    const tela = await abrir('/administracao')
    expect(document.getElementById('secao-local')).toBeNull()
    const aviso = document.getElementById('secao-configuracao')
    expect(aviso).not.toBeNull()
    const rolou = vi.fn()
    if (aviso) aviso.scrollIntoView = rolou
    const cartao = [...tela.raiz.querySelectorAll('button')].find((botao) =>
      (botao.textContent ?? '').includes('Ver o local'),
    )
    expect(cartao).toBeDefined()
    await act(async () => {
      cartao?.click()
    })
    expect(rolou).toHaveBeenCalledTimes(1)
    expect(tela.texto()).toContain('Não deu para ler o local.')
    expect(simulado.estado.escritas).toEqual([])
  })
})

describe('as portas da administração', () => {
  it('a tela de bater mostra "Administração" a quem administra, e leva até ela', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/')
    const porta = [...tela.raiz.querySelectorAll('button')].find(
      (botao) => (botao.textContent ?? '').trim() === 'Administração',
    )
    expect(porta).toBeDefined()
    await act(async () => {
      porta?.click()
    })
    await assentar()
    expect(tela.caminho()).toBe('/administracao')
    conferirFumaca(tela)
  })

  it('a tela de bater NÃO mostra a porta a quem não administra', async () => {
    entrarComo('colaborador', bancoComDados())
    const tela = await abrir('/')
    const botoes = [...tela.raiz.querySelectorAll('button')].map((botao) => (botao.textContent ?? '').trim())
    expect(botoes).not.toContain('Administração')
    expect(botoes).not.toContain('Painel do administrador')
    conferirFumaca(tela)
  })

  it('o painel do mês leva à administração', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/painel')
    const porta = [...tela.raiz.querySelectorAll('button')].find(
      (botao) => (botao.textContent ?? '').trim() === 'Administração',
    )
    expect(porta).toBeDefined()
    await act(async () => {
      porta?.click()
    })
    await assentar()
    expect(tela.caminho()).toBe('/administracao')
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* O nome da ficha de RH                                               */
/* ------------------------------------------------------------------ */

describe('o nome que aparece é o da ficha de RH, e não o guardado na conta', () => {
  /*
   * Contas de função que mudam de dono: a `ana@` é usada pela Ana Beatriz, e o
   * nome guardado na conta ainda diz "Vítor Campos" (o dono anterior). Ao lado
   * dela, a `daniela@` é da Daniela, sem nome guardado e com as batidas sem nome
   * congelado. As duas têm a ficha ligada.
   */
  const ANA_BEATRIZ = { id: 'u-ana-beatriz', email: 'ana@example.com' }
  const DANIELA = { id: 'u-daniela', email: 'daniela@example.com' }

  function fichaDe(conta: { id: string }, nome: string): Linha {
    return {
      ...bancoComDados().ponto_funcionarios[0],
      id: `f-${conta.id}`,
      usuario_id: conta.id,
      nome_completo: nome,
    }
  }

  function batidaDe(conta: { id: string; email: string }, nomeCongelado: string | null): Linha {
    return {
      ...bancoComDados().ponto_registros[0],
      id: `r-${conta.id}`,
      usuario_id: conta.id,
      selfie_path: `${conta.id}/${mes.replace('-', '/')}/r-${conta.id}.jpg`,
      funcionario_nome: nomeCongelado,
      funcionario_email: conta.email,
    }
  }

  /** Uma conta que bateu ponto e não tem ficha: a única que leva "sem ficha de RH". */
  const SEM_FICHA = { id: 'u-sem-ficha', email: 'estoque@example.com' }

  function bancoDasContasDeFuncao(): Record<string, Linha[]> {
    const banco = bancoComDados()
    return {
      ...banco,
      contas_do_ponto: [
        ...banco.contas_do_ponto,
        conta(ANA_BEATRIZ, 'Vítor Campos'),
        conta(DANIELA, null),
        conta(SEM_FICHA, 'Ciro Sem Ficha'),
      ],
      ponto_funcionarios: [
        ...banco.ponto_funcionarios,
        fichaDe(ANA_BEATRIZ, 'Ana Beatriz Rocha'),
        fichaDe(DANIELA, 'Daniela Freitas'),
      ],
      ponto_registros: [
        ...banco.ponto_registros,
        batidaDe(ANA_BEATRIZ, 'Vítor Campos'),
        batidaDe(DANIELA, null),
        batidaDe(SEM_FICHA, 'Ciro Sem Ficha'),
      ],
      // O pedido de atraso guarda o nome congelado: o do dono anterior.
      ponto_pedidos_atraso: [
        ...banco.ponto_pedidos_atraso,
        {
          ...banco.ponto_pedidos_atraso[0],
          id: 'pa-ana-beatriz',
          usuario_id: ANA_BEATRIZ.id,
          selfie_path: `${ANA_BEATRIZ.id}/${mes.replace('-', '/')}/pa-ana-beatriz.jpg`,
          funcionario_nome: 'Vítor Campos',
          funcionario_email: ANA_BEATRIZ.email,
        },
      ],
    }
  }

  /** O cartão (`li`) do painel cujo texto tem `nome`. */
  function cartaoDe(raiz: HTMLElement, nome: string): string {
    const cartao = [...raiz.querySelectorAll('li')].find((item) => (item.textContent ?? '').includes(nome))
    return (cartao?.textContent ?? '').replace(/\s+/g, ' ')
  }

  it('o painel mostra "Ana Beatriz Rocha" para a conta cujo nome guardado diz "Vítor Campos"', async () => {
    entrarComo('admin', bancoDasContasDeFuncao())
    const tela = await abrir('/painel')
    const texto = tela.texto()
    expect(texto).toContain('Ana Beatriz Rocha')
    expect(texto).toContain('Daniela Freitas')
    // Nem o nome errado da conta, nem o e-mail no lugar do nome — nem na caixa
    // de pendências, onde o pedido guarda o nome congelado do dono anterior.
    expect(texto).not.toContain('Vítor Campos')
    // Em ordem alfabética pelo nome de exibição, entre quem bateu (os cartões
    // da lista são os links para a tela da pessoa).
    const nomesNaLista = [...tela.raiz.querySelectorAll('a')]
      .filter((link) => (link.getAttribute('href') ?? '').startsWith('/painel/'))
      .map((link) => link.querySelector('p')?.textContent)
    // O Ciro bateu, mas sem ficha não pode bater (pode bater quem tem ficha
    // OU é super admin): fica no fim de quem bateu, mesmo vindo antes da
    // Daniela no alfabeto.
    expect(nomesNaLista).toEqual(['Ana Beatriz Rocha', 'Ana Souza', 'Daniela Freitas', 'Ciro Sem Ficha'])
    // A etiqueta "sem ficha de RH": só quem bateu e não tem ficha a recebe.
    expect(cartaoDe(tela.raiz, 'Daniela Freitas')).not.toContain('sem ficha de RH')
    expect(cartaoDe(tela.raiz, 'Ciro Sem Ficha')).toContain('sem ficha de RH')
    expect(texto.match(/sem ficha de RH/g)).toHaveLength(1)
    conferirFumaca(tela)
  })

  it('a tela da pessoa e a folha também', async () => {
    entrarComo('admin', bancoDasContasDeFuncao())
    const pessoa = await abrir(`/painel/${ANA_BEATRIZ.id}`)
    expect(pessoa.raiz.querySelector('h1')?.textContent).toBe('Ana Beatriz Rocha')
    expect(pessoa.texto()).not.toContain('Vítor Campos')
    conferirFumaca(pessoa)

    const folha = await abrir(`/folha/${DANIELA.id}`)
    expect(folha.texto()).toContain('Daniela Freitas')
    conferirFumaca(folha)
  })

  it('a lista de pessoas da administração também', async () => {
    entrarComo('admin', bancoDasContasDeFuncao())
    const tela = await abrir('/administracao')
    expect(tela.texto()).toContain('Ana Beatriz Rocha')
    expect(tela.texto()).not.toContain('Vítor Campos')
    conferirFumaca(tela)
  })

  it('a tela de bater cumprimenta pela ficha: "Olá, Ana", e não "Olá, Vítor"', async () => {
    // A sessão padrão do colaborador é a Ana Souza, também "Olá, Ana" e com o
    // cargo "Analista": o cargo próprio da ficha da Ana Beatriz é o que prova
    // que a tela é a DELA.
    const banco = bancoDasContasDeFuncao()
    banco.ponto_funcionarios = banco.ponto_funcionarios.map((linha) =>
      linha.usuario_id === ANA_BEATRIZ.id ? { ...linha, cargo: 'Coordenadora' } : linha,
    )
    entrarComo('colaborador', banco)
    simulado.estado.sessao = { user: ANA_BEATRIZ }
    const tela = await abrir('/')
    expect(tela.texto()).toContain('Olá, Ana')
    expect(tela.texto()).toContain('Coordenadora')
    expect(tela.texto()).not.toContain('Analista')
    expect(tela.texto()).not.toContain('Vítor')
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* Só quem é do ponto, e "pode bater" pela ficha                       */
/* ------------------------------------------------------------------ */

describe('o painel mostra só quem é do ponto, e "pode bater" é ficha OU super admin', () => {
  /*
   * O banco pequeno já tem contas sem nada no período: o Sérgio (super admin,
   * sem ficha, sem batida), a Rita (só administra) e a conta do Bruno (sem
   * ficha). Aqui entram três casos novos:
   *   • o Caio: sem nome guardado na conta, mas com ficha ativa ligada —
   *     bate pela ficha, e não pode aparecer como bloqueado;
   *   • a conta antiga: sem ficha, com uma batida no mês — é do ponto pela
   *     batida e não pode bater;
   *   • a conta que só pediu batida (pedido recusado): é do ponto pelo pedido.
   */
  const CAIO = { id: 'u-caio', email: 'caio@example.com' }
  const ANTIGA = { id: 'u-antiga', email: 'antiga@example.com' }
  const SO_PEDIU = { id: 'u-so-pediu', email: 'pediu@example.com' }

  function bancoDoPonto(): Record<string, Linha[]> {
    const banco = bancoComDados()
    return {
      ...banco,
      contas_do_ponto: [
        ...banco.contas_do_ponto,
        conta(CAIO, null),
        conta(ANTIGA, 'Conta Antiga'),
        conta(SO_PEDIU, 'Só Pediu'),
      ],
      ponto_funcionarios: [
        ...banco.ponto_funcionarios,
        { ...banco.ponto_funcionarios[0], id: 'f-caio', usuario_id: CAIO.id, nome_completo: 'Caio Mendes' },
      ],
      ponto_registros: [
        ...banco.ponto_registros,
        {
          ...banco.ponto_registros[0],
          id: 'r-antiga',
          usuario_id: ANTIGA.id,
          selfie_path: `${ANTIGA.id}/${mes.replace('-', '/')}/r-antiga.jpg`,
          funcionario_nome: 'Conta Antiga',
          funcionario_email: ANTIGA.email,
        },
      ],
      ponto_pedidos_atraso: [
        ...banco.ponto_pedidos_atraso,
        {
          ...banco.ponto_pedidos_atraso[0],
          id: 'pa-so-pediu',
          usuario_id: SO_PEDIU.id,
          selfie_path: `${SO_PEDIU.id}/${mes.replace('-', '/')}/pa-so-pediu.jpg`,
          estado: 'recusado',
          decidido_por: ADMIN.id,
          decidido_em: agora,
          motivo_decisao: 'Horário não confere.',
          funcionario_nome: 'Só Pediu',
          funcionario_email: SO_PEDIU.email,
        },
      ],
    }
  }

  /** Os nomes dos cartões da lista do painel (os links para a tela da pessoa). */
  function nomesNaLista(raiz: HTMLElement): (string | null | undefined)[] {
    return [...raiz.querySelectorAll('a')]
      .filter((link) => (link.getAttribute('href') ?? '').startsWith('/painel/'))
      .map((link) => link.querySelector('p')?.textContent)
  }

  function cartaoDe(raiz: HTMLElement, nome: string): string {
    const cartao = [...raiz.querySelectorAll('li')].find((item) => (item.textContent ?? '').includes(nome))
    return (cartao?.textContent ?? '').replace(/\s+/g, ' ')
  }

  it('conta sem ficha e sem batida, ausência ou pedido no período não aparece no painel', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/painel')
    // Só a Ana (ficha e batida). O Sérgio, a Rita e a conta do Bruno, não.
    expect(nomesNaLista(tela.raiz)).toEqual(['Ana Souza'])
    expect(tela.texto()).toContain('1 pessoa')
    expect(tela.texto()).not.toContain('Sérgio Almeida')
    expect(tela.texto()).not.toContain(RITA.email)
    expect(tela.texto()).not.toContain(BRUNO.email)
    conferirFumaca(tela)
  })

  /*
   * A batida de teste do super admin: o Sérgio (super admin, sem ficha) bate
   * para conferir a instalação. Ele aparece no painel com a batida e "sem
   * ficha de RH", e NÃO com "sem acesso ao ponto" — o super admin bate (só
   * para teste).
   */
  it('a batida de teste do super admin sem ficha aparece sem "sem acesso ao ponto"', async () => {
    const banco = bancoComDados()
    entrarComo('admin', {
      ...banco,
      ponto_registros: [
        ...banco.ponto_registros,
        {
          ...banco.ponto_registros[0],
          id: 'r-sergio',
          usuario_id: ADMIN.id,
          selfie_path: `${ADMIN.id}/${mes.replace('-', '/')}/r-sergio.jpg`,
          funcionario_nome: 'Sérgio Almeida',
          funcionario_email: ADMIN.email,
        },
      ],
    })
    const tela = await abrir('/painel')
    expect(nomesNaLista(tela.raiz)).toEqual(['Ana Souza', 'Sérgio Almeida'])
    expect(cartaoDe(tela.raiz, 'Sérgio Almeida')).toContain('sem ficha de RH')
    expect(cartaoDe(tela.raiz, 'Sérgio Almeida')).not.toContain('sem acesso ao ponto')
    conferirFumaca(tela)
  })

  it('a ficha, a batida e o pedido põem a pessoa no painel; "pode bater" vem também da ficha', async () => {
    entrarComo('admin', bancoDoPonto())
    const tela = await abrir('/painel')
    // Quem bateu primeiro (alfabética), depois quem pode bater, por último quem não pode.
    expect(nomesNaLista(tela.raiz)).toEqual(['Ana Souza', 'Conta Antiga', 'Caio Mendes', 'Só Pediu'])
    // O Caio não tem nome guardado, mas bate pela ficha: nenhuma marca de bloqueio.
    expect(cartaoDe(tela.raiz, 'Caio Mendes')).not.toContain('sem acesso ao ponto')
    // Quem só pediu, sem ficha, não bate pelo app: a marca diz isso.
    expect(cartaoDe(tela.raiz, 'Só Pediu')).toContain('sem acesso ao ponto')
    // A conta antiga não pode bater, e bateu sem ficha: as duas marcas.
    expect(cartaoDe(tela.raiz, 'Conta Antiga')).toContain('sem acesso ao ponto')
    expect(cartaoDe(tela.raiz, 'Conta Antiga')).toContain('sem ficha de RH')
    // "sem ficha de RH" só para quem bateu: o Só Pediu não bateu.
    expect(cartaoDe(tela.raiz, 'Só Pediu')).not.toContain('sem ficha de RH')
    conferirFumaca(tela)
  })

  it('a tela da pessoa: sem aviso para quem bate pela ficha; "Esta conta não bate ponto", com o caminho da ficha, para quem não pode', async () => {
    entrarComo('admin', bancoDoPonto())
    const caio = await abrir(`/painel/${CAIO.id}`)
    expect(caio.raiz.querySelector('h1')?.textContent).toBe('Caio Mendes')
    // "Se era para ter batido" é o vazio de quem pode bater; o aviso do topo sai
    // da mesma regra (`podeBater`), só para quem não pode.
    expect(caio.texto()).toContain('Se era para ter batido')
    conferirFumaca(caio)

    const antiga = await abrir(`/painel/${ANTIGA.id}`)
    expect(antiga.texto()).toContain(
      'Esta conta não bate ponto: sem uma ficha de RH ativa ligada a ela, o app não deixa bater. A ficha se liga em Administração, na lista de pessoas.',
    )
    conferirFumaca(antiga)
  })

  it('o estado vazio da tela da pessoa sem acesso diz que era de se esperar, e por quê', async () => {
    const banco = bancoDoPonto()
    entrarComo('admin', { ...banco, ponto_registros: banco.ponto_registros.filter((linha) => linha.usuario_id !== ANTIGA.id) })
    const tela = await abrir(`/painel/${ANTIGA.id}`)
    expect(tela.texto()).toContain('Era de se esperar: sem acesso ao ponto, o app não deixa bater.')
    conferirFumaca(tela)
  })

  it('com o banco vazio, o painel diz quem ele mostra e onde as fichas se ligam', async () => {
    entrarComo('admin', bancoVazio())
    const tela = await abrir('/painel')
    expect(tela.texto()).toContain('Ninguém do ponto em')
    expect(tela.texto()).toContain(
      'Esta lista mostra quem tem ficha de RH ligada a uma conta e quem bateu, teve ausência lançada ou pediu batida no período — as fichas se ligam em Administração, na lista de pessoas.',
    )
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* Corrigir qualquer dia                                               */
/* ------------------------------------------------------------------ */

describe('corrigir qualquer dia: todos os dias na tela da pessoa e "Corrigir ponto" na de bater', () => {
  /*
   * Agosto de 2026 fica inteiro no passado, e a URL o fixa: a contagem de 31
   * dias não depende da data em que o CI roda. A Ana bateu o dia 03 inteiro
   * (9h00) e só a entrada do dia 04 — dois dias com batida, um incompleto. O
   * simulado não aplica o filtro de período, por isso as batidas de hoje do
   * banco pequeno saem daqui.
   */
  function bancoDeAgosto(): Record<string, Linha[]> {
    const banco = bancoComDados()
    const em = (dia: string, hora: string, ordem: number, tipo: string): Linha => ({
      ...banco.ponto_registros[0],
      id: `ago-${dia}-${hora}`,
      registrado_em: `${dia}T${hora}:00.000-03:00`,
      dia_civil: dia,
      tipo,
      ordem_no_dia: ordem,
      selfie_path: `${ANA.id}/2026/08/ago-${dia}-${hora}.jpg`,
    })
    return {
      ...banco,
      ponto_registros: [
        em('2026-08-03', '08:00', 1, 'entrada'),
        em('2026-08-03', '12:00', 2, 'saida_almoco'),
        em('2026-08-03', '13:00', 3, 'volta_almoco'),
        em('2026-08-03', '18:00', 4, 'saida'),
        em('2026-08-04', '08:00', 1, 'entrada'),
      ],
    }
  }

  /** Os dias da lista, pela âncora `dia-AAAA-MM-DD`. */
  function diasDaLista(raiz: HTMLElement): HTMLElement[] {
    return [...raiz.querySelectorAll<HTMLElement>('li[id^="dia-"]')]
  }

  function diaDaLista(raiz: HTMLElement, dia: string): HTMLElement {
    const achado = raiz.querySelector<HTMLElement>(`#dia-${dia}`)
    expect(achado, `o dia ${dia} na lista`).not.toBeNull()
    return achado as HTMLElement
  }

  const textoDe = (elemento: Element) => (elemento.textContent ?? '').replace(/\s+/g, ' ')

  /** O texto do elemento, trecho por trecho e na ordem da tela: cada pedaço entre duas tags. */
  function trechosDe(elemento: Element): string[] {
    return elemento.innerHTML
      .split(/<[^>]+>/)
      .map((trecho) => trecho.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
      .filter((trecho) => trecho !== '')
  }

  function botaoCom(raiz: Element, trecho: string): HTMLButtonElement | undefined {
    return [...raiz.querySelectorAll('button')].find((botao) => (botao.textContent ?? '').includes(trecho))
  }

  /** Digita num campo controlado pelo React (input ou textarea). */
  async function digitar(seletor: string, valor: string) {
    const campo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(seletor)
    expect(campo, seletor).not.toBeNull()
    if (!campo) return
    const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototipo, 'value')?.set?.call(campo, valor)
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  /*
   * O jsdom não tem `scrollIntoView`. A tela chama com `?.()` (rolar é
   * conforto); aqui a função entra no protótipo para o teste saber para onde a
   * tela rolou, e sai no fim.
   */
  let rolados: string[] = []
  let doJsdom: PropertyDescriptor | undefined
  beforeEach(() => {
    rolados = []
    doJsdom = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Element.prototype.scrollIntoView = function (this: Element) {
      rolados.push(this.id)
    }
  })
  afterEach(() => {
    if (doJsdom) Object.defineProperty(Element.prototype, 'scrollIntoView', doJsdom)
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('agosto de 2026 aberto pela URL lista os 31 dias, e o topo continua contando só os dias com batida', async () => {
    entrarComo('admin', bancoDeAgosto())
    const tela = await abrir(`/painel/${ANA.id}?de=2026-08-01&ate=2026-08-31`)
    const dias = diasDaLista(tela.raiz)
    expect(dias).toHaveLength(31)
    expect(dias[0].id).toBe('dia-2026-08-01')
    expect(dias.at(-1)?.id).toBe('dia-2026-08-31')

    // O topo: dois dias com batida (não 31), um incompleto, 9h00.
    expect(tela.texto()).toContain('2 dias com batida')
    expect(tela.texto()).toContain('1 incompleto, fora do total')
    expect(tela.texto()).not.toContain('31 dias com batida')
    expect(tela.texto()).toContain('9h00')

    // Os 29 dias vazios são a linha compacta, cada um com as duas ações.
    expect(tela.texto().match(/Sem batida/g)).toHaveLength(29)
    const sabado = textoDe(diaDaLista(tela.raiz, '2026-08-01'))
    expect(sabado).toContain('Sem batida')
    expect(sabado).toContain('Inserir batida neste dia')
    expect(sabado).toContain('Lançar falta neste dia')

    // O fim de semana é sinalizado: agosto de 2026 tem 10 dias de sábado e domingo.
    expect(sabado).toContain('fim de semana')
    expect(dias.filter((dia) => textoDe(dia).includes('fim de semana'))).toHaveLength(10)
    expect(textoDe(diaDaLista(tela.raiz, '2026-08-03'))).not.toContain('fim de semana')

    // Todo dia de agosto (passado) tem o botão de inserir, inclusive os com batida. O
    // dia ímpar (04, só a entrada) tem o primário "Inserir a batida que falta".
    const temInserir = (dia: HTMLElement) =>
      textoDe(dia).includes('Inserir batida neste dia') || textoDe(dia).includes('Inserir a batida que falta')
    expect(dias.every(temInserir)).toBe(true)
    const diaImpar = textoDe(diaDaLista(tela.raiz, '2026-08-04'))
    expect(diaImpar).toContain('Inserir a batida que falta')
    expect(diaImpar).toContain('Única batida')
    expect(diaImpar).not.toContain('Inserir batida neste dia')
    // O dia completo, trecho por trecho: cada batida com a hora e o tipo que o
    // banco deu, na ordem do horário. No dia ímpar, o lugar do tipo é da
    // posição ("Única batida", acima).
    expect(trechosDe(diaDaLista(tela.raiz, '2026-08-03'))).toEqual([
      'Seg, 03 de ago',
      '4 batidas',
      '9h00',
      '08:00',
      'Entrada',
      'no local',
      'Corrigir',
      '12:00',
      'Almoço',
      'no local',
      'Corrigir',
      '13:00',
      'Volta',
      'no local',
      'Corrigir',
      '18:00',
      'Saída',
      'no local',
      'Corrigir',
      'Inserir batida neste dia',
    ])
    // Agosto não tem hoje: a tela não rola.
    expect(rolados).toEqual([])
    conferirFumaca(tela)
  })

  it('o mês corrente vai do dia 1 até hoje e abre rolado em hoje', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir(`/painel/${ANA.id}`)
    const ids = diasDaLista(tela.raiz).map((dia) => dia.id)
    expect(ids).toHaveLength(Number(hoje.slice(8, 10)))
    expect(ids[0]).toBe(`dia-${mes}-01`)
    expect(ids.at(-1)).toBe(`dia-${hoje}`)
    expect(rolados).toEqual([`dia-${hoje}`])
    conferirFumaca(tela)
  })

  it('nenhum dia depois de hoje tem o botão de inserir: o futuro só aparece com conteúdo, sem o botão', async () => {
    const banco = bancoComDados()
    const depois = somarDias(hoje, 2)
    entrarComo('admin', {
      ...banco,
      ponto_ausencias: [
        ...banco.ponto_ausencias,
        { ...banco.ponto_ausencias[0], id: 'au-adiante', dia_inicio: depois, dia_fim: depois, atestado_path: null },
      ],
    })
    const tela = await abrir(`/painel/${ANA.id}?de=${hoje}&ate=${somarDias(hoje, 5)}`)
    // Hoje (com a batida da Ana) e o dia da ausência lançada adiante; os futuros vazios, não.
    expect(diasDaLista(tela.raiz).map((dia) => dia.id)).toEqual([`dia-${hoje}`, `dia-${depois}`])
    expect(textoDe(diaDaLista(tela.raiz, hoje))).toContain('Inserir batida neste dia')
    const adiante = textoDe(diaDaLista(tela.raiz, depois))
    expect(adiante).toContain('sem horas')
    expect(adiante).not.toContain('Inserir batida neste dia')
    conferirFumaca(tela)
  })

  it('o dia só com ausência também tem "Inserir batida neste dia"', async () => {
    const banco = bancoDeAgosto()
    entrarComo('admin', {
      ...banco,
      ponto_ausencias: [{ ...banco.ponto_ausencias[0], dia_inicio: '2026-08-10', dia_fim: '2026-08-10' }],
    })
    const tela = await abrir(`/painel/${ANA.id}?de=2026-08-01&ate=2026-08-31`)
    const segunda = textoDe(diaDaLista(tela.raiz, '2026-08-10'))
    expect(segunda).toContain('sem horas')
    expect(segunda).toContain('Inserir batida neste dia')
    // O dia que já tem ausência não oferece lançar outra (o banco recusaria).
    expect(segunda).not.toContain('Lançar falta neste dia')
    expect(segunda).not.toContain('Sem batida')
    conferirFumaca(tela)
  })

  it('o feriado nacional aparece com a etiqueta "feriado", como o fim de semana', async () => {
    entrarComo('admin', bancoDeAgosto())
    // Setembro de 2026: a segunda 07/09 é a Independência; o sábado 05/09 é fim de semana.
    const tela = await abrir(`/painel/${ANA.id}?de=2026-09-01&ate=2026-09-30`)
    const feriado = textoDe(diaDaLista(tela.raiz, '2026-09-07'))
    expect(feriado).toContain('feriado · Independência do Brasil')
    expect(feriado).toContain('Sem batida')
    expect(feriado).not.toContain('fim de semana')
    const sabado = textoDe(diaDaLista(tela.raiz, '2026-09-05'))
    expect(sabado).toContain('fim de semana')
    expect(sabado).not.toContain('feriado')
    expect(textoDe(diaDaLista(tela.raiz, '2026-09-08'))).not.toContain('feriado')
    conferirFumaca(tela)
  })

  it('do sábado vazio, "Inserir batida neste dia" abre a caixa naquele dia, e dia futuro é recusado sem gravar', async () => {
    entrarComo('admin', bancoDeAgosto())
    const tela = await abrir(`/painel/${ANA.id}?de=2026-08-01&ate=2026-08-31`)
    await act(async () => {
      botaoCom(diaDaLista(tela.raiz, '2026-08-15'), 'Inserir batida neste dia')?.click()
    })
    const campoDoDia = document.querySelector<HTMLInputElement>('#ajuste-dia')
    expect(campoDoDia?.value).toBe('2026-08-15')
    expect(campoDoDia?.max).toBe(hoje)
    // A caixa diz como o dia se organiza: pelo horário.
    expect(tela.texto()).toContain('O sistema organiza entrada, almoço, volta e saída pelo horário')

    await digitar('#ajuste-dia', somarDias(hoje, 1))
    await digitar('#ajuste-hora', '08:00')
    await digitar('#ajuste-motivo', 'Esqueceu de bater a entrada.')
    await act(async () => {
      tela.raiz.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(tela.texto()).toContain('Esse dia ainda não chegou')
    conferirFumaca(tela)
  })

  it('"Lançar falta neste dia" abre a caixa de ausência já com a data', async () => {
    entrarComo('admin', bancoDeAgosto())
    const tela = await abrir(`/painel/${ANA.id}?de=2026-08-01&ate=2026-08-31`)
    await act(async () => {
      botaoCom(diaDaLista(tela.raiz, '2026-08-17'), 'Lançar falta neste dia')?.click()
    })
    expect(document.querySelector<HTMLInputElement>('#ausencia-inicio')?.value).toBe('2026-08-17')
    expect(document.querySelector<HTMLInputElement>('#ausencia-fim')?.value).toBe('2026-08-17')
    conferirFumaca(tela)
  })

  it('para quem administra, "Corrigir ponto" é o primeiro botão do conteúdo, antes de "Bater ponto", com os pedidos esperando', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/')
    const botoes = [...tela.raiz.querySelectorAll('main button')].map((botao) => textoDe(botao).trim())
    expect(botoes[0]).toBe('Corrigir ponto · 1 pedido esperando')
    // O botão de bater diz a batida prevista ("Bater entrada").
    expect(botoes.findIndex((rotulo) => /^Bater /.test(rotulo))).toBeGreaterThan(0)
    conferirFumaca(tela)

    // Leva direto à lista de pessoas do mês.
    await act(async () => {
      botaoCom(tela.raiz, 'Corrigir ponto')?.click()
    })
    await assentar()
    expect(tela.caminho()).toBe('/painel')
    expect(tela.texto()).toContain('Fechamento do período')
    conferirFumaca(tela)
  })

  it('sem pedido esperando, o botão diz só "Corrigir ponto"', async () => {
    entrarComo('admin', bancoVazio())
    const tela = await abrir('/')
    expect(textoDe(tela.raiz.querySelector('main button') as Element).trim()).toBe('Corrigir ponto')
    conferirFumaca(tela)
  })

  it('para o colaborador, "Corrigir ponto" não aparece', async () => {
    entrarComo('colaborador', bancoComDados())
    const tela = await abrir('/')
    expect(botaoCom(tela.raiz, 'Corrigir ponto')).toBeUndefined()
    expect(textoDe(tela.raiz.querySelector('main button') as Element)).toContain('Bater ponto')
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* Corrigir o ponto da pessoa sem errar                                */
/* ------------------------------------------------------------------ */

describe('corrigir sem errar: a caixa de inserir, o teclado e o recado', () => {
  /*
   * Outubro de 2026 aberto pela URL, com a sexta 16/10 da Ana em três batidas
   * (08:00, 12:00 e 17:00): faltou a volta do almoço. O simulado não aplica o
   * filtro de período, por isso as batidas de hoje do banco pequeno saem daqui.
   */
  function bancoDeOutubro(): Record<string, Linha[]> {
    const banco = bancoComDados()
    const em = (hora: string, ordem: number, tipo: string): Linha => ({
      ...banco.ponto_registros[0],
      id: `out-16-${hora}`,
      registrado_em: `2026-10-16T${hora}:00.000-03:00`,
      dia_civil: '2026-10-16',
      tipo,
      ordem_no_dia: ordem,
      selfie_path: `${ANA.id}/2026/10/out-16-${hora}.jpg`,
    })
    return {
      ...banco,
      ponto_registros: [em('08:00', 1, 'entrada'), em('12:00', 2, 'saida_almoco'), em('17:00', 3, 'volta_almoco')],
    }
  }
  const OUTUBRO = `/painel/${ANA.id}?de=2026-10-01&ate=2026-10-31`

  const textoDe = (elemento: Element | null) => (elemento?.textContent ?? '').replace(/\s+/g, ' ')

  function botaoCom(raiz: Element, trecho: string): HTMLButtonElement | undefined {
    return [...raiz.querySelectorAll('button')].find((botao) => (botao.textContent ?? '').includes(trecho))
  }

  function diaDaLista(raiz: HTMLElement, dia: string): HTMLElement {
    const achado = raiz.querySelector<HTMLElement>(`#dia-${dia}`)
    expect(achado, `o dia ${dia} na lista`).not.toBeNull()
    return achado as HTMLElement
  }

  const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]')
  /** O texto de todas as regiões de status da página (o recado é uma delas). */
  const recados = () => [...document.querySelectorAll('[role="status"]')].map(textoDe).join(' | ')

  async function digitar(seletor: string, valor: string) {
    const campo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(seletor)
    expect(campo, seletor).not.toBeNull()
    if (!campo) return
    const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototipo, 'value')?.set?.call(campo, valor)
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function clicar(botao: HTMLElement | undefined) {
    expect(botao).toBeDefined()
    await act(async () => {
      botao?.focus()
      botao?.click()
    })
  }

  async function teclarEsc() {
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
  }

  /*
   * O jsdom não tem `matchMedia` nem `scrollIntoView`. Sem `matchMedia`, o
   * diálogo trata o aparelho como de toque; `comMouse()` responde
   * `(pointer: fine)`. O `scrollIntoView` anota para onde a tela rolou.
   */
  function comMouse() {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (consulta: string) => ({
        matches: consulta === '(pointer: fine)',
        media: consulta,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
  let rolados: string[] = []
  let doJsdom: PropertyDescriptor | undefined
  beforeEach(() => {
    rolados = []
    doJsdom = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Element.prototype.scrollIntoView = function (this: Element) {
      rolados.push(this.id)
    }
  })
  afterEach(() => {
    if (doJsdom) Object.defineProperty(Element.prototype, 'scrollIntoView', doJsdom)
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('o dia ímpar orienta, e a linha fixa acima da lista diz onde fica cada ação', async () => {
    entrarComo('admin', bancoDeOutubro())
    const tela = await abrir(OUTUBRO)
    expect(tela.texto()).toContain('Para mudar um horário, use “Corrigir” ao lado dele.')
    const dia16 = textoDe(diaDaLista(tela.raiz, '2026-10-16'))
    expect(dia16).toContain('Falta 1 batida neste dia')
    expect(dia16).toContain('3ª batida (última)')
    expect(dia16.match(/Corrigir/g)).toHaveLength(3)
    // O botão da linha é um só: o "Corrigir" é rótulo dentro dele.
    const linhas = [...diaDaLista(tela.raiz, '2026-10-16').querySelectorAll('li')]
    expect(linhas.every((linha) => linha.querySelectorAll('button button').length === 0)).toBe(true)
    conferirFumaca(tela)
  })

  it('com mouse, "Inserir a batida que falta" abre a caixa com o foco na Hora; Esc fecha e o foco volta ao botão', async () => {
    comMouse()
    entrarComo('admin', bancoDeOutubro())
    const tela = await abrir(OUTUBRO)
    const botao = botaoCom(diaDaLista(tela.raiz, '2026-10-16'), 'Inserir a batida que falta')
    await clicar(botao)

    expect(dialogo()).not.toBeNull()
    expect(document.activeElement?.id).toBe('ajuste-hora')
    expect(textoDe(dialogo())).toContain('Sexta-feira, 16 de outubro')
    expect(textoDe(dialogo())).toContain('Já registradas neste dia: 08:00 · 12:00 · 17:00')

    await teclarEsc()
    expect(dialogo()).toBeNull()
    expect(document.activeElement).toBe(botao)
    conferirFumaca(tela)
  })

  it('no toque, o foco vai ao título da caixa, e não ao campo de hora (a roda do iOS cobriria a caixa)', async () => {
    entrarComo('admin', bancoDeOutubro())
    const tela = await abrir(OUTUBRO)
    await clicar(botaoCom(diaDaLista(tela.raiz, '2026-10-16'), 'Inserir a batida que falta'))
    expect(document.activeElement?.tagName).toBe('H2')
    expect(textoDe(document.activeElement)).toContain('Ana Souza')
    conferirFumaca(tela)
  })

  it('inserir 13:00: a prévia e o botão dizem o que vai acontecer; depois, a lista fica, o recado conta e a tela vai ao dia', async () => {
    comMouse()
    entrarComo('admin', bancoDeOutubro())
    simulado.estado.aceitarEscritas = true
    const tela = await abrir(OUTUBRO)
    await clicar(botaoCom(diaDaLista(tela.raiz, '2026-10-16'), 'Inserir a batida que falta'))
    await digitar('#ajuste-hora', '13:00')
    expect(textoDe(dialogo())).toContain(
      'Depois de inserir: 08:00 Entrada · 12:00 Almoço · 13:00 Volta · 17:00 Saída — o dia fica completo e soma 8h00.',
    )
    await digitar('#ajuste-motivo', 'Esqueceu de bater a volta do almoço.')
    const inserir = botaoCom(dialogo() as HTMLElement, 'Inserir 13:00 em sex., 16/10')
    expect(inserir?.type).toBe('submit')

    // A releitura fica presa: o que está na tela agora é o que o RH vê enquanto ela não chega.
    let soltar = () => {}
    simulado.estado.segurarLeituras = new Promise<void>((resolver) => {
      soltar = resolver
    })
    rolados = []
    await clicar(inserir)
    await assentar()

    expect(simulado.estado.aceitas).toEqual(['insert em ponto_registros'])
    expect(dialogo()).toBeNull()
    expect(tela.raiz.querySelector('#dia-2026-10-16'), 'a lista continua na tela').not.toBeNull()
    expect(tela.texto()).not.toContain('Carregando…')
    expect(tela.texto()).toContain('Atualizando…')
    expect(recados()).toContain('Batida das 13:00 inserida em sex., 16/10.')
    expect(rolados, 'a tela espera a releitura para rolar').toEqual([])

    soltar()
    await assentar()
    expect(tela.texto()).not.toContain('Atualizando…')
    expect(recados()).toContain('Batida das 13:00 inserida em sex., 16/10. O dia agora soma 8h00.')
    const dia16 = textoDe(diaDaLista(tela.raiz, '2026-10-16'))
    expect(dia16.match(/Corrigir/g)).toHaveLength(4)
    expect(dia16).toContain('8h00')
    expect(dia16).not.toContain('Falta 1 batida')
    expect(rolados).toEqual(['dia-2026-10-16'])
    expect(botaoCom(tela.raiz, 'Ver o dia')).toBeDefined()
    conferirFumaca(tela)
  })

  it('"Inserir e continuar": a caixa fica no mesmo dia, com o motivo, a hora limpa e a batida nova entre as registradas', async () => {
    comMouse()
    entrarComo('admin', bancoDeOutubro())
    simulado.estado.aceitarEscritas = true
    const tela = await abrir(OUTUBRO)
    await clicar(botaoCom(diaDaLista(tela.raiz, '2026-10-17'), 'Inserir batida neste dia'))
    expect(textoDe(dialogo())).toContain('Nenhuma batida neste dia ainda.')

    await digitar('#ajuste-hora', '08:00')
    expect(textoDe(dialogo())).toContain('o dia fica com 1 batida e só soma horas quando tiver a 2ª.')
    await digitar('#ajuste-motivo', 'Trabalhou no sábado: evento da empresa.')
    await clicar(botaoCom(dialogo() as HTMLElement, 'Inserir e continuar'))
    await assentar()

    expect(dialogo(), 'a caixa continua aberta').not.toBeNull()
    expect(document.querySelector<HTMLInputElement>('#ajuste-hora')?.value).toBe('')
    expect(document.querySelector<HTMLTextAreaElement>('#ajuste-motivo')?.value).toBe(
      'Trabalhou no sábado: evento da empresa.',
    )
    expect(document.activeElement?.id).toBe('ajuste-hora')
    expect(textoDe(dialogo())).toContain('Já registradas neste dia: 08:00')
    expect(textoDe(dialogo())).toContain('Batida das 08:00 inserida em sáb., 17/10.')
    expect(botaoCom(dialogo() as HTMLElement, 'Concluir')).toBeDefined()

    await digitar('#ajuste-hora', '12:00')
    expect(textoDe(dialogo())).toContain(
      'Depois de inserir: 08:00 Entrada · 12:00 Almoço — o dia fica completo e soma 4h00.',
    )
    await clicar(botaoCom(dialogo() as HTMLElement, 'Inserir e continuar'))
    await assentar()
    expect(textoDe(dialogo())).toContain('Já registradas neste dia: 08:00 · 12:00')
    // A tela não rola por trás da caixa aberta: espera o "Concluir".
    expect(rolados).not.toContain('dia-2026-10-17')

    await clicar(botaoCom(dialogo() as HTMLElement, 'Concluir'))
    await assentar()
    expect(dialogo()).toBeNull()
    expect(simulado.estado.aceitas).toEqual(['insert em ponto_registros', 'insert em ponto_registros'])
    expect(recados()).toContain('Batida das 12:00 inserida em sáb., 17/10. O dia agora soma 4h00.')
    expect(rolados.at(-1)).toBe('dia-2026-10-17')
    expect(textoDe(diaDaLista(tela.raiz, '2026-10-17'))).toContain('4h00')
    conferirFumaca(tela)
  })

  it('o motivo em branco é recusado com a frase sem jargão, e nada é gravado', async () => {
    comMouse()
    entrarComo('admin', bancoDeOutubro())
    simulado.estado.aceitarEscritas = true
    const tela = await abrir(OUTUBRO)
    await clicar(botaoCom(diaDaLista(tela.raiz, '2026-10-16'), 'Inserir a batida que falta'))
    await digitar('#ajuste-hora', '13:00')
    await clicar(botaoCom(dialogo() as HTMLElement, 'Inserir e continuar'))
    expect(textoDe(dialogo())).toContain('Escreva o motivo: ele é obrigatório e fica guardado com o seu nome.')
    expect(textoDe(dialogo())).not.toContain('banco')
    expect(simulado.estado.aceitas).toEqual([])
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* Fechar o mês sem surpresa e achar o caminho                         */
/* ------------------------------------------------------------------ */

describe('fechar o mês sem surpresa e achar o caminho', () => {
  /*
   * Outubro de 2026 aberto pela URL. A Ana tem a quinta 15/10 completa e a
   * sexta 16/10 em três batidas (faltou a volta do almoço), e pediu a batida
   * das 13:05 do dia 16; a conta do Bruno tem um pedido do dia 14, às 09:40.
   * O CNPJ da empresa está em branco (o banco pequeno). As datas são fixas: o
   * simulado não aplica o filtro de período, e o resultado não pode depender do
   * dia em que o CI roda.
   */
  function bancoDoFechamento(): Record<string, Linha[]> {
    const banco = bancoComDados()
    const em = (dia: string, hora: string, ordem: number, tipo: string): Linha => ({
      ...banco.ponto_registros[0],
      id: `fech-${dia}-${hora}`,
      registrado_em: `${dia}T${hora}:00.000-03:00`,
      dia_civil: dia,
      tipo,
      ordem_no_dia: ordem,
      selfie_path: `${ANA.id}/2026/10/fech-${dia}-${hora}.jpg`,
    })
    const pedido = banco.ponto_pedidos_atraso[0]
    return {
      ...banco,
      ponto_registros: [
        em('2026-10-15', '08:00', 1, 'entrada'),
        em('2026-10-15', '12:00', 2, 'saida_almoco'),
        em('2026-10-15', '13:00', 3, 'volta_almoco'),
        em('2026-10-15', '17:00', 4, 'saida'),
        em('2026-10-16', '08:00', 1, 'entrada'),
        em('2026-10-16', '12:00', 2, 'saida_almoco'),
        em('2026-10-16', '17:00', 3, 'volta_almoco'),
      ],
      ponto_pedidos_atraso: [
        {
          ...pedido,
          id: 'pa-16',
          horario_declarado: '2026-10-16T13:05:00.000-03:00',
          dia_civil: '2026-10-16',
          pedido_em: '2026-10-16T17:30:00.000-03:00',
          motivo: 'Voltei do almoço e esqueci de bater.',
        },
        {
          ...pedido,
          id: 'pa-bruno',
          usuario_id: BRUNO.id,
          horario_declarado: '2026-10-14T09:40:00.000-03:00',
          dia_civil: '2026-10-14',
          pedido_em: '2026-10-14T11:00:00.000-03:00',
          selfie_path: `${BRUNO.id}/2026/10/pa-bruno.jpg`,
          funcionario_nome: 'Bruno Lima',
          funcionario_email: BRUNO.email,
        },
      ],
    }
  }

  /** O mesmo outubro, sem pendência nenhuma: só o dia 15 completo, sem pedido, com o cabeçalho inteiro. */
  function bancoSemPendencia(): Record<string, Linha[]> {
    const banco = bancoDoFechamento()
    return {
      ...banco,
      ponto_registros: banco.ponto_registros.filter((linha) => linha.dia_civil === '2026-10-15'),
      ponto_pedidos_atraso: [],
      ponto_configuracao: [{ ...banco.ponto_configuracao[0], cnpj: '11222333000181' }],
    }
  }

  const OUTUBRO_NO_PAINEL = '/painel?de=2026-10-01&ate=2026-10-31'
  const OUTUBRO_DA_ANA = `/painel/${ANA.id}?de=2026-10-01&ate=2026-10-31`
  const FOLHA_DE_OUTUBRO = `/folha/${ANA.id}?mes=2026-10&imprimir=1`

  const textoDe = (elemento: Element | null | undefined) => (elemento?.textContent ?? '').replace(/\s+/g, ' ')

  function botaoCom(raiz: Element, trecho: string): HTMLButtonElement | undefined {
    return [...raiz.querySelectorAll('button')].find((botao) => (botao.textContent ?? '').includes(trecho))
  }

  async function clicar(botao: HTMLElement | null | undefined) {
    expect(botao).toBeDefined()
    expect(botao).not.toBeNull()
    await act(async () => {
      botao?.click()
    })
    await assentar()
  }

  const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const recados = () => [...document.querySelectorAll('[role="status"]')].map(textoDe).join(' | ')

  let rolados: string[] = []
  let doJsdom: PropertyDescriptor | undefined
  beforeEach(() => {
    rolados = []
    doJsdom = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Element.prototype.scrollIntoView = function (this: Element) {
      rolados.push(this.id)
    }
  })
  afterEach(() => {
    if (doJsdom) Object.defineProperty(Element.prototype, 'scrollIntoView', doJsdom)
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  /* ---------------- O painel ---------------- */

  it('/painel: "Antes de fechar" lista os pedidos, o dia ímpar com o link para o dia e o cabeçalho', async () => {
    entrarComo('admin', bancoDoFechamento())
    const tela = await abrir(OUTUBRO_NO_PAINEL)
    const bloco = textoDe(document.getElementById('antes-de-fechar')?.closest('section'))
    expect(bloco).toContain('Antes de fechar outubro de 2026')
    expect(bloco).toContain('2 pedidos de batida em atraso esperando decisão')
    expect(bloco).toContain('Ana Souza · sex., 16/10 · falta 1 batida')
    expect(bloco).toContain('Cabeçalho da folha sem CNPJ')

    const links = [...tela.raiz.querySelectorAll('#antes-de-fechar ~ ul a')].map((link) => link.getAttribute('href') ?? '')
    expect(links).toContain('#pendencias-de-atraso')
    expect(links.some((href) => href.includes('#dia-'))).toBe(true)
    expect(links).toContain(`/painel/${ANA.id}?de=2026-10-01&ate=2026-10-31#dia-2026-10-16`)
    expect(links).toContain('/administracao#secao-empresa')
    // O pedido não é o dia: a frase de nada pendente não aparece.
    expect(bloco).not.toContain('Nenhum dia incompleto')
    conferirFumaca(tela)
  })

  it('/painel: a caixa de pendências vem antes do período, e o cartão mostra como o dia fica com a aprovação', async () => {
    entrarComo('admin', bancoDoFechamento())
    const tela = await abrir(OUTUBRO_NO_PAINEL)
    const pendencias = document.getElementById('pendencias-de-atraso')
    const periodo = tela.raiz.querySelector('[aria-label="Escolha do período"]')
    expect(pendencias).not.toBeNull()
    expect(periodo).not.toBeNull()
    if (pendencias && periodo) {
      expect(pendencias.compareDocumentPosition(periodo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const cartao = textoDe(document.getElementById('pedido-pa-16'))
    expect(cartao).toContain('Neste dia já tem: 08:00 · 12:00 · 17:00 (dia incompleto)')
    expect(cartao).toContain('Com a aprovação: 4 batidas, 7h55.')
    // O texto do CSV manda somar a coluna que soma, e é a única coluna que a tela nomeia.
    expect(tela.texto()).toContain(
      'Uma linha por batida e uma por dia de ausência. Para somar as horas no Excel, use a coluna “Horas do dia (decimal)” — ela dá o total direto.',
    )
    expect(tela.texto().match(/coluna “[^”]*”/g)).toEqual(['coluna “Horas do dia (decimal)”'])
    conferirFumaca(tela)
  })

  it('/painel sem pendência: a frase diz o que foi conferido, sem prometer "tudo certo"', async () => {
    entrarComo('admin', bancoSemPendencia())
    const tela = await abrir(OUTUBRO_NO_PAINEL)
    const bloco = textoDe(document.getElementById('antes-de-fechar')?.closest('section'))
    expect(bloco).toContain(
      'Nenhum dia incompleto e nenhum pedido esperando em outubro de 2026. Dias sem nenhuma batida não entram nesta conferência.',
    )
    expect(tela.raiz.querySelectorAll('#antes-de-fechar ~ ul li')).toHaveLength(0)
    expect(tela.texto()).toContain('Nenhum pedido esperando decisão. Quando alguém pedir uma batida em atraso, ela aparece aqui.')
    conferirFumaca(tela)
  })

  /* ---------------- A folha ---------------- */

  it('/folha com ?imprimir=1 e dia ímpar: a impressão NÃO é chamada, e os avisos aparecem com os links', async () => {
    // O jsdom não imprime e reclama no console: o espião entra ANTES de montar.
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {})
    entrarComo('admin', bancoDoFechamento())
    const tela = await abrir(FOLHA_DE_OUTUBRO)
    expect(imprimir).toHaveBeenCalledTimes(0)
    expect(tela.texto()).toContain('Atenção: 1 dia incompleto (16/10) sai como zero nesta folha.')
    expect(tela.texto()).toContain('1 pedido de batida em atraso desta pessoa ainda espera decisão.')
    expect(tela.texto()).toContain('Cabeçalho da folha sem CNPJ: esse campo sai em branco.')
    const destinos = [...tela.raiz.querySelectorAll('section[aria-labelledby="antes-de-imprimir"] a')].map(
      (link) => `${textoDe(link)} → ${link.getAttribute('href')}`,
    )
    expect(destinos).toEqual([
      `Corrigir 16/10 → /painel/${ANA.id}?de=2026-10-01&ate=2026-10-31#dia-2026-10-16`,
      `Decidir → /painel/${ANA.id}?de=2026-10-01&ate=2026-10-31#pedidos-esperando`,
      'Preencher → /administracao#secao-empresa',
    ])
    // O pedido de impressão sai da URL do mesmo jeito: um F5 não reabre nada.
    expect(window.location.search).toBe('?mes=2026-10')
    conferirFumaca(tela)
  })

  it('/folha com ?imprimir=1 sem pendência: a impressão abre sozinha, uma vez', async () => {
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {})
    entrarComo('admin', bancoSemPendencia())
    const tela = await abrir(FOLHA_DE_OUTUBRO)
    expect(imprimir).toHaveBeenCalledTimes(1)
    expect(tela.raiz.querySelector('#antes-de-imprimir')).toBeNull()
    conferirFumaca(tela)
  })

  it('"Voltar" da folha leva à pessoa no mesmo mês, e não no corrente', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
    entrarComo('admin', bancoSemPendencia())
    const tela = await abrir(`/folha/${ANA.id}?mes=2026-09`)
    const voltar = botaoCom(tela.raiz, 'Voltar para')
    expect(textoDe(voltar).trim()).toBe('Voltar para Ana · setembro de 2026')
    await clicar(voltar)
    expect(tela.caminho()).toBe(`/painel/${ANA.id}`)
    expect(window.location.search).toBe('?de=2026-09-01&ate=2026-09-30')
    expect(tela.texto()).toContain('Setembro de 2026')
    conferirFumaca(tela)
  })

  /* ---------------- A tela da pessoa ---------------- */

  it('/painel/:id: só o pedido desta pessoa, com o dia dele dizendo "Pedido esperando decisão"', async () => {
    entrarComo('admin', bancoDoFechamento())
    const tela = await abrir(OUTUBRO_DA_ANA)
    expect(tela.texto()).toContain('Pedidos de batida em atraso de Ana esperando decisão (1)')
    expect(tela.texto()).toContain('esperando decisão (1)')
    // O pedido do Bruno (09:40 do dia 14) não é desta tela.
    expect(tela.texto()).not.toContain('09:40')
    expect(document.getElementById('pedido-pa-bruno')).toBeNull()

    const dia16 = tela.raiz.querySelector<HTMLElement>('#dia-2026-10-16')
    expect(textoDe(dia16)).toContain('Pedido esperando decisão: 13:05')
    // No dia com pedido, o caminho é decidir, e não inserir: o botão primário sai.
    expect(textoDe(dia16)).toContain('decida o pedido em vez de inserir')
    expect(textoDe(dia16)).not.toContain('Inserir a batida que falta')

    // "Decidir", no dia, leva ao cartão do pedido, na seção de cima.
    rolados = []
    await clicar(botaoCom(dia16 as HTMLElement, 'Decidir'))
    expect(rolados).toEqual(['pedido-pa-16'])
    expect(document.activeElement?.id).toBe('pedido-pa-16')
    conferirFumaca(tela)
  })

  it('a caixa de inserir avisa quando o dia já tem pedido esperando; o dia sem pedido, não', async () => {
    entrarComo('admin', bancoDoFechamento())
    const tela = await abrir(OUTUBRO_DA_ANA)
    await clicar(botaoCom(tela.raiz.querySelector('#dia-2026-10-16') as HTMLElement, 'Inserir batida neste dia'))
    expect(textoDe(dialogo())).toContain('Ana Souza já pediu a batida das 13:05 deste dia. Aprove o pedido em vez de inserir.')
    await clicar(botaoCom(dialogo() as HTMLElement, 'Cancelar'))
    expect(dialogo()).toBeNull()

    await clicar(botaoCom(tela.raiz.querySelector('#dia-2026-10-15') as HTMLElement, 'Inserir batida neste dia'))
    expect(textoDe(dialogo())).not.toContain('já pediu')
    conferirFumaca(tela)
  })

  it('o link do "Antes de fechar" abre a tela da pessoa já no dia, destacado (e não em hoje)', async () => {
    entrarComo('admin', bancoDoFechamento())
    const tela = await abrir(`${OUTUBRO_DA_ANA}#dia-2026-10-16`)
    expect(rolados).toEqual(['dia-2026-10-16'])
    expect(tela.raiz.querySelector('#dia-2026-10-16')?.className).toContain('ring-2')
    conferirFumaca(tela)
  })

  it('aprovar o pedido na tela da pessoa: o recado conta, a tela relê e o dia fecha', async () => {
    entrarComo('admin', bancoDoFechamento())
    simulado.estado.rpcs.ponto_decidir_pedido_atraso = () => {
      const tabelas = simulado.estado.tabelas
      tabelas.ponto_pedidos_atraso = tabelas.ponto_pedidos_atraso.map((linha) =>
        linha.id === 'pa-16' ? { ...linha, estado: 'aprovado', decidido_por: ADMIN.id, decidido_em: agora, registro_id: 'fech-aprovada' } : linha,
      )
      tabelas.ponto_registros = [
        ...tabelas.ponto_registros,
        {
          ...tabelas.ponto_registros[0],
          id: 'fech-aprovada',
          registrado_em: '2026-10-16T13:05:00.000-03:00',
          dia_civil: '2026-10-16',
          ajuste_manual: true,
          origem: 'ajuste_admin',
          motivo_ajuste: 'Batida em atraso aprovada',
          pedido_atraso_id: 'pa-16',
        },
      ]
      return { decidido: true, estado: 'aprovado', pedido: { id: 'pa-16' }, registro: { id: 'fech-aprovada' } }
    }
    const tela = await abrir(OUTUBRO_DA_ANA)
    await clicar(botaoCom(document.getElementById('pedido-pa-16') as HTMLElement, 'Aprovar'))
    expect(textoDe(dialogo())).toContain('Aprovar batida em atraso')
    await clicar(botaoCom(dialogo() as HTMLElement, 'Aprovar'))

    expect(dialogo()).toBeNull()
    expect(simulado.estado.chamadas).toContain('ponto_decidir_pedido_atraso')
    expect(recados()).toContain('Pedido das 13:05 aprovado: a batida entrou em sex., 16/10. O dia agora soma 7h55.')
    // Sem pedido pendente, a seção some; o dia 16 fecha e soma.
    expect(tela.texto()).not.toContain('esperando decisão (')
    const dia16 = textoDe(tela.raiz.querySelector('#dia-2026-10-16'))
    expect(dia16).toContain('7h55')
    expect(dia16).not.toContain('Pedido esperando decisão')
    conferirFumaca(tela)
  })

  /* ---------------- A Administração ---------------- */

  /** O `li` da lista de pessoas com o texto `trecho`. */
  function linhaDe(raiz: HTMLElement, trecho: string): HTMLElement | undefined {
    return [...raiz.querySelectorAll<HTMLElement>('#secao-pessoas li')].find((item) =>
      (item.textContent ?? '').includes(trecho),
    )
  }

  async function abrirALinha(raiz: HTMLElement, trecho: string): Promise<HTMLElement> {
    const linha = linhaDe(raiz, trecho)
    await clicar(linha?.querySelector<HTMLButtonElement>(':scope > button'))
    return linhaDe(raiz, trecho) as HTMLElement
  }

  it('na linha aberta, o ponto e a folha vêm antes de "Conta"; o cabeçalho fechado não ganha outro link', async () => {
    entrarComo('admin', bancoComDados())
    const tela = await abrir('/administracao')
    const fechada = linhaDe(tela.raiz, ANA.email)
    expect(fechada?.querySelectorAll('a')).toHaveLength(0)

    const aberta = await abrirALinha(tela.raiz, ANA.email)
    const texto = textoDe(aberta)
    const ponto = texto.indexOf('Ver e corrigir o ponto de Ana')
    const folha = texto.indexOf('Imprimir a folha de')
    const conta = texto.indexOf('Conta')
    expect(ponto).toBeGreaterThan(-1)
    expect(folha).toBeGreaterThan(ponto)
    expect(conta).toBeGreaterThan(folha)
    conferirFumaca(tela)
  })

  it('quem administra sem ser super admin lê quem resolve: "só Sérgio", com o nome tirado da lista', async () => {
    entrarComo('admin-sem-ficha', bancoComDados())
    const tela = await abrir('/administracao')
    expect(tela.texto()).toContain('criar login, trocar e-mail e dar acesso é com Sérgio.')
    const aberta = await abrirALinha(tela.raiz, ANA.email)
    expect(textoDe(aberta)).toContain('Trocar e-mail, criar nova senha e liberar o acesso: só Sérgio faz.')
    expect(textoDe(aberta)).toContain('Dar ou tirar a administração: só Sérgio.')
    expect(textoDe(aberta)).not.toMatch(/Sérgio ou Sérgio|admin2@/)
    conferirFumaca(tela)
  })

  it('depois de "Resetar PIN", a lista não some: "Atualizando…", a linha continua aberta e o recado conta', async () => {
    entrarComo('admin', bancoComDados())
    simulado.estado.rpcs.ponto_resetar_pin = () => ({
      resetado: true,
      usuario_id: ANA.id,
      tinha_pin: true,
      resetado_em: agora,
    })
    const tela = await abrir('/administracao')
    const aberta = await abrirALinha(tela.raiz, ANA.email)
    await clicar(botaoCom(aberta, 'Resetar PIN'))
    expect(textoDe(dialogo())).toContain('Resetar o PIN')

    // A releitura fica presa: o que está na tela agora é o que o RH vê enquanto ela não chega.
    let soltar = () => {}
    simulado.estado.segurarLeituras = new Promise<void>((resolver) => {
      soltar = resolver
    })
    await clicar(botaoCom(dialogo() as HTMLElement, 'Resetar o PIN'))
    expect(dialogo()).toBeNull()
    expect(simulado.estado.chamadas).toContain('ponto_resetar_pin')
    expect(tela.texto()).not.toContain('Carregando as pessoas')
    expect(tela.texto()).toContain('Atualizando…')
    expect(textoDe(linhaDe(tela.raiz, ANA.email))).toContain('Ver e corrigir o ponto de Ana')
    expect(recados()).toContain('PIN resetado. Na próxima entrada, Ana Souza define um PIN novo.')

    soltar()
    await assentar()
    expect(tela.texto()).not.toContain('Atualizando…')
    expect(textoDe(linhaDe(tela.raiz, ANA.email))).toContain('Ver e corrigir o ponto de Ana')
    expect(recados()).toContain('PIN resetado.')
    conferirFumaca(tela)
  })
})

describe('o diálogo compartilhado cuida do teclado', () => {
  async function montar(elemento: ReturnType<typeof createElement>) {
    const raiz = document.createElement('div')
    document.body.appendChild(raiz)
    const root = createRoot(raiz)
    montadas.push({ root, raiz })
    await act(async () => {
      root.render(elemento)
    })
    return { raiz, root }
  }

  function caixaDeTeste(props: { aoFechar: () => void; podeFechar?: boolean; temAlteracao?: boolean }) {
    return createElement(Modal, {
      rotulo: 'Caixa de teste',
      ...props,
      children: createElement(
        Fragment,
        null,
        createElement('h2', null, 'Título da caixa'),
        createElement('button', { type: 'button', id: 'primeiro' }, 'Primeiro'),
        createElement('button', { type: 'button', id: 'ultimo' }, 'Último'),
      ),
    })
  }

  async function teclar(tecla: string, shiftKey = false) {
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: tecla, shiftKey, bubbles: true, cancelable: true }))
    })
  }

  it('Esc fecha; com podeFechar={false} (uma gravação em andamento), não fecha', async () => {
    const fechou = vi.fn()
    const { root } = await montar(caixaDeTeste({ aoFechar: fechou }))
    await teclar('Escape')
    expect(fechou).toHaveBeenCalledTimes(1)

    const naoFecha = vi.fn()
    await act(async () => {
      root.render(caixaDeTeste({ aoFechar: naoFecha, podeFechar: false }))
    })
    await teclar('Escape')
    expect(naoFecha).not.toHaveBeenCalled()
    expect(console_).toEqual([])
  })

  it('Tab e Shift+Tab dão a volta dentro da caixa', async () => {
    await montar(caixaDeTeste({ aoFechar: () => {} }))
    document.getElementById('ultimo')?.focus()
    await teclar('Tab')
    expect(document.activeElement?.id).toBe('primeiro')
    await teclar('Tab', true)
    expect(document.activeElement?.id).toBe('ultimo')
    expect(console_).toEqual([])
  })

  it('com texto digitado, o clique no fundo não fecha; sem texto, fecha', async () => {
    const fechou = vi.fn()
    const { raiz, root } = await montar(caixaDeTeste({ aoFechar: fechou, temAlteracao: true }))
    const fundo = () => raiz.querySelector<HTMLElement>('[role="dialog"] > div')
    await act(async () => {
      fundo()?.click()
    })
    expect(fechou).not.toHaveBeenCalled()

    await act(async () => {
      root.render(caixaDeTeste({ aoFechar: fechou, temAlteracao: false }))
    })
    await act(async () => {
      fundo()?.click()
    })
    expect(fechou).toHaveBeenCalledTimes(1)
  })

  it('a caixa de cima é a que fecha: com duas abertas, o Esc leva só a última', async () => {
    const debaixo = vi.fn()
    const decima = vi.fn()
    await montar(caixaDeTeste({ aoFechar: debaixo }))
    await montar(caixaDeTeste({ aoFechar: decima }))
    await teclar('Escape')
    expect(decima).toHaveBeenCalledTimes(1)
    expect(debaixo).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* Bater no celular sem recomeçar nem levar susto                      */
/* ------------------------------------------------------------------ */

describe('bater no celular sem recomeçar nem levar susto', () => {
  const textoDe = (elemento: Element | null | undefined) => (elemento?.textContent ?? '').replace(/\s+/g, ' ')

  function botaoCom(raiz: Element, trecho: string): HTMLButtonElement | undefined {
    return [...raiz.querySelectorAll('button')].find((botao) => (botao.textContent ?? '').includes(trecho))
  }

  async function clicar(botao: HTMLElement | null | undefined) {
    expect(botao).toBeDefined()
    expect(botao).not.toBeNull()
    await act(async () => {
      botao?.click()
    })
    await assentar()
  }

  /** O botão grande de bater: o primeiro do conteúdo, para o colaborador. */
  const botaoDeBater = (raiz: HTMLElement) => raiz.querySelector<HTMLButtonElement>('main button')

  /**
   * As batidas de HOJE da Ana, nas horas dadas (com o tipo pela posição, como o
   * banco), sem pedido em atraso — a não ser que o caso peça.
   */
  function bancoDeHoje(horas: string[], comPedido = false): Record<string, Linha[]> {
    const banco = bancoComDados()
    const tipos = ['entrada', 'saida_almoco', 'volta_almoco', 'saida']
    return {
      ...banco,
      ponto_registros: horas.map((hora, indice) => ({
        ...banco.ponto_registros[0],
        id: `hoje-${indice + 1}`,
        registrado_em: `${hoje}T${hora}:00.000-03:00`,
        dia_civil: hoje,
        tipo: tipos[indice] ?? 'extra',
        ordem_no_dia: indice + 1,
      })),
      ponto_pedidos_atraso: comPedido ? banco.ponto_pedidos_atraso : [],
    }
  }

  /*
   * O que os casos mudam no navegador simulado volta ao normal no fim: a
   * conexão, a visibilidade, o GPS e o contexto seguro.
   */
  afterEach(() => {
    for (const [alvo, chave] of [
      [navigator, 'onLine'],
      [navigator, 'geolocation'],
      [document, 'visibilityState'],
      [window, 'isSecureContext'],
    ] as const) {
      if (Object.getOwnPropertyDescriptor(alvo, chave)?.configurable) delete (alvo as unknown as Record<string, unknown>)[chave]
    }
    camera.aberturas = 0
  })

  it('com 1 batida hoje, o botão diz "Bater saída para o almoço", "2ª de 4 hoje", e a lista diz de quando é', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02']))
    const tela = await abrir('/')
    const botao = textoDe(botaoDeBater(tela.raiz))
    expect(botao).toContain('Bater saída para o almoço')
    expect(botao).toContain('2ª de 4 hoje')
    expect(tela.texto()).toMatch(/Atualizado às \d{2}:\d{2}/)
    expect(tela.texto()).toContain('Esqueci de bater hoje')
    expect(tela.texto()).toContain('Esqueceu em outro dia? Avise o RH, que corrige pelo painel.')
    conferirFumaca(tela)
  })

  it('com pedido em atraso esperando, o botão diz só "Bater ponto", e a linha explica por quê', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02'], true))
    const tela = await abrir('/')
    expect(textoDe(botaoDeBater(tela.raiz))).toContain('Bater ponto')
    expect(tela.texto()).toContain('Você tem 1 pedido em atraso aguardando aprovação.')
    conferirFumaca(tela)
  })

  it('com 4 batidas, "Dia completo" e "Bater batida extra"; o toque pede confirmação, e "Voltar" volta', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02', '12:01', '13:00', '18:01']))
    const tela = await abrir('/')
    expect(tela.texto()).toContain('Dia completo')
    expect(tela.texto()).toContain('08:02 → 18:01 · 9h00')
    const botao = botaoCom(tela.raiz, 'Bater batida extra')
    expect(textoDe(botao)).toContain('Bater batida extra')
    expect(tela.texto()).toContain('Só se você voltou a trabalhar depois da saída.')
    conferirFumaca(tela)

    await clicar(botao)
    expect(tela.texto()).toContain('Você já fechou o dia')
    expect(tela.texto()).toContain('Suas 4 batidas de hoje já estão registradas (última às 18:01).')
    expect(botaoCom(tela.raiz, 'Bater mesmo assim')).toBeDefined()
    // A confirmação vem ANTES da câmera.
    expect(camera.aberturas).toBe(0)

    await clicar(botaoCom(tela.raiz, 'Voltar'))
    expect(tela.texto()).toContain('Dia completo')
    expect(camera.aberturas).toBe(0)

    // "Bater mesmo assim" segue o fluxo de sempre: a câmera abre.
    await clicar(botaoCom(tela.raiz, 'Bater batida extra'))
    await clicar(botaoCom(tela.raiz, 'Bater mesmo assim'))
    expect(camera.aberturas).toBe(1)
    conferirFumaca(tela)
  })

  it('sem internet, o aviso vem antes e o botão fica desabilitado; com a conexão de volta, tudo volta', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02']))
    const tela = await abrir('/')
    expect(botaoDeBater(tela.raiz)?.disabled).toBe(false)

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    await assentar()
    expect(tela.texto()).toContain(
      'Sem internet. A batida não acontece sem conexão, e nada fica guardado para depois.',
    )
    expect(botaoDeBater(tela.raiz)?.disabled).toBe(true)
    expect(textoDe(botaoDeBater(tela.raiz))).toContain('aguardando internet')
    expect(botaoCom(tela.raiz, 'Esqueci de bater hoje')?.disabled).toBe(true)

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await assentar()
    expect(tela.texto()).not.toContain('Sem internet')
    expect(botaoDeBater(tela.raiz)?.disabled).toBe(false)
    expect(textoDe(botaoDeBater(tela.raiz))).toContain('Bater saída para o almoço')
    // Nenhuma fila: nada foi gravado nem guardado.
    conferirFumaca(tela)
  })

  it('o app que volta a aparecer relê as batidas de hoje: a batida nova entra e o botão acompanha', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02']))
    const tela = await abrir('/')
    expect(textoDe(botaoDeBater(tela.raiz))).toContain('Bater saída para o almoço')

    // Outra batida chegou ao banco enquanto o app estava no fundo.
    const tabelas = simulado.estado.tabelas
    tabelas.ponto_registros = bancoDeHoje(['08:02', '12:01']).ponto_registros
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await assentar()

    expect(tela.texto()).toContain('12:01')
    expect(textoDe(botaoDeBater(tela.raiz))).toContain('Bater volta do almoço')
    expect(textoDe(botaoDeBater(tela.raiz))).toContain('3ª de 4 hoje')
    expect(tela.texto()).toMatch(/Atualizado às \d{2}:\d{2}/)
    conferirFumaca(tela)
  })

  it('o GPS que não responde não joga a selfie fora: "Tentar a localização de novo" vai direto ao PIN, sem abrir a câmera', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02']))
    const pedidos: PositionOptions[] = []
    const respostas: ({ falha: number } | { leitura: [number, number, number] })[] = [
      { falha: 2 },
      { leitura: [-23.56, -46.64, 120] },
    ]
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => true })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(sucesso: PositionCallback, falha: PositionErrorCallback, opcoes: PositionOptions) {
          pedidos.push(opcoes)
          const resposta = respostas.shift()
          if (resposta && 'leitura' in resposta) {
            const [latitude, longitude, accuracy] = resposta.leitura
            sucesso({ coords: { latitude, longitude, accuracy }, timestamp: 0 } as unknown as GeolocationPosition)
          } else {
            falha({ code: resposta?.falha ?? 3, message: 'duplê' } as unknown as GeolocationPositionError)
          }
        },
      },
    })

    const tela = await abrir('/')
    await clicar(botaoDeBater(tela.raiz))
    expect(camera.aberturas).toBe(1)
    await clicar(botaoCom(tela.raiz, 'Usar a foto do duplê'))

    expect(tela.texto()).toContain('Não achamos sua localização')
    expect(tela.texto()).toContain('O GPS não respondeu. Chegue perto de uma janela ou saia da sala e tente de novo.')
    expect(botaoCom(tela.raiz, 'Tirar outra foto')).toBeDefined()
    expect(botaoCom(tela.raiz, 'Cancelar')).toBeDefined()
    expect(pedidos).toEqual([{ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }])

    await clicar(botaoCom(tela.raiz, 'Tentar a localização de novo'))
    // A segunda tentativa é a rápida, e a câmera não abriu de novo.
    expect(pedidos[1]).toEqual({ enableHighAccuracy: false, timeout: 15_000, maximumAge: 0 })
    expect(tela.texto()).toContain('Confirme com seu PIN')
    expect(camera.aberturas).toBe(1)
    // Nada subiu nem foi gravado: a foto só sai depois do PIN.
    conferirFumaca(tela)
  })

  it('"Tirar outra foto" abre a câmera de novo; permissão negada continua no erro de sempre', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02']))
    const codigos = [3, 1]
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => true })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(_sucesso: PositionCallback, falha: PositionErrorCallback) {
          falha({ code: codigos.shift() ?? 1, message: 'duplê' } as unknown as GeolocationPositionError)
        },
      },
    })

    const tela = await abrir('/')
    await clicar(botaoDeBater(tela.raiz))
    await clicar(botaoCom(tela.raiz, 'Usar a foto do duplê'))
    // A demora (código 3) vai para a tela de tentar de novo, com o texto da demora.
    expect(tela.texto()).toContain('A localização está demorando. Vamos tentar de novo de um jeito mais rápido.')

    await clicar(botaoCom(tela.raiz, 'Tirar outra foto'))
    expect(camera.aberturas).toBe(2)
    await clicar(botaoCom(tela.raiz, 'Usar a foto do duplê'))
    // Negada (código 1): o erro de sempre, com o "como liberar", e não a tela de tentar de novo.
    expect(tela.texto()).toContain('Batida não registrada')
    expect(tela.texto()).toContain('Você negou o acesso à localização.')
    expect(tela.texto()).not.toContain('Não achamos sua localização')
    // E sem "Bater sem localização": negar o GPS não é um jeito de bater sem
    // ser localizado.
    expect(botaoCom(tela.raiz, 'sem localização')).toBeUndefined()
    expect(tela.texto()).not.toMatch(/sem localiza/i)
    expect(console_).toEqual([])
    expect(simulado.estado.escritas).toEqual([])
  })

  /*
   * BATER SEM LOCALIZAÇÃO: o GPS não responde, a pessoa escolhe "Bater sem
   * localização", digita o PIN, e a RPC recebe latitude e longitude nulas com
   * o motivo da falha. O simulado do banco aplica a regra do contrato: sem
   * coordenada, só com `p_sem_localizacao` em ('indisponivel', 'demora'); meia
   * coordenada, nunca.
   */
  it('o GPS que não responde: "Bater sem localização" vai ao PIN com a mesma selfie, e a RPC recebe latitude nula e o motivo', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02']))
    simulado.estado.aceitarEscritas = true
    simulado.estado.rpcs.ponto_verificar_pin = { confere: true, precisa_redefinir: false }
    simulado.estado.rpcs.ponto_registrar_batida = (args: Record<string, unknown>) => {
      const semLatitude = args.p_latitude === null || args.p_latitude === undefined
      const semLongitude = args.p_longitude === null || args.p_longitude === undefined
      if (semLatitude !== semLongitude) throw new Error('Batida pelo app exige latitude e longitude')
      if (semLatitude && !['indisponivel', 'demora'].includes(String(args.p_sem_localizacao))) {
        throw new Error('Batida pelo app exige latitude e longitude')
      }
      return {
        gravado: true,
        registro: {
          id: String(args.p_registro_id),
          registrado_em: `${hoje}T12:01:00.000-03:00`,
          dia_civil: hoje,
          tipo: 'saida_almoco',
          ordem_no_dia: 2,
          latitude: args.p_latitude ?? null,
          longitude: args.p_longitude ?? null,
          precisao_metros: args.p_precisao_metros ?? null,
          distancia_metros: null,
          no_local: null,
          selfie_path: args.p_selfie_path,
          ajuste_manual: false,
        },
      }
    }
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => true })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(_sucesso: PositionCallback, falha: PositionErrorCallback) {
          falha({ code: 3, message: 'duplê' } as unknown as GeolocationPositionError)
        },
      },
    })
    // O jsdom não tem `URL.createObjectURL` (a miniatura do comprovante).
    const urlOriginal = { criar: URL.createObjectURL, revogar: URL.revokeObjectURL }
    URL.createObjectURL = () => 'blob:duple'
    URL.revokeObjectURL = () => {}

    try {
      const tela = await abrir('/')
      await clicar(botaoDeBater(tela.raiz))
      await clicar(botaoCom(tela.raiz, 'Usar a foto do duplê'))
      expect(tela.texto()).toContain('Não achamos sua localização')
      expect(tela.texto()).toContain(
        'A batida sai com a sua foto e o PIN, marcada como sem localização. Prefira tentar de novo perto de uma janela.',
      )

      await clicar(botaoCom(tela.raiz, 'Bater sem localização'))
      expect(tela.texto()).toContain('Confirme com seu PIN')
      expect(tela.texto()).toContain('Último passo antes de gravar a batida, sem localização.')
      // A mesma selfie: a câmera não abriu de novo.
      expect(camera.aberturas).toBe(1)

      for (const digito of '1234') {
        await clicar([...tela.raiz.querySelectorAll('button')].find((botao) => botao.textContent?.trim() === digito))
      }

      const gravacao = simulado.estado.argumentos.find((chamada) => chamada.nome === 'ponto_registrar_batida')
      expect(gravacao?.args).toMatchObject({
        p_latitude: null,
        p_longitude: null,
        p_precisao_metros: null,
        p_sem_localizacao: 'demora',
        p_pin: '1234',
      })
      // A selfie subiu antes da gravação, como sempre — o banco a exige.
      expect(simulado.estado.aceitas).toEqual(['upload em ponto-selfies'])
      expect(tela.texto()).toContain('Batida registrada')
      expect(tela.texto()).toContain('Sem localização (o GPS não respondeu)')
      expect(console_).toEqual([])
      expect(simulado.estado.escritas).toEqual([])
      expect(simulado.estado.desconhecidas).toEqual([])

      // De volta ao início, a batida nova entra na lista com a etiqueta.
      await clicar(botaoCom(tela.raiz, 'Concluir'))
      expect(tela.texto()).toContain('sem localização')
      expect(textoDe(botaoDeBater(tela.raiz))).toContain('Bater volta do almoço')
      conferirFumaca(tela)
    } finally {
      URL.createObjectURL = urlOriginal.criar
      URL.revokeObjectURL = urlOriginal.revogar
    }
  })

  it('/espelho com 3 batidas hoje: "Em andamento", e o cabeçalho não conta hoje como incompleto', async () => {
    entrarComo('colaborador', bancoDeHoje(['08:02', '12:01', '13:00']))
    const tela = await abrir('/espelho')
    expect(tela.texto()).toContain('Em andamento')
    expect(tela.texto()).toContain('Dia em andamento.')
    expect(tela.texto()).not.toMatch(/incompleto/)
    // O rodapé, inteiro: de onde saem as horas e o que fica fora do total.
    expect([...tela.raiz.querySelectorAll('footer')].map((pe) => (pe.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual([
      'As horas saem das suas batidas, com o horário oficial do ponto. Dia com batida faltando não entra no total até ser corrigido.',
    ])
    conferirFumaca(tela)
  })
})

/* ------------------------------------------------------------------ */
/* O CI roda esta fumaça                                               */
/* ------------------------------------------------------------------ */

describe('o CI roda a fumaça', () => {
  it('o package.json tem o script, apontando para este arquivo', () => {
    const pacote = JSON.parse(pacoteCru) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pacote.scripts['test:fumaca']).toBe('vitest run src/fumaca-das-rotas.test.ts')
    // O DOM simulado é dependência de desenvolvimento: não vai para o bundle.
    expect(pacote.devDependencies).toHaveProperty('jsdom')
  })

  it('o workflow de conferência tem o passo da fumaça, antes do build', () => {
    const temOPasso = (fluxo: string) => {
      const passos = fluxo.split('\n')
      const fumaca = passos.findIndex((linha) => linha.trim() === 'run: npm run test:fumaca')
      const build = passos.findIndex((linha) => linha.trim() === 'run: npm run build')
      return fumaca > -1 && build > fumaca
    }
    expect(temOPasso(fluxoDoCi)).toBe(true)
  })
})
