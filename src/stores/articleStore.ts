import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Article, ArticleInput, ReadingProgress } from '../types'
import { computeReadTime } from '../data'
import { fetchMetaList, fetchArticle } from '../lib/api'
import { idbStorage } from '../lib/idbStorage'
import { useAnnotationStore } from './annotationStore'
import { useLearningEventStore } from './learningEventStore'

interface ArticleState {
  /**
   * 合并后的文章列表（视图）：
   * - 年编文章（p 前缀）：来自 GET /api/articles（meta，无正文）
   * - 本地录入/编辑（u 前缀或 localEdits 覆盖）：带正文
   * 不持久化：每次启动由 hydrate() 从 API + localEdits 重建
   */
  articles: Article[]
  /**
   * 本地编辑覆盖 / 新增文章（持久化，IndexedDB）
   * key = articleId：用户编辑过的年编文章（完整覆盖）、或录入的新文章
   */
  localEdits: Record<string, Article>
  /** 用户删除的年编文章 id（持久化，避免刷新后从 API 复活） */
  deletedIds: string[]
  /** 已拉取的单篇全文缓存（运行时，不持久化）：ensureContent 结果 */
  contentCache: Record<string, Article>
  /** 阅读进度 / 收藏（持久化） */
  progress: Record<string, ReadingProgress>
  /** IndexedDB 异步水合是否完成（读取前等待，避免丢失首屏状态） */
  _hasHydrated: boolean
  /** 文章数据（API）是否已加载 */
  _apiReady: boolean

  getArticle: (id: string) => Article | undefined
  getProgress: (id: string) => ReadingProgress | undefined
  /** 启动时加载：API meta + 本地覆盖合并 */
  hydrate: () => Promise<void>
  /** 确保某篇有正文：本地编辑有则用之，否则按需拉取单篇全文（结果缓存） */
  ensureContent: (id: string) => Promise<Article | undefined>
  /** 打开文章：记录开始时间与阅读次数 */
  startReading: (id: string) => void
  /** 保存滚动进度（lastPara：视口顶部附近的段落 index，恢复时按段锚点定位） */
  saveProgress: (id: string, percent: number, lastPosition: number, lastPara?: number) => void
  /** 累计实测阅读时长（秒） */
  addReadingTime: (id: string, seconds: number) => void
  /** 导入进度（按 articleId 合并覆盖） */
  importProgress: (map: Record<string, ReadingProgress>) => void
  /** 录入新文章，返回生成的 Article */
  addArticle: (input: ArticleInput) => Article
  /** 更新文章（重算阅读时长；年编文章写本地覆盖） */
  updateArticle: (id: string, input: ArticleInput) => void
  /** 删除文章（连同其进度与摘录；年编文章记入 deletedIds） */
  removeArticle: (id: string) => void
  /** 导入文章（按 id 覆盖/追加到本地编辑） */
  upsertArticles: (list: Article[]) => void
  toggleFavorite: (id: string) => void
  clearAll: () => void
}

const empty = (id: string): ReadingProgress => ({
  articleId: id,
  percent: 0,
  lastPosition: 0,
  lastReadAt: '',
  completed: false,
  readCount: 0,
  favorite: false,
  timeSpentSec: 0,
})

/* ---------- 离线缓存（IndexedDB 直存，不经 zustand persist） ---------- */
const META_CACHE_KEY = 'readbook:cache:meta'
const contentCacheKey = (id: string) => `readbook:cache:content:${id}`

