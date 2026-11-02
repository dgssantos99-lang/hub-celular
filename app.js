import { acharChat, haQuanto, novoPedido, pcPresente, tamanhoLegivel, tipoDoArquivo } from './logica.js';

const SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const POLL_MS = 5000;

const tela = document.getElementById('tela');
const titulo = document.getElementById('titulo');
const voltar = document.getElementById('voltar');
const pcSelo = document.getElementById('pc');

const guardado = {
  ler(chave) {
    try { return localStorage.getItem(chave); } catch { return null; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: segue sem lembrar */ }
  },
};

let token = null;
let tokenAte = 0;
let pedidoDeToken = null;
let estado = null;
let ids = { entrada: null, estado: null };
let rota = { tipo: 'inicio' };
let aviso = '';
let pendentes = []; // messages sent from here that the PC has not shown yet
let timer = null;

// ---------- login (Google Identity Services)

function esperarGoogle() {
  return new Promise((resolve) => {
    const tentar = () => (window.google?.accounts?.oauth2 ? resolve() : setTimeout(tentar, 150));
    tentar();
  });
}

async function entrar(silencioso) {
  const clientId = guardado.ler('clientId');
  if (!clientId) throw new Error('Falta o ID do cliente do Google.');
  await esperarGoogle();
  return new Promise((resolve, reject) => {
    const cliente = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resposta) => {
        if (resposta.error) return reject(new Error(resposta.error_description || resposta.error));
        token = resposta.access_token;
        tokenAte = Date.now() + (Number(resposta.expires_in) - 60) * 1000;
        guardado.gravar('logado', '1');
        resolve();
      },
      error_callback: (erro) => reject(new Error(erro.message || 'Login cancelado.')),
    });
    cliente.requestAccessToken({ prompt: silencioso ? '' : 'consent' });
  });
}

async function garantirToken() {
  if (token && Date.now() < tokenAte) return;
  if (!pedidoDeToken) pedidoDeToken = entrar(guardado.ler('logado') === '1').finally(() => { pedidoDeToken = null; });
  await pedidoDeToken;
}

// ---------- Drive

async function drive(url, opcoes = {}) {
  await garantirToken();
  const resposta = await fetch(url, { ...opcoes, headers: { ...(opcoes.headers || {}), authorization: `Bearer ${token}` } });
  if (resposta.status === 401) { token = null; throw new Error('O login venceu. Toque em Entrar de novo.'); }
  if (!resposta.ok) throw new Error(`O Google respondeu ${resposta.status}.`);
  return resposta;
}

