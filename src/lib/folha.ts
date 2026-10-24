/*
 * A FOLHA DE PONTO MENSAL — o papel que o funcionário assina.
 *
 * O QUE ESTE MÓDULO É: a montagem da folha, em função pura. Entra a
 * configuração da empresa, o funcionário, o mês e as batidas; sai uma
 * estrutura pronta para desenhar — cabeçalho, uma linha por dia, o total do
 * mês e as marcas de dia incompleto e de dia ajustado.
 *
 * ⚠ A CONTA NÃO É REFEITA AQUI. E ESSA É A REGRA MAIS IMPORTANTE DO ARQUIVO.
 * O total sai de `montarEspelho`, de `horas.ts` — a MESMA função que desenha o
 * espelho que o funcionário confere no celular e a mesma que alimenta o painel
 * do admin e o CSV. Não existe uma segunda fórmula de jornada neste app, e não
 * é por elegância: se a folha somasse por conta própria, o papel assinado e a
 * tela conferida passariam a discordar sobre quantas horas a pessoa trabalhou.
 * Num sistema que serve de prova trabalhista, essa é a pior divergência
 * possível — e ela apareceria meses depois, numa audiência, e não num teste.
 *
 * POR QUE ISTO É UM MÓDULO E NÃO UM COMPONENTE
 * Mesmo motivo de `horas.ts`, `csv.ts` e `pessoas.ts`: a folha tem casos que
 * dão errado CALADOS. Cabeçalho vazio que quebra a página, mês sem batida que
 * levanta exceção no meio do render, dia com seis batidas que estoura a tabela.
 * Nenhum deles vira erro na tela — viram papel errado. Ou tem teste, ou não é
 * verificável.
 *
 * O QUE NÃO MORA AQUI: nada de React, nada de Supabase, nada de CSS. Quem
 * desenha é `components/FolhaParaImprimir.tsx`; quem lê o banco é a tela.
 *
 * ELE NÃO SUBSTITUI O CSV, E OS DOIS CONVIVEM
 * `csv.ts` serve à contabilidade — uma linha por batida, colunas de máquina,
 * abre no Excel. Esta folha serve à assinatura — uma linha por dia, legível em
 * preto e branco, com espaço para caneta. São dois documentos com dois leitores
 * e dois formatos; unificá-los faria um que não serve a nenhum dos dois.
 */
import {
  enderecoEmUmaLinha,
  formatarCnpj,
  type DadosDaEmpresa,
} from './configuracao'
import { formatarHora, SEM_LOCALIZACAO_POR_EXTENSO, saiuSemLocalizacao, type Batida } from './formato'
import { ehBatidaDeAtraso, marcaDaBatida } from './atraso'
import {
  ausenciasPorDia,
  juntarDiasEAusencias,
  marcaDaAusenciaPorExtenso,
  type Ausencia,
} from './ausencias'
import {
  dataBrasileira,
  diaDaSemana,
  formatarDuracao,
  montarEspelho,
  primeiroDiaDoMes,
  rotuloDoMes,
  ultimoDiaDoMes,
  type ResumoDeDias,
} from './horas'

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

/**
 * O cabeçalho da empresa, já escrito.
 *
 * TUDO É `string`, E CAMPO AUSENTE É `''` — nunca `null`, nunca "não
 * informado", nunca um texto fixo no código. É o caso de borda: com a
 * configuração vazia, a folha imprime o espaço do cabeçalho EM BRANCO em vez de
 * falhar. Escrever "sem razão social" num papel que alguém assina seria pior do
 * que a linha em branco: a linha em branco é obviamente uma pendência, a frase
 * parece uma afirmação.
 *
 * Não é caso teórico: numa instalação nova a configuração nasce vazia (a linha
 * de `ponto_configuracao` só existe depois da primeira gravação pela área de
 * administração), e `razao_social` e `cnpj` são anuláveis de propósito.
 */
export interface CabecalhoDaFolha {
  razaoSocial: string
  nomeFantasia: string
  /** Com máscara — `12.345.678/0001-99`. É assim que se confere contra o cartão. */
  cnpj: string
  /** Endereço, cidade e UF numa linha só. Vazio quando nada foi preenchido. */
  endereco: string
  /** Nenhum dos quatro campos veio preenchido. A tela usa isto para avisar. */
  vazio: boolean
}

/**
 * Uma linha da tabela: um dia com batida, ou com ausência. Dia sem
 * nenhum dos dois não vira linha.
 */
