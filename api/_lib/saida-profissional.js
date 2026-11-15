// ========================================
// 77 AGENDAPRO — Saída de um profissional: prévia, transferência dos agendamentos futuros e exclusão definitiva
// ========================================
// Usado por api/equipe.js (ações excluir-previa / excluir-profissional). Regras:
//  - o histórico (agendamentos já feitos, faturamento) NUNCA é apagado: só o cadastro, o login e o que é futuro;
//  - agendamento futuro CONFIRMADO pode passar para outro profissional (mesmo dia e horário) se ele faz todos os serviços e
//    tem o horário livre; o preço/duração passam a ser os de quem atende; o cliente é avisado. O que não der é CANCELADO e o
//    cliente é avisado. Reserva aguardando sinal é cancelada; com PAGAMENTO INFORMADO a exclusão é bloqueada (dinheiro envolvido);
//  - quem manda é o servidor: a prévia é só informação, a execução refaz toda a análise.

const { verificarSlot } = require('./disponibilidade');
const { servicoParaProfissional, profissionalRealizaServico } = require('./negocio');
const { statusEfetivo } = require('./sinal');
const { agoraBrasil, hojeChaveBrasil } = require('./tempo');
const { invalidar } = require('./cache');
const { FieldValue } = require('./firebase');

const ATIVOS = ['confirmado', 'aguardando_sinal', 'sinal_informado'];

/** Agendamentos futuros que ainda valem (vencidos de sinal não contam). */
async function futurosDe(negocioRef, profissionalId) {
  const snap = await negocioRef.collection('agendamentos').where('profissionalId', '==', profissionalId).where('dataChave', '>=', hojeChaveBrasil()).get();
  return snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((a) => ATIVOS.includes(statusEfetivo(a)))
    .sort((a, b) => (a.dataChave + a.horario).localeCompare(b.dataChave + b.horario));
}

/**
 * Decide, para cada agendamento futuro, se dá para transferir ao `destino` (ou se será cancelado).
 * Devolve { itens: [{ ag, acao: 'transferir'|'cancelar', motivo?, novo? }], bloqueio }.
 */
async function analisar({ negocioRef, info, profissionalId, destino }) {
  const futuros = await futurosDe(negocioRef, profissionalId);
  const bloqueio = futuros.some((a) => statusEfetivo(a) === 'sinal_informado')
    ? 'Há cliente que já informou o pagamento do sinal. Confira e resolva esses pagamentos antes de excluir.' : null;

  const servicosCache = new Map();
  const servico = async (id) => {
    if (!servicosCache.has(id)) servicosCache.set(id, (await negocioRef.collection('servicos').doc(String(id)).get()).data() || null);
    return servicosCache.get(id);
  };
  const agora = agoraBrasil();
  const diasCache = new Map();
  const doDia = async (dataChave) => {
    if (!diasCache.has(dataChave)) diasCache.set(dataChave, (await negocioRef.collection('agendamentos').where('dataChave', '==', dataChave).get()).docs.map((d) => ({ id: d.id, ...d.data() })));
    return diasCache.get(dataChave);
  };

  const itens = [];
  for (const ag of futuros) {
    if (!destino || statusEfetivo(ag) !== 'confirmado') {
      itens.push({ ag, acao: 'cancelar', motivo: destino ? 'Reserva ainda sem pagamento do sinal' : 'Sem transferência' });
      continue;
    }
    const docs = await Promise.all((ag.servicos || []).map((s) => servico(s.id)));
    if (docs.some((d) => !d)) { itens.push({ ag, acao: 'cancelar', motivo: 'Um dos serviços não existe mais' }); continue; }
    if (docs.some((d) => d.ativo === false || !profissionalRealizaServico(d, destino.id))) { itens.push({ ag, acao: 'cancelar', motivo: destino.nome + ' não faz todos os serviços' }); continue; }
    const novosServicos = docs.map((d, i) => ({ id: ag.servicos[i].id, nome: d.nome, ...servicoParaProfissional(d, destino.id) }));
    const duracaoMin = novosServicos.reduce((s, x) => s + x.duracaoMin, 0);
    const valorTotal = novosServicos.reduce((s, x) => s + x.preco, 0);
    const dia = await doDia(ag.dataChave);
    const v = verificarSlot({ prof: destino, info, agendamentos: dia, dataChave: ag.dataChave, horario: ag.horario, duracaoMin, agora });
    if (!v.ok) { itens.push({ ag, acao: 'cancelar', motivo: v.motivo }); continue; }
    // reserva o horário na simulação (dois agendamentos do mesmo dia não podem cair no mesmo lugar)
    dia.push({ id: ag.id, profissionalId: destino.id, dataChave: ag.dataChave, horario: ag.horario, duracaoMin, status: 'confirmado' });
    itens.push({ ag, acao: 'transferir', novo: { servicos: novosServicos, duracaoMin, valorTotal } });
  }
  return { itens, bloqueio };
}

