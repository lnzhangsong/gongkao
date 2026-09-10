/*
 * 读本离线 Service Worker：
 * - 页面导航（index.html 壳）：network-first——在线永远拿最新版，离线回退缓存。
 *   此前壳也 cache-first，发新版后浏览器一直用旧 index.html 引旧 JS，造成「更新不生效」
 * - hashed assets / 字体：cache-first（文件名带 hash 内容不可变，可放心长缓存）
 * - /api/* 一律不缓存（数据离线由应用层 IndexedDB 兜底，避免读到过期数据）
 * - 版本更新：CACHE 名变更后 activate 时清理旧缓存
 */
const CACHE = 'readbook-v2'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // 页面导航：network-first，拿到新壳顺带刷新缓存；断网回退旧壳
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          const cache = await caches.open(CACHE)
          await cache.put('/', res.clone())
          return res
        } catch {
          const shell = (await caches.match('/')) ?? (await caches.match(req))
          if (shell) return shell
          return Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req)
      if (cached) return cached
      const res = await fetch(req)
      if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/'))) {
        const cache = await caches.open(CACHE)
        await cache.put(req, res.clone())
      }
      return res
    })(),
  )
})
