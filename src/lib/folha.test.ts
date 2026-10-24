import { describe, expect, it } from 'vitest'
import type { Batida, TipoDeBatida } from './formato'
import type { DadosDaEmpresa } from './configuracao'
import { montarEspelho, resumirDias, agruparPorDia } from './horas'
import {
  COLUNAS_MINIMAS_DE_HORARIO,
  colunasDeHorario,
  montarCabecalho,
  montarFolha,
  rotuloDaColunaDeHorario,
} from './folha'

/*
 * A FOLHA É O ÚNICO ENTREGÁVEL DESTE APP QUE VIRA PAPEL ASSINADO.
 *
 * Um defeito aqui não dá erro: ele imprime. Imprime com o total do mês diferente
 * do que o funcionário conferiu no celular, imprime com a quinta batida do dia
 * cortada da tabela, imprime com a palavra "null" no lugar da razão social.
 * Nenhum desses passa por revisão de código e todos aparecem tarde — o primeiro
 * numa audiência trabalhista. Daí a densidade desta suíte.
 *
 * O CENTRO DE TUDO É `o total confere com o do espelho`. Os outros testes
 * descrevem formato; esse descreve a regra dura da folha, e é ele que quebra no
 * dia em que alguém "otimizar" a soma da folha.
 *
 * O QUE NÃO ESTÁ AQUI: a matemática de pareamento e de dia incompleto. Ela é de
 * `horas.ts` e tem suíte própria (`horas.test.ts`). O que se prova abaixo é que
 * a folha USA aquela conta — não que aquela conta esteja certa.
 */

/** Uma batida com o mínimo preenchido, no mesmo molde de `horas.test.ts`. */
function batida(dia: string, hora: string, extras: Partial<Batida> = {}): Batida {
  return {
    id: `${dia}T${hora}`,
    // Offset explícito de Brasília: a batida é carimbada pelo servidor e lida
    // como `dia_civil` em America/Sao_Paulo.
    registrado_em: `${dia}T${hora}:00.000-03:00`,
    dia_civil: dia,
    tipo: 'entrada',
    ordem_no_dia: 1,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    distancia_metros: null,
    no_local: null,
    selfie_path: null,
    ajuste_manual: false,
    ...extras,
  }
}

/** Um dia de trabalho normal: entra, sai para o almoço, volta, sai. 9h. */
function diaDeQuatroBatidas(dia: string, extras: Partial<Batida> = {}): Batida[] {
  const tipos: TipoDeBatida[] = ['entrada', 'saida_almoco', 'volta_almoco', 'saida']
  return ['08:00', '12:00', '13:00', '18:00'].map((hora, i) =>
    batida(dia, hora, { tipo: tipos[i], ordem_no_dia: i + 1, ...extras }),
  )
}

const EMPRESA: DadosDaEmpresa = {
  razaoSocial: 'Empresa Exemplo Ltda',
  nomeFantasia: 'Empresa Exemplo',
  cnpj: '11222333000181',
  endereco: 'Rua das Flores, 100 — Centro',
  cidade: 'Campinas',
  uf: 'SP',
}

/** A configuração de uma instalação em que ninguém preencheu os dados da empresa. */
const EMPRESA_TODA_NULA: DadosDaEmpresa = {
  razaoSocial: null,
  nomeFantasia: null,
  cnpj: null,
  endereco: null,
  cidade: null,
  uf: null,
}

const FUNCIONARIO = { nome: 'Sérgio Almeida', email: 'admin2@example.com' }

function folhaDe(mes: string, batidas: Batida[], empresa: DadosDaEmpresa | null = EMPRESA) {
  return montarFolha({ empresa, funcionario: FUNCIONARIO, mes, batidas })
}

/* ------------------------------------------------------------------ */

