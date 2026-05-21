/**
 * GYMONIC Service Worker
 * Caches static assets so the app loads offline after first visit.
 * MediaPipe model files are NOT cached (too large, served from CDN).
 */

const CACHE_NAME = 'gymonic-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/exercise-fsm.js',
  '/js/angle-engine.js',
  '/js/smoother.js',
  '/js/form-validator.js',
  '/js/renderer.js',
  '/js/voice-coach.js',
  '/js/exercise-database.js',
  '/js/progress-tracker.js',
  '/js/goals.js',
  '/js/analytics.js',
  '/js/gamification.js',
  '/js/adaptive-ai.js',
  '/js/calibration.js',
  '/js/confidence-filter.js',
  '/js/session-guard.js',
  '/js/rest-timer.js',
  '/js/fatigue-detector.js',
  '/js/wrong-exercise-detector.js',
];

// Install: pre-cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    }).catch(err => console.warn('[SW] Pre-cache failed:', err))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for local assets, network-only for CDN/MediaPipe
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip CDN requests (MediaPipe, Google Fonts) — always go to network
  if (!url.origin.includes(self.location.origin)) {
    return; // let browser handle it normally
  }

  // Cache-first strategy for our own files
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful GET responses
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
