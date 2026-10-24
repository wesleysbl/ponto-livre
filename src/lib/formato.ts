/*
 * O QUE É UMA BATIDA E COMO ELA SE ESCREVE — sem rede, sem React, sem relógio
 * do aparelho mandando em nada.
 *
 * POR QUE ESTE ARQUIVO É SEPARADO DE `batidas.ts`
 * `batidas.ts` importa `supabase.ts`, que exige variáveis de ambiente E toca
 * `localStorage` no momento do import — em Node, isso é `ReferenceError` antes
 * da primeira linha de teste. Se os rótulos e a formatação de hora morassem lá
 * dentro, NADA que dependesse deles poderia ser testado, e a geração do CSV
 * depende dos dois. Por isso a parte pura mora aqui e `batidas.ts` a reexporta:
 * o CSV é código provável.
 *
 * A REGRA QUE ATRAVESSA O ARQUIVO INTEIRO
 * O fuso do ponto (`FUSO`) é o único fuso. O banco carimba `registrado_em` no relógio
 * dele e deriva `dia_civil` em `America/Sao_Paulo`; aqui, toda leitura e toda
 * escrita de hora passa pelo MESMO fuso, explicitamente. Nada usa
 * `new Date().getHours()` — isso seria o fuso de quem está olhando, e o admin
 * pode estar em qualquer lugar.
 */

export const FUSO = 'America/Sao_Paulo'

export type TipoDeBatida = 'entrada' | 'saida_almoco' | 'volta_almoco' | 'saida' | 'extra'

export interface Batida {
  id: string
  /** ISO 8601 do relógio do SERVIDOR. O relógio do celular não entra nisto. */
  registrado_em: string
  /** Dia civil em America/Sao_Paulo (`YYYY-MM-DD`), não o dia do UTC. */
  dia_civil: string
  tipo: TipoDeBatida
  ordem_no_dia: number
  latitude: number | null
  longitude: number | null
  precisao_metros: number | null
  /** Distância até o local de trabalho no momento da batida, congelada. Nula sem coordenada. */
  distancia_metros: number | null
  no_local: boolean | null
  selfie_path: string | null
  /** Ligado quando o admin cria ou corrige a batida. */
  ajuste_manual: boolean
  /**
   * O pedido de batida em atraso de que esta batida nasceu. Nula para toda
   * batida do app e do admin; só a aprovação do pedido a preenche, e ela não
   * muda depois.
   *
   * OPCIONAL NO TIPO, e não só anulável: as leituras que não pedem a coluna (e
   * os testes que montam batidas sem ela) não a trazem, e "não veio" tem de
   * valer o mesmo que "não é de atraso". Quem marca a batida pergunta
   * `pedido_atraso_id ?? null`.
   */
  pedido_atraso_id?: string | null
  /**
   * Como a batida nasceu (`'app'` ou `'ajuste_admin'`). Obrigatória na leitura
   * do admin (`BatidaDoAdmin`); aqui, opcional: a leitura do colaborador a pede
   * (é ela que separa a batida sem localização), e a resposta de
   * `ponto_registrar_batida` não a traz — quem a completa é `registrarBatida`.
   * Sem ela, `saiuSemLocalizacao` não afirma nada.
   */
  origem?: OrigemDaBatida
}

/** Como a batida nasceu: pelo app do funcionário ou pela mão do admin. */
export type OrigemDaBatida = 'app' | 'ajuste_admin'

/**
 * A linha como o ADMIN a lê. Um funcionário enxerga só as próprias batidas e
 * não precisa saber de quem elas são; o painel lista trinta pessoas e precisa.
 *
 * `funcionario_nome` e `funcionario_email` são a FOTOGRAFIA que o gatilho do
 * banco tira no momento da batida — e não um join feito agora.
 * É de propósito: `usuario_id` não tem chave estrangeira para `auth.users`
 * justamente porque a batida precisa sobreviver à exclusão do funcionário, e
 * uma prova trabalhista que perde o nome de quem bateu não prova nada.
 */
export interface BatidaDoAdmin extends Batida {
  usuario_id: string
  funcionario_nome: string | null
  funcionario_email: string | null
  origem: OrigemDaBatida
  motivo_ajuste: string | null
}

