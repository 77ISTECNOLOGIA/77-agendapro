// ========================================
// 77 AGENDAPRO — Endereço do estabelecimento (validação e texto) — funções puras
// ========================================
// O navegador preenche o endereço pelo CEP (js/cep.js), mas quem manda é o servidor: aqui tudo é validado
// de novo antes de gravar. O mesmo módulo serve ao cadastro (api/cadastrar-negocio.js) e às Configurações
// do dono (api/configurar-negocio.js).

const { ErroNegocio } = require('./http');

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Valida e normaliza o endereço. Obrigatórios: CEP, rua, número ("S/N" vale), bairro, cidade e UF.
 * Complemento é opcional. Lança ErroNegocio(400) com a mensagem do primeiro problema.
 */
function normalizarEndereco(b) {
  const o = b && typeof b === 'object' ? b : {};
  const cepDigitos = String(o.cep || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(cepDigitos)) throw new ErroNegocio(400, 'Digite um CEP válido (8 números).');
  const logradouro = texto(o.logradouro, 80);
  if (logradouro.length < 2) throw new ErroNegocio(400, 'Informe a rua (ou avenida) do estabelecimento.');
  const numero = texto(o.numero, 10);
  if (!numero) throw new ErroNegocio(400, 'Informe o número do endereço (ou S/N, se não houver).');
  const bairro = texto(o.bairro, 60);
  if (bairro.length < 2) throw new ErroNegocio(400, 'Informe o bairro.');
  const cidade = texto(o.cidade, 60);
  if (cidade.length < 2) throw new ErroNegocio(400, 'Informe a cidade.');
  const uf = String(o.uf || '').trim().toUpperCase();
  if (!UFS.includes(uf)) throw new ErroNegocio(400, 'Escolha o estado (UF).');
  return {
    cep: cepDigitos.slice(0, 5) + '-' + cepDigitos.slice(5),
    logradouro, numero, complemento: texto(o.complemento, 40), bairro, cidade, uf
  };
}

/** "Rua A, 123 - Sala 2 - Bairro, Cidade - UF, CEP 00000-000" (serve para mapa e agenda do cliente). */
function enderecoTexto(e) {
  const rua = e.logradouro + ', ' + e.numero + (e.complemento ? ' - ' + e.complemento : '');
  return rua + ' - ' + e.bairro + ', ' + e.cidade + ' - ' + e.uf + ', CEP ' + e.cep;
}

/** "Bairro, Cidade" — cabeçalho curto do link do cliente. */
function enderecoCurto(e) {
  return e.bairro + ', ' + e.cidade;
}

/**
 * Texto que o botão "Ver no mapa" manda ao Google Maps. Procurar pelo ENDEREÇO ("Rua Liberdade, 20 - Mangueira...")
 * erra quando há ruas de mesmo nome na cidade (o Google escolheu outra "Rua da Liberdade", de outro CEP). Procurar pelo
 * CEP + cidade cai na rua certa. CEPs terminados em -000 são de localidade (a cidade toda), então nesses vale o endereço.
 */
function consultaMapa(detalhe, enderecoCompleto) {
  const d = detalhe || {};
  const cep = String(d.cep || '');
  if (/^\d{5}-\d{3}$/.test(cep) && !cep.endsWith('-000') && d.cidade && d.uf) return cep + ', ' + d.cidade + ' - ' + d.uf;
  return String(enderecoCompleto || '').trim();
}

const MENSAGEM_LINK_MAPA = 'Cole um link do Google Maps (o de "Compartilhar", que começa com maps.app.goo.gl ou google.com/maps).';

/** Link de localização colado pelo dono. Só aceita endereços do Google Maps (https). Vazio = sem link. */
function validarLinkMapa(entrada) {
  const v = String(entrada == null ? '' : entrada).trim();
  if (!v) return '';
  if (v.length > 400) throw new ErroNegocio(400, MENSAGEM_LINK_MAPA);
  let u;
  try { u = new URL(v); } catch (_) { throw new ErroNegocio(400, MENSAGEM_LINK_MAPA); }
  const host = u.hostname.toLowerCase();
  const ok = u.protocol === 'https:' && !u.username && !u.password && (
    host === 'maps.app.goo.gl'
    || ((host === 'google.com' || host === 'www.google.com' || host === 'maps.google.com' || host === 'goo.gl') && u.pathname.startsWith('/maps'))
  );
  if (!ok) throw new ErroNegocio(400, MENSAGEM_LINK_MAPA);
  return u.toString();
}

/** Mesma regra, sem lançar erro: valor inválido vira vazio (usado ao devolver dados públicos). */
function linkMapaSeguro(entrada) {
  try { return validarLinkMapa(entrada); } catch (_) { return ''; }
}

/** Campos que vão para o documento do negócio. */
function camposDoEndereco(e) {
  return { endereco: enderecoTexto(e), enderecoDetalhe: e, cidade: e.cidade, bairro: e.bairro };
}

module.exports = { UFS, normalizarEndereco, enderecoTexto, enderecoCurto, camposDoEndereco, consultaMapa, validarLinkMapa, linkMapaSeguro };
