// Testes da API de equipe (api/equipe.js): convite, aceite, alteração e remoção de acessos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const equipe = require('../api/equipe');
const E = require('../api/_lib/equipe');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const TOTAL = { verTodos: true, gerirNegocio: true };
const SOPROPRIO = { verTodos: false, gerirNegocio: false };

async function chamar(corpo) {
  const r = res();
  await equipe(req('POST', { body: corpo }), r);
  return r;
}
const comoDono = (extra) => ({ idToken: 'tok-dono1', ...extra });
const comoSocio = (extra) => ({ idToken: 'tok-socio1', ...extra });
const tokenDe = (r) => r.body.token;

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof2`, { nome: 'Pedro', ativo: true, comissao: 50 });
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner', email: 'dono1@teste.com' });   // conta antiga: sem "permissoes"
  amb.fake.seed('usuarios/socio1', {
    barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof1', email: 'socio1@teste.com', permissoes: SOPROPRIO
  });
});

// ---------------------------------------------------------------- permissões (funções puras)
test('permissoesDe: conta antiga é total; explícita vale; papel estranho não tem nada', () => {
  assert.deepEqual(E.permissoesDe({ role: 'owner' }), TOTAL);
  assert.deepEqual(E.permissoesDe({ barbeariaId: 'x' }), TOTAL);
  assert.deepEqual(E.permissoesDe({ role: 'profissional' }), SOPROPRIO);
  assert.deepEqual(E.permissoesDe({ role: 'owner', permissoes: SOPROPRIO }), SOPROPRIO);
  assert.deepEqual(E.permissoesDe({ permissoes: { verTodos: 'sim', gerirNegocio: 1 } }), SOPROPRIO);
  assert.deepEqual(E.permissoesDe(null), SOPROPRIO);
});

test('podeModificar: só quem tem pelo menos o mesmo poder do alvo', () => {
  assert.equal(E.podeModificar(TOTAL, SOPROPRIO), true);
  assert.equal(E.podeModificar(SOPROPRIO, TOTAL), false);
  assert.equal(E.podeModificar({ verTodos: false, gerirNegocio: true }, { verTodos: true, gerirNegocio: false }), false);
});

// ---------------------------------------------------------------- acesso à API
test('sem login, token falso, ou sem vínculo: recusa', async () => {
  assert.equal((await chamar({ action: 'listar' })).statusCode, 401);
  assert.equal((await chamar({ action: 'listar', idToken: 'lixo' })).statusCode, 401);
  assert.equal((await chamar({ action: 'listar', idToken: 'tok-fantasma' })).statusCode, 403);
});

test('quem não gere o negócio não lista, convida, altera nem remove', async () => {
  for (const corpo of [
    { action: 'listar' },
    { action: 'convidar', nome: 'Ana', email: 'ana@x.com', permissoes: SOPROPRIO, profissionalId: 'prof2' },
    { action: 'alterar', uid: 'dono1', permissoes: SOPROPRIO },
    { action: 'remover', uid: 'dono1' },
    { action: 'cancelar-convite', token: 'x'.repeat(32) }
  ]) assert.equal((await chamar(comoSocio(corpo))).statusCode, 403, corpo.action);
  assert.ok(amb.fake.get('usuarios/dono1'));
});

test('ação desconhecida e método errado', async () => {
  assert.equal((await chamar(comoDono({ action: 'xpto' }))).statusCode, 400);
  const r = res(); await equipe(req('GET'), r); assert.equal(r.statusCode, 405);
});

// ---------------------------------------------------------------- listar
test('listar mostra membros, profissionais e não vaza comissão', async () => {
  const r = await chamar(comoDono({ action: 'listar' }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.membros.length, 2);
  const socio = r.body.membros.find((m) => m.uid === 'socio1');
  assert.equal(socio.profissionalNome, 'João Silva');
  assert.equal(socio.podeModificar, true);
  assert.equal(r.body.membros.find((m) => m.uid === 'dono1').eu, true);
  assert.equal(JSON.stringify(r.body).includes('comissao'), false);
  assert.equal(r.body.profissionais.find((p) => p.id === 'prof2').vinculado, false);
  assert.equal(r.body.profissionais.find((p) => p.id === 'prof1').vinculado, true);
});

test('listar não mostra pessoas de outro negócio', async () => {
  semearNegocio(amb.fake, 'outra-barbearia');
  amb.fake.seed('usuarios/estranho', { barbeariaId: 'outra-barbearia', role: 'owner', email: 'e@x.com' });
  const r = await chamar(comoDono({ action: 'listar' }));
  assert.equal(r.body.membros.some((m) => m.uid === 'estranho'), false);
});

// ---------------------------------------------------------------- convidar
test('convidar profissional existente gera link, token forte e validade de 7 dias', async () => {
  const r = await chamar(comoDono({ action: 'convidar', nome: 'Pedro', email: 'Pedro@X.com', permissoes: SOPROPRIO, profissionalId: 'prof2' }));
  assert.equal(r.statusCode, 201);
  assert.match(r.body.token, /^[A-Za-z0-9_-]{20,64}$/);
  assert.ok(r.body.link.includes(`/convite?n=${SLUG}&c=${r.body.token}`));
  const c = amb.fake.get(`barbearias/${SLUG}/convites/${r.body.token}`);
  assert.equal(c.email, 'pedro@x.com');
  assert.equal(c.profissionalId, 'prof2');
  assert.equal(c.usado, false);
  const dias = (Date.parse(c.expiraEm) - Date.now()) / 86400000;
  assert.ok(dias > 6.9 && dias <= 7.01);
});

test('convidar com novo profissional cria o cadastro com o horário do estabelecimento e sem comissão', async () => {
  const r = await chamar(comoDono({ action: 'convidar', nome: 'Lia', email: 'lia@x.com', permissoes: SOPROPRIO, novoProfissional: 'Lia Souza' }));
  assert.equal(r.statusCode, 201);
  const prof = amb.fake.get(`barbearias/${SLUG}/profissionais/${r.body.profissionalId}`);
  assert.equal(prof.nome, 'Lia Souza');
  assert.equal(prof.comissao, 0);
  assert.equal(prof.horarioTrabalho.segunda.inicio, '09:00');
});

test('convidar valida nome, e-mail, permissões e vínculo', async () => {
  const base = { action: 'convidar', nome: 'Pedro', email: 'p@x.com', permissoes: SOPROPRIO, profissionalId: 'prof2' };
  for (const [mudanca, esperado] of [
    [{ nome: 'P' }, 400], [{ email: 'sem-arroba' }, 400], [{ permissoes: { verTodos: true } }, 400],
    [{ permissoes: 'tudo' }, 400], [{ profissionalId: 'a/b' }, 400], [{ profissionalId: 'nao-existe' }, 404],
    [{ novoProfissional: 'Fulano' }, 400],                                  // existente + novo
    [{ profissionalId: '' }, 400],                                          // sem vínculo e sem ver tudo
    [{ profissionalId: 'prof1' }, 409]                                      // já ligado ao socio1
  ]) assert.equal((await chamar(comoDono({ ...base, ...mudanca }))).statusCode, esperado, JSON.stringify(mudanca));
});

test('convidar: sem vínculo mas com ver tudo é permitido (sócio gerente)', async () => {
  const r = await chamar(comoDono({ action: 'convidar', nome: 'Gerente', email: 'g@x.com', permissoes: TOTAL }));
  assert.equal(r.statusCode, 201);
});

test('convidar: e-mail já na equipe, já convidado ou com acesso em outro negócio é recusado', async () => {
  const ok = { action: 'convidar', nome: 'Pedro', email: 'pedro@x.com', permissoes: SOPROPRIO, profissionalId: 'prof2' };
  assert.equal((await chamar(comoDono(ok))).statusCode, 201);
  assert.equal((await chamar(comoDono({ ...ok, novoProfissional: 'Outro', profissionalId: '' }))).statusCode, 409);   // convite pendente
  assert.equal((await chamar(comoDono({ ...ok, email: 'socio1@teste.com' }))).statusCode, 409);                        // já é da equipe
  amb.fake.seed('usuarios/outrodono', { barbeariaId: 'outra', role: 'owner', email: 'rival@x.com' });
  assert.equal((await chamar(comoDono({ ...ok, email: 'rival@x.com' }))).statusCode, 409);                             // outro negócio
});

test('convidar: ninguém concede o que não tem', async () => {
  // gerente que NÃO vê tudo tenta convidar alguém que vê tudo
  amb.fake.seed('usuarios/gerente', { barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof2', email: 'ger@teste.com', permissoes: { verTodos: false, gerirNegocio: true } });
  const r = await chamar({ idToken: 'tok-gerente', action: 'convidar', nome: 'Ana', email: 'ana@x.com', permissoes: { verTodos: true, gerirNegocio: false }, novoProfissional: 'Ana' });
  assert.equal(r.statusCode, 403);
  const ok = await chamar({ idToken: 'tok-gerente', action: 'convidar', nome: 'Ana', email: 'ana@x.com', permissoes: SOPROPRIO, novoProfissional: 'Ana' });
  assert.equal(ok.statusCode, 201);
});

test('convidar: limite de convites pendentes', async () => {
  for (let i = 0; i < E.MAX_CONVITES_PENDENTES; i++) {
    amb.fake.seed(`barbearias/${SLUG}/convites/${'t'.repeat(30)}${i}`, { nome: 'X', email: `x${i}@x.com`, permissoes: TOTAL, usado: false, expiraEm: new Date(Date.now() + 86400000).toISOString() });
  }
  assert.equal((await chamar(comoDono({ action: 'convidar', nome: 'Ana', email: 'ana@x.com', permissoes: TOTAL }))).statusCode, 429);
});

// ---------------------------------------------------------------- convite-info e aceitar
async function novoConvite(extra = {}) {
  const r = await chamar(comoDono({ action: 'convidar', nome: 'Pedro', email: 'pedro@teste.com', permissoes: SOPROPRIO, profissionalId: 'prof2', ...extra }));
  assert.equal(r.statusCode, 201);
  return tokenDe(r);
}

test('convite-info é público e só mostra negócio, nome e e-mail', async () => {
  const token = await novoConvite();
  const r = await chamar({ action: 'convite-info', n: SLUG, c: token });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['email', 'negocio', 'nome', 'valido']);
  assert.equal(r.body.negocio, 'Barbearia Teste');
});

test('convite inexistente, mal formado, de outro negócio, vencido ou usado', async () => {
  const token = await novoConvite();
  assert.equal((await chamar({ action: 'convite-info', n: SLUG, c: 'a'.repeat(30) })).statusCode, 404);
  assert.equal((await chamar({ action: 'convite-info', n: SLUG, c: 'curto' })).statusCode, 400);
  assert.equal((await chamar({ action: 'convite-info', n: '../x', c: token })).statusCode, 400);
  semearNegocio(amb.fake, 'outra-barbearia');
  assert.equal((await chamar({ action: 'convite-info', n: 'outra-barbearia', c: token })).statusCode, 404);
  const caminho = `barbearias/${SLUG}/convites/${token}`;
  amb.fake.seed(caminho, { ...amb.fake.get(caminho), expiraEm: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await chamar({ action: 'convite-info', n: SLUG, c: token })).statusCode, 410);
  amb.fake.seed(caminho, { ...amb.fake.get(caminho), expiraEm: new Date(Date.now() + 86400000).toISOString(), usado: true });
  assert.equal((await chamar({ action: 'convite-info', n: SLUG, c: token })).statusCode, 410);
});

test('aceitar: vincula a conta com as permissões do convite e queima o link', async () => {
  const token = await novoConvite();
  const r = await chamar({ action: 'aceitar', idToken: 'tok-pedro', n: SLUG, c: token });      // e-mail do token: pedro@teste.com
  assert.equal(r.statusCode, 200);
  const u = amb.fake.get('usuarios/pedro');
  assert.equal(u.barbeariaId, SLUG);
  assert.equal(u.role, 'profissional');
  assert.equal(u.profissionalId, 'prof2');
  assert.deepEqual(u.permissoes, SOPROPRIO);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/convites/${token}`).usado, true);
  // segundo uso do mesmo link
  amb.fake.seed('usuarios/pedro2', { barbeariaId: SLUG, role: 'profissional', permissoes: SOPROPRIO });
  assert.equal((await chamar({ action: 'aceitar', idToken: 'tok-pedro', n: SLUG, c: token })).statusCode, 410);
});

