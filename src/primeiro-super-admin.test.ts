import { describe, expect, it } from 'vitest'
import sqlDoArquivo from '../supabase/primeiro-super-admin.sql?raw'

/*
 * O ARQUIVO DO PRIMEIRO SUPER ADMIN (`supabase/primeiro-super-admin.sql`),
 * LIDO COMO TEXTO.
 *
 * Quem instala cola o arquivo no SQL Editor do Supabase e troca UM e-mail. O
 * teste de ponta a ponta (`e2e/cadastro.spec.ts`) roda o arquivo de verdade,
 * como `postgres`, no Supabase local; este aqui segura, sem banco, o que o
 * arquivo promete a quem instala e que o CI confere a cada push:
 *   • o e-mail de exemplo aparece UMA vez só, na linha marcada — é a troca
 *     única que o cabeçalho anuncia;
 *   • a única gravação é o INSERT na lista de super admins: nada se apaga,
 *     nada se altera, nenhuma permissão muda;
 *   • a conta tem de existir no login, e a que já é super admin não é
 *     acrescentada de novo (a conferência vem antes do INSERT);
 *   • a conta sem e-mail confirmado é recusada antes de qualquer gravação, com
 *     a frase que diz o que fazer ("Auto Confirm User" ou confirmar o e-mail).
 *     O teste de ponta a ponta da função de contas roda a recusa de verdade.
 */

const EMAIL_DE_EXEMPLO = 'voce@example.com'

/** O SQL sem os comentários `--` e sem o conteúdo dos literais `'...'` (as frases das mensagens). */
function codigo(sql: string): string {
  return sql
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''")
}

describe('o arquivo do primeiro super admin', () => {
  it('tem o e-mail de exemplo uma vez só, na linha marcada para trocar', () => {
    expect(sqlDoArquivo.split(EMAIL_DE_EXEMPLO)).toHaveLength(2)
    const linhas = sqlDoArquivo.split('\n')
    // A marca é o comentário que abre com "TROQUE AQUI" (o cabeçalho só fala dela).
    const marcada = linhas.findIndex((linha) => linha.trim().startsWith('-- TROQUE AQUI'))
    expect(marcada).toBeGreaterThanOrEqual(0)
    expect(linhas[marcada + 1]).toContain(`'${EMAIL_DE_EXEMPLO}'`)
  })

  it('a única gravação é o INSERT na lista de super admins', () => {
    const sql = codigo(sqlDoArquivo)
    expect(sql.match(/\binsert\s+into\s+[\w.]+/gi)).toEqual(['INSERT INTO public.ponto_super_admins'])
    for (const comando of ['update', 'delete', 'truncate', 'drop', 'alter', 'grant', 'revoke', 'create', 'commit']) {
      expect(sql, comando).not.toMatch(new RegExp(`\\b${comando}\\b`, 'i'))
    }
  })

  it('recusa e-mail que não está no login e não duplica quem já é super admin', () => {
    const sql = codigo(sqlDoArquivo)
    const recusa = sql.search(/IF\s+v_usuario\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION/i)
    const jaE = sql.search(/IF\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.ponto_super_admins[^)]*\)\s+THEN\s+RAISE\s+NOTICE[^;]*;\s*RETURN;/i)
    const insert = sql.search(/INSERT\s+INTO\s+public\.ponto_super_admins/i)
    expect(recusa).toBeGreaterThan(0)
    expect(jaE).toBeGreaterThan(recusa)
    expect(insert).toBeGreaterThan(jaE)
  })

  it('recusa conta sem e-mail confirmado antes de pôr na lista, dizendo o que fazer', () => {
    const sql = codigo(sqlDoArquivo)
    // A confirmação vem da mesma leitura da conta, e é conferida depois de a
    // conta existir e antes de qualquer outra coisa.
    expect(sql).toMatch(/SELECT\s+u\.id,\s*u\.email_confirmed_at\s+INTO\s+v_usuario,\s*v_confirmada\b/i)
    const existe = sql.search(/IF\s+v_usuario\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION/i)
    const confirmada = sql.search(/IF\s+v_confirmada\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION/i)
    const jaE = sql.search(/IF\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.ponto_super_admins/i)
    const insert = sql.search(/INSERT\s+INTO\s+public\.ponto_super_admins/i)
    expect(existe).toBeGreaterThan(0)
    expect(confirmada).toBeGreaterThan(existe)
    expect(jaE).toBeGreaterThan(confirmada)
    expect(insert).toBeGreaterThan(confirmada)
    // A frase da recusa (no arquivo de verdade, com os textos) diz o que fazer.
    const frase = /IF v_confirmada IS NULL THEN\s+RAISE EXCEPTION '((?:[^']|'')*)'/.exec(sqlDoArquivo)?.[1] ?? ''
    expect(frase).toMatch(/ainda não foi confirmado/)
    expect(frase).toMatch(/Nada mudou/)
    expect(frase).toContain('"Auto Confirm User"')
    expect(frase).toMatch(/Confirme o e-mail/)
  })
})
