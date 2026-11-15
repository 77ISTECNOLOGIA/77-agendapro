// Link do cliente "ao vivo": página aberta há tempo passa a mostrar preço, foto, serviço, profissional e expediente atuais
// (atualizarDadosNegocio, js/app.js). Executa a função REAL num navegador simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
function extrair(nome) {
  const m = new RegExp('(async )?function ' + nome + '\\(').exec(app);
  assert.ok(m, nome + ' não encontrada');
  let i = app.indexOf('{', app.indexOf(')', m.index)), n = 0;
  for (; i < app.length; i++) { if (app[i] === '{') n++; else if (app[i] === '}' && --n === 0) break; }
  return app.slice(m.index, i + 1);
}

const SERVICO = (preco, extra = {}) => ({ nome: 'Corte', preco, duracaoMin: 30, ativo: true, ...extra });
const BASE = () => ({
  barbearia: { nome: 'Lipão', aceitaAgendamentos: true },
  servicos: { s1: SERVICO(40) },
  profissionais: { p1: { nome: 'Felipe', ativo: true }, p2: { nome: 'Carlos', ativo: true } }
});

function montar({ resposta, telaAtiva = 2, selecao = {} } = {}) {
  const log = [];
  const estado = {
    slug: 'lipao', barbearia: { nome: 'Lipão', aceitaAgendamentos: true }, servicos: { s1: SERVICO(40) },
    profissionais: { p1: { nome: 'Felipe', ativo: true }, p2: { nome: 'Carlos', ativo: true } },
    profissionalId: 'p1', servicosSelecionados: ['s1'], dataSelecionada: 'D', horarioSelecionado: '10:00', horariosCache: { x: 1 }, ...selecao
  };
  const ctx = vm.createContext({
    encodeURIComponent, Date, Object, Promise, JSON,
    fetch: async () => { log.push('fetch'); return resposta; },
    state: estado,
    $: (sel) => ({ classList: { contains: () => sel === '#tela-' + telaAtiva, add: () => log.push('esconde ' + sel) } }),
    profissionalRealizaServico: (s, id) => !Array.isArray(s.profissionaisIds) || !s.profissionaisIds.length || s.profissionaisIds.includes(id),
    renderizarHeader: () => log.push('header'), carregarFotosServicos: () => log.push('fotos'),
    renderizarTela2: () => log.push('tela2'), atualizarResumoTela2: () => log.push('resumo2'), renderizarTela3: () => log.push('tela3'),
    renderizarResumoFinal: () => log.push('resumo4'), mostrarTela: (n) => log.push('mostrarTela' + n),
    mostrarErroBarbearia: () => log.push('erro-negocio'), toast: (m) => log.push('toast')
  });
  vm.runInContext(extrair('profissionaisAtivos') + '\nlet ultimaAtualizacaoNegocio = 0, atualizandoNegocio = false, assinaturaServidor = "";\n'
    + 'const assinaturaDe = (dados) => JSON.stringify([dados.barbearia || {}, dados.servicos || {}, dados.profissionais || {}]);\n'
    + 'assinaturaServidor = assinaturaDe(' + JSON.stringify(BASE()) + ');\n' + extrair('atualizarDadosNegocio') + '\nthis.f = atualizarDadosNegocio;', ctx);
  return { ctx, log, estado };
}
const ok = (corpo) => ({ ok: true, status: 200, json: async () => corpo });

test('nada mudou no servidor: a tela não é mexida (nem toast, nem redesenho)', async () => {
  const { ctx, log } = montar({ resposta: ok(BASE()) });
  assert.equal(await ctx.f(), false);
  assert.deepEqual(log.filter((x) => x !== 'fetch'), []);
});

test('preço novo: aparece na hora na tela de serviços, com aviso', async () => {
  const novo = BASE(); novo.servicos.s1 = SERVICO(55);
  const { ctx, log, estado } = montar({ resposta: ok(novo) });
  await ctx.f();
  assert.equal(estado.servicos.s1.preco, 55);
  assert.ok(log.includes('tela2') && log.includes('resumo2') && log.includes('toast'));
  assert.equal(estado.profissionalId, 'p1');                         // o que a pessoa escolheu continua
  assert.deepEqual(Array.from(estado.servicosSelecionados), ['s1']);
});

