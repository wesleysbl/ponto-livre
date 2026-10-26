import { supabase } from './supabase'
import { primeiroDiaDoMes, ultimoDiaDoMes } from './horas'
import { diaCivilDeHoje } from './formato'
import type { Batida } from './formato'
import { argumentosDaLocalizacao, type LocalDaBatida } from './localizacao'
import {
  BATIDA_INCERTA,
  destinoDaSelfie,
  MOTIVOS_DE_RECUSA_DEFINITIVA_DO_PEDIDO,
  PEDIDO_INCERTO,
  type DesfechoDaGravacao,
} from './descarte'

/*
 * A PARTE PURA DESTE MÓDULO MORA EM `formato.ts` — e continua entrando por
 * aqui. Tipos, rótulos e formatação de hora/distância ficam lá, num módulo que
 * não importa `supabase.ts` e por isso pode ser carregado num teste de Node. A
 * reexportação abaixo é o que deixa as telas importarem tudo de
 * `'../lib/batidas'`.
 */
export type {
  Batida,
  BatidaDoAdmin,
  Localizacao,
  OrigemDaBatida,
  TipoDeBatida,
} from './formato'
export {
  descreverLocalizacao,
  diaCivilDeHoje,
  formatarDistancia,
  formatarHora,
  formatarMomento,
  momentoNoFusoDoLocal,
  PRECISAO_MAXIMA_CONFIAVEL_METROS,
  proximoTipo,
  ROTULO_CURTO,
  ROTULO_DA_ORIGEM,
  ROTULO_DO_TIPO,
} from './formato'

/*
 * Camada única de conversa com as batidas. Mesmo papel que `pin.ts` faz para o
 * PIN: o resto do app fala com este módulo e nunca monta a chamada na mão.
 *
 * A PORTA DE GRAVAÇÃO É UMA SÓ, E NÃO É O PostgREST
 * A policy de INSERT de `ponto_registros` aceita **só quem administra o
 * ponto** — `WITH CHECK (auth.uid() IS NOT NULL AND
 * public.ponto_pode_administrar())`, que é a lista `ponto_admins`.
 * Funcionário comum grava exclusivamente pela função
 * `ponto_registrar_batida(...)`, SECURITY DEFINER, que confere o PIN pelo mesmo
 * caminho de `ponto_verificar_pin` (com a contagem de tentativas e a trava, que
 * endurece a cada bloqueio do dia), recusa conta com `precisa_redefinir` e
 * exige que a selfie já esteja no bucket. Um
 * `supabase.from('ponto_registros').insert(...)` daqui seria recusado pelo
 * banco — e é essa recusa que faz o PIN valer de verdade, e não só na tela. É
 * também por isso que a origem 'app' só nasce pela RPC.
 *
 * QUEM CALCULA O QUÊ
 * O app manda coordenada, precisão, foto e PIN — ou, quando o GPS não
 * respondeu, foto, PIN e o motivo de a coordenada faltar (`p_sem_localizacao`).
 * O SERVIDOR devolve horário, dia civil, tipo, ordem no dia, distância até o
 * local de trabalho e a marca dentro/fora — tudo carimbado pelos gatilhos do
 * banco. Nada disso é calculado aqui, nem
 * mesmo o tipo: `proximoTipo` abaixo é uma PREVISÃO para o rótulo do botão, e
 * quem decide é o banco.
 *
 * OFFLINE ESTÁ FORA DO ESCOPO, DE PROPÓSITO
 * Não existe fila local. Sem internet a batida não acontece e o app diz isso —
 * fingir que gravou seria o pior desfecho num sistema de prova trabalhista.
 */

const BUCKET = 'ponto-selfies'

// ---------------------------------------------------------------------------

/**
 * Retorno de `ponto_registrar_batida`. União discriminada porque o banco
 * devolve chaves diferentes por caso — o mesmo desenho de `VerificacaoDoPin`,
 * e de propósito: é um contrato de PIN só, não dois.
 */
