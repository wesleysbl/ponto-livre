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
 * O SALDO TAMBÉM NÃO É CONTA DAQUI
 * Previsto, abonado, saldo, falta e atraso saem de `calcularSaldoDoMes`
 * (`saldo.ts`), a mesma chamada do espelho de quem bate o ponto, com as regras
 * montadas por `regrasDoSaldo`; este arquivo só os escreve, com as mesmas
 * palavras das telas (`components/SaldoDoDia.tsx`). Sem as regras (a
 * configuração da empresa não existe) ou sem dia cobrado no mês, a folha sai
 * como antes, sem as colunas do saldo, e `semSaldo` diz por quê no papel.
 *
 * O TOTAL COM ABONO. As telas somam o abonado no total do dia e do mês ("7h46
 * trabalhadas + 0h59 de atestado"), e o papel não pode dizer outro número: com
 * abono no mês, o alto da folha mostra o "Total com abono" e a conta dele
 * (`abono`). A coluna do trabalhado e o "Total do mês" da tabela continuam
 * sendo só as batidas. O abono vale até sem dia cobrado (a mesma regra de
 * `saldo.ts`); aí, sem a coluna do abonado, cada dia que abonou ganha a marca
 * "Abonado 0h59". O feriado nacional ganha a marca "Feriado: Nossa Senhora
 * Aparecida" no lugar de "Dia sem jornada".
 *
 * O RESUMO DO MÊS. Quem fecha o mês olha o fim da folha: quanto a pessoa fez a
 * mais e quanto ficou devendo. São o crédito e o débito do resumo de
 * `saldo.ts`, os mesmos números da tela, escritos como "Horas extras" e "Horas
 * negativas", com as faltas e o saldo, num quadro do fim da folha.
 *
 * DESDE QUANDO O SALDO CONTA. O primeiro dia cobrado é a mais nova entre a data
 * da ficha e a "Saldo calculado a partir de" da configuração
 * (`RegrasDoSaldo.cobrancaDesde`). Quando o mês começa antes dele, os dias de
 * antes ficam sem previsto, saldo e falta, e a folha diz, perto do resumo, a
 * partir de que dia o saldo conta (`cobrancaNoRecorte`); quando o mês inteiro é
 * anterior, a folha sai sem as colunas do saldo e diz que nenhum dia do mês
 * entra nele.
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
import {
  abonadoNoTotal,
  calcularSaldoDoMes,
  cobrancaNoRecorte,
  formatarSaldo,
  juntarDiasDeFalta,
  rotuloDoAbono,
  type EstadoDoDia,
  type RegrasDoSaldo,
  type ResumoDoSaldo,
  type SaldoDoDia,
} from './saldo'

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
 * Uma linha da tabela: um dia com batida, com ausência, ou de falta. Dia sem
 * nada disso não vira linha.
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
   * Minutos do dia, já vindos de `horas.ts`. Zero quando o dia está incompleto,
   * e zero no dia sem batida (só de ausência, ou de falta): ausência não conta
   * hora trabalhada.
   */
  minutos: number
  /**
   * `9h00`. O mesmo texto que o funcionário vê no espelho. `0h00` no dia sem
   * batida: a marca do dia diz por quê (a ausência, ou "Falta").
   */
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
   * Dia da jornada que passou sem batida e sem abono: a linha entra pela falta,
   * como no espelho (`juntarDiasDeFalta`), sem horário nenhum.
   */
  falta: boolean
  /** O saldo do dia, já escrito. `null` quando a folha sai sem as colunas do saldo. */
  saldo: SaldoDaLinha | null
  /**
   * As marcas do dia, por extenso e em PALAVRA, não em cor.
   *
   * A folha é impressa em preto e branco, muitas vezes numa laser velha. Uma
   * marca que só existe como cor de fundo desaparece no papel — e o dia que não
   * entrou no total viraria um dia comum, sem nada explicando o buraco.
   */
  marcas: string[]
}

/**
 * As três colunas do saldo de um dia, já escritas. Célula vazia (`''`) quando
 * o dia não tem o que dizer nela: fora da cobrança, a do previsto e a do saldo;
 * abonado zero, a do abonado (o buraco na coluna é a informação, como na
 * batida que faltou).
 */
export interface SaldoDaLinha {
  estado: EstadoDoDia
  /** `8h00`; `0h00` no dia sem jornada (a marca "Dia sem jornada" ou a do feriado diz por quê). */
  previsto: string
  abonado: string
  /** `0h00`, `+1h00`, `−2h00` (U+2212); `pendente` no dia incompleto; `em andamento` hoje. */
  saldo: string
}

