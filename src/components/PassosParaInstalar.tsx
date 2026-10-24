/*
 * O passo a passo de instalar o app, por aparelho: o que aparece no convite da
 * tela de entrar, só para o aparelho que está na mão.
 *
 * Mora sozinho para a próxima mudança de menu do Safari ou do Chrome ser
 * corrigida num lugar só, mesmo que o passo a passo passe a aparecer em outra
 * tela.
 *
 * Os nomes dos menus são os que o celular mostra em português, em negrito, para
 * a pessoa reconhecer o botão na tela.
 */

function Menu({ children }: { children: string }) {
  return <strong className="font-semibold text-plat">{children}</strong>
}

export function PassosParaInstalar({ aparelho }: { aparelho: 'ios' | 'android' }) {
  return (
    <p className="text-sm leading-relaxed text-plat-dim">
      {aparelho === 'ios' ? (
        <>
          Abra no <Menu>Safari</Menu>, toque em <Menu>Compartilhar</Menu> e depois em{' '}
          <Menu>Adicionar à Tela de Início</Menu>.
        </>
      ) : (
        <>
          Abra no <Menu>Chrome</Menu>, toque no <Menu>menu ⋮</Menu> e depois em{' '}
          <Menu>Instalar app</Menu> (ou <Menu>Adicionar à tela inicial</Menu>).
        </>
      )}
    </p>
  )
}
