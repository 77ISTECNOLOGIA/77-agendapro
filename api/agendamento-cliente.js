// ========================================
// 77 AGENDAPRO — API: Autoatendimento do cliente (listar/cancelar/remarcar)
// Vercel Serverless Function (Node.js)
// ========================================
// O cliente final não tem login (Firebase Auth), então as regras do
// Realtime Database bloqueiam qualquer escrita dele em um agendamento já
// existente (só a criação inicial é liberada, ver database.rules.json).
// Esta função usa o Admin SDK pra fazer essas ações, mas só depois de
// confirmar que o agendamento pertence mesmo ao whatsapp informado —
// nunca confia em "é meu" vindo pronto do navegador (mesmo padrão de
// send-notification.js e agendamentos-ocupados.js).

const admin = require('firebase-admin');

let erroInicializacao = null;
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      }),
      databaseURL: 'https://agendapro-179cb-default-rtdb.firebaseio.com'
    });
  } catch (e) {
    erroInicializacao = e;
  }
}

// Autoatendimento do cliente tem duas travas de negócio (dono não é afetado,
// só remarca/cancela sem limite pelo painel):
// 1. só pode cancelar ou remarcar até 1 dia (data corrida) antes do agendamento original;
// 2. só pode remarcar 1 vez por agendamento — depois disso, fala direto com o estabelecimento.
const LIMITE_REMARCACOES_CLIENTE = 1;

function normalizarWhatsapp(numero) {
  const digitos = String(numero || '').replace(/\D/g, '');
  if (digitos.length === 11) return '55' + digitos;
  if (digitos.length === 13 && digitos.startsWith('55')) return digitos;
  return digitos;
}

