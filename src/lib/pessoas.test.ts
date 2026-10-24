import { describe, expect, it } from 'vitest'
import type { BatidaDoAdmin } from './formato'
import type { FuncionarioDoPainel } from './painel'
import type { FichaDoFuncionario } from './cadastro'
import {
  ACOES_DO_SUPER_ADMIN,
  acoesDaPessoa,
  acoesGerais,
  contasSemFicha,
  fichaLiberaAcesso,
  filtrarPessoas,
  montarPessoas,
  quemEhOSuperAdmin,
  RESERVA_DO_SUPER_ADMIN,
  resumirPessoas,
  ROTULO_SO_ADMINISTRA,
  semAcessoPendente,
  situacaoDoPin,
  soAdministra,
  textoDoAcesso,
  type ConcessaoDeAdministracao,
  type EstadoDoPin,
  type PessoaDaAdministracao,
} from './pessoas'

/*
 * A LISTA DE PESSOAS DA ÁREA DE ADMINISTRAÇÃO.
 *
 * Dois cenários têm teste nomeado porque são exatamente os que erram
 * CALADOS:
 *
 *  • "a conta apagada aparece marcada e não é elegível a administrar" — se
 *    `elegivelParaAdministrar` viesse `true` por engano, a tela desenharia o
 *    botão de conceder e a recusa só apareceria depois do clique, vinda da FK
 *    para `auth.users`, em linguagem de banco;
 *  • "sem PIN, com PIN e bloqueado produzem três rótulos distintos, e o
 *    bloqueado mostra o momento em que expira" — um bloqueio VENCIDO mostrado
 *    como ativo faria alguém resetar o PIN de quem já podia bater, e um bloqueio
 *    ATIVO mostrado como "PIN definido" faria a pessoa esperar sem saber até
 *    quando.
 *
 * O relógio é sempre injetado. Um teste de bloqueio que chama `Date.now()` passa
 * hoje e falha em quinze minutos.
 */

/** 04/09/2026 12:00 em Campinas (UTC-3). */
const AGORA = Date.parse('2026-09-04T15:00:00.000Z')

function pessoa(
  usuarioId: string,
  nome: string,
  extras: Partial<FuncionarioDoPainel> = {},
): FuncionarioDoPainel {
  // Como `lerContasDoPonto` entrega (`ponto_contas()`): o acesso sai das
  // fichas, da administração e dos super admins, em `montarPessoas`.
  return {
    usuarioId,
    nome,
    nomeDaConta: nome,
    email: `${usuarioId}@example.com`,
    podeBater: false,
    contaApagada: false,
    temFicha: false,
    ...extras,
  }
}

function concessao(usuarioId: string): ConcessaoDeAdministracao {
  return {
    usuarioId,
    concedidoPor: 'sergio',
    concedidoEm: '2026-09-01T12:00:00.000Z',
    observacao: null,
  }
}

function pin(usuarioId: string, extras: Partial<EstadoDoPin> = {}): EstadoDoPin {
  return { usuarioId, temPin: true, precisaRedefinir: false, bloqueadoAte: null, ...extras }
}

function batida(usuarioId: string, extras: Partial<BatidaDoAdmin> = {}): BatidaDoAdmin {
  return {
    id: `${usuarioId}-${Math.random()}`,
    usuario_id: usuarioId,
    registrado_em: '2026-09-04T11:00:00.000Z',
    dia_civil: '2026-09-04',
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
    funcionario_nome: 'Nome congelado',
    funcionario_email: 'congelado@example.com',
    ...extras,
  } as BatidaDoAdmin
}

/** O dia civil de AGORA em Campinas. */
const HOJE = '2026-09-04'