export type RespostaDaBatida =
  | { gravado: true; registro: Batida }
  | { gravado: false; motivo: 'pin_nao_definido' }
  /** O admin resetou o PIN: a pessoa tem que definir um novo antes de bater. */
  | { gravado: false; motivo: 'precisa_redefinir' }
  /**
   * Já existe batida desta conta dentro da janela de duplicidade — regra do
   * gatilho `ponto_carimbar_registro`. A janela é configurável
   * (`ponto_configuracao.janela_duplicidade_segundos`, 60 s de padrão) e o
   * banco NÃO manda o valor junto deste motivo: a tela diz "de pouco tempo
   * atrás" em vez de repetir um número que pode ter mudado.
   */
  | { gravado: false; motivo: 'batida_duplicada' }
  | { gravado: false; motivo: 'pin_incorreto'; tentativas_restantes: number; bloqueado_ate: null }
  /**
   * NO BLOQUEIO, A TELA MOSTRA O TEMPO, E NÃO O NÚMERO. Na quinta tentativa
   * errada o banco zera o contador (para a trava vencer com as cinco chances
   * inteiras) e responde `tentativas_restantes: 0` junto do bloqueio. Com
   * `motivo: 'bloqueado'`, esse número NUNCA vai para a tela; mostra-se o
   * tempo que falta.
   */
  | { gravado: false; motivo: 'bloqueado'; tentativas_restantes?: number; bloqueado_ate: string }

function traduzirErro(mensagem: string): string {
  if (/sem internet/i.test(mensagem)) {
    return 'Sem internet. A batida não acontece offline — conecte-se e tente de novo.'
  }
  // "Conta sem acesso para bater ponto": a conta não tem ficha que libera (nem
  // é super admin). A frase é a mesma na batida, no pedido de batida em
  // atraso e no PIN: quem libera é o super admin, e a pessoa pede a quem cuida
  // do ponto na empresa, como na tela "sem acesso".
  if (/Conta sem acesso/.test(mensagem)) {
    return 'Seu acesso ao ponto ainda não foi liberado. Peça a liberação a quem cuida do ponto na sua empresa.'
  }
  if (/exige sessao de usuario/.test(mensagem)) {
    return 'Sua sessão expirou. Entre de novo.'
  }
  if (/Selfie nao encontrada|Caminho de selfie/.test(mensagem)) {
    return 'A foto não chegou inteira ao servidor. Tente bater de novo.'
  }
  /*
   * A foto ficou velha entre subir e gravar — 15 minutos de folga
   * para uma janela que costuma durar segundos. Na prática isso é o aparelho
   * que dormiu ou a rede que sumiu no meio. Tirar outra foto é o caminho.
   *
   * É a ÚNICA recusa de selfie por tempo que existe: o mês da pasta não é
   * conferido contra o calendário. A pasta é nomeada pelo relógio DO APARELHO,
   * e recusar por causa dele contrariaria a regra de que relógio torto não muda
   * nada — o horário gravado é o do servidor. Quem impede foto pré-estocada é a
   * idade do arquivo, aqui.
   */
  if (/Selfie fora do prazo/.test(mensagem)) {
    return 'A foto demorou demais para chegar e não vale mais como comprovante. Bata o ponto de novo, com uma foto nova.'
  }
  /*
   * A recusa de coordenada. Ela cobre também a chamada sem latitude e
   * longitude e sem um motivo aceito em `p_sem_localizacao` (a frase do banco é
   * "... exige latitude e longitude"). O app nunca manda essa combinação; ela só
   * chega de uma versão velha do app, em cache, com uma coordenada que não
   * veio.
   */
  if (/exige latitude|Coordenada fora/.test(mensagem)) {
    return 'A localização veio incompleta do aparelho. Tente de novo.'
  }
  /*
   * O teto do envio de selfies (20 na hora, 60 em 24 horas, por conta), que a
   * regra do bucket confere. Um dia normal não chega perto; quem chega é quem
   * sobe arquivo pela API, ou um aparelho preso num laço de tentativas.
   */
  if (/Selfies demais nesta conta/.test(mensagem)) {
    return 'Esta conta enviou fotos demais em pouco tempo. Espere um pouco e tente de novo; se continuar, fale com quem administra o ponto.'
  }
  if (/row-level security|violates/i.test(mensagem)) {
    return 'O servidor recusou esta batida. Confirme com quem administra o ponto se o seu acesso está liberado.'
  }
  if (/exceeded the maximum|payload too large|entity too large/i.test(mensagem)) {
    return 'A foto ficou grande demais para enviar. Tente bater de novo.'
  }
  if (/already exists|resource already/i.test(mensagem)) {
    return 'Essa foto já tinha sido enviada. Tente bater de novo.'
  }
  /*
   * Assinatura de selfie recusada. O storage responde a MESMA coisa para "esse
   * arquivo não existe" e para "existe, mas não é seu": a policy de SELECT do
   * bucket esconde a linha, então de fora os dois casos são indistinguíveis —
   * e é bom que sejam, porque a resposta não confirma para ninguém que a foto
   * de outra pessoa existe. Daí uma frase só para os dois.
   */
  if (/object not found|not_found/i.test(mensagem)) {
    return 'Essa foto não está disponível para você.'
  }
  /*
   * "Load failed" é a frase do Safari (todo navegador no iPhone usa o motor
   * dele) para o `fetch` que não chegou ao servidor — o "Failed to fetch" do
   * Chrome. Sem ela, quem bate pelo iPhone leria "Batida não registrada: Load
   * failed".
   */
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(mensagem)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  }
  return mensagem
}

