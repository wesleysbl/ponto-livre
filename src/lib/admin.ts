import { supabase } from './supabase'
import { diaCivilDeHoje, type BatidaDoAdmin } from './formato'
import { juntarGenteEFichas, type FuncionarioDoPainel, type GenteDoPainel } from './painel'
import type { Periodo } from './periodo'
import { lerTodasAsPaginas } from './paginacao'
import { segundosDaMensagemDeDuplicidade } from './configuracao'
import { traduzirHorarioNoFuturo } from './trava-de-futuro'
import { normalizarCorrecao, type Correcao } from './trilha'
import { comNomesDasFichas, nomeDeExibicao, nomesDasFichas } from './nomes'
import { lerFichas, lerSuperAdmins } from './administracao'

/*
 * A parte pura da trilha mora em `trilha.ts` (testável no Node, sem
 * `supabase.ts`). A reexportação mantém `import { type Correcao } from
 * '../lib/admin'` funcionando nas telas.
 */
export type { Correcao, NaturezaDaCorrecao } from './trilha'
export {
  AUTOR_DO_SISTEMA,
  AUTOR_NAO_IDENTIFICADO,
  horarioAnteriorDaCorrecao,
  horarioPosteriorDaCorrecao,
  nomeDoAdmin,
  rotuloDoAutor,
} from './trilha'

/*
 * A CONVERSA DO PAINEL COM O BANCO — o mesmo papel que `batidas.ts` faz para o
 * funcionário e `pin.ts` para o PIN. A tela nunca monta uma chamada na mão.
 *
 * (A configuração do ponto — local, empresa e regras de jornada — mora em
 * `administracao.ts`, que é a outra metade da área de admin. Aqui é o
 * fechamento do mês; lá são os ajustes de sistema.)
 *
 * NENHUMA REGRA DE ACESSO MORA AQUI, E ISSO É DE PROPÓSITO
 * Quem decide quem lê todo mundo, corrige e insere é a RLS, conferida no banco
 * a cada chamada. As policies são estas (ver `supabase/migrations/`), todas
 * perguntando `ponto_pode_administrar()` (estar em `public.ponto_admins`):
 *
 *   SELECT ponto_registros  USING (auth.uid() IS NOT NULL
 *                                  AND (ponto_pode_administrar()
 *                                       OR dono e ponto_ator_aprovado()))
 *   UPDATE ponto_registros  USING/CHECK (auth.uid() IS NOT NULL AND ponto_pode_administrar())
 *   INSERT ponto_registros  CHECK       (auth.uid() IS NOT NULL AND ponto_pode_administrar())
 *   (DELETE de batida não existe para o app: nem policy, nem privilégio)
 *   SELECT ponto_correcoes  USING (auth.uid() IS NOT NULL
 *                                  AND (ponto_pode_administrar()
 *                                       OR dono e ponto_ator_aprovado()))
 *   ponto_resetar_pin(uuid) levanta 42501 para quem não administra o ponto
 *
 * A guarda de rota do app é conveniência de interface. Se alguém forçar
 * `/painel` na URL sem administrar o ponto, a tela pode até montar — e cada
 * consulta volta vazia e cada escrita volta recusada, porque a decisão é do
 * Postgres.
 *
 * O QUE O GATILHO FAZ SOZINHO, E QUE ESTE MÓDULO NÃO REPETE
 * `ponto_carimbar_registro` (BEFORE INSERT) deduz tipo, ordem no dia, dia
 * civil, distância e marca dentro/fora. O INSERT direto (o deste módulo) é
 * SEMPRE lançamento de quem administra: o banco grava `origem='ajuste_admin'`
 * e `ajuste_manual=true`, mande o que mandar, exige horário e motivo, e recusa
 * quem lança batida para si mesmo. A origem 'app' só nasce pela RPC da batida,
 * com selfie e PIN.
 * `ponto_guardar_correcao` (BEFORE UPDATE) grava a trilha em `ponto_correcoes`
 * com autor, momento, campos alterados e o valor ANTERIOR inteiro, recalcula o
 * dia civil, congela a origem e recusa correção sem motivo e correção da
 * própria batida. Nada disso é escrito daqui: trilha escrita pelo cliente é
 * trilha que o cliente pode não escrever.
 */

/**
 * Colunas explícitas — uma linha só, senão o supabase-js perde a tipagem.
 * `pedido_atraso_id` é o que marca a batida que nasceu de um pedido de
 * batida em atraso aprovado, no painel, na folha e no CSV.
 */
