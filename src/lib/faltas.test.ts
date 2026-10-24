import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A CONVERSA DAS AUSÊNCIAS COM O BANCO, CONTRA UM SUPABASE SIMULADO. Nada de
 * rede.
 *
 * O que se prova:
 *   • O ATESTADO SOBE ANTES, no caminho combinado (`{usuario}/{id}.{ext}`), com
 *     o tipo que bate com a extensão e sem `upsert` — e o MESMO id vai no
 *     INSERT, que o gatilho confere contra o bucket.
 *   • TENTAR DE NOVO COM O MESMO ID SEGUE: o "já existe" do storage não é erro.
 *     Qualquer outro erro do envio para tudo antes do INSERT.
 *   • O INSERT manda só as sete colunas que o privilégio de coluna deixa; o
 *     cancelamento manda só `motivo_cancelamento`, e sem motivo nem viaja.
 *   • A leitura é por SOBREPOSIÇÃO ao período (o atestado de 28/09 a 02/10 é de
 *     outubro também), paginada e ordenada.
 *   • O link do atestado é do bucket `ponto-atestados` e vive dois minutos.
 *   • A FOTO SOBE REFEITA NO APARELHO, nunca o original, mesmo quando a
 *     refeita sai maior: o original leva os metadados da câmera. E a tela só
 *     diz "reduzida" quando o arquivo de fato diminuiu.
 *   • O contrato: toda frase de recusa dos gatilhos das ausências, lida da
 *     migration da estrutura do banco, chega traduzida.
 */

const simulado = vi.hoisted(() => {
  interface Operacao {
    metodo: string
    args: unknown[]
  }
  interface Resposta {
    data: unknown
    error: { message: string } | null
  }
  const estado = {
    consultas: [] as { tabela: string; operacoes: Operacao[] }[],
    respostaDaTabela: ((): Resposta => ({ data: [], error: null })) as (
      tabela: string,
      operacoes: Operacao[],
    ) => Resposta,
    envios: [] as { bucket: string; caminho: string; opcoes: Record<string, unknown> }[],
    erroDoEnvio: null as { message: string } | null,
    assinaturas: [] as { bucket: string; caminho: string; segundos: number }[],
  }

  function consulta(tabela: string): unknown {
    const registro = { tabela, operacoes: [] as Operacao[] }
    estado.consultas.push(registro)
    const proxy: unknown = new Proxy(
      {},
      {
        get(_alvo, propriedade) {
          if (propriedade === 'then') {
            const resultado = estado.respostaDaTabela(tabela, registro.operacoes)
            return (resolver: (valor: unknown) => unknown, rejeitar: (erro: unknown) => unknown) =>
              Promise.resolve(resultado).then(resolver, rejeitar)
          }
          return (...args: unknown[]) => {
            registro.operacoes.push({ metodo: String(propriedade), args })
            return proxy
          }
        },
      },
    )
    return proxy
  }

  const supabase = {
    from: (tabela: string) => consulta(tabela),
    storage: {
      from: (bucket: string) => ({
        upload: (caminho: string, _conteudo: unknown, opcoes: Record<string, unknown>) => {
          estado.envios.push({ bucket, caminho, opcoes })
          return Promise.resolve({ data: null, error: estado.erroDoEnvio })
        },
        createSignedUrl: (caminho: string, segundos: number) => {
          estado.assinaturas.push({ bucket, caminho, segundos })
          return Promise.resolve({ data: { signedUrl: `https://assinado/${caminho}` }, error: null })
        },
      }),
    },
  }
  return { estado, supabase }
})

vi.mock('./supabase', () => ({ supabase: simulado.supabase }))

const {
  cancelarAusencia,
  ErroDaAusencia,
  lancarAusencia,
  lerAusenciasDoPeriodo,
  prepararAtestado,
  resumoDoAtestado,
  urlAssinadaDoAtestado,
} = await import('./faltas')
const { ErroDoPainel } = await import('./admin')

