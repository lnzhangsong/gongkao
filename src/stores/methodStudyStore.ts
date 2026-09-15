import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { idbStorage } from '../lib/idbStorage'

/**
 * 《申论写作八讲》学习进度 store（docs/申论方法论书融入方案.md）：
 * 以渲染单元（讲导语/节/目，unitId 形如 l01-u03）为粒度记「已读」。
 * 只做本地优先（IndexedDB readbook:method-study），暂不进云同步与学习事件流——
 * 读书记录是否接入复习排期，等复习算法侧有结论再定（见方案文档「后续」）。
 */

/** 持久化数据形状校验：坏记录拒入 store（examStudyStore rec.marks 事故同款防线） */
export function asDoneMap(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof k === 'string' && /^l\d{2}-u\d{2}$/.test(k) && typeof v === 'string') out[k] = v
  }
  return out
}

interface MethodStudyState {
  /** unitId → 标记已读的时间（ISO 字符串） */
  done: Record<string, string>
  _hasHydrated: boolean
  /** 切换某单元已读态；显式传 done 可批量场景直接指定 */
  toggle: (unitId: string, done?: boolean) => void
  /** 清空整机读书记录（退出登录时与其余 store 一起清，避免换账号串数据） */
  clearAll: () => void
}

export const useMethodStudyStore = create<MethodStudyState>()(
  persist(
    (set) => ({
      done: {},
      _hasHydrated: false,

      toggle: (unitId, target) =>
        set((s) => {
          const next = { ...s.done }
          const willRead = target ?? !(unitId in s.done)
          if (willRead) next[unitId] = new Date().toISOString()
          else delete next[unitId]
          return { done: next }
        }),

      clearAll: () => set({ done: {} }),
    }),
    {
      name: 'readbook:method-study',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ done: s.done }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const done = asDoneMap(state.done)
          const dirty = Object.keys(done).length !== Object.keys(state.done).length
          useMethodStudyStore.setState(dirty ? { done, _hasHydrated: true } : { _hasHydrated: true })
          return
        }
        useMethodStudyStore.setState({ _hasHydrated: true })
      },
    },
  ),
)
