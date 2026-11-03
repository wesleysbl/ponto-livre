// @vitest-environment jsdom
import { act, createElement, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfiguracaoDoPonto } from './lib/configuracao'
import type { FichaDoFuncionario, RascunhoDaFicha } from './lib/cadastro'

/*
 * AS TELAS DA JORNADA, montadas num DOM simulado (jsdom), com o Supabase
 * SIMULADO anotando cada gravação. O mesmo desenho de
 * `miniaturas-das-selfies.test.ts`: `createRoot` + `act`, clique e digitação de
 * verdade nos campos, e nenhum `console.error`/`console.warn` no caminho.
 *
 * O que se prova, na tela:
 *   • a carga digitada sumiu: a jornada da empresa abre com os sete dias
 *     montados a partir do banco, e o total do dia muda NA HORA ao trocar um
 *     horário;
 *   • acrescentar bloco funciona até dois; o terceiro não tem botão;
 *   • bloco invertido é recusado com a frase do banco, sem viagem ao servidor;
 *   • a gravação manda `jornada`, a tolerância, a janela e
 *     `saldo_a_partir_de` (e não `carga_diaria_minutos`);
 *   • "Saldo calculado a partir de" aparece com a explicação, é obrigatória,
 *     e recuar a data avisa antes de salvar;
 *   • na ficha, "usar a da empresa" mostra a da empresa e grava NULO; "jornada
 *     própria" abre o editor começando da da empresa e grava a lista;
 *   • na ficha da própria sessão, a jornada e a data ficam bloqueadas, com a
 *     frase do porquê, e a gravação não as manda; a de outra pessoa se edita;
 *   • as recusas do banco (jornada e própria ficha) chegam traduzidas.
 */

const simulado = vi.hoisted(() => {
  interface Operacao {
    metodo: string
    args: unknown[]
  }
  const estado = {
    consultas: [] as { tabela: string; operacoes: Operacao[] }[],
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
      throw new Error('A tela da jornada não chama RPC.')
    },
  }
  return { estado, supabase }
})

vi.mock('./lib/supabase', () => ({ supabase: simulado.supabase }))

const { FormularioDaJornada } = await import('./pages/Administracao')
const { FormularioDaFicha, POR_QUE_A_PROPRIA_FICHA_E_SO_PARA_LER } = await import('./components/FichaDoFuncionario')
const { validarFicha } = await import('./lib/cadastro')
const { salvarFicha } = await import('./lib/administracao')
const { JORNADA_SEMENTE } = await import('./lib/jornada')

const { estado } = simulado

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONFIGURACAO: ConfiguracaoDoPonto = {
  razaoSocial: null,
  nomeFantasia: null,
  cnpj: null,
  endereco: null,
  cidade: null,
  uf: null,
  cargaDiariaMinutos: 480,
  jornada: JORNADA_SEMENTE,
  toleranciaMinutos: 10,
  janelaDuplicidadeSegundos: 60,
  saldoAPartirDe: '2026-11-03',
  atualizadoEm: null,
}

/** A linha que o banco devolve depois de gravar: a carga é a DELE. */
function linhaGravada(enviado: Record<string, unknown>, carga: number) {
  return {
    id: 1,
    razao_social: null,
    nome_fantasia: null,
    cnpj: null,
    endereco: null,
    cidade: null,
    uf: null,
    carga_diaria_minutos: carga,
    jornada: enviado.jornada,
    saldo_a_partir_de: enviado.saldo_a_partir_de,
    tolerancia_minutos: enviado.tolerancia_minutos,
    janela_duplicidade_segundos: enviado.janela_duplicidade_segundos,
    atualizado_em: '2026-11-02T19:00:00.000Z',
  }
}

/** A conta da sessão nos testes da própria ficha. */
const CONTA_DA_SESSAO = '00000000-0000-4000-8000-000000000007'

const FICHA: FichaDoFuncionario = {
  id: 'f1',
  usuarioId: null,
  nomeCompleto: 'Bruna Costa',
  cpf: null,
  matricula: null,
  cargo: null,
  admissao: null,
  desligamento: null,
  ctps: null,
  ctpsSerie: null,
  centroCusto: null,
  ativo: true,
  batePontoDesde: null,
  jornada: null,
  atualizadoEm: null,
}

