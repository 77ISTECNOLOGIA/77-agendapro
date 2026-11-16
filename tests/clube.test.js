// Clube de assinatura: planos, assinantes, cobertura no agendamento (R$ 0 com saldo), travas e aviso de vencimento.

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, dataEmDias, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const configurar = require('../api/configurar-negocio');
const criarAgendamento = require('../api/criar-agendamento');
const agendamentoCliente = require('../api/agendamento-cliente');
const clube = require('../api/_lib/clube');
const { limparLimites } = require('../api/_lib/http');
const { hojeChaveBrasil, somarDias } = require('../api/_lib/tempo');

const SLUG = 'barbearia-teste';
const N = `barbearias/${SLUG}`;
const WHATS = '(21) 99999-1234';
const WHATS_NORM = '5521999991234';

async function chamarCfg(corpo, token = 'tok-dono1') { const r = res(); await configurar(req('POST', { body: { idToken: token, ...corpo } }), r); return r; }
async function agendar(extra = {}) {
  const r = res();
  await criarAgendamento(req('POST', { body: { slug: SLUG, whatsapp: WHATS, nome: 'Maria Souza', profissionalId: 'prof1', servicosIds: ['srv1'], dataChave: dataEmDias(3), horario: '10:00', ...extra } }), r);
  limparLimites();
  return r;
}
const PLANO = { nome: 'Clube do Corte', preco: 65, usosPorMes: 2, servicosIds: ['srv1'] };
async function criarPlanoEAssinante(plano = PLANO) {
  const p = await chamarCfg({ action: 'clube-plano', plano });
  assert.equal(p.statusCode, 200, JSON.stringify(p.body));
  const a = await chamarCfg({ action: 'clube-assinar', nome: 'Maria Souza', whatsapp: WHATS, planoId: p.body.id, forma: 'pix' });
  assert.equal(a.statusCode, 200, JSON.stringify(a.body));
  return { planoId: p.body.id, assinaturaId: a.body.id };
}

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  amb.notificacoes.length = 0;
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner', email: 'dono@teste.com' });
  amb.fake.seed('usuarios/socio1', { barbeariaId: SLUG, role: 'profissional', papel: 'socio', profissionalId: 'prof1', permissoes: { verTodos: false, gerirNegocio: false } });
});

// ---------------------------------------------------------------- planos e assinantes (painel)
test('plano: validações e edição; só o dono mexe no clube', async () => {
  for (const ruim of [{ ...PLANO, nome: 'A' }, { ...PLANO, preco: 0 }, { ...PLANO, usosPorMes: 99 }, { ...PLANO, servicosIds: [] }, { ...PLANO, servicosIds: ['nao-existe'] }]) {
    assert.equal((await chamarCfg({ action: 'clube-plano', plano: ruim })).statusCode, 400);
  }
  const ok = await chamarCfg({ action: 'clube-plano', plano: PLANO });
  assert.equal(ok.statusCode, 200);
  const ed = await chamarCfg({ action: 'clube-plano', plano: { ...PLANO, id: ok.body.id, preco: 70, usosPorMes: 0 } });   // 0 = ilimitado
  assert.equal(ed.statusCode, 200);
  assert.equal(amb.fake.get(`${N}/planos/${ok.body.id}`).preco, 70);
  assert.equal((await chamarCfg({ action: 'clube-plano', plano: { ...PLANO, id: 'inexistente' } })).statusCode, 404);
  assert.equal((await chamarCfg({ action: 'clube-listar' }, 'tok-socio1')).statusCode, 403);
  assert.equal((await chamarCfg({ action: 'clube-listar' }, 'lixo')).statusCode, 401);
});

