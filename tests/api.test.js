// Testes das funções serverless contra um Firestore falso em memória.

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, dataEmDias, semearNegocio } = require('./_helpers');

const amb = montarAmbiente(); // precisa vir ANTES de carregar os handlers

const criarAgendamento = require('../api/criar-agendamento');
const agendamentoCliente = require('../api/agendamento-cliente');
const cadastrarNegocio = require('../api/cadastrar-negocio');
const negocio = require('../api/negocio');
const ocupados = require('../api/agendamentos-ocupados');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const WHATS = '(21) 99999-1234';
const WHATS_NORM = '5521999991234';

function corpoAgendamento(extra = {}) {
  return { slug: SLUG, whatsapp: WHATS, nome: 'Maria Souza', profissionalId: 'prof1',
    servicosIds: ['srv1', 'srv2'], dataChave: dataEmDias(3), horario: '10:00', ...extra };
}

async function chamar(handler, requisicao) {
  const r = res();
  await handler(requisicao, r);
  return r;
}

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  amb.notificacoes.length = 0;
  semearNegocio(amb.fake, SLUG);
});

// ---------------------------------------------------------------- criar-agendamento

test('criar-agendamento: grava com preço e duração calculados NO SERVIDOR', async () => {
  const r = await chamar(criarAgendamento, req('POST', {
    body: corpoAgendamento({ valorTotal: 0.01, duracaoMin: 1, status: 'concluido' }) // adulteração ignorada
  }));
  assert.equal(r.statusCode, 201);
  const ag = amb.fake.get(`barbearias/${SLUG}/agendamentos/${r.body.id}`);
  assert.equal(ag.valorTotal, 75);
  assert.equal(ag.duracaoMin, 60);
  assert.equal(ag.status, 'confirmado');
  assert.equal(ag.clienteWhatsapp, WHATS_NORM);
  assert.equal(ag.profissionalNome, 'João Silva');
});

test('criar-agendamento: cria o cliente e incrementa a contagem na visita seguinte', async () => {
  await chamar(criarAgendamento, req('POST', { body: corpoAgendamento() }));
  assert.equal(amb.fake.get(`barbearias/${SLUG}/clientes/${WHATS_NORM}`).totalAgendamentos, 1);
  await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ horario: '14:00' }) }));
  const c = amb.fake.get(`barbearias/${SLUG}/clientes/${WHATS_NORM}`);
  assert.equal(c.totalAgendamentos, 2);
  assert.equal(c.nome, 'Maria Souza');
});

test('criar-agendamento: dois clientes no mesmo horário — só o primeiro confirma', async () => {
  const a = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento() }));
  const b = await chamar(criarAgendamento, req('POST', {
    body: corpoAgendamento({ whatsapp: '(21) 98888-7777', nome: 'Outro Cliente' })
  }));
  assert.equal(a.statusCode, 201);
  assert.equal(b.statusCode, 409);
  assert.match(b.body.erro, /ocupado/);
  const noDia = [...amb.fake.docs.keys()].filter(k => k.includes('/agendamentos/'));
  assert.equal(noDia.length, 1);
});

test('criar-agendamento: horário sobreposto de outro serviço também é recusado', async () => {
  await chamar(criarAgendamento, req('POST', { body: corpoAgendamento() })); // 10:00–11:00
  const r = await chamar(criarAgendamento, req('POST', {
    body: corpoAgendamento({ whatsapp: '(21) 98888-7777', horario: '10:30', servicosIds: ['srv1'] })
  }));
  assert.equal(r.statusCode, 409);
});

test('criar-agendamento: recusa negócio suspenso ou com trial vencido há mais de 7 dias', async () => {
  for (const extra of [
    { status: 'suspensa' },
    { status: 'trial', trialFim: '2020-01-01T00:00:00.000Z' }
  ]) {
    limparLimites();
    semearNegocio(amb.fake, SLUG, extra);
    const r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento() }));
    assert.equal(r.statusCode, 403, JSON.stringify(extra));
  }
});

test('criar-agendamento: valida entradas maliciosas ou malformadas', async () => {
  const ruins = [
    { whatsapp: '123' },
    { nome: 'A' },
    { horario: '<img src=x onerror=alert(1)>' },
    { dataChave: '2030-13-45' },
    { servicosIds: [] },
    { servicosIds: ['srv1/../../x'] },
    { servicosIds: Array.from({ length: 11 }, (_, i) => `s${i}`) },
    { slug: '../etc' },
    { profissionalId: 'x'.repeat(100) }
  ];
  for (const ruim of ruins) {
    limparLimites();
    const r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento(ruim) }));
    assert.equal(r.statusCode, 400, JSON.stringify(ruim));
  }
});

