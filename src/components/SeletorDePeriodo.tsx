import { ChevronLeft, ChevronRight } from 'lucide-react'
import { mesAnterior, mesDe, mesSeguinte } from '../lib/horas'
import { periodoDoMes, rotuloDoPeriodo, type Periodo } from '../lib/periodo'

/*
 * A ESCOLHA DO PERÍODO — as setas do mês e as duas datas, no mesmo lugar.
 *
 * POR QUE AS DUAS COISAS JUNTAS
 * O painel do admin serve a dois usos que parecem o mesmo e não são. Fechar a
 * folha é sempre o mês inteiro, e para isso a única interação boa é a seta:
 * um toque, sem digitar data nenhuma. Mas "quantas horas o time fez na semana
 * do evento" e "o dia do inventário" também vivem aqui, e para esses a seta não
 * serve. Oferecer só os campos de data obrigaria a digitar duas datas para o
 * caso mais comum; oferecer só as setas tornaria o recorte livre impossível.
 *
 * O MÊS CONTINUA MANDANDO NO RÓTULO
 * Quando o período é um mês fechado, o topo diz "Agosto de 2026" — é assim que
 * se fala do fechamento. Qualquer outro recorte mostra as duas datas, porque aí
 * a informação É o recorte. Quem decide isso é `rotuloDoPeriodo`, testado.
 *
 * ⚠ AS DUAS DATAS EMPILHAM NO CELULAR PEQUENO, E NÃO É ESTÉTICA
 * `<input type="date">` desenha "31/08/2026" mais o ícone do calendário, e no
 * celular a fonte é forçada a 16 px (`index.css`, para o iOS não dar zoom ao
 * focar). Isso pede uns 120 px. Em duas colunas dentro do cartão de uma tela de
 * 320 px sobrariam ~100 px por campo: a data sairia CORTADA, e a pessoa não
 * conseguiria ler até quando vai o período que está olhando. Medido no navegador.
 *
 * A DECISÃO É POR CONTÊINER (`@min-[20rem]`) E NÃO POR JANELA. Este seletor
 * aparece em três lugares com larguras diferentes na MESMA tela: solto na página
 * do painel, dentro do cartão de pessoas e, no computador, dentro de meia
 * coluna. Um `sm:` mediria a janela e acertaria só um dos três.
 */

interface Props {
  periodo: Periodo
  aoTrocar: (periodo: Periodo) => void
  /** Último mês navegável. Não existe ponto no futuro. */
  mesCorrente: string
  desabilitado?: boolean
}

const BOTAO_DE_SETA =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-hair-2 ' +
  'bg-ink-2 text-plat-dim transition-colors hover:border-hair-3 hover:text-plat ' +
  'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-hair-2 ' +
  'disabled:hover:text-plat-dim'

// Borda `plat/40` (3,5:1), como o `Campo` de `ui.tsx`.
const CAMPO_DE_DATA =
  'min-h-11 w-full rounded-xl border border-plat/40 bg-ink-2 px-3 py-2 text-sm text-plat ' +
  'transition-colors focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25 ' +
  'disabled:opacity-45 [color-scheme:dark]'

export function SeletorDePeriodo({ periodo, aoTrocar, mesCorrente, desabilitado }: Props) {
  // O mês do período é o do INÍCIO: num recorte que atravessa a troca de mês,
  // a seta anda a partir de onde o período começa, que é o que a pessoa está
  // olhando.
  const mes = mesDe(periodo.inicio)
  const podeAvancar = mes < mesCorrente

  return (
    /*
      TRÊS FORMAS, TODAS DECIDIDAS PELA LARGURA DESTA CAIXA:
       · até 20rem  — tudo empilhado: setas, depois "De", depois "Até"
       · 20–42rem   — setas em cima, as duas datas lado a lado embaixo
       · 42rem+     — uma linha só: setas à esquerda, datas à direita
      A terceira existe porque, dentro do cartão de pessoas num monitor de
      1280 px, esta caixa tem 900 px: dois campos de data esticados a 450 px cada
      não ficam mais fáceis de usar, ficam só maiores. Agrupados à direita, com
      largura de gente, eles voltam a parecer o que são — dois campos.
    */
    <div className="@container">
      <div className="flex flex-col gap-3 @min-[42rem]:flex-row @min-[42rem]:items-end @min-[42rem]:gap-4">
        <nav
          /* `flex-1` só na forma larga: numa coluna (`flex-col`), `flex: 1 1 0%`
             mexeria na ALTURA da barra de setas, não na largura. */
          className="flex min-w-0 items-center justify-between gap-2 @min-[42rem]:flex-1 @min-[42rem]:justify-start @min-[42rem]:gap-3"
          aria-label="Escolha do período"
        >
          <button
            type="button"
            onClick={() => aoTrocar(periodoDoMes(mesAnterior(mes)))}
            disabled={desabilitado}
            aria-label="Ver o mês anterior"
            className={BOTAO_DE_SETA}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>

          <p aria-live="polite" className="text-center text-sm font-semibold text-plat">
            {rotuloDoPeriodo(periodo)}
          </p>

          <button
            type="button"
            onClick={() => aoTrocar(periodoDoMes(mesSeguinte(mes)))}
            disabled={desabilitado || !podeAvancar}
            aria-label={podeAvancar ? 'Ver o mês seguinte' : 'Não há ponto depois deste mês'}
            className={BOTAO_DE_SETA}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>

        <div className="grid grid-cols-1 gap-2 @min-[20rem]:grid-cols-2 @min-[42rem]:w-96 @min-[42rem]:shrink-0">
          <div>
            <label htmlFor="periodo-de" className="mb-1 block text-[0.68rem] text-mute">
              De
            </label>
            <input
              id="periodo-de"
              type="date"
              value={periodo.inicio}
              max={periodo.fim}
              disabled={desabilitado}
              /*
               * O `<input type="date">` devolve string vazia enquanto a digitação
               * está pela metade ("2026-08-"). Guardar isso no estado faria a
               * consulta sair com um período quebrado a cada tecla — daí a
               * recusa: só data completa troca o período.
               */
              onChange={(evento) => {
                if (evento.target.value) aoTrocar({ ...periodo, inicio: evento.target.value })
              }}
              className={CAMPO_DE_DATA}
            />
          </div>
          <div>
            <label htmlFor="periodo-ate" className="mb-1 block text-[0.68rem] text-mute">
              Até
            </label>
            <input
              id="periodo-ate"
              type="date"
              value={periodo.fim}
              min={periodo.inicio}
              disabled={desabilitado}
              onChange={(evento) => {
                if (evento.target.value) aoTrocar({ ...periodo, fim: evento.target.value })
              }}
              className={CAMPO_DE_DATA}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
