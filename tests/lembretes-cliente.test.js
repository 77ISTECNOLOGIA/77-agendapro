// Lembretes e avisos push para o CLIENTE (app instalado): programação do lembrete, registro do aparelho, rotina de envio e
// aviso de mudanças feitas pelo estabelecimento.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { montarAmbiente, req, res, dataEmDias, semearNegocio } = require('./_helpers');

const amb = montarAmbiente();
const criarAgendamento = require('../api/criar-agendamento');
const agendamentoCliente = require('../api/agendamento-cliente');
const recorrencia = require('../api/recorrencia');
const cron = require('../api/cron-recorrencias');
const lembrete = require('../api/_lib/lembrete');
const { limparLimites } = require('../api/_lib/http');

const SLUG = 'barbearia-teste';
const WHATS = '(21) 99999-1234';
const WHATS_NORM = '5521999991234';
const TOKEN = 'token-do-aparelho-do-cliente-0001';

async function chamar(handler, requisicao) { const r = res(); await handler(requisicao, r); return r; }
const acaoCliente = (action, extra = {}) => req('POST', { body: { slug: SLUG, whatsapp: WHATS, action, ...extra } });
const acaoDono = (extra) => req('POST', { body: { idToken: 'tok-dono', ...extra } });

async function agendar(extra = {}) {
  const r = await chamar(criarAgendamento, req('POST', { body: { slug: SLUG, whatsapp: WHATS, nome: 'Maria Souza', profissionalId: 'prof1',
    servicosIds: ['srv1'], dataChave: dataEmDias(1), horario: '10:00', ...extra } }));
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  limparLimites();
  return r.body.id;
}
const caminhoAg = (id) => `barbearias/${SLUG}/agendamentos/${id}`;

test.beforeEach(() => {
  limparLimites();
  amb.fake.docs.clear();
  amb.notificacoes.length = 0;
  semearNegocio(amb.fake, SLUG);
  amb.fake.seed('usuarios/dono', { barbeariaId: SLUG, role: 'owner' });
});

// ---------------------------------------------------------------- cálculo do horário do aviso

test('calcularLembreteAppEm: antecedência em minutos, virando o dia quando preciso; 0 = não avisar', () => {
  assert.equal(lembrete.calcularLembreteAppEm('2026-11-20', '14:00', 60), '2026-11-20T13:00');
  assert.equal(lembrete.calcularLembreteAppEm('2026-11-20', '00:30', 60), '2026-11-19T23:30');
  assert.equal(lembrete.calcularLembreteAppEm('2026-03-01', '09:00', 1440), '2026-02-28T09:00');
  assert.equal(lembrete.calcularLembreteAppEm('2026-11-20', '14:00', 0), null);
  assert.equal(lembrete.minutosLembrete({}), 60);                    // padrão: 1 hora antes
  assert.equal(lembrete.minutosLembrete({ lembreteClienteMin: 0 }), 0);
  assert.equal(lembrete.minutosLembrete({ lembreteClienteMin: 7 }), 60);   // valor fora da lista volta ao padrão
});

test('a cópia do navegador (js/utils.js) calcula igual ao servidor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
  const trecho = src.slice(src.indexOf('export const OPCOES_LEMBRETE_MIN'));
  const ctx = vm.createContext({ String, Number, Date });
  vm.runInContext(trecho.replace(/export /g, '') + '\nthis.calc = calcularLembreteAppEm; this.min = minutosLembrete;', ctx);
  for (const [d, h, m] of [['2026-11-20', '14:00', 60], ['2026-11-20', '00:30', 60], ['2026-03-01', '09:00', 1440], ['2026-12-31', '23:30', 30], ['2026-11-20', '10:00', 0]]) {
    assert.equal(ctx.calc(d, h, m), lembrete.calcularLembreteAppEm(d, h, m), [d, h, m].join(' '));
  }
  assert.equal(ctx.min({ lembreteClienteMin: 120 }), 120);
  assert.equal(ctx.min({}), 60);
});

test('criar-agendamento grava o horário do aviso (padrão 1 h antes) e respeita "não avisar"', async () => {
  const id = await agendar();
  assert.equal(amb.fake.get(caminhoAg(id)).lembreteAppEm, `${dataEmDias(1)}T09:00`);
  amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), lembreteClienteMin: 0 });
  const id2 = await agendar({ horario: '15:00' });
  assert.equal(amb.fake.get(caminhoAg(id2)).lembreteAppEm, undefined);
});

