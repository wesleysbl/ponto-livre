import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ValorDoContexto } from './contexts/autenticacao'
import type { AmbienteDeInstalacao } from './lib/instalacao'

/*
 * O CONVITE PARA INSTALAR, NA TELA.
 *
 * A regra de mostrar/esconder está em `lib/instalacao.test.ts`. Aqui se confere
 * o que só a tela mostra: a instrução do aparelho certo, o aviso de câmera e
 * localização, o "Agora não" — e que a tela de entrar põe o convite ANTES do
 * cartão de login (no iPhone, o ícone não aproveita o login do Safari).
 *
 * Mesmo desenho dos outros testes de tela (`telas-*.test.ts`): Node, sem DOM,
 * `renderToString`, e qualquer `console.error` do React reprova.
 */

const auth = vi.hoisted(() => ({ valor: null as unknown }))
const ambienteDoNavegador = vi.hoisted(() => ({ valor: null as AmbienteDeInstalacao | null }))

vi.mock('./hooks/useAuth', () => ({ useAuth: () => auth.valor }))
vi.mock('./lib/instalacao', async (original) => {
  const modulo = await original<typeof import('./lib/instalacao')>()
  return {
    ...modulo,
    // Em Node não há navegador: o teste diz qual aparelho a tela "vê". Sem
    // valor definido, vale a leitura real (que em Node sai 'outro').
    lerAmbienteDoNavegador: () => ambienteDoNavegador.valor ?? modulo.lerAmbienteDoNavegador(),
  }
})

const { ConviteParaInstalar } = await import('./components/ConviteParaInstalar')
const { Entrar } = await import('./pages/Entrar')

const AGORA = Date.UTC(2026, 9, 20, 15, 0)
const DIA = 24 * 60 * 60 * 1000
const FRASE_DAS_PERMISSOES =
  'Na primeira batida o celular vai pedir câmera e localização: toque em Permitir nas duas.'

function ambiente(extra: Partial<AmbienteDeInstalacao> = {}): AmbienteDeInstalacao {
  return { instalado: false, aparelho: 'ios', adiadoEm: null, agora: AGORA, ...extra }
}

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

let errosDoConsole: unknown[][] = []

beforeEach(() => {
  errosDoConsole = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errosDoConsole.push(args)
  })
  auth.valor = semSessao()
  ambienteDoNavegador.valor = null
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
    .replace(/ ([.,:)])/g, '$1')
}

describe('o convite, por aparelho', () => {
  it('no iPhone: Safari, Compartilhar, Adicionar à Tela de Início, e instalar antes de entrar', () => {
    const lido = texto(desenhar(createElement(ConviteParaInstalar, { ambiente: ambiente() })))
    expect(lido).toContain('Instale o app Ponto no celular')
    expect(lido).toContain('Abra no Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.')
    expect(lido).toContain('Instale antes de entrar')
    expect(lido).toContain(FRASE_DAS_PERMISSOES)
    expect(lido).toContain('Agora não')
    expect(lido).not.toContain('Chrome')
  })

  it('no Android: Chrome, menu, Instalar app ou Adicionar à tela inicial', () => {
    const lido = texto(
      desenhar(createElement(ConviteParaInstalar, { ambiente: ambiente({ aparelho: 'android' }) })),
    )
    expect(lido).toContain('Abra no Chrome, toque no menu ⋮ e depois em Instalar app (ou Adicionar à tela inicial).')
    expect(lido).toContain(FRASE_DAS_PERMISSOES)
    expect(lido).not.toContain('Safari')
    // O aviso do login de novo é coisa do iPhone: no Android o app instalado
    // usa o mesmo armazenamento do Chrome.
    expect(lido).not.toContain('Instale antes de entrar')
  })

  it('o "Agora não" é um botão de verdade, que não envia o formulário de login', () => {
    const html = desenhar(createElement(ConviteParaInstalar, { ambiente: ambiente() }))
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Agora não<\/button>/)
  })

  it.each<[string, Partial<AmbienteDeInstalacao>]>([
    ['já instalado', { instalado: true }],
    ['no computador', { aparelho: 'outro' }],
    ['"Agora não" há 2 dias', { adiadoEm: AGORA - 2 * DIA }],
  ])('não aparece %s', (_caso, extra) => {
    expect(desenhar(createElement(ConviteParaInstalar, { ambiente: ambiente(extra) }))).toBe('')
  })

  it('volta a aparecer 7 dias depois do "Agora não"', () => {
    const lido = texto(
      desenhar(createElement(ConviteParaInstalar, { ambiente: ambiente({ adiadoEm: AGORA - 7 * DIA }) })),
    )
    expect(lido).toContain('Instale o app Ponto no celular')
  })
})

describe('na tela de entrar', () => {
  it('no celular sem o app instalado, o convite vem antes do cartão de login', () => {
    ambienteDoNavegador.valor = ambiente({ aparelho: 'android' })
    const lido = texto(desenhar(createElement(Entrar)))
    const convite = lido.indexOf('Instale o app Ponto no celular')
    const login = lido.indexOf('Entrar')
    expect(convite).toBeGreaterThan(-1)
    expect(login).toBeGreaterThan(convite)
    expect(lido).toContain(FRASE_DAS_PERMISSOES)
  })

  it('no app instalado, a tela de entrar é só o login', () => {
    ambienteDoNavegador.valor = ambiente({ instalado: true })
    const lido = texto(desenhar(createElement(Entrar)))
    expect(lido).not.toContain('Instale o app')
    expect(lido).toContain('E-mail')
  })

  it('sem navegador para ler (Node), o convite não aparece e a tela abre igual', () => {
    const lido = texto(desenhar(createElement(Entrar)))
    expect(lido).not.toContain('Instale o app')
    expect(lido).toContain('Senha')
  })
})
