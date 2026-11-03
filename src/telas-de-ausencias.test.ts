import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ValorDoContexto } from './contexts/autenticacao'
import type { Ausencia } from './lib/ausencias'
import type { BatidaDoAdmin } from './lib/formato'

/*
 * AS TELAS DAS AUSÊNCIAS ABREM SEM ERRO DE CONSOLE, COM O SUPABASE SIMULADO.
 *
 * O que se confere: a tela de lançar abre sem erro com o Supabase simulado,
 * com "Por dias" e "Por horário" e o aviso do que abona; a lista e a marca do
 * dia dizem o período (a por horário com o intervalo); a marca recebe o abono
 * quando a tela tiver o saldo do dia; e a tela da própria ficha de quem está
 * logado não tem os botões de lançar nem de cancelar ausência, e diz por quê.
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
const { LancamentoDeAusencia, POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA } = await import(
  './components/LancamentoDeAusencia'
)
const { AusenciasDoPeriodo, CaixaDeCancelamento } = await import('./components/AusenciasDoPeriodo')
const { DiaDeAusencia, MarcaDeAusencia } = await import('./components/DiaDeAusencia')
const { DiaDoEspelho } = await import('./components/DiaDoEspelho')
const { DiaDoPainel, DiaSemBatida } = await import('./components/DiaDoPainel')
const { VisorDeAtestado } = await import('./components/VisorDeAtestado')
const { FolhaParaImprimir } = await import('./components/FolhaParaImprimir')
const { agruparPorDia } = await import('./lib/horas')
const { montarFolha } = await import('./lib/folha')
const { JORNADA_SEMENTE } = await import('./lib/jornada')
const { calcularSaldoDoDia } = await import('./lib/saldo')

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

/**
 * O texto como o navegador o mostra (`textContent`): as tags somem sem deixar
 * espaço. É o que conta na marca da ausência, que guarda o intervalo de
 * horário num `<span>` próprio para ele não se partir na linha.
 */
function corrido(html: string): string {
  return texto(html.replace(/<[^>]+>/g, ''))
}

const nada = () => {}

