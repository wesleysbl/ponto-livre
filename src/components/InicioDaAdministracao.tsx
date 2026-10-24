import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  CalendarX2,
  ChevronRight,
  Clock,
  Hourglass,
  MapPin,
  Users,
} from 'lucide-react'
import { lerAusenciasDoPeriodo } from '../lib/faltas'
import { pedidosPendentes } from '../lib/atraso'
import { lerPedidosPendentes } from '../lib/pedidos'
import { periodoPadrao, rotuloDoPeriodo } from '../lib/periodo'
import {
  contarAusenciasAtivas,
  montarInicioDaAdministracao,
  type ChaveDaSecao,
  type Contagem,
  type ContagemDeAusencias,
  type EntradaDoInicio,
  type ResumoDePessoas,
  type SecaoDoInicio,
  type TomDaSecao,
} from '../lib/inicio-da-administracao'

/*
 * A PÁGINA INICIAL DA ADMINISTRAÇÃO — seis cartões com contador.
 *
 * As regras de cada número moram em `lib/inicio-da-administracao.ts`. Aqui
 * ficam só as DUAS leituras que nenhuma outra parte da página faz: os pedidos
 * de atraso pendentes e as ausências do mês. O resto chega pronto de quem já o
 * leu — pessoas, da lista (`ListaDePessoas.aoResumir`); local, empresa e
 * jornada, dos formulários da própria página. Ler de novo o que a página já
 * leu seria pôr dois números diferentes da mesma coisa na mesma tela durante
 * meio segundo.
 *
 * CADA LEITURA FALHA SOZINHA. O cartão de atraso que não leu diz isso no
 * próprio cartão, e não derruba o de ausências. Nenhuma das duas é a fonte de
 * verdade de nada: a decisão do atraso mora no painel, a ausência na tela da
 * pessoa, e lá cada uma mostra o próprio erro com o "Tentar de novo".
 *
 * NO CELULAR, DUAS COLUNAS. Seis cartões empilhados empurravam a lista de
 * pessoas para a quinta tela de rolagem; dois por linha cabem em 320 px (136
 * px cada, com o número em 2xl e a legenda quebrando embaixo). Três no
 * computador, como os formulários lá embaixo.
 */

const ICONE: Record<ChaveDaSecao, ReactNode> = {
  atraso: <Hourglass size={15} aria-hidden="true" />,
  pessoas: <Users size={15} aria-hidden="true" />,
  ausencias: <CalendarX2 size={15} aria-hidden="true" />,
  local: <MapPin size={15} aria-hidden="true" />,
  empresa: <Building2 size={15} aria-hidden="true" />,
  jornada: <Clock size={15} aria-hidden="true" />,
}

const COR_DO_NUMERO: Record<TomDaSecao, string> = {
  aviso: 'text-warn',
  neutro: 'text-plat',
  bom: 'text-luz',
}

const FIO_DO_CARTAO: Record<TomDaSecao, string> = {
  aviso: 'border-warn/35',
  neutro: 'border-hair',
  bom: 'border-hair',
}

/** O desenho, sem efeitos — é o que o teste de tela desenha. */
export function CartoesDoInicio({
  secoes,
  aoIr,
}: {
  secoes: SecaoDoInicio[]
  aoIr: (secao: SecaoDoInicio) => void
}) {
  return (
    <section aria-label="Início da administração">
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        {secoes.map((secao) => (
          <li key={secao.chave} className="min-w-0">
            <button
              type="button"
              onClick={() => aoIr(secao)}
              className={`flex h-full w-full flex-col rounded-2xl border bg-ink-1 p-3 text-left transition-colors hover:border-hair-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60 sm:p-4 ${FIO_DO_CARTAO[secao.tom]}`}
            >
              <span className="flex items-center gap-1.5 text-[0.7rem] font-medium text-mute">
                <span className="text-luz">{ICONE[secao.chave]}</span>
                <span className="min-w-0 truncate">{secao.titulo}</span>
              </span>
              <span
                className={`mt-2 font-mono text-2xl font-medium tracking-tight tabular-nums ${COR_DO_NUMERO[secao.tom]}`}
              >
                {secao.numero}
              </span>
              <span className="text-[0.68rem] leading-snug text-mute">{secao.legenda}</span>
              <span className="mt-2 flex-1 text-[0.68rem] leading-relaxed text-faint">
                {secao.detalhe}
              </span>
              <span className="mt-2 inline-flex items-center gap-1 text-[0.7rem] font-semibold text-plat-dim">
                {secao.acao}
                <ChevronRight size={13} aria-hidden="true" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

async function lerPendencias(): Promise<Contagem<number>> {
  try {
    return { estado: 'pronto', valor: pedidosPendentes(await lerPedidosPendentes()).length }
  } catch {
    return { estado: 'falhou' }
  }
}

async function lerAusencias(): Promise<Contagem<ContagemDeAusencias>> {
  try {
    return { estado: 'pronto', valor: contarAusenciasAtivas(await lerAusenciasDoPeriodo(periodoPadrao())) }
  } catch {
    return { estado: 'falhou' }
  }
}

interface Props {
  pessoas: Contagem<ResumoDePessoas>
  configuracao: EntradaDoInicio['configuracao']
}

export function InicioDaAdministracao({ pessoas, configuracao }: Props) {
  const navegar = useNavigate()
  const [pendencias, setPendencias] = useState<Contagem<number>>({ estado: 'carregando' })
  const [ausencias, setAusencias] = useState<Contagem<ContagemDeAusencias>>({ estado: 'carregando' })
  // O mês das ausências é o do fuso do ponto, fixado na montagem — o mesmo
  // `periodoPadrao()` que a leitura usa, para o rótulo e o número não discordarem.
  const rotuloDoMes = useMemo(() => rotuloDoPeriodo(periodoPadrao()), [])

  useEffect(() => {
    let vivo = true
    void lerPendencias().then((leitura) => {
      if (vivo) setPendencias(leitura)
    })
    void lerAusencias().then((leitura) => {
      if (vivo) setAusencias(leitura)
    })
    return () => {
      vivo = false
    }
  }, [])

  const secoes = montarInicioDaAdministracao({ pendencias, pessoas, ausencias, rotuloDoMes, configuracao })

  function ir(secao: SecaoDoInicio) {
    if (secao.destino.tipo === 'rota') {
      navegar(secao.destino.para)
      return
    }
    document.getElementById(secao.destino.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return <CartoesDoInicio secoes={secoes} aoIr={ir} />
}
