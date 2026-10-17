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
const { montarAmbiente, semearNegocio } = require('./_helpers');

const { fake } = montarAmbiente();
const RAIZ = path.join(__dirname, '..');
const PORTA = Number(process.env.PORT) || 3000;

semearNegocio(fake, 'barbearia-do-joao', { nome: 'Barbearia do João' });
fake.seed('barbearias/barbearia-do-joao/profissionais/prof2', { nome: 'Carlos Lima', especialidade: 'Barbeiro', ativo: true, comissao: 35 });
fake.seed('barbearias/barbearia-do-joao/servicos/srv3', { nome: 'Corte + Barba', duracaoMin: 60, preco: 65, emoji: '💈', ativo: true, ordem: 3 });
semearNegocio(fake, 'trial-vencido', { nome: 'Salão Trial Vencido', status: 'trial', trialFim: '2020-01-01T00:00:00.000Z' });
semearNegocio(fake, 'estudio-suspenso', { nome: 'Estúdio Suspenso', status: 'suspensa' });

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
    const mapa = { '/admin': 'admin.html', '/painel77': 'painel77.html', '/cadastro': 'cadastro.html' };
    arquivo = path.join(RAIZ, mapa[url.pathname] || 'index.html');
  }
  if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) { res.writeHead(404); return res.end('não encontrado'); }
  res.setHeader('Content-Type', MIME[path.extname(arquivo)] || 'application/octet-stream');
  fs.createReadStream(arquivo).pipe(res);
}).listen(PORTA, () => {
  console.log(`Teste local em http://localhost:${PORTA}/barbearia-do-joao`);
  console.log('Também: /trial-vencido (trial acabou há mais de 7 dias) e /estudio-suspenso (suspenso)');
});
