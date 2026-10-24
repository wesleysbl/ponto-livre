/*
 * A LISTA DE PESSOAS DA ÁREA DE ADMINISTRAÇÃO, EM FUNÇÕES PURAS.
 *
 * O QUE ESTA LISTA RESPONDE, e que sem ela exigiria abrir quatro lugares
 * diferentes: quem bate ponto, quem tem PIN, quem administra o ponto, quem
 * está travado por erro de PIN e quantas batidas cada um tem no período.
 *
 * POR QUE ISSO É UM MÓDULO E NÃO UM COMPONENTE
 * Mesmo motivo de `painel.ts`: a costura entre quatro consultas independentes
 * tem casos que dão errado CALADOS — gente que some da lista, gente marcada
 * como elegível a administrar com a conta apagada, um bloqueio de PIN que já
 * venceu mostrado como ativo. Nenhum deles levanta erro. Ou tem teste, ou não
 * é verificável.
 *
 * ⚠ NADA AQUI DECIDE PERMISSÃO. `elegivelParaAdministrar` é rótulo de tela: quem
 * recusa a concessão é a RLS de `ponto_admins`, e quem recusa a remoção do
 * último administrador é o gatilho `trg_ponto_admins_guardar_regras`, no banco.
 * Se este arquivo sumisse amanhã, as duas regras continuariam valendo.
 *
 * A CONTAGEM DE BATIDAS NÃO É A CONTA DE HORAS
 * De propósito. Quem soma horas é `horas.ts`, e o painel de fechamento
 * (`painel.ts`) já faz isso com as MESMAS funções que desenham o espelho do
 * funcionário. Aqui a pergunta é outra — "esta pessoa está usando o sistema?" —
 * e ela se responde com a contagem crua. Somar horas aqui abriria uma segunda
 * fórmula de jornada no app, que é exatamente o que `painel.ts` existe para
 * evitar.
 *
 * ---------------------------------------------------------------------------
 * PESSOAS NUMA TELA SÓ
 *
 * A lista é a de PESSOAS, e não só a de contas: cada linha junta a conta de
 * login, a FICHA do ponto ligada a ela, a administração (admin e super admin)
 * e o PIN. A ficha sem conta também é gente — é funcionária, tem folha, só não
 * bate ponto pelo celular — e entra na lista como pessoa sem conta, que é onde
 * o super admin a liga a uma conta.
 *
 * `acoesDaPessoa` decide quais botões a linha mostra para quem está olhando: o
 * super admin vê os de conta e de vínculo; o admin comum vê a lista, reseta PIN
 * e cuida do cadastro da ficha. É desenho de tela — quem recusa é o banco (RLS
 * de `ponto_admins`, o gatilho que guarda a ficha) e a Edge Function
 * `ponto-contas`, que pergunta ao banco se quem chama é super admin.
 * ---------------------------------------------------------------------------
 * AS CONTAS DO PONTO
 *
 * As contas vêm de `ponto_contas()`: o login de cada uma (id, e-mail, criação e
 * último login) e o nome guardado nela pela função de contas (`app_metadata`).
 * O banco do ponto só tem gente do ponto: toda conta da lista é do ponto.
 *
 * O ACESSO de cada um é o de `ponto_meu_acesso()`, em dois degraus:
 *   • ENTRAR no app: ficha que libera OU administra (origem 'ficha' ou
 *     'administracao'; a ficha ganha quando as duas valem);
 *   • BATER: ficha que libera OU super admin.
 * Quem administra sem ficha e sem ser super admin (o RH, em geral) "SÓ ADMINISTRA —
 * NÃO BATE PONTO" (`soAdministra`): não é pendência de acesso nem de PIN, e
 * fica no fim do grupo dos administradores.
 * ---------------------------------------------------------------------------
 */
import { diaCivilDeHoje, formatarMomento } from './formato'
import type { BatidaDoAdmin } from './formato'
import type { FuncionarioDoPainel } from './painel'
import { ordenarFichas, type FichaDoFuncionario } from './cadastro'
import type { OrigemDoAcesso, PapelNaAdministracao } from './acesso'
import type { ContaParaVinculo } from './vinculo'
import {
  comNomeGravado,
  comNomesDasFichas,
  fotografiaDasBatidas,
  nomesDasFichas,
  pessoaForaDaLista,
  SEM_NOME,
  type FotografiaDaBatida,
} from './nomes'

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

/**
 * Uma linha de `ponto_estado_do_pin()`.
 *
 * O QUE NÃO EXISTE AQUI: hash, versão do hash e contador de tentativas. A função
 * do banco não os devolve. O tipo espelha isso de
 * propósito: se um dia alguém acrescentar o hash à RPC, o TypeScript não vai
 * pedir para ele aparecer nesta tela.
 */