function resumo(itens) {
  return {
    futuros: itens.length,
    transferiveis: itens.filter((i) => i.acao === 'transferir').length,
    cancelados: itens.filter((i) => i.acao === 'cancelar').length
  };
}

/** Executa a análise: transfere/cancela cada agendamento (cada um numa transação) e avisa os clientes. */
async function executar({ firestore, negocioRef, slug, info, profissional, destino, avisar }) {
  const { itens } = await analisar({ negocioRef, info, profissionalId: profissional.id, destino });
  const semApp = [];
  const feitos = { transferidos: 0, cancelados: 0 };
  const agsRef = negocioRef.collection('agendamentos');

  for (const it of itens) {
    const ag = it.ag;
    let acao = it.acao, motivo = it.motivo, valorAntes = ag.valorTotal;
    if (acao === 'transferir') {
      try {
        await firestore.runTransaction(async (tx) => {
          const dia = (await tx.get(agsRef.where('dataChave', '==', ag.dataChave))).docs.map((d) => ({ id: d.id, ...d.data() }));
          const atual = (await tx.get(agsRef.doc(ag.id))).data();
          if (!atual || statusEfetivo(atual) !== 'confirmado') throw new Error('mudou');
          const v = verificarSlot({ prof: destino, info, agendamentos: dia, dataChave: ag.dataChave, horario: ag.horario, duracaoMin: it.novo.duracaoMin, ignorarId: ag.id, agora: agoraBrasil() });
          if (!v.ok) throw new Error(v.motivo);
          tx.update(agsRef.doc(ag.id), {
            profissionalId: destino.id, profissionalNome: destino.nome || '', servicos: it.novo.servicos, duracaoMin: it.novo.duracaoMin, valorTotal: it.novo.valorTotal,
            donoVe: destino.socio !== true, transferidoDe: { profissionalId: profissional.id, nome: profissional.nome || '' }, transferidoEm: new Date().toISOString()
          });
        });
        feitos.transferidos++;
      } catch (e) { acao = 'cancelar'; motivo = e.message || 'Horário indisponível'; }
    }
    if (acao === 'cancelar') {
      await agsRef.doc(ag.id).update({ status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: 'profissional-removido', lembreteAppEm: FieldValue.delete() });
      feitos.cancelados++;
    }
    const r = await avisar(acao === 'transferir'
      ? { tipo: 'transferido', id: ag.id, ag: { ...ag, profissionalNome: destino.nome, valorTotal: it.novo.valorTotal, remarcadoDeProfissional: profissional.nome || '', valorAntes } }
      : { tipo: 'cancelado', id: ag.id, ag: { ...ag, canceladoEm: new Date().toISOString() } });
    if (!r || r.enviadas < 1) semApp.push({ nome: ag.clienteNome || '', whatsapp: ag.clienteWhatsapp, dataChave: ag.dataChave, horario: ag.horario, acao, para: acao === 'transferir' ? destino.nome : '', motivo: acao === 'cancelar' ? motivo : '' });
  }
  invalidar('ocupados:' + slug);
  return { ...feitos, semApp };
}

module.exports = { ATIVOS, futurosDe, analisar, resumo, executar };
