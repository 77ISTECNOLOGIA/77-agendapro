// ========================================
// 77 AGENDAPRO — Avisos no celular do cliente (push) — link do cliente
// ========================================
// O cliente ativa "Receber lembrete do horário": o navegador gera um token de push e o servidor guarda por WhatsApp
// (api/agendamento-cliente: aparelho-registrar). Depois ele recebe o lembrete programado e os avisos de cancelamento,
// remarcação e confirmação de pagamento feitos pelo estabelecimento (api/_lib/lembrete.js).
// iPhone: só funciona com o app instalado na Tela de Início (iOS 16.4+) e aberto por lá.
import { ehAppleMobile } from './utils.js';
import { jaEstaInstalado } from './instalar.js';

const VAPID_KEY = 'BBDdf4Estwxij9B1m3R7jZCrNNMul4EcIjAYJ9-Xw-8mgebCIgGwCUfPdYBko7scsVQ6VxMefFBYORQv9mzLYl4';

// Regra pura (testada). Devolve: 'indisponivel' | 'instalar-primeiro' | 'bloqueado' | 'ativo' | 'ativar'
export function situacaoAvisos({ suporta, apple, standalone, permissao, ativoLocal }) {
  if (apple && !standalone) return 'instalar-primeiro';
  if (!suporta) return 'indisponivel';
  if (permissao === 'denied') return 'bloqueado';
  if (permissao === 'granted' && ativoLocal) return 'ativo';
  return 'ativar';
}

const chaveLocal = (slug, whats) => 'ap_avisos_' + slug + '_' + whats;
const ler = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* sem armazenamento: ok */ } };

function suportaPush() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
}

function descreverAparelho() {
  const ua = navigator.userAgent || '';
  const so = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Aparelho';
  return so + (jaEstaInstalado() ? ' · app' : ' · navegador');
}

async function enviarToken({ slug, whatsapp }, token) {
  const resp = await fetch('/api/agendamento-cliente', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, whatsapp, action: 'aparelho-registrar', token, aparelho: descreverAparelho() })
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(corpo.erro || 'Não foi possível ativar os avisos.');
}

async function gerarToken() {
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;                  // o iPhone precisa do worker ATIVO antes de gerar o token
  const [{ initializeApp, getApps, getApp }, { getMessaging, getToken }, { firebaseConfig }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js'),
    import('./firebase-config.js')
  ]);
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Não foi possível gerar o aviso neste aparelho.');
  return token;
}

/** Pede a permissão, gera o token e registra o aparelho. Lança Error com mensagem em português. */
export async function ativarAvisos(ctx) {
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') throw new Error('Você não permitiu os avisos. Toque de novo e escolha "Permitir".');
  await enviarToken(ctx, await gerarToken());
  gravar(chaveLocal(ctx.slug, ctx.whatsapp), '1');
}

/** Desenha o cartão dentro de `el`. ctx = { slug, whatsapp }. Chame de novo para reavaliar. */
export function mostrarCartaoAvisos(el, ctx, toast) {
  if (!el || !ctx.whatsapp) return;
  const estado = situacaoAvisos({
    suporta: suportaPush(), apple: ehAppleMobile(navigator), standalone: jaEstaInstalado(),
    permissao: suportaPush() ? Notification.permission : 'default', ativoLocal: ler(chaveLocal(ctx.slug, ctx.whatsapp)) === '1'
  });
  if (estado === 'indisponivel') { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const sino = '<span class="ca-sino" aria-hidden="true">🔔</span>';
  let html;
  if (estado === 'ativo') {
    html = sino + '<div class="ca-texto"><div class="ca-titulo">Avisos ativos neste aparelho</div><div class="ca-sub">Você receberá o lembrete do horário e avisos de mudanças.</div></div>';
    gerarToken().then((t) => enviarToken(ctx, t)).catch(() => {});      // renova o token em silêncio (ele pode mudar com o tempo)
  } else if (estado === 'instalar-primeiro') {
    html = sino + '<div class="ca-texto"><div class="ca-titulo">Lembrete do horário no iPhone</div><div class="ca-sub">Adicione este app à <strong>Tela de Início</strong>, abra por lá e toque em “Ativar avisos”.</div></div>';
  } else if (estado === 'bloqueado') {
    html = sino + '<div class="ca-texto"><div class="ca-titulo">Avisos bloqueados</div><div class="ca-sub">Libere as notificações deste site nas configurações do navegador para receber o lembrete.</div></div>';
  } else {
    html = sino + '<div class="ca-texto"><div class="ca-titulo">Receber lembrete do horário</div><div class="ca-sub">Avisamos pouco antes do seu horário e se algo mudar.</div><button type="button" class="bi-botao" id="ca-ativar">Ativar avisos</button></div>';
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
  const botao = el.querySelector('#ca-ativar');
  if (botao) botao.addEventListener('click', async () => {
    botao.disabled = true; botao.textContent = 'Ativando...';
    try { await ativarAvisos(ctx); toast('Avisos ativados neste aparelho! 🔔', 'sucesso'); }
    catch (err) { toast(err.message || 'Não foi possível ativar os avisos.', 'erro'); }
    mostrarCartaoAvisos(el, ctx, toast);
  });
}
