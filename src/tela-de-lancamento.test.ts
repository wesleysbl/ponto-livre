// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A TELA DE LANÇAR AUSÊNCIA, POR DIAS OU POR HORÁRIO, montada num DOM simulado
 * (jsdom), com o Supabase SIMULADO anotando o envio do atestado e o INSERT. O
 * mesmo desenho de `telas-da-jornada.test.ts`: `createRoot` + `act`, clique e
 * digitação de verdade nos campos, e nenhum `console.error`/`console.warn` no
 * caminho.
 *
 * O que se prova, na tela:
 *   • abre "Por dias", com a data sugerida e 1 dia; a data final calculada é a
 *     própria data (1 dia) ou a data + 2 (3 dias, corridos);
 *   • a modalidade é um grupo de rádios de verdade, com legenda, que o teclado
 *     percorre;
 *   • trocar de modalidade esconde os campos da outra (a quantidade some no
 *     "Por horário"; os horários somem no "Por dias"), e a data fica;
 *   • 16:00 às 16:30 mostra a duração "0h30" (o formato de `formatarDuracao`);
 *   • fim antes do início, fim igual, 0, -1, 1,5 e vazio são recusados na tela,
 *     sem viagem ao banco;
 *   • o INSERT por horário manda `modalidade: 'horario'`, `dia_inicio = dia_fim`
 *     e as duas horas; o por dias manda o `dia_fim` calculado e as horas nulas;
 *   • a sobreposição e a trava da própria ausência que o banco recusa chegam
 *     traduzidas, e a caixa fica aberta;
 *   • o aviso diz o que abona e o que só marca, e não diz mais que a ausência
 *     "não soma nem desconta horas";
 *   • o atestado continua subindo ANTES do INSERT, com o id da ausência.
 */

const simulado = vi.hoisted(() => {
  interface Operacao {
    metodo: string
    args: unknown[]
  }
  const estado = {
    consultas: [] as { tabela: string; operacoes: Operacao[] }[],
    envios: [] as { bucket: string; caminho: string; opcoes: unknown }[],
    ordem: [] as string[],
    resposta: (() => ({ data: null, error: null })) as (
      tabela: string,
      operacoes: Operacao[],
    ) => { data: unknown; error: { message: string; code?: string } | null },
  }
  function consulta(tabela: string): unknown {
    const registro = { tabela, operacoes: [] as Operacao[] }
    estado.consultas.push(registro)
    const proxy: unknown = new Proxy(
      {},
      {
        get(_alvo, propriedade) {
          if (propriedade === 'then') {
            const resultado = estado.resposta(tabela, registro.operacoes)
            return (resolver: (valor: unknown) => unknown, rejeitar: (erro: unknown) => unknown) =>
              Promise.resolve(resultado).then(resolver, rejeitar)
          }
          return (...args: unknown[]) => {
            registro.operacoes.push({ metodo: String(propriedade), args })
            if (propriedade === 'insert') estado.ordem.push('insert')
            return proxy
          }
        },
      },
    )
    return proxy
  }
  const supabase = {
    from: (tabela: string) => consulta(tabela),
    rpc: () => {
      throw new Error('A tela de lançamento não chama RPC.')
    },
    storage: {
      from: (bucket: string) => ({
        upload: (caminho: string, _conteudo: Blob, opcoes: unknown) => {
          estado.envios.push({ bucket, caminho, opcoes })
          estado.ordem.push('upload')
          return Promise.resolve({ data: { path: caminho }, error: null })
        },
      }),
    },
  }
  return { estado, supabase }
})

vi.mock('./lib/supabase', () => ({ supabase: simulado.supabase }))

const { LancamentoDeAusencia } = await import('./components/LancamentoDeAusencia')

const { estado } = simulado

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let montadas: { root: Root; raiz: HTMLElement }[] = []
let errosDoConsole: unknown[][] = []

beforeEach(() => {
  // Só o relógio: "hoje" é 21/10/2026 (a janela de um ano conta a partir dele).
  // Os temporizadores seguem de verdade, para o `assentar` andar.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T15:00:00-03:00'))
  estado.consultas.length = 0
  estado.envios.length = 0
  estado.ordem.length = 0
  estado.resposta = (_tabela, operacoes) =>
    operacoes.some((o) => o.metodo === 'insert')
      ? { data: { id: (operacoes[0].args[0] as { id: string }).id }, error: null }
      : { data: null, error: null }
  errosDoConsole = []
  for (const nivel of ['error', 'warn'] as const) {
    vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
      errosDoConsole.push([nivel, ...args])
    })
  }
})

