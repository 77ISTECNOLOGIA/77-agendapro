// ========================================
// 77 AGENDAPRO — API: Criar acesso do dono (automatiza Firebase Console)
// Vercel Serverless Function (Node.js)
// ========================================

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    }),
    databaseURL: 'https://agendapro-179cb-default-rtdb.firebaseio.com'
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { idToken, email, senha, nome, barbeariaId } = req.body || {};

  if (!idToken || !email || !senha || !barbeariaId) {
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: idToken, email, senha, barbeariaId' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
  }

  try {
    // 1. Confirma que quem está chamando é mesmo um super-admin da 77 IS
    const decoded = await admin.auth().verifyIdToken(idToken);
    const adminSnap = await admin.database().ref(`admins77/${decoded.uid}`).once('value');
    const adminData = adminSnap.val();
    if (!adminData || adminData.role !== 'super_admin') {
      return res.status(403).json({ erro: 'Sem permissão de super-admin' });
    }

    // 2. Confirma que o negócio existe
    const negocioSnap = await admin.database().ref(`barbearias/${barbeariaId}/info`).once('value');
    if (!negocioSnap.exists()) {
      return res.status(404).json({ erro: 'Negócio não encontrado' });
    }

    // 3. Cria o usuário no Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email,
      password: senha,
      displayName: nome || undefined
    });

    // 4. Cria o vínculo dono ↔ negócio no Realtime Database
    await admin.database().ref(`usuarios/${userRecord.uid}`).set({
      email,
      nome: nome || email,
      barbeariaId,
      role: 'owner',
      precisaOnboarding: false
    });

    return res.status(200).json({ sucesso: true, uid: userRecord.uid });
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    let msg = 'Erro ao criar acesso.';
    if (err.code === 'auth/email-already-exists') msg = 'Esse email já está cadastrado em outro acesso.';
    else if (err.code === 'auth/invalid-password' || err.code === 'auth/weak-password') msg = 'Senha inválida (mínimo 6 caracteres).';
    else if (err.code === 'auth/invalid-email') msg = 'Email inválido.';
    return res.status(500).json({ erro: msg, detalhes: err.message });
  }
};
