import { useEffect, useRef, useState, type FormEvent } from 'react'
import { History, PencilLine, Plus, X } from 'lucide-react'
import {
  corrigirHorario,
  horarioAnteriorDaCorrecao,
  horarioPosteriorDaCorrecao,
  inserirBatida,
  rotuloDoAutor,
  type Correcao,
} from '../lib/admin'
import { diaInicialDaCaixa, limitesDaCaixa, validarMomentoDaCaixa } from '../lib/corrigir'
import {
  diaCivilDoInstante,
  formatarHora,
  formatarMomento,
  ROTULO_DO_TIPO,
  type BatidaDoAdmin,
} from '../lib/formato'
import { ehDiaValido } from '../lib/horas'
import { diaCurto, diaPorExtenso, fraseDoRecado, juntarComE, previaDoDia, type AcaoDoRecado } from '../lib/painel'
import type { PedidoDeAtraso } from '../lib/atraso'
import { descreverCampos } from '../lib/trilha'
import { Aviso, Botao, Modal } from './ui'

/*
 * CORRIGIR UM HORÁRIO E INSERIR UMA BATIDA ESQUECIDA — a mesma caixa, porque
 * são a mesma conversa: que horas, e por quê.
 *
 * O MOTIVO NÃO É CAMPO DE FORMULÁRIO, É A REGRA
 * O banco recusa correção sem motivo (`23514`, no gatilho) e recusa inserção
 * sem motivo (a CHECK `ponto_registros_ajuste_exige_motivo`). A validação
 * abaixo não substitui nenhuma das duas — ela só evita a viagem até o servidor
 * para receber a mesma recusa. Se este componente for removido amanhã, a regra
 * continua valendo; se o banco fosse removido, ela não valeria nada.
 *
 * O QUE ESTA TELA NÃO ESCREVE
 * Nada da trilha. `ponto_guardar_correcao` grava sozinho, dentro do UPDATE,
 * quem corrigiu, quando, quais campos e a linha ANTERIOR inteira. Trilha
 * escrita pelo cliente é trilha que o cliente pode não escrever — e é
 * justamente ela que sustenta "o valor original nunca é apagado".
 *
 * A HORA DIGITADA É HORA DO FUSO DO PONTO
 * `momentoNoFusoDoLocal` converte "08:00" no instante em que o relógio do
 * PONTO (`FUSO`, em `formato.ts`) marcava 08:00, e não o relógio de quem está
 * corrigindo. Sem isso, um
 * notebook com fuso errado deslocaria a batida em horas e o `dia_civil` que o
 * banco recalcula poderia cair no dia anterior.
 *
 * QUALQUER DIA ATÉ HOJE, NENHUM HORÁRIO NO FUTURO. A caixa abre com o dia
 * escolhido — o da batida, ao corrigir; o
 * da linha clicada ou o do botão do topo, ao inserir (`diaInicialDaCaixa`) — e
 * aceita qualquer dia passado, sábado e domingo inclusive. Não aceita dia
 * depois de hoje nem, hoje, hora depois de agora, nos dois modos: quem decide
 * é `validarMomentoDaCaixa` (src/lib/corrigir.ts), no envio; o `max` dos campos
 * é só conforto. O banco tem a própria trava de futuro, e esta conferência
 * não a substitui: só poupa a viagem até o servidor.
 *
 * VER ANTES DE GRAVAR. Batida inserida não se apaga, e inserir sem ver o dia
 * é o jeito mais fácil de errar. Por isso a caixa mostra:
 *  • o dia por extenso no cabeçalho ("Sexta-feira, 16 de outubro");
 *  • ao inserir, as batidas que o dia já tem (as que a tela leu) e, assim que a
 *    hora é digitada, como o dia inteiro fica (`previaDoDia`), avisando quando
 *    ele fica ímpar e passa a não somar;
 *  • ao corrigir num dia ímpar, o aviso de que corrigir troca um horário que a
 *    pessoa bateu — o que falta é inserir;
 *  • um botão que diz o que vai acontecer: "Inserir 13:00 em sex., 16/10",
 *    "Mudar de 17:00 para 13:00 em sex., 16/10".
 * E "Inserir e continuar": a caixa grava e fica aberta no mesmo dia, com o
 * motivo, para a próxima batida do sábado inteiro — uma de cada vez, cada uma
 * conferida, em vez de várias de uma vez (uma hora a mais digitada por engano
 * viraria uma batida para sempre).
 *
 * O TECLADO É DO `Modal` (foco inicial, Tab preso, Esc, foco de volta): a
 * caixa só marca a Hora com `data-foco-inicial`.
 *
 * PEDIDO ESPERANDO NAQUELE DIA: "Ana Souza já
 * pediu a batida das 13:05 deste dia. Aprove o pedido em vez de inserir." O
 * aviso não trava nada — pode ser outro horário —, mas inserir a mesma batida
 * à mão e depois aprovar o pedido daria batida dobrada, e o banco só recusa a
 * segunda quando as duas caem no mesmo minuto.
 */

