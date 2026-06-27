// ========================================
// 77 AGENDAPRO — API: Enviar notificação push
// Vercel Serverless Function (Node.js)
// ========================================

const admin = require('firebase-admin');

// Inicializa o Firebase Admin apenas uma vez (evita erro em reuso de instância)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // O Vercel armazena quebras de linha como "\n" literal — precisa converter de volta
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    })
  });
}

// Ícone institucional 77 IS (coral) — sempre o mesmo, independente do estabelecimento
const ICONE_77 = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#fb6464"/><text x="50" y="68" font-family="sans-serif" font-weight="800" font-size="48" text-anchor="middle" fill="#0a0a0a">77</text></svg>'
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { token, corpo } = req.body || {};

  if (!token || !corpo) {
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: token, corpo' });
  }

  try {
    await admin.messaging().send({
      token,
      notification: {
        title: '77 AgendaPro',
        body: corpo
      },
      webpush: {
        notification: {
          icon: ICONE_77,
          badge: ICONE_77
        }
      }
    });

    return res.status(200).json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao enviar notificação:', err);
    return res.status(500).json({ erro: 'Falha ao enviar notificação', detalhes: err.message });
  }
};
