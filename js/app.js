// ========================================
// 77 AGENDAPRO — Área Pública do Cliente
// ========================================

import { db } from './firebase-config.js';
import { aplicarTema } from './vocabulario.js';
import { escapeHtml } from './utils.js';
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ========================================
// ESTADO GLOBAL
// ========================================
const state = {
  slug: null,
  barbearia: null,
  servicos: {},
  profissionais: {},
  agendamentos: {},

  cliente: { whatsapp: null, nome: null, novo: true },
  servicosSelecionados: [],
  profissionalId: null,
  dataSelecionada: null,
  horarioSelecionado: null,

  horariosCache: {},

  meusAgendamentos: [],
  remarcacao: { agendamentoId: null, profissionalId: null, duracaoMin: null, dataSelecionada: null, horarioSelecionado: null }
};

// ========================================
// UTILS
// ========================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatarMoeda(valor) {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

function normalizarWhatsapp(numero) {
  const digitos = numero.replace(/\D/g, '');
  if (digitos.length === 11) return '55' + digitos;
  if (digitos.length === 13 && digitos.startsWith('55')) return digitos;
  return digitos;
}

function formatarWhatsapp(numero) {
  const d = numero.replace(/\D/g, '');
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7,11)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7,11)}`;
}

function validarWhatsapp(numero) {
  const d = numero.replace(/\D/g, '');
  return d.length === 11 && d[2] === '9';
}

function diasDaSemana() {
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
}

function formatarData(date) {
  const dia = String(date.getDate()).padStart(2, '0');
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

function dataParaChave(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function minutosParaHora(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function horaParaMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
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

function mostrarTela(numero) {
  $$('.tela').forEach(t => t.classList.remove('ativa'));
  $(`#tela-${numero}`).classList.add('ativa');

  const labels = {
    1: 'Identificação',
    2: 'Passo 1 de 3',
    3: 'Passo 2 de 3',
    4: 'Passo 3 de 3',
    5: 'Concluído',
    6: 'Meus agendamentos'
  };
  $('#header-passo').textContent = labels[numero] || '';

  window.scrollTo(0, 0);
}

// ========================================
// INICIALIZAÇÃO
// ========================================
async function inicializar() {
  const params = new URLSearchParams(window.location.search);
  const slugQuery = params.get('b');
  const slugPath = window.location.pathname.split('/').filter(Boolean)[0];

  state.slug = slugQuery || slugPath || null;

  if (!state.slug) {
    mostrarErroBarbearia();
    return;
  }

  try {
    const carregada = await carregarBarbearia(state.slug);
    if (!carregada) {
      mostrarErroBarbearia();
      return;
    }

    aplicarTema(state.barbearia.tipoNegocio);
    renderizarHeader();
    inicializarEventos();
    mostrarApp();
  } catch (err) {
    console.error('Erro ao inicializar:', err);
    mostrarErroBarbearia();
  }
}

async function carregarBarbearia(slug) {
  // Lê info/servicos/profissionais separadamente (não o nó da barbearia
  // inteiro) - agendamentos e clientes de outras pessoas contêm nome e
  // WhatsApp e não devem ser lidos pelo visitante anônimo. A ocupação de
  // horários vem de /api/agendamentos-ocupados, sem esses dados.
  const [infoSnap, servicosSnap, profissionaisSnap] = await Promise.all([
    getDoc(doc(db, 'barbearias', slug)),
    getDocs(collection(db, 'barbearias', slug, 'servicos')),
    getDocs(collection(db, 'barbearias', slug, 'profissionais')),
  ]);

  if (!infoSnap.exists()) return false;

  state.barbearia = infoSnap.data() || {};
  state.servicos = {};
  servicosSnap.forEach((d) => { state.servicos[d.id] = d.data(); });
  state.profissionais = {};
  profissionaisSnap.forEach((d) => { state.profissionais[d.id] = d.data(); });
  state.agendamentos = await carregarOcupacao(slug);

  return true;
}

async function carregarOcupacao(slug) {
  try {
    const resp = await fetch(`/api/agendamentos-ocupados?slug=${encodeURIComponent(slug)}`);
    if (!resp.ok) return {};
    const { ocupados } = await resp.json();
    // calcularHorariosDisponiveis() só usa Object.values(...), a chave não importa
    return ocupados || {};
  } catch (err) {
    console.error('Erro ao carregar ocupação de horários:', err);
    return {};
  }
}

