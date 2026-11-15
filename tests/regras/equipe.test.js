// Regras do Firestore para EQUIPE: sócios e profissionais com visão só do que é deles. Rode com: npm run test:regras
//
// Cenário: negócio "neg-a" com três profissionais.
//   chefe   = administrador pleno (vê tudo e gere o negócio), no formato novo de permissões
//   antigo  = dono antigo (role 'owner' sem "permissoes"): precisa continuar com acesso total
//   socio1  = sócio do prof-1: gere o negócio, mas só vê o que é do prof-1
//   socio2  = sócio do prof-2: idem, para o prof-2
//   func    = profissional do prof-3: não gere o negócio e só vê o que é dele
//   semprof = usuário do negócio sem profissionalId e sem permissão de ver tudo (não pode ver agendamento nenhum)
// E o negócio "neg-b" (de outro dono) para provar que nada vaza entre negócios.

const test = require('node:test');
const assert = require('node:assert/strict');
const { fs, emulatorNoAr } = require('./_emulador');

const ag = (prof, extra = {}) => ({ donoVe: true, clienteWhatsapp: '5521999990000', clienteNome: 'Maria', profissionalId: prof, dataChave: '2026-12-01', horario: '10:00', duracaoMin: 30, valorTotal: 40, status: 'confirmado', servicos: [{ nome: 'Corte', preco: 40 }], ...extra });
const PERM = (verTodos, gerirNegocio) => ({ verTodos, gerirNegocio });
const HT = { segunda: { ativo: true, inicio: '09:00', fim: '18:00', pausaInicio: '12:00', pausaFim: '13:00' } };

async function preparar() {
  await fs.limpar();
  await fs.semear('usuarios/chefe', { barbeariaId: 'neg-a', role: 'owner', permissoes: PERM(true, true) });
  await fs.semear('usuarios/antigo', { barbeariaId: 'neg-a', role: 'owner' });
  await fs.semear('usuarios/socio1', { barbeariaId: 'neg-a', role: 'profissional', profissionalId: 'prof-1', permissoes: PERM(false, true) });
  await fs.semear('usuarios/socio2', { barbeariaId: 'neg-a', role: 'profissional', profissionalId: 'prof-2', permissoes: PERM(false, true) });
  await fs.semear('usuarios/func', { barbeariaId: 'neg-a', role: 'profissional', profissionalId: 'prof-3', permissoes: PERM(false, false) });
  await fs.semear('usuarios/semprof', { barbeariaId: 'neg-a', role: 'profissional', permissoes: PERM(false, false) });
  await fs.semear('usuarios/semperm', { barbeariaId: 'neg-a', role: 'profissional', profissionalId: 'prof-1' });   // formato novo mas SEM permissoes: nada de acesso amplo
  await fs.semear('usuarios/dono-b', { barbeariaId: 'neg-b', role: 'owner' });
  await fs.semear('admins77/super1', { role: 'super_admin' });

  for (const n of ['a', 'b']) {
    await fs.semear(`barbearias/neg-${n}`, { nome: 'Barbearia ' + n, endereco: 'Rua ' + n, telefone: '5521999990000', status: 'trial', plano: 'trial', horarioFuncionamento: { segunda: { ativo: true, inicio: '09:00', fim: '19:00' } } });
    await fs.semear(`barbearias/neg-${n}/servicos/s1`, { nome: 'Corte', preco: 40, duracaoMin: 30 });
    await fs.semear(`barbearias/neg-${n}/clientes/5521999990000`, { nome: 'Maria', whatsapp: '5521999990000', totalAgendamentos: 9, donoVe: true });
    await fs.semear(`barbearias/neg-${n}/dispositivos/d1`, { token: 'tok-' + n });
  }
  for (const [id, nome] of [['prof-1', 'Lipão'], ['prof-2', 'José'], ['prof-3', 'Carlos']]) {
    await fs.semear(`barbearias/neg-a/profissionais/${id}`, { nome, comissao: 40, horarioTrabalho: HT });
    await fs.semear(`barbearias/neg-a/agendamentos/ag-${id}`, ag(id));
  }
  await fs.semear('barbearias/neg-a/agendamentos/ag-sem-prof', ag('', { clienteNome: 'Sem profissional' }));
  await fs.semear('barbearias/neg-b/profissionais/prof-b1', { nome: 'B', comissao: 50 });
  await fs.semear('barbearias/neg-b/agendamentos/ag-b1', ag('prof-b1'));
}

