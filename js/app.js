// ========================================
// 77 AGENDAPRO — Área Pública do Cliente
// ========================================

// Sem acesso direto ao Firestore: tudo passa pelas funções serverless
// (/api/negocio, /api/criar-agendamento, /api/agendamento-cliente), que
// validam no servidor e só devolvem o que o visitante pode ver.
import { aplicarTema } from './vocabulario.js';
import { escapeHtml, profissionalRealizaServico, fotoServicoValida } from './utils.js';

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
// Array de verdade (e não NodeList): NodeList não tem .map/.filter/.reduce e quebrava em silêncio
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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
    6: 'Meus agendamentos',
    7: 'Pagamento do sinal'
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

    // Negócio aguardando aprovação, suspenso ou com trial vencido: mostra o
    // aviso em vez de deixar o cliente montar um agendamento que o servidor recusaria.
    if (state.barbearia.aceitaAgendamentos === false) {
      mostrarErroBarbearia(
        state.barbearia.nome || 'Agendamento indisponível',
        state.barbearia.motivoIndisponivel,
        '🕒'
      );
      return;
    }

    renderizarHeader();
    inicializarEventos();
    mostrarApp();
    carregarFotosServicos();                             // sem esperar: a tela já está de pé
  } catch (err) {
    console.error('Erro ao inicializar:', err);
    mostrarErroBarbearia();
  }
}

// As fotos dos serviços vêm numa chamada separada (o pacote principal não leva mais as fotos, que pesam muito).
// Enquanto não chegam, o cartão mostra uma caixa cinza do mesmo tamanho (sem a tela "pular" quando a foto aparece).
async function carregarFotosServicos() {
  const temAlguma = Object.values(state.servicos).some((s) => s.temFoto);
  if (!temAlguma) return;
  try {
    const resp = await fetch(`/api/negocio?slug=${encodeURIComponent(state.slug)}&fotos=1`);
    if (!resp.ok) throw new Error('fotos indisponíveis');
    const { fotos } = await resp.json();
    Object.entries(fotos || {}).forEach(([id, foto]) => {
      if (state.servicos[id] && fotoServicoValida(foto)) state.servicos[id].foto = foto;
    });
  } catch (err) {
    console.error('Fotos dos serviços:', err);
  }
  // quem não recebeu foto deixa de esperar por ela (cartão sem foto, como qualquer outro)
  Object.values(state.servicos).forEach((s) => { if (!fotoServicoValida(s.foto)) s.temFoto = false; });
  aplicarFotosServicos();
}

function aplicarFotosServicos() {
  $$('#lista-servicos .servico-card').forEach((card) => {
    const s = state.servicos[card.dataset.id];
    const pendente = card.querySelector('.foto-carregando');
    if (!s || !pendente) return;
    if (fotoServicoValida(s.foto)) {
      const img = document.createElement('img');
      img.src = s.foto;
      img.alt = s.nome || '';
      pendente.classList.remove('foto-carregando');
      pendente.appendChild(img);
    } else {
      pendente.remove();
    }
  });
}

