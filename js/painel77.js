// ========================================
// 77 IS — Painel Super-Admin
// ========================================

import { db } from './firebase-config.js';
import { escapeHtml } from './utils.js';
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  ref, get, set, update, remove, push, onValue, off
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const auth = getAuth(getApp());

// ========================================
// ESTADO
// ========================================
const state = {
  user: null, adminData: null,
  negocios: {}, cadastrosAguardando: {}, logs: {},
  viewAtual: 'overview', filtroStatus: 'todos', filtroTipo: 'todos', filtroBusca: '',
  listeners: []
};

// ========================================
// UTILS
// ========================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const TIPO_LABEL = { barbearia: 'Barbearia', salao: 'Salão de Beleza', estetica: 'Estética / Studio', nails: 'Nail Designer', outro: 'Outro' };
const TIPO_EMOJI = { barbearia: '💈', salao: '💇', estetica: '✨', nails: '💅', outro: '📅' };

function fmtMoeda(v) { return `R$ ${(v||0).toFixed(2).replace('.',',')}`; }
function iniciais(n) { return (n||'?').split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase(); }
function fmtWhats(n) {
  if (!n) return '—';
  const d = String(n).replace(/\D/g,'');
  if (d.length===13) return `(${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9,13)}`;
  if (d.length===11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7,11)}`;
  return n;
}
function fmtDataLonga(d) {
  const dias=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const meses=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}
function tempoRel(iso) {
  if (!iso) return '—';
  const s = (Date.now()-new Date(iso).getTime())/1000;
  if (s<60) return 'agora';
  if (s<3600) return `há ${Math.floor(s/60)}min`;
  if (s<86400) return `há ${Math.floor(s/3600)}h`;
  if (s<2592000) return `há ${Math.floor(s/86400)}d`;
  return `há ${Math.floor(s/2592000)} meses`;
}
function diasAte(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime()-Date.now())/(86400000));
}

function toast(msg, tipo='') {
  const el=$('#toast'); $('#toast-msg').textContent=msg;
  el.className=`toast ativo ${tipo}`; el.classList.remove('hidden');
  setTimeout(()=>{el.classList.remove('ativo');setTimeout(()=>el.classList.add('hidden'),300);},3000);
}
function abrirModal(titulo, corpo, rodape='') {
  $('#modal-titulo').textContent=titulo; $('#modal-body').innerHTML=corpo; $('#modal-footer').innerHTML=rodape;
  $('#modal-overlay').classList.remove('hidden');
}
function fecharModal() { $('#modal-overlay').classList.add('hidden'); }

// ========================================
// AUTH
// ========================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.user = user;
    try {
      const snap = await get(ref(db, `admins77/${user.uid}`));
      if (!snap.exists() || snap.val().role !== 'super_admin') {
        $('#loading').classList.add('hidden');
        $('#tela-negado').classList.remove('hidden');
        return;
      }
      state.adminData = snap.val();
      $('#user-nome').textContent = state.adminData.nome || user.email;
      $('#user-email').textContent = user.email;
      $('#user-avatar').textContent = iniciais(state.adminData.nome || user.email);
      $('#loading').classList.add('hidden');
      $('#painel-app').classList.remove('hidden');
      ativarListeners();
    } catch(err) {
      mostrarLogin('Erro ao verificar permissões.');
    }
  } else {
    desativarListeners();
    mostrarLogin();
  }
});

function mostrarLogin(msg) {
  $('#loading').classList.add('hidden');
  ['#painel-app','#tela-negado'].forEach(s=>$(s).classList.add('hidden'));
  $('#tela-login').classList.remove('hidden');
  if (msg) { $('#erro-login').textContent=msg; $('#erro-login').classList.remove('hidden'); }
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email=$('#login-email').value.trim(), senha=$('#login-senha').value;
  const btn=$('#btn-login'), erro=$('#erro-login');
  erro.classList.add('hidden'); btn.disabled=true; btn.textContent='Entrando...';
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch(err) {
    let msg='Erro ao fazer login.';
    if (err.code==='auth/invalid-credential'||err.code==='auth/wrong-password'||err.code==='auth/user-not-found') msg='Email ou senha incorretos.';
    else if (err.code==='auth/too-many-requests') msg='Muitas tentativas. Aguarde.';
    erro.textContent=msg; erro.classList.remove('hidden');
    btn.disabled=false; btn.textContent='Entrar';
  }
});

$('#btn-logout')?.addEventListener('click', async () => { if(confirm('Sair?')) await signOut(auth); });
$('#btn-logout-negado')?.addEventListener('click', () => signOut(auth));

// ========================================
// LISTENERS TEMPO REAL
// ========================================
function ativarListeners() {
  desativarListeners();
  const paths = { negocios:'barbearias', cadastrosAguardando:'cadastrosAguardando', logs:'logs77' };
  Object.entries(paths).forEach(([key,path]) => {
    const r = ref(db, path);
    const cb = onValue(r, snap => {
      state[key] = snap.val() || {};
      atualizarBadges();
      renderizarView();
    });
    state.listeners.push({ref:r,cb});
  });
}
function desativarListeners() {
  state.listeners.forEach(l=>off(l.ref));
  state.listeners=[];
}

function atualizarBadges() {
  const n = Object.keys(state.cadastrosAguardando).length;
  const b = $('#badge-aprovacoes');
  if (n>0) { b.textContent=n; b.classList.add('ativo'); }
  else { b.classList.remove('ativo'); }
}

// ========================================
// NAVEGAÇÃO (abas horizontais, sem sidebar fixa)
// ========================================
$$('.nav-item').forEach(item => {
  item.addEventListener('click', () => irPara(item.dataset.view));
});
$('#btn-atualizar').addEventListener('click', renderizarView);
$('#modal-close').addEventListener('click', fecharModal);
$('#modal-overlay').addEventListener('click', e => { if(e.target.id==='modal-overlay') fecharModal(); });

function irPara(view) {
  state.viewAtual=view;
  $$('.nav-item').forEach(n=>n.classList.toggle('ativo',n.dataset.view===view));
  $$('.view').forEach(v=>v.classList.toggle('ativa',v.id===`view-${view}`));
  renderizarView();
}

function renderizarView() {
  switch(state.viewAtual) {
    case 'overview':   renderOverview();   break;
    case 'aprovacoes': renderAprovacoes(); break;
    case 'negocios':   renderNegocios();   break;
    case 'atividade':  renderAtividade();  break;
  }
}

// ========================================
// OVERVIEW
// ========================================
function renderOverview() {
  $('#overview-data').textContent = fmtDataLonga(new Date());

  const arr = Object.entries(state.negocios).map(([id,b])=>({id,...(b.info||{}),dados:b}));
  const cnt = {aguardando_aprovacao:0,trial:0,ativa:0,suspensa:0,expirada:0};
  arr.forEach(b=>{ const s=b.status||'trial'; if(cnt[s]!==undefined) cnt[s]++; });

  const ativos = (cnt.trial||0)+(cnt.ativa||0);
  $('#kpi-ativas').textContent=ativos;
  $('#kpi-ativas-extra').textContent=`${cnt.trial} trial · ${cnt.ativa} pagantes`;
  $('#kpi-aguardando').textContent=Object.keys(state.cadastrosAguardando).length;

  let totalAgs=0;
  Object.values(state.negocios).forEach(b=>{ totalAgs+=Object.keys(b.agendamentos||{}).length; });
  $('#kpi-agendamentos').textContent=totalAgs;
  $('#kpi-ag-extra').textContent=`em ${arr.length} negócios`;

  const PRECO=79;
  $('#kpi-mrr').textContent=fmtMoeda(cnt.ativa*PRECO);

  // Vencimentos
  const trials = arr.filter(b=>b.status==='trial'&&b.trialFim)
    .map(b=>({...b,dias:diasAte(b.trialFim)}))
    .filter(b=>b.dias!==null&&b.dias<=7&&b.dias>=0)
    .sort((a,b)=>a.dias-b.dias);

  $('#lista-vencimentos').innerHTML = trials.length===0
    ? '<div class="vazio-msg">Nenhum vencendo nos próximos 7 dias</div>'
    : trials.map(b=>`
      <div class="vencimento-item">
        <div><div class="vencimento-nome">${escapeHtml(b.nome||b.id)}</div><div class="vencimento-detalhes">${escapeHtml(b.bairro||b.cidade||'—')}</div></div>
        <span class="vencimento-dias ${b.dias<=2?'urgente':''}">${b.dias===0?'HOJE':b.dias+'d'}</span>
      </div>`).join('');

  // Inativas
  const limite=Date.now()-(14*86400000);
  const inativas=arr.filter(b=>b.status==='trial'||b.status==='ativa').map(b=>{
    const ags=Object.values(b.dados.agendamentos||{});
    const ul=ags.length>0?Math.max(...ags.map(a=>new Date(a.criadoEm||0).getTime())):0;
    return {...b,ultimoAg:ul};
  }).filter(b=>b.ultimoAg>0&&b.ultimoAg<limite).sort((a,b)=>a.ultimoAg-b.ultimoAg).slice(0,5);

  $('#lista-inativas').innerHTML = inativas.length===0
    ? '<div class="vazio-msg">Todos ativos 🎉</div>'
    : inativas.map(b=>{
        const dias=Math.floor((Date.now()-b.ultimoAg)/86400000);
        return `<div class="inativa-item"><div><div class="inativa-nome">${escapeHtml(b.nome||b.id)}</div><div class="inativa-detalhes">sem agendar há ${dias} dias</div></div></div>`;
      }).join('');

  // Status grid
  const items=[
    {label:'Aguardando',valor:cnt.aguardando_aprovacao,cor:'#fbbf24'},
    {label:'Trial',valor:cnt.trial,cor:'#d4ff3a'},
    {label:'Ativos',valor:cnt.ativa,cor:'#4ade80'},
    {label:'Suspensos',valor:cnt.suspensa,cor:'#ff4444'},
    {label:'Expirados',valor:cnt.expirada,cor:'#737373'}
  ];
  $('#grafico-status').innerHTML=items.map(i=>`
    <div class="status-item">
      <div class="status-item-num" style="color:${i.cor};">${i.valor}</div>
      <div class="status-item-label">${i.label}</div>
    </div>`).join('');
}

// ========================================
// APROVAÇÕES
// ========================================
function renderAprovacoes() {
  const lista=Object.entries(state.cadastrosAguardando).map(([id,c])=>({id,...c}))
    .sort((a,b)=>new Date(a.criadoEm)-new Date(b.criadoEm));

  $('#aprovacoes-total').textContent=`${lista.length} cadastro${lista.length!==1?'s':''} aguardando`;

  if (lista.length===0) {
    $('#lista-aprovacoes').innerHTML='<div class="vazio-msg">🎉 Nenhuma aprovação pendente</div>';
    return;
  }

  const emoji = t => TIPO_EMOJI[t]||'📅';
  const label = t => TIPO_LABEL[t]||'Outro';

  $('#lista-aprovacoes').innerHTML=lista.map(c=>`
    <div class="aprovacao-card" data-id="${escapeHtml(c.barbeariaId)}">
      <div class="header-linha">
        <div>
          <div class="aprovacao-nome">${emoji(c.tipoNegocio)} ${escapeHtml(c.nomeBarbearia)}</div>
          <div class="aprovacao-resp">${escapeHtml(c.nomeResponsavel)} · ${label(c.tipoNegocio)}</div>
        </div>
        <div class="aprovacao-tempo">${tempoRel(c.criadoEm)}</div>
      </div>
      <div class="aprovacao-detalhes">
        <div class="det-mini"><span class="label">EMAIL</span><span class="valor">${escapeHtml(c.email)}</span></div>
        <div class="det-mini"><span class="label">WHATSAPP</span><span class="valor">${escapeHtml(fmtWhats(c.telefone))}</span></div>
        <div class="det-mini"><span class="label">CIDADE/BAIRRO</span><span class="valor">${escapeHtml(c.cidade||'—')}${c.bairro?' / '+escapeHtml(c.bairro):''}</span></div>
        <div class="det-mini"><span class="label">LINK</span><span class="valor" style="font-family:monospace;">/${escapeHtml(c.barbeariaId)}</span></div>
      </div>
      <div class="aprovacao-acoes">
        <button class="btn-acao" data-acao="aprovar">✓ Aprovar (30d trial)</button>
        <button class="btn-acao-secundario" data-acao="whatsapp">💬 WhatsApp</button>
        <button class="btn-acao-perigo" data-acao="recusar">✕ Recusar</button>
      </div>
    </div>`).join('');

  $$('#lista-aprovacoes .aprovacao-card').forEach(card=>{
    const id=card.dataset.id, c=state.cadastrosAguardando[id];
    card.querySelector('[data-acao="aprovar"]').addEventListener('click',()=>aprovar(c));
    card.querySelector('[data-acao="recusar"]').addEventListener('click',()=>recusar(c));
    card.querySelector('[data-acao="whatsapp"]').addEventListener('click',()=>wppBoasVindas(c));
  });
}

async function aprovar(c) {
  if (!confirm(`Aprovar "${c.nomeBarbearia}" e iniciar trial de 30 dias?`)) return;
  const agora=new Date(), trialFim=new Date(agora.getTime()+30*86400000);
  await update(ref(db,`barbearias/${c.barbeariaId}/info`),{status:'trial',aprovadaEm:agora.toISOString(),aprovadaPor:state.user.uid,trialFim:trialFim.toISOString()});
  await remove(ref(db,`cadastrosAguardando/${c.barbeariaId}`));
  await log('aprovou',c.barbeariaId,c.nomeBarbearia);
  toast(`${c.nomeBarbearia} aprovado! Trial até ${trialFim.toLocaleDateString('pt-BR')}`,'sucesso');

  // Abre direto o modal de criar acesso, já preenchido com os dados do cadastro
  setTimeout(() => abrirModalCriarAcesso(c.barbeariaId, { email: c.email, nome: c.nomeResponsavel }), 400);
}

async function recusar(c) {
  const motivo=prompt(`Recusar "${c.nomeBarbearia}"?\n\nMotivo (opcional):`);
  if (motivo===null) return;
  await update(ref(db,`barbearias/${c.barbeariaId}/info`),{status:'suspensa',suspensaEm:new Date().toISOString(),motivoSuspensao:motivo||'Recusado'});
  await remove(ref(db,`cadastrosAguardando/${c.barbeariaId}`));
  await log('recusou',c.barbeariaId,c.nomeBarbearia);
  toast('Cadastro recusado','sucesso');
}

function wppBoasVindas(c) {
  const msg=encodeURIComponent(`Olá ${c.nomeResponsavel.split(' ')[0]}! 👋\n\nAqui é o Felipe, da 77 IS Tecnologia. Recebi seu cadastro de *${c.nomeBarbearia}* no 77 AgendaPro.\n\nVou liberar seu acesso agora. Em alguns minutos você pode entrar em:\n\n🔗 77-agendapro.vercel.app/admin\n📧 Email: ${c.email}\n\nQualquer dúvida é só chamar aqui! 🚀`);
  window.open(`https://wa.me/${c.telefone}?text=${msg}`,'_blank');
}

