import { describe, expect, it } from 'vitest'
import type { FichaDoFuncionario } from './cadastro'
import type { FuncionarioDoPainel } from './painel'
import {
  comNomeGravado,
  comNomesDasFichas,
  fotografiaDasBatidas,
  nomeDeExibicao,
  nomeDeQuemPediu,
  nomesDasFichas,
  pessoaForaDaLista,
  SEM_NOME,
} from './nomes'

/*
 * A REGRA ÚNICA DO NOME: ficha de RH ligada à conta → nome guardado na conta
 * → nome gravado na batida → e-mail. Os casos são os que aparecem numa empresa
 * comum: as contas de função cujo nome guardado ainda é o do dono anterior (a
 * `ana@` da Ana Beatriz Rocha diz "Vítor Campos") e as contas sem nome
 * guardado, que só têm o e-mail.
 */

function ficha(
  usuarioId: string | null,
  nomeCompleto: string,
  extras: Partial<FichaDoFuncionario> = {},
): Pick<FichaDoFuncionario, 'usuarioId' | 'nomeCompleto' | 'ativo'> {
  return { usuarioId, nomeCompleto, ativo: true, ...extras }
}

function conta(
  usuarioId: string,
  nome: string,
  email: string | null,
  nomeDaConta: string | null = nome === email ? null : nome,
): FuncionarioDoPainel {
  return {
    usuarioId,
    nome,
    nomeDaConta,
    email,
    podeBater: true,
    contaApagada: false,
    temFicha: false,
  }
}

describe('nomeDeExibicao — ficha, depois o nome guardado na conta, depois nome gravado, depois e-mail', () => {
  it('com ficha: o nome da ficha', () => {
    expect(
      nomeDeExibicao({ ficha: 'Daniela Freitas', conta: 'Daniela', email: 'daniela@example.com' }),
    ).toBe('Daniela Freitas')
  })

  it('nome da conta errado com ficha certa: a ficha ganha (a conta de função da Ana Beatriz)', () => {
    expect(
      nomeDeExibicao({
        ficha: 'Ana Beatriz Rocha',
        conta: 'Vítor Campos',
        email: 'ana@example.com',
      }),
    ).toBe('Ana Beatriz Rocha')
  })

  it('só o nome guardado na conta (quem só administra e não tem ficha): o nome da conta', () => {
    expect(nomeDeExibicao({ ficha: null, conta: 'Sérgio Almeida', email: 'admin2@example.com' })).toBe(
      'Sérgio Almeida',
    )
  })

  it('só e-mail (conta sem nome, sem ficha): o e-mail', () => {
    expect(nomeDeExibicao({ ficha: null, conta: null, email: 'gustavo@example.com' })).toBe(
      'gustavo@example.com',
    )
  })

  /*
   * O nome gravado na batida vem antes do e-mail: sem esse degrau, a conta sem
   * ficha que perdeu o nome apareceria pelo e-mail, mesmo com o nome de quem
   * bateu guardado na própria batida.
   */
  it('só nome gravado (sem ficha, conta sem nome): o gravado, e não o e-mail', () => {
    expect(nomeDeExibicao({ ficha: null, conta: null, gravado: 'Fernanda Teles', email: 'fernanda@example.com' })).toBe(
      'Fernanda Teles',
    )
  })

  it('o gravado nunca ganha da ficha nem do nome guardado hoje', () => {
    expect(
      nomeDeExibicao({ ficha: 'Ana Beatriz Rocha', conta: null, gravado: 'Vítor Campos', email: 'ana@example.com' }),
    ).toBe('Ana Beatriz Rocha')
    expect(nomeDeExibicao({ conta: 'Nome de Hoje', gravado: 'Nome Antigo' })).toBe('Nome de Hoje')
  })

  it('texto em branco não é nome: passa para a próxima fonte', () => {
    expect(nomeDeExibicao({ ficha: '   ', conta: '\t', email: ' bruna@example.com ' })).toBe(
      'bruna@example.com',
    )
  })

  it('apara os espaços do nome escolhido', () => {
    expect(nomeDeExibicao({ ficha: '  Bruna Costa ' })).toBe('Bruna Costa')
  })

  it('sem nada: a reserva, e não um nome inventado', () => {
    expect(nomeDeExibicao({})).toBe(SEM_NOME)
    expect(nomeDeExibicao({ conta: null }, 'Conta fora da lista do ponto')).toBe('Conta fora da lista do ponto')
  })
})

