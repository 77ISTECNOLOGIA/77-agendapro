// ========================================
// 77 AGENDAPRO — Painel Admin
// ========================================

import { db } from './firebase-config.js';
import { toast } from './toast.js';
import { ligarBuscaCep, UFS } from './cep.js';
import { urlMapa, consultaMapa, pausaDoDia, validarPausaDia } from './utils.js';
import { escapeHtml, adicionarMostrarSenha, profissionalRealizaServico, calcularVinculosProfissional, atendimentosParaResolver, periodoPronto, resumoPeriodo, fotoServicoValida } from './utils.js';
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
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  writeBatch,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const auth = getAuth(getApp());

// O pacote de notificações push é grande e só serve quando o aparelho vai (ou já está) recebendo
// avisos: é baixado sob demanda, e não a cada abertura do painel.
const carregarMessaging = () => import("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js");

// QR Code (Configurações): biblioteca de terceiros baixada só quando a aba é aberta.
let promessaQR = null;
function carregarQRCode() {
  if (typeof QRCode !== 'undefined') return Promise.resolve();
  if (!promessaQR) {
    promessaQR = new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
      s.onload = ok;
      s.onerror = () => { promessaQR = null; erro(new Error('QR Code indisponível')); };
      document.head.appendChild(s);
    });
  }
  return promessaQR;
}

// Último negócio deste usuário, guardado neste aparelho. É só um PALPITE para começar a baixar os dados
// em paralelo com a confirmação do vínculo; quem manda é o banco (as regras do Firestore negam o que não for dele).
function lerVinculoGuardado(uid) {
  try {
    const v = localStorage.getItem('ap_vinculo_' + uid);
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v || '') ? v : null;
  } catch (_) { return null; }
}
function guardarVinculo(uid, barbeariaId) {
  try {
    if (barbeariaId) localStorage.setItem('ap_vinculo_' + uid, barbeariaId);
    else localStorage.removeItem('ap_vinculo_' + uid);
  } catch (_) { /* sem armazenamento: só perde a otimização */ }
}

// Chave gerada no Firebase Console > Configurações > Cloud Messaging > Certificados push da Web
const VAPID_KEY = 'BBDdf4Estwxij9B1m3R7jZCrNNMul4EcIjAYJ9-Xw-8mgebCIgGwCUfPdYBko7scsVQ6VxMefFBYORQv9mzLYl4';

// ========================================
// ESTADO GLOBAL
// ========================================
const state = {
  user: null,
  barbeariaId: null,
  barbearia: null,
  negocioExiste: false,
  appPronto: false,        // true depois de mostrarApp(): antes disso os acompanhamentos em tempo real não redesenham nada
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
// Array de verdade (e não NodeList): NodeList não tem .map/.filter/.reduce e quebrava em silêncio
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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

// ========================================
// AUTENTICAÇÃO
// ========================================
function inicializarAuth() {
  adicionarMostrarSenha($('#login-senha'));
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.user = user;
      try {
        // O banco fica nos EUA: cada ida e volta custa ~150–250 ms, então o que vai em fila custa caro.
        // Com o palpite da última visita, os dados já começam a chegar EM PARALELO com a confirmação do vínculo;
        // sem palpite (1ª vez neste aparelho), começam logo depois dela. Os dados são baixados UMA vez só
        // (antes eram baixados por inteiro e, em seguida, de novo pelos acompanhamentos em tempo real).
        const palpite = lerVinculoGuardado(user.uid);
        let prontos = null;
        if (palpite) {
          state.barbeariaId = palpite;
          prontos = ativarListenersTempoReal();
          prontos.catch(() => {});                 // palpite errado: tratado logo abaixo
        }
        const snap = await getDoc(doc(db, 'usuarios', user.uid));
        if (!snap.exists()) {
          desativarListeners();
          guardarVinculo(user.uid, null);
          await signOut(auth);
          mostrarLogin('Usuário sem barbearia vinculada. Contate o suporte.');
          return;
        }
        const userData = snap.data();
        state.dadosCarregados = false;
        if (userData.barbeariaId !== palpite) {      // 1ª visita neste aparelho, ou o vínculo mudou
          state.barbeariaId = userData.barbeariaId;
          prontos = ativarListenersTempoReal();
        }
        guardarVinculo(user.uid, userData.barbeariaId);
        await prontos;                               // 1º retrato de negócio, serviços, profissionais, agendamentos e clientes
        if (!state.negocioExiste) throw new Error('Barbearia não encontrada');
        aplicarTema(state.barbearia.tipoNegocio);
        $('#sidebar-barbearia').textContent = state.barbearia.nome || '—';
        renderizarUserInfo(userData);
        mostrarApp();
        avisarSituacaoConta();
        await renderizarTudo();
        state.dadosCarregados = true;
        tratarLinkDeNotificacao();                   // aberto pelo toque numa notificação: já mostra o agendamento
        // O que não é preciso para ver a tela fica para depois que ela já apareceu
        setTimeout(() => {
          renovarHorariosFixos();                    // reforço da rotina diária (no máximo 1x a cada 4 h por aparelho)
          ouvirNotificacoesEmPrimeiroPlano();
          atualizarServiceWorker();
        }, 1500);
      } catch (err) {
        desativarListeners();
        console.error('Erro ao carregar usuário:', err);
        mostrarLogin('Erro ao carregar dados. Tente novamente.');
      }
    } else {
      state.dadosCarregados = false;
      state.appPronto = false;
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
    toast('No iPhone as notificações só funcionam pelo ÍCONE do app: toque em Compartilhar → "Adicionar à Tela de Início", abra o AgendaPro pelo ícone, entre e ative por lá.', 'erro');
    return;
  }

  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    toast(ehIOS ? 'Este iPhone não suporta notificações de app. É preciso o iOS 16.4 ou mais novo.' : 'Seu navegador não suporta notificações push', 'erro');
    return;
  }

  if (Notification.permission === 'denied') {
    toast(ehIOS
      ? 'As notificações estão bloqueadas. Abra Ajustes do iPhone → Notificações → AgendaPro e permita.'
      : 'As notificações estão bloqueadas para este site. Clique no cadeado ao lado do endereço e permita "Notificações".', 'erro');
    return;
  }

  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      toast('Você não permitiu as notificações. Toque de novo e escolha "Permitir".', 'erro');
      return;
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;            // o iPhone precisa do worker ATIVO antes de gerar o token
    registration.update().catch(() => {});
    const { getMessaging, getToken } = await carregarMessaging();
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
    // (não o token em si, que pode rotacionar e criar entradas duplicadas pro mesmo dispositivo).
    // Tokens ficam numa sub-coleção privada (antes ficavam no documento do negócio, legível por todos).
    const deviceId = obterDeviceId();
    const dispositivosRef = collection(db, 'barbearias', state.barbeariaId, 'dispositivos');
    await setDoc(doc(dispositivosRef, deviceId), { token, atualizadoEm: new Date().toISOString(), aparelho: descreverAparelho() });

    toast('Notificações ativadas neste aparelho! 🔔', 'sucesso');
    await carregarStatusNotificacoes();
    ouvirNotificacoesEmPrimeiroPlano();
  } catch (err) {
    console.error('Erro ao ativar notificações:', err);
    toast('Não foi possível ativar as notificações (' + (err.code || err.name || 'erro') + '). Tente de novo.', 'erro');
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

// "iPhone · Safari", "Windows · Chrome"... — só pra o dono reconhecer cada aparelho na lista.
function descreverAparelho() {
  const ua = navigator.userAgent;
  const aparelho = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  const navegador = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox/.test(ua) ? 'Firefox'
    : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'navegador';
  const app = (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) ? ' (app)' : '';
  return aparelho + ' · ' + navegador + app;
}

// Lê os aparelhos registrados e atualiza o texto/botões da tela de Configurações.
async function carregarStatusNotificacoes() {
  try {
    const snap = await getDocs(collection(db, 'barbearias', state.barbeariaId, 'dispositivos'));
    atualizarStatusNotificacoes(snap.size > 0, snap.size, snap.docs.map((d) => d.data().aparelho || 'Aparelho'));
  } catch (err) {
    console.error('Erro ao ler aparelhos de notificação:', err);
    atualizarStatusNotificacoes(false, 0);
  }
}

function atualizarStatusNotificacoes(ativo, totalDispositivos = 0, nomes = []) {
  const btn = $('#btn-ativar-notificacoes');
  const status = $('#status-notificacoes');
  const btnTeste = $('#btn-testar-notificacao');
  if (!btn) return;

  if (ativo) {
    btn.textContent = '🔔 Ativar neste dispositivo também';
    btn.disabled = false;
    if (status) {
      status.textContent = totalDispositivos + ' aparelho' + (totalDispositivos !== 1 ? 's' : '') + ' recebendo notificações' + (nomes.length ? ': ' + nomes.join(', ') : '');
      status.classList.remove('hidden');
    }
    if (btnTeste) btnTeste.classList.remove('hidden');
  } else {
    btn.textContent = '🔔 Ativar notificações push';
    btn.disabled = false;
    if (status) status.classList.add('hidden');
    if (btnTeste) btnTeste.classList.add('hidden');
  }
}

// Manda uma notificação de teste pra TODOS os aparelhos registrados e mostra o resultado.
async function enviarTesteNotificacao() {
  const btn = $('#btn-testar-notificacao');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    const resp = await fetch('/api/testar-notificacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: await auth.currentUser.getIdToken() })
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.erro || 'Não foi possível enviar o teste');

    if (dados.total === 0) {
      toast('Nenhum aparelho registrado ainda. Ative as notificações primeiro.', 'erro');
    } else if (dados.enviadas === dados.total) {
      toast('Teste enviado para ' + dados.enviadas + ' aparelho' + (dados.enviadas !== 1 ? 's' : '') + '! Confira se chegou.', 'sucesso');
    } else {
      toast('Enviado para ' + dados.enviadas + ' de ' + dados.total + ' aparelhos.' + (dados.removidos ? ' Aparelho(s) antigo(s) foram removidos — ative de novo neles.' : ''), 'erro');
    }
    if (dados.removidos) await carregarStatusNotificacoes();
  } catch (err) {
    toast(err.message || 'Erro ao enviar o teste', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// Toque numa notificação de novo agendamento: vai pra Agenda no dia certo e abre os detalhes.
// Dois caminhos: (1) painel FECHADO → o navegador abre /admin?agendamento=ID (lido ao entrar);
// (2) painel JÁ ABERTO → o service worker avisa a página por mensagem ("notification-clicked").
// Com o painel FECHADO, o toque chega por DOIS caminhos quase juntos: a URL ?agendamento=ID (lida quando
// o painel termina de carregar) e a mensagem "notification-clicked" do service worker (que pode chegar
// ANTES de os dados carregarem). Os dois pedem a mesma coisa, então: esperam o painel carregar, não
// se repetem, e só avisam "não encontrei" depois de procurar de verdade (inclusive direto no banco,
// caso a lista em tempo real ainda não tenha o agendamento recém-criado).
async function abrirAgendamentoDaNotificacao(id) {
  if (!state.dadosCarregados) { state.notificacaoPendenteId = id; return; }   // ainda carregando: guarda e atende ao terminar

  const agora = Date.now();
  const ultima = state.ultimaNotificacao;
  if (ultima && ultima.id === id && agora - ultima.em < 8000) return;         // o mesmo toque chegando pelos dois caminhos
  state.ultimaNotificacao = { id, em: agora };

  let a = state.agendamentos[id];
  if (!a) {
    try {
      const snap = await getDoc(doc(db, 'barbearias', state.barbeariaId, 'agendamentos', id));
      if (snap.exists()) { a = snap.data(); state.agendamentos[id] = a; }
    } catch (err) { console.error('Erro ao buscar o agendamento da notificação:', err); }
  }
  if (!a) { toast('Não encontrei esse agendamento (pode ter sido excluído).', 'erro'); return; }

  state.agendaDataAtual = chaveParaData(a.dataChave);
  state.filtroProfissional = 'todos';
  state.filtroStatus = 'todos';
  irPara('agenda');
  abrirDetalhesAgendamento(id);
}

// Chamado quando o painel termina de carregar: atende ao ?agendamento=ID da URL e a qualquer toque
// que chegou por mensagem enquanto carregava.
function tratarLinkDeNotificacao() {
  const id = new URLSearchParams(window.location.search).get('agendamento');
  if (id) {
    window.history.replaceState(null, '', window.location.pathname);   // limpa o ?agendamento= da barra
    abrirAgendamentoDaNotificacao(id);
  }
  const pendente = state.notificacaoPendenteId;
  state.notificacaoPendenteId = null;
  if (pendente) abrirAgendamentoDaNotificacao(pendente);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.messageType === 'notification-clicked' && m.data && m.data.agendamentoId) {
      abrirAgendamentoDaNotificacao(m.data.agendamentoId);
    }
  });
}

