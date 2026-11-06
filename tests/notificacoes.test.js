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

test('service worker: só mostra notificação própria se o Firebase não mostrou nenhuma agora há pouco', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'firebase-messaging-sw.js'), 'utf8');
  // a checagem (getNotifications + timestamp recente) precisa vir ANTES de qualquer showNotification
  const iCheca = sw.indexOf('getNotifications');
  const iMostra = sw.indexOf('showNotification');
  assert.ok(iCheca > 0 && iMostra > iCheca, 'showNotification sem checar antes');
  assert.match(sw, /\.timestamp < 10000\)\) return/);
  assert.equal((sw.match(/showNotification\(/g) || []).length, 1, 'só um ponto mostra notificação');
});
