import { useState } from 'react'
import { Link2, Save, X } from 'lucide-react'
import { Aviso, Botao, Campo, Modal } from './ui'
import {
  formatarCpf,
  validarFicha,
  type FichaDoFuncionario,
  type RascunhoDaFicha,
} from '../lib/cadastro'

/*
 * A FICHA DO FUNCIONÁRIO — o formulário de criar e editar, e a caixa de
 * desativar e reativar.
 *
 * A lista de fichas é parte da lista de pessoas ("pessoas numa tela só"), e as
 * duas caixas moram aqui, com UMA decisão deliberada:
 *
 * ⚠ O FORMULÁRIO NÃO ESCOLHE A CONTA DA FICHA.
 * Ligar uma ficha ativa a uma conta DÁ ACESSO AO PONTO a essa conta — e o banco
 * recusa isso de quem não é super admin. Um seletor de conta no meio de um
 * cadastro de CPF e cargo transformaria uma edição de RH numa concessão de
 * acesso feita de passagem. O vínculo é ação própria da lista de pessoas
 * ("Ligar a uma conta" / "Ligar a uma ficha"), com sugestão pelo nome e
 * confirmação uma a uma. Aqui a conta é só mostrada, e o que se grava é o
 * vínculo que a ficha já tem (ou o da conta para a qual ela está sendo criada)
 * — o gatilho do banco deixa o admin comum editar o cadastro de uma ficha que
 * já libera a MESMA conta.
 *
 * A GUARDA DE ROTA NÃO PROTEGE NADA DISTO. Quem recusa é o Postgres: a policy
 * de escrita de `ponto_funcionarios` exige `ponto_pode_administrar()`, e o
 * gatilho `ponto_funcionarios_acesso_pelo_super_admin` exige super admin
 * para liberar acesso.
 */

/* ------------------------------------------------------------------ */
/* O formulário da ficha                                               */
/* ------------------------------------------------------------------ */

function rascunhoDaFicha(ficha: FichaDoFuncionario | null, usuarioId: string | null): RascunhoDaFicha {
  return {
    nomeCompleto: ficha?.nomeCompleto ?? '',
    // Com máscara no campo: é assim que o CPF é lido em voz alta e conferido
    // contra um documento. O banco guarda só os dígitos, e a conversão é do
    // `validarFicha`.
    cpf: formatarCpf(ficha?.cpf ?? null),
    matricula: ficha?.matricula ?? '',
    cargo: ficha?.cargo ?? '',
    admissao: ficha?.admissao ?? '',
    desligamento: ficha?.desligamento ?? '',
    ctps: ficha?.ctps ?? '',
    ctpsSerie: ficha?.ctpsSerie ?? '',
    centroCusto: ficha?.centroCusto ?? '',
    usuarioId: ficha?.usuarioId ?? usuarioId ?? '',
    batePontoDesde: ficha?.batePontoDesde ?? '',
  }
}

/**
 * A caixa de criar e editar ficha.
 *
 * `usuarioId` só vale para a ficha NOVA: é a conta para a qual ela está sendo
 * criada (ação do super admin, "Criar a ficha"). Na edição, a conta é a que a
 * ficha já tem, e não muda por aqui.
 *
 * `nomeInicial` preenche o nome completo da ficha nova com o nome da pessoa —
 * é o ponto de partida, e quase nunca o nome inteiro da carteira de trabalho.
 */
