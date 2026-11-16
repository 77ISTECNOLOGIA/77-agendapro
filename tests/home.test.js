// Tela inicial do AgendaPro: busca de estabelecimentos (só quem escolheu aparecer), logo leve, filtros e "Meus lugares".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { montarAmbiente, req, res, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const negocio = require('../api/negocio');
const configurar = require('../api/configurar-negocio');
const { limparLimites } = require('../api/_lib/http');

const raiz = (...p) => path.join(__dirname, '..', ...p);
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';
async function chamar(query) { const r = res(); await negocio(req('GET', { query }), r); return r; }

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  semearNegocio(amb.fake, 'barbearia-do-lipao', { nome: 'Barbearia do Lipão', diretorio: true, telefone: '5521999990000', logo: JPEG,
    enderecoDetalhe: { cep: '20911-135', logradouro: 'Rua A', numero: '10', bairro: 'Mangueira', cidade: 'Rio de Janeiro', uf: 'RJ' } });
  semearNegocio(amb.fake, 'salao-da-maria', { nome: 'Salão da Maria', tipoNegocio: 'salao', diretorio: true, enderecoDetalhe: { bairro: 'Tijuca', cidade: 'Rio de Janeiro', uf: 'rj' } });
  semearNegocio(amb.fake, 'so-por-link', { nome: 'Só por link' });                                     // não escolheu aparecer
  semearNegocio(amb.fake, 'suspensa', { nome: 'Suspensa', diretorio: true, status: 'suspensa' });
});

