import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { idbStorage } from '../lib/idbStorage'
import { useLearningEventStore } from './learningEventStore'

/**
 * 行测做题 store（docs/行测做题模块设计方案.md X2/X3）：
 * 客观题作答记录——选项、对错、耗时。本地优先（IndexedDB），云同步见 cloudSync xg_answers。
 * 与 examStudyStore 同范式，但行测答案客观唯一，无 traces/marks 双键问题，单键 paperId#qIdx。
 */

export interface XgAnswer {
  paperId: string
  /** 卷内题号（xg_questions.idx） */
  qIdx: number
  /** 所选项 "A"-"E"；空串 = 未答（交卷缺答） */
  picked: string
  correct: boolean
  /** 本题耗时秒（按进入题组到提交估） */
  seconds: number
  origin: 'exam' | 'practice'
  updatedAt: string
}

/** 溯源 key：`${paperId}#${qIdx}` */
export const xgKey = (paperId: string, qIdx: number) => `${paperId}#${qIdx}`

/** 云同步 / 持久化数据形状校验：坏记录拒入 store（examStudyStore rec.marks 事故同款防线） */
export function asXgAnswer(data: unknown): XgAnswer | null {
  const d = data as Partial<XgAnswer> | null
  if (
    d &&
    typeof d === 'object' &&
    typeof d.paperId === 'string' &&
    typeof d.qIdx === 'number' &&
    typeof d.picked === 'string' &&
    typeof d.correct === 'boolean' &&
    typeof d.updatedAt === 'string'
  ) {
    return d as XgAnswer
  }
  return null
}

interface XingceState {
  answers: Record<string, XgAnswer>
  _hasHydrated: boolean
  /** 记录一次作答（练习/考试共用；错题写入学习事件流供复习排期） */
  record: (answer: XgAnswer) => void
  /** 清空某卷全部作答（重做整卷） */
  clearPaper: (paperId: string) => void
}

function upsert(s: XingceState, next: XgAnswer): Pick<XingceState, 'answers'> {
  return { answers: { ...s.answers, [xgKey(next.paperId, next.qIdx)]: next } }
}

export const useXingceStore = create<XingceState>()(
  persist(
    (set) => ({
      answers: {},
      _hasHydrated: false,

      record: (answer) =>
        set((s) => {
          if (!answer.correct) useLearningEventStore.getState().log('xingce-wrong', xgKey(answer.paperId, answer.qIdx))
          return upsert(s, answer)
        }),

      clearPaper: (paperId) =>
        set((s) => {
          const next: Record<string, XgAnswer> = {}
          for (const [k, v] of Object.entries(s.answers)) if (v.paperId !== paperId) next[k] = v
          return { answers: next }
        }),
    }),
    {
      name: 'readbook:xingce',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ answers: s.answers }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const answers: Record<string, XgAnswer> = {}
          let dirty = false
          for (const [k, rec] of Object.entries(state.answers)) {
            const ok = asXgAnswer(rec)
            if (ok) answers[k] = ok
            else dirty = true
          }
          useXingceStore.setState(dirty ? { answers, _hasHydrated: true } : { _hasHydrated: true })
          return
        }
        useXingceStore.setState({ _hasHydrated: true })
      },
    },
  ),
)
