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

test('painel do dono mantém as fontes originais por padrão; Orbitron/Raleway só com a classe fonte-77', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const css = fs2.readFileSync(path2.join(__dirname, '..', 'css', 'marca77.css'), 'utf8');
  const painel = css.slice(css.indexOf('PAINEL DO DONO'));
  const semComentarios = painel.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(semComentarios.replace(/body\.tema-77\.fonte-77[^{]*\{[^}]*\}/g, ''), /Orbitron|Raleway/, 'fonte da marca vazou para o padrão');
  assert.doesNotMatch(fs2.readFileSync(path2.join(__dirname, '..', 'admin.html'), 'utf8'), /<body class="[^"]*fonte-77/);
});

test('tela do cliente: tema 77, inicial do negócio no cabeçalho, crédito da 77 e destaque azul na barbearia', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const ler = (f) => fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8');
  assert.match(ler('index.html'), /<body class="cliente-77">/);
  assert.match(ler('index.html'), /class="header-logo" src="\/img\/logo-77is\.png"/);
  assert.match(ler('index.html'), /<p class="credito-77">Sistema de agendamento criado por <strong>77 IS Tecnologia &amp; Inteligência<\/strong><\/p>\s*<button id="btn-continuar-1"/);
  assert.match(ler('css/marca77.css'), /body\.cliente-77 \.barbearia-end \{[^}]*font-weight: 700/);
  assert.doesNotMatch(ler('js/app.js'), /header-inicial/);
  assert.match(ler('admin.html'), /<div class="credito-77">Sistema de agendamento criado por <strong>77 IS Tecnologia &amp; Inteligência<\/strong><\/div>/);
  assert.doesNotMatch(ler('js/vocabulario.js'), /d4ff3a/, 'sem o verde-limão antigo nos temas');
  assert.match(ler('js/vocabulario.js'), /--on-accent/);
  assert.doesNotMatch(ler('css/style.css'), /color: #0a0a0a;/, 'texto sobre o destaque usa var(--on-accent)');
  assert.match(ler('css/marca77.css'), /body\.tema-77 \.sidebar-barbearia \{[^}]*font-weight: 700/);
});

test('login do super-admin: rodapé no modelo padrão da 77 e textos em destaque', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'painel77.html'), 'utf8');
  const css = fs2.readFileSync(path2.join(__dirname, '..', 'css', 'marca77.css'), 'utf8');
  assert.match(html, /login-container login-super/);
  assert.match(html, /<div class="credito-77">Acesso restrito · <strong>Apenas administradores da 77 IS<\/strong><\/div>/);
  assert.match(css, /\.login-super \.login-sub \{[^}]*font-weight: 700/);
  assert.match(css, /\.login-super \.btn-link \{[^}]*font-weight: 700/);
});

test('"Esqueci minha senha" em negrito nos logins do dono e do super-admin', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const css = fs2.readFileSync(path2.join(__dirname, '..', 'css', 'marca77.css'), 'utf8');
  assert.match(css, /\.login-container \.btn-link \{[^}]*font-weight: 700/);
  for (const f of ['admin.html', 'painel77.html']) {
    const h = fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8');
    assert.match(h, /class="btn-link">Esqueci minha senha/, f);
    assert.match(h, /css\/marca77\.css/, f);
  }
});

test('manifest (instalar o painel no Android/iPhone): ícones existem, 192 e 512, e o "maskable" é um arquivo próprio', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const raiz = path2.join(__dirname, '..');
  const m = JSON.parse(fs2.readFileSync(path2.join(raiz, 'manifest.json'), 'utf8'));
  for (const i of m.icons) assert.ok(fs2.existsSync(path2.join(raiz, i.src)), i.src + ' não existe');
  for (const proposito of ['any', 'maskable']) {
    const tamanhos = m.icons.filter((i) => i.purpose === proposito).map((i) => i.sizes).sort();
    assert.deepEqual(tamanhos, ['192x192', '512x512'], proposito);
  }
  const maskable = m.icons.filter((i) => i.purpose === 'maskable').map((i) => i.src);
  const any = m.icons.filter((i) => i.purpose === 'any').map((i) => i.src);
  assert.ok(maskable.every((s) => !any.includes(s)), 'maskable não pode reaproveitar o ícone "any" (cantos transparentes cortam a logo)');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/admin');
});

test('cadastro de negócio: identidade 77 (logo, paleta azul, rodapé padrão) e sem emojis nos tipos de negócio', () => {
  const fs2 = require('node:fs'), path2 = require('node:path');
  const h = fs2.readFileSync(path2.join(__dirname, '..', 'cadastro.html'), 'utf8');
  assert.match(h, /<body class="cadastro-77">/);
  assert.match(h, /css\/marca77\.css/);
  assert.match(h, /class="cad-logo" src="\/img\/logo-77is\.png"/);
  assert.doesNotMatch(h, /logo-mark/);
  assert.doesNotMatch(h, /tipo-emoji/);
  assert.doesNotMatch(h, /212, 255, 58/);
  assert.match(h, /<div class="credito-77"[^>]*>Sistema de agendamento criado por <strong>77 IS Tecnologia &amp; Inteligência<\/strong><\/div>/);
  assert.equal((h.match(/class="tipo-btn/g) || []).length, 4, 'os 4 tipos de negócio continuam');
  assert.match(fs2.readFileSync(path2.join(__dirname, '..', 'css', 'marca77.css'), 'utf8'), /body\.cadastro-77 \{[\s\S]*--accent: #0077FF/);
});