let ligado = false;
test.before(async () => {
  ligado = await emulatorNoAr();
  if (!ligado) throw new Error('Emulador do Firestore não está no ar. Rode: npm run test:regras');
});
test.beforeEach(async () => { if (ligado) await preparar(); });

const A = 'barbearias/neg-a';

test('dono antigo (sem "permissoes") e chefe do formato novo continuam com acesso total', async () => {
  for (const u of ['antigo', 'chefe']) {
    for (const p of [A, `${A}/servicos/s1`, `${A}/profissionais/prof-2`, `${A}/agendamentos/ag-prof-2`, `${A}/clientes/5521999990000`]) assert.ok((await fs.ler(p, u)).permitido, `${u} lê ${p}`);
    assert.ok((await fs.listar(`${A}/profissionais`, u)).permitido, u + ' lista profissionais');
    assert.ok((await fs.consultar(A, 'agendamentos', [['donoVe', true]], u)).permitido, u + ' lista agendamentos (filtrando donoVe)');
    assert.ok((await fs.listar(`${A}/agendamentos`, u)).negado, u + ' NÃO lista sem filtrar donoVe (traria os do sócio)');
    assert.ok((await fs.consultar(A, 'agendamentos', [['donoVe', true], ['profissionalId', 'prof-2']], u)).permitido);
    assert.ok((await fs.atualizar(A, { nome: 'Novo' }, u)).permitido, u + ' edita o negócio');
    assert.ok((await fs.criar(`${A}/profissionais`, 'prof-9-' + u, { nome: 'Novo', comissao: 30 }, u)).permitido, u + ' cria profissional');
    assert.ok((await fs.atualizar(`${A}/agendamentos/ag-prof-3`, { status: 'concluido' }, u)).permitido, u + ' mexe na agenda de qualquer um');
    assert.ok((await fs.atualizar(`${A}/profissionais/prof-3`, { comissao: 55 }, u)).permitido, u + ' altera comissão');
  }
});

