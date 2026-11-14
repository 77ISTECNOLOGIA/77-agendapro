// ========================================
// 77 AGENDAPRO — API: Equipe (sócios e profissionais com acesso próprio)
// Vercel Serverless Function (Node.js)
// ========================================
// POST { action, ... }
//   Com login de quem gere o negócio (idToken + permissão "gerirNegocio"):
//     listar            → membros, convites pendentes e profissionais (sem comissão)
//     convidar          → gera um link de convite (nome, e-mail, profissional e permissões)
//     alterar           → muda as permissões de um membro
//     remover           → tira o acesso de um membro
//     cancelar-convite  → apaga um convite pendente
//   Para quem recebeu o link:
//     convite-info      → mostra para qual negócio é o convite (sem login)
//     aceitar           → depois de criar a própria conta, vincula-a ao negócio com as permissões do convite
// Regras de ouro: ninguém dá ou ganha permissão que não tem; ninguém mexe em quem tem mais poder; o negócio
// nunca fica sem alguém que o gerencie. Só o servidor grava usuarios/{uid} (firestore.rules proíbe pelo navegador).

const { db, auth } = require('./_lib/firebase');
const { slugValido } = require('./_lib/negocio');
const { dentroDoLimite, dentroDoLimitePorChave, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');
const E = require('./_lib/equipe');
const { validarDadosPix } = require('./_lib/sinal');
const { precosProfissionalValidos } = require('./_lib/negocio');

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
  const [usSnap, profSnap, convSnap] = await Promise.all([
    firestore.collection('usuarios').where('barbeariaId', '==', ctx.slug).get(),
    ctx.negocioRef.collection('profissionais').get(),
    ctx.negocioRef.collection('convites').get()
  ]);
  const profissionais = {};
  profSnap.docs.forEach((d) => { profissionais[d.id] = { id: d.id, nome: d.data().nome || '', ativo: d.data().ativo !== false }; });
  const membros = usSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const agoraMs = Date.now();
  const convites = convSnap.docs.map((d) => ({ token: d.id, ...d.data() }))
    .filter((c) => !c.usado && Date.parse(c.expiraEm) > agoraMs);
  return { profissionais, membros, convites };
}

const gerentesRestantes = (membros) => membros.filter((m) => E.permissoesDe(m).gerirNegocio).length;

// ---------------------------------------------------------------- ações com login
async function listar(firestore, ctx) {
  exigirGerir(ctx);
  const { profissionais, membros, convites } = await carregarEquipe(firestore, ctx);
  const vinculados = new Set([...membros, ...convites].map((x) => x.profissionalId).filter(Boolean));
  return {
    eu: { uid: ctx.uid, permissoes: ctx.permissoes, profissionalId: ctx.usuario.profissionalId || '' },
    membros: membros.map((m) => ({
      uid: m.uid, nome: m.nome || '', email: m.email || '', role: m.role || 'owner', profissionalId: m.profissionalId || '',
      profissionalNome: (profissionais[m.profissionalId] || {}).nome || '', permissoes: E.permissoesDe(m),
      eu: m.uid === ctx.uid, podeModificar: m.uid !== ctx.uid && E.podeModificar(ctx.permissoes, E.permissoesDe(m))
    })),
    convites: convites.map((c) => ({
      token: c.token, nome: c.nome, email: c.email, profissionalId: c.profissionalId || '', profissionalNome: (profissionais[c.profissionalId] || {}).nome || '',
      permissoes: c.permissoes, expiraEm: c.expiraEm, link: `${BASE()}/convite?n=${encodeURIComponent(ctx.slug)}&c=${encodeURIComponent(c.token)}`
    })),
    profissionais: Object.values(profissionais).map((p) => ({ ...p, vinculado: vinculados.has(p.id) }))
  };
}

