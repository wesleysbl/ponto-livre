import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ValorDoContexto } from './contexts/autenticacao'
import type { AmbienteDeInstalacao } from './lib/instalacao'

/*
 * A MARCA NA TELA.
 *
 * O nome configurado no build (VITE_NOME_DO_APP e VITE_SLOGAN_DO_APP) chega à
 * tela de entrar, ao topo das telas internas, ao convite para instalar, à
 * folha impressa e ao pé da tela de bater — e, sem as variáveis, vale "Ponto",
 * sem linha de slogan. As regras (padrão, espaços, escape) estão em
 * `lib/marca.test.ts`; aqui se confere o desenho, com `renderToString`, como
 * nos outros testes de tela.
 *
 * O PÉ DA TELA DE BATER é o slogan configurado, e nada sem ele: uma frase fixa
 * ali apareceria igual em toda instalação. Os dois casos estão no fim deste
 * arquivo.
 *
 * O `vitest.config.ts` zera as duas variáveis para a suíte toda, para o nome de
 * quem roda os testes não entrar neles. Cada caso que quer um nome o põe com
 * `vi.stubEnv`, e o `afterEach` devolve o ambiente como estava.
 */

const auth = vi.hoisted(() => ({ valor: null as unknown }))

vi.mock('./hooks/useAuth', () => ({ useAuth: () => auth.valor }))
// A tela de bater fala com o banco só nos efeitos, que o `renderToString` não roda.
vi.mock('./lib/supabase', () => ({
  supabase: {
    from: () => {
      throw new Error('O desenho da tela não pode ler o banco.')
    },
    rpc: () => {
      throw new Error('O desenho da tela não pode chamar RPC.')
    },
  },
}))

const { Entrar } = await import('./pages/Entrar')
const { Bater } = await import('./pages/Bater')
const { Marca, MarcaDoTopo } = await import('./components/Marca')
const { ConviteParaInstalar } = await import('./components/ConviteParaInstalar')
const { FolhaParaImprimir } = await import('./components/FolhaParaImprimir')
const { montarFolha } = await import('./lib/folha')

function semSessao(): ValorDoContexto {
  return {
    usuario: null,
    pin: { estado: 'sem-sessao' },
    acesso: { estado: 'sem-sessao' },
    administracao: { estado: 'sem-sessao' },
    carregando: false,
    entrar: async () => ({ erro: null }),
    sair: async () => {},
    recarregar: async () => {},
  } as unknown as ValorDoContexto
}

/** Quem bate ponto pela ficha: a tela de bater no começo, com o botão de bater. */
function quemBate(): ValorDoContexto {
  return {
    usuario: { id: 'u-ana', email: 'ana@example.com' } as ValorDoContexto['usuario'],
    pin: { estado: 'ok', status: { definido: true, precisa_redefinir: false, bloqueado_ate: null } },
    acesso: {
      estado: 'ok',
      acesso: {
        temAcesso: true,
        origem: 'ficha',
        administra: false,
        superAdmin: false,
        batePonto: true,
        nome: 'Ana Beatriz Rocha',
        cargo: 'Vendas',
      },
    },
    administracao: { estado: 'ok', administra: false },
    carregando: false,
    entrar: async () => ({ erro: null }),
    sair: async () => {},
    recarregar: async () => {},
  }
}

/** O conteúdo do `<footer>` da tela, ou nulo quando ela não tem pé. */
function peDaTela(html: string): string | null {
  return /<footer\b[^>]*>(.*?)<\/footer>/s.exec(html)?.[1] ?? null
}

const NO_IPHONE: AmbienteDeInstalacao = { instalado: false, aparelho: 'ios', adiadoEm: null, agora: 0 }

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
    .replace(/ ([.,:)])/g, '$1')
}

/** Os parágrafos de um pedaço de HTML, como texto. */
function paragrafos(html: string): string[] {
  return [...html.matchAll(/<p\b[^>]*>(.*?)<\/p>/g)].map((achado) => texto(achado[1]).trim())
}

function configurar(nome: string, slogan = '') {
  vi.stubEnv('VITE_NOME_DO_APP', nome)
  vi.stubEnv('VITE_SLOGAN_DO_APP', slogan)
}

let errosDoConsole: unknown[][] = []

