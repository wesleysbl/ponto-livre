import { describe, expect, it } from 'vitest'
import type { ConfiguracaoDoPonto, LocalDoPonto } from './configuracao'
import {
  contarAusenciasAtivas,
  ID_DA_SECAO,
  montarInicioDaAdministracao,
  type EntradaDoInicio,
  type ResumoDePessoas,
  type SecaoDoInicio,
} from './inicio-da-administracao'

/*
 * A página inicial da administração: seis seções, cada uma com um número que
 * não pode mentir — nem "1 pedidos", nem um "0" quando a leitura falhou.
 */

const PESSOAS_EM_DIA: ResumoDePessoas = {
  total: 8,
  administradores: 3,
  semAcesso: 0,
  semPin: 0,
  bloqueados: 0,
  fichasSemConta: 0,
  naoBatemAqui: 0,
}

const CONFIGURACAO: ConfiguracaoDoPonto = {
  razaoSocial: 'Empresa Exemplo Ltda',
  nomeFantasia: 'Empresa Exemplo',
  cnpj: '11222333000181',
  endereco: 'Rua 1, 100',
  cidade: 'Campinas',
  uf: 'SP',
  cargaDiariaMinutos: 480,
  toleranciaMinutos: 10,
  janelaDuplicidadeSegundos: 60,
  atualizadoEm: null,
}

const LOCAL: LocalDoPonto = {
  id: 'l1',
  nome: 'Empresa Exemplo',
  latitude: -23.55052,
  longitude: -46.633308,
  raioMetros: 150,
  medidoEm: '2026-10-15T12:00:00.000000+00:00',
  medidoPor: 'u-sergio',
}

function entrada(parcial: Partial<EntradaDoInicio> = {}): EntradaDoInicio {
  return {
    pendencias: { estado: 'pronto', valor: 0 },
    pessoas: { estado: 'pronto', valor: PESSOAS_EM_DIA },
    ausencias: { estado: 'pronto', valor: { ausencias: 0, pessoas: 0 } },
    rotuloDoMes: 'Outubro de 2026',
    configuracao: { estado: 'pronto', valor: { configuracao: CONFIGURACAO, local: LOCAL } },
    ...parcial,
  }
}

function secao(secoes: SecaoDoInicio[], chave: SecaoDoInicio['chave']): SecaoDoInicio {
  const achada = secoes.find((item) => item.chave === chave)
  if (!achada) throw new Error(`Seção ${chave} não montada.`)
  return achada
}

describe('as seis seções', () => {
  it('saem na ordem de urgência, cada uma com destino', () => {
    const secoes = montarInicioDaAdministracao(entrada())
    expect(secoes.map((item) => item.chave)).toEqual([
      'atraso',
      'pessoas',
      'ausencias',
      'local',
      'empresa',
      'jornada',
    ])
    expect(secao(secoes, 'atraso').destino).toEqual({ tipo: 'rota', para: '/painel' })
    expect(secao(secoes, 'ausencias').destino).toEqual({ tipo: 'rota', para: '/painel' })
    expect(secao(secoes, 'pessoas').destino).toEqual({ tipo: 'secao', id: ID_DA_SECAO.pessoas })
    expect(secao(secoes, 'local').destino).toEqual({ tipo: 'secao', id: ID_DA_SECAO.local })
    expect(secao(secoes, 'empresa').destino).toEqual({ tipo: 'secao', id: ID_DA_SECAO.empresa })
    expect(secao(secoes, 'jornada').destino).toEqual({ tipo: 'secao', id: ID_DA_SECAO.jornada })
  })

  it('carregando: nenhum número inventado, todas em "…"', () => {
    const secoes = montarInicioDaAdministracao({
      pendencias: { estado: 'carregando' },
      pessoas: { estado: 'carregando' },
      ausencias: { estado: 'carregando' },
      rotuloDoMes: 'Outubro de 2026',
      configuracao: { estado: 'carregando' },
    })
    expect(secoes.map((item) => item.numero)).toEqual(['…', '…', '…', '…', '…', '…'])
    expect(secoes.every((item) => item.tom === 'neutro')).toBe(true)
  })

  it('falhou: "—" e tom de aviso — nunca um zero que diria "nada a fazer"', () => {
    const secoes = montarInicioDaAdministracao({
      pendencias: { estado: 'falhou' },
      pessoas: { estado: 'falhou' },
      ausencias: { estado: 'falhou' },
      rotuloDoMes: 'Outubro de 2026',
      configuracao: { estado: 'falhou' },
    })
    expect(secoes.map((item) => item.numero)).toEqual(['—', '—', '—', '—', '—', '—'])
    expect(secoes.every((item) => item.tom === 'aviso')).toBe(true)
    expect(secoes.every((item) => /não deu para ler/i.test(item.detalhe))).toBe(true)
  })
  it('sem os formulários na tela (carregando ou falhou), local, empresa e jornada rolam até o aviso da configuração', () => {
    // O bloco do formulário só existe quando a leitura deu certo: com ele de
    // destino, o botão do cartão não faria nada justo quando há erro.
    for (const estado of ['carregando', 'falhou'] as const) {
      const secoes = montarInicioDaAdministracao(entrada({ configuracao: { estado } }))
      for (const chave of ['local', 'empresa', 'jornada'] as const) {
        expect(secao(secoes, chave).destino, `${chave} ${estado}`).toEqual({
          tipo: 'secao',
          id: ID_DA_SECAO.configuracao,
        })
      }
    }
  })
})

