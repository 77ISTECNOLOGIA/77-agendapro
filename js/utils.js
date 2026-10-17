// 77 AGENDAPRO — utilitários compartilhados

// Escapa texto antes de inserir via innerHTML (previne XSS armazenado)
export function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
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
  input.style.paddingRight = '48px';

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.textContent = '👁';
  botao.setAttribute('aria-label', 'Mostrar senha');
  botao.setAttribute('aria-pressed', 'false');
  botao.style.cssText = 'position:absolute;top:50%;right:8px;transform:translateY(-50%);background:none;border:0;cursor:pointer;font-size:18px;line-height:1;padding:6px 8px;color:inherit;opacity:.75;';

  botao.addEventListener('click', () => {
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    botao.textContent = mostrar ? '🙈' : '👁';
    botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    botao.setAttribute('aria-pressed', String(mostrar));
    input.focus();
  });

  caixa.appendChild(botao);
}
