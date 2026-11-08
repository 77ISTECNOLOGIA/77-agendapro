// ========================================
// 77 AGENDAPRO — Sinal por Pix e limite semanal por cliente (regras puras)
// ========================================
// Status novos do agendamento:
//   aguardando_sinal → horário reservado, cliente ainda NÃO informou o pagamento; expira em `sinalExpiraEm`
//   sinal_informado  → cliente tocou em "Já paguei"; NÃO expira mais: o dono confere e confirma ou recusa
// Expiração é calculada na hora de ler (sem tarefa agendada): um aguardando_sinal vencido vale como cancelado.

const { diaSemanaDaChave, somarDias, DIAS_SEMANA } = require('./tempo');

const STATUS_SINAL = ['aguardando_sinal', 'sinal_informado'];
const FOLGA_ANTES_DO_HORARIO_MIN = 120;   // o prazo de pagamento termina 2 h antes do horário...
const JANELA_MINIMA_MIN = 30;             // ...mas o cliente sempre tem pelo menos 30 min para pagar
const PRAZO_PADRAO_HORAS = 24;
const PERCENTUAL_PADRAO = 50;

// Brasil não tem horário de verão desde 2019: Brasília = UTC-3 o ano todo
function instanteDoAgendamento(dataChave, horario) {
  const [a, m, d] = dataChave.split('-').map(Number);
  const [h, min] = horario.split(':').map(Number);
  return Date.UTC(a, m - 1, d, h + 3, min);
}

function sinalExpirado(ag, agoraMs = Date.now()) {
  return !!ag && ag.status === 'aguardando_sinal' && !!ag.sinalExpiraEm && Date.parse(ag.sinalExpiraEm) <= agoraMs;
}

/** Status que o resto do sistema deve enxergar: aguardando_sinal vencido = cancelado. */
function statusEfetivo(ag, agoraMs = Date.now()) {
  return sinalExpirado(ag, agoraMs) ? 'cancelado' : ag.status;
}

/** O agendamento ocupa o horário? (cancelado e sinal vencido liberam) */
function ocupaHorario(ag, agoraMs = Date.now()) {
  return statusEfetivo(ag, agoraMs) !== 'cancelado';
}

// Instituições que NÃO são "banco" no nome: não recebem o prefixo (ficaria "Banco Caixa", "Banco Sicoob"...).
const SEM_PREFIXO_BANCO = ['caixa', 'mercado pago', 'mercadopago', 'picpay', 'pagbank', 'pagseguro', 'sicoob', 'sicredi', 'cresol', 'unicred', 'cooperativa', 'nu pagamentos', 'nubank', 'inter&co', 'c6 bank', 'neon', 'next', 'will bank', 'agibank'];
const CONECTORES = ['de', 'do', 'da', 'dos', 'das', 'e'];

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function capitalizar(t) {
  return t.split(' ').map((p, i) => {
    if (p.length <= 4 && p === p.toUpperCase() && /[A-Z]/.test(p)) return p;            // BB, BRB, XP: mantém
    const baixa = p.toLowerCase();
    if (i > 0 && CONECTORES.includes(baixa)) return baixa;
    return baixa.charAt(0).toUpperCase() + baixa.slice(1);
  }).join(' ');
}

/**
 * Nome da instituição para mostrar ao cliente: sempre começa com "Banco" e nunca duplica
 * ("Inter", "inter" e "Banco Inter" viram "Banco Inter"). Exceção: instituições que não são
 * banco no nome (Caixa, Mercado Pago, PicPay, cooperativas...) ficam como digitadas, só capitalizadas.
 */
function normalizarBanco(entrada) {
  let t = String(entrada || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const chave = semAcento(t).toLowerCase();
  if (/^(banco|bco\.?)(\s|$)/.test(chave)) t = t.replace(/^\S+\s*/, '').trim();       // tira "Banco"/"Bco" do começo para recolocar uma vez só
  if (!t) return '';
  const base = semAcento(t).toLowerCase();
  const ehSemPrefixo = SEM_PREFIXO_BANCO.some((n) => base === n || base.startsWith(n + ' '));
  return capitalizar((ehSemPrefixo ? '' : 'Banco ') + t).slice(0, 40);   // capitaliza o nome completo ("Banco do Brasil", conector em minúscula)
}

/** Configuração do sinal do negócio, já validada/normalizada. */
function configSinal(info) {
  const s = (info && info.sinal) || {};
  const ativo = s.ativo === true && !!s.chavePix && !!s.nomeRecebedor;
  return {
    ativo,
    percentual: Number.isFinite(s.percentual) ? Math.min(100, Math.max(1, Math.round(s.percentual))) : PERCENTUAL_PADRAO,
    prazoHoras: Number.isFinite(s.prazoHoras) ? Math.min(72, Math.max(1, Math.round(s.prazoHoras))) : PRAZO_PADRAO_HORAS,
    tipoChave: s.tipoChave || '',
    chavePix: s.chavePix || '',
    nomeRecebedor: s.nomeRecebedor || '',
    cidadeRecebedor: s.cidadeRecebedor || '',
    banco: normalizarBanco(s.banco)
  };
}

function calcularSinal(valorTotal, percentual) {
  return Math.round(Number(valorTotal) * percentual) / 100;   // centavos
}

/**
 * Até quando o cliente pode pagar/informar: o menor entre (agora + prazo) e (horário - 2 h),
 * nunca menos que 30 min a partir de agora e nunca depois do próprio horário.
 */
function calcularExpiracao({ agoraMs, prazoHoras, dataChave, horario }) {
  const inicio = instanteDoAgendamento(dataChave, horario);
  let limite = Math.min(agoraMs + prazoHoras * 3600000, inicio - FOLGA_ANTES_DO_HORARIO_MIN * 60000);
  limite = Math.max(limite, agoraMs + JANELA_MINIMA_MIN * 60000);
  return new Date(Math.min(limite, inicio)).toISOString();
}

/** Semana de segunda a domingo que contém a data. */
function semanaDaChave(dataChave) {
  const dia = DIAS_SEMANA.indexOf(diaSemanaDaChave(dataChave));   // 0 = domingo
  const desdeSegunda = (dia + 6) % 7;
  const ini = somarDias(dataChave, -desdeSegunda);
  return { ini, fim: somarDias(ini, 6) };
}

/**
 * Quantos agendamentos o cliente já tem na semana da data (não conta cancelados nem sinais vencidos).
 * `deste` = lista de agendamentos do mesmo WhatsApp; `ignorarId` = o que está sendo remarcado.
 */
function contarNaSemana(deste, dataChave, agoraMs = Date.now(), ignorarId = null) {
  const { ini, fim } = semanaDaChave(dataChave);
  return deste.filter((a) => a.id !== ignorarId && a.dataChave >= ini && a.dataChave <= fim && ocupaHorario(a, agoraMs)).length;
}

function limiteSemanal(info) {
  const n = Number(info && info.limiteAgendamentosSemana);
  return Number.isInteger(n) && n > 0 ? n : 0;   // 0 = sem limite
}

module.exports = {
  STATUS_SINAL, PRAZO_PADRAO_HORAS, PERCENTUAL_PADRAO,
  instanteDoAgendamento, sinalExpirado, statusEfetivo, ocupaHorario,
  configSinal, normalizarBanco, calcularSinal, calcularExpiracao, semanaDaChave, contarNaSemana, limiteSemanal
};
