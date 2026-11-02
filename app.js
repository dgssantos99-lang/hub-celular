import { CORES, ICONES, acharChat, haQuanto, inicial, lerAvatar, montarAvatar, novoPedido, pcPresente, tamanhoLegivel, tipoDoArquivo } from './logica.js';

const SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const POLL_MS = 5000;
const POLL_RAPIDO_MS = 2000;

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
  apagar(chave) {
    try { localStorage.removeItem(chave); } catch { /* idem */ }
  },
};

let token = guardado.ler('token');
let tokenAte = Number(guardado.ler('tokenAte') || 0);
let pedidoDeToken = null;
let precisaEntrar = false;
let estado = null;
let ids = { entrada: null, estado: null };
let rota = { tipo: 'inicio' };
let aviso = '';
let folha = null; // the open creation sheet
let pendentes = []; // messages sent from here that the PC has not shown yet
let rapidoAte = 0;
let carregando = false;

// ---------- login (Google Identity Services)

function esperarGoogle() {
  return new Promise((resolve) => {
    const tentar = () => (window.google?.accounts?.oauth2 ? resolve() : setTimeout(tentar, 150));
    tentar();
  });
}

function pedirToken(prompt) {
  const clientId = guardado.ler('clientId');
  if (!clientId) return Promise.reject(new Error('Falta o ID do cliente do Google.'));
  return esperarGoogle().then(() => new Promise((resolve, reject) => {
    const cliente = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resposta) => {
        if (resposta.error) return reject(new Error(resposta.error_description || resposta.error));
        token = resposta.access_token;
        tokenAte = Date.now() + (Number(resposta.expires_in) - 120) * 1000;
        guardado.gravar('token', token);
        guardado.gravar('tokenAte', String(tokenAte));
        guardado.gravar('logado', '1');
        precisaEntrar = false;
        resolve();
      },
      error_callback: (erro) => reject(new Error(erro.message || erro.type || 'Login cancelado.')),
    });
    cliente.requestAccessToken({ prompt });
  }));
}

/** The token lives for an hour. It is kept on the phone, so reloading the page does not ask for the login again. */
async function garantirToken() {
  if (token && Date.now() < tokenAte) return;
  if (!pedidoDeToken) {
    // Without a tap the browser may refuse to open the Google window; then the button "Continuar" asks with a tap.
    pedidoDeToken = pedirToken(guardado.ler('logado') === '1' ? '' : 'consent')
      .catch((erro) => { precisaEntrar = true; throw erro; })
      .finally(() => { pedidoDeToken = null; });
  }
  await pedidoDeToken;
}

// ---------- Drive

async function drive(url, opcoes = {}) {
  await garantirToken();
  const resposta = await fetch(url, { ...opcoes, headers: { ...(opcoes.headers || {}), authorization: `Bearer ${token}` } });
  if (resposta.status === 401) {
    token = null;
    guardado.apagar('token');
    precisaEntrar = true;
    throw new Error('O login venceu. Toque em Continuar.');
  }
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
  rapidoAte = Date.now() + 40_000;
}

async function baixar(driveId) {
  return (await drive(`${DRIVE}/files/${driveId}?alt=media`)).blob();
}

// ---------- pedaços de tela

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
  folha = null;
  desenhar();
}

function selo(chat, grande) {
  const avatar = lerAvatar(chat.avatar);
  const no = el('span', { class: `selo-chat${grande ? ' grande' : ''}`, 'aria-hidden': 'true' }, avatar ? avatar.emoji : inicial(chat.titulo));
  if (avatar) no.style.background = `${avatar.cor}33`;
  return no;
}

function botaoMais(texto, aoClicar) {
  return el('button', { class: 'novo', onclick: aoClicar }, el('span', { 'aria-hidden': 'true' }, '+'), texto);
}

function pedir(pedido, textoDeAviso) {
  return enviarPedido(pedido).then(() => {
    aviso = '';
    pendentes.push({ id: pedido.id, texto: textoDeAviso });
    folha = null;
    desenhar();
  }).catch((erro) => { aviso = erro.message; desenhar(); });
}

// ---------- folhas de criação

function folhaProjeto() {
  const nome = el('input', { type: 'text', id: 'nome', placeholder: 'Nome do projeto', autocomplete: 'off', maxlength: '120' });
  return { titulo: 'Novo projeto', corpo: [nome], confirmar: 'Criar projeto', ao: () => {
    if (!nome.value.trim()) return;
    void pedir({ ...novoPedido('criarProjeto', 0), nome: nome.value.trim() }, `Criando o projeto "${nome.value.trim()}"…`);
  }, foco: nome };
}

