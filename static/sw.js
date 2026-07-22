const CACHE_NAME = "aceituna-cache-v20";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon.svg"
];

// Instalar el Service Worker y almacenar en caché el 'App Shell'
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("PWA: Almacenando en caché los archivos base...");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activar el Service Worker y limpiar cachés antiguas
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("PWA: Eliminando caché antigua:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Interceptar peticiones para funcionamiento sin conexión (offline)
self.addEventListener("fetch", (e) => {
  // Ignorar peticiones externas (por ejemplo, a Google Fonts)
  if (!e.request.url.startsWith(self.location.origin)) return;

  // Para llamadas a la API, siempre ir a la red (datos en tiempo real) y no cachear
  if (e.request.url.includes("/api/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Para los recursos estáticos de la app, probar primero caché y luego red
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
