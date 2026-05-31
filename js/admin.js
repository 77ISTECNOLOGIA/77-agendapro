// ========================================
// 77 AGENDAPRO — Painel Admin
// ========================================

import { db } from './firebase-config.js';
import {
  initializeApp,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  off
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const auth = getAuth(getApp());

// ========================================
// ESTADO GLOBAL
// ========================================
const state = {
  user: null,
  barbeariaId: null,
  barbearia: null,
  servicos: {},
  profissionais: {},
  agendamentos: {},
  clientes: {},

  viewAtual: 'dashboard',
  agendaDataAtual: new Date(),
  filtroProfissional: 'todos',
  filtroStatus: 'todos',

  listeners: []
};

// ========================================
// UTILS
// ========================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatarMoeda(v) { return `R$ ${(v || 0).toFixed(2).replace('.', ',')}`; }
function dataParaChave(d) {
  const a = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dia = String(d.getDate()).padStart(2, '0');
  return `${a}-${m}-${dia}`;
}
function chaveParaData(chave) {
  const [a, m, d] = chave.split('-').map(Number);
  return new Date(a, m - 1, d);
}
function minutosParaHora(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function horaParaMinutos(h) {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
}
function formatarDataLonga(d) {
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]}`;
}
function diasDaSemana() {
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
}
function iniciais(nome) {
  return (nome || '?').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function formatarWhatsapp(num) {
  if (!num) return '';
  const d = String(num).replace(/\D/g, '');
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9, 13)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  return num;
}
function toast(msg, tipo = '') {
  const el = $('#toast');
  $('#toast-msg').textContent = msg;
  el.className = `toast ativo ${tipo}`;
  el.classList.remove('hidden');
  setTimeout(() => {
    el.classList.remove('ativo');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, 3000);
}

// ========================================
// AUTENTICAÇÃO
// ========================================
function inicializarAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.user = user;
      try {
        const snap = await get(ref(db, `usuarios/${user.uid}`));
        if (!snap.exists()) {
          await signOut(auth);
          mostrarLogin('Usuário sem barbearia vinculada. Contate o suporte.');
          return;
        }
        const userData = snap.val();
        state.barbeariaId = userData.barbeariaId;
        await carregarBarbearia();
        renderizarUserInfo(userData);
        mostrarApp();
        ativarListenersTempoReal();
        await renderizarTudo();
      } catch (err) {
        console.error('Erro ao carregar usuário:', err);
        mostrarLogin('Erro ao carregar dados. Tente novamente.');
      }
    } else {
      desativarListeners();
      mostrarLogin();
    }
  });

  $('#form-login').addEventListener('submit', handleLogin);
  $('#btn-esqueci').addEventListener('click', handleEsqueciSenha);
  $('#btn-logout').addEventListener('click', handleLogout);
  $('#btn-logout-mobile').addEventListener('click', handleLogout);
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const senha = $('#login-senha').value;
  const btn = $('#btn-login');
  const erroEl = $('#erro-login');

  erroEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (err) {
    console.error(err);
    let msg = 'Erro ao fazer login. Tente novamente.';
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
      msg = 'Email ou senha incorretos.';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'Muitas tentativas. Tente em alguns minutos.';
    } else if (err.code === 'auth/invalid-email') {
      msg = 'Email inválido.';
    }
    erroEl.textContent = msg;
    erroEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function handleEsqueciSenha() {
  const email = $('#login-email').value.trim();
  if (!email) {
    toast('Digite seu email primeiro', 'erro');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Email de recuperação enviado!', 'sucesso');
  } catch (err) {
    toast('Erro ao enviar email. Verifique o endereço.', 'erro');
  }
}

async function handleLogout() {
  if (!confirm('Deseja realmente sair?')) return;
  await signOut(auth);
}

function mostrarLogin(msg) {
  $('#loading').classList.add('hidden');
  $('#admin-app').classList.add('hidden');
  $('#tela-login').classList.remove('hidden');
  if (msg) {
    $('#erro-login').textContent = msg;
    $('#erro-login').classList.remove('hidden');
  }
}

function mostrarApp() {
  $('#loading').classList.add('hidden');
  $('#tela-login').classList.add('hidden');
  $('#admin-app').classList.remove('hidden');
}

function renderizarUserInfo(userData) {
  $('#user-nome').textContent = userData.nome || state.user.email;
  $('#user-email').textContent = state.user.email;
  $('#user-avatar').textContent = iniciais(userData.nome || state.user.email);
}

// ========================================
// CARREGAR DADOS DA BARBEARIA
// ========================================
async function carregarBarbearia() {
  const snap = await get(ref(db, `barbearias/${state.barbeariaId}`));
  if (!snap.exists()) throw new Error('Barbearia não encontrada');
  const data = snap.val();
  state.barbearia = data.info || {};
  state.servicos = data.servicos || {};
  state.profissionais = data.profissionais || {};
  state.agendamentos = data.agendamentos || {};
  state.clientes = data.clientes || {};
  $('#sidebar-barbearia').textContent = state.barbearia.nome || '—';
}

// ========================================
// LISTENERS EM TEMPO REAL
// ========================================
function ativarListenersTempoReal() {
  desativarListeners();
  const paths = [
    `barbearias/${state.barbeariaId}/info`,
    `barbearias/${state.barbeariaId}/servicos`,
    `barbearias/${state.barbeariaId}/profissionais`,
    `barbearias/${state.barbeariaId}/agendamentos`,
    `barbearias/${state.barbeariaId}/clientes`
  ];
  paths.forEach(p => {
    const r = ref(db, p);
    const cb = onValue(r, (snap) => {
      const dados = snap.val() || {};
      const chave = p.split('/').pop();
      if (chave === 'info') state.barbearia = dados;
      else state[chave] = dados;
      renderizarViewAtual();
    });
    state.listeners.push({ ref: r, cb });
  });
}

function desativarListeners() {
  state.listeners.forEach(l => off(l.ref));
  state.listeners = [];
}

// ========================================
// NAVEGAÇÃO ENTRE VIEWS
// ========================================
function inicializarNavegacao() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      irPara(view);
      if (window.innerWidth <= 900) $('#sidebar').classList.remove('aberta');
    });
  });
  $('#btn-menu').addEventListener('click', () => {
    $('#sidebar').classList.toggle('aberta');
  });
}

function irPara(view) {
  state.viewAtual = view;
  $$('.nav-item').forEach(n => n.classList.toggle('ativo', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('ativa', v.id === `view-${view}`));
  const titulos = {
    dashboard: 'Dashboard', agenda: 'Agenda', servicos: 'Serviços',
    profissionais: 'Profissionais', clientes: 'Clientes', configuracoes: 'Configurações'
  };
  $('#topbar-titulo').textContent = titulos[view] || '';
  renderizarViewAtual();
}

function renderizarViewAtual() {
  switch (state.viewAtual) {
    case 'dashboard': renderizarDashboard(); break;
    case 'agenda': renderizarAgenda(); break;
    case 'servicos': renderizarServicos(); break;
    case 'profissionais': renderizarProfissionais(); break;
    case 'clientes': renderizarClientes(); break;
    case 'configuracoes': renderizarConfiguracoes(); break;
  }
}

async function renderizarTudo() {
  inicializarNavegacao();
  inicializarEventosViews();
  renderizarViewAtual();
}

// ========================================
// VIEW: DASHBOARD
// ========================================
function renderizarDashboard() {
  const hoje = new Date();
  $('#dashboard-data').textContent = formatarDataLonga(hoje);

  const hojeChave = dataParaChave(hoje);
  const agsHoje = Object.entries(state.agendamentos)
    .map(([id, a]) => ({ ...a, id }))
    .filter(a => a.dataChave === hojeChave);

  const concluidos = agsHoje.filter(a => a.status === 'concluido');
  const confirmados = agsHoje.filter(a => a.status === 'confirmado');
  const cancelados = agsHoje.filter(a => a.status === 'cancelado');

  // Faturamento
  const faturamento = concluidos.reduce((s, a) => s + (a.valorTotal || 0), 0);
  $('#kpi-faturamento').textContent = formatarMoeda(faturamento);
  $('#kpi-faturamento-extra').textContent = `${concluidos.length} atendimento${concluidos.length !== 1 ? 's' : ''} concluído${concluidos.length !== 1 ? 's' : ''}`;

  // Agendamentos
  $('#kpi-agendamentos').textContent = agsHoje.length - cancelados.length;
  $('#kpi-agendamentos-extra').textContent = `${concluidos.length} concluído${concluidos.length !== 1 ? 's' : ''}, ${confirmados.length} pendente${confirmados.length !== 1 ? 's' : ''}`;

  // Ticket médio
  const ticket = concluidos.length > 0 ? faturamento / concluidos.length : 0;
  $('#kpi-ticket').textContent = formatarMoeda(ticket);

  // Fim previsto do expediente
  const proximos = confirmados.sort((a, b) => horaParaMinutos(a.horario) - horaParaMinutos(b.horario));
  if (proximos.length > 0) {
    const ultimo = proximos[proximos.length - 1];
    const fimMin = horaParaMinutos(ultimo.horario) + ultimo.duracaoMin;
    $('#kpi-fim').textContent = minutosParaHora(fimMin);
    const restantes = proximos.length;
    $('#kpi-fim-extra').textContent = `${restantes} agendamento${restantes !== 1 ? 's' : ''} pela frente`;
  } else {
    $('#kpi-fim').textContent = '—';
    $('#kpi-fim-extra').textContent = 'Nenhum agendamento pendente';
  }

  // Próximo cliente
  const agora = new Date();
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  const proximo = proximos.find(a => horaParaMinutos(a.horario) >= minAgora) || proximos[0];
  if (proximo) {
    $('#proximo-cliente').innerHTML = `
      <div class="proximo-avatar">${iniciais(proximo.clienteNome)}</div>
      <div class="proximo-info">
        <div class="proximo-nome">${proximo.clienteNome}</div>
        <div class="proximo-detalhes">
          ${proximo.profissionalNome} • ${(proximo.servicos || []).map(s => s.nome).join(' + ')}
        </div>
        <span class="proximo-horario">⏰ ${proximo.horario}</span>
      </div>
    `;
  } else {
    $('#proximo-cliente').innerHTML = '<div class="vazio-msg">Nenhum cliente agendado a seguir</div>';
  }

  // Faturamento por serviço
  const fatPorServico = {};
  concluidos.forEach(a => {
    (a.servicos || []).forEach(s => {
      if (!fatPorServico[s.nome]) fatPorServico[s.nome] = 0;
      fatPorServico[s.nome] += s.preco || 0;
    });
  });
  const fatArr = Object.entries(fatPorServico).sort((a, b) => b[1] - a[1]);
  if (fatArr.length === 0) {
    $('#fat-por-servico').innerHTML = '<div class="vazio-msg">Sem faturamento registrado hoje</div>';
  } else {
    const max = fatArr[0][1];
    $('#fat-por-servico').innerHTML = fatArr.map(([nome, valor]) => `
      <div class="fat-item">
        <div class="fat-info">
          <div class="fat-nome-row">
            <span class="fat-nome">${nome}</span>
            <span class="fat-valor">${formatarMoeda(valor)}</span>
          </div>
          <div class="fat-bar-bg">
            <div class="fat-bar" style="width: ${(valor / max) * 100}%"></div>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Lista hoje
  $('#hoje-count').textContent = `${agsHoje.length} agendamento${agsHoje.length !== 1 ? 's' : ''}`;
  if (agsHoje.length === 0) {
    $('#lista-hoje').innerHTML = '<div class="vazio-msg">Nenhum agendamento hoje</div>';
  } else {
    const sorted = agsHoje.sort((a, b) => horaParaMinutos(a.horario) - horaParaMinutos(b.horario));
    $('#lista-hoje').innerHTML = sorted.map(a => renderizarCardAgendamento(a)).join('');
    $$('#lista-hoje .agendamento-card').forEach(c => {
      c.addEventListener('click', () => abrirDetalhesAgendamento(c.dataset.id));
    });
  }
}

