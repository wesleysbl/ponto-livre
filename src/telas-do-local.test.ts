import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ValorDoContexto } from './contexts/autenticacao'
import type { LocalDoPonto } from './lib/configuracao'
import type { ResumoDeLocalizacoes } from './lib/coordenada'
import type { BatidaDoAdmin } from './lib/formato'

/*
 * A TELA DO LOCAL ABRE SEM ERRO DE CONSOLE, COM O SUPABASE SIMULADO.
 *
 * Mesmo desenho de `telas-de-ausencias.test.ts`: o projeto testa em Node, sem
 * DOM, e as telas são desenhadas com `renderToString`. Qualquer `console.error`
 * do React ou exceção no desenho reprova; o Supabase simulado levanta se o
 * DESENHO tentar ler o banco (as leituras moram em efeito e estão em
 * `lib/administracao.test.ts`).
 *
 * O que só dá para ver na tela, e não nas regras puras de `lib/coordenada.ts`:
 * que o formulário DIZ quem mediu (ou que nunca mediu), que os exemplos dos
 * campos não são o local, que o link do mapa aparece, que o par trocado gera
 * o aviso e trava o "Salvar", e que o painel do mês mostra o "fora" por pessoa.
 * A recusa da captura imprecisa depende de estado que só nasce com o GPS; ela
 * está provada em `decidirGravacaoDoLocal` ('precisão acima do limite não
 * habilita salvar'), que é a função que este formulário consulta.
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

const { Administracao } = await import('./pages/Administracao')
const { FormularioDoLocal, ResumoDeFora } = await import('./components/FormularioDoLocal')
const { Painel, LinhaDeFuncionario } = await import('./pages/Painel')
const { EXEMPLOS_DOS_CAMPOS } = await import('./lib/coordenada')
const { montarLinhasDoPainel } = await import('./lib/painel')

/* ------------------------------------------------------------------ */

