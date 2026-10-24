import { supabase } from './supabase'
import { lerTodasAsPaginas } from './paginacao'
import type { LocalizacaoDaBatida } from './coordenada'
import type {
  ConfiguracaoDoPonto,
  DadosDaEmpresa,
  DadosDoLocal,
  LocalDoPonto,
  RegrasDeJornada,
} from './configuracao'
import type { ConcessaoDeAdministracao, EstadoDoPin } from './pessoas'
import type { DadosDaFicha, FichaDoFuncionario } from './cadastro'
import { lerRespostaDoAcesso, type AcessoAoPonto } from './acesso'
import {
  ErroDeConta,
  falhaDoErroDaFuncao,
  lerFalhaDaFuncao,
  lerSucessoDaFuncao,
  type CorpoDoPedidoDeConta,
  type SucessoDeConta,
} from './contas'

/*
 * A CONVERSA DA ÁREA DE ADMINISTRAÇÃO COM O BANCO.
 *
 * DOIS MÓDULOS DE ADMIN, E A DIFERENÇA IMPORTA
 *   `admin.ts`         — o PAINEL DE FECHAMENTO: batidas, funcionários,
 *                        correção, inserção, trilha. Dados de jornada.
 *   `administracao.ts` — esta ÁREA DE ADMINISTRAÇÃO: o local de trabalho, os
 *                        dados da empresa, as regras de jornada, o comando das
 *                        pessoas — quem administra o ponto, quem é super admin
 *                        e o estado do PIN — e as FICHAS dos funcionários.
 *                        Dados de sistema, de permissão e de cadastro.
 * São ciclos de vida diferentes — um lê milhares de linhas por mês, o outro
 * escreve duas linhas por ano — e juntá-los faria a tela de configuração
 * arrastar a paginação, o CSV e a trilha de correções junto.
 *
 * A LISTA DE PESSOAS ATRAVESSA OS DOIS, e por isso ela é montada na tela: as
 * contas e as batidas vêm de `admin.ts` (`lerContasDoPonto`, que chama
 * `ponto_contas()`, e `lerBatidasDoPeriodo`), a administração e o PIN vêm
 * daqui, e quem costura as quatro é `montarPessoas`, em `pessoas.ts`, que é
 * puro e testado. Duplicar `lerContasDoPonto` aqui criaria duas leituras da
 * lista de contas no app, que divergiriam no primeiro ajuste feito de um lado só.
 *
 * As regras puras (faixas, leitura de campo, validação) moram em
 * `configuracao.ts`, sem React e sem Supabase, e são testadas lá. Aqui só há
 * ida e volta com o servidor.
 *
 * NENHUMA REGRA DE ACESSO MORA AQUI, E ISSO É DE PROPÓSITO
 * Quem decide que só quem administra o ponto escreve é a RLS, no Postgres, a
 * cada chamada — as policies, todas perguntando a
 * `public.ponto_pode_administrar()`:
 *
 *   SELECT ponto_configuracao  USING (auth.uid() IS NOT NULL AND ponto_ator_aprovado())
 *   INSERT ponto_configuracao  CHECK (ponto_pode_administrar())
 *   UPDATE ponto_configuracao  USING/CHECK (ponto_pode_administrar())
 *   SELECT ponto_local         USING (auth.uid() IS NOT NULL AND ponto_ator_aprovado())
 *   INSERT/UPDATE ponto_local  CHECK (ponto_pode_administrar())
 *   SELECT/INSERT/UPDATE/DELETE ponto_admins
 *                              USING/CHECK (auth.uid() IS NOT NULL
 *                                           AND ponto_pode_administrar())
 *   ponto_estado_do_pin()      levanta 42501 para quem não administra o ponto
 *   ponto_contas()             idem (a lista de contas)
 *   SELECT ponto_funcionarios  USING (ponto_pode_administrar())
 *                              OR    (usuario_id = auth.uid())
 *   INSERT/UPDATE ponto_funcionarios
 *                              CHECK (ponto_pode_administrar())
 *
 * A DE `ponto_funcionarios` TEM DUAS POLICIES DE SELECT, e elas se somam: quem
 * administra o ponto lê a lista inteira, e cada pessoa lê A PRÓPRIA FICHA. Uma
 * sessão de colaborador comum recebe daqui EXATAMENTE UMA linha — a sua —, e
 * não um erro: uma ficha, zero das outras, INSERT recusado pela RLS e DELETE
 * recusado por falta de privilégio (não existe GRANT de DELETE nessa tabela).
 *
 * A guarda de rota do app é conveniência de interface. Quem forçar
 * `/administracao` na URL vê a tela montar e cada gravação voltar recusada,
 * porque a decisão é do Postgres.
 *
 * O QUE O BANCO FAZ SOZINHO, E QUE ESTE MÓDULO NÃO REPETE
 * O gatilho `ponto_configuracao_normalizar` apara espaços, transforma texto
 * vazio em NULL, tira a máscara do CNPJ e sobe a UF para maiúscula. A tela já
 * manda tudo normalizado (por `validarEmpresa`), mas quem GARANTE é ele — um
 * update feito à mão pelo psql passa pelo mesmo caminho.
 */

/** Colunas explícitas em UMA linha: o supabase-js tipa a partir do literal. */
const COLUNAS_DA_CONFIGURACAO =
  'id, razao_social, nome_fantasia, cnpj, endereco, cidade, uf, carga_diaria_minutos, tolerancia_minutos, janela_duplicidade_segundos, atualizado_em'

const COLUNAS_DO_LOCAL = 'id, nome, latitude, longitude, raio_metros, ativo, medido_em, medido_por'

