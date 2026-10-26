/* QT 노트 service worker
 * - 페이지(암호화된 index.html)와 아이콘: 캐시에서 바로 보여주고, 뒤에서 새 버전을 받아 둔다.
 *   새 버전을 받으면 열린 페이지에 'page-updated'를 보내 "새로고침" 안내를 띄운다.
 * - 웹폰트(jsdelivr): 처음 쓸 때 캐시해서 오프라인에서도 같은 글꼴로 보이게 한다.
 */
const SHELL = 'qt-notes-shell-v2';
const FONTS = 'qt-notes-fonts-v1';
const KEEP = [SHELL, FONTS];
const PAGE = new URL('./', self.registration.scope).href;
const SHELL_FILES = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(SHELL_FILES.map((p) => new Request(p, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('qt-notes-') && !KEEP.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (!url.href.startsWith(self.registration.scope)) return;
    if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/version.txt')) return;
    event.respondWith(shellResponse(event));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') event.respondWith(fontResponse(req));
});

function keyOf(href) {
  const u = new URL(href);
  u.search = ''; u.hash = '';
  if (u.href.endsWith('/index.html')) return u.href.slice(0, -'index.html'.length);
  return u.href;
}

async function shellResponse(event) {
  const req = event.request;
  const key = keyOf(req.url);
  const cache = await caches.open(SHELL);
  const cached = await cache.match(key);

  const refresh = (async () => {
    try {
      const fresh = await fetch(key, { cache: 'no-cache' });
      if (!fresh.ok) return null;
      const changed = cached && versionOf(cached) !== versionOf(fresh);
      await cache.put(key, fresh.clone());
      if (changed && key === PAGE) notify({ type: 'page-updated' });
      return fresh;
    } catch (e) {
      return null;
    }
  })();

  if (cached) { event.waitUntil(refresh); return cached; }
  const fresh = await refresh;
  if (fresh) return fresh;
  if (req.mode === 'navigate') { const page = await cache.match(PAGE); if (page) return page; }
  return Response.error();
}

function versionOf(res) {
  return res.headers.get('etag') || res.headers.get('last-modified') || res.headers.get('content-length') || '';
}

async function notify(msg) {
  const list = await self.clients.matchAll({ type: 'window' });
  list.forEach((c) => c.postMessage(msg));
}

async function fontResponse(req) {
  const cache = await caches.open(FONTS);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  try {
    const net = await fetch(req);
    if (net.ok || net.type === 'opaque') { try { await cache.put(req.url, net.clone()); } catch (e) {} }
    return net;
  } catch (e) {
    return Response.error();
  }
}
