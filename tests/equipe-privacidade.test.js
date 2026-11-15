// PRIVACIDADE DO SÓCIO: o dono não vê agenda, clientes nem faturamento dele (marca donoVe + fichas separadas + avisos).

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, semearNegocio, dataEmDias } = require('./_helpers');

const amb = montarAmbiente();
const equipe = require('../api/equipe');
const criarAgendamento = require('../api/criar-agendamento');
const agendamentoCliente = require('../api/agendamento-cliente');
const recorrencia = require('../api/recorrencia');
const { enviarParaDispositivos } = require('../api/_lib/notificar');
const { avisarPendentes } = require('../api/_lib/pendencias');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const TOTAL = { verTodos: true, gerirNegocio: true };

async function chamar(corpo) { const r = res(); await equipe(req('POST', { body: corpo }), r); limparLimites(); return r; }
const dono = (extra) => ({ idToken: 'tok-dono1', ...extra });
const get = (p) => amb.fake.get(`barbearias/${SLUG}/${p}`);
const agendar = async (extra = {}) => {
  const r = res();
  await criarAgendamento(req('POST', { body: { slug: SLUG, whatsapp: '(21) 99999-1234', nome: 'Maria Souza', profissionalId: 'prof1', servicosIds: ['srv1'], dataChave: dataEmDias(3), horario: '10:00', ...extra } }), r);
  limparLimites();
  return r;
};
const identificar = async (whats) => { const r = res(); await agendamentoCliente(req('POST', { body: { slug: SLUG, whatsapp: whats, action: 'identificar' } }), r); limparLimites(); return r; };
const todosAgs = () => [...amb.fake.docs.entries()].filter(([k]) => /\/agendamentos\/[^/]+$/.test(k)).map(([k, v]) => ({ id: k.split('/').pop(), ...v }));

async function convidarEAceitar(papel, nome, uid, profissionalId) {
  const c = await chamar(dono({ action: 'convidar', nome, email: `${uid}@teste.com`, papel, profissionalId }));
  assert.equal(c.statusCode, 201, JSON.stringify(c.body));
  const a = await chamar({ action: 'aceitar', idToken: `tok-${uid}`, n: SLUG, c: c.body.token });
  assert.equal(a.statusCode, 200, JSON.stringify(a.body));
}

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof2`, { nome: 'Sócio', ativo: true, comissao: 0 });
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof3`, { nome: 'Func', ativo: true, comissao: 40 });
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner', papel: 'dono', permissoes: TOTAL, email: 'dono1@teste.com' });
});

test('agendar com SÓCIO: agendamento e ficha ficam do lado dele (donoVe=false); com o dono, do lado do dono', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  const a = await agendar({ profissionalId: 'prof2' });
  const b = await agendar({ profissionalId: 'prof1', horario: '14:00', whatsapp: '(21) 98888-7777', nome: 'Outro Cliente' });
  assert.equal(get(`agendamentos/${a.body.id}`).donoVe, false);
  assert.equal(get(`agendamentos/${b.body.id}`).donoVe, true);
  assert.equal(get('clientes/5521999991234'), undefined, 'a ficha da cliente do sócio NÃO está onde o dono lê');
  assert.deepEqual([get('clientes/prof2__5521999991234').donoVe, get('clientes/prof2__5521999991234').nome], [false, 'Maria Souza']);
  assert.equal(get('clientes/5521988887777').donoVe, true);
  // a mesma cliente atendida pelos dois lados tem DUAS fichas separadas
  const c = await agendar({ profissionalId: 'prof1', horario: '16:00' });
  assert.equal(c.statusCode, 201);
  assert.equal(get('clientes/5521999991234').totalAgendamentos, 1);
  assert.equal(get('clientes/prof2__5521999991234').totalAgendamentos, 1);
  // o servidor reconhece a cliente pelo WhatsApp, esteja a ficha de que lado estiver
  const r = await identificar('(21) 98888-7777');
  assert.deepEqual([r.body.encontrado, r.body.nome], [true, 'Outro']);
  await convidarEAceitar('funcionario', 'Func', 'func9', 'prof3');
  await agendar({ profissionalId: 'prof3', horario: '12:00', whatsapp: '(21) 97777-1111', nome: 'Terceira' });
  assert.equal((await identificar('(21) 99999-1234')).body.encontrado, true);
  assert.equal((await identificar('(21) 91111-0000')).body.encontrado, false);
});

