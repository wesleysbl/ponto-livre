/*
 * AS REGRAS DA ÁREA DE ADMINISTRAÇÃO, EM FUNÇÕES PURAS.
 *
 * O QUE MORA AQUI: os tipos da configuração, as faixas aceitas e a leitura dos
 * campos de formulário — texto digitado por gente vira número conferido, ou
 * vira uma lista de frases explicando o que está errado.
 *
 * O QUE NÃO MORA AQUI: nenhuma chamada ao Supabase, nenhum React, nenhum
 * relógio. É a mesma razão de `horas.ts` e `periodo.ts` serem módulos: sem
 * isso, a validação da coordenada do local viveria dentro de um componente e
 * só poderia ser testada montando a tela.
 *
 * ⚠ ESTA VALIDAÇÃO NÃO É A PROTEÇÃO. QUEM RECUSA É O POSTGRES.
 * Cada faixa abaixo espelha uma restrição `CHECK` das tabelas
 * `ponto_configuracao` e `ponto_local` (em `supabase/migrations/`).
 * Elas existem para a tela dizer o que está errado ANTES da viagem — e não
 * para decidir nada. Alguém que chame o PostgREST direto continua esbarrando
 * nos mesmos números, no banco.
 *
 * E ESPELHAR SIGNIFICA ESPELHAR: nenhuma faixa daqui é mais apertada que a do
 * banco. Uma tela mais rígida que o banco recusaria valor legítimo dizendo "o
 * banco não aceita", que é uma mentira difícil de descobrir — o operador
 * acredita e desiste, sem nunca ver o erro real.
 */

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

/** O cabeçalho que a folha imprime. Tudo anulável: ver a migration. */
export interface DadosDaEmpresa {
  razaoSocial: string | null
  nomeFantasia: string | null
  /** Só os 14 dígitos, sem máscara — é assim que o banco guarda. */
  cnpj: string | null
  endereco: string | null
  cidade: string | null
  uf: string | null
}

/**
 * As regras de jornada, gravadas pela área de administração.
 *
 * SÓ A JANELA MUDA O QUE ACONTECE: o banco a lê a cada batida. A carga diária e
 * a tolerância ficam guardadas e aparecem na administração, mas nenhuma conta
 * do app as usa — não há saldo, atraso nem hora extra calculados.
 */
export interface RegrasDeJornada {
  cargaDiariaMinutos: number
  toleranciaMinutos: number
  /** Janela em que a segunda batida da mesma pessoa é recusada. */
  janelaDuplicidadeSegundos: number
}

export interface ConfiguracaoDoPonto extends DadosDaEmpresa, RegrasDeJornada {
  /** ISO 8601 da última gravação. É o que a tela mostra quando duas abas brigam. */
  atualizadoEm: string | null
}

/** O local ativo do ponto — o local de trabalho. */
export interface DadosDoLocal {
  nome: string
  latitude: number
  longitude: number
  raioMetros: number
}

export interface LocalDoPonto extends DadosDoLocal {
  id: string
  /**
   * Quando a coordenada ou o raio foram gravados pela última vez, e
   * por quem (`auth.uid()` da sessão, carimbado pelo gatilho
   * `ponto_local_carimbar_medicao`). `medidoEm` nulo = nunca medido;
   * `medidoPor` nulo com `medidoEm` preenchido = gravado sem sessão (migration).
   */
  medidoEm: string | null
  medidoPor: string | null
}

/**
 * Resultado de uma leitura de formulário: ou o valor pronto, ou as frases que
 * a tela mostra. Sem exceção — quem chama está dentro de um `onSubmit`, e uma
 * exceção ali vira tela branca.
 */
export type Leitura<T> = { ok: true; valor: T } | { ok: false; erros: string[] }

/* ------------------------------------------------------------------ */
/* As faixas — espelho dos CHECK do banco                              */
/* ------------------------------------------------------------------ */

