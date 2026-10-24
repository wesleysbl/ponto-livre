import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ValorDoContexto } from './contexts/autenticacao'
import type { PedidoDeAtraso } from './lib/atraso'
import type { BatidaDoAdmin } from './lib/formato'

/*
 * AS TELAS DA BATIDA EM ATRASO ABREM SEM ERRO DE CONSOLE, COM O SUPABASE
 * SIMULADO.
 *
 * O que se confere: as telas de pedido e de pendências abrem sem erro com o
 * Supabase simulado. Mesmo desenho de `telas-de-pessoas.test.ts`: o projeto
 * testa em Node, sem DOM, então as telas são desenhadas com `renderToString` —
 * o primeiro desenho das páginas (a de bater, o espelho, o painel) e cada peça
 * nova com dados prontos. Qualquer `console.error` do React (chave repetida,
 * prop errada, elemento inválido) ou exceção no desenho reprova.
 *
 * O que `renderToString` NÃO roda: os efeitos (as leituras). Elas estão em
 * `lib/pedidos.test.ts`, contra o mesmo tipo de Supabase simulado.
 *
 * E as marcas, na tela: a batida de atraso aprovada diz "em atraso, aprovada
 * por…" na tela de bater, no espelho e no painel — e não "ajuste do admin".
 */

const auth = vi.hoisted(() => ({ valor: null as unknown }))

vi.mock('./lib/supabase', () => ({
  supabase: {
    from: () => {
      throw new Error('O desenho da tela não pode ler o banco.')
    },
    rpc: () => {
      throw new Error('O desenho da tela não pode chamar RPC.')
    },
    storage: {
      from: () => {
        throw new Error('O desenho da tela não pode tocar o bucket.')
      },
    },
    functions: { invoke: () => Promise.reject(new Error('sem rede')) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}))
vi.mock('./hooks/useAuth', () => ({ useAuth: () => auth.valor }))

const { Bater, ConfirmacaoDaExtra, FalhaDeLocalizacao } = await import('./pages/Bater')
const { Espelho } = await import('./pages/Espelho')
const { Painel } = await import('./pages/Painel')
const { FormularioDeAtraso, ReciboDoPedido } = await import('./components/PedidoDeAtraso')
const { MeusPedidosDeAtraso } = await import('./components/MeusPedidosDeAtraso')
const { PendenciasDeAtraso, ListaDePendencias, CaixaDeDecisao } = await import(
  './components/PendenciasDeAtraso'
)
const { ErroDaDecisao, desfechoDaFalhaDaDecisao } = await import('./lib/pedidos')
const { BatidasDoDia } = await import('./components/BatidasDoDia')
const { DiaDoEspelho } = await import('./components/DiaDoEspelho')
const { DiaDoPainel } = await import('./components/DiaDoPainel')
const { AjusteDeBatida } = await import('./components/AjusteDeBatida')
const { Aviso } = await import('./components/ui')
const { diaCivilDeHoje } = await import('./lib/formato')
const { FolhaParaImprimir } = await import('./components/FolhaParaImprimir')
const { VisorDeSelfie } = await import('./components/VisorDeSelfie')
const { Comprovante } = await import('./components/Comprovante')
const { agruparPorDia } = await import('./lib/horas')
const { montarFolha } = await import('./lib/folha')

/* ------------------------------------------------------------------ */

function contexto(administra: boolean): ValorDoContexto {
  return {
    usuario: { id: 'u-sessao', email: 'sessao@example.com' } as ValorDoContexto['usuario'],
    pin: { estado: 'ok', status: { definido: true, precisa_redefinir: false, bloqueado_ate: null } },
    acesso: {
      estado: 'ok',
      acesso: {
        temAcesso: true,
        administra,
        superAdmin: false,
        origem: 'ficha',
        batePonto: true,
        nome: 'Pessoa da Sessão',
        cargo: 'Analista',
      },
    },
    administracao: { estado: 'ok', administra },
    carregando: false,
    entrar: async () => ({ erro: null }),
    sair: async () => {},
    recarregar: async () => {},
  }
}

let errosDoConsole: unknown[][] = []

beforeEach(() => {
  errosDoConsole = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errosDoConsole.push(args)
  })
  auth.valor = contexto(false)
})

afterEach(() => {
  expect(errosDoConsole).toEqual([])
  vi.restoreAllMocks()
})

