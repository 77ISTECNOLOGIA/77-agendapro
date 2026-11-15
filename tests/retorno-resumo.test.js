// Retorno inteligente (ritmo de cada cliente, aviso de retorno) e resumo semanal do dono.

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, dataEmDias, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const retorno = require('../api/_lib/retorno');
const resumo = require('../api/_lib/resumo-semanal');
const cron = require('../api/cron-recorrencias');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const N = `barbearias/${SLUG}`;
const WHATS = '5521999990001';
const agoraIso = () => new Date().toISOString();

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  amb.notificacoes.length = 0;
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed(`${N}/clientes/${WHATS}`, { nome: 'Maria Souza', whatsapp: WHATS, donoVe: true, totalAgendamentos: 2 });
});

function concluido(id, dataChave, extra = {}) {
  amb.fake.seed(`${N}/agendamentos/${id}`, {
    clienteWhatsapp: WHATS, clienteNome: 'Maria Souza', profissionalId: 'prof1', profissionalNome: 'João Silva',
    servicos: [{ id: 'srv1', nome: 'Corte', preco: 40, duracaoMin: 30 }], dataChave, horario: '10:00', duracaoMin: 30,
    valorTotal: 40, status: 'concluido', concluidoEm: agoraIso(), donoVe: true, ...extra
  });
}

// ---------------------------------------------------------------- ritmo do cliente
test('calcularRetorno: ritmo próprio pela média dos últimos intervalos, com limites; sem histórico usa 30 dias', () => {
  const um = retorno.calcularRetorno(['2026-10-01']);
  assert.deepEqual([um.cadenciaDias, um.personalizada, um.retornoEm], [30, false, '2026-10-31']);
  const dois = retorno.calcularRetorno(['2026-10-22', '2026-10-01']);                       // fora de ordem
  assert.deepEqual([dois.cadenciaDias, dois.personalizada, dois.ultima, dois.retornoEm], [21, true, '2026-10-22', '2026-11-12']);
  const tres = retorno.calcularRetorno(['2026-08-01', '2026-08-29', '2026-09-26', '2026-10-24']);   // 28, 28, 28
  assert.equal(tres.cadenciaDias, 28);
  assert.equal(retorno.calcularRetorno(['2026-10-01', '2026-10-05']).cadenciaDias, 14);      // quem volta toda hora: mínimo de 14
  assert.equal(retorno.calcularRetorno(['2026-01-01', '2026-10-05']).cadenciaDias, 90);      // quem some: máximo de 90
  assert.equal(retorno.calcularRetorno(['2026-10-01', '2026-10-01']).cadenciaDias, 30);      // datas repetidas contam uma vez
  assert.equal(retorno.calcularRetorno([]), null);
});

test('atualizarEstatisticas: grava o ritmo na ficha do cliente, é repetível e separa a ficha do sócio', async () => {
  concluido('a1', dataEmDias(-30)); concluido('a2', dataEmDias(-9));
  const r = await retorno.atualizarEstatisticas();
  assert.equal(r.atualizadas, 1);
  const f = amb.fake.get(`${N}/clientes/${WHATS}`);
  assert.deepEqual(f.ultimasVisitas, [dataEmDias(-30), dataEmDias(-9)]);
  assert.equal(f.cadenciaDias, 21); assert.equal(f.cadenciaPersonalizada, true);
  assert.equal(f.retornoEm, dataEmDias(12)); assert.equal(f.retornoPushEm, dataEmDias(12));
  const outra = await retorno.atualizarEstatisticas();                                        // mesma rodada de novo: nada muda
  assert.equal(outra.atualizadas, 0);
  // sócio: ficha própria (profissional__whatsapp); cliente sem ficha é ignorado
  amb.fake.seed(`${N}/clientes/profS__${WHATS}`, { nome: 'Maria', whatsapp: WHATS, donoVe: false });
  concluido('s1', dataEmDias(-2), { profissionalId: 'profS', donoVe: false });
  concluido('x1', dataEmDias(-1), { clienteWhatsapp: '5521911110000' });
  await retorno.atualizarEstatisticas();
  assert.deepEqual(amb.fake.get(`${N}/clientes/profS__${WHATS}`).ultimasVisitas, [dataEmDias(-2)]);
  assert.equal(amb.fake.get(`${N}/clientes/5521911110000`), undefined);
});