// ========================================
// CRIAR ACESSO DO DONO (automatizado)
// ========================================
function abrirModalCriarAcesso(barbeariaId, sugestao = {}) {
  const corpo = `
    <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px;line-height:1.5;">
      Cria o login no Firebase e o vínculo com o negócio automaticamente — sem precisar abrir o Firebase Console.
    </p>
    <div class="input-grupo">
      <label class="input-label">EMAIL DE LOGIN DO DONO</label>
      <input type="email" id="criar-email" class="input" placeholder="dono@email.com" value="${escapeHtml(sugestao.email || '')}">
    </div>
    <div class="input-grupo">
      <label class="input-label">SENHA PROVISÓRIA</label>
      <input type="text" id="criar-senha" class="input" placeholder="Mínimo 6 caracteres">
    </div>
    <div class="input-grupo">
      <label class="input-label">NOME DO DONO</label>
      <input type="text" id="criar-nome" class="input" placeholder="Nome completo" value="${escapeHtml(sugestao.nome || '')}">
    </div>
    <div id="criar-acesso-erro" class="login-erro hidden"></div>
  `;
  const rodape = `
    <button class="btn-acao-secundario" id="modal-cancel">Cancelar</button>
    <button class="btn-acao" id="btn-confirmar-criar-acesso">Criar acesso</button>
  `;
  abrirModal(`Criar acesso do dono`, corpo, rodape);

  $('#modal-cancel').addEventListener('click', fecharModal);
  $('#btn-confirmar-criar-acesso').addEventListener('click', () => confirmarCriarAcesso(barbeariaId));
}

