// Auditoria SOMENTE LEITURA dos dados de produção: procura inconsistências (vínculos quebrados, contas "cegas",
// preços por profissional órfãos, agendamentos de profissional inexistente, aparelhos de quem saiu...).
// Uso: node scripts/auditar-dados.js     (requer scripts/serviceAccountKey.json, fora do git)
// Não grava nada.

const path = require('path');
const admin = require('firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore(app);

const achados = [];
const ach = (nivel, negocio, msg) => achados.push({ nivel, negocio, msg });
const permissoesDe = (u) => (u.permissoes && typeof u.permissoes === 'object')
  ? { verTodos: u.permissoes.verTodos === true, gerirNegocio: u.permissoes.gerirNegocio === true }
  : ((u.role === undefined || u.role === 'owner') ? { verTodos: true, gerirNegocio: true } : { verTodos: false, gerirNegocio: false });
const STATUS = ['confirmado', 'concluido', 'cancelado', 'aguardando_sinal', 'sinal_informado'];

(async () => {
  const negocios = await db.collection('barbearias').get();
  const usuarios = await db.collection('usuarios').get();
  const porNegocio = {};
  usuarios.docs.forEach((u) => { const d = u.data(); (porNegocio[d.barbeariaId] = porNegocio[d.barbeariaId] || []).push({ uid: u.id, ...d }); });
  const slugs = new Set(negocios.docs.map((n) => n.id));
  Object.keys(porNegocio).forEach((s) => { if (!slugs.has(s)) ach('ERRO', s, `há usuários apontando para um negócio que não existe (${porNegocio[s].map((u) => u.email).join(', ')})`); });

  for (const n of negocios.docs) {
    const slug = n.id, info = n.data();
    const [servs, profs, ags, disp, conv, recs] = await Promise.all(['servicos', 'profissionais', 'agendamentos', 'dispositivos', 'convites', 'recorrencias'].map((c) => n.ref.collection(c).get()));
    const profIds = new Set(profs.docs.map((p) => p.id));
    const membros = porNegocio[slug] || [];
    console.log(`\n== ${slug} (${info.nome}) — status ${info.status}; ${profs.size} profissionais, ${servs.size} serviços, ${ags.size} agendamentos, ${membros.length} logins, ${disp.size} aparelhos`);

    if (!membros.length) ach('ERRO', slug, 'nenhum login vinculado (ninguém consegue abrir o painel)');
    if (membros.length && !membros.some((m) => permissoesDe(m).gerirNegocio)) ach('ERRO', slug, 'nenhum login com "Gerenciar o negócio"');
    const vistos = new Map();
    membros.forEach((m) => {
      const p = permissoesDe(m);
      if (!p.verTodos && !m.profissionalId) ach('ERRO', slug, `login ${m.email} não vê tudo e não tem profissional: painel vazio`);
      if (m.profissionalId) {
        if (!profIds.has(m.profissionalId)) ach('ERRO', slug, `login ${m.email} aponta para profissional inexistente (${m.profissionalId})`);
        if (vistos.has(m.profissionalId)) ach('ERRO', slug, `profissional ${m.profissionalId} ligado a dois logins (${vistos.get(m.profissionalId)} e ${m.email})`);
        vistos.set(m.profissionalId, m.email);
      }
      if (m.role === 'profissional' && !m.permissoes) ach('AVISO', slug, `login ${m.email} é "profissional" sem campo permissoes (fica sem acesso amplo)`);
    });

    profs.docs.forEach((p) => {
      const d = p.data();
      if (d.ativo !== false && !d.horarioTrabalho) ach('AVISO', slug, `profissional ${d.nome} sem horarioTrabalho (vale o do estabelecimento)`);
      if (d.pix && (!d.pix.chavePix || !d.pix.nomeRecebedor)) ach('AVISO', slug, `profissional ${d.nome} com Pix incompleto (será ignorado)`);
    });
    if (![...profs.docs].some((p) => p.data().ativo !== false)) ach('ERRO', slug, 'nenhum profissional ativo (o link do cliente não consegue agendar)');

    servs.docs.forEach((s) => {
      const d = s.data();
      if (d.ativo !== false && (!Number.isFinite(d.preco) || !Number.isFinite(d.duracaoMin) || d.duracaoMin <= 0)) ach('ERRO', slug, `serviço ${d.nome} com preço/duração inválidos`);
      Object.keys(d.precosProfissional || {}).forEach((pid) => { if (!profIds.has(pid)) ach('AVISO', slug, `serviço ${d.nome} tem preço próprio de profissional inexistente (${pid})`); });
      (d.profissionaisIds || []).forEach((pid) => { if (!profIds.has(pid)) ach('AVISO', slug, `serviço ${d.nome} restrito a profissional inexistente (${pid})`); });
      if (d.ativo !== false && Array.isArray(d.profissionaisIds) && d.profissionaisIds.length && !d.profissionaisIds.some((pid) => profIds.has(pid))) ach('ERRO', slug, `serviço ${d.nome} ninguém realiza (clientes não conseguem escolher)`);
    });

    const hoje = new Date().toISOString().slice(0, 10);
    let futuros = 0;
    ags.docs.forEach((a) => {
      const d = a.data();
      if (!profIds.has(d.profissionalId)) ach('AVISO', slug, `agendamento ${a.id} (${d.dataChave}) de profissional inexistente (${d.profissionalId})`);
      if (!STATUS.includes(d.status)) ach('ERRO', slug, `agendamento ${a.id} com status inválido (${d.status})`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dataChave || '') || !/^\d{2}:\d{2}$/.test(d.horario || '')) ach('ERRO', slug, `agendamento ${a.id} com data/horário inválidos`);
      if (!(d.duracaoMin > 0)) ach('ERRO', slug, `agendamento ${a.id} sem duração`);
      if (d.dataChave >= hoje && d.status === 'confirmado') futuros++;
    });
    // conflito: dois agendamentos ativos sobrepostos para o mesmo profissional
    const ativos = ags.docs.map((a) => ({ id: a.id, ...a.data() })).filter((a) => ['confirmado', 'sinal_informado'].includes(a.status) && a.dataChave >= hoje);
    const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    for (let i = 0; i < ativos.length; i++) for (let j = i + 1; j < ativos.length; j++) {
      const a = ativos[i], b = ativos[j];
      if (a.profissionalId === b.profissionalId && a.dataChave === b.dataChave && min(a.horario) < min(b.horario) + b.duracaoMin && min(b.horario) < min(a.horario) + a.duracaoMin) {
        ach('ERRO', slug, `conflito de horário: ${a.id} e ${b.id} em ${a.dataChave} (${a.horario} / ${b.horario})`);
      }
    }
    console.log(`   agendamentos futuros confirmados: ${futuros}`);

    disp.docs.forEach((d) => {
      const u = d.data().uid;
      if (u && !membros.some((m) => m.uid === u)) ach('AVISO', slug, `aparelho ${d.id} de login que não está mais no negócio (${u})`);
      if (!d.data().token) ach('AVISO', slug, `aparelho ${d.id} sem token`);
    });
    conv.docs.forEach((c) => { if (!c.data().usado && Date.parse(c.data().expiraEm) < Date.now()) ach('INFO', slug, `convite vencido sem uso para ${c.data().email} (pode ser apagado)`); });
    recs.docs.forEach((r) => { const d = r.data(); if (d.ativa && !profIds.has(d.profissionalId)) ach('AVISO', slug, `horário fixo de ${d.clienteNome} com profissional inexistente`); });

    const s = info.sinal || {};
    if (s.ativo && (!s.chavePix || !s.nomeRecebedor)) ach('ERRO', slug, 'sinal por Pix ligado sem chave/nome de quem recebe');
    if (!info.horarioFuncionamento) ach('ERRO', slug, 'sem horário de funcionamento');
    if (info.status === 'trial' && info.trialFim && Date.parse(info.trialFim) < Date.now()) ach('AVISO', slug, `trial vencido em ${info.trialFim}`);
  }

  const ordem = { ERRO: 0, AVISO: 1, INFO: 2 };
  achados.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  console.log('\n===== ACHADOS =====');
  if (!achados.length) console.log('Nenhuma inconsistência encontrada.');
  achados.forEach((a) => console.log(`[${a.nivel}] ${a.negocio}: ${a.msg}`));
  console.log(`\nTotal: ${achados.filter((a) => a.nivel === 'ERRO').length} erro(s), ${achados.filter((a) => a.nivel === 'AVISO').length} aviso(s), ${achados.filter((a) => a.nivel === 'INFO').length} info.`);
  process.exit(0);
})().catch((e) => { console.error('falhou:', e.message); process.exit(1); });