test('criar-agendamento: serviço ou profissional inexistente/inativo', async () => {
  let r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ servicosIds: ['nao-existe'] }) }));
  assert.equal(r.statusCode, 409);
  amb.fake.seed(`barbearias/${SLUG}/servicos/srv1`, { nome: 'Corte', duracaoMin: 30, preco: 40, ativo: false });
  limparLimites();
  r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ servicosIds: ['srv1'] }) }));
  assert.equal(r.statusCode, 409);
  limparLimites();
  r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ profissionalId: 'fantasma', servicosIds: ['srv2'] }) }));
  assert.equal(r.statusCode, 409);
});

test('criar-agendamento: limita agendamentos futuros por WhatsApp e requisições por IP', async () => {
  const horarios = ['09:00', '10:00', '11:00', '12:00', '13:00'];
  for (const h of horarios) {
    const ok = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ horario: h, servicosIds: ['srv1'] }) }));
    assert.equal(ok.statusCode, 201);
  }
  const sexto = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ horario: '15:00', servicosIds: ['srv1'] }) }));
  assert.equal(sexto.statusCode, 429);

  limparLimites();
  let ultimo;
  for (let i = 0; i < 11; i++) ultimo = await chamar(criarAgendamento, req('POST', { body: { slug: 'x' } }));
  assert.equal(ultimo.statusCode, 429);
});

test('criar-agendamento: notifica o dono, remove token morto e nunca vaza erro interno', async () => {
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/d1`, { token: 'tok-bom' });
  amb.fake.seed(`barbearias/${SLUG}/dispositivos/d2`, { token: 'tok-morto' });
  amb.tokensInvalidos.add('tok-morto');
  const r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento() }));
  assert.equal(r.statusCode, 201);
  assert.equal(amb.notificacoes.length, 1);
  assert.match(amb.notificacoes[0].notification.body, /Maria — .* às 10:00 — Corte \+ Barba com João/);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/dispositivos/d2`), undefined);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/dispositivos/d1`).token, 'tok-bom');

});

test('erro inesperado no banco vira mensagem genérica, sem vazar detalhes internos', async () => {
  const original = amb.fake.collection;
  amb.fake.collection = () => { throw new Error('SEGREDO: chave privada inválida em /etc/x'); };
  const silencio = console.error;
  console.error = () => {};
  try {
    for (const [handler, requisicao] of [
      [criarAgendamento, req('POST', { body: corpoAgendamento() })],
      [negocio, req('GET', { query: { slug: SLUG } })],
      [agendamentoCliente, acao('listar')]
    ]) {
      limparLimites();
      const r = await chamar(handler, requisicao);
      assert.equal(r.statusCode, 500);
      assert.equal(JSON.stringify(r.body).includes('SEGREDO'), false);
      assert.equal('detalhes' in r.body, false);
    }
  } finally {
    console.error = silencio;
    amb.fake.collection = original;
  }
});

// ---------------------------------------------------------------- negocio / ocupados

test('negocio: devolve só dados públicos (sem comissão, sem status interno) + ocupação futura', async () => {
  amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), criadoPor: 'uid-secreto', trialFim: null });
  await chamar(criarAgendamento, req('POST', { body: corpoAgendamento() }));
  const r = await chamar(negocio, req('GET', { query: { slug: SLUG } }));
  assert.equal(r.statusCode, 200);
  const texto = JSON.stringify(r.body);
  assert.equal(texto.includes('comissao'), false);
  assert.equal(texto.includes('uid-secreto'), false);
  assert.equal(texto.includes('5521999991234'), false);   // WhatsApp do cliente não vaza
  assert.equal(texto.includes('Maria'), false);           // nem o nome
  assert.equal(r.body.barbearia.aceitaAgendamentos, true);
  assert.equal(r.body.ocupados.length, 1);
  assert.deepEqual(Object.keys(r.body.ocupados[0]).sort(), ['dataChave', 'duracaoMin', 'horario', 'id', 'profissionalId', 'status']);
  assert.equal(r.body.profissionais.prof1.nome, 'João Silva');
  assert.equal(r.body.servicos.srv1.preco, 40);
});

test('negocio: 404 pra inexistente, 400 pra slug inválido, aviso quando suspenso', async () => {
  assert.equal((await chamar(negocio, req('GET', { query: { slug: 'nao-existe' } }))).statusCode, 404);
  assert.equal((await chamar(negocio, req('GET', { query: { slug: '../x' } }))).statusCode, 400);
  semearNegocio(amb.fake, SLUG, { status: 'suspensa' });
  const r = await chamar(negocio, req('GET', { query: { slug: SLUG } }));
  assert.equal(r.body.barbearia.aceitaAgendamentos, false);
  assert.ok(r.body.barbearia.motivoIndisponivel);
});

test('agendamentos-ocupados: só de hoje em diante e sem cancelados', async () => {
  const hoje = dataEmDias(0);
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/velho`, { profissionalId: 'prof1', dataChave: dataEmDias(-10), horario: '10:00', duracaoMin: 30, status: 'concluido', clienteNome: 'X' });
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/cancelado`, { profissionalId: 'prof1', dataChave: hoje, horario: '10:00', duracaoMin: 30, status: 'cancelado' });
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/ok`, { profissionalId: 'prof1', dataChave: dataEmDias(2), horario: '10:00', duracaoMin: 30, status: 'confirmado', clienteNome: 'Secreto' });
  const r = await chamar(ocupados, req('GET', { query: { slug: SLUG } }));
  assert.deepEqual(r.body.ocupados.map(o => o.id), ['ok']);
  assert.equal(JSON.stringify(r.body).includes('Secreto'), false);
});

