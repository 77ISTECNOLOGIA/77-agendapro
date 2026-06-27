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

const messaging = firebase.messaging();

// Ícone institucional 77 IS (coral) — usado quando a notificação chega
// com o app/painel fechado ou em segundo plano
const ICONE_77 = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#fb6464"/><text x="50" y="68" font-family="sans-serif" font-weight="800" font-size="48" text-anchor="middle" fill="#0a0a0a">77</text></svg>'
);

messaging.onBackgroundMessage((payload) => {
  const titulo = (payload.notification && payload.notification.title) || '77 AgendaPro';
  const corpo = (payload.notification && payload.notification.body) || '';

  self.registration.showNotification(titulo, {
    body: corpo,
    icon: ICONE_77,
    badge: ICONE_77
  });
});