export interface EstadoDoPin {
  usuarioId: string
  /** Existe linha em `ponto_pin`. Espelha `ponto_pin_status().definido`. */
  temPin: boolean
  /** Ligado pelo reset do admin. Enquanto verdadeiro, o PIN atual não serve. */
  precisaRedefinir: boolean
  /** ISO 8601 do fim da trava — inclusive quando ela já venceu. Ver `situacaoDoPin`. */
  bloqueadoAte: string | null
}

/** Uma linha de `public.ponto_admins`. */
export interface ConcessaoDeAdministracao {
  usuarioId: string
  /** Quem concedeu. Nulo na concessão da instalação — não houve quem concedesse. */
  concedidoPor: string | null
  concedidoEm: string
  observacao: string | null
}

/**
 * Os TRÊS rótulos de PIN que a tela mostra.
 *
 * União discriminada, e não três booleanos, porque os estados se excluem e a
 * tela precisa escolher uma cor. Três booleanos permitiriam desenhar "sem PIN e
 * bloqueado ao mesmo tempo", que não é um estado do sistema.
 */
export type SituacaoDoPin =
  | { estado: 'bloqueado'; texto: string; bloqueadoAte: string }
  | { estado: 'sem-pin'; texto: string }
  | { estado: 'com-pin'; texto: string }

/** Uma pessoa na lista da área de administração. */
export interface PessoaDaAdministracao {
  /**
   * A chave estável da linha: a conta, ou `ficha:<id>` para a ficha sem conta.
   * Duas fontes de linha precisam de uma chave que não colida.
   */
  chave: string
  /**
   * A conta de login. NULO = pessoa só com ficha: funcionária com folha, sem
   * conta para bater ponto pelo celular.
   */
  usuarioId: string | null
  nome: string
  email: string | null
  /**
   * A conta aparece (por batida, concessão, super admin ou ficha), mas não está
   * mais entre as do ponto (`ponto_contas()`): foi apagada. Ver `painel.ts`.
   */
  contaApagada: boolean
  /** Está em `public.ponto_admins`. */
  administra: boolean
  /**
   * Está em `public.ponto_super_admins`: administra sempre, mesmo
   * fora de `ponto_admins`, e é quem escolhe os admins e mexe em contas. A
   * lista não muda pelo app: só por SQL do dono do banco, no painel do
   * Supabase (é assim que nasce o primeiro, por
   * `supabase/primeiro-super-admin.sql`).
   */
  superAdmin: boolean
  /**
   * De onde vem o acesso desta conta ao ponto — o espelho de
   * `ponto_meu_acesso().origem`: 'ficha' quando a ficha libera (ganha quando as
   * duas valem), 'administracao' quando só administra (lista de admins ou
   * super admin), nulo quando nada libera ou quando não há conta. Entrar não é
   * bater: ver `soAdministra`.
   */
  acesso: OrigemDoAcesso | null
  /**
   * A ficha do ponto ligada a esta conta — ou, na pessoa sem conta, a própria
   * ficha. A ativa vem antes da desativada.
   */
  ficha: FichaDoFuncionario | null
  /**
   * Quantas fichas apontam para esta conta. Mais de uma é dado que o índice do
   * banco não deveria deixar existir, e a tela avisa em vez de escolher calada.
   */
  fichasDaConta: number
  /**
   * Pode RECEBER a administração do ponto pela tela.
   *
   * Falso para a conta apagada, e o motivo é do banco: `ponto_admins.usuario_id`
   * tem FK para `auth.users` com `ON DELETE CASCADE`. Conceder administração a
   * uma conta que não existe é criar uma permissão que ninguém consegue
   * exercer e que ninguém lembra de revogar.
   */
  elegivelParaAdministrar: boolean
  /** Nulo na pessoa sem conta: sem conta não há PIN, nem a definir. */
  pin: SituacaoDoPin | null
  /** Quantas batidas esta pessoa tem no período escolhido na tela. */
  batidas: number
  /** A linha de `ponto_admins`, quando existe: quem concedeu, quando e por quê. */
  concessao: ConcessaoDeAdministracao | null
}

/* ------------------------------------------------------------------ */
/* O rótulo do PIN                                                     */
/* ------------------------------------------------------------------ */

