import { describe, expect, it } from 'vitest'
import type { LeituraDoAcesso, LeituraDoPin } from '../contexts/autenticacao'
import {
  administracaoDoAcesso,
  decidirRota,
  decidirSemAcesso,
  lerRespostaDoAcesso,
  papelNaAdministracao,
  podeBater,
  primeiroNomeDaConta,
  ROTULO_DA_ADMINISTRACAO,
  ROTULO_SEM_CARGO,
  rotuloDaConta,
  telaInicial,
  type AcessoAoPonto,
  type EstadoDaSessao,
} from './acesso'

/*
 * O ACESSO AO PONTO E A GUARDA DE ROTA.
 *
 * O QUE ESTE ARQUIVO SEGURA: quem diz quem entra é o banco do ponto, pela ficha
 * e pelo papel. Entrar e bater são dois degraus — entrar: ficha que
 * libera OU administração; bater: ficha que libera OU super admin. A guarda e
 * a tela de bater seguem a resposta de `ponto_meu_acesso()`. Os testes dizem,
 * com as respostas do banco escritas como o contrato as define:
 *   • o administrador sem ficha (a Rita, do RH) entra, define o PIN e abre o
 *     painel, mas não bate — e cai no painel depois do login;
 *   • o super admin sem ficha (o Sérgio) entra e bate;
 *   • a ficha desligada (a Fernanda) não entra, nem a conta sem ficha e sem
 *     papel;
 *   • leitura que não chegou não passa (carregando), e a que falhou mostra a
 *     tela de tentar de novo — falha fechada, nunca um "pode entrar".
 */

/** As respostas de `ponto_meu_acesso()`, como o banco do ponto as manda. */
const RESPOSTA = {
  /** Ana Beatriz: ficha ativa que libera, não administra. */
  colaboradora: {
    tem_acesso: true,
    origem: 'ficha',
    administra: false,
    super_admin: false,
    bate_ponto: true,
    nome: 'Ana Beatriz Rocha',
    cargo: 'Coordenadora de vendas',
  },
  /** Rita, do RH: administra, sem ficha. Entra e não bate. */
  adminSemFicha: {
    tem_acesso: true,
    origem: 'administracao',
    administra: true,
    super_admin: false,
    bate_ponto: false,
    nome: 'Rita',
    cargo: null,
  },
  /** Sérgio: super admin, sem ficha. Entra e bate (só para teste). */
  superAdminSemFicha: {
    tem_acesso: true,
    origem: 'administracao',
    administra: true,
    super_admin: true,
    bate_ponto: true,
    nome: 'Sérgio Almeida',
    cargo: null,
  },
  /** Fernanda: a ficha está ligada, mas desligada em 15/09. Não entra. */
  fichaDesligada: {
    tem_acesso: false,
    origem: null,
    administra: false,
    super_admin: false,
    bate_ponto: false,
    nome: 'Fernanda Teles',
    cargo: 'Vendas',
  },
} as const

const ok = (resposta: unknown): LeituraDoAcesso => ({ estado: 'ok', acesso: lerRespostaDoAcesso(resposta) })

const ACESSO: AcessoAoPonto = lerRespostaDoAcesso(RESPOSTA.colaboradora)

const acessoOk = (extras: Partial<AcessoAoPonto> = {}): LeituraDoAcesso => ({
  estado: 'ok',
  acesso: { ...ACESSO, ...extras },
})

const pinOk = (extras: { definido?: boolean; precisa_redefinir?: boolean } = {}): LeituraDoPin => ({
  estado: 'ok',
  status: { definido: true, precisa_redefinir: false, bloqueado_ate: null, ...extras },
})

function sessao(extras: Partial<EstadoDaSessao> = {}): EstadoDaSessao {
  return {
    carregando: false,
    temUsuario: true,
    acesso: acessoOk(),
    pin: pinOk(),
    ...extras,
  }
}

const COMUM = { exigePin: true, exigeAdmin: false }
const ADMIN = { exigePin: true, exigeAdmin: true }
const DEFINIR_PIN = { exigePin: false, exigeAdmin: false }

