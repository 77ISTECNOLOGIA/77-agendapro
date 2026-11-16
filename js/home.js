// ========================================
// 77 AGENDAPRO — Tela inicial do AgendaPro (endereço sem o nome do estabelecimento)
// ========================================
// Mostra "Meus lugares" (os que o cliente já abriu neste aparelho) e a busca de estabelecimentos que escolheram aparecer
// (Configurações → "Aparecer na busca do AgendaPro"): por nome, bairro ou cidade, com filtro de estado e de tipo. Tocar num
// estabelecimento abre o link dele (/nome-do-estabelecimento), a mesma tela de agendamento de sempre.
import { escapeHtml } from './utils.js';
import { lerLugares, esquecerLugar } from './lugares.js';

const ROTULO_TIPO = { barbearia: 'Barbearia', salao: 'Salão', estetica: 'Estética', nails: 'Unhas', outro: 'Outro' };

const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Regra pura (testada): filtra e ordena. q = nome/bairro/cidade; uf e tipo = igualdade exata (vazio = todos)
export function filtrarLugares(lugares, { q = '', uf = '', tipo = '' } = {}) {
  const termo = normalizar(q);
  return (lugares || [])
    .filter((l) => (!uf || l.uf === uf) && (!tipo || l.tipo === tipo)
      && (!termo || normalizar([l.nome, l.bairro, l.cidade, l.uf].join(' ')).includes(termo)))
    .slice()
    .sort((a, b) => normalizar(a.nome).localeCompare(normalizar(b.nome)));
}

const iniciais = (nome) => String(nome || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const $ = (sel) => document.querySelector(sel);

function cartao(l, { remover = false } = {}) {
  const local = [l.bairro, l.cidade && l.uf ? l.cidade + ' - ' + l.uf : (l.cidade || l.uf)].filter(Boolean).join(', ');
  const sub = [local, ROTULO_TIPO[l.tipo]].filter(Boolean).join(' · ');
  return `<a class="lugar-card" href="/${encodeURIComponent(l.slug)}" data-slug="${escapeHtml(l.slug)}">
    <div class="lugar-logo" data-logo="${l.temLogo ? '1' : ''}">${escapeHtml(iniciais(l.nome))}</div>
    <div class="lugar-info"><div class="lugar-nome">${escapeHtml(l.nome)}</div>${sub ? `<div class="lugar-sub">${escapeHtml(sub)}</div>` : ''}</div>
    ${remover ? `<button type="button" class="lugar-x" data-esquecer="${escapeHtml(l.slug)}" aria-label="Tirar de Meus lugares">×</button>` : '<span class="lugar-seta" aria-hidden="true">›</span>'}
  </a>`;
}

// A logo não vem na lista (pesaria muito): cada cartão a busca depois, só se o estabelecimento tem logo
function carregarLogos(container) {
  container.querySelectorAll('.lugar-logo[data-logo="1"]').forEach(async (el) => {
    const slug = el.closest('.lugar-card').dataset.slug;
    try {
      const r = await fetch('/api/negocio?slug=' + encodeURIComponent(slug) + '&logo=1');
      if (!r.ok) return;
      const { logo } = await r.json();
      if (typeof logo === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(logo)) {
        el.textContent = '';
        const img = document.createElement('img');
        img.src = logo; img.alt = '';
        el.appendChild(img);
      }
    } catch (_) { /* fica com as iniciais */ }
  });
}

export async function iniciarHome() {
  document.title = 'AgendaPro — Encontre onde agendar';
  $('#home').classList.remove('hidden');
  let todos = [];
  const filtros = { q: '', uf: '', tipo: '' };

  const desenharMeus = () => {
    const meus = lerLugares();
    $('#home-meus').classList.toggle('hidden', meus.length === 0);
    $('#home-meus-lista').innerHTML = meus.map((l) => cartao(l, { remover: true })).join('');
    $('#home-meus-lista').querySelectorAll('[data-esquecer]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      esquecerLugar(b.dataset.esquecer);
      desenharMeus();
    }));
  };

  const desenharLista = () => {
    const lista = filtrarLugares(todos, filtros);
    const buscando = !!(filtros.q || filtros.uf || filtros.tipo);
    $('#home-titulo').textContent = buscando ? lista.length + ' resultado' + (lista.length === 1 ? '' : 's') : 'Onde agendar';
    $('#home-lista').innerHTML = lista.map((l) => cartao(l)).join('');
    $('#home-vazio').classList.toggle('hidden', lista.length > 0);
    $('#home-vazio').textContent = todos.length
      ? 'Nada encontrado com esses filtros. Tente outro nome, bairro ou cidade.'
      : 'Ainda não há estabelecimentos na busca. Se você tem o link de um, é só abri-lo.';
    carregarLogos($('#home-lista'));
  };

  const desenharFiltros = () => {
    const ufs = [...new Set(todos.map((l) => l.uf).filter(Boolean))].sort();
    $('#home-uf').innerHTML = '<option value="">Todos os estados</option>' + ufs.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
    const tipos = [...new Set(todos.map((l) => l.tipo).filter(Boolean))];
    $('#home-tipos').innerHTML = tipos.length > 1
      ? ['', ...tipos].map((t) => `<button type="button" class="home-chip${filtros.tipo === t ? ' ativo' : ''}" data-tipo="${escapeHtml(t)}">${t ? escapeHtml(ROTULO_TIPO[t] || t) : 'Todos'}</button>`).join('') : '';
    $('#home-tipos').querySelectorAll('.home-chip').forEach((b) => b.addEventListener('click', () => { filtros.tipo = b.dataset.tipo; desenharFiltros(); desenharLista(); }));
  };

  $('#home-q').addEventListener('input', (e) => { filtros.q = e.target.value; desenharLista(); });
  $('#home-uf').addEventListener('change', (e) => { filtros.uf = e.target.value; desenharLista(); });

  desenharMeus();
  try {
    const r = await fetch('/api/negocio?buscar=1');
    if (r.ok) todos = (await r.json()).lugares || [];
  } catch (_) { /* sem rede: mostra só Meus lugares */ }
  desenharFiltros();
  desenharLista();
}
