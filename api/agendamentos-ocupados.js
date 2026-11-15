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
const { ocupaHorario } = require('./_lib/sinal');
const { comCache } = require('./_lib/cache');

// Resposta guardada por poucos segundos (api/_lib/cache.js): rota pública, cota de leituras do Firestore é limitada.
// Quem agenda/cancela/remarca invalida (api/criar-agendamento.js, api/agendamento-cliente.js); o servidor decide o horário de verdade.
const TTL_OCUPADOS_MS = 5000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'ocupados', 90, 60000)) return responder(res, 429, { erro: 'Muitas requisições. Aguarde um instante.' });

  const slug = String((req.query && req.query.slug) || '').toLowerCase();
  if (!slugValido(slug)) return responder(res, 400, { erro: 'Parâmetro obrigatório: slug' });

  try {
    // Com ?profissionalId=, lê só os agendamentos DESSE profissional (usa o índice composto profissionalId+dataChave de
    // firestore.indexes.json); se o índice ainda não existir, cai para a consulta geral (mais leituras, mas funciona).
    const pedido = String((req.query && req.query.profissionalId) || '');
    const profissionalId = pedido && pedido.length <= 64 && !pedido.includes('/') ? pedido : '';   // valor suspeito = consulta geral
    const ocupados = await comCache('ocupados:' + slug + ':' + profissionalId, TTL_OCUPADOS_MS, () => buscarOcupados(slug, profissionalId));
    return responder(res, 200, { ocupados });
  } catch (err) {
    return tratarErro(res, err, 'agendamentos-ocupados');
  }
};

async function buscarOcupados(slug, profissionalId) {
    const agsRef = db().collection('barbearias').doc(slug).collection('agendamentos');
    const hoje = hojeChaveBrasil();
    let snap;
    if (profissionalId) {
      try { snap = await agsRef.where('profissionalId', '==', profissionalId).where('dataChave', '>=', hoje).get(); }
      catch (err) { console.error('Consulta por profissional indisponível, usando a geral:', err && err.code); }
    }
    if (!snap) snap = await agsRef.where('dataChave', '>=', hoje).get();

    return snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((a) => ocupaHorario(a) && (!profissionalId || a.profissionalId === profissionalId))
      .map((a) => ({
        id: a.id,
        profissionalId: a.profissionalId,
        dataChave: a.dataChave,
        horario: a.horario,
        duracaoMin: a.duracaoMin,
        status: a.status
      }));
}