async function carregarBarbearia(slug) {
  // Uma única chamada devolve info pública, serviços, profissionais e a
  // ocupação futura — já filtrados no servidor (sem comissão, sem tokens,
  // sem nome/WhatsApp de outros clientes).
  let resp = null;
  const pre = window.__negocioPrefetch;
  window.__negocioPrefetch = null;                       // a pré-carga vale uma vez só
  if (pre && pre.slug === slug) { try { resp = await pre.promessa; } catch (_) { resp = null; } }
  if (!resp || (!resp.ok && resp.status !== 404 && resp.status !== 400)) resp = await fetch(`/api/negocio?slug=${encodeURIComponent(slug)}`);
  if (resp.status === 404 || resp.status === 400) return false;
  if (!resp.ok) throw new Error('Falha ao carregar o estabelecimento');

  const dados = await resp.json();
  state.barbearia = dados.barbearia || {};
  state.servicos = dados.servicos || {};
  state.profissionais = dados.profissionais || {};
  state.agendamentos = dados.ocupados || [];
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

function mostrarErroBarbearia(titulo, mensagem, icone) {
  $('#loading').classList.add('hidden');
  if (titulo) $('#erro-barbearia .erro-titulo').textContent = titulo;
  if (mensagem) $('#erro-barbearia .erro-msg').textContent = mensagem;
  if (icone) $('#erro-barbearia .erro-icone').textContent = icone;
  $('#erro-barbearia').classList.remove('hidden');
}

function renderizarHeader() {
  $('#header-nome').textContent = state.barbearia.nome || 'Barbearia';
  $('#header-passo').textContent = state.barbearia.enderecoCurto || state.barbearia.endereco || '';
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
  $('#btn-continuar-2').addEventListener('click', async () => {
    if (state.servicosSelecionados.length === 0) return;
    // Ocupação sempre FRESCA ao escolher o horário: sem isso a página guardava a foto de quando
    // abriu, e um horário cancelado continuava aparecendo como ocupado até recarregar.
    await recarregarAgendamentos();
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

  // novo agendamento: o cliente já se identificou (nome e WhatsApp ficam guardados), então vai direto para a escolha do serviço
  $('#btn-novo').addEventListener('click', async () => {
    try {
      await resetarFluxo();
      renderizarTela2();
      mostrarTela(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Erro ao iniciar novo agendamento:', err);
      toast('Não foi possível carregar os serviços. Tente novamente.', 'erro');
    }
  });
  // tela do sinal (Pix)
  $('#btn-copiar-pix').addEventListener('click', copiarPix);
  $('#btn-ja-paguei').addEventListener('click', handleJaPaguei);
  $('#btn-sinal-whats').addEventListener('click', () => {
    const fone = telefoneParaWhatsapp(state.sinalAtual.telefoneNegocio);
    if (fone) window.open(`https://wa.me/${fone}?text=${encodeURIComponent(mensagemWhatsSinal())}`, '_blank');
  });
  $('#btn-sinal-meus').addEventListener('click', async () => {
    mostrarTela(6);
    mostrarPainelLista();
    await carregarMeusAgendamentos();
  });

  // tela de sucesso: voltar ao início (mesma tela de entrada) ou conferir/alterar o que acabou de marcar
  $('#btn-inicio').addEventListener('click', () => {
    resetarFluxo().catch((err) => console.error('Erro ao recarregar:', err));
    mostrarTela(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#btn-ver-meus').addEventListener('click', async () => {
    mostrarTela(6);
    mostrarPainelLista();
    await carregarMeusAgendamentos();
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
    // O servidor devolve só o PRIMEIRO nome (não expõe o nome completo de
    // quem tem aquele WhatsApp pra qualquer visitante que digitar o número).
    const resp = await fetch('/api/agendamento-cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: state.slug, whatsapp: whatsNorm, action: 'identificar' })
    });
    if (!resp.ok) return;
    const dados = await resp.json();
    if (whatsNorm !== normalizarWhatsapp($('#input-whatsapp').value)) return; // usuário já mudou o número
    if (dados.encontrado) {
      $('#nome-reconhecido').textContent = dados.nome;
      $('#cliente-reconhecido').classList.remove('hidden');
      if (!$('#input-nome').value.trim()) $('#input-nome').value = dados.nome;
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
    // Serviço restrito a certos profissionais: avisa com quem é feito
    const quem = nomesQuemRealiza(s);
    card.innerHTML = `
      ${fotoServicoValida(s.foto)
        ? `<div class="servico-foto com-foto"><img src="${s.foto}" alt="${escapeHtml(s.nome)}" loading="lazy"></div>`
        : (s.temFoto ? '<div class="servico-foto com-foto foto-carregando"></div>' : '')}
      <div class="servico-info">
        <div class="servico-nome">${escapeHtml(s.nome)}</div>
        <div class="servico-detalhes">${s.duracaoMin} min • <span class="servico-preco">${formatarMoeda(s.preco)}</span></div>
        ${quem ? `<div class="servico-detalhes">Com ${escapeHtml(quem)}</div>` : ''}
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
  // Zera a escolha ANTES de montar as datas (a lista de datas depende do profissional)
  state.profissionalId = null;
  state.dataSelecionada = null;
  state.horarioSelecionado = null;
  renderizarProfissionais();
  renderizarSeletorDeData();
  $('#grid-horarios').innerHTML = '<div class="horario-placeholder">Selecione um profissional e data</div>';
  $('#btn-continuar-3').disabled = true;
}

// Nomes (só o primeiro) de quem realiza um serviço restrito; '' se for livre.
function nomesQuemRealiza(servico) {
  const ids = servico && servico.profissionaisIds;
  if (!Array.isArray(ids) || ids.length === 0) return '';
  const nomes = ids
    .map((id) => state.profissionais[id])
    .filter((p) => p && p.ativo !== false)
    .map((p) => String(p.nome || '').split(' ')[0]);
  if (nomes.length <= 1) return nomes[0] || '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

// Profissionais ativos que realizam TODOS os serviços escolhidos.
function profissionaisElegiveis() {
  return Object.entries(state.profissionais)
    .filter(([id, p]) => p.ativo !== false)
    .filter(([id]) => state.servicosSelecionados.every((sid) => profissionalRealizaServico(state.servicos[sid], id)));
}

function renderizarProfissionais() {
  const container = $('#grid-profissionais');
  container.innerHTML = '';

  const profsArray = profissionaisElegiveis();

  if (profsArray.length === 0) {
    const algumAtivo = Object.values(state.profissionais).some((p) => p.ativo !== false);
    container.innerHTML = algumAtivo && state.servicosSelecionados.length > 1
      ? '<div class="horario-placeholder">Nenhum profissional realiza todos esses serviços juntos. Volte e agende cada serviço separadamente.</div>'
      : algumAtivo
        ? '<div class="horario-placeholder">Nenhum profissional disponível para este serviço no momento.</div>'
        : '<div class="horario-placeholder">Nenhum profissional disponível</div>';
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

  // As datas oferecidas dependem do profissional: reconstrói a lista só com
  // os dias em que ELE tem horário livre.
  const datasOferecidas = renderizarSeletorDeData();
  if (state.dataSelecionada && !datasOferecidas.includes(dataParaChave(state.dataSelecionada))) {
    state.dataSelecionada = null;
    $('#grid-horarios').innerHTML = '<div class="horario-placeholder">Selecione uma data</div>';
  } else if (state.dataSelecionada) {
    renderizarHorarios();
  }
  validarBtnContinuar3();
}

const DIAS_SEMANA_ABREV = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MAX_DATAS_MOSTRADAS = 14;   // quantos dias com vaga mostrar no carrossel
const JANELA_BUSCA_DIAS = 60;     // até onde procurar dias com vaga (servidor aceita até 90)

// Monta o carrossel de datas mostrando SÓ os dias em que algum dos
// profissionais informados tem ao menos um horário livre. Dia fechado, dia
// lotado e "hoje depois do expediente" simplesmente não aparecem.
// Devolve as chaves (AAAA-MM-DD) dos dias oferecidos.
function renderizarDatasComHorarios({ container, profissionaisIds, opcoes = {}, aoSelecionar, selecionadaChave = null, mensagemVazia }) {
  container.innerHTML = '';
  const hoje = new Date();
  const oferecidas = [];

  for (let i = 0; i < JANELA_BUSCA_DIAS && oferecidas.length < MAX_DATAS_MOSTRADAS; i++) {
    const data = new Date(hoje);
    data.setDate(hoje.getDate() + i);

    const temVaga = profissionaisIds.some((profId) =>
      calcularHorariosDisponiveis(profId, data, opcoes).some((slot) => !slot.indisponivel));
    if (!temVaga) continue;

    const chave = dataParaChave(data);
    const btn = document.createElement('div');
    btn.className = `data-btn${chave === selecionadaChave ? ' selecionado' : ''}`;
    btn.dataset.data = chave;
    btn.innerHTML = `
      <div class="data-dia">${DIAS_SEMANA_ABREV[data.getDay()]}</div>
      <div class="data-num">${data.getDate()}</div>
    `;
    btn.addEventListener('click', () => aoSelecionar(data));
    container.appendChild(btn);
    oferecidas.push(chave);
  }

  if (!oferecidas.length) {
    container.innerHTML = `<div class="horario-placeholder">${mensagemVazia}</div>`;
  }
  return oferecidas;
}

function renderizarSeletorDeData() {
  const profissionaisIds = state.profissionalId
    ? [state.profissionalId]
    : profissionaisElegiveis().map(([id]) => id);

  return renderizarDatasComHorarios({
    container: $('#seletor-data'),
    profissionaisIds,
    aoSelecionar: selecionarData,
    selecionadaChave: state.dataSelecionada ? dataParaChave(state.dataSelecionada) : null,
    mensagemVazia: 'Sem horários disponíveis nos próximos dias. Fale direto com o estabelecimento.'
  });
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

  // Sinal por Pix: avisa ANTES de confirmar quanto é e quanto tempo tem para pagar
  const sinal = state.barbearia.sinal;
  const aviso = $('#aviso-sinal');
  if (sinal && sinal.ativo) {
    const valor = Math.round(total * sinal.percentual) / 100;
    aviso.innerHTML = `<strong>Sinal de ${sinal.percentual}%: ${formatarMoeda(valor)} via Pix.</strong> Ao reservar, o horário fica separado para você e você terá até ${sinal.prazoHoras} h para pagar (no máximo até 2 horas antes do horário). O estabelecimento confirma depois de conferir o Pix.`;
    aviso.classList.remove('hidden');
    $('#btn-confirmar').textContent = rotuloConfirmar();
  } else {
    aviso.classList.add('hidden');
    $('#btn-confirmar').textContent = rotuloConfirmar();
  }
}

// ========================================
// CONFIRMAÇÃO E ENVIO AO FIREBASE
// ========================================
async function handleConfirmarAgendamento() {
  const btn = $('#btn-confirmar');
  btn.disabled = true;
  btn.textContent = 'Confirmando...';

  try {
    // Pré-checagem só pra dar feedback rápido; quem decide de verdade é o
    // servidor, dentro de uma transação (api/criar-agendamento.js).
    await recarregarAgendamentos();
    const horarios = calcularHorariosDisponiveis(state.profissionalId, state.dataSelecionada);
    const slotAlvo = horarios.find(s => s.hora === state.horarioSelecionado);
    if (!slotAlvo || slotAlvo.indisponivel) {
      toast('Este horário acabou de ser reservado por outro cliente. Escolha outro.', 'erro');
      btn.disabled = false;
      btn.textContent = rotuloConfirmar();
      mostrarTela(3);
      renderizarHorarios();
      return;
    }

    const resp = await fetch('/api/criar-agendamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: state.slug,
        whatsapp: state.cliente.whatsapp,
        nome: state.cliente.nome,
        profissionalId: state.profissionalId,
        servicosIds: state.servicosSelecionados,
        dataChave: dataParaChave(state.dataSelecionada),
        horario: state.horarioSelecionado
      })
    });
    const corpo = await resp.json().catch(() => ({}));

    if (resp.status === 409) {
      toast(corpo.erro || 'Este horário acabou de ser reservado. Escolha outro.', 'erro');
      btn.disabled = false;
      btn.textContent = rotuloConfirmar();
      await recarregarAgendamentos();
      mostrarTela(3);
      renderizarHorarios();
      return;
    }
    if (!resp.ok) {
      toast(corpo.erro || 'Erro ao confirmar agendamento. Tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = rotuloConfirmar();
      return;
    }

    if (corpo.sinal) {
      state.sinalAtual = { agendamentoId: corpo.id, status: 'aguardando_sinal', ...corpo.sinal, agendamento: corpo.agendamento };
      renderizarTelaSinal();
      mostrarTela(7);
      return;
    }

    renderizarTelaSucesso(corpo.id);
    mostrarTela(5);

  } catch (err) {
    console.error('Erro ao confirmar:', err);
    toast('Erro ao confirmar agendamento. Tente novamente.', 'erro');
    btn.disabled = false;
    btn.textContent = rotuloConfirmar();
  }
}

async function recarregarAgendamentos() {
  state.agendamentos = await carregarOcupacao(state.slug);
}

// ========================================
// TELA 7: PAGAMENTO DO SINAL (Pix)
// ========================================
function rotuloConfirmar() {
  const s = state.barbearia && state.barbearia.sinal;
  return s && s.ativo ? 'Reservar e pagar sinal →' : 'Confirmar ✓';
}

function telefoneParaWhatsapp(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^55\d{10,11}$/.test(d) ? d : '';
}

function textoDataHora(dataChave, horario) {
  const [ano, mes, dia] = dataChave.split('-').map(Number);
  const dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  return `${dias[new Date(ano, mes - 1, dia).getDay()]}, ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')} às ${horario}`;
}

function textoPrazoSinal(expiraEm) {
  if (!expiraEm) return '';
  const d = new Date(expiraEm);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dd = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `Pague até ${mesmoDia ? 'hoje às' : dd + ' às'} ${hh}. Depois disso o horário é liberado.`;
}

function mensagemWhatsSinal() {
  const s = state.sinalAtual;
  const ag = s.agendamento;
  const servicos = (ag.servicos || []).map(x => x.nome).join(' + ');
  return `Olá! Fiz o Pix do sinal de ${formatarMoeda(s.valor)} do meu agendamento de ${textoDataHora(ag.dataChave, ag.horario)} (${servicos}), em nome de ${state.cliente.nome}. Pode confirmar, por favor?`;
}

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

function renderizarTelaSinal() {
  const s = state.sinalAtual;
  const ag = s.agendamento;
  const informado = s.status === 'sinal_informado';

  $('#sinal-selo').textContent = informado ? 'Aguardando confirmação' : 'Falta o sinal';
  $('#sinal-titulo').textContent = informado ? 'Pagamento informado!' : 'Pague o sinal para garantir o horário';
  $('#sinal-sub').textContent = informado
    ? 'Seu horário continua reservado até o estabelecimento conferir o Pix e confirmar.'
    : 'Copie o código Pix, pague no aplicativo do seu banco e depois toque em "Já paguei".';

  $('#resumo-sinal').innerHTML = `
    <div class="resumo-linha"><span class="label">Profissional</span><span class="valor">${escapeHtml(ag.profissionalNome || '')}</span></div>
    <div class="resumo-linha"><span class="label">Quando</span><span class="valor">${escapeHtml(textoDataHora(ag.dataChave, ag.horario))}</span></div>
    <div class="resumo-linha"><span class="label">Serviços</span><span class="valor">${(ag.servicos || []).map(x => escapeHtml(x.nome)).join(' + ')}</span></div>
    <div class="resumo-linha"><span class="label">Total do serviço</span><span class="valor">${formatarMoeda(ag.valorTotal)}</span></div>
  `;

  $('#sinal-valor').textContent = formatarMoeda(s.valor);
  $('#sinal-prazo').textContent = informado ? '' : textoPrazoSinal(s.expiraEm);
  $('#sinal-recebedor').innerHTML = s.recebedor
    ? `<div class="sinal-recebedor-nome">Quem recebe: <strong>${escapeHtml(s.recebedor)}</strong></div>
       ${s.banco ? `<div class="sinal-recebedor-nome">Instituição: <strong>${escapeHtml(s.banco)}</strong></div>` : ''}
       <div class="sinal-recebedor-dica">Antes de confirmar o Pix no seu banco, confira se este nome aparece como destinatário.</div>`
    : '';
  $('#sinal-pagamento').classList.toggle('hidden', informado);
  $('#sinal-informado').classList.toggle('hidden', !informado);
  $('#btn-ja-paguei').classList.toggle('hidden', informado);
  $('#btn-sinal-whats').classList.toggle('hidden', !informado || !telefoneParaWhatsapp(s.telefoneNegocio));

  const qr = $('#sinal-qr');
  qr.innerHTML = '';
  if (!informado) {
    const texto = s.pixCopiaECola;
    carregarQRCode().then(() => {
      if (state.sinalAtual && state.sinalAtual.pixCopiaECola !== texto) return;   // mudou de reserva enquanto baixava
      qr.innerHTML = '';
      new QRCode(qr, { text: texto, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    }).catch(() => { qr.textContent = 'QR Code indisponível. Use o código copia e cola.'; });
  }
}

async function copiarPix() {
  const texto = state.sinalAtual.pixCopiaECola;
  try {
    await navigator.clipboard.writeText(texto);
  } catch (_) {
    const t = document.createElement('textarea');
    t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) { /* sem permissão: o aviso abaixo orienta */ }
    document.body.removeChild(t);
  }
  toast('Código Pix copiado! Cole no app do seu banco.', 'sucesso');
}

// Um toque só: registra o "Já paguei" no sistema (o dono recebe o aviso) e abre o WhatsApp do
// estabelecimento com a mensagem pronta. O WhatsApp precisa ser aberto DENTRO do clique (senão o
// navegador bloqueia), então a chamada ao servidor segue em paralelo com keepalive.
async function handleJaPaguei() {
  const btn = $('#btn-ja-paguei');
  btn.disabled = true;
  btn.textContent = 'Registrando...';
  const s = state.sinalAtual;
  const fone = telefoneParaWhatsapp(s.telefoneNegocio);

  const chamada = fetch('/api/agendamento-cliente', {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: state.slug, whatsapp: state.cliente.whatsapp, action: 'sinal-informar', agendamentoId: s.agendamentoId })
  });
  if (fone) window.open(`https://wa.me/${fone}?text=${encodeURIComponent(mensagemWhatsSinal())}`, '_blank');

  try {
    const resp = await chamada;
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      toast(corpo.erro || 'Não consegui registrar o pagamento. Avise o estabelecimento pelo WhatsApp.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Já paguei';
      return;
    }
    s.status = 'sinal_informado';
    renderizarTelaSinal();
    toast('Pagamento informado! Aguarde a confirmação.', 'sucesso');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error('Erro ao informar pagamento:', err);
    toast('Sem conexão. Tente de novo ou avise pelo WhatsApp.', 'erro');
    btn.disabled = false;
    btn.textContent = 'Já paguei';
  }
}

async function abrirPagamentoSinal(agendamentoId) {
  try {
    const resp = await fetch('/api/agendamento-cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: state.slug, whatsapp: state.cliente.whatsapp, action: 'sinal-dados', agendamentoId })
    });
    const dados = await resp.json();
    if (!resp.ok) { toast(dados.erro || 'Não foi possível abrir o pagamento.', 'erro'); await carregarMeusAgendamentos(); return; }
    state.sinalAtual = { agendamentoId, ...dados };
    $('#btn-ja-paguei').disabled = false;
    $('#btn-ja-paguei').textContent = 'Já paguei';
    renderizarTelaSinal();
    mostrarTela(7);
  } catch (err) {
    console.error('Erro ao abrir pagamento do sinal:', err);
    toast('Erro ao abrir o pagamento. Tente novamente.', 'erro');
  }
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

async function resetarFluxo() {
  state.servicosSelecionados = [];
  state.profissionalId = null;
  state.dataSelecionada = null;
  state.horarioSelecionado = null;
  state.horariosCache = {};
  $('#btn-confirmar').disabled = false;
  $('#btn-confirmar').textContent = rotuloConfirmar();

  await carregarBarbearia(state.slug);          // serviços e horários ocupados atualizados (inclui o agendamento que acabou de ser feito)
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
  const labelStatus = { confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado', aguardando_sinal: 'Aguardando sinal', sinal_informado: 'Pagamento informado' };

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
        ${a.status === 'aguardando_sinal' ? `
          <div class="meu-ag-acoes">
            <button class="btn-outline btn-mini-full" data-acao="pagar" data-id="${a.id}" type="button">Pagar sinal (${formatarMoeda(a.sinalValor)})</button>
            <button class="btn-outline btn-mini-full btn-perigo-outline" data-acao="cancelar" data-id="${a.id}" type="button">Cancelar</button>
          </div>
          <div class="meu-ag-aviso">${escapeHtml(textoPrazoSinal(a.sinalExpiraEm))}</div>` : ''}
        ${a.status === 'sinal_informado' ? `
          <div class="meu-ag-acoes"><button class="btn-outline btn-mini-full" data-acao="pagar" data-id="${a.id}" type="button">Ver pagamento</button></div>
          <div class="meu-ag-aviso">Aguardando o estabelecimento confirmar o seu Pix.</div>` : ''}
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
  container.querySelectorAll('[data-acao="pagar"]').forEach(btn => {
    btn.addEventListener('click', () => abrirPagamentoSinal(btn.dataset.id));
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
    await recarregarAgendamentos();            // o horário cancelado já volta a ficar livre na grade
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
  // Mesma regra da tela de agendamento: só dias com horário livre (o próprio
  // horário atual do agendamento conta como livre, por causa do ignorarId).
  renderizarDatasComHorarios({
    container: $('#remarcar-seletor-data'),
    profissionaisIds: [state.remarcacao.profissionalId],
    opcoes: { duracaoTotalOverride: state.remarcacao.duracaoMin, ignorarId: state.remarcacao.agendamentoId },
    aoSelecionar: selecionarDataRemarcacao,
    mensagemVazia: 'Sem horários disponíveis nos próximos dias. Fale direto com o estabelecimento.'
  });
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
    mostrarPainelLista();                       // volta sozinho para "Seus agendamentos", já com o novo horário
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