async function convidar(firestore, ctx, b) {
  exigirGerir(ctx);
  const dados = E.validarConvite(b, ctx.permissoes);
  const { profissionais, membros, convites } = await carregarEquipe(firestore, ctx);

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
    nome: dados.nome, email: dados.email, profissionalId, permissoes: dados.permissoes,
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

async function alterar(firestore, ctx, b) {
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
  const { membros } = await carregarEquipe(firestore, ctx);
  const depois = membros.map((m) => (m.uid === b.uid ? { ...m, permissoes: novas } : m));
  if (gerentesRestantes(depois) < 1) throw new ErroNegocio(409, 'O negócio precisa ter pelo menos uma pessoa que possa gerenciá-lo.');
  if (!novas.verTodos && !novas.gerirNegocio && !alvo.profissionalId) {
    throw new ErroNegocio(400, 'Sem profissional vinculado e sem permissões, essa pessoa não enxergaria nada.');
  }
  await firestore.collection('usuarios').doc(b.uid).update({ permissoes: novas, permissoesAlteradasEm: agora(), permissoesAlteradasPor: ctx.uid });
  return { sucesso: true, permissoes: novas };
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
  await firestore.collection('usuarios').doc(b.uid).delete();     // a conta de login continua existindo, mas sem negócio
  return { sucesso: true };
}

async function cancelarConvite(firestore, ctx, b) {
  exigirGerir(ctx);
  if (!TOKEN_OK.test(String(b.token || ''))) throw new ErroNegocio(400, 'Convite inválido.');
  const ref = ctx.negocioRef.collection('convites').doc(String(b.token));
  if (!(await ref.get()).exists) throw new ErroNegocio(404, 'Convite não encontrado.');
  await ref.delete();
  return { sucesso: true };
}

// ---------------------------------------------------------------- perfil do profissional: Pix e preços próprios
// Quem pode: o PRÓPRIO profissional (a pessoa ligada a ele) ou o administrador pleno (vê tudo + gerencia). Dois sócios que
// só gerenciam NÃO mexem na chave Pix nem nos preços um do outro — é dinheiro de cada um.
function profissionalAlvo(ctx, b) {
  const id = String(b.profissionalId || ctx.usuario.profissionalId || '');
  if (!id || id.length > 64 || id.includes('/')) throw new ErroNegocio(400, 'Profissional inválido.');
  const admin = ctx.permissoes.verTodos && ctx.permissoes.gerirNegocio;
  if (!admin && ctx.usuario.profissionalId !== id) throw new ErroNegocio(403, 'Você só pode alterar o seu próprio perfil.');
  return id;
}

async function pixProfissional(firestore, ctx, b) {
  const id = profissionalAlvo(ctx, b);
  const profRef = ctx.negocioRef.collection('profissionais').doc(id);
  if (!(await profRef.get()).exists) throw new ErroNegocio(404, 'Profissional não encontrado.');
  const vazio = b.pix === null || (b.pix && typeof b.pix === 'object' && !String(b.pix.chavePix || '').trim());
  if (b.pix !== null && (!b.pix || typeof b.pix !== 'object')) throw new ErroNegocio(400, 'Dados do Pix inválidos.');
  const pix = vazio ? null : validarDadosPix(b.pix);
  await profRef.update({ pix });                                   // null = volta a valer o Pix do negócio
  return { sucesso: true, pix };
}

async function precosProfissional(firestore, ctx, b) {
  const id = profissionalAlvo(ctx, b);
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
    tx.set(usuarioRef, {
      email: convite.email, nome: convite.nome, barbeariaId: slug, role: 'profissional',
      ...(convite.profissionalId ? { profissionalId: convite.profissionalId } : {}),
      permissoes: convite.permissoes, criadoEm: agora(), convidadoPor: convite.criadoPor
    });
    tx.update(conviteRef, { usado: true, usadoEm: agora(), usadoPor: decoded.uid });
  });
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
      case 'pix-profissional': return responder(res, 200, await pixProfissional(firestore, await contexto(b, firestore), b));
      case 'precos-profissional': return responder(res, 200, await precosProfissional(firestore, await contexto(b, firestore), b));
      case 'cancelar-convite': return responder(res, 200, await cancelarConvite(firestore, await contexto(b, firestore), b));
      default: return responder(res, 400, { erro: 'Ação inválida' });
    }
  } catch (err) {
    return tratarErro(res, err, 'equipe');
  }
};
