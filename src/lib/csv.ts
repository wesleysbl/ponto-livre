/*
 * A EXPORTAÇÃO DO PERÍODO EM CSV.
 *
 * ESTE ARQUIVO É PURO DE PROPÓSITO
 * Gerar texto não precisa de React nem de Supabase, e um CSV errado só aparece
 * na hora em que a contabilidade abre o arquivo — tarde demais. Sendo função
 * pura, cada regra abaixo tem um teste que a executa de verdade
 * (`csv.test.ts`). Quem sabe baixar arquivo é a tela; quem sabe o que vai
 * dentro dele é este módulo.
 *
 * A CONTA NÃO É REFEITA AQUI
 * O total do dia sai de `agruparPorDia`, o MESMO que desenha o espelho do
 * funcionário. Se o CSV somasse por conta própria, o relatório entregue ao
 * contador e a tela que o funcionário confere passariam a discordar sobre
 * quantas horas ele trabalhou — que é o pior defeito possível num sistema de
 * prova trabalhista.
 *
 * ---------------------------------------------------------------------------
 * AS QUATRO DECISÕES DE FORMATO, E POR QUE CADA UMA
 *
 * 1. SEPARADOR `;`, não vírgula. O Excel em português usa o separador de lista
 *    do sistema, que no Windows brasileiro é o ponto e vírgula: um arquivo
 *    separado por vírgula abre com TUDO empilhado numa coluna só. E como número
 *    decimal em pt-BR se escreve com vírgula (`1234,56`), a vírgula já está
 *    ocupada. O Google Sheets detecta `;` sozinho.
 *
 * 2. BOM DE UTF-8 (`EF BB BF`) na primeira posição do arquivo. Sem ele o Excel do
 *    Windows lê o arquivo como Windows-1252 e "João" vira "JoÃ£o", "Saída" vira
 *    "SaÃ­da". Três bytes que decidem se o relatório é legível.
 *
 * 3. FIM DE LINHA `\r\n`, como manda a RFC 4180 e como o Excel do Windows
 *    espera. O Sheets e o LibreOffice aceitam os dois.
 *
 * 4. DATA `31/08/2026` E HORA `08:32`, não ISO. O Excel pt-BR lê `31/08/2026`
 *    como data de verdade; lê `2026-08-31` como texto, e em alguns ambientes
 *    reinterpreta `08/09` no formato americano e transforma 8 de setembro em 9
 *    de agosto. O número decimal vai com vírgula, pelo mesmo motivo.
 * ---------------------------------------------------------------------------
 */
import {
  descreverLocalizacao,
  formatarHora,
  ROTULO_DA_ORIGEM,
  ROTULO_DO_TIPO,
  SEM_LOCALIZACAO_POR_EXTENSO,
  type BatidaDoAdmin,
} from './formato'
import { agruparPorDia, dataBrasileira, diaDaSemana } from './horas'
import { marcaDaBatida } from './atraso'
import { juntarDiasEAusencias, marcaDaAusenciaPorExtenso, type Ausencia } from './ausencias'
import { apelidoDoPeriodo, type Periodo } from './periodo'

export const SEPARADOR = ';'
export const FIM_DE_LINHA = '\r\n'
/** Escrito como escape, e não como o caractere: um BOM literal no meio do
 *  código-fonte é invisível no editor e some no primeiro copiar e colar. */
export const BOM = '\uFEFF'

/**
 * O cabeçalho, e a ordem das colunas.
 *
 * AS QUATRO ÚLTIMAS FECHAM O DIA, e é a única regra que o leitor precisa saber:
 * elas são preenchidas SÓ na última batida de cada dia e ficam vazias nas
 * outras. É isso que faz "uma linha por batida" conviver com "o total por dia"
 * num arquivo só e ainda retangular:
 *
 *  • a planilha continua com uma linha por batida, sem linha de subtotal
 *    intrometida no meio, então filtro, ordenação e tabela dinâmica funcionam;
 *  • o total do período sai de uma `SOMA` simples em "Horas do dia (decimal)",
 *    como número comum — porque o número aparece uma vez por dia, e não
 *    repetido em cada batida (que dobraria, quadruplicaria, o total). A coluna
 *    em `h:mm` chega ao mesmo total com a soma no formato `[h]:mm` (ver
 *    `horasParaPlanilha`);
 *  • filtrar "Horas do dia" por não-vazio produz o resumo diário, uma linha por
 *    dia, sem exportar um segundo arquivo.
 */
