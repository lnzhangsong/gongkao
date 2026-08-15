import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Article, ArticleInput, ReadingProgress } from '../types'
import { MOCK_ARTICLES_ALL, computeReadTime } from '../data'
import { idbStorage } from '../lib/idbStorage'
import { useAnnotationStore } from './annotationStore'

interface ArticleState {
  /** 文章列表：mock 种子 + 用户录入/编辑（持久化，IndexedDB） */
  articles: Article[]
  /** 阅读进度 / 收藏（持久化） */
  progress: Record<string, ReadingProgress>
  /** IndexedDB 异步水合是否完成（读取前等待，避免丢失首屏状态） */
  _hasHydrated: boolean

  getArticle: (id: string) => Article | undefined
  getProgress: (id: string) => ReadingProgress | undefined
  /** 打开文章：记录开始时间与阅读次数 */
  startReading: (id: string) => void
  /** 保存滚动进度 */
  saveProgress: (id: string, percent: number, lastPosition: number) => void
  /** 累计实测阅读时长（秒） */
  addReadingTime: (id: string, seconds: number) => void
  /** 导入进度（按 articleId 合并覆盖） */
  importProgress: (map: Record<string, ReadingProgress>) => void
  /** 录入新文章，返回生成的 Article */
  addArticle: (input: ArticleInput) => Article
  /** 更新文章（重算阅读时长） */
  updateArticle: (id: string, input: ArticleInput) => void
  /** 删除文章（连同其进度与摘录） */
  removeArticle: (id: string) => void
  /** 导入文章（按 id 覆盖/追加） */
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

export const useArticleStore = create<ArticleState>()(
  persist(
    (set, get) => ({
      articles: MOCK_ARTICLES_ALL,
      progress: {},
      _hasHydrated: false,

      getArticle: (id) => get().articles.find((a) => a.id === id),

      getProgress: (id) => get().progress[id],

      startReading: (id) =>
        set((s) => {
          const prev = s.progress[id]
          if (prev && prev.startedAt) {
            // 已开始过：仅累加一次阅读次数（每次进入页面都计数）
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

      saveProgress: (id, percent, lastPosition) =>
        set((s) => {
          const prev = s.progress[id] ?? empty(id)
          const clamped = Math.max(0, Math.min(100, Math.round(percent)))
          const completed = prev.completed || clamped >= 95
          return {
            progress: {
              ...s.progress,
              [id]: {
                ...prev,
                percent: Math.max(prev.percent, clamped),
                lastPosition,
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
          readTime: computeReadTime(input.content),
        }
        set((s) => ({ articles: [...s.articles, article] }))
        return article
      },

      updateArticle: (id, input) =>
        set((s) => ({
          articles: s.articles.map((a) =>
            a.id === id ? { ...a, ...input, readTime: computeReadTime(input.content) } : a,
          ),
        })),

      removeArticle: (id) => {
        set((s) => {
          const progress = { ...s.progress }
          delete progress[id]
          return { articles: s.articles.filter((a) => a.id !== id), progress }
        })
        useAnnotationStore.getState().removeForArticle(id)
      },

      upsertArticles: (list) =>
        set((s) => {
          const map = new Map(s.articles.map((a) => [a.id, a]))
          for (const a of list) map.set(a.id, a)
          return { articles: [...map.values()] }
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
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ articles: s.articles, progress: s.progress }),
      onRehydrateStorage: () => () => {
        // 必须用 setState 通知订阅者（直接赋值不会触发重渲染）
        useArticleStore.setState({ _hasHydrated: true })
      },
    },
  ),
)
