import { describe, expect, it } from 'vitest'
import {
  camposFaltandoDaFicha,
  cpfEhValido,
  descreverVinculo,
  escreverData,
  filtrarFichas,
  formatarCpf,
  lerData,
  ordenarFichas,
  resumirFichas,
  somenteDigitosDeCpf,
  validarFicha,
  type FichaDoFuncionario,
  type RascunhoDaFicha,
} from './cadastro'

/*
 * Os cenários que o cadastro tem de segurar:
 *   • CPF válido passa;
 *   • CPF com dígito verificador errado é recusado com a frase do DOCUMENTO,
 *     não com a frase do banco;
 *   • CPF de onze dígitos repetidos é recusado;
 *   • CPF digitado com máscara é aceito e guardado só com dígitos;
 *   • ficha sem conta de acesso é válida.
 *
 * Mais o desligamento antes da admissão, que faria cada dia do intervalo sair
 * ao mesmo tempo antes de existir e depois do fim; e a ficha sem
 * `batePontoDesde`, que é válida — a data é registro (aparece na lista de
 * pessoas) e não muda a batida nem a folha.
 */

/** Uma ficha em branco, para cada teste mexer só no que lhe interessa. */
const RASCUNHO_VAZIO: RascunhoDaFicha = {
  nomeCompleto: '',
  cpf: '',
  matricula: '',
  cargo: '',
  admissao: '',
  desligamento: '',
  ctps: '',
  ctpsSerie: '',
  centroCusto: '',
  usuarioId: '',
  batePontoDesde: '',
}

function rascunho(mudancas: Partial<RascunhoDaFicha> = {}): RascunhoDaFicha {
  return { ...RASCUNHO_VAZIO, nomeCompleto: 'Bruna Costa', ...mudancas }
}

function ficha(mudancas: Partial<FichaDoFuncionario> = {}): FichaDoFuncionario {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    usuarioId: null,
    nomeCompleto: 'Bruna Costa',
    cpf: '52998224725',
    matricula: null,
    cargo: 'Compras',
    admissao: '2026-03-02',
    desligamento: null,
    ctps: null,
    ctpsSerie: null,
    centroCusto: null,
    ativo: true,
    batePontoDesde: null,
    atualizadoEm: null,
    ...mudancas,
  }
}

/** As frases de erro juntas, para o teste perguntar "reclamou disso?". */
function reclamacoes(leitura: { ok: boolean; erros?: string[] }): string {
  return (leitura.erros ?? []).join(' | ')
}

/* ------------------------------------------------------------------ */

describe('cpfEhValido', () => {
  it('aceita os CPFs válidos de exemplo, inclusive o de dígito verificador zero', () => {
    /*
     * Os CPFs de exemplo conhecidos, que passam na conta do módulo 11. O
     * 123.456.789-09 cai no caso em que o resto da conta dá 10 e o primeiro
     * dígito verificador vira zero. Se um destes falhar, a conta está errada —
     * e o número vai para um papel assinado.
     */
    const deExemplo = [
      '52998224725', // o da Bruna Costa, nos testes abaixo
      '11144477735', // o do Vítor Campos, em `filtrarFichas`
      '12345678909', // o resto 10 que vira dígito zero
    ]
    for (const cpf of deExemplo) {
      expect(cpfEhValido(cpf), `CPF ${cpf} deveria passar`).toBe(true)
    }
  })

  it('recusa o dígito verificador errado', () => {
    // O último dígito do CPF da Bruna trocado de 5 para 6.
    expect(cpfEhValido('52998224726')).toBe(false)
    // E o penúltimo.
    expect(cpfEhValido('52998224715')).toBe(false)
  })

  it('recusa os onze dígitos repetidos — a armadilha do módulo 11', () => {
    // Estes PASSAM na conta e são recusados à parte. `00000000000` é o que um
    // campo preenchido por engano tende a virar.
    for (let digito = 0; digito <= 9; digito++) {
      expect(cpfEhValido(String(digito).repeat(11))).toBe(false)
    }
  })

  it('recusa o que não tem onze dígitos', () => {
    expect(cpfEhValido('5299822472')).toBe(false)
    expect(cpfEhValido('529982247250')).toBe(false)
    expect(cpfEhValido('')).toBe(false)
    // Com máscara é recusado AQUI de propósito: quem tira a máscara é
    // `somenteDigitosDeCpf`, antes. Esta função fala só de dígitos.
    expect(cpfEhValido('529.982.247-25')).toBe(false)
  })
})