/** Erro já traduzido para a tela. */
export class ErroDeBatida extends Error {
  /**
   * A batida PODE ter sido gravada: a resposta da RPC se perdeu (rede, 5xx,
   * tempo). A selfie não foi descartada, e a tela manda conferir a lista de
   * hoje antes de bater de novo, em vez de dizer "nada foi gravado".
   */
  readonly incerto: boolean

  constructor(mensagem: string, opcoes: { incerto?: boolean } = {}) {
    super(traduzirErro(mensagem))
    this.name = 'ErroDeBatida'
    this.incerto = opcoes.incerto === true
  }
}

/*
 * `pedido_atraso_id` é a coluna da batida em atraso: é por ela que a batida
 * aprovada de um pedido ganha a marca própria no espelho.
 *
 * Colunas explícitas em UMA linha só. Duas razões: `select('*')` traria para o
 * navegador o nome e o e-mail fotografados e o autor da linha, que esta tela
 * não usa; e o supabase-js tipa o retorno a partir do LITERAL passado ao
 * `select` — quebrar a string em concatenação faz o tipo virar
 * `GenericStringError[]` e o build parar.
 *
 * `origem` é a coluna da batida sem localização: é ela
 * que separa a batida do app que saiu sem localização (`origem = 'app'`,
 * latitude nula) da inserida pelo admin, que também não tem coordenada — mesmo
 * depois de uma correção do admin ligar `ajuste_manual` na do app.
 */
const COLUNAS_DA_BATIDA =
  'id, registrado_em, dia_civil, tipo, ordem_no_dia, latitude, longitude, precisao_metros, distancia_metros, no_local, selfie_path, ajuste_manual, pedido_atraso_id, origem'

/** As batidas de hoje desta conta, da primeira para a última. */
export async function lerBatidasDoDia(usuarioId: string): Promise<Batida[]> {
  const { data, error } = await supabase
    .from('ponto_registros')
    .select(COLUNAS_DA_BATIDA)
    // A RLS já limita ao dono — mas um admin enxerga todo mundo, e a lista
    // desta tela é "as MINHAS batidas de hoje".
    .eq('usuario_id', usuarioId)
    .eq('dia_civil', diaCivilDeHoje())
    .order('registrado_em', { ascending: true })

  if (error) throw new ErroDeBatida(error.message)
  return (data ?? []) as Batida[]
}

