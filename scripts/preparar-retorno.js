// Prepara o retorno inteligente com o HISTÓRICO que já existe (atendimentos concluídos antes desse recurso). Idempotente.
// Uso (só mostra):  node scripts/preparar-retorno.js
// Uso (aplica):     node scripts/preparar-retorno.js --aplicar        (requer scripts/serviceAccountKey.json)
// Para cada ficha de cliente com atendimentos concluídos grava: ultimasVisitas (até 6 datas), cadenciaDias, retornoEm.
// NÃO grava `retornoPushEm`: ninguém recebe aviso automático por visitas antigas — o dono vê a lista no Dashboard e chama quem quiser.

const path = require('path');
const admin = require('firebase-admin');
const aplicar = process.argv.includes('--aplicar');
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore();
const { calcularRetorno } = require('../api/_lib/retorno');

(async () => {
  console.log(aplicar ? 'APLICANDO\n' : 'SIMULAÇÃO (use --aplicar para gravar)\n');
  let total = 0;
  const negocios = await db.collection('barbearias').get();
  for (const n of negocios.docs) {
    const ags = await n.ref.collection('agendamentos').where('status', '==', 'concluido').get();
    const porCliente = new Map();
    for (const d of ags.docs) {
      const a = d.data();
      if (!a.clienteWhatsapp || !a.dataChave) continue;
      const id = a.donoVe === false ? `${a.profissionalId}__${a.clienteWhatsapp}` : a.clienteWhatsapp;
      if (!porCliente.has(id)) porCliente.set(id, []);
      porCliente.get(id).push(a.dataChave);
    }
    let feitos = 0;
    for (const [id, datas] of porCliente) {
      const ref = n.ref.collection('clientes').doc(id);
      if (!(await ref.get()).exists) continue;
      const visitas = [...new Set(datas)].sort().slice(-6);
      const r = calcularRetorno(visitas);
      feitos++;
      if (aplicar) await ref.update({ ultimasVisitas: visitas, cadenciaDias: r.cadenciaDias, cadenciaPersonalizada: r.personalizada, retornoEm: r.retornoEm });
    }
    console.log(`${n.id}: ${feitos} cliente(s) com histórico`);
    total += feitos;
  }
  console.log(`\n${total} ficha(s) ${aplicar ? 'preparada(s)' : 'a preparar'}.`);
  process.exit(0);
})().catch((e) => { console.error('falhou:', e.message); process.exit(1); });
