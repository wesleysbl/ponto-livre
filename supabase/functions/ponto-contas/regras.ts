/*
 * PONTO-CONTAS — AS REGRAS PURAS DA EDGE FUNCTION DE CONTAS.
 *
 * ONDE MORA CADA DADO DA CONTA: o nome mora no login (`app_metadata.full_name`,
 * que só a chave de serviço grava) e, quando a conta tem ficha, também na
 * ficha (`ponto_funcionarios.nome_completo`); o e-mail mora só no login. Por
 * isso os lugares que a função mexe são dois — `login` e `ficha` —, e o e-mail
 * repetido só pode estar no login.
 *
 * O QUE MORA AQUI: a leitura do pedido (texto que veio pela rede vira pedido
 * conferido, ou vira uma lista de frases explicando o que está errado), a
 * regra da senha provisória, a conferência de e-mail repetido, a montagem da
 * linha da trilha SEM SENHA e a tradução dos erros do login (Auth) e do banco
 * (PostgREST) para português.
 *
 * O QUE NÃO MORA AQUI: nenhum `Deno`, nenhum import de rede (`npm:`, `jsr:`,
 * `https:`), nenhuma chamada. É a mesma razão de `src/lib/cadastro.ts` e
 * `src/lib/configuracao.ts` serem módulos puros, com uma exigência a mais:
 * este arquivo roda no Deno, no servidor do Supabase, E é importado pelo
 * Vitest e pelo `tsc` do app (`src/ponto-contas-regras.test.ts`). Um
 * `Deno.env` aqui quebraria o build do app; um import de `npm:` quebraria o
 * `tsc`. Quem segura isso é `src/ponto-contas.test.ts` ("só index.ts fala com
 * o Deno").
 *
 * ---------------------------------------------------------------------------
 * ⚠ A SENHA NÃO SAI DAQUI PARA LUGAR NENHUM ALÉM DO LOGIN
 *
 * A regra ("toda ação grava uma linha numa trilha de contas: quem, o quê,
 * quando, antes e depois, nunca a senha") vira três travas:
 *   1. `montarLinhaDaTrilha` passa tudo por `semSenha` antes de devolver;
 *   2. a tabela recusa, por CHECK, JSON com qualquer chave de `CHAVES_DE_SENHA`
 *      em qualquer nível (na migration da estrutura, em
 *      `supabase/migrations/`);
 *   3. o teste procura o TEXTO da senha em tudo o que a função gravou, em tudo
 *      o que respondeu e em tudo o que anotou no log.
 * ---------------------------------------------------------------------------
 */

/* ------------------------------------------------------------------ */
/* O contrato                                                          */
/* ------------------------------------------------------------------ */

/** As quatro ações da função. É também o CHECK de `ponto_contas_trilha.acao`. */
export const ACOES = ['criar_conta', 'trocar_nome', 'trocar_email', 'redefinir_senha'] as const
export type AcaoDeConta = (typeof ACOES)[number]

/**
 * O pedido já conferido. Os nomes do corpo JSON são os da coluna (snake_case).
 *
 * `fichaId` (corpo: `ficha_id`, opcional) no `criar_conta`: a ficha sem conta
 * que a conta nova já nasce ligando. Sem ele, a conta nasce sem ficha, e a
 * tela liga depois.
 */
export type PedidoDeConta =
  | { acao: 'criar_conta'; email: string; nome: string; senhaProvisoria: string; fichaId?: string }
  | { acao: 'trocar_nome'; usuarioId: string; nome: string }
  | { acao: 'trocar_email'; usuarioId: string; email: string }
  | { acao: 'redefinir_senha'; usuarioId: string; senhaProvisoria: string }

/** O mesmo formato de `Leitura` de `src/lib/configuracao.ts` (a função não importa de `src/`). */
export type Leitura<T> = { ok: true; valor: T } | { ok: false; erros: string[] }

/** Os campos que cada ação aceita no corpo. Campo a mais é recusado, e não ignorado. */
const CAMPOS_DA_ACAO: Record<AcaoDeConta, readonly string[]> = {
  criar_conta: ['acao', 'email', 'nome', 'senha_provisoria', 'ficha_id'],
  trocar_nome: ['acao', 'usuario_id', 'nome'],
  trocar_email: ['acao', 'usuario_id', 'email'],
  redefinir_senha: ['acao', 'usuario_id', 'senha_provisoria'],
}

