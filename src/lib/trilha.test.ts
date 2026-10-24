import { describe, expect, it } from 'vitest'
import {
  AUTOR_DO_SISTEMA,
  AUTOR_NAO_IDENTIFICADO,
  descreverCampos,
  horarioAnteriorDaCorrecao,
  horarioPosteriorDaCorrecao,
  naturezaDaCorrecao,
  nomeDoAdmin,
  normalizarCorrecao,
  rotuloDoAutor,
  type Correcao,
} from './trilha'

/*
 * O DEFEITO QUE ESTES TESTES EVITAM: a trilha que o banco grava sozinho — um
 * recálculo de distância, por exemplo, com `autor_id` nulo — apareceria no
 * painel como correção de "Administrador não identificado".
 */

const ADMIN = '11111111-1111-1111-1111-111111111111'
const nomes = new Map([[ADMIN, 'Sérgio']])
const nomeDoAutor = (autorId: string | null) => nomeDoAdmin(autorId, nomes)

/** Uma linha de recálculo feita pelo próprio banco, como `ponto_correcoes` a guarda. */
const DO_RECALCULO = {
  id: 'c1',
  registro_id: 'r1',
  usuario_id: 'u1',
  motivo: 'Recalculo da distancia contra a coordenada medida do local',
  campos: ['distancia_metros', 'no_local', 'local_id'],
  valores_antes: { distancia_metros: 2601.2, no_local: false },
  valores_depois: { distancia_metros: 4.2, no_local: true },
  autor_id: null,
  criado_em: '2026-10-10T18:00:00Z',
  natureza: 'sistema',
}

const DO_ADMIN = {
  ...DO_RECALCULO,
  id: 'c2',
  motivo: 'Esqueceu de bater na volta do almoço',
  campos: ['registrado_em'],
  valores_antes: { registrado_em: '2026-10-10T16:02:00+00:00' },
  valores_depois: { registrado_em: '2026-10-10T16:00:00+00:00' },
  autor_id: ADMIN,
  natureza: 'admin',
}

describe('naturezaDaCorrecao', () => {
  it('só "sistema" é sistema', () => {
    expect(naturezaDaCorrecao('sistema')).toBe('sistema')
    expect(naturezaDaCorrecao('admin')).toBe('admin')
  })

  it('ausente, nula ou desconhecida vale "admin", o DEFAULT da coluna, e nada quebra', () => {
    expect(naturezaDaCorrecao(undefined)).toBe('admin')
    expect(naturezaDaCorrecao(null)).toBe('admin')
    expect(naturezaDaCorrecao('Sistema')).toBe('admin')
    expect(naturezaDaCorrecao(1)).toBe('admin')
  })
})

describe('normalizarCorrecao', () => {
  it('mantém a linha e decide a natureza', () => {
    const correcao = normalizarCorrecao(DO_RECALCULO)
    expect(correcao.natureza).toBe('sistema')
    expect(correcao.motivo).toBe(DO_RECALCULO.motivo)
    expect(correcao.campos).toEqual(DO_RECALCULO.campos)
  })

  it('linha sem a coluna natureza vira "admin"', () => {
    const semNatureza: Record<string, unknown> = { ...DO_ADMIN }
    delete semNatureza.natureza
    expect(normalizarCorrecao(semNatureza).natureza).toBe('admin')
  })
})

describe('rotuloDoAutor', () => {
  it('a trilha do sistema aparece como "Sistema", nunca como administrador não identificado', () => {
    const correcao = normalizarCorrecao(DO_RECALCULO)
    expect(rotuloDoAutor(correcao, nomeDoAutor)).toBe(AUTOR_DO_SISTEMA)
    expect(rotuloDoAutor(correcao, nomeDoAutor)).not.toBe(AUTOR_NAO_IDENTIFICADO)
  })

  it('a reordenação que roda dentro da correção de um admin carrega o autor_id dele, e continua "Sistema"', () => {
    const reordenacao = normalizarCorrecao({ ...DO_RECALCULO, autor_id: ADMIN, campos: ['tipo', 'ordem_no_dia'] })
    expect(rotuloDoAutor(reordenacao, nomeDoAutor)).toBe(AUTOR_DO_SISTEMA)
  })

  it('a correção do admin aparece com o nome dele', () => {
    expect(rotuloDoAutor(normalizarCorrecao(DO_ADMIN), nomeDoAutor)).toBe('Sérgio')
  })

  it('a correção de admin sem nome conhecido continua "Administrador não identificado"', () => {
    const desconhecido = normalizarCorrecao({ ...DO_ADMIN, autor_id: '22222222-2222-2222-2222-222222222222' })
    expect(rotuloDoAutor(desconhecido, nomeDoAutor)).toBe(AUTOR_NAO_IDENTIFICADO)
    expect(rotuloDoAutor(normalizarCorrecao({ ...DO_ADMIN, autor_id: null }), nomeDoAutor)).toBe(
      AUTOR_NAO_IDENTIFICADO,
    )
  })
})

describe('horários da correção', () => {
  it('a correção de horário mostra o de antes e o de depois', () => {
    const correcao: Correcao = normalizarCorrecao(DO_ADMIN)
    expect(horarioAnteriorDaCorrecao(correcao)).toBe('2026-10-10T16:02:00+00:00')
    expect(horarioPosteriorDaCorrecao(correcao)).toBe('2026-10-10T16:00:00+00:00')
  })

  it('a operação do sistema que não mexe no horário não mostra horário', () => {
    const correcao = normalizarCorrecao(DO_RECALCULO)
    expect(horarioAnteriorDaCorrecao(correcao)).toBeNull()
    expect(horarioPosteriorDaCorrecao(correcao)).toBeNull()
  })
})

describe('o que mudou, em palavras do RH', () => {
  it('as colunas viram palavras, sem repetir a localização', () => {
    expect(descreverCampos(['registrado_em'])).toBe('horário')
    expect(descreverCampos(['registrado_em', 'dia_civil'])).toBe('horário e dia')
    expect(descreverCampos(['latitude', 'longitude', 'precisao_metros', 'tipo', 'ordem_no_dia'])).toBe(
      'localização, nome da batida e ordem no dia',
    )
  })

  it('coluna sem nome conhecido aparece crua, e lista vazia é texto vazio', () => {
    expect(descreverCampos(['coluna_nova'])).toBe('coluna_nova')
    expect(descreverCampos([])).toBe('')
  })
})