function ficha(id: string, extras: Partial<FichaDoFuncionario> = {}): FichaDoFuncionario {
  return {
    id,
    usuarioId: null,
    nomeCompleto: `Ficha ${id}`,
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

function montar(entrada: {
  funcionarios?: FuncionarioDoPainel[]
  administradores?: ConcessaoDeAdministracao[]
  estadosDoPin?: EstadoDoPin[]
  batidas?: BatidaDoAdmin[]
  fichas?: FichaDoFuncionario[]
  superAdmins?: string[]
}) {
  return montarPessoas({
    funcionarios: entrada.funcionarios ?? [],
    administradores: entrada.administradores ?? [],
    estadosDoPin: entrada.estadosDoPin ?? [],
    batidas: entrada.batidas ?? [],
    fichas: entrada.fichas ?? [],
    superAdmins: entrada.superAdmins ?? [],
    hoje: HOJE,
    agora: AGORA,
  })
}

/* ------------------------------------------------------------------ */

describe('situacaoDoPin — os três rótulos', () => {
  it('sem linha em ponto_pin é "sem PIN"', () => {
    const situacao = situacaoDoPin(undefined, AGORA)
    expect(situacao.estado).toBe('sem-pin')
    expect(situacao.texto).toContain('sem PIN')
  })

  it('com PIN, sem trava e sem reset é "com PIN"', () => {
    expect(situacaoDoPin(pin('a'), AGORA).estado).toBe('com-pin')
  })

  it('trava no futuro é "bloqueado" e mostra o momento em que expira', () => {
    const ate = '2026-09-04T15:12:00.000Z' // 12:12 em Campinas, doze minutos à frente
    const situacao = situacaoDoPin(pin('a', { bloqueadoAte: ate }), AGORA)

    expect(situacao.estado).toBe('bloqueado')
    if (situacao.estado !== 'bloqueado') throw new Error('rótulo errado')
    expect(situacao.bloqueadoAte).toBe(ate)
    /*
     * O momento, no fuso do ponto, dentro da frase — é ele que diz à pessoa até
     * quando esperar. Data e hora são conferidas SEPARADAS de propósito:
     * `formatarMomento` usa `Intl`, e o separador entre as duas
     * ("04/09/2026 12:12" ou "04/09/2026, 12:12") muda com a versão do ICU.
     * Cravar o separador faria a suíte quebrar numa atualização do Node por um
     * motivo que não é o do teste.
     */
    expect(situacao.texto).toContain('04/09/2026')
    expect(situacao.texto).toContain('12:12')
  })

  it('os três rótulos são de fato distintos', () => {
    const rotulos = [
      situacaoDoPin(undefined, AGORA),
      situacaoDoPin(pin('a'), AGORA),
      situacaoDoPin(pin('a', { bloqueadoAte: '2026-09-04T15:12:00.000Z' }), AGORA),
    ]
    expect(new Set(rotulos.map((r) => r.estado)).size).toBe(3)
    expect(new Set(rotulos.map((r) => r.texto)).size).toBe(3)
  })

  it('trava JÁ VENCIDA não é trava — volta a ser "com PIN"', () => {
    // 11:55 em Campinas, cinco minutos ATRÁS. A função do banco devolve
    // `bloqueado_ate` cru, e é aqui que a comparação com o relógio acontece.
    const situacao = situacaoDoPin(pin('a', { bloqueadoAte: '2026-09-04T14:55:00.000Z' }), AGORA)
    expect(situacao.estado).toBe('com-pin')
  })

  it('reset pedido pelo admin conta como "sem PIN", com texto próprio', () => {
    const situacao = situacaoDoPin(pin('a', { precisaRedefinir: true }), AGORA)
    // A pessoa tem linha em ponto_pin, mas `RotaProtegida` a manda para
    // /definir-pin na próxima entrada — que é o que "sem PIN" significa na tela.
    expect(situacao.estado).toBe('sem-pin')
    expect(situacao.texto).toContain('reset')
  })

  it('a trava vence antes do reset quando os dois aparecem juntos', () => {
    // Hoje isso não acontece — `ponto_resetar_pin` limpa `bloqueado_ate` no
    // mesmo UPDATE que liga `precisa_redefinir`. O teste fixa a precedência
    // para o dia em que alguém mexer numa das duas pontas.
    const situacao = situacaoDoPin(
      pin('a', { precisaRedefinir: true, bloqueadoAte: '2026-09-04T15:12:00.000Z' }),
      AGORA,
    )
    expect(situacao.estado).toBe('bloqueado')
  })
})

describe('montarPessoas — quem entra na lista', () => {
  it('conta sem batida, sem PIN e sem administração entra zerada', () => {
    const lista = montar({ funcionarios: [pessoa('a', 'Ana')] })

    expect(lista).toHaveLength(1)
    expect(lista[0].batidas).toBe(0)
    expect(lista[0].administra).toBe(false)
    expect(lista[0].pin?.estado).toBe('sem-pin')
    expect(lista[0].elegivelParaAdministrar).toBe(true)
  })

  it('conta o número de batidas do período por pessoa', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana'), pessoa('b', 'Bruno')],
      batidas: [batida('a'), batida('a'), batida('a'), batida('b')],
    })

    expect(lista.find((p) => p.usuarioId === 'a')?.batidas).toBe(3)
    expect(lista.find((p) => p.usuarioId === 'b')?.batidas).toBe(1)
  })

  it('quem está na lista de administradores aparece marcado, com a concessão', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      administradores: [concessao('a')],
    })

    expect(lista[0].administra).toBe(true)
    expect(lista[0].concessao?.concedidoPor).toBe('sergio')
  })

  /* O primeiro cenário do cabeçalho. */
  it('quem tem batida mas a conta não existe mais aparece marcado e NÃO é elegível a administrar', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      batidas: [batida('desligado', { funcionario_nome: 'Carlos Desligado' })],
    })

    const orfao = lista.find((p) => p.usuarioId === 'desligado')
    expect(orfao).toBeDefined()
    expect(orfao?.contaApagada).toBe(true)
    expect(orfao?.elegivelParaAdministrar).toBe(false)
    // O nome vem congelado na batida: ela guarda o nome de quem bateu.
    expect(orfao?.nome).toBe('Carlos Desligado')
    expect(orfao?.batidas).toBe(1)
  })

  it('a concessão de administração de uma conta fora da lista aparece — senão ninguém a revoga', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      administradores: [concessao('fantasma')],
    })

    const fantasma = lista.find((p) => p.usuarioId === 'fantasma')
    expect(fantasma).toBeDefined()
    expect(fantasma?.administra).toBe(true)
    expect(fantasma?.contaApagada).toBe(true)
    expect(fantasma?.elegivelParaAdministrar).toBe(false)
  })

  it('a mesma conta órfã com batida E concessão entra uma vez só', () => {
    const lista = montar({
      administradores: [concessao('x')],
      batidas: [batida('x')],
    })

    expect(lista.filter((p) => p.usuarioId === 'x')).toHaveLength(1)
  })

  it('a conta sem ficha e sem administração entra, porque ligar a ficha é ação desta tela', () => {
    const lista = montar({ funcionarios: [pessoa('a', 'Ana')] })

    expect(lista).toHaveLength(1)
    expect(lista[0].acesso).toBeNull()
    // A conta existe, então pode receber administração do ponto.
    expect(lista[0].elegivelParaAdministrar).toBe(true)
  })

  it('o estado do PIN de cada pessoa é o dela, e não o da primeira da lista', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana'), pessoa('b', 'Bruno'), pessoa('c', 'Célia')],
      estadosDoPin: [
        pin('a'),
        pin('b', { bloqueadoAte: '2026-09-04T15:12:00.000Z' }),
        // 'c' não tem linha: sem PIN.
      ],
    })

    expect(lista.find((p) => p.usuarioId === 'a')?.pin?.estado).toBe('com-pin')
    expect(lista.find((p) => p.usuarioId === 'b')?.pin?.estado).toBe('bloqueado')
    expect(lista.find((p) => p.usuarioId === 'c')?.pin?.estado).toBe('sem-pin')
  })
})