describe('nomesDasFichas — conta -> nome da ficha ligada', () => {
  it('só a ficha ligada a uma conta dá nome; a sem conta, não', () => {
    const nomes = nomesDasFichas([ficha('ana', 'Ana Beatriz Rocha'), ficha(null, 'Lucas Pires Barreto')])
    expect([...nomes]).toEqual([['ana', 'Ana Beatriz Rocha']])
  })

  it('a ficha de pessoa desligada ou desativada ainda dá o nome — o nome é de quem bateu', () => {
    const nomes = nomesDasFichas([
      ficha('fernanda', 'Fernanda Teles', { ativo: false }),
      ficha('caio', 'Caio Mendes', { desligamento: '2026-09-30' }),
    ])
    expect(nomes.get('fernanda')).toBe('Fernanda Teles')
    expect(nomes.get('caio')).toBe('Caio Mendes')
  })

  it('duas fichas na mesma conta (o banco não deixa, mas): a ativa ganha', () => {
    expect(
      nomesDasFichas([ficha('a', 'Ana Antiga', { ativo: false }), ficha('a', 'Ana Atual')]).get('a'),
    ).toBe('Ana Atual')
    expect(
      nomesDasFichas([ficha('a', 'Ana Atual'), ficha('a', 'Ana Antiga', { ativo: false })]).get('a'),
    ).toBe('Ana Atual')
  })

  it('ficha com nome em branco não dá nome: a regra passa para o nome da conta', () => {
    expect(nomesDasFichas([ficha('a', '  ')]).has('a')).toBe(false)
  })
})

describe('comNomesDasFichas — as contas do painel com o nome da ficha', () => {
  const nomes = nomesDasFichas([
    ficha('ana', 'Ana Beatriz Rocha'),
    ficha('daniela', 'Daniela Freitas'),
  ])

  it('nome da conta errado com ficha certa: o nome e a marca vêm da ficha', () => {
    const [ana] = comNomesDasFichas([conta('ana', 'Vítor Campos', 'ana@example.com')], nomes)
    expect(ana.nome).toBe('Ana Beatriz Rocha')
    expect(ana.temFicha).toBe(true)
    // O resto da conta não muda.
    expect(ana.email).toBe('ana@example.com')
    expect(ana.podeBater).toBe(true)
  })

  it('conta sem nome (o nome que chega é o e-mail) com ficha: a ficha', () => {
    const [daniela] = comNomesDasFichas([conta('daniela', 'daniela@example.com', 'daniela@example.com')], nomes)
    expect(daniela.nome).toBe('Daniela Freitas')
  })

  it('sem ficha: fica o que veio da conta, e a marca diz que não há ficha', () => {
    const [sergio] = comNomesDasFichas([conta('sergio', 'Sérgio Almeida', 'admin2@example.com')], nomes)
    expect(sergio.nome).toBe('Sérgio Almeida')
    expect(sergio.temFicha).toBe(false)
  })

  it('aplicar duas vezes dá o mesmo resultado', () => {
    const uma = comNomesDasFichas([conta('ana', 'Vítor Campos', null)], nomes)
    expect(comNomesDasFichas(uma, nomes)).toEqual(uma)
  })
})