test('sócio vê SÓ os agendamentos do próprio profissional (consulta filtrada) e nada dos outros', async () => {
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-1`, 'socio1')).permitido, 'o próprio');
  assert.ok((await fs.consultar(A, 'agendamentos', [['profissionalId', 'prof-1']], 'socio1')).permitido, 'consulta filtrada pelo próprio profissional');
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-2`, 'socio1')).negado, 'do outro sócio');
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-3`, 'socio1')).negado, 'do terceiro');
  assert.ok((await fs.consultar(A, 'agendamentos', [['profissionalId', 'prof-2']], 'socio1')).negado, 'consulta filtrando pelo OUTRO profissional');
  assert.ok((await fs.consultar(A, 'agendamentos', [], 'socio1')).negado, 'consulta sem filtro (traria os dos outros)');
  assert.ok((await fs.consultar(A, 'agendamentos', [['status', 'confirmado']], 'socio1')).negado, 'filtrar por outro campo não adianta');
  assert.ok((await fs.listar(`${A}/agendamentos`, 'socio1')).negado, 'listar tudo');
  assert.ok((await fs.ler(`${A}/agendamentos/ag-sem-prof`, 'socio1')).negado, 'agendamento sem profissional não é de ninguém');
  // simetria: o outro sócio também só vê o dele
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-2`, 'socio2')).permitido);
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-1`, 'socio2')).negado);
});

test('sócio cria e mexe só em agendamentos do próprio profissional; não passa para o outro nem apaga o dos outros', async () => {
  assert.ok((await fs.criar(`${A}/agendamentos`, 'novo1', ag('prof-1'), 'socio1')).permitido);
  assert.ok((await fs.criar(`${A}/agendamentos`, 'novo2', ag('prof-2'), 'socio1')).negado, 'criar para o outro profissional');
  assert.ok((await fs.criar(`${A}/agendamentos`, 'novo3', ag('prof-1', { status: 'lixo' }), 'socio1')).negado, 'forma inválida continua barrada');
  assert.ok((await fs.atualizar(`${A}/agendamentos/ag-prof-1`, { status: 'concluido' }, 'socio1')).permitido);
  assert.ok((await fs.atualizar(`${A}/agendamentos/ag-prof-1`, { profissionalId: 'prof-2' }, 'socio1')).negado, 'empurrar o atendimento para o outro');
  assert.ok((await fs.atualizar(`${A}/agendamentos/ag-prof-2`, { status: 'cancelado' }, 'socio1')).negado, 'mexer no do outro');
  assert.ok((await fs.apagar(`${A}/agendamentos/ag-prof-2`, 'socio1')).negado);
  assert.ok((await fs.apagar(`${A}/agendamentos/ag-prof-1`, 'socio1')).permitido);
});

test('sócio NÃO vê clientes do negócio (lista própria vem dos próprios agendamentos), nem aparelhos de notificação', async () => {
  assert.ok((await fs.ler(`${A}/clientes/5521999990000`, 'socio1')).negado);
  assert.ok((await fs.listar(`${A}/clientes`, 'socio1')).negado);
  assert.ok((await fs.atualizar(`${A}/clientes/5521999990000`, { nome: 'Alterado' }, 'socio1')).negado);
  assert.ok((await fs.criar(`${A}/clientes`, '5521911112222', { nome: 'X' }, 'socio1')).negado);
  assert.ok((await fs.apagar(`${A}/clientes/5521999990000`, 'socio1')).negado);
  assert.ok((await fs.ler(`${A}/dispositivos/d1`, 'socio1')).negado);
  assert.ok((await fs.criar(`${A}/dispositivos`, 'd9', { token: 'x' }, 'socio1')).negado);
});

test('profissionais: comissão e horário do outro são privados; cada um edita só o PRÓPRIO horário', async () => {
  assert.ok((await fs.ler(`${A}/profissionais/prof-1`, 'socio1')).permitido, 'o próprio cadastro');
  assert.ok((await fs.ler(`${A}/profissionais/prof-2`, 'socio1')).negado, 'o cadastro (com comissão) do outro');
  assert.ok((await fs.listar(`${A}/profissionais`, 'socio1')).negado, 'a lista inteira');
  assert.ok((await fs.atualizar(`${A}/profissionais/prof-1`, { horarioTrabalho: { segunda: { ativo: true, inicio: '08:00', fim: '17:00', pausaInicio: '13:00', pausaFim: '14:00' } } }, 'socio1')).permitido, 'o próprio almoço');
  assert.ok((await fs.atualizar(`${A}/profissionais/prof-1`, { bloqueios: { '2026-12-25': ['10:00'] } }, 'socio1')).permitido);
  assert.ok((await fs.atualizar(`${A}/profissionais/prof-1`, { comissao: 90 }, 'socio1')).negado, 'a própria comissão não se muda');
  assert.ok((await fs.atualizar(`${A}/profissionais/prof-1`, { ativo: false }, 'socio1')).negado);
  assert.ok((await fs.atualizar(`${A}/profissionais/prof-2`, { horarioTrabalho: HT }, 'socio1')).negado, 'o horário do outro');
  assert.ok((await fs.criar(`${A}/profissionais`, 'prof-9', { nome: 'Intruso' }, 'socio1')).negado, 'criar profissional');
  assert.ok((await fs.apagar(`${A}/profissionais/prof-2`, 'socio1')).negado, 'apagar o outro');
  assert.ok((await fs.apagar(`${A}/profissionais/prof-1`, 'socio1')).negado, 'nem o próprio');
});

test('"gerir o negócio": sócio edita dados do negócio e serviços; funcionário não; ninguém muda status/plano', async () => {
  assert.ok((await fs.ler(A, 'socio1')).permitido && (await fs.ler(A, 'func')).permitido, 'todos leem os dados do negócio');
  assert.ok((await fs.atualizar(A, { nome: 'Nome novo', telefone: '5521988887777' }, 'socio1')).permitido);
  assert.ok((await fs.atualizar(A, { status: 'ativa' }, 'socio1')).negado);
  assert.ok((await fs.atualizar(A, { plano: 'mensal' }, 'socio1')).negado);
  assert.ok((await fs.atualizar(A, { nome: 'Hack' }, 'func')).negado, 'funcionário não edita o negócio');
  assert.ok((await fs.criar(`${A}/servicos`, 's2', { nome: 'Barba', preco: 30 }, 'socio1')).permitido);
  assert.ok((await fs.atualizar(`${A}/servicos/s1`, { preco: 50 }, 'socio2')).permitido);
  assert.ok((await fs.apagar(`${A}/servicos/s1`, 'socio1')).permitido);
  assert.ok((await fs.listar(`${A}/servicos`, 'func')).permitido, 'funcionário lê o catálogo');
  assert.ok((await fs.criar(`${A}/servicos`, 's3', { nome: 'X' }, 'func')).negado);
  assert.ok((await fs.atualizar(`${A}/servicos/s1`, { preco: 1 }, 'func')).negado);
});

test('funcionário (sem gerir nem ver tudo): só a própria agenda e o próprio horário', async () => {
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-3`, 'func')).permitido);
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-1`, 'func')).negado);
  assert.ok((await fs.consultar(A, 'agendamentos', [['profissionalId', 'prof-3']], 'func')).permitido);
  assert.ok((await fs.consultar(A, 'agendamentos', [], 'func')).negado);
  assert.ok((await fs.atualizar(`${A}/profissionais/prof-3`, { horarioTrabalho: HT }, 'func')).permitido);
  assert.ok((await fs.ler(`${A}/profissionais/prof-1`, 'func')).negado);
  assert.ok((await fs.ler(`${A}/clientes/5521999990000`, 'func')).negado);
  assert.ok((await fs.criar(`${A}/agendamentos`, 'f1', ag('prof-3'), 'func')).permitido);
  assert.ok((await fs.criar(`${A}/agendamentos`, 'f2', ag('prof-1'), 'func')).negado);
});

test('sem profissionalId ou sem "permissoes" no formato novo: nenhum acesso amplo por engano', async () => {
  for (const u of ['semprof', 'semperm']) {
    assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-2`, u)).negado, u + ' não lê agenda alheia');
    assert.ok((await fs.listar(`${A}/agendamentos`, u)).negado);
    assert.ok((await fs.ler(`${A}/clientes/5521999990000`, u)).negado);
    assert.ok((await fs.listar(`${A}/profissionais`, u)).negado);
    assert.ok((await fs.atualizar(A, { nome: 'x' }, u)).negado);
  }
  assert.ok((await fs.ler(`${A}/agendamentos/ag-sem-prof`, 'semprof')).negado, 'agendamento sem profissional não pode ser "do" usuário sem profissional');
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-1`, 'semperm')).permitido, 'mas semperm TEM profissionalId: lê o próprio');
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-2`, 'semperm')).negado);
});