/**
 * `raioMetros` não tem teto AQUI porque não tem teto NO BANCO: o CHECK pede
 * só `raio_metros > 0`. Um raio de 50 km é absurdo e passa nos dois lugares —
 * e é assim que fica, porque inventar um teto só na tela faria a tela recusar
 * o que o banco aceita e explicar isso errado.
 */
export const FAIXAS = {
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 },
  raioMetros: { min: 1, max: null as number | null },
  cargaDiariaMinutos: { min: 60, max: 720 },
  toleranciaMinutos: { min: 0, max: 60 },
  janelaDuplicidadeSegundos: { min: 10, max: 900 },
} as const

/* ------------------------------------------------------------------ */
/* Leitura de texto digitado                                           */
/* ------------------------------------------------------------------ */

/**
 * Texto de campo numérico -> número.
 *
 * ACEITA VÍRGULA. Um teclado de celular em português oferece vírgula, e o
 * `parseFloat` de `-23,5614` devolve `-23` sem erro nenhum: a coordenada
 * ficaria 62 km fora do lugar e nada na tela apontaria isso. Trocar a vírgula
 * por ponto antes de converter é uma linha que evita um defeito silencioso.
 *
 * RECUSA TEXTO SOBRANDO. `Number('-23,56 graus')` é `NaN`, mas
 * `parseFloat('-23.56graus')` é `-23.56` — por isso a conversão é feita com
 * `Number`, que exige que o texto INTEIRO seja o número.
 */
export function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.')
  if (limpo === '') return null
  const valor = Number(limpo)
  return Number.isFinite(valor) ? valor : null
}

/** Como `lerNumero`, mas recusa o que não for inteiro. */
export function lerInteiro(texto: string): number | null {
  const valor = lerNumero(texto)
  if (valor === null || !Number.isInteger(valor)) return null
  return valor
}

/**
 * `"08:00"` -> 480 minutos. Também aceita `"8:00"` e `"8"` (horas cheias).
 *
 * POR QUE A CARGA DIÁRIA É DIGITADA EM HORA E NÃO EM MINUTO: ninguém pensa a
 * própria jornada em "quatrocentos e oitenta". Pedir minutos convida
 * exatamente o engano que o CHECK do banco recusa — alguém digita `8` querendo
 * dizer oito horas e configura oito minutos de jornada.
 */
export function lerDuracao(texto: string): number | null {
  const limpo = texto.trim()
  if (limpo === '') return null

  const partes = limpo.split(':')
  if (partes.length > 2) return null

  const horas = lerInteiro(partes[0])
  if (horas === null || horas < 0) return null
  if (partes.length === 1) return horas * 60

  // `"8:5"` é ambíguo (cinco minutos ou cinquenta?). Exigir dois dígitos tira a
  // ambiguidade em vez de escolher uma das leituras no escuro.
  if (!/^\d{2}$/.test(partes[1].trim())) return null
  const minutos = lerInteiro(partes[1])
  if (minutos === null || minutos > 59) return null

  return horas * 60 + minutos
}