test('aceitar: só o e-mail convidado, só com login e só uma vez por conta', async () => {
  const token = await novoConvite();
  assert.equal((await chamar({ action: 'aceitar', n: SLUG, c: token })).statusCode, 401);
  assert.equal((await chamar({ action: 'aceitar', idToken: 'lixo', n: SLUG, c: token })).statusCode, 401);
  assert.equal((await chamar({ action: 'aceitar', idToken: 'tok-intruso', n: SLUG, c: token })).statusCode, 403);
  assert.equal(amb.fake.get('usuarios/intruso'), undefined);
  // conta que já pertence a um negócio não é sobrescrita
  amb.fake.seed('usuarios/pedro', { barbeariaId: 'outra', role: 'owner' });
  assert.equal((await chamar({ action: 'aceitar', idToken: 'tok-pedro', n: SLUG, c: token })).statusCode, 409);
  assert.equal(amb.fake.get('usuarios/pedro').barbeariaId, 'outra');
});

test('aceitar nunca dá mais do que o convite dizia (permissões vêm do banco, não do navegador)', async () => {
  const token = await novoConvite();
  await chamar({ action: 'aceitar', idToken: 'tok-pedro', n: SLUG, c: token, permissoes: TOTAL, role: 'owner' });
  assert.deepEqual(amb.fake.get('usuarios/pedro').permissoes, SOPROPRIO);
  assert.equal(amb.fake.get('usuarios/pedro').role, 'profissional');
});