function desenhar(elemento: ReactElement): string {
  return renderToString(createElement(MemoryRouter, null, elemento))
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

/**
 * O texto visível, trecho por trecho e na ordem da tela: cada pedaço entre
 * duas tags. Os marcadores que o `renderToString` põe entre dois textos
 * vizinhos (`<!-- -->`) e o negrito saem antes, porque são parte da mesma
 * frase.
 */
function trechos(html: string): string[] {
  return html
    .replace(/<!-- -->|<\/?strong>/g, '')
    .split(/<[^>]+>/)
    .map((trecho) => texto(trecho).trim())
    .filter((trecho) => trecho !== '')
}

const nada = () => {}

function batida(hora: string, extras: Partial<BatidaDoAdmin> = {}): BatidaDoAdmin {
  return {
    id: `b-${hora}`,
    usuario_id: 'u1',
    registrado_em: `2026-10-15T${hora}:00.000-03:00`,
    dia_civil: '2026-10-15',
    tipo: 'entrada',
    ordem_no_dia: 1,
    latitude: -23.56,
    longitude: -46.61,
    precisao_metros: 10,
    distancia_metros: 20,
    no_local: true,
    selfie_path: `u1/2026/10/b-${hora}.jpg`,
    ajuste_manual: false,
    origem: 'app',
    motivo_ajuste: null,
    funcionario_nome: 'Fulana',
    funcionario_email: 'fulana@example.com',
    pedido_atraso_id: null,
    ...extras,
  }
}

const DE_ATRASO = batida('08:00', {
  id: 'b-atraso',
  ajuste_manual: true,
  origem: 'ajuste_admin',
  motivo_ajuste: 'Batida em atraso aprovada: celular sem bateria',
  pedido_atraso_id: 'pedido-1',
})
const DO_APP = batida('12:00', { tipo: 'saida_almoco', ordem_no_dia: 2 })
const AJUSTADA = batida('13:00', {
  tipo: 'volta_almoco',
  ordem_no_dia: 3,
  ajuste_manual: true,
  origem: 'ajuste_admin',
  selfie_path: null,
})
const APROVADORES = new Map<string, string | null>([['pedido-1', 'Sérgio']])

function pedido(id: string, extras: Partial<PedidoDeAtraso> = {}): PedidoDeAtraso {
  return {
    id,
    usuario_id: 'u1',
    horario_declarado: '2026-10-17T11:00:00.000Z',
    dia_civil: '2026-10-17',
    motivo: 'Cheguei às 8h e o celular estava sem bateria.',
    pedido_em: '2026-10-17T13:15:00.000Z',
    selfie_path: `u1/2026/10/${id}.jpg`,
    latitude: -23.56,
    longitude: -46.61,
    precisao_metros: 12,
    distancia_metros: 30,
    no_local: true,
    estado: 'pendente',
    decidido_por: null,
    decidido_em: null,
    motivo_decisao: null,
    registro_id: null,
    funcionario_nome: 'Fulana de Tal',
    funcionario_email: 'fulana@example.com',
    ...extras,
  }
}

/* ------------------------------------------------------------------ */
/* O colaborador                                                       */
/* ------------------------------------------------------------------ */

/** O `<button>` cujo texto contém `trecho`, inteiro (para afirmar o que está DENTRO dele). */
function botaoCom(html: string, trecho: string): string {
  const botoes = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g) ?? []
  const achado = botoes.find((botao) => texto(botao).includes(trecho))
  expect(achado, `um botão com "${trecho}"`).toBeDefined()
  return achado ?? ''
}