const { estado } = simulado

const USUARIO = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'

const ATESTADO_JPG = {
  conteudo: new Blob(['jpeg'], { type: 'image/jpeg' }),
  extensao: 'jpg' as const,
  tipo: 'image/jpeg',
  comprimido: true,
  tamanhoOriginal: 4_000_000,
}

const LANCAMENTO = {
  id: ID,
  usuarioId: USUARIO,
  diaInicio: '2026-10-14',
  diaFim: '2026-10-16',
  tipo: 'atestado_medico' as const,
  observacao: null,
  atestado: ATESTADO_JPG,
}

beforeEach(() => {
  estado.consultas = []
  estado.envios = []
  estado.assinaturas = []
  estado.erroDoEnvio = null
  estado.respostaDaTabela = () => ({ data: { id: ID }, error: null })
})

const operacoes = (indice = 0) => estado.consultas[indice]?.operacoes ?? []
const operacao = (nome: string, indice = 0) => operacoes(indice).find((op) => op.metodo === nome)

describe('lançar a ausência', () => {
  it('sobe o atestado antes, no caminho combinado, sem upsert, com o tipo da extensão', async () => {
    await lancarAusencia(LANCAMENTO)
    expect(estado.envios).toEqual([
      {
        bucket: 'ponto-atestados',
        caminho: `${USUARIO}/${ID}.jpg`,
        opcoes: { contentType: 'image/jpeg', upsert: false },
      },
    ])
    expect(estado.consultas.map((c) => c.tabela)).toEqual(['ponto_ausencias'])
  })

  it('o INSERT manda só as sete colunas do privilégio, com o mesmo id e o mesmo caminho', async () => {
    await lancarAusencia(LANCAMENTO)
    const inserido = operacao('insert')?.args[0] as Record<string, unknown>
    expect(Object.keys(inserido).sort()).toEqual(
      ['atestado_path', 'dia_fim', 'dia_inicio', 'id', 'observacao', 'tipo', 'usuario_id'].sort(),
    )
    expect(inserido).toMatchObject({ id: ID, usuario_id: USUARIO, atestado_path: `${USUARIO}/${ID}.jpg` })
    expect(operacao('single')).toBeDefined()
  })

  it('sem atestado, não toca o bucket e manda o caminho nulo', async () => {
    await lancarAusencia({ ...LANCAMENTO, atestado: null })
    expect(estado.envios).toEqual([])
    expect((operacao('insert')?.args[0] as Record<string, unknown>).atestado_path).toBeNull()
  })

  it('o PDF sobe como .pdf e application/pdf', async () => {
    await lancarAusencia({
      ...LANCAMENTO,
      atestado: { ...ATESTADO_JPG, extensao: 'pdf', tipo: 'application/pdf', comprimido: false },
    })
    expect(estado.envios[0]).toMatchObject({
      caminho: `${USUARIO}/${ID}.pdf`,
      opcoes: { contentType: 'application/pdf' },
    })
  })

  it('tentar de novo com o mesmo id segue: o "já existe" do storage não é erro', async () => {
    estado.erroDoEnvio = { message: 'The resource already exists' }
    await lancarAusencia(LANCAMENTO)
    expect(operacao('insert')).toBeDefined()
  })

  it('outro erro do envio para tudo antes do INSERT', async () => {
    estado.erroDoEnvio = { message: 'The object exceeded the maximum allowed size' }
    await expect(lancarAusencia(LANCAMENTO)).rejects.toThrow('10 MB')
    expect(estado.consultas).toEqual([])
  })

  it('a recusa do gatilho chega traduzida', async () => {
    estado.respostaDaTabela = () => ({
      data: null,
      error: {
        message:
          'Ja existe ausencia ativa desta pessoa em parte deste periodo: cancele a anterior antes de lancar de novo',
      },
    })
    await expect(lancarAusencia(LANCAMENTO)).rejects.toThrow('Já existe uma ausência lançada')
  })

  /*
   * O CASO: a resposta da tentativa anterior se perdeu, mas o INSERT gravou.
   * Na nova tentativa (mesmo id) o gatilho acusa sobreposição com a PRÓPRIA
   * linha — antes da chave primária. O app tem de reconhecer o próprio id e
   * seguir, e não mandar cancelar a falta certa.
   */
  it('na sobreposição com a própria linha (tentativa anterior gravou), é sucesso', async () => {
    const SOBREPOSTA = {
      message:
        'Ja existe ausencia ativa desta pessoa em parte deste periodo: cancele a anterior antes de lancar de novo',
    }
    estado.respostaDaTabela = (_tabela, ops) =>
      ops.some((op) => op.metodo === 'insert')
        ? { data: null, error: SOBREPOSTA }
        : { data: { id: ID, dia_inicio: '2026-10-14' }, error: null }
    const gravada = await lancarAusencia(LANCAMENTO)
    expect(gravada).toMatchObject({ id: ID })
    const releitura = estado.consultas[1]?.operacoes ?? []
    expect(releitura.find((op) => op.metodo === 'eq')?.args).toEqual(['id', ID])
    expect(releitura.find((op) => op.metodo === 'maybeSingle')).toBeDefined()
  })

  it('na sobreposição com OUTRA ausência (o id não existe), a recusa continua', async () => {
    estado.respostaDaTabela = (_tabela, ops) =>
      ops.some((op) => op.metodo === 'insert')
        ? {
            data: null,
            error: {
              message:
                'Ja existe ausencia ativa desta pessoa em parte deste periodo: cancele a anterior antes de lancar de novo',
            },
          }
        : { data: null, error: null }
    await expect(lancarAusencia(LANCAMENTO)).rejects.toThrow('Já existe uma ausência lançada')
    expect(estado.consultas).toHaveLength(2)
  })
})

