// Simulação de CONSUMO do Firestore (plano gratuito): mede quantas leituras/escritas cada ação do sistema gasta
// (executando os handlers REAIS contra o banco falso instrumentado de tests/_helpers.js) e projeta o consumo diário
// para N negócios, em 3 perfis de uso e 3 idades de histórico, ANTES e DEPOIS da otimização de 15/11/2026.
// NÃO toca em produção. Uso: node scripts/simular-consumo.js
//
// Limites gratuitos do Firestore (firebase.google.com/docs/firestore/quotas, conferidos em 15/11/2026):
//   50.000 leituras/dia · 20.000 escritas/dia · 20.000 exclusões/dia · 1 GiB armazenados · 10 GiB/mês de saída
//   (zera à meia-noite do Pacífico; estourou = operações falham até zerar)

process.env.CRON_SECRET = 'x';
process.env.CACHE_API = '0';   // mede as leituras sem o cache em memória (o cache só reduz: protege contra repetições e robôs)
const path = require('node:path');
const { montarAmbiente, req, res, SEMANA_ABERTA, dataEmDias } = require(path.join(__dirname, '..', 'tests', '_helpers'));
const amb = montarAmbiente();
const fake = amb.fake;

const negocioAPI = require('../api/negocio');
const ocupadosAPI = require('../api/agendamentos-ocupados');
const criarAPI = require('../api/criar-agendamento');
const clienteAPI = require('../api/agendamento-cliente');
const cron = require('../api/cron-recorrencias');
const { limparLimites } = require('../api/_lib/http');

const LIM = { leituras: 50000, escritas: 20000 };
const SLUG = 'sim';
const JANELA_PASSADA = 7;     // dias de histórico que o painel escuta (admin.js → JANELA_DIAS_PASSADOS)

function montarNegocio(slug, { profissionais = 2, servicos = 8, diasHistorico = 0, porDia = 15, clientes = 0, futurosDias = 14 }) {
  fake.seed(`barbearias/${slug}`, { nome: 'Sim', status: 'trial', plano: 'trial', trialFim: new Date(Date.now() + 25 * 86400000).toISOString(), telefone: '5521999990000', endereco: 'Rua A, 1 - Centro, Rio - RJ', horarioFuncionamento: SEMANA_ABERTA });
  for (let p = 1; p <= profissionais; p++) fake.seed(`barbearias/${slug}/profissionais/p${p}`, { nome: 'Prof ' + p, ativo: true, comissao: 40, horarioTrabalho: SEMANA_ABERTA });
  for (let s = 1; s <= servicos; s++) fake.seed(`barbearias/${slug}/servicos/s${s}`, { nome: 'Serviço ' + s, preco: 30 + s, duracaoMin: 30, ativo: true, ordem: s });
  const nomes = Array.from({ length: Math.max(clientes, 1) }, (_, i) => ({ nome: 'Cliente ' + i, whats: String(5521900000000 + i) }));
  nomes.slice(0, clientes).forEach((c, i) => fake.seed(`barbearias/${slug}/clientes/${c.whats}`, { nome: c.nome, whatsapp: c.whats, totalAgendamentos: 1 + (i % 9), primeiraVisita: '2026-01-01T00:00:00Z', ultimoAgendamento: '2026-11-01T00:00:00Z' }));
  let n = 0;
  const criar = (dias, status) => {
    for (let k = 0; k < porDia; k++) {
      const c = nomes[(n * 7) % nomes.length];
      fake.seed(`barbearias/${slug}/agendamentos/h${n++}`, {
        clienteNome: c.nome, clienteWhatsapp: c.whats, profissionalId: 'p' + (1 + (k % profissionais)), profissionalNome: 'Prof',
        servicos: [{ id: 's1', nome: 'Serviço 1', preco: 31, duracaoMin: 30 }], dataChave: dataEmDias(dias), horario: String(9 + Math.floor(k / 2)).padStart(2, '0') + (k % 2 ? ':30' : ':00'),
        duracaoMin: 30, valorTotal: 31, status, criadoEm: '2026-10-01T10:00:00.000Z', origem: 'cliente'
      });
    }
  };
  for (let d = diasHistorico; d >= 1; d--) criar(-d, 'concluido');
  for (let d = 0; d < futurosDias; d++) criar(d + 1, 'confirmado');
  return { clientes: nomes.slice(0, clientes) };
}