function renderizarCardAgendamento(a) {
  const statusClass = a.status === 'concluido' ? 'concluido' : a.status === 'cancelado' ? 'cancelado' : '';
  const statusLabel = { confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado' }[a.status];
  const statusCor = { confirmado: 'confirmado', concluido: 'concluido', cancelado: 'cancelado' }[a.status];
  return `
    <div class="agendamento-card ${statusClass}" data-id="${a.id}">
      <div class="agendamento-hora">${a.horario}</div>
      <div class="agendamento-info">
        <div class="agendamento-cliente">${a.clienteNome}</div>
        <div class="agendamento-detalhes">
          ${a.profissionalNome} • ${(a.servicos || []).map(s => s.nome).join(' + ')}
        </div>
      </div>
      <div class="agendamento-valor">${formatarMoeda(a.valorTotal)}</div>
      <span class="agendamento-status status-${statusCor}">${statusLabel}</span>
    </div>
  `;
}

// ========================================
// VIEW: AGENDA
// ========================================
function renderizarAgenda() {
  // Sincroniza input de data
  $('#agenda-data-input').value = dataParaChave(state.agendaDataAtual);

  // Atualiza filtro de profissionais
  const filtroProf = $('#filtro-profissional');
  const valorAtual = filtroProf.value;
  filtroProf.innerHTML = '<option value="todos">Todos profissionais</option>' +
    Object.entries(state.profissionais)
      .filter(([id, p]) => p.ativo !== false)
      .map(([id, p]) => `<option value="${id}">${p.nome}</option>`).join('');
  filtroProf.value = state.filtroProfissional || 'todos';

  // Filtra agendamentos da data
  const chave = dataParaChave(state.agendaDataAtual);
  let ags = Object.entries(state.agendamentos)
    .map(([id, a]) => ({ ...a, id }))
    .filter(a => a.dataChave === chave);

  if (state.filtroProfissional !== 'todos') {
    ags = ags.filter(a => a.profissionalId === state.filtroProfissional);
  }
  if (state.filtroStatus !== 'todos') {
    ags = ags.filter(a => a.status === state.filtroStatus);
  }

  ags.sort((a, b) => horaParaMinutos(a.horario) - horaParaMinutos(b.horario));

  if (ags.length === 0) {
    $('#agenda-timeline').innerHTML = '<div class="vazio-msg">Nenhum agendamento nessa data</div>';
  } else {
    $('#agenda-timeline').innerHTML = ags.map(a => renderizarCardAgendamento(a)).join('');
    $$('#agenda-timeline .agendamento-card').forEach(c => {
      c.addEventListener('click', () => abrirDetalhesAgendamento(c.dataset.id));
    });
  }
}

// ========================================
// DETALHES DO AGENDAMENTO (MODAL)
// ========================================
function abrirDetalhesAgendamento(id) {
  const a = state.agendamentos[id];
  if (!a) return;

  const fimMin = horaParaMinutos(a.horario) + a.duracaoMin;
  const data = chaveParaData(a.dataChave);
  const dataStr = formatarDataLonga(data);

  const corpo = `
    <div class="det-resumo">
      <div class="det-linha"><span class="label">Cliente</span><span class="valor">${a.clienteNome}</span></div>
      <div class="det-linha"><span class="label">WhatsApp</span><span class="valor">${formatarWhatsapp(a.clienteWhatsapp)}</span></div>
      <div class="det-linha"><span class="label">Profissional</span><span class="valor">${a.profissionalNome}</span></div>
      <div class="det-linha"><span class="label">Data</span><span class="valor">${dataStr}</span></div>
      <div class="det-linha"><span class="label">Horário</span><span class="valor">${a.horario} — ${minutosParaHora(fimMin)}</span></div>
      <div class="det-linha"><span class="label">Serviços</span><span class="valor">${(a.servicos || []).map(s => s.nome).join(' + ')}</span></div>
      <div class="det-linha"><span class="label">Total</span><span class="valor" style="color:var(--accent);font-family:'Bricolage Grotesque';font-weight:700;font-size:16px;">${formatarMoeda(a.valorTotal)}</span></div>
      <div class="det-linha"><span class="label">Status</span><span class="valor"><span class="agendamento-status status-${a.status}">${a.status}</span></span></div>
    </div>
    <div class="det-acoes">
      ${a.status === 'confirmado' ? `<button class="btn-concluir" id="acao-concluir">✓ Marcar como concluído</button>` : ''}
      ${a.status === 'confirmado' ? `<button class="btn-whatsapp" id="acao-whatsapp">💬 Enviar lembrete no WhatsApp</button>` : ''}
      ${a.status !== 'cancelado' && a.status !== 'concluido' ? `<button class="btn-cancelar" id="acao-cancelar">✕ Cancelar agendamento</button>` : ''}
    </div>
  `;

  abrirModal('Detalhes do agendamento', corpo);

  if (a.status === 'confirmado') {
    $('#acao-concluir').addEventListener('click', () => concluirAgendamento(id));
    $('#acao-whatsapp').addEventListener('click', () => enviarLembreteWhatsapp(a));
    $('#acao-cancelar').addEventListener('click', () => cancelarAgendamento(id));
  }
}

async function concluirAgendamento(id) {
  try {
    await update(ref(db, `barbearias/${state.barbeariaId}/agendamentos/${id}`), {
      status: 'concluido',
      concluidoEm: new Date().toISOString()
    });
    fecharModal();
    toast('Agendamento concluído! 💰', 'sucesso');
  } catch (err) {
    toast('Erro ao concluir', 'erro');
  }
}

async function cancelarAgendamento(id) {
  if (!confirm('Tem certeza que deseja cancelar este agendamento?')) return;
  try {
    await update(ref(db, `barbearias/${state.barbeariaId}/agendamentos/${id}`), {
      status: 'cancelado',
      canceladoEm: new Date().toISOString()
    });
    fecharModal();
    toast('Agendamento cancelado', 'sucesso');
  } catch (err) {
    toast('Erro ao cancelar', 'erro');
  }
}

function enviarLembreteWhatsapp(a) {
  const data = chaveParaData(a.dataChave);
  const dataStr = formatarDataLonga(data);
  const servicosStr = (a.servicos || []).map(s => s.nome).join(' + ');
  const msg = encodeURIComponent(
    `Olá ${a.clienteNome.split(' ')[0]}! 👋\n\n` +
    `Passando pra lembrar do seu horário na *${state.barbearia.nome}*:\n\n` +
    `📅 ${dataStr}\n` +
    `⏰ ${a.horario}\n` +
    `✂️ ${servicosStr}\n` +
    `👤 Com ${a.profissionalNome}\n\n` +
    `Te esperamos! Qualquer coisa, é só responder por aqui. 😊`
  );
  const url = `https://wa.me/${a.clienteWhatsapp}?text=${msg}`;
  window.open(url, '_blank');
}

// ========================================
// VIEW: SERVIÇOS (CRUD)
// ========================================
function renderizarServicos() {
  const lista = Object.entries(state.servicos)
    .map(([id, s]) => ({ ...s, id }))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  if (lista.length === 0) {
    $('#lista-servicos-admin').innerHTML = '<div class="vazio-msg">Nenhum serviço cadastrado. Clique em "+ Novo serviço" para começar.</div>';
    return;
  }

  $('#lista-servicos-admin').innerHTML = lista.map(s => `
    <div class="item-card" data-id="${s.id}">
      <div class="item-card-header">
        <div class="item-card-emoji">${s.emoji || '✂️'}</div>
        <div style="flex:1;">
          <div class="item-card-titulo">${s.nome}</div>
          <div class="item-card-sub">${s.duracaoMin} min • ${formatarMoeda(s.preco)}</div>
        </div>
        ${s.ativo === false ? '<span class="tag-inativo">Inativo</span>' : ''}
      </div>
      <div class="item-card-actions">
        <button class="btn-mini" data-acao="editar">Editar</button>
        <button class="btn-mini perigo" data-acao="deletar">Excluir</button>
      </div>
    </div>
  `).join('');

  $$('#lista-servicos-admin .item-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-acao="editar"]').addEventListener('click', () => modalServico(id));
    card.querySelector('[data-acao="deletar"]').addEventListener('click', () => deletarServico(id));
  });
}

