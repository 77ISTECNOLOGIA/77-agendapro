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

/** Campos que vão para o documento do negócio. */
function camposDoEndereco(e) {
  return { endereco: enderecoTexto(e), enderecoDetalhe: e, cidade: e.cidade, bairro: e.bairro };
}

module.exports = { UFS, normalizarEndereco, enderecoTexto, enderecoCurto, camposDoEndereco };
