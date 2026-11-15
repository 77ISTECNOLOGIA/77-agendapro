// Migração para os PAPÉIS da equipe (Dono / Sócio / Funcionário) — idempotente.
// Uso (só mostra o que faria):  node scripts/migrar-papeis.js
// Uso (aplica):                 node scripts/migrar-papeis.js --aplicar        (requer scripts/serviceAccountKey.json)
//
// O que faz, por negócio:
//  - cada usuário sem `papel` recebe um: conta com tudo = dono; qualquer outra conta antiga = sócio (já tinha autonomia);
//    sócio fica com permissoes {verTodos:false, gerirNegocio:false} (a configuração do estabelecimento é só do dono);
//  - o profissional de cada sócio ganha `socio: true`, e a config privada dele (profissionais/{id}/privado/config) recebe
//    sinal {modo:'desativado'} (sócio começa sem cobrar) — se ainda não tiver sinal definido;
//  - Pix que estava no documento do profissional (`pix`) vai para a config privada e sai do documento (o dono lê esse documento);
//  - dono de negócio que já tem mais de um login ganha `equipeAtiva: true` (a aba Equipe já aparece para ele).
// Não apaga nenhum agendamento, serviço ou cliente.

const path = require('path');
const admin = require('firebase-admin');
const aplicar = process.argv.includes('--aplicar');
const app = admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, 'serviceAccountKey.json'))) });
const db = admin.firestore(app);
const { FieldValue } = admin.firestore;

const TOTAL = { verTodos: true, gerirNegocio: true };
const NADA = { verTodos: false, gerirNegocio: false };
const permissoesDe = (u) => (u.permissoes && typeof u.permissoes === 'object')
  ? { verTodos: u.permissoes.verTodos === true, gerirNegocio: u.permissoes.gerirNegocio === true }
  : ((u.role === undefined || u.role === 'owner') ? TOTAL : NADA);

(async () => {
  console.log(aplicar ? 'APLICANDO a migração de papéis\n' : 'SIMULAÇÃO (nada será gravado). Use --aplicar para gravar.\n');
  const usuarios = await db.collection('usuarios').get();
  const porNegocio = {};
  usuarios.docs.forEach((d) => { (porNegocio[d.data().barbeariaId] = porNegocio[d.data().barbeariaId] || []).push({ uid: d.id, ref: d.ref, ...d.data() }); });
  let mudancas = 0;
  const fazer = async (descricao, fn) => { mudancas++; console.log('  • ' + descricao); if (aplicar) await fn(); };

  for (const [slug, membros] of Object.entries(porNegocio)) {
    console.log(`== ${slug}: ${membros.length} login(s)`);
    for (const u of membros) {
      const p = permissoesDe(u);
      const papel = ['dono', 'socio', 'funcionario'].includes(u.papel) ? u.papel : (p.verTodos && p.gerirNegocio ? 'dono' : 'socio');
      const ajustes = {};
      if (u.papel !== papel) ajustes.papel = papel;
      if (papel !== 'dono' && (p.verTodos || p.gerirNegocio)) ajustes.permissoes = NADA;
      if (papel === 'dono' && membros.length > 1 && u.equipeAtiva === undefined) ajustes.equipeAtiva = true;
      if (Object.keys(ajustes).length) await fazer(`${u.email}: ${JSON.stringify(ajustes)}`, () => u.ref.update(ajustes));

      if (papel === 'socio' && u.profissionalId) {
        const profRef = db.collection('barbearias').doc(slug).collection('profissionais').doc(u.profissionalId);
        const profSnap = await profRef.get();
        if (!profSnap.exists) { console.log(`  ! ${u.email}: profissional ${u.profissionalId} não existe`); continue; }
        const cfgRef = profRef.collection('privado').doc('config');
        const cfg = (await cfgRef.get()).data() || {};
        const novoCfg = { ...cfg };
        if (!novoCfg.sinal) novoCfg.sinal = { modo: 'desativado' };
        if (profSnap.data().pix && !novoCfg.pix) novoCfg.pix = profSnap.data().pix;
        if (JSON.stringify(novoCfg) !== JSON.stringify(cfg)) await fazer(`${u.email}: config privada → ${JSON.stringify({ sinal: novoCfg.sinal, pix: novoCfg.pix ? 'sim' : 'não' })}`, () => cfgRef.set(novoCfg));
        const marca = {};
        if (profSnap.data().socio !== true) marca.socio = true;
        if (profSnap.data().pix !== undefined) marca.pix = FieldValue.delete();
        if (Object.keys(marca).length) await fazer(`${u.email}: profissional marcado como de sócio${marca.pix ? ' (Pix sai do documento público)' : ''}`, () => profRef.update(marca));
      }
    }
    // Pix antigo de profissionais que NÃO são de sócio também vai para a config privada
    const profs = await db.collection('barbearias').doc(slug).collection('profissionais').get();
    for (const pr of profs.docs) {
      if (pr.data().pix === undefined) continue;
      const socio = membros.some((m) => m.profissionalId === pr.id && (['socio'].includes(m.papel) || (!m.papel && !(permissoesDe(m).verTodos && permissoesDe(m).gerirNegocio))));
      if (socio) continue;                                    // já tratado acima
      const cfgRef = pr.ref.collection('privado').doc('config');
      const cfg = (await cfgRef.get()).data() || {};
      await fazer(`profissional ${pr.data().nome}: Pix → config privada`, async () => {
        await cfgRef.set({ ...cfg, ...(cfg.pix ? {} : { pix: pr.data().pix }) });
        await pr.ref.update({ pix: FieldValue.delete() });
      });
    }
  }
  console.log(`\n${mudancas} alteração(ões) ${aplicar ? 'gravada(s)' : 'a fazer'}.`);
  process.exit(0);
})().catch((e) => { console.error('falhou:', e.message); process.exit(1); });
