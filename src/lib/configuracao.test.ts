import { describe, expect, it } from 'vitest'
import {
  camposFaltandoDaEmpresa,
  cnpjEhValido,
  enderecoEmUmaLinha,
  escreverDuracao,
  FAIXAS,
  formatarCnpj,
  lerDuracao,
  lerInteiro,
  lerNumero,
  segundosDaMensagemDeDuplicidade,
  somenteDigitosDeCnpj,
  validarEmpresa,
  validarJornada,
  validarLocal,
  type DadosDaEmpresa,
} from './configuracao'

/*
 * Os cenários das regras de configuração:
 *   • latitude fora de -90..90 recusada, longitude fora de -180..180 recusada,
 *     raio zero ou negativo recusado;
 *   • carga diária fora de uma faixa razoável recusada, e janela de
 *     duplicidade menor que o mínimo recusada.
 *
 * Mais os defeitos silenciosos que a leitura de texto esconde — a vírgula do
 * teclado brasileiro, e o `parseFloat` que aceita lixo depois do número.
 */

const LOCAL_BOM = {
  nome: 'Empresa Exemplo',
  latitude: '-23,5614',
  longitude: '-46,6559',
  raioMetros: '150',
}

const JORNADA_BOA = {
  cargaDiaria: '08:00',
  toleranciaMinutos: '10',
  janelaDuplicidadeSegundos: '60',
}

const EMPRESA_VAZIA = {
  razaoSocial: '',
  nomeFantasia: '',
  cnpj: '',
  endereco: '',
  cidade: '',
  uf: '',
}

/** As frases de erro juntas, para o teste perguntar "reclamou disso?". */
function reclamacoes(leitura: { ok: boolean; erros?: string[] }): string {
  return (leitura.erros ?? []).join(' | ')
}

describe('lerNumero', () => {
  it('aceita a vírgula do teclado brasileiro', () => {
    // Sem isto, `parseFloat('-23,5614')` devolveria -23 sem erro nenhum — o
    // local 62 km fora do lugar e nada na tela apontando.
    expect(lerNumero('-23,5614')).toBe(-23.5614)
  })

  it('aceita o ponto também', () => {
    expect(lerNumero('-46.6559')).toBe(-46.6559)
  })

  it('recusa texto sobrando depois do número', () => {
    expect(lerNumero('-23.56 graus')).toBeNull()
    expect(lerNumero('abc')).toBeNull()
  })

  it('recusa vazio e só espaço', () => {
    expect(lerNumero('')).toBeNull()
    expect(lerNumero('   ')).toBeNull()
  })

  it('recusa infinito', () => {
    expect(lerNumero('Infinity')).toBeNull()
  })
})

describe('lerInteiro', () => {
  it('lê o inteiro', () => {
    expect(lerInteiro('150')).toBe(150)
    expect(lerInteiro('0')).toBe(0)
    expect(lerInteiro('-3')).toBe(-3)
  })

  it('recusa fracionado — raio e minuto não têm casa decimal', () => {
    expect(lerInteiro('150.5')).toBeNull()
    expect(lerInteiro('10,5')).toBeNull()
  })
})

describe('lerDuracao / escreverDuracao', () => {
  it('lê horas:minutos', () => {
    expect(lerDuracao('08:00')).toBe(480)
    expect(lerDuracao('8:00')).toBe(480)
    expect(lerDuracao('07:30')).toBe(450)
  })

  it('aceita hora cheia sem os minutos', () => {
    expect(lerDuracao('6')).toBe(360)
  })

  it('recusa minuto de um dígito, que é ambíguo', () => {
    // "8:5" é cinco minutos ou cinquenta? Escolher no escuro seria pior.
    expect(lerDuracao('8:5')).toBeNull()
  })

  it('recusa minuto acima de 59 e hora negativa', () => {
    expect(lerDuracao('08:60')).toBeNull()
    expect(lerDuracao('-1:00')).toBeNull()
  })

  it('recusa vazio e formato estranho', () => {
    expect(lerDuracao('')).toBeNull()
    expect(lerDuracao('8:00:00')).toBeNull()
    expect(lerDuracao('oito horas')).toBeNull()
  })

  it('escreve de volta com dois dígitos dos dois lados', () => {
    expect(escreverDuracao(480)).toBe('08:00')
    expect(escreverDuracao(450)).toBe('07:30')
    expect(escreverDuracao(60)).toBe('01:00')
    expect(escreverDuracao(720)).toBe('12:00')
  })

  it('ida e volta não perde nada dentro da faixa aceita', () => {
    for (const minutos of [60, 90, 360, 480, 505, 720]) {
      expect(lerDuracao(escreverDuracao(minutos))).toBe(minutos)
    }
  })
})

