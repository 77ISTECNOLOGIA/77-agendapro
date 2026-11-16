// ========================================
// 77 AGENDAPRO — Clube de assinatura (pacote mensal com controle de uso)
// ========================================
// O dono cria PLANOS (nome, preço mensal, serviços incluídos, usos por mês ou ilimitado) e cadastra os ASSINANTES depois de
// receber o pagamento (Pix direto na conta dele, dinheiro...): a 77 IS não toca no dinheiro.
//   barbearias/{slug}/planos/{id}       = { nome, preco, usosPorMes (0 = ilimitado), servicosIds[], ativo }
//   barbearias/{slug}/assinaturas/{id}  = { clienteWhatsapp, clienteNome, planoId, planoNome, preco, usosPorMes, servicosIds[],
//                                           cicloInicio, venceEm (início + 30 dias), status: 'ativa'|'cancelada', pagamentos[] }
// As duas coleções NÃO têm regra no Firestore: só o servidor lê e grava (o painel usa a API).
//
// REGRA DE USO — sem contador a manter: o saldo vem dos próprios agendamentos (`assinaturaId`). Dentro do ciclo, atendimento
// CONCLUÍDO consome 1 uso e agendamento ainda marcado RESERVA 1 (cancelar/faltar devolve). Agendamento é coberto pelo plano só
// se TODOS os serviços escolhidos estão no plano, a data cai dentro do ciclo e ainda há saldo; aí vale R$ 0 (o dinheiro entrou
// na venda do plano). Fora disso o cliente paga o preço normal.

const { statusEfetivo } = require('./sinal');
const { hojeChaveBrasil, somarDias, normalizarWhatsapp, whatsappValido } = require('./tempo');
const { enviarParaCliente } = require('./lembrete');
const { situacaoNegocio } = require('./negocio');
const { ErroNegocio } = require('./http');
const { FieldValue } = require('./firebase');

const DIAS_CICLO = 30;
const DIAS_AVISO_VENCIMENTO = 3;
const JANELA_RENOVAR_DIAS = 5;                  // dá para renovar nos últimos 5 dias do ciclo (ou depois de vencido)
const ATIVOS = ['confirmado', 'aguardando_sinal', 'sinal_informado'];
const FORMAS = ['pix', 'dinheiro', 'cartao', 'outro'];

const texto = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------------------------------------------------------------- regras puras
function cicloVale(ass, dataChave) {
  return !!ass && ass.status === 'ativa' && dataChave >= ass.cicloInicio && dataChave <= ass.venceEm;
}

/** Saldo do ciclo a partir dos agendamentos ligados à assinatura. `restantes` = null quando o plano é ilimitado. */
function saldoDe(ass, agendamentos, { ignorarId } = {}) {
  const doCiclo = (agendamentos || []).filter((a) => a.id !== ignorarId && a.dataChave >= ass.cicloInicio && a.dataChave <= ass.venceEm);
  const usados = doCiclo.filter((a) => a.status === 'concluido').length;
  const reservados = doCiclo.filter((a) => ATIVOS.includes(statusEfetivo(a))).length;
  const restantes = ass.usosPorMes > 0 ? Math.max(0, ass.usosPorMes - usados - reservados) : null;
  return { usados, reservados, restantes, ilimitado: !(ass.usosPorMes > 0) };
}

const temSaldo = (s) => s.ilimitado || s.restantes > 0;

function validarPlano(b, servicosValidos) {
  const nome = texto(b.nome, 60);
  const preco = Number(b.preco);
  const usosPorMes = Math.round(Number(b.usosPorMes || 0));
  const servicosIds = Array.isArray(b.servicosIds) ? [...new Set(b.servicosIds.map(String))] : [];
  if (nome.length < 2) throw new ErroNegocio(400, 'Dê um nome ao plano.');
  if (!Number.isFinite(preco) || preco <= 0 || preco > 10000) throw new ErroNegocio(400, 'O preço mensal deve ser maior que zero.');
  if (!Number.isInteger(usosPorMes) || usosPorMes < 0 || usosPorMes > 60) throw new ErroNegocio(400, 'Usos por mês: de 1 a 60, ou 0 para ilimitado.');
  if (!servicosIds.length || servicosIds.some((id) => !servicosValidos.has(id))) throw new ErroNegocio(400, 'Escolha ao menos um serviço do plano.');
  return { nome, preco: Math.round(preco * 100) / 100, usosPorMes, servicosIds, ativo: b.ativo !== false };
}