function modalServico(id = null) {
  const s = id ? state.servicos[id] : { nome: '', duracaoMin: 30, preco: 0, emoji: '✂️', ativo: true, ordem: Object.keys(state.servicos).length + 1 };
  const titulo = id ? 'Editar serviço' : 'Novo serviço';
  const corpo = `
    <div class="input-grupo">
      <label class="input-label">NOME DO SERVIÇO</label>
      <input type="text" id="serv-nome" class="input" value="${s.nome}" placeholder="Ex: Corte Masculino">
    </div>
    <div class="form-grid">
      <div class="input-grupo">
        <label class="input-label">DURAÇÃO (MIN)</label>
        <input type="number" id="serv-duracao" class="input" value="${s.duracaoMin}" min="5" step="5">
      </div>
      <div class="input-grupo">
        <label class="input-label">PREÇO (R$)</label>
        <input type="number" id="serv-preco" class="input" value="${s.preco}" min="0" step="0.5">
      </div>
    </div>
    <div class="input-grupo">
      <label class="input-label">EMOJI</label>
      <input type="text" id="serv-emoji" class="input" value="${s.emoji || '✂️'}" maxlength="2">
      <small class="campo-help">Sugestões: ✂️ 🪒 💇 💆 💈 🧔 ✨</small>
    </div>
    <div class="input-grupo">
      <label style="display:flex;gap:10px;align-items:center;cursor:pointer;">
        <input type="checkbox" id="serv-ativo" ${s.ativo !== false ? 'checked' : ''}>
        <span>Serviço ativo (visível pros clientes)</span>
      </label>
    </div>
  `;
  const rodape = `
    <button class="btn-acao-secundario" id="modal-cancel">Cancelar</button>
    <button class="btn-acao" id="modal-salvar">Salvar</button>
  `;
  abrirModal(titulo, corpo, rodape);

  $('#modal-cancel').addEventListener('click', fecharModal);
  $('#modal-salvar').addEventListener('click', async () => {
    const dados = {
      nome: $('#serv-nome').value.trim(),
      duracaoMin: Number($('#serv-duracao').value),
      preco: Number($('#serv-preco').value),
      emoji: $('#serv-emoji').value.trim() || '✂️',
      ativo: $('#serv-ativo').checked,
      ordem: s.ordem
    };
    if (!dados.nome) { toast('Digite o nome do serviço', 'erro'); return; }
    if (dados.duracaoMin < 5) { toast('Duração mínima de 5 minutos', 'erro'); return; }

    try {
      if (id) {
        await update(ref(db, `barbearias/${state.barbeariaId}/servicos/${id}`), dados);
        toast('Serviço atualizado', 'sucesso');
      } else {
        const novoRef = push(ref(db, `barbearias/${state.barbeariaId}/servicos`));
        await set(novoRef, dados);
        toast('Serviço criado', 'sucesso');
      }
      fecharModal();
    } catch (err) {
      toast('Erro ao salvar', 'erro');
    }
  });
}

