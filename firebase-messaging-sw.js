// ========================================
// 77 AGENDAPRO — Service Worker de Notificações Push
// Precisa estar na RAIZ do projeto (mesmo nível do index.html)
// ========================================

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD9NiwY8PgrHcyFzc-pDberzNyTbiNNKUY",
  authDomain: "agendapro-179cb.firebaseapp.com",
  databaseURL: "https://agendapro-179cb-default-rtdb.firebaseio.com",
  projectId: "agendapro-179cb",
  storageBucket: "agendapro-179cb.firebasestorage.app",
  messagingSenderId: "229432793601",
  appId: "1:229432793601:web:891c629da01a1bdb7c3e00"
});

// Versão nova assume IMEDIATAMENTE. Sem isto, depois de uma atualização o navegador mantinha a
// versão ANTIGA ativa enquanto houvesse uma aba do painel aberta.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const messaging = firebase.messaging();

// Ícone institucional 77 IS (coral)
const ICONE_77 = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#fb6464"/><text x="50" y="68" font-family="sans-serif" font-weight="800" font-size="48" text-anchor="middle" fill="#0a0a0a">77</text></svg>'
);

// A mensagem do servidor já traz o campo "notification": o próprio Firebase MOSTRA a notificação
// quando o painel está em segundo plano (e, ao tocar, abre o link e avisa a página aberta).
// Este arquivo só mostra uma notificação PRÓPRIA se o Firebase não mostrou a DESTA mensagem —
// nunca fica em branco (o iPhone exige uma notificação visível a cada push) e nunca duplica.
//
// Como saber se o Firebase já mostrou a desta mensagem? Duas pistas, sem depender de recursos
// que variam por navegador (o Safari, por exemplo, não preenche "timestamp"):
//   1) alguma notificação exibida com a MESMA tag desta mensagem;
//   2) alguma notificação criada pelo SDK (guarda a mensagem original em data.FCM_MSG) cuja
//      mensagem tem a mesma tag.
messaging.onBackgroundMessage(async (payload) => {
  const tag = (payload.data && payload.data.tag) || undefined;
  await new Promise((resolver) => setTimeout(resolver, 700));

  if (tag) {
    const exibidas = await self.registration.getNotifications();
    const jaMostrada = exibidas.some((n) => {
      if (n.tag === tag) return true;
      const original = n.data && n.data.FCM_MSG;
      return !!(original && original.data && original.data.tag === tag);
    });
    if (jaMostrada) return;
  }

  const titulo = (payload.notification && payload.notification.title) || '77 AgendaPro';
  const corpo = (payload.notification && payload.notification.body) || '';
  return self.registration.showNotification(titulo, {
    body: corpo, icon: ICONE_77, badge: ICONE_77, tag,
    data: { reserva: true, agendamentoId: (payload.data && payload.data.agendamentoId) || null }
  });
});

// Toque na NOSSA notificação de reserva (a do Firebase tem o tratamento dela): abre o painel
// já no agendamento. Painel aberto → foca e avisa a página; fechado → abre /admin?agendamento=ID.
self.addEventListener('notificationclick', (event) => {
  const dados = event.notification.data;
  if (!dados || !dados.reserva) return;
  event.notification.close();
  const id = dados.agendamentoId;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (janelas) => {
      for (const janela of janelas) {
        if ('focus' in janela) {
          const focada = await janela.focus();
          if (id && focada) focada.postMessage({ messageType: 'notification-clicked', data: { agendamentoId: id } });
          return;
        }
      }
      return self.clients.openWindow(id ? '/admin?agendamento=' + encodeURIComponent(id) : '/admin');
    })
  );
});
