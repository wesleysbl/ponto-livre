/*
 * O NOME DE UMA PESSOA NA TELA — UMA REGRA SÓ.
 *
 * A ORDEM É: o nome da FICHA DE RH ligada à conta, depois o NOME GUARDADO NA
 * CONTA (`raw_app_meta_data->>'full_name'`, que `ponto_contas()` devolve),
 * depois o NOME GRAVADO NA BATIDA, depois o E-MAIL. Puro, sem React e sem
 * rede, para ser testado no Node. É a mesma ordem de `ponto_nome_da_conta()`
 * no banco do ponto (ficha → nome guardado → e-mail), com o gravado no meio.
 *
 * O DEFEITO QUE ISTO EVITA
 * Uma conta de ponto pode ser conta de FUNÇÃO (`vendas@`, `recepcao@`…), e o
 * nome guardado nela diz quem a usava antes: a Ana Beatriz, que hoje usa
 * `recepcao@`, apareceria no painel, na folha e no CSV com o nome de quem usava
 * a conta antes dela — e o RH, procurando a funcionária pelo nome, não acharia.
 *
 * POR QUE A FICHA VEM PRIMEIRO: ela é o cadastro de RH do ponto — o nome que a
 * folha assinada imprime e que o RH digitou. Conta de função muda de dono sem
 * que ninguém troque o nome guardado nela. A regra é "conta = pessoa": quem
 * saiu é desligado e quem entrou ganha conta nova, e a ficha ligada é quem diz
 * que pessoa é aquela conta. O nome guardado na conta é o de quem não tem ficha
 * — quem só administra, e o super admin —, e a função de contas o troca
 * ("Trocar o nome").
 *
 * O NOME GRAVADO NA BATIDA VEM ANTES DO E-MAIL.
 * O banco congela na batida o nome da conta no momento em que ela foi batida.
 * Se a conta perdeu o nome depois, ela apareceria pelo e-mail mesmo tendo, nas
 * próprias batidas, o nome de quem bateu. Ele NUNCA ganha da ficha nem do nome
 * guardado hoje: nas contas de função, o congelado pode ser o nome do dono
 * anterior, e é justamente o que a ficha corrige. E não se corrige no banco: a
 * batida é prova, e a trilha cobre tudo.
 *
 * A FICHA DESATIVADA OU DESLIGADA AINDA DÁ O NOME. O nome é de quem bateu, não
 * uma permissão: as batidas do mês do acerto de quem foi desligado continuam
 * sendo dela, e é justamente a folha desse mês que mais precisa do nome certo.
 * Quem decide acesso é o banco (`ponto_ficha_libera_acesso`), não este arquivo.
 *
 * QUEM USA ESTA REGRA, E COMO A FICHA CHEGA A CADA TELA
 *   • painel, tela da pessoa e folha: leem as contas do ponto
 *     (`ponto_contas()`, `admin.ts`) e as fichas (`lerFichas()`, a mesma
 *     leitura da lista de pessoas), e passam as contas por `comNomesDasFichas`
 *     (`juntarGenteEFichas`, em `painel.ts`); com as batidas do período na mão,
 *     `comNomeGravado` completa quem não tem ficha nem nome guardado. O CSV e o
 *     nome de quem aprovou, lançou, corrigiu ou mediu saem dessa mesma lista;
 *   • a pessoa que só aparece pela batida (conta que não existe mais) nasce por
 *     `pessoaForaDaLista`, com a mesma ordem: ficha, o nome gravado na batida,
 *     o e-mail gravado;
 *   • a lista de pessoas (`pessoas.ts`) já recebe as fichas e aplica a regra
 *     dentro de `montarPessoas`;
 *   • a caixa de pendências de atraso recebe do painel os nomes já resolvidos;
 *   • a saudação da tela de bater usa o `nome` de `ponto_meu_acesso()`, que o
 *     banco resolve pela mesma ordem (`acesso.ts`, `primeiroNomeDaConta`).
 */
import type { FichaDoFuncionario } from './cadastro'
import type { FuncionarioDoPainel } from './painel'

