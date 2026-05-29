// ========================================
// 77 AGENDAPRO — Lógica da Aplicação
// ========================================

import { db } from './firebase-config.js';
import {
  ref,
  get,
  set,
  push,
  query,
  orderByChild,
  equalTo
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ========================================
// ESTADO GLOBAL
// ========================================
const state = {
  slug: null,
  barbearia: null,
  servicos: {},
  profissionais: {},
  agendamentos: {},

  // Seleções do cliente
  cliente: { whatsapp: null, nome: null, novo: true },
  servicosSelecionados: [],
  profissionalId: null,
  dataSelecionada: null,
  horarioSelecionado: null,

  // Cache de horários disponíveis (para evitar recalcular)
  horariosCache: {}
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
  // Remove tudo que não for dígito
  const digitos = numero.replace(/\D/g, '');
  // Garante DDI 55 (Brasil)
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
  // YYYY-MM-DD
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
    5: 'Concluído'
  };
  $('#header-passo').textContent = labels[numero] || '';

  // Scroll para o topo
  window.scrollTo(0, 0);
}

// ========================================
// INICIALIZAÇÃO
// ========================================
async function inicializar() {
  // Identifica a barbearia pelo slug na URL
  // Suporta: ?b=slug  OU  /slug (pretty URL via vercel.json)
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

    renderizarHeader();
    inicializarEventos();
    mostrarApp();
  } catch (err) {
    console.error('Erro ao inicializar:', err);
    mostrarErroBarbearia();
  }
}

