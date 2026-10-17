// ========================================
// 77 AGENDAPRO — Auto-cadastro (multi-segmento)
// ========================================
// A conta (e-mail/senha) é criada no Firebase Authentication aqui no
// navegador; o negócio, os serviços e o vínculo dono→negócio são criados
// pelo SERVIDOR (api/cadastrar-negocio.js). O Firestore não aceita mais
// essas escritas vindas do navegador (firestore.rules).

import './firebase-config.js';
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { SERVICOS_SUGERIDOS } from './vocabulario.js';

const auth = getAuth(getApp());

// ========================================
// ESTADO
// ========================================
let tipoSelecionado = 'barbearia';

// ========================================
// UTILS
// ========================================
const $ = (sel) => document.querySelector(sel);

function slugify(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-')
    .substring(0, 50);
}

function formatarWhatsapp(num) {
  const d = num.replace(/\D/g, '');
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7,11)}`;
}

function normalizarWhatsapp(num) {
  const d = num.replace(/\D/g, '');
  if (d.length === 11) return '55' + d;
  if (d.length === 13 && d.startsWith('55')) return d;
  return d;
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function mostrarErro(msg) {
  const el = $('#erro-cad');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function limparErro() {
  $('#erro-cad').classList.add('hidden');
}

function liberarBotao() {
  const btn = $('#btn-cad');
  btn.disabled = false;
  btn.textContent = 'Criar conta grátis →';
}

// ========================================
// SELEÇÃO DE TIPO
// ========================================
document.querySelectorAll('.tipo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('selecionado'));
    btn.classList.add('selecionado');
    tipoSelecionado = btn.dataset.tipo;
  });
});

// ========================================
// AUTO-FILL DO SLUG
// ========================================
$('#nome-neg').addEventListener('input', (e) => {
  const slug = slugify(e.target.value);
  $('#slug').value = slug;
  $('#slug-preview').textContent = slug || 'meu-negocio';
});

$('#slug').addEventListener('input', (e) => {
  const slug = slugify(e.target.value);
  e.target.value = slug;
  $('#slug-preview').textContent = slug || 'meu-negocio';
});

$('#telefone').addEventListener('input', (e) => {
  e.target.value = formatarWhatsapp(e.target.value);
});

// ========================================
// API
// ========================================
async function slugDisponivel(slug) {
  const resp = await fetch(`/api/cadastrar-negocio?slug=${encodeURIComponent(slug)}`);
  if (!resp.ok) throw new Error('Falha ao verificar o link');
  return (await resp.json()).disponivel;
}

async function enviarCadastro(idToken, dados) {
  const resp = await fetch('/api/cadastrar-negocio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      nomeNeg: dados.nomeNeg,
      slug: dados.slug,
      cidade: dados.cidade,
      bairro: dados.bairro,
      telefone: dados.telefone,
      nomeResp: dados.nomeResp,
      tipoNegocio: dados.tipoNegocio,
      servicos: SERVICOS_SUGERIDOS[dados.tipoNegocio] || SERVICOS_SUGERIDOS.outro
    })
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const erro = new Error(corpo.erro || 'Erro ao criar o negócio.');
    erro.status = resp.status;
    throw erro;
  }
}

// Cria a conta no Auth. Se o e-mail já existe (ex.: uma tentativa anterior
// criou a conta mas o servidor falhou), tenta entrar com a mesma senha pra
// retomar o cadastro em vez de deixar a pessoa presa.
async function obterUsuarioAuth(email, senha) {
  try {
    return (await createUserWithEmailAndPassword(auth, email, senha)).user;
  } catch (authErr) {
    if (authErr.code === 'auth/email-already-in-use') {
      try {
        return (await signInWithEmailAndPassword(auth, email, senha)).user;
      } catch (_) {
        throw new Error('Esse email já está cadastrado. Acesse o painel.');
      }
    }
    if (authErr.code === 'auth/weak-password') throw new Error('Senha fraca. Use pelo menos 6 caracteres.');
    if (authErr.code === 'auth/invalid-email') throw new Error('Email inválido.');
    throw new Error('Erro ao criar conta.');
  }
}

// ========================================
// SUBMIT
// ========================================
$('#form-cad').addEventListener('submit', handleCadastro);

async function handleCadastro(e) {
  e.preventDefault();
  limparErro();

  const dados = {
    nomeNeg: $('#nome-neg').value.trim(),
    slug: slugify($('#slug').value),
    cidade: $('#cidade').value.trim(),
    bairro: $('#bairro').value.trim(),
    telefone: $('#telefone').value.trim(),
    nomeResp: $('#nome-resp').value.trim(),
    email: $('#email').value.trim().toLowerCase(),
    senha: $('#senha').value,
    tipoNegocio: tipoSelecionado
  };

  // Validações
  if (!dados.nomeNeg) return mostrarErro('Digite o nome do estabelecimento.');
  if (!dados.slug || dados.slug.length < 3) return mostrarErro('O link precisa ter pelo menos 3 caracteres.');
  if (!dados.telefone || dados.telefone.replace(/\D/g, '').length < 11) return mostrarErro('Digite um WhatsApp válido com DDD.');
  if (!dados.nomeResp) return mostrarErro('Digite seu nome.');
  if (!validarEmail(dados.email)) return mostrarErro('Digite um email válido.');
  if (dados.senha.length < 6) return mostrarErro('Senha precisa ter pelo menos 6 caracteres.');

  const btn = $('#btn-cad');
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    // 1. O link está livre? (também recusa links reservados)
    if (!(await slugDisponivel(dados.slug))) {
      mostrarErro(`O link "${dados.slug}" já está em uso ou é reservado. Tente outro.`);
      liberarBotao();
      return;
    }

    // 2. Conta no Firebase Authentication
    btn.textContent = 'Criando conta...';
    const user = await obterUsuarioAuth(dados.email, dados.senha);

    // 3. O servidor cria negócio + serviços + vínculo + fila de aprovação
    btn.textContent = 'Configurando...';
    await enviarCadastro(await user.getIdToken(), { ...dados, telefone: normalizarWhatsapp(dados.telefone) });

    // 4. Sucesso
    $('#nome-sucesso').textContent = dados.nomeResp.split(' ')[0];
    $('#tela-form').classList.add('hidden');
    $('#tela-sucesso').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error('Erro no cadastro:', err);
    mostrarErro(err.message || 'Erro inesperado. Tente novamente.');
    liberarBotao();
  }
}
