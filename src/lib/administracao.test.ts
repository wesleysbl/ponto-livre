import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A CONVERSA DA ÁREA DE ADMINISTRAÇÃO COM O BANCO, CONTRA UM SUPABASE
 * SIMULADO. Nada de rede.
 *
 * O cliente de verdade (`./supabase`) é trocado por um simulado que ANOTA cada
 * chamada — tabela, filtros, RPC, função — e responde o que o teste mandar.
 * É assim que se prova o que não dá para ver de fora:
 *
 *   • REVOGAR QUE NÃO REVOGA NADA É ERRO. Só o super admin revoga; para os
 *     outros a RLS esconde a linha e o DELETE afeta zero linhas SEM ERRO —
 *     sem esta conferência, a tela diria "não administra mais" para uma
 *     revogação que não aconteceu.
 *   • LIGAR FICHA SÓ LIGA FICHA SEM CONTA (`is('usuario_id', null)`), e só mexe
 *     em `usuario_id`.
 *   • O ACESSO VEM DE `ponto_meu_acesso()`, e resposta estranha é erro.
 *   • AS CONTAS VÊM DE `ponto_contas()`, uma RPC só, e a recusa dela é erro,
 *     e não lista vazia.
 *   • A FUNÇÃO DE CONTAS recebe o corpo do contrato, com prazo, e a recusa dela
 *     chega à tela com o código e o "onde".
 *   • As frases de "sem acesso" mandam pedir a liberação a quem cuida do ponto
 *     na empresa, e a do PIN já definido manda pedir o reset também a quem
 *     cuida do ponto.
 */

const simulado = vi.hoisted(() => {
  interface Operacao {
    metodo: string
    args: unknown[]
  }
  interface Resposta {
    data: unknown
    error: { message: string; code?: string } | null
  }
  const estado = {
    consultas: [] as { tabela: string; operacoes: Operacao[] }[],
    respostaDaTabela: ((): Resposta => ({ data: [], error: null })) as (
      tabela: string,
      operacoes: Operacao[],
    ) => Resposta,
    rpcs: [] as { nome: string; args: unknown }[],
    respostaDaRpc: ((): Resposta => ({ data: null, error: null })) as (nome: string) => Resposta,
    invocacoes: [] as { nome: string; opcoes: Record<string, unknown> }[],
    respostaDaFuncao: (): Promise<{ data: unknown; error: unknown }> =>
      Promise.resolve({ data: null, error: null }),
  }

  /** Um construtor de consulta do PostgREST: todo método anota e devolve a si mesmo; `await` responde. */
  function consulta(tabela: string): unknown {
    const registro = { tabela, operacoes: [] as Operacao[] }
    estado.consultas.push(registro)
    const proxy: unknown = new Proxy(
      {},
      {
        get(_alvo, propriedade) {
          if (propriedade === 'then') {
            const resultado = estado.respostaDaTabela(tabela, registro.operacoes)
            return (resolver: (valor: unknown) => unknown, rejeitar: (erro: unknown) => unknown) =>
              Promise.resolve(resultado).then(resolver, rejeitar)
          }
          return (...args: unknown[]) => {
            registro.operacoes.push({ metodo: String(propriedade), args })
            return proxy
          }
        },
      },
    )
    return proxy
  }

  const supabase = {
    from: (tabela: string) => consulta(tabela),
    rpc: (nome: string, args?: unknown) => {
      estado.rpcs.push({ nome, args })
      return Promise.resolve(estado.respostaDaRpc(nome))
    },
    functions: {
      invoke: (nome: string, opcoes: Record<string, unknown>) => {
        estado.invocacoes.push({ nome, opcoes })
        return estado.respostaDaFuncao()
      },
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'sessao' } } } }),
    },
  }
  return { estado, supabase }
})

vi.mock('./supabase', () => ({ supabase: simulado.supabase }))

const {
  lerMeuAcesso,
  revogarAdministracao,
  concederAdministracao,
  vincularFicha,
  desvincularFicha,
  lerSuperAdmins,
  pedirAcaoDeConta,
  salvarFicha,
  lerLocalAtivo,
  salvarLocal,
  lerLocalizacoesRecentes,
} = await import('./administracao')
const { lerContasDoPonto, lerGenteDoPainel, lerNomeDaConta, lerNomesDasContas } = await import('./admin')
const { ErroDePin } = await import('./pin')
const { ErroDeBatida } = await import('./batidas')
const { ErroDeConta } = await import('./contas')

