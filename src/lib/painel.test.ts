import { describe, expect, it } from 'vitest'
import type { BatidaDoAdmin } from './formato'
import {
  avisosDaFolha,
  contasComFichaNoPeriodo,
  contasLiberadasPelaFicha,
  diaCurto,
  diaPorExtenso,
  fichaValeNoPeriodo,
  fraseDoRecado,
  juntarComE,
  juntarGenteEFichas,
  marcarQuemBate,
  montarLinhasDoPainel,
  pendenciasDoFechamento,
  pessoaDoPainel,
  previaDaAprovacao,
  previaDoDia,
  primeiroNome,
  rotuloNaLista,
  totalizarPainel,
  type FuncionarioDoPainel,
} from './painel'
import type { DadosDaEmpresa } from './configuracao'
import type { FichaDoFuncionario } from './cadastro'
import { agruparPorDia, calcularDia } from './horas'
import { comNomesDasFichas, nomeDeExibicao, SEM_NOME } from './nomes'

/*
 * A COSTURA ENTRE AS CONTAS DO PONTO (`ponto_contas()`) E `ponto_registros`,
 * que tem três casos capazes de apagar gente da tela sem avisar:
 *
 *  • quem é do ponto e não bateu — some, e o admin nunca descobre que fulano
 *    não bateu;
 *  • batida de conta que não existe mais — some, e horas trabalhadas
 *    desaparecem do fechamento porque a conta saiu da lista;
 *  • quem não pode bater — some, e o admin acha que a pessoa faltou o mês todo
 *    quando na verdade ela nem consegue bater.
 *
 * Nenhum dos três dá erro. Por isso cada um tem um teste. E o caso contrário:
 * a conta que NÃO é do ponto no período (sem ficha, batida, ausência nem
 * pedido — a Rita, do RH, que só administra) não entra.
 */

function pessoa(
  usuarioId: string,
  nome: string,
  extras: Partial<FuncionarioDoPainel> = {},
): FuncionarioDoPainel {
  // Sem ficha nem super admin nos dados, o "pode bater" é o que o teste disser
  // (ficha e super admin entram por `juntarGenteEFichas`/`marcarQuemBate`).
  return {
    usuarioId,
    nome,
    nomeDaConta: nome,
    email: `${usuarioId}@example.com`,
    podeBater: true,
    contaApagada: false,
    temFicha: false,
    ...extras,
  }
}

function batida(
  usuarioId: string,
  dia: string,
  hora: string,
  extras: Partial<BatidaDoAdmin> = {},
): BatidaDoAdmin {
  return {
    id: `${usuarioId}-${dia}T${hora}`,
    usuario_id: usuarioId,
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
    funcionario_nome: null,
    funcionario_email: null,
    ...extras,
  }
}

function diaCompleto(usuarioId: string, dia: string): BatidaDoAdmin[] {
  return ['08:00', '12:00', '13:00', '18:00'].map((hora, i) =>
    batida(usuarioId, dia, hora, { ordem_no_dia: i + 1 }),
  )
}

