// Abertura do painel do dono (js/admin.js → inicializarAuth): ordem das chamadas ao banco.
// Executa as funções REAIS num navegador simulado com um Firestore de mentira cujos tempos o teste controla.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');

function extrair(src, nome) {
  const m = new RegExp('(async )?function ' + nome + '\\(').exec(src);
  assert.ok(m, 'função ' + nome + ' não encontrada');
  let i = src.indexOf('{', src.indexOf(')', m.index)), n = 0;
  for (; i < src.length; i++) { if (src[i] === '{') n++; else if (src[i] === '}' && --n === 0) break; }
  return src.slice(m.index, i + 1);
}
const CODIGO = ['lerVinculoGuardado', 'guardarVinculo', 'inicializarAuth', 'ativarListenersTempoReal', 'desativarListeners', 'mostrarApp', 'lerPapelGuardado', 'guardarPapel', 'papelDe', 'mesmoPapel']
  .map((f) => extrair(admin, f)).join('\n');

const flush = () => new Promise((r) => setImmediate(r));
const SUBS = ['servicos', 'profissionais', 'agendamentos', 'clientes'];

const PAPEL_TOTAL = { verTodos: true, gerirNegocio: true, profissionalId: '' };
const utilsFonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
const CODIGO_UTILS = ['permissoesDe', 'clientesDosAgendamentos'].map((f) => extrair(utilsFonte, f)).join('\n');

function montar({ palpite = null, papelPalpite = PAPEL_TOTAL } = {}) {
  const log = [];                       // ordem em que as coisas aconteceram
  const escutas = [];                   // { path, cb, erro, cancelada }
  const armazenamento = new Map(palpite ? [['ap_vinculo_u1', palpite], ['ap_papel_u1', JSON.stringify(papelPalpite)]] : []);
  let resolverUsuarios;
  const usuarios = new Promise((r) => { resolverUsuarios = r; });
  const el = () => ({ classList: { add() {}, remove() {} }, addEventListener() {}, textContent: '', disabled: false });
  let aoMudarAuth = null;

  const ctx = vm.createContext({
    console: { error() {}, log() {} }, Promise, Set, Object, RegExp, setTimeout: (f) => { log.push('adiado'); ctx.__adiados.push(f); return 0; },
    __adiados: [],
    localStorage: { getItem: (k) => (armazenamento.has(k) ? armazenamento.get(k) : null), setItem: (k, v) => armazenamento.set(k, v), removeItem: (k) => armazenamento.delete(k) },
    state: { user: null, barbeariaId: null, barbearia: null, negocioExiste: false, appPronto: false, dadosCarregados: false, listeners: [], servicos: {}, profissionais: {}, agendamentos: {}, clientes: {} },
    $: () => el(), db: {}, auth: {},
    doc: (pai, ...seg) => ({ path: (pai && pai.path ? [pai.path, ...seg] : seg).join('/') }),
    collection: (ref, nome) => ({ path: ref.path + '/' + nome }),
    getDoc: (ref) => { log.push('getDoc:' + ref.path); return usuarios; },
    getDocs: () => { throw new Error('não pode baixar tudo de uma vez: os acompanhamentos em tempo real já fazem isso'); },
    query: (ref, filtro) => ({ path: ref.path, filtro }),
    where: (campo, op, valor) => ({ campo, op, valor }),
    aplicarPermissoesNaTela: () => log.push('permissoes'),
    onSnapshot: (ref, cb, erro) => { log.push('escuta:' + ref.path); const e = { path: ref.path, filtro: ref.filtro, cb, erro, cancelada: false }; escutas.push(e); return () => { e.cancelada = true; }; },
    onAuthStateChanged: (_a, cb) => { aoMudarAuth = cb; },
    signOut: async () => { log.push('signOut'); },
    adicionarMostrarSenha() {}, handleLogin() {}, handleEsqueciSenha() {}, handleLogout() {},
    mostrarLogin: (msg) => { log.push('login:' + (msg || '')); },
    aplicarTema: () => log.push('tema'), renderizarUserInfo: () => log.push('userInfo'), avisarSituacaoConta: () => {},
    renderizarTudo: async () => { log.push('renderizarTudo'); },
    renderizarViewAtual: () => log.push('desenhou'),
    tratarLinkDeNotificacao: () => log.push('linkNotificacao'),
    renovarHorariosFixos: () => log.push('renovar'), ouvirNotificacoesEmPrimeiroPlano: () => log.push('ouvirNotif'), atualizarServiceWorker: () => log.push('atualizarSW')
  });
  vm.runInContext(CODIGO_UTILS, ctx);
  vm.runInContext(CODIGO, ctx);
  vm.runInContext('inicializarAuth()', ctx);
  assert.equal(typeof aoMudarAuth, 'function');

  const snap = (existe = true, dados = {}) => ({ exists: () => existe, data: () => (existe ? dados : undefined), forEach: (f) => Object.entries(dados).forEach(([id, d]) => f({ id, data: () => d })) });
  return {
    ctx, log, escutas, armazenamento,
    entrar: () => aoMudarAuth({ uid: 'u1', email: 'dono@teste.com' }),
    usuarioEncontrado: (barbeariaId, extra = {}) => resolverUsuarios({ exists: () => true, data: () => ({ barbeariaId, nome: 'Dono', ...extra }) }),
    usuarioSemVinculo: () => resolverUsuarios({ exists: () => false, data: () => undefined }),
    entregarTudo: (ativas, negocio = snap(true, { nome: 'Barbearia', tipoNegocio: 'barbearia' })) => {
      for (const e of ativas) {
        if (e.path.split('/').length === 2) e.cb(negocio);
        else e.cb(snap(true, {}));
      }
    },
    snap
  };
}