// Vercel executa em UTC — calcular "hoje" com new Date().getFullYear() etc
// dá o dia errado no fim da tarde/noite no horário do Brasil (mesma classe
// de bug já corrigida no BarOS com dataLocalHoje()).
function hojeChaveBrasil() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function minutoAgoraBrasil() {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const h = Number(partes.find(p => p.type === 'hour').value);
  const m = Number(partes.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

function horaParaMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function diaSemanaDaChave(dataChave) {
  const [ano, mes, dia] = dataChave.split('-').map(Number);
  const dias = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  return dias[new Date(ano, mes - 1, dia).getDay()];
}

async function verificarSlotDisponivel(db, slug, { profissionalId, dataChave, horario, duracaoMin, ignorarId }) {
  const [profSnap, infoSnap, agsSnap] = await Promise.all([
    db.ref(`barbearias/${slug}/profissionais/${profissionalId}`).once('value'),
    db.ref(`barbearias/${slug}/info`).once('value'),
    db.ref(`barbearias/${slug}/agendamentos`).once('value')
  ]);

  const prof = profSnap.val();
  if (!prof || prof.ativo === false) return { ok: false, motivo: 'Profissional indisponível' };

  const diaSemana = diaSemanaDaChave(dataChave);
  const horarioTrabalho = (prof.horarioTrabalho && prof.horarioTrabalho[diaSemana])
    || ((infoSnap.val() || {}).horarioFuncionamento || {})[diaSemana];

  if (!horarioTrabalho || !horarioTrabalho.ativo) return { ok: false, motivo: 'Fora do horário de trabalho' };

  const inicioExp = horaParaMinutos(horarioTrabalho.inicio || '09:00');
  const fimExp = horaParaMinutos(horarioTrabalho.fim || '20:00');
  const slotInicio = horaParaMinutos(horario);
  const slotFim = slotInicio + duracaoMin;

  if (slotInicio < inicioExp || slotFim > fimExp) return { ok: false, motivo: 'Fora do horário de trabalho' };

  const hojeChave = hojeChaveBrasil();
  if (dataChave < hojeChave) return { ok: false, motivo: 'Data no passado' };
  if (dataChave === hojeChave) {
    const minutosAgora = minutoAgoraBrasil();
    if (slotInicio < minutosAgora + 30) return { ok: false, motivo: 'Horário muito próximo ou já passou' };
  }

  const bloqueios = (prof.bloqueios && prof.bloqueios[dataChave]) || [];
  if (bloqueios.includes(horario)) return { ok: false, motivo: 'Horário bloqueado' };

  const agendamentos = agsSnap.val() || {};
  const conflita = Object.entries(agendamentos).some(([id, a]) => {
    if (id === ignorarId) return false;
    if (a.profissionalId !== profissionalId || a.dataChave !== dataChave || a.status === 'cancelado') return false;
    const aInicio = horaParaMinutos(a.horario);
    const aFim = aInicio + a.duracaoMin;
    return slotInicio < aFim && slotFim > aInicio;
  });
  if (conflita) return { ok: false, motivo: 'Horário já ocupado' };

  return { ok: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  if (erroInicializacao) {
    console.error('Erro ao inicializar Firebase Admin:', erroInicializacao);
    return res.status(500).json({ erro: 'Erro de configuração do servidor.', detalhes: erroInicializacao.message });
  }

  const { slug, whatsapp, action, agendamentoId, novaDataChave, novoHorario } = req.body || {};

  if (!slug || !whatsapp || !action) {
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: slug, whatsapp, action' });
  }

  const whatsNorm = normalizarWhatsapp(whatsapp);
  const db = admin.database();

  try {
    if (action === 'listar') {
      const snap = await db.ref(`barbearias/${slug}/agendamentos`).once('value');
      const todos = snap.val() || {};
      const meus = Object.entries(todos)
        .filter(([, a]) => a.clienteWhatsapp === whatsNorm)
        .map(([id, a]) => ({
          id,
          profissionalId: a.profissionalId,
          profissionalNome: a.profissionalNome,
          servicos: a.servicos,
          dataChave: a.dataChave,
          horario: a.horario,
          duracaoMin: a.duracaoMin,
          valorTotal: a.valorTotal,
          status: a.status,
          remarcacoesCliente: a.remarcacoesCliente || 0
        }))
        .sort((a, b) => (a.dataChave + a.horario).localeCompare(b.dataChave + b.horario));

      return res.status(200).json({ agendamentos: meus });
    }

    if (action === 'cancelar') {
      if (!agendamentoId) return res.status(400).json({ erro: 'Parâmetro obrigatório: agendamentoId' });

      const agRef = db.ref(`barbearias/${slug}/agendamentos/${agendamentoId}`);
      const agSnap = await agRef.once('value');
      const ag = agSnap.val();

      if (!ag || ag.clienteWhatsapp !== whatsNorm) {
        return res.status(404).json({ erro: 'Agendamento não encontrado' });
      }
      if (ag.status !== 'confirmado') {
        return res.status(400).json({ erro: 'Este agendamento não pode mais ser cancelado' });
      }
      if (ag.dataChave <= hojeChaveBrasil()) {
        return res.status(400).json({ erro: 'Esse agendamento está a menos de 1 dia da data marcada. Pra cancelar agora, entre em contato direto com o estabelecimento.' });
      }

      await agRef.update({ status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: 'cliente' });
      return res.status(200).json({ sucesso: true });
    }

    if (action === 'remarcar') {
      if (!agendamentoId || !novaDataChave || !novoHorario) {
        return res.status(400).json({ erro: 'Parâmetros obrigatórios: agendamentoId, novaDataChave, novoHorario' });
      }

      const agRef = db.ref(`barbearias/${slug}/agendamentos/${agendamentoId}`);
      const agSnap = await agRef.once('value');
      const ag = agSnap.val();

      if (!ag || ag.clienteWhatsapp !== whatsNorm) {
        return res.status(404).json({ erro: 'Agendamento não encontrado' });
      }
      if (ag.status !== 'confirmado') {
        return res.status(400).json({ erro: 'Este agendamento não pode mais ser remarcado' });
      }
      if (ag.dataChave <= hojeChaveBrasil()) {
        return res.status(400).json({ erro: 'Esse agendamento está a menos de 1 dia da data marcada. Pra remarcar agora, entre em contato direto com o estabelecimento.' });
      }
      if ((ag.remarcacoesCliente || 0) >= LIMITE_REMARCACOES_CLIENTE) {
        return res.status(400).json({ erro: 'Esse agendamento já foi remarcado o número máximo de vezes permitido. Entre em contato direto com o estabelecimento.' });
      }

      const disponibilidade = await verificarSlotDisponivel(db, slug, {
        profissionalId: ag.profissionalId,
        dataChave: novaDataChave,
        horario: novoHorario,
        duracaoMin: ag.duracaoMin,
        ignorarId: agendamentoId
      });
      if (!disponibilidade.ok) {
        return res.status(409).json({ erro: `Horário indisponível: ${disponibilidade.motivo}` });
      }

      await agRef.update({
        dataChave: novaDataChave,
        horario: novoHorario,
        lembreteEnviado: false,
        remarcadoEm: new Date().toISOString(),
        remarcadoPor: 'cliente',
        remarcacoesCliente: (ag.remarcacoesCliente || 0) + 1
      });
      return res.status(200).json({ sucesso: true });
    }

    return res.status(400).json({ erro: 'Ação inválida' });
  } catch (err) {
    console.error('Erro em agendamento-cliente:', err);
    return res.status(500).json({ erro: 'Erro ao processar solicitação', detalhes: err.message });
  }
};