const { estado } = simulado
const CONTA = '00000000-0000-4000-8000-000000000003'

const LINHA_DA_FICHA = {
  id: 'f1',
  usuario_id: CONTA,
  nome_completo: 'Ana Lima',
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
  atualizado_em: null,
}

beforeEach(() => {
  estado.consultas.length = 0
  estado.rpcs.length = 0
  estado.invocacoes.length = 0
  estado.respostaDaTabela = () => ({ data: [], error: null })
  estado.respostaDaRpc = () => ({ data: null, error: null })
  estado.respostaDaFuncao = () => Promise.resolve({ data: null, error: null })
})

const metodos = (indice = 0) => estado.consultas[indice].operacoes.map((operacao) => operacao.metodo)
const argsDe = (metodo: string, indice = 0) =>
  estado.consultas[indice].operacoes.find((operacao) => operacao.metodo === metodo)?.args

/* ------------------------------------------------------------------ */

describe('lerMeuAcesso — ponto_meu_acesso()', () => {
  it('pergunta ponto_meu_acesso, e não ponto_pode_administrar', async () => {
    // O contrato do banco do ponto: bate_ponto, nome e cargo na mesma resposta.
    estado.respostaDaRpc = () => ({
      data: {
        tem_acesso: true,
        origem: 'administracao',
        administra: true,
        super_admin: false,
        bate_ponto: false,
        nome: 'Rita Moraes',
        cargo: null,
      },
      error: null,
    })
    await expect(lerMeuAcesso()).resolves.toEqual({
      temAcesso: true,
      origem: 'administracao',
      administra: true,
      superAdmin: false,
      batePonto: false,
      nome: 'Rita Moraes',
      cargo: null,
    })
    expect(estado.rpcs.map((rpc) => rpc.nome)).toEqual(['ponto_meu_acesso'])
    // O acesso sai inteiro da RPC, sem leitura de tabela.
    expect(estado.consultas).toEqual([])
  })

  it('erro da RPC e resposta estranha são ERRO (falha fechada), e não "sem acesso"', async () => {
    estado.respostaDaRpc = () => ({ data: null, error: { message: 'Failed to fetch' } })
    await expect(lerMeuAcesso()).rejects.toThrow(/Sem conexão/)

    estado.respostaDaRpc = () => ({ data: null, error: null })
    await expect(lerMeuAcesso()).rejects.toThrow(/acesso ao ponto/)
  })
})

describe('revogarAdministracao — zero linhas não é sucesso', () => {
  it('pede de volta as linhas apagadas', async () => {
    estado.respostaDaTabela = () => ({ data: [{ usuario_id: CONTA }], error: null })
    await expect(revogarAdministracao(CONTA)).resolves.toBeUndefined()
    expect(estado.consultas[0].tabela).toBe('ponto_admins')
    expect(metodos()).toEqual(['delete', 'eq', 'select'])
    expect(argsDe('eq')).toEqual(['usuario_id', CONTA])
  })

  it('a RLS escondeu a linha (quem não é super admin): o DELETE "deu certo" com zero linhas, e a tela ouve que nada foi revogado', async () => {
    estado.respostaDaTabela = () => ({ data: [], error: null })
    await expect(revogarAdministracao(CONTA)).rejects.toThrow(/Nada foi revogado/)
    await expect(revogarAdministracao(CONTA)).rejects.toThrow(/super admin/)
  })
})

describe('concederAdministracao — a recusa da RLS em português', () => {
  it('a RLS de ponto_admins vira "exclusivo do super admin"', async () => {
    estado.respostaDaTabela = () => ({
      data: null,
      error: { message: 'new row violates row-level security policy for table "ponto_admins"' },
    })
    await expect(concederAdministracao(CONTA, null)).rejects.toThrow(/exclusivo do super admin/)
  })
})

