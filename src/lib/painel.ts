/*
 * A LISTA DO PAINEL: gente de um lado, batidas do outro, e a costura entre as
 * duas. Puro — sem React e sem rede —, porque a costura tem três casos que dão
 * errado calados e merecem teste: quem não bateu, quem não pode bater e quem
 * bateu mas não existe mais.
 *
 * A CONTA VEM DE `horas.ts`, INTEIRA
 * `agruparPorDia` + `resumirDias` são as MESMAS funções que desenham o espelho
 * do funcionário. Nenhuma soma é refeita aqui, e nenhuma agregação foi empurrada
 * para SQL: um `sum()` no banco seria uma segunda implementação da regra de
 * pareamento e de dia incompleto, e no primeiro conserto feito de um lado só o
 * painel do patrão passaria a discordar do espelho do funcionário.
 */
import {
  formatarHora,
  momentoNoFusoDoLocal,
  proximoTipo,
  ROTULO_CURTO,
  type Batida,
  type BatidaDoAdmin,
} from './formato'
import {
  agruparPorDia,
  calcularDia,
  ehDiaValido,
  formatarDuracao,
  resumirDias,
  rotuloDoMes,
  type DiaDoEspelho,
  type ResumoDeDias,
} from './horas'
import type { Ausencia } from './ausencias'
import type { PedidoDeAtraso } from './atraso'
import type { FichaDoFuncionario } from './cadastro'
import { camposFaltandoDaEmpresa, type DadosDaEmpresa } from './configuracao'
import { resumirLocalizacoes, type ResumoDeLocalizacoes } from './coordenada'
import { ancoraDoDia } from './corrigir'
import { ID_DA_SECAO } from './inicio-da-administracao'
import { comNomeGravado, comNomesDasFichas, fotografiaDasBatidas, nomesDasFichas, pessoaForaDaLista } from './nomes'
import { fichaLiberaAcesso } from './pessoas'
import { ehMesInteiro, parametrosDoPeriodo, periodoDoMes, rotuloDoPeriodo, type Periodo } from './periodo'

/** Uma pessoa na lista do painel. */
export interface FuncionarioDoPainel {
  usuarioId: string
  /**
   * O nome de exibição: a
   * ficha de RH ligada à conta, depois o nome guardado na conta, depois o nome
   * gravado na batida, depois o e-mail — a regra única de `nomes.ts`. Quem lê
   * só as contas (`lerContasDoPonto`) entrega aqui o nome guardado/e-mail; a
   * ficha entra por `comNomesDasFichas`, e o nome gravado, por
   * `comNomeGravado`, onde as batidas estão na mão.
   */
  nome: string
  /**
   * O nome guardado na conta, cru (`ponto_contas().nome`, que é
   * `raw_app_meta_data->>'full_name'`; nulo quando a conta não tem nome ou
   * não existe mais). É o que diz se o nome gravado na batida pode entrar: ele
   * vem DEPOIS do nome da conta, e só vale para quem não tem ficha nem nome aqui.
   */
  nomeDaConta: string | null
  email: string | null
  /**
   * A pessoa bate ponto pelo app: ficha que libera o acesso OU super admin — o
   * mesmo `bate_ponto` de `ponto_meu_acesso()` no banco do ponto (a ficha pela
   * regra de `fichaLiberaAcesso`). Quem não pode tem a linha sempre zerada, e a
   * tela precisa dizer por quê, em vez de deixar o admin achando que a pessoa
   * faltou o mês inteiro. Quem só administra (o RH, em geral) entra no app e
   * NÃO bate.
   *
   * O super admin sem ficha que libere o acesso bate só para teste: as batidas
   * dele são dele, e não entram na folha de ninguém. Sem ele aqui, uma batida
   * de teste apareceria no painel com "sem acesso ao ponto". Com a ficha, ele
   * bate por ela, como qualquer pessoa.
   */
  podeBater: boolean
  /**
   * A conta não está mais entre as do ponto (`ponto_contas()`), mas aparece por
   * uma batida, uma ausência, um pedido, uma ficha ou pela URL. O banco prevê
   * o caso: `usuario_id` não aponta para `auth.users` porque a
   * batida é prova trabalhista e tem que sobreviver ao desligamento. O nome
   * então vem da ficha ou do que o banco congelou na própria batida.
   */
  contaApagada: boolean
  /**
   * Há ficha de RH (`ponto_funcionarios`) ligada a esta conta, e o nome veio
   * dela. Falso na leitura crua das contas: quem junta as fichas é
   * `comNomesDasFichas`. O painel marca "sem ficha de RH" quem não tem — a
   * folha dessa pessoa sai com o nome da conta, porque o nome completo vem da
   * ficha.
   */
  temFicha: boolean
}

export interface LinhaDoPainel {
  funcionario: FuncionarioDoPainel
  dias: DiaDoEspelho<BatidaDoAdmin>[]
  resumo: ResumoDeDias
  /**
   * Quantas batidas do período foram criadas ou corrigidas pelo admin — fora as
   * batidas em atraso aprovadas, contadas à parte em `atrasos`.
   */
  ajustes: number
  /** Quantas batidas do período nasceram de pedido de batida em atraso aprovado. */
  atrasos: number
  /**
   * `dia -> ausências ativas` da pessoa no período. Fica fora de
   * `resumo` de propósito: ausência marca o dia, não soma hora.
   */
  ausencias: ReadonlyMap<string, Ausencia[]>
  /**
   * Quantas batidas do período saíram "no local", "fora", imprecisas ou sem
   * localização — com a MESMA régua da tela do local (`resumirLocalizacoes`,
   * que usa `descreverLocalizacao`, a do espelho). É o indicador de "fora" por
   * pessoa: uma coordenada errada deixa TODO MUNDO 100% fora, e o painel do
   * mês, que é a tela que alguém abre toda semana, precisa dizer isso. Também
   * conta as que saíram sem localização porque o GPS não respondeu (`semGps`, a
   * etiqueta "2 sem localização"), fora da porcentagem.
   */
  localizacao: ResumoDeLocalizacoes
}