describe('montarPessoas — a ordem', () => {
  it('administradores primeiro, depois quem está sem acesso, depois o resto', () => {
    const lista = montar({
      funcionarios: [pessoa('z', 'Zuleica'), pessoa('n', 'Nadia'), pessoa('a', 'Ana')],
      administradores: [concessao('z')],
      fichas: [ficha('fz', { usuarioId: 'z', nomeCompleto: 'Zuleica' }), ficha('fa', { usuarioId: 'a', nomeCompleto: 'Ana' })],
    })

    expect(lista.map((p) => p.nome)).toEqual(['Zuleica', 'Nadia', 'Ana'])
  })

  it('dentro de cada grupo a ordem é alfabética, e acento não vai para o fim', () => {
    const lista = montar({
      funcionarios: [pessoa('c', 'Cida'), pessoa('a', 'Ângela'), pessoa('b', 'Beto')],
    })

    expect(lista.map((p) => p.nome)).toEqual(['Ângela', 'Beto', 'Cida'])
  })
})

describe('filtrarPessoas', () => {
  const lista = montar({
    funcionarios: [
      pessoa('a', 'José da Silva', { email: 'jose@example.com' }),
      pessoa('b', 'Maria Souza', { email: 'maria@example.com' }),
      pessoa('c', 'Sem e-mail', { email: null }),
    ],
  })

  it('busca vazia devolve a lista inteira', () => {
    expect(filtrarPessoas(lista, '   ')).toHaveLength(3)
  })

  it('acha por nome sem acento e sem caixa', () => {
    expect(filtrarPessoas(lista, 'jose').map((p) => p.nome)).toEqual(['José da Silva'])
    expect(filtrarPessoas(lista, 'JOSÉ').map((p) => p.nome)).toEqual(['José da Silva'])
  })

  it('acha por e-mail', () => {
    expect(filtrarPessoas(lista, 'maria@').map((p) => p.nome)).toEqual(['Maria Souza'])
  })

  it('quem não tem e-mail não quebra a busca', () => {
    expect(filtrarPessoas(lista, 'sem e')).toHaveLength(1)
    expect(filtrarPessoas(lista, 'zzz')).toHaveLength(0)
  })
})

describe('resumirPessoas', () => {
  it('conta administradores, quem está sem acesso, quem está sem PIN e quem está travado', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana'), pessoa('b', 'Bruno'), pessoa('c', 'Célia')],
      administradores: [concessao('a')],
      fichas: [ficha('fa', { usuarioId: 'a' }), ficha('fc', { usuarioId: 'c' })],
      estadosDoPin: [
        pin('a'),
        // Bruno já entrou no ponto um dia e o admin pediu reset — mas hoje ele
        // não tem acesso: a pendência dele é o acesso, e não o PIN.
        pin('b', { precisaRedefinir: true }),
        pin('c', { bloqueadoAte: '2026-09-04T15:12:00.000Z' }),
      ],
    })

    expect(resumirPessoas(lista)).toEqual({
      total: 3,
      administradores: 1,
      // Bruno: sem ficha e sem administrar — "sem acesso ao ponto".
      semAcesso: 1,
      semPin: 0, // Célia está bloqueada, que é outro rótulo; Bruno não entra
      bloqueados: 1,
      fichasSemConta: 0,
      naoBatemAqui: 2,
    })
  })

  it('conta apagada não conta como "sem acesso" nem "sem PIN" — não há como liberá-la', () => {
    const lista = montar({ batidas: [batida('desligado')] })

    const resumo = resumirPessoas(lista)
    expect(resumo.total).toBe(1)
    expect(resumo.semAcesso).toBe(0)
    expect(resumo.semPin).toBe(0)
  })

  /*
   * Quem só administra (o RH — aqui, a Rita) entra no app e não bate — não é
   * "sem acesso" nem "sem PIN". O super admin bate (teste): o PIN dele conta.
   */
  it('quem só administra não conta como "sem acesso" nem "sem PIN"; o super admin sem PIN conta', () => {
    const lista = montar({
      funcionarios: [pessoa('rita', 'Rita'), pessoa('sergio', 'Sérgio')],
      administradores: [concessao('rita')],
      superAdmins: ['sergio'],
    })
    expect(resumirPessoas(lista)).toMatchObject({ total: 2, administradores: 2, semAcesso: 0, semPin: 1 })
  })

  it('a conta com a ficha desligada (a Fernanda) ficou sem acesso de propósito: não é pendência', () => {
    const lista = montar({
      funcionarios: [pessoa('fernanda', 'Fernanda')],
      fichas: [ficha('ff', { usuarioId: 'fernanda', ativo: false, desligamento: '2026-08-29' })],
    })
    expect(lista[0].acesso).toBeNull()
    expect(semAcessoPendente(lista[0])).toBe(false)
    expect(resumirPessoas(lista)).toMatchObject({ semAcesso: 0, semPin: 0 })
  })
})

