import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ValorDoContexto } from './contexts/autenticacao'
import type { Ausencia } from './lib/ausencias'
import type { BatidaDoAdmin } from './lib/formato'

/*
 * AS TELAS DAS AUSÊNCIAS ABREM SEM ERRO DE CONSOLE, COM O SUPABASE SIMULADO.
 *
 * O que se confere: a tela de lançar abre sem erro com o Supabase simulado.
 * Mesmo desenho de `telas-de-atraso.test.ts`: o projeto testa em Node, sem
 * DOM, e as telas são desenhadas com `renderToString` — o primeiro
 * desenho das páginas (painel da pessoa, painel, folha, espelho) e cada peça
 * nova com dados prontos. Qualquer `console.error` do React ou exceção no
 * desenho reprova; o Supabase simulado levanta se o DESENHO tentar ler o banco.
 *
 * As leituras e escritas, que rodam em efeito, estão em `lib/faltas.test.ts`.
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

const { Espelho } = await import('./pages/Espelho')
const { Painel } = await import('./pages/Painel')
const { PainelDaPessoa } = await import('./pages/PainelDaPessoa')
const { Folha } = await import('./pages/Folha')
const { LancamentoDeAusencia } = await import('./components/LancamentoDeAusencia')
const { AusenciasDoPeriodo, CaixaDeCancelamento } = await import('./components/AusenciasDoPeriodo')
const { DiaDeAusencia } = await import('./components/DiaDeAusencia')
const { DiaDoEspelho } = await import('./components/DiaDoEspelho')
const { DiaDoPainel } = await import('./components/DiaDoPainel')
const { VisorDeAtestado } = await import('./components/VisorDeAtestado')
const { FolhaParaImprimir } = await import('./components/FolhaParaImprimir')
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
  auth.valor = contexto(true)
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

const nada = () => {}

function ausencia(id: string, extras: Partial<Ausencia> = {}): Ausencia {
  return {
    id,
    usuario_id: 'u1',
    dia_inicio: '2026-10-14',
    dia_fim: '2026-10-16',
    tipo: 'atestado_medico',
    observacao: 'consulta às 9h',
    atestado_path: `u1/${id}.jpg`,
    lancado_por: 'admin-1',
    lancado_em: '2026-10-17T12:00:00.000Z',
    cancelada_em: null,
    cancelada_por: null,
    motivo_cancelamento: null,
    ...extras,
  }
}

const ATIVA = ausencia('a-ativa')
const CANCELADA = ausencia('a-cancelada', {
  dia_inicio: '2026-10-22',
  dia_fim: '2026-10-22',
  tipo: 'falta_justificada',
  observacao: null,
  atestado_path: null,
  cancelada_em: '2026-10-17T13:00:00.000Z',
  cancelada_por: 'admin-2',
  motivo_cancelamento: 'lançada para a pessoa errada',
})

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

const NOMES = new Map([
  ['admin-1', 'Sérgio'],
  ['admin-2', 'Ana'],
])

/* ------------------------------------------------------------------ */

describe('as páginas abrem com as ausências no lugar', () => {
  it('o painel da pessoa abre (carregando) sem ler o banco no desenho', () => {
    const html = texto(desenhar(createElement(PainelDaPessoa)))
    expect(html).toContain('Lançar falta justificada')
  })

  it('o painel de todos abre', () => {
    expect(texto(desenhar(createElement(Painel)))).toContain('Fechamento do período')
  })

  it('a folha abre', () => {
    expect(texto(desenhar(createElement(Folha)))).toContain('Folha para assinar')
  })

  it('o espelho do colaborador abre', () => {
    auth.valor = contexto(false)
    expect(texto(desenhar(createElement(Espelho)))).toContain('Seu mês')
  })
})

describe('a tela de lançar', () => {
  it('abre com dia, tipo, observação e as duas portas do atestado', () => {
    const html = texto(
      desenhar(
        createElement(LancamentoDeAusencia, {
          usuarioId: 'u1',
          nomeDoFuncionario: 'Fulana de Tal',
          diaSugerido: '2026-10-15',
          aoFechar: nada,
          aoLancada: nada,
        }),
      ),
    )
    expect(html).toContain('Fulana de Tal')
    expect(html).toContain('Primeiro dia')
    expect(html).toContain('Último dia')
    expect(html).toContain('Atestado médico')
    expect(html).toContain('Falta justificada')
    expect(html).toContain('Outro motivo')
    expect(html).toContain('Fotografar')
    expect(html).toContain('Arquivo')
    expect(html).toContain('não soma nem desconta horas')
  })

  it('a câmera abre a traseira, e o arquivo aceita foto e PDF', () => {
    const html = desenhar(
      createElement(LancamentoDeAusencia, {
        usuarioId: 'u1',
        nomeDoFuncionario: 'Fulana',
        diaSugerido: '2026-10-15',
        aoFechar: nada,
        aoLancada: nada,
      }),
    )
    expect(html).toContain('capture="environment"')
    expect(html).toMatch(/accept="[^"]*application\/pdf[^"]*"/)
    expect(html).toMatch(/accept="[^"]*image\/heic[^"]*"/)
  })
})