const docsDe = (slug, sub) => [...fake.docs.keys()].filter((k) => k.startsWith(`barbearias/${slug}/${sub}/`)).length;
const bytesDe = (slug) => [...fake.docs.entries()].filter(([k]) => k === `barbearias/${slug}` || k.startsWith(`barbearias/${slug}/`)).reduce((s, [, v]) => s + JSON.stringify(v).length + 120, 0);
const chamar = async (h, rq) => { const r = res(); await h(rq, r); return r; };
async function medir(fn) { fake.zerarStats(); limparLimites(); await fn(); return { ...fake.stats }; }

async function medirAcoes(cfg) {
  fake.docs.clear();
  const { clientes } = montarNegocio(SLUG, cfg);
  const w = clientes[0] ? clientes[0].whats : '5521988887777';
  const a = {};
  a.linkAntes = await medir(async () => { await chamar(negocioAPI, req('GET', { query: { slug: SLUG, ocupados: '1' } })); await chamar(negocioAPI, req('GET', { query: { slug: SLUG, fotos: '1' } })); });
  a.linkDepois = await medir(async () => { await chamar(negocioAPI, req('GET', { query: { slug: SLUG } })); await chamar(negocioAPI, req('GET', { query: { slug: SLUG, fotos: '1' } })); });
  a.ocupados = await medir(() => chamar(ocupadosAPI, req('GET', { query: { slug: SLUG } })));                      // antes: todos os profissionais
  a.ocupadosProf = await medir(() => chamar(ocupadosAPI, req('GET', { query: { slug: SLUG, profissionalId: 'p1' } })));   // depois: só o escolhido
  a.identificar = await medir(() => chamar(clienteAPI, req('POST', { body: { slug: SLUG, whatsapp: w, action: 'identificar' } })));
  a.listar = await medir(() => chamar(clienteAPI, req('POST', { body: { slug: SLUG, whatsapp: w, action: 'listar' } })));
  a.agendar = await medir(async () => {
    const r = await chamar(criarAPI, req('POST', { body: { slug: SLUG, whatsapp: w, nome: 'Cliente Novo', profissionalId: 'p1', servicosIds: ['s1', 's2'], dataChave: dataEmDias(60), horario: '10:00' } }));
    if (r.statusCode !== 201) throw new Error('agendamento de teste falhou: ' + JSON.stringify(r.body));
  });
  const S = docsDe(SLUG, 'servicos'), P = docsDe(SLUG, 'profissionais'), A = docsDe(SLUG, 'agendamentos'), C = docsDe(SLUG, 'clientes');
  const noJanela = [...fake.docs.entries()].filter(([k, v]) => k.startsWith(`barbearias/${SLUG}/agendamentos/`) && v.dataChave >= dataEmDias(-JANELA_PASSADA)).length;
  a.painelAntes = { leituras: 2 + S + P + A + C + 6 };                  // vínculo + negócio + 4 coleções inteiras + regras
  a.painelDepois = { leituras: 2 + S + P + noJanela + 6 };              // só a janela de dias + futuros
  a.abaPesada = { leituras: C + (A - noJanela) };                       // aba Clientes / relatório antigo: baixa clientes + histórico (1x por sessão)
  a.cron = await medir(() => chamar(cron, { method: 'GET', headers: { authorization: 'Bearer x' }, query: {} }));
  return { a, docs: { S, P, A, C, noJanela }, bytes: bytesDe(SLUG) };
}