export function FormularioDaFicha({
  ficha,
  usuarioId = null,
  nomeInicial = '',
  rotuloDaConta,
  gravando,
  erro,
  aoSalvar,
  aoFechar,
}: {
  ficha: FichaDoFuncionario | null
  usuarioId?: string | null
  nomeInicial?: string
  /** Como a conta ligada aparece na caixa ("Maria — maria@…"); nulo = sem conta. */
  rotuloDaConta: string | null
  gravando: boolean
  erro: string | null
  aoSalvar: (rascunho: RascunhoDaFicha) => void
  aoFechar: () => void
}) {
  const [rascunho, setRascunho] = useState<RascunhoDaFicha>(() => ({
    ...rascunhoDaFicha(ficha, usuarioId),
    ...(ficha ? {} : { nomeCompleto: nomeInicial }),
  }))
  const [erros, setErros] = useState<string[]>([])

  function mudar(campo: keyof RascunhoDaFicha, valor: string) {
    setRascunho((antes) => ({ ...antes, [campo]: valor }))
  }

  function enviar() {
    const leitura = validarFicha(rascunho)
    if (!leitura.ok) {
      setErros(leitura.erros)
      return
    }
    setErros([])
    aoSalvar(rascunho)
  }

  return (
    <Modal
      rotulo={ficha ? `Editar a ficha de ${ficha.nomeCompleto}` : 'Nova ficha de funcionário'}
      aoFechar={aoFechar}
      podeFechar={!gravando}
      largura="ampla"
    >
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              {ficha ? 'Editar ficha' : 'Nova ficha'}
            </p>
            <h2 className="mt-1 text-base font-semibold text-plat">
              {ficha ? ficha.nomeCompleto : 'Funcionário do ponto'}
            </h2>
            <p className="mt-0.5 text-[0.7rem] leading-relaxed text-mute">
              O nome completo é o que sai na folha que a pessoa assina; os outros campos ficam
              guardados no cadastro. Deixar um campo vazio é melhor do que inventar.
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

        <div className="mt-4 space-y-3">
          <Campo
            id="ficha-nome"
            rotulo="Nome completo"
            value={rascunho.nomeCompleto}
            onChange={(evento) => mudar('nomeCompleto', evento.target.value)}
            placeholder="como está na carteira de trabalho"
          />

          {/* CPF e matrícula: um par a partir de 20rem de CAIXA. O CPF com
              máscara tem 14 caracteres e precisa ser conferido por inteiro. */}
          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @min-[20rem]:grid-cols-[1fr_7rem]">
              <Campo
                id="ficha-cpf"
                rotulo="CPF"
                inputMode="numeric"
                value={rascunho.cpf}
                onChange={(evento) => mudar('cpf', evento.target.value)}
                placeholder="000.000.000-00"
              />
              <Campo
                id="ficha-matricula"
                rotulo="Matrícula"
                value={rascunho.matricula}
                onChange={(evento) => mudar('matricula', evento.target.value)}
                placeholder="123"
              />
            </div>
          </div>

          <Campo
            id="ficha-cargo"
            rotulo="Cargo"
            value={rascunho.cargo}
            onChange={(evento) => mudar('cargo', evento.target.value)}
            placeholder="Assistente administrativo"
          />

          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @min-[20rem]:grid-cols-2">
              <Campo
                id="ficha-admissao"
                rotulo="Admissão"
                type="date"
                value={rascunho.admissao}
                onChange={(evento) => mudar('admissao', evento.target.value)}
              />
              <Campo
                id="ficha-desligamento"
                rotulo="Desligamento"
                type="date"
                value={rascunho.desligamento}
                onChange={(evento) => mudar('desligamento', evento.target.value)}
              />
            </div>
          </div>

          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @min-[20rem]:grid-cols-[1fr_7rem]">
              <Campo
                id="ficha-ctps"
                rotulo="CTPS"
                inputMode="numeric"
                value={rascunho.ctps}
                onChange={(evento) => mudar('ctps', evento.target.value)}
                placeholder="número"
              />
              <Campo
                id="ficha-ctps-serie"
                rotulo="Série"
                value={rascunho.ctpsSerie}
                onChange={(evento) => mudar('ctpsSerie', evento.target.value)}
                placeholder="000"
              />
            </div>
          </div>

          <Campo
            id="ficha-centro-custo"
            rotulo="Centro de custo"
            value={rascunho.centroCusto}
            onChange={(evento) => mudar('centroCusto', evento.target.value)}
            placeholder="em branco enquanto não houver"
          />

          {/* A conta, só para conferir: o vínculo é ação própria da lista. */}
          <div className="rounded-xl border border-hair bg-ink-2 px-4 py-3">
            <p className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              <Link2 size={11} aria-hidden="true" />
              Conta para bater ponto
            </p>
            <p className="mt-1 truncate text-sm text-plat">
              {rotuloDaConta ?? 'Sem conta — não bate ponto pelo celular'}
            </p>
            <p className="mt-1 text-[0.68rem] leading-relaxed text-faint">
              {rotuloDaConta
                ? 'Ligar e desligar a conta é feito na lista de pessoas, pelo super admin: a ficha ligada é o que libera o ponto para a conta.'
                : 'Sem conta, a ficha fica guardada, mas ainda não há batida nem folha: as duas são da conta. O super admin liga a ficha a uma conta na lista de pessoas.'}
            </p>
          </div>

          <Campo
            id="ficha-bate-ponto-desde"
            rotulo="Passou a bater ponto aqui em"
            type="date"
            value={rascunho.batePontoDesde}
            onChange={(evento) => mudar('batePontoDesde', evento.target.value)}
          />
          {/*
            A DATA É REGISTRO, NÃO REGRA. Ela aparece na lista de pessoas e nada
            mais a lê: quem libera a batida é a ficha ativa ligada à conta, com ou
            sem a data, e a folha não acusa falta em dia sem batida. Ver
            `batePontoDesde`, em `lib/cadastro.ts`.
          */}
          <p className="text-[0.68rem] leading-relaxed text-faint">
            A data em que a pessoa começou a bater ponto neste sistema. Ela fica guardada e aparece
            na lista de pessoas, mas não muda nada no ponto: não libera nem bloqueia a batida e não
            entra na folha. Preencha quando a pessoa começar de verdade.
          </p>

          {erros.length > 0 && (
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
          )}
          {erro && <Aviso tom="erro">{erro}</Aviso>}
        </div>

        {/* Cancelar em cima, gravar embaixo no celular — mesma ordem da caixa
            de confirmação da lista de pessoas. */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Botao tom="secundario" onClick={aoFechar} disabled={gravando}>
            Cancelar
          </Botao>
          <Botao onClick={enviar} disabled={gravando}>
            <Save size={16} aria-hidden="true" />
            {gravando ? 'Gravando…' : ficha ? 'Salvar a ficha' : 'Criar a ficha'}
          </Botao>
        </div>
      </>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* A caixa de desativar e reativar                                     */
/* ------------------------------------------------------------------ */

/**
 * A confirmação de desativar ou reativar.
 *
 * O TEXTO DESCREVE A CONSEQUÊNCIA, não a operação — mesma regra da caixa de
 * confirmação da lista de pessoas. "Tem certeza?" não confirma nada: quem
 * clicou tem certeza do que clicou, e o que ele pode não saber é o que aquilo
 * faz. A consequência inclui o ACESSO: a ficha ativa ligada a
 * uma conta é o que deixa essa conta bater ponto.
 */
export function CaixaDeAtivo({
  ficha,
  gravando,
  erro,
  aoConfirmar,
  aoFechar,
}: {
  ficha: FichaDoFuncionario
  gravando: boolean
  erro: string | null
  aoConfirmar: () => void
  aoFechar: () => void
}) {
  const desativando = ficha.ativo
  const ligada = ficha.usuarioId !== null
  return (
    <Modal
      rotulo={desativando ? 'Desativar a ficha' : 'Reativar a ficha'}
      aoFechar={aoFechar}
      podeFechar={!gravando}
    >
      <>
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">Confirmar</p>
        <h2 className="mt-1 text-base font-semibold text-plat">
          {desativando ? 'Desativar a ficha' : 'Reativar a ficha'}
        </h2>
        <p className="mt-0.5 truncate text-[0.7rem] text-mute">{ficha.nomeCompleto}</p>

        <div className="mt-4">
          <Aviso tom="atencao">
            {desativando
              ? `A ficha de ${ficha.nomeCompleto} sai da lista de gente ativa e o CPF dela libera para uma ficha nova, se um dia ela for recontratada.${ligada ? ' A conta ligada a ela deixa de bater ponto pela ficha (se administra o ponto, continua entrando só para administrar). As batidas dela ficam, e a folha continua saindo com o nome desta ficha.' : ''} Nada é apagado, e a ficha pode ser reativada depois. Se a pessoa foi desligada, preencha também a data de desligamento na ficha: ela fica registrada e aparece na lista de pessoas.`
              : `A ficha de ${ficha.nomeCompleto} volta para a lista de gente ativa.${ligada ? ' A conta ligada a ela volta a bater ponto pela ficha.' : ''} O banco recusa se já existir outra ficha ATIVA com o mesmo CPF — nesse caso, a pessoa já foi recadastrada e é aquela ficha que vale.`}
          </Aviso>
        </div>

        {erro && (
          <div className="mt-3">
            <Aviso tom="erro">{erro}</Aviso>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Botao tom="secundario" onClick={aoFechar} disabled={gravando}>
            Cancelar
          </Botao>
          <Botao onClick={aoConfirmar} disabled={gravando}>
            {gravando ? 'Gravando…' : desativando ? 'Desativar' : 'Reativar'}
          </Botao>
        </div>
      </>
    </Modal>
  )
}
