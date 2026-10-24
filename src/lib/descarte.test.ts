import { describe, expect, it } from 'vitest'
import {
  BATIDA_INCERTA,
  destinoDaSelfie,
  ehRecusaDoBanco,
  MOTIVOS_DE_RECUSA_DEFINITIVA,
  MOTIVOS_DE_RECUSA_DEFINITIVA_DO_PEDIDO,
  PEDIDO_INCERTO,
  type DesfechoDaGravacao,
} from './descarte'

/*
 * O DEFEITO QUE ESTES TESTES IMPEDEM: `registrarBatida` descartar a selfie em
 * QUALQUER falha da RPC. Com a resposta perdida (4G caiu, 504 do gateway,
 * `Failed to fetch`), o servidor pode ter gravado a batida — e, na sessão de um
 * admin do ponto, o descarte apagaria a prova dela.
 */

const resposta = (dados: unknown): DesfechoDaGravacao => ({ tipo: 'resposta', dados })
const erro = (status: number | null, codigo: string | null): DesfechoDaGravacao => ({ tipo: 'erro', status, codigo })

describe('destinoDaSelfie — o banco respondeu', () => {
  it('batida gravada: a foto é a prova e fica', () => {
    expect(destinoDaSelfie(resposta({ gravado: true, registro: { id: 'r1' } }))).toBe('manter')
  })

  it.each(MOTIVOS_DE_RECUSA_DEFINITIVA)('recusa definitiva "%s": a foto é órfã e sai', (motivo) => {
    expect(destinoDaSelfie(resposta({ gravado: false, motivo }))).toBe('descartar')
  })

  it('os motivos conhecidos são os da RPC de hoje', () => {
    expect([...MOTIVOS_DE_RECUSA_DEFINITIVA].sort()).toEqual(
      ['batida_duplicada', 'bloqueado', 'pin_incorreto', 'pin_nao_definido', 'precisa_redefinir'].sort(),
    )
  })

  it('recusa com motivo que o app não conhece: não grava, e a foto fica por via das dúvidas', () => {
    expect(destinoDaSelfie(resposta({ gravado: false, motivo: 'motivo_novo_do_banco' }))).toBe('manter')
    expect(destinoDaSelfie(resposta({ gravado: false }))).toBe('manter')
  })

  it('resposta sem forma reconhecível é incerta', () => {
    expect(destinoDaSelfie(resposta(null))).toBe('incerto')
    expect(destinoDaSelfie(resposta(undefined))).toBe('incerto')
    expect(destinoDaSelfie(resposta('<html>502 Bad Gateway</html>'))).toBe('incerto')
    expect(destinoDaSelfie(resposta({}))).toBe('incerto')
    expect(destinoDaSelfie(resposta({ gravado: 'talvez' }))).toBe('incerto')
  })
})

describe('destinoDaSelfie — a chamada falhou', () => {
  it('rede caída ou resposta perdida (postgrest-js devolve status 0, sem código): NÃO descarta', () => {
    expect(destinoDaSelfie(erro(0, null))).toBe('incerto')
    expect(destinoDaSelfie(erro(0, 'ECONNRESET'))).toBe('incerto')
    expect(destinoDaSelfie(erro(null, null))).toBe('incerto')
  })

  it('5xx (gateway, timeout do banco, erro interno): NÃO descarta', () => {
    expect(destinoDaSelfie(erro(504, null))).toBe('incerto')
    expect(destinoDaSelfie(erro(502, null))).toBe('incerto')
    expect(destinoDaSelfie(erro(500, '57014'))).toBe('incerto')
    expect(destinoDaSelfie(erro(503, '08006'))).toBe('incerto')
    expect(destinoDaSelfie(erro(500, 'XX000'))).toBe('incerto')
  })

  it('408, 429 e códigos do próprio PostgREST: NÃO descarta', () => {
    expect(destinoDaSelfie(erro(408, null))).toBe('incerto')
    expect(destinoDaSelfie(erro(429, null))).toBe('incerto')
    expect(destinoDaSelfie(erro(401, 'PGRST301'))).toBe('incerto')
    expect(destinoDaSelfie(erro(406, 'PGRST116'))).toBe('incerto')
  })

  it('exceção na chamada: NÃO descarta', () => {
    expect(destinoDaSelfie({ tipo: 'excecao' })).toBe('incerto')
  })

  it('recusa levantada pelo Postgres dentro da RPC (a transação voltou): descarta', () => {
    // "Conta sem acesso" (42501), "Coordenada fora..." (22023), RAISE comum.
    expect(destinoDaSelfie(erro(403, '42501'))).toBe('descartar')
    expect(destinoDaSelfie(erro(400, '22023'))).toBe('descartar')
    expect(destinoDaSelfie(erro(400, 'P0001'))).toBe('descartar')
    expect(destinoDaSelfie(erro(409, '23505'))).toBe('descartar')
  })

  it('erro do Postgres das classes de conexão, concorrência, recursos e tempo não é recusa, nem num 4xx', () => {
    for (const codigo of ['08006', '40001', '53300', '57014', '58030', 'XX000']) {
      expect(ehRecusaDoBanco(400, codigo)).toBe(false)
    }
  })
})

describe('o texto da batida não confirmada', () => {
  it('manda conferir a lista antes de bater de novo, e não diz que nada foi gravado', () => {
    const tudo = Object.values(BATIDA_INCERTA).join(' ')
    expect(BATIDA_INCERTA.mensagem).toMatch(/pode ter sido gravada/)
    expect(BATIDA_INCERTA.comoResolver).toMatch(/Confira suas batidas de hoje antes de bater de novo/)
    expect(tudo).not.toMatch(/Nada foi gravado|não foi registrada/i)
  })
})