/** O saldo do mês, já escrito, com as palavras do cartão do espelho (`ResumoDoSaldoNaTela`). */
export interface SaldoDaFolha {
  /** O objeto de `calcularSaldoDoMes`, intacto. */
  resumo: ResumoDoSaldo
  saldo: string
  previsto: string
  abonado: string
  /**
   * A soma do saldo positivo dos dias (o crédito do resumo): `+5h00`, ou
   * `0h00` sem nenhuma. Sai sempre, para ninguém precisar somar nada.
   */
  extras: string
  /** A soma do saldo negativo dos dias, faltas inclusive (o débito): `−12h25`, ou `0h00`. */
  negativas: string
  /** `1 dia`, `2 dias`; `nenhuma` sem falta. */
  faltas: string
  /**
   * "Saldo calculado a partir de 15/10/2026. Os dias antes dessa data ficam
   * fora do saldo." quando o mês começa antes do primeiro dia cobrado. `null`
   * quando o mês inteiro é cobrado.
   */
  notaDoInicio: string | null
  /** "O saldo não inclui 1 dia incompleto: …". `null` sem dia pendente. */
  notaDosIncompletos: string | null
  /** "Hoje entra no saldo quando o dia acabar." quando hoje está no mês. */
  notaDeHoje: string | null
  toleranciaMinutos: number
}

/** O total com abono do alto da folha. */
export interface AbonoDaFolha {
  /** O abonado que entra no total (`abonadoNoTotal`, de `saldo.ts`). */
  minutos: number
  /** Trabalhado + abonado: `152h35`. */
  total: string
  /** `108h05 trabalhadas + 44h30 abonadas`. */
  composicao: string
}

/** O nome e o e-mail de quem assina. `''` quando não há e-mail, nunca "sem e-mail". */
export interface FuncionarioDaFolha {
  nome: string
  email: string
}

/**
 * Os itens da legenda que este mês usa. A legenda explica as palavras das
 * observações; a que não aparece em dia nenhum não precisa de explicação, e o
 * espaço dela é o que deixa o mês comum de 22 dias, com as colunas do saldo,
 * numa folha só, com as assinaturas na mesma página das horas.
 */
