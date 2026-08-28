# AgendaPro — Contexto do Projeto

## O que é

AgendaPro é um produto da **77 IS Tecnologia & Inteligência**, plataforma de agendamento online para barbearias e salões autônomos/pequenos (1 a 5 profissionais). Cliente final agenda sem login via link público/QR Code; dono do negócio tem painel próprio; a 77 IS tem um painel interno de super-admin pra aprovar cadastros e gerenciar trials.

## Stack e workflow (regras fixas)

- **Frontend:** HTML estático + JavaScript puro (ES modules), sem framework
- **Backend/dados:** Firebase Authentication + **Firestore** (migrado do Realtime Database — ver decisão #9)
- **Serverless:** Vercel Functions (`api/*.js`) com Firebase Admin SDK, credenciais via env vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)
- **Hospedagem:** Vercel, deploy automático a partir do GitHub
- **Projeto Firebase:** `agendapro-179cb`
- **URL de produção:** `77-agendapro.vercel.app`
- **Fluxo de trabalho:** git local + Claude Code (migrado de "só GitHub web" em 2026-07)
- **Idioma:** todo o código, comentários e comunicação em português do Brasil

## Decisões de arquitetura importantes

1. **Realtime Database, não Firestore, era a escolha original** — divergência intencional em relação ao BarOS (que usa Firestore); não havia justificativa documentada além de terem sido produtos construídos em momentos/contextos diferentes. Migrado pra Firestore em 2026-08 (ver decisão #9) — agora os 3 produtos da 77 IS seguem o mesmo padrão de banco.
2. **`usuarios/{uid} → { barbeariaId, role }`** — resolve o bootstrapping de autenticação do dono, mesmo padrão do índice `usuarios/{uid} → { orgId }` do BarOS.
3. **`admins77/{uid} → { role: 'super_admin' }`** — separa admin interno da 77 IS (acesso a todos os negócios) do dono de um negócio individual (acesso só ao próprio).
4. **Nunca confiar em dado sensível vindo do navegador em função serverless** — `api/send-notification.js` recebe só `{slug, agendamentoId}` e busca o agendamento real via Admin SDK antes de montar a notificação; não aceita `{token, corpo}` prontos (corrigido em 2026-07 após achado de segurança: o formato antigo permitia qualquer um disparar notificação com texto arbitrário).
5. **`api/agendamentos-ocupados.js`** — o front-end público nunca lê `agendamentos` nem `clientes` completos do Realtime Database (continha nome+WhatsApp de todo mundo, exposto a qualquer visitante). Disponibilidade de horário é calculada a partir desse endpoint, que devolve só `id/profissionalId/dataChave/horario/duracaoMin/status`, sem PII (o `id` foi adicionado depois pra permitir a remarcação ignorar o próprio agendamento no cálculo de conflito).
6. **`api/agendamento-cliente.js`** — autoatendimento do cliente (listar/cancelar/remarcar os próprios agendamentos). O cliente não tem Firebase Auth, então `database.rules.json` bloqueia qualquer escrita dele em um agendamento já existente (só a criação inicial é liberada). Essa função usa o Admin SDK, mas só age depois de confirmar que `agendamento.clienteWhatsapp` bate com o WhatsApp informado — nunca confia em "esse agendamento é meu" vindo pronto do navegador, mesmo padrão da decisão #4. Reaproveita a mesma lógica de disponibilidade de `calcularHorariosDisponiveis` (app.js), portada pro contexto serverless.
7. **Agendamento manual e remarcação pelo dono** (`js/admin.js`) — o dono também consegue criar agendamento direto no painel (antes só o cliente criava pelo link público) e remarcar qualquer agendamento existente. Como o dono já está autenticado e tem os dados completos em memória (`state.agendamentos`), o cálculo de horários disponíveis é feito localmente (`calcularHorariosDisponiveisAdmin`), sem precisar da API pública — mas revalida o slot escolhido no momento de salvar, mesma proteção anti-conflito (corrida entre duas reservas simultâneas) que já existia no fluxo do cliente.
8. **Duas travas de negócio no autoatendimento do cliente, só nele** (`api/agendamento-cliente.js`) — o dono nunca é afetado, remarca/cancela pelo painel sem limite. (a) Cliente só cancela ou remarca até 1 dia (data corrida) antes do agendamento original — depois disso, o botão some da tela e a API também recusa (defesa em profundidade). (b) Cliente só remarca 1 vez por agendamento (`agendamento.remarcacoesCliente`, incrementado só nessa API — remarcação feita pelo dono não conta nem reseta essa contagem). Nos dois casos, quando o limite bate, a orientação é falar direto com o estabelecimento. De brinde, corrigido um bug latente de fuso horário nessa função: o cálculo de "hoje" usava o relógio local do processo Node (UTC na Vercel), mesma classe de bug já corrigida no BarOS — agora usa `Intl.DateTimeFormat` fixado em `America/Sao_Paulo`.

9. **Migração de Realtime Database pra Firestore, replicando o padrão do BarOS e a mesma migração feita no Cardápio Digital.** Motivo: padronizar os 3 produtos da 77 IS no mesmo modelo de banco (Firestore), depois que o Cardápio Digital passou por um bug de `PERMISSION_DENIED` intermitente em escritas sensíveis do CRM direto do navegador — o AgendaPro já não tinha esse problema específico (já usava funções serverless pra tudo sensível), mas ganhou em consistência entre produtos. Decisões:
   - **Schema**: `admins77/{uid}`, `usuarios/{uid}`, `cadastrosAguardando/{slug}` e `logs77/{id}` viraram coleções Firestore quase 1:1. `barbearias/{slug}/info` (que era um sub-nó) virou os próprios campos do documento `barbearias/{slug}` — não precisa mais de sub-nó porque cada doc no Firestore já é sua própria unidade de leitura/segurança. `servicos`, `profissionais`, `clientes` e `agendamentos` continuam sub-coleções, cada doc preservando o mesmo ID que tinha no Realtime Database.
   - **`onValue` → `onSnapshot`** em todo lugar. O painel do dono (`js/admin.js`) tinha 5 listeners separados (info/servicos/profissionais/agendamentos/clientes) — viraram 5 listeners Firestore (1 `onSnapshot(doc)` + 4 `onSnapshot(collection)`), mesma contagem, só a API mudou.
   - **Painel interno 77 IS (`js/painel77.js`) foi redesenhado, não só traduzido.** Antes ele lia a coleção `barbearias` inteira de uma vez, incluindo as sub-coleções de TODOS os negócios (RTDB deixava isso barato; Firestore não tem equivalente). Agora: (a) o listener em tempo real só traz os campos de nível superior de cada negócio (nome/status/trialFim/plano); (b) contagens (agendamentos/serviços/profissionais) vêm de `getCountFromServer()` por negócio, carregadas uma vez ao entrar no painel (`carregarContagens()`) — não em tempo real, já que é um painel de uso ocasional, não um dashboard operacional; (c) o modal "Ver detalhes" de um negócio específico lê a coleção de agendamentos inteira sob demanda (só daquele negócio, só quando o modal abre) — isso continua barato porque é um negócio só, não todos de uma vez.
   - **4 funções serverless (`api/*.js`) traduzidas de `admin.database()` pra `admin.firestore()`** — a lógica de negócio (disponibilidade de horário, fuso horário, travas do autoatendimento do cliente) não mudou, só a forma de ler/escrever.
   - **Identidade do cliente por WhatsApp preservada, não substituída** — `api/agendamento-cliente.js` continua autorizando por comparação de string (WhatsApp enviado vs. `agendamento.clienteWhatsapp`), sem Firebase Auth pro cliente final.
   - **Migração de dados** via `scripts/migrar-rtdb-para-firestore.js` (idempotente) + corte por janela curta de manutenção. RTDB fica dormente por 30 dias após o corte antes de qualquer exclusão.

## Módulos construídos

| Módulo | Arquivo | Resumo |
|---|---|---|
| Área pública | `index.html` / `js/app.js` | Agendamento em 4 passos, sem login, cliente identificado por WhatsApp. "Meus agendamentos" (Tela 6) permite cancelar/remarcar sozinho via `api/agendamento-cliente.js` |
| Painel do dono | `admin.html` / `js/admin.js` | Dashboard, agenda do dia (com agendamento manual e remarcação), CRUD de serviços/profissionais, clientes, configurações, notificações push |
| Auto-cadastro | `cadastro.html` / `js/cadastro.js` | Novo negócio se cadastra sozinho (cria conta + registro em `cadastrosAguardando`) |
| Painel interno 77 IS | `painel77.html` / `js/painel77.js` | Aprovação de cadastros, gestão de trial/assinatura de todos os negócios, logs |

## Pendências conhecidas

- **Corte de produção da migração Firestore ainda não feito** (ver decisão #9): código já reescrito e validado (sintaxe + regras compiladas), mas os dados reais ainda estão só no Realtime Database. Falta: (1) Felipe gerar a service account key em Firebase Console e configurar as env vars no Vercel, (2) rodar `scripts/migrar-rtdb-para-firestore.js` a seco, (3) testar os fluxos localmente, (4) executar o corte numa janela curta de manutenção. RTDB deve ficar dormente (não excluído) por 30 dias depois do corte.
- Regras do Firestore cobrem os casos principais mas não foram auditadas path a path por completo — revisar antes de adicionar coleções novas.
- Painel interno 77 IS (`painel77.js`) não mostra mais alguns agregados que dependiam de ler a árvore inteira em tempo real (ver decisão #9) — se algum número específico fizer falta, avaliar contador pré-agregado antes de simplesmente voltar a ler tudo.
- Sem suíte de testes automatizados.

## Convenções ao propor mudanças

- Sempre seguir o padrão de nomenclatura e organização já existente antes de introduzir algo novo.
- Nenhuma função serverless deve confiar em dado de negócio (preço, destinatário, conteúdo de mensagem) vindo direto do corpo da requisição do cliente — buscar do banco via Admin SDK.
- Alterações em `firestore.rules` devem ser explicadas antes de aplicadas e sempre deployadas via `firebase deploy --only firestore:rules --project agendapro-179cb` — são sensíveis e afetam todos os negócios.
- Preferir soluções que continuem funcionando com git local + Claude Code.
