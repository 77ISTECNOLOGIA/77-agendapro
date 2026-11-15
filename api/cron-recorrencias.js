// ========================================
// 77 AGENDAPRO — Rotina diária: renova os horários fixos de todos os negócios
// Vercel Cron (vercel.json → "crons"), uma vez por dia. Gratuito no plano Hobby.
// ========================================
// Protegida por senha: só roda se a variável de ambiente CRON_SECRET existir E a chamada trouxer
// "Authorization: Bearer <CRON_SECRET>" (a Vercel envia isso sozinha para as rotinas dela).
// Sem a variável configurada ela se recusa a rodar — nunca fica aberta ao público.
// Também manda, 1x por dia, o aviso push de atendimentos esquecidos (confirmados que já passaram).
// É só um reforço: o painel do dono também renova ao abrir, e cada renovação é idempotente.

const { db } = require('./_lib/firebase');
const { agoraBrasil, hojeChaveBrasil } = require('./_lib/tempo');
const { renovarSeries } = require('./_lib/recorrencia');
const { avisarPendentes, limparSinaisVencidos } = require('./_lib/pendencias');
const { situacaoNegocio } = require('./_lib/negocio');
const { responder, tratarErro } = require('./_lib/http');
const { enviarLembretesVencidos } = require('./_lib/lembrete');
const { atualizarEstatisticas, avisarRetornos } = require('./_lib/retorno');
const { enviarResumos } = require('./_lib/resumo-semanal');
const { diaSemanaDaChave } = require('./_lib/tempo');

module.exports = async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  const enviado = (req.headers && req.headers.authorization) || '';
  if (!segredo || enviado !== `Bearer ${segredo}`) return responder(res, 401, { erro: 'Não autorizado' });

  try {
    // Chamada leve a cada ~10 min (cron-job.org): só os lembretes ao cliente que já venceram. Não mexe em horários fixos nem pendências.
    if (String((req.query && req.query.tarefa) || '') === 'lembretes') {
      return responder(res, 200, { sucesso: true, ...(await enviarLembretesVencidos(agoraBrasil())) });
    }

    // Execuções manuais (com a senha): ?tarefa=retorno (estatísticas + avisos de retorno) e ?tarefa=resumo (resumo semanal, em qualquer dia)
    if (String((req.query && req.query.tarefa) || '') === 'retorno') {
      const est = await atualizarEstatisticas();
      return responder(res, 200, { sucesso: true, estatisticas: est, avisos: await avisarRetornos() });
    }
    if (String((req.query && req.query.tarefa) || '') === 'resumo') return responder(res, 200, { sucesso: true, ...(await enviarResumos()) });

    const firestore = db();
    const hojeChave = hojeChaveBrasil();
    const agora = agoraBrasil();
    const total = { negocios: 0, series: 0, criadas: 0, puladas: 0, erros: 0, encerradas: 0, avisos: 0 };

    const negocios = await firestore.collection('barbearias').get();
    // Em lotes de 5 negócios por vez: a Vercel (plano Hobby) corta a função em ~10 s, e um negócio de cada vez não escalaria.
    const processar = async (n) => {
      try {
        await limparSinaisVencidos(n.ref).catch((e) => console.error('Falha ao limpar sinais vencidos de ' + n.id, e));
        if (situacaoNegocio(n.data()).aceita && await avisarPendentes(n.ref, agora)) total.avisos++;   // push: atendimentos esquecidos e sinais para confirmar
        const r = await renovarSeries({ firestore, negocioRef: n.ref, info: n.data(), hojeChave, agora });
        if (r.ignorado) return;
        total.negocios++;
        for (const k of ['series', 'criadas', 'puladas', 'erros', 'encerradas']) total[k] += r[k];
      } catch (err) {
        total.erros++;
        console.error(`Falha ao renovar horários fixos de ${n.id}:`, err);   // um negócio com problema não derruba os outros
      }
    };
    const LOTE = 5;
    for (let i = 0; i < negocios.docs.length; i += LOTE) await Promise.all(negocios.docs.slice(i, i + LOTE).map(processar));
    total.lembretes = await enviarLembretesVencidos(agora).catch((e) => { console.error('Falha nos lembretes ao cliente:', e); return null; });   // reforço do cron diário
    // Retorno inteligente (estatísticas das fichas + push aos clientes que passaram do tempo) e, às segundas, o resumo semanal
    total.retorno = await atualizarEstatisticas().then(async (est) => ({ ...est, ...(await avisarRetornos({ hojeChave })) })).catch((e) => { console.error('Falha no retorno inteligente:', e); return null; });
    if (diaSemanaDaChave(hojeChave) === 'segunda') total.resumo = await enviarResumos({ hojeChave }).catch((e) => { console.error('Falha no resumo semanal:', e); return null; });
    return responder(res, 200, { sucesso: true, ...total });
  } catch (err) {
    return tratarErro(res, err, 'cron-recorrencias');
  }
};
