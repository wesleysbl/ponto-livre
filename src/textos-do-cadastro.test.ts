import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FichaDoFuncionario } from './lib/cadastro'

/*
 * O QUE O CADASTRO DIZ A QUEM CADASTRA.
 *
 * O teste de ponta a ponta (`e2e/cadastro.spec.ts`) percorre o cadastro
 * inteiro pela tela. Este arquivo segura o texto das caixas e das linhas do
 * cadastro, e cada frase delas diz o que o app faz:
 *
 *   • a caixa da senha provisória diz quem troca a senha depois: o super
 *     admin, por "Redefinir a senha", na linha da pessoa. É o que ele precisa
 *     saber ao passar a provisória adiante, e o que ele vai dizer à pessoa;
 *   • a nota da linha do super admin diz como a lista de super admins muda:
 *     por SQL do dono do banco, no painel do Supabase, que é como nasce o
 *     primeiro (`supabase/primeiro-super-admin.sql`). O e-mail de super admin
 *     muda por lá também, porque a função de contas recusa trocá-lo;
 *   • a data "Passou a bater ponto aqui em" é registro: fica guardada e
 *     aparece na lista de pessoas, sem mudar a batida nem a folha. A data de
 *     desligamento também fica registrada na ficha;
 *   • da ficha, a folha leva o nome completo. A ficha, a caixa de desativar e
 *     a de ligar ficha e conta dizem isso, e os outros campos ficam no
 *     cadastro (o que falta neles é pendência de cadastro);
 *   • a batida e a folha são da conta: a ficha sem conta fica guardada, e a
 *     conta sem ficha entra no ponto quando o super admin liga uma ficha a ela.
 *
 * CADA CAIXA É CONFERIDA INTEIRA, trecho por trecho (`trechos`): a lista
 * esperada é tudo o que a caixa diz, na ordem da tela. Uma frase a mais, a
 * menos ou trocada reprova o teste.
 *
 * Mesmo desenho dos outros testes de tela: `renderToString`, com o Supabase
 * simulado e sem rodar efeito.
 */

vi.mock('./lib/supabase', () => ({
  supabase: {
    from: () => {
      throw new Error('O desenho da tela não pode ler o banco.')
    },
    rpc: () => {
      throw new Error('O desenho da tela não pode chamar RPC.')
    },
    functions: { invoke: () => Promise.reject(new Error('sem rede')) },
  },
}))
vi.mock('./hooks/useAuth', () => ({ useAuth: () => null }))

const { FormularioDeConta, FormularioDeNovaConta } = await import('./components/CaixasDeConta')
const { LinhaDePessoa } = await import('./components/ListaDePessoas')
const { CaixaDeAtivo, FormularioDaFicha } = await import('./components/FichaDoFuncionario')
const { CaixaDeVinculo } = await import('./components/CaixaDeVinculo')
const { acoesDaPessoa, contasSemFicha, montarPessoas } = await import('./lib/pessoas')

let errosDoConsole: unknown[][] = []

beforeEach(() => {
  errosDoConsole = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errosDoConsole.push(args)
  })
})

afterEach(() => {
  expect(errosDoConsole).toEqual([])
  vi.restoreAllMocks()
})

function desenhar(elemento: ReactElement): string {
  return renderToString(createElement(MemoryRouter, null, elemento))
}

/**
 * O texto visível, trecho por trecho e na ordem da tela: cada pedaço de texto
 * entre duas tags. Os marcadores que o `renderToString` põe entre dois textos
 * vizinhos (`<!-- -->`) e o negrito saem antes, porque são parte da mesma
 * frase.
 */