test('o cliente remarcando pelo link recalcula o aviso', async () => {
  const id = await agendar();
  const r = await chamar(agendamentoCliente, acaoCliente('remarcar', { agendamentoId: id, novaDataChave: dataEmDias(5), novoHorario: '16:00' }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(amb.fake.get(caminhoAg(id)).lembreteAppEm, `${dataEmDias(5)}T15:00`);
});

// ---------------------------------------------------------------- aparelho do cliente

test('aparelho-registrar: só para quem já tem agendamento; remover só pelo mesmo WhatsApp', async () => {
  const sem = await chamar(agendamentoCliente, acaoCliente('aparelho-registrar', { token: TOKEN }));
  assert.equal(sem.statusCode, 404);
  await agendar();
  const ok = await chamar(agendamentoCliente, acaoCliente('aparelho-registrar', { token: TOKEN, aparelho: 'iPhone · app' }));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const guardado = amb.fake.get(`barbearias/${SLUG}/dispositivosCliente/${lembrete.idAparelho(TOKEN)}`);
  assert.equal(guardado.whatsapp, WHATS_NORM);
  assert.equal(guardado.token, TOKEN);
  // outra pessoa tentando remover não consegue
  await chamar(agendamentoCliente, req('POST', { body: { slug: SLUG, whatsapp: '(21) 98888-0000', action: 'aparelho-remover', token: TOKEN } }));
  assert.ok(amb.fake.get(`barbearias/${SLUG}/dispositivosCliente/${lembrete.idAparelho(TOKEN)}`));
  await chamar(agendamentoCliente, acaoCliente('aparelho-remover', { token: TOKEN }));
  assert.equal(amb.fake.get(`barbearias/${SLUG}/dispositivosCliente/${lembrete.idAparelho(TOKEN)}`), undefined);
  const curto = await chamar(agendamentoCliente, acaoCliente('aparelho-registrar', { token: 'curto' }));
  assert.equal(curto.statusCode, 400);
});

test('aparelho-registrar: no máximo 5 aparelhos por WhatsApp (o mais antigo sai)', async () => {
  await agendar();
  for (let i = 0; i < 6; i++) {
    const r = await chamar(agendamentoCliente, acaoCliente('aparelho-registrar', { token: `token-aparelho-numero-${i}-xxxxxxxx` }));
    assert.equal(r.statusCode, 200);
    limparLimites();
    await new Promise((ok) => setTimeout(ok, 3));       // atualizadoEm diferente em cada um
  }
  const meus = [...amb.fake.docs.keys()].filter((k) => k.includes('/dispositivosCliente/'));
  assert.equal(meus.length, 5);
  assert.equal(meus.some((k) => k.endsWith(lembrete.idAparelho('token-aparelho-numero-0-xxxxxxxx'))), false);
});

// ---------------------------------------------------------------- rotina de envio

async function prepararComAparelho() {
  const id = await agendar();                                               // amanhã 10:00, aviso às 09:00
  await chamar(agendamentoCliente, acaoCliente('aparelho-registrar', { token: TOKEN }));
  limparLimites();
  amb.notificacoes.length = 0;
  return id;
}

test('rotina: envia o lembrete vencido ao aparelho do cliente, uma única vez, e apaga o campo', async () => {
  const id = await prepararComAparelho();
  const r1 = await lembrete.enviarLembretesVencidos({ dataChave: dataEmDias(1), minutos: 9 * 60 + 5 });
  assert.equal(r1.enviados, 1);
  assert.equal(amb.notificacoes.length, 1);
  assert.equal(amb.notificacoes[0].token, TOKEN);
  assert.match(amb.notificacoes[0].notification.title, /10:00/);
  assert.match(amb.notificacoes[0].webpush.fcmOptions.link, new RegExp('/' + SLUG + '$'));
  assert.equal(amb.fake.get(caminhoAg(id)).lembreteAppEm, undefined);
  const r2 = await lembrete.enviarLembretesVencidos({ dataChave: dataEmDias(1), minutos: 9 * 60 + 10 });
  assert.equal(r2.vencidos, 0);
  assert.equal(amb.notificacoes.length, 1);
});

test('rotina: antes da hora não envia (nem lê); depois do início, cancelado ou negócio parado: descarta sem enviar', async () => {
  const id = await prepararComAparelho();
  assert.equal((await lembrete.enviarLembretesVencidos({ dataChave: dataEmDias(1), minutos: 8 * 60 })).vencidos, 0);
  // já começou
  const r = await lembrete.enviarLembretesVencidos({ dataChave: dataEmDias(1), minutos: 10 * 60 + 5 });
  assert.equal(r.descartados, 1); assert.equal(amb.notificacoes.length, 0);
  assert.equal(amb.fake.get(caminhoAg(id)).lembreteAppEm, undefined);
  // cancelado
  const id2 = await agendar({ horario: '15:00' });
  amb.fake.seed(caminhoAg(id2), { ...amb.fake.get(caminhoAg(id2)), status: 'cancelado' });
  await lembrete.enviarLembretesVencidos({ dataChave: dataEmDias(1), minutos: 14 * 60 + 5 });
  assert.equal(amb.notificacoes.length, 0);
  // negócio suspenso
  const id3 = await agendar({ horario: '17:00' });
  amb.fake.seed(`barbearias/${SLUG}`, { ...amb.fake.get(`barbearias/${SLUG}`), status: 'suspensa' });
  await lembrete.enviarLembretesVencidos({ dataChave: dataEmDias(1), minutos: 16 * 60 + 5 });
  assert.equal(amb.notificacoes.length, 0);
  assert.equal(amb.fake.get(caminhoAg(id3)).lembreteAppEm, undefined);
});

test('rotina: token vencido é apagado e outro cliente não recebe o aviso de quem agendou', async () => {
  await prepararComAparelho();
  amb.fake.seed(`barbearias/${SLUG}/dispositivosCliente/outro`, { whatsapp: '5521988880000', token: 'token-de-outra-pessoa-0000001' });
  amb.tokensInvalidos.add(TOKEN);
  await lembrete.enviarLembretesVencidos({ dataChave: dataEmDias(1), minutos: 9 * 60 + 5 });
  assert.equal(amb.notificacoes.length, 0);                                 // o outro cliente não foi avisado
  assert.equal(amb.fake.get(`barbearias/${SLUG}/dispositivosCliente/${lembrete.idAparelho(TOKEN)}`), undefined);
  assert.ok(amb.fake.get(`barbearias/${SLUG}/dispositivosCliente/outro`));
  amb.tokensInvalidos.delete(TOKEN);
});

test('cron ?tarefa=lembretes exige a senha e responde com o resumo', async () => {
  const antes = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'segredo-de-teste';
  try {
    const semSenha = await chamar(cron, { method: 'GET', query: { tarefa: 'lembretes' }, headers: {} });
    assert.equal(semSenha.statusCode, 401);
    const ok = await chamar(cron, { method: 'GET', query: { tarefa: 'lembretes' }, headers: { authorization: 'Bearer segredo-de-teste' } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.sucesso, true);
    assert.equal(typeof ok.body.vencidos, 'number');
  } finally { if (antes === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = antes; }
});

// ---------------------------------------------------------------- avisos de mudanças feitas pelo estabelecimento

test('avisar-cliente: cancelamento feito agora pelo dono chega ao aparelho do cliente; fora de hora ou de outro tipo, não', async () => {
  const id = await prepararComAparelho();
  amb.fake.seed(caminhoAg(id), { ...amb.fake.get(caminhoAg(id)), donoVe: true });
  // ainda confirmado: nada a avisar
  let r = await chamar(recorrencia, acaoDono({ action: 'avisar-cliente', agendamentoId: id, tipo: 'cancelado' }));
  assert.equal(r.body.enviado, false);
  amb.fake.seed(caminhoAg(id), { ...amb.fake.get(caminhoAg(id)), status: 'cancelado', canceladoEm: new Date().toISOString() });
  r = await chamar(recorrencia, acaoDono({ action: 'avisar-cliente', agendamentoId: id, tipo: 'cancelado' }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.enviado, true);
  assert.equal(amb.notificacoes.length, 1);
  assert.match(amb.notificacoes[0].notification.title, /cancelado/i);
  // tipo que não bate com o estado: o servidor não manda
  amb.notificacoes.length = 0;
  r = await chamar(recorrencia, acaoDono({ action: 'avisar-cliente', agendamentoId: id, tipo: 'sinal-confirmado' }));
  assert.equal(r.body.enviado, false);
  // cancelamento antigo (mais de 10 min): não reenvia
  amb.fake.seed(caminhoAg(id), { ...amb.fake.get(caminhoAg(id)), canceladoEm: new Date(Date.now() - 3600000).toISOString() });
  r = await chamar(recorrencia, acaoDono({ action: 'avisar-cliente', agendamentoId: id, tipo: 'cancelado' }));
  assert.equal(r.body.enviado, false);
  assert.equal(amb.notificacoes.length, 0);
});

test('avisar-cliente: cancelamento feito pelo próprio cliente não gera aviso ao cliente; agendamento de outro negócio é recusado', async () => {
  const id = await prepararComAparelho();
  amb.fake.seed(caminhoAg(id), { ...amb.fake.get(caminhoAg(id)), donoVe: true, status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: 'cliente' });
  let r = await chamar(recorrencia, acaoDono({ action: 'avisar-cliente', agendamentoId: id, tipo: 'cancelado' }));
  assert.equal(r.body.enviado, false);
  amb.fake.seed('usuarios/forasteiro', { barbeariaId: 'outro-negocio', role: 'owner' });
  amb.fake.seed('barbearias/outro-negocio', { nome: 'Outro', status: 'ativa' });
  r = await chamar(recorrencia, req('POST', { body: { idToken: 'tok-forasteiro', action: 'avisar-cliente', agendamentoId: id, tipo: 'cancelado' } }));
  assert.equal(r.statusCode, 404);                                         // no negócio dele esse agendamento não existe
  assert.equal(amb.notificacoes.length, 0);
});

test('avisar-cliente: sinal confirmado e remarcação pelo dono', async () => {
  const id = await prepararComAparelho();
  const base = { ...amb.fake.get(caminhoAg(id)), donoVe: true };
  amb.fake.seed(caminhoAg(id), { ...base, status: 'confirmado', sinalConfirmadoEm: new Date().toISOString() });
  let r = await chamar(recorrencia, acaoDono({ action: 'avisar-cliente', agendamentoId: id, tipo: 'sinal-confirmado' }));
  assert.equal(r.body.enviado, true);
  assert.match(amb.notificacoes[0].notification.title, /confirmado/i);
  amb.notificacoes.length = 0;
  amb.fake.seed(caminhoAg(id), { ...base, remarcadoPor: 'dono', remarcadoEm: new Date().toISOString(), remarcadoDeDataChave: dataEmDias(1), remarcadoDeHorario: '10:00', dataChave: dataEmDias(2), horario: '11:00' });
  r = await chamar(recorrencia, acaoDono({ action: 'avisar-cliente', agendamentoId: id, tipo: 'remarcado' }));
  assert.equal(r.body.enviado, true);
  assert.match(amb.notificacoes[0].notification.body, /→/);
});

// ---------------------------------------------------------------- telas

test('situacaoAvisos: iPhone fora do app pede para instalar; bloqueado e ativo; sem suporte some', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'avisos-cliente.js'), 'utf8');
  const m = /export function situacaoAvisos[\s\S]*?\n}\n/.exec(src);
  const ctx = vm.createContext({});
  vm.runInContext(m[0].replace('export ', '') + '\nthis.f = situacaoAvisos;', ctx);
  const f = (o) => ctx.f({ suporta: true, apple: false, standalone: false, permissao: 'default', ativoLocal: false, ...o });
  assert.equal(f({ apple: true }), 'instalar-primeiro');
  assert.equal(f({ apple: true, standalone: true }), 'ativar');
  assert.equal(f({ suporta: false }), 'indisponivel');
  assert.equal(f({ permissao: 'denied' }), 'bloqueado');
  assert.equal(f({ permissao: 'granted', ativoLocal: true }), 'ativo');
  assert.equal(f({ permissao: 'granted', ativoLocal: false }), 'ativar');
});

test('index.html e app.js ligam o cartão de avisos; o service worker abre o link do estabelecimento ao tocar', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'firebase-messaging-sw.js'), 'utf8');
  assert.ok(html.includes('id="card-avisos-sucesso"') && html.includes('id="card-avisos-lista"'));
  assert.ok(app.includes("mostrarCartaoAvisos($('#card-avisos-sucesso')") && app.includes("mostrarCartaoAvisos($('#card-avisos-lista')"));
  assert.ok(sw.includes('openWindow(dados.link)'));
});
