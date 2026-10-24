import { describe, expect, it } from 'vitest'
import {
  EXEMPLOS_DOS_CAMPOS,
  avaliarLeitura,
  conferirCoordenada,
  decidirGravacaoDoLocal,
  dentroDoBrasil,
  descreverForaDaPessoa,
  descreverMedicao,
  descreverSemLocalizacaoDaPessoa,
  escolherMelhorLeitura,
  formatarPorcentagem,
  lerParDeCoordenadas,
  linkDoMapa,
  PRECISAO_MAXIMA_DA_MEDICAO_METROS,
  resumirLocalizacoes,
  type LocalizacaoDaBatida,
} from './coordenada'
import { lerNumero, validarLocal } from './configuracao'

/*
 * O local de trabalho à prova do erro que deixa TODA batida "fora" sem que
 * ninguém perceba. Cada bloco é uma das portas por onde esse erro passaria
 * calado: coordenada trocada que o banco aceita, vírgula decimal, par colado,
 * leitura de GPS ruim aceita como medição, e uma porcentagem de "fora" que
 * ninguém olharia.
 */

/** O local de trabalho dos exemplos (o centro de São Paulo). */
const LOCAL = { latitude: -23.55052, longitude: -46.633308 }

describe('conferirCoordenada — o que o banco aceita e marcaria todo mundo como fora', () => {
  it('o local certo não tem aviso nenhum', () => {
    expect(conferirCoordenada(LOCAL.latitude, LOCAL.longitude)).toEqual([])
    expect(dentroDoBrasil(LOCAL.latitude, LOCAL.longitude)).toBe(true)
  })

  it('latitude e longitude trocadas geram aviso, com a sugestão destrocada', () => {
    // -46,63 é uma latitude válida no planeta (o CHECK da tabela aceita): é por
    // isso que só a tela consegue pegar este erro.
    const avisos = conferirCoordenada(LOCAL.longitude, LOCAL.latitude)
    expect(avisos).toHaveLength(1)
    expect(avisos[0].tipo).toBe('trocada')
    expect(avisos[0].texto).toMatch(/parecem trocadas/)
    expect(avisos[0].sugestao).toEqual(LOCAL)
  })

  it('sinal de menos esquecido gera aviso e sugere o sinal', () => {
    const semSinalNaLongitude = conferirCoordenada(-23.55052, 46.633308)
    expect(semSinalNaLongitude[0].tipo).toBe('sem_sinal')
    expect(semSinalNaLongitude[0].sugestao).toEqual(LOCAL)

    const semSinalNenhum = conferirCoordenada(23.55052, 46.633308)
    expect(semSinalNenhum[0].tipo).toBe('sem_sinal')
    expect(semSinalNenhum[0].sugestao).toEqual(LOCAL)
  })

  it('(0, 0) é o campo zerado, não um lugar', () => {
    expect(conferirCoordenada(0, 0)[0].tipo).toBe('zerada')
  })

  it('fora do Brasil sem conserto óbvio avisa sem sugerir nada', () => {
    const lisboa = conferirCoordenada(38.72, -9.14)
    expect(lisboa[0].tipo).toBe('fora_do_brasil')
    expect(lisboa[0].sugestao).toBeNull()
  })

  it('as pontas do Brasil continuam dentro (sem acusar a fronteira)', () => {
    expect(dentroDoBrasil(-33.75, -53.39)).toBe(true) // Chuí
    expect(dentroDoBrasil(5.27, -60.21)).toBe(true) // Monte Caburaí
    expect(dentroDoBrasil(-7.53, -73.99)).toBe(true) // Serra do Divisor
    expect(dentroDoBrasil(-3.85, -32.42)).toBe(true) // Fernando de Noronha
    expect(dentroDoBrasil(-20.52, -29.32)).toBe(true) // Trindade
  })

  it('coordenada sem número não gera aviso (quem reclama é a validação do campo)', () => {
    expect(conferirCoordenada(Number.NaN, -46.63)).toEqual([])
  })
})

