// 77 AGENDAPRO — utilitários compartilhados

// Escapa texto antes de inserir via innerHTML (previne XSS armazenado)
export function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