async function carregarBarbearia(slug) {
  const snap = await get(ref(db, `barbearias/${slug}`));
  if (!snap.exists()) return false;

  const data = snap.val();
  state.barbearia = data.info || {};
  state.servicos = data.servicos || {};
  state.profissionais = data.profissionais || {};
  state.agendamentos = data.agendamentos || {};

  return true;
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
  // Máscara de WhatsApp
  const inputWhats = $('#input-whatsapp');
  inputWhats.addEventListener('input', (e) => {
    e.target.value = formatarWhatsapp(e.target.value);
    verificarClienteExistente(e.target.value);
  });

  // Tela 1: continuar
  $('#btn-continuar-1').addEventListener('click', handleContinuarIdentificacao);

  // Tela 2: voltar e continuar
  $('#btn-voltar-2').addEventListener('click', () => mostrarTela(1));
  $('#btn-continuar-2').addEventListener('click', () => {
    if (state.servicosSelecionados.length === 0) return;
    renderizarTela3();
    mostrarTela(3);
  });

  // Tela 3: voltar e continuar
  $('#btn-voltar-3').addEventListener('click', () => mostrarTela(2));
  $('#btn-continuar-3').addEventListener('click', () => {
    if (!state.horarioSelecionado) return;
    renderizarResumoFinal();
    mostrarTela(4);
  });

  // Tela 4: voltar e confirmar
  $('#btn-voltar-4').addEventListener('click', () => mostrarTela(3));
  $('#btn-confirmar').addEventListener('click', handleConfirmarAgendamento);

  // Tela 5: novo agendamento
  $('#btn-novo').addEventListener('click', () => {
    resetarFluxo();
    mostrarTela(1);
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
    const snap = await get(ref(db, `barbearias/${state.slug}/clientes/${whatsNorm}`));
    if (snap.exists()) {
      const cliente = snap.val();
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

  // Validações
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
      <div class="servico-foto">${s.emoji || '✂️'}</div>
      <div class="servico-info">
        <div class="servico-nome">${s.nome}</div>
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

  // Limpa horário selecionado (mudou duração)
  state.horarioSelecionado = null;
  state.horariosCache = {};

  // Atualiza visual
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

  // Cores aleatórias por profissional (mas determinísticas pelo id)
  const cores = ['#d4ff3a', '#a3e635', '#ffaa3a', '#ff77aa', '#77ddff'];

  profsArray.forEach(([id, p], idx) => {
    const iniciais = p.nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
    const cor = cores[idx % cores.length];
    const card = document.createElement('div');
    card.className = 'prof-card';
    card.dataset.id = id;
    card.innerHTML = `
      <div class="prof-foto" style="background: linear-gradient(135deg, ${cor}, ${cor}aa);">${iniciais}</div>
      <div class="prof-nome">${p.nome.split(' ')[0]}</div>
      <div class="prof-spec">${p.especialidade || 'Profissional'}</div>
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

  // Renderiza próximos 14 dias
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

function calcularHorariosDisponiveis(profissionalId, data) {
  const prof = state.profissionais[profissionalId];
  if (!prof) return [];

  const diaSemana = diasDaSemana()[data.getDay()];
  const horarioTrabalho = (prof.horarioTrabalho && prof.horarioTrabalho[diaSemana])
    || (state.barbearia.horarioFuncionamento && state.barbearia.horarioFuncionamento[diaSemana]);

  if (!horarioTrabalho || !horarioTrabalho.ativo) return [];

  const inicio = horaParaMinutos(horarioTrabalho.inicio || '09:00');
  const fim = horaParaMinutos(horarioTrabalho.fim || '20:00');
  const intervalo = 30; // slots de 30 em 30 minutos

  // Duração total dos serviços selecionados
  const duracaoTotal = state.servicosSelecionados
    .map(id => state.servicos[id].duracaoMin)
    .reduce((sum, d) => sum + d, 0);

  // Buscar agendamentos do profissional na data
  const dataChave = dataParaChave(data);
  const agendamentosOcupados = Object.values(state.agendamentos || {})
    .filter(a =>
      a.profissionalId === profissionalId &&
      a.dataChave === dataChave &&
      a.status !== 'cancelado'
    )
    .map(a => ({
      inicio: horaParaMinutos(a.horario),
      fim: horaParaMinutos(a.horario) + a.duracaoMin
    }));

  // Buscar bloqueios manuais
  const bloqueios = (prof.bloqueios && prof.bloqueios[dataChave]) || [];

  const slots = [];
  const agora = new Date();
  const ehHoje = dataChave === dataParaChave(agora);
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

  for (let m = inicio; m + duracaoTotal <= fim; m += intervalo) {
    const hora = minutosParaHora(m);
    let indisponivel = false;

    // Já passou (se é hoje)
    if (ehHoje && m < minutosAgora + 30) indisponivel = true;

    // Conflito com agendamento existente
    if (!indisponivel) {
      const slotInicio = m;
      const slotFim = m + duracaoTotal;
      indisponivel = agendamentosOcupados.some(a =>
        (slotInicio < a.fim && slotFim > a.inicio)
      );
    }

    // Conflito com bloqueio
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
    <div class="resumo-linha"><span class="label">Cliente</span><span class="valor">${state.cliente.nome}</span></div>
    <div class="resumo-linha"><span class="label">Profissional</span><span class="valor">${prof.nome}</span></div>
    <div class="resumo-linha"><span class="label">Data</span><span class="valor">${dataStr}</span></div>
    <div class="resumo-linha"><span class="label">Horário</span><span class="valor">${state.horarioSelecionado} — ${horaFim}</span></div>
    <div class="resumo-linha"><span class="label">Serviços</span><span class="valor">${servicos.map(s => s.nome).join(' + ')}</span></div>
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
    // 1. Re-valida disponibilidade (alguém pode ter pego o slot enquanto isso)
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

    // 2. Salva/atualiza cliente
    await salvarCliente();

    // 3. Cria agendamento
    const agendamentoId = await criarAgendamento();

    // 4. Sucesso!
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
  const snap = await get(ref(db, `barbearias/${state.slug}/agendamentos`));
  state.agendamentos = snap.exists() ? snap.val() : {};
}

async function salvarCliente() {
  const path = `barbearias/${state.slug}/clientes/${state.cliente.whatsapp}`;
  const snap = await get(ref(db, path));

  if (snap.exists()) {
    const atual = snap.val();
    await set(ref(db, path), {
      ...atual,
      nome: state.cliente.nome,
      totalAgendamentos: (atual.totalAgendamentos || 0) + 1,
      ultimoAgendamento: new Date().toISOString()
    });
  } else {
    await set(ref(db, path), {
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

  const novoRef = push(ref(db, `barbearias/${state.slug}/agendamentos`));
  await set(novoRef, agendamento);
  return novoRef.key;
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

  $('#confirm-sub-msg').innerHTML = `<strong>${state.cliente.nome.split(' ')[0]}</strong>, seu horário está confirmado. Você receberá um lembrete no WhatsApp.`;

  $('#resumo-sucesso').innerHTML = `
    <div class="resumo-linha"><span class="label">Barbearia</span><span class="valor">${state.barbearia.nome}</span></div>
    <div class="resumo-linha"><span class="label">Profissional</span><span class="valor">${prof.nome}</span></div>
    <div class="resumo-linha"><span class="label">Data</span><span class="valor">${dataStr}</span></div>
    <div class="resumo-linha"><span class="label">Horário</span><span class="valor">${state.horarioSelecionado} — ${minutosParaHora(fimMin)}</span></div>
    <div class="resumo-linha"><span class="label">Serviços</span><span class="valor">${servicos.map(s => s.nome).join(' + ')}</span></div>
    <div class="resumo-linha destaque"><span class="label">Total</span><span class="valor">${formatarMoeda(total)}</span></div>
  `;
}

function resetarFluxo() {
  state.servicosSelecionados = [];
  state.profissionalId = null;
  state.dataSelecionada = null;
  state.horarioSelecionado = null;
  state.horariosCache = {};
  $('#btn-confirmar').disabled = false;
  $('#btn-confirmar').textContent = 'Confirmar ✓';

  // Recarrega dados (pode ter atualizações)
  carregarBarbearia(state.slug);
}

// ========================================
// START
// ========================================
inicializar();