/* ------------------------------------------------------------------ */
/* Pessoas numa tela só                                               */
/* ------------------------------------------------------------------ */

describe('fichaLiberaAcesso — a mesma regra de ponto_ficha_libera_acesso', () => {
  it('ativa, ligada e sem desligamento: libera', () => {
    expect(fichaLiberaAcesso(ficha('f', { usuarioId: 'a' }), HOJE)).toBe(true)
  })

  it('no dia do desligamento ainda libera (a pessoa bate a saída); no dia seguinte, não', () => {
    expect(fichaLiberaAcesso(ficha('f', { usuarioId: 'a', desligamento: HOJE }), HOJE)).toBe(true)
    expect(fichaLiberaAcesso(ficha('f', { usuarioId: 'a', desligamento: '2026-09-03' }), HOJE)).toBe(false)
  })

  it('desativada ou sem conta não libera', () => {
    expect(fichaLiberaAcesso(ficha('f', { usuarioId: 'a', ativo: false }), HOJE)).toBe(false)
    expect(fichaLiberaAcesso(ficha('f'), HOJE)).toBe(false)
  })
})

describe('montarPessoas — a junção pessoa + conta + ficha + admin + PIN', () => {
  it('a conta ganha a ficha ligada a ela, e o acesso vem da ficha', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      fichas: [ficha('fa', { usuarioId: 'a', cargo: 'Vendas' })],
    })

    expect(lista).toHaveLength(1)
    expect(lista[0].ficha?.id).toBe('fa')
    expect(lista[0].fichasDaConta).toBe(1)
    expect(lista[0].acesso).toBe('ficha')
    expect(textoDoAcesso(lista[0])).toBe('bate ponto pela ficha')
  })

  it('administra e tem ficha: a origem é a ficha, como ponto_meu_acesso', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      administradores: [concessao('a')],
      fichas: [ficha('fa', { usuarioId: 'a' })],
    })
    expect(lista[0].acesso).toBe('ficha')
    expect(soAdministra(lista[0])).toBe(false)
  })

  it('sem ficha: administra ou super admin, origem "administracao"; sem nada, sem acesso', () => {
    const lista = montar({
      funcionarios: [pessoa('rita', 'Rita'), pessoa('sergio', 'Sérgio'), pessoa('b', 'Bruno')],
      administradores: [concessao('rita')],
      superAdmins: ['sergio'],
    })
    const de = (id: string) => lista.find((p) => p.usuarioId === id) as PessoaDaAdministracao
    expect(de('rita').acesso).toBe('administracao')
    expect(de('sergio').acesso).toBe('administracao')
    expect(de('b').acesso).toBeNull()
  })

  it('ficha desligada no passado não libera: sem administrar, a pessoa fica sem acesso', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      fichas: [ficha('fa', { usuarioId: 'a', desligamento: '2026-08-31' })],
    })
    expect(lista[0].ficha?.id).toBe('fa')
    expect(lista[0].acesso).toBeNull()
  })

  it('a ficha SEM CONTA entra como pessoa sem conta: sem PIN, sem batidas, sem acesso', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      fichas: [ficha('fx', { nomeCompleto: 'Carlos Pereira' })],
    })

    const semConta = lista.find((p) => p.chave === 'ficha:fx')
    expect(semConta).toBeDefined()
    expect(semConta?.usuarioId).toBeNull()
    expect(semConta?.nome).toBe('Carlos Pereira')
    expect(semConta?.pin).toBeNull()
    expect(semConta?.acesso).toBeNull()
    expect(semConta?.elegivelParaAdministrar).toBe(false)
    expect(textoDoAcesso(semConta as PessoaDaAdministracao)).toContain('sem conta')
  })

  it('cada pessoa aparece UMA vez: a ficha ligada não vira uma segunda linha', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      fichas: [ficha('fa', { usuarioId: 'a' }), ficha('fx')],
    })
    expect(lista.map((p) => p.chave).sort()).toEqual(['a', 'ficha:fx'])
  })

  it('a conta ligada a uma ficha mas fora da lista de contas aparece, com o nome da ficha', () => {
    /*
     * Uma ficha que libera acesso para uma conta invisível seria permissão
     * viva que ninguém vê — o mesmo motivo da concessão órfã.
     */
    const lista = montar({ fichas: [ficha('fz', { usuarioId: 'z', nomeCompleto: 'Zélia Prado' })] })
    expect(lista).toHaveLength(1)
    expect(lista[0].usuarioId).toBe('z')
    expect(lista[0].contaApagada).toBe(true)
    expect(lista[0].nome).toBe('Zélia Prado')
    expect(lista[0].acesso).toBe('ficha')
  })

  it('o super admin aparece marcado — e aparece mesmo fora da lista de contas', () => {
    const lista = montar({ funcionarios: [pessoa('w', 'Sérgio')], superAdmins: ['w', 'w2'] })
    expect(lista.find((p) => p.usuarioId === 'w')?.superAdmin).toBe(true)
    expect(lista.find((p) => p.usuarioId === 'w2')?.superAdmin).toBe(true)
    expect(lista.find((p) => p.usuarioId === 'w2')?.contaApagada).toBe(true)
  })

  it('duas fichas na mesma conta: a ativa vem para a linha, e a contagem avisa', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      fichas: [
        ficha('velha', { usuarioId: 'a', ativo: false, nomeCompleto: 'Ana Antiga' }),
        ficha('atual', { usuarioId: 'a', nomeCompleto: 'Ana Atual' }),
      ],
    })
    expect(lista).toHaveLength(1)
    expect(lista[0].ficha?.id).toBe('atual')
    expect(lista[0].fichasDaConta).toBe(2)
  })

  it('a ordem: quem administra (quem só administra no fim), sem acesso, o resto, a ficha sem conta, a desativada', () => {
    const lista = montar({
      funcionarios: [
        pessoa('c', 'Célia'),
        pessoa('n', 'Nadia'),
        pessoa('f', 'Fábio'),
        pessoa('i', 'Fernanda'),
        pessoa('d', 'Rita Moraes'),
        pessoa('s', 'Sérgio'),
      ],
      administradores: [concessao('d')],
      superAdmins: ['s'],
      fichas: [
        ficha('fc', { usuarioId: 'c', nomeCompleto: 'Célia' }),
        ficha('ff', { usuarioId: 'f', nomeCompleto: 'Fábio' }), // Fábio bate pela ficha: não é pendência
        // Fernanda: desligada — sem acesso de propósito, vai para o "resto".
        ficha('fi', { usuarioId: 'i', nomeCompleto: 'Fernanda', ativo: false, desligamento: '2026-08-29' }),
        ficha('x1', { nomeCompleto: 'Xavier' }),
        ficha('x0', { nomeCompleto: 'Abel', ativo: false }),
      ],
    })
    expect(lista.map((p) => p.nome)).toEqual([
      'Sérgio', // super admin: administra e bate
      'Rita Moraes', // só administra: fim do grupo dos administradores, mesmo vindo antes no alfabeto
      'Nadia', // sem acesso pendente
      'Célia',
      'Fábio',
      'Fernanda',
      'Xavier', // ficha sem conta
      'Abel', // ficha desativada sem conta
    ])
  })
})