const caminhosDe = (b) => [`barbearias/${b}`, ...SUBS.map((s) => `barbearias/${b}/${s}`)];

test('1ª visita (sem palpite): vínculo primeiro, depois UMA rodada de dados em tempo real (nada de baixar tudo duas vezes)', async () => {
  const t = montar();
  const fim = t.entrar();
  await flush();
  assert.deepEqual(t.log, ['getDoc:usuarios/u1'], 'antes de saber o negócio não há o que ouvir');
  t.usuarioEncontrado('lipao');
  await flush();
  assert.deepEqual(t.escutas.map((e) => e.path).sort(), caminhosDe('lipao').sort());
  assert.ok(!t.log.includes('renderizarTudo'), 'a tela só aparece quando as 5 fontes chegaram');
  t.entregarTudo(t.escutas);
  await fim;
  assert.ok(t.log.indexOf('tema') < t.log.indexOf('renderizarTudo'));
  assert.equal(t.ctx.state.dadosCarregados, true);
  assert.equal(t.ctx.state.appPronto, true);
  assert.equal(t.armazenamento.get('ap_vinculo_u1'), 'lipao', 'guarda o palpite para a próxima abertura');
  assert.ok(!t.log.includes('desenhou'), 'nada é redesenhado enquanto a tela ainda não apareceu');
});

test('com palpite da última visita: os dados começam a chegar ANTES de o vínculo ser confirmado (em paralelo)', async () => {
  const t = montar({ palpite: 'lipao' });
  const fim = t.entrar();
  await flush();
  assert.equal(t.escutas.length, 5, 'já está ouvindo os dados enquanto espera a confirmação do vínculo');
  assert.ok(t.log.indexOf('escuta:barbearias/lipao') >= 0 && t.log.indexOf('escuta:barbearias/lipao') < t.log.indexOf('getDoc:usuarios/u1'),
    'a escuta dos dados é registrada ANTES de esperar o vínculo (a ordem na fila é o que garante o paralelismo)');
  t.entregarTudo(t.escutas);                    // os dados chegam antes de o vínculo ser confirmado
  await flush();
  assert.ok(!t.log.includes('renderizarTudo'), 'ainda espera o vínculo confirmar antes de mostrar o painel');
  t.usuarioEncontrado('lipao');
  await fim;
  assert.equal(t.escutas.length, 5, 'palpite certo: não reinicia nada');
  assert.ok(t.escutas.every((e) => !e.cancelada));
  assert.equal(t.ctx.state.dadosCarregados, true);
});

test('palpite errado (vínculo mudou): cancela as escutas do negócio errado e recomeça com o certo', async () => {
  const t = montar({ palpite: 'outro-negocio' });
  const fim = t.entrar();
  await flush();
  assert.equal(t.escutas.length, 5);
  t.usuarioEncontrado('lipao');
  await flush();
  const velhas = t.escutas.slice(0, 5), novas = t.escutas.slice(5);
  assert.ok(velhas.every((e) => e.cancelada), 'as escutas do negócio errado são canceladas');
  assert.deepEqual(novas.map((e) => e.path).sort(), caminhosDe('lipao').sort());
  velhas.forEach((e) => e.erro(new Error('permission-denied')));   // o banco nega o negócio alheio: não pode derrubar nada
  t.entregarTudo(novas);
  await fim;
  assert.equal(t.armazenamento.get('ap_vinculo_u1'), 'lipao', 'palpite corrigido');
  assert.equal(t.ctx.state.barbeariaId, 'lipao');
  assert.equal(t.ctx.state.dadosCarregados, true);
});

