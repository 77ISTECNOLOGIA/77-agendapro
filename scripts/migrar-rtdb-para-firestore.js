// Migra os dados reais do Realtime Database pra Firestore. Idempotente
// (upsert) — seguro rodar em modo seco dias antes do corte e rodar de novo
// na hora, pra pegar mudanças de última hora.
//
// Uso:
//   node scripts/migrar-rtdb-para-firestore.js
//
// Pre-requisito: scripts/serviceAccountKey.json (baixado em Firebase Console >
// Configurações do projeto 77-agendapro > Contas de serviço > Gerar nova
// chave privada). Esse arquivo NÃO deve ser commitado no git (já está no
// .gitignore).

const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

const app = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: 'https://agendapro-179cb-default-rtdb.firebaseio.com',
});
const rtdb = getDatabase(app);
const db = getFirestore(app);

// Escreve em lotes de até 400 operações (limite do Firestore é 500 por
// batch; 400 dá folga).
async function commitEmLotes(operacoes) {
  for (let i = 0; i < operacoes.length; i += 400) {
    const lote = db.batch();
    operacoes.slice(i, i + 400).forEach((op) => op(lote));
    await lote.commit();
  }
  return operacoes.length;
}

(async () => {
  console.log('Lendo árvore completa do Realtime Database...');
  const snap = await rtdb.ref('/').once('value');
  const raiz = snap.val() || {};

  const contagens = {};

  // admins77, usuarios, cadastrosAguardando, logs77 — cópia direta
  const colecoesSimples = ['admins77', 'usuarios', 'cadastrosAguardando', 'logs77'];
  for (const nome of colecoesSimples) {
    const ops = [];
    Object.entries(raiz[nome] || {}).forEach(([id, dados]) => {
      ops.push((batch) => batch.set(db.collection(nome).doc(id), dados, { merge: true }));
    });
    const origem = Object.keys(raiz[nome] || {}).length;
    const gravados = await commitEmLotes(ops);
    contagens[nome] = { origem, gravados };
  }

  // barbearias/{slug} — doc principal = campos de "info" achatados direto
  // no documento (sem sub-nó); servicos/profissionais/clientes/agendamentos
  // viram sub-coleções, cada doc preservando o mesmo ID que tinha no RTDB.
  const slugs = Object.keys(raiz.barbearias || {});
  let totalServicos = 0, servicosGravados = 0;
  let totalProfs = 0, profsGravados = 0;
  let totalClientes = 0, clientesGravados = 0;
  let totalAgs = 0, agsGravados = 0;

  for (const slug of slugs) {
    const negocioRaw = raiz.barbearias[slug] || {};
    const info = negocioRaw.info || {};

    await db.collection('barbearias').doc(slug).set(info, { merge: true });

    const subcolecoes = [
      { chave: 'servicos', contarTotal: (n) => { totalServicos += n; }, contarGravado: (n) => { servicosGravados += n; } },
      { chave: 'profissionais', contarTotal: (n) => { totalProfs += n; }, contarGravado: (n) => { profsGravados += n; } },
      { chave: 'clientes', contarTotal: (n) => { totalClientes += n; }, contarGravado: (n) => { clientesGravados += n; } },
      { chave: 'agendamentos', contarTotal: (n) => { totalAgs += n; }, contarGravado: (n) => { agsGravados += n; } },
    ];

    for (const { chave, contarTotal, contarGravado } of subcolecoes) {
      const itens = Object.entries(negocioRaw[chave] || {});
      contarTotal(itens.length);
      const ops = itens.map(([id, dados]) => (batch) =>
        batch.set(db.collection('barbearias').doc(slug).collection(chave).doc(id), dados, { merge: true })
      );
      contarGravado(await commitEmLotes(ops));
    }
  }

  contagens.barbearias = { origem: slugs.length, gravados: slugs.length };
  contagens.servicos = { origem: totalServicos, gravados: servicosGravados };
  contagens.profissionais = { origem: totalProfs, gravados: profsGravados };
  contagens.clientes = { origem: totalClientes, gravados: clientesGravados };
  contagens.agendamentos = { origem: totalAgs, gravados: agsGravados };

  console.log('\nConferência (origem RTDB vs. gravado no Firestore):');
  Object.entries(contagens).forEach(([nome, { origem, gravados }]) => {
    const ok = origem === gravados ? '✅' : '⚠️';
    console.log(`  ${ok} ${nome}: ${gravados}/${origem}`);
  });
  console.log('\nMigração concluída.');
})().catch((e) => {
  console.error('Erro na migração:', e);
  process.exit(1);
});
