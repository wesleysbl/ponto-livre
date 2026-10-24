/*
 * AS CONTAS DE LOGIN PELA TELA DE PESSOAS, EM FUNÇÕES PURAS.
 *
 * O QUE MORA AQUI: a leitura dos formulários de conta (criar, trocar nome,
 * trocar e-mail, redefinir senha), a senha provisória sugerida, e a leitura do
 * que a Edge Function `ponto-contas` responde — sucesso ou recusa —
 * já no formato que a tela usa. Nenhuma chamada: quem fala com a função é
 * `pedirAcaoDeConta`, em `administracao.ts`.
 *
 * ---------------------------------------------------------------------------
 * A VALIDAÇÃO É A DO SERVIDOR, LITERALMENTE
 *
 * A função confere cada pedido com `lerPedido` (`supabase/functions/
 * ponto-contas/regras.ts`), que é puro — sem `Deno`, sem import de rede — e por
 * isso o app o importa e roda O MESMO código antes de mandar. Uma cópia da
 * regra aqui seria a segunda regra que diverge na primeira mudança: a tela
 * aceitaria uma senha que a função recusa, ou o contrário. Com o mesmo código,
 * a tela só AVISA antes; quem decide continua sendo a função, no servidor.
 *
 * Os TIPOS do contrato (códigos de recusa, onde o e-mail já existe, os passos)
 * também vêm de lá, com `import type`: se a função ganhar um código novo, o
 * `tsc` do app passa a conhecê-lo no mesmo commit.
 * ---------------------------------------------------------------------------
 *
 * ⚠ A SENHA NÃO SAI DAQUI PARA LUGAR NENHUM ALÉM DO CORPO DO PEDIDO. Nenhuma
 * função deste arquivo a guarda, a registra ou a põe numa mensagem.
 */
import type { Leitura } from './configuracao'
import {
  conferirSenhaProvisoria,
  lerPedido,
  SENHA_PROVISORIA_MINIMO,
  type AcaoDeConta,
  type CodigoDeFalha,
  type EstadoDoPasso,
  type NomeDoPasso,
  type OndeJaExiste,
  type PedidoDeConta,
  type RegistroDoPasso,
} from '../../supabase/functions/ponto-contas/regras.ts'

export { SENHA_PROVISORIA_MINIMO }
export type { AcaoDeConta, OndeJaExiste, RegistroDoPasso }

/* ------------------------------------------------------------------ */
/* O corpo do pedido                                                   */
/* ------------------------------------------------------------------ */

/**
 * O corpo JSON que a função lê — os nomes do contrato
 * (`supabase/functions/ponto-contas/regras.ts`), em snake_case. Campo a mais a
 * função RECUSA (não ignora), então cada ação manda exatamente os seus.
 */
export type CorpoDoPedidoDeConta =
  | { acao: 'criar_conta'; email: string; nome: string; senha_provisoria: string }
  | { acao: 'trocar_nome'; usuario_id: string; nome: string }
  | { acao: 'trocar_email'; usuario_id: string; email: string }
  | { acao: 'redefinir_senha'; usuario_id: string; senha_provisoria: string }

/** O pedido conferido por `lerPedido` volta a ser corpo, com o nome e o e-mail já normalizados. */
function paraOCorpo(pedido: PedidoDeConta): CorpoDoPedidoDeConta {
  switch (pedido.acao) {
    case 'criar_conta':
      return {
        acao: 'criar_conta',
        email: pedido.email,
        nome: pedido.nome,
        senha_provisoria: pedido.senhaProvisoria,
      }
    case 'trocar_nome':
      return { acao: 'trocar_nome', usuario_id: pedido.usuarioId, nome: pedido.nome }
    case 'trocar_email':
      return { acao: 'trocar_email', usuario_id: pedido.usuarioId, email: pedido.email }
    case 'redefinir_senha':
      return {
        acao: 'redefinir_senha',
        usuario_id: pedido.usuarioId,
        senha_provisoria: pedido.senhaProvisoria,
      }
  }
}