/**
 * As batidas de um mês desta conta, da primeira para a última.
 *
 * O RECORTE É POR `dia_civil`, NÃO POR `registrado_em`
 * `dia_civil` é o dia em `America/Sao_Paulo` que o gatilho do banco carimbou.
 * Filtrar pelo carimbo em UTC jogaria a batida das 21h30 do dia 31 para dentro
 * do mês seguinte — e o funcionário procuraria por ela num mês onde ela não
 * está. Como `dia_civil` é `date`, o intervalo fechado do primeiro ao último
 * dia pega o mês inteiro e ainda usa o índice `idx_ponto_registros_usuario_dia`.
 *
 * @param mes no formato `AAAA-MM`.
 */
export async function lerBatidasDoMes(usuarioId: string, mes: string): Promise<Batida[]> {
  const { data, error } = await supabase
    .from('ponto_registros')
    .select(COLUNAS_DA_BATIDA)
    // A RLS já limita ao dono — mas um admin enxerga todo mundo, e este espelho
    // é "o MEU mês".
    .eq('usuario_id', usuarioId)
    .gte('dia_civil', primeiroDiaDoMes(mes))
    .lte('dia_civil', ultimoDiaDoMes(mes))
    .order('registrado_em', { ascending: true })

  if (error) throw new ErroDeBatida(error.message)
  return (data ?? []) as Batida[]
}

/**
 * Quanto tempo o link da selfie vive.
 *
 * DOIS MINUTOS, E CURTO É O PONTO
 * O link assinado é uma chave ao portador: quem tiver a URL vê a foto, com ou
 * sem sessão. Como o conteúdo é o rosto de um funcionário no trabalho, o que
 * vale é encurtar a janela em que uma URL copiada ainda serve para alguma
 * coisa. Dois minutos cobrem com folga o que a tela precisa — carregar um JPEG
 * de ~100 KB num 4G ruim e a pessoa olhar — e nada na interface depende de o
 * link sobreviver ao fechamento do visor, porque cada abertura assina de novo.
 * Se a foto ficar aberta além disso e o navegador reler a imagem, o visor
 * oferece "gerar de novo" em vez de mostrar um quadrado quebrado.
 */
export const SEGUNDOS_DE_VALIDADE_DA_SELFIE = 120

/**
 * Link temporário para a selfie de uma batida.
 *
 * QUEM DECIDE QUEM VÊ É O STORAGE, NÃO ESTA FUNÇÃO
 * O bucket `ponto-selfies` é privado e a policy de SELECT só enxerga o dono do
 * caminho (`{user_id}/...`) ou um admin. Pedir a assinatura da foto de outra
 * pessoa não devolve link nenhum — o servidor recusa antes de assinar. Não há
 * checagem de dono aqui de propósito: uma conferência no cliente daria a falsa
 * impressão de que ela é a que protege, e ela seria a primeira a ser
 * contornada por quem chamasse a API direto.
 */
export async function urlAssinadaDaSelfie(selfiePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(selfiePath, SEGUNDOS_DE_VALIDADE_DA_SELFIE)

  if (error) throw new ErroDeBatida(error.message)
  if (!data?.signedUrl) throw new ErroDeBatida('Essa foto não está disponível para você.')
  return data.signedUrl
}

/**
 * Links temporários para as miniaturas das selfies de um dia, num pedido só.
 *
 * UM PEDIDO POR DIA, E NÃO UM POR FOTO
 * O dia do painel tem até cinco batidas. Assinar uma a uma seria um round-trip
 * por foto, e um mês aberto no painel multiplicaria isso por vinte dias úteis.
 * `createSignedUrls` assina a lista inteira de uma vez, com a mesma validade
 * curta de `SEGUNDOS_DE_VALIDADE_DA_SELFIE` e a mesma policy de SELECT: a foto
 * que a pessoa não pode ver volta com erro, e ela fica de fora do mapa.
 *
 * A FOTO QUE FICOU DE FORA NÃO É ERRO DA TELA
 * Quem chama mostra o ícone da câmera no lugar da miniatura, e o clique segue
 * abrindo o visor, que assina de novo e explica a recusa se houver. Só a falha
 * do pedido inteiro (rede, sessão) vira `ErroDeBatida`.
 */
