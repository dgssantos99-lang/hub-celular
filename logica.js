// Pure parts of the phone page: no browser needed, so they are tested on the PC.

/** A request for the PC, as the bridge reads it (src/core/ponte.ts, lerPedido). */
export function novoPedido(tipo, chatId, texto = '') {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return { id, tipo, chatId, texto, quando: new Date().toISOString() };
}

/** "agora", "há 5 min", "há 2 h" or "há 3 dias". */
export function haQuanto(iso, agora = Date.now()) {
  const seconds = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));
  if (seconds < 20) return 'agora';
  if (seconds < 3600) return `há ${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) return `há ${Math.round(seconds / 3600)} h`;
  return `há ${Math.round(seconds / 86400)} dias`;
}

/** The PC writes the state at least once a minute while it is there. */
export function pcPresente(estado, agora = Date.now()) {
  return Boolean(estado) && agora - new Date(estado.atualizadoEm).getTime() < 150_000;
}

/** What kind of preview a file gets. */
export function tipoDoArquivo(nome) {
  const ext = (nome.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'imagem';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
  if (['txt', 'md', 'json', 'srt', 'csv'].includes(ext)) return 'texto';
  return 'outro';
}

export function tamanhoLegivel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Finds a chat in the state, with its work and project. */
export function acharChat(estado, chatId) {
  for (const projeto of estado?.projetos ?? []) {
    for (const trabalho of projeto.trabalhos) {
      const chat = trabalho.chats.find((item) => item.id === chatId);
      if (chat) return { projeto, trabalho, chat };
    }
  }
  return null;
}

export const ICONES = {
  robo: '🤖', livro: '📚', camera: '🎥', microfone: '🎙️', lapis: '✏️', lampada: '💡', estrela: '⭐', coracao: '❤️',
  foguete: '🚀', balao: '🎈', escudo: '🛡️', pincel: '🎨', claquete: '🎬', nota: '🎵', globo: '🌍', cerebro: '🧠',
};
export const CORES = ['#4cb3f0', '#4cc38a', '#a78bfa', '#f0a04a', '#f472b6', '#f0d04a', '#ff7a8a', '#7dd3c0'];

/** "foguete|#4cb3f0" becomes the emoji and the colour; an empty or unknown value has neither. */
export function lerAvatar(avatar) {
  const [icone, cor] = String(avatar || '').split('|');
  return ICONES[icone] && CORES.includes(cor) ? { emoji: ICONES[icone], cor } : null;
}

export function montarAvatar(icone, cor) {
  return ICONES[icone] && CORES.includes(cor) ? `${icone}|${cor}` : '';
}

/** Initial letter for a chat without an icon. */
export function inicial(titulo) {
  return (String(titulo || '?').trim()[0] || '?').toUpperCase();
}

/** The PC saves times as ISO text, or as "AAAA-MM-DD HH:MM:SS" in UTC. */
export function lerData(texto) {
  if (!texto) return null;
  const limpo = String(texto).includes('T') ? String(texto) : `${String(texto).replace(' ', 'T')}Z`;
  const data = new Date(limpo);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function hora(texto) {
  const data = lerData(texto);
  return data ? data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
}

/** "Hoje", "Ontem" or the date, for the separators of a conversation. */
export function rotuloDia(texto, agora = new Date()) {
  const data = lerData(texto);
  if (!data) return '';
  const dia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diferenca = Math.round((dia(agora) - dia(data)) / 86_400_000);
  if (diferenca === 0) return 'Hoje';
  if (diferenca === 1) return 'Ontem';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: diferenca > 300 ? 'numeric' : undefined });
}

/** Last-message time for a list: the hour today, "Ontem", or the date. */
export function horaDaLista(texto, agora = new Date()) {
  const rotulo = rotuloDia(texto, agora);
  if (rotulo === 'Hoje') return hora(texto);
  if (rotulo === 'Ontem') return 'Ontem';
  const data = lerData(texto);
  return data ? data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
}

/**
 * Turns a message into blocks the page can draw without trusting its text:
 * paragraphs, lists and code blocks, with **bold**, *italic* and `code` inside the lines.
 */
export function lerTexto(texto) {
  const blocos = [];
  const linhas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  let paragrafo = [];
  let lista = null;
  const fecharParagrafo = () => { if (paragrafo.length) blocos.push({ tipo: 'paragrafo', partes: partesDaLinha(paragrafo.join('\n')) }); paragrafo = []; };
  const fecharLista = () => { if (lista) blocos.push(lista); lista = null; };
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (linha.trim().startsWith('```')) {
      fecharParagrafo(); fecharLista();
      const codigo = [];
      i++;
      while (i < linhas.length && !linhas[i].trim().startsWith('```')) codigo.push(linhas[i++]);
      blocos.push({ tipo: 'codigo', texto: codigo.join('\n') });
      continue;
    }
    const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(linha);
    if (item) {
      fecharParagrafo();
      const ordenada = /^\s*\d/.test(linha);
      if (!lista || lista.ordenada !== ordenada) { fecharLista(); lista = { tipo: 'lista', ordenada, itens: [] }; }
      lista.itens.push(partesDaLinha(item[1]));
      continue;
    }
    if (linha.trim() === '') { fecharParagrafo(); fecharLista(); continue; }
    fecharLista();
    paragrafo.push(linha);
  }
  fecharParagrafo(); fecharLista();
  return blocos;
}

/** Splits a line into plain, bold, italic and code pieces. */
export function partesDaLinha(linha) {
  const partes = [];
  const regra = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let fim = 0;
  for (const achado of linha.matchAll(regra)) {
    if (achado.index > fim) partes.push({ tipo: 'texto', texto: linha.slice(fim, achado.index) });
    const bruto = achado[0];
    if (bruto.startsWith('`')) partes.push({ tipo: 'codigo', texto: bruto.slice(1, -1) });
    else if (bruto.startsWith('**')) partes.push({ tipo: 'negrito', texto: bruto.slice(2, -2) });
    else partes.push({ tipo: 'italico', texto: bruto.slice(1, -1) });
    fim = achado.index + bruto.length;
  }
  if (fim < linha.length) partes.push({ tipo: 'texto', texto: linha.slice(fim) });
  return partes;
}

export const TEMAS = [
  { id: 'noite', nome: 'Noite', amostra: ['#0a111f', '#4cb3f0'] },
  { id: 'grafite', nome: 'Grafite', amostra: ['#16171a', '#b3b8c4'] },
  { id: 'oceano', nome: 'Oceano', amostra: ['#06222b', '#2dd4bf'] },
  { id: 'floresta', nome: 'Floresta', amostra: ['#0d1f16', '#7bd88f'] },
  { id: 'ameixa', nome: 'Ameixa', amostra: ['#1d1230', '#c4a1ff'] },
  { id: 'claro', nome: 'Claro', amostra: ['#f3f6fb', '#1a7fc4'] },
];

/** The text under a chat's name: "digitando…", or nothing. */
export function situacaoDoChat(chat) {
  return chat.ocupado ? 'respondendo…' : chat.cargo || 'online no PC';
}

/** "R$ 12,30" style amounts: the PC counts in dollars. */
export function dinheiro(valor) {
  return `US$ ${Number(valor || 0).toFixed(2)}`;
}
