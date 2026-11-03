# Prompt: jornada, abono e saldo de horas

Este ajuste já está no Ponto Livre. Se a sua instalação segue o projeto sem mudanças, siga [Atualizar para uma versão nova](../INSTALAR.md#atualizar-para-uma-versão-nova): aplique as duas migrations novas, na ordem, **antes** de publicar o app, e confira a jornada e a data do saldo depois.

O prompt abaixo é para quem mantém **uma cópia modificada** e prefere que um agente de código (Claude Code, Cursor, Codex...) leve o mesmo ajuste para ela. É um ajuste grande: muda o banco, a conta de horas, várias telas, a folha e o CSV. Faça antes uma cópia de segurança do banco ([INSTALAR.md](../INSTALAR.md#cópias-de-segurança)), abra o agente na pasta do seu projeto, cole o texto do bloco e revise o que ele mudar antes de aplicar no banco de verdade.

## O que muda

- **A jornada:** a empresa cadastra a jornada da semana (até dois blocos por dia), e cada ficha pode ter uma jornada própria. A carga diária deixa de ser digitada: o banco a calcula da jornada.
- **O início do saldo:** a configuração ganha "Saldo calculado a partir de". O saldo de cada pessoa começa na mais nova entre essa data e a "Passou a bater ponto aqui em" da ficha.
- **A ausência por horário e o abono:** a ausência se lança por dias ou por um intervalo de horário. Atestado e falta justificada abonam a parte da jornada que cobrem; outro motivo só marca.
- **O saldo nas telas:** o previsto, o abonado, o atraso, a falta e o saldo de cada dia, e o resumo com horas extras, horas negativas e faltas, no espelho, no painel e na folha. O feriado nacional é dia sem jornada.
- **A folha e o CSV:** a folha ganha as colunas do saldo, o total com abono e o "Resumo do mês"; o CSV ganha 9 colunas no fim.
- **As travas:** ninguém, nem o super admin, lança ou cancela a própria ausência, nem muda a própria jornada ou a data da própria ficha.

## As migrations, e a ordem

As duas vão para `supabase/migrations/` com o nome exato, depois da estrutura e nesta ordem:

1. `20261103000043_jornada_e_saldo.sql`
2. `20261103003912_ausencia_por_horario.sql`

Elas vão para o banco **antes** do app novo: o app novo lê as colunas que elas criam, e o app antigo, guardado no celular de alguém, continua funcionando com o banco novo. Se a sua cópia tem migrations próprias, as duas entram depois das que você já aplicou, sem mudar o nome.

## O prompt

```text
Quero levar para o meu projeto (uma cópia modificada do Ponto Livre) a
jornada, o abono e o saldo de horas do Ponto Livre. Leia o código antes de
mudar e siga o estilo dele: português no código, nos testes e nas telas, e
comentário que explica o porquê. Trabalhe num branch novo.

ONDE ESTÁ O ORIGINAL
Acrescente como remoto o repositório público do Ponto Livre de onde a minha
cópia saiu (git remote add upstream <endereço>; git fetch upstream) e use a
main dele como referência, arquivo por arquivo (git show upstream/main:<arquivo>
e git diff <minha base> upstream/main -- <arquivo>). Não faça um merge às
cegas: traga cada parte, adapte ao que eu mudei e me diga onde o meu código
divergia do original.

REGRAS QUE NÃO PODEM MUDAR
- As duas migrations entram como estão, com o mesmo nome, depois das que eu já
  tenho: supabase/migrations/20261103000043_jornada_e_saldo.sql e
  supabase/migrations/20261103003912_ausencia_por_horario.sql. Nenhuma
  migration já aplicada é editada. Se a partida ou a conferência do fim de uma
  delas recusar o meu banco (porque eu mudei uma tabela, um gatilho ou uma
  função que ela toca), pare e me mostre a frase e o motivo, em vez de
  afrouxar a conferência.
- As defesas do banco continuam inteiras: RLS em toda tabela, REVOKE antes de
  GRANT, search_path fixo, nada para anon nem PUBLIC, privilégio por coluna
  nas ausências, ausência que não se apaga e só se cancela, carimbo do autor
  pelo banco e trava de futuro.
- As travas novas valem para toda sessão, inclusive o super admin: ninguém
  lança nem cancela ausência para a própria conta, e ninguém muda a jornada
  própria nem a data "Passou a bater ponto aqui em" (bate_ponto_desde) da
  ficha ligada à própria conta, nem ao criar a ficha já ligada a si, nem ao
  ligar a si uma ficha que já tem as duas.
- O primeiro dia cobrado de cada pessoa é a mais nova entre bate_ponto_desde
  e ponto_configuracao.saldo_a_partir_de, e só a função regrasDoSaldo (em
  src/lib/saldo.ts) monta as regras do saldo. Nenhuma tela as monta à mão.
- A conta do saldo é pura: src/lib/saldo.ts e src/lib/jornada.ts não importam
  React nem Supabase e não leem o relógio ("hoje" é parâmetro). O espelho, o
  painel, a folha e o CSV usam as mesmas funções.
- O trabalhado continua saindo só das batidas (src/lib/horas.ts). O total do
  dia nas telas é o trabalhado mais o abonado, com a conta escrita embaixo.
- O CSV mantém as 18 colunas de antes, na mesma ordem, e as 9 novas vão no
  fim. O saldo negativo vai com o sinal de menos comum ("-8:00"), e a
  neutralização de fórmula continua para todo texto livre.

O QUE TRAZER, NESTA ORDEM
1. O banco: as duas migrations; os testes supabase/testes/jornada_e_saldo.sql
   e supabase/testes/ausencia_por_horario.sql; as contagens e as listas de
   privilégios de supabase/testes/estrutura.sql (some as peças que a minha
   cópia tem a mais); e src/banco.test.ts, que soma o que todas as migrations
   criam.
2. A conta: src/lib/jornada.ts, src/lib/semana-da-jornada.ts e
   src/lib/saldo.ts, com os testes ao lado; src/lib/feriados.ts, se a minha
   cópia ainda não o tem; as leituras das colunas novas em
   src/lib/configuracao.ts, src/lib/cadastro.ts e src/lib/ausencias.ts; e
   src/lib/faltas.ts, src/lib/painel.ts, src/lib/administracao.ts e
   src/lib/inicio-da-administracao.ts.
3. As telas: src/components/EditorDaSemana.tsx e a administração
   (src/pages/Administracao.tsx: a jornada da empresa, a tolerância e
   "Saldo calculado a partir de"); a ficha (src/components/FichaDoFuncionario.tsx
   e src/components/ListaDePessoas.tsx: a jornada própria e a própria ficha
   só para ler); o lançamento por dias ou por horário
   (src/components/LancamentoDeAusencia.tsx e
   src/components/AusenciasDoPeriodo.tsx); o saldo
   (src/components/SaldoDoDia.tsx, DiaDoEspelho, DiaDoPainel e DiaDeAusencia,
   e as páginas Espelho, PainelDaPessoa e Painel).
4. A folha e o CSV: src/lib/folha.ts, src/components/FolhaParaImprimir.tsx,
   src/pages/Folha.tsx e src/lib/csv.ts.
5. Se a minha cópia tem a demonstração e o e2e: demo/semear.mjs,
   demo/feriados.mjs, e2e/cadastro.spec.ts, e2e/demonstracao.spec.ts e
   e2e/preparar.ts.
Para cada tela que a minha cópia mudou, mantenha a minha mudança e acrescente
a do original; se as duas brigarem, pare e me pergunte.

TESTES
- Traga os testes do original junto de cada parte (src/lib/*.test.ts,
  src/telas-da-jornada.test.ts, src/tela-de-lancamento.test.ts,
  src/telas-do-saldo.test.ts e o que mudou em src/fumaca-das-rotas.test.ts) e
  ajuste só o que a minha cópia muda de propósito.
- Rode npm run lint, npm test e npm run build. Se o README tiver a contagem
  de testes, rode node scripts/conferir-readme.mjs e use a linha que ele
  indicar.
- Com o Docker, rode npm run db:zerar e npm run db:testar: os dois arquivos
  novos têm de mostrar só OK. Se puder, rode também npm run e2e.

DOCUMENTAÇÃO
- CHANGELOG.md, na seção "Não lançado": o que muda, a ordem de atualização
  (as migrations antes do app) e a conferência dos horários da jornada que a
  migration monta a partir da carga gravada.
- O que a minha cópia tiver de manual, de guia de instalação e de modelo do
  banco.

ANTES DE TERMINAR
Me mostre o diff por parte, o resultado de cada comando e a lista do que
divergia do original. Não aplique nada no banco de produção: isso eu faço.
```

## Depois de aplicar no banco e publicar

1. Na administração, em **Regras de jornada**, confira a jornada da empresa. A migration a montou a partir da carga que estava gravada: de segunda a sexta, das 08:00 às 12:00 e, à tarde, das 13:00 até completar a carga (com carga de até 4h, um bloco só, a partir das 08:00). A carga é a mesma de antes, mas os horários são aproximados: ajuste aos de verdade.
2. Confira a **Saldo calculado a partir de**. Ela nasce com o dia em que a migration rodou, e nenhum dia antes dela é cobrado. Para cobrar desde o começo do mês, recue a data.
3. Em **Pessoas**, preencha a **Passou a bater ponto aqui em** de quem ainda não tem e dê a jornada própria a quem trabalha em outro horário.
4. Abra uma pessoa no painel e confira o saldo de um dia que você conhece. Lance um atestado por horário de teste numa ficha que não é a sua, confira o "abonou" e cancele.
5. Abra a sua própria ficha: os botões de lançar ausência não aparecem, e a jornada e a data ficam só para ler.
