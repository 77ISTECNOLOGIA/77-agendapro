// ========================================
// 77 AGENDAPRO — "Meus lugares": estabelecimentos que o cliente já abriu neste aparelho
// ========================================
// Guardado só no aparelho (localStorage), sem ir para o servidor: não expõe onde a pessoa agenda. Cada vez que o cliente abre o
// link de um estabelecimento, ele entra (ou sobe) na lista; a tela inicial do AgendaPro (js/home.js) mostra essa lista.

const CHAVE = 'ap_lugares';
const MAXIMO = 12;

export function lerLugares() {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE) || '[]');
    return Array.isArray(lista) ? lista.filter((l) => l && typeof l.slug === 'string' && typeof l.nome === 'string') : [];
  } catch (_) { return []; }
}

function gravar(lista) { try { localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, MAXIMO))); } catch (_) { /* sem armazenamento: ok */ } }

/** Registra (ou sobe para o topo) um estabelecimento. */
export function registrarLugar({ slug, nome, tipo }) {
  if (!slug || !nome) return;
  const outros = lerLugares().filter((l) => l.slug !== slug);
  gravar([{ slug, nome: String(nome).slice(0, 80), tipo: tipo || 'barbearia', em: Date.now() }, ...outros]);
}

export function esquecerLugar(slug) { gravar(lerLugares().filter((l) => l.slug !== slug)); }