// ---------------------------------------------------------------- agendamento-cliente

async function agendarEPegarId(extra = {}) {
  const r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento(extra) }));
  assert.equal(r.statusCode, 201);
  limparLimites();
  return r.body.id;
}
const acao = (action, extra = {}) => req('POST', { body: { slug: SLUG, whatsapp: WHATS, action, ...extra } });

test('cliente: identificar devolve só o primeiro nome', async () => {
  await agendarEPegarId();
  const r = await chamar(agendamentoCliente, acao('identificar'));
  assert.deepEqual(r.body, { encontrado: true, nome: 'Maria' });
  const outro = await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: '(21) 90000-0000', action: 'identificar' } }));
  assert.deepEqual(outro.body, { encontrado: false });
});

test('cliente: listar mostra só os agendamentos do próprio WhatsApp', async () => {
  await agendarEPegarId();
  await agendarEPegarId({ whatsapp: '(21) 98888-7777', horario: '15:00', nome: 'Outra Pessoa' });
  const r = await chamar(agendamentoCliente, acao('listar'));
  assert.equal(r.body.agendamentos.length, 1);
  assert.equal(r.body.agendamentos[0].horario, '10:00');
  assert.equal('clienteWhatsapp' in r.body.agendamentos[0], false);
});

test('cliente: cancelar o próprio, com antecedência; não cancela o dos outros', async () => {
  const id = await agendarEPegarId();
  const alheio = await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: '(21) 98888-7777', action: 'cancelar', agendamentoId: id } }));
  assert.equal(alheio.statusCode, 404);
  limparLimites();
  const ok = await chamar(agendamentoCliente, acao('cancelar', { agendamentoId: id }));
  assert.equal(ok.statusCode, 200);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/agendamentos/${id}`).status, 'cancelado');
  limparLimites();
  const de_novo = await chamar(agendamentoCliente, acao('cancelar', { agendamentoId: id }));
  assert.equal(de_novo.statusCode, 400);
});

test('cliente: não cancela nem remarca em cima da hora (menos de 1 dia)', async () => {
  const id = await agendarEPegarId({ dataChave: dataEmDias(3) });
  amb.fake.seed(`barbearias/${SLUG}/agendamentos/${id}`, { ...amb.fake.get(`barbearias/${SLUG}/agendamentos/${id}`), dataChave: dataEmDias(0) });
  for (const a of [acao('cancelar', { agendamentoId: id }), acao('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(5), novoHorario: '10:00' })]) {
    limparLimites();
    const r = await chamar(agendamentoCliente, a);
    assert.equal(r.statusCode, 400);
    assert.match(r.body.erro, /menos de 1 dia/);
  }
});

test('cliente: remarca 1 vez; a segunda é recusada; conflito de horário é recusado', async () => {
  const id = await agendarEPegarId();
  await agendarEPegarId({ whatsapp: '(21) 98888-7777', dataChave: dataEmDias(5), horario: '11:00', servicosIds: ['srv1'] });

  const conflito = await chamar(agendamentoCliente, acao('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(5), novoHorario: '11:00' }));
  assert.equal(conflito.statusCode, 409);

  limparLimites();
  const ok = await chamar(agendamentoCliente, acao('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(5), novoHorario: '14:00' }));
  assert.equal(ok.statusCode, 200);
  const ag = amb.fake.get(`barbearias/${SLUG}/agendamentos/${id}`);
  assert.equal(ag.dataChave, dataEmDias(5));
  assert.equal(ag.horario, '14:00');
  assert.equal(ag.remarcacoesCliente, 1);

  limparLimites();
  const segunda = await chamar(agendamentoCliente, acao('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(6), novoHorario: '14:00' }));
  assert.equal(segunda.statusCode, 400);
  assert.match(segunda.body.erro, /máximo/);
});

test('cliente: remarcar para o próprio horário atual não conflita consigo mesmo; entradas inválidas = 400', async () => {
  const id = await agendarEPegarId();
  const mesmo = await chamar(agendamentoCliente, acao('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(3), novoHorario: '10:30' }));
  assert.equal(mesmo.statusCode, 200); // 10:30 sobrepõe o próprio 10:00–11:00, mas ele é ignorado
  for (const ruim of [{ novoHorario: 'NaN' }, { novaDataChave: 'ontem' }, { novoHorario: '25:00' }]) {
    limparLimites();
    const r = await chamar(agendamentoCliente, acao('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(6), novoHorario: '10:00', ...ruim }));
    assert.equal(r.statusCode, 400, JSON.stringify(ruim));
  }
  limparLimites();
  assert.equal((await chamar(agendamentoCliente, acao('cancelar', { agendamentoId: 'a/b' }))).statusCode, 400);
  assert.equal((await chamar(agendamentoCliente, acao('apagar-tudo'))).statusCode, 400);
});

// ---------------------------------------------------------------- cadastrar-negocio

const cadastro = (extra = {}) => ({
  idToken: 'tok-novo-dono', nomeNeg: 'Studio Nova', slug: 'studio-nova', cidade: 'Niterói', bairro: 'Icaraí',
  telefone: '21999990000', nomeResp: 'Ana Dona', tipoNegocio: 'estetica',
  servicos: [{ nome: 'Design de Sobrancelha', duracaoMin: 45, preco: 60, emoji: '🪄' }], ...extra
});

test('cadastro: nasce em trial de 30 dias (definido pelo servidor) e com vínculo só pro negócio criado', async () => {
  const antes = Date.now();
  const r = await chamar(cadastrarNegocio, req('POST', {
    body: cadastro({ status: 'ativa', plano: 'mensal', trialFim: '2099-01-01', email: 'falso@x.com', barbeariaId: 'outro-negocio' })
  }));
  assert.equal(r.statusCode, 201);
  const n = amb.fake.get('barbearias/studio-nova');
  assert.equal(n.status, 'trial');                       // não aceita 'ativa' vindo do navegador
  assert.equal(n.plano, 'trial');
  const dias = (Date.parse(n.trialFim) - antes) / 86400000;
  assert.ok(dias > 29.99 && dias < 30.01, `trial de ${dias} dias`);   // ignora o trialFim 2099 enviado
  assert.ok(Date.parse(n.trialInicio) >= antes);
  assert.equal(n.criadoPor, 'novo-dono');
  const u = amb.fake.get('usuarios/novo-dono');
  assert.equal(u.barbeariaId, 'studio-nova');           // nunca 'outro-negocio'
  assert.equal(u.email, 'novo-dono@teste.com');          // e-mail do token, não do corpo
  assert.equal(amb.fake.get('cadastrosAguardando/studio-nova').uid, 'novo-dono');
  assert.equal(amb.fake.get('barbearias/studio-nova/servicos/srv_001').nome, 'Design de Sobrancelha');
});

test('cadastro: recusa slug em uso, reservado, token inválido, 2º negócio na mesma conta e dados ruins', async () => {
  assert.equal((await chamar(cadastrarNegocio, req('POST', { body: cadastro({ slug: SLUG }) }))).statusCode, 409);
  limparLimites();
  assert.equal((await chamar(cadastrarNegocio, req('POST', { body: cadastro({ slug: 'admin' }) }))).statusCode, 400);
  limparLimites();
  assert.equal((await chamar(cadastrarNegocio, req('POST', { body: cadastro({ idToken: 'lixo' }) }))).statusCode, 401);
  limparLimites();
  assert.equal((await chamar(cadastrarNegocio, req('POST', { body: cadastro({ telefone: '123' }) }))).statusCode, 400);
  limparLimites();
  assert.equal((await chamar(cadastrarNegocio, req('POST', { body: cadastro() }))).statusCode, 201);
  limparLimites();
  const outro = await chamar(cadastrarNegocio, req('POST', { body: cadastro({ slug: 'segundo-negocio' }) }));
  assert.equal(outro.statusCode, 409);
  assert.equal(amb.fake.get('barbearias/segundo-negocio'), undefined);
});

test('cadastro: sanitiza os serviços enviados pelo navegador', async () => {
  const r = await chamar(cadastrarNegocio, req('POST', { body: cadastro({
    servicos: [
      { nome: '  Bom   serviço ', duracaoMin: 30, preco: 50, emoji: '✂️' },
      { nome: 'Preço absurdo', duracaoMin: 30, preco: 99999999 },
      { nome: 'Duração zero', duracaoMin: 0, preco: 10 },
      { nome: '', duracaoMin: 30, preco: 10 }
    ]
  }) }));
  assert.equal(r.statusCode, 201);
  const gravados = [...amb.fake.docs.keys()].filter(k => k.startsWith('barbearias/studio-nova/servicos/'));
  assert.equal(gravados.length, 1);
  assert.equal(amb.fake.get(gravados[0]).nome, 'Bom serviço');
});

test('cadastro: checagem de link livre', async () => {
  assert.deepEqual((await chamar(cadastrarNegocio, req('GET', { query: { slug: 'livre-123' } }))).body, { disponivel: true });
  assert.equal((await chamar(cadastrarNegocio, req('GET', { query: { slug: SLUG } }))).body.disponivel, false);
  assert.equal((await chamar(cadastrarNegocio, req('GET', { query: { slug: 'painel77' } }))).body.disponivel, false);
});

// ---------------------------------------------------------------- serviços por profissional

function semearSegundoProfissional() {
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof2`, { nome: 'Carlos Lima', especialidade: 'Barbeiro', ativo: true, comissao: 35 });
}
function restringirServico(id, profissionaisIds) {
  const caminho = `barbearias/${SLUG}/servicos/${id}`;
  amb.fake.seed(caminho, { ...amb.fake.get(caminho), profissionaisIds });
}