afterEach(() => {
  for (const { root, raiz } of montadas) {
    act(() => root.unmount())
    raiz.remove()
  }
  montadas = []
  vi.useRealTimers()
  expect(errosDoConsole).toEqual([])
  vi.restoreAllMocks()
})

async function assentar() {
  for (let volta = 0; volta < 5; volta++) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0))
    })
  }
}

interface Montagem {
  raiz: HTMLElement
  lancadas: number
}

async function montar(diaSugerido = '2026-10-21'): Promise<Montagem> {
  const raiz = document.createElement('div')
  document.body.appendChild(raiz)
  const root = createRoot(raiz)
  montadas.push({ root, raiz })
  const montagem: Montagem = { raiz, lancadas: 0 }
  await act(async () => {
    root.render(
      createElement(LancamentoDeAusencia, {
        usuarioId: 'u1',
        nomeDoFuncionario: 'Bruna Costa',
        diaSugerido,
        aoFechar: () => {},
        aoLancada: () => {
          montagem.lancadas++
        },
      }),
    )
  })
  return montagem
}

const textoDe = (elemento: Element | null | undefined) => (elemento?.textContent ?? '').replace(/\s+/g, ' ').trim()

const campo = (raiz: HTMLElement, id: string) => raiz.querySelector<HTMLInputElement>(`#${id}`)

/** Digita num campo controlado pelo React (o setter nativo + `input`). */
async function digitar(raiz: HTMLElement, id: string, valor: string) {
  const alvo = campo(raiz, id)
  expect(alvo, `o campo #${id}`).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(alvo, valor)
    alvo?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clicar(elemento: HTMLElement | null | undefined) {
  expect(elemento).toBeTruthy()
  await act(async () => {
    elemento?.click()
  })
  await assentar()
}

const porHorario = (raiz: HTMLElement) => clicar(campo(raiz, 'ausencia-modalidade-horario'))
const porDias = (raiz: HTMLElement) => clicar(campo(raiz, 'ausencia-modalidade-dias'))

async function lancar(raiz: HTMLElement) {
  const botao = [...raiz.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) =>
    textoDe(b).includes('Lançar falta justificada'),
  )
  await clicar(botao)
}

const erroNaTela = (raiz: HTMLElement) => textoDe(raiz.querySelector('[role="alert"]'))
const inserts = () => estado.consultas.filter((c) => c.operacoes.some((o) => o.metodo === 'insert'))
const inserido = () => inserts()[0]?.operacoes.find((o) => o.metodo === 'insert')?.args[0] as Record<string, unknown>

/** A resposta do INSERT recusado pelo banco, com a frase dele. */
function bancoRecusa(code: string, message: string) {
  estado.resposta = (_tabela, operacoes) =>
    operacoes.some((o) => o.metodo === 'insert')
      ? { data: null, error: { code, message } }
      : { data: null, error: null } // a releitura pelo id: não é a própria linha
}

/* ------------------------------------------------------------------ */

