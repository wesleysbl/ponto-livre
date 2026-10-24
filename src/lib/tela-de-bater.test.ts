import { describe, expect, it, vi } from 'vitest'
import type { Batida, TipoDeBatida } from './formato'
import {
  descricaoDoPin,
  deveVoltarAoInicio,
  ETAPAS_FINAIS,
  ETAPAS_QUE_NUNCA_VOLTAM_SOZINHAS,
  MINUTOS_ATE_VOLTAR_AO_INICIO,
  ondeFicaOHorario,
  preverBotao,
  resumoDeHojeNoFormulario,
  resumoDoDiaCompleto,
  rodapeDaFalhaDeLocalizacao,
  textoDaConfirmacaoDaExtra,
  textoDaFalhaDeLocalizacao,
  textoDeBaterSemLocalizacao,
  valeTentarALocalizacaoDeNovo,
} from './tela-de-bater'

/*
 * A TELA DE BATER, SEM REACT.
 *
 * O que o botão diz, quando o app reaberto volta ao início, o que a falha de
 * localização oferece, as frases do formulário de batida em atraso e o erro de
 * rede do iPhone. A tela (`Bater.tsx`) só desenha o que estas funções decidem.
 */

// `batidas.ts` e `pin.ts` importam o cliente do Supabase, que exige as
// variáveis de ambiente: os tradutores de erro são testados com ele simulado.
vi.mock('./supabase', () => ({ supabase: {} }))
const { ErroDeBatida, ErroDoPedido } = await import('./batidas')
const { ErroDePin, formatarEspera } = await import('./pin')

const TIPOS: TipoDeBatida[] = ['entrada', 'saida_almoco', 'volta_almoco', 'saida', 'extra', 'extra']

/** Uma batida de hoje (21/10/2026), às `hora` de Brasília, na posição `ordem`. */
function batida(hora: string, ordem: number): Batida {
  return {
    id: `b-${hora}`,
    registrado_em: `2026-10-21T${hora}:00.000-03:00`,
    dia_civil: '2026-10-21',
    tipo: TIPOS[Math.min(ordem - 1, TIPOS.length - 1)],
    ordem_no_dia: ordem,
    latitude: -23.55,
    longitude: -46.63,
    precisao_metros: 10,
    distancia_metros: 5,
    no_local: true,
    selfie_path: `u/2026/10/b-${hora}.jpg`,
    ajuste_manual: false,
    pedido_atraso_id: null,
  }
}

const HORAS = ['08:02', '12:01', '13:00', '18:01', '19:00', '21:00']
const ate = (quantas: number) => HORAS.slice(0, quantas).map((hora, indice) => batida(hora, indice + 1))

const pronto = (quantas: number, pedidosPendentes = 0) =>
  preverBotao({ carregando: false, erro: null, batidas: ate(quantas), pedidosPendentes })