export async function urlsAssinadasDasSelfies(
  caminhos: readonly string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (caminhos.length === 0) return urls

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls([...caminhos], SEGUNDOS_DE_VALIDADE_DA_SELFIE)

  if (error) throw new ErroDeBatida(error.message)
  for (const item of data ?? []) {
    if (!item.error && item.path && item.signedUrl) urls.set(item.path, item.signedUrl)
  }
  return urls
}

/**
 * Caminho do objeto no bucket, na convenção que a policy do bucket exige e que
 * `ponto_registrar_batida` confere de novo no servidor:
 * `{user_id}/{aaaa}/{mm}/{id-do-registro}.jpg`.
 *
 * O uuid do arquivo é o MESMO id da linha — por isso ele é sorteado aqui, antes
 * de qualquer envio, e vai como `p_registro_id`. E por isso o caminho é único a
 * cada batida: o bucket não tem policy de UPDATE, então nada se sobrescreve
 * (nada de `upsert: true`, que falharia).
 */
function caminhoDaSelfie(usuarioId: string, registroId: string): string {
  const [ano, mes] = diaCivilDeHoje().split('-')
  return `${usuarioId}/${ano}/${mes}/${registroId}.jpg`
}

/**
 * Tenta jogar fora a foto que não virou batida.
 *
 * A policy "Ponto: dono descarta selfie sem batida" só permite isto quando
 * NENHUM registro aponta para o arquivo (depois de gravada, a evidência não
 * sai mais) E quando a foto tem mais de 16 minutos: até lá uma RPC pode estar
 * gravando uma batida com ela, e o banco não deixa ninguém apagá-la. Como a
 * foto acabou de subir, o pedido de agora não apaga nada: o storage responde
 * sem erro e com zero arquivos, e a foto fica no bucket, solta. Ela não vira
 * ponto de ninguém (só ocupa espaço) e pode ser apagada depois dos 16 minutos
 * pela dona ou por quem administra. O pedido continua aqui porque é inofensivo
 * e porque a foto que demorou a ser recusada já pode sair.
 *
 * Falhar aqui não pode derrubar o fluxo: o que a pessoa precisa ver é o motivo
 * da recusa da batida, não um erro de faxina. Fica no console.
 *
 * SÓ DEPOIS DE RECUSA DEFINITIVA (`destinoDaSelfie`, em `descarte.ts`):
 * descartar depois de uma resposta PERDIDA seria pedir para apagar a prova de
 * uma batida que pode ter sido gravada.
 */
async function descartarSelfie(caminho: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([caminho])
    if (error) console.error('Selfie órfã não descartada:', caminho, error)
  } catch (falha) {
    console.error('Selfie órfã não descartada:', caminho, falha)
  }
}

export interface DadosDaBatida {
  usuarioId: string
  pin: string
  foto: Blob
  /**
   * A coordenada do aparelho, ou — quando o GPS não respondeu — o motivo de a
   * batida sair sem ela. A selfie e o PIN valem nos
   * dois casos. Vira parâmetro de RPC em `argumentosDaLocalizacao`.
   */
  local: LocalDaBatida
}

