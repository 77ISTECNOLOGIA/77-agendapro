// Testes das funções puras: datas, telefones, disponibilidade e situação comercial.

const test = require('node:test');
const assert = require('node:assert/strict');

const T = require('../api/_lib/tempo');
const { verificarSlot } = require('../api/_lib/disponibilidade');
const { situacaoNegocio, slugValido, profissionalPublico, CARENCIA_TRIAL_DIAS } = require('../api/_lib/negocio');

const info = {
  horarioFuncionamento: Object.fromEntries(
    ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
      .map(d => [d, { ativo: d !== 'domingo', inicio: '09:00', fim: '19:00' }])
  )
};
const prof = { id: 'p1', ativo: true };
const agora = { dataChave: '2030-01-01', minutos: 600 }; // terça, 10:00
const base = { prof, info, agendamentos: [], dataChave: '2030-01-03', horario: '10:00', duracaoMin: 30, agora }; // quinta

test('datas: validação, dia da semana e soma de dias sem depender do fuso', () => {
  assert.equal(T.dataChaveValida('2030-02-29'), false);
  assert.equal(T.dataChaveValida('2028-02-29'), true);
  assert.equal(T.dataChaveValida('2030-1-3'), false);
  assert.equal(T.diaSemanaDaChave('2030-01-03'), 'quinta');
  assert.equal(T.diaSemanaDaChave('2030-01-06'), 'domingo');
  assert.equal(T.somarDias('2030-12-31', 1), '2031-01-01');
  assert.equal(T.somarDias('2030-03-01', -1), '2030-02-28');
});

test('datas: "hoje" usa o fuso de São Paulo (às 01:00 UTC ainda é o dia anterior)', () => {
  assert.equal(T.hojeChaveBrasil(new Date('2030-06-10T01:00:00Z')), '2030-06-09');
  assert.equal(T.hojeChaveBrasil(new Date('2030-06-10T12:00:00Z')), '2030-06-10');
  assert.equal(T.minutoAgoraBrasil(new Date('2030-06-10T15:30:00Z')), 12 * 60 + 30);
});

test('whatsapp: normaliza e só aceita celular brasileiro', () => {
  assert.equal(T.normalizarWhatsapp('(21) 99999-1234'), '5521999991234');
  assert.equal(T.whatsappValido('5521999991234'), true);
  assert.equal(T.whatsappValido('552188881234'), false);   // fixo/sem o 9
  assert.equal(T.whatsappValido('21999991234'), false);    // sem 55
  assert.equal(T.whatsappValido("55219999912<script>"), false);
  assert.equal(T.horaValida('09:30'), true);
  assert.equal(T.horaValida('9:30'), false);
  assert.equal(T.horaValida('<img onerror=1>'), false);
});

test('disponibilidade: caso feliz e limites do expediente', () => {
  assert.deepEqual(verificarSlot(base), { ok: true });
  assert.equal(verificarSlot({ ...base, horario: '18:30' }).ok, true);   // termina 19:00 em ponto
  assert.equal(verificarSlot({ ...base, horario: '18:45' }).ok, false);  // estoura o expediente
  assert.equal(verificarSlot({ ...base, horario: '08:30' }).ok, false);  // antes de abrir
});

test('disponibilidade: dia fechado, passado, distante e horário fora da grade', () => {
  assert.match(verificarSlot({ ...base, dataChave: '2030-01-06' }).motivo, /horário de trabalho/); // domingo
  assert.match(verificarSlot({ ...base, dataChave: '2029-12-31' }).motivo, /passado/);
  assert.match(verificarSlot({ ...base, dataChave: '2031-01-03' }).motivo, /distante/);
  assert.match(verificarSlot({ ...base, horario: '10:15' }).motivo, /inválido/);
});

test('disponibilidade: hoje exige 30 min de antecedência', () => {
  const hoje = { ...base, dataChave: '2030-01-01' };
  assert.equal(verificarSlot({ ...hoje, horario: '10:00' }).ok, false);
  assert.equal(verificarSlot({ ...hoje, horario: '10:30' }).ok, true);
});