describe('comNomeGravado — o terceiro degrau, onde as batidas estão na mão', () => {
  const gravada = { funcionario_nome: 'Fulana Gravada', funcionario_email: 'f@example.com' }

  it('sem ficha e sem nome guardado na conta: o nome gravado entra no lugar do e-mail', () => {
    const [semNome] = comNomesDasFichas([conta('u1', 'f@example.com', 'f@example.com')], new Map())
    expect(comNomeGravado(semNome, gravada).nome).toBe('Fulana Gravada')
  })

  it('com ficha ou com nome guardado na conta: não muda nada', () => {
    const [comFicha] = comNomesDasFichas([conta('ana', 'ana@example.com', 'ana@example.com')], new Map([['ana', 'Ana Beatriz Rocha']]))
    expect(comNomeGravado(comFicha, gravada).nome).toBe('Ana Beatriz Rocha')
    const comNome = conta('sergio', 'Sérgio Almeida', 'admin2@example.com')
    expect(comNomeGravado(comNome, gravada)).toBe(comNome)
  })

  it('sem nome gravado (ou sem batida): fica o e-mail', () => {
    const semNome = conta('u1', 'f@example.com', 'f@example.com')
    expect(comNomeGravado(semNome, { funcionario_nome: '  ', funcionario_email: null }).nome).toBe('f@example.com')
    expect(comNomeGravado(semNome, null).nome).toBe('f@example.com')
  })

  it('a pessoa fora da lista, que já nasceu com o gravado, sai igual', () => {
    const orfa = pessoaForaDaLista('x', new Map(), gravada)
    expect(comNomeGravado(orfa, gravada)).toEqual(orfa)
  })
})

describe('pessoaForaDaLista — a conta que não existe mais, pela batida, pela ausência ou pela URL', () => {
  const nomes = nomesDasFichas([ficha('daniela', 'Daniela Freitas')])

  it('a batida sem nome congelado: vem a ficha', () => {
    const pessoa = pessoaForaDaLista('daniela', nomes, { funcionario_nome: null, funcionario_email: 'daniela@example.com' })
    expect(pessoa.nome).toBe('Daniela Freitas')
    expect(pessoa.email).toBe('daniela@example.com')
    expect(pessoa.contaApagada).toBe(true)
    expect(pessoa.temFicha).toBe(true)
  })

  it('sem ficha: o nome congelado, depois o e-mail congelado', () => {
    expect(pessoaForaDaLista('x', nomes, { funcionario_nome: 'Zé Desligado', funcionario_email: 'ze@example.com' }).nome).toBe(
      'Zé Desligado',
    )
    expect(pessoaForaDaLista('x', nomes, { funcionario_nome: null, funcionario_email: 'ze@example.com' }).nome).toBe('ze@example.com')
  })

  it('sem nada: a reserva de quem chamou', () => {
    expect(pessoaForaDaLista('x', nomes).nome).toBe(SEM_NOME)
    expect(pessoaForaDaLista('x', nomes, null, 'Conta fora da lista do ponto').nome).toBe('Conta fora da lista do ponto')
  })
})

describe('fotografiaDasBatidas', () => {
  it('pega o primeiro nome e o primeiro e-mail congelados, cada um por si', () => {
    expect(
      fotografiaDasBatidas([
        { funcionario_nome: null, funcionario_email: null },
        { funcionario_nome: null, funcionario_email: 'a@example.com' },
        { funcionario_nome: ' Ana ', funcionario_email: 'b@example.com' },
      ]),
    ).toEqual({ funcionario_nome: 'Ana', funcionario_email: 'a@example.com' })
  })

  it('sem batida: nada', () => {
    expect(fotografiaDasBatidas([])).toEqual({ funcionario_nome: null, funcionario_email: null })
  })
})

describe('nomeDeQuemPediu — a caixa de pendências de atraso', () => {
  const pedido = { usuario_id: 'ana', funcionario_nome: 'Vítor Campos', funcionario_email: 'ana@example.com' }

  it('o nome que o painel resolveu ganha do congelado no pedido', () => {
    expect(nomeDeQuemPediu(pedido, new Map([['ana', 'Ana Beatriz Rocha']]))).toBe('Ana Beatriz Rocha')
  })

  it('fora do painel: o nome congelado, depois o e-mail congelado, depois a reserva', () => {
    expect(nomeDeQuemPediu(pedido)).toBe('Vítor Campos')
    expect(nomeDeQuemPediu({ ...pedido, funcionario_nome: null })).toBe('ana@example.com')
    expect(nomeDeQuemPediu({ ...pedido, funcionario_nome: null, funcionario_email: null })).toBe('Funcionário sem nome')
    expect(nomeDeQuemPediu({ ...pedido, funcionario_nome: null, funcionario_email: null }, new Map(), 'esta pessoa')).toBe(
      'esta pessoa',
    )
  })
})
