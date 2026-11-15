// ========================================
// 77 AGENDAPRO — Privacidade do SÓCIO: o dono não vê agenda, clientes nem faturamento dele
// ========================================
// Como o banco garante isso: cada agendamento e cada ficha de cliente carrega \`donoVe\` (boolean). As regras do Firestore só
// deixam o DONO ler documentos com donoVe == true (e a consulta dele TEM de filtrar por isso); o sócio lê os próprios pelo
// profissionalId. \`donoVe\` é false quando o profissional é de um sócio (\`profissionais/{id}.socio === true\`).
//
// Clientes: a ficha do dono/funcionários fica em clientes/{whatsapp}; a de um sócio fica em clientes/{profissionalId}__{whatsapp}
// (donoVe:false). Assim um cliente atendido pelos dois lados tem DUAS fichas, cada uma com as visitas daquele lado.

const donoVePara = (prof) => !(prof && prof.socio === true);
const idCliente = (prof, profissionalId, whatsapp) => (donoVePara(prof) ? whatsapp : `${profissionalId}__${whatsapp}`);

const LOTE = 400;

/**
 * Reaplica a privacidade quando um profissional passa a ser (ou deixa de ser) de sócio, ou ao migrar dados antigos:
 * ajusta donoVe de todos os agendamentos dele e move as fichas de cliente para o lado certo.
 * Idempotente. Devolve { agendamentos, clientes }.
 */
async function reaplicarSocio(firestore, negocioRef, profissionalId, ehSocio) {
  const agsSnap = await negocioRef.collection('agendamentos').where('profissionalId', '==', profissionalId).get();
  const donoVe = !ehSocio;
  let mudouAgs = 0;
  const docs = agsSnap.docs;
  for (let i = 0; i < docs.length; i += LOTE) {
    const lote = firestore.batch ? firestore.batch() : null;
    for (const d of docs.slice(i, i + LOTE)) {
      if (d.data().donoVe === donoVe) continue;
      mudouAgs++;
      if (lote) lote.update(d.ref, { donoVe }); else await d.ref.update({ donoVe });
    }
    if (lote) await lote.commit();
  }

  // fichas de cliente: por WhatsApp atendido por este profissional
  const porWhats = new Map();
  for (const d of docs) {
    const a = d.data();
    if (!a.clienteWhatsapp) continue;
    const c = porWhats.get(a.clienteWhatsapp) || { nome: a.clienteNome || '', visitas: 0, primeira: '', ultima: '' };
    if (a.status !== 'cancelado') c.visitas += 1;
    const quando = a.criadoEm || a.dataChave || '';
    if (!c.primeira || quando < c.primeira) c.primeira = quando;
    if (quando > c.ultima) { c.ultima = quando; c.nome = a.clienteNome || c.nome; }
    porWhats.set(a.clienteWhatsapp, c);
  }
  const clientes = negocioRef.collection('clientes');
  let mexeuClientes = 0;
  for (const [whats, c] of porWhats) {
    const lado = clientes.doc(`${profissionalId}__${whats}`);
    const base = clientes.doc(whats);
    if (ehSocio) {
      await lado.set({ nome: c.nome, whatsapp: whats, donoVe: false, totalAgendamentos: c.visitas, primeiraVisita: c.primeira, ultimoAgendamento: c.ultima });
      // a ficha do dono só continua se o cliente também foi atendido por alguém do lado do dono
      const outros = await negocioRef.collection('agendamentos').where('clienteWhatsapp', '==', whats).get();
      const doOutroLado = outros.docs.some((o) => o.data().profissionalId !== profissionalId && o.data().donoVe !== false);
      const baseSnap = await base.get();
      if (!doOutroLado && baseSnap.exists) await base.delete();
      else if (baseSnap.exists && baseSnap.data().donoVe !== false) await base.update({ totalAgendamentos: Math.max(0, (baseSnap.data().totalAgendamentos || 0) - c.visitas) });   // as visitas dele saem da conta do dono
    } else {
      const atual = (await base.get()).data();
      await base.set({
        nome: (atual && atual.nome) || c.nome, whatsapp: whats, donoVe: true,
        totalAgendamentos: ((atual && atual.totalAgendamentos) || 0) + c.visitas,
        primeiraVisita: (atual && atual.primeiraVisita) || c.primeira, ultimoAgendamento: (atual && atual.ultimoAgendamento > c.ultima ? atual.ultimoAgendamento : c.ultima)
      });
      if ((await lado.get()).exists) await lado.delete();
    }
    mexeuClientes++;
  }
  return { agendamentos: mudouAgs, clientes: mexeuClientes };
}

module.exports = { donoVePara, idCliente, reaplicarSocio };
