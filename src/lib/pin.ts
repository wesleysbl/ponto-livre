import { supabase } from './supabase'

/*
 * Camada única de conversa com as funções de PIN do banco.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * `ponto_pin` e `ponto_pin_tentativas` são deny-all: RLS ligada, zero policies,
 * nenhum privilégio para `authenticated`. Não existe SELECT nem UPDATE nelas
 * pelo PostgREST. A única porta são as funções SECURITY DEFINER do banco,
 * chamadas por RPC. Todo o resto do app fala com este módulo e nunca
 * com `supabase.from('ponto_pin')` — que, aliás, devolveria erro de permissão.
 *
 * O CONTRATO ABAIXO É O DAS FUNÇÕES DO BANCO (`supabase/migrations/`),
 * conferido com pg_get_function_identity_arguments / pg_get_function_result:
 *
 *   ponto_pin_status()              -> jsonb    (STABLE, SECURITY DEFINER)
 *   ponto_definir_pin(p_pin text)   -> void     (VOLATILE, SECURITY DEFINER)
 *   ponto_verificar_pin(p_pin text) -> jsonb    (VOLATILE, SECURITY DEFINER)
 *   ponto_resetar_pin(p_usuario_id uuid) -> jsonb  (só quem administra)
 *
 * Todas com EXECUTE só para `authenticated` — `anon` não chama nenhuma.
 */

/** Retorno de `ponto_pin_status()`. As três chaves vêm sempre. */
export interface StatusDoPin {
  /** Existe linha em ponto_pin para esta conta? */
  definido: boolean
  /**
   * Ligado pelo reset do admin. Quando não existe linha, o banco devolve
   * `true` por coalesce — ou seja, "primeira definição" e "redefinição pedida
   * pelo admin" chegam com o mesmo valor aqui. Quem separa os dois casos é
   * `definido`.
   */
  precisa_redefinir: boolean
  /** ISO 8601 enquanto a conta está travada; `null` fora da trava. */
  bloqueado_ate: string | null
}

/**
 * Retorno de `ponto_verificar_pin(text)`. União discriminada porque o banco
 * devolve conjuntos de chaves DIFERENTES em cada caso — copiar isto errado é a
 * forma mais fácil de mostrar número errado na tela.
 */
export type VerificacaoDoPin =
  /** PIN certo. `precisa_redefinir` vem do estado da linha, não da conferência. */
  | { confere: true; precisa_redefinir: boolean }
  /** Não há PIN cadastrado para esta conta. Só estas duas chaves. */
  | { confere: false; motivo: 'pin_nao_definido' }
  /** PIN errado, ainda sem trava. `bloqueado_ate` vem presente e nulo. */
  | { confere: false; motivo: 'pin_incorreto'; tentativas_restantes: number; bloqueado_ate: null }
  /**
   * Conta travada. ARMADILHA DOCUMENTADA: quando a trava é acionada na quinta
   * tentativa, o banco devolve `tentativas_restantes: 5` — ele zera o contador
   * de propósito, para a trava vencer com as cinco chances inteiras. E quando a
   * tentativa cai numa trava já em curso, `tentativas_restantes` nem vem.
   * A interface NUNCA mostra esse número com motivo 'bloqueado': mostra o tempo
   * que falta, calculado de `bloqueado_ate`.
   */
  | { confere: false; motivo: 'bloqueado'; tentativas_restantes?: number; bloqueado_ate: string }

/** Retorno de `ponto_resetar_pin(uuid)`. Usado pelo painel do admin. */
export interface ResultadoDoReset {
  resetado: boolean
  usuario_id: string
  /** `false` quando a conta ainda nem tinha PIN — o reset é inócuo, mas não é erro. */
  tinha_pin: boolean
  resetado_em: string
}

/**
 * Traduz a exceção do Postgres para uma frase que o funcionário entende.
 * As mensagens de origem estão sem acento porque saem de `RAISE EXCEPTION` nas
 * funções do banco.
 */