/**
 * Sobe a selfie e grava a batida — nesta ordem, e com desfazer.
 *
 * POR QUE A FOTO VAI PRIMEIRO
 * `ponto_registrar_batida` recusa caminho que ainda não exista em
 * storage.objects: é assim que "não existe batida sem foto" deixa de depender
 * da boa vontade do cliente. A contrapartida é a janela entre o envio e a
 * gravação, e é ela que o descarte abaixo fecha — quando dá para saber.
 *
 * OS TRÊS DESFECHOS DA GRAVAÇÃO (`destinoDaSelfie`, em `descarte.ts`)
 *  • Selfie não sobe   -> a exceção sai antes da RPC: nenhum registro é criado.
 *  • Recusa definitiva -> o descarte é pedido em seguida: `{gravado: false}`
 *                         com motivo conhecido (PIN errado, bloqueio,
 *                         duplicidade, redefinição pendente) ou erro levantado
 *                         pelo próprio Postgres dentro da RPC (a transação
 *                         voltou inteira). A foto recém-enviada o banco não
 *                         deixa apagar (ver `descartarSelfie`): ela fica, solta.
 *  • Resposta perdida  -> rede, 5xx, tempo: a batida PODE ter sido gravada. A
 *                         foto FICA (descartá-la aqui poderia apagar a prova
 *                         de uma batida gravada), e o erro
 *                         sai com `incerto`, para a tela mandar conferir a lista
 *                         de hoje antes de bater de novo.
 *
 * O que sobra de honesto dizer: na recusa definitiva, na resposta perdida e
 * se o aparelho morrer ENTRE o envio e a resposta da RPC, o arquivo fica no
 * bucket sem batida. O arquivo órfão não vira ponto de ninguém — ele só ocupa
 * espaço, e conta no teto de envios da hora e do dia.
 */
export async function registrarBatida(dados: DadosDaBatida): Promise<RespostaDaBatida> {
  if (navigator.onLine === false) {
    throw new ErroDeBatida('Sem internet')
  }

  const registroId = crypto.randomUUID()
  const caminho = caminhoDaSelfie(dados.usuarioId, registroId)

  const { error: erroDoEnvio } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, dados.foto, { contentType: 'image/jpeg', upsert: false })

  if (erroDoEnvio) throw new ErroDeBatida(erroDoEnvio.message)

  let desfecho: DesfechoDaGravacao
  let mensagemDoErro = 'Não deu para gravar a batida.'
  try {
    const { data, error, status } = await supabase.rpc('ponto_registrar_batida', {
      p_pin: dados.pin,
      p_registro_id: registroId,
      p_selfie_path: caminho,
      ...argumentosDaLocalizacao(dados.local),
    })
    if (error) {
      desfecho = { tipo: 'erro', status: typeof status === 'number' ? status : null, codigo: error.code || null }
      mensagemDoErro = error.message
    } else {
      desfecho = { tipo: 'resposta', dados: data }
    }
  } catch (falha) {
    desfecho = { tipo: 'excecao' }
    if (falha instanceof Error) mensagemDoErro = falha.message
  }

  const destino = destinoDaSelfie(desfecho)
  if (destino === 'descartar') await descartarSelfie(caminho)
  if (destino === 'incerto') {
    // A foto fica: ela pode ser a prova de uma batida que gravou.
    console.warn('Batida sem resposta certa do servidor; selfie mantida:', caminho, mensagemDoErro)
    throw new ErroDeBatida(BATIDA_INCERTA.mensagem, { incerto: true })
  }
  if (desfecho.tipo !== 'resposta') throw new ErroDeBatida(mensagemDoErro)
  const resposta = desfecho.dados as RespostaDaBatida
  /*
   * A RPC não devolve a origem, e toda batida gravada por ela é do app: o
   * gatilho carimba `origem = 'app'` em toda linha que chega sem horário — e a
   * RPC nunca manda horário. Completá-la aqui é o que deixa o comprovante e a
   * lista de hoje dizerem "sem localização" (`saiuSemLocalizacao`) sem reler.
   */
  if (resposta.gravado) return { gravado: true, registro: { origem: 'app', ...resposta.registro } }
  return resposta
}

/* ------------------------------------------------------------------ */
/* O pedido de batida em atraso                                        */
/* ------------------------------------------------------------------ */