describe('vincularFicha e desvincularFicha', () => {
  it('liga só ficha que ainda está sem conta, e mexe só em usuario_id', async () => {
    estado.respostaDaTabela = () => ({ data: LINHA_DA_FICHA, error: null })
    const ficha = await vincularFicha('f1', CONTA)

    expect(ficha.usuarioId).toBe(CONTA)
    expect(estado.consultas[0].tabela).toBe('ponto_funcionarios')
    expect(argsDe('update')).toEqual([{ usuario_id: CONTA }])
    expect(argsDe('eq')).toEqual(['id', 'f1'])
    expect(argsDe('is')).toEqual(['usuario_id', null])
    expect(metodos()).toContain('single')
  })

  it('zero linhas (outra aba ligou antes): a ficha não troca de dono, e a frase diz', async () => {
    estado.respostaDaTabela = () => ({
      data: null,
      error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
    })
    await expect(vincularFicha('f1', CONTA)).rejects.toThrow(/já tem conta/)
  })

  it('a guarda da ficha recusa quem não é super admin, e a frase diz o que fazer', async () => {
    estado.respostaDaTabela = () => ({
      data: null,
      error: {
        message:
          'Liberar acesso ao ponto pela ficha e exclusivo do super admin: ligar a ficha a uma conta, reativa-la ou tirar o desligamento da acesso ao ponto a essa conta.',
      },
    })
    await expect(vincularFicha('f1', CONTA)).rejects.toThrow(/Só o super admin libera o acesso/)
    // A mesma frase serve à edição da ficha que tentasse liberar acesso.
    await expect(
      salvarFicha('f1', {
        usuarioId: CONTA,
        nomeCompleto: 'Ana Lima',
        cpf: null,
        matricula: null,
        cargo: null,
        admissao: null,
        desligamento: null,
        ctps: null,
        ctpsSerie: null,
        centroCusto: null,
        batePontoDesde: null,
      }),
    ).rejects.toThrow(/Só o super admin libera o acesso/)
  })

  it('desligar põe usuario_id nulo e nada mais', async () => {
    estado.respostaDaTabela = () => ({ data: { ...LINHA_DA_FICHA, usuario_id: null }, error: null })
    const ficha = await desvincularFicha('f1')
    expect(ficha.usuarioId).toBeNull()
    expect(argsDe('update')).toEqual([{ usuario_id: null }])
  })
})

describe('lerSuperAdmins', () => {
  it('lê os super admins, paginado e em ordem estável', async () => {
    estado.respostaDaTabela = () => ({ data: [{ usuario_id: 'w1' }, { usuario_id: 'w2' }], error: null })
    await expect(lerSuperAdmins()).resolves.toEqual(['w1', 'w2'])
    expect(estado.consultas[0].tabela).toBe('ponto_super_admins')
    expect(metodos()).toEqual(['select', 'order', 'range'])
  })
})

/* ------------------------------------------------------------------ */
/* As contas do ponto                                                  */
/* ------------------------------------------------------------------ */

