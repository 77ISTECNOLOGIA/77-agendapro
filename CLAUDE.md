# AgendaPro — Contexto do Projeto

## O que é

AgendaPro é um produto da **77 IS Tecnologia & Inteligência**, plataforma de agendamento online para barbearias e salões autônomos/pequenos (1 a 5 profissionais). Cliente final agenda sem login via link público/QR Code; dono do negócio tem painel próprio; a 77 IS tem um painel interno de super-admin pra aprovar cadastros e gerenciar trials.

## Stack e workflow (regras fixas)

- **Frontend:** HTML estático + JavaScript puro (ES modules), sem framework
- **Backend/dados:** Firebase Authentication + **Realtime Database** (não Firestore)
- **Serverless:** Vercel Functions (`api/*.js`) com Firebase Admin SDK, credenciais via env vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)
- **Hospedagem:** Vercel, deploy automático a partir do GitHub
- **Projeto Firebase:** `agendapro-179cb`
- **URL de produção:** `77-agendapro.vercel.app`
- **Fluxo de trabalho:** git local + Claude Code (migrado de "só GitHub web" em 2026-07)
- **Idioma:** todo o código, comentários e comunicação em português do Brasil

## Decisões de arquitetura importantes

1. **Realtime Database, não Firestore** — divergência intencional em relação ao BarOS (que usa Firestore); não há justificativa documentada além de terem sido produtos construídos em momentos/contextos diferentes.
2. **`usuarios/{uid} → { barbeariaId, role }`** — resolve o bootstrapping de autenticação do dono, mesmo padrão do índice `usuarios/{uid} → { orgId }` do BarOS.
3. **`admins77/{uid} → { role: 'super_admin' }`** — separa admin interno da 77 IS (acesso a todos os negócios) do dono de um negócio individual (acesso só ao próprio).
4. **Nunca confiar em dado sensível vindo do navegador em função serverless** — `api/send-notification.js` recebe só `{slug, agendamentoId}` e busca o agendamento real via Admin SDK antes de montar a notificação; não aceita `{token, corpo}` prontos (corrigido em 2026-07 após achado de segurança: o formato antigo permitia qualquer um disparar notificação com texto arbitrário).
5. **`api/agendamentos-ocupados.js`** — o front-end público nunca lê `agendamentos` nem `clientes` completos do Realtime Database (continha nome+WhatsApp de todo mundo, exposto a qualquer visitante). Disponibilidade de horário é calculada a partir desse endpoint, que devolve só `id/profissionalId/dataChave/horario/duracaoMin/status`, sem PII (o `id` foi adicionado depois pra permitir a remarcação ignorar o próprio agendamento no cálculo de conflito).
6. **`api/agendamento-cliente.js`** — autoatendimento do cliente (listar/cancelar/remarcar os próprios agendamentos). O cliente não tem Firebase Auth, então `database.rules.json` bloqueia qualquer escrita dele em um agendamento já existente (só a criação inicial é liberada). Essa função usa o Admin SDK, mas só age depois de confirmar que `agendamento.clienteWhatsapp` bate com o WhatsApp informado — nunca confia em "esse agendamento é meu" vindo pronto do navegador, mesmo padrão da decisão #4. Reaproveita a mesma lógica de disponibilidade de `calcularHorariosDisponiveis` (app.js), portada pro contexto serverless.
7. **Agendamento manual e remarcação pelo dono** (`js/admin.js`) — o dono também consegue criar agendamento direto no painel (antes só o cliente criava pelo link público) e remarcar qualquer agendamento existente. Como o dono já está autenticado e tem os dados completos em memória (`state.agendamentos`), o cálculo de horários disponíveis é feito localmente (`calcularHorariosDisponiveisAdmin`), sem precisar da API pública — mas revalida o slot escolhido no momento de salvar, mesma proteção anti-conflito (corrida entre duas reservas simultâneas) que já existia no fluxo do cliente.

## Módulos construídos

| Módulo | Arquivo | Resumo |
|---|---|---|
| Área pública | `index.html` / `js/app.js` | Agendamento em 4 passos, sem login, cliente identificado por WhatsApp. "Meus agendamentos" (Tela 6) permite cancelar/remarcar sozinho via `api/agendamento-cliente.js` |
| Painel do dono | `admin.html` / `js/admin.js` | Dashboard, agenda do dia (com agendamento manual e remarcação), CRUD de serviços/profissionais, clientes, configurações, notificações push |
| Auto-cadastro | `cadastro.html` / `js/cadastro.js` | Novo negócio se cadastra sozinho (cria conta + registro em `cadastrosAguardando`) |
| Painel interno 77 IS | `painel77.html` / `js/painel77.js` | Aprovação de cadastros, gestão de trial/assinatura de todos os negócios, logs |

## Pendências conhecidas

- Regras do Realtime Database cobrem os casos principais mas não foram auditadas path a path por completo — revisar antes de adicionar coleções novas.
- Sem suíte de testes automatizados.

## Convenções ao propor mudanças

- Sempre seguir o padrão de nomenclatura e organização já existente antes de introduzir algo novo.
- Nenhuma função serverless deve confiar em dado de negócio (preço, destinatário, conteúdo de mensagem) vindo direto do corpo da requisição do cliente — buscar do banco via Admin SDK.
- Alterações em `database.rules.json` devem ser explicadas antes de aplicadas e sempre deployadas via `firebase deploy --only database --project agendapro-179cb` — são sensíveis e afetam todos os negócios.
- Preferir soluções que continuem funcionando com git local + Claude Code.
