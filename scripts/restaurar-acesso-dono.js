// Diagnostica e (opcionalmente) restaura o acesso de DONO de um login: usuarios/{uid}.
// Útil quando o documento ficou com permissões reduzidas (campo `permissoes` com verTodos/gerirNegocio falso,
// `role` diferente de owner, ou `profissionalId` indevido) e o painel nega a leitura (permission-denied).
//
// Uso (só mostra, não altera nada):  node scripts/restaurar-acesso-dono.js seu@email.com
// Uso (aplica a correção):           node scripts/restaurar-acesso-dono.js seu@email.com --aplicar
// Requer scripts/serviceAccountKey.json (fora do git).
//
// A correção: role = 'owner' e remove `permissoes` e `profissionalId` (conta sem `permissoes` = acesso total).
// Mantém barbeariaId, nome e e-mail. Nunca cria o documento e nunca troca o negócio vinculado.

const path = require('path');
const admin = require('firebase-admin');

const email = String(process.argv[2] || '').trim().toLowerCase();
const aplicar = process.argv.includes('--aplicar');
if (!email || !email.includes('@')) { console.error('Informe o e-mail do dono. Ex.: node scripts/restaurar-acesso-dono.js seu@email.com'); process.exit(1); }

const app = admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json')))
});

(async () => {
  const user = await admin.auth(app).getUserByEmail(email);
  const ref = admin.firestore(app).collection('usuarios').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) { console.error(`❌ Não existe usuarios/${user.uid}. Nada a restaurar (e este script não cria o documento).`); process.exit(1); }
  const d = snap.data();
  console.log(`usuarios/${user.uid} (${email}) — situação atual:`);
  console.log(JSON.stringify({ role: d.role, barbeariaId: d.barbeariaId, permissoes: d.permissoes, profissionalId: d.profissionalId }, null, 2));

  const ok = d.role === 'owner' && d.permissoes === undefined && d.profissionalId === undefined;
  if (ok) { console.log('✅ Já está como dono com acesso total. O problema NÃO é este documento.'); return; }
  if (!aplicar) { console.log('\n⚠️  Acesso reduzido. Rode de novo com --aplicar para restaurar.'); return; }

  await ref.update({
    role: 'owner',
    permissoes: admin.firestore.FieldValue.delete(),
    profissionalId: admin.firestore.FieldValue.delete()
  });
  const depois = (await ref.get()).data();
  console.log('\n✅ Restaurado:', JSON.stringify({ role: depois.role, barbeariaId: depois.barbeariaId, permissoes: depois.permissoes, profissionalId: depois.profissionalId }));
})().catch((e) => { console.error('❌', e.code || '', e.message); process.exit(1); });
