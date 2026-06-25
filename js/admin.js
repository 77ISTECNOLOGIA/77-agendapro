<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0a0a0a">
  <title>77 AgendaPro — Painel</title>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=Geist:wght@300;400;500;600&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="css/admin.css">

  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2222%22 fill=%22%23d4ff3a%22/><text x=%2250%22 y=%2268%22 font-family=%22sans-serif%22 font-weight=%22800%22 font-size=%2248%22 text-anchor=%22middle%22 fill=%22%230a0a0a%22>77</text></svg>">
</head>
<body class="admin-body">

  <!-- ============ LOADING ============ -->
  <div id="loading" class="loading-overlay">
    <div class="loading-content">
      <div class="logo-mark loading-logo">77</div>
      <div class="loading-text">Carregando painel...</div>
    </div>
  </div>

  <!-- ============ TELA DE LOGIN ============ -->
  <div id="tela-login" class="hidden login-container">
    <div class="login-card">
      <div class="login-header">
        <div class="logo-mark" style="width:56px;height:56px;font-size:22px;">77</div>
        <h1 class="login-titulo">77 <span class="accent">AgendaPro</span></h1>
        <p class="login-sub">Acesso ao painel administrativo</p>
      </div>

      <form id="form-login" novalidate>
        <div class="input-grupo">
          <label class="input-label" for="login-email">EMAIL</label>
          <input type="email" id="login-email" class="input" placeholder="seu@email.com" autocomplete="email" required>
        </div>
        <div class="input-grupo">
          <label class="input-label" for="login-senha">SENHA</label>
          <input type="password" id="login-senha" class="input" placeholder="••••••••" autocomplete="current-password" required>
        </div>
        <div id="erro-login" class="login-erro hidden"></div>
        <button type="submit" id="btn-login" class="btn">Entrar</button>
        <button type="button" id="btn-esqueci" class="btn-link">Esqueci minha senha</button>
      </form>
    </div>
  </div>

  <!-- ============ APP DO PAINEL ============ -->
  <div id="admin-app" class="hidden admin-app">

    <!-- SIDEBAR -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="mini-logo">77</div>
        <div>
          <div class="sidebar-titulo">77 <span class="accent">AgendaPro</span></div>
          <div class="sidebar-barbearia" id="sidebar-barbearia">—</div>
        </div>
      </div>

      <nav class="sidebar-nav">
        <button class="nav-item ativo" data-view="dashboard">
          <span class="nav-icon">📊</span>
          <span class="nav-label">Dashboard</span>
        </button>
        <button class="nav-item" data-view="agenda">
          <span class="nav-icon">📅</span>
          <span class="nav-label">Agenda</span>
        </button>
        <button class="nav-item" data-view="servicos">
          <span class="nav-icon">✂️</span>
          <span class="nav-label">Serviços</span>
        </button>
        <button class="nav-item" data-view="profissionais">
          <span class="nav-icon">👥</span>
          <span class="nav-label">Profissionais</span>
        </button>
        <button class="nav-item" data-view="clientes">
          <span class="nav-icon">👤</span>
          <span class="nav-label">Clientes</span>
        </button>
        <button class="nav-item" data-view="configuracoes">
          <span class="nav-icon">⚙️</span>
          <span class="nav-label">Configurações</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-avatar" id="user-avatar">?</div>
          <div class="user-detalhes">
            <div class="user-nome" id="user-nome">—</div>
            <div class="user-email" id="user-email">—</div>
          </div>
        </div>
        <button id="btn-logout" class="btn-logout">Sair</button>
      </div>
    </aside>

    <!-- TOPBAR MOBILE -->
    <header class="topbar-mobile">
      <button id="btn-menu" class="btn-icon">☰</button>
      <div class="topbar-titulo" id="topbar-titulo">Dashboard</div>
      <button id="btn-logout-mobile" class="btn-icon">⏻</button>
    </header>

    <!-- CONTEÚDO PRINCIPAL -->
    <main class="main-content">

      <!-- ============ VIEW: DASHBOARD ============ -->
      <section class="view ativa" id="view-dashboard">
        <div class="view-header">
          <div>
            <h1 class="view-titulo">Dashboard</h1>
            <p class="view-sub" id="dashboard-data">—</p>
          </div>
          <button id="btn-atualizar-dash" class="btn-icon-outline" title="Atualizar">↻</button>
        </div>

        <!-- KPIs Principais -->
        <div class="kpis-grid">
          <div class="kpi-card destaque">
            <div class="kpi-icon">💰</div>
            <div class="kpi-info">
              <div class="kpi-label">Faturamento do dia</div>
              <div class="kpi-valor" id="kpi-faturamento">R$ 0</div>
              <div class="kpi-extra" id="kpi-faturamento-extra">0 atendimentos concluídos</div>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-icon">📅</div>
            <div class="kpi-info">
              <div class="kpi-label">Agendamentos hoje</div>
              <div class="kpi-valor" id="kpi-agendamentos">0</div>
              <div class="kpi-extra" id="kpi-agendamentos-extra">— concluídos, — pendentes</div>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-icon">⏰</div>
            <div class="kpi-info">
              <div class="kpi-label">Fim previsto do expediente</div>
              <div class="kpi-valor" id="kpi-fim">—</div>
              <div class="kpi-extra" id="kpi-fim-extra">—</div>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-icon">🎯</div>
            <div class="kpi-info">
              <div class="kpi-label">Ticket médio</div>
              <div class="kpi-valor" id="kpi-ticket">R$ 0</div>
              <div class="kpi-extra">por atendimento concluído</div>
            </div>
          </div>
        </div>

        <!-- Próximo Cliente + Faturamento por Serviço -->
        <div class="dashboard-row">
          <div class="card-grande">
            <div class="card-header">
              <h3 class="card-titulo">Próximo cliente</h3>
            </div>
            <div id="proximo-cliente" class="proximo-cliente-content">
              <div class="vazio-msg">Nenhum cliente agendado a seguir</div>
            </div>
          </div>

          <div class="card-grande">
            <div class="card-header">
              <h3 class="card-titulo">Faturamento por serviço</h3>
              <span class="card-sub">hoje</span>
            </div>
            <div id="fat-por-servico" class="fat-servico-content">
              <div class="vazio-msg">Sem faturamento registrado hoje</div>
            </div>
          </div>
        </div>

        <!-- Próximos agendamentos do dia -->
        <div class="card-grande" style="margin-top: 20px;">
          <div class="card-header">
            <h3 class="card-titulo">Agendamentos de hoje</h3>
            <span class="card-sub" id="hoje-count">0 agendamentos</span>
          </div>
          <div id="lista-hoje" class="lista-agendamentos">
            <div class="vazio-msg">Nenhum agendamento hoje</div>
          </div>
        </div>
      </section>

      <!-- ============ VIEW: AGENDA ============ -->
      <section class="view" id="view-agenda">
        <div class="view-header">
          <div>
            <h1 class="view-titulo">Agenda</h1>
            <p class="view-sub">Gerencie todos os agendamentos</p>
          </div>
          <button id="btn-novo-agendamento" class="btn-acao">+ Novo agendamento</button>
        </div>

        <!-- Navegação de data -->
        <div class="agenda-controles">
          <button class="btn-icon-outline" id="btn-data-prev">←</button>
          <div class="agenda-data-atual">
            <input type="date" id="agenda-data-input" class="input-data">
          </div>
          <button class="btn-icon-outline" id="btn-data-next">→</button>
          <button class="btn-acao-secundario" id="btn-data-hoje">Hoje</button>

          <div class="agenda-filtros">
            <select id="filtro-profissional" class="select-filtro">
              <option value="todos">Todos profissionais</option>
            </select>
            <select id="filtro-status" class="select-filtro">
              <option value="todos">Todos status</option>
              <option value="confirmado">Confirmados</option>
              <option value="concluido">Concluídos</option>
              <option value="cancelado">Cancelados</option>
            </select>
          </div>
        </div>

        <!-- Timeline da agenda -->
        <div id="agenda-timeline" class="agenda-timeline">
          <div class="vazio-msg">Carregando agenda...</div>
        </div>
      </section>

      <!-- ============ VIEW: SERVIÇOS ============ -->
      <section class="view" id="view-servicos">
        <div class="view-header">
          <div>
            <h1 class="view-titulo">Serviços</h1>
            <p class="view-sub">Gerencie o catálogo de serviços</p>
          </div>
          <button id="btn-novo-servico" class="btn-acao">+ Novo serviço</button>
        </div>

        <div id="lista-servicos-admin" class="tabela-cards">
          <div class="vazio-msg">Carregando serviços...</div>
        </div>
      </section>

      <!-- ============ VIEW: PROFISSIONAIS ============ -->
      <section class="view" id="view-profissionais">
        <div class="view-header">
          <div>
            <h1 class="view-titulo">Profissionais</h1>
            <p class="view-sub">Gerencie a equipe e horários de trabalho</p>
          </div>
          <button id="btn-novo-profissional" class="btn-acao">+ Novo profissional</button>
        </div>

        <div id="lista-profissionais-admin" class="tabela-cards">
          <div class="vazio-msg">Carregando profissionais...</div>
        </div>
      </section>

      <!-- ============ VIEW: CLIENTES ============ -->
      <section class="view" id="view-clientes">
        <div class="view-header">
          <div>
            <h1 class="view-titulo">Clientes</h1>
            <p class="view-sub" id="clientes-total">Carregando clientes...</p>
          </div>
        </div>

        <div class="busca-container">
          <input type="text" id="busca-cliente" class="input" placeholder="🔍 Buscar por nome ou WhatsApp...">
        </div>

        <div id="lista-clientes-admin" class="tabela-cards">
          <div class="vazio-msg">Carregando clientes...</div>
        </div>
      </section>

      <!-- ============ VIEW: CONFIGURAÇÕES ============ -->
      <section class="view" id="view-configuracoes">
        <div class="view-header">
          <div>
            <h1 class="view-titulo">Configurações</h1>
            <p class="view-sub">Dados da barbearia e horários</p>
          </div>
        </div>

        <form id="form-config" class="form-config">
          <!-- Dados Gerais -->
          <div class="card-grande">
            <div class="card-header">
              <h3 class="card-titulo">Dados da barbearia</h3>
            </div>
            <div class="form-grid">
              <div class="input-grupo">
                <label class="input-label">NOME</label>
                <input type="text" id="conf-nome" class="input">
              </div>
              <div class="input-grupo">
                <label class="input-label">ENDEREÇO</label>
                <input type="text" id="conf-endereco" class="input">
              </div>
              <div class="input-grupo">
                <label class="input-label">TELEFONE (WhatsApp)</label>
                <input type="tel" id="conf-telefone" class="input">
              </div>
              <div class="input-grupo">
                <label class="input-label">SLUG (URL da barbearia)</label>
                <input type="text" id="conf-slug" class="input" disabled>
                <small class="campo-help">Link público: <span id="link-publico">—</span></small>
              </div>
            </div>
          </div>

          <!-- Horários -->
          <div class="card-grande" style="margin-top: 20px;">
            <div class="card-header">
              <h3 class="card-titulo">Horário de funcionamento</h3>
            </div>
            <div id="horarios-funcionamento" class="horarios-conf">
              <!-- Renderizado dinamicamente -->
            </div>
          </div>

          <!-- QR Code -->
          <div class="card-grande" style="margin-top: 20px;">
            <div class="card-header">
              <h3 class="card-titulo">QR Code para clientes</h3>
            </div>
            <div class="qr-container">
              <div id="qr-code-container" class="qr-display"></div>
              <div class="qr-info">
                <p>Imprima e cole no espelho da barbearia. Seus clientes escaneiam e agendam direto.</p>
                <button type="button" id="btn-baixar-qr" class="btn-acao-secundario">Baixar QR Code</button>
              </div>
            </div>
          </div>

          <div class="form-footer">
            <button type="submit" id="btn-salvar-config" class="btn-acao">Salvar configurações</button>
          </div>
        </form>
      </section>

    </main>
  </div>

  <!-- ============ MODAL GENÉRICO ============ -->
  <div id="modal-overlay" class="modal-overlay hidden">
    <div class="modal-box">
      <div class="modal-header">
        <h3 id="modal-titulo">Título</h3>
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <div id="modal-body" class="modal-body"></div>
      <div id="modal-footer" class="modal-footer"></div>
    </div>
  </div>

  <!-- ============ TOAST ============ -->
  <div id="toast" class="toast hidden">
    <span id="toast-msg"></span>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
  <script type="module" src="js/firebase-config.js"></script>
  <script type="module" src="js/admin.js"></script>

</body>
</html>
