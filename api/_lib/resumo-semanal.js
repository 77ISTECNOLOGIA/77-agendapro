// ========================================
// 77 AGENDAPRO — Resumo semanal do dono (push, segunda de manhã)
// ========================================
// Toda segunda-feira (rotina diária, 06:00 de Brasília) cada dono recebe um resumo da semana que passou (segunda a domingo),
// comparado com a anterior: faturamento, atendimentos, ticket médio, melhor dia, faltas/cancelados e quantos clientes estão
// para chamar de volta (ver retorno.js). Sócio recebe o resumo da PRÓPRIA agenda, só nos aparelhos dele (privacidade: o dono
// não vê números de sócio). Negócio pode desligar (`resumoSemanal: false`); semana sem movimento não manda nada.

const { db } = require('./firebase');
const { hojeChaveBrasil, somarDias, diaSemanaDaChave } = require('./tempo');
const { situacaoNegocio } = require('./negocio');
const { enviarParaDispositivos } = require('./notificar');

const NOMES_DIA = { domingo: 'domingo', segunda: 'segunda', terca: 'terça', quarta: 'quarta', quinta: 'quinta', sexta: 'sexta', sabado: 'sábado' };
const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0).replace(/ /g, ' ');
const dm = (chave) => { const [, m, d] = chave.split('-'); return d + '/' + m; };

function periodos(hojeChave) {
  const fim = somarDias(hojeChave, -1), ini = somarDias(hojeChave, -7);
  return { ini, fim, antIni: somarDias(ini, -7), antFim: somarDias(ini, -1) };
}

function metricas(ags) {
  const concluidos = ags.filter((a) => a.status === 'concluido');
  const faturamento = concluidos.reduce((s, a) => s + (Number(a.valorTotal) || 0), 0);
  const faltas = ags.filter((a) => a.status === 'cancelado' && a.motivoCancelamento === 'nao-compareceu').length;
  const cancelados = ags.filter((a) => a.status === 'cancelado').length - faltas;
  const porDia = {};
  concluidos.forEach((a) => { const dia = diaSemanaDaChave(a.dataChave); porDia[dia] = (porDia[dia] || 0) + (Number(a.valorTotal) || 0); });
  const melhor = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];
  return {
    faturamento, atendimentos: concluidos.length, ticket: concluidos.length ? faturamento / concluidos.length : 0,
    faltas, cancelados, clientes: new Set(concluidos.map((a) => a.clienteWhatsapp)).size,
    melhorDia: melhor ? { nome: NOMES_DIA[melhor[0]], valor: melhor[1] } : null
  };
}

/** Texto do resumo (uma informação por linha). `ags` = agendamentos das duas semanas; só entram os de [antIni, fim]. */
function montarResumo(ags, hojeChave, extras = {}) {
  const p = periodos(hojeChave);
  const dessa = metricas(ags.filter((a) => a.dataChave >= p.ini && a.dataChave <= p.fim));
  const anterior = metricas(ags.filter((a) => a.dataChave >= p.antIni && a.dataChave <= p.antFim));
  const semMovimento = !dessa.atendimentos && !dessa.cancelados && !dessa.faltas;
  const var_ = anterior.faturamento > 0 ? Math.round(((dessa.faturamento - anterior.faturamento) / anterior.faturamento) * 100) : null;
  const linhas = [`Faturamento: ${brl(dessa.faturamento)}${var_ === null ? '' : ` (${var_ >= 0 ? '+' : ''}${var_}% vs semana anterior)`}`,
    `Atendimentos: ${dessa.atendimentos} · Ticket médio: ${brl(dessa.ticket)}`];
  if (dessa.melhorDia) linhas.push(`Melhor dia: ${dessa.melhorDia.nome} (${brl(dessa.melhorDia.valor)})`);
  if (dessa.faltas || dessa.cancelados) linhas.push(`Faltas: ${dessa.faltas} · Cancelados: ${dessa.cancelados}`);
  if (extras.voltar) linhas.push(`Para chamar de volta: ${extras.voltar} cliente${extras.voltar === 1 ? '' : 's'}`);
  return { titulo: `📊 Sua semana (${dm(p.ini)} a ${dm(p.fim)})`, corpo: linhas.join('\n'), semMovimento, dessa, anterior };
}

async function resumoDoNegocio(firestore, negocioDoc, hojeChave) {
  const info = negocioDoc.data();
  if (info.resumoSemanal === false || !situacaoNegocio(info).aceita) return { enviados: 0 };
  const p = periodos(hojeChave);
  const negocioRef = negocioDoc.ref;
  const snap = await negocioRef.collection('agendamentos').where('dataChave', '>=', p.antIni).where('dataChave', '<=', p.fim).get();
  const todos = snap.docs.map((d) => d.data());
  let enviados = 0;

  // dono: agenda do lado dele (donoVe != false) + clientes para chamar de volta
  const voltarSnap = await negocioRef.collection('clientes').where('donoVe', '==', true).where('retornoEm', '>=', somarDias(hojeChave, -120)).where('retornoEm', '<=', hojeChave).get();
  const doDono = montarResumo(todos.filter((a) => a.donoVe !== false), hojeChave, { voltar: voltarSnap.size });
  if (!doDono.semMovimento) {
    const r = await enviarParaDispositivos(negocioRef, { titulo: doDono.titulo, corpo: doDono.corpo, tag: `resumo-${hojeChave}`, link: `${process.env.APP_URL || 'https://77-agendapro.vercel.app'}/admin` });
    enviados += r.enviadas;
  }
  // sócios: a própria agenda, só nos aparelhos deles
  const profs = await negocioRef.collection('profissionais').get();
  for (const pr of profs.docs.filter((x) => x.data().socio === true)) {
    const r = montarResumo(todos.filter((a) => a.donoVe === false && a.profissionalId === pr.id), hojeChave);
    if (r.semMovimento) continue;
    const env = await enviarParaDispositivos(negocioRef, { titulo: r.titulo, corpo: r.corpo, tag: `resumo-${hojeChave}-${pr.id}`, profissionalId: pr.id, link: `${process.env.APP_URL || 'https://77-agendapro.vercel.app'}/admin` });
    enviados += env.enviadas;
  }
  return { enviados };
}

/** Envia o resumo a todos os negócios (em lotes de 5). Só deve ser chamada na segunda (a rotina confere). */
async function enviarResumos({ firestore = db(), hojeChave = hojeChaveBrasil() } = {}) {
  const negocios = await firestore.collection('barbearias').get();
  const total = { negocios: 0, enviados: 0, erros: 0 };
  const lote = 5;
  for (let i = 0; i < negocios.docs.length; i += lote) {
    await Promise.all(negocios.docs.slice(i, i + lote).map(async (n) => {
      try { const r = await resumoDoNegocio(firestore, n, hojeChave); total.negocios++; total.enviados += r.enviados; }
      catch (err) { total.erros++; console.error('Falha no resumo semanal de ' + n.id, err); }
    }));
  }
  return total;
}

module.exports = { periodos, metricas, montarResumo, enviarResumos };