/** Ordem alfabética de gente de verdade: acento não vai para o fim da lista. */
const POR_NOME = new Intl.Collator('pt-BR', { sensitivity: 'base' })

/* ------------------------------------------------------------------ */
/* As fichas no painel                                                 */
/* ------------------------------------------------------------------ */

/** O que o painel precisa saber de uma ficha para decidir quem é do ponto num período. */
export type FichaNoPainel = Pick<FichaDoFuncionario, 'usuarioId' | 'ativo' | 'desligamento'>

/**
 * A gente do painel, da tela da pessoa e da folha: as contas do ponto com o
 * nome e o "pode bater" resolvidos, e o que das fichas serve a quem não está
 * entre elas.
 */
export interface GenteDoPainel {
  /**
   * As contas do ponto (`lerContasDoPonto`, de `ponto_contas()`), com o nome da
   * regra única (ficha → nome guardado na conta → e-mail; o nome gravado entra
   * onde há batidas) e o `podeBater`.
   */
  funcionarios: FuncionarioDoPainel[]
  /**
   * Conta -> nome completo da ficha ligada (`nomesDasFichas`). É o que dá nome a
   * quem não está em `funcionarios` — a batida de conta que não existe mais, a
   * ausência de quem não está na lista, a conta aberta pela URL da tela da pessoa.
   */
  nomesDeFicha: Map<string, string>
  /**
   * As contas que batem ponto HOJE: ficha que libera (`fichaLiberaAcesso`) OU
   * super admin — o `bate_ponto` de `ponto_meu_acesso()`.
   */
  batemPonto: Set<string>
  /** As fichas, para `contasComFichaNoPeriodo` (o painel só mostra quem é do ponto). */
  fichas: FichaNoPainel[]
}

export const GENTE_VAZIA: GenteDoPainel = {
  funcionarios: [],
  nomesDeFicha: new Map(),
  batemPonto: new Set(),
  fichas: [],
}

/** As contas em que alguma ficha libera o acesso hoje — o banco pergunta "EXISTE ficha que libera". */
export function contasLiberadasPelaFicha(fichas: readonly FichaDoFuncionario[], hoje: string): Set<string> {
  return new Set(
    fichas
      .filter((ficha) => fichaLiberaAcesso(ficha, hoje))
      .map((ficha) => ficha.usuarioId)
      .filter((usuarioId): usuarioId is string => usuarioId !== null),
  )
}

/**
 * Liga o `podeBater` de quem bate ponto (`batemPonto`: ficha que libera OU
 * super admin). Quem já podia continua podendo: ninguém perde nada aqui.
 */
export function marcarQuemBate(
  funcionarios: readonly FuncionarioDoPainel[],
  batemPonto: ReadonlySet<string>,
): FuncionarioDoPainel[] {
  return funcionarios.map((funcionario) =>
    funcionario.podeBater || !batemPonto.has(funcionario.usuarioId)
      ? funcionario
      : { ...funcionario, podeBater: true },
  )
}

/**
 * Contas, fichas e super admins, juntos, do jeito que o painel, a tela da
 * pessoa e a folha usam: o nome da ficha (`comNomesDasFichas`) e o "pode
 * bater" — ficha que libera OU super admin (`marcarQuemBate`). `hoje` é o dia
 * civil no fuso do ponto, injetado para o teste não depender do relógio.
 */
export function juntarGenteEFichas(
  contas: readonly FuncionarioDoPainel[],
  fichas: readonly FichaDoFuncionario[],
  hoje: string,
  superAdmins: readonly string[] = [],
): GenteDoPainel {
  const nomesDeFicha = nomesDasFichas(fichas)
  const batemPonto = new Set([...contasLiberadasPelaFicha(fichas, hoje), ...superAdmins])
  return {
    funcionarios: marcarQuemBate(comNomesDasFichas(contas, nomesDeFicha), batemPonto),
    nomesDeFicha,
    batemPonto,
    fichas: [...fichas],
  }
}

/**
 * A ficha ligada vale para o período? É o que faz alguém sem batida, ausência
 * nem pedido aparecer no painel (zerado — "quem não bateu" é pergunta do
 * fechamento).
 *
 * COM DATA DE DESLIGAMENTO, A DATA DECIDE: vale se o desligamento é no período
 * ou depois dele (no mês do acerto a pessoa ainda é do ponto). SEM DATA, O
 * `ativo` DECIDE. Assim a ficha inativa de quem foi desligada em 15/09 põe
 * essa pessoa no painel de setembro e não no de outubro em diante — sem isso, cada
 * desligamento viraria um cartão zerado para sempre, e o painel voltaria a
 * encher de gente que não bate.
 *
 * Ficha sem conta não põe ninguém no painel: ainda não há de quem mostrar
 * batidas (ela aparece na lista de pessoas, que é onde se liga a conta).
 */
export function fichaValeNoPeriodo(ficha: FichaNoPainel, periodo: Pick<Periodo, 'inicio'>): boolean {
  if (ficha.usuarioId === null) return false
  return ficha.desligamento !== null ? ficha.desligamento >= periodo.inicio : ficha.ativo
}

/** As contas com ficha ligada que vale para o período (`fichaValeNoPeriodo`). */
export function contasComFichaNoPeriodo(
  fichas: readonly FichaNoPainel[],
  periodo: Pick<Periodo, 'inicio'>,
): Set<string> {
  return new Set(
    fichas
      .filter((ficha) => fichaValeNoPeriodo(ficha, periodo))
      .map((ficha) => ficha.usuarioId)
      .filter((usuarioId): usuarioId is string => usuarioId !== null),
  )
}

/**
 * Quem é esta conta, para a tela da pessoa e a folha: a conta da lista ou, sem
 * ela, a pessoa fora da lista — com o nome da regra inteira (o nome gravado
 * nas batidas dela entra antes do e-mail) e o "pode bater".
 *
 * `batidas` são as da tela (as do período dessa conta); as de outra conta, se
 * vierem, são ignoradas.
 */