test('virar sócio um profissional que JÁ TEM histórico: agendamentos e clientes passam para o lado dele; voltar a funcionário devolve', async () => {
  const hist = (id, prof, whats, nome, dia, extra = {}) => amb.fake.seed(`barbearias/${SLUG}/agendamentos/${id}`, { profissionalId: prof, clienteWhatsapp: whats, clienteNome: nome, status: 'concluido', dataChave: dia, horario: '10:00', duracaoMin: 30, valorTotal: 40, criadoEm: dia + 'T10:00:00Z', ...extra });
  hist('h1', 'prof2', '5521911110001', 'Só do Futuro Sócio', '2026-10-01');
  hist('h2', 'prof2', '5521911110002', 'Dos Dois Lados', '2026-10-02');
  hist('h3', 'prof1', '5521911110002', 'Dos Dois Lados', '2026-10-03', { donoVe: true });
  amb.fake.seed(`barbearias/${SLUG}/clientes/5521911110001`, { nome: 'Só do Futuro Sócio', whatsapp: '5521911110001', donoVe: true, totalAgendamentos: 1 });
  amb.fake.seed(`barbearias/${SLUG}/clientes/5521911110002`, { nome: 'Dos Dois Lados', whatsapp: '5521911110002', donoVe: true, totalAgendamentos: 2 });
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');               // o convite liga a um profissional com histórico
  assert.equal(get('agendamentos/h1').donoVe, false);
  assert.equal(get('agendamentos/h2').donoVe, false);
  assert.equal(get('agendamentos/h3').donoVe, true, 'o do dono continua do dono');
  assert.equal(get('clientes/5521911110001'), undefined, 'cliente só do sócio saiu da lista do dono');
  assert.equal(get('clientes/prof2__5521911110001').donoVe, false);
  assert.ok(get('clientes/5521911110002'), 'cliente atendido pelos dois lados continua na lista do dono');
  assert.equal(get('clientes/prof2__5521911110002').totalAgendamentos, 1);
  // volta a funcionário: tudo volta para o dono
  assert.equal((await chamar(dono({ action: 'alterar', uid: 'socio9', papel: 'funcionario' }))).statusCode, 200);
  assert.equal(get('agendamentos/h1').donoVe, true);
  assert.equal(get('agendamentos/h2').donoVe, true);
  assert.equal(get('clientes/prof2__5521911110001'), undefined);
  assert.equal(get('clientes/5521911110001').donoVe, true);
  assert.equal(get('clientes/5521911110001').totalAgendamentos, 1, 'a visita volta para a ficha do dono');
  assert.equal(get('clientes/5521911110002').totalAgendamentos, 2, 'sem contar em dobro: 1 dele + 1 que voltou');
  // e de novo a sócio
  assert.equal((await chamar(dono({ action: 'alterar', uid: 'socio9', papel: 'socio' }))).statusCode, 200);
  assert.equal(get('agendamentos/h1').donoVe, false);
});

test('avisos: o dono NÃO recebe notificação de agendamento de sócio (nem o aparelho antigo dele); o resumo diário também ignora o sócio', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/antigo`, { token: 'tok-antigo' });                         // aparelho do dono de antes da equipe
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/dono`, { token: 'tok-dono', uid: 'dono1' });
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/socio`, { token: 'tok-socio', uid: 'socio9' });
  const negocioRef = amb.fake.collection('barbearias').doc(SLUG);
  const enviados = async (o) => { amb.notificacoes.length = 0; await enviarParaDispositivos(negocioRef, { corpo: 'x', tag: 't', ...o }); return amb.notificacoes.map((m) => m.token).sort(); };
  assert.deepEqual(await enviados({ profissionalId: 'prof2' }), ['tok-socio'], 'agendamento do sócio: só o sócio');
  assert.deepEqual(await enviados({ profissionalId: 'prof1' }), ['tok-antigo', 'tok-dono'], 'do dono: o dono; o sócio não recebe o que não é dele');
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/p1`, { profissionalId: 'prof2', status: 'confirmado', dataChave: '2026-10-01', horario: '10:00', duracaoMin: 30, donoVe: false });
  const agora = { dataChave: '2026-11-15', minutos: 600 };
  assert.equal(await avisarPendentes(negocioRef, agora), 0, 'só havia pendência de sócio: nada para o dono');
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/p2`, { profissionalId: 'prof1', status: 'confirmado', dataChave: '2026-10-01', horario: '10:00', duracaoMin: 30, donoVe: true });
  assert.equal(await avisarPendentes(negocioRef, agora), 1);
});

test('horários fixos: o dono não cria, não lista e não encerra os de um sócio; o sócio cuida dos dele', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  const rec = async (corpo) => { const r = res(); await recorrencia(req('POST', { body: corpo }), r); limparLimites(); return r; };
  const serie = (extra = {}) => ({ action: 'criar', clienteNome: 'Fixo', clienteWhatsapp: '(21) 99999-1234', profissionalId: 'prof2', servicosIds: ['srv1'], dataInicio: dataEmDias(3), horario: '09:00', modo: 'ate', ate: dataEmDias(20), ...extra });
  assert.equal((await rec({ idToken: 'tok-dono1', ...serie() })).statusCode, 403, 'dono não cria na agenda do sócio');
  assert.equal((await rec({ idToken: 'tok-dono1', ...serie({ action: 'previa' }) })).statusCode, 403);
  const doSocio = await rec({ idToken: 'tok-socio9', ...serie() });
  assert.equal(doSocio.statusCode, 201, JSON.stringify(doSocio.body));
  assert.equal(todosAgs().find((a) => a.recorrenciaId === doSocio.body.serieId).donoVe, false);
  assert.ok(get('clientes/prof2__5521999991234'), 'ficha do lado do sócio');
  assert.equal(get('clientes/5521999991234'), undefined);
  const doDono = await rec({ idToken: 'tok-dono1', ...serie({ profissionalId: 'prof1', horario: '15:00' }) });
  assert.equal(doDono.statusCode, 201);
  assert.equal(todosAgs().find((a) => a.recorrenciaId === doDono.body.serieId).donoVe, true);
  assert.deepEqual((await rec({ idToken: 'tok-dono1', action: 'listar' })).body.series.map((s) => s.profissionalId), ['prof1'], 'o dono só vê os horários fixos dele');
  assert.deepEqual((await rec({ idToken: 'tok-socio9', action: 'listar' })).body.series.map((s) => s.profissionalId), ['prof2']);
  assert.equal((await rec({ idToken: 'tok-dono1', action: 'encerrar', serieId: doSocio.body.serieId })).statusCode, 404);
  assert.equal((await rec({ idToken: 'tok-socio9', action: 'encerrar', serieId: doSocio.body.serieId })).statusCode, 200);
});
