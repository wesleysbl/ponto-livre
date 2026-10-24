import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeftRight, Check, Crosshair, ExternalLink, MapPin, Save } from 'lucide-react'
import { Aviso, Botao, Campo, Painel as Cartao } from './ui'
import { lerLocalizacoesRecentes, salvarLocal } from '../lib/administracao'
import { lerNomeDaConta } from '../lib/admin'
import { lerNumero, validarLocal, type LocalDoPonto, type RascunhoDoLocal } from '../lib/configuracao'
import {
  DIAS_DO_RESUMO_DE_FORA,
  EXEMPLOS_DOS_CAMPOS,
  LIMITE_DE_ALERTA_FORA,
  PRECISAO_MAXIMA_DA_MEDICAO_METROS,
  avaliarLeitura,
  conferirCoordenada,
  decidirGravacaoDoLocal,
  descreverMedicao,
  formatarPorcentagem,
  lerParDeCoordenadas,
  linkDoMapa,
  resumirLocalizacoes,
  type AvaliacaoDaLeitura,
  type ResumoDeLocalizacoes,
} from '../lib/coordenada'
import { ErroDeLocalizacao, JANELA_DA_MEDICAO_MS, medirCoordenada } from '../lib/localizacao'

/*
 * O FORMULÁRIO DO LOCAL DE TRABALHO, À PROVA DE COORDENADA ERRADA.
 *
 * O ERRO QUE ELE EVITA: um local ativo com a coordenada errada (um número de
 * exemplo que ficou no lugar, o centro da cidade em vez do endereço, um par
 * trocado) não quebra nada à vista. O banco aceita, a batida grava, e TODA
 * batida sai "fora do local" sem ninguém perceber — dois números plausíveis na
 * tela não dizem que a medição nunca foi feita. Esta tela fecha cada porta por
 * onde isso passaria calado:
 *
 *   • QUEM MEDIU E QUANDO, lido do banco (`medido_em`/`medido_por`, carimbados
 *     por um gatilho), e "nunca foi medido" com todas as letras;
 *   • EXEMPLOS que dizem que são exemplo (`EXEMPLOS_DOS_CAMPOS`);
 *   • O LINK DO MAPA para conferir com o olho onde o ponto cai;
 *   • A PORCENTAGEM DE "FORA" dos últimos 30 dias, com alerta acima de 20% —
 *     100% por semanas a fio é o sinal que ninguém olharia;
 *   • A MEDIÇÃO COM VÁRIAS LEITURAS (`medirCoordenada`), aceita só com precisão
 *     de até 30 m, mostrando a precisão real — e salvar fica desabilitado
 *     enquanto a leitura nos campos for pior que isso;
 *   • O AVISO DE COORDENADA TROCADA, sem sinal ou fora do Brasil, que o banco
 *     aceitaria (uma latitude de -46,63 é válida no planeta) — salvar pede
 *     confirmação explícita.
 *
 * As regras moram em `lib/coordenada.ts`, puras e testadas. Aqui só há estado
 * de tela e ida e volta com o banco.
 *
 * MORA EM ARQUIVO PRÓPRIO, e não dentro de `pages/Administracao.tsx`: o
 * formulário é grande o bastante para ser um assunto só dele — como
 * `ListaDePessoas`.
 *
 * ⚠ SÓ O CELULAR DENTRO DO LOCAL MEDE CERTO. Um notebook em casa mediria a
 * casa. O formulário foi conferido em 320 px: o botão de medir tem alvo de 44 px
 * e os dois números ficam legíveis inteiros depois de preenchidos.
 */

/** Título de seção, no mesmo tom das outras telas do app. */
function Secao({ icone, titulo, descricao }: { icone: ReactNode; titulo: string; descricao: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-2 text-luz">
        {icone}
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-plat">{titulo}</h2>
        <p className="mt-0.5 text-[0.7rem] leading-relaxed text-mute">{descricao}</p>
      </div>
    </div>
  )
}