/** De onde o nome de uma pessoa pode vir, na ordem da regra. */
export interface FontesDoNome {
  /** `ponto_funcionarios.nome_completo` da ficha ligada à conta. */
  ficha?: string | null
  /**
   * O nome guardado na conta HOJE (`raw_app_meta_data->>'full_name'`, a coluna
   * `nome` de `ponto_contas()`).
   */
  conta?: string | null
  /**
   * `ponto_registros.funcionario_nome`: o nome que o banco congelou na batida
   * (a fotografia do nome da conta no dia em que ela foi batida).
   */
  gravado?: string | null
  /** O e-mail da conta (de `ponto_contas()`, ou o congelado na batida). */
  email?: string | null
}

/** Quando não há ficha, nome nem e-mail: rótulo honesto, e não um nome inventado. */
export const SEM_NOME = 'Conta sem nome nem e-mail'

/** Texto aparado; vazio vira nulo, para a próxima fonte da regra valer. */
function preenchido(texto: string | null | undefined): string | null {
  const aparado = texto?.trim()
  return aparado ? aparado : null
}

/**
 * O nome de exibição: ficha, depois o nome guardado na conta, depois o nome
 * gravado na batida, depois e-mail, depois `reserva`.
 *
 * Texto em branco não conta como nome ("   " guardado na conta não esconde o
 * e-mail): um cartão sem nome nenhum é pior do que um cartão com o e-mail.
 */
export function nomeDeExibicao(fontes: FontesDoNome, reserva: string = SEM_NOME): string {
  return (
    preenchido(fontes.ficha) ??
    preenchido(fontes.conta) ??
    preenchido(fontes.gravado) ??
    preenchido(fontes.email) ??
    reserva
  )
}

/**
 * Conta -> nome completo da ficha ligada a ela.
 *
 * O índice `ponto_funcionarios_conta_unica` deixa uma ficha por conta. Se um dia
 * houver duas (dado que o banco não deveria deixar existir), a ATIVA ganha da
 * desativada — a mesma escolha de `ordenarFichas` e da lista de pessoas — e,
 * entre iguais, a primeira que chegou. Ficha sem conta não dá nome a ninguém, e
 * ficha com nome em branco também não (a regra passa para o nome da conta).
 */
export function nomesDasFichas(
  fichas: readonly Pick<FichaDoFuncionario, 'usuarioId' | 'nomeCompleto' | 'ativo'>[],
): Map<string, string> {
  const escolhidas = new Map<string, { nome: string; ativo: boolean }>()
  for (const ficha of fichas) {
    const nome = preenchido(ficha.nomeCompleto)
    if (ficha.usuarioId === null || nome === null) continue
    const anterior = escolhidas.get(ficha.usuarioId)
    if (!anterior || (!anterior.ativo && ficha.ativo)) {
      escolhidas.set(ficha.usuarioId, { nome, ativo: ficha.ativo })
    }
  }
  return new Map([...escolhidas].map(([usuarioId, escolhida]) => [usuarioId, escolhida.nome]))
}

/**
 * Dá a cada pessoa da lista o nome de exibição e a marca de ficha.
 *
 * O `nome` que chega de `lerContasDoPonto` já é o RABO da regra — o nome
 * guardado na conta, depois o e-mail (`admin.ts`, `daConta`). Aqui entra a
 * cabeça: havendo ficha ligada, o nome é o dela. O nome gravado na batida, que
 * fica entre o nome da conta e o e-mail, entra depois, por `comNomeGravado`,
 * onde as batidas estão na mão. Aplicar duas vezes dá o mesmo resultado.
 */
export function comNomesDasFichas(
  funcionarios: readonly FuncionarioDoPainel[],
  nomes: ReadonlyMap<string, string>,
): FuncionarioDoPainel[] {
  return funcionarios.map((funcionario) => {
    const daFicha = nomes.get(funcionario.usuarioId)
    return {
      ...funcionario,
      nome: nomeDeExibicao({ ficha: daFicha, conta: funcionario.nome, email: funcionario.email }),
      temFicha: daFicha !== undefined,
    }
  })
}

