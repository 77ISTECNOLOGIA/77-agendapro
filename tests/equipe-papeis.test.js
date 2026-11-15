// Papéis da equipe (Dono / Sócio / Funcionário): convite, aceite, troca de papel, sinal e Pix por pessoa, serviços do sócio.

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, semearNegocio, dataEmDias } = require('./_helpers');

const amb = montarAmbiente();
const equipe = require('../api/equipe');
const criarAgendamento = require('../api/criar-agendamento');
const { configSinal } = require('../api/_lib/sinal');
const E = require('../api/_lib/equipe');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const NADA = { verTodos: false, gerirNegocio: false };
const TOTAL = { verTodos: true, gerirNegocio: true };
const SINAL_NEGOCIO = { ativo: true, percentual: 50, prazoHoras: 24, tipoChave: 'email', chavePix: 'dono@barbearia.com', nomeRecebedor: 'DONO', cidadeRecebedor: 'RIO' };
const PIX_SOCIO = { tipoChave: 'email', chavePix: 'socio@barbearia.com', nomeRecebedor: 'Socio Alves', cidadeRecebedor: 'Rio', banco: 'nubank' };

async function chamar(corpo) { const r = res(); await equipe(req('POST', { body: corpo }), r); limparLimites(); return r; }
const dono = (extra) => ({ idToken: 'tok-dono1', ...extra });
const get = (p) => amb.fake.get(`barbearias/${SLUG}/${p}`);
const priv = (id) => get(`profissionais/${id}/privado/config`) || {};
const agendar = async (extra = {}) => {
  const r = res();
  await criarAgendamento(req('POST', { body: { slug: SLUG, whatsapp: '(21) 99999-1234', nome: 'Maria Souza', profissionalId: 'prof1', servicosIds: ['srv1'], dataChave: dataEmDias(3), horario: '10:00', ...extra } }), r);
  limparLimites();
  return r;
};

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, SLUG, { sinal: SINAL_NEGOCIO });          // prof1 = do dono (não é de sócio)
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof2`, { nome: 'Sócio', ativo: true, comissao: 0 });
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof3`, { nome: 'Func', ativo: true, comissao: 40 });
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner', papel: 'dono', permissoes: TOTAL, email: 'dono1@teste.com' });
});

async function convidarEAceitar(papel, nome, uid, profissionalId) {
  const c = await chamar(dono({ action: 'convidar', nome, email: `${uid}@teste.com`, papel, profissionalId }));
  assert.equal(c.statusCode, 201, JSON.stringify(c.body));
  const a = await chamar({ action: 'aceitar', idToken: `tok-${uid}`, n: SLUG, c: c.body.token });
  assert.equal(a.statusCode, 200, JSON.stringify(a.body));
}

test('papelDe: o gravado vale; sem ele, conta com tudo = dono e conta antiga restrita = sócio', () => {
  assert.equal(E.papelDe({ papel: 'funcionario', permissoes: NADA }), 'funcionario');
  assert.equal(E.papelDe({ role: 'owner' }), 'dono');
  assert.equal(E.papelDe({ permissoes: TOTAL }), 'dono');
  assert.equal(E.papelDe({ role: 'profissional', permissoes: { verTodos: false, gerirNegocio: true } }), 'socio');
  assert.equal(E.papelDe({ role: 'profissional', permissoes: NADA }), 'socio');
  assert.deepEqual(E.permissoesDoPapel('dono'), TOTAL);
  assert.deepEqual(E.permissoesDoPapel('socio'), NADA);
  assert.deepEqual(E.permissoesDoPapel('funcionario'), NADA);
});

test('convite por papel: só Sócio ou Funcionário; as permissões vêm do papel, nunca do navegador', async () => {
  assert.equal((await chamar(dono({ action: 'convidar', nome: 'Ana', email: 'ana@x.com', papel: 'dono', profissionalId: 'prof2' }))).statusCode, 400);
  assert.equal((await chamar(dono({ action: 'convidar', nome: 'Ana', email: 'ana@x.com', papel: 'chefe', profissionalId: 'prof2' }))).statusCode, 400);
  // permissões mandadas junto são ignoradas quando há papel
  const c = await chamar(dono({ action: 'convidar', nome: 'Ana', email: 'ana@teste.com', papel: 'funcionario', permissoes: TOTAL, profissionalId: 'prof3' }));
  assert.equal(c.statusCode, 201);
  assert.deepEqual(get(`convites/${c.body.token}`).permissoes, NADA);
  assert.equal(get(`convites/${c.body.token}`).papel, 'funcionario');
  // sem profissional não há o que enxergar
  assert.equal((await chamar(dono({ action: 'convidar', nome: 'Bia', email: 'bia@x.com', papel: 'socio' }))).statusCode, 400);
  // novo profissional com o nome da pessoa
  assert.equal((await chamar(dono({ action: 'convidar', nome: 'Caio', email: 'caio@x.com', papel: 'socio', novoProfissional: 'Caio Barber' }))).statusCode, 201);
});

