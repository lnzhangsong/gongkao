import { create } from 'zustand'
import { supabase } from './supabase'
import { diffRows, shouldApply, sameJSON, mergePages, type CloudRow } from './cloudSyncCore'
import { useArticleStore } from '../stores/articleStore'
import type { Article, ReadingProgress } from '../types'
import { useAnnotationStore } from '../stores/annotationStore'
import type { Annotation } from '../types'
import { useShenlunStore, type ArticleStudy } from '../stores/shenlunStore'
import { useExamStudyStore, type QuestionTrace, type QuestionMarks } from '../stores/examStudyStore'
import { useAiAssistStore, type AssistRecord } from '../stores/aiAssistStore'
import { useAiStore } from '../stores/aiStore'
import { useLearningEventStore, type LearningEvent } from '../stores/learningEventStore'
import { useReaderStore } from '../stores/readerStore'
import { useThemeStore } from '../stores/themeStore'

/**
 * 数据云同步引擎（Supabase Postgres，按行 LWW，见 sql/sync.sql）：
 * - 登录后 push（本地未推送修改打上本机时间戳）→ pull（仅应用比 meta 新的云行）→ 订阅增量
 * - meta（每行上次同步时间戳）持久化在 localStorage，登出不清（换设备登录后仍可比对）
 * - 摘录删除走墓碑（annotations.deleted），其余表行删除不同步（progress/articleStudy 无删除语义）
 * - AI 配置（含 API key）刻意不同步
 */

const META_KEY = 'readbook:sync-meta'
const PUSH_DEBOUNCE_MS = 4000
const PULL_MIN_INTERVAL_MS = 60_000
const UPSERT_BATCH = 400

/** 每张表的逻辑键与本地行的映射 */
interface TableMeta {
  [rowKey: string]: string // rowKey -> 上次同步的 updated_at（ISO）
}
type Meta = Record<string, TableMeta> // table -> rows

function loadMeta(): Meta {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as Meta
  } catch {
    return {}
  }
}
function saveMeta(meta: Meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* 配额满等静默失败，下次写覆盖 */
  }
}

/** 同步状态（账号页展示） */
interface SyncState {
  lastSyncAt: string | null
  error: string | null
  syncing: boolean
}
export const useSyncStore = create<SyncState>()(() => ({ lastSyncAt: null, error: null, syncing: false }))

function setSync(patch: Partial<SyncState>) {
  useSyncStore.setState(patch)
}

// ---------- 各表的本地读写适配器 ----------

interface TableAdapter<T> {
  allowTombstone?: boolean
  /** 当前本地行（k -> data 原样） */
  getRows(): Record<string, T>
  /** 应用云端行到本地 store */
  apply(k: string, data: T): void
  /** 应用云端墓碑（仅 allowTombstone 表） */
  applyTombstone?(k: string): void
  /** 云表 upsert 载荷：逻辑键 -> 云列（方法签名保持参数双变，异构表可统一调度） */
  payload(k: string, data: T, updatedAt: string): Record<string, unknown>
}

const progressAdapter: TableAdapter<ReadingProgress> = {
  getRows: () => useArticleStore.getState().progress,
  apply: (k, data) => useArticleStore.setState((s) => ({ progress: { ...s.progress, [k]: data } })),
  payload: (k, data, updatedAt) => ({ article_id: k, data, updated_at: updatedAt }),
}

const annotationsAdapter: TableAdapter<Annotation> = {
  allowTombstone: true,
  getRows: () => Object.fromEntries(useAnnotationStore.getState().annotations.map((a) => [a.id, a])),
  apply: (_k, ann) => {
    useAnnotationStore.setState((s) => ({
      annotations: s.annotations.some((a) => a.id === ann.id)
        ? s.annotations.map((a) => (a.id === ann.id ? ann : a))
        : [ann, ...s.annotations],
    }))
  },
  applyTombstone: (k) =>
    useAnnotationStore.setState((s) => ({
      annotations: s.annotations.filter((a) => a.id !== k),
    })),
  payload: (k, data, updatedAt) => ({ ann_id: k, data, deleted: false, updated_at: updatedAt }),
}

