// Abertura do link do cliente (index.html + js/app.js): pré-carga dos dados no <head> e fotos em chamada separada.
// Executa as funções REAIS num navegador simulado.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const utils = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extrair(src, nome) {
  const m = new RegExp('(async )?function ' + nome + '\\(').exec(src);
  assert.ok(m, 'função ' + nome + ' não encontrada');
  let i = src.indexOf('{', src.indexOf(')', m.index)), n = 0;
  for (; i < src.length; i++) { if (src[i] === '{') n++; else if (src[i] === '}' && --n === 0) break; }
  return src.slice(m.index, i + 1);
}
const CODIGO = [extrair(utils, 'fotoServicoValida'), extrair(app, 'carregarBarbearia'), extrair(app, 'carregarFotosServicos'), extrair(app, 'aplicarFotosServicos')].join('\n');
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';

const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
const DADOS = { barbearia: { nome: 'Lipão' }, servicos: { s1: { nome: 'Corte', temFoto: true }, s2: { nome: 'Barba', temFoto: false } }, profissionais: {}, ocupados: [] };

function montar({ prefetch, respostas = [], servicos } = {}) {
  const chamadas = [];
  const fila = [...respostas];
  const cartoes = {};
  const ctx = vm.createContext({
    console: { error() {}, log() {} }, Promise, Object, encodeURIComponent, String,
    window: { __negocioPrefetch: prefetch },
    state: { slug: 'lipao', barbearia: null, servicos: servicos || {}, profissionais: {}, agendamentos: [] },
    fetch: async (url) => { chamadas.push(url); const r = fila.shift(); if (r instanceof Error) throw r; return r; },
    $$: () => Object.values(cartoes),
    document: { createElement: () => ({ classList: {}, src: '', alt: '' }) }
  });
  vm.runInContext(CODIGO, ctx);
  const cartao = (id, pendente = true) => {
    const c = { dataset: { id }, removido: false, filhos: [], classesRemovidas: [] };
    const pend = { classList: { remove: (k) => c.classesRemovidas.push(k) }, appendChild: (x) => c.filhos.push(x), remove: () => { c.removido = true; } };
    c.querySelector = () => (pendente ? pend : null);
    cartoes[id] = c;
    return c;
  };
  return { ctx, chamadas, cartao, run: (js) => vm.runInContext(js, ctx) };
}

test('pré-carga: usa os dados já pedidos no <head> sem fazer nova chamada (e só uma vez)', async () => {
  const t = montar({ prefetch: { slug: 'lipao', promessa: Promise.resolve(resposta(200, DADOS)) } });
  assert.equal(await t.run("carregarBarbearia('lipao')"), true);
  assert.equal(t.chamadas.length, 0, 'não chamou a API de novo');
  assert.equal(t.ctx.state.barbearia.nome, 'Lipão');
  assert.equal(t.ctx.window.__negocioPrefetch, null, 'a pré-carga vale uma vez só');
});

test('pré-carga de OUTRO link, que falhou ou que veio com erro: busca do jeito normal', async () => {
  let t = montar({ prefetch: { slug: 'outro', promessa: Promise.resolve(resposta(200, DADOS)) }, respostas: [resposta(200, DADOS)] });
  assert.equal(await t.run("carregarBarbearia('lipao')"), true);
  assert.deepEqual(t.chamadas, ['/api/negocio?slug=lipao'], 'não aproveita a pré-carga de outro link');

  t = montar({ prefetch: { slug: 'lipao', promessa: Promise.reject(new Error('sem internet')) }, respostas: [resposta(200, DADOS)] });
  assert.equal(await t.run("carregarBarbearia('lipao')"), true);
  assert.equal(t.chamadas.length, 1, 'pré-carga caiu: tenta de novo normalmente');

  t = montar({ prefetch: { slug: 'lipao', promessa: Promise.resolve(resposta(500, {})) }, respostas: [resposta(200, DADOS)] });
  assert.equal(await t.run("carregarBarbearia('lipao')"), true);
  assert.equal(t.chamadas.length, 1, 'erro 500 na pré-carga: tenta de novo');
});

