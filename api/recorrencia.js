// ========================================
// 77 AGENDAPRO — API: Cliente fixo (horário que se repete toda semana) — painel do dono
// Vercel Serverless Function (Node.js)
// ========================================
// Só o DONO do negócio (token do Firebase verificado + usuarios/{uid}) usa. Ações (POST):
//   previa   → simula as datas e diz quais não têm vaga (não grava nada)
//   criar    → cria a série e já gera os agendamentos até o fim do mês (ou do próximo, a partir do dia 20)
//   listar   → séries ativas do negócio
//   encerrar → encerra a série e cancela os agendamentos confirmados a partir de uma data
//   renovar  → renova todas as séries (idempotente; o painel chama ao abrir)

const { db, auth } = require('./_lib/firebase');
const {
  agoraBrasil, hojeChaveBrasil, dataChaveValida, horaValida, normalizarWhatsapp, whatsappValido,
  diaSemanaDaChave, DIAS_SEMANA
} = require('./_lib/tempo');
const { situacaoNegocio } = require('./_lib/negocio');
const { dentroDoLimite, dentroDoLimitePorChave, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');
const { gerarOcorrencias, renovarSeries, carregarContexto, limiteDeGeracao } = require('./_lib/recorrencia');

const texto = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function lerSerie(b) {
  const nome = texto(b.clienteNome, 80);
  const whatsapp = normalizarWhatsapp(b.clienteWhatsapp);
  const servicosIds = Array.isArray(b.servicosIds) ? [...new Set(b.servicosIds.map(String))] : [];
  const modo = b.modo === 'ate' ? 'ate' : 'mensal';
  const ate = modo === 'ate' ? String(b.ate || '') : null;

  if (nome.length < 2) throw new ErroNegocio(400, 'Nome do cliente inválido');
  if (!whatsappValido(whatsapp)) throw new ErroNegocio(400, 'WhatsApp inválido');
  if (typeof b.profissionalId !== 'string' || !b.profissionalId || b.profissionalId.length > 64) throw new ErroNegocio(400, 'Profissional inválido');
  if (servicosIds.length < 1 || servicosIds.length > 10 || servicosIds.some((id) => !id || id.length > 64 || id.includes('/'))) throw new ErroNegocio(400, 'Serviços inválidos');
  if (!dataChaveValida(b.dataInicio) || !horaValida(b.horario)) throw new ErroNegocio(400, 'Data ou horário inválido');
  if (b.dataInicio < hojeChaveBrasil()) throw new ErroNegocio(400, 'A primeira data não pode estar no passado');
  if (modo === 'ate' && (!dataChaveValida(ate) || ate < b.dataInicio)) throw new ErroNegocio(400, 'A data final precisa ser igual ou depois da primeira data');

  return {
    ativa: true,
    clienteNome: nome,
    clienteWhatsapp: whatsapp,
    profissionalId: b.profissionalId,
    servicosIds,
    diaSemana: DIAS_SEMANA.indexOf(diaSemanaDaChave(b.dataInicio)),
    horario: b.horario,
    inicio: b.dataInicio,
    modo,
    ate,
    puladas: []
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'recorrencia', 60, 3600000)) return responder(res, 429, { erro: 'Muitas requisições. Tente mais tarde.' });

  const b = corpoDe(req);
  if (!b.idToken) return responder(res, 401, { erro: 'Sessão inválida. Entre novamente.' });

  try {
    let decoded;
    try { decoded = await auth().verifyIdToken(String(b.idToken)); }
    catch (_) { throw new ErroNegocio(401, 'Sessão inválida. Entre novamente.'); }
    if (!dentroDoLimitePorChave(`recorrencia:${decoded.uid}`, 40, 600000)) throw new ErroNegocio(429, 'Muitas ações seguidas. Aguarde um pouco.');

    const firestore = db();
    const vinculo = (await firestore.collection('usuarios').doc(decoded.uid).get()).data();
    if (!vinculo || !vinculo.barbeariaId) throw new ErroNegocio(403, 'Sua conta não está ligada a um negócio.');
    // Quem vê tudo gerencia os horários fixos de todos; quem só vê o próprio profissional, só os DELE.
    const veTodos = require('./_lib/equipe').permissoesDe(vinculo).verTodos;
    const meuProfissional = String(vinculo.profissionalId || '');
    if (!veTodos && !meuProfissional) throw new ErroNegocio(403, 'Você não tem permissão para gerenciar horários fixos.');

    const negocioRef = firestore.collection('barbearias').doc(vinculo.barbeariaId);
    const { donoVePara, idCliente } = require('./_lib/privacidade');
    const negocioSnap = await negocioRef.get();
    if (!negocioSnap.exists) throw new ErroNegocio(404, 'Negócio não encontrado');
    const info = negocioSnap.data();
    const hojeChave = hojeChaveBrasil();
    const agora = agoraBrasil();
    const seriesRef = negocioRef.collection('recorrencias');

    // Avisa o CLIENTE (push no app dele) de algo que o estabelecimento fez: cancelou, remarcou, confirmou/recusou o sinal.
    // O texto vem do que está no banco (nunca do navegador) e o tipo precisa bater com o estado real do agendamento, feito há pouco.
    if (b.action === 'avisar-cliente') {
      const id = String(b.agendamentoId || '');
      if (!id || id.length > 64 || id.includes('/')) throw new ErroNegocio(400, 'Agendamento inválido');
      const ag = (await negocioRef.collection('agendamentos').doc(id).get()).data();
      if (!ag) throw new ErroNegocio(404, 'Agendamento não encontrado');
      if (!((veTodos && ag.donoVe === true) || (meuProfissional && ag.profissionalId === meuProfissional))) throw new ErroNegocio(403, 'Esse agendamento não é da sua agenda.');
      const recente = (iso) => !!iso && Date.now() - Date.parse(iso) < 10 * 60 * 1000;
      const tipo = String(b.tipo || '');
      const ok = (tipo === 'cancelado' && ag.status === 'cancelado' && ag.canceladoPor !== 'cliente' && ag.canceladoPor !== 'sinal-recusado' && recente(ag.canceladoEm))
        || (tipo === 'remarcado' && ag.remarcadoPor === 'dono' && recente(ag.remarcadoEm))
        || (tipo === 'sinal-confirmado' && ag.status === 'confirmado' && recente(ag.sinalConfirmadoEm))
        || (tipo === 'sinal-recusado' && ag.status === 'cancelado' && ag.canceladoPor === 'sinal-recusado' && recente(ag.canceladoEm));
      if (!ok) return responder(res, 200, { enviado: false });          // nada a avisar (ou já passou o momento)
      const r = await require('./_lib/lembrete').avisarClienteAlteracao(negocioRef, id, ag, tipo, info.nome);
      return responder(res, 200, { enviado: r.enviadas > 0 });
    }

    // encerrar e listar valem mesmo com a conta suspensa; o resto só com o negócio ativo
    if (!['encerrar', 'listar'].includes(b.action)) {
      const s = situacaoNegocio(info);
      if (!s.aceita) throw new ErroNegocio(403, s.motivo);
    }

    // ------------------------------------------------------------ previa / criar
    if (b.action === 'previa' || b.action === 'criar') {
      const serie = lerSerie(b);
      if (!veTodos && serie.profissionalId !== meuProfissional) throw new ErroNegocio(403, 'Você só pode criar horários fixos na sua própria agenda.');
      const ctx = await carregarContexto(negocioRef, serie);
      if (ctx.erro) throw new ErroNegocio(409, ctx.erro);
      if (veTodos && !donoVePara(ctx.prof)) throw new ErroNegocio(403, 'A agenda de um sócio é só dele: o dono não cria horários fixos nela.');

      if (b.action === 'previa') {
        const r = await gerarOcorrencias({ firestore, negocioRef, info, serieId: null, serie, hojeChave, agora, previa: true });
        return responder(res, 200, {
          datas: r.datas, limite: r.limite, diaSemana: serie.diaSemana, horario: serie.horario,
          renovaAutomatico: serie.modo === 'mensal'
        });
      }

      const serieRef = seriesRef.doc();
      await serieRef.set({ ...serie, criadaEm: new Date().toISOString(), criadaPor: decoded.uid });
      const r = await gerarOcorrencias({ firestore, negocioRef, info, serieId: serieRef.id, serie, hojeChave, agora });
      if (r.erro) { await serieRef.delete(); throw new ErroNegocio(409, r.erro); }
      if (r.criadas.length === 0) {
        await serieRef.delete();
        throw new ErroNegocio(409, 'Nenhuma das datas tem horário livre. Escolha outro horário ou dia.');
      }
      await serieRef.update({ geradoAte: r.limite, ultimaGeracaoEm: new Date().toISOString(), puladas: r.puladas.slice(-30) });

      // garante o cadastro do cliente (sem inflar a contagem de visitas: elas ainda não aconteceram)
      const clienteRef = negocioRef.collection('clientes').doc(idCliente(ctx.prof, ctx.prof.id, serie.clienteWhatsapp));
      const cli = await clienteRef.get();
      if (!cli.exists) {
        const agoraIso = new Date().toISOString();
        await clienteRef.set({ nome: serie.clienteNome, whatsapp: serie.clienteWhatsapp, donoVe: donoVePara(ctx.prof), primeiraVisita: agoraIso, ultimoAgendamento: agoraIso, totalAgendamentos: 0 });
      }
      return responder(res, 201, { sucesso: true, serieId: serieRef.id, criadas: r.criadas, puladas: r.puladas, limite: r.limite });
    }

    // ------------------------------------------------------------ listar
    if (b.action === 'listar') {
      const snap = await seriesRef.where('ativa', '==', true).get();
      const sociosIds = veTodos ? new Set((await negocioRef.collection('profissionais').get()).docs.filter((p) => p.data().socio === true).map((p) => p.id)) : new Set();
      const series = [];
      for (const d of snap.docs) {
        const s = d.data();
        if (!veTodos && s.profissionalId !== meuProfissional) continue;
        if (veTodos && sociosIds.has(s.profissionalId)) continue;          // o dono não vê horários fixos de sócio
        const ags = (await negocioRef.collection('agendamentos').where('recorrenciaId', '==', d.id).get()).docs.map((x) => x.data());
        const proximas = ags.filter((a) => a.status === 'confirmado' && a.dataChave >= hojeChave).length;
        const nomes = ags.length ? (ags[0].servicos || []).map((x) => x.nome) : [];
        series.push({
          id: d.id, clienteNome: s.clienteNome, clienteWhatsapp: s.clienteWhatsapp, profissionalId: s.profissionalId,
          servicos: nomes, diaSemana: s.diaSemana, horario: s.horario, modo: s.modo, ate: s.ate || null,
          proximas, puladas: s.puladas || [], alerta: s.alerta || null, geradoAte: s.geradoAte || null
        });
      }
      series.sort((a, c) => (a.diaSemana - c.diaSemana) || a.horario.localeCompare(c.horario));
      return responder(res, 200, { series });
    }

    // ------------------------------------------------------------ encerrar
    if (b.action === 'encerrar') {
      const serieId = String(b.serieId || '');
      if (!serieId || serieId.includes('/')) throw new ErroNegocio(400, 'Série inválida');
      const serieRef = seriesRef.doc(serieId);
      const serieSnap = await serieRef.get();
      if (!serieSnap.exists || (!veTodos && serieSnap.data().profissionalId !== meuProfissional)) throw new ErroNegocio(404, 'Horário fixo não encontrado');
      if (veTodos) {                                                          // o dono não mexe na série de um sócio
        const dono = await negocioRef.collection('profissionais').doc(serieSnap.data().profissionalId).get();
        if (dono.exists && dono.data().socio === true) throw new ErroNegocio(404, 'Horário fixo não encontrado');
      }

      const aPartirDe = dataChaveValida(b.aPartirDe) ? b.aPartirDe : hojeChave;
      const ags = await negocioRef.collection('agendamentos').where('recorrenciaId', '==', serieId).get();
      let canceladas = 0;
      for (const d of ags.docs) {
        const a = d.data();
        if (a.status === 'confirmado' && a.dataChave >= aPartirDe) {
          await d.ref.update({ status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: 'dono', motivoCancelamento: 'horario-fixo-encerrado' });
          canceladas++;
        }
      }
      await serieRef.update({ ativa: false, encerradaEm: new Date().toISOString(), motivoEncerramento: 'dono' });
      return responder(res, 200, { sucesso: true, canceladas });
    }

    // ------------------------------------------------------------ renovar
    if (b.action === 'renovar') {
      if (!veTodos) return responder(res, 200, { sucesso: true, criadas: 0, erros: 0 });   // a rotina diária renova; quem só vê o próprio trabalho não dispara a renovação do negócio todo
      const r = await renovarSeries({ firestore, negocioRef, info, hojeChave, agora });
      return responder(res, 200, { sucesso: true, ...r });
    }

    throw new ErroNegocio(400, 'Ação inválida');
  } catch (err) {
    return tratarErro(res, err, 'recorrencia');
  }
};

module.exports.limiteDeGeracao = limiteDeGeracao;