const studyAdapter: TableAdapter<ArticleStudy> = {
  getRows: () => useShenlunStore.getState().study,
  apply: (k, data) => useShenlunStore.setState((s) => ({ study: { ...s.study, [k]: data } })),
  payload: (k, data, updatedAt) => ({ article_id: k, data, updated_at: updatedAt }),
}

const examStudyAdapter: TableAdapter<QuestionTrace | QuestionMarks> = {
  getRows: () => {
    const s = useExamStudyStore.getState()
    return { ...s.traces, ...s.marks }
  },
  apply: (k, data) => {
    useExamStudyStore.setState((s) =>
      'points' in data ? { traces: { ...s.traces, [k]: data } } : { marks: { ...s.marks, [k]: data } },
    )
  },
  payload: (k, data, updatedAt) => {
    const kind = 'points' in data ? 'trace' : 'mark'
    return { kind, key: k, data, updated_at: updatedAt }
  },
}

const assistsAdapter: TableAdapter<AssistRecord> = {
  allowTombstone: true,
  getRows: () => useAiAssistStore.getState().records,
  apply: (_k, rec) => {
    useAiAssistStore.setState((s) => (s.records[rec.id] ? {} : { records: { ...s.records, [rec.id]: rec } }))
  },
  applyTombstone: (k) =>
    useAiAssistStore.setState((s) => {
      if (!s.records[k]) return s
      const records = { ...s.records }
      delete records[k]
      return { records }
    }),
  payload: (k, data, updatedAt) => ({ assist_id: k, data, updated_at: updatedAt }),
}

const editsAdapter: TableAdapter<Article> = {
  getRows: () => useArticleStore.getState().localEdits,
  apply: (k, article) =>
    useArticleStore.setState((s) => ({
      localEdits: { ...s.localEdits, [k]: article },
      articles: s.articles.some((a) => a.id === k)
        ? s.articles.map((a) => (a.id === k ? article : a))
        : [...s.articles, article],
    })),
  payload: (k, data, updatedAt) => ({ article_id: k, data, updated_at: updatedAt }),
}

const eventsAdapter: TableAdapter<LearningEvent> = {
  getRows: () => Object.fromEntries(useLearningEventStore.getState().events.map((e) => [e.id, e])),
  apply: (_k, ev) => {
    useLearningEventStore.setState((s) => (s.events.some((e) => e.id === ev.id) ? s : { events: [...s.events, ev] }))
  },
  payload: (k, data) => ({ event_id: k, data }),
}

/** 偏好整包（reader settings + theme），单行 */
function currentPrefs(): Record<string, unknown> {
  const reader = useReaderStore.getState().settings
  const { theme, autoDark } = useThemeStore.getState()
  return { reader, theme: { theme, autoDark }, deletedIds: useArticleStore.getState().deletedIds }
}
function applyPrefs(data: Record<string, unknown>) {
  const d = data as {
    reader?: Record<string, unknown>
    theme?: { theme?: never; autoDark?: boolean }
    deletedIds?: string[]
  }
  if (d.reader) useReaderStore.setState((s) => ({ settings: { ...s.settings, ...d.reader } }))
  if (d.theme?.theme) useThemeStore.setState({ theme: d.theme.theme as never, autoDark: !!d.theme.autoDark })
  if (Array.isArray(d.deletedIds) && d.deletedIds.length > 0) {
    const cloudDeleted = d.deletedIds
    useArticleStore.setState((s) => ({
      deletedIds: [...new Set([...s.deletedIds, ...cloudDeleted])],
    }))
  }
}

/** AI 服务配置整包（BYOK，同步后新设备免配置；RLS 限本人可读） */
function aiConfig(): Record<string, unknown> {
  return useAiStore.getState().settings as unknown as Record<string, unknown>
}
function applyAiConfig(data: Record<string, unknown>) {
  useAiStore.setState((s) => ({ settings: { ...s.settings, ...data } }))
}

