// Service worker Valio — installable + chargement rapide, sans jamais mettre en cache
// les données live (prix, fondamentaux, Supabase). Stratégie : network-first pour la
// coquille de l'app, bypass total pour les API.
const CACHE = 'valio-v1';
const SHELL = ['/', '/index.html', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Ne JAMAIS intercepter les appels dynamiques (prix, données, auth) → toujours réseau
  const isApi = url.pathname.startsWith('/api/') ||
                url.hostname.includes('supabase') ||
                url.hostname.includes('anthropic') ||
                url.search.includes('symbol=');
  if (e.request.method !== 'GET' || isApi) return; // laisse passer au réseau normalement

  // Coquille de l'app : réseau d'abord, cache en secours (hors-ligne)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(()=>{});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});