describe('montarPessoas — o nome é o da regra única', () => {
  it('ficha ligada → nome guardado na conta → e-mail, e a lista em ordem pelo nome de exibição', () => {
    const lista = montar({
      funcionarios: [
        // A conta de função cujo nome guardado ainda é o do dono anterior.
        pessoa('ana', 'Vítor Campos', { email: 'ana@example.com' }),
        // A conta sem nome guardado: o nome que chega de `lerContasDoPonto` é o e-mail.
        pessoa('daniela', 'daniela@example.com', { email: 'daniela@example.com', nomeDaConta: null }),
        pessoa('bruno', 'Bruno Conta'),
      ],
      fichas: [
        ficha('fa', { usuarioId: 'ana', nomeCompleto: 'Ana Beatriz Rocha' }),
        ficha('fd', { usuarioId: 'daniela', nomeCompleto: 'Daniela Freitas' }),
      ],
    })
    // Bruno, sem ficha e sem administrar, vem antes: é a pendência de acesso.
    expect(lista.map((p) => p.nome)).toEqual(['Bruno Conta', 'Ana Beatriz Rocha', 'Daniela Freitas'])
  })

  it('a conta apagada: a ficha ganha do nome congelado na batida', () => {
    const lista = montar({
      batidas: [batida('orfa', { funcionario_nome: 'Nome do Dono Anterior' })],
      fichas: [ficha('fo', { usuarioId: 'orfa', nomeCompleto: 'Bruna Costa' })],
    })
    expect(lista.find((p) => p.usuarioId === 'orfa')?.nome).toBe('Bruna Costa')
  })

  it('a conta apagada e sem nome congelado: o e-mail congelado', () => {
    const lista = montar({ batidas: [batida('orfa', { funcionario_nome: null })] })
    expect(lista[0].nome).toBe('congelado@example.com')
  })
})

