/*
 * A TRILHA DE CORREÇÕES, DO JEITO QUE A TELA MOSTRA — a parte pura, sem
 * `supabase.ts`, para poder ser testada no Node. `admin.ts` lê do banco e
 * reexporta daqui; as telas continuam importando de `admin.ts`.
 *
 * DUAS NATUREZAS
 * `ponto_correcoes.natureza` diz quem mudou a batida:
 *   • 'admin'   — correção de quem administra o ponto, com motivo escrito por
 *                 ele e `autor_id` = a sessão dele. Liga `ajuste_manual`.
 *   • 'sistema' — operação do próprio banco, aberta pelo canal do sistema:
 *                 reordenar o dia depois de uma batida retroativa, ou
 *                 recalcular a distância depois de corrigir o local. O motivo
 *                 vem do canal e `autor_id` é nulo quando quem rodou foi uma
 *                 migration. Não liga `ajuste_manual`.
 *
 * O DEFEITO QUE ISTO EVITA
 * Lida sem a coluna `natureza`, a trilha escreveria "Administrador não
 * identificado" para todo `autor_id` nulo: uma operação do sistema que tocasse
 * centenas de batidas faria "Corrigir", em qualquer uma delas, mostrar uma
 * "correção" de um administrador fantasma — numa tela que serve de prova
 * trabalhista. A linha 'sistema' aparece como "Sistema", com o motivo do canal.
 */

export type NaturezaDaCorrecao = 'admin' | 'sistema'

/** Uma linha da trilha de correções, como `ponto_guardar_correcao` a gravou. */
export interface Correcao {
  id: string
  registro_id: string
  usuario_id: string
  motivo: string
  /**
   * Quais campos mudaram: `registrado_em`, `tipo`, `coordenada`, `selfie_path`
   * e também `dia_civil`, `origem`, `ordem_no_dia`,
   * `distancia_metros`, `no_local`, `local_id` e os da fotografia da conta
   * (`funcionario_nome`, `funcionario_email`).
   */
  campos: string[]
  /** A linha INTEIRA como estava antes (`to_jsonb(OLD)`). O original nunca some. */
  valores_antes: Record<string, unknown>
  valores_depois: Record<string, unknown>
  /** `auth.uid()` de quem corrigiu. Nulo numa operação do sistema rodada por migration. */
  autor_id: string | null
  criado_em: string
  /** Quem mudou: o admin, com motivo, ou o próprio banco (ver o cabeçalho). */
  natureza: NaturezaDaCorrecao
}

/** Como o autor de uma operação do sistema aparece na tela. */
export const AUTOR_DO_SISTEMA = 'Sistema'

/** Como aparece a correção de admin cujo autor não está entre as pessoas lidas. */
export const AUTOR_NAO_IDENTIFICADO = 'Administrador não identificado'

/**
 * A natureza como veio do banco. Só 'sistema' é sistema: ausente, nula ou
 * desconhecida vale 'admin', que é o DEFAULT da coluna e o que o painel sempre
 * mostrou — melhor um rótulo conservador do que uma tela quebrada.
 */
export function naturezaDaCorrecao(valor: unknown): NaturezaDaCorrecao {
  return valor === 'sistema' ? 'sistema' : 'admin'
}

/** Uma linha crua de `ponto_correcoes` com a natureza já decidida. */
export function normalizarCorrecao(linha: Record<string, unknown>): Correcao {
  return {
    ...(linha as unknown as Omit<Correcao, 'natureza'>),
    natureza: naturezaDaCorrecao(linha.natureza),
  }
}

/** O nome de quem corrigiu, a partir das pessoas lidas no painel. */
export function nomeDoAdmin(autorId: string | null, nomes: ReadonlyMap<string, string>): string {
  return (autorId && nomes.get(autorId)) || AUTOR_NAO_IDENTIFICADO
}

/**
 * Quem aparece como autor de uma linha da trilha. Operação do sistema é
 * "Sistema", nunca um administrador — com ou sem `autor_id`: quando a
 * reordenação roda dentro da correção de um admin, o `autor_id` é o dele, mas
 * quem reordenou foi o banco.
 */
export function rotuloDoAutor(
  correcao: Pick<Correcao, 'natureza' | 'autor_id'>,
  nomeDoAutor: (autorId: string | null) => string,
): string {
  return correcao.natureza === 'sistema' ? AUTOR_DO_SISTEMA : nomeDoAutor(correcao.autor_id)
}

/** O horário que estava gravado antes desta correção, ou nulo se não foi ele que mudou. */
export function horarioAnteriorDaCorrecao(correcao: Correcao): string | null {
  if (!correcao.campos.includes('registrado_em')) return null
  const valor = correcao.valores_antes.registrado_em
  return typeof valor === 'string' ? valor : null
}

/** O horário que a correção gravou. */
export function horarioPosteriorDaCorrecao(correcao: Correcao): string | null {
  if (!correcao.campos.includes('registrado_em')) return null
  const valor = correcao.valores_depois.registrado_em
  return typeof valor === 'string' ? valor : null
}

/*
 * O QUE MUDOU, EM PALAVRAS DO RH.
 *
 * "campos: registrado_em, dia_civil" seria o nome das colunas do banco. Quem
 * lê a trilha é o RH, conferindo um cartão de ponto
 * questionado: "mudou: horário e dia" diz a mesma coisa sem pedir que alguém
 * saiba o que é `dia_civil`. As colunas da localização viram uma palavra só.
 * Coluna nova, sem nome aqui, aparece crua: melhor um nome técnico do que
 * esconder que algo mudou.
 */
const NOME_DO_CAMPO: Record<string, string> = {
  registrado_em: 'horário',
  dia_civil: 'dia',
  tipo: 'nome da batida',
  ordem_no_dia: 'ordem no dia',
  motivo_ajuste: 'motivo',
  coordenada: 'localização',
  latitude: 'localização',
  longitude: 'localização',
  precisao_metros: 'localização',
  distancia_metros: 'distância até o local',
  no_local: 'no local ou fora',
  local_id: 'local de referência',
  selfie_path: 'foto',
  origem: 'origem',
  ajuste_manual: 'marca de ajuste',
  funcionario_nome: 'nome gravado',
  funcionario_email: 'e-mail gravado',
}

/** `['registrado_em', 'dia_civil']` -> "horário e dia". Sem repetir, na ordem em que vieram. */
export function descreverCampos(campos: readonly string[]): string {
  const nomes = [...new Set(campos.map((campo) => NOME_DO_CAMPO[campo] ?? campo))]
  if (nomes.length <= 1) return nomes[0] ?? ''
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}
