import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * 云同步引擎集成测试（mock Supabase，不触碰真实项目）。
 *
 * 用一个内存版 PostgREST 替身驱动**真实的** cloudSync 引擎与**真实的** zustand store，
 * 覆盖纯函数测不到的部分：push/pull 往返、LWW 应用、墓碑删除、exam_study 复合键、
 * 坏记录拒入、登出解绑订阅、并发串行化。
 *
 * 注入方式：`vi.doMock('./supabase')` + `vi.resetModules()`，因此**生产代码无需任何测试钩子**；
 * 每个 boot() 都拿到全新的引擎状态与全新的 store（meta / snapshot / 订阅都不串场），
 * 并且清空 localStorage 以模拟「另一台设备」。
 */

// ---------- 浏览器全局替身（cloudSync 模块加载时读 localStorage，startCloudSync 用 window） ----------
const storage = new Map<string, string>()
const windowListeners = new Map<string, Set<() => void>>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
})
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  writable: true,
  value: {
    addEventListener: (t: string, fn: () => void) => {
      const set = windowListeners.get(t) ?? new Set()
      set.add(fn)
      windowListeners.set(t, set)
    },
    removeEventListener: (t: string, fn: () => void) => void windowListeners.get(t)?.delete(fn),
  },
})

// ---------- 内存版 Supabase 替身 ----------
type Row = Record<string, unknown>

function createFakeSupabase(userId: string | null = 'u1') {
  const tables = new Map<string, Map<string, Row>>()
  const stats = { upserts: 0, maxConcurrent: 0 }
  let inFlight = 0
  let clock = 0
  /** 单调递增的「服务端时钟」：保证每次写入的 updated_at 都更晚 */
  const tick = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString()

  const tableMap = (t: string) => {
    let m = tables.get(t)
    if (!m) {
      m = new Map()
      tables.set(t, m)
    }
    return m
  }

  /** 与 cloudSyncCore.rowKey 对齐的逻辑键（exam_study 是 kind#key 复合键） */
  const logicalKey = (t: string, v: Row): string => {
    if (t === 'exam_study') return `${String(v.kind)}#${String(v.key)}`
    if (t === 'annotations') return String(v.ann_id)
    if (t === 'ai_assists') return String(v.assist_id)
    if (t === 'learning_events') return String(v.event_id)
    if (t === 'xg_answers') return String(v.key)
    if (t === 'user_prefs' || t === 'user_ai_config') return 'me'
    return String(v.article_id)
  }

  /** 每个请求都让出事件循环：若并发没被串行化，maxConcurrent 会 > 1 */
  const serve = async <T>(fn: () => T): Promise<T> => {
    inFlight += 1
    stats.maxConcurrent = Math.max(stats.maxConcurrent, inFlight)
    try {
      await new Promise((r) => setTimeout(r, 1))
      return fn()
    } finally {
      inFlight -= 1
    }
  }

  const from = (table: string) => ({
    select: (_cols: string) => ({
      range: (fromIdx: number, toIdx: number) =>
        serve(() => ({
          data: [...tableMap(table).values()].slice(fromIdx, toIdx + 1).map((r) => ({ ...r })),
          error: null,
        })),
      maybeSingle: () =>
        serve(() => {
          const r = tableMap(table).get('me')
          return { data: r ? { data: r.data, updated_at: r.updated_at } : null, error: null }
        }),
    }),
    upsert: (values: Row | Row[], _opts?: unknown) =>
      serve(() => {
        for (const v of Array.isArray(values) ? values : [values]) {
          const k = logicalKey(table, v)
          const row: Row = { ...tableMap(table).get(k), ...v }
          /* 模拟 v4 触发器：updated_at 一律由服务端赋值（忽略客户端传入值）；
             learning_events 没有 updated_at 列，只有 created_at */
          if (table === 'learning_events') {
            row.created_at = tick()
            delete row.updated_at
          } else {
            row.updated_at = tick()
          }
          tableMap(table).set(k, row)
          stats.upserts += 1
        }
        return { error: null }
      }),
  })

  const client = {
    from,
    auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }) },
  }

  return {
    client,
    stats,
    rows: (t: string) => [...tableMap(t).values()],
    row: (t: string, k: string) => tableMap(t).get(k),
    /** 直接投一行云端数据（模拟另一台设备已同步的内容） */
    seed: (t: string, k: string, columns: Row, updatedAt = new Date(Date.UTC(2026, 0, 1)).toISOString()) =>
      tableMap(t).set(k, { ...columns, updated_at: updatedAt }),
  }
}

