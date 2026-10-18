# AgendaPro — Documentação Completa do Produto

*Documento vivo. Última atualização: 16/10/2026 (rearquitetura de segurança — ver seção 4.4 e 7). Mantido pelo Claude Code a cada mudança relevante no sistema — sempre que algo novo for construído ou corrigido, este arquivo deve ser atualizado junto.*

---

## 1. Resumo executivo

O **AgendaPro** é uma plataforma de agendamento online da **77 IS Tecnologia & Inteligência**, feita pra barbearias, salões e estúdios de beleza pequenos (1 a 5 profissionais). O cliente final agenda um horário sem precisar criar conta, através de um link público próprio de cada negócio; o dono do negócio tem um painel de gestão próprio; e a 77 IS tem um painel interno separado pra acompanhar cadastros novos e gerenciar o ciclo de trial/assinatura de todos os negócios.

Hoje o sistema tem **4 módulos construídos** (Área pública, Painel do dono, Auto-cadastro, Painel interno 77 IS), rodando sobre Firebase (Authentication + **Firestore**) e hospedado na Vercel com deploy automático a partir do GitHub.

O sistema acabou de passar por uma leva de melhorias ("Fase 1" — ver seção 7): cliente ganhou autoatendimento (cancelar/remarcar o próprio agendamento) e o dono ganhou agendamento manual e remarcação pelo painel.

---

## 2. Links em produção — quem acessa o quê

