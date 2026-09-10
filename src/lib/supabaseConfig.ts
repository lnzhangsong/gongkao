/**
 * Supabase 配置探测（只读环境变量，**不引入 supabase-js**）。
 *
 * supabase-js 体积可观（约 57KB gzip），而登录与云同步在本产品里是可选能力。
 * 首屏需要判断「登录入口是否可用」的轻量模块（Nav / authStatus）只读这个布尔值，
 * 真正需要 SDK 时再动态 import。
 */
export const supabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
