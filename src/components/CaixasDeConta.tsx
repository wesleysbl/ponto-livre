import { useMemo, useState, type ReactNode } from 'react'
import { KeyRound, Mail, RefreshCw, UserPen, UserPlus, X } from 'lucide-react'
import { Aviso, Botao, Campo, Escolha, Modal } from './ui'
import {
  gerarSenhaProvisoria,
  SENHA_PROVISORIA_MINIMO,
  validarNovaConta,
  validarNovaSenha,
  validarTrocaDeEmail,
  validarTrocaDeNome,
  type CorpoDoPedidoDeConta,
} from '../lib/contas'
import type { FichaDoFuncionario } from '../lib/cadastro'
import type { PessoaDaAdministracao } from '../lib/pessoas'
import { rotuloDaForca, sugerirFichasPeloNome } from '../lib/vinculo'

/*
 * AS CAIXAS DE CONTA DA LISTA DE PESSOAS — criar conta com ficha,
 * trocar nome, trocar e-mail e redefinir senha.
 *
 * QUEM FAZ É A EDGE FUNCTION `ponto-contas`, e só para o super
 * admin: ela pergunta ao banco, com a sessão de quem chama, se é super admin, e
 * responde 403 a qualquer outro. A tela mostra estas caixas só ao super admin
 * (`acoesDaPessoa`), confere o formulário com a MESMA regra da função
 * (`lib/contas.ts` roda o `lerPedido` dela) e mostra a frase que a função
 * devolve — inclusive "esse e-mail já existe no login de outra conta", o caso
 * de borda mais comum.
 *
 * A SENHA PROVISÓRIA APARECE EM TEXTO ABERTO, de propósito: é a senha que o
 * super admin vai passar à pessoa, e ele precisa ler e copiar. Ela não é
 * guardada em lugar nenhum além do campo, e some quando a caixa fecha.
 */

/** Cabeçalho comum: rótulo pequeno, título, linha de quem, e o X de fechar. */
function Cabecalho({
  rotulo,
  titulo,
  quem,
  gravando,
  aoFechar,
}: {
  rotulo: string
  titulo: string
  quem: string | null
  gravando: boolean
  aoFechar: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">{rotulo}</p>
        <h2 className="mt-1 text-base font-semibold text-plat">{titulo}</h2>
        {quem && <p className="mt-0.5 truncate text-[0.7rem] text-mute">{quem}</p>}
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
  )
}

/** As frases de recusa, todas de uma vez. Uma por linha. */
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

/**
 * O campo da senha provisória, com o botão de sugerir outra.
 *
 * `type="text"` e `autoComplete="off"`: não é a senha de quem está digitando,
 * e o gerenciador de senhas do navegador não deve oferecer salvá-la como se
 * fosse.
 *
 * A FRASE DE BAIXO DIZ QUEM TROCA A SENHA DEPOIS: o super admin, por
 * "Redefinir a senha". O app não tem tela para a pessoa trocar a própria
 * senha, e prometer isso faria o super admin dizer à pessoa que ela troca
 * sozinha — e a provisória ficaria valendo para sempre sem ninguém saber.
 */
function CampoDaSenha({
  valor,
  aoMudar,
  desabilitado,
}: {
  valor: string
  aoMudar: (senha: string) => void
  desabilitado: boolean
}) {
  return (
    <div>
      <Campo
        id="conta-senha"
        rotulo="Senha provisória"
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
        placeholder={`${SENHA_PROVISORIA_MINIMO} caracteres ou mais`}
      />
      <div className="mt-2">
        <Botao tom="secundario" onClick={() => aoMudar(gerarSenhaProvisoria())} disabled={desabilitado}>
          <RefreshCw size={15} aria-hidden="true" />
          Sugerir outra senha
        </Botao>
      </div>
      <p className="mt-1.5 text-[0.68rem] leading-relaxed text-faint">
        Copie a senha antes de confirmar e passe à pessoa por um canal seguro: depois de gravada,
        ela não aparece mais em lugar nenhum. A pessoa entra com ela; para trocar de senha, o super
        admin usa “Redefinir a senha” na linha dela.
      </p>
    </div>
  )
}