function folhaTrabalho(projeto) {
  const nome = el('input', { type: 'text', id: 'nome', placeholder: 'Nome do trabalho', autocomplete: 'off', maxlength: '120' });
  const modelo = el('select', { id: 'modelo' }, ...(estado.modelos || []).map((item) => el('option', { value: item.id }, item.nome)));
  const cargos = el('p', { class: 'suave pequeno' });
  const mostrar = () => {
    const achado = (estado.modelos || []).find((item) => item.id === modelo.value);
    cargos.textContent = achado && achado.cargos.length ? `Cargos: ${achado.cargos.join(', ')}` : 'Sem cargos: você cria os chats depois.';
  };
  modelo.addEventListener('change', mostrar);
  mostrar();
  return { titulo: 'Novo trabalho', corpo: [nome, el('label', { for: 'modelo' }, 'Modelo'), modelo, cargos], confirmar: 'Criar trabalho', ao: () => {
    if (!nome.value.trim()) return;
    void pedir({ ...novoPedido('criarTrabalho', 0), projetoId: projeto.id, nome: nome.value.trim(), modelo: modelo.value }, `Criando o trabalho "${nome.value.trim()}"…`);
  }, foco: nome };
}

function folhaChat(trabalho) {
  const nome = el('input', { type: 'text', id: 'nome', placeholder: 'Nome do chat', autocomplete: 'off', maxlength: '120' });
  const cargo = el('input', { type: 'text', id: 'cargo', placeholder: 'Cargo (ex.: Roteirista)', autocomplete: 'off', maxlength: '80' });
  const tipo = el('select', { id: 'tipo' }, ...(estado.tiposChat || []).map((item) => el('option', { value: item.id }, item.nome)));
  let icone = '';
  let cor = CORES[0];
  const grade = el('div', { class: 'grade-icones', role: 'radiogroup', 'aria-label': 'Ícone' });
  const cores = el('div', { class: 'grade-cores', role: 'radiogroup', 'aria-label': 'Cor' });
  const pintar = () => {
    for (const botao of grade.children) {
      const ativo = botao.dataset.icone === icone;
      botao.classList.toggle('ativo', ativo);
      botao.setAttribute('aria-checked', String(ativo));
      botao.style.background = ativo ? `${cor}44` : '';
    }
    for (const botao of cores.children) {
      botao.classList.toggle('ativo', botao.dataset.cor === cor);
      botao.setAttribute('aria-checked', String(botao.dataset.cor === cor));
    }
  };
  for (const [nomeIcone, emoji] of Object.entries(ICONES)) {
    grade.append(el('button', { type: 'button', role: 'radio', 'data-icone': nomeIcone, 'aria-label': nomeIcone, onclick: () => { icone = icone === nomeIcone ? '' : nomeIcone; pintar(); } }, emoji));
  }
  for (const valor of CORES) {
    const botao = el('button', { type: 'button', role: 'radio', 'data-cor': valor, 'aria-label': `Cor ${valor}`, onclick: () => { cor = valor; pintar(); } });
    botao.style.background = valor;
    cores.append(botao);
  }
  pintar();
  return { titulo: 'Novo chat', corpo: [nome, cargo, el('label', { for: 'tipo' }, 'Tipo'), tipo, el('p', { class: 'suave pequeno' }, 'Ícone (opcional)'), grade, cores], confirmar: 'Criar chat', ao: () => {
    if (!nome.value.trim()) return;
    void pedir({ ...novoPedido('criarChat', 0), trabalhoId: trabalho.id, titulo: nome.value.trim(), cargo: cargo.value.trim(), tipoChat: tipo.value, avatar: montarAvatar(icone, cor) }, `Criando o chat "${nome.value.trim()}"…`);
  }, foco: nome };
}

function desenharFolha() {
  if (!folha) return null;
  const fechar = () => { folha = null; desenhar(); };
  const caixa = el('div', { class: 'folha', role: 'dialog', 'aria-modal': 'true', 'aria-label': folha.titulo },
    el('h2', {}, folha.titulo),
    ...folha.corpo,
    el('div', { class: 'acoes' },
      el('button', { class: 'botao sec', onclick: fechar }, 'Cancelar'),
      el('button', { class: 'botao', onclick: () => folha.ao() }, folha.confirmar)),
  );
  const fundo = el('div', { class: 'fundo-folha', onclick: (evento) => { if (evento.target === fundo) fechar(); } }, caixa);
  setTimeout(() => folha?.foco?.focus(), 30);
  return fundo;
}

