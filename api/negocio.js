// ========================================
// 77 AGENDAPRO — API: Dados públicos do negócio (leitura do visitante)
// Vercel Serverless Function (Node.js)
// ========================================
// O Firestore não tem mais NENHUMA leitura pública (firestore.rules). O link
// público do cliente lê tudo por aqui, já filtrado: sem comissão dos
// profissionais, sem tokens de notificação, sem dados de outros clientes.
// Também devolve a ocupação futura (sem PII) pra poupar uma segunda chamada.

const { db } = require('./_lib/firebase');
const { hojeChaveBrasil } = require('./_lib/tempo');
const {
  slugValido, situacaoNegocio, infoPublica, profissionalPublico, servicoPublico
} = require('./_lib/negocio');
const { dentroDoLimite, responder, tratarErro } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'negocio', 90, 60000)) return responder(res, 429, { erro: 'Muitas requisições. Aguarde um instante.' });

  const slug = String((req.query && req.query.slug) || '').toLowerCase();
  if (!slugValido(slug)) return responder(res, 400, { erro: 'Link inválido' });

  try {
    const negocioRef = db().collection('barbearias').doc(slug);
    const hoje = hojeChaveBrasil();

    const [infoSnap, servicosSnap, profsSnap, ocupadosSnap] = await Promise.all([
      negocioRef.get(),
      negocioRef.collection('servicos').get(),
      negocioRef.collection('profissionais').get(),
      negocioRef.collection('agendamentos').where('dataChave', '>=', hoje).get()
    ]);

    if (!infoSnap.exists) return responder(res, 404, { erro: 'Negócio não encontrado' });

    const info = infoSnap.data();
    const situacao = situacaoNegocio(info);

    const servicos = {};
    servicosSnap.docs.forEach((d) => { servicos[d.id] = servicoPublico(d.id, d.data()); });

    const profissionais = {};
    profsSnap.docs.forEach((d) => { profissionais[d.id] = profissionalPublico(d.id, d.data(), hoje); });

    const ocupados = ocupadosSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => a.status !== 'cancelado')
      .map((a) => ({
        id: a.id,
        profissionalId: a.profissionalId,
        dataChave: a.dataChave,
        horario: a.horario,
        duracaoMin: a.duracaoMin,
        status: a.status
      }));

    return responder(res, 200, {
      barbearia: {
        ...infoPublica(info),
        aceitaAgendamentos: situacao.aceita,
        motivoIndisponivel: situacao.aceita ? null : situacao.motivo
      },
      servicos,
      profissionais,
      ocupados
    });
  } catch (err) {
    return tratarErro(res, err, 'negocio');
  }
};