async function deletarServico(id) {
  if (!confirm(`Excluir o serviço "${state.servicos[id].nome}"?`)) return;
  try {
    await remove(ref(db, `barbearias/${state.barbeariaId}/servicos/${id}`));
    toast('Serviço excluído', 'sucesso');
  } catch (err) {
    toast('Erro ao excluir', 'erro');
  }
}

// ========================================
// VIEW: PROFISSIONAIS (CRUD)
// ========================================
function renderizarProfissionais() {
  const lista = Object.entries(state.profissionais).map(([id, p]) => ({ ...p, id }));

  if (lista.length === 0) {
    $('#lista-profissionais-admin').innerHTML = '<div class="vazio-msg">Nenhum profissional cadastrado.</div>';
    return;
  }

  $('#lista-profissionais-admin').innerHTML = lista.map(p => {
    const agsConcluidos = Object.values(state.agendamentos).filter(a => a.profissionalId === p.id && a.status === 'concluido').length;
    return `
      <div class="item-card" data-id="${p.id}">
        <div class="item-card-header">
          <div class="item-card-emoji" style="background:linear-gradient(135deg,${p.cor || '#d4ff3a'},${p.cor || '#b8e024'}aa);color:#0a0a0a;font-family:'Bricolage Grotesque';font-weight:700;">${iniciais(p.nome)}</div>
          <div style="flex:1;">
            <div class="item-card-titulo">${p.nome}</div>
            <div class="item-card-sub">${p.especialidade || 'Profissional'}</div>
          </div>
          ${p.ativo === false ? '<span class="tag-inativo">Inativo</span>' : ''}
        </div>
        <div class="item-card-stats">
          <div>
            <div class="item-stat-num">${p.comissao || 0}%</div>
            <div class="item-stat-label">Comissão</div>
          </div>
          <div>
            <div class="item-stat-num">${agsConcluidos}</div>
            <div class="item-stat-label">Atendimentos</div>
          </div>
        </div>
        <div class="item-card-actions">
          <button class="btn-mini" data-acao="editar">Editar</button>
          <button class="btn-mini perigo" data-acao="deletar">Excluir</button>
        </div>
      </div>
    `;
  }).join('');

  $$('#lista-profissionais-admin .item-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-acao="editar"]').addEventListener('click', () => modalProfissional(id));
    card.querySelector('[data-acao="deletar"]').addEventListener('click', () => deletarProfissional(id));
  });
}

