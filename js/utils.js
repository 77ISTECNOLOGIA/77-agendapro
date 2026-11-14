// 77 AGENDAPRO — utilitários compartilhados

// Escapa texto antes de inserir via innerHTML (previne XSS armazenado)
export function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Foto do serviço: só aceitamos JPEG em "data URL" (gerado pelo próprio painel) e de tamanho
// limitado. Qualquer outra coisa (svg, html, link externo, javascript:) é descartada, porque
// o valor vai parar num <img src>. O servidor aplica a MESMA regra (api/_lib/negocio.js).
export function fotoServicoValida(foto) {
  return typeof foto === 'string' && foto.length <= 150000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(foto);
}

// ---- Botão "Ver no mapa" (link do cliente e teste nas Configurações). Mesma regra de api/_lib/endereco.js. ----
// Busca pelo CEP + cidade (acerta a rua; o endereço por extenso erra quando há ruas de mesmo nome na cidade).
// CEP terminado em -000 é de localidade (cidade inteira): nesse caso vale o endereço.
export function consultaMapa(detalhe, enderecoCompleto) {
  const d = detalhe || {};
  const cep = String(d.cep || '');
  if (/^\d{5}-\d{3}$/.test(cep) && !cep.endsWith('-000') && d.cidade && d.uf) return cep + ', ' + d.cidade + ' - ' + d.uf;
  return String(enderecoCompleto || '').trim();
}

// Só links do Google Maps (https) são aceitos; qualquer outra coisa é ignorada (o valor vira um href).
export function linkMapaValido(link) {
  try {
    const u = new URL(String(link || ''));
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password && (h === 'maps.app.goo.gl'
      || ((h === 'google.com' || h === 'www.google.com' || h === 'maps.google.com' || h === 'goo.gl') && u.pathname.startsWith('/maps')));
  } catch (_) { return false; }
}

// Endereço do botão: o link exato do dono (se houver) ou a busca no Google Maps. '' = sem botão.
export function urlMapa(linkMapa, consulta) {
  if (linkMapaValido(linkMapa)) return String(linkMapa);
  const q = String(consulta || '').trim();
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
}

// iPhone/iPad (inclui iPad que se apresenta como Mac). Lá o link do Google Maps tenta abrir o APLICATIVO Google Maps e,
// se ele não estiver instalado, o Safari mostra "não pode abrir a página porque o endereço é inválido".
export function ehAppleMobile(nav) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : {});
  const ua = String(n.userAgent || '');
  return /iPad|iPhone|iPod/.test(ua) || (n.platform === 'MacIntel' && Number(n.maxTouchPoints) > 1);
}

// Apple Maps abre direto no aplicativo nativo do iPhone (sempre instalado). Busca pelo endereço completo (com CEP).
export function urlAppleMaps(enderecoCompleto) {
  const q = String(enderecoCompleto || '').trim();
  return q ? 'https://maps.apple.com/?q=' + encodeURIComponent(q) : '';
}

// ---- Intervalo (almoço) no horário de funcionamento. Mesma regra de api/_lib/disponibilidade.js. ----
// Cada dia pode ter `pausaInicio`/`pausaFim` ("12:00"/"13:00"). Vale o intervalo PRÓPRIO do profissional naquele dia; se ele
// não tiver, vale o do estabelecimento. Intervalo inválido (falta um horário, ou o fim não é depois do início) é ignorado.
function horaEmMinutos(h) { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; }
function pausaValida(e) {
  return !!e && /^\d{2}:\d{2}$/.test(e.pausaInicio || '') && /^\d{2}:\d{2}$/.test(e.pausaFim || '')
    && horaEmMinutos(e.pausaFim) > horaEmMinutos(e.pausaInicio);
}
export function pausaDoDia(expedienteProfissional, expedienteNegocio) {
  const fonte = pausaValida(expedienteProfissional) ? expedienteProfissional : (pausaValida(expedienteNegocio) ? expedienteNegocio : null);
  return fonte ? { ini: horaEmMinutos(fonte.pausaInicio), fim: horaEmMinutos(fonte.pausaFim) } : null;
}

// Confere o intervalo digitado nas telas de horário. Devolve '' se está tudo certo, ou a mensagem para a pessoa.
export function validarPausaDia(dia) {
  if (!dia.pausaInicio && !dia.pausaFim) return '';
  if (!/^\d{2}:\d{2}$/.test(dia.pausaInicio || '') || !/^\d{2}:\d{2}$/.test(dia.pausaFim || '')) return 'Preencha o início e o fim do intervalo.';
  if (horaEmMinutos(dia.pausaFim) <= horaEmMinutos(dia.pausaInicio)) return 'O fim do intervalo precisa ser depois do início.';
  if (dia.ativo && (horaEmMinutos(dia.pausaInicio) < horaEmMinutos(dia.inicio) || horaEmMinutos(dia.pausaFim) > horaEmMinutos(dia.fim))) {
    return 'O intervalo precisa ficar dentro do horário de trabalho do dia.';
  }
  return '';
}

