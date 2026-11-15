// Servidor local de teste: serve o site estático + as funções de /api/* com um
// Firestore FALSO em memória. Não toca em produção nem precisa de credenciais.
// Cobre o fluxo público do cliente (agendar, ver/cancelar/remarcar). Painéis
// (/admin, /painel77) e /cadastro precisam do Firebase Authentication real.
//
//   node tests/dev-local.js        → http://localhost:3000/barbearia-do-joao

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { montarAmbiente, semearNegocio, dataEmDias } = require('./_helpers');

const { fake } = montarAmbiente();
const RAIZ = path.join(__dirname, '..');
const PORTA = Number(process.env.PORT) || 3000;

semearNegocio(fake, 'barbearia-do-joao', { nome: 'Barbearia do João' });
fake.seed('barbearias/barbearia-do-joao/profissionais/prof2', { nome: 'Carlos Lima', especialidade: 'Barbeiro', ativo: true, comissao: 35 });
fake.seed('barbearias/barbearia-do-joao/servicos/srv3', { nome: 'Corte + Barba', duracaoMin: 60, preco: 65, emoji: '💈', ativo: true, ordem: 3 });
fake.seed('barbearias/barbearia-do-joao/servicos/srv1', { ...fake.get('barbearias/barbearia-do-joao/servicos/srv1'), precosProfissional: { prof2: { preco: 55, duracaoMin: 45 } } });   // Carlos cobra mais e demora mais no Corte
semearNegocio(fake, 'barbearia-solo', { nome: 'Barbearia Solo' });   // um só profissional: o link pula a escolha do profissional
// ---- Painéis (admin/convite) com SDK de mentira (tests/fake-sdk): logins de teste, senha "senha123"
//   dono1@teste.com  → dono (acesso total, conta antiga)           socio1@teste.com → só vê o profissional Carlos (prof2)
//   gerente1@teste.com → gerencia o negócio e vê só o profissional João (prof1)
const CONTAS = { 'dono1@teste.com': 'dono1', 'socio1@teste.com': 'socio1', 'gerente1@teste.com': 'gerente1', 'adm1@teste.com': 'adm1' };
fake.seed('admins77/adm1', { role: 'super_admin', nome: 'Admin 77', email: 'adm1@teste.com' });   // adm1@teste.com → painel interno da 77 IS (/painel77)
fake.seed('usuarios/dono1', { barbeariaId: 'barbearia-do-joao', role: 'owner', nome: 'Dono Teste', email: 'dono1@teste.com' });
fake.seed('usuarios/socio1', { barbeariaId: 'barbearia-do-joao', role: 'profissional', profissionalId: 'prof2', nome: 'Carlos Lima', email: 'socio1@teste.com', permissoes: { verTodos: false, gerirNegocio: false } });
fake.seed('usuarios/gerente1', { barbeariaId: 'barbearia-do-joao', role: 'profissional', profissionalId: 'prof1', nome: 'João Silva', email: 'gerente1@teste.com', permissoes: { verTodos: false, gerirNegocio: true } });
const AG = (prof, nome, whats, dias, hora, servicos, valor, dur, status = 'confirmado') => ({ clienteNome: nome, clienteWhatsapp: whats, profissionalId: prof, profissionalNome: prof === 'prof1' ? 'João Silva' : 'Carlos Lima', servicos, dataChave: dataEmDias(dias), horario: hora, duracaoMin: dur, valorTotal: valor, status, criadoEm: new Date().toISOString(), origem: 'cliente' });
fake.seed('barbearias/barbearia-do-joao/agendamentos/t1', AG('prof1', 'Maria do João', '5521999990001', 0, '16:00', [{ id: 'srv1', nome: 'Corte', preco: 40, duracaoMin: 30 }], 40, 30));
fake.seed('barbearias/barbearia-do-joao/agendamentos/t2', AG('prof2', 'Pedro do Carlos', '5521999990002', 0, '17:00', [{ id: 'srv1', nome: 'Corte', preco: 55, duracaoMin: 45 }], 55, 45));
fake.seed('barbearias/barbearia-do-joao/agendamentos/t3', AG('prof2', 'Ana do Carlos', '5521999990003', -1, '10:00', [{ id: 'srv2', nome: 'Barba', preco: 35, duracaoMin: 30 }], 35, 30, 'concluido'));
fake.seed('barbearias/barbearia-do-joao/agendamentos/t4', AG('prof1', 'Antigo do João', '5521999990009', -20, '11:00', [{ id: 'srv1', nome: 'Corte', preco: 40, duracaoMin: 30 }], 40, 30, 'concluido'));   // fora da janela de 7 dias
fake.seed('barbearias/barbearia-do-joao/agendamentos/t5', AG('prof2', 'Antigo do Carlos', '5521999990010', -40, '15:00', [{ id: 'srv2', nome: 'Barba', preco: 35, duracaoMin: 30 }], 35, 30, 'concluido'));
fake.seed('barbearias/barbearia-do-joao/clientes/5521999990001', { nome: 'Maria do João', whatsapp: '5521999990001', totalAgendamentos: 3 });
fake.seed('barbearias/barbearia-do-joao/clientes/5521999990002', { nome: 'Pedro do Carlos', whatsapp: '5521999990002', totalAgendamentos: 1 });
semearNegocio(fake, 'trial-vencido', { nome: 'Salão Trial Vencido', status: 'trial', trialFim: '2020-01-01T00:00:00.000Z' });
semearNegocio(fake, 'estudio-suspenso', { nome: 'Estúdio Suspenso', status: 'suspensa' });

