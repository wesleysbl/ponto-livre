/*
 * A FICHA DO FUNCIONÁRIO DO PONTO, EM FUNÇÕES PURAS.
 *
 * O QUE MORA AQUI: o tipo da ficha, a conferência do CPF, a máscara para a
 * tela e a leitura do formulário — texto digitado por gente vira ficha
 * conferida, ou vira uma lista de frases explicando o que está errado.
 *
 * O QUE NÃO MORA AQUI: nenhuma chamada ao Supabase, nenhum React, nenhum
 * relógio. Mesma razão de `configuracao.ts`, `horas.ts` e `pessoas.ts` serem
 * módulos: sem isso, a conferência do dígito verificador do CPF viveria dentro
 * de um componente e só poderia ser testada montando a tela.
 *
 * ---------------------------------------------------------------------------
 * ⚠ FICHA NÃO É CONTA, E A DIFERENÇA É O MOTIVO DESTE ARQUIVO EXISTIR
 *
 *   `pessoas.ts`  — as CONTAS do ponto (`ponto_contas()` + `ponto_admins` +
 *                   PIN). Quem entra no app, quem administra, quem tem PIN.
 *   `cadastro.ts` — os FUNCIONÁRIOS do ponto (`ponto_funcionarios`). Quem tem
 *                   CPF, cargo, admissão e folha para assinar.
 *
 * As duas listas se cruzam por `usuarioId`, e o vínculo é opcional: a ficha
 * pode nascer antes da conta (a funcionária é cadastrada antes de ganhar a
 * conta para bater ponto), e um cadastro que exigisse conta não conseguiria
 * recebê-la. A batida e a folha são da CONTA: da ficha, a folha leva só o nome
 * completo (a regra única de `nomes.ts`).
 * ---------------------------------------------------------------------------
 *
 * ⚠ ESTA VALIDAÇÃO NÃO É A PROTEÇÃO. QUEM RECUSA É O POSTGRES.
 * Cada regra abaixo espelha uma restrição da tabela `ponto_funcionarios` (em
 * `supabase/migrations/`): o CPF de 11 dígitos,
 * o nome preenchido, o desligamento depois da admissão, o CPF único entre
 * fichas ativas e a conta única. Elas existem para a tela dizer o que está
 * errado ANTES da viagem — e não para decidir nada. Alguém que chame o
 * PostgREST direto continua esbarrando nas mesmas regras, no banco.
 *
 * A ÚNICA EXCEÇÃO DELIBERADA É O DÍGITO VERIFICADOR DO CPF, e ela é a mesma
 * que `configuracao.ts` abriu para o CNPJ: um documento com dígito errado não
 * é "um valor que o banco recusaria", é um documento errado no cadastro de
 * alguém. A mensagem diz isso com essas palavras, sem afirmar que o banco
 * recusou.
 */
import { type Leitura } from './configuracao'
import { ehDiaValido } from './horas'

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

/**
 * Uma linha de `public.ponto_funcionarios`.
 *
 * QUASE TUDO É ANULÁVEL, e isso é o desenho, não descuido. CTPS, série, centro
 * de custo e matrícula muitas vezes não estão à mão quando a ficha é
 * cadastrada, e nem toda empresa usa matrícula. Campo em branco fica em
 * branco — inventar um número de CTPS seria pior do que deixar o campo vazio.
 */