test('pré-carga com link inexistente (404) responde na hora, sem repetir a chamada', async () => {
  const t = montar({ prefetch: { slug: 'lipao', promessa: Promise.resolve(resposta(404, {})) } });
  assert.equal(await t.run("carregarBarbearia('lipao')"), false);
  assert.equal(t.chamadas.length, 0);
});

test('sem pré-carga nenhuma: busca normal', async () => {
  const t = montar({ respostas: [resposta(200, DADOS)] });
  assert.equal(await t.run("carregarBarbearia('lipao')"), true);
  assert.deepEqual(t.chamadas, ['/api/negocio?slug=lipao']);
});

test('fotos: chegam numa chamada separada e entram no lugar da caixa cinza', async () => {
  const t = montar({ servicos: { s1: { nome: 'Corte', temFoto: true }, s2: { nome: 'Barba', temFoto: false } }, respostas: [resposta(200, { fotos: { s1: JPEG } })] });
  const c1 = t.cartao('s1');
  await t.run('carregarFotosServicos()');
  assert.deepEqual(t.chamadas, ['/api/negocio?slug=lipao&fotos=1']);
  assert.equal(t.ctx.state.servicos.s1.foto, JPEG);
  assert.equal(c1.filhos.length, 1, 'a foto foi colocada no cartão');
  assert.equal(c1.filhos[0].src, JPEG);
  assert.deepEqual(c1.classesRemovidas, ['foto-carregando']);
  assert.equal(c1.removido, false);
});

test('fotos: se a chamada falhar ou vier valor suspeito, a caixa cinza some (nada de "carregando" para sempre)', async () => {
  let t = montar({ servicos: { s1: { nome: 'Corte', temFoto: true } }, respostas: [new Error('sem internet')] });
  let c = t.cartao('s1');
  await t.run('carregarFotosServicos()');
  assert.equal(c.removido, true);
  assert.equal(t.ctx.state.servicos.s1.temFoto, false);

  t = montar({ servicos: { s1: { nome: 'Corte', temFoto: true } }, respostas: [resposta(200, { fotos: { s1: 'javascript:alert(1)' } })] });
  c = t.cartao('s1');
  await t.run('carregarFotosServicos()');
  assert.equal(c.removido, true, 'valor que não é JPEG nunca vira <img>');
  assert.equal(c.filhos.length, 0);

  t = montar({ servicos: { s1: { nome: 'Corte', temFoto: true } }, respostas: [resposta(500, {})] });
  c = t.cartao('s1');
  await t.run('carregarFotosServicos()');
  assert.equal(c.removido, true);
});

test('fotos: sem nenhum serviço com foto, nem faz a chamada', async () => {
  const t = montar({ servicos: { s1: { nome: 'Corte', temFoto: false } } });
  await t.run('carregarFotosServicos()');
  assert.equal(t.chamadas.length, 0);
});

test('arquivos: pré-carga no <head> com a mesma regra de link do app.js, módulos pedidos de uma vez, cartão com caixa cinza', () => {
  const cabeca = html.slice(0, html.indexOf('</head>'));
  assert.match(cabeca, /window\.__negocioPrefetch = \{ slug: slug, promessa: fetch\('\/api\/negocio\?slug=' \+ encodeURIComponent\(slug\)\) \}/);
  assert.ok(cabeca.indexOf('__negocioPrefetch') < cabeca.indexOf('rel="stylesheet"'), 'a chamada sai antes de qualquer arquivo de estilo');
  // mesma regra de descobrir o link nos dois lugares (senão a pré-carga nunca seria aproveitada)
  assert.match(cabeca, /get\('b'\) \|\| location\.pathname\.split\('\/'\)\.filter\(Boolean\)\[0\]/);
  assert.match(app, /state\.slug = slugQuery \|\| slugPath/);
  assert.match(app, /params\.get\('b'\)/);
  for (const m of ['js/app.js', 'js/utils.js', 'js/vocabulario.js']) assert.match(cabeca, new RegExp('rel="modulepreload" href="' + m.replace('.', '\\.') + '"'), m);
  assert.match(app, /s\.temFoto \? '<div class="servico-foto com-foto foto-carregando"><\/div>' : ''/);
  assert.match(app, /mostrarApp\(\);\s*\n\s*carregarFotosServicos\(\);/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8'), /\.servico-foto\.foto-carregando/);
});
