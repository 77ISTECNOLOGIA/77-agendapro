// Intervalo (almoço) no horário de funcionamento: servidor, grades do navegador e telas.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { montarAmbiente, req, res, dataEmDias, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const criarAgendamento = require('../api/criar-agendamento');
const { verificarSlot, pausaDoDia } = require('../api/_lib/disponibilidade');
const { limparLimites } = require('../api/_lib/http');
const { diaSemanaDaChave } = require('../api/_lib/tempo');

const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SLUG = 'barbearia-teste';

function extrairFuncao(src, nome) {
  const m = new RegExp('(?:export )?(?:async )?function ' + nome + '\\(').exec(src);
  assert.ok(m, nome + ' não encontrada');
  let i = src.indexOf('{', src.indexOf(')', m.index)), n = 0;
  for (; i < src.length; i++) { if (src[i] === '{') n++; else if (src[i] === '}' && --n === 0) break; }
  return src.slice(m.index, i + 1).replace(/^export /, '');
}

// ---------------------------------------------------------------- regra do servidor
const AMANHA = dataEmDias(3);
const DIA = diaSemanaDaChave(AMANHA);
const NEGOCIO = (extra = {}) => ({ horarioFuncionamento: { [DIA]: { ativo: true, inicio: '09:00', fim: '19:00', ...extra } } });
const AGORA = { dataChave: dataEmDias(0), minutos: 8 * 60 };
const slot = (info, prof, horario, duracaoMin = 30) => verificarSlot({ prof: { id: 'p1', ativo: true, ...prof }, info, agendamentos: [], dataChave: AMANHA, horario, duracaoMin, agora: AGORA });

test('intervalo do estabelecimento: bloqueia quem toca no almoço (12:00–13:00) e libera o resto', () => {
  const info = NEGOCIO({ pausaInicio: '12:00', pausaFim: '13:00' });
  assert.equal(slot(info, {}, '11:00', 30).ok, true, 'termina 11:30');
  assert.equal(slot(info, {}, '11:30', 30).ok, true, 'termina 12:00 em ponto');
  assert.equal(slot(info, {}, '11:30', 60).ok, false, 'invade o almoço');
  const r = slot(info, {}, '12:00', 30);
  assert.equal(r.ok, false); assert.match(r.motivo, /intervalo/i);
  assert.equal(slot(info, {}, '12:30', 30).ok, false);
  assert.equal(slot(info, {}, '13:00', 30).ok, true, 'começa quando o almoço acaba');
  assert.equal(slot(info, {}, '11:00', 120).ok, false, 'serviço longo que atravessa o almoço');
});

test('sem intervalo (ou intervalo inválido) nada muda', () => {
  assert.equal(slot(NEGOCIO(), {}, '12:00').ok, true);
  for (const ruim of [{ pausaInicio: '12:00' }, { pausaFim: '13:00' }, { pausaInicio: '13:00', pausaFim: '12:00' }, { pausaInicio: '12:00', pausaFim: '12:00' }, { pausaInicio: 'x', pausaFim: 'y' }]) {
    assert.equal(slot(NEGOCIO(ruim), {}, '12:00').ok, true, JSON.stringify(ruim));
  }
});

test('profissional com horário próprio: usa o intervalo dele; sem intervalo próprio, herda o do estabelecimento', () => {
  const info = NEGOCIO({ pausaInicio: '12:00', pausaFim: '13:00' });
  const proprio = { horarioTrabalho: { [DIA]: { ativo: true, inicio: '09:00', fim: '19:00', pausaInicio: '14:00', pausaFim: '15:00' } } };
  assert.equal(slot(info, proprio, '12:00').ok, true, 'o almoço dele é às 14h, não às 12h');
  assert.equal(slot(info, proprio, '14:00').ok, false);
  const semPausa = { horarioTrabalho: { [DIA]: { ativo: true, inicio: '09:00', fim: '19:00' } } };
  assert.equal(slot(info, semPausa, '12:00').ok, false, 'herda o intervalo do estabelecimento');
  assert.equal(slot(info, semPausa, '13:00').ok, true);
});

test('pausaDoDia: prioridade e validação', () => {
  assert.deepEqual(pausaDoDia({ pausaInicio: '14:00', pausaFim: '15:00' }, { pausaInicio: '12:00', pausaFim: '13:00' }), { ini: 840, fim: 900 });
  assert.deepEqual(pausaDoDia({}, { pausaInicio: '12:00', pausaFim: '13:00' }), { ini: 720, fim: 780 });
  assert.equal(pausaDoDia(undefined, undefined), null);
  assert.deepEqual(pausaDoDia({ pausaInicio: '15:00', pausaFim: '14:00' }, { pausaInicio: '12:00', pausaFim: '13:00' }), { ini: 720, fim: 780 }, 'intervalo inválido do profissional é ignorado');
});

