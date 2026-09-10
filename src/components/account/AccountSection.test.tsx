// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AccountSection } from './AccountSection'

/**
 * 账号分区（设置页）三态渲染测试。
 *
 * 重点锁住一个真实缺陷：昵称输入框的初值必须来自已就绪的 profile。
 * 进设置页时 authStore 早已拉过 profile，若初值写成空串，「渲染期同步 state」
 * 那段不会触发（prev 与当前值相同），输入框会空着且「保存」被误判为可点。
 */

type Status = 'init' | 'unavailable' | 'out' | 'in'

const authState = {
  status: 'in' as Status,
  user: { id: 'u1', email: 'reader@example.com' } as { id: string; email: string | null } | null,
  profile: { nickname: '青灯黄卷', email: 'reader@example.com' } as {
    nickname: string | null
    email: string | null
  },
}
const syncState = { lastSyncAt: null as string | null, error: null as string | null, syncing: false }
const navigateSpy = vi.fn()
const renameSpy = vi.fn(async () => {})

vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }))
vi.mock('../../stores/authStatus', () => ({
  useAuthStatusStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}))
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (sel: (s: { rename: typeof renameSpy; signOut: () => Promise<void> }) => unknown) =>
    sel({ rename: renameSpy, signOut: async () => {} }),
}))
vi.mock('../../lib/cloudSync', () => ({
  useSyncStore: () => syncState,
  syncNow: async () => {},
}))

let container: HTMLDivElement
let root: Root

/** React 19 要求显式声明这是 act() 环境，否则渲染期的状态更新会告警 */
const reactEnv = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactEnv.IS_REACT_ACT_ENVIRONMENT = true
  authState.status = 'in'
  authState.user = { id: 'u1', email: 'reader@example.com' }
  authState.profile = { nickname: '青灯黄卷', email: 'reader@example.com' }
  syncState.lastSyncAt = null
  syncState.error = null
  syncState.syncing = false
  navigateSpy.mockClear()
  renameSpy.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  reactEnv.IS_REACT_ACT_ENVIRONMENT = false
})

async function render() {
  await act(async () => {
    root.render(<AccountSection />)
  })
}

const input = () => container.querySelector<HTMLInputElement>('.settings-input')
const saveBtn = () => container.querySelectorAll<HTMLButtonElement>('.setting-row button')[0]
const text = () => container.textContent ?? ''

describe('AccountSection 已登录', () => {
  it('昵称输入框带出当前昵称，且未修改时「保存」不可点', async () => {
    await render()
    expect(input()?.value).toBe('青灯黄卷')
    expect(saveBtn().disabled).toBe(true)
  })

  it('展示昵称、邮箱与头像首字', async () => {
    await render()
    expect(container.querySelector('.settings-account-text strong')?.textContent).toBe('青灯黄卷')
    expect(container.querySelector('.settings-account-text span')?.textContent).toBe('reader@example.com')
    expect(container.querySelector('.settings-account-avatar')?.textContent).toBe('青')
  })

  it('没有昵称时回退到「我的账号」，邮箱缺失回退占位', async () => {
    authState.profile = { nickname: null, email: null }
    authState.user = { id: 'u1', email: null }
    await render()
    expect(container.querySelector('.settings-account-text strong')?.textContent).toBe('我的账号')
    expect(container.querySelector('.settings-account-text span')?.textContent).toBe('（无邮箱）')
    expect(container.querySelector('.settings-account-avatar')?.textContent).toBe('（')
  })

  it('退出登录与数据同步两行都在，且给出同步状态文案', async () => {
    syncState.lastSyncAt = new Date().toISOString()
    await render()
    expect(text()).toContain('数据同步')
    expect(text()).toContain('上次同步')
    expect(text()).toContain('退出登录')
    expect(container.querySelector('.settings-account-id')).not.toBeNull()
  })

  it('尚未同步时给出提示', async () => {
    await render()
    expect(text()).toContain('尚未同步')
  })
})

describe('AccountSection 未登录', () => {
  it('未登录时只给登录引导，不渲染昵称输入与退出登录', async () => {
    authState.status = 'out'
    authState.user = null
    await render()
    expect(text()).toContain('未登录')
    expect(input()).toBeNull()
    expect(text()).not.toContain('退出登录')
    expect(saveBtn().textContent).toContain('登录')
  })

  it('点「登录」跳到 /login', async () => {
    authState.status = 'out'
    authState.user = null
    await render()
    await act(async () => {
      saveBtn().click()
    })
    expect(navigateSpy).toHaveBeenCalledWith('/login')
  })

  it('会话恢复中禁用登录按钮', async () => {
    authState.status = 'init'
    authState.user = null
    await render()
    expect(text()).toContain('正在检查登录状态')
    expect(saveBtn().disabled).toBe(true)
  })

  it('未配置 Supabase 时说明纯本地模式，且不给登录入口', async () => {
    authState.status = 'unavailable'
    authState.user = null
    await render()
    expect(text()).toContain('云端账号未配置')
    expect(text()).toContain('纯本地模式')
    expect(container.querySelector('.setting-row button')).toBeNull()
  })
})