function conferir(corpo: Record<string, unknown>): Leitura<CorpoDoPedidoDeConta> {
  const leitura = lerPedido(corpo)
  return leitura.ok ? { ok: true, valor: paraOCorpo(leitura.valor) } : leitura
}

/* ------------------------------------------------------------------ */
/* Os formulários                                                      */
/* ------------------------------------------------------------------ */

/** O formulário de conta nova: tudo texto, como sai de um `<input>`. */
export interface RascunhoDaNovaConta {
  nome: string
  email: string
  senha: string
}

/**
 * Conta nova: e-mail, nome e senha provisória, pela regra do servidor. O nome
 * sai sem espaço repetido e o e-mail em minúsculas — é o que a função grava.
 */
export function validarNovaConta(rascunho: RascunhoDaNovaConta): Leitura<CorpoDoPedidoDeConta> {
  return conferir({
    acao: 'criar_conta',
    email: rascunho.email,
    nome: rascunho.nome,
    senha_provisoria: rascunho.senha,
  })
}

export function validarTrocaDeNome(usuarioId: string, nome: string): Leitura<CorpoDoPedidoDeConta> {
  return conferir({ acao: 'trocar_nome', usuario_id: usuarioId, nome })
}

export function validarTrocaDeEmail(usuarioId: string, email: string): Leitura<CorpoDoPedidoDeConta> {
  return conferir({ acao: 'trocar_email', usuario_id: usuarioId, email })
}

/**
 * Senha nova. Além da regra do pedido, a de "não pode ser o próprio e-mail",
 * que o servidor só confere depois de ler o login — aqui o e-mail que a tela
 * conhece (o da lista de contas, `ponto_contas()`) já serve para avisar antes.
 */
export function validarNovaSenha(
  usuarioId: string,
  senha: string,
  emailDaConta: string | null,
): Leitura<CorpoDoPedidoDeConta> {
  const leitura = conferir({ acao: 'redefinir_senha', usuario_id: usuarioId, senha_provisoria: senha })
  // O que a regra diz A MAIS quando sabe o e-mail — sem copiar a frase dela.
  const semEmail = conferirSenhaProvisoria(senha)
  const contraOEmail = emailDaConta
    ? conferirSenhaProvisoria(senha, emailDaConta).filter((frase) => !semEmail.includes(frase))
    : []
  if (contraOEmail.length === 0) return leitura
  return { ok: false, erros: [...(leitura.ok ? [] : leitura.erros), ...contraOEmail] }
}

/* ------------------------------------------------------------------ */
/* A senha provisória sugerida                                         */
/* ------------------------------------------------------------------ */

/*
 * SEM OS CARACTERES QUE SE CONFUNDEM AO SER DITADOS OU LIDOS NO CELULAR:
 * 0/O, 1/l/I. E sem `*`, `_`, `~` e crase: colada no WhatsApp, a senha com dois
 * asteriscos vira negrito e chega sem eles.
 */
const MINUSCULAS = 'abcdefghijkmnpqrstuvwxyz'
const MAIUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITOS = '23456789'
const SIMBOLOS = '#!?'
const QUALQUER = MINUSCULAS + MAIUSCULAS + DIGITOS

/** 12: quatro a mais que o mínimo do servidor, e ainda dá para ditar. */
export const TAMANHO_DA_SENHA_SUGERIDA = 12

/** Um inteiro uniforme em [0, limite). */
export type Sorteio = (limite: number) => number

/**
 * Sorteio pelo gerador criptográfico do navegador, sem viés de módulo: o valor
 * que cai na "sobra" acima do maior múltiplo de `limite` é descartado.
 */
export const sortearComCrypto: Sorteio = (limite) => {
  const teto = Math.floor(0x1_0000_0000 / limite) * limite
  const caixa = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(caixa)
    if (caixa[0] < teto) return caixa[0] % limite
  }
}

