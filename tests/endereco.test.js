// Endereço do estabelecimento: busca pelo CEP (js/cep.js), validação no servidor e edição pelo painel.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { montarAmbiente, req, res, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const configurar = require('../api/configurar-negocio');
const { limparLimites } = require('../api/_lib/http');
const E = require('../api/_lib/endereco');

const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SLUG = 'barbearia-teste';

// ---------------------------------------------------------------- js/cep.js (módulo do navegador, executado de verdade)
function carregarCep(fetchFn) {
  const fonte = ler('js/cep.js').split('export ').join('');
  const ctx = vm.createContext({ fetch: fetchFn, AbortController, setTimeout, clearTimeout, Promise, String });
  vm.runInContext(fonte, ctx);
  return ctx;
}
const ok = (corpo) => ({ ok: true, status: 200, json: async () => corpo });
const falha = (status = 404) => ({ ok: false, status, json: async () => ({}) });
const VIACEP = { cep: '24230-005', logradouro: 'Rua Miguel de Frias', bairro: 'Icaraí', localidade: 'Niterói', uf: 'RJ' };

test('CEP: máscara 00000-000 e validação de 8 números', () => {
  const c = carregarCep(async () => ok({}));
  const f = (v) => vm.runInContext(`formatarCep(${JSON.stringify(v)})`, c);
  assert.equal(f('24230005'), '24230-005');
  assert.equal(f('24230-0059999'), '24230-005');
  assert.equal(f('242'), '242');
  assert.equal(f('24230'), '24230');
  assert.equal(f('abc 24.230-005'), '24230-005');
  assert.equal(vm.runInContext("cepValido('24230-005')", c), true);
  assert.equal(vm.runInContext("cepValido('24230-00')", c), false);
});

test('CEP: busca no ViaCEP e devolve rua, bairro, cidade e UF', async () => {
  const chamadas = [];
  const c = carregarCep(async (url) => { chamadas.push(url); return ok(VIACEP); });
  const r = await vm.runInContext("buscarCep('24230-005')", c);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { logradouro: 'Rua Miguel de Frias', bairro: 'Icaraí', cidade: 'Niterói', uf: 'RJ' });
  assert.deepEqual(chamadas, ['https://viacep.com.br/ws/24230005/json/'], 'só o CEP (público) sai do navegador');
});

test('CEP: ViaCEP fora do ar ou sem o CEP → tenta a BrasilAPI; nada achado → null (preenche à mão)', async () => {
  const BRASIL = { cep: '24230005', state: 'RJ', city: 'Niterói', neighborhood: 'Icaraí', street: 'Rua Miguel de Frias' };
  let c = carregarCep(async (url) => (url.includes('viacep') ? falha(500) : ok(BRASIL)));
  assert.equal((await vm.runInContext("buscarCep('24230005')", c)).cidade, 'Niterói');

  c = carregarCep(async (url) => { if (url.includes('viacep')) throw new Error('sem internet'); return ok(BRASIL); });
  assert.equal((await vm.runInContext("buscarCep('24230005')", c)).uf, 'RJ');

  c = carregarCep(async (url) => (url.includes('viacep') ? ok({ erro: true }) : ok(BRASIL)));
  assert.equal((await vm.runInContext("buscarCep('24230005')", c)).bairro, 'Icaraí', 'ViaCEP respondeu "erro": a reserva ainda pode ter o CEP');

  c = carregarCep(async (url) => (url.includes('viacep') ? ok({ erro: true }) : falha(404)));
  assert.equal(await vm.runInContext("buscarCep('00000000')", c), null);
  c = carregarCep(async () => { throw new Error('sem internet'); });
  assert.equal(await vm.runInContext("buscarCep('24230005')", c), null);
  assert.equal(await vm.runInContext("buscarCep('123')", c), null, 'CEP incompleto nem chama a rede');
});

function formularioFalso() {
  const campos = {};
  const el = (id) => (campos[id] = campos[id] || { id, value: '', dataset: {}, textContent: '', foco: 0, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; }, focus() { this.foco++; } });
  const documento = { getElementById: (id) => el(id) };
  ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'aviso'].forEach((k) => el(k));
  return { campos, documento, digitar: async (valor) => { campos.cep.value = valor; await campos.cep.handlers.input(); } };
}
const IDS = { cep: 'cep', logradouro: 'logradouro', numero: 'numero', bairro: 'bairro', cidade: 'cidade', uf: 'uf', aviso: 'aviso' };