/** 480 -> `"08:00"`. O contrário de `lerDuracao`, para preencher o campo. */
export function escreverDuracao(minutos: number): string {
  const total = Math.max(0, Math.round(minutos))
  const horas = Math.floor(total / 60)
  const resto = total % 60
  return `${String(horas).padStart(2, '0')}:${String(resto).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* CNPJ                                                                */
/* ------------------------------------------------------------------ */

/** Tira ponto, barra, traço e espaço. Letra NÃO sai — ver `cnpjEhValido`. */
export function somenteDigitosDeCnpj(texto: string): string {
  return texto.replace(/[./\s-]/g, '')
}

/**
 * Confere os dois dígitos verificadores (módulo 11).
 *
 * O BANCO SÓ EXIGE 14 DÍGITOS, E ESTA CONFERÊNCIA É MAIS ESTRITA QUE ELE —
 * a única exceção à regra do cabeçalho, e ela é deliberada. Um CNPJ com
 * dígito errado não é "um valor que o banco recusaria": é um documento errado
 * num papel que alguém vai assinar. A mensagem da tela diz isso com essas
 * palavras, sem afirmar que o banco recusou.
 *
 * `11111111111111` e os outros treze repetidos passam na conta do módulo 11 e
 * são recusados à parte — é a armadilha clássica deste algoritmo.
 */
export function cnpjEhValido(digitos: string): boolean {
  if (!/^\d{14}$/.test(digitos)) return false
  if (/^(\d)\1{13}$/.test(digitos)) return false

  const numeros = digitos.split('').map(Number)

  const conferir = (ate: number): number => {
    // Pesos 2..9 girando da direita para a esquerda, como manda a Receita.
    let soma = 0
    let peso = 2
    for (let i = ate - 1; i >= 0; i--) {
      soma += numeros[i] * peso
      peso = peso === 9 ? 2 : peso + 1
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  return conferir(12) === numeros[12] && conferir(13) === numeros[13]
}

/** `"12345678000199"` -> `"12.345.678/0001-99"`. Devolve o que veio se não der. */
export function formatarCnpj(digitos: string | null): string {
  if (!digitos || !/^\d{14}$/.test(digitos)) return digitos ?? ''
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`
}

/* ------------------------------------------------------------------ */
/* Validação dos formulários                                           */
/* ------------------------------------------------------------------ */

/** O que o formulário do local entrega: quatro campos de texto. */
export interface RascunhoDoLocal {
  nome: string
  latitude: string
  longitude: string
  raioMetros: string
}

/**
 * Lê o formulário do local.
 *
 * AS TRÊS RECUSAS DE COORDENADA SÃO AS DO BANCO, palavra por palavra em
 * significado: latitude fora de -90..90, longitude fora de -180..180, raio zero
 * ou negativo. O porquê: um local no lugar errado marca todo mundo como fora
 * — a batida de quem está no prédio nasceria `no_local = false` e ninguém
 * desconfiaria da coordenada.
 *
 * Devolve TODAS as frases de uma vez, e não a primeira: quem digitou latitude e
 * longitude trocadas erra os dois campos, e corrigir um de cada vez, com uma
 * viagem ao servidor no meio, é o tipo de formulário que faz a pessoa desistir.
 */
export function validarLocal(rascunho: RascunhoDoLocal): Leitura<DadosDoLocal> {
  const erros: string[] = []

  const nome = rascunho.nome.trim()
  if (nome === '') {
    erros.push('O local precisa de um nome — é ele que o funcionário lê no comprovante.')
  }

  const latitude = lerNumero(rascunho.latitude)
  if (latitude === null) {
    erros.push('Latitude: digite um número em graus decimais, como -12,345678.')
  } else if (latitude < FAIXAS.latitude.min || latitude > FAIXAS.latitude.max) {
    erros.push(
      `Latitude precisa estar entre ${FAIXAS.latitude.min} e ${FAIXAS.latitude.max}. O banco recusa fora disso.`,
    )
  }

  const longitude = lerNumero(rascunho.longitude)
  if (longitude === null) {
    erros.push('Longitude: digite um número em graus decimais, como -45,678901.')
  } else if (longitude < FAIXAS.longitude.min || longitude > FAIXAS.longitude.max) {
    erros.push(
      `Longitude precisa estar entre ${FAIXAS.longitude.min} e ${FAIXAS.longitude.max}. O banco recusa fora disso.`,
    )
  }

  const raioMetros = lerInteiro(rascunho.raioMetros)
  if (raioMetros === null) {
    erros.push('Raio: digite um número inteiro de metros, como 150.')
  } else if (raioMetros < FAIXAS.raioMetros.min) {
    erros.push('O raio precisa ser de pelo menos 1 metro. O banco recusa zero ou negativo.')
  }

  if (erros.length > 0) return { ok: false, erros }
  return {
    ok: true,
    valor: {
      nome,
      latitude: latitude as number,
      longitude: longitude as number,
      raioMetros: raioMetros as number,
    },
  }
}

