// Convite para instalar o app no link do cliente (js/instalar.js): regra de quando mostrar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'instalar.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /export function decidirConvite[\s\S]*?\n}\n/.exec(src);
assert.ok(m, 'decidirConvite não encontrada');
const ctx = vm.createContext({ DIAS_DISPENSA: 7, DIAS_DISPENSA_SUCESSO: 3 });
vm.runInContext(m[0].replace('export ', '') + '\nthis.decidir = decidirConvite;', ctx);
const decidir = (o) => ctx.decidir({ standalone: false, apple: false, android: false, instalado: false, dispensadoEm: null, agora: 1e12, contexto: 'topo', ...o });
const DIA = 86400000;

test('iPhone no Safari: mostra o cartão com instruções; Android só quando o navegador oferece instalar', () => {
  assert.equal(decidir({ apple: true }), 'ios');
  assert.equal(decidir({ android: true }), 'android');
  assert.equal(decidir({}), null);                       // computador: nada
});

test('quem já abriu pelo ícone (standalone) ou já instalou não vê nada', () => {
  assert.equal(decidir({ apple: true, standalone: true }), null);
  assert.equal(decidir({ android: true, instalado: true }), null);
});

test('fechar no X esconde por 7 dias; na tela de sucesso o convite volta depois de 3 dias', () => {
  const agora = 1e12;
  assert.equal(decidir({ apple: true, dispensadoEm: agora - 2 * DIA }), null);
  assert.equal(decidir({ apple: true, dispensadoEm: agora - 8 * DIA }), 'ios');
  assert.equal(decidir({ apple: true, dispensadoEm: agora - 2 * DIA, contexto: 'sucesso' }), null);
  assert.equal(decidir({ apple: true, dispensadoEm: agora - 4 * DIA, contexto: 'sucesso' }), 'ios');
});

test('index.html tem o gancho do cartão e o manifesto do negócio (não o do painel)', () => {
  assert.ok(html.includes('id="banner-instalar"'));
  assert.ok(html.includes('id="manifest-link"'));
  assert.equal(/rel="manifest"[^>]*href="\/manifest\.json"/.test(html), false);
});

test('nome no ícone: automático tira o prefixo genérico e corta em palavra inteira; o do dono vale', () => {
  const { nomeIconeDe, infoPublica } = require('../api/_lib/negocio');
  assert.equal(nomeIconeDe('Barbearia do Lipão'), 'Lipão');
  assert.equal(nomeIconeDe('Salão da Maria Souza'), 'Maria Souza');
  assert.equal(nomeIconeDe('Studio Beleza Pura'), 'Beleza Pura');
  assert.equal(nomeIconeDe('Barbearia 77'), 'Barbearia 77');             // cabe: fica como está
  assert.equal(nomeIconeDe('Espaço Corte e Estilo Premium'), 'Corte');
  assert.equal(nomeIconeDe('Supercalifragilístico Barber'), 'Supercalifra');
  assert.equal(nomeIconeDe('', ''), 'Agendamento');
  assert.equal(nomeIconeDe('Barbearia do Lipão', '  Lipão   Cuts  '), 'Lipão Cuts');
  assert.equal(nomeIconeDe('Barbearia do Lipão', 'Nome bem maior que doze'), 'Nome bem mai');
  for (const n of ['Barbearia do Lipão', 'Clínica Odontológica Sorriso Feliz', 'X']) assert.ok(nomeIconeDe(n).length <= 12);
  assert.equal(infoPublica({ nome: 'Barbearia do Lipão' }).nomeIcone, 'Lipão');
  assert.equal(infoPublica({ nome: 'Barbearia do Lipão', nomeIcone: 'Lipão BB' }).nomeIcone, 'Lipão BB');
});