beforeEach(() => {
  errosDoConsole = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errosDoConsole.push(args)
  })
  auth.valor = semSessao()
})

afterEach(() => {
  expect(errosDoConsole).toEqual([])
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('sem as variáveis: "Ponto", sem slogan', () => {
  it('a assinatura das telas de acesso é o ícone e o nome, e nada embaixo', () => {
    expect(paragrafos(desenhar(createElement(Marca)))).toEqual(['Ponto'])
  })

  it('a tela de entrar abre com o nome padrão e o e-mail de exemplo sem domínio de ninguém', () => {
    const html = desenhar(createElement(Entrar))
    expect(paragrafos(html)[0]).toBe('Ponto')
    expect(html).toContain('placeholder="voce@example.com"')
  })

  it('o topo das telas internas diz "Ponto"', () => {
    expect(texto(desenhar(createElement(MarcaDoTopo))).trim()).toBe('Ponto')
  })
})

describe('com as variáveis: o nome e o slogan configurados', () => {
  it('a tela de entrar mostra o nome e, embaixo dele, o slogan', () => {
    configurar('Padaria Pão Quente', 'fresquinho todo dia')
    const assinatura = paragrafos(desenhar(createElement(Entrar))).slice(0, 2)
    expect(assinatura).toEqual(['Padaria Pão Quente', 'fresquinho todo dia'])
  })

  it('só o nome, sem slogan: a linha do slogan não aparece', () => {
    configurar('Padaria Pão Quente')
    expect(paragrafos(desenhar(createElement(Marca)))).toEqual(['Padaria Pão Quente'])
  })

  it('as telas que pedem a assinatura sem slogan não o mostram, mesmo configurado', () => {
    configurar('Padaria Pão Quente', 'fresquinho todo dia')
    expect(paragrafos(desenhar(createElement(Marca, { comSlogan: false })))).toEqual(['Padaria Pão Quente'])
  })

  it('espaços nas pontas saem, e variável só com espaços vale o padrão', () => {
    configurar('  Padaria Pão Quente  ', '   ')
    expect(paragrafos(desenhar(createElement(Marca)))).toEqual(['Padaria Pão Quente'])
    configurar('   ')
    expect(paragrafos(desenhar(createElement(Marca)))).toEqual(['Ponto'])
  })

  it('o topo das telas internas diz o nome configurado', () => {
    configurar('Padaria Pão Quente')
    expect(texto(desenhar(createElement(MarcaDoTopo))).trim()).toBe('Padaria Pão Quente')
  })

  it('o convite para instalar diz o nome do app', () => {
    configurar('Padaria Pão Quente')
    const lido = texto(desenhar(createElement(ConviteParaInstalar, { ambiente: NO_IPHONE })))
    expect(lido).toContain('Instale o app Padaria Pão Quente no celular')
  })

  it('a folha impressa diz por qual aplicativo ela foi emitida', () => {
    configurar('Padaria Pão Quente')
    const folha = montarFolha({ empresa: null, funcionario: { nome: 'Fulana', email: null }, mes: '2026-10', batidas: [] })
    const lido = texto(desenhar(createElement(FolhaParaImprimir, { folha, emitidaEm: '23/10/2026 18:00' })))
    expect(lido).toContain('Emitida pelo aplicativo Padaria Pão Quente em 23/10/2026 18:00.')
  })

  it('o nome vira texto na tela, nunca HTML', () => {
    configurar('<b>Café & Cia</b>')
    const html = desenhar(createElement(MarcaDoTopo))
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;Café &amp; Cia&lt;/b&gt;')
  })
})

describe('o pé da tela de bater é o slogan configurado', () => {
  it('sem slogan, a tela de bater não tem pé: nenhuma frase fixa de empresa nenhuma', () => {
    auth.valor = quemBate()
    const html = desenhar(createElement(Bater))
    expect(texto(html)).toContain('Olá, Ana')
    expect(peDaTela(html)).toBeNull()
  })

  it('com slogan, o pé diz o slogan, e só ele', () => {
    configurar('Padaria Pão Quente', 'fresquinho todo dia')
    auth.valor = quemBate()
    const pe = peDaTela(desenhar(createElement(Bater)))
    expect(pe).not.toBeNull()
    expect(paragrafos(pe ?? '')).toEqual(['fresquinho todo dia'])
  })
})