// Serviço com `profissionaisIds` preenchido só é feito por esses profissionais;
// lista ausente/vazia = QUALQUER um (padrão, e é o que vale pros serviços
// antigos). Mesma regra do servidor (api/_lib/negocio.js).
export function profissionalRealizaServico(servico, profissionalId) {
  const ids = servico && servico.profissionaisIds;
  return !Array.isArray(ids) || ids.length === 0 || ids.includes(profissionalId);
}

// Cadastro do profissional: calcula como ficam os serviços quando se marca/desmarca
// "quais serviços ele realiza". O vínculo mora no SERVIÇO (profissionaisIds), então
// aqui só se descobre quais serviços precisam mudar. Devolve { alteracoes, erro }.
//  - servicos: { id: { nome, profissionaisIds } }
//  - profissionaisAtivosIds: ativos DEPOIS do salvar (inclui este, se ficar ativo)
//  - marcadosIds: serviços marcados no formulário
// Nunca deixa um serviço sem ninguém que o realize (lista vazia significaria
// "todos", o oposto do que foi pedido) e normaliza pra [] quando todos os
// ativos fazem — assim um profissional novo entra sozinho no que é livre.
export function calcularVinculosProfissional({ servicos, profissionaisAtivosIds, profissionalId, marcadosIds }) {
  const alteracoes = [];
  const ativos = profissionaisAtivosIds || [];

  for (const [servicoId, s] of Object.entries(servicos || {})) {
    const ids = Array.isArray(s.profissionaisIds) ? s.profissionaisIds : [];
    const fazAntes = ids.length === 0 || ids.includes(profissionalId);
    const marcado = (marcadosIds || []).includes(servicoId);
    if (marcado === fazAntes) continue;

    let novos;
    if (marcado) {
      novos = [...ids, profissionalId];
      if (ativos.every((pid) => novos.includes(pid))) novos = [];
    } else {
      const outros = ativos.filter((pid) => pid !== profissionalId);
      const restantes = ids.length === 0 ? outros : ids.filter((pid) => pid !== profissionalId);
      if (!restantes.some((pid) => ativos.includes(pid))) {
        return { alteracoes: [], erro: outros.length === 0
          ? `"${s.nome}" ficaria sem ninguém para realizá-lo, pois este é o único profissional ativo. Para tirar o serviço do ar, desative-o na aba Serviços.`
          : `Nenhum outro profissional realiza "${s.nome}". Marque outro profissional nesse serviço antes de desmarcá-lo aqui.` };
      }
      novos = restantes;
    }
    alteracoes.push({ servicoId, profissionaisIds: novos });
  }
  return { alteracoes, erro: null };
}

// Coloca um botão "mostrar/ocultar senha" dentro do campo de senha.
// Evita o erro clássico de digitar às cegas (e de o gerenciador de senhas do
// navegador preencher a senha antiga sem a pessoa perceber).
export function adicionarMostrarSenha(input) {
  if (!input || input.dataset.mostrarSenha) return;
  input.dataset.mostrarSenha = '1';

  const caixa = document.createElement('div');
  caixa.style.cssText = 'position:relative;display:block;';
  input.parentNode.insertBefore(caixa, input);
  caixa.appendChild(input);
  input.style.paddingRight = '86px';

  // Botão de TEXTO (não emoji/ícone fino) na cor de destaque do tema, pra ser
  // bem visível no fundo escuro. As cores vêm das variáveis CSS do tema, com
  // fallback caso a página não as defina.
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.textContent = 'Mostrar';
  botao.setAttribute('aria-label', 'Mostrar senha');
  botao.setAttribute('aria-pressed', 'false');
  botao.style.cssText = 'position:absolute;top:50%;right:8px;transform:translateY(-50%);background:var(--surface-2,#1c1c1c);border:1px solid var(--border-light,#333);border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;line-height:1;font-family:inherit;letter-spacing:.3px;padding:7px 10px;color:var(--accent,#d4ff3a);';

  botao.addEventListener('click', () => {
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    botao.textContent = mostrar ? 'Ocultar' : 'Mostrar';
    botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    botao.setAttribute('aria-pressed', String(mostrar));
    input.focus();
  });

  caixa.appendChild(botao);
}

// Atendimentos "esquecidos": ainda como confirmado, mas o horário previsto de término
// (horário + duração) já passou há mais de `margemMin` minutos. O dono precisa concluir
// (vira faturamento) ou cancelar (cliente faltou). Devolve do mais antigo para o mais novo.
export function atendimentosParaResolver(agendamentos, agora = new Date(), margemMin = 30) {
  const lista = [];
  Object.entries(agendamentos || {}).forEach(([id, a]) => {
    if (!a || a.status !== 'confirmado') return;
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a.dataChave || '');
    const h = /^(\d{2}):(\d{2})$/.exec(a.horario || '');
    if (!d || !h) return;
    const inicio = new Date(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]);
    const fim = new Date(inicio.getTime() + (Number(a.duracaoMin) || 30) * 60000);
    if (agora.getTime() >= fim.getTime() + margemMin * 60000) lista.push({ ...a, id, _inicio: inicio.getTime() });
  });
  return lista.sort((x, y) => x._inicio - y._inicio);
}