describe('o pedido, do lado do colaborador', () => {
  it('a tela de bater abre com a porta "Esqueci de bater hoje" e a quem recorrer em outro dia', () => {
    // A tela inteira, trecho por trecho, no primeiro desenho (a lista do dia
    // ainda carregando). A linha de cima é o cargo da ficha (sem cargo, seria
    // o rótulo genérico, "Funcionário"), e a saudação leva o primeiro nome.
    expect(trechos(desenhar(createElement(Bater)))).toEqual([
      'Ponto',
      'Sair',
      'Analista',
      'Olá, Pessoa',
      'Bater ponto',
      'selfie, localização e PIN',
      'Esqueci de bater hoje',
      'Esqueceu em outro dia? Avise o RH, que corrige pelo painel.',
      'Suas batidas de hoje',
      'Carregando…',
      'Ver meu espelho do mês',
    ])
  })

  /*
   * O botão diz qual batida a ordem do dia prevê — mas só depois de a lista
   * chegar. O primeiro desenho (`renderToString` não roda efeito: é o estado
   * com a lista carregando) é o instante "antes de a leitura assentar", e ali o
   * botão não pode dizer "Entrada" a quem talvez já tenha batido três vezes. Na
   * fumaça esse instante cabe numa microtarefa; aqui ele é determinístico.
   */
  it('antes de a leitura assentar, o botão diz "Bater ponto", e não "Entrada"', () => {
    const html = desenhar(createElement(Bater))
    const botao = texto(botaoCom(html, 'Bater'))
    expect(botao).toContain('Bater ponto')
    expect(botao).toContain('selfie, localização e PIN')
    expect(botao).not.toMatch(/Entrada|entrada|de 4 hoje/)
  })

  it('quem administra sem ficha não bate: nem botão de bater, nem atraso, nem espelho', () => {
    const soAdministra = contexto(true)
    soAdministra.acesso = {
      estado: 'ok',
      acesso: {
        temAcesso: true,
        administra: true,
        superAdmin: false,
        origem: 'administracao',
        batePonto: false,
        nome: 'Rita',
        cargo: null,
      },
    }
    auth.valor = soAdministra
    const html = texto(desenhar(createElement(Bater)))
    expect(html).toContain('Administração do ponto')
    expect(html).toContain('Olá, Rita')
    expect(html).toContain('Esta conta não bate ponto')
    expect(html).toContain('Corrigir ponto')
    expect(html).toContain('Painel do administrador')
    expect(html).not.toContain('Bater ponto')
    expect(html).not.toContain('Esqueci de bater')
    expect(html).not.toContain('Ver meu espelho do mês')
  })

  it('o formulário pede horário e motivo, com o máximo do relógio no minuto de agora', () => {
    const agora = () => new Date('2026-10-17T23:50:00-03:00')
    const html = desenhar(
      createElement(FormularioDeAtraso, { aoContinuar: nada, aoCancelar: nada, agora }),
    )
    expect(html).toContain('type="time"')
    expect(html).toContain('max="23:50"')
    // O formulário inteiro, trecho por trecho: só hoje, quem aprova é o RH, e
    // o outro dia tem caminho. Sem a lista de hoje, ele não afirma nada sobre
    // o dia.
    expect(trechos(html)).toEqual([
      'Registrar batida em atraso',
      'Para quando você chegou (ou saiu) e esqueceu de bater. Só vale para hoje e entra no seu ponto quando o RH aprovar. Esqueceu em outro dia? Avise o RH, que corrige pelo painel.',
      'Que horas você chegou ou saiu e esqueceu de bater?',
      'Motivo',
      'mínimo 10 letras · 0',
      'Continuar: selfie, localização e PIN',
    ])
  })

  it('o formulário mostra as batidas de hoje e onde a hora escolhida cai entre elas', () => {
    const hoje = [
      batida('08:02', { id: 'h1' }),
      batida('12:01', { id: 'h2', tipo: 'saida_almoco', ordem_no_dia: 2 }),
    ]
    const comDuas = texto(
      desenhar(
        createElement(FormularioDeAtraso, {
          inicial: { hora: '13:00', motivo: '' },
          batidasDeHoje: hoje,
          aoContinuar: nada,
          aoCancelar: nada,
        }),
      ),
    )
    expect(comDuas).toContain('Hoje você já bateu: 08:02 Entrada · 12:01 Almoço')
    expect(comDuas).toContain('Esse horário fica depois do Almoço (12:01).')

    const semNenhuma = texto(
      desenhar(createElement(FormularioDeAtraso, { batidasDeHoje: [], aoContinuar: nada, aoCancelar: nada })),
    )
    expect(semNenhuma).toContain('Hoje você ainda não bateu nenhuma.')
    expect(semNenhuma).not.toContain('Esse horário')
  })

  it('o formulário volta preenchido depois de um erro', () => {
    const html = desenhar(
      createElement(FormularioDeAtraso, {
        inicial: { hora: '08:00', motivo: 'celular sem bateria' },
        aoContinuar: nada,
        aoCancelar: nada,
      }),
    )
    expect(html).toContain('value="08:00"')
    expect(html).toContain('celular sem bateria')
  })

  it('o recibo diz "pedido enviado, aguardando aprovação", com os horários do servidor', () => {
    const html = texto(
      desenhar(
        createElement(ReciboDoPedido, {
          pedido: { ...pedido('p1'), estado: 'pendente' as const },
          miniatura: null,
          aoFechar: nada,
        }),
      ),
    )
    expect(html).toContain('Pedido enviado')
    // Quem aprova é o RH — o mesmo nome do formulário e do "Esqueci de bater hoje".
    expect(html).toContain('Aguardando aprovação do RH')
    expect(html).toContain('08:00')
    expect(html).toContain('enviado às 10:15')
    expect(html).toContain('não entra no seu ponto')
  })

  it('os pedidos aparecem separados das batidas: pendente, aprovado e recusado com o motivo', () => {
    const html = texto(
      desenhar(
        createElement(MeusPedidosDeAtraso, {
          titulo: 'Seus pedidos de batida em atraso',
          pedidos: [
            pedido('a'),
            pedido('b', { estado: 'aprovado', decidido_por: 'admin-1' }),
            pedido('c', { estado: 'recusado', decidido_por: 'admin-1', motivo_decisao: 'Estava de folga' }),
          ],
          nomes: new Map([['admin-1', 'Sérgio']]),
          mostrarDia: true,
        }),
      ),
    )
    expect(html).toContain('Aguardando aprovação')
    expect(html).toContain('Aprovado por Sérgio')
    expect(html).toContain('Recusado por Sérgio: Estava de folga')
    expect(html).toContain('pedido às 10:15')
  })

  it('sem pedido nenhum, a seção não aparece; com erro, mostra o erro', () => {
    expect(desenhar(createElement(MeusPedidosDeAtraso, { titulo: 'X', pedidos: [] }))).toBe('')
    const html = texto(
      desenhar(
        createElement(MeusPedidosDeAtraso, {
          titulo: 'X',
          pedidos: [],
          erro: 'Sem conexão com o servidor.',
          aoTentarDeNovo: nada,
        }),
      ),
    )
    expect(html).toContain('Sem conexão com o servidor.')
    expect(html).toContain('Tentar de novo')
  })

  it('o espelho abre', () => {
    const html = desenhar(createElement(Espelho))
    expect(texto(html)).toContain('Meu espelho de ponto')
    // O rodapé, inteiro: de onde saem as horas e o que fica fora do total.
    expect(trechos(/<footer\b[^>]*>(.*?)<\/footer>/s.exec(html)?.[1] ?? '')).toEqual([
      'As horas saem das suas batidas, com o horário oficial do ponto. Dia com batida faltando não entra no total até ser corrigido.',
    ])
  })
})

/* ------------------------------------------------------------------ */
/* Bater no celular sem recomeçar nem levar susto                      */
/* ------------------------------------------------------------------ */

