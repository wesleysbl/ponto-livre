import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronDown,
  Crown,
  IdCard,
  KeyRound,
  Link2,
  Lock,
  Mail,
  Pencil,
  Power,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldMinus,
  ShieldPlus,
  SlidersHorizontal,
  Unlink,
  UserCog,
  UserPen,
  UserPlus,
  UserX,
  X,
} from 'lucide-react'
import { Aviso, Botao, Etiqueta, Modal, Painel as Cartao, Recado } from './ui'
import { SeletorDePeriodo } from './SeletorDePeriodo'
import { CaixaDeAtivo, FormularioDaFicha } from './FichaDoFuncionario'
import {
  FormularioDeConta,
  FormularioDeNovaConta,
  type AcaoDeConta,
  type FichaDaContaNova,
} from './CaixasDeConta'
import { CaixaDeVinculo } from './CaixaDeVinculo'
import {
  concederAdministracao,
  definirAtivoDaFicha,
  desvincularFicha,
  lerAdministradores,
  lerEstadoDoPinDeTodos,
  lerFichas,
  lerSuperAdmins,
  pedirAcaoDeConta,
  revogarAdministracao,
  salvarFicha,
  vincularFicha,
} from '../lib/administracao'
import { lerBatidasDoPeriodo, lerContasDoPonto } from '../lib/admin'
import { useAuth } from '../hooks/useAuth'
import type { Contagem, ResumoDePessoas } from '../lib/inicio-da-administracao'
import { papelNaAdministracao, type PapelNaAdministracao } from '../lib/acesso'
import {
  camposFaltandoDaFicha,
  descreverVinculo,
  escreverData,
  formatarCpf,
  validarFicha,
  type FichaDoFuncionario,
  type RascunhoDaFicha,
} from '../lib/cadastro'
import {
  ErroDeConta,
  falhaPedeReleitura,
  frasesDaFalha,
  type CorpoDoPedidoDeConta,
} from '../lib/contas'
import { diaCivilDeHoje, formatarMomento, type BatidaDoAdmin } from '../lib/formato'
import { mesDe, rotuloDoMes } from '../lib/horas'
import { resetarPinDeUsuario } from '../lib/pin'
import { primeiroNome, type FuncionarioDoPainel } from '../lib/painel'
import {
  acoesDaPessoa,
  acoesGerais,
  contasSemFicha,
  filtrarPessoas,
  montarPessoas,
  quemEhOSuperAdmin,
  RESERVA_DO_SUPER_ADMIN,
  resumirPessoas,
  ROTULO_SO_ADMINISTRA,
  semAcessoPendente,
  soAdministra,
  textoDoAcesso,
  type AcaoSobrePessoa,
  type ConcessaoDeAdministracao,
  type EstadoDoPin,
  type PessoaDaAdministracao,
} from '../lib/pessoas'
import {
  lerPeriodo,
  parametrosDoPeriodo,
  periodoPadrao,
  rotuloDoPeriodo,
  type Periodo,
} from '../lib/periodo'
import {
  rotuloDaForca,
  sugerirContasParaFicha,
  sugerirFichasParaConta,
  type ContaParaVinculo,
  type ForcaDaSugestao,
} from '../lib/vinculo'

/*
 * PESSOAS NUMA TELA SÓ.
 *
 * O QUE ELA RESOLVE: duas listas — uma de contas (PIN, administração) e outra
 * de fichas (CPF, cargo, folha) — descreveriam a mesma coisa por metades, já
 * que a ficha também é a porta do ponto. Aqui cada linha é uma PESSOA: a
 * conta, a ficha ligada, a administração e o PIN, com as ações de cada parte
 * (inclusive criar conta, trocar nome e e-mail e redefinir senha) no mesmo
 * lugar.
 *
 * AS CONTAS SÃO AS DO PONTO: vêm de `ponto_contas()`, e o banco do ponto só
 * tem gente do ponto. Quem só administra aparece como "só administra — não bate
 * ponto", no fim do grupo dos administradores.
 *
 * A FICHA SEM CONTA TAMBÉM É PESSOA. É funcionária, tem folha — só não bate
 * ponto pelo celular. Ela entra na lista, e é na linha dela que o super admin a
 * liga a uma conta (com a sugestão pelo nome) ou cria a conta dela.
 *
 * QUEM VÊ O QUÊ (`acoesDaPessoa`, `lib/pessoas.ts`, puro e testado):
 *   • o SUPER ADMIN vê tudo: criar conta com ficha, trocar nome e e-mail,
 *     redefinir senha, conceder e revogar admin, ligar e desligar ficha;
 *   • o ADMIN COMUM vê a lista, reseta PIN e cuida do cadastro da ficha, como
 *     já cuidava — e não vê os botões do super admin.
 * O papel vem de `ponto_meu_acesso()` (`useAuth().acesso`), e leitura que não
 * chegou não mostra botão de ninguém: falha fechada.
 *
 * A GUARDA E OS BOTÕES NÃO PROTEGEM NADA, como em todo o resto do app. Quem
 * recusa é o banco, a cada chamada: a RLS de `ponto_admins` (só o super admin
 * escreve), o gatilho da ficha (só o super admin libera acesso),
 * `ponto_contas()`, `ponto_estado_do_pin()` e `ponto_resetar_pin()` (quem
 * administra), e a Edge Function `ponto-contas`, que pergunta
 * ao banco — com a sessão de quem chama — se é super admin.
 *
 * ⚠ TODA AÇÃO PASSA POR UMA CAIXA, e a caixa diz a CONSEQUÊNCIA. Conceder admin
 * dá a jornada de todo mundo; ligar uma ficha dá o ponto a uma conta; trocar o
 * e-mail muda com o que a pessoa entra. Nenhuma pode ser um clique solto.
 *
 * O PERÍODO MORA NA URL, como no painel (`?de=…&ate=…`). Assim a contagem de
 * batidas de cada pessoa sobrevive ao F5 e o link é colável — e a URL, sendo
 * entrada de usuário, passa inteira por `lerPeriodo`, que nunca levanta.
 *
 * O PONTO DA PESSOA PRIMEIRO, E A LISTA NÃO SOME
 *   • Na linha aberta, o primeiro botão é "Ver e corrigir o ponto de {nome}",
 *     e logo abaixo "Imprimir a folha de {mês}" — é o que o RH mais faz, e não
 *     pode ficar depois de conta, ficha e PIN.
 *   • Depois de cada ação, a lista é relida POR BAIXO da que está na tela
 *     ("Atualizando…"), a linha aberta continua aberta e a frase do que foi
 *     feito vai para o recado do rodapé — e não some num "Carregando…" para
 *     voltar fechada, do topo.
 *   • Para quem administra sem ser super admin, os textos dizem QUEM resolve o
 *     que não está no alcance dela ("só Sérgio faz"), com o nome tirado da
 *     própria lista (`quemEhOSuperAdmin`).
 */

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

interface Dados {
  funcionarios: FuncionarioDoPainel[]
  administradores: ConcessaoDeAdministracao[]
  superAdmins: string[]
  estadosDoPin: EstadoDoPin[]
  batidas: BatidaDoAdmin[]
  fichas: FichaDoFuncionario[]
  erro: string | null
}

const VAZIO: Dados = {
  funcionarios: [],
  administradores: [],
  superAdmins: [],
  estadosDoPin: [],
  batidas: [],
  fichas: [],
  erro: null,
}

/**
 * As leituras, em paralelo, com o erro devolvido como VALOR — mesmo desenho de
 * `Painel.tsx` e `PainelDaPessoa.tsx`.
 *
 * `Promise.all` e não `allSettled`: todas vêm da mesma sessão e falham pelo
 * mesmo motivo (sessão caiu, rede caiu, permissão sumiu). Mostrar a lista com
 * um pedaço faltando seria pior do que mostrar o erro — a tela diria "esta
 * pessoa não tem PIN" ou "não tem ficha" quando na verdade a leitura é que não
 * chegou.
 *
 * UMA RODADA SÓ: `ponto_contas()` devolve TODAS as contas do banco do ponto,
 * inclusive a que acabou de ser criada — não há segunda leitura para buscar
 * conta pelo id.
 */