function mostrarApp() {
  $('#loading').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

function mostrarErroBarbearia() {
  $('#loading').classList.add('hidden');
  $('#erro-barbearia').classList.remove('hidden');
}

function renderizarHeader() {
  $('#header-nome').textContent = state.barbearia.nome || 'Barbearia';
  $('#header-passo').textContent = state.barbearia.endereco || '';
}

// ========================================
// EVENTOS
// ========================================
function inicializarEventos() {
  const inputWhats = $('#input-whatsapp');
  inputWhats.addEventListener('input', (e) => {
    e.target.value = formatarWhatsapp(e.target.value);
    verificarClienteExistente(e.target.value);
  });

  $('#btn-continuar-1').addEventListener('click', handleContinuarIdentificacao);

  $('#btn-voltar-2').addEventListener('click', () => mostrarTela(1));
  $('#btn-continuar-2').addEventListener('click', () => {
    if (state.servicosSelecionados.length === 0) return;
    renderizarTela3();
    mostrarTela(3);
  });

  $('#btn-voltar-3').addEventListener('click', () => mostrarTela(2));
  $('#btn-continuar-3').addEventListener('click', () => {
    if (!state.horarioSelecionado) return;
    renderizarResumoFinal();
    mostrarTela(4);
  });

  $('#btn-voltar-4').addEventListener('click', () => mostrarTela(3));
  $('#btn-confirmar').addEventListener('click', handleConfirmarAgendamento);

  // Setas de navegação do carrossel de datas (rolagem suave)
  const btnDataPrev = $('#btn-data-prev-cliente');
  const btnDataNext = $('#btn-data-next-cliente');
  if (btnDataPrev) btnDataPrev.addEventListener('click', () => {
    $('#seletor-data').scrollBy({ left: -160, behavior: 'smooth' });
  });
  if (btnDataNext) btnDataNext.addEventListener('click', () => {
    $('#seletor-data').scrollBy({ left: 160, behavior: 'smooth' });
  });

  $('#btn-novo').addEventListener('click', () => {
    resetarFluxo();
    mostrarTela(1);
  });

  $('#btn-meus-agendamentos').addEventListener('click', abrirMeusAgendamentos);
  $('#btn-voltar-6').addEventListener('click', () => mostrarTela(1));
  $('#btn-cancelar-remarcacao').addEventListener('click', () => {
    mostrarPainelLista();
  });
  $('#btn-confirmar-remarcacao').addEventListener('click', confirmarNovaRemarcacao);

  const btnRemarcarDataPrev = $('#btn-remarcar-data-prev');
  const btnRemarcarDataNext = $('#btn-remarcar-data-next');
  if (btnRemarcarDataPrev) btnRemarcarDataPrev.addEventListener('click', () => {
    $('#remarcar-seletor-data').scrollBy({ left: -160, behavior: 'smooth' });
  });
  if (btnRemarcarDataNext) btnRemarcarDataNext.addEventListener('click', () => {
    $('#remarcar-seletor-data').scrollBy({ left: 160, behavior: 'smooth' });
  });
}

// ========================================
// TELA 1: IDENTIFICAÇÃO
// ========================================
async function verificarClienteExistente(whatsappFormatado) {
  if (!validarWhatsapp(whatsappFormatado)) {
    $('#cliente-reconhecido').classList.add('hidden');
    return;
  }

  const whatsNorm = normalizarWhatsapp(whatsappFormatado);

  try {
    const snap = await getDoc(doc(db, 'barbearias', state.slug, 'clientes', whatsNorm));
    if (snap.exists()) {
      const cliente = snap.data();
      $('#nome-reconhecido').textContent = cliente.nome.split(' ')[0];
      $('#cliente-reconhecido').classList.remove('hidden');
      $('#input-nome').value = cliente.nome;
      state.cliente.nome = cliente.nome;
      state.cliente.novo = false;
    } else {
      $('#cliente-reconhecido').classList.add('hidden');
      state.cliente.novo = true;
    }
  } catch (err) {
    console.error('Erro ao verificar cliente:', err);
  }
}

function handleContinuarIdentificacao() {
  const whatsappRaw = $('#input-whatsapp').value;
  const nome = $('#input-nome').value.trim();

  let temErro = false;
  $('#erro-whatsapp').classList.remove('ativo');
  $('#erro-nome').classList.remove('ativo');
  $('#input-whatsapp').classList.remove('erro');
  $('#input-nome').classList.remove('erro');

  if (!validarWhatsapp(whatsappRaw)) {
    $('#erro-whatsapp').textContent = 'Digite um WhatsApp válido com DDD';
    $('#erro-whatsapp').classList.add('ativo');
    $('#input-whatsapp').classList.add('erro');
    temErro = true;
  }

  if (nome.length < 2) {
    $('#erro-nome').textContent = 'Digite seu nome';
    $('#erro-nome').classList.add('ativo');
    $('#input-nome').classList.add('erro');
    temErro = true;
  }

  if (temErro) return;

  state.cliente.whatsapp = normalizarWhatsapp(whatsappRaw);
  state.cliente.nome = nome;

  renderizarTela2();
  mostrarTela(2);
}

// ========================================
// TELA 2: SERVIÇOS
// ========================================
function renderizarTela2() {
  const container = $('#lista-servicos');
  container.innerHTML = '';

  const servicosArray = Object.entries(state.servicos)
    .filter(([id, s]) => s.ativo !== false)
    .sort((a, b) => (a[1].ordem || 0) - (b[1].ordem || 0));

  if (servicosArray.length === 0) {
    container.innerHTML = '<div class="horario-placeholder">Nenhum serviço cadastrado</div>';
    return;
  }

  servicosArray.forEach(([id, s]) => {
    const selecionado = state.servicosSelecionados.includes(id);
    const card = document.createElement('div');
    card.className = `servico-card ${selecionado ? 'selecionado' : ''}`;
    card.dataset.id = id;
    card.innerHTML = `
      <div class="servico-foto">${escapeHtml(s.emoji) || '✂️'}</div>
      <div class="servico-info">
        <div class="servico-nome">${escapeHtml(s.nome)}</div>
        <div class="servico-detalhes">${s.duracaoMin} min • <span class="servico-preco">${formatarMoeda(s.preco)}</span></div>
      </div>
      <div class="check-circle">✓</div>
    `;
    card.addEventListener('click', () => toggleServico(id));
    container.appendChild(card);
  });

  atualizarResumoTela2();
}

function toggleServico(id) {
  const idx = state.servicosSelecionados.indexOf(id);
  if (idx > -1) {
    state.servicosSelecionados.splice(idx, 1);
  } else {
    state.servicosSelecionados.push(id);
  }

  state.horarioSelecionado = null;
  state.horariosCache = {};

  const card = $(`.servico-card[data-id="${id}"]`);
  card.classList.toggle('selecionado');

  atualizarResumoTela2();
}

function atualizarResumoTela2() {
  const servicos = state.servicosSelecionados.map(id => state.servicos[id]);
  const total = servicos.reduce((sum, s) => sum + s.preco, 0);
  const duracaoTotal = servicos.reduce((sum, s) => sum + s.duracaoMin, 0);

  if (servicos.length === 0) {
    $('#resumo-servicos').innerHTML = '<span>Nenhum serviço selecionado</span>';
    $('#total-valor').textContent = 'R$ 0';
    $('#btn-continuar-2').disabled = true;
  } else {
    $('#resumo-servicos').innerHTML = `<span>${servicos.length} ${servicos.length === 1 ? 'serviço' : 'serviços'} • ${duracaoTotal} min</span>`;
    $('#total-valor').textContent = formatarMoeda(total);
    $('#btn-continuar-2').disabled = false;
  }
}

// ========================================
// TELA 3: PROFISSIONAL + HORÁRIO
// ========================================
function renderizarTela3() {
  renderizarProfissionais();
  renderizarSeletorDeData();
  $('#grid-horarios').innerHTML = '<div class="horario-placeholder">Selecione um profissional e data</div>';
  $('#btn-continuar-3').disabled = true;
  state.profissionalId = null;
  state.dataSelecionada = null;
  state.horarioSelecionado = null;
}

function renderizarProfissionais() {
  const container = $('#grid-profissionais');
  container.innerHTML = '';

  const profsArray = Object.entries(state.profissionais)
    .filter(([id, p]) => p.ativo !== false);

  if (profsArray.length === 0) {
    container.innerHTML = '<div class="horario-placeholder">Nenhum profissional disponível</div>';
    return;
  }

  profsArray.forEach(([id, p]) => {
    const iniciais = p.nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
    const card = document.createElement('div');
    card.className = 'prof-card';
    card.dataset.id = id;
    card.innerHTML = `
      <div class="prof-foto" style="background: linear-gradient(135deg, var(--accent), var(--accent-dark));">${escapeHtml(iniciais)}</div>
      <div class="prof-nome">${escapeHtml(p.nome.split(' ')[0])}</div>
      <div class="prof-spec">${escapeHtml(p.especialidade) || 'Profissional'}</div>
    `;
    card.addEventListener('click', () => selecionarProfissional(id));
    container.appendChild(card);
  });
}

function selecionarProfissional(id) {
  state.profissionalId = id;
  state.horarioSelecionado = null;
  state.horariosCache = {};

  $$('.prof-card').forEach(c => c.classList.toggle('selecionado', c.dataset.id === id));

  if (state.dataSelecionada) {
    renderizarHorarios();
  }
  validarBtnContinuar3();
}

function renderizarSeletorDeData() {
  const container = $('#seletor-data');
  container.innerHTML = '';

  const hoje = new Date();
  const diasSemana = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

  for (let i = 0; i < 14; i++) {
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + i);

    const btn = document.createElement('div');
    btn.className = 'data-btn';
    btn.dataset.data = dataParaChave(data);
    btn.innerHTML = `
      <div class="data-dia">${diasSemana[data.getDay()]}</div>
      <div class="data-num">${data.getDate()}</div>
    `;
    btn.addEventListener('click', () => selecionarData(data));
    container.appendChild(btn);
  }
}