export function pessoaDoPainel(
  usuarioId: string,
  gente: GenteDoPainel,
  batidas: readonly BatidaDoAdmin[],
): FuncionarioDoPainel {
  const fotografia = fotografiaDasBatidas(batidas.filter((batida) => batida.usuario_id === usuarioId))
  const listada =
    gente.funcionarios.find((pessoa) => pessoa.usuarioId === usuarioId) ??
    marcarQuemBate([pessoaForaDaLista(usuarioId, gente.nomesDeFicha, fotografia)], gente.batemPonto)[0]
  return comNomeGravado(listada, fotografia)
}

/**
 * O que diz quem é do ponto num período, além de batida e ausência (que a
 * própria `montarLinhasDoPainel` vê). Tudo opcional: sem nada, só aparece quem
 * bateu ou tem ausência no período.
 */
export interface QuemEDoPonto {
  /** Conta -> nome da ficha (`nomesDasFichas`): o nome de quem aparece fora da lista de contas. */
  nomesDeFicha?: ReadonlyMap<string, string>
  /** Contas que batem ponto hoje: ficha que libera OU super admin (`GenteDoPainel.batemPonto`). */
  batemPonto?: ReadonlySet<string>
  /** Contas com ficha ligada que vale no período (`contasComFichaNoPeriodo`). */
  comFichaNoPeriodo?: ReadonlySet<string>
  /** Contas com pedido de batida em atraso no período, em qualquer estado (`lerContasComPedidoNoPeriodo`). */
  comPedidoNoPeriodo?: ReadonlySet<string>
}

/**
 * Junta contas e batidas numa lista só — SÓ COM QUEM É DO PONTO no período.
 *
 * Os `funcionarios` chegam com o nome de exibição já resolvido
 * (`juntarGenteEFichas`). Aqui, com as batidas na mão, entra o nome gravado
 * nelas para quem não tem ficha nem nome guardado na conta (`comNomeGravado`).
 * O `nomesDeFicha` de `quem` serve a quem NÃO está entre as contas — a batida
 * de conta que não existe mais e a ausência de quem não está na lista —, que
 * ganham o nome pela mesma regra (`pessoaForaDaLista`): ficha, nome gravado na
 * batida, e-mail.
 *
 * QUEM É DO PONTO
 * Quem tem ficha ligada que vale no período, ou tem batida, ausência ou pedido
 * de batida em atraso no período. A conta sem nada disso não entra: quem só
 * administra (o RH, em geral) não vira um cartão zerado no fechamento do mês.
 *
 * OS CASOS QUE ESTA FUNÇÃO EXISTE PARA RESOLVER
 *
 * 1. QUEM É DO PONTO E NÃO BATEU. Entra com tudo zerado. Sumir da lista seria
 *    pior: no fechamento do mês, "quem não bateu nenhum dia" é exatamente a
 *    pergunta — e por isso a ficha ligada basta para entrar.
 *
 * 2. BATIDA DE CONTA QUE NÃO EXISTE MAIS. Entra também, com `contaApagada`
 *    ligado e o nome da ficha da conta ou, sem ela, o que o banco congelou na
 *    linha (o nome, senão o e-mail). Descartá-la faria horas trabalhadas
 *    sumirem do total do período porque a conta saiu da lista — e é
 *    justamente esse mês o que mais precisa fechar certo.
 *
 * 3. QUEM NÃO PODE BATER (sem ficha que libera e sem ser super admin). Entra,
 *    se for do ponto, com a marca. Ele não consegue bater (o banco recusa),
 *    então soma zero; o que a tela precisa dizer é o motivo.
 *
 * 4. AUSÊNCIA, PEDIDO OU FICHA DE QUEM NÃO ESTÁ NA LISTA DE CONTAS
 *    (conta apagada). Entra também — a linha sai com o nome da ficha da conta
 *    ou, sem ficha, como "Conta fora da lista do ponto". Sumir com ela tiraria
 *    o dia do CSV.
 *
 * @param ausenciasPorPessoa de `ausenciasPorPessoa(ausencias, periodo)`: só as
 *   ativas, já recortadas ao período. Opcional — sem ele, ninguém tem ausência.
 * @param quem as fichas e os pedidos do período (`QuemEDoPonto`).
 */