/**
 * O estado do PIN de uma pessoa, em uma frase.
 *
 * A ORDEM DAS TRÊS PERGUNTAS É A REGRA, e ela não é arbitrária:
 *
 * 1. BLOQUEADO VEM PRIMEIRO porque é o único estado com prazo — a pessoa está
 *    parada agora e volta sozinha às tantas horas. É a informação que faz
 *    alguém agir (resetar) ou não agir (esperar), e escondê-la atrás de outro
 *    rótulo transformaria uma trava curta num chamado. A trava cresce com os
 *    bloqueios do mesmo dia (15 minutos no primeiro, 1 hora no segundo, 24
 *    horas do terceiro em diante), e o reset solta qualquer uma delas na hora.
 *
 * 2. SEM PIN inclui quem tem PIN mas precisa redefinir, e isto é deliberado.
 *    `RotaProtegida` manda para `/definir-pin` quem tem
 *    `!definido || precisa_redefinir` — ou seja, os dois casos levam à MESMA
 *    tela na próxima entrada. Chamar o segundo de "com PIN" seria descrever a
 *    linha da tabela em vez do que a pessoa vai encontrar. Os textos são
 *    diferentes, porque as causas são diferentes.
 *
 * 3. COM PIN é o que sobra.
 *
 * A TRAVA VENCIDA NÃO É TRAVA. `ponto_estado_do_pin()` devolve `bloqueado_ate`
 * cru, inclusive no passado — quem compara com o relógio é esta função, e é por
 * isso que ela recebe `agora` como argumento em vez de chamar `Date.now()`. Sem
 * isso, o teste do bloqueio dependeria do relógio da máquina e a tela mostraria
 * "bloqueado até as 10:32" às 14h.
 *
 * `estado` AUSENTE é "sem PIN": a função do banco devolve uma linha por linha de
 * `ponto_pin`, e quem nunca definiu um não aparece lá.
 */
export function situacaoDoPin(
  estado: EstadoDoPin | undefined,
  agora: number = Date.now(),
): SituacaoDoPin {
  if (!estado || !estado.temPin) {
    return { estado: 'sem-pin', texto: 'sem PIN — define na próxima entrada' }
  }

  const bloqueado = estado.bloqueadoAte
  if (bloqueado && new Date(bloqueado).getTime() > agora) {
    return {
      estado: 'bloqueado',
      bloqueadoAte: bloqueado,
      texto: `bloqueado por erro de PIN até ${formatarMomento(bloqueado)}`,
    }
  }

  if (estado.precisaRedefinir) {
    return { estado: 'sem-pin', texto: 'reset pedido — define um PIN novo na próxima entrada' }
  }

  return { estado: 'com-pin', texto: 'PIN definido' }
}

/* ------------------------------------------------------------------ */
/* A costura                                                           */
/* ------------------------------------------------------------------ */

/** Ordem alfabética de gente de verdade: acento não vai para o fim da lista. */
const POR_NOME = new Intl.Collator('pt-BR', { sensitivity: 'base' })

/**
 * A ficha libera o acesso ao ponto? A MESMA regra de
 * `ponto_ficha_libera_acesso(uuid)`: ficha ativa, ligada a uma conta, e sem
 * desligamento passado — no dia do desligamento a pessoa ainda bate a saída.
 * `hoje` é o dia civil no fuso do ponto (`AAAA-MM-DD`), e a comparação é de
 * texto: o formato ordena igual à data, sem `Date` e sem fuso na conta.
 */
export function fichaLiberaAcesso(ficha: FichaDoFuncionario, hoje: string): boolean {
  return (
    ficha.usuarioId !== null &&
    ficha.ativo &&
    (ficha.desligamento === null || ficha.desligamento >= hoje)
  )
}

/**
 * Junta contas, fichas, administradores, super admins, estado de PIN e
 * batidas numa lista só.
 *
 * QUEM ENTRA NA LISTA, E POR QUÊ NINGUÉM SOME
 *
 * 1. TODA CONTA que `lerContasDoPonto` trouxe (`ponto_contas()`) — inclusive a
 *    que ainda não tem ficha nem administra, porque ligar a ficha é uma das
 *    ações desta tela e ninguém liga a ficha de quem não vê.
 *
 * 2. QUEM TEM BATIDA MAS A CONTA NÃO EXISTE MAIS, com `contaApagada`. Mesmo
 *    desenho de `montarLinhasDoPainel`: a batida sobrevive ao desligamento de
 *    propósito (é prova trabalhista), e o nome vem da ficha ou do que o banco
 *    congelou na própria batida.
 *
 * 3. QUEM ESTÁ EM `ponto_admins` MAS NÃO ESTÁ NA LISTA DE CONTAS, também com
 *    `contaApagada`. A FK de `ponto_admins` para `auth.users` deveria impedir,
 *    mas uma concessão viva que ninguém vê seria uma permissão que ninguém
 *    revoga: se acontecer, ela aparece.
 *
 * 4. O SUPER ADMIN e A CONTA LIGADA A UMA FICHA, mesmo fora da lista
 *    — pelo mesmo motivo do item 3.
 *
 * O NOME de toda conta é o da regra única de `nomes.ts`: a ficha ligada,
 * depois o nome guardado na conta, depois o nome congelado na batida, depois
 * o e-mail.
 *
 * 5. A FICHA SEM CONTA, como pessoa sem conta (`usuarioId` nulo). É
 *    funcionária, tem folha — e é aqui que o super admin a liga a uma conta.
 *
 * `hoje` (dia civil no fuso do ponto) e `agora` são injetados para os rótulos de
 * acesso e de bloqueio serem testáveis sem relógio.
 */