function ausencia(id: string, extras: Partial<Ausencia> = {}): Ausencia {
  return {
    id,
    usuario_id: 'u1',
    dia_inicio: '2026-10-14',
    dia_fim: '2026-10-16',
    tipo: 'atestado_medico',
    modalidade: 'dias',
    hora_inicio: null,
    hora_fim: null,
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
/** Por horário: quarta, 21/10/2026, das 14:00 às 16:00, como o PostgREST devolve. */
const POR_HORARIO = ausencia('a-horario', {
  dia_inicio: '2026-10-21',
  dia_fim: '2026-10-21',
  modalidade: 'horario',
  hora_inicio: '14:00:00',
  hora_fim: '16:00:00',
  observacao: null,
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

describe('a própria ficha de quem está logado, no painel da pessoa', () => {
  /** O painel da pessoa `usuarioId`, aberto pela rota, como o app abre. */
  function painelDe(usuarioId: string): string {
    return texto(
      renderToString(
        createElement(
          MemoryRouter,
          { initialEntries: [`/painel/${usuarioId}`] },
          createElement(Routes, null, createElement(Route, { path: '/painel/:usuarioId', element: createElement(PainelDaPessoa) })),
        ),
      ),
    )
  }

  it('na própria ficha, o botão de lançar some e a frase do porquê fica no lugar', () => {
    const html = painelDe('u-sessao')
    expect(html).not.toContain('Lançar falta justificada')
    expect(html).toContain(POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA)
    // Os outros botões do fechamento continuam.
    expect(html).toContain('Inserir batida esquecida')
    expect(html).toContain('CSV')
  })

  it('na ficha de outra pessoa, o botão continua e a frase não aparece', () => {
    const html = painelDe('u1')
    expect(html).toContain('Lançar falta justificada')
    expect(html).not.toContain(POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA)
  })

  it('a frase diz quem faz, sem travessão', () => {
    expect(POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA).toBe(
      'Esta ficha é a sua. Quem é dono do ponto não lança nem cancela a própria ausência: outra pessoa que administra o ponto faz isso.',
    )
    expect(POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA).not.toMatch(/[\u2013\u2014]/)
  })

  it('o dia vazio da própria ficha não oferece "Lançar falta neste dia"; o de outra pessoa, sim', () => {
    const propria = texto(
      desenhar(createElement('ul', null, createElement(DiaSemBatida, { dia: '2026-10-19', aoInserirNesteDia: nada }))),
    )
    expect(propria).toContain('Inserir batida neste dia')
    expect(propria).not.toContain('Lançar falta neste dia')
    const deOutra = texto(
      desenhar(
        createElement(
          'ul',
          null,
          createElement(DiaSemBatida, { dia: '2026-10-19', aoInserirNesteDia: nada, aoLancarFaltaNesteDia: nada }),
        ),
      ),
    )
    expect(deOutra).toContain('Lançar falta neste dia')
  })
})

describe('a tela de lançar', () => {
  it('abre por dias, com a data de início, quantos dias, a data final calculada, o tipo e as duas portas do atestado', () => {
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
    expect(html).toContain('Como lançar')
    expect(html).toContain('Por dias')
    expect(html).toContain('Por horário')
    expect(html).toContain('Data de início')
    expect(html).toContain('Quantos dias')
    expect(html).toContain('Data final: 15/10/2026 (um dia só)')
    expect(html).not.toContain('Primeiro dia')
    expect(html).not.toContain('Último dia')
    expect(html).toContain('Atestado médico')
    expect(html).toContain('Falta justificada')
    expect(html).toContain('Outro motivo')
    expect(html).toContain('Fotografar')
    expect(html).toContain('Arquivo')
  })

  it('o aviso diz o que abona e o que só marca: "não soma nem desconta horas" deixou de ser verdade', () => {
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
    expect(html).not.toContain('não soma nem desconta horas')
    expect(html).toContain(
      'Atestado médico e falta justificada abonam a parte da jornada que cobrem e que não foi trabalhada',
    )
    expect(html).toContain('sem apagar nenhuma batida')
    expect(html).toContain('Outro motivo só marca o dia')
    expect(html).toContain('sem abonar')
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
    expect(html).toContain('cancelada: não marca a folha')
    expect(html).toContain('Ver o atestado')
    expect(html.match(/Cancelar/g)).toHaveLength(1)
  })

  it('a por horário mostra o dia e o intervalo; a por dias, o período de sempre', () => {
    const html = texto(
      desenhar(
        createElement(AusenciasDoPeriodo, {
          titulo: 'Ausências em outubro',
          ausencias: [ATIVA, POR_HORARIO],
          nomeDe: (id: string) => NOMES.get(id) ?? null,
          aoAbrirAtestado: nada,
          aoCancelar: nada,
        }),
      ),
    )
    expect(html).toContain('21/10/2026, das 14:00 às 16:00')
    expect(html).toContain('14/10/2026 a 16/10/2026 (3 dias)')
    // O cancelamento continua igual: um botão por ausência ativa.
    expect(html.match(/Cancelar/g)).toHaveLength(2)

    const caixa = texto(
      desenhar(createElement(CaixaDeCancelamento, { ausencia: POR_HORARIO, nomeDaPessoa: 'Fulana', aoFechar: nada, aoCancelada: nada })),
    )
    expect(caixa).toContain('21/10/2026, das 14:00 às 16:00')
  })

  it('na própria ficha, a lista sai sem "Cancelar" e com a frase do porquê', () => {
    const html = texto(
      desenhar(
        createElement(AusenciasDoPeriodo, {
          titulo: 'Ausências em outubro',
          ausencias: [ATIVA, CANCELADA],
          nomeDe: (id: string) => NOMES.get(id) ?? null,
          aoAbrirAtestado: nada,
          porQueSemCancelar: POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA,
        }),
      ),
    )
    expect(html).not.toContain('Cancelar')
    expect(html).toContain(POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA)
    // O atestado continua à vista: ver não é decidir.
    expect(html).toContain('Ver o atestado')
    // Só com ausência ativa: sem nada a cancelar, a frase não tem o que explicar.
    const soCanceladas = texto(
      desenhar(
        createElement(AusenciasDoPeriodo, {
          titulo: 'Ausências em outubro',
          ausencias: [CANCELADA],
          aoAbrirAtestado: nada,
          porQueSemCancelar: POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA,
        }),
      ),
    )
    expect(soCanceladas).not.toContain(POR_QUE_A_PROPRIA_AUSENCIA_NAO_SE_LANCA)
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
    // A marca das telas diz o tipo e o período.
    expect(html).toContain('Atestado, dia inteiro')
    expect(html).not.toContain('Falta justificada')
    expect(html).toContain('sem horas')
    expect(html).not.toContain('0h00')
  })

  it('a marca da ausência por horário diz o tipo e o intervalo, com hífen', () => {
    const cru = desenhar(createElement(DiaDeAusencia, { dia: '2026-10-21', ausencias: [POR_HORARIO], aoAbrirAtestado: nada }))
    const html = texto(cru)
    expect(html).toContain('Atestado 14:00-16:00')
    expect(html).not.toMatch(/[\u2013\u2014]/)
    // O intervalo inteiro numa linha: a 320 px, "14:00-" não fica numa linha e "16:00" na outra.
    expect(cru).toContain('<span class="whitespace-nowrap">14:00-16:00</span>')
  })

  it('duas ausências por horário no mesmo dia viram duas marcas, em ordem de início', () => {
    const manha = ausencia('a-manha', {
      dia_inicio: '2026-10-21',
      dia_fim: '2026-10-21',
      tipo: 'outro',
      observacao: 'cartório',
      modalidade: 'horario',
      hora_inicio: '09:00:00',
      hora_fim: '10:00:00',
      atestado_path: null,
      // Lançada depois da da tarde: a ordem da marca é a do relógio, e não a do lançamento.
      lancado_em: '2026-10-21T18:00:00.000Z',
    })
    const html = corrido(
      desenhar(createElement(MarcaDeAusencia, { ausencias: [POR_HORARIO, manha], aoAbrirAtestado: nada })),
    )
    expect(html.indexOf('Outro motivo 09:00-10:00: cartório')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('Outro motivo 09:00-10:00')).toBeLessThan(html.indexOf('Atestado 14:00-16:00'))
  })

  /*
   * O ABONO NA MARCA VEM DO SALDO DO DIA: a marca recebe as coberturas prontas
   * (`SaldoDoDia.coberturas`) e só as escreve. Aqui elas saem da mesma conta
   * que as telas usam; as telas inteiras estão em `telas-do-saldo.test.ts`.
   */
  it('com as coberturas do saldo do dia, a marca diz quanto abonou, ou que "outro motivo" não abona', () => {
    const outro = ausencia('a-outro', {
      dia_inicio: '2026-10-21',
      dia_fim: '2026-10-21',
      tipo: 'outro',
      observacao: 'cartório',
      modalidade: 'horario',
      hora_inicio: '09:00:00',
      hora_fim: '10:00:00',
      atestado_path: null,
    })
    const regras = {
      jornadaDaEmpresa: JORNADA_SEMENTE,
      jornadaPropria: null,
      cobrancaDesde: '2026-10-01',
      toleranciaMinutos: 10,
      hoje: '2026-10-31',
    }
    // Quarta, 21/10: a jornada semente vai das 08:00 às 12:00 e das 13:00 às 17:00.
    const saldo = calcularSaldoDoDia('2026-10-21', [], [POR_HORARIO, outro], regras)
    const html = corrido(
      desenhar(
        createElement(MarcaDeAusencia, {
          ausencias: [POR_HORARIO, outro],
          aoAbrirAtestado: nada,
          coberturas: saldo.coberturas,
        }),
      ),
    )
    expect(html).toContain('Atestado 14:00-16:00 · abonou 2h00')
    expect(html).toContain('Outro motivo 09:00-10:00: cartório · não abona')

    // Sem as coberturas (as regras do saldo não carregaram), a marca não fala de abono.
    const semSaldo = texto(desenhar(createElement(MarcaDeAusencia, { ausencias: [POR_HORARIO], aoAbrirAtestado: nada })))
    expect(semSaldo).toContain('Atestado 14:00-16:00')
    expect(semSaldo).not.toMatch(/abonou|não abona/)
  })

  it('no espelho, o dia com ausência e batida mostra os dois', () => {
    const [dia] = agruparPorDia([batida('13:00'), batida('17:00', { tipo: 'saida_almoco', ordem_no_dia: 2 })])
    const html = texto(
      desenhar(createElement(DiaDoEspelho, { dia, aoAbrirSelfie: nada, ausencias: [ATIVA], aoAbrirAtestado: nada })),
    )
    expect(html).toContain('Atestado, dia inteiro')
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
    expect(html).toContain('Atestado, dia inteiro')
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

  /*
   * A FOLHA SEM AS REGRAS DO SALDO (aqui, sem a configuração): a marca da
   * ausência é a das telas, com o período, e a legenda diz o que abona e que o
   * total trabalhado é só o das batidas. "Não soma nem desconta horas" deixou
   * de ser verdade com o abono.
   */
  it('a folha impressa marca os dias e explica na legenda que a ausência não muda o total trabalhado', () => {
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
    expect(html).toContain('Atestado, dia inteiro (atestado anexado)')
    expect(html).not.toMatch(/Falta justificada \u2014 atestado médico/)
    expect(html).not.toContain('não soma nem desconta horas')
    expect(html).toContain('Atestado e falta justificada abonam a parte da jornada que cobrem')
    expect(html).toContain('Nenhuma delas muda o total trabalhado')
    // Sem as regras do saldo, a folha é a de antes e diz por quê.
    expect(html).toContain('Esta folha não traz previsto, abonado e saldo')
    expect(html).not.toMatch(/[\u2013\u2014]/)
    expect(html).toContain('4h00')
  })
})
