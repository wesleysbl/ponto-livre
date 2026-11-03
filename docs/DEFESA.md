# A defesa: por que o Ponto Livre é assim

[Voltar ao README](../README.md)

Todo sistema de ponto escolhe entre coisas que não dá para ter juntas: mais controle ou menos atrito, mais prova ou menos dado guardado. Este documento diz cada escolha do Ponto Livre, o porquê dela e o que se perde com ela. Antes de pedir uma mudança, vale ler a decisão que ela desfaz.

| # | Decisão | Em uma linha |
| --- | --- | --- |
| [1](#1-a-distância-não-bloqueia) | A distância não bloqueia | a batida registra onde a pessoa estava; não impede |
| [2](#2-a-foto-é-evidência-não-biometria) | A foto é evidência, não biometria | sem reconhecimento facial; quem olha é uma pessoa |
| [3](#3-o-funcionário-não-escolhe-o-tipo-da-batida) | O funcionário não escolhe o tipo | entrada, almoço, volta e saída saem da ordem do dia |
| [4](#4-o-horário-é-sempre-o-do-servidor) | O horário é o do servidor | o relógio do celular se muda nas configurações |
| [5](#5-não-existe-fila-offline) | Não existe fila offline | sem internet, a batida não acontece |
| [6](#6-batida-não-se-apaga) | Batida não se apaga | corrigir exige motivo e deixa trilha |
| [7](#7-pin-além-da-senha-com-bloqueio) | PIN além da senha | quatro dígitos a cada batida, com bloqueio |
| [8](#8-sem-localização-quando-o-gps-não-responde) | Sem localização quando o GPS não responde | a selfie e o PIN continuam obrigatórios |
| [9](#9-a-ficha-é-separada-da-conta) | A ficha é separada da conta | o cadastro de RH existe antes e depois do login |
| [10](#10-uma-conta-é-uma-pessoa) | Uma conta é uma pessoa | nada de conta dividida |
| [11](#11-quem-recusa-é-o-banco-não-a-tela) | Quem recusa é o banco | a tela ajuda; a regra mora no Postgres |
| [12](#12-uma-conta-de-horas-só) | Uma conta de horas só | o espelho, o painel, o CSV e a folha somam e saldam igual |
| [13](#13-sem-backend-próprio) | Sem backend próprio | o app fala direto com o Supabase |
| [14](#14-pwa-e-não-app-de-loja) | PWA, e não app de loja | instala pelo navegador e atualiza sozinho |
| [15](#15-marca-configurável) | Marca configurável | o nome e o slogan são da empresa que instala |
| [16](#16-dia-com-batida-faltando-não-soma) | Dia com batida faltando não soma | melhor zero do que um número inventado |
| [17](#17-a-batida-esquecida-é-um-pedido) | A batida esquecida é um pedido | só vira batida quando alguém aprova |
| [18](#18-o-super-admin-nasce-por-sql) | O super admin nasce por SQL | ninguém se promove pela internet |
| [19](#19-o-saldo-começa-numa-data) | O saldo começa numa data | atualizar não cria falta nos meses de antes |
| [20](#20-a-jornada-de-quem-já-usava-nasce-da-carga) | A jornada de quem já usava nasce da carga | o saldo sai certo desde o primeiro dia |
| [21](#21-ninguém-decide-o-próprio-ponto) | Ninguém decide o próprio ponto | nem a batida, nem a jornada, nem a ausência |
| [22](#22-o-csv-cresce-no-fim) | O CSV cresce no fim | a planilha de ontem continua lendo o arquivo de hoje |

---

## 1. A distância não bloqueia

**O que é.** A batida guarda a coordenada do celular, a distância até o local de trabalho e a marca "no local" ou "fora do local". Perto ou longe, ela vale.

**Por quê.** Muita equipe trabalha na rua: visita a cliente, reunião externa, obra, entrega. Bloquear pela distância criaria uma exceção por semana, e cada exceção viraria trabalho manual do RH e atrito com quem estava trabalhando de verdade. Registrar e deixar à vista resolve o que importa: o RH vê onde cada batida aconteceu.

**O que se troca.** O ponto não impede ninguém de bater de casa. Quem quer uma cerca que barra precisa de outra ferramenta. Aqui, a cerca é a conferência: o painel mostra que parte das batidas de cada pessoa saiu "fora do local" (em tom de aviso acima de 20%), e a distância de cada batida fica gravada e não muda depois, nem se o local mudar.

## 2. A foto é evidência, não biometria

**O que é.** Cada batida leva uma selfie tirada na hora pela câmera da frente. Ninguém compara a foto com nada: ela fica guardada como prova de quem apertou o botão, e quem olha é uma pessoa.

**Por quê.**

- A pergunta que a foto responde é "foi você quem bateu?". Para isso, uma pessoa que conhece o time basta.
- Uma foto de rosto já é dado pessoal. Transformar o rosto num modelo para comparação é tratar dado biométrico, que a LGPD chama de dado pessoal sensível, com exigências maiores. O Ponto Livre fica do lado de cá: guarda a foto e não extrai nada dela.
- A foto precisa ser do momento. O banco só aceita uma selfie enviada nos últimos 15 minutos, na pasta da própria pessoa. Foto guardada de antes não serve.
- A foto é protegida: bucket privado, cada pessoa vê só as suas, quem administra vê as do time, e o link de cada foto vale por pouco tempo.

**O que se troca.** Não há detecção automática de fraude. Se alguém bater pelo colega, a foto mostra, mas só se alguém olhar. O ponto entrega a prova; a conferência é humana.

## 3. O funcionário não escolhe o tipo da batida

**O que é.** O tipo sai da ordem do dia: a 1ª batida é a entrada, a 2ª a saída para o almoço, a 3ª a volta, a 4ª a saída, e da 5ª em diante "extra". Quem decide é o banco, na hora de gravar. O botão só mostra a previsão.

**Por quê.** Um menu de tipos é um convite ao erro: "bati saída em vez de volta" vira correção manual. Com a ordem, a pessoa só aperta um botão, e o dia fecha sozinho em pares. Quando o RH insere uma batida no meio do dia, o banco reorganiza os tipos pelo horário, e a trilha registra a reorganização.

**O que se troca.** Um dia fora do comum (sem almoço, ou com duas saídas) ganha nomes que não descrevem o que aconteceu. As horas continuam certas, porque a conta é feita aos pares, mas o rótulo pode estranhar.

## 4. O horário é sempre o do servidor

**O que é.** O horário da batida é o do banco, na hora em que ela chega. O celular não manda horário nenhum. O dia de cada batida é calculado no fuso de Brasília (`America/Sao_Paulo`), não no relógio do aparelho.

**Por quê.** O relógio do celular se muda nas configurações. Um sistema de prova não pode aceitar o horário que o aparelho afirma. Com o horário do servidor, celular adiantado, atrasado ou em outro fuso não muda nada.

**O que se troca.**

- Quem esqueceu de bater não corrige sozinho: pede a batida esquecida ([17](#17-a-batida-esquecida-é-um-pedido)) ou pede ao RH.
- O fuso é um só para todo mundo.
- Nem quem administra grava horário no futuro: o banco recusa batida com mais de 1 minuto à frente do relógio dele.

## 5. Não existe fila offline

**O que é.** Sem internet, a batida não acontece, e o app diz isso antes da selfie. Nada fica guardado no celular para enviar depois.

**Por quê.** Num sistema que serve de prova trabalhista, "achei que tinha batido" é pior do que "não bateu". Uma fila local abre três problemas: a batida que nunca sobe, o horário que vira o do celular (porque o do servidor só existe quando chega) e a dúvida sobre o que de fato foi gravado. Sem fila, a resposta é sempre clara: ou apareceu o comprovante, ou não houve batida.

**O que se troca.** Lugar sem sinal não bate. A pessoa procura sinal, ou o RH insere a batida depois, com motivo.

## 6. Batida não se apaga

**O que é.** Nenhuma sessão apaga uma batida, nem a de quem administra. Só uma operação de manutenção feita no próprio banco, sem sessão de usuário e com motivo, consegue apagar, e mesmo assim a linha inteira fica guardada numa tabela permanente; batida que já tem correção não se apaga de jeito nenhum. Corrigir exige um motivo novo, e cada correção vira uma linha permanente com o valor anterior e o novo, quem fez e quando. A pessoa vê a marca "ajuste do admin" no próprio espelho. As trilhas também não se apagam nem se alteram, e a tabela de batidas não se esvazia.

**Por quê.** Prova que se apaga não é prova. Corrigir com trilha mantém as duas coisas: o ponto certo para a folha e a história do que aconteceu.

**O que se troca.** Uma batida inserida por engano não some: hoje o caminho é corrigir o horário dela, com motivo. Anular uma batida inserida por engano é uma melhoria futura.

## 7. PIN além da senha, com bloqueio

**O que é.** A senha entra uma vez; o PIN de 4 dígitos é pedido a cada batida. Ele é guardado só como hash bcrypt, ninguém lê, e o app só alcança o PIN por funções do banco. Cinco erros seguidos bloqueiam a conta, e o bloqueio endurece no mesmo dia (de Brasília): 15 minutos no primeiro, 1 hora no segundo, 24 horas do terceiro em diante. Acertar o PIN não zera essa conta; zeram o reset por quem administra, o PIN novo e o dia seguinte.

**Por quê.** O celular fica logado o tempo todo. Sem o PIN, quem pegasse o aparelho destravado bateria pela pessoa. O PIN é rápido de digitar e prova que é a pessoa quem está com o celular. O bloqueio é da conta, não do aparelho: trocar de celular não dá novas tentativas. E ele cresce com os bloqueios do mesmo dia (15 minutos, 1 hora, 24 horas) porque quatro dígitos são poucos: quem pegasse o celular destravado de alguém testaria uns 15 PINs por dia.

**O que se troca.** Um passo a mais em toda batida. Esqueceu o PIN, só quem administra reseta. E alguém que erre de propósito o PIN de outra pessoa, no celular dela, a deixa sem bater: 15 minutos no primeiro bloqueio e, se insistir no mesmo dia, 1 hora e depois 24 horas. O reset por quem administra solta a conta na hora.

## 8. Sem localização quando o GPS não responde

**O que é.** Quando o GPS não responde ou demora demais, a pessoa pode tentar de novo (de um jeito mais rápido) ou bater sem localização. A selfie e o PIN continuam obrigatórios, e a batida fica marcada "sem localização" no painel, no espelho, na folha e no CSV. Permissão negada não abre essa porta: aí o app só ensina a liberar.

**Por quê.** Dentro de um prédio, o GPS às vezes simplesmente não chega. Recusar a batida nesse caso deixaria a pessoa sem ponto por um problema que não é dela. Negar a permissão é outra coisa: se valesse, desligar a localização viraria o jeito de bater sem dizer onde estava.

**O que se troca.** Algumas batidas ficam sem lugar. O painel conta quantas saíram assim por pessoa, para que a exceção não vire costume sem ninguém ver.

## 9. A ficha é separada da conta

**O que é.** A conta é o login (e-mail e senha). A ficha é o cadastro de RH: nome completo, CPF, matrícula, cargo, admissão. A ficha pode existir antes da conta, e é a ficha ativa ligada à conta que libera o ponto.

**Por quê.**

- A folha que a pessoa assina sai com o nome completo da ficha, e o RH cadastra gente que ainda não tem e-mail do trabalho.
- O nome em toda tela sai da ficha, não do login. Uma conta que muda de dono não leva o nome de outra pessoa para a folha.
- Quem desliga alguém mexe na ficha, e a ficha não se apaga: é dela o nome completo que sai nas folhas já assinadas.

**O que se troca.** São duas coisas para cuidar e um vínculo entre elas. A tela junta tudo numa lista só, uma linha por pessoa, para o RH não precisar pensar nisso a toda hora.

## 10. Uma conta é uma pessoa

**O que é.** Cada pessoa tem a sua conta, e cada conta tem no máximo uma ficha. Conta dividida (um `vendas@example.com` usado por três pessoas) não existe no desenho.

**Por quê.** A batida é da conta. Se três pessoas usam a mesma conta, as batidas das três viram a jornada de uma só, e a folha mente. A foto mostraria quem apertou, mas a conta e a folha não.

**O que se troca.** Cada pessoa precisa de um e-mail próprio. Quando uma conta de setor passa de uma pessoa para outra, quem chega ganha conta nova, e a ficha de quem saiu continua ligada ao histórico dela.

## 11. Quem recusa é o banco, não a tela

**O que é.** Toda regra que importa mora no Postgres: RLS em todas as tabelas, gatilhos que carimbam e guardam, e funções que conferem tudo a cada gravação. A tela esconde o que não serve a cada papel, mas não é ela que segura: quem administra e abre o próprio ponto no painel ainda vê **Corrigir** e **Inserir batida**, e quem recusa é o banco, porque ninguém corrige nem lança o próprio ponto. Quem não entrou não tem privilégio nenhum, e cada função privilegiada confere a sessão antes de olhar o papel.

**Por quê.** O app roda no navegador, que está na mão de quem usa. Qualquer regra que só existisse na tela seria contornável por quem chamasse a API direto. No banco, a regra vale para o app, para a API e para quem mais aparecer.

**O que se troca.** A regra de negócio fica em SQL: mudar exige uma migration nova, com teste, em vez de uma linha na tela. E a recusa vem do banco com uma frase técnica, que o app traduz para quem está usando.

## 12. Uma conta de horas só

**O que é.** As horas são somadas num lugar só, [`src/lib/horas.ts`](../src/lib/horas.ts), e o saldo é calculado num lugar só, [`src/lib/saldo.ts`](../src/lib/saldo.ts), por cima dessa soma: o previsto, o abono, o atraso, a falta, o saldo do dia e o resumo do mês. As regras de cada pessoa (a jornada, a tolerância e o primeiro dia cobrado) se montam numa função só, `regrasDoSaldo`. O espelho do funcionário, o painel do RH, o CSV e a folha impressa usam as mesmas funções. A conta é pura: sem banco, sem tela e sem relógio, com o "hoje" recebido de fora.

**Por quê.** Se a soma ou o saldo morassem em dois lugares, o primeiro conserto num deles faria o celular e a folha discordarem sobre quantas horas a pessoa trabalhou, ou sobre quanto ela deve. Num sistema de prova, essa é a pior divergência possível, e ela apareceria meses depois, numa discussão, e não num teste. Sem relógio dentro, a conta de um dia é a mesma em qualquer aparelho e em qualquer teste. E o saldo não fica gravado: ele é refeito a cada leitura, então cancelar um atestado ou corrigir a jornada refaz o saldo sem nenhum passo a mais.

**O que se troca.** Não dá para ter "uma regra só no CSV". Toda mudança na conta muda as quatro telas de uma vez, que é justamente o ponto. E, como o saldo é refeito a cada leitura, mudar a jornada recalcula também os dias que já passaram: a jornada não tem data de vigência.

## 13. Sem backend próprio

**O que é.** Não existe servidor do Ponto Livre. O app é um site estático que fala direto com o Supabase: o login, o banco e os arquivos. A única peça de servidor é a Edge Function `ponto-contas`, porque criar conta e trocar senha precisam da chave de serviço, que nunca pode ir para o navegador.

**Por quê.** Menos peças, menos custo e menos coisa para cair. Dá para rodar no plano grátis do Supabase e numa hospedagem grátis de site estático. E a segurança fica num lugar só, o banco ([11](#11-quem-recusa-é-o-banco-não-a-tela)).

**O que se troca.** O projeto depende do Supabase. A lógica fica dividida entre o SQL e o app, e o que exige chave de serviço tem de passar pela função.

## 14. PWA, e não app de loja

**O que é.** O app se instala pelo navegador: no iPhone, pelo Safari, em "Adicionar à Tela de Início"; no Android, pelo Chrome, em "Instalar app". Ele vira um ícone e abre em tela cheia, como um aplicativo.

**Por quê.** Sem loja, não há revisão nem conta de desenvolvedor, e uma atualização chega na próxima abertura. Um código só serve ao celular e ao computador do RH.

**O que se troca.** No iPhone, a instalação é pelo Safari, e o ícone não aproveita o login feito no navegador. As permissões de câmera e localização seguem as regras de cada navegador. E o app não manda notificação.

## 15. Marca configurável

**O que é.** O nome e o slogan do app vêm de duas variáveis do build, `VITE_NOME_DO_APP` e `VITE_SLOGAN_DO_APP`. Sem elas, o app se chama "Ponto" e não tem slogan. Os ícones são neutros.

**Por quê.** O app serve a qualquer empresa. Um nome fixo no código apareceria igual em toda instalação.

**O que se troca.** Só o nome e o slogan mudam por variável. Ícones e cores se trocam à mão, nos arquivos. E trocar o nome pede um build novo.

## 16. Dia com batida faltando não soma

**O que é.** Um dia com número ímpar de batidas soma zero até ser corrigido, e aparece como "dia incompleto". O dia de hoje, ainda aberto, aparece como "em andamento".

**Por quê.** As horas são contadas aos pares (entrada e saída). Com uma batida faltando, qualquer número seria um palpite: até que horas a pessoa ficou? Zero com aviso leva alguém a corrigir; um número inventado passaria calado para a folha.

**O que se troca.** O total do mês fica menor até o RH corrigir, o que pode parecer defeito para quem olha sem ler o aviso. O painel e a folha dizem quais dias estão fora do total.

## 17. A batida esquecida é um pedido

**O que é.** Quem esqueceu de bater pede a batida, só no mesmo dia e para um horário antes de agora, com motivo, selfie, localização e PIN. O pedido guarda a hora real em que foi feito e só vira batida quando alguém que administra aprova. Quem pediu nunca decide o próprio pedido, e um pedido não se apaga: é aprovado ou recusado com motivo. Cada pessoa tem no máximo quatro pedidos esperando decisão no mesmo dia: um dia de quatro batidas esquecidas cabe, uma fila sem fim (cada pedido com a sua selfie) não.

**Por quê.** Esquecer de bater acontece, e a pessoa é quem melhor sabe a que horas chegou. Mas um horário declarado não é um horário do servidor: por isso ele passa por alguém antes de entrar no ponto, e a selfie e o local do momento do pedido ajudam a decidir.

**O que se troca.** É trabalho a mais para o RH. E esquecimento de outro dia não tem pedido: o RH insere, com motivo.

## 18. O super admin nasce por SQL

**O que é.** A lista de super admins não aceita gravação de ninguém pela API, nem da chave de serviço. O primeiro super admin entra por um arquivo SQL rodado pelo dono do banco, na instalação ([`supabase/primeiro-super-admin.sql`](../supabase/primeiro-super-admin.sql)), e só a partir de uma conta com o e-mail confirmado: o arquivo recusa a que ninguém provou ser de quem diz. Depois do primeiro, a lista não fica vazia: o banco recusa tirar o último.

**Por quê.** O super admin cria contas, liga fichas e escolhe quem administra. Quem conseguisse se pôr nessa lista pela internet mandaria em tudo. Deixando a porta só no banco, ela só abre para quem já tem acesso ao projeto.

**O que se troca.** Quem instala precisa rodar um SQL uma vez, e trocar de super admin pede acesso ao painel do Supabase.

## 19. O saldo começa numa data

**O que é.** A configuração tem a data **"Saldo calculado a partir de"**. O saldo de cada pessoa (o previsto, a falta, as horas extras e as horas negativas) começa na mais nova entre essa data e a "Passou a bater ponto aqui em" da ficha. Na atualização que trouxe o saldo, a data nasceu com o dia em que a migration rodou; numa instalação nova, ela nasce com o dia em que a configuração é gravada pela primeira vez. Quem administra pode recuar a data, e a tela avisa, antes de salvar, que os dias desde lá passam a ser cobrados.

**Por quê.** Antes do saldo, a data da ficha era só registro, e muita ficha tem a data da admissão, de anos atrás. Começar o saldo pela ficha faria a atualização acusar falta em todos os dias de todos os meses anteriores, de gente que nunca bateu ponto neste sistema naquela época. Com a data da configuração, ninguém é cobrado por um passado que o ponto não registrou, e a regra do saldo continua uma só: a data da ficha só fica mais restrita, nunca mais larga.

**O que se troca.** Um campo a mais na administração, e uma data que vale para a empresa toda: quem quer cobrar desde o começo do mês recua a data de todo mundo. A ficha sem a data não tem nenhum dia cobrado, e a folha avisa isso antes de imprimir.

## 20. A jornada de quem já usava nasce da carga

**O que é.** Antes, a empresa digitava só a carga diária. Na atualização, a migration montou a jornada da empresa a partir dessa carga: de segunda a sexta, das 08:00 às 12:00 e, à tarde, das 13:00 até completar a carga (com carga de até 4h, um bloco só, a partir das 08:00). A carga continua exatamente a mesma, e daí em diante ela é calculada pelo banco a partir da jornada (o maior total de um dia), e não digitada.

**Por quê.** O saldo do dia precisa de uma jornada, e uma jornada vazia faria o saldo de todo mundo sumir até alguém cadastrá-la, ou acusar falta em tudo. Montada da carga, a jornada dá o mesmo total de antes em cada dia útil, então o saldo sai certo desde o primeiro dia, sem esperar ninguém. E com a jornada sempre presente, a conta não precisa de um caminho "sem jornada" para manter e testar.

**O que se troca.** Os horários são aproximados até a empresa conferir na tela. Até lá, a marca de atraso pode sair errada (numa empresa que abre às 9h, todo mundo aparece com uma hora de atraso), e o atestado por horário só abona a parte que cai dentro dos blocos montados. O saldo dos dias sem atestado por horário não muda, porque depende do total do dia. Por isso o guia de atualização e o registro de mudanças pedem a conferência logo depois de atualizar.

## 21. Ninguém decide o próprio ponto

**O que é.** O banco recusa, para toda sessão, inclusive a do super admin: lançar ou corrigir a própria batida, decidir o próprio pedido de batida esquecida, lançar ou cancelar ausência para a própria conta, e mudar a jornada própria ou a data "Passou a bater ponto aqui em" da ficha ligada à própria conta (também ao criar a ficha já com elas, ou ao ligar a si uma ficha que já as tem). A tela esconde os botões na própria ficha e diz por quê; a recusa, porém, é do banco ([11](#11-quem-recusa-é-o-banco-não-a-tela)).

**Por quê.** Quem é dono da batida não decide o próprio ponto: essa regra já valia para a batida. Com o saldo, a jornada, a data de início e a ausência passaram a valer horas tanto quanto a batida. Uma jornada própria mais curta vira hora extra; uma data mais nova apaga faltas; e, com o abono, um atestado lançado para si mesmo vira crédito. Deixar essas três abertas seria deixar a porta dos fundos da regra que a batida já tinha.

**O que se troca.** Numa empresa com uma pessoa só administrando, a jornada, a data e o atestado dela precisam de uma segunda pessoa com administração. A jornada da empresa continua livre para quem administra: ela vale para todos, e mudá-la em causa própria muda também a de todo mundo, à vista.

## 22. O CSV cresce no fim

**O que é.** O CSV do período mantém as 18 colunas de antes, na mesma ordem e com o mesmo conteúdo, e o saldo entra em 9 colunas novas no fim (do "Previsto do dia" ao "Estado do dia"). Como as colunas que já fechavam o dia, elas são preenchidas só na última linha de cada dia. O saldo negativo vai com o sinal de menos comum ("-8:00"), e o positivo, sem sinal.

**Por quê.** Muita empresa monta a planilha da contabilidade em cima do arquivo: fórmulas que apontam para a coluna 17, filtros, tabelas dinâmicas. Coluna nova no meio quebraria tudo isso sem aviso. No fim, a planilha de ontem continua lendo o arquivo de hoje. O sinal de menos comum faz a planilha ler o saldo como número e somar a coluna; um "+" no começo da célula seria lido como fórmula, e por isso o positivo vai sem sinal. A neutralização de fórmula continua valendo para todo texto livre.

**O que se troca.** O saldo fica longe das batidas, lá no fim da linha, e o arquivo fica mais largo. E a linha da ausência mudou o texto da coluna Origem (ela passou a trazer o período, como "Atestado 14:00-16:00"): quem filtrava pelo texto antigo precisa refazer o filtro, e o registro de mudanças avisa.
