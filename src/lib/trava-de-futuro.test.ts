import { describe, expect, it, vi } from 'vitest'

/*
 * A RECUSA DA TRAVA DE FUTURO CHEGA AO RH COM AS PALAVRAS DO APP.
 *
 * O que se prova:
 *   • A frase que o gatilho escreve — lida do PRÓPRIO arquivo da migration da
 *     estrutura do banco, e não copiada para cá — é reconhecida, e a do app
 *     guarda o horário recusado. Se alguém mudar a frase no SQL sem mudar o app,
 *     este teste quebra.
 *   • A frase do banco já é legível sem tradução: o app em cache nos aparelhos a
 *     mostra como veio.
 *   • A recusa do PEDIDO de batida em atraso ("Horario declarado no futuro"),
 *     que tem tradução própria em `batidas.ts`, não é confundida com ela.
 *   • Inserir e corrigir batida (`inserirBatida` e `corrigirHorario`, as duas
 *     portas do administrador para `ponto_registros`) entregam a frase do app.
 */

const simulado = vi.hoisted(() => {
  const estado = { erro: '' }
  const resposta = () => Promise.resolve({ data: null, error: { message: estado.erro } })
  const cadeia = {
    insert: () => cadeia,
    update: () => cadeia,
    eq: () => cadeia,
    select: () => cadeia,
    single: resposta,
  }
  return { estado, supabase: { from: () => cadeia } }
})

vi.mock('./supabase', () => ({ supabase: simulado.supabase }))

import { corrigirHorario, inserirBatida } from './admin'
import { traduzirHorarioNoFuturo } from './trava-de-futuro'

// A migration da estrutura do banco, que traz o gatilho da trava (uma só, com o
// banco inteiro). Sem ela, ou com ela vazia, a frase fica vazia e os testes
// quebram em vez de passar no vazio.
const arquivos = import.meta.glob<string>('../../supabase/migrations/*_ponto_livre_estrutura.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const sql = Object.values(arquivos).join('\n')

/** A frase do gatilho, com o `%` preenchido como o banco preenche (horário de Brasília). */
const fraseDoBanco = (/RAISE EXCEPTION '(Horário no futuro[^']*)'/.exec(sql)?.[1] ?? '').replace(
  '%',
  '21/10/2026 às 08:00',
)

describe('a recusa da trava de futuro', () => {
  it('a migration da trava está no repositório, uma vez só, com a frase do gatilho', () => {
    expect(Object.keys(arquivos)).toHaveLength(1)
    expect(sql.trim()).not.toBe('')
    // A frase aparece uma vez: um gatilho só recusa o futuro.
    expect(sql.match(/RAISE EXCEPTION 'Horário no futuro/g)).toHaveLength(1)
    expect(fraseDoBanco).toMatch(/^Horário no futuro: /)
  })

  it('a frase do banco já é legível sem tradução (o app em cache a mostra crua)', () => {
    expect(fraseDoBanco).toContain('21/10/2026 às 08:00 (horário de Brasília)')
    expect(fraseDoBanco).toContain('Confira a data e a hora.')
    // Nada de código de erro, nome de coluna ou de função no meio da frase.
    expect(fraseDoBanco).not.toMatch(/_|registrado_em|ponto_/)
  })

  it('é reconhecida e ganha a frase do app, com o horário recusado', () => {
    const traduzida = traduzirHorarioNoFuturo(fraseDoBanco)
    expect(traduzida).toBe(
      'Esse horário (21/10/2026 às 08:00) está no futuro. A batida precisa ser de agora ou de antes: confira a data e a hora.',
    )
    expect(traduzida).not.toBe(fraseDoBanco)
  })

  it('sem acento também casa, e sem o horário na mensagem a frase vai sem ele', () => {
    expect(traduzirHorarioNoFuturo('Horario no futuro: a batida precisa ser de agora ou de antes, e chegou com 21/10/2026 as 08:00')).toBe(
      'Esse horário (21/10/2026 às 08:00) está no futuro. A batida precisa ser de agora ou de antes: confira a data e a hora.',
    )
    expect(traduzirHorarioNoFuturo('Horário no futuro')).toBe(
      'Esse horário está no futuro. A batida precisa ser de agora ou de antes: confira a data e a hora.',
    )
  })

  it('não confunde o pedido de batida em atraso nem as outras recusas', () => {
    expect(traduzirHorarioNoFuturo('Horario declarado no futuro: o pedido em atraso e de um horario que ja passou')).toBeNull()
    expect(traduzirHorarioNoFuturo('Batida duplicada: ja existe um registro deste funcionario ha menos de 60 segundos')).toBeNull()
    expect(traduzirHorarioNoFuturo('Correcao de ponto exige motivo')).toBeNull()
  })

  it('inserir e corrigir batida entregam a frase do app quando o banco recusa pelo futuro', async () => {
    simulado.estado.erro = fraseDoBanco
    const esperada =
      'Esse horário (21/10/2026 às 08:00) está no futuro. A batida precisa ser de agora ou de antes: confira a data e a hora.'

    await expect(
      inserirBatida({ usuarioId: 'u1', momentoISO: '2026-10-21T11:00:00.000Z', motivo: 'Esqueceu de bater' }),
    ).rejects.toThrow(esperada)
    await expect(
      corrigirHorario({
        registroId: 'r1',
        momentoAnteriorISO: '2026-10-20T11:00:00.000Z',
        momentoISO: '2026-10-21T11:00:00.000Z',
        motivo: 'Horário errado',
      }),
    ).rejects.toThrow(esperada)
  })
})
