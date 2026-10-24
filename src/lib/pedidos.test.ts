import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalDaBatida } from './localizacao'

/*
 * A CONVERSA DA BATIDA EM ATRASO COM O BANCO, CONTRA UM SUPABASE SIMULADO.
 * Nada de rede.
 *
 * O cliente de verdade é trocado por um simulado que ANOTA cada chamada —
 * upload, remoção, RPC, tabela e filtros — e responde o que o teste mandar.
 * O que se prova:
 *
 *   • O PEDIDO SOBE A SELFIE ANTES, com a convenção que a RPC confere
 *     (`{uid}/{aaaa}/{mm}/{id-do-pedido}.jpg`, e o MESMO id em `p_pedido_id`),
 *     e manda os oito parâmetros da assinatura aplicada.
 *   • A FOTO SÓ É DESCARTADA QUANDO O PEDIDO NÃO EXISTE — recusa definitiva
 *     (`destinoDaSelfie`, a regra do descarte). Com o pedido gravado ela é
 *     prova, e a policy do dono nem deixaria apagar; com a resposta perdida ela
 *     fica, porque o pedido pode ter gravado.
 *   • A DECISÃO manda nulo, e não string vazia, quando se aprova sem motivo; e
 *     recusa sem motivo nem viaja.
 *   • As frases da RPC chegam traduzidas — e as frases que o app procura estão,
 *     palavra por palavra, na migration da estrutura do banco (o contrato).
 *   • O nome de quem aprovou é de melhor esforço: falhar não derruba a tela.
 */

const simulado = vi.hoisted(() => {
  interface Operacao {
    metodo: string
    args: unknown[]
  }
  interface Resposta {
    data: unknown
    error: { message: string; code?: string } | null
    status?: number
  }
  const estado = {
    consultas: [] as { tabela: string; operacoes: Operacao[] }[],
    respostaDaTabela: ((): Resposta => ({ data: [], error: null })) as (
      tabela: string,
      operacoes: Operacao[],
    ) => Resposta,
    rpcs: [] as { nome: string; args: Record<string, unknown> }[],
    respostaDaRpc: ((): Resposta => ({ data: null, error: null })) as (nome: string) => Resposta,
    envios: [] as { bucket: string; caminho: string }[],
    remocoes: [] as { bucket: string; caminhos: string[] }[],
    erroDoEnvio: null as { message: string } | null,
  }

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
    rpc: (nome: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ nome, args })
      return Promise.resolve(estado.respostaDaRpc(nome))
    },
    storage: {
      from: (bucket: string) => ({
        upload: (caminho: string) => {
          estado.envios.push({ bucket, caminho })
          return Promise.resolve({ data: null, error: estado.erroDoEnvio })
        },
        remove: (caminhos: string[]) => {
          estado.remocoes.push({ bucket, caminhos })
          return Promise.resolve({ data: null, error: null })
        },
      }),
    },
  }
  return { estado, supabase }
})

vi.mock('./supabase', () => ({ supabase: simulado.supabase }))

const { pedirBatidaEmAtraso, registrarBatida, ErroDeBatida, ErroDoPedido } = await import('./batidas')
const {
  decidirPedido,
  ErroDaDecisao,
  lerAprovadoresDoPeriodo,
  lerContasComPedidoNoPeriodo,
  lerMeusPedidos,
  lerNomesDeQuemDecidiu,
  lerPedidosPendentes,
} = await import('./pedidos')

const { estado } = simulado