async function buscar(periodo: Periodo): Promise<Dados> {
  try {
    const [funcionarios, administradores, superAdmins, estadosDoPin, batidas, fichas] =
      await Promise.all([
        lerContasDoPonto(),
        lerAdministradores(),
        lerSuperAdmins(),
        lerEstadoDoPinDeTodos(),
        lerBatidasDoPeriodo(periodo),
        lerFichas(),
      ])

    return { funcionarios, administradores, superAdmins, estadosDoPin, batidas, fichas, erro: null }
  } catch (falha) {
    return {
      ...VAZIO,
      erro: falha instanceof Error ? falha.message : 'Não deu para carregar a lista de pessoas.',
    }
  }
}

/** As frases de uma falha qualquer, sem deixar `[object Object]` na tela. */
function frasesDe(falha: unknown, padrao: string): string[] {
  if (falha instanceof ErroDeConta) return frasesDaFalha(falha.falha)
  return [falha instanceof Error ? falha.message : padrao]
}

/* ------------------------------------------------------------------ */
/* Peças pequenas                                                      */
/* ------------------------------------------------------------------ */

function Recusas({ erros }: { erros: string[] }) {
  if (erros.length === 0) return null
  return (
    <Aviso tom="erro">
      {erros.length === 1 ? (
        erros[0]
      ) : (
        <ul className="list-disc space-y-1 pl-4">
          {erros.map((frase) => (
            <li key={frase}>{frase}</li>
          ))}
        </ul>
      )}
    </Aviso>
  )
}

/** Um bloco do painel aberto da pessoa: título pequeno e o conteúdo. */
function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint">{titulo}</p>
      {children}
    </section>
  )
}

/**
 * Os botões de um bloco, em par a partir de 25rem de CAIXA e em pilha abaixo
 * disso — cada um com a largura inteira e os 44 px de altura de sempre.
 *
 * Consulta de CONTÊINER e não de janela: esta linha está dentro de um cartão
 * dentro de uma página, e no computador ela é metade da largura da lista. O que
 * decide é a caixa, não a tela.
 */
function Botoes({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-2 @min-[25rem]:grid-cols-2">{children}</div>
    </div>
  )
}

/** Uma linha de explicação embaixo dos botões. */
function Nota({ children }: { children: ReactNode }) {
  return <p className="text-[0.68rem] leading-relaxed text-faint">{children}</p>
}

/* ------------------------------------------------------------------ */
/* A caixa de confirmação                                              */
/* ------------------------------------------------------------------ */

/** As ações que são só um "confirmar" — sem formulário. */
type Confirmavel = 'conceder' | 'revogar' | 'resetar-pin' | 'desvincular-ficha'

interface PedidoDeConfirmacao {
  acao: Confirmavel
  pessoa: PessoaDaAdministracao
}

/**
 * O TEXTO DE CADA CONFIRMAÇÃO — e ele descreve a CONSEQUÊNCIA, não a operação.
 *
 * "Tem certeza?" não é confirmação de nada: quem clicou tem certeza do que
 * clicou, e o que ele pode não saber é o que aquilo faz. Cada frase abaixo diz
 * o que muda para a OUTRA pessoa, que é quem sofre o efeito.
 */
function textoDaConfirmacao(pedido: PedidoDeConfirmacao): {
  titulo: string
  acao: string
  consequencia: string
  tom: 'perigo' | 'normal'
} {
  const nome = pedido.pessoa.nome
  switch (pedido.acao) {
    case 'conceder':
      return {
        titulo: 'Conceder a administração do ponto',
        acao: 'Conceder a administração',
        consequencia:
          `${nome} passa a ver e corrigir a jornada de TODO MUNDO: ler qualquer batida, ` +
          'mudar horário, inserir batida esquecida, resetar o PIN de qualquer pessoa e ' +
          'alterar a configuração do ponto. Conceder e revogar a administração continua só ' +
          'com o super admin.' +
          (pedido.pessoa.acesso === 'ficha'
            ? ''
            : ' Sem ficha, ela passa a entrar no app para administrar, mas não bate ponto.'),
        tom: 'perigo',
      }
    case 'revogar':
      return {
        titulo: 'Revogar a administração do ponto',
        acao: 'Revogar a administração',
        consequencia:
          `${nome} deixa de abrir o painel e a área de administração na próxima recarga. ` +
          (pedido.pessoa.acesso === 'ficha'
            ? 'Continua batendo o próprio ponto pela ficha e vendo o próprio espelho, normalmente.'
            : 'Sem uma ficha ligada à conta, ela deixa de entrar no ponto: a tela de entrar vai dizer que o acesso não está liberado.'),
        tom: 'perigo',
      }
    case 'resetar-pin':
      return {
        titulo: 'Resetar o PIN',
        acao: 'Resetar o PIN',
        consequencia:
          `Na próxima entrada, ${nome} vai ter de criar um PIN novo. O bloqueio por tentativas ` +
          'erradas, se houver, é liberado junto. O PIN antigo deixa de valer.',
        tom: 'normal',
      }
    case 'desvincular-ficha':
      return {
        titulo: 'Desligar a ficha da conta',
        acao: 'Desligar a ficha',
        consequencia:
          `A ficha “${pedido.pessoa.ficha?.nomeCompleto ?? ''}” deixa de ser da conta de ${nome}. ` +
          (pedido.pessoa.superAdmin
            ? 'Como super admin, ela continua entrando e batendo (só para teste). '
            : pedido.pessoa.administra
              ? 'Ela continua entrando para administrar, mas deixa de bater ponto na próxima abertura do app. '
              : 'Sem a ficha, ela deixa de entrar no ponto na próxima abertura do app. ') +
          'A ficha continua existindo, e as batidas antigas não mudam.',
        tom: 'perigo',
      }
  }
}

/**
 * A caixa que separa o clique da consequência.
 *
 * O CAMPO DE OBSERVAÇÃO SÓ APARECE AO CONCEDER, e é opcional. Ele grava em
 * `ponto_admins.observacao`, que é o que a lista mostra seis meses depois para
 * explicar por que aquela pessoa está ali. Torná-lo obrigatório faria as pessoas
 * escreverem "ok" — o motivo escrito à força não informa ninguém.
 */
