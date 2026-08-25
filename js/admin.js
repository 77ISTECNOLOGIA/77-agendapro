// ========================================
// 77 AGENDAPRO — Painel Admin
// ========================================

import { db } from './firebase-config.js';
import { escapeHtml } from './utils.js';
import { aplicarTema, resetarTema } from './vocabulario.js';
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
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
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

// Chave gerada no Firebase Console > Configurações > Cloud Messaging > Certificados push da Web
const VAPID_KEY = 'BBDdf4Estwxij9B1m3R7jZCrNNMul4EcIjAYJ9-Xw-8mgebCIgGwCUfPdYBko7scsVQ6VxMefFBYORQv9mzLYl4';

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
        aplicarTema(state.barbearia.tipoNegocio);
        renderizarUserInfo(userData);
        mostrarApp();
        ativarListenersTempoReal();
        await renderizarTudo();
        ouvirNotificacoesEmPrimeiroPlano();
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

// ========================================
// NOTIFICAÇÕES PUSH (FCM)
// ========================================
async function ativarNotificacoes() {
  const ehIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const ehStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (ehIOS && !ehStandalone) {
    toast('No iPhone: toque em Compartilhar → "Adicionar à Tela de Início", abra o app por lá e tente de novo', 'erro');
    return;
  }

  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    toast('Seu navegador não suporta notificações push', 'erro');
    return;
  }

  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      toast('Permissão de notificação não concedida', 'erro');
      return;
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(getApp());
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      toast('Não foi possível gerar o token de notificação', 'erro');
      return;
    }

    // Salva o token deste dispositivo na lista, usando um ID fixo do navegador como chave
    // (não o token em si, que pode rotacionar e criar entradas duplicadas pro mesmo dispositivo)
    const deviceId = obterDeviceId();
    await set(ref(db, `barbearias/${state.barbeariaId}/info/fcmTokens/${deviceId}`), token);

    // Atualiza o estado local imediatamente (o listener em tempo real também vai confirmar isso em seguida)
    if (!state.barbearia.fcmTokens) state.barbearia.fcmTokens = {};
    state.barbearia.fcmTokens[deviceId] = token;
    const totalAtual = Object.keys(state.barbearia.fcmTokens).length;

    toast('Notificações ativadas neste dispositivo! 🔔', 'sucesso');
    atualizarStatusNotificacoes(true, totalAtual);
    ouvirNotificacoesEmPrimeiroPlano();
  } catch (err) {
    console.error('Erro ao ativar notificações:', err);
    toast('Erro ao ativar notificações', 'erro');
  }
}

// Gera (ou recupera) um ID fixo para este navegador/dispositivo, salvo localmente.
// Garante que reativar notificações no mesmo aparelho sempre atualiza a mesma entrada,
// mesmo que o token do Firebase mude.
function obterDeviceId() {
  let id = localStorage.getItem('agendapro_device_id');
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('agendapro_device_id', id);
  }
  return id;
}

function atualizarStatusNotificacoes(ativo, totalDispositivos = 0) {
  const btn = $('#btn-ativar-notificacoes');
  const status = $('#status-notificacoes');
  if (!btn) return;

  if (ativo) {
    btn.textContent = '🔔 Ativar neste dispositivo também';
    btn.disabled = false;
    if (status) {
      status.textContent = `${totalDispositivos} dispositivo${totalDispositivos !== 1 ? 's' : ''} recebendo notificações`;
      status.classList.remove('hidden');
    }
  } else {
    btn.textContent = '🔔 Ativar notificações push';
    btn.disabled = false;
    if (status) status.classList.add('hidden');
  }
}

// Escuta notificações chegando ENQUANTO o painel está aberto e em primeiro plano.
// Sem isso, o navegador recebe a notificação silenciosamente e não mostra nada na tela
// quando a aba do admin já está ativa (só mostra automaticamente em segundo plano).
let listenerForegroundAtivo = false;
function ouvirNotificacoesEmPrimeiroPlano() {
  if (listenerForegroundAtivo) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const messaging = getMessaging(getApp());
    onMessage(messaging, (payload) => {
      const corpo = (payload.notification && payload.notification.body) || '';
      // Em primeiro plano, mostra só o toast — a notificação nativa do sistema
      // já é tratada automaticamente em segundo plano, evitando duplicidade
      toast(`🔔 ${corpo}`, 'sucesso');
    });
    listenerForegroundAtivo = true;
  } catch (err) {
    console.error('Erro ao escutar notificações em primeiro plano:', err);
  }
}