test('formulário: ao completar o CEP preenche o endereço e leva o cursor ao número; tudo continua editável', async () => {
  const c = carregarCep(async () => ok(VIACEP));
  const f = formularioFalso();
  c.ligarBuscaCep(IDS, { documento: f.documento, fetchFn: async () => ok(VIACEP) });
  await f.digitar('24230');
  assert.equal(f.campos.aviso.textContent, 'Digite o CEP e preenchemos o endereço para você.');
  assert.equal(f.campos.logradouro.value, '');
  await f.digitar('24230005');
  assert.equal(f.campos.cep.value, '24230-005');
  assert.equal(f.campos.logradouro.value, 'Rua Miguel de Frias');
  assert.equal(f.campos.bairro.value, 'Icaraí');
  assert.equal(f.campos.cidade.value, 'Niterói');
  assert.equal(f.campos.uf.value, 'RJ');
  assert.equal(f.campos.numero.foco, 1);
  assert.match(f.campos.aviso.textContent, /Endereço encontrado/);
  assert.equal(f.campos.aviso.dataset.tipo, 'ok');
});

test('formulário: CEP não encontrado avisa e NÃO apaga o que a pessoa já tinha digitado', async () => {
  const c = carregarCep(async () => falha(404));
  const f = formularioFalso();
  c.ligarBuscaCep(IDS, { documento: f.documento, fetchFn: async () => falha(404) });
  f.campos.logradouro.value = 'Rua que eu digitei';
  await f.digitar('99999999');
  assert.match(f.campos.aviso.textContent, /Não encontramos esse CEP/);
  assert.equal(f.campos.aviso.dataset.tipo, 'erro');
  assert.equal(f.campos.logradouro.value, 'Rua que eu digitei');
});

test('formulário: resposta atrasada de um CEP antigo é ignorada (a pessoa já digitou outro)', async () => {
  const c = carregarCep(async () => ok({}));
  const f = formularioFalso();
  let liberarLento;
  const lento = new Promise((r) => { liberarLento = r; });
  const fetchFn = async (url) => (url.includes('11111111')
    ? (await lento, ok({ logradouro: 'Rua Velha', bairro: 'Bairro Velho', localidade: 'Cidade Velha', uf: 'SP' }))
    : ok(VIACEP));
  c.ligarBuscaCep(IDS, { documento: f.documento, fetchFn });
  const primeira = f.digitar('11111111');
  await new Promise((r) => setImmediate(r));
  await f.digitar('24230005');                     // CEP novo, resposta rápida
  liberarLento();
  await primeira;
  assert.equal(f.campos.logradouro.value, 'Rua Miguel de Frias', 'não foi sobrescrito pela resposta atrasada');
  assert.equal(f.campos.cidade.value, 'Niterói');
});

// ---------------------------------------------------------------- servidor
test('servidor: valida e normaliza o endereço', () => {
  const base = { cep: '24230005', logradouro: ' Rua   A ', numero: ' S/N ', bairro: 'Centro', cidade: 'Niterói', uf: 'rj', complemento: '' };
  const e = E.normalizarEndereco(base);
  assert.deepEqual(e, { cep: '24230-005', logradouro: 'Rua A', numero: 'S/N', complemento: '', bairro: 'Centro', cidade: 'Niterói', uf: 'RJ' });
  assert.equal(E.enderecoTexto(e), 'Rua A, S/N - Centro, Niterói - RJ, CEP 24230-005');
  assert.equal(E.enderecoTexto({ ...e, complemento: 'Loja 1' }), 'Rua A, S/N - Loja 1 - Centro, Niterói - RJ, CEP 24230-005');
  assert.equal(E.enderecoCurto(e), 'Centro, Niterói');
  for (const ruim of [{ cep: '1' }, { logradouro: 'A' }, { numero: '' }, { bairro: '' }, { cidade: 'N' }, { uf: 'ZZ' }]) {
    assert.throws(() => E.normalizarEndereco({ ...base, ...ruim }), (err) => err.status === 400, JSON.stringify(ruim));
  }
  assert.throws(() => E.normalizarEndereco(null), (err) => err.status === 400);
  assert.equal(E.UFS.length, 27);
});