export const ROTULO_DO_TIPO: Record<TipoDeBatida, string> = {
  entrada: 'Entrada',
  saida_almoco: 'Saída para o almoço',
  volta_almoco: 'Volta do almoço',
  saida: 'Saída',
  extra: 'Batida extra',
}

/** Rótulo curto, para caber na lista do dia. */
export const ROTULO_CURTO: Record<TipoDeBatida, string> = {
  entrada: 'Entrada',
  saida_almoco: 'Almoço',
  volta_almoco: 'Volta',
  saida: 'Saída',
  extra: 'Extra',
}

export const ROTULO_DA_ORIGEM: Record<OrigemDaBatida, string> = {
  app: 'App',
  ajuste_admin: 'Ajuste do admin',
}

/*
 * A MESMA escada do gatilho `ponto_carimbar_registro`: 0 batidas hoje = entrada,
 * 1 = saída para o almoço, 2 = volta, 3 = saída, da 4ª em diante extra — a 5ª
 * batida do dia entra como extra sem quebrar a sequência das quatro primeiras.
 * Repetida aqui SÓ para o rótulo do botão. Se as duas divergirem, quem manda é
 * o banco, e o comprovante mostra o tipo que ele devolveu.
 */
const SEQUENCIA_DO_DIA: TipoDeBatida[] = ['entrada', 'saida_almoco', 'volta_almoco', 'saida']

export function proximoTipo(batidasDeHoje: number): TipoDeBatida {
  return SEQUENCIA_DO_DIA[batidasDeHoje] ?? 'extra'
}

/* ------------------------------------------------------------------ */
/* Relógio do ponto                                                    */
/* ------------------------------------------------------------------ */

const FORMATO_DO_DIA = /^\d{4}-\d{2}-\d{2}$/
const FORMATO_DA_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Hoje em `America/Sao_Paulo`, no formato `YYYY-MM-DD` — o mesmo `dia_civil`
 * que o banco grava. Sem isto, um funcionário batendo às 21h veria a lista do
 * dia seguinte, porque o relógio do navegador em UTC já virou.
 */
export function diaCivilDeHoje(): string {
  return diaCivilDoInstante(new Date())
}

/**
 * O dia civil em `America/Sao_Paulo` de um instante qualquer — a mesma conta
 * que o banco faz com `(instante AT TIME ZONE 'America/Sao_Paulo')::date`.
 *
 * A regra "só hoje" da batida em atraso compara o dia do horário declarado com
 * o dia de AGORA, e os dois têm de ser lidos no fuso do ponto — 00h10 de
 * Brasília ainda é 03h10 do mesmo dia em UTC, e 21h30 de Brasília já é o dia
 * seguinte em UTC.
 */
export function diaCivilDoInstante(instante: Date | string | number): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instante))

  const pegar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? ''

  return `${pegar('year')}-${pegar('month')}-${pegar('day')}`
}

/**
 * "08:32" no fuso do ponto, venha o carimbo de onde vier.
 *
 * `hourCycle: 'h23'` é explícito porque a meia-noite é o caso que quebra: com
 * o ciclo h24 de algumas plataformas ela sai como "24:00", e esse texto volta
 * para o formulário de correção do admin — que o recusaria como hora inválida,
 * ou pior, o aceitaria como um dia a mais.
 */
export function formatarHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(new Date(iso))
}

/** "01/09/2026 14:03" no fuso do ponto — para carimbos de auditoria. */
export function formatarMomento(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(new Date(iso))
}

/** Relógio de parede do fuso do ponto, decomposto — a base de `momentoNoFusoDoLocal`. */
const RELOGIO_DO_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
})

/** Quanto o relógio de parede do fuso do ponto está adiantado em relação ao UTC, em ms. */
function deslocamentoDoFusoMs(instante: number): number {
  const partes = RELOGIO_DO_LOCAL.formatToParts(new Date(instante))
  const numero = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((parte) => parte.type === tipo)?.value ?? '0')

  const parede = Date.UTC(
    numero('year'),
    numero('month') - 1,
    numero('day'),
    numero('hour') % 24,
    numero('minute'),
    numero('second'),
  )
  return parede - instante
}

