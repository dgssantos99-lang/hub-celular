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