test('API: agendar dentro do almoço é recusado pelo servidor; fora dele passa', async () => {
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, SLUG, { horarioFuncionamento: Object.fromEntries(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].map((d) => [d, { ativo: true, inicio: '09:00', fim: '19:00', pausaInicio: '12:00', pausaFim: '13:00' }])) });
  const agendar = async (horario) => { const r = res(); await criarAgendamento(req('POST', { body: { slug: SLUG, whatsapp: '(21) 99999-1234', nome: 'Maria', profissionalId: 'prof1', servicosIds: ['srv1'], dataChave: AMANHA, horario } }), r); limparLimites(); return r; };
  const dentro = await agendar('12:00');
  assert.equal(dentro.statusCode, 409);
  assert.match(dentro.body.erro, /intervalo/i);
  assert.equal((await agendar('13:00')).statusCode, 201);
});

// ---------------------------------------------------------------- utilitários do navegador (mesma regra) e validação da tela
function carregarUtils() {
  const utils = ler('js/utils.js');
  const ctx = vm.createContext({ String, Number });
  ['horaEmMinutos', 'pausaValida', 'pausaDoDia', 'validarPausaDia'].forEach((f) => vm.runInContext(extrairFuncao(utils, f), ctx));
  return (js) => JSON.parse(JSON.stringify(vm.runInContext(js, ctx)));
}

test('navegador e servidor seguem a MESMA regra de intervalo', () => {
  const r = carregarUtils();
  const casos = [
    [{ pausaInicio: '14:00', pausaFim: '15:00' }, { pausaInicio: '12:00', pausaFim: '13:00' }],
    [{}, { pausaInicio: '12:00', pausaFim: '13:00' }], [undefined, undefined], [{ pausaInicio: '15:00', pausaFim: '14:00' }, { pausaInicio: '12:00', pausaFim: '13:00' }],
    [{ pausaInicio: '12:00' }, {}], [null, { pausaInicio: '11:30', pausaFim: '12:30' }]
  ];
  for (const [p, n] of casos) assert.deepEqual(r('pausaDoDia(' + JSON.stringify(p) + ', ' + JSON.stringify(n) + ')'), pausaDoDia(p, n), JSON.stringify([p, n]));
});

test('tela: valida o intervalo digitado (completo, fim depois do início, dentro do horário do dia)', () => {
  const r = carregarUtils();
  const v = (d) => r('validarPausaDia(' + JSON.stringify(d) + ')');
  const base = { ativo: true, inicio: '09:00', fim: '19:00' };
  assert.equal(v({ ...base }), '');
  assert.equal(v({ ...base, pausaInicio: '12:00', pausaFim: '13:00' }), '');
  assert.match(v({ ...base, pausaInicio: '12:00', pausaFim: '' }), /início e o fim/);
  assert.match(v({ ...base, pausaInicio: '13:00', pausaFim: '12:00' }), /depois do início/);
  assert.match(v({ ...base, pausaInicio: '12:00', pausaFim: '12:00' }), /depois do início/);
  assert.match(v({ ...base, pausaInicio: '08:00', pausaFim: '09:30' }), /dentro do horário/);
  assert.match(v({ ...base, pausaInicio: '18:00', pausaFim: '20:00' }), /dentro do horário/);
  assert.equal(v({ ativo: false, inicio: '09:00', fim: '19:00', pausaInicio: '08:00', pausaFim: '09:30' }), '', 'dia fechado: não confere');
});

// ---------------------------------------------------------------- grades do navegador
function grade(src, nome, { dia, ctxExtra = {} }) {
  const app = ler('js/app.js'), utils = ler('js/utils.js');
  const state = { barbearia: { horarioFuncionamento: { [dia]: { ativo: true, inicio: '09:00', fim: '19:00', pausaInicio: '12:00', pausaFim: '13:00' } } }, profissionais: { p1: { id: 'p1' } }, servicos: {}, servicosSelecionados: [], agendamentos: {} };
  const ctx = vm.createContext({ state, Date, Object, Number, String, diasDaSemana: () => ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'], ...ctxExtra });
  ['horaEmMinutos', 'pausaValida', 'pausaDoDia'].forEach((f) => vm.runInContext(extrairFuncao(utils, f), ctx));
  vm.runInContext(['horaParaMinutos', 'minutosParaHora', 'dataParaChave'].map((f) => extrairFuncao(src, f)).join('\n') + '\n' + extrairFuncao(src, nome), ctx);
  return { ctx, state };
}

test('link do cliente: horários que tocam no almoço aparecem como indisponíveis', () => {
  const app = ler('js/app.js');
  const data = new Date(); data.setDate(data.getDate() + 3); data.setHours(0, 0, 0, 0);
  const dia = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][data.getDay()];
  const { ctx } = grade(app, 'calcularHorariosDisponiveis', { dia });
  ctx.d = data;
  const horas = (dur) => JSON.parse(JSON.stringify(vm.runInContext('calcularHorariosDisponiveis("p1", d, { duracaoTotalOverride: ' + dur + ' })', ctx)));
  const indisp = (lista, h) => lista.find((s) => s.hora === h).indisponivel;
  const meia = horas(30);
  assert.equal(indisp(meia, '11:30'), false); assert.equal(indisp(meia, '12:00'), true); assert.equal(indisp(meia, '12:30'), true); assert.equal(indisp(meia, '13:00'), false);
  const hora = horas(60);
  assert.equal(indisp(hora, '11:00'), false); assert.equal(indisp(hora, '11:30'), true, 'serviço de 1 h começando 11:30 invade o almoço');
});

test('painel do dono (agendamento manual): os mesmos horários ficam de fora', () => {
  const admin = ler('js/admin.js');
  const data = new Date(); data.setDate(data.getDate() + 3); data.setHours(0, 0, 0, 0);
  const dia = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][data.getDay()];
  const { ctx } = grade(admin, 'calcularHorariosDisponiveisAdmin', { dia });
  ctx.d = data;
  const lista = JSON.parse(JSON.stringify(vm.runInContext('calcularHorariosDisponiveisAdmin("p1", d, 30)', ctx)));
  assert.ok(lista.includes('11:30') && lista.includes('13:00'));
  assert.ok(!lista.includes('12:00') && !lista.includes('12:30'));
  const comProprio = JSON.parse(JSON.stringify(vm.runInContext('state.profissionais.p1.horarioTrabalho = { ' + dia + ': { ativo: true, inicio: "09:00", fim: "19:00", pausaInicio: "14:00", pausaFim: "15:00" } }; calcularHorariosDisponiveisAdmin("p1", d, 30)', ctx)));
  assert.ok(comProprio.includes('12:00') && !comProprio.includes('14:00'), 'profissional com intervalo próprio');
});