describe('bater no celular sem recomeçar nem levar susto', () => {
  it('"Não achamos sua localização": tentar de novo (com a foto guardada), tirar outra foto e cancelar', () => {
    const html = desenhar(
      createElement(FalhaDeLocalizacao, {
        motivo: 'indisponivel',
        aoTentarDeNovo: nada,
        aoTirarOutraFoto: nada,
        aoCancelar: nada,
      }),
    )
    // A tela inteira, trecho por trecho: o que houve, o que a selfie guardada
    // permite, os três caminhos e, no rodapé, o que vale em qualquer um deles.
    // Sem quem trate "Bater sem localização", os caminhos são só estes três:
    // a tela oferece a batida sem localização com o caminho ligado (abaixo).
    expect(trechos(html)).toEqual([
      'Não achamos sua localização',
      'O GPS não respondeu. Chegue perto de uma janela ou saia da sala e tente de novo.',
      'Sua selfie está guardada: tentar de novo não abre a câmera.',
      'Tentar a localização de novo',
      'Tirar outra foto',
      'Cancelar',
      'Nada foi gravado ainda. A distância até o local não bloqueia a batida.',
    ])
    expect(texto(botaoCom(html, 'Tentar a localização de novo'))).toContain('Tentar a localização de novo')
    expect(texto(botaoCom(html, 'Tirar outra foto'))).toContain('Tirar outra foto')
    expect(texto(botaoCom(html, 'Cancelar'))).toContain('Cancelar')
  })

  it('na demora, a frase diz que a próxima tentativa é mais rápida; da segunda falha em diante, "Ainda não deu"', () => {
    const demora = texto(
      desenhar(
        createElement(FalhaDeLocalizacao, {
          motivo: 'demora',
          doPedido: true,
          aoTentarDeNovo: nada,
          aoTirarOutraFoto: nada,
          aoCancelar: nada,
        }),
      ),
    )
    expect(demora).toContain('A localização está demorando. Vamos tentar de novo de um jeito mais rápido.')
    // No pedido de batida em atraso, o rodapé fala do pedido.
    expect(demora).toContain('Nada foi enviado ainda. A distância até o local não bloqueia o pedido.')

    const deNovo = texto(
      desenhar(
        createElement(FalhaDeLocalizacao, {
          motivo: 'demora',
          tentativas: 2,
          aoTentarDeNovo: nada,
          aoTirarOutraFoto: nada,
          aoCancelar: nada,
        }),
      ),
    )
    expect(deNovo).toContain('Ainda não deu.')
  })

  it('"Você já fechou o dia": quantas batidas, a última, e "Voltar" antes de "Bater mesmo assim"', () => {
    const quatro = [
      batida('08:02', { id: 'q1' }),
      batida('12:01', { id: 'q2', tipo: 'saida_almoco', ordem_no_dia: 2 }),
      batida('13:00', { id: 'q3', tipo: 'volta_almoco', ordem_no_dia: 3 }),
      batida('18:01', { id: 'q4', tipo: 'saida', ordem_no_dia: 4 }),
    ]
    const html = desenhar(createElement(ConfirmacaoDaExtra, { batidas: quatro, aoVoltar: nada, aoConfirmar: nada }))
    const lido = texto(html)
    expect(lido).toContain('Você já fechou o dia')
    expect(lido).toContain(
      'Suas 4 batidas de hoje já estão registradas (última às 18:01). Uma batida a mais entra como extra e deixa o dia incompleto até a próxima.',
    )
    expect(lido.indexOf('Voltar')).toBeLessThan(lido.indexOf('Bater mesmo assim'))
    // "Voltar" é o botão verde; "Bater mesmo assim", o secundário.
    expect(botaoCom(html, 'Voltar')).toContain('bg-luz')
    expect(botaoCom(html, 'Bater mesmo assim')).not.toContain('bg-luz ')
  })

  it('a lista do dia diz de quando ela é: "Atualizado às 07:58"', () => {
    const html = texto(
      desenhar(
        createElement(BatidasDoDia, {
          batidas: [DO_APP],
          carregando: false,
          erro: null,
          aoTentarDeNovo: nada,
          atualizadoEm: '07:58',
        }),
      ),
    )
    expect(html).toContain('Atualizado às 07:58')
    // Carregando, a linha some (a hora seria da leitura anterior).
    const carregando = texto(
      desenhar(
        createElement(BatidasDoDia, {
          batidas: [DO_APP],
          carregando: true,
          erro: null,
          aoTentarDeNovo: nada,
          atualizadoEm: '07:58',
        }),
      ),
    )
    expect(carregando).not.toContain('Atualizado às')
  })

  it('o espelho não acusa hoje: ímpar e hoje é "Em andamento"; ímpar em outro dia manda avisar o RH', () => {
    const tres = [DE_ATRASO, DO_APP, AJUSTADA]
    const [dia] = agruparPorDia(tres)
    // As três batidas, com as marcas de cada uma: iguais nos dois dias.
    const asTresBatidas = [
      '08:00',
      'Entrada',
      'em atraso, aprovada',
      'no local',
      '12:00',
      'Almoço',
      'no local',
      '13:00',
      'Volta',
      'ajuste do admin',
      'no local',
      'sem foto',
    ]

    // O dia inteiro, trecho por trecho: hoje, a etiqueta e a frase são as do
    // dia em andamento.
    expect(trechos(desenhar(createElement(DiaDoEspelho, { dia, aoAbrirSelfie: nada, ehHoje: true })))).toEqual([
      'Qui, 15 de out',
      '3 batidas',
      'Em andamento',
      'Dia em andamento. As horas de hoje entram no total quando você bater a próxima.',
      ...asTresBatidas,
    ])

    // Em outro dia, o dia incompleto, e a quem avisar.
    expect(trechos(desenhar(createElement(DiaDoEspelho, { dia, aoAbrirSelfie: nada })))).toEqual([
      'Qui, 15 de out',
      '3 batidas',
      'Dia incompleto',
      'Falta uma batida neste dia, por isso as horas dele não entram no total. Avise o RH qual horário faltou.',
      ...asTresBatidas,
    ])
  })
})

/* ------------------------------------------------------------------ */
/* As marcas                                                           */
/* ------------------------------------------------------------------ */