describe('cancelar a ausência', () => {
  it('manda só motivo_cancelamento, aparado, e filtra pelo id', async () => {
    await cancelarAusencia({ ausenciaId: ID, motivo: '  lançada no dia errado  ' })
    expect(operacao('update')?.args[0]).toEqual({ motivo_cancelamento: 'lançada no dia errado' })
    expect(operacao('eq')?.args).toEqual(['id', ID])
  })

  it('sem motivo, nem viaja', async () => {
    await expect(cancelarAusencia({ ausenciaId: ID, motivo: '   ' })).rejects.toBeInstanceOf(ErroDaAusencia)
    expect(estado.consultas).toEqual([])
  })

  it('a já cancelada volta com frase própria', async () => {
    estado.respostaDaTabela = () => ({
      data: null,
      error: { message: 'Ausencia ja cancelada: o cancelamento e definitivo' },
    })
    await expect(cancelarAusencia({ ausenciaId: ID, motivo: 'de novo' })).rejects.toThrow('já foi cancelada')
  })
})

describe('ler as ausências', () => {
  it('filtra por sobreposição ao período, ordena e pagina; a pessoa, quando pedida', async () => {
    estado.respostaDaTabela = () => ({ data: [], error: null })
    await lerAusenciasDoPeriodo({ inicio: '2026-10-01', fim: '2026-10-31' }, USUARIO)
    const ops = operacoes().map((op) => [op.metodo, ...op.args])
    expect(ops).toContainEqual(['lte', 'dia_inicio', '2026-10-31'])
    expect(ops).toContainEqual(['gte', 'dia_fim', '2026-10-01'])
    expect(ops).toContainEqual(['eq', 'usuario_id', USUARIO])
    expect(ops).toContainEqual(['order', 'dia_inicio', { ascending: true }])
    expect(ops).toContainEqual(['order', 'id', { ascending: true }])
    expect(ops.some(([metodo]) => metodo === 'range')).toBe(true)
  })

  it('pede as colunas do cancelamento — a lista do admin mostra quem cancelou', async () => {
    estado.respostaDaTabela = () => ({ data: [], error: null })
    await lerAusenciasDoPeriodo({ inicio: '2026-10-01', fim: '2026-10-31' })
    const colunas = String(operacao('select')?.args[0])
    for (const coluna of ['cancelada_em', 'cancelada_por', 'motivo_cancelamento', 'lancado_por', 'atestado_path']) {
      expect(colunas).toContain(coluna)
    }
    expect(operacoes().some((op) => op.metodo === 'eq')).toBe(false)
  })
})

