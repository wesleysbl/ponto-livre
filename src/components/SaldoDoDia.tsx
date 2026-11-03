import { dataBrasileira, formatarDuracao } from '../lib/horas'
import { formatarSaldo, rotuloDoAbono, type ResumoDoSaldo, type SaldoDoDia } from '../lib/saldo'

/*
 * O SALDO NAS TELAS: a linha de um dia, o total do dia com o abono e o resumo
 * do mês ou do período.
 *
 * NENHUMA CONTA MORA AQUI. Os números vêm prontos de `saldo.ts`
 * (`calcularSaldoDoMes` no espelho, `calcularSaldoDoPeriodo` no painel da
 * pessoa e no painel geral), com as regras montadas por `regrasDoSaldo`; este
 * arquivo só escolhe as palavras. É o mesmo componente nas telas de quem bate
 * e nas de quem administra, e por isso as duas leem a mesma frase para o mesmo
 * dia.
 *
 * O QUE CADA ESTADO DIZ
 *  • fora (antes do primeiro dia cobrado, sem ele, ou futuro): nada. O dia não
 *    é cobrado, e "Saldo 0h00" pareceria um dia conferido.
 *  • em andamento (hoje): previsto e abonado, e "Saldo: em andamento". NUNCA o
 *    `saldoBruto` parcial: às 10h ele é negativo, e isso não é débito de
 *    ninguém.
 *  • pendente (dia passado com batida faltando): "Incompleto: saldo pendente".
 *    O dia não gera débito até alguém corrigir a batida.
 *  • cobrança: previsto, abonado e o saldo com sinal. No dia sem jornada (o
 *    sábado e o domingo da semente), o que se trabalhou é hora extra, e a
 *    linha diz "Dia sem jornada" para o "+4h00" não parecer engano. No feriado
 *    nacional, a linha diz "Feriado": ele também é dia sem jornada.
 *
 * O TOTAL DO DIA E DO PERÍODO SOMAM O ABONO. Quem lançou o atestado espera
 * vê-lo somado: `TotalDoDia` e `ComposicaoDoTotal` mostram o trabalhado mais o
 * abonado, com a conta escrita embaixo ("6h01 trabalhadas + 0h59 de
 * atestado"), para ninguém achar que o atestado virou batida. Os números vêm
 * de `horasDoDia` e `abonadoNoTotal`, de `saldo.ts`.
 *
 * DESDE QUANDO O SALDO CONTA. O primeiro dia cobrado é a mais nova entre a
 * data da ficha e a "Saldo calculado a partir de" da configuração. Quando o
 * mês ou o período começa antes dele, o resumo diz a data
 * (`ResumoDoSaldoNaTela`, com `aPartirDe`), para ninguém achar que os dias de
 * antes, sem saldo e sem falta, foram esquecidos.
 */

interface Item {
  texto: string
  tom: 'neutro' | 'bom' | 'aviso'
}

/** As peças da linha do dia, em ordem. Vazio = o dia não tem nada a dizer de saldo. */
function itensDoSaldo(saldo: SaldoDoDia): Item[] {
  if (saldo.estado === 'fora') return []
  const itens: Item[] = []
  if (saldo.semJornada) itens.push({ texto: saldo.feriado ? 'Feriado' : 'Dia sem jornada', tom: 'neutro' })
  else itens.push({ texto: `Previsto ${formatarDuracao(saldo.previsto)}`, tom: 'neutro' })
  if (saldo.abonado > 0) itens.push({ texto: `Abonado ${formatarDuracao(saldo.abonado)}`, tom: 'bom' })

  if (saldo.estado === 'em_andamento') {
    itens.push({ texto: 'Saldo: em andamento', tom: 'neutro' })
    return itens
  }
  if (saldo.estado === 'pendente') {
    itens.push({ texto: 'Incompleto: saldo pendente', tom: 'aviso' })
    return itens
  }

  if (saldo.falta) itens.push({ texto: 'Falta', tom: 'aviso' })
  if (saldo.temAtraso) itens.push({ texto: `Atraso ${formatarDuracao(saldo.atraso)}`, tom: 'aviso' })
  if (saldo.semJornada) {
    // Sem jornada, só há o que dizer quando houve trabalho: o sábado vazio
    // (ou só com a marca de um atestado por dias) fica em "Dia sem jornada".
    if (saldo.credito > 0) itens.push({ texto: `Hora extra ${formatarSaldo(saldo.credito)}`, tom: 'bom' })
    return itens
  }
  itens.push({
    texto: `Saldo ${formatarSaldo(saldo.saldo)}`,
    tom: saldo.saldo < 0 ? 'aviso' : saldo.saldo > 0 ? 'bom' : 'neutro',
  })
  return itens
}

const COR_DO_ITEM: Record<Item['tom'], string> = {
  neutro: 'text-mute',
  bom: 'text-luz',
  aviso: 'text-warn',
}

/** A linha do saldo de um dia, logo abaixo do cabeçalho do cartão do dia. */
export function LinhaDoSaldo({ saldo, className = 'px-4 pb-2' }: { saldo: SaldoDoDia; className?: string }) {
  const itens = itensDoSaldo(saldo)
  if (itens.length === 0) return null
  return (
    <p className={`flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-relaxed tabular-nums ${className}`}>
      {itens.map((item) => (
        <span key={item.texto} className={COR_DO_ITEM[item.tom]}>
          {item.texto}
        </span>
      ))}
    </p>
  )
}

