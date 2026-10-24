import { describe, expect, it } from 'vitest'
import type { BatidaDoAdmin, TipoDeBatida } from './formato'
import {
  apelidar,
  BOM,
  CABECALHO,
  escaparCampo,
  FIM_DE_LINHA,
  gerarCsvDoPeriodo,
  horasEmDecimal,
  horasParaPlanilha,
  neutralizarFormula,
  nomeDoArquivoCsv,
  SEPARADOR,
} from './csv'

/*
 * A EXPORTAÇÃO É O ENTREGÁVEL QUE NINGUÉM VÊ ANTES DE PRECISAR DELE.
 *
 * Um CSV quebrado não dá erro: ele abre. Abre com tudo numa coluna só, ou com
 * "SaÃ­da" no lugar de "Saída", ou com o total do dia repetido em cada batida
 * inflando a soma do mês por quatro. Todos esses defeitos passam por qualquer
 * revisão de código e só aparecem na mesa da contabilidade. Daí a densidade
 * desta suíte: cada decisão de formato do módulo tem aqui um teste que a
 * executa.
 *
 * O QUE NÃO ESTÁ AQUI: a soma de horas em si. Ela é de `horas.ts` e tem suíte
 * própria (`horas.test.ts`). O que se testa abaixo é que o CSV usa aquela conta
 * e a escreve certo — não que a conta esteja certa.
 */

function batida(
  usuarioId: string,
  dia: string,
  hora: string,
  extras: Partial<BatidaDoAdmin> = {},
): BatidaDoAdmin {
  return {
    id: `${usuarioId}-${dia}T${hora}`,
    usuario_id: usuarioId,
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
    origem: 'app',
    motivo_ajuste: null,
    funcionario_nome: 'Fulano',
    funcionario_email: 'fulano@example.com',
    ...extras,
  }
}

/** Um dia de trabalho normal: entra, sai para o almoço, volta, sai. 9h. */
function diaCompleto(usuarioId: string, dia: string): BatidaDoAdmin[] {
  const tipos: TipoDeBatida[] = ['entrada', 'saida_almoco', 'volta_almoco', 'saida']
  return ['08:00', '12:00', '13:00', '18:00'].map((hora, i) =>
    batida(usuarioId, dia, hora, { tipo: tipos[i], ordem_no_dia: i + 1 }),
  )
}

/** As linhas do arquivo, já sem o BOM e sem a linha vazia final. */
function linhasDe(csv: string): string[] {
  return csv.slice(BOM.length).split(FIM_DE_LINHA).filter(Boolean)
}

/** Os campos de uma linha. Simples de propósito: só serve para linhas sem aspas. */
function camposDe(linha: string): string[] {
  return linha.split(SEPARADOR)
}

const COLUNA = Object.fromEntries(CABECALHO.map((nome, i) => [nome, i])) as Record<
  (typeof CABECALHO)[number],
  number
>

