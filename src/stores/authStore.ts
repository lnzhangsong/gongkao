import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { startCloudSync, stopCloudSync } from '../lib/cloudSync'

/**
 * 账号体系（Supabase 全托管）：
 * - 认证：Supabase Auth；资料：Supabase Postgres 的 public.profiles 表（RLS 限本人读写）
 * - session 由 supabase-js 持久化在 localStorage，这里只做内存镜像与派生状态
 * - 未配置 VITE_SUPABASE_URL/ANON_KEY 时 supabase 为 null，整站功能不受影响
 */
interface AuthState {
  /** 'init' 恢复会话中 | 'unavailable' 未配置 Supabase | 'out' | 'in' */
  status: 'init' | 'unavailable' | 'out' | 'in'
  user: User | null
  profile: { nickname: string | null; email: string | null }
  /** 恢复会话 + 订阅登录态变化（App 启动时调用一次） */
  init: () => void
  signUp: (email: string, password: string) => Promise<{ needsConfirm: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signInWithMagicLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
  /** 更新昵称（写 public.profiles，回写本地 profile） */
  rename: (nickname: string) => Promise<void>
  /** 登录态就绪后拉取 profile（无行则建） */
  refreshProfile: () => Promise<void>
}

function toProfile(user: User | null, nickname: string | null): { nickname: string | null; email: string | null } {
  return { nickname, email: user?.email ?? null }
}

/** 登录成功后的统一处理：置状态 + 拉取 profile（失败静默，不影响登录） */
function onSignedIn(user: User) {
  useAuthStore.setState({ status: 'in', user, profile: toProfile(user, null) })
  void useAuthStore.getState().refreshProfile()
  startCloudSync()
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: supabase ? 'init' : 'unavailable',
  user: null,
  profile: { nickname: null, email: null },

  init: () => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) onSignedIn(data.session.user)
      else set({ status: 'out' })
    })
    supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session?.user) onSignedIn(session.user)
      else {
        stopCloudSync()
        set({ status: 'out', user: null, profile: { nickname: null, email: null } })
      }
    })
  },

  signUp: async (email, password) => {
    if (!supabase) throw new Error('账号服务未配置')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    /* 项目关闭邮箱确认时 signUp 直接返回 session */
    if (data.session?.user) onSignedIn(data.session.user)
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
    /* 先停引擎再登出：登出会触发 onAuthStateChange，避免 RLS 下无效拉取 */
    stopCloudSync()
    await supabase.auth.signOut()
  },

  rename: async (nickname) => {
    const user = get().user
    if (!supabase || !user) throw new Error('未登录')
    const clean = nickname.trim().slice(0, 24)
    /* upsert 必须带主键 id，PostgREST 才能定位行（首登补建行竞态下也幂等） */
    const { error } = await supabase.from('profiles').upsert({ id: user.id, nickname: clean })
    if (error) throw error
    set((s) => ({ profile: { ...s.profile, nickname: clean } }))
  },

  refreshProfile: async () => {
    const user = get().user
    if (!supabase || !user) return
    const { data, error } = await supabase.from('profiles').select('nickname').eq('id', user.id).maybeSingle()
    if (error) return /* 表未建/网络失败不阻塞登录使用 */
    if (!data) {
      /* 首次登录：补建本行（RLS 限本人） */
      await supabase.from('profiles').insert({ id: user.id })
      return
    }
    set({ profile: toProfile(user, data.nickname) })
  },
}))