/* ------------------------------------------------------------------ */
/* As faixas                                                           */
/* ------------------------------------------------------------------ */

/**
 * A regra da senha provisória, conferida AQUI, no servidor — a tela de contas
 * repete a conta para avisar antes, mas não decide.
 *
 * MÍNIMO 8 CARACTERES: o padrão do login do Supabase é 6, e senha provisória é
 * a que viaja por mensagem até a pessoa. O login pode ter regra própria mais
 * dura (tamanho, tipos de caractere, senha vazada); quando tiver, a recusa
 * dele chega traduzida por `traduzirErroDaAuth`.
 *
 * MÁXIMO 72 BYTES: é o teto do bcrypt, que o login usa. Acima disso o login
 * recusa — e, se não recusasse, ignoraria o resto em silêncio.
 */
export const SENHA_PROVISORIA_MINIMO = 8
export const SENHA_MAXIMO_BYTES = 72
export const NOME_MINIMO = 2
export const NOME_MAXIMO = 120
export const EMAIL_MAXIMO = 254
/** O pedido maior que existe tem quatro campos curtos. 10 kB é folga, não uso. */
export const CORPO_MAXIMO_BYTES = 10_000

/**
 * O `Content-Length` já diz que o corpo passa do teto? `index.ts` pergunta
 * isto ANTES de `req.text()`: sem a pergunta, um pedido de megabytes seria
 * lido inteiro para a memória da função, e só depois recusado. Cabeçalho ausente ou fora do formato (só dígitos) responde
 * false — aí vale a conferência de depois de ler, que continua em `atender`.
 */
export function corpoDeclaradoGrandeDemais(contentLength: string | null | undefined, teto: number = CORPO_MAXIMO_BYTES): boolean {
  if (contentLength === null || contentLength === undefined) return false
  const texto = contentLength.trim()
  if (!/^\d+$/.test(texto)) return false
  return Number(texto) > teto
}

/**
 * As chaves que nunca entram na trilha, EM MINÚSCULAS: a comparação ignora
 * maiúsculas (`senhaProvisoria`, `Password` e `SENHA` são chaves de senha). A
 * MESMA lista está em `ponto_contas_tem_chave_de_senha()`, a função do CHECK
 * `ponto_contas_trilha_sem_senha` da migration, que compara com `lower()`; o
 * teste confere as duas. `senhaprovisoria` está na lista por causa do
 * camelCase `senhaProvisoria`, do jeito que um app em JavaScript escreveria:
 * sem ela, essa chave passaria pelas duas travas.
 */
export const CHAVES_DE_SENHA = ['senha', 'password', 'senha_provisoria', 'senhaprovisoria', 'nova_senha'] as const

/** As colunas que a função grava na trilha. São as do `GRANT INSERT (...)` da migration. */
export const COLUNAS_DA_TRILHA = [
  'acao',
  'resultado',
  'autor_id',
  'autor_email',
  'alvo_usuario_id',
  'antes',
  'depois',
  'passos',
  'detalhe',
] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ------------------------------------------------------------------ */
/* Leitura de campo                                                    */
/* ------------------------------------------------------------------ */

/** E-mail como o login guarda: sem espaço nas pontas e em minúsculas. */
export function normalizarEmail(texto: string | null | undefined): string {
  return (texto ?? '').trim().toLowerCase()
}

/**
 * Nome sem espaço nas pontas e sem espaço repetido no meio: "  Ana   Lima " vira
 * "Ana Lima". É assim que ele vai para o login e para a ficha.
 */
export function normalizarNome(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ')
}

/**
 * Formato de e-mail. De propósito, só o essencial (um @ com texto dos dois
 * lados, um ponto depois dele e nenhum espaço): quem decide se o endereço
 * existe é a caixa de entrada, e um filtro mais esperto que o do login
 * recusaria endereço que o login aceita.
 */
export function emailEhValido(email: string): boolean {
  return email.length <= EMAIL_MAXIMO && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function lerEmail(valor: unknown, erros: string[]): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    erros.push('O e-mail está vazio.')
    return ''
  }
  const email = normalizarEmail(valor)
  if (email.length > EMAIL_MAXIMO) {
    erros.push(`O e-mail passa de ${EMAIL_MAXIMO} caracteres.`)
  } else if (!emailEhValido(email)) {
    erros.push(`Isto não parece um e-mail: “${email}”.`)
  }
  return email
}