describe('o total do mês', () => {
  it('quatro batidas num dia somam DOIS blocos', () => {
    // 08:00→12:00 e 13:00→18:00. Nove horas, e a hora de almoço fora.
    const folha = folhaDe('2026-08', diaDeQuatroBatidas('2026-08-03'))

    expect(folha.linhas).toHaveLength(1)
    expect(folha.linhas[0].horarios).toEqual(['08:00', '12:00', '13:00', '18:00'])
    expect(folha.linhas[0].minutos).toBe(9 * 60)
    expect(folha.linhas[0].total).toBe('9h00')
    expect(folha.total).toBe('9h00')
  })

  it('duas batidas num dia somam UM bloco', () => {
    const folha = folhaDe('2026-08', [
      batida('2026-08-04', '08:00', { tipo: 'entrada', ordem_no_dia: 1 }),
      batida('2026-08-04', '12:30', { tipo: 'saida', ordem_no_dia: 2 }),
    ])

    expect(folha.linhas[0].horarios).toEqual(['08:00', '12:30'])
    expect(folha.linhas[0].minutos).toBe(4 * 60 + 30)
    expect(folha.total).toBe('4h30')
  })

  it('três batidas marcam o dia como incompleto e ele contribui com ZERO', () => {
    /*
     * O caso mais importante do desenho, e o mais fácil de "consertar" errado:
     * com número ímpar de batidas não dá para saber QUAL delas falta, então
     * somar os pares que sobraram seria inventar um horário num papel assinado.
     * O dia entra na folha — some seria pior —, mas entra valendo zero e
     * dizendo por escrito que não entrou no total.
     */
    const folha = folhaDe('2026-08', [
      batida('2026-08-05', '08:00', { ordem_no_dia: 1 }),
      batida('2026-08-05', '12:00', { ordem_no_dia: 2 }),
      batida('2026-08-05', '13:00', { ordem_no_dia: 3 }),
    ])

    expect(folha.linhas[0].incompleto).toBe(true)
    expect(folha.linhas[0].minutos).toBe(0)
    expect(folha.linhas[0].total).toBe('0h00')
    expect(folha.linhas[0].marcas).toContain('Incompleto — fora do total')
    expect(folha.total).toBe('0h00')
    expect(folha.resumo.diasIncompletos).toBe(1)
    // Continua contando como dia COM batida: alguém esteve lá.
    expect(folha.resumo.diasComBatida).toBe(1)
  })

  it('o dia incompleto não derruba o total dos outros dias', () => {
    const folha = folhaDe('2026-08', [
      ...diaDeQuatroBatidas('2026-08-03'),
      ...diaDeQuatroBatidas('2026-08-04'),
      batida('2026-08-05', '08:00'),
    ])

    expect(folha.total).toBe('18h00')
    expect(folha.resumo.diasComBatida).toBe(3)
    expect(folha.resumo.diasIncompletos).toBe(1)
  })

  it('⚠ o total da folha é o MESMO do espelho do funcionário, batida por batida', () => {
    /*
     * A REGRA DURA DA FOLHA, e o único teste desta suíte que descreve uma regra
     * em vez de um formato. O mês abaixo mistura tudo o que existe: dias
     * normais, um dia de seis batidas, um dia ímpar, um dia ajustado pelo admin
     * e um sábado com meio expediente.
     *
     * Se um dia alguém somar a folha por conta própria — por desempenho, por
     * arredondamento, por qualquer motivo —, é aqui que a divergência aparece,
     * e não na mesa do juiz.
     */
    const batidas = [
      ...diaDeQuatroBatidas('2026-08-03'),
      ...diaDeQuatroBatidas('2026-08-04', { ajuste_manual: true }),
      ...diaDeQuatroBatidas('2026-08-05'),
      // Seis batidas: saiu ao banco no meio da tarde e voltou.
      batida('2026-08-06', '08:00'),
      batida('2026-08-06', '12:00'),
      batida('2026-08-06', '13:00'),
      batida('2026-08-06', '15:00'),
      batida('2026-08-06', '15:40'),
      batida('2026-08-06', '18:00'),
      // Dia ímpar: esqueceu a saída.
      batida('2026-08-07', '08:00'),
      // Sábado de meio expediente.
      batida('2026-08-08', '08:00'),
      batida('2026-08-08', '12:00'),
    ]

    const folha = montarFolha({ empresa: EMPRESA, funcionario: FUNCIONARIO, mes: '2026-08', batidas })
    const espelho = montarEspelho('2026-08', batidas)

    expect(folha.resumo.minutos).toBe(espelho.minutos)
    expect(folha.resumo.diasComBatida).toBe(espelho.diasComBatida)
    expect(folha.resumo.diasIncompletos).toBe(espelho.diasIncompletos)
    // E a mesma conta pela outra porta, a que o painel e o CSV usam.
    expect(folha.resumo).toEqual(resumirDias(agruparPorDia(batidas)))
    // Uma linha por dia com batida, na mesma ordem do espelho.
    expect(folha.linhas.map((linha) => linha.dia)).toEqual(espelho.dias.map((dia) => dia.dia))
    expect(folha.linhas.map((linha) => linha.minutos)).toEqual(
      espelho.dias.map((dia) => dia.minutos),
    )
  })
})

