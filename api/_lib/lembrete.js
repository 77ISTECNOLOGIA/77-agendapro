// ========================================
// 77 AGENDAPRO — Lembretes e avisos push para o CLIENTE (app instalado no celular dele)
// ========================================
// Aparelhos do cliente: barbearias/{slug}/dispositivosCliente/{id} = { whatsapp, token, aparelho } — só o servidor lê/grava
// (não há regra no Firestore para essa coleção: fica negada ao navegador).
//
// LEMBRETE PROGRAMADO sem ler agendamentos à toa: cada agendamento ganha `lembreteAppEm` = "AAAA-MM-DDTHH:MM" (horário de
// Brasília) de quando o aviso deve sair. Uma rotina chamada a cada ~10 min (cron-job.org → /api/cron-recorrencias?tarefa=lembretes)
// consulta SÓ os vencidos (`lembreteAppEm <= agora`, em todos os negócios) — o custo de leitura é proporcional ao que será enviado.
// Depois de tratado o campo é apagado. Quem escreve o agendamento (servidor e painel) é quem preenche o campo.

const crypto = require('node:crypto');
const { db, messaging, FieldValue } = require('./firebase');
const { agoraBrasil, somarDias, horaParaMinutos } = require('./tempo');
const { statusEfetivo } = require('./sinal');
const { situacaoNegocio } = require('./negocio');

const URL_BASE = process.env.APP_URL || 'https://77-agendapro.vercel.app';
const ICONE_77 = `${URL_BASE}/img/icon-192.png`;
const OPCOES_MINUTOS = [0, 30, 60, 120, 180, 1440];     // 0 = não avisar
const PADRAO_MINUTOS = 60;
const MAX_APARELHOS_POR_WHATSAPP = 5;
const TOLERANCIA_ATRASO_MIN = 15;                       // se a rotina atrasar além disso (e o aviso já estiver "velho"), manda mesmo assim até o início
const ERROS_TOKEN_INVALIDO = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];

function minutosLembrete(info) {
  const v = info && info.lembreteClienteMin;
  return OPCOES_MINUTOS.includes(v) ? v : PADRAO_MINUTOS;
}

// "2026-11-20" + "14:00" − 60 min → "2026-11-20T13:00". null se não deve avisar.
function calcularLembreteAppEm(dataChave, horario, minutosAntes) {
  if (!minutosAntes || minutosAntes <= 0) return null;
  const total = horaParaMinutos(horario) - minutosAntes;
  let dia = dataChave, min = total;
  while (min < 0) { dia = somarDias(dia, -1); min += 1440; }
  const hh = String(Math.floor(min / 60)).padStart(2, '0'), mm = String(min % 60).padStart(2, '0');
  return `${dia}T${hh}:${mm}`;
}

function textoAgora(agora = agoraBrasil()) {
  const hh = String(Math.floor(agora.minutos / 60)).padStart(2, '0'), mm = String(agora.minutos % 60).padStart(2, '0');
  return `${agora.dataChave}T${hh}:${mm}`;
}