async function confirmarCriarAcesso(barbeariaId) {
  const email = $('#criar-email').value.trim();
  const senha = $('#criar-senha').value;
  const nome = $('#criar-nome').value.trim();
  const erroEl = $('#criar-acesso-erro');
  erroEl.classList.add('hidden');

  if (!email || !senha || senha.length < 6) {
    erroEl.textContent = '⚠️ Preencha o email e uma senha de pelo menos 6 caracteres.';
    erroEl.classList.remove('hidden');
    return;
  }

  const btn = $('#btn-confirmar-criar-acesso');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    const idToken = await state.user.getIdToken();
    const resp = await fetch('/api/criar-usuario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, email, senha, nome, barbeariaId })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.erro || 'Erro ao criar acesso');

    fecharModal();
    toast(`Acesso criado para ${nome || email}! 🔑`, 'sucesso');
    const nomeNegocio = state.negocios[barbeariaId]?.info?.nome || barbeariaId;
    await log('criou_acesso', barbeariaId, nomeNegocio);
  } catch (err) {
    erroEl.textContent = '❌ ' + err.message;
    erroEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Criar acesso';
  }
}

// ========================================
// NEGÓCIOS
// ========================================
$('#busca-negocio').addEventListener('input',e=>{state.filtroBusca=e.target.value.toLowerCase();renderNegocios();});
$('#filtro-status').addEventListener('change',e=>{state.filtroStatus=e.target.value;renderNegocios();});
$('#filtro-tipo').addEventListener('change',e=>{state.filtroTipo=e.target.value;renderNegocios();});

