// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * useLocalWrite 的重试语义：探测「未知」（网络失败）时 hook 内 1s/3s 各重试一次，
 * 已挂载的页面在 api-server 稍后就绪（dev:all 竞态）时能自愈；明确的 404（只读）
 * 不重试。模块链上有缓存状态，每例 resetModules + 动态 import 取全新实例。
 */

let container: HTMLDivElement
let root: Root | null = null

/** 正常组件：hook 结果经 useEffect 上报到 DOM，渲染期保持纯函数；
 *  断言读 container.textContent（createRoot 会接管容器子节点，别持游离引用） */
async function renderHook(): Promise<HTMLDivElement> {
  const { useLocalWrite } = (await import('./useLocalWrite')) as { useLocalWrite: () => boolean }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<Probe useHook={useLocalWrite} />))
  return container
}

function Probe({ useHook }: { useHook: () => boolean }) {
  const enabled = useHook()
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.textContent = enabled ? '1' : '0'
  }, [enabled])
  return <span ref={ref}>?</span>
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useLocalWrite 重试', () => {
  it('网络失败 → 1s/3s 两次重试内 api-server 就绪则自愈', async () => {
    // 先失败（浏览器先于 api-server 就绪），成功应答推迟到重试时才给
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        if (calls === 1) throw new TypeError('fetch failed')
        return new Response('{"write":true}', { status: 200 })
      }),
    )
    const view = await renderHook()
    expect(view.textContent).toBe('0')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000) // 第一次重试（1s）
    })
    expect(view.textContent).toBe('1')
    expect(calls).toBe(2)
  })

  it('两次重试仍失败 → 保持隐藏，不再探测', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', f)
    const view = await renderHook()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000) // 越过 1s + 3s 两次重试窗口
    })
    expect(view.textContent).toBe('0')
    expect(f).toHaveBeenCalledTimes(3) // 首探 + 2 次重试，之后放弃
  })

  it('404（生产只读）→ 不重试，直接定格隐藏', async () => {
    const f = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', f)
    const view = await renderHook()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(view.textContent).toBe('0')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('卸载后取消重试定时器（cleanup 的 clearTimeout 不回归）', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', f)
    await renderHook()
    // 刷微任务让首次探测 settle（失败 → 已排定 1s 重试）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(f).toHaveBeenCalledTimes(1)
    // 在重试触发前卸载
    act(() => {
      root?.unmount()
    })
    root = null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(f).toHaveBeenCalledTimes(1) // 重试没有发生
  })
})
