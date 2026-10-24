/*
 * O service worker do app.
 *
 * POR QUE ELE EXISTE
 * O Chrome só oferece "instalar" para uma página que registra um service worker
 * com handler de fetch. Sem ele, o app abre no navegador mas nunca vira ícone na
 * tela de início — e o ponto é batido pelo ícone, no celular.
 *
 * O QUE ELE DELIBERADAMENTE **NÃO** FAZ
 * Nada de fila offline: se o celular estiver sem internet, a batida não
 * acontece e o app diz isso; não existe fila local fingindo que gravou. Por
 * isso:
 *   - toda requisição que não seja GET passa direto para a rede, sem cache;
 *   - toda requisição para outra origem (o Supabase, quando ele mora em
 *     outro endereço) passa direto para a rede, sem cache;
 *   - toda requisição para as rotas do Supabase NO MESMO endereço (ver
 *     ROTAS_DO_SUPABASE abaixo) também passa direto, sem cache;
 *   - só a casca do app (HTML e os assets com hash no nome, que incluem as
 *     fontes) é guardada.
 *
 * O cache serve para o app abrir rápido e não morrer numa oscilação de sinal ao
 * carregar o HTML. Ele nunca responde por dado de ninguém.
 *
 * ---------------------------------------------------------------------------
 * APP E API NO MESMO ENDEREÇO
 *
 * Quem serve o app e o Supabase atrás do mesmo domínio (um servidor web na
 * frente dos dois, que manda /auth/v1/, /rest/v1/, /storage/v1/ e
 * /functions/v1/ ao Supabase e o resto ao app) põe o Supabase na MESMA origem,
 * e o teste de origem deixa de bastar para ele nunca passar por aqui. O defeito
 * seria concreto: o atestado abre numa aba nova (`VisorDeAtestado`,
 * `target=_blank`) pela URL assinada `/storage/v1/object/sign/...`. Isso é uma
 * NAVEGAÇÃO para o mesmo endereço — e uma navegação que guardasse a resposta,
 * qualquer que fosse, como a casca "/" poria um PDF de atestado médico (dado de
 * saúde) no cache, servido como "o app" na próxima abertura sem sinal.
 *
 * Três travas, uma para cada parte do defeito:
 *   1. as quatro rotas do Supabase vão direto à rede, antes de qualquer outra
 *      regra (nem navegação, nem asset, nem fallback de casca);
 *   2. a casca só é substituída por uma resposta de navegação que deu certo
 *      (`ok`) E é HTML — um 404, um 500 do servidor ou um arquivo nunca viram
 *      app;
 *   3. cada versão do cache tem nome próprio (`VERSAO`), e a ativação apaga todo
 *      cache de outro nome, que pode estar guardando uma casca errada. Mudou a
 *      regra do que se guarda? Mude o número da versão.
 *
 * `src/service-worker.test.ts` executa ESTE arquivo (o texto dele, sem cópia)
 * com `caches` e `fetch` simulados e fixa as quatro rotas e as duas condições
 * da casca. Por isso as regras moram neste arquivo, e não num módulo à parte:
 * um service worker clássico não importa ES module em todo navegador, e uma
 * cópia da regra num arquivo do app seria testada no lugar da que roda.
 * ---------------------------------------------------------------------------
 */

const VERSAO = 'ponto-v1'

/*
 * A casca: a página, o manifesto (gerado no build a partir do nome configurado,
 * mas sempre neste caminho) e os ícones que ele e o `index.html` citam.
 */
const CASCA = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icone-192.png',
  '/icone-512.png',
  '/icone-maskable-512.png',
  '/apple-touch-icon.png',
]

/*
 * As rotas do Supabase quando ele mora no mesmo endereço do app: login, dados,
 * arquivos e funções. Com a barra no fim, para que só o prefixo de verdade
 * case (um `/rest/v10` ou `/storage/v1x` não é do Supabase); o caminho exato
 * sem a barra (`/rest/v1`) também é dele.
 */
const ROTAS_DO_SUPABASE = ['/auth/v1/', '/rest/v1/', '/storage/v1/', '/functions/v1/']

function eDoSupabase(caminho) {
  return ROTAS_DO_SUPABASE.some((rota) => caminho.startsWith(rota) || caminho === rota.slice(0, -1))
}

/*
 * Só vira casca o que é, de fato, a página do app: resposta que deu certo e
 * com tipo HTML. `ok` já recusa o redirecionamento opaco que uma navegação
 * recebe (status 0) e qualquer erro do servidor.
 */
function podeVirarCasca(resposta) {
  if (!resposta || !resposta.ok) return false
  const tipo = (resposta.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  return tipo === 'text/html'
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(VERSAO)
      .then((cache) => cache.addAll(CASCA))
      // Um asset que falhe no precache não pode impedir a instalação: o app
      // funciona pela rede de qualquer jeito.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  // Apaga todo cache que não seja o desta versão: um cache de versão anterior
  // pode estar guardando como casca uma resposta que não era o app.
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request

  // Escrita nunca passa por cache.
  if (requisicao.method !== 'GET') return

  const url = new URL(requisicao.url)

  // Qualquer coisa fora do nosso endereço (o Supabase em outro endereço): rede direta.
  if (url.origin !== self.location.origin) return

  // Login, dados, arquivos e funções do Supabase no mesmo endereço: rede
  // direta. Vem ANTES da navegação de propósito — abrir a URL assinada de um
  // atestado numa aba é navegação, e ela não pode virar casca.
  if (eDoSupabase(url.pathname)) return

  // Navegação: rede primeiro, para um deploy novo sempre ganhar do cache. O
  // cache só aparece quando a rede falha, e aí serve a última casca conhecida.
  if (requisicao.mode === 'navigate') {
    evento.respondWith(
      fetch(requisicao)
        .then((resposta) => {
          if (podeVirarCasca(resposta)) {
            const copia = resposta.clone()
            evento.waitUntil(caches.open(VERSAO).then((cache) => cache.put('/', copia)))
          }
          return resposta
        })
        .catch(() => caches.match('/').then((guardado) => guardado ?? Response.error())),
    )
    return
  }

  // Assets do build: o nome carrega hash do conteúdo, então cache primeiro é
  // seguro — um arquivo mudado vira um nome novo.
  if (url.pathname.startsWith('/assets/')) {
    evento.respondWith(
      caches.match(requisicao).then((guardado) => {
        if (guardado) return guardado
        return fetch(requisicao).then((resposta) => {
          if (resposta.ok) {
            const copia = resposta.clone()
            evento.waitUntil(caches.open(VERSAO).then((cache) => cache.put(requisicao, copia)))
          }
          return resposta
        })
      }),
    )
  }
})