test('serviço restrito: o profissional que NÃO faz o serviço é recusado no servidor', async () => {
  semearSegundoProfissional();
  restringirServico('srv2', ['prof2']);                       // Barba só com o Carlos
  const r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ servicosIds: ['srv2'], profissionalId: 'prof1' }) }));
  assert.equal(r.statusCode, 409);
  assert.match(r.body.erro, /Barba não é realizado por João/);
  assert.equal([...amb.fake.docs.keys()].filter(k => k.includes('/agendamentos/')).length, 0, 'nada foi gravado');
});

test('serviço restrito: o profissional certo consegue agendar', async () => {
  semearSegundoProfissional();
  restringirServico('srv2', ['prof2']);
  const r = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ servicosIds: ['srv2'], profissionalId: 'prof2' }) }));
  assert.equal(r.statusCode, 201);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/agendamentos/${r.body.id}`).profissionalNome, 'Carlos Lima');
});

test('combo de serviços: precisa que o profissional faça TODOS (um livre + um restrito)', async () => {
  semearSegundoProfissional();
  restringirServico('srv2', ['prof2']);
  const comJoao = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ servicosIds: ['srv1', 'srv2'], profissionalId: 'prof1' }) }));
  assert.equal(comJoao.statusCode, 409);
  limparLimites();
  const comCarlos = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ servicosIds: ['srv1', 'srv2'], profissionalId: 'prof2' }) }));
  assert.equal(comCarlos.statusCode, 201);
});

test('serviço sem restrição (ausente, vazio) continua valendo para qualquer profissional', async () => {
  semearSegundoProfissional();
  const semCampo = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ servicosIds: ['srv1'], profissionalId: 'prof2' }) }));
  assert.equal(semCampo.statusCode, 201);
  restringirServico('srv2', []);
  limparLimites();
  const vazio = await chamar(criarAgendamento, req('POST', { body: corpoAgendamento({ servicosIds: ['srv2'], profissionalId: 'prof1', horario: '14:00' }) }));
  assert.equal(vazio.statusCode, 201);
});

test('api/negocio expõe a restrição de cada serviço (a tela precisa dela pra filtrar profissionais)', async () => {
  semearSegundoProfissional();
  restringirServico('srv2', ['prof2']);
  const r = await chamar(negocio, req('GET', { query: { slug: SLUG } }));
  assert.deepEqual(r.body.servicos.srv2.profissionaisIds, ['prof2']);
  assert.deepEqual(r.body.servicos.srv1.profissionaisIds, []);
});
