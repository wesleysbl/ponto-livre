# Registro de mudanças

O que muda em cada versão do Ponto Livre. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e a numeração segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

Enquanto a versão começar com 0, qualquer versão nova pode pedir cuidado na atualização. Leia a entrada antes de atualizar, e aplique as migrations novas na ordem.

## Não lançado

Nada ainda.

## 0.10.0-beta.1 - 2026-11-03

**Esta versão muda o banco.** Ela traz duas migrations novas, que se aplicam **antes** de publicar o app novo: veja [Como atualizar](#como-atualizar), no fim desta seção.

### Adicionado

#### A jornada e o saldo de horas

- **A jornada da empresa**, na administração, em "Regras de jornada": a semana inteira, de segunda a domingo, com até dois blocos de horário por dia e o total de cada dia calculado na hora. Dia sem horário é dia sem jornada. Cada dia com jornada soma de 1h a 12h.
- **A jornada própria**, opcional, na ficha de cada pessoa ("Jornada desta pessoa": "Usar a da empresa" ou "Jornada própria"), no mesmo formato. Com "Usar a da empresa", a pessoa acompanha a jornada da empresa quando ela muda.
- **"Saldo calculado a partir de"**, nas regras de jornada. O saldo e as faltas de cada pessoa só contam a partir da mais nova entre esta data e a "Passou a bater ponto aqui em" da ficha; antes dela, nenhum dia é cobrado. Na atualização, a data nasce com o dia em que a migration roda; numa instalação nova, com o dia em que a configuração é gravada pela primeira vez. É ela que impede a data da ficha, que pode ser a admissão de anos atrás, de criar faltas em todos os meses antes da atualização. Quem administra pode recuar a data, e a tela avisa antes de salvar que os dias desde lá passam a ser cobrados, inclusive as faltas. A data vale para a empresa toda. A ficha sem "Passou a bater ponto aqui em" não tem nenhum dia cobrado.
- **O saldo de cada dia**, no espelho de quem bate, nos dias de uma pessoa no painel e na folha: o previsto (a jornada do dia), o abonado, o atraso, a falta e o saldo. A tolerância vale por dia: quando as horas do dia ficam até esse tanto acima ou abaixo da jornada, o saldo do dia é zero. Atraso é a entrada depois do início do bloco, além da tolerância, descontada a parte coberta por atestado ou falta justificada. Falta é o dia da jornada que passou sem batida e sem abono que cubra o dia. Hoje aparece "Saldo: em andamento" e só entra no saldo quando o dia acaba. O dia que passou com batida faltando aparece "Incompleto: saldo pendente" e fica fora do saldo até alguém corrigir a batida.
- **O resumo do mês**, no espelho, e do período, no painel da pessoa: o saldo, o previsto, o abonado, as **Horas extras** (a soma dos saldos positivos dos dias) e as **Horas negativas** (a soma dos negativos, faltas inclusive). O resumo também diz quantas faltas o mês teve e quantos dias incompletos ficaram fora, e, quando o mês começa antes do primeiro dia cobrado, desde quando o saldo conta ("Saldo calculado a partir de 15/10/2026", e os dias antes dessa data ficam fora).
- **O feriado nacional entra no saldo como dia sem jornada**, como o sábado e o domingo: sem previsto e sem falta, e o que se trabalha nele é hora extra. A linha do dia diz "Feriado", e o sábado ou domingo trabalhado diz "Dia sem jornada". O feriado do estado ou da cidade não entra: lance o dia como falta justificada por dias, para cada pessoa.
- No espelho, quem bate ponto vê cada dia de falta que entrou no saldo do mês, com o débito do dia.

#### As ausências

- **Lançar por dias ou por horário.** Por dias: a data de início e quantos dias (corridos, até 120), com a data final calculada na hora. Por horário: a data, "Das" e "Até", com a duração calculada na hora. Os três tipos aceitam as duas formas. Vários intervalos no mesmo dia valem, e os que só se encostam também (das 14:00 às 16:00 e das 16:00 às 16:30). O banco recusa, com a frase do motivo, o intervalo que cruza outro e o intervalo num dia já coberto por uma ausência de dia inteiro.
- **O abono.** Atestado médico e falta justificada abonam a parte da jornada que cobrem e que não foi trabalhada, sem apagar nenhuma batida: o tempo trabalhado dentro do intervalo conta como trabalho, uma vez só, e a parte fora da jornada não abona. "Outro motivo" só marca o dia. A marca da ausência traz o período e o abono: "Atestado 08:00-10:00 · abonou 2h00".
- **O total do dia e do período somam o abono**, com a conta escrita embaixo ("8h00" e, na linha de baixo, "6h00 trabalhadas + 2h00 de atestado"), no espelho, nos dias de uma pessoa e no total de cada pessoa e do período no painel.

#### A folha e o CSV

- **A folha impressa** ganha as colunas Trabalhado, Previsto, Abonado e Saldo, as marcas de falta, de atraso e da ausência com o período numa segunda linha do dia, o **Total com abono** no alto (com a conta "trabalhadas + de atestado"), o saldo do mês ao lado e o quadro **Resumo do mês** no fim: Horas extras, Horas negativas, Faltas e Saldo do mês. A legenda traz só o que o mês usa. Sem a jornada cadastrada, ou sem nenhum dia cobrado no mês, a folha sai sem as colunas do saldo e diz por quê, no próprio papel. Um mês comum cabe numa folha A4.
- **Aviso antes de imprimir** quando a ficha da pessoa não tem "Passou a bater ponto aqui em": sem a data, nenhum dia é cobrado, e a folha sairia sem horas extras, horas negativas e saldo. O aviso leva a Pessoas, onde a data se preenche, e com ele a folha não abre a impressão sozinha.
- **O CSV** mantém as 18 colunas de antes, na mesma ordem, e ganha 9 no fim: Previsto do dia, Abonado do dia, Saldo do dia, Crédito do dia, Débito do dia, Falta no dia, Atraso do dia, Ausências do dia e Estado do dia. Como as que já fechavam o dia, só a última linha de cada dia as preenche. O saldo negativo vai com o sinal de menos comum ("-8:00"), para a planilha ler como número; o positivo vai sem sinal, porque um "+" no começo da célula seria fórmula. O dia de falta ganha uma linha própria, com "Falta" na coluna Tipo.

#### Para quem instala e desenvolve

- Duas migrations novas, aplicadas depois da estrutura e nesta ordem: `20261103000043_jornada_e_saldo.sql` (a jornada da empresa e a própria, a data do saldo e a trava da própria ficha) e `20261103003912_ausencia_por_horario.sql` (a ausência por horário e a trava da própria ausência). Cada uma confere no fim o que criou e desfaz tudo se algo não bater. Os testes de banco ganham dois arquivos, `jornada_e_saldo.sql` e `ausencia_por_horario.sql`. O modelo está em [`docs/BANCO.md`](docs/BANCO.md#a-jornada-o-saldo-e-a-ausência-por-horário).
- A conta do saldo mora em `src/lib/saldo.ts` (com a jornada em `src/lib/jornada.ts`), pura, sem React, sem Supabase e sem relógio. O espelho, o painel, a folha e o CSV usam as mesmas funções.
- A automação **"Prints da documentação"** ([`.github/workflows/prints.yml`](.github/workflows/prints.yml)), que só roda quando alguém pede (o botão "Run workflow" da aba Actions ou o rótulo `prints` num pull request): sobe o Supabase local no próprio GitHub, roda as provas de ponta a ponta, semeia a demonstração, tira os prints e guarda as imagens de `docs/imagens/` num pacote, para baixar, conferir e commitar. Quem mexe nas telas não precisa do Docker na própria máquina para refazer as imagens.
- O CI ("Conferir") procura segredos no histórico inteiro do repositório, com o gitleaks numa versão fixa e com a soma do arquivo conferida. A automação dos prints roda a mesma busca.
- A demonstração (`npm run demo:semear`) ganha a jornada da empresa, a jornada própria do Gustavo, um atestado por horário, uma falta e o saldo calculado a partir do dia 1º do mês, e conta os mesmos feriados nacionais do app, a Paixão de Cristo inclusive.
- Um prompt para quem mantém uma cópia modificada levar a jornada e o saldo, com as duas migrations: [`docs/prompts/jornada-e-saldo.md`](docs/prompts/jornada-e-saldo.md).

#### Os feriados nacionais

- No painel, nos dias de uma pessoa, o feriado nacional aparece com a etiqueta "feriado" e o nome dele ("feriado · Nossa Senhora Aparecida"), como o sábado e o domingo aparecem com "fim de semana". Antes, um feriado numa segunda-feira aparecia como um dia útil qualquer, "Sem batida", e quem fecha o mês precisava lembrar de cabeça que era feriado. Os feriados são os dez nacionais (Confraternização Universal, Paixão de Cristo, Tiradentes, Dia do Trabalho, Independência, Nossa Senhora Aparecida, Finados, Proclamação da República, Consciência Negra e Natal), calculados pelo próprio app, sem cadastro; a Paixão de Cristo segue a data da Páscoa de cada ano. Carnaval e Corpus Christi são ponto facultativo e não entram, e feriado do estado ou da cidade continua sem etiqueta. No saldo, o feriado nacional é dia sem jornada (veja "A jornada e o saldo de horas", acima). Quem mantém uma cópia modificada pode aplicar só a etiqueta com o prompt de [`docs/prompts/feriados-nacionais.md`](docs/prompts/feriados-nacionais.md).

### Mudado

- **A carga diária deixa de ser digitada.** O banco a calcula da jornada da empresa (o maior total de um dia), e a administração mostra a carga calculada. O app antigo, guardado no celular de alguém, continua gravando a configuração sem erro: o banco recalcula a carga pela jornada, por cima do número que ele manda.
- **Na atualização, a configuração que já existe ganha uma jornada montada da carga gravada**: de segunda a sexta, das 08:00 às 12:00 e, à tarde, das 13:00 até completar a carga; com carga de até 4h, um bloco só, das 08:00 até completar. A carga continua exatamente a mesma e o saldo do dia sai certo desde o primeiro dia, mas os horários são aproximados até alguém conferir (veja [Como atualizar](#como-atualizar)).
- A data "Passou a bater ponto aqui em", da ficha, deixa de ser só registro: com a "Saldo calculado a partir de", ela decide desde quando o saldo da pessoa é cobrado. Ela continua sem liberar nem bloquear a batida.
- A tolerância deixa de ficar só guardada: ela vale por dia, no saldo.
- As ausências que já existiam passam a ser "por dias", sem mudar nada nelas.
- No início da administração, o cartão "Ausências" diz que atestado e falta justificada abonam a parte da jornada que cobrem e que outro motivo só marca o dia, e o cartão "Regras de jornada" escreve a carga como duração ("8h00"), e não como horário.
- **Atenção, para quem lê o CSV numa planilha:** na linha de ausência, o texto da coluna Origem mudou. Antes, ela trazia o tipo da ausência por extenso; agora traz a marca da ausência com o período, como "Atestado, dia inteiro (atestado anexado)" ou "Atestado 14:00-16:00 (atestado anexado)". Um filtro ou fórmula que procure o texto antigo precisa ser refeito. As 18 primeiras colunas continuam na mesma ordem.
- No painel, nos dias de uma pessoa, cada batida mostra a selfie em miniatura no lugar do ícone da câmera, para conferir quem bateu sem abrir foto por foto. O clique continua abrindo a foto grande. As fotos de um dia são assinadas num pedido só, quando o dia chega perto da tela, com os mesmos 2 minutos de validade; sem link, fica a câmera de antes. Esta mudança, sozinha, não pede migration. Quem mantém uma cópia modificada pode aplicar o ajuste com o prompt de [`docs/prompts/miniaturas-das-selfies.md`](docs/prompts/miniaturas-das-selfies.md).

### Segurança

- **Ninguém decide o próprio ponto, agora também na ficha e na ausência.** O banco já recusava que o dono da batida a lançasse ou corrigisse. Agora recusa também, para todo mundo, inclusive o super admin: mudar a jornada própria e a data "Passou a bater ponto aqui em" da ficha ligada à própria conta (também ao criar a ficha já ligada a si e ao ligar a si uma ficha que já tem as duas), e lançar ou cancelar ausência para a própria conta. As duas coisas decidem o saldo, e com o abono a ausência em causa própria viraria crédito. A tela esconde os botões na própria ficha e diz por quê. Numa empresa com uma pessoa só administrando, a jornada, a data e o atestado dela precisam de uma segunda pessoa com administração. As ausências lançadas antes da atualização continuam valendo como foram lançadas.

### Como atualizar

1. **Aplique as duas migrations novas antes de publicar o app**: `npx supabase db push` aplica as duas, na ordem. O app novo lê as colunas novas e não carrega os dados sem elas; o app antigo, guardado no celular de alguém, continua batendo ponto com o banco novo.
2. **Se você aplicou a estrutura pelo SQL Editor** (a opção B do [guia de instalação](docs/INSTALAR.md#3-aplicar-a-estrutura-do-banco)), o terminal não sabe que ela existe e tentaria aplicá-la de novo. Marque-a antes como aplicada (`npx supabase migration repair --status applied 20261023180000`) e rode o `db push`. Ou siga pelo SQL Editor: cole e rode as duas migrations novas, uma de cada vez, nesta ordem: `20261103000043_jornada_e_saldo.sql` e depois `20261103003912_ausencia_por_horario.sql`. O passo a passo está em [`docs/INSTALAR.md`](docs/INSTALAR.md#atualizar-para-uma-versão-nova).
3. Publique o app de novo.
4. **Confira os horários da jornada da empresa**, na administração, em "Regras de jornada". A atualização os montou da carga gravada (de segunda a sexta, a partir das 08:00, com almoço das 12:00 às 13:00), e a sua jornada de verdade pode ser outra. Até alguém conferir, a marca de atraso pode sair errada, e o atestado por horário só abona a parte que cai dentro desses horários; o saldo dos outros dias não muda, porque depende do total do dia. Com carga entre 4h01 e 4h59, a tarde nasce com menos de uma hora.
5. **Confira a "Saldo calculado a partir de".** Ela nasce com o dia em que a migration rodou, e nenhum dia antes dela é cobrado. Para cobrar desde o começo do mês, recue a data: os dias desde lá passam a ser cobrados, inclusive as faltas.
6. Preencha "Passou a bater ponto aqui em" nas fichas que ainda não têm: sem ela, a pessoa não tem nenhum dia cobrado, e a folha avisa antes de imprimir. Dê a jornada própria a quem trabalha em outro horário.

### Limitações conhecidas

- Só os feriados nacionais entram no saldo. O feriado do estado ou da cidade se lança como falta justificada por dias, para cada pessoa.
- Sem banco de horas entre meses: o saldo de um mês não passa para o seguinte.
- A jornada não tem data de vigência: mudar a jornada recalcula também os dias que já passaram, desde o primeiro dia cobrado.
- No máximo dois blocos de horário por dia, e sem escala que muda de semana para semana (12x36, revezamento).
- A "Saldo calculado a partir de" vale para a empresa toda; a data de cada pessoa é a da ficha.
- O "Abonado" do resumo do saldo soma só os dias cobrados; o total com abono (e o total da coluna Abonado da folha) soma o abono do mês inteiro. Num mês todo cobrado, os dois são iguais.
- No dia incompleto, a linha do saldo e o CSV mostram o abonado do dia, mas ele fica fora do total até alguém corrigir a batida.

## 0.9.0-beta.1 - 2026-10-24

Primeira versão aberta, em beta. O código nasceu de um sistema de ponto em uso real numa empresa e serve a qualquer empresa, cada uma no seu próprio Supabase.

### Adicionado

#### Para quem bate ponto

- Entrar com e-mail e senha uma vez: o aparelho guarda a sessão.
- PIN de 4 dígitos, criado na primeira entrada e pedido a cada batida.
- Bater o ponto com selfie, localização e PIN, com o horário do servidor. O botão diz qual batida a ordem do dia prevê ("Bater entrada", "Bater saída para o almoço"...).
- Comprovante na tela: tipo, horário do servidor, a selfie e a distância até o local de trabalho.
- Batida sem localização quando o GPS não responde. A selfie e o PIN continuam obrigatórios, e a batida fica marcada assim em toda tela, na folha e no CSV.
- Aviso antes da selfie quando o celular está sem internet. Nada fica guardado para depois.
- Pedido de batida esquecida, só no mesmo dia, que entra no ponto quando alguém que administra aprova.
- Espelho do mês: dia a dia, total, as marcas de ajuste, de atraso aprovado, de ausência e de dia incompleto, e a própria selfie de cada batida.
- Convite para instalar o app no celular, com o passo a passo do aparelho (iPhone ou Android).

#### Para quem administra (o RH)

- Painel do período: o total de cada pessoa, a caixa de pedidos para decidir e a lista "Antes de fechar" (pedidos esperando, dias com batida faltando, cabeçalho da folha incompleto).
- A tela de cada pessoa, com todos os dias do período até hoje: corrigir um horário e inserir a batida que faltou, sempre com motivo e trilha (ninguém corrige nem insere a própria batida, nem o super admin); lançar falta justificada com atestado; resetar o PIN.
- Folha mensal para imprimir e assinar (ou salvar em PDF) e exportação em CSV.
- Área de administração: pessoas, local de trabalho (com medição pelo celular), dados da empresa e regras de jornada.
- Fichas de RH: criar, editar, desativar.

#### Para o super admin

- Criar conta com senha provisória (já ligada a uma ficha, se quiser), trocar nome e e-mail e redefinir senha, pela função de contas `ponto-contas`. Cada ação vira uma linha numa trilha, sem a senha.
- Ligar e desligar ficha e conta, e conceder e revogar a administração do ponto.

#### Para quem instala e desenvolve

- O banco numa migration única do Supabase CLI, com RLS em todas as 13 tabelas, testes estáticos no `npm test` e 8 arquivos de testes de banco que rodam no Supabase local e no CI (`npm run db:testar`).
- O banco sobe em qualquer Supabase, como `postgres` e sem superusuário: o plano grátis serve. Numa instalação vazia, a configuração e o local de trabalho nascem pela tela de administração.
- As defesas do banco, do app e da função de contas, descritas em [`SECURITY.md`](SECURITY.md) e provadas pelos testes de banco (`npm run db:testar`).
- Marca configurável: o nome e o slogan vêm de `VITE_NOME_DO_APP` e `VITE_SLOGAN_DO_APP` (padrão: "Ponto", sem slogan), e os ícones são neutros.
- `supabase/primeiro-super-admin.sql`, para o primeiro super admin da instalação.
- Testes de ponta a ponta com Playwright (`npm run e2e`): o cadastro inteiro, da instalação vazia à primeira batida, com câmera e GPS simulados, a função de contas pelo caminho real e, no build de produção, o app inteiro sob a política de conteúdo, sem nenhuma recusa no console (`e2e/csp.spec.ts`).
- Dados de demonstração para o Supabase local (`npm run demo:semear`), com gente fictícia e um mês de batidas, e o roteiro que tira os prints da documentação (`npm run demo:prints`).
- Arquivos de hospedagem prontos: `public/_headers`, `public/_redirects` e `public/404.html` (Cloudflare Pages e Netlify), `vercel.json` (Vercel) e um exemplo de Caddy em `exemplos/servidor/Caddyfile`.
- Documentação: instalação na nuvem, rodar local, cadastro, manual de uso, defesa das decisões, modelo do banco e instalação no celular.

### Limitações conhecidas

- Um Supabase por empresa (não é multiempresa) e um local de trabalho por vez.
- Fuso único: `America/Sao_Paulo`.
- A pessoa não troca a própria senha pelo app; o super admin redefine. Depois de redefinir, o token de acesso antigo ainda vale no banco por até 1 hora, até vencer.
- O teste de ponta a ponta roda no Chrome do computador, com câmera e GPS simulados, e a política de conteúdo também passou no WebKit, numa conferência à parte; nenhum teste automático roda num celular de verdade.
- Sem fila offline, de propósito.
- O JavaScript é um arquivo só: cerca de 220 kB com gzip no build de produção, com as variáveis do Supabase definidas (sem elas, o build sai podado e bem menor).
- O painel conta o dia de hoje, ainda em andamento, como incompleto.
- Sem saldo de horas: a carga diária e a tolerância ficam guardadas, mas ainda não entram em conta nenhuma.
- Não é um REP-P registrado nem gera os arquivos AFD e AEJ da Portaria MTP nº 671/2021. Pela CLT (art. 74, § 2º), o estabelecimento com mais de 20 trabalhadores é obrigado a registrar o ponto: quem passa de 20 deve confirmar com o contador ou o advogado se o Ponto Livre atende ao caso. Veja o aviso legal no [README](README.md#limitações-conhecidas-beta).
