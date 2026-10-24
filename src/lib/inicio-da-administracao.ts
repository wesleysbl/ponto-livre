import { ehAtiva, type Ausencia } from './ausencias'
import {
  camposFaltandoDaEmpresa,
  escreverDuracao,
  type ConfiguracaoDoPonto,
  type LocalDoPonto,
} from './configuracao'
import { formatarMomento } from './formato'
import type { resumirPessoas } from './pessoas'

/*
 * A PÁGINA INICIAL DA ADMINISTRAÇÃO — seis seções, cada uma com um número.
 *
 * O QUE ELA RESOLVE: o trabalho de quem administra mora em quatro lugares — as
 * pendências de atraso no topo do painel, a ausência na tela de cada pessoa, a
 * lista de pessoas e os três formulários no fim da administração. Quem abre a
 * administração no celular precisa saber, sem rolar nada, ONDE há trabalho
 * esperando. O número de cada seção é essa resposta; o botão leva até ela.
 *
 * FUNÇÃO PURA, E NÃO DENTRO DO COMPONENTE: são seis seções, cada uma com três
 * estados (carregando, falhou, pronto) e as frases de singular e plural. É
 * exatamente o tipo de regra que quebra calada — "1 pedidos", um "0" que na
 * verdade é "não deu para ler" — e que só se testa bem fora do React.
 *
 * NENHUM NÚMERO É INVENTADO. Leitura que ainda não chegou é "…", leitura que
 * falhou é "—" com a frase dizendo isso. Um "0" na seção de atraso quando a
 * leitura falhou diria ao admin que não há nada a decidir — e o pedido
 * pendente não conta hora.
 */

/** O estado de cada número: o mesmo trio das outras leituras do app. */
export type Contagem<T> =
  | { estado: 'carregando' }
  | { estado: 'falhou' }
  | { estado: 'pronto'; valor: T }

export type ResumoDePessoas = ReturnType<typeof resumirPessoas>

/** Quantas ausências ATIVAS tocam o mês, e de quantas pessoas. */
export interface ContagemDeAusencias {
  ausencias: number
  pessoas: number
}

export interface EntradaDoInicio {
  pendencias: Contagem<number>
  pessoas: Contagem<ResumoDePessoas>
  ausencias: Contagem<ContagemDeAusencias>
  /** "Outubro de 2026": o mês das ausências contadas. */
  rotuloDoMes: string
  configuracao: Contagem<{ configuracao: ConfiguracaoDoPonto | null; local: LocalDoPonto | null }>
}

export type ChaveDaSecao = 'atraso' | 'pessoas' | 'ausencias' | 'local' | 'empresa' | 'jornada'

/**
 * Para onde o botão da seção leva. `rota` troca de tela; `secao` rola até o
 * bloco desta mesma página, pelo `id` dele.
 */
export type DestinoDaSecao = { tipo: 'rota'; para: string } | { tipo: 'secao'; id: string }

export type TomDaSecao = 'aviso' | 'neutro' | 'bom'

export interface SecaoDoInicio {
  chave: ChaveDaSecao
  titulo: string
  /** O contador: "3", "150 m", "08:00"; "…" carregando, "—" sem leitura. */
  numero: string
  /** O que o número conta, em minúsculas, logo abaixo dele. */
  legenda: string
  detalhe: string
  tom: TomDaSecao
  acao: string
  destino: DestinoDaSecao
}

/** Os `id` dos blocos da página, para o botão rolar até eles. */
export const ID_DA_SECAO = {
  pessoas: 'secao-pessoas',
  local: 'secao-local',
  empresa: 'secao-empresa',
  jornada: 'secao-jornada',
  /**
   * O aviso de erro (ou o "Carregando…") da configuração. Os três formulários
   * só existem na página quando a leitura deu certo; antes disso, o botão do
   * local, da empresa e da jornada rola até aqui — e não até um bloco que não
   * está na tela, o que deixaria o botão mudo justo quando há erro a ver.
   */
  configuracao: 'secao-configuracao',
} as const

/** Para onde vão local, empresa e jornada enquanto os formulários não estão na tela. */
const DESTINO_SEM_FORMULARIO = { tipo: 'secao', id: ID_DA_SECAO.configuracao } as const

const CARREGANDO = 'Carregando…'

/** "1 pedido", "2 pedidos" — e nunca "1 pedidos". */
function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * Conta as ausências que ainda valem. A leitura do período traz também as
 * canceladas (o painel as mostra riscadas), e uma ausência cancelada não é
 * trabalho de ninguém.
 */
export function contarAusenciasAtivas(
  ausencias: readonly Pick<Ausencia, 'usuario_id' | 'cancelada_em'>[],
): ContagemDeAusencias {
  const ativas = ausencias.filter(ehAtiva)
  return {
    ausencias: ativas.length,
    pessoas: new Set(ativas.map((ausencia) => ausencia.usuario_id)).size,
  }
}