/**
 * O total no canto do cartão do dia: o trabalhado (`trabalhado`, o `minutos`
 * do dia das batidas) mais o abonado do saldo do dia. Com abono, a conta vem
 * escrita embaixo: "6h01 trabalhadas + 0h59 de atestado", ou "horas de
 * atestado" no dia sem batida. Sem saldo (as regras não carregaram), é o
 * trabalhado.
 *
 * A CONTA QUEBRA EM DUAS LINHAS NO CELULAR (`max-w-28`, até `sm`). O total
 * não encolhe, e numa linha só a conta ocupa uns 180 px: a 320 px, o nome do
 * dia ao lado ficava em "Seg, …", e ninguém sabia de que dia era o cartão.
 */
export function TotalDoDia({ trabalhado, saldo }: { trabalhado: number; saldo?: SaldoDoDia }) {
  const abonado = saldo && !saldo.incompleto ? saldo.abonado : 0
  if (abonado <= 0) {
    return <span className="shrink-0 font-mono text-lg text-plat tabular-nums">{formatarDuracao(trabalhado)}</span>
  }
  const rotulo = rotuloDoAbono(saldo ? [saldo] : [])
  return (
    <span className="shrink-0 text-right">
      <span className="block font-mono text-lg text-plat tabular-nums">{formatarDuracao(trabalhado + abonado)}</span>
      <span className="block max-w-28 text-[0.68rem] leading-snug text-mute tabular-nums sm:max-w-none">
        {trabalhado > 0
          ? `${formatarDuracao(trabalhado)} trabalhadas + ${formatarDuracao(abonado)} ${rotulo}`
          : `horas ${rotulo}`}
      </span>
    </span>
  )
}

/**
 * A conta do total de um período ou de um mês, debaixo do número grande:
 * "152h00 trabalhadas + 8h30 de atestado". Nada quando não houve abono: o
 * total é só o trabalhado.
 */
export function ComposicaoDoTotal({
  trabalhado,
  abonado,
  dias,
}: {
  trabalhado: number
  abonado: number
  /** Os dias do saldo, para dizer de onde veio o abono (`rotuloDoAbono`). */
  dias: readonly SaldoDoDia[]
}) {
  if (abonado <= 0) return null
  return (
    <p className="mt-1 text-xs leading-relaxed text-mute tabular-nums">
      {formatarDuracao(trabalhado)} trabalhadas + {formatarDuracao(abonado)} {rotuloDoAbono(dias)}
    </p>
  )
}

function plural(quantidade: number, um: string, varios: string): string {
  return `${quantidade} ${quantidade === 1 ? um : varios}`
}

/**
 * O resumo do saldo de um mês (ou do período do painel), para ir dentro do
 * cartão do total. `rotulo` é "Saldo do mês" ou "Saldo do período".
 *
 * Os dias pendentes ficam fora das somas, e a frase diz quantos: o saldo do
 * mês é parcial até alguém corrigir as batidas que faltam. Hoje também fica
 * fora, e, quando hoje está no recorte (`comHoje`), a última frase diz isso.
 *
 * `aPartirDe` é o primeiro dia cobrado quando o recorte começa antes dele
 * (`cobrancaNoRecorte`, caso `no_meio`): a frase diz desde quando o saldo
 * conta, e que os dias de antes ficam fora.
 */
export function ResumoDoSaldoNaTela({
  resumo,
  rotulo,
  comHoje = false,
  aPartirDe = null,
}: {
  resumo: ResumoDoSaldo
  rotulo: string
  comHoje?: boolean
  aPartirDe?: string | null
}) {
  return (
    <div className="mt-4 border-t border-hair pt-4">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">{rotulo}</p>
      <p
        className={`mt-1.5 font-mono text-2xl font-medium tracking-tight tabular-nums ${
          resumo.saldo < 0 ? 'text-warn' : resumo.saldo > 0 ? 'text-luz' : 'text-plat'
        }`}
      >
        {formatarSaldo(resumo.saldo)}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-mute tabular-nums">
        Previsto {formatarDuracao(resumo.previsto)} · Abonado {formatarDuracao(resumo.abonado)}
        {/* As palavras do fechamento do mês, as mesmas da folha. */}
        {resumo.credito > 0 && <> · Horas extras {formatarSaldo(resumo.credito)}</>}
        {resumo.debito > 0 && <> · Horas negativas {formatarSaldo(-resumo.debito)}</>}
        {resumo.faltas > 0 && <> · {plural(resumo.faltas, 'falta', 'faltas')}</>}
      </p>
      {aPartirDe && (
        <p className="mt-1.5 text-xs leading-relaxed text-mute">
          Saldo calculado a partir de {dataBrasileira(aPartirDe)}. Os dias antes dessa data ficam fora do
          saldo.
        </p>
      )}
      {resumo.diasIncompletos > 0 && (
        <p className="mt-1.5 text-xs leading-relaxed text-warn">
          O saldo não inclui {plural(resumo.diasIncompletos, 'dia incompleto', 'dias incompletos')}: falta
          batida, e o saldo {resumo.diasIncompletos === 1 ? 'dele fica pendente' : 'deles fica pendente'} até
          a correção.
        </p>
      )}
      {comHoje && (
        <p className="mt-1.5 text-[0.68rem] leading-relaxed text-faint">
          Hoje entra no saldo quando o dia acabar.
        </p>
      )}
    </div>
  )
}
