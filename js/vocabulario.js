// ========================================
// 77 AGENDAPRO — Vocabulário por tipo de negócio
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
    corAccent: '#d4ff3a'
  },
  salao: {
    estabelecimento: 'Salão',
    profissional: 'Cabeleireiro(a)',
    profissionalPlural: 'Cabeleireiros',
    servico: 'Serviço',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '💇',
    corAccent: '#d4ff3a'
  },
  estetica: {
    estabelecimento: 'Studio',
    profissional: 'Profissional',
    profissionalPlural: 'Profissionais',
    servico: 'Tratamento',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '✨',
    corAccent: '#d4ff3a'
  },
  nails: {
    estabelecimento: 'Studio',
    profissional: 'Nail Designer',
    profissionalPlural: 'Nail Designers',
    servico: 'Serviço',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '💅',
    corAccent: '#d4ff3a'
  },
  outro: {
    estabelecimento: 'Estabelecimento',
    profissional: 'Profissional',
    profissionalPlural: 'Profissionais',
    servico: 'Serviço',
    cliente: 'Cliente',
    agenda: 'Agenda',
    emoji: '📅',
    corAccent: '#d4ff3a'
  }
};

// Serviços sugeridos por tipo (usados no onboarding)
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
 * Retorna o vocabulário certo pro tipo de negócio
 * @param {string} tipo - tipoNegocio do Firebase (barbearia, salao, estetica, nails, outro)
 * @returns {object} vocabulário
 */
export function getVocab(tipo) {
  return VOCABULARIO[tipo] || VOCABULARIO.outro;
}
