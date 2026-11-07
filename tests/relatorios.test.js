// Relatórios por período (js/utils.js) e aviso push de atendimentos esquecidos (api/_lib/pendencias.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { contarPendentes } = require('../api/_lib/pendencias');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
function extrair(nome) {
  const ini = fonte.indexOf(`function ${nome}(`);
  assert.ok(ini >= 0, nome);
  let i = fonte.indexOf('{', fonte.indexOf(')', ini)), n = 0;
  for (; i < fonte.length; i++) { if (fonte[i] === '{') n++; else if (fonte[i] === '}' && --n === 0) break; }
  return fonte.slice(ini, i + 1);
}
const ctx = vm.createContext({ Object, Date, Number, Set, String, Math });
['chaveData', 'periodoPronto', 'resumoPeriodo'].forEach((f) => vm.runInContext(extrair(f), ctx));
const J = (x) => JSON.parse(JSON.stringify(x));
const resumo = (a, de, ate) => J(vm.runInContext('resumoPeriodo', ctx)(a, de, ate));
const pronto = (n, d) => J(vm.runInContext('periodoPronto', ctx)(n, d));

test('períodos prontos', () => {
  const hoje = new Date(2026, 10, 7);
  assert.deepEqual(pronto('mes', hoje), { de: '2026-11-01', ate: '2026-11-30' });
  assert.deepEqual(pronto('mes-passado', hoje), { de: '2026-10-01', ate: '2026-10-31' });
  assert.deepEqual(pronto('30dias', hoje), { de: '2026-10-09', ate: '2026-11-07' });
  assert.deepEqual(pronto('ano', hoje), { de: '2026-01-01', ate: '2026-11-07' });
  assert.deepEqual(pronto('mes-passado', new Date(2026, 0, 15)), { de: '2025-12-01', ate: '2025-12-31' });
});

const base = { clienteWhatsapp: '5521', profissionalNome: 'Ana' };
const ags = {
  a: { ...base, status: 'concluido', dataChave: '2026-10-05', valorTotal: 80, servicos: [{ nome: 'Corte', preco: 50 }, { nome: 'Barba', preco: 30 }] },
  b: { ...base, status: 'concluido', dataChave: '2026-10-31', valorTotal: 50, servicos: [{ nome: 'Corte', preco: 50 }] },
  c: { ...base, clienteWhatsapp: '5522', profissionalNome: 'Beto', status: 'concluido', dataChave: '2026-10-10', valorTotal: 50, servicos: [{ nome: 'Corte', preco: 50 }] },
  d: { ...base, status: 'cancelado', dataChave: '2026-10-11', motivoCancelamento: 'nao-compareceu' },
  e: { ...base, status: 'cancelado', dataChave: '2026-10-12' },
  f: { ...base, status: 'confirmado', dataChave: '2026-10-20' },
  fora: { ...base, status: 'concluido', dataChave: '2026-11-01', valorTotal: 999, servicos: [{ nome: 'Corte', preco: 999 }] },
  antes: { ...base, status: 'concluido', dataChave: '2026-09-30', valorTotal: 999, servicos: [{ nome: 'Corte', preco: 999 }] }
};

test('outubro: faturamento, quantidade por serviço, clientes únicos, faltas e pendentes (limites inclusivos)', () => {
  const r = resumo(ags, '2026-10-01', '2026-10-31');
  assert.equal(r.faturamento, 180);
  assert.equal(r.atendimentos, 3);
  assert.equal(r.clientes, 2, 'mesmo WhatsApp conta uma vez');
  assert.equal(r.ticket, 60);
  assert.equal(r.cancelados, 2);
  assert.equal(r.faltas, 1);
  assert.equal(r.pendentes, 1);
  assert.deepEqual(r.servicos, [{ nome: 'Corte', qtd: 3, valor: 150 }, { nome: 'Barba', qtd: 1, valor: 30 }]);
  assert.deepEqual(r.profissionais, [{ nome: 'Ana', qtd: 2, valor: 130 }, { nome: 'Beto', qtd: 1, valor: 50 }]);
});

test('período vazio e entrada vazia não quebram', () => {
  const r = resumo(ags, '2027-01-01', '2027-01-31');
  assert.equal(r.atendimentos, 0); assert.equal(r.ticket, 0); assert.deepEqual(r.servicos, []);
  assert.equal(resumo(null, '2026-10-01', '2026-10-31').faturamento, 0);
});

test('servidor: conta pendentes no horário de Brasília (término + 30 min)', () => {
  const lista = [
    { status: 'confirmado', dataChave: '2026-11-06', horario: '17:00', duracaoMin: 30 },
    { status: 'confirmado', dataChave: '2026-11-07', horario: '05:00', duracaoMin: 30 },
    { status: 'confirmado', dataChave: '2026-11-07', horario: '17:00', duracaoMin: 30 },
    { status: 'concluido', dataChave: '2026-11-06', horario: '10:00', duracaoMin: 30 },
    { status: 'confirmado', dataChave: 'x', horario: 'y' }
  ];
  assert.equal(contarPendentes(lista, { dataChave: '2026-11-07', minutos: 6 * 60 }), 2);
  assert.equal(contarPendentes(lista, { dataChave: '2026-11-07', minutos: 5 * 60 + 59 }), 1);
  assert.equal(contarPendentes(lista, { dataChave: '2026-11-07', minutos: 18 * 60 }), 3);
});

test('telas: menu Relatórios, filtros e ligação no painel', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /data-view="relatorios"/);
  assert.match(html, /id="view-relatorios"/);
  assert.match(html, /id="rel-de"[\s\S]*id="rel-ate"/);
  assert.match(admin, /case 'relatorios': renderizarRelatorios\(\); break;/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'api', 'cron-recorrencias.js'), 'utf8'), /avisarPendentes\(n\.ref, agora\)/);
});

test('card "Agendamentos hoje": mostra cancelados (com faltas) e remarcados; remarcação grava a origem', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'api', 'agendamento-cliente.js'), 'utf8');
  assert.match(admin, /plural\(cancelados\.length, 'cancelado', 'cancelados'\)/);
  assert.match(admin, /plural\(remarcados\.length, 'remarcado', 'remarcados'\)/);
  assert.match(admin, /a\.remarcadoDeDataChave === hojeChave && a\.dataChave !== hojeChave/);
  assert.match(admin, /remarcadoDeDataChave: a\.dataChave/);
  assert.match(cli, /remarcadoDeDataChave: ag\.dataChave/);
});

test('remarcar pelo painel: horário atual não vem pré-selecionado e o mesmo dia/horário é recusado', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'api', 'agendamento-cliente.js'), 'utf8');
  assert.doesNotMatch(admin, /h === a\.horario && dataStr === a\.dataChave \? 'selected'/);
  assert.match(admin, /novaData === a\.dataChave && novoHorario === a\.horario/);
  assert.match(cli, /ag\.dataChave === novaDataChave && ag\.horario === novoHorario/);
});

test('card do agendamento remarcado mostra a etiqueta com a data de origem', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(admin, /const remarcadoBadge = \(a\.remarcadoEm && a\.status !== 'cancelado'\)/);
  assert.match(admin, /\$\{lembreteBadge\}\$\{escapeHtml\(a\.clienteNome\)\}\$\{remarcadoBadge\}/);
});