test('aceitar como SÓCIO: papel gravado, profissional marcado como de sócio e sinal começa DESLIGADO; como FUNCIONÁRIO: segue o dono', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  const u = amb.fake.get('usuarios/socio9');
  assert.equal(u.papel, 'socio');
  assert.deepEqual(u.permissoes, NADA);
  assert.equal(u.profissionalId, 'prof2');
  assert.equal(get('profissionais/prof2').socio, true);
  assert.deepEqual(priv('prof2').sinal, { modo: 'desativado' });
  await convidarEAceitar('funcionario', 'Func', 'func9', 'prof3');
  assert.equal(amb.fake.get('usuarios/func9').papel, 'funcionario');
  assert.equal(get('profissionais/prof3').socio, false);
  assert.equal(priv('prof3').sinal, undefined, 'funcionário herda o sinal do estabelecimento');
});

test('só o dono convida, troca papel e remove; ninguém troca o papel do dono nem o próprio', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  await convidarEAceitar('funcionario', 'Func', 'func9', 'prof3');
  for (const t of ['tok-socio9', 'tok-func9']) {
    assert.equal((await chamar({ idToken: t, action: 'convidar', nome: 'X', email: 'x@x.com', papel: 'funcionario', profissionalId: 'prof1' })).statusCode, 403);
    assert.equal((await chamar({ idToken: t, action: 'alterar', uid: 'func9', papel: 'socio' })).statusCode, 403);
    assert.equal((await chamar({ idToken: t, action: 'remover', uid: 'dono1' })).statusCode, 403);
  }
  assert.equal((await chamar(dono({ action: 'alterar', uid: 'dono1', papel: 'socio' }))).statusCode, 403, 'dono não muda o próprio papel');
  assert.equal((await chamar(dono({ action: 'alterar', uid: 'func9', papel: 'dono' }))).statusCode, 400);
  // dono promove funcionário a sócio: marca o profissional e desliga o sinal dele (ele decide depois)
  assert.equal((await chamar(dono({ action: 'alterar', uid: 'func9', papel: 'socio' }))).statusCode, 200);
  assert.equal(amb.fake.get('usuarios/func9').papel, 'socio');
  assert.equal(get('profissionais/prof3').socio, true);
  assert.deepEqual(priv('prof3').sinal, { modo: 'desativado' });
  // e rebaixa o sócio a funcionário: volta a seguir o estabelecimento
  assert.equal((await chamar(dono({ action: 'alterar', uid: 'func9', papel: 'funcionario' }))).statusCode, 200);
  assert.equal(get('profissionais/prof3').socio, false);
  assert.deepEqual(priv('prof3').sinal, { modo: 'herdar' });
  const lista = await chamar(dono({ action: 'listar' }));
  assert.deepEqual(lista.body.membros.map((m) => [m.uid, m.papel]).sort(), [['dono1', 'dono'], ['func9', 'funcionario'], ['socio9', 'socio']]);
});

test('sinal por pessoa: o sócio liga/desliga o PRÓPRIO; exige a chave Pix dele; o dono não mexe', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  const s = (sinal, t = 'tok-socio9') => chamar({ idToken: t, action: 'sinal-profissional', sinal });
  assert.equal((await s({ modo: 'ativo', percentual: 30, prazoHoras: 12 })).statusCode, 400, 'sem Pix próprio não cobra');
  assert.equal((await chamar({ idToken: 'tok-socio9', action: 'pix-profissional', pix: PIX_SOCIO })).statusCode, 200);
  assert.equal((await s({ modo: 'ativo', percentual: 5, prazoHoras: 12 })).statusCode, 400);
  assert.equal((await s({ modo: 'ativo', percentual: 30, prazoHoras: 99 })).statusCode, 400);
  assert.equal((await s({ modo: 'quase' })).statusCode, 400);
  assert.equal((await s({ modo: 'ativo', percentual: 30, prazoHoras: 12 })).statusCode, 200);
  assert.deepEqual(priv('prof2').sinal, { modo: 'ativo', percentual: 30, prazoHoras: 12 });
  assert.equal(priv('prof2').pix.chavePix, 'socio@barbearia.com', 'gravar o sinal não apaga o Pix');
  // o dono NÃO altera nem o sinal nem o Pix do sócio
  assert.equal((await chamar(dono({ action: 'sinal-profissional', profissionalId: 'prof2', sinal: { modo: 'desativado' } }))).statusCode, 403);
  assert.equal((await chamar(dono({ action: 'pix-profissional', profissionalId: 'prof2', pix: null }))).statusCode, 403);
  // …mas cuida da configuração do profissional que é dele (prof1) e dos funcionários
  assert.equal((await chamar(dono({ action: 'sinal-profissional', profissionalId: 'prof1', sinal: { modo: 'herdar' } }))).statusCode, 200);
});

