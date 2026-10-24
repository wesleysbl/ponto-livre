/*
 * PONTO-CONTAS — O ATENDIMENTO DE UM PEDIDO.
 *
 * Do cabeçalho `Authorization` à resposta em português, numa ordem que não
 * muda:
 *
 *   1. SEM TOKEN → 401. Nada é lido, nada é chamado.
 *   2. QUEM CHAMA? O login responde, pelo token do chamador.
 *   3. É SUPER ADMIN? O BANCO responde, COM A SESSÃO DO CHAMADOR
 *      (`ponto_sou_super_admin()`). Nunca com a chave de serviço: lá,
 *      `auth.uid()` é nulo, e há função no banco que trata usuário nulo como
 *      "backend confiável" (o gatilho da ficha, por exemplo). Não é super
 *      admin → 403, e a chave de serviço nem foi usada.
 *   4. O PEDIDO É VÁLIDO? → 400 com a lista de frases.
 *   5. A TRILHA EXISTE E ACEITA LINHA? (`ponto_contas_trilha_pronta()`, da
 *      migration da estrutura) Não → 503, e nada muda. A função DEPENDE da
 *      trilha: sem ela, ação nenhuma.
 *   5½. O ALVO NÃO É OUTRO SUPER ADMIN? (`conferirAlvo`) A conta de outro
 *      super admin não se mexe por aqui (409, nada muda). Ver o comentário de
 *      `conferirAlvo`.
 *   6. A AÇÃO, em passos (login, ficha). Passo que falha no meio faz os
 *      anteriores voltarem, do último para o primeiro.
 *   7. UMA LINHA NA TRILHA, com quem, o quê, antes, depois e o resultado de
 *      cada passo. Nunca a senha.
 *
 * O QUE NÃO MORA AQUI: o supabase-js (está em `portas.ts`, atrás das
 * interfaces abaixo) e o `Deno.serve` (está em `index.ts`). Por isso este
 * arquivo roda no Vitest, contra um Supabase SIMULADO, e o caminho inteiro de
 * cima é testado sem rede (`src/ponto-contas.test.ts`).
 */
import {
  CORPO_MAXIMO_BYTES,
  acharEmailRepetido,
  conferirSenhaProvisoria,
  descreverEstado,
  fraseDoEmailRepetido,
  lerPedido,
  lerToken,
  lugaresFeitos,
  montarLinhaDaTrilha,
  normalizarEmail,
  semSenha,
  traduzirErroDePorta,
  type AcaoDeConta,
  type CodigoDeFalha,
  type Falha,
  type NomeDoPasso,
  type OndeJaExiste,
  type PedidoDeConta,
  type RegistroDoPasso,
  type ResultadoDaAcao,
  type LinhaDaTrilha,
} from './regras.ts'

/* ------------------------------------------------------------------ */
/* As portas                                                           */
/* ------------------------------------------------------------------ */

/**
 * A conta de acesso (Auth). `nome` = `app_metadata.full_name`: no banco do
 * ponto, é onde mora o nome de quem não tem ficha (quem só administra, por
 * exemplo), e só a chave de serviço grava ali (o `user_metadata` a pessoa
 * edita sozinha, e não vale). E o e-mail mora só aqui.
 */
export interface Login {
  id: string
  email: string | null
  nome: string | null
}

/** Uma linha de `ponto_funcionarios`, só o que esta função usa. `usuarioId` nulo = ficha sem conta. */
export interface Ficha {
  id: string
  nome: string
  usuarioId: string | null
}

/**
 * O que se pergunta e se faz COM A SESSÃO DO CHAMADOR (o token dele, a chave
 * pública do projeto). Passa pela RLS como qualquer tela do app.
 */
export interface PortasDaSessao {
  /** O login confere o token e diz de quem é. Token vencido, revogado ou sem `sub`: joga. */
  quemChama(): Promise<{ id: string; email: string | null }>
  /** `ponto_sou_super_admin()`, com a sessão do chamador. */
  souSuperAdmin(): Promise<boolean>
  /** As fichas ligadas à conta (o índice `ponto_funcionarios_conta_unica` deixa no máximo uma). */
  lerFichas(usuarioId: string): Promise<Ficha[]>
  /** Uma ficha pelo id; nula se não existe (ou se a RLS não a mostra). */
  lerFicha(fichaId: string): Promise<Ficha | null>
  /** Troca `nome_completo` da ficha. Pela RLS de quem administra; zero linhas = joga. */
  renomearFicha(fichaId: string, nome: string): Promise<void>
  /**
   * Liga a ficha SEM CONTA à conta: só `usuario_id`, e só se ele ainda for
   * nulo (outra aba pode ter ligado antes). Pela sessão do super admin, que é
   * quem o gatilho da ficha deixa dar acesso por ela. Zero linhas = joga.
   */
  ligarFicha(fichaId: string, usuarioId: string): Promise<void>
}