/**
 * A linha 1 de `ponto_configuracao`. A tabela tem `CHECK (id = 1)`, então
 * `WHERE id = 1` é o jeito de ler a configuração — e não `LIMIT 1`, que é a
 * forma de ler uma tabela de linha única que cala no dia em que ela deixar de
 * ser única.
 */
const ID_DA_CONFIGURACAO = 1

function traduzirErro(mensagem: string): string {
  /*
   * As restrições do banco vêm primeiro, e cada uma com a frase da SUA regra.
   * O nome da constraint viaja na mensagem do PostgREST — é ele que permite
   * dizer "a janela não pode ser menor que 10 segundos" em vez de despejar
   * `new row for relation ... violates check constraint ...` na tela.
   *
   * A tela já valida antes de enviar (`configuracao.ts`). Estas frases são
   * para os caminhos que a validação não cobre: outra aba com a tela antiga,
   * uma chamada direta, ou uma faixa que mudou no banco e ainda não na tela.
   */
  if (/ponto_configuracao_janela_protege/.test(mensagem)) {
    return 'O banco recusou a janela de duplicidade: ela precisa ficar entre 10 e 900 segundos. Desligar a proteção contra batida repetida não é configuração, é defeito.'
  }
  if (/ponto_configuracao_carga_diaria_razoavel/.test(mensagem)) {
    return 'O banco recusou a carga diária: ela precisa ficar entre 1h e 12h.'
  }
  if (/ponto_configuracao_tolerancia_razoavel/.test(mensagem)) {
    return 'O banco recusou a tolerância: ela precisa ficar entre 0 e 60 minutos.'
  }
  if (/ponto_configuracao_cnpj_com_14_digitos/.test(mensagem)) {
    return 'O banco recusou o CNPJ: ele guarda exatamente 14 dígitos, ou nada.'
  }
  if (/ponto_configuracao_uf_com_2_letras/.test(mensagem)) {
    return 'O banco recusou a UF: ela é a sigla de duas letras do estado.'
  }
  if (/ponto_configuracao_linha_unica/.test(mensagem)) {
    return 'A configuração é uma linha só, e o banco recusou uma segunda. Recarregue a página.'
  }
  if (/ponto_local_latitude_valida/.test(mensagem)) {
    return 'O banco recusou a latitude: ela precisa estar entre -90 e 90.'
  }
  if (/ponto_local_longitude_valida/.test(mensagem)) {
    return 'O banco recusou a longitude: ela precisa estar entre -180 e 180.'
  }
  if (/ponto_local_raio_positivo/.test(mensagem)) {
    return 'O banco recusou o raio: ele precisa ser maior que zero.'
  }
  if (/ponto_local_nome_preenchido/.test(mensagem)) {
    return 'O banco recusou o nome do local em branco.'
  }
  /*
   * AS RECUSAS DA FICHA DO FUNCIONÁRIO.
   *
   * As duas primeiras são as únicas desta lista que a tela NÃO consegue
   * prever: `validarFicha` confere o
   * formato do CPF, mas não sabe quais CPFs já estão cadastrados nem qual conta
   * já tem ficha. Quem sabe é o índice, no banco, no instante da gravação —
   * inclusive contra a outra aba que cadastrou a mesma pessoa meio segundo
   * antes.
   *
   * Cada uma diz O QUE FAZER, e não só o que aconteceu: a frase "já existe" sem
   * o "procure a ficha dela na lista" faz a pessoa cadastrar de novo com o CPF
   * trocado de propósito, que é o pior desfecho possível.
   */
  if (/ponto_funcionarios_cpf_unico_entre_ativos/.test(mensagem)) {
    return 'Já existe uma ficha ATIVA com este CPF. Duas fichas para a mesma pessoa emitiriam duas folhas da mesma jornada — procure a ficha dela na lista e edite aquela.'
  }
  if (/ponto_funcionarios_conta_unica/.test(mensagem)) {
    return 'Esta conta já está ligada a outra ficha. Uma conta bate ponto por uma ficha só: desligue o vínculo da outra ficha antes, ou escolha outra conta.'
  }
  if (/ponto_funcionarios_cpf_com_11_digitos/.test(mensagem)) {
    return 'O banco recusou o CPF: ele guarda exatamente 11 dígitos, ou nada.'
  }
  if (/ponto_funcionarios_nome_preenchido/.test(mensagem)) {
    return 'O banco recusou a ficha sem nome. É o nome completo que sai no papel que a pessoa assina.'
  }
  if (/ponto_funcionarios_desligamento_depois_da_admissao/.test(mensagem)) {
    return 'O banco recusou: o desligamento não pode ser anterior à admissão.'
  }
  /*
   * AS RECUSAS DO COMANDO DAS PESSOAS.
   *
   * Elas vêm ANTES das regras genéricas de RLS e de rede porque são as mais
   * específicas: a de sessão, logo abaixo, casa com "exclusiv" e engoliria
   * qualquer frase mais precisa. A ordem aqui é do mais específico para o mais
   * genérico, sempre.
   *
   * A PRIMEIRA É A MAIS IMPORTANTE. O gatilho
   * `trg_ponto_admins_guardar_regras` recusa a remoção do último administrador,
   * e a mensagem dele é boa — mas vem sem acento (sai de um `RAISE EXCEPTION`
   * numa migration) e não diz o que fazer na TELA. Deixá-la passar crua faria a
   * pessoa que acabou de se trancar do lado de fora ler português de banco.
   */
  if (/ficaria sem nenhum administrador/i.test(mensagem)) {
    return 'Este é o último administrador do ponto, e o banco recusa removê-lo: sem ninguém na lista, ninguém mais abriria esta tela. Conceda a administração a outra pessoa antes de revogar esta.'
  }
  if (/nao pode ser transferida/i.test(mensagem)) {
    return 'Uma concessão de administração não muda de dono. Conceda a administração à outra pessoa e depois revogue esta — assim a trilha de quem concedeu o quê continua certa.'
  }
  /*
   * A GUARDA DA FICHA.
   *
   * A ficha ativa ligada a uma conta LIBERA o ponto para ela, e o gatilho
   * `ponto_funcionarios_acesso_pelo_super_admin` recusa quem não é
   * super admin ao ligar, reativar ou tirar o desligamento. A frase dele vem
   * sem acento e não diz o que fazer na tela.
   */
  if (/exclusivo do super admin/i.test(mensagem)) {
    return 'Só o super admin libera o acesso ao ponto pela ficha: ligar a ficha a uma conta, reativá-la ou tirar o desligamento dá à conta o direito de bater ponto. Peça a ele, ou desfaça essa parte da edição.'
  }
  /*
   * Conceder, editar e revogar admin também são do super admin. A recusa da
   * RLS no INSERT chega com o nome da tabela.
   */
  if (/ponto_admins/i.test(mensagem) && /row-level security/i.test(mensagem)) {
    return 'O banco recusou: conceder e revogar a administração do ponto é exclusivo do super admin.'
  }
  if (/exclusiv[ao] de quem administra o ponto/i.test(mensagem)) {
    return 'Sua sessão não administra o ponto. Entre de novo; se persistir, peça a alguém da lista para conceder a administração.'
  }
  /*
   * A recusa da RLS: administrar o ponto é estar em `ponto_admins` (ou ser
   * super admin), e a frase diz isso.
   */
  if (/row-level security|violates row-level/i.test(mensagem)) {
    return 'O banco recusou: só quem administra o ponto pode alterar esta configuração.'
  }
  if (/permission denied|42501/i.test(mensagem)) {
    return 'Sua sessão não administra o ponto. Entre de novo; se persistir, peça a alguém da lista para conceder a administração.'
  }
  /*
   * "Nenhuma linha voltou" TEM DUAS CAUSAS, e a frase precisa admitir as duas.
   *
   * Com a sessão de quem não está na lista do ponto, um `UPDATE` recusado
   * pela policy NÃO levanta erro — ele
   * afeta ZERO linhas, em silêncio, e o `.single()` do supabase-js é que
   * reclama, com `PGRST116`. É o comportamento correto da RLS (esconder a
   * linha em vez de confirmar que ela existe), mas do lado de cá "não achei" e
   * "não posso" chegam idênticos.
   *
   * Dizer só "não foi encontrada" mandaria quem não administra o ponto
   * procurar um problema de dado que não existe. O `upsert` da empresa e da
   * jornada não cai aqui — ele passa pela policy de INSERT, que levanta
   * `row-level security` de verdade e é tratada acima.
   */
  if (/JSON object requested|multiple \(or no\) rows|PGRST116/i.test(mensagem)) {
    return 'O banco não devolveu a linha gravada. Ou ela não existe mais, ou sua sessão não administra o ponto — nesse caso a política de escrita recusa em silêncio, sem alterar nada. Recarregue a página.'
  }
  if (/fetch|network|Failed to fetch|NetworkError/i.test(mensagem)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  }
  return mensagem
}

