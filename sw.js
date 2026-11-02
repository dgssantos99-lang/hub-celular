// Keeps the page itself on the phone so it opens at once; the Drive is never cached.
const NOME = 'hub-celular-v3';
const ARQUIVOS = ['./', 'index.html', 'app.js', 'entrar.js', 'logica.js', 'estilo.css', 'icone.svg', 'manifest.webmanifest'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(NOME).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) => Promise.all(nomes.filter((nome) => nome !== NOME).map((nome) => caches.delete(nome)))),
  );
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);
  if (url.origin !== self.location.origin || evento.request.method !== 'GET') return;
  // The page's own files: from the network when there is one, so an update arrives, otherwise from the phone.
  evento.respondWith(fetch(evento.request).catch(() => caches.match(evento.request)));
});
