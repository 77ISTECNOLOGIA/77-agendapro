// Sinal por Pix e limite de agendamentos por semana (servidor).

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, dataEmDias, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const criarAgendamento = require('../api/criar-agendamento');
const agendamentoCliente = require('../api/agendamento-cliente');
const configurar = require('../api/configurar-negocio');
const negocioApi = require('../api/negocio');
const ocupadosApi = require('../api/agendamentos-ocupados');
const { limparLimites } = require('../api/_lib/http');
const { crc16, normalizarChavePix, montarPixCopiaECola } = require('../api/_lib/pix');
const S = require('../api/_lib/sinal');
const { limparSinaisVencidos, avisarPendentes } = require('../api/_lib/pendencias');

const SLUG = 'barbearia-teste';
const W1 = '(21) 99999-1234';
const W2 = '(21) 98888-7777';
const CONFIG_SINAL = { ativo: true, percentual: 50, prazoHoras: 24, tipoChave: 'email', chavePix: 'dono@barbearia.com', nomeRecebedor: 'JOAO SILVA', cidadeRecebedor: 'RIO DE JANEIRO' };

async function chamar(handler, requisicao) { const r = res(); await handler(requisicao, r); limparLimites(); return r; }
const agendar = (extra = {}) => chamar(criarAgendamento, req('POST', { body: { slug: SLUG, whatsapp: W1, nome: 'Maria Souza', profissionalId: 'prof1',
  servicosIds: ['srv1', 'srv2'], dataChave: dataEmDias(3), horario: '10:00', ...extra } }));   // Corte 40 + Barba 35 = 75 (60 min)