/* ------------------------------------------------------------------ */

describe('lerRespostaDoAcesso — o jsonb de ponto_meu_acesso()', () => {
  it('lê as sete chaves do contrato com os nomes do app', () => {
    expect(lerRespostaDoAcesso(RESPOSTA.colaboradora)).toEqual({
      temAcesso: true,
      origem: 'ficha',
      administra: false,
      superAdmin: false,
      batePonto: true,
      nome: 'Ana Beatriz Rocha',
      cargo: 'Coordenadora de vendas',
    })
    expect(lerRespostaDoAcesso(RESPOSTA.adminSemFicha)).toEqual({
      temAcesso: true,
      origem: 'administracao',
      administra: true,
      superAdmin: false,
      batePonto: false,
      nome: 'Rita',
      cargo: null,
    })
  })

  it('a origem que o app não conhece vira nula, e o acesso continua o que o banco disse', () => {
    const lido = lerRespostaDoAcesso({ ...RESPOSTA.colaboradora, origem: 'desconhecida' })
    expect(lido.origem).toBeNull()
    expect(lido.temAcesso).toBe(true)
  })

  it('sem acesso, a origem é nula mesmo que o banco mande outra coisa', () => {
    expect(lerRespostaDoAcesso({ ...RESPOSTA.fichaDesligada, origem: 'ficha' }).origem).toBeNull()
  })

  it('bater exige entrar: bate_ponto sem tem_acesso não abre o botão', () => {
    expect(lerRespostaDoAcesso({ ...RESPOSTA.fichaDesligada, bate_ponto: true }).batePonto).toBe(false)
  })

  it('nome e cargo são tolerantes: em branco ou fora do formato viram nulos, sem erro', () => {
    const lido = lerRespostaDoAcesso({ ...RESPOSTA.colaboradora, nome: '   ', cargo: 42 })
    expect(lido.nome).toBeNull()
    expect(lido.cargo).toBeNull()
    const semOsDois = { ...RESPOSTA.colaboradora } as Record<string, unknown>
    delete semOsDois.nome
    delete semOsDois.cargo
    expect(lerRespostaDoAcesso(semOsDois)).toMatchObject({ nome: null, cargo: null, batePonto: true })
    // Aparados: espaço em volta não vira parte do nome.
    expect(lerRespostaDoAcesso({ ...RESPOSTA.colaboradora, cargo: '  Analista ' }).cargo).toBe('Analista')
  })

  it.each([
    ['nulo', null],
    ['texto', 'sim'],
    ['lista', [true]],
    ['sem tem_acesso', { ...RESPOSTA.colaboradora, tem_acesso: undefined }],
    ['tem_acesso como texto', { ...RESPOSTA.colaboradora, tem_acesso: 'true' }],
    ['sem super_admin', { ...RESPOSTA.colaboradora, super_admin: undefined }],
    // Uma resposta sem `bate_ponto`, `nome` e `cargo`.
    ['sem bate_ponto, nome e cargo', { tem_acesso: true, origem: 'desconhecida', administra: true, super_admin: true }],
    ['bate_ponto nulo', { ...RESPOSTA.colaboradora, bate_ponto: null }],
  ])('formato inesperado (%s) é ERRO, e não "sem acesso"', (_caso, resposta) => {
    expect(() => lerRespostaDoAcesso(resposta)).toThrow(/acesso ao ponto/)
  })
})

