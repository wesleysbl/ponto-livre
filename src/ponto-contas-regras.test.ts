import { describe, expect, it } from 'vitest'
import {
  ACOES,
  CHAVES_DE_SENHA,
  DETALHE_MAXIMO,
  ErroDePorta,
  SENHA_PROVISORIA_MINIMO,
  acharEmailRepetido,
  conferirSenhaProvisoria,
  descreverEstado,
  emailEhValido,
  fraseDoEmailRepetido,
  lerPedido,
  lerToken,
  lugaresFeitos,
  montarLinhaDaTrilha,
  normalizarEmail,
  normalizarNome,
  semSenha,
  traduzirErroDaAuth,
  traduzirErroDePorta,
  traduzirErroDoBanco,
} from '../supabase/functions/ponto-contas/regras.ts'

/*
 * AS REGRAS PURAS DA EDGE FUNCTION DE CONTAS.
 *
 * O módulo mora em `supabase/functions/ponto-contas/` porque é parte da função
 * (vai junto no deploy), e é testado daqui porque o Vitest e o `tsc` do app
 * só olham `src/`. Importar daqui é também o que obriga o módulo a continuar
 * sem `Deno` e sem import de rede: se ele passar a usar, este arquivo deixa de
 * compilar.
 *
 * Os cenários:
 *   • senha provisória com regra mínima de tamanho, conferida no servidor;
 *   • e-mail recusado se já for usado no login, dizendo onde (o e-mail mora
 *     só no login; a ficha guarda o nome);
 *   • a trilha nunca leva a senha;
 *   • respostas e erros em português.
 */

const ID = '00000000-0000-4000-8000-0000000000aa'
const FICHA = '00000000-0000-4000-8000-0000000000f1'

