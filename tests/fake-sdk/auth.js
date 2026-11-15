// SDK de MENTIRA do Firebase Auth — o servidor de teste (tests/dev-local.js) guarda as contas e confere a senha.
const ouvintes = [];
let usuario = null;
try { usuario = JSON.parse(localStorage.getItem('fake_user') || 'null'); } catch (_) { usuario = null; }

const montar = (d) => ({ uid: d.uid, email: d.email, getIdToken: async () => 'tok-' + d.uid });
const atual = () => (usuario ? montar(usuario) : null);
const avisar = () => ouvintes.forEach((f) => setTimeout(() => f(atual()), 0));
async function chamar(rota, corpo) {
  const r = await fetch('/__auth/' + rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.code || 'erro'); e.code = j.code || 'auth/internal-error'; throw e; }
  return j;
}
const auth = { get currentUser() { return atual(); } };

export function getAuth() { return auth; }
export function onAuthStateChanged(_a, cb) { ouvintes.push(cb); setTimeout(() => cb(atual()), 0); return () => {}; }
export async function signInWithEmailAndPassword(_a, email, senha) {
  usuario = await chamar('entrar', { email, senha });
  localStorage.setItem('fake_user', JSON.stringify(usuario)); avisar();
  return { user: atual() };
}
export async function createUserWithEmailAndPassword(_a, email, senha) {
  usuario = await chamar('criar', { email, senha });
  localStorage.setItem('fake_user', JSON.stringify(usuario)); avisar();
  return { user: atual() };
}
export async function signOut() { usuario = null; localStorage.removeItem('fake_user'); avisar(); }
export async function sendPasswordResetEmail() { return true; }
