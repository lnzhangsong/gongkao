import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Annotation } from '../types'
import { idbStorage } from '../lib/idbStorage'

interface AnnotationState {
  annotations: Annotation[]
  /** 是否显示正文中的标注（设置页开关） */
  visible: boolean
  /** IndexedDB 异步水合是否完成 */
  _hasHydrated: boolean

  add: (a: Omit<Annotation, 'id' | 'createdAt'>) => Annotation
  update: (id: string, patch: Partial<Pick<Annotation, 'noteText' | 'noteRich' | 'tags' | 'color' | 'underlineStyle' | 'materialType' | 'memorized' | 'mastery' | 'pattern'>>) => void
  remove: (id: string) => void
  removeMany: (ids: string[]) => void
  removeForArticle: (articleId: string) => void
  /** 导入摘录（按 id 去重，已有的跳过） */
  importAnnotations: (list: Annotation[]) => void
  setVisible: (v: boolean) => void
  clearAll: () => void
}

let uid = 0
function genId(): string {
  uid += 1
  return `ann-${Date.now().toString(36)}-${uid}`
}

export const useAnnotationStore = create<AnnotationState>()(
  persist(
    (set) => ({
      annotations: [],
      visible: true,
      _hasHydrated: false,

      add: (a) => {
        const annotation: Annotation = { ...a, id: genId(), createdAt: new Date().toISOString() }
        set((s) => ({ annotations: [annotation, ...s.annotations] }))
        return annotation
      },

      update: (id, patch) =>
        set((s) => ({
          annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        })),

      remove: (id) =>
        set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),

      removeMany: (ids) => {
        const setIds = new Set(ids)
        set((s) => ({ annotations: s.annotations.filter((a) => !setIds.has(a.id)) }))
      },

      removeForArticle: (articleId) =>
        set((s) => ({ annotations: s.annotations.filter((a) => a.articleId !== articleId) })),

      importAnnotations: (list) =>
        set((s) => {
          const existing = new Set(s.annotations.map((a) => a.id))
          const fresh = list.filter((a) => !existing.has(a.id))
          if (fresh.length === 0) return s
          return { annotations: [...s.annotations, ...fresh] }
        }),

      setVisible: (v) => set({ visible: v }),

      clearAll: () => set({ annotations: [], visible: true }),
    }),
    {
      name: 'readbook:annotations',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ annotations: s.annotations, visible: s.visible }),
      onRehydrateStorage: () => () => {
        // 必须用 setState 通知订阅者（直接赋值不会触发重渲染）
        useAnnotationStore.setState({ _hasHydrated: true })
      },
    },
  ),
)
