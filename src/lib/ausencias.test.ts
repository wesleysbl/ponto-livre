import { describe, expect, it } from 'vitest'
import {
  atestadoAbreComoLink,
  atestadoEhPdf,
  ausenciasPorDia,
  ausenciasPorPessoa,
  caminhoDoAtestado,
  descreverPeriodo,
  diasDoPeriodo,
  diferencaEmDias,
  dimensoesReduzidas,
  extensaoDoArquivo,
  formatarTamanho,
  juntarDiasEAusencias,
  marcaDaAusencia,
  marcaDaAusenciaPorExtenso,
  marcaNoDia,
  planoDoAtestado,
  previaDoHorario,
  previaDosDias,
  somarDias,
  TAMANHO_MAXIMO_DO_ATESTADO,
  validarLancamento,
  validarMotivoDoCancelamento,
  validarRascunhoDoLancamento,
  type Ausencia,
  type RascunhoDoLancamento,
} from './ausencias'

/*
 * AS REGRAS PURAS DAS AUSÊNCIAS.
 *
 *  • A expansão do período em dias (um atestado de 3 dias é UMA ausência e
 *    TRÊS dias marcados), com troca de mês, ano bissexto e recorte.
 *  • A cancelada não marca dia nenhum.
 *  • As regras do lançamento, as MESMAS do gatilho `ponto_ausencias_guardar`
 *    (na migration da estrutura e na da ausência por horário): ordem, 120
 *    dias, janela de um ano, "outro" com observação, um dia só e o fim depois
 *    do início no horário.
 *  • O rascunho da tela: por dias, a data final sai da quantidade (dias
 *    corridos); por horário, a duração sai dos dois horários.
 *  • A marca e o período nas telas, com o intervalo da ausência por horário.
 *  • O arquivo: o tipo que o bucket aceita, a extensão que bate com ele, o
 *    caminho combinado, e a compressão que nunca aumenta a foto.
 */

function ausencia(extras: Partial<Ausencia> = {}): Ausencia {
  return {
    id: 'a1',
    usuario_id: 'u1',
    dia_inicio: '2026-10-14',
    dia_fim: '2026-10-16',
    tipo: 'atestado_medico',
    modalidade: 'dias',
    hora_inicio: null,
    hora_fim: null,
    observacao: null,
    atestado_path: null,
    lancado_por: 'admin-1',
    lancado_em: '2026-10-17T12:00:00.000Z',
    cancelada_em: null,
    cancelada_por: null,
    motivo_cancelamento: null,
    ...extras,
  }
}