export function montarLinhasDoPainel(
  funcionarios: FuncionarioDoPainel[],
  batidas: BatidaDoAdmin[],
  ausenciasPorPessoa: ReadonlyMap<string, ReadonlyMap<string, Ausencia[]>> = new Map(),
  quem: QuemEDoPonto = {},
): LinhaDoPainel[] {
  const nomesDeFicha = quem.nomesDeFicha ?? new Map<string, string>()
  const batemPonto = quem.batemPonto ?? new Set<string>()
  const comFicha = quem.comFichaNoPeriodo ?? new Set<string>()
  const comPedido = quem.comPedidoNoPeriodo ?? new Set<string>()

  const porUsuario = new Map<string, BatidaDoAdmin[]>()
  for (const batida of batidas) {
    const doUsuario = porUsuario.get(batida.usuario_id)
    if (doUsuario) doUsuario.push(batida)
    else porUsuario.set(batida.usuario_id, [batida])
  }

  const ehDoPonto = (usuarioId: string) =>
    porUsuario.has(usuarioId) ||
    ausenciasPorPessoa.has(usuarioId) ||
    comFicha.has(usuarioId) ||
    comPedido.has(usuarioId)

  const conhecidos = new Set(funcionarios.map((funcionario) => funcionario.usuarioId))
  const doPonto = funcionarios.filter((funcionario) => ehDoPonto(funcionario.usuarioId))

  // A batida de conta fora da lista: o nome vem da ficha da conta, depois do
  // nome gravado, depois do e-mail gravado.
  const orfaos: FuncionarioDoPainel[] = [...porUsuario.entries()]
    .filter(([usuarioId]) => !conhecidos.has(usuarioId))
    .map(([usuarioId, doUsuario]) => pessoaForaDaLista(usuarioId, nomesDeFicha, fotografiaDasBatidas(doUsuario)))

  const listados = new Set([...conhecidos, ...orfaos.map((orfao) => orfao.usuarioId)])
  const foraDaLista: FuncionarioDoPainel[] = [
    ...new Set([...ausenciasPorPessoa.keys(), ...comFicha, ...comPedido]),
  ]
    .filter((usuarioId) => !listados.has(usuarioId))
    .map((usuarioId) => pessoaForaDaLista(usuarioId, nomesDeFicha, null, 'Conta fora da lista do ponto'))

  return marcarQuemBate([...doPonto, ...orfaos, ...foraDaLista], batemPonto)
    .map((pessoa) => comNomeGravado(pessoa, fotografiaDasBatidas(porUsuario.get(pessoa.usuarioId) ?? [])))
    .map((funcionario) => {
      const dias = agruparPorDia(porUsuario.get(funcionario.usuarioId) ?? [])
      return {
        funcionario,
        dias,
        resumo: resumirDias(dias),
        // A batida em atraso aprovada nasce com `ajuste_manual` (caminho do
        // admin, o único em que o carimbo mantém o horário declarado). Ela vai
        // para a sua própria conta, e não para "ajustes": é outra história,
        // com marca própria.
        ajustes: dias.reduce(
          (total, dia) =>
            total +
            dia.batidas.filter((batida) => batida.ajuste_manual && !batida.pedido_atraso_id).length,
          0,
        ),
        atrasos: dias.reduce(
          (total, dia) => total + dia.batidas.filter((batida) => batida.pedido_atraso_id).length,
          0,
        ),
        ausencias: ausenciasPorPessoa.get(funcionario.usuarioId) ?? new Map<string, Ausencia[]>(),
        localizacao: resumirLocalizacoes(dias.flatMap((dia) => dia.batidas)),
      }
    })
    .sort(ordenar)
}

/**
 * Quem trabalhou primeiro, em ordem alfabética; depois quem não bateu; por
 * último quem nem pode bater (`podeBater`: ficha que libera ou super admin).
 *
 * A ORDEM ALFABÉTICA É A DO NOME DE EXIBIÇÃO: a Ana Beatriz, que usa a conta
 * `recepcao@`, fica no A — e não na letra do nome antigo que a conta guarda.
 * Os grupos existem para o fechamento ler primeiro quem trabalhou.
 *
 * Alfabético puro enterraria as vinte linhas que importam debaixo das dez que
 * são zero por construção. E ordenar por total de horas embaralharia a lista a
 * cada correção, tirando do admin a única coisa que faz uma lista de trinta
 * nomes ser navegável: saber mais ou menos onde cada pessoa está.
 */
function ordenar(a: LinhaDoPainel, b: LinhaDoPainel): number {
  const temBatida = (linha: LinhaDoPainel) => (linha.resumo.diasComBatida > 0 ? 0 : 1)
  const podeBater = (linha: LinhaDoPainel) => (linha.funcionario.podeBater ? 0 : 1)

  return (
    temBatida(a) - temBatida(b) ||
    podeBater(a) - podeBater(b) ||
    POR_NOME.compare(a.funcionario.nome, b.funcionario.nome)
  )
}

/** O rodapé do painel: a soma de todo mundo no período. */
export function totalizarPainel(linhas: LinhaDoPainel[]): ResumoDeDias & { pessoas: number } {
  return {
    minutos: linhas.reduce((total, linha) => total + linha.resumo.minutos, 0),
    diasComBatida: linhas.reduce((total, linha) => total + linha.resumo.diasComBatida, 0),
    diasIncompletos: linhas.reduce((total, linha) => total + linha.resumo.diasIncompletos, 0),
    pessoas: linhas.filter((linha) => linha.resumo.diasComBatida > 0).length,
  }
}

/* ------------------------------------------------------------------ */
/* Corrigir o ponto da pessoa sem errar                                */
/* ------------------------------------------------------------------ */

/*
 * O QUE A TELA DA PESSOA E A CAIXA DE CORRIGIR DIZEM, SEM REACT.
 *
 * Quem insere uma batida precisa ver o dia por extenso, as batidas que o dia já
 * tem e como ele vai ficar. Estas funções são as frases dessa conversa: a data
 * curta do botão ("sex., 16/10"), a data por extenso do cabeçalho, o nome de
 * cada batida de um dia ímpar, a prévia do dia depois de inserir e o recado do
 * que foi gravado.
 *
 * A CONTA CONTINUA SENDO A DE `horas.ts`. A prévia monta o dia com
 * `calcularDia` e escreve a duração com `formatarDuracao`, os mesmos do espelho
 * e do total do topo. E o nome de cada batida da prévia é o da POSIÇÃO no
 * relógio (`proximoTipo`), o mesmo mapeamento de `ponto_ordem_do_dia` no banco:
 * o banco reordena o dia, e qualquer batida inserida no meio dele empurra as
 * outras, e a 5ª vira "Extra" seja ela qual
 * for. Por isso a prévia nunca diz "a nova entra como Extra": ela mostra o dia
 * inteiro pela ordem do relógio, e avisa quando o dia fica ímpar e zera.
 */

const SEMANA_CURTA = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'] as const
const SEMANA_POR_EXTENSO = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
] as const
const MESES_POR_EXTENSO = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

/**
 * As partes de um dia civil, sem fuso: um dia civil não tem fuso, e o
 * `getUTCDay` de meia-noite UTC é o dia da semana dele em qualquer aparelho.
 * Tabela própria, e não `Intl`: o texto do botão e do recado tem de sair igual
 * no Node do teste, no Chrome e no Safari, e o `Intl` de cada um abrevia do
 * seu jeito ("sex." num, "sex" noutro).
 */
function partesDoDia(dia: string): { numero: number; mes: number; semana: number } | null {
  if (!ehDiaValido(dia)) return null
  const [ano, mes, numero] = dia.split('-').map(Number)
  return { numero, mes, semana: new Date(Date.UTC(ano, mes - 1, numero)).getUTCDay() }
}

