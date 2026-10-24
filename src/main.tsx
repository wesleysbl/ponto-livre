import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/*
 * A abertura do app.
 *
 * O `App` entra por import ESTÁTICO: o build sai num arquivo de JavaScript só,
 * baixado de uma vez, sem um segundo pedido à rede antes da primeira tela.
 *
 * SE O APP NÃO CARREGAR (rede que cai no meio do download, ou build feito sem
 * as variáveis do Supabase, que fazem `lib/supabase.ts` lançar no instante em
 * que é importado), este arquivo nem chega a rodar. O `#root` continua com o
 * aviso de emergência do `index.html`, que surge sozinho depois de 5 segundos
 * e diz o que fazer, em vez de uma tela preta. O motivo técnico fica no console
 * do navegador, com a mensagem do erro.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registrarServiceWorker()

/*
 * Registro do service worker.
 *
 * POR QUE SÓ EM PRODUÇÃO
 * O Chrome só oferece "instalar" para uma página que registra um service worker
 * com handler de fetch — sem isto o app abre no navegador, mas nunca vira ícone
 * na tela de início. Em desenvolvimento, porém, um SW guardando a casca briga
 * com o hot reload do Vite e faz o navegador servir código velho. `npm run
 * preview` roda o build de produção, então dá para conferir o "instalar" com o
 * SW ligado do mesmo jeito.
 *
 * A falha é silenciosa de propósito: sem service worker o app continua
 * funcionando inteiro pela rede — o que se perde é o convite para instalar,
 * não o ponto de ninguém.
 */
function registrarServiceWorker() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((erro) => {
        console.warn('Service worker não registrado:', erro)
      })
    })
  }
}