export interface LegendaDaFolha {
  incompleto: boolean
  ajustado: boolean
  /** Batida em atraso aprovada (o pedido de quem esqueceu de bater), não o atraso da entrada. */
  batidaEmAtraso: boolean
  ausencia: boolean
  falta: boolean
  /** A marca "Atraso 0h25" do saldo. */
  atrasoDaEntrada: boolean
  /** Algum dia em andamento (hoje) ou pendente: fica fora do saldo do mês. */
  foraDoSaldo: boolean
  /** Algum dia da folha é feriado nacional. */
  feriado: boolean
  /** O mês tem abono no total (o alto da folha diz "Total com abono"). */
  abono: boolean
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
  /** O saldo do mês. `null` sem as colunas do saldo, e aí `semSaldo` diz por quê. */
  saldo: SaldoDaFolha | null
  /** A frase que o papel imprime quando a folha sai sem as colunas do saldo. */
  semSaldo: string | null
  /**
   * O abonado que soma no total do mês, já escrito. `null` sem abono nenhum:
   * aí o alto da folha mostra o "Total do mês" de sempre.
   */
  abono: AbonoDaFolha | null
  /** Que itens da legenda o papel imprime (ver `LegendaDaFolha`). */
  legenda: LegendaDaFolha
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

const MARCA_INCOMPLETO = 'Incompleto: fora do total'
/** Com o saldo, o dia incompleto que já passou diz também o que a tela diz dele. */
const MARCA_INCOMPLETO_COM_SALDO = 'Incompleto: fora do total, saldo pendente'
const MARCA_AJUSTADO = 'Ajustado pelo administrador'
const MARCA_FALTA = 'Falta'
const MARCA_SEM_JORNADA = 'Dia sem jornada'

/* ------------------------------------------------------------------ */
/* O saldo, escrito                                                    */
/* ------------------------------------------------------------------ */

/**
 * As células do saldo de um dia. Nenhuma conta: só a escolha das palavras,
 * as mesmas de `LinhaDoSaldo` (`components/SaldoDoDia.tsx`). Hoje e o dia
 * pendente NUNCA mostram o `saldoBruto`: às 10h ele é −7h00, e isso não é
 * débito de ninguém.
 */
function escreverSaldoDoDia(saldo: SaldoDoDia): SaldoDaLinha {
  // Fora da cobrança, só o abonado: ele soma no total com abono do alto da folha.
  if (saldo.estado === 'fora')
    return { estado: saldo.estado, previsto: '', abonado: saldo.abonado > 0 ? formatarDuracao(saldo.abonado) : '', saldo: '' }
  return {
    estado: saldo.estado,
    previsto: formatarDuracao(saldo.semJornada ? 0 : saldo.previsto),
    abonado: saldo.abonado > 0 ? formatarDuracao(saldo.abonado) : '',
    saldo:
      saldo.estado === 'em_andamento'
        ? 'em andamento'
        : saldo.estado === 'pendente'
          ? 'pendente'
          : formatarSaldo(saldo.saldo),
  }
}

/**
 * As marcas que o saldo acrescenta ao dia: "Feriado: Finados", "Falta",
 * "Atraso 0h25", "Dia sem jornada". O feriado aparece em qualquer estado, e no
 * lugar de "Dia sem jornada" (é a razão de o dia não ter jornada). Sem as
 * colunas do saldo (`comColunas` falso), o dia que abonou ganha "Abonado 0h59".
 */
function marcasDoSaldo(saldo: SaldoDoDia | undefined, comColunas: boolean): string[] {
  if (!saldo) return []
  const marcas: string[] = []
  if (saldo.feriado) marcas.push(`Feriado: ${saldo.feriado}`)
  if (!comColunas && saldo.abonado > 0 && !saldo.incompleto) marcas.push(`Abonado ${formatarDuracao(saldo.abonado)}`)
  if (saldo.estado === 'fora') return marcas
  if (saldo.semJornada && !saldo.feriado) marcas.push(MARCA_SEM_JORNADA)
  if (saldo.estado !== 'cobranca') return marcas
  if (saldo.falta) marcas.push(MARCA_FALTA)
  if (saldo.temAtraso) marcas.push(`Atraso ${formatarDuracao(saldo.atraso)}`)
  return marcas
}

function plural(quantidade: number, um: string, varios: string): string {
  return `${quantidade} ${quantidade === 1 ? um : varios}`
}

/** O resumo do mês, com as palavras de `ResumoDoSaldoNaTela`. */
function escreverSaldoDoMes(
  resumo: ResumoDoSaldo,
  comHoje: boolean,
  aPartirDe: string | null,
  toleranciaMinutos: number,
): SaldoDaFolha {
  const n = resumo.diasIncompletos
  return {
    resumo,
    saldo: formatarSaldo(resumo.saldo),
    previsto: formatarDuracao(resumo.previsto),
    abonado: formatarDuracao(resumo.abonado),
    extras: formatarSaldo(resumo.credito),
    negativas: formatarSaldo(-resumo.debito),
    faltas: resumo.faltas > 0 ? plural(resumo.faltas, 'dia', 'dias') : 'nenhuma',
    notaDoInicio: aPartirDe
      ? `Saldo calculado a partir de ${dataBrasileira(aPartirDe)}. Os dias antes dessa data ficam fora do saldo.`
      : null,
    notaDosIncompletos:
      n > 0
        ? `O saldo não inclui ${plural(n, 'dia incompleto', 'dias incompletos')}: falta batida, e o saldo ${n === 1 ? 'dele fica pendente' : 'deles fica pendente'} até a correção.`
        : null,
    notaDeHoje: comHoje ? 'Hoje entra no saldo quando o dia acabar.' : null,
    toleranciaMinutos,
  }
}

/**
 * Por que a folha sai sem as colunas do saldo. A frase vai para o PAPEL: uma
 * folha sem previsto nem saldo, calada, pareceria um mês cobrado em zero.
 * `null` quando algum dia do mês é cobrado.
 */
function motivoSemSaldo(regras: RegrasDoSaldo | null | undefined, mes: string): string | null {
  const inicio = 'Esta folha não traz previsto, abonado e saldo'
  if (!regras) return `${inicio}: a jornada da empresa não está cadastrada no sistema.`
  const cobranca = cobrancaNoRecorte(regras.cobrancaDesde, primeiroDiaDoMes(mes), ultimoDiaDoMes(mes))
  if (cobranca.caso === 'sem_data')
    return `${inicio}: a ficha desta pessoa não tem a data em que ela passou a bater ponto aqui, então nenhum dia é cobrado.`
  if (cobranca.caso === 'depois')
    return `${inicio}: o saldo é calculado a partir de ${dataBrasileira(cobranca.desde)}, e nenhum dia deste mês entra nele.`
  return null
}

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
  /**
   * As regras do saldo da pessoa, de `regrasDoSaldo` (a configuração, a ficha
   * e o "hoje" de Brasília). Nulas (ou ausentes) = a configuração da empresa
   * não existe, e a folha sai sem as colunas do saldo, com a frase de
   * `semSaldo`.
   */
  regras?: RegrasDoSaldo | null
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
   * AS AUSÊNCIAS ENTRAM COMO LINHA NO TOTAL TRABALHADO, E NÃO COMO CONTA. O dia
   * de ausência sem batida ganha uma linha própria, com a marca e o trabalhado
   * zero, e o dia com ausência E batida mostra os dois. `resumo` e `total`, lá
   * embaixo, continuam saindo de `espelho`, que não sabe que ausência existe: o
   * total trabalhado não muda por causa de um atestado. O abono que ele traz
   * soma à parte, no total com abono (`abono`) e no saldo.
   */
  const recorte = { inicio: primeiroDiaDoMes(entrada.mes), fim: ultimoDiaDoMes(entrada.mes) }
  const comAusencias = juntarDiasEAusencias(espelho.dias, ausenciasPorDia(entrada.ausencias ?? [], recorte))

