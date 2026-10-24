import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { lerPedido, SENHA_PROVISORIA_MINIMO } from '../../supabase/functions/ponto-contas/regras.ts'
import {
  falhaDoErroDaFuncao,
  falhaPedeReleitura,
  frasesDaFalha,
  gerarSenhaProvisoria,
  lerFalhaDaFuncao,
  lerSucessoDaFuncao,
  TAMANHO_DA_SENHA_SUGERIDA,
  validarNovaConta,
  validarNovaSenha,
  validarTrocaDeEmail,
  validarTrocaDeNome,
  type Sorteio,
} from './contas'

/*
 * A CAMADA DE CONTAS DO APP, as partes puras: os formulários, a
 * senha sugerida e a leitura do que a Edge Function `ponto-contas` responde.
 *
 * O que estes testes seguram:
 *   • o corpo que a tela manda é EXATAMENTE o que a função aceita — ela recusa
 *     campo a mais, então um campo sobrando aqui quebraria toda ação de conta
 *     em produção, sem nenhum teste da função perceber;
 *   • a validação da tela é a do servidor (o mesmo `lerPedido`), e diz todas
 *     as frases de uma vez;
 *   • a recusa da função chega à tela com o código, o "onde" do e-mail repetido
 *     e o aviso de "a ação aconteceu mesmo assim" — e a recusa que NÃO é da
 *     função (a função não publicada, a rede) vira frase em português, e não
 *     "erro 404".
 */

const CONTA = '00000000-0000-4000-8000-000000000003'

describe('os formulários usam a regra do servidor', () => {
  it('conta nova válida vira o corpo do contrato, com nome e e-mail normalizados', () => {
    const leitura = validarNovaConta({
      nome: '  Ana   Lima ',
      email: ' Ana.Lima@Example.com ',
      senha: 'Provisoria#24',
    })
    expect(leitura).toEqual({
      ok: true,
      valor: {
        acao: 'criar_conta',
        email: 'ana.lima@example.com',
        nome: 'Ana Lima',
        senha_provisoria: 'Provisoria#24',
      },
    })
  })

  it('todas as frases de uma vez, e em português', () => {
    const leitura = validarNovaConta({ nome: '', email: 'sem-arroba', senha: 'curta' })
    expect(leitura.ok).toBe(false)
    if (leitura.ok) return
    expect(leitura.erros.length).toBeGreaterThanOrEqual(3)
    expect(leitura.erros.join(' ')).toMatch(/nome/i)
    expect(leitura.erros.join(' ')).toMatch(/e-mail/i)
    expect(leitura.erros.join(' ')).toContain(String(SENHA_PROVISORIA_MINIMO))
  })

  it('a senha com espaço na ponta é recusada, e não aparada (a pessoa receberia outra)', () => {
    const leitura = validarNovaConta({ nome: 'Ana', email: 'ana@example.com', senha: ' Provisoria#24' })
    expect(leitura.ok).toBe(false)
  })

  it('trocar nome, trocar e-mail e redefinir senha montam o corpo de cada ação', () => {
    expect(validarTrocaDeNome(CONTA, ' Ana  Paula ')).toEqual({
      ok: true,
      valor: { acao: 'trocar_nome', usuario_id: CONTA, nome: 'Ana Paula' },
    })
    expect(validarTrocaDeEmail(CONTA, 'NOVO@example.com')).toEqual({
      ok: true,
      valor: { acao: 'trocar_email', usuario_id: CONTA, email: 'novo@example.com' },
    })
    expect(validarNovaSenha(CONTA, 'Outra#Senha9', 'ana@example.com')).toEqual({
      ok: true,
      valor: { acao: 'redefinir_senha', usuario_id: CONTA, senha_provisoria: 'Outra#Senha9' },
    })
  })

  it('a senha nova não pode ser o e-mail da conta — avisado antes de viajar', () => {
    const leitura = validarNovaSenha(CONTA, 'ana.lima@example.com', 'Ana.Lima@example.com')
    expect(leitura.ok).toBe(false)
    if (leitura.ok) return
    expect(leitura.erros.join(' ')).toMatch(/e-mail/)
  })

  it('o corpo que a tela manda é aceito pelo lerPedido da função, sem campo a mais', () => {
    const corpos = [
      validarNovaConta({ nome: 'Ana Lima', email: 'ana@example.com', senha: 'Provisoria#24' }),
      validarTrocaDeNome(CONTA, 'Ana Lima'),
      validarTrocaDeEmail(CONTA, 'ana@example.com'),
      validarNovaSenha(CONTA, 'Provisoria#24', 'ana@example.com'),
    ]
    for (const leitura of corpos) {
      expect(leitura.ok).toBe(true)
      if (!leitura.ok) continue
      const doServidor = lerPedido(JSON.parse(JSON.stringify(leitura.valor)))
      expect(doServidor.ok, JSON.stringify(doServidor)).toBe(true)
    }
  })
})

