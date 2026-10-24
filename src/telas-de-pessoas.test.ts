import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ValorDoContexto } from './contexts/autenticacao'
import type { FichaDoFuncionario } from './lib/cadastro'
import type { FuncionarioDoPainel } from './lib/painel'
import type { AcaoSobrePessoa } from './lib/pessoas'

/*
 * AS TELAS DE PESSOAS ABREM SEM ERRO DE CONSOLE, COM O SUPABASE SIMULADO.
 *
 * O que se prova: a tela de pessoas abre sem erro de console com o Supabase
 * simulado. Este repositório testa em Node, sem DOM (`vitest.config`,
 * `environment: 'node'`), e não tem biblioteca de teste de tela — então as
 * telas são desenhadas com `renderToString`, do próprio React: o primeiro
 * desenho de cada uma, e as linhas e caixas com dados de verdade montados por
 * `montarPessoas`. Qualquer `console.error` do React (chave repetida, elemento
 * inválido, prop errada) ou exceção no desenho reprova.
 *
 * O que `renderToString` NÃO roda: os efeitos (a leitura do banco). Por isso as
 * leituras são testadas à parte (`lib/administracao.test.ts`), e aqui a lista
 * é desenhada no estado "carregando" e as linhas, com dados prontos.
 *
 * E a regra de permissão, conferida também na TELA, e não só na lógica: quem
 * não é super admin não recebe os botões de super admin.
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
    functions: { invoke: () => Promise.reject(new Error('sem rede')) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}))
vi.mock('./hooks/useAuth', () => ({ useAuth: () => auth.valor }))

const { SemAcesso } = await import('./pages/SemAcesso')
const { ConfirmacaoDePin } = await import('./components/ConfirmacaoDePin')
const { ListaDePessoas, LinhaDePessoa } = await import('./components/ListaDePessoas')
const { CaixaDeVinculo } = await import('./components/CaixaDeVinculo')
const { FormularioDeConta, FormularioDeNovaConta } = await import('./components/CaixasDeConta')
const { CaixaDeAtivo, FormularioDaFicha } = await import('./components/FichaDoFuncionario')
const { acoesDaPessoa, contasSemFicha, montarPessoas } = await import('./lib/pessoas')

/* ------------------------------------------------------------------ */

function contexto(acesso: { temAcesso: boolean; administra: boolean; superAdmin: boolean }): ValorDoContexto {
  return {
    usuario: { id: 'u-sessao', email: 'sessao@example.com' } as ValorDoContexto['usuario'],
    pin: { estado: 'ok', status: { definido: true, precisa_redefinir: false, bloqueado_ate: null } },
    acesso: {
      estado: 'ok',
      acesso: {
        ...acesso,
        origem: acesso.temAcesso ? 'ficha' : null,
        batePonto: acesso.temAcesso,
        nome: 'Pessoa da Sessão',
        cargo: null,
      },
    },
    administracao: { estado: 'ok', administra: acesso.administra },
    carregando: false,
    entrar: async () => ({ erro: null }),
    sair: async () => {},
    recarregar: async () => {},
  }
}

/** Todo `console.error` de um teste inteiro — de todos os desenhos dele. */
let errosDoConsole: unknown[][] = []

