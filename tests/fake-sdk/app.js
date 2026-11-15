// SDK de MENTIRA do Firebase (app) — só para testar as telas no navegador com `node tests/dev-local.js`.
const apps = [];
export function initializeApp(config) { const app = { name: '[DEFAULT]', options: config }; apps.push(app); return app; }
export function getApp() { return apps[0] || initializeApp({}); }
export function getApps() { return apps; }