export interface LinhaDaFolha {
  /** `dia_civil`, como o banco o carimbou. Serve de chave de lista. */
  dia: string
  /** `31/08/2026` — a forma que se lê num papel brasileiro. */
  data: string
  /** `segunda-feira`. Sábado e domingo saltam à vista sem precisar de cor. */
  diaDaSemana: string
  /** As horas do dia, em ordem, `HH:MM`. Uma por batida — quatro no dia normal. */
  horarios: string[]
  /**
   * Minutos do dia, já vindos de `horas.ts`. Zero quando o dia está incompleto
   * — e zero no dia que só tem ausência: ausência não conta hora.
   */
  minutos: number
  /** `9h00`. O mesmo texto que o funcionário vê no espelho. `—` no dia só de ausência. */
  total: string
  /** Número ímpar de batidas: falta uma para fechar algum par. */
  incompleto: boolean
  /**
   * Alguma batida do dia foi criada ou corrigida pelo administrador — fora as
   * batidas em atraso aprovadas, que têm marca própria (`atraso`).
   */
  ajustado: boolean
  /** Alguma batida do dia nasceu de um pedido de batida em atraso aprovado. */
  atraso: boolean
  /** O dia tem ausência ativa lançada pelo admin. Pode ter batida também. */
  ausencia: boolean
  /**
   * Alguma batida do dia saiu sem localização: o GPS não respondeu, e ela foi
   * gravada com a selfie e o PIN.
   */
  semLocalizacao: boolean
  /**
   * As marcas do dia, por extenso e em PALAVRA, não em cor.
   *
   * A folha é impressa em preto e branco, muitas vezes numa laser velha. Uma
   * marca que só existe como cor de fundo desaparece no papel — e o dia que não
   * entrou no total viraria um dia comum, sem nada explicando o buraco.
   */
  marcas: string[]
}

/** O nome e o e-mail de quem assina. `''` quando não há e-mail, nunca "sem e-mail". */
export interface FuncionarioDaFolha {
  nome: string
  email: string
}

export interface FolhaDePonto {
  cabecalho: CabecalhoDaFolha
  funcionario: FuncionarioDaFolha
  /** `2026-08`. */
  mes: string
  /** `Agosto de 2026`. */
  mesPorExtenso: string
  linhas: LinhaDaFolha[]
  /**
   * Quantas colunas de horário a tabela desenha, para todas as linhas ficarem
   * alinhadas. Mínimo quatro — ver `colunasDeHorario`.
   */
  colunasDeHorario: number
  /** Total, dias com batida e dias incompletos. Vem de `resumirDias`, intacto. */
  resumo: ResumoDeDias
  /** O total do mês já escrito: `168h30`. É o número do rodapé. */
  total: string
}

/* ------------------------------------------------------------------ */
/* O cabeçalho                                                         */
/* ------------------------------------------------------------------ */

/** A empresa que ainda não foi configurada. Ver `montarCabecalho`. */
const EMPRESA_VAZIA: DadosDaEmpresa = {
  razaoSocial: null,
  nomeFantasia: null,
  cnpj: null,
  endereco: null,
  cidade: null,
  uf: null,
}

/**
 * Os dados da empresa viram as quatro linhas do cabeçalho.
 *
 * `null` NA CONFIGURAÇÃO E `null` NA CONFIGURAÇÃO INTEIRA SÃO O MESMO CASO, de
 * propósito: um banco sem a linha 1 e uma linha 1 com todos os campos nulos
 * (a instalação que ainda não preencheu a empresa) produzem exatamente o
 * mesmo cabeçalho em branco. Distinguir os dois na folha não ajudaria ninguém —
 * quem precisa saber a diferença é o administrador, na tela de configuração.
 */
export function montarCabecalho(empresa: DadosDaEmpresa | null): CabecalhoDaFolha {
  const dados = empresa ?? EMPRESA_VAZIA

  const razaoSocial = dados.razaoSocial?.trim() ?? ''
  const nomeFantasia = dados.nomeFantasia?.trim() ?? ''
  // `formatarCnpj` devolve `''` para nulo e devolve o texto cru quando ele não
  // tem 14 dígitos — o banco só grava 14 ou nada, então na prática é máscara ou
  // vazio. Não inventamos máscara em cima de número torto.
  const cnpj = formatarCnpj(dados.cnpj)
  const endereco = enderecoEmUmaLinha(dados)

  return {
    razaoSocial,
    nomeFantasia,
    cnpj,
    endereco,
    vazio: razaoSocial === '' && nomeFantasia === '' && cnpj === '' && endereco === '',
  }
}

/* ------------------------------------------------------------------ */
/* A tabela                                                            */
/* ------------------------------------------------------------------ */

/**
 * O dia normal tem quatro batidas: entra, sai para o almoço, volta, sai.
 *
 * A tabela desenha QUATRO COLUNAS NO MÍNIMO mesmo num mês em que ninguém bateu
 * quatro vezes. É o desenho de uma folha de ponto, e uma tabela que encolhe
 * para duas colunas porque o mês teve só meio expediente parece um documento
 * diferente a cada mês — e ainda deixaria de mostrar, pelo espaço vazio, que
 * faltou batida ali.
 */
