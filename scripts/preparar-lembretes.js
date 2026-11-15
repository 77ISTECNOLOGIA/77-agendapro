// Prepara o lembrete push ao cliente nos agendamentos que JÁ existiam (criados antes desse recurso). Idempotente.
// Uso (só mostra):  node scripts/preparar-lembretes.js
// Uso (aplica):     node scripts/preparar-lembretes.js --aplicar        (requer scripts/serviceAccountKey.json)
// Marca `lembreteAppEm` em todo agendamento confirmado, de hoje em diante, que ainda não tem a marca nem foi avisado.
// Os novos agendamentos já nascem com a marca (api/criar-agendamento.js, painel do dono, horários fixos e remarcações).

const path = require('path');
const admin = require('firebase-admin');
const aplicar = process.argv.includes('--aplicar');
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore();
const { minutosLembrete, calcularLembreteAppEm } = require('../api/_lib/lembrete');
const { hojeChaveBrasil } = require('../api/_lib/tempo');

(async () => {
  console.log(aplicar ? 'APLICANDO\n' : 'SIMULAÇÃO (use --aplicar para gravar)\n');
  const hoje = hojeChaveBrasil();
  let total = 0;
  const negocios = await db.collection('barbearias').get();
  for (const n of negocios.docs) {
    const min = minutosLembrete(n.data());
    if (!min) { console.log(`${n.id}: lembrete desligado`); continue; }
    const ags = await n.ref.collection('agendamentos').where('dataChave', '>=', hoje).get();
    const alvo = ags.docs.filter((d) => { const a = d.data(); return a.status === 'confirmado' && !a.lembreteAppEm && !a.lembreteAppEnviadoEm; });
    console.log(`${n.id}: ${alvo.length} agendamento(s) a preparar`);
    total += alvo.length;
    if (aplicar) for (const d of alvo) await d.ref.update({ lembreteAppEm: calcularLembreteAppEm(d.data().dataChave, d.data().horario, min) });
  }
  console.log(`\n${total} agendamento(s) ${aplicar ? 'preparado(s)' : 'a preparar'}.`);
  process.exit(0);
})().catch((e) => { console.error('falhou:', e.message); process.exit(1); });
