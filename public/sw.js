// Service worker app học: lưu vỏ trang /hoc và tệp tĩnh để mở được khi mất mạng.
// Không lưu dữ liệu riêng hay API: nội dung trả phí chỉ nằm trong IndexedDB theo từng người + máy.
const CACHE = "me-shell-v1";
const SHELL = "/hoc";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function storeIfGood(cache, key, res) {
  if (res.ok && !res.redirected && res.type === "basic") await cache.put(key, res.clone());
  return res;
}

// Trang vừa tải trước khi service worker kiểm soát: trang gửi danh sách tệp để lưu ngay.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of event.data.urls) {
        const parsed = new URL(url, self.location.origin);
        if (parsed.origin !== self.location.origin) continue;
        if (!parsed.pathname.startsWith("/_next/static/") && parsed.pathname !== SHELL) continue;
        const key = parsed.pathname === SHELL ? SHELL : parsed.href;
        await fetch(parsed.href).then((res) => storeIfGood(cache, key, res)).catch(() => undefined);
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && url.pathname === SHELL) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          return await storeIfGood(cache, SHELL, await fetch(request));
        } catch {
          return (await cache.match(SHELL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(url.href)) ?? storeIfGood(cache, url.href, await fetch(request));
      })(),
    );
  }
});