/**
 * `('2026-08-15', '08:00')` -> o instante ISO em que o relógio do fuso do
 * ponto marcava 08:00 naquele dia.
 *
 * POR QUE NÃO BASTA `new Date('2026-08-15T08:00')`
 * Essa forma lê a hora no fuso de QUEM ESTÁ OLHANDO. O admin corrigindo o ponto
 * de um funcionário a partir de um notebook com o fuso errado — ou de fora do
 * país — gravaria uma batida horas deslocada, e o `dia_civil` que o banco
 * recalcula poderia até cair no dia anterior. Aqui a hora digitada é sempre
 * lida no fuso do ponto (`FUSO`), aconteça o que acontecer com o relógio da
 * máquina.
 *
 * E POR QUE NÃO CRAVAR "-03:00"
 * Porque isso é uma aposta em o Brasil nunca mais voltar ao horário de verão.
 * As duas passadas abaixo perguntam ao próprio fuso qual era o deslocamento
 * naquele instante: a primeira acerta o fuso, a segunda acerta a hora em que o
 * deslocamento muda no meio do caminho.
 */
export function momentoNoFusoDoLocal(dia: string, hora: string): string {
  if (!FORMATO_DO_DIA.test(dia)) throw new Error(`Data inválida: "${dia}". O formato é AAAA-MM-DD.`)
  if (!FORMATO_DA_HORA.test(hora)) throw new Error(`Hora inválida: "${hora}". O formato é HH:MM.`)

  /*
   * A volta pelo `toISOString` não é paranoia: `Date.parse` aceita
   * "2026-02-30" e devolve 2 de março, calado. Sem esta conferência, o admin
   * corrigindo uma batida para 30 de fevereiro gravaria março e a batida
   * sumiria do mês que ele estava fechando.
   */
  const desejado = Date.parse(`${dia}T${hora}:00.000Z`)
  if (Number.isNaN(desejado) || new Date(desejado).toISOString().slice(0, 10) !== dia) {
    throw new Error(`Data inválida: "${dia}" não existe no calendário.`)
  }

  let instante = desejado - deslocamentoDoFusoMs(desejado)
  instante = desejado - deslocamentoDoFusoMs(instante)
  return new Date(instante).toISOString()
}

/* ------------------------------------------------------------------ */
/* Localização                                                         */
/* ------------------------------------------------------------------ */

/** "42 m", "1,11 km". Nulo vira frase, não "null m". */
export function formatarDistancia(metros: number | null): string {
  if (metros === null || !Number.isFinite(metros)) return 'sem localização'
  if (metros < 1000) return `${Math.round(metros)} m`
  return `${(metros / 1000).toFixed(2).replace('.', ',')} km`
}

/**
 * ACIMA DISTO A DISTÂNCIA VIRA CHUTE.
 *
 * O aparelho informa junto com a coordenada um raio de incerteza. Um GPS com
 * céu aberto devolve 5–20 m; sem sinal, o navegador cai na triangulação de
 * wi-fi e antena e devolve 500, 2000, às vezes 10 000 m. O raio do local
 * costuma ser de 150 m (`ponto_local.raio_metros`): com uma incerteza de 100 m
 * ou mais, dizer "está a 40 m do local" ou "está fora" é cara ou coroa, e por
 * isso o painel diz "localização imprecisa" em vez de afirmar uma distância.
 *
 * 100 m, e não 150: o limite tem que ficar ABAIXO do raio, senão existe faixa
 * em que a incerteza é maior que a própria zona e a marca ainda seria exibida
 * como se valesse.
 */
export const PRECISAO_MAXIMA_CONFIAVEL_METROS = 100