/**
 * `2026-10-16` -> "sex., 16/10". A data dos botões e do recado: curta para
 * caber no botão em 320 px, com o dia da semana porque é por ele que o RH
 * lembra ("a sexta da Ana"). Dia inválido (o campo de data no meio da
 * digitação) vira texto vazio.
 */
export function diaCurto(dia: string): string {
  const partes = partesDoDia(dia)
  if (!partes) return ''
  const dd = String(partes.numero).padStart(2, '0')
  const mm = String(partes.mes).padStart(2, '0')
  return `${SEMANA_CURTA[partes.semana]}, ${dd}/${mm}`
}

/** `2026-10-16` -> "Sexta-feira, 16 de outubro". O cabeçalho da caixa. Inválido: vazio. */
export function diaPorExtenso(dia: string): string {
  const partes = partesDoDia(dia)
  if (!partes) return ''
  return `${SEMANA_POR_EXTENSO[partes.semana]}, ${partes.numero} de ${MESES_POR_EXTENSO[partes.mes - 1]}`
}

/**
 * O nome de cada batida na lista do dia, no painel.
 *
 * DIA PAR, OU HOJE EM ANDAMENTO: o tipo que o banco deu (Entrada, Almoço,
 * Volta, Saída, Extra). Hoje, com a pessoa ainda trabalhando, os tipos estão
 * certos: o servidor deu cada um pela ordem, e a próxima batida vem.
 *
 * DIA ÍMPAR DE ANTES DE HOJE: a posição ("1ª batida", "2ª batida", "3ª batida
 * (última)"). Num dia de 08:00, 12:00 e 17:00 em que faltou a volta do almoço,
 * o banco chama a das 17:00 de "Volta", porque é a 3ª. Mostrar "Volta" leva o
 * RH a corrigir 17:00 para 13:00 — apagando a saída que a pessoa bateu — em
 * vez de inserir a 13:00. A posição não mente, e quando o dia fechar o banco
 * renomeia tudo sozinho. É só exibição: o tipo gravado não muda.
 *
 * Um dia com uma batida só é "Única batida", e não "1ª batida (última)".
 */
export function rotuloNaLista(
  dia: Pick<DiaDoEspelho, 'batidas' | 'incompleto'>,
  indice: number,
  emAndamento = false,
): string {
  const batida = dia.batidas[indice]
  if (!dia.incompleto || emAndamento) return batida ? ROTULO_CURTO[batida.tipo] : ''
  const total = dia.batidas.length
  if (total === 1) return 'Única batida'
  return indice === total - 1 ? `${indice + 1}ª batida (última)` : `${indice + 1}ª batida`
}

const FORMATO_DA_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/** O que a caixa de inserir diz antes de gravar. */
export interface PreviaDoDia {
  texto: string
  /** O dia fica ímpar (e, se somava, zera) ou a hora repete uma que já existe: a tela pinta de atenção. */
  atencao: boolean
}

/**
 * Como o dia fica depois de inserir `novaHora` — a prévia da caixa de inserir.
 *
 * "Depois de inserir: 08:00 Entrada · 12:00 Almoço · 13:00 Volta · 17:00 Saída
 * — o dia fica completo e soma 8h00."
 *
 * O dia inteiro, pela ordem do relógio, com o nome da posição (o mesmo do
 * banco, ver o cabeçalho desta seção). Quando o resultado é ímpar, a frase diz
 * que o dia passa a não somar horas — é o caso que mais engana: a 5ª batida de
 * um dia fechado ZERA as 8h dele (`calcularDia` não soma dia incompleto).
 *
 * Hora incompleta (o campo no meio da digitação) ou dia inválido: `null`, e a
 * tela não mostra prévia nenhuma.
 */
/**
 * O dia como fica com uma batida a mais às `hora` — a conta é a de
 * `calcularDia`, a mesma do espelho. Serve à prévia da caixa de inserir e à do
 * cartão do pedido de atraso.
 */
function diaComANova(dia: string, batidas: readonly Batida[], hora: string): DiaDoEspelho {
  const nova: Batida = {
    id: 'previa',
    registrado_em: momentoNoFusoDoLocal(dia, hora),
    dia_civil: dia,
    tipo: 'extra',
    ordem_no_dia: 0,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    distancia_metros: null,
    no_local: null,
    selfie_path: null,
    ajuste_manual: true,
  }
  return calcularDia(dia, [...batidas, nova])
}

export function previaDoDia(entrada: {
  dia: string
  /** As batidas que o dia já tem, como a tela as leu (e as inseridas nesta caixa). */
  batidas: readonly Batida[]
  novaHora: string
}): PreviaDoDia | null {
  const { dia, batidas, novaHora } = entrada
  if (!FORMATO_DA_HORA.test(novaHora) || !ehDiaValido(dia)) return null

  const repetida = batidas.find((batida) => formatarHora(batida.registrado_em) === novaHora)
  if (repetida) {
    return {
      texto: `Já existe uma batida às ${novaHora} neste dia. Confira se não é a mesma: duas batidas no mesmo minuto são recusadas.`,
      atencao: true,
    }
  }

  const depois = diaComANova(dia, batidas, novaHora)
  const lista = depois.batidas
    .map((batida, indice) => `${formatarHora(batida.registrado_em)} ${ROTULO_CURTO[proximoTipo(indice)]}`)
    .join(' · ')
  const total = depois.batidas.length

  if (!depois.incompleto) {
    return {
      texto: `Depois de inserir: ${lista} — o dia fica completo e soma ${formatarDuracao(depois.minutos)}.`,
      atencao: false,
    }
  }
  if (total === 1) {
    return {
      texto: `Depois de inserir: ${lista} — o dia fica com 1 batida e só soma horas quando tiver a 2ª.`,
      atencao: true,
    }
  }
  return {
    texto: `Depois de inserir: ${lista} — o dia fica com ${total} batidas e passa a não somar horas até ter a ${total + 1}ª.`,
    atencao: true,
  }
}