// ---------------------------------------------------------------- painel do dono (API)
async function chamar(corpo) { const r = res(); await configurar(req('POST', { body: corpo }), r); limparLimites(); return r; }
const ENDERECO = { cep: '20550-013', logradouro: 'Rua São Francisco Xavier', numero: '524', complemento: '', bairro: 'Maracanã', cidade: 'Rio de Janeiro', uf: 'RJ' };

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, SLUG, { endereco: 'Mangueira, Rio de Janeiro', sinal: { ativo: false, percentual: 50, prazoHoras: 24, tipoChave: '', chavePix: '', nomeRecebedor: '', cidadeRecebedor: '', banco: '' }, limiteAgendamentosSemana: 2 });
  amb.fake.seed('usuarios/dono1', { barbeariaId: SLUG, role: 'owner' });
});

test('configurar: o dono completa o endereço; mexer só no endereço NÃO zera o sinal nem o limite semanal', async () => {
  const r = await chamar({ idToken: 'tok-dono1', endereco: ENDERECO });
  assert.equal(r.statusCode, 200);
  const n = amb.fake.get(`barbearias/${SLUG}`);
  assert.equal(n.endereco, 'Rua São Francisco Xavier, 524 - Maracanã, Rio de Janeiro - RJ, CEP 20550-013');
  assert.deepEqual(n.enderecoDetalhe, ENDERECO);
  assert.equal(n.cidade, 'Rio de Janeiro'); assert.equal(n.bairro, 'Maracanã');
  assert.equal(n.limiteAgendamentosSemana, 2, 'limite preservado');
  assert.equal(n.sinal.percentual, 50, 'sinal preservado');
});

test('configurar: endereço inválido é recusado e nada é gravado; sem login, 401; pedido vazio, 400', async () => {
  assert.equal((await chamar({ endereco: ENDERECO })).statusCode, 401);
  const ruim = await chamar({ idToken: 'tok-dono1', endereco: { ...ENDERECO, uf: 'ZZ' } });
  assert.equal(ruim.statusCode, 400);
  assert.match(ruim.body.erro, /estado/i);
  assert.equal(amb.fake.get(`barbearias/${SLUG}`).endereco, 'Mangueira, Rio de Janeiro');
  assert.equal(amb.fake.get(`barbearias/${SLUG}`).enderecoDetalhe, undefined);
  const vazio = await chamar({ idToken: 'tok-dono1' });
  assert.equal(vazio.statusCode, 400);
  assert.match(vazio.body.erro, /Nada para salvar/);
});

test('configurar: o dono só altera o PRÓPRIO negócio (o vínculo vem do login, não do pedido)', async () => {
  semearNegocio(amb.fake, 'outro-negocio', { endereco: 'Outro lugar' });
  const r = await chamar({ idToken: 'tok-dono1', barbeariaId: 'outro-negocio', slug: 'outro-negocio', endereco: ENDERECO });
  assert.equal(r.statusCode, 200);
  assert.equal(amb.fake.get('barbearias/outro-negocio').endereco, 'Outro lugar');
  assert.ok(amb.fake.get(`barbearias/${SLUG}`).enderecoDetalhe);
});