describe('esqueleto do arquivo', () => {
  it('período sem batida nenhuma sai com cabeçalho e mais nada, sem erro', () => {
    // O caso mais fácil de quebrar com um `throw` bem-intencionado.
    const vazio = gerarCsvDoPeriodo([])

    expect(linhasDe(vazio)).toEqual([CABECALHO.join(SEPARADOR)])
    expect(vazio.startsWith(BOM)).toBe(true)
    expect(vazio.endsWith(FIM_DE_LINHA)).toBe(true)
  })

  it('pessoa sem batida no período também não vira linha', () => {
    const csv = gerarCsvDoPeriodo([{ nome: 'Ninguém', email: null, batidas: [] }])
    expect(linhasDe(csv)).toHaveLength(1)
  })

  it('começa com BOM de UTF-8 — é ele que impede "SaÃ­da" no Excel do Windows', () => {
    const csv = gerarCsvDoPeriodo([])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    // E o BOM aparece UMA vez só, na primeira posição.
    expect(csv.slice(1).includes(BOM)).toBe(false)
  })

  it('separa por ponto e vírgula, e não por vírgula', () => {
    // Vírgula abriria tudo numa coluna só no Excel em português — e ainda
    // brigaria com o separador decimal brasileiro.
    expect(SEPARADOR).toBe(';')
    const csv = gerarCsvDoPeriodo([
      { nome: 'Fulano', email: null, batidas: diaCompleto('u1', '2026-08-03') },
    ])
    for (const linha of linhasDe(csv)) {
      expect(camposDe(linha)).toHaveLength(CABECALHO.length)
    }
  })

  it('termina cada linha com CRLF, como manda a RFC 4180', () => {
    const csv = gerarCsvDoPeriodo([
      { nome: 'Fulano', email: null, batidas: diaCompleto('u1', '2026-08-03') },
    ])
    expect(csv.split('\r\n')).toHaveLength(6) // cabeçalho + 4 batidas + fim
    expect(csv.replace(/\r\n/g, '').includes('\n')).toBe(false)
  })

  it('escreve os acentos como acentos, não como entidades nem como "?"', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'João Antônio',
        email: 'joao@example.com',
        batidas: [batida('u1', '2026-08-03', '08:00', { tipo: 'saida_almoco' })],
      },
    ])

    expect(csv).toContain('Funcionário')
    expect(csv).toContain('Distância (m)')
    expect(csv).toContain('João Antônio')
    expect(csv).toContain('Saída para o almoço')
    expect(csv).toContain('NÃO')
  })
})

