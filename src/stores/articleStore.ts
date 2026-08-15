import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Article, ReadingProgress } from '../types'
import { MOCK_ARTICLES_ALL } from '../data'

interface ArticleState {
  /** mock 文章（静态） */
  articles: Article[]
  /** 阅读进度 / 收藏（持久化） */
  progress: Record<string, ReadingProgress>

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

      toggleFavorite: (id) =>
        set((s) => {
          const prev = s.progress[id] ?? empty(id)
          return { progress: { ...s.progress, [id]: { ...prev, favorite: !prev.favorite } } }
        }),

      clearAll: () => set({ progress: {} }),
    }),
    {
      name: 'readbook:articles',
      partialize: (s) => ({ progress: s.progress }),
    },
  ),
)
