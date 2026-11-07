// Cliente fixo: horário que se repete toda semana (api/recorrencia.js, api/cron-recorrencias.js e _lib/recorrencia.js).
// O relógio é travado (mock.timers) em datas conhecidas pra testar virada de mês de forma exata.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { montarAmbiente, req, res, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const recorrencia = require('../api/recorrencia');
const cron = require('../api/cron-recorrencias');
const { fimDoMes, limiteDeGeracao, datasDaSerie } = require('../api/_lib/recorrencia');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const SEXTA_06_NOV = '2026-11-06T15:00:00Z';   // 12:00 em Brasília
const DIA_22_NOV = '2026-11-22T15:00:00Z';
const em = (isoUtc) => { mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: new Date(isoUtc) }); };

async function chamar(corpo, ip) {
  const r = res();
  await recorrencia(req('POST', { body: corpo, ip }), r);
  return r;
}
const serieBase = (extra = {}) => ({
  idToken: 'tok-dono1', action: 'criar', clienteNome: 'Carlos Fixo', clienteWhatsapp: '(21) 99999-1234',
  profissionalId: 'prof1', servicosIds: ['srv1'], dataInicio: '2026-11-13', horario: '09:00', modo: 'mensal', ...extra
});
const agendamentos = () => [...amb.fake.docs.entries()]
  .filter(([k]) => /\/agendamentos\/[^/]+$/.test(k)).map(([k, v]) => ({ id: k.split('/').pop(), ...v }))
  .sort((a, b) => a.dataChave.localeCompare(b.dataChave));
const datasDa = (serieId) => agendamentos().filter((a) => a.recorrenciaId === serieId).map((a) => a.dataChave);

test.beforeEach(() => {
  em(SEXTA_06_NOV);
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner' });
});
test.afterEach(() => mock.timers.reset());

// ---------------------------------------------------------------- funções puras
test('fim do mês e limite de geração (vira o mês a partir do dia 20)', () => {
  assert.equal(fimDoMes('2026-11-06'), '2026-11-30');
  assert.equal(fimDoMes('2026-02-10'), '2026-02-28');
  assert.equal(fimDoMes('2028-02-10'), '2028-02-29');
  assert.equal(fimDoMes('2026-12-05', 1), '2027-01-31');
  assert.equal(limiteDeGeracao('2026-11-19'), '2026-11-30');
  assert.equal(limiteDeGeracao('2026-11-20'), '2026-12-31');
  assert.equal(limiteDeGeracao('2026-12-25'), '2027-01-31');
  assert.equal(limiteDeGeracao('2026-11-06', { ate: '2026-11-20' }), '2026-11-20');   // "até" limita
  assert.equal(limiteDeGeracao('2026-11-06', { ate: '2027-05-01' }), '2026-11-30');   // mas não estende
});

