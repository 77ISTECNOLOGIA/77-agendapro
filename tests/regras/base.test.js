// Regras do Firestore HOJE (antes do login por profissional): visitante, dono, outro dono, super-admin e usuário sem vínculo.
// Rode com: npm run test:regras

const test = require('node:test');
const assert = require('node:assert/strict');
const { fs, emulatorNoAr } = require('./_emulador');

const VALIDO = { clienteWhatsapp: '5521999990000', clienteNome: 'Maria', profissionalId: 'prof-a1', dataChave: '2026-12-01', horario: '10:00', duracaoMin: 30, valorTotal: 40, status: 'confirmado', servicos: [{ nome: 'Corte', preco: 40 }] };

async function preparar() {
  await fs.limpar();
  await fs.semear('admins77/super1', { role: 'super_admin' });
  await fs.semear('usuarios/dono-a', { barbeariaId: 'neg-a', role: 'owner' });
  await fs.semear('usuarios/dono-b', { barbeariaId: 'neg-b', role: 'owner' });
  for (const n of ['a', 'b']) {
    await fs.semear(`barbearias/neg-${n}`, { nome: 'Barbearia ' + n, endereco: 'Rua ' + n, telefone: '5521999990000', status: 'trial', plano: 'trial', trialFim: '2026-12-31', horarioFuncionamento: { segunda: { ativo: true, inicio: '09:00', fim: '19:00' } } });
    await fs.semear(`barbearias/neg-${n}/servicos/s1`, { nome: 'Corte', preco: 40, duracaoMin: 30 });
    await fs.semear(`barbearias/neg-${n}/profissionais/prof-${n}1`, { nome: 'Barbeiro ' + n, comissao: 40 });
    await fs.semear(`barbearias/neg-${n}/agendamentos/ag-${n}1`, { ...VALIDO, profissionalId: `prof-${n}1` });
    await fs.semear(`barbearias/neg-${n}/clientes/5521999990000`, { nome: 'Maria', whatsapp: '5521999990000' });
    await fs.semear(`barbearias/neg-${n}/dispositivos/d1`, { token: 'tok-' + n });
  }
  await fs.semear('cadastrosAguardando/neg-a', { barbeariaId: 'neg-a' });
  await fs.semear('logs77/l1', { acao: 'teste' });
}

let ligado = false;
test.before(async () => {
  ligado = await emulatorNoAr();
  if (!ligado) throw new Error('Emulador do Firestore não está no ar. Rode: npm run test:regras');
  await preparar();
});
test.beforeEach(async () => { if (ligado) await preparar(); });

const COLECOES = ['servicos', 'profissionais', 'agendamentos', 'clientes', 'dispositivos'];

test('visitante sem login: nada de ler nem gravar (negócio, subcoleções, vínculos, 77 IS)', async () => {
  for (const p of ['barbearias/neg-a', 'barbearias/neg-a/servicos/s1', 'barbearias/neg-a/agendamentos/ag-a1', 'barbearias/neg-a/clientes/5521999990000', 'barbearias/neg-a/dispositivos/d1', 'usuarios/dono-a', 'admins77/super1', 'cadastrosAguardando/neg-a', 'logs77/l1']) {
    assert.ok((await fs.ler(p, null)).negado, 'ler ' + p);
  }
  assert.ok((await fs.listar('barbearias', null)).negado);
  assert.ok((await fs.consultar('barbearias/neg-a', 'agendamentos', [], null)).negado);
  assert.ok((await fs.criar('barbearias/neg-a/agendamentos', 'x', VALIDO, null)).negado);
  assert.ok((await fs.atualizar('barbearias/neg-a', { nome: 'Hackeado' }, null)).negado);
  assert.ok((await fs.apagar('barbearias/neg-a/clientes/5521999990000', null)).negado);
});

test('dono lê e usa o PRÓPRIO negócio', async () => {
  assert.ok((await fs.ler('barbearias/neg-a', 'dono-a')).permitido);
  for (const c of COLECOES) assert.ok((await fs.listar(`barbearias/neg-a/${c}`, 'dono-a')).permitido, 'listar ' + c);
  assert.ok((await fs.ler('barbearias/neg-a/agendamentos/ag-a1', 'dono-a')).permitido);
  assert.ok((await fs.ler('usuarios/dono-a', 'dono-a')).permitido, 'o dono lê o próprio vínculo');
});