describe('a marca da batida em atraso aprovada', () => {
  it('na tela de bater: "em atraso, aprovada por Sérgio", e não "ajuste do admin"', () => {
    const html = texto(
      desenhar(
        createElement(BatidasDoDia, {
          batidas: [DE_ATRASO, DO_APP],
          carregando: false,
          erro: null,
          aoTentarDeNovo: nada,
          aprovadores: APROVADORES,
        }),
      ),
    )
    expect(html).toContain('em atraso, aprovada por Sérgio')
    expect(html).not.toContain('ajuste do admin')
  })

  it('no espelho: a de atraso com a marca dela, o ajuste com a dele', () => {
    const [dia] = agruparPorDia([DE_ATRASO, DO_APP, AJUSTADA])
    const html = texto(
      desenhar(createElement(DiaDoEspelho, { dia, aoAbrirSelfie: nada, aprovadores: APROVADORES })),
    )
    expect(html).toContain('em atraso, aprovada por Sérgio')
    expect(html.match(/ajuste do admin/g)).toHaveLength(1)
  })

  it('no painel: idem', () => {
    const [dia] = agruparPorDia([DE_ATRASO, DO_APP, AJUSTADA])
    const html = texto(
      desenhar(
        createElement(DiaDoPainel, {
          dia,
          aoAbrirSelfie: nada,
          aoCorrigir: nada,
          aoInserirNesteDia: nada,
          aprovadores: APROVADORES,
        }),
      ),
    )
    expect(html).toContain('em atraso, aprovada por Sérgio')
  })

  it('na folha impressa: a marca e a legenda', () => {
    const folha = montarFolha({
      empresa: null,
      funcionario: { nome: 'Fulana', email: null },
      mes: '2026-10',
      batidas: [DE_ATRASO, DO_APP],
      aprovadores: APROVADORES,
    })
    const html = texto(desenhar(createElement(FolhaParaImprimir, { folha })))
    expect(html).toContain('Em atraso, aprovada por Sérgio: 08:00')
    expect(html).toContain('Em atraso, aprovada:')
  })

  it('o visor abre a selfie de um pedido, que não tem tipo', () => {
    const html = texto(
      desenhar(
        createElement(VisorDeSelfie, {
          batida: {
            registrado_em: '2026-10-17T11:00:00.000Z',
            selfie_path: 'u1/2026/10/p1.jpg',
            distancia_metros: 30,
            no_local: true,
          },
          descricao: 'Pedido de batida em atraso',
          aoFechar: nada,
        }),
      ),
    )
    expect(html).toContain('Pedido de batida em atraso')
  })
})

/* ------------------------------------------------------------------ */
/* O admin                                                             */
/* ------------------------------------------------------------------ */

describe('a caixa de pendências do admin', () => {
  it('o painel abre com a caixa no topo, contando', () => {
    auth.valor = contexto(true)
    const html = texto(desenhar(createElement(Painel)))
    expect(html).toContain('Batidas em atraso para decidir')
    expect(html).toContain('Fechamento do período')
  })

  it('a caixa sozinha abre carregando', () => {
    auth.valor = contexto(true)
    const html = texto(desenhar(createElement(PendenciasDeAtraso)))
    expect(html).toContain('Carregando')
  })

  it('cada pedido mostra quem, horário pedido, horário real, motivo, local e selfie', () => {
    const html = desenhar(
      createElement(ListaDePendencias, {
        estado: { nome: 'pronto', pedidos: [pedido('p1'), pedido('p2', { funcionario_nome: 'Beltrano' })] },
        usuarioId: 'u-sessao',
        aoTentarDeNovo: nada,
        aoAbrirSelfie: nada,
        aoDecidir: nada,
      }),
    )
    const visivel = texto(html)
    expect(html).toContain('aria-label="2 pendentes"')
    expect(visivel).toContain('Fulana de Tal')
    expect(visivel).toContain('Beltrano')
    expect(visivel).toContain('Horário pedido 08:00')
    expect(visivel).toContain('Pedido às 10:15')
    expect(visivel).toContain('2h15 depois')
    expect(visivel).toContain('Cheguei às 8h e o celular estava sem bateria.')
    expect(visivel).toContain('no local no momento do pedido')
    expect(html).toContain('Ver a selfie do pedido das 08:00')
    expect(visivel.match(/Aprovar/g)).toHaveLength(2)
    expect(visivel.match(/Recusar/g)).toHaveLength(2)
  })

  it('o pedido da própria sessão não tem botão de decidir', () => {
    const visivel = texto(
      desenhar(
        createElement(ListaDePendencias, {
          estado: { nome: 'pronto', pedidos: [pedido('meu', { usuario_id: 'u-sessao' })] },
          usuarioId: 'u-sessao',
          aoTentarDeNovo: nada,
          aoAbrirSelfie: nada,
          aoDecidir: nada,
        }),
      ),
    )
    expect(visivel).toContain('Este pedido é seu')
    expect(visivel).not.toContain('Aprovar')
  })

  it('fila vazia e falha de leitura têm frase própria', () => {
    const vazia = texto(
      desenhar(
        createElement(ListaDePendencias, {
          estado: { nome: 'pronto', pedidos: [] },
          usuarioId: null,
          aoTentarDeNovo: nada,
          aoAbrirSelfie: nada,
          aoDecidir: nada,
        }),
      ),
    )
    expect(vazia).toContain('Nenhum pedido esperando decisão')
    const falhou = texto(
      desenhar(
        createElement(ListaDePendencias, {
          estado: { nome: 'falhou', mensagem: 'Sem conexão com o servidor.' },
          usuarioId: null,
          aoTentarDeNovo: nada,
          aoAbrirSelfie: nada,
          aoDecidir: nada,
        }),
      ),
    )
    expect(falhou).toContain('Sem conexão com o servidor.')
  })

  it('as caixas de aprovar e de recusar abrem; a de recusar pede motivo', () => {
    const aprovar = texto(
      desenhar(
        createElement(CaixaDeDecisao, {
          decisao: { pedido: pedido('p1'), aprovar: true },
          aoFechar: nada,
          aoGravar: nada,
          aoListaVelha: nada,
        }),
      ),
    )
    expect(aprovar).toContain('Aprovar batida em atraso')
    expect(aprovar).toContain('Observação (opcional)')
    const recusar = texto(
      desenhar(
        createElement(CaixaDeDecisao, {
          decisao: { pedido: pedido('p1'), aprovar: false },
          aoFechar: nada,
          aoGravar: nada,
          aoListaVelha: nada,
        }),
      ),
    )
    expect(recusar).toContain('Recusar batida em atraso')
    expect(recusar).toContain('Motivo da recusa')
  })

  it('pedido já decidido por outra pessoa: a caixa fecha, mas a frase aparece em cima da lista', () => {
    // Fechar e reler a lista EM SILÊNCIO faria o pedido sumir como se a
    // decisão deste admin tivesse sido gravada — e pode ter sido o contrário
    // (ele aprovou; o outro já tinha recusado).
    const velha = desfechoDaFalhaDaDecisao(
      new ErroDaDecisao('Pedido de batida em atraso ja decidido: esta recusado'),
    )
    expect(velha.nome).toBe('lista_velha')
    if (velha.nome !== 'lista_velha') return
    expect(velha.aviso.tom).toBe('atencao')
    expect(velha.aviso.texto).toContain('já foi decidido')

    const sumiu = desfechoDaFalhaDaDecisao(new ErroDaDecisao('Pedido de batida em atraso nao encontrado'))
    expect(sumiu.nome).toBe('lista_velha')

    const outra = desfechoDaFalhaDaDecisao(new ErroDaDecisao('Selfie do pedido nao esta mais no bucket'))
    expect(outra.nome).toBe('erro')
    expect(desfechoDaFalhaDaDecisao('???')).toEqual({ nome: 'erro', mensagem: 'Não deu para gravar a decisão.' })

    const html = desenhar(
      createElement(ListaDePendencias, {
        estado: { nome: 'pronto', pedidos: [] },
        usuarioId: null,
        aviso: velha.aviso,
        aoTentarDeNovo: nada,
        aoAbrirSelfie: nada,
        aoDecidir: nada,
      }),
    )
    expect(texto(html)).toContain('já foi decidido')
    expect(html).toContain('bg-warn-soft')
  })
})