test('datas da série: todo dia da semana escolhido, no intervalo', () => {
  assert.deepEqual(datasDaSerie({ diaSemana: 5, inicio: '2026-11-06', limite: '2026-11-30' }), ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
  assert.deepEqual(datasDaSerie({ diaSemana: 5, inicio: '2026-11-07', limite: '2026-11-30' }), ['2026-11-13', '2026-11-20', '2026-11-27']);
  assert.deepEqual(datasDaSerie({ diaSemana: 1, inicio: '2026-11-06', limite: '2026-11-16' }), ['2026-11-09', '2026-11-16']);
  assert.deepEqual(datasDaSerie({ diaSemana: 5, inicio: '2026-12-01', limite: '2026-11-30' }), []);
});

// ---------------------------------------------------------------- criar
test('criar: gera todas as sextas até o fim do mês, como agendamentos normais, com preço do banco', async () => {
  const r = await chamar(serieBase());
  assert.equal(r.statusCode, 201);
  assert.deepEqual(r.body.criadas, ['2026-11-13', '2026-11-20', '2026-11-27']);
  assert.equal(r.body.limite, '2026-11-30');

  const ags = agendamentos();
  assert.equal(ags.length, 3);
  for (const a of ags) {
    assert.equal(a.horario, '09:00');
    assert.equal(a.status, 'confirmado');
    assert.equal(a.origem, 'dono-recorrente');
    assert.equal(a.recorrenciaId, r.body.serieId);
    assert.equal(a.clienteWhatsapp, '5521999991234');
    assert.equal(a.valorTotal, 40);          // preço do serviço no banco
    assert.equal(a.profissionalNome, 'João Silva');
  }
  const serie = amb.fake.get(`barbearias/${SLUG}/recorrencias/${r.body.serieId}`);
  assert.equal(serie.ativa, true);
  assert.equal(serie.diaSemana, 5);
  assert.equal(serie.geradoAte, '2026-11-30');
  assert.equal(amb.fake.get(`barbearias/${SLUG}/clientes/5521999991234`).totalAgendamentos, 0, 'cadastro do cliente sem inflar visitas');
});

test('criar a partir do dia 20: já gera também o mês seguinte', async () => {
  em(DIA_22_NOV);
  const r = await chamar(serieBase({ dataInicio: '2026-11-27' }));
  assert.deepEqual(r.body.criadas, ['2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
  assert.equal(r.body.limite, '2026-12-31');
});

test('criar "até uma data": para na data escolhida', async () => {
  const r = await chamar(serieBase({ modo: 'ate', ate: '2026-11-20' }));
  assert.deepEqual(r.body.criadas, ['2026-11-13', '2026-11-20']);
});

test('data sem vaga é PULADA e registrada — nunca sobrescreve o que já existe', async () => {
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/ocupado`, {
    profissionalId: 'prof1', dataChave: '2026-11-20', horario: '09:00', duracaoMin: 30, status: 'confirmado', clienteNome: 'Outro'
  });
  const previa = await chamar(serieBase({ action: 'previa' }));
  assert.deepEqual(previa.body.datas.map((d) => [d.dataChave, d.ok]), [['2026-11-13', true], ['2026-11-20', false], ['2026-11-27', true]]);
  assert.match(previa.body.datas[1].motivo, /ocupado/);
  assert.equal(agendamentos().length, 1, 'a prévia não grava nada');

  const r = await chamar(serieBase());
  assert.deepEqual(r.body.criadas, ['2026-11-13', '2026-11-27']);
  assert.deepEqual(r.body.puladas, [{ dataChave: '2026-11-20', motivo: 'Horário já ocupado' }]);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/agendamentos/ocupado`).clienteNome, 'Outro');
  assert.equal(amb.fake.get(`barbearias/${SLUG}/recorrencias/${r.body.serieId}`).puladas.length, 1);
});

test('criar: se nenhuma data tem vaga, recusa e não deixa série pela metade', async () => {
  for (const d of ['2026-11-13', '2026-11-20', '2026-11-27']) {
    amb.fake.seed(`barbearias/${SLUG}/agendamentos/x${d}`, { profissionalId: 'prof1', dataChave: d, horario: '09:00', duracaoMin: 30, status: 'confirmado' });
  }
  const r = await chamar(serieBase());
  assert.equal(r.statusCode, 409);
  assert.equal([...amb.fake.docs.keys()].filter((k) => k.includes('/recorrencias/')).length, 0);
});

// ---------------------------------------------------------------- renovação automática
test('renovar é idempotente: rodar de novo não duplica nada', async () => {
  const r = await chamar(serieBase());
  const a = await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  const b = await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  assert.equal(a.body.criadas, 0);
  assert.equal(b.body.criadas, 0);
  assert.equal(agendamentos().length, 3);
  assert.equal(datasDa(r.body.serieId).length, 3);
});

test('virou o mês: a renovação cria o mês seguinte sozinha', async () => {
  const criada = await chamar(serieBase());
  em(DIA_22_NOV);
  const r = await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  assert.equal(r.body.criadas, 5 - 1, 'dezembro: 04, 11, 18 e 25 (27/11 já existia)');
  assert.deepEqual(datasDa(criada.body.serieId), ['2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
});

test('data que o cliente ou o dono CANCELOU não é recriada', async () => {
  const criada = await chamar(serieBase());
  const cancelada = agendamentos().find((a) => a.dataChave === '2026-11-20');
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/${cancelada.id}`, { ...cancelada, status: 'cancelado' });
  em(DIA_22_NOV);
  await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  const nov20 = agendamentos().filter((a) => a.dataChave === '2026-11-20' && a.recorrenciaId === criada.body.serieId);
  assert.equal(nov20.length, 1);
  assert.equal(nov20[0].status, 'cancelado');
});

test('mudou o preço do serviço: as datas NOVAS usam o preço atual, as antigas ficam como estavam', async () => {
  const criada = await chamar(serieBase());
  amb.fake.seed(`barbearias/${SLUG}/servicos/srv1`, { ...amb.fake.get(`barbearias/${SLUG}/servicos/srv1`), preco: 55 });
  em(DIA_22_NOV);
  await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  const porData = Object.fromEntries(agendamentos().filter((a) => a.recorrenciaId === criada.body.serieId).map((a) => [a.dataChave, a.valorTotal]));
  assert.equal(porData['2026-11-13'], 40);
  assert.equal(porData['2026-12-04'], 55);
});

test('série "até uma data" se encerra sozinha depois da data final', async () => {
  const criada = await chamar(serieBase({ modo: 'ate', ate: '2026-11-20' }));
  em('2026-12-01T15:00:00Z');
  const r = await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  assert.equal(r.body.encerradas, 1);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/recorrencias/${criada.body.serieId}`).ativa, false);
});

test('serviço removido depois: a série avisa (alerta) em vez de gerar agendamento errado', async () => {
  const criada = await chamar(serieBase());
  amb.fake.docs.delete(`barbearias/${SLUG}/servicos/srv1`);
  em(DIA_22_NOV);
  const r = await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  assert.equal(r.body.erros, 1);
  assert.equal(r.body.criadas, 0);
  assert.match(amb.fake.get(`barbearias/${SLUG}/recorrencias/${criada.body.serieId}`).alerta, /serviços foi removido/);
});

// ---------------------------------------------------------------- encerrar / listar
test('encerrar a partir de uma data: cancela só as confirmadas dali em diante e encerra a série', async () => {
  const criada = await chamar(serieBase());
  const r = await chamar({ idToken: 'tok-dono1', action: 'encerrar', serieId: criada.body.serieId, aPartirDe: '2026-11-20' });
  assert.equal(r.body.canceladas, 2);
  const porData = Object.fromEntries(agendamentos().map((a) => [a.dataChave, a.status]));
  assert.deepEqual(porData, { '2026-11-13': 'confirmado', '2026-11-20': 'cancelado', '2026-11-27': 'cancelado' });
  assert.equal(amb.fake.get(`barbearias/${SLUG}/recorrencias/${criada.body.serieId}`).ativa, false);

  em(DIA_22_NOV);                                   // e a renovação não "ressuscita" a série encerrada
  await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  assert.equal(agendamentos().length, 3);
});

test('encerrar não mexe em agendamento já concluído', async () => {
  const criada = await chamar(serieBase());
  const primeiro = agendamentos()[0];
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/${primeiro.id}`, { ...primeiro, status: 'concluido' });
  await chamar({ idToken: 'tok-dono1', action: 'encerrar', serieId: criada.body.serieId, aPartirDe: '2026-11-01' });
  assert.equal(agendamentos().find((a) => a.id === primeiro.id).status, 'concluido');
});

test('listar: mostra as séries ativas com quantas datas confirmadas faltam', async () => {
  const criada = await chamar(serieBase());
  const r = await chamar({ idToken: 'tok-dono1', action: 'listar' });
  assert.equal(r.body.series.length, 1);
  assert.deepEqual(
    { id: r.body.series[0].id, diaSemana: r.body.series[0].diaSemana, horario: r.body.series[0].horario, proximas: r.body.series[0].proximas, servicos: r.body.series[0].servicos },
    { id: criada.body.serieId, diaSemana: 5, horario: '09:00', proximas: 3, servicos: ['Corte'] });
  await chamar({ idToken: 'tok-dono1', action: 'encerrar', serieId: criada.body.serieId });
  assert.equal((await chamar({ idToken: 'tok-dono1', action: 'listar' })).body.series.length, 0);
});

// ---------------------------------------------------------------- segurança e validação
test('só o dono logado usa (sem token, token inválido e conta sem negócio são recusados)', async () => {
  assert.equal((await chamar({ action: 'listar' })).statusCode, 401);
  assert.equal((await chamar({ idToken: 'lixo', action: 'listar' })).statusCode, 401);
  assert.equal((await chamar({ idToken: 'tok-estranho', action: 'listar' })).statusCode, 403);
});

test('um dono nunca enxerga nem encerra a série de OUTRO negócio', async () => {
  const criada = await chamar(serieBase());
  semearNegocio(amb.fake, 'outra-barbearia');
  amb.fake.seed('usuarios/dono2', { barbeariaId: 'outra-barbearia', role: 'owner' });
  assert.equal((await chamar({ idToken: 'tok-dono2', action: 'listar' })).body.series.length, 0);
  const r = await chamar({ idToken: 'tok-dono2', action: 'encerrar', serieId: criada.body.serieId });
  assert.equal(r.statusCode, 404);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/recorrencias/${criada.body.serieId}`).ativa, true);
});

