// ========================================
// 77 AGENDAPRO — Situação comercial do negócio e dados públicos
// ========================================

// Depois que o trial vence, o link público continua funcionando por alguns
// dias (dá tempo de a 77 IS cobrar/ativar sem derrubar a agenda do cliente final).
const CARENCIA_TRIAL_DIAS = 7;

const SLUGS_RESERVADOS = [
  'admin', 'cadastro', 'painel77', 'api', 'css', 'js', 'assets', 'index', 'login',
  'manifest', 'firebase-messaging-sw', 'favicon', 'robots', 'sitemap', 'www', 'app'
];

const TIPOS_NEGOCIO = ['barbearia', 'salao', 'estetica', 'nails', 'outro'];

function slugValido(slug) {
  return typeof slug === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
    && slug.length >= 3 && slug.length <= 50;
}

/**
 * Decide se o link público do negócio pode receber agendamentos agora.
 * status ausente é tratado como 'trial' (mesma convenção do painel77).
 */
function situacaoNegocio(info, agoraMs = Date.now()) {
  const status = (info && info.status) || 'trial';

  if (status === 'ativa') return { aceita: true };
  // 'aguardando_aprovacao' é legado (cadastros antigos): o link público sempre
  // funcionou antes da aprovação, então segue aceitando. Cadastros novos já
  // nascem em 'trial' (api/cadastrar-negocio.js).
  if (status === 'trial' || status === 'aguardando_aprovacao') {
    const fim = info && info.trialFim ? Date.parse(info.trialFim) : NaN;
    if (!Number.isNaN(fim) && agoraMs > fim + CARENCIA_TRIAL_DIAS * 86400000) {
      return { aceita: false, motivo: 'Agendamento online indisponível no momento. Fale direto com o estabelecimento.' };
    }
    return { aceita: true };
  }
  // suspensa ou qualquer status desconhecido
  return { aceita: false, motivo: 'Agendamento online indisponível no momento. Fale direto com o estabelecimento.' };
}

// Só estes campos do documento do negócio vão para o visitante anônimo.
function infoPublica(info) {
  const i = info || {};
  return {
    nome: i.nome || '',
    endereco: i.endereco || '',
    telefone: i.telefone || '',
    tipoNegocio: i.tipoNegocio || 'barbearia',
    horarioFuncionamento: i.horarioFuncionamento || {}
  };
}

// Profissional público: sem comissão nem qualquer campo interno.
function profissionalPublico(id, p, hojeChave) {
  const bloqueios = {};
  Object.entries(p.bloqueios || {}).forEach(([data, horas]) => {
    if (data >= hojeChave) bloqueios[data] = horas;
  });
  return {
    id,
    nome: p.nome || '',
    especialidade: p.especialidade || '',
    ativo: p.ativo !== false,
    horarioTrabalho: p.horarioTrabalho || null,
    bloqueios
  };
}

function servicoPublico(id, s) {
  return {
    id,
    nome: s.nome || '',
    duracaoMin: s.duracaoMin,
    preco: s.preco,
    emoji: s.emoji || '',
    ordem: s.ordem || 0,
    ativo: s.ativo !== false
  };
}

module.exports = {
  CARENCIA_TRIAL_DIAS, SLUGS_RESERVADOS, TIPOS_NEGOCIO,
  slugValido, situacaoNegocio, infoPublica, profissionalPublico, servicoPublico
};