describe('o link do atestado', () => {
  it('é do bucket ponto-atestados e vive dois minutos', async () => {
    const url = await urlAssinadaDoAtestado(`${USUARIO}/${ID}.pdf`)
    expect(url).toContain(ID)
    expect(estado.assinaturas).toEqual([{ bucket: 'ponto-atestados', caminho: `${USUARIO}/${ID}.pdf`, segundos: 120 }])
  })
})

/* ------------------------------------------------------------------ */
/* A compressão no aparelho                                            */
/* ------------------------------------------------------------------ */

describe('preparar o atestado no aparelho', () => {
  /** Um arquivo de `tamanho` bytes, sem alocar o conteúdo à toa. */
  function arquivo(nome: string, tipo: string, tamanho: number): File {
    const falso = new File(['x'], nome, { type: tipo })
    Object.defineProperty(falso, 'size', { value: tamanho })
    return falso
  }

  /**
   * O canvas que o navegador daria, gravando o que a compressão pediu e o JPEG
   * que ele devolveu (`gerados`). `bytesDoJpeg`: o tamanho desse JPEG (o padrão
   * é bem menor que qualquer foto dos testes).
   */
  function simularCanvas({ bytesDoJpeg = 5 }: { bytesDoJpeg?: number } = {}) {
    const pedidos: { metodo: string; args: unknown[] }[] = []
    const gerados: Blob[] = []
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        set fillStyle(cor: string) {
          pedidos.push({ metodo: 'fillStyle', args: [cor] })
        },
        fillRect: (...args: unknown[]) => pedidos.push({ metodo: 'fillRect', args }),
        drawImage: (...args: unknown[]) => pedidos.push({ metodo: 'drawImage', args: args.slice(1) }),
      }),
      toBlob: (devolver: (blob: Blob | null) => void, tipo: string, qualidade: number) => {
        pedidos.push({ metodo: 'toBlob', args: [tipo, qualidade] })
        const jpeg = new Blob([new Uint8Array(bytesDoJpeg)], { type: 'image/jpeg' })
        gerados.push(jpeg)
        devolver(jpeg)
      },
    }
    vi.stubGlobal('document', { createElement: (tag: string) => (tag === 'canvas' ? canvas : null) })
    return { canvas, pedidos, gerados }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('o PDF vai como veio — reescrever a prova é o que não se faz', async () => {
    const pdf = arquivo('atestado.pdf', 'application/pdf', 800_000)
    const pronto = await prepararAtestado(pdf)
    expect(pronto).toMatchObject({ extensao: 'pdf', tipo: 'application/pdf', comprimido: false })
    expect(pronto.conteudo).toBe(pdf)
  })

  it('o PDF acima de 10 MB e o arquivo que não é foto nem PDF são recusados antes de subir', async () => {
    await expect(prepararAtestado(arquivo('a.pdf', 'application/pdf', 11 * 1024 * 1024))).rejects.toThrow('10 MB')
    await expect(prepararAtestado(arquivo('a.docx', 'application/msword', 1000))).rejects.toThrow('PDF')
  })

  it('a foto é reduzida no canvas a 2000 px no lado maior, com fundo branco, em JPEG 0,85', async () => {
    const { canvas, pedidos } = simularCanvas()
    const fechar = vi.fn()
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 4000, height: 3000, close: fechar }))

    const pronto = await prepararAtestado(arquivo('IMG_0001.png', 'image/png', 5_000_000))

    expect([canvas.width, canvas.height]).toEqual([2000, 1500])
    expect(pedidos.map((pedido) => pedido.metodo)).toEqual(['fillStyle', 'fillRect', 'drawImage', 'toBlob'])
    expect(pedidos[0].args).toEqual(['#ffffff'])
    expect(pedidos[2].args).toEqual([0, 0, 2000, 1500])
    expect(pedidos[3].args).toEqual(['image/jpeg', 0.85])
    // A foto comprimida vira .jpg, com o tipo que o gatilho confere contra a extensão.
    expect(pronto).toMatchObject({ extensao: 'jpg', tipo: 'image/jpeg', comprimido: true, tamanhoOriginal: 5_000_000 })
    expect(fechar).toHaveBeenCalled()
  })

  it('a foto que o navegador não abre (HEIC fora do Safari) sobe como está, se couber em 10 MB', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('formato desconhecido')))
    vi.stubGlobal('Image', undefined)

    const heic = arquivo('IMG_0002.HEIC', '', 3_000_000)
    const pronto = await prepararAtestado(heic)
    expect(pronto).toMatchObject({ extensao: 'heic', tipo: 'image/heic', comprimido: false })
    expect(pronto.conteudo).toBe(heic)

    await expect(prepararAtestado(arquivo('IMG_0003.HEIC', '', 12 * 1024 * 1024))).rejects.toThrow('10 MB')
  })

  /*
   * A REGRA QUE ESTE TESTE SEGURA: imagem que o navegador abre sobe REFEITA,
   * nunca o arquivo original. Em qualquer formato, e com a refeita menor, do
   * mesmo tamanho ou MAIOR que o original. O original de uma foto de celular
   * leva os metadados da câmera (o EXIF, que pode ter o GPS de onde a foto foi
   * tirada, muitas vezes a casa da pessoa), e o atestado é dado de saúde. Subir
   * o original para economizar uns kB trocaria a privacidade de quem faltou
   * por bytes: por isso a imagem sobe sempre refeita.
   */
  const FORMATOS = [
    ['JPEG', 'atestado.jpg', 'image/jpeg'],
    ['PNG', 'atestado.png', 'image/png'],
    ['WebP', 'atestado.webp', 'image/webp'],
    ['HEIC', 'atestado.heic', 'image/heic'],
  ] as const
  // O original tem 71 000 bytes; a refeita, estes.
  const REFEITAS = [
    ['menor', 30_000],
    ['do mesmo tamanho', 71_000],
    ['maior', 75_000],
  ] as const
  const CASOS = FORMATOS.flatMap(([formato, nome, tipo]) =>
    REFEITAS.map(([comparacao, bytes]) => [formato, comparacao, nome, tipo, bytes] as const),
  )
  it.each(CASOS)(
    '%s com a refeita %s que o original: sobe a refeita, nunca o original',
    async (_formato, _comparacao, nome, tipo, bytes) => {
      const { gerados } = simularCanvas({ bytesDoJpeg: bytes })
      vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 900, height: 1200, close: () => {} }))

      const original = arquivo(nome, tipo, 71_000)
      const pronto = await prepararAtestado(original)

      expect(pronto.conteudo).not.toBe(original)
      expect(pronto.conteudo).toBe(gerados[0])
      expect(pronto).toMatchObject({ extensao: 'jpg', tipo: 'image/jpeg', comprimido: true, tamanhoOriginal: 71_000 })
    },
  )

  /*
   * A REFEITA PODE SAIR MAIOR, E SOBE ASSIM MESMO. Um JPEG pequeno, já
   * comprimido por quem o mandou (a foto que chegou pelo WhatsApp), refeito em
   * JPEG 0,85 sai uns kB maior: 71 KB vira 75 KB. Sobe o de 75 KB, sem os
   * metadados (ver o teste acima). O que não pode é a tela dizer "reduzida de
   * 71 KB para 75 KB".
   */
  it('a foto que a refeita deixa maior sobe refeita assim mesmo, e a tela não diz que reduziu', async () => {
    const { gerados } = simularCanvas({ bytesDoJpeg: 75_000 })
    const fechar = vi.fn()
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 900, height: 1200, close: fechar }))

    const jpeg = arquivo('atestado-do-whatsapp.jpg', 'image/jpeg', 71_000)
    const pronto = await prepararAtestado(jpeg)

    expect(pronto.conteudo).not.toBe(jpeg)
    expect(pronto.conteudo).toBe(gerados[0])
    expect(pronto).toMatchObject({ extensao: 'jpg', tipo: 'image/jpeg', comprimido: true, tamanhoOriginal: 71_000 })
    expect(resumoDoAtestado(pronto)).toBe('convertida para JPG · 73 KB')
    expect(fechar).toHaveBeenCalled()
  })

  it('do mesmo tamanho também sobe a refeita, e a tela diz que converteu', async () => {
    const { gerados } = simularCanvas({ bytesDoJpeg: 40_000 })
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 600, height: 800, close: () => {} }))

    const png = arquivo('recibo.png', 'image/png', 40_000)
    const pronto = await prepararAtestado(png)

    expect(pronto.conteudo).toBe(gerados[0])
    expect(pronto).toMatchObject({ extensao: 'jpg', tipo: 'image/jpeg', comprimido: true, tamanhoOriginal: 40_000 })
    expect(resumoDoAtestado(pronto)).toBe('convertida para JPG · 39 KB')
  })

  /*
   * No HEIC que o navegador abre, a refeita serve duas vezes: sai sem os
   * metadados e em JPEG, que abre em qualquer navegador (o HEIC só abre no
   * Safari, e fora dele vira link, e não miniatura: `atestadoAbreComoLink`).
   * Sem ficar menor, a tela diz que converteu, e não que reduziu.
   */
  it('o HEIC que o navegador abre vira JPEG mesmo sem ficar menor, e a tela diz que converteu', async () => {
    simularCanvas({ bytesDoJpeg: 300_000 })
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 1000, height: 1400, close: () => {} }))

    const heic = arquivo('IMG_0004.HEIC', 'image/heic', 250_000)
    const pronto = await prepararAtestado(heic)

    expect(pronto.conteudo).not.toBe(heic)
    expect(pronto).toMatchObject({ extensao: 'jpg', tipo: 'image/jpeg', comprimido: true, tamanhoOriginal: 250_000 })
    expect(resumoDoAtestado(pronto)).toBe('convertida para JPG · 293 KB')
  })
})