const acaoSinal = (action, id, whats = W1) => req('POST', { body: { slug: SLUG, whatsapp: whats, action: 'sinal-' + action, agendamentoId: id } });
const path = (id) => `barbearias/${SLUG}/agendamentos/${id}`;

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  amb.notificacoes.length = 0;
  semearNegocio(amb.fake, SLUG, { sinal: CONFIG_SINAL });
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/notebook`, { token: 'tok-notebook' });
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner' });
});

// ---------------------------------------------------------------- Pix

test('pix: CRC16 confere com o vetor de teste do padrão e o "copia e cola" é consistente', () => {
  assert.equal(crc16('123456789'), '29B1');
  const p = montarPixCopiaECola({ chave: 'dono@barbearia.com', valor: 37.5, nome: 'João Silva', cidade: 'Rio de Janeiro', txid: 'abc123' });
  assert.match(p, /^000201/);
  assert.ok(p.includes('br.gov.bcb.pix0118dono@barbearia.com'));
  assert.ok(p.includes('540537.50'));
  assert.ok(p.includes('5910JOAO SILVA') && p.includes('6014RIO DE JANEIRO'), 'nome e cidade sem acento, em maiúsculas');
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)), 'CRC no fim bate com o conteúdo');
});

test('pix: normaliza e valida a chave por tipo', () => {
  assert.deepEqual(normalizarChavePix('cpf', '123.456.789-09'), { ok: true, chave: '12345678909' });
  assert.equal(normalizarChavePix('cpf', '123').ok, false);
  assert.deepEqual(normalizarChavePix('telefone', '(21) 99999-1234'), { ok: true, chave: '+5521999991234' });
  assert.deepEqual(normalizarChavePix('email', ' Dono@Barbearia.com '), { ok: true, chave: 'dono@barbearia.com' });
  assert.equal(normalizarChavePix('aleatoria', '123e4567-e89b-12d3-a456-426614174000').ok, true);
  assert.equal(normalizarChavePix('aleatoria', 'qualquer-coisa').ok, false);
  assert.equal(normalizarChavePix('', 'x').ok, false);
});

// ---------------------------------------------------------------- regras puras

test('prazo do sinal: 24 h, mas termina 2 h antes do horário e nunca dá menos de 30 min', () => {
  const agora = Date.UTC(2026, 10, 10, 13, 0);           // 10:00 em Brasília
  const iso = (ms) => new Date(ms).toISOString();
  // horário amanhã às 18:00 → 24 h inteiras
  assert.equal(S.calcularExpiracao({ agoraMs: agora, prazoHoras: 24, dataChave: '2026-11-11', horario: '18:00' }), iso(agora + 24 * 3600000));
  // horário hoje às 18:00 → até 16:00 (2 h antes)
  assert.equal(S.calcularExpiracao({ agoraMs: agora, prazoHoras: 24, dataChave: '2026-11-10', horario: '18:00' }), iso(Date.UTC(2026, 10, 10, 19, 0)));
  // horário hoje às 11:00 (60 min) → mínimo de 30 min, e nunca depois do próprio horário
  assert.equal(S.calcularExpiracao({ agoraMs: agora, prazoHoras: 24, dataChave: '2026-11-10', horario: '11:00' }), iso(agora + 30 * 60000));
});

test('semana de segunda a domingo; contagem ignora cancelados, sinais vencidos e o agendamento remarcado', () => {
  assert.deepEqual(S.semanaDaChave('2026-11-08'), { ini: '2026-11-02', fim: '2026-11-08' }, 'domingo fecha a semana');
  assert.deepEqual(S.semanaDaChave('2026-11-09'), { ini: '2026-11-09', fim: '2026-11-15' }, 'segunda abre a semana');
  const agora = Date.UTC(2026, 10, 1);
  const lista = [
    { id: 'a', dataChave: '2026-11-10', status: 'confirmado' },
    { id: 'b', dataChave: '2026-11-11', status: 'cancelado' },
    { id: 'c', dataChave: '2026-11-12', status: 'aguardando_sinal', sinalExpiraEm: new Date(agora - 1000).toISOString() },
    { id: 'd', dataChave: '2026-11-13', status: 'sinal_informado' },
    { id: 'e', dataChave: '2026-11-16', status: 'confirmado' }
  ];
  assert.equal(S.contarNaSemana(lista, '2026-11-11', agora), 2, 'a (confirmado) + d (sinal informado)');
  assert.equal(S.contarNaSemana(lista, '2026-11-11', agora, 'a'), 1, 'ignora o que está sendo remarcado');
  assert.equal(S.limiteSemanal({ limiteAgendamentosSemana: 2 }), 2);
  assert.equal(S.limiteSemanal({}), 0);
});

// ---------------------------------------------------------------- fluxo do sinal

test('com sinal ligado: reserva fica aguardando_sinal, devolve o Pix com 50% e NÃO avisa o dono ainda', async () => {
  const r = await agendar();
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.agendamento.status, 'aguardando_sinal');
  assert.equal(r.body.sinal.valor, 37.5);
  assert.match(r.body.sinal.pixCopiaECola, /^000201.*br\.gov\.bcb\.pix0118dono@barbearia\.com.*540537\.50.*6304[0-9A-F]{4}$/);
  assert.ok(Date.parse(r.body.sinal.expiraEm) > Date.now());
  assert.equal(amb.fake.get(path(r.body.id)).sinalValor, 37.5);
  assert.equal(amb.notificacoes.length, 0, 'o dono só é avisado quando o cliente informar o pagamento');
});

test('sem sinal configurado o fluxo continua igual (confirmado + push)', async () => {
  amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), sinal: { ...CONFIG_SINAL, ativo: false } });
  const r = await agendar();
  assert.equal(r.body.agendamento.status, 'confirmado');
  assert.equal(r.body.sinal, null);
  assert.equal(amb.notificacoes.length, 1);
});

test('a reserva aguardando sinal ocupa o horário; uma por cliente; e libera quando o prazo vence', async () => {
  const a = await agendar();
  assert.equal(a.statusCode, 201);
  const outroCliente = await agendar({ whatsapp: W2, nome: 'Outra' });
  assert.equal(outroCliente.statusCode, 409, 'horário reservado (aguardando sinal) não é vendido de novo');
  const mesmoCliente = await agendar({ dataChave: dataEmDias(4), horario: '15:00' });
  assert.equal(mesmoCliente.statusCode, 409);
  assert.match(mesmoCliente.body.erro, /aguardando o pagamento do sinal/);
  const publicas = await chamar(ocupadosApi, req('GET', { query: { slug: SLUG } }));
  assert.equal(publicas.body.ocupados.length, 1);

  // vence o prazo: o horário volta a ficar livre para todo mundo
  amb.fake.seed(path(a.body.id), { ...amb.fake.get(path(a.body.id)), sinalExpiraEm: new Date(Date.now() - 60000).toISOString() });
  const depois = await chamar(ocupadosApi, req('GET', { query: { slug: SLUG } }));
  assert.equal(depois.body.ocupados.length, 0);
  const livre = await agendar({ whatsapp: W2, nome: 'Outra' });
  assert.equal(livre.statusCode, 201);
});

test('"Já paguei": vira sinal_informado, avisa o dono uma única vez e não expira mais', async () => {
  const a = await agendar();
  const r = await chamar(agendamentoCliente, acaoSinal('informar', a.body.id));
  assert.equal(r.statusCode, 200);
  assert.equal(amb.fake.get(path(a.body.id)).status, 'sinal_informado');
  assert.equal(amb.notificacoes.length, 1);
  assert.equal(amb.notificacoes[0].notification.title, '💰 Sinal informado');
  assert.match(amb.notificacoes[0].notification.body, /^Maria informou o Pix de R\$ 37,50 — .* às 10:00 — Corte \+ Barba\. Confira e confirme no painel\.$/);
  assert.match(amb.notificacoes[0].webpush.fcmOptions.link, new RegExp(`/admin\\?agendamento=${a.body.id}$`));

  const denovo = await chamar(agendamentoCliente, acaoSinal('informar', a.body.id));
  assert.equal(denovo.statusCode, 200);
  assert.equal(denovo.body.jaInformado, true);
  assert.equal(amb.notificacoes.length, 1, 'tocar duas vezes não duplica o aviso');

  // mesmo "vencido" no relógio, depois de informado o horário continua do cliente
  amb.fake.seed(path(a.body.id), { ...amb.fake.get(path(a.body.id)), sinalExpiraEm: new Date(Date.now() - 60000).toISOString() });
  const ocup = await chamar(ocupadosApi, req('GET', { query: { slug: SLUG } }));
  assert.equal(ocup.body.ocupados.length, 1);
});

test('informar: só o dono da reserva, e não depois do prazo', async () => {
  const a = await agendar();
  const alheio = await chamar(agendamentoCliente, acaoSinal('informar', a.body.id, W2));
  assert.equal(alheio.statusCode, 404);
  amb.fake.seed(path(a.body.id), { ...amb.fake.get(path(a.body.id)), sinalExpiraEm: new Date(Date.now() - 60000).toISOString() });
  const vencido = await chamar(agendamentoCliente, acaoSinal('informar', a.body.id));
  assert.equal(vencido.statusCode, 410);
  assert.match(vencido.body.erro, /prazo/);
  assert.equal(amb.notificacoes.length, 0);
});

test('dados do pagamento: só para o próprio cliente; chave Pix não vaza na API pública', async () => {
  const a = await agendar();
  const meus = await chamar(agendamentoCliente, acaoSinal('dados', a.body.id));
  assert.equal(meus.statusCode, 200);
  assert.equal(meus.body.valor, 37.5);
  assert.match(meus.body.pixCopiaECola, /dono@barbearia\.com/);
  assert.equal((await chamar(agendamentoCliente, acaoSinal('dados', a.body.id, W2))).statusCode, 404);

  const pub = await chamar(negocioApi, req('GET', { query: { slug: SLUG } }));
  assert.deepEqual(pub.body.barbearia.sinal, { ativo: true, percentual: 50, prazoHoras: 24 });
  assert.doesNotMatch(JSON.stringify(pub.body), /dono@barbearia\.com|chavePix|JOAO SILVA/);
});

test('cliente cancela reserva sem sinal sem aviso ao dono; depois de informar o pagamento precisa falar com o estabelecimento', async () => {
  const a = await agendar();
  const c = await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: W1, action: 'cancelar', agendamentoId: a.body.id } }));
  assert.equal(c.statusCode, 200);
  assert.equal(amb.fake.get(path(a.body.id)).status, 'cancelado');
  assert.equal(amb.notificacoes.length, 0);

  const b = await agendar({ dataChave: dataEmDias(4) });
  await chamar(agendamentoCliente, acaoSinal('informar', b.body.id));
  const d = await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: W1, action: 'cancelar', agendamentoId: b.body.id } }));
  assert.equal(d.statusCode, 400);
  assert.match(d.body.erro, /fale direto/);
});

test('limpeza diária: reserva sem sinal vencida vira cancelada; push resume pagamentos para confirmar', async () => {
  const a = await agendar();
  amb.fake.seed(path(a.body.id), { ...amb.fake.get(path(a.body.id)), sinalExpiraEm: new Date(Date.now() - 60000).toISOString() });
  const b = await agendar({ whatsapp: W2, nome: 'Outra', dataChave: dataEmDias(5) });
  await chamar(agendamentoCliente, acaoSinal('informar', b.body.id, W2));
  amb.notificacoes.length = 0;

  const limpos = await limparSinaisVencidos(amb.fake.doc(`barbearias/${SLUG}`));
  assert.equal(limpos, 1);
  assert.equal(amb.fake.get(path(a.body.id)).status, 'cancelado');
  assert.equal(amb.fake.get(path(a.body.id)).canceladoPor, 'sinal-expirado');
  assert.equal(amb.fake.get(path(b.body.id)).status, 'sinal_informado');

  const total = await avisarPendentes(amb.fake.doc(`barbearias/${SLUG}`), { dataChave: dataEmDias(0), minutos: 6 * 60 });
  assert.equal(total, 1);
  assert.match(amb.notificacoes[0].notification.body, /1 pagamento de sinal para confirmar/);
});

// ---------------------------------------------------------------- limite por semana

test('limite semanal: terceiro agendamento na mesma semana é recusado; outra semana passa; cancelar libera', async () => {
  amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), sinal: { ...CONFIG_SINAL, ativo: false }, limiteAgendamentosSemana: 2 });
  const { ini } = S.semanaDaChave(dataEmDias(14));
  const dia = (n) => S.semanaDaChave(ini).ini && require('../api/_lib/tempo').somarDias(ini, n);
  const a = await agendar({ dataChave: dia(1), horario: '09:00' });
  const b = await agendar({ dataChave: dia(2), horario: '09:00' });
  assert.equal(a.statusCode, 201); assert.equal(b.statusCode, 201);
  const c = await agendar({ dataChave: dia(3), horario: '09:00' });
  assert.equal(c.statusCode, 409);
  assert.match(c.body.erro, /2 agendamentos na semana de \d\d\/\d\d a \d\d\/\d\d/);
  const outraSemana = await agendar({ dataChave: dia(8), horario: '09:00' });
  assert.equal(outraSemana.statusCode, 201);
  const outroCliente = await agendar({ whatsapp: W2, nome: 'Outra', dataChave: dia(3), horario: '09:00' });
  assert.equal(outroCliente.statusCode, 201, 'o limite é por cliente');

  await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: W1, action: 'cancelar', agendamentoId: a.body.id } }));
  const agora = await agendar({ dataChave: dia(3), horario: '11:00' });
  assert.equal(agora.statusCode, 201, 'cancelar libera uma vaga na semana');
});

test('limite semanal vale também para remarcar para uma semana cheia', async () => {
  amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), sinal: { ...CONFIG_SINAL, ativo: false }, limiteAgendamentosSemana: 2 });
  const { somarDias } = require('../api/_lib/tempo');
  const { ini } = S.semanaDaChave(dataEmDias(14));
  await agendar({ dataChave: somarDias(ini, 1), horario: '09:00' });
  await agendar({ dataChave: somarDias(ini, 2), horario: '09:00' });
  const fora = await agendar({ dataChave: somarDias(ini, 9), horario: '09:00' });
  const r = await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: W1, action: 'remarcar', agendamentoId: fora.body.id, novaDataChave: somarDias(ini, 3), novoHorario: '09:00' } }));
  assert.equal(r.statusCode, 409);
  assert.match(r.body.erro, /limite/);
  const mesmaSemana = await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: W1, action: 'remarcar', agendamentoId: fora.body.id, novaDataChave: somarDias(ini, 11), novoHorario: '10:00' } }));
  assert.equal(mesmaSemana.statusCode, 200, 'dentro da própria semana (o agendamento não conta contra si mesmo)');
});

// ---------------------------------------------------------------- configuração pelo dono

test('configurar: exige login do dono, valida a chave Pix e grava sinal + limite', async () => {
  const corpo = (extra = {}) => ({ idToken: 'tok-dono1', limiteAgendamentosSemana: 2,
    sinal: { ativo: true, percentual: 40, prazoHoras: 12, tipoChave: 'cpf', chavePix: '123.456.789-09', nomeRecebedor: 'João da Silva', cidadeRecebedor: 'Niterói', ...extra } });
  assert.equal((await chamar(configurar, req('POST', { body: { sinal: {} } }))).statusCode, 401);
  assert.equal((await chamar(configurar, req('POST', { body: { ...corpo(), idToken: 'lixo' } }))).statusCode, 401);
  assert.equal((await chamar(configurar, req('POST', { body: { ...corpo(), idToken: 'tok-sem-negocio' } }))).statusCode, 403);

  for (const ruim of [{ chavePix: '123' }, { percentual: 5 }, { percentual: 101 }, { prazoHoras: 0 }, { prazoHoras: 99 }, { nomeRecebedor: '' }, { cidadeRecebedor: '' }]) {
    const r = await chamar(configurar, req('POST', { body: corpo(ruim) }));
    assert.equal(r.statusCode, 400, JSON.stringify(ruim));
  }
  assert.equal((await chamar(configurar, req('POST', { body: { ...corpo(), limiteAgendamentosSemana: 40 } }))).statusCode, 400);

  const ok = await chamar(configurar, req('POST', { body: corpo() }));
  assert.equal(ok.statusCode, 200);
  const salvo = amb.fake.get(`barbearias/${SLUG}`);
  assert.deepEqual(salvo.sinal, { ativo: true, percentual: 40, prazoHoras: 12, tipoChave: 'cpf', chavePix: '12345678909', nomeRecebedor: 'JOAO DA SILVA', cidadeRecebedor: 'NITEROI' });
  assert.equal(salvo.limiteAgendamentosSemana, 2);
});

test('configurar: dá para desligar o sinal sem informar chave', async () => {
  const r = await chamar(configurar, req('POST', { body: { idToken: 'tok-dono1', limiteAgendamentosSemana: 0,
    sinal: { ativo: false, percentual: 50, prazoHoras: 24, tipoChave: '', chavePix: '', nomeRecebedor: '', cidadeRecebedor: '' } } }));
  assert.equal(r.statusCode, 200);
  assert.equal(amb.fake.get(`barbearias/${SLUG}`).sinal.ativo, false);
  const nova = await agendar();
  assert.equal(nova.body.agendamento.status, 'confirmado');
});