async function handleLogout() {
  if (!confirm('Deseja realmente sair?')) return;
  await signOut(auth);
}

function mostrarLogin(msg) {
  // Restaura identidade visual padrão da 77 IS (corrige cor "presa" do último negócio logado)
  resetarTema();

  $('#loading').classList.add('hidden');
  $('#admin-app').classList.add('hidden');
  $('#tela-login').classList.remove('hidden');

  // Reset do botão de login (corrige bug do botão travado em "Entrando..." após logout)
  const btn = $('#btn-login');
  btn.disabled = false;
  btn.textContent = 'Entrar';

  if (msg) {
    $('#erro-login').textContent = msg;
    $('#erro-login').classList.remove('hidden');
  } else {
    $('#erro-login').classList.add('hidden');
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
      irPara(item.dataset.view);
    });
  });
}

function irPara(view) {
  state.viewAtual = view;
  $$('.nav-item').forEach(n => n.classList.toggle('ativo', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('ativa', v.id === `view-${view}`));
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
      <div class="proximo-avatar">${escapeHtml(iniciais(proximo.clienteNome))}</div>
      <div class="proximo-info">
        <div class="proximo-nome">${escapeHtml(proximo.clienteNome)}</div>
        <div class="proximo-detalhes">
          ${escapeHtml(proximo.profissionalNome)} • ${(proximo.servicos || []).map(s => escapeHtml(s.nome)).join(' + ')}
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
            <span class="fat-nome">${escapeHtml(nome)}</span>
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

  // Botão "Enviar lembretes do dia" — Solução Híbrida 2.0
  const pendentesLembrete = confirmados.filter(a => !a.lembreteEnviado);
  renderizarBotaoLembretesEmLote(pendentesLembrete);

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

function renderizarBotaoLembretesEmLote(pendentes) {
  // Remove botão antigo se existir
  const antigo = document.getElementById('btn-lembretes-lote-container');
  if (antigo) antigo.remove();

  if (pendentes.length === 0) return;

  const cardHeader = document.querySelector('#view-dashboard .lista-agendamentos').previousElementSibling;
  const container = document.createElement('div');
  container.id = 'btn-lembretes-lote-container';
  container.style.cssText = 'margin: 12px 0; padding: 14px; background: rgba(212, 255, 58, 0.08); border: 1px solid rgba(212, 255, 58, 0.3); border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;';
  container.innerHTML = `
    <div style="flex:1; min-width: 200px;">
      <div style="font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 14px; color: var(--accent); margin-bottom: 2px;">
        💬 ${pendentes.length} cliente${pendentes.length !== 1 ? 's' : ''} sem lembrete
      </div>
      <div style="font-size: 12px; color: var(--text-dim);">Envie agora pra reduzir faltas no dia</div>
    </div>
    <button id="btn-enviar-lembretes" class="btn-acao">Enviar lembretes</button>
  `;
  cardHeader.parentNode.insertBefore(container, cardHeader.nextSibling);

  document.getElementById('btn-enviar-lembretes').addEventListener('click', () => abrirModalLembretes(pendentes));
}

function abrirModalLembretes(pendentes) {
  const ordenados = [...pendentes].sort((a, b) => horaParaMinutos(a.horario) - horaParaMinutos(b.horario));

  const corpo = `
    <p style="color: var(--text-dim); font-size: 13px; margin-bottom: 16px; line-height: 1.5;">
      Clique em cada cliente pra abrir o WhatsApp com a mensagem pronta. Após enviar, marque como "lembrado" pra não duplicar.
    </p>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${ordenados.map(a => `
        <div class="lembrete-item" data-id="${a.id}" style="background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; gap: 12px; align-items: center;">
          <div style="font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; color: var(--accent); min-width: 50px;">${a.horario}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(a.clienteNome)}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${(a.servicos || []).map(s => escapeHtml(s.nome)).join(' + ')}</div>
          </div>
          <button class="btn-mini" data-acao="lembrar" style="background: rgba(74, 222, 128, 0.1); border-color: rgba(74, 222, 128, 0.3); color: var(--success);">💬 Enviar</button>
        </div>
      `).join('')}
    </div>
  `;
  const rodape = `
    <button class="btn-acao-secundario" id="modal-cancel">Fechar</button>
  `;
  abrirModal(`Lembretes pendentes (${ordenados.length})`, corpo, rodape);

  document.getElementById('modal-cancel').addEventListener('click', fecharModal);

  // Eventos individuais — único método garantido de funcionar em qualquer navegador.
  // Abrir várias abas de uma vez via código é bloqueado pelos navegadores por segurança,
  // então o envio é feito um clique por cliente.
  document.querySelectorAll('.lembrete-item button[data-acao="lembrar"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const item = e.target.closest('.lembrete-item');
      const id = item.dataset.id;
      const ag = state.agendamentos[id];
      if (!ag) return;

      // Abre WhatsApp
      enviarLembreteWhatsapp(ag);

      // Marca como lembrado no banco
      await marcarLembreteEnviado(id);

      // Atualiza visual
      item.style.opacity = '0.5';
      btn.textContent = '✓ Enviado';
      btn.disabled = true;
    });
  });
}