describe('somenteDigitosDeCpf / formatarCpf', () => {
  it('tira a máscara e os espaços', () => {
    expect(somenteDigitosDeCpf('529.982.247-25')).toBe('52998224725')
    expect(somenteDigitosDeCpf(' 529 982 247 25 ')).toBe('52998224725')
  })

  it('NÃO tira letra — senão um CPF com lixo viraria um CPF curto calado', () => {
    expect(somenteDigitosDeCpf('529.982.247-2X')).toBe('5299822472X')
    // E o que sobra continua sendo recusado, em vez de virar um CPF de dez.
    expect(cpfEhValido('5299822472X')).toBe(false)
  })

  it('escreve a máscara para impressão', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25')
  })

  it('devolve o que veio quando não dá para formatar', () => {
    expect(formatarCpf(null)).toBe('')
    expect(formatarCpf('123')).toBe('123')
  })
})

describe('lerData / escreverData', () => {
  it('lê a data do campo', () => {
    expect(lerData('2026-03-02')).toBe('2026-03-02')
  })

  it('vazio é NULO, e não erro — ainda não saber a admissão é legítimo', () => {
    expect(lerData('')).toBeNull()
    expect(lerData('   ')).toBeNull()
  })

  it('data que não existe é ERRO, e se distingue do vazio', () => {
    // `undefined` e não `null`: os dois estados levam a telas diferentes.
    expect(lerData('2026-02-31')).toBeUndefined()
    expect(lerData('02/03/2026')).toBeUndefined()
    expect(lerData('amanhã')).toBeUndefined()
  })

  it('escreve no formato brasileiro, e vazio quando não há data', () => {
    expect(escreverData('2026-03-02')).toBe('02/03/2026')
    expect(escreverData(null)).toBe('')
    expect(escreverData('data ruim')).toBe('')
  })
})