/** Extrai a frase de uma falha qualquer, sem deixar `[object Object]` na tela. */
function fraseDe(falha: unknown, padrao: string): string {
  return falha instanceof Error ? falha.message : padrao
}

/** `-23.550520` -> `-23,55052`, como o funcionário lê. */
function grau(valor: number): string {
  return String(valor).replace('.', ',')
}

function rascunhoDoLocal(local: LocalDoPonto | null): RascunhoDoLocal {
  return {
    nome: local?.nome ?? 'Local de trabalho',
    // `String(número)` e não `toFixed`: arredondar aqui mudaria a coordenada
    // gravada sem ninguém pedir. O que está no banco é o que aparece no campo.
    latitude: local ? String(local.latitude) : '',
    longitude: local ? String(local.longitude) : '',
    raioMetros: String(local?.raioMetros ?? 150),
  }
}

export type ResumoNaTela =
  | { estado: 'carregando' }
  | { estado: 'pronto'; resumo: ResumoDeLocalizacoes }
  | { estado: 'erro'; frase: string }

/* ------------------------------------------------------------------ */
/* Quantas batidas saíram "fora"                                       */
/* ------------------------------------------------------------------ */

export function ResumoDeFora({ resumo }: { resumo: ResumoNaTela }) {
  if (resumo.estado === 'carregando') {
    return (
      <p className="text-[0.7rem] text-faint">
        Contando as batidas dos últimos {DIAS_DO_RESUMO_DE_FORA} dias…
      </p>
    )
  }
  if (resumo.estado === 'erro') {
    return (
      <p className="text-[0.7rem] text-faint">
        Não deu para contar as batidas "fora" dos últimos {DIAS_DO_RESUMO_DE_FORA} dias: {resumo.frase}
      </p>
    )
  }

  const { fora, noLocal, imprecisas, porcentagemFora, alerta } = resumo.resumo
  const confiaveis = fora + noLocal
  if (porcentagemFora === null) {
    return (
      <p className="text-[0.7rem] leading-relaxed text-faint">
        Nenhuma batida com localização confiável nos últimos {DIAS_DO_RESUMO_DE_FORA} dias — ainda não
        há como conferir a coordenada pelas batidas.
      </p>
    )
  }

  const frase = `Nos últimos ${DIAS_DO_RESUMO_DE_FORA} dias, ${fora} de ${confiaveis} ${confiaveis === 1 ? 'batida' : 'batidas'} com localização confiável ${fora === 1 ? 'saiu' : 'saíram'} "fora do local" (${formatarPorcentagem(porcentagemFora)}).`
  const imprecisasTexto =
    imprecisas > 0
      ? ` ${imprecisas} ${imprecisas === 1 ? 'outra teve' : 'outras tiveram'} localização imprecisa e não ${imprecisas === 1 ? 'entra' : 'entram'} na conta.`
      : ''

  if (alerta) {
    return (
      <Aviso tom="atencao">
        <span className="inline-flex items-start gap-1.5">
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            {frase} Acima de {formatarPorcentagem(LIMITE_DE_ALERTA_FORA)}, desconfie da coordenada: se
            as pessoas estavam dentro do local, o ponto ou o raio estão errados. Confira no mapa e
            meça de novo, de dentro do local.{imprecisasTexto}
          </span>
        </span>
      </Aviso>
    )
  }
  return (
    <p className="text-[0.7rem] leading-relaxed text-mute">
      {frase}
      {imprecisasTexto}
    </p>
  )
}

/* ------------------------------------------------------------------ */
/* O formulário                                                        */
/* ------------------------------------------------------------------ */

