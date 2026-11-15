// ========================================
// 77 AGENDAPRO — Cache curto em memória para as rotas PÚBLICAS (poupa leituras do Firestore)
// ========================================
// Motivo: o plano gratuito do Firestore dá 50 mil leituras por dia e as rotas públicas (/api/negocio,
// /api/agendamentos-ocupados) podem ser chamadas por qualquer pessoa, quantas vezes quiser — um robô (ou um rastreador)
// bastaria para gastar a cota do dia inteiro e derrubar o sistema para TODOS os negócios. Com este cache, repetir a
// mesma consulta (mesmo variando parâmetros à toa) custa 1 leitura a cada TTL por instância da função, não uma por chamada.
// Chamadas simultâneas iguais dividem a mesma consulta. Respostas de "não existe" também ficam guardadas (curto), para que
// tentar links inventados não custe leituras.
//
// Cada instância da Vercel tem o seu cache (melhor esforço, como o limite por IP). Em teste fica DESLIGADO
// (node --test define NODE_TEST_CONTEXT); CACHE_API=1/0 força ligar/desligar.

const memoria = new Map();
const MAX_ENTRADAS = 500;

function ativo() {
  if (process.env.CACHE_API === '1') return true;
  if (process.env.CACHE_API === '0') return false;
  return !process.env.NODE_TEST_CONTEXT;
}

function limpar(agora) {
  for (const [k, v] of memoria) if (v.ate <= agora) memoria.delete(k);
  while (memoria.size > MAX_ENTRADAS) memoria.delete(memoria.keys().next().value);
}

/** Devolve o valor guardado (se ainda vale) ou executa `buscar()` e guarda por `ttlMs`. Erros não ficam guardados. */
async function comCache(chave, ttlMs, buscar) {
  if (!ativo()) return buscar();
  const agora = Date.now();
  const e = memoria.get(chave);
  if (e && e.ate > agora) return e.promessa;
  const promessa = Promise.resolve().then(buscar);
  memoria.set(chave, { ate: agora + ttlMs, promessa });
  promessa.catch(() => { if (memoria.get(chave) && memoria.get(chave).promessa === promessa) memoria.delete(chave); });
  if (memoria.size > MAX_ENTRADAS) limpar(agora);
  return promessa;
}

/** Esquece tudo cuja chave começa com `prefixo` (ex.: depois de um agendamento, a ocupação daquele negócio). */
function invalidar(prefixo) {
  for (const k of [...memoria.keys()]) if (k.startsWith(prefixo)) memoria.delete(k);
}

module.exports = { comCache, invalidar };