describe('vírgula decimal e o par colado', () => {
  it('o campo aceita vírgula decimal — "-23,550520" não vira -23', () => {
    expect(lerNumero('-23,550520')).toBe(-23.55052)
    const leitura = validarLocal({
      nome: 'Empresa Exemplo',
      latitude: '-23,550520',
      longitude: '-46,633308',
      raioMetros: '150',
    })
    expect(leitura.ok && leitura.valor).toMatchObject(LOCAL)
  })

  it('lê o par como o Google Maps copia', () => {
    expect(lerParDeCoordenadas('-23.550520, -46.633308')).toEqual(LOCAL)
    expect(lerParDeCoordenadas('(-23.550520, -46.633308)')).toEqual(LOCAL)
    expect(lerParDeCoordenadas('-23.550520,-46.633308')).toEqual(LOCAL)
  })

  it('lê o par com vírgula decimal', () => {
    expect(lerParDeCoordenadas('-23,550520 -46,633308')).toEqual(LOCAL)
    expect(lerParDeCoordenadas('-23,550520; -46,633308')).toEqual(LOCAL)
    expect(lerParDeCoordenadas('-23,550520, -46,633308')).toEqual(LOCAL)
    expect(lerParDeCoordenadas('-23,550520,-46,633308')).toEqual(LOCAL)
  })

  it('um número só, três números ou texto sobrando não são par', () => {
    expect(lerParDeCoordenadas('-23,550520')).toBeNull()
    expect(lerParDeCoordenadas('-23.550520')).toBeNull()
    expect(lerParDeCoordenadas('-23.5 -46.6 10')).toBeNull()
    expect(lerParDeCoordenadas('-23,55')).toBeNull()
    expect(lerParDeCoordenadas('123456, 7890')).toBeNull()
    expect(lerParDeCoordenadas('-23.55 graus')).toBeNull()
    expect(lerParDeCoordenadas('')).toBeNull()
  })
})

describe('a medição pelo aparelho', () => {
  const leitura = (precisaoMetros: number | null, latitude = LOCAL.latitude) => ({
    latitude,
    longitude: LOCAL.longitude,
    precisaoMetros,
  })

  it('fica com a leitura de menor erro declarado', () => {
    const melhor = escolherMelhorLeitura([leitura(850), leitura(12, -23.5505), leitura(40)])
    expect(melhor?.precisaoMetros).toBe(12)
    expect(melhor?.latitude).toBe(-23.5505)
  })

  it('leitura sem precisão perde de qualquer uma com precisão', () => {
    expect(escolherMelhorLeitura([leitura(null), leitura(200)])?.precisaoMetros).toBe(200)
    expect(escolherMelhorLeitura([leitura(null)])?.precisaoMetros).toBeNull()
    expect(escolherMelhorLeitura([])).toBeNull()
  })

  it('empate fica com a mais nova (o GPS assentou mais)', () => {
    expect(escolherMelhorLeitura([leitura(8, -23.1), leitura(8, -23.2)])?.latitude).toBe(-23.2)
  })

  it(`aceita só com precisão de até ${PRECISAO_MAXIMA_DA_MEDICAO_METROS} m, e mostra a precisão real`, () => {
    const boa = avaliarLeitura(leitura(14.6), 5)
    expect(boa.aceita).toBe(true)
    expect(boa.texto).toMatch(/cerca de 15 m/)
    expect(boa.texto).toMatch(/a melhor de 5 leituras/)

    expect(avaliarLeitura(leitura(30), 1).aceita).toBe(true)

    const ruim = avaliarLeitura(leitura(31), 1)
    expect(ruim.aceita).toBe(false)
    expect(ruim.texto).toMatch(/cerca de 31 m/)
    expect(ruim.texto).toMatch(/a única leitura/)
  })

  it('leitura sem precisão não serve para medir o local', () => {
    expect(avaliarLeitura(leitura(null), 3).aceita).toBe(false)
    expect(avaliarLeitura(null, 0).aceita).toBe(false)
  })
})