describe('os três casos da tabela de decisões, pela resposta do banco', () => {
  it('administrador sem ficha: entra, define o PIN e abre o painel — mas não bate', () => {
    const acesso = ok(RESPOSTA.adminSemFicha)
    // Entrou e ainda não tem PIN: a guarda leva para criar, e a tela de criar abre.
    expect(decidirRota(sessao({ acesso, pin: pinOk({ definido: false }) }), COMUM)).toEqual({
      tipo: 'ir',
      para: '/definir-pin',
    })
    expect(decidirRota(sessao({ acesso, pin: pinOk({ definido: false }) }), DEFINIR_PIN)).toEqual({
      tipo: 'mostrar',
    })
    // Com o PIN, o painel e a administração abrem.
    expect(decidirRota(sessao({ acesso }), ADMIN)).toEqual({ tipo: 'mostrar' })
    // A primeira tela, depois do login e depois de criar o PIN, é o painel.
    expect(telaInicial(acesso)).toBe('/painel')
    // E não bate: a tela de bater troca o botão pelo caminho do painel.
    expect(podeBater(acesso)).toBe(false)
    expect(papelNaAdministracao(acesso)).toBe('admin')
  })

  it('super admin sem ficha: entra e bate (só para teste), e começa na tela de bater', () => {
    const acesso = ok(RESPOSTA.superAdminSemFicha)
    expect(decidirRota(sessao({ acesso }), COMUM)).toEqual({ tipo: 'mostrar' })
    expect(decidirRota(sessao({ acesso }), ADMIN)).toEqual({ tipo: 'mostrar' })
    expect(podeBater(acesso)).toBe(true)
    expect(telaInicial(acesso)).toBe('/')
    expect(papelNaAdministracao(acesso)).toBe('super_admin')
  })

  it('ficha desligada: não entra — nem para criar o PIN, nem para o painel', () => {
    const acesso = ok(RESPOSTA.fichaDesligada)
    for (const exigencias of [COMUM, ADMIN, DEFINIR_PIN]) {
      expect(decidirRota(sessao({ acesso }), exigencias)).toEqual({ tipo: 'ir', para: '/sem-acesso' })
    }
    expect(decidirSemAcesso(sessao({ acesso }))).toEqual({ tipo: 'mostrar' })
    expect(podeBater(acesso)).toBe(false)
  })

  it('sem ficha e sem papel: não entra, não bate e não administra (a conta de quem ficou de fora)', () => {
    // O banco dá o e-mail como nome a quem não tem ficha nem nome guardado na conta.
    const acesso = ok({
      tem_acesso: false,
      origem: null,
      administra: false,
      super_admin: false,
      bate_ponto: false,
      nome: 'conta-antiga@example.com',
      cargo: null,
    })
    for (const exigencias of [COMUM, ADMIN, DEFINIR_PIN]) {
      expect(decidirRota(sessao({ acesso }), exigencias)).toEqual({ tipo: 'ir', para: '/sem-acesso' })
    }
    expect(decidirSemAcesso(sessao({ acesso }))).toEqual({ tipo: 'mostrar' })
    expect(podeBater(acesso)).toBe(false)
    expect(papelNaAdministracao(acesso)).toBe('nenhum')
    expect(telaInicial(acesso)).toBe('/')
  })

  it('ficha ativa: entra, bate e começa na tela de bater; o painel devolve para ela', () => {
    const acesso = ok(RESPOSTA.colaboradora)
    expect(decidirRota(sessao({ acesso }), COMUM)).toEqual({ tipo: 'mostrar' })
    expect(decidirRota(sessao({ acesso }), ADMIN)).toEqual({ tipo: 'ir', para: '/' })
    expect(podeBater(acesso)).toBe(true)
    expect(telaInicial(acesso)).toBe('/')
  })

  it('quem administra E tem ficha bate, e começa na tela de bater (a ficha ganha na origem)', () => {
    const acesso = ok({ ...RESPOSTA.colaboradora, administra: true })
    expect(podeBater(acesso)).toBe(true)
    expect(telaInicial(acesso)).toBe('/')
    expect(decidirRota(sessao({ acesso }), ADMIN)).toEqual({ tipo: 'mostrar' })
  })
})

describe('telaInicial — a primeira tela depois do login', () => {
  it('enquanto o acesso não chega, nenhuma: quem chama espera', () => {
    expect(telaInicial({ estado: 'carregando' })).toBeNull()
  })

  it('leitura que falhou vai para a raiz, onde a guarda mostra a tela de tentar de novo', () => {
    expect(telaInicial({ estado: 'falhou', erro: 'rede' })).toBe('/')
  })

  it('sem acesso vai para a raiz, de onde a guarda manda para "sem acesso" — nunca para o painel', () => {
    expect(telaInicial(ok({ ...RESPOSTA.fichaDesligada, administra: true }))).toBe('/')
  })
})

