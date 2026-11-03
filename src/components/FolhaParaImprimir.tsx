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
 * O SALDO ENTRA SEM ENCOLHER A LETRA. Com as regras do saldo, a tabela ganha
 * Previsto, Abonado e Saldo depois do Trabalhado, e as observações descem para
 * uma segunda linha do mesmo dia (só quando o dia tem alguma): as três colunas
 * novas não cabiam ao lado da coluna de observações nos 186 mm do A4 retrato
 * sem a fonte ir abaixo da de sempre. Falta, atraso e a ausência com o horário
 * são marcas, em palavra, nessa linha. Sem as regras, a tabela é exatamente a
 * de antes, e uma frase diz por que não há saldo.
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
  const saldo = folha.saldo

  /* As colunas de horário, como índices — 4 no mínimo, mais quando algum dia
     do mês teve mais batidas. Ver `colunasDeHorario` em `lib/folha.ts`. */
  const colunas = Array.from({ length: folha.colunasDeHorario }, (_, indice) => indice)
  /**
   * Quantas colunas a tabela tem ao todo. Sem saldo: data, dia, horários,
   * total, obs. Com saldo: data, dia, horários, trabalhado, previsto, abonado,
   * saldo (as observações vão numa linha própria do dia).
   */
  const totalDeColunas = colunas.length + (saldo ? 6 : 4)

  /*
   * Com o saldo, a margem lateral da célula cai de 6 para 4 px, e é por ela,
   * e não pela letra, que as colunas novas cabem: um mês com seis colunas de
   * horário passaria da largura útil do A4 e a coluna do saldo sairia cortada
   * na margem. A letra continua a de sempre.
   *
   * O MÊS LARGO: com o saldo e mais de seis colunas de horário (um dia de sete
   * ou oito batidas), a margem menor não basta. Aí a margem lateral cai para
   * 2 px e o dia da semana pode quebrar no hífen ("segunda-" / "feira"): uma
   * linha a mais no dia, em vez de uma coluna cortada na margem. Até seis
   * colunas de horário, o dia da semana fica numa linha só.
   *
   * E a margem de cima e de baixo cai 1 px com o saldo (`py-[3px]`): a legenda
   * do saldo, o resumo do mês e o cabeçalho de horário em duas linhas (com seis
   * colunas) somam uns 40 px, e eles voltam daqui e da altura da linha no papel
   * (ver a tabela, abaixo).
   */
  const mesLargo = saldo !== null && colunas.length > 6
  const celula = `border border-black/70 ${mesLargo ? 'px-0.5' : saldo ? 'px-1' : 'px-1.5'} ${saldo ? 'py-[3px]' : 'py-1'} align-middle`

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

        <div className="flex shrink-0 gap-6 text-right">
          <div>
            {/* Com abono no mês, o número do alto é o trabalhado mais o abonado,
                com a conta embaixo: o mesmo total da tela. O "Total do mês" da
                tabela continua sendo só o das batidas. */}
            <Rotulo>{folha.abono ? 'Total com abono' : 'Total do mês'}</Rotulo>
            <p className="font-mono text-[1.35rem] leading-tight font-semibold tabular-nums">
              {folha.abono ? folha.abono.total : folha.total}
            </p>
            {folha.abono && <p className="text-[0.65rem] leading-tight">{folha.abono.composicao}</p>}
            <p className="text-[0.65rem] leading-tight">
              {folha.resumo.diasComBatida}{' '}
              {folha.resumo.diasComBatida === 1 ? 'dia com batida' : 'dias com batida'}
              {folha.resumo.diasIncompletos > 0 &&
                ` · ${folha.resumo.diasIncompletos} incompleto${folha.resumo.diasIncompletos === 1 ? '' : 's'}`}
            </p>
          </div>
          {saldo && (
            <div>
              <Rotulo>Saldo do mês</Rotulo>
              <p className="font-mono text-[1.35rem] leading-tight font-semibold tabular-nums">
                {saldo.saldo}
              </p>
              {/* Só os dias com jornada (`diasComJornada`, de `saldo.ts`): o
                  sábado e o domingo sem jornada também são dias de cobrança, e
                  "30 dias fechados" ao lado de "17 dias com batida" confundiria. */}
              <p className="text-[0.65rem] leading-tight">
                {saldo.resumo.diasComJornada}{' '}
                {saldo.resumo.diasComJornada === 1 ? 'dia de jornada na conta' : 'dias de jornada na conta'}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* A tabela do mês                                                  */}
      {/* ---------------------------------------------------------------- */}
      {/*
        `print:w-[calc(100%-2px)]`: com a tabela na largura exata da área útil
        do A4 (186 mm), o fio da borda direita cairia fora dela e a impressão o
        cortaria. Dois pixels para dentro e a tabela sai fechada dos dois lados.

        `print:leading-tight`: no papel, a linha do dia tem a altura do texto
        mais as margens da célula, e não a entrelinha folgada da tela. A letra é
        a mesma. Medido no PDF do Chrome (A4, margens do `@page`): com a
        entrelinha de tela, o mês fechado de 22 dias, sem observação, passava da
        página por 67 px com quatro colunas de horário e por 84 px com seis, e
        as assinaturas iam sozinhas para a segunda folha; com esta e a legenda
        mais justa, os dois cabem numa folha só, com 28 e 14 px de sobra.
      */}
      <table className="mt-3 w-full border-collapse text-[0.68rem] print:w-[calc(100%-2px)] print:leading-tight">
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
              {saldo ? 'Trabalhado' : 'Total'}
            </th>
            {saldo ? (
              <>
                <th className={`${celula} text-right`} scope="col">
                  Previsto
                </th>
                <th className={`${celula} text-right`} scope="col">
                  Abonado
                </th>
                {/* `w-14`: a coluna do saldo não cresce para caber "em
                    andamento" numa linha só (ele quebra em duas); o espaço vai
                    para o dia da semana, que aparece em toda linha. */}
                <th className={`${celula} w-14 text-right`} scope="col">
                  Saldo
                </th>
              </>
            ) : (
              <th className={`${celula} text-left`} scope="col">
                Observações
              </th>
            )}
          </tr>
        </thead>

        {/*
          MÊS SEM BATIDA É RESPOSTA, NÃO ERRO. A
          folha sai inteira: cabeçalho, tabela com esta única linha, total
          zerado e os espaços de assinatura. É o que se leva à mão para
          provar que não houve jornada naquele mês.
        */}
        {linhas.length === 0 ? (
          <tbody>
            <tr>
              <td className={`${celula} text-center italic`} colSpan={totalDeColunas}>
                Nenhuma batida registrada em {folha.mesPorExtenso.toLowerCase()}.
              </td>
            </tr>
          </tbody>
        ) : (
          linhas.map((linha) => {
            /* Com saldo, as observações do dia descem para uma linha própria,
               debaixo dele, e a data abraça as duas (`rowSpan`). Um `<tbody>`
               por dia, com `break-inside-avoid`: o dia não se parte entre duas
               folhas. */
            const obsEmLinhaPropria = saldo !== null && linha.marcas.length > 0
            return (
              <tbody key={linha.dia} className="break-inside-avoid">
                <tr className="break-inside-avoid">
                  <td
                    className={`${celula} font-mono whitespace-nowrap tabular-nums`}
                    rowSpan={obsEmLinhaPropria ? 2 : 1}
                  >
                    {linha.data}
                  </td>
                  {/* Só o mês largo deixa o dia da semana quebrar (ver `mesLargo`). */}
                  <td className={`${celula} ${mesLargo ? '' : 'whitespace-nowrap'}`}>{linha.diaDaSemana}</td>

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
                  {saldo ? (
                    <>
                      <td className={`${celula} text-right font-mono whitespace-nowrap tabular-nums`}>
                        {linha.saldo?.previsto ?? ''}
                      </td>
                      <td className={`${celula} text-right font-mono whitespace-nowrap tabular-nums`}>
                        {linha.saldo?.abonado ?? ''}
                      </td>
                      {/* "pendente" e "em andamento" vão em texto comum, e não em
                          mono: são palavra, não número. */}
                      <td
                        className={`${celula} text-right tabular-nums ${
                          linha.saldo?.estado === 'cobranca' ? 'font-mono font-semibold whitespace-nowrap' : 'italic'
                        }`}
                      >
                        {linha.saldo?.saldo ?? ''}
                      </td>
                    </>
                  ) : (
                    <td className={celula}>{linha.marcas.join(' · ')}</td>
                  )}
                </tr>
                {obsEmLinhaPropria && (
                  <tr className="break-inside-avoid">
                    <td className={celula} colSpan={totalDeColunas - 1}>
                      {linha.marcas.join(' · ')}
                    </td>
                  </tr>
                )}
              </tbody>
            )
          })
        )}

        {/*
          `table-row-group`: o navegador repete o `<tfoot>` no pé de CADA página
          impressa, e numa folha de duas páginas o "Total do mês" apareceria no
          meio do mês, depois do último dia da primeira folha. Assim ele sai uma
          vez só, no fim da tabela. O `<thead>` continua repetindo.
        */}
        <tfoot className="table-row-group">
          <tr className="break-inside-avoid bg-black/[0.06] font-semibold">
            <td className={`${celula} text-right`} colSpan={colunas.length + 2}>
              Total do mês
            </td>
            <td className={`${celula} text-right font-mono whitespace-nowrap tabular-nums`}>
              {folha.total}
            </td>
            {saldo ? (
              <>
                <td className={`${celula} text-right font-mono whitespace-nowrap tabular-nums`}>
                  {saldo.previsto}
                </td>
                {/* A soma da coluna inteira, os dias antes do primeiro dia cobrado
                    inclusive: é o abono do "Total com abono" do alto, e não o
                    abonado do resumo, que soma só os dias cobrados. */}
                <td className={`${celula} text-right font-mono whitespace-nowrap tabular-nums`}>
                  {saldo.abonadoDaColuna}
                </td>
                <td className={`${celula} text-right font-mono whitespace-nowrap tabular-nums`}>
                  {saldo.saldo}
                </td>
              </>
            ) : (
              <td className={celula}>
                {folha.resumo.diasIncompletos > 0
                  ? `${folha.resumo.diasIncompletos} dia(s) fora do total`
                  : ''}
              </td>
            )}
          </tr>
        </tfoot>
      </table>

      {/* ---------------------------------------------------------------- */}
      {/* O resumo do mês: horas extras, horas negativas, faltas e saldo    */}
      {/* ---------------------------------------------------------------- */}
      {/*
        DO RESUMO ÀS ASSINATURAS, UM BLOCO SÓ (`break-inside-avoid`). Quando o
        mês não cabe numa folha (dias com observação, um 23º dia útil), o que
        passa para a segunda é o bloco inteiro: o resumo do mês, a legenda e as
        assinaturas, juntos. Assim a folha assinada nunca é uma página sem uma
        hora impressa nela.

        O quadro em que se fecha o mês: sai sempre que há saldo, com zero quando
        não há o que somar, para ninguém precisar somar a coluna do saldo à mão.
        Uma linha só de altura, para o mês fechado de 22 dias caber numa folha
        só, com as assinaturas. Desde quando o saldo conta, os dias incompletos e
        hoje vêm numa frase logo abaixo.
      */}
      <div className="break-inside-avoid">
        {saldo ? (
          <section className="mt-2.5 break-inside-avoid">
            <Rotulo>Resumo do mês</Rotulo>
            <dl className="mt-0.5 grid grid-cols-4 border border-black/60 text-[0.7rem] leading-tight">
              {(
                [
                  ['Horas extras', saldo.extras],
                  ['Horas negativas', saldo.negativas],
                  ['Faltas', saldo.faltas],
                  ['Saldo do mês', saldo.saldo],
                ] as const
              ).map(([rotulo, valor], i) => (
                <div
                  key={rotulo}
                  className={`flex items-baseline justify-between gap-2 px-2 py-1 ${i > 0 ? 'border-l border-black/60' : ''}`}
                >
                  <dt>{rotulo}</dt>
                  <dd className="font-mono font-semibold whitespace-nowrap tabular-nums">{valor}</dd>
                </div>
              ))}
            </dl>
            {(saldo.notaDoInicio || saldo.notaDosIncompletos || saldo.notaDeHoje) && (
              <p className="mt-1 text-[0.68rem] leading-relaxed">
                {[saldo.notaDoInicio, saldo.notaDosIncompletos, saldo.notaDeHoje].filter(Boolean).join(' ')}
              </p>
            )}
          </section>
        ) : (
          folha.semSaldo && (
            <p className="mt-2.5 break-inside-avoid text-[0.68rem] leading-relaxed">{folha.semSaldo}</p>
          )
        )}

        {/* ---------------------------------------------------------------- */}
        {/* A legenda: o que as palavras da coluna de observações querem dizer   */}
        {/* ---------------------------------------------------------------- */}
        {/*
          Só os itens que o mês usa (`folha.legenda`): a palavra que não aparece
          em dia nenhum não precisa de explicação, e o espaço dela é o que deixa o
          mês comum, com as colunas do saldo, numa folha só. No papel, a
          entrelinha da legenda também fica mais justa (`print:leading-snug`).
        */}
        <section className="mt-2.5 break-inside-avoid space-y-0.5 text-[0.6rem] leading-relaxed text-black/75 print:leading-snug">
          {saldo && (
            <p>
              <span className="font-semibold">Previsto, abonado e saldo:</span> previsto é a jornada do
              dia; abonado é a parte dela coberta por atestado ou falta justificada e não trabalhada;
              saldo é trabalhado mais abonado menos previsto, e diferença de até{' '}
              {saldo.toleranciaMinutos} min no dia não conta. No resumo do mês, horas extras somam o saldo
              positivo dos dias e horas negativas somam o negativo, faltas inclusive.
              {folha.legenda.falta && ' Falta é dia da jornada sem batida e sem abono que cubra o dia.'}
              {folha.legenda.atrasoDaEntrada &&
                ' Atraso é entrada depois do início da jornada além da tolerância, e o tempo dele já está no saldo.'}
              {folha.legenda.foraDoSaldo &&
                ' Hoje fica em andamento e o dia incompleto fica com o saldo pendente: os dois ficam fora do saldo do mês, que soma só os dias fechados.'}
            </p>
          )}
          {folha.legenda.incompleto && (
            <p>
              <span className="font-semibold">Incompleto:</span> fora do total, porque o dia tem número
              ímpar de batidas, então falta uma para fechar algum par. Como não é possível saber qual delas
              falta, o dia conta zero até que o administrador corrija
              {saldo ? ', e o saldo dele fica pendente' : ''}. O mesmo vale no espelho que o funcionário
              vê no aplicativo.
            </p>
          )}
          {folha.legenda.ajustado && (
            <p>
              <span className="font-semibold">Ajustado pelo administrador:</span> alguma batida do dia
              foi inserida ou corrigida pelo administrador, sempre com motivo escrito e registro de
              quem fez, quando e qual era o valor anterior.
            </p>
          )}
          {folha.legenda.batidaEmAtraso && (
            <p>
              <span className="font-semibold">Em atraso, aprovada:</span> o funcionário esqueceu de
              bater e pediu a batida no mesmo dia, com o horário, o motivo, selfie e PIN; ela só entrou
              na folha depois que um administrador conferiu e aprovou. A hora indica qual batida do dia
              foi.
            </p>
          )}
          {folha.legenda.ausencia && (
            <p>
              <span className="font-semibold">Atestado, Falta justificada, Outro motivo:</span> ausência
              lançada pelo administrador, pelo dia inteiro ou por um intervalo de horário (que vem na
              marca), com o atestado guardado no sistema quando houver. Atestado e falta justificada
              abonam a parte da jornada que cobrem; outro motivo só marca o dia. Nenhuma delas muda o
              total trabalhado, que é só o das batidas.
              {folha.legenda.abono && ' O total com abono, no alto da folha, soma o trabalhado e o abonado.'}
            </p>
          )}
          {folha.legenda.feriado && (
            <p>
              <span className="font-semibold">Feriado:</span> feriado nacional
              {saldo
                ? '. É dia sem jornada, como o sábado e o domingo: não tem previsto nem falta, e o que se trabalha nele é hora extra.'
                : '.'}
            </p>
          )}
          <p>
            Os horários são os do relógio do servidor, no fuso de Brasília, e o total
            {saldo ? ' e o saldo são calculados' : ' é calculado'} pela mesma conta que o funcionário
            confere no próprio aplicativo.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Assinaturas                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-6 print:mt-4 break-inside-avoid">
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
            com batida transborda a página A4 por CINCO pixels, e o que atravessa
            para a segunda folha é só a linha "Emitida pelo aplicativo". Com 22 dias
            e seis colunas de horário, quem atravessa é o bloco de assinaturas
            inteiro, e o funcionário assina uma página sem uma hora impressa nela.
            Como o mês brasileiro tem de 20 a 23 dias úteis, isso valeria para
            quase toda folha impressa.

            Os 16 px que este `print:mt-8` devolve, mais os 16 do rodapé abaixo e
            os 8 do `print:mt-4` do bloco, entram na conta do mês normal numa
            folha só (ver a tabela).
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
      </div>
    </article>
  )
}