const COLUNAS_DO_ADMIN =
  'id, usuario_id, registrado_em, dia_civil, tipo, ordem_no_dia, latitude, longitude, precisao_metros, distancia_metros, no_local, selfie_path, ajuste_manual, origem, motivo_ajuste, funcionario_nome, funcionario_email, pedido_atraso_id'

/*
 * `natureza`: 'admin' ou 'sistema'. Sem ela, a trilha que o banco grava
 * sozinho (reordenação do dia, recálculo do local) apareceria como correção de
 * um "Administrador não identificado" — ver `trilha.ts`.
 */
const COLUNAS_DA_CORRECAO =
  'id, registro_id, usuario_id, motivo, campos, valores_antes, valores_depois, autor_id, criado_em, natureza'

function traduzirErro(mensagem: string): string {
  /*
   * O gatilho recusa correção cujo motivo é IDÊNTICO ao que já estava na linha
   * — que é como um UPDATE sem a coluna `motivo_ajuste` chegaria ao banco,
   * herdando o motivo da correção anterior e nascendo com cara de explicado.
   * Vem antes da regra do motivo vazio de propósito: são dois problemas com
   * conselhos diferentes, e "escreva um motivo" não ajuda quem já escreveu um.
   */
  if (/Motivo repetido/i.test(mensagem)) {
    return 'Este motivo é igual ao da correção anterior. Escreva o motivo desta correção.'
  }
  // Sem "o banco recusa": a frase aparece na caixa de corrigir, para o RH, e o
  // banco não é assunto dele.
  if (/Correcao de ponto exige motivo|ajuste_exige_motivo|Batida lancada por quem administra exige motivo/i.test(mensagem)) {
    return 'Escreva o motivo: ele é obrigatório e fica guardado com o seu nome.'
  }
  /*
   * Quem é dono da batida não lança nem corrige o próprio ponto, nem o super
   * admin: a regra é do banco (o carimbo e a trilha), a mesma do pedido de
   * batida em atraso, que ninguém decide para si.
   */
  if (/Quem e dono da batida nao lanca o proprio ponto/i.test(mensagem)) {
    return 'Você não pode lançar batida para você mesmo. Peça a outra pessoa que administra o ponto, ou ao super admin.'
  }
  if (/Quem e dono da batida nao corrige o proprio ponto/i.test(mensagem)) {
    return 'Você não pode corrigir a sua própria batida. Peça a outra pessoa que administra o ponto, ou ao super admin.'
  }
  // A caixa de inserir sempre manda o horário; esta só chega de quem chama a
  // API direto.
  if (/Batida lancada por quem administra exige o horario/i.test(mensagem)) {
    return 'Informe o horário da batida. A batida de agora a própria pessoa bate pela tela de bater, com selfie e PIN.'
  }
  /*
   * A janela de duplicidade é configuração
   * (`ponto_configuracao.janela_duplicidade_segundos`). Uma frase que dissesse
   * "a menos de um minuto" de cabeça mentiria no primeiro ajuste feito pela área
   * de administração. O número sai da própria mensagem do gatilho, que o
   * carrega — e, quando não sai, a frase vai sem número em vez de inventar um.
   */
  if (/Batida duplicada/i.test(mensagem)) {
    const segundos = segundosDaMensagemDeDuplicidade(mensagem)
    return segundos === null
      ? 'Já existe uma batida desta pessoa dentro da janela que recusa batida repetida.'
      : `Já existe uma batida desta pessoa a menos de ${segundos} segundos deste horário.`
  }
  /*
   * A trava de futuro recusa inserção e correção com horário mais de 1 minuto
   * à frente do servidor. A frase do banco já é legível; aqui ela ganha a do
   * app, com o horário recusado. Ver `trava-de-futuro.ts`.
   */
  const horarioNoFuturo = traduzirHorarioNoFuturo(mensagem)
  if (horarioNoFuturo) return horarioNoFuturo
  /*
   * A RECUSA DA RLS E A DO `RAISE`, NAS PALAVRAS DO PONTO.
   *
   * 1. A frase diz o que vale no banco: a permissão é estar em
   *    `public.ponto_admins`, e a tela diz "quem administra o ponto", o nome
   *    da lista que a pessoa vai conferir.
   *
   * 2. A regex casa com o texto do `RAISE` de hoje (`"Reset de PIN e exclusivo
   *    de quem administra o ponto"`, e o "exclusiva" de `ponto_contas()`). Se
   *    ele mudar no banco e a regex deixar de casar, a mensagem passa crua
   *    para a tela, em português sem acento e com jeito de erro de banco.
   */
  if (/row-level security|violates row-level/i.test(mensagem)) {
    return 'O banco recusou: esta ação é exclusiva de quem administra o ponto.'
  }
  // "exclusivo" (o reset de PIN) e "exclusiva" (a lista de contas, `ponto_contas()`).
  if (/exclusiv[oa] de quem administra o ponto|exige sessao de usuario/i.test(mensagem)) {
    return 'Sua sessão não administra o ponto. Entre de novo; se persistir, peça a alguém da lista para conceder a administração.'
  }
  if (/Registro de ponto sem dono/i.test(mensagem)) {
    return 'A batida precisa de um funcionário. Escolha a pessoa antes de gravar.'
  }
  if (/JSON object requested|multiple \(or no\) rows|PGRST116/i.test(mensagem)) {
    return 'Essa batida não foi encontrada. Recarregue a lista e tente de novo.'
  }
  if (/fetch|network|Failed to fetch|NetworkError/i.test(mensagem)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  }
  return mensagem
}

