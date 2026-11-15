// ========================================
// 77 AGENDAPRO — API: Equipe (sócios e profissionais com acesso próprio)
// Vercel Serverless Function (Node.js)
// ========================================
// POST { action, ... }
//   Com login de quem gere o negócio (idToken + permissão "gerirNegocio"):
//     listar            → membros, convites pendentes e profissionais (sem comissão)
//     convidar          → gera um link de convite (nome, e-mail, profissional e permissões)
//     alterar           → muda as permissões de um membro
//     remover           → DESATIVA o cadastro (perde o acesso e some do link do cliente; guardado em equipeInativa, dá para reativar)
//     reativar          → volta um cadastro desativado
//     excluir-previa    → mostra quantos agendamentos futuros o profissional tem e quantos podem passar para outro
//     excluir-profissional → exclui de vez (transfere/cancela o futuro e avisa os clientes; histórico fica). Só o dono; nunca sócio
//     cancelar-convite  → apaga um convite pendente
//   Para quem recebeu o link:
//     convite-info      → mostra para qual negócio é o convite (sem login)
//     aceitar           → depois de criar a própria conta, vincula-a ao negócio com as permissões do convite
// Regras de ouro: ninguém dá ou ganha permissão que não tem; ninguém mexe em quem tem mais poder; o negócio
// nunca fica sem alguém que o gerencie. Só o servidor grava usuarios/{uid} (firestore.rules proíbe pelo navegador).