/** O que acabou de ser gravado, para o recado da tela da pessoa. */
export type AcaoDoRecado =
  | { nome: 'inserida'; dia: string; hora: string }
  | { nome: 'corrigida'; diaAntes: string; horaAntes: string; dia: string; hora: string }
  | { nome: 'ausencia_lancada' }
  | { nome: 'ausencia_cancelada' }
  /** O pedido de batida em atraso decidido na tela da pessoa. */
  | { nome: 'pedido_aprovado'; dia: string; hora: string }
  | { nome: 'pedido_recusado'; hora: string }

/**
 * A frase do recado que aparece no rodapé depois de gravar — e, quando a tela
 * já releu o dia mexido, quanto ele soma agora.
 *
 * "Batida das 13:00 inserida em sex., 16/10. O dia agora soma 8h00."
 *
 * `diaRelido` é o dia como a releitura o trouxe (`agruparPorDia` da lista
 * nova): `undefined` enquanto a tela relê, `null` quando o dia ficou sem
 * batida (a única batida dele mudou de dia). A "Ausência cancelada" segue a
 * palavra da tela ("Cancelar ausência"), e não outra.
 */
export function fraseDoRecado(
  acao: AcaoDoRecado,
  diaRelido?: Pick<DiaDoEspelho, 'batidas' | 'incompleto' | 'minutos'> | null,
): string {
  let frase: string
  switch (acao.nome) {
    case 'inserida':
      frase = `Batida das ${acao.hora} inserida em ${diaCurto(acao.dia)}.`
      break
    case 'corrigida':
      frase =
        acao.diaAntes === acao.dia
          ? `Horário corrigido: ${acao.horaAntes} → ${acao.hora} em ${diaCurto(acao.dia)}.`
          : `Horário corrigido: ${acao.horaAntes} de ${diaCurto(acao.diaAntes)} → ${acao.hora} de ${diaCurto(acao.dia)}.`
      break
    case 'ausencia_lancada':
      return 'Ausência lançada.'
    case 'ausencia_cancelada':
      return 'Ausência cancelada.'
    case 'pedido_aprovado':
      frase = `Pedido das ${acao.hora} aprovado: a batida entrou em ${diaCurto(acao.dia)}.`
      break
    case 'pedido_recusado':
      return `Pedido das ${acao.hora} recusado.`
  }
  if (!diaRelido || diaRelido.batidas.length === 0) return frase
  const total = diaRelido.batidas.length
  return diaRelido.incompleto
    ? `${frase} O dia agora tem ${total} ${total === 1 ? 'batida' : 'batidas'} e não soma horas até ter a ${total + 1}ª.`
    : `${frase} O dia agora soma ${formatarDuracao(diaRelido.minutos)}.`
}

/* ------------------------------------------------------------------ */
/* Fechar o mês sem surpresa                                           */
/* ------------------------------------------------------------------ */

/*
 * O QUE FALTA RESOLVER ANTES DE IMPRIMIR — no painel e na folha, sem React.
 *
 * Sem isto, o RH imprimiria a folha e descobriria no papel o que a tela não
 * disse: o dia que saiu zero porque faltou uma batida, o pedido de batida em atraso que
 * ninguém decidiu (e que ainda vai mudar o total) e o cabeçalho sem CNPJ. As
 * funções abaixo montam essa lista uma vez só, para o bloco "Antes de fechar"
 * do painel e para os avisos da folha dizerem a mesma coisa.
 *
 * HOJE NÃO ENTRA. Às 10h a pessoa bateu a entrada e ainda vai bater o resto:
 * o dia ímpar de hoje é "Em andamento", e chamá-lo de pendência empurraria o
 * RH a inserir a saída de quem ainda está trabalhando — e
 * batida inserida não se apaga.
 *
 * O QUE NÃO É CONFERIDO É DITO. Dia útil sem nenhuma batida e sem ausência não
 * entra nesta conferência (ficou para depois): por isso a frase de "nada
 * pendente" diz isso com todas as letras, em vez de prometer que está tudo
 * certo para imprimir.
 */

/** O id do título da caixa de pendências de atraso, no painel. É para onde o "Decidir" do bloco leva. */
export const ANCORA_DOS_PEDIDOS = 'pendencias-de-atraso'

/** O id da seção de pedidos esperando decisão na tela da pessoa. É para onde o "Decidir" da folha leva. */
export const ANCORA_DOS_PEDIDOS_DA_PESSOA = 'pedidos-esperando'

/** O id do cartão de um pedido: o "Decidir" do cartão do dia rola até ele. */
export function ancoraDoPedido(pedidoId: string): string {
  return `pedido-${pedidoId}`
}

/** Onde se preenche o cabeçalho da folha: os dados da empresa, na Administração. */
export const DESTINO_DO_CABECALHO = `/administracao#${ID_DA_SECAO.empresa}`

/** "Ana" de "Ana Souza". Nome vazio continua vazio. */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? ''
}