const ADAPTERS = {
  reading_progress: progressAdapter,
  annotations: annotationsAdapter,
  article_study: studyAdapter,
  exam_study: examStudyAdapter,
  learning_events: eventsAdapter,
  ai_assists: assistsAdapter,
  article_edits: editsAdapter,
} as const

// ---------- 引擎 ----------

const meta: Meta = loadMeta()
let snapshot: Record<string, Record<string, unknown>> = {}
let pushTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let lastPullAt = 0
const cleanups: (() => void)[] = []

function nowISO() {
  return new Date().toISOString()
}

/** 登录后快照置空：首轮 push 以空为基线，把登录前（匿名期间）产生的本地数据全部推上云 */
function resetSnapshot() {
  snapshot = {}
}

async function pullTable(table: string, ad: TableAdapter<unknown>): Promise<boolean> {
  if (!supabase) return false
  const rows: CloudRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + UPSERT_BATCH - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const r of data as Record<string, unknown>[]) {
      const deleted = r.deleted === true
      const k = String(r.ann_id ?? r.article_id ?? r.event_id ?? r.key ?? '')
      if (!k) continue
      rows.push({
        k,
        data: (r.data as unknown) ?? null,
        deleted,
        updated_at: String(r.updated_at ?? r.created_at ?? ''),
      })
    }
    if (data.length < UPSERT_BATCH) break
    from += UPSERT_BATCH
  }
  const merged = mergePages([rows])
  const tableMeta = meta[table] ?? {}
  let applied = 0
  for (const [k, row] of merged) {
    if (row.deleted) {
      if (shouldApply(row.updated_at, tableMeta[k])) {
        ad.applyTombstone?.(k)
        tableMeta[k] = row.updated_at
        applied++
      }
      continue
    }
    if (row.data == null || !shouldApply(row.updated_at, tableMeta[k])) continue
    /* 本地存在同键行且内容一致则免写 */
    const local = ad.getRows()[k]
    if (local === undefined || !sameJSON(local, row.data)) {
      ad.apply(k, row.data)
      applied++
    }
    tableMeta[k] = row.updated_at
  }
  meta[table] = tableMeta
  return applied > 0
}

/** 当前登录用户 id（RLS 要求每行携带 user_id，缺省即被 with check 拒绝） */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  return (await supabase.auth.getSession()).data.session?.user.id ?? null
}

async function pushTable(table: string, ad: TableAdapter<unknown>, userId: string): Promise<boolean> {
  if (!supabase) return false
  const current = ad.getRows()
  const now = nowISO()
  const { upserts, tombstones } = diffRows(current, snapshot[table] ?? {}, now, !!ad.allowTombstone)
  if (upserts.length === 0 && tombstones.length === 0) return false
  const tableMeta = (meta[table] ??= {})

  for (let i = 0; i < upserts.length; i += UPSERT_BATCH) {
    const batch = upserts
      .slice(i, i + UPSERT_BATCH)
      .map((u) => ({ user_id: userId, ...ad.payload(u.k, u.data, u.updatedAt) }))
    const { error } = await supabase.from(table).upsert(batch, { defaultToNull: false })
    if (error) throw new Error(`${table}: ${error.message}`)
    for (const u of upserts.slice(i, i + UPSERT_BATCH)) tableMeta[u.k] = u.updatedAt
  }
  if (tombstones.length > 0) {
    const { error } = await supabase.from(table).upsert(
      tombstones.map((t) => ({
        user_id: userId,
        ann_id: t.k,
        data: null,
        deleted: true,
        updated_at: t.updatedAt,
      })),
      { defaultToNull: false },
    )
    if (error) throw new Error(`${table}: ${error.message}`)
    for (const t of tombstones) tableMeta[t.k] = t.updatedAt
  }
  return true
}

/** 整包单行表（user_prefs / user_ai_config）push：行级 LWW */
async function pushWhole(
  table: 'user_prefs' | 'user_ai_config',
  data: Record<string, unknown>,
  userId: string,
): Promise<boolean> {
  if (!supabase || sameJSON(data, snapshot[table])) return false
  const now = nowISO()
  const { error } = await supabase.from(table).upsert({ user_id: userId, data, updated_at: now })
  if (error) throw new Error(`${table}: ${error.message}`)
  snapshot[table] = data
  ;(meta[table] ??= {}).me = now
  return true
}