/** A ficha do Sérgio, ligada à conta da sessão, com a data e uma jornada própria. */
const FICHA_DA_SESSAO: FichaDoFuncionario = {
  ...FICHA,
  id: 'f9',
  usuarioId: CONTA_DA_SESSAO,
  nomeCompleto: 'Sérgio Almeida',
  cargo: 'Diretor',
  batePontoDesde: '2026-09-01',
  jornada: [{ dia: 2, inicio: '09:00', fim: '15:00' }],
}

let montadas: { root: Root; raiz: HTMLElement }[] = []
let errosDoConsole: unknown[][] = []

beforeEach(() => {
  estado.consultas.length = 0
  estado.resposta = () => ({ data: null, error: null })
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

async function montar(elemento: ReactElement): Promise<HTMLElement> {
  const raiz = document.createElement('div')
  document.body.appendChild(raiz)
  const root = createRoot(raiz)
  montadas.push({ root, raiz })
  await act(async () => {
    root.render(elemento)
  })
  return raiz
}

const textoDe = (elemento: Element | null | undefined) => (elemento?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** O cartão de um dia, pelo título ("Segunda"). */
function dia(raiz: HTMLElement, nome: string): HTMLLIElement {
  const achado = [...raiz.querySelectorAll('li')].find((li) => textoDe(li.querySelector('p')) === nome)
  expect(achado, `o dia ${nome}`).toBeDefined()
  return achado as HTMLLIElement
}

const botaoPorRotulo = (raiz: HTMLElement, rotulo: string) =>
  raiz.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`)

function botaoCom(raiz: HTMLElement, trecho: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll('button')].find((botao) => textoDe(botao).includes(trecho))
}

async function clicar(botao: HTMLElement | null | undefined) {
  expect(botao).toBeTruthy()
  await act(async () => {
    botao?.click()
  })
  await assentar()
}

/** Digita num campo controlado pelo React (o setter nativo + `input`). */
async function digitar(raiz: HTMLElement, id: string, valor: string) {
  const campo = raiz.querySelector<HTMLInputElement>(`#${id}`)
  expect(campo, `o campo #${id}`).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(campo, valor)
    campo?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function escolher(raiz: HTMLElement, id: string, valor: string) {
  const campo = raiz.querySelector<HTMLSelectElement>(`#${id}`)
  expect(campo, `a escolha #${id}`).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(campo, valor)
    campo?.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const totalDe = (li: HTMLLIElement) => textoDe(li.querySelector('[aria-live]'))
const gravacoes = () =>
  estado.consultas.filter((c) => c.operacoes.some((o) => ['upsert', 'update', 'insert'].includes(o.metodo)))
const argsDe = (consulta: { operacoes: { metodo: string; args: unknown[] }[] }, metodo: string) =>
  consulta.operacoes.find((o) => o.metodo === metodo)?.args

const montarJornada = (aoSalvar: (configuracao: ConfiguracaoDoPonto) => void = () => {}) =>
  montar(createElement(FormularioDaJornada, { inicial: CONFIGURACAO, aoSalvar }))

/* ------------------------------------------------------------------ */

describe('a jornada da empresa, na configuração do ponto', () => {
  it('a carga digitada sumiu: abre com os sete dias montados a partir do banco, e o total da semana', async () => {
    const raiz = await montarJornada()

    const nomes = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
    for (const nome of nomes) dia(raiz, nome)
    expect(raiz.querySelector<HTMLInputElement>('#jornada-empresa-1-0-inicio')?.value).toBe('08:00')
    expect(raiz.querySelector<HTMLInputElement>('#jornada-empresa-1-1-fim')?.value).toBe('17:00')
    expect(raiz.querySelector('#jornada-empresa-1-0-inicio')?.getAttribute('type')).toBe('time')
    expect(raiz.querySelector('#jornada-empresa-1-0-inicio')?.getAttribute('step')).toBe('60')
    // O rótulo está ligado ao campo.
    expect(raiz.querySelector('label[for="jornada-empresa-1-0-inicio"]')?.textContent).toBe('Início')

    expect(totalDe(dia(raiz, 'Segunda'))).toContain('8h00')
    expect(totalDe(dia(raiz, 'Sábado'))).toContain('Sem jornada')
    expect(textoDe(raiz)).toContain('Total da semana: 40h00')
    // A carga diária é só mostrada: não há campo para ela.
    expect(raiz.querySelector('#jornada-carga')).toBeNull()
    expect(textoDe(raiz)).not.toContain('Carga diária esperada')
    expect(textoDe(raiz)).toMatch(/Carga diária: 8h00\. Não se digita/)
    // A tolerância e a janela continuam editáveis.
    expect(raiz.querySelector<HTMLInputElement>('#jornada-tolerancia')?.value).toBe('10')
    expect(raiz.querySelector<HTMLInputElement>('#jornada-janela')?.value).toBe('60')
    // E o texto não diz mais que a carga e a tolerância ficam só guardadas.
    expect(textoDe(raiz)).not.toMatch(/ficam guardadas|não entram em conta nenhuma|não calcula saldo/)
  })

  it('o total do dia muda na hora ao trocar um horário', async () => {
    const raiz = await montarJornada()

    await digitar(raiz, 'jornada-empresa-1-0-fim', '11:00')
    expect(totalDe(dia(raiz, 'Segunda'))).toContain('7h00')
    expect(textoDe(raiz)).toContain('Total da semana: 39h00')

    await digitar(raiz, 'jornada-empresa-1-0-fim', '')
    expect(totalDe(dia(raiz, 'Segunda'))).toContain('Confira os horários')

    // Nada foi gravado só por digitar.
    expect(estado.consultas).toEqual([])
  })

  it('acrescenta até dois blocos no dia; o terceiro não tem botão', async () => {
    const raiz = await montarJornada()

    await clicar(botaoPorRotulo(raiz, 'Acrescentar horário no sábado'))
    expect(raiz.querySelector<HTMLInputElement>('#jornada-empresa-6-0-inicio')?.value).toBe('08:00')
    expect(totalDe(dia(raiz, 'Sábado'))).toContain('4h00')

    await clicar(botaoPorRotulo(raiz, 'Acrescentar o segundo bloco no sábado'))
    expect(raiz.querySelector('#jornada-empresa-6-1-inicio')).not.toBeNull()

    const sabado = dia(raiz, 'Sábado')
    expect(botaoCom(sabado, 'Acrescentar')).toBeUndefined()
    expect(textoDe(sabado)).toContain('Dois blocos, o máximo por dia.')
    expect(sabado.querySelectorAll('input[type="time"]')).toHaveLength(4)
    // Segunda, que já tem dois, também não oferece um terceiro.
    expect(botaoCom(dia(raiz, 'Segunda'), 'Acrescentar')).toBeUndefined()

    await clicar(botaoPorRotulo(raiz, 'Tirar o primeiro bloco de sábado'))
    expect(dia(raiz, 'Sábado').querySelectorAll('input[type="time"]')).toHaveLength(2)
  })

  it('bloco invertido é recusado com a frase do banco, sem ir ao servidor', async () => {
    const raiz = await montarJornada()

    await digitar(raiz, 'jornada-empresa-3-0-inicio', '12:00')
    await digitar(raiz, 'jornada-empresa-3-0-fim', '08:00')
    await clicar(botaoCom(raiz, 'Salvar a jornada e as regras'))

    expect(textoDe(raiz.querySelector('[role="alert"]'))).toContain(
      'Jornada inválida: no dia 3 (quarta), o bloco 12:00-08:00 não termina depois de começar (o fim precisa ser depois do início).',
    )
    expect(gravacoes()).toEqual([])
  })

  it('grava a jornada, a tolerância, a janela e a data, sem carga_diaria_minutos, e mostra a carga que o banco calculou', async () => {
    estado.resposta = (_tabela, operacoes) => {
      const enviado = operacoes.find((o) => o.metodo === 'upsert')?.args[0] as Record<string, unknown>
      return { data: linhaGravada(enviado, 540), error: null }
    }
    const salvas: ConfiguracaoDoPonto[] = []
    const raiz = await montarJornada((c) => salvas.push(c))

    // Sexta até as 18:00 (9 h) e sábado de manhã.
    await digitar(raiz, 'jornada-empresa-5-1-fim', '18:00')
    await clicar(botaoPorRotulo(raiz, 'Acrescentar horário no sábado'))
    await digitar(raiz, 'jornada-tolerancia', '5')
    await clicar(botaoCom(raiz, 'Salvar a jornada e as regras'))

    const [gravacao] = gravacoes()
    expect(gravacao.tabela).toBe('ponto_configuracao')
    const enviado = argsDe(gravacao, 'upsert')?.[0] as Record<string, unknown>
    expect(enviado).not.toHaveProperty('carga_diaria_minutos')
    expect(enviado).toEqual({
      id: 1,
      jornada: [
        ...JORNADA_SEMENTE.filter((b) => !(b.dia === 5 && b.inicio === '13:00')),
        { dia: 5, inicio: '13:00', fim: '18:00' },
        { dia: 6, inicio: '08:00', fim: '12:00' },
      ].sort((a, b) => a.dia - b.dia || a.inicio.localeCompare(b.inicio)),
      tolerancia_minutos: 5,
      janela_duplicidade_segundos: 60,
      saldo_a_partir_de: '2026-11-03',
    })

    expect(salvas).toHaveLength(1)
    expect(textoDe(raiz.querySelector('[role="status"]'))).toBe(
      'Jornada e regras salvas. A carga diária ficou em 9h00, o saldo é calculado a partir de 03/11/2026, e a janela de 60 segundos já vale na próxima batida.',
    )
  })

  it('a recusa do banco chega traduzida, com acento', async () => {
    estado.resposta = () => ({
      data: null,
      error: {
        code: '23514',
        message: 'Jornada invalida: o dia 2 (terca) soma 750 min; um dia com jornada soma de 60 a 720 min (de 1 h a 12 h).',
      },
    })
    const raiz = await montarJornada()
    await clicar(botaoCom(raiz, 'Salvar a jornada e as regras'))
    expect(textoDe(raiz.querySelector('[role="alert"]'))).toBe(
      'Jornada inválida: o dia 2 (terça) soma 750 min; um dia com jornada soma de 60 a 720 min (de 1 h a 12 h).',
    )
  })
})

describe('"Saldo calculado a partir de", na configuração do ponto', () => {
  it('aparece com a data gravada e a explicação do que ela faz', async () => {
    const raiz = await montarJornada()

    const campo = raiz.querySelector<HTMLInputElement>('#jornada-saldo-a-partir-de')
    expect(campo?.getAttribute('type')).toBe('date')
    expect(campo?.value).toBe('2026-11-03')
    expect(raiz.querySelector('label[for="jornada-saldo-a-partir-de"]')?.textContent).toBe('Saldo calculado a partir de')
    expect(campo?.getAttribute('aria-describedby')).toBe('jornada-saldo-explicacao')
    expect(textoDe(raiz.querySelector('#jornada-saldo-explicacao'))).toBe(
      'O saldo de horas e as faltas de cada pessoa só contam a partir da mais nova entre esta data e a data “Passou a bater ponto aqui em” da ficha. Antes dela, nenhum dia é cobrado. Recuar a data faz os dias desde lá serem cobrados, inclusive as faltas.',
    )
    // Sem recuo, sem aviso.
    expect(textoDe(raiz)).not.toContain('A data recua')
  })

  it('recuar a data avisa que os dias desde lá passam a ser cobrados, e a gravação manda a nova', async () => {
    estado.resposta = (_tabela, operacoes) => {
      const enviado = operacoes.find((o) => o.metodo === 'upsert')?.args[0] as Record<string, unknown>
      return { data: linhaGravada(enviado, 480), error: null }
    }
    const raiz = await montarJornada()

    await digitar(raiz, 'jornada-saldo-a-partir-de', '2026-10-01')
    expect(textoDe(raiz)).toContain(
      'A data recua de 03/11/2026 para 01/10/2026. Ao salvar, os dias desde 01/10/2026 passam a ser cobrados de quem já batia ponto aqui, inclusive as faltas.',
    )
    // Avançar não cobra nada que já não fosse cobrado: sem aviso.
    await digitar(raiz, 'jornada-saldo-a-partir-de', '2026-12-01')
    expect(textoDe(raiz)).not.toContain('A data recua')

    await digitar(raiz, 'jornada-saldo-a-partir-de', '2026-10-01')
    await clicar(botaoCom(raiz, 'Salvar a jornada e as regras'))
    const enviado = argsDe(gravacoes()[0], 'upsert')?.[0] as Record<string, unknown>
    expect(enviado.saldo_a_partir_de).toBe('2026-10-01')
    // Gravada, a data nova é a do banco: o aviso de recuo sai.
    expect(textoDe(raiz)).not.toContain('A data recua')
    expect(textoDe(raiz.querySelector('[role="status"]'))).toContain('o saldo é calculado a partir de 01/10/2026')
  })

  it('a data em branco é recusada na tela, sem ir ao servidor', async () => {
    const raiz = await montarJornada()
    await digitar(raiz, 'jornada-saldo-a-partir-de', '')
    await clicar(botaoCom(raiz, 'Salvar a jornada e as regras'))
    expect(textoDe(raiz.querySelector('[role="alert"]'))).toBe(
      'Saldo calculado a partir de: escolha uma data. O saldo de horas e as faltas de cada pessoa só contam a partir dela.',
    )
    expect(gravacoes()).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* A ficha                                                             */
/* ------------------------------------------------------------------ */

/**
 * A ficha como a lista de pessoas a grava: valida, manda ao banco (com
 * `propria` na ficha da sessão) e mostra a recusa traduzida na caixa.
 */
function FichaGravando({ ficha, propria }: { ficha: FichaDoFuncionario; propria: boolean }) {
  const [erro, setErro] = useState<string | null>(null)
  return createElement(FormularioDaFicha, {
    ficha,
    rotuloDaConta: ficha.usuarioId ? `${ficha.nomeCompleto} (conta ligada)` : null,
    jornadaDaEmpresa: JORNADA_SEMENTE,
    propria,
    gravando: false,
    erro,
    aoSalvar: (rascunho: RascunhoDaFicha) => {
      const leitura = validarFicha(rascunho)
      if (!leitura.ok) return
      salvarFicha(ficha.id, leitura.valor, { propria }).then(
        () => setErro(null),
        (falha: Error) => setErro(falha.message),
      )
    },
    aoFechar: () => {},
  })
}

/** A linha que o banco devolve: a jornada e a data que foram, ou as da ficha quando não foram. */
function responderComAFicha(ficha: FichaDoFuncionario) {
  estado.resposta = (_tabela, operacoes) => {
    const enviado = (operacoes.find((o) => o.metodo === 'update')?.args[0] ?? {}) as Record<string, unknown>
    return {
      data: {
        id: ficha.id,
        usuario_id: ficha.usuarioId,
        nome_completo: ficha.nomeCompleto,
        cpf: null,
        matricula: null,
        cargo: enviado.cargo ?? ficha.cargo,
        admissao: null,
        desligamento: null,
        ctps: null,
        ctps_serie: null,
        centro_custo: null,
        ativo: true,
        bate_ponto_desde: 'bate_ponto_desde' in enviado ? enviado.bate_ponto_desde : ficha.batePontoDesde,
        jornada: 'jornada' in enviado ? enviado.jornada : ficha.jornada,
        atualizado_em: null,
      },
      error: null,
    }
  }
}

describe('a jornada própria, na ficha de outra pessoa', () => {
  function montarFicha(ficha: FichaDoFuncionario) {
    responderComAFicha(ficha)
    return montar(createElement(FichaGravando, { ficha, propria: false }))
  }

  it('"usar a da empresa" mostra a da empresa como referência e grava NULO', async () => {
    const raiz = await montarFicha(FICHA)

    const escolha = raiz.querySelector<HTMLSelectElement>('#ficha-jornada-origem')
    expect(escolha?.value).toBe('empresa')
    expect(escolha?.disabled).toBe(false)
    expect(raiz.querySelector('label[for="ficha-jornada-origem"]')?.textContent).toBe('Jornada desta pessoa')
    expect(textoDe(raiz)).toContain('A jornada da empresa, hoje:')
    expect(textoDe(raiz)).toContain('08:00-12:00 e 13:00-17:00')
    // Sem editor enquanto segue a da empresa, e sem a frase da própria ficha.
    expect(raiz.querySelector('input[type="time"]')).toBeNull()
    expect(textoDe(raiz)).not.toContain(POR_QUE_A_PROPRIA_FICHA_E_SO_PARA_LER)
    // A data se edita.
    expect(raiz.querySelector<HTMLInputElement>('#ficha-bate-ponto-desde')?.disabled).toBe(false)

    await clicar(botaoCom(raiz, 'Salvar a ficha'))
    const [gravacao] = gravacoes()
    expect(gravacao.tabela).toBe('ponto_funcionarios')
    expect(argsDe(gravacao, 'update')?.[0]).toHaveProperty('jornada', null)
  })

  it('"jornada própria" abre o editor começando da da empresa, e grava a lista e a data', async () => {
    const raiz = await montarFicha(FICHA)

    await escolher(raiz, 'ficha-jornada-origem', 'propria')
    expect(raiz.querySelector<HTMLInputElement>('#ficha-jornada-1-0-inicio')?.value).toBe('08:00')
    expect(textoDe(raiz)).not.toContain('A jornada da empresa, hoje:')

    // Sexta só de manhã, e a data em que passou a bater ponto aqui.
    await clicar(botaoPorRotulo(raiz, 'Tirar o segundo bloco de sexta'))
    expect(totalDe(dia(raiz, 'Sexta'))).toContain('4h00')
    await digitar(raiz, 'ficha-bate-ponto-desde', '2026-10-05')
    await clicar(botaoCom(raiz, 'Salvar a ficha'))

    const enviado = argsDe(gravacoes()[0], 'update')?.[0] as Record<string, unknown>
    expect(enviado.jornada).toEqual(JORNADA_SEMENTE.filter((b) => !(b.dia === 5 && b.inicio === '13:00')))
    expect(enviado.bate_ponto_desde).toBe('2026-10-05')
  })

  it('a ficha que já tem jornada própria abre nela; voltar para a da empresa grava NULO', async () => {
    const propria = [{ dia: 2 as const, inicio: '09:00', fim: '15:00' }]
    const raiz = await montarFicha({ ...FICHA, jornada: propria })

    expect(raiz.querySelector<HTMLSelectElement>('#ficha-jornada-origem')?.value).toBe('propria')
    expect(raiz.querySelector<HTMLInputElement>('#ficha-jornada-2-0-fim')?.value).toBe('15:00')

    await escolher(raiz, 'ficha-jornada-origem', 'empresa')
    await clicar(botaoCom(raiz, 'Salvar a ficha'))
    expect(argsDe(gravacoes()[0], 'update')?.[0]).toHaveProperty('jornada', null)
  })

  it('jornada própria com bloco invertido: a frase do banco, e nada sai para gravar', async () => {
    const raiz = await montarFicha(FICHA)

    await escolher(raiz, 'ficha-jornada-origem', 'propria')
    await digitar(raiz, 'ficha-jornada-1-1-inicio', '18:00')
    await clicar(botaoCom(raiz, 'Salvar a ficha'))

    expect(textoDe(raiz.querySelector('[role="alert"]'))).toContain(
      'Jornada inválida: no dia 1 (segunda), o bloco 18:00-17:00 não termina depois de começar',
    )
    expect(gravacoes()).toEqual([])
  })

  it('a recusa da trava da própria ficha chega traduzida (a ficha virou da sessão em outra aba)', async () => {
    estado.resposta = () => ({
      data: null,
      error: {
        code: '42501',
        message:
          'Quem e dono da ficha nao muda a propria jornada nem a data em que passou a bater ponto: peca a outra pessoa que administra o ponto ou ao super admin',
      },
    })
    const raiz = await montar(createElement(FichaGravando, { ficha: FICHA, propria: false }))
    await clicar(botaoCom(raiz, 'Salvar a ficha'))
    expect(textoDe(raiz.querySelector('[role="alert"]'))).toBe(
      'Esta ficha é a sua, e quem é dono da ficha não muda a própria jornada nem a data em que passou a bater ponto aqui: as duas decidem o saldo de horas. Peça a outra pessoa que administra o ponto, ou ao super admin.',
    )
  })
})

describe('a própria ficha, de quem está logado', () => {
  function montarPropria(ficha: FichaDoFuncionario = FICHA_DA_SESSAO) {
    responderComAFicha(ficha)
    return montar(createElement(FichaGravando, { ficha, propria: true }))
  }

  it('mostra a jornada e a data bloqueadas, com a frase do porquê', async () => {
    const raiz = await montarPropria()

    expect(textoDe(raiz)).toContain(POR_QUE_A_PROPRIA_FICHA_E_SO_PARA_LER)
    expect(POR_QUE_A_PROPRIA_FICHA_E_SO_PARA_LER).toMatch(
      /^Esta ficha é a sua\. Quem é dono da ficha não muda a própria jornada nem a data em que passou a bater ponto aqui/,
    )

    const data = raiz.querySelector<HTMLInputElement>('#ficha-bate-ponto-desde')
    expect(data?.value).toBe('2026-09-01')
    expect(data?.disabled).toBe(true)
    expect(data?.getAttribute('aria-describedby')).toBe('ficha-propria-explicacao')
    expect(textoDe(raiz.querySelector('#ficha-propria-explicacao'))).toBe(POR_QUE_A_PROPRIA_FICHA_E_SO_PARA_LER)

    const origem = raiz.querySelector<HTMLSelectElement>('#ficha-jornada-origem')
    expect(origem?.value).toBe('propria')
    expect(origem?.disabled).toBe(true)
    // A jornada própria aparece para ler: sem editor, sem botão de acrescentar ou tirar.
    expect(textoDe(raiz)).toContain('A jornada própria desta pessoa:')
    expect(textoDe(raiz)).toContain('09:00-15:00')
    expect(raiz.querySelector('input[type="time"]')).toBeNull()
    expect(botaoCom(raiz, 'Acrescentar')).toBeUndefined()
    // O resto da ficha continua editável.
    expect(raiz.querySelector<HTMLInputElement>('#ficha-cargo')?.disabled).toBe(false)
    expect(raiz.querySelector<HTMLInputElement>('#ficha-nome')?.disabled).toBe(false)
  })

  it('seguindo a da empresa, mostra a da empresa para ler, também bloqueada', async () => {
    const raiz = await montarPropria({ ...FICHA_DA_SESSAO, jornada: null, batePontoDesde: null })
    const origem = raiz.querySelector<HTMLSelectElement>('#ficha-jornada-origem')
    expect(origem?.value).toBe('empresa')
    expect(origem?.disabled).toBe(true)
    expect(textoDe(raiz)).toContain('A jornada da empresa, hoje:')
    expect(raiz.querySelector<HTMLInputElement>('#ficha-bate-ponto-desde')?.value).toBe('')
    expect(raiz.querySelector<HTMLInputElement>('#ficha-bate-ponto-desde')?.disabled).toBe(true)
  })

  it('a gravação manda o cargo e não manda a jornada nem a data', async () => {
    const raiz = await montarPropria()
    await digitar(raiz, 'ficha-cargo', 'Diretora de operações')
    await clicar(botaoCom(raiz, 'Salvar a ficha'))

    const [gravacao] = gravacoes()
    expect(gravacao.tabela).toBe('ponto_funcionarios')
    const enviado = argsDe(gravacao, 'update')?.[0] as Record<string, unknown>
    expect(enviado).toMatchObject({ cargo: 'Diretora de operações', usuario_id: CONTA_DA_SESSAO })
    expect(enviado).not.toHaveProperty('jornada')
    expect(enviado).not.toHaveProperty('bate_ponto_desde')
    expect(raiz.querySelector('[role="alert"]')).toBeNull()
  })
})
