# Como contribuir

Obrigado pelo interesse. O Ponto Livre é mantido nas horas vagas, sem equipe: **não há promessa de resposta rápida** a issue nem a pull request. Correção pequena, com teste, tem mais chance de entrar do que mudança grande.

## Antes de abrir uma issue

- **Falha de segurança:** não abra issue pública. Siga o [`SECURITY.md`](SECURITY.md).
- **Defeito:** diga o que você fez, o que esperava, o que aconteceu, a versão, o aparelho e o navegador. Nunca cole dado real: nome, e-mail, CPF, foto, endereço do seu projeto ou chave.
- **Ideia:** leia antes a [defesa](docs/DEFESA.md). Muita coisa que parece falta é escolha (fila offline, bloqueio por distância, reconhecimento facial), com o porquê escrito.

## Rodar o projeto

O passo a passo completo está em [`docs/RODAR-LOCAL.md`](docs/RODAR-LOCAL.md). O resumo, com Node 22.12 ou mais e o Docker ligado:

```bash
npm ci
npm run db:iniciar    # o Supabase local, com a estrutura do ponto
cp .env.example .env  # e preencha com o que `npx supabase status -o env` mostrar
npm run dev
```

## Como o projeto é escrito

- **Português** no código, nos comentários, nos testes e nas telas.
- **Comentário explica o porquê**: a regra, o risco, a escolha e o que se troca por ela. O que a linha faz, o código já diz.
- **Regras puras em `src/lib/`**, sem React e sem Supabase, com o teste ao lado (`algo.ts` e `algo.test.ts`). A tela desenha; a decisão mora no módulo.
- **Uma conta de horas só**: `src/lib/horas.ts` soma as batidas, e `src/lib/saldo.ts` faz o saldo por cima delas (o previsto, o abono, o atraso, a falta, o saldo do dia e o resumo do mês), com a jornada em `src/lib/jornada.ts`. O espelho, o painel, o CSV e a folha usam as mesmas funções. Não some horas nem calcule saldo em outro lugar.
- **O saldo é puro e sem relógio**: nada de React, Supabase ou `new Date()` em `saldo.ts`; o "hoje" chega como parâmetro. As regras de cada pessoa (a jornada, a tolerância e o primeiro dia cobrado) se montam só em `regrasDoSaldo`, que nenhuma tela refaz à mão. Mudou a conta? O teste mora ao lado, em `src/lib/saldo.test.ts`, com a data, a jornada e as batidas escritas no próprio caso. Os feriados nacionais vêm de `src/lib/feriados.ts`, e a cópia em JavaScript de `demo/feriados.mjs` (da semente e da automação dos prints) muda junto: `src/lib/feriados.test.ts` compara as duas.
- **A tela não é segurança.** Toda regra que importa mora no banco (RLS, gatilhos e funções). Esconder um botão é conveniência.
- **Rota nova** em `src/App.tsx` entra também em `public/_redirects`, `vercel.json` e `exemplos/servidor/Caddyfile`. O `src/hospedagem.test.ts` confere as quatro listas.
- **RPC nova** chamada por uma tela entra no Supabase simulado do teste de fumaça (`src/fumaca-das-rotas.test.ts`), ou ele reprova.
- **Texto de tela** em frases curtas, que dizem o que aconteceu e o que fazer. A recusa do banco é traduzida para quem está usando.

## Mudança no banco

- **Migration nova** em `supabase/migrations/` (`npx supabase migration new <nome>`). Nunca edite as que já existem: as instalações já as aplicaram.
- **Tabela nova:** `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` e, depois, `GRANT` só do que o app usa. Nada para `anon`. Regra de acesso só `TO authenticated`.
- **Função nova:** `SET search_path` fixo, `REVOKE ALL` e `GRANT EXECUTE` explícitos. Se for `SECURITY DEFINER`, confira a sessão (`auth.uid()`) antes do papel.
- **Teste em `supabase/testes/`**, no mesmo molde dos que existem (abre com `BEGIN`, termina em `ROLLBACK`, pessoas sintéticas com e-mail em `example.invalid`), rodado por `npm run db:testar`.
- **As contagens** de `supabase/testes/estrutura.sql` mudam junto, e o `src/banco.test.ts` confere que elas batem com o que as migrations criam, somadas. Veja [`docs/BANCO.md`](docs/BANCO.md#como-mudar-a-estrutura).
- **A ordem de atualização** é sempre a mesma: as migrations antes do app. Uma tela que passa a ler coluna nova quebra num banco sem ela; o app antigo, guardado no celular de alguém, precisa continuar funcionando com o banco novo. Diga no `CHANGELOG.md` quais migrations a versão pede.

## Dados nos testes

- **Nada de dado real**: nem nome, nem e-mail, nem CPF, nem foto de gente de verdade, nem chave.
- Use o elenco fictício que os testes já usam (Ana Beatriz Rocha, Rita Moraes, Sérgio Almeida, Empresa Exemplo Ltda...) e e-mails nos domínios reservados para exemplo (`example.com`, `example.invalid`).
- Deixe CPF e CNPJ vazios sempre que der: um número válido inventado pode ser o de alguém.

## Antes de abrir o pull request

- [ ] `npm run lint`
- [ ] `npm test`. Se o número de testes mudou, a linha do `npm test` no README também muda: `node scripts/conferir-readme.mjs` diz a linha certa.
- [ ] `npm run db:testar` (com `npm run db:zerar` antes, se você mexeu no banco).
- [ ] `npm run e2e` (se mexeu em tela, no cadastro, na batida ou na função de contas, e também se mexeu na política de conteúdo, em `src/lib/politica-de-conteudo.ts`, no `index.html` ou no `vite.config.ts`: o `npm run dev` roda sem a política, e quem a confere no navegador é o projeto `csp` do e2e). Sem Docker na sua máquina, peça no pull request a automação "Prints da documentação" (o rótulo `prints`), que roda o e2e no GitHub.
- [ ] `npm run build`.
- [ ] A documentação acompanha a mudança: README, `docs/` e `CHANGELOG.md` (na seção "Não lançado").

O CI roda a conferência das dependências que vão para o ar (`npm audit --omit=dev --audit-level=high`, que reprova com falha alta ou crítica conhecida), o lint, os testes, a conferência do README, o build, os testes de banco e a busca de segredos no histórico inteiro (gitleaks). O `npm run e2e` não roda em todo push: ele precisa do Chrome e do Supabase local, na sua máquina ou na automação "Prints da documentação" ([`.github/workflows/prints.yml`](.github/workflows/prints.yml)), que também refaz as imagens de `docs/imagens/` quando as telas mudam.

## Licença

Ao contribuir, você concorda que a sua contribuição seja publicada sob a [licença MIT](LICENSE) do projeto.
