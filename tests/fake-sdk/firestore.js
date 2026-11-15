// SDK de MENTIRA do Firestore — fala com o banco falso do servidor de teste (tests/dev-local.js) por /__fs.
// onSnapshot é feito por consulta repetida (a cada 700 ms) e só chama o callback quando algo mudou.
// NÃO aplica as regras de segurança (elas têm teste próprio: npm run test:regras).

export function initializeFirestore() { return { __fake: true }; }
export function getFirestore() { return { __fake: true }; }

const ehRef = (x) => x && (x.__tipo === 'doc' || x.__tipo === 'col');
let seq = 0;
const novoId = () => 'n' + Date.now().toString(36) + (seq++).toString(36);

export function collection(pai, ...seg) {
  const base = ehRef(pai) ? pai.path.split('/') : [];
  return { __tipo: 'col', path: [...base, ...seg].join('/'), id: seg[seg.length - 1] };
}
export function doc(pai, ...seg) {
  if (ehRef(pai) && pai.__tipo === 'col' && seg.length === 0) return { __tipo: 'doc', path: pai.path + '/' + novoId(), id: undefined, __auto: true };
  const base = ehRef(pai) ? pai.path.split('/') : [];
  const caminho = [...base, ...seg].join('/');
  return { __tipo: 'doc', path: caminho, id: caminho.split('/').pop() };
}
doc.__ = null;
export function where(campo, op, valor) { return { campo, op, valor }; }
export function orderBy(campo, dir = 'asc') { return { __ord: [campo, dir] }; }
export function limit(n) { return { __lim: n }; }
export function query(col, ...restr) {
  return { __tipo: 'query', path: col.path, filtros: restr.filter((r) => r.campo), ord: (restr.find((r) => r.__ord) || {}).__ord, lim: (restr.find((r) => r.__lim) || {}).__lim };
}

function quemSou() { try { return (JSON.parse(localStorage.getItem('fake_user') || 'null') || {}).uid || null; } catch (_) { return null; } }
async function fs(corpo) {
  const r = await fetch('/__fs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...corpo, uid: quemSou() }) });
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.erro || 'erro'); e.code = j.code || 'unavailable'; throw e; }
  return j;
}
const snapDoc = (caminho, dado) => ({ id: caminho.split('/').pop(), ref: { path: caminho }, exists: () => dado !== null && dado !== undefined, data: () => (dado === null || dado === undefined ? undefined : JSON.parse(JSON.stringify(dado))) });
const snapLista = (docs) => ({ docs, size: docs.length, empty: docs.length === 0, forEach: (f) => docs.forEach(f) });
const listar = async (alvo) => snapLista((await fs({ op: 'list', path: alvo.path, filtros: alvo.filtros || [], ord: alvo.ord, lim: alvo.lim })).docs.map((d) => snapDoc(d.path, d.data)));

export async function getDoc(ref) { return snapDoc(ref.path, (await fs({ op: 'get', path: ref.path })).data); }
export async function getDocs(alvo) { return listar(alvo); }
export async function setDoc(ref, data) { await fs({ op: 'set', path: ref.path, data }); }
export async function updateDoc(ref, data) { await fs({ op: 'update', path: ref.path, data }); }
export async function deleteDoc(ref) { await fs({ op: 'delete', path: ref.path }); }
export async function addDoc(col, data) { const id = novoId(); await fs({ op: 'set', path: col.path + '/' + id, data }); return { id, path: col.path + '/' + id }; }
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data) => ops.push({ op: 'set', path: ref.path, data }),
    update: (ref, data) => ops.push({ op: 'update', path: ref.path, data }),
    delete: (ref) => ops.push({ op: 'delete', path: ref.path }),
    commit: async () => { for (const o of ops) await fs(o); }
  };
}
export function onSnapshot(alvo, cb, erro) {
  let ativo = true, ultima = null;
  const ehDoc = alvo.__tipo === 'doc';
  const rodar = async () => {
    if (!ativo) return;
    try {
      const novo = ehDoc ? snapDoc(alvo.path, (await fs({ op: 'get', path: alvo.path })).data) : await listar(alvo);
      const chave = JSON.stringify(ehDoc ? novo.data() ?? null : novo.docs.map((d) => [d.id, d.data()]));
      if (ativo && chave !== ultima) { ultima = chave; cb(novo); }
    } catch (e) { if (ativo && erro) erro(e); }
    if (ativo) setTimeout(rodar, 700);
  };
  rodar();
  return () => { ativo = false; };
}
export async function getCountFromServer(alvo) { const n = (await listar(alvo)).size; return { data: () => ({ count: n }) }; }