/* ------------------------------------------------------------------ */
/* Corrigir o ponto da pessoa sem errar                                */
/* ------------------------------------------------------------------ */

describe('corrigir sem errar: a lista do dia e a caixa', () => {
  /** Uma batida de sex., 16/10, na posição certa do dia. */
  function de16(hora: string, ordem: number, extras: Partial<BatidaDoAdmin> = {}): BatidaDoAdmin {
    const tipos = ['entrada', 'saida_almoco', 'volta_almoco', 'saida', 'extra'] as const
    return batida(hora, {
      id: `b16-${hora}`,
      registrado_em: `2026-10-16T${hora}:00.000-03:00`,
      dia_civil: '2026-10-16',
      tipo: tipos[Math.min(ordem - 1, 4)],
      ordem_no_dia: ordem,
      ...extras,
    })
  }
  const TRES = [de16('08:00', 1), de16('12:00', 2), de16('17:00', 3)]
  const QUATRO = [de16('08:00', 1), de16('12:00', 2), de16('13:00', 3), de16('17:00', 4)]
  const DEPOIS_DO_DIA_16 = () => new Date('2026-10-21T12:00:00.000-03:00')

  function diaDoPainel(batidas: BatidaDoAdmin[], extras: Record<string, unknown> = {}) {
    const [dia] = agruparPorDia(batidas)
    return desenhar(
      createElement(DiaDoPainel, { dia, aoAbrirSelfie: nada, aoCorrigir: nada, aoInserirNesteDia: nada, ...extras }),
    )
  }

  type PropsDaCaixa = Parameters<typeof AjusteDeBatida>[0]
  function caixa(props: Partial<PropsDaCaixa> & Pick<PropsDaCaixa, 'modo'>) {
    return desenhar(
      createElement(AjusteDeBatida, {
        usuarioId: 'u1',
        nomeDoFuncionario: 'Ana Beatriz Rocha',
        correcoes: [],
        nomeDoAutor: () => 'Rita',
        aoFechar: nada,
        aoGravar: nada,
        agora: DEPOIS_DO_DIA_16,
        batidasDaTela: { periodo: { inicio: '2026-10-01', fim: '2026-10-31' }, batidas: TRES },
        ...props,
      }),
    )
  }

  it('dia com 4 batidas: "Corrigir" visível em cada uma, sem botão dentro de botão', () => {
    const html = diaDoPainel(QUATRO)
    expect(texto(html).match(/\bCorrigir\b/g)).toHaveLength(4)
    // O "Corrigir" é um rótulo dentro do botão da linha, e não outro botão.
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/)
    // A linha diz o que faz para o leitor de tela, e o rótulo visível não é lido duas vezes.
    expect(html).toContain('aria-label="Corrigir a batida das 17:00"')
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>Corrigir<\/span>/)
    // Dia par: os tipos do banco, e o total.
    expect(texto(html)).toContain('Entrada')
    expect(texto(html)).toContain('Saída')
    expect(texto(html)).toContain('8h00')
  })

  it('dia de antes de hoje com 3 batidas: o que falta, o botão que resolve e as posições no lugar dos tipos', () => {
    const html = texto(diaDoPainel(TRES))
    expect(html).toContain('Falta 1 batida neste dia, e por isso ele não soma horas.')
    expect(html).toContain('Inserir a batida que falta')
    expect(html).not.toContain('Inserir batida neste dia')
    expect(html).toContain('1ª batida')
    expect(html).toContain('2ª batida')
    expect(html).toContain('3ª batida (última)')
    // O banco chama a das 17:00 de "Volta" (é a 3ª): na lista ela não ganha esse nome.
    expect(html).not.toContain('Volta')
    expect(html).not.toContain('Número ímpar')
  })

  it('hoje com 1 batida: "Em andamento", sem o botão primário, com o tipo da batida', () => {
    const hoje = diaCivilDeHoje()
    const entrada = batida('08:00', { id: 'b-hoje', registrado_em: `${hoje}T08:00:00.000-03:00`, dia_civil: hoje })
    const html = texto(diaDoPainel([entrada], { ehHoje: true }))
    expect(html).toContain('Em andamento')
    expect(html).toContain('A pessoa ainda pode bater hoje.')
    expect(html).toContain('Inserir batida neste dia')
    expect(html).not.toContain('Inserir a batida que falta')
    expect(html).not.toContain('Falta 1 batida')
    expect(html).not.toContain('Dia incompleto')
    expect(html).toContain('Entrada')
    expect(html).not.toContain('Única batida')
  })

  it('a caixa de inserir mostra o dia por extenso, as batidas que ele já tem e o aviso de que não se apaga', () => {
    const html = texto(caixa({ modo: { nome: 'inserir', diaSugerido: '2026-10-16' } }))
    expect(html).toContain('Sexta-feira, 16 de outubro')
    expect(html).toContain('Já registradas neste dia: 08:00 · 12:00 · 17:00')
    expect(html).toContain('Batida inserida não se apaga. Confira o dia e a hora antes de gravar.')
    expect(html).toContain('Inserir e continuar')
    // Sem hora ainda, o botão não promete um horário.
    expect(html).toContain('Inserir batida')
    expect(html).toContain('Cancelar')
  })

  it('dia vazio e dia fora do período lido têm frase própria', () => {
    expect(texto(caixa({ modo: { nome: 'inserir', diaSugerido: '2026-10-17' } }))).toContain(
      'Nenhuma batida neste dia ainda.',
    )
    expect(texto(caixa({ modo: { nome: 'inserir', diaSugerido: '2026-09-30' } }))).toContain(
      'Este dia está fora do período que você está vendo; as batidas dele não aparecem aqui.',
    )
  })

  it('a caixa de corrigir num dia ímpar: o horário no ponto sem jargão, sem o tipo, e o aviso de que o que falta é inserir', () => {
    const html = caixa({ modo: { nome: 'corrigir', batida: TRES[2] } })
    const lido = texto(html)
    expect(lido).toContain('Horário que está no ponto: 17:00')
    expect(lido).toContain('3ª batida de sex., 16/10.')
    expect(lido).toContain('O horário anterior fica guardado.')
    expect(lido).not.toContain('Volta do almoço')
    expect(lido).toContain('Este dia está com uma batida faltando.')
    expect(lido).toContain('feche e use “Inserir a batida que falta”')
    // O dia é texto, com o link para mudar; o campo de data não abre sozinho.
    expect(lido).toContain('Dia: sex., 16/10')
    expect(lido).toContain('mudar o dia desta batida')
    expect(html).not.toContain('id="ajuste-dia"')
    // Nada mudou ainda: "Gravar correção", desabilitado. A Hora é o foco inicial (com mouse).
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Gravar correção/)
    expect(html).toMatch(/<input id="ajuste-hora" data-foco-inicial=/)
  })

  it('a caixa de corrigir num dia completo diz o tipo e a posição, e a trilha fala a língua do RH', () => {
    const lido = texto(
      caixa({
        modo: { nome: 'corrigir', batida: QUATRO[3] },
        batidasDaTela: { periodo: { inicio: '2026-10-01', fim: '2026-10-31' }, batidas: QUATRO },
        correcoes: [
          {
            id: 'c1',
            registro_id: QUATRO[3].id,
            usuario_id: 'u1',
            motivo: 'Saiu às 17h, bateu às 18h',
            campos: ['registrado_em', 'dia_civil'],
            valores_antes: { registrado_em: '2026-10-16T21:00:00.000Z' },
            valores_depois: { registrado_em: '2026-10-16T20:00:00.000Z' },
            autor_id: 'u-rita',
            criado_em: '2026-10-20T12:00:00.000Z',
            natureza: 'admin',
          },
        ],
      }),
    )
    expect(lido).toContain('Horário que está no ponto: 17:00 — Saída, 4ª batida de sex., 16/10.')
    expect(lido).not.toContain('Este dia está com uma batida faltando')
    expect(lido).toContain('mudou: horário e dia')
    expect(lido).not.toContain('campos:')
    expect(lido).not.toContain('registrado_em')
  })

  it('o aviso interrompe só no erro e na atenção; a confirmação espera a vez', () => {
    const papel = (tom: 'erro' | 'atencao' | 'bom' | 'neutro') =>
      desenhar(createElement(Aviso, { tom, children: 'x' })).match(/role="(\w+)"/)?.[1]
    expect(papel('erro')).toBe('alert')
    expect(papel('atencao')).toBe('alert')
    expect(papel('bom')).toBe('status')
    expect(papel('neutro')).toBe('status')
  })
})

