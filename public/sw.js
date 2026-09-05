/* 喚雨後台 Service Worker
   規則很簡單，帳務系統不能給過期資料：
   - /api/* 一律走網路，不做任何快取（離線時直接失敗，前端會顯示離線提示）
   - 靜態檔（js / css / icons / manifest）先給快取再背景更新（stale-while-revalidate）
   - 導覽請求（開啟頁面）先走網路，離線才回退到快取的頁面或離線頁
   版本號改了就會清掉舊快取。 */
const VERSION = 'meow-v1';
const SHELL = ['/', '/rules', '/offline.html', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // 個別失敗不能讓整包安裝失敗（例如 /rules 暫時 500）
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 後台改版後要能馬上換掉舊的 SW（前端會送這個訊息）
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

const isStatic = url => /^\/(js|css|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 帳務資料與登入狀態一律即時，不進快取
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(VERSION);
        c.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        return (await caches.match(req)) || (await caches.match('/'))
            || (await caches.match('/offline.html'))
            || new Response('離線中', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  if (!isStatic(url)) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()).catch(() => {}); return res; })
                          .catch(() => hit);
    return hit || net;
  })());
});