beforeEach(() => {
  estado.consultas = []
  estado.rpcs = []
  estado.envios = []
  estado.remocoes = []
  estado.erroDoEnvio = null
  estado.respostaDaTabela = () => ({ data: [], error: null })
  estado.respostaDaRpc = () => ({ data: null, error: null })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const DADOS = {
  usuarioId: '11111111-1111-1111-1111-111111111111',
  pin: '1234',
  foto: new Blob(['jpeg']),
  local: { tipo: 'coordenada', coordenada: { latitude: -23.56, longitude: -46.61, precisaoMetros: 12 } } as LocalDaBatida,
  horarioDeclaradoISO: '2026-10-17T11:00:00.000Z',
  motivo: 'Cheguei às 8h e esqueci de bater.',
}

/* ------------------------------------------------------------------ */

describe('pedir batida em atraso', () => {
  it('sobe a selfie na convenção e chama a RPC com os oito parâmetros, com o mesmo id', async () => {
    estado.respostaDaRpc = () => ({
      data: { gravado: true, pedido: { id: 'x', estado: 'pendente' } },
      error: null,
    })
    const resposta = await pedirBatidaEmAtraso(DADOS)
    expect(resposta.gravado).toBe(true)

    expect(estado.envios).toHaveLength(1)
    const { bucket, caminho } = estado.envios[0]
    expect(bucket).toBe('ponto-selfies')
    expect(caminho).toMatch(new RegExp(`^${DADOS.usuarioId}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.jpg$`))

    expect(estado.rpcs).toHaveLength(1)
    const { nome, args } = estado.rpcs[0]
    expect(nome).toBe('ponto_pedir_batida_em_atraso')
    expect(Object.keys(args).sort()).toEqual(
      [
        'p_horario_declarado',
        'p_latitude',
        'p_longitude',
        'p_motivo',
        'p_pedido_id',
        'p_pin',
        'p_precisao_metros',
        'p_selfie_path',
      ].sort(),
    )
    expect(args.p_selfie_path).toBe(caminho)
    expect(caminho.endsWith(`/${String(args.p_pedido_id)}.jpg`)).toBe(true)
    expect(args.p_horario_declarado).toBe(DADOS.horarioDeclaradoISO)
    expect(args.p_motivo).toBe(DADOS.motivo)

    // Gravado: a foto é prova e fica.
    expect(estado.remocoes).toEqual([])
  })

  it('recusa com valor (PIN errado, duplicado): a foto sai do bucket', async () => {
    for (const motivo of ['pin_incorreto', 'pedido_duplicado', 'precisa_redefinir']) {
      estado.remocoes = []
      estado.respostaDaRpc = () => ({
        data: { gravado: false, motivo, tentativas_restantes: 4, bloqueado_ate: null },
        error: null,
      })
      const resposta = await pedirBatidaEmAtraso(DADOS)
      expect(resposta.gravado).toBe(false)
      expect(estado.remocoes).toHaveLength(1)
    }
  })

  it('recusa levantada pela RPC (erro do Postgres num 4xx): a foto sai, e a frase chega traduzida', async () => {
    estado.respostaDaRpc = () => ({
      data: null,
      status: 400,
      error: {
        code: 'P0001',
        message:
          'Horario declarado fora do dia de hoje: o pedido em atraso so vale para o mesmo dia (horario de Brasilia)',
      },
    })
    await expect(pedirBatidaEmAtraso(DADOS)).rejects.toThrow(/mesmo dia \(horário de Brasília\)/)
    expect(estado.remocoes).toHaveLength(1)
  })

  /*
   * A REGRA DO DESCARTE NO PEDIDO: descartar a foto em QUALQUER falha da RPC
   * seria errado. Com a resposta perdida, o pedido pode ter sido gravado com
   * esta foto — e ela é a prova dele.
   */
  it('resposta perdida (rede, 5xx, exceção): a foto FICA e o erro sai incerto', async () => {
    const perdidas: (() => unknown)[] = [
      () => ({ data: null, status: 0, error: { message: 'TypeError: Failed to fetch', code: '' } }),
      () => ({ data: null, status: 504, error: { message: 'Gateway Timeout' } }),
      () => ({ data: null, status: 503, error: { message: 'upstream', code: 'PGRST000' } }),
      () => {
        throw new Error('Failed to fetch')
      },
    ]
    for (const resposta of perdidas) {
      estado.remocoes = []
      estado.respostaDaRpc = resposta as typeof estado.respostaDaRpc
      const falha = await pedirBatidaEmAtraso(DADOS).then(
        () => null,
        (erro: unknown) => erro,
      )
      expect(falha).toBeInstanceOf(ErroDoPedido)
      expect((falha as InstanceType<typeof ErroDoPedido>).incerto).toBe(true)
      expect((falha as Error).message).toMatch(/pode ter sido gravado/)
      expect(estado.remocoes).toEqual([])
    }
  })

  it('recusa com motivo que o app não conhece: a foto fica, por via das dúvidas', async () => {
    estado.respostaDaRpc = () => ({ data: { gravado: false, motivo: 'motivo_novo_do_banco' }, error: null })
    const resposta = await pedirBatidaEmAtraso(DADOS)
    expect(resposta.gravado).toBe(false)
    expect(estado.remocoes).toEqual([])
  })

  it('a foto que não subiu não chama a RPC', async () => {
    estado.erroDoEnvio = { message: 'Failed to fetch' }
    await expect(pedirBatidaEmAtraso(DADOS)).rejects.toBeInstanceOf(ErroDoPedido)
    expect(estado.rpcs).toEqual([])
  })

  it('as recusas próprias do pedido têm frase própria; as da batida caem na tradução da batida', () => {
    const casos: [string, RegExp][] = [
      ['Horario declarado no futuro: o pedido em atraso e para uma batida que ja passou', /ainda não chegou/],
      ['Motivo do pedido de batida em atraso precisa de pelo menos 10 caracteres', /pelo menos 10/],
      ['Motivo do pedido de batida em atraso pode ter no maximo 500 caracteres', /no máximo 500/],
      ['Ja existe uma batida sua neste mesmo minuto: o pedido seria duplicado', /mesmo minuto/],
      ['Ja existe um pedido pendente seu para este mesmo horario', /aguardando aprovação/],
      ['Pedido de batida em atraso exige sessao de usuario', /sessão expirou/],
      [
        'Conta sem acesso para bater ponto: so quem tem ficha ativa no ponto bate ponto e pede batida em atraso; peca liberacao a quem cuida do ponto',
        /Peça a liberação a quem cuida do ponto na sua empresa\./,
      ],
      ['Selfie fora do prazo: a foto precisa ter sido enviada nos ultimos 15 minutos', /demorou demais/],
      [
        'Pedidos pendentes demais hoje: voce ja tem 4 pedidos de batida em atraso esperando decisao, e o teto e 4. Espere quem administra o ponto decidir os que ja estao na fila',
        /pedidos demais esperando decisão hoje/,
      ],
      ['Selfies demais nesta conta: 20 na ultima hora, e o teto e 20. Espere um pouco e tente de novo', /fotos demais em pouco tempo/],
    ]
    for (const [mensagem, esperado] of casos) {
      expect(new ErroDoPedido(mensagem).message).toMatch(esperado)
    }
  })

  it('o teto de selfies do bucket chega traduzido na batida também (a hora e as 24 horas)', () => {
    for (const mensagem of [
      'Selfies demais nesta conta: 20 na ultima hora, e o teto e 20. Espere um pouco e tente de novo',
      'Selfies demais nesta conta: 60 nas ultimas 24 horas, e o teto e 60. Tente de novo mais tarde',
    ]) {
      expect(new ErroDeBatida(mensagem).message).toBe(
        'Esta conta enviou fotos demais em pouco tempo. Espere um pouco e tente de novo; se continuar, fale com quem administra o ponto.',
      )
    }
  })
})

describe('o admin decide o pedido', () => {
  it('aprovar sem motivo manda nulo, não string vazia', async () => {
    estado.respostaDaRpc = () => ({ data: { decidido: true, estado: 'aprovado' }, error: null })
    await decidirPedido({ pedidoId: 'p1', aprovar: true, motivo: '   ' })
    expect(estado.rpcs).toEqual([
      {
        nome: 'ponto_decidir_pedido_atraso',
        args: { p_pedido_id: 'p1', p_aprovar: true, p_motivo: null },
      },
    ])
  })

  it('recusar manda o motivo limpo', async () => {
    estado.respostaDaRpc = () => ({ data: { decidido: true, estado: 'recusado' }, error: null })
    await decidirPedido({ pedidoId: 'p1', aprovar: false, motivo: '  estava de folga  ' })
    expect(estado.rpcs[0].args).toEqual({ p_pedido_id: 'p1', p_aprovar: false, p_motivo: 'estava de folga' })
  })

  it('recusar sem motivo nem viaja', async () => {
    await expect(decidirPedido({ pedidoId: 'p1', aprovar: false, motivo: ' ' })).rejects.toThrow(
      /motivo da recusa/,
    )
    expect(estado.rpcs).toEqual([])
  })

  it('as recusas do banco chegam traduzidas; "já decidido" pede releitura da lista', async () => {
    const casos: [string, RegExp, boolean][] = [
      ['Quem pediu a batida em atraso nao decide o proprio pedido: peca a outra pessoa que administra o ponto', /seu próprio pedido/, false],
      ['Pedido de batida em atraso ja decidido: esta aprovado', /já foi decidido/, true],
      ['Pedido de batida em atraso nao encontrado', /não foi encontrado/, true],
      ['Selfie do pedido nao esta mais no bucket: sem a prova, a batida em atraso nao e criada. Recuse o pedido com motivo', /selfie deste pedido/, false],
      ['Ja existe batida desta pessoa no mesmo minuto do pedido: a aprovacao duplicaria a batida. Recuse o pedido com motivo', /duplicaria/, false],
      ['Decidir pedido de batida em atraso e exclusivo de quem administra o ponto', /não administra o ponto/, false],
    ]
    for (const [mensagem, esperado, releitura] of casos) {
      estado.respostaDaRpc = () => ({ data: null, error: { message: mensagem } })
      const falha = await decidirPedido({ pedidoId: 'p1', aprovar: true, motivo: '' }).catch(
        (erro: unknown) => erro,
      )
      expect(falha).toBeInstanceOf(ErroDaDecisao)
      expect((falha as InstanceType<typeof ErroDaDecisao>).message).toMatch(esperado)
      expect((falha as InstanceType<typeof ErroDaDecisao>).releitura).toBe(releitura)
    }
  })
})

describe('as leituras', () => {
  it('a caixa de pendências lê só pendentes, do mais antigo para o mais novo', async () => {
    await lerPedidosPendentes()
    const [consulta] = estado.consultas
    expect(consulta.tabela).toBe('ponto_pedidos_atraso')
    expect(consulta.operacoes).toContainEqual({ metodo: 'eq', args: ['estado', 'pendente'] })
    expect(consulta.operacoes).toContainEqual({
      metodo: 'order',
      args: ['pedido_em', { ascending: true }],
    })
  })

  it('os pedidos da pessoa: dela, no intervalo de dias civis', async () => {
    await lerMeusPedidos('u1', '2026-10-01', '2026-10-31')
    const operacoes = estado.consultas[0].operacoes
    expect(operacoes).toContainEqual({ metodo: 'eq', args: ['usuario_id', 'u1'] })
    expect(operacoes).toContainEqual({ metodo: 'gte', args: ['dia_civil', '2026-10-01'] })
    expect(operacoes).toContainEqual({ metodo: 'lte', args: ['dia_civil', '2026-10-31'] })
  })

  it('o app só LÊ a tabela de pedidos: nenhuma escrita direta nela', async () => {
    await lerPedidosPendentes()
    await lerMeusPedidos('u1', '2026-10-01', '2026-10-31')
    const metodos = estado.consultas.flatMap((consulta) => consulta.operacoes.map((op) => op.metodo))
    for (const proibido of ['insert', 'update', 'upsert', 'delete']) {
      expect(metodos).not.toContain(proibido)
    }
  })

  /*
   * Os nomes vêm de `ponto_contas()` e das fichas, pela regra única: a ficha,
   * depois o nome guardado na conta, depois o e-mail.
   */
  it('nomes de quem decidiu: usa os conhecidos e lê os que faltam da lista de contas do ponto', async () => {
    estado.respostaDaRpc = (nome) => ({
      data:
        nome === 'ponto_contas'
          ? [
              { usuario_id: 'admin-2', email: 'rh@example.com', nome: 'Rita', criado_em: 'x', ultimo_login: null },
              { usuario_id: 'admin-3', email: 'ana@example.com', nome: 'Vítor Campos', criado_em: 'x', ultimo_login: null },
            ]
          : null,
      error: null,
    })
    estado.respostaDaTabela = (tabela) => ({
      data:
        tabela === 'ponto_funcionarios'
          ? [{ id: 'fh', usuario_id: 'admin-3', nome_completo: 'Ana Beatriz Rocha', ativo: true }]
          : [],
      error: null,
    })
    const nomes = await lerNomesDeQuemDecidiu(
      [{ decidido_por: 'admin-1' }, { decidido_por: 'admin-2' }, { decidido_por: 'admin-3' }, { decidido_por: null }],
      new Map([['admin-1', 'Sérgio']]),
    )
    expect([...nomes.entries()]).toEqual([
      ['admin-1', 'Sérgio'],
      ['admin-2', 'Rita'],
      ['admin-3', 'Ana Beatriz Rocha'],
    ])
    expect(estado.rpcs.map((rpc) => rpc.nome)).toEqual(['ponto_contas'])
    expect(estado.consultas.map((consulta) => consulta.tabela)).toEqual(['ponto_funcionarios'])
  })

  it('com todos os nomes conhecidos, nada é lido', async () => {
    const nomes = await lerNomesDeQuemDecidiu([{ decidido_por: 'admin-1' }], new Map([['admin-1', 'Sérgio']]))
    expect(nomes.get('admin-1')).toBe('Sérgio')
    expect(estado.rpcs).toHaveLength(0)
    expect(estado.consultas).toHaveLength(0)
  })

  it('nome que não deu para ler não derruba nada: o mapa volta sem ele', async () => {
    estado.respostaDaRpc = () => ({ data: null, error: { message: 'Lista de contas e exclusiva de quem administra o ponto' } })
    const nomes = await lerNomesDeQuemDecidiu([{ decidido_por: 'admin-9' }])
    expect(nomes.size).toBe(0)
  })

  it('quem aprovou no período NUNCA levanta: falhou, volta vazio', async () => {
    estado.respostaDaTabela = () => ({ data: null, error: { message: 'Failed to fetch' } })
    const mapa = await lerAprovadoresDoPeriodo(
      { inicio: '2026-10-01', fim: '2026-10-31' },
      new Map(),
    )
    expect(mapa.size).toBe(0)
  })

  it('quem aprovou no período: só os aprovados, com o nome conhecido', async () => {
    estado.respostaDaTabela = (tabela) =>
      tabela === 'ponto_pedidos_atraso'
        ? {
            data: [{ id: 'p1', estado: 'aprovado', decidido_por: 'admin-1' }],
            error: null,
          }
        : { data: [], error: null }
    const mapa = await lerAprovadoresDoPeriodo(
      { inicio: '2026-10-01', fim: '2026-10-31' },
      new Map([['admin-1', 'Sérgio']]),
      'u1',
    )
    expect([...mapa.entries()]).toEqual([['p1', 'Sérgio']])
    const operacoes = estado.consultas[0].operacoes
    expect(operacoes).toContainEqual({ metodo: 'eq', args: ['estado', 'aprovado'] })
    expect(operacoes).toContainEqual({ metodo: 'eq', args: ['usuario_id', 'u1'] })
  })

  /*
   * O painel mostra só quem é do ponto, e quem pediu batida no período é — em
   * qualquer estado.
   */
  it('quem tem pedido no período: por dia civil, em qualquer estado, uma conta uma vez', async () => {
    estado.respostaDaTabela = () => ({
      data: [
        { id: 'p1', usuario_id: 'u1' },
        { id: 'p2', usuario_id: 'u2' },
        { id: 'p3', usuario_id: 'u1' },
      ],
      error: null,
    })
    const contas = await lerContasComPedidoNoPeriodo({ inicio: '2026-10-01', fim: '2026-10-31' })
    expect([...contas]).toEqual(['u1', 'u2'])
    const [consulta] = estado.consultas
    expect(consulta.tabela).toBe('ponto_pedidos_atraso')
    expect(consulta.operacoes).toContainEqual({ metodo: 'gte', args: ['dia_civil', '2026-10-01'] })
    expect(consulta.operacoes).toContainEqual({ metodo: 'lte', args: ['dia_civil', '2026-10-31'] })
    // O recusado e o aprovado também contam: nenhum filtro de estado.
    expect(consulta.operacoes.filter((op) => op.metodo === 'eq')).toEqual([])
  })

  it('quem tem pedido no período é parte da leitura do painel: falhou, levanta (não volta vazio calado)', async () => {
    estado.respostaDaTabela = () => ({ data: null, error: { message: 'permission denied' } })
    await expect(lerContasComPedidoNoPeriodo({ inicio: '2026-10-01', fim: '2026-10-31' })).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* A batida e o pedido sem localização                                 */
/* ------------------------------------------------------------------ */

/*
 * QUANDO O GPS NÃO RESPONDE, a batida (e o pedido) podem sair sem coordenada,
 * com a selfie e o PIN de sempre. O que se prova aqui é a CONVERSA com o banco:
 *   • com coordenada, `p_sem_localizacao` nem viaja: um argumento a mais muda
 *     a assinatura que o PostgREST procura (ele escolhe a função pelos nomes
 *     dos argumentos);
 *   • sem coordenada, latitude, longitude e precisão vão nulas, com o motivo;
 *   • a selfie sobe antes, nos dois casos — o banco a exige;
 *   • a recusa "sem coordenada e sem motivo" chega traduzida e descarta a foto.
 */
describe('a batida e o pedido sem localização', () => {
  const COM_GPS: LocalDaBatida = {
    tipo: 'coordenada',
    coordenada: { latitude: -23.56, longitude: -46.61, precisaoMetros: 12 },
  }
  const SEM_GPS: LocalDaBatida = { tipo: 'sem_localizacao', motivo: 'demora' }
  const BATIDA = { usuarioId: DADOS.usuarioId, pin: '1234', foto: new Blob(['jpeg']) }
  const GRAVADA = {
    gravado: true,
    registro: { id: 'r1', latitude: null, longitude: null, distancia_metros: null, no_local: null, ajuste_manual: false },
  }

  it('a batida com coordenada: os seis parâmetros de sempre, sem p_sem_localizacao', async () => {
    estado.respostaDaRpc = () => ({ data: GRAVADA, error: null })
    await registrarBatida({ ...BATIDA, local: COM_GPS })
    const { nome, args } = estado.rpcs[0]
    expect(nome).toBe('ponto_registrar_batida')
    expect(Object.keys(args).sort()).toEqual(
      ['p_latitude', 'p_longitude', 'p_pin', 'p_precisao_metros', 'p_registro_id', 'p_selfie_path'].sort(),
    )
    expect(args).toMatchObject({ p_latitude: -23.56, p_longitude: -46.61, p_precisao_metros: 12 })
  })

  it('a batida sem localização: a selfie sobe, a RPC recebe latitude e longitude nulas e o motivo', async () => {
    estado.respostaDaRpc = () => ({ data: GRAVADA, error: null })
    const resposta = await registrarBatida({ ...BATIDA, local: SEM_GPS })
    expect(estado.envios).toHaveLength(1)
    const { args } = estado.rpcs[0]
    expect(args).toMatchObject({
      p_latitude: null,
      p_longitude: null,
      p_precisao_metros: null,
      p_sem_localizacao: 'demora',
      p_pin: '1234',
      p_selfie_path: estado.envios[0].caminho,
    })
    // A RPC não devolve a origem; toda batida dela é do app — e é isso que
    // deixa o comprovante dizer "sem localização" sem reler.
    expect(resposta.gravado && resposta.registro.origem).toBe('app')
    expect(estado.remocoes).toEqual([])
  })

  it('o pedido sem localização: os oito parâmetros de sempre, nulos, mais o motivo', async () => {
    estado.respostaDaRpc = () => ({ data: { gravado: true, pedido: { id: 'x', estado: 'pendente' } }, error: null })
    await pedirBatidaEmAtraso({ ...DADOS, local: { tipo: 'sem_localizacao', motivo: 'indisponivel' } })
    const { nome, args } = estado.rpcs[0]
    expect(nome).toBe('ponto_pedir_batida_em_atraso')
    expect(args).toMatchObject({
      p_latitude: null,
      p_longitude: null,
      p_precisao_metros: null,
      p_sem_localizacao: 'indisponivel',
      p_motivo: DADOS.motivo,
      p_horario_declarado: DADOS.horarioDeclaradoISO,
    })
  })

  it('o pedido com coordenada continua sem p_sem_localizacao', async () => {
    estado.respostaDaRpc = () => ({ data: { gravado: true, pedido: { id: 'x', estado: 'pendente' } }, error: null })
    await pedirBatidaEmAtraso(DADOS)
    expect(Object.keys(estado.rpcs[0].args)).not.toContain('p_sem_localizacao')
  })

  it('a recusa do banco sem coordenada e sem motivo aceito: a foto sai, e a frase chega traduzida', async () => {
    estado.respostaDaRpc = () => ({
      data: null,
      status: 400,
      error: { code: 'P0001', message: 'Batida pelo app exige latitude e longitude' },
    })
    const falha = await registrarBatida({ ...BATIDA, local: SEM_GPS }).then(
      () => null,
      (erro: unknown) => erro,
    )
    expect(falha).toBeInstanceOf(ErroDeBatida)
    expect((falha as Error).message).toBe('A localização veio incompleta do aparelho. Tente de novo.')
    expect(estado.remocoes).toHaveLength(1)

    estado.remocoes = []
    estado.respostaDaRpc = () => ({
      data: null,
      status: 400,
      error: { code: 'P0001', message: 'Pedido de batida em atraso exige latitude e longitude' },
    })
    await expect(pedirBatidaEmAtraso({ ...DADOS, local: SEM_GPS })).rejects.toThrow(
      'A localização veio incompleta do aparelho. Tente de novo.',
    )
    expect(estado.remocoes).toHaveLength(1)
  })
})

/*
 * O SQL do banco, lido da migration da estrutura (uma só, com o banco
 * inteiro), pelo `import.meta.glob` do Vite (`?raw`): o `tsc -b` do app não
 * conhece `node:fs`. Sem o arquivo, ou com ele vazio, os testes de contrato
 * abaixo quebram em vez de passar no vazio.
 */
const migracoesDaEstrutura = import.meta.glob('../../supabase/migrations/*_ponto_livre_estrutura.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const SQL_DA_ESTRUTURA = Object.values(migracoesDaEstrutura).join('\n')

/** Um pedaço da migration que tem de existir: achado ou o teste para ali, dizendo o quê. */
function trechoDaEstrutura(expressao: RegExp, oQue: string): string {
  const achado = expressao.exec(SQL_DA_ESTRUTURA)?.[0]
  if (!achado) throw new Error(`${oQue} não está na migration da estrutura.`)
  return achado
}

/** A função inteira: o cabeçalho (com os parâmetros) e o corpo até o `$$;`. */
const funcaoDaEstrutura = (nome: string) =>
  trechoDaEstrutura(new RegExp(String.raw`CREATE FUNCTION public\.${nome}\([\s\S]*?\n\$\$;`), `A função ${nome}`)

/** O CREATE TABLE inteiro, com as colunas e as restrições. */
const tabelaDaEstrutura = (nome: string) =>
  trechoDaEstrutura(new RegExp(String.raw`CREATE TABLE public\.${nome} \([\s\S]*?\n\);`), `A tabela ${nome}`)

/*
 * O CONTRATO DA BATIDA SEM LOCALIZAÇÃO COM O BANCO DO PONTO. O app manda
 * `p_sem_localizacao` com 'indisponivel' ou 'demora'; o banco precisa ter o
 * parâmetro, com esse nome, nas duas funções, aceitar esses dois valores e
 * recusar com a frase que o app traduz.
 */
describe('o contrato da batida sem localização com o banco do ponto', () => {
  const sql = SQL_DA_ESTRUTURA

  it('as duas funções têm p_sem_localizacao text DEFAULT NULL como último parâmetro', () => {
    expect(Object.keys(migracoesDaEstrutura)).toHaveLength(1)
    expect(sql.trim()).not.toBe('')
    expect(sql).toMatch(
      /CREATE FUNCTION public\.ponto_registrar_batida\([^)]*p_precisao_metros double precision DEFAULT NULL::double precision, p_sem_localizacao text DEFAULT NULL::text\)/,
    )
    expect(sql).toMatch(
      /CREATE FUNCTION public\.ponto_pedir_batida_em_atraso\([^)]*p_motivo text, p_sem_localizacao text DEFAULT NULL::text\)/,
    )
  })

  it('os dois motivos que o app manda são os que o banco aceita, e a recusa tem a frase que o app traduz', () => {
    expect(sql).toContain("NOT IN ('indisponivel', 'demora')")
    expect(sql).toContain("'Batida pelo app exige latitude e longitude'")
    expect(sql).toContain("'Pedido de batida em atraso exige latitude e longitude'")
  })
})

/* ------------------------------------------------------------------ */
/* O contrato com a migration da estrutura                             */
/* ------------------------------------------------------------------ */

describe('o contrato com o banco (a migration da estrutura)', () => {
  // As duas RPCs inteiras (cabeçalho e corpo) e as duas tabelas que o app lê.
  const pedidoSql = funcaoDaEstrutura('ponto_pedir_batida_em_atraso')
  const decisaoSql = funcaoDaEstrutura('ponto_decidir_pedido_atraso')
  const tabelaDosPedidos = tabelaDaEstrutura('ponto_pedidos_atraso')
  const tabelaDasBatidas = tabelaDaEstrutura('ponto_registros')

  it('as frases que o app procura existem, palavra por palavra, nas RPCs aplicadas', () => {
    for (const frase of [
      'Horario declarado no futuro',
      'Horario declarado fora do dia de hoje',
      'Pedido de batida em atraso exige o horario declarado',
      'Motivo do pedido de batida em atraso precisa de pelo menos',
      'Motivo do pedido de batida em atraso pode ter no maximo',
      'Ja existe uma batida sua neste mesmo minuto',
      'Ja existe um pedido pendente seu para este mesmo horario',
      'Identificador do pedido ja usado',
      'Pedido exige o identificador do pedido',
      'Conta sem acesso',
      'Pedido de batida em atraso exige sessao de usuario',
      'Pedidos pendentes demais hoje',
    ]) {
      expect(pedidoSql, frase).toContain(frase)
    }
    // E a do teto de selfies, que a regra do bucket levanta pela função dela.
    expect(funcaoDaEstrutura('ponto_selfie_pode_subir')).toContain('Selfies demais nesta conta')
    for (const frase of [
      'Quem pediu a batida em atraso nao decide o proprio pedido',
      'Pedido de batida em atraso ja decidido',
      'Pedido de batida em atraso nao encontrado',
      'Recusar pedido de batida em atraso exige motivo',
      'Selfie do pedido nao esta mais no bucket',
      'Ja existe batida desta pessoa no mesmo minuto do pedido',
      'Decisao exige o pedido',
      'exclusivo de quem administra o ponto',
    ]) {
      expect(decisaoSql, frase).toContain(frase)
    }
  })

  it('os limites do motivo e os parâmetros das RPCs são os que o app usa', () => {
    expect(pedidoSql).toContain('c_motivo_minimo  constant integer  := 10;')
    expect(pedidoSql).toContain('c_motivo_maximo  constant integer  := 500;')
    for (const parametro of [
      'p_pin',
      'p_pedido_id',
      'p_selfie_path',
      'p_latitude',
      'p_longitude',
      'p_precisao_metros',
      'p_horario_declarado',
      'p_motivo',
    ]) {
      expect(pedidoSql).toMatch(new RegExp(`\\b${parametro}\\s`))
    }
    expect(decisaoSql).toMatch(/ponto_decidir_pedido_atraso\(\s*p_pedido_id uuid,\s*p_aprovar\s+boolean,\s*p_motivo\s+text\s*\)/)
  })

  it('as colunas que o app lê existem na tabela e na batida', () => {
    for (const coluna of [
      'horario_declarado',
      'dia_civil',
      'pedido_em',
      'selfie_path',
      'distancia_metros',
      'no_local',
      'estado',
      'decidido_por',
      'decidido_em',
      'motivo_decisao',
      'registro_id',
      'funcionario_nome',
      'funcionario_email',
    ]) {
      expect(tabelaDosPedidos, coluna).toMatch(new RegExp(`\\n  ${coluna}\\s`))
    }
    expect(tabelaDasBatidas).toMatch(/\n {2}pedido_atraso_id uuid,/)
  })
})