export function montarPessoas(entrada: {
  /** As contas do ponto (`lerContasDoPonto`, de `ponto_contas()`). */
  funcionarios: FuncionarioDoPainel[]
  administradores: ConcessaoDeAdministracao[]
  estadosDoPin: EstadoDoPin[]
  batidas: BatidaDoAdmin[]
  /** As fichas do ponto. Sem elas, a lista é só a de contas. */
  fichas?: FichaDoFuncionario[]
  /** Os `usuario_id` de `ponto_super_admins`. */
  superAdmins?: string[]
  /** O dia civil no fuso do ponto, `AAAA-MM-DD`. */
  hoje?: string
  /** O relógio, injetado para o rótulo de bloqueio ser testável. */
  agora?: number
}): PessoaDaAdministracao[] {
  const agora = entrada.agora ?? Date.now()
  const hoje = entrada.hoje ?? diaCivilDeHoje()
  const fichas = entrada.fichas ?? []
  const superAdmins = new Set(entrada.superAdmins ?? [])

  const contagem = new Map<string, number>()
  const batidasDaConta = new Map<string, FotografiaDaBatida[]>()
  for (const batida of entrada.batidas) {
    contagem.set(batida.usuario_id, (contagem.get(batida.usuario_id) ?? 0) + 1)
    batidasDaConta.set(batida.usuario_id, [...(batidasDaConta.get(batida.usuario_id) ?? []), batida])
  }
  /*
   * O NOME DE CADA UM É O DA REGRA ÚNICA (`nomes.ts`): a ficha ligada à
   * conta, depois o nome guardado na conta, depois o e-mail. Sem a ficha, uma
   * conta de função mostraria o nome do dono anterior, e a lista ordenaria a
   * pessoa pela letra errada.
   */
  const nomesDeFicha = nomesDasFichas(fichas)

  const concessoes = new Map(entrada.administradores.map((linha) => [linha.usuarioId, linha]))
  const pins = new Map(entrada.estadosDoPin.map((linha) => [linha.usuarioId, linha]))
  const naLista = new Set(entrada.funcionarios.map((pessoa) => pessoa.usuarioId))

  /* As fichas de cada conta, a ativa primeiro (`ordenarFichas`). */
  const fichasDaConta = new Map<string, FichaDoFuncionario[]>()
  for (const ficha of ordenarFichas(fichas)) {
    if (ficha.usuarioId === null) continue
    fichasDaConta.set(ficha.usuarioId, [...(fichasDaConta.get(ficha.usuarioId) ?? []), ficha])
  }

  /* As fontes de gente fora da lista de contas: batidas, concessões, super
     admins e fichas ligadas. Um `Set` porque várias podem apontar para a mesma
     pessoa. */
  const orfaos: FuncionarioDoPainel[] = []
  const jaVistos = new Set<string>()
  for (const usuarioId of [
    ...contagem.keys(),
    ...concessoes.keys(),
    ...superAdmins,
    ...fichasDaConta.keys(),
  ]) {
    if (naLista.has(usuarioId) || jaVistos.has(usuarioId)) continue
    jaVistos.add(usuarioId)
    // A ficha da conta, o nome congelado na batida, o e-mail congelado.
    const batidas = batidasDaConta.get(usuarioId)
    orfaos.push(
      pessoaForaDaLista(
        usuarioId,
        nomesDeFicha,
        batidas ? fotografiaDasBatidas(batidas) : null,
        'Conta que não existe mais',
      ),
    )
  }

  // O nome gravado nas batidas vem antes do e-mail para quem não tem ficha
  // nem nome guardado na conta (a regra inteira de `nomes.ts`).
  const contasComNome = comNomesDasFichas(entrada.funcionarios, nomesDeFicha).map((funcionario) => {
    const batidas = batidasDaConta.get(funcionario.usuarioId)
    return comNomeGravado(funcionario, batidas ? fotografiaDasBatidas(batidas) : null)
  })

  const contas = [...contasComNome, ...orfaos].map(
    (funcionario): PessoaDaAdministracao => {
      const concessao = concessoes.get(funcionario.usuarioId) ?? null
      const superAdmin = superAdmins.has(funcionario.usuarioId)
      const ligadas = fichasDaConta.get(funcionario.usuarioId) ?? []
      // O banco pergunta "EXISTE ficha que libera" — qualquer uma das ligadas.
      const pelaFicha = ligadas.some((ficha) => fichaLiberaAcesso(ficha, hoje))
      // `ponto_pode_administrar()`: a lista de admins OU super admin.
      const administraOPonto = concessao !== null || superAdmin
      return {
        chave: funcionario.usuarioId,
        usuarioId: funcionario.usuarioId,
        nome: funcionario.nome,
        email: funcionario.email,
        contaApagada: funcionario.contaApagada,
        administra: concessao !== null,
        superAdmin,
        acesso: pelaFicha ? 'ficha' : administraOPonto ? 'administracao' : null,
        ficha: ligadas[0] ?? null,
        fichasDaConta: ligadas.length,
        elegivelParaAdministrar: !funcionario.contaApagada,
        pin: situacaoDoPin(pins.get(funcionario.usuarioId), agora),
        batidas: contagem.get(funcionario.usuarioId) ?? 0,
        concessao,
      }
    },
  )

  const semConta = fichas
    .filter((ficha) => ficha.usuarioId === null)
    .map(
      (ficha): PessoaDaAdministracao => ({
        chave: `ficha:${ficha.id}`,
        usuarioId: null,
        nome: ficha.nomeCompleto,
        email: null,
        contaApagada: false,
        administra: false,
        superAdmin: false,
        acesso: null,
        ficha,
        fichasDaConta: 1,
        elegivelParaAdministrar: false,
        pin: null,
        batidas: 0,
        concessao: null,
      }),
    )

  return [...contas, ...semConta].sort(ordenar)
}