type Fake = ReturnType<typeof createFakeSupabase>

const boots: (() => void)[] = []

/** 起一份全新的「设备」：全新引擎状态 + 全新 store + 空 localStorage */
async function boot(fake: Fake) {
  storage.clear()
  vi.resetModules()
  vi.doMock('./supabase', () => ({ supabase: fake.client }))
  const cloudSync = await import('./cloudSync')
  const { useArticleStore } = await import('../stores/articleStore')
  const { useAnnotationStore } = await import('../stores/annotationStore')
  const { useExamStudyStore } = await import('../stores/examStudyStore')
  const { useXingceStore } = await import('../stores/xingceStore')
  boots.push(cloudSync.stopCloudSync)
  return {
    cloudSync,
    article: useArticleStore,
    annotation: useAnnotationStore,
    examStudy: useExamStudyStore,
    xingce: useXingceStore,
  }
}

afterEach(() => {
  while (boots.length) boots.pop()?.()
})

// ---------- 测试数据 ----------
const prog = (percent: number) => ({
  articleId: 'a1',
  percent,
  lastPosition: 0,
  lastReadAt: '2026-01-01T00:00:00.000Z',
  completed: false,
  startedAt: '2026-01-01T00:00:00.000Z',
  readCount: 1,
  favorite: false,
})
const ann = (id: string) => ({
  id,
  articleId: 'a1',
  kind: 'highlight' as const,
  text: '原文',
  start: 0,
  end: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
})
const trace = () => ({
  paperId: 'p1',
  qIdx: 2,
  origin: 'manual' as const,
  points: [{ id: 't1', text: '要点', mode: '摘抄' as const, sourceIdx: 1 }],
  updatedAt: '2026-01-01T00:00:00.000Z',
})
const marksRecord = () => ({
  paperId: 'p1',
  qIdx: 2,
  origin: 'manual' as const,
  marks: [{ id: 'k1', matIdx: 1, quote: '原句', role: '案例叙事' }],
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('cloudSync 引擎（mock Supabase）', () => {
  it('push：本地进度推到云端，updated_at 由服务端赋值', async () => {
    const fake = createFakeSupabase()
    const h = await boot(fake)
    h.article.setState({ progress: { a1: prog(30) } })

    h.cloudSync.startCloudSync()
    await h.cloudSync.syncNow()

    const row = fake.row('reading_progress', 'a1')
    expect(row).toBeTruthy()
    expect(row?.data).toMatchObject({ percent: 30 })
    expect(typeof row?.updated_at).toBe('string')
  })

  it('pull：云端行拉到本地', async () => {
    const fake = createFakeSupabase()
    fake.seed('reading_progress', 'a1', { article_id: 'a1', data: prog(77) })
    const h = await boot(fake)

    h.cloudSync.startCloudSync()
    await h.cloudSync.syncNow()

    expect(h.article.getState().progress.a1?.percent).toBe(77)
  })

  it('LWW：比 meta 更新的云行会应用，更旧的不覆盖本地', async () => {
    const fake = createFakeSupabase()
    const h = await boot(fake)
    h.article.setState({ progress: { a1: prog(30) } })
    h.cloudSync.startCloudSync()
    await h.cloudSync.syncNow()

    /* 更旧的行 → 不应用 */
    fake.seed(
      'reading_progress',
      'a1',
      { article_id: 'a1', data: prog(10) },
      new Date(Date.UTC(2000, 0, 1)).toISOString(),
    )
    await h.cloudSync.syncNow()
    expect(h.article.getState().progress.a1?.percent).toBe(30)

    /* 更新的行 → 应用 */
    fake.seed(
      'reading_progress',
      'a1',
      { article_id: 'a1', data: prog(90) },
      new Date(Date.UTC(2030, 0, 1)).toISOString(),
    )
    await h.cloudSync.syncNow()
    expect(h.article.getState().progress.a1?.percent).toBe(90)
  })

  it('墓碑：A 端删除摘录 → B 端同步后本地也移除', async () => {
    const fake = createFakeSupabase()

    const a = await boot(fake)
    a.annotation.setState({ annotations: [ann('x1')] })
    a.cloudSync.startCloudSync()
    await a.cloudSync.syncNow()
    expect(fake.row('annotations', 'x1')?.deleted).toBe(false)

    /* 另一台设备（独立 store 与 meta）也有一模一样的摘录 */
    const b = await boot(fake)
    b.annotation.setState({ annotations: [ann('x1')] })
    b.cloudSync.startCloudSync()
    await b.cloudSync.syncNow()
    expect(b.annotation.getState().annotations).toHaveLength(1)

    /* A 端删除 → 推墓碑 */
    a.annotation.setState({ annotations: [] })
    await a.cloudSync.syncNow()
    expect(fake.row('annotations', 'x1')?.deleted).toBe(true)

    /* B 端拉取墓碑 → 本地移除 */
    await b.cloudSync.syncNow()
    expect(b.annotation.getState().annotations).toHaveLength(0)
  })

  it('exam_study 复合键：trace 与 mark 同键互不覆盖，且能跨设备恢复（回归）', async () => {
    const fake = createFakeSupabase()
    const a = await boot(fake)
    a.examStudy.setState({ traces: { 'p1#2': trace() }, marks: { 'p1#2': marksRecord() } })

    a.cloudSync.startCloudSync()
    await a.cloudSync.syncNow()

    /* 云端两行都在，kind 前缀没有丢 */
    expect(fake.row('exam_study', 'trace#p1#2')?.kind).toBe('trace')
    expect(fake.row('exam_study', 'mark#p1#2')?.kind).toBe('mark')

    /* 全新设备从云端恢复：修复前这里 trace 会被丢弃、mark 落到错键上 */
    const b = await boot(fake)
    b.cloudSync.startCloudSync()
    await b.cloudSync.syncNow()

    expect(b.examStudy.getState().traces['p1#2']?.points).toHaveLength(1)
    expect(b.examStudy.getState().marks['p1#2']?.marks).toHaveLength(1)
  })

  it('坏记录拒入：形状不符的 xg_answers 不写入 store', async () => {
    const fake = createFakeSupabase()
    fake.seed('xg_answers', 'p1#1', { key: 'p1#1', data: { paperId: 'p1' } })
    const h = await boot(fake)

    h.cloudSync.startCloudSync()
    await h.cloudSync.syncNow()

    expect(h.xingce.getState().answers).toEqual({})
  })

  it('登出解除 store 订阅（回归：此前只解绑了 window focus 监听）', async () => {
    const fake = createFakeSupabase()
    const h = await boot(fake)

    let unsubscribed = 0
    const store = h.article as unknown as { subscribe: (fn: () => void) => () => void }
    const realSubscribe = store.subscribe.bind(h.article)
    store.subscribe = (fn) => {
      const off = realSubscribe(fn)
      return () => {
        unsubscribed += 1
        off()
      }
    }

    h.cloudSync.startCloudSync()
    h.cloudSync.stopCloudSync()

    expect(unsubscribed).toBe(1)
  })

  it('并发调用被串行化：同一时刻只有一个云端请求（回归）', async () => {
    const fake = createFakeSupabase()
    const h = await boot(fake)
    h.article.setState({ progress: { a1: prog(30) } })

    h.cloudSync.startCloudSync()
    await Promise.all([h.cloudSync.syncNow(), h.cloudSync.syncNow(), h.cloudSync.syncNow()])

    expect(fake.stats.maxConcurrent).toBe(1)
  })
})