function traduzirErro(mensagem: string): string {
  /*
   * A liberação e o reset de PIN se pedem a quem cuida do ponto na empresa,
   * como na tela "sem acesso": o acesso vem da ficha, ligada pelo super admin,
   * e o reset é de quem administra o ponto.
   */
  if (mensagem.includes('Conta sem acesso')) {
    return 'Seu acesso ao ponto ainda não foi liberado. Peça a liberação a quem cuida do ponto na sua empresa.'
  }
  if (mensagem.includes('PIN ja definido')) {
    return 'Você já tem um PIN. Para trocar, peça a quem cuida do ponto na sua empresa para resetar.'
  }
  if (mensagem.includes('PIN invalido')) {
    return 'O PIN precisa ter exatamente 4 dígitos.'
  }
  if (mensagem.includes('exige sessao de usuario')) {
    return 'Sua sessão expirou. Entre de novo.'
  }
  /*
   * A mesma tradução de `admin.ts`, e este é o caminho que a recusa REALMENTE
   * percorre: quem chama `ponto_resetar_pin` é `resetarPinDeUsuario`, logo
   * abaixo, que levanta `ErroDePin` e não `ErroDoPainel`. O texto casado é o
   * do `RAISE` do banco ("Reset de PIN e exclusivo de quem administra o
   * ponto"); se ele mudar e a comparação deixar de casar, a mensagem crua do
   * Postgres — sem acento, em linguagem de banco — vai inteira para a tela.
   */
  if (mensagem.includes('exclusivo de quem administra o ponto')) {
    return 'Só quem administra o ponto pode resetar o PIN de alguém.'
  }
  // "Load failed": a mesma falha de rede, na frase do Safari do iPhone. Ver
  // `traduzirErro` em `batidas.ts`.
  if (/fetch|network|Failed to fetch|Load failed/i.test(mensagem)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  }
  return mensagem
}

/** Erro já traduzido para a tela. */
export class ErroDePin extends Error {
  constructor(mensagem: string) {
    super(traduzirErro(mensagem))
    this.name = 'ErroDePin'
  }
}

/** Situação do PIN da própria conta. É o que decide entre "defina" e "digite". */
export async function lerStatusDoPin(): Promise<StatusDoPin> {
  const { data, error } = await supabase.rpc('ponto_pin_status')
  if (error) throw new ErroDePin(error.message)
  return data as StatusDoPin
}

/**
 * Grava o PIN. O banco recusa se já existir um e o admin não tiver pedido
 * redefinição, e recusa a conta sem acesso ao ponto (sem ficha que libera e
 * sem papel de administração) — as duas recusas chegam aqui como ErroDePin com
 * a frase pronta.
 */
export async function definirPin(pin: string): Promise<void> {
  const { error } = await supabase.rpc('ponto_definir_pin', { p_pin: pin })
  if (error) throw new ErroDePin(error.message)
}

/**
 * Confere o PIN NO SERVIDOR. O app manda o valor digitado e recebe só
 * confere/não confere — nunca o hash, nunca o contador bruto. Toda a contagem
 * de tentativas e a trava moram no banco, por conta: trocar de aparelho não
 * zera nada. A trava endurece no mesmo dia (15 minutos no primeiro bloqueio, 1
 * hora no segundo, 24 horas do terceiro em diante); quem diz até quando é o
 * `bloqueado_ate` da resposta.
 */
export async function verificarPin(pin: string): Promise<VerificacaoDoPin> {
  const { data, error } = await supabase.rpc('ponto_verificar_pin', { p_pin: pin })
  if (error) throw new ErroDePin(error.message)
  return data as VerificacaoDoPin
}

/**
 * Reset do PIN de um funcionário. Só admin — a checagem é do banco, não daqui.
 * Depois disso a próxima entrada daquela pessoa cai na tela de definir PIN.
 * Quem aciona são a lista de pessoas da administração e a tela da pessoa, no
 * painel.
 */
export async function resetarPinDeUsuario(usuarioId: string): Promise<ResultadoDoReset> {
  const { data, error } = await supabase.rpc('ponto_resetar_pin', { p_usuario_id: usuarioId })
  if (error) throw new ErroDePin(error.message)
  return data as ResultadoDoReset
}

/** Segundos que faltam para a trava vencer. Zero quando não há trava. */
export function segundosDeTrava(bloqueadoAte: string | null | undefined): number {
  if (!bloqueadoAte) return 0
  const falta = new Date(bloqueadoAte).getTime() - Date.now()
  return falta > 0 ? Math.ceil(falta / 1000) : 0
}

/**
 * "4:07" — formato de contagem regressiva. Com uma hora ou mais (o segundo
 * bloqueio do dia dura 1 hora, e o terceiro, 24), sai com as horas na frente,
 * "1:00:00" e "23:59:59", e não "1440:00".
 */
export function formatarEspera(segundos: number): string {
  const horas = Math.floor(segundos / 3600)
  const minutos = Math.floor((segundos % 3600) / 60)
  const resto = segundos % 60
  const minutosESegundos = `${String(minutos).padStart(horas > 0 ? 2 : 1, '0')}:${String(resto).padStart(2, '0')}`
  return horas > 0 ? `${horas}:${minutosESegundos}` : minutosESegundos
}
