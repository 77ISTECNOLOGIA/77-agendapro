// ========================================
// 77 AGENDAPRO — Cliente fixo: horário que se repete toda semana (lógica compartilhada)
// ========================================
// Uma "série" (barbearias/{slug}/recorrencias/{id}) descreve: cliente, profissional, serviços,
// dia da semana e horário. Cada data vira um AGENDAMENTO NORMAL (com `recorrenciaId`), então
// lembrete, notificação, concluir, cancelar e remarcar funcionam como em qualquer outro.
//
// Renovação automática: sempre se mantém agendado o mês corrente; a partir do dia
// DIA_RENOVACAO já se gera também o mês seguinte (o dono vê a agenda de quem é fixo
// antes de outros clientes ocuparem o horário). Quem renova: rotina diária (api/cron-recorrencias)
// e, como reforço, a abertura do painel do dono.
//
// Regras que NUNCA mudam:
//  - data que já tem agendamento da série (mesmo cancelado) não é recriada: se o cliente ou o dono
//    cancelou aquela sexta, ela fica cancelada;
//  - data sem vaga (ocupada, folga, fora do expediente) é PULADA e registrada, nunca sobrescreve;
//  - cada data passa pela mesma validação de disponibilidade do servidor, dentro de uma transação.

const { agoraBrasil, somarDias, diaSemanaDaChave, DIAS_SEMANA } = require('./tempo');
const { verificarSlot } = require('./disponibilidade');
const { situacaoNegocio, profissionalRealizaServico } = require('./negocio');

const DIA_RENOVACAO = 20;       // a partir deste dia do mês, já gera o mês seguinte
const MAX_DATAS_POR_GERACAO = 70;
const MAX_PULADAS_GUARDADAS = 30;

/** Último dia do mês de uma data AAAA-MM-DD (mesesAFrente = 1 → fim do mês seguinte). */
function fimDoMes(dataChave, mesesAFrente = 0) {
  const [ano, mes] = dataChave.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1 + mesesAFrente + 1, 0)).toISOString().slice(0, 10);
}

/** Até que data gerar hoje: fim do mês (ou do próximo, a partir do dia 20), respeitando "até". */
function limiteDeGeracao(hojeChave, { ate } = {}) {
  const dia = Number(hojeChave.slice(8, 10));
  const limite = fimDoMes(hojeChave, dia >= DIA_RENOVACAO ? 1 : 0);
  return ate && ate < limite ? ate : limite;
}

/** Datas (AAAA-MM-DD) de um dia da semana (0=domingo) entre `inicio` e `limite`, inclusive. */
function datasDaSerie({ diaSemana, inicio, limite }) {
  const datas = [];
  let d = inicio;
  for (let i = 0; i < 7 && DIAS_SEMANA.indexOf(diaSemanaDaChave(d)) !== diaSemana; i++) d = somarDias(d, 1);
  while (d <= limite && datas.length < MAX_DATAS_POR_GERACAO) { datas.push(d); d = somarDias(d, 7); }
  return datas;
}

/** Carrega profissional e serviços ATUAIS (preço/duração podem ter mudado). { erro } se algo não serve mais. */
async function carregarContexto(negocioRef, serie) {
  const [profSnap, ...servSnaps] = await Promise.all([
    negocioRef.collection('profissionais').doc(serie.profissionalId).get(),
    ...serie.servicosIds.map((id) => negocioRef.collection('servicos').doc(id).get())
  ]);
  if (!profSnap.exists || profSnap.data().ativo === false) return { erro: 'Profissional indisponível' };

  const servicos = [];
  for (const s of servSnaps) {
    const d = s.data();
    if (!s.exists || d.ativo === false || !Number.isFinite(d.preco) || !Number.isFinite(d.duracaoMin) || d.duracaoMin <= 0) {
      return { erro: 'Um dos serviços foi removido ou desativado' };
    }
    if (!profissionalRealizaServico(d, serie.profissionalId)) {
      return { erro: `${d.nome} não é mais realizado por este profissional` };
    }
    servicos.push({ id: s.id, nome: d.nome, preco: d.preco, duracaoMin: d.duracaoMin });
  }
  return {
    prof: { id: profSnap.id, ...profSnap.data() },
    servicos,
    duracaoMin: servicos.reduce((t, s) => t + s.duracaoMin, 0),
    valorTotal: servicos.reduce((t, s) => t + s.preco, 0)
  };
}

/**
 * Gera (ou, com `previa`, só simula) os agendamentos de uma série até o limite de geração.
 * @returns {{criadas: string[], puladas: {dataChave:string, motivo:string}[], datas?: object[], limite: string|null, erro?: string}}
 */