// Pede ao navegador pra buscar a versão mais nova do service worker de notificações.
function atualizarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')
    .then((r) => r && r.update())
    .catch(() => {});
}

// Escuta notificações chegando ENQUANTO o painel está aberto e em primeiro plano.
// Sem isso, o navegador recebe a notificação silenciosamente e não mostra nada na tela
// quando a aba do admin já está ativa (só mostra automaticamente em segundo plano).
let listenerForegroundAtivo = false;
async function ouvirNotificacoesEmPrimeiroPlano() {
  if (listenerForegroundAtivo) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const { getMessaging, onMessage } = await carregarMessaging();
    if (listenerForegroundAtivo) return;
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

// Confirmação com a janela do próprio painel (a do navegador deixava o botão "Sair" marcado depois de cancelar)
function handleLogout() {
  const botao = $('#btn-logout');
  if (botao) botao.blur();
  abrirModal('Sair do painel', '<p style="color:var(--text-dim);line-height:1.5;margin:0;">Deseja realmente sair? Você vai precisar entrar de novo com e-mail e senha.</p>', `<button class="btn-acao-secundario" id="modal-cancel">Cancelar</button><button class="btn-acao-perigo" id="modal-confirmar-sair">Sair</button>`);
  $('#modal-cancel').addEventListener('click', fecharModal);
  $('#modal-confirmar-sair').addEventListener('click', async () => {
    fecharModal();
    await signOut(auth);
  });
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
  state.appPronto = true;
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

// ========================================
// SITUAÇÃO DA CONTA (trial / suspensão)
// ========================================
// O link público funciona desde o cadastro (trial de 30 dias já em andamento).
// Aqui o dono só é avisado quando o trial está acabando/acabou ou a conta foi
// suspensa — a regra de quando o link público para de aceitar agendamentos
// vive no servidor (api/_lib/negocio.js).
function avisarSituacaoConta() {
  let el = document.getElementById('aviso-situacao');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aviso-situacao';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:sticky;top:0;z-index:50;padding:10px 16px;font-size:14px;text-align:center;border-bottom:1px solid var(--border);';
    document.body.prepend(el);
  }

  const status = state.barbearia.status || 'trial';
  let texto = '';
  let cor = '';

  if (status === 'suspensa') {
    texto = '⛔ Sua conta está suspensa: o link público não aceita novos agendamentos. Fale com o suporte da 77 IS para reativar.';
    cor = 'background:#3a1414;color:#ffb4b4;';
  } else if (status === 'trial' && state.barbearia.trialFim) {
    const dias = Math.ceil((Date.parse(state.barbearia.trialFim) - Date.now()) / 86400000);
    if (dias <= 7 && dias >= 0) {
      texto = `🎁 Seu teste grátis termina em ${dias} dia${dias === 1 ? '' : 's'}. Fale com a 77 IS para continuar usando sem interrupção.`;
      cor = 'background:#0e2238;color:#00D2FF;';
    } else if (dias < 0) {
      texto = '⚠️ Seu teste grátis terminou. Fale com a 77 IS para ativar o plano — em poucos dias o link público deixa de aceitar agendamentos.';
      cor = 'background:#3a2410;color:#ffc58a;';
    }
  }

  el.textContent = texto;
  el.style.cssText = el.style.cssText.replace(/background:[^;]*;|color:[^;]*;/g, '') + cor;
  el.style.display = texto ? 'block' : 'none';
}

// ========================================
// LISTENERS EM TEMPO REAL
// ========================================
// Devolve uma promessa que se cumpre quando as CINCO fontes (negócio, serviços, profissionais, agendamentos
// e clientes) entregaram o 1º retrato — é a partir daí que a tela pode aparecer.
function ativarListenersTempoReal() {
  desativarListeners();
  const negocioRef = doc(db, 'barbearias', state.barbeariaId);
  state.negocioExiste = false;
  state.barbearia = null;

  const fontes = new Set(['negocio', 'servicos', 'profissionais', 'agendamentos', 'clientes']);
  const chegaram = new Set();
  let cumprir, falhar;
  const prontos = new Promise((ok, erro) => { cumprir = ok; falhar = erro; });
  const marcar = (nome) => { chegaram.add(nome); if (chegaram.size === fontes.size) cumprir(); };
  const comErro = (nome) => (err) => {
    console.error('Erro ao acompanhar ' + nome + ':', err);
    if (chegaram.size < fontes.size) falhar(err);       // falha na abertura: o chamador mostra a mensagem
  };
  const redesenhar = () => { if (state.appPronto) renderizarViewAtual(); };   // antes da tela aparecer não há o que desenhar

  state.listeners.push(onSnapshot(negocioRef, (snap) => {
    state.negocioExiste = snap.exists();
    state.barbearia = snap.data() || {};
    if (state.appPronto) {
      $('#sidebar-barbearia').textContent = state.barbearia.nome || '—';
      avisarSituacaoConta();
    }
    redesenhar();
    marcar('negocio');
  }, comErro('negocio')));

  ['servicos', 'profissionais', 'agendamentos', 'clientes'].forEach((chave) => {
    state.listeners.push(onSnapshot(collection(negocioRef, chave), (snap) => {
      const dados = {};
      snap.forEach(d => { dados[d.id] = d.data(); });
      if (chave === 'agendamentos') {
        Object.values(dados).forEach((a) => {
          if (a.status === 'aguardando_sinal' && a.sinalExpiraEm && Date.parse(a.sinalExpiraEm) <= Date.now()) { a.status = 'cancelado'; a._sinalExpirado = true; }
        });
      }
      state[chave] = dados;
      redesenhar();
      marcar(chave);
    }, comErro(chave)));
  });
  return prontos;
}

function desativarListeners() {
  state.listeners.forEach(unsub => unsub());
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
  renderizarPendencias();
  switch (state.viewAtual) {
    case 'dashboard': renderizarDashboard(); break;
    case 'agenda': renderizarAgenda(); break;
    case 'servicos': renderizarServicos(); break;
    case 'profissionais': renderizarProfissionais(); break;
    case 'relatorios': renderizarRelatorios(); break;
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
  // remarcados = agendamentos que ERAM de hoje e foram movidos para outro dia/horário (pelo dono ou pelo cliente).
  // Eles não estão mais em agsHoje (a data mudou), então vêm da data de origem guardada na remarcação.
  const remarcados = Object.values(state.agendamentos).filter(a => a.remarcadoDeDataChave === hojeChave && a.dataChave !== hojeChave && a.status !== 'cancelado');
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const faltas = cancelados.filter(a => a.motivoCancelamento === 'nao-compareceu').length;
  $('#kpi-agendamentos-extra').textContent =
    `${plural(concluidos.length, 'concluído', 'concluídos')} · ${plural(confirmados.length, 'pendente', 'pendentes')} · ` +
    `${plural(cancelados.length, 'cancelado', 'cancelados')}${faltas ? ` (${plural(faltas, 'falta', 'faltas')})` : ''} · ` +
    plural(remarcados.length, 'remarcado', 'remarcados');

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
        <span class="proximo-horario">⏰ ${escapeHtml(proximo.horario)}</span>
      </div>
    `;
  } else {
    $('#proximo-cliente').innerHTML = '<div class="vazio-msg">Nenhum cliente agendado a seguir</div>';
  }

  // Faturamento por serviço
  const fatPorServico = {};
  concluidos.forEach(a => {
    (a.servicos || []).forEach(s => {
      if (!fatPorServico[s.nome]) fatPorServico[s.nome] = { valor: 0, qtd: 0 };
      fatPorServico[s.nome].valor += s.preco || 0;
      fatPorServico[s.nome].qtd += 1;
    });
  });
  const fatArr = Object.entries(fatPorServico).map(([nome, d]) => [nome, d.valor, d.qtd]).sort((a, b) => b[1] - a[1]);
  if (fatArr.length === 0) {
    $('#fat-por-servico').innerHTML = '<div class="vazio-msg">Sem faturamento registrado hoje</div>';
  } else {
    const max = fatArr[0][1];
    $('#fat-por-servico').innerHTML = fatArr.map(([nome, valor, qtd]) => `
      <div class="fat-item">
        <div class="fat-info">
          <div class="fat-nome-row">
            <span class="fat-nome">${escapeHtml(nome)} <span class="fat-qtd" style="opacity:.7;font-weight:400">· ${qtd} ${qtd === 1 ? 'realizado' : 'realizados'}</span></span>
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
  container.style.cssText = 'margin: 12px 0; padding: 14px; background: rgba(0, 119, 255, 0.10); border: 1px solid rgba(0, 119, 255, 0.4); border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;';
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
        <div class="lembrete-item" data-id="${escapeHtml(a.id)}" style="background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; gap: 12px; align-items: center;">
          <div style="font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; color: var(--accent); min-width: 50px;">${escapeHtml(a.horario)}</div>
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
    await updateDoc(doc(db, 'barbearias', state.barbeariaId, 'agendamentos', agendamentoId), {
      lembreteEnviado: true,
      lembreteEnviadoEm: new Date().toISOString()
    });
  } catch (err) {
    console.error('Erro ao marcar lembrete:', err);
  }
}

const ROTULO_STATUS = { confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado', aguardando_sinal: 'Aguardando sinal', sinal_informado: 'Pagamento informado' };

function renderizarCardAgendamento(a) {
  const statusClass = a.status === 'concluido' ? 'concluido' : a.status === 'cancelado' ? 'cancelado' : '';
  const statusLabel = a._sinalExpirado ? 'Sinal expirado' : ROTULO_STATUS[a.status];
  const statusCor = { confirmado: 'confirmado', concluido: 'concluido', cancelado: 'cancelado', aguardando_sinal: 'aguardando_sinal', sinal_informado: 'sinal_informado' }[a.status];
  const lembreteBadge = (a.status === 'confirmado' && a.lembreteEnviado)
    ? '<span title="Lembrete enviado" style="color: var(--success); font-size: 11px; margin-right: 4px;">💬✓</span>'
    : '';
  const remarcadoBadge = (a.remarcadoEm && a.status !== 'cancelado')
    ? `<span title="Este agendamento foi remarcado" style="color: var(--accent); font-size: 11px; margin-left: 6px;">🔁 Remarcado${a.remarcadoDeDataChave ? ' (era ' + formatarDataCurta(a.remarcadoDeDataChave) + ' às ' + escapeHtml(a.remarcadoDeHorario || '') + ')' : ''}</span>`
    : '';
  return `
    <div class="agendamento-card ${statusClass}" data-id="${escapeHtml(a.id)}">
      <div class="agendamento-hora">${escapeHtml(a.horario)}</div>
      <div class="agendamento-info">
        <div class="agendamento-cliente">${lembreteBadge}${escapeHtml(a.clienteNome)}${remarcadoBadge}</div>
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
      <div class="det-linha"><span class="label">Horário</span><span class="valor">${escapeHtml(a.horario)} — ${minutosParaHora(fimMin)}</span></div>
      <div class="det-linha"><span class="label">Serviços</span><span class="valor">${(a.servicos || []).map(s => escapeHtml(s.nome)).join(' + ')}</span></div>
      <div class="det-linha"><span class="label">Total</span><span class="valor" style="color:var(--accent);font-family:'Bricolage Grotesque';font-weight:700;font-size:16px;">${formatarMoeda(a.valorTotal)}</span></div>
      <div class="det-linha"><span class="label">Status</span><span class="valor"><span class="agendamento-status status-${escapeHtml(a.status)}">${escapeHtml(a._sinalExpirado ? 'Sinal expirado' : (ROTULO_STATUS[a.status] || a.status))}</span></span></div>
      ${a.sinalValor ? `<div class="det-linha"><span class="label">Sinal</span><span class="valor">${formatarMoeda(a.sinalValor)} (${a.sinalPercentual || ''}%)${a.status === 'sinal_informado' && a.sinalInformadoEm ? ' — informado às ' + new Date(a.sinalInformadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}${a.status === 'aguardando_sinal' && a.sinalExpiraEm ? ' — pagar até ' + new Date(a.sinalExpiraEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span></div>` : ''}
      ${a.recorrenciaId ? `<div class="det-linha"><span class="label">Horário fixo</span><span class="valor">🔁 ${NOMES_DIA_FIXO[data.getDay()]} às ${escapeHtml(a.horario)}</span></div>` : ''}
      ${a.status === 'confirmado' ? `<div class="det-linha"><span class="label">Lembrete</span><span class="valor">${lembreteStr}</span></div>` : ''}
    </div>
    <div class="det-acoes">
      ${a.status === 'sinal_informado' ? `<button class="btn-concluir" id="acao-confirmar-sinal">✓ Confirmar pagamento do sinal</button><button class="btn-cancelar" id="acao-recusar-sinal">✕ Recusar (não recebi)</button>` : ''}
      ${a.status === 'confirmado' ? `<button class="btn-concluir" id="acao-concluir">✓ Marcar como concluído</button>` : ''}
      ${a.status === 'confirmado' ? `<button class="btn-remarcar" id="acao-remarcar">🔁 Remarcar</button>` : ''}
      ${a.status === 'confirmado' ? `<button class="btn-whatsapp" id="acao-whatsapp">💬 ${a.lembreteEnviado ? 'Reenviar' : 'Enviar'} lembrete no WhatsApp</button>` : ''}
      ${a.status !== 'cancelado' && a.status !== 'concluido' ? `<button class="btn-cancelar" id="acao-cancelar">✕ Cancelar agendamento</button>` : ''}
      ${a.recorrenciaId && a.status === 'confirmado' ? `<button class="btn-cancelar" id="acao-encerrar-fixo">🔁 Encerrar horário fixo a partir desta data</button>` : ''}
    </div>
  `;

  abrirModal('Detalhes do agendamento', corpo);

  if (a.status === 'sinal_informado') {
    $('#acao-confirmar-sinal').addEventListener('click', () => confirmarSinal(id));
    $('#acao-recusar-sinal').addEventListener('click', () => recusarSinal(id));
  }

  if (a.status === 'confirmado') {
    $('#acao-concluir').addEventListener('click', () => concluirAgendamento(id));
    $('#acao-remarcar').addEventListener('click', () => modalRemarcarAgendamento(id));
    $('#acao-whatsapp').addEventListener('click', () => enviarLembreteWhatsapp({ ...a, id }));
    $('#acao-cancelar').addEventListener('click', () => cancelarAgendamento(id));
    const btnFixo = $('#acao-encerrar-fixo');
    if (btnFixo) btnFixo.addEventListener('click', async () => {
      if (!confirm('Encerrar o horário fixo de ' + a.clienteNome + ' a partir de ' + formatarDataCurta(a.dataChave) + '? Este e os próximos agendamentos da série serão cancelados.')) return;
      btnFixo.disabled = true;
      try {
        const r = await chamarRecorrencia('encerrar', { serieId: a.recorrenciaId, aPartirDe: a.dataChave });
        toast('Horário fixo encerrado. ' + r.canceladas + ' agendamento' + (r.canceladas !== 1 ? 's' : '') + ' cancelado' + (r.canceladas !== 1 ? 's' : '') + '.', 'sucesso');
        fecharModal();
      } catch (err) { toast(err.message, 'erro'); btnFixo.disabled = false; }
    });
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
      <div class="det-linha"><span class="label">Atual</span><span class="valor">${formatarDataLonga(chaveParaData(a.dataChave))} — ${escapeHtml(a.horario)}</span></div>
    </div>
    <p class="det-ajuda" style="margin:0 0 12px;font-size:13px;opacity:.75">Escolha o novo dia e o horário. O cliente continua com o mesmo profissional e os mesmos serviços.</p>
    <div class="form-grid">
      <div class="input-grupo">
        <label class="input-label">NOVA DATA</label>
        <input type="date" id="rmc-data" class="input" min="${hojeStr}" value="${escapeHtml(a.dataChave)}">
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
      `<option value="${h}">${h}${h === a.horario && dataStr === a.dataChave ? ' (horário atual)' : ''}</option>`
    ).join('');
    selectHorario.disabled = false;
  }
  $('#rmc-data').addEventListener('change', atualizarHorariosRemarcar);
  atualizarHorariosRemarcar();

  $('#modal-salvar').addEventListener('click', async () => {
    const novaData = $('#rmc-data').value;
    const novoHorario = $('#rmc-horario').value;
    if (!novaData || !novoHorario) { toast('Selecione a nova data e o novo horário', 'erro'); return; }
    if (novaData === a.dataChave && novoHorario === a.horario) { toast('Escolha um dia ou horário diferente do atual', 'erro'); return; }

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

      await updateDoc(doc(db, 'barbearias', state.barbeariaId, 'agendamentos', id), {
        dataChave: novaData,
        horario: novoHorario,
        lembreteEnviado: false,
        remarcadoEm: new Date().toISOString(),
        remarcadoPor: 'dono',
        remarcadoDeDataChave: a.dataChave,
        remarcadoDeHorario: a.horario
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

// ========================================
// VIEW: RELATÓRIOS (análise por período)
// ========================================
function renderizarRelatorios() {
  const pre = $('#rel-preset'), de = $('#rel-de'), ate = $('#rel-ate');
  if (!pre.dataset.ligado) {
    pre.dataset.ligado = '1';
    const p = periodoPronto('mes');
    de.value = p.de; ate.value = p.ate;
    pre.addEventListener('change', () => {
      if (pre.value !== 'custom') { const x = periodoPronto(pre.value); de.value = x.de; ate.value = x.ate; }
      renderizarRelatorios();
    });
    [de, ate].forEach(i => i.addEventListener('change', () => { pre.value = 'custom'; renderizarRelatorios(); }));
  }
  if (!de.value || !ate.value || de.value > ate.value) return;
  const r = resumoPeriodo(state.agendamentos, de.value, ate.value);
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  $('#rel-sub').textContent = `${formatarDataCurta(de.value)}/${de.value.slice(0, 4)} a ${formatarDataCurta(ate.value)}/${ate.value.slice(0, 4)}`;
  $('#rel-faturamento').textContent = formatarMoeda(r.faturamento);
  $('#rel-ticket').textContent = `ticket médio ${formatarMoeda(r.ticket)}`;
  $('#rel-atendimentos').textContent = r.atendimentos;
  $('#rel-clientes').textContent = r.clientes;
  $('#rel-cancelados').textContent = r.cancelados;
  $('#rel-faltas').textContent = plural(r.faltas, 'não compareceu', 'não compareceram');
  const aviso = $('#rel-aviso');
  aviso.hidden = !r.pendentes;
  aviso.innerHTML = r.pendentes ? `<div class="pendencias-titulo">⚠️ ${plural(r.pendentes, 'agendamento ainda confirmado', 'agendamentos ainda confirmados')} neste período</div><div class="pendencias-sub">Não entram nos números acima até serem concluídos. Os que já passaram aparecem no Dashboard para resolver.</div>` : '';
  const barras = (lista, vazio, legenda) => {
    if (!lista.length) return `<div class="vazio-msg">${vazio}</div>`;
    const max = Math.max(...lista.map(x => x.valor), 1);
    return lista.map(x => `
      <div class="fat-item"><div class="fat-info">
        <div class="fat-nome-row">
          <span class="fat-nome">${escapeHtml(x.nome)} <span class="fat-qtd" style="opacity:.7;font-weight:400">· ${x.qtd} ${legenda(x.qtd)}</span></span>
          <span class="fat-valor">${formatarMoeda(x.valor)}</span>
        </div>
        <div class="fat-bar-bg"><div class="fat-bar" style="width: ${(x.valor / max) * 100}%"></div></div>
      </div></div>`).join('');
  };
  $('#rel-servicos').innerHTML = barras(r.servicos, 'Nenhum serviço concluído no período', n => n === 1 ? 'realizado' : 'realizados');
  $('#rel-profissionais').innerHTML = barras(r.profissionais, 'Nenhum atendimento concluído no período', n => n === 1 ? 'atendimento' : 'atendimentos');
}

// Aviso de atendimentos esquecidos (confirmados cujo horário de término + 30 min já passou)
const MARGEM_PENDENCIA_MIN = 30;
function renderizarPagamentos() {
  const box = $('#pagamentos-confirmar');
  if (!box) return 0;
  const lista = Object.entries(state.agendamentos).map(([id, a]) => ({ ...a, id })).filter(a => a.status === 'sinal_informado')
    .sort((x, y) => String(x.sinalInformadoEm || '').localeCompare(String(y.sinalInformadoEm || '')));
  if (!lista.length) { box.hidden = true; box.innerHTML = ''; return 0; }
  box.hidden = false;
  box.innerHTML = `
    <div class="pendencias-titulo">💰 ${lista.length} pagamento${lista.length !== 1 ? 's' : ''} de sinal para confirmar</div>
    <div class="pendencias-sub">O cliente avisou que pagou o Pix. Confira no seu banco e confirme; sem a sua confirmação o agendamento fica pendente.</div>
    ${lista.map(a => `
      <div class="pendencia-item">
        <div class="pendencia-info">
          <div class="pendencia-quando">${escapeHtml(a.clienteNome)} · ${formatarMoeda(a.sinalValor)}</div>
          <div class="pendencia-det">${formatarDataCurta(a.dataChave)} às ${escapeHtml(a.horario)} · ${(a.servicos || []).map(x => escapeHtml(x.nome)).join(' + ')}${a.sinalInformadoEm ? ' · informou às ' + new Date(a.sinalInformadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
        </div>
        <div class="pendencia-acoes">
          <button class="pag-confirmar pend-concluir" data-id="${escapeHtml(a.id)}">✓ Confirmar</button>
          <button class="pag-recusar" data-id="${escapeHtml(a.id)}">✕ Recusar</button>
        </div>
      </div>`).join('')}`;
  $$('#pagamentos-confirmar .pag-confirmar').forEach(b => b.addEventListener('click', () => confirmarSinal(b.dataset.id)));
  $$('#pagamentos-confirmar .pag-recusar').forEach(b => b.addEventListener('click', () => recusarSinal(b.dataset.id)));
  return lista.length;
}

function renderizarPendencias() {
  const lista = atendimentosParaResolver(state.agendamentos, new Date(), MARGEM_PENDENCIA_MIN);
  const totalPagamentos = renderizarPagamentos();
  const totalSelo = lista.length + totalPagamentos;
  const navDash = document.querySelector('.nav-item[data-view="dashboard"]');
  if (navDash) {
    let selo = navDash.querySelector('.nav-selo');
    if (totalSelo && !selo) { selo = document.createElement('span'); selo.className = 'nav-selo'; navDash.appendChild(selo); }
    if (selo) { if (totalSelo) selo.textContent = totalSelo; else selo.parentNode.removeChild(selo); }
  }
  const box = $('#pendencias-resolver');
  if (!box) return;
  if (!lista.length) { box.hidden = true; box.innerHTML = ''; return; }
  const hojeChave = dataParaChave(new Date());
  box.hidden = false;
  box.innerHTML = `
    <div class="pendencias-titulo">⚠️ ${lista.length} atendimento${lista.length !== 1 ? 's' : ''} para resolver</div>
    <div class="pendencias-sub">O horário já passou e ainda estão como "confirmado". Só os concluídos entram no faturamento.</div>
    ${lista.map(a => `
      <div class="pendencia-item">
        <div class="pendencia-info">
          <div class="pendencia-quando">${a.dataChave === hojeChave ? 'Hoje' : formatarDataCurta(a.dataChave)} às ${escapeHtml(a.horario)} · ${escapeHtml(a.clienteNome)}</div>
          <div class="pendencia-det">${(a.servicos || []).map(x => escapeHtml(x.nome)).join(' + ')} · ${formatarMoeda(a.valorTotal)} · ${escapeHtml(a.profissionalNome || '')}</div>
        </div>
        <div class="pendencia-acoes">
          <button class="pend-concluir" data-id="${escapeHtml(a.id)}">✓ Concluir</button>
          <button class="pend-faltou" data-id="${escapeHtml(a.id)}">✕ Faltou</button>
        </div>
      </div>`).join('')}`;
  $$('#pendencias-resolver .pend-concluir').forEach(b => b.addEventListener('click', () => concluirAgendamento(b.dataset.id)));
  $$('#pendencias-resolver .pend-faltou').forEach(b => b.addEventListener('click', () => cancelarAgendamento(b.dataset.id, 'nao-compareceu')));
}
// o tempo passa mesmo sem nenhuma alteração no banco: reavalia a cada minuto
setInterval(() => { if (state.dadosCarregados) renderizarPendencias(); }, 60000);

async function confirmarSinal(id) {
  try {
    await updateDoc(doc(db, 'barbearias', state.barbeariaId, 'agendamentos', id), { status: 'confirmado', sinalConfirmadoEm: new Date().toISOString() });
    fecharModal();
    toast('Sinal confirmado! Agendamento confirmado. ✓', 'sucesso');
  } catch (err) {
    toast('Erro ao confirmar o pagamento', 'erro');
  }
}

async function recusarSinal(id) {
  if (!confirm('Recusar este pagamento? O agendamento será cancelado e o horário volta a ficar livre.')) return;
  try {
    await updateDoc(doc(db, 'barbearias', state.barbeariaId, 'agendamentos', id), { status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: 'sinal-recusado' });
    fecharModal();
    toast('Pagamento recusado. Horário liberado.', 'sucesso');
  } catch (err) {
    toast('Erro ao recusar o pagamento', 'erro');
  }
}

async function concluirAgendamento(id) {
  try {
    await updateDoc(doc(db, 'barbearias', state.barbeariaId, 'agendamentos', id), {
      status: 'concluido',
      concluidoEm: new Date().toISOString()
    });
    fecharModal();
    toast('Agendamento concluído! 💰', 'sucesso');
  } catch (err) {
    toast('Erro ao concluir', 'erro');
  }
}

async function cancelarAgendamento(id, motivo = null) {
  if (!confirm(motivo === 'nao-compareceu' ? 'Marcar que o cliente não compareceu? O agendamento será cancelado e não entra no faturamento.' : 'Tem certeza que deseja cancelar este agendamento?')) return;
  try {
    await updateDoc(doc(db, 'barbearias', state.barbeariaId, 'agendamentos', id), {
      status: 'cancelado',
      canceladoEm: new Date().toISOString(),
      ...(motivo ? { motivoCancelamento: motivo } : {})
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
  // intervalo (almoço): o do profissional naquele dia ou, se não tiver, o do estabelecimento
  const pausa = pausaDoDia(prof.horarioTrabalho && prof.horarioTrabalho[diaSemana], state.barbearia.horarioFuncionamento && state.barbearia.horarioFuncionamento[diaSemana]);

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
    if (pausa && slotInicio < pausa.fim && slotFim > pausa.ini) continue;
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
      <small id="nag-prof-ajuda" class="campo-help"></small>
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
    <div class="input-grupo nag-fixo">
      <label class="nag-servico-item" style="cursor:pointer;">
        <input type="checkbox" id="nag-repetir">
        <span>🔁 <strong>Cliente fixo</strong> — repetir toda semana neste dia e horário</span>
      </label>
      <div id="nag-repetir-opcoes" hidden style="margin-top:12px;">
        <div class="campo-help" id="nag-repetir-resumo" style="margin-bottom:10px;"></div>
        <label class="nag-servico-item" style="cursor:pointer;">
          <input type="radio" name="nag-modo" value="mensal" checked>
          <span>Todo mês, <strong>automaticamente</strong>, até eu encerrar</span>
        </label>
        <label class="nag-servico-item" style="cursor:pointer;">
          <input type="radio" name="nag-modo" value="ate">
          <span>Só até a data:</span>
          <input type="date" id="nag-ate" class="input" style="max-width:170px;">
        </label>
        <button type="button" id="nag-ver-datas" class="btn-acao-secundario" style="margin-top:10px;">Ver as datas</button>
        <div id="nag-datas-previa" style="margin-top:10px;"></div>
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

  $$('#modal-body .nag-servico-check').forEach(chk => chk.addEventListener('change', () => {
    atualizarProfissionaisNovoAgendamento();   // só quem realiza TODOS os serviços marcados
    atualizarHorariosNovoAgendamento();
  }));
  $('#nag-profissional').addEventListener('change', atualizarHorariosNovoAgendamento);
  $('#nag-data').addEventListener('change', atualizarHorariosNovoAgendamento);

  $('#nag-repetir').addEventListener('change', (e) => {
    $('#nag-repetir-opcoes').hidden = !e.target.checked;
    $('#modal-salvar').textContent = e.target.checked ? 'Criar horário fixo' : 'Criar agendamento';
    if (e.target.checked) atualizarResumoHorarioFixo();
  });
  ['#nag-data', '#nag-horario'].forEach((sel) => $(sel).addEventListener('change', () => { if ($('#nag-repetir').checked) atualizarResumoHorarioFixo(); }));
  $('#nag-ver-datas').addEventListener('click', verDatasHorarioFixo);
  $('#modal-salvar').addEventListener('click', salvarNovoAgendamento);
}

// Profissionais ativos que realizam todos os serviços marcados no modal.
function profissionaisElegiveisNovoAgendamento() {
  const servicoIds = $$('#modal-body .nag-servico-check:checked').map(c => c.value);
  return Object.entries(state.profissionais)
    .filter(([, p]) => p.ativo !== false)
    .filter(([pid]) => servicoIds.every(sid => profissionalRealizaServico(state.servicos[sid], pid)));
}

function atualizarProfissionaisNovoAgendamento() {
  const select = $('#nag-profissional');
  const ajuda = $('#nag-prof-ajuda');
  const atual = select.value;
  const elegiveis = profissionaisElegiveisNovoAgendamento();

  select.innerHTML = '<option value="">Selecione...</option>' +
    elegiveis.map(([id, p]) => `<option value="${id}">${escapeHtml(p.nome)}</option>`).join('');
  if (elegiveis.some(([id]) => id === atual)) select.value = atual;

  const temServicoMarcado = $$('#modal-body .nag-servico-check:checked').length > 0;
  ajuda.textContent = temServicoMarcado && elegiveis.length === 0
    ? 'Nenhum profissional realiza todos esses serviços juntos. Crie agendamentos separados.'
    : '';
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
  if ($('#nag-repetir') && $('#nag-repetir').checked) {
    const f = lerFormularioNovoAgendamento();
    if (f.erro) { toast(f.erro, 'erro'); return; }
    await salvarHorarioFixo(f);
    return;
  }

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
  if (!servicoIds.every(sid => profissionalRealizaServico(state.servicos[sid], profId))) {
    toast('Esse profissional não realiza todos os serviços escolhidos', 'erro'); return;
  }
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

    const clienteRef = doc(db, 'barbearias', state.barbeariaId, 'clientes', whatsNorm);
    const clienteSnap = await getDoc(clienteRef);
    if (clienteSnap.exists()) {
      const atual = clienteSnap.data();
      await setDoc(clienteRef, {
        ...atual,
        nome,
        totalAgendamentos: (atual.totalAgendamentos || 0) + 1,
        ultimoAgendamento: new Date().toISOString()
      });
    } else {
      await setDoc(clienteRef, {
        nome,
        whatsapp: whatsNorm,
        primeiraVisita: new Date().toISOString(),
        ultimoAgendamento: new Date().toISOString(),
        totalAgendamentos: 1
      });
    }

    await addDoc(collection(db, 'barbearias', state.barbeariaId, 'agendamentos'), {
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


// ========================================
// CLIENTE FIXO (horário que se repete toda semana)
// ========================================
// Quem decide e grava tudo é o servidor (api/recorrencia.js): ele confere cada data contra
// conflitos e renova sozinho todo mês. Aqui só se monta a tela.
const NOMES_DIA_FIXO = ['Todo domingo', 'Toda segunda-feira', 'Toda terça-feira', 'Toda quarta-feira', 'Toda quinta-feira', 'Toda sexta-feira', 'Todo sábado'];

async function chamarRecorrencia(action, dados = {}) {
  const resp = await fetch('/api/recorrencia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: await auth.currentUser.getIdToken(), action, ...dados })
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(corpo.erro || 'Não foi possível concluir. Tente de novo.');
  return corpo;
}

function formatarDataCurta(chave) {
  const [, m, d] = chave.split('-');
  return d + '/' + m;
}

// Lê e valida o formulário de novo agendamento. Devolve { erro } ou os dados já normalizados.
function lerFormularioNovoAgendamento() {
  const nome = $('#nag-cliente-nome').value.trim();
  const whatsDigitos = $('#nag-cliente-whatsapp').value.replace(/\D/g, '');
  const servicoIds = $$('#modal-body .nag-servico-check:checked').map((c) => c.value);
  const profId = $('#nag-profissional').value;
  const dataStr = $('#nag-data').value;
  const horario = $('#nag-horario').value;

  if (!nome) return { erro: 'Digite o nome do cliente' };
  if (whatsDigitos.length !== 11 || whatsDigitos[2] !== '9') return { erro: 'Digite um WhatsApp válido com DDD' };
  if (servicoIds.length === 0) return { erro: 'Selecione ao menos um serviço' };
  if (!profId) return { erro: 'Selecione o profissional' };
  if (!servicoIds.every((sid) => profissionalRealizaServico(state.servicos[sid], profId))) return { erro: 'Esse profissional não realiza todos os serviços escolhidos' };
  if (!dataStr || !horario) return { erro: 'Selecione data e horário' };
  return { nome, whatsNorm: '55' + whatsDigitos, servicoIds, profId, dataStr, horario };
}

function dadosDoHorarioFixo(f) {
  const modo = ($('input[name="nag-modo"]:checked') || {}).value === 'ate' ? 'ate' : 'mensal';
  return {
    clienteNome: f.nome, clienteWhatsapp: f.whatsNorm, profissionalId: f.profId, servicosIds: f.servicoIds,
    dataInicio: f.dataStr, horario: f.horario, modo, ate: modo === 'ate' ? $('#nag-ate').value : null
  };
}

function atualizarResumoHorarioFixo() {
  const dataStr = $('#nag-data').value;
  const horario = $('#nag-horario').value;
  const alvo = $('#nag-repetir-resumo');
  if (!dataStr || !horario) { alvo.textContent = 'Escolha a data e o horário acima: eles viram o dia da semana e a hora fixos.'; return; }
  alvo.innerHTML = '<strong>' + NOMES_DIA_FIXO[chaveParaData(dataStr).getDay()] + ' às ' + escapeHtml(horario) + '</strong>, a partir de ' + formatarDataCurta(dataStr) + '.';
  $('#nag-datas-previa').innerHTML = '';
}

async function verDatasHorarioFixo() {
  const f = lerFormularioNovoAgendamento();
  if (f.erro) { toast(f.erro, 'erro'); return; }
  const modo = dadosDoHorarioFixo(f);
  if (modo.modo === 'ate' && !modo.ate) { toast('Escolha a data final', 'erro'); return; }

  const btn = $('#nag-ver-datas');
  btn.disabled = true;
  btn.textContent = 'Conferindo…';
  try {
    const r = await chamarRecorrencia('previa', modo);
    const linhas = r.datas.map((d) => d.ok
      ? '<div style="color:var(--success);">✓ ' + formatarDataCurta(d.dataChave) + (d.jaExiste ? ' (já existe)' : '') + '</div>'
      : '<div style="color:var(--warning);">⚠ ' + formatarDataCurta(d.dataChave) + ' — ' + escapeHtml(d.motivo) + ' (será pulada)</div>').join('');
    $('#nag-datas-previa').innerHTML =
      '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:13px;line-height:1.7;">' + (linhas || 'Nenhuma data neste período.') + '</div>' +
      '<div class="campo-help" style="margin-top:8px;">' + (r.renovaAutomatico
        ? 'Depois disso, o sistema agenda o mês seguinte sozinho (a partir do dia 20). Datas puladas são tentadas de novo se o horário vagar.'
        : 'O horário fixo termina na data escolhida.') + '</div>';
  } catch (err) {
    toast(err.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ver as datas';
  }
}

async function salvarHorarioFixo(f) {
  const btn = $('#modal-salvar');
  const dados = dadosDoHorarioFixo(f);
  if (dados.modo === 'ate' && !dados.ate) { toast('Escolha a data final', 'erro'); return; }

  btn.disabled = true;
  btn.textContent = 'Criando…';
  try {
    const r = await chamarRecorrencia('criar', dados);
    const puladas = r.puladas.length
      ? ' ' + r.puladas.length + ' data' + (r.puladas.length > 1 ? 's' : '') + ' sem vaga ' + (r.puladas.length > 1 ? 'foram puladas' : 'foi pulada') + ' (' + r.puladas.map((p) => formatarDataCurta(p.dataChave)).join(', ') + ').'
      : '';
    toast('🔁 Horário fixo criado: ' + r.criadas.length + ' agendamento' + (r.criadas.length > 1 ? 's' : '') + '.' + puladas, 'sucesso');
    fecharModal();
  } catch (err) {
    toast(err.message, 'erro');
    btn.disabled = false;
    btn.textContent = 'Criar agendamento';
  }
}

// Lista dos clientes fixos, com opção de encerrar cada um.
async function modalHorariosFixos() {
  abrirModal('🔁 Horários fixos', '<div class="vazio-msg">Carregando…</div>');
  try {
    const { series } = await chamarRecorrencia('listar');
    if (series.length === 0) {
      abrirModal('🔁 Horários fixos', '<div class="vazio-msg">Nenhum cliente fixo ainda.<br><small>Em "+ Novo agendamento", marque "Cliente fixo".</small></div>');
      return;
    }
    const corpo = series.map((s) => {
      const prof = state.profissionais[s.profissionalId];
      const quando = s.modo === 'ate' && s.ate ? 'até ' + formatarDataCurta(s.ate) : 'renova todo mês automaticamente';
      const avisos = (s.alerta ? '<div style="color:var(--danger);font-size:12px;margin-top:6px;">⚠ ' + escapeHtml(s.alerta) + '</div>' : '') +
        (s.puladas.length ? '<div style="color:var(--warning);font-size:12px;margin-top:6px;">⚠ Sem vaga em: ' + s.puladas.map((p) => formatarDataCurta(p.dataChave)).join(', ') + ' (tento de novo se vagar)</div>' : '');
      return '<div class="item-card" data-serie="' + escapeHtml(s.id) + '" style="margin-bottom:10px;">' +
        '<div class="item-card-header"><div style="flex:1;">' +
        '<div class="item-card-titulo">' + escapeHtml(s.clienteNome) + '</div>' +
        '<div class="item-card-sub">' + NOMES_DIA_FIXO[s.diaSemana] + ' às ' + escapeHtml(s.horario) + (prof ? ' • ' + escapeHtml(prof.nome.split(' ')[0]) : '') + '</div>' +
        '<div class="item-card-sub">' + escapeHtml((s.servicos || []).join(' + ')) + '</div>' +
        '<div class="item-card-sub">' + s.proximas + ' agendamento' + (s.proximas !== 1 ? 's' : '') + ' pela frente • ' + escapeHtml(quando) + '</div>' +
        avisos + '</div></div>' +
        '<div class="item-card-actions"><button class="btn-mini perigo" data-acao="encerrar-fixo">Encerrar horário fixo</button></div></div>';
    }).join('');
    abrirModal('🔁 Horários fixos', corpo);

    $$('#modal-body [data-acao="encerrar-fixo"]').forEach((btn) => btn.addEventListener('click', async () => {
      const id = btn.closest('[data-serie]').dataset.serie;
      const s = series.find((x) => x.id === id);
      if (!confirm('Encerrar o horário fixo de ' + s.clienteNome + '? Os ' + s.proximas + ' agendamento(s) que ainda não aconteceram serão cancelados.')) return;
      btn.disabled = true;
      try {
        const r = await chamarRecorrencia('encerrar', { serieId: id });
        toast('Horário fixo encerrado. ' + r.canceladas + ' agendamento' + (r.canceladas !== 1 ? 's' : '') + ' cancelado' + (r.canceladas !== 1 ? 's' : '') + '.', 'sucesso');
        modalHorariosFixos();
      } catch (err) { toast(err.message, 'erro'); btn.disabled = false; }
    }));
  } catch (err) {
    abrirModal('🔁 Horários fixos', '<div class="vazio-msg">' + escapeHtml(err.message) + '</div>');
  }
}

// Ao abrir o painel, renova os horários fixos (reforço da rotina diária; é idempotente).
async function renovarHorariosFixos() {
  try {
    if (Date.now() - Number(localStorage.getItem('ap_renovou_em') || 0) < 4 * 3600 * 1000) return;
  } catch (_) { /* sem armazenamento: renova sempre */ }
  try {
    const r = await chamarRecorrencia('renovar');
    try { localStorage.setItem('ap_renovou_em', String(Date.now())); } catch (_) { /* ok */ }
    if (r.criadas > 0) toast('🔁 Horários fixos renovados: ' + r.criadas + ' novo' + (r.criadas > 1 ? 's' : '') + ' agendamento' + (r.criadas > 1 ? 's' : ''), 'sucesso');
    else if (r.erros > 0) toast('⚠ Um horário fixo precisa de atenção. Veja em "Horários fixos".', 'erro');
  } catch (err) { console.error('Renovação dos horários fixos:', err.message); }
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
  const url = `https://wa.me/${encodeURIComponent(a.clienteWhatsapp)}?text=${msg}`;
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
        ${fotoServicoValida(s.foto)
          ? `<div class="item-card-emoji"><img src="${s.foto}" alt="" class="item-card-foto"></div>`
          : ''}
        <div style="flex:1;">
          <div class="item-card-titulo">${escapeHtml(s.nome)}</div>
          <div class="item-card-sub">${s.duracaoMin} min • ${formatarMoeda(s.preco)}</div>
          ${textoQuemRealiza(s)}
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

// Linha extra no card do serviço quando ele é restrito a certos profissionais.
function textoQuemRealiza(s) {
  const ids = Array.isArray(s.profissionaisIds) ? s.profissionaisIds : [];
  if (ids.length === 0) return '';
  const nomes = ids.map((pid) => state.profissionais[pid]).filter(Boolean).map((p) => String(p.nome || '').split(' ')[0]);
  const texto = nomes.length ? `Só com ${nomes.join(', ')}` : '⚠️ Nenhum profissional ativo realiza este serviço';
  return `<div class="item-card-sub" style="color:var(--accent);">${escapeHtml(texto)}</div>`;
}

// Prepara a foto no próprio navegador antes de guardar: recorte QUADRADO centralizado, 400x400,
// JPEG, reduzindo a qualidade até caber no limite. Assim a foto fica leve (dezenas de KB) e dá
// pra guardá-la junto do serviço no banco, sem serviço de armazenamento pago.
async function prepararFotoServico(arquivo) {
  if (!arquivo || !String(arquivo.type).startsWith('image/')) throw new Error('Escolha um arquivo de imagem (foto).');
  if (arquivo.size > 15 * 1024 * 1024) throw new Error('A foto é grande demais (máximo 15 MB).');

  const urlTemp = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, falha) => {
      const el = new Image();
      el.onload = () => ok(el);
      el.onerror = () => falha(new Error('Não consegui abrir essa imagem. Tente outra foto.'));
      el.src = urlTemp;
    });

    const lado = 400;
    const menor = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = lado;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';                 // fundo branco: PNG transparente não vira preto no JPEG
    ctx.fillRect(0, 0, lado, lado);
    ctx.drawImage(img, (img.naturalWidth - menor) / 2, (img.naturalHeight - menor) / 2, menor, menor, 0, 0, lado, lado);

    for (let qualidade = 0.78; qualidade >= 0.38; qualidade -= 0.08) {
      const dataUrl = canvas.toDataURL('image/jpeg', qualidade);
      if (dataUrl.length <= 70000 && fotoServicoValida(dataUrl)) return dataUrl;
    }
    throw new Error('Essa foto ficou pesada demais mesmo reduzida. Tente outra.');
  } finally {
    URL.revokeObjectURL(urlTemp);
  }
}

function modalServico(id = null) {
  const s = id ? state.servicos[id] : { nome: '', duracaoMin: 30, preco: 0, ativo: true, ordem: Object.keys(state.servicos).length + 1 };
  const profsAtivos = Object.entries(state.profissionais).filter(([, p]) => p.ativo !== false);
  const restritos = Array.isArray(s.profissionaisIds) ? s.profissionaisIds : [];
  const marcado = (pid) => restritos.length === 0 || restritos.includes(pid);
  const blocoProfissionais = profsAtivos.length === 0 ? '' : `
    <div class="input-grupo">
      <label class="input-label">QUEM REALIZA ESTE SERVIÇO?</label>
      <div class="nag-servicos-lista">
        ${profsAtivos.map(([pid, p]) => `
          <label class="nag-servico-item">
            <input type="checkbox" class="serv-prof-check" value="${escapeHtml(pid)}" ${marcado(pid) ? 'checked' : ''}>
            <span>${escapeHtml(p.nome)}</span>
          </label>`).join('')}
      </div>
      <small class="campo-help">Deixe todos marcados se qualquer profissional faz este serviço. Desmarque quem NÃO faz: o cliente só poderá agendar com quem estiver marcado.</small>
    </div>`;
  let fotoAtual = fotoServicoValida(s.foto) ? s.foto : '';
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
      <label class="input-label">FOTO DO SERVIÇO (OPCIONAL)</label>
      <div style="display:flex;gap:14px;align-items:center;">
        <div id="serv-foto-previa" class="foto-previa">${fotoAtual ? `<img src="${fotoAtual}" alt="">` : '<span>Sem foto</span>'}</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label class="btn-acao-secundario" style="cursor:pointer;text-align:center;">Escolher foto<input type="file" id="serv-foto-arquivo" accept="image/*" hidden></label>
          <button type="button" class="btn-acao-perigo" id="serv-foto-remover" ${fotoAtual ? '' : 'hidden'}>Remover foto</button>
        </div>
      </div>
      <small class="campo-help" id="serv-foto-ajuda">Mostre um trabalho bem feito! Sem foto, o cliente vê só o nome, o tempo e o valor. A foto é recortada em quadrado e reduzida automaticamente.</small>
    </div>
    <div class="input-grupo">
      <label style="display:flex;gap:10px;align-items:center;cursor:pointer;">
        <input type="checkbox" id="serv-ativo" ${s.ativo !== false ? 'checked' : ''}>
        <span>Serviço ativo (visível pros clientes)</span>
      </label>
    </div>
    ${blocoProfissionais}
  `;
  const rodape = `
    <button class="btn-acao-secundario" id="modal-cancel">Cancelar</button>
    <button class="btn-acao" id="modal-salvar">Salvar</button>
  `;
  abrirModal(titulo, corpo, rodape);

  // Foto: escolher (já recortada e reduzida) ou remover. Fica só na tela até clicar em Salvar.
  const atualizarPreviaFoto = () => {
    $('#serv-foto-previa').innerHTML = fotoAtual ? `<img src="${fotoAtual}" alt="">` : '<span>Sem foto</span>';
    $('#serv-foto-remover').hidden = !fotoAtual;
  };
  $('#serv-foto-arquivo').addEventListener('change', async (ev) => {
    const arquivo = ev.target.files && ev.target.files[0];
    ev.target.value = '';                           // permite escolher o mesmo arquivo de novo
    if (!arquivo) return;
    $('#serv-foto-ajuda').textContent = 'Preparando a foto…';
    try {
      fotoAtual = await prepararFotoServico(arquivo);
      atualizarPreviaFoto();
      $('#serv-foto-ajuda').textContent = 'Foto pronta! Clique em Salvar para guardar.';
    } catch (err) {
      toast(err.message || 'Não foi possível usar essa foto', 'erro');
      $('#serv-foto-ajuda').textContent = 'Mostre um trabalho bem feito! A foto aparece junto do serviço para o cliente. Ela é recortada em quadrado e reduzida automaticamente.';
    }
  });
  $('#serv-foto-remover').addEventListener('click', () => { fotoAtual = ''; atualizarPreviaFoto(); });

  $('#modal-cancel').addEventListener('click', fecharModal);
  $('#modal-salvar').addEventListener('click', async () => {
    const marcados = $$('#modal-body .serv-prof-check:checked').map((c) => c.value);
    const dados = {
      nome: $('#serv-nome').value.trim(),
      duracaoMin: Number($('#serv-duracao').value),
      preco: Number($('#serv-preco').value),
      foto: fotoAtual,                              // '' = sem foto (usa o ícone)
      ativo: $('#serv-ativo').checked,
      ordem: s.ordem,
      // Todos marcados (ou nenhum profissional cadastrado) = lista vazia = qualquer um faz.
      // Assim, um profissional novo já entra automaticamente nos serviços sem restrição.
      profissionaisIds: marcados.length === profsAtivos.length ? [] : marcados
    };
    if (!dados.nome) { toast('Digite o nome do serviço', 'erro'); return; }
    if (dados.duracaoMin < 5) { toast('Duração mínima de 5 minutos', 'erro'); return; }
    if (profsAtivos.length > 0 && marcados.length === 0) { toast('Marque ao menos um profissional que realiza este serviço', 'erro'); return; }

    try {
      if (id) {
        await updateDoc(doc(db, 'barbearias', state.barbeariaId, 'servicos', id), dados);
        toast('Serviço atualizado', 'sucesso');
      } else {
        await addDoc(collection(db, 'barbearias', state.barbeariaId, 'servicos'), dados);
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
    await deleteDoc(doc(db, 'barbearias', state.barbeariaId, 'servicos', id));
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
          <div class="item-card-emoji" style="background:linear-gradient(135deg,var(--accent),var(--accent-dark));color:#fff;font-family:'Bricolage Grotesque';font-weight:700;">${escapeHtml(iniciais(p.nome))}</div>
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

  // Serviços que este profissional realiza. Profissional novo já vem marcado nos
  // serviços sem restrição (que qualquer um faz); nos restritos a outros, não.
  const servicosLista = Object.entries(state.servicos).sort((a, b) => (a[1].ordem || 0) - (b[1].ordem || 0));
  const blocoServicos = servicosLista.length === 0 ? '' : `
    <div class="input-grupo">
      <label class="input-label">SERVIÇOS QUE REALIZA</label>
      <div class="nag-servicos-lista">
        ${servicosLista.map(([sid, s]) => `
          <label class="nag-servico-item">
            <input type="checkbox" class="prof-serv-check" value="${escapeHtml(sid)}" ${profissionalRealizaServico(s, id) || (!id && !(s.profissionaisIds && s.profissionaisIds.length)) ? 'checked' : ''}>
            <span>${escapeHtml(s.nome)}${s.ativo === false ? ' (inativo)' : ''}</span>
          </label>`).join('')}
      </div>
      <small class="campo-help">Marque o que este profissional faz. Os clientes só poderão agendar cada serviço com quem estiver marcado.${
        Object.entries(state.profissionais).some(([pid, pr]) => pr.ativo !== false && pid !== id)
          ? ''
          : ' <strong>Você é o único profissional ativo</strong>, então todos os serviços ficam com você — para tirar um serviço do ar, desative-o na aba Serviços.'
      }</small>
    </div>`;

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
    ${blocoServicos}
    <h4 style="margin:20px 0 6px;font-family:'Bricolage Grotesque';font-weight:700;font-size:14px;">Horário de trabalho</h4>
    <p class="campo-help" style="margin:0 0 12px;">Intervalo próprio (opcional): se ficar desmarcado, vale o intervalo do estabelecimento (em Configurações).</p>
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
            ${htmlPausa('ht', h)}
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
    let erroHorario = '';
    $$('#modal-body .horario-linha').forEach(linha => {
      const dia = linha.dataset.dia;
      const { dia: horario, erro } = lerLinhaHorario(linha, 'ht');
      horarioTrabalho[dia] = horario;
      if (erro && !erroHorario) erroHorario = labelsDias[dia] + ': ' + erro;
    });
    if (erroHorario) { toast(erroHorario, 'erro'); return; }

    const dados = {
      nome: $('#prof-nome').value.trim(),
      especialidade: $('#prof-especialidade').value.trim(),
      comissao: Number($('#prof-comissao').value),
      ativo: $('#prof-ativo').checked,
      horarioTrabalho
    };
    if (!dados.nome) { toast('Digite o nome', 'erro'); return; }

    // Profissional + vínculos com os serviços são gravados juntos (tudo ou nada).
    const profRef = id
      ? doc(db, 'barbearias', state.barbeariaId, 'profissionais', id)
      : doc(collection(db, 'barbearias', state.barbeariaId, 'profissionais'));
    const ativosDepois = Object.entries(state.profissionais)
      .filter(([pid, pr]) => pr.ativo !== false && pid !== profRef.id)
      .map(([pid]) => pid);
    if (dados.ativo) ativosDepois.push(profRef.id);

    const { alteracoes, erro } = calcularVinculosProfissional({
      servicos: state.servicos,
      profissionaisAtivosIds: ativosDepois,
      profissionalId: profRef.id,
      marcadosIds: $$('#modal-body .prof-serv-check:checked').map(c => c.value)
    });
    if (erro) { toast(erro, 'erro'); return; }

    try {
      const lote = writeBatch(db);
      if (id) lote.update(profRef, dados); else lote.set(profRef, dados);
      alteracoes.forEach(a => lote.update(
        doc(db, 'barbearias', state.barbeariaId, 'servicos', a.servicoId),
        { profissionaisIds: a.profissionaisIds }
      ));
      await lote.commit();
      toast(id ? 'Profissional atualizado' : 'Profissional criado', 'sucesso');
      fecharModal();
    } catch (err) {
      console.error('Erro ao salvar profissional:', err);
      toast(`Erro ao salvar profissional (${err.code || 'desconhecido'})`, 'erro');
    }
  });
}

async function deletarProfissional(id) {
  if (!confirm(`Excluir o profissional "${state.profissionais[id].nome}"?`)) return;
  try {
    await deleteDoc(doc(db, 'barbearias', state.barbeariaId, 'profissionais', id));
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
          <div class="item-card-emoji" style="background:var(--accent);color:#fff;font-family:'Bricolage Grotesque';font-weight:700;">${escapeHtml(iniciais(c.nome))}</div>
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
// ---- Intervalo (almoço) nos horários ----
function htmlPausa(prefixo, h) {
  const ativo = !!(h && h.pausaInicio && h.pausaFim);
  return `
    <div class="horario-pausa">
      <label class="pausa-check"><input type="checkbox" class="${prefixo}-pausa-ativo" ${ativo ? 'checked' : ''}> Intervalo (almoço)</label>
      <input type="time" class="horario-input ${prefixo}-pausa-inicio" value="${(h && h.pausaInicio) || '12:00'}">
      <span>às</span>
      <input type="time" class="horario-input ${prefixo}-pausa-fim" value="${(h && h.pausaFim) || '13:00'}">
      <button type="button" class="link-copiar" data-copiar="${prefixo}" title="Repete o horário e o intervalo desta linha nos outros dias">Copiar para todos os dias</button>
    </div>`;
}

// Copia o horário de trabalho e o intervalo de UMA linha para todas as outras (não mexe em quais dias estão abertos).
function copiarLinhaParaTodos(botao) {
  const linha = botao.closest('.horario-linha');
  const p = botao.dataset.copiar;
  if (!linha || !p) return;
  const campo = (l, nome) => l.querySelector('.' + p + '-' + nome);
  const modelo = {
    inicio: campo(linha, 'inicio').value, fim: campo(linha, 'fim').value,
    pausaAtiva: campo(linha, 'pausa-ativo').checked, pausaInicio: campo(linha, 'pausa-inicio').value, pausaFim: campo(linha, 'pausa-fim').value
  };
  Array.from(linha.parentElement.querySelectorAll('.horario-linha')).forEach((l) => {
    campo(l, 'inicio').value = modelo.inicio;
    campo(l, 'fim').value = modelo.fim;
    campo(l, 'pausa-ativo').checked = modelo.pausaAtiva;
    campo(l, 'pausa-inicio').value = modelo.pausaInicio;
    campo(l, 'pausa-fim').value = modelo.pausaFim;
  });
  toast('Horário e intervalo copiados para todos os dias. Confira e salve.', 'sucesso');
}

// Lê a linha de um dia (estabelecimento: prefixo 'hf'; profissional: 'ht'). Devolve { dia, erro }: o intervalo só é gravado se estiver marcado.
function lerLinhaHorario(linha, prefixo) {
  const dia = {
    ativo: linha.querySelector('.' + prefixo + '-ativo').checked,
    inicio: linha.querySelector('.' + prefixo + '-inicio').value,
    fim: linha.querySelector('.' + prefixo + '-fim').value
  };
  if (linha.querySelector('.' + prefixo + '-pausa-ativo').checked) {
    dia.pausaInicio = linha.querySelector('.' + prefixo + '-pausa-inicio').value;
    dia.pausaFim = linha.querySelector('.' + prefixo + '-pausa-fim').value;
  }
  return { dia, erro: validarPausaDia(dia) };
}

// ---- Endereço (Configurações) ----
const CAMPOS_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

function lerEnderecoForm() {
  const f = {};
  CAMPOS_ENDERECO.forEach((k) => { f[k] = ($('#conf-' + k).value || '').trim(); });
  return f;
}

function preencherEndereco() {
  const bloco = $('#bloco-endereco');
  if (!bloco || bloco.dataset.sujo === '1') return;          // não apaga o que a pessoa está digitando
  const e = state.barbearia.enderecoDetalhe || {};
  CAMPOS_ENDERECO.forEach((k) => { $('#conf-' + k).value = e[k] || ''; });
  $('#conf-link-mapa').value = state.barbearia.linkMapa || '';
  const teste = urlMapa(state.barbearia.linkMapa, consultaMapa(state.barbearia.enderecoDetalhe, state.barbearia.endereco));
  const aTeste = $('#conf-testar-mapa');
  if (aTeste) { aTeste.href = teste || '#'; aTeste.style.display = teste ? '' : 'none'; }
  $('#conf-endereco-atual').textContent = e.cep
    ? ''
    : (state.barbearia.endereco ? `Endereço cadastrado hoje: ${state.barbearia.endereco}. Preencha o CEP abaixo para completar (rua, número e CEP).` : 'Informe o endereço completo do seu estabelecimento.');
}

function enderecoMudou(f) {
  if (!CAMPOS_ENDERECO.some((k) => f[k])) return false;      // formulário vazio: não mexe no que já existe
  const atual = state.barbearia.enderecoDetalhe;
  if (!atual) return true;
  const mesmo = (k) => (k === 'cep' ? String(f[k]).replace(/\D/g, '') === String(atual[k] || '').replace(/\D/g, '') : String(f[k]).trim() === String(atual[k] || '').trim());
  return !CAMPOS_ENDERECO.every(mesmo);
}

// corpo: { endereco?, linkMapa? } — só o que mudou
async function salvarEnderecoApi(corpo) {
  const resp = await fetch('/api/configurar-negocio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: await auth.currentUser.getIdToken(), ...corpo })
  });
  const resposta = await resp.json().catch(() => ({}));
  if (!resp.ok) { const e = new Error(resposta.erro || 'Não foi possível salvar o endereço.'); e.mensagemUsuario = e.message; throw e; }
}

function renderizarConfiguracoes() {
  $('#conf-nome').value = state.barbearia.nome || '';
  preencherEndereco();
  $('#conf-telefone').value = state.barbearia.telefone || '';
  $('#conf-slug').value = state.barbeariaId;
  $('#link-publico').textContent = `${window.location.origin}/${state.barbeariaId}`;

  // Sinal por Pix e limite semanal
  preencherRegrasAgendamento();

  // Status das notificações push (verifica se há pelo menos 1 dispositivo ativado)
  carregarStatusNotificacoes();

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
        ${htmlPausa('hf', h)}
      </div>
    `;
  }).join('');

  // QR Code
  const linkPublico = `${window.location.origin}/${state.barbeariaId}`;
  const qrEl = $('#qr-code-container');
  qrEl.innerHTML = '';
  carregarQRCode().then(() => {
    qrEl.innerHTML = '';
    new QRCode(qrEl, {
      text: linkPublico,
      width: 180,
      height: 180,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }).catch(() => {
    qrEl.innerHTML = '<div style="color:#666;">QR Code não disponível</div>';
  });
}

function preencherRegrasAgendamento() {
  const sinal = state.barbearia.sinal || {};
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#card-regras-agendamento')) return;   // não apaga o que a pessoa está digitando
  $('#sinal-ativo').checked = sinal.ativo === true;
  $('#sinal-percentual').value = sinal.percentual || 50;
  $('#sinal-prazo-horas').value = sinal.prazoHoras || 24;
  $('#sinal-tipo-chave').value = sinal.tipoChave || '';
  $('#sinal-chave').value = sinal.chavePix || '';
  $('#sinal-nome-recebedor').value = sinal.nomeRecebedor || '';
  $('#sinal-cidade-recebedor').value = sinal.cidadeRecebedor || '';
  $('#sinal-banco').value = sinal.banco || '';
  $('#limite-semana').value = state.barbearia.limiteAgendamentosSemana || 0;
  $('#sinal-campos').style.opacity = $('#sinal-ativo').checked ? '1' : '0.55';
}

async function salvarRegrasAgendamento() {
  const btn = $('#btn-salvar-sinal');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    const resp = await fetch('/api/configurar-negocio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken: await auth.currentUser.getIdToken(),
        limiteAgendamentosSemana: Number($('#limite-semana').value || 0),
        sinal: {
          ativo: $('#sinal-ativo').checked,
          percentual: Number($('#sinal-percentual').value),
          prazoHoras: Number($('#sinal-prazo-horas').value),
          tipoChave: $('#sinal-tipo-chave').value,
          chavePix: $('#sinal-chave').value.trim(),
          nomeRecebedor: $('#sinal-nome-recebedor').value.trim(),
          cidadeRecebedor: $('#sinal-cidade-recebedor').value.trim(),
          banco: $('#sinal-banco').value.trim()
        }
      })
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(corpo.erro || 'Não foi possível salvar.');
    if (corpo.sinal) $('#sinal-banco').value = corpo.sinal.banco || '';   // mostra já como ficou ("Banco Inter")
    toast('Regras de agendamento salvas', 'sucesso');
  } catch (err) {
    toast(err.message, 'erro');
  }
  btn.disabled = false;
  btn.textContent = 'Salvar regras de agendamento';
}

async function salvarConfiguracoes(e) {
  e.preventDefault();
  const botao = $('#btn-salvar-config');
  const rotuloBotao = botao ? botao.textContent : '';
  if (botao) { botao.disabled = true; botao.textContent = 'Salvando...'; }
  const dados = {
    nome: $('#conf-nome').value.trim(),
    telefone: $('#conf-telefone').value.trim(),
    horarioFuncionamento: {}
  };
  const nomesDia = { domingo: 'Domingo', segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado' };
  let erroHorario = '';
  $$('#horarios-funcionamento .horario-linha').forEach(linha => {
    const dia = linha.dataset.dia;
    const { dia: horario, erro } = lerLinhaHorario(linha, 'hf');
    dados.horarioFuncionamento[dia] = horario;
    if (erro && !erroHorario) erroHorario = nomesDia[dia] + ': ' + erro;
  });

  try {
    if (erroHorario) { const e = new Error(erroHorario); e.mensagemUsuario = erroHorario; throw e; }
    // endereço passa pelo servidor (valida CEP, número, UF...); só chama se a pessoa mexeu nele
    const end = lerEnderecoForm();
    const link = ($('#conf-link-mapa').value || '').trim();
    const paraApi = {};
    if (enderecoMudou(end)) paraApi.endereco = end;
    if (link !== (state.barbearia.linkMapa || '')) paraApi.linkMapa = link;
    if (Object.keys(paraApi).length) {
      await salvarEnderecoApi(paraApi);
      const bloco = $('#bloco-endereco'); if (bloco) bloco.dataset.sujo = '';
    }
    await updateDoc(doc(db, 'barbearias', state.barbeariaId), dados);
    toast('Configurações salvas', 'sucesso');
  } catch (err) {
    toast(err.mensagemUsuario || 'Não foi possível salvar. Tente de novo.', 'erro');
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = rotuloBotao; }
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

// ESC fecha a janela aberta (editar profissional/serviço, novo agendamento, detalhes...) sem salvar.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-overlay').classList.contains('hidden')) fecharModal();
});

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
  $('#btn-salvar-sinal').addEventListener('click', salvarRegrasAgendamento);
  UFS.forEach((uf) => { const o = document.createElement('option'); o.value = uf; o.textContent = uf; $('#conf-uf').appendChild(o); });
  ligarBuscaCep({ cep: 'conf-cep', logradouro: 'conf-logradouro', numero: 'conf-numero', bairro: 'conf-bairro', cidade: 'conf-cidade', uf: 'conf-uf', aviso: 'conf-cep-aviso' });
  $('#bloco-endereco').addEventListener('input', () => { $('#bloco-endereco').dataset.sujo = '1'; });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.link-copiar');
    if (b) copiarLinhaParaTodos(b);
  });
  $('#sinal-ativo').addEventListener('change', () => { $('#sinal-campos').style.opacity = $('#sinal-ativo').checked ? '1' : '0.55'; });
  $('#btn-horarios-fixos').addEventListener('click', () => modalHorariosFixos());

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
  const btnTesteNotif = $('#btn-testar-notificacao');
  if (btnTesteNotif) btnTesteNotif.addEventListener('click', enviarTesteNotificacao);
}

// ========================================
// START
// ========================================
inicializarAuth();
