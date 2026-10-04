// __BUILD_ID__ e substituido no build (scripts/stamp-sw.js) por um valor
// unico a cada deploy, pra forcar o navegador a detectar o sw.js como
// mudado, instalar a nova versao e limpar o cache antigo no activate --
// sem isso o CACHE_NAME ficava fixo entre deploys e o celular continuava
// servindo a versao antiga indefinidamente quando a rede (Tailscale via
// DERP, por ex.) demorava ou falhava e caia no fallback de cache.
const CACHE_NAME = 'financas-shell-__BUILD_ID__';
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
    );
    self.clients.claim();
});

// So intercepta GET de paginas/estaticos do proprio front. Chamadas de API
// (sempre mutacao ou dados sensiveis do usuario) nunca passam por cache --
// lancamento offline no QuickAdd e' responsabilidade da fila em IndexedDB
// (ver src/offline/quickAddQueue.js), nao do service worker.
self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
});