test('usuário sem vínculo: sai da conta, mostra o aviso e esquece o palpite', async () => {
  const t = montar({ palpite: 'lipao' });
  const fim = t.entrar();
  await flush();
  t.usuarioSemVinculo();
  await fim;
  assert.ok(t.log.includes('signOut'));
  assert.ok(t.log.includes('login:Usuário sem barbearia vinculada. Contate o suporte.'));
  assert.ok(t.escutas.every((e) => e.cancelada), 'não deixa escuta aberta');
  assert.equal(t.armazenamento.has('ap_vinculo_u1'), false);
  assert.ok(!t.log.includes('renderizarTudo'));
});

test('negócio inexistente ou erro ao ler: volta ao login com a mensagem de erro e sem escutas abertas', async () => {
  let t = montar();
  let fim = t.entrar();
  await flush();
  t.usuarioEncontrado('fantasma');
  await flush();
  t.entregarTudo(t.escutas, t.snap(false));
  await fim;
  assert.ok(t.log.includes('login:Erro ao carregar dados. Tente novamente.'));
  assert.ok(t.escutas.every((e) => e.cancelada));
  assert.ok(!t.log.includes('renderizarTudo'));

  t = montar();
  fim = t.entrar();
  await flush();
  t.usuarioEncontrado('lipao');
  await flush();
  t.escutas[2].erro(new Error('permission-denied'));
  await fim;
  assert.ok(t.log.includes('login:Erro ao carregar dados. Tente novamente.'));
});

test('depois da tela aparecer, as escutas redesenham; o que não é urgente vai para depois (adiado)', async () => {
  const t = montar({ palpite: 'lipao' });
  const fim = t.entrar();
  await flush();
  t.entregarTudo(t.escutas);
  t.usuarioEncontrado('lipao');
  await fim;
  assert.ok(!t.log.includes('renovar') && !t.log.includes('ouvirNotif') && !t.log.includes('atualizarSW'), 'ainda não rodaram');
  assert.ok(t.log.includes('adiado'));
  t.ctx.__adiados.forEach((f) => f());
  assert.ok(t.log.includes('renovar') && t.log.includes('ouvirNotif') && t.log.includes('atualizarSW'));
  const antes = t.log.filter((x) => x === 'desenhou').length;
  t.escutas[3].cb(t.snap(true, { a1: { status: 'confirmado' } }));
  assert.equal(t.log.filter((x) => x === 'desenhou').length, antes + 1, 'agora cada novidade do banco redesenha a tela');
});

test('arquivos: modulepreload, pacote de notificações sob demanda, QR Code sob demanda, imagens em cache', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  for (const m of ['js/admin.js', 'js/utils.js', 'js/vocabulario.js', 'js/firebase-config.js', 'firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js']) {
    assert.match(html, new RegExp('rel="modulepreload" href="[^"]*' + m.replace(/\./g, '\\.')), m);
  }
  assert.doesNotMatch(html, /modulepreload[^>]*firebase-messaging/, 'o pacote de notificações não entra na abertura');
  assert.doesNotMatch(html, /<script src="https:\/\/cdn\.jsdelivr\.net[^>]*qrcode/, 'QR Code não é mais baixado na abertura');
  assert.match(html, /rel="preconnect" href="https:\/\/www\.gstatic\.com"/);
  assert.doesNotMatch(admin, /^import \{[^}]*getMessaging[^}]*\} from/m, 'firebase-messaging só por import() sob demanda');
  assert.match(admin, /import\("https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.0\/firebase-messaging\.js"\)/);
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const img = vercel.headers.find((h) => h.source === '/img/(.*)');
  assert.ok(img && /max-age=86400/.test(img.headers[0].value));
  assert.ok(!admin.includes('async function carregarBarbearia'), 'o download em dobro foi removido');
});

// ---------------------------------------------------------------- equipe: quem não vê tudo só consulta o que é dele
const SOCIO = { role: 'profissional', profissionalId: 'prof1', permissoes: { verTodos: false, gerirNegocio: false } };

