import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { EVIDENCE, type EvidenceKind, type LearningObjectType } from '../lib/learningEvents'
import { idbStorage } from '../lib/idbStorage'

/** 学习事件流水：只追加，不改写（docs/学习者数据模型设计.md 第 1 期） */
export interface LearningEvent {
  id: string
  objectId: string
  objectType: LearningObjectType
  kind: EvidenceKind
  weight: 1 | 2 | 3 | 4
  at: string
}

interface LearningEventState {
  events: LearningEvent[]
  _hasHydrated: boolean

  /** 记录一条证据；同一对象同一证据同一天只记一次（防抖写入不刷屏） */
  log: (kind: EvidenceKind, objectId: string) => void
  importEvents: (list: LearningEvent[]) => void
  clearAll: () => void
}

let uid = 0
function genId(): string {
  uid += 1
  return `lev-${Date.now().toString(36)}-${uid}`
}

function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10)
}

export const useLearningEventStore = create<LearningEventState>()(
  persist(
    (set, get) => ({
      events: [],
      _hasHydrated: false,

      log: (kind, objectId) => {
        const def = EVIDENCE[kind]
        if (!def || !objectId) return
        const now = new Date().toISOString()
        /* 同对象同证据同日去重：防抖类写入（每键落盘）不会灌爆事件流 */
        if (get().events.some((e) => e.kind === kind && e.objectId === objectId && sameDay(e.at, now))) return
        const event: LearningEvent = {
          id: genId(),
          objectId,
          objectType: def.objectType,
          kind,
          weight: def.weight,
          at: now,
        }
        set((s) => ({ events: [...s.events, event] }))
      },

      importEvents: (list) =>
        set((s) => {
          const seen = new Set(s.events.map((e) => `${e.kind}|${e.objectId}|${e.at}`))
          const next = [...s.events]
          for (const e of list) {
            if (!e || typeof e.objectId !== 'string' || typeof e.kind !== 'string') continue
            if (!EVIDENCE[e.kind as EvidenceKind]) continue
            const key = `${e.kind}|${e.objectId}|${e.at}`
            if (seen.has(key)) continue
            seen.add(key)
            next.push({ ...e, id: e.id || genId() })
          }
          return { events: next }
        }),

      clearAll: () => set({ events: [] }),
    }),
    {
      name: 'readbook:learning-events',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ events: s.events }),
      onRehydrateStorage: () => () => {
        useLearningEventStore.setState({ _hasHydrated: true })
      },
    },
  ),
)