describe('batidas em atraso', () => {
  it('zero pendentes é bom; um é singular; vários, plural e aviso', () => {
    expect(secao(montarInicioDaAdministracao(entrada()), 'atraso')).toMatchObject({
      numero: '0',
      tom: 'bom',
      detalhe: 'Nenhum pedido esperando.',
    })
    expect(
      secao(montarInicioDaAdministracao(entrada({ pendencias: { estado: 'pronto', valor: 1 } })), 'atraso'),
    ).toMatchObject({ numero: '1', legenda: 'pedido esperando decisão', tom: 'aviso' })
    const tres = secao(
      montarInicioDaAdministracao(entrada({ pendencias: { estado: 'pronto', valor: 3 } })),
      'atraso',
    )
    expect(tres).toMatchObject({ numero: '3', legenda: 'pedidos esperando decisão', tom: 'aviso' })
    expect(tres.detalhe).toContain('não conta hora')
  })
})

describe('pessoas', () => {
  it('sem pendência: total e quantos administram', () => {
    expect(secao(montarInicioDaAdministracao(entrada()), 'pessoas')).toMatchObject({
      numero: '8',
      legenda: 'pessoas',
      detalhe: '3 administram o ponto. Nada pendente.',
      tom: 'neutro',
    })
  })

  it('as pendências viram frase, no singular e no plural', () => {
    const pessoas = secao(
      montarInicioDaAdministracao(
        entrada({
          pessoas: {
            estado: 'pronto',
            valor: { ...PESSOAS_EM_DIA, semAcesso: 1, fichasSemConta: 2, bloqueados: 1, semPin: 3 },
          },
        }),
      ),
      'pessoas',
    )
    expect(pessoas.detalhe).toBe(
      '1 conta sem acesso · 2 fichas sem conta · 1 PIN bloqueado · 3 contas sem PIN',
    )
    expect(pessoas.tom).toBe('aviso')
  })

  it('só "sem PIN" aparece na frase, mas não acende o aviso (a pessoa cria sozinha)', () => {
    const pessoas = secao(
      montarInicioDaAdministracao(
        entrada({ pessoas: { estado: 'pronto', valor: { ...PESSOAS_EM_DIA, semPin: 1 } } }),
      ),
      'pessoas',
    )
    expect(pessoas.detalhe).toBe('1 conta sem PIN')
    expect(pessoas.tom).toBe('neutro')
  })

  it('uma pessoa só: singular', () => {
    const pessoas = secao(
      montarInicioDaAdministracao(
        entrada({ pessoas: { estado: 'pronto', valor: { ...PESSOAS_EM_DIA, total: 1, administradores: 1 } } }),
      ),
      'pessoas',
    )
    expect(pessoas).toMatchObject({ numero: '1', legenda: 'pessoa', detalhe: '1 administra o ponto. Nada pendente.' })
  })
})

