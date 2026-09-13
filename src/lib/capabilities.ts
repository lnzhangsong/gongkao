/**
 * 本地 API 写能力探测（运行时判定，不用 import.meta.env.DEV 代理——
 * 「构建模式」与「后端有没有写接口」是两回事：vp preview 是生产构建但挂着
 * 本地 api-server（可写），dev 构建也可能指向远程（只读）。
 *
 * 探测协议：本地 scripts/api-server.mjs 提供 GET /api/capabilities →
 * { write: <按请求方判定> }（WRITE_TOKEN 校验在这里就要过，而不是等点按钮 401）；
 * 生产（Vercel）没有这个 Function → 404 → 视为只读。
 *
 * 缓存语义：只缓存**明确的 HTTP 答复**（200/404）。网络错误/超时/服务器未就绪
 * 是「未知」不是「只读」，不落缓存——dev:all 下浏览器可能先于 api-server 就绪，
 * 若把那次失败缓存住，整个页面会话的写入口都会消失且只能整页刷新。inflight
 * 在 settle 后清空，允许下一次调用重试。
 */

let cached: boolean | null = null
let inflight: Promise<boolean> | null = null

export function localWriteKnown(): boolean | null {
  return cached
}

export function probeLocalWrite(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached)
  inflight ??= (async () => {
    try {
      // 与 src/lib/api.ts 的 writeToken 同源：本地 server 设了 WRITE_TOKEN 时必须带上
      let headers: Record<string, string> = {}
      try {
        const t = localStorage.getItem('readbook:write-token')
        if (t) headers = { 'x-write-token': t }
      } catch {
        /* localStorage 不可用（隐私模式等），按无令牌探测 */
      }
      const res = await fetch('/api/capabilities', { headers, signal: AbortSignal.timeout(3000) })
      // 只有确定的答复才落缓存
      cached = res.ok && ((await res.json()) as { write?: unknown }).write === true
    } catch {
      /* 网络/超时/服务器未就绪：不缓存，下次调用再探 */
    } finally {
      inflight = null
    }
    return cached ?? false
  })()
  return inflight
}