describe('a linha do atestado escolhido, na caixa de lançar falta', () => {
  const pronto = (
    bytes: number,
    resto: { extensao: 'jpg' | 'heic' | 'pdf'; comprimido: boolean; tamanhoOriginal: number },
  ) => ({
    conteudo: new Blob([new Uint8Array(bytes)]),
    tipo: { jpg: 'image/jpeg', heic: 'image/heic', pdf: 'application/pdf' }[resto.extensao],
    ...resto,
  })

  it('diz "reduzida" só quando o arquivo de fato ficou menor', () => {
    expect(resumoDoAtestado(pronto(421_888, { extensao: 'jpg', comprimido: true, tamanhoOriginal: 5_000_000 }))).toBe(
      'reduzida de 4,8 MB para 412 KB',
    )
  })

  it('refeita e não menor, diz que converteu para JPG, sem prometer redução', () => {
    const maior = pronto(75_000, { extensao: 'jpg', comprimido: true, tamanhoOriginal: 71_000 })
    const igual = pronto(71_000, { extensao: 'jpg', comprimido: true, tamanhoOriginal: 71_000 })
    expect(resumoDoAtestado(maior)).toBe('convertida para JPG · 73 KB')
    expect(resumoDoAtestado(igual)).toBe('convertida para JPG · 69 KB')
  })

  it('menor por uns bytes, mas igual na tela, também não vira "reduzida de 69 KB para 69 KB"', () => {
    expect(resumoDoAtestado(pronto(70_800, { extensao: 'jpg', comprimido: true, tamanhoOriginal: 71_000 }))).toBe(
      'convertida para JPG · 69 KB',
    )
  })

  it('o que foi como veio (PDF, HEIC que o navegador não abre) diz o formato e o tamanho', () => {
    expect(resumoDoAtestado(pronto(800_000, { extensao: 'pdf', comprimido: false, tamanhoOriginal: 800_000 }))).toBe('PDF · 781 KB')
    expect(resumoDoAtestado(pronto(3_000_000, { extensao: 'heic', comprimido: false, tamanhoOriginal: 3_000_000 }))).toBe(
      'HEIC · 2,9 MB',
    )
  })
})