function selecionarData(data) {
  state.dataSelecionada = data;
  state.horarioSelecionado = null;
  const chave = dataParaChave(data);

  $$('.data-btn').forEach(b => b.classList.toggle('selecionado', b.dataset.data === chave));

  if (state.profissionalId) {
    renderizarHorarios();
  } else {
    $('#grid-horarios').innerHTML = '<div class="horario-placeholder">Selecione um profissional primeiro</div>';
  }
  validarBtnContinuar3();
}

function renderizarHorarios() {
  const container = $('#grid-horarios');
  container.innerHTML = '';

  const horarios = calcularHorariosDisponiveis(state.profissionalId, state.dataSelecionada);

  if (horarios.length === 0) {
    container.innerHTML = '<div class="horario-placeholder">Não há horários disponíveis nesta data</div>';
    return;
  }

  horarios.forEach(slot => {
    const el = document.createElement('div');
    el.className = `horario ${slot.indisponivel ? 'indisponivel' : ''}`;
    el.textContent = slot.hora;
    if (!slot.indisponivel) {
      el.addEventListener('click', () => selecionarHorario(slot.hora));
    }
    container.appendChild(el);
  });
}

function calcularHorariosDisponiveis(profissionalId, data, opcoes = {}) {
  const prof = state.profissionais[profissionalId];
  if (!prof) return [];

  const diaSemana = diasDaSemana()[data.getDay()];
  const horarioTrabalho = (prof.horarioTrabalho && prof.horarioTrabalho[diaSemana])
    || (state.barbearia.horarioFuncionamento && state.barbearia.horarioFuncionamento[diaSemana]);

  if (!horarioTrabalho || !horarioTrabalho.ativo) return [];

  const inicio = horaParaMinutos(horarioTrabalho.inicio || '09:00');
  const fim = horaParaMinutos(horarioTrabalho.fim || '20:00');
  const intervalo = 30;

  const duracaoTotal = opcoes.duracaoTotalOverride != null
    ? opcoes.duracaoTotalOverride
    : state.servicosSelecionados
        .map(id => state.servicos[id].duracaoMin)
        .reduce((sum, d) => sum + d, 0);

  const dataChave = dataParaChave(data);
  const agendamentosOcupados = Object.values(state.agendamentos || {})
    .filter(a =>
      a.profissionalId === profissionalId &&
      a.dataChave === dataChave &&
      a.status !== 'cancelado' &&
      (!opcoes.ignorarId || a.id !== opcoes.ignorarId)
    )
    .map(a => ({
      inicio: horaParaMinutos(a.horario),
      fim: horaParaMinutos(a.horario) + a.duracaoMin
    }));

  const bloqueios = (prof.bloqueios && prof.bloqueios[dataChave]) || [];

  const slots = [];
  const agora = new Date();
  const ehHoje = dataChave === dataParaChave(agora);
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

  for (let m = inicio; m + duracaoTotal <= fim; m += intervalo) {
    const hora = minutosParaHora(m);
    let indisponivel = false;

    if (ehHoje && m < minutosAgora + 30) indisponivel = true;

    if (!indisponivel) {
      const slotInicio = m;
      const slotFim = m + duracaoTotal;
      indisponivel = agendamentosOcupados.some(a =>
        (slotInicio < a.fim && slotFim > a.inicio)
      );
    }

    if (!indisponivel && bloqueios.includes(hora)) indisponivel = true;

    slots.push({ hora, indisponivel });
  }

  return slots;
}