describe('decidirGravacaoDoLocal — o botão de salvar', () => {
  const semAvisos = { avisos: [], confirmouAvisos: false }

  it('precisão acima do limite não habilita salvar', () => {
    const captura = avaliarLeitura({ ...LOCAL, precisaoMetros: 120 }, 4)
    const decisao = decidirGravacaoDoLocal({ captura, ...semAvisos })
    expect(decisao.pode).toBe(false)
    expect(decisao.motivo).toMatch(/120 m/)
  })

  it('captura boa, ou campos digitados à mão, habilitam', () => {
    const captura = avaliarLeitura({ ...LOCAL, precisaoMetros: 9 }, 4)
    expect(decidirGravacaoDoLocal({ captura, ...semAvisos }).pode).toBe(true)
    expect(decidirGravacaoDoLocal({ captura: null, ...semAvisos }).pode).toBe(true)
  })

  it('latitude e longitude trocadas não salvam sem a confirmação explícita', () => {
    const avisos = conferirCoordenada(LOCAL.longitude, LOCAL.latitude)
    expect(decidirGravacaoDoLocal({ captura: null, avisos, confirmouAvisos: false }).pode).toBe(false)
    expect(decidirGravacaoDoLocal({ captura: null, avisos, confirmouAvisos: true }).pode).toBe(true)
  })

  it('a confirmação do aviso não libera uma captura ruim', () => {
    const captura = avaliarLeitura({ ...LOCAL, precisaoMetros: 500 }, 2)
    const avisos = conferirCoordenada(0, 0)
    expect(decidirGravacaoDoLocal({ captura, avisos, confirmouAvisos: true }).pode).toBe(false)
  })
})

describe('resumirLocalizacoes — a porcentagem de batidas "fora"', () => {
  const na: LocalizacaoDaBatida = { distancia_metros: 6, no_local: true, precisao_metros: 12 }
  const fora: LocalizacaoDaBatida = { distancia_metros: 2601, no_local: false, precisao_metros: 15 }
  const imprecisa: LocalizacaoDaBatida = { distancia_metros: 900, no_local: false, precisao_metros: 1500 }
  const semLocal: LocalizacaoDaBatida = { distancia_metros: null, no_local: null, precisao_metros: null }

  it('conta só as confiáveis na porcentagem', () => {
    const resumo = resumirLocalizacoes([na, na, na, fora, imprecisa, semLocal])
    expect(resumo).toMatchObject({ total: 6, noLocal: 3, fora: 1, imprecisas: 1, semLocalizacao: 1 })
    expect(resumo.porcentagemFora).toBe(0.25)
    expect(resumo.alerta).toBe(true)
  })

  it('20% exatos não alertam; acima disso, sim', () => {
    const vinte = resumirLocalizacoes([na, na, na, na, fora])
    expect(vinte.porcentagemFora).toBe(0.2)
    expect(vinte.alerta).toBe(false)
  })

  it('um mês inteiro com todas as batidas fora dá 100% — e alerta', () => {
    const resumo = resumirLocalizacoes(Array.from({ length: 348 }, () => fora))
    expect(resumo.porcentagemFora).toBe(1)
    expect(resumo.alerta).toBe(true)
  })

  it('poucas fora no meio de muitas dentro (17 de 348) arredondam para 5% e não alertam', () => {
    const resumo = resumirLocalizacoes([
      ...Array.from({ length: 331 }, () => na),
      ...Array.from({ length: 17 }, () => fora),
    ])
    expect(formatarPorcentagem(resumo.porcentagemFora ?? 0)).toBe('5%')
    expect(resumo.alerta).toBe(false)
  })

  /*
   * A batida sem localização: o GPS não respondeu. Conta à parte (`semGps`) e
   * fica fora da porcentagem — como a do admin, que segue em `semLocalizacao`.
   */
  it('a batida que saiu sem localização conta à parte e não entra na porcentagem de "fora"', () => {
    const semGps: LocalizacaoDaBatida = { ...semLocal, latitude: null, origem: 'app' }
    const doAdmin: LocalizacaoDaBatida = { ...semLocal, latitude: null, origem: 'ajuste_admin' }
    const resumo = resumirLocalizacoes([na, fora, semGps, semGps, doAdmin])
    expect(resumo).toMatchObject({ total: 5, noLocal: 1, fora: 1, semGps: 2, semLocalizacao: 1 })
    expect(resumo.porcentagemFora).toBe(0.5)
    // Só sem localização: nenhuma confiável, porcentagem nula (e não 0% nem 100%).
    expect(resumirLocalizacoes([semGps, semGps]).porcentagemFora).toBeNull()
  })

  it('"2 sem localização" por pessoa, e nada quando não houve nenhuma', () => {
    expect(descreverSemLocalizacaoDaPessoa({ semGps: 2 })).toBe('2 sem localização')
    expect(descreverSemLocalizacaoDaPessoa({ semGps: 1 })).toBe('1 sem localização')
    expect(descreverSemLocalizacaoDaPessoa({ semGps: 0 })).toBeNull()
  })

  it('sem nenhuma batida confiável a porcentagem é nula, não 0%', () => {
    const resumo = resumirLocalizacoes([imprecisa, semLocal])
    expect(resumo.porcentagemFora).toBeNull()
    expect(resumo.alerta).toBe(false)
    expect(resumirLocalizacoes([]).porcentagemFora).toBeNull()
  })

  it('formata a porcentagem', () => {
    expect(formatarPorcentagem(0)).toBe('0%')
    expect(formatarPorcentagem(0.004)).toBe('menos de 1%')
    expect(formatarPorcentagem(0.2)).toBe('20%')
    expect(formatarPorcentagem(1)).toBe('100%')
  })
})

