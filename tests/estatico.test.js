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
