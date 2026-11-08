// Sinal por Pix e limite semanal — telas (link do cliente e painel do dono) e regras do Firestore.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = ler('js/app.js');
const admin = ler('js/admin.js');
const html = ler('index.html');
const adminHtml = ler('admin.html');

function extrair(src, nome) {
  const m = new RegExp('(async )?function ' + nome + '\\(').exec(src);
  assert.ok(m, 'função ' + nome + ' não encontrada');
  let i = src.indexOf('{', src.indexOf(')', m.index)), n = 0;
  for (; i < src.length; i++) { if (src[i] === '{') n++; else if (src[i] === '}' && --n === 0) break; }
  return src.slice(m.index, i + 1);
}

test('regras do Firestore: aceitam os dois status novos e nada além disso', () => {
  const regras = ler('firestore.rules');
  assert.match(regras, /function statusAgOk\(v\)\s*\{ return v in \['confirmado', 'concluido', 'cancelado', 'aguardando_sinal', 'sinal_informado'\]; \}/);
  // criar agendamento pelo navegador do dono continua exigindo status válido; o do cliente só nasce no servidor
  assert.match(regras, /allow create: if \(isDonoNegocio\(slug\) \|\| isSuperAdmin\(\)\) && agendamentoNovoOk/);
});

test('tela do cliente: funções do Pix (telefone, data, mensagem do WhatsApp, rótulo do botão)', () => {
  const ctx = vm.createContext({
    state: { barbearia: { sinal: { ativo: true } }, sinalAtual: {
      valor: 37.5, agendamento: { dataChave: '2026-11-09', horario: '10:00', servicos: [{ nome: 'Corte' }, { nome: 'Barba' }] }
    }, cliente: { nome: 'Maria Souza' } },
    formatarMoeda: (v) => 'R$ ' + v.toFixed(2).replace('.', ','),
    Date, String, encodeURIComponent
  });
  ['telefoneParaWhatsapp', 'textoDataHora', 'mensagemWhatsSinal', 'rotuloConfirmar'].forEach((f) => vm.runInContext(extrair(app, f), ctx));
  const r = (js) => vm.runInContext(js, ctx);
  assert.equal(r("telefoneParaWhatsapp('(21) 99999-0000')"), '5521999990000');
  assert.equal(r("telefoneParaWhatsapp('5521999990000')"), '5521999990000');
  assert.equal(r("telefoneParaWhatsapp('123')"), '', 'telefone inválido: não abre WhatsApp');
  assert.equal(r("textoDataHora('2026-11-09', '10:00')"), 'seg, 09/11 às 10:00');
  assert.equal(r('mensagemWhatsSinal()'), 'Olá! Fiz o Pix do sinal de R$ 37,50 do meu agendamento de seg, 09/11 às 10:00 (Corte + Barba), em nome de Maria Souza. Pode confirmar, por favor?');
  assert.equal(r('rotuloConfirmar()'), 'Reservar e pagar sinal →');
  r('state.barbearia.sinal.ativo = false');
  assert.equal(r('rotuloConfirmar()'), 'Confirmar ✓');
});

test('tela do cliente: pagamento do sinal (tela 7), botão único "Já paguei" e WhatsApp', () => {
  for (const id of ['tela-7', 'btn-copiar-pix', 'btn-ja-paguei', 'btn-sinal-whats', 'btn-sinal-meus', 'sinal-qr', 'aviso-sinal', 'sinal-informado']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.match(html, /qrcodejs@1\.0\.0\/qrcode\.min\.js/);
  // "Já paguei": registra no servidor (keepalive) e abre o WhatsApp DENTRO do clique, antes de esperar a resposta
  const fn = extrair(app, 'handleJaPaguei');
  assert.match(fn, /keepalive: true/);
  assert.match(fn, /action: 'sinal-informar'/);
  assert.ok(fn.indexOf('window.open(') > fn.indexOf('fetch(') && fn.indexOf('window.open(') < fn.indexOf('await chamada'), 'abre o WhatsApp antes de aguardar o servidor (senão o navegador bloqueia)');
  // depois de criar a reserva com sinal vai para a tela 7; sem sinal segue o fluxo antigo
  assert.match(app, /if \(corpo\.sinal\) \{[\s\S]{0,260}renderizarTelaSinal\(\);\s*\n\s*mostrarTela\(7\);\s*\n\s*return;/);
  assert.match(app, /renderizarTelaSucesso\(corpo\.id\);/);
  // lista "Meus agendamentos": pagar/ver pagamento para os dois status
  assert.match(app, /aguardando_sinal: 'Aguardando sinal', sinal_informado: 'Pagamento informado'/);
  assert.match(app, /data-acao="pagar"/);
  assert.match(app, /btn-sinal-meus'\)\.addEventListener/);
  assert.match(app, /Quem recebe: <strong>/);
  assert.match(app, /Instituição: <strong>/);
  assert.match(app, /s\.banco \?/, 'mostra a instituição quando informada');
  assert.match(app, /confira se este nome aparece como destinatário/);
});

test('painel do dono: confirmar/recusar pagamento, configuração do sinal e limite semanal', () => {
  for (const id of ['pagamentos-confirmar', 'sinal-ativo', 'sinal-percentual', 'sinal-prazo-horas', 'sinal-tipo-chave', 'sinal-chave', 'sinal-nome-recebedor', 'sinal-cidade-recebedor', 'sinal-banco', 'limite-semana', 'btn-salvar-sinal']) {
    assert.match(adminHtml, new RegExp('id="' + id + '"'), id);
  }
  assert.match(admin, /async function confirmarSinal\(id\)[\s\S]{0,260}status: 'confirmado'/);
  assert.match(admin, /async function recusarSinal\(id\)[\s\S]{0,400}status: 'cancelado'[\s\S]{0,120}canceladoPor: 'sinal-recusado'/);
  assert.match(admin, /fetch\('\/api\/configurar-negocio'/);
  assert.match(admin, /\$\('#btn-salvar-sinal'\)\.addEventListener\('click', salvarRegrasAgendamento\)/);
  assert.match(admin, /a\.status === 'aguardando_sinal' && a\.sinalExpiraEm && Date\.parse\(a\.sinalExpiraEm\) <= Date\.now\(\)/, 'sinal vencido é tratado como cancelado no painel');
  assert.match(admin, /acao-confirmar-sinal/);
  assert.match(admin, /const totalSelo = lista\.length \+ totalPagamentos;/);
  // chave Pix nunca é gravada pelo navegador: passa pela API que valida
  assert.doesNotMatch(admin, /updateDoc\([^)]*\{[^}]*chavePix/);
});
