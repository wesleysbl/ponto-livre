/*
 * O ACESSO AO PONTO, EM FUNÇÕES PURAS.
 *
 * O QUE O BANCO DO PONTO RESPONDE, E QUE O APP SEGUE
 * O acesso sai só do cadastro do próprio ponto (a ficha de RH, `ponto_admins`
 * e `ponto_super_admins`), e tem DOIS DEGRAUS:
 *   • ENTRAR no app e definir o PIN: ficha ativa que libera, OU quem administra
 *     o ponto (`ponto_pode_administrar()`, que já cobre o super admin);
 *   • BATER e pedir batida em atraso: ficha que libera, OU super admin (só para
 *     teste — as batidas dele não entram na folha de ninguém).
 * Quem é do RH costuma administrar e não bater: entra, define o PIN e trabalha
 * no painel, sem o botão de bater. Se um dia precisar bater, ganha uma ficha.
 *
 * A PERGUNTA É UMA SÓ, E É A DO BANCO: `ponto_meu_acesso()` devolve, com a
 * sessão de quem chama,
 *   { tem_acesso, origem ('ficha' | 'administracao' | null), administra,
 *     super_admin, bate_ponto, nome, cargo }
 * `origem` é 'ficha' quando a ficha libera, senão 'administracao' quando a
 * pessoa administra; `nome` é o da ficha ligada, depois o nome guardado na
 * conta, depois o e-mail; `cargo` é o da ficha ou nulo. O app não refaz
 * nenhuma dessas contas — ele lê. Uma origem que não seja uma dessas duas
 * (de outra versão da estrutura, por exemplo) é lida como nula.
 *
 * TRÊS ESTADOS E FALHA FECHADA:
 * enquanto a resposta não chega, nada protegido aparece; se ela não chega ou
 * chega num formato que não se entende, a tela é a de tentar de novo — e não
 * um "sem acesso", que seria mentira, nem um "pode entrar", que seria pior.
 *
 * ⚠ NADA AQUI PROTEGE NADA. Quem recusa a batida, a leitura das batidas dos
 * outros, a concessão de admin e a mudança de conta é o banco (RLS, gatilhos e
 * a Edge Function `ponto-contas`), a cada chamada. Estas funções decidem o que
 * DESENHAR, para não mostrar uma tela que não vai funcionar.
 */
import type { LeituraDaAdministracao, LeituraDoAcesso, LeituraDoPin } from '../contexts/autenticacao'

/**
 * De onde vem o acesso ao ponto. 'ficha' ganha quando as duas valem: é a ficha
 * que diz quem a pessoa é e por qual cargo ela bate.
 */
export type OrigemDoAcesso = 'ficha' | 'administracao'

/** A resposta de `ponto_meu_acesso()`, já conferida. */
export interface AcessoAoPonto {
  /** Entrar no app e definir o PIN: ficha que libera OU administra. */
  temAcesso: boolean
  /** Nula quando não há acesso. */
  origem: OrigemDoAcesso | null
  administra: boolean
  superAdmin: boolean
  /** Bater e pedir batida em atraso: ficha que libera OU super admin. */
  batePonto: boolean
  /**
   * O nome que o banco dá à conta: ficha, depois nome guardado na conta,
   * depois e-mail. Nulo só se a resposta vier sem ele.
   */
  nome: string | null
  /** O cargo da ficha ligada, ou nulo. */
  cargo: string | null
}

/** Texto aparado; vazio, ou o que não é texto, vira nulo. */
function textoOuNulo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const aparado = valor.trim()
  return aparado ? aparado : null
}

