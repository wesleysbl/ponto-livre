# Instalar o Ponto Livre

[Voltar ao README](../README.md)

Este guia põe o ponto no ar para uma empresa: o banco, o login e as fotos ficam no **Supabase**, na nuvem, e o app fica numa **hospedagem de site estático** (Cloudflare Pages, Netlify ou Vercel). Não precisa de servidor próprio. Reserve cerca de uma hora.

Quer só experimentar no seu computador? Veja [RODAR-LOCAL.md](RODAR-LOCAL.md).

## O que você vai precisar

- Uma conta no [Supabase](https://supabase.com). O plano grátis serve para começar.
- Uma conta numa hospedagem de site estático: Cloudflare Pages, Netlify ou Vercel. As três têm plano grátis e dão HTTPS sozinhas.
- O Node 22.12 ou mais no computador. Confira com `node --version`.
- O código deste repositório. Um fork no GitHub é o melhor caminho, porque a hospedagem publica sozinha a cada mudança. Também serve o ZIP (botão **Code › Download ZIP**).
- No terminal, dentro da pasta do código, rode uma vez:

  ```bash
  npm ci
  ```

O Docker **não** é necessário para instalar na nuvem. Ele só entra nas [cópias de segurança](#cópias-de-segurança) e no Supabase local.

## O caminho, em sete passos e uma alternativa avançada (VPS)

| Passo | O quê | Onde |
| --- | --- | --- |
| [1](#1-criar-o-projeto-no-supabase) | Criar o projeto | painel do Supabase |
| [2](#2-fechar-as-portas-do-projeto) | Fechar as portas do projeto | painel do Supabase |
| [3](#3-aplicar-a-estrutura-do-banco) | Aplicar a estrutura do banco | terminal (ou SQL Editor) |
| [4](#4-publicar-a-função-de-contas) | Publicar a função de contas | terminal |
| [5](#5-criar-o-primeiro-super-admin) | Criar o primeiro super admin | painel do Supabase |
| [6](#6-publicar-o-app) | Publicar o app | hospedagem |
| [7](#7-primeiro-uso) | Configurar a empresa e cadastrar o time | o próprio app |
| [8](#8-vps-própria-avançado-sem-suporte) | (Avançado) Servidor próprio | a sua VPS |

> [!NOTE]
> **Os nomes do painel mudam.** O Supabase reorganiza os menus e troca os rótulos do painel de tempos em tempos. Os nomes deste guia são os que o painel mostrava, em inglês, e cada passo diz também o que a opção faz. Se um nome não bater, procure pelo assunto, na mesma área do painel, ou na [documentação do Supabase](https://supabase.com/docs).

## 1. Criar o projeto no Supabase

1. Entre em [supabase.com](https://supabase.com) e clique em **New project**.
2. Escolha a organização e dê um nome ao projeto, por exemplo `ponto`.
   Use **um projeto só para o ponto**. O ponto fecha o cadastro aberto do login e ajusta as permissões do banco para ele; outro app no mesmo projeto dividiria com ele as contas e essas regras.
3. Em **Database Password**, crie uma senha forte (o link **Generate a password** faz isso) e guarde num gerenciador de senhas. O terminal vai pedir essa senha no passo 3.
4. Em **Region**, escolha a mais perto do time. No Brasil: **South America (São Paulo)**.
5. O plano **Free** serve. Clique em **Create new project** e espere alguns minutos.
6. Anote o **Project ref**: é o código que aparece no endereço do painel (`supabase.com/dashboard/project/<ref>`) e na URL do projeto (`https://<ref>.supabase.co`).

> [!NOTE]
> **Três coisas do plano grátis.** O Supabase pausa o projeto grátis que passa uma semana com pouco uso (férias coletivas, por exemplo). Para voltar, abra o projeto no painel e clique em **Resume project**. O plano grátis não faz cópia de segurança automática: veja [Cópias de segurança](#cópias-de-segurança). E o espaço de arquivos dele é pequeno: 1 GB, pela [página de preços do Supabase](https://supabase.com/pricing) (confira lá o número atual). Cada selfie tem uns 100 kB, e um time de 25 pessoas gasta uns 200 MB por mês: o espaço acaba em uns cinco meses. Acompanhe o uso de **Storage** na página de uso da organização (**Usage**) e passe ao plano pago antes de encher.

## 2. Fechar as portas do projeto

O arquivo `supabase/config.toml` deste repositório só vale para o Supabase local. Na nuvem, estas escolhas se fazem à mão, no painel do projeto; a do cadastro aberto, **antes de criar a primeira conta**. Com o cadastro aberto, qualquer pessoa com o endereço do projeto poderia criar uma conta, até com o e-mail de quem vai ser o super admin. O endereço do app (**Site URL**) entra depois, no [passo 6.7](#67-volte-ao-supabase-o-endereço-do-app), quando o app já estiver publicado.

### 2.1 O login: Authentication › Sign In / Providers

1. Desligue **Allow new users to sign up**. **Obrigatório.** No Ponto Livre, só o super admin cria contas, pelo app.
2. Deixe **Allow anonymous sign-ins** desligado.
3. Deixe o provedor **Email** ligado: é por ele que todo mundo entra.
4. Clique em **Email** e ajuste:
   - **Minimum password length**: `8`. O padrão da nuvem é 6, e 8 é o mínimo da senha provisória do app.
   - **Password Requirements**: de preferência, exija tipos de caractere. A senha que o app sugere (botão **Sugerir outra senha**) já tem letra minúscula, maiúscula, número e símbolo. Uma senha provisória digitada à mão vai precisar seguir a regra.
   - **Prevent use of leaked passwords**: ligue, se o seu plano tiver (o Pro tem).
   - **Secure email change**: deixe ligado.
   - **Secure password change**: ligue. Ele pede que a pessoa tenha entrado há pouco para trocar a senha.
5. Clique em **Save**.

### 2.2 O que o app não usa

- **Realtime › Settings**: desligue **Allow public access**. O app não usa Realtime.
- **Database › Extensions**: desligue a extensão `pg_graphql`, se você não for usar GraphQL. O app não usa.

### 2.3 O banco e os arquivos

- **Database › Settings** (ou **Project Settings › Database**), em **SSL Configuration**: ligue **Enforce SSL on incoming connections**.
- **Storage › Settings**: o limite global de tamanho de arquivo (**Upload file size limit**) precisa ser de **10 MB ou mais** (o padrão é 50 MB). O bucket de atestados aceita arquivos de até 10 MB, e o limite global vale por cima de todos os buckets.

### 2.4 A sua conta no painel do Supabase

Quem é dono do projeto no painel pode tudo nele. Ligue a verificação em duas etapas da sua conta em supabase.com, nas configurações da conta. Dentro do app ainda não há segundo fator: o MFA para a conta de super admin é uma melhoria futura.

> [!TIP]
> **Prefere o terminal?** O comando `npx supabase config push` copia o `supabase/config.toml` para o projeto. Só que esse arquivo foi feito para o Supabase local: antes de usar, troque o `site_url` e os `additional_redirect_urls` (que apontam para `localhost`) e ligue o `secure_password_change`. Na dúvida, faça pelo painel, como acima.

## 3. Aplicar a estrutura do banco

A estrutura inteira é um arquivo só: [`supabase/migrations/20261023180000_ponto_livre_estrutura.sql`](../supabase/migrations/20261023180000_ponto_livre_estrutura.sql). Ele cria as 13 tabelas do ponto, as funções, as regras de acesso e os dois buckets privados (selfies e atestados). Precisa do **PostgreSQL 17**: os projetos novos do Supabase já nascem nele. Num banco mais velho, o arquivo para logo no começo, explica o motivo e não muda nada.

### Opção A: pelo terminal (recomendada)

Na pasta do código:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
```

- `login` abre o navegador para você autorizar o terminal na sua conta do Supabase.
- `link` liga a pasta ao projeto e pede a senha do banco (a do passo 1).
- `db push` mostra a migration que vai aplicar e pede confirmação. Responda `Y`.

### Opção B: pelo SQL Editor

1. No painel do projeto, abra **SQL Editor** e clique em **New query**.
2. Abra o arquivo `supabase/migrations/20261023180000_ponto_livre_estrutura.sql` num editor de texto, copie o conteúdo inteiro e cole.
3. Clique em **Run**.

Se você usou a opção B e um dia for aplicar migrations novas pelo terminal, marque antes esta como aplicada, para o terminal não tentar de novo:

```bash
npx supabase migration repair --status applied 20261023180000
```

### Para conferir

No **SQL Editor**, rode:

```sql
select count(*) from pg_tables where schemaname = 'public' and tablename like 'ponto%';
```

A resposta tem de ser `13`.

## 4. Publicar a função de contas

A função `ponto-contas` cria as contas, troca nome e e-mail e redefine senha. Ela só atende o super admin. Sem ela, o botão **Nova conta** do app não funciona.

Na pasta do código, com o projeto já ligado (o `link` do passo 3; se você usou a opção B, rode antes o `login` e o `link`):

```bash
npx supabase functions deploy ponto-contas
```

- O `verify_jwt = true` vem do `supabase/config.toml`, e o comando já o aplica. **Nunca** publique com `--no-verify-jwt`.
- Não precisa de Docker.
- Para conferir: no painel, **Edge Functions** passa a mostrar `ponto-contas`.
- Não há chave para configurar: a função usa as chaves que o Supabase entrega a ela sozinho. São as novas (**publishable** e **secret**) ou, em projeto antigo que só tem as chaves legadas, a `anon` e a `service_role`. Num projeto antigo, se quiser desativar as chaves legadas, crie antes as novas em **Project Settings › API Keys** e confira, em **Edge Functions › Secrets**, que `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS` aparecem na lista. É delas que a função passa a depender, e de cada uma ela usa a chave de nome `default`. Se o app foi publicado com a `anon`, troque também a variável pela chave publishable e publique de novo ([6.6](#66-mudou-uma-variável-refaça-o-build)).

## 5. Criar o primeiro super admin

O super admin é quem cria as contas, liga cada ficha de RH à conta certa e escolhe quem administra. O primeiro nasce aqui, por SQL: a lista de super admins não aceita gravação de ninguém pela internet, nem da chave de serviço. Só o dono do banco acrescenta alguém.

1. No painel, abra **Authentication › Users**, clique em **Add user** e depois em **Create new user**.
2. Ponha o e-mail e uma senha forte de quem vai ser o super admin e marque **Auto Confirm User**. Clique em **Create user**.
   Sem **Auto Confirm User**, a conta fica esperando a confirmação por e-mail, o login recusa, e o arquivo do passo seguinte também: ele só promove conta com o e-mail confirmado.
3. Abra **SQL Editor › New query** e cole o arquivo [`supabase/primeiro-super-admin.sql`](../supabase/primeiro-super-admin.sql) inteiro.
4. Na linha marcada com `TROQUE AQUI`, troque `voce@example.com` pelo e-mail do passo 2. É o único lugar do arquivo onde ele aparece.
5. Clique em **Run**. O resultado mostra a lista de super admins. A coluna `email_confirmado` tem de vir `true`.

Se o e-mail estiver errado, nada muda, e o SQL Editor mostra a recusa:

> Não existe conta com o e-mail "voce@example.com" no login do Supabase. Nada mudou. Crie a conta em Authentication › Users › Add user › Create new user (com "Auto Confirm User" marcado), troque o e-mail na linha marcada com TROQUE AQUI pelo e-mail dessa conta e rode de novo.

Se a conta existe, mas foi criada sem **Auto Confirm User**, ele também recusa e não muda nada:

> A conta "voce@example.com" existe, mas o e-mail dela ainda não foi confirmado. Nada mudou. Confirme o e-mail (pelo link que o Supabase mandou para ele) ou apague a conta em Authentication › Users e crie de novo com "Auto Confirm User" marcado; depois rode este arquivo de novo.

Pode rodar de novo sem medo: se a conta já for super admin, ele avisa e não duplica. Para acrescentar outro super admin depois, é o mesmo arquivo com o outro e-mail.

**Sem nenhum super admin, ninguém entra.** O app diz "Seu acesso ao ponto não está liberado" para todo mundo.

## 6. Publicar o app

### 6.1 A URL e a chave do projeto

No painel do Supabase, o botão **Connect**, no topo, mostra a **Project URL** (`https://<ref>.supabase.co`) e a chave **publishable**. A chave também fica em **Project Settings › API Keys**.

- Use a chave **publishable** (começa com `sb_publishable`). Em projeto mais antigo, que só mostra as chaves legadas, use a **anon**.
- **Nunca** use a chave **secret** nem a **service_role**. Elas passam por cima de todas as regras do banco, e tudo o que vai nas variáveis abaixo fica escrito no JavaScript que o celular de todo mundo baixa.

### 6.2 As variáveis

| Variável | O que pôr |
| --- | --- |
| `VITE_SUPABASE_URL` | a Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | a chave publishable (ou a anon) |
| `VITE_NOME_DO_APP` | o nome na tela de entrar, no topo das telas, na aba do navegador, no ícone do celular e na folha impressa. Vazio: "Ponto" |
| `VITE_SLOGAN_DO_APP` | uma frase curta embaixo do nome, na tela de entrar e no pé da tela de bater. Vazio: sem frase |

O modelo comentado está em [`.env.example`](../.env.example). Quer outra cara? Os ícones ficam em [`public/`](../public/): troque os arquivos mantendo os nomes e os tamanhos.

### 6.3 Na hospedagem

Em qualquer uma das três: comando de build **`npm run build`** e pasta de saída **`dist`**. A versão do Node sai do `.nvmrc` ou do `package.json`.

**Cloudflare Pages**

1. Abra **Workers & Pages** e clique em **Create application**.
2. Na aba **Pages**, escolha **Import an existing Git repository** e o seu fork. Clique em **Begin setup**.
3. **Framework preset**: None. **Build command**: `npm run build`. **Build output directory**: `dist`.
4. Em **Environment variables (advanced)**, acrescente as quatro variáveis.
5. Clique em **Save and Deploy**.

Sem GitHub: rode `npm run build` no seu computador, com um `.env` preenchido, e envie a pasta `dist` pelo envio direto de arquivos (**Upload assets**).

**Netlify**

1. **Add new site › Import an existing project** e escolha o seu fork.
2. **Build command**: `npm run build`. **Publish directory**: `dist`.
3. Acrescente as quatro variáveis em **Environment variables** e publique.

Sem GitHub: rode o build no seu computador e arraste a pasta `dist` para o envio manual (**Deploy manually**).

**Vercel**

1. **Add New… › Project** e importe o seu fork.
2. O `vercel.json` já diz o comando de build e a pasta. Acrescente as quatro variáveis em **Environment Variables**.
3. Clique em **Deploy**.

### 6.4 O que já vem pronto

Você não precisa configurar rotas nem cabeçalhos:

- [`public/_headers`](../public/_headers) manda os cabeçalhos de segurança no Cloudflare Pages e no Netlify;
- [`public/_redirects`](../public/_redirects) faz as rotas do app abrirem direto (quem dá F5 em `/espelho`, por exemplo);
- [`public/404.html`](../public/404.html) responde o que não é rota nem arquivo;
- [`vercel.json`](../vercel.json) faz as duas coisas na Vercel.

**A política de conteúdo (CSP) nasce no build.** Ela leva o endereço do Supabase da variável `VITE_SUPABASE_URL` e o hash dos estilos em linha das páginas, e o build a escreve em dois lugares:

- numa meta no começo do `index.html` e do `404.html`, que vale em qualquer hospedagem;
- na linha `Content-Security-Policy` do `dist/_headers`, com `frame-ancestors 'none'` a mais (o que numa meta não vale), para o Cloudflare Pages e o Netlify.

Na Vercel (e no Caddy da [VPS própria](#8-vps-própria-avançado-sem-suporte)), o cabeçalho estático leva só o `frame-ancestors 'none'`, e o resto da política chega pela meta. Quem quiser a política inteira também no cabeçalho copia a linha do `dist/_headers` do próprio build: os comentários de [`public/_headers`](../public/_headers) explicam como.

Como a política leva o endereço do Supabase, trocar de projeto exige um build novo (veja o [6.6](#66-mudou-uma-variável-refaça-o-build)). Com o build velho, o navegador recusa falar com o Supabase novo.

### 6.5 HTTPS é obrigatório

Câmera e GPS só funcionam em página segura. As três hospedagens já entregam o app em `https://`. Se você puser um domínio próprio (por exemplo, `ponto.example.com`), ele também precisa de HTTPS.

### 6.6 Mudou uma variável? Refaça o build

Os valores das variáveis ficam escritos no JavaScript na hora do build, e o endereço do Supabase também fica na política de conteúdo. Trocou o projeto do Supabase, a chave ou o nome? Publique de novo (no Cloudflare, **Retry deployment**; no Netlify, **Trigger deploy**; na Vercel, **Redeploy**).

### 6.7 Volte ao Supabase: o endereço do app

Em **Authentication › URL Configuration**:

1. **Site URL**: o endereço do app, com `https://`.
2. **Redirect URLs**: deixe vazio ou só com o endereço do app. Nada de curinga (`*`). O app não usa redirecionamento de login.
3. Clique em **Save**.

## 7. Primeiro uso

1. Abra o endereço do app e entre com o e-mail e a senha do super admin.

   ![A tela de entrar, com o e-mail e a senha do super admin](imagens/cadastro/01-super-admin-entra.png)

2. O app pede um PIN de 4 dígitos. Digite e repita. Ele vai ser pedido a cada batida.

   ![A tela de criar o PIN](imagens/cadastro/02-super-admin-cria-o-pin.png)

3. Na tela inicial, toque em **Administração** e preencha, embaixo da lista de pessoas, os três blocos: **Local de trabalho**, **Dados da empresa** e **Regras de jornada**. Cada bloco tem o seu botão de salvar.
   O local de trabalho se mede melhor pelo celular, de dentro do local, com **Usar a localização deste aparelho**.

   ![A administração com o local, os dados da empresa e as regras de jornada preenchidos](imagens/cadastro/05-administracao-empresa-jornada-e-local.png)

4. Cadastre as pessoas: [CADASTRO.md](CADASTRO.md) mostra o caminho inteiro, com um print por passo.
5. Mande o endereço para o time instalar no celular: [INSTALAR-NO-CELULAR.md](INSTALAR-NO-CELULAR.md) tem mensagens prontas.

O uso do dia a dia de cada papel está no [manual](MANUAL.md).

## 8. VPS própria (avançado, sem suporte)

Quem prefere tudo no próprio servidor pode, mas por conta própria: este repositório não traz a pilha pronta.

- **O Supabase:** siga a documentação oficial de [self-hosting com Docker](https://supabase.com/docs/guides/self-hosting/docker). A estrutura do ponto exige o **PostgreSQL 17**, que a pilha oficial já usa por padrão; uma instalação antiga, no 15, precisa antes do [guia de atualização para o Postgres 17](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17).
- **O login:** no `.env` da pilha, `DISABLE_SIGNUP=true` fecha o cadastro aberto. Deixe `ENABLE_EMAIL_SIGNUP=true`: apesar do nome, desligá-lo derruba o login por e-mail.
- **A estrutura:** aplique a migration como o papel `postgres` (pelo SQL Editor do Studio ou com `npx supabase db push --db-url` apontando para o seu banco).
- **A função de contas:** copie a pasta `supabase/functions/ponto-contas` para a pasta de funções da sua instalação, com a verificação de JWT ligada.
- **O app:** rode `npm run build` com as variáveis e sirva a pasta `dist`. O [`exemplos/servidor/Caddyfile`](../exemplos/servidor/Caddyfile) faz isso com HTTPS automático e os cabeçalhos de segurança das hospedagens. Da política de conteúdo, o cabeçalho dele leva só o `frame-ancestors 'none'`, e o resto chega pela meta do `index.html` e do `404.html`; para ter a política inteira também no cabeçalho, troque o valor pela linha `Content-Security-Policy` do `dist/_headers` do seu build, como dizem os comentários do arquivo.
- **As cópias de segurança** passam a ser suas, do banco e dos arquivos.

## Cópias de segurança

No plano grátis, o Supabase **não** guarda cópia que você possa restaurar. Faça a sua com regularidade, com os comandos do guia oficial do Supabase, [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Eles precisam do Docker ligado e da string de conexão do banco no lugar de `[CONNECTION_STRING]`: no painel, o botão **Connect** mostra a do **Session pooler**, e a senha é a do banco (a do passo 1).

```bash
npx supabase db dump --db-url [CONNECTION_STRING] -f roles.sql --role-only
npx supabase db dump --db-url [CONNECTION_STRING] -f schema.sql
npx supabase db dump --db-url [CONNECTION_STRING] -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

Os três arquivos levam os papéis, a estrutura e os dados: as contas, as fichas, as batidas e as trilhas. As selfies e os atestados ficam no Storage e **não** entram neles. Para copiá-los, use o script da seção [Migrating storage objects](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore#migrating-storage-objects) do mesmo guia, que copia os buckets e os arquivos de um projeto do Supabase para outro (um projeto de reserva, por exemplo). Ele usa a chave secret (ou a `service_role`) dos dois projetos, que nunca vai para o repositório nem para o build. Guarde as cópias fora do computador e fora do git, com o mesmo cuidado do original: elas têm nomes, e-mails e fotos das pessoas.

O plano Pro do Supabase faz cópia diária automática. Mais detalhes na [documentação de backups do Supabase](https://supabase.com/docs/guides/platform/backups).

**Restaurar a cópia é tarefa de quem conhece Postgres.** Os gatilhos do banco do ponto carimbam e recusam batidas inseridas (o horário, a origem e a trilha são decididos pelo banco), então os dados só voltam do jeito que estavam com os gatilhos desligados durante a carga. É o que faz o mesmo guia oficial, [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore): a carga dos dados roda com `session_replication_role` em `replica`. Siga o guia e treine a restauração num projeto de teste antes de precisar dela.

## Atualizar para uma versão nova

1. Leia a entrada da versão no [CHANGELOG.md](../CHANGELOG.md).
2. Aplique as migrations novas: `npx supabase db push`.
3. Se a função de contas mudou: `npx supabase functions deploy ponto-contas`.
4. Publique o app de novo (o build sai do código novo).

## Se der problema

| O que aparece | O que fazer |
| --- | --- |
| "Não foi possível carregar o app", depois de alguns segundos | Faltam as variáveis no build, ou a internet caiu. Confira as quatro variáveis e publique de novo. |
| "E-mail ou senha incorretos." | Confira o e-mail e a senha. A senha provisória diferencia maiúsculas. |
| "Este e-mail ainda não foi confirmado." | A conta foi criada no painel sem **Auto Confirm User**. Apague e crie de novo, com a opção marcada. |
| No SQL Editor, no passo 5: "A conta … existe, mas o e-mail dela ainda não foi confirmado. Nada mudou." | A mesma causa: o arquivo do primeiro super admin não promove conta sem e-mail confirmado. Confirme o e-mail pelo link que o Supabase mandou, ou apague a conta e crie de novo com **Auto Confirm User**; depois rode o arquivo de novo. |
| "Seu acesso ao ponto não está liberado", para o super admin | O passo 5 não rodou, ou rodou com outro e-mail. |
| Depois de trocar o projeto do Supabase, o app não fala com o banco (no console do navegador, "Content Security Policy" ou "Refused to connect") | O build ainda é o do projeto antigo: a política de conteúdo leva o endereço do Supabase. Publique de novo com a variável nova ([6.6](#66-mudou-uma-variável-refaça-o-build)). |
| "A função de contas (ponto-contas) não está publicada no Supabase…" | Faça o passo 4. |
| A câmera ou o GPS dizem que só funcionam em conexão segura | Abra o app pelo endereço com `https://`. |
| A estrutura recusa: "Estrutura do ponto nao aplicada: o banco e PostgreSQL…" | O projeto é de uma versão antiga do Postgres. Crie um projeto novo (já nasce no 17). |

## Conferência de segurança

Antes de mandar o endereço para o time, confira:

- [ ] Um projeto do Supabase só para o ponto, com senha forte no banco.
- [ ] **Allow new users to sign up** desligado antes da primeira conta, e **Allow anonymous sign-ins** desligado.
- [ ] Senha mínima de 8, com tipos de caractere; proteção contra senha vazada, se o plano tiver.
- [ ] **Secure email change** e **Secure password change** ligados.
- [ ] **Site URL** com o endereço do app e **Redirect URLs** sem curinga.
- [ ] Realtime sem acesso público, e `pg_graphql` desligado se você não usa GraphQL.
- [ ] SSL obrigatório no banco e limite global de upload de 10 MB ou mais.
- [ ] Função `ponto-contas` publicada com o `verify_jwt` do `config.toml`.
- [ ] Nenhuma chave secret ou service_role numa variável `VITE_`.
- [ ] Primeiro super admin promovido só depois de a conta estar confirmada.
- [ ] Verificação em duas etapas na sua conta do painel do Supabase.
- [ ] O app abre em `https://` (sem isso não há câmera nem GPS).

Para avisar de uma falha, siga o [SECURITY.md](../SECURITY.md).