function CaixaDeConfirmacao({
  pedido,
  gravando,
  erros,
  aoConfirmar,
  aoFechar,
}: {
  pedido: PedidoDeConfirmacao
  gravando: boolean
  erros: string[]
  aoConfirmar: (observacao: string) => void
  aoFechar: () => void
}) {
  const [observacao, setObservacao] = useState('')
  const texto = textoDaConfirmacao(pedido)

  return (
    <Modal rotulo={texto.titulo} aoFechar={aoFechar} podeFechar={!gravando}>
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              Confirmar
            </p>
            <h2 className="mt-1 text-base font-semibold text-plat">{texto.titulo}</h2>
            <p className="mt-0.5 truncate text-[0.7rem] text-mute">
              {pedido.pessoa.nome} · {pedido.pessoa.email ?? 'sem e-mail'}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            disabled={gravando}
            aria-label="Fechar"
            className="-mt-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat disabled:opacity-40"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4">
          <Aviso tom={texto.tom === 'perigo' ? 'atencao' : 'neutro'}>{texto.consequencia}</Aviso>
        </div>

        {pedido.acao === 'conceder' && (
          <div className="mt-3">
            <label
              htmlFor="concessao-observacao"
              className="mb-1.5 block text-sm font-medium text-plat-dim"
            >
              Por que esta pessoa? (opcional)
            </label>
            <input
              id="concessao-observacao"
              value={observacao}
              onChange={(evento) => setObservacao(evento.target.value)}
              placeholder="ex.: fecha a folha comigo todo mês"
              className="w-full min-h-11 rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5 text-sm text-plat placeholder:text-faint focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25"
            />
            <p className="mt-1.5 text-[0.68rem] leading-relaxed text-faint">
              Fica gravado junto com o seu nome e a data. É o que explica esta linha para quem
              conferir a lista daqui a seis meses.
            </p>
          </div>
        )}

        {erros.length > 0 && (
          <div className="mt-3">
            <Recusas erros={erros} />
          </div>
        )}

        {/*
          CANCELAR EM CIMA, CONFIRMAR EMBAIXO — e não lado a lado — no celular.
          "Conceder a administração" e "Revogar a administração" não cabem em
          meia caixa de 264 px sem quebrar em três linhas. Empilhados, cada um
          tem a largura inteira e 44 px de altura. E a ação que muda a vida de
          outra pessoa fica embaixo, longe do polegar que estava rolando a lista.
        */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Botao tom="secundario" onClick={aoFechar} disabled={gravando}>
            Cancelar
          </Botao>
          <Botao onClick={() => aoConfirmar(observacao)} disabled={gravando}>
            {gravando ? 'Gravando…' : texto.acao}
          </Botao>
        </div>
      </>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* A linha de uma pessoa                                               */
/* ------------------------------------------------------------------ */

/** As ações do bloco da ficha: sem nenhuma delas, o bloco não desenha botão vazio. */
const ACOES_DA_FICHA: readonly AcaoSobrePessoa[] = [
  'vincular-ficha',
  'criar-ficha',
  'criar-conta',
  'editar-ficha',
  'desativar-ficha',
  'reativar-ficha',
  'desvincular-ficha',
]

/** A sugestão de vínculo mais forte da linha, para o atalho "Ligar à sugerida". */
export interface SugestaoDaLinha {
  id: string
  titulo: string
  forca: ForcaDaSugestao
  /** Quantas candidatas empataram na mesma força — mais de uma pede conferência. */
  empatadas: number
}

/**
 * Uma pessoa da lista: o cabeçalho que se toca para abrir, e o painel com a
 * conta, a ficha, a administração e o PIN.
 *
 * OS BOTÕES SAEM DE `acoes` (`acoesDaPessoa`) E DE MAIS NENHUM LUGAR: a linha
 * não decide quem pode o quê. É o que deixa o teste "quem não é super admin não
 * recebe as ações de super admin" valer também para a tela.
 */
export function LinhaDePessoa({
  pessoa,
  acoes,
  periodo,
  aberta,
  sugestao,
  aoAbrir,
  aoPedir,
  quemResolve = null,
}: {
  pessoa: PessoaDaAdministracao
  acoes: readonly AcaoSobrePessoa[]
  periodo: Periodo
  aberta: boolean
  sugestao: SugestaoDaLinha | null
  aoAbrir: () => void
  aoPedir: (acao: AcaoSobrePessoa, preEscolhida?: string) => void
  /**
   * Quem resolve o que só o super admin faz ("Sérgio", ou "o super admin"),
   * para quem administra sem ser super admin. Nulo para o super admin: ele
   * mesmo resolve, e os textos não aparecem.
   */
  quemResolve?: string | null
}) {
  const pode = (acao: AcaoSobrePessoa) => acoes.includes(acao)
  const ficha = pessoa.ficha
  const temConta = pessoa.usuarioId !== null
  const parametros = new URLSearchParams(parametrosDoPeriodo(periodo)).toString()

  /*
   * A FOLHA É SEMPRE DE UM MÊS FECHADO, e esta lista navega por período livre.
   * A folha abre no mês em que o período TERMINA — o mês que se está fechando
   * em praticamente todo uso real. O rótulo do botão diz qual mês vai abrir.
   */
  const mesDaFolha = mesDe(periodo.fim)

  /*
   * O "Ver e corrigir o ponto" é o botão principal da linha — menos quando a
   * linha já tem a sugestão de vínculo como principal (a conta sem ficha, que
   * ainda nem bate): uma linha não tem dois verdes.
   */
  const sugestaoPrincipal = sugestao !== null && pode('vincular-ficha') && sugestao.forca !== 'parcial'
  const mostrarQuemResolve = quemResolve !== null && temConta && !pessoa.contaApagada && !pessoa.superAdmin

  return (
    <li className={`rounded-2xl border border-hair bg-ink-1 ${ficha && !ficha.ativo && !temConta ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={aoAbrir}
        aria-expanded={aberta}
        /*
         * `gap-2 sm:gap-3`: em 320 px são três folgas nesta linha (nome →
         * contagem → seta) e cada 4 px devolvido vai inteiro para o nome, que é
         * o único elemento que a pessoa procura ao rolar a lista.
         */
        className="flex w-full min-h-11 items-center gap-2 px-3 py-3 text-left sm:gap-3 sm:px-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-plat">{pessoa.nome}</p>
          <p className="mt-0.5 truncate text-[0.7rem] text-faint">
            {temConta
              ? (pessoa.email ?? 'sem e-mail')
              : [ficha?.cargo, ficha?.cpf ? formatarCpf(ficha.cpf) : null].filter(Boolean).join(' · ') ||
                'ficha sem cargo nem CPF'}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {pessoa.superAdmin ? (
              <Etiqueta tom="bom">
                <Crown size={10} aria-hidden="true" />
                super admin
              </Etiqueta>
            ) : (
              pessoa.administra && (
                <Etiqueta tom="bom">
                  <ShieldCheck size={10} aria-hidden="true" />
                  administra o ponto
                </Etiqueta>
              )
            )}
            {pessoa.contaApagada && (
              <Etiqueta tom="aviso">
                <UserX size={10} aria-hidden="true" />
                conta que não existe mais
              </Etiqueta>
            )}
            {/*
              Quem administra e não bate (o RH, em geral): estado, não defeito
              — neutro, e não aviso. A pendência é a de baixo: conta sem acesso
              nenhum. A de ficha desligada ganha a mesma etiqueta, mas neutra:
              ficou sem acesso porque o RH a desligou.
            */}
            {soAdministra(pessoa) && (
              <Etiqueta tom="neutro">
                <UserCog size={10} aria-hidden="true" />
                {ROTULO_SO_ADMINISTRA}
              </Etiqueta>
            )}
            {temConta && !pessoa.contaApagada && pessoa.acesso === null && (
              <Etiqueta tom={semAcessoPendente(pessoa) ? 'aviso' : 'neutro'}>
                <AlertTriangle size={10} aria-hidden="true" />
                sem acesso ao ponto
              </Etiqueta>
            )}
            {/* A ficha: o estado do vínculo dela, ou a falta dela. */}
            {!temConta && (
              <Etiqueta tom={ficha?.ativo ? 'aviso' : 'neutro'}>
                <IdCard size={10} aria-hidden="true" />
                {ficha?.ativo ? 'ficha sem conta' : 'ficha desativada, sem conta'}
              </Etiqueta>
            )}
            {temConta && ficha && (
              <Etiqueta tom="neutro">
                <IdCard size={10} aria-hidden="true" />
                {ficha.ativo ? 'com ficha' : 'ficha desativada'}
              </Etiqueta>
            )}
            {temConta && !ficha && !pessoa.contaApagada && (
              <Etiqueta tom="neutro">
                <IdCard size={10} aria-hidden="true" />
                sem ficha
              </Etiqueta>
            )}
            {pessoa.fichasDaConta > 1 && (
              <Etiqueta tom="aviso">
                <AlertTriangle size={10} aria-hidden="true" />
                {pessoa.fichasDaConta} fichas na mesma conta
              </Etiqueta>
            )}
            {sugestao && pode('vincular-ficha') && (
              <Etiqueta tom={sugestao.forca === 'parcial' ? 'aviso' : 'bom'}>
                <Link2 size={10} aria-hidden="true" />
                {temConta ? 'ficha' : 'conta'} sugerida: {sugestao.titulo}
              </Etiqueta>
            )}
            {/*
              Os três rótulos de PIN. Só "com PIN" é neutro: os outros dois
              descrevem alguém que NÃO consegue bater ponto agora — travado por
              erro, ou a caminho da tela de definir PIN — e isso é pendência.
              Quem só administra não bate: a falta de PIN dessa conta não é
              pendência e a linha não diz "sem PIN" (a tela de
              criar o PIN aparece sozinha na próxima entrada). A trava por erro
              e o "PIN definido" continuam aparecendo.
            */}
            {pessoa.pin && !(soAdministra(pessoa) && pessoa.pin.estado === 'sem-pin') && (
              <Etiqueta tom={pessoa.pin.estado === 'com-pin' ? 'neutro' : 'aviso'}>
                {pessoa.pin.estado === 'bloqueado' ? (
                  <Lock size={10} aria-hidden="true" />
                ) : (
                  <KeyRound size={10} aria-hidden="true" />
                )}
                {pessoa.pin.texto}
              </Etiqueta>
            )}
          </div>
        </div>

        {temConta && (
          <div className="shrink-0 text-right">
            <p className="font-mono text-lg text-plat tabular-nums">{pessoa.batidas}</p>
            <p className="mt-0.5 font-mono text-[0.62rem] text-faint tabular-nums">
              {pessoa.batidas === 1 ? 'batida' : 'batidas'}
            </p>
          </div>
        )}

        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-mute transition-transform ${aberta ? 'rotate-180' : ''}`}
        />
      </button>

      {aberta && (
        <div className="space-y-4 border-t border-hair px-3 py-3 sm:px-4">
          {/* ---------------- O ponto e a folha, primeiro ---------------- */}
          {temConta && (
            <div className="grid grid-cols-1 gap-2">
              {/*
                O ATALHO PARA A TELA QUE JÁ CORRIGE E INSERE. Ele leva o período
                na URL, para a tela da pessoa abrir no mesmo recorte que esta
                lista está mostrando — e a contagem de batidas bater com a de lá.
              */}
              <Link
                to={`/painel/${pessoa.usuarioId}?${parametros}`}
                className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-center text-sm leading-snug font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60 sm:px-4 ${
                  sugestaoPrincipal
                    ? 'border border-hair-2 bg-ink-2 text-plat-dim hover:border-hair-3 hover:text-plat'
                    : 'bg-luz text-ink-0 hover:bg-luz-deep'
                }`}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                Ver e corrigir o ponto de {primeiroNome(pessoa.nome)}
              </Link>
              {/*
                A FOLHA PARA ASSINAR. `?imprimir=1` faz a tela da folha abrir a
                caixa de impressão sozinha assim que os dados chegam (e só se
                não houver aviso); abrir a caixa DAQUI mandaria para o papel esta
                lista, e não a folha.
              */}
              <Link
                to={`/folha/${pessoa.usuarioId}?mes=${mesDaFolha}&imprimir=1`}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-hair-2 bg-ink-2 px-3 py-3 text-center text-sm leading-snug font-semibold text-plat-dim transition-colors hover:border-hair-3 hover:text-plat focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60 sm:px-4"
              >
                <Printer size={15} aria-hidden="true" />
                Imprimir a folha de {rotuloDoMes(mesDaFolha).toLowerCase()}
              </Link>
            </div>
          )}

          {/* ---------------- A conta ---------------- */}
          {temConta && (
            <Bloco titulo="Conta">
              <p className="text-[0.75rem] leading-relaxed text-mute">{textoDoAcesso(pessoa)}.</p>
              {(pode('trocar-nome') || pode('trocar-email') || pode('redefinir-senha')) && (
                <Botoes>
                  {pode('trocar-nome') && (
                    <Botao tom="secundario" onClick={() => aoPedir('trocar-nome')}>
                      <UserPen size={15} aria-hidden="true" />
                      Trocar o nome
                    </Botao>
                  )}
                  {pode('trocar-email') && (
                    <Botao tom="secundario" onClick={() => aoPedir('trocar-email')}>
                      <Mail size={15} aria-hidden="true" />
                      Trocar o e-mail
                    </Botao>
                  )}
                  {pode('redefinir-senha') && (
                    <Botao tom="secundario" onClick={() => aoPedir('redefinir-senha')}>
                      <KeyRound size={15} aria-hidden="true" />
                      Redefinir a senha
                    </Botao>
                  )}
                </Botoes>
              )}
              {/*
                Como a lista de super admins muda DE VERDADE: só o dono do banco
                (`postgres`) grava nela — é assim que nasce o primeiro, pelo
                `supabase/primeiro-super-admin.sql`, no SQL Editor do Supabase.
                E a função de contas não troca o e-mail de super admin.
              */}
              {pessoa.superAdmin && (
                <Nota>
                  Super admin do ponto: administra sempre e escolhe quem administra. A lista de super
                  admins não muda pelo app: só por SQL do dono do banco, no painel do Supabase. O
                  e-mail de super admin também só muda por lá.
                </Nota>
              )}
              {mostrarQuemResolve && (
                <Nota>
                  Trocar e-mail, criar nova senha e liberar o acesso: só {quemResolve} faz. Mande o nome
                  e o e-mail da pessoa para {quemResolve}.
                </Nota>
              )}
            </Bloco>
          )}

          {/* ---------------- A ficha ---------------- */}
          <Bloco titulo="Ficha do ponto">
            {ficha ? (
              <div className="rounded-xl border border-hair bg-ink-2 px-3 py-2.5">
                <p className="truncate text-sm text-plat">{ficha.nomeCompleto}</p>
                <p className="mt-0.5 truncate text-[0.7rem] text-faint">
                  {[ficha.cargo, ficha.cpf ? formatarCpf(ficha.cpf) : null, ficha.matricula ? `matrícula ${ficha.matricula}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'sem cargo, CPF nem matrícula'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {!ficha.ativo && (
                    <Etiqueta tom="neutro">
                      <Power size={10} aria-hidden="true" />
                      ficha desativada
                    </Etiqueta>
                  )}
                  {temConta && (
                    <Etiqueta tom={descreverVinculo(ficha).estado === 'bate' ? 'bom' : 'aviso'}>
                      {descreverVinculo(ficha).texto}
                    </Etiqueta>
                  )}
                  {ficha.admissao && (
                    <Etiqueta tom="neutro">admitida em {escreverData(ficha.admissao)}</Etiqueta>
                  )}
                  {ficha.desligamento && (
                    <Etiqueta tom="aviso">desligada em {escreverData(ficha.desligamento)}</Etiqueta>
                  )}
                </div>
                {/* Pendência de cadastro, e não da folha: dela, a folha leva só
                    o nome completo (ver `camposFaltandoDaFicha`). */}
                {ficha.ativo && camposFaltandoDaFicha(ficha).length > 0 && (
                  <p className="mt-1.5 text-[0.68rem] leading-relaxed text-faint">
                    Falta preencher na ficha: {camposFaltandoDaFicha(ficha).join(', ')}.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[0.75rem] leading-relaxed text-mute">
                {pessoa.contaApagada
                  ? 'Sem ficha. Esta conta não existe mais — só aparece porque deixou batidas —, e não recebe ficha.'
                  : soAdministra(pessoa)
                    ? 'Sem ficha: administra o ponto e não bate. Se um dia precisar bater, o super admin liga uma ficha a esta conta.'
                    : pessoa.superAdmin
                      ? 'Sem ficha: como super admin, entra e bate só para teste — as batidas não entram na folha de ninguém.'
                      : 'Sem ficha do ponto: a pessoa só entra no ponto quando o super admin ligar uma ficha a esta conta.'}
              </p>
            )}

            {pessoa.fichasDaConta > 1 && (
              <Aviso tom="atencao">
                Esta conta está ligada a {pessoa.fichasDaConta} fichas, e o banco não deveria deixar.
                A tela mostra a ativa; confira as fichas antes de mexer na conta.
              </Aviso>
            )}

            {sugestao && pode('vincular-ficha') && (
              <Nota>
                {temConta ? 'Ficha' : 'Conta'} que combina pelo nome: <strong>{sugestao.titulo}</strong>{' '}
                ({rotuloDaForca(sugestao.forca)}
                {sugestao.empatadas > 1 ? `; e mais ${sugestao.empatadas - 1} com a mesma força` : ''}).
                Nada é ligado sozinho: confira e confirme.
              </Nota>
            )}

            {ACOES_DA_FICHA.some(pode) && (
            <Botoes>
              {sugestao && pode('vincular-ficha') && (
                /* A sugestão "parcial" não ganha o botão principal: ela pede
                   conferência, e o verde é para o caminho provável. */
                <Botao
                  tom={sugestao.forca === 'parcial' ? 'secundario' : 'primario'}
                  onClick={() => aoPedir('vincular-ficha', sugestao.id)}
                >
                  <Link2 size={15} aria-hidden="true" />
                  Ligar à sugerida
                </Botao>
              )}
              {pode('vincular-ficha') && (
                <Botao tom="secundario" onClick={() => aoPedir('vincular-ficha')}>
                  <Link2 size={15} aria-hidden="true" />
                  {temConta ? 'Ligar a uma ficha' : 'Ligar a uma conta'}
                </Botao>
              )}
              {pode('criar-ficha') && (
                <Botao tom="secundario" onClick={() => aoPedir('criar-ficha')}>
                  <IdCard size={15} aria-hidden="true" />
                  Criar a ficha
                </Botao>
              )}
              {pode('criar-conta') && (
                <Botao tom="secundario" onClick={() => aoPedir('criar-conta')}>
                  <UserPlus size={15} aria-hidden="true" />
                  Criar a conta
                </Botao>
              )}
              {pode('editar-ficha') && (
                <Botao tom="secundario" onClick={() => aoPedir('editar-ficha')}>
                  <Pencil size={15} aria-hidden="true" />
                  Editar a ficha
                </Botao>
              )}
              {pode('desativar-ficha') && (
                <Botao tom="secundario" onClick={() => aoPedir('desativar-ficha')}>
                  <Power size={15} aria-hidden="true" />
                  Desativar a ficha
                </Botao>
              )}
              {pode('reativar-ficha') && (
                <Botao tom="secundario" onClick={() => aoPedir('reativar-ficha')}>
                  <RotateCcw size={15} aria-hidden="true" />
                  Reativar a ficha
                </Botao>
              )}
              {pode('desvincular-ficha') && (
                <Botao tom="secundario" onClick={() => aoPedir('desvincular-ficha')}>
                  <Unlink size={15} aria-hidden="true" />
                  Desligar da conta
                </Botao>
              )}
            </Botoes>
            )}

            {ficha && !ficha.ativo && ficha.usuarioId !== null && !pode('reativar-ficha') && (
              <Nota>
                Reativar uma ficha ligada a uma conta devolve o ponto a essa conta — é com{' '}
                {quemResolve ?? RESERVA_DO_SUPER_ADMIN}.
              </Nota>
            )}
          </Bloco>

          {/* ---------------- Administração e PIN ---------------- */}
          {temConta && (
            <Bloco titulo="Administração e PIN">
              {pessoa.concessao && (
                <Nota>
                  Administra desde {formatarMomento(pessoa.concessao.concedidoEm)}
                  {pessoa.concessao.observacao ? ` — ${pessoa.concessao.observacao}` : ''}
                </Nota>
              )}
              <Botoes>
                {pode('resetar-pin') && (
                  <Botao tom="secundario" onClick={() => aoPedir('resetar-pin')}>
                    <KeyRound size={15} aria-hidden="true" />
                    Resetar PIN
                  </Botao>
                )}
                {pode('revogar') && (
                  <Botao tom="secundario" onClick={() => aoPedir('revogar')}>
                    <ShieldMinus size={15} aria-hidden="true" />
                    Revogar admin
                  </Botao>
                )}
                {pode('conceder') && (
                  <Botao tom="secundario" onClick={() => aoPedir('conceder')}>
                    <ShieldPlus size={15} aria-hidden="true" />
                    Conceder admin
                  </Botao>
                )}
              </Botoes>
              {pessoa.contaApagada && !pessoa.administra && (
                <Nota>
                  Esta conta não existe mais e não pode receber a administração do ponto: seria uma
                  permissão que ninguém exerce e da qual ninguém lembra.
                </Nota>
              )}
              {mostrarQuemResolve && <Nota>Dar ou tirar a administração: só {quemResolve}.</Nota>}
            </Bloco>
          )}
        </div>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* A seção                                                             */
/* ------------------------------------------------------------------ */

type Pedido =
  | { tipo: 'confirmar'; pedido: PedidoDeConfirmacao }
  | { tipo: 'conta'; acao: AcaoDeConta; pessoa: PessoaDaAdministracao & { usuarioId: string } }
  | { tipo: 'nova-conta'; ficha: FichaDoFuncionario | null }
  | { tipo: 'vinculo'; pessoa: PessoaDaAdministracao; preEscolhida: string | null }
  | {
      tipo: 'ficha'
      ficha: FichaDoFuncionario | null
      usuarioId: string | null
      nomeInicial: string
      rotuloDaConta: string | null
    }
  | { tipo: 'ativo'; ficha: FichaDoFuncionario }

/** A frase de sucesso, com o tom: `atencao` quando deu certo pela metade. */
interface Feito {
  texto: string
  tom: 'bom' | 'atencao'
}

/** O feito na tela, com a vez: cada ação nova recomeça o recado. */
type FeitoNaTela = Feito & { vez: number }

/** O que falta à ficha nova: tudo vazio, só o nome e a conta. */
function fichaSoComNome(nomeCompleto: string, usuarioId: string): RascunhoDaFicha {
  return {
    nomeCompleto,
    cpf: '',
    matricula: '',
    cargo: '',
    admissao: '',
    desligamento: '',
    ctps: '',
    ctpsSerie: '',
    centroCusto: '',
    usuarioId,
    batePontoDesde: '',
  }
}

/** "Maria Souza — maria@…", para mostrar a conta de uma ficha. */
function rotuloDaConta(pessoa: PessoaDaAdministracao | undefined): string | null {
  if (!pessoa || pessoa.usuarioId === null) return null
  return pessoa.email ? `${pessoa.nome} — ${pessoa.email}` : pessoa.nome
}

/**
 * `aoResumir`: a página inicial da administração mostra o número de
 * pessoas e as pendências delas, e o tira DAQUI, da mesma leitura — e não de
 * uma segunda rodada das seis consultas. Chamado a cada mudança: carregando,
 * falhou ou pronto, com o mesmo `resumirPessoas` do cabeçalho desta lista.
 */
export function ListaDePessoas({
  aoResumir,
}: {
  aoResumir?: (leitura: Contagem<ResumoDePessoas>) => void
} = {}) {
  const [parametros, setParametros] = useSearchParams()
  const { acesso, usuario } = useAuth()
  const papel: PapelNaAdministracao = papelNaAdministracao(acesso)

  const padrao = useMemo(() => periodoPadrao(), [])
  const mesCorrente = useMemo(() => mesDe(diaCivilDeHoje()), [])
  const periodo = lerPeriodo(parametros.get('de'), parametros.get('ate'), padrao)

  const [dados, setDados] = useState<Dados>(VAZIO)
  /** Sem lista na tela: a primeira leitura, a troca de período ou a volta de um erro. */
  const [carregando, setCarregando] = useState(true)
  /** Relendo depois de uma ação, com a lista de antes ainda na tela. */
  const [atualizando, setAtualizando] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const [busca, setBusca] = useState('')
  const [abertaChave, setAbertaChave] = useState<string | null>(null)

  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [gravando, setGravando] = useState(false)
  const [erros, setErros] = useState<string[]>([])
  const [feito, setFeito] = useState<FeitoNaTela | null>(null)
  const vezes = useRef(0)

  useEffect(() => {
    let vivo = true
    void buscar({ inicio: periodo.inicio, fim: periodo.fim }).then((resultado) => {
      if (!vivo) return
      setDados(resultado)
      setCarregando(false)
      setAtualizando(false)
    })
    return () => {
      vivo = false
    }
  }, [periodo.inicio, periodo.fim, tentativa])

  const pessoas = useMemo(
    () =>
      montarPessoas({
        funcionarios: dados.funcionarios,
        administradores: dados.administradores,
        estadosDoPin: dados.estadosDoPin,
        batidas: dados.batidas,
        fichas: dados.fichas,
        superAdmins: dados.superAdmins,
      }),
    [dados],
  )
  // O que é pendência (sem acesso, sem PIN) é decidido em `resumirPessoas`.
  const resumo = useMemo(() => resumirPessoas(pessoas), [pessoas])

  useEffect(() => {
    if (!aoResumir) return
    if (carregando) aoResumir({ estado: 'carregando' })
    else if (dados.erro) aoResumir({ estado: 'falhou' })
    else aoResumir({ estado: 'pronto', valor: resumo })
  }, [aoResumir, carregando, dados.erro, resumo])
  const visiveis = useMemo(() => filtrarPessoas(pessoas, busca), [pessoas, busca])
  // As contas do ponto sem ficha (`ponto_contas()`): é ligando a ficha a uma
  // delas que o funcionário novo passa a bater.
  const contasLivres = useMemo(() => contasSemFicha(pessoas), [pessoas])

  /*
   * A SUGESTÃO DE VÍNCULO DE CADA LINHA, calculada uma vez por leitura: para a
   * ficha sem conta, a conta mais provável; para a conta sem ficha, a ficha.
   * Só aparece para quem pode ligar (o super admin) — `LinhaDePessoa` confere.
   */
  const sugestoes = useMemo(() => {
    const mapa = new Map<string, SugestaoDaLinha>()
    for (const pessoa of pessoas) {
      if (pessoa.usuarioId === null && pessoa.ficha) {
        const lista = sugerirContasParaFicha(pessoa.ficha, contasLivres, dados.fichas)
        if (lista.length > 0) {
          mapa.set(pessoa.chave, {
            id: lista[0].item.usuarioId,
            titulo: lista[0].item.nome,
            forca: lista[0].forca,
            empatadas: lista.filter((sugestao) => sugestao.forca === lista[0].forca).length,
          })
        }
      } else if (pessoa.usuarioId !== null && !pessoa.ficha && !pessoa.contaApagada) {
        const conta: ContaParaVinculo = {
          usuarioId: pessoa.usuarioId,
          nome: pessoa.nome,
          email: pessoa.email,
        }
        const lista = sugerirFichasParaConta(conta, dados.fichas)
        if (lista.length > 0) {
          mapa.set(pessoa.chave, {
            id: lista[0].item.id,
            titulo: lista[0].item.nomeCompleto,
            forca: lista[0].forca,
            empatadas: lista.filter((sugestao) => sugestao.forca === lista[0].forca).length,
          })
        }
      }
    }
    return mapa
  }, [pessoas, contasLivres, dados.fichas])

  const gerais = acoesGerais(papel)
  /*
   * Quem resolve o que só o super admin faz, para os textos de quem administra
   * sem ser super admin. Para o super admin, nada: ele mesmo resolve.
   */
  const quemResolve = papel === 'super_admin' ? null : quemEhOSuperAdmin(pessoas)

  /** Do zero: a volta de um erro (sem lista nenhuma na tela). */
  function recarregar() {
    setCarregando(true)
    setDados(VAZIO)
    setTentativa((n) => n + 1)
  }

  /**
   * RELER SEM ZERAR: depois de uma ação, a lista de antes fica na tela
   * com um "Atualizando…", e a linha aberta continua aberta.
   */
  function atualizar() {
    if (dados.erro) {
      recarregar()
      return
    }
    setAtualizando(true)
    setTentativa((n) => n + 1)
  }

  function trocarPeriodo(novo: Periodo) {
    setCarregando(true)
    setDados(VAZIO)
    setParametros(parametrosDoPeriodo(novo), { replace: true })
  }

  function abrir(novo: Pedido) {
    setErros([])
    setFeito(null)
    setPedido(novo)
  }

  /** Uma ação pedida na linha vira a caixa certa. */
  function pedirNaLinha(pessoa: PessoaDaAdministracao, acao: AcaoSobrePessoa, preEscolhida?: string) {
    switch (acao) {
      case 'conceder':
      case 'revogar':
      case 'resetar-pin':
      case 'desvincular-ficha':
        abrir({ tipo: 'confirmar', pedido: { acao, pessoa } })
        return
      case 'trocar-nome':
      case 'trocar-email':
      case 'redefinir-senha':
        if (pessoa.usuarioId === null) return
        abrir({ tipo: 'conta', acao, pessoa: { ...pessoa, usuarioId: pessoa.usuarioId } })
        return
      case 'vincular-ficha':
        abrir({ tipo: 'vinculo', pessoa, preEscolhida: preEscolhida ?? null })
        return
      case 'criar-conta':
        abrir({ tipo: 'nova-conta', ficha: pessoa.ficha })
        return
      case 'criar-ficha':
        abrir({
          tipo: 'ficha',
          ficha: null,
          usuarioId: pessoa.usuarioId,
          nomeInicial: pessoa.nome,
          rotuloDaConta: rotuloDaConta(pessoa),
        })
        return
      case 'editar-ficha':
        if (!pessoa.ficha) return
        abrir({
          tipo: 'ficha',
          ficha: pessoa.ficha,
          usuarioId: pessoa.ficha.usuarioId,
          nomeInicial: '',
          rotuloDaConta: rotuloDaConta(pessoa),
        })
        return
      case 'desativar-ficha':
      case 'reativar-ficha':
        if (!pessoa.ficha) return
        abrir({ tipo: 'ativo', ficha: pessoa.ficha })
        return
    }
  }

  /**
   * Executa um trabalho confirmado numa caixa.
   *
   * DEPOIS DE GRAVAR, A LISTA É RELIDA DO BANCO INTEIRA — e não remendada na
   * memória. Conceder muda a ordem, ligar uma ficha muda o acesso, trocar o
   * e-mail muda a linha; costurar isso à mão seria reimplementar
   * `montarPessoas` no meio de um `setState`.
   *
   * Na FALHA a caixa continua aberta com a frase, e a lista só é relida quando
   * a conta PODE ter mudado mesmo com o erro (`falhaPedeReleitura`): a ação
   * aconteceu e a trilha não gravou, ficou pela metade, ou não houve resposta.
   */
  async function executar(trabalho: () => Promise<Feito>) {
    setGravando(true)
    setErros([])
    try {
      const resultado = await trabalho()
      vezes.current += 1
      setFeito({ ...resultado, vez: vezes.current })
      setPedido(null)
      atualizar()
    } catch (falha) {
      setErros(frasesDe(falha, 'Não deu para concluir a ação.'))
      if (falha instanceof ErroDeConta && falhaPedeReleitura(falha.falha)) atualizar()
    } finally {
      setGravando(false)
    }
  }

  function confirmar(alvo: PedidoDeConfirmacao, observacao: string) {
    const { acao, pessoa } = alvo
    void executar(async () => {
      switch (acao) {
        case 'conceder':
          if (pessoa.usuarioId === null) throw new Error('Esta pessoa não tem conta.')
          await concederAdministracao(pessoa.usuarioId, observacao)
          return { texto: `${pessoa.nome} passou a administrar o ponto.`, tom: 'bom' }
        case 'revogar':
          if (pessoa.usuarioId === null) throw new Error('Esta pessoa não tem conta.')
          await revogarAdministracao(pessoa.usuarioId)
          return {
            texto: `${pessoa.nome} não administra mais o ponto. O painel fecha para ela na próxima recarga.`,
            tom: 'bom',
          }
        case 'resetar-pin': {
          if (pessoa.usuarioId === null) throw new Error('Esta pessoa não tem conta.')
          const resultado = await resetarPinDeUsuario(pessoa.usuarioId)
          return {
            texto: resultado.tinha_pin
              ? `PIN resetado. Na próxima entrada, ${pessoa.nome} define um PIN novo.`
              : `Esta conta ainda não tinha PIN. Na próxima entrada, ${pessoa.nome} define o primeiro.`,
            tom: 'bom',
          }
        }
        case 'desvincular-ficha': {
          if (!pessoa.ficha) throw new Error('Esta pessoa não tem ficha ligada.')
          const ficha = await desvincularFicha(pessoa.ficha.id)
          return { texto: `A ficha “${ficha.nomeCompleto}” não é mais da conta de ${pessoa.nome}.`, tom: 'bom' }
        }
      }
    })
  }

  function mudarConta(corpo: CorpoDoPedidoDeConta) {
    void executar(async () => {
      const sucesso = await pedirAcaoDeConta(corpo)
      return { texto: sucesso.mensagem, tom: 'bom' }
    })
  }

  /**
   * Cria a conta e, com ela criada, liga ou cria a ficha. As duas partes são
   * duas gravações (a conta na Edge Function, a ficha no banco com a sessão do
   * super admin), e a segunda pode falhar sozinha: nesse caso a conta FICA
   * criada, e a frase diz que falta ligar a ficha — em vez de fingir que nada
   * aconteceu.
   */
  function criarConta(pedidoDaConta: { corpo: CorpoDoPedidoDeConta; ficha: FichaDaContaNova }) {
    void executar(async () => {
      const sucesso = await pedirAcaoDeConta(pedidoDaConta.corpo)
      const novaConta = sucesso.usuarioId
      // A linha nova abre sozinha quando a lista voltar (a chave da linha é a conta).
      if (novaConta) setAbertaChave(novaConta)
      const { ficha } = pedidoDaConta
      const corpo = pedidoDaConta.corpo
      const email = corpo.acao === 'criar_conta' ? corpo.email : ''
      const nome = corpo.acao === 'criar_conta' ? corpo.nome : ''

      if (ficha.tipo === 'nenhuma') return { texto: sucesso.mensagem, tom: 'bom' }
      if (!novaConta) {
        return {
          texto: `${sucesso.mensagem} A ficha NÃO foi ligada: a função não devolveu o id da conta nova. Recarregue e ligue pela linha da pessoa.`,
          tom: 'atencao',
        }
      }
      try {
        if (ficha.tipo === 'existente') {
          await vincularFicha(ficha.ficha.id, novaConta)
        } else {
          const leitura = validarFicha(fichaSoComNome(nome, novaConta))
          if (!leitura.ok) throw new Error(leitura.erros.join(' '))
          await salvarFicha(null, leitura.valor)
        }
      } catch (falha) {
        return {
          texto: `Conta criada para ${email}, mas a ficha NÃO foi ligada: ${frasesDe(falha, 'erro desconhecido').join(' ')} A conta existe; ligue a ficha pela linha da pessoa.`,
          tom: 'atencao',
        }
      }
      return {
        texto:
          ficha.tipo === 'existente'
            ? `Conta criada para ${email} e ligada à ficha “${ficha.ficha.nomeCompleto}”: a pessoa já entra com a senha provisória e bate ponto. Passe a senha por um canal seguro.`
            : `Conta criada para ${email}, com uma ficha nova no nome de ${nome}: a pessoa já entra com a senha provisória e bate ponto. Complete a ficha (CPF, cargo, admissão) em “Editar a ficha”.`,
        tom: 'bom',
      }
    })
  }

  function ligar(fichaId: string, usuarioId: string) {
    void executar(async () => {
      const ficha = await vincularFicha(fichaId, usuarioId)
      const conta = pessoas.find((pessoa) => pessoa.usuarioId === usuarioId)
      return {
        texto: `A ficha “${ficha.nomeCompleto}” agora é da conta ${conta?.email ?? conta?.nome ?? ''}${ficha.ativo ? ': a pessoa já bate ponto por ela' : ''}.`,
        tom: 'bom',
      }
    })
  }

  function gravarFicha(alvo: Extract<Pedido, { tipo: 'ficha' }>, rascunho: RascunhoDaFicha) {
    const leitura = validarFicha(rascunho)
    // A caixa já validou; esta é a rede para o caso de ela ser chamada de outro
    // lugar amanhã. Sem ela, um rascunho ruim iria cru para o banco.
    if (!leitura.ok) {
      setErros(leitura.erros)
      return
    }
    void executar(async () => {
      const gravada = await salvarFicha(alvo.ficha?.id ?? null, leitura.valor)
      return {
        texto: alvo.ficha
          ? `Ficha de ${gravada.nomeCompleto} salva.`
          : `Ficha de ${gravada.nomeCompleto} criada${gravada.usuarioId ? ' e ligada à conta' : ''}.`,
        tom: 'bom',
      }
    })
  }

  function trocarAtivo(ficha: FichaDoFuncionario) {
    void executar(async () => {
      const gravada = await definirAtivoDaFicha(ficha.id, !ficha.ativo)
      return {
        texto: gravada.ativo
          ? `A ficha de ${gravada.nomeCompleto} voltou para a lista de gente ativa.`
          : `A ficha de ${gravada.nomeCompleto} foi desativada. Nada foi apagado.`,
        tom: 'bom',
      }
    })
  }

  const fechar = () => setPedido(null)

  /** As linhas da lista. */
  const desenharLinhas = (linhas: readonly PessoaDaAdministracao[]) => (
    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
      {linhas.map((pessoa) => (
        <LinhaDePessoa
          key={pessoa.chave}
          pessoa={pessoa}
          acoes={acoesDaPessoa(pessoa, papel, usuario?.id ?? null)}
          periodo={periodo}
          aberta={abertaChave === pessoa.chave}
          sugestao={sugestoes.get(pessoa.chave) ?? null}
          aoAbrir={() =>
            setAbertaChave((antes) => (antes === pessoa.chave ? null : pessoa.chave))
          }
          aoPedir={(acao, preEscolhida) => pedirNaLinha(pessoa, acao, preEscolhida)}
          quemResolve={quemResolve}
        />
      ))}
    </ul>
  )

  return (
    <Cartao>
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-2 text-luz">
          <ShieldCheck size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-plat">Pessoas</h2>
          <p className="mt-0.5 text-[0.7rem] leading-relaxed text-mute">
            {papel === 'super_admin'
              ? 'Conta, ficha, administração e PIN de cada pessoa, num lugar só. Cada ação pede confirmação, e quem recusa de verdade é o banco.'
              : `Conta, ficha, administração e PIN de cada pessoa. Você reseta PIN e cuida das fichas; criar login, trocar e-mail e dar acesso é com ${quemResolve ?? RESERVA_DO_SUPER_ADMIN}.`}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <SeletorDePeriodo
          periodo={periodo}
          aoTrocar={trocarPeriodo}
          mesCorrente={mesCorrente}
          desabilitado={carregando}
        />

        {dados.erro && (
          <div className="space-y-2">
            <Aviso tom="atencao">{dados.erro}</Aviso>
            <Botao tom="secundario" onClick={recarregar} disabled={carregando}>
              <RefreshCw size={15} aria-hidden="true" />
              {carregando ? 'Carregando…' : 'Tentar de novo'}
            </Botao>
          </div>
        )}

        {!dados.erro && carregando && <p className="text-sm text-mute">Carregando as pessoas…</p>}

        {!dados.erro && !carregando && (
          <>
            <p className="text-[0.7rem] leading-relaxed text-mute">
              {resumo.total} {resumo.total === 1 ? 'pessoa' : 'pessoas'} ·{' '}
              <span className="text-luz">
                {resumo.administradores}{' '}
                {resumo.administradores === 1 ? 'administra' : 'administram'} o ponto
              </span>
              {resumo.semAcesso > 0 && (
                <span className="text-warn"> · {resumo.semAcesso} sem acesso ao ponto</span>
              )}
              {resumo.fichasSemConta > 0 && (
                <span className="text-warn"> · {resumo.fichasSemConta} ficha(s) sem conta</span>
              )}
              {resumo.semPin > 0 && <span className="text-warn"> · {resumo.semPin} sem PIN</span>}
              {resumo.bloqueados > 0 && (
                <span className="text-warn"> · {resumo.bloqueados} bloqueado(s)</span>
              )}
              {atualizando && (
                <span className="inline-flex items-center gap-1 text-mute">
                  {' · '}
                  <RefreshCw size={11} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                  Atualizando…
                </span>
              )}
            </p>

            {resumo.naoBatemAqui > 0 && (
              <Aviso tom="neutro">
                <span className="inline-flex items-start gap-1.5">
                  <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>
                    {resumo.naoBatemAqui} ficha(s) ativa(s) ainda sem “passou a bater ponto aqui em”.
                    A data é só registro: aparece nesta lista e não muda a batida nem a folha.
                    Preencha quando cada pessoa começar de verdade.
                  </span>
                </span>
              </Aviso>
            )}

            {/*
              A busca. Rolar até o fim para resetar um PIN, num celular, é o
              atrito que faz o admin voltar a pedir por WhatsApp. Ignora acento
              e caixa, e acha também pelo CPF, cargo e matrícula da ficha — ver
              `filtrarPessoas`.
            */}
            <div className="relative">
              <Search
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint"
              />
              <input
                id="busca-de-pessoas"
                aria-label="Buscar pessoa por nome, e-mail, CPF, cargo ou matrícula"
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Buscar por nome, e-mail ou CPF"
                className="w-full min-h-11 rounded-xl border border-hair-2 bg-ink-2 py-3 pr-4 pl-10 text-sm text-plat placeholder:text-faint focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25"
              />
            </div>

            {gerais.length > 0 && (
              <Botoes>
                {gerais.includes('nova-conta') && (
                  <Botao onClick={() => abrir({ tipo: 'nova-conta', ficha: null })}>
                    <UserPlus size={16} aria-hidden="true" />
                    Nova conta
                  </Botao>
                )}
                {gerais.includes('nova-ficha') && (
                  <Botao
                    tom={gerais.includes('nova-conta') ? 'secundario' : 'primario'}
                    onClick={() =>
                      abrir({ tipo: 'ficha', ficha: null, usuarioId: null, nomeInicial: '', rotuloDaConta: null })
                    }
                  >
                    <IdCard size={16} aria-hidden="true" />
                    Nova ficha sem conta
                  </Botao>
                )}
              </Botoes>
            )}

            {/* O feito pela metade fica na lista, e não no recado que some em 8 s: ele pede ação. */}
            {feito?.tom === 'atencao' && <Aviso tom="atencao">{feito.texto}</Aviso>}
            {/* O erro fora da caixa: a caixa fecha ao dar certo, e uma falha
                que aconteceu depois de fechar precisa de onde aparecer. */}
            {erros.length > 0 && !pedido && <Recusas erros={erros} />}

            {visiveis.length === 0 ? (
              <p className="py-4 text-center text-sm leading-relaxed text-mute">
                {pessoas.length === 0
                  ? 'Ninguém na lista: nenhuma conta nem ficha do ponto. Recarregue a página; se persistir, confirme que sua sessão continua administrando o ponto.'
                  : `Ninguém com “${busca}” no nome, no e-mail ou na ficha.`}
              </p>
            ) : (
              /*
                DUAS COLUNAS NO COMPUTADOR. Em coluna única, num monitor de
                1280 px, a lista rolava por três telas com 60% da largura vazia.
                `lg:items-start` para a linha ABERTA crescer sozinha, sem esticar
                a vizinha junto. Continua sendo cartão, e não tabela, em qualquer
                largura: nome, e-mail, etiquetas e contagem não cabem em colunas
                de 60 px sem virar abreviação.
              */
              desenharLinhas(visiveis)
            )}

            <p className="text-[0.68rem] leading-relaxed text-faint">
              A contagem é de batidas em {rotuloDoPeriodo(periodo)} — ela responde “esta pessoa
              está usando o sistema?”, e não “quantas horas ela fez”. As horas saem do painel de
              fechamento, pela mesma conta que o funcionário vê no próprio espelho.
            </p>
          </>
        )}
      </div>

      {/*
        AS CAIXAS. A `key` remonta cada uma a cada pedido: sem ela, o campo da
        caixa anterior (observação, senha, nome) ficaria na seguinte.

        FECHAR NÃO APAGA O ERRO. Se a gravação falhou, a frase da recusa
        continua na tela depois de a caixa sumir — é a única forma de o banco
        explicar "este é o último administrador" para quem já fechou o diálogo.
        Quem limpa é o próximo pedido, em `abrir()`.
      */}
      {pedido?.tipo === 'confirmar' && (
        <CaixaDeConfirmacao
          key={`${pedido.pedido.acao}-${pedido.pedido.pessoa.chave}`}
          pedido={pedido.pedido}
          gravando={gravando}
          erros={erros}
          aoConfirmar={(observacao) => confirmar(pedido.pedido, observacao)}
          aoFechar={fechar}
        />
      )}

      {pedido?.tipo === 'conta' && (
        <FormularioDeConta
          key={`${pedido.acao}-${pedido.pessoa.chave}`}
          acao={pedido.acao}
          pessoa={pedido.pessoa}
          gravando={gravando}
          erros={erros}
          aoEnviar={mudarConta}
          aoFechar={fechar}
        />
      )}

      {pedido?.tipo === 'nova-conta' && (
        <FormularioDeNovaConta
          key={`nova-conta-${pedido.ficha?.id ?? 'livre'}`}
          fichas={dados.fichas}
          fichaFixa={pedido.ficha}
          gravando={gravando}
          erros={erros}
          aoCriar={criarConta}
          aoFechar={fechar}
        />
      )}

      {pedido?.tipo === 'vinculo' && (
        <CaixaDeVinculo
          key={`vinculo-${pedido.pessoa.chave}-${pedido.preEscolhida ?? ''}`}
          pessoa={pedido.pessoa}
          fichas={dados.fichas}
          contas={contasLivres}
          preEscolhida={pedido.preEscolhida}
          gravando={gravando}
          erro={erros.length > 0 ? erros.join(' ') : null}
          aoLigar={ligar}
          aoFechar={fechar}
        />
      )}

      {pedido?.tipo === 'ficha' && (
        <FormularioDaFicha
          key={`ficha-${pedido.ficha?.id ?? `nova-${pedido.usuarioId ?? 'sem-conta'}`}`}
          ficha={pedido.ficha}
          usuarioId={pedido.usuarioId}
          nomeInicial={pedido.nomeInicial}
          rotuloDaConta={pedido.rotuloDaConta}
          gravando={gravando}
          erro={erros.length > 0 ? erros.join(' ') : null}
          aoSalvar={(rascunho) => gravarFicha(pedido, rascunho)}
          aoFechar={fechar}
        />
      )}

      {pedido?.tipo === 'ativo' && (
        <CaixaDeAtivo
          key={`ativo-${pedido.ficha.id}`}
          ficha={pedido.ficha}
          gravando={gravando}
          erro={erros.length > 0 ? erros.join(' ') : null}
          aoConfirmar={() => trocarAtivo(pedido.ficha)}
          aoFechar={fechar}
        />
      )}

      {/* O que foi feito, no rodapé (o `Recado`), enquanto a lista se atualiza. */}
      <Recado
        chave={feito?.vez ?? 0}
        texto={feito?.tom === 'bom' && !pedido ? feito.texto : null}
        aoFechar={() => setFeito(null)}
      />
    </Cartao>
  )
}