describe('filtrarPessoas — também pela ficha', () => {
  const lista = montar({
    funcionarios: [pessoa('a', 'Dani', { email: 'dani@example.com' })],
    fichas: [
      ficha('fa', {
        usuarioId: 'a',
        nomeCompleto: 'Daniela Freitas',
        cpf: '52998224725',
        cargo: 'Administrativo',
        matricula: '42',
      }),
      ficha('fx', { nomeCompleto: 'Otávio Reis' }),
    ],
  })

  it('pelo nome da ficha, que pode ser outro que o da conta', () => {
    // O nome da linha É o da ficha (ficha → nome da conta → e-mail):
    // "Dani" da conta some, "Daniela Freitas" fica.
    expect(filtrarPessoas(lista, 'freitas').map((p) => p.nome)).toEqual(['Daniela Freitas'])
    // E o e-mail da conta continua achando a pessoa.
    expect(filtrarPessoas(lista, 'dani@').map((p) => p.nome)).toEqual(['Daniela Freitas'])
  })

  it('pelo CPF com ou sem máscara, pela matrícula e pelo cargo', () => {
    expect(filtrarPessoas(lista, '529.982')).toHaveLength(1)
    expect(filtrarPessoas(lista, '52998')).toHaveLength(1)
    expect(filtrarPessoas(lista, 'administrativo')).toHaveLength(1)
    expect(filtrarPessoas(lista, '42')).toHaveLength(1)
  })

  it('a pessoa sem conta também é achada pelo nome', () => {
    expect(filtrarPessoas(lista, 'otavio').map((p) => p.chave)).toEqual(['ficha:fx'])
  })
})

describe('resumirPessoas — com as fichas', () => {
  it('conta as fichas ativas sem conta e as que ainda não batem ponto aqui', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      fichas: [
        ficha('fa', { usuarioId: 'a', batePontoDesde: '2026-09-01' }),
        ficha('x1'),
        ficha('x2', { ativo: false }),
      ],
    })
    const resumo = resumirPessoas(lista)
    expect(resumo.fichasSemConta).toBe(1) // a desativada é histórico, não pendência
    expect(resumo.naoBatemAqui).toBe(1) // só x1 (ativa, sem data)
    expect(resumo.semPin).toBe(1) // Ana; a pessoa sem conta não tem PIN a definir
    expect(resumo.semAcesso).toBe(0)
  })

  it('quem bate pela ficha não conta como "sem acesso"', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana')],
      fichas: [ficha('fa', { usuarioId: 'a' })],
    })
    expect(resumirPessoas(lista).semAcesso).toBe(0)
  })

  it('o super admin conta como quem administra', () => {
    const lista = montar({ funcionarios: [pessoa('w', 'Sérgio')], superAdmins: ['w'] })
    expect(resumirPessoas(lista).administradores).toBe(1)
  })

  it('toda conta do ponto entra no total, a conta nova sem ficha também', () => {
    const lista = montar({
      funcionarios: [pessoa('a', 'Ana'), pessoa('nova', 'Conta Nova')],
      fichas: [ficha('fa', { usuarioId: 'a' })],
    })
    // A conta nova, sem ficha nem administração, é do ponto e é pendência.
    expect(resumirPessoas(lista)).toMatchObject({ total: 2, semAcesso: 1 })
  })
})

