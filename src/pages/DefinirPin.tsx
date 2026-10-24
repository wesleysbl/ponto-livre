import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { definirPin } from '../lib/pin'
import { useAuth } from '../hooks/useAuth'
import { telaInicial } from '../lib/acesso'
import { TAMANHO_PIN, TecladoPin } from '../components/TecladoPin'
import { Aviso, Botao, Moldura, Painel } from '../components/ui'

/*
 * Criação do PIN — na primeira entrada, ou depois de o admin resetar.
 *
 * DOIS PASSOS, SEM CAMPO DE TEXTO
 * Digita quatro dígitos, repete os quatro. Não existe campo "confirmar PIN" ao
 * lado do primeiro justamente para que a repetição seja de memória: um campo
 * visível ao lado do outro deixa copiar com os olhos, e o erro de digitação
 * passa batido até a pessoa ficar trancada fora do próprio ponto.
 *
 * ERRO NA REPETIÇÃO VOLTA AO PASSO 1
 * Não "apague e tente a segunda de novo": se os dois não bateram, não dá para
 * saber qual dos dois estava errado.
 *
 * NENHUMA REGRA ALÉM DE 4 DÍGITOS
 * O banco pede `^[0-9]{4}$` e nada mais. Não bloqueamos 1234 nem 0000 aqui:
 * uma regra que o servidor não conhece vira uma tela dizendo não a um valor
 * que a API aceita. Se um dia virar exigência, o lugar é a
 * função `ponto_definir_pin`, para valer também fora deste app.
 */

type Etapa = 'primeira' | 'repetir'

export function DefinirPin() {
  const { pin, acesso, recarregar } = useAuth()

  const [etapa, setEtapa] = useState<Etapa>('primeira')
  const [primeira, setPrimeira] = useState('')
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  /*
   * Já tem PIN e ninguém pediu redefinição: não há nada a fazer nesta tela. A
   * volta é para a primeira tela da conta: o painel para quem
   * administra e não bate, a tela de bater para o resto. A guarda desta rota
   * já esperou o acesso, então `telaInicial` não é nulo aqui.
   */
  if (pin.estado === 'ok' && pin.status.definido && !pin.status.precisa_redefinir) {
    return <Navigate to={telaInicial(acesso) ?? '/'} replace />
  }

  const ehRedefinicao = pin.estado === 'ok' && pin.status.definido

  function recomecar(mensagem: string | null) {
    setEtapa('primeira')
    setPrimeira('')
    setValor('')
    setErro(mensagem)
  }

  async function gravar(confirmado: string) {
    setSalvando(true)
    setErro(null)
    try {
      await definirPin(confirmado)
      // Relê o status: é o que faz a RotaProtegida parar de mandar para cá e
      // esta tela devolver a pessoa à primeira tela dela.
      await recarregar()
      setValor('')
    } catch (falha) {
      recomecar(falha instanceof Error ? falha.message : 'Não deu para salvar o PIN agora.')
    } finally {
      setSalvando(false)
    }
  }

  function aoMudar(novo: string) {
    if (salvando) return
    setErro(null)
    setValor(novo)

    if (novo.length < TAMANHO_PIN) return

    if (etapa === 'primeira') {
      setPrimeira(novo)
      setValor('')
      setEtapa('repetir')
      return
    }

    if (novo !== primeira) {
      recomecar('Os dois PINs não bateram. Comece de novo.')
      return
    }

    void gravar(novo)
  }

  return (
    <Moldura comSlogan={false}>
      <Painel>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-luz-soft text-luz">
          <KeyRound size={20} aria-hidden="true" />
        </div>

        <h1 className="text-center text-lg font-semibold text-plat">
          {etapa === 'primeira' ? (ehRedefinicao ? 'Crie um PIN novo' : 'Crie seu PIN') : 'Repita o PIN'}
        </h1>

        <p className="mt-1 text-center text-sm leading-relaxed text-mute">
          {etapa === 'repetir'
            ? 'Digite os mesmos 4 dígitos para confirmar.'
            : ehRedefinicao
              ? 'O administrador resetou seu PIN. Escolha 4 dígitos novos.'
              : 'Escolha 4 dígitos. Você vai usá-los a cada batida de ponto.'}
        </p>

        <div className="mt-7">
          <TecladoPin valor={valor} aoMudar={aoMudar} desabilitado={salvando} />
        </div>

        {salvando && (
          <p className="mt-5 text-center font-mono text-[0.68rem] uppercase tracking-[0.2em] text-faint">
            Salvando
          </p>
        )}

        {erro && !salvando && (
          <div className="mt-5">
            <Aviso tom="erro">{erro}</Aviso>
          </div>
        )}

        {etapa === 'repetir' && !salvando && (
          <div className="mt-5">
            <Botao tom="discreto" onClick={() => recomecar(null)}>
              Escolher outro PIN
            </Botao>
          </div>
        )}
      </Painel>

      <p className="mt-6 text-center text-xs leading-relaxed text-faint">
        O PIN fica guardado embaralhado no servidor — nem o administrador consegue lê-lo. Se você
        esquecer, ele reseta e você define um novo aqui.
      </p>
    </Moldura>
  )
}