describe('lerPedido', () => {
  it('aceita cada uma das quatro ações com os campos dela, já normalizados', () => {
    expect(
      lerPedido({ acao: 'criar_conta', email: '  Ana@Example.COM ', nome: '  Ana   Lima ', senha_provisoria: 'provisoria-1' }),
    ).toEqual({ ok: true, valor: { acao: 'criar_conta', email: 'ana@example.com', nome: 'Ana Lima', senhaProvisoria: 'provisoria-1' } })
    expect(
      lerPedido({ acao: 'criar_conta', email: 'ana@example.com', nome: 'Ana Lima', senha_provisoria: 'provisoria-1', ficha_id: FICHA.toUpperCase() }),
    ).toEqual({
      ok: true,
      valor: { acao: 'criar_conta', email: 'ana@example.com', nome: 'Ana Lima', senhaProvisoria: 'provisoria-1', fichaId: FICHA },
    })
    expect(lerPedido({ acao: 'trocar_nome', usuario_id: ID.toUpperCase(), nome: 'Ana Lima' })).toEqual({
      ok: true,
      valor: { acao: 'trocar_nome', usuarioId: ID, nome: 'Ana Lima' },
    })
    expect(lerPedido({ acao: 'trocar_email', usuario_id: ID, email: 'nova@example.com' })).toEqual({
      ok: true,
      valor: { acao: 'trocar_email', usuarioId: ID, email: 'nova@example.com' },
    })
    expect(lerPedido({ acao: 'redefinir_senha', usuario_id: ID, senha_provisoria: 'outra-senha-9' })).toEqual({
      ok: true,
      valor: { acao: 'redefinir_senha', usuarioId: ID, senhaProvisoria: 'outra-senha-9' },
    })
  })

  it('recusa o que não é objeto e a ação desconhecida, dizendo as ações que existem', () => {
    for (const corpo of [null, 'criar_conta', [], 42]) {
      const leitura = lerPedido(corpo)
      expect(leitura.ok).toBe(false)
    }
    const leitura = lerPedido({ acao: 'apagar_conta', usuario_id: ID })
    expect(leitura).toEqual({ ok: false, erros: [`Diga a ação: ${ACOES.join(', ')}.`] })
  })

  it('recusa campo que a ação não usa — e uma senha no trocar_nome é o caso que importa', () => {
    const leitura = lerPedido({ acao: 'trocar_nome', usuario_id: ID, nome: 'Ana Lima', senha_provisoria: 'x' })
    expect(leitura.ok).toBe(false)
    if (!leitura.ok) expect(leitura.erros).toContain('Campo que trocar_nome não usa: senha_provisoria.')
  })

  it('junta todos os erros de uma vez', () => {
    const leitura = lerPedido({ acao: 'criar_conta', email: 'sem-arroba', nome: '', senha_provisoria: '123' })
    expect(leitura.ok).toBe(false)
    if (!leitura.ok) {
      expect(leitura.erros).toEqual([
        'Isto não parece um e-mail: “sem-arroba”.',
        'O nome está vazio.',
        `A senha provisória precisa ter pelo menos ${SENHA_PROVISORIA_MINIMO} caracteres.`,
      ])
    }
  })

  it('ficha_id do criar_conta: ausente ou nulo é conta sem ficha; presente, tem de ser o id de uma ficha', () => {
    const base = { acao: 'criar_conta', email: 'ana@example.com', nome: 'Ana Lima', senha_provisoria: 'provisoria-1' }
    for (const corpo of [base, { ...base, ficha_id: null }]) {
      const leitura = lerPedido(corpo)
      expect(leitura.ok).toBe(true)
      if (leitura.ok) expect(leitura.valor).not.toHaveProperty('fichaId')
    }
    const torto = lerPedido({ ...base, ficha_id: 'ficha-1' })
    const vazio = lerPedido({ ...base, ficha_id: '  ' })
    const numero = lerPedido({ ...base, ficha_id: 7 })
    expect(torto.ok || torto.erros).toEqual(['O ficha_id não é o identificador de uma ficha.'])
    expect(vazio.ok || vazio.erros).toEqual(['O ficha_id está vazio: mande o id da ficha, ou não mande o campo.'])
    expect(numero.ok || numero.erros).toEqual(['O ficha_id não é o identificador de uma ficha.'])
    // Só o criar_conta aceita: nas outras ações é campo a mais.
    const noNome = lerPedido({ acao: 'trocar_nome', usuario_id: ID, nome: 'Ana Lima', ficha_id: FICHA })
    expect(noNome.ok || noNome.erros).toEqual(['Campo que trocar_nome não usa: ficha_id.'])
  })

  it('confere o usuario_id: vazio e fora do formato de uma conta', () => {
    const vazio = lerPedido({ acao: 'trocar_email', email: 'a@example.com' })
    const torto = lerPedido({ acao: 'trocar_email', usuario_id: 'abc', email: 'a@example.com' })
    expect(vazio.ok || vazio.erros).toEqual(['Diga de qual conta (usuario_id).'])
    expect(torto.ok || torto.erros).toEqual(['O usuario_id não é o identificador de uma conta.'])
  })

  it('confere o nome: curto, longo e sem letra', () => {
    const erros = (nome: string) => {
      const leitura = lerPedido({ acao: 'trocar_nome', usuario_id: ID, nome })
      return leitura.ok ? [] : leitura.erros
    }
    expect(erros('A')).toEqual(['O nome precisa ter pelo menos 2 letras.'])
    expect(erros('Ã'.repeat(121))).toEqual(['O nome passa de 120 caracteres.'])
    expect(erros('123 456')).toEqual(['O nome precisa ter letras.'])
    expect(erros('Zé')).toEqual([])
  })
})

describe('e-mail e nome', () => {
  it('normaliza o e-mail como o login guarda', () => {
    expect(normalizarEmail('  Fulano@Sub.Example.COM ')).toBe('fulano@sub.example.com')
    expect(normalizarEmail(null)).toBe('')
  })

  it('aceita o formato essencial e recusa o resto', () => {
    expect(emailEhValido('joao_silva+ponto@mail.example.com')).toBe(true)
    expect(emailEhValido('sem-arroba.com')).toBe(false)
    expect(emailEhValido('com espaco@example.com')).toBe(false)
    expect(emailEhValido('sem@ponto')).toBe(false)
    expect(emailEhValido(`${'a'.repeat(243)}@example.com`)).toBe(false)
  })

  it('tira espaço das pontas e o repetido do meio do nome', () => {
    expect(normalizarNome('  Bruna   Costa  ')).toBe('Bruna Costa')
  })
})