/** Erro já traduzido para a tela da área de administração. */
export class ErroDeConfiguracao extends Error {
  constructor(mensagem: string) {
    super(traduzirErro(mensagem))
    this.name = 'ErroDeConfiguracao'
  }
}

/* ------------------------------------------------------------------ */
/* Quem administra o ponto                                             */
/* ------------------------------------------------------------------ */

/**
 * O acesso desta sessão ao ponto: se ela entra, de onde vem o acesso, se
 * administra, se é super admin, se bate ponto, e o nome e o cargo.
 *
 * A MESMA PERGUNTA QUE O BANCO FAZ, feita pelo app: `ponto_meu_acesso()`, no
 * banco do ponto, devolve `tem_acesso` = `ponto_ator_aprovado()` (ficha que
 * libera OU administra), `bate_ponto` (ficha que libera OU super admin — o que
 * a RPC de batida e o pedido em atraso exigem), `administra` =
 * `ponto_pode_administrar()`, `super_admin` = `ponto_sou_super_admin()`, e o
 * `nome` (ficha, nome guardado na conta, e-mail) e o `cargo` da ficha. É a
 * única leitura da conta além do PIN.
 *
 * ISTO NÃO PROTEGE NADA. É o que a guarda de rota usa para não desenhar uma
 * tela que não vai funcionar. Quem recusa cada leitura e gravação é a RLS, a
 * cada chamada. Resposta em formato inesperado vira ERRO (`lerRespostaDoAcesso`),
 * e não "sem acesso": falha fechada, com a tela de tentar de novo.
 */
export async function lerMeuAcesso(): Promise<AcessoAoPonto> {
  const { data, error } = await supabase.rpc('ponto_meu_acesso')
  if (error) throw new ErroDeConfiguracao(error.message)
  return lerRespostaDoAcesso(data)
}

/* ------------------------------------------------------------------ */
/* A configuração                                                      */
/* ------------------------------------------------------------------ */

interface LinhaDaConfiguracao {
  razao_social: string | null
  nome_fantasia: string | null
  cnpj: string | null
  endereco: string | null
  cidade: string | null
  uf: string | null
  carga_diaria_minutos: number
  tolerancia_minutos: number
  janela_duplicidade_segundos: number
  atualizado_em: string | null
}

function daLinha(linha: LinhaDaConfiguracao): ConfiguracaoDoPonto {
  return {
    razaoSocial: linha.razao_social,
    nomeFantasia: linha.nome_fantasia,
    cnpj: linha.cnpj,
    endereco: linha.endereco,
    cidade: linha.cidade,
    uf: linha.uf,
    cargaDiariaMinutos: linha.carga_diaria_minutos,
    toleranciaMinutos: linha.tolerancia_minutos,
    janelaDuplicidadeSegundos: linha.janela_duplicidade_segundos,
    atualizadoEm: linha.atualizado_em,
  }
}

