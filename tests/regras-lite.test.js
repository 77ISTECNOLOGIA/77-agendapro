// A checagem cruzada de regras do ambiente de teste de telas (tests/regras-lite.js) precisa continuar fiel: aqui se garante
// que ela nega o que as regras reais negam e libera o que o painel precisa (as regras REAIS têm teste no emulador).

const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeDb } = require('./_helpers');
const { permitir } = require('./regras-lite');

const S = 'barbearias/neg';
function banco() {
  const f = new FakeDb();
  f.seed('usuarios/dono', { barbeariaId: 'neg', role: 'owner' });
  f.seed('usuarios/gerente', { barbeariaId: 'neg', role: 'profissional', profissionalId: 'p1', permissoes: { verTodos: false, gerirNegocio: true } });
  f.seed('usuarios/solo', { barbeariaId: 'neg', role: 'profissional', profissionalId: 'p2', permissoes: { verTodos: false, gerirNegocio: false } });
  f.seed('usuarios/forasteiro', { barbeariaId: 'outro', role: 'owner' });
  f.seed('admins77/adm', { role: 'super_admin' });
  f.seed(`${S}/agendamentos/a1`, { profissionalId: 'p1' });
  f.seed(`${S}/agendamentos/a2`, { profissionalId: 'p2' });
  f.seed(`${S}/dispositivos/d1`, { uid: 'solo' });
  return f;
}
const ok = async (f, uid, c) => assert.equal(await permitir(f, uid, c), null, JSON.stringify([uid, c]));
const nega = async (f, uid, c) => assert.notEqual(await permitir(f, uid, c), null, 'deveria negar: ' + JSON.stringify([uid, c]));

test('visitante e forasteiro: nada', async () => {
  const f = banco();
  await nega(f, null, { op: 'get', path: S });
  await nega(f, 'forasteiro', { op: 'get', path: S });
  await nega(f, 'forasteiro', { op: 'list', path: `${S}/agendamentos`, filtros: [] });
});

test('dono (conta antiga): lê tudo e grava os dados do negócio, mas não status/plano', async () => {
  const f = banco();
  await ok(f, 'dono', { op: 'list', path: `${S}/agendamentos`, filtros: [] });
  await ok(f, 'dono', { op: 'list', path: `${S}/clientes` });
  await ok(f, 'dono', { op: 'update', path: S, data: { telefone: '1', nome: 'x' } });
  await nega(f, 'dono', { op: 'update', path: S, data: { status: 'ativa' } });
  await nega(f, 'dono', { op: 'set', path: `${S}/convites/x`, data: {} });
  await nega(f, 'dono', { op: 'update', path: 'usuarios/dono', data: { role: 'x' } });
});

test('quem só vê o próprio profissional: consulta filtrada sim, sem filtro/do outro não; clientes não', async () => {
  const f = banco();
  await ok(f, 'solo', { op: 'list', path: `${S}/agendamentos`, filtros: [{ campo: 'profissionalId', op: '==', valor: 'p2' }] });
  await nega(f, 'solo', { op: 'list', path: `${S}/agendamentos`, filtros: [] });
  await nega(f, 'solo', { op: 'list', path: `${S}/agendamentos`, filtros: [{ campo: 'profissionalId', op: '==', valor: 'p1' }] });
  await nega(f, 'solo', { op: 'list', path: `${S}/clientes` });
  await nega(f, 'solo', { op: 'list', path: `${S}/profissionais` });
  await ok(f, 'solo', { op: 'get', path: `${S}/profissionais/p2` });
  await nega(f, 'solo', { op: 'get', path: `${S}/profissionais/p1` });
  await ok(f, 'solo', { op: 'update', path: `${S}/profissionais/p2`, data: { horarioTrabalho: {}, nome: 'n' } });
  await nega(f, 'solo', { op: 'update', path: `${S}/profissionais/p2`, data: { comissao: 99 } });
  await ok(f, 'solo', { op: 'update', path: `${S}/agendamentos/a2`, data: { status: 'concluido' } });
  await nega(f, 'solo', { op: 'update', path: `${S}/agendamentos/a1`, data: { status: 'concluido' } });
  await nega(f, 'solo', { op: 'update', path: `${S}/agendamentos/a2`, data: { profissionalId: 'p1' } });
  await ok(f, 'solo', { op: 'set', path: `${S}/agendamentos/novo`, data: { profissionalId: 'p2' } });
  await nega(f, 'solo', { op: 'set', path: `${S}/agendamentos/novo`, data: { profissionalId: 'p1' } });
  await nega(f, 'solo', { op: 'update', path: S, data: { telefone: '1' } });
  await nega(f, 'solo', { op: 'set', path: `${S}/servicos/x`, data: {} });
});

test('gerente sem "ver tudo": gerencia o negócio e serviços; não cria nem apaga profissional; só os próprios aparelhos', async () => {
  const f = banco();
  await ok(f, 'gerente', { op: 'update', path: S, data: { endereco: 'x' } });
  await ok(f, 'gerente', { op: 'set', path: `${S}/servicos/x`, data: {} });
  await nega(f, 'gerente', { op: 'set', path: `${S}/profissionais/novo`, data: {} });
  await nega(f, 'gerente', { op: 'delete', path: `${S}/profissionais/p1` });
  await ok(f, 'solo', { op: 'list', path: `${S}/dispositivos`, filtros: [{ campo: 'uid', op: '==', valor: 'solo' }] });
  await nega(f, 'solo', { op: 'list', path: `${S}/dispositivos`, filtros: [] });
  await ok(f, 'solo', { op: 'set', path: `${S}/dispositivos/novo`, data: { uid: 'solo' } });
  await nega(f, 'solo', { op: 'set', path: `${S}/dispositivos/novo`, data: { uid: 'dono' } });
});

test('super-admin tem acesso amplo', async () => {
  await ok(banco(), 'adm', { op: 'list', path: 'barbearias' });
});
