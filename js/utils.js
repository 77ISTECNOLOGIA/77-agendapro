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
