import { rotuloDaColunaDeHorario, type FolhaDePonto } from '../lib/folha'
import { marcaDoApp } from '../lib/marca-do-app'

/*
 * O PAPEL — a folha de ponto desenhada para sair na impressora.
 *
 * ESTE COMPONENTE NÃO CALCULA NADA. Ele recebe a estrutura pronta de
 * `lib/folha.ts` e a escreve. Nem uma soma, nem um `toFixed`, nem um
 * `filter` de dia: tudo o que é conta já veio decidido, pela MESMA função que
 * desenha o espelho do funcionário. Ver o aviso no topo daquele arquivo.
 *
 * ---------------------------------------------------------------------------
 * AS CINCO DECISÕES DE DESENHO, E POR QUE CADA UMA
 *
 * 1. PRETO SOBRE BRANCO, SEMPRE — inclusive na tela. O app inteiro é de base
 *    preta, e uma folha escura na tela que sai branca no papel esconderia
 *    justamente os defeitos de impressão até a hora de imprimir. Aqui o que se
 *    vê é o que sai.
 *
 * 2. NENHUMA INFORMAÇÃO MORA NA COR. Dia incompleto e dia ajustado viram
 *    PALAVRA na coluna de observações, não fundo amarelo. Esta folha é
 *    impressa em laser preto e branco, e uma marca que só existe como cor
 *    desapareceria no papel — o dia que não entrou no total viraria um dia
 *    comum, com um buraco na conta e nada explicando.
 *
 * 3. TABELA DE VERDADE, com `<thead>`. Um mês de 22 dias com seis colunas de
 *    horário atravessa a quebra de página, e o navegador REPETE o `<thead>` no
 *    topo da página seguinte sozinho — comportamento que uma tabela feita de
 *    `<div>` com grid não tem. A segunda página sairia com números sem título.
 *
 * 4. `break-inside-avoid` nas peças que não podem ser cortadas ao meio: cada
 *    linha de dia, a legenda e o bloco de assinaturas. Uma assinatura partida
 *    entre duas folhas invalida o documento na prática — ninguém assina metade.
 *
 * 5. O QUE É INTERFACE SOME NA IMPRESSÃO, e não o contrário: a barra de
 *    ferramentas da tela leva `print:hidden` (ver `pages/Folha.tsx`), e este
 *    componente não tem um único botão. A pré-visualização não mostra menu,
 *    botão nem barra de navegação.
 * ---------------------------------------------------------------------------
 *
 * A FONTE É A DO SISTEMA, e não a Quicksand do app. Quicksand é fonte de
 * marca, arredondada, desenhada para título — num documento de 22 linhas de
 * número ela cansa e perde legibilidade no corpo pequeno. Os horários vão em
 * mono com `tabular-nums`, para as colunas alinharem coluna a coluna.
 */

/** Rótulo pequeno em caixa alta, o mesmo em todas as fichas do papel. */
function Rotulo({ children }: { children: string }) {
  return (
    <p className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-black/55">
      {children}
    </p>
  )
}

/**
 * A linha que fica em branco quando o dado não existe.
 *
 * ELA DEVOLVE UM ESPAÇO NÃO SEPARÁVEL, e não uma string vazia: um parágrafo
 * vazio colapsa a altura, e o cabeçalho da folha encolheria conforme os campos
 * que faltam — cada mês com um tamanho, e o espaço reservado sumindo justamente
 * onde alguém deveria notar a pendência.
 *
 * O caractere vai escrito como escape (`\u00a0`), e não literal: um espaço
 * invisível no meio do código-fonte some no primeiro reformatar e ninguém
 * enxerga a mudança na revisão. É a mesma razão pela qual o BOM do CSV é
 * escrito assim, em `csv.ts`.
 */
function LinhaOuBranco({ texto, className = '' }: { texto: string; className?: string }) {
  return <p className={className}>{texto === '' ? '\u00a0' : texto}</p>
}