export type ModoDoAjuste =
  | { nome: 'corrigir'; batida: BatidaDoAdmin }
  | { nome: 'inserir'; diaSugerido: string }

/** O que a caixa gravou: a linha que o banco devolveu e a frase do recado. */
export interface GravacaoDoAjuste {
  batida: BatidaDoAdmin
  acao: AcaoDoRecado
  /** "Inserir e continuar": a caixa fica aberta no mesmo dia. */
  continuar: boolean
}

/** As batidas que a tela da pessoa já leu, e de que período — para a caixa não ler o banco de novo. */
export interface BatidasDaTela {
  periodo: { inicio: string; fim: string }
  batidas: readonly BatidaDoAdmin[]
}

interface Props {
  modo: ModoDoAjuste
  usuarioId: string
  nomeDoFuncionario: string
  /** A trilha desta batida, da mais recente para a mais antiga. Vazia ao inserir. */
  correcoes: Correcao[]
  /**
   * `autor_id` -> nome de quem corrigiu. Uuid cru na tela não informa ninguém.
   * Só vale para correção de admin: a linha de natureza 'sistema' aparece como
   * "Sistema" (`rotuloDoAutor`), nunca como um administrador.
   */
  nomeDoAutor: (autorId: string | null) => string
  /**
   * As batidas que a tela já carregou: "Já registradas neste dia",
   * a prévia e o aviso do dia ímpar saem delas. Sem elas, a caixa só não mostra
   * essas três coisas.
   */
  batidasDaTela?: BatidasDaTela
  /** Os pedidos de batida em atraso desta pessoa que esperam decisão. */
  pedidosPendentes?: readonly PedidoDeAtraso[]
  aoFechar: () => void
  aoGravar: (gravacao: GravacaoDoAjuste) => void
  /** O relógio. Injetável para o teste; na tela, o de agora. */
  agora?: () => Date
}

/* Borda `plat/40` (3,5:1), como o `Campo` de `ui.tsx`. */
const CAMPO =
  'w-full min-h-11 rounded-xl border border-plat/40 bg-ink-2 px-3 py-2.5 text-sm text-plat ' +
  'placeholder:text-faint transition-colors [color-scheme:dark] ' +
  'focus:border-luz/70 focus:outline-none focus:ring-2 focus:ring-luz/25'

const FORMATO_DA_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const ROTULO_DO_CAMPO = 'mb-1 block text-sm font-medium text-plat-dim'

const porMomento = (a: BatidaDoAdmin, b: BatidaDoAdmin) =>
  new Date(a.registrado_em).getTime() - new Date(b.registrado_em).getTime()