export const CABECALHO = [
  'Funcionário',
  'E-mail',
  'Data',
  'Dia da semana',
  'Hora',
  'Tipo',
  'Ordem no dia',
  'Origem',
  'Ajuste manual',
  'Motivo do ajuste',
  'Local',
  'Distância (m)',
  'Precisão (m)',
  'Selfie',
  'Batidas no dia',
  'Dia incompleto',
  'Horas do dia',
  'Horas do dia (decimal)',
] as const

export interface PessoaParaExportar {
  /** Nome que encabeça as linhas desta pessoa no arquivo inteiro. */
  nome: string
  email: string | null
  /** As batidas dela no período, em qualquer ordem — o agrupamento ordena. */
  batidas: BatidaDoAdmin[]
  /**
   * `dia -> ausências ativas` da pessoa, JÁ RECORTADO ao período — de
   * `ausenciasPorDia(ausencias, periodo)`. Opcional: sem ele, o arquivo sai só
   * com as linhas de batida.
   */
  ausencias?: ReadonlyMap<string, Ausencia[]>
}

/**
 * Começo de célula que a planilha leria como fórmula: `=`, `+`, `-` e `@`, e
 * também tab e CR, que algumas planilhas pulam antes de olhar o resto. Com
 * espaço antes do sinal também conta: há planilha que apara o espaço ao abrir.
 */
const COMECO_DE_FORMULA = /^[=+\-@\t\r]|^\s+[=+\-@]/

/**
 * Número ou duração no formato que ESTE arquivo escreve (`1234,50`, `9:00`),
 * com sinal. Hoje nenhuma coluna sai negativa (as horas e a distância nunca
 * ficam abaixo de zero), mas um saldo negativo (`-0:30`, `-12,50`) é número,
 * não fórmula, e não pode ganhar o apóstrofo: ele viraria texto e a soma da
 * coluna deixaria de contar a célula.
 */
const NUMERO_OU_DURACAO = /^-?\d+(?:,\d+)?$|^-?\d+:\d{2}$/

/**
 * Neutraliza a célula de TEXTO que a planilha leria como fórmula.
 *
 * O ATAQUE É CONCRETO: nome, e-mail e motivo do ajuste são digitados por
 * gente, e o arquivo é aberto no Excel da contabilidade. Uma célula
 * `=HIPERLINK("https://...";"clique")` vira um link para fora; uma
 * `=cmd|'/C ...'!A1` pede ao Excel para rodar um programa (com aviso, que muita
 * gente aceita); `@SOMA(...)` e `+`/`-` seguidos de conta também são fórmula.
 * O apóstrofo na frente faz a planilha ler a célula como texto, e o texto
 * continua lá, inteiro, para quem confere (é a defesa recomendada pela OWASP).
 *
 * O que já é número ou duração do próprio arquivo passa direto (ver acima).
 */
export function neutralizarFormula(valor: string): string {
  if (!COMECO_DE_FORMULA.test(valor) || NUMERO_OU_DURACAO.test(valor)) return valor
  return `'${valor}`
}

/**
 * Prepara o campo para o arquivo: neutraliza fórmula (ver `neutralizarFormula`)
 * e envolve em aspas quando ele contém algo que quebraria a tabela.
 *
 * O caso real não é teórico: "Motivo do ajuste" é texto livre digitado pelo
 * admin, e um motivo como `esqueceu a saída; avisou por WhatsApp` sem aspas
 * viraria duas colunas e empurraria o resto da linha para o lado. Aspas
 * internas dobram, como manda a RFC 4180.
 *
 * TODA célula passa por aqui, inclusive as que o próprio arquivo monta: assim
 * uma coluna nova de texto já nasce protegida, sem ninguém lembrar.
 */