/* ------------------------------------------------------------------ */
/* Bater sem localização                                               */
/* ------------------------------------------------------------------ */

describe('bater sem localização quando o GPS não responde', () => {
  const LINHA_DA_BATIDA =
    'A batida sai com a sua foto e o PIN, marcada como sem localização. Prefira tentar de novo perto de uma janela.'

  /** A batida do app que saiu sem localização: o GPS não respondeu. */
  const SEM_GPS = batida('12:00', {
    id: 'b-sem-gps',
    tipo: 'saida_almoco',
    ordem_no_dia: 2,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    distancia_metros: null,
    no_local: null,
  })
  /** A inserida pelo admin: também sem coordenada, mas porque não houve celular. */
  const DO_ADMIN = batida('13:00', {
    id: 'b-admin',
    tipo: 'volta_almoco',
    ordem_no_dia: 3,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    distancia_metros: null,
    no_local: null,
    selfie_path: null,
    ajuste_manual: true,
    origem: 'ajuste_admin',
    motivo_ajuste: 'Esqueceu a volta',
  })

  function falha(motivo: 'demora' | 'indisponivel', doPedido = false) {
    return desenhar(
      createElement(FalhaDeLocalizacao, {
        motivo,
        doPedido,
        aoTentarDeNovo: nada,
        aoBaterSemLocalizacao: nada,
        aoTirarOutraFoto: nada,
        aoCancelar: nada,
      }),
    )
  }

  it('com "demora": "Bater sem localização", depois de "Tentar a localização de novo", com a linha que explica', () => {
    const html = falha('demora')
    const lido = texto(html)
    expect(texto(botaoCom(html, 'Bater sem localização'))).toContain('Bater sem localização')
    expect(lido).toContain(LINHA_DA_BATIDA)
    // Tentar de novo continua sendo o caminho principal (o botão verde); bater
    // sem localização é o secundário, antes de tirar outra foto.
    expect(botaoCom(html, 'Tentar a localização de novo')).toContain('bg-luz')
    expect(botaoCom(html, 'Bater sem localização')).not.toContain('bg-luz ')
    expect(lido.indexOf('Tentar a localização de novo')).toBeLessThan(lido.indexOf('Bater sem localização'))
    expect(lido.indexOf('Bater sem localização')).toBeLessThan(lido.indexOf('Tirar outra foto'))
    // A selfie é a mesma: o texto de "foto guardada" continua.
    expect(lido).toContain('Sua selfie está guardada')
  })

  it('com "indisponivel" também; no pedido em atraso, o mesmo botão fala do pedido', () => {
    expect(texto(falha('indisponivel'))).toContain('Bater sem localização')
    const pedidoLido = texto(falha('demora', true))
    expect(pedidoLido).toContain('Enviar o pedido sem localização')
    expect(pedidoLido).toContain(
      'O pedido sai com a sua foto e o PIN, marcado como sem localização. Prefira tentar de novo perto de uma janela.',
    )
    expect(pedidoLido).not.toContain('Bater sem localização')
  })

  it('o comprovante da batida sem localização diz "Sem localização (o GPS não respondeu)", sem "no local" nem "fora"', () => {
    const semGps = texto(desenhar(createElement(Comprovante, { batida: SEM_GPS, miniatura: null, aoFechar: nada })))
    expect(semGps).toContain('Batida registrada')
    expect(semGps).toContain('Sem localização (o GPS não respondeu)')
    expect(semGps).toContain('A batida valeu com a sua foto e o PIN')
    expect(semGps).not.toMatch(/No local|Fora do local|do local ·/)

    const comGps = texto(desenhar(createElement(Comprovante, { batida: DO_APP, miniatura: null, aoFechar: nada })))
    expect(comGps).toContain('No local')
    expect(comGps).not.toContain('Sem localização')
  })

  it('o recibo do pedido sem localização diz o mesmo', () => {
    const recibo = texto(
      desenhar(
        createElement(ReciboDoPedido, {
          pedido: {
            ...pedido('p-sem-gps'),
            latitude: null,
            longitude: null,
            precisao_metros: null,
            distancia_metros: null,
            no_local: null,
            estado: 'pendente',
          },
          miniatura: null,
          aoFechar: nada,
        }),
      ),
    )
    expect(recibo).toContain('Sem localização (o GPS não respondeu)')
    expect(recibo).not.toContain('Sem distância calculada')
  })

  it('a lista de hoje e o espelho: etiqueta "sem localização" na do app; a do admin continua sem marca de local', () => {
    const hoje = texto(
      desenhar(createElement(BatidasDoDia, { batidas: [DO_APP, SEM_GPS, DO_ADMIN], carregando: false, erro: null, aoTentarDeNovo: nada })),
    )
    expect(hoje.match(/sem localização/g)).toHaveLength(1)
    expect(hoje).toContain('no local')
    expect(hoje).toContain('ajuste do admin')

    const [dia] = agruparPorDia([DO_APP, SEM_GPS, DO_ADMIN])
    const espelho = texto(desenhar(createElement(DiaDoEspelho, { dia, aoAbrirSelfie: nada })))
    expect(espelho.match(/sem localização/g)).toHaveLength(1)
  })

  it('o dia no painel: etiqueta neutra na batida sem localização, pino de sempre na do admin', () => {
    const [dia] = agruparPorDia([DO_APP, SEM_GPS, DO_ADMIN])
    const html = desenhar(
      createElement(DiaDoPainel, { dia, aoAbrirSelfie: nada, aoCorrigir: nada, aoInserirNesteDia: nada }),
    )
    // Uma etiqueta (o ícone de localização desligada) — só a do GPS que não respondeu.
    expect(html.match(/lucide-locate-off/g)).toHaveLength(1)
    // A do admin segue como hoje: o pino apagado, "sem localização", e "ajuste".
    expect(texto(html)).toContain('ajuste')
    expect(texto(html)).toContain('no local')
  })

  it('a caixa de pendências: o pedido sem localização mostra a etiqueta, e aprovar diz como a batida entra', () => {
    const semGps = pedido('p-sem-gps', {
      latitude: null,
      longitude: null,
      precisao_metros: null,
      distancia_metros: null,
      no_local: null,
    })
    const lista = texto(
      desenhar(
        createElement(ListaDePendencias, {
          estado: { nome: 'pronto', pedidos: [semGps] },
          usuarioId: 'u-sessao',
          aoTentarDeNovo: nada,
          aoAbrirSelfie: nada,
          aoDecidir: nada,
        }),
      ),
    )
    expect(lista).toContain('sem localização')
    expect(lista).toContain('o GPS não respondeu no momento do pedido')
    expect(lista).not.toContain('no local no momento do pedido')

    const aprovar = texto(
      desenhar(
        createElement(CaixaDeDecisao, {
          decisao: { pedido: semGps, aprovar: true },
          aoFechar: nada,
          aoGravar: nada,
          aoListaVelha: nada,
        }),
      ),
    )
    expect(aprovar).toContain('com a selfie do pedido e marcada como sem localização (o GPS não respondeu)')
  })

  it('a folha impressa marca o horário que saiu sem localização, em palavra', () => {
    const folha = montarFolha({
      empresa: null,
      funcionario: { nome: 'Fulana', email: null },
      mes: '2026-10',
      batidas: [DO_APP, SEM_GPS],
    })
    const html = texto(desenhar(createElement(FolhaParaImprimir, { folha })))
    expect(html).toContain('Sem localização (o GPS não respondeu): 12:00')
  })
})
