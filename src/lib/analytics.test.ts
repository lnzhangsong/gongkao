// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * 产品埋点封装测试。
 *
 * 锁住三件容易回归的事：
 * 1. 未配置 key 时**全链路空操作**——本地开发/CI 没有 key，埋点绝不能抛错或偷偷发请求
 * 2. 配置了 key 时 init 只跑一次，且关键配置不被误改（autocapture 关、pageview 走 history、
 *    匿名优先），这些配置直接决定了「不外传正文」与隐私承诺是否成立
 * 3. identify 只传 user id，不夹带邮箱/昵称
 *
 * posthog-js 用 vi.hoisted 桩替：工厂在模块图求值前就被引用，普通 const 会撞 TDZ。
 * mock 路径必须与 analytics.ts 的实际 import 一致（slim 子路径），否则桩不生效、
 * 用例会去真的加载 SDK。
 */
const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('posthog-js/dist/module.slim', () => ({ default: mocks }))

/** 埋点内部是动态 import + Promise 链，只刷微任务不够：模块加载要真的过一轮事件循环 */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 每个用例都重置模块：import.meta.env 是模块级常量，必须在 import 前把桩打好 */
async function loadAnalytics() {
  vi.resetModules()
  return import('./analytics')
}

beforeEach(() => {
  vi.clearAllMocks()
  /* 不能让 initAnalytics 真的等浏览器空闲：桩成立即回调，否则用例会挂在超时上 */
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
    cb()
    return 1
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('analytics（未配置 key）', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_POSTHOG_KEY', '')
  })

  it('analyticsEnabled 为 false，且不加载 SDK', async () => {
    const { analyticsEnabled, initAnalytics, track } = await loadAnalytics()
    expect(analyticsEnabled).toBe(false)

    initAnalytics()
    track('pageview')
    await flush()

    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('track / identify / reset 均不抛错（埋点永远不能影响主功能）', async () => {
    const { track, identify, resetAnalytics } = await loadAnalytics()
    expect(() => {
      track('article_read_finish', { articleId: 'a1' })
      identify('user-1')
      resetAnalytics()
    }).not.toThrow()
    await flush()
    expect(mocks.init).not.toHaveBeenCalled()
  })
})

describe('analytics（已配置 key）', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key')
  })

  it('init 带上不外传正文所依赖的关键配置', async () => {
    const { analyticsEnabled, initAnalytics } = await loadAnalytics()
    expect(analyticsEnabled).toBe(true)

    initAnalytics()
    await flush()

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.init).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({
        api_host: '/ingest',
        capture_pageview: 'history_change',
        autocapture: false,
        disable_session_recording: true,
        capture_exceptions: false,
        person_profiles: 'identified_only',
      }),
    )
  })

  it('VITE_POSTHOG_HOST 可覆盖默认反代端点', async () => {
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://us.i.posthog.com')
    const { initAnalytics } = await loadAnalytics()

    initAnalytics()
    await flush()

    expect(mocks.init).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ api_host: 'https://us.i.posthog.com' }),
    )
  })

  it('多次 track 只 init 一次，并把事件交给 capture', async () => {
    const { initAnalytics, track } = await loadAnalytics()

    initAnalytics()
    track('auth_login', { provider: 'password' })
    track('annotation_add', { kind: 'highlight', articleId: 'a1' })
    await flush()

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.capture).toHaveBeenCalledWith('auth_login', { provider: 'password' })
    expect(mocks.capture).toHaveBeenCalledWith('annotation_add', { kind: 'highlight', articleId: 'a1' })
  })

  it('identify 只传 user id，不夹带邮箱/昵称', async () => {
    const { identify } = await loadAnalytics()

    identify('6f1c2f38-0000-4444-8888-abcdefabcdef')
    await flush()

    expect(mocks.identify).toHaveBeenCalledTimes(1)
    expect(mocks.identify).toHaveBeenCalledWith('6f1c2f38-0000-4444-8888-abcdefabcdef')
    expect(mocks.identify.mock.calls[0]).toHaveLength(1)
  })

  it('退出登录调 reset 解除身份关联', async () => {
    const { resetAnalytics } = await loadAnalytics()

    resetAnalytics()
    await flush()

    expect(mocks.reset).toHaveBeenCalledTimes(1)
  })

  it('SDK 初始化失败时静默：不向调用方抛出', async () => {
    mocks.capture.mockImplementationOnce(() => {
      throw new Error('network down')
    })
    const { track } = await loadAnalytics()

    expect(() => track('auth_logout')).not.toThrow()
    await flush()
  })
})
