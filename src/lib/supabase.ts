import { createClient } from '@supabase/supabase-js'

/*
 * O cliente do Supabase do ponto: o login (Supabase Auth), as tabelas e funções
 * do ponto (prefixo `ponto_`), o storage das selfies e atestados e a função de
 * contas.
 *
 * As duas variáveis vêm do build (ver `.env.example`). A chave é a PUBLICÁVEL
 * (a publishable, que começa com `sb_publishable_…`; em projeto antigo, a
 * `anon`, que faz o mesmo papel): ela vai para o navegador de todo mundo, e
 * quem protege os dados é a RLS do banco, não o segredo dela.
 *
 * Sem as duas, o app não tem com quem falar: o módulo lança no instante em que
 * é importado, e a tela fica no aviso de emergência do `index.html`.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string
const chavePublicavel = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!url || !chavePublicavel) {
  throw new Error(
    'Faltam VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY. Copie o .env.example para .env e preencha.',
  )
}

export const supabase = createClient(url, chavePublicavel, {
  auth: {
    // A sessão fica no localStorage do aparelho: o funcionário faz login uma
    // vez e o app segue logado entre aberturas. O PIN é que é pedido a cada
    // batida.
    persistSession: true,
    storage: localStorage,
    autoRefreshToken: true,
    // A sessão só nasce do "Entrar" com e-mail e senha. Ligado, o cliente
    // aceitaria uma sessão vinda no endereço (`#access_token=...`, como nos
    // links de recuperação e de convite do Supabase), e um link preparado por
    // outra pessoa abriria o app logado na conta DELA no aparelho de quem
    // clicou, sem a pessoa perceber de quem é a conta. Nenhuma tela do app usa
    // link de e-mail: as contas e as senhas nascem pela função de contas.
    detectSessionInUrl: false,
  },
})