// ---------------------------------------------------------------- telas (arquivos)
test('telas: cadastro e Configurações têm o bloco de endereço ligado à busca pelo CEP', () => {
  const cad = ler('cadastro.html'), cadJs = ler('js/cadastro.js');
  const adm = ler('admin.html'), admJs = ler('js/admin.js');
  for (const id of ['cep', 'cep-aviso', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf']) assert.match(cad, new RegExp('id="' + id + '"'), 'cadastro ' + id);
  for (const id of ['conf-cep', 'conf-cep-aviso', 'conf-logradouro', 'conf-numero', 'conf-complemento', 'conf-bairro', 'conf-cidade', 'conf-uf']) assert.match(adm, new RegExp('id="' + id + '"'), 'admin ' + id);
  assert.doesNotMatch(adm, /id="conf-endereco"/, 'o campo único de endereço saiu');
  assert.match(cadJs, /ligarBuscaCep\(\{ cep: 'cep'/);
  assert.match(admJs, /ligarBuscaCep\(\{ cep: 'conf-cep'/);
  assert.match(cadJs, /Escolha o estado \(UF\)/);
  // o cadastro manda todos os campos do endereço
  for (const k of ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf']) assert.match(cadJs, new RegExp(k + ': dados\\.' + k), 'payload ' + k);
  // o endereço das Configurações passa pelo servidor (as regras do Firestore não mudaram)
  assert.match(admJs, /async function salvarEnderecoApi/);
  assert.doesNotMatch(admJs, /endereco: \$\('#conf-endereco'\)/);
  assert.match(admJs, /if \(enderecoMudou\(end\)\) \{\s*\n\s*await salvarEnderecoApi\(end\);/);
  // link do cliente: cabeçalho curto
  assert.match(ler('js/app.js'), /enderecoCurto \|\| state\.barbearia\.endereco/);
});

// ---------------------------------------------------------------- botão "Ver no mapa" (link do cliente)
function extrairFuncao(src, nome) {
  const m = new RegExp('function ' + nome + '\\(').exec(src);
  assert.ok(m, nome + ' não encontrada');
  let i = src.indexOf('{', src.indexOf(')', m.index)), n = 0;
  for (; i < src.length; i++) { if (src[i] === '{') n++; else if (src[i] === '}' && --n === 0) break; }
  return src.slice(m.index, i + 1);
}

test('mapa: link do Google Maps com o endereço codificado (nada de escapar da URL); sem endereço, sem link', () => {
  const app = ler('js/app.js');
  const ctx = vm.createContext({ String, encodeURIComponent });
  vm.runInContext(extrairFuncao(app, 'urlMapa'), ctx);
  const u = (e) => vm.runInContext('urlMapa(' + JSON.stringify(e) + ')', ctx);
  assert.equal(u('Rua A, 123 - Sé, São Paulo - SP, CEP 01001-000'), 'https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%20123%20-%20S%C3%A9%2C%20S%C3%A3o%20Paulo%20-%20SP%2C%20CEP%2001001-000');
  assert.equal(u(''), ''); assert.equal(u(null), ''); assert.equal(u('   '), '');
  const malicioso = u('x&query=evil"><script>alert(1)</script>#');
  assert.ok(malicioso.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.doesNotMatch(malicioso.slice('https://www.google.com/maps/search/?api=1&query='.length), /[<>"&#]/, 'tudo codificado');
});

test('mapa: o cabeçalho mostra o botão quando há endereço e esconde quando não há', () => {
  const app = ler('js/app.js');
  const els = { '#header-nome': { textContent: '' }, '#header-passo': { textContent: '' }, '#btn-mapa': { href: '', escondido: true, classList: { remove() { els['#btn-mapa'].escondido = false; }, add() { els['#btn-mapa'].escondido = true; } } } };
  const state = { barbearia: { nome: 'Lipão', enderecoCurto: 'Icaraí, Niterói', endereco: 'Rua A, 1 - Icaraí, Niterói - RJ, CEP 24230-005' } };
  const ctx = vm.createContext({ state, $: (s) => els[s], String, encodeURIComponent });
  vm.runInContext(extrairFuncao(app, 'urlMapa') + extrairFuncao(app, 'renderizarHeader'), ctx);
  vm.runInContext('renderizarHeader()', ctx);
  assert.equal(els['#btn-mapa'].escondido, false);
  assert.match(els['#btn-mapa'].href, /^https:\/\/www\.google\.com\/maps\/search\//);
  assert.equal(els['#header-passo'].textContent, 'Icaraí, Niterói', 'cabeçalho continua curto');
  state.barbearia = { nome: 'Sem endereço', endereco: '' };
  vm.runInContext('renderizarHeader()', ctx);
  assert.equal(els['#btn-mapa'].escondido, true);
  const html = ler('index.html');
  assert.match(html, /<a id="btn-mapa" class="btn-mapa hidden"[^>]*target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html.slice(html.indexOf('id="btn-mapa"'), html.indexOf('Ver no mapa')), /emoji|📍/, 'sem emoji: ícone de traço');
});