function renderNegocios() {
  let lista=Object.entries(state.negocios).map(([id,b])=>({
    id,...(b.info||{}),
    totalAgs:Object.keys(b.agendamentos||{}).length,
    totalServicos:Object.keys(b.servicos||{}).length,
    totalProfs:Object.keys(b.profissionais||{}).length
  }));

  if (state.filtroStatus!=='todos') lista=lista.filter(b=>(b.status||'trial')===state.filtroStatus);
  if (state.filtroTipo!=='todos') lista=lista.filter(b=>(b.tipoNegocio||'barbearia')===state.filtroTipo);
  if (state.filtroBusca) lista=lista.filter(b=>b.nome?.toLowerCase().includes(state.filtroBusca)||b.id?.toLowerCase().includes(state.filtroBusca));

  const ordemStatus={aguardando_aprovacao:0,trial:1,ativa:2,suspensa:3,expirada:4};
  lista.sort((a,b)=>(ordemStatus[a.status]??9)-(ordemStatus[b.status]??9)||(new Date(b.criadoEm||0)-new Date(a.criadoEm||0)));

  $('#negocios-total').textContent=`${lista.length} negócio${lista.length!==1?'s':''}`;

  if (lista.length===0) { $('#lista-negocios').innerHTML='<div class="vazio-msg">Nenhum encontrado</div>'; return; }

  const statusLabel={aguardando_aprovacao:'Aguardando',trial:'Trial',ativa:'Ativo',suspensa:'Suspenso',expirada:'Expirado'};

  $('#lista-negocios').innerHTML=lista.map(b=>{
    const s=b.status||'trial';
    const emoji=TIPO_EMOJI[b.tipoNegocio]||'📅';
    const tipo=TIPO_LABEL[b.tipoNegocio]||'Negócio';
    let extra='';
    if (s==='trial'&&b.trialFim) {
      const d=diasAte(b.trialFim);
      if (d!==null) extra=d<0?`<div style="font-size:11px;color:var(--danger);margin-bottom:6px;">Trial expirado há ${Math.abs(d)}d</div>`:d===0?`<div style="font-size:11px;color:var(--danger);font-weight:600;margin-bottom:6px;">Trial vence HOJE</div>`:`<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Trial vence em ${d}d</div>`;
    }
    return `
      <div class="negocio-card" data-id="${escapeHtml(b.id)}">
        <div class="negocio-card-header">
          <div style="flex:1;min-width:0;">
            <div class="negocio-nome">${emoji} ${escapeHtml(b.nome||b.id)}</div>
            <div class="negocio-slug">/${escapeHtml(b.id)}</div>
            <div class="negocio-tipo">${tipo}</div>
          </div>
          <span class="tag-status tag-${s}">${escapeHtml(statusLabel[s]||s)}</span>
        </div>
        ${extra}
        <div class="negocio-stats">
          <div class="stat-mini"><div class="stat-mini-num">${b.totalAgs}</div><div class="stat-mini-label">Agendamentos</div></div>
          <div class="stat-mini"><div class="stat-mini-num">${b.totalServicos}</div><div class="stat-mini-label">Serviços</div></div>
          <div class="stat-mini"><div class="stat-mini-num">${b.totalProfs}</div><div class="stat-mini-label">Profissionais</div></div>
        </div>
        <div class="negocio-acoes">
          <button class="btn-mini" data-acao="ver">Ver detalhes</button>
          <button class="btn-mini" data-acao="link">📋 Copiar link</button>
          <button class="btn-mini" data-acao="criar-acesso">🔑 Criar acesso</button>
          ${s==='ativa'||s==='trial'?'<button class="btn-mini perigo" data-acao="suspender">Suspender</button>':''}
          ${s==='suspensa'?'<button class="btn-mini" data-acao="reativar">Reativar</button>':''}
          ${s==='trial'?'<button class="btn-mini" data-acao="estender">+30d trial</button>':''}
          ${s==='trial'?'<button class="btn-mini" data-acao="ativar">Marcar pagante</button>':''}
        </div>
      </div>`;
  }).join('');

  $$('#lista-negocios .negocio-card').forEach(card=>{
    const id=card.dataset.id;
    card.querySelectorAll('[data-acao]').forEach(btn=>{
      btn.addEventListener('click',e=>{e.stopPropagation();acaoNegocio(id,btn.dataset.acao);});
    });
  });
}

