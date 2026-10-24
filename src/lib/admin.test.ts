import { describe, expect, it, vi } from 'vitest'

/*
 * AS RECUSAS DO LANÇAMENTO E DA CORREÇÃO DE BATIDA, NAS PALAVRAS DO PAINEL.
 *
 * Quem administra lança a batida esquecida (INSERT direto) e corrige o horário
 * (UPDATE) pelo painel, e quem recusa é o banco: o carimbo
 * (`ponto_carimbar_registro`) e a trilha (`ponto_guardar_correcao`). Cada frase
 * que esses dois gatilhos levantam para uma sessão tem de chegar traduzida por
 * `admin.ts`: crua, ela iria para a caixa do RH em português sem acento e com
 * jeito de erro de banco. As frases são lidas da migration da estrutura, e não
 * copiadas para cá: frase nova no banco sem tradução no app quebra este teste.
 */

// `admin.ts` importa o cliente do Supabase, que exige as variáveis de ambiente:
// o tradutor é testado com ele simulado.
vi.mock('./supabase', () => ({ supabase: {} }))
const { ErroDoPainel } = await import('./admin')

const migracoes = import.meta.glob<string>('../../supabase/migrations/*_ponto_livre_estrutura.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SQL = Object.values(migracoes).join('\n')

/** O corpo inteiro de uma função de gatilho, do CREATE ao `$$;` que o fecha. */
const corpoDa = (nome: string) => new RegExp(String.raw`CREATE FUNCTION public\.${nome}\(\)[\s\S]*?\n\$\$;`).exec(SQL)?.[0] ?? ''

/** As frases dos RAISE EXCEPTION de um corpo, com o `%` preenchido por um número. */
const frasesDe = (corpo: string) =>
  [...corpo.matchAll(/RAISE EXCEPTION\s+'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'").replace(/%/g, '60'))

describe('as recusas do lançamento e da correção de batida chegam traduzidas ao painel', () => {
  const carimbo = corpoDa('ponto_carimbar_registro')
  const correcao = corpoDa('ponto_guardar_correcao')
  // O caminho do sistema (o canal que só o banco abre) não chega de uma sessão.
  const frases = [...new Set([...frasesDe(carimbo), ...frasesDe(correcao)])].filter(
    (frase) => !frase.startsWith('Operacao do sistema'),
  )

  it('a migration da estrutura está aqui, com as frases do carimbo e da correção', () => {
    expect(Object.keys(migracoes)).toHaveLength(1)
    expect(carimbo).not.toBe('')
    expect(correcao).not.toBe('')
    expect(frases.length).toBeGreaterThanOrEqual(9)
  })

  it.each(frases)('"%s" chega traduzida, e não crua', (frase) => {
    expect(new ErroDoPainel(frase).message).not.toBe(frase)
  })

  it('quem é dono da batida lê o que fazer: pedir a outra pessoa que administra', () => {
    expect(
      new ErroDoPainel(
        'Quem e dono da batida nao lanca o proprio ponto: peca a outra pessoa que administra o ponto ou ao super admin',
      ).message,
    ).toBe('Você não pode lançar batida para você mesmo. Peça a outra pessoa que administra o ponto, ou ao super admin.')
    expect(
      new ErroDoPainel(
        'Quem e dono da batida nao corrige o proprio ponto: peca a outra pessoa que administra o ponto ou ao super admin',
      ).message,
    ).toBe('Você não pode corrigir a sua própria batida. Peça a outra pessoa que administra o ponto, ou ao super admin.')
  })

  it('o lançamento sem motivo pede o motivo, com a mesma frase da correção sem motivo', () => {
    expect(
      new ErroDoPainel('Batida lancada por quem administra exige motivo: ele fica gravado na batida e aparece no espelho da pessoa')
        .message,
    ).toBe(new ErroDoPainel('Correcao de ponto exige motivo').message)
  })
})