test('foto trocada: pede só a nova (a antiga continua enquanto isso) e mantém a que não mudou', async () => {
  const novo = BASE(); novo.servicos.s1 = SERVICO(40, { temFoto: true, fotoV: 'novo' });
  const mesma = BASE(); mesma.servicos.s1 = SERVICO(40, { temFoto: true, fotoV: 'igual' });
  const a = montar({ resposta: ok(novo), selecao: { servicos: { s1: SERVICO(40, { temFoto: true, fotoV: 'velho', foto: 'data:antiga' }) } } });
  await a.ctx.f();
  assert.equal(a.estado.servicos.s1.foto, undefined);               // versão diferente: a antiga não vale mais
  assert.ok(a.log.includes('fotos'));
  const b = montar({ resposta: ok(mesma), selecao: { servicos: { s1: SERVICO(40, { temFoto: true, fotoV: 'igual', foto: 'data:atual' }) } } });
  await b.ctx.f();
  assert.equal(b.estado.servicos.s1.foto, 'data:atual');             // mesma versão: reaproveita sem baixar
});

test('profissional excluído: some, a escolha é desfeita e a tela 2 é redesenhada', async () => {
  const novo = BASE(); delete novo.profissionais.p1;
  const { ctx, log, estado } = montar({ resposta: ok(novo) });
  assert.equal(await ctx.f(), true);
  assert.deepEqual(Object.keys(estado.profissionais), ['p2']);
  assert.equal(estado.profissionalId, null);
  assert.equal(estado.servicosSelecionados.length, 0);
  assert.equal(estado.horarioSelecionado, null);
  assert.ok(log.includes('tela2'));
});

test('profissional desativado também some; serviço que o profissional deixou de fazer sai da seleção', async () => {
  const a = BASE(); a.profissionais.p1.ativo = false;
  const x = montar({ resposta: ok(a) });
  assert.equal(await x.ctx.f(), true);
  assert.equal(x.estado.profissionalId, null);
  const b = BASE(); b.servicos.s1 = SERVICO(40, { profissionaisIds: ['p2'] });
  const y = montar({ resposta: ok(b) });
  assert.equal(await y.ctx.f(), true);
  assert.equal(y.estado.servicosSelecionados.length, 0);
});

test('na tela de horários e no resumo final, uma mudança volta para a escolha ou redesenha o resumo', async () => {
  const preco = BASE(); preco.servicos.s1 = SERVICO(60);
  const t4 = montar({ resposta: ok(preco), telaAtiva: 4 });
  await t4.ctx.f();
  assert.ok(t4.log.includes('resumo4') && !t4.log.includes('mostrarTela2'));
  const t3 = montar({ resposta: ok(preco), telaAtiva: 3 });
  await t3.ctx.f();
  assert.ok(t3.log.includes('tela3'));
  const sem = BASE(); delete sem.profissionais.p1;
  const t4b = montar({ resposta: ok(sem), telaAtiva: 4 });
  await t4b.ctx.f();
  assert.ok(t4b.log.includes('mostrarTela2') && t4b.log.includes('tela2'));
});

test('negócio suspenso com a página aberta: mostra a tela de indisponível; falha de rede não estraga nada', async () => {
  const s = BASE(); s.barbearia = { nome: 'Lipão', aceitaAgendamentos: false, motivoIndisponivel: 'Suspenso' };
  const x = montar({ resposta: ok(s) });
  await x.ctx.f();
  assert.ok(x.log.includes('erro-negocio'));
  const y = montar({ resposta: { ok: false, status: 500 } });
  assert.equal(await y.ctx.f(), false);
  assert.equal(y.estado.profissionalId, 'p1');
});

test('a atualização é disparada ao voltar para a aba, a cada 30 s, ao entrar na escolha, e o servidor protege preço e profissional ao agendar', () => {
  assert.ok(/visibilitychange[\s\S]{0,200}atualizarDadosNegocio/.test(app));
  assert.ok(/setInterval\([\s\S]{0,700}atualizarDadosNegocio\(\)[\s\S]{0,400}30000\)/.test(app));
  assert.ok(/numero === 2 && Date\.now\(\) - ultimaAtualizacaoNegocio > 5000\) atualizarDadosNegocio/.test(app));
  assert.ok(/valorEsperado: servicosEscolhidos\(\)/.test(app) && /O valor mudou/.test(app) && /Profissional indispon/.test(app));
});
