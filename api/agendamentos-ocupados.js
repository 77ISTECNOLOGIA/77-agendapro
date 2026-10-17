// ========================================
// 77 AGENDAPRO — API: Ocupação de horários (sem dados de cliente)
// Vercel Serverless Function (Node.js)
// ========================================
// Usada pelo link público só para REVALIDAR a grade antes de confirmar
// (a primeira carga já vem em /api/negocio). Lê apenas de hoje em diante —
// o histórico do negócio cresce sem limite e não interessa pra disponibilidade.

const { db } = require('./_lib/firebase');
const { hojeChaveBrasil } = require('./_lib/tempo');
const { slugValido } = require('./_lib/negocio');
const { dentroDoLimite, responder, tratarErro } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'ocupados', 90, 60000)) return responder(res, 429, { erro: 'Muitas requisições. Aguarde um instante.' });

  const slug = String((req.query && req.query.slug) || '').toLowerCase();
  if (!slugValido(slug)) return responder(res, 400, { erro: 'Parâmetro obrigatório: slug' });

  try {
    const snap = await db().collection('barbearias').doc(slug).collection('agendamentos')
      .where('dataChave', '>=', hojeChaveBrasil()).get();

    const ocupados = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((a) => a.status !== 'cancelado')
      .map((a) => ({
        id: a.id,
        profissionalId: a.profissionalId,
        dataChave: a.dataChave,
        horario: a.horario,
        duracaoMin: a.duracaoMin,
        status: a.status
      }));

    return responder(res, 200, { ocupados });
  } catch (err) {
    return tratarErro(res, err, 'agendamentos-ocupados');
  }
};
