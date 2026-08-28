// ========================================
// 77 AGENDAPRO — Auto-cadastro (multi-segmento)
// ========================================

import { db } from './firebase-config.js';
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
  if (['admin', 'cadastro', 'painel77', 'api'].includes(dados.slug)) return mostrarErro('Esse link é reservado. Tente outro.');
  if (!dados.telefone || dados.telefone.replace(/\D/g, '').length < 11) return mostrarErro('Digite um WhatsApp válido com DDD.');
  if (!dados.nomeResp) return mostrarErro('Digite seu nome.');
  if (!validarEmail(dados.email)) return mostrarErro('Digite um email válido.');
  if (dados.senha.length < 6) return mostrarErro('Senha precisa ter pelo menos 6 caracteres.');

  const btn = $('#btn-cad');
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    // 1. Verifica se slug já existe (doc público p/ visitante anônimo)
    const slugSnap = await getDoc(doc(db, 'barbearias', dados.slug));
    if (slugSnap.exists()) {
      mostrarErro(`O link "${dados.slug}" já está em uso. Tente outro.`);
      btn.disabled = false;
      btn.textContent = 'Criar conta grátis →';
      return;
    }

    btn.textContent = 'Criando conta...';

    // 2. Cria usuário no Auth
    let uid;
    try {
      const cred = await createUserWithEmailAndPassword(auth, dados.email, dados.senha);
      uid = cred.user.uid;
    } catch (authErr) {
      let msg = 'Erro ao criar conta.';
      if (authErr.code === 'auth/email-already-in-use') msg = 'Esse email já está cadastrado. Acesse o painel.';
      else if (authErr.code === 'auth/weak-password') msg = 'Senha fraca. Use pelo menos 6 caracteres.';
      else if (authErr.code === 'auth/invalid-email') msg = 'Email inválido.';
      mostrarErro(msg);
      btn.disabled = false;
      btn.textContent = 'Criar conta grátis →';
      return;
    }

    btn.textContent = 'Configurando...';
    const agora = new Date().toISOString();
    const enderecoCompleto = [dados.bairro, dados.cidade].filter(Boolean).join(', ');

    // 3. Busca serviços sugeridos pro tipo
    const servicosSugeridos = SERVICOS_SUGERIDOS[dados.tipoNegocio] || SERVICOS_SUGERIDOS.outro;

    // 4. Cria barbearia no banco — doc principal com os campos que antes
    // ficavam em "info" (achatado direto no documento, sem sub-nó — não
    // precisa mais, cada doc no Firestore já é sua própria unidade de
    // segurança/leitura). Serviços/profissionais/clientes/agendamentos são
    // sub-coleções, que não precisam ser "criadas vazias".
    await setDoc(doc(db, 'barbearias', dados.slug), {
      nome: dados.nomeNeg,
      slug: dados.slug,
      tipoNegocio: dados.tipoNegocio,
      endereco: enderecoCompleto || 'Rio de Janeiro',
      cidade: dados.cidade,
      bairro: dados.bairro,
      telefone: normalizarWhatsapp(dados.telefone),
      status: 'aguardando_aprovacao',
      plano: 'trial',
      trialFim: null,
      criadoEm: agora,
      criadoPor: uid,
      horarioFuncionamento: {
        segunda: { ativo: true,  inicio: '09:00', fim: '19:00' },
        terca:   { ativo: true,  inicio: '09:00', fim: '19:00' },
        quarta:  { ativo: true,  inicio: '09:00', fim: '19:00' },
        quinta:  { ativo: true,  inicio: '09:00', fim: '19:00' },
        sexta:   { ativo: true,  inicio: '09:00', fim: '20:00' },
        sabado:  { ativo: true,  inicio: '08:00', fim: '17:00' },
        domingo: { ativo: false, inicio: '00:00', fim: '00:00' }
      }
    });

    // Serviços já pre-populados com sugestões do tipo escolhido
    const batchServicos = writeBatch(db);
    servicosSugeridos.forEach((s, i) => {
      const servicoRef = doc(db, 'barbearias', dados.slug, 'servicos', `srv_00${i + 1}`);
      batchServicos.set(servicoRef, { ...s, ativo: true, ordem: i + 1 });
    });
    await batchServicos.commit();

    // 5. Cria vínculo usuário → negócio
    await setDoc(doc(db, 'usuarios', uid), {
      email: dados.email,
      nome: dados.nomeResp,
      barbeariaId: dados.slug,
      role: 'owner',
      criadoEm: agora,
      precisaOnboarding: true
    });

    // 6. Fila de aprovação pra você ver no painel super-admin
    await setDoc(doc(db, 'cadastrosAguardando', dados.slug), {
      barbeariaId: dados.slug,
      nomeBarbearia: dados.nomeNeg,
      tipoNegocio: dados.tipoNegocio,
      nomeResponsavel: dados.nomeResp,
      email: dados.email,
      telefone: normalizarWhatsapp(dados.telefone),
      cidade: dados.cidade,
      bairro: dados.bairro,
      criadoEm: agora,
      uid
    });

    // 7. Sucesso
    $('#nome-sucesso').textContent = dados.nomeResp.split(' ')[0];
    $('#tela-form').classList.add('hidden');
    $('#tela-sucesso').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error('Erro no cadastro:', err);
    mostrarErro('Erro inesperado. Tente novamente.');
    btn.disabled = false;
    btn.textContent = 'Criar conta grátis →';
  }
}