/** O par de botões do rodapé: cancelar em cima, confirmar embaixo no celular. */
function Rodape({
  gravando,
  rotulo,
  icone,
  aoConfirmar,
  aoFechar,
}: {
  gravando: boolean
  rotulo: string
  icone: ReactNode
  aoConfirmar: () => void
  aoFechar: () => void
}) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Botao tom="secundario" onClick={aoFechar} disabled={gravando}>
        Cancelar
      </Botao>
      <Botao onClick={aoConfirmar} disabled={gravando}>
        {icone}
        {gravando ? 'Gravando…' : rotulo}
      </Botao>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Conta nova, com ficha                                               */
/* ------------------------------------------------------------------ */

/** O que fazer com a ficha depois que a conta nascer. */
export type FichaDaContaNova =
  | { tipo: 'existente'; ficha: FichaDoFuncionario }
  | { tipo: 'nova' }
  | { tipo: 'nenhuma' }

/** O valor do `<select>` de ficha: o id de uma ficha, ou um destes dois. */
const FICHA_NOVA = '__nova__'
const SEM_FICHA = '__nenhuma__'

/**
 * Criar conta COM FICHA: a conta e a ficha dela saem da mesma caixa.
 *
 * POR QUE A FICHA VEM JUNTO: é a ficha ativa ligada que libera o
 * ponto. Uma conta criada sem ficha (e sem administrar) entra no app e cai em
 * "sem acesso". Então a caixa já pergunta qual ficha ligar:
 *   • uma ficha SEM CONTA que já existe — sugerida pelo nome digitado, como na
 *     ligação de fichas (`sugerirFichasPeloNome`); quem confirma é o super admin;
 *   • uma ficha NOVA com o nome da pessoa (o resto do cadastro de RH se completa
 *     depois, em "Editar a ficha");
 *   • nenhuma, dito com a consequência.
 *
 * `fichaFixa` é o caminho da linha de uma ficha sem conta ("Criar a conta"): a
 * ficha já está escolhida, e o nome vem dela.
 *
 * A conta nasce na função; a ficha é ligada ou criada DEPOIS, pela tela, com a
 * sessão do super admin (um gatilho do banco confere). Se a segunda parte
 * falhar, a conta fica criada e a tela diz que falta ligar a ficha.
 */
