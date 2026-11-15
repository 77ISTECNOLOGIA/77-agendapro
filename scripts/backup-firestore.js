// Backup LOCAL e gratuito do Firestore: grava um JSON com todos os negócios (e sub-coleções), usuários e logs.
// SOMENTE LEITURA no banco. Uso: node scripts/backup-firestore.js        → backups/AAAA-MM-DD_HHMM.json
// Requer scripts/serviceAccountKey.json (fora do git). A pasta backups/ também fica fora do git (tem dados de clientes).
// Guarde uma cópia fora deste computador (ex.: nuvem pessoal). Para restaurar um negócio, use o JSON como fonte
// (não há script de restauração automática de propósito: restaurar deve ser decisão consciente).

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore(app);

const SUBCOLECOES = ['servicos', 'profissionais', 'clientes', 'agendamentos', 'dispositivos', 'recorrencias', 'convites'];

(async () => {
  const dump = { geradoEm: new Date().toISOString(), projeto: 'agendapro-179cb', colecoes: {} };
  const raiz = async (nome) => {
    const snap = await db.collection(nome).get();
    dump.colecoes[nome] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    return snap;
  };
  await raiz('usuarios'); await raiz('admins77'); await raiz('cadastrosAguardando'); await raiz('logs77');
  const negocios = await raiz('barbearias');
  dump.subcolecoes = {};
  for (const n of negocios.docs) {
    dump.subcolecoes[n.id] = {};
    for (const sub of SUBCOLECOES) {
      const s = await n.ref.collection(sub).get();
      dump.subcolecoes[n.id][sub] = Object.fromEntries(s.docs.map((d) => [d.id, d.data()]));
    }
  }
  const pasta = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(pasta, { recursive: true });
  const agora = new Date();
  const nome = `${agora.toISOString().slice(0, 10)}_${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}.json`;
  fs.writeFileSync(path.join(pasta, nome), JSON.stringify(dump, null, 1));
  const resumo = Object.entries(dump.subcolecoes).map(([slug, s]) => `${slug}: ` + Object.entries(s).map(([k, v]) => `${Object.keys(v).length} ${k}`).join(', '));
  console.log('Backup gravado em backups/' + nome);
  console.log(resumo.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('falhou:', e.message); process.exit(1); });
