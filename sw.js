// Service worker Valio — installable + chargement rapide, sans jamais mettre en cache
// les données live (prix, fondamentaux, Supabase). Stratégie : network-first pour la
// coquille de l'app, bypass total pour les API.
const CACHE = 'valio-v2';
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

// ═══ NOTIFICATIONS PUSH ═══════════════════════════════════════════════════
// Réception d'une notification envoyée par le serveur (arrive même app fermée)
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (_) { payload = { title: 'Valio', body: e.data ? e.data.text() : '' }; }
  const title = payload.title || 'Valio';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'valio-alert',
    data: { url: payload.url || '/' },
    vibrate: [80, 40, 80],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur la notification → ouvre/réveille l'app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
