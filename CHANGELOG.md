# Registro de mudanças

O que muda em cada versão do Ponto Livre. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e a numeração segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

Enquanto a versão começar com 0, qualquer versão nova pode pedir cuidado na atualização. Leia a entrada antes de atualizar, e aplique as migrations novas na ordem.

## Não lançado

### Mudado

- No painel, nos dias de uma pessoa, cada batida mostra a selfie em miniatura no lugar do ícone da câmera, para conferir quem bateu sem abrir foto por foto. O clique continua abrindo a foto grande. As fotos de um dia são assinadas num pedido só, quando o dia chega perto da tela, com os mesmos 2 minutos de validade; sem link, fica a câmera de antes. Sem migration nova: basta atualizar o app. Quem mantém uma cópia modificada pode aplicar o ajuste com o prompt de [`docs/prompts/miniaturas-das-selfies.md`](docs/prompts/miniaturas-das-selfies.md).

## 0.9.0-beta.1 — 2026-10-24

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
