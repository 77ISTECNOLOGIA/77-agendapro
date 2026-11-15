// "Regras de segurança" SIMPLIFICADAS só para o ambiente de teste de telas (tests/dev-local.js): espelha o que importa de
// firestore.rules para pegar, no navegador, telas que pedem ou gravam algo que o banco real RECUSARIA (permission-denied).
// NÃO substitui o teste de verdade (npm run test:regras, que roda as regras reais no emulador) — é uma checagem cruzada
// do que o JAVASCRIPT DAS TELAS faz. Se mudar firestore.rules, atualize aqui também.

const PERFIL_CAMPOS = ['horarioTrabalho', 'bloqueios', 'nome', 'especialidade'];
const NEGOCIO_CAMPOS = ['nome', 'endereco', 'telefone', 'horarioFuncionamento'];

const permissoesDe = (u) => (u.permissoes && typeof u.permissoes === 'object')
  ? { verTodos: u.permissoes.verTodos === true, gerirNegocio: u.permissoes.gerirNegocio === true }
  : ((u.role === undefined || u.role === 'owner') ? { verTodos: true, gerirNegocio: true } : { verTodos: false, gerirNegocio: false });

/** Devolve null se o banco real permitiria, ou o motivo da recusa. */
async function permitir(fake, uid, c) {
  if (!uid) return 'sem login';
  const admin77 = (await fake.doc('admins77/' + uid).get()).data();
  if (admin77 && admin77.role === 'super_admin') return null;
  const u = (await fake.doc('usuarios/' + uid).get()).data();
  if (!u) return 'login sem usuarios/{uid}';

  const seg = c.path.split('/');
  const ehLista = c.op === 'list';
  const chaves = Object.keys(c.data || {});
  const doc = async () => (await fake.doc(c.path).get()).data();

  if (seg[0] === 'usuarios') return (c.op === 'get' && seg[1] === uid) ? null : 'usuarios: só leitura do próprio documento';
  if (seg[0] !== 'barbearias') return 'coleção sem regra pública: ' + seg[0];

  const slug = seg[1];
  if (u.barbeariaId !== slug) return 'não é membro deste negócio';
  const P = permissoesDe(u);
  const admin = P.verTodos && P.gerirNegocio;
  const meu = u.profissionalId || '';

  if (seg.length === 2) {
    if (c.op === 'get') return null;
    if (c.op === 'update') return (P.gerirNegocio && chaves.every((k) => NEGOCIO_CAMPOS.includes(k))) ? null : 'negócio: só gerente e só ' + NEGOCIO_CAMPOS.join('/') + ' (tentou: ' + chaves.join(', ') + ')';
    return 'negócio: ' + c.op + ' só pelo servidor';
  }

  const sub = seg[2], id = seg[3];
  switch (sub) {
    case 'servicos':
      if (c.op === 'get' || ehLista) return null;
      return P.gerirNegocio ? null : 'serviços: escrita só de quem gerencia o negócio';
    case 'profissionais':
      if (ehLista) return P.verTodos ? null : 'profissionais: lista só de quem vê tudo';
      if (c.op === 'get') return (P.verTodos || meu === id) ? null : 'profissionais: só o próprio';
      if (c.op === 'update') return (admin || (meu && meu === id && chaves.every((k) => PERFIL_CAMPOS.includes(k)))) ? null : 'profissionais: update só admin ou o próprio e só ' + PERFIL_CAMPOS.join('/') + ' (tentou: ' + chaves.join(', ') + ')';
      return admin ? null : 'profissionais: criar/apagar só admin';
    case 'agendamentos': {
      if (ehLista) return (P.verTodos || (meu && (c.filtros || []).some((f) => f.campo === 'profissionalId' && f.op === '==' && f.valor === meu))) ? null : 'agendamentos: consulta sem filtro do próprio profissional';
      if (P.verTodos) return null;
      if (!meu) return 'agendamentos: sem profissional';
      const atual = await doc();
      if (c.op === 'get' || c.op === 'delete') return (atual && atual.profissionalId === meu) ? null : 'agendamentos: não é do seu profissional';
      if (c.op === 'set') return (c.data && c.data.profissionalId === meu) ? null : 'agendamentos: só no seu profissional';
      if (c.op === 'update') return (atual && atual.profissionalId === meu && (c.data.profissionalId === undefined || c.data.profissionalId === meu)) ? null : 'agendamentos: update só no seu e sem trocar de profissional';
      return 'agendamentos: ' + c.op;
    }
    case 'clientes':
      return P.verTodos ? null : 'clientes: só quem vê tudo';
    case 'dispositivos': {
      if (P.verTodos) return null;
      if (ehLista) return (c.filtros || []).some((f) => f.campo === 'uid' && f.op === '==' && f.valor === uid) ? null : 'aparelhos: consulta sem filtro do próprio uid';
      const atual = await doc();
      if (c.op === 'get' || c.op === 'delete') return (atual && atual.uid === uid) ? null : 'aparelhos: não é seu';
      if (c.op === 'set') return (c.data && c.data.uid === uid) ? null : 'aparelhos: grave com o seu uid';
      if (c.op === 'update') return (atual && atual.uid === uid && (c.data.uid === undefined || c.data.uid === uid)) ? null : 'aparelhos: update só no seu';
      return 'aparelhos: ' + c.op;
    }
    default:
      return 'subcoleção sem regra pública: ' + sub;
  }
}

module.exports = { permitir };