function trechos(html: string): string[] {
  return html
    .replace(/<!-- -->|<\/?strong>/g, '')
    .split(/<[^>]+>/)
    .map((trecho) =>
      trecho
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((trecho) => trecho !== '')
}

const nada = () => {}

/* O super admin da instalação, com a conta criada no painel e o nome trocado no app. */
const [SERGIO, ANA] = montarPessoas({
  funcionarios: [
    {
      usuarioId: 'sergio',
      nome: 'Sérgio Almeida',
      nomeDaConta: 'Sérgio Almeida',
      email: 'admin@example.com',
      podeBater: true,
      contaApagada: false,
      temFicha: false,
    },
    {
      usuarioId: 'ana',
      nome: 'Ana Beatriz Rocha',
      nomeDaConta: 'Ana Beatriz Rocha',
      email: 'ana@example.com',
      podeBater: false,
      contaApagada: false,
      temFicha: false,
    },
  ],
  administradores: [],
  superAdmins: ['sergio'],
  estadosDoPin: [],
  batidas: [],
  hoje: '2026-10-23',
  agora: Date.parse('2026-10-23T15:00:00Z'),
})

/** A frase embaixo do campo da senha provisória, na conta nova e em "Redefinir a senha". */
const A_SENHA_PROVISORIA =
  'Copie a senha antes de confirmar e passe à pessoa por um canal seguro: depois de gravada, ela não aparece mais em lugar nenhum. A pessoa entra com ela; para trocar de senha, o super admin usa “Redefinir a senha” na linha dela.'

describe('a senha provisória', () => {
  it('a conta nova diz que quem troca a senha depois é o super admin, por “Redefinir a senha”', () => {
    const html = desenhar(
      createElement(FormularioDeNovaConta, {
        fichas: [],
        fichaFixa: null,
        gravando: false,
        erros: [],
        aoCriar: nada,
        aoFechar: nada,
      }),
    )
    expect(trechos(html)).toEqual([
      'Super admin',
      'Nova conta para bater ponto',
      'Nome da pessoa',
      'E-mail para entrar',
      'Senha provisória',
      'Sugerir outra senha',
      A_SENHA_PROVISORIA,
      'Ficha do ponto',
      'Criar uma ficha nova com este nome',
      'Sem ficha por enquanto',
      'Nasce uma ficha só com o nome, já ligada à conta: a pessoa bate ponto por ela. CPF, cargo, admissão e a data em que passou a bater ponto aqui se completam depois, em “Editar a ficha”.',
      'Cancelar',
      'Criar a conta',
    ])
  })

  it('redefinir a senha diz o mesmo', () => {
    const html = desenhar(
      createElement(FormularioDeConta, {
        acao: 'redefinir-senha',
        pessoa: { ...ANA, usuarioId: 'ana' },
        gravando: false,
        erros: [],
        aoEnviar: nada,
        aoFechar: nada,
      }),
    )
    expect(trechos(html)).toEqual([
      'Super admin',
      'Redefinir a senha',
      'Ana Beatriz Rocha · ana@example.com',
      'Senha provisória',
      'Sugerir outra senha',
      A_SENHA_PROVISORIA,
      'A senha atual de Ana Beatriz Rocha deixa de valer na hora. O PIN não muda: para isso, use “Resetar PIN”.',
      'Cancelar',
      'Redefinir a senha',
    ])
  })
})

describe('a linha do super admin', () => {
  it('diz que a lista de super admins e o e-mail de super admin mudam por SQL do dono do banco, no painel do Supabase', () => {
    expect(SERGIO.superAdmin).toBe(true)
    const html = desenhar(
      createElement(LinhaDePessoa, {
        pessoa: SERGIO,
        acoes: acoesDaPessoa(SERGIO, 'super_admin', 'sergio'),
        periodo: { inicio: '2026-10-01', fim: '2026-10-31' },
        aberta: true,
        sugestao: null,
        aoAbrir: nada,
        aoPedir: nada,
      }),
    )
    expect(trechos(html)).toEqual([
      // O cabeçalho que se toca para abrir.
      'Sérgio Almeida',
      'admin@example.com',
      'super admin',
      'sem ficha',
      'sem PIN — define na próxima entrada',
      '0',
      'batidas',
      // O ponto e a folha.
      'Ver e corrigir o ponto de Sérgio',
      'Imprimir a folha de outubro de 2026',
      // A conta, com a nota do super admin.
      'Conta',
      'super admin — bate ponto só para teste.',
      'Trocar o nome',
      'Redefinir a senha',
      'Super admin do ponto: administra sempre e escolhe quem administra. A lista de super admins não muda pelo app: só por SQL do dono do banco, no painel do Supabase. O e-mail de super admin também só muda por lá.',
      // A ficha.
      'Ficha do ponto',
      'Sem ficha: como super admin, entra e bate só para teste — as batidas não entram na folha de ninguém.',
      'Ligar a uma ficha',
      'Criar a ficha',
      // A administração e o PIN.
      'Administração e PIN',
      'Resetar PIN',
    ])
  })
})

/* ------------------------------------------------------------------ */
/* A ficha e a lista dizem o que o app faz hoje                        */
/* ------------------------------------------------------------------ */

/** Ligada à conta, com o cadastro pela metade e sem a data de início no ponto (`batePontoDesde`). */
const FICHA_DA_BRUNA: FichaDoFuncionario = {
  id: 'f-bruna',
  usuarioId: 'bruna',
  nomeCompleto: 'Bruna Costa',
  cpf: null,
  matricula: '42',
  cargo: 'Compras',
  admissao: '2026-03-02',
  desligamento: null,
  ctps: null,
  ctpsSerie: null,
  centroCusto: null,
  ativo: true,
  batePontoDesde: null,
  atualizadoEm: null,
}

/** Sem conta. A conta sem ficha de mesmo nome é a candidata do vínculo. */
const FICHA_SEM_CONTA: FichaDoFuncionario = {
  ...FICHA_DA_BRUNA,
  id: 'f-daniela',
  usuarioId: null,
  nomeCompleto: 'Daniela Freitas',
}

const GENTE_COM_FICHA = montarPessoas({
  funcionarios: [
    {
      usuarioId: 'bruna',
      nome: 'Bruna',
      nomeDaConta: 'Bruna',
      email: 'bruna@example.com',
      podeBater: true,
      contaApagada: false,
      temFicha: false,
    },
    {
      usuarioId: 'daniela',
      nome: 'Daniela Freitas',
      nomeDaConta: 'Daniela Freitas',
      email: 'daniela@example.com',
      podeBater: false,
      contaApagada: false,
      temFicha: false,
    },
  ],
  administradores: [],
  estadosDoPin: [],
  batidas: [],
  fichas: [FICHA_DA_BRUNA, FICHA_SEM_CONTA],
  hoje: '2026-10-23',
  agora: Date.parse('2026-10-23T15:00:00Z'),
})

/** A linha desta conta (`usuarioId`) ou, com `null`, a da ficha sem conta. */
function daLista(usuarioId: string | null) {
  const achada = GENTE_COM_FICHA.find((pessoa) => pessoa.usuarioId === usuarioId)
  if (!achada) throw new Error(`sem a linha ${usuarioId ?? 'da ficha sem conta'} nos dados do teste`)
  return achada
}

/** Os trechos da linha aberta desta conta, como quem administra a vê. */
function linhaAberta(usuarioId: string | null): string[] {
  const alvo = daLista(usuarioId)
  return trechos(
    desenhar(
      createElement(LinhaDePessoa, {
        pessoa: alvo,
        acoes: acoesDaPessoa(alvo, 'admin'),
        periodo: { inicio: '2026-10-01', fim: '2026-10-31' },
        aberta: true,
        sugestao: null,
        aoAbrir: nada,
        aoPedir: nada,
      }),
    ),
  )
}

/** Os rótulos dos campos de RH da ficha, na ordem da caixa. */
const CAMPOS_DA_FICHA = [
  'Nome completo',
  'CPF',
  'Matrícula',
  'Cargo',
  'Admissão',
  'Desligamento',
  'CTPS',
  'Série',
  'Centro de custo',
]

/** A frase do topo da caixa da ficha: o que dela sai na folha. */
const O_QUE_SAI_NA_FOLHA =
  'O nome completo é o que sai na folha que a pessoa assina; os outros campos ficam guardados no cadastro. Deixar um campo vazio é melhor do que inventar.'

/** A frase embaixo do campo "Passou a bater ponto aqui em". */
const A_DATA_E_REGISTRO =
  'A data em que a pessoa começou a bater ponto neste sistema. Ela fica guardada e aparece na lista de pessoas, mas não muda nada no ponto: não libera nem bloqueia a batida e não entra na folha. Preencha quando a pessoa começar de verdade.'

describe('a ficha do funcionário', () => {
  it('diz que da ficha só o nome completo sai na folha, e que a data "Passou a bater ponto aqui em" é registro', () => {
    const html = desenhar(
      createElement(FormularioDaFicha, {
        ficha: FICHA_DA_BRUNA,
        rotuloDaConta: 'Bruna Costa — bruna@example.com',
        gravando: false,
        erro: null,
        aoSalvar: nada,
        aoFechar: nada,
      }),
    )
    expect(trechos(html)).toEqual([
      'Editar ficha',
      'Bruna Costa',
      O_QUE_SAI_NA_FOLHA,
      ...CAMPOS_DA_FICHA,
      'Conta para bater ponto',
      'Bruna Costa — bruna@example.com',
      'Ligar e desligar a conta é feito na lista de pessoas, pelo super admin: a ficha ligada é o que libera o ponto para a conta.',
      'Passou a bater ponto aqui em',
      A_DATA_E_REGISTRO,
      'Cancelar',
      'Salvar a ficha',
    ])
  })

  it('sem conta, diz que a ficha fica guardada e que a batida e a folha são da conta', () => {
    const html = desenhar(
      createElement(FormularioDaFicha, {
        ficha: null,
        rotuloDaConta: null,
        gravando: false,
        erro: null,
        aoSalvar: nada,
        aoFechar: nada,
      }),
    )
    expect(trechos(html)).toEqual([
      'Nova ficha',
      'Funcionário do ponto',
      O_QUE_SAI_NA_FOLHA,
      ...CAMPOS_DA_FICHA,
      'Conta para bater ponto',
      'Sem conta — não bate ponto pelo celular',
      'Sem conta, a ficha fica guardada, mas ainda não há batida nem folha: as duas são da conta. O super admin liga a ficha a uma conta na lista de pessoas.',
      'Passou a bater ponto aqui em',
      A_DATA_E_REGISTRO,
      'Cancelar',
      'Criar a ficha',
    ])
  })

  it('desativar diz o que fica: as batidas, a folha com o nome da ficha e a data de desligamento registrada', () => {
    const html = desenhar(
      createElement(CaixaDeAtivo, {
        ficha: FICHA_DA_BRUNA,
        gravando: false,
        erro: null,
        aoConfirmar: nada,
        aoFechar: nada,
      }),
    )
    expect(trechos(html)).toEqual([
      'Confirmar',
      'Desativar a ficha',
      'Bruna Costa',
      'A ficha de Bruna Costa sai da lista de gente ativa e o CPF dela libera para uma ficha nova, se um dia ela for recontratada. A conta ligada a ela deixa de bater ponto pela ficha (se administra o ponto, continua entrando só para administrar). As batidas dela ficam, e a folha continua saindo com o nome desta ficha. Nada é apagado, e a ficha pode ser reativada depois. Se a pessoa foi desligada, preencha também a data de desligamento na ficha: ela fica registrada e aparece na lista de pessoas.',
      'Cancelar',
      'Desativar',
    ])
  })
})

describe('a lista de pessoas e o vínculo', () => {
  it('a ficha pela metade é pendência de cadastro, e a conta sem ficha entra no ponto quando o super admin liga uma ficha', () => {
    expect(linhaAberta('bruna')).toEqual([
      'Bruna Costa',
      'bruna@example.com',
      'com ficha',
      'sem PIN — define na próxima entrada',
      '0',
      'batidas',
      'Ver e corrigir o ponto de Bruna',
      'Imprimir a folha de outubro de 2026',
      'Conta',
      'bate ponto pela ficha.',
      'Ficha do ponto',
      'Bruna Costa',
      'Compras · matrícula 42',
      'tem conta; falta a data em que passou a bater ponto aqui',
      'admitida em 02/03/2026',
      'Falta preencher na ficha: CPF, CTPS, série da CTPS, centro de custo.',
      'Editar a ficha',
      'Desativar a ficha',
      'Administração e PIN',
      'Resetar PIN',
    ])

    expect(linhaAberta('daniela')).toEqual([
      'Daniela Freitas',
      'daniela@example.com',
      'sem acesso ao ponto',
      'sem ficha',
      'sem PIN — define na próxima entrada',
      '0',
      'batidas',
      'Ver e corrigir o ponto de Daniela',
      'Imprimir a folha de outubro de 2026',
      'Conta',
      'sem acesso ao ponto.',
      'Ficha do ponto',
      'Sem ficha do ponto: a pessoa só entra no ponto quando o super admin ligar uma ficha a esta conta.',
      'Administração e PIN',
      'Resetar PIN',
    ])
  })

  it('ligar ficha e conta: a folha sai com o nome completo da ficha', () => {
    const html = desenhar(
      createElement(CaixaDeVinculo, {
        pessoa: daLista(null),
        fichas: [FICHA_DA_BRUNA, FICHA_SEM_CONTA],
        contas: contasSemFicha(GENTE_COM_FICHA),
        preEscolhida: 'daniela',
        gravando: false,
        erro: null,
        aoLigar: nada,
        aoFechar: nada,
      }),
    )
    expect(trechos(html)).toEqual([
      'Super admin',
      'Ligar a uma conta',
      'Daniela Freitas · ficha sem conta',
      'Daniela Freitas',
      'daniela@example.com',
      'sugerida: mesmo nome',
      'A ficha “Daniela Freitas” passa a ser da conta Daniela Freitas (daniela@example.com). Essa conta passa a bater ponto pela ficha, e a folha dela sai com o nome completo desta ficha. Um vínculo errado dá a jornada de uma pessoa para outra: confira o e-mail.',
      'Escolher outra',
      'Ligar',
    ])
  })
})
