# Manual de uso

[Voltar ao README](../README.md)

O dia a dia do ponto, para cada papel. Os nomes dos botões estão **em negrito**, como aparecem no app.

| Papel | Quem é | Onde começa |
| --- | --- | --- |
| [Quem bate ponto](#quem-bate-ponto) | quem tem uma ficha de funcionário ativa ligada à conta | na tela de bater, no celular |
| [Quem administra (o RH)](#quem-administra-o-rh) | quem recebeu a administração do ponto | no painel, no computador |
| [O super admin](#o-super-admin) | quem instalou o ponto (ou quem ele pôs na lista, por SQL) | na administração |

O cadastro do time, passo a passo e com prints, está em [CADASTRO.md](CADASTRO.md).

---

## Quem bate ponto

### A primeira vez

1. Abra o endereço do ponto que a sua empresa mandou. No celular, o app mostra o convite **Instale o app Ponto no celular** (com o nome que a sua empresa deu ao app), com o passo a passo do seu aparelho. Instale antes de entrar: no iPhone, o ícone pede o login de novo. O passo a passo completo está em [INSTALAR-NO-CELULAR.md](INSTALAR-NO-CELULAR.md).

   <img src="imagens/celular-instalar.png" width="280" alt="Convite para instalar o app, na tela de entrar">

2. Entre com o e-mail e a senha provisória que você recebeu. Login é uma vez só: o celular guarda a sessão.

   <img src="imagens/celular-entrar.png" width="280" alt="Tela de entrar no celular">

3. Crie o PIN: 4 dígitos, digitados duas vezes. Ele é pedido a cada batida. O PIN fica guardado embaralhado no servidor, e nem quem administra consegue lê-lo.

### Bater o ponto

1. Toque no botão verde. Ele diz qual batida vem agora, pela ordem do dia: **Bater entrada**, **Bater saída para o almoço**, **Bater volta do almoço**, **Bater saída**. Embaixo, "1ª de 4 hoje · selfie, localização e PIN".

   <img src="imagens/celular-bater.png" width="280" alt="Tela de bater ponto com o botão verde">

2. **Olhe para a câmera** e toque em **Tirar foto**. Em **Ficou boa?**, toque em **Usar esta foto** (ou em **Refazer**).

   <img src="imagens/celular-camera.png" width="280" alt="Tela Olhe para a câmera">

3. O app busca a sua localização. Em lugar fechado, pode levar até 20 segundos.
4. **Confirme com seu PIN**: os 4 dígitos.

   <img src="imagens/celular-pin.png" width="280" alt="Tela Confirme com seu PIN">

5. Pronto: **Batida registrada**, com o tipo, o horário do servidor, a sua foto e onde você estava (**No local** ou **Fora do local**). Toque em **Concluir**.

   <img src="imagens/celular-comprovante.png" width="280" alt="Comprovante da batida registrada">

Bom saber:

- **Você não escolhe o tipo da batida.** A 1ª do dia é a entrada, a 2ª é a saída para o almoço, a 3ª é a volta, a 4ª é a saída, e da 5ª em diante é "batida extra".
- **Com o dia completo**, uma batida a mais pede confirmação: **Você já fechou o dia**, com **Voltar** e **Bater mesmo assim**.
- **A distância não bloqueia.** Bater de casa, do cliente ou da rua é permitido: a batida sai marcada "fora do local".
- **O horário é o do servidor**, e não o do celular.
- **Sem internet, a batida não acontece.** O app avisa antes da selfie ("Sem internet...") e o botão fica em "aguardando internet". Nada fica guardado para depois.
- **Duas batidas seguidas**, uma logo depois da outra (dentro de 60 segundos, o padrão): a segunda é recusada como duplicidade, e a primeira continua valendo.
- Se aparecer **Batida não registrada**, nada foi gravado: a mensagem diz o motivo, e **Voltar e tentar de novo** recomeça.

### Quando o GPS não responde

Se o GPS não responder (ou demorar demais), aparece **Não achamos sua localização**. A sua selfie fica guardada:

- **Tentar a localização de novo**: tenta de um jeito mais rápido, sem abrir a câmera de novo. Chegue perto de uma janela ou saia da sala.
- **Bater sem localização**: a batida sai com a sua foto e o PIN, marcada "sem localização". Use quando tentar de novo não resolver.
- **Tirar outra foto** ou **Cancelar**.

<img src="imagens/celular-sem-localizacao.png" width="280" alt="Tela Não achamos sua localização, com Tentar a localização de novo e Bater sem localização">

Se você **negou** a permissão de localização (ou de câmera), o app não oferece bater sem ela: ele mostra como liberar no seu aparelho. Veja [INSTALAR-NO-CELULAR.md](INSTALAR-NO-CELULAR.md#4-neguei-sem-querer-como-consertar).

### Esqueci de bater hoje

Chegou e esqueceu de bater? Toque em **Esqueci de bater hoje** (embaixo do botão verde).

1. Em **Registrar batida em atraso**, diga **Que horas você chegou ou saiu e esqueceu de bater?** e escreva o **Motivo** (de 10 a 500 caracteres). A tela mostra as batidas que você já tem hoje e onde o horário escolhido cai entre elas.
2. Depois vêm a selfie, a localização e o PIN, como numa batida.
3. **Pedido enviado**: ele fica "Aguardando aprovação do RH".

<img src="imagens/celular-esqueci-de-bater.png" width="280" alt="Formulário Registrar batida em atraso">

- O pedido vale **só para hoje** e para um horário **antes de agora**.
- Cabem **até 4 pedidos esperando decisão** no mesmo dia. Com quatro na fila, o app pede para esperar o RH decidir os que já estão lá.
- A resposta aparece na lista **Seus pedidos de batida em atraso**. Aprovado, ele vira batida e aparece como "em atraso, aprovada". Recusado, você vê o motivo.
- **Esqueceu em outro dia?** Avise o RH, que corrige pelo painel.

### Conferir o mês

**Ver meu espelho do mês** abre **Seu mês**: o total do mês, o saldo do mês e cada dia com as batidas.

<img src="imagens/celular-espelho.png" width="280" alt="Espelho do mês com o total, o saldo do mês e os dias">

- **Total do mês**: as horas das suas batidas, mais as horas abonadas por atestado ou falta justificada. No dia com abono, o total vem com a conta embaixo, como "8h00 · 6h00 trabalhadas + 2h00 de atestado".
- **Saldo do mês**: as suas horas comparadas com a sua jornada, nos dias que já acabaram. Embaixo vêm o **Previsto** (a jornada desses dias), o **Abonado**, as **Horas extras** (o que passou da jornada), as **Horas negativas** (o que faltou, faltas inclusive) e quantas faltas houve. Hoje entra no saldo quando o dia acabar.
- **A linha do saldo de cada dia**: o previsto do dia, o abonado, o atraso, a falta e o saldo do dia. Uma diferença de até a tolerância da empresa (10 minutos, no padrão) não conta. No dia sem jornada (o sábado e o domingo, no padrão) e no feriado nacional, a linha diz **Dia sem jornada** ou **Feriado**, e o que você trabalhou é hora extra.
- **Em andamento**: o dia de hoje, ainda aberto. As horas dele entram no total quando você bater a próxima, e no saldo quando o dia acabar.
- **Dia incompleto**: falta uma batida num dia que já passou. As horas dele não entram no total, e o saldo fica pendente ("Incompleto: saldo pendente"). Avise o RH qual horário faltou.
- **Falta**: o dia da sua jornada que passou sem batida e sem abono aparece na lista, com o saldo negativo do dia.
- **Saldo calculado a partir de**: o saldo só conta a partir de uma data que o RH define. Quando o mês começa antes dela, o espelho diz a data, e os dias de antes ficam fora do saldo.
- As marcas ao lado da batida: **ajuste do admin** (o RH corrigiu ou inseriu, com motivo), **em atraso, aprovada por** alguém, **sem localização**, e **no local** ou a distância.
- Toque numa batida para ver a sua selfie.
- As setas trocam o mês. Embaixo ficam as suas ausências e os seus pedidos do mês.

### Problemas comuns

| O que aparece | O que fazer |
| --- | --- |
| "PIN incorreto... Você ainda tem N tentativas." | Confira o PIN. Cinco erros seguidos bloqueiam. |
| **Conta bloqueada** | O bloqueio é da sua conta, não do aparelho: trocar de celular não adianta. O primeiro do dia dura 15 minutos; o segundo, 1 hora; do terceiro em diante, 24 horas. A tela mostra quanto falta. Espere, ou peça ao RH para resetar o seu PIN, o que solta a conta na hora. |
| Esqueci o PIN | O RH reseta. Na próxima entrada, você cria um novo. |
| Esqueci a senha | Fale com quem cuida do ponto na sua empresa. Quem redefine a senha é o super admin, e ele passa uma nova provisória. |
| "Seu acesso ao ponto não está liberado" | A sua conta ainda não tem ficha ativa. Peça a liberação a quem cuida do ponto na sua empresa (quem libera é o super admin) e toque em **Já fui liberado, verificar**. |
| O app pede login toda vez | Não deveria: login é uma vez só. É sinal de aba anônima ou de um atalho estranho. Instale de novo pelo passo a passo. |

---

## Quem administra (o RH)

Depois de entrar, quem administra e não bate ponto cai direto no painel. Quem administra e também bate vê, na tela inicial, **Corrigir ponto** (com o número de pedidos esperando, como "Corrigir ponto · 2 pedidos esperando"), **Painel do administrador** e **Administração**.

### O painel do mês

**Fechamento do período** mostra o mês de todo mundo que é do ponto.

![Painel do administrador com o fechamento do período](imagens/painel.png)

- **O período**: as setas trocam o mês; **De** e **Até** escolhem qualquer intervalo.
- **Total do período**: as horas de todos, com as horas abonadas por atestado e falta justificada (a conta vem embaixo, como "820h48 trabalhadas + 10h00 de atestado"), quantas pessoas bateram e os dias incompletos (fora do total).
- **Batidas em atraso para decidir**: os pedidos esperando, logo abaixo do título.
- **Antes de fechar** o mês: o que falta resolver, cada item com o link que resolve (**Decidir**, **Corrigir** ou **Preencher**). O dia de hoje não entra nesta lista.
- **O cartão de cada pessoa**: as horas (com o abono, e quanto dele é atestado) e os dias com batida, e as marcas que pedem atenção: **sem acesso ao ponto**, **sem ficha de RH**, dias incompletos, ajustes, batidas em atraso aprovadas, dias de ausência, a parte das batidas que saiu "fora do local" e as que saíram sem localização.
- **Esconder quem não bateu** deixa só quem tem batida no período.
- **Exportar CSV de (período)** e **Administração** ficam ao lado do total.

### Os dias de uma pessoa

Toque no cartão da pessoa. A tela mostra **todos os dias do período até hoje**, inclusive sábado, domingo e dia vazio. O sábado e o domingo levam a etiqueta **fim de semana**, e o feriado nacional leva **feriado**, com o nome dele (por exemplo, "feriado · Nossa Senhora Aparecida"). No saldo, o feriado nacional é dia sem jornada, como o fim de semana. Feriado do estado ou da cidade não tem etiqueta e não entra no saldo: se a empresa não abriu, lance o dia como falta justificada por dias, para cada pessoa.

![Os dias de uma pessoa, com Corrigir, Inserir batida neste dia e Lançar falta neste dia](imagens/painel-pessoa.png)

- **Em cada batida:** **Corrigir** e a miniatura da selfie, que abre a foto grande (o link vale por 2 minutos). Enquanto a miniatura não carrega, ou se ela não vier, aparece o ícone da câmera, que abre a foto do mesmo jeito.
- **Em cada dia:** **Inserir batida neste dia** e **Lançar falta neste dia**. No dia com batida faltando, o botão principal é **Inserir a batida que falta**.
- **No topo:** **Inserir batida esquecida**, **Lançar falta justificada**, **Folha de (mês) para assinar**, **CSV** e **Resetar PIN**.
- **Os pedidos** dessa pessoa esperando decisão aparecem acima dos dias.
- **O total e o saldo do período**, no alto: as horas com o abono e o **Saldo do período**, com o previsto, o abonado, as horas extras, as horas negativas e as faltas. Os dias incompletos ficam fora, e a frase diz quantos.
- **A linha do saldo de cada dia**, a mesma que a pessoa vê no espelho: previsto, abonado, atraso, falta e saldo. O dia de falta aparece na lista, com os botões para inserir a batida ou lançar a ausência.
- Sem **Passou a bater ponto aqui em** na ficha, a tela avisa que nenhum dia da pessoa é cobrado, e o saldo não aparece. Preencha a data em **Pessoas**.
- **Na sua própria ficha**, os botões de lançar e de cancelar ausência não aparecem, e a tela diz por quê: quem é dono do ponto não lança nem cancela a própria ausência.

### Como o saldo é contado

A mesma conta vale no espelho, nos dias de uma pessoa, no painel, na folha e no CSV.

- **Previsto**: a jornada do dia, a própria da ficha ou, sem ela, a da empresa. Dia sem horário na jornada (o sábado e o domingo, no padrão) e feriado nacional são dias sem jornada: sem previsto e sem falta, e o que se trabalha neles é hora extra.
- **Abonado**: a parte da jornada coberta por atestado médico ou falta justificada e que não foi trabalhada. O tempo trabalhado dentro do atestado conta como trabalho, uma vez só, e a parte do atestado fora da jornada (antes do início, no almoço ou depois do fim) não abona. **Outro motivo** só marca o dia.
- **Saldo do dia**: o trabalhado mais o abonado, menos o previsto. Se a diferença fica dentro da tolerância (10 minutos, no padrão), o saldo do dia é zero; passou dela, vale a diferença inteira.
- **Atraso**: a entrada depois do início de um bloco da jornada, além da tolerância. A parte coberta por atestado ou falta justificada não conta: com atestado das 8h às 10h, chegar às 10h não é atraso. A marca é só aviso, porque o tempo do atraso já está no saldo.
- **Falta**: o dia da jornada que passou sem batida e sem abono que cubra o dia inteiro.
- **Hoje** fica em andamento e só entra no saldo quando o dia acaba. O **dia incompleto** fica com o saldo pendente até alguém corrigir a batida. Os dias futuros não contam.
- **Desde quando**: o saldo de cada pessoa começa na mais nova entre a **Passou a bater ponto aqui em** da ficha e a **Saldo calculado a partir de** da empresa (em [Regras de jornada](#a-administração)). Antes dessa data, nenhum dia gera falta nem saldo; o abono do atestado continua somando no total do dia. Ficha sem a data não tem nenhum dia cobrado.
- **Horas extras e horas negativas**: as horas extras somam os saldos positivos dos dias, e as horas negativas, os negativos, faltas inclusive. O saldo do mês é a diferença. Não há banco de horas: o saldo de um mês não passa para o seguinte.
- A jornada não tem data de vigência: mudar a jornada recalcula também os dias que já passaram.

### Corrigir um horário ou inserir uma batida

**Corrigir** abre **Corrigir horário**; **Inserir batida neste dia** abre **Batida esquecida**.

![Caixa de corrigir o horário de uma batida, com o motivo](imagens/corrigir-batida.png)

1. Escolha a **Hora** (e o dia, se for o caso). A caixa mostra as batidas que o dia já tem e como ele fica depois.
2. Escreva o **Motivo** (obrigatório). Ele fica guardado com o seu nome.
3. O botão diz exatamente o que vai fazer, como "Mudar de 12:00 para 12:30 em ..." ou "Inserir 13:00 em ...". **Inserir e continuar** grava e deixa a caixa aberta para a próxima.

- **Ninguém corrige nem insere a própria batida**, nem o super admin. Na sua própria página do painel, os botões aparecem, mas o banco recusa e o app explica: peça a outra pessoa que administra o ponto, ou ao super admin.
- **Batida inserida não se apaga.** Confira o dia e a hora antes de gravar.
- A batida inserida nasce sem foto e sem localização. O sistema reorganiza entrada, almoço, volta e saída pelo horário, então dá para inserir a que faltou em qualquer ponto do dia.
- Toda correção guarda o valor anterior numa trilha permanente, e a pessoa vê a marca "ajuste do admin" no espelho dela.
- O banco recusa horário no futuro.
- Se a pessoa já pediu aquela batida, a caixa avisa: aprove o pedido em vez de inserir.

### Decidir um pedido de batida esquecida

Cada pedido mostra quem pediu, o horário que a pessoa diz, a hora em que ela pediu de verdade, o motivo, a selfie, onde ela estava e como o dia fica com a aprovação.

![Cartão de um pedido de batida em atraso, com Aprovar e Recusar](imagens/pedido-pendente.png)

- **Aprovar**: a batida entra no ponto e o dia se reorganiza pelo relógio. A observação é opcional.
- **Recusar**: o motivo é obrigatório, e a pessoa vai ler esse texto. O pedido continua guardado.
- Quem pediu não decide o próprio pedido: outra pessoa que administra decide.

### Lançar uma ausência, por dias ou por horário

**Lançar falta justificada** (no topo) ou **Lançar falta neste dia** (no dia) abre a caixa. Em **Como lançar**, escolha:

- **Por dias**: a **Data de início** e **Quantos dias**. A **Data final** aparece na hora. A data de início conta como o primeiro dia, e os dias são corridos (sábado, domingo e feriado contam), até 120 de uma vez.
- **Por horário**: a **Data**, **Das** e **Até**, com a **Duração** calculada na hora. Serve para o atestado de um exame ou de uma consulta no meio do dia.

<table>
  <tr>
    <td align="center" width="50%"><img src="imagens/falta-com-atestado.png" width="280" alt="Caixa de lançar uma ausência por dias, com tipo, observação e atestado"><br><sub>Por dias</sub></td>
    <td align="center" width="50%"><img src="imagens/atestado-por-horario.png" width="280" alt="Caixa de lançar um atestado por horário, das 08:00 às 10:00, com a duração de 2h00"><br><sub>Por horário</sub></td>
  </tr>
</table>

Depois:

1. **Tipo**: **Atestado médico**, **Falta justificada** ou **Outro motivo** (este pede observação).
2. **Atestado**: foto ou PDF, opcional. A foto é refeita em JPG no próprio aparelho antes de subir: em geral fica bem menor, e sai sem os dados que a câmera grava no arquivo, como o lugar onde ela foi tirada. O PDF vai como veio, e a foto que o navegador não consegue abrir (HEIC, fora do Safari) também, com esses dados.
3. **Lançar falta justificada**.

- **O abono.** Atestado médico e falta justificada abonam a parte da jornada que cobrem e que não foi trabalhada, sem apagar nenhuma batida: o que a pessoa trabalhou nesse tempo continua contando como trabalho. **Outro motivo** só marca o dia, sem abonar. A marca do dia diz o período e o abono, como "Atestado 08:00-10:00 · abonou 2h00", e o total do dia soma o abonado.
- **Vários intervalos no mesmo dia** valem, e os que só se encostam também (das 14:00 às 16:00 e das 16:00 às 16:30). O banco recusa, com a frase do motivo, o intervalo que cruza outro e o intervalo num dia que já tem uma ausência de dia inteiro.
- Depois de lançada, ela não muda. Para corrigir, toque em **Cancelar** na lista de ausências do período, escreva o motivo, confirme em **Cancelar a ausência** e lance de novo.
- O atestado não se anexa depois: se ele chegar mais tarde, cancele a ausência e lance de novo, com ele.
- **Ninguém lança nem cancela a própria ausência**, nem o super admin: na sua própria ficha, os botões não aparecem, e o banco recusa se alguém tentar por outro caminho. Peça a outra pessoa que administra o ponto. Numa empresa em que só você administra, dê a administração a mais alguém para lançar o seu atestado.
- **Feriado da cidade ou do estado**: lance **Falta justificada**, por dias, para cada pessoa. Ele não entra sozinho no saldo.

### Fechar o mês: a folha e o CSV

**A folha para assinar.** Na tela da pessoa, **Folha de (mês) para assinar** (ou **Imprimir a folha de (mês)**, na lista de pessoas) abre a folha mensal: o cabeçalho com os dados da empresa, o nome completo da pessoa (o da ficha) e o e-mail da conta, um dia por linha, a legenda das marcas e as linhas de assinatura do funcionário e do responsável. **Imprimir ou salvar em PDF** abre a caixa de impressão do navegador.

![Folha de ponto mensal pronta para imprimir, com as colunas do saldo e o resumo do mês](imagens/folha.png)

- **Cada dia** traz os horários e as colunas **Trabalhado** (só as batidas), **Previsto**, **Abonado** e **Saldo**. As marcas (falta, atraso, a ausência com o período e o ajuste do administrador) vão numa segunda linha do mesmo dia.
- **No alto**, o **Total com abono** (quando o mês tem abono), com a conta "trabalhadas + de atestado", e o **Saldo do mês**, com quantos dias de jornada entraram na conta.
- **O "Total do mês"**, no pé da tabela, soma cada coluna. O da coluna Abonado é o mesmo abono do "Total com abono" do alto.
- **O quadro "Resumo do mês"**, no fim: **Horas extras**, **Horas negativas**, **Faltas** e **Saldo do mês**, os mesmos números da tela da pessoa.
- **A legenda** explica só as marcas que o mês usa. Um mês comum cabe numa folha A4.
- **Sem a jornada da empresa cadastrada**, ou sem nenhum dia cobrado no mês, a folha sai sem as colunas do saldo, e uma frase no papel diz por quê.

Se houver ficha sem **Passou a bater ponto aqui em**, dia incompleto, pedido esperando ou cabeçalho incompleto, a folha mostra **Antes de imprimir, confira**, com os links que resolvem, e não abre a impressão sozinha. A ficha sem a data vem primeiro: sem ela, nenhum dia é cobrado, e a folha sairia sem horas extras, horas negativas e saldo.

**O CSV.** **Exportar CSV de (período)** (no painel, de todo mundo) ou **CSV** (na tela da pessoa) baixa uma planilha com uma linha por batida, uma por dia de ausência e uma por dia de falta. Para somar as horas no Excel, use a coluna "Horas do dia (decimal)": ela dá o total direto.

- As 18 primeiras colunas são as de sempre, na mesma ordem. Depois vêm as 9 do saldo: **Previsto do dia**, **Abonado do dia**, **Saldo do dia**, **Crédito do dia**, **Débito do dia**, **Falta no dia**, **Atraso do dia**, **Ausências do dia** e **Estado do dia** ("Fechado", "Saldo pendente", "Em andamento" ou "Não cobrado").
- Como as colunas que fecham o dia, elas são preenchidas só na última linha de cada dia: a soma de uma coluna dá o total do período.
- O saldo negativo vai com o sinal de menos ("-8:00"), e a planilha o lê como número. Crédito, débito e atraso não têm sinal.
- Na linha de ausência, a coluna Origem traz a marca com o período, como "Atestado 14:00-16:00 (atestado anexado)".

### Resetar o PIN

**Resetar PIN**, na tela da pessoa ou na linha dela em **Pessoas**. Na próxima entrada, ela cria um PIN novo. O bloqueio por tentativas erradas, se houver, também sai na hora, e a conta dos bloqueios do dia volta a zero.

### A administração

**Administração** abre com seis cartões, cada um com o que espera por você: **Batidas em atraso**, **Pessoas**, **Ausências** (as do mês, e a regra do abono), **Local de trabalho**, **Dados da empresa** e **Regras de jornada** (a carga diária, a tolerância e a janela).

![Página inicial da administração, com os seis cartões](imagens/administracao.png)

**Pessoas.** Uma lista só, uma linha por pessoa: a conta, a ficha, a administração e o PIN. **Buscar por nome, e-mail ou CPF** filtra. Quem administra (sem ser super admin) pode:

- abrir **Ver e corrigir o ponto de (nome)** e **Imprimir a folha de (mês)**;
- **Resetar PIN**;
- cuidar das fichas: **Nova ficha sem conta**, **Editar a ficha** e **Desativar a ficha**.

Criar a conta, trocar e-mail, redefinir senha e ligar a ficha à conta são tarefas do super admin.

Na ficha, dois campos decidem o saldo da pessoa:

- **Passou a bater ponto aqui em**: o saldo dela começa na mais nova entre esta data e a **Saldo calculado a partir de** das regras de jornada. Em branco, nenhum dia da pessoa é cobrado. A data não libera nem bloqueia a batida.
- **Jornada desta pessoa**: **Usar a da empresa** (a ficha acompanha a jornada da empresa quando ela muda) ou **Jornada própria**, que abre o mesmo editor da semana da empresa e vale no lugar dela em todos os dias.
- **Na sua própria ficha**, os dois ficam só para ler, com a frase do porquê: quem é dono da ficha não muda a própria jornada nem a data em que passou a bater ponto. Outra pessoa que administra faz isso. Os outros campos se editam como em qualquer ficha.

![Lista de pessoas com a conta, a ficha, a administração e o PIN](imagens/pessoas.png)

**Local de trabalho.** O lugar que decide se a batida é "no local" ou "fora do local".

![Formulário do local de trabalho, com latitude, longitude e raio](imagens/local-de-trabalho.png)

- **Nome do local**, **Latitude**, **Longitude** (graus decimais, com vírgula ou ponto; dá para colar o par copiado do mapa num campo só) e **Raio, em metros**.
- **Usar a localização deste aparelho** mede onde o aparelho está: use o celular, parado, de dentro do local. Um notebook em casa mediria a casa.
- **Conferir este ponto no mapa** abre o mapa para conferir.
- **Salvar o local**. Mudar o local não muda batida antiga: cada uma guarda a distância calculada quando foi gravada.

**Dados da empresa.** Razão social, nome de fantasia, CNPJ, endereço, cidade e UF: o cabeçalho da folha. Campo em branco imprime em branco.

**Regras de jornada.** A jornada da empresa vale para quem não tem jornada própria na ficha, e é dela que sai o saldo de horas de cada dia.

![Regras de jornada: a jornada da empresa na semana, a tolerância, a janela e a data do saldo](imagens/jornada-da-empresa.png)

- **Jornada da empresa**: a semana inteira, de segunda a domingo. Cada dia tem até dois blocos de horário (**Início** e **Fim**), e o total do dia aparece na hora. **Acrescentar horário** abre um bloco; o **x** tira. Dia sem horário é dia sem jornada. Cada dia com jornada soma de 1h a 12h.
- **Carga diária**: não se digita. É o maior total de um dia, e o banco a calcula ao salvar.
- **Tolerância, em minutos**: vale por dia. Quando as horas do dia ficam até esse tanto acima ou abaixo da jornada, o saldo do dia é zero, e a marca de atraso só aparece acima dela.
- **Janela que recusa batida repetida**: entre 10 e 900 segundos (padrão: 60). Vale já na próxima batida.
- **Saldo calculado a partir de**: o saldo e as faltas de cada pessoa só contam a partir da mais nova entre esta data e a **Passou a bater ponto aqui em** da ficha. Antes dela, nenhum dia é cobrado. Ela nasce com o dia em que o ponto ganhou o saldo (o da atualização ou, numa instalação nova, o dia em que a configuração da empresa é gravada pela primeira vez), para a data da ficha, que pode ser a admissão de anos atrás, não acusar falta nos meses de antes. Recuar a data faz os dias desde lá serem cobrados, inclusive as faltas, e a tela avisa antes de salvar. A data vale para a empresa toda.
- **Salvar a jornada e as regras** grava tudo de uma vez.

---

## O super admin

O super admin faz tudo o que quem administra faz e mais o que mexe em contas e em acesso. Ele nasce na instalação, por SQL ([INSTALAR.md, passo 5](INSTALAR.md#5-criar-o-primeiro-super-admin)).

### As contas

- **Nova conta**: **Nome da pessoa**, **E-mail para entrar**, **Senha provisória** (com **Sugerir outra senha**) e **Ficha do ponto** (uma ficha que já existe, **Criar uma ficha nova com este nome** ou **Sem ficha por enquanto**). Clique em **Criar a conta**.
- A senha provisória aparece **uma vez**. Copie antes de confirmar e passe à pessoa por um canal seguro.
- **Trocar o nome**, **Trocar o e-mail** e **Redefinir a senha** ficam na linha da pessoa. Redefinir gera uma nova senha provisória: é assim que alguém "troca de senha".
- Cada uma dessas ações fica numa trilha (quem, o quê e quando), sem a senha.

### As fichas e o acesso

- **Ligar a uma ficha** (na linha da conta) ou **Ligar a uma conta** (na linha da ficha). Quando o nome combina, aparece **Ligar à sugerida**. Confira o e-mail: um vínculo errado dá a jornada de uma pessoa para outra.
- **Desligar da conta** tira a ficha da conta: na próxima abertura do app, a pessoa deixa de bater ponto por ela. A ficha continua existindo, e as batidas antigas não mudam.
- **Reativar a ficha** de quem está ligado a uma conta devolve o ponto a essa conta, e por isso é só do super admin.

### Quem administra

- **Conceder admin**, com **Por que esta pessoa? (opcional)**, e **Revogar admin**.
- O banco não deixa o ponto ficar sem nenhum administrador depois que alguém foi nomeado: para tirar o último, conceda antes a outra pessoa.

### O que nem o super admin faz pelo app

- Mudar a lista de super admins: só por SQL, no painel do Supabase.
- Trocar o e-mail de uma conta de super admin: só pelo painel do Supabase.
- Mexer na conta de outro super admin.
- Corrigir ou inserir a própria batida, ou decidir o próprio pedido de batida esquecida: isso é com outra pessoa que administra.
- Lançar ou cancelar a própria ausência, ou mudar a própria jornada e a data **Passou a bater ponto aqui em** da própria ficha: também com outra pessoa que administra.
- Apagar uma batida: ela se corrige, com motivo e trilha.

Sem ficha ativa ligada à conta, as batidas do super admin servem só para teste e não entram na folha de ninguém do time. Com uma ficha ativa ligada, ele bate pela ficha, como qualquer pessoa.

O caminho completo do cadastro, com um print por passo, está em [CADASTRO.md](CADASTRO.md).