/**
 * Uma senha provisória para o super admin passar à pessoa.
 *
 * TEM UM DE CADA: minúscula, maiúscula, número e símbolo. O login do projeto
 * pode exigir tipos de caractere (Authentication → Providers → Email), e a
 * sugestão precisa passar em qualquer uma das regras que o Supabase oferece —
 * senão o primeiro clique em "gerar" já volta recusado.
 *
 * O sorteio é injetado para o teste conferir a forma sem depender da sorte.
 */
export function gerarSenhaProvisoria(sortear: Sorteio = sortearComCrypto): string {
  const pegar = (conjunto: string) => conjunto[sortear(conjunto.length)]
  const letras = [pegar(MINUSCULAS), pegar(MAIUSCULAS), pegar(DIGITOS), pegar(SIMBOLOS)]
  while (letras.length < TAMANHO_DA_SENHA_SUGERIDA) letras.push(pegar(QUALQUER))
  // Fisher–Yates: os quatro obrigatórios não ficam sempre no começo.
  for (let i = letras.length - 1; i > 0; i--) {
    const j = sortear(i + 1)
    ;[letras[i], letras[j]] = [letras[j], letras[i]]
  }
  return letras.join('')
}

/* ------------------------------------------------------------------ */
/* O que a função responde                                             */
/* ------------------------------------------------------------------ */

/** Sucesso (HTTP 200): o corpo `{ ok: true, ... }` do contrato, com os nomes da tela. */
export interface SucessoDeConta {
  acao: AcaoDeConta
  /** A conta mexida — em `criar_conta`, a conta NOVA (é com ela que a ficha é ligada depois). */
  usuarioId: string
  /** A frase da função, já em português. */
  mensagem: string
  passos: RegistroDoPasso[]
  trilhaId: string
}

/**
 * Os códigos que só o APP produz, para o que acontece antes ou fora da função:
 * a função não publicada, a rede que caiu, uma resposta que ninguém entende.
 */
export type CodigoDoApp = 'funcao_nao_publicada' | 'sem_conexao_com_a_funcao' | 'resposta_inesperada'

export interface FalhaDeConta {
  /** Os códigos da função (`CodigoDeFalha`, regras.ts) ou os do app. */
  codigo: CodigoDeFalha | CodigoDoApp
  mensagem: string
  /** Em `email_ja_usado`: onde o e-mail já existe. O caso de borda pede que a tela diga qual. */
  onde: OndeJaExiste | null
  /** Em `pedido_invalido`: a lista de frases. */
  erros: string[]
  /** O estado de cada passo quando a ação andou (desfeita, pela metade ou sem trilha). */
  passos: RegistroDoPasso[]
  /**
   * A AÇÃO ACONTECEU mesmo com a resposta de erro (`trilha_nao_gravou`). A tela
   * precisa recarregar a lista: a conta pode ter mudado.
   */
  acaoFeita: boolean
  /** O HTTP da resposta; nulo quando nem houve resposta (rede). */
  status: number | null
}

/** Erro já traduzido, com o que a tela precisa para decidir sem ler a frase. */
export class ErroDeConta extends Error {
  readonly falha: FalhaDeConta
  constructor(falha: FalhaDeConta) {
    super(falha.mensagem)
    this.name = 'ErroDeConta'
    this.falha = falha
  }
}

/*
 * Os valores que a função manda (`OndeJaExiste`, `EstadoDoPasso` e
 * `NomeDoPasso`, em regras.ts). O `satisfies` faz o `tsc` recusar aqui um valor
 * que o contrato não tem; o que chegar fora destas listas é descartado na
 * leitura, e não repassado à tela.
 */