const idAparelho = (token) => crypto.createHash('sha1').update(String(token)).digest('hex').slice(0, 24);
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function quando(dataChave, horario) {
  const [a, m, d] = String(dataChave).split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS[dow]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} às ${horario}`;
}

/** Envia o aviso aos aparelhos do cliente (por WhatsApp). Nunca lança. Remove tokens mortos. */
async function enviarParaCliente(negocioRef, whatsapp, { titulo, corpo, tag, link }) {
  const r = { total: 0, enviadas: 0, removidos: 0 };
  try {
    const snap = await negocioRef.collection('dispositivosCliente').where('whatsapp', '==', whatsapp).get();
    r.total = snap.size;
    const destino = link || `${URL_BASE}/${negocioRef.id}`;
    await Promise.all(snap.docs.map(async (d) => {
      const token = d.data().token;
      if (!token) return;
      try {
        await messaging().send({
          token,
          notification: { title: titulo, body: corpo },
          data: { tag, link: destino },
          webpush: { notification: { icon: ICONE_77, badge: ICONE_77, tag }, fcmOptions: { link: destino } }
        });
        r.enviadas++;
      } catch (err) {
        if (ERROS_TOKEN_INVALIDO.includes(err && err.code)) { await d.ref.delete(); r.removidos++; }
      }
    }));
  } catch (err) { console.error('Falha ao avisar o cliente:', err); }
  return r;
}

/** Aviso ao cliente por mudança feita pelo estabelecimento. tipo: cancelado | remarcado | sinal-confirmado | sinal-recusado. */
async function avisarClienteAlteracao(negocioRef, agendamentoId, ag, tipo, nomeNegocio) {
  const nome = nomeNegocio || 'o estabelecimento';
  const quandoNovo = quando(ag.dataChave, ag.horario);
  let titulo, corpo;
  if (tipo === 'remarcado') {
    titulo = '🔁 Horário remarcado';
    corpo = ag.remarcadoDeDataChave ? `${nome} remarcou: ${quando(ag.remarcadoDeDataChave, ag.remarcadoDeHorario)} → ${quandoNovo}.` : `${nome} remarcou seu horário para ${quandoNovo}.`;
  } else if (tipo === 'cancelado') {
    titulo = '❌ Horário cancelado';
    corpo = `${nome} cancelou seu horário de ${quandoNovo}. Toque para agendar outro.`;
  } else if (tipo === 'sinal-confirmado') {
    titulo = '✅ Pagamento confirmado';
    corpo = `${nome}: seu horário de ${quandoNovo} está confirmado.`;
  } else {
    titulo = '⚠️ Pagamento não confirmado';
    corpo = `${nome} não confirmou o pagamento do sinal e o horário de ${quandoNovo} foi liberado.`;
  }
  return enviarParaCliente(negocioRef, ag.clienteWhatsapp, { titulo, corpo, tag: `cli-${tipo}-${agendamentoId}-${ag.remarcadoEm || ag.canceladoEm || ag.sinalConfirmadoEm || ''}` });
}

/**
 * Rotina: envia os lembretes vencidos. Devolve { vencidos, enviados, descartados }.
 * `agora` = { dataChave, minutos } (Brasília).
 */
async function enviarLembretesVencidos(agora = agoraBrasil(), limite = 300) {
  const firestore = db();
  const resumo = { vencidos: 0, enviados: 0, descartados: 0 };
  const snap = await firestore.collectionGroup('agendamentos').where('lembreteAppEm', '<=', textoAgora(agora)).limit(limite).get();
  resumo.vencidos = snap.size;
  const negocios = new Map();
  const infoDe = async (ref) => {
    if (!negocios.has(ref.id)) negocios.set(ref.id, (await ref.get()).data() || null);
    return negocios.get(ref.id);
  };
  for (const d of snap.docs) {
    const ag = d.data();
    const negocioRef = d.ref.parent.parent;
    const limpar = (extra = {}) => d.ref.update({ lembreteAppEm: FieldValue.delete(), ...extra });
    try {
      const info = await infoDe(negocioRef);
      const inicioMin = horaParaMinutos(ag.horario);
      const jaComecou = ag.dataChave < agora.dataChave || (ag.dataChave === agora.dataChave && inicioMin <= agora.minutos);
      if (!info || !situacaoNegocio(info).aceita || statusEfetivo(ag) !== 'confirmado' || jaComecou) { await limpar(); resumo.descartados++; continue; }
      const r = await enviarParaCliente(negocioRef, ag.clienteWhatsapp, {
        titulo: `⏰ Seu horário é hoje${ag.horario ? ' às ' + ag.horario : ''}`,
        corpo: `${info.nome || 'Seu horário'}${ag.profissionalNome ? ' — ' + String(ag.profissionalNome).split(' ')[0] : ''} — ${(ag.servicos || []).map((s) => s.nome).join(' + ')}. Até já!`,
        tag: `lembrete-${d.id}`
      });
      await limpar({ lembreteAppEnviadoEm: new Date().toISOString() });
      if (r.enviadas > 0) resumo.enviados++; else resumo.descartados++;
    } catch (err) {
      console.error('Falha no lembrete de ' + d.id, err);   // este fica para a próxima rodada
    }
  }
  return resumo;
}

module.exports = {
  OPCOES_MINUTOS, PADRAO_MINUTOS, MAX_APARELHOS_POR_WHATSAPP, TOLERANCIA_ATRASO_MIN,
  minutosLembrete, calcularLembreteAppEm, textoAgora, idAparelho, enviarParaCliente, avisarClienteAlteracao, enviarLembretesVencidos
};
