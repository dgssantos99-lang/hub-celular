import {
  CORES, ICONES, TEMAS, acharChat, dinheiro, haQuanto, hora, horaDaLista, inicial, lerAvatar, lerData, lerTexto,
  montarAvatar, novoPedido, pcPresente, rotuloDia, situacaoDoChat, tamanhoLegivel, tipoDoArquivo,
} from './logica.js';
import { aleatorio, enderecoDeLogin, enderecoDeRetorno, renovar, trocarCodigo } from './entrar.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const POLL_MS = 5000;
const POLL_RAPIDO_MS = 2000;

const $ = (id) => document.getElementById(id);
const tela = $('tela');
const topo = { voltar: $('voltar'), menu: $('menu'), titulo: $('titulo'), sub: $('subtitulo'), avatar: $('topo-avatar'), pc: $('pc'), abas: $('abas') };

const guardado = {
  ler(chave) { try { return localStorage.getItem(chave); } catch { return null; } },
  gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: segue sem lembrar */ } },
  apagar(chave) { try { localStorage.removeItem(chave); } catch { /* idem */ } },
};

const sessao = {
  token: guardado.ler('token'),
  ate: Number(guardado.ler('tokenAte') || 0),
  renovando: null,
};
/** The last state seen, kept on the phone so the page opens at once while the new one is fetched. */
function lerCache() {
  try { return JSON.parse(guardado.ler('estadoCache') || 'null'); } catch { return null; }
}
function lerRotaSalva() {
  try {
    const salva = JSON.parse(guardado.ler('rota') || 'null');
    return salva && typeof salva.tipo === 'string' && salva.tipo !== 'config' ? salva : { tipo: 'inicio' };
  } catch { return { tipo: 'inicio' }; }
}
let estado = configurado() && guardado.ler('renovacao') ? lerCache() : null;
let assinatura = estado ? JSON.stringify({ ...estado, atualizadoEm: '' }) : '';
let ids = { entrada: null, estado: null, arquivos: null };
let rota = estado ? lerRotaSalva() : { tipo: 'inicio' };
let historico = [];
const respondidas = new Set(); // approvals answered from here, hidden at once
let gravacao = null; // the voice message being recorded
let vozEstado = ''; // '', 'gravando' or 'transcrevendo'
let vozPedido = null;
let aviso = '';
let folha = null;
let pendentes = []; // messages sent from here that the PC has not shown yet
let anexos = []; // files chosen for the next message
let vistas = new Map(); // last message id drawn for each chat, to animate only the new ones
let rapidoAte = 0;
let carregando = false;
let precisaEntrar = false;

// ---------- login que dura

function configurado() { return Boolean(guardado.ler('clientId') && guardado.ler('segredo')); }

function dadosDoCliente() {
  return { clientId: guardado.ler('clientId'), segredo: guardado.ler('segredo'), retorno: enderecoDeRetorno() };
}

async function iniciarLogin() {
  const estadoAleatorio = aleatorio(24);
  const verificador = aleatorio(48);
  guardado.gravar('login', JSON.stringify({ estado: estadoAleatorio, verificador }));
  window.location.href = await enderecoDeLogin({ ...dadosDoCliente(), estado: estadoAleatorio, verificador });
}

function guardarToken(dados) {
  sessao.token = dados.access_token;
  sessao.ate = Date.now() + (Number(dados.expires_in || 3600) - 120) * 1000;
  guardado.gravar('token', sessao.token);
  guardado.gravar('tokenAte', String(sessao.ate));
  if (dados.refresh_token) guardado.gravar('renovacao', dados.refresh_token);
  precisaEntrar = false;
}

/** Back from Google's page with ?code=...: finishes the login and cleans the address. */
async function terminarLogin() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') && !params.has('error')) return;
  const limpo = enderecoDeRetorno();
  window.history.replaceState(null, '', limpo);
  if (params.has('error')) { aviso = `O Google recusou o login: ${params.get('error')}.`; return; }
  let salvo = null;
  try { salvo = JSON.parse(guardado.ler('login') || 'null'); } catch { salvo = null; }
  guardado.apagar('login');
  if (!salvo || salvo.estado !== params.get('state')) { aviso = 'O login não confere. Tente entrar de novo.'; return; }
  try {
    guardarToken(await trocarCodigo({ ...dadosDoCliente(), codigo: params.get('code'), verificador: salvo.verificador }));
    if (!guardado.ler('renovacao')) aviso = 'O Google não deu a permissão duradoura. Entre de novo e aceite tudo.';
  } catch (erro) {
    aviso = `Não consegui terminar o login: ${erro.message}`;
  }
}

/** A valid access token, renewed on its own with the refresh token. */
async function garantirToken() {
  if (sessao.token && Date.now() < sessao.ate) return;
  const renovacao = guardado.ler('renovacao');
  if (!renovacao || !configurado()) { precisaEntrar = true; throw new Error('Entre com o Google para continuar.'); }
  if (!sessao.renovando) {
    sessao.renovando = renovar({ ...dadosDoCliente(), renovacao })
      .then(guardarToken)
      .catch((erro) => {
        if (erro.codigo === 'invalid_grant') { guardado.apagar('renovacao'); guardado.apagar('token'); sessao.token = null; precisaEntrar = true; }
        throw new Error(erro.codigo === 'invalid_grant' ? 'O Google pediu para entrar de novo.' : erro.message);
      })
      .finally(() => { sessao.renovando = null; });
  }
  await sessao.renovando;
}

// ---------- Drive

async function drive(url, opcoes = {}) {
  await garantirToken();
  const resposta = await fetch(url, { ...opcoes, headers: { ...(opcoes.headers || {}), authorization: `Bearer ${sessao.token}` } });
  if (resposta.status === 401) { sessao.token = null; sessao.ate = 0; throw new Error('O Google recusou o acesso. Tente de novo.'); }
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
  if (ids.entrada && ids.estado && ids.arquivos) return true;
  let pai = 'root';
  for (const nome of ['Hub', 'Ponte']) {
    pai = await acharPasta(nome, pai);
    if (!pai) return false;
  }
  const q = `name = 'estado.json' and '${pai}' in parents and trashed = false`;
  const r = await (await drive(`${DRIVE}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`)).json();
  ids = { entrada: await acharPasta('entrada', pai), arquivos: await acharPasta('arquivos', pai), estado: r.files?.[0]?.id ?? null };
  return Boolean(ids.entrada && ids.estado && ids.arquivos);
}