test('uma nova visita reabre o ciclo: apaga o aviso anterior e agenda o próximo', async () => {
  amb.fake.seed(`${N}/clientes/${WHATS}`, { nome: 'Maria', whatsapp: WHATS, donoVe: true, ultimasVisitas: [dataEmDias(-60)], cadenciaDias: 30, retornoEm: dataEmDias(-30), retornoAvisadoEm: agoraIso(), retornoAdiadoAte: dataEmDias(3) });
  concluido('novo', dataEmDias(-1));
  await retorno.atualizarEstatisticas();
  const f = amb.fake.get(`${N}/clientes/${WHATS}`);
  assert.equal(f.retornoAvisadoEm, undefined); assert.equal(f.retornoAdiadoAte, undefined);
  assert.equal(f.retornoPushEm, f.retornoEm);
  assert.equal(f.ultimasVisitas.length, 2);
});

// ---------------------------------------------------------------- aviso de retorno
function fichaVencida(extra = {}) {
  amb.fake.seed(`${N}/clientes/${WHATS}`, { nome: 'Maria Souza', whatsapp: WHATS, donoVe: true, ultimasVisitas: [dataEmDias(-40)], cadenciaDias: 30, retornoEm: dataEmDias(-10), retornoPushEm: dataEmDias(-1), ...extra });
  amb.fake.seed(`${N}/dispositivosCliente/c1`, { whatsapp: WHATS, token: 'token-do-aparelho-da-maria-0000001' });
}

test('avisarRetornos: cliente com o app que passou do tempo recebe UM push e o ciclo fecha', async () => {
  fichaVencida();
  const r = await retorno.avisarRetornos();
  assert.equal(r.avisados, 1);
  assert.equal(amb.notificacoes.length, 1);
  assert.match(amb.notificacoes[0].notification.title, /Sentimos sua falta/);
  assert.match(amb.notificacoes[0].notification.body, /^Barbearia Teste\nFaz 40 dias desde o seu último atendimento\.\nToque para agendar\.$/);
  const f = amb.fake.get(`${N}/clientes/${WHATS}`);
  assert.equal(f.retornoPushEm, undefined); assert.ok(f.retornoAvisadoEm);
  assert.equal((await retorno.avisarRetornos()).vencidos, 0);                                // não avisa de novo
  assert.equal(amb.notificacoes.length, 1);
});

test('avisarRetornos: não avisa quem já tem horário marcado, quem não tem o app (conta como "sem app") nem se o negócio desligou', async () => {
  fichaVencida();
  amb.fake.seed(`${N}/agendamentos/futuro`, { clienteWhatsapp: WHATS, dataChave: dataEmDias(5), horario: '10:00', status: 'confirmado', profissionalId: 'prof1', duracaoMin: 30, donoVe: true });
  let r = await retorno.avisarRetornos();
  assert.equal(r.descartados, 1); assert.equal(amb.notificacoes.length, 0);
  assert.equal(amb.fake.get(`${N}/clientes/${WHATS}`).retornoPushEm, undefined);

  fichaVencida(); amb.fake.docs.delete(`${N}/agendamentos/futuro`); amb.fake.docs.delete(`${N}/dispositivosCliente/c1`);
  r = await retorno.avisarRetornos();
  assert.equal(r.semApp, 1); assert.equal(amb.notificacoes.length, 0);

  fichaVencida(); amb.fake.seed(N, { ...amb.fake.get(N), retornoAutomatico: false });
  r = await retorno.avisarRetornos();
  assert.equal(r.descartados, 1); assert.equal(amb.notificacoes.length, 0);
});

// ---------------------------------------------------------------- resumo semanal
const SEG = '2026-11-16';                                  // segunda-feira: a semana do resumo é 09/11 a 15/11
function ag(id, dataChave, extra = {}) {
  amb.fake.seed(`${N}/agendamentos/${id}`, { clienteWhatsapp: '5521900000000', profissionalId: 'prof1', dataChave, horario: '10:00', status: 'concluido', valorTotal: 50, donoVe: true, servicos: [], duracaoMin: 30, ...extra });
}