export function FormularioDoLocal({
  inicial,
  aoSalvar,
}: {
  inicial: LocalDoPonto | null
  /** Para o cartão do local, na página inicial da administração, mostrar o que foi gravado. */
  aoSalvar?: (local: LocalDoPonto) => void
}) {
  const [gravado, setGravado] = useState<LocalDoPonto | null>(inicial)
  const [rascunho, setRascunho] = useState<RascunhoDoLocal>(() => rascunhoDoLocal(inicial))
  const [erros, setErros] = useState<string[]>([])
  const [salvo, setSalvo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const [medindo, setMedindo] = useState(false)
  const [progresso, setProgresso] = useState<{ leituras: number; precisaoMetros: number | null } | null>(null)
  /** A medição que preencheu os campos — some quando a pessoa digita neles. */
  const [captura, setCaptura] = useState<AvaliacaoDaLeitura | null>(null)
  const [falhaDaMedicao, setFalhaDaMedicao] = useState<string | null>(null)
  const [confirmouAvisos, setConfirmouAvisos] = useState(false)

  /** Nome de quem mediu, por conta. Guardado por id para nunca mostrar o nome de outra. */
  const [nomes, setNomes] = useState<Record<string, string | null>>({})
  const [resumo, setResumo] = useState<ResumoNaTela>({ estado: 'carregando' })

  const medidoPor = gravado?.medidoPor ?? null

  useEffect(() => {
    if (!medidoPor) return
    let vivo = true
    void lerNomeDaConta(medidoPor).then((nome) => {
      if (vivo) setNomes((antes) => ({ ...antes, [medidoPor]: nome }))
    })
    return () => {
      vivo = false
    }
  }, [medidoPor])

  useEffect(() => {
    let vivo = true
    lerLocalizacoesRecentes(DIAS_DO_RESUMO_DE_FORA)
      .then((batidas) => {
        if (vivo) setResumo({ estado: 'pronto', resumo: resumirLocalizacoes(batidas) })
      })
      .catch((falha: unknown) => {
        if (vivo) setResumo({ estado: 'erro', frase: fraseDe(falha, 'erro desconhecido.') })
      })
    return () => {
      vivo = false
    }
  }, [])

  const latitude = lerNumero(rascunho.latitude)
  const longitude = lerNumero(rascunho.longitude)
  const avisos = latitude !== null && longitude !== null ? conferirCoordenada(latitude, longitude) : []
  const decisao = decidirGravacaoDoLocal({ captura, avisos, confirmouAvisos })
  const medicao = descreverMedicao(
    gravado?.medidoEm ?? null,
    medidoPor,
    // Indefinido enquanto o nome não voltou: a frase espera, em vez de dizer
    // "fora da lista" de uma conta que ninguém perguntou ainda.
    medidoPor ? (medidoPor in nomes ? nomes[medidoPor] : undefined) : null,
  )
  const mapa =
    latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
      ? linkDoMapa(latitude, longitude)
      : null

  function mudar(campo: keyof RascunhoDoLocal, valor: string) {
    setSalvo(null)
    if (campo === 'latitude' || campo === 'longitude') {
      // Digitar na coordenada é decisão consciente: a medição sai do caminho, e
      // a confirmação de um aviso antigo não vale para o número novo.
      setCaptura(null)
      setConfirmouAvisos(false)
      // O par colado do Google Maps num campo só preenche os dois.
      const par = lerParDeCoordenadas(valor)
      if (par) {
        setRascunho((antes) => ({
          ...antes,
          latitude: String(par.latitude),
          longitude: String(par.longitude),
        }))
        return
      }
    }
    setRascunho((antes) => ({ ...antes, [campo]: valor }))
  }

  function usarSugestao(sugestao: { latitude: number; longitude: number }) {
    setRascunho((antes) => ({
      ...antes,
      latitude: String(sugestao.latitude),
      longitude: String(sugestao.longitude),
    }))
    setConfirmouAvisos(false)
    setSalvo(null)
  }

  /*
   * MEDIR, E NÃO SÓ PEDIR UMA LEITURA.
   *
   * Até 20 segundos de leituras, fica a de menor erro, e ela só vale se o erro
   * for de até 30 m (`avaliarLeitura`). A leitura ruim TAMBÉM preenche os campos
   * — a pessoa vê o que o aparelho mediu —, mas salvar fica desabilitado até
   * medir de novo ou digitar à mão.
   *
   * ELA PREENCHE OS CAMPOS, NÃO SALVA. Medir e gravar são duas decisões: quem
   * mediu na calçada ainda pode olhar o número, abrir o mapa e desistir.
   *
   * LOCALIZAÇÃO NEGADA NÃO TRAVA NADA: os campos continuam editáveis à mão e a
   * tela diz o motivo.
   */
  async function medirDoAparelho() {
    setMedindo(true)
    setProgresso(null)
    setCaptura(null)
    setFalhaDaMedicao(null)
    setSalvo(null)
    try {
      const { melhor, leituras } = await medirCoordenada({
        aoLer: (atual, quantas) => setProgresso({ leituras: quantas, precisaoMetros: atual.precisaoMetros }),
      })
      setRascunho((antes) => ({
        ...antes,
        latitude: String(melhor.latitude),
        longitude: String(melhor.longitude),
      }))
      setCaptura(avaliarLeitura(melhor, leituras))
      setConfirmouAvisos(false)
      // A medição apaga as recusas anteriores: uma recusa velha
      // sobre um campo que acabou de ser preenchido é pior que uma que volta no
      // próximo "Salvar".
      setErros([])
    } catch (falha) {
      const comoResolver = falha instanceof ErroDeLocalizacao ? falha.comoResolver : null
      setFalhaDaMedicao(
        [fraseDe(falha, 'Não deu para obter sua localização agora.'), comoResolver, 'Os campos continuam editáveis à mão.']
          .filter(Boolean)
          .join(' '),
      )
    } finally {
      setMedindo(false)
      setProgresso(null)
    }
  }

  async function gravar() {
    if (!decisao.pode) return
    const leitura = validarLocal(rascunho)
    if (!leitura.ok) {
      setErros(leitura.erros)
      setSalvo(null)
      return
    }

    setErros([])
    setSalvando(true)
    try {
      const novo = await salvarLocal(gravado?.id ?? null, leitura.valor)
      setGravado(novo)
      aoSalvar?.(novo)
      // Repõe com o que o banco gravou (o caso de borda das duas abas).
      setRascunho(rascunhoDoLocal(novo))
      setCaptura(null)
      setConfirmouAvisos(false)
      setSalvo(`Local salvo: ${novo.nome}, raio de ${novo.raioMetros} m.`)
    } catch (falha) {
      setErros([fraseDe(falha, 'Não deu para salvar o local.')])
      setSalvo(null)
    } finally {
      setSalvando(false)
    }
  }

  const aviso = avisos[0] ?? null
  const segundos = Math.round(JANELA_DA_MEDICAO_MS / 1000)

  return (
    <Cartao>
      <Secao
        icone={<MapPin size={16} aria-hidden="true" />}
        titulo="Local de trabalho"
        descricao="A coordenada e o raio que decidem se uma batida nasce dentro ou fora. Mexer aqui não muda batida antiga: cada uma guarda a distância calculada quando foi gravada."
      />

      <div className="space-y-3">
        <Aviso tom={medicao.tipo === 'nunca' ? 'atencao' : medicao.tipo === 'medido' ? 'bom' : 'neutro'}>
          {medicao.texto}
        </Aviso>

        <ResumoDeFora resumo={resumo} />

        <Campo
          id="local-nome"
          rotulo="Nome do local"
          value={rascunho.nome}
          onChange={(evento) => mudar('nome', evento.target.value)}
          placeholder="Ex.: Escritório central"
        />

        {/*
          Latitude e longitude são um PAR. Em 320 px, com a fonte de 16 px que o
          iOS exige nos campos, `-46.633308` mais o padding não cabe em meia
          linha sem cortar o último dígito — e é o número que a pessoa precisa
          conferir. Par a partir de 20rem de caixa, empilhado abaixo disso.
        */}
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 @min-[20rem]:grid-cols-2">
            <Campo
              id="local-latitude"
              rotulo="Latitude"
              inputMode="decimal"
              value={rascunho.latitude}
              onChange={(evento) => mudar('latitude', evento.target.value)}
              placeholder={EXEMPLOS_DOS_CAMPOS.latitude}
            />
            <Campo
              id="local-longitude"
              rotulo="Longitude"
              inputMode="decimal"
              value={rascunho.longitude}
              onChange={(evento) => mudar('longitude', evento.target.value)}
              placeholder={EXEMPLOS_DOS_CAMPOS.longitude}
            />
          </div>
        </div>
        <p className="text-[0.68rem] leading-relaxed text-faint">
          Graus decimais, com vírgula ou ponto. Dá para colar o par copiado do mapa ("-23.55…,
          -46.63…") num campo só.
        </p>

        {mapa && (
          <a
            href={mapa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-luz hover:underline"
          >
            <ExternalLink size={14} aria-hidden="true" />
            Conferir este ponto no mapa
          </a>
        )}

        {aviso && (
          <div className="space-y-2">
            <Aviso tom="atencao">
              <span className="inline-flex items-start gap-1.5">
                <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{aviso.texto}</span>
              </span>
            </Aviso>
            {aviso.sugestao && (
              <Botao tom="secundario" onClick={() => aviso.sugestao && usarSugestao(aviso.sugestao)}>
                <ArrowLeftRight size={16} aria-hidden="true" />
                Usar {grau(aviso.sugestao.latitude)} e {grau(aviso.sugestao.longitude)}
              </Botao>
            )}
            <label className="flex min-h-11 items-center gap-2 text-xs text-plat-dim">
              <input
                type="checkbox"
                checked={confirmouAvisos}
                onChange={(evento) => setConfirmouAvisos(evento.target.checked)}
                className="h-4 w-4 accent-luz"
              />
              A coordenada está certa mesmo assim
            </label>
          </div>
        )}

        <Campo
          id="local-raio"
          rotulo="Raio, em metros"
          inputMode="numeric"
          value={rascunho.raioMetros}
          onChange={(evento) => mudar('raioMetros', evento.target.value)}
          placeholder="150"
        />

        <Botao tom="secundario" onClick={() => void medirDoAparelho()} disabled={medindo}>
          <Crosshair size={16} aria-hidden="true" />
          {medindo
            ? progresso
              ? `Medindo… ${progresso.leituras} ${progresso.leituras === 1 ? 'leitura' : 'leituras'}, melhor ±${progresso.precisaoMetros === null ? '?' : Math.round(progresso.precisaoMetros)} m`
              : 'Medindo…'
            : 'Usar a localização deste aparelho'}
        </Botao>
        <p className="text-[0.68rem] leading-relaxed text-faint">
          Meça de dentro do local, pelo celular, parado: o aparelho é observado por até {segundos}{' '}
          segundos e só vale leitura com precisão de até {PRECISAO_MAXIMA_DA_MEDICAO_METROS} m. O botão
          só preenche os campos — conferir e salvar continua sendo com você.
        </p>

        {captura && <Aviso tom={captura.aceita ? 'bom' : 'atencao'}>{captura.texto}</Aviso>}
        {falhaDaMedicao && <Aviso tom="atencao">{falhaDaMedicao}</Aviso>}

        {erros.length > 0 && (
          <Aviso tom="erro">
            {erros.length === 1 ? (
              erros[0]
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                {erros.map((frase) => (
                  <li key={frase}>{frase}</li>
                ))}
              </ul>
            )}
          </Aviso>
        )}
        {salvo && (
          <Aviso tom="bom">
            <span className="inline-flex items-center gap-1.5">
              <Check size={14} aria-hidden="true" />
              {salvo}
            </span>
          </Aviso>
        )}

        {!decisao.pode && decisao.motivo !== captura?.texto && (
          <p className="text-[0.68rem] leading-relaxed text-warn">{decisao.motivo}</p>
        )}

        <Botao onClick={() => void gravar()} disabled={salvando || medindo || !decisao.pode}>
          <Save size={16} aria-hidden="true" />
          {salvando ? 'Salvando…' : 'Salvar o local'}
        </Botao>
      </div>
    </Cartao>
  )
}