/** 整包单行表 pull */
async function pullWhole(
  table: 'user_prefs' | 'user_ai_config',
  current: () => Record<string, unknown>,
  apply: (data: Record<string, unknown>) => void,
): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.from(table).select('data, updated_at').maybeSingle()
  if (error) throw new Error(`${table}: ${error.message}`)
  if (!data) return false
  const updatedAt = String(data.updated_at ?? '')
  if (!shouldApply(updatedAt, meta[table]?.me)) return false
  if (!sameJSON(current(), data.data)) {
    apply(data.data as Record<string, unknown>)
    meta[table] = { me: updatedAt }
    snapshot[table] = data.data as Record<string, unknown>
    return true
  }
  meta[table] = { me: updatedAt }
  return false
}

async function runSync(): Promise<void> {
  if (!running || !supabase) return
  setSync({ syncing: true, error: null })
  try {
    let changedPref = false
    const userId = await currentUserId()
    if (!userId) return
    /* 整包类（偏好/AI 配置）先拉后推：登录首轮先吃云上较新的一份，避免本机旧配置盖掉其他设备的新配置 */
    if (await pullWhole('user_prefs', currentPrefs, applyPrefs)) changedPref = true
    if (await pullWhole('user_ai_config', aiConfig, applyAiConfig)) changedPref = true
    /* 行表先 push 后 pull：本地未推送修改先占住本机时间戳，LWW 才不会被旧云行反压。
     * 首轮快照为空 → 登录前匿名期间产生的本地数据也会全部推送 */
    for (const [table, ad] of Object.entries(ADAPTERS)) {
      if (await pushTable(table, ad, userId)) snapshot[table] = ad.getRows()
    }
    let changed = changedPref
    for (const [table, ad] of Object.entries(ADAPTERS)) {
      if (await pullTable(table, ad)) {
        changed = true
        snapshot[table] = ad.getRows()
      }
    }
    if (await pushWhole('user_prefs', currentPrefs(), userId)) changed = true
    if (await pushWhole('user_ai_config', aiConfig(), userId)) changed = true
    saveMeta(meta)
    if (changed) setSync({ lastSyncAt: nowISO() })
    else setSync({ lastSyncAt: useSyncStore.getState().lastSyncAt ?? nowISO() })
    lastPullAt = Date.now()
  } catch (err) {
    setSync({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    setSync({ syncing: false })
  }
}

function schedulePush() {
  if (!running) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void runSync()
  }, PUSH_DEBOUNCE_MS)
}

/** 登录后调用：push→pull 首轮同步 + 订阅各 store 与窗口聚焦 */
export function startCloudSync(): void {
  if (running || !supabase) return
  running = true
  resetSnapshot()

  const watch = (_table: string) => schedulePush()
  useArticleStore.subscribe(() => watch('reading_progress'))
  useAnnotationStore.subscribe(() => watch('annotations'))
  useShenlunStore.subscribe(() => watch('article_study'))
  useExamStudyStore.subscribe(() => watch('exam_study'))
  useLearningEventStore.subscribe(() => watch('learning_events'))
  useReaderStore.subscribe(() => watch('user_prefs'))
  useThemeStore.subscribe(() => watch('user_prefs'))
  useAiStore.subscribe(() => watch('user_ai_config'))

  const onFocus = () => {
    if (Date.now() - lastPullAt > PULL_MIN_INTERVAL_MS) void runSync()
  }
  window.addEventListener('focus', onFocus)
  cleanups.push(() => window.removeEventListener('focus', onFocus))

  void runSync()
}

/** 登出时调用：停订阅与定时器；meta 保留（同设备再登录仍可正确比对） */
export function stopCloudSync(): void {
  running = false
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  while (cleanups.length) cleanups.pop()?.()
}

/** 账号页「立即同步」 */
export function syncNow(): Promise<void> {
  return runSync()
}
