// ========================================
// 77 AGENDAPRO — Convite para instalar o app (link do cliente)
// ========================================
// Cartão no topo do link do cliente: "Instalar <Negócio>". Android/Chrome: botão que abre a instalação do sistema.
// iPhone/iPad: o Safari não deixa um site instalar sozinho, então o cartão ensina o caminho (Compartilhar → Adicionar à Tela de Início).
// Computador e navegadores sem suporte: nada aparece. Quem já abriu pelo ícone da tela inicial também não vê nada.
import { ehAppleMobile } from './utils.js';

const DIAS_DISPENSA = 7;        // "X" no cartão: some por 7 dias
const DIAS_DISPENSA_SUCESSO = 3; // depois de agendar o convite volta (é a hora em que o cliente mais quer lembrete), mas respeita um X recente

// Regra pura (testada): decide se e qual convite mostrar.
//  entrada: { standalone, apple, android, instalado, dispensadoEm (ms|null), agora (ms), contexto: 'topo'|'sucesso' }
//  saída:   null | 'ios' | 'android'
export function decidirConvite({ standalone, apple, android, instalado, dispensadoEm, agora, contexto = 'topo' }) {
  if (standalone || instalado) return null;
  const tipo = apple ? 'ios' : (android ? 'android' : null);
  if (!tipo) return null;
  const dias = contexto === 'sucesso' ? DIAS_DISPENSA_SUCESSO : DIAS_DISPENSA;
  if (dispensadoEm && agora - dispensadoEm < dias * 86400000) return null;
  return tipo;
}

function guardar(chave, valor) { try { localStorage.setItem(chave, String(valor)); } catch (_) { /* sem armazenamento: ok */ } }
function ler(chave) { try { return localStorage.getItem(chave); } catch (_) { return null; } }

export function jaEstaInstalado() {
  try {
    return (typeof navigator !== 'undefined' && navigator.standalone === true) ||
      (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  } catch (_) { return false; }
}

let eventoInstalacao = null;       // Android/Chrome entrega isto quando o app é instalável
let ctx = { slug: '', nome: '' };

const ICONE_COMPARTILHAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const ICONE_BAIXAR = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

function escapar(t) { return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function montar(tipo, contexto) {
  const el = document.getElementById('banner-instalar');
  if (!el) return;
  const nome = escapar(ctx.nome || 'este app');
  const titulo = contexto === 'sucesso' ? 'Receba o lembrete do seu horário' : `Instalar ${nome}`;
  const texto = tipo === 'ios'
    ? `Toque em ${ICONE_COMPARTILHAR} na barra do Safari e depois em <strong>Adicionar à Tela de Início</strong>.`
    : 'Acesse com um toque, sem digitar o link, e agende mais rápido.';
  el.innerHTML = `
    <div class="bi-icone">${ICONE_BAIXAR}</div>
    <div class="bi-texto"><div class="bi-titulo">${titulo}</div><div class="bi-sub">${texto}</div>
      ${tipo === 'android' ? '<button type="button" class="bi-botao" id="bi-instalar">Instalar</button>' : ''}
    </div>
    <button type="button" class="bi-fechar" id="bi-fechar" aria-label="Fechar">×</button>`;
  el.classList.remove('hidden');
  el.querySelector('#bi-fechar').addEventListener('click', () => { guardar('ap_inst_x_' + ctx.slug, Date.now()); el.classList.add('hidden'); });
  const botao = el.querySelector('#bi-instalar');
  if (botao) botao.addEventListener('click', async () => {
    if (!eventoInstalacao) return;
    try { eventoInstalacao.prompt(); await eventoInstalacao.userChoice; } catch (_) { /* cancelou */ }
    eventoInstalacao = null;
    el.classList.add('hidden');
  });
}

// contexto 'topo' (abertura) ou 'sucesso' (depois de agendar). Chame de novo para reavaliar.
export function mostrarConvite(contexto = 'topo') {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const tipo = decidirConvite({
    standalone: jaEstaInstalado(),
    apple: ehAppleMobile(nav),
    android: /Android/i.test(String(nav.userAgent || '')) && !!eventoInstalacao,
    instalado: false,        // NÃO guardar "já instalou" para sempre: quem apaga o ícone precisa poder instalar de novo (o Chrome só oferece se não estiver instalado)
    dispensadoEm: Number(ler('ap_inst_x_' + ctx.slug)) || null,
    agora: Date.now(),
    contexto
  });
  const el = typeof document !== 'undefined' ? document.getElementById('banner-instalar') : null;
  if (!tipo) { if (el) el.classList.add('hidden'); return; }
  montar(tipo, contexto);
}

// Chamar uma vez quando o negócio carregou: aponta o manifesto do negócio (nome e link próprios) e escuta o evento de instalação.
export function iniciarInstalacao({ slug, nome, nomeIcone }) {
  ctx = { slug, nome };
  // iPhone ignora o manifesto e usa este título como nome do ícone na Tela de Início
  if (nomeIcone) {
    let meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'apple-mobile-web-app-title'; document.head.appendChild(meta); }
    meta.content = nomeIcone;
  }
  if (jaEstaInstalado()) return;
  const link = document.getElementById('manifest-link');
  if (link) link.href = '/api/negocio?slug=' + encodeURIComponent(slug) + '&manifest=1';
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); eventoInstalacao = e; mostrarConvite('topo'); });
  window.addEventListener('appinstalled', () => { eventoInstalacao = null; const el = document.getElementById('banner-instalar'); if (el) el.classList.add('hidden'); });
  mostrarConvite('topo');                // iPhone: não há evento, o cartão ensinando aparece direto
}
