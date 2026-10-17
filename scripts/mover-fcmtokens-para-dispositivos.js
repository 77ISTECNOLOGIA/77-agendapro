// Move os tokens de notificação push do campo antigo `fcmTokens` (dentro do
// documento do negócio, que era legível publicamente) para a sub-coleção
// privada barbearias/{slug}/dispositivos/{deviceId}.
//
// Idempotente e NÃO destrutivo antes da conferência: copia, confere que todos
// os tokens chegaram no destino e só então remove o campo antigo. Não mexe em
// nenhum outro dado (diferente de migrar-rtdb-para-firestore.js, que
// sobrescreve com os dados do banco antigo e NÃO deve ser re-executado depois
// do corte).
//
// Uso:  node scripts/mover-fcmtokens-para-dispositivos.js
// Requer scripts/serviceAccountKey.json (fora do git).

const path = require('path');
const admin = require('firebase-admin');

const app = admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json')))
});
const db = admin.firestore(app);

(async () => {
  const negocios = await db.collection('barbearias').get();
  let movidos = 0;

  for (const negocio of negocios.docs) {
    const tokens = negocio.data().fcmTokens;
    if (!tokens || !Object.keys(tokens).length) continue;

    const destino = negocio.ref.collection('dispositivos');
    for (const [deviceId, token] of Object.entries(tokens)) {
      await destino.doc(deviceId).set({ token, atualizadoEm: new Date().toISOString() }, { merge: true });
    }

    // Conferência antes de apagar o campo antigo
    const gravados = await destino.get();
    const faltando = Object.keys(tokens).filter((id) => !gravados.docs.some((d) => d.id === id));
    if (faltando.length) {
      console.log(`⚠️  ${negocio.id}: ${faltando.length} token(s) não chegaram no destino — campo antigo mantido.`);
      continue;
    }

    await negocio.ref.update({ fcmTokens: admin.firestore.FieldValue.delete() });
    movidos += Object.keys(tokens).length;
    console.log(`✅ ${negocio.id}: ${Object.keys(tokens).length} token(s) movido(s)`);
  }

  console.log(movidos ? `\nConcluído: ${movidos} token(s) movido(s).` : '\nNada a mover.');
  process.exit(0);
})().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
