// ========================================
// 77 AGENDAPRO — Retorno inteligente: avisa quando o cliente passa do tempo em que costuma voltar
// ========================================
// Cada cliente tem o PRÓPRIO ritmo: o sistema olha as datas dos últimos atendimentos concluídos e calcula de quanto em quanto
// tempo ele costuma voltar (média das últimas diferenças; sem histórico suficiente, 30 dias). Quando passa desse prazo sem ter
// horário marcado:
//   - o dono vê o cliente no cartão "Clientes para chamar de volta" do Dashboard (botão de WhatsApp com mensagem pronta);
//   - se o cliente tem o app instalado, recebe um push ("Faz N dias desde o seu último atendimento").
//
// Sem varrer o histórico: a rotina diária só lê os atendimentos concluídos nas últimas ~40 h (índice de grupo em
// `concluidoEm`) e atualiza a ficha do cliente (clientes/{id}): ultimasVisitas (até 6 datas), cadenciaDias, retornoEm (data do
// retorno esperado) e retornoPushEm (data em que o push deve ser tentado; apagado depois de tratado, para não ser relido).
// Tudo idempotente.

const { db, FieldValue } = require('./firebase');
const { hojeChaveBrasil, somarDias } = require('./tempo');
const { enviarParaCliente } = require('./lembrete');
const { situacaoNegocio } = require('./negocio');
const { statusEfetivo } = require('./sinal');

const PADRAO_DIAS = 30, MIN_DIAS = 14, MAX_DIAS = 90, MAX_VISITAS = 6, JANELA_HORAS = 40;

function diasEntre(a, b) {
  const t = (c) => { const [y, m, d] = c.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/**
 * Ritmo do cliente. `visitas` = datas (AAAA-MM-DD) de atendimentos concluídos, em qualquer ordem.
 * Devolve { ultima, cadenciaDias, personalizada, retornoEm } ou null se não há nenhuma visita.
 */
function calcularRetorno(visitas, padraoDias = PADRAO_DIAS) {
  const datas = [...new Set((visitas || []).filter(Boolean))].sort();
  if (!datas.length) return null;
  const ultima = datas[datas.length - 1];
  const limitar = (n) => Math.min(MAX_DIAS, Math.max(MIN_DIAS, Math.round(n)));
  let cadenciaDias, personalizada = false;
  if (datas.length >= 2) {
    const ultimos = datas.slice(-4);                              // até 3 intervalos recentes
    const intervalos = ultimos.slice(1).map((d, i) => diasEntre(ultimos[i], d)).filter((n) => n > 0);
    if (intervalos.length) { cadenciaDias = limitar(intervalos.reduce((s, n) => s + n, 0) / intervalos.length); personalizada = true; }
  }
  if (cadenciaDias === undefined) cadenciaDias = limitar(padraoDias);
  return { ultima, cadenciaDias, personalizada, retornoEm: somarDias(ultima, cadenciaDias) };
}

/** Atualiza as fichas dos clientes com os atendimentos concluídos recentemente. */
async function atualizarEstatisticas({ firestore = db(), horas = JANELA_HORAS } = {}) {
  const desde = new Date(Date.now() - horas * 3600000).toISOString();
  const snap = await firestore.collectionGroup('agendamentos').where('concluidoEm', '>=', desde).limit(1000).get();
  const grupos = new Map();
  for (const d of snap.docs) {
    const ag = d.data();
    if (ag.status !== 'concluido' || !ag.clienteWhatsapp || !ag.dataChave) continue;
    const negocioRef = d.ref.parent.parent;
    // a ficha de cliente de sócio é separada (id = profissional__whatsapp); a do dono, só o WhatsApp
    const clienteId = ag.donoVe === false ? `${ag.profissionalId}__${ag.clienteWhatsapp}` : ag.clienteWhatsapp;
    const chave = negocioRef.id + '|' + clienteId;
    if (!grupos.has(chave)) grupos.set(chave, { negocioRef, clienteId, datas: [] });
    grupos.get(chave).datas.push(ag.dataChave);
  }
  let atualizadas = 0;
  for (const g of grupos.values()) {
    const ref = g.negocioRef.collection('clientes').doc(g.clienteId);
    const c = (await ref.get()).data();
    if (!c) continue;
    const antes = [...(c.ultimasVisitas || [])];
    const visitas = [...new Set([...antes, ...g.datas])].sort().slice(-MAX_VISITAS);
    if (JSON.stringify(visitas) === JSON.stringify(antes)) continue;            // nada novo (rodada repetida)
    const r = calcularRetorno(visitas);
    const novaVisita = !antes.length || r.ultima > antes[antes.length - 1];
    await ref.update({
      ultimasVisitas: visitas, cadenciaDias: r.cadenciaDias, cadenciaPersonalizada: r.personalizada, retornoEm: r.retornoEm,
      ...(novaVisita ? { retornoPushEm: r.retornoEm, retornoAvisadoEm: FieldValue.delete(), retornoAdiadoAte: FieldValue.delete() } : {})
    });
    atualizadas++;
  }
  return { concluidos: snap.size, atualizadas };
}

/** Push aos clientes (com o app) que passaram do tempo de voltar. Cada ciclo avisa no máximo uma vez. */
async function avisarRetornos({ firestore = db(), hojeChave = hojeChaveBrasil() } = {}) {
  const snap = await firestore.collectionGroup('clientes').where('retornoPushEm', '<=', hojeChave).limit(500).get();
  const negocios = new Map();
  const infoDe = async (ref) => { if (!negocios.has(ref.id)) negocios.set(ref.id, (await ref.get()).data() || null); return negocios.get(ref.id); };
  const resumo = { vencidos: snap.size, avisados: 0, semApp: 0, descartados: 0 };
  for (const d of snap.docs) {
    const c = d.data();
    const negocioRef = d.ref.parent.parent;
    const limpar = (extra = {}) => d.ref.update({ retornoPushEm: FieldValue.delete(), ...extra });
    try {
      const info = await infoDe(negocioRef);
      if (!info || info.retornoAutomatico === false || !situacaoNegocio(info).aceita || !c.whatsapp) { await limpar(); resumo.descartados++; continue; }
      const todos = await negocioRef.collection('agendamentos').where('clienteWhatsapp', '==', c.whatsapp).get();
      const temFuturo = todos.docs.some((a) => a.data().dataChave >= hojeChave && ['confirmado', 'aguardando_sinal', 'sinal_informado'].includes(statusEfetivo(a.data())));
      if (temFuturo) { await limpar(); resumo.descartados++; continue; }
      const dias = c.ultimasVisitas && c.ultimasVisitas.length ? diasEntre(c.ultimasVisitas[c.ultimasVisitas.length - 1], hojeChave) : c.cadenciaDias;
      const r = await enviarParaCliente(negocioRef, c.whatsapp, {
        titulo: '👋 Sentimos sua falta',
        corpo: [info.nome || 'Seu estabelecimento', `Faz ${dias} dias desde o seu último atendimento.`, 'Toque para agendar.'].join('\n'),
        tag: `retorno-${hojeChave}-${d.id}`
      });
      await limpar({ retornoAvisadoEm: new Date().toISOString() });
      if (r.enviadas > 0) resumo.avisados++; else resumo.semApp++;
    } catch (err) {
      console.error('Falha no aviso de retorno de ' + d.id, err);              // fica para a próxima rodada
    }
  }
  return resumo;
}

module.exports = { PADRAO_DIAS, MIN_DIAS, MAX_DIAS, diasEntre, calcularRetorno, atualizarEstatisticas, avisarRetornos };