describe('validarLocal — a coordenada', () => {
  it('aceita a coordenada boa e devolve números', () => {
    const leitura = validarLocal(LOCAL_BOM)
    expect(leitura.ok).toBe(true)
    if (!leitura.ok) return
    expect(leitura.valor).toEqual({
      nome: 'Empresa Exemplo',
      latitude: -23.5614,
      longitude: -46.6559,
      raioMetros: 150,
    })
  })

  it('recusa latitude fora de -90..90', () => {
    for (const latitude of ['91', '-90.5', '1000']) {
      const leitura = validarLocal({ ...LOCAL_BOM, latitude })
      expect(leitura.ok).toBe(false)
      expect(reclamacoes(leitura)).toMatch(/Latitude precisa estar entre -90 e 90/)
    }
  })

  it('aceita exatamente as bordas da latitude', () => {
    expect(validarLocal({ ...LOCAL_BOM, latitude: '90' }).ok).toBe(true)
    expect(validarLocal({ ...LOCAL_BOM, latitude: '-90' }).ok).toBe(true)
  })

  it('recusa longitude fora de -180..180', () => {
    for (const longitude of ['181', '-180.1']) {
      const leitura = validarLocal({ ...LOCAL_BOM, longitude })
      expect(leitura.ok).toBe(false)
      expect(reclamacoes(leitura)).toMatch(/Longitude precisa estar entre -180 e 180/)
    }
  })

  it('recusa raio zero ou negativo', () => {
    for (const raioMetros of ['0', '-1']) {
      const leitura = validarLocal({ ...LOCAL_BOM, raioMetros })
      expect(leitura.ok).toBe(false)
      expect(reclamacoes(leitura)).toMatch(/pelo menos 1 metro/)
    }
  })

  it('recusa nome em branco — é o que o funcionário lê no comprovante', () => {
    const leitura = validarLocal({ ...LOCAL_BOM, nome: '   ' })
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/precisa de um nome/)
  })

  it('junta TODAS as reclamações, e não só a primeira', () => {
    const leitura = validarLocal({ nome: '', latitude: '91', longitude: '999', raioMetros: '0' })
    expect(leitura.ok).toBe(false)
    if (leitura.ok) return
    expect(leitura.erros).toHaveLength(4)
  })

  it('apara o nome antes de gravar', () => {
    const leitura = validarLocal({ ...LOCAL_BOM, nome: '  Empresa Exemplo  ' })
    expect(leitura.ok && leitura.valor.nome).toBe('Empresa Exemplo')
  })
})

