// ========================================
// 77 AGENDAPRO — Atendimentos esquecidos (lado servidor)
// ========================================
// Mesma regra de js/utils.js (atendimentosParaResolver): agendamento ainda "confirmado" cujo
// horário de término (horário + duração) + margem já passou. Aqui "agora" é o de Brasília.

const { enviarParaDispositivos } = require('./notificar');
const { sinalExpirado } = require('./sinal');

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

/** Cancela reservas aguardando sinal cujo prazo venceu (o horário já estava livre; aqui só arruma o status). */
async function limparSinaisVencidos(negocioRef, agoraMs = Date.now()) {
  const snap = await negocioRef.collection('agendamentos').where('status', '==', 'aguardando_sinal').get();
  let n = 0;
  for (const d of snap.docs) {
    if (sinalExpirado(d.data(), agoraMs)) {
      await d.ref.update({ status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: 'sinal-expirado' });
      n++;
    }
  }
  return n;
}

/** Avisa o dono (push) se há atendimentos esquecidos ou pagamentos de sinal para confirmar. Nunca lança. Devolve o total. */
async function avisarPendentes(negocioRef, agora) {
  try {
    const [confSnap, pagSnap] = await Promise.all([
      negocioRef.collection('agendamentos').where('status', '==', 'confirmado').get(),
      negocioRef.collection('agendamentos').where('status', '==', 'sinal_informado').get()
    ]);
    const n = contarPendentes(confSnap.docs.map((d) => d.data()), agora);
    const p = pagSnap.size;
    if (!n && !p) return 0;
    const partes = [];
    if (n) partes.push(n === 1 ? '1 atendimento para concluir ou cancelar' : `${n} atendimentos para concluir ou cancelar`);
    if (p) partes.push(p === 1 ? '1 pagamento de sinal para confirmar' : `${p} pagamentos de sinal para confirmar`);
    await enviarParaDispositivos(negocioRef, {
      corpo: `Você tem ${partes.join(' e ')}.${n ? ' Só os concluídos entram no faturamento.' : ''}`,
      tag: `pendencias-${agora.dataChave}`,
      dados: { tipo: 'pendencias' }
    });
    return n + p;
  } catch (err) {
    console.error('Falha ao avisar atendimentos pendentes:', err);
    return 0;
  }
}

module.exports = { contarPendentes, avisarPendentes, limparSinaisVencidos, MARGEM_PENDENCIA_MIN };
