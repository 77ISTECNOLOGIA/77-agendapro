// ========================================
// 77 AGENDAPRO — Vocabulário e Tema por tipo de negócio
// Importar nos arquivos: app.js e admin.js
// ========================================

export const VOCABULARIO = {
  barbearia: {
    estabelecimento: 'Barbearia',
    profissional: 'Barbeiro',
    profissionalPlural: 'Barbeiros',
    servico: 'Serviço',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '💈',
    corAccent: '#0077FF',
    corAccentDark: '#0062D1',
    corAccentGlow: 'rgba(0, 119, 255, 0.3)'
  },
  salao: {
    estabelecimento: 'Salão',
    profissional: 'Cabeleireiro(a)',
    profissionalPlural: 'Cabeleireiros',
    servico: 'Serviço',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '💇',
    corAccent: '#ff6b9d',
    corAccentDark: '#e8487f',
    corAccentGlow: 'rgba(255, 107, 157, 0.2)'
  },
  estetica: {
    estabelecimento: 'Studio',
    profissional: 'Profissional',
    profissionalPlural: 'Profissionais',
    servico: 'Tratamento',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '✨',
    corAccent: '#b9a3e3',
    corAccentDark: '#9d7fd1',
    corAccentGlow: 'rgba(185, 163, 227, 0.2)'
  },
  nails: {
    estabelecimento: 'Studio',
    profissional: 'Nail Designer',
    profissionalPlural: 'Nail Designers',
    servico: 'Serviço',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '💅',
    corAccent: '#ff7a59',
    corAccentDark: '#e85f3f',
    corAccentGlow: 'rgba(255, 122, 89, 0.2)'
  },
  outro: {
    estabelecimento: 'Estabelecimento',
    profissional: 'Profissional',
    profissionalPlural: 'Profissionais',
    servico: 'Serviço',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '📅',
    corAccent: '#0077FF',
    corAccentDark: '#0062D1',
    corAccentGlow: 'rgba(0, 119, 255, 0.3)'
  }
};

// Serviços sugeridos por tipo (usados no cadastro/onboarding)
export const SERVICOS_SUGERIDOS = {
  barbearia: [
    { nome: 'Corte Masculino',    duracaoMin: 30, preco: 40,  emoji: '✂️' },
    { nome: 'Barba Completa',     duracaoMin: 25, preco: 35,  emoji: '🪒' },
    { nome: 'Sobrancelha',        duracaoMin: 15, preco: 20,  emoji: '💆' },
    { nome: 'Corte + Pigmentação',duracaoMin: 45, preco: 65,  emoji: '💈' }
  ],
  salao: [
    { nome: 'Corte Feminino',     duracaoMin: 60,  preco: 80,  emoji: '✂️' },
    { nome: 'Escova Progressiva', duracaoMin: 120, preco: 180, emoji: '💆' },
    { nome: 'Coloração / Mechas', duracaoMin: 150, preco: 220, emoji: '🎨' },
    { nome: 'Hidratação Capilar', duracaoMin: 60,  preco: 90,  emoji: '💧' },
    { nome: 'Escova + Penteado',  duracaoMin: 60,  preco: 70,  emoji: '✨' }
  ],
  estetica: [
    { nome: 'Cílios Fio a Fio',       duracaoMin: 120, preco: 180, emoji: '👁️' },
    { nome: 'Volume Russo (Cílios)',   duracaoMin: 150, preco: 220, emoji: '👁️' },
    { nome: 'Manutenção de Cílios',    duracaoMin: 60,  preco: 100, emoji: '👁️' },
    { nome: 'Design de Sobrancelha',   duracaoMin: 45,  preco: 60,  emoji: '🪄' },
    { nome: 'Henna de Sobrancelha',    duracaoMin: 60,  preco: 80,  emoji: '🎨' },
    { nome: 'Unhas em Gel',            duracaoMin: 120, preco: 130, emoji: '💅' }
  ],
  nails: [
    { nome: 'Unhas em Gel',       duracaoMin: 120, preco: 130, emoji: '💅' },
    { nome: 'Unhas de Acrílico',  duracaoMin: 150, preco: 150, emoji: '✨' },
    { nome: 'Esmaltação Simples', duracaoMin: 45,  preco: 40,  emoji: '💅' },
    { nome: 'Nail Art',           duracaoMin: 90,  preco: 90,  emoji: '🎨' },
    { nome: 'Manutenção de Gel',  duracaoMin: 60,  preco: 80,  emoji: '💅' }
  ],
  outro: [
    { nome: 'Atendimento padrão', duracaoMin: 60, preco: 80, emoji: '⭐' }
  ]
};

/**
 * Retorna o vocabulário e tema certo pro tipo de negócio
 * @param {string} tipo - tipoNegocio do Firebase (barbearia, salao, estetica, nails, outro)
 * @returns {object} vocabulário + cores
 */
export function getVocab(tipo) {
  return VOCABULARIO[tipo] || VOCABULARIO.outro;
}

/**
 * Aplica o tema de cor dinamicamente na página, sobrescrevendo
 * as variáveis CSS --accent, --accent-dark e --accent-glow.
 * Também atualiza o favicon (ícone da aba do navegador) pra acompanhar a cor do tema.
 * Chame essa função assim que os dados da barbearia/negócio forem carregados.
 * @param {string} tipo - tipoNegocio do Firebase
 */
export function aplicarTema(tipo) {
  const vocab = getVocab(tipo);
  const root = document.documentElement;
  root.style.setProperty('--accent', vocab.corAccent);
  root.style.setProperty('--accent-dark', vocab.corAccentDark);
  root.style.setProperty('--accent-glow', vocab.corAccentGlow);
  root.style.setProperty('--on-accent', textoSobre(vocab.corAccent));
  aplicarFavicon(vocab.corAccent);
}

/**
 * Restaura o tema visual padrão da 77 IS (verde-limão institucional),
 * removendo qualquer cor de segmento aplicada anteriormente.
 * Use na tela de login do admin, ou em qualquer tela que não pertença
 * a um negócio específico ainda.
 */
export function resetarTema() {
  const root = document.documentElement;
  root.style.setProperty('--accent', '#fb6464');
  root.style.setProperty('--accent-dark', '#e84d4d');
  root.style.setProperty('--accent-glow', 'rgba(251, 100, 100, 0.2)');
  root.style.setProperty('--on-accent', '#0a0a0a');
  aplicarFavicon('#fb6464');
}

/**
 * Aplica o favicon oficial da 77 IS (símbolo "77" azul/branco), igual em qualquer tema de negócio.
 * Substitui o conteúdo do <link rel="icon"> independente do que estava no HTML.
 * @param {string} cor - cor hexadecimal do accent (ex: '#ff6b9d')
 */
function aplicarFavicon() {
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = '/img/favicon-32.png';
}

/** Cor de texto (branco ou quase preto) que fica legível sobre a cor de destaque do tema. */
function textoSobre(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.35 ? '#0a0a0a' : '#ffffff';
}