test('nada vaza entre negócios, nem para sócios e funcionários', async () => {
  for (const u of ['socio1', 'func', 'chefe', 'antigo']) {
    assert.ok((await fs.ler('barbearias/neg-b', u)).negado, u + ' → negócio B');
    assert.ok((await fs.ler('barbearias/neg-b/agendamentos/ag-b1', u)).negado);
    assert.ok((await fs.consultar('barbearias/neg-b', 'agendamentos', [['profissionalId', 'prof-b1']], u)).negado);
    assert.ok((await fs.ler('barbearias/neg-b/profissionais/prof-b1', u)).negado);
    assert.ok((await fs.criar('barbearias/neg-b/agendamentos', 'x', ag('prof-b1'), u)).negado);
  }
  // um profissional do negócio B com o MESMO id de profissional que existe no A não ganha acesso ao A
  await fs.semear('usuarios/impostor', { barbeariaId: 'neg-b', role: 'profissional', profissionalId: 'prof-1', permissoes: PERM(false, false) });
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-1`, 'impostor')).negado, 'mesmo profissionalId, outro negócio');
});

test('ninguém muda os próprios papéis pelo navegador (só o servidor); vínculo continua legível só pelo dono dele', async () => {
  assert.ok((await fs.substituir('usuarios/socio1', { barbeariaId: 'neg-a', role: 'owner', permissoes: PERM(true, true) }, 'socio1')).negado, 'subir a si mesmo para chefe');
  assert.ok((await fs.atualizar('usuarios/socio1', { permissoes: PERM(true, true) }, 'socio1')).negado);
  assert.ok((await fs.atualizar('usuarios/func', { permissoes: PERM(true, true) }, 'chefe')).negado, 'nem o chefe pelo navegador (vai pela API de equipe)');
  assert.ok((await fs.substituir('usuarios/novo', { barbeariaId: 'neg-a', role: 'profissional' }, 'chefe')).negado, 'nem criar usuário');
  assert.ok((await fs.ler('usuarios/socio1', 'socio1')).permitido, 'lê o próprio vínculo (o painel precisa)');
  assert.ok((await fs.ler('usuarios/socio2', 'socio1')).negado, 'não lê o vínculo do outro');
  assert.ok((await fs.ler('barbearias/neg-a/convites/qualquer', 'chefe')).negado, 'convites só o servidor');
  assert.ok((await fs.criar(`${A}/convites`, 'tok', { email: 'a@b.com' }, 'chefe')).negado);
});

test('super-admin da 77 IS segue vendo tudo', async () => {
  assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-2`, 'super1')).permitido);
  assert.ok((await fs.listar(`${A}/agendamentos`, 'super1')).permitido);
  assert.ok((await fs.ler(`${A}/profissionais/prof-1`, 'super1')).permitido);
  assert.ok((await fs.atualizar(A, { status: 'suspensa' }, 'super1')).permitido);
});