/** Erro já traduzido para a tela do painel. */
export class ErroDoPainel extends Error {
  constructor(mensagem: string) {
    super(traduzirErro(mensagem))
    this.name = 'ErroDoPainel'
  }
}

/**
 * POR QUE TODA LEITURA DESTE ARQUIVO PAGINA.
 *
 * O PostgREST corta a resposta num teto configurado no projeto (o padrão do
 * Supabase é 1000 linhas) e NÃO avisa que cortou. Um mês de 25 funcionários com
 * 4 batidas por dia útil passa de 2000 linhas: sem paginar, o fechamento sairia
 * silenciosamente incompleto — e um relatório de ponto a menos é pior do que
 * um erro na tela, porque ninguém desconfia dele.
 *
 * O laço mora em `paginacao.ts`, não aqui: paginar só as batidas e não as
 * outras leituras de lista seria uma assimetria do tipo que envelhece calada.
 */
const traduzirParaOPainel = (mensagem: string) => new ErroDoPainel(mensagem)

/**
 * As batidas de um período, de todo mundo ou de uma pessoa.
 *
 * O recorte é por `dia_civil` (o dia em `America/Sao_Paulo` carimbado pelo
 * gatilho), e não por `registrado_em`: filtrar pelo carimbo em UTC jogaria a
 * batida das 21h30 do dia 31 para dentro do mês seguinte.
 */
export async function lerBatidasDoPeriodo(
  periodo: Periodo,
  usuarioId?: string,
): Promise<BatidaDoAdmin[]> {
  const todas = await lerTodasAsPaginas((de, ate) => {
    const consulta = supabase
      .from('ponto_registros')
      .select(COLUNAS_DO_ADMIN)
      .gte('dia_civil', periodo.inicio)
      .lte('dia_civil', periodo.fim)
      // Ordem estável: sem ela, duas páginas podem repetir e pular linhas.
      .order('registrado_em', { ascending: true })
      .order('id', { ascending: true })
      .range(de, ate)

    return usuarioId ? consulta.eq('usuario_id', usuarioId) : consulta
  }, traduzirParaOPainel)

  return todas as BatidaDoAdmin[]
}

/**
 * AS CONTAS DO PONTO, de onde sai a lista do painel, da tela da pessoa, da
 * folha e de pessoas.
 *
 * A lista de contas é `ponto_contas()`, `SECURITY DEFINER`, que devolve de
 * `auth.users` o id, o e-mail, o nome guardado na conta pela função de contas
 * (`raw_app_meta_data->>'full_name'`, que a própria pessoa não edita), a
 * criação e o último login. Só quem
 * administra recebe: para qualquer outra sessão a função levanta 42501 — e a
 * recusa chega aqui como ERRO, não como lista vazia ("ninguém tem conta" é uma
 * resposta plausível, que a tela mostraria sem desconfiar).
 *
 * São TODAS as contas do banco do ponto — e o banco do ponto só tem gente do
 * ponto. QUEM APARECE no
 * painel é decidido depois, em `montarLinhasDoPainel`: só quem é do ponto no
 * período (ficha ligada, batida, ausência ou pedido). As contas que ficam fora
 * do painel continuam servindo para dar nome a quem decidiu um pedido ou
 * lançou uma ausência.
 *
 * NÃO PAGINA, como `lerEstadoDoPinDeTodos` (as duas são RPC): é uma linha por
 * conta, e as contas de um ponto costumam ficar muito abaixo do corte do
 * PostgREST.
 */