/* ------------------------------------------------------------------ */
/* O contrato com a migration da estrutura                             */
/* ------------------------------------------------------------------ */

describe('o contrato com o banco (a migration da estrutura)', () => {
  const migracoes = import.meta.glob<string>('../../supabase/migrations/*_ponto_livre_estrutura.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  const sql = Object.values(migracoes).join('\n')

  /** O corpo (entre `AS $$` e `$$;`) de uma função criada na migration. */
  const corpoDa = (nome: string) =>
    new RegExp(String.raw`CREATE FUNCTION public\.${nome}\([\s\S]*?\nAS \$\$\n([\s\S]*?)\n\$\$;`).exec(sql)?.[1] ?? ''

  /*
   * As frases de `RAISE EXCEPTION '...'` dos dois gatilhos das ausências, com
   * `%` preenchido. Só deles: a migration traz a estrutura inteira, e as
   * recusas das outras tabelas têm a tradução delas.
   */
  const gatilhos = [corpoDa('ponto_ausencias_guardar'), corpoDa('ponto_ausencias_nao_se_apagam')].join('\n')
  const frases = [...gatilhos.matchAll(/RAISE EXCEPTION '((?:[^']|'')+)'/g)].map((casamento) =>
    casamento[1].replace(/''/g, "'").replace(/%/g, 'x'),
  )

  it('a migration da estrutura está no repositório, com as frases dos gatilhos das ausências', () => {
    expect(Object.keys(migracoes)).toHaveLength(1)
    expect(sql.trim()).not.toBe('')
    expect(corpoDa('ponto_ausencias_guardar')).not.toBe('')
    expect(corpoDa('ponto_ausencias_nao_se_apagam')).not.toBe('')
    expect(frases.length).toBeGreaterThanOrEqual(15)
  })

  it.each(frases)('"%s" chega traduzida, e não crua', (frase) => {
    const traduzida = new ErroDaAusencia(frase).message
    expect(traduzida).not.toBe(frase)
    // E com frase PRÓPRIA da ausência: cair na tradução genérica do painel
    // diria "batida" ou "tente de novo" para uma recusa que tem motivo.
    expect(traduzida).not.toBe(new ErroDoPainel(frase).message)
  })

  it('o INSERT do app são as colunas que a migration concede', () => {
    expect(sql).toContain(
      'GRANT INSERT (id, usuario_id, dia_inicio, dia_fim, tipo, observacao, atestado_path)',
    )
    expect(sql).toContain('GRANT UPDATE (motivo_cancelamento) ON public.ponto_ausencias TO authenticated;')
  })

  it('o bucket aceita os tipos que o app manda, e o teto é o de 10 MB', () => {
    expect(sql).toContain("ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']")
    expect(sql).toContain('10485760')
  })

  it('os limites do app são os do banco', () => {
    expect(sql).toContain('ponto_ausencias_periodo_ate_120_dias CHECK (((dia_fim - dia_inicio) <= 119))')
    expect(sql).toContain('v_hoje - 366')
    expect(sql).toContain('char_length(observacao) <= 1000')
    expect(sql).toContain('char_length(motivo_cancelamento) <= 500')
  })
})