test('aparelhos de notificação: cada pessoa gerencia só os PRÓPRIOS (nem o dono lê os dos outros)', async () => {
  const D = 'barbearias/neg-a/dispositivos';
  // sócio cria, lê, lista, atualiza e apaga o próprio aparelho
  assert.ok((await fs.criar(D, 'd-s1', { token: 't', uid: 'socio1' }, 'socio1')).permitido);
  assert.ok((await fs.ler(`${D}/d-s1`, 'socio1')).permitido);
  assert.ok((await fs.atualizar(`${D}/d-s1`, { token: 't2' }, 'socio1')).permitido);
  assert.ok((await fs.consultar('barbearias/neg-a', 'dispositivos', [['uid', 'socio1']], 'socio1')).permitido, 'lista só os próprios');
  assert.ok((await fs.consultar('barbearias/neg-a', 'dispositivos', [['uid', 'socio2']], 'socio1')).negado, 'lista filtrando pelo uid de outro');
  // não mexe em aparelho de outro nem se passa por outro
  assert.ok((await fs.criar(D, 'd-falso', { token: 't', uid: 'socio2' }, 'socio1')).negado, 'criar aparelho em nome de outro');
  assert.ok((await fs.criar(D, 'd-sem-uid', { token: 't' }, 'socio1')).negado);
  assert.ok((await fs.ler(`${D}/d1`, 'socio1')).negado, 'aparelho antigo (sem uid)');
  assert.ok((await fs.listar(D, 'socio1')).negado, 'lista sem filtro');
  await fs.semear(`${D}/d-s2`, { token: 'x', uid: 'socio2' });
  assert.ok((await fs.ler(`${D}/d-s2`, 'socio1')).negado);
  assert.ok((await fs.atualizar(`${D}/d-s2`, { token: 'roubado' }, 'socio1')).negado);
  assert.ok((await fs.apagar(`${D}/d-s2`, 'socio1')).negado);
  assert.ok((await fs.atualizar(`${D}/d-s1`, { uid: 'socio2' }, 'socio1')).negado, 'não passa o aparelho para outro');
  assert.ok((await fs.apagar(`${D}/d-s1`, 'socio1')).permitido);
  // de outro negócio: nada
  assert.ok((await fs.criar(D, 'd-b', { token: 't', uid: 'dono-b' }, 'dono-b')).negado);
  // o dono também só mexe nos PRÓPRIOS aparelhos (não lê os do sócio)
  assert.ok((await fs.ler(`${D}/d-s2`, 'chefe')).negado);
  assert.ok((await fs.apagar(`${D}/d-s2`, 'chefe')).negado);
  assert.ok((await fs.criar(D, 'd-chefe', { token: 't', uid: 'chefe' }, 'chefe')).permitido);
  assert.ok((await fs.consultar('barbearias/neg-a', 'dispositivos', [['uid', 'chefe']], 'chefe')).permitido);
  assert.ok((await fs.listar(D, 'chefe')).negado, 'dono lista sem filtro: negado');
});