function secaoDeAtraso(pendencias: Contagem<number>): SecaoDoInicio {
  const base = {
    chave: 'atraso' as const,
    titulo: 'Batidas em atraso',
    acao: 'Decidir no painel',
    destino: { tipo: 'rota', para: '/painel' } as const,
  }
  if (pendencias.estado === 'carregando') {
    return { ...base, numero: '…', legenda: 'pedidos esperando decisão', detalhe: CARREGANDO, tom: 'neutro' }
  }
  if (pendencias.estado === 'falhou') {
    return {
      ...base,
      numero: '—',
      legenda: 'pedidos esperando decisão',
      detalhe: 'Não deu para ler os pedidos. O painel mostra o motivo e deixa tentar de novo.',
      tom: 'aviso',
    }
  }
  const n = pendencias.valor
  return {
    ...base,
    numero: String(n),
    legenda: n === 1 ? 'pedido esperando decisão' : 'pedidos esperando decisão',
    detalhe:
      n === 0
        ? 'Nenhum pedido esperando.'
        : 'Pedido pendente não conta hora: o total do mês ainda muda quando ele for decidido.',
    tom: n === 0 ? 'bom' : 'aviso',
  }
}

function secaoDePessoas(pessoas: Contagem<ResumoDePessoas>): SecaoDoInicio {
  const base = {
    chave: 'pessoas' as const,
    titulo: 'Pessoas',
    acao: 'Ver a lista',
    destino: { tipo: 'secao', id: ID_DA_SECAO.pessoas } as const,
  }
  if (pessoas.estado === 'carregando') {
    return { ...base, numero: '…', legenda: 'pessoas', detalhe: CARREGANDO, tom: 'neutro' }
  }
  if (pessoas.estado === 'falhou') {
    return {
      ...base,
      numero: '—',
      legenda: 'pessoas',
      detalhe: 'Não deu para ler a lista. Ela mostra o motivo logo abaixo.',
      tom: 'aviso',
    }
  }
  const resumo = pessoas.valor
  /*
   * SÓ O QUE ALGUÉM CONSEGUE RESOLVER PELA TELA vira pendência. "Sem PIN" não
   * entra no tom de aviso: a pessoa cria o PIN sozinha na primeira entrada, e
   * a maioria das fichas nem tem conta. Entra na frase, para ser vista.
   */
  const pendencias = [
    resumo.semAcesso > 0 && contar(resumo.semAcesso, 'conta sem acesso', 'contas sem acesso'),
    resumo.fichasSemConta > 0 && contar(resumo.fichasSemConta, 'ficha sem conta', 'fichas sem conta'),
    resumo.bloqueados > 0 && contar(resumo.bloqueados, 'PIN bloqueado', 'PINs bloqueados'),
    resumo.semPin > 0 && contar(resumo.semPin, 'conta sem PIN', 'contas sem PIN'),
  ].filter((frase): frase is string => typeof frase === 'string')
  const resolver = resumo.semAcesso + resumo.fichasSemConta + resumo.bloqueados
  return {
    ...base,
    numero: String(resumo.total),
    legenda: resumo.total === 1 ? 'pessoa' : 'pessoas',
    detalhe:
      pendencias.length === 0
        ? `${contar(resumo.administradores, 'administra', 'administram')} o ponto. Nada pendente.`
        : pendencias.join(' · '),
    tom: resolver > 0 ? 'aviso' : 'neutro',
  }
}

function secaoDeAusencias(ausencias: Contagem<ContagemDeAusencias>, rotuloDoMes: string): SecaoDoInicio {
  const base = {
    chave: 'ausencias' as const,
    titulo: 'Ausências',
    acao: 'Lançar pela tela da pessoa',
    // A ausência se lança na tela da pessoa (/painel/:id), que se abre pelo
    // painel. Não há lista geral de ausências para onde mandar.
    destino: { tipo: 'rota', para: '/painel' } as const,
  }
  const legenda = `em ${rotuloDoMes.toLowerCase()}`
  if (ausencias.estado === 'carregando') {
    return { ...base, numero: '…', legenda, detalhe: CARREGANDO, tom: 'neutro' }
  }
  if (ausencias.estado === 'falhou') {
    return {
      ...base,
      numero: '—',
      legenda,
      detalhe: 'Não deu para ler as ausências do mês. O painel mostra o motivo.',
      tom: 'aviso',
    }
  }
  const { ausencias: n, pessoas } = ausencias.valor
  return {
    ...base,
    numero: String(n),
    legenda: `${n === 1 ? 'ausência' : 'ausências'} ${legenda}`,
    detalhe:
      n === 0
        ? 'Nenhuma ausência lançada no mês.'
        : `${contar(pessoas, 'pessoa', 'pessoas')}. Não mudam a soma de horas: aparecem no espelho, na folha e no CSV.`,
    tom: 'neutro',
  }
}

