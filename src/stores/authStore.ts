import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { startCloudSync, stopCloudSync } from '../lib/cloudSync'
import { track } from '../lib/analytics'
import { useAuthStatusStore, type AuthUser, type AuthProfile } from './authStatus'
import { useArticleStore } from './articleStore'
import { useAnnotationStore } from './annotationStore'
import { useShenlunStore } from './shenlunStore'
import { useExamStudyStore } from './examStudyStore'
import { useXingceStore } from './xingceStore'
import { useLearningEventStore } from './learningEventStore'
import { useAiAssistStore } from './aiAssistStore'
import { useAiStore, DEFAULT_AI_SETTINGS } from './aiStore'
import { useReaderStore } from './readerStore'
import { useThemeStore } from './themeStore'

/**
 * 账号体系（Supabase 全托管）——**动作层**。
 *
 * - 认证：Supabase Auth；资料：Supabase Postgres 的 public.profiles 表（RLS 限本人读写）
 * - 登录态存在轻量 store `useAuthStatusStore`（首屏 Nav 要同步读取，不能拖入 supabase-js），
 *   本模块只放动作，并由 App 动态 import —— 连同 supabase-js 与云同步一起按需加载
 * - session 由 supabase-js 持久化在 localStorage，这里只做内存镜像
 * - 未配置 VITE_SUPABASE_URL/ANON_KEY 时 supabase 为 null，整站功能不受影响
 */
interface AuthActions {
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

/** 当前登录用户（轻量镜像，只含 UI 需要的字段） */
const currentUser = () => useAuthStatusStore.getState().user

function toUser(user: User | null): AuthUser | null {
  return user ? { id: user.id, email: user.email ?? null } : null
}
function toProfile(user: User | null, nickname: string | null): AuthProfile {
  return { nickname, email: user?.email ?? null }
}

/** 退出登录时清空本机用户数据：进度/摘录/申论/真题/行测/AI 审题/事件/偏好/AI 配置 + 同步时间戳。
 *  数据都在云端（含 AI 配置），再次登录自动恢复；换人共用浏览器不留痕迹 */
function clearLocalData() {
  useArticleStore.getState().clearAll()
  useAnnotationStore.getState().clearAll()
  useShenlunStore.getState().clearAll()
  useExamStudyStore.getState().clearAll()
  useXingceStore.getState().clearAll()
  useLearningEventStore.getState().clearAll()
  useAiAssistStore.getState().clearAll()
  useAiStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } })
  useReaderStore.getState().resetSettings()
  useThemeStore.setState({ theme: 'paper', autoDark: false })
  try {
    localStorage.removeItem('readbook:sync-meta')
  } catch {
    /* ignore */
  }
}

/** 登录成功后的统一处理：置状态 + 拉取 profile（失败静默，不影响登录） */
function onSignedIn(user: User) {
  useAuthStatusStore.setState({ status: 'in', user: toUser(user), profile: toProfile(user, null) })
  void useAuthStore.getState().refreshProfile()
  startCloudSync()
  track('auth_login', { provider: user.app_metadata?.provider ?? 'email' })
}

export const useAuthStore = create<AuthActions>()(() => ({
  init: () => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) onSignedIn(data.session.user)
      else useAuthStatusStore.setState({ status: 'out' })
    })
    supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session?.user) onSignedIn(session.user)
      else {
        stopCloudSync()
        useAuthStatusStore.setState({ status: 'out', user: null, profile: { nickname: null, email: null } })
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
    /* 顺序关键：先停引擎 → 再清本机 → 最后登出。
     * 引擎若还活着会把清空动作 diff 成「全部删除」推上云，毁掉云端真实数据 */
    track('auth_logout')
    stopCloudSync()
    clearLocalData()
    await supabase.auth.signOut()
  },

  rename: async (nickname) => {
    const user = currentUser()
    if (!supabase || !user) throw new Error('未登录')
    const clean = nickname.trim().slice(0, 24)
    /* upsert 必须带主键 id，PostgREST 才能定位行（首登补建行竞态下也幂等） */
    const { error } = await supabase.from('profiles').upsert({ id: user.id, nickname: clean })
    if (error) throw error
    useAuthStatusStore.setState((s) => ({ profile: { ...s.profile, nickname: clean } }))
  },

  refreshProfile: async () => {
    const user = currentUser()
    if (!supabase || !user) return
    const { data, error } = await supabase.from('profiles').select('nickname').eq('id', user.id).maybeSingle()
    if (error) return /* 表未建/网络失败不阻塞登录使用 */
    if (!data) {
      /* 首次登录：补建本行（RLS 限本人） */
      await supabase.from('profiles').insert({ id: user.id })
      return
    }
    useAuthStatusStore.setState({ profile: { nickname: data.nickname ?? null, email: user.email } })
  },
}))
