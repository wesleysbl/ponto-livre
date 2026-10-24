/*
 * PONTO-CONTAS — A EDGE FUNCTION DE CONTAS DO PONTO.
 *
 * O super admin do ponto cria conta (já ligada à ficha, se quiser), troca
 * nome, troca e-mail e redefine senha pelo próprio app, sem abrir o painel do
 * Supabase. O caminho inteiro está em `atendimento.ts`; este arquivo só liga
 * o Deno ao atendimento:
 *
 *   • lê as variáveis do projeto, que o Supabase põe em toda Edge Function: o
 *     endereço e as chaves, as novas ou, sem elas, as legadas (a regra está
 *     em `chaves.ts`);
 *   • abre os DOIS clientes — o da sessão do chamador e o da chave de
 *     serviço (ver o cabeçalho de `portas.ts`);
 *   • devolve JSON com CORS.
 *
 * É O ÚNICO ARQUIVO DA FUNÇÃO QUE FALA COM O DENO E COM A REDE. Os outros
 * quatro são importados pelo Vitest e pelo `tsc` do app, e
 * `src/ponto-contas.test.ts` falha se algum deles passar a usar `Deno` ou
 * import de rede.
 *
 * DEPLOY: `npx supabase functions deploy ponto-contas`, com o projeto ligado
 * (`npx supabase link`). Vão os cinco arquivos desta pasta, e o
 * `verify_jwt = true` vem de `supabase/config.toml`. Depois do deploy, sem
 * sessão a função responde 401 e, para quem não é super admin, 403. A
 * migration da estrutura tem de estar aplicada antes: sem a trilha de contas,
 * a função recusa tudo com 503 (é o desenho), e a tela não teria o que fazer.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { CABECALHOS_CORS, atender, respostaDoCorpoGrande, type RespostaHttp } from './atendimento.ts'
import { resolverChaves } from './chaves.ts'
import { criarPortas, type ClienteDoSupabase } from './portas.ts'
import { corpoDeclaradoGrandeDemais, semSenha } from './regras.ts'

/** Servidor: sem sessão guardada, sem renovação. Cada pedido traz o próprio token. */
const SEM_SESSAO_GUARDADA = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

function responder(resposta: RespostaHttp): Response {
  const cabecalhos = { ...CABECALHOS_CORS, 'Content-Type': 'application/json; charset=utf-8' }
  return new Response(resposta.corpo === null ? null : JSON.stringify(resposta.corpo), {
    status: resposta.status,
    headers: cabecalhos,
  })
}

Deno.serve(async (req: Request) => {
  const chaves = resolverChaves((nome) => Deno.env.get(nome))

  if (!chaves.ok) {
    // O preflight do navegador não usa chave: responde como `atender`
    // responderia, e o POST que vem depois recebe a frase abaixo.
    if (req.method === 'OPTIONS') return responder({ status: 204, corpo: null })
    // Falha fechada: sem o endereço e as duas chaves, não há como conferir
    // quem chama. O log diz o estado de cada variável, e nunca o valor.
    console.error(JSON.stringify({ evento: 'configuracao_incompleta', ...chaves.diagnostico }))
    return responder({
      status: 500,
      corpo: {
        ok: false,
        codigo: 'configuracao_incompleta',
        mensagem: 'A função de contas está sem as variáveis do projeto. Nada foi alterado; avise quem fez o deploy.',
      },
    })
  }

  // O teto do corpo ANTES de ler: pelo `Content-Length`, sem pôr o corpo na
  // memória. `atender` confere de novo o que chegou, para o pedido sem o
  // cabeçalho.
  if (req.method === 'POST' && corpoDeclaradoGrandeDemais(req.headers.get('Content-Length'))) {
    return responder(respostaDoCorpoGrande())
  }

  let corpo = ''
  try {
    corpo = req.method === 'POST' ? await req.text() : ''
  } catch {
    corpo = ''
  }

  const resposta = await atender(
    { metodo: req.method, autorizacao: req.headers.get('Authorization'), corpo },
    (token) => {
      // O cliente da SESSÃO leva o token do chamador em toda chamada: o
      // PostgREST roda como ele, e a RLS vale como na tela do app.
      const sessao = createClient(chaves.url, chaves.chavePublica, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: SEM_SESSAO_GUARDADA,
      })
      // O cliente de SERVIÇO não leva token de ninguém.
      const servico = createClient(chaves.url, chaves.chaveDeServico, { auth: SEM_SESSAO_GUARDADA })
      return criarPortas(
        // O cliente de verdade tem tudo o que `ClienteDoSupabase` descreve (ver portas.ts).
        { sessao: sessao as unknown as ClienteDoSupabase, servico: servico as unknown as ClienteDoSupabase },
        token,
        (evento, dados) => console.error(JSON.stringify({ evento, ...semSenha(dados) })),
      )
    },
  )

  return responder(resposta)
})
