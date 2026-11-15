// SDK de MENTIRA do Firebase Messaging: o teste local não recebe push.
export function getMessaging() { return {}; }
export async function getToken() { throw Object.assign(new Error('sem push no teste local'), { code: 'messaging/unsupported-browser' }); }
export function onMessage() { return () => {}; }
export async function isSupported() { return false; }