/** O que o formulário das regras entrega. Carga em `HH:MM`, o resto em número. */
export interface RascunhoDaJornada {
  cargaDiaria: string
  toleranciaMinutos: string
  janelaDuplicidadeSegundos: string
}

/**
 * Lê o formulário das regras de jornada.
 *
 * A JANELA DE DUPLICIDADE TEM PISO: desligar a proteção contra batida
 * repetida não é configuração, é defeito. Zero é recusado aqui e recusado no
 * banco — a tela explica, o banco garante.
 */
export function validarJornada(rascunho: RascunhoDaJornada): Leitura<RegrasDeJornada> {
  const erros: string[] = []

  const cargaDiariaMinutos = lerDuracao(rascunho.cargaDiaria)
  if (cargaDiariaMinutos === null) {
    erros.push('Carga diária: escreva no formato horas:minutos, como 08:00.')
  } else if (
    cargaDiariaMinutos < FAIXAS.cargaDiariaMinutos.min ||
    cargaDiariaMinutos > FAIXAS.cargaDiariaMinutos.max
  ) {
    erros.push(
      `A carga diária precisa ficar entre ${escreverDuracao(FAIXAS.cargaDiariaMinutos.min)} e ${escreverDuracao(FAIXAS.cargaDiariaMinutos.max)}. Fora disso o banco recusa.`,
    )
  }

  const toleranciaMinutos = lerInteiro(rascunho.toleranciaMinutos)
  if (toleranciaMinutos === null) {
    erros.push('Tolerância: digite um número inteiro de minutos.')
  } else if (
    toleranciaMinutos < FAIXAS.toleranciaMinutos.min ||
    toleranciaMinutos > FAIXAS.toleranciaMinutos.max
  ) {
    erros.push(
      `A tolerância precisa ficar entre ${FAIXAS.toleranciaMinutos.min} e ${FAIXAS.toleranciaMinutos.max} minutos.`,
    )
  }

  const janelaDuplicidadeSegundos = lerInteiro(rascunho.janelaDuplicidadeSegundos)
  if (janelaDuplicidadeSegundos === null) {
    erros.push('Janela de duplicidade: digite um número inteiro de segundos.')
  } else if (janelaDuplicidadeSegundos < FAIXAS.janelaDuplicidadeSegundos.min) {
    erros.push(
      `A janela de duplicidade não pode ser menor que ${FAIXAS.janelaDuplicidadeSegundos.min} segundos. Desligar a proteção contra batida repetida não é configuração, é defeito — o banco também recusa.`,
    )
  } else if (janelaDuplicidadeSegundos > FAIXAS.janelaDuplicidadeSegundos.max) {
    erros.push(
      `A janela de duplicidade não pode passar de ${FAIXAS.janelaDuplicidadeSegundos.max} segundos: acima disso ela começa a recusar batida legítima de quem saiu e voltou.`,
    )
  }

  if (erros.length > 0) return { ok: false, erros }
  return {
    ok: true,
    valor: {
      cargaDiariaMinutos: cargaDiariaMinutos as number,
      toleranciaMinutos: toleranciaMinutos as number,
      janelaDuplicidadeSegundos: janelaDuplicidadeSegundos as number,
    },
  }
}

/** O que o formulário da empresa entrega. Tudo texto, tudo opcional. */
export interface RascunhoDaEmpresa {
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  endereco: string
  cidade: string
  uf: string
}

/**
 * Lê o formulário da empresa.
 *
 * CAMPO VAZIO NÃO É ERRO. A folha imprime o cabeçalho em branco em vez de
 * falhar, e a área de administração avisa o que falta — avisar é
 * `camposFaltandoDaEmpresa`, logo abaixo, e não uma recusa aqui. Deixar em
 * branco é uma escolha legítima enquanto o dado não existe; inventar não é.
 *
 * O que é recusado é campo PREENCHIDO ERRADO: CNPJ que não fecha, UF que não é
 * sigla de estado.
 */