describe('validarFicha', () => {
  it('aceita a ficha só com o nome — todo o resto é opcional', () => {
    const leitura = validarFicha(rascunho())
    expect(leitura.ok, reclamacoes(leitura)).toBe(true)
    if (!leitura.ok) return
    expect(leitura.valor.nomeCompleto).toBe('Bruna Costa')
    expect(leitura.valor.cpf).toBeNull()
    expect(leitura.valor.matricula).toBeNull()
    expect(leitura.valor.admissao).toBeNull()
  })

  it('recusa a ficha sem nome', () => {
    const leitura = validarFicha(rascunho({ nomeCompleto: '   ' }))
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/nome completo/i)
  })

  it('a ficha SEM CONTA de acesso é válida — nem toda pessoa da folha usa o app', () => {
    const leitura = validarFicha(rascunho({ usuarioId: '' }))
    expect(leitura.ok, reclamacoes(leitura)).toBe(true)
    if (!leitura.ok) return
    expect(leitura.valor.usuarioId).toBeNull()
  })

  it('guarda o CPF só com dígitos, mesmo digitado com máscara', () => {
    const leitura = validarFicha(rascunho({ cpf: '529.982.247-25' }))
    expect(leitura.ok, reclamacoes(leitura)).toBe(true)
    if (!leitura.ok) return
    expect(leitura.valor.cpf).toBe('52998224725')
  })

  it('recusa o CPF com dígito verificador errado, com a frase do DOCUMENTO', () => {
    const leitura = validarFicha(rascunho({ cpf: '529.982.247-26' }))
    expect(leitura.ok).toBe(false)
    // A frase fala do documento, e não afirma que o banco recusou — porque o
    // banco NÃO recusa: o CHECK dele só exige 11 dígitos.
    expect(reclamacoes(leitura)).toMatch(/dígitos verificadores/i)
    expect(reclamacoes(leitura)).not.toMatch(/o banco recusou/i)
  })

  it('recusa o CPF de onze dígitos repetidos', () => {
    const leitura = validarFicha(rascunho({ cpf: '111.111.111-11' }))
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/dígitos verificadores/i)
  })

  it('recusa o CPF que não tem onze dígitos, com a frase do tamanho', () => {
    const leitura = validarFicha(rascunho({ cpf: '5299822472' }))
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/11 dígitos/)
  })

  it('recusa o desligamento anterior à admissão', () => {
    const leitura = validarFicha(
      rascunho({ admissao: '2026-05-01', desligamento: '2026-03-02' }),
    )
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/anterior à admissão/i)
  })

  it('aceita desligamento no MESMO dia da admissão', () => {
    // Contrato de um dia é raro e é legítimo — o CHECK do banco usa `>=`.
    const leitura = validarFicha(
      rascunho({ admissao: '2026-05-01', desligamento: '2026-05-01' }),
    )
    expect(leitura.ok, reclamacoes(leitura)).toBe(true)
  })

  it('devolve TODAS as frases de uma vez, e não a primeira', () => {
    const leitura = validarFicha(
      rascunho({
        nomeCompleto: '',
        cpf: '111.111.111-11',
        admissao: '2026-02-31',
        usuarioId: 'não é uuid',
      }),
    )
    expect(leitura.ok).toBe(false)
    expect(leitura.ok === false && leitura.erros.length).toBe(4)
  })

  it('apara os espaços e transforma campo vazio em nulo', () => {
    const leitura = validarFicha(
      rascunho({ nomeCompleto: '  Daniela Freitas  ', cargo: '   ', ctps: '' }),
    )
    expect(leitura.ok, reclamacoes(leitura)).toBe(true)
    if (!leitura.ok) return
    expect(leitura.valor.nomeCompleto).toBe('Daniela Freitas')
    expect(leitura.valor.cargo).toBeNull()
    expect(leitura.valor.ctps).toBeNull()
  })

  it('aceita a data em que a pessoa passou a bater ponto aqui, e o vazio dela', () => {
    const semData = validarFicha(rascunho())
    expect(semData.ok && semData.valor.batePontoDesde).toBeNull()

    const comData = validarFicha(rascunho({ batePontoDesde: '2026-09-08' }))
    expect(comData.ok && comData.valor.batePontoDesde).toBe('2026-09-08')
  })
})

describe('camposFaltandoDaFicha', () => {
  it('lista o que falta preencher na ficha', () => {
    expect(camposFaltandoDaFicha(ficha())).toEqual([
      'matrícula',
      'CTPS',
      'série da CTPS',
      'centro de custo',
    ])
  })

  it('a ficha completa não tem pendência', () => {
    const completa = ficha({
      matricula: '42',
      ctps: '1234567',
      ctpsSerie: '001',
      centroCusto: 'Administrativo',
    })
    expect(camposFaltandoDaFicha(completa)).toEqual([])
  })

  it('desligamento vazio NÃO é pendência — é a informação de que a pessoa trabalha aqui', () => {
    expect(camposFaltandoDaFicha(ficha())).not.toContain('desligamento')
  })
})

