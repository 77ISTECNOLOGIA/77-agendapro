// ========================================
// 77 AGENDAPRO — Notificação push para o dono (uso interno do servidor)
// ========================================
// Antes existia um endpoint público /api/send-notification que o navegador do
// cliente chamava depois de agendar. Agora quem cria o agendamento
// (criar-agendamento.js) dispara a notificação direto, sem expor endpoint.
// Os tokens ficam em barbearias/{slug}/dispositivos/{deviceId} (privado).

const { messaging, db } = require('./firebase');
const { permissoesDe } = require('./equipe');

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
 * Escolhe QUEM recebe, entre os aparelhos de barbearias/{slug}/dispositivos. Cada aparelho guarda o `uid` de quem o ativou;
 * as permissões são lidas na hora do envio (mudou o acesso, mudou quem recebe):
 *  - aparelho sem uid = anterior à equipe, era do dono: recebe como quem vê tudo;
 *  - quem VÊ TUDO recebe tudo;
 *  - quem só vê o próprio profissional recebe só o que é do SEU profissional (`profissionalId`);
 *  - `uid`: só os aparelhos dessa pessoa (notificação de teste); `uidVeTodos` diz se os aparelhos antigos também valem para ela.
 * Aparelho de quem saiu do negócio não recebe nada.
 */
async function escolherAparelhos(negocioRef, docs, { profissionalId, uid, uidVeTodos }) {
  const usuarios = new Map();
  const usuarioDe = async (u) => {
    if (!usuarios.has(u)) usuarios.set(u, (await db().collection('usuarios').doc(u).get()).data() || null);
    return usuarios.get(u);
  };
  const escolhidos = [];
  for (const d of docs) {
    const dono = d.data().uid;
    if (uid) { if (dono === uid || (!dono && uidVeTodos)) escolhidos.push(d); continue; }
    if (!dono) { escolhidos.push(d); continue; }
    const u = await usuarioDe(dono);
    if (!u || u.barbeariaId !== negocioRef.id) continue;
    if (permissoesDe(u).verTodos || (profissionalId && u.profissionalId === profissionalId)) escolhidos.push(d);
  }
  return escolhidos;
}

/**
 * Envia a MESMA notificação aos aparelhos escolhidos (ver escolherAparelhos).
 * Nunca lança. Remove tokens mortos. Devolve { total, enviadas, removidos, erros[] }.
 */
async function enviarParaDispositivos(negocioRef, { titulo = '77 AgendaPro', corpo, tag, dados = {}, link, profissionalId, uid, uidVeTodos }) {
  const resultado = { total: 0, enviadas: 0, removidos: 0, erros: [] };
  const snap = await negocioRef.collection('dispositivos').get();
  const aparelhos = await escolherAparelhos(negocioRef, snap.docs, { profissionalId, uid, uidVeTodos });
  resultado.total = aparelhos.length;
  if (!aparelhos.length) return resultado;

  const urlPainel = link || `${process.env.APP_URL || 'https://77-agendapro.vercel.app'}/admin`;
  await Promise.all(aparelhos.map(async (d) => {
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

function dataHora(dataChave, horario) {
  const [ano, mes, dia] = String(dataChave || '').split('-').map(Number);
  const dow = ano ? new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() : null;
  const dataStr = dow === null ? '' : `${DIAS_ABREV[dow]} ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
  return `${dataStr} às ${horario}`;
}

/**
 * Avisa o dono quando o CLIENTE cancela ou remarca pelo link (autoatendimento).
 * tipo: 'cancelou' | 'remarcou'; ag = agendamento DEPOIS da alteração; antes = { dataChave, horario } (só na remarcação).
 * Tag única por evento (um aviso não substitui o outro). Melhor esforço: nunca lança.
 */
async function notificarAlteracaoCliente(negocioRef, agendamentoId, { tipo, ag, antes }) {
  try {
    const nome = String(ag.clienteNome || '').split(' ')[0] || 'Cliente';
    const servicos = (ag.servicos || []).map((s) => s.nome).join(' + ');
    const nomeProf = String(ag.profissionalNome || '').split(' ')[0];
    const com = nomeProf ? ` com ${nomeProf}` : '';
    let titulo, corpo, tag;
    if (tipo === 'remarcou') {
      titulo = '🔁 Cliente remarcou';
      corpo = `${nome} remarcou: ${dataHora(antes.dataChave, antes.horario)} → ${dataHora(ag.dataChave, ag.horario)} — ${servicos}${com}`;
      tag = `remarcou-${agendamentoId}-${ag.remarcacoesCliente || Date.now()}`;
    } else {
      titulo = '❌ Cliente cancelou';
      corpo = `${nome} cancelou: ${dataHora(ag.dataChave, ag.horario)} — ${servicos}${com}`;
      tag = `cancelou-${agendamentoId}`;
    }
    const r = await enviarParaDispositivos(negocioRef, {
      titulo, corpo, tag, profissionalId: ag.profissionalId,
      dados: { agendamentoId, tipo },
      link: `${process.env.APP_URL || 'https://77-agendapro.vercel.app'}/admin?agendamento=${encodeURIComponent(agendamentoId)}`
    });
    return { enviadas: r.enviadas };
  } catch (err) {
    console.error('Falha ao avisar o dono da alteração do cliente:', err);
    return { enviadas: 0, erro: true };
  }
}

/** Cliente tocou em "Já paguei": avisa o dono para conferir o Pix e confirmar. Nunca lança. */
async function notificarSinalInformado(negocioRef, agendamentoId, ag) {
  try {
    const nome = String(ag.clienteNome || '').split(' ')[0] || 'Cliente';
    const servicos = (ag.servicos || []).map((s) => s.nome).join(' + ');
    const valor = Number(ag.sinalValor || 0).toFixed(2).replace('.', ',');
    const r = await enviarParaDispositivos(negocioRef, {
      titulo: '💰 Sinal informado',
      corpo: `${nome} informou o Pix de R$ ${valor} — ${dataHora(ag.dataChave, ag.horario)} — ${servicos}. Confira e confirme no painel.`,
      tag: `sinal-${agendamentoId}`, profissionalId: ag.profissionalId,
      dados: { agendamentoId, tipo: 'sinal' },
      link: `${process.env.APP_URL || 'https://77-agendapro.vercel.app'}/admin?agendamento=${encodeURIComponent(agendamentoId)}`
    });
    return { enviadas: r.enviadas };
  } catch (err) {
    console.error('Falha ao avisar o dono do sinal informado:', err);
    return { enviadas: 0, erro: true };
  }
}

/** Melhor esforço: nunca lança, nunca bloqueia o agendamento. */
async function notificarNovoAgendamento(negocioRef, agendamentoRef, agendamento) {
  try {
    // Uma identificação por agendamento: mesma tag substitui a anterior (nunca duplica),
    // e agendamentos diferentes continuam empilhando.
    const r = await enviarParaDispositivos(negocioRef, {
      corpo: montarCorpo(agendamento),
      tag: `agendamento-${agendamentoRef.id}`, profissionalId: agendamento.profissionalId,
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

module.exports = { notificarNovoAgendamento, notificarAlteracaoCliente, notificarSinalInformado, enviarParaDispositivos, montarCorpo };