const { db, auth, FieldValue } = require('./_lib/firebase');
const { slugValido } = require('./_lib/negocio');
const { dentroDoLimite, dentroDoLimitePorChave, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');
const E = require('./_lib/equipe');
const { validarDadosPix, validarSinalPessoa } = require('./_lib/sinal');
const { precosProfissionalValidos, fotoServicoValida } = require('./_lib/negocio');
const { reaplicarSocio } = require('./_lib/privacidade');
const { hojeChaveBrasil } = require('./_lib/tempo');
const { analisar, resumo, executar } = require('./_lib/saida-profissional');
const { avisarClienteAlteracao } = require('./_lib/lembrete');

const BASE = () => process.env.APP_URL || 'https://77-agendapro.vercel.app';
const TOKEN_OK = /^[A-Za-z0-9_-]{20,64}$/;
const agora = () => new Date().toISOString();

async function contexto(b, firestore) {
  if (!b.idToken) throw new ErroNegocio(401, 'Sessão inválida. Entre novamente.');
  let decoded;
  try { decoded = await auth().verifyIdToken(String(b.idToken)); }
  catch (_) { throw new ErroNegocio(401, 'Sessão inválida. Entre novamente.'); }
  if (!dentroDoLimitePorChave(`equipe:${decoded.uid}`, 40, 600000)) throw new ErroNegocio(429, 'Muitas ações seguidas. Aguarde um pouco.');
  const usuario = (await firestore.collection('usuarios').doc(decoded.uid).get()).data();
  if (!usuario || !usuario.barbeariaId) throw new ErroNegocio(403, 'Sua conta não está ligada a um negócio.');
  return {
    uid: decoded.uid, usuario, permissoes: E.permissoesDe(usuario), slug: usuario.barbeariaId,
    negocioRef: firestore.collection('barbearias').doc(usuario.barbeariaId)
  };
}

function exigirGerir(ctx) {
  if (!ctx.permissoes.gerirNegocio) throw new ErroNegocio(403, 'Você não tem permissão para gerenciar a equipe.');
}

async function carregarEquipe(firestore, ctx) {
  const [usSnap, profSnap, convSnap, inatSnap] = await Promise.all([
    firestore.collection('usuarios').where('barbeariaId', '==', ctx.slug).get(),
    ctx.negocioRef.collection('profissionais').get(),
    ctx.negocioRef.collection('convites').get(),
    ctx.negocioRef.collection('equipeInativa').get()
  ]);
  const profissionais = {};
  profSnap.docs.forEach((d) => { profissionais[d.id] = { id: d.id, nome: d.data().nome || '', ativo: d.data().ativo !== false, socio: d.data().socio === true }; });
  const membros = usSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const agoraMs = Date.now();
  const convites = convSnap.docs.map((d) => ({ token: d.id, ...d.data() }))
    .filter((c) => !c.usado && Date.parse(c.expiraEm) > agoraMs);
  const inativos = inatSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  return { profissionais, membros, convites, inativos };
}

const gerentesRestantes = (membros) => membros.filter((m) => E.permissoesDe(m).gerirNegocio).length;

// ---------------------------------------------------------------- ações com login
async function listar(firestore, ctx) {
  exigirGerir(ctx);
  const { profissionais, membros, convites, inativos } = await carregarEquipe(firestore, ctx);
  const vinculados = new Set([...membros, ...convites, ...inativos].map((x) => x.profissionalId).filter(Boolean));
  const souDono = ctx.permissoes.verTodos && ctx.permissoes.gerirNegocio;
  return {
    eu: { uid: ctx.uid, permissoes: ctx.permissoes, papel: E.papelDe(ctx.usuario), profissionalId: ctx.usuario.profissionalId || '' },
    membros: membros.map((m) => ({
      uid: m.uid, nome: m.nome || '', email: m.email || '', role: m.role || 'owner', profissionalId: m.profissionalId || '',
      profissionalNome: (profissionais[m.profissionalId] || {}).nome || '', permissoes: E.permissoesDe(m), papel: E.papelDe(m),
      eu: m.uid === ctx.uid, podeModificar: m.uid !== ctx.uid && E.podeModificar(ctx.permissoes, E.permissoesDe(m)),
      // só o dono exclui de vez, e nunca um sócio (o cadastro dele é só dele: o dono apenas desativa)
      podeExcluir: souDono && m.uid !== ctx.uid && E.papelDe(m) === 'funcionario' && !!m.profissionalId && E.podeModificar(ctx.permissoes, E.permissoesDe(m))
    })),
    inativos: inativos.map((m) => ({
      uid: m.uid, nome: m.nome || '', email: m.email || '', papel: E.papelDe(m), profissionalId: m.profissionalId || '',
      profissionalNome: (profissionais[m.profissionalId] || {}).nome || '', desativadoEm: m.desativadoEm || '',
      podeReativar: E.podeModificar(ctx.permissoes, E.permissoesDe(m)),
      podeExcluir: souDono && E.papelDe(m) === 'funcionario' && !!m.profissionalId
    })),
    convites: convites.map((c) => ({
      token: c.token, nome: c.nome, email: c.email, profissionalId: c.profissionalId || '', profissionalNome: (profissionais[c.profissionalId] || {}).nome || '',
      permissoes: c.permissoes, papel: c.papel || (c.permissoes && c.permissoes.gerirNegocio ? 'socio' : 'funcionario'), expiraEm: c.expiraEm, link: `${BASE()}/convite?n=${encodeURIComponent(ctx.slug)}&c=${encodeURIComponent(c.token)}`
    })),
    profissionais: Object.values(profissionais).map((p) => ({ ...p, vinculado: vinculados.has(p.id) }))
  };
}

async function convidar(firestore, ctx, b) {
  exigirGerir(ctx);
  const dados = E.validarConvite(b, ctx.permissoes);
  const { profissionais, membros, convites, inativos } = await carregarEquipe(firestore, ctx);

  if (inativos.some((m) => String(m.email || '').toLowerCase() === dados.email)) throw new ErroNegocio(409, 'Esse e-mail está na equipe como desativado. Reative o cadastro em vez de convidar de novo.');
  if (convites.length >= E.MAX_CONVITES_PENDENTES) throw new ErroNegocio(429, 'Há convites demais pendentes. Cancele alguns antes de convidar mais.');
  if (membros.some((m) => String(m.email || '').toLowerCase() === dados.email) || convites.some((c) => c.email === dados.email)) {
    throw new ErroNegocio(409, 'Esse e-mail já faz parte da equipe ou já tem um convite pendente.');
  }
  // o e-mail já pode ter conta em OUTRO negócio (um login só vale para um negócio)
  const emOutro = await firestore.collection('usuarios').where('email', '==', dados.email).get();
  if (emOutro.docs.length) throw new ErroNegocio(409, 'Esse e-mail já tem acesso a um negócio. Use outro e-mail para o convite.');

  let profissionalId = dados.profissionalId;
  if (profissionalId) {
    if (!profissionais[profissionalId] || profissionais[profissionalId].ativo === false) throw new ErroNegocio(404, 'Profissional não encontrado.');
    if (membros.some((m) => m.profissionalId === profissionalId) || convites.some((c) => c.profissionalId === profissionalId)) {
      throw new ErroNegocio(409, 'Esse profissional já está ligado a outra pessoa da equipe.');
    }
  } else if (dados.novoProfissional) {
    // cria o cadastro de profissional já com o horário do estabelecimento (sem comissão, sem intervalo)
    const info = (await ctx.negocioRef.get()).data() || {};
    const horario = {};
    Object.entries(info.horarioFuncionamento || {}).forEach(([dia, h]) => {
      horario[dia] = { ativo: !!(h && h.ativo), inicio: (h && h.inicio) || '09:00', fim: (h && h.fim) || '19:00' };
    });
    const profRef = ctx.negocioRef.collection('profissionais').doc();
    await profRef.set({ nome: dados.novoProfissional, especialidade: '', comissao: 0, ativo: true, horarioTrabalho: horario, criadoEm: agora() });
    profissionalId = profRef.id;
  }

  const token = E.gerarToken();
  const expiraEm = new Date(Date.now() + E.VALIDADE_CONVITE_DIAS * 86400000).toISOString();
  await ctx.negocioRef.collection('convites').doc(token).set({
    nome: dados.nome, email: dados.email, profissionalId, permissoes: dados.permissoes, papel: dados.papel,
    criadoPor: ctx.uid, criadoEm: agora(), expiraEm, usado: false
  });
  return { sucesso: true, token, expiraEm, link: `${BASE()}/convite?n=${encodeURIComponent(ctx.slug)}&c=${encodeURIComponent(token)}`, profissionalId };
}

async function carregarAlvo(firestore, ctx, uid) {
  if (!uid || typeof uid !== 'string' || uid.includes('/')) throw new ErroNegocio(400, 'Pessoa inválida.');
  const alvoSnap = await firestore.collection('usuarios').doc(uid).get();
  const alvo = alvoSnap.data();
  if (!alvo || alvo.barbeariaId !== ctx.slug) throw new ErroNegocio(404, 'Pessoa não encontrada na sua equipe.');
  return alvo;
}

async function alterarPapel(firestore, ctx, b) {
  const dono = ctx.permissoes.verTodos && ctx.permissoes.gerirNegocio;
  if (!dono) throw new ErroNegocio(403, 'Só o dono do estabelecimento muda o papel da equipe.');
  if (!E.PAPEIS_CONVIDAVEIS.includes(b.papel)) throw new ErroNegocio(400, 'Escolha Sócio ou Funcionário.');
  const alvo = await carregarAlvo(firestore, ctx, b.uid);
  if (b.uid === ctx.uid || E.papelDe(alvo) === 'dono') throw new ErroNegocio(403, 'O papel do dono não muda por aqui.');
  if (!alvo.profissionalId) throw new ErroNegocio(400, 'Essa pessoa não está ligada a um profissional.');
  const profRef = ctx.negocioRef.collection('profissionais').doc(alvo.profissionalId);
  const cfgRef = profRef.collection('privado').doc('config');
  await firestore.runTransaction(async (tx) => {
    const [profSnap, cfgSnap] = await Promise.all([tx.get(profRef), tx.get(cfgRef)]);
    tx.update(firestore.collection('usuarios').doc(b.uid), { papel: b.papel, permissoes: E.permissoesDoPapel(b.papel), permissoesAlteradasEm: agora(), permissoesAlteradasPor: ctx.uid });
    if (profSnap.exists) tx.update(profRef, { socio: b.papel === 'socio' });
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    // Sócio começa SEM cobrar sinal (ele decide); funcionário volta a seguir o estabelecimento
    tx.set(cfgRef, { ...cfg, sinal: { modo: b.papel === 'socio' ? 'desativado' : 'herdar' } });
  });
  // a agenda e as fichas de cliente desse profissional passam para o lado certo (o dono deixa de ver / volta a ver)
  await reaplicarSocio(firestore, ctx.negocioRef, alvo.profissionalId, b.papel === 'socio');
  return { sucesso: true, papel: b.papel };
}

async function alterar(firestore, ctx, b) {
  if (b.papel !== undefined) return alterarPapel(firestore, ctx, b);
  exigirGerir(ctx);
  if (!E.permissoesValidas(b.permissoes)) throw new ErroNegocio(400, 'Permissões inválidas.');
  const novas = { verTodos: b.permissoes.verTodos, gerirNegocio: b.permissoes.gerirNegocio };
  const alvo = await carregarAlvo(firestore, ctx, b.uid);
  const atuais = E.permissoesDe(alvo);

  if (b.uid === ctx.uid) {
    if (!E.dentroDe(novas, atuais)) throw new ErroNegocio(403, 'Você não pode aumentar o seu próprio acesso.');
  } else {
    if (!E.podeModificar(ctx.permissoes, atuais)) throw new ErroNegocio(403, 'Você só pode alterar quem tem menos acesso que você. Sócios com o mesmo nível não mandam um no outro: cada um ajusta o próprio acesso.');
    if (!E.dentroDe(novas, ctx.permissoes)) throw new ErroNegocio(403, 'Você não pode dar a outra pessoa um acesso que você mesmo não tem.');
  }
  const { membros, profissionais, convites } = await carregarEquipe(firestore, ctx);
  const depois = membros.map((m) => (m.uid === b.uid ? { ...m, permissoes: novas } : m));
  if (gerentesRestantes(depois) < 1) throw new ErroNegocio(409, 'O negócio precisa ter pelo menos uma pessoa que possa gerenciá-lo.');

  // Ligar a pessoa a um profissional (necessário para quem deixa de "ver tudo": é a agenda que ela passa a enxergar)
  let profissionalId = alvo.profissionalId || '';
  if (b.profissionalId !== undefined && b.profissionalId !== null && b.profissionalId !== '') {
    const id = String(b.profissionalId);
    if (alvo.profissionalId && alvo.profissionalId !== id) throw new ErroNegocio(409, 'Essa pessoa já está ligada a outro profissional.');
    if (!profissionais[id] || profissionais[id].ativo === false) throw new ErroNegocio(404, 'Profissional não encontrado.');
    if (membros.some((m) => m.uid !== b.uid && m.profissionalId === id) || convites.some((c) => c.profissionalId === id)) {
      throw new ErroNegocio(409, 'Esse profissional já está ligado a outra pessoa da equipe.');
    }
    profissionalId = id;
  }
  // Trava contra se trancar para fora: sem "ver tudo" e sem profissional a pessoa não enxerga NADA (painel vazio).
  if (!novas.verTodos && !profissionalId) {
    throw new ErroNegocio(400, 'Para tirar "Ver tudo" é preciso ligar a pessoa a um profissional (é a agenda que ela vai enxergar). Escolha o profissional.');
  }
  const mudancas = { permissoes: novas, permissoesAlteradasEm: agora(), permissoesAlteradasPor: ctx.uid };
  if (profissionalId && profissionalId !== (alvo.profissionalId || '')) mudancas.profissionalId = profissionalId;
  await firestore.collection('usuarios').doc(b.uid).update(mudancas);
  return { sucesso: true, permissoes: novas, profissionalId };
}

async function remover(firestore, ctx, b) {
  exigirGerir(ctx);
  const alvo = await carregarAlvo(firestore, ctx, b.uid);
  if (b.uid !== ctx.uid && !E.podeModificar(ctx.permissoes, E.permissoesDe(alvo))) {
    throw new ErroNegocio(403, 'Você só pode remover quem tem menos acesso que você. Sócios com o mesmo nível não removem um ao outro: cada um pode sair por conta própria.');
  }
  const { membros } = await carregarEquipe(firestore, ctx);
  if (gerentesRestantes(membros.filter((m) => m.uid !== b.uid)) < 1) {
    throw new ErroNegocio(409, 'O negócio precisa ter pelo menos uma pessoa que possa gerenciá-lo.');
  }
  // Desativar NÃO apaga a pessoa: o vínculo é guardado em equipeInativa (só o servidor lê) para poder reativar depois.
  await ctx.negocioRef.collection('equipeInativa').doc(b.uid).set({
    nome: alvo.nome || '', email: alvo.email || '', papel: E.papelDe(alvo), permissoes: E.permissoesDe(alvo), profissionalId: alvo.profissionalId || '',
    usuarioOriginal: alvo, desativadoEm: agora(), desativadoPor: ctx.uid
  });
  await firestore.collection('usuarios').doc(b.uid).delete();     // a conta de login continua existindo, mas sem negócio

  // Quem sai da equipe também sai do link do cliente: o profissional dele fica INATIVO (nada é apagado: histórico, agenda e
  // clientes continuam). Sem isso o cliente seguia vendo e agendando com alguém que não trabalha mais ali. Se outro login
  // ainda usa o mesmo profissional, ele continua ativo. O dono reativa depois em Profissionais, se for o caso.
  const resposta = { sucesso: true };
  const profId = alvo.profissionalId;
  if (profId && !membros.some((m) => m.uid !== b.uid && m.profissionalId === profId)) {
    const profRef = ctx.negocioRef.collection('profissionais').doc(String(profId));
    const prof = await profRef.get();
    if (prof.exists) {
      await profRef.update({ ativo: false, removidoEm: agora() });
      const futuros = await ctx.negocioRef.collection('agendamentos').where('profissionalId', '==', String(profId)).where('dataChave', '>=', hojeChaveBrasil()).get();
      resposta.profissionalDesativado = String(prof.data().nome || '');
      resposta.agendamentosFuturos = futuros.docs.filter((d) => d.data().status === 'confirmado').length;
    }
  }
  return resposta;
}

// ---------------------------------------------------------------- reativar
async function reativar(firestore, ctx, b) {
  exigirGerir(ctx);
  const uid = String(b.uid || '');
  if (!uid || uid.includes('/')) throw new ErroNegocio(400, 'Pessoa inválida.');
  const arqRef = ctx.negocioRef.collection('equipeInativa').doc(uid);
  const arq = (await arqRef.get()).data();
  if (!arq) throw new ErroNegocio(404, 'Cadastro desativado não encontrado.');
  if (!E.podeModificar(ctx.permissoes, E.permissoesDe(arq))) throw new ErroNegocio(403, 'Você não pode reativar alguém com o mesmo nível de acesso que o seu.');
  if ((await firestore.collection('usuarios').doc(uid).get()).exists) throw new ErroNegocio(409, 'Essa pessoa já tem acesso a um negócio.');
  if (arq.email) {
    const outro = await firestore.collection('usuarios').where('email', '==', arq.email).get();
    if (outro.docs.length) throw new ErroNegocio(409, 'Esse e-mail já tem acesso a um negócio.');
  }
  await firestore.collection('usuarios').doc(uid).set(arq.usuarioOriginal || { barbeariaId: ctx.slug, role: 'profissional', email: arq.email, nome: arq.nome, profissionalId: arq.profissionalId, papel: arq.papel, permissoes: arq.permissoes });
  if (arq.profissionalId) {
    const profRef = ctx.negocioRef.collection('profissionais').doc(String(arq.profissionalId));
    if ((await profRef.get()).exists) await profRef.update({ ativo: true, removidoEm: FieldValue.delete() });
  }
  await arqRef.delete();
  return { sucesso: true };
}

// ---------------------------------------------------------------- excluir definitivamente (só o dono; nunca sócio)
async function alvoDeExclusao(firestore, ctx, b) {
  if (!(ctx.permissoes.verTodos && ctx.permissoes.gerirNegocio)) throw new ErroNegocio(403, 'Só o dono do estabelecimento exclui cadastros.');
  const id = String(b.profissionalId || '');
  if (!id || id.length > 64 || id.includes('/')) throw new ErroNegocio(400, 'Profissional inválido.');
  const profSnap = await ctx.negocioRef.collection('profissionais').doc(id).get();
  if (!profSnap.exists) throw new ErroNegocio(404, 'Profissional não encontrado.');
  const prof = { id, ...profSnap.data() };
  if (prof.socio === true) throw new ErroNegocio(403, 'O cadastro de um sócio não é excluído por aqui: o dono só desativa. Os dados dele são só dele.');
  if (id === ctx.usuario.profissionalId) throw new ErroNegocio(403, 'Você não pode excluir o seu próprio cadastro.');
  const { membros, inativos, profissionais } = await carregarEquipe(firestore, ctx);
  const ligados = membros.filter((m) => m.profissionalId === id);
  const ligadosInativos = inativos.filter((m) => m.profissionalId === id);
  for (const m of [...ligados, ...ligadosInativos]) {
    if (E.papelDe(m) === 'socio' || !E.podeModificar(ctx.permissoes, E.permissoesDe(m))) throw new ErroNegocio(403, 'Esse cadastro está ligado a uma pessoa com acesso igual ou maior que o seu.');
  }
  const destinos = Object.values(profissionais).filter((p) => p.id !== id && p.ativo && !p.socio).map((p) => ({ id: p.id, nome: p.nome }));
  return { prof, ligados, ligadosInativos, destinos };
}

async function resolverDestino(ctx, destinos, b) {
  if (!b.destinoId) return null;
  const d = destinos.find((x) => x.id === String(b.destinoId));
  if (!d) throw new ErroNegocio(400, 'Escolha um profissional ativo para receber os agendamentos.');
  const snap = await ctx.negocioRef.collection('profissionais').doc(d.id).get();
  return { id: d.id, ...snap.data() };
}

async function excluirPrevia(firestore, ctx, b) {
  const { prof, ligados, ligadosInativos, destinos } = await alvoDeExclusao(firestore, ctx, b);
  const info = (await ctx.negocioRef.get()).data() || {};
  const destino = await resolverDestino(ctx, destinos, b);
  const { itens, bloqueio } = await analisar({ negocioRef: ctx.negocioRef, info, profissionalId: prof.id, destino });
  return {
    nome: prof.nome || '', ligadoA: [...ligados, ...ligadosInativos].map((m) => ({ nome: m.nome || '', email: m.email || '' })),
    destinos, destinoId: destino ? destino.id : '', bloqueio, ...resumo(itens),
    itens: itens.slice(0, 30).map((i) => ({ cliente: i.ag.clienteNome || '', dataChave: i.ag.dataChave, horario: i.ag.horario, acao: i.acao, motivo: i.motivo || '' }))
  };
}

async function excluirProfissional(firestore, ctx, b) {
  const { prof, ligados, ligadosInativos, destinos } = await alvoDeExclusao(firestore, ctx, b);
  const info = (await ctx.negocioRef.get()).data() || {};
  const destino = b.acaoFuturos === 'transferir' ? await resolverDestino(ctx, destinos, b) : null;
  if (b.acaoFuturos === 'transferir' && !destino) throw new ErroNegocio(400, 'Escolha para quem transferir os agendamentos.');
  const previa = await analisar({ negocioRef: ctx.negocioRef, info, profissionalId: prof.id, destino });
  if (previa.bloqueio) throw new ErroNegocio(409, previa.bloqueio);

  const feitos = await executar({
    firestore, negocioRef: ctx.negocioRef, slug: ctx.slug, info, profissional: prof, destino,
    avisar: ({ tipo, id, ag }) => avisarClienteAlteracao(ctx.negocioRef, id, ag, tipo, info.nome)
  });

  // 1) revoga o acesso, 2) apaga o que é só dele (horários fixos, convites, referências nos serviços, aparelhos, cadastro), 3) apaga o login
  const uids = [...ligados.map((m) => m.uid), ...ligadosInativos.map((m) => m.uid)];
  for (const uid of uids) {
    await firestore.collection('usuarios').doc(uid).delete().catch(() => {});
    await ctx.negocioRef.collection('equipeInativa').doc(uid).delete().catch(() => {});
    const aparelhos = await ctx.negocioRef.collection('dispositivos').where('uid', '==', uid).get();
    for (const d of aparelhos.docs) await d.ref.delete();
  }
  const series = await ctx.negocioRef.collection('recorrencias').where('profissionalId', '==', prof.id).get();
  for (const d of series.docs) await d.ref.delete();
  const convites = await ctx.negocioRef.collection('convites').get();
  for (const c of convites.docs) if (c.data().profissionalId === prof.id) await c.ref.delete();
  const servicos = await ctx.negocioRef.collection('servicos').get();
  for (const s of servicos.docs) {
    const d = s.data(), up = {};
    if (Array.isArray(d.profissionaisIds) && d.profissionaisIds.includes(prof.id)) up.profissionaisIds = d.profissionaisIds.filter((x) => x !== prof.id);
    if (d.precosProfissional && d.precosProfissional[prof.id] !== undefined) up['precosProfissional.' + prof.id] = FieldValue.delete();
    if (Object.keys(up).length) await s.ref.update(up);
  }
  await firestore.recursiveDelete(ctx.negocioRef.collection('profissionais').doc(prof.id));

  let loginsApagados = 0;
  if (b.apagarLogin !== false) {
    for (const uid of uids) {
      if (uid === ctx.uid) continue;
      try { await auth().deleteUser(uid); loginsApagados++; } catch (e) { if (!e || e.code !== 'auth/user-not-found') console.error('Falha ao apagar login', e); }
    }
  }
  return { sucesso: true, nome: prof.nome || '', ...feitos, loginsApagados };
}

async function cancelarConvite(firestore, ctx, b) {
  exigirGerir(ctx);
  if (!TOKEN_OK.test(String(b.token || ''))) throw new ErroNegocio(400, 'Convite inválido.');
  const ref = ctx.negocioRef.collection('convites').doc(String(b.token));
  if (!(await ref.get()).exists) throw new ErroNegocio(404, 'Convite não encontrado.');
  await ref.delete();
  return { sucesso: true };
}

// ---------------------------------------------------------------- perfil do profissional: Pix, sinal e preços próprios
// Quem pode: o PRÓPRIO profissional (a pessoa ligada a ele) ou o administrador pleno (vê tudo + gerencia). Dois sócios que
// só gerenciam NÃO mexem na chave Pix nem nos preços um do outro — é dinheiro de cada um.
// Quem pode: se o profissional é de um SÓCIO, só o próprio sócio (o dono NÃO mexe no Pix/sinal/preços dele); nos demais
// (o do próprio dono e os funcionários), só o dono. Funcionário não altera a própria configuração.
async function profissionalAlvo(firestore, ctx, b) {
  const id = String(b.profissionalId || ctx.usuario.profissionalId || '');
  if (!id || id.length > 64 || id.includes('/')) throw new ErroNegocio(400, 'Profissional inválido.');
  const ligados = await firestore.collection('usuarios').where('barbeariaId', '==', ctx.slug).where('profissionalId', '==', id).get();
  const ligado = ligados.docs.map((d) => ({ uid: d.id, ...d.data() }))[0];
  if (ligado && E.papelDe(ligado) === 'socio') {
    if (ligado.uid !== ctx.uid) throw new ErroNegocio(403, 'A configuração de um sócio é só dele (chave Pix, sinal e preços).');
    return id;
  }
  const dono = ctx.permissoes.verTodos && ctx.permissoes.gerirNegocio;
  if (!dono) throw new ErroNegocio(403, 'Só o dono do estabelecimento altera esta configuração.');
  return id;
}

const configRef = (ctx, id) => ctx.negocioRef.collection('profissionais').doc(id).collection('privado').doc('config');

async function pixProfissional(firestore, ctx, b) {
  const id = await profissionalAlvo(firestore, ctx, b);
  const profRef = ctx.negocioRef.collection('profissionais').doc(id);
  if (!(await profRef.get()).exists) throw new ErroNegocio(404, 'Profissional não encontrado.');
  const vazio = b.pix === null || (b.pix && typeof b.pix === 'object' && !String(b.pix.chavePix || '').trim());
  if (b.pix !== null && (!b.pix || typeof b.pix !== 'object')) throw new ErroNegocio(400, 'Dados do Pix inválidos.');
  const pix = vazio ? null : validarDadosPix(b.pix);
  const atual = (await configRef(ctx, id).get()).data() || {};
  await configRef(ctx, id).set({ ...atual, pix });                // privado: só a própria pessoa (e o servidor) lê; null = sem Pix próprio
  return { sucesso: true, pix };
}

async function sinalProfissional(firestore, ctx, b) {
  const id = await profissionalAlvo(firestore, ctx, b);
  if (!(await ctx.negocioRef.collection('profissionais').doc(id).get()).exists) throw new ErroNegocio(404, 'Profissional não encontrado.');
  const sinal = validarSinalPessoa(b.sinal);
  const atual = (await configRef(ctx, id).get()).data() || {};
  if (sinal.modo === 'ativo' && !(atual.pix && atual.pix.chavePix)) throw new ErroNegocio(400, 'Para cobrar sinal cadastre antes a sua chave Pix.');
  await configRef(ctx, id).set({ ...atual, sinal });
  return { sucesso: true, sinal };
}

// Foto do profissional: JPEG pequeno em data URL (mesma validação da foto do serviço). Quem pode: o próprio profissional ou, se
// ele não é sócio, o dono (mesma regra do Pix/preços: profissionalAlvo).
async function fotoProfissional(firestore, ctx, b) {
  const id = await profissionalAlvo(firestore, ctx, b);
  const ref = ctx.negocioRef.collection('profissionais').doc(id);
  if (!(await ref.get()).exists) throw new ErroNegocio(404, 'Profissional não encontrado.');
  if (b.foto === null || b.foto === '') { await ref.update({ foto: FieldValue.delete() }); return { sucesso: true, foto: '' }; }
  if (!fotoServicoValida(b.foto) || b.foto.length > 90000) throw new ErroNegocio(400, 'Foto inválida: use uma imagem JPEG pequena (o painel prepara isso sozinho).');
  await ref.update({ foto: b.foto });
  return { sucesso: true };
}

async function precosProfissional(firestore, ctx, b) {
  const id = await profissionalAlvo(firestore, ctx, b);
  if (!(await ctx.negocioRef.collection('profissionais').doc(id).get()).exists) throw new ErroNegocio(404, 'Profissional não encontrado.');
  if (!b.precos || typeof b.precos !== 'object' || Array.isArray(b.precos)) throw new ErroNegocio(400, 'Preços inválidos.');
  const pedido = {};
  Object.entries(b.precos).forEach(([servicoId, v]) => {
    if (!servicoId || servicoId.length > 64 || servicoId.includes('/')) throw new ErroNegocio(400, 'Serviço inválido.');
    const e = precosProfissionalValidos({ [id]: v || {} })[id];
    const nulo = (x) => x === null || x === undefined || x === '';
    if (v && ((!nulo(v.preco) && !(e && e.preco !== undefined)) || (!nulo(v.duracaoMin) && !(e && e.duracaoMin !== undefined)))) {
      throw new ErroNegocio(400, 'Confira os valores: o preço vai de 0 a 100.000 e a duração de 1 a 720 minutos.');
    }
    pedido[servicoId] = e || null;                                 // null = volta ao padrão do serviço
  });
  await firestore.runTransaction(async (tx) => {
    const snaps = await Promise.all(Object.keys(pedido).map((sid) => tx.get(ctx.negocioRef.collection('servicos').doc(sid))));
    snaps.forEach((s) => { if (!s.exists) throw new ErroNegocio(404, 'Serviço não encontrado.'); });
    snaps.forEach((s) => {
      const mapa = precosProfissionalValidos(s.data().precosProfissional);
      if (pedido[s.id]) mapa[id] = pedido[s.id]; else delete mapa[id];
      tx.update(s.ref, { precosProfissional: mapa });
    });
  });
  return { sucesso: true };
}

// ---------------------------------------------------------------- aba Equipe: o dono responde "trabalho sozinho" ou "tenho equipe"
async function equipeAtivar(firestore, ctx, b) {
  if (!(ctx.permissoes.verTodos && ctx.permissoes.gerirNegocio)) throw new ErroNegocio(403, 'Só o dono do estabelecimento liga a equipe.');
  if (typeof b.ativa !== 'boolean') throw new ErroNegocio(400, 'Resposta inválida.');
  await firestore.collection('usuarios').doc(ctx.uid).update({ equipeAtiva: b.ativa });
  return { sucesso: true, ativa: b.ativa };
}

// ---------------------------------------------------------------- serviços PRÓPRIOS do sócio
// O sócio cria, edita e apaga serviços que só ele realiza (profissionaisIds = [ele]); o catálogo do estabelecimento é do dono.
async function servicoProprio(firestore, ctx, b) {
  const meu = ctx.usuario.profissionalId;
  if (E.papelDe(ctx.usuario) !== 'socio' || !meu) throw new ErroNegocio(403, 'Só um sócio cria serviços próprios. O catálogo do estabelecimento é do dono.');
  const servicos = ctx.negocioRef.collection('servicos');
  if (b.operacao === 'apagar') {
    const id = String(b.id || '');
    if (!id || id.includes('/')) throw new ErroNegocio(400, 'Serviço inválido.');
    const snap = await servicos.doc(id).get();
    const ids = snap.exists ? snap.data().profissionaisIds : null;
    if (!Array.isArray(ids) || ids.length !== 1 || ids[0] !== meu) throw new ErroNegocio(403, 'Você só apaga serviços que são só seus.');
    await servicos.doc(id).delete();
    return { sucesso: true };
  }
  const nome = E.texto(b.nome, 80);
  const duracaoMin = Number(b.duracaoMin), preco = Number(b.preco);
  if (nome.length < 2) throw new ErroNegocio(400, 'Digite o nome do serviço.');
  if (!Number.isInteger(duracaoMin) || duracaoMin < 5 || duracaoMin > 720) throw new ErroNegocio(400, 'A duração vai de 5 a 720 minutos.');
  if (!Number.isFinite(preco) || preco < 0 || preco > 100000) throw new ErroNegocio(400, 'O preço vai de 0 a 100.000.');
  const foto = b.foto ? (fotoServicoValida(b.foto) ? b.foto : (() => { throw new ErroNegocio(400, 'Foto inválida.'); })()) : '';
  const dados = { nome, duracaoMin, preco: Math.round(preco * 100) / 100, foto, ativo: b.ativo !== false, profissionaisIds: [meu] };
  if (b.id) {
    const id = String(b.id);
    if (id.includes('/')) throw new ErroNegocio(400, 'Serviço inválido.');
    const snap = await servicos.doc(id).get();
    const ids = snap.exists ? snap.data().profissionaisIds : null;
    if (!Array.isArray(ids) || ids.length !== 1 || ids[0] !== meu) throw new ErroNegocio(403, 'Você só altera serviços que são só seus.');
    await servicos.doc(id).update(dados);
    return { sucesso: true, id };
  }
  const total = (await servicos.get()).size;
  const ref = servicos.doc();
  await ref.set({ ...dados, ordem: total + 1 });
  return { sucesso: true, id: ref.id };
}

// ---------------------------------------------------------------- ações do convidado
async function lerConvite(firestore, b) {
  const slug = String(b.slug || b.n || '').toLowerCase();
  const token = String(b.token || b.c || '');
  if (!slugValido(slug) || !TOKEN_OK.test(token)) throw new ErroNegocio(400, 'Convite inválido.');
  const negocioRef = firestore.collection('barbearias').doc(slug);
  const conviteRef = negocioRef.collection('convites').doc(token);
  const convite = (await conviteRef.get()).data();
  if (!convite) throw new ErroNegocio(404, 'Este convite não existe mais. Peça um novo link.');
  if (convite.usado) throw new ErroNegocio(410, 'Este convite já foi usado.');
  if (!(Date.parse(convite.expiraEm) > Date.now())) throw new ErroNegocio(410, 'Este convite venceu. Peça um novo link.');
  return { slug, token, negocioRef, conviteRef, convite };
}

async function conviteInfo(firestore, b) {
  const { negocioRef, convite } = await lerConvite(firestore, b);
  const info = (await negocioRef.get()).data() || {};
  return { valido: true, negocio: info.nome || '', nome: convite.nome, email: convite.email };
}

async function aceitar(firestore, b) {
  if (!b.idToken) throw new ErroNegocio(401, 'Crie sua conta antes de aceitar o convite.');
  let decoded;
  try { decoded = await auth().verifyIdToken(String(b.idToken)); }
  catch (_) { throw new ErroNegocio(401, 'Sessão inválida. Entre novamente.'); }
  const { slug, conviteRef, convite } = await lerConvite(firestore, b);
  if (String(decoded.email || '').toLowerCase() !== convite.email) {
    throw new ErroNegocio(403, `Este convite é para ${convite.email}. Entre com essa conta ou peça um convite para o seu e-mail.`);
  }
  const usuarioRef = firestore.collection('usuarios').doc(decoded.uid);
  await firestore.runTransaction(async (tx) => {
    const [usuarioSnap, conviteSnap] = await Promise.all([tx.get(usuarioRef), tx.get(conviteRef)]);
    if (usuarioSnap.exists) throw new ErroNegocio(409, 'Esta conta já está vinculada a um negócio.');
    const c = conviteSnap.data();
    if (!c || c.usado) throw new ErroNegocio(410, 'Este convite já foi usado.');
    const papel = E.PAPEIS.includes(convite.papel) ? convite.papel : (convite.permissoes && convite.permissoes.gerirNegocio ? 'socio' : 'funcionario');
    let profSnap = null, cfgSnap = null;
    const profRef = convite.profissionalId ? firestore.collection('barbearias').doc(slug).collection('profissionais').doc(convite.profissionalId) : null;
    if (profRef) { profSnap = await tx.get(profRef); cfgSnap = await tx.get(profRef.collection('privado').doc('config')); }
    tx.set(usuarioRef, {
      email: convite.email, nome: convite.nome, barbeariaId: slug, role: 'profissional', papel,
      ...(convite.profissionalId ? { profissionalId: convite.profissionalId } : {}),
      permissoes: convite.permissoes, criadoEm: agora(), convidadoPor: convite.criadoPor
    });
    tx.update(conviteRef, { usado: true, usadoEm: agora(), usadoPor: decoded.uid });
    if (profRef && profSnap.exists) {
      tx.update(profRef, { socio: papel === 'socio' });                       // marca de sócio: o dono não lê o Pix/sinal dele
      if (papel === 'socio') tx.set(profRef.collection('privado').doc('config'), { ...(cfgSnap.exists ? cfgSnap.data() : {}), sinal: { modo: 'desativado' } });   // sócio começa SEM cobrar sinal
    }
  });
  if (convite.profissionalId && E.PAPEIS.includes(convite.papel) && convite.papel === 'socio') {
    await reaplicarSocio(firestore, firestore.collection('barbearias').doc(slug), convite.profissionalId, true);   // histórico anterior do profissional vira privado
  }
  return { sucesso: true, slug };
}

// ---------------------------------------------------------------- entrada
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'equipe', 60, 3600000)) return responder(res, 429, { erro: 'Muitas requisições. Tente mais tarde.' });

  const b = corpoDe(req);
  try {
    const firestore = db();
    switch (b.action) {
      case 'convite-info': return responder(res, 200, await conviteInfo(firestore, b));
      case 'aceitar': return responder(res, 200, await aceitar(firestore, b));
      case 'listar': return responder(res, 200, await listar(firestore, await contexto(b, firestore)));
      case 'convidar': return responder(res, 201, await convidar(firestore, await contexto(b, firestore), b));
      case 'alterar': return responder(res, 200, await alterar(firestore, await contexto(b, firestore), b));
      case 'remover': return responder(res, 200, await remover(firestore, await contexto(b, firestore), b));
      case 'reativar': return responder(res, 200, await reativar(firestore, await contexto(b, firestore), b));
      case 'excluir-previa': return responder(res, 200, await excluirPrevia(firestore, await contexto(b, firestore), b));
      case 'excluir-profissional': return responder(res, 200, await excluirProfissional(firestore, await contexto(b, firestore), b));
      case 'equipe-ativar': return responder(res, 200, await equipeAtivar(firestore, await contexto(b, firestore), b));
      case 'sinal-profissional': return responder(res, 200, await sinalProfissional(firestore, await contexto(b, firestore), b));
      case 'servico-proprio': return responder(res, 200, await servicoProprio(firestore, await contexto(b, firestore), b));
      case 'pix-profissional': return responder(res, 200, await pixProfissional(firestore, await contexto(b, firestore), b));
      case 'foto-profissional': return responder(res, 200, await fotoProfissional(firestore, await contexto(b, firestore), b));
      case 'precos-profissional': return responder(res, 200, await precosProfissional(firestore, await contexto(b, firestore), b));
      case 'cancelar-convite': return responder(res, 200, await cancelarConvite(firestore, await contexto(b, firestore), b));
      default: return responder(res, 400, { erro: 'Ação inválida' });
    }
  } catch (err) {
    return tratarErro(res, err, 'equipe');
  }
};
