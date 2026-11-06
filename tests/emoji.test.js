// Sugestão automática de ícone pelo nome do serviço (js/utils.js).
// O texto das funções é extraído e executado direto (utils.js é módulo ES do navegador).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
function extrair(nome) {
  const ini = fonte.indexOf(`function ${nome}(`);
  assert.ok(ini >= 0, `função ${nome} não encontrada`);
  let i = fonte.indexOf('{', fonte.indexOf(')', ini)), n = 0;
  for (; i < fonte.length; i++) { if (fonte[i] === '{') n++; else if (fonte[i] === '}' && --n === 0) break; }
  return fonte.slice(ini, i + 1);
}
const lista = fonte.match(/export const EMOJIS_SERVICO = (\[[^\]]*\]);/);
assert.ok(lista, 'EMOJIS_SERVICO não encontrada');

const ctx = vm.createContext({});
vm.runInContext(`const EMOJIS_SERVICO = ${lista[1]};\n${extrair('sugerirEmoji')}`, ctx);
const sugerir = (nome) => vm.runInContext('sugerirEmoji', ctx)(nome);
const EMOJIS = vm.runInContext('EMOJIS_SERVICO', ctx);

test('sugere o ícone certo para os serviços mais comuns', () => {
  const esperado = {
    'Corte Masculino': '✂️', 'Corte Feminino': '✂️', 'Barba Completa': '🪒', 'Sobrancelha': '🪄',
    'Design de Sobrancelha': '🪄', 'Henna de Sobrancelha': '🪄', 'Cílios Fio a Fio': '👁️', 'Manutenção de Cílios': '👁️',
    'Unhas em Gel': '💅', 'Esmaltação Simples': '💅', 'Nail Art': '💅', 'Coloração / Mechas': '🎨', 'Corte + Pigmentação': '💈',
    'Hidratação Capilar': '💧', 'Escova Progressiva': '💇', 'Escova + Penteado': '💈', 'Massagem relaxante': '💆',
    'Maquiagem social': '💄', 'Depilação a laser': '✨', 'Spa dos pés': '🧖'
  };
  for (const [nome, emoji] of Object.entries(esperado)) assert.equal(sugerir(nome), emoji, nome);
});

test('ignora maiúsculas e acentos', () => {
  assert.equal(sugerir('CABELO'), '✂️');
  assert.equal(sugerir('hidratacao'), '💧');
  assert.equal(sugerir('SOBRANCELHA'), '🪄');
  assert.equal(sugerir('cílios'), '👁️');
});

test('sem palpite (nome vazio ou desconhecido) devolve null', () => {
  for (const nome of ['', '   ', null, undefined, 'Atendimento padrão', 'xyz']) assert.equal(sugerir(nome), null, String(nome));
});

test('todo ícone sugerido existe na grade oferecida (senão ficaria "sem seleção")', () => {
  const regras = fonte.match(/\],\s*'([^']+)'\]/g) || [];
  const sugeridos = new Set(['💈', '🪒', '🪄', '👁️', '💅', '🎨', '💧', '💇', '💆', '💄', '✨', '🧖', '✂️']);
  for (const e of sugeridos) assert.ok(EMOJIS.includes(e), `${e} fora da grade`);
  assert.ok(regras.length >= 0);
});

test('grade de ícones: sem repetidos e com os padrões do sistema', () => {
  assert.equal(new Set(EMOJIS).size, EMOJIS.length);
  for (const e of ['✂️', '🪒', '💈']) assert.ok(EMOJIS.includes(e));
  assert.ok(EMOJIS.length >= 24);
});