export function FormularioDeNovaConta({
  fichas,
  fichaFixa,
  gravando,
  erros,
  aoCriar,
  aoFechar,
}: {
  /** Todas as fichas: as sem conta são as que podem ser escolhidas. */
  fichas: readonly FichaDoFuncionario[]
  fichaFixa: FichaDoFuncionario | null
  gravando: boolean
  erros: string[]
  aoCriar: (pedido: { corpo: CorpoDoPedidoDeConta; ficha: FichaDaContaNova }) => void
  aoFechar: () => void
}) {
  const [nome, setNome] = useState(fichaFixa?.nomeCompleto ?? '')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState(() => gerarSenhaProvisoria())
  /** `null` = automático: a ficha mais provável pelo nome, ou uma nova. */
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [errosDoFormulario, setErrosDoFormulario] = useState<string[]>([])

  const semConta = useMemo(
    () => fichas.filter((ficha) => ficha.usuarioId === null && ficha.ativo),
    [fichas],
  )
  const sugestoes = useMemo(
    () => (fichaFixa ? [] : sugerirFichasPeloNome(nome, email || null, semConta)),
    [fichaFixa, nome, email, semConta],
  )
  const sugeridas = new Set(sugestoes.map((sugestao) => sugestao.item.id))
  const valor = escolhida ?? sugestoes[0]?.item.id ?? FICHA_NOVA

  function fichaEscolhida(): FichaDaContaNova {
    if (fichaFixa) return { tipo: 'existente', ficha: fichaFixa }
    if (valor === SEM_FICHA) return { tipo: 'nenhuma' }
    const existente = semConta.find((ficha) => ficha.id === valor)
    return existente ? { tipo: 'existente', ficha: existente } : { tipo: 'nova' }
  }

  function enviar() {
    const leitura = validarNovaConta({ nome, email, senha })
    if (!leitura.ok) {
      setErrosDoFormulario(leitura.erros)
      return
    }
    setErrosDoFormulario([])
    aoCriar({ corpo: leitura.valor, ficha: fichaEscolhida() })
  }

  const ficha = fichaEscolhida()

  return (
    <Modal rotulo="Criar conta" aoFechar={aoFechar} podeFechar={!gravando} largura="ampla">
      <>
        <Cabecalho
          rotulo="Super admin"
          titulo={fichaFixa ? 'Criar a conta desta ficha' : 'Nova conta para bater ponto'}
          quem={fichaFixa ? fichaFixa.nomeCompleto : null}
          gravando={gravando}
          aoFechar={aoFechar}
        />

        <div className="mt-4 space-y-3">
          <Campo
            id="conta-nome"
            rotulo="Nome da pessoa"
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            placeholder="como ela é chamada no dia a dia"
          />
          <Campo
            id="conta-email"
            rotulo="E-mail para entrar"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            placeholder="nome@example.com"
          />
          <CampoDaSenha valor={senha} aoMudar={setSenha} desabilitado={gravando} />

          {fichaFixa ? (
            <Aviso tom="neutro">
              A ficha “{fichaFixa.nomeCompleto}” será ligada a esta conta assim que ela for criada:
              a pessoa passa a bater ponto com o e-mail e a senha acima.
            </Aviso>
          ) : (
            <>
              <Escolha
                id="conta-ficha"
                rotulo="Ficha do ponto"
                value={valor}
                onChange={setEscolhida}
                disabled={gravando}
              >
                <option value={FICHA_NOVA}>Criar uma ficha nova com este nome</option>
                {sugestoes.map((sugestao) => (
                  <option key={sugestao.item.id} value={sugestao.item.id}>
                    {sugestao.item.nomeCompleto} — sugerida ({rotuloDaForca(sugestao.forca)})
                  </option>
                ))}
                {semConta
                  .filter((outra) => !sugeridas.has(outra.id))
                  .map((outra) => (
                    <option key={outra.id} value={outra.id}>
                      {outra.nomeCompleto} — ficha sem conta
                    </option>
                  ))}
                <option value={SEM_FICHA}>Sem ficha por enquanto</option>
              </Escolha>
              <p className="text-[0.68rem] leading-relaxed text-faint">
                {ficha.tipo === 'existente'
                  ? `A ficha “${ficha.ficha.nomeCompleto}” passa a ser desta conta: a pessoa bate ponto por ela, e a folha sai com o nome completo da ficha. Confira se é a mesma pessoa — um vínculo errado dá a jornada de uma para outra.`
                  : ficha.tipo === 'nova'
                    ? 'Nasce uma ficha só com o nome, já ligada à conta: a pessoa bate ponto por ela. CPF, cargo, admissão e a data em que passou a bater ponto aqui se completam depois, em “Editar a ficha”.'
                    : 'Sem ficha, a conta entra no app e cai em “sem acesso”, a não ser que o super admin a faça administrar o ponto. Dá para ligar uma ficha depois, pela lista.'}
              </p>
            </>
          )}

          <Recusas erros={errosDoFormulario.length > 0 ? errosDoFormulario : erros} />
        </div>

        <Rodape
          gravando={gravando}
          rotulo="Criar a conta"
          icone={<UserPlus size={16} aria-hidden="true" />}
          aoConfirmar={enviar}
          aoFechar={aoFechar}
        />
      </>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Trocar nome, trocar e-mail, redefinir senha                         */
/* ------------------------------------------------------------------ */

export type AcaoDeConta = 'trocar-nome' | 'trocar-email' | 'redefinir-senha'

/**
 * A caixa das três ações de uma conta que já existe. Um campo só, com a
 * consequência escrita embaixo — mesma regra das confirmações da lista: a
 * frase diz o que muda para a OUTRA pessoa.
 */
export function FormularioDeConta({
  acao,
  pessoa,
  gravando,
  erros,
  aoEnviar,
  aoFechar,
}: {
  acao: AcaoDeConta
  pessoa: PessoaDaAdministracao & { usuarioId: string }
  gravando: boolean
  erros: string[]
  aoEnviar: (corpo: CorpoDoPedidoDeConta) => void
  aoFechar: () => void
}) {
  const [valor, setValor] = useState(() =>
    acao === 'trocar-nome'
      ? pessoa.nome
      : acao === 'trocar-email'
        ? (pessoa.email ?? '')
        : gerarSenhaProvisoria(),
  )
  const [errosDoFormulario, setErrosDoFormulario] = useState<string[]>([])

  function enviar() {
    const leitura =
      acao === 'trocar-nome'
        ? validarTrocaDeNome(pessoa.usuarioId, valor)
        : acao === 'trocar-email'
          ? validarTrocaDeEmail(pessoa.usuarioId, valor)
          : validarNovaSenha(pessoa.usuarioId, valor, pessoa.email)
    if (!leitura.ok) {
      setErrosDoFormulario(leitura.erros)
      return
    }
    setErrosDoFormulario([])
    aoEnviar(leitura.valor)
  }

  const quem = `${pessoa.nome} · ${pessoa.email ?? 'sem e-mail'}`
  const nomeDaFicha = pessoa.ficha?.nomeCompleto ?? null

  return (
    <Modal
      rotulo={
        acao === 'trocar-nome' ? 'Trocar o nome' : acao === 'trocar-email' ? 'Trocar o e-mail' : 'Redefinir a senha'
      }
      aoFechar={aoFechar}
      podeFechar={!gravando}
    >
      <>
        <Cabecalho
          rotulo="Super admin"
          titulo={
            acao === 'trocar-nome'
              ? 'Trocar o nome'
              : acao === 'trocar-email'
                ? 'Trocar o e-mail'
                : 'Redefinir a senha'
          }
          quem={quem}
          gravando={gravando}
          aoFechar={aoFechar}
        />

        <div className="mt-4 space-y-3">
          {acao === 'trocar-nome' && (
            <>
              <Campo
                id="conta-novo-nome"
                rotulo="Nome"
                value={valor}
                onChange={(evento) => setValor(evento.target.value)}
              />
              <Aviso tom="neutro">
                O nome muda no login
                {nomeDaFicha
                  ? ` e na ficha ligada — que é o nome impresso na folha (hoje: “${nomeDaFicha}”). Se a ficha deve guardar o nome completo da carteira de trabalho, edite só a ficha.`
                  : '.'}{' '}
                As batidas antigas continuam com o nome da época.
              </Aviso>
            </>
          )}

          {acao === 'trocar-email' && (
            <>
              <Campo
                id="conta-novo-email"
                rotulo="E-mail novo"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                value={valor}
                onChange={(evento) => setValor(evento.target.value)}
              />
              <Aviso tom="atencao">
                A pessoa passa a entrar com o e-mail novo, na hora; a senha continua a mesma. Se o
                e-mail já for o login de outra conta, nada muda e a tela avisa.
              </Aviso>
            </>
          )}

          {acao === 'redefinir-senha' && (
            <>
              <CampoDaSenha valor={valor} aoMudar={setValor} desabilitado={gravando} />
              <Aviso tom="atencao">
                A senha atual de {pessoa.nome} deixa de valer na hora. O PIN não muda: para isso, use
                “Resetar PIN”.
              </Aviso>
            </>
          )}

          <Recusas erros={errosDoFormulario.length > 0 ? errosDoFormulario : erros} />
        </div>

        <Rodape
          gravando={gravando}
          rotulo={
            acao === 'trocar-nome' ? 'Trocar o nome' : acao === 'trocar-email' ? 'Trocar o e-mail' : 'Redefinir a senha'
          }
          icone={
            acao === 'trocar-nome' ? (
              <UserPen size={16} aria-hidden="true" />
            ) : acao === 'trocar-email' ? (
              <Mail size={16} aria-hidden="true" />
            ) : (
              <KeyRound size={16} aria-hidden="true" />
            )
          }
          aoConfirmar={enviar}
          aoFechar={aoFechar}
        />
      </>
    </Modal>
  )
}