function lerNome(valor: unknown, erros: string[]): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    erros.push('O nome está vazio.')
    return ''
  }
  const nome = normalizarNome(valor)
  const tamanho = Array.from(nome).length
  if (tamanho < NOME_MINIMO) {
    erros.push(`O nome precisa ter pelo menos ${NOME_MINIMO} letras.`)
  } else if (tamanho > NOME_MAXIMO) {
    erros.push(`O nome passa de ${NOME_MAXIMO} caracteres.`)
  } else if (!/\p{L}/u.test(nome)) {
    erros.push('O nome precisa ter letras.')
  }
  return nome
}

function lerUsuarioId(valor: unknown, erros: string[]): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    erros.push('Diga de qual conta (usuario_id).')
    return ''
  }
  const id = valor.trim().toLowerCase()
  if (!UUID.test(id)) erros.push('O usuario_id não é o identificador de uma conta.')
  return id
}

/** `ficha_id` ausente ou nulo = conta sem ficha. Presente, tem de ser o id de uma ficha. */
function lerFichaId(valor: unknown, erros: string[]): string | null {
  if (valor === undefined || valor === null) return null
  if (typeof valor === 'string' && valor.trim() === '') {
    erros.push('O ficha_id está vazio: mande o id da ficha, ou não mande o campo.')
    return null
  }
  const id = typeof valor === 'string' ? valor.trim().toLowerCase() : ''
  if (!UUID.test(id)) erros.push('O ficha_id não é o identificador de uma ficha.')
  return id || null
}

/**
 * A regra da senha provisória. Devolve as frases do que está errado; vazio =
 * aceita. A senha NÃO é aparada: espaço nas pontas é recusado, e não apagado,
 * porque apagar faria a senha que a pessoa recebe ser outra que a gravada.
 *
 * `email` é o da conta, quando se sabe (no `criar_conta` vem no pedido; no
 * `redefinir_senha` vem do login, depois da leitura).
 */
export function conferirSenhaProvisoria(senha: unknown, email?: string | null): string[] {
  if (typeof senha !== 'string' || senha === '') return ['A senha provisória está vazia.']
  const erros: string[] = []
  if (senha.trim() === '') return ['A senha provisória não pode ser só espaço.']
  if (senha !== senha.trim()) erros.push('A senha provisória não pode começar nem terminar com espaço.')
  if (Array.from(senha).length < SENHA_PROVISORIA_MINIMO) {
    erros.push(`A senha provisória precisa ter pelo menos ${SENHA_PROVISORIA_MINIMO} caracteres.`)
  }
  if (new TextEncoder().encode(senha).length > SENHA_MAXIMO_BYTES) {
    erros.push(`A senha provisória passa do limite do login (${SENHA_MAXIMO_BYTES} bytes; letra acentuada conta 2).`)
  }
  if (email && normalizarEmail(senha) === normalizarEmail(email)) {
    erros.push('A senha provisória não pode ser o próprio e-mail.')
  }
  return erros
}

/* ------------------------------------------------------------------ */
/* Leitura do pedido                                                   */
/* ------------------------------------------------------------------ */

/**
 * O corpo do pedido, já como objeto (o JSON.parse é do atendimento), vira um
 * pedido conferido. Todos os erros de uma vez, como `validarFicha`: a tela
 * mostra a lista inteira, e não um erro por clique.
 */
