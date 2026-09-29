// service-worker.js — кешує "оболонку" застосунку (HTML/CSS/JS/іконки) для
// офлайн-роботи. Відео НЕ кешується тут навмисно: воно зберігається окремо
// в IndexedDB (див. js/db.js) і завантажується як Blob, тому не проходить
// через звичайні мережеві запити, які перехоплює service worker.
//
// !! Якщо ви додаєте/перейменовуєте файли проекту — оновіть APP_SHELL і
// підвищіть CACHE_NAME (наприклад, "v2"), інакше пристрої з уже встановленим
// PWA продовжуватимуть використовувати старий кеш.

const CACHE_NAME = 'screensaver-shell-v4';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/db.js',
  './js/screensaver.js',
  './js/adminPanel.js',
  './js/install.js',
  './js/wakeLock.js',
  './js/fullscreen.js',
  './js/videoSource.js',
  './js/exitApp.js',
  './js/cloudSync.js',
  './js/cloud-config.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Стратегія "cache-first": якщо ресурс є в кеші — віддаємо його одразу
// (миттєво і офлайн-стійко), інакше йдемо в мережу і кешуємо відповідь
// на майбутнє.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);
    })
  );
});