describe('rotuloDaConta e primeiroNomeDaConta — como a tela de bater chama a conta', () => {
  it('o cargo da ficha que libera a conta', () => {
    expect(rotuloDaConta(lerRespostaDoAcesso(RESPOSTA.colaboradora))).toBe('Coordenadora de vendas')
  })

  it('"Administração do ponto" para quem entra pela administração, com ou sem PIN de batida', () => {
    expect(rotuloDaConta(lerRespostaDoAcesso(RESPOSTA.adminSemFicha))).toBe(ROTULO_DA_ADMINISTRACAO)
    expect(rotuloDaConta(lerRespostaDoAcesso(RESPOSTA.superAdminSemFicha))).toBe(ROTULO_DA_ADMINISTRACAO)
    expect(ROTULO_DA_ADMINISTRACAO).toBe('Administração do ponto')
  })

  it('ficha sem cargo: o rótulo padrão; ficha que não libera não empresta o cargo a quem administra', () => {
    expect(rotuloDaConta({ origem: 'ficha', cargo: null })).toBe(ROTULO_SEM_CARGO)
    expect(rotuloDaConta({ origem: 'administracao', cargo: 'Analista' })).toBe(ROTULO_DA_ADMINISTRACAO)
  })

  it('o primeiro nome do nome que o banco dá à conta', () => {
    expect(primeiroNomeDaConta({ nome: 'Ana Beatriz Rocha' })).toBe('Ana')
    expect(primeiroNomeDaConta({ nome: 'Rita' })).toBe('Rita')
  })

  it('sem ficha nem nome guardado o banco manda o e-mail — e "Olá, e-mail" não é saudação', () => {
    expect(primeiroNomeDaConta({ nome: 'daniela@example.com' })).toBeNull()
    expect(primeiroNomeDaConta({ nome: null })).toBeNull()
    expect(primeiroNomeDaConta({ nome: '  ' })).toBeNull()
  })
})

describe('papelNaAdministracao — o papel de quem olha a área de administração', () => {
  it('super admin exige as duas respostas', () => {
    expect(papelNaAdministracao(acessoOk({ administra: true, superAdmin: true }))).toBe('super_admin')
    // Incoerente (o banco não deixa): fica com o papel menor, falha fechada.
    expect(papelNaAdministracao(acessoOk({ administra: false, superAdmin: true }))).toBe('nenhum')
  })

  it('admin comum é quem administra e não é super admin', () => {
    expect(papelNaAdministracao(acessoOk({ administra: true }))).toBe('admin')
  })

  it('leitura carregando ou que falhou não dá papel nenhum', () => {
    expect(papelNaAdministracao({ estado: 'carregando' })).toBe('nenhum')
    expect(papelNaAdministracao({ estado: 'falhou', erro: 'rede' })).toBe('nenhum')
  })
})

describe('administracaoDoAcesso — a leitura da administração, derivada da do acesso', () => {
  it('copia os três estados', () => {
    expect(administracaoDoAcesso({ estado: 'carregando' })).toEqual({ estado: 'carregando' })
    expect(administracaoDoAcesso({ estado: 'falhou', erro: 'x' })).toEqual({ estado: 'falhou', erro: 'x' })
    expect(administracaoDoAcesso(acessoOk({ administra: true }))).toEqual({ estado: 'ok', administra: true })
    expect(administracaoDoAcesso(acessoOk())).toEqual({ estado: 'ok', administra: false })
  })
})

describe('podeBater — leitura que não chegou não abre o botão', () => {
  it('carregando ou falhou: não bate (a tela de bater só abre depois da guarda, com a resposta na mão)', () => {
    expect(podeBater({ estado: 'carregando' })).toBe(false)
    expect(podeBater({ estado: 'falhou', erro: 'rede' })).toBe(false)
  })
})

