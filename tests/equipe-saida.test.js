// Equipe: desativar/reativar cadastro e excluir definitivamente (transferência ou cancelamento dos agendamentos futuros).

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, dataEmDias, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const equipe = require('../api/equipe');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const SOPROPRIO = { verTodos: false, gerirNegocio: false };
const N = `barbearias/${SLUG}`;

async function chamar(corpo) { const r = res(); await equipe(req('POST', { body: corpo }), r); return r; }
const dono = (extra) => ({ idToken: 'tok-dono1', ...extra });

function agendamento(id, extra = {}) {
  amb.fake.seed(`${N}/agendamentos/${id}`, {
    clienteWhatsapp: '5521999990001', clienteNome: 'Maria Souza', profissionalId: 'prof2', profissionalNome: 'Pedro',
    servicos: [{ id: 'srv1', nome: 'Corte', preco: 40, duracaoMin: 30 }], dataChave: dataEmDias(3), horario: '10:00', duracaoMin: 30,
    valorTotal: 40, status: 'confirmado', donoVe: true, ...extra
  });
}

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  amb.notificacoes.length = 0;
  amb.authRemovidos.clear();
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed(`${N}/profissionais/prof2`, { nome: 'Pedro', ativo: true, comissao: 0 });
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner', email: 'dono1@teste.com', profissionalId: 'prof1' });
  amb.fake.seed('usuarios/func1', { barbeariaId: SLUG, role: 'profissional', papel: 'funcionario', profissionalId: 'prof2', email: 'pedro@teste.com', nome: 'Pedro', permissoes: SOPROPRIO });
  amb.fake.seed(`${N}/dispositivos/d-func`, { uid: 'func1', token: 'tok-aparelho-do-pedro-1234567890' });
});

// ---------------------------------------------------------------- desativar e reativar
test('desativar guarda o cadastro (dá para reativar), tira o acesso e o profissional do link', async () => {
  const r = await chamar(dono({ action: 'remover', uid: 'func1' }));
  assert.equal(r.statusCode, 200);
  assert.equal(amb.fake.get('usuarios/func1'), undefined);
  assert.equal(amb.fake.get(`${N}/profissionais/prof2`).ativo, false);
  const lista = await chamar(dono({ action: 'listar' }));
  assert.equal(lista.body.membros.some((m) => m.uid === 'func1'), false);
  assert.equal(lista.body.inativos.length, 1);
  assert.equal(lista.body.inativos[0].email, 'pedro@teste.com');
  assert.equal(lista.body.inativos[0].podeExcluir, true);

  const volta = await chamar(dono({ action: 'reativar', uid: 'func1' }));
  assert.equal(volta.statusCode, 200, JSON.stringify(volta.body));
  assert.equal(amb.fake.get('usuarios/func1').profissionalId, 'prof2');
  assert.equal(amb.fake.get(`${N}/profissionais/prof2`).ativo, true);
  assert.equal(amb.fake.get(`${N}/equipeInativa/func1`), undefined);
});

test('convidar o e-mail de alguém desativado manda reativar; reativar de quem já tem acesso é recusado', async () => {
  await chamar(dono({ action: 'remover', uid: 'func1' }));
  const c = await chamar(dono({ action: 'convidar', nome: 'Pedro', email: 'pedro@teste.com', papel: 'funcionario', novoProfissional: 'Pedro Novo' }));
  assert.equal(c.statusCode, 409);
  assert.match(c.body.erro, /desativado/);
  amb.fake.seed('usuarios/func1', { barbeariaId: 'outro', role: 'owner' });
  assert.equal((await chamar(dono({ action: 'reativar', uid: 'func1' }))).statusCode, 409);
});