describe('o botão diz qual batida', () => {
  it('enquanto a lista carrega, só "Bater ponto" — nunca "Entrada" antes de saber', () => {
    const previsao = preverBotao({ carregando: true, erro: null, batidas: [], pedidosPendentes: 0 })
    expect(previsao).toMatchObject({ modo: 'carregando', titulo: 'Bater ponto', principal: true, aviso: null })
    expect(previsao.subtitulo).toBe('selfie, localização e PIN')
    expect(previsao.subtitulo).not.toContain('de 4')
  })

  it.each([
    [0, 'Bater entrada', '1ª de 4 hoje · selfie, localização e PIN'],
    [1, 'Bater saída para o almoço', '2ª de 4 hoje · selfie, localização e PIN'],
    [2, 'Bater volta do almoço', '3ª de 4 hoje · selfie, localização e PIN'],
    [3, 'Bater saída', '4ª de 4 hoje · selfie, localização e PIN'],
  ])('com %s batida(s) hoje: "%s", "%s"', (quantas, titulo, subtitulo) => {
    const previsao = pronto(quantas)
    expect(previsao).toMatchObject({ modo: 'proxima', titulo, subtitulo, principal: true, pedeConfirmacao: false })
  })

  it('com 4 batidas, o dia está completo: resumo, botão secundário e confirmação antes da extra', () => {
    const previsao = pronto(4)
    expect(previsao).toMatchObject({
      modo: 'completo',
      titulo: 'Bater batida extra',
      aviso: 'Só se você voltou a trabalhar depois da saída.',
      principal: false,
      pedeConfirmacao: true,
      // 08:02→12:01 (3h59) + 13:00→18:01 (5h01): a mesma conta do espelho.
      resumoDoDia: '08:02 → 18:01 · 9h00',
    })
  })

  it('com 5 (a extra aberta), o botão volta a ser o principal e fecha o par, sem confirmação', () => {
    expect(pronto(5)).toMatchObject({
      modo: 'extra_aberta',
      titulo: 'Bater batida extra',
      subtitulo: '6ª batida de hoje · selfie, localização e PIN',
      principal: true,
      pedeConfirmacao: false,
    })
  })

  it('com 6, o dia está completo de novo, com as horas dos três pares', () => {
    const previsao = pronto(6)
    expect(previsao.modo).toBe('completo')
    // 08:02→12:01 (3h59) + 13:00→18:01 (5h01) + 19:00→21:00 (2h00) = 11h00
    expect(previsao.resumoDoDia).toBe('08:02 → 21:00 · 11h00')
  })

  it('se a lista não veio, "Bater ponto", com a linha que diz que dá para bater', () => {
    const previsao = preverBotao({
      carregando: false,
      erro: 'Sem conexão com o servidor.',
      batidas: [],
      pedidosPendentes: 0,
    })
    expect(previsao).toMatchObject({ modo: 'sem_leitura', titulo: 'Bater ponto', principal: true })
    expect(previsao.aviso).toBe(
      'Não deu para ler suas batidas de hoje. Pode bater normalmente: o tipo é definido na gravação.',
    )
  })

  it('com pedido em atraso esperando, "Bater ponto": a aprovação muda os nomes de hoje', () => {
    expect(pronto(1, 1)).toMatchObject({
      modo: 'com_pedido',
      titulo: 'Bater ponto',
      aviso:
        'Você tem 1 pedido em atraso aguardando aprovação. Quando ele for aprovado, os nomes das batidas de hoje se ajustam sozinhos.',
    })
    expect(pronto(2, 2).aviso).toContain('Você tem 2 pedidos em atraso aguardando aprovação. Quando eles forem aprovados')
    // Com o dia completo, a confirmação vale mesmo com pedido esperando.
    expect(pronto(4, 1).modo).toBe('completo')
  })

  it('nenhum caso decide o tipo: o rótulo é só a escada de proximoTipo, e "Bater ponto" quando ela pode mentir', () => {
    const titulos = [0, 1, 2, 3].map((quantas) => pronto(quantas).titulo)
    expect(new Set(titulos).size).toBe(4)
    expect(resumoDoDiaCompleto([])).toBeNull()
  })

  it('a confirmação diz quantas batidas e a hora da última', () => {
    expect(textoDaConfirmacaoDaExtra(ate(4))).toBe(
      'Suas 4 batidas de hoje já estão registradas (última às 18:01). Uma batida a mais entra como extra e deixa o dia incompleto até a próxima.',
    )
    expect(textoDaConfirmacaoDaExtra(ate(6))).toContain('Suas 6 batidas de hoje já estão registradas (última às 21:00).')
  })
})

