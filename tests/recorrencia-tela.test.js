// Cliente fixo — a TELA do painel (js/admin.js). Executa as funções reais com um navegador simulado.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
const utils = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extrair(src, nome) {
  const m = new RegExp('(async )?function ' + nome + '\\(').exec(src);
  assert.ok(m, 'função ' + nome + ' não encontrada');
  let i = src.indexOf('{', src.indexOf(')', m.index)), n = 0;
  for (; i < src.length; i++) { if (src[i] === '{') n++; else if (src[i] === '}' && --n === 0) break; }
  return src.slice(m.index, i + 1);
}
const NOMES = admin.split('\n').find((l) => l.startsWith('const NOMES_DIA_FIXO'));
const CODIGO = [
  NOMES, extrair(utils, 'escapeHtml'), extrair(utils, 'profissionalRealizaServico'),
  extrair(admin, 'chaveParaData'), extrair(admin, 'chamarRecorrencia'), extrair(admin, 'formatarDataCurta'),
  extrair(admin, 'lerFormularioNovoAgendamento'), extrair(admin, 'dadosDoHorarioFixo'),
  extrair(admin, 'salvarHorarioFixo'), extrair(admin, 'renovarHorariosFixos')
].join('\n');

function montar({ campos = {}, servicosMarcados = ['srv1'], modo = 'mensal', respostaApi = { ok: true, status: 201, corpo: { criadas: ['2026-11-13', '2026-11-20'], puladas: [] } } } = {}) {
  const toasts = [], chamadas = [], eventos = { fechou: false };
  const padrao = {
    '#nag-cliente-nome': { value: 'Carlos Fixo' }, '#nag-cliente-whatsapp': { value: '(21) 99999-1234' },
    '#nag-profissional': { value: 'prof1' }, '#nag-data': { value: '2026-11-13' }, '#nag-horario': { value: '09:00' },
    '#nag-ate': { value: '' }, '#modal-salvar': { disabled: false, textContent: 'Criar horário fixo' }
  };
  const els = { ...padrao, ...campos };
  const ctx = vm.createContext({
    console, URLSearchParams, Date, Number, JSON,
    state: { servicos: { srv1: { nome: 'Corte' }, srv2: { nome: 'Barba', profissionaisIds: ['outro'] } } },
    auth: { currentUser: { getIdToken: async () => 'token-do-dono' } },
    $: (sel) => (sel === 'input[name="nag-modo"]:checked' ? { value: modo } : els[sel]),
    $$: (sel) => (sel.includes('nag-servico-check:checked') ? servicosMarcados.map((value) => ({ value })) : []),
    toast: (m, t) => toasts.push(`[${t}] ${m}`),
    fecharModal: () => { eventos.fechou = true; },
    fetch: async (url, opcoes) => {
      chamadas.push({ url, corpo: JSON.parse(opcoes.body), cabecalhos: opcoes.headers });
      return { ok: respostaApi.ok, status: respostaApi.status, json: async () => respostaApi.corpo };
    }
  });
  vm.runInContext(CODIGO, ctx);
  return { ctx, els, toasts, chamadas, eventos, rodar: (js) => vm.runInContext(js, ctx) };
}

test('formulário: valida cada campo antes de falar com o servidor', () => {
  const casos = [
    [{ '#nag-cliente-nome': { value: '  ' } }, /nome do cliente/],
    [{ '#nag-cliente-whatsapp': { value: '123' } }, /WhatsApp válido/],
    [{ '#nag-profissional': { value: '' } }, /profissional/],
    [{ '#nag-data': { value: '' } }, /data e horário/],
    [{ '#nag-horario': { value: '' } }, /data e horário/]
  ];
  for (const [campos, regra] of casos) assert.match(montar({ campos }).rodar('lerFormularioNovoAgendamento()').erro, regra);
  assert.match(montar({ servicosMarcados: [] }).rodar('lerFormularioNovoAgendamento()').erro, /ao menos um serviço/);
  assert.match(montar({ servicosMarcados: ['srv1', 'srv2'] }).rodar('lerFormularioNovoAgendamento()').erro, /não realiza todos/);
});

test('formulário válido devolve os dados normalizados (WhatsApp com 55)', () => {
  const f = JSON.parse(JSON.stringify(montar().rodar('lerFormularioNovoAgendamento()')));
  assert.deepEqual(f, { nome: 'Carlos Fixo', whatsNorm: '5521999991234', servicoIds: ['srv1'], profId: 'prof1', dataStr: '2026-11-13', horario: '09:00' });
});