async function acaoNegocio(id, acao) {
  const b=state.negocios[id]; if(!b) return;
  const info=b.info||{};
  switch(acao) {
    case 'ver': modalDetalhes(id); break;
    case 'criar-acesso':
      abrirModalCriarAcesso(id, { email: '', nome: '' });
      break;
    case 'link':
      navigator.clipboard.writeText(`${location.origin}/${id}`);
      toast('Link copiado!','sucesso'); break;
    case 'suspender':
      if (!confirm(`Suspender "${info.nome}"?`)) return;
      await update(ref(db,`barbearias/${id}/info`),{status:'suspensa',suspensaEm:new Date().toISOString()});
      await log('suspendeu',id,info.nome); toast('Suspenso','sucesso'); break;
    case 'reativar':
      if (!confirm(`Reativar "${info.nome}"?`)) return;
      await update(ref(db,`barbearias/${id}/info`),{status:info.trialFim?'trial':'ativa',reativadaEm:new Date().toISOString()});
      await log('reativou',id,info.nome); toast('Reativado','sucesso'); break;
    case 'estender':
      const base=info.trialFim?new Date(info.trialFim):new Date();
      const novo=new Date(base.getTime()+30*86400000);
      await update(ref(db,`barbearias/${id}/info`),{trialFim:novo.toISOString()});
      await log('estendeu_trial',id,info.nome); toast(`Trial até ${novo.toLocaleDateString('pt-BR')}`,'sucesso'); break;
    case 'ativar':
      if (!confirm(`Marcar "${info.nome}" como pagante?`)) return;
      await update(ref(db,`barbearias/${id}/info`),{status:'ativa',ativadaEm:new Date().toISOString(),plano:'mensal'});
      await log('marcou_pagante',id,info.nome); toast('Marcado como pagante 💰','sucesso'); break;
  }
}