export const COLUNAS_MINIMAS_DE_HORARIO = 4

/**
 * Quantas colunas de horário a tabela precisa.
 *
 * O dia com MAIS batidas manda, e não o dia normal: a partir da quinta batida o
 * banco grava `extra` (ver a escada de `formato.ts`), e um dia de seis batidas
 * é comum em quem sai para o banco no meio da tarde. Cortar a quinta e a sexta
 * para caber em quatro colunas seria apagar batida de um documento assinado.
 */
export function colunasDeHorario(batidasPorDia: number[]): number {
  return batidasPorDia.reduce(
    (maior, quantas) => Math.max(maior, quantas),
    COLUNAS_MINIMAS_DE_HORARIO,
  )
}

const MARCA_INCOMPLETO = 'Incompleto — fora do total'
const MARCA_AJUSTADO = 'Ajustado pelo administrador'

/**
 * "Em atraso, aprovada por Fulano: 08:00" — uma por batida de atraso do dia.
 *
 * A HORA VAI NA MARCA porque a marca é do DIA (a coluna de observações) e a
 * batida é uma das quatro: sem a hora, o papel diria que o dia teve uma batida
 * em atraso sem dizer qual. E vai em PALAVRA, pela mesma razão das outras
 * marcas — a folha sai em preto e branco.
 */