async function lerEstado() {
  if (!(await descobrirPonte())) throw new Error('Não achei a pasta Hub/Ponte. No PC, ligue "Deixar o celular usar este PC" no painel do Google Drive e atualize o Hub.');
  return (await drive(`${DRIVE}/files/${ids.estado}?alt=media`, { cache: 'no-store' })).json();
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
  await drive(`${UPLOAD}/files?uploadType=multipart`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${limite}` }, body: corpo });
  rapidoAte = Date.now() + 40_000;
}

/** Sends a file of the phone to the bridge folder, with progress. Returns its Drive id. */
async function enviarArquivoAoDrive(arquivo, aoProgredir) {
  if (!(await descobrirPonte())) throw new Error('A ponte do PC ainda não está pronta.');
  const inicio = await drive(`${UPLOAD}/files?uploadType=resumable`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': arquivo.type || 'application/octet-stream', 'x-upload-content-length': String(arquivo.size) },
    body: JSON.stringify({ name: arquivo.name, parents: [ids.arquivos] }),
  });
  const endereco = inicio.headers.get('location');
  if (!endereco) throw new Error('O Google não abriu o envio do arquivo.');
  return new Promise((resolve, reject) => {
    const pedido = new XMLHttpRequest();
    pedido.open('PUT', endereco);
    pedido.upload.onprogress = (evento) => { if (evento.lengthComputable) aoProgredir(evento.loaded / evento.total); };
    pedido.onload = () => {
      if (pedido.status >= 200 && pedido.status < 300) {
        try { resolve(JSON.parse(pedido.responseText).id); } catch { reject(new Error('Resposta estranha do Google.')); }
      } else reject(new Error(`O Google respondeu ${pedido.status} no envio.`));
    };
    pedido.onerror = () => reject(new Error('A conexão caiu durante o envio.'));
    pedido.send(arquivo);
  });
}

async function baixar(driveId) { return (await drive(`${DRIVE}/files/${driveId}?alt=media`)).blob(); }

// ---------- aparência

function textoSobre(cor) {
  const n = Number.parseInt(cor.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#07101c' : '#ffffff';
}

function aplicarAparencia() {
  const tema = guardado.ler('tema') || (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'claro' : 'noite');
  document.documentElement.dataset.tema = tema;
  const cor = guardado.ler('cor');
  const raiz = document.documentElement.style;
  if (cor && CORES.includes(cor)) { raiz.setProperty('--destaque', cor); raiz.setProperty('--destaque-texto', textoSobre(cor)); }
  else { raiz.removeProperty('--destaque'); raiz.removeProperty('--destaque-texto'); }
  const fundo = getComputedStyle(document.documentElement).getPropertyValue('--fundo').trim();
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', fundo || '#0a111f');
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

function corDoNome(nome) {
  let h = 0;
  for (const letra of nome) h = (h * 31 + letra.codePointAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}

function bolinha(texto, { cor, emoji, grande } = {}) {
  const no = el('span', { class: `bolinha${grande ? ' grande' : ''}`, 'aria-hidden': 'true' }, emoji || inicial(texto));
  no.style.background = cor || corDoNome(texto);
  return no;
}

function bolinhaDoChat(chat, grande) {
  const avatar = lerAvatar(chat.avatar);
  return avatar ? bolinha(chat.titulo, { emoji: avatar.emoji, cor: `${avatar.cor}`, grande }) : bolinha(chat.titulo, { grande });
}

function ir(nova) {
  historico.push(rota);
  try { window.history.pushState({ hub: true }, ''); } catch { /* sem histórico: o botão voltar do app continua valendo */ }
  rota = nova;
  folha = null;
  desenhar('frente');
}

function voltarUma() {
  rota = historico.pop() ?? { tipo: 'inicio' };
  folha = null;
  desenhar('volta');
}

/** The back arrow and the phone's back button do the same thing. */
function voltarNavegacao() {
  if (historico.length > 0) window.history.back();
  else voltarUma();
}

/** A short message that fades by itself. */
function avisoRapido(texto) {
  const caixa = el('div', { class: 'toast', role: 'status' }, texto);
  document.body.append(caixa);
  setTimeout(() => caixa.remove(), 3200);
}

function vibrar() { try { navigator.vibrate?.(8); } catch { /* sem vibração */ } }

function pedir(pedido, texto) {
  return enviarPedido(pedido).then(() => {
    aviso = '';
    folha = null;
    vibrar();
    avisoRapido(texto);
    desenhar();
  }).catch((erro) => { aviso = erro.message; desenhar(); });
}

// ---------- folhas (janelas que sobem de baixo)

function abrirFolha(config) { folha = config; desenharFolha(); }
function fecharFolha() { folha = null; $('folha')?.remove(); }

function desenharFolha() {
  $('folha')?.remove();
  if (!folha) return;
  const corpo = el('div', { class: 'folha', role: 'dialog', 'aria-modal': 'true', 'aria-label': folha.titulo },
    el('div', { class: 'puxador', 'aria-hidden': 'true' }),
    el('h2', {}, folha.titulo),
    ...(folha.corpo || []),
    folha.itens ? el('div', { class: 'menu-itens' }, ...folha.itens.map((item) => el('button', { class: `item${item.perigo ? ' perigo' : ''}`, onclick: () => { fecharFolha(); item.ao(); } }, item.rotulo))) : null,
    folha.confirmar ? el('div', { class: 'acoes' },
      el('button', { class: 'botao sec', onclick: fecharFolha }, 'Cancelar'),
      el('button', { class: `botao${folha.perigo ? ' perigo' : ''}`, onclick: () => folha.ao() }, folha.confirmar)) : null,
  );
  const fundo = el('div', { id: 'folha', class: 'fundo-folha', onclick: (evento) => { if (evento.target === fundo) fecharFolha(); } }, corpo);
  document.body.append(fundo);
  setTimeout(() => folha?.foco?.focus(), 60);
}

function campo(id, rotulo, valor = '', maximo = 120) {
  return el('input', { type: 'text', id, placeholder: rotulo, 'aria-label': rotulo, value: valor, autocomplete: 'off', maxlength: String(maximo) });
}

function seletorDeIcone(inicialAvatar, aoMudar) {
  const atual = lerAvatar(inicialAvatar);
  let icone = atual ? Object.keys(ICONES).find((chave) => ICONES[chave] === atual.emoji) || '' : '';
  let cor = atual?.cor || CORES[0];
  const grade = el('div', { class: 'grade-icones', role: 'radiogroup', 'aria-label': 'Ícone' });
  const cores = el('div', { class: 'grade-cores', role: 'radiogroup', 'aria-label': 'Cor' });
  const pintar = () => {
    for (const botao of grade.children) {
      const ativo = botao.dataset.icone === icone;
      botao.classList.toggle('ativo', ativo);
      botao.setAttribute('aria-checked', String(ativo));
      botao.style.background = ativo ? `${cor}55` : '';
    }
    for (const botao of cores.children) {
      botao.classList.toggle('ativo', botao.dataset.cor === cor);
      botao.setAttribute('aria-checked', String(botao.dataset.cor === cor));
    }
    aoMudar(montarAvatar(icone, cor));
  };
  for (const [nome, emoji] of Object.entries(ICONES)) {
    grade.append(el('button', { type: 'button', role: 'radio', 'data-icone': nome, 'aria-label': nome, onclick: () => { icone = icone === nome ? '' : nome; pintar(); } }, emoji));
  }
  for (const valor of CORES) {
    const botao = el('button', { type: 'button', role: 'radio', 'data-cor': valor, 'aria-label': `Cor ${valor}`, onclick: () => { cor = valor; pintar(); } });
    botao.style.background = valor;
    cores.append(botao);
  }
  pintar();
  return el('div', {}, el('p', { class: 'suave pequeno' }, 'Ícone (opcional)'), grade, cores);
}

function folhaProjeto() {
  const nome = campo('nome', 'Nome do projeto');
  abrirFolha({ titulo: 'Novo projeto', corpo: [nome], confirmar: 'Criar projeto', foco: nome, ao: () => {
    const valor = nome.value.trim();
    if (valor) void pedir({ ...novoPedido('criarProjeto', 0), nome: valor }, `Criando o projeto "${valor}"…`);
  } });
}

function folhaTrabalho(projeto) {
  const nome = campo('nome', 'Nome do trabalho');
  const modelo = el('select', { id: 'modelo', 'aria-label': 'Modelo' }, ...(estado.modelos || []).map((item) => el('option', { value: item.id }, item.nome)));
  const cargos = el('p', { class: 'suave pequeno' });
  const mostrar = () => {
    const achado = (estado.modelos || []).find((item) => item.id === modelo.value);
    cargos.textContent = achado && achado.cargos.length ? `Cargos: ${achado.cargos.join(', ')}` : 'Sem cargos: você cria os chats depois.';
  };
  modelo.addEventListener('change', mostrar);
  mostrar();
  abrirFolha({ titulo: 'Novo trabalho', corpo: [nome, el('label', { for: 'modelo' }, 'Modelo de cargos'), modelo, cargos], confirmar: 'Criar trabalho', foco: nome, ao: () => {
    const valor = nome.value.trim();
    if (valor) void pedir({ ...novoPedido('criarTrabalho', 0), projetoId: projeto.id, nome: valor, modelo: modelo.value }, `Criando o trabalho "${valor}"…`);
  } });
}

function folhaChat(trabalho) {
  const nome = campo('nome', 'Nome do chat');
  const cargo = campo('cargo', 'Cargo (ex.: Roteirista)', '', 80);
  const tipo = el('select', { id: 'tipo', 'aria-label': 'Tipo' }, ...(estado.tiposChat || []).map((item) => el('option', { value: item.id }, item.nome)));
  let avatar = '';
  abrirFolha({ titulo: 'Novo chat', corpo: [nome, cargo, el('label', { for: 'tipo' }, 'Tipo'), tipo, seletorDeIcone('', (valor) => { avatar = valor; })], confirmar: 'Criar chat', foco: nome, ao: () => {
    const valor = nome.value.trim();
    if (valor) void pedir({ ...novoPedido('criarChat', 0), trabalhoId: trabalho.id, titulo: valor, cargo: cargo.value.trim(), tipoChat: tipo.value, avatar }, `Criando o chat "${valor}"…`);
  } });
}

function folhaRenomear(entidade, alvo, nomeAtual) {
  const nome = campo('nome', 'Novo nome', nomeAtual);
  abrirFolha({ titulo: 'Renomear', corpo: [nome], confirmar: 'Salvar', foco: nome, ao: () => {
    const valor = nome.value.trim();
    if (valor && valor !== nomeAtual) void pedir({ ...novoPedido('renomear', 0), entidade, alvo, nome: valor }, `Renomeando para "${valor}"…`);
    else fecharFolha();
  } });
}

function folhaLixeira(entidade, alvo, nome) {
  abrirFolha({ titulo: `Enviar "${nome}" para a lixeira?`, corpo: [el('p', { class: 'suave' }, 'Fica na lixeira do Hub, no PC, e dá para restaurar de lá.')], confirmar: 'Enviar para a lixeira', perigo: true, ao: () => {
    void pedir({ ...novoPedido('lixeira', 0), entidade, alvo }, `Enviando "${nome}" para a lixeira…`).then(() => voltarNavegacao());
  } });
}

function folhaChatAjustes(chat) {
  let avatar = chat.avatar || '';
  const modelo = el('select', { id: 'modelo', 'aria-label': 'Modelo do Claude' }, ...(estado.modelosClaude || []).map((item) => el('option', { value: item.id ?? '' }, item.nome)));
  modelo.value = chat.modelo ?? '';
  abrirFolha({ titulo: 'Ajustes do chat', corpo: [el('label', { for: 'modelo' }, 'Modelo do Claude'), modelo, seletorDeIcone(chat.avatar, (valor) => { avatar = valor; })], confirmar: 'Salvar', ao: () => {
    const pedido = { ...novoPedido('ajustarChat', chat.id), avatar, modelo: modelo.value === '' ? null : modelo.value };
    void pedir(pedido, 'Salvando ajustes do chat…');
  } });
}

function escolherArquivo(aoEscolher) {
  const entrada = el('input', { type: 'file', multiple: true, style: 'display:none' });
  entrada.addEventListener('change', () => { aoEscolher([...entrada.files]); entrada.remove(); });
  document.body.append(entrada);
  entrada.click();
}

// ---------- topo e navegação

function definirTopo({ titulo, sub = '', avatar = null, voltar = false, menu = null, abas = false }) {
  topo.titulo.textContent = titulo;
  topo.sub.textContent = sub;
  topo.sub.hidden = !sub;
  topo.avatar.replaceChildren(...(avatar ? [avatar] : []));
  topo.voltar.hidden = !voltar;
  topo.menu.hidden = !menu;
  topo.menu.onclick = menu;
  topo.abas.hidden = !abas;
  document.body.classList.toggle('no-chat', rota.tipo === 'chat' || rota.tipo === 'assistente');
  for (const botao of topo.abas.querySelectorAll('button')) {
    const aba = rota.tipo === 'assistente' ? 'assistente' : rota.tipo === 'ajustes' ? 'ajustes' : 'inicio';
    botao.classList.toggle('ativa', botao.dataset.aba === aba);
    botao.setAttribute('aria-current', botao.dataset.aba === aba ? 'page' : 'false');
  }
  const esperando = aprovacoesPendentes().length;
  topo.abas.querySelector('[data-aba=assistente]')?.classList.toggle('aviso', esperando > 0);
  const presente = estado ? pcPresente(estado) : false;
  topo.pc.className = `pc ${estado ? (presente ? 'on' : 'off') : ''}`;
  topo.pc.title = estado ? (presente ? 'PC ligado' : `PC visto ${haQuanto(estado.atualizadoEm)}`) : '';
  topo.pc.textContent = estado && !presente ? 'PC desligado?' : '';
}

function projetoAtual() { return estado.projetos.find((item) => item.id === rota.projeto); }
function trabalhoAtual() { return projetoAtual()?.trabalhos.find((item) => item.id === rota.trabalho); }

function desenhar(direcao = '') {
  const rascunho = $('texto')?.value ?? '';
  if (rota.tipo !== 'config') guardado.gravar('rota', JSON.stringify(rota));
  tela.replaceChildren();
  tela.className = direcao ? `entra-${direcao}` : '';
  tela.scrollTop = 0;
  if (aviso) tela.append(el('p', { class: 'erro faixa' }, aviso));
  if (rota.tipo === 'config') return desenharConfig();
  if (!estado) return configurado() && guardado.ler('renovacao') && !precisaEntrar ? desenharCarregando() : desenharEntrada();
  if (rota.tipo === 'inicio') desenharInicio();
  else if (rota.tipo === 'projeto') desenharProjeto();
  else if (rota.tipo === 'trabalho') desenharTrabalho();
  else if (rota.tipo === 'chat' || rota.tipo === 'assistente') desenharChat(rascunho);
  else if (rota.tipo === 'arquivos') desenharArquivos();
  else if (rota.tipo === 'ajustes') desenharAjustes();
  if (folha) desenharFolha();
}

function desenharConfig() {
  definirTopo({ titulo: 'Primeiro acesso' });
  const retorno = enderecoDeRetorno();
  const id = campo('cliente', 'ID do cliente (termina em .apps.googleusercontent.com)', guardado.ler('clientId') ?? '', 200);
  const segredo = campo('segredo', 'Chave secreta do cliente (GOCSPX-…)', guardado.ler('segredo') ?? '', 200);
  segredo.setAttribute('type', 'password');
  tela.append(
    el('div', { class: 'cartao' },
      el('h2', {}, 'Conectar ao Google'),
      el('p', { class: 'suave' }, 'No Google Cloud, no cliente "Aplicativo da Web", copie o ID e a chave secreta. A chave fica só neste aparelho.'),
      id, segredo,
      el('p', { class: 'suave pequeno' }, 'Em "URIs de redirecionamento autorizados" do cliente, adicione exatamente este endereço:'),
      el('code', { class: 'endereco' }, retorno),
      el('button', { class: 'botao sec', onclick: () => { void navigator.clipboard?.writeText(retorno); vibrar(); } }, 'Copiar endereço'),
      el('button', { class: 'botao', onclick: () => {
        if (!id.value.includes('.apps.googleusercontent.com') || segredo.value.trim().length < 10) { aviso = 'Confira o ID do cliente e a chave secreta.'; return desenhar(); }
        guardado.gravar('clientId', id.value.trim());
        guardado.gravar('segredo', segredo.value.trim());
        guardado.apagar('renovacao'); guardado.apagar('token');
        sessao.token = null;
        aviso = '';
        rota = { tipo: 'inicio' };
        desenhar();
      } }, 'Salvar')),
  );
}

function desenharCarregando() {
  definirTopo({ titulo: 'Hub', sub: 'conectando ao PC…' });
  for (let i = 0; i < 4; i++) tela.append(el('div', { class: 'esqueleto', 'aria-hidden': 'true' }, el('i'), el('span')));
}

function desenharEntrada() {
  definirTopo({ titulo: 'Hub' });
  tela.append(el('div', { class: 'cartao heroi' },
    el('span', { class: 'bolinha grande', 'aria-hidden': 'true' }, '✦'),
    el('h2', {}, 'Hub no celular'),
    el('p', { class: 'suave' }, 'Fale com os seus chats usando o seu PC. Entre com a mesma conta do Google que o Hub usa lá.'),
    configurado() ? el('button', { class: 'botao', onclick: () => void iniciarLogin() }, 'Entrar com o Google') : el('button', { class: 'botao', onclick: () => { rota = { tipo: 'config' }; desenhar(); } }, 'Configurar'),
  ));
  if (configurado()) tela.append(el('button', { class: 'botao sec', onclick: () => { rota = { tipo: 'config' }; desenhar(); } }, 'Trocar o ID do cliente'));
}

function pilulaOcupado(quantos) { return quantos ? el('span', { class: 'pilula' }, `${quantos} respondendo`) : null; }

function desenharInicio() {
  definirTopo({ titulo: 'Projetos', sub: estado.projetos.length ? `${estado.projetos.length} no Hub` : '', abas: true });
  if (estado.projetos.length === 0) tela.append(el('div', { class: 'vazio' }, el('p', {}, 'Nenhum projeto ainda.'), el('p', { class: 'suave' }, 'Toque no + para criar o primeiro.')));
  for (const projeto of estado.projetos) {
    const chats = projeto.trabalhos.reduce((soma, trabalho) => soma + trabalho.chats.length, 0);
    const ocupados = projeto.trabalhos.reduce((soma, trabalho) => soma + trabalho.chats.filter((chat) => chat.ocupado).length, 0);
    tela.append(el('button', { class: 'linha', onclick: () => ir({ tipo: 'projeto', projeto: projeto.id }) },
      bolinha(projeto.nome, { grande: true }),
      el('span', { class: 'nome' }, projeto.nome, el('small', { class: 'sub' }, `${projeto.trabalhos.length} trabalhos · ${chats} chats`)),
      pilulaOcupado(ocupados)));
  }
  tela.append(el('button', { class: 'fab', 'aria-label': 'Novo projeto', onclick: folhaProjeto }, '+'));
}

function desenharProjeto() {
  const projeto = projetoAtual();
  if (!projeto) return voltarUma();
  definirTopo({ titulo: projeto.nome, sub: `${projeto.trabalhos.length} trabalhos`, avatar: bolinha(projeto.nome), voltar: true, menu: () => abrirFolha({ titulo: projeto.nome, itens: [
    { rotulo: 'Renomear', ao: () => folhaRenomear('projeto', projeto.id, projeto.nome) },
    { rotulo: 'Enviar para a lixeira', perigo: true, ao: () => folhaLixeira('projeto', projeto.id, projeto.nome) },
  ] }) });
  if (projeto.trabalhos.length === 0) tela.append(el('div', { class: 'vazio' }, el('p', {}, 'Nenhum trabalho neste projeto.'), el('p', { class: 'suave' }, 'Toque no + para criar um.')));
  for (const trabalho of projeto.trabalhos) {
    const ocupados = trabalho.chats.filter((chat) => chat.ocupado).length;
    tela.append(el('button', { class: 'linha', onclick: () => ir({ tipo: 'trabalho', projeto: projeto.id, trabalho: trabalho.id }) },
      bolinha(trabalho.nome, { grande: true }),
      el('span', { class: 'nome' }, trabalho.nome, el('small', { class: 'sub' }, `${trabalho.chats.length} chats · ${trabalho.arquivos.length} arquivos no Drive`)),
      pilulaOcupado(ocupados)));
  }
  tela.append(el('button', { class: 'fab', 'aria-label': 'Novo trabalho', onclick: () => folhaTrabalho(projeto) }, '+'));
}

function desenharTrabalho() {
  const projeto = projetoAtual();
  const trabalho = trabalhoAtual();
  if (!trabalho) return voltarUma();
  definirTopo({ titulo: trabalho.nome, sub: projeto.nome, avatar: bolinha(trabalho.nome), voltar: true, menu: () => abrirFolha({ titulo: trabalho.nome, itens: [
    { rotulo: 'Enviar arquivo do celular para o trabalho', ao: () => escolherArquivo((lista) => void enviarAoTrabalho(trabalho, lista)) },
    { rotulo: 'Renomear', ao: () => folhaRenomear('trabalho', trabalho.id, trabalho.nome) },
    { rotulo: 'Enviar para a lixeira', perigo: true, ao: () => folhaLixeira('trabalho', trabalho.id, trabalho.nome) },
  ] }) });
  tela.append(el('button', { class: 'linha', onclick: () => ir({ ...rota, tipo: 'arquivos' }) },
    bolinha('Arquivos', { emoji: '📁', cor: 'var(--elevado)', grande: true }),
    el('span', { class: 'nome' }, 'Arquivos', el('small', { class: 'sub' }, 'Os que estão no Google Drive')),
    el('small', { class: 'suave' }, String(trabalho.arquivos.length))));
  if (trabalho.chats.length === 0) tela.append(el('div', { class: 'vazio' }, el('p', {}, 'Nenhum chat neste trabalho.'), el('p', { class: 'suave' }, 'Toque no + para criar um cargo.')));
  for (const chat of trabalho.chats) {
    const ultima = chat.mensagens.at(-1);
    tela.append(el('button', { class: 'linha chat-linha', onclick: () => ir({ tipo: 'chat', projeto: projeto.id, trabalho: trabalho.id, chat: chat.id }) },
      bolinhaDoChat(chat, true),
      el('span', { class: 'nome' }, el('span', { class: 'topo-linha' }, el('b', {}, chat.titulo), el('small', { class: 'hora' }, ultima ? horaDaLista(ultima.quando) : '')),
        el('small', { class: `sub${chat.ocupado ? ' digitando-txt' : ''}` }, chat.ocupado ? 'respondendo…' : ultima ? `${ultima.papel === 'user' ? 'Você: ' : ''}${ultima.texto.replace(/\s+/g, ' ').slice(0, 80)}` : chat.cargo || 'Sem mensagens'))));
  }
  tela.append(el('button', { class: 'fab', 'aria-label': 'Novo chat', onclick: () => folhaChat(trabalho) }, '+'));
}

async function enviarAoTrabalho(trabalho, lista) {
  for (const arquivo of lista) {
    aviso = `Enviando ${arquivo.name}…`;
    desenhar();
    try {
      const driveId = await enviarArquivoAoDrive(arquivo, () => undefined);
      await enviarPedido({ ...novoPedido('enviarArquivo', 0), trabalhoId: trabalho.id, driveId, nome: arquivo.name });
      aviso = '';
    } catch (erro) {
      aviso = erro.message;
    }
  }
  vibrar();
  desenhar();
}

// ---------- chat estilo mensageiro

function chatAtual() {
  if (rota.tipo === 'assistente') return estado.assistente ? { chat: estado.assistente, projeto: null } : null;
  return acharChat(estado, rota.chat);
}

function desenharTexto(texto) {
  const caixa = el('div', { class: 'texto' });
  for (const bloco of lerTexto(texto)) {
    if (bloco.tipo === 'codigo') caixa.append(el('pre', {}, bloco.texto));
    else if (bloco.tipo === 'lista') caixa.append(el(bloco.ordenada ? 'ol' : 'ul', {}, ...bloco.itens.map((item) => el('li', {}, ...partes(item)))));
    else caixa.append(el('p', {}, ...partes(bloco.partes)));
  }
  return caixa;
}

function partes(lista) {
  return lista.map((parte) => (parte.tipo === 'texto' ? document.createTextNode(parte.texto)
    : el(parte.tipo === 'negrito' ? 'strong' : parte.tipo === 'italico' ? 'em' : 'code', {}, parte.texto)));
}

function desenharChat(rascunho) {
  const achado = chatAtual();
  const assistente = rota.tipo === 'assistente';
  if (!achado) {
    definirTopo({ titulo: 'Assistente geral', sub: 'ainda não usado', avatar: bolinha('Assistente', { emoji: '✦', cor: 'var(--destaque)' }), abas: true });
    tela.append(el('div', { class: 'vazio' }, el('p', {}, 'O assistente geral ainda não foi aberto no PC.'), el('p', { class: 'suave' }, 'Você pode mandar a primeira mensagem daqui.')));
  }
  const chat = achado?.chat ?? { id: 0, titulo: 'Assistente geral', cargo: '', avatar: '', modelo: null, ocupado: false, mensagens: [] };
  definirTopo({
    titulo: chat.titulo,
    sub: assistente ? (chat.ocupado ? 'respondendo…' : 'controla o Hub com a sua aprovação no PC') : situacaoDoChat(chat),
    avatar: assistente ? bolinha('Assistente', { emoji: '✦', cor: 'var(--destaque)' }) : bolinhaDoChat(chat),
    voltar: !assistente,
    abas: assistente,
    menu: assistente ? null : () => abrirFolha({ titulo: chat.titulo, itens: [
      { rotulo: 'Ajustes do chat (ícone e modelo)', ao: () => folhaChatAjustes(chat) },
      { rotulo: 'Renomear', ao: () => folhaRenomear('chat', chat.id, chat.titulo) },
      { rotulo: 'Enviar para a lixeira', perigo: true, ao: () => folhaLixeira('chat', chat.id, chat.titulo) },
    ] }),
  });
  const lista = el('div', { class: 'mensagens', id: 'mensagens' });
  const caixa = el('textarea', { id: 'texto', rows: '1', placeholder: 'Mensagem', 'aria-label': 'Mensagem' });
  caixa.value = rascunho;
  caixa.addEventListener('input', () => { caixa.style.height = 'auto'; caixa.style.height = `${Math.min(caixa.scrollHeight, 140)}px`; atualizarBotao(); });
  const botao = el('button', { id: 'enviar', class: 'redondo', 'aria-label': 'Enviar' }, el('span', { 'aria-hidden': 'true' }, '➤'));
  const clipe = el('button', { class: 'clipe', 'aria-label': 'Anexar arquivo', onclick: () => escolherArquivo(anexar) }, '📎');
  const atualizarBotao = () => atualizarEstadoDoChat();
  botao.addEventListener('click', async () => {
    if (botao.classList.contains('mic') || botao.classList.contains('gravando')) { void alternarGravacao(); return; }
    if (botao.classList.contains('parar')) { void enviarPedido({ ...novoPedido('parar', chat.id), assistente }).catch((erro) => { aviso = erro.message; desenhar(); }); return; }
    const texto = caixa.value.trim();
    const prontos = anexos.filter((a) => a.estado === 'ok');
    if (!texto && prontos.length === 0) return;
    const pedido = { ...novoPedido('mensagem', chat.id, texto), assistente, anexos: prontos.map((a) => ({ driveId: a.driveId, nome: a.nome })) };
    pendentes.push({ id: pedido.id, chat: assistente ? -1 : chat.id, texto: texto || prontos.map((a) => a.nome).join(', '), tipo: 'mensagem' });
    caixa.value = '';
    caixa.style.height = 'auto';
    anexos = [];
    vibrar();
    montarMensagens(chat, true);
    desenharAnexos();
    atualizarBotao();
    try { await enviarPedido(pedido); aviso = ''; } catch (erro) { aviso = erro.message; pendentes = pendentes.filter((p) => p.id !== pedido.id); montarMensagens(chat, false); }
  });
  caixa.addEventListener('keydown', (evento) => { if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) botao.click(); });
  const modelo = el('button', { class: 'modelo-chip', onclick: () => folhaModelo(chat, assistente) }, `🧠 ${nomeDoModelo(chat.modelo)} ▾`);
  const faixaPc = !estado || pcPresente(estado) ? null : el('p', { class: 'faixa-pc' }, 'O PC parece desligado. As mensagens esperam e são entregues quando ele ligar.');
  tela.append(lista, faixaPc, el('div', { id: 'aprovacoes' }), el('div', { id: 'anexos', class: 'anexos' }), el('div', { class: 'barra-modelo' }, modelo), el('div', { id: 'envio' }, clipe, caixa, botao));
  tela.classList.add('chat');
  montarMensagens(chat, true);
  montarAprovacoes();
  desenharAnexos();
  atualizarBotao();
}

function nomeDoModelo(id) {
  return (estado?.modelosClaude || []).find((item) => item.id === id)?.nome ?? 'Padrão';
}

function folhaModelo(chat, assistente) {
  abrirFolha({ titulo: 'Modelo do Claude', itens: (estado.modelosClaude || []).map((item) => ({
    rotulo: `${item.id === chat.modelo ? '✓ ' : ''}${item.nome}`,
    ao: () => void pedir({ ...novoPedido('ajustarChat', chat.id), assistente, modelo: item.id }, `Trocando para ${item.nome}…`),
  })) });
}

function aprovacoesPendentes() {
  return (estado?.aprovacoes || []).filter((item) => !respondidas.has(item.id));
}

/** What the global assistant asks to approve: the same question the PC shows. */
function montarAprovacoes() {
  const caixa = $('aprovacoes');
  if (!caixa) return;
  caixa.replaceChildren(...(rota.tipo === 'assistente' ? aprovacoesPendentes() : []).map((item) => el('div', { class: 'aprovacao' },
    el('p', {}, item.texto),
    el('div', { class: 'acoes' },
      el('button', { class: 'botao', onclick: () => responderAprovacao(item, true) }, 'Aprovar'),
      el('button', { class: 'botao sec', onclick: () => responderAprovacao(item, false) }, 'Recusar')))));
}

function responderAprovacao(item, aceitar) {
  respondidas.add(item.id);
  montarAprovacoes();
  vibrar();
  enviarPedido({ ...novoPedido('aprovar', 0), aprovacao: item.id, aceitar })
    .then(() => avisoRapido(aceitar ? 'Aprovado. O PC vai fazer agora.' : 'Recusado.'))
    .catch((erro) => { respondidas.delete(item.id); aviso = erro.message; montarAprovacoes(); avisoRapido(erro.message); });
}

/** The send button is a microphone when there is nothing to send, and a stop when the chat is answering. */
function estadoDoBotao(chat) {
  const botao = $('enviar');
  const caixa = $('texto');
  if (!botao || !caixa) return;
  const vazio = caixa.value.trim() === '' && anexos.length === 0;
  const parando = chat.ocupado && vazio;
  const mic = vazio && !chat.ocupado;
  botao.classList.toggle('parar', parando && vozEstado === '');
  botao.classList.toggle('mic', mic && vozEstado === '');
  botao.classList.toggle('gravando', vozEstado === 'gravando');
  const simbolo = vozEstado === 'gravando' ? '■' : vozEstado === 'transcrevendo' ? '…' : parando ? '■' : mic ? '🎤' : '➤';
  botao.firstChild.textContent = simbolo;
  botao.setAttribute('aria-label', vozEstado === 'gravando' ? 'Parar a gravação' : parando ? 'Parar a resposta' : mic ? 'Gravar mensagem de voz' : 'Enviar');
  botao.disabled = vozEstado === 'transcrevendo' || anexos.some((a) => a.estado === 'enviando');
  caixa.placeholder = vozEstado === 'gravando' ? 'Gravando… toque em ■ para parar' : vozEstado === 'transcrevendo' ? 'Transcrevendo no PC…' : 'Mensagem';
}

/** The phone's own speech recognition, when the browser has it (Chrome on Android). */
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition || null;

/** "celular" uses the phone's recognition, "pc" sends the recording to the Whisper on the PC. */
function modoDeVoz() {
  const salvo = guardado.ler('voz');
  if (salvo === 'pc' || salvo === 'celular') return salvo;
  return Reconhecimento ? 'celular' : 'pc';
}

/**
 * Writes what the phone's recognition hears straight into the message box, as it hears it, so the person
 * sees the words while speaking. Pressing the button again stops it; the text stays to be sent or edited.
 */
function ouvirDoCelular() {
  const caixa0 = $('texto');
  const base = caixa0 && caixa0.value.trim() ? `${caixa0.value.trim()} ` : '';
  const reconhecedor = new Reconhecimento();
  reconhecedor.lang = 'pt-BR';
  reconhecedor.interimResults = true;
  reconhecedor.continuous = true;
  reconhecedor.maxAlternatives = 1;
  let final = '';
  reconhecedor.onresult = (evento) => {
    let provisorio = '';
    final = '';
    for (const resultado of evento.results) {
      if (resultado.isFinal) final += resultado[0].transcript;
      else provisorio += resultado[0].transcript;
    }
    const caixa = $('texto');
    if (caixa) {
      caixa.value = `${base}${final}${provisorio}`.replace(/s+/g, ' ').replace(/^ /, '');
      caixa.dispatchEvent(new Event('input'));
    }
  };
  reconhecedor.onerror = (evento) => {
    const mensagens = {
      'no-speech': 'Não ouvi nada. Toque no microfone e fale.',
      'not-allowed': 'Permita o microfone nas configurações do Chrome.',
      'audio-capture': 'Não encontrei o microfone.',
      network: 'O reconhecimento precisa de internet. Verifique a conexão.',
    };
    avisoRapido(mensagens[evento.error] || `O reconhecimento parou (${evento.error}).`);
  };
  reconhecedor.onend = () => {
    gravacao = null;
    vozEstado = '';
    atualizarEstadoDoChat();
    $('texto')?.focus();
  };
  gravacao = { reconhecedor };
  vozEstado = 'gravando';
  try {
    reconhecedor.start();
    vibrar();
  } catch {
    gravacao = null;
    vozEstado = '';
    avisoRapido('Não consegui iniciar o microfone. Tente de novo.');
  }
  atualizarEstadoDoChat();
}

/** Records the person's voice; the PC turns it into text and the text goes into the box, ready to edit. */
async function alternarGravacao() {
  if (vozEstado === 'gravando' && gravacao?.reconhecedor) { gravacao.reconhecedor.stop(); return; }
  if (vozEstado === 'gravando' && gravacao) { gravacao.recorder.stop(); return; }
  if (modoDeVoz() === 'celular' && Reconhecimento) { ouvirDoCelular(); return; }
  if (estado && !estado.vozPronta) { avisoRapido('O PC ainda não tem o modelo de voz. No Hub, abra um chat e toque em Falar para baixar.'); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { avisoRapido('Este navegador não grava áudio.'); return; }
  try {
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((item) => MediaRecorder.isTypeSupported(item)) || '';
    const recorder = new MediaRecorder(fluxo, tipo ? { mimeType: tipo } : undefined);
    const pedacos = [];
    recorder.ondataavailable = (evento) => { if (evento.data.size > 0) pedacos.push(evento.data); };
    recorder.onstop = () => {
      for (const faixa of fluxo.getTracks()) faixa.stop();
      gravacao = null;
      const blob = new Blob(pedacos, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 800) { vozEstado = ''; atualizarEstadoDoChat(); avisoRapido('Não ouvi nada. Tente de novo.'); return; }
      void transcrever(blob);
    };
    gravacao = { recorder };
    vozEstado = 'gravando';
    recorder.start();
    vibrar();
    atualizarEstadoDoChat();
  } catch (erro) {
    vozEstado = '';
    avisoRapido(erro.name === 'NotAllowedError' ? 'Permita o microfone nas configurações do navegador.' : `Não consegui gravar: ${erro.message}`);
    atualizarEstadoDoChat();
  }
}

function atualizarEstadoDoChat() {
  const achado = chatAtual();
  estadoDoBotao(achado?.chat ?? { ocupado: false });
}

async function transcrever(blob) {
  vozEstado = 'transcrevendo';
  atualizarEstadoDoChat();
  try {
    const extensao = blob.type.includes('mp4') ? 'm4a' : 'webm';
    const arquivo = new File([blob], `fala-${Date.now()}.${extensao}`, { type: blob.type });
    const driveId = await enviarArquivoAoDrive(arquivo, () => undefined);
    const pedido = { ...novoPedido('transcrever', 0), driveId, nome: arquivo.name };
    vozPedido = pedido.id;
    await enviarPedido(pedido);
    setTimeout(() => { if (vozPedido === pedido.id && vozEstado === 'transcrevendo') { vozPedido = null; vozEstado = ''; avisoRapido('O PC não respondeu a tempo. Tente de novo.'); atualizarEstadoDoChat(); } }, 120_000);
  } catch (erro) {
    vozPedido = null;
    vozEstado = '';
    avisoRapido(erro.message);
    atualizarEstadoDoChat();
  }
}

/** When the PC's answer to a voice message arrives, the text goes into the message box. */
function aplicarVoz() {
  if (!vozPedido) return;
  const resultado = estado?.resultados?.[vozPedido];
  if (!resultado) return;
  vozPedido = null;
  vozEstado = '';
  if (resultado.ok && resultado.texto) {
    const caixa = $('texto');
    if (caixa) { caixa.value = caixa.value ? `${caixa.value} ${resultado.texto}` : resultado.texto; caixa.dispatchEvent(new Event('input')); caixa.focus(); }
  } else avisoRapido(resultado.mensagem || 'Não consegui transcrever.');
  atualizarEstadoDoChat();
}

function anexar(lista) {
  for (const arquivo of lista) {
    const anexo = { nome: arquivo.name, tamanho: arquivo.size, estado: 'enviando', progresso: 0, driveId: null };
    anexos.push(anexo);
    enviarArquivoAoDrive(arquivo, (fracao) => { anexo.progresso = fracao; desenharAnexos(); })
      .then((id) => { anexo.driveId = id; anexo.estado = 'ok'; })
      .catch((erro) => { anexo.estado = 'erro'; anexo.erro = erro.message; })
      .finally(() => { desenharAnexos(); $('texto')?.dispatchEvent(new Event('input')); });
  }
  desenharAnexos();
  $('texto')?.dispatchEvent(new Event('input'));
}

function desenharAnexos() {
  const caixa = $('anexos');
  if (!caixa) return;
  caixa.replaceChildren(...anexos.map((anexo, i) => el('span', { class: `chip ${anexo.estado}` },
    el('span', { class: 'chip-nome' }, anexo.nome),
    el('small', {}, anexo.estado === 'enviando' ? `${Math.round(anexo.progresso * 100)}%` : anexo.estado === 'erro' ? 'falhou' : tamanhoLegivel(anexo.tamanho)),
    el('button', { 'aria-label': `Tirar ${anexo.nome}`, onclick: () => { anexos.splice(i, 1); desenharAnexos(); $('texto')?.dispatchEvent(new Event('input')); } }, '×'))));
}

/** Draws the messages of the open chat. Only messages not seen before pop in. */
function montarMensagens(chat, rolar) {
  const lista = $('mensagens');
  if (!lista) return;
  const chave = rota.tipo === 'assistente' ? 'assistente' : chat.id;
  const ultimoVisto = vistas.get(chave) ?? 0;
  const perto = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 140;
  const textosVistos = new Set(chat.mensagens.map((m) => m.texto.trim()));
  pendentes = pendentes.filter((p) => p.tipo !== 'mensagem' || p.chat !== (rota.tipo === 'assistente' ? -1 : chat.id) || !textosVistos.has(p.texto.trim()));
  lista.replaceChildren();
  if (chat.mensagens.length === 0 && pendentes.length === 0) lista.append(el('p', { class: 'dica' }, 'Escreva a primeira mensagem para este chat.'));
  let dia = '';
  for (const mensagem of chat.mensagens) {
    const rotulo = rotuloDia(mensagem.quando);
    if (rotulo && rotulo !== dia) { dia = rotulo; lista.append(el('div', { class: 'dia' }, el('span', {}, rotulo))); }
    const minha = mensagem.papel === 'user';
    lista.append(el('div', { class: `balao ${minha ? 'minha' : mensagem.papel === 'system' ? 'sistema' : 'dela'}${mensagem.id > ultimoVisto && ultimoVisto ? ' nova' : ''}` },
      desenharTexto(mensagem.texto), mensagem.papel === 'system' ? null : el('span', { class: 'meta' }, hora(mensagem.quando), minha ? el('span', { class: 'ticks', 'aria-label': 'entregue' }, '✓✓') : null)));
  }
  for (const p of pendentes.filter((item) => item.tipo === 'mensagem' && item.chat === (rota.tipo === 'assistente' ? -1 : chat.id))) {
    const resultado = estado.resultados?.[p.id];
    lista.append(el('div', { class: 'balao minha nova' }, desenharTexto(p.texto),
      el('span', { class: `meta${resultado && !resultado.ok ? ' erro' : ''}` }, resultado ? (resultado.ok ? '✓✓' : resultado.mensagem) : 'enviando… 🕓')));
  }
  if (chat.ocupado) lista.append(el('div', { class: 'balao dela digitando', 'aria-label': 'respondendo' }, el('i'), el('i'), el('i')));
  const ultimo = chat.mensagens.at(-1)?.id ?? 0;
  vistas.set(chave, ultimo);
  if (rolar || perto) lista.scrollTop = lista.scrollHeight;
  estadoDoBotao(chat);
}

// ---------- arquivos e ajustes

function desenharArquivos() {
  const trabalho = trabalhoAtual();
  if (!trabalho) return voltarUma();
  definirTopo({ titulo: 'Arquivos', sub: trabalho.nome, voltar: true });
  if (trabalho.arquivos.length === 0) tela.append(el('div', { class: 'vazio' }, el('p', {}, 'Nenhum arquivo deste trabalho está no Drive.')));
  const previa = el('div', { class: 'previa' });
  for (const arquivo of trabalho.arquivos) {
    const tipo = tipoDoArquivo(arquivo.nome);
    const emoji = { imagem: '🖼️', audio: '🎵', video: '🎬', texto: '📄', outro: '📦' }[tipo];
    tela.append(el('button', { class: 'linha', onclick: () => void abrirArquivo(arquivo, previa) },
      bolinha(arquivo.nome, { emoji, cor: 'var(--elevado)' }), el('span', { class: 'nome' }, arquivo.nome, el('small', { class: 'sub' }, tamanhoLegivel(arquivo.tamanho)))));
  }
  tela.append(previa);
}

async function abrirArquivo(arquivo, destino) {
  destino.replaceChildren(el('p', { class: 'suave' }, `Baixando ${arquivo.nome}…`));
  destino.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

function desenharAjustes() {
  definirTopo({ titulo: 'Ajustes', abas: true });
  const temaAtual = document.documentElement.dataset.tema;
  tela.append(
    el('h2', { class: 'secao' }, 'Aparência'),
    el('div', { class: 'temas', role: 'radiogroup', 'aria-label': 'Tema' }, ...TEMAS.map((tema) => {
      const botao = el('button', { class: `tema${tema.id === temaAtual ? ' ativo' : ''}`, role: 'radio', 'aria-checked': String(tema.id === temaAtual), onclick: () => { guardado.gravar('tema', tema.id); aplicarAparencia(); desenhar(); } },
        el('span', { class: 'amostra' }), tema.nome);
      botao.querySelector('.amostra').style.background = `linear-gradient(135deg, ${tema.amostra[0]} 55%, ${tema.amostra[1]} 55%)`;
      return botao;
    })),
    el('h2', { class: 'secao' }, 'Voz'),
    el('div', { class: 'cartao' },
      el('p', { class: 'suave pequeno' }, Reconhecimento ? 'Quem entende a sua fala:' : 'Este navegador não tem reconhecimento de voz; a fala vai para o PC.'),
      el('div', { class: 'temas', role: 'radiogroup', 'aria-label': 'Reconhecimento de voz' },
        el('button', { class: `tema${modoDeVoz() === 'celular' ? ' ativo' : ''}`, role: 'radio', 'aria-checked': String(modoDeVoz() === 'celular'), disabled: !Reconhecimento, onclick: () => { guardado.gravar('voz', 'celular'); desenhar(); } }, 'Este celular'),
        el('button', { class: `tema${modoDeVoz() === 'pc' ? ' ativo' : ''}`, role: 'radio', 'aria-checked': String(modoDeVoz() === 'pc'), onclick: () => { guardado.gravar('voz', 'pc'); desenhar(); } }, 'PC (Whisper)')),
      el('p', { class: 'suave pequeno' }, 'Este celular é mais rápido, mas precisa de internet e usa o reconhecimento do Chrome. O PC é mais preciso, mas precisa estar ligado e leva alguns segundos.')),
    el('p', { class: 'suave pequeno' }, 'Cor de destaque'),
    el('div', { class: 'grade-cores', role: 'radiogroup', 'aria-label': 'Cor de destaque' },
      el('button', { class: `auto${guardado.ler('cor') ? '' : ' ativo'}`, 'aria-label': 'Cor do tema', onclick: () => { guardado.apagar('cor'); aplicarAparencia(); desenhar(); } }, 'A'),
      ...CORES.map((cor) => { const b = el('button', { 'data-cor': cor, class: guardado.ler('cor') === cor ? 'ativo' : '', 'aria-label': `Cor ${cor}`, onclick: () => { guardado.gravar('cor', cor); aplicarAparencia(); desenhar(); } }); b.style.background = cor; return b; })),
    el('h2', { class: 'secao' }, 'Uso do Claude no mês'),
    desenharOrcamento(),
    el('h2', { class: 'secao' }, 'Conta e PC'),
    el('div', { class: 'cartao' },
      el('p', {}, estado ? (pcPresente(estado) ? '🟢 O PC está ligado e respondendo.' : `🔴 O PC não responde desde ${haQuanto(estado.atualizadoEm)}.`) : ''),
      el('p', { class: 'suave pequeno' }, 'Se o PC estiver desligado, as mensagens ficam esperando e são entregues quando ele ligar.'),
      el('button', { class: 'botao sec', onclick: () => { rota = { tipo: 'config' }; desenhar(); } }, 'Trocar o ID do cliente'),
      el('button', { class: 'botao sec', onclick: () => { for (const chave of ['token', 'tokenAte', 'renovacao']) guardado.apagar(chave); sessao.token = null; estado = null; assinatura = ''; historico = []; rota = { tipo: 'inicio' }; aviso = ''; desenhar(); } }, 'Sair do Google')),
  );
}

function desenharOrcamento() {
  const o = estado.orcamento;
  if (!o) return el('p', { class: 'suave' }, 'Sem dados de uso.');
  const razao = o.limite ? Math.min(1, o.gasto / o.limite) : 0;
  const barra = el('div', { class: `barra ${o.estado}`, role: 'progressbar', 'aria-valuenow': String(Math.round(razao * 100)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i'));
  barra.firstChild.style.width = `${Math.round(razao * 100)}%`;
  return el('div', { class: 'cartao' },
    el('p', {}, o.limite ? `${dinheiro(o.gasto)} de ${dinheiro(o.limite)}` : `${dinheiro(o.gasto)} gastos este mês`),
    o.limite ? barra : el('p', { class: 'suave pequeno' }, 'Sem limite definido. Defina no Hub, em Configurações › Uso e limites.'),
    o.estado === 'exceeded' ? el('p', { class: 'erro' }, 'O limite do mês foi atingido: os chats não respondem até aumentar o limite no PC.') : null);
}

// ---------- ciclo

async function carregar() {
  if (carregando || !configurado() || !guardado.ler('renovacao')) return;
  carregando = true;
  try {
    const novo = await lerEstado();
    const sem = JSON.stringify({ ...novo, atualizadoEm: '' });
    const mudou = sem !== assinatura;
    const primeiro = !estado;
    estado = novo;
    assinatura = sem;
    try { const texto = JSON.stringify(novo); if (texto.length < 1_500_000) guardado.gravar('estadoCache', texto); } catch { /* sem cache */ }
    aplicarVoz();
    aviso = aviso && !aviso.startsWith('Enviando') ? '' : aviso;
    if (primeiro || (mudou && !folha)) {
      if (rota.tipo === 'chat' || rota.tipo === 'assistente') {
        const achado = chatAtual();
        if (achado && $('mensagens')) { definirTopoDoChat(achado.chat); montarMensagens(achado.chat, false); montarAprovacoes(); }
        else desenhar();
      } else desenhar();
    } else definirTopoPc();
  } catch (erro) {
    if (!estado || precisaEntrar) { aviso = erro.message; desenhar(); }
  } finally {
    carregando = false;
  }
}

function definirTopoPc() {
  const presente = estado ? pcPresente(estado) : false;
  topo.pc.className = `pc ${estado ? (presente ? 'on' : 'off') : ''}`;
  topo.pc.textContent = estado && !presente ? 'PC desligado?' : '';
}

function definirTopoDoChat(chat) {
  topo.sub.textContent = rota.tipo === 'assistente' ? (chat.ocupado ? 'respondendo…' : 'controla o Hub com a sua aprovação no PC') : situacaoDoChat(chat);
  definirTopoPc();
}

function agendar() {
  const espera = Date.now() < rapidoAte ? POLL_RAPIDO_MS : POLL_MS;
  setTimeout(() => {
    if (!document.hidden) void carregar();
    agendar();
  }, espera);
}

topo.voltar.addEventListener('click', voltarNavegacao);
window.addEventListener('popstate', () => {
  if (historico.length > 0) voltarUma();
  else if (rota.tipo !== 'inicio') {
    rota = { tipo: 'inicio' };
    folha = null;
    desenhar('volta');
    try { window.history.pushState({ hub: true }, ''); } catch { /* idem */ }
  }
});
for (const botao of topo.abas.querySelectorAll('button')) {
  botao.addEventListener('click', () => {
    const aba = botao.dataset.aba;
    historico = [];
    rota = { tipo: aba };
    folha = null;
    desenhar('frente');
  });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) void carregar(); });

aplicarAparencia();
await terminarLogin();
if (!configurado()) rota = { tipo: 'config' };
try { window.history.replaceState({ hub: true }, ''); } catch { /* idem */ }
desenhar();
void carregar();
agendar();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => undefined);
void lerData;
