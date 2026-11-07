// ========================================
// 77 AGENDAPRO — Atendimentos esquecidos (lado servidor)
// ========================================
// Mesma regra de js/utils.js (atendimentosParaResolver): agendamento ainda "confirmado" cujo
// horário de término (horário + duração) + margem já passou. Aqui "agora" é o de Brasília.

const { enviarParaDispositivos } = require('./notificar');

const MARGEM_PENDENCIA_MIN = 30;

function minutosDe(dataChave, horario) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataChave || '');
  const h = /^(\d{2}):(\d{2})$/.exec(horario || '');
  if (!d || !h) return null;
  return Date.UTC(+d[1], +d[2] - 1, +d[3]) / 60000 + (+h[1]) * 60 + (+h[2]);
}

/** agendamentos: array de documentos; agora: { dataChave, minutos } (ver tempo.agoraBrasil). */
function contarPendentes(agendamentos, agora, margemMin = MARGEM_PENDENCIA_MIN) {
  const agoraMin = minutosDe(agora.dataChave, '00:00') + agora.minutos;
  return agendamentos.filter((a) => {
    if (!a || a.status !== 'confirmado') return false;
    const inicio = minutosDe(a.dataChave, a.horario);
    if (inicio === null) return false;
    return agoraMin >= inicio + (Number(a.duracaoMin) || 30) + margemMin;
  }).length;
}

/** Avisa o dono (push) se há atendimentos esquecidos. Nunca lança. Devolve a quantidade pendente. */
async function avisarPendentes(negocioRef, agora) {
  try {
    const snap = await negocioRef.collection('agendamentos').where('status', '==', 'confirmado').get();
    const n = contarPendentes(snap.docs.map((d) => d.data()), agora);
    if (!n) return 0;
    await enviarParaDispositivos(negocioRef, {
      corpo: n === 1
        ? 'Você tem 1 atendimento para concluir ou cancelar. Só os concluídos entram no faturamento.'
        : `Você tem ${n} atendimentos para concluir ou cancelar. Só os concluídos entram no faturamento.`,
      tag: `pendencias-${agora.dataChave}`,
      dados: { tipo: 'pendencias' }
    });
    return n;
  } catch (err) {
    console.error('Falha ao avisar atendimentos pendentes:', err);
    return 0;
  }
}

module.exports = { contarPendentes, avisarPendentes, MARGEM_PENDENCIA_MIN };