export function lerPedido(corpo: unknown): Leitura<PedidoDeConta> {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    return { ok: false, erros: ['O pedido precisa ser um objeto JSON com a ação e os campos dela.'] }
  }
  const campos = corpo as Record<string, unknown>
  const acao = campos.acao
  if (typeof acao !== 'string' || !(ACOES as readonly string[]).includes(acao)) {
    return { ok: false, erros: [`Diga a ação: ${ACOES.join(', ')}.`] }
  }

  const erros: string[] = []
  const aceitos = CAMPOS_DA_ACAO[acao as AcaoDeConta]
  const sobrando = Object.keys(campos).filter((campo) => !aceitos.includes(campo))
  if (sobrando.length > 0) {
    erros.push(`Campo que ${acao} não usa: ${sobrando.join(', ')}.`)
  }

  switch (acao as AcaoDeConta) {
    case 'criar_conta': {
      const email = lerEmail(campos.email, erros)
      const nome = lerNome(campos.nome, erros)
      erros.push(...conferirSenhaProvisoria(campos.senha_provisoria, email))
      const fichaId = lerFichaId(campos.ficha_id, erros)
      if (erros.length > 0) return { ok: false, erros }
      return {
        ok: true,
        valor: {
          acao: 'criar_conta',
          email,
          nome,
          senhaProvisoria: campos.senha_provisoria as string,
          ...(fichaId ? { fichaId } : {}),
        },
      }
    }
    case 'trocar_nome': {
      const usuarioId = lerUsuarioId(campos.usuario_id, erros)
      const nome = lerNome(campos.nome, erros)
      if (erros.length > 0) return { ok: false, erros }
      return { ok: true, valor: { acao: 'trocar_nome', usuarioId, nome } }
    }
    case 'trocar_email': {
      const usuarioId = lerUsuarioId(campos.usuario_id, erros)
      const email = lerEmail(campos.email, erros)
      if (erros.length > 0) return { ok: false, erros }
      return { ok: true, valor: { acao: 'trocar_email', usuarioId, email } }
    }
    case 'redefinir_senha': {
      const usuarioId = lerUsuarioId(campos.usuario_id, erros)
      erros.push(...conferirSenhaProvisoria(campos.senha_provisoria))
      if (erros.length > 0) return { ok: false, erros }
      return {
        ok: true,
        valor: { acao: 'redefinir_senha', usuarioId, senhaProvisoria: campos.senha_provisoria as string },
      }
    }
  }
}

/**
 * O token do cabeçalho `Authorization: Bearer <jwt>`. Qualquer outra forma é
 * "sem sessão": a função não tenta adivinhar.
 */
export function lerToken(cabecalho: string | null | undefined): string | null {
  const casamento = /^Bearer\s+(\S+)\s*$/i.exec(cabecalho ?? '')
  return casamento ? casamento[1] : null
}

/* ------------------------------------------------------------------ */
/* E-mail repetido                                                     */
/* ------------------------------------------------------------------ */

/**
 * Onde o e-mail já existe. A resposta diz o lugar (a tela de contas mostra),
 * e no banco do ponto o e-mail mora num lugar só: o login.
 */
export type OndeJaExiste = 'login'

/**
 * O e-mail já é de OUTRA conta do login? `exceto` é a própria conta (no
 * `trocar_email`): o login dela não conta. Quem diz é a lista inteira do
 * login (`listUsers`), e não uma tabela do banco: é o login que recusaria o
 * repetido, e é ele que a função consulta antes de mexer.
 */
export function acharEmailRepetido(
  email: string,
  logins: readonly { id: string; email: string | null }[],
  exceto: string | null,
): OndeJaExiste | null {
  const alvo = normalizarEmail(email)
  return logins.some((login) => login.id !== exceto && normalizarEmail(login.email) === alvo) ? 'login' : null
}

export function fraseDoEmailRepetido(email: string): string {
  return `O e-mail ${email} já é o login de outra conta. Nada mudou: escolha outro e-mail, ou resolva a outra conta antes.`
}

/* ------------------------------------------------------------------ */
/* A trilha, sem senha                                                 */
/* ------------------------------------------------------------------ */

/**
 * Onde a ação mexe. `login` = a conta de acesso (Auth); `ficha` =
 * `ponto_funcionarios`.
 */
export type NomeDoPasso = 'login' | 'ficha'

/**
 * O que aconteceu com cada passo. `nao_desfeito` = o passo foi feito, um passo
 * seguinte falhou, e desfazer este TAMBÉM falhou (ou não existe desfazer):
 * é o estado que a trilha e a resposta precisam dizer com todas as letras.
 */
export type EstadoDoPasso = 'feito' | 'falhou' | 'desfeito' | 'nao_desfeito'

export interface RegistroDoPasso {
  passo: NomeDoPasso
  estado: EstadoDoPasso
  /** O que o passo fez, quando há o que dizer ("login criado com o e-mail confirmado"). */
  nota?: string
  /** O erro, já traduzido. Nunca a senha: nenhum erro do login a repete. */
  erro?: string
}

