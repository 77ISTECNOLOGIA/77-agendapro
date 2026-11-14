// ========================================
// 77 AGENDAPRO — Situação comercial do negócio e dados públicos
// ========================================

// Depois que o trial vence, o link público continua funcionando por alguns
// dias (dá tempo de a 77 IS cobrar/ativar sem derrubar a agenda do cliente final).
const CARENCIA_TRIAL_DIAS = 7;

const { configSinal, limiteSemanal } = require('./sinal');
const { consultaMapa, linkMapaSeguro } = require('./endereco');

const SLUGS_RESERVADOS = [
  'admin', 'cadastro', 'convite', 'painel77', 'api', 'css', 'js', 'assets', 'index', 'login',
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
// (A chave Pix só sai pelo servidor, para quem acabou de reservar: api/criar-agendamento.js e api/sinal.js.)
function infoPublica(info) {
  const i = info || {};
  const cfg = configSinal(i);
  return {
    sinal: { ativo: cfg.ativo, percentual: cfg.percentual, prazoHoras: cfg.prazoHoras },
    limiteAgendamentosSemana: limiteSemanal(i),
    nome: i.nome || '',
    endereco: i.endereco || '',
    // cabeçalho curto do link do cliente: "Bairro, Cidade" (negócios antigos, sem endereço detalhado, mostram o texto que já tinham)
    // botão "Ver no mapa": link exato colado pelo dono (se houver) ou busca pelo CEP (ver consultaMapa)
    linkMapa: linkMapaSeguro(i.linkMapa),
    consultaMapa: consultaMapa(i.enderecoDetalhe, i.endereco),
    enderecoCurto: (i.enderecoDetalhe && i.enderecoDetalhe.bairro && i.enderecoDetalhe.cidade)
      ? i.enderecoDetalhe.bairro + ', ' + i.enderecoDetalhe.cidade : (i.endereco || ''),
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

// Serviço pode ser restrito a certos profissionais (`profissionaisIds`).
// Lista ausente ou vazia = QUALQUER profissional realiza (padrão; é também o
// que vale pra todos os serviços criados antes dessa regra existir).
function profissionalRealizaServico(servico, profissionalId) {
  const ids = servico && servico.profissionaisIds;
  return !Array.isArray(ids) || ids.length === 0 || ids.includes(profissionalId);
}

// Preço e duração POR PROFISSIONAL. O serviço guarda `precosProfissional: { [profissionalId]: { preco?, duracaoMin? } }`;
// o que não estiver lá vale o preço/duração padrão do serviço. A MESMA regra está em js/utils.js (teste confere).
function precosProfissionalValidos(bruto) {
  const saida = {};
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return saida;
  Object.entries(bruto).forEach(([pid, v]) => {
    if (!pid || pid.length > 64 || pid.includes('/') || !v || typeof v !== 'object') return;
    const e = {};
    if (typeof v.preco === 'number' && Number.isFinite(v.preco) && v.preco >= 0 && v.preco <= 100000) e.preco = Math.round(v.preco * 100) / 100;
    if (Number.isInteger(v.duracaoMin) && v.duracaoMin > 0 && v.duracaoMin <= 720) e.duracaoMin = v.duracaoMin;
    if (Object.keys(e).length) saida[pid] = e;
  });
  return saida;
}

/** Preço e duração que valem para ESTE profissional neste serviço. */
function servicoParaProfissional(servico, profissionalId) {
  const o = precosProfissionalValidos(servico && servico.precosProfissional)[profissionalId] || {};
  return { preco: o.preco !== undefined ? o.preco : servico.preco, duracaoMin: o.duracaoMin !== undefined ? o.duracaoMin : servico.duracaoMin };
}

// Foto do serviço: JPEG em data URL, tamanho limitado. O valor vai pra um <img src> no
// navegador do cliente, então qualquer outra coisa é descartada aqui (mesma regra do painel).
function fotoServicoValida(foto) {
  return typeof foto === 'string' && foto.length <= 150000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(foto);
}

function servicoPublico(id, s) {
  return {
    id,
    nome: s.nome || '',
    duracaoMin: s.duracaoMin,
    preco: s.preco,
    ordem: s.ordem || 0,
    ativo: s.ativo !== false,
    profissionaisIds: Array.isArray(s.profissionaisIds) ? s.profissionaisIds : [],
    precosProfissional: precosProfissionalValidos(s.precosProfissional),
    foto: fotoServicoValida(s.foto) ? s.foto : ''
  };
}

// Versão leve para a 1ª tela do link: SEM a foto (que pesa até ~70 mil caracteres por serviço e fazia toda
// abertura do link baixar todas as fotos). `temFoto` avisa que ela existe; as fotos vêm depois, em /api/negocio?fotos=1.
function servicoPublicoLeve(id, s) {
  const { foto, ...resto } = servicoPublico(id, s);
  return { ...resto, temFoto: !!foto };
}

module.exports = {
  CARENCIA_TRIAL_DIAS, SLUGS_RESERVADOS, TIPOS_NEGOCIO,
  slugValido, situacaoNegocio, infoPublica, profissionalPublico, servicoPublico, servicoPublicoLeve, profissionalRealizaServico, fotoServicoValida, precosProfissionalValidos, servicoParaProfissional
};