function selecionarHorario(hora) {
  state.horarioSelecionado = hora;
  $$('.horario').forEach(h => h.classList.toggle('selecionado', h.textContent === hora));
  validarBtnContinuar3();
}

function validarBtnContinuar3() {
  const valido = state.profissionalId && state.dataSelecionada && state.horarioSelecionado;
  $('#btn-continuar-3').disabled = !valido;
}

// ========================================
// TELA 4: REVISÃO
// ========================================
function renderizarResumoFinal() {
  const servicos = state.servicosSelecionados.map(id => state.servicos[id]);
  const total = servicos.reduce((sum, s) => sum + s.preco, 0);
  const duracao = servicos.reduce((sum, s) => sum + s.duracaoMin, 0);
  const prof = state.profissionais[state.profissionalId];
  const data = state.dataSelecionada;
  const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const dataStr = `${diasSemana[data.getDay()]}, ${formatarData(data)}`;

  const fimMinutos = horaParaMinutos(state.horarioSelecionado) + duracao;
  const horaFim = minutosParaHora(fimMinutos);

  const container = $('#resumo-final');
  container.innerHTML = `
    <div class="resumo-linha"><span class="label">Cliente</span><span class="valor">${escapeHtml(state.cliente.nome)}</span></div>
    <div class="resumo-linha"><span class="label">Profissional</span><span class="valor">${escapeHtml(prof.nome)}</span></div>
    <div class="resumo-linha"><span class="label">Data</span><span class="valor">${dataStr}</span></div>
    <div class="resumo-linha"><span class="label">Horário</span><span class="valor">${state.horarioSelecionado} — ${horaFim}</span></div>
    <div class="resumo-linha"><span class="label">Serviços</span><span class="valor">${servicos.map(s => escapeHtml(s.nome)).join(' + ')}</span></div>
    <div class="resumo-linha destaque"><span class="label">Total</span><span class="valor">${formatarMoeda(total)}</span></div>
  `;
}