async function gerarOcorrencias({ firestore, negocioRef, info, serieId, serie, hojeChave, agora = agoraBrasil(), previa = false }) {
  const ctx = await carregarContexto(negocioRef, serie);
  if (ctx.erro) return { criadas: [], puladas: [], datas: [], limite: null, erro: ctx.erro };

  const limite = limiteDeGeracao(hojeChave, { ate: serie.ate });
  const inicio = serie.inicio > hojeChave ? serie.inicio : hojeChave;
  const datas = datasDaSerie({ diaSemana: serie.diaSemana, inicio, limite });
  const agsRef = negocioRef.collection('agendamentos');

  const jaGeradas = new Set();
  if (serieId) {
    (await agsRef.where('recorrenciaId', '==', serieId).get()).docs.forEach((d) => jaGeradas.add(d.data().dataChave));
  }

  const resultado = { criadas: [], puladas: [], datas: [], limite };
  const base = {
    clienteWhatsapp: serie.clienteWhatsapp,
    clienteNome: serie.clienteNome,
    profissionalId: ctx.prof.id,
    profissionalNome: ctx.prof.nome || '',
    servicos: ctx.servicos,
    horario: serie.horario,
    duracaoMin: ctx.duracaoMin,
    valorTotal: ctx.valorTotal,
    status: 'confirmado',
    origem: 'dono-recorrente',
    recorrenciaId: serieId || null
  };

  for (const dataChave of datas) {
    if (jaGeradas.has(dataChave)) { resultado.datas.push({ dataChave, ok: true, jaExiste: true }); continue; }

    if (previa) {
      const dia = (await agsRef.where('dataChave', '==', dataChave).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
      const v = verificarSlot({ prof: ctx.prof, info, agendamentos: dia, dataChave, horario: serie.horario, duracaoMin: ctx.duracaoMin, agora });
      resultado.datas.push(v.ok ? { dataChave, ok: true } : { dataChave, ok: false, motivo: v.motivo });
      continue;
    }

    const novoRef = agsRef.doc();
    const r = await firestore.runTransaction(async (tx) => {
      const dia = (await tx.get(agsRef.where('dataChave', '==', dataChave))).docs.map((d) => ({ id: d.id, ...d.data() }));
      // outra execução (rotina diária x abertura do painel) pode ter criado esta data um instante antes
      if (serieId && dia.some((a) => a.recorrenciaId === serieId)) return { jaExiste: true };
      const v = verificarSlot({ prof: ctx.prof, info, agendamentos: dia, dataChave, horario: serie.horario, duracaoMin: ctx.duracaoMin, agora });
      if (!v.ok) return { motivo: v.motivo };
      tx.set(novoRef, { ...base, dataChave, criadoEm: new Date().toISOString() });
      return { criada: true };
    });

    if (r.criada) { resultado.criadas.push(dataChave); resultado.datas.push({ dataChave, ok: true }); }
    else if (r.motivo) { resultado.puladas.push({ dataChave, motivo: r.motivo }); resultado.datas.push({ dataChave, ok: false, motivo: r.motivo }); }
  }
  return resultado;
}

/**
 * Lista de datas puladas guardada na série: sem repetidas (a mesma data é tentada de novo a cada
 * renovação, e pode ter vaga mais tarde), sem datas que já passaram e sem as que acabaram de ser criadas.
 */
function atualizarPuladas(anteriores, resultado, hojeChave) {
  const porData = new Map((anteriores || []).filter((p) => p.dataChave >= hojeChave).map((p) => [p.dataChave, p]));
  resultado.puladas.forEach((p) => porData.set(p.dataChave, p));
  resultado.criadas.forEach((d) => porData.delete(d));
  return [...porData.values()].sort((a, b) => a.dataChave.localeCompare(b.dataChave)).slice(-MAX_PULADAS_GUARDADAS);
}

/**
 * Renova TODAS as séries ativas de um negócio. Idempotente: rodar duas vezes não duplica nada.
 * Encerra sozinha a série "até uma data" cuja data já passou.
 */
async function renovarSeries({ firestore, negocioRef, info, hojeChave, agora = agoraBrasil() }) {
  const resumo = { series: 0, criadas: 0, puladas: 0, erros: 0, encerradas: 0 };
  if (!situacaoNegocio(info).aceita) return { ...resumo, ignorado: 'negocio-inativo' };

  const snap = await negocioRef.collection('recorrencias').where('ativa', '==', true).get();
  for (const d of snap.docs) {
    const serie = d.data();
    resumo.series++;

    if (serie.ate && serie.ate < hojeChave) {
      await d.ref.update({ ativa: false, encerradaEm: new Date().toISOString(), motivoEncerramento: 'data-final' });
      resumo.encerradas++;
      continue;
    }

    const r = await gerarOcorrencias({ firestore, negocioRef, info, serieId: d.id, serie, hojeChave, agora });
    resumo.criadas += r.criadas.length;
    resumo.puladas += r.puladas.length;
    if (r.erro) resumo.erros++;

    await d.ref.update({
      ultimaGeracaoEm: new Date().toISOString(),
      geradoAte: r.limite || serie.geradoAte || null,
      alerta: r.erro || null,
      puladas: atualizarPuladas(serie.puladas, r, hojeChave)
    });
  }
  return resumo;
}

module.exports = {
  DIA_RENOVACAO, fimDoMes, limiteDeGeracao, datasDaSerie, carregarContexto, gerarOcorrencias, renovarSeries
};
