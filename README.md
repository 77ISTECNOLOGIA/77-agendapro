# 77 AgendaPro

Plataforma de agendamento online para barbearias e salões. Produto da **77 IS Tecnologia & Inteligência**.

## 🎯 Sobre o produto

O 77 AgendaPro é um sistema de marcação de horários focado em barbearias autônomas e pequenas (1 a 5 profissionais). O cliente final acessa a barbearia via link público ou QR Code, escolhe serviço, profissional e horário, e recebe lembrete automático via WhatsApp.

**Diferencial:** painel operacional voltado pro profissional — saber em tempo real faturamento do dia, horário previsto de término, próximos clientes e ticket médio.

---

## 📦 Estado atual (Fases 1-4 já construídas)

✅ Área pública (cliente final agenda em 4 passos) — `index.html` / `js/app.js`
✅ Identificação automática de cliente recorrente (via WhatsApp)
✅ Cálculo dinâmico de horários disponíveis (duração dos serviços, agendamentos existentes, folgas, horário de trabalho por profissional)
✅ Re-validação anti-conflito no momento da confirmação
✅ Painel do dono do negócio — `painel77.html` / `js/painel77.js`: dashboard, agenda, CRUD de serviços/profissionais
✅ Auto-cadastro público de novo negócio — `cadastro.html` / `js/cadastro.js`
✅ Painel administrativo interno da 77 IS — `admin.html` / `js/admin.js`: aprovação de cadastros, gestão de trials/assinaturas, todos os negócios
✅ Notificação push (Web Push/FCM) pro dono a cada novo agendamento — `api/send-notification.js`
✅ Onboarding de dono via função serverless — `api/criar-usuario.js`
✅ Regras do Realtime Database versionadas (`database.rules.json`) e deployadas

---

## 🔐 Segurança e autenticação

- **Cliente final:** sem login, fluxo público.
- **Dono do negócio:** Firebase Authentication (email/senha), vínculo `usuarios/{uid} → { barbeariaId, role: 'owner' }`.
- **Admin interno 77 IS:** Firebase Authentication, vínculo `admins77/{uid} → { role: 'super_admin' }`.
- Regras do Realtime Database (`database.rules.json`) restringem escrita por caminho: `info`/`servicos`/`profissionais` só pelo dono ou super-admin; `agendamentos` criação livre (cliente anônimo) mas edição só pelo dono; `clientes` só o campo específico do WhatsApp de quem está agendando.
- `api/send-notification.js` nunca recebe token/corpo prontos do navegador — busca o agendamento real no banco via Admin SDK e monta a notificação a partir de dado confiável.

---

## 🚀 Setup local (git + Claude Code)

Workflow local via git — não mais só pela interface web do GitHub.

### 1️⃣ Clonar e configurar

```bash
git clone https://github.com/77ISTECNOLOGIA/77-agendapro.git
cd 77-agendapro
```

Credenciais do Firebase (client-side) já estão em `js/firebase-config.js` — projeto `agendapro-179cb`.

Para rodar as funções serverless (`api/*.js`) localmente ou fazer deploy, as env vars `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (credenciais do Admin SDK) já estão configuradas no projeto Vercel.

### 2️⃣ Deploy

Deploy automático via Vercel a cada push na branch `main`. Alterações nas regras do banco exigem deploy manual:

```bash
firebase deploy --only database --project agendapro-179cb
```

### 3️⃣ Testar

Produção: `https://77-agendapro.vercel.app/barbearia-do-joao` (negócio de teste/seed, populado via `seed-data.json`).

---

## 🗂️ Estrutura do projeto

```
77-agendapro/
├── index.html               # Área pública (SPA, 4 telas)
├── painel77.html            # Painel do dono do negócio
├── admin.html                # Painel interno 77 IS (super-admin)
├── cadastro.html             # Auto-cadastro de novo negócio
├── css/
├── js/
│   ├── firebase-config.js    # Credenciais do Firebase (client-side)
│   ├── utils.js               # escapeHtml() e utilitários compartilhados
│   ├── app.js                  # Lógica da área pública
│   ├── painel77.js             # Lógica do painel do dono
│   ├── admin.js                 # Lógica do painel interno 77 IS
│   └── cadastro.js              # Lógica do auto-cadastro
├── api/
│   ├── criar-usuario.js       # Serverless: cria acesso do dono (Admin SDK)
│   ├── send-notification.js   # Serverless: notificação push (Admin SDK)
│   └── agendamentos-ocupados.js # Serverless: ocupação de horários sem PII
├── database.rules.json        # Regras do Realtime Database (versionadas)
├── firebase.json
├── seed-data.json             # Dados iniciais do negócio de teste
├── vercel.json
└── README.md
```

---

## 🗄️ Estrutura do banco (Firebase Realtime Database)

```
admins77/
└── [uid]: { role: 'super_admin' }

usuarios/
└── [uid]: { email, nome, barbeariaId, role: 'owner', criadoEm, precisaOnboarding }

cadastrosAguardando/
└── [slug]: { barbeariaId, nomeBarbearia, nomeResponsavel, email, telefone, ... }

logs77/
└── [id_auto]: { acao, alvoId, alvoNome, admin, adminNome, timestamp }

barbearias/
└── [slug-da-barbearia]/
    ├── info: { nome, slug, endereco, telefone, horarioFuncionamento, plano, trialFim, status, fcmTokens }
    ├── servicos/[id_servico]: { nome, duracaoMin, preco, emoji, ativo, ordem }
    ├── profissionais/[id_prof]: { nome, especialidade, comissao, ativo, horarioTrabalho, bloqueios }
    ├── clientes/[whatsapp_normalizado]: { nome, primeiraVisita, totalAgendamentos, ultimoAgendamento }
    └── agendamentos/[id_auto]: { clienteWhatsapp, clienteNome, profissionalId, profissionalNome, servicos[], dataChave, horario, duracaoMin, valorTotal, status, criadoEm, notificacaoEnviada }
```

**Nota sobre clientes:** a chave é o WhatsApp normalizado (DDI 55 + DDD + número, sem formatação) — busca de cliente recorrente em O(1).

---

## 🎨 Identidade visual

- **Cor primária:** `#D4FF3A` (verde-limão elétrico)
- **Fundo:** `#0A0A0A` (preto profundo)
- **Tipografia display:** Bricolage Grotesque
- **Tipografia corpo:** Geist

---

## 🐛 Troubleshooting

**Erro: "Barbearia não encontrada"**
→ Verifique se o slug na URL bate exatamente com o cadastrado no Firebase.

**Tela fica em "Carregando..." infinito**
→ Provavelmente as credenciais do Firebase estão erradas. Abra o console (F12) e veja o erro.

**Horários não aparecem**
→ Verifique se o profissional tem `horarioTrabalho` configurado para o dia da semana selecionado.

**Notificação push não chega**
→ Confirme que o dono ativou notificações no navegador (token salvo em `barbearias/{slug}/info/fcmTokens`) e que as env vars do Admin SDK estão configuradas na Vercel.

---

**Desenvolvido com ❤️ por Felipe — 77 IS Tecnologia & Inteligência**