export function escaparCampo(valor: string): string {
  if (valor === '') return ''
  const texto = neutralizarFormula(valor)
  const precisaDeAspas = /[";\r\n]/.test(texto) || texto !== texto.trim()
  return precisaDeAspas ? `"${texto.replace(/"/g, '""')}"` : texto
}

/** `1234.5` -> `1234,50`. Sem separador de milhar: ele viraria outra coluna. */
function numeroBrasileiro(valor: number | null, casas: number): string {
  if (valor === null || !Number.isFinite(valor)) return ''
  return valor.toFixed(casas).replace('.', ',')
}

/**
 * `540` -> `9:00`.
 *
 * O `9h00` da tela não serve aqui: o Excel o lê como texto e não soma. `9:00`
 * ele reconhece como hora, e uma coluna dessas somada com formato `[h]:mm` dá o
 * total do período. Como quem não sabe desse formato acaba com "09:00" no lugar
 * de "153:00", o arquivo traz TAMBÉM a mesma duração em decimal — essa soma
 * como número comum, sem truque nenhum.
 */
export function horasParaPlanilha(minutos: number): string {
  const total = Math.max(0, Math.round(minutos))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function horasEmDecimal(minutos: number): string {
  return numeroBrasileiro(Math.max(0, minutos) / 60, 2)
}

const SIM = 'SIM'
const NAO = 'NÃO'
/** A coluna "Tipo" da linha de ausência. */
export const TIPO_DA_LINHA_DE_AUSENCIA = 'Ausência'

/*
 * A BATIDA QUE SAIU SEM LOCALIZAÇÃO tem valor próprio
 * na coluna "Local", e não o "Sem localização" da inserida pelo admin: quem
 * filtra a coluna separa o GPS que não respondeu do ajuste que nunca teve
 * celular — na própria coluna: uma coluna a mais quebraria planilha montada em
 * cima do arquivo.
 */
const TEXTO_DO_LOCAL: Record<ReturnType<typeof descreverLocalizacao>['nome'], string> = {
  ausente: 'Sem localização',
  sem_gps: SEM_LOCALIZACAO_POR_EXTENSO,
  imprecisa: 'Localização imprecisa',
  no_local: 'No local',
  fora: 'Fora do local',
}

/**
 * O período inteiro, uma linha por batida.
 *
 * PERÍODO SEM BATIDA SAI COM CABEÇALHO E MAIS NADA — e isso é resposta, não
 * erro: significa "ninguém bateu ponto neste recorte", que é exatamente o que o
 * admin precisa poder provar. Uma exceção ou um arquivo vazio deixariam a
 * dúvida entre "não teve" e "quebrou".
 *
 * A ordem das pessoas é a que o chamador entregar — a tela ordena por nome.
 * Dentro de cada pessoa, dia crescente e hora crescente, pelo agrupamento.
 */
/**
 * A coluna "Origem" de uma batida.
 *
 * A BATIDA EM ATRASO APROVADA TEM ORIGEM PRÓPRIA, e ela fica NESTA
 * coluna, e não numa coluna a mais: o arquivo tem sempre as mesmas 18 colunas,
 * na mesma ordem — planilha de contabilidade montada em cima dele não quebra —,
 * e quem filtra "Origem" vê as três histórias separadas: o app, o ajuste do
 * admin, e o pedido que alguém conferiu e aprovou. "Ajuste manual" continua
 * SIM nela, que é o que o banco grava (a aprovação nasce pelo caminho do admin).
 *
 * Pedido PENDENTE não vira linha nenhuma: ele não é batida, não está em
 * `ponto_registros` e não chega a este módulo — o total não muda até a aprovação.
 */
export function origemDaBatida(
  batida: BatidaDoAdmin,
  aprovadores?: ReadonlyMap<string, string | null>,
): string {
  const marca = marcaDaBatida(batida, aprovadores)
  if (marca?.nome === 'atraso') return marca.texto.charAt(0).toUpperCase() + marca.texto.slice(1)
  return ROTULO_DA_ORIGEM[batida.origem]
}

/**
 * @param aprovadores `pedido_id -> nome de quem aprovou` (de
 *   `aprovadoresDosPedidos`). Opcional: sem ele, a batida de atraso sai como
 *   "Em atraso, aprovada", sem o nome.
 */
export function gerarCsvDoPeriodo(
  pessoas: PessoaParaExportar[],
  aprovadores?: ReadonlyMap<string, string | null>,
): string {
  const linhas: string[] = [CABECALHO.join(SEPARADOR)]

  for (const pessoa of pessoas) {
    const dias = juntarDiasEAusencias(agruparPorDia(pessoa.batidas), pessoa.ausencias ?? new Map())
    for (const { dia: diaCivil, batidas: dia, ausencias } of dias) {
      /*
       * A AUSÊNCIA VIRA UMA LINHA PRÓPRIA DO DIA, antes das batidas
       * dele, nas MESMAS 18 colunas: "Tipo" diz "Ausência", "Origem" diz qual
       * ("Falta justificada — atestado médico (atestado anexado)"), e as colunas
       * de batida ficam vazias — não houve horário, local nem foto.
       *
       * A SOMA NÃO MUDA: no dia só de ausência, ela fecha o dia com 0 batidas e
       * "0:00" (para o filtro de "Horas do dia" continuar dando uma linha por
       * dia); no dia com batidas, quem fecha é a última batida, como sempre, e a
       * linha da ausência deixa as quatro colunas do fechamento vazias.
       */
      for (const ausencia of ausencias) {
        const fecha = dia === null
        const campos = [
          pessoa.nome,
          pessoa.email ?? '',
          dataBrasileira(diaCivil),
          diaDaSemana(diaCivil),
          '',
          TIPO_DA_LINHA_DE_AUSENCIA,
          '',
          marcaDaAusenciaPorExtenso(ausencia),
          '',
          '',
          '',
          '',
          '',
          '',
          fecha ? '0' : '',
          fecha ? NAO : '',
          fecha ? horasParaPlanilha(0) : '',
          fecha ? horasEmDecimal(0) : '',
        ]
        linhas.push(campos.map(escaparCampo).join(SEPARADOR))
      }
      if (!dia) continue

      dia.batidas.forEach((batida, indice) => {
        // Só a ÚLTIMA batida do dia fecha a conta. Ver o comentário do cabeçalho.
        const fecha = indice === dia.batidas.length - 1
        const local = descreverLocalizacao(batida)

        const campos = [
          pessoa.nome,
          pessoa.email ?? '',
          dataBrasileira(dia.dia),
          diaDaSemana(dia.dia),
          formatarHora(batida.registrado_em),
          ROTULO_DO_TIPO[batida.tipo],
          String(batida.ordem_no_dia),
          origemDaBatida(batida, aprovadores),
          batida.ajuste_manual ? SIM : NAO,
          batida.motivo_ajuste ?? '',
          TEXTO_DO_LOCAL[local.nome],
          /*
           * A distância crua fica mesmo quando a leitura é imprecisa: a coluna
           * ao lado diz a precisão e a coluna "Local" já avisa que o número não
           * sustenta uma conclusão. Apagar o dado seria perder medição; o que
           * não se pode é apresentá-lo como certeza, e a coluna "Local" é quem
           * evita isso.
           */
          numeroBrasileiro(batida.distancia_metros, 2),
          numeroBrasileiro(batida.precisao_metros, 0),
          batida.selfie_path ? SIM : NAO,
          fecha ? String(dia.batidas.length) : '',
          fecha ? (dia.incompleto ? SIM : NAO) : '',
          // Dia incompleto vale zero — e o zero é escrito, não deixado em
          // branco: em branco pareceria "não calculado", e a regra é que ele
          // conte zero no total (ver "Dia com batida faltando não soma", em
          // `docs/DEFESA.md`), o que é uma afirmação.
          fecha ? horasParaPlanilha(dia.minutos) : '',
          fecha ? horasEmDecimal(dia.minutos) : '',
        ]

        linhas.push(campos.map(escaparCampo).join(SEPARADOR))
      })
    }
  }

  return BOM + linhas.join(FIM_DE_LINHA) + FIM_DE_LINHA
}

/** "Ana Beatriz Rocha Conceição" -> "ana-beatriz-rocha-conceicao". */
export function apelidar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * `ponto-2026-08.csv`, ou `ponto-ana-beatriz-rocha-2026-08.csv` quando a
 * exportação é de uma pessoa só. Sem acento e sem espaço: o arquivo passa por
 * WhatsApp, e-mail e pen drive antes de chegar na contabilidade. O começo é
 * "ponto", e não o nome configurado do app: o arquivo é o ponto do período,
 * qualquer que seja a marca.
 */
export function nomeDoArquivoCsv(periodo: Periodo, pessoa?: string | null): string {
  const nome = pessoa ? apelidar(pessoa) : ''
  return ['ponto', nome, apelidoDoPeriodo(periodo)].filter(Boolean).join('-') + '.csv'
}