beforeEach(() => {
  errosDoConsole = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errosDoConsole.push(args)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Desenha dentro de um roteador e devolve o HTML. */
function desenhar(elemento: ReactElement): string {
  return renderToString(createElement(MemoryRouter, null, elemento))
}

/** O texto visível, sem as tags (o React escapa só `&`, `<`, `>`, `"` e `'`). */
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

/* ------------------------------------------------------------------ */
/* Os dados                                                            */
/* ------------------------------------------------------------------ */

/** Uma conta como `lerContasDoPonto` entrega (`ponto_contas()`). */
function funcionario(usuarioId: string, nome: string, extras: Partial<FuncionarioDoPainel> = {}): FuncionarioDoPainel {
  return {
    usuarioId,
    nome,
    nomeDaConta: nome,
    email: `${usuarioId}@example.com`,
    podeBater: false,
    contaApagada: false,
    temFicha: false,
    ...extras,
  }
}

function ficha(id: string, nomeCompleto: string, extras: Partial<FichaDoFuncionario> = {}): FichaDoFuncionario {
  return {
    id,
    usuarioId: null,
    nomeCompleto,
    cpf: '52998224725',
    matricula: '42',
    cargo: 'Assistente administrativo',
    admissao: '2025-02-01',
    desligamento: null,
    ctps: null,
    ctpsSerie: null,
    centroCusto: null,
    ativo: true,
    batePontoDesde: null,
    atualizadoEm: null,
    ...extras,
  }
}

const FICHAS = [
  ficha('f-ana', 'Ana Paula Lima', { usuarioId: 'ana' }),
  ficha('f-maria', 'Maria Aparecida de Souza'),
  ficha('f-off', 'Otávio Reis', { ativo: false }),
]

const PESSOAS = montarPessoas({
  funcionarios: [
    funcionario('ana', 'Ana Lima'),
    funcionario('maria', 'Maria Souza'),
    funcionario('sergio', 'Sérgio'),
    // A Rita, do RH: administra e não tem ficha — "só administra".
    funcionario('rita', 'Rita'),
  ],
  administradores: [
    { usuarioId: 'sergio', concedidoPor: null, concedidoEm: '2026-09-04T12:00:00Z', observacao: null },
    { usuarioId: 'rita', concedidoPor: null, concedidoEm: '2026-09-04T12:00:00Z', observacao: null },
  ],
  superAdmins: ['sergio'],
  estadosDoPin: [{ usuarioId: 'ana', temPin: true, precisaRedefinir: false, bloqueadoAte: null }],
  // Uma batida de conta que não existe mais: a linha "conta que não existe mais".
  batidas: [
    {
      id: 'b-orfa',
      usuario_id: 'apagada',
      registrado_em: '2026-10-16T11:00:00Z',
      dia_civil: '2026-10-16',
      tipo: 'entrada',
      ordem_no_dia: 1,
      latitude: null,
      longitude: null,
      precisao_metros: null,
      distancia_metros: null,
      no_local: null,
      selfie_path: null,
      ajuste_manual: false,
      origem: 'app',
      motivo_ajuste: null,
      funcionario_nome: 'Conta Antiga',
      funcionario_email: 'antiga@example.com',
      pedido_atraso_id: null,
    },
  ],
  fichas: FICHAS,
  hoje: '2026-10-17',
  agora: Date.parse('2026-10-17T15:00:00Z'),
})

/*
 * O nome da linha é o da regra única (`lib/nomes.ts`): a conta `ana`, cujo
 * nome guardado diz "Ana Lima", aparece como "Ana Paula Lima" — o nome da
 * ficha ligada a ela.
 */
const pessoa = (nome: string) => {
  const achada = PESSOAS.find((item) => item.nome === nome)
  if (!achada) throw new Error(`sem ${nome} nos dados do teste`)
  return achada
}

const PERIODO = { inicio: '2026-10-01', fim: '2026-10-31' }

/** Os rótulos dos botões que só o super admin pode ver. */
const BOTOES_DO_SUPER_ADMIN = [
  'Trocar o nome',
  'Trocar o e-mail',
  'Redefinir a senha',
  'Conceder admin',
  'Revogar admin',
  'Ligar a uma ficha',
  'Ligar a uma conta',
  'Ligar à sugerida',
  'Criar a ficha',
  'Criar a conta',
  'Desligar da conta',
  'Nova conta',
]

function linha(nome: string, papel: 'super_admin' | 'admin') {
  const alvo = pessoa(nome)
  return createElement(LinhaDePessoa, {
    pessoa: alvo,
    acoes: acoesDaPessoa(alvo, papel),
    periodo: PERIODO,
    aberta: true,
    sugestao: null,
    aoAbrir: () => {},
    aoPedir: () => {},
  })
}

/* ------------------------------------------------------------------ */

describe('a tela "sem acesso"', () => {
  it('manda pedir a liberação a quem cuida do ponto na empresa — quem libera é o super admin', () => {
    auth.valor = contexto({ temAcesso: false, administra: false, superAdmin: false })
    const html = desenhar(createElement(SemAcesso))

    // A explicação da tela, inteira: o que falta e a quem pedir.
    expect(texto(html)).toContain(
      'Sua senha está certa, mas esta conta não tem uma ficha de funcionário ativa no ponto. Peça a liberação a quem cuida do ponto na sua empresa e depois toque em verificar de novo.',
    )
    // E a tela inteira, trecho por trecho: o pedido em destaque no meio da
    // explicação, o e-mail da conta (o que vão procurar na lista de pessoas) e
    // o nome que o banco dá a ela.
    expect(trechos(html)).toEqual([
      'Ponto',
      'Seu acesso ao ponto não está liberado',
      'Sua senha está certa, mas esta conta não tem uma ficha de funcionário ativa no ponto.',
      'Peça a liberação a quem cuida do ponto na sua empresa',
      'e depois toque em verificar de novo.',
      'Conta a informar',
      'sessao@example.com',
      'Pessoa da Sessão',
      'Já fui liberado, verificar',
      'Sair da conta',
    ])
    expect(errosDoConsole).toEqual([])
  })

  it('quando o nome que o banco manda é o próprio e-mail, ele não aparece duas vezes', () => {
    const semNome = contexto({ temAcesso: false, administra: false, superAdmin: false })
    if (semNome.acesso.estado === 'ok') semNome.acesso.acesso.nome = 'sessao@example.com'
    auth.valor = semNome
    const visivel = texto(desenhar(createElement(SemAcesso)))
    expect(visivel.match(/sessao@example\.com/g)).toHaveLength(1)
    expect(errosDoConsole).toEqual([])
  })
})

describe('a tela de PIN bloqueado', () => {
  /*
   * Quem reseta o PIN é quem administra o ponto: o botão "Resetar PIN" fica na
   * lista de pessoas da administração. Por isso a frase da trava manda pedir
   * ao RH, como o resto da batida: quem administra é o RH, e o colaborador não
   * vê dois nomes no mesmo fluxo.
   */
  it('manda pedir o reset ao RH, que tem o botão de resetar o PIN', () => {
    const contextoComTrava = contexto({ temAcesso: true, administra: false, superAdmin: false })
    contextoComTrava.pin = {
      estado: 'ok',
      status: {
        definido: true,
        precisa_redefinir: false,
        bloqueado_ate: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    }
    auth.valor = contextoComTrava
    const html = desenhar(createElement(ConfirmacaoDePin, { aoConfirmar: () => {} }))

    // A tela inteira, trecho por trecho, com a espera que falta no meio da frase.
    expect(trechos(html)).toEqual([
      'Conta bloqueada',
      'Foram cinco tentativas erradas seguidas. Tente de novo em',
      expect.stringMatching(/^\d{1,2}:\d{2}$/),
      '.',
      'O bloqueio é da sua conta, não deste aparelho — trocar de celular não adianta. Se você esqueceu o PIN, peça ao RH para resetar seu PIN.',
    ])
    expect(errosDoConsole).toEqual([])
  })
})

describe('a lista de pessoas abre sem erro de console', () => {
  it.each([
    ['super admin', { temAcesso: true, administra: true, superAdmin: true }],
    ['admin comum', { temAcesso: true, administra: true, superAdmin: false }],
  ])('%s: o primeiro desenho (carregando) sai limpo', (_papel, acesso) => {
    auth.valor = contexto(acesso)
    const visivel = texto(desenhar(createElement(ListaDePessoas)))

    expect(visivel).toContain('Pessoas')
    expect(visivel).toContain('Carregando as pessoas')
    expect(errosDoConsole).toEqual([])
  })

  it('cada forma de pessoa desenha a linha aberta sem erro, para os dois papéis', () => {
    for (const alvo of PESSOAS) {
      for (const papel of ['super_admin', 'admin'] as const) {
        desenhar(linha(alvo.nome, papel))
        expect(errosDoConsole, `${alvo.nome} / ${papel}`).toEqual([])
      }
    }
  })
})

describe('quem não é super admin não recebe as ações de super admin — na tela', () => {
  it('admin comum: nenhum botão de super admin em nenhuma linha; o reset de PIN está lá', () => {
    for (const alvo of PESSOAS) {
      const visivel = texto(desenhar(linha(alvo.nome, 'admin')))
      for (const rotulo of BOTOES_DO_SUPER_ADMIN) {
        expect(visivel, `${alvo.nome}: ${rotulo}`).not.toContain(rotulo)
      }
    }
    expect(texto(desenhar(linha('Ana Paula Lima', 'admin')))).toContain('Resetar PIN')
  })

  it('a linha mostra o nome da ficha de RH, e não o guardado na conta', () => {
    const daAna = texto(desenhar(linha('Ana Paula Lima', 'admin')))
    expect(daAna).toContain('Ana Paula Lima')
    expect(daAna).not.toContain('Ana Lima')
  })

  it('super admin: os botões de conta, de vínculo e de administração aparecem', () => {
    // Ana tem ficha ligada: é conta do ponto, e os botões de conta aparecem.
    const daAna = texto(desenhar(linha('Ana Paula Lima', 'super_admin')))
    for (const rotulo of ['Trocar o nome', 'Trocar o e-mail', 'Redefinir a senha', 'Conceder admin', 'Desligar da conta']) {
      expect(daAna).toContain(rotulo)
    }
    // Maria não tem ficha nem administra. No banco só do ponto toda conta é
    // do ponto: o super admin mexe na conta e liga ou cria a ficha.
    const daMaria = texto(desenhar(linha('Maria Souza', 'super_admin')))
    for (const rotulo of ['Trocar o nome', 'Trocar o e-mail', 'Redefinir a senha', 'Conceder admin', 'Ligar a uma ficha', 'Criar a ficha']) {
      expect(daMaria).toContain(rotulo)
    }
    const daFichaSemConta = texto(desenhar(linha('Maria Aparecida de Souza', 'super_admin')))
    expect(daFichaSemConta).toContain('Ligar a uma conta')
    expect(daFichaSemConta).toContain('Criar a conta')
  })

  /*
   * A LISTA PERMITIDA DOS BOTÕES: em cada linha aberta, para os dois papéis, os
   * botões são o que abre e fecha a linha e um por ação de `acoesDaPessoa` —
   * nem um a mais, nem um a menos.
   */
  it('os botões de cada linha aberta são os das ações dela, e só eles', () => {
    const ROTULO_DA_ACAO: Record<AcaoSobrePessoa, (temConta: boolean) => string> = {
      'resetar-pin': () => 'Resetar PIN',
      conceder: () => 'Conceder admin',
      revogar: () => 'Revogar admin',
      'trocar-nome': () => 'Trocar o nome',
      'trocar-email': () => 'Trocar o e-mail',
      'redefinir-senha': () => 'Redefinir a senha',
      'vincular-ficha': (temConta) => (temConta ? 'Ligar a uma ficha' : 'Ligar a uma conta'),
      'desvincular-ficha': () => 'Desligar da conta',
      'criar-ficha': () => 'Criar a ficha',
      'criar-conta': () => 'Criar a conta',
      'editar-ficha': () => 'Editar a ficha',
      'desativar-ficha': () => 'Desativar a ficha',
      'reativar-ficha': () => 'Reativar a ficha',
    }
    for (const alvo of PESSOAS) {
      for (const papel of ['super_admin', 'admin'] as const) {
        const html = desenhar(linha(alvo.nome, papel))
        const botoes = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((casamento) => texto(casamento[1]).trim())
        const esperados = acoesDaPessoa(alvo, papel).map((acao) => ROTULO_DA_ACAO[acao](alvo.usuarioId !== null))
        // O primeiro botão abre e fecha a linha: é o que leva o nome da pessoa.
        expect(botoes[0], `${alvo.nome} / ${papel}`).toContain(alvo.nome)
        expect(botoes.slice(1).sort(), `${alvo.nome} / ${papel}`).toEqual(esperados.sort())
      }
    }
  })

  it('quem só administra: "só administra — não bate ponto", sem o aviso de "sem acesso"', () => {
    const daRita = texto(desenhar(linha('Rita', 'super_admin')))
    expect(daRita).toContain('só administra — não bate ponto')
    expect(daRita).toContain('administra o ponto')
    expect(daRita).not.toContain('sem acesso ao ponto')
    // A conta sem ficha e sem administrar tem a etiqueta "sem acesso ao ponto".
    expect(texto(desenhar(linha('Maria Souza', 'admin')))).toContain('sem acesso ao ponto')
    // A conta que não existe mais diz isso.
    expect(texto(desenhar(linha('Conta Antiga', 'admin')))).toContain('conta que não existe mais')
  })

  it('a conta do super admin não oferece trocar o e-mail nem revogar', () => {
    const visivel = texto(desenhar(linha('Sérgio', 'super_admin')))
    expect(visivel).not.toContain('Trocar o e-mail')
    expect(visivel).not.toContain('Revogar admin')
    expect(visivel).toContain('super admin')
  })
})

describe('as caixas de vínculo, conta e ficha abrem sem erro de console', () => {
  const nada = () => {}

  it('ligar ficha e conta, dos dois lados, com a sugestão pelo nome', () => {
    // A caixa de vínculo oferece as contas do ponto sem ficha: a Maria, a Rita
    // e o Sérgio — e não a conta que não existe mais.
    expect(contasSemFicha(PESSOAS).map((conta) => conta.usuarioId).sort()).toEqual(['maria', 'rita', 'sergio'])
    const daConta = texto(
      desenhar(
        createElement(CaixaDeVinculo, {
          pessoa: pessoa('Maria Souza'),
          fichas: FICHAS,
          contas: contasSemFicha(PESSOAS),
          gravando: false,
          erro: null,
          aoLigar: nada,
          aoFechar: nada,
        }),
      ),
    )
    expect(daConta).toContain('Maria Aparecida de Souza')
    expect(daConta).toContain('mesmo nome e sobrenome')
    expect(errosDoConsole).toEqual([])

    const daFicha = texto(
      desenhar(
        createElement(CaixaDeVinculo, {
          pessoa: pessoa('Maria Aparecida de Souza'),
          fichas: FICHAS,
          contas: contasSemFicha(PESSOAS),
          preEscolhida: 'maria',
          gravando: false,
          erro: null,
          aoLigar: nada,
          aoFechar: nada,
        }),
      ),
    )
    // Pré-escolhida: abre direto na confirmação, com a consequência escrita.
    expect(daFicha).toContain('passa a bater ponto pela ficha')
    expect(errosDoConsole).toEqual([])
  })

  it('conta nova, livre e a partir de uma ficha sem conta', () => {
    desenhar(
      createElement(FormularioDeNovaConta, {
        fichas: FICHAS,
        fichaFixa: null,
        gravando: false,
        erros: [],
        aoCriar: nada,
        aoFechar: nada,
      }),
    )
    expect(errosDoConsole).toEqual([])

    const daFicha = texto(
      desenhar(
        createElement(FormularioDeNovaConta, {
          fichas: FICHAS,
          fichaFixa: FICHAS[1],
          gravando: false,
          erros: ['O e-mail x já existe no login de outra conta.'],
          aoCriar: nada,
          aoFechar: nada,
        }),
      ),
    )
    expect(daFicha).toContain('Maria Aparecida de Souza')
    expect(daFicha).toContain('já existe no login de outra conta')
    expect(errosDoConsole).toEqual([])
  })

  it.each(['trocar-nome', 'trocar-email', 'redefinir-senha'] as const)('%s', (acao) => {
    const alvo = pessoa('Ana Paula Lima')
    desenhar(
      createElement(FormularioDeConta, {
        acao,
        pessoa: { ...alvo, usuarioId: alvo.usuarioId as string },
        gravando: false,
        erros: [],
        aoEnviar: nada,
        aoFechar: nada,
      }),
    )
    expect(errosDoConsole).toEqual([])
  })

  it('a ficha: editar, criar para uma conta, desativar', () => {
    desenhar(
      createElement(FormularioDaFicha, {
        ficha: FICHAS[0],
        rotuloDaConta: 'Ana Lima — ana@example.com',
        gravando: false,
        erro: null,
        aoSalvar: nada,
        aoFechar: nada,
      }),
    )
    desenhar(
      createElement(FormularioDaFicha, {
        ficha: null,
        usuarioId: 'maria',
        nomeInicial: 'Maria Souza',
        rotuloDaConta: 'Maria Souza — maria@example.com',
        gravando: false,
        erro: null,
        aoSalvar: nada,
        aoFechar: nada,
      }),
    )
    desenhar(createElement(CaixaDeAtivo, { ficha: FICHAS[0], gravando: false, erro: null, aoConfirmar: nada, aoFechar: nada }))
    expect(errosDoConsole).toEqual([])
  })
})
