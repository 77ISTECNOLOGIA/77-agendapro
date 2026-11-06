// Foto do serviço: o validador do navegador (js/utils.js) e o do servidor (api/_lib/negocio.js)
// precisam aceitar/recusar EXATAMENTE as mesmas coisas — o valor vira um <img src> na tela do cliente.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { fotoServicoValida: validaServidor, servicoPublico } = require('../api/_lib/negocio');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
const ini = fonte.indexOf('function fotoServicoValida(');
assert.ok(ini >= 0, 'fotoServicoValida não encontrada em utils.js');
let i = fonte.indexOf('{', fonte.indexOf(')', ini)), n = 0;
for (; i < fonte.length; i++) { if (fonte[i] === '{') n++; else if (fonte[i] === '}' && --n === 0) break; }
const ctx = vm.createContext({});
vm.runInContext(fonte.slice(ini, i + 1), ctx);
const validaNavegador = vm.runInContext('fotoServicoValida', ctx);

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof';
const casos = [
  [JPEG, true, 'JPEG válido'],
  ['data:image/jpeg;base64,' + 'A'.repeat(100000), true, 'JPEG grande mas dentro do limite'],
  ['data:image/jpeg;base64,' + 'A'.repeat(150000), false, 'acima do limite'],
  ['data:image/png;base64,iVBORw0KGgo=', false, 'PNG (não é o que o painel gera)'],
  ['data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==', false, 'SVG pode carregar script'],
  ['data:text/html;base64,PHNjcmlwdD4=', false, 'HTML'],
  ['javascript:alert(1)', false, 'javascript:'],
  ['https://site-de-fora.com/foto.jpg', false, 'link externo'],
  ['data:image/jpeg;base64,AAAA" onerror="alert(1)', false, 'tentativa de sair do atributo src'],
  ['data:image/jpeg;base64,', false, 'sem conteúdo'],
  ['', false, 'vazio'], [null, false, 'null'], [undefined, false, 'undefined'], [123, false, 'número'], [{}, false, 'objeto']
];

test('navegador e servidor aceitam/recusam exatamente os mesmos valores', () => {
  for (const [valor, esperado, nome] of casos) {
    assert.equal(validaNavegador(valor), esperado, `navegador: ${nome}`);
    assert.equal(validaServidor(valor), esperado, `servidor: ${nome}`);
  }
});

test('servicoPublico entrega a foto válida e descarta qualquer valor suspeito', () => {
  assert.equal(servicoPublico('s1', { nome: 'Barba', foto: JPEG }).foto, JPEG);
  for (const ruim of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://x.com/a.jpg', 'data:image/jpeg;base64,AAAA" onerror="x']) {
    assert.equal(servicoPublico('s1', { nome: 'Barba', foto: ruim }).foto, '', ruim);
  }
  assert.equal(servicoPublico('s1', { nome: 'Barba' }).foto, '', 'sem foto = vazio');
});

test('ícone do serviço: ausente = ✂️ (serviço antigo), vazio = "sem ícone" chega até a tela', () => {
  assert.equal(servicoPublico('s', { nome: 'X' }).emoji, '✂️');            // serviço antigo, sem o campo
  assert.equal(servicoPublico('s', { nome: 'X', emoji: '' }).emoji, '');   // dono escolheu "Sem ícone"
  assert.equal(servicoPublico('s', { nome: 'X', emoji: '🪒' }).emoji, '🪒');
});

test('painel e link do cliente: foto > ícone > nada, e há o botão "Sem ícone"', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(admin, /data-emoji=""[^>]*aria-label="Sem ícone">Sem ícone</);          // opção "Sem ícone" na grade
  assert.match(admin, /emoji: \$\('#serv-emoji'\)\.value\.trim\(\),/);                 // não força mais ✂️ ao salvar
  assert.doesNotMatch(admin, /serv-emoji'\)\.value\.trim\(\) \|\| '✂️'/);
  assert.match(app, /s\.emoji \? `<div class="servico-foto">/);                        // sem emoji: nenhum bloco de ícone
});