async function cachePut(key: string, value: unknown) {
  try {
    await idbStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await idbStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

/** 并发去重：同一篇文章的 ensureContent 只发一次请求（阅读页 + 预取等同时调用时） */
const ensureInflight = new Map<string, Promise<Article | undefined>>()

/** 全文运行时缓存上限：超出后按进入顺序淘汰最早的（长年使用下内存不无限膨胀）。
 *  只影响 contentCache 缓存层，localEdits / articles 本体不受影响 */
const CONTENT_CACHE_LIMIT = 30
const contentCacheOrder: string[] = []

function putContentCache(s: ArticleState, id: string, article: Article): Partial<ArticleState> {
  const i = contentCacheOrder.indexOf(id)
  if (i >= 0) contentCacheOrder.splice(i, 1)
  contentCacheOrder.push(id)
  const cache = { ...s.contentCache, [id]: article }
  while (contentCacheOrder.length > CONTENT_CACHE_LIMIT) {
    delete cache[contentCacheOrder.shift()!]
  }
  return { contentCache: cache }
}

/** 用 API meta + localEdits/deletedIds 重建合并视图 */function buildArticles(
  apiMeta: Article[],
  localEdits: Record<string, Article>,
  deletedIds: string[],
): Article[] {
  const gone = new Set(deletedIds)
  const merged: Article[] = []
  for (const a of apiMeta) {
    if (gone.has(a.id)) continue
    merged.push(localEdits[a.id] ?? a)
  }
  // 本地新增（不在 API 中）
  for (const a of Object.values(localEdits)) {
    if (!apiMeta.some((m) => m.id === a.id)) merged.push(a)
  }
  return merged
}

export const useArticleStore = create<ArticleState>()(
  persist(
    (set, get) => ({
      articles: [],
      localEdits: {},
      deletedIds: [],
      contentCache: {},
      progress: {},
      _hasHydrated: false,
      _apiReady: false,

      getArticle: (id) => get().contentCache[id] ?? get().articles.find((a) => a.id === id),

      getProgress: (id) => get().progress[id],

      hydrate: async () => {
        try {
          const { articles } = await fetchMetaList()
          void cachePut(META_CACHE_KEY, articles)
          set((s) => ({
            articles: buildArticles(articles, s.localEdits, s.deletedIds),
            _apiReady: true,
          }))
        } catch (e) {
          /* 无网/服务不可用：回退离线缓存的 meta（真·离线阅读） */
          const cached = await cacheGet<Article[]>(META_CACHE_KEY)
          if (!cached && Object.keys(get().localEdits).length === 0) {
            console.error('加载文章列表失败', e)
          }
          set((s) => ({
            articles: buildArticles(cached ?? [], s.localEdits, s.deletedIds),
            _apiReady: true,
          }))
        }
      },

      ensureContent: async (id) => {
        const cached = get().contentCache[id]
        if (cached?.content?.length) return cached
        const current = get().articles.find((a) => a.id === id)
        if (current?.content?.length) {
          set((s) => putContentCache(s, id, current))
          return current
        }
        const local = get().localEdits[id]
        if (local?.content?.length) {
          set((s) => putContentCache(s, id, local))
          return local
        }

        const inflight = ensureInflight.get(id)
        if (inflight) return inflight
        const task = (async () => {
          try {
            const full = await fetchArticle(id)
            void cachePut(contentCacheKey(id), full)
            set((s) => ({
              ...putContentCache(s, id, full),
              articles: s.articles.map((a) => (a.id === id ? full : a)),
            }))
            return full
          } catch {
            /* 拉取失败（离线等）：回退离线缓存的全文 */
            const offline = await cacheGet<Article>(contentCacheKey(id))
            if (offline?.content?.length) {
              set((s) => ({
                ...putContentCache(s, id, offline),
                articles: s.articles.some((a) => a.id === id)
                  ? s.articles.map((a) => (a.id === id ? offline : a))
                  : s.articles,
              }))
              return offline
            }
            return undefined
          } finally {
            ensureInflight.delete(id)
          }
        })()
        ensureInflight.set(id, task)
        return task
      },

      startReading: (id) =>
        set((s) => {
          const prev = s.progress[id]
          if (prev && prev.startedAt) {
            return { progress: { ...s.progress, [id]: { ...prev, readCount: prev.readCount + 1 } } }
          }
          const now = new Date().toISOString()
          return {
            progress: {
              ...s.progress,
              [id]: { ...empty(id), startedAt: now, lastReadAt: now, readCount: 1 },
            },
          }
        }),

      saveProgress: (id, percent, lastPosition, lastPara) =>
        set((s) => {
          const prev = s.progress[id] ?? empty(id)
          const clamped = Math.max(0, Math.min(100, Math.round(percent)))
          const completed = prev.completed || clamped >= 95
          /* 证据采集（事件层）：首次读完记一条弱证据，同日自动去重 */
          if (completed && !prev.completed) useLearningEventStore.getState().log('read-finish', id)
          return {
            progress: {
              ...s.progress,
              [id]: {
                ...prev,
                percent: Math.max(prev.percent, clamped),
                lastPosition,
                lastPara,
                lastReadAt: new Date().toISOString(),
                completed,
              },
            },
          }
        }),

      addReadingTime: (id, seconds) =>
        set((s) => {
          if (seconds <= 0) return s
          const prev = s.progress[id] ?? empty(id)
          return {
            progress: {
              ...s.progress,
              [id]: { ...prev, timeSpentSec: (prev.timeSpentSec ?? 0) + Math.round(seconds) },
            },
          }
        }),

      importProgress: (map) =>
        set((s) => ({ progress: { ...s.progress, ...map } })),

      addArticle: (input) => {
        const article: Article = {
          id: `u${Date.now().toString(36)}`,
          ...input,
          readTime: computeReadTime(input.content ?? []),
        }
        set((s) => ({
          localEdits: { ...s.localEdits, [article.id]: article },
          articles: [...s.articles, article],
        }))
        return article
      },

      updateArticle: (id, input) =>
        set((s) => {
          const prev = s.localEdits[id] ?? s.articles.find((a) => a.id === id)
          const updated: Article = {
            ...prev,
            id,
            ...input,
            readTime: computeReadTime(input.content ?? []),
          }
          return {
            localEdits: { ...s.localEdits, [id]: updated },
            articles: s.articles.map((a) => (a.id === id ? updated : a)),
          }
        }),

      removeArticle: (id) => {
        set((s) => {
          const progress = { ...s.progress }
          delete progress[id]
          const localEdits = { ...s.localEdits }
          delete localEdits[id]
          // 年编文章：记入 deletedIds，避免刷新后复活；本地文章：直接移除
          const deletedIds = s.deletedIds.includes(id) ? s.deletedIds : [...s.deletedIds, id]
          return {
            articles: s.articles.filter((a) => a.id !== id),
            localEdits,
            deletedIds,
            progress,
          }
        })
        useAnnotationStore.getState().removeForArticle(id)
      },

      upsertArticles: (list) =>
        set((s) => {
          const localEdits = { ...s.localEdits }
          for (const a of list) localEdits[a.id] = a
          return {
            localEdits,
            articles: buildArticles(
              s.articles.filter((a) => !list.some((n) => n.id === a.id)),
              localEdits,
              s.deletedIds,
            ),
          }
        }),

      toggleFavorite: (id) =>
        set((s) => {
          const prev = s.progress[id] ?? empty(id)
          return { progress: { ...s.progress, [id]: { ...prev, favorite: !prev.favorite } } }
        }),

      clearAll: () => set({ progress: {} }),
    }),
    {
      name: 'readbook:articles',
      version: 2,
      storage: createJSONStorage(() => idbStorage),
      // 年编文章由 API 提供，不持久化；只持久化本地覆盖/删除标记与进度
      partialize: (s) => ({ localEdits: s.localEdits, deletedIds: s.deletedIds, progress: s.progress }),
      migrate: (persisted) => {
        const p = persisted as { localEdits?: unknown; deletedIds?: unknown }
        // v1 → v2：文章改为 API 只读 + 本地覆盖，丢弃旧的 articles 快照
        const old = persisted as { articles?: unknown }
        if ('articles' in old) delete old.articles
        if (!p.localEdits) p.localEdits = {}
        if (!p.deletedIds) p.deletedIds = []
        return p as never
      },
      onRehydrateStorage: () => () => {
        useArticleStore.setState({ _hasHydrated: true })
      },
    },
  ),
)