/**
 * O pedido como `ponto_pedir_batida_em_atraso` o devolve. É uma lista
 * explícita do banco: o nome e o e-mail fotografados de quem pediu não voltam.
 */
export interface PedidoGravado {
  id: string
  horario_declarado: string
  dia_civil: string
  motivo: string
  pedido_em: string
  estado: 'pendente'
  /** Nulas no pedido que saiu sem localização (o GPS não respondeu). */
  latitude: number | null
  longitude: number | null
  precisao_metros: number | null
  distancia_metros: number | null
  no_local: boolean | null
  selfie_path: string
}

/**
 * Retorno de `ponto_pedir_batida_em_atraso`. As recusas do PIN são as MESMAS
 * da batida (a RPC chama a mesma `ponto_verificar_pin`, que conta tentativa);
 * a única própria é `pedido_duplicado` — o reenvio do mesmo pedido depois de
 * um timeout, ou dois toques no mesmo minuto, que o índice único recusa.
 */
export type RespostaDoPedido =
  | { gravado: true; pedido: PedidoGravado }
  | { gravado: false; motivo: 'pin_nao_definido' }
  | { gravado: false; motivo: 'precisa_redefinir' }
  | { gravado: false; motivo: 'pedido_duplicado' }
  | { gravado: false; motivo: 'pin_incorreto'; tentativas_restantes: number; bloqueado_ate: null }
  | { gravado: false; motivo: 'bloqueado'; tentativas_restantes?: number; bloqueado_ate: string }

/**
 * As recusas próprias do pedido, pelas frases da RPC
 * `ponto_pedir_batida_em_atraso`. O que não é próprio do pedido — sessão,
 * acesso, selfie, coordenada, rede — é a mesma recusa da batida, e cai na
 * tradução dela.
 */
function traduzirErroDoPedido(mensagem: string): string {
  if (/Horario declarado no futuro/.test(mensagem)) {
    return 'Esse horário ainda não chegou. A batida em atraso é para um horário que já passou hoje.'
  }
  if (/Horario declarado fora do dia de hoje/.test(mensagem)) {
    return 'A batida em atraso só pode ser pedida no mesmo dia (horário de Brasília). Esqueceu em outro dia? Avise o RH, que corrige pelo painel.'
  }
  if (/exige o horario declarado/.test(mensagem)) {
    return 'Escolha o horário em que você deveria ter batido.'
  }
  if (/Motivo do pedido de batida em atraso precisa de pelo menos/.test(mensagem)) {
    return 'Escreva o motivo com pelo menos 10 letras — é ele que o RH lê para aprovar.'
  }
  if (/Motivo do pedido de batida em atraso pode ter no maximo/.test(mensagem)) {
    return 'O motivo pode ter no máximo 500 caracteres.'
  }
  if (/Ja existe uma batida sua neste mesmo minuto/.test(mensagem)) {
    return 'Você já tem uma batida neste mesmo minuto — o pedido seria repetido. Confira suas batidas de hoje.'
  }
  if (/Ja existe um pedido pendente seu para este mesmo horario/.test(mensagem)) {
    return 'Você já tem um pedido aguardando aprovação para este mesmo horário.'
  }
  // O teto de pedidos pendentes do dia (quatro por pessoa): a fila anda quando
  // quem administra decide um deles.
  if (/Pedidos pendentes demais hoje/.test(mensagem)) {
    return 'Você já tem pedidos demais esperando decisão hoje. Espere o RH decidir os que estão na fila antes de pedir outro.'
  }
  if (/Identificador do pedido ja usado|Pedido exige o identificador do pedido/.test(mensagem)) {
    return 'O pedido não chegou inteiro ao servidor. Tente de novo.'
  }
  return traduzirErro(mensagem)
}

/** Erro do pedido de batida em atraso, já traduzido para a tela. */
export class ErroDoPedido extends Error {
  /** O pedido PODE ter sido gravado: como `ErroDeBatida.incerto`. */
  readonly incerto: boolean