test('montarResumo: faturamento, comparação com a semana anterior, ticket, melhor dia, faltas e retorno', () => {
  const ags = [
    { dataChave: '2026-11-10', status: 'concluido', valorTotal: 40, clienteWhatsapp: 'a' },       // terça
    { dataChave: '2026-11-14', status: 'concluido', valorTotal: 70, clienteWhatsapp: 'b' },       // sábado (melhor dia)
    { dataChave: '2026-11-14', status: 'concluido', valorTotal: 40, clienteWhatsapp: 'a' },
    { dataChave: '2026-11-12', status: 'cancelado', clienteWhatsapp: 'c' },
    { dataChave: '2026-11-13', status: 'cancelado', motivoCancelamento: 'nao-compareceu', clienteWhatsapp: 'd' },
    { dataChave: '2026-11-03', status: 'concluido', valorTotal: 100, clienteWhatsapp: 'a' },       // semana anterior
    { dataChave: '2026-11-20', status: 'concluido', valorTotal: 999, clienteWhatsapp: 'a' }        // fora do período
  ];
  const r = resumo.montarResumo(ags, SEG, { voltar: 8 });
  assert.equal(r.titulo, '📊 Sua semana (09/11 a 15/11)');
  assert.equal(r.corpo, [
    'Faturamento: R$ 150,00 (+50% vs semana anterior)',
    'Atendimentos: 3 · Ticket médio: R$ 50,00',
    'Melhor dia: sábado (R$ 110,00)',
    'Faltas: 1 · Cancelados: 1',
    'Para chamar de volta: 8 clientes'
  ].join('\n'));
  assert.equal(r.semMovimento, false);
  assert.equal(resumo.montarResumo([], SEG).semMovimento, true);
});

test('enviarResumos: o dono recebe os números do lado dele; o sócio recebe os próprios, só nos aparelhos dele', async () => {
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner', email: 'dono@teste.com' });
  amb.fake.seed('usuarios/socio1', { barbeariaId: SLUG, role: 'profissional', papel: 'socio', profissionalId: 'profS', permissoes: { verTodos: false, gerirNegocio: false } });
  amb.fake.seed(`${N}/profissionais/profS`, { nome: 'Sócio', ativo: true, socio: true });
  amb.fake.seed(`${N}/dispositivos/d-dono`, { uid: 'dono1', token: 'tok-aparelho-do-dono-1234567890' });
  amb.fake.seed(`${N}/dispositivos/d-socio`, { uid: 'socio1', token: 'tok-aparelho-do-socio-123456789' });
  ag('d1', '2026-11-10', { valorTotal: 60 });
  ag('s1', '2026-11-11', { valorTotal: 200, profissionalId: 'profS', donoVe: false });
  amb.fake.seed(`${N}/clientes/volta`, { nome: 'Pedro', whatsapp: '5521933330000', donoVe: true, retornoEm: '2026-11-01' });
  const r = await resumo.enviarResumos({ hojeChave: SEG });
  assert.equal(r.enviados, 2);
  const dono = amb.notificacoes.find((n) => n.token === 'tok-aparelho-do-dono-1234567890');
  const socio = amb.notificacoes.find((n) => n.token === 'tok-aparelho-do-socio-123456789');
  assert.match(dono.notification.body, /Faturamento: R\$ 60,00/);
  assert.match(dono.notification.body, /Para chamar de volta: 1 cliente$/);
  assert.doesNotMatch(dono.notification.body, /200/);                                       // o dono não vê o faturamento do sócio
  assert.match(socio.notification.body, /Faturamento: R\$ 200,00/);
  assert.doesNotMatch(socio.notification.body, /R\$ 60,00/);
});

test('enviarResumos: semana sem movimento e negócio que desligou não recebem nada', async () => {
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner' });
  amb.fake.seed(`${N}/dispositivos/d-dono`, { uid: 'dono1', token: 'tok-aparelho-do-dono-1234567890' });
  assert.equal((await resumo.enviarResumos({ hojeChave: SEG })).enviados, 0);              // sem atendimentos
  ag('d1', '2026-11-10');
  amb.fake.seed(N, { ...amb.fake.get(N), resumoSemanal: false });
  assert.equal((await resumo.enviarResumos({ hojeChave: SEG })).enviados, 0);              // desligado
  assert.equal(amb.notificacoes.length, 0);
});

// ---------------------------------------------------------------- rotina
test('rotina: ?tarefa=retorno e ?tarefa=resumo exigem a senha e respondem com o resumo', async () => {
  const antes = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'segredo-de-teste';
  try {
    for (const tarefa of ['retorno', 'resumo']) {
      const sem = res(); await cron({ method: 'GET', query: { tarefa }, headers: {} }, sem);
      assert.equal(sem.statusCode, 401);
      const ok = res(); await cron({ method: 'GET', query: { tarefa }, headers: { authorization: 'Bearer segredo-de-teste' } }, ok);
      assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    }
    const diaria = res(); await cron({ method: 'GET', query: {}, headers: { authorization: 'Bearer segredo-de-teste' } }, diaria);
    assert.equal(diaria.statusCode, 200);
    assert.ok(diaria.body.retorno, 'a rotina diária também roda o retorno inteligente');
  } finally { if (antes === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = antes; }
});
