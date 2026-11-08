// ========================================
// 77 AGENDAPRO — Pix estático ("copia e cola" / QR Code) — funções puras
// ========================================
// Gera o BR Code do Pix (padrão do Banco Central) com a chave do próprio dono e o valor do
// sinal. Não passa por nenhuma plataforma: o dinheiro vai direto para a conta do dono, e a
// confirmação é feita por ele (ver decisão do sinal no CLAUDE.md).

const TIPOS_CHAVE = ['cpf', 'cnpj', 'telefone', 'email', 'aleatoria'];

// CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) exigido no fim do BR Code
function crc16(texto) {
  let crc = 0xFFFF;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const campo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;

// Texto do BR Code: sem acento, só ASCII imprimível, em maiúsculas
function limparTexto(t, max) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,\-]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max);
}

/** Normaliza e valida a chave conforme o tipo. Devolve { ok, chave } ou { ok:false, erro }. */
function normalizarChavePix(tipo, bruta) {
  const t = String(tipo || '');
  const v = String(bruta || '').trim();
  if (!TIPOS_CHAVE.includes(t)) return { ok: false, erro: 'Escolha o tipo da chave Pix.' };
  if (t === 'cpf') {
    const d = v.replace(/\D/g, '');
    return /^\d{11}$/.test(d) ? { ok: true, chave: d } : { ok: false, erro: 'CPF inválido (11 números).' };
  }
  if (t === 'cnpj') {
    const d = v.replace(/\D/g, '');
    return /^\d{14}$/.test(d) ? { ok: true, chave: d } : { ok: false, erro: 'CNPJ inválido (14 números).' };
  }
  if (t === 'telefone') {
    let d = v.replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return /^55[1-9]\d{9,10}$/.test(d) ? { ok: true, chave: '+' + d } : { ok: false, erro: 'Telefone inválido (use DDD + número).' };
  }
  if (t === 'email') {
    const e = v.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 77 ? { ok: true, chave: e } : { ok: false, erro: 'E-mail inválido.' };
  }
  const u = v.toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u)
    ? { ok: true, chave: u } : { ok: false, erro: 'Chave aleatória inválida (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).' };
}

/** Pix "copia e cola" estático com valor. valor em reais (número). */
function montarPixCopiaECola({ chave, valor, nome, cidade, txid = '***' }) {
  const valorStr = Number(valor).toFixed(2);
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  const adicional = campo('05', limparTexto(txid, 25).replace(/ /g, '') || '***');
  const semCrc =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    campo('54', valorStr) +
    campo('58', 'BR') +
    campo('59', limparTexto(nome, 25) || 'ESTABELECIMENTO') +
    campo('60', limparTexto(cidade, 15) || 'BRASIL') +
    campo('62', adicional) +
    '6304';
  return semCrc + crc16(semCrc);
}

module.exports = { crc16, normalizarChavePix, montarPixCopiaECola, limparTexto, TIPOS_CHAVE };