describe('uma linha por batida, e o total por dia', () => {
  it('quatro batidas viram quatro linhas', () => {
    const csv = gerarCsvDoPeriodo([
      { nome: 'Fulano', email: 'f@example.com', batidas: diaCompleto('u1', '2026-08-03') },
    ])
    expect(linhasDe(csv)).toHaveLength(5) // cabeçalho + 4
  })

  it('o total do dia aparece SÓ na última batida do dia', () => {
    // A decisão que faz "uma linha por batida" conviver com "o total por dia":
    // repetir o total nas quatro linhas quadruplicaria a soma da coluna.
    const csv = gerarCsvDoPeriodo([
      { nome: 'Fulano', email: 'f@example.com', batidas: diaCompleto('u1', '2026-08-03') },
    ])
    const linhas = linhasDe(csv).slice(1).map(camposDe)

    expect(linhas.map((campos) => campos[COLUNA['Horas do dia']])).toEqual(['', '', '', '9:00'])
    expect(linhas.map((campos) => campos[COLUNA['Horas do dia (decimal)']])).toEqual([
      '',
      '',
      '',
      '9,00',
    ])
    expect(linhas.map((campos) => campos[COLUNA['Batidas no dia']])).toEqual(['', '', '', '4'])
    expect(linhas.map((campos) => campos[COLUNA['Dia incompleto']])).toEqual(['', '', '', 'NÃO'])
  })

  it('somar a coluna de horas dá o total do período, sem fórmula nenhuma', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Fulano',
        email: 'f@example.com',
        batidas: [
          ...diaCompleto('u1', '2026-08-03'),
          ...diaCompleto('u1', '2026-08-04'),
          ...diaCompleto('u1', '2026-08-05'),
        ],
      },
    ])

    const decimais = linhasDe(csv)
      .slice(1)
      .map(camposDe)
      .map((campos) => campos[COLUNA['Horas do dia (decimal)']])
      .filter(Boolean)
      .map((texto) => Number(texto.replace(',', '.')))

    expect(decimais).toEqual([9, 9, 9])
    expect(decimais.reduce((a, b) => a + b, 0)).toBe(27)
  })

  it('cada dia fecha uma vez, mesmo com vários dias e várias pessoas', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Ana',
        email: 'ana@example.com',
        batidas: [...diaCompleto('u1', '2026-08-03'), ...diaCompleto('u1', '2026-08-04')],
      },
      { nome: 'Bruno', email: 'bruno@example.com', batidas: diaCompleto('u2', '2026-08-03') },
    ])

    const linhas = linhasDe(csv).slice(1).map(camposDe)
    expect(linhas).toHaveLength(12)

    const fechamentos = linhas.filter((campos) => campos[COLUNA['Horas do dia']] !== '')
    expect(fechamentos).toHaveLength(3)
    expect(fechamentos.map((campos) => campos[COLUNA['Funcionário']])).toEqual([
      'Ana',
      'Ana',
      'Bruno',
    ])
  })

  it('dia incompleto sai marcado e com zero explícito — não em branco', () => {
    // Em branco pareceria "não calculado". A regra é que o dia ímpar CONTA
    // zero, e isso é uma afirmação: o arquivo tem que fazê-la.
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Fulano',
        email: null,
        batidas: [
          batida('u1', '2026-08-05', '08:00'),
          batida('u1', '2026-08-05', '12:00'),
          batida('u1', '2026-08-05', '13:00'),
        ],
      },
    ])

    const ultima = camposDe(linhasDe(csv).at(-1) as string)
    expect(ultima[COLUNA['Dia incompleto']]).toBe('SIM')
    expect(ultima[COLUNA['Horas do dia']]).toBe('0:00')
    expect(ultima[COLUNA['Horas do dia (decimal)']]).toBe('0,00')
  })

  it('ordena por dia e por hora dentro de cada pessoa, venha a lista como vier', () => {
    const embaralhado = [...diaCompleto('u1', '2026-08-04'), ...diaCompleto('u1', '2026-08-03')]
      .slice()
      .reverse()

    const csv = gerarCsvDoPeriodo([{ nome: 'Fulano', email: null, batidas: embaralhado }])
    const linhas = linhasDe(csv).slice(1).map(camposDe)

    expect(linhas.map((campos) => `${campos[COLUNA.Data]} ${campos[COLUNA.Hora]}`)).toEqual([
      '03/08/2026 08:00',
      '03/08/2026 12:00',
      '03/08/2026 13:00',
      '03/08/2026 18:00',
      '04/08/2026 08:00',
      '04/08/2026 12:00',
      '04/08/2026 13:00',
      '04/08/2026 18:00',
    ])
  })
})