function modalProfissional(id = null) {
  const p = id ? state.profissionais[id] : {
    nome: '', especialidade: '', comissao: 50, ativo: true,
    horarioTrabalho: diasDaSemana().reduce((acc, dia) => {
      acc[dia] = { ativo: dia !== 'domingo', inicio: '09:00', fim: '18:00' };
      return acc;
    }, {})
  };

  const dias = diasDaSemana();
  const labelsDias = { domingo: 'Domingo', segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado' };

  const corpo = `
    <div class="input-grupo">
      <label class="input-label">NOME</label>
      <input type="text" id="prof-nome" class="input" value="${p.nome}" placeholder="Nome completo">
    </div>
    <div class="form-grid">
      <div class="input-grupo">
        <label class="input-label">ESPECIALIDADE</label>
        <input type="text" id="prof-especialidade" class="input" value="${p.especialidade || ''}" placeholder="Ex: Clássico, Moderno">
      </div>
      <div class="input-grupo">
        <label class="input-label">COMISSÃO (%)</label>
        <input type="number" id="prof-comissao" class="input" value="${p.comissao || 50}" min="0" max="100">
      </div>
    </div>
    <div class="input-grupo">
      <label style="display:flex;gap:10px;align-items:center;cursor:pointer;">
        <input type="checkbox" id="prof-ativo" ${p.ativo !== false ? 'checked' : ''}>
        <span>Profissional ativo</span>
      </label>
    </div>
    <h4 style="margin:20px 0 12px;font-family:'Bricolage Grotesque';font-weight:700;font-size:14px;">Horário de trabalho</h4>
    <div class="horarios-conf">
      ${dias.map(dia => {
        const h = p.horarioTrabalho?.[dia] || { ativo: false, inicio: '09:00', fim: '18:00' };
        return `
          <div class="horario-linha" data-dia="${dia}">
            <div class="horario-dia">${labelsDias[dia]}</div>
            <div class="horario-switch">
              <label class="switch">
                <input type="checkbox" class="ht-ativo" ${h.ativo ? 'checked' : ''}>
                <span class="switch-slider"></span>
              </label>
            </div>
            <input type="time" class="horario-input ht-inicio" value="${h.inicio || '09:00'}">
            <input type="time" class="horario-input ht-fim" value="${h.fim || '18:00'}">
          </div>
        `;
      }).join('')}
    </div>
  `;
  const rodape = `
    <button class="btn-acao-secundario" id="modal-cancel">Cancelar</button>
    <button class="btn-acao" id="modal-salvar">Salvar</button>
  `;
  abrirModal(id ? 'Editar profissional' : 'Novo profissional', corpo, rodape);

  $('#modal-cancel').addEventListener('click', fecharModal);
  $('#modal-salvar').addEventListener('click', async () => {
    const horarioTrabalho = {};
    $$('.horario-linha').forEach(linha => {
      const dia = linha.dataset.dia;
      horarioTrabalho[dia] = {
        ativo: linha.querySelector('.ht-ativo').checked,
        inicio: linha.querySelector('.ht-inicio').value,
        fim: linha.querySelector('.ht-fim').value
      };
    });

    const dados = {
      nome: $('#prof-nome').value.trim(),
      especialidade: $('#prof-especialidade').value.trim(),
      comissao: Number($('#prof-comissao').value),
      ativo: $('#prof-ativo').checked,
      horarioTrabalho
    };
    if (!dados.nome) { toast('Digite o nome', 'erro'); return; }

    try {
      if (id) {
        await update(ref(db, `barbearias/${state.barbeariaId}/profissionais/${id}`), dados);
        toast('Profissional atualizado', 'sucesso');
      } else {
        const novoRef = push(ref(db, `barbearias/${state.barbeariaId}/profissionais`));
        await set(novoRef, dados);
        toast('Profissional criado', 'sucesso');
      }
      fecharModal();
    } catch (err) {
      toast('Erro ao salvar', 'erro');
    }
  });
}

async function deletarProfissional(id) {
  if (!confirm(`Excluir o profissional "${state.profissionais[id].nome}"?`)) return;
  try {
    await remove(ref(db, `barbearias/${state.barbeariaId}/profissionais/${id}`));
    toast('Profissional excluído', 'sucesso');
  } catch (err) {
    toast('Erro ao excluir', 'erro');
  }
}

// ========================================
// VIEW: CLIENTES
// ========================================
function renderizarClientes() {
  const lista = Object.entries(state.clientes).map(([whats, c]) => ({ ...c, whatsapp: whats }));
  $('#clientes-total').textContent = `${lista.length} cliente${lista.length !== 1 ? 's' : ''} cadastrado${lista.length !== 1 ? 's' : ''}`;

  const filtro = ($('#busca-cliente').value || '').toLowerCase();
  const filtrados = filtro
    ? lista.filter(c => c.nome?.toLowerCase().includes(filtro) || c.whatsapp.includes(filtro))
    : lista;

  filtrados.sort((a, b) => (b.totalAgendamentos || 0) - (a.totalAgendamentos || 0));

  if (filtrados.length === 0) {
    $('#lista-clientes-admin').innerHTML = '<div class="vazio-msg">Nenhum cliente encontrado</div>';
    return;
  }

  $('#lista-clientes-admin').innerHTML = filtrados.map(c => {
    const total = c.totalAgendamentos || 0;
    const ags = Object.values(state.agendamentos).filter(a => a.clienteWhatsapp === c.whatsapp && a.status === 'concluido');
    const faturado = ags.reduce((s, a) => s + (a.valorTotal || 0), 0);
    return `
      <div class="item-card">
        <div class="item-card-header">
          <div class="item-card-emoji" style="background:var(--accent);color:#0a0a0a;font-family:'Bricolage Grotesque';font-weight:700;">${iniciais(c.nome)}</div>
          <div style="flex:1;">
            <div class="item-card-titulo">${c.nome}</div>
            <div class="item-card-sub">${formatarWhatsapp(c.whatsapp)}</div>
          </div>
        </div>
        <div class="item-card-stats">
          <div>
            <div class="item-stat-num">${total}</div>
            <div class="item-stat-label">Visitas</div>
          </div>
          <div>
            <div class="item-stat-num">${formatarMoeda(faturado)}</div>
            <div class="item-stat-label">Faturado</div>
          </div>
        </div>
        <div class="item-card-actions">
          <button class="btn-mini" onclick="window.open('https://wa.me/${c.whatsapp}', '_blank')">💬 Conversar</button>
        </div>
      </div>
    `;
  }).join('');
}

// ========================================
// VIEW: CONFIGURAÇÕES
// ========================================
function renderizarConfiguracoes() {
  $('#conf-nome').value = state.barbearia.nome || '';
  $('#conf-endereco').value = state.barbearia.endereco || '';
  $('#conf-telefone').value = state.barbearia.telefone || '';
  $('#conf-slug').value = state.barbeariaId;
  $('#link-publico').textContent = `${window.location.origin}/${state.barbeariaId}`;

  // Horários
  const dias = diasDaSemana();
  const labels = { domingo: 'Domingo', segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado' };
  const hf = state.barbearia.horarioFuncionamento || {};
  $('#horarios-funcionamento').innerHTML = dias.map(dia => {
    const h = hf[dia] || { ativo: false, inicio: '09:00', fim: '18:00' };
    return `
      <div class="horario-linha" data-dia="${dia}">
        <div class="horario-dia">${labels[dia]}</div>
        <div class="horario-switch">
          <label class="switch">
            <input type="checkbox" class="hf-ativo" ${h.ativo ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </label>
        </div>
        <input type="time" class="horario-input hf-inicio" value="${h.inicio || '09:00'}">
        <input type="time" class="horario-input hf-fim" value="${h.fim || '18:00'}">
      </div>
    `;
  }).join('');

  // QR Code
  const linkPublico = `${window.location.origin}/${state.barbeariaId}`;
  const qrEl = $('#qr-code-container');
  qrEl.innerHTML = '';
  try {
    new QRCode(qrEl, {
      text: linkPublico,
      width: 180,
      height: 180,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (e) {
    qrEl.innerHTML = '<div style="color:#666;">QR Code não disponível</div>';
  }
}

async function salvarConfiguracoes(e) {
  e.preventDefault();
  const dados = {
    nome: $('#conf-nome').value.trim(),
    endereco: $('#conf-endereco').value.trim(),
    telefone: $('#conf-telefone').value.trim(),
    horarioFuncionamento: {}
  };
  $$('#horarios-funcionamento .horario-linha').forEach(linha => {
    const dia = linha.dataset.dia;
    dados.horarioFuncionamento[dia] = {
      ativo: linha.querySelector('.hf-ativo').checked,
      inicio: linha.querySelector('.hf-inicio').value,
      fim: linha.querySelector('.hf-fim').value
    };
  });

  try {
    await update(ref(db, `barbearias/${state.barbeariaId}/info`), dados);
    toast('Configurações salvas', 'sucesso');
  } catch (err) {
    toast('Erro ao salvar', 'erro');
  }
}

function baixarQR() {
  const canvas = $('#qr-code-container canvas') || $('#qr-code-container img');
  if (!canvas) { toast('QR Code não encontrado', 'erro'); return; }
  const link = document.createElement('a');
  link.download = `qrcode-${state.barbeariaId}.png`;
  link.href = canvas.tagName === 'IMG' ? canvas.src : canvas.toDataURL();
  link.click();
}

// ========================================
// MODAL HELPERS
// ========================================
function abrirModal(titulo, corpo, rodape = '') {
  $('#modal-titulo').textContent = titulo;
  $('#modal-body').innerHTML = corpo;
  $('#modal-footer').innerHTML = rodape;
  $('#modal-overlay').classList.remove('hidden');
}

function fecharModal() {
  $('#modal-overlay').classList.add('hidden');
}

// ========================================
// EVENTOS DAS VIEWS
// ========================================
function inicializarEventosViews() {
  $('#modal-close').addEventListener('click', fecharModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') fecharModal();
  });

  // Dashboard
  $('#btn-atualizar-dash').addEventListener('click', renderizarDashboard);

  // Agenda
  $('#btn-data-prev').addEventListener('click', () => {
    state.agendaDataAtual.setDate(state.agendaDataAtual.getDate() - 1);
    renderizarAgenda();
  });
  $('#btn-data-next').addEventListener('click', () => {
    state.agendaDataAtual.setDate(state.agendaDataAtual.getDate() + 1);
    renderizarAgenda();
  });
  $('#btn-data-hoje').addEventListener('click', () => {
    state.agendaDataAtual = new Date();
    renderizarAgenda();
  });
  $('#agenda-data-input').addEventListener('change', (e) => {
    state.agendaDataAtual = chaveParaData(e.target.value);
    renderizarAgenda();
  });
  $('#filtro-profissional').addEventListener('change', (e) => {
    state.filtroProfissional = e.target.value;
    renderizarAgenda();
  });
  $('#filtro-status').addEventListener('change', (e) => {
    state.filtroStatus = e.target.value;
    renderizarAgenda();
  });
  $('#btn-novo-agendamento').addEventListener('click', () => {
    toast('Em breve: agendamento manual pelo painel', 'sucesso');
  });

  // Serviços
  $('#btn-novo-servico').addEventListener('click', () => modalServico());

  // Profissionais
  $('#btn-novo-profissional').addEventListener('click', () => modalProfissional());

  // Clientes
  $('#busca-cliente').addEventListener('input', renderizarClientes);

  // Configurações
  $('#form-config').addEventListener('submit', salvarConfiguracoes);
  $('#btn-baixar-qr').addEventListener('click', baixarQR);
}

// ========================================
// START
// ========================================
inicializarAuth();