describe('a lista das ausências e o cancelamento', () => {
  it('o admin vê quem lançou, quem cancelou e o motivo, e o botão só na ativa', () => {
    const html = texto(
      desenhar(
        createElement(AusenciasDoPeriodo, {
          titulo: 'Ausências em outubro',
          ausencias: [ATIVA, CANCELADA],
          nomeDe: (id: string) => NOMES.get(id) ?? null,
          aoAbrirAtestado: nada,
          aoCancelar: nada,
        }),
      ),
    )
    expect(html).toContain('14/10/2026 a 16/10/2026 (3 dias)')
    expect(html).toContain('Lançada por Sérgio')
    expect(html).toContain('Cancelada por Ana')
    expect(html).toContain('lançada para a pessoa errada')
    expect(html).toContain('cancelada — não marca a folha')
    expect(html).toContain('Ver o atestado')
    expect(html.match(/Cancelar/g)).toHaveLength(1)
  })

  it('o colaborador vê a própria, sem botão de cancelar', () => {
    auth.valor = contexto(false)
    const html = texto(
      desenhar(
        createElement(AusenciasDoPeriodo, { titulo: 'Ausências', ausencias: [ATIVA], aoAbrirAtestado: nada }),
      ),
    )
    expect(html).toContain('Atestado médico')
    expect(html).not.toContain('Cancelar')
  })

  it('lista vazia não desenha nada', () => {
    expect(
      desenhar(createElement(AusenciasDoPeriodo, { titulo: 'x', ausencias: [], aoAbrirAtestado: nada })),
    ).toBe('')
  })

  it('a caixa de cancelamento pede o motivo e diz que é definitivo', () => {
    const html = texto(
      desenhar(
        createElement(CaixaDeCancelamento, {
          ausencia: ATIVA,
          nomeDaPessoa: 'Fulana',
          aoFechar: nada,
          aoCancelada: nada,
        }),
      ),
    )
    expect(html).toContain('Motivo')
    expect(html).toContain('definitivo')
  })
})

describe('o dia de ausência nas listas de dias', () => {
  it('o dia só de ausência diz "sem horas", e não 0h00', () => {
    const html = texto(
      desenhar(createElement(DiaDeAusencia, { dia: '2026-10-14', ausencias: [ATIVA], aoAbrirAtestado: nada })),
    )
    expect(html).toContain('Falta justificada — atestado médico')
    expect(html).toContain('sem horas')
    expect(html).not.toContain('0h00')
  })

  it('no espelho, o dia com ausência e batida mostra os dois', () => {
    const [dia] = agruparPorDia([batida('13:00'), batida('17:00', { tipo: 'saida_almoco', ordem_no_dia: 2 })])
    const html = texto(
      desenhar(createElement(DiaDoEspelho, { dia, aoAbrirSelfie: nada, ausencias: [ATIVA], aoAbrirAtestado: nada })),
    )
    expect(html).toContain('Falta justificada — atestado médico')
    expect(html).toContain('13:00')
    expect(html).toContain('4h00')
  })

  it('no painel da pessoa, o mesmo', () => {
    const [dia] = agruparPorDia([batida('13:00'), batida('17:00', { tipo: 'saida_almoco', ordem_no_dia: 2 })])
    const html = texto(
      desenhar(
        createElement(DiaDoPainel, {
          dia,
          aoAbrirSelfie: nada,
          aoCorrigir: nada,
          aoInserirNesteDia: nada,
          ausencias: [ATIVA],
          aoAbrirAtestado: nada,
        }),
      ),
    )
    expect(html).toContain('Falta justificada — atestado médico')
    expect(html).toContain('Atestado')
    expect(html).toContain('4h00')
  })
})

describe('o visor do atestado e a folha impressa', () => {
  it('o visor abre esperando o link — a assinatura é efeito, não desenho', () => {
    const html = desenhar(
      createElement(VisorDeAtestado, { caminho: 'u1/a.pdf', descricao: 'Atestado médico · 14/10/2026', aoFechar: nada }),
    )
    expect(html).toContain('Carregando o atestado')
    expect(texto(html)).toContain('(PDF)')
  })

  it('a folha impressa marca os dias e explica na legenda que a falta não conta hora', () => {
    const folha = montarFolha({
      empresa: null,
      funcionario: { nome: 'Fulana', email: null },
      mes: '2026-10',
      batidas: [batida('13:00'), batida('17:00', { tipo: 'saida_almoco', ordem_no_dia: 2 })],
      ausencias: [ATIVA, CANCELADA],
    })
    const html = texto(desenhar(createElement(FolhaParaImprimir, { folha, emitidaEm: '17/10/2026 23:00' })))
    expect(html).toContain('14/10/2026')
    expect(html).toContain('16/10/2026')
    expect(html).not.toContain('22/10/2026')
    expect(html).toContain('Falta justificada — atestado médico (atestado anexado)')
    expect(html).toContain('não soma nem desconta horas')
    expect(html).toContain('4h00')
  })
})