export async function lerContasDoPonto(): Promise<FuncionarioDoPainel[]> {
  const { data, error } = await supabase.rpc('ponto_contas')
  if (error) throw new ErroDoPainel(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(daConta)
}

/**
 * Uma linha de `ponto_contas()` vira gente da lista.
 *
 * O nome aqui é o RABO da regra única de `nomes.ts` — o nome guardado na conta,
 * depois o e-mail. A cabeça (a ficha de RH ligada à conta) entra por
 * `comNomesDasFichas`, em `lerGenteDoPainel`; até lá, `temFicha` é falso. O
 * `podeBater` também nasce falso: quem bate (ficha que libera OU super admin)
 * entra no mesmo lugar (`marcarQuemBate`).
 */
function daConta(conta: Record<string, unknown>): FuncionarioDoPainel {
  const nomeDaConta = typeof conta.nome === 'string' && conta.nome.trim() ? conta.nome.trim() : null
  const email = typeof conta.email === 'string' && conta.email.trim() ? conta.email.trim() : null
  return {
    usuarioId: conta.usuario_id as string,
    nome: nomeDeExibicao({ conta: nomeDaConta, email }, 'Sem nome'),
    nomeDaConta,
    email,
    podeBater: false,
    contaApagada: false,
    temFicha: false,
  }
}

/**
 * As contas do painel COM O NOME DA FICHA DE RH e o "pode bater" do banco do
 * ponto: ficha que libera OU super admin.
 *
 * As três leituras — `lerContasDoPonto`, `lerFichas` (a mesma da lista de
 * pessoas) e `lerSuperAdmins` — vão juntas, e `juntarGenteEFichas` (puro, em
 * `painel.ts`) dá o nome e o acesso.
 *
 * AS FICHAS SÃO PARTE DA CARGA, e não de melhor esforço: o CSV e a folha saem
 * daqui, e um CSV com o nome errado não avisa ninguém. Se uma leitura falhar,
 * a tela mostra o erro. A RLS deixa quem administra o ponto ler todas as
 * fichas e a lista de super admins.
 */
export async function lerGenteDoPainel(): Promise<GenteDoPainel> {
  const [contas, fichas, superAdmins] = await Promise.all([lerContasDoPonto(), lerFichas(), lerSuperAdmins()])
  return juntarGenteEFichas(contas, fichas, diaCivilDeHoje(), superAdmins)
}

/**
 * Conta -> nome de exibição de TODAS as contas do ponto, pela regra única
 * (ficha → nome guardado na conta → e-mail). É de onde saem os nomes de quem
 * decidiu um pedido (`pedidos.ts`) e de quem mediu o local (`lerNomeDaConta`).
 *
 * Só quem administra consegue ler (`ponto_contas()`): para os outros, a
 * leitura levanta, e quem chama decide o que fazer sem o nome.
 */
export async function lerNomesDasContas(): Promise<Map<string, string>> {
  const [contas, fichas] = await Promise.all([lerContasDoPonto(), lerFichas()])
  return new Map(
    comNomesDasFichas(contas, nomesDasFichas(fichas)).map((conta): [string, string] => [conta.usuarioId, conta.nome]),
  )
}

/**
 * O nome de UMA conta pela regra única — para "medido por" no local. Nulo
 * quando a conta não está mais na lista ou a sessão não a enxerga: a tela diz
 * "uma conta que não aparece na lista" em vez de quebrar por causa de um nome.
 * NUNCA LEVANTA.
 */
export async function lerNomeDaConta(usuarioId: string): Promise<string | null> {
  try {
    return (await lerNomesDasContas()).get(usuarioId) ?? null
  } catch {
    return null
  }
}

/**
 * Corrige o horário de uma batida que já existe.
 *
 * O QUE ESTA FUNÇÃO FAZ: um UPDATE de duas colunas.
 * O QUE O GATILHO FAZ SOZINHO: grava a linha de trilha em `ponto_correcoes`
 * com `valores_antes = to_jsonb(OLD)` (a linha inteira, o horário original
 * incluso), o autor (`auth.uid()`), o momento e a lista de campos alterados;
 * recalcula `dia_civil` a partir do horário novo; e liga `ajuste_manual`, que é
 * a marca que o funcionário passa a ver no próprio espelho.
 *
 * DUAS ARMADILHAS QUE ESTA ASSINATURA FECHA:
 *
 * 1. `motivo_ajuste` VAI JUNTO, SEMPRE. O gatilho lê `NEW.motivo_ajuste`, e num
 *    UPDATE que não menciona a coluna o `NEW` carrega o valor ANTIGO — nulo, na
 *    primeira correção. O banco recusaria com `23514`, e numa segunda correção
 *    a trilha herdaria o motivo da primeira, o que é pior: pareceria explicado.
 *
 * 2. HORÁRIO IGUAL NÃO É CORREÇÃO. Se `registrado_em` não muda, o gatilho vê
 *    zero campos alterados, sai antes de escrever a trilha e não liga
 *    `ajuste_manual` — o UPDATE "dá certo" sem corrigir nada. A recusa vem
 *    daqui, antes da viagem, com o motivo na tela.
 */
export async function corrigirHorario(entrada: {
  registroId: string
  momentoAnteriorISO: string
  momentoISO: string
  motivo: string
}): Promise<BatidaDoAdmin> {
  const motivo = entrada.motivo.trim()
  if (!motivo) {
    throw new ErroDoPainel('Toda correção exige um motivo escrito.')
  }
  if (new Date(entrada.momentoISO).getTime() === new Date(entrada.momentoAnteriorISO).getTime()) {
    throw new ErroDoPainel(
      'O horário informado é igual ao que já está gravado — não há o que corrigir.',
    )
  }

  const { data, error } = await supabase
    .from('ponto_registros')
    .update({ registrado_em: entrada.momentoISO, motivo_ajuste: motivo })
    .eq('id', entrada.registroId)
    .select(COLUNAS_DO_ADMIN)
    .single()

  if (error) throw new ErroDoPainel(error.message)
  return data as BatidaDoAdmin
}

/**
 * Insere a batida que a pessoa esqueceu de bater.
 *
 * INSERT DIRETO, e não `ponto_registrar_batida`: aquela função é a porta do
 * funcionário e exige PIN, coordenada válida e selfie já no bucket — nada disso
 * existe numa batida esquecida três dias atrás. A porta do admin é a policy
 * `"Ponto: so admin insere registro direto"`, com `WITH CHECK`
 * `auth.uid() IS NOT NULL AND ponto_pode_administrar()`.
 *
 * As colunas que NÃO vão aqui são tão importantes quanto as que vão: `tipo`,
 * `ordem_no_dia` e `dia_civil` são NOT NULL e mesmo assim ficam de fora, porque
 * quem os preenche é o gatilho — mandá-los daqui seria o app opinando sobre a
 * sequência do dia, e a sequência é do banco: o gatilho a decide pelo horário,
 * para quem bate e para quem insere.
 *
 * A linha nasce sem selfie, e é assim mesmo: não houve foto, e inventar uma
 * seria falsificar evidência. A tela diz "sem foto — inserida pelo admin".
 */
export async function inserirBatida(entrada: {
  usuarioId: string
  momentoISO: string
  motivo: string
}): Promise<BatidaDoAdmin> {
  const motivo = entrada.motivo.trim()
  if (!motivo) {
    throw new ErroDoPainel('Toda inserção de batida exige um motivo escrito.')
  }

  const { data, error } = await supabase
    .from('ponto_registros')
    .insert({
      usuario_id: entrada.usuarioId,
      registrado_em: entrada.momentoISO,
      motivo_ajuste: motivo,
    })
    .select(COLUNAS_DO_ADMIN)
    .single()

  if (error) throw new ErroDoPainel(error.message)
  return data as BatidaDoAdmin
}

/**
 * A trilha de correções de uma pessoa, da mais recente para a mais antiga.
 *
 * Vem inteira, e não filtrada pelo período: correção é rara (a tabela nasceu
 * vazia e cresce a passo de exceção), e uma batida de agosto corrigida em
 * setembro tem que aparecer nas duas telas. Quem separa por batida é a tela,
 * agrupando por `registro_id`.
 *
 * "Vem inteira" é exatamente o motivo de paginar: uma consulta sem recorte de
 * período é a que mais tende a crescer, e é a que menos tem quem perceba que
 * ficou pela metade.
 */
export async function lerCorrecoesDoUsuario(usuarioId: string): Promise<Correcao[]> {
  const data = await lerTodasAsPaginas(
    (de, ate) =>
      supabase
        .from('ponto_correcoes')
        .select(COLUNAS_DA_CORRECAO)
        .eq('usuario_id', usuarioId)
        .order('criado_em', { ascending: false })
        // Desempate: `criado_em` vem de `clock_timestamp()` e quase nunca
        // empata, mas pode (duas linhas no mesmo microssegundo, ou gravadas
        // por um script com o mesmo valor) — e empate em ORDER BY é ordem
        // indefinida, que numa consulta paginada vira linha repetida numa
        // página e sumida na outra.
        .order('id', { ascending: false })
        .range(de, ate),
    traduzirParaOPainel,
  )

  // A natureza é decidida aqui, uma vez: ausente vale 'admin' (`trilha.ts`).
  return (data as unknown as Record<string, unknown>[]).map(normalizarCorrecao)
}
