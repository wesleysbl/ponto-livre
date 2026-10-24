# Segurança

O Ponto Livre guarda prova de jornada (horário, selfie, localização) e dados de pessoas (nome, e-mail, atestado). Este arquivo diz como ele se defende, o que quem instala precisa configurar, o que ele ainda não faz e como avisar de uma falha.

O projeto está em **beta** e é mantido por uma pessoa. Use por sua conta: a licença MIT vem sem garantia.

## Como avisar de uma falha

**Não abra issue pública**, pull request nem discussão descrevendo a falha. Use o relato privado do GitHub:

1. Na página deste repositório, abra a aba **Security**.
2. Clique em **Report a vulnerability** e preencha. Só quem mantém o projeto vê o relato.

Se o botão não aparecer, abra uma issue pedindo um canal privado, **sem** descrever a falha.

Ajuda muito mandar:

- o que é e onde está (arquivo, tela, função do banco ou a função de contas);
- como reproduzir, passo a passo, de preferência no Supabase local (`npm run db:iniciar`, ver [docs/RODAR-LOCAL.md](docs/RODAR-LOCAL.md));
- o que a falha permite (quem consegue fazer o quê, com qual papel);
- a versão ou o commit.

Teste só no Supabase local ou num projeto seu. Não use a instalação de outra empresa e não abra, guarde nem divulgue dado de outras pessoas (fotos, nomes, batidas, atestados).

**Não há prazo de resposta prometido.** Todo relato é lido. A correção sai numa versão nova, e as correções de segurança de cada versão aparecem nas notas da versão, no [CHANGELOG.md](CHANGELOG.md).

### Versões que recebem correção

