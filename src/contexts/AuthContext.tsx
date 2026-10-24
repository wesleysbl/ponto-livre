import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { lerStatusDoPin } from '../lib/pin'
import { lerMeuAcesso } from '../lib/administracao'
import { administracaoDoAcesso } from '../lib/acesso'
import { ContextoDeAutenticacao, type LeituraDoAcesso, type LeituraDoPin } from './autenticacao'

/*
 * O provedor do estado de acesso: quem está logado, se tem acesso ao ponto (se
 * bate, se administra, se é super admin, com que nome e cargo a tela o chama)
 * e em que pé está o PIN. As coisas moram juntas porque, juntas, respondem à
 * única pergunta que o roteador faz — "qual tela esta pessoa pode ver agora".
 *
 * UMA RESPOSTA PARA A CONTA INTEIRA. O nome, o cargo e o acesso vêm todos de
 * `ponto_meu_acesso()`, que os tira da ficha ligada à conta, das listas de
 * administração do ponto e do nome guardado no login (`app_metadata`). São
 * duas leituras da conta — o acesso e o PIN.
 *
 * Os tipos e o objeto de contexto ficam em `./autenticacao.ts`, e o hook de
 * leitura em `../hooks/useAuth.ts`: este arquivo exporta só o componente, que é
 * o que o Fast Refresh do Vite precisa para não remontar o app a cada
 * salvamento.
 */

async function buscarStatusDoPin(): Promise<LeituraDoPin> {
  try {
    return { estado: 'ok', status: await lerStatusDoPin() }
  } catch (erro) {
    console.error('Falha ao ler o status do PIN:', erro)
    return {
      estado: 'falhou',
      erro: erro instanceof Error ? erro.message : 'Não foi possível verificar seu PIN.',
    }
  }
}

/*
 * A leitura do ACESSO: entra, bate, administra, e o nome e o cargo.
 *
 * POR QUE ELA MORA AQUI, JUNTO DO PIN, E NÃO DENTRO DA GUARDA DE ROTA
 * As duas respondem, juntas, à única pergunta que o roteador faz: "qual tela
 * esta pessoa pode ver agora". Se o acesso fosse buscado dentro do
 * `<RotaProtegida>`, ele seria refeito a cada troca de tela protegida e — pior
 * — a guarda teria de renderizar ALGUMA COISA enquanto a resposta não chegasse.
 * Aqui ele chega junto com o PIN, e a guarda decide sem piscar.
 *
 * UMA PERGUNTA SÓ: `ponto_meu_acesso()` responde se a sessão entra no ponto
 * (ficha que libera OU administração), se bate ponto (ficha que libera OU
 * super admin), se administra, se é super admin, e o nome e o cargo. A
 * leitura da administração sai da mesma resposta, sem uma RPC à parte.
 *
 * FALHA FECHADA, como as irmãs: a exceção vira `falhou`, e `falhou` NÃO deixa
 * passar. Uma RPC que não respondeu não é uma permissão concedida.
 */
async function buscarAcesso(): Promise<LeituraDoAcesso> {
  try {
    return { estado: 'ok', acesso: await lerMeuAcesso() }
  } catch (erro) {
    console.error('Falha ao verificar o acesso ao ponto:', erro)
    return {
      estado: 'falhou',
      erro: 'Não foi possível verificar seu acesso ao ponto. Verifique a conexão.',
    }
  }
}

/*
 * PRAZO DAS LEITURAS DA CONTA.
 *
 * Rede CAÍDA o navegador reporta na hora: o fetch rejeita e as duas funções
 * acima devolvem `falhou`. Rede LENTA, não — 4G ruim no corredor deixa a
 * requisição pendurada sem erro nenhum, e como a RotaProtegida mostra a tela
 * de carregando enquanto a conta não chega, sem prazo o app giraria para
 * sempre e a pessoa não teria nem o botão de sair.
 *
 * 12 segundos: mais que o pior caso razoável de uma consulta que costuma levar
 * menos de 300 ms, e menos do que a paciência de quem está de pé querendo bater
 * o ponto. Estourado o prazo, o estado vira `falhou` e aparece a tela com
 * "Tentar de novo" e "Sair da conta" — falha fechada, com saída.
 */
const PRAZO_DA_LEITURA_MS = 12_000

function comPrazo<T>(tarefa: Promise<T>, aoEstourar: T): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<T>((resolver) => {
    relogio = setTimeout(() => resolver(aoEstourar), PRAZO_DA_LEITURA_MS)
  })
  return Promise.race([tarefa, limite]).finally(() => clearTimeout(relogio))
}