// ========================================
// CONFIRMAÇÃO E ENVIO AO FIREBASE
// ========================================
async function handleConfirmarAgendamento() {
  const btn = $('#btn-confirmar');
  btn.disabled = true;
  btn.textContent = 'Confirmando...';

  try {
    await recarregarAgendamentos();
    const horarios = calcularHorariosDisponiveis(state.profissionalId, state.dataSelecionada);
    const slotAlvo = horarios.find(s => s.hora === state.horarioSelecionado);
    if (!slotAlvo || slotAlvo.indisponivel) {
      toast('Este horário acabou de ser reservado por outro cliente. Escolha outro.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar ✓';
      mostrarTela(3);
      renderizarHorarios();
      return;
    }

    await salvarCliente();

    const agendamentoId = await criarAgendamento();

    // Notifica o dono do estabelecimento (não bloqueia o fluxo se falhar)
    notificarNovoAgendamento(agendamentoId).catch(err => console.error('Erro ao notificar:', err));

    renderizarTelaSucesso(agendamentoId);
    mostrarTela(5);

  } catch (err) {
    console.error('Erro ao confirmar:', err);
    toast('Erro ao confirmar agendamento. Tente novamente.', 'erro');
    btn.disabled = false;
    btn.textContent = 'Confirmar ✓';
  }
}

async function recarregarAgendamentos() {
  state.agendamentos = await carregarOcupacao(state.slug);
}

async function salvarCliente() {
  const clienteRef = doc(db, 'barbearias', state.slug, 'clientes', state.cliente.whatsapp);
  const snap = await getDoc(clienteRef);

  if (snap.exists()) {
    const atual = snap.data();
    await setDoc(clienteRef, {
      ...atual,
      nome: state.cliente.nome,
      totalAgendamentos: (atual.totalAgendamentos || 0) + 1,
      ultimoAgendamento: new Date().toISOString()
    });
  } else {
    await setDoc(clienteRef, {
      nome: state.cliente.nome,
      whatsapp: state.cliente.whatsapp,
      primeiraVisita: new Date().toISOString(),
      ultimoAgendamento: new Date().toISOString(),
      totalAgendamentos: 1
    });
  }
}

async function criarAgendamento() {
  const servicos = state.servicosSelecionados.map(id => ({
    id,
    nome: state.servicos[id].nome,
    preco: state.servicos[id].preco,
    duracaoMin: state.servicos[id].duracaoMin
  }));
  const total = servicos.reduce((sum, s) => sum + s.preco, 0);
  const duracao = servicos.reduce((sum, s) => sum + s.duracaoMin, 0);

  const agendamento = {
    clienteWhatsapp: state.cliente.whatsapp,
    clienteNome: state.cliente.nome,
    profissionalId: state.profissionalId,
    profissionalNome: state.profissionais[state.profissionalId].nome,
    servicos: servicos,
    dataChave: dataParaChave(state.dataSelecionada),
    horario: state.horarioSelecionado,
    duracaoMin: duracao,
    valorTotal: total,
    status: 'confirmado',
    criadoEm: new Date().toISOString(),
    origem: 'cliente'
  };

  const novoRef = await addDoc(collection(db, 'barbearias', state.slug, 'agendamentos'), agendamento);
  return novoRef.id;
}

// ========================================
// NOTIFICAÇÃO PUSH PRO DONO DO ESTABELECIMENTO
// ========================================
// O servidor busca o agendamento e os tokens diretamente no banco — o
// navegador só informa qual agendamento notificar, nunca o conteúdo da
// mensagem nem o destino (ver api/send-notification.js).
async function notificarNovoAgendamento(agendamentoId) {
  await fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: state.slug, agendamentoId })
  });
}