/* ------------------------------------------------------------------ */

describe('o cabeçalho da empresa', () => {
  it('escreve os quatro campos quando a configuração está completa', () => {
    const cabecalho = montarCabecalho(EMPRESA)

    expect(cabecalho.razaoSocial).toBe('Empresa Exemplo Ltda')
    expect(cabecalho.nomeFantasia).toBe('Empresa Exemplo')
    // Com máscara: é assim que se confere contra o cartão do CNPJ.
    expect(cabecalho.cnpj).toBe('11.222.333/0001-81')
    expect(cabecalho.endereco).toBe('Rua das Flores, 100 — Centro — Campinas/SP')
    expect(cabecalho.vazio).toBe(false)
  })

  it('configuração TODA NULA produz espaço em branco, e não erro', () => {
    // O caso de borda: uma instalação nova, antes de alguém preencher a empresa.
    const cabecalho = montarCabecalho(EMPRESA_TODA_NULA)

    expect(cabecalho.razaoSocial).toBe('')
    expect(cabecalho.nomeFantasia).toBe('')
    expect(cabecalho.cnpj).toBe('')
    expect(cabecalho.endereco).toBe('')
    expect(cabecalho.vazio).toBe(true)
  })

  it('configuração AUSENTE (nem linha no banco) cai no mesmo cabeçalho em branco', () => {
    expect(montarCabecalho(null)).toEqual(montarCabecalho(EMPRESA_TODA_NULA))
  })

  it('nenhum campo em branco vira texto inventado — nada de "null" nem de "não informado"', () => {
    const cabecalho = montarCabecalho(null)
    const tudo = [cabecalho.razaoSocial, cabecalho.nomeFantasia, cabecalho.cnpj, cabecalho.endereco]

    for (const campo of tudo) {
      expect(campo).toBe('')
      expect(campo).not.toMatch(/null|undefined|informad/i)
    }
  })

  it('preenche o que existe e deixa em branco o que falta, sem vírgula solta', () => {
    // O meio-termo: cidade e UF cadastradas, endereço ainda não.
    const cabecalho = montarCabecalho({
      ...EMPRESA_TODA_NULA,
      nomeFantasia: 'Empresa Exemplo',
      cidade: 'Campinas',
      uf: 'SP',
    })

    expect(cabecalho.nomeFantasia).toBe('Empresa Exemplo')
    expect(cabecalho.razaoSocial).toBe('')
    expect(cabecalho.endereco).toBe('Campinas/SP')
    expect(cabecalho.vazio).toBe(false)
  })

  it('a folha inteira sai com o cabeçalho vazio sem levantar nada', () => {
    const folha = folhaDe('2026-08', diaDeQuatroBatidas('2026-08-03'), null)

    expect(folha.cabecalho.vazio).toBe(true)
    // E o resto do documento continua inteiro — o que falta é só o cabeçalho.
    expect(folha.mesPorExtenso).toBe('Agosto de 2026')
    expect(folha.total).toBe('9h00')
    expect(folha.funcionario.nome).toBe('Sérgio Almeida')
  })
})

