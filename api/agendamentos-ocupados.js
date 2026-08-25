// ========================================
// 77 AGENDAPRO — API: Ocupação de horários (sem dados de cliente)
// Vercel Serverless Function (Node.js)
// ========================================
// O front-end público precisa saber quais horários já estão ocupados
// para calcular a disponibilidade, mas não precisa (e não deve) receber
// nome/WhatsApp dos clientes de outros agendamentos. Esta função lê o
// agendamentos completo via Admin SDK e devolve só os campos
// necessários para o cálculo de disponibilidade.

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
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { slug } = req.query || {};
  if (!slug) {
    return res.status(400).json({ erro: 'Parâmetro obrigatório: slug' });
  }

  try {
    const snap = await admin.database().ref(`barbearias/${slug}/agendamentos`).once('value');
    const agendamentos = snap.val() || {};

    const ocupados = Object.entries(agendamentos).map(([id, a]) => ({
      id,
      profissionalId: a.profissionalId,
      dataChave: a.dataChave,
      horario: a.horario,
      duracaoMin: a.duracaoMin,
      status: a.status
    }));

    return res.status(200).json({ ocupados });
  } catch (err) {
    console.error('Erro ao buscar ocupação:', err);
    return res.status(500).json({ erro: 'Falha ao buscar ocupação', detalhes: err.message });
  }
};