/** O que só a chave de serviço faz: a Admin API do login, a lista de super admins e a trilha. */
export interface PortasDoServico {
  trilhaPronta(): Promise<boolean>
  lerLogin(usuarioId: string): Promise<Login | null>
  listarLogins(): Promise<Login[]>
  criarLogin(dados: { email: string; senha: string; nome: string }): Promise<Login>
  trocarEmailDoLogin(usuarioId: string, email: string): Promise<void>
  trocarNomeDoLogin(usuarioId: string, nome: string | null): Promise<void>
  trocarSenhaDoLogin(usuarioId: string, senha: string): Promise<void>
  /** SÓ PARA DESFAZER o `criar_conta` que falhou no meio. Não é ação da função. */
  removerLogin(usuarioId: string): Promise<void>
  /** A conta está em `ponto_super_admins`? (Leitura de serviço: a lista não é alterável por ninguém da API.) */
  contaEhSuperAdmin(usuarioId: string): Promise<boolean>
  /** Grava e devolve o `id` da linha. */
  gravarTrilha(linha: LinhaDaTrilha): Promise<string>
}

export interface Portas {
  sessao: PortasDaSessao
  servico: PortasDoServico
  /** O log da função (no Supabase: Edge Functions → Logs). Recebe só dado já sem senha. */
  anotar(evento: string, dados: Record<string, unknown>): void
}

/** Abre as portas para um token. Chamada só depois de existir token: sem token, nem cliente se cria. */
export type AbrirPortas = (token: string) => Portas

/* ------------------------------------------------------------------ */
/* Pedido e resposta                                                   */
/* ------------------------------------------------------------------ */

export interface PedidoHttp {
  metodo: string
  autorizacao: string | null
  corpo: string
}

export type RespostaDaFuncao =
  | {
      ok: true
      acao: AcaoDeConta
      usuario_id: string
      mensagem: string
      passos: RegistroDoPasso[]
      trilha_id: string
    }
  | {
      ok: false
      codigo: CodigoDeFalha
      mensagem: string
      onde?: OndeJaExiste
      erros?: string[]
      passos?: RegistroDoPasso[]
      /** Só em `trilha_nao_gravou`: a ação FOI feita. */
      acao_feita?: boolean
    }

export interface RespostaHttp {
  status: number
  corpo: RespostaDaFuncao | null
}

/**
 * CORS: o app chama do navegador, de outro domínio (o do site do app). `*` é
 * seguro aqui porque a credencial é o token no cabeçalho, e não cookie: um
 * site de terceiros não tem o token para mandar.
 */
export const CABECALHOS_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function responderFalha(falha: Falha, extra: Partial<Extract<RespostaDaFuncao, { ok: false }>> = {}): RespostaHttp {
  return {
    status: falha.status,
    corpo: { ok: false, codigo: falha.codigo, mensagem: falha.mensagem, ...(falha.onde ? { onde: falha.onde } : {}), ...extra },
  }
}

const falha = (status: number, codigo: CodigoDeFalha, mensagem: string): Falha => ({ status, codigo, mensagem })

/** 413: a MESMA resposta antes de ler (`index.ts`, pelo `Content-Length`) e depois (`atender`). */
export function respostaDoCorpoGrande(): RespostaHttp {
  return responderFalha(falha(413, 'pedido_grande_demais', 'O pedido é grande demais para uma ação de conta. Nada foi alterado.'))
}

/** Falha de leitura ANTES de qualquer passo: a frase ganha o "nada foi alterado". */
function falhaAntesDeMudar(erro: unknown): Falha {
  const traduzida = traduzirErroDePorta(erro)
  return /nada (?:foi alterado|mudou)/i.test(traduzida.mensagem)
    ? traduzida
    : { ...traduzida, mensagem: `${traduzida.mensagem} Nada foi alterado.` }
}

/* ------------------------------------------------------------------ */
/* Os passos, com desfazer                                             */
/* ------------------------------------------------------------------ */