function traduzirErroDeLogin(mensagem: string): string {
  if (/invalid login credentials/i.test(mensagem)) return 'E-mail ou senha incorretos.'
  // Confirmar o e-mail é coisa do painel do Supabase (Authentication › Users),
  // de quem cuida da instalação — não do RH, que só administra o ponto no app.
  if (/email not confirmed/i.test(mensagem)) {
    return 'Este e-mail ainda não foi confirmado. Fale com quem cuida do ponto na sua empresa.'
  }
  if (/rate limit|too many/i.test(mensagem)) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
  if (/fetch|network/i.test(mensagem)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  return mensagem
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null)
  const [pin, setPin] = useState<LeituraDoPin>({ estado: 'carregando' })
  const [acesso, setAcesso] = useState<LeituraDoAcesso>({ estado: 'carregando' })
  // A administração sai da mesma resposta do acesso — sem uma segunda RPC.
  const administracao = useMemo(() => administracaoDoAcesso(acesso), [acesso])
  const [carregando, setCarregando] = useState(true)

  /*
   * Contador de geração. Uma resposta lenta de uma sessão antiga não pode
   * sobrescrever o estado de uma sessão nova (trocar de conta, sair e entrar).
   */
  const geracao = useRef(0)
  const usuarioAtual = useRef<User | null>(null)

  /*
   * As leituras são da SESSÃO (as duas RPCs respondem por quem chama), e não
   * de um id: nenhuma consulta daqui filtra pela conta, e por isso esta função
   * não recebe nenhuma.
   */
  const carregarDadosDaConta = useCallback(async () => {
    const minhaGeracao = ++geracao.current
    const [leituraPin, leituraAcesso] = await Promise.all([
      comPrazo<LeituraDoPin>(buscarStatusDoPin(), {
        estado: 'falhou',
        erro: 'O status do seu PIN demorou demais para responder. Verifique a conexão.',
      }),
      // Em paralelo: são duas consultas independentes, e encadeá-las dobraria
      // a espera de quem abre o app no corredor.
      comPrazo<LeituraDoAcesso>(buscarAcesso(), {
        estado: 'falhou',
        erro: 'A verificação do seu acesso ao ponto demorou demais. Verifique a conexão.',
      }),
    ])
    if (minhaGeracao !== geracao.current) return
    setPin(leituraPin)
    setAcesso(leituraAcesso)
  }, [])

  useEffect(() => {
    /*
     * O callback de onAuthStateChange NÃO pode ser async nem aguardar chamadas
     * do supabase: ele roda dentro do navigator lock do GoTrue, e um await aqui
     * trava qualquer chamada de auth seguinte (signInWithPassword, signOut).
     * O trabalho assíncrono sai por setTimeout(…, 0).
     */
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      const proximo = sessao?.user ?? null
      usuarioAtual.current = proximo
      setUsuario(proximo)

      if (!proximo) {
        geracao.current++
        setPin({ estado: 'carregando' })
        setAcesso({ estado: 'carregando' })
        setCarregando(false)
        return
      }

      setTimeout(async () => {
        await carregarDadosDaConta()
        setCarregando(false)
      }, 0)
    })

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        // Sem sessão o INITIAL_SESSION pode não disparar; encerramos a espera aqui.
        if (!session) setCarregando(false)
      })
      .catch((erro) => {
        console.error('Falha ao verificar a sessão:', erro)
        setCarregando(false)
      })

    return () => subscription.unsubscribe()
  }, [carregarDadosDaConta])

  const recarregar = useCallback(async () => {
    if (!usuarioAtual.current) return
    await carregarDadosDaConta()
  }, [carregarDadosDaConta])

  /*
   * O app instalado não remonta ao ser reaberto — o sistema apenas o traz de
   * volta. Sem isto, um reset de PIN feito pelo admin enquanto o app estava em
   * segundo plano só apareceria depois de fechar de vez. É esta releitura que
   * faz "a próxima entrada pede PIN novo" valer também para o PWA.
   */
  useEffect(() => {
    function aoVoltarParaFrente() {
      if (document.visibilityState === 'visible') void recarregar()
    }
    document.addEventListener('visibilitychange', aoVoltarParaFrente)
    return () => document.removeEventListener('visibilitychange', aoVoltarParaFrente)
  }, [recarregar])

  async function entrar(email: string, senha: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: senha,
    })
    return { erro: error ? traduzirErroDeLogin(error.message) : null }
  }

  async function sair() {
    geracao.current++
    usuarioAtual.current = null
    setPin({ estado: 'carregando' })
    setAcesso({ estado: 'carregando' })
    setUsuario(null)
    await supabase.auth.signOut()
  }

  return (
    <ContextoDeAutenticacao.Provider
      value={{ usuario, pin, acesso, administracao, carregando, entrar, sair, recarregar }}
    >
      {children}
    </ContextoDeAutenticacao.Provider>
  )
}