const PERFIS = {
  'LEVE (5 agend./dia, painel 3x/dia, link 8x/dia, agenda até 5 dias à frente)': { agend: 5, link: 8, painel: 3, abaPesada: 0.1, futuros: 5, listar: 1 },
  'MÉDIO (10 agend./dia, painel 5x/dia, link 15x/dia, agenda até 7 dias)': { agend: 10, link: 15, painel: 5, abaPesada: 0.2, futuros: 7, listar: 2 },
  'PESADO (15 agend./dia, painel 8x/dia, link 25x/dia, agenda até 14 dias)': { agend: 15, link: 25, painel: 8, abaPesada: 0.3, futuros: 14, listar: 3 }
};
const IDADES = [
  ['dia 1 (sem histórico)', { diasHistorico: 0, clientes: 0 }],
  ['após 1 mês', { diasHistorico: 30, clientes: 250 }],
  ['após 6 meses', { diasHistorico: 180, clientes: 900 }],
  ['após 12 meses', { diasHistorico: 365, clientes: 1500 }]
];

function projetar(a, p, depois) {
  const link = depois ? a.linkDepois.leituras : a.linkAntes.leituras;
  const painel = depois ? a.painelDepois.leituras : a.painelAntes.leituras;
  // antes: a ocupação era baixada 2x por agendamento (escolher horário + pré-checagem ao confirmar), de todos os profissionais
  const ocup = depois ? a.ocupadosProf.leituras : 2 * a.ocupados.leituras;
  const porNegocio = p.link * link + p.agend * (a.identificar.leituras + ocup + a.agendar.leituras) + p.listar * a.listar.leituras + p.painel * painel + p.agend * 2 + (depois ? p.abaPesada * a.abaPesada.leituras : 0) + a.cron.leituras;
  return { porNegocio, escritas: p.agend * a.agendar.escritas + a.cron.escritas };
}

const f = (n) => Math.round(n).toLocaleString('pt-BR');
const sit = (n, lim) => (n > lim ? '⛔' : n > lim * 0.7 ? '⚠️' : '✅');

(async () => {
  const saida = [];
  const bytesPorIdade = [];
  for (const [nomePerfil, perfil] of Object.entries(PERFIS)) {
    saida.push(`\n######## PERFIL ${nomePerfil}`);
    for (const [idade, cfg] of IDADES) {
      const { a, docs, bytes } = await medirAcoes({ ...cfg, porDia: perfil.agend, futurosDias: perfil.futuros });
      if (perfil.agend === 10) bytesPorIdade.push([idade, docs.A, docs.C, bytes]);
      const linhas = [1, 5, 20, 50].map((N) => {
        const antes = projetar(a, perfil, false), depois = projetar(a, perfil, true);
        return `   ${String(N).padStart(2)} negócios │ ANTES ${f(antes.porNegocio * N).padStart(10)} ${sit(antes.porNegocio * N, LIM.leituras)} (${Math.round((antes.porNegocio * N / LIM.leituras) * 100)}%) │ DEPOIS ${f(depois.porNegocio * N).padStart(9)} ${sit(depois.porNegocio * N, LIM.leituras)} (${Math.round((depois.porNegocio * N / LIM.leituras) * 100)}%)`;
      });
      saida.push(`── ${idade}: ${docs.A} agendamentos, ${docs.C} clientes │ painel ANTES ${a.painelAntes.leituras} → DEPOIS ${a.painelDepois.leituras} leituras/abertura │ link ANTES ${a.linkAntes.leituras} → DEPOIS ${a.linkDepois.leituras}`);
      saida.push(...linhas);
    }
  }
  console.log('Limite gratuito: ' + f(LIM.leituras) + ' leituras/dia (escritas: ' + f(LIM.escritas) + '/dia — nunca chegam perto: ~2 por agendamento)\nLegenda: ✅ folga · ⚠️ acima de 70% do limite · ⛔ estoura\n' + saida.join('\n'));
  console.log('\nArmazenamento por negócio (perfil médio): ' + bytesPorIdade.map(([i, A, C, b]) => `${i}: ${(b / 1024 / 1024).toFixed(2)} MB`).join(' · '));
  process.exit(0);
})().catch((e) => { console.error('falhou:', e); process.exit(1); });