// ---------------------------------------------------------------- telas (arquivos)
test('telas: intervalo no horário do estabelecimento e no do profissional; só grava se marcado; valida antes de salvar', () => {
  const admin = ler('js/admin.js'), html = ler('admin.html');
  assert.match(admin, /htmlPausa\('hf', h\)/); assert.match(admin, /htmlPausa\('ht', h\)/);
  assert.match(admin, /checked\) \{\s*\n\s*dia\.pausaInicio = linha\.querySelector/, 'só grava o intervalo se estiver marcado');
  assert.match(admin, /if \(erroHorario\) \{ const e = new Error\(erroHorario\); e\.mensagemUsuario = erroHorario; throw e; \}/, 'Configurações: erro de intervalo para antes de salvar (e o botão volta ao normal)');
  assert.match(admin, /if \(erroHorario\) \{ toast\(erroHorario, 'erro'\); return; \}/, 'Profissional: idem');
  assert.match(html, /intervalo \(almoço\)/i);
  assert.match(ler('css/admin.css'), /\.horario-pausa \{ grid-column: 1 \/ -1;/);
  assert.match(ler('js/app.js'), /pausa && m < pausa\.fim && m \+ duracaoTotal > pausa\.ini/);
});

// ---------------------------------------------------------------- "Copiar para todos os dias"
test('copiar para todos os dias: repete horário e intervalo da linha clicada nas outras, sem mexer em quais dias estão abertos', () => {
  const admin = ler('js/admin.js');
  const campos = (ativo, ini, fim, pa, pi, pf) => ({ 'ativo': { checked: ativo }, 'inicio': { value: ini }, 'fim': { value: fim }, 'pausa-ativo': { checked: pa }, 'pausa-inicio': { value: pi }, 'pausa-fim': { value: pf } });
  const mkLinha = (c) => ({ c, querySelector(sel) { return this.c[sel.replace(/^\.[a-z]+-/, '')]; }, closest: () => null });
  const seg = mkLinha(campos(true, '10:00', '20:00', true, '13:00', '14:00'));
  const ter = mkLinha(campos(false, '09:00', '18:00', false, '12:00', '13:00'));
  const qua = mkLinha(campos(true, '08:00', '17:00', true, '11:00', '12:00'));
  const container = { querySelectorAll: () => [seg, ter, qua] };
  seg.parentElement = container; seg.closest = (s) => (s === '.horario-linha' ? seg : null);
  const avisos = [];
  const ctx = vm.createContext({ Array, toast: (m, t) => avisos.push(t + ':' + m) });
  vm.runInContext(extrairFuncao(admin, 'copiarLinhaParaTodos'), ctx);
  ctx.botao = { closest: (s) => (s === '.horario-linha' ? seg : null), dataset: { copiar: 'ht' } };
  vm.runInContext('copiarLinhaParaTodos(botao)', ctx);
  for (const l of [seg, ter, qua]) {
    assert.equal(l.c.inicio.value, '10:00'); assert.equal(l.c.fim.value, '20:00');
    assert.equal(l.c['pausa-ativo'].checked, true); assert.equal(l.c['pausa-inicio'].value, '13:00'); assert.equal(l.c['pausa-fim'].value, '14:00');
  }
  assert.equal(ter.c.ativo.checked, false, 'terça continua fechada');
  assert.equal(qua.c.ativo.checked, true);
  assert.match(avisos[0], /^sucesso:Horário e intervalo copiados/);
  // sem o botão certo, não faz nada
  assert.doesNotThrow(() => { ctx.botao = { closest: () => null, dataset: {} }; vm.runInContext('copiarLinhaParaTodos(botao)', ctx); });
  assert.match(admin, /data-copiar="\${prefixo}"/);
  assert.match(admin, /e\.target\.closest\('\.link-copiar'\)/);
});
