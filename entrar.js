// Google login that lasts: the code flow with PKCE and a refresh token, so the page renews its own access
// without asking again. The client secret is typed on the phone and stays in this browser.

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';

export function base64url(bytes) {
  let texto = '';
  for (const byte of bytes) texto += String.fromCharCode(byte);
  return btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function aleatorio(tamanho = 48) {
  return base64url(crypto.getRandomValues(new Uint8Array(tamanho)));
}

export async function desafio(verificador) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador))));
}

/** The address Google sends the person back to: this page, exactly as it is opened. */
export function enderecoDeRetorno(local = window.location) {
  return `${local.origin}${local.pathname}`;
}

/** The Google page that asks for the person's permission. `access_type=offline` is what gives the refresh token. */
export async function enderecoDeLogin({ clientId, retorno, estado, verificador }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: retorno,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: await desafio(verificador),
    code_challenge_method: 'S256',
    state: estado,
  });
  return `${AUTH}?${params}`;
}

async function pedir(corpo, buscar = fetch) {
  const resposta = await buscar(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corpo),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(dados.error_description || dados.error || `O Google respondeu ${resposta.status}.`);
    erro.codigo = dados.error;
    throw erro;
  }
  return dados;
}

/** Trades the code Google sent back for an access token and the refresh token. */
export function trocarCodigo({ clientId, segredo, codigo, retorno, verificador }, buscar) {
  return pedir({ client_id: clientId, client_secret: segredo, code: codigo, redirect_uri: retorno, grant_type: 'authorization_code', code_verifier: verificador }, buscar);
}

/** A new access token from the refresh token. No window, no tap. */
export function renovar({ clientId, segredo, renovacao }, buscar) {
  return pedir({ client_id: clientId, client_secret: segredo, refresh_token: renovacao, grant_type: 'refresh_token' }, buscar);
}