// ---------------------------------------------------------------- prévia
test('prévia: conta o que passa para o destino e o que será cancelado (conflito, serviço que ele não faz, sinal pendente)', async () => {
  agendamento('a1');                                                              // 10:00 livre em prof1
  agendamento('a2', { horario: '11:00' });                                        // 11:00: prof1 já tem cliente
  amb.fake.seed(`${N}/agendamentos/ocupado`, { clienteWhatsapp: '5521988880000', profissionalId: 'prof1', dataChave: dataEmDias(3), horario: '11:00', duracaoMin: 30, status: 'confirmado', servicos: [], donoVe: true });
  agendamento('a3', { horario: '12:00', servicos: [{ id: 'srv2', nome: 'Barba', preco: 35, duracaoMin: 30 }], valorTotal: 35 });
  amb.fake.seed(`${N}/servicos/srv2`, { ...amb.fake.get(`${N}/servicos/srv2`), profissionaisIds: ['prof2'] });   // só o Pedro faz barba
  agendamento('a4', { horario: '13:00', status: 'aguardando_sinal', sinalExpiraEm: new Date(Date.now() + 3600000).toISOString() });
  const sem = await chamar(dono({ action: 'excluir-previa', profissionalId: 'prof2' }));
  assert.equal(sem.statusCode, 200, JSON.stringify(sem.body));
  assert.equal(sem.body.futuros, 4); assert.equal(sem.body.transferiveis, 0); assert.equal(sem.body.cancelados, 4);
  assert.deepEqual(sem.body.destinos.map((d) => d.id), ['prof1']);
  const com = await chamar(dono({ action: 'excluir-previa', profissionalId: 'prof2', destinoId: 'prof1' }));
  assert.equal(com.body.transferiveis, 1);                                        // só a1
  assert.equal(com.body.cancelados, 3);
  const motivos = Object.fromEntries(com.body.itens.map((i) => [i.horario, i.motivo]));
  assert.match(motivos['11:00'], /ocupado/i);
  assert.match(motivos['12:00'], /não faz/);
  assert.match(motivos['13:00'], /sem pagamento/i);
});

test('prévia e exclusão: pagamento de sinal informado bloqueia (há dinheiro envolvido)', async () => {
  agendamento('pago', { status: 'sinal_informado', sinalValor: 20 });
  const p = await chamar(dono({ action: 'excluir-previa', profissionalId: 'prof2' }));
  assert.match(p.body.bloqueio, /sinal/i);
  const x = await chamar(dono({ action: 'excluir-profissional', profissionalId: 'prof2', acaoFuturos: 'cancelar' }));
  assert.equal(x.statusCode, 409);
  assert.ok(amb.fake.get(`${N}/profissionais/prof2`));
});

