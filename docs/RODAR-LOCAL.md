# Rodar no seu computador

[Voltar ao README](../README.md)

Para testar, mexer no código ou tirar os prints. Tudo roda na sua máquina: o app no Vite e o Supabase inteiro (banco, login, arquivos e a função de contas) em contêineres, pelo Supabase CLI. Nada aqui fala com a nuvem.

Para pôr o ponto no ar para uma empresa, o caminho é outro: [INSTALAR.md](INSTALAR.md).

## Requisitos

| O quê | Para quê |
| --- | --- |
| **Node 22.12 ou mais** (o `.nvmrc` pede 22) | o app, o build e os testes. Os testes de tela usam o jsdom, que não roda em Node mais velho. |
| **Docker**: Docker Desktop, OrbStack ou Colima | o Supabase local. No Colima, dê memória de sobra: `colima start --cpu 4 --memory 6` funciona bem. |
| **Google Chrome** | só para `npm run e2e`, que dirige o Chrome da máquina |
| **Git** | baixar o código |

O Supabase CLI não precisa ser instalado à parte: ele vem nas dependências do projeto (`npx supabase`).

## 1. Baixar e instalar

```bash
git clone <endereço deste repositório>
cd ponto-livre
npm ci
```

## 2. Subir o Supabase local

Com o Docker ligado:

```bash
npm run db:iniciar
```

Na primeira vez, o CLI baixa as imagens e leva alguns minutos. Ele cria o banco e aplica a estrutura do ponto ([`supabase/migrations/`](../supabase/migrations/)) sozinho. No fim, mostra os endereços:

| Serviço | Endereço |
| --- | --- |
| API (login, banco, arquivos e funções) | `http://127.0.0.1:54321` |
| Studio (o painel do Supabase local) | `http://127.0.0.1:54323` |

A configuração local está em [`supabase/config.toml`](../supabase/config.toml): cadastro aberto desligado, senha mínima de 8 e PostgreSQL 17, como na nuvem. A função de contas `ponto-contas` já sobe junto.

## 3. Montar o `.env`

```bash
cp .env.example .env
npx supabase status -o env
```

O segundo comando mostra as variáveis do Supabase local. Copie duas para o `.env`:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<o valor de PUBLISHABLE_KEY>
VITE_NOME_DO_APP=
VITE_SLOGAN_DO_APP=
```

Nunca ponha a `SERVICE_ROLE_KEY` (nem a `SECRET_KEY`) numa variável `VITE_`: tudo o que começa com `VITE_` vai escrito no JavaScript que o navegador baixa. O `.env` não vai para o git.

## 4. Rodar o app

```bash
npm run dev
```

Abra `http://localhost:5173`. Sem o primeiro super admin, ninguém entra: veja o próximo passo.

O servidor de desenvolvimento só escuta na própria máquina (`localhost`), de propósito: ele não é feito para ficar exposto na rede. Para abrir no celular pela rede local, peça na hora, com `npm run dev -- --host`, e abra o IP do computador no celular. Serve para conferir o layout, mas não a batida: câmera e GPS só funcionam em contexto seguro, e o `localhost` conta, mas o IP da rede, em `http`, não. Para testar a batida no celular de verdade, publique com HTTPS.

## 5. O primeiro super admin local

Pelo Studio, em `http://127.0.0.1:54323`:

1. **Authentication › Users › Add user › Create new user**: um e-mail (por exemplo, `voce@example.com`) e uma senha, com **Auto Confirm User** marcado.
2. **SQL Editor**: cole o arquivo [`supabase/primeiro-super-admin.sql`](../supabase/primeiro-super-admin.sql), troque o e-mail na linha marcada com `TROQUE AQUI` e clique em **Run**.

Ou, criada a conta, pelo terminal (troque o e-mail no arquivo antes):

```bash
docker exec -i supabase_db_ponto-livre psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/primeiro-super-admin.sql
```

O nome do contêiner sai do `project_id` de `supabase/config.toml`.

Depois, entre no app com esse e-mail e siga o [cadastro](CADASTRO.md).

## 6. Dados de demonstração

Para ver o app cheio, sem cadastrar nada à mão:

```bash
npm run demo:semear -- --zerar   # APAGA o banco local e semeia gente fictícia e um mês de batidas
npm run demo:prints              # os prints das telas e a capa, em docs/imagens/
```

Os dois só falam com o Supabase local (a semente recusa uma API que não seja de `127.0.0.1` ou `localhost`) e precisam do Google Chrome, que desenha as selfies e tira os prints. Sem o `--zerar`, a semente só roda num banco que ainda não tem as contas da demonstração.

A semente cria a Empresa Exemplo Ltda, o local de trabalho e estas contas, todas com a mesma senha e o mesmo PIN de demonstração:

| E-mail | Quem | Papel |
| --- | --- | --- |
| `admin@example.com` | Sérgio Almeida | super admin |
| `rh@example.com` | Rita Moraes | RH: administra o ponto e não bate |
| `ana@example.com`, `bruna@example.com`, `caio@example.com`, `daniela@example.com`, `gustavo@example.com` | Ana Beatriz Rocha, Bruna Costa, Caio Mendes, Daniela Freitas e Gustavo Ramos | batem ponto |

| Senha | PIN |
| --- | --- |
| `demo-ponto-2026` | `1234` |

