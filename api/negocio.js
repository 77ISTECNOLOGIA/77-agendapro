// ========================================
// 77 AGENDAPRO — API: Dados públicos do negócio (leitura do visitante)
// Vercel Serverless Function (Node.js)
// ========================================
// O Firestore não tem mais NENHUMA leitura pública (firestore.rules). O link
// público do cliente lê tudo por aqui, já filtrado: sem comissão dos
// profissionais, sem tokens de notificação, sem dados de outros clientes.
// A ocupação futura (sem PII) só vem com ?ocupados=1: a tela a busca na escolha do horário (/api/agendamentos-ocupados).
//
// CONSUMO DO FIRESTORE: esta rota é pública e o plano gratuito tem 50 mil leituras/dia, então a resposta fica guardada por
// poucos segundos em memória (api/_lib/cache.js) — repetir a chamada não relê o banco.

const { db } = require('./_lib/firebase');
const { hojeChaveBrasil } = require('./_lib/tempo');
const {
  slugValido, situacaoNegocio, infoPublica, profissionalPublico, servicoPublico, servicoPublicoLeve
} = require('./_lib/negocio');
const { dentroDoLimite, responder, tratarErro } = require('./_lib/http');
const { ocupaHorario } = require('./_lib/sinal');
const { comCache } = require('./_lib/cache');
const { configSinal } = require('./_lib/sinal');

// Por quanto tempo repetir a mesma resposta sem reler o banco
const TTL_NEGOCIO_MS = 20000, TTL_FOTOS_MS = 120000;   // vale também para "não existe" (tentar links inventados não relê o banco a cada tentativa)

async function montarResposta(slug, querOcupados) {
  const negocioRef = db().collection('barbearias').doc(slug);
  const hoje = hojeChaveBrasil();
  const [infoSnap, servicosSnap, profsSnap, ocupadosSnap] = await Promise.all([
    negocioRef.get(),
    negocioRef.collection('servicos').get(),
    negocioRef.collection('profissionais').get(),
    querOcupados ? negocioRef.collection('agendamentos').where('dataChave', '>=', hoje).get() : Promise.resolve({ docs: [] })
  ]);

  if (!infoSnap.exists) return { status: 404, corpo: { erro: 'Negócio não encontrado' } };

  const info = infoSnap.data();
  const situacao = situacaoNegocio(info);

  const servicos = {};
  servicosSnap.docs.forEach((d) => { servicos[d.id] = servicoPublicoLeve(d.id, d.data()); });

  // SINAL POR PESSOA: cada profissional pode cobrar (ou não) o sinal; a tela precisa saber, do profissional escolhido, se há
  // sinal, quanto e em quanto tempo — sem nunca receber a chave Pix (essa só sai ao reservar).
  const privados = await Promise.all(profsSnap.docs.map((d) => d.ref.collection('privado').doc('config').get()));
  const profissionais = {};
  profsSnap.docs.forEach((d, i) => {
    const cfg = configSinal(info, d.data(), privados[i] && privados[i].exists ? privados[i].data() : null);
    profissionais[d.id] = { ...profissionalPublico(d.id, d.data(), hoje), sinal: { ativo: cfg.ativo, percentual: cfg.percentual, prazoHoras: cfg.prazoHoras } };
  });

  const ocupados = ocupadosSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => ocupaHorario(a))
    .map((a) => ({
      id: a.id,
      profissionalId: a.profissionalId,
      dataChave: a.dataChave,
      horario: a.horario,
      duracaoMin: a.duracaoMin,
      status: a.status
    }));

  return {
    status: 200,
    corpo: {
      barbearia: {
        ...infoPublica(info),
        aceitaAgendamentos: situacao.aceita,
        motivoIndisponivel: situacao.aceita ? null : situacao.motivo
      },
      servicos,
      profissionais,
      ocupados
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'negocio', 90, 60000)) return responder(res, 429, { erro: 'Muitas requisições. Aguarde um instante.' });

  const slug = String((req.query && req.query.slug) || '').toLowerCase();
  if (!slugValido(slug)) return responder(res, 400, { erro: 'Link inválido' });

  try {
    // Fotos dos serviços: chamada separada, feita pelo link DEPOIS de mostrar a tela. Só lê os serviços e o
    // navegador/CDN podem guardar por 5 minutos (a foto muda raramente; o resto da resposta continua sem cache no navegador).
    if (String((req.query && req.query.fotos) || '') === '1') {
      const fotos = await comCache('fotos:' + slug, TTL_FOTOS_MS, async () => {
        const snap = await db().collection('barbearias').doc(slug).collection('servicos').get();
        const f = {};
        snap.docs.forEach((d) => { const foto = servicoPublico(d.id, d.data()).foto; if (foto) f[d.id] = foto; });
        return f;
      });
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).json({ fotos });
    }

    // A chave do cache ignora qualquer parâmetro além de slug e ocupados (quem inventa parâmetros não fura o cache)
    const querOcupados = String((req.query && req.query.ocupados) || '') === '1';
    const r = await comCache('negocio:' + slug + (querOcupados ? ':oc' : ''), TTL_NEGOCIO_MS, () => montarResposta(slug, querOcupados));
    return responder(res, r.status, r.corpo);
  } catch (err) {
    return tratarErro(res, err, 'negocio');
  }
};