/*
 * A BATIDA SEM LOCALIZAÇÃO.
 *
 * Quando o GPS não responde (indisponível ou demora), a batida pode sair sem
 * coordenada — com a selfie e o PIN de sempre. Não há coluna própria para isso:
 * "sem localização" é a batida do APP (ou a que nasceu de um pedido de batida em
 * atraso aprovado) com `latitude` nula. A inserida pelo admin também não tem
 * coordenada, mas por outro motivo: não houve celular nenhum — e ela continua
 * como sempre, "ajuste do admin", sem local.
 *
 * A REGRA SÓ AFIRMA COM A ORIGEM NA MÃO. `latitude` não lida (`undefined`) ou
 * origem desconhecida não viram "sem localização": a tela não inventa um GPS
 * que falhou numa linha que ela não leu inteira.
 */

/** A marca curta, nas listas e no painel. */
export const TEXTO_SEM_LOCALIZACAO = 'sem localização'
/** Por extenso: o comprovante, o recibo do pedido, a folha e o CSV. */
export const SEM_LOCALIZACAO_POR_EXTENSO = 'Sem localização (o GPS não respondeu)'

/** As colunas que dizem se a batida saiu sem localização. */
export type OrigemDaLocalizacao = Partial<
  Pick<Batida, 'latitude' | 'origem' | 'pedido_atraso_id' | 'distancia_metros'>
>

/**
 * A batida saiu sem localização porque o GPS não respondeu?
 *
 * Com distância calculada, não: a distância só existe a partir de uma
 * coordenada. No banco as duas andam juntas; a conferência a mais mantém esta
 * regra e `descreverLocalizacao` dizendo a mesma coisa sobre qualquer linha.
 */
export function saiuSemLocalizacao(batida: OrigemDaLocalizacao): boolean {
  if (batida.latitude !== null) return false
  if (batida.distancia_metros !== undefined && batida.distancia_metros !== null) return false
  return Boolean(batida.pedido_atraso_id) || batida.origem === 'app'
}

export type Localizacao =
  /** Batida sem coordenada por não ter havido celular — a inserida pelo admin. */
  | { nome: 'ausente'; texto: string }
  /** Batida do app (ou de pedido aprovado) que saiu sem localização: o GPS não respondeu. */
  | { nome: 'sem_gps'; texto: string }
  /** Tem coordenada, mas o aparelho admitiu um raio de erro grande demais. */
  | { nome: 'imprecisa'; texto: string }
  | { nome: 'no_local'; texto: string }
  | { nome: 'fora'; texto: string }

/**
 * O que a tela pode HONESTAMENTE afirmar sobre onde a pessoa estava.
 *
 * A ordem dos degraus é a ordem da dúvida: sem coordenada não há o que dizer;
 * com coordenada ruim, diz-se que ela é ruim; só com coordenada confiável é que
 * a marca dentro/fora — calculada pelo servidor e congelada na linha — vale ser
 * mostrada como fato.
 *
 * Recebe só as três colunas que decidem: a tela do local conta as batidas
 * "fora" dos últimos 30 dias com esta MESMA régua, lendo só essas três colunas
 * em vez da batida inteira. Com a latitude e a origem, o degrau "sem
 * localização" se separa do "ausente": quem lê só as três colunas
 * continua vendo as duas como "ausente", e nenhuma entra na conta de "fora".
 */
export function descreverLocalizacao(
  batida: Pick<Batida, 'distancia_metros' | 'no_local' | 'precisao_metros'> & OrigemDaLocalizacao,
): Localizacao {
  if (batida.distancia_metros === null || batida.no_local === null) {
    // Sem distância, a origem separa o GPS que não respondeu do ajuste do
    // admin. Com distância, a batida teve coordenada — nunca é "sem localização".
    return saiuSemLocalizacao(batida)
      ? { nome: 'sem_gps', texto: TEXTO_SEM_LOCALIZACAO }
      : { nome: 'ausente', texto: 'sem localização' }
  }

  if (
    batida.precisao_metros !== null &&
    batida.precisao_metros > PRECISAO_MAXIMA_CONFIAVEL_METROS
  ) {
    return {
      nome: 'imprecisa',
      texto: `localização imprecisa (±${formatarDistancia(batida.precisao_metros)})`,
    }
  }

  return batida.no_local
    ? { nome: 'no_local', texto: 'no local' }
    : { nome: 'fora', texto: `${formatarDistancia(batida.distancia_metros)} do local` }
}
