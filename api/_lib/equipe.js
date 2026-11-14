// ========================================
// 77 AGENDAPRO — Equipe: papéis, permissões e convites (funções puras + utilitários)
// ========================================
// usuarios/{uid} = { barbeariaId, role, profissionalId?, permissoes?: { verTodos, gerirNegocio } }
//   verTodos     → vê agenda, clientes e faturamento de TODOS os profissionais
//   gerirNegocio → edita dados do negócio, serviços, Pix/sinal e a equipe
// Conta antiga (role 'owner' sem "permissoes") tem as duas, como sempre foi. A MESMA regra está em firestore.rules
// (temPermissao): tests/regras/equipe.test.js confere o lado do banco e tests/equipe.test.js o lado do servidor.

const crypto = require('node:crypto');
const { ErroNegocio } = require('./http');

const VALIDADE_CONVITE_DIAS = 7;
const MAX_CONVITES_PENDENTES = 20;
const SEM_PERMISSAO = Object.freeze({ verTodos: false, gerirNegocio: false });

/** Permissões efetivas de um documento usuarios/{uid}. */
function permissoesDe(usuario) {
  if (!usuario || typeof usuario !== 'object') return { ...SEM_PERMISSAO };
  if (usuario.permissoes && typeof usuario.permissoes === 'object') {
    return { verTodos: usuario.permissoes.verTodos === true, gerirNegocio: usuario.permissoes.gerirNegocio === true };
  }
  const papel = usuario.role === undefined ? 'owner' : usuario.role;     // igual às regras: sem papel e sem permissões = dono antigo
  return papel === 'owner' ? { verTodos: true, gerirNegocio: true } : { ...SEM_PERMISSAO };
}

function permissoesValidas(p) {
  return !!p && typeof p === 'object' && typeof p.verTodos === 'boolean' && typeof p.gerirNegocio === 'boolean';
}

/** `a` não passa de `b` (nenhuma permissão que `b` não tenha). */
function dentroDe(a, b) { return (!a.verTodos || b.verTodos) && (!a.gerirNegocio || b.gerirNegocio); }

/**
 * Quem pode mexer em quem: só em usuários cujas permissões ATUAIS cabem nas de quem mexe. Assim um sócio que não vê
 * tudo não consegue rebaixar nem remover quem vê tudo, e ninguém ganha poder que não tem.
 */
function podeModificar(quemMexe, alvo) { return dentroDe(alvo, quemMexe); }

function gerarToken() { return crypto.randomBytes(24).toString('base64url'); }

const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida os dados de um convite. Lança ErroNegocio. `quemConvida`: permissões de quem está convidando. */
function validarConvite(b, quemConvida) {
  const nome = texto(b.nome, 80);
  if (nome.length < 2) throw new ErroNegocio(400, 'Digite o nome da pessoa.');
  const email = texto(b.email, 120).toLowerCase();
  if (!EMAIL.test(email)) throw new ErroNegocio(400, 'Digite um e-mail válido.');
  if (!permissoesValidas(b.permissoes)) throw new ErroNegocio(400, 'Permissões inválidas.');
  const permissoes = { verTodos: b.permissoes.verTodos, gerirNegocio: b.permissoes.gerirNegocio };
  if (!dentroDe(permissoes, quemConvida)) throw new ErroNegocio(403, 'Você não pode dar a outra pessoa um acesso que você mesmo não tem.');
  const profissionalId = b.profissionalId == null || b.profissionalId === '' ? '' : String(b.profissionalId);
  if (profissionalId && (profissionalId.length > 64 || profissionalId.includes('/'))) throw new ErroNegocio(400, 'Profissional inválido.');
  const novoProfissional = b.novoProfissional == null ? '' : texto(b.novoProfissional, 60);
  if (profissionalId && novoProfissional) throw new ErroNegocio(400, 'Escolha um profissional existente OU crie um novo, não os dois.');
  if (!profissionalId && !novoProfissional && !permissoes.verTodos) {
    throw new ErroNegocio(400, 'Sem vínculo com um profissional e sem permissão de ver tudo, a pessoa não enxergaria nada. Vincule a um profissional.');
  }
  return { nome, email, permissoes, profissionalId, novoProfissional };
}

module.exports = {
  VALIDADE_CONVITE_DIAS, MAX_CONVITES_PENDENTES, SEM_PERMISSAO,
  permissoesDe, permissoesValidas, dentroDe, podeModificar, gerarToken, validarConvite, texto
};
