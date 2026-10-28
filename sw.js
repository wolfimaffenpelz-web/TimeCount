const CACHE = "timecount-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/core.js",
  "./src/db.js",
  "./src/holidays.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("timecount-") && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data !== "ACTIVATE") return;
  event.waitUntil(
    (async () => {
      const clients = (
        await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        })
      ).filter((client) => client.url.startsWith(self.registration.scope));
      try {
        await Promise.all(
          clients.map(
            (client) =>
              new Promise((resolve, reject) => {
                const channel = new MessageChannel();
                const timer = setTimeout(() => {
                  channel.port1.close();
                  reject(Error("Tab nicht bereit"));
                }, 10000);
                channel.port1.onmessage = (event) => {
                  if (event.data === "READY") {
                    clearTimeout(timer);
                    channel.port1.close();
                    resolve();
                  }
                };
                client.postMessage("PREPARE_UPDATE", [channel.port2]);
              }),
          ),
        );
        await self.skipWaiting();
      } catch {
        for (const client of await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        }))
          client.postMessage("UPDATE_CANCELLED");
      }
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch {
        if (event.request.mode === "navigate")
          return cache.match("./index.html");
        return Response.error();
      }
    })(),
  );
});
