/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** PostHog 项目 API Key（phc_…）；缺失时埋点整体静默禁用 */
  readonly VITE_POSTHOG_KEY?: string
  /** PostHog 采集端点；默认走自身域名反代 `/ingest`，填完整 URL 可直连 */
  readonly VITE_POSTHOG_HOST?: string
  /** 置 1 允许在 localhost 等本地来源上报（默认关闭；只在调试埋点本身时临时用） */
  readonly VITE_POSTHOG_ALLOW_LOCAL?: string
}
