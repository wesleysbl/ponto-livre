import { marcaDoApp } from '../lib/marca-do-app'

/*
 * A MARCA NA TELA: o ícone e o nome configurado do app.
 *
 * O nome e o slogan vêm do build (VITE_NOME_DO_APP e VITE_SLOGAN_DO_APP, ver
 * `lib/marca.ts`). O ícone é um desenho neutro, o mesmo de `public/favicon.svg`
 * e dos PNGs do app instalado: um cronômetro com um "check", o ponto batido.
 * Traço na cor do texto (`currentColor`), para quem usa escolher o tom pela
 * classe — nas telas, o verde de destaque (`text-luz`).
 */

/**
 * O desenho do ícone. O quadro (`viewBox`) é o do desenho, sem a folga dos
 * PNGs: aqui o tamanho é decidido pela classe de quem usa.
 */
export function IconeDoPonto({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      viewBox="32 28 448 448"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="256" cy="284" r="168" strokeWidth="44" />
      <path d="M256 102V56M220 52h72" strokeWidth="44" />
      <path d="M180 290l56 56 100-114" strokeWidth="50" />
    </svg>
  )
}

/** A assinatura das telas de acesso: ícone, nome e, quando configurado, o slogan. */
export function Marca({ comSlogan = true }: { comSlogan?: boolean }) {
  const { nome, slogan } = marcaDoApp()
  return (
    <div className="flex flex-col items-center gap-3">
      <IconeDoPonto className="h-9 w-9 text-luz" />
      <div className="text-center">
        <p className="font-display text-2xl font-semibold tracking-tight break-words text-plat">{nome}</p>
        {comSlogan && slogan !== '' && (
          <p className="mt-1 font-mono text-[0.64rem] uppercase tracking-[0.22em] text-mute">{slogan}</p>
        )}
      </div>
    </div>
  )
}

/**
 * O nome no topo das telas internas, ao lado do botão de voltar ou de sair.
 * `min-w-0` e `truncate`: um nome longo encolhe com reticências, em vez de
 * empurrar o botão para fora da tela de 320 px.
 */
export function MarcaDoTopo() {
  const { nome } = marcaDoApp()
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <IconeDoPonto className="h-5 w-5 shrink-0 text-luz" />
      <span className="truncate font-display text-sm font-semibold tracking-tight text-plat">{nome}</span>
    </div>
  )
}
