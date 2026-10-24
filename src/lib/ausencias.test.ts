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
  planoDoAtestado,
  somarDias,
  TAMANHO_MAXIMO_DO_ATESTADO,
  validarLancamento,
  validarMotivoDoCancelamento,
  type Ausencia,
} from './ausencias'

/*
 * AS REGRAS PURAS DAS AUSÊNCIAS.
 *
 *  • A expansão do período em dias — um atestado de 3 dias é UMA ausência e
 *    TRÊS dias marcados —, com troca de mês, ano bissexto e recorte.
 *  • A cancelada não marca dia nenhum.
 *  • As regras do lançamento, as MESMAS do gatilho `ponto_ausencias_guardar`
 *    (na migration da estrutura): ordem, 120 dias, janela de um ano, "outro"
 *    com observação.
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