const ONDE = ['login'] as const satisfies readonly OndeJaExiste[]
const ESTADOS_DO_PASSO = ['feito', 'falhou', 'desfeito', 'nao_desfeito'] as const satisfies readonly EstadoDoPasso[]
const NOMES_DO_PASSO = ['login', 'ficha'] as const satisfies readonly NomeDoPasso[]

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function lerPassos(valor: unknown): RegistroDoPasso[] {
  if (!Array.isArray(valor)) return []
  return valor.filter(
    (item): item is RegistroDoPasso =>
      ehObjeto(item) &&
      (NOMES_DO_PASSO as readonly unknown[]).includes(item.passo) &&
      (ESTADOS_DO_PASSO as readonly unknown[]).includes(item.estado),
  )
}

/**
 * A resposta 200 da função, conferida. Nula quando o corpo não é o do contrato
 * — quem chama trata como "resposta inesperada", e NÃO como sucesso.
 */
export function lerSucessoDaFuncao(corpo: unknown): SucessoDeConta | null {
  if (!ehObjeto(corpo) || corpo.ok !== true) return null
  if (typeof corpo.acao !== 'string' || typeof corpo.mensagem !== 'string') return null
  return {
    acao: corpo.acao as AcaoDeConta,
    usuarioId: typeof corpo.usuario_id === 'string' ? corpo.usuario_id : '',
    mensagem: corpo.mensagem,
    passos: lerPassos(corpo.passos),
    trilhaId: typeof corpo.trilha_id === 'string' ? corpo.trilha_id : '',
  }
}

function falha(
  codigo: FalhaDeConta['codigo'],
  mensagem: string,
  status: number | null,
): FalhaDeConta {
  return { codigo, mensagem, onde: null, erros: [], passos: [], acaoFeita: false, status }
}

/**
 * Uma recusa da função vira `FalhaDeConta`.
 *
 * QUANDO O CORPO É O DO CONTRATO (`{ ok: false, codigo, mensagem, ... }`), a
 * frase é a da função — ela já vem em português e sabe o que aconteceu lá
 * dentro (desfez, ficou pela metade, a trilha não gravou). A tela não a
 * reescreve.
 *
 * QUANDO NÃO É — e isso acontece em casos reais: o gateway do Supabase responde
 * antes da função (sessão recusada, função que não existe), ou a rede caiu e
 * nem houve resposta —, a frase sai daqui, pelo HTTP. O caso que mais importa
 * é o 404: numa instalação em que a função ainda não foi publicada no Supabase,
 * toda ação de conta volta assim. A tela precisa dizer isso com essas
 * palavras, e não "erro 404".
 */
export function lerFalhaDaFuncao(status: number | null, corpo: unknown): FalhaDeConta {
  if (
    ehObjeto(corpo) &&
    corpo.ok === false &&
    typeof corpo.codigo === 'string' &&
    typeof corpo.mensagem === 'string'
  ) {
    return {
      codigo: corpo.codigo as CodigoDeFalha,
      mensagem: corpo.mensagem,
      onde: (ONDE as readonly unknown[]).includes(corpo.onde) ? (corpo.onde as OndeJaExiste) : null,
      erros: Array.isArray(corpo.erros)
        ? corpo.erros.filter((frase): frase is string => typeof frase === 'string')
        : [],
      passos: lerPassos(corpo.passos),
      acaoFeita: corpo.acao_feita === true,
      status,
    }
  }

  /*
   * SEM RESPOSTA NÃO DÁ PARA DIZER "NADA MUDOU": o pedido pode ter chegado e a
   * resposta é que se perdeu (a rede caiu na volta, ou o prazo estourou com a
   * função ainda trabalhando). A frase manda conferir antes de repetir — criar
   * a mesma conta duas vezes daria "e-mail já usado" na segunda, e trocar o
   * e-mail duas vezes, o mesmo.
   */
  if (status === null) {
    return falha(
      'sem_conexao_com_a_funcao',
      'A função de contas não respondeu: a internet caiu ou ela demorou demais. Se a conexão estiver boa, a função pode ainda não estar publicada no Supabase. Recarregue a lista e confira se algo mudou antes de tentar de novo.',
      null,
    )
  }
  if (status === 401) {
    return falha('sessao_invalida', 'Sua sessão venceu ou não vale mais. Entre de novo no ponto.', status)
  }
  if (status === 403) {
    return falha(
      'nao_e_super_admin',
      'Mexer em contas é exclusivo do super admin do ponto. Nada foi alterado.',
      status,
    )
  }
  if (status === 404) {
    return falha(
      'funcao_nao_publicada',
      'A função de contas (ponto-contas) não está publicada no Supabase. Até ela ser publicada, criar conta, trocar nome ou e-mail e redefinir senha não funcionam por aqui. Nada foi alterado.',
      status,
    )
  }
  if (status === 429) {
    return falha(
      'muitas_tentativas',
      'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
      status,
    )
  }
  if (status === 200) {
    return falha(
      'resposta_inesperada',
      'A função de contas respondeu num formato que a tela não entende. Recarregue a lista e confira se algo mudou antes de tentar de novo.',
      status,
    )
  }
  return falha(
    'resposta_inesperada',
    `A função de contas falhou sem explicar (HTTP ${status}). Não dá para saber daqui se algo mudou: recarregue a lista e confira antes de tentar de novo.`,
    status,
  )
}

