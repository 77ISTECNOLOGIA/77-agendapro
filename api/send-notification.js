// ========================================
// 77 AGENDAPRO — API: Enviar notificação push
// Vercel Serverless Function (Node.js)
// ========================================
// Quem chama esta função é o cliente final anônimo, logo após concluir um
// agendamento (sem login). Por isso o servidor nunca confia em "token"/"corpo"
// vindos do navegador — eles seriam livremente falsificáveis por qualquer um
// que soubesse a URL. Em vez disso, recebe só a referência do agendamento
// (slug + agendamentoId), busca o registro real no Realtime Database e monta
// a mensagem e a lista de dispositivos a partir desse dado confiável.

const admin = require('firebase-admin');

// Inicializa o Firebase Admin apenas uma vez (evita erro em reuso de instância)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // O Vercel armazena quebras de linha como "\n" literal — precisa converter de volta
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    }),
    databaseURL: 'https://agendapro-179cb-default-rtdb.firebaseio.com'
  });
}

// Ícone institucional 77 IS (coral) — sempre o mesmo, independente do estabelecimento
const ICONE_77 = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#fb6464"/><text x="50" y="68" font-family="sans-serif" font-weight="800" font-size="48" text-anchor="middle" fill="#0a0a0a">77</text></svg>'
);

const DIAS_SEMANA_ABREV = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function montarCorpo(agendamento) {
  const [ano, mes, dia] = String(agendamento.dataChave || '').split('-').map(Number);
  const dataObj = ano ? new Date(ano, mes - 1, dia) : null;
  const dataStr = dataObj ? `${DIAS_SEMANA_ABREV[dataObj.getDay()]} ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}` : '';
  const servicosStr = (agendamento.servicos || []).map(s => s.nome).join(' + ');
  const primeiroNomeCliente = String(agendamento.clienteNome || '').split(' ')[0];
  const primeiroNomeProf = String(agendamento.profissionalNome || '').split(' ')[0];
  return `${primeiroNomeCliente} — ${dataStr} às ${agendamento.horario} — ${servicosStr} com ${primeiroNomeProf}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const { slug, agendamentoId } = req.body || {};

  if (!slug || !agendamentoId) {
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: slug, agendamentoId' });
  }

  try {
    const db = admin.database();

    const agSnap = await db.ref(`barbearias/${slug}/agendamentos/${agendamentoId}`).once('value');
    const agendamento = agSnap.val();
    if (!agendamento) {
      return res.status(404).json({ erro: 'Agendamento não encontrado' });
    }

    // Idempotência: evita reenviar a mesma notificação varias vezes para o mesmo agendamento
    if (agendamento.notificacaoEnviada) {
      return res.status(200).json({ sucesso: true, jaEnviada: true });
    }

    const tokensSnap = await db.ref(`barbearias/${slug}/info/fcmTokens`).once('value');
    if (!tokensSnap.exists()) {
      return res.status(200).json({ sucesso: true, semTokens: true });
    }
    const tokens = Object.values(tokensSnap.val());
    const corpo = montarCorpo(agendamento);

    await Promise.allSettled(
      tokens.map(token => admin.messaging().send({
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
      }))
    );

    await db.ref(`barbearias/${slug}/agendamentos/${agendamentoId}/notificacaoEnviada`).set(true);

    return res.status(200).json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao enviar notificação:', err);
    return res.status(500).json({ erro: 'Falha ao enviar notificação', detalhes: err.message });
  }
};