/**
 * O `jsonb` de `ponto_meu_acesso()` vira `AcessoAoPonto` — ou erro.
 *
 * FORMATO INESPERADO É ERRO, NÃO "SEM ACESSO". Uma resposta sem `tem_acesso`
 * (função trocada, versão errada do banco) tratada como `false` mandaria todo
 * mundo para "seu acesso não foi liberado" — uma frase falsa, e sem botão de
 * tentar de novo. Como erro, ela vira a tela de leitura indisponível, que
 * explica e oferece a saída. Vale também para `bate_ponto`: sem ele, esconder
 * o botão de bater de todo mundo seria a mesma mentira. É também o que acusa
 * o app aberto contra um banco de outra versão, cuja `ponto_meu_acesso()` não
 * mande `bate_ponto`.
 *
 * O NOME E O CARGO SÃO TOLERANTES: são texto de tela, e não permissão. Sem
 * eles, a saudação diz só "Olá" e o rótulo cai no padrão.
 *
 * Os quatro booleanos são comparados com `=== true` mesmo depois de conferido
 * o tipo: é o hábito do app inteiro (nulo nunca é permissão).
 */
export function lerRespostaDoAcesso(resposta: unknown): AcessoAoPonto {
  if (typeof resposta !== 'object' || resposta === null || Array.isArray(resposta)) {
    throw new Error('A verificação do acesso ao ponto voltou num formato que o app não entende.')
  }
  const campos = resposta as Record<string, unknown>
  for (const chave of ['tem_acesso', 'administra', 'super_admin', 'bate_ponto'] as const) {
    if (typeof campos[chave] !== 'boolean') {
      throw new Error(`A verificação do acesso ao ponto voltou sem "${chave}".`)
    }
  }
  const temAcesso = campos.tem_acesso === true
  const origem =
    temAcesso && (campos.origem === 'ficha' || campos.origem === 'administracao') ? campos.origem : null
  return {
    temAcesso,
    origem,
    administra: campos.administra === true,
    superAdmin: campos.super_admin === true,
    // Bater exige entrar: um `bate_ponto` sem `tem_acesso` (o banco não deixa) não abre o botão.
    batePonto: temAcesso && campos.bate_ponto === true,
    nome: textoOuNulo(campos.nome),
    cargo: textoOuNulo(campos.cargo),
  }
}

/**
 * A leitura da administração, derivada da leitura do acesso.
 *
 * O app não pergunta `ponto_pode_administrar()` em separado:
 * `ponto_meu_acesso()` já devolve a mesma resposta em `administra`.
 * Os componentes que leem `administracao` (a guarda, o botão do painel na tela
 * de bater) recebem os mesmos três estados da leitura do acesso.
 */
export function administracaoDoAcesso(acesso: LeituraDoAcesso): LeituraDaAdministracao {
  if (acesso.estado === 'ok') return { estado: 'ok', administra: acesso.acesso.administra }
  if (acesso.estado === 'falhou') return { estado: 'falhou', erro: acesso.erro }
  return { estado: 'carregando' }
}

/**
 * O papel de quem está olhando a área de administração.
 *
 * `super_admin` exige as duas respostas (super admin E administra): o banco
 * garante que uma implica a outra, e se um dia não garantir, a tela fica com o
 * papel menor. Leitura que não chegou ou falhou é `nenhum` — falha fechada:
 * botão de super admin só aparece com a resposta do banco na mão.
 */
export type PapelNaAdministracao = 'super_admin' | 'admin' | 'nenhum'

export function papelNaAdministracao(acesso: LeituraDoAcesso): PapelNaAdministracao {
  if (acesso.estado !== 'ok') return 'nenhum'
  if (acesso.acesso.administra && acesso.acesso.superAdmin) return 'super_admin'
  if (acesso.acesso.administra) return 'admin'
  return 'nenhum'
}

/* ------------------------------------------------------------------ */
/* Quem bate, onde começa, e como a tela chama a conta                 */
/* ------------------------------------------------------------------ */

/**
 * Esta sessão bate ponto? É o que decide se a tela de bater mostra o botão de
 * bater ou o caminho do painel.
 *
 * Leitura que não chegou ou falhou é `false` — e isso não esconde nada de
 * ninguém: a tela de bater só abre depois de a guarda ter a resposta na mão.
 */
