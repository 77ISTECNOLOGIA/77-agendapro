// ========================================
// 77 AGENDAPRO — Ações do cliente sobre o sinal por Pix (chamadas por api/agendamento-cliente.js)
// ========================================
// 'sinal-dados'   → devolve o necessário para pagar (valor, prazo, Pix "copia e cola") de uma reserva do próprio cliente
// 'sinal-informar'→ o cliente tocou em "Já paguei": a reserva passa a "sinal_informado" (não expira mais) e o dono
//                   é avisado por push. Quem confirma o recebimento é SEMPRE o dono, no painel.
// (Ficam num módulo à parte, e não numa função própria, porque o plano gratuito da Vercel limita a 12 funções.)

const { ErroNegocio } = require('./http');
const { montarPixCopiaECola } = require('./pix');
const { configSinal, statusEfetivo, calcularSinal } = require('./sinal');
const { notificarSinalInformado } = require('./notificar');

async function executarSinal({ firestore, negocioRef, agendamentoId, whatsNorm, action }) {
  const agRef = negocioRef.collection('agendamentos').doc(agendamentoId);

  if (action === 'sinal-informar') {
    let informado = null;
    let jaInformado = false;
    await firestore.runTransaction(async (tx) => {
      const ag = (await tx.get(agRef)).data();
      if (!ag || ag.clienteWhatsapp !== whatsNorm) throw new ErroNegocio(404, 'Agendamento não encontrado');
      const efetivo = statusEfetivo(ag);
      if (efetivo === 'sinal_informado') { jaInformado = true; return; }   // tocar duas vezes não faz mal
      if (efetivo === 'cancelado' && ag.status === 'aguardando_sinal') {
        throw new ErroNegocio(410, 'O prazo para pagar o sinal terminou e o horário foi liberado. Faça um novo agendamento.');
      }
      if (efetivo !== 'aguardando_sinal') throw new ErroNegocio(400, 'Este agendamento não está aguardando o pagamento do sinal.');
      tx.update(agRef, { status: 'sinal_informado', sinalInformadoEm: new Date().toISOString() });
      informado = ag;
    });
    if (informado) await notificarSinalInformado(negocioRef, agendamentoId, informado);   // falha no push não desfaz
    return { sucesso: true, jaInformado };
  }

  // sinal-dados
  const [agSnap, infoSnap] = await Promise.all([agRef.get(), negocioRef.get()]);
  const ag = agSnap.exists ? agSnap.data() : null;
  if (!ag || ag.clienteWhatsapp !== whatsNorm || !infoSnap.exists) throw new ErroNegocio(404, 'Agendamento não encontrado');
  const efetivo = statusEfetivo(ag);
  if (efetivo !== 'aguardando_sinal' && efetivo !== 'sinal_informado') {
    throw new ErroNegocio(400, 'Este agendamento não está aguardando o pagamento do sinal.');
  }
  const info = infoSnap.data();
  const cfg = configSinal(info);
  if (!cfg.chavePix) throw new ErroNegocio(409, 'O estabelecimento está sem chave Pix configurada. Fale direto com eles.');
  const valor = ag.sinalValor || calcularSinal(ag.valorTotal, ag.sinalPercentual || cfg.percentual);
  return {
    status: efetivo,
    valor,
    expiraEm: ag.sinalExpiraEm || null,
    recebedor: cfg.nomeRecebedor,
    banco: cfg.banco,
    telefoneNegocio: info.telefone || '',
    pixCopiaECola: montarPixCopiaECola({ chave: cfg.chavePix, valor, nome: cfg.nomeRecebedor, cidade: cfg.cidadeRecebedor, txid: agendamentoId }),
    agendamento: {
      id: agendamentoId, dataChave: ag.dataChave, horario: ag.horario, profissionalNome: ag.profissionalNome,
      servicos: ag.servicos, valorTotal: ag.valorTotal
    }
  };
}

module.exports = { executarSinal };