/** `feito` = tudo; `desfeito` = falhou no meio e voltou ao começo; `incompleto` = falhou no meio e não voltou inteiro. */
export type ResultadoDaAcao = 'feito' | 'desfeito' | 'incompleto'

/** Uma linha de `public.ponto_contas_trilha`, como a função a manda. `id` e `feito_em` são do banco. */
export interface LinhaDaTrilha {
  acao: AcaoDeConta
  resultado: ResultadoDaAcao
  autor_id: string
  autor_email: string | null
  alvo_usuario_id: string
  antes: Record<string, unknown>
  depois: Record<string, unknown>
  passos: RegistroDoPasso[]
  detalhe: string | null
}

const ehChaveDeSenha = (chave: string) => (CHAVES_DE_SENHA as readonly string[]).includes(chave.toLowerCase())

/**
 * Cópia do valor sem nenhuma chave de senha, em qualquer nível. É a primeira
 * das três travas do cabeçalho: o resto da função não põe senha em
 * `antes`/`depois`, e isto garante que um descuido futuro também não ponha.
 */
export function semSenha<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((item) => semSenha(item)) as T
  if (valor !== null && typeof valor === 'object') {
    const limpo: Record<string, unknown> = {}
    for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
      if (!ehChaveDeSenha(chave)) limpo[chave] = semSenha(item)
    }
    return limpo as T
  }
  return valor
}

/** O `detalhe` da trilha tem teto no banco (CHECK de 2000). Corta aqui, para o INSERT não falhar por isso. */
export const DETALHE_MAXIMO = 2000

export function montarLinhaDaTrilha(dados: {
  acao: AcaoDeConta
  resultado: ResultadoDaAcao
  autor: { id: string; email: string | null }
  alvoUsuarioId: string
  antes: Record<string, unknown>
  depois: Record<string, unknown>
  passos: RegistroDoPasso[]
  detalhe?: string | null
}): LinhaDaTrilha {
  const detalhe = dados.detalhe?.trim() ? dados.detalhe.trim().slice(0, DETALHE_MAXIMO) : null
  return semSenha({
    acao: dados.acao,
    resultado: dados.resultado,
    autor_id: dados.autor.id,
    autor_email: dados.autor.email,
    alvo_usuario_id: dados.alvoUsuarioId,
    antes: dados.antes,
    depois: dados.depois,
    passos: dados.passos,
    detalhe,
  })
}

/* ------------------------------------------------------------------ */
/* Os erros, em português                                              */
/* ------------------------------------------------------------------ */

/**
 * O erro de uma porta (login, banco, sessão), já sem o formato do
 * supabase-js. Quem cria é `portas.ts`; quem traduz é `traduzirErroDePorta`.
 */
export class ErroDePorta extends Error {
  readonly origem: 'auth' | 'banco' | 'sessao'
  readonly codigo: string | null
  readonly status: number | null
  readonly motivos: readonly string[]

  constructor(
    origem: 'auth' | 'banco' | 'sessao',
    mensagem: string,
    extra: { codigo?: string | null; status?: number | null; motivos?: readonly string[] } = {},
  ) {
    super(mensagem)
    this.name = 'ErroDePorta'
    this.origem = origem
    this.codigo = extra.codigo ?? null
    this.status = extra.status ?? null
    this.motivos = extra.motivos ?? []
  }
}

/** Os códigos que a resposta carrega, para a tela de contas decidir sem ler a frase. */
export type CodigoDeFalha =
  | 'metodo_nao_permitido'
  | 'sem_sessao'
  | 'sessao_invalida'
  | 'nao_e_super_admin'
  | 'conferencia_indisponivel'
  | 'pedido_grande_demais'
  | 'pedido_invalido'
  | 'trilha_indisponivel'
  | 'conta_nao_encontrada'
  | 'email_ja_usado'
  | 'super_admin_protegido'
  | 'ficha_nao_encontrada'
  | 'ficha_ja_ligada'
  | 'ficha_duplicada'
  | 'nada_a_mudar'
  | 'senha_recusada'
  | 'email_recusado'
  | 'muitas_tentativas'
  | 'sem_conexao'
  | 'configuracao_incompleta'
  | 'banco_recusou'
  | 'banco_incompleto'
  | 'erro_do_login'
  | 'erro_do_banco'
  | 'falhou_e_desfez'
  | 'falhou_no_meio'
  | 'trilha_nao_gravou'
  | 'erro_inesperado'