function marcaDeAtraso(
  batida: Batida,
  aprovadores: ReadonlyMap<string, string | null> | undefined,
): string {
  const texto = marcaDaBatida(batida, aprovadores)?.texto ?? 'em atraso, aprovada'
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}: ${formatarHora(batida.registrado_em)}`
}

/**
 * "Sem localização (o GPS não respondeu): 08:02" — uma por batida do dia que
 * saiu sem localização. Com a hora e em palavra, pelas mesmas razões da marca
 * de atraso: a marca é do dia, e a folha sai em preto e branco.
 */
function marcaSemLocalizacao(batida: Batida): string {
  return `${SEM_LOCALIZACAO_POR_EXTENSO}: ${formatarHora(batida.registrado_em)}`
}

/* ------------------------------------------------------------------ */
/* A montagem                                                          */
/* ------------------------------------------------------------------ */

export interface EntradaDaFolha {
  /** A configuração da empresa. `null` quando a linha nem existe. */
  empresa: DadosDaEmpresa | null
  funcionario: { nome: string; email: string | null }
  /** `AAAA-MM`. Levanta se não for mês — quem lê da URL confere antes. */
  mes: string
  /** As batidas da pessoa. O que não for do mês pedido é descartado — ver abaixo. */
  batidas: Batida[]
  /**
   * `pedido_id -> nome de quem aprovou`. Opcional: sem ele, a batida
   * em atraso sai marcada sem o nome. Pedido pendente não está aqui nem em
   * `batidas` — ele não é batida, e a folha só conta batida.
   */
  aprovadores?: ReadonlyMap<string, string | null>
  /**
   * As ausências da pessoa que tocam o mês, canceladas inclusive — a
   * folha marca só as ativas e só os dias do mês. Opcional: sem ela, a folha
   * sai sem as marcas de ausência.
   */
  ausencias?: readonly Ausencia[]
}

/**
 * A folha do mês de uma pessoa.
 *
 * ⚠ O TOTAL SAI DE `montarEspelho`, INTEIRO. Não há `reduce` de minutos neste
 * arquivo, não há soma de blocos, não há arredondamento próprio. `resumo` é o
 * objeto que `resumirDias` devolveu, repassado sem tocar. É essa linha que
 * garante que o total do mês confere com o do espelho.
 *
 * AS BATIDAS SÃO FILTRADAS PELO MÊS, e isso é uma garantia do documento, não
 * uma desconfiança da consulta. A tela pede exatamente o mês; mas a folha
 * declara um mês no cabeçalho, e um documento assinado não pode listar um dia
 * de setembro debaixo do título "Agosto de 2026" porque alguém passou um
 * período torto. O filtro custa uma passada e fecha o assunto.
 *
 * MÊS SEM BATIDA NENHUMA É RESPOSTA, NÃO ERRO.
 * Sai a folha com o cabeçalho, a tabela sem linhas, o total zerado e os espaços
 * de assinatura. É exatamente o que se precisa ter em mãos para provar que
 * ninguém bateu ponto naquele mês; uma exceção deixaria a dúvida entre "não
 * teve" e "quebrou".
 */
export function montarFolha(entrada: EntradaDaFolha): FolhaDePonto {
  const doMes = entrada.batidas.filter((batida) => batida.dia_civil.startsWith(`${entrada.mes}-`))

  // A única fonte de conta do arquivo. Ver o aviso acima.
  const espelho = montarEspelho(entrada.mes, doMes)

  /*
   * AS AUSÊNCIAS ENTRAM COMO LINHA, E NÃO COMO CONTA. O dia de
   * ausência sem batida ganha uma linha própria — com a marca e o total em
   * branco —, e o dia com ausência E batida mostra os dois. `resumo` e `total`,
   * lá embaixo, continuam saindo de `espelho`, que não sabe que ausência
   * existe: a soma do mês não muda por causa de uma falta justificada.
   */
  const recorte = { inicio: primeiroDiaDoMes(entrada.mes), fim: ultimoDiaDoMes(entrada.mes) }
  const dias = juntarDiasEAusencias(espelho.dias, ausenciasPorDia(entrada.ausencias ?? [], recorte))

  const linhas: LinhaDaFolha[] = dias.map(({ dia: diaCivil, batidas: dia, ausencias }) => {
    const marcasDaAusencia = ausencias.map(marcaDaAusenciaPorExtenso)

    if (!dia) {
      return {
        dia: diaCivil,
        data: dataBrasileira(diaCivil),
        diaDaSemana: diaDaSemana(diaCivil),
        horarios: [],
        minutos: 0,
        total: '—',
        incompleto: false,
        ajustado: false,
        atraso: false,
        ausencia: true,
        semLocalizacao: false,
        marcas: marcasDaAusencia,
      }
    }

    const marcas: string[] = [...marcasDaAusencia]
    if (dia.incompleto) marcas.push(MARCA_INCOMPLETO)

    /*
     * A batida em atraso aprovada nasce com `ajuste_manual` (o banco a cria
     * pelo caminho do admin, o único em que o carimbo mantém o horário
     * declarado). Contá-la também como "ajustado" diria duas vezes a mesma
     * coisa, e a segunda com a palavra errada. O dia só é "ajustado" se houver
     * ajuste FORA das de atraso.
     * Limite conhecido: uma batida de atraso corrigida depois pelo admin
     * continua só com a marca de atraso — a correção está na trilha.
     */
    const deAtraso = dia.batidas.filter(ehBatidaDeAtraso)
    const ajustado = dia.batidas.some((batida) => batida.ajuste_manual && !ehBatidaDeAtraso(batida))
    if (ajustado) marcas.push(MARCA_AJUSTADO)
    for (const batida of deAtraso) marcas.push(marcaDeAtraso(batida, entrada.aprovadores))
    const semLocalizacao = dia.batidas.filter(saiuSemLocalizacao)
    for (const batida of semLocalizacao) marcas.push(marcaSemLocalizacao(batida))

    return {
      dia: dia.dia,
      data: dataBrasileira(dia.dia),
      diaDaSemana: diaDaSemana(dia.dia),
      horarios: dia.batidas.map((batida) => formatarHora(batida.registrado_em)),
      minutos: dia.minutos,
      total: formatarDuracao(dia.minutos),
      incompleto: dia.incompleto,
      ajustado,
      atraso: deAtraso.length > 0,
      ausencia: ausencias.length > 0,
      semLocalizacao: semLocalizacao.length > 0,
      marcas,
    }
  })

  return {
    cabecalho: montarCabecalho(entrada.empresa),
    funcionario: {
      nome: entrada.funcionario.nome.trim(),
      // Mesma regra do cabeçalho: em branco em vez de uma frase inventada.
      email: entrada.funcionario.email?.trim() ?? '',
    },
    mes: entrada.mes,
    mesPorExtenso: rotuloDoMes(entrada.mes),
    linhas,
    colunasDeHorario: colunasDeHorario(espelho.dias.map((dia) => dia.batidas.length)),
    resumo: {
      minutos: espelho.minutos,
      diasComBatida: espelho.diasComBatida,
      diasIncompletos: espelho.diasIncompletos,
    },
    total: formatarDuracao(espelho.minutos),
  }
}

/**
 * O rótulo de cada coluna de horário: `1ª entrada`, `1ª saída`, `2ª entrada`…
 *
 * POR QUE NÃO "ENTRADA / ALMOÇO / VOLTA / SAÍDA", que é o que a tela do app usa
 * O pareamento de `horas.ts` é POSICIONAL, não pelo `tipo` gravado: a 1ª batida
 * fecha com a 2ª, a 3ª com a 4ª, e a 5ª nasce `extra` de propósito. Escrever
 * "Saída para o almoço" na segunda coluna afirmaria uma coisa que a conta não
 * usa — e num dia de seis batidas o rótulo estaria simplesmente errado, porque
 * a segunda saída não é almoço de ninguém.
 *
 * Ímpar entra, par sai. É a regra da conta, dita em português.
 */
export function rotuloDaColunaDeHorario(indice: number): string {
  const par = Math.floor(indice / 2) + 1
  return `${par}ª ${indice % 2 === 0 ? 'entrada' : 'saída'}`
}
