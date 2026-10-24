import { useState } from 'react'
import { ArrowLeft, Link2, X } from 'lucide-react'
import { Aviso, Botao, Escolha, Etiqueta, Modal } from './ui'
import type { FichaDoFuncionario } from '../lib/cadastro'
import { formatarCpf } from '../lib/cadastro'
import type { PessoaDaAdministracao } from '../lib/pessoas'
import {
  rotuloDaForca,
  sugerirContasParaFicha,
  sugerirFichasParaConta,
  type ContaParaVinculo,
  type ForcaDaSugestao,
} from '../lib/vinculo'

/*
 * A CAIXA DE LIGAR FICHA E CONTA — do super admin.
 *
 * Os dois lados do mesmo vínculo:
 *   • na linha de uma CONTA sem ficha: "Ligar a uma ficha" — as fichas sem conta;
 *   • na linha de uma FICHA sem conta: "Ligar a uma conta" — as contas sem ficha.
 * As candidatas que combinam pelo nome vêm primeiro, marcadas com a força da
 * sugestão (`lib/vinculo.ts`); as outras ficam num seletor, para o caso em que
 * o nome do login não lembra em nada o da carteira de trabalho.
 *
 * ⚠ NADA É LIGADO SOZINHO, E NADA É LIGADO NUM CLIQUE SÓ. Escolher leva a uma
 * confirmação que diz a consequência — a ficha ativa ligada
 * LIBERA o ponto para a conta, e a folha sai com o nome completo dessa ficha
 * (o resto da ficha não vai para a folha). Um vínculo errado dá a jornada de
 * uma pessoa para outra.
 *
 * Quem recusa de verdade é o banco: o gatilho da ficha exige super admin, o
 * índice `ponto_funcionarios_conta_unica` recusa a segunda ficha da mesma conta,
 * e `vincularFicha` só liga ficha que ainda está sem conta (outra aba não muda
 * o dono em silêncio).
 */

interface Candidata {
  id: string
  titulo: string
  detalhe: string
  forca: ForcaDaSugestao | null
}

function daFicha(ficha: FichaDoFuncionario, forca: ForcaDaSugestao | null): Candidata {
  const detalhe = [
    ficha.cargo,
    ficha.cpf ? formatarCpf(ficha.cpf) : null,
    ficha.ativo ? null : 'ficha desativada',
  ]
    .filter(Boolean)
    .join(' · ')
  return { id: ficha.id, titulo: ficha.nomeCompleto, detalhe: detalhe || 'sem cargo nem CPF', forca }
}

function daConta(conta: ContaParaVinculo, forca: ForcaDaSugestao | null): Candidata {
  return { id: conta.usuarioId, titulo: conta.nome, detalhe: conta.email ?? 'sem e-mail', forca }
}