describe('gerarSenhaProvisoria', () => {
  /** Um sorteio previsível: percorre os valores, para o teste não depender da sorte. */
  function sorteioCiclico(): Sorteio {
    let n = 0
    return (limite) => n++ % limite
  }

  it('passa na regra do servidor, com um de cada tipo de caractere', () => {
    for (let i = 0; i < 50; i++) {
      const senha = gerarSenhaProvisoria()
      expect(senha).toHaveLength(TAMANHO_DA_SENHA_SUGERIDA)
      expect(senha).toMatch(/[a-z]/)
      expect(senha).toMatch(/[A-Z]/)
      expect(senha).toMatch(/[0-9]/)
      expect(senha).toMatch(/[#!?]/)
      expect(senha).not.toMatch(/[0O1lI*_~`\s]/)
      expect(validarNovaConta({ nome: 'Ana', email: 'ana@example.com', senha }).ok).toBe(true)
    }
  })

  it('sem os caracteres que se confundem nem os que o WhatsApp come', () => {
    const senha = gerarSenhaProvisoria(sorteioCiclico())
    expect(senha).not.toMatch(/[0O1lI*_~`\s]/)
  })

  it('o sorteio injetado manda: o mesmo sorteio dá a mesma senha', () => {
    expect(gerarSenhaProvisoria(sorteioCiclico())).toBe(gerarSenhaProvisoria(sorteioCiclico()))
  })
})

describe('lerSucessoDaFuncao — a resposta 200', () => {
  it('lê o corpo do contrato com os nomes da tela', () => {
    expect(
      lerSucessoDaFuncao({
        ok: true,
        acao: 'criar_conta',
        usuario_id: CONTA,
        mensagem: 'Conta criada.',
        passos: [{ passo: 'login', estado: 'feito' }, { lixo: true }],
        trilha_id: 't1',
      }),
    ).toEqual({
      acao: 'criar_conta',
      usuarioId: CONTA,
      mensagem: 'Conta criada.',
      passos: [{ passo: 'login', estado: 'feito' }],
      trilhaId: 't1',
    })
  })

  it('corpo que não é o do contrato NÃO é sucesso', () => {
    expect(lerSucessoDaFuncao('ok')).toBeNull()
    expect(lerSucessoDaFuncao({ ok: true })).toBeNull()
    expect(lerSucessoDaFuncao({ ok: false, codigo: 'x', mensagem: 'y' })).toBeNull()
  })
})

describe('lerFalhaDaFuncao — as recusas', () => {
  it('a recusa da função passa com a frase dela, o código e o "onde"', () => {
    const falha = lerFalhaDaFuncao(409, {
      ok: false,
      codigo: 'email_ja_usado',
      mensagem: 'O e-mail ana@example.com já existe no login de outra conta. Nada mudou.',
      onde: 'login',
    })
    expect(falha.codigo).toBe('email_ja_usado')
    expect(falha.onde).toBe('login')
    expect(falha.mensagem).toContain('login de outra conta')
    expect(falha.acaoFeita).toBe(false)
    expect(falhaPedeReleitura(falha)).toBe(false)
  })

  it('pedido inválido traz a lista, e a tela mostra a lista', () => {
    const falha = lerFalhaDaFuncao(400, {
      ok: false,
      codigo: 'pedido_invalido',
      mensagem: 'O nome está vazio. O e-mail está vazio.',
      erros: ['O nome está vazio.', 'O e-mail está vazio.', 7],
    })
    expect(frasesDaFalha(falha)).toEqual(['O nome está vazio.', 'O e-mail está vazio.'])
  })

  it('"a ação aconteceu, mas a trilha não gravou" pede releitura da lista', () => {
    const falha = lerFalhaDaFuncao(500, {
      ok: false,
      codigo: 'trilha_nao_gravou',
      mensagem: 'O login mudou. Mas a linha da trilha NÃO gravou.',
      acao_feita: true,
      passos: [{ passo: 'login', estado: 'feito' }],
    })
    expect(falha.acaoFeita).toBe(true)
    expect(falha.passos).toHaveLength(1)
    expect(falhaPedeReleitura(falha)).toBe(true)
  })

  it('ficou pela metade também pede releitura; desfeito, não', () => {
    expect(
      falhaPedeReleitura(lerFalhaDaFuncao(500, { ok: false, codigo: 'falhou_no_meio', mensagem: 'x' })),
    ).toBe(true)
    expect(
      falhaPedeReleitura(lerFalhaDaFuncao(500, { ok: false, codigo: 'falhou_e_desfez', mensagem: 'x' })),
    ).toBe(false)
  })

  it('404 sem o corpo do contrato: a função não está publicada, dito com essas palavras', () => {
    const falha = lerFalhaDaFuncao(404, { code: 'NOT_FOUND', message: 'Requested function was not found' })
    expect(falha.codigo).toBe('funcao_nao_publicada')
    expect(falha.mensagem).toMatch(/não está publicada/)
    expect(falha.mensagem).toMatch(/Nada foi alterado/)
    expect(falha.mensagem).not.toMatch(/404|NOT_FOUND/)
  })

  it('401 e 403 do gateway viram sessão e super admin', () => {
    expect(lerFalhaDaFuncao(401, { message: 'Invalid JWT' }).codigo).toBe('sessao_invalida')
    expect(lerFalhaDaFuncao(403, null).codigo).toBe('nao_e_super_admin')
  })

  it('sem resposta NÃO diz "nada mudou": manda conferir antes de repetir', () => {
    const falha = lerFalhaDaFuncao(null, null)
    expect(falha.codigo).toBe('sem_conexao_com_a_funcao')
    expect(falha.mensagem).not.toMatch(/nada (foi alterado|mudou)/i)
    expect(falha.mensagem).toMatch(/confira/)
    expect(falhaPedeReleitura(falha)).toBe(true)
  })

  it('5xx sem corpo também não promete nada', () => {
    const falha = lerFalhaDaFuncao(502, '<html>Bad gateway</html>')
    expect(falha.codigo).toBe('resposta_inesperada')
    expect(falha.mensagem).not.toMatch(/nada (foi alterado|mudou)/i)
    expect(falhaPedeReleitura(falha)).toBe(true)
  })
})

describe('falhaDoErroDaFuncao — o erro do supabase-js', () => {
  const resposta = (status: number, corpo: unknown) =>
    new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  it('FunctionsHttpError: o corpo da Response é lido', async () => {
    const erro = new FunctionsHttpError(
      resposta(403, { ok: false, codigo: 'nao_e_super_admin', mensagem: 'Mexer em contas é exclusivo do super admin do ponto. Nada foi alterado.' }),
    )
    const falha = await falhaDoErroDaFuncao(erro)
    expect(falha.codigo).toBe('nao_e_super_admin')
    expect(falha.status).toBe(403)
  })

  it('FunctionsHttpError com corpo que não é JSON: cai na frase pelo HTTP', async () => {
    const erro = new FunctionsHttpError(new Response('not found', { status: 404 }))
    expect((await falhaDoErroDaFuncao(erro)).codigo).toBe('funcao_nao_publicada')
  })

  it('FunctionsFetchError (nem houve resposta): sem conexão', async () => {
    const erro = new FunctionsFetchError(new TypeError('Failed to fetch'))
    expect((await falhaDoErroDaFuncao(erro)).codigo).toBe('sem_conexao_com_a_funcao')
  })

  it('qualquer outra coisa também não quebra a tela', async () => {
    expect((await falhaDoErroDaFuncao('???')).codigo).toBe('sem_conexao_com_a_funcao')
  })
})
