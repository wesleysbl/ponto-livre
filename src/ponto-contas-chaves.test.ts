import { describe, expect, it } from 'vitest'
import {
  ENTRADA_PADRAO,
  VARIAVEIS_DAS_CHAVES,
  lerChaveNova,
  resolverChaves,
} from '../supabase/functions/ponto-contas/chaves.ts'

/*
 * AS CHAVES DA FUNÇÃO DE CONTAS, LIDAS DO AMBIENTE QUE O SUPABASE MONTA.
 *
 * O módulo mora em `supabase/functions/ponto-contas/` (vai junto no deploy) e é
 * testado daqui, como `regras.ts`: o Vitest e o `tsc` do app só olham `src/`, e
 * importar daqui obriga o módulo a continuar sem `Deno` e sem import de rede.
 *
 * Os cenários:
 *   • só as chaves novas (o projeto criado sem as legadas);
 *   • só as legadas (o projeto antigo);
 *   • as duas (usa as novas);
 *   • a nova com JSON inválido, e as legadas presentes (usa as legadas);
 *   • nenhuma (erro, e a função responde 500 `configuracao_incompleta`);
 *   • o dicionário sem a entrada `default`;
 *   • e, em todos, nenhuma chave no diagnóstico, que é o que vai para o log.
 *
 * Os valores são de mentira e longe do formato das chaves de verdade: os
 * scanners de segredo procuram texto com cara de chave do Supabase.
 */

const URL_DO_PROJETO = 'https://projeto.example.com'
const PUBLICAVEL_NOVA = 'chave-publicavel-nova'
const SECRETA_NOVA = 'chave-secreta-nova'
const ANON_LEGADA = 'chave-anon-legada'
const SERVICO_LEGADA = 'chave-de-servico-legada'

/** Um dicionário de chaves como o Supabase entrega: `{"default": "..."}`. */
const dicionario = (chave: string, entrada: string = ENTRADA_PADRAO) => JSON.stringify({ [entrada]: chave })

const COM_URL = { [VARIAVEIS_DAS_CHAVES.url]: URL_DO_PROJETO }
const NOVAS = {
  [VARIAVEIS_DAS_CHAVES.publicavelNova]: dicionario(PUBLICAVEL_NOVA),
  [VARIAVEIS_DAS_CHAVES.secretaNova]: dicionario(SECRETA_NOVA),
}
const LEGADAS = {
  [VARIAVEIS_DAS_CHAVES.anonLegada]: ANON_LEGADA,
  [VARIAVEIS_DAS_CHAVES.servicoLegada]: SERVICO_LEGADA,
}

/** O `Deno.env.get` de um ambiente com estas variáveis, e só elas. */
const ambiente =
  (variaveis: Record<string, string>) =>
  (nome: string): string | undefined =>
    variaveis[nome]

/** Todo texto que não pode aparecer num diagnóstico: as chaves e os pedaços delas. */
const SEGREDOS = [PUBLICAVEL_NOVA, SECRETA_NOVA, ANON_LEGADA, SERVICO_LEGADA, 'publicavel', 'secreta', 'anon-legada', 'servico-legada']