test('criar horário fixo: envia o que precisa ao servidor (com o login do dono) e confirma na tela', async () => {
  const t = montar({ respostaApi: { ok: true, status: 201, corpo: { criadas: ['2026-11-13', '2026-11-20', '2026-11-27'], puladas: [{ dataChave: '2026-11-20', motivo: 'x' }] } } });
  await t.rodar("salvarHorarioFixo(lerFormularioNovoAgendamento())");
  assert.equal(t.chamadas.length, 1);
  assert.equal(t.chamadas[0].url, '/api/recorrencia');
  assert.deepEqual(t.chamadas[0].corpo, {
    idToken: 'token-do-dono', action: 'criar', clienteNome: 'Carlos Fixo', clienteWhatsapp: '5521999991234', profissionalId: 'prof1',
    servicosIds: ['srv1'], dataInicio: '2026-11-13', horario: '09:00', modo: 'mensal', ate: null
  });
  assert.equal(t.eventos.fechou, true);
  assert.match(t.toasts[0], /\[sucesso\].*3 agendamentos/);
  assert.match(t.toasts[0], /1 data sem vaga foi pulada \(20\/11\)/);
});

test('criar "até uma data": manda a data final; sem a data, nem chama o servidor', async () => {
  const sem = montar({ modo: 'ate' });
  await sem.rodar("salvarHorarioFixo(lerFormularioNovoAgendamento())");
  assert.equal(sem.chamadas.length, 0);
  assert.match(sem.toasts[0], /Escolha a data final/);

  const com = montar({ modo: 'ate', campos: { '#nag-ate': { value: '2026-11-20' } } });
  await com.rodar("salvarHorarioFixo(lerFormularioNovoAgendamento())");
  assert.equal(com.chamadas[0].corpo.modo, 'ate');
  assert.equal(com.chamadas[0].corpo.ate, '2026-11-20');
});

test('se o servidor recusar, a tela mostra o motivo e libera o botão (nada de botão morto)', async () => {
  const t = montar({ respostaApi: { ok: false, status: 409, corpo: { erro: 'Nenhuma das datas tem horário livre.' } } });
  await t.rodar("salvarHorarioFixo(lerFormularioNovoAgendamento())");
  assert.deepEqual(t.toasts, ['[erro] Nenhuma das datas tem horário livre.']);
  assert.equal(t.eventos.fechou, false);
  assert.equal(t.els['#modal-salvar'].disabled, false);
  assert.equal(t.els['#modal-salvar'].textContent, 'Criar agendamento');
});

test('renovação ao abrir o painel: avisa só quando criou algo ou precisa de atenção, e nunca quebra', async () => {
  let t = montar({ respostaApi: { ok: true, status: 200, corpo: { criadas: 4, erros: 0 } } });
  await t.rodar('renovarHorariosFixos()');
  assert.deepEqual(t.chamadas[0].corpo, { idToken: 'token-do-dono', action: 'renovar' });
  assert.match(t.toasts[0], /4 novos agendamentos/);

  t = montar({ respostaApi: { ok: true, status: 200, corpo: { criadas: 0, erros: 1 } } });
  await t.rodar('renovarHorariosFixos()');
  assert.match(t.toasts[0], /precisa de atenção/);

  t = montar({ respostaApi: { ok: true, status: 200, corpo: { criadas: 0, erros: 0 } } });
  await t.rodar('renovarHorariosFixos()');
  assert.deepEqual(t.toasts, [], 'nada novo: nenhum aviso');

  t = montar({ respostaApi: { ok: false, status: 500, corpo: {} } });
  const silencio = console.error; console.error = () => {};
  try { await t.rodar('renovarHorariosFixos()'); } finally { console.error = silencio; }
  assert.deepEqual(t.toasts, [], 'falha na renovação não incomoda o dono');
});

test('a tela tem os pontos de entrada: caixa "Cliente fixo", prévia, botão Horários fixos e encerrar nos detalhes', () => {
  assert.match(admin, /id="nag-repetir"/);
  assert.match(admin, /id="nag-ver-datas"/);
  assert.match(admin, /name="nag-modo" value="mensal"/);
  assert.match(admin, /name="nag-modo" value="ate"/);
  assert.match(admin, /\$\('#btn-horarios-fixos'\)\.addEventListener\('click', \(\) => modalHorariosFixos\(\)\)/);
  assert.match(admin, /id="acao-encerrar-fixo"/);
  assert.match(admin, /renovarHorariosFixos\(\);/);
  assert.match(html, /id="btn-horarios-fixos"/);
  // ao marcar "Cliente fixo", o agendamento vai pro servidor em vez de gravar direto no banco
  assert.match(admin, /async function salvarNovoAgendamento\(\) \{\s*\n\s*if \(\$\('#nag-repetir'\) && \$\('#nag-repetir'\)\.checked\) \{[\s\S]{0,200}salvarHorarioFixo\(f\)/);
});
