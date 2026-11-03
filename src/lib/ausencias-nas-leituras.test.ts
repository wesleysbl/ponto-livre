import { describe, expect, it } from 'vitest'
import { ausenciasPorDia, ausenciasPorPessoa, type Ausencia } from './ausencias'
import { CABECALHO, COLUNAS_ANTES_DO_SALDO, gerarCsvDoPeriodo, SEPARADOR, TIPO_DA_LINHA_DE_AUSENCIA } from './csv'
import { montarFolha } from './folha'
import type { BatidaDoAdmin } from './formato'
import { agruparPorDia, montarEspelho, resumirDias } from './horas'
import { montarLinhasDoPainel } from './painel'

/*
 * A AUSÊNCIA NAS QUATRO LEITURAS: espelho, painel, folha e CSV.
 *
 * O que se prova:
 *  • uma ausência de 3 dias gera 3 dias marcados na folha e no CSV;
 *  • ausência cancelada não aparece;
 *  • um dia com ausência e batida mostra os dois;
 *  • a soma de horas TRABALHADAS do mês NÃO muda por causa de uma ausência,
 *    nem no espelho, nem no painel, nem na folha, nem no CSV. O abono do
 *    atestado e da falta justificada é outra conta, por cima desta
 *    (`saldo.ts`), e nenhuma batida some por ele;
 *  • a ausência por horário marca o dia dela, e só ele, nas quatro leituras, e
 *    também não muda o trabalhado.
 */

const MES = '2026-10'
const OUTUBRO = { inicio: '2026-10-01', fim: '2026-10-31' }

function batida(dia: string, hora: string, extras: Partial<BatidaDoAdmin> = {}): BatidaDoAdmin {
  return {
    id: `b-${dia}-${hora}`,
    usuario_id: 'u1',
    registrado_em: `${dia}T${hora}:00.000-03:00`,
    dia_civil: dia,
    tipo: 'entrada',
    ordem_no_dia: 1,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    distancia_metros: null,
    no_local: null,
    selfie_path: `u1/2026/10/b-${dia}-${hora}.jpg`,
    ajuste_manual: false,
    origem: 'app',
    motivo_ajuste: null,
    funcionario_nome: 'Fulana',
    funcionario_email: 'fulana@example.com',
    pedido_atraso_id: null,
    ...extras,
  }
}

function ausencia(id: string, extras: Partial<Ausencia> = {}): Ausencia {
  return {
    id,
    usuario_id: 'u1',
    dia_inicio: '2026-10-14',
    dia_fim: '2026-10-16',
    tipo: 'atestado_medico',
    modalidade: 'dias',
    hora_inicio: null,
    hora_fim: null,
    observacao: null,
    atestado_path: `u1/${id}.jpg`,
    lancado_por: 'admin-1',
    lancado_em: '2026-10-17T12:00:00.000Z',
    cancelada_em: null,
    cancelada_por: null,
    motivo_cancelamento: null,
    ...extras,
  }
}

/**
 * O mês: dia 13 cheio (8h), dia 15 meio período (4h, foi ao médico de manhã —
 * o dia tem ausência E batida), dia 20 cheio (8h). Total: 20h00.
 */
const BATIDAS: BatidaDoAdmin[] = [
  batida('2026-10-13', '08:00'),
  batida('2026-10-13', '12:00', { tipo: 'saida_almoco', ordem_no_dia: 2 }),
  batida('2026-10-13', '13:00', { tipo: 'volta_almoco', ordem_no_dia: 3 }),
  batida('2026-10-13', '17:00', { tipo: 'saida', ordem_no_dia: 4 }),
  batida('2026-10-15', '13:00'),
  batida('2026-10-15', '17:00', { tipo: 'saida_almoco', ordem_no_dia: 2 }),
  batida('2026-10-20', '08:00'),
  batida('2026-10-20', '12:00', { tipo: 'saida_almoco', ordem_no_dia: 2 }),
  batida('2026-10-20', '13:00', { tipo: 'volta_almoco', ordem_no_dia: 3 }),
  batida('2026-10-20', '17:00', { tipo: 'saida', ordem_no_dia: 4 }),
]

const ATESTADO_DE_3_DIAS = ausencia('a-tres')
const CANCELADA = ausencia('a-cancelada', {
  dia_inicio: '2026-10-22',
  dia_fim: '2026-10-23',
  tipo: 'falta_justificada',
  atestado_path: null,
  cancelada_em: '2026-10-17T13:00:00.000Z',
  cancelada_por: 'admin-1',
  motivo_cancelamento: 'lançada para a pessoa errada',
})
const AUSENCIAS = [ATESTADO_DE_3_DIAS, CANCELADA]