describe('conferirSenhaProvisoria — a regra mínima, no servidor', () => {
  it(`aceita a partir de ${SENHA_PROVISORIA_MINIMO} caracteres e recusa abaixo`, () => {
    expect(conferirSenhaProvisoria('a'.repeat(SENHA_PROVISORIA_MINIMO))).toEqual([])
    expect(conferirSenhaProvisoria('a'.repeat(SENHA_PROVISORIA_MINIMO - 1))).toEqual([
      `A senha provisória precisa ter pelo menos ${SENHA_PROVISORIA_MINIMO} caracteres.`,
    ])
  })

  it('conta caractere, não byte, no mínimo; e byte no máximo do bcrypt', () => {
    // 8 letras acentuadas = 16 bytes: passa no mínimo.
    expect(conferirSenhaProvisoria('áéíóúãõç')).toEqual([])
    // 36 × 2 bytes = 72: no limite. 37 × 2 = 74: acima.
    expect(conferirSenhaProvisoria('á'.repeat(36))).toEqual([])
    expect(conferirSenhaProvisoria('á'.repeat(37))).toEqual([
      'A senha provisória passa do limite do login (72 bytes; letra acentuada conta 2).',
    ])
  })

  it('recusa vazio, só espaço e espaço nas pontas (sem apagar: a senha entregue seria outra)', () => {
    expect(conferirSenhaProvisoria('')).toEqual(['A senha provisória está vazia.'])
    expect(conferirSenhaProvisoria(undefined)).toEqual(['A senha provisória está vazia.'])
    expect(conferirSenhaProvisoria('         ')).toEqual(['A senha provisória não pode ser só espaço.'])
    expect(conferirSenhaProvisoria(' senha-longa')).toEqual(['A senha provisória não pode começar nem terminar com espaço.'])
  })

  it('recusa a senha igual ao e-mail da conta, sem olhar maiúscula', () => {
    expect(conferirSenhaProvisoria('Ana@Example.com', 'ana@example.com')).toEqual([
      'A senha provisória não pode ser o próprio e-mail.',
    ])
    expect(conferirSenhaProvisoria('Ana@Example.com', 'outra@example.com')).toEqual([])
  })
})