describe('o que cada coluna diz', () => {
  it('data em DD/MM/AAAA e hora no fuso de Brasília', () => {
    const csv = gerarCsvDoPeriodo([
      { nome: 'Fulano', email: null, batidas: [batida('u1', '2026-08-31', '21:30')] },
    ])
    const campos = camposDe(linhasDe(csv)[1])

    expect(campos[COLUNA.Data]).toBe('31/08/2026')
    expect(campos[COLUNA['Dia da semana']]).toBe('segunda-feira')
    // 21:30 em Brasília é 00:30 do dia 1º em UTC — e continua sendo 21:30 do
    // dia 31 aqui, porque tanto a hora quanto o dia saem do fuso de Brasília.
    expect(campos[COLUNA.Hora]).toBe('21:30')
  })

  it('marca a batida inserida pelo admin com origem, ajuste e motivo', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Fulano',
        email: null,
        batidas: [
          batida('u1', '2026-08-03', '18:00', {
            origem: 'ajuste_admin',
            ajuste_manual: true,
            motivo_ajuste: 'esqueceu de bater a saída',
            tipo: 'saida',
          }),
        ],
      },
    ])
    const campos = camposDe(linhasDe(csv)[1])

    expect(campos[COLUNA.Origem]).toBe('Ajuste do admin')
    expect(campos[COLUNA['Ajuste manual']]).toBe('SIM')
    expect(campos[COLUNA['Motivo do ajuste']]).toBe('esqueceu de bater a saída')
    expect(campos[COLUNA.Selfie]).toBe('NÃO')
    expect(campos[COLUNA.Local]).toBe('Sem localização')
    expect(campos[COLUNA['Distância (m)']]).toBe('')
  })

  /*
   * A BATIDA SEM LOCALIZAÇÃO: o GPS não respondeu, e ela saiu com a selfie e o
   * PIN. Valor próprio na coluna "Local" — e a do admin, logo acima, continua
   * "Sem localização", como sempre.
   */
  it('a batida do app sem localização tem valor próprio na coluna "Local"; a selfie continua SIM', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Fulano',
        email: null,
        batidas: [
          batida('u1', '2026-08-03', '08:00', {
            origem: 'app',
            selfie_path: 'u1/2026/08/b1.jpg',
            latitude: null,
            longitude: null,
            distancia_metros: null,
            no_local: null,
          }),
        ],
      },
    ])
    const campos = camposDe(linhasDe(csv)[1])
    expect(campos[COLUNA.Local]).toBe('Sem localização (o GPS não respondeu)')
    expect(campos[COLUNA.Origem]).toBe('App')
    expect(campos[COLUNA.Selfie]).toBe('SIM')
    expect(campos[COLUNA['Distância (m)']]).toBe('')
    expect(campos[COLUNA['Precisão (m)']]).toBe('')
    // As 18 colunas do cabeçalho, nenhuma a mais.
    expect(campos).toHaveLength(CABECALHO.length)
  })

  it('a batida de pedido aprovado sem localização também', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Fulano',
        email: null,
        batidas: [
          batida('u1', '2026-08-03', '08:00', {
            origem: 'ajuste_admin',
            ajuste_manual: true,
            motivo_ajuste: 'Batida em atraso aprovada: sem bateria',
            pedido_atraso_id: 'p1',
            latitude: null,
            longitude: null,
            distancia_metros: null,
            no_local: null,
          }),
        ],
      },
    ])
    expect(camposDe(linhasDe(csv)[1])[COLUNA.Local]).toBe('Sem localização (o GPS não respondeu)')
  })

  it('distância e precisão saem com vírgula decimal, do jeito que o Excel pt-BR soma', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Fulano',
        email: null,
        batidas: [
          batida('u1', '2026-08-03', '08:00', {
            latitude: -23.56,
            longitude: -46.6,
            distancia_metros: 1234.5,
            precisao_metros: 12,
            no_local: false,
            selfie_path: 'u1/2026/08/x.jpg',
          }),
        ],
      },
    ])
    const campos = camposDe(linhasDe(csv)[1])

    expect(campos[COLUNA['Distância (m)']]).toBe('1234,50')
    expect(campos[COLUNA['Precisão (m)']]).toBe('12')
    expect(campos[COLUNA.Local]).toBe('Fora do local')
    expect(campos[COLUNA.Selfie]).toBe('SIM')
  })

  it('coordenada com precisão ruim vira "Localização imprecisa", não uma distância afirmada', () => {
    // Caso de borda: com o raio de erro maior que a zona do local, dizer
    // "42 m" seria inventar certeza. O número cru continua na coluna ao lado,
    // ao lado da precisão que o desqualifica.
    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Fulano',
        email: null,
        batidas: [
          batida('u1', '2026-08-03', '08:00', {
            latitude: -23.56,
            longitude: -46.6,
            distancia_metros: 42,
            precisao_metros: 3200,
            no_local: true,
          }),
        ],
      },
    ])
    const campos = camposDe(linhasDe(csv)[1])

    expect(campos[COLUNA.Local]).toBe('Localização imprecisa')
    expect(campos[COLUNA['Distância (m)']]).toBe('42,00')
    expect(campos[COLUNA['Precisão (m)']]).toBe('3200')
  })
})