export function podeBater(acesso: LeituraDoAcesso): boolean {
  return acesso.estado === 'ok' && acesso.acesso.temAcesso && acesso.acesso.batePonto
}

/**
 * A primeira tela depois do login (e depois de criar o PIN).
 *
 * Quem administra e não bate (o RH, em geral) cai no PAINEL: abre o app para
 * corrigir o ponto das pessoas, e a tela de bater não tem botão de bater para
 * essa conta. Todo o resto cai na tela de bater, como sempre; e quem não tem acesso
 * também vai para a raiz, onde a guarda o manda para "sem acesso".
 *
 * Nulo enquanto o acesso não chegou: quem chama espera, em vez de mandar para
 * um lugar e logo depois para outro. Leitura que falhou vai para a raiz, onde a
 * guarda mostra a tela de tentar de novo.
 *
 * O PIN NÃO ENTRA AQUI: o painel exige PIN como toda rota protegida, e a guarda
 * leva quem não tem PIN à tela de criar — que, criado o PIN, volta para cá.
 */
export function telaInicial(acesso: LeituraDoAcesso): '/' | '/painel' | null {
  if (acesso.estado === 'carregando') return null
  if (acesso.estado === 'falhou') return '/'
  const { temAcesso, batePonto, administra } = acesso.acesso
  return temAcesso && !batePonto && administra ? '/painel' : '/'
}

/** O rótulo de quem só entra pela administração, no lugar do cargo. */
export const ROTULO_DA_ADMINISTRACAO = 'Administração do ponto'
/** O rótulo de quem bate por uma ficha sem cargo preenchido. */
export const ROTULO_SEM_CARGO = 'Funcionário'

/**
 * A linha acima da saudação, na tela de bater: o CARGO DA FICHA que libera a
 * conta, e "Funcionário" quando a ficha não tem cargo. Quem entra pela
 * administração, sem ficha que libere (o RH que não bate, e o super admin), vê
 * "Administração do ponto".
 *
 * A ficha só dá o cargo quando é ela que libera: uma ficha desligada ligada à
 * conta de quem hoje administra não faz a tela chamar essa pessoa pelo cargo
 * antigo.
 */
export function rotuloDaConta(acesso: Pick<AcessoAoPonto, 'origem' | 'cargo'>): string {
  if (acesso.origem === 'administracao') return ROTULO_DA_ADMINISTRACAO
  return acesso.cargo ?? ROTULO_SEM_CARGO
}

/**
 * O primeiro nome, para a saudação ("Olá, Ana").
 *
 * O nome do banco cai no e-mail quando não há ficha nem nome guardado na
 * conta — e "Olá, daniela@example.com" não é saudação. Nesse caso, nulo: a
 * tela diz só "Olá".
 */
export function primeiroNomeDaConta(acesso: Pick<AcessoAoPonto, 'nome'>): string | null {
  const nome = acesso.nome?.trim()
  if (!nome || nome.includes('@')) return null
  return nome.split(/\s+/)[0]
}

/* ------------------------------------------------------------------ */
/* A guarda de rota                                                    */
/* ------------------------------------------------------------------ */

export interface EstadoDaSessao {
  /** Verdadeiro até a primeira resposta sobre a sessão chegar. */
  carregando: boolean
  temUsuario: boolean
  acesso: LeituraDoAcesso
  pin: LeituraDoPin
}

export interface ExigenciasDaRota {
  /** A tela de definir PIN precisa de tudo MENOS o PIN — é ela que o cria. */
  exigePin: boolean
  /** O painel, a pessoa, a folha e a área de administração. */
  exigeAdmin: boolean
}

export type DecisaoDaRota =
  | { tipo: 'carregando' }
  | { tipo: 'indisponivel'; motivo: string }
  | { tipo: 'ir'; para: '/entrar' | '/sem-acesso' | '/' | '/definir-pin' }
  | { tipo: 'mostrar' }