describe('acoesDaPessoa — quem não é super admin não recebe as ações de super admin', () => {
  /*
   * Uma pessoa de cada forma que a lista tem. O teste não escolhe casos a
   * dedo: para TODAS, o admin comum não recebe nenhuma ação do super admin.
   */
  const todas = montar({
    funcionarios: [
      pessoa('sem-acesso', 'Sem Acesso'),
      pessoa('admin', 'Admin'),
      pessoa('super', 'Super'),
      pessoa('com-ficha', 'Com Ficha'),
      pessoa('ficha-off', 'Ficha Off'),
    ],
    administradores: [concessao('admin'), concessao('super')],
    superAdmins: ['super'],
    fichas: [
      ficha('f1', { usuarioId: 'com-ficha', nomeCompleto: 'Com Ficha' }),
      ficha('f2', { usuarioId: 'ficha-off', ativo: false, nomeCompleto: 'Ficha Off' }),
      ficha('f3', { nomeCompleto: 'Sem Conta' }),
      ficha('f4', { nomeCompleto: 'Sem Conta Off', ativo: false }),
    ],
    batidas: [batida('orfao', { funcionario_nome: 'Órfão' })],
  })
  const porNome = (nome: string) => todas.find((p) => p.nome === nome) as PessoaDaAdministracao

  it('a lista de teste tem todas as formas de pessoa', () => {
    expect(todas.some((p) => p.usuarioId === null && p.ficha?.ativo)).toBe(true)
    expect(todas.some((p) => p.usuarioId === null && !p.ficha?.ativo)).toBe(true)
    expect(todas.some((p) => p.contaApagada)).toBe(true)
    expect(todas.some((p) => p.superAdmin)).toBe(true)
    expect(todas.some(soAdministra)).toBe(true)
  })

  it.each(['admin', 'nenhum'] as const)('papel %s: nenhuma ação de super admin, em nenhuma pessoa', (papel) => {
    for (const alvo of todas) {
      const acoes = acoesDaPessoa(alvo, papel)
      expect(acoes.filter((acao) => ACOES_DO_SUPER_ADMIN.includes(acao)), alvo.nome).toEqual([])
    }
  })

  it('o admin comum vê a lista, reseta PIN e cuida do cadastro da ficha: as ações dele são exatamente estas', () => {
    expect(acoesDaPessoa(porNome('Admin'), 'admin')).toEqual(['resetar-pin'])
    expect(acoesDaPessoa(porNome('Sem Acesso'), 'admin')).toEqual(['resetar-pin'])
    expect(acoesDaPessoa(porNome('Com Ficha'), 'admin')).toEqual([
      'resetar-pin',
      'editar-ficha',
      'desativar-ficha',
    ])
    expect(acoesDaPessoa(porNome('Sem Conta'), 'admin')).toEqual(['editar-ficha', 'desativar-ficha'])
    // Reativar a ficha SEM conta é cadastro; reativar a LIGADA dá o ponto à conta.
    expect(acoesDaPessoa(porNome('Sem Conta Off'), 'admin')).toEqual(['editar-ficha', 'reativar-ficha'])
    expect(acoesDaPessoa(porNome('Ficha Off'), 'admin')).toEqual(['resetar-pin', 'editar-ficha'])
  })

  it('o papel "nenhum" (leitura que não chegou) não vê ação nenhuma', () => {
    for (const alvo of todas) expect(acoesDaPessoa(alvo, 'nenhum')).toEqual([])
  })

  it('o super admin vê as ações de conta, de vínculo e de administração', () => {
    expect(acoesDaPessoa(porNome('Com Ficha'), 'super_admin')).toEqual(
      expect.arrayContaining(['trocar-nome', 'trocar-email', 'redefinir-senha']),
    )
    expect(acoesDaPessoa(porNome('Admin'), 'super_admin')).toEqual(
      expect.arrayContaining(['revogar', 'trocar-nome', 'trocar-email', 'redefinir-senha']),
    )
    expect(acoesDaPessoa(porNome('Com Ficha'), 'super_admin')).toContain('desvincular-ficha')
    expect(acoesDaPessoa(porNome('Sem Conta'), 'super_admin')).toEqual([
      'vincular-ficha',
      'criar-conta',
      'editar-ficha',
      'desativar-ficha',
    ])
    expect(acoesDaPessoa(porNome('Ficha Off'), 'super_admin')).toContain('reativar-ficha')
  })

  /*
   * No banco do ponto, toda conta do login é do ponto, e a função de contas
   * atende qualquer uma delas. A conta criada sem ficha recebe nome, e-mail e
   * senha pela tela, e a ficha se liga depois.
   */
  it('a conta sem ficha e sem administração: o super admin mexe na conta e liga ou cria a ficha', () => {
    expect(acoesDaPessoa(porNome('Sem Acesso'), 'super_admin')).toEqual([
      'resetar-pin',
      'trocar-nome',
      'trocar-email',
      'redefinir-senha',
      'conceder',
      'vincular-ficha',
      'criar-ficha',
    ])
  })

  it('para a conta de um super admin, nada de trocar e-mail, conceder ou revogar', () => {
    /*
     * A Edge Function recusa trocar o e-mail de super admin (é com ele que a
     * conta de quem manda no ponto entra e recupera a senha, e a função troca
     * e-mail sem confirmação), e conceder ou revogar `ponto_admins` para quem
     * administra sempre não muda nada.
     */
    const superAdmin = todas.find((p) => p.superAdmin) as PessoaDaAdministracao
    const acoes = acoesDaPessoa(superAdmin, 'super_admin', superAdmin.usuarioId)
    expect(acoes).not.toContain('trocar-email')
    expect(acoes).not.toContain('revogar')
    expect(acoes).not.toContain('conceder')
    // A PRÓPRIA conta: nome e senha, sim.
    expect(acoes).toContain('trocar-nome')
    expect(acoes).toContain('redefinir-senha')
  })

  it('a conta de OUTRO super admin não oferece nenhuma ação de conta (a função recusaria com 409)', () => {
    const superAdmin = todas.find((p) => p.superAdmin) as PessoaDaAdministracao
    for (const eu of ['outra-conta', null]) {
      const acoes = acoesDaPessoa(superAdmin, 'super_admin', eu)
      expect(acoes, String(eu)).not.toContain('trocar-nome')
      expect(acoes, String(eu)).not.toContain('trocar-email')
      expect(acoes, String(eu)).not.toContain('redefinir-senha')
      expect(acoes, String(eu)).toContain('resetar-pin')
    }
  })

  it('conta apagada não recebe ficha, administração nem ação de conta (a função responderia 404)', () => {
    const orfao = todas.find((p) => p.contaApagada) as PessoaDaAdministracao
    const acoes = acoesDaPessoa(orfao, 'super_admin')
    expect(acoes).not.toContain('vincular-ficha')
    expect(acoes).not.toContain('criar-ficha')
    expect(acoes).not.toContain('conceder')
    expect(acoes.filter((acao) => ['trocar-nome', 'trocar-email', 'redefinir-senha'].includes(acao))).toEqual([])
  })
})

describe('acoesGerais e contasSemFicha', () => {
  it('nova conta é do super admin; nova ficha é de qualquer admin', () => {
    expect(acoesGerais('super_admin')).toEqual(['nova-conta', 'nova-ficha'])
    expect(acoesGerais('admin')).toEqual(['nova-ficha'])
    expect(acoesGerais('nenhum')).toEqual([])
  })

  it('as contas que podem receber ficha: contas do ponto sem ficha nenhuma (a apagada fica de fora)', () => {
    const lista = montar({
      funcionarios: [pessoa('livre', 'Livre'), pessoa('ligada', 'Ligada')],
      fichas: [ficha('f', { usuarioId: 'ligada' }), ficha('x')],
      batidas: [batida('orfao')],
    })
    expect(contasSemFicha(lista).map((c) => c.usuarioId)).toEqual(['livre'])
  })
})

