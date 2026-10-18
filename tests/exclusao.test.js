// Testes da exclusão definitiva de negócios (api/excluir-negocio.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, semearNegocio } = require('./_helpers');

const amb = montarAmbiente(); // antes de carregar o handler
const excluir = require('../api/excluir-negocio');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const OUTRO = 'outra-barbearia';

async function chamar(corpo) {
  const r = res();
  await excluir(req('POST', { body: corpo }), r);
  return r;
}
const corpoOk = (extra = {}) => ({ idToken: 'tok-adm1', slug: SLUG, confirmacao: SLUG, apagarLogins: true, ...extra });
const existe = (caminho) => amb.fake.get(caminho) !== undefined;
const sobrasDoNegocio = (slug) => [...amb.fake.docs.keys()].filter((k) => k === `barbearias/${slug}` || k.startsWith(`barbearias/${slug}/`));

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  amb.authRemovidos.clear();

  amb.fake.seed('admins77/adm1', { role: 'super_admin', nome: 'Felipe', email: 'felipe@77.com' });

  // Negócio a ser excluído (suspenso), com dados em todas as sub-coleções
  semearNegocio(amb.fake, SLUG, { status: 'suspensa', nome: 'Barbearia de Teste' });
  amb.fake.seed(`barbearias/${SLUG}/clientes/5521999991234`, { nome: 'Maria Secreta', whatsapp: '5521999991234', totalAgendamentos: 2 });
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/a1`, { clienteNome: 'Maria Secreta', clienteWhatsapp: '5521999991234', dataChave: '2030-01-01', horario: '10:00', status: 'confirmado' });
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/a2`, { clienteNome: 'Maria Secreta', clienteWhatsapp: '5521999991234', dataChave: '2030-01-02', horario: '11:00', status: 'cancelado' });
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/d1`, { token: 'tok-push' });
  amb.fake.seed(`usuarios/dono1`, { barbeariaId: SLUG, role: 'owner', email: 'dono@x.com' });
  amb.fake.seed(`cadastrosAguardando/${SLUG}`, { barbeariaId: SLUG, email: 'dono@x.com' });

  // Outro negócio que NÃO pode ser tocado
  semearNegocio(amb.fake, OUTRO, { status: 'ativa' });
  amb.fake.seed(`barbearias/${OUTRO}/agendamentos/z1`, { clienteNome: 'Outro', dataChave: '2030-01-01', horario: '09:00', status: 'confirmado' });
  amb.fake.seed('usuarios/dono2', { barbeariaId: OUTRO, role: 'owner' });
});

test('exclusão: apaga o negócio inteiro, o vínculo, a fila e o login do dono', async () => {
  const r = await chamar(corpoOk());
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.resumo, { agendamentos: 2, clientes: 1, servicos: 2, profissionais: 1, loginsApagados: 1 });

  assert.deepEqual(sobrasDoNegocio(SLUG), [], 'nada do negócio sobrou (nem sub-coleções)');
  assert.equal(existe('usuarios/dono1'), false);
  assert.equal(existe(`cadastrosAguardando/${SLUG}`), false);
  assert.ok(amb.authRemovidos.has('dono1'));
});

test('exclusão: não mexe em nenhum outro negócio', async () => {
  await chamar(corpoOk());
  assert.ok(existe(`barbearias/${OUTRO}`));
  assert.ok(existe(`barbearias/${OUTRO}/agendamentos/z1`));
  assert.ok(existe('usuarios/dono2'));
  assert.ok(!amb.authRemovidos.has('dono2'));
  assert.ok(existe('admins77/adm1'));
});

test('exclusão: registra no histórico quem excluiu e o resumo — sem dados pessoais de clientes', async () => {
  await chamar(corpoOk());
  const logs = [...amb.fake.docs.entries()].filter(([k]) => k.startsWith('logs77/')).map(([, v]) => v);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].acao, 'excluiu');
  assert.equal(logs[0].alvoId, SLUG);
  assert.equal(logs[0].alvoNome, 'Barbearia de Teste');
  assert.equal(logs[0].admin, 'adm1');
  assert.equal(logs[0].adminNome, 'Felipe');
  const texto = JSON.stringify(logs[0]);
  assert.equal(texto.includes('Maria Secreta'), false);
  assert.equal(texto.includes('5521999991234'), false);
});

test('exclusão: com apagarLogins=false mantém o login (mas remove o vínculo)', async () => {
  const r = await chamar(corpoOk({ apagarLogins: false }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.resumo.loginsApagados, 0);
  assert.equal(amb.authRemovidos.size, 0);
  assert.equal(existe('usuarios/dono1'), false);
});

test('trava: só negócio SUSPENSO pode ser excluído', async () => {
  for (const status of ['ativa', 'trial', 'aguardando_aprovacao']) {
    limparLimites();
    amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), status });
    const r = await chamar(corpoOk());
    assert.equal(r.statusCode, 409, status);
    assert.match(r.body.erro, /Suspenda/);
    assert.ok(existe(`barbearias/${SLUG}/agendamentos/a1`), `${status}: nada foi apagado`);
  }
});

test('trava: a confirmação precisa ser exatamente o link do negócio', async () => {
  for (const confirmacao of ['', undefined, 'barbearia', 'BARBEARIA-TESTE-', OUTRO]) {
    limparLimites();
    const r = await chamar(corpoOk({ confirmacao }));
    assert.equal(r.statusCode, 400, String(confirmacao));
    assert.ok(existe(`barbearias/${SLUG}`));
  }
});

test('trava: só super-admin (dono comum, token inválido ou ausente são recusados)', async () => {
  assert.equal((await chamar(corpoOk({ idToken: 'tok-dono1' }))).statusCode, 403);   // dono do negócio ≠ super-admin
  limparLimites();
  assert.equal((await chamar(corpoOk({ idToken: 'lixo' }))).statusCode, 401);
  limparLimites();
  assert.equal((await chamar(corpoOk({ idToken: undefined }))).statusCode, 401);
  assert.ok(existe(`barbearias/${SLUG}/agendamentos/a1`), 'nada foi apagado');
  assert.equal(amb.authRemovidos.size, 0);
});

test('proteção: nunca apaga o login de super-admin nem o de quem está executando', async () => {
  // o dono do negócio é, também, o próprio super-admin que está excluindo
  amb.fake.seed('usuarios/adm1', { barbeariaId: SLUG, role: 'owner' });
  // e há outro super-admin vinculado
  amb.fake.seed('admins77/adm2', { role: 'super_admin', nome: 'Outro' });
  amb.fake.seed('usuarios/adm2', { barbeariaId: SLUG, role: 'owner' });

  const r = await chamar(corpoOk());
  assert.equal(r.statusCode, 200);
  assert.ok(!amb.authRemovidos.has('adm1'));
  assert.ok(!amb.authRemovidos.has('adm2'));
  assert.ok(amb.authRemovidos.has('dono1'), 'o dono comum é apagado');
  assert.ok(r.body.avisos.length >= 2);
  assert.ok(existe('admins77/adm1') && existe('admins77/adm2'));
});

test('login já inexistente no Firebase não impede a exclusão', async () => {
  amb.fake.seed('usuarios/uid-inexistente', { barbeariaId: SLUG, role: 'owner' });
  const r = await chamar(corpoOk());
  assert.equal(r.statusCode, 200);
  assert.deepEqual(sobrasDoNegocio(SLUG), []);
});

test('negócio inexistente = 404; link inválido = 400; método errado = 405', async () => {
  assert.equal((await chamar(corpoOk({ slug: 'nao-existe', confirmacao: 'nao-existe' }))).statusCode, 404);
  limparLimites();
  assert.equal((await chamar(corpoOk({ slug: '../x', confirmacao: '../x' }))).statusCode, 400);
  const r = res(); await excluir(req('GET'), r); assert.equal(r.statusCode, 405);
});