export function AjusteDeBatida({
  modo,
  usuarioId,
  nomeDoFuncionario,
  correcoes,
  nomeDoAutor,
  batidasDaTela,
  pedidosPendentes = [],
  aoFechar,
  aoGravar,
  agora = () => new Date(),
}: Props) {
  const corrigindo = modo.nome === 'corrigir'
  const original =
    modo.nome === 'corrigir'
      ? { dia: modo.batida.dia_civil, hora: formatarHora(modo.batida.registrado_em) }
      : null

  const [dia, setDia] = useState(() => diaInicialDaCaixa(modo))
  const [hora, setHora] = useState(() => original?.hora ?? '')
  const [motivo, setMotivo] = useState('')
  /** Qual botão está gravando: o que fecha a caixa ou o "Inserir e continuar". */
  const [gravando, setGravando] = useState<'fechar' | 'continuar' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  /** Ao corrigir, o campo Dia só aparece com "mudar o dia desta batida". */
  const [mudandoODia, setMudandoODia] = useState(false)
  /** As batidas que esta caixa já inseriu ("Inserir e continuar"), até a tela reler. */
  const [inseridas, setInseridas] = useState<BatidaDoAdmin[]>([])
  const [confirmacao, setConfirmacao] = useState<string | null>(null)
  const [continuacoes, setContinuacoes] = useState(0)
  const campoDaHora = useRef<HTMLInputElement>(null)

  /*
   * Depois de "Inserir e continuar", a hora limpa recebe o foco — com mouse.
   * No toque, não: o campo abriria a roda de horário por cima da confirmação
   * (a mesma regra do foco inicial do `Modal`).
   */
  useEffect(() => {
    if (continuacoes === 0) return
    if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches) {
      campoDaHora.current?.focus()
    }
  }, [continuacoes])

  const hoje = diaCivilDoInstante(agora())
  const diaValido = ehDiaValido(dia)
  const horaValida = FORMATO_DA_HORA.test(hora)

  /**
   * As batidas de um dia, como a tela as leu, mais as que esta caixa inseriu.
   * `null` quando a tela não sabe: sem `batidasDaTela`, ou dia fora do período.
   */
  function batidasDoDia(alvo: string): BatidaDoAdmin[] | null {
    if (!batidasDaTela) return null
    if (alvo < batidasDaTela.periodo.inicio || alvo > batidasDaTela.periodo.fim) return null
    const porId = new Map<string, BatidaDoAdmin>()
    for (const batida of [...batidasDaTela.batidas, ...inseridas]) {
      if (batida.dia_civil === alvo) porId.set(batida.id, batida)
    }
    return [...porId.values()].sort(porMomento)
  }

  const doDia = !corrigindo && diaValido ? batidasDoDia(dia) : null
  /* Ao inserir: o dia escolhido já tem pedido de batida em atraso esperando decisão? */
  const pedidosDoDia = corrigindo ? [] : pedidosPendentes.filter((pedido) => pedido.dia_civil === dia)
  const horasPedidas = pedidosDoDia.map((pedido) => formatarHora(pedido.horario_declarado))
  const previa = doDia && horaValida ? previaDoDia({ dia, batidas: doDia, novaHora: hora }) : null

  /* Ao corrigir: o dia da batida está ímpar? (Hoje ímpar é dia em andamento, não falta nada.) */
  const doDiaDaBatida = original ? batidasDoDia(original.dia) : null
  const diaDaBatidaImpar =
    original !== null && original.dia !== hoje && doDiaDaBatida !== null && doDiaDaBatida.length % 2 === 1
  /*
   * A posição pelo relógio entre as batidas que a tela leu — a mesma da lista
   * do dia ("3ª batida"). Sem a lista, a ordem que o banco gravou.
   */
  const indiceNoDia =
    modo.nome === 'corrigir' && doDiaDaBatida
      ? doDiaDaBatida.findIndex((batida) => batida.id === modo.batida.id)
      : -1
  const posicaoNoDia =
    indiceNoDia >= 0 ? indiceNoDia + 1 : modo.nome === 'corrigir' ? modo.batida.ordem_no_dia : 0

  const mudou = original !== null && (hora !== original.hora || dia !== original.dia)
  const temAlteracao = motivo.trim() !== '' || (original ? mudou : hora !== '')

  function rotuloDoBotao(): string {
    if (original) {
      if (!mudou || !horaValida || !diaValido) return 'Gravar correção'
      return dia === original.dia
        ? `Mudar de ${original.hora} para ${hora} em ${diaCurto(dia)}`
        : `Mudar de ${original.hora} de ${diaCurto(original.dia)} para ${hora} de ${diaCurto(dia)}`
    }
    return horaValida && diaValido ? `Inserir ${hora} em ${diaCurto(dia)}` : 'Inserir batida'
  }

  async function gravar(continuar: boolean) {
    setErro(null)

    if (!motivo.trim()) {
      setErro('Escreva o motivo: ele é obrigatório e fica guardado com o seu nome.')
      return
    }
    // O relógio é lido AGORA, no envio: a caixa pode ter ficado aberta e o
    // "agora" de quando ela abriu já ser passado.
    const momento = validarMomentoDaCaixa({ modo: modo.nome, dia, hora, agora: agora() })
    if (!momento.ok) {
      setErro(momento.erro)
      return
    }
    const momentoISO = momento.momentoISO

    setGravando(continuar ? 'continuar' : 'fechar')
    try {
      if (modo.nome === 'corrigir' && original) {
        const gravada = await corrigirHorario({
          registroId: modo.batida.id,
          momentoAnteriorISO: modo.batida.registrado_em,
          momentoISO,
          motivo,
        })
        aoGravar({
          batida: gravada,
          continuar: false,
          acao: {
            nome: 'corrigida',
            diaAntes: original.dia,
            horaAntes: original.hora,
            dia: gravada.dia_civil || dia,
            hora: formatarHora(gravada.registrado_em),
          },
        })
        return
      }

      const gravada = await inserirBatida({ usuarioId, momentoISO, motivo })
      const acao: AcaoDoRecado = {
        nome: 'inserida',
        dia: gravada.dia_civil || dia,
        hora: formatarHora(gravada.registrado_em),
      }
      aoGravar({ batida: gravada, acao, continuar })
      if (continuar) {
        // A linha "Já registradas" cresce com a hora que o banco devolveu. O
        // TIPO devolvido não serve: o RETURNING do insert sai antes de o banco
        // reorganizar o dia, e a prévia dá o nome pela posição.
        setInseridas((antes) => [...antes, gravada])
        setHora('')
        setConfirmacao(`${fraseDoRecado(acao)} Escreva a hora da próxima, ou toque em “Concluir”.`)
        setGravando(null)
        setContinuacoes((vezes) => vezes + 1)
      }
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não deu para gravar o ajuste.')
      setGravando(null)
    }
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault()
    void gravar(false)
  }

  const limites = limitesDaCaixa(dia, agora())
  const ocupada = gravando !== null
  const diaDoCabecalho = original ? original.dia : dia

  const campoDaHoraNaTela = (
    <div>
      <label htmlFor="ajuste-hora" className={ROTULO_DO_CAMPO}>
        Hora
      </label>
      <input
        ref={campoDaHora}
        id="ajuste-hora"
        data-foco-inicial
        type="time"
        value={hora}
        max={limites.horaMaxima}
        onChange={(evento) => setHora(evento.target.value)}
        required
        disabled={ocupada}
        className={CAMPO}
      />
    </div>
  )

  const campoDoDiaNaTela = (
    <div>
      <label htmlFor="ajuste-dia" className={ROTULO_DO_CAMPO}>
        Dia
      </label>
      <input
        id="ajuste-dia"
        type="date"
        value={dia}
        max={limites.diaMaximo}
        onChange={(evento) => setDia(evento.target.value)}
        required
        disabled={ocupada}
        className={CAMPO}
      />
    </div>
  )

  return (
    /*
     * A moldura vem de `ui.tsx` (ver o comentário do `Modal`): esta é a caixa
     * MAIS ALTA do app — formulário, aviso e trilha de correções empilhados —,
     * e é ela que perderia o topo num celular pequeno sem a moldura que rola.
     */
    <Modal
      rotulo={corrigindo ? 'Corrigir o horário da batida' : 'Inserir batida esquecida'}
      aoFechar={aoFechar}
      podeFechar={!ocupada}
      temAlteracao={temAlteracao}
    >
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              {corrigindo ? 'Corrigir horário' : 'Batida esquecida'}
            </p>
            <h2 className="mt-1 truncate text-base font-semibold text-plat focus:outline-none">
              {nomeDoFuncionario}
            </h2>
            {diaPorExtenso(diaDoCabecalho) && (
              <p className="mt-0.5 text-sm text-plat-dim">{diaPorExtenso(diaDoCabecalho)}</p>
            )}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            disabled={ocupada}
            aria-label="Fechar"
            className="-mt-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-plat focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60 disabled:opacity-40"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {modo.nome === 'corrigir' && original && (
          <>
            {diaDaBatidaImpar && (
              <div className="mt-3">
                <Aviso tom="atencao">
                  Este dia está com uma batida faltando. Se o problema é um horário que ninguém
                  bateu, feche e use “Inserir a batida que falta”. Corrigir troca um horário que a
                  pessoa realmente bateu, e a troca fica registrada.
                </Aviso>
              </div>
            )}
            <p className="mt-3 rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5 text-xs leading-relaxed text-mute">
              Horário que está no ponto:{' '}
              <span className="font-mono text-plat">{original.hora}</span>
              {` — ${diaDaBatidaImpar ? '' : `${ROTULO_DO_TIPO[modo.batida.tipo]}, `}${posicaoNoDia}ª batida de ${diaCurto(original.dia)}. O horário anterior fica guardado.`}
            </p>
          </>
        )}

        {!corrigindo && (
          <p className="mt-3 rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5 text-xs leading-relaxed text-mute">
            A batida inserida nasce <span className="text-plat">sem foto e sem localização</span> —
            não houve nem uma nem outra. O sistema organiza entrada, almoço, volta e saída{' '}
            <span className="text-plat">pelo horário</span>: pode inserir a que faltou em qualquer
            ponto do dia, que o dia inteiro se ajusta.
          </p>
        )}

        {pedidosDoDia.length > 0 && (
          <div className="mt-3">
            <Aviso tom="atencao">
              {pedidosDoDia.length === 1
                ? `${nomeDoFuncionario} já pediu a batida das ${horasPedidas[0]} deste dia. Aprove o pedido em vez de inserir.`
                : `${nomeDoFuncionario} já pediu as batidas das ${juntarComE(horasPedidas)} deste dia. Aprove os pedidos em vez de inserir.`}
            </Aviso>
          </div>
        )}

        {confirmacao && (
          <div className="mt-3">
            <Aviso tom="bom">{confirmacao}</Aviso>
          </div>
        )}

        <form onSubmit={enviar} className="mt-4 space-y-3">
          {corrigindo ? (
            <>
              {campoDaHoraNaTela}
              {/*
                O DIA DA CORREÇÃO É TEXTO, COM UM LINK PARA MUDAR. Quase toda
                correção é de hora; o campo de data aberto ao lado convidava a
                mexer nele sem querer — e mudar o dia tira a batida de um dia e
                põe em outro.
              */}
              {mudandoODia ? (
                <div>
                  {campoDoDiaNaTela}
                  <p className="mt-1 text-xs leading-relaxed text-warn">A batida passa para o outro dia.</p>
                </div>
              ) : (
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-plat-dim">
                  <span>
                    Dia: <span className="text-plat">{diaCurto(dia)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setMudandoODia(true)}
                    disabled={ocupada}
                    className="inline-flex min-h-11 items-center rounded-lg text-sm text-luz underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luz/60"
                  >
                    mudar o dia desta batida
                  </button>
                </p>
              )}
            </>
          ) : (
            /*
              DIA E HORA EMPILHAM NO CELULAR PEQUENO. Lado a lado em 320 px cada
              campo ficaria com ~104 px, e `<input type="date">` desenha "dd/mm/aaaa"
              mais o ícone do calendário em cerca de 120 px com a fonte de 16 px
              que o iOS exige — a data sairia cortada no meio. Empilhados
              eles têm a largura inteira; a partir de 320 px de caixa voltam a ser
              um par, que é como se lê "quando".

              A consulta é de CONTÊINER (`@min-[20rem]`) e não de janela: esta
              caixa tem largura própria (`max-w-sm`), e o que decide se cabem duas
              colunas é a largura DELA, não a da tela atrás. Um `sm:` aqui mediria
              a coisa errada — a caixa tem quase a mesma largura em 390 px e em
              1280 px.
            */
            <div className="@container">
              <div className="grid grid-cols-1 gap-2 @min-[20rem]:grid-cols-2">
                {campoDoDiaNaTela}
                {campoDaHoraNaTela}
              </div>
            </div>
          )}

          {/* O dia como está e como vai ficar (só ao inserir, e só com as batidas que a tela leu). */}
          {!corrigindo && batidasDaTela && diaValido && (
            <div className="rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5 text-xs leading-relaxed text-mute">
              {doDia === null ? (
                <p>Este dia está fora do período que você está vendo; as batidas dele não aparecem aqui.</p>
              ) : doDia.length === 0 ? (
                <p>Nenhuma batida neste dia ainda.</p>
              ) : (
                <p>
                  Já registradas neste dia:{' '}
                  <span className="font-mono text-plat tabular-nums">
                    {doDia.map((batida) => formatarHora(batida.registrado_em)).join(' · ')}
                  </span>
                </p>
              )}
              {previa && (
                <p className={`mt-1.5 ${previa.atencao ? 'text-warn' : 'text-luz'}`}>{previa.texto}</p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="ajuste-motivo" className={ROTULO_DO_CAMPO}>
              Motivo <span className="text-warn">(obrigatório)</span>
            </label>
            <textarea
              id="ajuste-motivo"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              rows={3}
              required
              disabled={ocupada}
              placeholder="Ex.: esqueceu de bater a saída, avisou no grupo no mesmo dia"
              className={`${CAMPO} resize-y`}
            />
            <p className="mt-1 text-xs leading-relaxed text-faint">
              Fica gravado junto com quem ajustou e quando. É o que sustenta o ajuste se alguém
              questionar o cartão de ponto depois.
            </p>
          </div>

          {erro && <Aviso tom="erro">{erro}</Aviso>}

          {!corrigindo && (
            <p className="text-xs leading-relaxed text-plat-dim">
              <span className="font-semibold text-plat">Batida inserida não se apaga.</span> Confira o
              dia e a hora antes de gravar.
            </p>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <Botao type="submit" disabled={ocupada || (corrigindo && !mudou)}>
              {corrigindo ? (
                <PencilLine size={16} aria-hidden="true" />
              ) : (
                <Plus size={16} aria-hidden="true" />
              )}
              {gravando === 'fechar' ? 'Gravando…' : rotuloDoBotao()}
            </Botao>
            {!corrigindo && (
              <Botao type="button" tom="secundario" onClick={() => void gravar(true)} disabled={ocupada}>
                {gravando === 'continuar' ? 'Gravando…' : 'Inserir e continuar'}
              </Botao>
            )}
            <Botao type="button" tom="discreto" onClick={aoFechar} disabled={ocupada}>
              {inseridas.length > 0 ? 'Concluir' : 'Cancelar'}
            </Botao>
          </div>
        </form>

        {corrigindo && (
          <section className="mt-5 border-t border-hair pt-4">
            <h3 className="flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              <History size={12} aria-hidden="true" />
              Correções anteriores
            </h3>

            {correcoes.length === 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-mute">
                Nenhuma ainda: este é o horário como foi registrado.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {correcoes.map((correcao) => {
                  const antes = horarioAnteriorDaCorrecao(correcao)
                  const depois = horarioPosteriorDaCorrecao(correcao)
                  return (
                    <li
                      key={correcao.id}
                      className="rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5"
                    >
                      {antes && depois && (
                        <p className="font-mono text-xs text-plat tabular-nums">
                          <span className="text-warn line-through">{formatarHora(antes)}</span>
                          {' → '}
                          {formatarHora(depois)}
                        </p>
                      )}
                      <p className="mt-1 text-xs leading-relaxed text-plat-dim">
                        {correcao.motivo}
                      </p>
                      <p className="mt-1 text-xs text-faint">
                        {rotuloDoAutor(correcao, nomeDoAutor)} · {formatarMomento(correcao.criado_em)} ·
                        mudou: {descreverCampos(correcao.campos)}
                      </p>
                      {correcao.natureza === 'sistema' && (
                        <p className="mt-1 text-xs text-faint">
                          Feita pelo próprio sistema (reorganização do dia ou recálculo do local): não
                          é correção de ninguém e não marca a batida como ajustada.
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </>
    </Modal>
  )
}