export interface Falha {
  status: number
  codigo: CodigoDeFalha
  mensagem: string
  onde?: OndeJaExiste
}

const MOTIVOS_DA_SENHA: Record<string, string> = {
  length: 'é curta demais para a regra do login',
  characters: 'precisa de mais tipos de caractere (letra maiúscula, minúscula, número ou símbolo)',
  pwned: 'aparece em vazamentos de senha conhecidos',
}

const ehFalhaDeRede = (mensagem: string) =>
  /failed to fetch|fetch failed|network|timed? ?out|ECONNRE|ENOTFOUND|connection (?:refused|reset)/i.test(mensagem)

/**
 * O login (GoTrue) recusou. Pelo `code` quando ele vem (supabase-js 2.x
 * entrega `email_exists`, `weak_password`...), pela frase quando não vem: a
 * frase em inglês é o que versões antigas do login mandam, e é o que sobra
 * quando o código muda de nome.
 */
export function traduzirErroDaAuth(erro: { codigo?: string | null; status?: number | null; mensagem: string; motivos?: readonly string[] }): Falha {
  const { codigo, status, mensagem } = erro
  if (codigo === 'email_exists' || codigo === 'user_already_exists' || /already (?:been )?registered|already exists/i.test(mensagem)) {
    return { status: 409, codigo: 'email_ja_usado', onde: 'login', mensagem: 'Este e-mail já é de outro login. Nada mudou.' }
  }
  if (codigo === 'weak_password' || /password.*(?:weak|short|at least|should|characters|pwned)/i.test(mensagem)) {
    const motivos = (erro.motivos ?? []).map((motivo) => MOTIVOS_DA_SENHA[motivo] ?? motivo)
    return {
      status: 400,
      codigo: 'senha_recusada',
      mensagem: motivos.length
        ? `O login recusou a senha provisória: ela ${motivos.join('; ')}. Escolha outra.`
        : 'O login recusou a senha provisória pela regra dele. Escolha outra, mais longa e variada.',
    }
  }
  if (codigo === 'email_address_invalid' || codigo === 'email_address_not_authorized' || (codigo === 'validation_failed' && /email/i.test(mensagem))) {
    return { status: 400, codigo: 'email_recusado', mensagem: 'O login recusou este e-mail como inválido. Confira o endereço.' }
  }
  if (codigo === 'user_not_found' || status === 404) {
    return { status: 404, codigo: 'conta_nao_encontrada', mensagem: 'Essa conta não existe no login. Recarregue a lista de pessoas.' }
  }
  if (codigo === 'over_request_rate_limit' || codigo === 'over_email_send_rate_limit' || status === 429) {
    return { status: 429, codigo: 'muitas_tentativas', mensagem: 'O login pediu para esperar: muitas tentativas seguidas. Tente de novo em alguns minutos.' }
  }
  if (codigo === 'not_admin' || codigo === 'no_authorization' || status === 401 || status === 403) {
    return {
      status: 500,
      codigo: 'configuracao_incompleta',
      mensagem: 'A função não conseguiu falar com o login como administradora (chave de serviço recusada). Avise quem fez o deploy da função.',
    }
  }
  if (ehFalhaDeRede(mensagem)) {
    return { status: 503, codigo: 'sem_conexao', mensagem: 'A função não alcançou o login. Tente de novo em instantes.' }
  }
  return { status: 502, codigo: 'erro_do_login', mensagem: `O login respondeu com erro: ${mensagem}` }
}

/**
 * O banco (PostgREST) recusou. As frases dos gatilhos do ponto chegam sem
 * acento (saem de `RAISE EXCEPTION`); vão entre aspas no fim, para quem
 * investiga, depois da frase em português.
 */
