# O banco do Ponto Livre

[Voltar ao README](../README.md)

A estrutura inteira é uma migration só, no formato do Supabase CLI: [`supabase/migrations/20261023180000_ponto_livre_estrutura.sql`](../supabase/migrations/20261023180000_ponto_livre_estrutura.sql). Ela cria **13 tabelas, 50 funções, 38 gatilhos, 33 regras de acesso** (27 nas tabelas e 6 nos arquivos) e **2 buckets privados**, sem nenhuma linha de dado, e tira os privilégios padrão do que o `postgres` criar depois. Roda como `postgres`, sem superusuário, e exige o PostgreSQL 17.

O princípio é um só: **quem recusa é o banco**. O app esconde o que não serve a cada papel, mas não é a trava: quem administra e abre o próprio ponto no painel ainda vê **Corrigir** e **Inserir batida**, e quem recusa é o banco. O porquê está na [defesa](DEFESA.md#11-quem-recusa-é-o-banco-não-a-tela).

## As perguntas que o banco sabe responder

Toda regra de acesso se apoia em quatro perguntas, sempre sobre a sessão de quem chama:

| Pergunta | Quando a resposta é sim | Função |
| --- | --- | --- |
| Entra no ponto? | tem uma ficha ativa ligada à conta, ou administra | `ponto_ator_aprovado()` |
| Administra? | está em `ponto_admins` ou em `ponto_super_admins` | `ponto_pode_administrar()` |
| É super admin? | está em `ponto_super_admins` | `ponto_sou_super_admin()` |
| Bate ponto? | tem uma ficha ativa ligada, ou é super admin (só para teste) | `ponto_pode_bater()` |

"Ficha ativa" é a ficha com `ativo` ligado e sem desligamento no passado. No próprio dia do desligamento, a pessoa ainda bate a saída. O app pergunta tudo de uma vez por `ponto_meu_acesso()`, que devolve também o nome e o cargo.

## As tabelas

"Quem administra" é quem responde sim a `ponto_pode_administrar()`, o que inclui o super admin. "A pessoa" é a dona da linha, quando ela entra no ponto.

| Tabela | Para que serve | Quem lê | Quem grava |
| --- | --- | --- | --- |
| `ponto_registros` | as batidas | a pessoa (as dela) e quem administra | a pessoa só pela função `ponto_registrar_batida`, a única que grava origem `app`. Quem administra insere direto, sempre com horário e motivo, e a batida sai `ajuste_admin`; corrige com motivo. Ninguém lança nem corrige a própria batida, nem o super admin. Ninguém apaga |
| `ponto_correcoes` | a trilha de toda mudança numa batida: a linha antes e depois, o motivo, o autor e a natureza (`admin` ou `sistema`) | a pessoa (as dela) e quem administra | só o gatilho da correção. Permanente |
| `ponto_registros_apagados` | a linha inteira de uma batida que uma operação de manutenção apagou, com o motivo | quem administra | só o gatilho do apagamento. Permanente |
| `ponto_pedidos_atraso` | os pedidos de batida esquecida: o horário declarado, o motivo, a selfie, o local e a decisão | a pessoa (os dela) e quem administra | a pessoa pela função `ponto_pedir_batida_em_atraso`; quem administra decide pela `ponto_decidir_pedido_atraso`. Não se apaga |
| `ponto_ausencias` | as faltas justificadas, com o atestado | a pessoa (as dela) e quem administra | quem administra lança e cancela (só o cancelamento muda, uma vez, com motivo). Não se apaga |
| `ponto_funcionarios` | a ficha de RH: nome completo, CPF, matrícula, cargo, admissão, desligamento, CTPS, centro de custo e a conta ligada | a pessoa (a própria) e quem administra | quem administra. Liberar o ponto para uma conta (ligar a ficha ativa, reativar, tirar o desligamento) é só do super admin. Não se apaga |
| `ponto_local` | o local de trabalho: coordenada, raio, quem mediu e quando. No máximo um ativo | quem entra no ponto (`ponto_ator_aprovado()`); a conta sem ficha e sem papel, não | quem administra. Local com batidas não se apaga |
| `ponto_configuracao` | uma linha só: os dados da empresa (o cabeçalho da folha) e as regras de jornada | quem entra no ponto (`ponto_ator_aprovado()`); a conta sem ficha e sem papel, não | quem administra |
| `ponto_pin` | o hash bcrypt do PIN, as tentativas erradas, o bloqueio, os bloqueios do dia e o pedido de redefinir | ninguém pelo app | só as funções do PIN |
| `ponto_pin_tentativas` | o histórico das tentativas de PIN | ninguém pelo app | só as funções do PIN |
| `ponto_admins` | quem administra o ponto, quem concedeu, quando e por quê | quem administra | só o super admin (conceder e revogar). O último não sai |
| `ponto_super_admins` | quem é super admin | a própria linha; quem administra lê a lista | ninguém pela API, nem a chave de serviço: só SQL do dono do banco. Depois do primeiro, não fica vazia: o banco recusa tirar o último |
| `ponto_contas_trilha` | a trilha da função de contas: quem, o quê, quando, antes, depois e o resultado de cada passo. Nunca a senha | o super admin | só a função de contas, com autor super admin. Permanente |

### A batida, coluna por coluna

| Coluna | O que guarda |
| --- | --- |
| `registrado_em` | o horário do servidor. O celular não manda horário |
| `dia_civil` | o dia no fuso de Brasília (`America/Sao_Paulo`). É ele que agrupa o dia e decide o tipo |
| `tipo`, `ordem_no_dia` | a posição no dia: `entrada`, `saida_almoco`, `volta_almoco`, `saida` e, da 5ª em diante, `extra` |
| `latitude`, `longitude`, `precisao_metros` | a coordenada e a precisão que o aparelho informou. Nulas numa batida do app = batida **sem localização** |
| `distancia_metros`, `no_local`, `local_id` | a distância até o local ativo, calculada pelo banco e congelada, e a marca "dentro do raio" (a borda conta como dentro) |
| `selfie_path` | o caminho da selfie no bucket `ponto-selfies` |
| `origem` | `app` (nasce só dentro de `ponto_registrar_batida`) ou `ajuste_admin` (todo INSERT direto, o de quem administra, e a batida esquecida aprovada). Quem decide é o banco, e a correção não a troca |
| `ajuste_manual`, `motivo_ajuste` | a marca de ajuste (não se desliga) e o motivo do lançamento ou da última correção |
| `funcionario_nome`, `funcionario_email` | a fotografia do nome e do e-mail na hora da batida. Não se corrigem: são prova |
| `pedido_atraso_id` | o pedido aprovado de onde a batida nasceu, quando é o caso |

## As funções que o app chama

| Função | Quem chama | O que faz |
| --- | --- | --- |
| `ponto_meu_acesso()` | a sessão, ao abrir o app | se entra, se administra, se é super admin, se bate ponto, o nome e o cargo |
| `ponto_pin_status()` | a sessão, ao abrir o app | se tem PIN, se precisa redefinir, até quando está bloqueado |
| `ponto_definir_pin(p_pin)` | a tela **Crie seu PIN** | grava o hash e zera as tentativas e os bloqueios do dia; recusa se já existe PIN e ninguém resetou |
| `ponto_verificar_pin(p_pin)` | a caixa do PIN | confere e conta a tentativa. Cinco erros seguidos bloqueiam: 15 minutos no primeiro bloqueio do dia, 1 hora no segundo, 24 horas do terceiro em diante (o dia é o de Brasília). Acertar não zera a conta dos bloqueios; zeram o reset por quem administra, o PIN novo e o dia seguinte |
| `ponto_registrar_batida(...)` | a tela de bater | a única porta da batida de quem bate, e a única que grava origem `app`: confere quem bate, a coordenada, a selfie (na convenção, no bucket, com menos de 15 minutos) e o PIN, e grava |
| `ponto_pedir_batida_em_atraso(...)` | **Esqueci de bater hoje** | grava o pedido pendente: só hoje, antes de agora, motivo de 10 a 500 caracteres, selfie e PIN, e no máximo 4 pendentes por pessoa no mesmo dia |
| `ponto_decidir_pedido_atraso(id, aprovar, motivo)` | a caixa de pedidos | recusa (com motivo) ou aprova; a aprovação cria a batida e reorganiza o dia. Quem pediu não decide |
| `ponto_contas()` | a administração | as contas do login (id, e-mail, nome, criada em, último acesso), só para quem administra |
| `ponto_estado_do_pin()` | a lista de pessoas | o estado do PIN de todo mundo, sem o hash, só para quem administra |
| `ponto_resetar_pin(id)` | o painel e a lista de pessoas | marca para redefinir, solta o bloqueio e zera os bloqueios do dia, só para quem administra |
| `ponto_sou_super_admin()` | a função de contas, com a sessão de quem chama | se a sessão é super admin: é daqui que sai o 403 da função |
| `ponto_contas_trilha_pronta()` | a função de contas, com a chave de serviço | se a trilha de contas está pronta para gravar: sem ela, a função responde 503 |

As outras funções são internas: gatilhos, cálculos e as perguntas usadas pelas regras de acesso (como `ponto_pode_administrar()`, que o app recebe pronta em `ponto_meu_acesso()`).

## A função de contas

A Edge Function [`supabase/functions/ponto-contas/`](../supabase/functions/ponto-contas/) faz o que precisa da chave de serviço, que nunca vai para o navegador: `criar_conta` (com `ficha_id` opcional, para já nascer ligada a uma ficha), `trocar_nome`, `trocar_email` e `redefinir_senha`.

Cada pedido passa, nesta ordem, por: sem sessão, **401**; quem chama não é super admin (perguntado ao banco com a sessão dela), **403**; pedido inválido, **400**; a trilha de contas não está pronta, **503**; a conta alvo é de outro super admin, **409**. Só então a ação roda, em passos (o login e a ficha). Se um passo falha, os anteriores voltam. No fim, uma linha em `ponto_contas_trilha`, sem a senha.

O `verify_jwt = true` de [`supabase/config.toml`](../supabase/config.toml) faz o gateway recusar, antes da função, pedido sem um JWT válido do projeto.

As chaves, a função tira do ambiente que o Supabase monta para ela, sem configuração: as novas (`SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS`, a entrada `default` de cada uma) e, sem elas, as legadas (`SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`). Sem nenhuma, ela responde **500** (`configuracao_incompleta`) e não muda nada; o log diz o estado de cada variável, nunca o valor. A regra está em [`chaves.ts`](../supabase/functions/ponto-contas/chaves.ts).

## Os buckets

| Bucket | O que guarda | Caminho | Limite | Quem envia | Quem lê | Quem apaga |
| --- | --- | --- | --- | --- | --- | --- |
| `ponto-selfies` | as selfies das batidas e dos pedidos | `{usuario_id}/{aaaa}/{mm}/{uuid}.jpg`, com o uuid que vira o id da batida ou do pedido | 3 MB; JPEG, PNG ou WebP | a pessoa, na pasta dela e só no caminho da convenção, até 20 por hora e 60 em 24 horas corridas (um teto aproximado: envios simultâneos, em rajada, passam um pouco dele) | a pessoa (as dela) e quem administra | a pessoa (na pasta dela) e quem administra, só a foto que nunca virou prova (a de um envio que não chegou a gravar) e só com mais de 16 minutos |
| `ponto-atestados` | os atestados das ausências | `{usuario_id}/{id-da-ausencia}.{jpg, png, webp, heic ou pdf}` | 10 MB; imagem ou PDF | quem administra | a pessoa (os dela) e quem administra | ninguém |

Os dois são privados: toda leitura passa pelas regras de acesso, e o app abre cada arquivo por um link assinado que expira.

## As proteções principais

**A batida**

- O carimbo (`ponto_carimbar_registro`) decide o dono, o horário do servidor, o dia, o tipo pela ordem do dia, a distância e a marca dentro ou fora, e tira a fotografia do nome. Também recusa a batida repetida dentro da janela de duplicidade (60 segundos por padrão; configurável de 10 a 900).
- O carimbo decide também a origem, pelo papel que executou o comando (anotado por `ponto_anotar_papel_do_comando`, que roda antes dele). Pela API, a origem `app` só nasce dentro da RPC da batida, que confere selfie, PIN e localização. O INSERT direto é sempre o lançamento de quem administra: sai `ajuste_admin`, com a marca de ajuste, exige o horário e o motivo, e recusa quem tenta lançar a própria batida.
- A trava de futuro (`ponto_recusar_horario_no_futuro`) recusa horário mais de 1 minuto à frente do servidor, também na correção de quem administra.
- A reorganização do dia (`ponto_reordenar_dia`) refaz tipo e ordem pelo relógio quando uma batida entra no meio do dia, e deixa trilha de natureza `sistema`.

**A correção e o apagamento**

- `ponto_guardar_correcao` congela a identidade e a origem, recusa a correção feita pelo dono da batida (nem o super admin corrige a própria), exige um motivo novo a cada correção, liga a marca de ajuste (que não se desliga), refaz o dia e a distância quando o horário ou a coordenada mudam, e grava a linha de antes e a de depois.
- `ponto_motivo_e_marca_so_com_correcao` não deixa trocar o motivo nem ligar a marca sem corrigir um campo da batida.
- `ponto_guardar_apagamento` recusa apagar por sessão de usuário. Uma operação de manutenção, sem sessão e com motivo, apaga guardando a linha inteira; batida com correção não se apaga.
- `ponto_trilha_e_permanente` recusa alterar, apagar ou esvaziar as trilhas, e esvaziar a tabela de batidas.

**O PIN**

- Só o hash bcrypt, de 4 dígitos. Cinco erros seguidos bloqueiam a conta, e o bloqueio cresce com os bloqueios do mesmo dia (de Brasília), porque quatro dígitos são poucos: 15 minutos no primeiro, 1 hora no segundo, 24 horas do terceiro em diante. Quem tivesse a sessão aberta de outra pessoa testaria uns 15 PINs por dia.
- Acertar o PIN não zera a conta dos bloqueios do dia (o acerto pode ser do dono, no meio das tentativas de outro). Zeram o reset por quem administra, o PIN novo e o dia seguinte.
- A recusa de PIN volta como resposta, e não como erro, para a tentativa contada não ser desfeita.
- Depois de um reset, o PIN certo não basta: a pessoa precisa criar um novo antes de bater.

**Pedidos e ausências**

- O pedido não se corrige (horário, motivo, selfie e local são a prova), é decidido uma vez só, e só a aprovação liga uma batida a ele. Um pedido aprovado sem batida não chega a existir.
- Cada pessoa tem no máximo 4 pedidos pendentes no mesmo dia. Quando quem administra decide um, a fila anda.
- A ausência confere o tipo, o período (até 120 dias, numa janela de um ano para trás e um para frente), a sobreposição com outra ausência ativa e o atestado no bucket, com o tipo do arquivo batendo com a extensão.

**Pessoas e acesso**

- Só o super admin libera o ponto por uma ficha. Cada conta tem no máximo uma ficha, e o CPF é único entre as fichas ativas.
- As listas de administradores e de super admins não se esvaziam, não se transferem para outra conta e guardam quem concedeu e quando.

**O local e a configuração**

- Mudar a coordenada ou o raio carimba quem mediu e quando. Mudar o local não reescreve batida antiga.
- A configuração é uma linha só, com faixas conferidas: carga diária de 1h a 12h, tolerância de 0 a 60 minutos, janela de 10 a 900 segundos, CNPJ com 14 dígitos e UF com 2 letras.

**Privilégios**

- Toda tabela e toda função nascem com `REVOKE ALL` de `PUBLIC`, `anon`, `authenticated` e `service_role`, e recebem de volta só o que o app e a função de contas usam.
- Os privilégios padrão também saem. O padrão do Supabase dá tudo a `anon` e a `authenticated` em toda tabela, sequência e função nova de `public`, e o PostgreSQL dá `EXECUTE` a `PUBLIC` em toda função nova. Depois da migration, o que o `postgres` criar em `public` nasce sem nada para `anon`, `authenticated` e `PUBLIC` (o `EXECUTE` de `PUBLIC` sai das funções dele em qualquer esquema). O `service_role` continua com o padrão, e o que outro papel cria segue o padrão dele.
- `anon` não tem privilégio nenhum. As regras de acesso são só para `authenticated`, e as dos arquivos filtram pelo bucket do ponto.
- Toda função tem `search_path` fixo. As `SECURITY DEFINER` conferem a sessão antes do papel.

**A partida e o fim da migration**

- Antes da primeira mudança, a migration confere o PostgreSQL 17, o login e o storage do Supabase, os papéis, o `postgres` e a extensão `pgcrypto`. Faltou algo, ela para e explica.
- No fim, confere as contagens (13, 50, 38, 33 e 2), a RLS em toda tabela, que `anon` não tem nada, que a trilha de contas recusa senha e que os privilégios padrão não dão nada a `anon`, `authenticated` nem `PUBLIC`. Se algo não bater, nada fica.

## Os testes de banco

Ficam em [`supabase/testes/`](../supabase/testes/) e rodam no Supabase local com `npm run db:testar` (e no CI). Cada arquivo abre uma transação, cria pessoas sintéticas (e-mails em `example.invalid`), escreve, confere e desfaz tudo no fim.

| Arquivo | O que prova |
| --- | --- |
| `acesso.sql` | o super admin, as listas de administração e o acesso pela ficha |
| `ausencias.sql` | as ausências com atestado: o lançamento, as recusas e o cancelamento |
| `batida_esquecida.sql` | o pedido de batida esquecida, a decisão e a reorganização do dia |
| `blindagem.sql` | a batida que não se apaga, a correção com motivo e trilha, o canal do sistema |
| `estrutura.sql` | o catálogo (contagens, privilégios, RLS, donos) e o contrato de acesso com o app |
| `local.sql` | o local à prova de erro e o carimbo de quem mediu |
| `trava_de_futuro.sql` | a recusa do horário no futuro |
| `trilha_de_contas.sql` | a trilha da função de contas, sem senha e permanente |

Além deles, o `npm test` lê as migrations como texto ([`src/banco.test.ts`](../src/banco.test.ts)) e confere, em cada uma, as regras que toda peça segue: `REVOKE` antes de `GRANT`, RLS ligada, `search_path` fixo, nada para `anon`. Na da estrutura, confere também as contagens do cabeçalho e do fim.

## Como mudar a estrutura

1. **Crie uma migration nova**: `npx supabase migration new <nome>`. Nunca edite a que já existe: as instalações já a aplicaram, e o CLI não aplica de novo.
2. **Siga as regras da casa**: `ENABLE ROW LEVEL SECURITY` em toda tabela nova; `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` e depois `GRANT` só do necessário (com os privilégios padrão revogados, uma tabela ou função nova sem `GRANT` fica fora do alcance do app); regras de acesso só `TO authenticated`; `SET search_path` fixo em toda função; nas `SECURITY DEFINER`, a sessão (`auth.uid()`) antes do papel; comentários em português contando o porquê.
3. **Teste no Supabase local**: `npm run db:zerar` recria o banco aplicando todas as migrations; depois, `npm run db:testar`. Acrescente casos em `supabase/testes/`. Um arquivo novo segue o molde dos outros: o `src/banco.test.ts` confere que todo arquivo da pasta abre com `BEGIN`, termina em `ROLLBACK` e transforma qualquer FALHOU em erro.
4. **Atualize as contagens**: as constantes do começo de `supabase/testes/estrutura.sql` (tabelas, funções, gatilhos, regras e buckets) passam a contar o banco depois de todas as migrations.
5. **Ajuste a conferência das contagens na primeira migration nova que mude as contagens.** As regras de segurança do `src/banco.test.ts` (a transação do CLI, nenhuma troca de papel, `REVOKE` antes de `GRANT`, RLS ligada e nunca desligada, `search_path` fixo, nada para `anon` nem `PUBLIC`, regras só `TO authenticated`) já valem para toda migration de `supabase/migrations/`, em ordem: a nova passa por elas sem mudar nada no teste. As contagens, não: o teste compara as constantes de `estrutura.sql` só com o que a migration da estrutura cria. Uma migration nova que mude essas contagens (uma tabela, função, gatilho, regra de acesso ou bucket a mais ou a menos, ou uma função nova para o app) faz essa comparação reprovar depois do passo 4. Estenda-a para somar o que todas as migrations da pasta criam.
6. **Se uma tela passa a chamar uma RPC nova**, ponha-a no Supabase simulado de `src/fumaca-das-rotas.test.ts`. Se a assinatura de `ponto_registrar_batida` ou de `ponto_pedir_batida_em_atraso` mudar, mude junto o contrato conferido em `estrutura.sql` e o app (que pode estar guardado no celular de alguém, numa versão anterior).
7. **Na nuvem**: `npx supabase db push`.
