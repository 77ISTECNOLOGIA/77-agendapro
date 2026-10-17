// ========================================
// 77 AGENDAPRO — API: Autoatendimento do cliente
// Vercel Serverless Function (Node.js)
// ========================================
// O cliente final não tem login (Firebase Auth), então as regras do Firestore
// bloqueiam qualquer acesso dele. Esta função usa o Admin SDK, mas só age
// depois de confirmar que o agendamento pertence mesmo ao WhatsApp informado
// — nunca confia em "é meu" vindo pronto do navegador.
//
// Ações (POST { slug, whatsapp, action, ... }):
//   identificar → { encontrado, nome }  (só o PRIMEIRO nome, p/ "bem-vindo de volta")
//   listar      → { agendamentos }
//   cancelar    → { sucesso }
//   remarcar    → { sucesso }   (dentro de transação, anti-conflito)
//
// Travas de negócio (só pro cliente; o dono nunca é afetado):
//  1. cancelar/remarcar só até 1 dia (data corrida) antes do horário original;
//  2. remarcar só 1 vez por agendamento.
//
// Limitação conhecida: a identidade do cliente é o número de WhatsApp (sem
// código de confirmação por SMS/WhatsApp). O limite de requisições por IP
// reduz tentativas em massa; um OTP real depende de um provedor de WhatsApp.

const { db } = require('./_lib/firebase');
const {
  agoraBrasil, hojeChaveBrasil, dataChaveValida, horaValida, normalizarWhatsapp, whatsappValido, somarDias
} = require('./_lib/tempo');
const { verificarSlot } = require('./_lib/disponibilidade');
const { slugValido, situacaoNegocio } = require('./_lib/negocio');
const { dentroDoLimite, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');

const LIMITE_REMARCACOES_CLIENTE = 1;
const HISTORICO_DIAS = 60;

function publico(a) {
  return {
    id: a.id,
    profissionalId: a.profissionalId,
    profissionalNome: a.profissionalNome,
    servicos: a.servicos,
    dataChave: a.dataChave,
    horario: a.horario,
    duracaoMin: a.duracaoMin,
    valorTotal: a.valorTotal,
    status: a.status,
    remarcacoesCliente: a.remarcacoesCliente || 0
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'agendamento-cliente', 40, 60000)) {
    return responder(res, 429, { erro: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });
  }

  const { slug: slugRaw, whatsapp, action, agendamentoId, novaDataChave, novoHorario } = corpoDe(req);
  const slug = String(slugRaw || '').toLowerCase();

  if (!slugValido(slug) || !whatsapp || !action) {
    return responder(res, 400, { erro: 'Parâmetros obrigatórios: slug, whatsapp, action' });
  }
  const whatsNorm = normalizarWhatsapp(whatsapp);
  if (!whatsappValido(whatsNorm)) return responder(res, 400, { erro: 'WhatsApp inválido' });

  try {
    const firestore = db();
    const negocioRef = firestore.collection('barbearias').doc(slug);
    const agsRef = negocioRef.collection('agendamentos');

    if (action === 'identificar') {
      const snap = await negocioRef.collection('clientes').doc(whatsNorm).get();
      if (!snap.exists) return responder(res, 200, { encontrado: false });
      const primeiroNome = String(snap.data().nome || '').split(' ')[0];
      return responder(res, 200, { encontrado: true, nome: primeiroNome });
    }

    if (action === 'listar') {
      const corte = somarDias(hojeChaveBrasil(), -HISTORICO_DIAS);
      const snap = await agsRef.where('clienteWhatsapp', '==', whatsNorm).get();
      const meus = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.dataChave >= corte)
        .map(publico)
        .sort((a, b) => (a.dataChave + a.horario).localeCompare(b.dataChave + b.horario));
      return responder(res, 200, { agendamentos: meus });
    }

    if (action !== 'cancelar' && action !== 'remarcar') {
      return responder(res, 400, { erro: 'Ação inválida' });
    }
    if (!agendamentoId || typeof agendamentoId !== 'string' || agendamentoId.includes('/')) {
      return responder(res, 400, { erro: 'Parâmetro obrigatório: agendamentoId' });
    }

    const agRef = agsRef.doc(agendamentoId);

    if (action === 'cancelar') {
      await firestore.runTransaction(async (tx) => {
        const ag = (await tx.get(agRef)).data();
        if (!ag || ag.clienteWhatsapp !== whatsNorm) throw new ErroNegocio(404, 'Agendamento não encontrado');
        if (ag.status !== 'confirmado') throw new ErroNegocio(400, 'Este agendamento não pode mais ser cancelado');
        if (ag.dataChave <= hojeChaveBrasil()) {
          throw new ErroNegocio(400, 'Esse agendamento está a menos de 1 dia da data marcada. Pra cancelar agora, entre em contato direto com o estabelecimento.');
        }
        tx.update(agRef, { status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: 'cliente' });
      });
      return responder(res, 200, { sucesso: true });
    }

    // remarcar
    if (!dataChaveValida(novaDataChave) || !horaValida(novoHorario)) {
      return responder(res, 400, { erro: 'Data ou horário inválido' });
    }

    const infoSnap = await negocioRef.get();
    if (!infoSnap.exists) throw new ErroNegocio(404, 'Negócio não encontrado');
    const info = infoSnap.data();
    const situacao = situacaoNegocio(info);
    if (!situacao.aceita) throw new ErroNegocio(403, situacao.motivo);

    await firestore.runTransaction(async (tx) => {
      const [agSnap, diaSnap] = await Promise.all([
        tx.get(agRef),
        tx.get(agsRef.where('dataChave', '==', novaDataChave))
      ]);
      const ag = agSnap.data();

      if (!ag || ag.clienteWhatsapp !== whatsNorm) throw new ErroNegocio(404, 'Agendamento não encontrado');
      if (ag.status !== 'confirmado') throw new ErroNegocio(400, 'Este agendamento não pode mais ser remarcado');
      if (ag.dataChave <= hojeChaveBrasil()) {
        throw new ErroNegocio(400, 'Esse agendamento está a menos de 1 dia da data marcada. Pra remarcar agora, entre em contato direto com o estabelecimento.');
      }
      if ((ag.remarcacoesCliente || 0) >= LIMITE_REMARCACOES_CLIENTE) {
        throw new ErroNegocio(400, 'Esse agendamento já foi remarcado o número máximo de vezes permitido. Entre em contato direto com o estabelecimento.');
      }

      const profSnap = await tx.get(negocioRef.collection('profissionais').doc(ag.profissionalId));
      const prof = profSnap.exists ? { id: profSnap.id, ...profSnap.data() } : null;

      const v = verificarSlot({
        prof, info,
        agendamentos: diaSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        dataChave: novaDataChave, horario: novoHorario, duracaoMin: ag.duracaoMin,
        ignorarId: agendamentoId,
        agora: agoraBrasil()
      });
      if (!v.ok) throw new ErroNegocio(409, `Horário indisponível: ${v.motivo}`);

      tx.update(agRef, {
        dataChave: novaDataChave,
        horario: novoHorario,
        lembreteEnviado: false,
        remarcadoEm: new Date().toISOString(),
        remarcadoPor: 'cliente',
        remarcacoesCliente: (ag.remarcacoesCliente || 0) + 1
      });
    });
    return responder(res, 200, { sucesso: true });
  } catch (err) {
    return tratarErro(res, err, 'agendamento-cliente');
  }
};