export function FolhaParaImprimir({
  folha,
  /** "Emitida em …" no rodapé. A tela passa o relógio; este módulo não tem um. */
  emitidaEm,
}: {
  folha: FolhaDePonto
  emitidaEm?: string
}) {
  const { cabecalho, funcionario, linhas } = folha

  /* As colunas de horário, como índices — 4 no mínimo, mais quando algum dia
     do mês teve mais batidas. Ver `colunasDeHorario` em `lib/folha.ts`. */
  const colunas = Array.from({ length: folha.colunasDeHorario }, (_, indice) => indice)
  /** Quantas colunas a tabela tem ao todo: data, dia, horários, total, obs. */
  const totalDeColunas = colunas.length + 4

  const celula = 'border border-black/70 px-1.5 py-1 align-middle'

  return (
    <article
      /* `folha-de-ponto` é a classe que `index.css` usa para começar cada
         pessoa numa página nova quando houver mais de uma. */
      className="folha-de-ponto mx-auto w-full max-w-[210mm] bg-white p-8 font-sans text-black print:max-w-none print:p-0"
    >
      {/* ---------------------------------------------------------------- */}
      {/* Cabeçalho: a empresa à esquerda, o documento à direita           */}
      {/* ---------------------------------------------------------------- */}
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-2">
        {/*
          `min-h-[3.75rem]` é o ESPAÇO RESERVADO do caso de borda: com
          a configuração da empresa vazia, a folha imprime o cabeçalho EM
          BRANCO em vez de falhar — e em branco de verdade, com a altura das
          quatro linhas que estariam ali. Um cabeçalho que encolhe até sumir
          não parece uma pendência, parece o desenho do documento.
        */}
        <div className="min-h-[3.75rem] min-w-0 flex-1">
          {cabecalho.razaoSocial !== '' && (
            <p className="text-[0.95rem] leading-tight font-bold uppercase">
              {cabecalho.razaoSocial}
            </p>
          )}
          {cabecalho.nomeFantasia !== '' && (
            <p className="text-[0.78rem] leading-tight">{cabecalho.nomeFantasia}</p>
          )}
          {cabecalho.cnpj !== '' && (
            <p className="font-mono text-[0.7rem] leading-tight">CNPJ {cabecalho.cnpj}</p>
          )}
          {cabecalho.endereco !== '' && (
            <p className="text-[0.7rem] leading-tight">{cabecalho.endereco}</p>
          )}

          {/*
            O aviso do que falta é DE TELA, não de papel: `print:hidden`. Quem
            imprime precisa do espaço em branco; quem está olhando a
            pré-visualização precisa saber por que ele está em branco e onde
            resolver isso.
          */}
          {cabecalho.vazio && (
            <p className="text-[0.68rem] leading-relaxed text-black/45 italic print:hidden">
              Os dados da empresa ainda não foram cadastrados, então este espaço sai em branco no
              papel. Preencha em Administração → Dados da empresa.
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[0.95rem] leading-tight font-bold uppercase tracking-wide">
            Folha de ponto
          </p>
          <p className="text-[0.78rem] leading-tight">{folha.mesPorExtenso}</p>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Quem assina                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mt-2.5 flex items-start justify-between gap-6 border-b border-black/40 pb-2">
        <div className="min-w-0 flex-1">
          <Rotulo>Funcionário</Rotulo>
          <p className="text-[0.9rem] leading-tight font-semibold">{funcionario.nome}</p>
          {/* Sem e-mail imprime em branco — a mesma regra do cabeçalho da
              empresa: em branco é pendência, texto inventado é afirmação. */}
          <LinhaOuBranco className="text-[0.7rem] leading-tight" texto={funcionario.email} />
        </div>

        <div className="shrink-0 text-right">
          <Rotulo>Total do mês</Rotulo>
          <p className="font-mono text-[1.35rem] leading-tight font-semibold tabular-nums">
            {folha.total}
          </p>
          <p className="text-[0.65rem] leading-tight">
            {folha.resumo.diasComBatida}{' '}
            {folha.resumo.diasComBatida === 1 ? 'dia com batida' : 'dias com batida'}
            {folha.resumo.diasIncompletos > 0 &&
              ` · ${folha.resumo.diasIncompletos} incompleto${folha.resumo.diasIncompletos === 1 ? '' : 's'}`}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* A tabela do mês                                                  */}
      {/* ---------------------------------------------------------------- */}
      <table className="mt-3 w-full border-collapse text-[0.68rem]">
        <thead>
          {/* Repetido pelo navegador no topo de cada página impressa. */}
          <tr className="bg-black/[0.06]">
            <th className={`${celula} text-left`} scope="col">
              Data
            </th>
            <th className={`${celula} text-left`} scope="col">
              Dia
            </th>
            {colunas.map((indice) => (
              <th className={`${celula} text-center font-normal`} scope="col" key={indice}>
                {rotuloDaColunaDeHorario(indice)}
              </th>
            ))}
            <th className={`${celula} text-right`} scope="col">
              Total
            </th>
            <th className={`${celula} text-left`} scope="col">
              Observações
            </th>
          </tr>
        </thead>

        <tbody>
          {/*
            MÊS SEM BATIDA É RESPOSTA, NÃO ERRO. A
            folha sai inteira: cabeçalho, tabela com esta única linha, total
            zerado e os espaços de assinatura. É o que se leva à mão para
            provar que não houve jornada naquele mês.
          */}
          {linhas.length === 0 ? (
            <tr>
              <td className={`${celula} text-center italic`} colSpan={totalDeColunas}>
                Nenhuma batida registrada em {folha.mesPorExtenso.toLowerCase()}.
              </td>
            </tr>
          ) : (
            linhas.map((linha) => (
              <tr key={linha.dia} className="break-inside-avoid">
                <td className={`${celula} font-mono whitespace-nowrap tabular-nums`}>
                  {linha.data}
                </td>
                <td className={`${celula} whitespace-nowrap`}>{linha.diaDaSemana}</td>

                {colunas.map((indice) => (
                  <td
                    className={`${celula} text-center font-mono tabular-nums`}
                    key={indice}
                  >
                    {/* Coluna sem batida fica VAZIA, e é assim que se enxerga a
                        batida que faltou: o buraco na linha é a informação. */}
                    {linha.horarios[indice] ?? ''}
                  </td>
                ))}

                <td
                  className={`${celula} text-right font-mono font-semibold whitespace-nowrap tabular-nums`}
                >
                  {linha.total}
                </td>
                <td className={celula}>{linha.marcas.join(' · ')}</td>
              </tr>
            ))
          )}
        </tbody>

        <tfoot>
          <tr className="break-inside-avoid bg-black/[0.06] font-semibold">
            <td className={`${celula} text-right`} colSpan={colunas.length + 2}>
              Total do mês
            </td>
            <td className={`${celula} text-right font-mono whitespace-nowrap tabular-nums`}>
              {folha.total}
            </td>
            <td className={celula}>
              {folha.resumo.diasIncompletos > 0
                ? `${folha.resumo.diasIncompletos} dia(s) fora do total`
                : ''}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* ---------------------------------------------------------------- */}
      {/* A legenda — o que as palavras da coluna de observações querem dizer */}
      {/* ---------------------------------------------------------------- */}
      <section className="mt-2.5 break-inside-avoid space-y-0.5 text-[0.6rem] leading-relaxed text-black/75">
        <p>
          <span className="font-semibold">Incompleto — fora do total:</span> o dia tem número ímpar
          de batidas, então falta uma para fechar algum par. Como não é possível saber qual delas
          falta, o dia conta zero até que o administrador corrija — e o mesmo vale no espelho que o
          funcionário vê no aplicativo.
        </p>
        <p>
          <span className="font-semibold">Ajustado pelo administrador:</span> alguma batida do dia
          foi inserida ou corrigida pelo administrador, sempre com motivo escrito e registro de
          quem fez, quando e qual era o valor anterior.
        </p>
        <p>
          <span className="font-semibold">Em atraso, aprovada:</span> o funcionário esqueceu de bater
          e pediu a batida no mesmo dia, com o horário, o motivo, selfie e PIN; ela só entrou na
          folha depois que um administrador conferiu e aprovou. A hora indica qual batida do dia foi.
        </p>
        <p>
          <span className="font-semibold">Falta justificada:</span> ausência lançada pelo
          administrador, com o tipo (atestado médico, falta justificada ou outro motivo) e, quando
          houver, o atestado guardado no sistema. Ela marca o dia, mas não soma nem desconta horas:
          o total do mês é só o das batidas.
        </p>
        <p>
          Os horários são os do relógio do servidor, no fuso de Brasília, e o total é calculado
          pela mesma conta que o funcionário confere no próprio aplicativo.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Assinaturas                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 break-inside-avoid">
        <p className="text-[0.68rem] leading-relaxed">
          Declaro que os horários registrados nesta folha correspondem à jornada efetivamente
          cumprida em {folha.mesPorExtenso.toLowerCase()}.
        </p>

        <p className="mt-4 text-[0.68rem]">Local e data: ______________________________________</p>

        {/*
          Duas assinaturas, lado a lado, no MESMO bloco `break-inside-avoid`:
          uma assinatura partida entre duas páginas invalida o documento na
          prática, porque ninguém assina metade de uma linha.
        */}
        {/*
          O espaço acima da linha existe para a caneta caber. Na TELA ele é
          generoso; no PAPEL ele encolhe, e a diferença não é estética.

          Medido na caixa de impressão: com as folgas de tela, um mês de 21 dias
          com batida transborda a página A4 por CINCO pixels — e o que atravessa
          para a segunda folha é só a linha "Emitida pelo aplicativo". Com 22 dias
          e seis colunas de horário, quem atravessa é o bloco de assinaturas
          inteiro, e o funcionário assina uma página sem uma hora impressa nela.
          Como o mês brasileiro tem de 20 a 23 dias úteis, isso valeria para
          quase toda folha impressa.

          Os 16 px que este `print:mt-8` devolve, mais os 16 do rodapé abaixo,
          são o que traz o mês normal de volta para uma folha só.
        */}
        <div className="mt-12 print:mt-8 grid grid-cols-2 gap-10">
          <div className="border-t border-black pt-1 text-center">
            <LinhaOuBranco
              className="text-[0.7rem] leading-tight font-semibold"
              texto={funcionario.nome}
            />
            <p className="text-[0.62rem] leading-tight text-black/70">Assinatura do funcionário</p>
          </div>
          <div className="border-t border-black pt-1 text-center">
            {/* O responsável assina à mão: o sistema não sabe quem vai imprimir
                esta folha, e imprimir um nome aqui seria atribuir uma
                conferência que talvez não tenha acontecido. */}
            <p className="text-[0.7rem] leading-tight font-semibold">{'\u00a0'}</p>
            <p className="text-[0.62rem] leading-tight text-black/70">
              Assinatura do responsável
            </p>
          </div>
        </div>
      </section>

      {emitidaEm && (
        <p className="mt-6 print:mt-2 text-center text-[0.55rem] text-black/50">
          Emitida pelo aplicativo {marcaDoApp().nome} em {emitidaEm}.
        </p>
      )}
    </article>
  )
}