function modalDetalhes(id) {
  const b=state.negocios[id]; if(!b) return;
  const info=b.info||{};
  const ags=Object.values(b.agendamentos||{});
  const conc=ags.filter(a=>a.status==='concluido');
  const fat=conc.reduce((s,a)=>s+(a.valorTotal||0),0);
  const clientes=Object.keys(b.clientes||{}).length;
  const ulAg=ags.length>0?Math.max(...ags.map(a=>new Date(a.criadoEm||0).getTime())):null;

  abrirModal(info.nome||id,`
    <div class="modal-secao">
      <h4>Dados Gerais</h4>
      <div class="modal-info-row"><span class="label">Tipo</span><span class="valor">${TIPO_LABEL[info.tipoNegocio]||'—'}</span></div>
      <div class="modal-info-row"><span class="label">Slug</span><span class="valor" style="font-family:monospace;">/${escapeHtml(id)}</span></div>
      <div class="modal-info-row"><span class="label">Endereço</span><span class="valor">${escapeHtml(info.bairro||'—')}${info.cidade?', '+escapeHtml(info.cidade):''}</span></div>
      <div class="modal-info-row"><span class="label">WhatsApp</span><span class="valor">${escapeHtml(fmtWhats(info.telefone))}</span></div>
      <div class="modal-info-row"><span class="label">Status</span><span class="valor">${escapeHtml(info.status||'—')}</span></div>
      ${info.trialFim?`<div class="modal-info-row"><span class="label">Trial até</span><span class="valor">${new Date(info.trialFim).toLocaleDateString('pt-BR')}</span></div>`:''}
      <div class="modal-info-row"><span class="label">Cadastrado em</span><span class="valor">${info.criadoEm?new Date(info.criadoEm).toLocaleDateString('pt-BR'):'—'}</span></div>
    </div>
    <div class="modal-secao">
      <h4>Métricas</h4>
      <div class="modal-info-row"><span class="label">Agendamentos</span><span class="valor">${ags.length}</span></div>
      <div class="modal-info-row"><span class="label">Concluídos</span><span class="valor">${conc.length}</span></div>
      <div class="modal-info-row"><span class="label">Faturamento total</span><span class="valor">${fmtMoeda(fat)}</span></div>
      <div class="modal-info-row"><span class="label">Clientes</span><span class="valor">${clientes}</span></div>
      <div class="modal-info-row"><span class="label">Último agendamento</span><span class="valor">${ulAg?tempoRel(new Date(ulAg).toISOString()):'nenhum'}</span></div>
    </div>
    <a href="/${escapeHtml(id)}" target="_blank" class="btn-acao-secundario" style="display:block;text-decoration:none;text-align:center;margin-top:4px;">🔗 Abrir página pública</a>
  `);
}