function aspas(texto) { return texto.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function acharPasta(nome, paiId) {
  const q = `name = '${aspas(nome)}' and mimeType = 'application/vnd.google-apps.folder' and '${paiId}' in parents and trashed = false`;
  const r = await (await drive(`${DRIVE}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`)).json();
  return r.files?.[0]?.id ?? null;
}

async function descobrirPonte() {
  if (ids.entrada && ids.estado) return true;
  let pai = 'root';
  for (const nome of ['Hub', 'Ponte']) {
    pai = await acharPasta(nome, pai);
    if (!pai) return false;
  }
  const entrada = await acharPasta('entrada', pai);
  const q = `name = 'estado.json' and '${pai}' in parents and trashed = false`;
  const r = await (await drive(`${DRIVE}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`)).json();
  ids = { entrada, estado: r.files?.[0]?.id ?? null };
  return Boolean(ids.entrada && ids.estado);
}

async function lerEstado() {
  if (!(await descobrirPonte())) throw new Error('Não achei a pasta Hub/Ponte. No PC, ligue "Deixar o celular usar este PC" no painel do Google Drive.');
  const r = await drive(`${DRIVE}/files/${ids.estado}?alt=media`, { cache: 'no-store' });
  return r.json();
}

async function enviarPedido(pedido) {
  if (!(await descobrirPonte())) throw new Error('A ponte do PC ainda não está pronta.');
  const limite = 'ponte' + Math.random().toString(36).slice(2);
  const corpo = [
    `--${limite}`, 'Content-Type: application/json; charset=UTF-8', '',
    JSON.stringify({ name: `${pedido.id}.json`, parents: [ids.entrada] }),
    `--${limite}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(pedido),
    `--${limite}--`,
  ].join('\r\n');
  await drive(`${UPLOAD}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${limite}` },
    body: corpo,
  });
}

async function baixar(driveId) {
  return (await drive(`${DRIVE}/files/${driveId}?alt=media`)).blob();
}

// ---------- tela

function el(tag, atributos = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos)) {
    if (chave === 'class') no.className = valor;
    else if (chave.startsWith('on')) no.addEventListener(chave.slice(2), valor);
    else if (valor !== false && valor !== null && valor !== undefined) no.setAttribute(chave, valor === true ? '' : valor);
  }
  for (const filho of filhos.flat()) if (filho !== null && filho !== undefined) no.append(filho);
  return no;
}

function ir(nova) {
  rota = nova;
  desenhar();
}

function desenhar() {
  const estavaNoFim = tela.scrollHeight - tela.scrollTop - tela.clientHeight < 80;
  const rascunho = document.getElementById('texto')?.value ?? '';
  tela.replaceChildren();
  voltar.hidden = rota.tipo === 'inicio' || rota.tipo === 'config';
  pcSelo.className = `pc ${estado ? (pcPresente(estado) ? 'on' : 'off') : ''}`;
  pcSelo.textContent = estado ? (pcPresente(estado) ? 'PC ligado' : `PC visto ${haQuanto(estado.atualizadoEm)}`) : '';
  if (aviso) tela.append(el('p', { class: 'erro' }, aviso));

  if (rota.tipo === 'config') return desenharConfig();
  if (!estado) return desenharEntrada();
  if (rota.tipo === 'inicio') return desenharInicio();
  if (rota.tipo === 'trabalho') return desenharTrabalho();
  if (rota.tipo === 'chat') return desenharChat(estavaNoFim, rascunho);
  if (rota.tipo === 'arquivos') return desenharArquivos();
}

function desenharConfig() {
  titulo.textContent = 'Primeiro acesso';
  const campo = el('input', { type: 'text', id: 'cliente', placeholder: 'ID do cliente (termina em .apps.googleusercontent.com)', value: guardado.ler('clientId') ?? '', autocomplete: 'off' });
  tela.append(
    el('p', {}, 'Cole aqui o ID do cliente Web criado no Google Cloud. Veja o passo a passo no arquivo LEIA-ME.md.'),
    campo,
    el('button', { class: 'botao', onclick: () => {
      const valor = campo.value.trim();
      if (!valor.includes('.apps.googleusercontent.com')) { aviso = 'Esse não parece um ID de cliente do Google.'; return desenhar(); }
      guardado.gravar('clientId', valor);
      aviso = '';
      ir({ tipo: 'inicio' });
      void carregar(false);
    } }, 'Salvar'),
  );
}

function desenharEntrada() {
  titulo.textContent = 'Hub';
  tela.append(
    el('div', { class: 'cartao' },
      el('p', {}, 'Entre com a mesma conta do Google que o Hub usa no PC.'),
      el('button', { class: 'botao', onclick: () => void carregar(false) }, 'Entrar com o Google'),
    ),
    el('button', { class: 'botao sec', onclick: () => ir({ tipo: 'config' }) }, 'Trocar o ID do cliente'),
  );
}

function desenharInicio() {
  titulo.textContent = 'Hub';
  voltar.hidden = true;
  if (estado.projetos.length === 0) tela.append(el('p', { class: 'suave' }, 'Nenhum projeto no Hub ainda.'));
  for (const projeto of estado.projetos) {
    tela.append(el('h2', {}, projeto.nome));
    for (const trabalho of projeto.trabalhos) {
      const ocupados = trabalho.chats.filter((chat) => chat.ocupado).length;
      tela.append(el('button', { class: 'linha', onclick: () => ir({ tipo: 'trabalho', projeto: projeto.id, trabalho: trabalho.id }) },
        el('span', { class: 'nome' }, trabalho.nome),
        ocupados ? el('span', { class: 'selo' }, `${ocupados} respondendo`) : el('small', {}, `${trabalho.chats.length} chats`),
      ));
    }
  }
}

function acharTrabalho() {
  const projeto = estado.projetos.find((item) => item.id === rota.projeto);
  return { projeto, trabalho: projeto?.trabalhos.find((item) => item.id === rota.trabalho) };
}

function desenharTrabalho() {
  const { projeto, trabalho } = acharTrabalho();
  if (!trabalho) return ir({ tipo: 'inicio' });
  titulo.textContent = `${projeto.nome} › ${trabalho.nome}`;
  tela.append(el('button', { class: 'linha', onclick: () => ir({ ...rota, tipo: 'arquivos' }) },
    el('span', { class: 'nome' }, 'Arquivos no Drive'), el('small', {}, `${trabalho.arquivos.length}`)));
  tela.append(el('h2', {}, 'Chats'));
  for (const chat of trabalho.chats) {
    const ultima = chat.mensagens.at(-1);
    tela.append(el('button', { class: 'linha', onclick: () => ir({ tipo: 'chat', projeto: projeto.id, trabalho: trabalho.id, chat: chat.id }) },
      el('span', { class: 'nome' }, chat.titulo, chat.cargo ? el('small', {}, ` · ${chat.cargo}`) : null,
        ultima ? el('small', { style: 'display:block;overflow:hidden;text-overflow:ellipsis' }, ultima.texto.replace(/\s+/g, ' ').slice(0, 70)) : null),
      chat.ocupado ? el('span', { class: 'selo' }, 'respondendo') : null,
    ));
  }
}

function desenharChat(estavaNoFim, rascunho) {
  const achado = acharChat(estado, rota.chat);
  if (!achado) return ir({ tipo: 'inicio' });
  const { chat } = achado;
  titulo.textContent = chat.titulo;
  const vistos = new Set(chat.mensagens.map((m) => m.texto.trim()));
  pendentes = pendentes.filter((p) => p.chat !== chat.id || !vistos.has(p.texto.trim()) );
  const conversa = el('div', { class: 'conversa' });
  for (const mensagem of chat.mensagens) conversa.append(el('div', { class: `balao ${mensagem.papel}` }, mensagem.texto));
  for (const p of pendentes.filter((item) => item.chat === chat.id)) {
    const resultado = estado.resultados?.[p.id];
    conversa.append(el('div', { class: 'balao user' }, p.texto, el('small', { class: resultado && !resultado.ok ? 'erro' : 'suave', style: 'display:block' },
      resultado ? (resultado.ok ? 'Entregue ao chat' : resultado.mensagem) : 'Esperando o PC…')));
  }
  if (chat.ocupado) conversa.append(el('div', { class: 'digitando' }, 'Respondendo…'));
  const caixa = el('textarea', { id: 'texto', rows: '1', placeholder: 'Escreva para o chat', 'aria-label': 'Mensagem' });
  caixa.value = rascunho;
  const enviar = el('button', { class: 'botao', onclick: async () => {
    const texto = caixa.value.trim();
    if (!texto) return;
    const pedido = novoPedido('mensagem', chat.id, texto);
    pendentes.push({ id: pedido.id, chat: chat.id, texto });
    caixa.value = '';
    desenhar();
    try { await enviarPedido(pedido); aviso = ''; } catch (erro) { aviso = erro.message; pendentes = pendentes.filter((p) => p.id !== pedido.id); desenhar(); }
  } }, 'Enviar');
  const parar = el('button', { class: 'botao sec', onclick: () => void enviarPedido(novoPedido('parar', chat.id)).catch((erro) => { aviso = erro.message; desenhar(); }) }, 'Parar');
  tela.append(conversa, el('div', { id: 'envio' }, caixa, chat.ocupado ? parar : enviar));
  if (estavaNoFim || !rascunho) tela.scrollTop = tela.scrollHeight;
}

function desenharArquivos() {
  const { trabalho } = acharTrabalho();
  if (!trabalho) return ir({ tipo: 'inicio' });
  titulo.textContent = 'Arquivos';
  if (trabalho.arquivos.length === 0) tela.append(el('p', { class: 'suave' }, 'Nenhum arquivo deste trabalho está no Drive.'));
  const previa = el('div', { class: 'previa' });
  for (const arquivo of trabalho.arquivos) {
    tela.append(el('button', { class: 'linha', onclick: () => void abrirArquivo(arquivo, previa) },
      el('span', { class: 'nome' }, arquivo.nome), el('small', {}, tamanhoLegivel(arquivo.tamanho))));
  }
  tela.append(previa);
}

async function abrirArquivo(arquivo, destino) {
  destino.replaceChildren(el('p', { class: 'suave' }, `Baixando ${arquivo.nome}…`));
  try {
    const blob = await baixar(arquivo.driveId);
    const url = URL.createObjectURL(blob);
    const tipo = tipoDoArquivo(arquivo.nome);
    const salvar = el('a', { class: 'botao sec', href: url, download: arquivo.nome, style: 'display:inline-block;text-decoration:none;margin-top:8px' }, 'Salvar no celular');
    let corpo;
    if (tipo === 'imagem') corpo = el('img', { src: url, alt: arquivo.nome });
    else if (tipo === 'audio') corpo = el('audio', { src: url, controls: true });
    else if (tipo === 'video') corpo = el('video', { src: url, controls: true, playsinline: true });
    else if (tipo === 'texto') corpo = el('pre', {}, (await blob.text()).slice(0, 20000));
    else corpo = el('p', {}, 'Sem prévia para este tipo de arquivo.');
    destino.replaceChildren(corpo, salvar);
  } catch (erro) {
    destino.replaceChildren(el('p', { class: 'erro' }, erro.message));
  }
}

// ---------- ciclo

async function carregar(silencioso) {
  try {
    await garantirToken();
    estado = await lerEstado();
    aviso = '';
  } catch (erro) {
    if (!silencioso) aviso = erro.message;
    else if (!estado) aviso = erro.message;
  }
  desenhar();
}

voltar.addEventListener('click', () => {
  if (rota.tipo === 'chat' || rota.tipo === 'arquivos') ir({ tipo: 'trabalho', projeto: rota.projeto, trabalho: rota.trabalho });
  else ir({ tipo: 'inicio' });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void carregar(true); });

if (!guardado.ler('clientId')) rota = { tipo: 'config' };
desenhar();
if (guardado.ler('clientId') && guardado.ler('logado') === '1') void carregar(true);
timer = setInterval(() => { if (!document.hidden && token) void carregar(true); }, POLL_MS);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => undefined);
void timer;