function secaoDoLocal(configuracao: EntradaDoInicio['configuracao']): SecaoDoInicio {
  const base = {
    chave: 'local' as const,
    titulo: 'Local de trabalho',
    acao: 'Ver o local',
    destino: { tipo: 'secao', id: ID_DA_SECAO.local } as const,
  }
  if (configuracao.estado === 'carregando') {
    return { ...base, destino: DESTINO_SEM_FORMULARIO, numero: '…', legenda: 'de raio', detalhe: CARREGANDO, tom: 'neutro' }
  }
  if (configuracao.estado === 'falhou') {
    return { ...base, destino: DESTINO_SEM_FORMULARIO, numero: '—', legenda: 'de raio', detalhe: 'Não deu para ler o local.', tom: 'aviso' }
  }
  const local = configuracao.valor.local
  if (!local) {
    return {
      ...base,
      numero: '—',
      legenda: 'de raio',
      detalhe: 'Nenhum local ativo: toda batida sai "fora do local" até ele ser gravado.',
      tom: 'aviso',
    }
  }
  const numero = `${local.raioMetros} m`
  // As mesmas três situações da tela do local (`descreverMedicao`), em curto.
  if (!local.medidoEm) {
    return { ...base, numero, legenda: 'de raio', detalhe: 'Nunca foi medido de dentro do local.', tom: 'aviso' }
  }
  if (!local.medidoPor) {
    return {
      ...base,
      numero,
      legenda: 'de raio',
      detalhe: `Gravado pelo sistema em ${formatarMomento(local.medidoEm)}, sem medição no local.`,
      tom: 'neutro',
    }
  }
  return {
    ...base,
    numero,
    legenda: 'de raio',
    detalhe: `Medido em ${formatarMomento(local.medidoEm)}.`,
    tom: 'bom',
  }
}

const EMPRESA_VAZIA = {
  razaoSocial: null,
  nomeFantasia: null,
  cnpj: null,
  endereco: null,
  cidade: null,
  uf: null,
}

function secaoDaEmpresa(configuracao: EntradaDoInicio['configuracao']): SecaoDoInicio {
  const base = {
    chave: 'empresa' as const,
    titulo: 'Dados da empresa',
    acao: 'Ver os dados',
    destino: { tipo: 'secao', id: ID_DA_SECAO.empresa } as const,
  }
  const legenda = 'campos faltando na folha'
  if (configuracao.estado === 'carregando') {
    return { ...base, destino: DESTINO_SEM_FORMULARIO, numero: '…', legenda, detalhe: CARREGANDO, tom: 'neutro' }
  }
  if (configuracao.estado === 'falhou') {
    return { ...base, destino: DESTINO_SEM_FORMULARIO, numero: '—', legenda, detalhe: 'Não deu para ler a configuração.', tom: 'aviso' }
  }
  // Sem a linha de configuração, todos os campos faltam: é o que a folha imprime.
  const faltando = camposFaltandoDaEmpresa(configuracao.valor.configuracao ?? EMPRESA_VAZIA)
  return {
    ...base,
    numero: String(faltando.length),
    legenda: faltando.length === 1 ? 'campo faltando na folha' : legenda,
    detalhe:
      faltando.length === 0
        ? 'O cabeçalho da folha de ponto está completo.'
        : `Falta ${faltando.join(', ')}.`,
    tom: faltando.length === 0 ? 'bom' : 'aviso',
  }
}

function secaoDaJornada(configuracao: EntradaDoInicio['configuracao']): SecaoDoInicio {
  const base = {
    chave: 'jornada' as const,
    titulo: 'Regras de jornada',
    acao: 'Ver as regras',
    destino: { tipo: 'secao', id: ID_DA_SECAO.jornada } as const,
  }
  const legenda = 'de carga diária'
  if (configuracao.estado === 'carregando') {
    return { ...base, destino: DESTINO_SEM_FORMULARIO, numero: '…', legenda, detalhe: CARREGANDO, tom: 'neutro' }
  }
  if (configuracao.estado === 'falhou') {
    return { ...base, destino: DESTINO_SEM_FORMULARIO, numero: '—', legenda, detalhe: 'Não deu para ler a configuração.', tom: 'aviso' }
  }
  const regras = configuracao.valor.configuracao
  if (!regras) {
    return {
      ...base,
      numero: '—',
      legenda,
      detalhe: 'Ainda sem configuração gravada: valem os padrões do banco.',
      tom: 'aviso',
    }
  }
  return {
    ...base,
    numero: escreverDuracao(regras.cargaDiariaMinutos),
    legenda,
    detalhe: `Tolerância de ${regras.toleranciaMinutos} min · batida repetida recusada em ${regras.janelaDuplicidadeSegundos} s.`,
    tom: 'neutro',
  }
}

/**
 * As seis seções, NA ORDEM DE URGÊNCIA: o que espera decisão de alguém
 * (atraso), o que se mexe toda semana (pessoas, ausências) e o que se mexe uma
 * vez por ano (local, empresa, jornada). É a mesma ordem da página embaixo.
 */
export function montarInicioDaAdministracao(entrada: EntradaDoInicio): SecaoDoInicio[] {
  return [
    secaoDeAtraso(entrada.pendencias),
    secaoDePessoas(entrada.pessoas),
    secaoDeAusencias(entrada.ausencias, entrada.rotuloDoMes),
    secaoDoLocal(entrada.configuracao),
    secaoDaEmpresa(entrada.configuracao),
    secaoDaJornada(entrada.configuracao),
  ]
}
