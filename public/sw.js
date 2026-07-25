// Service worker: rende l'app apribile e navigabile offline.
// NB: i VIDEO YouTube richiedono comunque la rete per lo streaming.
const VERSION = "attacca-v8"; // v8: CSP, registrazione del SW in un file suo
const SHELL = [
  "/",
  "/admin",
  "/css/styles.css",
  "/js/common.js",
  "/js/player.js",
  "/js/admin.js",
  "/js/sw-register.js",
  "/manifest.webmanifest",
  "/fonts/bc-600.woff2",
  "/fonts/bc-700.woff2",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Solo GET sullo stesso dominio.
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Stato della sessione: mai dalla cache. Una risposta "sei dentro" servita
  // offline sbloccherebbe l'interfaccia admin senza che il server confermi nulla.
  if (url.pathname === "/api/session") return;

  // API eventi: rete prima, poi cache (per vedere sempre l'ultima versione se online).
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Le pagine /e/:id sono servite dalla index.html cacheata.
  if (url.pathname.startsWith("/e/")) {
    e.respondWith(caches.match("/").then((r) => r || fetch(req)));
    return;
  }

  // Resto: cache prima, poi rete.
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => cached))
  );
});