export interface FichaDoFuncionario {
  id: string
  /**
   * A conta do ponto por onde esta pessoa bate ponto. NULO = ela é
   * funcionária cadastrada e ainda não tem conta: não bate ponto e não tem
   * folha, porque as duas são da conta.
   */
  usuarioId: string | null
  nomeCompleto: string
  /** Só os 11 dígitos, sem máscara — é assim que o banco guarda. */
  cpf: string | null
  matricula: string | null
  cargo: string | null
  /** `AAAA-MM-DD`, como o banco devolve `date`. */
  admissao: string | null
  desligamento: string | null
  ctps: string | null
  ctpsSerie: string | null
  centroCusto: string | null
  /** Ficha em uso. Desligar alguém aqui é desativar, nunca apagar. */
  ativo: boolean
  /**
   * A data em que esta pessoa passou a bater ponto NESTE sistema. NULO = a
   * data ainda não foi preenchida.
   *
   * ⚠ É REGISTRO, NÃO REGRA. Hoje o app guarda a data e a mostra na lista de
   * pessoas ("bate ponto aqui desde …", ou o aviso de que ela falta), e nada
   * mais a lê. Ela não libera nem bloqueia a batida — quem libera é a ficha
   * ativa ligada à conta, com ou sem a data —, e a folha, o espelho, o painel
   * e o CSV não a usam: nenhum deles acusa falta em dia sem batida. Uma tela
   * que diga o contrário promete o que o app não faz.
   */
  batePontoDesde: string | null
  /** ISO 8601 da última gravação. É o que a tela mostra quando duas abas brigam. */
  atualizadoEm: string | null
}

/**
 * O que se grava numa ficha.
 *
 * `ativo` NÃO ESTÁ AQUI de propósito: desativar é uma ação com confirmação
 * própria, e não um campo que se desmarca sem querer no meio de uma edição de
 * cargo. Quem a muda é `definirAtivoDaFicha`, em `administracao.ts`.
 */
export type DadosDaFicha = Omit<FichaDoFuncionario, 'id' | 'ativo' | 'atualizadoEm'>

/** O que o formulário da ficha entrega: tudo texto, como sai de um `<input>`. */
export interface RascunhoDaFicha {
  nomeCompleto: string
  cpf: string
  matricula: string
  cargo: string
  admissao: string
  desligamento: string
  ctps: string
  ctpsSerie: string
  centroCusto: string
  /** `''` = sem conta para bater ponto: a ficha pode nascer antes da conta. */
  usuarioId: string
  batePontoDesde: string
}

/* ------------------------------------------------------------------ */
/* CPF                                                                 */
/* ------------------------------------------------------------------ */

/** Tira ponto, traço, barra e espaço. Letra NÃO sai — ver `cpfEhValido`. */
export function somenteDigitosDeCpf(texto: string): string {
  return texto.replace(/[./\s-]/g, '')
}

/**
 * Confere os dois dígitos verificadores do CPF (módulo 11).
 *
 * O BANCO SÓ EXIGE 11 DÍGITOS, E ESTA CONFERÊNCIA É MAIS ESTRITA QUE ELE —
 * a exceção deliberada explicada no cabeçalho deste arquivo, gêmea da do CNPJ
 * em `configuracao.ts`.
 *
 * `11111111111` e os outros dez repetidos PASSAM na conta do módulo 11 e são
 * recusados à parte: é a armadilha clássica deste algoritmo, e `00000000000`
 * é justamente o que um campo preenchido por engano tende a virar.
 */
export function cpfEhValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos)) return false
  if (/^(\d)\1{10}$/.test(digitos)) return false

  const numeros = digitos.split('').map(Number)

  /**
   * O dígito de controle dos `ate` primeiros números. Pesos DECRESCENTES a
   * partir de `ate + 1` — é a forma que a Receita publica para o CPF, e é
   * diferente da do CNPJ, que gira 2..9 da direita para a esquerda.
   */
  const conferir = (ate: number): number => {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += numeros[i] * (ate + 1 - i)
    const resto = (soma * 10) % 11
    // 10 e 11 viram zero: é a regra do módulo 11 aplicada ao CPF.
    return resto === 10 || resto === 11 ? 0 : resto
  }

  return conferir(9) === numeros[9] && conferir(10) === numeros[10]
}

