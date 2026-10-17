// ========================================
// 77 AGENDAPRO — API: Criar acesso do dono (automatiza Firebase Console)
// Vercel Serverless Function (Node.js)
// ========================================
// Só super-admin da 77 IS chama (token verificado no servidor).

const { db, auth } = require('./_lib/firebase');
const { slugValido } = require('./_lib/negocio');
const { dentroDoLimite, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'criar-usuario', 20, 3600000)) return responder(res, 429, { erro: 'Muitas requisições.' });

  const { idToken, email, senha, nome, barbeariaId } = corpoDe(req);

  if (!idToken || !email || !senha || !barbeariaId) {
    return responder(res, 400, { erro: 'Parâmetros obrigatórios: idToken, email, senha, barbeariaId' });
  }
  if (typeof senha !== 'string' || senha.length < 6) {
    return responder(res, 400, { erro: 'A senha precisa ter pelo menos 6 caracteres' });
  }
  if (!slugValido(String(barbeariaId))) return responder(res, 400, { erro: 'Negócio inválido' });

  try {
    const firestore = db();

    // 1. Confirma que quem está chamando é mesmo um super-admin da 77 IS
    const decoded = await auth().verifyIdToken(idToken);
    const adminData = (await firestore.collection('admins77').doc(decoded.uid).get()).data();
    if (!adminData || adminData.role !== 'super_admin') {
      throw new ErroNegocio(403, 'Sem permissão de super-admin');
    }

    // 2. Confirma que o negócio existe
    const negocioSnap = await firestore.collection('barbearias').doc(barbeariaId).get();
    if (!negocioSnap.exists) throw new ErroNegocio(404, 'Negócio não encontrado');

    // 3. Cria o usuário no Firebase Authentication
    const userRecord = await auth().createUser({
      email,
      password: senha,
      displayName: nome || undefined
    });

    // 4. Cria o vínculo dono ↔ negócio no Firestore
    await firestore.collection('usuarios').doc(userRecord.uid).set({
      email,
      nome: nome || email,
      barbeariaId,
      role: 'owner',
      precisaOnboarding: false
    });

    return responder(res, 200, { sucesso: true, uid: userRecord.uid });
  } catch (err) {
    if (err instanceof ErroNegocio) return tratarErro(res, err, 'criar-usuario');
    console.error('Erro ao criar usuário:', err);
    let msg = 'Erro ao criar acesso.';
    let status = 500;
    if (err.code === 'auth/email-already-exists') { msg = 'Esse email já está cadastrado em outro acesso.'; status = 409; }
    else if (err.code === 'auth/invalid-password' || err.code === 'auth/weak-password') { msg = 'Senha inválida (mínimo 6 caracteres).'; status = 400; }
    else if (err.code === 'auth/invalid-email') { msg = 'Email inválido.'; status = 400; }
    else if (err.code && String(err.code).startsWith('auth/id-token')) { msg = 'Sessão expirada. Entre novamente.'; status = 401; }
    return responder(res, status, { erro: msg });
  }
};
