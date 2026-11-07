// Atendimentos esquecidos: confirmados cujo término + 30 min já passou (js/utils.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
const ini = fonte.indexOf('function atendimentosParaResolver(');
assert.ok(ini >= 0);
let i = fonte.indexOf('{', fonte.indexOf(')', ini)), n = 0;
for (; i < fonte.length; i++) { if (fonte[i] === '{') n++; else if (fonte[i] === '}' && --n === 0) break; }
const ctx = vm.createContext({ Object, Date, Number });
vm.runInContext(fonte.slice(ini, i + 1), ctx);
const ids = (ags, agora) => JSON.parse(JSON.stringify(vm.runInContext('atendimentosParaResolver', ctx)(ags, agora))).map((a) => a.id);

const ag = (extra) => ({ status: 'confirmado', dataChave: '2026-11-07', horario: '17:00', duracaoMin: 30, ...extra });

test('só aparece depois do término + 30 minutos (17:00 + 30 min + 30 min = 18:00)', () => {
  const ags = { a: ag() };
  assert.deepEqual(ids(ags, new Date(2026, 10, 7, 17, 29)), [], 'ainda em atendimento');
  assert.deepEqual(ids(ags, new Date(2026, 10, 7, 17, 59)), [], 'dentro da margem');
  assert.deepEqual(ids(ags, new Date(2026, 10, 7, 18, 0)), ['a'], 'passou a margem');
});

test('considera a duração do atendimento', () => {
  const ags = { a: ag({ duracaoMin: 90 }) };
  assert.deepEqual(ids(ags, new Date(2026, 10, 7, 18, 59)), []);
  assert.deepEqual(ids(ags, new Date(2026, 10, 7, 19, 0)), ['a']);
});

test('ignora concluídos e cancelados; pega dias anteriores; ordena do mais antigo', () => {
  const ags = {
    novo: ag({ dataChave: '2026-11-07', horario: '09:00' }),
    velho: ag({ dataChave: '2026-11-03', horario: '15:00' }),
    ok: ag({ status: 'concluido' }),
    cancel: ag({ status: 'cancelado' }),
    futuro: ag({ dataChave: '2026-11-09' }),
    lixo: ag({ dataChave: 'xx', horario: '??' })
  };
  assert.deepEqual(ids(ags, new Date(2026, 10, 7, 23, 0)), ['velho', 'novo']);
  assert.deepEqual(ids(null, new Date()), []);
});

test('a tela liga o aviso: botões Concluir/Faltou, selo no menu e reavaliação por minuto', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /id="pendencias-resolver"/);
  assert.match(admin, /function renderizarViewAtual\(\) \{\s*\n\s*renderizarPendencias\(\);/);
  assert.match(admin, /cancelarAgendamento\(b\.dataset\.id, 'nao-compareceu'\)/);
  assert.match(admin, /concluirAgendamento\(b\.dataset\.id\)/);
  assert.match(admin, /setInterval\(\(\) => \{ if \(state\.dadosCarregados\) renderizarPendencias\(\)/);
  assert.match(admin, /motivoCancelamento: motivo/);
});