A senha e o PIN são públicos de propósito e valem só para este banco local: nunca os use num ponto de verdade.

O mês de batidas são os dias úteis do mês corrente até ontem (no começo do mês, o mês anterior inteiro), com os casos que as telas mostram: uma batida sem localização, batidas fora do local, uma correção e uma inserção do RH com motivo, um dia incompleto, uma falta com atestado e um pedido de batida esquecida esperando decisão. As pessoas, os e-mails (`example.com`), as selfies desenhadas e o atestado são todos fictícios. Como cada batida histórica entra no banco está explicado no cabeçalho de [`demo/semear.mjs`](../demo/semear.mjs).

O `npm run demo:prints` bate de verdade a entrada de hoje da Ana (o comprovante mostra o horário do servidor, na hora em que ele roda): para tirar os prints de novo, semeie de novo. Para prints com cara de dia de trabalho, rode os dois num dia útil, em horário comercial.

## Os testes

| Comando | O que faz | Precisa de |
| --- | --- | --- |
| `npm test` | os testes do Vitest: regras, telas, a função de contas contra um Supabase simulado, o teste de fumaça das rotas e os testes estáticos da migration | nada (sem rede e sem banco) |
| `npm run test:fumaca` | só o teste de fumaça: o app inteiro montado num navegador simulado, rota por rota | nada |
| `npm run lint` | o ESLint | nada |
| `npm run db:testar` | os 8 arquivos de [`supabase/testes/`](../supabase/testes/), cada um numa transação desfeita no fim, e a conferência de que nada ficou gravado | o Supabase local de pé |
| `npm run db:testar -- blindagem.sql` | só os arquivos citados | o Supabase local de pé |
| `npm run e2e` | de ponta a ponta no Chrome, em dois projetos: o `app` passa pelo cadastro inteiro, da instalação vazia à primeira batida, e pela função de contas pelo caminho real; o `csp` faz o build de produção e abre o app inteiro sob a política de conteúdo, sem nenhuma recusa no console | o Supabase local e o Chrome |
| `PRINTS=1 npm run e2e` | o mesmo, gravando um print por passo em [`docs/imagens/cadastro/`](imagens/cadastro/) | idem |
| `npm run build` e `npm run preview` | o build de produção, servido em `http://localhost:4173` como vai para o ar: com a política de conteúdo (a meta no HTML e os cabeçalhos do `dist/_headers`, como no Cloudflare Pages e no Netlify) e com o service worker, que só liga aqui | nada |

Detalhes que ajudam:

- O `npm run e2e` sobe o app sozinho, de dois jeitos, cada um numa porta só dele: o servidor de desenvolvimento na 5180 (o projeto `app`) e o build de produção, servido pelo `vite preview`, na 5181 (o projeto `csp`, que só roda o `e2e/csp.spec.ts`; esse build vai para a pasta temporária do sistema, e não para `dist/`). Os dois apontam para o Supabase local, com a câmera e o GPS simulados. O teste cria contas e batidas no banco local a cada execução, com uma marca no e-mail, e não grava nada na pasta do projeto. Para usar o Edge ou outro navegador da família do Chrome: `PLAYWRIGHT_CHANNEL=msedge npm run e2e`.
- O `npm run dev` roda sem a política de conteúdo (a recarga a quente do Vite precisa de script em linha). Mexeu na política ([`src/lib/politica-de-conteudo.ts`](../src/lib/politica-de-conteudo.ts)), no `index.html` ou no `vite.config.ts`? Rode o `npm run e2e`: é o projeto `csp` que confere o app sob a política, no navegador.
- Antes de `PRINTS=1 npm run e2e`, rode `npm run db:zerar`: com o banco de execuções anteriores, as listas mostram as pessoas delas também.
- A contagem de testes escrita no README é conferida por `node scripts/conferir-readme.mjs`, também no CI. Teste novo, linha nova.

## Parar e recomeçar

```bash
npm run db:parar   # desliga o Supabase local (os dados ficam)
npm run db:zerar   # recria o banco do zero e reaplica a estrutura (apaga os dados locais)
```

## Se der problema

| O que aparece | O que fazer |
| --- | --- |
| `npm test` falha com `ERR_REQUIRE_ESM` vindo do jsdom | O Node é mais velho que 22.12. Atualize (`node --version`). |
| `npm run db:testar` diz que o banco não está de pé | Ligue o Docker e rode `npm run db:iniciar`. |
| "a estrutura do ponto não está aplicada" | Rode `npm run db:zerar`. |
| O app fica em "Não foi possível carregar o app" | Falta o `.env`, ou ele está com a URL ou a chave erradas. Reinicie o `npm run dev` depois de mudar. |
| "Seu acesso ao ponto não está liberado" | Falta o passo 5, ou ele rodou com outro e-mail. |
| Porta ocupada | O Supabase local usa as portas 54321 a 54324; o app, 5173 (4173 no `npm run preview`, e 5180 e 5181 no `npm run e2e`). Feche o que estiver nelas, ou `npm run db:parar` e de novo `npm run db:iniciar`. |

Para mudar o banco, leia [BANCO.md](BANCO.md#como-mudar-a-estrutura). Para contribuir, [CONTRIBUTING.md](../CONTRIBUTING.md).
