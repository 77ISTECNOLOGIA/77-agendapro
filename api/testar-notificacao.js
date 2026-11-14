// ========================================
// 77 AGENDAPRO — API: Notificação de TESTE para os aparelhos do dono
// Vercel Serverless Function (Node.js)
// ========================================
// Botão "Enviar notificação de teste" em Configurações. Deixa o dono conferir, aparelho
// por aparelho, se o aviso chega — sem precisar fazer um agendamento de mentira.
// Só o próprio dono do negócio (token do Firebase verificado + usuarios/{uid}) consegue usar,
// e só envia para os aparelhos DELE.

const { db, auth } = require('./_lib/firebase');
const { dentroDoLimite, dentroDoLimitePorChave, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');
const { enviarParaDispositivos } = require('./_lib/notificar');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'testar-notificacao', 20, 3600000)) return responder(res, 429, { erro: 'Muitas requisições. Tente mais tarde.' });

  const { idToken } = corpoDe(req);
  if (!idToken) return responder(res, 401, { erro: 'Sessão inválida. Entre novamente.' });

  try {
    let decoded;
    try { decoded = await auth().verifyIdToken(String(idToken)); }
    catch (_) { throw new ErroNegocio(401, 'Sessão inválida. Entre novamente.'); }

    if (!dentroDoLimitePorChave(`teste-notif:${decoded.uid}`, 10, 600000)) {
      throw new ErroNegocio(429, 'Você já enviou vários testes. Aguarde alguns minutos.');
    }

    const firestore = db();
    const vinculo = (await firestore.collection('usuarios').doc(decoded.uid).get()).data();
    if (!vinculo || !vinculo.barbeariaId) throw new ErroNegocio(403, 'Sua conta não está ligada a um negócio.');
    if (!require('./_lib/equipe').permissoesDe(vinculo).verTodos) throw new ErroNegocio(403, 'Você não tem permissão para testar notificações.');

    const negocioRef = firestore.collection('barbearias').doc(vinculo.barbeariaId);
    const r = await enviarParaDispositivos(negocioRef, {
      titulo: '77 AgendaPro — teste',
      corpo: 'Tudo certo! As notificações estão funcionando neste aparelho. 🎉',
      tag: `teste-${Date.now()}`,
      dados: { tipo: 'teste' }
    });

    return responder(res, 200, { sucesso: true, total: r.total, enviadas: r.enviadas, removidos: r.removidos, erros: r.erros });
  } catch (err) {
    return tratarErro(res, err, 'testar-notificacao');
  }
};
