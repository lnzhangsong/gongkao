import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ArticleSkeleton, ParagraphSummary } from '../types'
import { idbStorage } from '../lib/idbStorage'

/** 学习状态：未学 / 学习中 / 已掌握 */
export type StudyStatus = 'new' | 'learning' | 'mastered'

export interface ArticleStudy {
  articleId: string
  status: StudyStatus
  /** 掌握度 1–3 星，0 = 未评估 */
  mastery: 0 | 1 | 2 | 3
  coreThesis: string
  subTheses: string[]
  reviewNote?: string
  /* —— 范文精读（决策 D15，可选字段、向后兼容）—— */
  /** 每段大意，paraIndex 对应 content[] 段落序号 */
  paragraphSummaries?: ParagraphSummary[]
  /** 结构骨架 */
  skeleton?: ArticleSkeleton
  createdAt: string
  updatedAt: string
}

interface ArticleState {  study: Record<string, ArticleStudy>
  _hasHydrated: boolean

  getStudy: (articleId: string) => ArticleStudy | undefined
  upsert: (articleId: string, patch: Partial<Omit<ArticleStudy, 'articleId'>>) => void
  setStatus: (articleId: string, status: StudyStatus) => void
  setMastery: (articleId: string, mastery: 0 | 1 | 2 | 3) => void
  setCoreThesis: (articleId: string, text: string) => void
  addSubThesis: (articleId: string, text: string) => void
  updateSubThesis: (articleId: string, index: number, text: string) => void
  removeSubThesis: (articleId: string, index: number) => void
  setReviewNote: (articleId: string, text: string) => void
  /* 范文精读 */
  setParagraphSummary: (articleId: string, paraIndex: number, summary: string) => void
  setSkeleton: (articleId: string, patch: Partial<ArticleSkeleton>) => void
  removeForArticle: (articleId: string) => void
  importStudy: (list: ArticleStudy[]) => void
  clearAll: () => void
}

function emptyStudy(articleId: string): ArticleStudy {
  return {
    articleId,
    status: 'new',
    mastery: 0,
    coreThesis: '',
    subTheses: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export const useShenlunStore = create<ArticleState>()(
  persist(
    (set, get) => ({
      study: {},
      _hasHydrated: false,

      getStudy: (articleId) => get().study[articleId],

      upsert: (articleId, patch) =>
        set((s) => {
          const cur = s.study[articleId] ?? emptyStudy(articleId)
          return {
            study: {
              ...s.study,
              [articleId]: { ...cur, ...patch, articleId, updatedAt: new Date().toISOString() },
            },
          }
        }),

      setStatus: (articleId, status) => get().upsert(articleId, { status }),
      setMastery: (articleId, mastery) => get().upsert(articleId, { mastery }),
      setCoreThesis: (articleId, text) => get().upsert(articleId, { coreThesis: text }),

      addSubThesis: (articleId, text) => {
        const cur = get().study[articleId]
        get().upsert(articleId, { subTheses: [...(cur?.subTheses ?? []), text] })
      },
      updateSubThesis: (articleId, index, text) => {
        const cur = get().study[articleId]
        if (!cur) return
        const next = [...cur.subTheses]
        next[index] = text
        get().upsert(articleId, { subTheses: next })
      },
      removeSubThesis: (articleId, index) => {
        const cur = get().study[articleId]
        if (!cur) return
        get().upsert(articleId, { subTheses: cur.subTheses.filter((_, i) => i !== index) })
      },

      setReviewNote: (articleId, text) => get().upsert(articleId, { reviewNote: text }),

      setParagraphSummary: (articleId, paraIndex, summary) => {
        const cur = get().study[articleId]
        const list = (cur?.paragraphSummaries ?? []).filter((p) => p.paraIndex !== paraIndex)
        if (!summary.trim() && !cur) return
        const next = summary.trim()
          ? [...list, { paraIndex, summary: summary.trim() }].sort((a, b) => a.paraIndex - b.paraIndex)
          : list
        get().upsert(articleId, { paragraphSummaries: next })
      },

      setSkeleton: (articleId, patch) => {
        const cur = get().study[articleId]
        get().upsert(articleId, { skeleton: { ...(cur?.skeleton ?? {}), ...patch } })
      },

      removeForArticle: (articleId) =>
        set((s) => {
          if (!s.study[articleId]) return s
          const next = { ...s.study }
          delete next[articleId]
          return { study: next }
        }),

      importStudy: (list) =>
        set((s) => {
          const next = { ...s.study }
          for (const item of list) {
            if (item && typeof item.articleId === 'string') next[item.articleId] = item
          }
          return { study: next }
        }),

      clearAll: () => set({ study: {} }),
    }),
    {
      name: 'readbook:shenlun',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ study: s.study }),
      onRehydrateStorage: () => () => {
        useShenlunStore.setState({ _hasHydrated: true })
      },
    },
  ),
)