/*
 * O PEDIDO DE BATIDA EM ATRASO segue a mesma regra: `pedirBatidaEmAtraso` não
 * descarta a foto em qualquer falha da RPC — na resposta perdida, o pedido pode
 * ter gravado.
 */
describe('destinoDaSelfie — o pedido de batida em atraso', () => {
  const pedido = (d: DesfechoDaGravacao) => destinoDaSelfie(d, MOTIVOS_DE_RECUSA_DEFINITIVA_DO_PEDIDO)

  it('os motivos do pedido são os de ponto_pedir_batida_em_atraso: os do PIN e pedido_duplicado', () => {
    expect([...MOTIVOS_DE_RECUSA_DEFINITIVA_DO_PEDIDO].sort()).toEqual(
      ['bloqueado', 'pedido_duplicado', 'pin_incorreto', 'pin_nao_definido', 'precisa_redefinir'].sort(),
    )
  })

  it.each(MOTIVOS_DE_RECUSA_DEFINITIVA_DO_PEDIDO)('recusa definitiva do pedido "%s": a foto sai', (motivo) => {
    expect(pedido(resposta({ gravado: false, motivo }))).toBe('descartar')
  })

  it('pedido gravado: a foto fica', () => {
    expect(pedido(resposta({ gravado: true, pedido: { id: 'p1' } }))).toBe('manter')
  })

  it('batida_duplicada não é motivo do pedido: a foto fica por via das dúvidas', () => {
    expect(pedido(resposta({ gravado: false, motivo: 'batida_duplicada' }))).toBe('manter')
  })

  it('pedido_duplicado não é motivo da batida (lista padrão)', () => {
    expect(destinoDaSelfie(resposta({ gravado: false, motivo: 'pedido_duplicado' }))).toBe('manter')
  })

  it('resposta perdida, 5xx e exceção: NÃO descarta a foto do pedido', () => {
    expect(pedido(erro(0, null))).toBe('incerto')
    expect(pedido(erro(504, null))).toBe('incerto')
    expect(pedido(erro(503, 'PGRST000'))).toBe('incerto')
    expect(pedido({ tipo: 'excecao' })).toBe('incerto')
  })

  it('recusa levantada pela RPC do pedido (horário no futuro, motivo curto): descarta', () => {
    expect(pedido(erro(400, 'P0001'))).toBe('descartar')
  })

  it('o texto do pedido não confirmado manda conferir os pedidos e não diz que nada foi gravado', () => {
    const tudo = Object.values(PEDIDO_INCERTO).join(' ')
    expect(PEDIDO_INCERTO.mensagem).toMatch(/pode ter sido gravado/)
    expect(PEDIDO_INCERTO.comoResolver).toMatch(/Confira seus pedidos de hoje antes de pedir de novo/)
    expect(tudo).not.toMatch(/Nada foi gravado|não foi enviado/i)
  })
})

/*
 * O BANCO NÃO APAGA FOTO RECÉM-ENVIADA, E A FOLGA DELE É MAIOR QUE A JANELA DAS
 * RPCs. As duas policies de DELETE do bucket de selfies só soltam a foto com
 * mais de 16 minutos; as RPCs da batida e do pedido aceitam a foto por 15. Se
 * alguém alargar a janela das RPCs (ou encurtar a folga das policies) sem mexer
 * na outra ponta, a corrida volta: um DELETE no meio de uma gravação apagaria
 * a prova de uma batida. Este teste lê as duas pontas na migration da estrutura.
 */
const migracoesDaEstrutura = import.meta.glob<string>('../../supabase/migrations/*_ponto_livre_estrutura.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SQL_DA_ESTRUTURA = Object.values(migracoesDaEstrutura).join('\n')

describe('a folga do descarte no banco, contra a janela das RPCs', () => {
  /** Minutos de um intervalo do Postgres escrito como '15 minutes' ou '00:16:00'. */
  const minutos = (texto: string): number => {
    const porExtenso = /^(\d+)\s+minutes?$/.exec(texto)
    if (porExtenso) return Number(porExtenso[1])
    const relogio = /^(\d{2}):(\d{2}):(\d{2})$/.exec(texto)
    return relogio ? Number(relogio[1]) * 60 + Number(relogio[2]) + Number(relogio[3]) / 60 : Number.NaN
  }

  it('as duas RPCs aceitam a foto por 15 minutos, e as duas policies de DELETE só soltam depois de 16', () => {
    expect(Object.keys(migracoesDaEstrutura)).toHaveLength(1)
    const janelas = [...SQL_DA_ESTRUTURA.matchAll(/c_idade_maxima\s+constant interval := interval '([^']+)';/g)].map((m) => minutos(m[1]))
    expect(janelas).toEqual([15, 15])

    const policies = [...SQL_DA_ESTRUTURA.matchAll(/CREATE POLICY "([^"]+)" ON storage\.objects AS PERMISSIVE FOR DELETE[^;]*;/g)]
    expect(policies.map((m) => m[1]).sort()).toEqual(['Ponto: dono descarta selfie sem batida', 'Ponto: so admin apaga selfie'])
    for (const policy of policies) {
      const folga = /created_at < \(now\(\) - '([^']+)'::interval\)/.exec(policy[0])?.[1] ?? ''
      // Um minuto a mais que a janela: cobre com sobra o tempo de um comando do app.
      expect(minutos(folga), policy[1]).toBeGreaterThanOrEqual(Math.max(...janelas) + 1)
    }
  })
})