test('buscar: só aparece quem escolheu e está aceitando agendamentos; só dados públicos; ordenado; sem pedir slug', async () => {
  const r = await chamar({ buscar: '1' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.lugares.map((l) => l.slug), ['barbearia-do-lipao', 'salao-da-maria']);
  assert.deepEqual(Object.keys(r.body.lugares[0]).sort(), ['bairro', 'cidade', 'nome', 'slug', 'temLogo', 'tipo', 'uf']);
  assert.deepEqual(r.body.lugares[0], { slug: 'barbearia-do-lipao', nome: 'Barbearia do Lipão', tipo: 'barbearia', bairro: 'Mangueira', cidade: 'Rio de Janeiro', uf: 'RJ', temLogo: true });
  assert.equal(r.body.lugares[1].uf, 'RJ');                                                          // normalizado em maiúsculas
  const texto = JSON.stringify(r.body);
  assert.doesNotMatch(texto, /5521999990000|data:image|Rua A|20911/);                               // nada de telefone, logo ou endereço completo
  assert.match(r.headers['Cache-Control'], /public/);
});

test('logo leve: devolve só a logo (ou null) e funciona para qualquer link válido', async () => {
  assert.equal((await chamar({ slug: 'barbearia-do-lipao', logo: '1' })).body.logo, JPEG);
  assert.equal((await chamar({ slug: 'salao-da-maria', logo: '1' })).body.logo, null);
  amb.fake.seed('barbearias/estranha', { nome: 'X', logo: 'javascript:alert(1)' });
  assert.equal((await chamar({ slug: 'estranha', logo: '1' })).body.logo, null);                     // valor suspeito é descartado
  assert.equal((await chamar({ slug: 'nao-existe-aqui', logo: '1' })).body.logo, null);
});

test('configuração: "aparecer na busca" é só liga/desliga e vale para a própria busca', async () => {
  amb.fake.seed('usuarios/dono1', { barbeariaId: 'so-por-link', role: 'owner' });
  const cfg = async (corpo) => { const r = res(); await configurar(req('POST', { body: { idToken: 'tok-dono1', ...corpo } }), r); return r; };
  assert.equal((await cfg({ diretorio: 'sim' })).statusCode, 400);
  assert.equal((await cfg({ diretorio: true })).statusCode, 200);
  assert.equal(amb.fake.get('barbearias/so-por-link').diretorio, true);
  limparLimites();
  const lista = (await chamar({ buscar: '1' })).body.lugares.map((l) => l.slug);
  assert.ok(lista.includes('so-por-link'));
});

// ---------------------------------------------------------------- filtros (função pura de js/home.js)
function carregarFiltro() {
  const src = fs.readFileSync(raiz('js', 'home.js'), 'utf8');
  const i = src.indexOf('const normalizar'), f = src.indexOf('const iniciais');
  const ctx = vm.createContext({ String });
  vm.runInContext(src.slice(i, f).replace('export function', 'function') + '\nthis.filtrar = filtrarLugares;', ctx);
  return ctx.filtrar;
}
const LUGARES = [
  { slug: 'a', nome: 'Barbearia do Lipão', tipo: 'barbearia', bairro: 'Mangueira', cidade: 'Rio de Janeiro', uf: 'RJ' },
  { slug: 'b', nome: 'Salão da Maria', tipo: 'salao', bairro: 'Tijuca', cidade: 'Rio de Janeiro', uf: 'RJ' },
  { slug: 'c', nome: 'Barbearia São Paulo', tipo: 'barbearia', bairro: 'Pinheiros', cidade: 'São Paulo', uf: 'SP' }
];

test('filtrarLugares: busca sem acento e sem maiúsculas por nome, bairro ou cidade; estado e tipo; ordem alfabética', () => {
  const f = carregarFiltro();
  assert.deepEqual(f(LUGARES).map((l) => l.slug), ['a', 'c', 'b']);                                  // por nome
  assert.deepEqual(f(LUGARES, { q: 'salao' }).map((l) => l.slug), ['b']);
  assert.deepEqual(f(LUGARES, { q: 'MANGUEIRA' }).map((l) => l.slug), ['a']);
  assert.deepEqual(f(LUGARES, { q: 'sao paulo' }).map((l) => l.slug), ['c']);
  assert.deepEqual(f(LUGARES, { uf: 'RJ' }).map((l) => l.slug), ['a', 'b']);
  assert.deepEqual(f(LUGARES, { uf: 'RJ', tipo: 'salao' }).map((l) => l.slug), ['b']);
  assert.equal(f(LUGARES, { q: 'inexistente' }).length, 0);
  assert.equal(f(null).length, 0);
});

// ---------------------------------------------------------------- Meus lugares (só no aparelho)
function carregarLugares() {
  const src = fs.readFileSync(raiz('js', 'lugares.js'), 'utf8').replace(/export function/g, 'function').replace(/export const/g, 'const');
  const armazenamento = new Map();
  const ctx = vm.createContext({ JSON, Date, Array, String, localStorage: { getItem: (k) => (armazenamento.has(k) ? armazenamento.get(k) : null), setItem: (k, v) => armazenamento.set(k, v) } });
  vm.runInContext(src + '\nthis.api = { lerLugares, registrarLugar, esquecerLugar };', ctx);
  return { api: ctx.api, armazenamento };
}

test('Meus lugares: registrar sobe para o topo sem duplicar, limita a 12, esquecer remove e lixo é ignorado', () => {
  const { api, armazenamento } = carregarLugares();
  api.registrarLugar({ slug: 'a', nome: 'A' }); api.registrarLugar({ slug: 'b', nome: 'B' }); api.registrarLugar({ slug: 'a', nome: 'A de novo' });
  assert.deepEqual(Array.from(api.lerLugares(), (l) => l.slug), ['a', 'b']);
  assert.equal(api.lerLugares()[0].nome, 'A de novo');
  for (let i = 0; i < 20; i++) api.registrarLugar({ slug: 'x' + i, nome: 'X' + i });
  assert.equal(api.lerLugares().length, 12);
  api.esquecerLugar('x19');
  assert.equal(api.lerLugares().some((l) => l.slug === 'x19'), false);
  api.registrarLugar({ slug: '', nome: 'sem slug' });                                                // inválido: ignorado
  armazenamento.set('ap_lugares', '{lixo');
  assert.deepEqual(Array.from(api.lerLugares()), []);
});

// ---------------------------------------------------------------- arquivos
test('index.html tem a tela inicial com todos os ids que o home.js usa; o app abre a tela inicial quando não há link e registra o lugar', () => {
  const html = fs.readFileSync(raiz('index.html'), 'utf8');
  const home = fs.readFileSync(raiz('js', 'home.js'), 'utf8');
  const app = fs.readFileSync(raiz('js', 'app.js'), 'utf8');
  const ids = [...new Set([...home.matchAll(/\$\('#([a-z-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length >= 8);
  ids.forEach((id) => assert.ok(html.includes('id="' + id + '"'), 'falta #' + id + ' no index.html'));
  assert.ok(/if \(!state\.slug\)[\s\S]{0,300}import\('\.\/home\.js'\)/.test(app));
  assert.ok(/registrarLugar\(\{ slug: state\.slug/.test(app));
});
