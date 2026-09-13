/**
 * 产品埋点（PostHog 云 · 美区）——设计与事件清单见 docs/产品埋点设计方案.md
 *
 * 原则：**不采集任何个人身份信息**（不传邮箱/昵称/正文/笔记内容），埋点失败绝不影响主功能。
 * - 白名单事件：只埋文档 §三 列出的动作；autocapture 关闭（全量 DOM 采集噪声大且可能把正文带出去）
 * - 未配置 VITE_POSTHOG_KEY 时整个模块静默失效：CI 不需要真实 key，也不会报错
 * - **本地来源一律不上报**：`vp dev` 会读到仓库根 `.env` 里的真实 key，不拦的话开发时每次
 *   点击都会写进生产项目（污染数据 + 白刷免费额度）。只有 localhost / 127.0.0.0/8 / ::1 /
 *   *.local 之外的来源才上报；确需在本地调试埋点本身时置 `VITE_POSTHOG_ALLOW_LOCAL=1` 放开
 * - 懒加载：posthog-js 独立成 chunk，不进首屏；由 initAnalytics() 在空闲时异步拉取。
 *   走官方 **slim 构建**（`dist/module.slim`，约 49KB gzip，完整构建约 92KB）：
 *   slim 不含 session recording / surveys / toolbar / feature flags 等我们本就关闭的能力。
 *   本项目已显式关掉 autocapture、session recording、exceptions，只用 capture/identify/reset
 *   与 history pageview——这些 slim 全部保留。若日后要开 session recording 或特性开关，
 *   需改回完整构建。
 * - 反代：api_host 默认 `/ingest`（vercel.json rewrite；本地由 vite dev proxy 转发到
 *   us.i.posthog.com）——走自身域名既避开广告插件的拦截规则，也免去国内直连的跨境延迟
 */

/** 项目 API Key（phc_…）。缺失即视为「未接入」，所有导出函数变为空操作 */
const KEY = import.meta.env.VITE_POSTHOG_KEY
/** 采集端点：默认走自身域名反代；填完整 URL 可绕过反代直连 */
const HOST = import.meta.env.VITE_POSTHOG_HOST || '/ingest'
/** PostHog 应用域名，仅用于 Toolbar / 分享链接回跳，与数据上报无关 */
const UI_HOST = 'https://us.posthog.com'

/** 显式放开本地来源上报（默认关闭；只在调试埋点本身时临时置 1） */
const ALLOW_LOCAL = Boolean(import.meta.env.VITE_POSTHOG_ALLOW_LOCAL)

/**
 * 本地来源判定：localhost、整个 127.0.0.0/8 回环、IPv6 的 ::1（浏览器里写作 `[::1]`）、
 * 以及 mDNS 的 `*.local`。覆盖 `vp dev`、本地 `vp preview` 与同机局域网直连这几种常见入口。
 */
const LOCAL_HOST_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|.*\.local)$/i

function isLocalHost(): boolean {
  return typeof window !== 'undefined' && LOCAL_HOST_RE.test(window.location.hostname)
}

/** 是否已接入埋点：未配置 key，或来自本地来源（且未显式放开）时为 false，UI 据此隐藏调试入口 */
export const analyticsEnabled = Boolean(KEY) && (ALLOW_LOCAL || !isLocalHost())

/**
 * 懒加载 slim 构建并取 default。类型直接由该子路径推导：slim 的 d.ts 把 default
 * 声明成两个 PostHog 声明的联合，用 ReturnType 承接可避免手写类型断言去跨越
 * posthog 内部的两套声明（`import type { PostHog } from 'posthog-js'` 会因联合
 * 不可赋值而报 TS2322）。
 */
const loadPostHog = () => import('posthog-js/dist/module.slim').then((m) => m.default)

let clientPromise: ReturnType<typeof loadPostHog> | null = null

/** 复用同一个动态 import 与同一次 init：多次上报不会重复初始化 SDK */
function loadClient(): ReturnType<typeof loadPostHog> | null {
  /* 先单独判 KEY：构建期 Vite 把缺失的 VITE_POSTHOG_KEY 折叠成 undefined，这一行随之成为
     必然 return，压缩器会把下面的动态 import 整块消除（产物里连 posthog chunk 都没有）。
     本地守卫放在后面，别把这条可折叠的短路条件搅进复合表达式。 */
  if (!KEY) return null
  if (isLocalHost() && !ALLOW_LOCAL) return null
  clientPromise ??= loadPostHog().then((posthog) => {
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
  /* 同 loadClient()：`!KEY` 单独成句以便无 key 时被静态消除 */
  if (!KEY) return
  if (isLocalHost() && !ALLOW_LOCAL) return
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
