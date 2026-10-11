// Keeps the app usable with no signal after a crash.
const CACHE = 'crashline-v12';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'util.js', 'detector.js', 'guidance.js', 'i18n.js', 'talk.js', 'install.js', 'blackbox.js', 'bbview.js', 'autostart.js', 'obd.js', 'platform.js', 'auth.js', 'settings.js', 'desktop.js', 'authpanel.js', 'invites.js', 'contacts.js', 'join.html', 'join.js', 'alert.html', 'alert.js', 'people.js', 'scenarios.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/qrcode.js', 'vendor/auth0-spa-js.esm.js',
  'manifest.json', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Network first (so edits show up during the hackathon), cache when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

// ---- crash alerts for emergency contacts ----
const SOS = [200, 100, 200, 100, 200, 300, 600, 100, 600, 100, 600, 300, 200, 100, 200, 100, 200];

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const crash = d.kind === 'crash' || !d.kind;
  e.waitUntil(self.registration.showNotification(d.title || 'Crashline alert', {
    body: d.body || 'Someone you care about may have been in a crash.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || 'crashline-alert',
    requireInteraction: crash,     // stays on screen until handled
    renotify: true,
    silent: false,
    vibrate: crash ? SOS : [120, 60, 120],
    actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : [],
    timestamp: Date.now(),
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url = (e.notification.data && e.notification.data.url) || '/';
  if (e.action === 'onway') url += (url.includes('?') ? '&' : '?') + 'ack=on_way';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(url, self.location.origin).href;
    const open = all.find((c) => c.url === target);
    if (open) return open.focus();
    return self.clients.openWindow(target);
  })());
});