// ---------------------------------------------------------------- leitura
async function assinaturasDe(negocioRef, whatsapp) {
  const snap = await negocioRef.collection('assinaturas').where('clienteWhatsapp', '==', whatsapp).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Assinatura ativa do cliente que cobre a data (a de vencimento mais longe, se houver mais de uma). */
async function buscarAssinatura(negocioRef, whatsapp, dataChave) {
  const doCliente = (await assinaturasDe(negocioRef, whatsapp)).filter((a) => cicloVale(a, dataChave));
  doCliente.sort((a, b) => String(b.venceEm).localeCompare(String(a.venceEm)));
  return doCliente[0] || null;
}

async function agendamentosDaAssinatura(negocioRef, assinaturaId) {
  const snap = await negocioRef.collection('agendamentos').where('assinaturaId', '==', assinaturaId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Este agendamento fica coberto pelo plano? { coberto, assinatura?, saldo? }.
 * `ignorarId` = o próprio agendamento (remarcação não conta contra si).
 */
async function avaliarCobertura({ negocioRef, whatsapp, servicosIds, dataChave, ignorarId }) {
  const ass = await buscarAssinatura(negocioRef, whatsapp, dataChave);
  if (!ass) return { coberto: false };
  if (!servicosIds.length || !servicosIds.every((id) => (ass.servicosIds || []).includes(id))) return { coberto: false, assinatura: ass };
  const saldo = saldoDe(ass, await agendamentosDaAssinatura(negocioRef, ass.id), { ignorarId });
  return { coberto: temSaldo(saldo), assinatura: ass, saldo };
}

/** Resumo para o cliente (link): o que ele tem hoje. */
async function resumoParaCliente(negocioRef, whatsapp, hojeChave = hojeChaveBrasil()) {
  const ass = await buscarAssinatura(negocioRef, whatsapp, hojeChave);
  if (!ass) return { ativa: false };
  const saldo = saldoDe(ass, await agendamentosDaAssinatura(negocioRef, ass.id));
  return {
    ativa: true, planoNome: ass.planoNome, servicosIds: ass.servicosIds, venceEm: ass.venceEm, cicloInicio: ass.cicloInicio,
    usosPorMes: ass.usosPorMes, usados: saldo.usados, reservados: saldo.reservados, restantes: saldo.restantes, ilimitado: saldo.ilimitado
  };
}

// ---------------------------------------------------------------- ações do painel (só o dono)
async function listar({ negocioRef }) {
  const hoje = hojeChaveBrasil();
  const [planosSnap, assSnap] = await Promise.all([negocioRef.collection('planos').get(), negocioRef.collection('assinaturas').get()]);
  const planos = planosSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const ags = (await Promise.all(assSnap.docs.map((d) => agendamentosDaAssinatura(negocioRef, d.id))));
  const assinantes = assSnap.docs.map((d, i) => {
    const a = { id: d.id, ...d.data() };
    const saldo = saldoDe(a, ags[i]);
    const vencida = a.status === 'ativa' && a.venceEm < hoje;
    return {
      id: a.id, clienteNome: a.clienteNome, clienteWhatsapp: a.clienteWhatsapp, planoNome: a.planoNome, preco: a.preco, usosPorMes: a.usosPorMes,
      cicloInicio: a.cicloInicio, venceEm: a.venceEm, status: a.status === 'ativa' ? (vencida ? 'vencida' : 'ativa') : a.status,
      usados: saldo.usados, reservados: saldo.reservados, ilimitado: saldo.ilimitado,
      diasParaVencer: Math.round((Date.parse(a.venceEm + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 86400000),
      podeRenovar: a.status === 'ativa' && a.venceEm <= somarDias(hoje, JANELA_RENOVAR_DIAS)
    };
  }).sort((a, b) => String(a.venceEm).localeCompare(String(b.venceEm)));
  const ativas = assinantes.filter((a) => a.status === 'ativa');
  return { planos, assinantes, kpis: { assinantesAtivos: ativas.length, receitaRecorrente: Math.round(ativas.reduce((s, a) => s + (Number(a.preco) || 0), 0) * 100) / 100 } };
}

async function salvarPlano({ negocioRef }, b) {
  const servicosSnap = await negocioRef.collection('servicos').get();
  const dados = validarPlano(b.plano || {}, new Set(servicosSnap.docs.map((d) => d.id)));
  const ref = b.plano && b.plano.id ? negocioRef.collection('planos').doc(String(b.plano.id)) : negocioRef.collection('planos').doc();
  if (b.plano && b.plano.id && !(await ref.get()).exists) throw new ErroNegocio(404, 'Plano não encontrado.');
  if (b.plano && b.plano.id) await ref.update(dados); else await ref.set({ ...dados, criadoEm: new Date().toISOString() });
  return { sucesso: true, id: ref.id };
}

async function assinar({ negocioRef }, b) {
  const whatsapp = normalizarWhatsapp(b.whatsapp);
  const nome = texto(b.nome, 80);
  if (nome.length < 2) throw new ErroNegocio(400, 'Informe o nome do cliente.');
  if (!whatsappValido(whatsapp)) throw new ErroNegocio(400, 'WhatsApp inválido.');
  const forma = FORMAS.includes(b.forma) ? b.forma : 'pix';
  const plano = (await negocioRef.collection('planos').doc(String(b.planoId || '_')).get()).data();
  if (!plano || plano.ativo === false) throw new ErroNegocio(404, 'Plano não encontrado ou desativado.');
  const hoje = hojeChaveBrasil();
  const jaTem = (await assinaturasDe(negocioRef, whatsapp)).some((a) => a.status === 'ativa' && a.venceEm >= hoje);
  if (jaTem) throw new ErroNegocio(409, 'Esse cliente já tem uma assinatura ativa. Use "Registrar renovação" quando ela estiver perto de vencer.');
  const ref = negocioRef.collection('assinaturas').doc();
  await ref.set({
    clienteWhatsapp: whatsapp, clienteNome: nome, planoId: String(b.planoId), planoNome: plano.nome, preco: plano.preco, usosPorMes: plano.usosPorMes,
    servicosIds: plano.servicosIds, cicloInicio: hoje, venceEm: somarDias(hoje, DIAS_CICLO), status: 'ativa',
    pagamentos: [{ em: new Date().toISOString(), valor: plano.preco, forma }], criadoEm: new Date().toISOString()
  });
  return { sucesso: true, id: ref.id };
}

async function renovar({ negocioRef }, b) {
  const ref = negocioRef.collection('assinaturas').doc(String(b.id || '_'));
  const a = (await ref.get()).data();
  if (!a) throw new ErroNegocio(404, 'Assinatura não encontrada.');
  if (a.status !== 'ativa') throw new ErroNegocio(409, 'Essa assinatura foi cancelada. Cadastre o cliente de novo no plano.');
  const hoje = hojeChaveBrasil();
  if (a.venceEm > somarDias(hoje, JANELA_RENOVAR_DIAS)) throw new ErroNegocio(409, `Só dá para renovar nos últimos ${JANELA_RENOVAR_DIAS} dias do ciclo (vence em ${a.venceEm.slice(8, 10)}/${a.venceEm.slice(5, 7)}).`);
  const forma = FORMAS.includes(b.forma) ? b.forma : 'pix';
  // usa o plano como está agora (preço e serviços atuais); o saldo recomeça
  const plano = (await negocioRef.collection('planos').doc(a.planoId).get()).data();
  const novo = plano && plano.ativo !== false ? { planoNome: plano.nome, preco: plano.preco, usosPorMes: plano.usosPorMes, servicosIds: plano.servicosIds } : {};
  await ref.update({ ...novo, cicloInicio: hoje, venceEm: somarDias(hoje, DIAS_CICLO), pagamentos: [...(a.pagamentos || []), { em: new Date().toISOString(), valor: novo.preco !== undefined ? novo.preco : a.preco, forma }], avisoVencimentoEm: FieldValue.delete() });
  return { sucesso: true };
}

async function cancelar({ negocioRef }, b) {
  const ref = negocioRef.collection('assinaturas').doc(String(b.id || '_'));
  if (!(await ref.get()).exists) throw new ErroNegocio(404, 'Assinatura não encontrada.');
  await ref.update({ status: 'cancelada', canceladaEm: new Date().toISOString() });
  return { sucesso: true };
}

/** Despacha as ações `clube-*` (o dono já foi autenticado e checado por quem chama). */
async function executarAcao(ctx, b) {
  switch (b.action) {
    case 'clube-listar': return listar(ctx);
    case 'clube-plano': return salvarPlano(ctx, b);
    case 'clube-assinar': return assinar(ctx, b);
    case 'clube-renovar': return renovar(ctx, b);
    case 'clube-cancelar': return cancelar(ctx, b);
    default: throw new ErroNegocio(400, 'Ação inválida.');
  }
}

// ---------------------------------------------------------------- aviso de vencimento (rotina diária)
async function avisarVencimentos({ firestore, hojeChave = hojeChaveBrasil() } = {}) {
  const alvo = somarDias(hojeChave, DIAS_AVISO_VENCIMENTO);
  const snap = await firestore.collectionGroup('assinaturas').where('venceEm', '==', alvo).limit(500).get();
  const resumo = { vencendo: snap.size, avisados: 0 };
  const negocios = new Map();
  for (const d of snap.docs) {
    const a = d.data();
    if (a.status !== 'ativa' || a.avisoVencimentoEm === alvo) continue;
    const negocioRef = d.ref.parent.parent;
    if (!negocios.has(negocioRef.id)) negocios.set(negocioRef.id, (await negocioRef.get()).data() || null);
    const info = negocios.get(negocioRef.id);
    if (!info || !situacaoNegocio(info).aceita) continue;
    const r = await enviarParaCliente(negocioRef, a.clienteWhatsapp, {
      titulo: '🎟️ Seu plano vence em 3 dias',
      corpo: [info.nome || 'Seu estabelecimento', `${a.planoNome}: vence em ${alvo.slice(8, 10)}/${alvo.slice(5, 7)}.`, 'Fale com o estabelecimento para renovar.'].join('\n'),
      tag: `plano-vence-${d.id}-${alvo}`
    });
    await d.ref.update({ avisoVencimentoEm: alvo });
    if (r.enviadas > 0) resumo.avisados++;
  }
  return resumo;
}

module.exports = {
  DIAS_CICLO, ATIVOS, cicloVale, saldoDe, temSaldo, validarPlano, buscarAssinatura, agendamentosDaAssinatura, avaliarCobertura,
  resumoParaCliente, executarAcao, avisarVencimentos
};
