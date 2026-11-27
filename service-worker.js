const CACHE_NAME = 'kvit-v1.5.1';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png'
];

const EXTERNAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];

// Domény a endpointy, které musí vždy komunikovat napřímo se sítí (Firebase Auth, Firestore, Pi Sync)
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseio.com',
  'firebaseapp.com',
  'accounts.google.com'
];

// Instalace - odolné uložení základních souborů, Tailwind CSS a ikon do cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. Lokální soubory a ikony
      await Promise.allSettled(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('Kvit SW: Nepodařilo se kešovat lokální soubor:', url, err))
        )
      );

      // 2. Externí skripty (Tailwind CSS + Firebase SDK) včetně podpory opaque odpovědí
      await Promise.allSettled(
        EXTERNAL_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { mode: 'cors' });
            if (response && (response.ok || response.type === 'opaque')) {
              await cache.put(url, response);
            }
          } catch (e) {
            try {
              const opaqueResponse = await fetch(url, { mode: 'no-cors' });
              if (opaqueResponse) {
                await cache.put(url, opaqueResponse);
              }
            } catch (err) {
              console.warn('Kvit SW: Nepodařilo se kešovat externí zdroj:', url, err);
            }
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// Aktivace - odstranění starých verzí cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Zachytávání požadavků
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Zápisy do Firestore, Firebase Auth i Raspberry Pi POST požadavky necháme projít bez zásahu
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // Ignorujeme interní schémata prohlížeče
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Neblokujeme živou komunikaci s Firebase ani synchronizaci na lokální Raspberry Pi server
  if (
    BYPASS_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host)) ||
    url.pathname.endsWith('sync.php')
  ) {
    return;
  }

  // Pro hlavní HTML dokument použijeme Network-First (online vždy čerstvá verze, offline fallback z cache)
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
    );
    return;
  }

  // Pro Tailwind CSS, ikony, manifest a statické skripty použijeme Cache-First s dogenerováním do cache
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(req)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkResponse;
        })
        .catch(() => {
          console.warn('Kvit SW: Zdroj není dostupný offline:', req.url);
        });
    })
  );
});