const FAKE_SDK = path.join(__dirname, 'fake-sdk');
const reescreverImports = (texto) => texto.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-(app|auth|firestore|messaging)\.js/g, '/__fake/$1.js');
const json = (res, status, corpo) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(corpo)); };

const { permitir } = require('./regras-lite');
const NEGACOES = [];
const LEITURAS = { total: 0, porCaminho: {} };   // quanto o Firestore cobraria pelas leituras das telas (GET /__leituras, ?zerar=1)
const contar = (caminho, n) => { LEITURAS.total += n; LEITURAS.porCaminho[caminho] = (LEITURAS.porCaminho[caminho] || 0) + n; };
async function bancoFalso(req, res, corpo) {
  try {
    const { op, path: p, data, filtros, ord, lim, uid } = corpo;
    const motivo = await permitir(fake, uid, { op, path: p, data, filtros });   // regras simplificadas (tests/regras-lite.js)
    if (motivo) {
      NEGACOES.push({ quando: new Date().toISOString(), uid, op, path: p, motivo });
      console.log('REGRA NEGOU (' + (uid || 'sem login') + '): ' + op + ' ' + p + ' — ' + motivo);
      return json(res, 403, { erro: 'Missing or insufficient permissions.', code: 'permission-denied' });
    }
    if (op === 'get') { if (!corpo.poll) contar(p.split('/').slice(0, 3).join('/'), 1); return json(res, 200, { data: (await fake.doc(p).get()).data() ?? null }); }
    if (op === 'list') {
      let q = fake.collection(p);
      (filtros || []).forEach((f) => { q = q.where(f.campo, f.op, f.valor); });
      const snap = await q.get();
      let docs = snap.docs.map((d) => ({ path: d.ref.path, data: d.data() }));
      if (ord) docs.sort((a, b) => ((a.data[ord[0]] > b.data[ord[0]]) - (a.data[ord[0]] < b.data[ord[0]])) * (ord[1] === 'desc' ? -1 : 1));
      if (lim) docs = docs.slice(0, lim);
      if (!corpo.poll) contar(p, Math.max(1, docs.length));
      return json(res, 200, { docs });
    }
    if (op === 'set') { await fake.doc(p).set(data); return json(res, 200, {}); }
    if (op === 'update') { await fake.doc(p).update(data); return json(res, 200, {}); }
    if (op === 'delete') { await fake.doc(p).delete(); return json(res, 200, {}); }
    return json(res, 400, { erro: 'op' });
  } catch (e) { return json(res, 500, { erro: e.message }); }
}

function authFalso(rota, corpo, res) {
  const email = String(corpo.email || '').toLowerCase();
  if (rota === 'entrar') {
    const uid = CONTAS[email];
    if (!uid || corpo.senha !== 'senha123') return json(res, 400, { code: 'auth/invalid-credential' });
    return json(res, 200, { uid, email });
  }
  if (rota === 'criar') {                              // conta nova: uid = parte antes do @ (a verificação de teste usa uid@teste.com)
    const uid = email.split('@')[0];
    if (CONTAS[email]) return json(res, 400, { code: 'auth/email-already-in-use' });
    if (String(corpo.senha || '').length < 6) return json(res, 400, { code: 'auth/weak-password' });
    CONTAS[email] = uid;
    return json(res, 200, { uid, email });
  }
  return json(res, 404, {});
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function lerCorpo(req) {
  return new Promise((ok) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (_) { ok({}); } });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/__negacoes') return json(res, 200, NEGACOES);
  if (url.pathname === '/__leituras') { const r = JSON.parse(JSON.stringify(LEITURAS)); if (url.searchParams.get('zerar')) { LEITURAS.total = 0; LEITURAS.porCaminho = {}; } return json(res, 200, r); }
  if (url.pathname === '/__fs' && req.method === 'POST') return bancoFalso(req, res, await lerCorpo(req));
  if (url.pathname.startsWith('/__auth/') && req.method === 'POST') return authFalso(url.pathname.slice(8), await lerCorpo(req), res);
  if (url.pathname.startsWith('/__fake/')) {
    const f = path.join(FAKE_SDK, path.basename(url.pathname));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    return res.end(fs.readFileSync(f));
  }

  if (url.pathname.startsWith('/api/')) {
    const nome = url.pathname.slice(5);
    const arquivo = path.join(RAIZ, 'api', `${nome}.js`);
    if (nome.includes('/') || nome.startsWith('_') || !fs.existsSync(arquivo)) { res.writeHead(404); return res.end('{}'); }
    const fReq = { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body: await lerCorpo(req) };
    const fRes = {
      setHeader: (k, v) => res.setHeader(k, v),
      status(n) { res.statusCode = n; return this; },
      json(b) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); }
    };
    return require(arquivo)(fReq, fRes);
  }

  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  let arquivo = path.join(RAIZ, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!path.extname(arquivo)) {                       // /{slug}, /admin, /cadastro...
    const mapa = { '/admin': 'admin.html', '/painel77': 'painel77.html', '/cadastro': 'cadastro.html', '/convite': 'convite.html' };
    arquivo = path.join(RAIZ, mapa[url.pathname] || 'index.html');
  }
  if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) { res.writeHead(404); return res.end('não encontrado'); }
  const ext = path.extname(arquivo);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  if (ext === '.js' || ext === '.html') return res.end(reescreverImports(fs.readFileSync(arquivo, 'utf8')));   // os painéis falam com o SDK de mentira
  fs.createReadStream(arquivo).pipe(res);
}).listen(PORTA, () => {
  console.log(`Teste local em http://localhost:${PORTA}/barbearia-do-joao`);
  console.log('Também: /trial-vencido (trial acabou há mais de 7 dias) e /estudio-suspenso (suspenso)');
});