/* ------------------------------------------------------------------ */

describe('mês sem batida', () => {
  it('gera folha com cabeçalho e nenhum dia, sem erro', () => {
    // O caso de borda: quem foi admitido em setembro tem todos os meses
    // anteriores assim, e a folha em branco é a prova de que não houve
    // jornada — não um defeito.
    const folha = folhaDe('2026-07', [])

    expect(folha.linhas).toEqual([])
    expect(folha.total).toBe('0h00')
    expect(folha.resumo).toEqual({ minutos: 0, diasComBatida: 0, diasIncompletos: 0 })
    expect(folha.cabecalho.razaoSocial).toBe('Empresa Exemplo Ltda')
    expect(folha.mesPorExtenso).toBe('Julho de 2026')
    // A tabela continua com as quatro colunas: a folha não muda de forma.
    expect(folha.colunasDeHorario).toBe(COLUNAS_MINIMAS_DE_HORARIO)
  })

  it('mês vazio E empresa vazia ainda produzem uma folha, que é o pior caso possível', () => {
    const folha = folhaDe('2026-07', [], null)

    expect(folha.cabecalho.vazio).toBe(true)
    expect(folha.linhas).toEqual([])
    expect(folha.total).toBe('0h00')
  })
})

/* ------------------------------------------------------------------ */

describe('as colunas de horário', () => {
  it('são quatro no mínimo, mesmo num mês de meio expediente', () => {
    const folha = folhaDe('2026-08', [
      batida('2026-08-03', '08:00'),
      batida('2026-08-03', '12:00'),
    ])
    expect(folha.colunasDeHorario).toBe(4)
  })

  it('crescem até o dia mais cheio do mês — a quinta batida não é cortada', () => {
    /*
     * A partir da quinta batida o banco grava `extra` (ver a escada de
     * `formato.ts`). Cortar a quinta e a sexta para caber em quatro colunas
     * seria apagar batida de um documento assinado.
     */
    const folha = folhaDe('2026-08', [
      ...diaDeQuatroBatidas('2026-08-03'),
      batida('2026-08-04', '08:00'),
      batida('2026-08-04', '12:00'),
      batida('2026-08-04', '13:00'),
      batida('2026-08-04', '15:00'),
      batida('2026-08-04', '15:40'),
      batida('2026-08-04', '18:00'),
    ])

    expect(folha.colunasDeHorario).toBe(6)
    expect(folha.linhas[1].horarios).toHaveLength(6)
  })

  it('a função sozinha: lista vazia dá o mínimo, e o maior manda', () => {
    expect(colunasDeHorario([])).toBe(4)
    expect(colunasDeHorario([1, 2, 3])).toBe(4)
    expect(colunasDeHorario([4, 8, 2])).toBe(8)
  })
})

/* ------------------------------------------------------------------ */

describe('as marcas do dia', () => {
  it('dia normal não recebe marca nenhuma', () => {
    const folha = folhaDe('2026-08', diaDeQuatroBatidas('2026-08-03'))
    expect(folha.linhas[0].marcas).toEqual([])
    expect(folha.linhas[0].incompleto).toBe(false)
    expect(folha.linhas[0].ajustado).toBe(false)
  })

  it('dia com batida corrigida pelo admin é marcado como ajustado', () => {
    // O funcionário assina um papel em que os horários que alguém mexeu estão
    // identificados. Sem isso, a correção seria invisível justamente para quem
    // ela mais afeta.
    const folha = folhaDe('2026-08', diaDeQuatroBatidas('2026-08-03', { ajuste_manual: true }))

    expect(folha.linhas[0].ajustado).toBe(true)
    expect(folha.linhas[0].marcas).toEqual(['Ajustado pelo administrador'])
  })

  it('dia incompleto E ajustado carrega as duas marcas', () => {
    const folha = folhaDe('2026-08', [
      batida('2026-08-03', '08:00'),
      batida('2026-08-03', '12:00'),
      batida('2026-08-03', '13:00', { ajuste_manual: true }),
    ])
    expect(folha.linhas[0].marcas).toHaveLength(2)
  })

  it('as marcas são PALAVRA, não cor — a folha é impressa em preto e branco', () => {
    const folha = folhaDe('2026-08', [batida('2026-08-03', '08:00', { ajuste_manual: true })])
    for (const marca of folha.linhas[0].marcas) {
      expect(marca.length).toBeGreaterThan(3)
    }
  })
})

