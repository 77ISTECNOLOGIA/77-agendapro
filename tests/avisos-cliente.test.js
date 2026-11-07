// Aviso (push) ao dono quando o CLIENTE cancela ou remarca pelo link, e volta à lista na tela do cliente.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { montarAmbiente, req, res, dataEmDias, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const criarAgendamento = require('../api/criar-agendamento');
const agendamentoCliente = require('../api/agendamento-cliente');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const WHATS = '(21) 99999-1234';

async function chamar(handler, requisicao) { const r = res(); await handler(requisicao, r); return r; }
const acao = (action, extra = {}) => req('POST', { body: { slug: SLUG, whatsapp: WHATS, action, ...extra } });

async function agendar() {
  const r = await chamar(criarAgendamento, req('POST', { body: { slug: SLUG, whatsapp: WHATS, nome: 'Maria Souza', profissionalId: 'prof1',
    servicosIds: ['srv1'], dataChave: dataEmDias(3), horario: '10:00' } }));
  assert.equal(r.statusCode, 201);
  limparLimites();
  return r.body.id;
}

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/notebook`, { token: 'tok-notebook' });
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/iphone`, { token: 'tok-iphone' });
  amb.notificacoes.length = 0;
});

test('cliente remarca: o dono recebe o aviso com o horário de antes e o de depois', async () => {
  const id = await agendar();
  amb.notificacoes.length = 0;              // ignora o aviso da criação
  const r = await chamar(agendamentoCliente, acao('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(5), novoHorario: '09:00' }));
  assert.equal(r.statusCode, 200);
  assert.equal(amb.notificacoes.length, 2, 'um aviso por aparelho');
  const n = amb.notificacoes[0];
  assert.equal(n.notification.title, '🔁 Cliente remarcou');
  assert.match(n.notification.body, /^Maria remarcou: .* às 10:00 → .* às 09:00 — Corte com João$/);
  assert.match(n.webpush.fcmOptions.link, new RegExp(`/admin\\?agendamento=${id}$`));
  assert.match(n.data.tag, new RegExp(`^remarcou-${id}-`));
});

test('cliente cancela: o dono recebe o aviso de cancelamento', async () => {
  const id = await agendar();
  amb.notificacoes.length = 0;
  const r = await chamar(agendamentoCliente, acao('cancelar', { agendamentoId: id }));
  assert.equal(r.statusCode, 200);
  assert.equal(amb.notificacoes.length, 2);
  assert.equal(amb.notificacoes[0].notification.title, '❌ Cliente cancelou');
  assert.match(amb.notificacoes[0].notification.body, /^Maria cancelou: .* às 10:00 — Corte com João$/);
  assert.equal(amb.notificacoes[0].data.tag, `cancelou-${id}`);
});

test('ação recusada (horário ocupado / cliente errado) não gera aviso', async () => {
  const id = await agendar();
  amb.notificacoes.length = 0;
  const alheio = await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: '(21) 98888-7777', action: 'cancelar', agendamentoId: id } }));
  assert.equal(alheio.statusCode, 404);
  limparLimites();
  const mesmo = await chamar(agendamentoCliente, acao('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(3), novoHorario: '10:00' }));
  assert.equal(mesmo.statusCode, 400);
  assert.equal(amb.notificacoes.length, 0);
});

test('falha no envio do aviso nunca desfaz o cancelamento', async () => {
  const id = await agendar();
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/notebook`, { token: 'tok-notebook' });
  amb.tokensInvalidos.add('tok-notebook');
  amb.tokensInvalidos.add('tok-iphone');
  const r = await chamar(agendamentoCliente, acao('cancelar', { agendamentoId: id }));
  assert.equal(r.statusCode, 200);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/agendamentos/${id}`).status, 'cancelado');
});

test('tela do cliente: depois de remarcar volta para a lista; botão da remarcação chama "Voltar"', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(app, /toast\('Agendamento remarcado!', 'sucesso'\);\s*\n\s*await carregarMeusAgendamentos\(\);\s*\n\s*mostrarPainelLista\(\);/);
  assert.match(html, /id="btn-cancelar-remarcacao"[^>]*>← Voltar</);
});

test('tela de sucesso: tem "Ver meus agendamentos" e "Voltar ao início" além de novo agendamento e agenda', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tela5 = html.slice(html.indexOf('id="tela-5"'), html.indexOf('id="tela-6"'));
  assert.match(tela5, /id="btn-novo"[\s\S]*id="btn-ver-meus"[\s\S]*id="btn-inicio"[^>]*>← Voltar ao início</);
  assert.match(app, /\$\('#btn-inicio'\)\.addEventListener\('click', \(\) => \{\s*\n\s*resetarFluxo\(\)\.catch\([^\n]*\n\s*mostrarTela\(1\);/);
  assert.match(app, /\$\('#btn-ver-meus'\)\.addEventListener\('click', async \(\) => \{\s*\n\s*mostrarTela\(6\);\s*\n\s*mostrarPainelLista\(\);/);
});

test('"Fazer novo agendamento" vai direto para a escolha do serviço (cliente já identificado)', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /\$\('#btn-novo'\)\.addEventListener\('click', async \(\) => \{\s*\n\s*try \{\s*\n\s*await resetarFluxo\(\);\s*\n\s*renderizarTela2\(\);\s*\n\s*mostrarTela\(2\);/);
  assert.match(app, /async function resetarFluxo\(\)/);
  assert.match(app, /await carregarBarbearia\(state\.slug\);/);
  // "Voltar ao início" continua indo para a tela de entrada
  assert.match(app, /\$\('#btn-inicio'\)[\s\S]{0,120}mostrarTela\(1\)/);
});