/**
 * Entra no app e NÃO bate ponto: administra (lista de admins), sem ficha que
 * libere e sem ser super admin — o RH, em geral. É o estado "só administra —
 * não bate ponto": não é pendência de acesso (a conta entra) nem de PIN, e não
 * é defeito — se um dia a pessoa precisar bater, ganha uma ficha.
 */
export function soAdministra(pessoa: PessoaDaAdministracao): boolean {
  return pessoa.usuarioId !== null && pessoa.acesso === 'administracao' && !pessoa.superAdmin
}

/**
 * A conta não entra no ponto e ninguém decidiu isso: tem conta (que existe),
 * nenhum acesso e nenhuma ficha. É a pendência "sem acesso ao ponto" — cada
 * uma é alguém que abre o app e não consegue entrar, e o caminho é o super
 * admin ligar a ficha.
 *
 * A CONTA COM FICHA DESATIVADA OU DESLIGADA NÃO É PENDÊNCIA: ficou sem acesso
 * porque o RH a desligou — quem saiu da empresa, guardada só pelo histórico.
 * Ela continua com a etiqueta "sem acesso ao ponto", que é verdade, mas não
 * vira alerta no resumo todo dia.
 */
export function semAcessoPendente(pessoa: PessoaDaAdministracao): boolean {
  return pessoa.usuarioId !== null && !pessoa.contaApagada && pessoa.acesso === null && pessoa.ficha === null
}

/**
 * Quem administra primeiro (quem só administra no fim desse grupo), depois
 * quem está sem acesso pendente, depois o resto, e as fichas sem conta no fim.
 *
 * A ORDEM É A PAUTA DA TELA. A lista de permissão é a única coisa aqui que se
 * confere de cima a baixo, e por isso abre a lista. Dentro dela, quem bate vem
 * antes de quem só administra. Logo abaixo vem a conta SEM ACESSO
 * pendente (`semAcessoPendente`), porque é a ação a fazer.
 *
 * As FICHAS SEM CONTA vêm depois das contas: são pendência de vínculo, que o
 * super admin resolve uma a uma, e a ficha desativada sem conta é histórico —
 * fica por último.
 *
 * Dentro de cada grupo, alfabético: é o que faz a lista ser navegável, porque
 * a pessoa sabe mais ou menos onde procurar.
 */
function ordenar(a: PessoaDaAdministracao, b: PessoaDaAdministracao): number {
  const grupo = (pessoa: PessoaDaAdministracao) => {
    if (pessoa.administra || pessoa.superAdmin) return soAdministra(pessoa) ? 1 : 0
    if (semAcessoPendente(pessoa)) return 2
    if (pessoa.usuarioId !== null) return 3
    if (pessoa.ficha?.ativo) return 4
    return 5
  }
  return grupo(a) - grupo(b) || POR_NOME.compare(a.nome, b.nome)
}

/* ------------------------------------------------------------------ */
/* O filtro                                                            */
/* ------------------------------------------------------------------ */