test('quem não vê tudo (1ª visita): lê só o próprio profissional e só os agendamentos dele; não toca em clientes', async () => {
  const t = montar();
  const fim = t.entrar();
  await flush();
  t.usuarioEncontrado('lipao', SOCIO);
  await flush();
  const caminhos = t.escutas.map((e) => e.path).sort();
  assert.deepEqual(caminhos, ['barbearias/lipao', 'barbearias/lipao/agendamentos', 'barbearias/lipao/profissionais/prof1', 'barbearias/lipao/servicos']);
  const ag = t.escutas.find((e) => e.path.endsWith('/agendamentos'));
  assert.deepEqual(ag.filtro, { campo: 'profissionalId', op: '==', valor: 'prof1' }, 'a consulta TEM de filtrar, senão as regras do banco recusam');
  assert.ok(!t.escutas.some((e) => e.path.endsWith('/clientes') || e.path.endsWith('/profissionais')), 'nem a lista de clientes nem a de profissionais');
  for (const e of t.escutas) {
    if (e.path.endsWith('/agendamentos')) e.cb(t.snap(true, { a1: { clienteWhatsapp: '5521999990001', clienteNome: 'Ana', dataChave: '2026-12-01', status: 'confirmado' }, a2: { clienteWhatsapp: '5521999990001', clienteNome: 'Ana', dataChave: '2026-12-08', status: 'concluido' }, a3: { clienteWhatsapp: '5521999990002', clienteNome: 'Bia', dataChave: '2026-12-02', status: 'cancelado' } }));
    else if (e.path.endsWith('/prof1')) e.cb({ exists: () => true, id: 'prof1', data: () => ({ nome: 'João' }) });
    else if (e.path.split('/').length === 2) e.cb(t.snap(true, { nome: 'B', tipoNegocio: 'barbearia' }));
    else e.cb(t.snap(true, {}));
  }
  await fim;
  assert.deepEqual(Object.keys(t.ctx.state.profissionais), ['prof1']);
  assert.deepEqual(Object.keys(t.ctx.state.clientes), ['5521999990001'], 'clientes vêm dos próprios agendamentos (cancelados não contam)');
  assert.equal(t.ctx.state.clientes['5521999990001'].totalAgendamentos, 2);
  assert.equal(t.ctx.state.dadosCarregados, true);
  assert.equal(t.armazenamento.get('ap_papel_u1'), JSON.stringify({ verTodos: false, gerirNegocio: false, profissionalId: 'prof1' }));
  t.ctx.__adiados.forEach((f) => f());
  assert.ok(!t.log.includes('renovar'), 'horários fixos (API só de quem vê tudo) não são renovados por quem não vê tudo');
});

test('palpite de papel: sócio que antes via tudo e agora não vê recomeça as escutas com o filtro', async () => {
  const t = montar({ palpite: 'lipao' });         // palpite = acesso total
  const fim = t.entrar();
  await flush();
  assert.equal(t.escutas.length, 5);
  t.usuarioEncontrado('lipao', SOCIO);
  await flush();
  assert.ok(t.escutas.slice(0, 5).every((e) => e.cancelada), 'as escutas sem filtro (que o banco recusaria) são canceladas');
  const novas = t.escutas.slice(5);
  assert.equal(novas.length, 4);
  assert.ok(novas.some((e) => e.filtro && e.filtro.valor === 'prof1'));
  t.escutas.slice(0, 5).forEach((e) => e.erro && e.erro(new Error('permission-denied')));
  for (const e of novas) {
    if (e.path.endsWith('/prof1')) e.cb({ exists: () => true, id: 'prof1', data: () => ({ nome: 'J' }) });
    else if (e.path.split('/').length === 2) e.cb(t.snap(true, { nome: 'B', tipoNegocio: 'barbearia' }));
    else e.cb(t.snap(true, {}));
  }
  await fim;
  assert.equal(t.ctx.state.papel.verTodos, false);
});

test('sem palpite de papel guardado (aparelho antigo), nada começa em paralelo: só depois de saber o papel', async () => {
  const t = montar();
  t.armazenamento.set('ap_vinculo_u1', 'lipao');   // só o negócio, sem papel
  const fim = t.entrar();
  await flush();
  assert.deepEqual(t.log, ['getDoc:usuarios/u1']);
  t.usuarioEncontrado('lipao');
  await flush();
  t.entregarTudo(t.escutas);
  await fim;
  assert.equal(t.ctx.state.dadosCarregados, true);
});

test('permissoesDe do navegador dá o mesmo resultado que o do servidor', () => {
  const servidor = require('../api/_lib/equipe');
  const ctx = vm.createContext({});
  vm.runInContext(extrair(utilsFonte, 'permissoesDe'), ctx);
  for (const u of [null, {}, { role: 'owner' }, { role: 'profissional' }, { barbeariaId: 'x' }, { role: 'owner', permissoes: { verTodos: false, gerirNegocio: false } },
    { permissoes: { verTodos: true, gerirNegocio: false } }, { permissoes: { verTodos: 'sim', gerirNegocio: 1 } }, { role: 'x', permissoes: {} }]) {
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('permissoesDe', ctx)(u))), servidor.permissoesDe(u), JSON.stringify(u));
  }
});