function chaveData(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Períodos prontos da tela Relatórios. Devolve { de, ate } como 'AAAA-MM-DD'.
export function periodoPronto(nome, hoje = new Date()) {
  const a = hoje.getFullYear(), m = hoje.getMonth();
  if (nome === 'mes-passado') return { de: chaveData(new Date(a, m - 1, 1)), ate: chaveData(new Date(a, m, 0)) };
  if (nome === '30dias') return { de: chaveData(new Date(a, m, hoje.getDate() - 29)), ate: chaveData(hoje) };
  if (nome === 'ano') return { de: chaveData(new Date(a, 0, 1)), ate: chaveData(hoje) };
  return { de: chaveData(new Date(a, m, 1)), ate: chaveData(new Date(a, m + 1, 0)) }; // este mês
}

// Resumo do período (datas inclusive). Só atendimentos CONCLUÍDOS contam como faturamento/serviço realizado.
export function resumoPeriodo(agendamentos, de, ate) {
  const r = { faturamento: 0, atendimentos: 0, clientes: 0, ticket: 0, cancelados: 0, faltas: 0, pendentes: 0, servicos: [], profissionais: [] };
  const servicos = {}, profs = {}, clientes = new Set();
  Object.values(agendamentos || {}).forEach((a) => {
    if (!a || !a.dataChave || a.dataChave < de || a.dataChave > ate) return;
    if (a.status === 'cancelado') { r.cancelados++; if (a.motivoCancelamento === 'nao-compareceu') r.faltas++; return; }
    if (a.status === 'confirmado' || a.status === 'aguardando_sinal' || a.status === 'sinal_informado') { r.pendentes++; return; }
    if (a.status !== 'concluido') return;
    r.atendimentos++;
    r.faturamento += Number(a.valorTotal) || 0;
    clientes.add(a.clienteWhatsapp || a.clienteNome);
    const nomeProf = a.profissionalNome || '—';
    profs[nomeProf] = profs[nomeProf] || { nome: nomeProf, qtd: 0, valor: 0 };
    profs[nomeProf].qtd++; profs[nomeProf].valor += Number(a.valorTotal) || 0;
    (a.servicos || []).forEach((s) => {
      servicos[s.nome] = servicos[s.nome] || { nome: s.nome, qtd: 0, valor: 0 };
      servicos[s.nome].qtd++; servicos[s.nome].valor += Number(s.preco) || 0;
    });
  });
  r.clientes = clientes.size;
  r.ticket = r.atendimentos ? r.faturamento / r.atendimentos : 0;
  r.servicos = Object.values(servicos).sort((x, y) => y.qtd - x.qtd || y.valor - x.valor);
  r.profissionais = Object.values(profs).sort((x, y) => y.valor - x.valor);
  return r;
}

// ========================================
// EQUIPE: permissões (MESMA regra de api/_lib/equipe.js e firestore.rules; teste confere)
// ========================================
// verTodos     → vê agenda, clientes e faturamento de todos os profissionais
// gerirNegocio → edita dados do negócio, serviços, Pix e equipe
// Conta antiga (role 'owner' sem "permissoes") tem as duas.
export function permissoesDe(usuario) {
  if (!usuario || typeof usuario !== 'object') return { verTodos: false, gerirNegocio: false };
  if (usuario.permissoes && typeof usuario.permissoes === 'object') {
    return { verTodos: usuario.permissoes.verTodos === true, gerirNegocio: usuario.permissoes.gerirNegocio === true };
  }
  const papel = usuario.role === undefined ? 'owner' : usuario.role;
  return papel === 'owner' ? { verTodos: true, gerirNegocio: true } : { verTodos: false, gerirNegocio: false };
}

/** Clientes de quem só enxerga o próprio profissional: montados a partir dos PRÓPRIOS agendamentos (a coleção `clientes` é só de quem vê tudo). */
export function clientesDosAgendamentos(agendamentos) {
  const mapa = {};
  Object.values(agendamentos || {}).forEach((a) => {
    if (!a || !a.clienteWhatsapp || a.status === 'cancelado') return;
    const c = mapa[a.clienteWhatsapp] || (mapa[a.clienteWhatsapp] = { nome: a.clienteNome || '', whatsapp: a.clienteWhatsapp, totalAgendamentos: 0, ultimoAgendamento: '' });
    c.totalAgendamentos += 1;
    const quando = a.dataChave || '';
    if (quando >= c.ultimoAgendamento) { c.ultimoAgendamento = quando; c.nome = a.clienteNome || c.nome; }
  });
  return mapa;
}
