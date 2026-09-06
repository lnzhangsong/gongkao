import { createClient } from '@supabase/supabase-js'

/**
 * Supabase 客户端（认证用）：邮箱密码 / 魔法链接登录。
 * session 持久化由 supabase-js 自管（localStorage），不进 zustand persist。
 * 环境变量未配置时为 null，登录入口在 UI 上隐藏（站点其余功能不受影响）。
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase = url && anonKey ? createClient(url, anonKey) : null