test('disponibilidade: conflito, cancelado, outro profissional e remarcação do próprio horário', () => {
  const existente = { id: 'a1', profissionalId: 'p1', dataChave: '2030-01-03', horario: '10:00', duracaoMin: 60, status: 'confirmado' };
  assert.equal(verificarSlot({ ...base, agendamentos: [existente] }).ok, false);
  assert.equal(verificarSlot({ ...base, horario: '10:30', agendamentos: [existente] }).ok, false); // dentro dos 60min
  assert.equal(verificarSlot({ ...base, horario: '11:00', agendamentos: [existente] }).ok, true);
  assert.equal(verificarSlot({ ...base, agendamentos: [{ ...existente, status: 'cancelado' }] }).ok, true);
  assert.equal(verificarSlot({ ...base, agendamentos: [{ ...existente, profissionalId: 'p2' }] }).ok, true);
  assert.equal(verificarSlot({ ...base, agendamentos: [existente], ignorarId: 'a1' }).ok, true);
});

test('disponibilidade: bloqueio do profissional e profissional inativo', () => {
  const comBloqueio = { ...prof, bloqueios: { '2030-01-03': ['10:00'] } };
  assert.match(verificarSlot({ ...base, prof: comBloqueio }).motivo, /bloqueado/);
  assert.match(verificarSlot({ ...base, prof: { ...prof, ativo: false } }).motivo, /indisponível/);
});

test('disponibilidade: horário próprio do profissional vale mais que o do negócio', () => {
  const manha = { ...prof, horarioTrabalho: { quinta: { ativo: true, inicio: '08:00', fim: '12:00' } } };
  assert.equal(verificarSlot({ ...base, prof: manha, horario: '08:00' }).ok, true);
  assert.equal(verificarSlot({ ...base, prof: manha, horario: '14:00' }).ok, false);
});

test('situação do negócio: trial, carência, suspensão e cadastro legado', () => {
  const dia = 86400000;
  const t0 = Date.parse('2030-01-10T12:00:00Z');
  assert.equal(situacaoNegocio({ status: 'ativa' }, t0).aceita, true);
  assert.equal(situacaoNegocio({}, t0).aceita, true); // sem status = trial (convenção do painel77)
  assert.equal(situacaoNegocio({ status: 'aguardando_aprovacao' }, t0).aceita, true); // legado: link nunca dependeu de aprovação
  assert.equal(situacaoNegocio({ status: 'suspensa' }, t0).aceita, false);
  assert.equal(situacaoNegocio({ status: 'qualquer-coisa' }, t0).aceita, false);

  const fim = new Date(t0 - 2 * dia).toISOString();          // trial venceu há 2 dias: dentro da carência
  assert.equal(situacaoNegocio({ status: 'trial', trialFim: fim }, t0).aceita, true);
  const longe = new Date(t0 - (CARENCIA_TRIAL_DIAS + 1) * dia).toISOString();
  assert.equal(situacaoNegocio({ status: 'trial', trialFim: longe }, t0).aceita, false);
});

test('slug: formato aceito e recusado', () => {
  assert.equal(slugValido('barbearia-do-joao'), true);
  for (const ruim of ['ab', 'Com-Maiuscula', '-comeca', 'termina-', 'dois--hifens', 'com_underline', 'a/b', '../x', 'x'.repeat(51)]) {
    assert.equal(slugValido(ruim), false, ruim);
  }
});

test('profissional público não vaza comissão nem bloqueios passados', () => {
  const p = profissionalPublico('p1', {
    nome: 'João', comissao: 40, ativo: true,
    bloqueios: { '2029-01-01': ['10:00'], '2030-06-01': ['11:00'] }
  }, '2030-01-01');
  assert.equal('comissao' in p, false);
  assert.deepEqual(Object.keys(p.bloqueios), ['2030-06-01']);
});
