// ========================================
// 77 AGENDAPRO — API: Excluir negócio definitivamente (só super-admin)
// Vercel Serverless Function (Node.js)
// ========================================
// IRREVERSÍVEL. O Firestore não apaga em cascata, então isto remove:
//   - o negócio e TODAS as sub-coleções (serviços, profissionais, clientes,
//     agendamentos, dispositivos de notificação) via recursiveDelete;
//   - o registro na fila de novos cadastros;
//   - o vínculo dono→negócio (usuarios/{uid});
//   - opcionalmente o LOGIN do dono (Firebase Authentication), liberando o
//     e-mail pra um novo cadastro.
//
// Travas (todas validadas AQUI, não só na tela):
//   1. token do Firebase verificado + admins77/{uid}.role == 'super_admin';
//   2. o negócio precisa estar SUSPENSO (passo intermediário obrigatório);
//   3. quem chama precisa digitar o link (slug) do negócio como confirmação;
//   4. nunca apaga o login de um super-admin nem o de quem está chamando;
//   5. fica registrado em logs77 (quem, qual negócio, quando, contagens — sem
//      nenhum dado pessoal dos clientes).

const { db, auth } = require('./_lib/firebase');
const { slugValido } = require('./_lib/negocio');
const { dentroDoLimite, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');

async function contar(ref) {
  return (await ref.count().get()).data().count;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'excluir-negocio', 10, 3600000)) return responder(res, 429, { erro: 'Muitas requisições. Tente mais tarde.' });

  const { idToken, slug: slugRaw, confirmacao, apagarLogins } = corpoDe(req);
  const slug = String(slugRaw || '').toLowerCase();

  if (!idToken) return responder(res, 401, { erro: 'Sessão inválida. Entre novamente.' });
  if (!slugValido(slug)) return responder(res, 400, { erro: 'Negócio inválido' });
  if (String(confirmacao || '').trim() !== slug) {
    return responder(res, 400, { erro: 'A confirmação não confere. Digite exatamente o link do negócio.' });
  }

  try {
    const firestore = db();

    // 1. Só super-admin
    let decoded;
    try { decoded = await auth().verifyIdToken(String(idToken)); }
    catch (_) { throw new ErroNegocio(401, 'Sessão inválida. Entre novamente.'); }
    const adminData = (await firestore.collection('admins77').doc(decoded.uid).get()).data();
    if (!adminData || adminData.role !== 'super_admin') throw new ErroNegocio(403, 'Sem permissão de super-admin');

    // 2. O negócio existe e está suspenso
    const negocioRef = firestore.collection('barbearias').doc(slug);
    const negocioSnap = await negocioRef.get();
    if (!negocioSnap.exists) throw new ErroNegocio(404, 'Negócio não encontrado');
    const negocio = negocioSnap.data();
    if (negocio.status !== 'suspensa') {
      throw new ErroNegocio(409, 'Suspenda o negócio antes de excluir. A exclusão só é permitida para negócios suspensos.');
    }

    // Contagens pro registro (antes de apagar)
    const resumo = {
      agendamentos: await contar(negocioRef.collection('agendamentos')),
      clientes: await contar(negocioRef.collection('clientes')),
      servicos: await contar(negocioRef.collection('servicos')),
      profissionais: await contar(negocioRef.collection('profissionais')),
      loginsApagados: 0
    };

    // Donos vinculados a este negócio
    const donosSnap = await firestore.collection('usuarios').where('barbeariaId', '==', slug).get();
    const donos = donosSnap.docs.map((d) => d.id);

    // 3. Apaga o negócio e tudo que há dentro dele
    await firestore.recursiveDelete(negocioRef);
    await firestore.collection('cadastrosAguardando').doc(slug).delete();
    for (const d of donosSnap.docs) await d.ref.delete();

    // 4. Logins dos donos (opcional), com as proteções
    const avisos = [];
    if (apagarLogins) {
      for (const uid of donos) {
        if (uid === decoded.uid) { avisos.push('O login de quem executou a exclusão foi mantido.'); continue; }
        const ehAdmin = (await firestore.collection('admins77').doc(uid).get()).exists;
        if (ehAdmin) { avisos.push('Um login de super-admin foi mantido.'); continue; }
        try { await auth().deleteUser(uid); resumo.loginsApagados++; }
        catch (e) {
          if (e && e.code === 'auth/user-not-found') continue;
          console.error('Falha ao apagar login do dono:', e);
          avisos.push('Não foi possível apagar um dos logins. Apague pelo Firebase Console se necessário.');
        }
      }
    }

    // 5. Registro de auditoria (sem dados pessoais de clientes)
    try {
      await firestore.collection('logs77').doc().set({
        acao: 'excluiu',
        alvoId: slug,
        alvoNome: negocio.nome || slug,
        admin: decoded.uid,
        adminNome: adminData.nome || decoded.email || 'admin',
        timestamp: new Date().toISOString(),
        resumo
      });
    } catch (e) { console.error('Falha ao registrar a exclusão no log:', e); }

    return responder(res, 200, { sucesso: true, resumo, avisos });
  } catch (err) {
    return tratarErro(res, err, 'excluir-negocio');
  }
};
