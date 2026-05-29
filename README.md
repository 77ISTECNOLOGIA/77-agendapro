# 77 AgendaPro

Plataforma de agendamento online para barbearias e salões. Produto da **77 IS Tecnologia & Inteligência**.

## 🎯 Sobre o produto

O 77 AgendaPro é um sistema de marcação de horários focado em barbearias autônomas e pequenas (1 a 5 profissionais). O cliente final acessa a barbearia via link público ou QR Code, escolhe serviço, profissional e horário, e recebe lembrete automático via WhatsApp.

**Diferencial:** painel operacional voltado pro profissional — saber em tempo real faturamento do dia, horário previsto de término, próximos clientes e ticket médio.

---

## 📦 O que está na Fase 1

✅ Área pública (cliente final agenda em 4 passos)
✅ Identificação automática de cliente recorrente (via WhatsApp)
✅ Cálculo dinâmico de horários disponíveis (considerando duração dos serviços, agendamentos existentes, folgas e horário de trabalho de cada profissional)
✅ Re-validação anti-conflito no momento da confirmação (evita 2 clientes pegarem o mesmo horário)
✅ Estrutura Firebase Realtime Database completa
✅ Deploy via Vercel com pretty URLs (`77agendapro.vercel.app/barbearia-do-joao`)

---

## 🚀 Setup completo (passo a passo)

### 1️⃣ Criar projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Clique em **"Criar projeto"** → nome `77-agendapro`
3. Pode desativar o Google Analytics (não precisa nesta fase)
4. No menu lateral: **Build → Realtime Database → Criar banco de dados**
5. Localização: `us-central1` (ou mais próxima)
6. Comece em **"Modo de teste"** (deixaremos as regras certas mais tarde)

### 2️⃣ Pegar credenciais do Firebase

1. Engrenagem no topo → **"Configurações do projeto"** → aba **"Geral"**
2. Role até **"Seus apps"** → clique em **"Adicionar app"** → ícone Web (`</>`)
3. Apelido: `77-agendapro-web` → clique em **"Registrar app"**
4. Copie o objeto `firebaseConfig` que aparecer
5. Cole em `js/firebase-config.js` substituindo os placeholders

### 3️⃣ Popular o banco com dados de teste

1. No console do Firebase: **Realtime Database** → aba **"Dados"**
2. Clique nos 3 pontinhos (`⋮`) → **"Importar JSON"**
3. Selecione o arquivo `seed-data.json` deste repositório
4. Clique em **"Importar"**

Pronto! Uma barbearia de teste chamada `barbearia-do-joao` foi criada com 4 serviços e 2 profissionais.

### 4️⃣ Subir pro GitHub

```bash
cd 77-agendapro
git init
git add .
git commit -m "Fase 1: área pública do 77 AgendaPro"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/77-agendapro.git
git push -u origin main
```

### 5️⃣ Deploy no Vercel

1. Acesse [vercel.com](https://vercel.com) → **"Add New" → "Project"**
2. Importe o repositório `77-agendapro` do GitHub
3. **Framework Preset:** "Other" (deixa padrão mesmo)
4. **Root directory:** deixa em branco
5. Clique em **"Deploy"**

Em ~30 segundos seu site estará no ar em `77-agendapro.vercel.app`.

### 6️⃣ Testar

Acesse: **`https://77-agendapro.vercel.app/barbearia-do-joao`**

Você verá a área pública funcionando. Faça um agendamento de teste — ele aparecerá no Firebase Realtime Database em `barbearias/barbearia-do-joao/agendamentos`.

---

## 🗂️ Estrutura do projeto

```
77-agendapro/
├── index.html              # SPA com as 4 telas
├── css/
│   └── style.css           # Estilos (dark mode + verde-limão)
├── js/
│   ├── firebase-config.js  # ⚠️ EDITAR: credenciais do Firebase
│   └── app.js              # Toda a lógica
├── assets/                 # Imagens, logos (vazio por enquanto)
├── seed-data.json          # Dados iniciais pra importar no Firebase
├── vercel.json             # Configuração de rotas
├── .gitignore
└── README.md
```

---

## 🗄️ Estrutura do banco (Firebase Realtime Database)

```
barbearias/
└── [slug-da-barbearia]/
    ├── info: { nome, slug, endereco, telefone, horarioFuncionamento, plano, trialFim }
    ├── servicos/
    │   └── [id_servico]: { nome, duracaoMin, preco, emoji, ativo, ordem }
    ├── profissionais/
    │   └── [id_prof]: { nome, especialidade, comissao, ativo, horarioTrabalho, bloqueios }
    ├── clientes/
    │   └── [whatsapp_normalizado]: { nome, primeiraVisita, totalAgendamentos, ultimoAgendamento }
    └── agendamentos/
        └── [id_auto]: { clienteWhatsapp, clienteNome, profissionalId, servicos[], dataChave, horario, duracaoMin, valorTotal, status, criadoEm }
```

**Nota sobre clientes:** a chave é o WhatsApp normalizado (DDI 55 + DDD + número, sem formatação). Isso permite buscar clientes recorrentes em O(1).

---

## 🔧 Como adicionar uma nova barbearia (manual nesta fase)

Enquanto não temos o painel admin (Fase 2), é manual no Firebase:

1. Acesse o Firebase → Realtime Database → Dados
2. Em `barbearias`, adicione um novo node com o slug (ex: `barbearia-vitoria`)
3. Replique a estrutura do `barbearia-do-joao` ajustando os dados
4. O link público será automaticamente `77-agendapro.vercel.app/barbearia-vitoria`

---

## 🎨 Identidade visual

- **Cor primária:** `#D4FF3A` (verde-limão elétrico)
- **Fundo:** `#0A0A0A` (preto profundo)
- **Tipografia display:** Bricolage Grotesque
- **Tipografia corpo:** Geist

---

## 📅 Próximas fases

- **Fase 2:** Painel do barbeiro (dashboard, agenda, CRUD de serviços/profissionais)
- **Fase 3:** Lembretes WhatsApp (modelo híbrido - 1 clique manual + cadastro recorrente avançado)
- **Fase 4:** Painel administrativo 77 IS (gestão de trials, assinaturas)

---

## 🐛 Troubleshooting

**Erro: "Barbearia não encontrada"**
→ Verifique se o slug na URL bate exatamente com o cadastrado no Firebase.

**Tela fica em "Carregando..." infinito**
→ Provavelmente as credenciais do Firebase estão erradas. Abra o console (F12) e veja o erro.

**Horários não aparecem**
→ Verifique se o profissional tem `horarioTrabalho` configurado para o dia da semana selecionado.

---

**Desenvolvido com ❤️ por Felipe — 77 IS Tecnologia & Inteligência**