describe('resolverChaves — de onde saem as duas chaves da função', () => {
  it('só as novas: usa a entrada default dos dois dicionários', () => {
    const chaves = resolverChaves(ambiente({ ...COM_URL, ...NOVAS }))
    expect(chaves).toMatchObject({ ok: true, url: URL_DO_PROJETO, chavePublica: PUBLICAVEL_NOVA, chaveDeServico: SECRETA_NOVA })
    expect(chaves.diagnostico).toEqual({
      url: 'ok',
      chavePublica: { usada: 'nova', nova: 'ok', legada: 'ausente' },
      chaveDeServico: { usada: 'nova', nova: 'ok', legada: 'ausente' },
    })
  })

  it('só as legadas (o projeto antigo): usa a anon e a service_role', () => {
    const chaves = resolverChaves(ambiente({ ...COM_URL, ...LEGADAS }))
    expect(chaves).toMatchObject({ ok: true, url: URL_DO_PROJETO, chavePublica: ANON_LEGADA, chaveDeServico: SERVICO_LEGADA })
    expect(chaves.diagnostico).toEqual({
      url: 'ok',
      chavePublica: { usada: 'legada', nova: 'ausente', legada: 'ok' },
      chaveDeServico: { usada: 'legada', nova: 'ausente', legada: 'ok' },
    })
  })

  it('as duas: usa as novas', () => {
    const chaves = resolverChaves(ambiente({ ...COM_URL, ...NOVAS, ...LEGADAS }))
    expect(chaves).toMatchObject({ ok: true, chavePublica: PUBLICAVEL_NOVA, chaveDeServico: SECRETA_NOVA })
    expect(chaves.diagnostico.chavePublica).toEqual({ usada: 'nova', nova: 'ok', legada: 'ok' })
    expect(chaves.diagnostico.chaveDeServico).toEqual({ usada: 'nova', nova: 'ok', legada: 'ok' })
  })

  it('JSON inválido nas novas, com as legadas presentes: usa as legadas', () => {
    const chaves = resolverChaves(
      ambiente({
        ...COM_URL,
        // Colado pela metade, e um texto que nem é JSON.
        [VARIAVEIS_DAS_CHAVES.publicavelNova]: `{"${ENTRADA_PADRAO}": "${PUBLICAVEL_NOVA}"`,
        [VARIAVEIS_DAS_CHAVES.secretaNova]: SECRETA_NOVA,
        ...LEGADAS,
      }),
    )
    expect(chaves).toMatchObject({ ok: true, chavePublica: ANON_LEGADA, chaveDeServico: SERVICO_LEGADA })
    expect(chaves.diagnostico.chavePublica).toEqual({ usada: 'legada', nova: 'json_invalido', legada: 'ok' })
    expect(chaves.diagnostico.chaveDeServico).toEqual({ usada: 'legada', nova: 'json_invalido', legada: 'ok' })
  })

  it('nenhuma: é erro, e o diagnóstico diz o que falta sem chave nenhuma', () => {
    const chaves = resolverChaves(ambiente({ ...COM_URL }))
    expect(chaves.ok).toBe(false)
    expect(chaves).not.toHaveProperty('chavePublica')
    expect(chaves).not.toHaveProperty('chaveDeServico')
    expect(chaves.diagnostico).toEqual({
      url: 'ok',
      chavePublica: { usada: 'nenhuma', nova: 'ausente', legada: 'ausente' },
      chaveDeServico: { usada: 'nenhuma', nova: 'ausente', legada: 'ausente' },
    })
  })

  it('entrada default ausente: sem as legadas é erro; com elas, usa as legadas', () => {
    const semDefault = {
      ...COM_URL,
      // Uma chave com outro nome não vale pela padrão: pode ser a de outro serviço.
      [VARIAVEIS_DAS_CHAVES.publicavelNova]: dicionario(PUBLICAVEL_NOVA, 'web'),
      [VARIAVEIS_DAS_CHAVES.secretaNova]: dicionario(SECRETA_NOVA, 'cobranca'),
    }
    const sozinha = resolverChaves(ambiente(semDefault))
    expect(sozinha.ok).toBe(false)
    expect(sozinha.diagnostico.chavePublica).toEqual({ usada: 'nenhuma', nova: 'sem_default', legada: 'ausente' })
    expect(sozinha.diagnostico.chaveDeServico).toEqual({ usada: 'nenhuma', nova: 'sem_default', legada: 'ausente' })

    const comLegadas = resolverChaves(ambiente({ ...semDefault, ...LEGADAS }))
    expect(comLegadas).toMatchObject({ ok: true, chavePublica: ANON_LEGADA, chaveDeServico: SERVICO_LEGADA })
    expect(comLegadas.diagnostico.chavePublica.nova).toBe('sem_default')
  })

  it('cada chave decide sozinha: a nova que falta numa não derruba a nova da outra', () => {
    const chaves = resolverChaves(
      ambiente({ ...COM_URL, [VARIAVEIS_DAS_CHAVES.publicavelNova]: dicionario(PUBLICAVEL_NOVA), ...LEGADAS }),
    )
    expect(chaves).toMatchObject({ ok: true, chavePublica: PUBLICAVEL_NOVA, chaveDeServico: SERVICO_LEGADA })
  })

  it('sem o endereço do projeto é erro, mesmo com as duas chaves', () => {
    const chaves = resolverChaves(ambiente({ ...NOVAS, ...LEGADAS }))
    expect(chaves.ok).toBe(false)
    expect(chaves.diagnostico.url).toBe('ausente')
    expect(chaves.diagnostico.chavePublica.usada).toBe('nova')
  })

  it('o diagnóstico, que é o que vai para o log, nunca leva chave: nem a válida, nem o JSON colado pela metade', () => {
    const ambientes: Record<string, string>[] = [
      { ...COM_URL, ...NOVAS },
      { ...COM_URL, ...LEGADAS },
      { ...COM_URL, ...NOVAS, ...LEGADAS },
      { ...COM_URL, [VARIAVEIS_DAS_CHAVES.publicavelNova]: `{"${ENTRADA_PADRAO}": "${PUBLICAVEL_NOVA}"` },
      { ...COM_URL, [VARIAVEIS_DAS_CHAVES.secretaNova]: SECRETA_NOVA },
      { ...COM_URL, [VARIAVEIS_DAS_CHAVES.secretaNova]: dicionario(SECRETA_NOVA, 'outra') },
      { ...LEGADAS },
      {},
    ]
    for (const variaveis of ambientes) {
      const chaves = resolverChaves(ambiente(variaveis))
      const diagnostico = JSON.stringify(chaves.diagnostico)
      for (const segredo of SEGREDOS) expect(diagnostico, `${JSON.stringify(Object.keys(variaveis))}: ${segredo}`).not.toContain(segredo)
      // E a resposta de erro inteira também não: só o diagnóstico existe nela.
      if (!chaves.ok) {
        for (const segredo of SEGREDOS) expect(JSON.stringify(chaves)).not.toContain(segredo)
      }
    }
  })
})

