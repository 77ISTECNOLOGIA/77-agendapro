// Banco Firestore falso, em memória, com só o que as funções serverless usam.
// Não substitui o emulador real (que precisa de Java), mas permite testar a
// lógica das APIs — inclusive transações e a regra "leituras antes das escritas".

const path = require('node:path');

class Snap {
  constructor(ref, dado) { this.ref = ref; this.id = ref.id; this._d = dado; this.exists = dado !== undefined; }
  data() { return this._d === undefined ? undefined : structuredClone(this._d); }
}

class QuerySnap {
  constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
  forEach(fn) { this.docs.forEach(fn); }
}

class FakeDb {
  constructor() { this.docs = new Map(); this.seq = 0; }
  collection(p) { return new Col(this, p); }
  doc(p) { const i = p.lastIndexOf('/'); return new Doc(this, p.slice(0, i), p.slice(i + 1)); }
  async recursiveDelete(ref) {
    for (const k of [...this.docs.keys()]) if (k === ref.path || k.startsWith(ref.path + '/')) this.docs.delete(k);
  }
  seed(p, dado) { this.docs.set(p, structuredClone(dado)); return this; }
  get(p) { return this.docs.get(p); }
  async runTransaction(fn) {
    const tx = new Tx(this);
    const r = await fn(tx);
    tx.aplicar();
    return r;
  }
}

class Doc {
  constructor(db, colPath, id) { this.db = db; this.colPath = colPath; this.id = id; this.path = `${colPath}/${id}`; }
  async get() { return new Snap(this, this.db.docs.get(this.path)); }
  async set(d) { this.db.docs.set(this.path, structuredClone(d)); }
  async update(d) {
    if (!this.db.docs.has(this.path)) throw new Error(`update em doc inexistente: ${this.path}`);
    this.db.docs.set(this.path, { ...this.db.docs.get(this.path), ...structuredClone(d) });
  }
  async delete() { this.db.docs.delete(this.path); }
  collection(nome) { return new Col(this.db, `${this.path}/${nome}`); }
}

class Query {
  constructor(db, colPath, filtros = []) { this.db = db; this.colPath = colPath; this.filtros = filtros; }
  where(campo, op, valor) { return new Query(this.db, this.colPath, [...this.filtros, { campo, op, valor }]); }
  count() { const q = this; return { get: async () => { const n = (await q.get()).size; return { data: () => ({ count: n }) }; } }; }
  async get() {
    const docs = [];
    for (const [p, d] of this.db.docs) {
      if (!p.startsWith(this.colPath + '/')) continue;
      const resto = p.slice(this.colPath.length + 1);
      if (resto.includes('/')) continue;
      const ok = this.filtros.every(({ campo, op, valor }) => {
        const v = d[campo];
        if (op === '==') return v === valor;
        if (op === '>=') return v !== undefined && v >= valor;
        throw new Error(`operador não suportado no fake: ${op}`);
      });
      if (ok) docs.push(new Snap(new Doc(this.db, this.colPath, resto), d));
    }
    return new QuerySnap(docs);
  }
}

class Col extends Query {
  constructor(db, colPath) { super(db, colPath, []); }
  doc(id) { return new Doc(this.db, this.colPath, id || `auto${++this.db.seq}`); }
}

class Tx {
  constructor(db) { this.db = db; this.escritas = []; }
  async get(alvo) {
    if (this.escritas.length) throw new Error('Firestore: todas as leituras da transação devem vir antes das escritas');
    return alvo.get();
  }
  set(ref, d) { this.escritas.push(() => ref.set(d)); return this; }
  update(ref, d) { this.escritas.push(() => ref.update(d)); return this; }
  aplicar() { this.escritas.forEach(fn => fn()); }
}

function montarAmbiente() {
  const fake = new FakeDb();
  const notificacoes = [];
  const tokensInvalidos = new Set();
  const authRemovidos = new Set();
  const fakeFirebase = {
    db: () => fake,
    auth: () => ({
      verifyIdToken: async (t) => {
        if (!String(t).startsWith('tok-')) { const e = new Error('inválido'); e.code = 'auth/argument-error'; throw e; }
        return { uid: t.slice(4), email: `${t.slice(4)}@teste.com` };
      },
      createUser: async ({ email }) => ({ uid: `uid-${email}` }),
      deleteUser: async (uid) => { if (uid === 'uid-inexistente') { const e = new Error('x'); e.code = 'auth/user-not-found'; throw e; } authRemovidos.add(uid); }
    }),
    messaging: () => ({
      send: async (m) => {
        if (tokensInvalidos.has(m.token)) { const e = new Error('x'); e.code = 'messaging/registration-token-not-registered'; throw e; }
        notificacoes.push(m);
      }
    }),
    FieldValue: {}
  };
  const caminho = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'firebase.js'));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: fakeFirebase };
  return { fake, notificacoes, tokensInvalidos, authRemovidos };
}

function req(metodo, { body, query, ip = '1.1.1.1' } = {}) {
  return { method: metodo, body, query, headers: { 'x-forwarded-for': ip } };
}

function res() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; }
  };
}

// Data daqui a N dias, no fuso de São Paulo (mesma base que as APIs usam)
function dataEmDias(n) {
  const { hojeChaveBrasil, somarDias } = require('../api/_lib/tempo');
  return somarDias(hojeChaveBrasil(), n);
}

const SEMANA_ABERTA = Object.fromEntries(
  ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
    .map(d => [d, { ativo: true, inicio: '09:00', fim: '19:00' }])
);

// Negócio padrão: 1 profissional, 2 serviços, aprovado
function semearNegocio(fake, slug = 'barbearia-teste', extra = {}) {
  fake.seed(`barbearias/${slug}`, {
    nome: 'Barbearia Teste', tipoNegocio: 'barbearia', telefone: '5521999990000', endereco: 'Rua A',
    status: 'ativa', plano: 'mensal', horarioFuncionamento: SEMANA_ABERTA, ...extra
  });
  fake.seed(`barbearias/${slug}/profissionais/prof1`, { nome: 'João Silva', especialidade: 'Barbeiro', ativo: true, comissao: 40 });
  fake.seed(`barbearias/${slug}/servicos/srv1`, { nome: 'Corte', duracaoMin: 30, preco: 40, emoji: '✂️', ativo: true, ordem: 1 });
  fake.seed(`barbearias/${slug}/servicos/srv2`, { nome: 'Barba', duracaoMin: 30, preco: 35, emoji: '🪒', ativo: true, ordem: 2 });
  return slug;
}

module.exports = { FakeDb, montarAmbiente, req, res, dataEmDias, semearNegocio, SEMANA_ABERTA };