// ---------- telas

function desenhar() {
  const estavaNoFim = tela.scrollHeight - tela.scrollTop - tela.clientHeight < 80;
  const rascunho = document.getElementById('texto')?.value ?? '';
  const folhaAberta = folha;
  tela.replaceChildren();
  voltar.hidden = rota.tipo === 'inicio' || rota.tipo === 'config';
  pcSelo.className = `pc ${estado ? (pcPresente(estado) ? 'on' : 'off') : ''}`;
  pcSelo.textContent = estado ? (pcPresente(estado) ? 'PC ligado' : `PC visto ${haQuanto(estado.atualizadoEm)}`) : '';
  if (aviso) tela.append(el('p', { class: 'erro' }, aviso));
  if (precisaEntrar && rota.tipo !== 'config') {
    tela.append(el('div', { class: 'cartao' },
      el('p', {}, 'Para continuar, confirme o login do Google. É só um toque.'),
      el('button', { class: 'botao', onclick: () => void pedirToken('').then(() => carregar(false)).catch((erro) => { aviso = erro.message; desenhar(); }) }, 'Continuar')));
  }

  if (rota.tipo === 'config') desenharConfig();
  else if (!estado) desenharEntrada();
  else if (rota.tipo === 'inicio') desenharInicio();
  else if (rota.tipo === 'projeto') desenharProjeto();
  else if (rota.tipo === 'trabalho') desenharTrabalho();
  else if (rota.tipo === 'chat') desenharChat(estavaNoFim, rascunho);
  else if (rota.tipo === 'arquivos') desenharArquivos();

  if (folhaAberta) { const aberta = desenharFolha(); if (aberta) tela.append(aberta); }
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
      guardado.apagar('token');
      token = null;
      aviso = '';
      ir({ tipo: 'inicio' });
    } }, 'Salvar'),
  );
}

function desenharEntrada() {
  titulo.textContent = 'Hub';
  tela.append(
    el('div', { class: 'cartao' },
      el('h2', {}, 'Hub no celular'),
      el('p', {}, 'Entre com a mesma conta do Google que o Hub usa no PC.'),
      el('button', { class: 'botao', onclick: () => void pedirToken(guardado.ler('logado') === '1' ? '' : 'consent').then(() => carregar(false)).catch((erro) => { aviso = erro.message; desenhar(); }) }, 'Entrar com o Google'),
    ),
    el('button', { class: 'botao sec', onclick: () => ir({ tipo: 'config' }) }, 'Trocar o ID do cliente'),
  );
}

function desenharInicio() {
  titulo.textContent = 'Projetos';
  if (estado.projetos.length === 0) tela.append(el('p', { class: 'suave' }, 'Nenhum projeto ainda. Crie o primeiro.'));
  for (const projeto of estado.projetos) {
    const chats = projeto.trabalhos.reduce((soma, trabalho) => soma + trabalho.chats.length, 0);
    const ocupados = projeto.trabalhos.reduce((soma, trabalho) => soma + trabalho.chats.filter((chat) => chat.ocupado).length, 0);
    tela.append(el('button', { class: 'linha', onclick: () => ir({ tipo: 'projeto', projeto: projeto.id }) },
      el('span', { class: 'selo-chat grande', 'aria-hidden': 'true' }, inicial(projeto.nome)),
      el('span', { class: 'nome' }, projeto.nome, el('small', { class: 'sub' }, `${projeto.trabalhos.length} trabalhos · ${chats} chats`)),
      ocupados ? el('span', { class: 'pilula' }, `${ocupados} respondendo`) : null));
  }
  tela.append(botaoMais('Novo projeto', () => { folha = folhaProjeto(); desenhar(); }));
}

function projetoAtual() { return estado.projetos.find((item) => item.id === rota.projeto); }
function trabalhoAtual() { return projetoAtual()?.trabalhos.find((item) => item.id === rota.trabalho); }