test('config privada (Pix e sinal): a própria pessoa lê; o dono lê exceto a de SÓCIO; ninguém grava pelo navegador', async () => {
  const P = 'barbearias/neg-a/profissionais';
  await fs.semear(`${P}/prof-2`, { nome: 'José', comissao: 40, horarioTrabalho: HT, socio: true });      // prof-2 é de um sócio
  await fs.semear(`${P}/prof-1/privado/config`, { pix: { chavePix: 'a@x.com' } });
  await fs.semear(`${P}/prof-2/privado/config`, { pix: { chavePix: 'socio@x.com' }, sinal: { modo: 'ativo' } });
  await fs.semear(`${P}/prof-3/privado/config`, { pix: { chavePix: 'func@x.com' } });
  await fs.semear('usuarios/socio-puro', { barbeariaId: 'neg-a', role: 'profissional', papel: 'socio', profissionalId: 'prof-2', permissoes: PERM(false, false) });
  await fs.semear('usuarios/func-puro', { barbeariaId: 'neg-a', role: 'profissional', papel: 'funcionario', profissionalId: 'prof-3', permissoes: PERM(false, false) });
  // o dono (conta antiga / chefe) lê a config dos que NÃO são de sócio e NÃO lê a do sócio
  for (const u of ['chefe', 'antigo']) {
    assert.ok((await fs.ler(`${P}/prof-1/privado/config`, u)).permitido, u + ' lê a do profissional comum');
    assert.ok((await fs.ler(`${P}/prof-3/privado/config`, u)).permitido, u + ' lê a do funcionário');
    assert.ok((await fs.ler(`${P}/prof-2/privado/config`, u)).negado, u + ' NÃO lê a do sócio');
  }
  // o sócio lê a própria e não a dos outros
  assert.ok((await fs.ler(`${P}/prof-2/privado/config`, 'socio-puro')).permitido);
  assert.ok((await fs.ler(`${P}/prof-1/privado/config`, 'socio-puro')).negado);
  assert.ok((await fs.ler(`${P}/prof-3/privado/config`, 'socio-puro')).negado);
  // o funcionário não lê a dos outros
  assert.ok((await fs.ler(`${P}/prof-1/privado/config`, 'func-puro')).negado);
  assert.ok((await fs.ler(`${P}/prof-2/privado/config`, 'func-puro')).negado);
  // gente de fora, visitante e outro negócio: nada
  for (const u of [null, 'dono-b']) assert.ok((await fs.ler(`${P}/prof-1/privado/config`, u)).negado, String(u));
  // ninguém grava pelo navegador (nem o dono, nem o próprio sócio)
  for (const [u, p] of [['chefe', 'prof-1'], ['socio-puro', 'prof-2'], ['chefe', 'prof-2']]) {
    assert.ok((await fs.substituir(`${P}/${p}/privado/config`, { pix: { chavePix: 'hack@x.com' } }, u)).negado, `${u} grava em ${p}`);
  }
  assert.ok((await fs.apagar(`${P}/prof-2/privado/config`, 'chefe')).negado);
  // super-admin lê
  assert.ok((await fs.ler(`${P}/prof-2/privado/config`, 'super1')).permitido);
});

