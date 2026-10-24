import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { RotaProtegida } from './components/RotaProtegida'
import { Entrar } from './pages/Entrar'
import { SemAcesso } from './pages/SemAcesso'
import { DefinirPin } from './pages/DefinirPin'
import { Bater } from './pages/Bater'
import { Espelho } from './pages/Espelho'
import { Painel } from './pages/Painel'
import { PainelDaPessoa } from './pages/PainelDaPessoa'
import { Administracao } from './pages/Administracao'
import { Folha } from './pages/Folha'

/*
 * Nove rotas, e a ordem entre elas é a própria regra de acesso:
 *
 *   /entrar         sessão      — quem não está logado só chega aqui
 *   /sem-acesso     acesso      — logado, sem ficha que libere e sem administrar
 *   /definir-pin    PIN         — com acesso, mas sem PIN (ou com reset do admin)
 *   /               bater ponto — o resto; para quem só administra, o
 *                                 caminho do painel no lugar do botão
 *   /espelho        o próprio mês, atrás da mesma guarda da raiz
 *   /painel         o mês de todo mundo, só para quem administra — e a
 *                   primeira tela, depois do login, de quem administra e não bate
 *   /painel/:id     o dia a dia de uma pessoa, com correção e inserção
 *   /administracao  a configuração do ponto, só para quem administra
 *   /folha/:id      a folha mensal para imprimir e assinar
 *
 * O AuthProvider fica FORA do BrowserRouter: o estado de acesso não depende da
 * rota, e assim ele não é remontado numa troca de tela.
 *
 * O ACESSO É O DO PONTO: a guarda decide a rota só pela resposta de
 * `ponto_meu_acesso()` — ficha que libera OU administração para entrar; ficha
 * OU super admin para bater — e pelo estado do PIN. Ver `lib/acesso.ts`.
 *
 * ROTA NOVA AQUI PRECISA ENTRAR NA HOSPEDAGEM: `public/_redirects`,
 * `vercel.json` e `exemplos/servidor/Caddyfile` voltam ao app só nas rotas
 * desta lista (`src/hospedagem.test.ts` confere). Sem isso, a rota nova abre
 * pelo app, mas um F5 nela dá 404.
 */
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/sem-acesso" element={<SemAcesso />} />

          <Route
            path="/definir-pin"
            element={
              // `exigePin={false}`: é esta tela que cria o PIN — exigi-lo aqui
              // seria um laço de redirecionamento com ela mesma.
              <RotaProtegida exigePin={false}>
                <DefinirPin />
              </RotaProtegida>
            }
          />

          <Route
            path="/"
            element={
              <RotaProtegida>
                <Bater />
              </RotaProtegida>
            }
          />

          <Route
            path="/espelho"
            element={
              /*
               * Mesma guarda da raiz, PIN incluído. Conferir o próprio mês não
               * exige digitar PIN, mas quem está com redefinição pendente é
               * levado a criá-lo antes — a alternativa seria uma porta lateral
               * que ignora o único bloqueio que o admin tem sobre a conta.
               */
              <RotaProtegida>
                <Espelho />
              </RotaProtegida>
            }
          />

          {/*
            O painel do admin. `exigeAdmin` devolve quem não administra o ponto
            para a tela de bater — a dele —, e não para /sem-acesso, que diria
            que o acesso dele ao ponto não está liberado, e seria mentira: ele
            bate ponto normalmente.

            A pergunta que `exigeAdmin` faz é a mesma do banco
            (`ponto_pode_administrar()`): uma regra diferente na tela deixaria
            entrar quem o banco recusa, ou barraria quem ele aceita.

            Vale repetir o que a guarda NÃO é: segurança. Quem recusa a
            consulta, a correção e a inserção é a RLS, a cada chamada. Forçar a
            URL abre uma tela que não traz linha nenhuma.
          */}
          <Route
            path="/painel"
            element={
              <RotaProtegida exigeAdmin>
                <Painel />
              </RotaProtegida>
            }
          />

          <Route
            path="/painel/:usuarioId"
            element={
              <RotaProtegida exigeAdmin>
                <PainelDaPessoa />
              </RotaProtegida>
            }
          />

          {/*
            A área de administração: local de trabalho, dados da empresa e
            regras de jornada. Mesma guarda do painel — e, como lá,
            quem recusa cada gravação é a RLS, não esta linha.
          */}
          <Route
            path="/administracao"
            element={
              <RotaProtegida exigeAdmin>
                <Administracao />
              </RotaProtegida>
            }
          />

          {/*
            A folha de ponto de uma pessoa, para imprimir e assinar. Mesma
            guarda do painel: hoje quem emite a folha é sempre o administrador,
            e ela lê as batidas de OUTRA pessoa — o que a RLS só devolve para
            quem está em `ponto_admins`. O mês vem em `?mes=AAAA-MM`, e
            `?imprimir=1` faz a tela abrir a caixa de impressão sozinha assim
            que os dados chegam: é assim que o botão da área de administração e
            o da tela da pessoa "abrem a caixa de impressão do navegador".
          */}
          <Route
            path="/folha/:usuarioId"
            element={
              <RotaProtegida exigeAdmin>
                <Folha />
              </RotaProtegida>
            }
          />

          {/* Rota desconhecida cai na raiz, e de lá a guarda decide. Vale para
              o atalho da tela de início, que às vezes reabre numa URL que o app
              não tem mais. (Fora das rotas acima, a hospedagem responde 404
              antes de o app abrir: isto vale para o que chega ao app.) */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