// ---------------------------------------------------------------- excluir
test('excluir transferindo: passa o possível (preço do novo profissional), cancela o resto, avisa, apaga login e cadastro e guarda o histórico', async () => {
  amb.fake.seed(`${N}/servicos/srv1`, { ...amb.fake.get(`${N}/servicos/srv1`), profissionaisIds: ['prof1', 'prof2'], precosProfissional: { prof1: { preco: 50 }, prof2: { preco: 40 } } });
  agendamento('a1');
  agendamento('a2', { horario: '11:00', clienteWhatsapp: '5521977770002', clienteNome: 'João Teste' });
  amb.fake.seed(`${N}/agendamentos/ocupado`, { clienteWhatsapp: '5521988880000', profissionalId: 'prof1', dataChave: dataEmDias(3), horario: '11:00', duracaoMin: 30, status: 'confirmado', servicos: [], donoVe: true });
  agendamento('passado', { dataChave: dataEmDias(-5), status: 'concluido' });
  amb.fake.seed(`${N}/dispositivosCliente/c1`, { whatsapp: '5521999990001', token: 'token-do-aparelho-da-maria-0000001' });   // a Maria tem o app; o João não
  amb.fake.seed(`${N}/recorrencias/serie1`, { profissionalId: 'prof2', ativa: true });

  const r = await chamar(dono({ action: 'excluir-profissional', profissionalId: 'prof2', acaoFuturos: 'transferir', destinoId: 'prof1' }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.transferidos, 1); assert.equal(r.body.cancelados, 1); assert.equal(r.body.loginsApagados, 1);

  const a1 = amb.fake.get(`${N}/agendamentos/a1`);
  assert.equal(a1.profissionalId, 'prof1'); assert.equal(a1.valorTotal, 50); assert.equal(a1.transferidoDe.nome, 'Pedro');
  assert.equal(amb.fake.get(`${N}/agendamentos/a2`).status, 'cancelado');
  assert.equal(amb.fake.get(`${N}/agendamentos/passado`).status, 'concluido');                  // histórico fica
  assert.equal(amb.fake.get(`${N}/profissionais/prof2`), undefined);
  assert.equal(amb.fake.get('usuarios/func1'), undefined);
  assert.equal(amb.fake.get(`${N}/dispositivos/d-func`), undefined);
  assert.equal(amb.fake.get(`${N}/recorrencias/serie1`), undefined);
  assert.deepEqual(amb.fake.get(`${N}/servicos/srv1`).profissionaisIds, ['prof1']);
  assert.ok(amb.authRemovidos.has('func1'));

  const aviso = amb.notificacoes.find((n) => n.token === 'token-do-aparelho-da-maria-0000001');
  assert.match(aviso.notification.title, /Profissional alterado/);
  assert.match(aviso.notification.body, /Pedro não atende mais aqui/);
  assert.match(aviso.notification.body, /Novo valor: R\$ 50,00/);
  assert.equal(r.body.semApp.length, 1);                                                         // o João não tem o app: lista para o dono avisar por WhatsApp
  assert.equal(r.body.semApp[0].whatsapp, '5521977770002');
  assert.equal(r.body.semApp[0].acao, 'cancelar');
});

test('excluir cancelando tudo; o login só é apagado se o dono não desmarcar', async () => {
  agendamento('a1');
  const r = await chamar(dono({ action: 'excluir-profissional', profissionalId: 'prof2', acaoFuturos: 'cancelar', apagarLogin: false }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.cancelados, 1); assert.equal(r.body.transferidos, 0); assert.equal(r.body.loginsApagados, 0);
  assert.equal(amb.fake.get(`${N}/agendamentos/a1`).status, 'cancelado');
  assert.equal(amb.authRemovidos.size, 0);
  assert.equal(amb.fake.get('usuarios/func1'), undefined);                                        // mas o acesso ao negócio acaba
});

test('excluir um profissional sem login (subordinado sem acesso) funciona do mesmo jeito', async () => {
  amb.fake.seed(`${N}/profissionais/prof3`, { nome: 'Lucas', ativo: true });
  const r = await chamar(dono({ action: 'excluir-profissional', profissionalId: 'prof3', acaoFuturos: 'cancelar' }));
  assert.equal(r.statusCode, 200);
  assert.equal(amb.fake.get(`${N}/profissionais/prof3`), undefined);
  assert.equal(r.body.loginsApagados, 0);
});

test('travas: sócio não é excluído pelo dono, ninguém exclui o próprio cadastro, só o dono exclui, e transferir exige destino válido', async () => {
  amb.fake.seed(`${N}/profissionais/profS`, { nome: 'Sócio', ativo: true, socio: true });
  assert.equal((await chamar(dono({ action: 'excluir-profissional', profissionalId: 'profS', acaoFuturos: 'cancelar' }))).statusCode, 403);
  assert.equal((await chamar(dono({ action: 'excluir-profissional', profissionalId: 'prof1', acaoFuturos: 'cancelar' }))).statusCode, 403);   // o do próprio dono
  amb.fake.seed('usuarios/gerente', { barbeariaId: SLUG, role: 'profissional', papel: 'funcionario', profissionalId: 'prof2', email: 'g@teste.com', permissoes: { verTodos: false, gerirNegocio: true } });
  assert.equal((await chamar({ idToken: 'tok-gerente', action: 'excluir-profissional', profissionalId: 'prof2', acaoFuturos: 'cancelar' })).statusCode, 403);
  assert.equal((await chamar(dono({ action: 'excluir-profissional', profissionalId: 'prof2', acaoFuturos: 'transferir', destinoId: 'inexistente' }))).statusCode, 400);
  assert.equal((await chamar(dono({ action: 'excluir-profissional', profissionalId: 'prof2', acaoFuturos: 'transferir' }))).statusCode, 400);
  assert.ok(amb.fake.get(`${N}/profissionais/prof2`));                                             // nada foi apagado
});

test('listar: só o dono vê "podeExcluir", e só em funcionário; sócio nunca', async () => {
  amb.fake.seed('usuarios/socio9', { barbeariaId: SLUG, role: 'profissional', papel: 'socio', profissionalId: 'profS', email: 's9@teste.com', permissoes: SOPROPRIO });
  amb.fake.seed(`${N}/profissionais/profS`, { nome: 'Sócio', ativo: true, socio: true });
  const l = await chamar(dono({ action: 'listar' }));
  const porUid = Object.fromEntries(l.body.membros.map((m) => [m.uid, m]));
  assert.equal(porUid.func1.podeExcluir, true);
  assert.equal(porUid.socio9.podeExcluir, false);
  assert.equal(porUid.dono1.podeExcluir, false);
  assert.equal(l.body.profissionais.find((p) => p.id === 'profS').socio, true);
});

// ---------------------------------------------------------------- fotos (profissional e logo do negócio)
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';

test('foto do profissional: o dono define e remove; valor inválido é recusado; funcionário não mexe na própria', async () => {
  const ok = await chamar(dono({ action: 'foto-profissional', profissionalId: 'prof2', foto: JPEG }));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(amb.fake.get(`${N}/profissionais/prof2`).foto, JPEG);
  for (const ruim of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'x'.repeat(20)]) {
    assert.equal((await chamar(dono({ action: 'foto-profissional', profissionalId: 'prof2', foto: ruim }))).statusCode, 400);
  }
  assert.equal((await chamar(dono({ action: 'foto-profissional', profissionalId: 'prof2', foto: 'data:image/jpeg;base64,' + 'A'.repeat(95000) }))).statusCode, 400);   // pesada demais
  assert.equal(amb.fake.get(`${N}/profissionais/prof2`).foto, JPEG);                                // as recusas não mexeram
  assert.equal((await chamar({ idToken: 'tok-func1', action: 'foto-profissional', profissionalId: 'prof2', foto: JPEG })).statusCode, 403);
  assert.equal((await chamar(dono({ action: 'foto-profissional', profissionalId: 'prof2', foto: null }))).statusCode, 200);
  assert.equal(amb.fake.get(`${N}/profissionais/prof2`).foto, undefined);
});

test('foto do sócio: só ele mesmo; o dono não mexe', async () => {
  amb.fake.seed(`${N}/profissionais/profS`, { nome: 'Sócio', ativo: true, socio: true });
  amb.fake.seed('usuarios/socio9', { barbeariaId: SLUG, role: 'profissional', papel: 'socio', profissionalId: 'profS', email: 's9@teste.com', permissoes: SOPROPRIO });
  assert.equal((await chamar(dono({ action: 'foto-profissional', profissionalId: 'profS', foto: JPEG }))).statusCode, 403);
  assert.equal((await chamar({ idToken: 'tok-socio9', action: 'foto-profissional', profissionalId: 'profS', foto: JPEG })).statusCode, 200);
  assert.equal(amb.fake.get(`${N}/profissionais/profS`).foto, JPEG);
});

test('logo do negócio: o dono grava e remove; valor inválido é recusado', async () => {
  const configurar = require('../api/configurar-negocio');
  const chamarCfg = async (corpo) => { const r = res(); await configurar(req('POST', { body: { idToken: 'tok-dono1', ...corpo } }), r); return r; };
  const ok = await chamarCfg({ logo: JPEG });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(amb.fake.get(N).logo, JPEG);
  assert.equal((await chamarCfg({ logo: 'https://exemplo.com/logo.png' })).statusCode, 400);
  assert.equal(amb.fake.get(N).logo, JPEG);
  assert.equal((await chamarCfg({ logo: '' })).statusCode, 200);
  assert.equal(amb.fake.get(N).logo, undefined);
});
