# Prompt: miniaturas das selfies no painel

Este ajuste já está no Ponto Livre. Se a sua instalação segue o projeto sem mudanças, basta atualizar o código e publicar de novo: não há migration nova.

O prompt abaixo é para quem mantém **uma cópia modificada** e prefere que um agente de código (Claude Code, Cursor, Codex...) aplique o mesmo ajuste nela. Abra o agente na pasta do seu projeto, cole o texto do bloco e revise o que ele mudar antes de publicar.

## O que muda

Nos dias de uma pessoa, no painel, cada batida tinha um botão com o ícone da câmera para abrir a selfie. Agora o botão mostra a própria selfie em miniatura. O clique continua abrindo a foto grande, e a câmera volta sempre que a miniatura não puder ser mostrada.

## O prompt

```text
Quero aplicar no meu projeto (uma cópia modificada do Ponto Livre) o ajuste
"miniaturas das selfies no painel". Leia o código antes de mudar e siga o
estilo dele: português no código, nos testes e nas telas, e comentário que
explica o porquê.

OBJETIVO
No painel, nos dias de uma pessoa (o componente DiaDoPainel, em
src/components/DiaDoPainel.tsx), o botão "Ver a selfie das HH:MM" de cada
batida mostra só o ícone da câmera. Troque o ícone pela miniatura da própria
selfie, no mesmo quadrado de 44 px, com object-cover. O clique continua
abrindo o visor grande (VisorDeSelfie), como hoje.

REGRAS QUE NÃO PODEM MUDAR
- O bucket das selfies (ponto-selfies) continua privado. Nada de bucket
  público nem de URL fixa: a miniatura usa URL assinada, com a mesma validade
  de SEGUNDOS_DE_VALIDADE_DA_SELFIE (2 minutos), em src/lib/batidas.ts.
- Quem decide quem vê é a policy do storage, não a tela. Não acrescente
  checagem de dono no cliente.
- Sem migration e sem mudança no banco.

COMO FAZER
1. Em src/lib/batidas.ts, ao lado de urlAssinadaDaSelfie, crie
   urlsAssinadasDasSelfies(caminhos: readonly string[]):
   Promise<Map<string, string>>. Ela assina a lista inteira num pedido só,
   com supabase.storage.from(BUCKET).createSignedUrls(caminhos,
   SEGUNDOS_DE_VALIDADE_DA_SELFIE), e devolve um mapa caminho -> URL. Item
   que volta com erro (foto que a pessoa não pode ver) fica de fora do mapa;
   só a falha do pedido inteiro vira ErroDeBatida. Lista vazia não chama o
   storage.
2. Crie o hook src/hooks/useMiniaturasDoDia.ts:
   useMiniaturasDoDia(alvo: RefObject<Element | null>, caminhos: readonly
   string[]): ReadonlyMap<string, string>.
   - Só assina quando o dia chega perto da tela: IntersectionObserver no
     elemento do dia, com rootMargin '200px 0px'. Na primeira interseção,
     desliga o observador e assina as fotos do dia de uma vez. Assim os links
     de 2 minutos não vencem antes de a pessoa rolar até o dia, e o mês não
     baixa fotos que ninguém olhou.
   - Sem IntersectionObserver no navegador, assina na hora.
   - Guarde no estado o mapa junto com a chave dos caminhos que ele assinou
     (os caminhos unidos por '\n') e devolva um mapa vazio quando a chave
     atual for outra. Isso evita zerar estado dentro do efeito (a regra
     react-hooks/set-state-in-effect recusa).
   - Falha na assinatura não aparece para ninguém: fica a câmera.
   - Limpe o observador e ignore respostas que chegarem depois da
     desmontagem.
3. No DiaDoPainel: useRef no <li> do dia, chame o hook com os selfie_path
   não nulos das batidas do dia e troque o botão da foto por um componente
   BotaoDaSelfie, no mesmo arquivo, que recebe a batida, a URL da miniatura
   (opcional) e o aoAbrir.
   - Com URL: <img src={url} alt="" decoding="async"
     className="h-full w-full object-cover">. O alt fica vazio porque o nome
     para o leitor de tela já é o aria-label do botão ("Ver a selfie das
     08:00"), que não muda.
   - Sem URL: o ícone Camera de antes.
   - No onError da imagem (link vencido, por exemplo), guarde a URL como
     quebrada e volte à câmera. Nunca mostre quadrado quebrado.
   - Ponha overflow-hidden no botão para a foto respeitar a borda arredondada.
   - A batida inserida pelo admin (sem selfie) continua como está: o quadrado
     tracejado com o ícone CameraOff.
4. Se o seu projeto define img-src na política de conteúdo
   (src/lib/politica-de-conteudo.ts), confira que a origem do Supabase já
   está lá. No Ponto Livre ela já está, porque o visor usa a mesma URL.

TESTES
- Um arquivo novo de teste com "// @vitest-environment jsdom" na primeira
  linha, o Supabase simulado (storage.from(...).createSignedUrls) e um
  IntersectionObserver simulado. Prove que:
  - urlsAssinadasDasSelfies assina tudo num pedido só, no bucket certo, com
    120 segundos; deixa de fora o item recusado; não chama o storage com
    lista vazia; e transforma a falha do pedido em ErroDeBatida;
  - antes de o dia aparecer não há pedido nem <img>;
  - quando o dia aparece há um pedido só, sem a batida inserida pelo admin, e
    cada miniatura fica dentro do botão certo, com alt vazio;
  - o clique na miniatura abre o visor da batida certa;
  - o dia não assina de novo se voltar a aparecer;
  - foto recusada, falha de rede e onError da imagem deixam a câmera, sem
    erro no console;
  - sem IntersectionObserver, assina na hora.
- No teste de fumaça (src/fumaca-das-rotas.test.ts), acrescente
  createSignedUrls ao storage simulado (o jsdom não tem IntersectionObserver,
  então o dia assina na hora) e um caso que abre /painel/<pessoa> e encontra
  a <img> dentro do botão "Ver a selfie das ...".
- No e2e (e2e/csp.spec.ts), no passo em que o painel abre a selfie, confira
  antes do clique que a <img> do botão carregou de uma URL assinada do
  storage.

DOCUMENTAÇÃO
- docs/MANUAL.md, em "Os dias de uma pessoa": a batida mostra a miniatura da
  selfie, e a câmera aparece enquanto ela não carrega.
- CHANGELOG.md, na seção "Não lançado".
- A linha do "npm test" no README: rode node scripts/conferir-readme.mjs e
  use a linha que ele indicar.

ANTES DE TERMINAR
Rode npm run lint, npm test, node scripts/conferir-readme.mjs e
npm run build. Se puder, rode também npm run e2e (precisa do Supabase local
e do Chrome). Me mostre o diff e o resultado de cada comando.
```

## Como conferir depois de publicar

1. Entre com uma conta que administra o ponto e abra o painel.
2. Toque no cartão de uma pessoa que bateu pelo app.
3. Cada batida do app mostra a selfie em miniatura ao lado de **Corrigir**. A batida inserida pelo admin continua com o quadrado tracejado, sem foto.
4. Toque numa miniatura: a foto grande abre, como antes.
