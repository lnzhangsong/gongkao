import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { fetchMe, updateNickname, accessToken, type Profile } from '../lib/api'

/**
 * 账号体系（Supabase Auth）：
 * - session 由 supabase-js 持久化在 localStorage，这里只做内存镜像与派生状态
 * - 未配置 VITE_SUPABASE_URL/ANON_KEY 时 supabase 为 null，整站功能不受影响
 * - profile（昵称等）来自服务端 /api/me，仅登录身份阶段不做数据同步
 */
interface AuthState {
  /** 'init' 恢复会话中 | 'unavailable' 未配置 Supabase | 'out' | 'in' */
  status: 'init' | 'unavailable' | 'out' | 'in'
  user: User | null
  profile: Profile | null
  /** 恢复会话 + 订阅登录态变化（App 启动时调用一次） */
  init: () => void
  signUp: (email: string, password: string) => Promise<{ needsConfirm: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signInWithMagicLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
  /** 服务端更新昵称并回写本地 profile */
  rename: (nickname: string) => Promise<void>
  /** 登录态就绪后拉取/创建服务端 profile */
  refreshProfile: () => Promise<void>
}

/** 登录成功后的统一处理：置状态 + 拉服务端 profile（失败静默，不影响登录） */
async function onSignedIn(user: User) {
  useAuthStore.setState({ status: 'in', user })
  void useAuthStore.getState().refreshProfile()
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: supabase ? 'init' : 'unavailable',
  user: null,
  profile: null,

  init: () => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) void onSignedIn(data.session.user)
      else set({ status: 'out' })
    })
    supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session?.user) void onSignedIn(session.user)
      else set({ status: 'out', user: null, profile: null })
    })
  },

  signUp: async (email, password) => {
    if (!supabase) throw new Error('账号服务未配置')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    /* 项目关闭邮箱确认时 signUp 直接返回 session */
    if (data.session?.user) await onSignedIn(data.session.user)
    return { needsConfirm: !data.session }
  },

  signIn: async (email, password) => {
    if (!supabase) throw new Error('账号服务未配置')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  },

  signInWithMagicLink: async (email) => {
    if (!supabase) throw new Error('账号服务未配置')
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) throw error
  },

  signOut: async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  },

  rename: async (nickname) => {
    const t = await accessToken()
    if (!t) throw new Error('未登录')
    const { profile } = await updateNickname(t, nickname)
    set({ profile })
  },

  refreshProfile: async () => {
    const t = await accessToken()
    if (!t) return
    try {
      const { profile } = await fetchMe(t)
      set({ profile })
    } catch {
      /* profile 拉取失败不阻塞使用 */
    }
  },
}))
