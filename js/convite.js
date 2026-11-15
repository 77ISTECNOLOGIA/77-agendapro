// ========================================
// 77 AGENDAPRO — Aceitar convite da equipe
// ========================================
// O link traz ?n=<negócio>&c=<token>. A conta (e-mail/senha) é criada aqui no navegador; o vínculo com o negócio e as
// permissões são gravados pelo SERVIDOR (api/equipe.js, ação "aceitar"), que confere o token e o e-mail do convite.

import './firebase-config.js';
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { adicionarMostrarSenha } from './utils.js';

const auth = getAuth(getApp());
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const slug = params.get('n') || '';
const token = params.get('c') || '';
let convite = null;

async function api(corpo) {
  const r = await fetch('/api/equipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(dados.erro || 'Erro inesperado.'), { status: r.status });
  return dados;
}

function mostrar(id) {
  ['#tela-carregando', '#tela-invalido', '#tela-form'].forEach((t) => $(t).classList.toggle('hidden', t !== id));
}

function erro(msg) { const el = $('#erro'); el.textContent = msg; el.classList.remove('hidden'); }

async function iniciar() {
  try {
    convite = await api({ action: 'convite-info', n: slug, c: token });
  } catch (e) {
    $('#msg-invalido').textContent = e.message;
    return mostrar('#tela-invalido');
  }
  $('#negocio').textContent = convite.negocio;
  $('#email').value = convite.email;
  adicionarMostrarSenha($('#senha'));
  mostrar('#tela-form');
}

$('#form-convite').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#erro').classList.add('hidden');
  const senha = $('#senha').value;
  if (senha.length < 6) return erro('A senha precisa ter pelo menos 6 caracteres.');
  const btn = $('#btn');
  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, convite.email, senha);
    } catch (e) {
      if (e.code !== 'auth/email-already-in-use') throw e;
      cred = await signInWithEmailAndPassword(auth, convite.email, senha);   // conta já existente (ou convite repetido)
    }
    await api({ action: 'aceitar', idToken: await cred.user.getIdToken(), n: slug, c: token });
    location.href = '/admin';
  } catch (e) {
    const c = e.code || '';
    if (c === 'auth/weak-password') erro('Escolha uma senha mais forte (mínimo 6 caracteres).');
    else if (c === 'auth/wrong-password' || c === 'auth/invalid-credential') erro('Esse e-mail já tem conta e a senha não confere. Digite a senha dela.');
    else if (c.startsWith('auth/')) erro('Não foi possível criar o acesso agora. Tente de novo.');
    else if (e.status === 409 && /já está vinculada/.test(e.message)) location.href = '/admin';   // conta já entrou antes
    else erro(e.message || 'Não foi possível aceitar o convite.');
    btn.disabled = false; btn.textContent = 'Entrar na equipe →';
  }
});

iniciar();