export function CaixaDeVinculo({
  pessoa,
  fichas,
  contas,
  preEscolhida = null,
  gravando,
  erro,
  aoLigar,
  aoFechar,
}: {
  /** A conta sem ficha, ou a pessoa sem conta (só ficha). */
  pessoa: PessoaDaAdministracao
  /** Todas as fichas (para achar as sem conta e as contas já ligadas). */
  fichas: readonly FichaDoFuncionario[]
  /** As contas que podem receber ficha (`contasSemFicha`). */
  contas: readonly ContaParaVinculo[]
  /** Abre direto na confirmação desta candidata (o atalho "Ligar à sugerida"). */
  preEscolhida?: string | null
  gravando: boolean
  erro: string | null
  aoLigar: (fichaId: string, usuarioId: string) => void
  aoFechar: () => void
}) {
  const ladoDaConta = pessoa.usuarioId !== null
  const [alvo, setAlvo] = useState<string | null>(preEscolhida)
  const [noSeletor, setNoSeletor] = useState('')

  /* As candidatas: sugeridas primeiro, o resto depois. */
  let sugeridas: Candidata[]
  let outras: Candidata[]
  if (ladoDaConta) {
    const sugestoes = sugerirFichasParaConta(
      { usuarioId: pessoa.usuarioId as string, nome: pessoa.nome, email: pessoa.email },
      fichas,
    )
    const ids = new Set(sugestoes.map((sugestao) => sugestao.item.id))
    sugeridas = sugestoes.map((sugestao) => daFicha(sugestao.item, sugestao.forca))
    outras = fichas
      .filter((ficha) => ficha.usuarioId === null && !ids.has(ficha.id))
      .map((ficha) => daFicha(ficha, null))
  } else {
    const ficha = pessoa.ficha as FichaDoFuncionario
    const sugestoes = sugerirContasParaFicha(ficha, contas, fichas)
    const ids = new Set(sugestoes.map((sugestao) => sugestao.item.usuarioId))
    sugeridas = sugestoes.map((sugestao) => daConta(sugestao.item, sugestao.forca))
    outras = contas.filter((conta) => !ids.has(conta.usuarioId)).map((conta) => daConta(conta, null))
  }
  const todas = [...sugeridas, ...outras]
  const escolhida = todas.find((candidata) => candidata.id === alvo) ?? null

  const titulo = ladoDaConta ? 'Ligar a uma ficha' : 'Ligar a uma conta'

  function ligar() {
    if (!escolhida) return
    if (ladoDaConta) aoLigar(escolhida.id, pessoa.usuarioId as string)
    else aoLigar((pessoa.ficha as FichaDoFuncionario).id, escolhida.id)
  }

  /* A frase da consequência, com os dois lados nomeados. */
  function consequencia(candidata: Candidata): string {
    const fichaNome = ladoDaConta ? candidata.titulo : (pessoa.ficha as FichaDoFuncionario).nomeCompleto
    const contaNome = ladoDaConta ? `${pessoa.nome} (${pessoa.email ?? 'sem e-mail'})` : `${candidata.titulo} (${candidata.detalhe})`
    const fichaAtiva = ladoDaConta
      ? (fichas.find((ficha) => ficha.id === candidata.id)?.ativo ?? true)
      : (pessoa.ficha as FichaDoFuncionario).ativo
    return fichaAtiva
      ? `A ficha “${fichaNome}” passa a ser da conta ${contaNome}. Essa conta passa a bater ponto pela ficha, e a folha dela sai com o nome completo desta ficha. Um vínculo errado dá a jornada de uma pessoa para outra: confira o e-mail.`
      : `A ficha “${fichaNome}” passa a ser da conta ${contaNome}. Ela está DESATIVADA: ligar não dá acesso ao ponto, só deixa a folha antiga ligada à pessoa certa.`
  }

  return (
    <Modal rotulo={titulo} aoFechar={aoFechar} podeFechar={!gravando}>
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">
              Super admin
            </p>
            <h2 className="mt-1 text-base font-semibold text-plat">{titulo}</h2>
            <p className="mt-0.5 truncate text-[0.7rem] text-mute">
              {pessoa.nome}
              {ladoDaConta ? ` · ${pessoa.email ?? 'sem e-mail'}` : ' · ficha sem conta'}
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

        {escolhida ? (
          <>
            <div className="mt-4 rounded-xl border border-hair bg-ink-2 px-4 py-3">
              <p className="truncate text-sm font-semibold text-plat">{escolhida.titulo}</p>
              <p className="mt-0.5 truncate text-[0.7rem] text-faint">{escolhida.detalhe}</p>
              {escolhida.forca && (
                <div className="mt-1.5">
                  <Etiqueta tom={escolhida.forca === 'parcial' ? 'aviso' : 'bom'}>
                    sugerida: {rotuloDaForca(escolhida.forca)}
                  </Etiqueta>
                </div>
              )}
            </div>
            <div className="mt-3">
              <Aviso tom="atencao">{consequencia(escolhida)}</Aviso>
            </div>
            {erro && (
              <div className="mt-3">
                <Aviso tom="erro">{erro}</Aviso>
              </div>
            )}
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Botao tom="secundario" onClick={() => setAlvo(null)} disabled={gravando}>
                <ArrowLeft size={15} aria-hidden="true" />
                Escolher outra
              </Botao>
              <Botao onClick={ligar} disabled={gravando}>
                <Link2 size={16} aria-hidden="true" />
                {gravando ? 'Gravando…' : 'Ligar'}
              </Botao>
            </div>
          </>
        ) : (
          <>
            {todas.length === 0 ? (
              <p className="mt-4 text-sm leading-relaxed text-mute">
                {ladoDaConta
                  ? 'Não há ficha sem conta para ligar. Crie a ficha desta conta, ou desligue a ficha certa da conta errada antes.'
                  : 'Não há conta sem ficha para ligar. Crie a conta desta ficha.'}
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {sugeridas.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-plat-dim">Combinam pelo nome</p>
                    <ul className="space-y-2">
                      {sugeridas.map((candidata) => (
                        <li key={candidata.id}>
                          <button
                            type="button"
                            onClick={() => setAlvo(candidata.id)}
                            className="flex w-full min-h-11 items-center justify-between gap-3 rounded-xl border border-hair-2 bg-ink-2 px-3 py-2.5 text-left transition-colors hover:border-hair-3"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-plat">
                                {candidata.titulo}
                              </span>
                              <span className="block truncate text-[0.7rem] text-faint">
                                {candidata.detalhe}
                              </span>
                            </span>
                            {candidata.forca && (
                              <Etiqueta tom={candidata.forca === 'parcial' ? 'aviso' : 'bom'}>
                                {rotuloDaForca(candidata.forca)}
                              </Etiqueta>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {sugeridas.length > 1 && (
                      <p className="mt-1.5 text-[0.68rem] leading-relaxed text-faint">
                        Mais de uma combina: confira {ladoDaConta ? 'o CPF e o cargo' : 'o e-mail'} antes de
                        escolher.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[0.7rem] leading-relaxed text-mute">
                    Nenhuma {ladoDaConta ? 'ficha' : 'conta'} combina pelo nome. Escolha na lista, se tiver
                    certeza de quem é.
                  </p>
                )}

                {outras.length > 0 && (
                  <div className="space-y-2">
                    <Escolha
                      id="vinculo-outra"
                      rotulo={sugeridas.length > 0 ? 'Ou outra' : ladoDaConta ? 'Ficha' : 'Conta'}
                      value={noSeletor}
                      onChange={setNoSeletor}
                    >
                      <option value="">Escolha…</option>
                      {outras.map((candidata) => (
                        <option key={candidata.id} value={candidata.id}>
                          {candidata.titulo} — {candidata.detalhe}
                        </option>
                      ))}
                    </Escolha>
                    <Botao
                      tom="secundario"
                      onClick={() => setAlvo(noSeletor)}
                      disabled={noSeletor === ''}
                    >
                      Escolher esta
                    </Botao>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4">
              <Botao tom="secundario" onClick={aoFechar}>
                Cancelar
              </Botao>
            </div>
          </>
        )}
      </>
    </Modal>
  )
}