/* ------------------------------------------------------------------ */

describe('o recorte do mês', () => {
  it('descarta batida que não é do mês declarado no cabeçalho', () => {
    /*
     * A tela já pede o mês certo. Este filtro existe porque a folha AFIRMA um
     * mês no topo: listar 1º de setembro debaixo de "Agosto de 2026" num papel
     * assinado seria um erro que ninguém consegue explicar depois.
     */
    const folha = folhaDe('2026-08', [
      ...diaDeQuatroBatidas('2026-08-31'),
      ...diaDeQuatroBatidas('2026-09-01'),
      ...diaDeQuatroBatidas('2026-07-31'),
    ])

    expect(folha.linhas.map((linha) => linha.dia)).toEqual(['2026-08-31'])
    expect(folha.total).toBe('9h00')
  })

  it('não confunde 2026-08 com 2026-08 de outro ano nem com um mês de prefixo parecido', () => {
    // `startsWith('2026-08')` sem o hífen final casaria com nada aqui, mas
    // `startsWith('2026-1')` casaria com outubro, novembro e dezembro. O hífen
    // no filtro é o que fecha isso, e este teste é quem o segura.
    const folha = folhaDe('2026-01', [
      ...diaDeQuatroBatidas('2026-01-05'),
      ...diaDeQuatroBatidas('2026-10-05'),
      ...diaDeQuatroBatidas('2026-11-05'),
      ...diaDeQuatroBatidas('2026-12-05'),
    ])

    expect(folha.linhas.map((linha) => linha.dia)).toEqual(['2026-01-05'])
  })

  it('mês malformado levanta, para a tela conferir ANTES em vez de imprimir lixo', () => {
    expect(() => folhaDe('2026-13', [])).toThrow()
    expect(() => folhaDe('agosto', [])).toThrow()
  })
})

/* ------------------------------------------------------------------ */

describe('o funcionário', () => {
  it('sem e-mail imprime em branco, e não a frase "sem e-mail"', () => {
    const folha = montarFolha({
      empresa: EMPRESA,
      funcionario: { nome: 'Fulano de Tal', email: null },
      mes: '2026-08',
      batidas: [],
    })

    expect(folha.funcionario.email).toBe('')
    expect(folha.funcionario.nome).toBe('Fulano de Tal')
  })

  it('apara os espaços do nome — o cabeçalho do papel não pode nascer torto', () => {
    const folha = montarFolha({
      empresa: EMPRESA,
      funcionario: { nome: '  Fulano  ', email: '  fulano@example.com ' },
      mes: '2026-08',
      batidas: [],
    })

    expect(folha.funcionario.nome).toBe('Fulano')
    expect(folha.funcionario.email).toBe('fulano@example.com')
  })
})

/* ------------------------------------------------------------------ */

