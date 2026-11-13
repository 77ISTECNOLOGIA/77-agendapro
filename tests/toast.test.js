// Aviso curto (toast) e botão "Sair" do painel.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---- navegador simulado com relógio controlado
function montar({ semElementos = false } = {}) {
  let agora = 0, seq = 0;
  const timers = new Map();
  const relogio = {
    setTimeout: (f, ms) => { const id = ++seq; timers.set(id, { f, em: agora + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    avancar: (ms) => {
      const alvo = agora + ms;
      for (;;) {
        const prox = [...timers.entries()].filter(([, t]) => t.em <= alvo).sort((a, b) => a[1].em - b[1].em)[0];
        if (!prox) break;
        timers.delete(prox[0]); agora = prox[1].em; prox[1].f();
      }
      agora = alvo;
    }
  };
  const classes = new Set(['toast', 'hidden']);
  const el = {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    attrs: {}, vars: {}, onclick: null, offsetWidth: 1,
    setAttribute(k, v) { this.attrs[k] = v; },
    style: { setProperty(k, v) { el.vars[k] = v; } }
  };
  const texto = { textContent: '' };
  const doc = { getElementById: (id) => (semElementos ? null : (id === 'toast' ? el : id === 'toast-msg' ? texto : null)) };
  const ctx = vm.createContext({ document: doc, setTimeout: relogio.setTimeout, clearTimeout: relogio.clearTimeout, String });
  vm.runInContext(ler('js/toast.js').split('export ').join('') + '\nthis.toast = toast; this.esconderToast = esconderToast;', ctx);
  return { ctx, el, texto, classes, relogio };
}

test('toast de sucesso: aparece com o texto e o tipo, e some sozinho (barra de tempo e animação ficam no CSS)', () => {
  const t = montar();
  t.ctx.toast('Configurações salvas', 'sucesso');
  assert.equal(t.texto.textContent, 'Configurações salvas');
  assert.ok(t.classes.has('ativo') && t.classes.has('sucesso') && !t.classes.has('hidden'));
  assert.equal(t.el.attrs.role, 'status');
  assert.equal(t.el.vars['--toast-dur'], '3200ms');
  t.relogio.avancar(3199);
  assert.ok(t.classes.has('ativo'), 'ainda na tela');
  t.relogio.avancar(1);
  assert.ok(!t.classes.has('ativo'), 'começou a sair');
  assert.ok(!t.classes.has('hidden'), 'ainda animando a saída');
  t.relogio.avancar(320);
  assert.ok(t.classes.has('hidden'), 'saiu de vez');
});

test('toast de erro fica mais tempo e é anunciado como alerta', () => {
  const t = montar();
  t.ctx.toast('Não foi possível salvar', 'erro');
  assert.equal(t.el.attrs.role, 'alert');
  assert.equal(t.el.vars['--toast-dur'], '5500ms');
  t.relogio.avancar(5000);
  assert.ok(t.classes.has('ativo'));
  t.relogio.avancar(500);
  assert.ok(!t.classes.has('ativo'));
});

test('um aviso novo SUBSTITUI o anterior: o relógio do antigo não esconde o novo antes da hora', () => {
  const t = montar();
  t.ctx.toast('Primeiro', 'sucesso');
  t.relogio.avancar(3000);
  t.ctx.toast('Segundo', 'erro');
  assert.equal(t.texto.textContent, 'Segundo');
  t.relogio.avancar(300);                          // chegou o prazo original do primeiro (3200)
  assert.ok(t.classes.has('ativo') && t.classes.has('erro'), 'o segundo continua na tela');
  t.relogio.avancar(5200);
  assert.ok(!t.classes.has('ativo'), 'e some no prazo dele');
});

test('tocar no aviso fecha na hora; aviso durante a saída do anterior reaparece', () => {
  const t = montar();
  t.ctx.toast('Oi');
  t.el.onclick();
  assert.ok(!t.classes.has('ativo'));
  t.relogio.avancar(320);
  assert.ok(t.classes.has('hidden'));
  t.ctx.toast('De novo', 'sucesso');
  assert.ok(t.classes.has('ativo') && !t.classes.has('hidden'));
  t.ctx.toast('Outro enquanto sai');
  t.ctx.esconderToast();
  t.ctx.toast('Último');
  t.relogio.avancar(400);
  assert.ok(t.classes.has('ativo') && !t.classes.has('hidden'), 'o "esconder" pendente não derruba o aviso novo');
});

test('toast sem os elementos na página não quebra', () => {
  const t = montar({ semElementos: true });
  assert.doesNotThrow(() => { t.ctx.toast('x', 'sucesso'); t.ctx.esconderToast(); });
});

test('as três telas usam o mesmo aviso; o visual novo está no CSS; o módulo é carregado antecipadamente', () => {
  for (const f of ['js/admin.js', 'js/app.js', 'js/painel77.js']) {
    const s = ler(f);
    assert.match(s, /import \{ toast \} from '\.\/toast\.js';/, f);
    assert.doesNotMatch(s, /function toast\(/, f + ' não pode ter cópia própria');
  }
  const css = ler('css/style.css');
  assert.match(css, /\.toast::before/); assert.match(css, /\.toast::after/); assert.match(css, /@keyframes toast-barra/);
  assert.match(css, /\.toast\.sucesso::before/); assert.match(css, /\.toast\.erro::before/);
  assert.match(css, /@media \(max-width: 600px\)\s*\{\s*\n\s*\.toast \{/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /z-index: 1100/, 'continua acima das janelas');
  assert.doesNotMatch(css, /\.toast\.sucesso \{\s*\n\s*border-color: var\(--success\)/, 'o bloco verde chapado antigo saiu');
  for (const f of ['admin.html', 'index.html']) assert.match(ler(f), /rel="modulepreload" href="js\/toast\.js"/, f);
});

test('Configurações: o botão mostra "Salvando..." e volta ao normal, dê certo ou errado', () => {
  const admin = ler('js/admin.js');
  assert.match(admin, /botao\.disabled = true; botao\.textContent = 'Salvando\.\.\.'/);
  assert.match(admin, /\} finally \{\s*\n\s*if \(botao\) \{ botao\.disabled = false; botao\.textContent = rotuloBotao; \}/);
});

// ---- botão "Sair"
test('"Sair": o vermelho só vale com mouse (no celular o :hover grudava) e a confirmação é a janela do painel', () => {
  const css = ler('css/admin.css');
  assert.match(css, /@media \(hover: hover\) \{\s*\n\s*\.btn-logout:hover \{/);
  assert.doesNotMatch(css, /^\.btn-logout:hover \{/m, 'hover fora do @media voltaria a grudar');
  assert.doesNotMatch(ler('js/admin.js'), /confirm\('Deseja realmente sair/);
  assert.doesNotMatch(ler('js/painel77.js'), /confirm\('Sair\?'\)/);
});

test('"Sair": cancelar não sai da conta; confirmar sai; o botão perde o foco', async () => {
  const admin = ler('js/admin.js');
  const m = /function handleLogout\(\) \{/.exec(admin);
  assert.ok(m);
  let i = admin.indexOf('{', m.index), n = 0;
  for (; i < admin.length; i++) { if (admin[i] === '{') n++; else if (admin[i] === '}' && --n === 0) break; }
  const fonte = admin.slice(m.index, i + 1);
  const eventos = {}; const log = [];
  const botao = { blur: () => log.push('blur') };
  const ctx = vm.createContext({
    $: (s) => (s === '#btn-logout' ? botao : { addEventListener: (t, f) => { eventos[s] = f; } }),
    abrirModal: (titulo, corpo, rodape) => log.push('modal:' + titulo + '|' + /Cancelar/.test(rodape) + '|' + /Sair/.test(rodape)),
    fecharModal: () => log.push('fechou'), signOut: async () => { log.push('signOut'); }, auth: {}
  });
  vm.runInContext(fonte, ctx);
  vm.runInContext('handleLogout()', ctx);
  assert.deepEqual(log, ['blur', 'modal:Sair do painel|true|true']);
  eventos['#modal-cancel']();
  assert.ok(!log.includes('signOut'), 'cancelar não sai da conta');
  assert.equal(log[log.length - 1], 'fechou');
  await eventos['#modal-confirmar-sair']();
  assert.ok(log.includes('signOut'));
  assert.ok(log.indexOf('signOut') > log.lastIndexOf('fechou') - 1);
});