test('dono NÃO lê nem mexe no negócio de OUTRO dono', async () => {
  assert.ok((await fs.ler('barbearias/neg-b', 'dono-a')).negado);
  for (const c of COLECOES) assert.ok((await fs.listar(`barbearias/neg-b/${c}`, 'dono-a')).negado, 'listar ' + c);
  assert.ok((await fs.ler('barbearias/neg-b/agendamentos/ag-b1', 'dono-a')).negado);
  assert.ok((await fs.consultar('barbearias/neg-b', 'agendamentos', [['profissionalId', 'prof-b1']], 'dono-a')).negado);
  assert.ok((await fs.atualizar('barbearias/neg-b', { nome: 'Invadido' }, 'dono-a')).negado);
  assert.ok((await fs.criar('barbearias/neg-b/agendamentos', 'x', VALIDO, 'dono-a')).negado);
  assert.ok((await fs.apagar('barbearias/neg-b/clientes/5521999990000', 'dono-a')).negado);
  assert.ok((await fs.ler('usuarios/dono-b', 'dono-a')).negado, 'não lê o vínculo de outra pessoa');
  assert.ok((await fs.listar('barbearias', 'dono-a')).negado, 'não lista todos os negócios');
});

test('dono só altera dados cadastrais: nada de status, plano, trial, sinal, link do mapa...', async () => {
  assert.ok((await fs.atualizar('barbearias/neg-a', { nome: 'Novo Nome', endereco: 'Rua Nova', telefone: '5521988887777' }, 'dono-a')).permitido);
  assert.ok((await fs.atualizar('barbearias/neg-a', { horarioFuncionamento: { segunda: { ativo: true, inicio: '08:00', fim: '18:00', pausaInicio: '12:00', pausaFim: '13:00' } } }, 'dono-a')).permitido);
  for (const proibido of [{ status: 'ativa' }, { plano: 'mensal' }, { trialFim: '2099-01-01' }, { sinal: { ativo: true } }, { linkMapa: 'https://x' }, { limiteAgendamentosSemana: 0 }, { enderecoDetalhe: { cep: '1' } }, { criadoPor: 'dono-a' }]) {
    assert.ok((await fs.atualizar('barbearias/neg-a', proibido, 'dono-a')).negado, JSON.stringify(proibido));
  }
  assert.ok((await fs.atualizar('barbearias/neg-a', { nome: '' }, 'dono-a')).negado, 'nome vazio');
  assert.ok((await fs.atualizar('barbearias/neg-a', { nome: 'ok', status: 'ativa' }, 'dono-a')).negado, 'misturar campo permitido com proibido');
});

test('dono não cria nem apaga negócio, nem mexe em vínculos, 77 IS, fila e logs', async () => {
  assert.ok((await fs.substituir('barbearias/neg-novo', { nome: 'Novo', status: 'ativa' }, 'dono-a')).negado);
  assert.ok((await fs.apagar('barbearias/neg-a', 'dono-a')).negado);
  assert.ok((await fs.substituir('usuarios/dono-a', { barbeariaId: 'neg-b' }, 'dono-a')).negado, 'não troca o próprio vínculo para outro negócio');
  assert.ok((await fs.substituir('usuarios/novo', { barbeariaId: 'neg-b' }, 'dono-a')).negado);
  assert.ok((await fs.substituir('admins77/dono-a', { role: 'super_admin' }, 'dono-a')).negado, 'não vira super-admin');
  assert.ok((await fs.ler('cadastrosAguardando/neg-a', 'dono-a')).negado);
  assert.ok((await fs.ler('logs77/l1', 'dono-a')).negado);
});

