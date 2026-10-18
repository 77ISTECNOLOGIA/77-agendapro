// ========================================
// 77 AGENDAPRO — API: Criar agendamento (cliente final, sem login)
// Vercel Serverless Function (Node.js)
// ========================================
// Substitui a escrita direta do navegador no Firestore. O servidor:
//  - recalcula preço e duração a partir dos serviços cadastrados (nunca
//    confia em valorTotal/duracaoMin vindos do navegador);
//  - valida a disponibilidade DENTRO de uma transação, então dois clientes
//    no mesmo horário não conseguem os dois confirmar (antes a checagem era
//    só no navegador, antes do addDoc);
//  - recusa negócios suspensos / não aprovados / com trial vencido;
//  - atualiza o cadastro do cliente (contador de visitas) com a mesma atomicidade;
//  - dispara a notificação push do dono (sem expor endpoint público pra isso).

const { db } = require('./_lib/firebase');
const {
  agoraBrasil, hojeChaveBrasil, dataChaveValida, horaValida, normalizarWhatsapp, whatsappValido
} = require('./_lib/tempo');
const { verificarSlot } = require('./_lib/disponibilidade');
const { slugValido, situacaoNegocio, profissionalRealizaServico } = require('./_lib/negocio');
const { dentroDoLimite, responder, ErroNegocio, tratarErro, corpoDe } = require('./_lib/http');
const { notificarNovoAgendamento } = require('./_lib/notificar');

const MAX_SERVICOS_POR_AGENDAMENTO = 10;
const MAX_AGENDAMENTOS_FUTUROS_POR_CLIENTE = 5;

function limparNome(nome) {
  // remove caracteres de controle e espaços repetidos
  return String(nome || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
  if (!dentroDoLimite(req, 'criar-agendamento', 10, 60000)) {
    return responder(res, 429, { erro: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });
  }

  const b = corpoDe(req);
  const slug = String(b.slug || '').toLowerCase();
  const whatsapp = normalizarWhatsapp(b.whatsapp);
  const nome = limparNome(b.nome);
  const { profissionalId, dataChave, horario } = b;
  const servicosIds = Array.isArray(b.servicosIds) ? [...new Set(b.servicosIds.map(String))] : [];

  if (!slugValido(slug)) return responder(res, 400, { erro: 'Link inválido' });
  if (!whatsappValido(whatsapp)) return responder(res, 400, { erro: 'WhatsApp inválido' });
  if (nome.length < 2 || nome.length > 80) return responder(res, 400, { erro: 'Nome inválido' });
  if (typeof profissionalId !== 'string' || !profissionalId || profissionalId.length > 64) {
    return responder(res, 400, { erro: 'Profissional inválido' });
  }
  if (!dataChaveValida(dataChave) || !horaValida(horario)) return responder(res, 400, { erro: 'Data ou horário inválido' });
  if (servicosIds.length < 1 || servicosIds.length > MAX_SERVICOS_POR_AGENDAMENTO
      || servicosIds.some(id => !id || id.length > 64 || id.includes('/'))) {
    return responder(res, 400, { erro: 'Serviços inválidos' });
  }

  try {
    const firestore = db();
    const negocioRef = firestore.collection('barbearias').doc(slug);
    const agsRef = negocioRef.collection('agendamentos');

    const [infoSnap, profSnap, ...servicosSnaps] = await Promise.all([
      negocioRef.get(),
      negocioRef.collection('profissionais').doc(profissionalId).get(),
      ...servicosIds.map(id => negocioRef.collection('servicos').doc(id).get())
    ]);

    if (!infoSnap.exists) throw new ErroNegocio(404, 'Negócio não encontrado');
    const info = infoSnap.data();
    const situacao = situacaoNegocio(info);
    if (!situacao.aceita) throw new ErroNegocio(403, situacao.motivo);

    if (!profSnap.exists || profSnap.data().ativo === false) throw new ErroNegocio(409, 'Profissional indisponível');
    const prof = { id: profSnap.id, ...profSnap.data() };

    const servicos = servicosSnaps.map((s) => {
      const d = s.data();
      if (!s.exists || d.ativo === false || !Number.isFinite(d.preco) || !Number.isFinite(d.duracaoMin) || d.duracaoMin <= 0) {
        throw new ErroNegocio(409, 'Um dos serviços escolhidos não está mais disponível');
      }
      // Serviço restrito a certos profissionais: a regra vale aqui no servidor,
      // não só na tela (um cliente mal-intencionado poderia burlar a tela).
      if (!profissionalRealizaServico(d, profissionalId)) {
        throw new ErroNegocio(409, `${d.nome} não é realizado por ${prof.nome || 'este profissional'}. Escolha outro profissional.`);
      }
      return { id: s.id, nome: d.nome, preco: d.preco, duracaoMin: d.duracaoMin };
    });
    const valorTotal = servicos.reduce((soma, s) => soma + s.preco, 0);
    const duracaoMin = servicos.reduce((soma, s) => soma + s.duracaoMin, 0);

    // Evita um mesmo número lotar a agenda com reservas
    const hoje = hojeChaveBrasil();
    const doCliente = await agsRef.where('clienteWhatsapp', '==', whatsapp).get();
    const futuros = doCliente.docs.filter((d) => {
      const a = d.data();
      return a.status === 'confirmado' && a.dataChave >= hoje;
    }).length;
    if (futuros >= MAX_AGENDAMENTOS_FUTUROS_POR_CLIENTE) {
      throw new ErroNegocio(429, 'Você já tem vários agendamentos futuros neste estabelecimento. Cancele algum ou fale direto com eles.');
    }

    const clienteRef = negocioRef.collection('clientes').doc(whatsapp);
    const novoRef = agsRef.doc();
    const agora = new Date().toISOString();

    const agendamento = {
      clienteWhatsapp: whatsapp,
      clienteNome: nome,
      profissionalId,
      profissionalNome: prof.nome || '',
      servicos,
      dataChave,
      horario,
      duracaoMin,
      valorTotal,
      status: 'confirmado',
      criadoEm: agora,
      origem: 'cliente'
    };

    await firestore.runTransaction(async (tx) => {
      // Todas as leituras antes das escritas (regra do Firestore)
      const [diaSnap, clienteSnap] = await Promise.all([
        tx.get(agsRef.where('dataChave', '==', dataChave)),
        tx.get(clienteRef)
      ]);

      const v = verificarSlot({
        prof, info,
        agendamentos: diaSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        dataChave, horario, duracaoMin,
        agora: agoraBrasil()
      });
      if (!v.ok) throw new ErroNegocio(409, `Horário indisponível: ${v.motivo}`);

      tx.set(novoRef, agendamento);

      if (clienteSnap.exists) {
        const atual = clienteSnap.data();
        tx.set(clienteRef, {
          ...atual,
          nome,
          totalAgendamentos: (atual.totalAgendamentos || 0) + 1,
          ultimoAgendamento: agora
        });
      } else {
        tx.set(clienteRef, {
          nome,
          whatsapp,
          primeiraVisita: agora,
          ultimoAgendamento: agora,
          totalAgendamentos: 1
        });
      }
    });

    await notificarNovoAgendamento(negocioRef, novoRef, agendamento);

    return responder(res, 201, {
      sucesso: true,
      id: novoRef.id,
      agendamento: { ...agendamento, profissionalNome: prof.nome || '' }
    });
  } catch (err) {
    return tratarErro(res, err, 'criar-agendamento');
  }
};