/**
 * O `error` de `supabase.functions.invoke` vira `FalhaDeConta`.
 *
 * O supabase-js devolve três erros (functions-js 2.112): `FunctionsHttpError`
 * quando a resposta veio com status fora de 2xx — com a `Response` em
 * `context`, de onde sai o corpo do contrato —, `FunctionsRelayError` quando o
 * relay do Supabase falhou (também com a `Response`), e `FunctionsFetchError`
 * quando nem houve resposta. A comparação é pela FORMA (`context.status` e
 * `context.json`), e não por `instanceof`: a classe que o bundle carrega e a
 * que um teste cria não precisam ser a mesma para o app entender a resposta.
 */
export async function falhaDoErroDaFuncao(erro: unknown): Promise<FalhaDeConta> {
  const contexto = ehObjeto(erro) ? erro.context : undefined
  if (
    ehObjeto(contexto) &&
    typeof contexto.status === 'number' &&
    typeof (contexto as { json?: unknown }).json === 'function'
  ) {
    let corpo: unknown = null
    try {
      corpo = await (contexto as unknown as Response).json()
    } catch {
      corpo = null
    }
    return lerFalhaDaFuncao(contexto.status, corpo)
  }
  return lerFalhaDaFuncao(null, null)
}

/* ------------------------------------------------------------------ */
/* As frases da tela                                                   */
/* ------------------------------------------------------------------ */

/**
 * Depois desta recusa, a lista precisa ser RELIDA? Sim quando a conta pode ter
 * mudado: a ação aconteceu e a trilha não gravou, ficou pela metade, ou não se
 * sabe (sem resposta, resposta que não se entende). Nos outros casos a função
 * garante que nada mudou — "Nada foi alterado", na frase dela.
 */
export function falhaPedeReleitura(falhaDeConta: FalhaDeConta): boolean {
  return (
    falhaDeConta.acaoFeita ||
    falhaDeConta.codigo === 'falhou_no_meio' ||
    falhaDeConta.codigo === 'sem_conexao_com_a_funcao' ||
    falhaDeConta.codigo === 'resposta_inesperada'
  )
}

/**
 * A frase de uma recusa para a tela. Em `pedido_invalido` com lista, a lista
 * inteira (a tela mostra uma frase por linha); nos outros casos, a mensagem.
 */
export function frasesDaFalha(falhaDeConta: FalhaDeConta): string[] {
  if (falhaDeConta.erros.length > 0) return falhaDeConta.erros
  return [falhaDeConta.mensagem]
}
