/**
 * 产品埋点（PostHog 云 · 美区）——设计与事件清单见 docs/产品埋点设计方案.md
 *
 * 原则：**不采集任何个人身份信息**（不传邮箱/昵称/正文/笔记内容），埋点失败绝不影响主功能。
 * - 白名单事件：只埋文档 §三 列出的动作；autocapture 关闭（全量 DOM 采集噪声大且可能把正文带出去）
 * - 未配置 VITE_POSTHOG_KEY 时整个模块静默失效：本地开发与 CI 不需要真实 key，也不会报错
 * - 懒加载：posthog-js（完整构建约 278KB / gzip 92KB）独立成 chunk，不进首屏；
 *   由 initAnalytics() 在空闲时异步拉取。若日后嫌大，可换官方 slim 构建（约腰斩，
 *   但走的是无 exports 声明的子路径，且需重新验证 history pageview 采集）
 * - 反代：api_host 默认 `/ingest`（vercel.json rewrite；本地由 vite dev proxy 转发到
 *   us.i.posthog.com）——走自身域名既避开广告插件的拦截规则，也免去国内直连的跨境延迟
 */
import type { PostHog } from 'posthog-js'

/** 项目 API Key（phc_…）。缺失即视为「未接入」，所有导出函数变为空操作 */
const KEY = import.meta.env.VITE_POSTHOG_KEY
/** 采集端点：默认走自身域名反代；填完整 URL 可绕过反代直连 */
const HOST = import.meta.env.VITE_POSTHOG_HOST || '/ingest'
/** PostHog 应用域名，仅用于 Toolbar / 分享链接回跳，与数据上报无关 */
const UI_HOST = 'https://us.posthog.com'

/** 是否已接入埋点（未配置 key 时为 false，UI 可据此隐藏调试入口） */
export const analyticsEnabled = Boolean(KEY)

let clientPromise: Promise<PostHog> | null = null

/** 复用同一个动态 import 与同一次 init：多次上报不会重复初始化 SDK */
function loadClient(): Promise<PostHog> | null {
  if (!KEY) return null
  clientPromise ??= import('posthog-js').then(({ default: posthog }) => {
    posthog.init(KEY, {
      api_host: HOST,
      ui_host: UI_HOST,
      /* SPA 路由：SDK 监听 history 变化自动上报 pageview，并据此配对 $pageleave（停留时长） */
      capture_pageview: 'history_change',
      capture_pageleave: true,
      /* 关掉一切自动采集：只走白名单事件 */
      autocapture: false,
      capture_exceptions: false,
      disable_session_recording: true,
      /* 匿名优先：未 identify 前不建 Person，省免费额度也少存一份匿名档案 */
      person_profiles: 'identified_only',
    })
    return posthog
  })
  return clientPromise
}

function noop(): void {
  /* 埋点失败静默：绝不能影响主功能 */
}

/** 应用启动时调用：把 SDK 的加载与 init 推到空闲时段，尽早开始采集又不占首屏带宽 */
export function initAnalytics(): void {
  if (!KEY) return
  const kick = () => void loadClient()
  /* 不用 `'requestIdleCallback' in window` 判断：TS 的 lib.dom 视其为必有成员，
   * 那样写会把 else 分支窄化成 never；这里用 typeof 取值判断，保留老 Safari 的回退 */
  const idle = typeof window.requestIdleCallback === 'function'
  if (idle) window.requestIdleCallback(kick, { timeout: 2000 })
  else setTimeout(kick, 0)
}

/** 上报一个白名单事件。props 只允许 id 类 / 枚举类 / 数值，禁止正文类内容 */
export function track(name: string, props?: Record<string, unknown>): void {
  const client = loadClient()
  if (!client) return
  void client.then((posthog) => posthog.capture(name, props)).catch(noop)
}

/** 登录后关联用户：只传 Supabase user id（一串无意义 uuid），不传邮箱/昵称 */
export function identify(userId: string): void {
  const client = loadClient()
  if (!client) return
  void client.then((posthog) => posthog.identify(userId)).catch(noop)
}

/** 退出登录：解除关联并换一个匿名 id，避免同设备上下一个账号继承前一个人的行为曲线 */
export function resetAnalytics(): void {
  const client = loadClient()
  if (!client) return
  void client.then((posthog) => posthog.reset()).catch(noop)
}
