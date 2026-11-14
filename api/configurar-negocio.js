// ========================================
// 77 AGENDAPRO — API: Regras de agendamento do negócio (sinal por Pix + limite semanal) — painel do dono
// Vercel Serverless Function (Node.js)
// ========================================
// Só o DONO (token do Firebase verificado + usuarios/{uid}). Fica no servidor (e não nas regras do
// Firestore) para validar a chave Pix, o percentual e o limite antes de gravar.
// POST { idToken, sinal?: { ativo, percentual, prazoHoras, tipoChave, chavePix, nomeRecebedor, cidadeRecebedor, banco },
//        limiteAgendamentosSemana?, endereco?: { cep, logradouro, numero, complemento, bairro, cidade, uf },
//        linkMapa?: link do Google Maps ('' remove) }
// Cada parte é opcional: só o que vier no pedido é validado e gravado.

const { db, auth } = require('./_lib/firebase');
const { dentroDoLimite, dentroDoLimitePorChave, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');
const { normalizarEndereco, camposDoEndereco, validarLinkMapa } = require('./_lib/endereco');
const { validarDadosPix } = require('./_lib/sinal');

const texto = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function validarSinal(s) {
  if (!s || typeof s !== 'object') throw new ErroNegocio(400, 'Dados do sinal inválidos');
  const ativo = s.ativo === true;
  const percentual = Math.round(Number(s.percentual));
  const prazoHoras = Math.round(Number(s.prazoHoras));
  if (!Number.isFinite(percentual) || percentual < 10 || percentual > 100) throw new ErroNegocio(400, 'O percentual do sinal deve ficar entre 10% e 100%.');
  if (!Number.isFinite(prazoHoras) || prazoHoras < 1 || prazoHoras > 72) throw new ErroNegocio(400, 'O prazo para pagar deve ficar entre 1 e 72 horas.');

  const out = { ativo, percentual, prazoHoras, tipoChave: '', chavePix: '', nomeRecebedor: '', cidadeRecebedor: '', banco: '' };
  const temChave = !!texto(s.chavePix, 100);
  if (ativo || temChave) {
    Object.assign(out, validarDadosPix(s));
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'configurar-negocio', 30, 3600000)) return responder(res, 429, { erro: 'Muitas requisições. Tente mais tarde.' });

  const b = corpoDe(req);
  if (!b.idToken) return responder(res, 401, { erro: 'Sessão inválida. Entre novamente.' });

  try {
    let decoded;
    try { decoded = await auth().verifyIdToken(String(b.idToken)); }
    catch (_) { throw new ErroNegocio(401, 'Sessão inválida. Entre novamente.'); }
    if (!dentroDoLimitePorChave(`configurar-negocio:${decoded.uid}`, 20, 600000)) throw new ErroNegocio(429, 'Muitas alterações seguidas. Aguarde um pouco.');

    const firestore = db();
    const vinculo = (await firestore.collection('usuarios').doc(decoded.uid).get()).data();
    if (!vinculo || !vinculo.barbeariaId) throw new ErroNegocio(403, 'Sua conta não está ligada a um negócio.');
    if (!require('./_lib/equipe').permissoesDe(vinculo).gerirNegocio) throw new ErroNegocio(403, 'Você não tem permissão para alterar as configurações do negócio.');
    const negocioRef = firestore.collection('barbearias').doc(vinculo.barbeariaId);
    if (!(await negocioRef.get()).exists) throw new ErroNegocio(404, 'Negócio não encontrado');

    const mudancas = {};
    const resposta = { sucesso: true };

    if (b.limiteAgendamentosSemana !== undefined) {
      const limite = Math.round(Number(b.limiteAgendamentosSemana || 0));
      if (!Number.isInteger(limite) || limite < 0 || limite > 14) throw new ErroNegocio(400, 'O limite por semana deve ficar entre 0 (sem limite) e 14.');
      mudancas.limiteAgendamentosSemana = limite;
      resposta.limiteAgendamentosSemana = limite;
    }
    if (b.sinal !== undefined) {
      mudancas.sinal = validarSinal(b.sinal);
      resposta.sinal = mudancas.sinal;
    }
    if (b.endereco !== undefined) {
      const campos = camposDoEndereco(normalizarEndereco(b.endereco));
      Object.assign(mudancas, campos);
      resposta.endereco = campos.endereco;
      resposta.enderecoDetalhe = campos.enderecoDetalhe;
    }
    if (b.linkMapa !== undefined) {
      mudancas.linkMapa = validarLinkMapa(b.linkMapa);
      resposta.linkMapa = mudancas.linkMapa;
    }
    if (!Object.keys(mudancas).length) throw new ErroNegocio(400, 'Nada para salvar.');

    await negocioRef.update(mudancas);
    return responder(res, 200, resposta);
  } catch (err) {
    return tratarErro(res, err, 'configurar-negocio');
  }
};