test('configSinal por pessoa: herdar / desativado / ativo (com a chave da própria pessoa, nunca a de outro)', () => {
  const info = { sinal: SINAL_NEGOCIO };
  const prof = { nome: 'X' };
  assert.equal(configSinal(info, prof, null).ativo, true, 'sem config própria: vale o do estabelecimento (funcionário e dono)');
  assert.equal(configSinal(info, prof, { sinal: { modo: 'herdar' } }).chavePix, 'dono@barbearia.com');
  const desligado = configSinal(info, prof, { sinal: { modo: 'desativado' }, pix: PIX_SOCIO });
  assert.equal(desligado.ativo, false);
  const ativo = configSinal(info, prof, { sinal: { modo: 'ativo', percentual: 30, prazoHoras: 6 }, pix: PIX_SOCIO });
  assert.deepEqual([ativo.ativo, ativo.percentual, ativo.prazoHoras, ativo.chavePix], [true, 30, 6, 'socio@barbearia.com']);
  const semPix = configSinal(info, prof, { sinal: { modo: 'ativo', percentual: 30, prazoHoras: 6 } });
  assert.equal(semPix.ativo, false, 'sócio "ativo" sem Pix próprio NÃO cai na chave do dono');
  assert.equal(configSinal({ sinal: { ...SINAL_NEGOCIO, ativo: false } }, prof, { sinal: { modo: 'ativo', percentual: 30, prazoHoras: 6 }, pix: PIX_SOCIO }).ativo, true, 'o sócio cobra mesmo com o sinal do estabelecimento desligado');
});

test('ponta a ponta: cada agendamento paga o sinal conforme quem atende', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  await convidarEAceitar('funcionario', 'Func', 'func9', 'prof3');
  // sócio começa sem sinal: agenda direto
  const livre = await agendar({ profissionalId: 'prof2' });
  assert.equal(livre.statusCode, 201);
  assert.equal(livre.body.sinal, null);
  assert.equal(amb.fake.get(`barbearias/${SLUG}/agendamentos/${livre.body.id}`).status, 'confirmado');
  // funcionário segue o dono (cobra, na chave do dono)
  const f = await agendar({ profissionalId: 'prof3', horario: '11:00', whatsapp: '(21) 98888-7777' });
  assert.ok(f.body.sinal.pixCopiaECola.includes('dono@barbearia.com'));
  // sócio liga o dele
  await chamar({ idToken: 'tok-socio9', action: 'pix-profissional', pix: PIX_SOCIO });
  await chamar({ idToken: 'tok-socio9', action: 'sinal-profissional', sinal: { modo: 'ativo', percentual: 30, prazoHoras: 12 } });
  const s = await agendar({ profissionalId: 'prof2', horario: '14:00', whatsapp: '(21) 97777-1111' });
  assert.ok(s.body.sinal.pixCopiaECola.includes('socio@barbearia.com'));
  assert.equal(s.body.sinal.percentual, 30);
  assert.equal(s.body.sinal.valor, Math.round(40 * 30) / 100);
});

