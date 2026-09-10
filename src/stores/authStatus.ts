import { create } from 'zustand'
import { supabaseConfigured } from '../lib/supabaseConfig'

/**
 * 登录态（轻量 store）。
 *
 * 存在的理由：首屏导航栏要同步判断「是否已登录」来决定 ACCOUNT 指向，而认证逻辑所在的
 * authStore 会拉入 supabase-js + 云同步 + 各数据 store（约 57KB gzip）。
 * 把状态放在这里、动作放在 authStore，首屏就不必为可选能力付体积。
 */

/** 'init' 恢复会话中 | 'unavailable' 未配置 Supabase | 'out' | 'in' */
export type AuthStatus = 'init' | 'unavailable' | 'out' | 'in'

/** 只保留 UI 需要的字段，避免把 supabase-js 的 User 类型带进轻量模块 */
export interface AuthUser {
  id: string
  email: string | null
}

export interface AuthProfile {
  nickname: string | null
  email: string | null
}

interface AuthStatusState {
  status: AuthStatus
  user: AuthUser | null
  profile: AuthProfile
}

export const useAuthStatusStore = create<AuthStatusState>()(() => ({
  status: supabaseConfigured ? 'init' : 'unavailable',
  user: null,
  profile: { nickname: null, email: null },
}))