export interface Passo {
  passo: NomeDoPasso
  /** Pode devolver uma nota para a trilha ("login criado com o e-mail confirmado"). */
  fazer: () => Promise<string | void>
  /** Volta o lugar ao que era. Sem `desfazer`, o passo feito não volta (a senha, por exemplo). */
  desfazer?: () => Promise<void>
}

export interface Execucao {
  /** `nada_feito` = o primeiro passo falhou: nada mudou e não há o que registrar. */
  resultado: ResultadoDaAcao | 'nada_feito'
  registro: RegistroDoPasso[]
  /** O erro do passo que falhou, para a resposta. */
  erro?: unknown
}

/**
 * Faz os passos em ordem. Se um falha, desfaz os já feitos, do último para o
 * primeiro, e diz o estado exato de cada um. Não joga: todo erro vira registro.
 */
export async function executarPassos(passos: readonly Passo[]): Promise<Execucao> {
  const registro: RegistroDoPasso[] = []
  for (let i = 0; i < passos.length; i++) {
    try {
      const nota = await passos[i].fazer()
      registro.push(nota ? { passo: passos[i].passo, estado: 'feito', nota } : { passo: passos[i].passo, estado: 'feito' })
    } catch (erro) {
      registro.push({ passo: passos[i].passo, estado: 'falhou', erro: traduzirErroDePorta(erro).mensagem })
      if (i === 0) return { resultado: 'nada_feito', registro, erro }

      let tudoVoltou = true
      for (let j = i - 1; j >= 0; j--) {
        const desfazer = passos[j].desfazer
        if (!desfazer) {
          registro[j] = { ...registro[j], estado: 'nao_desfeito', erro: 'Este passo não tem como voltar.' }
          tudoVoltou = false
          continue
        }
        try {
          await desfazer()
          registro[j] = { ...registro[j], estado: 'desfeito' }
        } catch (erroAoDesfazer) {
          registro[j] = { ...registro[j], estado: 'nao_desfeito', erro: traduzirErroDePorta(erroAoDesfazer).mensagem }
          tudoVoltou = false
        }
      }
      return { resultado: tudoVoltou ? 'desfeito' : 'incompleto', registro, erro }
    }
  }
  return { resultado: 'feito', registro }
}

/* ------------------------------------------------------------------ */
/* O atendimento                                                       */
/* ------------------------------------------------------------------ */

interface Plano {
  alvoUsuarioId: string
  antes: Record<string, unknown>
  depois: Record<string, unknown>
  passos: Passo[]
  /** A frase de sucesso, com os lugares que mudaram. */
  sucesso: (passos: RegistroDoPasso[]) => string
  /** Para `criar_conta`, o id só existe depois do primeiro passo. */
  alvoDepois?: () => string | null
}

interface Contexto {
  portas: Portas
  autor: { id: string; email: string | null }
}

