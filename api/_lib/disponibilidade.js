// ========================================
// 77 AGENDAPRO — Regra única de disponibilidade de horário (função pura)
// ========================================
// Usada por criar-agendamento.js e agendamento-cliente.js (remarcação). A
// versão do navegador (app.js / admin.js) só existe para pintar a grade; quem
// decide de verdade é esta função, dentro de uma transação.

const { horaParaMinutos, diaSemanaDaChave, somarDias } = require('./tempo');

const INTERVALO_MIN = 30;           // granularidade da grade de horários
const ANTECEDENCIA_MIN = 30;        // não agenda "pra daqui a 5 minutos"
const JANELA_MAX_DIAS = 90;         // não agenda além de 90 dias

/**
 * @param {object} p
 * @param {object} p.prof            documento do profissional
 * @param {object} p.info            documento do negócio (horarioFuncionamento)
 * @param {Array}  p.agendamentos    agendamentos do MESMO dia (qualquer profissional)
 * @param {string} p.dataChave       'YYYY-MM-DD'
 * @param {string} p.horario         'HH:MM'
 * @param {number} p.duracaoMin
 * @param {string} [p.ignorarId]     agendamento sendo remarcado
 * @param {{dataChave:string, minutos:number}} p.agora
 * @returns {{ok:true}|{ok:false, motivo:string}}
 */
function verificarSlot({ prof, info, agendamentos, dataChave, horario, duracaoMin, ignorarId, agora }) {
  if (!prof || prof.ativo === false) return { ok: false, motivo: 'Profissional indisponível' };

  if (dataChave < agora.dataChave) return { ok: false, motivo: 'Data no passado' };
  if (dataChave > somarDias(agora.dataChave, JANELA_MAX_DIAS)) return { ok: false, motivo: 'Data muito distante' };

  const dia = diaSemanaDaChave(dataChave);
  const expediente = (prof.horarioTrabalho && prof.horarioTrabalho[dia])
    || ((info && info.horarioFuncionamento) || {})[dia];
  if (!expediente || !expediente.ativo) return { ok: false, motivo: 'Fora do horário de trabalho' };

  const inicioExp = horaParaMinutos(expediente.inicio || '09:00');
  const fimExp = horaParaMinutos(expediente.fim || '20:00');
  const inicio = horaParaMinutos(horario);
  const fim = inicio + duracaoMin;

  if (inicio < inicioExp || fim > fimExp) return { ok: false, motivo: 'Fora do horário de trabalho' };
  if ((inicio - inicioExp) % INTERVALO_MIN !== 0) return { ok: false, motivo: 'Horário inválido' };

  if (dataChave === agora.dataChave && inicio < agora.minutos + ANTECEDENCIA_MIN) {
    return { ok: false, motivo: 'Horário muito próximo ou já passou' };
  }

  const bloqueios = (prof.bloqueios && prof.bloqueios[dataChave]) || [];
  if (bloqueios.includes(horario)) return { ok: false, motivo: 'Horário bloqueado' };

  const profId = prof.id;
  const conflita = (agendamentos || []).some((a) => {
    if (ignorarId && a.id === ignorarId) return false;
    if (a.profissionalId !== profId || a.dataChave !== dataChave || a.status === 'cancelado') return false;
    const aIni = horaParaMinutos(a.horario);
    return inicio < aIni + a.duracaoMin && fim > aIni;
  });
  if (conflita) return { ok: false, motivo: 'Horário já ocupado' };

  return { ok: true };
}

module.exports = { verificarSlot, INTERVALO_MIN, ANTECEDENCIA_MIN, JANELA_MAX_DIAS };