describe('o aviso da caixa', () => {
  it('diz o que abona e o que só marca, e não diz mais que a ausência não soma nem desconta horas', async () => {
    const { raiz } = await montar()
    const texto = textoDe(raiz)
    expect(texto).not.toContain('não soma nem desconta horas')
    expect(texto).toContain(
      'Atestado médico e falta justificada abonam a parte da jornada que cobrem e que não foi trabalhada',
    )
    expect(texto).toContain('sem apagar nenhuma batida')
    expect(texto).toContain('Outro motivo só marca o dia, sem abonar')
    expect(texto).toContain('para corrigir, cancele com motivo e lance de novo')
    expect(texto).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('a escolha da modalidade', () => {
  it('abre "Por dias", com a data sugerida e 1 dia, sem campo de horário nem de dia final', async () => {
    const { raiz } = await montar()
    const dias = campo(raiz, 'ausencia-modalidade-dias')
    const horario = campo(raiz, 'ausencia-modalidade-horario')
    // Rádios de verdade, num grupo com legenda: o leitor de tela anuncia
    // "Como lançar, Por dias, selecionado, 1 de 2", e as setas trocam a escolha.
    expect(dias?.type).toBe('radio')
    expect(dias?.name).toBe(horario?.name)
    expect(dias?.checked).toBe(true)
    expect(horario?.checked).toBe(false)
    expect(textoDe(dias?.closest('fieldset')?.querySelector('legend'))).toBe('Como lançar')
    expect(textoDe(dias?.closest('label'))).toBe('Por dias')
    expect(textoDe(horario?.closest('label'))).toBe('Por horário')
    // Escondido só da vista (sr-only), e não do teclado: o rádio continua focável.
    expect(dias?.className).toContain('sr-only')
    expect(dias?.tabIndex).not.toBe(-1)

    expect(campo(raiz, 'ausencia-dia')?.value).toBe('2026-10-21')
    expect(campo(raiz, 'ausencia-dia')?.type).toBe('date')
    expect(campo(raiz, 'ausencia-quantidade')?.value).toBe('1')
    expect(campo(raiz, 'ausencia-quantidade')?.inputMode).toBe('numeric')
    expect(raiz.querySelector('label[for="ausencia-dia"]')?.textContent).toBe('Data de início')
    expect(raiz.querySelector('label[for="ausencia-quantidade"]')?.textContent).toBe('Quantos dias')
    expect(raiz.querySelector('input[type="time"]')).toBeNull()
    expect(raiz.querySelector('#ausencia-fim')).toBeNull()
    expect(raiz.querySelector('#ausencia-inicio')).toBeNull()
    expect(textoDe(raiz)).not.toMatch(/Primeiro dia|Último dia/)
    // O formulário não deixa o balão do navegador falar no lugar da tela.
    expect(raiz.querySelector('form')?.noValidate).toBe(true)
  })

  it('trocar de modalidade esconde os campos da outra, e a data fica', async () => {
    const { raiz } = await montar()
    await digitar(raiz, 'ausencia-dia', '2026-10-20')

    await porHorario(raiz)
    expect(campo(raiz, 'ausencia-modalidade-horario')?.checked).toBe(true)
    expect(campo(raiz, 'ausencia-quantidade')).toBeNull()
    expect(raiz.querySelector('#ausencia-data-final')).toBeNull()
    expect(campo(raiz, 'ausencia-hora-inicio')?.type).toBe('time')
    expect(campo(raiz, 'ausencia-hora-fim')?.type).toBe('time')
    expect(campo(raiz, 'ausencia-hora-inicio')?.getAttribute('step')).toBe('60')
    expect(raiz.querySelector('label[for="ausencia-dia"]')?.textContent).toBe('Data')
    expect(raiz.querySelector('label[for="ausencia-hora-inicio"]')?.textContent).toBe('Das')
    expect(raiz.querySelector('label[for="ausencia-hora-fim"]')?.textContent).toBe('Até')
    expect(campo(raiz, 'ausencia-dia')?.value).toBe('2026-10-20')
    // Nenhum campo de quantidade de horas: a duração é conta, não se digita.
    expect(raiz.querySelectorAll('input:not([type="radio"]):not([type="file"])')).toHaveLength(3)
    expect(textoDe(raiz)).not.toMatch(/quantas horas/i)

    await porDias(raiz)
    expect(raiz.querySelector('input[type="time"]')).toBeNull()
    expect(raiz.querySelector('#ausencia-duracao')).toBeNull()
    expect(campo(raiz, 'ausencia-quantidade')?.value).toBe('1')
    expect(campo(raiz, 'ausencia-dia')?.value).toBe('2026-10-20')
  })

  it('o horário perde o ícone do relógio no par estreito, como no editor da semana', async () => {
    const { raiz } = await montar()
    await porHorario(raiz)
    const inicio = campo(raiz, 'ausencia-hora-inicio')
    expect(inicio?.className).toContain('@max-[15rem]:[&::-webkit-calendar-picker-indicator]:hidden')
    expect(inicio?.className).toContain('min-w-0')
    // O par mora num @container: é a largura da caixa que decide, e não a da tela.
    expect(inicio?.closest('.\\@container')).toBeTruthy()
  })
})

describe('por dias: a data final calculada', () => {
  const dataFinal = (raiz: HTMLElement) => textoDe(raiz.querySelector('#ausencia-data-final'))

  it('1 dia: a data final é a data de início', async () => {
    const { raiz } = await montar()
    expect(dataFinal(raiz)).toBe('Data final: 21/10/2026 (um dia só)')
    expect(raiz.querySelector('#ausencia-data-final')?.getAttribute('aria-live')).toBe('polite')
    expect(campo(raiz, 'ausencia-quantidade')?.getAttribute('aria-describedby')).toBe('ausencia-data-final')
  })

  it('3 dias: a data de início e as duas seguintes, e a conta muda na hora', async () => {
    const { raiz } = await montar()
    await digitar(raiz, 'ausencia-dia', '2026-10-20')
    await digitar(raiz, 'ausencia-quantidade', '3')
    expect(dataFinal(raiz)).toBe('Data final: 22/10/2026 (3 dias)')
    await digitar(raiz, 'ausencia-dia', '2026-10-30')
    expect(dataFinal(raiz)).toBe('Data final: 01/11/2026 (3 dias)')
    expect(textoDe(raiz)).toContain('A data de início conta como o primeiro dia, e os dias são corridos')
  })

  it('a quantidade que não vale aparece na própria linha da conta, sem esperar o envio', async () => {
    const { raiz } = await montar()
    await digitar(raiz, 'ausencia-quantidade', '1,5')
    expect(dataFinal(raiz)).toBe(
      'Data final: A quantidade de dias tem de ser um número inteiro maior que zero, como 1 ou 3.',
    )
    await digitar(raiz, 'ausencia-quantidade', '121')
    expect(dataFinal(raiz)).toContain('vai até 120 dias')
  })

  it.each([
    ['0', 'A quantidade de dias tem de ser um número inteiro maior que zero, como 1 ou 3.'],
    ['-1', 'A quantidade de dias tem de ser um número inteiro maior que zero, como 1 ou 3.'],
    ['1,5', 'A quantidade de dias tem de ser um número inteiro maior que zero, como 1 ou 3.'],
    ['', 'Informe a quantidade de dias.'],
    ['121', 'Por dias, o lançamento vai até 120 dias, contando a data de início. Para um período maior, lance em partes.'],
  ])('"%s" dia(s) é recusado na tela, sem viagem ao banco', async (quantidade, frase) => {
    const { raiz } = await montar()
    await digitar(raiz, 'ausencia-quantidade', quantidade)
    await lancar(raiz)
    expect(erroNaTela(raiz)).toBe(frase)
    expect(estado.consultas).toEqual([])
    expect(estado.envios).toEqual([])
  })

  it('sem a data de início, é recusado', async () => {
    const { raiz } = await montar()
    await digitar(raiz, 'ausencia-dia', '')
    await lancar(raiz)
    expect(erroNaTela(raiz)).toBe('Informe a data de início.')
    expect(estado.consultas).toEqual([])
  })

  it('o INSERT por dias manda o dia final calculado, modalidade "dias" e as horas nulas', async () => {
    const montagem = await montar('2026-10-20')
    await digitar(montagem.raiz, 'ausencia-quantidade', '3')
    await lancar(montagem.raiz)
    expect(erroNaTela(montagem.raiz)).toBe('')
    expect(inserts()).toHaveLength(1)
    expect(inserido()).toMatchObject({
      usuario_id: 'u1',
      modalidade: 'dias',
      dia_inicio: '2026-10-20',
      dia_fim: '2026-10-22',
      hora_inicio: null,
      hora_fim: null,
      tipo: 'atestado_medico',
      observacao: null,
      atestado_path: null,
    })
    expect(montagem.lancadas).toBe(1)
  })

  it('horário digitado antes de voltar para "Por dias" não vai para o banco', async () => {
    const { raiz } = await montar()
    await porHorario(raiz)
    await digitar(raiz, 'ausencia-hora-inicio', '14:00')
    await digitar(raiz, 'ausencia-hora-fim', '16:00')
    await porDias(raiz)
    await lancar(raiz)
    expect(inserido()).toMatchObject({ modalidade: 'dias', dia_fim: '2026-10-21', hora_inicio: null, hora_fim: null })
  })
})

describe('por horário: a duração calculada', () => {
  const duracao = (raiz: HTMLElement) => textoDe(raiz.querySelector('#ausencia-duracao'))

  it('sem os horários, a linha pede os dois', async () => {
    const { raiz } = await montar()
    await porHorario(raiz)
    expect(duracao(raiz)).toBe('Duração: Informe o horário inicial e o final.')
    expect(campo(raiz, 'ausencia-hora-inicio')?.getAttribute('aria-describedby')).toBe('ausencia-duracao')
  })

  it('16:00 às 16:30 dá "0h30" (o formato de duração do projeto); 14:00 às 16:00 dá "2h00"', async () => {
    const { raiz } = await montar()
    await porHorario(raiz)
    await digitar(raiz, 'ausencia-hora-inicio', '16:00')
    await digitar(raiz, 'ausencia-hora-fim', '16:30')
    expect(duracao(raiz)).toBe('Duração: 0h30')
    await digitar(raiz, 'ausencia-hora-inicio', '14:00')
    await digitar(raiz, 'ausencia-hora-fim', '16:00')
    expect(duracao(raiz)).toBe('Duração: 2h00')
  })

  it('fim antes do início é recusado na tela', async () => {
    const { raiz } = await montar()
    await porHorario(raiz)
    await digitar(raiz, 'ausencia-hora-inicio', '16:00')
    await digitar(raiz, 'ausencia-hora-fim', '14:00')
    expect(duracao(raiz)).toBe('Duração: O horário final tem de ser depois do inicial.')
    await lancar(raiz)
    expect(erroNaTela(raiz)).toBe('O horário final tem de ser depois do inicial.')
    expect(estado.consultas).toEqual([])
  })

  it('fim igual ao início também é recusado', async () => {
    const { raiz } = await montar()
    await porHorario(raiz)
    await digitar(raiz, 'ausencia-hora-inicio', '14:00')
    await digitar(raiz, 'ausencia-hora-fim', '14:00')
    await lancar(raiz)
    expect(erroNaTela(raiz)).toBe('O horário final é igual ao inicial. Informe um intervalo, como das 14:00 às 16:00.')
    expect(estado.consultas).toEqual([])
  })

  it('a data e os dois horários são obrigatórios', async () => {
    const { raiz } = await montar()
    await porHorario(raiz)
    await lancar(raiz)
    expect(erroNaTela(raiz)).toBe('Informe o horário inicial e o final.')
    await digitar(raiz, 'ausencia-hora-inicio', '14:00')
    await lancar(raiz)
    expect(erroNaTela(raiz)).toBe('Informe o horário final.')
    await digitar(raiz, 'ausencia-hora-fim', '16:00')
    await digitar(raiz, 'ausencia-dia', '')
    await lancar(raiz)
    expect(erroNaTela(raiz)).toBe('Informe a data.')
    expect(estado.consultas).toEqual([])
  })

  it('o INSERT por horário manda modalidade "horario", dia_inicio = dia_fim e as duas horas', async () => {
    const montagem = await montar()
    await porHorario(montagem.raiz)
    await digitar(montagem.raiz, 'ausencia-hora-inicio', '14:00')
    await digitar(montagem.raiz, 'ausencia-hora-fim', '16:00')
    await lancar(montagem.raiz)
    expect(erroNaTela(montagem.raiz)).toBe('')
    expect(inserts()).toHaveLength(1)
    const linha = inserido()
    expect(linha).toMatchObject({
      usuario_id: 'u1',
      modalidade: 'horario',
      dia_inicio: '2026-10-21',
      dia_fim: '2026-10-21',
      hora_inicio: '14:00',
      hora_fim: '16:00',
      tipo: 'atestado_medico',
    })
    // Só as colunas do privilégio de INSERT (as da estrutura e as três da ausência por horário).
    expect(Object.keys(linha).sort()).toEqual(
      [
        'atestado_path',
        'dia_fim',
        'dia_inicio',
        'hora_fim',
        'hora_inicio',
        'id',
        'modalidade',
        'observacao',
        'tipo',
        'usuario_id',
      ].sort(),
    )
    expect(montagem.lancadas).toBe(1)
  })

  it('a quantidade de dias que ficou para trás não impede o lançamento por horário', async () => {
    const { raiz } = await montar()
    await digitar(raiz, 'ausencia-quantidade', '1,5')
    await porHorario(raiz)
    await digitar(raiz, 'ausencia-hora-inicio', '08:00')
    await digitar(raiz, 'ausencia-hora-fim', '09:00')
    await lancar(raiz)
    expect(inserido()).toMatchObject({ modalidade: 'horario', dia_inicio: '2026-10-21', dia_fim: '2026-10-21' })
  })
})

describe('as recusas do banco, traduzidas na caixa', () => {
  it('a sobreposição chega traduzida, com o intervalo da outra, e a caixa fica aberta', async () => {
    bancoRecusa(
      '23P01',
      'Ja existe ausencia por horario desta pessoa que cruza este horario (de 14:00 a 16:00): intervalos que so se encostam valem, como 14:00-16:00 e 16:00-16:30',
    )
    const montagem = await montar()
    await porHorario(montagem.raiz)
    await digitar(montagem.raiz, 'ausencia-hora-inicio', '15:00')
    await digitar(montagem.raiz, 'ausencia-hora-fim', '17:00')
    await lancar(montagem.raiz)
    expect(erroNaTela(montagem.raiz)).toBe(
      'Este horário cruza outra ausência desta pessoa no mesmo dia (das 14:00 às 16:00). Horários que só se encostam valem, como 14:00-16:00 e 16:00-16:30.',
    )
    expect(montagem.lancadas).toBe(0)
    // Pode corrigir e tentar de novo: os campos continuam habilitados.
    expect(campo(montagem.raiz, 'ausencia-hora-inicio')?.disabled).toBe(false)
  })

  it('a ausência por dias sobre um dia que já tem horário diz qual é a outra', async () => {
    bancoRecusa(
      '23P01',
      'Ja existe ausencia por horario desta pessoa em parte deste periodo (dia 21/10/2026, de 14:00 a 16:00): cancele a anterior antes de lancar por dias',
    )
    const montagem = await montar('2026-10-20')
    await digitar(montagem.raiz, 'ausencia-quantidade', '3')
    await lancar(montagem.raiz)
    expect(erroNaTela(montagem.raiz)).toBe(
      'Já existe uma ausência por horário lançada para esta pessoa neste período (em 21/10/2026, das 14:00 às 16:00). Para lançar por dias, cancele a anterior (com motivo) e lance de novo.',
    )
    expect(montagem.lancadas).toBe(0)
  })

  /*
   * A tela da própria ficha nem abre esta caixa; a recusa chega se a caixa foi
   * aberta para uma conta que é a da sessão por outro caminho. Ela vem com
   * 42501, o mesmo código de "só quem administra": a frase própria ganha da
   * genérica, que mandaria entrar de novo.
   */
  it('a trava da própria ausência chega com a frase da regra, e não com "entre de novo"', async () => {
    bancoRecusa(
      '42501',
      'Quem e dono da ausencia nao lanca a propria ausencia: peca a outra pessoa que administra o ponto ou ao super admin',
    )
    const montagem = await montar()
    await lancar(montagem.raiz)
    const erro = erroNaTela(montagem.raiz)
    expect(erro).toBe(
      'Você não pode lançar ausência para você mesmo: quem é dono do ponto não lança a própria ausência, e isso vale também para quem administra e para o super admin. Peça a outra pessoa que administra o ponto, ou ao super admin.',
    )
    expect(erro).not.toMatch(/Entre de novo/)
    expect(montagem.lancadas).toBe(0)
    // Não é sobreposição: a caixa não relê a linha pelo id.
    expect(estado.consultas).toHaveLength(1)
  })
})

describe('o atestado segue como antes', () => {
  it('o PDF escolhido sobe ANTES do INSERT, com o id da ausência, e o INSERT leva o caminho', async () => {
    const { raiz } = await montar()
    await porHorario(raiz)
    await digitar(raiz, 'ausencia-hora-inicio', '14:00')
    await digitar(raiz, 'ausencia-hora-fim', '16:00')

    const seletor = raiz.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')
    expect(seletor).toBeTruthy()
    const pdf = new File(['%PDF-1.4'], 'atestado.pdf', { type: 'application/pdf' })
    await act(async () => {
      Object.defineProperty(seletor, 'files', { value: [pdf], configurable: true })
      seletor?.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await assentar()
    expect(textoDe(raiz)).toContain('atestado.pdf')
    expect(textoDe(raiz)).toContain('PDF ·')

    await lancar(raiz)
    expect(erroNaTela(raiz)).toBe('')
    expect(estado.ordem).toEqual(['upload', 'insert'])
    const linha = inserido()
    expect(estado.envios).toEqual([
      {
        bucket: 'ponto-atestados',
        caminho: `u1/${String(linha.id)}.pdf`,
        opcoes: { contentType: 'application/pdf', upsert: false },
      },
    ])
    expect(linha).toMatchObject({ atestado_path: `u1/${String(linha.id)}.pdf`, modalidade: 'horario' })
  })
})