| Quem acessa | Link | O que encontra lá |
|---|---|---|
| **Cliente final** (de qualquer negócio cadastrado) | `https://77-agendapro.vercel.app/{slug-do-negocio}` — cada negócio tem seu próprio link, gerado a partir do nome escolhido no cadastro. Exemplo do negócio de teste: [`77-agendapro.vercel.app/barbearia-do-joao`](https://77-agendapro.vercel.app/barbearia-do-joao) | Agendamento em 4 passos, sem login — escolhe serviço, profissional, data/horário, confirma com nome + WhatsApp |
| **Dono de um estabelecimento** | [`77-agendapro.vercel.app/admin`](https://77-agendapro.vercel.app/admin) | Login com e-mail/senha próprios. Painel com dashboard do dia, agenda, cadastro de serviços/profissionais, clientes, configurações do negócio, notificações push |
| **Novo negócio se cadastrando** | [`77-agendapro.vercel.app/cadastro`](https://77-agendapro.vercel.app/cadastro) | Formulário de auto-cadastro ("30 dias grátis, sem cartão") — cria a conta na hora, o link já funciona e os 30 dias de teste começam no cadastro (ver seção 5.3) |
| **Felipe / 77 IS** (super-admin) | [`77-agendapro.vercel.app/painel77`](https://77-agendapro.vercel.app/painel77) | Conferência de cadastros novos, visão de todos os negócios (ativos, em trial, suspensos), criação de acesso do dono, log de atividade administrativa |

**Como funciona o acesso de super-admin:** só entra em `/painel77` quem estiver registrado no nó `admins77/{uid}` do Firebase. Diferente do BarOS (que tem um script `set-superadmin.js` pra isso), o AgendaPro **ainda não tem uma ferramenta própria pra conceder esse acesso** — hoje é feito escrevendo direto no Firebase Console. Fica registrado como pendência na seção 9.

---

## 3. O que é o AgendaPro — visão do produto

Pequenos negócios de beleza/estética geralmente organizam agenda por WhatsApp, caderno ou planilha. O AgendaPro substitui isso com um fluxo simples:

1. O dono se **cadastra** (sozinho, sem depender de ninguém da 77 IS pra começar) e recebe um **link público** único do seu negócio.
2. Ele **compartilha esse link** (WhatsApp, Instagram, QR Code impresso no balcão) com os próprios clientes.
3. O **cliente agenda sozinho**, sem criar conta — só informa WhatsApp e nome. O sistema calcula automaticamente quais horários estão realmente livres, considerando duração dos serviços escolhidos, agenda do profissional e agendamentos já existentes.
4. O **dono acompanha tudo pelo painel**: quantos agendamentos tem hoje, quanto já faturou, quem é o próximo cliente, e consegue confirmar/concluir/cancelar atendimentos.
5. A **77 IS** (Felipe) tem visão de todos os negócios — quem está em trial, quem está prestes a vencer, quem virou pagante — num painel separado dos negócios individuais.

---

## 4. Arquitetura técnica

### 4.1 Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML estático + JavaScript puro (ES modules) — sem framework |
| Backend / dados | Firebase Authentication (login) + **Firestore** (dados; migrado do Realtime Database) |
| Funções server-side | Vercel Functions (`api/*.js`) usando Firebase Admin SDK. **Todo acesso do visitante público passa por elas** — o Firestore não aceita leitura nem escrita anônima |
| Hospedagem | **Vercel** — deploy automático a cada push na branch `main` do GitHub |
| Controle de versão | **GitHub** — repositório `77ISTECNOLOGIA/77-agendapro` |
| Projeto Firebase | `agendapro-179cb` |
| Ferramenta de desenvolvimento | Claude Code (desde julho/2026 — antes disso, edição direta pela interface web do GitHub) |

**Nota**: o AgendaPro foi migrado do Realtime Database para o Firestore (mesmo padrão do BarOS). O corte dos dados de produção e a ordem de deploy estão em `CLAUDE.md` (Pendências).

### 4.2 Como as peças se conectam

```
┌──────────────┐     git push      ┌─────────────┐    deploy automático    ┌──────────────────────┐
│   GitHub      │ ───────────────► │   Vercel     │ ───────────────────►   │  77-agendapro          │
│  (código-     │                  │  (build +    │                        │  .vercel.app            │
│   fonte)      │                  │   hospedagem)│                        │  (site no ar)           │
└──────────────┘                  └─────────────┘                        └───────────┬────────────┘
                                                                                        │
                              ┌─────────────────────────────────────────────────────────┼─────────────────────────┐
                              │                                                          │                          │
                              ▼                                                          ▼                          ▼
                    ┌──────────────────┐                                    ┌──────────────────┐        ┌──────────────────┐
                    │  Cliente final    │                                    │  Dono do negócio  │        │  Felipe (77 IS)   │
                    │  /{slug}          │                                    │  /admin            │        │  /painel77         │
                    │  sem login         │                                    │  login próprio     │        │  login próprio      │
                    └─────────┬────────┘                                    └─────────┬─────────┘        └─────────┬─────────┘
                              │                                                        │                             │
                              └───────────────────────────┬────────────────────────────┴─────────────────────────────┘
                                                            │  leitura/escrita direta do navegador
                                                            ▼
                                                  ┌────────────────────────┐
                                                  │  Firebase                │
                                                  │  (projeto agendapro-179cb)│
                                                  │  • Authentication         │
                                                  │  • Realtime Database      │
                                                  └───────────┬──────────────┘
                                                                │
                                                                │ ações sensíveis (nunca no navegador)
                                                                ▼
                                                  ┌────────────────────────┐
                                                  │  Vercel Functions        │
                                                  │  (api/*.js + Admin SDK)  │
                                                  └────────────────────────┘
```

Não existe um "servidor" tradicional guardando estado — o Vercel só entrega arquivos estáticos, e é o navegador de cada usuário que fala diretamente com o Firebase pra ler/escrever a maior parte dos dados. As únicas exceções são as três funções serverless (`api/*.js`), usadas exatamente nos pontos onde não dá pra confiar no navegador: notificar o dono sem vazar dados de outros clientes, calcular disponibilidade de horário sem expor PII, e (a partir da Fase 1, ainda não publicada) deixar o cliente cancelar/remarcar o próprio agendamento mesmo sem ter login.

### 4.3 Modelo de dados (Firestore)

```
admins77/{uid}                        → { role: 'super_admin' } — time da 77 IS
usuarios/{uid}                        → { barbeariaId, role: 'owner' } — índice de bootstrap do dono
cadastrosAguardando/{slug}            → aviso de cadastro novo pra 77 IS conferir (não bloqueia nada)
logs77/{id}                           → log de auditoria das ações do painel interno

barbearias/{slug}/
  ├── (campos do próprio documento)   → nome, endereço, telefone, tipoNegocio, horarioFuncionamento, plano, trialFim, status
  ├── dispositivos/{deviceId}         → token de notificação push do dono (privado)
  ├── servicos/{id}                   → nome, duracaoMin, preco, emoji, ativo, ordem
  ├── profissionais/{id}              → nome, especialidade, comissao, ativo, horarioTrabalho, bloqueios
  ├── clientes/{whatsapp}             → nome, primeiraVisita, ultimoAgendamento, totalAgendamentos (chave = WhatsApp normalizado)
  └── agendamentos/{id}               → clienteWhatsapp, clienteNome, profissionalId, servicos[], dataChave, horario, duracaoMin, valorTotal, status, criadoEm
```

Cada negócio (`barbearia`) é identificado por um `slug` único, que é literalmente o path da URL pública (`/{slug}`) — não existe um ID técnico separado do link que o cliente usa.

### 4.4 Segurança

**Princípio: o visitante anônimo não lê nem escreve nada direto no Firestore.** O link público usa só as funções serverless, que usam o Admin SDK (ignora as regras), validam tudo no servidor e devolvem apenas o que o visitante pode ver.

- **Cliente final**: sem login, identificado por WhatsApp + nome (autodeclarado, sem código de confirmação — limitação conhecida; um OTP por WhatsApp/SMS exige provedor pago).
- **Dono do negócio**: Firebase Authentication (e-mail/senha), vínculo `usuarios/{uid} → barbeariaId`. **Só o servidor cria esse vínculo** (`api/cadastrar-negocio.js` no auto-cadastro, `api/criar-usuario.js` pela 77 IS). Antes, qualquer usuário logado podia se declarar dono de qualquer negócio.
- **Admin interno 77 IS**: Firebase Authentication, vínculo `admins77/{uid} → role: super_admin`.
- **Regras do Firestore** (`firestore.rules`): o dono só lê/escreve o próprio negócio e só altera `nome`, `endereco`, `telefone` e `horarioFuncionamento` do documento principal (`status`, `plano` e `trialFim` são só da 77 IS); agendamentos criados/editados por dono/super-admin têm forma validada; clientes e tokens push são privados; negócios só são criados pelo servidor.
- **Criação de agendamento** (`api/criar-agendamento.js`): preço e duração vêm dos serviços do banco (nunca do navegador); disponibilidade validada **dentro de uma transação** (dois clientes no mesmo horário: só um confirma); recusa negócio suspenso ou com trial vencido há mais de 7 dias; máx. 5 agendamentos futuros por WhatsApp; limite de requisições por IP.
- **Dados de outros clientes nunca são expostos**: `api/negocio.js` e `api/agendamentos-ocupados.js` devolvem só profissional/data/horário/duração/status — sem nome ou WhatsApp, e sem a comissão dos profissionais. `api/agendamento-cliente.js` só devolve o **primeiro nome** no reconhecimento do cliente.
- **XSS**: todo texto vindo de usuário é escapado antes de entrar na tela (`escapeHtml`), inclusive `horario`, `status` e `id` do agendamento no painel do dono (que ficaram expostos pela escrita aberta e foram corrigidos em 16/10/2026); o servidor também só aceita `HH:MM` e `AAAA-MM-DD`.
- **Erros**: as funções nunca devolvem `err.message` ao navegador — só mensagens genéricas ou de regra de negócio.
- **Cabeçalhos** (`vercel.json`): nosniff, X-Frame-Options DENY, Referrer-Policy, HSTS, Permissions-Policy. Sem CSP ainda.
- **Testes**: `npm test` (51 testes das APIs, da exclusão de negócios e da lógica de disponibilidade). As regras do Firestore ainda não têm teste automatizado.

---

## 5. Módulos — o que cada um faz

### 5.1 Área pública (`index.html` / `js/app.js`)

O fluxo que o cliente final vê ao abrir o link do negócio. Cinco telas:

1. **Identificação** — WhatsApp + nome. Se o WhatsApp já existir na base do negócio, reconhece automaticamente ("Bem-vindo de volta, Fulano!").
2. **Serviços** — seleção múltipla (pode escolher mais de um serviço na mesma visita), mostrando duração e preço.
3. **Profissional + data + horário** — grade de profissionais, carrossel dos próximos 14 dias, horários calculados dinamicamente com base na duração total escolhida, horário de trabalho do profissional e o que já está ocupado.
4. **Confirmação** — resumo final antes de agendar.
5. **Sucesso** — resumo + botão pra adicionar o compromisso na agenda do Google.

O sistema revalida a disponibilidade no exato momento da confirmação (não só quando a tela carregou), evitando que dois clientes reservem o mesmo horário ao mesmo tempo.

### 5.2 Painel do dono (`admin.html` / `js/admin.js`)

Depois de fazer login, o dono vê:

- **Dashboard**: agendamentos de hoje, faturamento do dia (dos atendimentos já concluídos), ticket médio, horário previsto de término do expediente, próximo cliente, faturamento por serviço.
- **Agenda**: visão diária dos agendamentos, com filtro por profissional e por status. Ações: marcar como concluído, cancelar, enviar lembrete manual pelo WhatsApp (abre uma conversa já com o texto pronto — o dono precisa clicar em enviar, não é automático).
- **Serviços** e **Profissionais**: cadastro (CRUD completo), incluindo horário de trabalho por dia da semana de cada profissional. Cada serviço pode ser **restrito a certos profissionais** ("Quem realiza este serviço?"); sem restrição, qualquer profissional faz. O cliente só vê, para agendar, os profissionais que realizam todos os serviços escolhidos.
- **Clientes**: listagem com busca, mostrando quantas visitas e quanto cada um já gastou.
- **Configurações**: dados do negócio, horário de funcionamento, QR Code do link público (com download), ativação de notificações push no navegador.

### 5.3 Auto-cadastro (`cadastro.html` / `js/cadastro.js`)

Um negócio novo se cadastra sozinho: escolhe o tipo de negócio (barbearia/salão/estética/nails), nome, um link personalizado (slug, com checagem de que já não existe), dados de contato e cria login (e-mail/senha) na hora. A conta é criada imediatamente no Firebase Authentication e o servidor cria o negócio já em `trial`, com os **30 dias de teste contados a partir do cadastro**.

**Importante**: não há aprovação prévia. O dono já entra no painel (`/admin`) com o e-mail e a senha que criou, o link público já aceita agendamentos e os serviços sugeridos do tipo de negócio já vêm cadastrados. A 77 IS vê o cadastro novo em `/painel77` ("Novos cadastros") e pode recusar um cadastro abusivo, o que suspende o negócio.

### 5.4 Painel interno 77 IS (`painel77.html` / `js/painel77.js`)

Ferramenta de uso exclusivo da 77 IS pra operar o SaaS:

- **Novos cadastros**: lista de cadastros recentes, com "Marcar como visto" (tira da fila; só cadastros antigos, sem trial, ganham os 30 dias aqui), WhatsApp de boas-vindas e recusar (suspende o negócio).
- **Criar acesso do dono**: gera login/senha do dono via função serverless, sem precisar mexer no Console do Firebase.
- **Gestão de negócios**: lista todos com filtro por status/tipo, métricas por negócio (agendamentos, faturamento, clientes), ações de suspender, reativar, estender trial, marcar como pagante.
- **Visão geral**: negócios ativos, cadastros novos, MRR estimado (calculado por um valor fixo por negócio ativo, não uma cobrança real integrada), trials vencendo em 7 dias, negócios inativos há 14+ dias.
- **Excluir negócio**: botão "Excluir" nos negócios **suspensos**, com confirmação digitando o link do negócio e a opção de apagar também o login do dono. É definitivo: apaga o negócio, serviços, profissionais, clientes e agendamentos. Fica registrado no log (sem dados pessoais).
- **Log de atividade**: auditoria de todas as ações acima, com quem fez e quando.

O que esse painel **não faz**: emissão de nota fiscal, cobrança automática de fato (o "marcar como pagante" é um registro manual de que a fatura foi paga por fora), relatório financeiro consolidado exportável.

---

## 6. Decisões de arquitetura — o porquê por trás das escolhas

1. **Realtime Database, não Firestore** — divergência intencional em relação ao BarOS; não há um motivo técnico documentado além de terem sido construídos em momentos/contextos diferentes.
2. **Índice `usuarios/{uid} → barbeariaId`** — resolve o bootstrap de login do dono com uma única consulta, mesmo padrão do índice `usuarios/{uid} → orgId` do BarOS.
3. **`admins77/{uid}` separado de `usuarios/{uid}`** — o acesso de super-admin da 77 IS é um papel à parte, cross-negócio, que não se confunde com ser dono de um negócio específico.
4. **Nenhuma função serverless confia em dado de negócio vindo do navegador** — sempre busca do banco via Admin SDK antes de agir (`api/send-notification.js` só recebe `{slug, agendamentoId}`, nunca o texto da notificação pronto). Corrigido em 23/07/2026 após um achado de segurança real (endpoint permitia disparar notificação com texto arbitrário).
5. **`api/agendamentos-ocupados.js` sem PII** — o front-end público nunca lê `agendamentos` nem `clientes` completos (continha nome + WhatsApp de todo mundo, exposto a qualquer visitante). Disponibilidade é calculada a partir de um endpoint que devolve só `id/profissionalId/dataChave/horario/duracaoMin/status`.
6. **`api/agendamento-cliente.js`** *(Fase 1)* — autoatendimento do cliente (cancelar/remarcar o próprio agendamento). Como o cliente não tem login, as regras do banco bloqueiam qualquer escrita dele num agendamento já existente — essa função usa o Admin SDK, mas só age depois de confirmar que o agendamento pertence mesmo ao WhatsApp informado.
7. **Agendamento manual e remarcação pelo dono** *(Fase 1)* — antes só o cliente conseguia criar um agendamento (pelo link público); agora o dono também consegue, direto do painel, com o mesmo cálculo de disponibilidade e a mesma proteção contra conflito de horário.

---

## 7. Linha do tempo de desenvolvimento

**29/05/2026 a 28/06/2026 — construção inicial.** Módulos base construídos (área pública, painel do dono, painel interno, auto-cadastro, notificações push), via upload direto de arquivos no GitHub web.

**23/07/2026 — segurança e infraestrutura.**
- Correção de um endpoint de notificação push aberto (permitia relay de spam).
- Correção de uma vulnerabilidade real de XSS armazenado (dados dinâmicos não eram sanitizados antes de entrar na tela).
- Regras do Realtime Database versionadas no repositório (já deployadas).
- Correção de vazamento de PII: o sistema parou de expor a lista completa de clientes/agendamentos pro visitante público.

**24/07/2026 — documentação do estado real.** README atualizado e criação do `CLAUDE.md` — nesse processo, identificada e corrigida uma inversão: a documentação descrevia `painel77.html` como painel do dono e `admin.html` como painel interno da 77 IS, quando na verdade é o contrário no código.

**24/08/2026 — Fase 1 de um novo roadmap.** Cliente ganhou tela de "Meus agendamentos" pra cancelar/remarcar sozinho; dono ganhou agendamento manual pelo painel (antes só existia um "Em breve") e remarcação; texto de marketing que prometia "lembrete automático" (que na prática é um botão manual) foi corrigido pra não prometer o que o sistema ainda não faz. Commitado e publicado no mesmo dia.

**17/10/2026 — serviços por profissional, exclusão de negócios e ajustes de uso.** Serviço pode ser restrito a certos profissionais (validado no servidor); super-admin pode excluir definitivamente negócios suspensos; link público só mostra dias com horário livre; cadastro avisa quando o e-mail já tem conta; botão mostrar senha; painel da 77 com sessão de login própria e "Esqueci minha senha".

**16/10/2026 — rearquitetura de segurança.** Auditoria completa apontou: qualquer usuário logado podia virar "dono" de qualquer negócio (regra de `usuarios` aberta); o dono podia editar o próprio `status/plano/trialFim`; `agendamentos` aceitava qualquer texto (XSS armazenado reaberto no painel, faturamento falsificável); checagem de horário só no navegador (corrida entre dois clientes); `clientes` e tokens push legíveis/graváveis por qualquer um. Correções: Firestore fechado para visitantes (tudo via `api/*`), criação de agendamento e auto-cadastro em transação no servidor, regras reescritas, situação comercial (aprovação/trial/suspensão) aplicada no link público, endpoint público de notificação removido, `firebase-admin` 13, suíte de testes. Detalhes e ordem de deploy em `CLAUDE.md`.

---

## 8. Estado atual e próximos passos

A Fase 1 (seção 6, itens 6-7) está **em produção**, publicada via deploy automático da Vercel a partir do push no GitHub.

Não há um roadmap de fases seguintes formalizado ainda para o AgendaPro (diferente do BarOS, que tem 5 fases documentadas) — vale construir um, no mesmo formato, se o Felipe quiser dar continuidade estruturada.

---

## 9. Pendências conhecidas

- **Bootstrap de super-admin manual**: não existe hoje uma ferramenta própria pra conceder acesso a `/painel77` (diferente do BarOS, que tem `scripts/set-superadmin.js`) — é feito escrevendo direto no Firebase Console.
- **Fim do trial**: depois dos 30 dias, o link público continua aceitando agendamentos por mais 7 dias (carência) e então fecha, até a 77 IS marcar o negócio como pagante ou estender o trial. O dono é avisado por um banner no painel nos últimos 7 dias.
- **Deploy e corte**: ver `CLAUDE.md` (Pendências) — ordem migrar dados → código → regras. O Realtime Database antigo precisa virar deny-all depois do corte.
- **Identidade do cliente final** é só o WhatsApp (sem OTP); o limite por IP é melhor esforço.
- **Testes**: há suíte para as APIs e a lógica (`npm test`); faltam testes das regras do Firestore (emulador + Java) e do front.
- **"Lembrete automático"** continua sendo, na prática, um botão que o dono precisa clicar manualmente — a Fase 1 corrigiu o texto de marketing pra não prometer isso, mas a automação de verdade (envio programado, sem intervenção do dono) ainda não existe.

---

## 10. Glossário rápido

- **Realtime Database**: o banco de dados do sistema (parte do Firebase, do Google) — guarda tudo em formato de árvore JSON, diferente do Firestore (usado no BarOS) que é orientado a coleções/documentos.
- **Firebase Authentication**: o serviço que cuida do login (e-mail/senha) do dono e da 77 IS.
- **Slug**: o identificador único de um negócio, usado tanto como chave no banco quanto como o próprio caminho da URL pública (`/{slug}`).
- **Vercel**: onde o site fica hospedado — a cada push no GitHub, publica a nova versão automaticamente.
- **GitHub**: onde o código-fonte fica guardado e versionado.
- **Vercel Function**: um pequeno programa que roda no servidor (não no navegador do usuário), usado só quando é preciso confiar em algo que o navegador não pode garantir sozinho (ex: verificar permissão de super-admin, evitar vazamento de dados de outros clientes).
- **PII**: informação pessoal identificável (nome, telefone, e-mail) — dado que precisa de cuidado extra pra não vazar pra quem não deveria ver.
- **Trial**: período de teste gratuito (30 dias) de um negócio recém-cadastrado antes de virar assinante pagante.
- **Deploy**: o ato de publicar uma nova versão do sistema no ar. No AgendaPro isso é automático a cada push no GitHub.