describe('o app reaberto volta ao início só quando deve', () => {
  const AGORA = Date.parse('2026-10-21T08:00:00-03:00')
  const base = { agoraMs: AGORA, diaDaLeitura: '2026-10-21', hoje: '2026-10-21' }
  const minutos = (n: number) => n * 60_000

  it(`numa etapa final, depois de ${MINUTOS_ATE_VOLTAR_AO_INICIO} minutos, volta; antes, não`, () => {
    for (const etapa of ETAPAS_FINAIS) {
      expect(deveVoltarAoInicio({ ...base, etapa, desdeMs: AGORA - minutos(11) }), etapa).toBe(true)
      expect(deveVoltarAoInicio({ ...base, etapa, desdeMs: AGORA - minutos(9) }), etapa).toBe(false)
    }
  })

  it('numa etapa final, o dia que mudou volta na hora (o comprovante de ontem, aberto de manhã)', () => {
    expect(
      deveVoltarAoInicio({ ...base, etapa: 'comprovante', desdeMs: AGORA - minutos(1), diaDaLeitura: '2026-10-20' }),
    ).toBe(true)
  })

  it('NUNCA no meio de um passo — nem com o dia mudado, nem depois de horas', () => {
    expect(ETAPAS_QUE_NUNCA_VOLTAM_SOZINHAS).toEqual([
      'atraso',
      'confirmar_extra',
      'camera',
      'localizando',
      'localizacao_falhou',
      'pin',
      'gravando',
    ])
    for (const etapa of ETAPAS_QUE_NUNCA_VOLTAM_SOZINHAS) {
      expect(
        deveVoltarAoInicio({ ...base, etapa, desdeMs: AGORA - minutos(600), diaDaLeitura: '2026-10-20' }),
        etapa,
      ).toBe(false)
    }
  })

  it('no início não há para onde voltar (a lista é relida de qualquer jeito)', () => {
    expect(deveVoltarAoInicio({ ...base, etapa: 'inicio', desdeMs: 0, diaDaLeitura: '2026-10-20' })).toBe(false)
  })

  it('sem leitura ainda, só o relógio conta', () => {
    expect(deveVoltarAoInicio({ ...base, etapa: 'erro', desdeMs: AGORA - minutos(2), diaDaLeitura: null })).toBe(false)
  })
})

describe('a falha de localização', () => {
  it('só o GPS que não respondeu (ou demorou) vale tentar de novo com a foto guardada', () => {
    expect(valeTentarALocalizacaoDeNovo('indisponivel')).toBe(true)
    expect(valeTentarALocalizacaoDeNovo('demora')).toBe(true)
    expect(valeTentarALocalizacaoDeNovo('negada')).toBe(false)
    expect(valeTentarALocalizacaoDeNovo('sem_https')).toBe(false)
    expect(valeTentarALocalizacaoDeNovo('sem_suporte')).toBe(false)
  })

  it('o texto pelo motivo, e "Ainda não deu" da segunda falha em diante — quem oferece a batida sem localização é o botão, não esta frase', () => {
    expect(textoDaFalhaDeLocalizacao('indisponivel', 1)).toBe(
      'O GPS não respondeu. Chegue perto de uma janela ou saia da sala e tente de novo.',
    )
    expect(textoDaFalhaDeLocalizacao('demora', 1)).toBe(
      'A localização está demorando. Vamos tentar de novo de um jeito mais rápido.',
    )
    expect(textoDaFalhaDeLocalizacao('demora', 2)).toMatch(/^Ainda não deu\./)
    for (const motivo of ['indisponivel', 'demora'] as const) {
      for (const vez of [1, 2, 3]) expect(textoDaFalhaDeLocalizacao(motivo, vez)).not.toMatch(/sem localiza/i)
    }
  })
})