test('assinar: cria o ciclo de 30 dias com o pagamento; não duplica; renovar só perto do vencimento; cancelar', async () => {
  const { assinaturaId } = await criarPlanoEAssinante();
  const a = amb.fake.get(`${N}/assinaturas/${assinaturaId}`);
  assert.equal(a.clienteWhatsapp, WHATS_NORM); assert.equal(a.cicloInicio, hojeChaveBrasil()); assert.equal(a.venceEm, somarDias(hojeChaveBrasil(), 30));
  assert.equal(a.pagamentos.length, 1); assert.equal(a.pagamentos[0].valor, 65);
  const dup = await chamarCfg({ action: 'clube-assinar', nome: 'Maria', whatsapp: WHATS, planoId: a.planoId });
  assert.equal(dup.statusCode, 409);
  assert.equal((await chamarCfg({ action: 'clube-renovar', id: assinaturaId })).statusCode, 409);                // ainda faltam 30 dias
  amb.fake.seed(`${N}/assinaturas/${assinaturaId}`, { ...a, venceEm: somarDias(hojeChaveBrasil(), 2) });
  const ren = await chamarCfg({ action: 'clube-renovar', id: assinaturaId, forma: 'dinheiro' });
  assert.equal(ren.statusCode, 200, JSON.stringify(ren.body));
  const depois = amb.fake.get(`${N}/assinaturas/${assinaturaId}`);
  assert.equal(depois.venceEm, somarDias(hojeChaveBrasil(), 30)); assert.equal(depois.pagamentos.length, 2);
  const lista = await chamarCfg({ action: 'clube-listar' });
  assert.equal(lista.body.kpis.assinantesAtivos, 1); assert.equal(lista.body.kpis.receitaRecorrente, 65);
  assert.equal((await chamarCfg({ action: 'clube-cancelar', id: assinaturaId })).statusCode, 200);
  assert.equal((await chamarCfg({ action: 'clube-listar' })).body.kpis.assinantesAtivos, 0);
});

// ---------------------------------------------------------------- cobertura no agendamento
test('agendamento de assinante com serviço do plano: incluso (R$ 0), guarda o plano e nunca pede sinal', async () => {
  await criarPlanoEAssinante();
  amb.fake.seed(N, { ...amb.fake.get(N), sinal: { ativo: true, percentual: 50, prazoHoras: 24, tipoChave: 'cpf', chavePix: '52998224725', nomeRecebedor: 'Lipão', cidadeRecebedor: 'Rio' } });
  const r = await agendar({ valorEsperado: 0 });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const ag = amb.fake.get(`${N}/agendamentos/${r.body.id}`);
  assert.equal(ag.valorTotal, 0); assert.equal(ag.valorTabela, 40); assert.equal(ag.usaPlano, true); assert.equal(ag.planoNome, 'Clube do Corte');
  assert.equal(ag.status, 'confirmado'); assert.equal(r.body.sinal, null);
  const caro = await agendar({ valorEsperado: 40, horario: '11:00' });                            // a tela ainda mostrava o preço cheio
  assert.equal(caro.statusCode, 409); assert.match(caro.body.erro, /O valor mudou para R\$ 0,00/);
});

test('serviço fora do plano, sem saldo, data fora do ciclo e cliente sem plano pagam o preço normal', async () => {
  await criarPlanoEAssinante();                                                                    // 2 usos, só o srv1
  const fora = await agendar({ servicosIds: ['srv1', 'srv2'] });
  assert.equal(amb.fake.get(`${N}/agendamentos/${fora.body.id}`).valorTotal, 75);               // srv2 não está no plano: tudo normal
  assert.equal(amb.fake.get(`${N}/agendamentos/${fora.body.id}`).usaPlano, undefined);
  const um = await agendar({ horario: '11:00' }); const dois = await agendar({ horario: '12:00' });
  assert.equal(amb.fake.get(`${N}/agendamentos/${um.body.id}`).valorTotal, 0);
  assert.equal(amb.fake.get(`${N}/agendamentos/${dois.body.id}`).valorTotal, 0);
  const tres = await agendar({ horario: '13:00' });                                                // 2 reservas = saldo zerado
  assert.equal(amb.fake.get(`${N}/agendamentos/${tres.body.id}`).valorTotal, 40);
  // cancelar devolve o uso
  amb.fake.seed(`${N}/agendamentos/${um.body.id}`, { ...amb.fake.get(`${N}/agendamentos/${um.body.id}`), status: 'cancelado' });
  const quatro = await agendar({ horario: '14:00' });
  assert.equal(amb.fake.get(`${N}/agendamentos/${quatro.body.id}`).valorTotal, 0);
  // data depois do vencimento
  const longe = await agendar({ dataChave: dataEmDias(45), horario: '10:00' });
  assert.equal(amb.fake.get(`${N}/agendamentos/${longe.body.id}`).valorTotal, 40);
  // quem não assina
  const outro = res();
  await criarAgendamento(req('POST', { body: { slug: SLUG, whatsapp: '(21) 98888-0000', nome: 'João', profissionalId: 'prof1', servicosIds: ['srv1'], dataChave: dataEmDias(4), horario: '10:00' } }), outro);
  assert.equal(amb.fake.get(`${N}/agendamentos/${outro.body.id}`).valorTotal, 40);
});