describe('a linha do dia', () => {
  it('escreve a data em português e o dia da semana por extenso', () => {
    const folha = folhaDe('2026-08', diaDeQuatroBatidas('2026-08-03'))

    // 3 de agosto de 2026 é uma segunda-feira.
    expect(folha.linhas[0].data).toBe('03/08/2026')
    expect(folha.linhas[0].diaDaSemana).toBe('segunda-feira')
  })

  it('lista os horários na ordem do relógio, mesmo com as batidas embaralhadas', () => {
    // A ordenação é de `agruparPorDia`, pelo carimbo do servidor. A folha só
    // repassa — mas repassar errado imprimiria a saída antes da entrada.
    const folha = folhaDe('2026-08', [
      batida('2026-08-03', '18:00'),
      batida('2026-08-03', '08:00'),
      batida('2026-08-03', '13:00'),
      batida('2026-08-03', '12:00'),
    ])

    expect(folha.linhas[0].horarios).toEqual(['08:00', '12:00', '13:00', '18:00'])
  })

  it('os dias saem em ordem crescente', () => {
    const folha = folhaDe('2026-08', [
      ...diaDeQuatroBatidas('2026-08-20'),
      ...diaDeQuatroBatidas('2026-08-03'),
      ...diaDeQuatroBatidas('2026-08-11'),
    ])

    expect(folha.linhas.map((linha) => linha.dia)).toEqual([
      '2026-08-03',
      '2026-08-11',
      '2026-08-20',
    ])
  })
})

/* ------------------------------------------------------------------ */

describe('os rótulos das colunas', () => {
  it('alternam entrada e saída, aos pares', () => {
    // A ordem é a do pareamento posicional de `horas.ts`: ímpar entra, par sai.
    expect([0, 1, 2, 3, 4, 5].map(rotuloDaColunaDeHorario)).toEqual([
      '1ª entrada',
      '1ª saída',
      '2ª entrada',
      '2ª saída',
      '3ª entrada',
      '3ª saída',
    ])
  })

  it('não fala em almoço — a conta não sabe o que é almoço', () => {
    // Escrever "saída para o almoço" na segunda coluna afirmaria uma coisa que
    // o pareamento não usa, e estaria errado num dia de seis batidas.
    for (let i = 0; i < 8; i++) {
      expect(rotuloDaColunaDeHorario(i)).not.toMatch(/almo/i)
    }
  })
})

/*
 * A BATIDA SEM LOCALIZAÇÃO NA FOLHA: o GPS não respondeu, e ela saiu com a
 * selfie e o PIN. A marca é em palavra e com a hora, como a de atraso — a folha
 * sai em preto e branco. As horas não mudam.
 */
describe('a batida sem localização na folha', () => {
  const SEM_GPS = { origem: 'app', selfie_path: 'u1/2026/10/x.jpg' } as const

  it('marca cada horário que saiu sem localização, e o total do dia é o mesmo', () => {
    const comGps = diaDeQuatroBatidas('2026-10-13', { latitude: -23.550520, longitude: -46.633308, origem: 'app' })
    const semGps = comGps.map((item, indice) => (indice === 0 || indice === 3 ? { ...item, ...SEM_GPS, latitude: null, longitude: null } : item))
    const folha = montarFolha({ empresa: null, funcionario: { nome: 'Fulana', email: null }, mes: '2026-10', batidas: semGps })
    const [linha] = folha.linhas
    expect(linha.semLocalizacao).toBe(true)
    expect(linha.marcas).toEqual([
      'Sem localização (o GPS não respondeu): 08:00',
      'Sem localização (o GPS não respondeu): 18:00',
    ])
    const igual = montarFolha({ empresa: null, funcionario: { nome: 'Fulana', email: null }, mes: '2026-10', batidas: comGps })
    expect(igual.linhas[0].semLocalizacao).toBe(false)
    expect(igual.linhas[0].marcas).toEqual([])
    expect(folha.total).toBe(igual.total)
  })

  it('a inserida pelo admin, sem coordenada, continua só "Ajustado pelo administrador"', () => {
    const dia = diaDeQuatroBatidas('2026-10-13', { latitude: -23.550520, longitude: -46.633308, origem: 'app' })
    dia[3] = { ...dia[3], latitude: null, longitude: null, origem: 'ajuste_admin', ajuste_manual: true }
    const folha = montarFolha({ empresa: null, funcionario: { nome: 'Fulana', email: null }, mes: '2026-10', batidas: dia })
    expect(folha.linhas[0].marcas).toEqual(['Ajustado pelo administrador'])
    expect(folha.linhas[0].semLocalizacao).toBe(false)
  })
})