test('entradas inválidas são recusadas', async () => {
  const ruins = [
    { clienteNome: 'A' }, { clienteWhatsapp: '123' }, { horario: '9h' }, { dataInicio: '2026-13-40' },
    { dataInicio: '2026-11-05' },                              // no passado
    { servicosIds: [] }, { servicosIds: ['a/b'] }, { modo: 'ate', ate: '2026-11-01' }, { action: 'apagar-tudo' }
  ];
  for (const ruim of ruins) {
    limparLimites();
    const r = await chamar(serieBase(ruim));
    assert.equal(r.statusCode, 400, JSON.stringify(ruim));
  }
  assert.equal(agendamentos().length, 0);
});

test('profissional que não faz o serviço (ou serviço inexistente) é recusado', async () => {
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof2`, { nome: 'Carlos', ativo: true });
  amb.fake.seed(`barbearias/${SLUG}/servicos/srv1`, { ...amb.fake.get(`barbearias/${SLUG}/servicos/srv1`), profissionaisIds: ['prof2'] });
  assert.equal((await chamar(serieBase())).statusCode, 409);
  limparLimites();
  assert.equal((await chamar(serieBase({ servicosIds: ['nao-existe'] }))).statusCode, 409);
});

test('negócio suspenso não cria nem renova horário fixo, mas ainda pode encerrar', async () => {
  const criada = await chamar(serieBase());
  amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), status: 'suspensa' });
  assert.equal((await chamar(serieBase({ dataInicio: '2026-11-20' }))).statusCode, 403);
  assert.equal((await chamar({ idToken: 'tok-dono1', action: 'renovar' })).statusCode, 403);
  const r = await chamar({ idToken: 'tok-dono1', action: 'encerrar', serieId: criada.body.serieId });
  assert.equal(r.statusCode, 200);
});

// ---------------------------------------------------------------- rotina diária (cron)
async function rodarCron(authorization) {
  const r = res();
  await cron({ method: 'GET', headers: authorization ? { authorization } : {} }, r);
  return r;
}

test('cron: sem a senha configurada ou com senha errada, recusa (nunca fica aberto)', async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await rodarCron('Bearer qualquer')).statusCode, 401);
  assert.equal((await rodarCron()).statusCode, 401);
  process.env.CRON_SECRET = 'segredo-de-teste';
  assert.equal((await rodarCron('Bearer errado')).statusCode, 401);
  assert.equal((await rodarCron()).statusCode, 401);
  delete process.env.CRON_SECRET;
});

test('cron: renova as séries de TODOS os negócios ativos e ignora os suspensos', async () => {
  process.env.CRON_SECRET = 'segredo-de-teste';
  try {
    await chamar(serieBase());                                    // negócio A
    semearNegocio(amb.fake, 'negocio-b');                         // negócio B (ativo)
    amb.fake.seed('barbearias/negocio-b/recorrencias/s1', {
      ativa: true, clienteNome: 'Ana', clienteWhatsapp: '5521988887777', profissionalId: 'prof1', servicosIds: ['srv1'],
      diaSemana: 1, horario: '10:00', inicio: '2026-11-09', modo: 'mensal', ate: null, puladas: []
    });
    semearNegocio(amb.fake, 'negocio-suspenso', { status: 'suspensa' });
    amb.fake.seed('barbearias/negocio-suspenso/recorrencias/s1', {
      ativa: true, clienteNome: 'Zé', clienteWhatsapp: '5521977776666', profissionalId: 'prof1', servicosIds: ['srv1'],
      diaSemana: 1, horario: '10:00', inicio: '2026-11-09', modo: 'mensal', ate: null, puladas: []
    });

    em(DIA_22_NOV);
    const r = await rodarCron('Bearer segredo-de-teste');
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.negocios, 2);
    assert.ok(r.body.criadas > 0);
    const deB = [...amb.fake.docs.keys()].filter((k) => k.startsWith('barbearias/negocio-b/agendamentos/')).length;
    const deSuspenso = [...amb.fake.docs.keys()].filter((k) => k.startsWith('barbearias/negocio-suspenso/agendamentos/')).length;
    assert.ok(deB > 0, 'negócio B foi renovado');
    assert.equal(deSuspenso, 0, 'negócio suspenso foi ignorado');

    const segunda = await rodarCron('Bearer segredo-de-teste');   // idempotente
    assert.equal(segunda.body.criadas, 0);
  } finally { delete process.env.CRON_SECRET; }
});

test('vercel.json agenda a rotina diária', () => {
  const v = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.deepEqual(v.crons, [{ path: '/api/cron-recorrencias', schedule: '0 9 * * *' }]);
});

test('datas puladas ficam na lista sem repetir a cada renovação e somem quando viram agendamento', async () => {
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/ocupado`, { profissionalId: 'prof1', dataChave: '2026-11-20', horario: '09:00', duracaoMin: 30, status: 'confirmado' });
  const criada = await chamar(serieBase());
  await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  let puladas = amb.fake.get(`barbearias/${SLUG}/recorrencias/${criada.body.serieId}`).puladas;
  assert.deepEqual(puladas.map((p) => p.dataChave), ['2026-11-20'], 'sem duplicatas');

  amb.fake.docs.delete(`barbearias/${SLUG}/agendamentos/ocupado`);          // o outro cliente cancelou: a vaga voltou
  const r = await chamar({ idToken: 'tok-dono1', action: 'renovar' });
  assert.equal(r.body.criadas, 1, 'a data pulada foi preenchida sozinha');
  puladas = amb.fake.get(`barbearias/${SLUG}/recorrencias/${criada.body.serieId}`).puladas;
  assert.deepEqual(puladas, []);
});