describe('validarJornada — as regras', () => {
  it('aceita a jornada padrão', () => {
    const leitura = validarJornada(JORNADA_BOA)
    expect(leitura.ok).toBe(true)
    if (!leitura.ok) return
    expect(leitura.valor).toEqual({
      cargaDiariaMinutos: 480,
      toleranciaMinutos: 10,
      janelaDuplicidadeSegundos: 60,
    })
  })

  it('recusa carga diária fora da faixa razoável', () => {
    // "8" digitado onde se esperava minutos vira 8 minutos de jornada em quem
    // não converte; aqui `08:00` é a leitura, e a faixa pega o resto.
    for (const cargaDiaria of ['00:30', '13:00', '24:00']) {
      const leitura = validarJornada({ ...JORNADA_BOA, cargaDiaria })
      expect(leitura.ok).toBe(false)
      expect(reclamacoes(leitura)).toMatch(/carga diária precisa ficar entre 01:00 e 12:00/)
    }
  })

  it('aceita as bordas da carga diária', () => {
    expect(validarJornada({ ...JORNADA_BOA, cargaDiaria: '01:00' }).ok).toBe(true)
    expect(validarJornada({ ...JORNADA_BOA, cargaDiaria: '12:00' }).ok).toBe(true)
  })

  it('recusa janela de duplicidade menor que o mínimo — zero inclusive', () => {
    for (const janelaDuplicidadeSegundos of ['0', '1', '9', '-30']) {
      const leitura = validarJornada({ ...JORNADA_BOA, janelaDuplicidadeSegundos })
      expect(leitura.ok).toBe(false)
      expect(reclamacoes(leitura)).toMatch(/não pode ser menor que 10 segundos/)
      expect(reclamacoes(leitura)).toMatch(/não é configuração, é defeito/)
    }
  })

  it('recusa janela grande demais, que passaria a barrar batida legítima', () => {
    const leitura = validarJornada({ ...JORNADA_BOA, janelaDuplicidadeSegundos: '901' })
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/não pode passar de 900 segundos/)
  })

  it('aceita tolerância zero — "nenhuma" é uma escolha legítima', () => {
    expect(validarJornada({ ...JORNADA_BOA, toleranciaMinutos: '0' }).ok).toBe(true)
  })

  it('recusa tolerância acima de uma hora', () => {
    const leitura = validarJornada({ ...JORNADA_BOA, toleranciaMinutos: '61' })
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/entre 0 e 60 minutos/)
  })

  it('as faixas da tela são as mesmas dos CHECK do banco', () => {
    // Se alguém mudar a migration sem mudar aqui (ou o contrário), este teste
    // não pega — mas ele fixa os números num lugar só e faz a divergência
    // aparecer no diff. As mesmas constantes viajam para as frases de erro.
    expect(FAIXAS.cargaDiariaMinutos).toEqual({ min: 60, max: 720 })
    expect(FAIXAS.toleranciaMinutos).toEqual({ min: 0, max: 60 })
    expect(FAIXAS.janelaDuplicidadeSegundos).toEqual({ min: 10, max: 900 })
    expect(FAIXAS.latitude).toEqual({ min: -90, max: 90 })
    expect(FAIXAS.longitude).toEqual({ min: -180, max: 180 })
  })
})

describe('CNPJ', () => {
  it('tira a máscara e mantém os dígitos', () => {
    expect(somenteDigitosDeCnpj('11.222.333/0001-81')).toBe('11222333000181')
    expect(somenteDigitosDeCnpj(' 11222333000181 ')).toBe('11222333000181')
  })

  it('não tira letra — para o número errado ser recusado em vez de encolher', () => {
    expect(somenteDigitosDeCnpj('1122233300018X')).toBe('1122233300018X')
  })

  it('confere os dígitos verificadores', () => {
    expect(cnpjEhValido('11222333000181')).toBe(true)
    expect(cnpjEhValido('11222333000182')).toBe(false)
    expect(cnpjEhValido('11222333000191')).toBe(false)
  })

  it('recusa os catorze dígitos repetidos, que passam na conta do módulo 11', () => {
    expect(cnpjEhValido('11111111111111')).toBe(false)
    expect(cnpjEhValido('00000000000000')).toBe(false)
  })

  it('recusa tamanho errado', () => {
    expect(cnpjEhValido('1122233300018')).toBe(false)
    expect(cnpjEhValido('')).toBe(false)
  })

  it('formata para a tela', () => {
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81')
  })

  it('devolve o que veio quando não dá para formatar', () => {
    expect(formatarCnpj(null)).toBe('')
    expect(formatarCnpj('123')).toBe('123')
  })
})

