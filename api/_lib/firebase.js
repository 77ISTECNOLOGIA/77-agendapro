// ========================================
// 77 AGENDAPRO — Inicialização única do Firebase Admin (compartilhada)
// ========================================
// Pasta com prefixo "_" não vira Vercel Function. A inicialização é preguiçosa
// (só na primeira chamada), então um erro de configuração das env vars vira uma
// resposta 500 tratada por requisição, em vez de derrubar o carregamento do módulo.

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

function garantirApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // O Vercel armazena quebras de linha como "\n" literal — precisa converter de volta
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    })
  });
}

function db() { garantirApp(); return getFirestore(); }
function auth() { return getAuth(garantirApp()); }
function messaging() { return getMessaging(garantirApp()); }

module.exports = { db, auth, messaging, FieldValue };