describe('ausências', () => {
  it('conta só as ativas, e as pessoas distintas', () => {
    expect(
      contarAusenciasAtivas([
        { usuario_id: 'a', cancelada_em: null },
        { usuario_id: 'a', cancelada_em: null },
        { usuario_id: 'b', cancelada_em: '2026-10-10T12:00:00Z' },
        { usuario_id: 'c', cancelada_em: null },
      ]),
    ).toEqual({ ausencias: 3, pessoas: 2 })
    expect(contarAusenciasAtivas([])).toEqual({ ausencias: 0, pessoas: 0 })
  })

  it('o mês vai na legenda, em minúsculas', () => {
    const vazia = secao(montarInicioDaAdministracao(entrada()), 'ausencias')
    expect(vazia).toMatchObject({ numero: '0', legenda: 'ausências em outubro de 2026' })
    const uma = secao(
      montarInicioDaAdministracao(entrada({ ausencias: { estado: 'pronto', valor: { ausencias: 1, pessoas: 1 } } })),
      'ausencias',
    )
    expect(uma.legenda).toBe('ausência em outubro de 2026')
    expect(uma.detalhe).toMatch(/^1 pessoa\. Não mudam a soma de horas/)
  })
})

describe('local, empresa e jornada', () => {
  it('local medido por alguém: raio e data, tom bom', () => {
    expect(secao(montarInicioDaAdministracao(entrada()), 'local')).toMatchObject({
      numero: '150 m',
      tom: 'bom',
      detalhe: 'Medido em 15/10/2026, 09:00.',
    })
  })

  it('local gravado pelo sistema (sem sessão): neutro, e diz que não foi medido no local', () => {
    const local = secao(
      montarInicioDaAdministracao(
        entrada({
          configuracao: {
            estado: 'pronto',
            valor: { configuracao: CONFIGURACAO, local: { ...LOCAL, medidoPor: null } },
          },
        }),
      ),
      'local',
    )
    expect(local.tom).toBe('neutro')
    expect(local.detalhe).toContain('sem medição no local')
  })

  it('local nunca medido ou ausente: aviso', () => {
    const nunca = secao(
      montarInicioDaAdministracao(
        entrada({
          configuracao: {
            estado: 'pronto',
            valor: { configuracao: CONFIGURACAO, local: { ...LOCAL, medidoEm: null, medidoPor: null } },
          },
        }),
      ),
      'local',
    )
    expect(nunca).toMatchObject({ tom: 'aviso', detalhe: 'Nunca foi medido de dentro do local.' })
    const sem = secao(
      montarInicioDaAdministracao(
        entrada({ configuracao: { estado: 'pronto', valor: { configuracao: CONFIGURACAO, local: null } } }),
      ),
      'local',
    )
    expect(sem).toMatchObject({ numero: '—', tom: 'aviso' })
  })

  it('empresa: conta os campos que faltam no cabeçalho da folha', () => {
    expect(secao(montarInicioDaAdministracao(entrada()), 'empresa')).toMatchObject({
      numero: '0',
      tom: 'bom',
    })
    const semCnpj = secao(
      montarInicioDaAdministracao(
        entrada({
          configuracao: {
            estado: 'pronto',
            valor: { configuracao: { ...CONFIGURACAO, cnpj: null }, local: LOCAL },
          },
        }),
      ),
      'empresa',
    )
    expect(semCnpj).toMatchObject({
      numero: '1',
      legenda: 'campo faltando na folha',
      detalhe: 'Falta CNPJ.',
      tom: 'aviso',
    })
    const semLinha = secao(
      montarInicioDaAdministracao(
        entrada({ configuracao: { estado: 'pronto', valor: { configuracao: null, local: LOCAL } } }),
      ),
      'empresa',
    )
    expect(semLinha).toMatchObject({ numero: '6', tom: 'aviso' })
  })

  it('jornada: carga em horas:minutos, tolerância e janela', () => {
    expect(secao(montarInicioDaAdministracao(entrada()), 'jornada')).toMatchObject({
      numero: '08:00',
      detalhe: 'Tolerância de 10 min · batida repetida recusada em 60 s.',
    })
    expect(
      secao(
        montarInicioDaAdministracao(
          entrada({ configuracao: { estado: 'pronto', valor: { configuracao: null, local: LOCAL } } }),
        ),
        'jornada',
      ),
    ).toMatchObject({ numero: '—', tom: 'aviso' })
  })
})
