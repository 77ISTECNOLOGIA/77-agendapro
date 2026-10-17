// ========================================
// 77 AGENDAPRO — API: Auto-cadastro de negócio
// Vercel Serverless Function (Node.js)
// ========================================
// Antes o navegador gravava direto barbearias/, usuarios/ e cadastrosAguardando/.
// Isso permitia que qualquer pessoa se declarasse dona de QUALQUER negócio
// (bastava gravar usuarios/{meu-uid} = {barbeariaId: 'outro-negocio'}) e que o
// próprio dono se aprovasse. Agora o Firestore bloqueia essas escritas e o
// servidor decide status/plano/vínculo:
//  - status/plano/trial definidos pelo servidor: nasce em 'trial' e os 30 dias
//    começam no cadastro (o link público já funciona na hora, sem aprovação);
//  - vínculo usuario→negócio só pro negócio que ESTA chamada acabou de criar;
//  - e-mail vem do token verificado, não do corpo da requisição.
// A fila cadastrosAguardando continua existindo só como aviso de "novos
// cadastros" pra 77 IS (que pode recusar/suspender um cadastro abusivo).
//
// GET  ?slug=meu-link        → { disponivel: boolean }
// POST { idToken, ...dados } → cria negócio + serviços + usuário + fila de aprovação

const { db, auth } = require('./_lib/firebase');
const { normalizarWhatsapp, whatsappValido } = require('./_lib/tempo');
const { slugValido, SLUGS_RESERVADOS, TIPOS_NEGOCIO } = require('./_lib/negocio');
const { dentroDoLimite, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');

const DIAS_TRIAL = 30;

const HORARIO_PADRAO = {
  segunda: { ativo: true,  inicio: '09:00', fim: '19:00' },
  terca:   { ativo: true,  inicio: '09:00', fim: '19:00' },
  quarta:  { ativo: true,  inicio: '09:00', fim: '19:00' },
  quinta:  { ativo: true,  inicio: '09:00', fim: '19:00' },
  sexta:   { ativo: true,  inicio: '09:00', fim: '20:00' },
  sabado:  { ativo: true,  inicio: '08:00', fim: '17:00' },
  domingo: { ativo: false, inicio: '00:00', fim: '00:00' }
};

const texto = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function sanitizarServicos(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, 15).map((s) => ({
    nome: texto(s && s.nome, 60),
    duracaoMin: Math.round(Number(s && s.duracaoMin)),
    preco: Math.round(Number(s && s.preco) * 100) / 100,
    emoji: texto(s && s.emoji, 8)
  })).filter(s => s.nome && s.duracaoMin >= 5 && s.duracaoMin <= 480 && s.preco >= 0 && s.preco <= 10000);
}

function slugDisponivelFormato(slug) {
  return slugValido(slug) && !SLUGS_RESERVADOS.includes(slug);
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    if (!dentroDoLimite(req, 'slug-check', 30, 60000)) return responder(res, 429, { erro: 'Muitas requisições.' });
    const slug = String((req.query && req.query.slug) || '').toLowerCase();
    if (!slugDisponivelFormato(slug)) return responder(res, 200, { disponivel: false, motivo: 'formato' });
    try {
      const snap = await db().collection('barbearias').doc(slug).get();
      return responder(res, 200, { disponivel: !snap.exists });
    } catch (err) {
      return tratarErro(res, err, 'cadastrar-negocio (slug)');
    }
  }

  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'cadastro', 6, 3600000)) return responder(res, 429, { erro: 'Muitas tentativas de cadastro. Tente mais tarde.' });

  const b = corpoDe(req);
  const slug = String(b.slug || '').toLowerCase();
  const nomeNeg = texto(b.nomeNeg, 80);
  const nomeResp = texto(b.nomeResp, 80);
  const cidade = texto(b.cidade, 60);
  const bairro = texto(b.bairro, 60);
  const telefone = normalizarWhatsapp(b.telefone);
  const tipoNegocio = TIPOS_NEGOCIO.includes(b.tipoNegocio) ? b.tipoNegocio : 'outro';
  const servicos = sanitizarServicos(b.servicos);

  if (!b.idToken) return responder(res, 401, { erro: 'Sessão inválida. Crie a conta novamente.' });
  if (!slugDisponivelFormato(slug)) return responder(res, 400, { erro: 'Esse link é inválido ou reservado. Tente outro.' });
  if (nomeNeg.length < 2) return responder(res, 400, { erro: 'Digite o nome do estabelecimento.' });
  if (nomeResp.length < 2) return responder(res, 400, { erro: 'Digite seu nome.' });
  if (!whatsappValido(telefone)) return responder(res, 400, { erro: 'Digite um WhatsApp válido com DDD.' });

  try {
    const decoded = await auth().verifyIdToken(String(b.idToken));
    const uid = decoded.uid;
    const email = String(decoded.email || '').toLowerCase();
    if (!email) throw new ErroNegocio(400, 'Conta sem e-mail.');

    const firestore = db();
    const negocioRef = firestore.collection('barbearias').doc(slug);
    const usuarioRef = firestore.collection('usuarios').doc(uid);
    const filaRef = firestore.collection('cadastrosAguardando').doc(slug);
    const agoraMs = Date.now();
    const agora = new Date(agoraMs).toISOString();
    const trialFim = new Date(agoraMs + DIAS_TRIAL * 86400000).toISOString();
    const enderecoCompleto = [bairro, cidade].filter(Boolean).join(', ');
    const servicosFinais = servicos.length ? servicos : [{ nome: 'Atendimento padrão', duracaoMin: 60, preco: 80, emoji: '⭐' }];

    await firestore.runTransaction(async (tx) => {
      const [negocioSnap, usuarioSnap] = await Promise.all([tx.get(negocioRef), tx.get(usuarioRef)]);
      if (negocioSnap.exists) throw new ErroNegocio(409, `O link "${slug}" já está em uso. Tente outro.`);
      if (usuarioSnap.exists) throw new ErroNegocio(409, 'Esta conta já está vinculada a um negócio. Acesse o painel.');

      tx.set(negocioRef, {
        nome: nomeNeg,
        slug,
        tipoNegocio,
        endereco: enderecoCompleto || 'Rio de Janeiro',
        cidade,
        bairro,
        telefone,
        status: 'trial',
        plano: 'trial',
        trialInicio: agora,
        trialFim,
        criadoEm: agora,
        criadoPor: uid,
        horarioFuncionamento: HORARIO_PADRAO
      });

      servicosFinais.forEach((s, i) => {
        tx.set(negocioRef.collection('servicos').doc(`srv_${String(i + 1).padStart(3, '0')}`), {
          ...s, ativo: true, ordem: i + 1
        });
      });

      tx.set(usuarioRef, {
        email, nome: nomeResp, barbeariaId: slug, role: 'owner', criadoEm: agora, precisaOnboarding: true
      });

      tx.set(filaRef, {
        barbeariaId: slug, nomeBarbearia: nomeNeg, tipoNegocio, nomeResponsavel: nomeResp,
        email, telefone, cidade, bairro, criadoEm: agora, uid
      });
    });

    return responder(res, 201, { sucesso: true, slug });
  } catch (err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('auth/')) {
      return responder(res, 401, { erro: 'Sessão inválida. Entre novamente.' });
    }
    return tratarErro(res, err, 'cadastrar-negocio');
  }
};