test('usuário logado SEM vínculo não acessa nada e não consegue se vincular a um negócio (o furo antigo)', async () => {
  assert.ok((await fs.ler('barbearias/neg-a', 'solto')).negado);
  assert.ok((await fs.listar('barbearias/neg-a/clientes', 'solto')).negado);
  assert.ok((await fs.substituir('usuarios/solto', { barbeariaId: 'neg-a', role: 'owner' }, 'solto')).negado);
  assert.ok((await fs.ler('barbearias/neg-a/clientes/5521999990000', 'solto')).negado, 'continua sem acesso mesmo depois da tentativa');
});

test('dono: serviços, profissionais, clientes e aparelhos do próprio negócio (criar, mudar, apagar)', async () => {
  for (const [colecao, id, dados] of [['servicos', 's2', { nome: 'Barba', preco: 30 }], ['profissionais', 'prof-a2', { nome: 'Outro', comissao: 50 }], ['clientes', '5521977776666', { nome: 'João' }], ['dispositivos', 'd2', { token: 'x' }]]) {
    assert.ok((await fs.criar(`barbearias/neg-a/${colecao}`, id, dados, 'dono-a')).permitido, 'criar ' + colecao);
    assert.ok((await fs.atualizar(`barbearias/neg-a/${colecao}/${id}`, { nome: 'Mudou', token: 'y' }, 'dono-a')).permitido, 'mudar ' + colecao);
    assert.ok((await fs.apagar(`barbearias/neg-a/${colecao}/${id}`, 'dono-a')).permitido, 'apagar ' + colecao);
    assert.ok((await fs.criar(`barbearias/neg-b/${colecao}`, id, dados, 'dono-a')).negado, 'criar no negócio alheio: ' + colecao);
  }
});

test('agendamentos do dono: só entram com a forma válida; status e datas válidos também na edição', async () => {
  assert.ok((await fs.criar('barbearias/neg-a/agendamentos', 'novo', VALIDO, 'dono-a')).permitido);
  for (const ruim of [{ clienteWhatsapp: '123' }, { clienteNome: '' }, { dataChave: '01/12/2026' }, { horario: '25:00' }, { duracaoMin: 0 }, { valorTotal: -1 }, { status: 'inventado' }, { servicos: [] }, { profissionalId: '' }]) {
    assert.ok((await fs.criar('barbearias/neg-a/agendamentos', 'ruim' + Math.random().toString(36).slice(2, 6), { ...VALIDO, ...ruim }, 'dono-a')).negado, JSON.stringify(ruim));
  }
  assert.ok((await fs.atualizar('barbearias/neg-a/agendamentos/ag-a1', { status: 'concluido' }, 'dono-a')).permitido);
  assert.ok((await fs.atualizar('barbearias/neg-a/agendamentos/ag-a1', { status: 'sinal_informado' }, 'dono-a')).permitido);
  assert.ok((await fs.atualizar('barbearias/neg-a/agendamentos/ag-a1', { status: 'lixo' }, 'dono-a')).negado);
  assert.ok((await fs.atualizar('barbearias/neg-a/agendamentos/ag-a1', { dataChave: 'amanhã' }, 'dono-a')).negado);
  assert.ok((await fs.apagar('barbearias/neg-a/agendamentos/ag-a1', 'dono-a')).permitido);
});

test('super-admin da 77 IS: lê e gerencia todos os negócios, fila e logs', async () => {
  assert.ok((await fs.ler('barbearias/neg-a', 'super1')).permitido);
  assert.ok((await fs.ler('barbearias/neg-b/clientes/5521999990000', 'super1')).permitido);
  assert.ok((await fs.listar('barbearias', 'super1')).permitido);
  assert.ok((await fs.atualizar('barbearias/neg-b', { status: 'suspensa', plano: 'mensal' }, 'super1')).permitido, 'muda status/plano');
  assert.ok((await fs.ler('cadastrosAguardando/neg-a', 'super1')).permitido);
  assert.ok((await fs.ler('logs77/l1', 'super1')).permitido);
  assert.ok((await fs.criar('logs77', 'l2', { acao: 'x' }, 'super1')).permitido);
  assert.ok((await fs.apagar('barbearias/neg-a', 'super1')).negado, 'nem a 77 IS apaga negócio direto (só o servidor)');
  assert.ok((await fs.substituir('admins77/outro', { role: 'super_admin' }, 'super1')).negado, 'super-admin não é criado pelo navegador');
});