test('serviços próprios do sócio: cria, edita e apaga só os dele; não toca no catálogo do dono', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  await convidarEAceitar('funcionario', 'Func', 'func9', 'prof3');
  const s = (corpo, t = 'tok-socio9') => chamar({ idToken: t, action: 'servico-proprio', ...corpo });
  const novo = await s({ nome: 'Sobrancelha Premium', duracaoMin: 20, preco: 25.5 });
  assert.equal(novo.statusCode, 200, JSON.stringify(novo.body));
  const doc = get(`servicos/${novo.body.id}`);
  assert.deepEqual([doc.nome, doc.preco, doc.duracaoMin, doc.profissionaisIds, doc.ativo], ['Sobrancelha Premium', 25.5, 20, ['prof2'], true]);
  assert.equal((await s({ id: novo.body.id, nome: 'Sobrancelha Plus', duracaoMin: 25, preco: 30 })).statusCode, 200);
  assert.equal(get(`servicos/${novo.body.id}`).nome, 'Sobrancelha Plus');
  assert.deepEqual(get(`servicos/${novo.body.id}`).profissionaisIds, ['prof2'], 'continua só dele');
  // catálogo do dono: intocável
  assert.equal((await s({ id: 'srv1', nome: 'Corte hackeado', duracaoMin: 30, preco: 1 })).statusCode, 403);
  assert.equal((await s({ operacao: 'apagar', id: 'srv1' })).statusCode, 403);
  assert.equal(get('servicos/srv1').nome, 'Corte');
  // validações
  assert.equal((await s({ nome: 'A', duracaoMin: 20, preco: 5 })).statusCode, 400);
  assert.equal((await s({ nome: 'Serviço', duracaoMin: 2, preco: 5 })).statusCode, 400);
  assert.equal((await s({ nome: 'Serviço', duracaoMin: 20, preco: -1 })).statusCode, 400);
  assert.equal((await s({ nome: 'Serviço', duracaoMin: 20, preco: 5, foto: 'http://evil/x.svg' })).statusCode, 400);
  // dono e funcionário não usam esta ação
  assert.equal((await s({ nome: 'Serviço', duracaoMin: 20, preco: 5 }, 'tok-dono1')).statusCode, 403);
  assert.equal((await s({ nome: 'Serviço', duracaoMin: 20, preco: 5 }, 'tok-func9')).statusCode, 403);
  // apagar o próprio
  assert.equal((await s({ operacao: 'apagar', id: novo.body.id })).statusCode, 200);
  assert.equal(get(`servicos/${novo.body.id}`), undefined);
});

test('link público: cada profissional traz se cobra sinal (sem nunca mostrar chave Pix) e a tela usa o do escolhido', async () => {
  await convidarEAceitar('socio', 'Sócio', 'socio9', 'prof2');
  await chamar({ idToken: 'tok-socio9', action: 'pix-profissional', pix: PIX_SOCIO });
  await chamar({ idToken: 'tok-socio9', action: 'sinal-profissional', sinal: { modo: 'ativo', percentual: 30, prazoHoras: 12 } });
  const r = res();
  await require('../api/negocio')(req('GET', { query: { slug: SLUG } }), r);
  const p = r.body.profissionais;
  assert.deepEqual(p.prof1.sinal, { ativo: true, percentual: 50, prazoHoras: 24 }, 'do dono: vale o do estabelecimento');
  assert.deepEqual(p.prof2.sinal, { ativo: true, percentual: 30, prazoHoras: 12 }, 'do sócio: o dele');
  assert.deepEqual(p.prof3.sinal, { ativo: true, percentual: 50, prazoHoras: 24 }, 'funcionário: segue o estabelecimento');
  const texto = JSON.stringify(r.body);
  assert.equal(texto.includes('socio@barbearia.com'), false);
  assert.equal(texto.includes('dono@barbearia.com'), false);
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /const sinal = sinalDoProfissional\(\);/);
  assert.match(app, /function sinalDoProfissional\(\) \{[\s\S]*?state\.profissionais\[state\.profissionalId\]/);
});

test('papelDe do navegador dá o mesmo resultado que o do servidor, e a tela usa os papéis', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
  const extrair = (nome) => {
    const ini = fonte.indexOf(`function ${nome}(`);
    assert.ok(ini >= 0, nome);
    let i = fonte.indexOf('{', fonte.indexOf(')', ini)), n = 0;
    for (; i < fonte.length; i++) { if (fonte[i] === '{') n++; else if (fonte[i] === '}' && --n === 0) break; }
    return fonte.slice(ini, i + 1);
  };
  const ctx = vm.createContext({});
  vm.runInContext(extrair('permissoesDe') + '\n' + extrair('papelDe'), ctx);
  for (const u of [null, {}, { role: 'owner' }, { papel: 'socio' }, { papel: 'funcionario', permissoes: TOTAL }, { papel: 'x', permissoes: NADA }, { role: 'profissional', permissoes: NADA },
    { role: 'profissional', permissoes: { verTodos: false, gerirNegocio: true } }, { permissoes: TOTAL }]) {
    assert.equal(vm.runInContext('papelDe', ctx)(u), E.papelDe(u), JSON.stringify(u));
  }
  const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(admin, /const PAPEL_ROTULO = \{ dono: 'Dono', socio: 'Sócio', funcionario: 'Funcionário' \};/);
  assert.match(admin, /chamarEquipe\('equipe-ativar', \{ ativa \}\)/);
  assert.match(admin, /chamarEquipe\('servico-proprio'/);
  assert.match(admin, /chamarEquipe\('sinal-profissional'/);
  assert.match(admin, /function podeConfigurarPessoa\(id\)[\s\S]*?return !pessoa\.socio;/, 'o dono não configura a pessoa que é sócio');
  assert.doesNotMatch(admin, /htmlPermissoes|lerPermissoes|modalAlterarAcesso/, 'saíram as caixas técnicas de permissão');
});
