// ========================================
// 77 AGENDAPRO — Configuração Firebase
// ========================================
// Projeto: agendapro-179cb
// Felipe — 77 IS Tecnologia & Inteligência
// ========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD9NiwY8PgrHcyFzc-pDberzNyTbiNNKUY",
  authDomain: "agendapro-179cb.firebaseapp.com",
  databaseURL: "https://agendapro-179cb-default-rtdb.firebaseio.com",
  projectId: "agendapro-179cb",
  storageBucket: "agendapro-179cb.firebasestorage.app",
  messagingSenderId: "229432793601",
  appId: "1:229432793601:web:891c629da01a1bdb7c3e00"
};

const app = initializeApp(firebaseConfig);
// Se a conexão em tempo real (WebChannel) for bloqueada ou ficar muda (rede, extensão, proxy), o SDK troca sozinho
// para "long polling" em vez de ficar esperando para sempre.
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

export { db, firebaseConfig };
