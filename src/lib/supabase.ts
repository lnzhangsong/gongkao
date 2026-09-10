import { createClient } from '@supabase/supabase-js'
import { supabaseConfigured } from './supabaseConfig'

/**
 * Supabase 客户端（认证 + 云同步）。本模块会拉入 supabase-js，属重模块，
 * 只应由按需加载的 authStore / AuthPage 引用；首屏判断「是否已配置」请用 supabaseConfig。
 * session 持久化由 supabase-js 自管（localStorage），不进 zustand persist。
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** 未配置环境变量时为 null，登录入口在 UI 上降级提示（站点其余功能不受影响） */
export const supabase = supabaseConfigured && url && anonKey ? createClient(url, anonKey) : null