export async function atender(pedido: PedidoHttp, abrir: AbrirPortas): Promise<RespostaHttp> {
  if (pedido.metodo === 'OPTIONS') return { status: 204, corpo: null }
  if (pedido.metodo !== 'POST') {
    return responderFalha(falha(405, 'metodo_nao_permitido', 'A função de contas só aceita POST.'))
  }

  // 1. Sem token, nem cliente se cria.
  const token = lerToken(pedido.autorizacao)
  if (!token) {
    return responderFalha(falha(401, 'sem_sessao', 'Faltou a sessão: entre no ponto e tente de novo.'))
  }
  const portas = abrir(token)

  // 2. Quem chama.
  let autor: { id: string; email: string | null }
  try {
    autor = await portas.sessao.quemChama()
  } catch (erro) {
    const traduzida = traduzirErroDePorta(erro)
    return responderFalha(traduzida.status === 503 ? traduzida : falha(401, 'sessao_invalida', 'Sua sessão venceu ou não vale mais. Entre de novo no ponto.'))
  }

  // 3. Super admin, perguntado ao banco com a sessão do chamador.
  let superAdmin: boolean
  try {
    superAdmin = await portas.sessao.souSuperAdmin()
  } catch (erro) {
    const traduzida = traduzirErroDePorta(erro)
    if (traduzida.codigo === 'sessao_invalida') return responderFalha(traduzida)
    portas.anotar('conferencia_de_super_admin_falhou', { autor_id: autor.id, erro: traduzida.mensagem })
    return responderFalha(
      falha(503, 'conferencia_indisponivel', 'Não foi possível conferir no banco se você é super admin. Nada foi alterado; tente de novo.'),
    )
  }
  if (superAdmin !== true) {
    return responderFalha(
      falha(403, 'nao_e_super_admin', 'Mexer em contas é exclusivo do super admin do ponto. Nada foi alterado.'),
    )
  }

  // 4. O pedido. O `Content-Length` já foi conferido em `index.ts`, antes de
  //    ler; esta é a conferência do que chegou de fato (cabeçalho ausente,
  //    corpo em pedaços).
  if (new TextEncoder().encode(pedido.corpo).length > CORPO_MAXIMO_BYTES) return respostaDoCorpoGrande()
  let corpo: unknown
  try {
    corpo = JSON.parse(pedido.corpo)
  } catch {
    return responderFalha(falha(400, 'pedido_invalido', 'O pedido não é JSON.'), { erros: ['O pedido não é JSON.'] })
  }
  const leitura = lerPedido(corpo)
  if (!leitura.ok) {
    return responderFalha(falha(400, 'pedido_invalido', leitura.erros.join(' ')), { erros: leitura.erros })
  }

  // 5. A trilha, antes de qualquer mudança.
  try {
    if ((await portas.servico.trilhaPronta()) !== true) {
      return responderFalha(
        falha(503, 'trilha_indisponivel', 'A trilha de contas não está pronta no banco (a migration da estrutura não foi aplicada, ou a trilha foi desfeita). Sem trilha, a função não mexe em conta nenhuma. Nada foi alterado.'),
      )
    }
  } catch (erro) {
    portas.anotar('trilha_nao_conferida', { erro: traduzirErroDePorta(erro).mensagem })
    return responderFalha(
      falha(503, 'trilha_indisponivel', 'Não foi possível conferir a trilha de contas no banco. Sem trilha, a função não mexe em conta nenhuma. Nada foi alterado.'),
    )
  }

  // 6 e 7.
  const contexto: Contexto = { portas, autor }
  try {
    const plano = await planejar(leitura.valor, contexto)
    if ('codigo' in plano) return responderFalha(plano)
    return await executar(leitura.valor.acao, plano, contexto)
  } catch (erro) {
    return responderFalha(falhaAntesDeMudar(erro))
  }
}

/* ------------------------------------------------------------------ */
/* Cada ação vira um plano de passos                                   */
/* ------------------------------------------------------------------ */

async function planejar(pedido: PedidoDeConta, contexto: Contexto): Promise<Plano | Falha> {
  switch (pedido.acao) {
    case 'criar_conta':
      return planejarCriarConta(pedido, contexto)
    case 'trocar_nome':
      return planejarTrocarNome(pedido, contexto)
    case 'trocar_email':
      return planejarTrocarEmail(pedido, contexto)
    case 'redefinir_senha':
      return planejarRedefinirSenha(pedido, contexto)
  }
}

const contaNaoEncontrada = () =>
  falha(404, 'conta_nao_encontrada', 'Essa conta não existe no login. Recarregue a lista de pessoas. Nada foi alterado.')

/*
 * O ALVO DE trocar_nome, trocar_email E redefinir_senha.
 *
 * QUALQUER CONTA DO LOGIN VALE, com ficha ou sem, com papel no ponto ou sem:
 * no banco do ponto, toda conta do login é do ponto. Exigir ficha ou papel só
 * atrapalharia: a conta criada sem ficha não poderia ter a senha redefinida
 * até alguém ligar uma.
 *
 * O QUE SE PROTEGE:
 *   OUTRO SUPER ADMIN, NÃO. Um super admin não troca o nome, o e-mail nem a
 *   senha de outro: 409 `super_admin_protegido`. Trocar a senha de outro
 *   super admin seria tomar a conta dele — e com ela a única lista que
 *   escolhe os admins. O próprio autor pode trocar o nome e a senha dele; o
 *   e-mail de super admin, nem o próprio (ver `planejarTrocarEmail`).
 *
 * A leitura falha FECHADO: erro nela vira a falha de leitura de `atender`
 * ("Nada foi alterado"), e nada é feito. Ela vem ANTES de ler o login: a
 * conta de outro super admin nem chega a ser consultada.
 */