describe('escapamento — o motivo é texto livre digitado pelo admin', () => {
  it('não mexe no que não precisa', () => {
    expect(escaparCampo('esqueceu a saida')).toBe('esqueceu a saida')
    expect(escaparCampo('')).toBe('')
  })

  it('põe aspas quando o texto tem o separador, e a linha continua inteira', () => {
    expect(escaparCampo('faltou; avisou no grupo')).toBe('"faltou; avisou no grupo"')

    const csv = gerarCsvDoPeriodo([
      {
        nome: 'Fulano',
        email: null,
        batidas: [
          batida('u1', '2026-08-03', '08:00', {
            ajuste_manual: true,
            motivo_ajuste: 'faltou; avisou no grupo',
            origem: 'ajuste_admin',
          }),
        ],
      },
    ])

    // Sem aspas, o ponto e vírgula do motivo criaria uma 19ª coluna.
    expect(linhasDe(csv)[1]).toContain('"faltou; avisou no grupo"')
    expect(linhasDe(csv)[1].split(SEPARADOR)).toHaveLength(CABECALHO.length + 1)
  })

  it('dobra as aspas internas e protege quebra de linha', () => {
    expect(escaparCampo('disse "cheguei às 8"')).toBe('"disse ""cheguei às 8"""')
    expect(escaparCampo('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"')
    expect(escaparCampo(' espaço na ponta ')).toBe('" espaço na ponta "')
  })
})

/*
 * A CÉLULA QUE A PLANILHA LERIA COMO FÓRMULA.
 *
 * Nome, e-mail e motivo são digitados por gente, e o arquivo abre no Excel da
 * contabilidade. Célula de texto que começa com = + - @ (ou tab, ou CR) ganha
 * um apóstrofo na frente, e a planilha a lê como texto. Número e hora do
 * próprio arquivo não mudam: eles precisam continuar somando.
 */
describe('fórmula na planilha — o texto digitado não vira conta nem comando', () => {
  it('cada começo de fórmula ganha o apóstrofo, e o texto continua inteiro', () => {
    expect(neutralizarFormula('=1+1')).toBe("'=1+1")
    expect(neutralizarFormula('+55 11 99999-0000')).toBe("'+55 11 99999-0000")
    expect(neutralizarFormula('-2+3')).toBe("'-2+3")
    expect(neutralizarFormula('@SUM(1+1)')).toBe("'@SUM(1+1)")
    expect(neutralizarFormula('\t=1+1')).toBe("'\t=1+1")
    expect(neutralizarFormula('\r=1+1')).toBe("'\r=1+1")
    // Há planilha que apara o espaço do começo antes de ler.
    expect(neutralizarFormula('  =1+1')).toBe("'  =1+1")
  })

  it('o sinal no meio do texto não é começo de fórmula', () => {
    for (const texto of ['esqueceu a saída', 'a=b', 'ana+teste@example.com', 'Em atraso, aprovada', 'São Paulo - SP']) {
      expect(neutralizarFormula(texto), texto).toBe(texto)
    }
  })

  it('número e duração do arquivo passam direto, até com sinal: continuam somando', () => {
    for (const numero of ['0', '12', '1234,50', '9,00', '9:00', '0:00', '153:00', '-12,50', '-0:30', '31/08/2026', '08:32']) {
      expect(neutralizarFormula(numero), numero).toBe(numero)
      expect(escaparCampo(numero), numero).toBe(numero)
    }
  })

  it('fórmula com aspas e ponto e vírgula: neutralizada e entre aspas, numa coluna só', () => {
    expect(escaparCampo('=HIPERLINK("https://example.com";"clique")')).toBe(
      '"\'=HIPERLINK(""https://example.com"";""clique"")"',
    )
    expect(escaparCampo('\r=1+1')).toBe('"\'\r=1+1"')
  })

  it('no arquivo: o nome "=1+1" e o motivo "@SUM(...)" saem como texto, e as horas do dia continuam número', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: '=1+1',
        email: '-teste@example.com',
        batidas: [
          batida('u1', '2026-08-03', '08:00', { tipo: 'entrada', ordem_no_dia: 1 }),
          batida('u1', '2026-08-03', '17:00', {
            tipo: 'saida',
            ordem_no_dia: 2,
            origem: 'ajuste_admin',
            ajuste_manual: true,
            motivo_ajuste: '@SUM(1+1)*cmd',
          }),
        ],
      },
    ])
    const linhas = linhasDe(csv).slice(1).map(camposDe)

    expect(linhas).toHaveLength(2)
    for (const campos of linhas) {
      expect(campos).toHaveLength(CABECALHO.length)
      expect(campos[COLUNA['Funcionário']]).toBe("'=1+1")
      expect(campos[COLUNA['E-mail']]).toBe("'-teste@example.com")
    }
    expect(linhas[1][COLUNA['Motivo do ajuste']]).toBe("'@SUM(1+1)*cmd")
    // A conta do dia não muda: 9 horas, como número e como hora.
    expect(linhas[1][COLUNA['Horas do dia']]).toBe('9:00')
    expect(linhas[1][COLUNA['Horas do dia (decimal)']]).toBe('9,00')
    expect(linhas[1][COLUNA['Batidas no dia']]).toBe('2')
  })

  it('nenhuma célula do arquivo começa com sinal de fórmula sem o apóstrofo', () => {
    const csv = gerarCsvDoPeriodo([
      {
        nome: '+Fulano',
        email: '=fulano@example.com',
        batidas: [
          batida('u1', '2026-08-03', '08:00', { motivo_ajuste: '-esqueceu', ajuste_manual: true, origem: 'ajuste_admin' }),
          batida('u1', '2026-08-03', '12:00', { tipo: 'saida_almoco', ordem_no_dia: 2, motivo_ajuste: '\t@x' }),
        ],
      },
    ])
    const celulas = linhasDe(csv).slice(1).flatMap((linha) => linha.split(SEPARADOR))
    for (const celula of celulas) {
      expect(celula.replace(/^"/, ''), celula).not.toMatch(/^[=+\-@\t\r]/)
    }
  })
})

