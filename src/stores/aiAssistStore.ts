import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ArticleTopic } from '../types'
import { idbStorage } from '../lib/idbStorage'

/**
 * AI 审题立意 + 作答框架（申论写作AI辅助设计方案 §6.2，决策 D14）：
 * - 按题干存一份记录：审题立意 + 可编辑框架要点
 * - 每个要点挂素材标注 id（Prompt 组装时由 AI 从候选素材中挑选，前端映射回标注）
 * - 产出走「生成 → 人工确认/编辑 → 入库」，不覆盖用户已有记录（upsert 按 id）
 */

/** 申论五类题型 */
export type QuestionType = '概括' | '分析' | '对策' | '应用文' | '大作文'

export const QUESTION_TYPES: QuestionType[] = ['概括', '分析', '对策', '应用文', '大作文']

export interface OutlineItem {
  id: string
  /** 要点/条目正文（概括题=要点；大作文=分论点；对策题=对策条目…） */
  text: string
  /** 挂载的素材标注 id（annotationStore） */
  materialIds: string[]
}

export interface AssistRecord {
  id: string
  question: string
  questionType: QuestionType
  topic?: ArticleTopic
  /** 审题立意 / 作答方向 */
  stance: string
  outline: OutlineItem[]
  createdAt: string
  updatedAt: string
}

interface AiAssistState {
  records: Record<string, AssistRecord>
  upsert: (rec: AssistRecord) => void
  remove: (id: string) => void
  setStance: (id: string, stance: string) => void
  addOutlineItem: (id: string, text: string) => void
  updateOutlineItem: (id: string, itemId: string, patch: Partial<Pick<OutlineItem, 'text' | 'materialIds'>>) => void
  removeOutlineItem: (id: string, itemId: string) => void
  clearAll: () => void
}

export function newId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function emptyRecord(question: string, questionType: QuestionType, topic?: ArticleTopic): AssistRecord {
  const now = new Date().toISOString()
  return { id: newId(), question, questionType, topic, stance: '', outline: [], createdAt: now, updatedAt: now }
}

export const useAiAssistStore = create<AiAssistState>()(
  persist(
    (set) => ({
      records: {},
      upsert: (rec) =>
        set((s) => ({
          records: { ...s.records, [rec.id]: { ...rec, updatedAt: new Date().toISOString() } },
        })),
      remove: (id) =>
        set((s) => {
          if (!s.records[id]) return s
          const next = { ...s.records }
          delete next[id]
          return { records: next }
        }),
      setStance: (id, stance) =>
        set((s) => {
          const cur = s.records[id]
          if (!cur) return s
          return { records: { ...s.records, [id]: { ...cur, stance, updatedAt: new Date().toISOString() } } }
        }),
      addOutlineItem: (id, text) =>
        set((s) => {
          const cur = s.records[id]
          if (!cur) return s
          const item: OutlineItem = { id: newId(), text, materialIds: [] }
          return {
            records: {
              ...s.records,
              [id]: { ...cur, outline: [...cur.outline, item], updatedAt: new Date().toISOString() },
            },
          }
        }),
      updateOutlineItem: (id, itemId, patch) =>
        set((s) => {
          const cur = s.records[id]
          if (!cur) return s
          return {
            records: {
              ...s.records,
              [id]: {
                ...cur,
                outline: cur.outline.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
                updatedAt: new Date().toISOString(),
              },
            },
          }
        }),
      removeOutlineItem: (id, itemId) =>
        set((s) => {
          const cur = s.records[id]
          if (!cur) return s
          return {
            records: {
              ...s.records,
              [id]: {
                ...cur,
                outline: cur.outline.filter((it) => it.id !== itemId),
                updatedAt: new Date().toISOString(),
              },
            },
          }
        }),
      clearAll: () => set({ records: {} }),
    }),
    {
      name: 'readbook:ai-assist',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ records: s.records }),
    },
  ),
)