function contexto(): ValorDoContexto {
  return {
    usuario: { id: 'u-sessao', email: 'sessao@example.com' } as ValorDoContexto['usuario'],
    pin: { estado: 'ok', status: { definido: true, precisa_redefinir: false, bloqueado_ate: null } },
    acesso: {
      estado: 'ok',
      acesso: {
        temAcesso: true,
        administra: true,
        superAdmin: true,
        origem: 'ficha',
        batePonto: true,
        nome: 'Pessoa da Sessão',
        cargo: 'Analista',
      },
    },
    administracao: { estado: 'ok', administra: true },
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
  auth.valor = contexto()
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

/** O `<button>` cujo texto contém `rotulo`, com os atributos. */
function botao(html: string, rotulo: string): string {
  const achado = [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)].find((m) =>
    texto(m[1]).includes(rotulo),
  )
  if (!achado) throw new Error(`Botão "${rotulo}" não foi desenhado.`)
  return achado[0]
}

const desabilitado = (tag: string) => /<button\b[^>]*\bdisabled=""/.test(tag)

/** Um local gravado sem sessão (direto no banco): `medido_por` nulo. */
const GRAVADO_SEM_SESSAO: LocalDoPonto = {
  id: 'l1',
  nome: 'Empresa Exemplo',
  latitude: -23.55052,
  longitude: -46.633308,
  raioMetros: 150,
  ativo: true,
  medidoEm: '2026-10-15T12:00:00.000000+00:00',
  medidoPor: null,
} as LocalDoPonto

/* ------------------------------------------------------------------ */

describe('as páginas abrem', () => {
  it('a administração abre (carregando) sem ler o banco no desenho', () => {
    expect(texto(desenhar(createElement(Administracao)))).toContain('Carregando…')
  })

  it('o painel do mês abre', () => {
    expect(texto(desenhar(createElement(Painel)))).toContain('Fechamento do período')
  })
})

describe('o formulário do local', () => {
  it('sem local gravado: avisa que nunca foi medido, e os campos não trazem coordenada nenhuma', () => {
    const html = desenhar(createElement(FormularioDoLocal, { inicial: null }))
    const lido = texto(html)
    expect(lido).toContain('Este local nunca foi medido')
    expect(lido).toContain('Usar a localização deste aparelho')
    // Os exemplos dizem que são exemplo, e não são o local nem um placeholder plausível.
    expect(html).toContain(`placeholder="${EXEMPLOS_DOS_CAMPOS.latitude}"`)
    expect(html).toContain(`placeholder="${EXEMPLOS_DOS_CAMPOS.longitude}"`)
    expect(html).not.toMatch(/placeholder="-?23[.,]5/)
    expect(html).not.toMatch(/placeholder="-?46[.,]6/)
    // Sem coordenada, não há o que conferir no mapa.
    expect(lido).not.toContain('Conferir este ponto no mapa')
    // A porcentagem de "fora" é lida em efeito: o desenho só diz que está contando.
    expect(lido).toContain('Contando as batidas dos últimos 30 dias')
  })

  it('a linha gravada sem sessão: direto no banco, sem medição no local, com o link do mapa', () => {
    const html = desenhar(createElement(FormularioDoLocal, { inicial: GRAVADO_SEM_SESSAO }))
    const lido = texto(html)
    expect(lido).toMatch(/Coordenada gravada direto no banco em 15\/10\/2026,? 09:00/)
    expect(lido).toContain('sem medição feita no local')
    expect(html).toContain('href="https://www.google.com/maps?q=-23.55052,-46.633308"')
    expect(lido).not.toContain('parecem trocadas')
    expect(desabilitado(botao(html, 'Salvar o local'))).toBe(false)
  })

  it('medido por alguém: enquanto o nome não chega, diz quando sem inventar "fora da lista"', () => {
    const html = texto(
      desenhar(
        createElement(FormularioDoLocal, {
          inicial: { ...GRAVADO_SEM_SESSAO, medidoEm: '2026-10-20T12:05:00Z', medidoPor: 'w1' },
        }),
      ),
    )
    expect(html).toMatch(/Medido em 20\/10\/2026,? 09:05\./)
    expect(html).not.toContain('não está na lista')
  })

  it('latitude e longitude trocadas geram aviso, sugerem a troca e travam o "Salvar"', () => {
    const html = desenhar(
      createElement(FormularioDoLocal, {
        inicial: { ...GRAVADO_SEM_SESSAO, latitude: -46.633308, longitude: -23.55052 },
      }),
    )
    const lido = texto(html)
    expect(lido).toContain('Latitude e longitude parecem trocadas')
    expect(lido).toContain('Usar -23,55052 e -46,633308')
    expect(lido).toContain('A coordenada está certa mesmo assim')
    expect(lido).toContain('Confira o aviso sobre a coordenada antes de salvar')
    expect(desabilitado(botao(html, 'Salvar o local'))).toBe(true)
  })
})

describe('a porcentagem de "fora" na tela do local', () => {
  function resumo(parcial: Partial<ResumoDeLocalizacoes>): ResumoDeLocalizacoes {
    return {
      total: 0,
      noLocal: 0,
      fora: 0,
      imprecisas: 0,
      semLocalizacao: 0,
      semGps: 0,
      porcentagemFora: null,
      alerta: false,
      ...parcial,
    }
  }

  it('acima do limite, alerta e manda conferir no mapa', () => {
    const lido = texto(
      desenhar(
        createElement(ResumoDeFora, {
          resumo: { estado: 'pronto', resumo: resumo({ total: 348, fora: 348, porcentagemFora: 1, alerta: true }) },
        }),
      ),
    )
    expect(lido).toContain('348 de 348 batidas com localização confiável saíram "fora do local" (100%)')
    expect(lido).toContain('desconfie da coordenada')
  })

  it('abaixo do limite, só informa, e conta as imprecisas à parte', () => {
    const lido = texto(
      desenhar(
        createElement(ResumoDeFora, {
          resumo: {
            estado: 'pronto',
            resumo: resumo({ total: 350, noLocal: 331, fora: 17, imprecisas: 2, porcentagemFora: 17 / 348 }),
          },
        }),
      ),
    )
    expect(lido).toContain('17 de 348 batidas')
    expect(lido).toContain('(5%)')
    expect(lido).not.toContain('desconfie')
    expect(lido).toContain('2 outras tiveram localização imprecisa')
  })

  it('sem batida confiável, não afirma 0%', () => {
    const lido = texto(
      desenhar(createElement(ResumoDeFora, { resumo: { estado: 'pronto', resumo: resumo({ total: 3, semLocalizacao: 3 }) } })),
    )
    expect(lido).toContain('Nenhuma batida com localização confiável')
    expect(lido).not.toContain('0%')
  })

  it('a leitura que falhou diz que falhou', () => {
    const lido = texto(desenhar(createElement(ResumoDeFora, { resumo: { estado: 'erro', frase: 'sem rede.' } })))
    expect(lido).toContain('Não deu para contar as batidas "fora"')
  })
})

describe('o indicador de "fora" por pessoa no cartão do painel do mês', () => {
  const batida = (hora: string, extras: Partial<BatidaDoAdmin> = {}): BatidaDoAdmin => ({
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
    selfie_path: null,
    ajuste_manual: false,
    origem: 'app',
    motivo_ajuste: null,
    funcionario_nome: 'Fulana',
    funcionario_email: 'fulana@example.com',
    pedido_atraso_id: null,
    ...extras,
  })
  const FORA = { distancia_metros: 2601, no_local: false } as const
  const OUTUBRO = { inicio: '2026-10-01', fim: '2026-10-31' }

  function cartao(batidas: BatidaDoAdmin[]): string {
    const [linha] = montarLinhasDoPainel([], batidas)
    return desenhar(createElement('ul', null, createElement(LinhaDeFuncionario, { linha, periodo: OUTUBRO })))
  }

  it('todas fora: etiqueta de aviso, com o número e a porcentagem', () => {
    const html = cartao([batida('08:00', FORA), batida('12:00', { ...FORA, ordem_no_dia: 2 })])
    expect(texto(html)).toContain('2 de 2 fora do local (100%)')
    expect(html).toMatch(/text-warn[^>]*>(?:(?!<\/span>).)*2 de 2 fora do local/s)
  })

  it('uma fora em dez: etiqueta neutra', () => {
    const horas = ['08:00', '08:10', '08:20', '08:30', '08:40', '08:50', '09:00', '09:10', '09:20', '09:30']
    const html = cartao(horas.map((hora, i) => batida(hora, i === 0 ? { ...FORA } : { ordem_no_dia: i + 1 })))
    expect(texto(html)).toContain('1 de 10 fora do local (10%)')
    expect(html).not.toMatch(/text-warn[^>]*>(?:(?!<\/span>).)*fora do local/s)
  })

  it('ninguém fora: nenhuma etiqueta de "fora"', () => {
    expect(texto(cartao([batida('08:00'), batida('12:00', { ordem_no_dia: 2 })]))).not.toContain('fora do local')
  })

  /*
   * A BATIDA SEM LOCALIZAÇÃO: o GPS não respondeu, e ela saiu com a selfie e o
   * PIN. Conta numa etiqueta própria, neutra, e fica FORA da porcentagem de
   * "fora" — não diz nada sobre onde a pessoa estava nem sobre a coordenada do
   * local.
   */
  it('"2 sem localização" em etiqueta neutra; a porcentagem de "fora" ignora as duas', () => {
    const SEM_GPS = { latitude: null, longitude: null, precisao_metros: null, distancia_metros: null, no_local: null }
    const html = cartao([
      batida('08:00'),
      batida('12:00', { ...FORA, ordem_no_dia: 2 }),
      batida('13:00', { ...SEM_GPS, ordem_no_dia: 3 }),
      batida('18:00', { ...SEM_GPS, ordem_no_dia: 4 }),
    ])
    expect(texto(html)).toContain('2 sem localização')
    expect(texto(html)).toContain('1 de 2 fora do local (50%)')
    expect(html).not.toMatch(/text-warn[^>]*>(?:(?!<\/span>).)*sem localização/s)
  })

  it('a inserida pelo admin, sem coordenada, não conta como "sem localização"', () => {
    const html = cartao([
      batida('08:00'),
      batida('12:00', {
        ordem_no_dia: 2,
        latitude: null,
        longitude: null,
        precisao_metros: null,
        distancia_metros: null,
        no_local: null,
        origem: 'ajuste_admin',
        ajuste_manual: true,
        motivo_ajuste: 'Esqueceu o almoço',
      }),
    ])
    expect(texto(html)).not.toContain('sem localização')
  })
})
