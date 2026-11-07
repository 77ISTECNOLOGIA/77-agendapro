# Levantamento: sinal por Pix com confirmação automática

*Pesquisa feita em 06/11/2026 em páginas oficiais e fontes públicas. Onde não consegui confirmar um dado, está marcado como **não confirmado**. Tarifas mudam com frequência: antes de contratar qualquer serviço, confirme na página do próprio fornecedor ou no contrato.*

## 1. A pergunta

> Dá para o cliente pagar o sinal por Pix e o sistema confirmar o agendamento sozinho, **sem custo** e sem o dono precisar mexer no celular?

## 2. Resposta curta

**Automático + 100% grátis + que funcione para qualquer barbearia: não existe de forma confiável.** O que existe são três caminhos:

| Caminho | Automático? | Custo | Esforço |
|---|---|---|---|
| A. Pix manual com "confia e confere" (sem integração) | Semi | **R$ 0** | Baixo |
| B. API do banco do próprio dono (se o banco não cobrar) | Sim | R$ 0 *se* o banco não cobrar | **Alto** por dono (certificados, credenciais) |
| C. Plataforma de pagamento com a chave do próprio dono | Sim | Taxa pequena por Pix pago | Médio |

## 3. Por que não é simples (como o Pix funciona por trás)

- **Só uma instituição autorizada pelo Banco Central consegue "ouvir" um Pix recebido.** O acesso direto é restrito a instituições financeiras e de pagamento; uma empresa como a 77 IS não consegue ler o Pix do dono por conta própria. Para saber que um Pix caiu, é preciso passar pela **API do banco ou de um PSP** do dono (fontes: [Convergência Digital](https://convergenciadigital.com.br/opiniao/pix-fintechs-vo-acessar-o-spb-mas-a-que-custo); [Fenacon](https://fenacon.org.br/noticias/pix-evolui-e-cobranca-automatica-fica-simples-e-segura-para-empresas-e-clientes/)).
- **QR Code estático** (chave Pix comum): qualquer um paga, quantas vezes quiser, sem identificar *qual agendamento* foi pago. Muitos pagamentos chegam sem identificador, e então não há como casar o Pix com o cliente automaticamente ([discussão no repositório do Bacen](https://github.com/bacen/pix-api/discussions/266)).
- **Cobrança dinâmica** (cada agendamento tem a sua, com um identificador chamado *txid*): paga uma única vez, expira, e o webhook avisa exatamente qual foi paga. **É a única forma realmente automática** e exige API.
- **Regra de tarifa do Banco Central:** pessoa física e MEI, em regra, não pagam tarifa de Pix, **mas podem pagar** ao receber por QR Code dinâmico, ao passar de 30 Pix recebidos no mês, ao receber de pagador empresa ou em conta de uso comercial ([Sebrae](https://agenciasebrae.com.br/dados/saiba-quando-seu-pequeno-negocio-pode-ser-tarifado-ao-usar-o-pix); [Cora](https://www.cora.com.br/blog/pix-gratuito-pessoa-juridica/)). Ou seja: justamente a cobrança dinâmica, que é a que dá automação, é a que o banco *pode* cobrar. As fontes divergem sobre o MEI (algumas dizem que é totalmente isento); o texto da resolução não foi localizado.

## 4. Quem oferece API de Pix e quanto custa

| Fornecedor | Cobrança dinâmica + webhook | Tarifa (encontrada) | Observação |
|---|---|---|---|
| **Woovi (OpenPix)** | Sim, webhook em todos os planos | **0,80%** por Pix pago (mín. R$ 0,50, máx. R$ 5,00) **ou R$ 0,85 fixo**. Sem mensalidade. | [Página de preços](https://woovi.com/pricing). Não informa se atende MEI/PF. |
| **Asaas** | API de cobranças | **R$ 1,59** por cobrança Pix paga (R$ 0,79 nos 3 primeiros meses). Sem mensalidade. PF: 100 recebimentos grátis/mês só por chave/QR estático. | [Página do Pix](https://asaas.com/pix-asaas). Webhook de Pix não detalhado na página. |
| **Efí (Gerencianet)** | Sim (Pix Cob / CobV) | **1,19%** por QR dinâmico. A franquia de 30 Pix grátis **não vale** para a API. | [Tarifas](https://sejaefi.com.br/tarifas) |
| **Mercado Pago** | Sim (webhook `payment`, com assinatura de segurança) | **Não confirmado.** Fontes citam 0,99%; o blog oficial fala em 0% no QR Code. A página oficial bloqueou a leitura. | [Documentação de webhooks](https://www.mercadopago.com.mx/developers/pt/docs/your-integrations/notifications/webhooks) |
| **Banco Inter (PJ)** | Sim, API Pix Cobrança | **Não confirmado.** Relatos conflitantes: citado como gratuito, mas há relato de que passou a cobrar a partir de mar/2024; outro relato (ago/2025) diz que PJ não paga até certo limite. | [Portal do desenvolvedor](https://developers.inter.co) |
| **Sicoob** | Sim, webhook para Pix com *txid* | Relatos de **sem tarifa** na API (fev/2024 e ago/2025), mas exige **certificado digital A1** | Fonte: [discussão do Bacen](https://github.com/bacen/pix-api/discussions/266) e [SDK comunitário](https://github.com/setbytes/pix-sicoob-api) |
| **C6 Bank** | API fora do padrão, via PayGo | Relato de gratuidade (jul/ago/2025), mas o PayGo **não é gratuito** | Idem |
| **Sicredi** | Sim | Começou gratuito e **passou a cobrar** (2025) | Idem |
| **Banco do Brasil** | Sim | Conta digital PJ para MEI: Pix gratuito segundo uma fonte; outras contas PJ: 0,99% (teto R$ 140) em 2024. API **não confirmada**. | Fontes de terceiros |
| **Outros citados** | — | PagBank 1,89%; Itaú 1,45% (mín. R$ 1,75); AbacatePay R$ 0,80; Payzu ~R$ 0,25–0,30 | Valores de 2020–2025, só para ter ordem de grandeza |

**Leitura honesta dos números:** num sinal de, por exemplo, **R$ 20**, as taxas acima custam entre **R$ 0,25 e R$ 1,59** (de ~1% a ~8% do sinal). É barato em valor absoluto, mas **não é zero**. Gratuidade total na API depende do banco do dono e **muda sem aviso** (Inter e Sicredi já mudaram).

## 5. Os três caminhos em detalhe

### A. Pix manual, mas sem o problema que você descreveu (grátis)
A preocupação é correta: se o agendamento cai por falta de confirmação do dono, o cliente que **já pagou** é prejudicado. O desenho abaixo evita isso:
1. O cliente agenda e vê o valor do sinal com **Pix copia-e-cola e QR Code** (gerados pelo sistema, sem custo).
2. O horário fica **reservado por 30 minutos** para o cliente pagar.
3. O cliente toca em **"Já paguei"** (e, se quiser, anexa o comprovante). **A partir daí a reserva não expira mais sozinha.**
4. O dono recebe uma **notificação** e confirma com um toque ("recebi") ou recusa.
5. O dono escolhe o que acontece se **ele demorar**: manter reservado, confirmar automaticamente marcando "sinal a conferir", ou avisar o cliente.
6. Se o cliente **nunca** toca em "Já paguei", o horário volta a ficar livre ao fim dos 30 minutos.

Risco: alguém marcar "já paguei" sem ter pago. Mitigações: lista "sinais a conferir" no painel, bloqueio do cliente que fez isso, e conferência obrigatória antes do atendimento.

### B. API do banco do próprio dono
Tecnicamente é o mais "limpo" (sem intermediário), mas cada barbearia precisaria: ter conta PJ/MEI num banco com API, gerar certificado e credenciais, e informar tudo ao sistema. Para um produto vendido a muitos pequenos donos, **é inviável como padrão**, e a tarifa do banco pode mudar. Serve só para quem já usa Sicoob/Inter etc. e tem apoio técnico.

### C. Plataforma de pagamento com a chave do próprio dono
O dono abre conta em um serviço (Woovi, Asaas, Efí...), cola a **chave de API** no painel, e o sistema cria uma cobrança Pix por agendamento e recebe o aviso de pagamento automaticamente. O dinheiro cai **direto na conta do dono**, e a taxa também é dele. É o caminho automático mais realista; exige guardar a chave do dono com segurança (criptografada) e um endpoint para receber os avisos (webhook).

## 6. Alternativas descartadas
- **Ler notificação do banco no celular do dono** (app que repassa o aviso "Pix recebido"): frágil, não funciona em iPhone e é problema de privacidade.
- **Valor com centavos únicos** para identificar o pagador (R$ 20,07): depende de API para saber que o Pix chegou, então não elimina o problema.
- **A 77 IS receber o dinheiro e repassar:** exige tratar a 77 IS como instituição de pagamento (conta de subcontas, KYC, divisão de valores). Alto custo regulatório e operacional.
- **Pix Automático** (lançado pelo Banco Central em 2025): serve para **débitos recorrentes autorizados** (mensalidades), não para sinal de agendamento. Pode ser útil no futuro para cobrar a assinatura dos donos.

## 7. Recomendação
1. **Agora:** caminho A (grátis, resolve a dor do "cliente pagou e o agendamento caiu").
2. **Quando houver volume:** caminho C com a taxa por conta do dono, ativável por barbearia.
3. **Antes de decidir:** confirmar por escrito com o fornecedor escolhido a tarifa vigente e se MEI/CPF é atendido.