/* ------------------------------------------------------------------ */
/* Só administra — não bate ponto                                     */
/* ------------------------------------------------------------------ */

describe('só administra — não bate ponto (a Rita, do RH)', () => {
  const lista = montar({
    funcionarios: [
      pessoa('rita', 'Rita'),
      pessoa('sergio', 'Sérgio Almeida'),
      pessoa('ana', 'ana@example.com', { nomeDaConta: null }),
      pessoa('nova', 'Conta Nova'),
      pessoa('fernanda', 'fernanda@example.com', { nomeDaConta: null }),
    ],
    administradores: [concessao('rita'), concessao('sergio')],
    superAdmins: ['sergio'],
    fichas: [
      ficha('fa', { usuarioId: 'ana', nomeCompleto: 'Ana Beatriz Rocha' }),
      ficha('ff', { usuarioId: 'fernanda', nomeCompleto: 'Fernanda Teles', ativo: false, desligamento: '2026-08-29' }),
    ],
    batidas: [batida('sergio'), batida('ana')],
  })
  const de = (id: string) => lista.find((p) => p.usuarioId === id) as PessoaDaAdministracao

  it('só quem administra sem ficha e sem ser super admin', () => {
    expect(lista.filter(soAdministra).map((p) => p.usuarioId)).toEqual(['rita'])
  })

  it('a frase de cada estado', () => {
    expect(textoDoAcesso(de('rita'))).toBe(ROTULO_SO_ADMINISTRA)
    expect(ROTULO_SO_ADMINISTRA).toBe('só administra — não bate ponto')
    expect(textoDoAcesso(de('sergio'))).toBe('super admin — bate ponto só para teste')
    expect(textoDoAcesso(de('ana'))).toBe('bate ponto pela ficha')
    expect(textoDoAcesso(de('nova'))).toBe('sem acesso ao ponto')
    expect(textoDoAcesso(de('fernanda'))).toBe('sem acesso ao ponto')
    const apagada = montar({ batidas: [batida('orfao')] })[0]
    expect(textoDoAcesso(apagada)).toContain('não existe mais')
  })

  it('a pendência de acesso é só a conta sem ficha e sem administrar', () => {
    expect(lista.filter(semAcessoPendente).map((p) => p.usuarioId)).toEqual(['nova'])
  })

  it('a lista: administradores (a Rita no fim do grupo), a pendência, o resto', () => {
    expect(lista.map((p) => p.nome)).toEqual([
      'Sérgio Almeida',
      'Rita',
      'Conta Nova',
      'Ana Beatriz Rocha',
      'Fernanda Teles',
    ])
  })

  it('o resumo: a Rita não é "sem acesso" nem "sem PIN"', () => {
    expect(resumirPessoas(lista)).toEqual({
      total: 5,
      administradores: 2,
      semAcesso: 1, // a conta nova
      semPin: 2, // o Sérgio (super admin bate) e a Ana Beatriz; nem a Rita, nem a Fernanda, nem a conta nova
      bloqueados: 0,
      fichasSemConta: 0,
      naoBatemAqui: 1, // a ficha ativa da Ana Beatriz sem "passou a bater ponto aqui em"
    })
  })
})

/* ------------------------------------------------------------------ */
/* Quem resolve o que só o super admin faz                            */
/* ------------------------------------------------------------------ */

describe('o nome do super admin nos textos de quem administra', () => {
  const linha = (nome: string, superAdmin: boolean, contaApagada = false) => ({ nome, superAdmin, contaApagada })

  it('as duas contas do Sérgio viram um nome só, pelo primeiro nome', () => {
    expect(
      quemEhOSuperAdmin([
        linha('Sérgio Almeida', true),
        linha('Sérgio', true),
        linha('Rita', false),
        linha('Ana Souza', false),
      ]),
    ).toBe('Sérgio')
  })

  it('a conta sem nome (aparece pelo e-mail) não entra: nunca "só admin@example.com faz"', () => {
    expect(quemEhOSuperAdmin([linha('Sérgio Almeida', true), linha('admin@example.com', true)])).toBe('Sérgio')
    expect(quemEhOSuperAdmin([linha('admin@example.com', true)])).toBe(RESERVA_DO_SUPER_ADMIN)
    expect(quemEhOSuperAdmin([linha('Conta sem nome nem e-mail', true)])).toBe('o super admin')
  })

  it('sem super admin na lista, ou com duas pessoas diferentes: "o super admin"', () => {
    expect(quemEhOSuperAdmin([])).toBe('o super admin')
    expect(quemEhOSuperAdmin([linha('Rita', false)])).toBe('o super admin')
    expect(quemEhOSuperAdmin([linha('Sérgio Almeida', true), linha('Maria Prado', true)])).toBe('o super admin')
  })

  it('a conta apagada não resolve nada', () => {
    expect(quemEhOSuperAdmin([linha('Sérgio Almeida', true), linha('Maria Prado', true, true)])).toBe('Sérgio')
  })
})