describe('validarEmpresa', () => {
  it('campo vazio NÃO é erro — a folha imprime o cabeçalho em branco', () => {
    const leitura = validarEmpresa(EMPRESA_VAZIA)
    expect(leitura.ok).toBe(true)
    if (!leitura.ok) return
    expect(leitura.valor).toEqual({
      razaoSocial: null,
      nomeFantasia: null,
      cnpj: null,
      endereco: null,
      cidade: null,
      uf: null,
    })
  })

  it('espaço em branco vira nulo, e não texto vazio', () => {
    // É essa diferença que decide se a tela diz "falta a razão social".
    const leitura = validarEmpresa({ ...EMPRESA_VAZIA, razaoSocial: '   ' })
    expect(leitura.ok && leitura.valor.razaoSocial).toBeNull()
  })

  it('guarda o CNPJ sem máscara', () => {
    const leitura = validarEmpresa({ ...EMPRESA_VAZIA, cnpj: '11.222.333/0001-81' })
    expect(leitura.ok && leitura.valor.cnpj).toBe('11222333000181')
  })

  it('recusa CNPJ que não fecha nos dígitos verificadores', () => {
    const leitura = validarEmpresa({ ...EMPRESA_VAZIA, cnpj: '11.222.333/0001-99' })
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/dígitos verificadores/)
  })

  it('recusa CNPJ com número de dígitos errado', () => {
    const leitura = validarEmpresa({ ...EMPRESA_VAZIA, cnpj: '1122233300018' })
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/14 dígitos/)
  })

  it('sobe a UF para maiúscula, como o gatilho do banco faz', () => {
    const leitura = validarEmpresa({ ...EMPRESA_VAZIA, uf: 'sp' })
    expect(leitura.ok && leitura.valor.uf).toBe('SP')
  })

  it('recusa UF que não é sigla de duas letras', () => {
    const leitura = validarEmpresa({ ...EMPRESA_VAZIA, uf: 'São Paulo' })
    expect(leitura.ok).toBe(false)
    expect(reclamacoes(leitura)).toMatch(/sigla de duas letras/)
  })
})

describe('camposFaltandoDaEmpresa', () => {
  const semente: DadosDaEmpresa = {
    razaoSocial: null,
    nomeFantasia: 'Empresa Exemplo',
    cnpj: null,
    endereco: null,
    cidade: 'Campinas',
    uf: 'SP',
  }

  it('lista o que a empresa ainda deixou em branco', () => {
    expect(camposFaltandoDaEmpresa(semente)).toEqual(['razão social', 'CNPJ', 'endereço'])
  })

  it('lista vazia quando está tudo preenchido', () => {
    expect(
      camposFaltandoDaEmpresa({
        razaoSocial: 'Empresa Exemplo Ltda',
        nomeFantasia: 'Empresa Exemplo',
        cnpj: '11222333000181',
        endereco: 'Rua X, 100 — Centro',
        cidade: 'Campinas',
        uf: 'SP',
      }),
    ).toEqual([])
  })

  it('endereço em uma linha junta só o que existe', () => {
    expect(enderecoEmUmaLinha(semente)).toBe('Campinas/SP')
    expect(
      enderecoEmUmaLinha({ ...semente, endereco: 'Rua X, 100' }),
    ).toBe('Rua X, 100 — Campinas/SP')
    expect(
      enderecoEmUmaLinha({ ...semente, cidade: null, uf: null }),
    ).toBe('')
  })
})

describe('segundosDaMensagemDeDuplicidade', () => {
  it('lê o número que o gatilho do banco escreve na mensagem', () => {
    expect(
      segundosDaMensagemDeDuplicidade(
        'Batida duplicada: ja existe um registro deste funcionario ha menos de 90 segundos',
      ),
    ).toBe(90)
  })

  it('lê também a janela padrão, de 60 segundos', () => {
    expect(
      segundosDaMensagemDeDuplicidade(
        'Batida duplicada: ja existe um registro deste funcionario ha menos de 60 segundos',
      ),
    ).toBe(60)
  })

  it('devolve nulo quando a forma da mensagem mudou — nunca NaN na tela', () => {
    expect(segundosDaMensagemDeDuplicidade('Batida duplicada')).toBeNull()
    expect(segundosDaMensagemDeDuplicidade('outro erro qualquer')).toBeNull()
  })
})