/** "a", "a e b", "a, b e c". */
export function juntarComE(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? ''
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

/**
 * O período dentro de uma frase: "outubro de 2026" para o mês inteiro (o
 * fechamento de quase todo uso), as datas para qualquer outro recorte — o
 * painel navega por período livre, e "Antes de fechar outubro" num recorte de
 * 01/10 a 15/10 seria mentira.
 */
export function periodoNaFrase(periodo: Periodo): string {
  return ehMesInteiro(periodo) ? rotuloDoMes(periodo.inicio.slice(0, 7)).toLowerCase() : rotuloDoPeriodo(periodo)
}

/** `2026-10-16` -> "16/10": a data curta dos avisos da folha, que é de um mês só. */
function diaEMes(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

/** A tela da pessoa no período, já aberta numa âncora (`dia-…` ou a dos pedidos). */
function telaDaPessoa(usuarioId: string, periodo: Periodo, ancora: string): string {
  return `/painel/${usuarioId}?${new URLSearchParams(parametrosDoPeriodo(periodo)).toString()}#${ancora}`
}

const EMPRESA_EM_BRANCO: DadosDaEmpresa = {
  razaoSocial: null,
  nomeFantasia: null,
  cnpj: null,
  endereco: null,
  cidade: null,
  uf: null,
}
const TODOS_OS_CAMPOS_DO_CABECALHO = camposFaltandoDaEmpresa(EMPRESA_EM_BRANCO).length

/**
 * O que falta no cabeçalho da folha, com a MESMA régua da Administração
 * (`camposFaltandoDaEmpresa`: "A folha de ponto vai imprimir com o cabeçalho
 * incompleto: falta …"). Sem configuração gravada, falta tudo.
 */
export function faltandoNoCabecalho(empresa: DadosDaEmpresa | null): string[] {
  return camposFaltandoDaEmpresa(empresa ?? EMPRESA_EM_BRANCO)
}

/** Um item do bloco "Antes de fechar": o que falta e o link que resolve. */
export interface ItemDoFechamento {
  chave: string
  texto: string
  /** O rótulo do link: "Decidir", "Corrigir", "Preencher". */
  acao: string
  /** Âncora nesta página (`#…`) ou rota com âncora (`/painel/:id?de=…&ate=…#dia-…`). */
  destino: string
}

export interface FechamentoDoPeriodo {
  /** "Antes de fechar outubro de 2026". */
  titulo: string
  itens: ItemDoFechamento[]
  /**
   * Sem pedido esperando e sem dia incompleto: a frase que diz o que foi
   * conferido e o que não foi. Nula quando há pedido ou dia na lista.
   */
  semPendencias: string | null
  /** Alguém tem o dia de HOJE ímpar: a nota diz por que ele não está na lista. */
  notaDeHoje: string | null
}

/**
 * O bloco "Antes de fechar {mês}" do painel.
 *
 * Três tipos de item, nesta ordem:
 *  1. "2 pedidos de batida em atraso esperando decisão" → Decidir (a caixa de
 *     pendências, no topo do painel). Só os pedidos de dias DO PERÍODO: um
 *     pedido de setembro não muda a folha de outubro (e continua na caixa).
 *  2. "Ana Souza · sex., 16/10 · falta 1 batida" → Corrigir, um por dia ímpar
 *     de antes de hoje, com o link direto para o dia na tela da pessoa.
 *  3. "Cabeçalho da folha sem CNPJ" → Preencher.
 *
 * `pedidos` nulo (a leitura ainda não chegou, ou falhou — a caixa de
 * pendências mostra a falha) e `empresa` indefinida (a leitura falhou): o
 * bloco simplesmente não fala daquilo, e a frase de "nada pendente" não
 * promete o que não conferiu.
 */
export function pendenciasDoFechamento(entrada: {
  periodo: Periodo
  linhas: readonly Pick<LinhaDoPainel, 'funcionario' | 'dias'>[]
  pedidos: readonly Pick<PedidoDeAtraso, 'dia_civil'>[] | null
  empresa: DadosDaEmpresa | null | undefined
  hoje: string
}): FechamentoDoPeriodo {
  const { periodo, linhas, pedidos, empresa, hoje } = entrada
  const frase = periodoNaFrase(periodo)
  const itens: ItemDoFechamento[] = []

  const esperando = pedidos
    ? pedidos.filter((pedido) => pedido.dia_civil >= periodo.inicio && pedido.dia_civil <= periodo.fim).length
    : 0
  if (esperando > 0) {
    itens.push({
      chave: 'pedidos',
      texto: `${esperando} ${esperando === 1 ? 'pedido' : 'pedidos'} de batida em atraso esperando decisão`,
      acao: 'Decidir',
      destino: `#${ANCORA_DOS_PEDIDOS}`,
    })
  }

  let diasIncompletos = 0
  let hojeEmAndamento = false
  for (const linha of linhas) {
    for (const dia of linha.dias) {
      if (!dia.incompleto) continue
      if (dia.dia === hoje) {
        hojeEmAndamento = true
        continue
      }
      diasIncompletos += 1
      itens.push({
        chave: `dia-${linha.funcionario.usuarioId}-${dia.dia}`,
        texto: `${linha.funcionario.nome} · ${diaCurto(dia.dia)} · falta 1 batida`,
        acao: 'Corrigir',
        destino: telaDaPessoa(linha.funcionario.usuarioId, periodo, ancoraDoDia(dia.dia)),
      })
    }
  }

  if (empresa !== undefined) {
    const faltando = faltandoNoCabecalho(empresa)
    if (faltando.length > 0) {
      itens.push({
        chave: 'cabecalho',
        texto:
          faltando.length === TODOS_OS_CAMPOS_DO_CABECALHO
            ? 'Cabeçalho da folha em branco: os dados da empresa não foram preenchidos'
            : `Cabeçalho da folha sem ${juntarComE(faltando)}`,
        acao: 'Preencher',
        destino: DESTINO_DO_CABECALHO,
      })
    }
  }

  const NAO_CONFERIDO = 'Dias sem nenhuma batida não entram nesta conferência.'
  let semPendencias: string | null = null
  if (diasIncompletos === 0 && esperando === 0) {
    semPendencias =
      pedidos === null
        ? `Nenhum dia incompleto em ${frase}. ${NAO_CONFERIDO}`
        : `Nenhum dia incompleto e nenhum pedido esperando em ${frase}. ${NAO_CONFERIDO}`
  }

  return {
    titulo: `Antes de fechar ${frase}`,
    itens,
    semPendencias,
    notaDeHoje: hojeEmAndamento
      ? 'Hoje não entra nesta lista: quem está com uma batida faltando hoje ainda pode bater.'
      : null,
  }
}

/** Um aviso da folha, acima do botão de imprimir, com os links que resolvem. */
export interface AvisoDaFolha {
  chave: string
  texto: string
  links: { rotulo: string; destino: string }[]
}

/**
 * Os avisos da folha de uma pessoa num mês. Com algum deles, a folha NÃO abre
 * a caixa de impressão sozinha (o `?imprimir=1` dos botões): a impressão
 * espera o clique de quem leu.
 *
 *  • "Atenção: 1 dia incompleto (16/10) sai como zero nesta folha." com
 *    "Corrigir 16/10" para cada dia — hoje fica de fora, pela mesma razão do
 *    bloco do painel;
 *  • "1 pedido de batida em atraso desta pessoa ainda espera decisão." com
 *    "Decidir" (a seção de pedidos da tela da pessoa). Só os pedidos dela, de
 *    dias deste mês;
 *  • "Cabeçalho da folha sem CNPJ: esse campo sai em branco." com "Preencher".
 */
export function avisosDaFolha(entrada: {
  usuarioId: string
  mes: string
  linhas: readonly { dia: string; incompleto: boolean }[]
  pedidos: readonly Pick<PedidoDeAtraso, 'usuario_id' | 'dia_civil'>[]
  empresa: DadosDaEmpresa | null
  hoje: string
}): AvisoDaFolha[] {
  const { usuarioId, mes, linhas, pedidos, empresa, hoje } = entrada
  const periodo = periodoDoMes(mes)
  const avisos: AvisoDaFolha[] = []

  const incompletos = linhas.filter((linha) => linha.incompleto && linha.dia !== hoje).map((linha) => linha.dia)
  if (incompletos.length > 0) {
    const n = incompletos.length
    avisos.push({
      chave: 'dias',
      texto: `Atenção: ${n} ${n === 1 ? 'dia incompleto' : 'dias incompletos'} (${juntarComE(incompletos.map(diaEMes))}) ${n === 1 ? 'sai' : 'saem'} como zero nesta folha.`,
      links: incompletos.map((dia) => ({
        rotulo: `Corrigir ${diaEMes(dia)}`,
        destino: telaDaPessoa(usuarioId, periodo, ancoraDoDia(dia)),
      })),
    })
  }

  const esperando = pedidos.filter(
    (pedido) => pedido.usuario_id === usuarioId && pedido.dia_civil >= periodo.inicio && pedido.dia_civil <= periodo.fim,
  ).length
  if (esperando > 0) {
    avisos.push({
      chave: 'pedidos',
      texto: `${esperando} ${esperando === 1 ? 'pedido' : 'pedidos'} de batida em atraso desta pessoa ainda ${esperando === 1 ? 'espera' : 'esperam'} decisão.`,
      links: [{ rotulo: 'Decidir', destino: telaDaPessoa(usuarioId, periodo, ANCORA_DOS_PEDIDOS_DA_PESSOA) }],
    })
  }

  const faltando = faltandoNoCabecalho(empresa)
  if (faltando.length > 0) {
    avisos.push({
      chave: 'cabecalho',
      texto:
        faltando.length === TODOS_OS_CAMPOS_DO_CABECALHO
          ? 'Cabeçalho da folha em branco: a folha sai sem os dados da empresa.'
          : `Cabeçalho da folha sem ${juntarComE(faltando)}: ${faltando.length === 1 ? 'esse campo sai' : 'esses campos saem'} em branco.`,
      links: [{ rotulo: 'Preencher', destino: DESTINO_DO_CABECALHO }],
    })
  }

  return avisos
}

/** Como o dia fica se o pedido de batida em atraso for aprovado — o cartão do pedido. */
export interface PreviaDaAprovacao {
  /** "Neste dia já tem: 08:00 · 12:00 · 17:00 (dia incompleto)". */
  agora: string
  /** "Com a aprovação: 4 batidas, 8h00." */
  depois: string
  /** O dia fica ímpar, ou a hora repete uma que já existe: a tela pinta de atenção. */
  atencao: boolean
}

/**
 * A prévia do cartão do pedido. É ela que evita a batida dobrada: se o RH já
 * inseriu à mão a batida das 13:05, o cartão mostra o dia já com ela — e a
 * aprovação só é recusada pelo banco quando as duas caem no mesmo minuto.
 *
 * A conta é a da prévia da caixa de inserir (`calcularDia`): aprovar num dia
 * de 4 batidas deixa o dia com 5, ímpar, e ele passa a somar zero — a frase diz
 * isso, e não "cria uma extra". No dia de HOJE, o ímpar é "em andamento".
 *
 * Dia ou hora inválidos: `null`, e o cartão não mostra prévia.
 */
export function previaDaAprovacao(entrada: {
  dia: string
  /** As batidas que a tela já leu, daquela pessoa naquele dia. */
  batidas: readonly Batida[]
  /** O horário pedido, `HH:MM`. */
  hora: string
  hoje?: string
}): PreviaDaAprovacao | null {
  const { dia, batidas, hora, hoje } = entrada
  if (!FORMATO_DA_HORA.test(hora) || !ehDiaValido(dia)) return null

  const antes = calcularDia(dia, [...batidas])
  const agora =
    antes.batidas.length === 0
      ? 'Neste dia ainda não há batida.'
      : `Neste dia já tem: ${antes.batidas.map((batida) => formatarHora(batida.registrado_em)).join(' · ')} (${
          antes.incompleto ? 'dia incompleto' : formatarDuracao(antes.minutos)
        })`

  if (batidas.some((batida) => formatarHora(batida.registrado_em) === hora)) {
    return {
      agora,
      depois: `Já existe uma batida às ${hora} neste dia: confira se não é a mesma antes de aprovar.`,
      atencao: true,
    }
  }

  const depois = diaComANova(dia, batidas, hora)
  const total = depois.batidas.length
  const batidasEscritas = `${total} ${total === 1 ? 'batida' : 'batidas'}`
  if (!depois.incompleto) {
    return { agora, depois: `Com a aprovação: ${batidasEscritas}, ${formatarDuracao(depois.minutos)}.`, atencao: false }
  }
  if (dia === hoje) {
    return { agora, depois: `Com a aprovação, o dia fica com ${batidasEscritas} (ainda em andamento).`, atencao: false }
  }
  return { agora, depois: `Aprovar deixa o dia com ${batidasEscritas}: incompleto, sem horas.`, atencao: true }
}
