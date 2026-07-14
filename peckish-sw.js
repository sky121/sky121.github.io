/* Peckish service worker — registered with scope '/eats' so it only ever
   controls the Peckish page, never the rest of the portfolio.
   Strategy: network-first with cache fallback, so updates always win when
   online and demo mode keeps working offline. */
'use strict';

var CACHE = 'peckish-v1';
var CORE = [
  '/eats.html',
  '/assets/css/eats.css',
  '/assets/css/exhibit-page.css',
  '/assets/js/eats.js',
  '/assets/js/gallery.js',
  '/favicon.svg',
  '/peckish.webmanifest',
  '/images/peckish-icon-192.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts/Places go to network

  e.respondWith(
    fetch(req).then(function (res) {
      // keep the cache fresh on every successful fetch
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('/eats.html');
      });
    })
  );
});