  constructor(mensagem: string, opcoes: { incerto?: boolean } = {}) {
    super(traduzirErroDoPedido(mensagem))
    this.name = 'ErroDoPedido'
    this.incerto = opcoes.incerto === true
  }
}

export interface DadosDoPedido extends DadosDaBatida {
  /** O instante declarado, ISO — já conferido por `momentoDaHoraDeHoje`. */
  horarioDeclaradoISO: string
  motivo: string
}

/**
 * Sobe a selfie e grava o pedido — o MESMO desenho de `registrarBatida`.
 *
 * O id do pedido dá nome à foto, como o id da batida: `{uid}/{aaaa}/{mm}/{id}.jpg`,
 * a convenção que a RPC confere. A foto vai antes, porque a RPC exige que ela
 * já esteja no bucket (com no máximo 15 minutos).
 *
 * O DESCARTE DA FOTO VALE AQUI COMO NA BATIDA, COM A MESMA REGRA
 * (`destinoDaSelfie`): só depois de recusa DEFINITIVA ele é pedido (e, com a
 * foto recém-enviada, o banco não apaga: ver `descartarSelfie`); na resposta
 * perdida o pedido pode ter gravado, a foto fica e o erro sai com `incerto`.
 * Depois que o pedido existe, ela passa a ser prova (`ponto_selfie_sem_batida`
 * olha os pedidos) e nenhuma policy deixa apagar — por isso o descarte só roda
 * nos caminhos de falha.
 *
 * `pedido_duplicado` é o caso que merece cuidado: pode ser o MESMO pedido
 * reenviado depois de um timeout. A foto deste envio é nova (id novo) e não é
 * de pedido nenhum, então o descarte é pedido para ela também; o pedido
 * anterior continua com a dele.
 */
export async function pedirBatidaEmAtraso(dados: DadosDoPedido): Promise<RespostaDoPedido> {
  if (navigator.onLine === false) {
    throw new ErroDoPedido('Sem internet')
  }

  const pedidoId = crypto.randomUUID()
  const caminho = caminhoDaSelfie(dados.usuarioId, pedidoId)

  const { error: erroDoEnvio } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, dados.foto, { contentType: 'image/jpeg', upsert: false })

  if (erroDoEnvio) throw new ErroDoPedido(erroDoEnvio.message)

  let desfecho: DesfechoDaGravacao
  let mensagemDoErro = 'Não deu para enviar o pedido.'
  try {
    const { data, error, status } = await supabase.rpc('ponto_pedir_batida_em_atraso', {
      p_pin: dados.pin,
      p_pedido_id: pedidoId,
      p_selfie_path: caminho,
      ...argumentosDaLocalizacao(dados.local),
      p_horario_declarado: dados.horarioDeclaradoISO,
      p_motivo: dados.motivo,
    })
    if (error) {
      desfecho = { tipo: 'erro', status: typeof status === 'number' ? status : null, codigo: error.code || null }
      mensagemDoErro = error.message
    } else {
      desfecho = { tipo: 'resposta', dados: data }
    }
  } catch (falha) {
    desfecho = { tipo: 'excecao' }
    if (falha instanceof Error) mensagemDoErro = falha.message
  }

  const destino = destinoDaSelfie(desfecho, MOTIVOS_DE_RECUSA_DEFINITIVA_DO_PEDIDO)
  if (destino === 'descartar') await descartarSelfie(caminho)
  if (destino === 'incerto') {
    // A foto fica: ela pode ser a prova de um pedido que gravou.
    console.warn('Pedido sem resposta certa do servidor; selfie mantida:', caminho, mensagemDoErro)
    throw new ErroDoPedido(PEDIDO_INCERTO.mensagem, { incerto: true })
  }
  if (desfecho.tipo !== 'resposta') throw new ErroDoPedido(mensagemDoErro)
  return desfecho.dados as RespostaDoPedido
}