function desenharProjeto() {
  const projeto = projetoAtual();
  if (!projeto) return ir({ tipo: 'inicio' });
  titulo.textContent = projeto.nome;
  if (projeto.trabalhos.length === 0) tela.append(el('p', { class: 'suave' }, 'Nenhum trabalho neste projeto ainda.'));
  for (const trabalho of projeto.trabalhos) {
    const ocupados = trabalho.chats.filter((chat) => chat.ocupado).length;
    tela.append(el('button', { class: 'linha', onclick: () => ir({ tipo: 'trabalho', projeto: projeto.id, trabalho: trabalho.id }) },
      el('span', { class: 'nome' }, trabalho.nome, el('small', { class: 'sub' }, `${trabalho.chats.length} chats · ${trabalho.arquivos.length} arquivos no Drive`)),
      ocupados ? el('span', { class: 'pilula' }, `${ocupados} respondendo`) : null));
  }
  tela.append(botaoMais('Novo trabalho', () => { folha = folhaTrabalho(projeto); desenhar(); }));
}

function desenharTrabalho() {
  const projeto = projetoAtual();
  const trabalho = trabalhoAtual();
  if (!trabalho) return ir({ tipo: 'inicio' });
  titulo.textContent = `${projeto.nome} › ${trabalho.nome}`;
  tela.append(el('button', { class: 'linha', onclick: () => ir({ ...rota, tipo: 'arquivos' }) },
    el('span', { class: 'selo-chat grande', 'aria-hidden': 'true' }, '📁'),
    el('span', { class: 'nome' }, 'Arquivos', el('small', { class: 'sub' }, 'Os que estão no Google Drive')),
    el('small', {}, String(trabalho.arquivos.length))));
  tela.append(el('h2', {}, 'Chats'));
  if (trabalho.chats.length === 0) tela.append(el('p', { class: 'suave' }, 'Nenhum chat neste trabalho ainda.'));
  for (const chat of trabalho.chats) {
    const ultima = chat.mensagens.at(-1);
    tela.append(el('button', { class: 'linha', onclick: () => ir({ tipo: 'chat', projeto: projeto.id, trabalho: trabalho.id, chat: chat.id }) },
      selo(chat, true),
      el('span', { class: 'nome' }, chat.titulo, chat.cargo ? el('small', {}, ` · ${chat.cargo}`) : null,
        el('small', { class: 'sub' }, ultima ? ultima.texto.replace(/\s+/g, ' ').slice(0, 70) : 'Sem mensagens')),
      chat.ocupado ? el('span', { class: 'pilula' }, 'respondendo') : null));
  }
  tela.append(botaoMais('Novo chat', () => { folha = folhaChat(trabalho); desenhar(); }));
}

function desenharChat(estavaNoFim, rascunho) {
  const achado = acharChat(estado, rota.chat);
  if (!achado) return ir({ tipo: 'inicio' });
  const { chat } = achado;
  titulo.textContent = chat.titulo;
  const vistos = new Set(chat.mensagens.map((m) => m.texto.trim()));
  pendentes = pendentes.filter((p) => p.chat !== chat.id || !vistos.has(p.texto.trim()));
  const conversa = el('div', { class: 'conversa' });
  if (chat.mensagens.length === 0) conversa.append(el('p', { class: 'suave' }, 'Escreva a primeira mensagem para este chat.'));
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
  const trabalho = trabalhoAtual();
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
  if (carregando) return;
  carregando = true;
  try {
    estado = await lerEstado();
    aviso = '';
  } catch (erro) {
    if (!silencioso || !estado) aviso = erro.message;
  } finally {
    carregando = false;
  }
  // A sheet being filled in is not redrawn under the person's fingers.
  if (!folha) desenhar();
}

function agendar() {
  const espera = Date.now() < rapidoAte ? POLL_RAPIDO_MS : POLL_MS;
  setTimeout(() => {
    if (!document.hidden && guardado.ler('clientId') && !precisaEntrar) void carregar(true);
    agendar();
  }, espera);
}

voltar.addEventListener('click', () => {
  if (rota.tipo === 'chat' || rota.tipo === 'arquivos') ir({ tipo: 'trabalho', projeto: rota.projeto, trabalho: rota.trabalho });
  else if (rota.tipo === 'trabalho') ir({ tipo: 'projeto', projeto: rota.projeto });
  else ir({ tipo: 'inicio' });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !precisaEntrar) void carregar(true); });

if (!guardado.ler('clientId')) rota = { tipo: 'config' };
desenhar();
if (guardado.ler('clientId') && guardado.ler('logado') === '1') void carregar(true);
agendar();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => undefined);
