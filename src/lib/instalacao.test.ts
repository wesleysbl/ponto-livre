import { describe, expect, it } from 'vitest'
import {
  CHAVE_DO_ADIAMENTO,
  DIAS_SEM_CONVITE,
  deveMostrarConvite,
  estaInstalado,
  gravarAdiamento,
  identificarAparelho,
  lerAdiamento,
  lerAmbienteDoNavegador,
} from './instalacao'

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1',
  // O iPad em modo "site de computador": diz que é Mac.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
}

const DIA = 24 * 60 * 60 * 1000
const AGORA = Date.UTC(2026, 9, 20, 15, 0)

describe('identificarAparelho', () => {
  it('iPhone, no Safari ou no Chrome, é iOS', () => {
    expect(identificarAparelho(UA.iphone)).toBe('ios')
    expect(identificarAparelho(UA.iphoneChrome)).toBe('ios')
  })

  it('o iPad que se apresenta como Mac é iOS pela tela de toque; o Mac de verdade não', () => {
    expect(identificarAparelho(UA.ipad, 5)).toBe('ios')
    expect(identificarAparelho(UA.ipad, 0)).toBe('outro')
  })

  it('Android é Android; o computador é outro', () => {
    expect(identificarAparelho(UA.android, 5)).toBe('android')
    expect(identificarAparelho(UA.windows)).toBe('outro')
    expect(identificarAparelho('')).toBe('outro')
  })
})

describe('estaInstalado', () => {
  it('basta o display-mode standalone (Android) ou o navigator.standalone (iPhone)', () => {
    expect(estaInstalado({ modoStandalone: true })).toBe(true)
    expect(estaInstalado({ modoStandalone: false, navigatorStandalone: true })).toBe(true)
  })

  it('no navegador comum, não está instalado', () => {
    expect(estaInstalado({ modoStandalone: false })).toBe(false)
    expect(estaInstalado({ modoStandalone: false, navigatorStandalone: false })).toBe(false)
  })
})

describe('deveMostrarConvite', () => {
  const base = { instalado: false, aparelho: 'ios' as const, adiadoEm: null, agora: AGORA }

  it('celular, no navegador, sem "Agora não": mostra', () => {
    expect(deveMostrarConvite(base)).toBe(true)
    expect(deveMostrarConvite({ ...base, aparelho: 'android' })).toBe(true)
  })

  it('instalado: nunca mostra', () => {
    expect(deveMostrarConvite({ ...base, instalado: true })).toBe(false)
  })

  it('no computador: não mostra', () => {
    expect(deveMostrarConvite({ ...base, aparelho: 'outro' })).toBe(false)
  })

  it('"Agora não" esconde por 7 dias, e no sétimo dia o convite volta', () => {
    expect(DIAS_SEM_CONVITE).toBe(7)
    expect(deveMostrarConvite({ ...base, adiadoEm: AGORA })).toBe(false)
    expect(deveMostrarConvite({ ...base, adiadoEm: AGORA - 7 * DIA + 1 })).toBe(false)
    expect(deveMostrarConvite({ ...base, adiadoEm: AGORA - 7 * DIA })).toBe(true)
    expect(deveMostrarConvite({ ...base, adiadoEm: AGORA - 30 * DIA })).toBe(true)
  })

  it('adiamento no futuro (relógio errado) é ignorado, para não esconder o convite para sempre', () => {
    expect(deveMostrarConvite({ ...base, adiadoEm: AGORA + 400 * DIA })).toBe(true)
  })
})

describe('o "Agora não" guardado no aparelho', () => {
  function memoria() {
    const dados = new Map<string, string>()
    return {
      dados,
      getItem: (chave: string) => dados.get(chave) ?? null,
      setItem: (chave: string, valor: string) => void dados.set(chave, valor),
    }
  }

  it('grava e lê o instante', () => {
    const armazenamento = memoria()
    expect(gravarAdiamento(armazenamento, AGORA)).toBe(true)
    expect(armazenamento.dados.get(CHAVE_DO_ADIAMENTO)).toBe(String(AGORA))
    expect(lerAdiamento(armazenamento)).toBe(AGORA)
  })

  it('sem nada guardado, ou com lixo, conta como nunca adiado', () => {
    const armazenamento = memoria()
    expect(lerAdiamento(armazenamento)).toBeNull()
    armazenamento.dados.set(CHAVE_DO_ADIAMENTO, 'ontem')
    expect(lerAdiamento(armazenamento)).toBeNull()
    armazenamento.dados.set(CHAVE_DO_ADIAMENTO, '  ')
    expect(lerAdiamento(armazenamento)).toBeNull()
    expect(lerAdiamento(null)).toBeNull()
  })

  it('armazenamento que lança (Safari com dados bloqueados) não quebra nada', () => {
    const bloqueado = {
      getItem: () => {
        throw new DOMException('bloqueado', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('cheio', 'QuotaExceededError')
      },
    }
    expect(lerAdiamento(bloqueado)).toBeNull()
    expect(gravarAdiamento(bloqueado, AGORA)).toBe(false)
    expect(gravarAdiamento(null, AGORA)).toBe(false)
  })
})

describe('lerAmbienteDoNavegador', () => {
  it('fora do navegador (Node), o convite não aparece', () => {
    const ambiente = lerAmbienteDoNavegador()
    expect(ambiente.aparelho).toBe('outro')
    expect(deveMostrarConvite(ambiente)).toBe(false)
  })
})
