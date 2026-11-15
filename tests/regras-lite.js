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

  // configuração PRIVADA da pessoa (Pix e sinal): a própria pessoa lê; o dono lê, exceto a de sócio; ninguém grava pelo navegador
  if (sub === 'profissionais' && seg[4] === 'privado') {
    if (c.op !== 'get') return 'privado: só leitura de um documento (gravação é só do servidor)';
    const alvo = (await fake.doc(`barbearias/${slug}/profissionais/${id}`).get()).data() || {};
    return (meu === id || (admin && !alvo.socio)) ? null : 'privado: só a própria pessoa (o dono não lê a de sócio)';
  }
  switch (sub) {
    case 'servicos':
      if (c.op === 'get' || ehLista) return null;
      return P.gerirNegocio ? null : 'serviços: escrita só de quem gerencia o negócio';
    case 'profissionais':
      if (ehLista) return P.verTodos ? null : 'profissionais: lista só de quem vê tudo';
      if (c.op === 'get') return (P.verTodos || meu === id) ? null : 'profissionais: só o próprio';
      if (c.op === 'update') return (admin || (meu && meu === id && u.papel !== 'funcionario' && chaves.every((k) => PERFIL_CAMPOS.includes(k)))) ? null : 'profissionais: update só admin ou o próprio e só ' + PERFIL_CAMPOS.join('/') + ' (tentou: ' + chaves.join(', ') + ')';
      return admin ? null : 'profissionais: criar/apagar só admin';
    case 'agendamentos': {
      const alvoSocio = async (profId) => ((await fake.doc(`barbearias/${slug}/profissionais/${profId}`).get()).data() || {}).socio === true;
      if (ehLista) {
        if (P.verTodos) return (c.filtros || []).some((f) => f.campo === 'donoVe' && f.op === '==' && f.valor === true) ? null : 'agendamentos: o dono precisa filtrar donoVe == true (privacidade do sócio)';
        return (meu && (c.filtros || []).some((f) => f.campo === 'profissionalId' && f.op === '==' && f.valor === meu)) ? null : 'agendamentos: consulta sem filtro do próprio profissional';
      }
      if (P.verTodos) {
        const a = await doc();
        if (c.op === 'get' || c.op === 'delete') return a && a.donoVe === true ? null : 'agendamentos: o dono não lê/apaga agendamento de sócio';
        if (c.op === 'set') return (!(await alvoSocio(c.data.profissionalId)) && c.data.donoVe === true) ? null : 'agendamentos: o dono não cria na agenda de sócio (e donoVe tem de ser true)';
        if (c.op === 'update') return (a && a.donoVe === true && (c.data.donoVe === undefined || c.data.donoVe === true) && (c.data.profissionalId === undefined || c.data.profissionalId === a.profissionalId)) ? null : 'agendamentos: update do dono só no que é dele, sem trocar a marca';
        return 'agendamentos: ' + c.op;
      }
      if (!meu) return 'agendamentos: sem profissional';
      const atual = await doc();
      if (c.op === 'get' || c.op === 'delete') return (atual && atual.profissionalId === meu) ? null : 'agendamentos: não é do seu profissional';
      if (c.op === 'set') return (c.data && c.data.profissionalId === meu && c.data.donoVe === !(await alvoSocio(meu))) ? null : 'agendamentos: só no seu profissional e com a marca donoVe coerente';
      if (c.op === 'update') return (atual && atual.profissionalId === meu && (c.data.profissionalId === undefined || c.data.profissionalId === meu)) ? null : 'agendamentos: update só no seu e sem trocar de profissional';
      return 'agendamentos: ' + c.op;
    }
    case 'clientes': {
      if (!P.verTodos) return 'clientes: só o dono (as fichas de sócio ele não lê)';
      if (ehLista) return (c.filtros || []).some((f) => f.campo === 'donoVe' && f.op === '==' && f.valor === true) ? null : 'clientes: o dono precisa filtrar donoVe == true';
      const atualC = await doc();
      if (c.op === 'get' || c.op === 'delete') return atualC && atualC.donoVe === true ? null : 'clientes: ficha de sócio não é do dono';
      if (c.op === 'set') return c.data && c.data.donoVe === true ? null : 'clientes: o dono grava só ficha donoVe true';
      if (c.op === 'update') return atualC && atualC.donoVe === true && (c.data.donoVe === undefined || c.data.donoVe === true) ? null : 'clientes: update só em ficha do dono';
      return 'clientes: ' + c.op;
    }
    case 'dispositivos': {
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
