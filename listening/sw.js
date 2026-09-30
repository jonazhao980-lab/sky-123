/* 离线支持：页面文件联网优先（保证更新马上生效），课程音频缓存优先；
   Safari 播放音频会发 Range 请求，缓存命中时要自己切片返回 206，否则离线播不了。 */
const SHELL = "shell-v2";
const FILES = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest",
  "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k.startsWith("shell-") && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

async function ranged(req, res) {
  const h = req.headers.get("range");
  if (!h) return res;
  const buf = await res.arrayBuffer(), n = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(h) || [];
  let s = m[1] ? +m[1] : 0, e = m[2] ? Math.min(+m[2], n - 1) : n - 1;
  if (!m[1] && m[2]) { s = Math.max(0, n - +m[2]); e = n - 1; }
  return new Response(buf.slice(s, e + 1), { status: 206, headers: {
    "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
    "Content-Range": `bytes ${s}-${e}/${n}`, "Content-Length": String(e - s + 1), "Accept-Ranges": "bytes" } });
}

async function networkFirst(req, cacheName, opts) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(req, { signal: ctl.signal }); clearTimeout(t);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await caches.match(req, opts);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET") return;
  if (u.origin === location.origin) {
    if (u.pathname.endsWith("/lessons/index.json")) return e.respondWith(networkFirst(req, "lessons", { ignoreSearch: true }));
    if (u.pathname.includes("/lessons/")) {
      return e.respondWith(caches.match(req.url).then(hit => hit ? ranged(req, hit) : fetch(req)));
    }
    if (req.mode === "navigate") return e.respondWith(networkFirst(req, SHELL, { ignoreSearch: true }).catch(() => caches.match("index.html")));
    return e.respondWith(networkFirst(req, SHELL, { ignoreSearch: true }));
  }
});