test('atendimento concluído consome o uso; plano ilimitado nunca acaba', async () => {
  const { assinaturaId } = await criarPlanoEAssinante({ ...PLANO, usosPorMes: 1 });
  const um = await agendar();
  const ass = () => amb.fake.get(`${N}/assinaturas/${assinaturaId}`);
  const ags = async () => clube.agendamentosDaAssinatura(amb.fake.doc(N), assinaturaId);
  assert.deepEqual({ ...clube.saldoDe(ass(), await ags()) }, { usados: 0, reservados: 1, restantes: 0, ilimitado: false });
  amb.fake.seed(`${N}/agendamentos/${um.body.id}`, { ...amb.fake.get(`${N}/agendamentos/${um.body.id}`), status: 'concluido' });
  assert.deepEqual({ ...clube.saldoDe(ass(), await ags()) }, { usados: 1, reservados: 0, restantes: 0, ilimitado: false });
  const sem = await agendar({ horario: '11:00' });
  assert.equal(amb.fake.get(`${N}/agendamentos/${sem.body.id}`).valorTotal, 40);                  // usou o único
  // ilimitado
  amb.fake.seed(`${N}/assinaturas/${assinaturaId}`, { ...ass(), usosPorMes: 0 });
  for (const h of ['12:00', '13:00', '14:00']) assert.equal(amb.fake.get(`${N}/agendamentos/${(await agendar({ horario: h })).body.id}`).valorTotal, 0);
});

test('o que o cliente vê (action assinatura) e a trava de remarcar para fora do ciclo', async () => {
  const { assinaturaId } = await criarPlanoEAssinante();
  const consulta = async (whats) => { const r = res(); await agendamentoCliente(req('POST', { body: { slug: SLUG, whatsapp: whats, action: 'assinatura' } }), r); limparLimites(); return r; };
  let r = await consulta(WHATS);
  assert.equal(r.body.ativa, true); assert.equal(r.body.planoNome, 'Clube do Corte'); assert.equal(r.body.restantes, 2); assert.deepEqual(r.body.servicosIds, ['srv1']);
  assert.equal((await consulta('(21) 97777-0000')).body.ativa, false);
  const ag = await agendar();
  assert.equal((await consulta(WHATS)).body.restantes, 1);
  // remarcar para depois do vencimento: recusado; dentro do ciclo: ok
  const ass = amb.fake.get(`${N}/assinaturas/${assinaturaId}`);
  const remarcar = async (novaDataChave) => { const x = res(); await agendamentoCliente(req('POST', { body: { slug: SLUG, whatsapp: WHATS, action: 'remarcar', agendamentoId: ag.body.id, novaDataChave, novoHorario: '15:00' } }), x); limparLimites(); return x; };
  const fora = await remarcar(somarDias(ass.venceEm, 5));
  assert.equal(fora.statusCode, 409); assert.match(fora.body.erro, /usa o seu plano, que vale até/);
  assert.equal((await remarcar(dataEmDias(6))).statusCode, 200);
});

// ---------------------------------------------------------------- vencimento
test('aviso de vencimento: 3 dias antes, uma vez, só a quem tem o app', async () => {
  const { assinaturaId } = await criarPlanoEAssinante();
  amb.fake.seed(`${N}/dispositivosCliente/c1`, { whatsapp: WHATS_NORM, token: 'token-do-aparelho-da-maria-0000001' });
  const a = amb.fake.get(`${N}/assinaturas/${assinaturaId}`);
  amb.fake.seed(`${N}/assinaturas/${assinaturaId}`, { ...a, venceEm: somarDias(hojeChaveBrasil(), 3) });
  const r = await clube.avisarVencimentos({ firestore: amb.fake });
  assert.equal(r.avisados, 1);
  assert.match(amb.notificacoes[0].notification.title, /vence em 3 dias/);
  assert.match(amb.notificacoes[0].notification.body, /Clube do Corte: vence em/);
  await clube.avisarVencimentos({ firestore: amb.fake });
  assert.equal(amb.notificacoes.length, 1);                                                         // não repete
});
