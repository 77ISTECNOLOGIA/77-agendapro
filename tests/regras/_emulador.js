// ========================================
// Testes das REGRAS do Firestore (firestore.rules) contra o emulador oficial do Firebase
// ========================================
// Rode com:  npm run test:regras   (precisa do Java; o Firebase baixa o emulador sozinho na 1ª vez)
// Não usa biblioteca extra: fala com o emulador pela API REST, mandando um token de login "de mentira"
// (sem assinatura, que o emulador aceita) para o Firestore enxergar request.auth.uid. O token "owner" ignora as
// regras e serve só para preparar os dados do teste.

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
const PROJETO = process.env.GCLOUD_PROJECT || 'demo-agendapro';
const BASE = `http://${HOST}/v1/projects/${PROJETO}/databases/(default)/documents`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Token de usuário logado (uid) aceito pelo emulador. uid = null → visitante sem login. */
function token(uid) {
  if (!uid) return null;
  const agora = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO, auth_time: agora, user_id: uid, sub: uid,
    iat: agora, exp: agora + 3600, firebase: { identities: {}, sign_in_provider: 'password' }
  }) + '.';
}

// ---- JavaScript <-> formato de valores do Firestore (REST)
function valor(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  if (typeof v === 'object') return { mapValue: { fields: campos(v) } };
  throw new Error('tipo não suportado: ' + typeof v);
}
function campos(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, valor(v)])); }

async function chamar(metodo, url, uid, corpo) {
  const cab = { 'Content-Type': 'application/json' };
  const t = uid === 'owner' ? 'owner' : token(uid);
  if (t) cab.Authorization = 'Bearer ' + t;
  const resp = await fetch(url, { method: metodo, headers: cab, body: corpo ? JSON.stringify(corpo) : undefined });
  let json = null;
  try { json = await resp.json(); } catch (_) { /* sem corpo */ }
  const erro = Array.isArray(json) ? (json.find((x) => x && x.error) || {}).error : (json && json.error);
  const negado = resp.status === 403 || (erro && (erro.code === 403 || erro.status === 'PERMISSION_DENIED'));
  return { status: resp.status, negado: !!negado, permitido: resp.ok && !negado, json };
}

const caminho = (p) => encodeURI(p);

/** API usada pelos testes. `uid`: string (logado), null (visitante) ou 'owner' (ignora regras: só para preparar dados). */
const fs = {
  semear: (path, dados) => chamar('PATCH', `${BASE}/${caminho(path)}`, 'owner', { fields: campos(dados) }),
  ler: (path, uid) => chamar('GET', `${BASE}/${caminho(path)}`, uid),
  listar: (colecao, uid) => chamar('GET', `${BASE}/${caminho(colecao)}?pageSize=50`, uid),
  consultar: (pai, colecao, filtros, uid) => {
    const onde = filtros.length ? { compositeFilter: { op: 'AND', filters: filtros.map(([campo, valorFiltro]) => ({ fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: valor(valorFiltro) } })) } } : undefined;
    const url = pai ? `${BASE}/${caminho(pai)}:runQuery` : `${BASE}:runQuery`;
    return chamar('POST', url, uid, { structuredQuery: { from: [{ collectionId: colecao }], ...(onde ? { where: onde } : {}) } });
  },
  criar: (colecao, id, dados, uid) => chamar('POST', `${BASE}/${caminho(colecao)}?documentId=${encodeURIComponent(id)}`, uid, { fields: campos(dados) }),
  substituir: (path, dados, uid) => chamar('PATCH', `${BASE}/${caminho(path)}`, uid, { fields: campos(dados) }),
  atualizar: (path, parciais, uid) => {
    const mascara = Object.keys(parciais).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    return chamar('PATCH', `${BASE}/${caminho(path)}?${mascara}&currentDocument.exists=true`, uid, { fields: campos(parciais) });
  },
  apagar: (path, uid) => chamar('DELETE', `${BASE}/${caminho(path)}`, uid),
  limpar: () => fetch(`http://${HOST}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: 'DELETE' })
};

async function emulatorNoAr() {
  try { const r = await fetch(`http://${HOST}/`); return r.ok; } catch (_) { return false; }
}

module.exports = { fs, emulatorNoAr, token, HOST, PROJETO };
