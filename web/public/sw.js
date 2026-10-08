const CACHE = "baby-shell-v2";
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll([
          "/",
          "/manifest.webmanifest",
          "/icon-192.png",
          "/icon-512.png",
        ]);
        // Vite emits hashed script/style URLs into the shell. Cache them before
        // installation completes so the first offline reload can actually start.
        const html = await (await cache.match("/")).text();
        const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
          .map((match) => new URL(match[1], self.location.origin))
          .filter(
            (url) =>
              url.origin === self.location.origin &&
              url.pathname.startsWith("/assets/") &&
              /\.(js|css)$/.test(url.pathname),
          )
          .map((url) => url.href);
        await cache.addAll([...new Set(assets)]);
      })
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("baby-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok)
            (await caches.open(CACHE)).put("/", response.clone());
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then(async (response) => {
          if (response.ok)
            (await caches.open(CACHE)).put(event.request, response.clone());
          return response;
        }),
    ),
  );
});

function appUrl(value) {
  try {
    const url = new URL(value ?? "/", self.location.origin);
    if (url.origin === self.location.origin) return url.href;
  } catch {
    /* Use the app home for invalid links. */
  }
  return self.location.origin + "/";
}

async function updateBadge(value) {
  if (value === undefined || value === null) return;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) return;
  try {
    if (count === 0 && self.navigator.clearAppBadge)
      await self.navigator.clearAppBadge();
    else if (self.navigator.setAppBadge)
      await self.navigator.setAppBadge(count);
  } catch {
    /* Badging must never prevent a visible notification. */
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    /* Always show a visible fallback. */
  }
  if (!data || typeof data !== "object") data = {};
  const notification =
    data.web_push === 8030 &&
    data.notification &&
    typeof data.notification === "object"
      ? data.notification
      : data;
  const url = appUrl(
    notification.navigate ?? notification.url ?? notification.data?.url,
  );
  event.waitUntil(
    (async () => {
      // New iOS displays the declarative payload, or older browsers display it here.
      // Repeated delivery sets an absolute badge count rather than incrementing it.
      await self.registration.showNotification(
        notification.title ?? "Timer reminder",
        {
          body: notification.body ?? "Tap to review your timer.",
          tag: notification.tag ?? "baby-timer",
          icon: "/icon-192.png",
          requireInteraction: notification.requireInteraction === true,
          renotify: notification.renotify === true,
          data: {
            url,
            alertId: notification.data?.alertId ?? data.alertId ?? null,
          },
        },
      );
      await updateBadge(notification.app_badge ?? data.badgeCount);
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const client = clients.find(
          (candidate) => new URL(candidate.url).origin === self.location.origin,
        );
        if (client) {
          await client.navigate(url);
          return client.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