/**
 * "Esta pessoa pode ver esta tela agora?" — a escada de degraus da guarda, na
 * ordem em que o app fica sabendo das coisas: sessão, acesso ao ponto,
 * administração, PIN.
 *
 * QUEM DECIDE O ACESSO É O BANCO. O nome e o cargo vêm do próprio
 * `ponto_meu_acesso()`. Quem passa é quem o banco diz que tem acesso
 * (`tem_acesso`) — pela ficha que libera OU pela administração. Por isso o
 * administrador sem ficha passa, define o PIN e abre o painel; e a conta com a
 * ficha desligada vai para "sem acesso".
 *
 * Cada `indisponivel` é falha fechada: uma leitura que não respondeu não é uma
 * permissão concedida, e também não é um "não" (que redirecionaria em silêncio e
 * faria uma queda de rede parecer revogação de acesso).
 */
export function decidirRota(sessao: EstadoDaSessao, exigencias: ExigenciasDaRota): DecisaoDaRota {
  if (sessao.carregando) return { tipo: 'carregando' }
  if (!sessao.temUsuario) return { tipo: 'ir', para: '/entrar' }

  if (sessao.acesso.estado === 'carregando') return { tipo: 'carregando' }
  if (sessao.acesso.estado === 'falhou') return { tipo: 'indisponivel', motivo: sessao.acesso.erro }
  if (!sessao.acesso.acesso.temAcesso) return { tipo: 'ir', para: '/sem-acesso' }

  /*
   * Quem não administra o ponto volta para a tela de bater — a dele. Mandar
   * para /sem-acesso diria "seu acesso não foi liberado", que é outra coisa e
   * é mentira: ele bate ponto normalmente, só não fecha o mês dos outros.
   */
  if (exigencias.exigeAdmin && !sessao.acesso.acesso.administra) return { tipo: 'ir', para: '/' }

  if (!exigencias.exigePin) return { tipo: 'mostrar' }

  if (sessao.pin.estado === 'carregando') return { tipo: 'carregando' }
  if (sessao.pin.estado === 'falhou') return { tipo: 'indisponivel', motivo: sessao.pin.erro }
  // Sem PIN, ou com redefinição pedida pelo admin: não passa sem definir um novo.
  if (!sessao.pin.status.definido || sessao.pin.status.precisa_redefinir) {
    return { tipo: 'ir', para: '/definir-pin' }
  }
  return { tipo: 'mostrar' }
}

/**
 * O que a tela "sem acesso" faz com a leitura do acesso.
 *
 * Ela é alcançada por redirecionamento da guarda, mas também pela URL (o
 * atalho da tela de início guarda a última). Liberado enquanto olhava a tela:
 * sai dela sozinho. Sem a resposta do banco: tela de tentar de novo — dizer
 * "não foi liberado" sem saber seria a mesma mentira que a guarda evita.
 */
export type DecisaoDoSemAcesso =
  | { tipo: 'carregando' }
  | { tipo: 'indisponivel'; motivo: string }
  | { tipo: 'ir'; para: '/entrar' | '/' }
  | { tipo: 'mostrar' }

export function decidirSemAcesso(
  sessao: Pick<EstadoDaSessao, 'carregando' | 'temUsuario' | 'acesso'>,
): DecisaoDoSemAcesso {
  if (sessao.carregando) return { tipo: 'carregando' }
  if (!sessao.temUsuario) return { tipo: 'ir', para: '/entrar' }
  if (sessao.acesso.estado === 'carregando') return { tipo: 'carregando' }
  if (sessao.acesso.estado === 'falhou') return { tipo: 'indisponivel', motivo: sessao.acesso.erro }
  if (sessao.acesso.acesso.temAcesso) return { tipo: 'ir', para: '/' }
  return { tipo: 'mostrar' }
}
