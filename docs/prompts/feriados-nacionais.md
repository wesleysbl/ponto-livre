# Prompt: feriados nacionais nos dias de uma pessoa

Este ajuste já está no Ponto Livre. Se a sua instalação segue o projeto sem mudanças, basta atualizar o código e publicar de novo: não há migration nova.

O prompt abaixo é para quem mantém **uma cópia modificada** e prefere que um agente de código (Claude Code, Cursor, Codex...) aplique o mesmo ajuste nela. Abra o agente na pasta do seu projeto, cole o texto do bloco e revise o que ele mudar antes de publicar.

## O que muda

Nos dias de uma pessoa, no painel, o sábado e o domingo levam a etiqueta "fim de semana", mas o feriado não levava nada: um feriado numa segunda-feira aparecia como um dia útil qualquer, "Sem batida". Agora o feriado nacional leva a etiqueta "feriado", com o nome dele ("feriado · Nossa Senhora Aparecida"). A etiqueta só marca o dia: o total de horas não muda.

## O prompt

```text
Quero aplicar no meu projeto (uma cópia modificada do Ponto Livre) o ajuste
"feriados nacionais nos dias de uma pessoa". Leia o código antes de mudar e
siga o estilo dele: português no código, nos testes e nas telas, e comentário
que explica o porquê.

OBJETIVO
No painel, nos dias de uma pessoa, o feriado nacional ganha a etiqueta
"feriado · <nome do feriado>", ao lado da data, como o sábado e o domingo
ganham "fim de semana".

REGRAS QUE NÃO PODEM MUDAR
- Sem banco, sem rede e sem migration: os feriados são calculados no app.
- O total de horas não muda: a etiqueta só marca o dia.
- Só os dez feriados nacionais: 01/01 Confraternização Universal, Paixão de
  Cristo (a sexta antes do domingo de Páscoa), 21/04 Tiradentes, 01/05 Dia do
  Trabalho, 07/09 Independência do Brasil, 12/10 Nossa Senhora Aparecida,
  02/11 Finados, 15/11 Proclamação da República, 20/11 Consciência Negra (só
  de 2024 em diante, pela Lei 14.759/2023) e 25/12 Natal. Carnaval, Quarta-
  feira de Cinzas e Corpus Christi são ponto facultativo e ficam de fora.

COMO FAZER
1. Crie src/lib/feriados.ts, sem React e sem Supabase, com:
   - domingoDePascoa(ano: number): string, o domingo de Páscoa em
     AAAA-MM-DD pelo algoritmo de Meeus/Jones/Butcher (calendário
     gregoriano), só com aritmética de inteiros, sem Date local;
   - feriadosNacionais(ano: number): { dia: string; nome: string }[], em
     ordem de data;
   - feriadoNacional(dia: string): string | null, o nome do feriado do dia,
     ou null (também para data inválida, conferida com ehDiaValido de
     src/lib/horas.ts). Guarde os feriados de cada ano num Map depois da
     primeira conta.
2. Em src/lib/corrigir.ts, a interface DiaDaLista ganha
   feriado: string | null, preenchido em listarDiasDoPeriodo com
   feriadoNacional(dia.dia), ao lado de fimDeSemana.
3. Crie src/components/EtiquetasDoDia.tsx, com
   EtiquetasDoDia({ fimDeSemana, feriado }), que desenha
   <Etiqueta tom="neutro">feriado · {feriado}</Etiqueta> quando houver
   feriado e <Etiqueta tom="neutro">fim de semana</Etiqueta> no sábado e no
   domingo.
4. Em DiaDoPainel e DiaSemBatida (src/components/DiaDoPainel.tsx) e em
   DiaDeAusencia (src/components/DiaDeAusencia.tsx): acrescente a prop
   opcional feriado?: string | null (padrão null) e troque o
   {fimDeSemana && <Etiqueta ...>fim de semana</Etiqueta>} por
   <EtiquetasDoDia fimDeSemana={fimDeSemana} feriado={feriado} />.
5. Em src/pages/PainelDaPessoa.tsx, leia feriado de cada dia da lista e
   passe para os três componentes.

TESTES
- src/lib/feriados.test.ts: a Páscoa de 2000 (23/04), 2019 (21/04), 2024
  (31/03), 2025 (20/04), 2026 (05/04), 2027 (28/03) e 2038 (25/04); 12/10/2026
  é Nossa Senhora Aparecida; 03/04/2026 é Paixão de Cristo; Carnaval e Corpus
  Christi de 2026 não são feriado; 20/11/2023 não é e 20/11/2024 é; data
  inválida dá null; 2026 tem dez feriados e 2023, nove.
- Em src/lib/corrigir.test.ts: a lista de outubro de 2026 marca só o dia 12
  como feriado, e o sábado 10 continua só fim de semana.
- Rode npm test, npm run lint e npm run build. Se o README tiver a contagem
  de testes, atualize a linha do npm test.
```
