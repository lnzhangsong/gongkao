/*
 * 读本离线 Service Worker：
 * - 静态资源（ hashed assets / 字体 / 导航 shell）cache-first，离线可读
 * - /api/* 一律不缓存（数据离线由应用层 IndexedDB 兜底，避免读到过期数据）
 * - 版本更新：CACHE 名变更后 activate 时清理旧缓存
 */
const CACHE = 'readbook-v1'

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

  event.respondWith(
    (async () => {
      const cached = await caches.match(req)
      if (cached) return cached
      try {
        const res = await fetch(req)
        const cacheable =
          res.ok &&
          (req.mode === 'navigate' ||
            url.pathname.startsWith('/assets/') ||
            url.pathname.startsWith('/fonts/'))
        if (cacheable) {
          const cache = await caches.open(CACHE)
          cache.put(req, res.clone())
        }
        return res
      } catch (err) {
        // 离线导航回退到已缓存的 shell
        if (req.mode === 'navigate') {
          const shell = await caches.match('/')
          if (shell) return shell
        }
        throw err
      }
    })(),
  )
})