/**
 * A configuração do ponto. Nula só se a linha não existir — o que só acontece
 * num banco sem a linha de configuração da instalação.
 *
 * `maybeSingle` e não `single`: `single` levanta quando não há linha, e "ainda
 * não configurado" não é erro de rede nem de permissão. A tela sabe montar o
 * formulário vazio e o primeiro salvar cria a linha.
 */
export async function lerConfiguracao(): Promise<ConfiguracaoDoPonto | null> {
  const { data, error } = await supabase
    .from('ponto_configuracao')
    .select(COLUNAS_DA_CONFIGURACAO)
    .eq('id', ID_DA_CONFIGURACAO)
    .maybeSingle()

  if (error) throw new ErroDeConfiguracao(error.message)
  if (!data) return null
  return daLinha(data as unknown as LinhaDaConfiguracao)
}

/**
 * Grava os dados da empresa e devolve a linha COMO O BANCO A GRAVOU.
 *
 * DEVOLVER A LINHA GRAVADA É O QUE RESOLVE O CASO DE BORDA DAS DUAS ABAS.
 * Se duas abas salvarem a configuração ao mesmo tempo, vence a última, e a
 * outra recarrega o valor gravado em vez de mostrar o seu. A tela
 * repõe os campos com o que volta daqui — então quem perdeu a corrida vê o
 * texto do outro, e não o próprio texto com cara de salvo.
 *
 * `upsert` e não `update`: o `update` numa tabela sem a linha "dá certo" e não
 * grava nada, sem erro nenhum. Com `upsert`, a primeira gravação num banco sem
 * semente cria a linha 1 — e as colunas de jornada nascem com o DEFAULT da
 * migration.
 */
export async function salvarEmpresa(dados: DadosDaEmpresa): Promise<ConfiguracaoDoPonto> {
  const { data, error } = await supabase
    .from('ponto_configuracao')
    .upsert(
      {
        id: ID_DA_CONFIGURACAO,
        razao_social: dados.razaoSocial,
        nome_fantasia: dados.nomeFantasia,
        cnpj: dados.cnpj,
        endereco: dados.endereco,
        cidade: dados.cidade,
        uf: dados.uf,
      },
      { onConflict: 'id' },
    )
    .select(COLUNAS_DA_CONFIGURACAO)
    .single()

  if (error) throw new ErroDeConfiguracao(error.message)
  return daLinha(data as unknown as LinhaDaConfiguracao)
}

/**
 * Grava as regras de jornada.
 *
 * A JANELA GRAVADA AQUI PASSA A VALER NA PRÓXIMA BATIDA, sem deploy: o gatilho
 * `ponto_carimbar_registro` lê `janela_duplicidade_segundos` desta linha a cada
 * INSERT. A regra mora no banco, e não no código.
 */
export async function salvarJornada(regras: RegrasDeJornada): Promise<ConfiguracaoDoPonto> {
  const { data, error } = await supabase
    .from('ponto_configuracao')
    .upsert(
      {
        id: ID_DA_CONFIGURACAO,
        carga_diaria_minutos: regras.cargaDiariaMinutos,
        tolerancia_minutos: regras.toleranciaMinutos,
        janela_duplicidade_segundos: regras.janelaDuplicidadeSegundos,
      },
      { onConflict: 'id' },
    )
    .select(COLUNAS_DA_CONFIGURACAO)
    .single()

  if (error) throw new ErroDeConfiguracao(error.message)
  return daLinha(data as unknown as LinhaDaConfiguracao)
}

/* ------------------------------------------------------------------ */
/* O local                                                             */
/* ------------------------------------------------------------------ */

interface LinhaDoLocal {
  id: string
  nome: string
  latitude: number
  longitude: number
  raio_metros: number
  /** Ver `LocalDoPonto.medidoEm`. */
  medido_em: string | null
  medido_por: string | null
}

function doLocal(linha: LinhaDoLocal): LocalDoPonto {
  return {
    id: linha.id,
    nome: linha.nome,
    latitude: linha.latitude,
    longitude: linha.longitude,
    raioMetros: linha.raio_metros,
    // `?? null`: uma resposta sem as colunas da medição não as traria — e
    // `undefined` na tela viraria "medido em Invalid Date".
    medidoEm: linha.medido_em ?? null,
    medidoPor: linha.medido_por ?? null,
  }
}

/**
 * O local ativo — o local de trabalho.
 *
 * `WHERE ativo` + `ORDER BY criado_em LIMIT 1` é a MESMA consulta que o gatilho
 * `ponto_carimbar_registro` faz para calcular a distância. Escrever outra aqui
 * abriria a chance de a tela editar um local e a batida medir por outro.
 *
 * O índice único parcial da tabela garante no máximo um ativo, então o
 * `LIMIT 1` é redundante hoje — e é ele que mantém a consulta igual à do
 * gatilho, que é o ponto.
 */