async function marcarLembreteEnviado(agendamentoId) {
  try {
    await update(ref(db, `barbearias/${state.barbeariaId}/agendamentos/${agendamentoId}`), {
      lembreteEnviado: true,
      lembreteEnviadoEm: new Date().toISOString()
    });
  } catch (err) {
    console.error('Erro ao marcar lembrete:', err);
  }
}

function renderizarCardAgendamento(a) {
  const statusClass = a.status === 'concluido' ? 'concluido' : a.status === 'cancelado' ? 'cancelado' : '';
  const statusLabel = { confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado' }[a.status];
  const statusCor = { confirmado: 'confirmado', concluido: 'concluido', cancelado: 'cancelado' }[a.status];
  const lembreteBadge = (a.status === 'confirmado' && a.lembreteEnviado)
    ? '<span title="Lembrete enviado" style="color: var(--success); font-size: 11px; margin-right: 4px;">💬✓</span>'
    : '';
  return `
    <div class="agendamento-card ${statusClass}" data-id="${a.id}">
      <div class="agendamento-hora">${a.horario}</div>
      <div class="agendamento-info">
        <div class="agendamento-cliente">${lembreteBadge}${escapeHtml(a.clienteNome)}</div>
        <div class="agendamento-detalhes">
          ${escapeHtml(a.profissionalNome)} • ${(a.servicos || []).map(s => escapeHtml(s.nome)).join(' + ')}
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
      .map(([id, p]) => `<option value="${id}">${escapeHtml(p.nome)}</option>`).join('');
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
  const lembreteStr = a.lembreteEnviado
    ? '<span style="color: var(--success);">✓ Lembrete enviado</span>'
    : '<span style="color: var(--warning);">Não enviado</span>';

  const corpo = `
    <div class="det-resumo">
      <div class="det-linha"><span class="label">Cliente</span><span class="valor">${escapeHtml(a.clienteNome)}</span></div>
      <div class="det-linha"><span class="label">WhatsApp</span><span class="valor">${escapeHtml(formatarWhatsapp(a.clienteWhatsapp))}</span></div>
      <div class="det-linha"><span class="label">Profissional</span><span class="valor">${escapeHtml(a.profissionalNome)}</span></div>
      <div class="det-linha"><span class="label">Data</span><span class="valor">${dataStr}</span></div>
      <div class="det-linha"><span class="label">Horário</span><span class="valor">${a.horario} — ${minutosParaHora(fimMin)}</span></div>
      <div class="det-linha"><span class="label">Serviços</span><span class="valor">${(a.servicos || []).map(s => escapeHtml(s.nome)).join(' + ')}</span></div>
      <div class="det-linha"><span class="label">Total</span><span class="valor" style="color:var(--accent);font-family:'Bricolage Grotesque';font-weight:700;font-size:16px;">${formatarMoeda(a.valorTotal)}</span></div>
      <div class="det-linha"><span class="label">Status</span><span class="valor"><span class="agendamento-status status-${a.status}">${a.status}</span></span></div>
      ${a.status === 'confirmado' ? `<div class="det-linha"><span class="label">Lembrete</span><span class="valor">${lembreteStr}</span></div>` : ''}
    </div>
    <div class="det-acoes">
      ${a.status === 'confirmado' ? `<button class="btn-concluir" id="acao-concluir">✓ Marcar como concluído</button>` : ''}
      ${a.status === 'confirmado' ? `<button class="btn-remarcar" id="acao-remarcar">🔁 Remarcar</button>` : ''}
      ${a.status === 'confirmado' ? `<button class="btn-whatsapp" id="acao-whatsapp">💬 ${a.lembreteEnviado ? 'Reenviar' : 'Enviar'} lembrete no WhatsApp</button>` : ''}
      ${a.status !== 'cancelado' && a.status !== 'concluido' ? `<button class="btn-cancelar" id="acao-cancelar">✕ Cancelar agendamento</button>` : ''}
    </div>
  `;

  abrirModal('Detalhes do agendamento', corpo);

  if (a.status === 'confirmado') {
    $('#acao-concluir').addEventListener('click', () => concluirAgendamento(id));
    $('#acao-remarcar').addEventListener('click', () => modalRemarcarAgendamento(id));
    $('#acao-whatsapp').addEventListener('click', () => enviarLembreteWhatsapp({ ...a, id }));
    $('#acao-cancelar').addEventListener('click', () => cancelarAgendamento(id));
  }
}

function modalRemarcarAgendamento(id) {
  const a = state.agendamentos[id];
  if (!a) return;

  const hojeStr = dataParaChave(new Date());
  const corpo = `
    <div class="det-resumo" style="margin-bottom:20px;">
      <div class="det-linha"><span class="label">Cliente</span><span class="valor">${escapeHtml(a.clienteNome)}</span></div>
      <div class="det-linha"><span class="label">Profissional</span><span class="valor">${escapeHtml(a.profissionalNome)}</span></div>
      <div class="det-linha"><span class="label">Serviços</span><span class="valor">${(a.servicos || []).map(s => escapeHtml(s.nome)).join(' + ')}</span></div>
      <div class="det-linha"><span class="label">Atual</span><span class="valor">${formatarDataLonga(chaveParaData(a.dataChave))} — ${a.horario}</span></div>
    </div>
    <div class="form-grid">
      <div class="input-grupo">
        <label class="input-label">NOVA DATA</label>
        <input type="date" id="rmc-data" class="input" min="${hojeStr}" value="${a.dataChave}">
      </div>
      <div class="input-grupo">
        <label class="input-label">NOVO HORÁRIO</label>
        <select id="rmc-horario" class="input" disabled>
          <option value="">Escolha a data</option>
        </select>
      </div>
    </div>
  `;
  const rodape = `
    <button class="btn-acao-secundario" id="modal-cancel">Cancelar</button>
    <button class="btn-acao" id="modal-salvar">Confirmar nova data</button>
  `;
  abrirModal('Remarcar agendamento', corpo, rodape);

  $('#modal-cancel').addEventListener('click', fecharModal);

  function atualizarHorariosRemarcar() {
    const selectHorario = $('#rmc-horario');
    const dataStr = $('#rmc-data').value;
    if (!dataStr) {
      selectHorario.innerHTML = '<option value="">Escolha a data</option>';
      selectHorario.disabled = true;
      return;
    }
    const slots = calcularHorariosDisponiveisAdmin(a.profissionalId, chaveParaData(dataStr), a.duracaoMin, id);
    if (slots.length === 0) {
      selectHorario.innerHTML = '<option value="">Nenhum horário disponível nessa data</option>';
      selectHorario.disabled = true;
      return;
    }
    selectHorario.innerHTML = '<option value="">Selecione...</option>' + slots.map(h =>
      `<option value="${h}" ${h === a.horario && dataStr === a.dataChave ? 'selected' : ''}>${h}</option>`
    ).join('');
    selectHorario.disabled = false;
  }
  $('#rmc-data').addEventListener('change', atualizarHorariosRemarcar);
  atualizarHorariosRemarcar();

  $('#modal-salvar').addEventListener('click', async () => {
    const novaData = $('#rmc-data').value;
    const novoHorario = $('#rmc-horario').value;
    if (!novaData || !novoHorario) { toast('Selecione data e horário', 'erro'); return; }

    const btn = $('#modal-salvar');
    btn.disabled = true;
    btn.textContent = 'Remarcando...';

    try {
      const slotsAtuais = calcularHorariosDisponiveisAdmin(a.profissionalId, chaveParaData(novaData), a.duracaoMin, id);
      if (!slotsAtuais.includes(novoHorario)) {
        toast('Esse horário acabou de ficar indisponível. Escolha outro.', 'erro');
        atualizarHorariosRemarcar();
        btn.disabled = false;
        btn.textContent = 'Confirmar nova data';
        return;
      }

      await update(ref(db, `barbearias/${state.barbeariaId}/agendamentos/${id}`), {
        dataChave: novaData,
        horario: novoHorario,
        lembreteEnviado: false,
        remarcadoEm: new Date().toISOString(),
        remarcadoPor: 'dono'
      });
      toast('Agendamento remarcado', 'sucesso');
      fecharModal();
    } catch (err) {
      console.error('Erro ao remarcar:', err);
      toast('Erro ao remarcar', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar nova data';
    }
  });
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

// ========================================
// NOVO AGENDAMENTO MANUAL (pelo dono)
// ========================================
function calcularHorariosDisponiveisAdmin(profissionalId, data, duracaoTotal, ignorarId = null) {
  const prof = state.profissionais[profissionalId];
  if (!prof) return [];

  const diaSemana = diasDaSemana()[data.getDay()];
  const horarioTrabalho = (prof.horarioTrabalho && prof.horarioTrabalho[diaSemana])
    || (state.barbearia.horarioFuncionamento && state.barbearia.horarioFuncionamento[diaSemana]);

  if (!horarioTrabalho || !horarioTrabalho.ativo) return [];

  const inicio = horaParaMinutos(horarioTrabalho.inicio || '09:00');
  const fim = horaParaMinutos(horarioTrabalho.fim || '20:00');
  const intervalo = 30;
  const dataChave = dataParaChave(data);

  const ocupados = Object.entries(state.agendamentos)
    .filter(([id, a]) => a.profissionalId === profissionalId && a.dataChave === dataChave && a.status !== 'cancelado' && id !== ignorarId)
    .map(([id, a]) => ({ inicio: horaParaMinutos(a.horario), fim: horaParaMinutos(a.horario) + a.duracaoMin }));

  const bloqueios = (prof.bloqueios && prof.bloqueios[dataChave]) || [];

  const agora = new Date();
  const ehHoje = dataChave === dataParaChave(agora);
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

  const slots = [];
  for (let m = inicio; m + duracaoTotal <= fim; m += intervalo) {
    if (ehHoje && m < minutosAgora) continue;
    const hora = minutosParaHora(m);
    const slotInicio = m, slotFim = m + duracaoTotal;
    const ocupado = ocupados.some(o => slotInicio < o.fim && slotFim > o.inicio);
    if (ocupado) continue;
    if (bloqueios.includes(hora)) continue;
    slots.push(hora);
  }
  return slots;
}

function modalNovoAgendamento() {
  const profsAtivos = Object.entries(state.profissionais).filter(([id, p]) => p.ativo !== false);
  const servicosAtivos = Object.entries(state.servicos)
    .filter(([id, s]) => s.ativo !== false)
    .sort((a, b) => (a[1].ordem || 0) - (b[1].ordem || 0));
  const hojeStr = dataParaChave(new Date());

  const corpo = `
    <div class="input-grupo">
      <label class="input-label">BUSCAR CLIENTE EXISTENTE</label>
      <input type="text" id="nag-busca-cliente" class="input" placeholder="Nome ou WhatsApp..." autocomplete="off">
      <div id="nag-sugestoes-cliente" class="nag-sugestoes hidden"></div>
    </div>
    <div class="form-grid">
      <div class="input-grupo">
        <label class="input-label">NOME DO CLIENTE</label>
        <input type="text" id="nag-cliente-nome" class="input" placeholder="Nome completo">
      </div>
      <div class="input-grupo">
        <label class="input-label">WHATSAPP</label>
        <input type="tel" id="nag-cliente-whatsapp" class="input" placeholder="(21) 98765-4321">
      </div>
    </div>
    <div class="input-grupo">
      <label class="input-label">SERVIÇOS</label>
      ${servicosAtivos.length === 0 ? '<div class="campo-help">Nenhum serviço cadastrado ainda.</div>' : `
        <div class="nag-servicos-lista">
          ${servicosAtivos.map(([id, s]) => `
            <label class="nag-servico-item">
              <input type="checkbox" class="nag-servico-check" value="${id}">
              <span>${escapeHtml(s.nome)} — ${s.duracaoMin} min • ${formatarMoeda(s.preco)}</span>
            </label>
          `).join('')}
        </div>
      `}
    </div>
    <div class="input-grupo">
      <label class="input-label">PROFISSIONAL</label>
      <select id="nag-profissional" class="input">
        <option value="">Selecione...</option>
        ${profsAtivos.map(([id, p]) => `<option value="${id}">${escapeHtml(p.nome)}</option>`).join('')}
      </select>
    </div>
    <div class="form-grid">
      <div class="input-grupo">
        <label class="input-label">DATA</label>
        <input type="date" id="nag-data" class="input" min="${hojeStr}" value="${hojeStr}">
      </div>
      <div class="input-grupo">
        <label class="input-label">HORÁRIO</label>
        <select id="nag-horario" class="input" disabled>
          <option value="">Escolha serviço, profissional e data</option>
        </select>
      </div>
    </div>
  `;
  const rodape = `
    <button class="btn-acao-secundario" id="modal-cancel">Cancelar</button>
    <button class="btn-acao" id="modal-salvar">Criar agendamento</button>
  `;
  abrirModal('Novo agendamento', corpo, rodape);

  $('#modal-cancel').addEventListener('click', fecharModal);

  $('#nag-busca-cliente').addEventListener('input', (e) => {
    const termo = e.target.value.trim().toLowerCase();
    const sugestoesEl = $('#nag-sugestoes-cliente');
    if (termo.length < 2) {
      sugestoesEl.classList.add('hidden');
      sugestoesEl.innerHTML = '';
      return;
    }
    const matches = Object.entries(state.clientes)
      .filter(([whats, c]) => (c.nome || '').toLowerCase().includes(termo) || whats.includes(termo))
      .slice(0, 6);
    if (matches.length === 0) {
      sugestoesEl.classList.add('hidden');
      sugestoesEl.innerHTML = '';
      return;
    }
    sugestoesEl.innerHTML = matches.map(([whats, c]) => `
      <div class="nag-sugestao-item" data-whats="${whats}" data-nome="${escapeHtml(c.nome)}">${escapeHtml(c.nome)} • ${escapeHtml(formatarWhatsapp(whats))}</div>
    `).join('');
    sugestoesEl.classList.remove('hidden');
    sugestoesEl.querySelectorAll('.nag-sugestao-item').forEach(item => {
      item.addEventListener('click', () => {
        $('#nag-cliente-nome').value = item.dataset.nome;
        $('#nag-cliente-whatsapp').value = formatarWhatsapp(item.dataset.whats);
        sugestoesEl.classList.add('hidden');
        $('#nag-busca-cliente').value = '';
      });
    });
  });

  $$('#modal-body .nag-servico-check').forEach(chk => chk.addEventListener('change', atualizarHorariosNovoAgendamento));
  $('#nag-profissional').addEventListener('change', atualizarHorariosNovoAgendamento);
  $('#nag-data').addEventListener('change', atualizarHorariosNovoAgendamento);

  $('#modal-salvar').addEventListener('click', salvarNovoAgendamento);
}

function duracaoServicosSelecionadosNovoAgendamento() {
  return $$('#modal-body .nag-servico-check:checked')
    .map(c => state.servicos[c.value]?.duracaoMin || 0)
    .reduce((s, d) => s + d, 0);
}

function atualizarHorariosNovoAgendamento() {
  const selectHorario = $('#nag-horario');
  const profId = $('#nag-profissional').value;
  const dataStr = $('#nag-data').value;
  const duracao = duracaoServicosSelecionadosNovoAgendamento();

  if (!profId || !dataStr || duracao === 0) {
    selectHorario.innerHTML = '<option value="">Escolha serviço, profissional e data</option>';
    selectHorario.disabled = true;
    return;
  }

  const slots = calcularHorariosDisponiveisAdmin(profId, chaveParaData(dataStr), duracao);

  if (slots.length === 0) {
    selectHorario.innerHTML = '<option value="">Nenhum horário disponível nessa data</option>';
    selectHorario.disabled = true;
    return;
  }

  selectHorario.innerHTML = '<option value="">Selecione...</option>' + slots.map(h => `<option value="${h}">${h}</option>`).join('');
  selectHorario.disabled = false;
}

async function salvarNovoAgendamento() {
  const nome = $('#nag-cliente-nome').value.trim();
  const whatsappRaw = $('#nag-cliente-whatsapp').value.trim();
  const servicoIds = $$('#modal-body .nag-servico-check:checked').map(c => c.value);
  const profId = $('#nag-profissional').value;
  const dataStr = $('#nag-data').value;
  const horario = $('#nag-horario').value;

  if (!nome) { toast('Digite o nome do cliente', 'erro'); return; }
  const whatsDigitos = whatsappRaw.replace(/\D/g, '');
  if (whatsDigitos.length !== 11 || whatsDigitos[2] !== '9') { toast('Digite um WhatsApp válido com DDD', 'erro'); return; }
  if (servicoIds.length === 0) { toast('Selecione ao menos um serviço', 'erro'); return; }
  if (!profId) { toast('Selecione o profissional', 'erro'); return; }
  if (!dataStr || !horario) { toast('Selecione data e horário', 'erro'); return; }

  const whatsNorm = '55' + whatsDigitos;
  const servicos = servicoIds.map(id => ({
    id, nome: state.servicos[id].nome, preco: state.servicos[id].preco, duracaoMin: state.servicos[id].duracaoMin
  }));
  const valorTotal = servicos.reduce((s, sv) => s + sv.preco, 0);
  const duracaoMin = servicos.reduce((s, sv) => s + sv.duracaoMin, 0);

  const btn = $('#modal-salvar');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    // Revalida o horário na hora de salvar (mesma proteção anti-conflito do fluxo público)
    const slotsAtuais = calcularHorariosDisponiveisAdmin(profId, chaveParaData(dataStr), duracaoMin);
    if (!slotsAtuais.includes(horario)) {
      toast('Esse horário acabou de ficar indisponível. Escolha outro.', 'erro');
      atualizarHorariosNovoAgendamento();
      btn.disabled = false;
      btn.textContent = 'Criar agendamento';
      return;
    }

    const clienteRef = ref(db, `barbearias/${state.barbeariaId}/clientes/${whatsNorm}`);
    const clienteSnap = await get(clienteRef);
    if (clienteSnap.exists()) {
      const atual = clienteSnap.val();
      await set(clienteRef, {
        ...atual,
        nome,
        totalAgendamentos: (atual.totalAgendamentos || 0) + 1,
        ultimoAgendamento: new Date().toISOString()
      });
    } else {
      await set(clienteRef, {
        nome,
        whatsapp: whatsNorm,
        primeiraVisita: new Date().toISOString(),
        ultimoAgendamento: new Date().toISOString(),
        totalAgendamentos: 1
      });
    }

    const novoRef = push(ref(db, `barbearias/${state.barbeariaId}/agendamentos`));
    await set(novoRef, {
      clienteWhatsapp: whatsNorm,
      clienteNome: nome,
      profissionalId: profId,
      profissionalNome: state.profissionais[profId].nome,
      servicos,
      dataChave: dataStr,
      horario,
      duracaoMin,
      valorTotal,
      status: 'confirmado',
      criadoEm: new Date().toISOString(),
      origem: 'dono'
    });

    toast('Agendamento criado', 'sucesso');
    fecharModal();
  } catch (err) {
    console.error('Erro ao criar agendamento:', err);
    toast('Erro ao criar agendamento', 'erro');
    btn.disabled = false;
    btn.textContent = 'Criar agendamento';
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

  // Marca lembrete como enviado se ainda não tiver sido (e se vier do modal de detalhes)
  if (a.id && !a.lembreteEnviado) {
    marcarLembreteEnviado(a.id);
  }
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
        <div class="item-card-emoji">${escapeHtml(s.emoji || '✂️')}</div>
        <div style="flex:1;">
          <div class="item-card-titulo">${escapeHtml(s.nome)}</div>
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
      <input type="text" id="serv-nome" class="input" value="${escapeHtml(s.nome)}" placeholder="Ex: Corte Masculino">
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
      <input type="text" id="serv-emoji" class="input" value="${escapeHtml(s.emoji || '✂️')}" maxlength="2">
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
          <div class="item-card-emoji" style="background:linear-gradient(135deg,var(--accent),var(--accent-dark));color:#0a0a0a;font-family:'Bricolage Grotesque';font-weight:700;">${escapeHtml(iniciais(p.nome))}</div>
          <div style="flex:1;">
            <div class="item-card-titulo">${escapeHtml(p.nome)}</div>
            <div class="item-card-sub">${escapeHtml(p.especialidade || 'Profissional')}</div>
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
      <input type="text" id="prof-nome" class="input" value="${escapeHtml(p.nome)}" placeholder="Nome completo">
    </div>
    <div class="form-grid">
      <div class="input-grupo">
        <label class="input-label">ESPECIALIDADE</label>
        <input type="text" id="prof-especialidade" class="input" value="${escapeHtml(p.especialidade || '')}" placeholder="Ex: Clássico, Moderno">
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
    $$('#modal-body .horario-linha').forEach(linha => {
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
          <div class="item-card-emoji" style="background:var(--accent);color:#0a0a0a;font-family:'Bricolage Grotesque';font-weight:700;">${escapeHtml(iniciais(c.nome))}</div>
          <div style="flex:1;">
            <div class="item-card-titulo">${escapeHtml(c.nome)}</div>
            <div class="item-card-sub">${escapeHtml(formatarWhatsapp(c.whatsapp))}</div>
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
          <button class="btn-mini" onclick="window.open('https://wa.me/${escapeHtml(c.whatsapp)}', '_blank')">💬 Conversar</button>
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

  // Status das notificações push (verifica se há pelo menos 1 dispositivo ativado)
  const totalDispositivos = state.barbearia.fcmTokens ? Object.keys(state.barbearia.fcmTokens).length : 0;
  atualizarStatusNotificacoes(totalDispositivos > 0, totalDispositivos);

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
  $('#btn-novo-agendamento').addEventListener('click', () => modalNovoAgendamento());

  // Serviços
  $('#btn-novo-servico').addEventListener('click', () => modalServico());

  // Profissionais
  $('#btn-novo-profissional').addEventListener('click', () => modalProfissional());

  // Clientes
  $('#busca-cliente').addEventListener('input', renderizarClientes);

  // Configurações
  $('#form-config').addEventListener('submit', salvarConfiguracoes);
  $('#btn-baixar-qr').addEventListener('click', baixarQR);
  const btnNotif = $('#btn-ativar-notificacoes');
  if (btnNotif) btnNotif.addEventListener('click', ativarNotificacoes);
}

// ========================================
// START
// ========================================
inicializarAuth();
