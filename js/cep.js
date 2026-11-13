// ========================================
// 77 AGENDAPRO — CEP: máscara e preenchimento automático do endereço
// ========================================
// Usa serviços públicos e gratuitos de CEP (sem cadastro, sem chave): ViaCEP e, de reserva, BrasilAPI.
// Só o CEP (que é público) sai do navegador. Tudo continua editável: se o CEP não for achado, a pessoa
// preenche o endereço à mão. O servidor valida de novo o que for gravado (api/_lib/endereco.js).

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export function formatarCep(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
}

export function cepValido(valor) {
  return /^\d{8}$/.test(String(valor || '').replace(/\D/g, ''));
}

async function lerJson(url, fetchFn, tempoMs = 6000) {
  const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const relogio = controle ? setTimeout(() => controle.abort(), tempoMs) : null;
  try {
    const resp = await fetchFn(url, controle ? { signal: controle.signal } : undefined);
    if (!resp.ok) return null;
    return await resp.json();
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

/** Devolve { logradouro, bairro, cidade, uf } ou null (CEP não achado ou serviços fora do ar). */
export async function buscarCep(cep, fetchFn = fetch) {
  const d = String(cep || '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  try {
    const v = await lerJson(`https://viacep.com.br/ws/${d}/json/`, fetchFn);
    if (v && !v.erro && (v.localidade || v.logradouro)) {
      return { logradouro: v.logradouro || '', bairro: v.bairro || '', cidade: v.localidade || '', uf: String(v.uf || '').toUpperCase() };
    }
  } catch (_) { /* tenta a reserva */ }
  try {
    const b = await lerJson(`https://brasilapi.com.br/api/cep/v2/${d}`, fetchFn);
    if (b && (b.city || b.street)) {
      return { logradouro: b.street || '', bairro: b.neighborhood || '', cidade: b.city || '', uf: String(b.state || '').toUpperCase() };
    }
  } catch (_) { /* sem resposta */ }
  return null;
}

/**
 * Liga a máscara e a busca automática num formulário.
 * ids = { cep, logradouro, numero, bairro, cidade, uf, aviso } (ids dos elementos, sem '#').
 * Ao completar os 8 números busca o endereço, preenche o que veio e leva o cursor ao número.
 * Respostas atrasadas (a pessoa já mudou o CEP) são ignoradas.
 */
export function ligarBuscaCep(ids, { documento = document, fetchFn = fetch } = {}) {
  const el = (k) => documento.getElementById(ids[k]);
  const campoCep = el('cep');
  const aviso = el('aviso');
  let rodada = 0;
  const dizer = (texto, tipo = '') => { if (aviso) { aviso.textContent = texto; aviso.dataset.tipo = tipo; } };

  campoCep.addEventListener('input', async () => {
    campoCep.value = formatarCep(campoCep.value);
    const minha = ++rodada;
    if (!cepValido(campoCep.value)) { dizer('Digite o CEP e preenchemos o endereço para você.'); return; }
    dizer('Buscando o endereço…', 'buscando');
    const e = await buscarCep(campoCep.value, fetchFn);
    if (minha !== rodada) return;                       // CEP mudou enquanto buscava
    if (!e) { dizer('Não encontramos esse CEP. Confira os números ou preencha o endereço abaixo.', 'erro'); return; }
    if (e.logradouro) el('logradouro').value = e.logradouro;
    if (e.bairro) el('bairro').value = e.bairro;
    if (e.cidade) el('cidade').value = e.cidade;
    if (e.uf && UFS.includes(e.uf)) el('uf').value = e.uf;
    dizer('✓ Endereço encontrado. Confira e informe o número.', 'ok');
    const alvo = el('numero');
    if (alvo && typeof alvo.focus === 'function') alvo.focus();
  });
}