describe('as contas do ponto vêm de ponto_contas()', () => {
  const CONTAS = [
    { usuario_id: 'rita', email: 'rh@example.com', nome: '  Rita Moraes ', criado_em: 'x', ultimo_login: null },
    { usuario_id: 'ana', email: 'ana@example.com', nome: 'Vítor Campos', criado_em: 'x', ultimo_login: null },
    { usuario_id: 'daniela', email: 'daniela@example.com', nome: null, criado_em: 'x', ultimo_login: null },
  ]
  const FICHA_DA_ANA = { ...LINHA_DA_FICHA, id: 'fa', usuario_id: 'ana', nome_completo: 'Ana Beatriz Rocha' }

  it('lerContasDoPonto chama a RPC e nenhuma tabela; o nome é o guardado na conta, senão o e-mail', async () => {
    estado.respostaDaRpc = (nome) => ({ data: nome === 'ponto_contas' ? CONTAS : null, error: null })
    const contas = await lerContasDoPonto()

    expect(estado.rpcs.map((rpc) => rpc.nome)).toEqual(['ponto_contas'])
    expect(estado.consultas).toHaveLength(0)
    expect(contas.map((conta) => [conta.usuarioId, conta.nome, conta.nomeDaConta])).toEqual([
      ['rita', 'Rita Moraes', 'Rita Moraes'],
      ['ana', 'Vítor Campos', 'Vítor Campos'],
      ['daniela', 'daniela@example.com', null],
    ])
    // Ninguém bate nem tem ficha até as fichas e os super admins entrarem.
    expect(contas.every((conta) => !conta.podeBater && !conta.temFicha && !conta.contaApagada)).toBe(true)
  })

  it('a recusa de quem não administra é ERRO traduzido, e não lista vazia', async () => {
    estado.respostaDaRpc = () => ({
      data: null,
      error: { message: 'Lista de contas e exclusiva de quem administra o ponto', code: '42501' },
    })
    await expect(lerContasDoPonto()).rejects.toThrow(/Sua sessão não administra o ponto/)
  })

  it('lerGenteDoPainel junta contas, fichas e super admins: nome da ficha, e o super admin bate', async () => {
    estado.respostaDaRpc = () => ({ data: CONTAS, error: null })
    estado.respostaDaTabela = (tabela) => ({
      data:
        tabela === 'ponto_funcionarios'
          ? [FICHA_DA_ANA]
          : tabela === 'ponto_super_admins'
            ? [{ usuario_id: 'daniela' }]
            : [],
      error: null,
    })
    const gente = await lerGenteDoPainel()

    expect(estado.consultas.map((consulta) => consulta.tabela).sort()).toEqual(['ponto_funcionarios', 'ponto_super_admins'])
    expect(gente.funcionarios.map((f) => [f.usuarioId, f.nome, f.podeBater])).toEqual([
      ['rita', 'Rita Moraes', false],
      ['ana', 'Ana Beatriz Rocha', true],
      ['daniela', 'daniela@example.com', true],
    ])
  })

  it('os nomes de quem decidiu ou mediu: ficha, nome guardado na conta, e-mail', async () => {
    estado.respostaDaRpc = () => ({ data: CONTAS, error: null })
    estado.respostaDaTabela = (tabela) => ({ data: tabela === 'ponto_funcionarios' ? [FICHA_DA_ANA] : [], error: null })

    const nomes = await lerNomesDasContas()
    expect(nomes.get('rita')).toBe('Rita Moraes')
    expect(nomes.get('ana')).toBe('Ana Beatriz Rocha')
    expect(nomes.get('daniela')).toBe('daniela@example.com')
    await expect(lerNomeDaConta('ana')).resolves.toBe('Ana Beatriz Rocha')
  })

  it('o nome de quem mediu: conta que não está na lista, ou leitura recusada, é nulo — nunca quebra', async () => {
    estado.respostaDaRpc = () => ({ data: CONTAS, error: null })
    await expect(lerNomeDaConta('fantasma')).resolves.toBeNull()
    estado.respostaDaRpc = () => ({ data: null, error: { message: 'Lista de contas exige sessao de usuario' } })
    await expect(lerNomeDaConta('rita')).resolves.toBeNull()
  })
})

