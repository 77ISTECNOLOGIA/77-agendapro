// ========================================
// 77 AGENDAPRO — Utilitários HTTP das funções serverless
// ========================================

// Limite de requisições por IP, em memória. Na Vercel cada instância tem a sua
// própria memória, então isto é uma barreira "melhor esforço" contra abuso
// casual (scripts simples, cliques repetidos), não uma garantia global.
const janelas = new Map();

function ipDe(req) {
  const h = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  return String(h).split(',')[0].trim() || 'desconhecido';
}

/** true = pode seguir; false = estourou o limite */
function dentroDoLimite(req, nome, max, janelaMs) {
  const agora = Date.now();
  const chave = `${nome}:${ipDe(req)}`;
  const recentes = (janelas.get(chave) || []).filter(t => agora - t < janelaMs);
  if (recentes.length >= max) {
    janelas.set(chave, recentes);
    return false;
  }
  recentes.push(agora);
  janelas.set(chave, recentes);
  if (janelas.size > 5000) {
    for (const [k, v] of janelas) {
      if (!v.length || agora - v[v.length - 1] > 3600000) janelas.delete(k);
    }
  }
  return true;
}

function limparLimites() { janelas.clear(); }

function responder(res, status, corpo) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(corpo);
}

// Erro de regra de negócio: a mensagem é segura para o usuário final.
class ErroNegocio extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// Responde erros sem vazar detalhes internos (err.message) para o cliente.
function tratarErro(res, err, contexto) {
  if (err instanceof ErroNegocio) return responder(res, err.status, { erro: err.message });
  console.error(`Erro em ${contexto}:`, err);
  return responder(res, 500, { erro: 'Erro ao processar a solicitação. Tente novamente.' });
}

function corpoDe(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (_) { return {}; } }
  return {};
}

module.exports = { dentroDoLimite, limparLimites, responder, ErroNegocio, tratarErro, corpoDe, ipDe };