describe('lerToken', () => {
  it('lê o Bearer e recusa qualquer outra forma', () => {
    expect(lerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(lerToken('bearer abc')).toBe('abc')
    expect(lerToken(null)).toBeNull()
    expect(lerToken('')).toBeNull()
    expect(lerToken('Bearer')).toBeNull()
    expect(lerToken('Basic dXNlcjpzZW5oYQ==')).toBeNull()
    expect(lerToken('Bearer a b')).toBeNull()
  })
})

describe('acharEmailRepetido — "a tela diz onde"', () => {
  const logins = [
    { id: 'a', email: 'ana@example.com' },
    { id: 'b', email: 'BIA@example.com' },
    { id: 'c', email: null },
  ]

  it('o e-mail de outro login é repetido, e o lugar dito é o login', () => {
    expect(acharEmailRepetido('ana@example.com', logins, null)).toBe('login')
    expect(acharEmailRepetido('nova@example.com', logins, null)).toBeNull()
    expect(acharEmailRepetido('nova@example.com', [], null)).toBeNull()
  })

  it('não conta a própria conta, e não olha maiúscula nem espaço', () => {
    expect(acharEmailRepetido('bia@example.com', logins, 'b')).toBeNull()
    expect(acharEmailRepetido(' Bia@Example.com ', logins, 'a')).toBe('login')
  })

  it('a frase diz onde e que nada mudou', () => {
    expect(fraseDoEmailRepetido('ana@example.com')).toBe(
      'O e-mail ana@example.com já é o login de outra conta. Nada mudou: escolha outro e-mail, ou resolva a outra conta antes.',
    )
  })
})

describe('a trilha nunca leva a senha', () => {
  it('semSenha tira as chaves de senha em qualquer nível, e só elas', () => {
    const sujo = {
      login: { email: 'a@example.com', senha_provisoria: 'segredo-1' },
      passos: [{ passo: 'login', dados: { Password: 'segredo-2', nova_senha: 'segredo-3' } }],
      senha: 'segredo-4',
      nota: 'a senha provisória foi definida',
    }
    const limpo = semSenha(sujo)
    expect(limpo).toEqual({
      login: { email: 'a@example.com' },
      passos: [{ passo: 'login', dados: {} }],
      nota: 'a senha provisória foi definida',
    })
    expect(JSON.stringify(limpo)).not.toMatch(/segredo/)
    // Não muda o original.
    expect(sujo.login.senha_provisoria).toBe('segredo-1')
  })

  it('as chaves recusadas são as cinco do CHECK do banco, em minúsculas', () => {
    expect([...CHAVES_DE_SENHA]).toEqual(['senha', 'password', 'senha_provisoria', 'senhaprovisoria', 'nova_senha'])
  })

  // `senhaProvisoria` (camelCase) é a chave que uma comparação sensível a maiúsculas deixaria passar.
  it('semSenha tira a chave de senha sem diferenciar maiúsculas, inclusive senhaProvisoria', () => {
    const limpo = semSenha({
      login: { senhaProvisoria: 'segredo-1', SENHA: 'segredo-2', email: 'a@example.com' },
      passos: [{ dados: { SenhaProvisoria: 'segredo-3', Nova_Senha: 'segredo-4', PASSWORD: 'segredo-5' } }],
    })
    expect(limpo).toEqual({ login: { email: 'a@example.com' }, passos: [{ dados: {} }] })
    expect(JSON.stringify(limpo)).not.toMatch(/segredo/)
  })

  it('montarLinhaDaTrilha limpa, corta o detalhe no teto do banco e não grava detalhe em branco', () => {
    const base = {
      acao: 'redefinir_senha' as const,
      resultado: 'feito' as const,
      autor: { id: 'autor', email: 'admin@example.com' },
      alvoUsuarioId: 'alvo',
      antes: { login: { email: 'a@example.com' } },
      depois: { login: { email: 'a@example.com', senha: 'segredo' } },
      passos: [{ passo: 'login' as const, estado: 'feito' as const }],
    }
    const linha = montarLinhaDaTrilha({ ...base, detalhe: '   ' })
    expect(linha).toEqual({
      acao: 'redefinir_senha',
      resultado: 'feito',
      autor_id: 'autor',
      autor_email: 'admin@example.com',
      alvo_usuario_id: 'alvo',
      antes: { login: { email: 'a@example.com' } },
      depois: { login: { email: 'a@example.com' } },
      passos: [{ passo: 'login', estado: 'feito' }],
      detalhe: null,
    })
    expect(montarLinhaDaTrilha({ ...base, detalhe: 'x'.repeat(3000) }).detalhe).toHaveLength(DETALHE_MAXIMO)
  })
})

describe('os erros do login, em português', () => {
  it('e-mail já usado: pelo código e pela frase antiga', () => {
    expect(traduzirErroDaAuth({ codigo: 'email_exists', status: 422, mensagem: 'x' })).toMatchObject({
      status: 409,
      codigo: 'email_ja_usado',
      onde: 'login',
    })
    expect(
      traduzirErroDaAuth({ mensagem: 'A user with this email address has already been registered' }).codigo,
    ).toBe('email_ja_usado')
  })

  it('senha fraca, com os motivos do login traduzidos', () => {
    const falha = traduzirErroDaAuth({ codigo: 'weak_password', status: 422, mensagem: 'Password is weak', motivos: ['length', 'pwned'] })
    expect(falha.status).toBe(400)
    expect(falha.codigo).toBe('senha_recusada')
    expect(falha.mensagem).toBe(
      'O login recusou a senha provisória: ela é curta demais para a regra do login; aparece em vazamentos de senha conhecidos. Escolha outra.',
    )
    expect(traduzirErroDaAuth({ mensagem: 'Password should be at least 10 characters.' }).codigo).toBe('senha_recusada')
  })

  it('conta que não existe, pressa e chave de serviço recusada', () => {
    expect(traduzirErroDaAuth({ codigo: 'user_not_found', status: 404, mensagem: 'User not found' }).status).toBe(404)
    expect(traduzirErroDaAuth({ status: 429, mensagem: 'rate limit' }).codigo).toBe('muitas_tentativas')
    expect(traduzirErroDaAuth({ codigo: 'not_admin', status: 403, mensagem: 'User not allowed' })).toMatchObject({
      status: 500,
      codigo: 'configuracao_incompleta',
    })
  })

  it('rede e o desconhecido', () => {
    expect(traduzirErroDaAuth({ mensagem: 'TypeError: fetch failed' }).status).toBe(503)
    expect(traduzirErroDaAuth({ status: 500, mensagem: 'Database error saving new user' })).toEqual({
      status: 502,
      codigo: 'erro_do_login',
      mensagem: 'O login respondeu com erro: Database error saving new user',
    })
  })
})

describe('os erros do banco, em português', () => {
  it('permissão, banco sem a peça, repetido, valor recusado, sessão vencida e zero linhas', () => {
    expect(traduzirErroDoBanco({ codigo: '42501', mensagem: 'permission denied for table ponto_contas_trilha' }).status).toBe(403)
    expect(
      traduzirErroDoBanco({ codigo: 'PGRST202', mensagem: 'Could not find the function public.ponto_contas_trilha_pronta' }),
    ).toMatchObject({ status: 503, codigo: 'banco_incompleto' })
    expect(traduzirErroDoBanco({ codigo: '23505', mensagem: 'duplicate key' }).status).toBe(409)
    expect(traduzirErroDoBanco({ codigo: '23514', mensagem: 'violates check constraint' }).status).toBe(400)
    expect(traduzirErroDoBanco({ codigo: 'PGRST301', mensagem: 'JWT expired' }).codigo).toBe('sessao_invalida')
    expect(traduzirErroDoBanco({ codigo: 'nenhuma_linha', mensagem: 'O banco não mudou a ficha.' })).toEqual({
      status: 409,
      codigo: 'banco_recusou',
      mensagem: 'O banco não mudou a ficha.',
    })
  })

  it('traduzirErroDePorta separa a origem, e o que não é porta é defeito com nome', () => {
    expect(traduzirErroDePorta(new ErroDePorta('auth', 'x', { codigo: 'email_exists' })).codigo).toBe('email_ja_usado')
    expect(traduzirErroDePorta(new ErroDePorta('sessao', 'invalid JWT')).status).toBe(401)
    expect(traduzirErroDePorta(new ErroDePorta('banco', 'x', { codigo: '42501' })).status).toBe(403)
    expect(traduzirErroDePorta(new TypeError('Cannot read properties of undefined'))).toEqual({
      status: 500,
      codigo: 'erro_inesperado',
      mensagem: 'Erro inesperado na função de contas: Cannot read properties of undefined',
    })
    expect(traduzirErroDePorta(new Error('fetch failed')).status).toBe(503)
  })
})

describe('as frases do resultado', () => {
  it('descreve o estado exato de cada lugar depois de uma falha no meio', () => {
    expect(
      descreverEstado([
        { passo: 'login', estado: 'nao_desfeito' },
        { passo: 'ficha', estado: 'falhou' },
      ]),
    ).toBe('O login MUDOU E NÃO VOLTOU e a ficha não mudou.')
    expect(
      descreverEstado([
        { passo: 'login', estado: 'desfeito' },
        { passo: 'ficha', estado: 'falhou' },
      ]),
    ).toBe('O login mudou e voltou ao que era e a ficha não mudou.')
    expect(descreverEstado([{ passo: 'login', estado: 'feito' }])).toBe('O login mudou.')
  })

  it('lista os lugares que mudaram', () => {
    expect(
      lugaresFeitos([
        { passo: 'login', estado: 'feito' },
        { passo: 'ficha', estado: 'feito' },
      ]),
    ).toBe('o login e a ficha')
    expect(lugaresFeitos([{ passo: 'login', estado: 'feito' }])).toBe('o login')
    expect(
      lugaresFeitos([
        { passo: 'login', estado: 'desfeito' },
        { passo: 'ficha', estado: 'falhou' },
      ]),
    ).toBe('')
  })
})