async function conferirAlvo(usuarioId: string, { portas, autor }: Contexto): Promise<Falha | { superAdmin: boolean }> {
  const superAdmin = await portas.servico.contaEhSuperAdmin(usuarioId)
  if (superAdmin && usuarioId !== autor.id) {
    return falha(
      409,
      'super_admin_protegido',
      'Esta conta é de outro super admin do ponto, e o nome, o e-mail e a senha dela não se mexem por aqui. Só o próprio super admin cuida da conta dele. Nada foi alterado.',
    )
  }
  return { superAdmin }
}

/*
 * CRIAR CONTA: o login nasce pela Admin API, com o e-mail confirmado, a senha
 * provisória e o nome em `app_metadata.full_name`. O login criado já é a conta
 * inteira: o nome e o e-mail moram nele, e o acesso vem da ficha e das listas
 * de administração do ponto.
 *
 * COM `ficha_id`, a ficha sem conta é ligada no mesmo pedido, pela sessão do
 * super admin (o gatilho da ficha confere que é ele). Se a ligação falhar —
 * outra aba ligou a ficha meio segundo antes, por exemplo —, o login recém-
 * criado é removido e nada sobra. Só `usuario_id` muda na ficha: o nome
 * completo dela é o cadastro de RH e continua como está, mesmo que o nome do
 * pedido seja outro (nas telas, quem tem ficha aparece pelo nome da ficha).
 */
async function planejarCriarConta(
  pedido: Extract<PedidoDeConta, { acao: 'criar_conta' }>,
  { portas }: Contexto,
): Promise<Plano | Falha> {
  const { servico, sessao } = portas
  const onde = acharEmailRepetido(pedido.email, await servico.listarLogins(), null)
  if (onde) return { status: 409, codigo: 'email_ja_usado', onde, mensagem: fraseDoEmailRepetido(pedido.email) }

  let ficha: Ficha | null = null
  if (pedido.fichaId) {
    ficha = await sessao.lerFicha(pedido.fichaId)
    if (!ficha) {
      return falha(404, 'ficha_nao_encontrada', 'Essa ficha não existe. Recarregue a lista de pessoas. Nada foi alterado.')
    }
    if (ficha.usuarioId !== null) {
      return falha(
        409,
        'ficha_ja_ligada',
        `A ficha “${ficha.nome}” já está ligada a outra conta. Recarregue a lista de pessoas e escolha uma ficha sem conta, ou crie a conta sem ficha. Nada foi alterado.`,
      )
    }
  }
  const fichaLigada = ficha

  let criado: Login | null = null
  const passos: Passo[] = [
    {
      passo: 'login',
      fazer: async () => {
        criado = await servico.criarLogin({ email: pedido.email, senha: pedido.senhaProvisoria, nome: pedido.nome })
        return 'login criado com o e-mail confirmado e a senha provisória'
      },
      // Desfazer a criação é remover o login que esta mesma chamada criou,
      // segundos antes, e que ainda não tem nada.
      desfazer: async () => {
        if (criado) await servico.removerLogin(criado.id)
      },
    },
  ]
  if (fichaLigada) {
    passos.push({
      passo: 'ficha',
      fazer: async () => {
        await sessao.ligarFicha(fichaLigada.id, criado!.id)
        return `ficha “${fichaLigada.nome}” ligada à conta nova`
      },
    })
  }

  return {
    alvoUsuarioId: '',
    alvoDepois: () => criado?.id ?? null,
    antes: fichaLigada ? { ficha: { id: fichaLigada.id, nome: fichaLigada.nome, usuario_id: null } } : {},
    depois: {
      login: { email: pedido.email, nome: pedido.nome },
      ...(fichaLigada ? { ficha: { id: fichaLigada.id, nome: fichaLigada.nome } } : {}),
    },
    passos,
    sucesso: () =>
      fichaLigada
        ? `Conta criada para ${pedido.email}, com o e-mail já confirmado, e ligada à ficha “${fichaLigada.nome}”. Passe a senha provisória à pessoa por um canal seguro.`
        : `Conta criada para ${pedido.email}, com o e-mail já confirmado. Passe a senha provisória à pessoa por um canal seguro. Para ela bater ponto, ligue a ficha dela a esta conta.`,
  }
}

