import { useState } from 'react'
import { Smartphone } from 'lucide-react'
import { Botao } from './ui'
import { marcaDoApp } from '../lib/marca-do-app'
import { PassosParaInstalar } from './PassosParaInstalar'
import {
  armazenamentoDoAparelho,
  deveMostrarConvite,
  gravarAdiamento,
  lerAmbienteDoNavegador,
  type AmbienteDeInstalacao,
} from '../lib/instalacao'

/*
 * O CONVITE PARA INSTALAR.
 *
 * Aparece só no celular e só quando o app NÃO está aberto pelo ícone — quem
 * decide é `deveMostrarConvite`, em `lib/instalacao.ts`. "Agora não" esconde
 * por 7 dias neste aparelho.
 *
 * ONDE ELE MORA: NO TOPO DA TELA DE ENTRAR
 * - Todo mundo passa por ela no primeiro acesso, que é quando faz sentido
 *   instalar.
 * - No iPhone, o app da tela de início NÃO aproveita o login feito no Safari
 *   (cada um tem o seu armazenamento). Quem entra primeiro e instala depois
 *   precisa entrar duas vezes. O convite tem de vir ANTES do login, e é o que
 *   esta posição garante.
 * - É o lugar menos invasivo: não empurra o botão de bater, nem o painel do
 *   RH, nem muda moldura de tela nenhuma — só acrescenta um bloco acima do
 *   cartão de entrar, que some de vez depois de instalado.
 *
 * `ambiente` existe para o teste de tela (em Node não há navegador para ler);
 * no app ele fica de fora e o componente lê o navegador uma vez, ao montar.
 */
export function ConviteParaInstalar({ ambiente }: { ambiente?: AmbienteDeInstalacao }) {
  const [lido] = useState(() => ambiente ?? lerAmbienteDoNavegador())
  const [visivel, setVisivel] = useState(() => deveMostrarConvite(lido))

  if (!visivel || lido.aparelho === 'outro') return null

  function agoraNao() {
    // Se o aparelho não deixar guardar, o convite some do mesmo jeito — só
    // volta na próxima abertura, em vez de daqui a 7 dias.
    gravarAdiamento(armazenamentoDoAparelho(), Date.now())
    setVisivel(false)
  }

  return (
    <section
      aria-labelledby="convite-instalar-titulo"
      className="mb-4 rounded-2xl border border-luz/35 bg-ink-1 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-luz-soft text-luz">
          <Smartphone size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 id="convite-instalar-titulo" className="text-sm font-semibold text-plat">
            Instale o app {marcaDoApp().nome} no celular
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-mute">
            Ele vira um ícone na tela de início e abre direto no ponto.
          </p>
          <div className="mt-2">
            <PassosParaInstalar aparelho={lido.aparelho} />
          </div>
          {lido.aparelho === 'ios' && (
            <p className="mt-2 text-sm leading-relaxed text-mute">
              Instale antes de entrar: no iPhone, o ícone pede o login de novo.
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-plat-dim">
            Na primeira batida o celular vai pedir câmera e localização: toque em{' '}
            <strong className="font-semibold text-plat">Permitir</strong> nas duas.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Botao tom="discreto" type="button" onClick={agoraNao}>
          Agora não
        </Botao>
      </div>
    </section>
  )
}