describe('descreverMedicao — quem mediu e quando', () => {
  it('avisa quando o local nunca foi medido', () => {
    const estado = descreverMedicao(null, null, null)
    expect(estado.tipo).toBe('nunca')
    expect(estado.texto).toMatch(/nunca foi medido/)
  })

  it('coordenada gravada sem sessão (direto no banco) é dita como tal', () => {
    const estado = descreverMedicao('2026-10-15T12:00:00.000000+00:00', null, null)
    expect(estado.tipo).toBe('sem_medicao_no_local')
    // 12:00 UTC = 09:00 no fuso de Brasília.
    expect(estado.texto).toMatch(/15\/10\/2026,? 09:00/)
    expect(estado.texto).toMatch(/sem medição feita no local/)
  })

  it('medição feita por alguém mostra quem e quando', () => {
    const estado = descreverMedicao('2026-10-20T12:05:00Z', 'b5c0c7a4-0000-4000-8000-000000000000', 'Pessoa Teste')
    expect(estado.tipo).toBe('medido')
    expect(estado.texto).toMatch(/20\/10\/2026,? 09:05 por Pessoa Teste/)
  })

  it('sem o nome da conta, não inventa um', () => {
    const estado = descreverMedicao('2026-10-20T12:05:00Z', 'b5c0c7a4-0000-4000-8000-000000000000', null)
    expect(estado.texto).toMatch(/conta que não está na lista do ponto/)
  })

  it('enquanto o nome é lido, não afirma que a conta não está na lista', () => {
    // `undefined` é o nome ainda chegando; `null`, a conta fora da lista.
    // Confundir os dois faria a tela dizer que a conta não aparece até a
    // resposta chegar.
    const estado = descreverMedicao('2026-10-20T12:05:00Z', 'b5c0c7a4-0000-4000-8000-000000000000', undefined)
    expect(estado.tipo).toBe('medido')
    expect(estado.texto).toMatch(/^Medido em 20\/10\/2026,? 09:05\.$/)
    expect(estado.texto).not.toMatch(/não está na lista/)
  })
})