/*
 * TROCAR NOME: UMA FONTE POR CASO.
 *   • Conta SEM ficha (quem só administra, por exemplo): o nome mora só no
 *     login (`app_metadata.full_name`), e é dali que as telas o leem.
 *   • Conta COM ficha: quem dá o nome nas telas e na folha é a ficha
 *     (`nome_completo`). O login recebe a MESMA frase no mesmo pedido, como
 *     reserva: se a ficha for desligada amanhã, a conta não volta a aparecer
 *     com um nome velho. Os dois passos andam juntos — se a ficha recusar, o
 *     login volta ao que era.
 * As batidas antigas continuam com o nome da época: a função não toca em
 * `ponto_registros`.
 */
async function planejarTrocarNome(
  pedido: Extract<PedidoDeConta, { acao: 'trocar_nome' }>,
  contexto: Contexto,
): Promise<Plano | Falha> {
  const { portas } = contexto
  const { servico, sessao } = portas
  const alvo = await conferirAlvo(pedido.usuarioId, contexto)
  if ('codigo' in alvo) return alvo
  const login = await servico.lerLogin(pedido.usuarioId)
  if (!login) return contaNaoEncontrada()
  const fichas = await sessao.lerFichas(pedido.usuarioId)
  if (fichas.length > 1) {
    return falha(409, 'ficha_duplicada', 'Esta conta está ligada a mais de uma ficha, e o banco não deveria deixar. Confira as fichas antes. Nada foi alterado.')
  }
  const ficha = fichas[0] ?? null
  const novo = pedido.nome

  const passos: Passo[] = []
  if (login.nome !== novo) {
    passos.push({
      passo: 'login',
      fazer: () => servico.trocarNomeDoLogin(login.id, novo),
      desfazer: () => servico.trocarNomeDoLogin(login.id, login.nome),
    })
  }
  if (ficha && ficha.nome !== novo) {
    passos.push({
      passo: 'ficha',
      fazer: () => sessao.renomearFicha(ficha.id, novo),
      desfazer: () => sessao.renomearFicha(ficha.id, ficha.nome),
    })
  }
  if (passos.length === 0) {
    return falha(
      400,
      'nada_a_mudar',
      `“${novo}” já é o nome desta conta ${ficha ? 'no login e na ficha' : 'no login'}. Nada foi alterado.`,
    )
  }

  return {
    alvoUsuarioId: login.id,
    antes: {
      login: { nome: login.nome },
      ficha: ficha ? { id: ficha.id, nome: ficha.nome } : null,
    },
    depois: {
      login: { nome: novo },
      ficha: ficha ? { id: ficha.id, nome: novo } : null,
    },
    passos,
    sucesso: (registro) => `Nome trocado para “${novo}” (mudou ${lugaresFeitos(registro)}).`,
  }
}

/*
 * TROCAR E-MAIL: só no login. A ficha não guarda e-mail, e o repetido é
 * conferido na lista do próprio login (`listUsers`), antes de mexer. Se outro
 * pedido pegar o mesmo e-mail entre a conferência e a troca, o login recusa
 * sozinho, e a recusa chega como 409 `email_ja_usado`.
 */
async function planejarTrocarEmail(
  pedido: Extract<PedidoDeConta, { acao: 'trocar_email' }>,
  contexto: Contexto,
): Promise<Plano | Falha> {
  const { servico } = contexto.portas
  // Outro super admin já sai aqui, com 409 (`conferirAlvo`).
  const alvo = await conferirAlvo(pedido.usuarioId, contexto)
  if ('codigo' in alvo) return alvo
  const login = await servico.lerLogin(pedido.usuarioId)
  if (!login) return contaNaoEncontrada()

  // O PRÓPRIO super admin também não troca o e-mail por aqui. O e-mail é com
  // o que a conta entra e recupera a senha, e esta função troca e-mail sem
  // confirmação (`email_confirm: true`): a conta de quem manda no ponto só
  // muda de e-mail pela mão de quem tem acesso ao projeto no Supabase, e não
  // por uma sessão aberta no navegador.
  if (alvo.superAdmin) {
    return falha(
      409,
      'super_admin_protegido',
      'O e-mail de um super admin não se troca por aqui: quem cuida da instalação faz a troca direto no Supabase. Nada foi alterado.',
    )
  }

  const novo = pedido.email
  if (normalizarEmail(login.email) === novo) {
    return falha(400, 'nada_a_mudar', `${novo} já é o e-mail desta conta. Nada foi alterado.`)
  }

  const onde = acharEmailRepetido(novo, await servico.listarLogins(), login.id)
  if (onde) return { status: 409, codigo: 'email_ja_usado', onde, mensagem: fraseDoEmailRepetido(novo) }

  return {
    alvoUsuarioId: login.id,
    antes: { login: { email: login.email } },
    depois: { login: { email: novo } },
    passos: [{ passo: 'login', fazer: () => servico.trocarEmailDoLogin(login.id, novo) }],
    sucesso: () => `E-mail trocado para ${novo}. A pessoa passa a entrar com o e-mail novo; a senha continua a mesma.`,
  }
}

