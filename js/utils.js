// 77 AGENDAPRO — utilitários compartilhados

// Escapa texto antes de inserir via innerHTML (previne XSS armazenado)
export function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Ícones oferecidos na tela de cadastro do serviço (beleza, barbearia, estética, unhas...).
export const EMOJIS_SERVICO = ['✂️', '🪒', '💈', '💇', '🧔', '💆', '💅', '💄', '🪄', '👁️', '🎨', '💧', '🧴', '🧖', '✨', '🌿', '🪮', '🧼', '👑', '💎', '⭐', '🔥', '💪', '🦶', '🌸', '🧘', '🎁', '❤️', '🌟', '🪞'];

// Sugere o ícone a partir do nome do serviço ("Barba Completa" → 🪒). null = sem palpite.
// Ignora maiúsculas e acentos; a primeira regra que casar vence.
export function sugerirEmoji(nome) {
  const t = String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!t.trim()) return null;
  const regras = [
    [/\+|combo|pacote/, '💈'],
    [/barba|bigode|navalha/, '🪒'],
    [/sobrancelha|henna|design/, '🪄'],
    [/cilio|lash/, '👁️'],
    [/unha|manicure|pedicure|esmalt|\bgel\b|acrilic|nail/, '💅'],
    [/pigment|luzes|mecha|color|tintura|tinta|descolor|platin|pintura/, '🎨'],
    [/hidrata|cauteriz|reconstru|nutri|botox|umectac/, '💧'],
    [/escova|penteado|chapinha|progressiva|alisa|cacho|ondula|babyliss/, '💇'],
    [/massagem|relax|drenagem|limpeza de pele|shiatsu|reflexo/, '💆'],
    [/maquiagem|makeup|\bmake\b/, '💄'],
    [/depila|\bcera\b|laser|epila/, '✨'],
    [/\bspa\b|banho|vapor|sauna|esfolia|peeling/, '🧖'],
    [/corte|cabelo|degrade|navalhado|tesoura|franja/, '✂️']
  ];
  for (const [regra, emoji] of regras) if (regra.test(t)) return emoji;
  return null;
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