test('papéis: sócio edita o próprio horário; FUNCIONÁRIO não edita o próprio cadastro', async () => {
  const P = 'barbearias/neg-a/profissionais';
  await fs.semear('usuarios/socio-puro', { barbeariaId: 'neg-a', role: 'profissional', papel: 'socio', profissionalId: 'prof-1', permissoes: PERM(false, false) });
  await fs.semear('usuarios/func-puro', { barbeariaId: 'neg-a', role: 'profissional', papel: 'funcionario', profissionalId: 'prof-3', permissoes: PERM(false, false) });
  assert.ok((await fs.atualizar(`${P}/prof-1`, { horarioTrabalho: HT }, 'socio-puro')).permitido, 'sócio: o próprio horário');
  assert.ok((await fs.atualizar(`${P}/prof-3`, { horarioTrabalho: HT }, 'func-puro')).negado, 'funcionário: não edita o próprio horário');
  assert.ok((await fs.atualizar(`${P}/prof-3`, { nome: 'Outro nome' }, 'func-puro')).negado);
  assert.ok((await fs.ler(`${P}/prof-3`, 'func-puro')).permitido, 'mas lê o próprio cadastro');
  // conta antiga SEM papel continua como era (edita o próprio horário): nada quebra para quem já existe
  assert.ok((await fs.atualizar(`${P}/prof-2`, { horarioTrabalho: HT }, 'socio2')).permitido);
  // o dono continua editando qualquer um
  assert.ok((await fs.atualizar(`${P}/prof-3`, { horarioTrabalho: HT }, 'chefe')).permitido);
});