describe('bater sem localização', () => {
  it('o botão e a linha: a batida sai com a foto e o PIN, marcada; prefira tentar de novo', () => {
    expect(textoDeBaterSemLocalizacao(false)).toEqual({
      botao: 'Bater sem localização',
      linha:
        'A batida sai com a sua foto e o PIN, marcada como sem localização. Prefira tentar de novo perto de uma janela.',
    })
  })

  it('no pedido em atraso, o mesmo botão fala do pedido', () => {
    const doPedido = textoDeBaterSemLocalizacao(true)
    expect(doPedido.botao).toBe('Enviar o pedido sem localização')
    expect(doPedido.linha).toMatch(/^O pedido sai com a sua foto e o PIN, marcado como sem localização\./)
  })

  it('o rodapé da falha diz o que vale em qualquer caminho: nada foi gravado, e a distância não bloqueia', () => {
    expect(rodapeDaFalhaDeLocalizacao(false)).toBe('Nada foi gravado ainda. A distância até o local não bloqueia a batida.')
    expect(rodapeDaFalhaDeLocalizacao(true)).toBe('Nada foi enviado ainda. A distância até o local não bloqueia o pedido.')
  })

  it('a frase do PIN diz quando vai sem localização', () => {
    expect(descricaoDoPin(null, false)).toBe('Último passo antes de gravar a batida.')
    expect(descricaoDoPin(null, true)).toBe('Último passo antes de gravar a batida, sem localização.')
    expect(descricaoDoPin('08:00', false)).toBe('Último passo antes de enviar o pedido de batida das 08:00.')
    expect(descricaoDoPin('08:00', true)).toBe(
      'Último passo antes de enviar o pedido de batida das 08:00, sem localização.',
    )
  })

  it('a recusa do banco sem coordenada e sem motivo aceito chega traduzida, na batida e no pedido', () => {
    const FRASE = 'A localização veio incompleta do aparelho. Tente de novo.'
    expect(new ErroDeBatida('Batida pelo app exige latitude e longitude').message).toBe(FRASE)
    expect(new ErroDoPedido('Pedido de batida em atraso exige latitude e longitude').message).toBe(FRASE)
  })
})

describe('o formulário da batida em atraso', () => {
  it('as batidas de hoje numa linha, com o rótulo curto', () => {
    expect(resumoDeHojeNoFormulario(ate(2))).toBe('Hoje você já bateu: 08:02 Entrada · 12:01 Almoço')
    expect(resumoDeHojeNoFormulario([])).toBe('Hoje você ainda não bateu nenhuma.')
  })

  it('onde a hora escolhida cai entre as batidas de hoje', () => {
    expect(ondeFicaOHorario('13:00', ate(2))).toBe('Esse horário fica depois do Almoço (12:01).')
    expect(ondeFicaOHorario('10:00', ate(2))).toBe('Esse horário fica depois da Entrada (08:02).')
    expect(ondeFicaOHorario('07:30', ate(2))).toBe('Esse horário fica antes de todas as suas batidas de hoje.')
    expect(ondeFicaOHorario('12:01', ate(2))).toBe(
      'Você já tem uma batida às 12:01 (Almoço). Escolha o horário em que esqueceu de bater.',
    )
    // Sem hora válida ou sem batida, nada a dizer.
    expect(ondeFicaOHorario('', ate(2))).toBeNull()
    expect(ondeFicaOHorario('13:00', [])).toBeNull()
  })
})

describe('o erro de rede do iPhone ("Load failed") vira frase legível', () => {
  const SEM_CONEXAO = 'Sem conexão com o servidor. Verifique a internet e tente de novo.'

  it.each(['Load failed', 'TypeError: Load failed'])('"%s" na batida, no pedido e no PIN', (mensagem) => {
    expect(new ErroDeBatida(mensagem).message).toBe(SEM_CONEXAO)
    expect(new ErroDoPedido(mensagem).message).toBe(SEM_CONEXAO)
    expect(new ErroDePin(mensagem).message).toBe(SEM_CONEXAO)
  })

  it('a frase do Chrome continua reconhecida', () => {
    expect(new ErroDeBatida('TypeError: Failed to fetch').message).toBe(SEM_CONEXAO)
    expect(new ErroDePin('Failed to fetch').message).toBe(SEM_CONEXAO)
  })
})

describe('a contagem do bloqueio do PIN', () => {
  // O bloqueio endurece no mesmo dia (15 minutos, 1 hora, 24 horas): com uma
  // hora ou mais, as horas vão na frente, e a tela não mostra "1440:00".
  it.each([
    [7, '0:07'],
    [247, '4:07'],
    [900, '15:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [86_400, '24:00:00'],
  ])('%i segundos -> %s', (segundos, esperado) => {
    expect(formatarEspera(segundos)).toBe(esperado)
  })
})