/**
 * Completa o nome de quem NÃO tem ficha nem nome guardado na conta com o nome
 * gravado nas batidas — o terceiro degrau da regra, antes do e-mail.
 *
 * Quem tem ficha (`temFicha`) ou nome guardado na conta (`nomeDaConta`) fica
 * como está: o gravado nunca ganha dos dois. Sem nome gravado, fica o que já
 * havia (o e-mail, ou a reserva). A pessoa fora da lista, que já nasceu com o
 * gravado (`pessoaForaDaLista`), sai igual: aplicar de novo não muda nada.
 */
export function comNomeGravado(
  funcionario: FuncionarioDoPainel,
  fotografia: FotografiaDaBatida | null,
): FuncionarioDoPainel {
  if (funcionario.temFicha || preenchido(funcionario.nomeDaConta) !== null) return funcionario
  const gravado = preenchido(fotografia?.funcionario_nome)
  return gravado === null || gravado === funcionario.nome ? funcionario : { ...funcionario, nome: gravado }
}

/** O que o banco congelou nas batidas de uma conta: o nome e o e-mail dela no momento. */
export interface FotografiaDaBatida {
  funcionario_nome: string | null
  funcionario_email: string | null
}

/**
 * O primeiro nome e o primeiro e-mail congelados que as batidas da conta
 * têm. Cada um por si: a batida antiga pode ter o e-mail e não o nome, e a
 * primeira da lista pode ser justamente a que não tem nenhum dos dois.
 */
export function fotografiaDasBatidas(batidas: readonly FotografiaDaBatida[]): FotografiaDaBatida {
  return {
    funcionario_nome: batidas.map((b) => preenchido(b.funcionario_nome)).find((nome) => nome !== null) ?? null,
    funcionario_email: batidas.map((b) => preenchido(b.funcionario_email)).find((email) => email !== null) ?? null,
  }
}

/**
 * A pessoa que aparece FORA DA LISTA DE CONTAS (`ponto_contas()`) — pela
 * batida, pela ausência, pelo pedido, pela ficha ou pela URL da tela da
 * pessoa. É a conta que não existe mais: a batida é prova trabalhista e
 * sobrevive à conta (`usuario_id` não aponta para `auth.users`). O nome segue
 * a MESMA regra (sem o degrau do nome guardado, que ela não tem mais): a ficha
 * da conta, o nome gravado na batida, o e-mail gravado, e só então `reserva`.
 *
 * `podeBater` nasce falso: quem sabe se a ficha libera o acesso é quem tem as
 * fichas na mão (`marcarQuemBate`, em `painel.ts`).
 */
export function pessoaForaDaLista(
  usuarioId: string,
  nomes: ReadonlyMap<string, string>,
  fotografia: FotografiaDaBatida | null = null,
  reserva: string = SEM_NOME,
): FuncionarioDoPainel {
  const daFicha = nomes.get(usuarioId)
  return {
    usuarioId,
    nome: nomeDeExibicao(
      { ficha: daFicha, gravado: fotografia?.funcionario_nome, email: fotografia?.funcionario_email },
      reserva,
    ),
    nomeDaConta: null,
    email: preenchido(fotografia?.funcionario_email),
    podeBater: false,
    contaApagada: true,
    temFicha: daFicha !== undefined,
  }
}

/**
 * O nome de quem fez um pedido de batida em atraso (a caixa de pendências do
 * painel).
 *
 * O pedido guarda o nome e o e-mail CONGELADOS no momento do pedido — nos
 * pedidos antigos, o nome de quem usava a conta antes. O painel já tem o nome
 * de exibição de cada conta (`nomes`: conta -> nome, já pela regra ficha →
 * nome guardado na conta → e-mail) e o passa à caixa; o congelado só vale para
 * quem não está no painel, e na mesma ordem: nome, depois e-mail.
 */
export function nomeDeQuemPediu(
  pedido: { usuario_id: string } & FotografiaDaBatida,
  nomes: ReadonlyMap<string, string> = new Map(),
  reserva: string = 'Funcionário sem nome',
): string {
  return (
    nomes.get(pedido.usuario_id) ??
    nomeDeExibicao({ gravado: pedido.funcionario_nome, email: pedido.funcionario_email }, reserva)
  )
}