// ========================================
// TELA 5: SUCESSO
// ========================================
function renderizarTelaSucesso(agendamentoId) {
  const servicos = state.servicosSelecionados.map(id => state.servicos[id]);
  const total = servicos.reduce((sum, s) => sum + s.preco, 0);
  const duracao = servicos.reduce((sum, s) => sum + s.duracaoMin, 0);
  const prof = state.profissionais[state.profissionalId];
  const data = state.dataSelecionada;
  const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const dataStr = `${diasSemana[data.getDay()]}, ${formatarData(data)}`;
  const fimMin = horaParaMinutos(state.horarioSelecionado) + duracao;

  $('#confirm-sub-msg').innerHTML = `<strong>${escapeHtml(state.cliente.nome.split(' ')[0])}</strong>, seu horário está confirmado.`;

  $('#resumo-sucesso').innerHTML = `
    <div class="resumo-linha"><span class="label">Barbearia</span><span class="valor">${escapeHtml(state.barbearia.nome)}</span></div>
    <div class="resumo-linha"><span class="label">Profissional</span><span class="valor">${escapeHtml(prof.nome)}</span></div>
    <div class="resumo-linha"><span class="label">Data</span><span class="valor">${dataStr}</span></div>
    <div class="resumo-linha"><span class="label">Horário</span><span class="valor">${state.horarioSelecionado} — ${minutosParaHora(fimMin)}</span></div>
    <div class="resumo-linha"><span class="label">Serviços</span><span class="valor">${servicos.map(s => escapeHtml(s.nome)).join(' + ')}</span></div>
    <div class="resumo-linha destaque"><span class="label">Total</span><span class="valor">${formatarMoeda(total)}</span></div>
  `;

  renderizarBotaoAgenda(data, fimMin, prof, servicos);
}

function renderizarBotaoAgenda(data, fimMin, prof, servicos) {
  const titulo = encodeURIComponent(`${servicos.map(s => s.nome).join(' + ')} — ${state.barbearia.nome}`);
  const detalhes = encodeURIComponent(
    `Agendamento na ${state.barbearia.nome}\n` +
    `Profissional: ${prof.nome}\n` +
    `Serviços: ${servicos.map(s => s.nome).join(' + ')}\n` +
    `Valor: ${formatarMoeda(servicos.reduce((s, sv) => s + sv.preco, 0))}\n\n` +
    `Telefone: ${state.barbearia.telefone || ''}`
  );
  const local = encodeURIComponent(state.barbearia.endereco || state.barbearia.nome);

  const dataInicio = new Date(data);
  const [hI, mI] = state.horarioSelecionado.split(':').map(Number);
  dataInicio.setHours(hI, mI, 0, 0);
  const dataFim = new Date(dataInicio);
  dataFim.setMinutes(dataFim.getMinutes() + (fimMin - horaParaMinutos(state.horarioSelecionado)));

  const fmt = (d) => {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${ano}${mes}${dia}T${h}${min}00`;
  };

  const datas = `${fmt(dataInicio)}/${fmt(dataFim)}`;
  const linkGoogle = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${titulo}&dates=${datas}&details=${detalhes}&location=${local}`;

  const btnNovo = $('#btn-novo');
  const btnAgendaAntigo = $('#btn-add-agenda');
  if (btnAgendaAntigo) btnAgendaAntigo.remove();

  const btnAgenda = document.createElement('button');
  btnAgenda.id = 'btn-add-agenda';
  btnAgenda.className = 'btn btn-outline';
  btnAgenda.style.marginBottom = '10px';
  btnAgenda.innerHTML = '📅 Adicionar à minha agenda';
  btnAgenda.addEventListener('click', () => {
    window.open(linkGoogle, '_blank');
    toast('Abrindo sua agenda...', 'sucesso');
  });

  btnNovo.parentNode.insertBefore(btnAgenda, btnNovo);
}

function resetarFluxo() {
  state.servicosSelecionados = [];
  state.profissionalId = null;
  state.dataSelecionada = null;
  state.horarioSelecionado = null;
  state.horariosCache = {};
  $('#btn-confirmar').disabled = false;
  $('#btn-confirmar').textContent = 'Confirmar ✓';

  carregarBarbearia(state.slug);
}

// ========================================
// TELA 6: MEUS AGENDAMENTOS
// ========================================
async function abrirMeusAgendamentos() {
  const whatsappRaw = $('#input-whatsapp').value;
  if (!validarWhatsapp(whatsappRaw)) {
    $('#erro-whatsapp').textContent = 'Digite um WhatsApp válido com DDD pra ver seus agendamentos';
    $('#erro-whatsapp').classList.add('ativo');
    $('#input-whatsapp').classList.add('erro');
    return;
  }

  state.cliente.whatsapp = normalizarWhatsapp(whatsappRaw);
  mostrarTela(6);
  mostrarPainelLista();
  await carregarMeusAgendamentos();
}

async function carregarMeusAgendamentos() {
  $('#lista-meus-agendamentos').innerHTML = '<div class="horario-placeholder">Carregando...</div>';
  try {
    const resp = await fetch('/api/agendamento-cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: state.slug, whatsapp: state.cliente.whatsapp, action: 'listar' })
    });
    const dados = await resp.json();
    state.meusAgendamentos = dados.agendamentos || [];
    renderizarMeusAgendamentos();
  } catch (err) {
    console.error('Erro ao carregar agendamentos:', err);
    $('#lista-meus-agendamentos').innerHTML = '<div class="horario-placeholder">Erro ao carregar. Tente novamente.</div>';
  }
}