export async function lerLocalAtivo(): Promise<LocalDoPonto | null> {
  const { data, error } = await supabase
    .from('ponto_local')
    .select(COLUNAS_DO_LOCAL)
    .eq('ativo', true)
    .order('criado_em', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new ErroDeConfiguracao(error.message)
  if (!data) return null
  return doLocal(data as unknown as LinhaDoLocal)
}

/**
 * Grava o local. Atualiza o que existe, ou cria o primeiro.
 *
 * MEXER AQUI NÃO REESCREVE O PASSADO, e é bom lembrar por quê: cada batida
 * guarda `distancia_metros` e `no_local` calculados NA ÉPOCA, em colunas
 * próprias. Reduzir o raio hoje não transforma em "fora" nenhuma batida de
 * ontem.
 */
export async function salvarLocal(
  id: string | null,
  dados: DadosDoLocal,
): Promise<LocalDoPonto> {
  const valores = {
    nome: dados.nome,
    latitude: dados.latitude,
    longitude: dados.longitude,
    raio_metros: dados.raioMetros,
  }

  const consulta = id
    ? supabase.from('ponto_local').update(valores).eq('id', id)
    : supabase.from('ponto_local').insert({ ...valores, ativo: true })

  const { data, error } = await consulta.select(COLUNAS_DO_LOCAL).single()

  if (error) throw new ErroDeConfiguracao(error.message)
  return doLocal(data as unknown as LinhaDoLocal)
}

/*
 * O QUE A TELA DO LOCAL LÊ ALÉM DO LOCAL.
 *
 * As batidas dos últimos dias, só as três colunas que decidem "no local" ou
 * "fora" (`descreverLocalizacao`), para a porcentagem de "fora" com alerta. É a
 * pergunta que denuncia uma coordenada errada: com ela, 100% das batidas saem
 * "fora", e sem a porcentagem ninguém olharia para isso.
 *
 * Paginada como as leituras do painel (`lerTodasAsPaginas`): o PostgREST corta
 * em 1000 linhas calado, e a porcentagem de um mês cortado pela metade seria
 * um número com cara de certo. Quem lê tudo é quem administra o ponto (a RLS
 * das batidas); para outra sessão a lista volta só com as próprias.
 */
const COLUNAS_DA_LOCALIZACAO = 'id, registrado_em, distancia_metros, no_local, precisao_metros'

export async function lerLocalizacoesRecentes(dias: number): Promise<LocalizacaoDaBatida[]> {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
  const todas = await lerTodasAsPaginas(
    (de, ate) =>
      supabase
        .from('ponto_registros')
        .select(COLUNAS_DA_LOCALIZACAO)
        .gte('registrado_em', desde)
        // Ordem estável: sem ela, duas páginas podem repetir e pular linhas.
        .order('registrado_em', { ascending: true })
        .order('id', { ascending: true })
        .range(de, ate),
    (mensagem) => new ErroDeConfiguracao(mensagem),
  )
  return todas as unknown as LocalizacaoDaBatida[]
}

/* ------------------------------------------------------------------ */
/* O comando das pessoas                                               */
/* ------------------------------------------------------------------ */

const COLUNAS_DO_ADMINISTRADOR = 'usuario_id, concedido_por, concedido_em, observacao'

/**
 * Quem administra o ponto, lido de `public.ponto_admins`.
 *
 * ESTA CONSULTA É A ÚNICA DO APP QUE TOCA `ponto_admins` PARA LER A LISTA
 * INTEIRA. Um funcionário comum recebe ZERO linhas, e não um erro: a policy de
 * SELECT filtra em silêncio, que é o comportamento certo da RLS (esconder em vez
 * de confirmar que a linha existe). Por isso a tela nunca decide permissão a
 * partir daqui — para saber se a PRÓPRIA sessão administra, quem responde é
 * `lerMeuAcesso()`, que chama a RPC e não pode ser confundida com uma lista
 * vazia.
 *
 * PAGINA, como todas as leituras de lista do app: costumam ser poucas linhas e
 * o corte do PostgREST está longe — e no dia em que não estiver, quem some
 * calada é gente com permissão de ler a jornada de todo mundo.
 */
export async function lerAdministradores(): Promise<ConcessaoDeAdministracao[]> {
  const data = await lerTodasAsPaginas(
    (de, ate) =>
      supabase
        .from('ponto_admins')
        .select(COLUNAS_DO_ADMINISTRADOR)
        // Ordem estável, exigida pela paginação: `usuario_id` é a chave primária.
        .order('usuario_id', { ascending: true })
        .range(de, ate),
    (mensagem) => new ErroDeConfiguracao(mensagem),
  )

  return data.map((linha) => ({
    usuarioId: linha.usuario_id as string,
    concedidoPor: (linha.concedido_por as string | null) ?? null,
    concedidoEm: linha.concedido_em as string,
    observacao: (linha.observacao as string | null) ?? null,
  }))
}

/**
 * O estado do PIN de todo mundo, pela RPC `ponto_estado_do_pin`.
 *
 * POR QUE NÃO É UM `select` EM `ponto_pin`: aquela tabela é deny-all — RLS
 * ligada, zero policies, nenhum privilégio para `authenticated`.
 * Ela é o cofre do PIN, e a única porta é esta função `SECURITY DEFINER`, que
 * devolve `usuario_id`, `tem_pin`, `precisa_redefinir` e `bloqueado_ate` e
 * NUNCA o hash.
 *
 * A RECUSA VEM COMO ERRO, não como lista vazia — de propósito, e é o motivo de
 * a função do banco ser `plpgsql` em vez de `sql`. "Ninguém tem PIN" é uma
 * resposta plausível, que a tela mostraria sem desconfiar.
 */
export async function lerEstadoDoPinDeTodos(): Promise<EstadoDoPin[]> {
  const { data, error } = await supabase.rpc('ponto_estado_do_pin')
  if (error) throw new ErroDeConfiguracao(error.message)

  const linhas = (data ?? []) as {
    usuario_id: string
    tem_pin: boolean
    precisa_redefinir: boolean
    bloqueado_ate: string | null
  }[]

  return linhas.map((linha) => ({
    usuarioId: linha.usuario_id,
    temPin: linha.tem_pin === true,
    precisaRedefinir: linha.precisa_redefinir === true,
    bloqueadoAte: linha.bloqueado_ate,
  }))
}

/**
 * Concede a administração do ponto a alguém.
 *
 * ISTO DÁ ACESSO À JORNADA DE TODO MUNDO — ler as batidas de qualquer pessoa,
 * corrigir horário, inserir batida, resetar PIN, mudar a configuração e conceder
 * a administração a mais gente. No banco do ponto, administrar também deixa a
 * conta ENTRAR no app (`ponto_ator_aprovado()`), mesmo sem ficha — e não deixa
 * bater: quem bate é a ficha que libera ou o super admin.
 *
 * `concedido_por` VAI EXPLÍCITO, com o id da sessão. Não existe DEFAULT
 * `auth.uid()` na coluna (a primeira concessão, a da instalação, não tem
 * autor), e "quem deu esse acesso" é a primeira pergunta de qualquer auditoria
 * de permissão. O banco também CARIMBA o autor e a data por gatilho
 * (`ponto_admins_carimbar_concessao`), o que quer que o cliente mande; o valor
 * daqui continua indo, e é o mesmo que o gatilho grava.
 *
 * SÓ O SUPER ADMIN CONCEDE: a policy de INSERT exige `ponto_sou_super_admin()`,
 * e a tela só mostra o botão a ele.
 *
 * O AUTOR É LIDO AQUI DENTRO, e não recebido como parâmetro: um argumento a mais
 * é um argumento que alguém pode preencher errado, e a trilha de permissão é o
 * último lugar do sistema onde isso pode acontecer. `getSession()` e não
 * `getUser()` porque a primeira lê o token que já está na máquina — é a mesma
 * chamada que `AuthContext` faz — e a segunda gastaria uma ida ao servidor para
 * confirmar uma identidade que a RLS vai conferir de novo no INSERT logo abaixo.
 *
 * A OBSERVAÇÃO É TEXTO LIVRE E OPCIONAL. Ela é o que a lista mostra para
 * explicar por que aquela pessoa está ali, seis meses depois.
 */
export async function concederAdministracao(
  usuarioId: string,
  observacao: string | null,
): Promise<void> {
  const { data: sessao } = await supabase.auth.getSession()
  const autor = sessao.session?.user.id ?? null

  const { error } = await supabase.from('ponto_admins').insert({
    usuario_id: usuarioId,
    concedido_por: autor,
    observacao: observacao?.trim() || null,
  })

  if (error) throw new ErroDeConfiguracao(error.message)
}

/**
 * Revoga a administração do ponto de alguém.
 *
 * ⚠ REVOGAR O ÚLTIMO ADMINISTRADOR É RECUSADO PELO BANCO, e a recusa vem de dois
 * gatilhos (um de linha, para o caso comum, e um de comando, para o
 * `DELETE` sem WHERE). `traduzirErro` transforma a mensagem deles numa frase que
 * diz o que fazer. A tela NÃO tenta adivinhar isso antes: contar administradores
 * no navegador e esconder o botão criaria uma segunda regra, que discordaria da
 * do banco no instante em que outra aba concedesse ou revogasse.
 *
 * NÃO TIRA NADA ALÉM DA ADMINISTRAÇÃO. A pessoa continua batendo o próprio
 * ponto normalmente (se tiver ficha) — só deixa de ver o dos outros.
 *
 * ⚠ "NADA SAIU" NÃO É SUCESSO.
 * Revogar é do super admin (policy de DELETE com `ponto_sou_super_admin()`).
 * Para quem não é, a RLS ESCONDE a linha do DELETE: ele afeta ZERO linhas, SEM
 * ERRO — e a tela diria "não administra mais o ponto" para uma revogação que não
 * aconteceu. Por isso o DELETE devolve as linhas que saíram, e
 * zero vira erro com a frase das duas causas possíveis: a pessoa já não estava
 * na lista, ou a sessão não é super admin.
 */
export async function revogarAdministracao(usuarioId: string): Promise<void> {
  const { data, error } = await supabase
    .from('ponto_admins')
    .delete()
    .eq('usuario_id', usuarioId)
    .select('usuario_id')
  if (error) throw new ErroDeConfiguracao(error.message)
  if (!data || data.length === 0) {
    throw new ErroDeConfiguracao(
      'Nada foi revogado: ou esta pessoa já não estava na lista de administradores (outra aba revogou antes), ou sua sessão não é super admin — e revogar é só do super admin. Recarregue a lista.',
    )
  }
}

/**
 * Quem é super admin do ponto, lido de `public.ponto_super_admins`.
 *
 * A LISTA NÃO É ALTERÁVEL PELA API — nem pela chave de serviço; só por SQL do
 * dono do banco, no painel do Supabase (é assim que nasce o primeiro, por
 * `supabase/primeiro-super-admin.sql`). A tela só a lê, para marcar quem é
 * super admin e não oferecer a ele o que não faz sentido ou que a função de
 * contas recusa (revogar a administração de quem administra sempre, trocar o
 * e-mail de super admin, que também só muda direto no Supabase).
 *
 * Quem administra lê a lista inteira (policy "quem administra le os super
 * admins"); quem não administra lê, no máximo, a própria linha.
 */
export async function lerSuperAdmins(): Promise<string[]> {
  const data = await lerTodasAsPaginas(
    (de, ate) =>
      supabase
        .from('ponto_super_admins')
        .select('usuario_id')
        // Ordem estável, exigida pela paginação: `usuario_id` é a chave primária.
        .order('usuario_id', { ascending: true })
        .range(de, ate),
    (mensagem) => new ErroDeConfiguracao(mensagem),
  )
  return data.map((linha) => linha.usuario_id as string)
}

/* ------------------------------------------------------------------ */
/* As fichas dos funcionários do ponto                                 */
/* ------------------------------------------------------------------ */

/**
 * Colunas explícitas em UMA linha, como nas outras leituras deste arquivo: o
 * supabase-js tipa a partir do literal, e um `select('*')` faria o tipo do
 * retorno mudar sozinho no dia em que a tabela ganhar coluna.
 */
const COLUNAS_DA_FICHA =
  'id, usuario_id, nome_completo, cpf, matricula, cargo, admissao, desligamento, ctps, ctps_serie, centro_custo, ativo, bate_ponto_desde, atualizado_em'

interface LinhaDaFicha {
  id: string
  usuario_id: string | null
  nome_completo: string
  cpf: string | null
  matricula: string | null
  cargo: string | null
  admissao: string | null
  desligamento: string | null
  ctps: string | null
  ctps_serie: string | null
  centro_custo: string | null
  ativo: boolean
  bate_ponto_desde: string | null
  atualizado_em: string | null
}

function daFicha(linha: LinhaDaFicha): FichaDoFuncionario {
  return {
    id: linha.id,
    usuarioId: linha.usuario_id,
    nomeCompleto: linha.nome_completo,
    cpf: linha.cpf,
    matricula: linha.matricula,
    cargo: linha.cargo,
    admissao: linha.admissao,
    desligamento: linha.desligamento,
    ctps: linha.ctps,
    ctpsSerie: linha.ctps_serie,
    centroCusto: linha.centro_custo,
    ativo: linha.ativo === true,
    batePontoDesde: linha.bate_ponto_desde,
    atualizadoEm: linha.atualizado_em,
  }
}

/** O que vai no INSERT e no UPDATE. Uma função só, para os dois não divergirem. */
function paraOBanco(dados: DadosDaFicha) {
  return {
    usuario_id: dados.usuarioId,
    nome_completo: dados.nomeCompleto,
    cpf: dados.cpf,
    matricula: dados.matricula,
    cargo: dados.cargo,
    admissao: dados.admissao,
    desligamento: dados.desligamento,
    ctps: dados.ctps,
    ctps_serie: dados.ctpsSerie,
    centro_custo: dados.centroCusto,
    bate_ponto_desde: dados.batePontoDesde,
  }
}

/**
 * Todas as fichas, ativas e desativadas.
 *
 * AS DESATIVADAS VÊM JUNTO, e é de propósito: a ficha desativada é o cabeçalho
 * das folhas que a pessoa já assinou, e escondê-la da lista faria o admin achar
 * que ela sumiu — e cadastrar de novo, criando a duplicidade que o índice do
 * banco existe para impedir. Quem separa os dois grupos é `ordenarFichas`, na
 * tela.
 *
 * UMA SESSÃO DE COLABORADOR COMUM RECEBE UMA LINHA — a própria ficha —, e não
 * um erro. É a RLS escondendo, que é o comportamento certo. Por isso esta
 * consulta NUNCA decide permissão: quem responde "esta sessão administra o
 * ponto?" é `lerMeuAcesso()`.
 *
 * PAGINA, como todas as leituras de lista do app: as fichas costumam ficar
 * longe do corte do PostgREST — e no dia em que não ficarem, quem some calado
 * é um funcionário inteiro da folha do mês.
 */
export async function lerFichas(): Promise<FichaDoFuncionario[]> {
  const data = await lerTodasAsPaginas(
    (de, ate) =>
      supabase
        .from('ponto_funcionarios')
        .select(COLUNAS_DA_FICHA)
        // Ordem estável, exigida pela paginação: `id` é a chave primária. A
        // ordem que a tela mostra é outra, e quem a faz é `ordenarFichas`.
        .order('id', { ascending: true })
        .range(de, ate),
    (mensagem) => new ErroDeConfiguracao(mensagem),
  )

  return data.map((linha) => daFicha(linha as unknown as LinhaDaFicha))
}

/**
 * Cria ou edita uma ficha, e devolve a linha COMO O BANCO A GRAVOU.
 *
 * DEVOLVER A LINHA GRAVADA resolve o mesmo caso das duas abas da
 * configuração: vence a última gravação, e quem perdeu a corrida
 * recarrega o valor gravado em vez de mostrar o próprio texto com cara de
 * salvo. E resolve mais um, que só existe aqui: o gatilho de normalização do
 * banco apara espaços e tira a máscara do CPF, então o que volta pode não ser
 * byte a byte o que foi enviado — a tela mostra o que ficou.
 *
 * `update` E NÃO `upsert` quando há id: um `upsert` com id inexistente CRIARIA
 * uma ficha nova, silenciosamente, no dia em que duas abas apagassem/editassem
 * a mesma pessoa. Aqui o `update` que não acha linha volta como `PGRST116`, e
 * `traduzirErro` já sabe dizer que ou a linha sumiu, ou a sessão não administra
 * o ponto.
 */
export async function salvarFicha(
  id: string | null,
  dados: DadosDaFicha,
): Promise<FichaDoFuncionario> {
  const valores = paraOBanco(dados)

  const consulta = id
    ? supabase.from('ponto_funcionarios').update(valores).eq('id', id)
    : supabase.from('ponto_funcionarios').insert(valores)

  const { data, error } = await consulta.select(COLUNAS_DA_FICHA).single()

  if (error) throw new ErroDeConfiguracao(error.message)
  return daFicha(data as unknown as LinhaDaFicha)
}

/**
 * Desativa ou reativa uma ficha.
 *
 * ⚠ DESATIVAR NÃO É APAGAR, E APAGAR NÃO EXISTE. A tabela não tem policy de
 * DELETE e `authenticated` não tem o privilégio — não há caminho, nem por
 * chamada direta ao PostgREST. O motivo é do domínio, não da segurança: a ficha
 * é a identificação impressa em folhas já assinadas, e apagá-la deixaria o
 * papel do mês passado sem como ser reemitido.
 *
 * REATIVAR PODE SER RECUSADO, e a recusa é boa: se outra ficha ativa já tiver o
 * mesmo CPF, o índice parcial `ponto_funcionarios_cpf_unico_entre_ativos`
 * barra, e `traduzirErro` explica que a pessoa já tem ficha ativa na lista.
 */
export async function definirAtivoDaFicha(
  id: string,
  ativo: boolean,
): Promise<FichaDoFuncionario> {
  const { data, error } = await supabase
    .from('ponto_funcionarios')
    .update({ ativo })
    .eq('id', id)
    .select(COLUNAS_DA_FICHA)
    .single()

  if (error) throw new ErroDeConfiguracao(error.message)
  return daFicha(data as unknown as LinhaDaFicha)
}

/* ------------------------------------------------------------------ */
/* O vínculo entre ficha e conta                                       */
/* ------------------------------------------------------------------ */

/**
 * Liga uma ficha SEM CONTA a uma conta.
 *
 * ⚠ LIGAR É DAR ACESSO AO PONTO. A ficha ativa ligada a uma
 * conta faz `ponto_ator_aprovado()` responder sim para ela — ela passa a bater
 * ponto, definir PIN e subir selfie. Por
 * isso o gatilho `ponto_funcionarios_acesso_pelo_super_admin` recusa quem não é
 * super admin, e `traduzirErro` explica a recusa.
 *
 * SÓ LIGA SE A FICHA AINDA NÃO TIVER CONTA (`usuario_id IS NULL` no filtro): se
 * outra aba ligou a mesma ficha meio segundo antes, o UPDATE afeta zero linhas
 * e a ficha NÃO troca de dono em silêncio. Zero linhas volta como `PGRST116` do
 * `.single()`, e a frase daqui diz as duas causas possíveis.
 *
 * Mexe SÓ em `usuario_id`: o resto da ficha (nome completo, CPF, datas) fica
 * como está — é o cadastro de RH, e o vínculo não é lugar de editá-lo.
 */
export async function vincularFicha(fichaId: string, usuarioId: string): Promise<FichaDoFuncionario> {
  const { data, error } = await supabase
    .from('ponto_funcionarios')
    .update({ usuario_id: usuarioId })
    .eq('id', fichaId)
    .is('usuario_id', null)
    .select(COLUNAS_DA_FICHA)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ErroDeConfiguracao(
        'A ficha não foi ligada: ou ela já tem conta (outra aba ligou antes), ou sua sessão não pode mexer nela. Recarregue a lista e confira.',
      )
    }
    throw new ErroDeConfiguracao(error.message)
  }
  return daFicha(data as unknown as LinhaDaFicha)
}