/** `"52998224725"` -> `"529.982.247-25"`. Devolve o que veio se não der. */
export function formatarCpf(digitos: string | null): string {
  if (!digitos || !/^\d{11}$/.test(digitos)) return digitos ?? ''
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`
}

/* ------------------------------------------------------------------ */
/* Datas                                                               */
/* ------------------------------------------------------------------ */

/**
 * Texto de campo de data -> `AAAA-MM-DD`, ou `null` quando vazio.
 *
 * Devolve `undefined` quando o texto existe e NÃO é uma data — os três estados
 * são diferentes e quem chama precisa distingui-los: vazio é uma escolha
 * legítima ("ainda não sei a admissão"), e lixo é erro.
 *
 * `<input type="date">` já entrega `AAAA-MM-DD` ou `''`, então o caminho do
 * `undefined` só é alcançado por navegador sem suporte ao campo, por
 * preenchimento automático estranho ou por teste. Ele existe porque "só é
 * alcançável de um jeito" é como um campo de data vira `Invalid Date` na folha.
 */
export function lerData(texto: string): string | null | undefined {
  const limpo = texto.trim()
  if (limpo === '') return null
  return ehDiaValido(limpo) ? limpo : undefined
}

/** `AAAA-MM-DD` -> `DD/MM/AAAA`, e `''` quando não há data. */
export function escreverData(dia: string | null): string {
  if (!dia || !ehDiaValido(dia)) return ''
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`
}

/** O formato de uuid que o Postgres aceita. A tela nunca digita isto à mão. */
const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ------------------------------------------------------------------ */
/* Validação do formulário                                             */
/* ------------------------------------------------------------------ */

/**
 * Lê o formulário da ficha.
 *
 * DEVOLVE TODAS AS FRASES DE UMA VEZ, e não a primeira — mesmo `Leitura<T>` de
 * `configuracao.ts`, e pela mesma razão: quem digitou CPF errado e inverteu as
 * datas erra dois campos, e corrigir um de cada vez, com uma viagem ao servidor
 * no meio, é o tipo de formulário que faz a pessoa desistir.
 *
 * CAMPO VAZIO NÃO É ERRO, exceto o nome. CTPS, série, centro de custo e
 * matrícula muitas vezes ainda não estão à mão quando a ficha é cadastrada;
 * deixá-los vazios é a leitura honesta do que se sabe. O que é recusado é campo
 * PREENCHIDO ERRADO — CPF que não fecha, data que não existe, desligamento
 * antes da admissão.
 *
 * O NOME É A ÚNICA OBRIGAÇÃO porque sem ele não há ficha: há uma linha órfã que
 * ninguém encontra na lista. E é ele, e só ele, que a folha da conta ligada
 * leva da ficha.
 */
