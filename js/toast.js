// ========================================
// 77 AGENDAPRO — Avisos curtos (toast)
// ========================================
// Um só lugar para o painel do dono, o link do cliente e o painel interno da 77 IS. O visual está em css/style.css
// (.toast): cartão escuro com ícone, barra de tempo e animação de entrada. Tipos: 'sucesso', 'erro' ou '' (informação).
// Erros ficam mais tempo na tela (a pessoa precisa ler); tocar no aviso fecha na hora; um aviso novo substitui o
// anterior sem que o relógio do antigo o esconda antes da hora.

let relogio = null;
let escondendo = null;

export function esconderToast() {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(relogio);
  el.classList.remove('ativo');
  clearTimeout(escondendo);
  escondendo = setTimeout(() => el.classList.add('hidden'), 320);
}

export function toast(msg, tipo = '') {
  const el = document.getElementById('toast');
  const texto = document.getElementById('toast-msg');
  if (!el || !texto) return;
  clearTimeout(relogio);
  clearTimeout(escondendo);

  const duracao = tipo === 'erro' ? 5500 : 3200;
  texto.textContent = msg;
  el.className = 'toast' + (tipo ? ' ' + tipo : '');           // recomeça do zero (tira "hidden" e "ativo")
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.style.setProperty('--toast-dur', duracao + 'ms');
  void el.offsetWidth;                                         // força o navegador a registrar o estado inicial: a animação roda de novo
  el.classList.add('ativo');
  el.onclick = esconderToast;
  relogio = setTimeout(esconderToast, duracao);
}
