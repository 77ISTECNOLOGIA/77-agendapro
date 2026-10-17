// ========================================
// 77 AGENDAPRO — Datas, horas e telefones (funções puras)
// ========================================
// A Vercel executa em UTC. Tudo que depende de "hoje"/"agora" usa
// America/Sao_Paulo explicitamente (mesma classe de bug já corrigida no BarOS).

const FUSO = 'America/Sao_Paulo';
const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function hojeChaveBrasil(data = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(data);
}

function minutoAgoraBrasil(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(data);
  const h = Number(partes.find(p => p.type === 'hour').value) % 24;
  const m = Number(partes.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

// "Agora" no formato que a lógica de disponibilidade espera
function agoraBrasil(data = new Date()) {
  return { dataChave: hojeChaveBrasil(data), minutos: minutoAgoraBrasil(data) };
}

function dataChaveValida(chave) {
  if (typeof chave !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(chave)) return false;
  const [a, m, d] = chave.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function horaValida(hora) {
  return typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
}

function horaParaMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function diaSemanaDaChave(dataChave) {
  const [a, m, d] = dataChave.split('-').map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

function somarDias(dataChave, dias) {
  const [a, m, d] = dataChave.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Normaliza para 55 + DDD + número (13 dígitos). Entradas fora do padrão voltam só com dígitos.
function normalizarWhatsapp(numero) {
  const digitos = String(numero || '').replace(/\D/g, '');
  if (digitos.length === 11) return '55' + digitos;
  return digitos;
}

// Celular brasileiro: 55 + DDD (2) + 9 + 8 dígitos
function whatsappValido(norm) {
  return /^55[1-9]\d9\d{8}$/.test(String(norm || ''));
}

module.exports = {
  FUSO, DIAS_SEMANA, hojeChaveBrasil, minutoAgoraBrasil, agoraBrasil,
  dataChaveValida, horaValida, horaParaMinutos, diaSemanaDaChave, somarDias,
  normalizarWhatsapp, whatsappValido
};