export function validarFicha(rascunho: RascunhoDaFicha): Leitura<DadosDaFicha> {
  const erros: string[] = []
  const ouNulo = (texto: string) => texto.trim() || null

  const nomeCompleto = rascunho.nomeCompleto.trim()
  if (nomeCompleto === '') {
    erros.push('A ficha precisa do nome completo — é ele que sai no papel que a pessoa assina.')
  }

  const cpfDigitado = somenteDigitosDeCpf(rascunho.cpf).trim()
  let cpf: string | null = null
  if (cpfDigitado !== '') {
    if (!/^\d{11}$/.test(cpfDigitado)) {
      erros.push('O CPF precisa ter 11 dígitos. Deixe em branco se ainda não souber.')
    } else if (!cpfEhValido(cpfDigitado)) {
      erros.push(
        'Esse CPF não passa na conferência dos dígitos verificadores. Confira o número — um documento errado na ficha é pior do que um campo vazio.',
      )
    } else {
      cpf = cpfDigitado
    }
  }

  const admissao = lerData(rascunho.admissao)
  if (admissao === undefined) {
    erros.push('Admissão: escolha uma data válida, ou deixe em branco.')
  }

  const desligamento = lerData(rascunho.desligamento)
  if (desligamento === undefined) {
    erros.push('Desligamento: escolha uma data válida, ou deixe em branco.')
  }

  if (admissao && desligamento && desligamento < admissao) {
    // Comparação de texto: `AAAA-MM-DD` ordena igual à data que representa, e
    // não passa por `Date` nenhum — que é o que faria o fuso entrar na conta.
    erros.push(
      'O desligamento não pode ser anterior à admissão. O banco também recusa: entre as duas datas, cada dia sairia ao mesmo tempo antes de existir e depois do fim.',
    )
  }

  const batePontoDesde = lerData(rascunho.batePontoDesde)
  if (batePontoDesde === undefined) {
    erros.push('A data em que a pessoa passou a bater ponto aqui não é uma data válida.')
  }

  const usuarioDigitado = rascunho.usuarioId.trim()
  let usuarioId: string | null = null
  if (usuarioDigitado !== '') {
    if (!FORMATO_DE_UUID.test(usuarioDigitado)) {
      erros.push('A conta escolhida não é uma conta válida do ponto. Recarregue a página.')
    } else {
      usuarioId = usuarioDigitado
    }
  }

  if (erros.length > 0) return { ok: false, erros }
  return {
    ok: true,
    valor: {
      usuarioId,
      nomeCompleto,
      cpf,
      matricula: ouNulo(rascunho.matricula),
      cargo: ouNulo(rascunho.cargo),
      admissao: admissao ?? null,
      desligamento: desligamento ?? null,
      ctps: ouNulo(rascunho.ctps),
      ctpsSerie: ouNulo(rascunho.ctpsSerie),
      centroCusto: ouNulo(rascunho.centroCusto),
      batePontoDesde: batePontoDesde ?? null,
    },
  }
}

/**
 * O que ainda falta preencher na ficha desta pessoa. Lista de rótulos, na
 * ordem em que aparecem no formulário.
 *
 * NÃO É VALIDAÇÃO, É AVISO — mesmo desenho de `camposFaltandoDaEmpresa`: a
 * ficha grava do mesmo jeito, com o campo vazio. Ao contrário dos dados da
 * empresa, NENHUM DESTES CAMPOS SAI NA FOLHA (dela, a folha leva só o nome
 * completo). A lista existe para o cadastro de RH não ficar pela metade sem
 * ninguém notar, e a tela não pode dizer que eles imprimem em branco.
 *
 * `desligamento` FICA DE FORA: vazio ali é a informação de que a pessoa
 * trabalha na empresa, e não uma pendência.
 */
export function camposFaltandoDaFicha(ficha: FichaDoFuncionario): string[] {
  const faltando: string[] = []
  if (!ficha.cpf) faltando.push('CPF')
  if (!ficha.matricula) faltando.push('matrícula')
  if (!ficha.cargo) faltando.push('cargo')
  if (!ficha.admissao) faltando.push('admissão')
  if (!ficha.ctps) faltando.push('CTPS')
  if (!ficha.ctpsSerie) faltando.push('série da CTPS')
  if (!ficha.centroCusto) faltando.push('centro de custo')
  return faltando
}

/* ------------------------------------------------------------------ */
/* Os rótulos da lista                                                 */
/* ------------------------------------------------------------------ */

/**
 * O estado do vínculo desta ficha com uma conta do ponto, em uma frase.
 *
 * União discriminada, e não um booleano, porque a tela precisa escolher uma cor
 * e porque os três casos têm consequências diferentes:
 *
 *   `sem-conta`   — a pessoa não tem como bater ponto. É o estado de toda
 *                   ficha cadastrada antes da conta, e é pendência de dado, não
 *                   defeito do sistema.
 *   `nao-bate`    — tem conta, e a data em que passou a bater ponto aqui
 *                   (`batePontoDesde`) ainda não foi preenchida.
 *   `bate`        — tem conta e a data está preenchida.
 *
 * A frase de `nao-bate` não diz "ainda não bate ponto aqui": a ficha ativa
 * ligada LIBERA o ponto, com ou sem a data. O que falta, nesse estado, é só o
 * registro da data — e é isso que a frase diz, ao lado de "bate ponto pela
 * ficha" na lista. A data não muda a folha nem o acesso (ver `batePontoDesde`).
 */