Só a versão mais nova (a `main`). Quem tem uma instalação antiga atualiza seguindo [docs/INSTALAR.md](docs/INSTALAR.md#atualizar-para-uma-versão-nova).

## Como o ponto se defende

As regras moram no banco. A tela só mostra e pede: quem recusa é o banco, a cada chamada. Forçar um endereço do app abre uma tela que não traz linha nenhuma.

**Login e sessão**

- O login é o do Supabase Auth, com e-mail e senha. O cadastro aberto fica desligado: só o super admin cria contas, pelo app, através da função de contas.
- A sessão fica no aparelho, e o PIN é pedido a cada batida.
- O app não aceita sessão vinda num link (`detectSessionInUrl` desligado): um link preparado por outra pessoa não faz o app abrir logado na conta dela.

**Acesso ao banco**

- RLS ligada em toda tabela do ponto. Quem não entrou (`anon`) não tem privilégio nenhum.
- Os privilégios padrão estão revogados: tabela, sequência ou função que o `postgres` criar depois em `public` nasce sem acesso para `anon`, `authenticated` e `PUBLIC` (e o `EXECUTE` de `PUBLIC` sai das funções que ele criar em qualquer esquema). Quem estende o banco concede só o que usa. O `service_role` continua com o padrão do Supabase, e o que outro papel cria segue o padrão dele.
- Conta sem ficha e sem papel não lê nada do ponto, nem o local nem os dados da empresa.
- Toda função tem `search_path` fixo. As privilegiadas (`SECURITY DEFINER`) conferem a sessão e o papel antes de agir, e nenhuma monta SQL com texto vindo de fora.

**A batida**

- A batida do funcionário só nasce pela função `ponto_registrar_batida`. O horário é o do servidor, o tipo sai da ordem do dia, e a batida repetida dentro da janela é recusada.
- A trava de futuro recusa horário mais de 1 minuto à frente do servidor, também na correção.
- O PIN é conferido no banco, e a selfie tem de já estar no storage, na pasta da própria pessoa, com o nome igual ao da batida e com menos de 15 minutos.
- O que quem administra lança pela API vira sempre "ajuste do admin", com horário e motivo obrigatórios e a marca de ajuste ligada. Nunca passa por batida do app.

**A correção e o apagamento**

- Nenhuma sessão de usuário apaga batida.
- Corrigir exige um motivo novo, liga a marca de ajuste (que não se desliga) e guarda a linha de antes e a de depois numa trilha. As trilhas não se alteram nem se apagam.
- Quem é dono da batida não decide o próprio ponto: quem administra, até o super admin, não lança nem corrige a própria batida e não decide o próprio pedido de batida esquecida.

**O PIN**

- Só existe como hash bcrypt, e não se lê nem se grava direto: só pelas funções do ponto.
- Cinco erros seguidos travam a conta, e a trava endurece no mesmo dia (de Brasília): 15 minutos no primeiro bloqueio, 1 hora no segundo, 24 horas do terceiro em diante. Acertar o PIN não zera essa conta; zeram o reset por quem administra, o PIN novo e o dia seguinte.
- Depois de um reset por quem administra, a pessoa cria um PIN novo antes de bater.

**Selfies e atestados**

- Ficam em dois buckets privados. Cada abertura pede uma URL assinada que vale 2 minutos, e quem decide se a pessoa vê é a regra do bucket (quem administra, ou o dono da pasta).
- A selfie só sobe no caminho da convenção (`{conta}/{aaaa}/{mm}/{uuid}.jpg`), com teto por conta: 20 na última hora e 60 nas últimas 24 horas corridas. O teto é aproximado: envios simultâneos, em rajada, podem passar um pouco dele, porque cada envio conta o que já estava gravado. Nada se sobrescreve; a selfie que prova uma batida ou um pedido não se apaga, e a que ficou solta só sai com mais de 16 minutos.
- A foto do atestado é refeita no aparelho (um JPEG novo, de até 2000 px no lado maior) e sobe sem os metadados do arquivo original: o EXIF de uma foto de celular pode trazer o GPS de onde ela foi tirada, muitas vezes a casa da pessoa. Vão como vieram, com os metadados que tiverem, o PDF e a foto que o navegador não consegue abrir (HEIC, fora do Safari).

**Contas**

- A função de contas (`ponto-contas`) só atende o super admin: sem sessão, 401; sem o papel, 403. Ela valida cada campo, recusa pedido grande e não mexe na conta de outro super admin.
- Redefinir a senha pela função encerra as sessões abertas da pessoa: a renovação da sessão antiga passa a falhar, e o aparelho que estava logado sai quando o token de acesso dele vence. Até vencer (no máximo 60 minutos, o `jwt_expiry` padrão do Supabase), esse token continua aceito pelo banco.
- O nome da conta fica no `app_metadata` do login, que só o servidor grava. A pessoa não troca o próprio nome pela API do login.
- Criar conta, trocar nome ou e-mail e redefinir senha deixam trilha (quem, quando, o quê), e a trilha recusa guardar senha.
- O primeiro super admin nasce por SQL, como `postgres`, a partir de uma conta já confirmada (o arquivo recusa conta sem e-mail confirmado).

**O app no navegador**

- Uma política de conteúdo (CSP) gerada no build: o navegador só roda o JavaScript do próprio app, só aplica o CSS dele, só conversa com o endereço do app e com o Supabase configurado, e só mostra imagem do app, da prévia da câmera (`blob:`) e do Supabase. Nenhum script em linha, nada de `eval`, nenhum iframe; os `<style>` em linha do `index.html` e do `404.html` são liberados pelo hash exato do texto, calculado no build. Ela vai numa meta do `index.html` e do `404.html` e, no Cloudflare Pages e no Netlify, também no cabeçalho, com `frame-ancestors 'none'`. As regras e o porquê de cada uma estão em [`src/lib/politica-de-conteudo.ts`](src/lib/politica-de-conteudo.ts). Trocou o Supabase? Faça o build de novo.
- Os cabeçalhos de [`public/_headers`](public/_headers) (e os mesmos em [`vercel.json`](vercel.json) e no [Caddyfile de exemplo](exemplos/servidor/Caddyfile)): câmera e GPS só no próprio app e microfone desligado, nada de iframe, `no-referrer` (o endereço leva id de funcionário), `nosniff`, HTTPS obrigatório e fora dos buscadores.
- As fontes vêm do próprio app: nenhuma abertura avisa terceiros.
- O service worker guarda só a casca do app (a página, os arquivos do build com hash no nome e os ícones). Nunca guarda resposta do Supabase nem atestado, e não existe fila offline.
- O CSV do painel neutraliza fórmula: célula de texto que começa com `=`, `+`, `-` ou `@` sai com um apóstrofo na frente, e a planilha a lê como texto.

**Segredos**

- No app só vai a chave publicável (a publishable ou, em projeto antigo, a `anon`), que é pública por natureza: quem protege os dados é a RLS. A chave de serviço (a secret ou, em projeto antigo, a `service_role`) só existe dentro da função de contas, no servidor do Supabase, que a entrega à função: ela não fica no repositório nem em variável do build.
- O repositório não guarda `.env`, e o CI roda sem segredo nenhum.
- O CI recusa dependência de produção com falha alta ou crítica conhecida (`npm audit --omit=dev --audit-level=high`).

**As provas**

- Os testes de banco (`npm run db:testar`) provam no Supabase local, em transação desfeita, que cada regra acima recusa o que deve recusar.
- O teste de ponta a ponta [`e2e/csp.spec.ts`](e2e/csp.spec.ts) abre o build de produção no Chrome, passa por entrar, bater, espelho, painel, administração e folha, e reprova com qualquer recusa da política no console. O mesmo caminho, com a selfie, também passou no WebKit (o motor do Safari), numa conferência à parte.

Os detalhes do banco estão em [docs/BANCO.md](docs/BANCO.md#as-proteções-principais), e o porquê de cada decisão de produto, em [docs/DEFESA.md](docs/DEFESA.md).

## O que a instalação na nuvem precisa configurar à mão

O `supabase/config.toml` deste repositório só vale para o Supabase local. Na nuvem, o projeto é configurado à mão: o cadastro aberto se fecha **antes da primeira conta**, e o resto segue os passos do guia. Em resumo (o passo a passo, com a lista para conferir, está em [docs/INSTALAR.md](docs/INSTALAR.md#conferência-de-segurança)):

- um projeto do Supabase só para o ponto, com senha forte no banco;
- **Allow new users to sign up** desligado antes da primeira conta, e login anônimo desligado;
- senha mínima de 8 caracteres, com tipos de caractere, e proteção contra senha vazada, se o plano tiver;
- **Secure email change** e **Secure password change** ligados;
- **Site URL** com o endereço do app e **Redirect URLs** sem curinga;
- Realtime sem acesso público, e `pg_graphql` desligado se você não usa GraphQL;
- SSL obrigatório no banco, e limite global de upload de 10 MB ou mais;
- a função `ponto-contas` publicada com a verificação de JWT ligada;
- nenhuma chave secret ou service_role numa variável `VITE_`;
- o primeiro super admin promovido só depois de a conta estar confirmada;
- verificação em duas etapas na sua conta do painel do Supabase;
- o app em `https://` (sem isso não há câmera nem GPS).

Na Vercel e num servidor próprio, o cabeçalho estático leva só o `frame-ancestors 'none'`, e o resto da política chega pela meta do `index.html`. Para ter a política inteira também no cabeçalho, copie a linha `Content-Security-Policy` do `dist/_headers` do seu build (os comentários de [`public/_headers`](public/_headers) explicam).

## Limitações conhecidas e decisões de produto

Algumas são escolhas, defendidas em [docs/DEFESA.md](docs/DEFESA.md). Outras são melhorias que ainda não chegaram. Nenhuma é segredo.

- **A coordenada é declarada pelo aparelho.** O navegador entrega a posição, e quem tem a sessão e o PIN consegue mandar qualquer coordenada pela API. "No local" é um indício para quem confere, não prova de presença.
- **"Sem localização" é escolha do aparelho.** Quando o GPS não responde, a batida sai sem localização, com selfie e PIN, e aparece marcada para quem administra.
- **A selfie prova envio recente, não captura.** A tela só tira a foto pela câmera, na hora, mas quem chama a API pode enviar qualquer imagem nos 15 minutos de validade, até uma foto antiga. Quem confere a foto é uma pessoa, no painel.
- **O super admin pode tudo.** Ele redefine a senha e reseta o PIN de qualquer conta, então consegue entrar como qualquer pessoa. Escolha com cuidado quem é super admin e proteja essa conta. Ainda não há segundo fator dentro do app.
- **A troca obrigatória da senha provisória ainda não existe.** A senha que o super admin cria continua valendo, e a pessoa não troca a própria senha pelo app. Quem conhece a senha provisória e consegue um reset de PIN entra como a pessoa. Use senha provisória forte e entregue em mãos.
- **A sessão fica no aparelho.** Quem pega o celular desbloqueado, com o app aberto, vê o espelho da pessoa; para bater, precisa do PIN. Em aparelho dividido, saia do app no fim do uso.
- **Redefinir a senha não corta o token de acesso já emitido.** A sessão antiga deixa de renovar, mas o token que o aparelho tinha vale no banco até vencer, por até 60 minutos. Para encurtar essa janela, diminua a validade do token de acesso do projeto (o `jwt_expiry`); o preço é renovar a sessão mais vezes.
- **A política de conteúdo foi testada no Chrome e no WebKit, não num iPhone.** No Safari (WebKit), o console pode mostrar um aviso interno de `style-src-attr` quando uma lista de seleção (`<select>`) abre. O aviso é do próprio navegador, não bloqueia nada e não muda o uso.
- **A batida extra não tem limite.** Da 5ª batida do dia em diante, cada uma entra como "extra", sem teto, e aparece para quem administra como as outras.

Viu uma limitação que é falha de verdade? Avise como está em [Como avisar de uma falha](#como-avisar-de-uma-falha).
