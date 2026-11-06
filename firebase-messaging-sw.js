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
// versão ANTIGA ativa enquanto houvesse uma aba do painel aberta — e a antiga mostrava a
// notificação em dobro. (Foi exatamente o que aconteceu no notebook.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const messaging = firebase.messaging();

// Ícone institucional 77 IS (coral)
const ICONE_77 = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#fb6464"/><text x="50" y="68" font-family="sans-serif" font-weight="800" font-size="48" text-anchor="middle" fill="#0a0a0a">77</text></svg>'
);

// A mensagem enviada pelo servidor já traz o campo "notification": o próprio Firebase MOSTRA a
// notificação quando o painel está em segundo plano, e tocar nela abre o painel (link definido no
// servidor). Este arquivo só mostra uma notificação PRÓPRIA se, por algum motivo, o Firebase não
// mostrou nenhuma agora há pouco — assim nunca fica em branco (importante no iPhone, que exige
// uma notificação visível a cada push) e nunca duplica.
messaging.onBackgroundMessage(async (payload) => {
  await new Promise((resolver) => setTimeout(resolver, 700));

  const agora = Date.now();
  const mostradas = await self.registration.getNotifications();
  if (mostradas.some((n) => agora - n.timestamp < 10000)) return;   // já apareceu uma agora há pouco

  const tag = (payload.data && payload.data.tag) || undefined;
  const titulo = (payload.notification && payload.notification.title) || '77 AgendaPro';
  const corpo = (payload.notification && payload.notification.body) || '';
  return self.registration.showNotification(titulo, {
    body: corpo, icon: ICONE_77, badge: ICONE_77, tag, data: { reserva: true }
  });
});

// Toque na NOSSA notificação de reserva (a do Firebase tem o tratamento dela): abre o painel.
self.addEventListener('notificationclick', (event) => {
  if (!event.notification.data || !event.notification.data.reserva) return;
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) if ('focus' in janela) return janela.focus();
      return self.clients.openWindow('/admin');
    })
  );
});