export function validarEmpresa(rascunho: RascunhoDaEmpresa): Leitura<DadosDaEmpresa> {
  const erros: string[] = []
  const ouNulo = (texto: string) => texto.trim() || null

  const cnpjDigitado = somenteDigitosDeCnpj(rascunho.cnpj).trim()
  let cnpj: string | null = null
  if (cnpjDigitado !== '') {
    if (!/^\d{14}$/.test(cnpjDigitado)) {
      erros.push('O CNPJ precisa ter 14 dígitos. Deixe em branco se ainda não souber.')
    } else if (!cnpjEhValido(cnpjDigitado)) {
      erros.push(
        'Esse CNPJ não passa na conferência dos dígitos verificadores. Confira o número — um documento errado na folha é pior do que um campo vazio.',
      )
    } else {
      cnpj = cnpjDigitado
    }
  }

  const uf = rascunho.uf.trim().toUpperCase()
  if (uf !== '' && !/^[A-Z]{2}$/.test(uf)) {
    erros.push('A UF é a sigla de duas letras do estado, como SP.')
  }

  if (erros.length > 0) return { ok: false, erros }
  return {
    ok: true,
    valor: {
      razaoSocial: ouNulo(rascunho.razaoSocial),
      nomeFantasia: ouNulo(rascunho.nomeFantasia),
      cnpj,
      endereco: ouNulo(rascunho.endereco),
      cidade: ouNulo(rascunho.cidade),
      uf: uf || null,
    },
  }
}

/**
 * O que ainda falta preencher para a folha sair com o cabeçalho
 * inteiro. Lista de rótulos, na ordem em que aparecem no formulário.
 *
 * NÃO É VALIDAÇÃO, É AVISO. A folha imprime do mesmo jeito, com o espaço em
 * branco. O que esta lista evita é a descoberta na hora errada: quem imprime a
 * folha para assinar não quer descobrir ali que o CNPJ nunca foi cadastrado.
 */
export function camposFaltandoDaEmpresa(empresa: DadosDaEmpresa): string[] {
  const faltando: string[] = []
  if (!empresa.razaoSocial) faltando.push('razão social')
  if (!empresa.nomeFantasia) faltando.push('nome de fantasia')
  if (!empresa.cnpj) faltando.push('CNPJ')
  if (!empresa.endereco) faltando.push('endereço')
  if (!empresa.cidade) faltando.push('cidade')
  if (!empresa.uf) faltando.push('UF')
  return faltando
}

/**
 * O endereço da empresa em uma linha, para o cabeçalho impresso.
 * Junta só o que existe — sem vírgula solta nem barra órfã.
 */
export function enderecoEmUmaLinha(empresa: DadosDaEmpresa): string {
  const cidadeComUf = [empresa.cidade, empresa.uf].filter(Boolean).join('/')
  return [empresa.endereco, cidadeComUf].filter(Boolean).join(' — ')
}

/* ------------------------------------------------------------------ */
/* A mensagem de duplicidade do banco                                  */
/* ------------------------------------------------------------------ */

/**
 * Tira os segundos da recusa de duplicidade que o gatilho levanta.
 *
 * A mensagem carrega o número configurado: `"Batida duplicada: ja existe um
 * registro deste funcionario ha menos de 90 segundos"`. Uma tela que repetisse
 * "menos de um minuto" de cabeça mentiria no primeiro ajuste feito pela área de
 * administração.
 *
 * Devolve `null` quando não encontra o número, e quem chama cai numa frase sem
 * número. Uma mensagem de banco que mudou de forma não pode virar `NaN` na
 * tela.
 */
export function segundosDaMensagemDeDuplicidade(mensagem: string): number | null {
  const achado = /Batida duplicada[^0-9]*(\d+)\s*segundos/i.exec(mensagem)
  if (!achado) return null
  const segundos = Number(achado[1])
  return Number.isFinite(segundos) ? segundos : null
}