// ========================================
// ATIVIDADE
// ========================================
function renderAtividade() {
  const lista=Object.entries(state.logs).map(([id,l])=>({id,...l}))
    .sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,50);

  const icones={aprovou:'✓',recusou:'✕',suspendeu:'🚫',reativou:'🔄',estendeu_trial:'⏰',marcou_pagante:'💰',criou_acesso:'🔑'};
  const labels={aprovou:'Aprovou cadastro',recusou:'Recusou cadastro',suspendeu:'Suspendeu',reativou:'Reativou',estendeu_trial:'Estendeu trial',marcou_pagante:'Marcou como pagante',criou_acesso:'Criou acesso do dono'};

  $('#lista-atividade').innerHTML=lista.length===0
    ? '<div class="vazio-msg">Nenhuma atividade ainda</div>'
    : lista.map(l=>`
      <div class="atividade-item">
        <div class="atividade-icone">${icones[l.acao]||'⚡'}</div>
        <div style="flex:1;min-width:0;">
          <div class="atividade-acao">${escapeHtml(labels[l.acao]||l.acao)} — <strong>${escapeHtml(l.alvoNome)}</strong></div>
          <div class="atividade-meta">por ${escapeHtml(l.adminNome||'admin')}</div>
        </div>
        <div class="atividade-tempo">${tempoRel(l.timestamp)}</div>
      </div>`).join('');
}

// ========================================
// LOG
// ========================================
async function log(acao, alvoId, alvoNome) {
  try {
    await set(push(ref(db,'logs77')),{acao,alvoId,alvoNome,admin:state.user.uid,adminNome:state.adminData?.nome||state.user.email,timestamp:new Date().toISOString()});
  } catch(e){ console.error('log:',e); }
}