  /*
   * O SALDO, DA MESMA CONTA DO ESPELHO. As batidas que entram são as mesmas
   * `doMes`, então o trabalhado de cada dia é o de `espelho`; o dia de falta
   * entra na lista como no espelho de quem bate o ponto (`juntarDiasDeFalta`).
   *
   * A conta roda sempre que há regras: sem dia cobrado no mês, nenhum dia tem
   * previsto nem saldo, mas o abono e o feriado existem e vão ao papel. As
   * colunas do saldo e o saldo do mês saem só quando `semSaldo` é nulo.
   */
  const semSaldo = motivoSemSaldo(entrada.regras, entrada.mes)
  const saldoCompleto = entrada.regras
    ? calcularSaldoDoMes(entrada.mes, doMes, entrada.ausencias ?? [], entrada.regras)
    : null
  const saldoDoMes = semSaldo ? null : saldoCompleto
  const comColunas = saldoDoMes !== null
  const saldoPorDia = new Map((saldoCompleto?.dias ?? []).map((saldo) => [saldo.dia, saldo]))
  const dias = saldoDoMes ? juntarDiasDeFalta(comAusencias, saldoDoMes.dias) : comAusencias
  const abonadoNoMes = abonadoNoTotal(saldoCompleto?.dias ?? [])
  const cobranca = entrada.regras ? cobrancaNoRecorte(entrada.regras.cobrancaDesde, recorte.inicio, recorte.fim) : null

  const linhas: LinhaDaFolha[] = dias.map(({ dia: diaCivil, batidas: dia, ausencias }) => {
    const saldoDoDia = saldoPorDia.get(diaCivil)
    const saldo = saldoDoDia && comColunas ? escreverSaldoDoDia(saldoDoDia) : null
    const marcasDaAusencia = [...ausencias.map(marcaDaAusenciaPorExtenso), ...marcasDoSaldo(saldoDoDia, comColunas)]
    const falta = saldoDoDia?.falta ?? false

    if (!dia) {
      return {
        dia: diaCivil,
        data: dataBrasileira(diaCivil),
        diaDaSemana: diaDaSemana(diaCivil),
        horarios: [],
        minutos: 0,
        total: formatarDuracao(0),
        incompleto: false,
        ajustado: false,
        atraso: false,
        ausencia: ausencias.length > 0,
        semLocalizacao: false,
        falta,
        saldo,
        marcas: marcasDaAusencia,
      }
    }

    const marcas: string[] = [...marcasDaAusencia]
    // Hoje ímpar é "em andamento", não pendente: só o dia passado diz "saldo pendente".
    if (dia.incompleto) marcas.push(saldo?.estado === 'pendente' ? MARCA_INCOMPLETO_COM_SALDO : MARCA_INCOMPLETO)

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
      falta,
      saldo,
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
    legenda: {
      incompleto: linhas.some((linha) => linha.incompleto),
      ajustado: linhas.some((linha) => linha.ajustado),
      batidaEmAtraso: linhas.some((linha) => linha.atraso),
      ausencia: linhas.some((linha) => linha.ausencia),
      falta: linhas.some((linha) => linha.falta),
      atrasoDaEntrada: (saldoDoMes?.dias ?? []).some((saldo) => saldo.estado === 'cobranca' && saldo.temAtraso),
      foraDoSaldo: linhas.some((linha) => linha.saldo?.estado === 'pendente' || linha.saldo?.estado === 'em_andamento'),
      feriado: linhas.some((linha) => Boolean(saldoPorDia.get(linha.dia)?.feriado)),
      abono: abonadoNoMes > 0,
    },
    saldo:
      saldoDoMes && entrada.regras
        ? escreverSaldoDoMes(
            saldoDoMes.resumo,
            saldoDoMes.dias.some((saldo) => saldo.estado === 'em_andamento'),
            cobranca?.caso === 'no_meio' ? cobranca.desde : null,
            entrada.regras.toleranciaMinutos,
          )
        : null,
    semSaldo,
    abono:
      abonadoNoMes > 0
        ? {
            minutos: abonadoNoMes,
            total: formatarDuracao(espelho.minutos + abonadoNoMes),
            composicao: `${formatarDuracao(espelho.minutos)} trabalhadas + ${formatarDuracao(abonadoNoMes)} ${rotuloDoAbono(saldoCompleto?.dias ?? [])}`,
          }
        : null,
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
