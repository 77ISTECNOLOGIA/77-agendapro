// Notificação de teste (api/testar-notificacao.js) e service worker (firebase-messaging-sw.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { montarAmbiente, req, res, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const testar = require('../api/testar-notificacao');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';

async function chamar(corpo, ip) {
  const r = res();
  await testar(req('POST', { body: corpo, ip }), r);
  return r;
}

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  amb.notificacoes.length = 0;
  amb.tokensInvalidos.clear();
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner' });
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/notebook`, { token: 'tok-notebook', aparelho: 'Windows · Chrome' });
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/iphone`, { token: 'tok-iphone', aparelho: 'iPhone · Safari (app)' });
  // outro negócio, com aparelho próprio, que NÃO pode receber o teste
  semearNegocio(amb.fake, 'outra-barbearia');
  amb.fake.seed('barbearias/outra-barbearia/dispositivos/x', { token: 'tok-do-outro' });
});

test('teste: envia para TODOS os aparelhos do dono (e só os dele)', async () => {
  const r = await chamar({ idToken: 'tok-dono1' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual({ total: r.body.total, enviadas: r.body.enviadas, removidos: r.body.removidos }, { total: 2, enviadas: 2, removidos: 0 });
  assert.deepEqual(amb.notificacoes.map((n) => n.token).sort(), ['tok-iphone', 'tok-notebook']);
  assert.ok(!amb.notificacoes.some((n) => n.token === 'tok-do-outro'), 'não vaza pra aparelho de outro negócio');
});

test('teste: a mensagem identifica que é um teste, tem tag própria e link pro painel', async () => {
  await chamar({ idToken: 'tok-dono1' });
  const m = amb.notificacoes[0];
  assert.match(m.notification.title, /teste/i);
  assert.match(m.webpush.notification.tag, /^teste-\d+$/);
  assert.equal(m.data.tag, m.webpush.notification.tag);
  assert.match(m.webpush.fcmOptions.link, /^https:\/\/.+\/admin$/);
});

test('teste: aparelho com token vencido é removido e o resultado diz isso', async () => {
  amb.tokensInvalidos.add('tok-iphone');
  const r = await chamar({ idToken: 'tok-dono1' });
  assert.equal(r.body.enviadas, 1);
  assert.equal(r.body.removidos, 1);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/dispositivos/iphone`), undefined);
  assert.ok(amb.fake.get(`barbearias/${SLUG}/dispositivos/notebook`));
});

test('teste: sem nenhum aparelho registrado devolve total 0 (a tela orienta a ativar)', async () => {
  amb.fake.docs.delete(`barbearias/${SLUG}/dispositivos/notebook`);
  amb.fake.docs.delete(`barbearias/${SLUG}/dispositivos/iphone`);
  const r = await chamar({ idToken: 'tok-dono1' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.total, 0);
  assert.equal(amb.notificacoes.length, 0);
});

test('teste: só o dono logado usa (sem token, token inválido e conta sem negócio são recusados)', async () => {
  assert.equal((await chamar({})).statusCode, 401);
  assert.equal((await chamar({ idToken: 'lixo' })).statusCode, 401);
  assert.equal((await chamar({ idToken: 'tok-estranho' })).statusCode, 403);
  assert.equal(amb.notificacoes.length, 0);
});

test('teste: limite de envios por dono (evita disparar notificação em loop)', async () => {
  let ultimo;
  for (let i = 0; i < 11; i++) ultimo = await chamar({ idToken: 'tok-dono1' }, `10.0.0.${i}`);   // IPs diferentes: o limite é POR DONO
  assert.equal(ultimo.statusCode, 429);
});

test('service worker: assume na hora (antes a versão antiga ficava ativa e duplicava a notificação)', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'firebase-messaging-sw.js'), 'utf8');
  assert.match(sw, /addEventListener\('install'[\s\S]{0,80}skipWaiting\(\)/);
  assert.match(sw, /addEventListener\('activate'[\s\S]{0,120}clients\.claim\(\)/);
});

// ---------------------------------------------------------------- service worker (executado de verdade)
const vm = require('node:vm');
const SW = fs.readFileSync(path.join(__dirname, '..', 'firebase-messaging-sw.js'), 'utf8');

// Navegador simulado: carrega o firebase-messaging-sw.js real e devolve os ganchos que ele registrou.
function carregarSW({ exibidas = [], janelas = [] } = {}) {
  const mostradas = [];            // notificações que o SW mandou mostrar
  const abertas = [];              // openWindow
  const mensagens = [];            // postMessage para a página
  const ouvintes = {};
  let aoReceber = null;
  const self_ = {
    addEventListener: (nome, f) => { ouvintes[nome] = f; },
    skipWaiting: () => { self_.pulou = true; },
    clients: {
      claim: () => { self_.assumiu = true; },
      matchAll: async () => janelas.map((j) => { const c = { ...j, focus: async () => c, postMessage: (m) => mensagens.push(m) }; return c; }),
      openWindow: async (url) => { abertas.push(url); return {}; }
    },
    registration: {
      getNotifications: async () => exibidas,
      showNotification: async (titulo, opcoes) => { mostradas.push({ titulo, ...opcoes }); }
    }
  };
  const ctx = vm.createContext({
    self: self_, importScripts() {}, console,
    setTimeout: (f) => f(),                                   // sem esperar os 700 ms de verdade
    encodeURIComponent, URL,
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: (f) => { aoReceber = f; } }) }
  });
  vm.runInContext(SW, ctx);
  return { self: self_, ouvintes, mostradas, abertas, mensagens, receber: (payload) => aoReceber(payload) };
}
const mensagem = (tag = 'agendamento-A1') => ({ notification: { title: '77 AgendaPro', body: 'Maria — hoje' }, data: { tag, agendamentoId: 'A1' } });

test('service worker: assume na hora (skipWaiting + clients.claim)', async () => {
  const sw = carregarSW();
  sw.ouvintes.install();
  await sw.ouvintes.activate({ waitUntil: (p) => p });
  assert.equal(sw.self.pulou, true);
  assert.equal(sw.self.assumiu, true);
});

test('service worker: se o Firebase JÁ mostrou a desta mensagem, não mostra outra (nada duplica)', async () => {
  // (a) pela mesma tag
  let sw = carregarSW({ exibidas: [{ tag: 'agendamento-A1' }] });
  await sw.receber(mensagem());
  assert.equal(sw.mostradas.length, 0, 'mesma tag');

  // (b) notificação criada pelo SDK, que guarda a mensagem original em data.FCM_MSG — mesmo SEM tag e SEM timestamp (Safari)
  sw = carregarSW({ exibidas: [{ data: { FCM_MSG: { data: { tag: 'agendamento-A1' } } } }] });
  await sw.receber(mensagem());
  assert.equal(sw.mostradas.length, 0, 'pelo FCM_MSG, sem depender de timestamp');
});

test('service worker: se o Firebase NÃO mostrou, mostra UMA própria (o iPhone exige notificação visível)', async () => {
  const sw = carregarSW({ exibidas: [] });
  await sw.receber(mensagem());
  assert.equal(sw.mostradas.length, 1);
  assert.equal(sw.mostradas[0].body, 'Maria — hoje');
  assert.equal(sw.mostradas[0].tag, 'agendamento-A1');
  assert.deepEqual(JSON.parse(JSON.stringify(sw.mostradas[0].data)), { reserva: true, agendamentoId: 'A1' });
});

test('service worker: notificação ANTIGA de outro agendamento não impede de mostrar a nova', async () => {
  const sw = carregarSW({ exibidas: [{ tag: 'agendamento-ANTIGO', data: { FCM_MSG: { data: { tag: 'agendamento-ANTIGO' } } } }] });
  await sw.receber(mensagem('agendamento-NOVO'));
  assert.equal(sw.mostradas.length, 1);
});

test('service worker: toque na notificação — painel aberto: foca e avisa a página qual agendamento abrir', async () => {
  const sw = carregarSW({ janelas: [{ url: 'https://x/admin' }] });
  let esperar; sw.ouvintes.notificationclick({ notification: { data: { reserva: true, agendamentoId: 'A1' }, close() {} }, waitUntil: (p) => { esperar = p; } });
  await esperar;
  assert.deepEqual(JSON.parse(JSON.stringify(sw.mensagens)), [{ messageType: 'notification-clicked', data: { agendamentoId: 'A1' } }]);
  assert.equal(sw.abertas.length, 0);
});

test('service worker: toque na notificação — painel fechado: abre /admin?agendamento=ID', async () => {
  const sw = carregarSW({ janelas: [] });
  let esperar; sw.ouvintes.notificationclick({ notification: { data: { reserva: true, agendamentoId: 'A 1' }, close() {} }, waitUntil: (p) => { esperar = p; } });
  await esperar;
  assert.deepEqual(JSON.parse(JSON.stringify(sw.abertas)), ['/admin?agendamento=A%201']);
});

test('service worker: toque em notificação que NÃO é a de reserva (a do Firebase) é ignorado aqui', async () => {
  const sw = carregarSW({ janelas: [{ url: 'x' }] });
  let esperou = false;
  sw.ouvintes.notificationclick({ notification: { data: { FCM_MSG: {} }, close() {} }, waitUntil: () => { esperou = true; } });
  assert.equal(esperou, false);
  assert.equal(sw.abertas.length + sw.mensagens.length, 0);
});

test('painel: abre o agendamento da notificação (parâmetro na URL e mensagem do service worker)', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(admin, /get\('agendamento'\)/);
  assert.match(admin, /messageType === 'notification-clicked'/);
  assert.match(admin, /await renderizarTudo\(\);\s*\n\s*tratarLinkDeNotificacao\(\)/);
  assert.match(admin, /state\.agendaDataAtual = chaveParaData\(a\.dataChave\);[\s\S]{0,200}irPara\('agenda'\);\s*\n\s*abrirDetalhesAgendamento\(id\)/);
});

test('link do cliente: horário cancelado volta a ficar livre (ocupação atualizada ao escolher horário e ao cancelar)', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /btn-continuar-2'\)\.addEventListener\('click', async \(\) => \{[\s\S]{0,500}await recarregarAgendamentos\(\);\s*\n\s*renderizarTela3\(\)/);
  assert.match(app, /toast\('Agendamento cancelado', 'sucesso'\);\s*\n\s*await recarregarAgendamentos\(\)/);
});