test('PRIVACIDADE DO SÓCIO: o dono não lê, lista, cria, muda nem apaga agenda e clientes de sócio; o sócio vê e cuida dos dele', async () => {
  const P = 'barbearias/neg-a/profissionais';
  await fs.semear(`${P}/prof-2`, { nome: 'José', comissao: 0, horarioTrabalho: HT, socio: true });          // prof-2 é de um sócio (socio2 atende como prof-2)
  await fs.semear('barbearias/neg-a/agendamentos/ag-socio', ag('prof-2', { donoVe: false, clienteNome: 'Cliente do Sócio' }));
  await fs.semear('barbearias/neg-a/clientes/prof-2__5521955550000', { nome: 'Cliente do Sócio', whatsapp: '5521955550000', donoVe: false, totalAgendamentos: 3 });
  for (const u of ['chefe', 'antigo']) {
    // lê o que é do lado dele…
    assert.ok((await fs.ler(`${A}/agendamentos/ag-prof-1`, u)).permitido, u + ' lê agendamento do lado do dono');
    assert.ok((await fs.consultar(A, 'agendamentos', [['donoVe', true]], u)).permitido);
    assert.ok((await fs.consultar(A, 'clientes', [['donoVe', true]], u)).permitido);
    // …e NADA do sócio
    assert.ok((await fs.ler(`${A}/agendamentos/ag-socio`, u)).negado, u + ' não lê o agendamento do sócio');
    assert.ok((await fs.consultar(A, 'agendamentos', [['donoVe', false]], u)).negado, u + ' não consulta o lado do sócio');
    assert.ok((await fs.consultar(A, 'agendamentos', [['profissionalId', 'prof-2']], u)).negado, u + ' não consulta pelo profissional do sócio sem o filtro');
    assert.ok((await fs.consultar(A, 'clientes', [['donoVe', false]], u)).negado);
    assert.ok((await fs.listar(`${A}/clientes`, u)).negado, u + ' não lista clientes sem filtro (traria os do sócio)');
    assert.ok((await fs.ler(`${A}/clientes/prof-2__5521955550000`, u)).negado, u + ' não lê a ficha de cliente do sócio');
    assert.ok((await fs.atualizar(`${A}/agendamentos/ag-socio`, { status: 'cancelado' }, u)).negado, u + ' não mexe no agendamento do sócio');
    assert.ok((await fs.apagar(`${A}/agendamentos/ag-socio`, u)).negado);
    assert.ok((await fs.atualizar(`${A}/clientes/prof-2__5521955550000`, { nome: 'X' }, u)).negado);
    assert.ok((await fs.apagar(`${A}/clientes/prof-2__5521955550000`, u)).negado);
    // não cria agendamento na agenda do sócio, nem com a marca falsa
    assert.ok((await fs.criar(`${A}/agendamentos`, 'invasao1-' + u, ag('prof-2', { donoVe: false }), u)).negado, u + ' não cria na agenda do sócio');
    assert.ok((await fs.criar(`${A}/agendamentos`, 'invasao2-' + u, ag('prof-2', { donoVe: true }), u)).negado);
    // no lado dele a marca precisa estar certa e não pode ser trocada para se esconder/expor
    assert.ok((await fs.criar(`${A}/agendamentos`, 'ok-' + u, ag('prof-1'), u)).permitido);
    assert.ok((await fs.criar(`${A}/agendamentos`, 'marca-errada-' + u, ag('prof-1', { donoVe: false }), u)).negado, 'marca incoerente com o profissional');
    assert.ok((await fs.atualizar(`${A}/agendamentos/ag-prof-1`, { donoVe: false }, u)).negado, 'não esconde o próprio agendamento trocando a marca');
    assert.ok((await fs.atualizar(`${A}/agendamentos/ag-prof-1`, { status: 'concluido' }, u)).permitido);
    // ficha de cliente do dono precisa nascer com donoVe true
    assert.ok((await fs.criar(`${A}/clientes`, '5521944440000-' + u, { nome: 'Novo', donoVe: true }, u)).permitido);
    assert.ok((await fs.criar(`${A}/clientes`, '5521944441111-' + u, { nome: 'Novo', donoVe: false }, u)).negado, 'não cria ficha do "lado do sócio"');
    assert.ok((await fs.criar(`${A}/clientes`, '5521944442222-' + u, { nome: 'Novo' }, u)).negado, 'ficha sem a marca não vale');
  }
  // o sócio (socio2 atende como prof-2) vê e cuida dos dele
  assert.ok((await fs.ler(`${A}/agendamentos/ag-socio`, 'socio2')).permitido);
  assert.ok((await fs.consultar(A, 'agendamentos', [['profissionalId', 'prof-2']], 'socio2')).permitido);
  assert.ok((await fs.atualizar(`${A}/agendamentos/ag-socio`, { status: 'concluido' }, 'socio2')).permitido);
  assert.ok((await fs.atualizar(`${A}/agendamentos/ag-socio`, { donoVe: true }, 'socio2')).negado, 'o sócio não expõe o próprio agendamento ao dono trocando a marca');
  assert.ok((await fs.criar(`${A}/agendamentos`, 'novo-socio', ag('prof-2', { donoVe: false }), 'socio2')).permitido);
  assert.ok((await fs.criar(`${A}/agendamentos`, 'novo-socio-errado', ag('prof-2', { donoVe: true }), 'socio2')).negado, 'marca incoerente');
  // o outro lado (funcionário/sócio de outro profissional) continua sem ver o do sócio
  assert.ok((await fs.ler(`${A}/agendamentos/ag-socio`, 'func')).negado);
  assert.ok((await fs.ler(`${A}/agendamentos/ag-socio`, 'socio1')).negado);
  // super-admin vê tudo
  assert.ok((await fs.ler(`${A}/agendamentos/ag-socio`, 'super1')).permitido);
  assert.ok((await fs.ler(`${A}/clientes/prof-2__5521955550000`, 'super1')).permitido);
});