describe('os dias do período', () => {
  it('uma ausência de 3 dias gera os 3 dias, das duas pontas inclusive', () => {
    expect(diasDoPeriodo('2026-10-14', '2026-10-16')).toEqual(['2026-10-14', '2026-10-15', '2026-10-16'])
  })

  it('um dia só é um dia', () => {
    expect(diasDoPeriodo('2026-10-14', '2026-10-14')).toEqual(['2026-10-14'])
  })

  it('atravessa a troca de mês e de ano', () => {
    expect(diasDoPeriodo('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
    expect(diasDoPeriodo('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01'])
  })

  it('conhece o 29 de fevereiro do ano bissexto, e só dele', () => {
    expect(diasDoPeriodo('2028-02-28', '2028-03-01')).toHaveLength(3)
    expect(diasDoPeriodo('2027-02-28', '2027-03-01')).toHaveLength(2)
  })

  it('período invertido ou dia inválido não gera dia nenhum', () => {
    expect(diasDoPeriodo('2026-10-16', '2026-10-14')).toEqual([])
    expect(diasDoPeriodo('2026-02-30', '2026-03-01')).toEqual([])
    expect(diasDoPeriodo('16/10/2026', '2026-10-17')).toEqual([])
  })

  it('a conta é de calendário, igual em qualquer fuso do aparelho', () => {
    // O horário de verão de outros fusos não pode comer nem repetir um dia.
    expect(somarDias('2026-03-08', 1)).toBe('2026-03-09')
    expect(somarDias('2026-11-01', -1)).toBe('2026-10-31')
    expect(diferencaEmDias('2026-01-01', '2026-12-31')).toBe(364)
    expect(() => somarDias('ontem', 1)).toThrow()
  })
})

describe('a ausência no mês', () => {
  it('marca cada dia do período, uma vez', () => {
    const porDia = ausenciasPorDia([ausencia()])
    expect([...porDia.keys()]).toEqual(['2026-10-14', '2026-10-15', '2026-10-16'])
    expect(porDia.get('2026-10-15')?.map((a) => a.id)).toEqual(['a1'])
  })

  it('ausência cancelada não marca dia nenhum', () => {
    const cancelada = ausencia({
      cancelada_em: '2026-10-17T13:00:00.000Z',
      cancelada_por: 'admin-1',
      motivo_cancelamento: 'lançada no dia errado',
    })
    expect(ausenciasPorDia([cancelada]).size).toBe(0)
  })

  it('o recorte deixa fora os dias de outro mês — a folha de outubro não lista novembro', () => {
    const entreMeses = ausencia({ dia_inicio: '2026-10-30', dia_fim: '2026-11-02' })
    const outubro = ausenciasPorDia([entreMeses], { inicio: '2026-10-01', fim: '2026-10-31' })
    expect([...outubro.keys()]).toEqual(['2026-10-30', '2026-10-31'])
    const novembro = ausenciasPorDia([entreMeses], { inicio: '2026-11-01', fim: '2026-11-30' })
    expect([...novembro.keys()]).toEqual(['2026-11-01', '2026-11-02'])
  })

  it('separa por pessoa, e quem só tem cancelada não aparece', () => {
    const porPessoa = ausenciasPorPessoa([
      ausencia(),
      ausencia({ id: 'a2', usuario_id: 'u2', dia_inicio: '2026-10-20', dia_fim: '2026-10-20' }),
      ausencia({
        id: 'a3',
        usuario_id: 'u3',
        cancelada_em: '2026-10-17T13:00:00.000Z',
        cancelada_por: 'admin-1',
        motivo_cancelamento: 'errado',
      }),
    ])
    expect([...porPessoa.keys()].sort()).toEqual(['u1', 'u2'])
    expect(porPessoa.get('u1')?.size).toBe(3)
    expect(porPessoa.get('u2')?.size).toBe(1)
  })

  it('um dia com ausência e batida mostra os dois — e o dia das batidas vem intacto', () => {
    const diaComBatida = { dia: '2026-10-15', minutos: 240 }
    const outroDia = { dia: '2026-10-20', minutos: 480 }
    const juntos = juntarDiasEAusencias([outroDia, diaComBatida], ausenciasPorDia([ausencia()]))

    expect(juntos.map((dia) => dia.dia)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-20'])
    expect(juntos[0]).toMatchObject({ batidas: null, ausencias: [{ id: 'a1' }] })
    // O MESMO objeto: quem soma continua sendo horas.ts.
    expect(juntos[1].batidas).toBe(diaComBatida)
    expect(juntos[1].ausencias.map((a) => a.id)).toEqual(['a1'])
    expect(juntos[3]).toMatchObject({ batidas: outroDia, ausencias: [] })
  })
})

describe('os rótulos', () => {
  it('a marca diz "Falta justificada" e o tipo, sem repetir palavra', () => {
    expect(marcaDaAusencia(ausencia())).toBe('Falta justificada — atestado médico')
    expect(marcaDaAusencia(ausencia({ tipo: 'falta_justificada' }))).toBe('Falta justificada')
    expect(marcaDaAusencia(ausencia({ tipo: 'outro', observacao: ' doação de sangue ' }))).toBe(
      'Falta justificada — doação de sangue',
    )
  })

  it('no papel e na planilha, diz por escrito se o atestado está guardado', () => {
    expect(marcaDaAusenciaPorExtenso(ausencia({ atestado_path: 'u1/a1.jpg' }))).toBe(
      'Falta justificada — atestado médico (atestado anexado)',
    )
    expect(marcaDaAusenciaPorExtenso(ausencia())).toBe('Falta justificada — atestado médico')
  })

  it('a marca das telas diz o tipo e o período, com hífen no intervalo e sem travessão', () => {
    expect(marcaNoDia(ausencia())).toBe('Atestado, dia inteiro')
    expect(marcaNoDia(ausencia({ modalidade: 'horario', hora_inicio: '14:00:00', hora_fim: '16:00:00' }))).toBe(
      'Atestado 14:00-16:00',
    )
    expect(marcaNoDia(ausencia({ tipo: 'falta_justificada' }))).toBe('Falta justificada, dia inteiro')
    expect(
      marcaNoDia(
        ausencia({
          tipo: 'outro',
          observacao: ' doação de sangue ',
          modalidade: 'horario',
          hora_inicio: '08:00',
          hora_fim: '09:30',
        }),
      ),
    ).toBe('Outro motivo 08:00-09:30: doação de sangue')
    expect(marcaNoDia(ausencia({ tipo: 'outro', observacao: 'júri popular' }))).toBe('Outro motivo, dia inteiro: júri popular')
    // A observação só entra no "outro motivo", que é o tipo que a exige.
    expect(marcaNoDia(ausencia({ observacao: 'consulta' }))).toBe('Atestado, dia inteiro')
    // Por horário sem as horas (o banco não deixa existir) não inventa intervalo.
    expect(marcaNoDia(ausencia({ modalidade: 'horario' }))).toBe('Atestado, dia inteiro')
    // Por dias, horas que viessem (o banco não deixa) não aparecem.
    expect(marcaNoDia(ausencia({ hora_inicio: '14:00:00', hora_fim: '16:00:00' }))).toBe('Atestado, dia inteiro')
    for (const tipo of ['atestado_medico', 'falta_justificada', 'outro'] as const) {
      expect(marcaNoDia(ausencia({ tipo, observacao: 'x' }))).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('o PDF é reconhecido pela extensão do caminho — é ela que decide link ou miniatura', () => {
    expect(atestadoEhPdf('u1/a1.pdf')).toBe(true)
    expect(atestadoEhPdf('u1/a1.jpg')).toBe(false)
    expect(atestadoEhPdf(null)).toBe(false)
  })

  // O HEIC sobe como veio justamente quando o navegador não o abre: num <img>
  // ele quebraria, e a tela diria "o link expirou", em laço.
  it('PDF e HEIC abrem como link; JPEG, PNG e WebP, como miniatura', () => {
    expect(atestadoAbreComoLink('u1/a1.pdf')).toBe(true)
    expect(atestadoAbreComoLink('u1/a1.heic')).toBe(true)
    expect(atestadoAbreComoLink('u1/a1.jpg')).toBe(false)
    expect(atestadoAbreComoLink('u1/a1.png')).toBe(false)
    expect(atestadoAbreComoLink('u1/a1.webp')).toBe(false)
    expect(atestadoAbreComoLink(null)).toBe(false)
  })

  it('o período por extenso', () => {
    expect(descreverPeriodo(ausencia())).toBe('14/10/2026 a 16/10/2026 (3 dias)')
    expect(descreverPeriodo(ausencia({ dia_fim: '2026-10-14' }))).toBe('14/10/2026')
  })

  it('a ausência por horário diz o dia e o intervalo, sem os segundos do banco', () => {
    const porHorario = ausencia({
      dia_inicio: '2026-10-21',
      dia_fim: '2026-10-21',
      modalidade: 'horario',
      hora_inicio: '14:00:00',
      hora_fim: '16:00:00',
    })
    expect(descreverPeriodo(porHorario)).toBe('21/10/2026, das 14:00 às 16:00')
    // Por dias, as horas (que o banco não deixa existir) não aparecem.
    expect(descreverPeriodo(ausencia({ dia_fim: '2026-10-14', hora_inicio: '14:00:00', hora_fim: '16:00:00' }))).toBe(
      '14/10/2026',
    )
    // Quem só tem o período continua podendo pedir a descrição.
    expect(descreverPeriodo({ dia_inicio: '2026-10-20', dia_fim: '2026-10-22' })).toBe('20/10/2026 a 22/10/2026 (3 dias)')
  })
})

describe('as regras do lançamento — as do gatilho', () => {
  const HOJE = '2026-10-17'
  const base = { diaInicio: '2026-10-14', diaFim: '2026-10-16', tipo: 'atestado_medico', observacao: '' }

  it('aceita o período normal, e manda a observação em branco como nula', () => {
    expect(validarLancamento(base, HOJE)).toEqual({
      ok: true,
      valores: { dia_inicio: '2026-10-14', dia_fim: '2026-10-16', tipo: 'atestado_medico', observacao: null },
    })
  })

  it('recusa o dia final antes do inicial', () => {
    expect(validarLancamento({ ...base, diaFim: '2026-10-13' }, HOJE)).toMatchObject({ ok: false })
  })

  it('120 dias passa; 121 não', () => {
    expect(validarLancamento({ ...base, diaInicio: '2026-07-01', diaFim: somarDias('2026-07-01', 119) }, HOJE).ok).toBe(true)
    const longo = validarLancamento({ ...base, diaInicio: '2026-07-01', diaFim: somarDias('2026-07-01', 120) }, HOJE)
    expect(longo).toMatchObject({ ok: false })
    if (!longo.ok) expect(longo.erro).toContain('120 dias')
  })

  it('a janela é de um ano para cada lado — o "2062" da digitação é recusado', () => {
    expect(validarLancamento({ ...base, diaInicio: somarDias(HOJE, -366), diaFim: somarDias(HOJE, -366) }, HOJE).ok).toBe(true)
    expect(validarLancamento({ ...base, diaInicio: somarDias(HOJE, -367), diaFim: somarDias(HOJE, -367) }, HOJE).ok).toBe(false)
    expect(validarLancamento({ ...base, diaInicio: '2062-10-14', diaFim: '2062-10-14' }, HOJE).ok).toBe(false)
  })

  it('"outro" exige observação; os outros tipos, não', () => {
    expect(validarLancamento({ ...base, tipo: 'outro', observacao: '   ' }, HOJE).ok).toBe(false)
    expect(validarLancamento({ ...base, tipo: 'outro', observacao: 'júri popular' }, HOJE)).toMatchObject({
      ok: true,
      valores: { observacao: 'júri popular' },
    })
    expect(validarLancamento({ ...base, tipo: 'falta_justificada' }, HOJE).ok).toBe(true)
  })

  it('recusa tipo desconhecido, dia vazio e observação longa demais', () => {
    expect(validarLancamento({ ...base, tipo: 'ferias' }, HOJE).ok).toBe(false)
    expect(validarLancamento({ ...base, diaInicio: '' }, HOJE).ok).toBe(false)
    expect(validarLancamento({ ...base, observacao: 'x'.repeat(1001) }, HOJE).ok).toBe(false)
    expect(validarLancamento({ ...base, observacao: 'x'.repeat(1000) }, HOJE).ok).toBe(true)
  })

  it('o motivo do cancelamento é obrigatório e tem até 500 caracteres', () => {
    expect(validarMotivoDoCancelamento('  ').ok).toBe(false)
    expect(validarMotivoDoCancelamento('x'.repeat(501)).ok).toBe(false)
    expect(validarMotivoDoCancelamento('  período errado  ')).toEqual({ ok: true, motivo: 'período errado' })
  })
})

describe('o lançamento por dias: a data final sai da quantidade', () => {
  it('1 dia: a data final é a própria data de início', () => {
    expect(previaDosDias('2026-10-20', '1')).toEqual({ ok: true, diaFim: '2026-10-20', dias: 1 })
  })

  it('3 dias: a data de início e as duas seguintes (dias corridos)', () => {
    expect(previaDosDias('2026-10-20', '3')).toEqual({ ok: true, diaFim: '2026-10-22', dias: 3 })
    // Sexta mais 3 dias corridos: sábado e domingo contam.
    expect(previaDosDias('2026-10-23', '3')).toMatchObject({ ok: true, diaFim: '2026-10-25' })
  })

  it('atravessa o mês e o ano, e aceita espaço em volta e zero à esquerda', () => {
    expect(previaDosDias('2026-10-30', '3')).toMatchObject({ ok: true, diaFim: '2026-11-01' })
    expect(previaDosDias('2026-12-31', ' 02 ')).toMatchObject({ ok: true, diaFim: '2027-01-01', dias: 2 })
    expect(previaDosDias('2028-02-28', '2')).toMatchObject({ ok: true, diaFim: '2028-02-29' })
  })

  it.each(['0', '-1', '1,5', '1.5', '2 dias', 'três', '+1', '00'])('"%s" é recusado: inteiro maior que zero', (quantidade) => {
    expect(previaDosDias('2026-10-20', quantidade)).toEqual({
      ok: false,
      erro: 'A quantidade de dias tem de ser um número inteiro maior que zero, como 1 ou 3.',
      falta: false,
    })
  })

  it('vazio é recusado, como campo que falta', () => {
    expect(previaDosDias('2026-10-20', '')).toEqual({ ok: false, erro: 'Informe a quantidade de dias.', falta: true })
    expect(previaDosDias('2026-10-20', '   ')).toMatchObject({ ok: false, falta: true })
  })

  it('sem data de início, não há conta', () => {
    expect(previaDosDias('', '3')).toEqual({ ok: false, erro: 'Informe a data de início.', falta: true })
    expect(previaDosDias('2026-02-30', '3')).toMatchObject({ ok: false, falta: true })
  })

  it('120 dias passa (o limite do banco, contando o primeiro e o último); 121 não, com frase própria', () => {
    expect(previaDosDias('2026-07-01', '120')).toEqual({ ok: true, diaFim: somarDias('2026-07-01', 119), dias: 120 })
    const longo = previaDosDias('2026-07-01', '121')
    expect(longo).toMatchObject({ ok: false, falta: false })
    if (!longo.ok) {
      expect(longo.erro).toBe(
        'Por dias, o lançamento vai até 120 dias, contando a data de início. Para um período maior, lance em partes.',
      )
    }
    expect(previaDosDias('2026-07-01', '99999999999999999999')).toMatchObject({ ok: false })
  })
})

describe('o lançamento por horário: a duração sai dos dois horários', () => {
  it('16:00 às 16:30: 30 minutos', () => {
    expect(previaDoHorario('16:00', '16:30')).toEqual({ ok: true, inicio: '16:00', fim: '16:30', minutos: 30 })
  })

  it('14:00 às 16:00: 120 minutos; os segundos em zero do campo saem', () => {
    expect(previaDoHorario('14:00', '16:00')).toMatchObject({ ok: true, minutos: 120 })
    expect(previaDoHorario('14:00:00', '16:00:00')).toEqual({ ok: true, inicio: '14:00', fim: '16:00', minutos: 120 })
  })

  it('o dia inteiro do relógio cabe: das 00:00 às 23:59', () => {
    expect(previaDoHorario('00:00', '23:59')).toMatchObject({ ok: true, minutos: 1439 })
  })

  it('fim antes do início é recusado (a ausência por horário não passa da meia-noite)', () => {
    expect(previaDoHorario('16:00', '14:00')).toEqual({
      ok: false,
      erro: 'O horário final tem de ser depois do inicial.',
      falta: false,
    })
    expect(previaDoHorario('22:00', '02:00')).toMatchObject({ ok: false, falta: false })
  })

  it('fim igual ao início também é recusado: não é intervalo', () => {
    expect(previaDoHorario('14:00', '14:00')).toEqual({
      ok: false,
      erro: 'O horário final é igual ao inicial. Informe um intervalo, como das 14:00 às 16:00.',
      falta: false,
    })
  })

  it('os dois horários são obrigatórios', () => {
    expect(previaDoHorario('', '')).toEqual({ ok: false, erro: 'Informe o horário inicial e o final.', falta: true })
    expect(previaDoHorario('', '16:00')).toEqual({ ok: false, erro: 'Informe o horário inicial.', falta: true })
    expect(previaDoHorario('14:00', ' ')).toEqual({ ok: false, erro: 'Informe o horário final.', falta: true })
  })

  it('hora que não é hora, ou com segundos, é recusada (o banco guarda minuto exato)', () => {
    for (const [inicio, fim] of [
      ['25:00', '26:00'],
      ['14h', '16h'],
      ['14:00:30', '16:00'],
    ]) {
      expect(previaDoHorario(inicio, fim)).toEqual({
        ok: false,
        erro: 'Use horas e minutos exatos, de 00:00 a 23:59.',
        falta: false,
      })
    }
  })
})

describe('o rascunho da tela, conferido antes de subir o atestado', () => {
  const HOJE = '2026-10-21'
  const POR_DIAS: RascunhoDoLancamento = {
    modalidade: 'dias',
    dia: '2026-10-20',
    quantidadeDeDias: '3',
    horaInicio: '',
    horaFim: '',
    tipo: 'atestado_medico',
    observacao: '',
  }
  const POR_HORARIO: RascunhoDoLancamento = {
    ...POR_DIAS,
    modalidade: 'horario',
    dia: '2026-10-21',
    quantidadeDeDias: '',
    horaInicio: '14:00',
    horaFim: '16:00',
  }

  it('por dias: o dia final calculado e nenhuma hora', () => {
    expect(validarRascunhoDoLancamento(POR_DIAS, HOJE)).toEqual({
      ok: true,
      valores: {
        modalidade: 'dias',
        dia_inicio: '2026-10-20',
        dia_fim: '2026-10-22',
        hora_inicio: null,
        hora_fim: null,
        tipo: 'atestado_medico',
        observacao: null,
      },
    })
  })

  it('por dias, os horários que ficaram nos campos escondidos não vão', () => {
    const resultado = validarRascunhoDoLancamento({ ...POR_DIAS, horaInicio: '14:00', horaFim: '16:00' }, HOJE)
    expect(resultado).toMatchObject({ ok: true, valores: { hora_inicio: null, hora_fim: null } })
  })

  it('por horário: um dia só (início = fim) e as duas horas', () => {
    expect(validarRascunhoDoLancamento(POR_HORARIO, HOJE)).toEqual({
      ok: true,
      valores: {
        modalidade: 'horario',
        dia_inicio: '2026-10-21',
        dia_fim: '2026-10-21',
        hora_inicio: '14:00',
        hora_fim: '16:00',
        tipo: 'atestado_medico',
        observacao: null,
      },
    })
  })

  it('por horário, a quantidade de dias que ficou no campo escondido não importa', () => {
    expect(validarRascunhoDoLancamento({ ...POR_HORARIO, quantidadeDeDias: '1,5' }, HOJE)).toMatchObject({
      ok: true,
      valores: { dia_fim: '2026-10-21' },
    })
  })

  it('recusa sem a data, com a quantidade errada e com o horário invertido ou igual', () => {
    expect(validarRascunhoDoLancamento({ ...POR_DIAS, dia: '' }, HOJE)).toEqual({ ok: false, erro: 'Informe a data de início.' })
    expect(validarRascunhoDoLancamento({ ...POR_HORARIO, dia: '' }, HOJE)).toEqual({ ok: false, erro: 'Informe a data.' })
    for (const quantidade of ['0', '-1', '1,5', '']) {
      expect(validarRascunhoDoLancamento({ ...POR_DIAS, quantidadeDeDias: quantidade }, HOJE).ok, quantidade).toBe(false)
    }
    expect(validarRascunhoDoLancamento({ ...POR_HORARIO, horaFim: '13:00' }, HOJE)).toEqual({
      ok: false,
      erro: 'O horário final tem de ser depois do inicial.',
    })
    expect(validarRascunhoDoLancamento({ ...POR_HORARIO, horaFim: '14:00' }, HOJE).ok).toBe(false)
    expect(validarRascunhoDoLancamento({ ...POR_HORARIO, horaInicio: '' }, HOJE)).toEqual({
      ok: false,
      erro: 'Informe o horário inicial.',
    })
  })

  it('modalidade desconhecida é recusada com a frase do banco', () => {
    expect(validarRascunhoDoLancamento({ ...POR_DIAS, modalidade: 'semanas' }, HOJE)).toEqual({
      ok: false,
      erro: 'Escolha se a ausência é por dias ou por horário.',
    })
  })

  it('as regras de sempre continuam valendo nas duas: "outro" com observação e a janela de um ano', () => {
    expect(validarRascunhoDoLancamento({ ...POR_HORARIO, tipo: 'outro' }, HOJE)).toEqual({
      ok: false,
      erro: 'No tipo “outro motivo”, escreva a observação: é ela que explica a falta na folha.',
    })
    expect(validarRascunhoDoLancamento({ ...POR_HORARIO, dia: '2062-10-21' }, HOJE).ok).toBe(false)
    expect(validarRascunhoDoLancamento({ ...POR_DIAS, dia: somarDias(HOJE, 366), quantidadeDeDias: '2' }, HOJE).ok).toBe(false)
    expect(validarRascunhoDoLancamento({ ...POR_DIAS, tipo: 'outro', observacao: ' júri ' }, HOJE)).toMatchObject({
      ok: true,
      valores: { observacao: 'júri' },
    })
  })

  it('nenhuma frase de recusa da tela tem travessão', () => {
    const recusas = [
      validarRascunhoDoLancamento({ ...POR_DIAS, quantidadeDeDias: '1,5' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_DIAS, quantidadeDeDias: '121' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_DIAS, quantidadeDeDias: '' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_DIAS, dia: '' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_DIAS, modalidade: 'x' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_HORARIO, horaFim: '14:00' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_HORARIO, horaFim: '13:00' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_HORARIO, horaInicio: '', horaFim: '' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_HORARIO, horaInicio: '25:00' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_HORARIO, tipo: 'outro' }, HOJE),
      validarRascunhoDoLancamento({ ...POR_HORARIO, dia: '2062-10-21' }, HOJE),
    ]
    for (const recusa of recusas) {
      expect(recusa.ok).toBe(false)
      if (!recusa.ok) expect(recusa.erro).not.toMatch(/[\u2013\u2014]/)
    }
    const motivo = validarMotivoDoCancelamento(' ')
    expect(motivo.ok).toBe(false)
    if (!motivo.ok) expect(motivo.erro).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('o arquivo do atestado', () => {
  it('a extensão sai do tipo e, sem ele, do nome (o HEIC do iPhone chega sem tipo)', () => {
    expect(extensaoDoArquivo('image/jpeg', 'x')).toBe('jpg')
    expect(extensaoDoArquivo('application/pdf', 'x')).toBe('pdf')
    expect(extensaoDoArquivo('', 'IMG_0042.HEIC')).toBe('heic')
    expect(extensaoDoArquivo('', 'atestado.jpeg')).toBe('jpg')
    expect(extensaoDoArquivo('image/gif', 'x.gif')).toBeNull()
    expect(extensaoDoArquivo('', 'laudo.docx')).toBeNull()
  })

  it('o caminho é o combinado com a policy e o CHECK: {usuario}/{ausencia}.{ext}', () => {
    const caminho = caminhoDoAtestado(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'jpg',
    )
    expect(caminho).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|pdf)$/,
    )
  })

  it('foto é comprimida; PDF vai como veio, até 10 MB; o resto é recusado', () => {
    expect(planoDoAtestado('image/png', 'a.png', 5_000_000)).toEqual({ acao: 'comprimir', extensao: 'png' })
    expect(planoDoAtestado('image/jpeg', 'a.jpg', 40_000_000)).toEqual({ acao: 'comprimir', extensao: 'jpg' })
    expect(planoDoAtestado('application/pdf', 'a.pdf', TAMANHO_MAXIMO_DO_ATESTADO)).toEqual({
      acao: 'enviar',
      extensao: 'pdf',
    })
    expect(planoDoAtestado('application/pdf', 'a.pdf', TAMANHO_MAXIMO_DO_ATESTADO + 1)).toMatchObject({ acao: 'recusar' })
    expect(planoDoAtestado('video/mp4', 'a.mp4', 1000)).toMatchObject({ acao: 'recusar' })
    expect(planoDoAtestado('image/jpeg', 'a.jpg', 0)).toMatchObject({ acao: 'recusar' })
  })

  it('a redução mantém a proporção e nunca aumenta a foto pequena', () => {
    expect(dimensoesReduzidas(4000, 3000)).toEqual({ largura: 2000, altura: 1500 })
    expect(dimensoesReduzidas(3024, 4032)).toEqual({ largura: 1500, altura: 2000 })
    expect(dimensoesReduzidas(800, 600)).toEqual({ largura: 800, altura: 600 })
    expect(dimensoesReduzidas(0, 600)).toEqual({ largura: 0, altura: 0 })
  })

  it('o tamanho por extenso', () => {
    expect(formatarTamanho(312 * 1024)).toBe('312 KB')
    expect(formatarTamanho(2.4 * 1024 * 1024)).toBe('2,4 MB')
  })
})