describe('duração para planilha', () => {
  it('escreve HH:MM, que o Excel lê como hora e não como texto', () => {
    expect(horasParaPlanilha(0)).toBe('0:00')
    expect(horasParaPlanilha(9)).toBe('0:09')
    expect(horasParaPlanilha(540)).toBe('9:00')
    expect(horasParaPlanilha(492)).toBe('8:12')
  })

  it('e a mesma duração em decimal, que soma sem depender de formato de célula', () => {
    expect(horasEmDecimal(0)).toBe('0,00')
    expect(horasEmDecimal(540)).toBe('9,00')
    expect(horasEmDecimal(492)).toBe('8,20')
    expect(horasEmDecimal(30)).toBe('0,50')
  })
})

describe('nome do arquivo', () => {
  it('tira acento e espaço: o arquivo passa por WhatsApp e pen drive', () => {
    expect(apelidar('Sérgio Assunção de Almeida')).toBe(
      'sergio-assuncao-de-almeida',
    )
    expect(apelidar('  João / Maria  ')).toBe('joao-maria')
  })

  it('mês fechado sai curto; período livre sai com as duas pontas', () => {
    expect(nomeDoArquivoCsv({ inicio: '2026-08-01', fim: '2026-08-31' })).toBe(
      'ponto-2026-08.csv',
    )
    expect(nomeDoArquivoCsv({ inicio: '2026-08-26', fim: '2026-09-25' })).toBe(
      'ponto-2026-08-26-a-2026-09-25.csv',
    )
    expect(nomeDoArquivoCsv({ inicio: '2026-08-01', fim: '2026-08-31' }, 'Ana Paula')).toBe(
      'ponto-ana-paula-2026-08.csv',
    )
  })
})