// ---------------------------------------------------------------- alterar
test('alterar: dono muda permissões de um sócio', async () => {
  const r = await chamar(comoDono({ action: 'alterar', uid: 'socio1', permissoes: { verTodos: true, gerirNegocio: false } }));
  assert.equal(r.statusCode, 200);
  assert.deepEqual(amb.fake.get('usuarios/socio1').permissoes, { verTodos: true, gerirNegocio: false });
});

test('alterar: ninguém sobe o próprio acesso nem mexe em quem tem mais poder', async () => {
  assert.equal((await chamar(comoSocio({ action: 'alterar', uid: 'socio1', permissoes: TOTAL }))).statusCode, 403);
  // gerente sem "ver tudo" não rebaixa o dono
  amb.fake.seed('usuarios/gerente', { barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof2', email: 'g@teste.com', permissoes: { verTodos: false, gerirNegocio: true } });
  assert.equal((await chamar({ idToken: 'tok-gerente', action: 'alterar', uid: 'dono1', permissoes: SOPROPRIO })).statusCode, 403);
  assert.deepEqual(E.permissoesDe(amb.fake.get('usuarios/dono1')), TOTAL);
  // nem concede ver tudo (que ele não tem)
  assert.equal((await chamar({ idToken: 'tok-gerente', action: 'alterar', uid: 'socio1', permissoes: { verTodos: true, gerirNegocio: false } })).statusCode, 403);
});

test('alterar: o negócio nunca fica sem gerente', async () => {
  const r = await chamar(comoDono({ action: 'alterar', uid: 'dono1', permissoes: SOPROPRIO }));
  assert.equal(r.statusCode, 409);
  assert.deepEqual(E.permissoesDe(amb.fake.get('usuarios/dono1')), TOTAL);
});

test('alterar: pessoa de outro negócio, uid estranho e permissões inválidas', async () => {
  amb.fake.seed('usuarios/estranho', { barbeariaId: 'outra', role: 'owner' });
  assert.equal((await chamar(comoDono({ action: 'alterar', uid: 'estranho', permissoes: SOPROPRIO }))).statusCode, 404);
  assert.equal((await chamar(comoDono({ action: 'alterar', uid: 'a/b', permissoes: SOPROPRIO }))).statusCode, 400);
  assert.equal((await chamar(comoDono({ action: 'alterar', uid: 'socio1', permissoes: { verTodos: 'sim' } }))).statusCode, 400);
});

test('alterar: sem vínculo e sem nenhuma permissão a pessoa ficaria cega', async () => {
  amb.fake.seed('usuarios/solto', { barbeariaId: SLUG, role: 'profissional', email: 's@teste.com', permissoes: { verTodos: true, gerirNegocio: false } });
  assert.equal((await chamar(comoDono({ action: 'alterar', uid: 'solto', permissoes: SOPROPRIO }))).statusCode, 400);
});

// ---------------------------------------------------------------- remover / cancelar convite
test('remover tira o vínculo, mas nunca o último gerente', async () => {
  assert.equal((await chamar(comoDono({ action: 'remover', uid: 'socio1' }))).statusCode, 200);
  assert.equal(amb.fake.get('usuarios/socio1'), undefined);
  assert.equal((await chamar(comoDono({ action: 'remover', uid: 'dono1' }))).statusCode, 409);
  assert.ok(amb.fake.get('usuarios/dono1'));
});

test('remover: gerente sem "ver tudo" não remove o dono; estranho não existe', async () => {
  amb.fake.seed('usuarios/gerente', { barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof2', email: 'g@teste.com', permissoes: { verTodos: false, gerirNegocio: true } });
  assert.equal((await chamar({ idToken: 'tok-gerente', action: 'remover', uid: 'dono1' })).statusCode, 403);
  assert.ok(amb.fake.get('usuarios/dono1'));
  amb.fake.seed('usuarios/estranho', { barbeariaId: 'outra', role: 'owner' });
  assert.equal((await chamar(comoDono({ action: 'remover', uid: 'estranho' }))).statusCode, 404);
});

test('cancelar-convite apaga o convite; o link deixa de valer', async () => {
  const token = await novoConvite();
  assert.equal((await chamar(comoDono({ action: 'cancelar-convite', token }))).statusCode, 200);
  assert.equal((await chamar({ action: 'convite-info', n: SLUG, c: token })).statusCode, 404);
  assert.equal((await chamar(comoDono({ action: 'cancelar-convite', token }))).statusCode, 404);
  assert.equal((await chamar(comoDono({ action: 'cancelar-convite', token: '../x' }))).statusCode, 400);
});
