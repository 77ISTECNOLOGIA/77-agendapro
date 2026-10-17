// ========================================
// 77 AGENDAPRO — Notificação push para o dono (uso interno do servidor)
// ========================================
// Antes existia um endpoint público /api/send-notification que o navegador do
// cliente chamava depois de agendar. Agora quem cria o agendamento
// (criar-agendamento.js) dispara a notificação direto, sem expor endpoint.
// Os tokens ficam em barbearias/{slug}/dispositivos/{deviceId} (privado).

const { messaging } = require('./firebase');

const ICONE_77 = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#fb6464"/><text x="50" y="68" font-family="sans-serif" font-weight="800" font-size="48" text-anchor="middle" fill="#0a0a0a">77</text></svg>'
);

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

/** Melhor esforço: nunca lança, nunca bloqueia o agendamento. */
async function notificarNovoAgendamento(negocioRef, agendamentoRef, agendamento) {
  try {
    const dispositivosSnap = await negocioRef.collection('dispositivos').get();
    if (dispositivosSnap.empty) return { enviadas: 0 };

    const corpo = montarCorpo(agendamento);
    const resultados = await Promise.allSettled(dispositivosSnap.docs.map(async (d) => {
      const token = d.data().token;
      if (!token) return;
      try {
        await messaging().send({
          token,
          notification: { title: '77 AgendaPro', body: corpo },
          webpush: { notification: { icon: ICONE_77, badge: ICONE_77 } }
        });
      } catch (err) {
        // Token expirado/desinstalado: remove para não acumular lixo
        if (ERROS_TOKEN_INVALIDO.includes(err && err.code)) await d.ref.delete();
        throw err;
      }
    }));

    await agendamentoRef.update({ notificacaoEnviada: true });
    return { enviadas: resultados.filter(r => r.status === 'fulfilled').length };
  } catch (err) {
    console.error('Falha ao notificar dono:', err);
    return { enviadas: 0, erro: true };
  }
}

module.exports = { notificarNovoAgendamento, montarCorpo };