describe('lerChaveNova — a entrada default de um dicionário de chaves', () => {
  it('lê a entrada default, sem espaço nas pontas', () => {
    expect(lerChaveNova(dicionario(` ${SECRETA_NOVA}\n`))).toEqual({ estado: 'ok', chave: SECRETA_NOVA })
    expect(lerChaveNova(JSON.stringify({ outra: 'x', [ENTRADA_PADRAO]: SECRETA_NOVA }))).toEqual({ estado: 'ok', chave: SECRETA_NOVA })
  })

  it('variável ausente ou em branco é ausente', () => {
    for (const valor of [undefined, null, '', '   ']) expect(lerChaveNova(valor)).toEqual({ estado: 'ausente' })
  })

  it('o que não é um dicionário JSON é JSON inválido: texto solto, lista, número, texto entre aspas', () => {
    for (const valor of [SECRETA_NOVA, '{', '[]', `["${SECRETA_NOVA}"]`, '42', `"${SECRETA_NOVA}"`, 'null']) {
      expect(lerChaveNova(valor), valor).toEqual({ estado: 'json_invalido' })
    }
  })

  it('a entrada default que falta, vazia ou fora do formato de texto conta como sem default', () => {
    for (const valor of ['{}', dicionario(SECRETA_NOVA, 'outra'), dicionario('  '), JSON.stringify({ [ENTRADA_PADRAO]: 42 }), JSON.stringify({ [ENTRADA_PADRAO]: null })]) {
      expect(lerChaveNova(valor), valor).toEqual({ estado: 'sem_default' })
    }
  })
})
