// ========================================
// 77 AGENDAPRO — Notificação push para o dono (uso interno do servidor)
// ========================================
// Antes existia um endpoint público /api/send-notification que o navegador do
// cliente chamava depois de agendar. Agora quem cria o agendamento
// (criar-agendamento.js) dispara a notificação direto, sem expor endpoint.
// Os tokens ficam em barbearias/{slug}/dispositivos/{deviceId} (privado).

const { messaging } = require('./firebase');

const URL_BASE = process.env.APP_URL || 'https://77-agendapro.vercel.app';
const ICONE_77 = `${URL_BASE}/img/icon-192.png`;

const DIAS_ABREV = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ERROS_TOKEN_INVALIDO = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
];

function montarCorpo(ag) {
  const [ano, mes, dia] = String(ag.dataChave || '').split('-').map(Number);
  const dow = ano ? new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() : null;
  const dataStr = dow === null ? '' : `${DIAS_ABREV[dow]} ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
  const servicosStr = (ag.servicos || []).map(s => s.nome).join(' + ');
  const nomeCliente = String(ag.clienteNome || '').split(' ')[0];
  const nomeProf = String(ag.profissionalNome || '').split(' ')[0];
  return `${nomeCliente} — ${dataStr} às ${ag.horario} — ${servicosStr} com ${nomeProf}`;
}

/**
 * Envia a MESMA notificação pra todos os aparelhos do dono (barbearias/{slug}/dispositivos).
 * Nunca lança. Remove tokens mortos. Devolve { total, enviadas, removidos, erros[] }.
 */
async function enviarParaDispositivos(negocioRef, { titulo = '77 AgendaPro', corpo, tag, dados = {}, link }) {
  const resultado = { total: 0, enviadas: 0, removidos: 0, erros: [] };
  const snap = await negocioRef.collection('dispositivos').get();
  resultado.total = snap.size;
  if (snap.empty) return resultado;

  const urlPainel = link || `${process.env.APP_URL || 'https://77-agendapro.vercel.app'}/admin`;
  await Promise.all(snap.docs.map(async (d) => {
    const token = d.data().token;
    if (!token) return;
    try {
      await messaging().send({
        token,
        notification: { title: titulo, body: corpo },
        data: { tag, ...dados },
        webpush: {
          notification: { icon: ICONE_77, badge: ICONE_77, tag },
          // sem isso, tocar na notificação não abre nada
          fcmOptions: { link: urlPainel }
        }
      });
      resultado.enviadas++;
    } catch (err) {
      const codigo = (err && err.code) || 'desconhecido';
      resultado.erros.push(codigo);
      // Token expirado/desinstalado: remove para não acumular lixo
      if (ERROS_TOKEN_INVALIDO.includes(codigo)) { await d.ref.delete(); resultado.removidos++; }
    }
  }));
  return resultado;
}

/** Melhor esforço: nunca lança, nunca bloqueia o agendamento. */
async function notificarNovoAgendamento(negocioRef, agendamentoRef, agendamento) {
  try {
    // Uma identificação por agendamento: mesma tag substitui a anterior (nunca duplica),
    // e agendamentos diferentes continuam empilhando.
    const r = await enviarParaDispositivos(negocioRef, {
      corpo: montarCorpo(agendamento),
      tag: `agendamento-${agendamentoRef.id}`,
      dados: { agendamentoId: agendamentoRef.id },
      // tocar na notificação abre direto ESTE agendamento no painel
      link: `${process.env.APP_URL || 'https://77-agendapro.vercel.app'}/admin?agendamento=${encodeURIComponent(agendamentoRef.id)}`
    });
    if (r.total > 0) await agendamentoRef.update({ notificacaoEnviada: true });
    return { enviadas: r.enviadas };
  } catch (err) {
    console.error('Falha ao notificar dono:', err);
    return { enviadas: 0, erro: true };
  }
}

module.exports = { notificarNovoAgendamento, enviarParaDispositivos, montarCorpo };