/**
 * Desliga a ficha da conta. A ficha continua existindo (é o cabeçalho das
 * folhas já assinadas); a conta deixa de bater ponto POR ELA — se administra,
 * continua entrando para administrar; se é super admin, continua batendo (teste).
 *
 * É o lado seguro, e o banco deixa qualquer admin. A tela deixa só o super
 * admin, para o vínculo inteiro ficar com quem responde por ele (`pessoas.ts`).
 */
export async function desvincularFicha(fichaId: string): Promise<FichaDoFuncionario> {
  const { data, error } = await supabase
    .from('ponto_funcionarios')
    .update({ usuario_id: null })
    .eq('id', fichaId)
    .select(COLUNAS_DA_FICHA)
    .single()

  if (error) throw new ErroDeConfiguracao(error.message)
  return daFicha(data as unknown as LinhaDaFicha)
}

/* ------------------------------------------------------------------ */
/* As contas, pela Edge Function `ponto-contas`                        */
/* ------------------------------------------------------------------ */

/**
 * Quanto a tela espera a função. Criar conta passa pela Admin API do login e
 * pela trilha — segundos, não minutos. Acima disso a pessoa precisa de
 * uma frase, e não de um botão "Gravando…" para sempre.
 */
const PRAZO_DA_FUNCAO_MS = 30_000

