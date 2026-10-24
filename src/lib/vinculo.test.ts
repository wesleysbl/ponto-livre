import { describe, expect, it } from 'vitest'
import type { FichaDoFuncionario } from './cadastro'
import {
  compararNomes,
  contasJaLigadas,
  rotuloDaForca,
  sugerirContasParaFicha,
  sugerirFichasParaConta,
  sugerirFichasPeloNome,
  tokensDoNome,
  type ContaParaVinculo,
} from './vinculo'

/*
 * A SUGESTÃO DE VÍNCULO ENTRE FICHA E CONTA.
 *
 * O contrato, por extenso: a sugestão de vínculo acha a conta certa para nomes
 * com e sem acento e com nome do meio, e nunca sugere conta já ligada. E o erro
 * mais caro que ela pode cometer: sugerir a pessoa ERRADA com força alta — por
 * isso há teste de quem NÃO pode ser sugerido (irmãs com o mesmo sobrenome,
 * primeiro nome diferente).
 */

let sequencia = 0
function ficha(nomeCompleto: string, extras: Partial<FichaDoFuncionario> = {}): FichaDoFuncionario {
  sequencia += 1
  return {
    id: `ficha-${sequencia}`,
    usuarioId: null,
    nomeCompleto,
    cpf: null,
    matricula: null,
    cargo: null,
    admissao: null,
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

function conta(usuarioId: string, nome: string, email: string | null = null): ContaParaVinculo {
  return { usuarioId, nome, email }
}

describe('tokensDoNome', () => {
  it('tira acento, caixa, pontuação, conectivos e iniciais soltas', () => {
    expect(tokensDoNome('  José   da SILVA-Ávila  ')).toEqual(['jose', 'silva', 'avila'])
    expect(tokensDoNome('Maria J. dos Santos')).toEqual(['maria', 'santos'])
    expect(tokensDoNome('Conceição')).toEqual(['conceicao'])
  })

  it('e-mail vale pelo que vem antes da arroba, sem números', () => {
    expect(tokensDoNome('daniela.freitas23@example.com')).toEqual(['daniela', 'freitas'])
  })
})

describe('compararNomes', () => {
  it('com e sem acento é o MESMO nome', () => {
    expect(compararNomes('João Antônio Araújo', 'Joao Antonio Araujo')).toBe('exata')
  })

  it('nome do meio omitido, mesmo primeiro e último: forte', () => {
    expect(compararNomes('Maria Aparecida de Souza', 'Maria Souza')).toBe('forte')
    expect(compararNomes('Maria Souza', 'Maria Aparecida de Souza')).toBe('forte')
  })

  it('só o primeiro nome, ou sem o sobrenome: parcial', () => {
    expect(compararNomes('Ana Paula Lima', 'Ana')).toBe('parcial')
    expect(compararNomes('Ana Paula Lima', 'Ana Paula')).toBe('parcial')
  })

  it('primeiro nome diferente nunca é sugestão — mesmo com o sobrenome igual', () => {
    expect(compararNomes('Carla Souza', 'Maria Souza')).toBeNull()
  })

  it('nome do meio que conflita não é sugestão (podem ser irmãs)', () => {
    expect(compararNomes('Maria Clara Souza', 'Maria Luiza Souza')).toBeNull()
  })

  it('nome vazio, ou só conectivo, não casa com nada', () => {
    expect(compararNomes('', 'Ana')).toBeNull()
    expect(compararNomes('de', 'de')).toBeNull()
  })
})

describe('sugerirContasParaFicha — a conta certa para cada ficha sem conta', () => {
  const contas = [
    conta('u-joao', 'Joao Antonio Araujo', 'joao@example.com'),
    conta('u-maria', 'Maria Souza', 'maria@example.com'),
    conta('u-carla', 'Carla Souza', 'carla@example.com'),
    conta('u-dani', 'Dani', 'daniela.freitas@example.com'),
  ]

  it('acha a conta pelo nome com acento na ficha e sem acento na conta', () => {
    const sugestoes = sugerirContasParaFicha(ficha('João Antônio Araújo'), contas, [])
    expect(sugestoes.map((s) => [s.item.usuarioId, s.forca])).toEqual([['u-joao', 'exata']])
  })

  it('acha a conta quando a ficha tem o nome do meio e a conta não', () => {
    const sugestoes = sugerirContasParaFicha(ficha('Maria Aparecida de Souza'), contas, [])
    expect(sugestoes[0].item.usuarioId).toBe('u-maria')
    expect(sugestoes[0].forca).toBe('forte')
    // A irmã com o mesmo sobrenome não aparece.
    expect(sugestoes.map((s) => s.item.usuarioId)).not.toContain('u-carla')
  })

  it('acha pelo e-mail quando o nome da conta é apelido', () => {
    const sugestoes = sugerirContasParaFicha(ficha('Daniela Freitas'), contas, [])
    expect(sugestoes.map((s) => [s.item.usuarioId, s.forca])).toEqual([['u-dani', 'exata']])
  })

  it('NUNCA sugere conta já ligada a outra ficha — nem a uma ficha desativada', () => {
    const fichas = [
      ficha('Maria Souza', { usuarioId: 'u-maria', ativo: false }),
      ficha('João Antônio Araújo', { usuarioId: 'u-joao' }),
    ]
    expect(sugerirContasParaFicha(ficha('Maria Aparecida de Souza'), contas, fichas)).toEqual([])
    expect(sugerirContasParaFicha(ficha('João Antônio Araújo'), contas, fichas)).toEqual([])
  })

  it('ordena da mais forte para a mais fraca', () => {
    const muitas = [conta('u-1', 'Ana'), conta('u-2', 'Ana Paula Lima'), conta('u-3', 'Ana Lima')]
    const sugestoes = sugerirContasParaFicha(ficha('Ana Paula Lima'), muitas, [])
    expect(sugestoes.map((s) => s.forca)).toEqual(['exata', 'forte', 'parcial'])
    expect(sugestoes[0].item.usuarioId).toBe('u-2')
  })

  it('sem nenhum nome parecido, nenhuma sugestão', () => {
    expect(sugerirContasParaFicha(ficha('Zuleica Prado'), contas, [])).toEqual([])
  })
})

describe('sugerirFichasParaConta e sugerirFichasPeloNome — a ficha certa para cada conta', () => {
  it('sugere só fichas SEM conta', () => {
    const fichas = [
      ficha('Maria Aparecida de Souza'),
      ficha('Maria Souza', { usuarioId: 'u-outra' }),
    ]
    const sugestoes = sugerirFichasParaConta(conta('u-maria', 'Maria Souza'), fichas)
    expect(sugestoes.map((s) => s.item.nomeCompleto)).toEqual(['Maria Aparecida de Souza'])
  })

  it('conta que já tem ficha não recebe sugestão nenhuma', () => {
    const fichas = [ficha('Maria Souza', { usuarioId: 'u-maria' }), ficha('Maria Aparecida de Souza')]
    expect(sugerirFichasParaConta(conta('u-maria', 'Maria Souza'), fichas)).toEqual([])
  })

  it('entre sugestões de mesma força, a ficha ativa vem antes da desativada', () => {
    const fichas = [
      ficha('Gustavo Ramos', { ativo: false }),
      ficha('Gustavo Ramos'),
    ]
    const sugestoes = sugerirFichasPeloNome('Gustavo Ramos', null, fichas)
    expect(sugestoes.map((s) => s.item.ativo)).toEqual([true, false])
  })

  it('serve para a conta ainda sendo criada: nome e e-mail digitados', () => {
    const fichas = [ficha('Daniela Freitas da Silva')]
    expect(sugerirFichasPeloNome('Dani', 'daniela.silva@example.com', fichas)[0]?.forca).toBe(
      'forte',
    )
  })
})

describe('contasJaLigadas e rotuloDaForca', () => {
  it('as contas de qualquer ficha, ativa ou não', () => {
    const fichas = [ficha('A', { usuarioId: 'u1' }), ficha('B', { usuarioId: 'u2', ativo: false }), ficha('C')]
    expect([...contasJaLigadas(fichas)].sort()).toEqual(['u1', 'u2'])
  })

  it('os três rótulos são distintos e a parcial manda conferir', () => {
    const rotulos = (['exata', 'forte', 'parcial'] as const).map(rotuloDaForca)
    expect(new Set(rotulos).size).toBe(3)
    expect(rotuloDaForca('parcial')).toContain('confira')
  })
})