function renderizarMeusAgendamentos() {
  const container = $('#lista-meus-agendamentos');
  const hojeChave = dataParaChave(new Date());
  const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const labelStatus = { confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado' };

  if (state.meusAgendamentos.length === 0) {
    container.innerHTML = '<div class="horario-placeholder">Nenhum agendamento encontrado com este WhatsApp.</div>';
    return;
  }

  container.innerHTML = state.meusAgendamentos.map(a => {
    // Cliente só mexe sozinho até 1 dia (data corrida) antes do agendamento —
    // em cima da hora, só falando direto com o estabelecimento.
    const dentroDoPrazo = a.status === 'confirmado' && a.dataChave > hojeChave;
    const jaRemarcou = (a.remarcacoesCliente || 0) >= 1;
    const [ano, mes, dia] = a.dataChave.split('-').map(Number);
    const dataStr = `${diasSemana[new Date(ano, mes - 1, dia).getDay()]}, ${formatarData(new Date(ano, mes - 1, dia))}`;

    return `
      <div class="meu-agendamento-card">
        <div class="meu-ag-topo">
          <span class="meu-ag-data">${dataStr} • ${a.horario}</span>
          <span class="meu-ag-status meu-ag-status-${a.status}">${labelStatus[a.status] || a.status}</span>
        </div>
        <div class="meu-ag-info">${escapeHtml(a.profissionalNome)} • ${(a.servicos || []).map(s => escapeHtml(s.nome)).join(' + ')}</div>
        <div class="meu-ag-valor">${formatarMoeda(a.valorTotal)}</div>
        ${dentroDoPrazo ? `
          <div class="meu-ag-acoes">
            ${!jaRemarcou ? `<button class="btn-outline btn-mini-full" data-acao="remarcar" data-id="${a.id}" type="button">Remarcar</button>` : ''}
            <button class="btn-outline btn-mini-full btn-perigo-outline" data-acao="cancelar" data-id="${a.id}" type="button">Cancelar</button>
          </div>
          ${jaRemarcou ? '<div class="meu-ag-aviso">Já remarcado uma vez — pra remarcar de novo, fale com o estabelecimento.</div>' : ''}
        ` : (a.status === 'confirmado' ? '<div class="meu-ag-aviso">Menos de 1 dia pro horário — pra alterar, fale direto com o estabelecimento.</div>' : '')}
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-acao="remarcar"]').forEach(btn => {
    btn.addEventListener('click', () => iniciarRemarcacao(btn.dataset.id));
  });
  container.querySelectorAll('[data-acao="cancelar"]').forEach(btn => {
    btn.addEventListener('click', () => confirmarCancelamento(btn.dataset.id));
  });
}

async function confirmarCancelamento(agendamentoId) {
  if (!confirm('Tem certeza que deseja cancelar este agendamento?')) return;
  try {
    const resp = await fetch('/api/agendamento-cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: state.slug, whatsapp: state.cliente.whatsapp, action: 'cancelar', agendamentoId })
    });
    const dados = await resp.json();
    if (!resp.ok) {
      toast(dados.erro || 'Erro ao cancelar', 'erro');
      return;
    }
    toast('Agendamento cancelado', 'sucesso');
    await carregarMeusAgendamentos();
  } catch (err) {
    console.error('Erro ao cancelar:', err);
    toast('Erro ao cancelar. Tente novamente.', 'erro');
  }
}

function mostrarPainelLista() {
  $('#painel-lista-agendamentos').classList.remove('hidden');
  $('#painel-remarcar').classList.add('hidden');
  $('#footer-lista-agendamentos').classList.remove('hidden');
  $('#footer-remarcar').classList.add('hidden');
  renderizarMeusAgendamentos();
}

function mostrarPainelRemarcar() {
  $('#painel-lista-agendamentos').classList.add('hidden');
  $('#painel-remarcar').classList.remove('hidden');
  $('#footer-lista-agendamentos').classList.add('hidden');
  $('#footer-remarcar').classList.remove('hidden');
}

async function iniciarRemarcacao(agendamentoId) {
  const ag = state.meusAgendamentos.find(a => a.id === agendamentoId);
  if (!ag) return;

  state.remarcacao = {
    agendamentoId: ag.id,
    profissionalId: ag.profissionalId,
    duracaoMin: ag.duracaoMin,
    dataSelecionada: null,
    horarioSelecionado: null
  };

  $('#remarcar-titulo').textContent = `${(ag.servicos || []).map(s => s.nome).join(' + ')} com ${ag.profissionalNome}`;
  mostrarPainelRemarcar();
  $('#remarcar-grid-horarios').innerHTML = '<div class="horario-placeholder">Selecione uma data</div>';
  $('#btn-confirmar-remarcacao').disabled = true;

  await recarregarAgendamentos();
  renderizarRemarcarSeletorDeData();
}

function renderizarRemarcarSeletorDeData() {
  const container = $('#remarcar-seletor-data');
  container.innerHTML = '';
  const hoje = new Date();
  const diasSemana = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

  for (let i = 0; i < 14; i++) {
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + i);
    const btn = document.createElement('div');
    btn.className = 'data-btn';
    btn.dataset.data = dataParaChave(data);
    btn.innerHTML = `
      <div class="data-dia">${diasSemana[data.getDay()]}</div>
      <div class="data-num">${data.getDate()}</div>
    `;
    btn.addEventListener('click', () => selecionarDataRemarcacao(data));
    container.appendChild(btn);
  }
}

function selecionarDataRemarcacao(data) {
  state.remarcacao.dataSelecionada = data;
  state.remarcacao.horarioSelecionado = null;
  const chave = dataParaChave(data);
  $$('#remarcar-seletor-data .data-btn').forEach(b => b.classList.toggle('selecionado', b.dataset.data === chave));
  $('#btn-confirmar-remarcacao').disabled = true;
  renderizarRemarcarHorarios();
}

function renderizarRemarcarHorarios() {
  const container = $('#remarcar-grid-horarios');
  container.innerHTML = '';

  const horarios = calcularHorariosDisponiveis(state.remarcacao.profissionalId, state.remarcacao.dataSelecionada, {
    duracaoTotalOverride: state.remarcacao.duracaoMin,
    ignorarId: state.remarcacao.agendamentoId
  });

  if (horarios.length === 0) {
    container.innerHTML = '<div class="horario-placeholder">Não há horários disponíveis nesta data</div>';
    return;
  }

  horarios.forEach(slot => {
    const el = document.createElement('div');
    el.className = `horario ${slot.indisponivel ? 'indisponivel' : ''}`;
    el.textContent = slot.hora;
    if (!slot.indisponivel) {
      el.addEventListener('click', () => selecionarHorarioRemarcacao(slot.hora));
    }
    container.appendChild(el);
  });
}

function selecionarHorarioRemarcacao(hora) {
  state.remarcacao.horarioSelecionado = hora;
  $$('#remarcar-grid-horarios .horario').forEach(h => h.classList.toggle('selecionado', h.textContent === hora));
  $('#btn-confirmar-remarcacao').disabled = false;
}

async function confirmarNovaRemarcacao() {
  const btn = $('#btn-confirmar-remarcacao');
  btn.disabled = true;
  btn.textContent = 'Remarcando...';

  try {
    const resp = await fetch('/api/agendamento-cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: state.slug,
        whatsapp: state.cliente.whatsapp,
        action: 'remarcar',
        agendamentoId: state.remarcacao.agendamentoId,
        novaDataChave: dataParaChave(state.remarcacao.dataSelecionada),
        novoHorario: state.remarcacao.horarioSelecionado
      })
    });
    const dados = await resp.json();

    if (!resp.ok) {
      toast(dados.erro || 'Erro ao remarcar', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar novo horário';
      return;
    }

    toast('Agendamento remarcado!', 'sucesso');
    await carregarMeusAgendamentos();
  } catch (err) {
    console.error('Erro ao remarcar:', err);
    toast('Erro ao remarcar. Tente novamente.', 'erro');
  }

  btn.disabled = false;
  btn.textContent = 'Confirmar novo horário';
}

// ========================================
// START
// ========================================
inicializar();