/**
 * Pede uma ação de conta à Edge Function `ponto-contas`: criar conta,
 * trocar nome, trocar e-mail ou redefinir senha.
 *
 * QUEM DECIDE É A FUNÇÃO, NO SERVIDOR. Ela confere o token, pergunta ao banco
 * — com a sessão de quem chama — se é super admin, confere o pedido com a mesma
 * regra que a tela usou (`lib/contas.ts`), recusa e-mail repetido no login,
 * faz os passos com desfazer e grava a trilha sem a senha. A tela só
 * monta o corpo e lê a resposta.
 *
 * O TOKEN VAI SOZINHO: `supabase.functions.invoke` manda o `Authorization` da
 * sessão do app. Nenhuma chave de serviço passa perto do navegador.
 *
 * Sucesso volta como `SucessoDeConta`; qualquer recusa, como `ErroDeConta`, com
 * o código, o "onde" do e-mail repetido, a lista de frases e o aviso de "a ação
 * aconteceu, mas a trilha não gravou" — o que a tela precisa para decidir sem
 * ler a frase.
 */
export async function pedirAcaoDeConta(corpo: CorpoDoPedidoDeConta): Promise<SucessoDeConta> {
  const { data, error } = await supabase.functions.invoke('ponto-contas', {
    body: corpo,
    timeout: PRAZO_DA_FUNCAO_MS,
  })
  if (error) throw new ErroDeConta(await falhaDoErroDaFuncao(error))

  const sucesso = lerSucessoDaFuncao(data)
  if (!sucesso) throw new ErroDeConta(lerFalhaDaFuncao(200, data))
  return sucesso
}