describe('descreverVinculo', () => {
  it('a ficha sem conta aparece marcada como "sem conta para bater ponto"', () => {
    // A frase exata: é a etiqueta que a lista de pessoas mostra na ficha.
    expect(descreverVinculo(ficha({ usuarioId: null }))).toEqual({
      estado: 'sem-conta',
      texto: 'sem conta para bater ponto',
    })
  })

  it('com conta e sem data: falta o registro da data — e a frase não diz que ela não bate', () => {
    const vinculo = descreverVinculo(
      ficha({ usuarioId: '00000000-0000-4000-8000-000000000002', batePontoDesde: null }),
    )
    expect(vinculo.estado).toBe('nao-bate')
    // A ficha ativa ligada libera o ponto, com ou sem a data. "Ainda não bate
    // ponto aqui" seria falso ao lado de "bate ponto pela ficha", na mesma
    // linha da lista de pessoas.
    expect(vinculo.texto).toContain('falta a data')
    expect(vinculo.texto).not.toMatch(/não bate/)
  })

  it('com conta e com data, diz desde quando', () => {
    const vinculo = descreverVinculo(
      ficha({
        usuarioId: '00000000-0000-4000-8000-000000000002',
        batePontoDesde: '2026-09-08',
      }),
    )
    expect(vinculo).toEqual({ estado: 'bate', texto: 'bate ponto aqui desde 08/09/2026' })
  })
})

describe('ordenarFichas', () => {
  it('ativas primeiro, e dentro do grupo, alfabético sem tropeçar no acento', () => {
    const fichas = [
      ficha({ id: '1', nomeCompleto: 'Daniela Freitas' }),
      ficha({ id: '2', nomeCompleto: 'Álvaro Desativado', ativo: false }),
      ficha({ id: '3', nomeCompleto: 'Lucas Pires Barreto' }),
      ficha({ id: '4', nomeCompleto: 'Bruna Costa' }),
    ]
    expect(ordenarFichas(fichas).map((f) => f.nomeCompleto)).toEqual([
      'Bruna Costa',
      'Daniela Freitas',
      'Lucas Pires Barreto',
      'Álvaro Desativado',
    ])
  })

  it('não mexe no arranjo recebido', () => {
    const fichas = [ficha({ id: '1', nomeCompleto: 'Zulmira' }), ficha({ id: '2', nomeCompleto: 'Ana' })]
    ordenarFichas(fichas)
    expect(fichas[0].nomeCompleto).toBe('Zulmira')
  })
})

describe('filtrarFichas', () => {
  const fichas = [
    ficha({ id: '1', nomeCompleto: 'Vítor Campos', cpf: '11144477735', cargo: 'Analista' }),
    ficha({ id: '2', nomeCompleto: 'Bruna Costa', cpf: '52998224725', matricula: '42' }),
  ]

  it('acha sem acento e sem caixa', () => {
    expect(filtrarFichas(fichas, 'vitor').map((f) => f.id)).toEqual(['1'])
  })

  it('acha pelo CPF digitado com máscara, contra o CPF guardado só com dígitos', () => {
    expect(filtrarFichas(fichas, '529.982').map((f) => f.id)).toEqual(['2'])
  })

  it('acha pelo cargo', () => {
    expect(filtrarFichas(fichas, 'analista').map((f) => f.id)).toEqual(['1'])
  })

  it('busca vazia devolve tudo', () => {
    expect(filtrarFichas(fichas, '   ')).toHaveLength(2)
  })
})

describe('resumirFichas', () => {
  it('conta as pendências só entre as fichas ativas', () => {
    const fichas = [
      ficha({ id: '1', usuarioId: null, cpf: '52998224725' }),
      ficha({ id: '2', usuarioId: '00000000-0000-4000-8000-000000000002', batePontoDesde: '2026-09-08' }),
      // Desativada e sem CPF: é história, não tarefa. Não conta como pendência.
      ficha({ id: '3', ativo: false, cpf: null, usuarioId: null }),
    ]
    expect(resumirFichas(fichas)).toEqual({
      total: 3,
      ativas: 2,
      semConta: 1,
      semCpf: 0,
      naoBatemAqui: 1,
    })
  })

  it('lista vazia não quebra', () => {
    expect(resumirFichas([])).toEqual({
      total: 0,
      ativas: 0,
      semConta: 0,
      semCpf: 0,
      naoBatemAqui: 0,
    })
  })
})