/**
 * Filtra a lista por nome, e-mail ou pelo que a ficha tem: nome completo,
 * cargo, CPF e matrícula.
 *
 * POR QUE ISTO EXISTE: rolar a lista até "Vanessa" para resetar um PIN, num
 * celular, é o tipo de atrito que faz o admin voltar a pedir por WhatsApp.
 *
 * SEM ACENTO E SEM CAIXA. Quem digita "jose" tem que achar "José" — a
 * decomposição NFD seguida da remoção das marcas diacríticas é o jeito de fazer
 * isso sem manter uma tabela de trocas. Vale para os dois lados da comparação,
 * senão "José" digitado com acento deixaria de achar o próprio nome.
 *
 * O CPF E A MATRÍCULA SÃO COMPARADOS SÓ POR DÍGITOS (como `filtrarFichas`):
 * quem digita `529.982` acha a ficha guardada como `52998224725`. E o nome da
 * FICHA conta à parte do nome da conta: a conta pode dizer "Bia" e a ficha
 * "Ana Beatriz Rocha".
 */
export function filtrarPessoas(
  pessoas: PessoaDaAdministracao[],
  busca: string,
): PessoaDaAdministracao[] {
  const alvo = normalizar(busca)
  if (alvo === '') return pessoas
  const digitos = busca.replace(/\D/g, '')
  return pessoas.filter((pessoa) => {
    if (normalizar(pessoa.nome).includes(alvo)) return true
    if (normalizar(pessoa.email ?? '').includes(alvo)) return true
    const ficha = pessoa.ficha
    if (!ficha) return false
    return (
      normalizar(ficha.nomeCompleto).includes(alvo) ||
      normalizar(ficha.cargo ?? '').includes(alvo) ||
      (digitos !== '' && (ficha.cpf ?? '').includes(digitos)) ||
      (digitos !== '' && (ficha.matricula ?? '').includes(digitos))
    )
  })
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/* ------------------------------------------------------------------ */
/* O resumo do topo                                                    */
/* ------------------------------------------------------------------ */

/**
 * Os números do cabeçalho da seção (e da página inicial da administração).
 *
 * A lista inteira é do ponto (as contas vêm de
 * `ponto_contas()`), e o resumo conta todo mundo. O que é PENDÊNCIA segue as
 * regras do banco do ponto:
 *   • "sem acesso": `semAcessoPendente` — conta sem acesso e sem ficha. Quem
 *     só administra entra (não é pendência), e a conta com a ficha desligada
 *     ficou sem acesso de propósito;
 *   • "sem PIN": quem entra no app e bate, sem PIN. Quem só administra não
 *     conta, nem quem não entra — o PIN de quem não tem
 *     acesso não é o problema dele, e contaria a mesma pessoa duas vezes.
 */
export function resumirPessoas(pessoas: readonly PessoaDaAdministracao[]): {
  total: number
  /** Admins e super admins. */
  administradores: number
  /** Contas sem acesso ao ponto e sem ficha (`semAcessoPendente`). */
  semAcesso: number
  /** Quem entra e bate, sem PIN (nem definido, nem depois de um reset). */
  semPin: number
  bloqueados: number
  /** Fichas ATIVAS sem conta: a pendência de vínculo. */
  fichasSemConta: number
  /** Fichas ativas sem "passou a bater ponto aqui em". Pendência de registro: a data não muda a batida nem a folha. */
  naoBatemAqui: number
} {
  const fichasAtivas = pessoas
    .map((pessoa) => pessoa.ficha)
    .filter((ficha): ficha is FichaDoFuncionario => ficha !== null && ficha.ativo)
  return {
    total: pessoas.length,
    administradores: pessoas.filter((pessoa) => pessoa.administra || pessoa.superAdmin).length,
    // A conta apagada fica de fora: ela não "falta liberar", e contá-la
    // criaria uma pendência que ninguém consegue resolver pela tela. A pessoa
    // sem conta também: a pendência dela é o vínculo, contado à parte.
    semAcesso: pessoas.filter(semAcessoPendente).length,
    semPin: pessoas.filter(
      (pessoa) =>
        pessoa.pin?.estado === 'sem-pin' &&
        !pessoa.contaApagada &&
        pessoa.acesso !== null &&
        !soAdministra(pessoa),
    ).length,
    bloqueados: pessoas.filter((pessoa) => pessoa.pin?.estado === 'bloqueado').length,
    fichasSemConta: pessoas.filter((pessoa) => pessoa.usuarioId === null && pessoa.ficha?.ativo)
      .length,
    naoBatemAqui: fichasAtivas.filter((ficha) => ficha.batePontoDesde === null).length,
  }
}

/* ------------------------------------------------------------------ */
/* As ações que a linha mostra                                         */
/* ------------------------------------------------------------------ */

/**
 * O que se pode pedir sobre uma pessoa, pela tela.
 *
 *   conta      — 'trocar-nome', 'trocar-email', 'redefinir-senha' (Edge Function
 *                `ponto-contas`), 'resetar-pin'
 *   admin      — 'conceder', 'revogar' (`ponto_admins`)
 *   ficha      — 'editar-ficha', 'desativar-ficha', 'reativar-ficha' (cadastro);
 *                'vincular-ficha', 'desvincular-ficha', 'criar-ficha' (ficha nova
 *                JÁ LIGADA à conta) e 'criar-conta' (conta nova para a ficha
 *                sem conta)
 */
export type AcaoSobrePessoa =
  | 'resetar-pin'
  | 'conceder'
  | 'revogar'
  | 'trocar-nome'
  | 'trocar-email'
  | 'redefinir-senha'
  | 'vincular-ficha'
  | 'desvincular-ficha'
  | 'criar-ficha'
  | 'criar-conta'
  | 'editar-ficha'
  | 'desativar-ficha'
  | 'reativar-ficha'

/**
 * As ações que são do super admin e de mais ninguém: criar conta com ficha,
 * editar nome e e-mail, redefinir senha, conceder e revogar admin, vincular
 * ficha.
 *
 * POR QUE CADA UMA É DELE, NO BANCO, E NÃO SÓ NA TELA
 *   • conta: a Edge Function pergunta `ponto_sou_super_admin()` com a sessão
 *     de quem chama, e responde 403 a qualquer outro;
 *   • admin: as policies de escrita de `ponto_admins` exigem
 *     `ponto_sou_super_admin()`;
 *   • ficha: LIGAR uma ficha ativa a uma conta libera o ponto para ela, e o
 *     gatilho `ponto_funcionarios_acesso_pelo_super_admin` recusa quem não é
 *     super admin. Desligar é o lado seguro e o banco
 *     deixa qualquer admin — a tela deixa só o super admin, para o vínculo
 *     inteiro (ligar e desligar) ficar com quem responde por ele.
 */
export const ACOES_DO_SUPER_ADMIN: readonly AcaoSobrePessoa[] = [
  'conceder',
  'revogar',
  'trocar-nome',
  'trocar-email',
  'redefinir-senha',
  'vincular-ficha',
  'desvincular-ficha',
  'criar-ficha',
  'criar-conta',
]

/**
 * As ações que a linha desta pessoa mostra para quem está olhando.
 *
 * O ADMIN COMUM vê a lista, reseta PIN e cuida do CADASTRO da ficha — nome
 * completo, CPF, cargo, desativar. Reativar a ficha LIGADA a uma conta é dar
 * acesso de novo, e por isso é do super admin (o mesmo gatilho da ficha).
 *
 * O SUPER ADMIN vê tudo isso e mais as ações de `ACOES_DO_SUPER_ADMIN`.
 *
 * `nenhum` (a leitura do papel não chegou, ou falhou) não vê ação nenhuma:
 * falha fechada.
 */
export function acoesDaPessoa(
  pessoa: PessoaDaAdministracao,
  papel: PapelNaAdministracao,
  /** A conta de quem está olhando: o super admin mexe na PRÓPRIA conta, nunca na de outro super admin. */
  eu: string | null = null,
): AcaoSobrePessoa[] {
  if (papel === 'nenhum') return []
  const superAdmin = papel === 'super_admin'
  const acoes: AcaoSobrePessoa[] = []
  const ficha = pessoa.ficha

  if (pessoa.usuarioId !== null) {
    acoes.push('resetar-pin')

    if (superAdmin) {
      /*
       * O MESMO ALVO QUE A FUNÇÃO ACEITA (`conferirAlvo` em
       * supabase/functions/ponto-contas/atendimento.ts): no banco só do ponto,
       * toda conta do login é do ponto; fica a regra de nunca mexer na conta
       * de OUTRO super admin. A conta
       * apagada não existe no login — a função responderia 404. A tela só não
       * oferece o botão que a função recusaria; quem recusa de verdade é ela.
       */
      const outroSuperAdmin = pessoa.superAdmin && pessoa.usuarioId !== eu
      if (!pessoa.contaApagada && !outroSuperAdmin) {
        acoes.push('trocar-nome')
        // A função recusa trocar o e-mail de super admin (409), até o próprio:
        // o e-mail é com o que a conta entra e recupera a senha, e a função o
        // troca sem confirmação. O de super admin só muda pela mão de quem tem
        // acesso ao projeto no Supabase.
        if (!pessoa.superAdmin) acoes.push('trocar-email')
        acoes.push('redefinir-senha')
      }
      // O super admin administra sempre; conceder ou revogar `ponto_admins`
      // para ele não muda nada do que ele pode, e a tela não oferece.
      if (!pessoa.superAdmin) {
        if (pessoa.administra) acoes.push('revogar')
        else if (pessoa.elegivelParaAdministrar) acoes.push('conceder')
      }
      if (ficha) acoes.push('desvincular-ficha')
      else if (!pessoa.contaApagada) acoes.push('vincular-ficha', 'criar-ficha')
    }
  } else if (superAdmin) {
    // A pessoa sem conta: ligar a uma conta que existe, ou criar a conta dela.
    acoes.push('vincular-ficha', 'criar-conta')
  }

  if (ficha) {
    acoes.push('editar-ficha')
    if (ficha.ativo) acoes.push('desativar-ficha')
    else if (ficha.usuarioId === null || superAdmin) acoes.push('reativar-ficha')
  }

  return acoes
}

/** As ações da seção inteira, fora de qualquer linha. */
export type AcaoGeral = 'nova-conta' | 'nova-ficha'

/**
 * 'nova-conta' (conta de login nova, com ficha) é do super admin; 'nova-ficha'
 * (ficha sem conta, só cadastro) é de qualquer admin.
 */
export function acoesGerais(papel: PapelNaAdministracao): AcaoGeral[] {
  if (papel === 'super_admin') return ['nova-conta', 'nova-ficha']
  if (papel === 'admin') return ['nova-ficha']
  return []
}

/* ------------------------------------------------------------------ */
/* Para a sugestão de vínculo                                          */
/* ------------------------------------------------------------------ */

/**
 * As contas que podem receber uma ficha: contas do ponto (`ponto_contas()`)
 * sem ficha nenhuma. É a lista da caixa de vínculo e das sugestões.
 *
 * A CONTA APAGADA FICA DE FORA: ela só aparece porque deixou batidas, e a
 * ficha aponta para `auth.users` — o banco recusaria o vínculo.
 */
export function contasSemFicha(pessoas: readonly PessoaDaAdministracao[]): ContaParaVinculo[] {
  return pessoas
    .filter(
      (pessoa): pessoa is PessoaDaAdministracao & { usuarioId: string } =>
        pessoa.usuarioId !== null && !pessoa.contaApagada && pessoa.ficha === null,
    )
    .map((pessoa) => ({ usuarioId: pessoa.usuarioId, nome: pessoa.nome, email: pessoa.email }))
}

/** O estado de quem administra e não bate (`soAdministra`): etiqueta e frase. */
export const ROTULO_SO_ADMINISTRA = 'só administra — não bate ponto'

/** A frase do acesso ao ponto de uma pessoa, para a linha aberta. */
export function textoDoAcesso(pessoa: PessoaDaAdministracao): string {
  if (pessoa.usuarioId === null) return 'sem conta — não bate ponto pelo celular'
  if (pessoa.contaApagada) return 'conta que não existe mais — não entra no ponto'
  if (pessoa.acesso === 'ficha') return 'bate ponto pela ficha'
  if (soAdministra(pessoa)) return ROTULO_SO_ADMINISTRA
  if (pessoa.acesso === 'administracao') return 'super admin — bate ponto só para teste'
  return 'sem acesso ao ponto'
}

/* ------------------------------------------------------------------ */
/* Quem resolve o que só o super admin faz                             */
/* ------------------------------------------------------------------ */

/** O que os textos dizem quando a lista não dá um nome só para o super admin. */
export const RESERVA_DO_SUPER_ADMIN = 'o super admin'

/**
 * O nome de quem resolve o que só o super admin faz, para os textos de quem
 * administra sem ser super admin: "Trocar e-mail, criar nova senha e liberar o
 * acesso: só Sérgio faz." "É do super admin" não diria a quem pedir.
 *
 * O NOME SAI DA PRÓPRIA LISTA (as pessoas com `superAdmin`), sem nome fixo no
 * código: a lista de super admins só muda por SQL do dono do banco, no painel
 * do Supabase (nunca pelo app), e o texto acompanha.
 *
 * DEDUPLICADO PELO PRIMEIRO NOME. A mesma pessoa pode ter duas contas de
 * super admin (`admin@` e `admin2@`), e o texto não pode dizer "só Sérgio ou
 * Sérgio".
 *
 * NOME QUE NÃO É NOME NÃO ENTRA. A conta sem ficha e sem nome guardado aparece
 * pelo e-mail (`nomes.ts`), e "só admin@example.com faz" não é frase. Se não
 * sobrar exatamente um nome — nenhum, ou duas pessoas diferentes —, a reserva é
 * "o super admin".
 */
export function quemEhOSuperAdmin(
  pessoas: readonly Pick<PessoaDaAdministracao, 'superAdmin' | 'contaApagada' | 'nome'>[],
): string {
  const nomes = new Set(
    pessoas
      .filter((pessoa) => pessoa.superAdmin && !pessoa.contaApagada)
      .map((pessoa) => pessoa.nome.trim())
      .filter((nome) => nome !== '' && nome !== SEM_NOME && !nome.includes('@'))
      .map((nome) => nome.split(/\s+/)[0]),
  )
  return nomes.size === 1 ? [...nomes][0] : RESERVA_DO_SUPER_ADMIN
}
