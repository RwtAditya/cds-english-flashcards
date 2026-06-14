const CACHE_NAME = 'cds-flashcards-v2.0';
const ASSETS = [
  './',
  'index.html',
  'styles.css?v=2.0',
  'app.js?v=2.0',
  'manifest.json',
  'pwa_icon_512.png'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Caching assets...');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch Event (Stale-While-Revalidate)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip cross-origin POST or non-GET requests (e.g. GitHub API)
  if (event.request.method !== 'GET') {
    return;
  }
  
  // For API calls (like GitHub API), bypass cache completely
  if (url.hostname.includes('api.github.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Fetch fresh copy in the background and update the cache
        fetch(event.request).then(networkResponse => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        
        return cachedResponse;
      }
      
      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        return networkResponse;
      }).catch(() => {
        return null;
      });
    })
  );
});