export function traduzirErroDoBanco(erro: { codigo?: string | null; mensagem: string }): Falha {
  const { codigo, mensagem } = erro
  if (codigo === 'nenhuma_linha') {
    return { status: 409, codigo: 'banco_recusou', mensagem }
  }
  if (codigo === 'PGRST301' || codigo === 'PGRST303' || /\bJWT\b/i.test(mensagem)) {
    return { status: 401, codigo: 'sessao_invalida', mensagem: 'Sua sessão venceu ou não vale mais. Entre de novo no ponto.' }
  }
  if (codigo === '42501' || /row-level security|permission denied/i.test(mensagem)) {
    return { status: 403, codigo: 'banco_recusou', mensagem: `O banco recusou por permissão (“${mensagem}”).` }
  }
  if (codigo === 'PGRST202' || codigo === 'PGRST205' || codigo === '42P01' || codigo === '42883' || codigo === '42703') {
    return { status: 503, codigo: 'banco_incompleto', mensagem: `O banco ainda não tem o que esta função usa (“${mensagem}”). Nada foi alterado.` }
  }
  if (codigo === '23505') {
    return { status: 409, codigo: 'banco_recusou', mensagem: `O banco recusou um valor repetido (“${mensagem}”).` }
  }
  if (codigo === '23514' || codigo === '23502' || codigo === '22001' || codigo === '23503') {
    return { status: 400, codigo: 'banco_recusou', mensagem: `O banco recusou o valor (“${mensagem}”).` }
  }
  if (ehFalhaDeRede(mensagem)) {
    return { status: 503, codigo: 'sem_conexao', mensagem: 'A função não alcançou o banco. Tente de novo em instantes.' }
  }
  return { status: 500, codigo: 'erro_do_banco', mensagem: `O banco respondeu com erro (“${mensagem}”).` }
}

/** Qualquer erro que uma porta jogue, traduzido. O que não é `ErroDePorta` é defeito, e diz isso. */
export function traduzirErroDePorta(erro: unknown): Falha {
  if (erro instanceof ErroDePorta) {
    if (erro.origem === 'auth') {
      return traduzirErroDaAuth({ codigo: erro.codigo, status: erro.status, mensagem: erro.message, motivos: erro.motivos })
    }
    if (erro.origem === 'sessao') {
      if (ehFalhaDeRede(erro.message)) {
        return { status: 503, codigo: 'sem_conexao', mensagem: 'A função não alcançou o login para conferir sua sessão. Tente de novo.' }
      }
      return { status: 401, codigo: 'sessao_invalida', mensagem: 'Sua sessão venceu ou não vale mais. Entre de novo no ponto.' }
    }
    return traduzirErroDoBanco({ codigo: erro.codigo, mensagem: erro.message })
  }
  const mensagem = erro instanceof Error ? erro.message : String(erro)
  if (ehFalhaDeRede(mensagem)) {
    return { status: 503, codigo: 'sem_conexao', mensagem: 'A função perdeu a conexão no meio do caminho. Tente de novo.' }
  }
  return { status: 500, codigo: 'erro_inesperado', mensagem: `Erro inesperado na função de contas: ${mensagem}` }
}

/* ------------------------------------------------------------------ */
/* Frases do resultado                                                 */
/* ------------------------------------------------------------------ */

const NOME_DO_LUGAR: Record<NomeDoPasso, string> = {
  login: 'o login',
  ficha: 'a ficha',
}

function juntarComE(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join('')
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

/**
 * O estado exato depois de uma falha no meio, em uma frase por lugar. É a
 * regra da função: ela desfaz o que mudou ou devolve o estado exato.
 */
export function descreverEstado(passos: readonly RegistroDoPasso[]): string {
  const frases = passos.map((registro) => {
    const lugar = NOME_DO_LUGAR[registro.passo]
    switch (registro.estado) {
      case 'feito':
        return `${lugar} mudou`
      case 'desfeito':
        return `${lugar} mudou e voltou ao que era`
      case 'nao_desfeito':
        return `${lugar} MUDOU E NÃO VOLTOU`
      case 'falhou':
        return `${lugar} não mudou`
    }
  })
  const texto = juntarComE(frases)
  return texto.charAt(0).toUpperCase() + texto.slice(1) + '.'
}

/** Os lugares em que a ação mudou alguma coisa, para a frase de sucesso. */
export function lugaresFeitos(passos: readonly RegistroDoPasso[]): string {
  return juntarComE(passos.filter((registro) => registro.estado === 'feito').map((registro) => NOME_DO_LUGAR[registro.passo]))
}
