/**
 * 云同步纯函数（无副作用，供 cloudSync.ts 引擎与测试使用）
 *
 * LWW（最后写入胜出）模型：
 * - 引擎为每个「云表行」维护上次同步时间戳（meta），持久化在 localStorage
 * - Push：diff 当前 store 状态 vs 上次同步快照 → 变化行打上 now 推云端
 * - Pull：云端行 updated_at 晚于 meta 记录 → 应用到本地
 * - 登录时序为先 push 后 pull：本地未推送的修改先打上本机 now，LWW 才成立
 */

/** 云端行形状（与 sql/sync.sql 对应） */
export interface CloudRow<T = unknown> {
  /** 各表主键字段拼成的逻辑键（不含 user_id），如 articleId / annId / "trace#p1#2" */
  k: string
  data: T | null
  deleted?: boolean
  updated_at: string
}

/** diff 出需要推送的变化行：快照里没有 / 内容不同 → 新值；快照里有、当前没有 → 墓碑（仅 allowTombstone 的表） */
export function diffRows<T>(
  current: Record<string, T>,
  snapshot: Record<string, T>,
  now: string,
  allowTombstone: boolean,
): { upserts: { k: string; data: T; updatedAt: string }[]; tombstones: { k: string; updatedAt: string }[] } {
  const upserts: { k: string; data: T; updatedAt: string }[] = []
  const tombstones: { k: string; updatedAt: string }[] = []
  for (const k of Object.keys(current)) {
    if (!sameJSON(current[k], snapshot[k])) upserts.push({ k, data: current[k], updatedAt: now })
  }
  if (allowTombstone) {
    for (const k of Object.keys(snapshot)) {
      if (!(k in current)) tombstones.push({ k, updatedAt: now })
    }
  }
  return { upserts, tombstones }
}

/** Pull 判定：云端行是否应应用到本地（严格晚于 meta 记录的时间戳才算新） */
export function shouldApply(cloudUpdatedAt: string, metaUpdatedAt: string | undefined): boolean {
  if (!metaUpdatedAt) return true
  return cloudUpdatedAt > metaUpdatedAt
}

/** 对象引用比较不可靠（zustand 每次重建对象），浅比较 JSON 内容是否相等 */
export function sameJSON(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 把 supabase 分页拉取的多页结果按逻辑键去重合并（后到覆盖先到） */
export function mergePages<T>(pages: CloudRow<T>[][]): Map<string, CloudRow<T>> {
  const merged = new Map<string, CloudRow<T>>()
  for (const page of pages) for (const row of page) merged.set(row.k, row)
  return merged
}
