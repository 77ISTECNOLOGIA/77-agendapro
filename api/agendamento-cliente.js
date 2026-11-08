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
const { notificarAlteracaoCliente } = require('./_lib/notificar');
const { executarSinal } = require('./_lib/sinal-acoes');
const { slugValido, situacaoNegocio } = require('./_lib/negocio');
const { statusEfetivo, contarNaSemana, limiteSemanal, semanaDaChave, ocupaHorario } = require('./_lib/sinal');
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
    status: statusEfetivo(a),
    sinalValor: a.sinalValor || 0,
    sinalExpiraEm: a.sinalExpiraEm || null,
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

    if (action === 'sinal-dados' || action === 'sinal-informar') {
      if (!agendamentoId || typeof agendamentoId !== 'string' || agendamentoId.includes('/') || agendamentoId.length > 64) {
        return responder(res, 400, { erro: 'Parâmetro obrigatório: agendamentoId' });
      }
      return responder(res, 200, await executarSinal({ firestore, negocioRef, agendamentoId, whatsNorm, action }));
    }

    if (action !== 'cancelar' && action !== 'remarcar') {
      return responder(res, 400, { erro: 'Ação inválida' });
    }
    if (!agendamentoId || typeof agendamentoId !== 'string' || agendamentoId.includes('/')) {
      return responder(res, 400, { erro: 'Parâmetro obrigatório: agendamentoId' });
    }

    const agRef = agsRef.doc(agendamentoId);

    if (action === 'cancelar') {
      let cancelado = null;
      await firestore.runTransaction(async (tx) => {
        const ag = (await tx.get(agRef)).data();
        if (!ag || ag.clienteWhatsapp !== whatsNorm) throw new ErroNegocio(404, 'Agendamento não encontrado');
        const efetivo = statusEfetivo(ag);
        if (efetivo === 'sinal_informado') throw new ErroNegocio(400, 'Você já informou o pagamento do sinal. Para cancelar, fale direto com o estabelecimento.');
        if (efetivo !== 'confirmado' && efetivo !== 'aguardando_sinal') throw new ErroNegocio(400, 'Este agendamento não pode mais ser cancelado');
        if (efetivo === 'confirmado' && ag.dataChave <= hojeChaveBrasil()) {
          throw new ErroNegocio(400, 'Esse agendamento está a menos de 1 dia da data marcada. Pra cancelar agora, entre em contato direto com o estabelecimento.');
        }
        tx.update(agRef, { status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: 'cliente' });
        cancelado = ag;
      });
      // avisa o dono (push); falha aqui nunca desfaz o cancelamento. Reserva ainda sem sinal: o dono nem sabia dela.
      if (cancelado.status === 'confirmado') await notificarAlteracaoCliente(negocioRef, agendamentoId, { tipo: 'cancelou', ag: cancelado });
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

    let remarcado = null;
    await firestore.runTransaction(async (tx) => {
      const [agSnap, diaSnap, doClienteSnap] = await Promise.all([
        tx.get(agRef),
        tx.get(agsRef.where('dataChave', '==', novaDataChave)),
        tx.get(agsRef.where('clienteWhatsapp', '==', whatsNorm))
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

      if (ag.dataChave === novaDataChave && ag.horario === novoHorario) {
        throw new ErroNegocio(400, 'Escolha um dia ou horário diferente do atual.');
      }

      // limite de agendamentos por semana: a nova semana não pode estourar (o próprio agendamento não conta)
      const limite = limiteSemanal(info);
      const doCliente = doClienteSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (limite && contarNaSemana(doCliente, novaDataChave, Date.now(), agendamentoId) >= limite) {
        const sem = semanaDaChave(novaDataChave);
        const fmt = (c) => c.slice(8, 10) + '/' + c.slice(5, 7);
        throw new ErroNegocio(409, `Você já tem ${limite} agendamento${limite === 1 ? '' : 's'} na semana de ${fmt(sem.ini)} a ${fmt(sem.fim)}, que é o limite deste estabelecimento. Escolha outra semana ou fale direto com eles.`);
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
        remarcadoDeDataChave: ag.dataChave,
        remarcadoDeHorario: ag.horario,
        remarcacoesCliente: (ag.remarcacoesCliente || 0) + 1
      });
      remarcado = { antes: { dataChave: ag.dataChave, horario: ag.horario }, depois: { ...ag, dataChave: novaDataChave, horario: novoHorario, remarcacoesCliente: (ag.remarcacoesCliente || 0) + 1 } };
    });
    await notificarAlteracaoCliente(negocioRef, agendamentoId, { tipo: 'remarcou', ag: remarcado.depois, antes: remarcado.antes });
    return responder(res, 200, { sucesso: true });
  } catch (err) {
    return tratarErro(res, err, 'agendamento-cliente');
  }
};