describe('pedirAcaoDeConta — a Edge Function ponto-contas', () => {
  const CORPO = { acao: 'trocar_email', usuario_id: CONTA, email: 'novo@example.com' } as const

  it('manda o corpo do contrato à ponto-contas, com prazo, e devolve o sucesso', async () => {
    estado.respostaDaFuncao = () =>
      Promise.resolve({
        data: {
          ok: true,
          acao: 'trocar_email',
          usuario_id: CONTA,
          mensagem: 'E-mail trocado para novo@example.com. A pessoa passa a entrar com o e-mail novo; a senha continua a mesma.',
          passos: [],
          trilha_id: 't1',
        },
        error: null,
      })
    const sucesso = await pedirAcaoDeConta(CORPO)

    expect(sucesso.mensagem).toContain('novo@example.com')
    expect(estado.invocacoes).toHaveLength(1)
    expect(estado.invocacoes[0].nome).toBe('ponto-contas')
    expect(estado.invocacoes[0].opcoes.body).toEqual(CORPO)
    expect(estado.invocacoes[0].opcoes.timeout).toBeGreaterThan(0)
    // Nenhuma tabela é tocada pela tela numa ação de conta: quem mexe é a função.
    expect(estado.consultas).toHaveLength(0)
  })

  it('e-mail repetido chega com o código e o "onde"', async () => {
    estado.respostaDaFuncao = () =>
      Promise.resolve({
        data: null,
        error: new FunctionsHttpError(
          new Response(
            JSON.stringify({
              ok: false,
              codigo: 'email_ja_usado',
              onde: 'login',
              mensagem: 'O e-mail novo@example.com já é o login de outra conta. Nada mudou: escolha outro e-mail, ou resolva a outra conta antes.',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      })
    const falha = await pedirAcaoDeConta(CORPO).catch((erro: unknown) => erro)

    expect(falha).toBeInstanceOf(ErroDeConta)
    if (!(falha instanceof ErroDeConta)) return
    expect(falha.falha.codigo).toBe('email_ja_usado')
    expect(falha.falha.onde).toBe('login')
    expect(falha.message).toMatch(/login de outra conta/)
  })

  it('sem rede: ErroDeConta que manda conferir antes de repetir', async () => {
    estado.respostaDaFuncao = () =>
      Promise.resolve({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    await expect(pedirAcaoDeConta(CORPO)).rejects.toThrow(/confira se algo mudou/)
  })

  it('200 com corpo fora do contrato não é sucesso', async () => {
    estado.respostaDaFuncao = () => Promise.resolve({ data: 'ok', error: null })
    await expect(pedirAcaoDeConta(CORPO)).rejects.toBeInstanceOf(ErroDeConta)
  })
})

describe('as frases de "sem acesso" mandam pedir a liberação a quem cuida do ponto na empresa', () => {
  // As recusas do banco, palavra por palavra: o PIN recusa a conta que não entra
  // no ponto (sem ficha que libera e sem papel de administração); a batida e o
  // pedido de batida em atraso, a que não bate (sem ficha que libera e sem ser
  // super admin).
  const SEM_ACESSO_AO_PONTO = 'Conta sem acesso ao ponto: peca liberacao a quem cuida do ponto'
  const SEM_ACESSO_PARA_BATER =
    'Conta sem acesso para bater ponto: so quem tem ficha ativa no ponto bate ponto e pede batida em atraso; peca liberacao a quem cuida do ponto'

  it('as duas recusas saem assim das funções do banco que as levantam', () => {
    // Se o banco mudar a frase e o tradutor não, a mensagem crua do Postgres
    // chegaria à tela: o teste quebra aqui.
    const arquivos = import.meta.glob<string>('../../supabase/migrations/*_ponto_livre_estrutura.sql', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    expect(Object.keys(arquivos)).toHaveLength(1)
    const migration = Object.values(arquivos)[0]
    const funcao = (nome: string) =>
      new RegExp(String.raw`CREATE FUNCTION public\.${nome}\([\s\S]*?\n\$\$;`).exec(migration)?.[0] ?? ''
    expect(funcao('ponto_definir_pin')).toContain(`RAISE EXCEPTION '${SEM_ACESSO_AO_PONTO}'`)
    for (const nome of ['ponto_registrar_batida', 'ponto_pedir_batida_em_atraso']) {
      expect(funcao(nome), nome).toContain(`RAISE EXCEPTION '${SEM_ACESSO_PARA_BATER}'`)
    }
  })

  // A frase que chega à tela, inteira: a liberação e o reset se pedem a quem
  // cuida do ponto na empresa (quem libera é o super admin; quem reseta, quem
  // administra o ponto).
  it.each([
    ['PIN', () => new ErroDePin(SEM_ACESSO_AO_PONTO).message, 'Seu acesso ao ponto ainda não foi liberado. Peça a liberação a quem cuida do ponto na sua empresa.'],
    ['batida', () => new ErroDeBatida(SEM_ACESSO_PARA_BATER).message, 'Seu acesso ao ponto ainda não foi liberado. Peça a liberação a quem cuida do ponto na sua empresa.'],
    ['reset de PIN', () => new ErroDePin('PIN ja definido').message, 'Você já tem um PIN. Para trocar, peça a quem cuida do ponto na sua empresa para resetar.'],
  ])('%s', (_caso, frase, esperada) => {
    expect(frase()).toBe(esperada)
  })
})

describe('o local do ponto', () => {
  const LINHA_DO_LOCAL = {
    id: 'l1',
    nome: 'Empresa Exemplo',
    latitude: -23.550520,
    longitude: -46.633308,
    raio_metros: 150,
    ativo: true,
    medido_em: '2026-10-15T12:00:00.000000+00:00',
    medido_por: null,
  }

  it('lê o local ativo com quem mediu e quando, pela mesma consulta do gatilho', async () => {
    estado.respostaDaTabela = () => ({ data: LINHA_DO_LOCAL, error: null })
    await expect(lerLocalAtivo()).resolves.toMatchObject({
      id: 'l1',
      raioMetros: 150,
      medidoEm: '2026-10-15T12:00:00.000000+00:00',
      medidoPor: null,
    })
    expect(estado.consultas[0].tabela).toBe('ponto_local')
    expect(String(argsDe('select')?.[0])).toMatch(/medido_em, medido_por/)
    expect(argsDe('eq')).toEqual(['ativo', true])
    expect(argsDe('order')).toEqual(['criado_em', { ascending: true }])
  })

  it('resposta sem medido_em e medido_por vira nulo, e não "Invalid Date"', async () => {
    const { medido_em: _em, medido_por: _por, ...semAsColunas } = LINHA_DO_LOCAL
    void _em
    void _por
    estado.respostaDaTabela = () => ({ data: semAsColunas, error: null })
    await expect(lerLocalAtivo()).resolves.toMatchObject({ medidoEm: null, medidoPor: null })
  })

  it('salvar NÃO manda quem mediu nem quando — o carimbo é do gatilho do banco', async () => {
    estado.respostaDaTabela = () => ({ data: LINHA_DO_LOCAL, error: null })
    await salvarLocal('l1', { nome: 'Empresa Exemplo', latitude: -23.55, longitude: -46.63, raioMetros: 150 })
    const valores = argsDe('update')?.[0] as Record<string, unknown>
    expect(Object.keys(valores).sort()).toEqual(['latitude', 'longitude', 'nome', 'raio_metros'])
    expect(argsDe('eq')).toEqual(['id', 'l1'])

    estado.consultas.length = 0
    await salvarLocal(null, { nome: 'Empresa Exemplo', latitude: -23.55, longitude: -46.63, raioMetros: 150 })
    const novo = argsDe('insert')?.[0] as Record<string, unknown>
    expect(Object.keys(novo).sort()).toEqual(['ativo', 'latitude', 'longitude', 'nome', 'raio_metros'])
  })

  it('as batidas dos últimos dias vêm paginadas, em ordem estável, só com as colunas da régua', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'))
    try {
      estado.respostaDaTabela = () => ({
        data: [{ id: 'b1', registrado_em: 'x', distancia_metros: 5, no_local: true, precisao_metros: 8 }],
        error: null,
      })
      await expect(lerLocalizacoesRecentes(30)).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
    expect(estado.consultas[0].tabela).toBe('ponto_registros')
    expect(argsDe('gte')).toEqual(['registrado_em', '2026-09-18T12:00:00.000Z'])
    expect(metodos()).toEqual(['select', 'gte', 'order', 'order', 'range'])
    expect(String(argsDe('select')?.[0])).toMatch(/distancia_metros, no_local, precisao_metros/)
  })

  it('o erro da leitura das batidas chega à tela, e não vira "0% fora"', async () => {
    estado.respostaDaTabela = () => ({ data: null, error: { message: 'connection reset' } })
    await expect(lerLocalizacoesRecentes(30)).rejects.toThrow(/connection reset/)
    // A recusa de permissão chega traduzida, como nas outras leituras do painel.
    estado.respostaDaTabela = () => ({ data: null, error: { message: 'permission denied' } })
    await expect(lerLocalizacoesRecentes(30)).rejects.toThrow(/não administra o ponto/)
  })

  it('as colunas que o app lê do local existem na migration da estrutura', () => {
    // A estrutura inteira do banco é uma migration só; sem ela (ou vazia), o
    // teste quebra em vez de passar no vazio.
    const arquivos = import.meta.glob<string>('../../supabase/migrations/*_ponto_livre_estrutura.sql', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    expect(Object.keys(arquivos)).toHaveLength(1)
    const migration = Object.values(arquivos)[0]
    expect(migration.trim()).not.toBe('')
    const tabela = /CREATE TABLE public\.ponto_local \(([\s\S]*?)\n\);/.exec(migration)?.[1] ?? ''
    expect(tabela).toMatch(/\n {2}medido_por uuid,/)
    expect(tabela).toMatch(/\n {2}medido_em timestamp with time zone,/)
    // O gatilho repõe as duas colunas: mandar do cliente seria ignorado.
    expect(migration).toMatch(/NEW\.medido_por := auth\.uid\(\)/)
  })
})
