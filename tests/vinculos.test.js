// Regra de vínculo serviço↔profissional no cadastro do profissional.
// A função mora em js/utils.js (módulo ES, usado no navegador); aqui o texto
// dela é extraído e executado direto, sem precisar de bundler nem de "type: module".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
function extrair(nome) {
  const ini = fonte.indexOf(`function ${nome}(`);
  assert.ok(ini >= 0, `função ${nome} não encontrada em utils.js`);
  let i = fonte.indexOf('{', fonte.indexOf(')', ini)), nivel = 0;
  for (; i < fonte.length; i++) { if (fonte[i] === '{') nivel++; else if (fonte[i] === '}' && --nivel === 0) break; }
  return fonte.slice(ini, i + 1);
}
const ctx = vm.createContext({});
vm.runInContext(extrair('calcularVinculosProfissional'), ctx);
const calcular = (args) => JSON.parse(JSON.stringify(vm.runInContext('calcularVinculosProfissional', ctx)(args)));

const servicos = () => ({
  livre:   { nome: 'Sobrancelha' },                              // qualquer um faz
  soJoao:  { nome: 'Pigmentação', profissionaisIds: ['joao'] },
  dupla:   { nome: 'Barba', profissionaisIds: ['joao', 'carlos'] }
});

test('sem mudar nada no formulário, nada é alterado', () => {
  const r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['joao', 'carlos'], profissionalId: 'joao', marcadosIds: ['livre', 'soJoao', 'dupla'] });
  assert.deepEqual(r, { alteracoes: [], erro: null });
});

test('profissional NOVO marcado só no que é livre: nenhum serviço é alterado', () => {
  const r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['joao', 'ana'], profissionalId: 'ana', marcadosIds: ['livre'] });
  // "livre" já valia pra todos; ana desmarcou soJoao/dupla que nunca foram dela
  assert.deepEqual(r, { alteracoes: [], erro: null });
});

test('profissional novo marcado num serviço restrito a outros: entra na lista do serviço', () => {
  const r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['joao', 'ana'], profissionalId: 'ana', marcadosIds: ['livre', 'soJoao'] });
  assert.deepEqual(r.alteracoes, [{ servicoId: 'soJoao', profissionaisIds: [] }]);   // joao + ana = todos os ativos → volta a ser livre
  assert.equal(r.erro, null);
});

test('adicionar quando ainda sobram ativos de fora mantém a restrição (sem normalizar)', () => {
  const r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['joao', 'carlos', 'ana'], profissionalId: 'ana', marcadosIds: ['livre', 'soJoao'] });
  assert.deepEqual(r.alteracoes, [{ servicoId: 'soJoao', profissionaisIds: ['joao', 'ana'] }]);
});

test('desmarcar um serviço livre o restringe aos OUTROS profissionais ativos', () => {
  const r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['joao', 'carlos', 'ana'], profissionalId: 'ana', marcadosIds: [] });
  assert.deepEqual(r.alteracoes, [{ servicoId: 'livre', profissionaisIds: ['joao', 'carlos'] }]);
});

test('desmarcar de um serviço restrito remove só ele da lista', () => {
  const r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['joao', 'carlos'], profissionalId: 'joao', marcadosIds: ['livre', 'soJoao'] });
  assert.deepEqual(r.alteracoes, [{ servicoId: 'dupla', profissionaisIds: ['carlos'] }]);
  assert.equal(r.erro, null);
});

test('recusa deixar um serviço sem NINGUÉM que o realize', () => {
  // soJoao só o João faz: desmarcar dele sem outro marcado = ninguém
  let r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['joao', 'carlos'], profissionalId: 'joao', marcadosIds: ['livre', 'dupla'] });
  assert.match(r.erro, /Nenhum outro profissional realiza "Pigmentação"/);
  assert.deepEqual(r.alteracoes, []);

  // único profissional ativo desmarcando um serviço livre
  r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['joao'], profissionalId: 'joao', marcadosIds: ['soJoao', 'dupla'] });
  assert.match(r.erro, /Sobrancelha/);
});

test('lista que só sobra com profissional inativo também conta como "ninguém"', () => {
  const s = { x: { nome: 'Corte', profissionaisIds: ['joao', 'inativo'] } };
  const r = calcular({ servicos: s, profissionaisAtivosIds: ['joao'], profissionalId: 'joao', marcadosIds: [] });
  assert.match(r.erro, /Corte/);
});

test('profissional que fica INATIVO não conta como ativo ao desmarcar', () => {
  const r = calcular({ servicos: servicos(), profissionaisAtivosIds: ['carlos'], profissionalId: 'ana', marcadosIds: ['soJoao'] });
  // ana (inativa) desmarcou "livre" → vira restrito a quem está ativo (carlos)
  assert.ok(r.alteracoes.some((a) => a.servicoId === 'livre' && a.profissionaisIds.join() === 'carlos'));
});
