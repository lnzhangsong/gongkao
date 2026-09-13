// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { localWriteKnown as knownFn, probeLocalWrite as probeFn } from './capabilities'

/**
 * 写能力探测的缓存语义：只缓存明确的 HTTP 答复（200/404）；
 * 网络错误/超时是「未知」，不落缓存、可重试——否则 dev:all 下浏览器先于
 * api-server 就绪的那次失败会把整个页面会话的写入口锁死。
 * 模块内有进程级缓存状态，每例 resetModules 取全新实例。
 */

type Cap = { localWriteKnown: typeof knownFn; probeLocalWrite: typeof probeFn }

async function load(): Promise<Cap> {
  return (await import('./capabilities')) as unknown as Cap
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('probeLocalWrite 缓存语义', () => {
  it('200 + write:true → 缓存为可写，后续不再发请求', async () => {
    const f = vi.fn(async () => new Response('{"write":true}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    const { probeLocalWrite, localWriteKnown } = await load()
    expect(await probeLocalWrite()).toBe(true)
    expect(await probeLocalWrite()).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
    expect(localWriteKnown()).toBe(true)
  })

  it('404（生产）→ 缓存为只读', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    )
    const { probeLocalWrite, localWriteKnown } = await load()
    expect(await probeLocalWrite()).toBe(false)
    expect(localWriteKnown()).toBe(false)
  })

  it('网络失败 → 本次 false 但不缓存，重试可翻转（dev:all 竞态场景）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    let { probeLocalWrite, localWriteKnown } = await load()
    expect(await probeLocalWrite()).toBe(false)
    expect(localWriteKnown()).toBeNull() // 关键：未知 ≠ 只读

    // api-server 起来了，重试成功
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"write":true}', { status: 200 })),
    )
    ;({ probeLocalWrite, localWriteKnown } = await load())
    expect(await probeLocalWrite()).toBe(true)
    expect(localWriteKnown()).toBe(true)
  })

  it('探测带 x-write-token 头（WRITE_TOKEN 模式下要按请求方判定）', async () => {
    localStorage.setItem('readbook:write-token', 'tok')
    let seen: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen = new Headers(init?.headers).get('x-write-token') ?? undefined
        return new Response('{"write":true}', { status: 200 })
      }),
    )
    try {
      const { probeLocalWrite } = await load()
      await probeLocalWrite()
      expect(seen).toBe('tok')
    } finally {
      // 断言失败也不能把 token 漏给后续用例
      localStorage.removeItem('readbook:write-token')
    }
  })
})
