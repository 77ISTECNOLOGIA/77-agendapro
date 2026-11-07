// ========================================
// 77 AGENDAPRO — Rotina diária: renova os horários fixos de todos os negócios
// Vercel Cron (vercel.json → "crons"), uma vez por dia. Gratuito no plano Hobby.
// ========================================
// Protegida por senha: só roda se a variável de ambiente CRON_SECRET existir E a chamada trouxer
// "Authorization: Bearer <CRON_SECRET>" (a Vercel envia isso sozinha para as rotinas dela).
// Sem a variável configurada ela se recusa a rodar — nunca fica aberta ao público.
// É só um reforço: o painel do dono também renova ao abrir, e cada renovação é idempotente.

const { db } = require('./_lib/firebase');
const { agoraBrasil, hojeChaveBrasil } = require('./_lib/tempo');
const { renovarSeries } = require('./_lib/recorrencia');
const { responder, tratarErro } = require('./_lib/http');

module.exports = async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  const enviado = (req.headers && req.headers.authorization) || '';
  if (!segredo || enviado !== `Bearer ${segredo}`) return responder(res, 401, { erro: 'Não autorizado' });

  try {
    const firestore = db();
    const hojeChave = hojeChaveBrasil();
    const agora = agoraBrasil();
    const total = { negocios: 0, series: 0, criadas: 0, puladas: 0, erros: 0, encerradas: 0 };

    const negocios = await firestore.collection('barbearias').get();
    for (const n of negocios.docs) {
      try {
        const r = await renovarSeries({ firestore, negocioRef: n.ref, info: n.data(), hojeChave, agora });
        if (r.ignorado) continue;
        total.negocios++;
        for (const k of ['series', 'criadas', 'puladas', 'erros', 'encerradas']) total[k] += r[k];
      } catch (err) {
        total.erros++;
        console.error(`Falha ao renovar horários fixos de ${n.id}:`, err);   // um negócio com problema não derruba os outros
      }
    }
    return responder(res, 200, { sucesso: true, ...total });
  } catch (err) {
    return tratarErro(res, err, 'cron-recorrencias');
  }
};
