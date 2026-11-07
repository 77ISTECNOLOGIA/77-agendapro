// Verificações estáticas do código do navegador (js/*.js).
//
// Contexto: o painel usava `const $$ = (sel) => document.querySelectorAll(sel)`, que devolve uma
// NodeList — ela NÃO tem .map/.filter/.reduce. Chamar `$$(...).map(...)` dentro de um clique lançava
// TypeError em silêncio e o botão "Salvar" parecia morto (e o agendamento manual do dono ficou
// quebrado desde a Fase 1 sem ninguém perceber). Estes testes impedem a repetição.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pasta = path.join(__dirname, '..', 'js');
const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.js'));

const METODOS_DE_ARRAY = '(?:map|filter|reduce|some|every|find|findIndex|sort|slice|concat|includes|flatMap)';
const SEM_ARRAY = (src) => !/const \$\$ = .*Array\.from\(/.test(src);   // $$ NÃO devolve array de verdade

// Mesma checagem, reutilizável sobre qualquer texto (os testes abaixo também a aplicam ao código ANTIGO)
function achados(src) {
  const ruins = [];
  // 1) nunca encadear método de array direto em querySelectorAll (é sempre NodeList)
  for (const m of src.matchAll(new RegExp(`querySelectorAll\\([^)]*\\)\\s*\\.${METODOS_DE_ARRAY}\\s*\\(`, 'g'))) ruins.push(m[0]);
  // 2) se $$ devolve NodeList, também não pode encadear
  if (SEM_ARRAY(src) && /const \$\$ = /.test(src)) {
    for (const m of src.matchAll(new RegExp(`\\$\\$\\([^)]*\\)\\s*\\.${METODOS_DE_ARRAY}\\s*\\(`, 'g'))) ruins.push(m[0]);
  }
  return ruins;
}

for (const arq of arquivos) {
  test(`${arq}: não usa métodos de array numa NodeList`, () => {
    const src = fs.readFileSync(path.join(pasta, arq), 'utf8');
    assert.deepEqual(achados(src), [], `trecho(s) que quebram em silêncio no navegador em js/${arq}`);
  });
}

test('$$ de admin, app e painel77 devolve um Array de verdade', () => {
  for (const arq of ['admin.js', 'app.js', 'painel77.js']) {
    const src = fs.readFileSync(path.join(pasta, arq), 'utf8');
    assert.match(src, /const \$\$ = .*Array\.from\(document\.querySelectorAll/, `js/${arq}`);
  }
});

test('a checagem de fato pega o defeito antigo (senão este teste não protegeria nada)', () => {
  const codigoAntigo = `
    const $$ = (sel) => document.querySelectorAll(sel);
    const ids = $$('#modal-body .prof-serv-check:checked').map(c => c.value);
    const outros = $$('.x')
      .filter(a => a);`;
  assert.equal(achados(codigoAntigo).length, 2);
  assert.equal(achados(`const $$ = (s) => Array.from(document.querySelectorAll(s)); $$('.a').map(x => x);`).length, 0);
  assert.equal(achados(`document.querySelectorAll('.a').map(x => x)`).length, 1);
});

test('admin e painel77: a tecla ESC fecha a janela (modal) aberta', () => {
  for (const arq of ['admin.js', 'painel77.js']) {
    const src = fs.readFileSync(path.join(pasta, arq), 'utf8');
    assert.match(src, /addEventListener\('keydown'[\s\S]{0,200}e\.key === 'Escape'[\s\S]{0,200}fecharModal\(\)/, `js/${arq} sem atalho ESC`);
  }
});

test('páginas: ícones oficiais da 77 e nenhum resto de ícone antigo solto no <head>', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  for (const f of ['admin.html', 'painel77.html', 'index.html', 'cadastro.html']) {
    const h = fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8');
    const head = h.slice(0, h.indexOf('</head>'));
    assert.match(head, /rel="icon"[^>]*href="\/img\/favicon-32\.png"/, f);
    assert.match(head, /rel="apple-touch-icon"[^>]*href="\/img\/icon-180\.png"/, f);
    assert.doesNotMatch(head, /<rect|<text|%22100%22/, f + ' tem resto do ícone antigo');
  }
  const m = JSON.parse(fs2.readFileSync(path2.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.ok(m.icons.every((i) => i.src.startsWith('/img/')));
  assert.doesNotMatch(fs2.readFileSync(path2.join(__dirname, '..', 'css', 'marca77.css'), 'utf8') + fs2.readFileSync(path2.join(__dirname, '..', 'admin.html'), 'utf8'), /INTELLIGENT SYSTEMS/);
});

test('tela de carregamento usa a logo nova (nada do "77" antigo em texto nem do fundo azul antigo)', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  for (const f of ['admin.html', 'painel77.html', 'index.html']) {
    const h = fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8');
    assert.match(h, /class="loading-logo-img" src="\/img\/logo-77is\.png"/, f);
    assert.doesNotMatch(h, /logo-mark loading-logo/, f);
    assert.match(h, /css\/marca77\.css/, f);
  }
  assert.match(fs2.readFileSync(path2.join(__dirname, '..', 'css', 'marca77.css'), 'utf8'), /\.admin-body \.loading-overlay/);
});

test('painel do dono usa o tema 77 IS (classe tema-77) e o super-admin/cliente não são afetados', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const ler = (f) => fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8');
  assert.match(ler('admin.html'), /<body class="admin-body tema-77">/);
  assert.doesNotMatch(ler('painel77.html'), /tema-77/);
  assert.doesNotMatch(ler('index.html'), /tema-77/);
  assert.match(ler('css/marca77.css'), /body\.tema-77 \{[\s\S]*--accent: #0077FF/);
  assert.doesNotMatch(ler('js/admin.js'), /#d4ff3a|212, 255, 58/, 'admin.js não pode ter o verde-limão antigo');
});

test('super-admin: conta sem permissão volta ao login com "Email ou senha incorretos" (sem tela de acesso negado)', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const js = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'painel77.js'), 'utf8');
  assert.doesNotMatch(js, /#tela-negado'\)\.classList\.remove/);
  assert.match(js, /await signOut\(auth\);\s*\n\s*mostrarLogin\(veioDoFormulario \? 'Email ou senha incorretos\.' : undefined\)/);
  assert.match(js, /state\.loginManual = true;/);
});