const funcionario = { nome: 'Fulana', email: 'fulana@example.com' }

function linhasDoCsv(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .filter(Boolean)
    .slice(1)
    .map((linha) => linha.split(SEPARADOR))
}

const coluna = (nome: (typeof CABECALHO)[number]) => CABECALHO.indexOf(nome)

describe('a folha com ausência', () => {
  const sem = montarFolha({ empresa: null, funcionario, mes: MES, batidas: BATIDAS })
  const com = montarFolha({ empresa: null, funcionario, mes: MES, batidas: BATIDAS, ausencias: AUSENCIAS })

  it('uma ausência de 3 dias gera 3 dias marcados', () => {
    const marcados = com.linhas.filter((linha) => linha.ausencia)
    expect(marcados.map((linha) => linha.dia)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16'])
    for (const linha of marcados) {
      expect(linha.marcas).toContain('Atestado, dia inteiro (atestado anexado)')
    }
  })

  it('o dia só de ausência entra sem horário e sem horas trabalhadas', () => {
    const dia14 = com.linhas.find((linha) => linha.dia === '2026-10-14')
    expect(dia14).toMatchObject({ horarios: [], minutos: 0, total: '0h00', incompleto: false, ajustado: false })
  })

  it('o dia com ausência e batida mostra os dois', () => {
    const dia15 = com.linhas.find((linha) => linha.dia === '2026-10-15')
    expect(dia15?.horarios).toEqual(['13:00', '17:00'])
    expect(dia15?.total).toBe('4h00')
    expect(dia15?.ausencia).toBe(true)
    expect(dia15?.marcas[0]).toContain('Atestado')
  })

  it('a ausência cancelada não aparece', () => {
    expect(com.linhas.map((linha) => linha.dia)).not.toContain('2026-10-22')
    expect(com.linhas.map((linha) => linha.dia)).not.toContain('2026-10-23')
    expect(com.linhas.flatMap((linha) => linha.marcas).join(' ')).not.toContain('pessoa errada')
  })

  it('a soma de horas do mês não muda por causa de uma ausência', () => {
    expect(com.total).toBe('20h00')
    expect(com.total).toBe(sem.total)
    expect(com.resumo).toEqual(sem.resumo)
    expect(com.resumo.minutos).toBe(montarEspelho(MES, BATIDAS).minutos)
    // Os dias com batida são os mesmos, com os mesmos totais.
    const comBatida = (folha: typeof com) =>
      folha.linhas.filter((linha) => linha.horarios.length > 0).map((linha) => [linha.dia, linha.total])
    expect(comBatida(com)).toEqual(comBatida(sem))
  })

  it('ausência que passa do mês só marca os dias do mês da folha', () => {
    const entreMeses = ausencia('a-entre-meses', { dia_inicio: '2026-10-30', dia_fim: '2026-11-02' })
    const folha = montarFolha({ empresa: null, funcionario, mes: MES, batidas: [], ausencias: [entreMeses] })
    expect(folha.linhas.map((linha) => linha.dia)).toEqual(['2026-10-30', '2026-10-31'])
    expect(folha.total).toBe('0h00')
  })

  it('sem ausências, a folha sai só com os dias de batida, sem marca de ausência', () => {
    expect(sem.linhas.every((linha) => !linha.ausencia)).toBe(true)
    expect(sem.linhas.map((linha) => linha.dia)).toEqual(['2026-10-13', '2026-10-15', '2026-10-20'])
  })
})

describe('o CSV com ausência', () => {
  const porDia = ausenciasPorDia(AUSENCIAS, OUTUBRO)
  const sem = gerarCsvDoPeriodo([{ ...funcionario, batidas: BATIDAS }])
  const com = gerarCsvDoPeriodo([{ ...funcionario, batidas: BATIDAS, ausencias: porDia }])
  const linhas = linhasDoCsv(com)
  const deAusencia = linhas.filter((linha) => linha[coluna('Tipo')] === TIPO_DA_LINHA_DE_AUSENCIA)

  it('uma ausência de 3 dias gera 3 dias marcados', () => {
    expect(deAusencia.map((linha) => linha[coluna('Data')])).toEqual(['14/10/2026', '15/10/2026', '16/10/2026'])
    for (const linha of deAusencia) {
      expect(linha[coluna('Origem')]).toBe('Atestado, dia inteiro (atestado anexado)')
      expect(linha[coluna('Hora')]).toBe('')
      expect(linha[coluna('Selfie')]).toBe('')
    }
  })

  it('as 18 colunas de antes, mais as 9 do saldo, em toda linha', () => {
    expect(COLUNAS_ANTES_DO_SALDO).toBe(18)
    expect(CABECALHO).toHaveLength(27)
    for (const linha of linhas) expect(linha).toHaveLength(27)
  })

  it('o dia com ausência e batida mostra os dois, e só a última batida fecha o dia', () => {
    const dia15 = linhas.filter((linha) => linha[coluna('Data')] === '15/10/2026')
    expect(dia15.map((linha) => linha[coluna('Tipo')])).toEqual([TIPO_DA_LINHA_DE_AUSENCIA, 'Entrada', 'Saída para o almoço'])
    expect(dia15[0][coluna('Horas do dia')]).toBe('')
    expect(dia15[2][coluna('Horas do dia')]).toBe('4:00')
  })

  it('o dia só de ausência fecha com zero batidas e 0:00', () => {
    const dia14 = linhas.filter((linha) => linha[coluna('Data')] === '14/10/2026')
    expect(dia14).toHaveLength(1)
    expect(dia14[0][coluna('Batidas no dia')]).toBe('0')
    expect(dia14[0][coluna('Horas do dia')]).toBe('0:00')
    expect(dia14[0][coluna('Horas do dia (decimal)')]).toBe('0,00')
  })

  it('a ausência cancelada não aparece', () => {
    expect(linhas.map((linha) => linha[coluna('Data')])).not.toContain('22/10/2026')
    expect(com).not.toContain('pessoa errada')
  })

  it('a soma da coluna "Horas do dia (decimal)" é a mesma, com e sem ausência', () => {
    const soma = (csv: string) =>
      linhasDoCsv(csv)
        .map((linha) => linha[coluna('Horas do dia (decimal)')])
        .filter(Boolean)
        .reduce((total, valor) => total + Number(valor.replace(',', '.')), 0)
    expect(soma(com)).toBe(20)
    expect(soma(com)).toBe(soma(sem))
  })

  it('as linhas de batida são as mesmas do CSV sem ausência, na mesma ordem', () => {
    // Nas 18 colunas de antes. A partir da 19ª, o fechamento do dia 15 ganha a
    // marca da ausência ("Ausências do dia"), que é justamente a diferença.
    const antes = (linha: string[]) => linha.slice(0, COLUNAS_ANTES_DO_SALDO)
    const deBatida = linhas.filter((linha) => linha[coluna('Tipo')] !== TIPO_DA_LINHA_DE_AUSENCIA)
    expect(deBatida.map(antes)).toEqual(linhasDoCsv(sem).map(antes))
  })

  it('o "outro motivo" leva a observação, que o banco exige', () => {
    const outro = ausencia('a-outro', {
      dia_inicio: '2026-10-27',
      dia_fim: '2026-10-27',
      tipo: 'outro',
      observacao: 'convocação; júri popular',
      atestado_path: null,
    })
    const csv = gerarCsvDoPeriodo([{ ...funcionario, batidas: [], ausencias: ausenciasPorDia([outro], OUTUBRO) }])
    // O ";" da observação vem entre aspas e não vira coluna nova.
    expect(csv).toContain('"Outro motivo, dia inteiro: convocação; júri popular"')
  })
})

describe('o painel e o espelho com ausência', () => {
  it('o painel conta os dias de ausência à parte, e o resumo de horas não muda', () => {
    const pessoas = [
      {
        usuarioId: 'u1',
        nome: 'Fulana',
        nomeDaConta: 'Fulana',
        email: null,
        podeBater: true,
        contaApagada: false,
        temFicha: false,
      },
    ]
    const [sem] = montarLinhasDoPainel(pessoas, BATIDAS)
    const [com] = montarLinhasDoPainel(pessoas, BATIDAS, ausenciasPorPessoa(AUSENCIAS, OUTUBRO))
    expect(com.ausencias.size).toBe(3)
    expect(sem.ausencias.size).toBe(0)
    expect(com.resumo).toEqual(sem.resumo)
    expect(com.resumo.minutos).toBe(20 * 60)
  })

  it('ausência de quem não está na lista entra como linha própria, sem horas', () => {
    const linhas = montarLinhasDoPainel([], [], ausenciasPorPessoa([ausencia('a-x', { usuario_id: 'u9' })], OUTUBRO))
    expect(linhas).toHaveLength(1)
    expect(linhas[0].funcionario).toMatchObject({ usuarioId: 'u9', contaApagada: true })
    expect(linhas[0].resumo.minutos).toBe(0)
  })

  it('o espelho do colaborador soma o mesmo: a ausência fica fora de horas.ts', () => {
    expect(resumirDias(agruparPorDia(BATIDAS)).minutos).toBe(montarEspelho(MES, BATIDAS).minutos)
  })
})

describe('a ausência por horário nas leituras', () => {
  /** Dia 20 tem as quatro batidas (8h); a ausência das 14:00 às 16:00 cai nele. */
  const NO_DIA_COM_BATIDA = ausencia('a-tarde', {
    dia_inicio: '2026-10-20',
    dia_fim: '2026-10-20',
    modalidade: 'horario',
    hora_inicio: '14:00:00',
    hora_fim: '16:00:00',
    atestado_path: null,
  })
  /** Dia 21 não tem batida: a ausência das 09:00 às 10:00 é o único conteúdo dele. */
  const NO_DIA_SEM_BATIDA = ausencia('a-manha', {
    dia_inicio: '2026-10-21',
    dia_fim: '2026-10-21',
    tipo: 'falta_justificada',
    modalidade: 'horario',
    hora_inicio: '09:00:00',
    hora_fim: '10:00:00',
    atestado_path: null,
  })
  const POR_HORARIO = [NO_DIA_COM_BATIDA, NO_DIA_SEM_BATIDA]

  it('marca só o dia dela, como uma ausência de um dia', () => {
    const porDia = ausenciasPorDia(POR_HORARIO, OUTUBRO)
    expect([...porDia.keys()].sort()).toEqual(['2026-10-20', '2026-10-21'])
    expect(porDia.get('2026-10-20')?.map((a) => a.id)).toEqual(['a-tarde'])
  })

  it('na folha, o dia com batida mostra os dois, o dia sem batida entra sem horas, e o total não muda', () => {
    const sem = montarFolha({ empresa: null, funcionario, mes: MES, batidas: BATIDAS })
    const com = montarFolha({ empresa: null, funcionario, mes: MES, batidas: BATIDAS, ausencias: POR_HORARIO })
    const dia20 = com.linhas.find((linha) => linha.dia === '2026-10-20')
    expect(dia20).toMatchObject({ ausencia: true, total: '8h00' })
    // Uma marca de ausência, com o horário (as outras marcas do dia são as das batidas).
    expect(dia20?.marcas.filter((marca) => marca.startsWith('Atestado'))).toEqual(['Atestado 14:00-16:00'])
    expect(com.linhas.find((linha) => linha.dia === '2026-10-21')?.marcas).toEqual(['Falta justificada 09:00-10:00'])
    expect(com.linhas.find((linha) => linha.dia === '2026-10-21')).toMatchObject({ ausencia: true, minutos: 0, horarios: [] })
    expect(com.total).toBe('20h00')
    expect(com.total).toBe(sem.total)
    expect(com.resumo).toEqual(sem.resumo)
  })

  it('no CSV, uma linha de ausência em cada dia, e a soma de horas é a mesma', () => {
    const linhas = linhasDoCsv(gerarCsvDoPeriodo([{ ...funcionario, batidas: BATIDAS, ausencias: ausenciasPorDia(POR_HORARIO, OUTUBRO) }]))
    const deAusencia = linhas.filter((linha) => linha[coluna('Tipo')] === TIPO_DA_LINHA_DE_AUSENCIA)
    expect(deAusencia.map((linha) => linha[coluna('Data')])).toEqual(['20/10/2026', '21/10/2026'])
    const soma = linhas
      .map((linha) => linha[coluna('Horas do dia (decimal)')])
      .filter(Boolean)
      .reduce((total, valor) => total + Number(valor.replace(',', '.')), 0)
    expect(soma).toBe(20)
  })

  it('no painel, conta os dois dias de ausência, e o resumo de horas não muda', () => {
    const pessoas = [
      { usuarioId: 'u1', nome: 'Fulana', nomeDaConta: 'Fulana', email: null, podeBater: true, contaApagada: false, temFicha: false },
    ]
    const [sem] = montarLinhasDoPainel(pessoas, BATIDAS)
    const [com] = montarLinhasDoPainel(pessoas, BATIDAS, ausenciasPorPessoa(POR_HORARIO, OUTUBRO))
    expect(com.ausencias.size).toBe(2)
    expect(com.resumo).toEqual(sem.resumo)
  })
})