describe('decidirRota — a escada da guarda: quem diz se a pessoa entra é o banco', () => {
  it('quem o banco diz que tem acesso passa — não há outra conferência na sessão', () => {
    expect(decidirRota(sessao(), COMUM)).toEqual({ tipo: 'mostrar' })
  })

  it('quem o banco diz que NÃO tem acesso vai para /sem-acesso', () => {
    expect(decidirRota(sessao({ acesso: acessoOk({ temAcesso: false, origem: null }) }), COMUM)).toEqual({
      tipo: 'ir',
      para: '/sem-acesso',
    })
  })

  it('sem sessão: /entrar; carregando: espera', () => {
    expect(decidirRota(sessao({ temUsuario: false }), COMUM)).toEqual({ tipo: 'ir', para: '/entrar' })
    expect(decidirRota(sessao({ carregando: true }), COMUM)).toEqual({ tipo: 'carregando' })
  })

  it('acesso ainda carregando NÃO deixa passar nem redireciona', () => {
    expect(decidirRota(sessao({ acesso: { estado: 'carregando' } }), COMUM)).toEqual({
      tipo: 'carregando',
    })
  })

  it('acesso que falhou: tela de tentar de novo, com o motivo — nunca "pode entrar"', () => {
    expect(
      decidirRota(sessao({ acesso: { estado: 'falhou', erro: 'Sem rede.' } }), COMUM),
    ).toEqual({ tipo: 'indisponivel', motivo: 'Sem rede.' })
  })

  it('rota de admin: quem não administra volta para a tela de bater, e não para /sem-acesso', () => {
    expect(decidirRota(sessao(), ADMIN)).toEqual({ tipo: 'ir', para: '/' })
    expect(decidirRota(sessao({ acesso: acessoOk({ administra: true }) }), ADMIN)).toEqual({
      tipo: 'mostrar',
    })
  })

  it('o PIN vem depois do acesso: sem PIN ou com reset vai para /definir-pin', () => {
    expect(decidirRota(sessao({ pin: pinOk({ definido: false }) }), COMUM)).toEqual({
      tipo: 'ir',
      para: '/definir-pin',
    })
    expect(decidirRota(sessao({ pin: pinOk({ precisa_redefinir: true }) }), COMUM)).toEqual({
      tipo: 'ir',
      para: '/definir-pin',
    })
    // A própria tela de definir PIN não exige PIN — senão seria laço com ela mesma.
    expect(decidirRota(sessao({ pin: pinOk({ definido: false }) }), DEFINIR_PIN)).toEqual({ tipo: 'mostrar' })
  })

  it('PIN que falhou: tela de tentar de novo', () => {
    expect(decidirRota(sessao({ pin: { estado: 'falhou', erro: 'PIN não veio.' } }), COMUM)).toEqual({
      tipo: 'indisponivel',
      motivo: 'PIN não veio.',
    })
  })
})

describe('decidirSemAcesso — a tela "sem acesso"', () => {
  it('liberado (pela ficha ou pela administração) enquanto olhava a tela: sai sozinho', () => {
    expect(decidirSemAcesso(sessao({ acesso: ok(RESPOSTA.colaboradora) }))).toEqual({ tipo: 'ir', para: '/' })
    expect(decidirSemAcesso(sessao({ acesso: ok(RESPOSTA.adminSemFicha) }))).toEqual({ tipo: 'ir', para: '/' })
  })

  it('sem acesso: mostra a tela', () => {
    expect(decidirSemAcesso(sessao({ acesso: acessoOk({ temAcesso: false, origem: null }) }))).toEqual({
      tipo: 'mostrar',
    })
  })

  it('sem resposta do banco não diz "não foi liberado": espera, ou mostra a tela de tentar de novo', () => {
    expect(decidirSemAcesso(sessao({ acesso: { estado: 'carregando' } }))).toEqual({ tipo: 'carregando' })
    expect(decidirSemAcesso(sessao({ acesso: { estado: 'falhou', erro: 'rede' } }))).toEqual({
      tipo: 'indisponivel',
      motivo: 'rede',
    })
  })

  it('sem sessão: o login', () => {
    expect(decidirSemAcesso(sessao({ temUsuario: false }))).toEqual({ tipo: 'ir', para: '/entrar' })
  })
})