function ficha(id: string, usuarioId: string | null, nomeCompleto: string, extras: Partial<FichaDoFuncionario> = {}): FichaDoFuncionario {
  return {
    id,
    usuarioId,
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

/** Do ponto pela ficha: o painel mostra, zerado, quem não bateu. */
const comFicha = (...ids: string[]) => ({ comFichaNoPeriodo: new Set(ids) })

const OUTUBRO = { inicio: '2026-10-01', fim: '2026-10-31' }

describe('quem entra na lista', () => {
  it('quem tem ficha no período e não bateu aparece zerado, e não some', () => {
    const linhas = montarLinhasDoPainel([pessoa('u1', 'Ana')], [], new Map(), comFicha('u1'))

    expect(linhas).toHaveLength(1)
    expect(linhas[0].resumo).toEqual({ minutos: 0, diasComBatida: 0, diasIncompletos: 0 })
  })

  /*
   * Listar todas as contas deixaria as pessoas que batem ponto no meio de
   * cartões zerados por construção. Quem só administra (a Rita, do RH) não
   * entra.
   */
  it('conta sem ficha e sem batida, ausência ou pedido no período NÃO aparece', () => {
    const linhas = montarLinhasDoPainel(
      [pessoa('ana', 'Ana'), pessoa('rita', 'Rita', { podeBater: false }), pessoa('dani', 'Dani')],
      diaCompleto('ana', '2026-10-16'),
      new Map(),
      comFicha('dani'),
    )
    expect(linhas.map((linha) => linha.funcionario.nome)).toEqual(['Ana', 'Dani'])
  })

  it('cada porta de "quem é do ponto" põe a pessoa na lista: ficha, batida, ausência ou pedido', () => {
    const contas = ['ficha', 'batida', 'ausencia', 'pedido', 'nada'].map((id) => pessoa(id, id))
    const linhas = montarLinhasDoPainel(
      contas,
      diaCompleto('batida', '2026-10-16'),
      new Map([['ausencia', new Map([['2026-10-15', []]])]]),
      { comFichaNoPeriodo: new Set(['ficha']), comPedidoNoPeriodo: new Set(['pedido']) },
    )
    expect(linhas.map((linha) => linha.funcionario.usuarioId).sort()).toEqual(['ausencia', 'batida', 'ficha', 'pedido'])
  })

  it('pedido ou ficha de conta que não está entre as contas entra como linha própria', () => {
    const linhas = montarLinhasDoPainel([], [], new Map(), {
      nomesDeFicha: new Map([['u7', 'Bruna Costa']]),
      comFichaNoPeriodo: new Set(['u7']),
      comPedidoNoPeriodo: new Set(['u8']),
    })
    expect(linhas.map((linha) => linha.funcionario.nome)).toEqual(['Bruna Costa', 'Conta fora da lista do ponto'])
    expect(linhas.every((linha) => linha.funcionario.contaApagada)).toBe(true)
  })

  it('batida de conta que não existe mais entra com o nome congelado na própria linha', () => {
    // A batida não tem, de propósito, chave estrangeira para `auth.users`: ela
    // é prova e sobrevive ao desligamento. Descartá-la aqui faria as horas
    // dela sumirem do fechamento.
    const linhas = montarLinhasDoPainel(
      [pessoa('u1', 'Ana')],
      [
        ...diaCompleto('u1', '2026-08-03'),
        ...diaCompleto('u9', '2026-08-03').map((b) => ({
          ...b,
          funcionario_nome: 'Zé Desligado',
          funcionario_email: 'ze@example.com',
        })),
      ],
    )

    const orfao = linhas.find((linha) => linha.funcionario.usuarioId === 'u9')
    expect(orfao?.funcionario.nome).toBe('Zé Desligado')
    expect(orfao?.funcionario.email).toBe('ze@example.com')
    expect(orfao?.funcionario.contaApagada).toBe(true)
    expect(orfao?.resumo.minutos).toBe(9 * 60)
  })

  it('conta apagada, sem ficha, sem nome nem e-mail congelados ainda aparece, com rótulo honesto', () => {
    const linhas = montarLinhasDoPainel([], diaCompleto('u9', '2026-08-03'))
    expect(linhas[0].funcionario.nome).toBe(SEM_NOME)
    expect(linhas[0].funcionario.temFicha).toBe(false)
  })

  /*
   * A batida sem nome congelado (`funcionario_nome` nulo — a conta não tinha
   * nome guardado quando bateu) leva o nome pela regra única: o da ficha da
   * conta, depois o congelado, depois o e-mail congelado.
   */
  it('batida sem nome congelado: o nome vem da ficha da conta', () => {
    const linhas = montarLinhasDoPainel(
      [],
      diaCompleto('u9', '2026-08-03').map((b) => ({ ...b, funcionario_email: 'daniela@example.com' })),
      new Map(),
      { nomesDeFicha: new Map([['u9', 'Daniela Freitas']]) },
    )
    expect(linhas[0].funcionario.nome).toBe('Daniela Freitas')
    expect(linhas[0].funcionario.temFicha).toBe(true)
    expect(linhas[0].funcionario.contaApagada).toBe(true)
  })

  it('batida sem nome congelado e sem ficha: o nome é o e-mail congelado', () => {
    const linhas = montarLinhasDoPainel(
      [],
      diaCompleto('u9', '2026-08-03').map((b) => ({ ...b, funcionario_email: 'daniela@example.com' })),
    )
    expect(linhas[0].funcionario.nome).toBe('daniela@example.com')
  })

  it('a ficha da conta ganha do nome congelado na batida (o do dono anterior da conta)', () => {
    const linhas = montarLinhasDoPainel(
      [],
      diaCompleto('u9', '2026-08-03').map((b) => ({ ...b, funcionario_nome: 'Vítor Campos' })),
      new Map(),
      { nomesDeFicha: new Map([['u9', 'Ana Beatriz Rocha']]) },
    )
    expect(linhas[0].funcionario.nome).toBe('Ana Beatriz Rocha')
  })

  it('ausência de quem não está na lista sai com o nome da ficha, quando há', () => {
    const ausencia = new Map([['2026-08-03', []]])
    const linhas = montarLinhasDoPainel(
      [],
      [],
      new Map([
        ['u7', ausencia],
        ['u8', ausencia],
      ]),
      { nomesDeFicha: new Map([['u7', 'Bruna Costa']]) },
    )
    expect(linhas.map((linha) => linha.funcionario.nome)).toEqual(['Bruna Costa', 'Conta fora da lista do ponto'])
  })

  it('quem é do ponto e não pode bater aparece — o painel é onde se descobre que falta liberar', () => {
    const linhas = montarLinhasDoPainel(
      [pessoa('u1', 'Ana'), pessoa('u2', 'Bruno', { podeBater: false })],
      diaCompleto('u1', '2026-08-03'),
      new Map(),
      { comPedidoNoPeriodo: new Set(['u2']) },
    )

    const bruno = linhas.find((linha) => linha.funcionario.usuarioId === 'u2')
    expect(bruno).toBeDefined()
    expect(bruno?.funcionario.podeBater).toBe(false)
    expect(bruno?.resumo.diasComBatida).toBe(0)
  })
})

describe('"pode bater": ficha que libera OU super admin (o bate_ponto do banco do ponto)', () => {
  const HOJE = '2026-10-20'
  /** Como `lerContasDoPonto` entrega: ninguém bate até as fichas e os super admins entrarem. */
  const conta = (usuarioId: string, nome: string) => pessoa(usuarioId, nome, { podeBater: false })

  it('com ficha ativa ligada: pode bater, com o nome da ficha', () => {
    const { funcionarios } = juntarGenteEFichas(
      [conta('ana', 'Vítor Campos')],
      [ficha('f1', 'ana', 'Ana Beatriz Rocha')],
      HOJE,
    )
    expect(funcionarios[0]).toMatchObject({ nome: 'Ana Beatriz Rocha', podeBater: true, temFicha: true })
  })

  it('super admin sem ficha bate (só para teste); quem só administra, sem ficha, não', () => {
    const gente = juntarGenteEFichas([conta('sergio', 'Sérgio Almeida'), conta('rita', 'Rita')], [], HOJE, ['sergio'])
    expect(gente.funcionarios.map((f) => [f.usuarioId, f.podeBater])).toEqual([
      ['sergio', true],
      ['rita', false],
    ])
    expect([...gente.batemPonto]).toEqual(['sergio'])
  })

  /*
   * A batida de teste do super admin (o Sérgio, sem ficha): no painel do mês
   * ele aparece com a batida, e NÃO com "sem acesso ao ponto" — o que diria
   * `podeBater` falso.
   */
  it('a batida de teste do super admin aparece como de quem pode bater', () => {
    const gente = juntarGenteEFichas([conta('sergio', 'Sérgio Almeida')], [], HOJE, ['sergio'])
    const linhas = montarLinhasDoPainel(gente.funcionarios, diaCompleto('sergio', '2026-10-20'), new Map(), {
      batemPonto: gente.batemPonto,
    })
    expect(linhas[0].funcionario).toMatchObject({ nome: 'Sérgio Almeida', podeBater: true, temFicha: false })
  })

  it('ficha desativada, desligada antes de hoje ou sem conta não libera; desligada hoje ainda libera', () => {
    const fichas = [
      ficha('f1', 'fernanda', 'Fernanda Teles', { ativo: false, desligamento: '2026-09-15' }),
      ficha('f2', 'saiu', 'Saiu Ontem', { desligamento: '2026-10-19' }),
      ficha('f3', 'sai-hoje', 'Sai Hoje', { desligamento: HOJE }),
      ficha('f4', null, 'Sem Conta'),
    ]
    expect([...contasLiberadasPelaFicha(fichas, HOJE)]).toEqual(['sai-hoje'])
    const { funcionarios } = juntarGenteEFichas(
      ['fernanda', 'saiu', 'sai-hoje'].map((id) => conta(id, id)),
      fichas,
      HOJE,
    )
    expect(funcionarios.map((f) => [f.usuarioId, f.podeBater])).toEqual([
      ['fernanda', false],
      ['saiu', false],
      ['sai-hoje', true],
    ])
    // A ficha que não libera ainda dá o nome: é de quem bateu.
    expect(funcionarios[0].nome).toBe('Fernanda Teles')
  })

  it('no painel, quem bate pela ficha não vai para o fim da lista com quem não pode', () => {
    const gente = juntarGenteEFichas(
      [conta('u1', 'Ana'), conta('u2', 'Bruno'), conta('u3', 'Carla')],
      [ficha('f1', 'u1', 'Ana Ficha'), ficha('f3', 'u3', 'Carla')],
      HOJE,
    )
    const linhas = montarLinhasDoPainel(gente.funcionarios, [], new Map(), {
      ...comFicha('u1', 'u2', 'u3'),
      batemPonto: gente.batemPonto,
    })
    expect(linhas.map((linha) => [linha.funcionario.nome, linha.funcionario.podeBater])).toEqual([
      ['Ana Ficha', true],
      ['Carla', true],
      ['Bruno', false],
    ])
  })

  it('a batida de conta que não existe mais também pode bater pela ficha', () => {
    const linhas = montarLinhasDoPainel([], diaCompleto('u9', '2026-10-16'), new Map(), {
      nomesDeFicha: new Map([['u9', 'Daniela Freitas']]),
      batemPonto: new Set(['u9']),
    })
    expect(linhas[0].funcionario).toMatchObject({ contaApagada: true, podeBater: true })
  })

  it('marcarQuemBate não tira o "pode bater" de ninguém', () => {
    const [ana] = marcarQuemBate([pessoa('u1', 'Ana')], new Set())
    expect(ana.podeBater).toBe(true)
  })
})

describe('a ficha ligada que vale no período (quem é do ponto sem bater)', () => {
  it('ativa, sem desligamento: vale', () => {
    expect(fichaValeNoPeriodo(ficha('f', 'u1', 'Ana'), OUTUBRO)).toBe(true)
  })

  it('sem conta: não põe ninguém no painel', () => {
    expect(fichaValeNoPeriodo(ficha('f', null, 'Lucas'), OUTUBRO)).toBe(false)
  })

  it('desativada sem data de desligamento: não vale', () => {
    expect(fichaValeNoPeriodo(ficha('f', 'u1', 'Ana', { ativo: false }), OUTUBRO)).toBe(false)
  })

  it('desligada (a Fernanda, em 15/09): vale em setembro e não em outubro', () => {
    const fernanda = ficha('f', 'fernanda', 'Fernanda Teles', { ativo: false, desligamento: '2026-09-15' })
    expect(fichaValeNoPeriodo(fernanda, { inicio: '2026-09-01' })).toBe(true)
    expect(fichaValeNoPeriodo(fernanda, OUTUBRO)).toBe(false)
  })

  it('desligada no último dia do mês anterior: fora; no primeiro dia do período: dentro', () => {
    expect(fichaValeNoPeriodo(ficha('f', 'u1', 'A', { desligamento: '2026-09-30' }), OUTUBRO)).toBe(false)
    expect(fichaValeNoPeriodo(ficha('f', 'u1', 'A', { desligamento: '2026-10-01' }), OUTUBRO)).toBe(true)
  })

  it('o conjunto das contas', () => {
    const fichas = [
      ficha('f1', 'u1', 'Ana'),
      ficha('f2', null, 'Sem Conta'),
      ficha('f3', 'fernanda', 'Fernanda Teles', { ativo: false, desligamento: '2026-09-15' }),
    ]
    expect([...contasComFichaNoPeriodo(fichas, OUTUBRO)]).toEqual(['u1'])
    expect([...contasComFichaNoPeriodo(fichas, { inicio: '2026-09-01' })].sort()).toEqual(['fernanda', 'u1'])
  })
})

describe('o nome gravado na batida vem antes do e-mail (ficha → nome da conta → gravado → e-mail)', () => {
  const doLerContas = (usuarioId: string, nomeDaConta: string | null, email: string) =>
    pessoa(usuarioId, nomeDeExibicao({ conta: nomeDaConta, email }), { email, nomeDaConta })

  it('conta sem nome e sem ficha, com nome gravado nas batidas: o gravado, e não o e-mail', () => {
    const linhas = montarLinhasDoPainel(
      [doLerContas('u1', null, 'recepcao@example.com')],
      diaCompleto('u1', '2026-10-16').map((b) => ({ ...b, funcionario_nome: 'Fulana Gravada' })),
    )
    expect(linhas[0].funcionario.nome).toBe('Fulana Gravada')
  })

  it('o gravado nunca ganha do nome guardado hoje nem da ficha', () => {
    const batidas = diaCompleto('u1', '2026-10-16').map((b) => ({ ...b, funcionario_nome: 'Vítor Campos' }))
    const daConta = montarLinhasDoPainel([doLerContas('u1', 'Nome de Hoje', 'ana@example.com')], batidas)
    expect(daConta[0].funcionario.nome).toBe('Nome de Hoje')

    const [comFichaLigada] = comNomesDasFichas(
      [doLerContas('u1', null, 'ana@example.com')],
      new Map([['u1', 'Ana Beatriz Rocha']]),
    )
    expect(montarLinhasDoPainel([comFichaLigada], batidas)[0].funcionario.nome).toBe('Ana Beatriz Rocha')
  })

  it('sem nome gravado: o e-mail continua', () => {
    const linhas = montarLinhasDoPainel([doLerContas('u1', null, 'daniela@example.com')], diaCompleto('u1', '2026-10-16'))
    expect(linhas[0].funcionario.nome).toBe('daniela@example.com')
  })
})

describe('pessoaDoPainel — a tela da pessoa e a folha', () => {
  const HOJE = '2026-10-20'

  it('a conta da lista, com o nome gravado nas batidas dela quando não há ficha nem nome guardado', () => {
    const gente = juntarGenteEFichas([pessoa('u1', 'u1@example.com', { nomeDaConta: null, email: 'u1@example.com' })], [], HOJE)
    const batidas = diaCompleto('u1', '2026-10-16').map((b) => ({ ...b, funcionario_nome: 'Fulana Gravada' }))
    expect(pessoaDoPainel('u1', gente, batidas).nome).toBe('Fulana Gravada')
  })

  it('a conta fora da lista: ficha, nome gravado, e o "pode bater" pela ficha', () => {
    const gente = juntarGenteEFichas([], [ficha('f1', 'u9', 'Daniela Freitas')], HOJE)
    expect(pessoaDoPainel('u9', gente, [])).toMatchObject({ nome: 'Daniela Freitas', contaApagada: true, podeBater: true })

    const semFicha = juntarGenteEFichas([], [], HOJE)
    const batidas = diaCompleto('u8', '2026-10-16').map((b) => ({ ...b, funcionario_nome: 'Zé Desligado' }))
    expect(pessoaDoPainel('u8', semFicha, batidas)).toMatchObject({ nome: 'Zé Desligado', podeBater: false })
  })

  it('batida de outra conta não dá nome a ninguém', () => {
    const gente = juntarGenteEFichas([], [], HOJE)
    const deOutra = diaCompleto('outra', '2026-10-16').map((b) => ({ ...b, funcionario_nome: 'Outra Pessoa' }))
    expect(pessoaDoPainel('u8', gente, deOutra).nome).toBe(SEM_NOME)
  })
})

describe('a conta de cada linha é a do espelho, não outra', () => {
  it('as horas da linha são exatamente as de agruparPorDia', () => {
    // Se algum dia alguém trocar isto por um `sum()` em SQL, este teste morre —
    // e é ele que garante que o painel do patrão e o espelho do funcionário
    // nunca divirjam sobre quantas horas a pessoa trabalhou.
    const batidas = [...diaCompleto('u1', '2026-08-03'), batida('u1', '2026-08-04', '08:00')]
    const linhas = montarLinhasDoPainel([pessoa('u1', 'Ana')], batidas)

    expect(linhas[0].dias).toEqual(agruparPorDia(batidas))
    expect(linhas[0].resumo).toEqual({ minutos: 9 * 60, diasComBatida: 2, diasIncompletos: 1 })
  })

  it('conta quantas batidas do período foram mexidas pelo admin', () => {
    const batidas = diaCompleto('u1', '2026-08-03')
    batidas[3] = { ...batidas[3], ajuste_manual: true, origem: 'ajuste_admin' }

    const linhas = montarLinhasDoPainel([pessoa('u1', 'Ana')], batidas)
    expect(linhas[0].ajustes).toBe(1)
  })

  it('o rodapé soma as pessoas, não os dias duas vezes', () => {
    const linhas = montarLinhasDoPainel(
      [pessoa('u1', 'Ana'), pessoa('u2', 'Bruno'), pessoa('u3', 'Carla')],
      [
        ...diaCompleto('u1', '2026-08-03'),
        ...diaCompleto('u2', '2026-08-03'),
        batida('u2', '2026-08-04', '08:00'),
      ],
      new Map(),
      comFicha('u3'),
    )

    expect(totalizarPainel(linhas)).toEqual({
      minutos: 18 * 60,
      diasComBatida: 3,
      diasIncompletos: 1,
      // Carla não bateu: ela está na lista, mas não conta como pessoa do período.
      pessoas: 2,
    })
  })
})

describe('ordem da lista', () => {
  it('quem trabalhou primeiro; depois quem não bateu; por último quem nem pode', () => {
    const linhas = montarLinhasDoPainel(
      [
        pessoa('u1', 'Zulmira'),
        pessoa('u2', 'Ana'),
        pessoa('u3', 'Bruno', { podeBater: false }),
        pessoa('u4', 'Carla'),
      ],
      diaCompleto('u1', '2026-08-03'),
      new Map(),
      comFicha('u2', 'u3', 'u4'),
    )

    expect(linhas.map((linha) => linha.funcionario.nome)).toEqual([
      'Zulmira', // única com batida
      'Ana', // pode bater, sem batida — alfabética
      'Carla',
      'Bruno', // não pode bater vai para o fim
    ])
  })

  /*
   * O painel com conta sem nome. As contas chegam como `lerContasDoPonto` as
   * entrega (o nome guardado na conta ou, sem ele, o e-mail) e passam por
   * `comNomesDasFichas`, como no painel de verdade (`lerGenteDoPainel`).
   */
  it('em ordem alfabética pelo nome de exibição: a ficha, depois o nome da conta, depois o e-mail', () => {
    const daConta = (usuarioId: string, nomeDaConta: string | null, email: string) =>
      pessoa(usuarioId, nomeDeExibicao({ conta: nomeDaConta, email }), { email, nomeDaConta })
    const funcionarios = comNomesDasFichas(
      [
        daConta('ana', 'Vítor Campos', 'ana@example.com'),
        daConta('daniela', null, 'daniela@example.com'),
        daConta('bruna', 'Bruna Exemplo', 'bruna@example.com'),
        daConta('semficha', null, 'estoque@example.com'),
        daConta('bruno', 'Bruno Conta', 'bruno@example.com'),
      ],
      new Map([
        ['ana', 'Ana Beatriz Rocha'],
        ['daniela', 'Daniela Freitas'],
        ['bruna', 'Bruna Costa'],
      ]),
    )
    const batidas = ['ana', 'daniela', 'bruna', 'semficha', 'bruno'].flatMap((id) => diaCompleto(id, '2026-10-16'))
    const linhas = montarLinhasDoPainel(funcionarios, batidas)

    expect(linhas.map((linha) => linha.funcionario.nome)).toEqual([
      'Ana Beatriz Rocha',
      'Bruna Costa',
      'Bruno Conta',
      'Daniela Freitas',
      'estoque@example.com',
    ])
    // A conta sem nome guardado e com ficha não aparece pelo e-mail.
    expect(linhas.some((linha) => linha.funcionario.nome === 'daniela@example.com')).toBe(false)
    // O nome antigo da conta de função não aparece.
    expect(linhas.some((linha) => linha.funcionario.nome === 'Vítor Campos')).toBe(false)
    expect(linhas.filter((linha) => !linha.funcionario.temFicha).map((linha) => linha.funcionario.usuarioId)).toEqual([
      'bruno',
      'semficha',
    ])
  })

  it('nome com acento não é jogado para o fim do alfabeto', () => {
    const linhas = montarLinhasDoPainel(
      [pessoa('u1', 'Zeca'), pessoa('u2', 'Ácaro'), pessoa('u3', 'Bruno')],
      [],
      new Map(),
      comFicha('u1', 'u2', 'u3'),
    )
    expect(linhas.map((linha) => linha.funcionario.nome)).toEqual(['Ácaro', 'Bruno', 'Zeca'])
  })
})

describe('o indicador de "fora" por pessoa', () => {
  const na = { distancia_metros: 8, no_local: true, precisao_metros: 10 } as const
  const fora = { distancia_metros: 2601, no_local: false, precisao_metros: 12 } as const
  const imprecisa = { distancia_metros: 900, no_local: false, precisao_metros: 1500 } as const

  it('conta, por pessoa, com a régua do espelho — imprecisa e sem coordenada à parte', () => {
    const ana = [
      batida('u1', '2026-10-13', '08:00', { ordem_no_dia: 1, ...na }),
      batida('u1', '2026-10-13', '12:00', { ordem_no_dia: 2, ...fora }),
      batida('u1', '2026-10-13', '13:00', { ordem_no_dia: 3, ...imprecisa }),
      // A inserida pelo admin: sem coordenada porque não houve celular.
      batida('u1', '2026-10-13', '18:00', {
        ordem_no_dia: 4,
        origem: 'ajuste_admin',
        ajuste_manual: true,
        motivo_ajuste: 'Esqueceu a saída',
      }),
    ]
    const bia = [batida('u2', '2026-10-13', '08:00', { ...na })]
    const linhas = montarLinhasDoPainel([pessoa('u1', 'Ana'), pessoa('u2', 'Bia')], [...ana, ...bia])

    expect(linhas.find((l) => l.funcionario.usuarioId === 'u1')?.localizacao).toMatchObject({
      total: 4,
      noLocal: 1,
      fora: 1,
      imprecisas: 1,
      semLocalizacao: 1,
      semGps: 0,
      porcentagemFora: 0.5,
      alerta: true,
    })
    expect(linhas.find((l) => l.funcionario.usuarioId === 'u2')?.localizacao).toMatchObject({
      noLocal: 1,
      fora: 0,
      alerta: false,
    })
  })

  it('a localização não mexe nas horas: o mesmo dia, dentro ou fora, soma igual', () => {
    const dentro = diaCompleto('u1', '2026-10-13').map((b) => ({ ...b, ...na }))
    const longe = diaCompleto('u1', '2026-10-13').map((b) => ({ ...b, ...fora }))
    const [a] = montarLinhasDoPainel([pessoa('u1', 'Ana')], dentro)
    const [b] = montarLinhasDoPainel([pessoa('u1', 'Ana')], longe)
    expect(a.resumo).toEqual(b.resumo)
    expect(b.localizacao.porcentagemFora).toBe(1)
  })

  it('quem não bateu tem resumo vazio, sem porcentagem inventada', () => {
    const [linha] = montarLinhasDoPainel([pessoa('u1', 'Ana')], [], new Map(), comFicha('u1'))
    expect(linha.localizacao).toMatchObject({ total: 0, porcentagemFora: null, alerta: false })
  })
})

/* ------------------------------------------------------------------ */
/* Corrigir o ponto da pessoa sem errar                               */
/* ------------------------------------------------------------------ */

describe('as datas da caixa e do recado', () => {
  it('curta: "sex., 16/10", com o dia da semana e sem depender do Intl', () => {
    expect(diaCurto('2026-10-16')).toBe('sex., 16/10')
    expect(diaCurto('2026-10-17')).toBe('sáb., 17/10')
    expect(diaCurto('2026-10-18')).toBe('dom., 18/10')
    expect(diaCurto('2026-08-03')).toBe('seg., 03/08')
  })

  it('por extenso: "Sexta-feira, 16 de outubro"', () => {
    expect(diaPorExtenso('2026-10-16')).toBe('Sexta-feira, 16 de outubro')
    expect(diaPorExtenso('2026-08-01')).toBe('Sábado, 1 de agosto')
    expect(diaPorExtenso('2026-03-04')).toBe('Quarta-feira, 4 de março')
  })

  it('o campo de data no meio da digitação (ou um dia que não existe) vira texto vazio', () => {
    expect(diaCurto('')).toBe('')
    expect(diaPorExtenso('2026-02-30')).toBe('')
    expect(diaCurto('2026-10')).toBe('')
  })
})

describe('o nome de cada batida na lista do dia', () => {
  const doDia = (...horas: string[]) =>
    calcularDia(
      '2026-10-16',
      horas.map((hora, indice) =>
        batida('u1', '2026-10-16', hora, {
          tipo: (['entrada', 'saida_almoco', 'volta_almoco', 'saida', 'extra'] as const)[Math.min(indice, 4)],
          ordem_no_dia: indice + 1,
        }),
      ),
    )

  it('dia ímpar de antes de hoje: a posição, e a última diz que é a última', () => {
    const dia = doDia('08:00', '12:00', '17:00')
    expect([0, 1, 2].map((indice) => rotuloNaLista(dia, indice))).toEqual([
      '1ª batida',
      '2ª batida',
      '3ª batida (última)',
    ])
  })

  it('dia com uma batida só: "Única batida", e não "1ª batida (última)"', () => {
    expect(rotuloNaLista(doDia('08:00'), 0)).toBe('Única batida')
  })

  it('dia par: o tipo que o banco deu', () => {
    const dia = doDia('08:00', '12:00', '13:00', '17:00')
    expect([0, 1, 2, 3].map((indice) => rotuloNaLista(dia, indice))).toEqual(['Entrada', 'Almoço', 'Volta', 'Saída'])
  })

  it('hoje em andamento, mesmo ímpar: o tipo (a pessoa ainda vai bater)', () => {
    const dia = doDia('08:00', '12:00', '13:00')
    expect([0, 1, 2].map((indice) => rotuloNaLista(dia, indice, true))).toEqual(['Entrada', 'Almoço', 'Volta'])
    expect(rotuloNaLista(doDia('08:00'), 0, true)).toBe('Entrada')
  })
})

describe('a prévia do dia na caixa de inserir', () => {
  const horas = (...lista: string[]) => lista.map((hora) => batida('u1', '2026-10-16', hora))

  it('a que faltou no meio: o dia inteiro pela ordem do relógio, completo, com o total', () => {
    expect(previaDoDia({ dia: '2026-10-16', batidas: horas('08:00', '12:00', '17:00'), novaHora: '13:00' })).toEqual({
      texto:
        'Depois de inserir: 08:00 Entrada · 12:00 Almoço · 13:00 Volta · 17:00 Saída — o dia fica completo e soma 8h00.',
      atencao: false,
    })
  })

  it('a 5ª batida de um dia fechado: a lista se reorganiza pelo relógio e o aviso diz que o dia zera', () => {
    const previa = previaDoDia({
      dia: '2026-10-16',
      batidas: horas('08:00', '12:00', '13:00', '17:00'),
      novaHora: '07:00',
    })
    expect(previa).toEqual({
      texto:
        'Depois de inserir: 07:00 Entrada · 08:00 Almoço · 12:00 Volta · 13:00 Saída · 17:00 Extra — o dia fica com 5 batidas e passa a não somar horas até ter a 6ª.',
      atencao: true,
    })
    // A frase errada: a inserida não "entra como Extra" — o dia se reordena pelo
    // relógio e os tipos andam (aqui, a de 07:00 vira a Entrada).
    expect(previa?.texto).not.toContain('entra como Extra')
  })

  it('a primeira batida de um dia vazio não "zera" nada: só soma com a 2ª', () => {
    expect(previaDoDia({ dia: '2026-10-17', batidas: [], novaHora: '08:00' })).toEqual({
      texto: 'Depois de inserir: 08:00 Entrada — o dia fica com 1 batida e só soma horas quando tiver a 2ª.',
      atencao: true,
    })
  })

  it('a hora que repete uma do dia ganha o aviso, e não uma prévia', () => {
    const previa = previaDoDia({ dia: '2026-10-16', batidas: horas('08:00', '12:00', '17:00'), novaHora: '12:00' })
    expect(previa?.atencao).toBe(true)
    expect(previa?.texto).toContain('Já existe uma batida às 12:00 neste dia')
  })

  it('hora no meio da digitação ou dia inválido: nenhuma prévia', () => {
    expect(previaDoDia({ dia: '2026-10-16', batidas: [], novaHora: '13:' })).toBeNull()
    expect(previaDoDia({ dia: '2026-10-16', batidas: [], novaHora: '' })).toBeNull()
    expect(previaDoDia({ dia: '', batidas: [], novaHora: '13:00' })).toBeNull()
  })
})

describe('a frase do recado', () => {
  it('inserida: hora e dia curto', () => {
    expect(fraseDoRecado({ nome: 'inserida', dia: '2026-10-16', hora: '13:00' })).toBe(
      'Batida das 13:00 inserida em sex., 16/10.',
    )
  })

  it('corrigida no mesmo dia, e corrigida para outro dia', () => {
    expect(
      fraseDoRecado({ nome: 'corrigida', diaAntes: '2026-10-16', horaAntes: '17:00', dia: '2026-10-16', hora: '13:00' }),
    ).toBe('Horário corrigido: 17:00 → 13:00 em sex., 16/10.')
    expect(
      fraseDoRecado({ nome: 'corrigida', diaAntes: '2026-10-16', horaAntes: '17:00', dia: '2026-10-17', hora: '13:00' }),
    ).toBe('Horário corrigido: 17:00 de sex., 16/10 → 13:00 de sáb., 17/10.')
  })

  it('ausência: lançada e cancelada (a palavra da tela)', () => {
    expect(fraseDoRecado({ nome: 'ausencia_lancada' })).toBe('Ausência lançada.')
    expect(fraseDoRecado({ nome: 'ausencia_cancelada' })).toBe('Ausência cancelada.')
  })

  it('com o dia relido: quanto ele soma agora, ou por que não soma', () => {
    const inserida = { nome: 'inserida', dia: '2026-10-16', hora: '13:00' } as const
    const fechado = calcularDia('2026-10-16', [
      batida('u1', '2026-10-16', '08:00'),
      batida('u1', '2026-10-16', '12:00'),
      batida('u1', '2026-10-16', '13:00'),
      batida('u1', '2026-10-16', '17:00'),
    ])
    expect(fraseDoRecado(inserida, fechado)).toBe('Batida das 13:00 inserida em sex., 16/10. O dia agora soma 8h00.')

    const impar = calcularDia('2026-10-16', [
      batida('u1', '2026-10-16', '08:00'),
      batida('u1', '2026-10-16', '12:00'),
      batida('u1', '2026-10-16', '13:00'),
    ])
    expect(fraseDoRecado(inserida, impar)).toBe(
      'Batida das 13:00 inserida em sex., 16/10. O dia agora tem 3 batidas e não soma horas até ter a 4ª.',
    )
    // Ainda relendo (`undefined`) ou dia que ficou sem batida (`null`): só a primeira frase.
    expect(fraseDoRecado(inserida)).toBe('Batida das 13:00 inserida em sex., 16/10.')
    expect(fraseDoRecado(inserida, null)).toBe('Batida das 13:00 inserida em sex., 16/10.')
  })
})

/* ------------------------------------------------------------------ */
/* Fechar o mês sem surpresa                                          */
/* ------------------------------------------------------------------ */

/** A empresa com tudo preenchido, e a mesma sem um campo. */
const EMPRESA: DadosDaEmpresa = {
  razaoSocial: 'Empresa Exemplo Ltda',
  nomeFantasia: 'Empresa Exemplo',
  cnpj: '11222333000181',
  endereco: 'Rua das Flores, 100',
  cidade: 'Campinas',
  uf: 'SP',
}
const SEM_CNPJ: DadosDaEmpresa = { ...EMPRESA, cnpj: null }
const MES_DE_OUTUBRO = { inicio: '2026-10-01', fim: '2026-10-31' }
/** Um dia de outubro depois dos dias dos testes: "hoje" não cai em nenhum deles. */
const DEPOIS = '2026-10-21'

describe('as palavras do fechamento', () => {
  it('primeiro nome e "a, b e c"', () => {
    expect(primeiroNome('Ana Souza')).toBe('Ana')
    expect(primeiroNome('  Daniela Freitas ')).toBe('Daniela')
    expect(juntarComE([])).toBe('')
    expect(juntarComE(['CNPJ'])).toBe('CNPJ')
    expect(juntarComE(['CNPJ', 'UF'])).toBe('CNPJ e UF')
    expect(juntarComE(['razão social', 'CNPJ', 'UF'])).toBe('razão social, CNPJ e UF')
  })
})

describe('o bloco "Antes de fechar" do painel', () => {
  const ana = pessoa('u-ana', 'Ana Souza')
  const bia = pessoa('u-bia', 'Bia Lima')
  /** A Ana com o dia 16/10 ímpar (faltou a volta do almoço); a Bia com o dia 15 completo. */
  const linhas = () =>
    montarLinhasDoPainel(
      [ana, bia],
      [
        batida('u-ana', '2026-10-16', '08:00'),
        batida('u-ana', '2026-10-16', '12:00'),
        batida('u-ana', '2026-10-16', '17:00'),
        ...diaCompleto('u-bia', '2026-10-15'),
      ],
    )
  const pedido = (dia: string) => ({ dia_civil: dia })

  it('com dia ímpar, 2 pedidos e cabeçalho sem CNPJ: os três itens, cada um com o link que resolve', () => {
    const bloco = pendenciasDoFechamento({
      periodo: MES_DE_OUTUBRO,
      linhas: linhas(),
      pedidos: [pedido('2026-10-16'), pedido('2026-10-20')],
      empresa: SEM_CNPJ,
      hoje: DEPOIS,
    })
    expect(bloco.titulo).toBe('Antes de fechar outubro de 2026')
    expect(bloco.itens.map(({ texto, acao }) => [texto, acao])).toEqual([
      ['2 pedidos de batida em atraso esperando decisão', 'Decidir'],
      ['Ana Souza · sex., 16/10 · falta 1 batida', 'Corrigir'],
      ['Cabeçalho da folha sem CNPJ', 'Preencher'],
    ])
    expect(bloco.itens[0].destino).toBe('#pendencias-de-atraso')
    // O link do dia leva à tela da pessoa, no mesmo período, já no dia.
    expect(bloco.itens[1].destino).toBe('/painel/u-ana?de=2026-10-01&ate=2026-10-31#dia-2026-10-16')
    expect(bloco.itens[1].destino.endsWith('#dia-2026-10-16')).toBe(true)
    expect(bloco.itens[2].destino).toBe('/administracao#secao-empresa')
    expect(bloco.semPendencias).toBeNull()
  })

  it('sem pendência: a frase diz o que foi conferido e o que não foi — sem prometer "tudo certo"', () => {
    const bloco = pendenciasDoFechamento({
      periodo: MES_DE_OUTUBRO,
      linhas: montarLinhasDoPainel([bia], diaCompleto('u-bia', '2026-10-15')),
      pedidos: [],
      empresa: EMPRESA,
      hoje: DEPOIS,
    })
    expect(bloco.itens).toEqual([])
    expect(bloco.semPendencias).toBe(
      'Nenhum dia incompleto e nenhum pedido esperando em outubro de 2026. Dias sem nenhuma batida não entram nesta conferência.',
    )
    expect(bloco.notaDeHoje).toBeNull()
  })

  it('o dia de hoje ímpar não é pendência (a pessoa ainda pode bater), e a nota explica', () => {
    const bloco = pendenciasDoFechamento({
      periodo: MES_DE_OUTUBRO,
      linhas: montarLinhasDoPainel([ana], [batida('u-ana', DEPOIS, '08:00')]),
      pedidos: [],
      empresa: EMPRESA,
      hoje: DEPOIS,
    })
    expect(bloco.itens).toEqual([])
    expect(bloco.semPendencias).toContain('Nenhum dia incompleto')
    expect(bloco.notaDeHoje).toContain('Hoje não entra nesta lista')
  })

  it('pedido de outro período não entra: ele não muda esta folha (e continua na caixa de pendências)', () => {
    const bloco = pendenciasDoFechamento({
      periodo: MES_DE_OUTUBRO,
      linhas: [],
      pedidos: [pedido('2026-09-30')],
      empresa: EMPRESA,
      hoje: DEPOIS,
    })
    expect(bloco.itens).toEqual([])
    expect(bloco.semPendencias).toContain('nenhum pedido esperando em outubro de 2026')
  })

  it('1 pedido no singular', () => {
    const bloco = pendenciasDoFechamento({ periodo: MES_DE_OUTUBRO, linhas: [], pedidos: [pedido('2026-10-02')], empresa: EMPRESA, hoje: DEPOIS })
    expect(bloco.itens.map((item) => item.texto)).toEqual(['1 pedido de batida em atraso esperando decisão'])
  })

  it('sem a leitura dos pedidos (null), a frase não fala de pedido; sem a da empresa (undefined), o bloco não fala do cabeçalho', () => {
    const bloco = pendenciasDoFechamento({ periodo: MES_DE_OUTUBRO, linhas: [], pedidos: null, empresa: undefined, hoje: DEPOIS })
    expect(bloco.itens).toEqual([])
    expect(bloco.semPendencias).toBe(
      'Nenhum dia incompleto em outubro de 2026. Dias sem nenhuma batida não entram nesta conferência.',
    )
  })

  it('sem configuração gravada (null), o cabeçalho está em branco', () => {
    const bloco = pendenciasDoFechamento({ periodo: MES_DE_OUTUBRO, linhas: [], pedidos: [], empresa: null, hoje: DEPOIS })
    expect(bloco.itens.map((item) => item.texto)).toEqual([
      'Cabeçalho da folha em branco: os dados da empresa não foram preenchidos',
    ])
  })

  it('período que não é um mês inteiro: as datas no lugar do mês', () => {
    const bloco = pendenciasDoFechamento({
      periodo: { inicio: '2026-10-01', fim: '2026-10-15' },
      linhas: [],
      pedidos: [],
      empresa: EMPRESA,
      hoje: DEPOIS,
    })
    expect(bloco.titulo).toBe('Antes de fechar 01/10/2026 a 15/10/2026')
    expect(bloco.semPendencias).toContain('em 01/10/2026 a 15/10/2026.')
  })
})

describe('os avisos da folha', () => {
  const linha = (dia: string, incompleto: boolean) => ({ dia, incompleto })

  it('dia incompleto, pedido desta pessoa e cabeçalho sem CNPJ: três avisos, com os links', () => {
    const avisos = avisosDaFolha({
      usuarioId: 'u-ana',
      mes: '2026-10',
      linhas: [linha('2026-10-15', false), linha('2026-10-16', true)],
      pedidos: [{ usuario_id: 'u-ana', dia_civil: '2026-10-16' }],
      empresa: SEM_CNPJ,
      hoje: DEPOIS,
    })
    expect(avisos.map((aviso) => aviso.texto)).toEqual([
      'Atenção: 1 dia incompleto (16/10) sai como zero nesta folha.',
      '1 pedido de batida em atraso desta pessoa ainda espera decisão.',
      'Cabeçalho da folha sem CNPJ: esse campo sai em branco.',
    ])
    expect(avisos[0].links).toEqual([
      { rotulo: 'Corrigir 16/10', destino: '/painel/u-ana?de=2026-10-01&ate=2026-10-31#dia-2026-10-16' },
    ])
    expect(avisos[1].links).toEqual([
      { rotulo: 'Decidir', destino: '/painel/u-ana?de=2026-10-01&ate=2026-10-31#pedidos-esperando' },
    ])
    expect(avisos[2].links).toEqual([{ rotulo: 'Preencher', destino: '/administracao#secao-empresa' }])
  })

  it('dois dias incompletos no plural, cada um com o seu link', () => {
    const avisos = avisosDaFolha({
      usuarioId: 'u-ana',
      mes: '2026-10',
      linhas: [linha('2026-10-14', true), linha('2026-10-16', true)],
      pedidos: [],
      empresa: EMPRESA,
      hoje: DEPOIS,
    })
    expect(avisos.map((aviso) => aviso.texto)).toEqual([
      'Atenção: 2 dias incompletos (14/10 e 16/10) saem como zero nesta folha.',
    ])
    expect(avisos[0].links.map((link) => link.rotulo)).toEqual(['Corrigir 14/10', 'Corrigir 16/10'])
  })

  it('sem nada: nenhum aviso — hoje ímpar, pedido de outra pessoa e pedido de outro mês não contam', () => {
    expect(
      avisosDaFolha({
        usuarioId: 'u-ana',
        mes: '2026-10',
        linhas: [linha('2026-10-15', false), linha(DEPOIS, true)],
        pedidos: [
          { usuario_id: 'u-bia', dia_civil: '2026-10-16' },
          { usuario_id: 'u-ana', dia_civil: '2026-09-30' },
        ],
        empresa: EMPRESA,
        hoje: DEPOIS,
      }),
    ).toEqual([])
  })

  it('cabeçalho com mais de um campo faltando, e em branco', () => {
    const doisCampos = avisosDaFolha({
      usuarioId: 'u-ana',
      mes: '2026-10',
      linhas: [],
      pedidos: [],
      empresa: { ...EMPRESA, cnpj: null, uf: null },
      hoje: DEPOIS,
    })
    expect(doisCampos.map((aviso) => aviso.texto)).toEqual(['Cabeçalho da folha sem CNPJ e UF: esses campos saem em branco.'])
    const emBranco = avisosDaFolha({ usuarioId: 'u-ana', mes: '2026-10', linhas: [], pedidos: [], empresa: null, hoje: DEPOIS })
    expect(emBranco.map((aviso) => aviso.texto)).toEqual(['Cabeçalho da folha em branco: a folha sai sem os dados da empresa.'])
  })
})

describe('como o dia fica com a aprovação do pedido', () => {
  const horas = (...lista: string[]) => lista.map((hora) => batida('u1', '2026-10-16', hora))

  it('a que faltou: o dia como está e como fica, completo, com o total', () => {
    expect(previaDaAprovacao({ dia: '2026-10-16', batidas: horas('08:00', '12:00', '17:00'), hora: '13:00', hoje: DEPOIS })).toEqual({
      agora: 'Neste dia já tem: 08:00 · 12:00 · 17:00 (dia incompleto)',
      depois: 'Com a aprovação: 4 batidas, 8h00.',
      atencao: false,
    })
  })

  it('num dia fechado, a aprovação deixa o dia com 5 batidas e sem horas — e não "cria uma extra"', () => {
    const previa = previaDaAprovacao({
      dia: '2026-10-16',
      batidas: horas('08:00', '12:00', '13:00', '17:00'),
      hora: '13:05',
      hoje: DEPOIS,
    })
    expect(previa).toEqual({
      agora: 'Neste dia já tem: 08:00 · 12:00 · 13:00 · 17:00 (8h00)',
      depois: 'Aprovar deixa o dia com 5 batidas: incompleto, sem horas.',
      atencao: true,
    })
    expect(previa?.depois).not.toMatch(/extra/i)
  })

  it('a batida já inserida à mão no mesmo minuto: o aviso de batida dobrada', () => {
    const previa = previaDaAprovacao({ dia: '2026-10-16', batidas: horas('08:00', '13:05'), hora: '13:05', hoje: DEPOIS })
    expect(previa?.atencao).toBe(true)
    expect(previa?.depois).toBe('Já existe uma batida às 13:05 neste dia: confira se não é a mesma antes de aprovar.')
  })

  it('o dia vazio, e o de hoje (em andamento, sem alarme)', () => {
    expect(previaDaAprovacao({ dia: '2026-10-16', batidas: [], hora: '08:00', hoje: DEPOIS })).toEqual({
      agora: 'Neste dia ainda não há batida.',
      depois: 'Aprovar deixa o dia com 1 batida: incompleto, sem horas.',
      atencao: true,
    })
    expect(previaDaAprovacao({ dia: DEPOIS, batidas: [], hora: '08:00', hoje: DEPOIS })).toEqual({
      agora: 'Neste dia ainda não há batida.',
      depois: 'Com a aprovação, o dia fica com 1 batida (ainda em andamento).',
      atencao: false,
    })
  })

  it('hora ou dia inválidos: nenhuma prévia', () => {
    expect(previaDaAprovacao({ dia: '2026-10-16', batidas: [], hora: '13:' })).toBeNull()
    expect(previaDaAprovacao({ dia: '', batidas: [], hora: '13:00' })).toBeNull()
  })
})

describe('o recado da decisão na tela da pessoa', () => {
  it('aprovado: a hora, o dia e, relido, quanto o dia soma; recusado: só a hora', () => {
    const aprovado = { nome: 'pedido_aprovado', dia: '2026-10-16', hora: '13:05' } as const
    expect(fraseDoRecado(aprovado)).toBe('Pedido das 13:05 aprovado: a batida entrou em sex., 16/10.')
    const fechado = calcularDia('2026-10-16', [
      batida('u1', '2026-10-16', '08:00'),
      batida('u1', '2026-10-16', '12:00'),
      batida('u1', '2026-10-16', '13:05'),
      batida('u1', '2026-10-16', '17:05'),
    ])
    expect(fraseDoRecado(aprovado, fechado)).toBe(
      'Pedido das 13:05 aprovado: a batida entrou em sex., 16/10. O dia agora soma 8h00.',
    )
    expect(fraseDoRecado({ nome: 'pedido_recusado', hora: '13:05' })).toBe('Pedido das 13:05 recusado.')
  })
})
