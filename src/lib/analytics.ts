import { supabase } from './supabase'

/**
 * 产品埋点（自建，数据落 Supabase app_events 表）：
 * - 匿名可写：visitor_id 是 localStorage 里的随机 uuid，不含任何个人身份信息
 * - 登录时带上 user_id，可区分「匿名访客」与「登录用户」
 * - pageview 由 App 路由变化自动上报；关键功能手动调 track()
 * 失败静默：埋点永远不能影响主功能
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

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  return (await supabase.auth.getSession()).data.session?.user.id ?? null
}

/** 上报事件；queueMicrotask + 静默失败，不阻塞 UI、不抛错 */
export function track(name: string, props?: Record<string, unknown>, path?: string): void {
  if (!supabase) return
  void (async () => {
    try {
      await supabase.from('app_events').insert({
        visitor_id: visitorId(),
        user_id: await currentUserId(),
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
