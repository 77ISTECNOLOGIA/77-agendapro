// Pix e preço/duração POR PROFISSIONAL (api/equipe.js: pix-profissional e precos-profissional; criar-agendamento).

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAmbiente, req, res, semearNegocio, dataEmDias } = require('./_helpers');

const amb = montarAmbiente();
const equipe = require('../api/equipe');
const criarAgendamento = require('../api/criar-agendamento');
const { configSinal } = require('../api/_lib/sinal');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const SOPROPRIO = { verTodos: false, gerirNegocio: false };
const SO_GERE = { verTodos: false, gerirNegocio: true };
const PIX_PROF = { tipoChave: 'email', chavePix: 'pedro@barbearia.com', nomeRecebedor: 'Pedro Alves', cidadeRecebedor: 'Rio de Janeiro', banco: 'inter' };
const SINAL_NEGOCIO = { ativo: true, percentual: 50, prazoHoras: 24, tipoChave: 'email', chavePix: 'dono@barbearia.com', nomeRecebedor: 'JOAO SILVA', cidadeRecebedor: 'RIO' };

async function chamar(corpo) { const r = res(); await equipe(req('POST', { body: corpo }), r); return r; }
const comoDono = (extra) => ({ idToken: 'tok-dono1', ...extra });
const agendar = async (extra = {}) => {
  const r = res();
  await criarAgendamento(req('POST', { body: { slug: SLUG, whatsapp: '(21) 99999-1234', nome: 'Maria Souza', profissionalId: 'prof1', servicosIds: ['srv1', 'srv2'], dataChave: dataEmDias(3), horario: '10:00', ...extra } }), r);
  limparLimites();
  return r;
};
const prof = (id) => amb.fake.get(`barbearias/${SLUG}/profissionais/${id}`);
const servico = (id) => amb.fake.get(`barbearias/${SLUG}/servicos/${id}`);

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, SLUG);                                    // Corte 40 (30 min) + Barba 35 (30 min)
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof2`, { nome: 'Pedro', ativo: true, comissao: 50 });
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner', email: 'dono1@teste.com' });
  amb.fake.seed('usuarios/socio1', { barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof1', email: 's1@teste.com', permissoes: SO_GERE });
  amb.fake.seed('usuarios/socio2', { barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof2', email: 's2@teste.com', permissoes: SO_GERE });
  amb.fake.seed('usuarios/func', { barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof2', email: 'f@teste.com', permissoes: SOPROPRIO });
});

// ---------------------------------------------------------------- Pix
test('Pix: cada profissional define o próprio; sócio não mexe no do outro; admin mexe em todos; null remove', async () => {
  const ok = await chamar({ idToken: 'tok-socio1', action: 'pix-profissional', pix: PIX_PROF });
  assert.equal(ok.statusCode, 200);
  assert.equal(prof('prof1').pix.chavePix, 'pedro@barbearia.com');
  assert.equal(prof('prof1').pix.banco, 'Banco Inter');
  // sócio2 (mesmo gerindo o negócio) NÃO altera o Pix do prof1: é dinheiro do outro
  const negado = await chamar({ idToken: 'tok-socio2', action: 'pix-profissional', profissionalId: 'prof1', pix: { ...PIX_PROF, chavePix: 'ladrao@x.com' } });
  assert.equal(negado.statusCode, 403);
  assert.equal(prof('prof1').pix.chavePix, 'pedro@barbearia.com');
  // dados inválidos
  assert.equal((await chamar({ idToken: 'tok-socio1', action: 'pix-profissional', pix: { ...PIX_PROF, tipoChave: 'cpf', chavePix: '123' } })).statusCode, 400);
  assert.equal((await chamar({ idToken: 'tok-socio1', action: 'pix-profissional', pix: { ...PIX_PROF, nomeRecebedor: '' } })).statusCode, 400);
  assert.equal((await chamar({ idToken: 'tok-socio1', action: 'pix-profissional', pix: 'texto' })).statusCode, 400);
  // administrador pleno altera o de qualquer um
  assert.equal((await chamar(comoDono({ action: 'pix-profissional', profissionalId: 'prof2', pix: PIX_PROF }))).statusCode, 200);
  // remover: volta a valer o do negócio
  assert.equal((await chamar({ idToken: 'tok-socio1', action: 'pix-profissional', pix: null })).statusCode, 200);
  assert.equal(prof('prof1').pix, null);
  assert.equal((await chamar(comoDono({ action: 'pix-profissional', profissionalId: 'nao-existe', pix: PIX_PROF }))).statusCode, 404);
});

test('Pix: o sinal vai para quem atende (o do negócio é o padrão)', async () => {
  amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), sinal: SINAL_NEGOCIO });
  amb.fake.seed(`barbearias/${SLUG}/profissionais/prof2`, { ...prof('prof2'), pix: PIX_PROF });
  const info = amb.fake.get(`barbearias/${SLUG}`);
  assert.equal(configSinal(info, prof('prof1')).chavePix, 'dono@barbearia.com', 'sem Pix próprio: o do negócio');
  const cfg2 = configSinal(info, prof('prof2'));
  assert.equal(cfg2.chavePix, 'pedro@barbearia.com');
  assert.equal(cfg2.nomeRecebedor, 'Pedro Alves');
  assert.equal(cfg2.percentual, 50, 'percentual e prazo continuam do negócio');
  assert.equal(cfg2.pixProprio, true);
  // ponta a ponta: o "copia e cola" do cliente leva a chave de quem atende
  const r1 = await agendar({ profissionalId: 'prof1' });
  assert.ok(r1.body.sinal.pixCopiaECola.includes('dono@barbearia.com'));
  const r2 = await agendar({ profissionalId: 'prof2', horario: '14:00', whatsapp: '(21) 98888-7777' });
  assert.ok(r2.body.sinal.pixCopiaECola.includes('pedro@barbearia.com'));
  assert.equal(r2.body.sinal.recebedor, 'Pedro Alves');
  assert.equal(r2.body.sinal.banco, 'Banco Inter');
  assert.ok(!r2.body.sinal.pixCopiaECola.includes('dono@barbearia.com'));
  // Pix próprio não liga o sinal sozinho: quem liga é o negócio
  amb.fake.seed(`barbearias/${SLUG}`, { ...info, sinal: { ...SINAL_NEGOCIO, ativo: false } });
  assert.equal(configSinal(amb.fake.get(`barbearias/${SLUG}`), prof('prof2')).ativo, false);
});

// ---------------------------------------------------------------- preço e duração
test('preço por profissional: o servidor aplica preço e duração de quem atende', async () => {
  const r = await chamar({ idToken: 'tok-socio2', action: 'precos-profissional', precos: { srv1: { preco: 60, duracaoMin: 45 }, srv2: { preco: 50 } } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(servico('srv1').precosProfissional, { prof2: { preco: 60, duracaoMin: 45 } });
  assert.deepEqual(servico('srv2').precosProfissional, { prof2: { preco: 50 } });
  const a2 = await agendar({ profissionalId: 'prof2' });
  assert.equal(a2.statusCode, 201);
  const ag2 = amb.fake.get(`barbearias/${SLUG}/agendamentos/${a2.body.id}`);
  assert.equal(ag2.valorTotal, 110, 'prof2: 60 + 50');
  assert.equal(ag2.duracaoMin, 45 + 30, 'duração: 45 (própria) + 30 (padrão)');
  assert.deepEqual(ag2.servicos.map((s) => s.preco), [60, 50]);
  const a1 = await agendar({ profissionalId: 'prof1', horario: '14:00', whatsapp: '(21) 98888-7777' });
  assert.equal(amb.fake.get(`barbearias/${SLUG}/agendamentos/${a1.body.id}`).valorTotal, 75, 'prof1 continua no preço padrão');
  // a API pública mostra os preços de cada profissional (só o que é número válido)
  amb.fake.seed(`barbearias/${SLUG}/servicos/srv2`, { ...servico('srv2'), precosProfissional: { prof2: { preco: 50, extra: 'x' }, 'a/b': { preco: 1 }, prof1: { preco: -5, duracaoMin: 'abc' } } });
  const pub = res();
  await require('../api/negocio')(req('GET', { query: { slug: SLUG } }), pub);
  assert.deepEqual(pub.body.servicos.srv2.precosProfissional, { prof2: { preco: 50 } });
});

test('preço por profissional: validações, permissões e voltar ao padrão', async () => {
  for (const [precos, esperado] of [
    [{ srv1: { preco: -1 } }, 400], [{ srv1: { preco: 'abc' } }, 400], [{ srv1: { duracaoMin: 0 } }, 400], [{ srv1: { duracaoMin: 2.5 } }, 400],
    [{ srv1: { preco: 1000000 } }, 400], [{ 'a/b': { preco: 5 } }, 400], [{ inexistente: { preco: 5 } }, 404], ['texto', 400]
  ]) assert.equal((await chamar({ idToken: 'tok-socio2', action: 'precos-profissional', precos })).statusCode, esperado, JSON.stringify(precos));
  assert.equal(servico('srv1').precosProfissional, undefined, 'nada foi gravado nos pedidos inválidos');
  // sócio2 (só gerencia) não mexe nos preços do prof1; o admin pleno sim
  assert.equal((await chamar({ idToken: 'tok-socio2', action: 'precos-profissional', profissionalId: 'prof1', precos: { srv1: { preco: 1 } } })).statusCode, 403);
  assert.equal((await chamar(comoDono({ action: 'precos-profissional', profissionalId: 'prof1', precos: { srv1: { preco: 55 } } }))).statusCode, 200);
  // quem só vê o próprio trabalho também define os próprios preços
  assert.equal((await chamar({ idToken: 'tok-func', action: 'precos-profissional', precos: { srv1: { preco: 70 } } })).statusCode, 200);
  assert.deepEqual(servico('srv1').precosProfissional, { prof1: { preco: 55 }, prof2: { preco: 70 } });
  // voltar ao padrão: null remove só a entrada daquele profissional
  assert.equal((await chamar(comoDono({ action: 'precos-profissional', profissionalId: 'prof1', precos: { srv1: null } }))).statusCode, 200);
  assert.deepEqual(servico('srv1').precosProfissional, { prof2: { preco: 70 } });
});

test('regra de preço por profissional: navegador e servidor dão o mesmo resultado', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
  const extrair = (nome) => {
    const ini = fonte.indexOf(`function ${nome}(`);
    assert.ok(ini >= 0, nome);
    let i = fonte.indexOf('{', fonte.indexOf(')', ini)), n = 0;
    for (; i < fonte.length; i++) { if (fonte[i] === '{') n++; else if (fonte[i] === '}' && --n === 0) break; }
    return fonte.slice(ini, i + 1);
  };
  const ctx = vm.createContext({ Object, Array, Number, Math });
  ['precosProfissionalValidos', 'servicoParaProfissional', 'temPrecoPorProfissional'].forEach((f) => vm.runInContext(extrair(f), ctx));
  const servidor = require('../api/_lib/negocio');
  const casos = [
    { preco: 40, duracaoMin: 30 },
    { preco: 40, duracaoMin: 30, precosProfissional: { p1: { preco: 60 } } },
    { preco: 40, duracaoMin: 30, precosProfissional: { p1: { duracaoMin: 45 }, p2: { preco: 0, duracaoMin: 20 } } },
    { preco: 40, duracaoMin: 30, precosProfissional: { p1: { preco: -1, duracaoMin: 0 }, 'a/b': { preco: 5 }, p2: 'x', p3: null } },
    { preco: 40, duracaoMin: 30, precosProfissional: [1, 2] }, { preco: 40, duracaoMin: 30, precosProfissional: 'x' }
  ];
  for (const s of casos) for (const p of ['p1', 'p2', 'p3', 'a/b', '']) {
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('servicoParaProfissional', ctx)(s, p))), servidor.servicoParaProfissional(s, p), JSON.stringify([s, p]));
  }
  assert.equal(vm.runInContext('temPrecoPorProfissional', ctx)(casos[1]), true);
  assert.equal(vm.runInContext('temPrecoPorProfissional', ctx)(casos[0]), false);
});

test('sócios de mesmo nível: nenhum remove nem rebaixa o outro; cada um sai por conta própria; o administrador pleno manda nos dois', async () => {
  assert.equal((await chamar({ idToken: 'tok-socio1', action: 'remover', uid: 'socio2' })).statusCode, 403);
  assert.equal((await chamar({ idToken: 'tok-socio1', action: 'alterar', uid: 'socio2', permissoes: SOPROPRIO })).statusCode, 403);
  assert.ok(amb.fake.get('usuarios/socio2'));
  assert.deepEqual(amb.fake.get('usuarios/socio2').permissoes, SO_GERE);
  // a lista não oferece a ação que o servidor recusaria
  const lista = await chamar({ idToken: 'tok-socio1', action: 'listar' });
  assert.equal(lista.body.membros.find((m) => m.uid === 'socio2').podeModificar, false);
  assert.equal(lista.body.membros.find((m) => m.uid === 'func').podeModificar, true, 'quem tem menos acesso, sim');
  // cada um pode abrir mão do PRÓPRIO acesso e até sair
  assert.equal((await chamar({ idToken: 'tok-socio1', action: 'alterar', uid: 'socio1', permissoes: SOPROPRIO })).statusCode, 200);
  assert.equal((await chamar({ idToken: 'tok-socio2', action: 'remover', uid: 'socio2' })).statusCode, 200);
  assert.equal(amb.fake.get('usuarios/socio2'), undefined);
  // o administrador pleno (vê tudo + gerencia) tem mais acesso que os dois
  assert.equal((await chamar(comoDono({ action: 'remover', uid: 'socio1' }))).statusCode, 200);
});

test('cliente fixo: quem só vê o próprio trabalho cria, lista e encerra SÓ na própria agenda', async () => {
  const recorrencia = require('../api/recorrencia');
  const rec = async (corpo) => { const r = res(); await recorrencia(req('POST', { body: corpo }), r); limparLimites(); return r; };
  const serie = (extra = {}) => ({ action: 'criar', clienteNome: 'Carlos Fixo', clienteWhatsapp: '(21) 99999-1234', profissionalId: 'prof1', servicosIds: ['srv1'], dataInicio: dataEmDias(3), horario: '09:00', modo: 'ate', ate: dataEmDias(20), ...extra });
  amb.fake.seed('usuarios/solo1', { barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof1', email: 'solo1@teste.com', permissoes: SOPROPRIO });
  amb.fake.seed('usuarios/solo2', { barbeariaId: SLUG, role: 'profissional', profissionalId: 'prof2', email: 'solo2@teste.com', permissoes: SOPROPRIO });
  amb.fake.seed('usuarios/semprof', { barbeariaId: SLUG, role: 'profissional', email: 'sp@teste.com', permissoes: SOPROPRIO });
  const minha = await rec({ idToken: 'tok-solo1', ...serie() });
  assert.equal(minha.statusCode, 201, JSON.stringify(minha.body));
  assert.equal((await rec({ idToken: 'tok-solo1', ...serie({ profissionalId: 'prof2' }) })).statusCode, 403, 'não cria na agenda do outro');
  assert.equal((await rec({ idToken: 'tok-semprof', ...serie() })).statusCode, 403, 'sem profissional vinculado e sem ver tudo');
  const outra = await rec({ idToken: 'tok-dono1', ...serie({ profissionalId: 'prof2', horario: '15:00' }) });
  assert.equal(outra.statusCode, 201);
  // lista: cada um vê só as próprias; quem vê tudo vê todas
  const l1 = await rec({ idToken: 'tok-solo1', action: 'listar' });
  assert.deepEqual(l1.body.series.map((s) => s.profissionalId), ['prof1']);
  assert.equal((await rec({ idToken: 'tok-dono1', action: 'listar' })).body.series.length, 2);
  // encerrar: não alcança a série do outro (nem sabe que existe)
  assert.equal((await rec({ idToken: 'tok-solo1', action: 'encerrar', serieId: outra.body.serieId })).statusCode, 404);
  assert.equal((await rec({ idToken: 'tok-solo1', action: 'encerrar', serieId: minha.body.serieId })).statusCode, 200);
  // renovar o negócio todo fica para a rotina diária e para quem vê tudo
  const ren = await rec({ idToken: 'tok-solo2', action: 'renovar' });
  assert.deepEqual([ren.statusCode, ren.body.criadas], [200, 0]);
});

test('chave Pix do negócio: só o administrador pleno altera; sócio gerente ajusta percentual e prazo sem tocar em quem recebe', async () => {
  const configurar = require('../api/configurar-negocio');
  const cfg = async (idToken, sinal) => { const r = res(); await configurar(req('POST', { body: { idToken, sinal } }), r); limparLimites(); return r; };
  const NOVO = { ...SINAL_NEGOCIO, chavePix: 'ladrao@x.com', nomeRecebedor: 'LADRAO', cidadeRecebedor: 'SP', banco: 'xyz' };
  // o dono grava a chave do negócio
  assert.equal((await cfg('tok-dono1', SINAL_NEGOCIO)).statusCode, 200);
  assert.equal(amb.fake.get(`barbearias/${SLUG}`).sinal.chavePix, 'dono@barbearia.com');
  // sócio que só gerencia manda outra chave (e ajusta o percentual): a chave NÃO muda, o percentual sim
  const r = await cfg('tok-socio1', { ...NOVO, percentual: 30, prazoHoras: 12 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const s = amb.fake.get(`barbearias/${SLUG}`).sinal;
  assert.equal(s.chavePix, 'dono@barbearia.com');
  assert.equal(s.nomeRecebedor, 'JOAO SILVA');
  assert.deepEqual([s.percentual, s.prazoHoras], [30, 12]);
  // e pode desligar o sinal
  assert.equal((await cfg('tok-socio1', { ...NOVO, ativo: false, percentual: 30, prazoHoras: 12 })).statusCode, 200);
  assert.equal(amb.fake.get(`barbearias/${SLUG}`).sinal.ativo, false);
  assert.equal(amb.fake.get(`barbearias/${SLUG}`).sinal.chavePix, 'dono@barbearia.com');
  // o dono troca a chave normalmente
  assert.equal((await cfg('tok-dono1', { ...NOVO, chavePix: 'novo@barbearia.com', nomeRecebedor: 'JOAO NOVO' })).statusCode, 200);
  assert.equal(amb.fake.get(`barbearias/${SLUG}`).sinal.chavePix, 'novo@barbearia.com');
});