export type VinculoDaFicha =
  | { estado: 'sem-conta'; texto: string }
  | { estado: 'nao-bate'; texto: string }
  | { estado: 'bate'; texto: string }

export function descreverVinculo(ficha: FichaDoFuncionario): VinculoDaFicha {
  if (!ficha.usuarioId) {
    return { estado: 'sem-conta', texto: 'sem conta para bater ponto' }
  }
  if (!ficha.batePontoDesde) {
    return { estado: 'nao-bate', texto: 'tem conta; falta a data em que passou a bater ponto aqui' }
  }
  return {
    estado: 'bate',
    texto: `bate ponto aqui desde ${escreverData(ficha.batePontoDesde)}`,
  }
}

/* ------------------------------------------------------------------ */
/* Ordem, filtro e resumo                                              */
/* ------------------------------------------------------------------ */

/** Ordem alfabética de gente de verdade: acento não vai para o fim da lista. */
const POR_NOME = new Intl.Collator('pt-BR', { sensitivity: 'base' })

/**
 * Ativas primeiro, e dentro de cada grupo, alfabético.
 *
 * A ORDEM É A PAUTA DA TELA: ficha desativada é histórico — ela existe para a
 * folha antiga continuar tendo cabeçalho — e enterrá-la no fim é dizer isso.
 * Alfabético dentro do grupo é o que faz uma lista de vinte nomes ser
 * navegável, porque a pessoa sabe mais ou menos onde procurar.
 */
export function ordenarFichas(fichas: FichaDoFuncionario[]): FichaDoFuncionario[] {
  return [...fichas].sort(
    (a, b) =>
      Number(b.ativo) - Number(a.ativo) || POR_NOME.compare(a.nomeCompleto, b.nomeCompleto),
  )
}

/**
 * Filtra por nome, CPF ou cargo.
 *
 * O CPF É COMPARADO SÓ POR DÍGITOS dos dois lados: quem digita `529.982` na
 * busca precisa achar a ficha guardada como `52998224725`, e quem digita
 * `52998` também. Comparar o texto cru faria a máscara decidir se a busca
 * funciona.
 *
 * SEM ACENTO E SEM CAIXA, como `filtrarPessoas`: quem digita "vitor" tem que
 * achar "Vítor".
 */
export function filtrarFichas(
  fichas: FichaDoFuncionario[],
  busca: string,
): FichaDoFuncionario[] {
  const alvo = normalizar(busca)
  if (alvo === '') return fichas
  const digitos = busca.replace(/\D/g, '')
  return fichas.filter(
    (ficha) =>
      normalizar(ficha.nomeCompleto).includes(alvo) ||
      normalizar(ficha.cargo ?? '').includes(alvo) ||
      (digitos !== '' && (ficha.cpf ?? '').includes(digitos)) ||
      (digitos !== '' && (ficha.matricula ?? '').includes(digitos)),
  )
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Os números do cabeçalho da seção: quantas fichas, quantas sem conta. */
export function resumirFichas(fichas: FichaDoFuncionario[]): {
  total: number
  ativas: number
  semConta: number
  semCpf: number
  naoBatemAqui: number
} {
  const ativas = fichas.filter((ficha) => ficha.ativo)
  return {
    total: fichas.length,
    ativas: ativas.length,
    // As três pendências contam só entre as ATIVAS: uma ficha desativada sem
    // CPF é história, não tarefa. Contá-la criaria uma pendência que ninguém
    // vai resolver — a pessoa não trabalha mais aqui.
    semConta: ativas.filter((ficha) => ficha.usuarioId === null).length,
    semCpf: ativas.filter((ficha) => ficha.cpf === null).length,
    naoBatemAqui: ativas.filter((ficha) => ficha.batePontoDesde === null).length,
  }
}