describe('descreverForaDaPessoa — o indicador de "fora" no painel do mês', () => {
  const na: LocalizacaoDaBatida = { distancia_metros: 6, no_local: true, precisao_metros: 12 }
  const fora: LocalizacaoDaBatida = { distancia_metros: 2601, no_local: false, precisao_metros: 15 }
  const imprecisa: LocalizacaoDaBatida = { distancia_metros: 900, no_local: false, precisao_metros: 1500 }

  it('ninguém fora, nenhuma etiqueta', () => {
    expect(descreverForaDaPessoa(resumirLocalizacoes([na, na, imprecisa]))).toBeNull()
    expect(descreverForaDaPessoa(resumirLocalizacoes([]))).toBeNull()
  })

  it('poucas fora: etiqueta neutra, com o número e a porcentagem', () => {
    const etiqueta = descreverForaDaPessoa(resumirLocalizacoes([fora, ...Array(9).fill(na)]))
    expect(etiqueta).toEqual({ texto: '1 de 10 fora do local (10%)', alerta: false })
  })

  it('acima do limite, alerta — uma pessoa 100% fora salta aos olhos', () => {
    const etiqueta = descreverForaDaPessoa(resumirLocalizacoes(Array(40).fill(fora)))
    expect(etiqueta).toEqual({ texto: '40 de 40 fora do local (100%)', alerta: true })
  })

  it('a imprecisa não entra na conta, nem para mais nem para menos', () => {
    const etiqueta = descreverForaDaPessoa(resumirLocalizacoes([fora, na, na, na, na, imprecisa, imprecisa]))
    expect(etiqueta).toEqual({ texto: '1 de 5 fora do local (20%)', alerta: false })
  })
})

describe('os exemplos dos campos', () => {
  /*
   * O erro que estes testes evitam: um exemplo cinza com cara de coordenada de
   * verdade (um ponto conhecido da cidade, por exemplo) fica no lugar da medição
   * e ninguém percebe. Exemplo nenhum pode ficar a menos de 100 km do local nem
   * de um placeholder plausível, nem parecer valor salvo (começa por "ex.:").
   */
  const PLACEHOLDER_PLAUSIVEL = { latitude: -23.5614, longitude: -46.6559 }
  const numeroDo = (exemplo: string) => lerNumero(exemplo.replace(/^ex\.:\s*/, '')) as number

  it('dizem que são exemplo', () => {
    expect(EXEMPLOS_DOS_CAMPOS.latitude).toMatch(/^ex\.: /)
    expect(EXEMPLOS_DOS_CAMPOS.longitude).toMatch(/^ex\.: /)
  })

  it('ficam longe do local e do placeholder plausível', () => {
    const latitude = numeroDo(EXEMPLOS_DOS_CAMPOS.latitude)
    const longitude = numeroDo(EXEMPLOS_DOS_CAMPOS.longitude)
    for (const ponto of [LOCAL, PLACEHOLDER_PLAUSIVEL]) {
      // 1 grau ~ 111 km: longe o bastante em qualquer eixo.
      const longe = Math.abs(latitude - ponto.latitude) > 1 || Math.abs(longitude - ponto.longitude) > 1
      expect(longe).toBe(true)
    }
  })

  it('as frases de recusa do formulário também não usam essas coordenadas', () => {
    const leitura = validarLocal({ nome: 'x', latitude: 'a', longitude: 'b', raioMetros: '150' })
    const frases = leitura.ok ? '' : leitura.erros.join(' ')
    expect(frases).not.toMatch(/23,56|46,65|23,55|46,63/)
  })
})

describe('linkDoMapa', () => {
  it('usa ponto decimal na URL, sempre', () => {
    expect(linkDoMapa(LOCAL.latitude, LOCAL.longitude)).toBe(
      'https://www.google.com/maps?q=-23.55052,-46.633308',
    )
  })
})