async function planejarRedefinirSenha(
  pedido: Extract<PedidoDeConta, { acao: 'redefinir_senha' }>,
  contexto: Contexto,
): Promise<Plano | Falha> {
  const { servico } = contexto.portas
  const alvo = await conferirAlvo(pedido.usuarioId, contexto)
  if ('codigo' in alvo) return alvo
  const login = await servico.lerLogin(pedido.usuarioId)
  if (!login) return contaNaoEncontrada()
  const erros = conferirSenhaProvisoria(pedido.senhaProvisoria, login.email)
  if (erros.length > 0) return falha(400, 'pedido_invalido', erros.join(' '))

  return {
    alvoUsuarioId: login.id,
    // A trilha diz DE QUEM foi a senha redefinida, e só isso.
    antes: { login: { email: login.email } },
    depois: { login: { email: login.email } },
    passos: [{ passo: 'login', fazer: () => servico.trocarSenhaDoLogin(login.id, pedido.senhaProvisoria) }],
    sucesso: () =>
      `Senha de ${login.email ?? 'esta conta'} redefinida. Passe a senha provisória à pessoa por um canal seguro.`,
  }
}

/* ------------------------------------------------------------------ */
/* Execução e trilha                                                   */
/* ------------------------------------------------------------------ */

async function executar(acao: AcaoDeConta, plano: Plano, { portas, autor }: Contexto): Promise<RespostaHttp> {
  const execucao = await executarPassos(plano.passos)
  const alvo = plano.alvoDepois?.() ?? plano.alvoUsuarioId

  // O primeiro passo falhou: nada mudou e não há linha a registrar.
  if (execucao.resultado === 'nada_feito') {
    return responderFalha(falhaAntesDeMudar(execucao.erro), { passos: execucao.registro })
  }

  const erroDoPasso = execucao.erro === undefined ? null : traduzirErroDePorta(execucao.erro).mensagem
  const linha = montarLinhaDaTrilha({
    acao,
    resultado: execucao.resultado,
    autor,
    alvoUsuarioId: alvo ?? '',
    antes: plano.antes,
    depois: plano.depois,
    passos: execucao.registro,
    detalhe: erroDoPasso === null ? null : `${erroDoPasso} ${descreverEstado(execucao.registro)}`,
  })

  let trilhaId: string
  try {
    trilhaId = await portas.servico.gravarTrilha(linha)
  } catch (erro) {
    // A ação aconteceu (ou aconteceu pela metade) e a linha não gravou. O log
    // da função guarda a linha inteira — sem senha — para alguém lançar à mão.
    portas.anotar('trilha_nao_gravou', { linha: semSenha(linha), erro: traduzirErroDePorta(erro).mensagem })
    return responderFalha(
      falha(
        500,
        'trilha_nao_gravou',
        `${descreverEstado(execucao.registro)} Mas a linha da trilha de contas NÃO gravou (${traduzirErroDePorta(erro).mensagem}). Ela ficou no log da função; avise quem cuida do banco.`,
      ),
      { passos: execucao.registro, acao_feita: true },
    )
  }

  if (execucao.resultado === 'feito') {
    return {
      status: 200,
      corpo: {
        ok: true,
        acao,
        usuario_id: alvo ?? '',
        mensagem: plano.sucesso(execucao.registro),
        passos: execucao.registro,
        trilha_id: trilhaId,
      },
    }
  }

  if (execucao.resultado === 'desfeito') {
    return responderFalha(
      falha(500, 'falhou_e_desfez', `Não deu: ${erroDoPasso} O que tinha mudado voltou ao que era; nada mudou. A tentativa ficou na trilha.`),
      { passos: execucao.registro },
    )
  }

  portas.anotar('acao_incompleta', { linha: semSenha(linha) })
  return responderFalha(
    falha(500, 'falhou_no_meio', `Ficou pela metade: ${erroDoPasso} ${descreverEstado(execucao.registro)} A trilha registrou o estado exato; acerte à mão o que não voltou.`),
    { passos: execucao.registro },
  )
}
