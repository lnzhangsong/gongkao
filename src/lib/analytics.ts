/**
 * 产品埋点（自建，数据落 Supabase app_events 表）：
 * - 匿名可写：visitor_id 是 localStorage 里的随机 uuid，不含任何个人身份信息
 * - 登录时带上 user_id，可区分「匿名访客」与「登录用户」
 * - pageview 由 App 路由变化自动上报；关键功能手动调 track()
 * - 失败静默：埋点永远不能影响主功能
 *
 * supabase-js 约 57KB gzip 且登录是可选能力，故这里动态 import：
 * 不进入主 chunk，首次 track 时才异步拉取（不阻塞首屏渲染）。
 */

const VISITOR_KEY = 'readbook:visitor-id'

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return 'anon'
  }
}

let clientPromise: Promise<typeof import('./supabase')> | null = null
/** 复用同一个动态 import：多次 track 不会重复拉取 chunk */
function loadClient() {
  clientPromise ??= import('./supabase')
  return clientPromise
}

/** 上报事件；异步 + 静默失败，不阻塞 UI、不抛错 */
export function track(name: string, props?: Record<string, unknown>, path?: string): void {
  void (async () => {
    try {
      const { supabase } = await loadClient()
      if (!supabase) return
      const userId = (await supabase.auth.getSession()).data.session?.user.id ?? null
      await supabase.from('app_events').insert({
        visitor_id: visitorId(),
        user_id: userId,
        name,
        path: path ?? location.pathname,
        props: props ?? {},
      })
    } catch {
      /* 埋点失败静默 */
    }
  })()
}

/** 路由变化时的 pageview（App 里随 location 调用） */
export function trackPageview(path: string): void {
  track('pageview', undefined, path)
}
