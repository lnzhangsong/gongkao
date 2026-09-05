import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { idbStorage } from '../lib/idbStorage'
import { useLearningEventStore } from './learningEventStore'

/**
 * 答案溯源 store（申论方法论与答案溯源设计方案 §四，M1）：
 * 真题参考答案逐要点拆解——要点句 + 加工方式 + 来源材料 + 原文摘句 + 加工说明。
 * 性质与 shenlunStore 相同：用户（可借助 AI）产生的学习数据，本地优先（IndexedDB），
 * 不进 SQLite 真题库（生产只读，迁移留 M3）。
 */

/** 加工方式：答案要点从材料原文到答案表述的加工类型（决策 M-3：六类，覆盖「抄材料→半加工→全加工→材料外」） */
export const DERIVE_MODES = ['摘抄', '改写', '提升', '归纳', '推理', '补充'] as const
export type DeriveMode = (typeof DERIVE_MODES)[number]

/** 各加工方式一句话说明（徽标 title） */
export const DERIVE_MODE_HINTS: Record<DeriveMode, string> = {
  摘抄: '原词原句直接可用',
  改写: '同义换写：口语 → 书面',
  提升: '具体现象上纲为规范表达',
  归纳: '多个同类信息合并 + 前置总括词',
  推理: '从材料信息分析推断（问题反推对策等）',
  补充: '材料外：背景 / 常识 / 热词补充',
}

export interface AnswerPointTrace {
  id: string
  /** 要点句：对应参考答案中的一条 / 一层（无答案题为推导出的参考要点） */
  text: string
  /** 加工方式 */
  mode: DeriveMode
  /** 来源材料 idx（materials[].idx）；null = 材料外（背景/常识/热词） */
  sourceIdx: number | null
  /** 思维路径（旧字段，兼容保留）：怎么想到这条的 */
  think?: string
  /** 定位方法：从题干哪个词出发、按什么依据找到这则材料/这一处——可复用的查找方法 */
  locate?: string
  /** 原文摘句：答案由这句话加工而来 */
  quote?: string
  /** 加工说明（旧字段，兼容保留）：怎么从原文变成答案话 */
  note?: string
  /** 加工判断：为什么用这种加工方式而不是别的——原文说法与答案表述差在哪 */
  modeWhy?: string
}

export interface QuestionTrace {
  paperId: string
  /** 题目在试卷内的序号（questions[].idx） */
  qIdx: number
  /** 最近一次写入来源 */
  origin: 'ai' | 'manual'
  points: AnswerPointTrace[]
  updatedAt: string
}

/** 溯源 key：`${paperId}#${qIdx}` */
export const traceKey = (paperId: string, qIdx: number) => `${paperId}#${qIdx}`

interface ExamStudyState {
  traces: Record<string, QuestionTrace>
  marks: Record<string, QuestionMarks>
  _hasHydrated: boolean

  /** 保存整组要点（AI 草稿确认入库 / 整组重写） */
  setPoints: (paperId: string, qIdx: number, points: AnswerPointTrace[], origin: 'ai' | 'manual') => void
  addPoint: (paperId: string, qIdx: number, point: AnswerPointTrace) => void
  updatePoint: (paperId: string, qIdx: number, pointId: string, patch: Partial<Omit<AnswerPointTrace, 'id'>>) => void
  removePoint: (paperId: string, qIdx: number, pointId: string) => void
  /* —— 原文标注（针对某道题，圈材料里的重要句 + 行文作用 + 答题用法）—— */
  setMarks: (paperId: string, qIdx: number, marks: MaterialMark[], origin: 'ai' | 'manual') => void
  /** 删除某卷某材料的所有层级标注（重新生成前清场） */
  removeMaterialMarks: (paperId: string, matIdx: number) => void
  updateMark: (paperId: string, qIdx: number, markId: string, patch: Partial<Omit<MaterialMark, 'id' | 'matIdx'>>) => void
  removeMark: (paperId: string, qIdx: number, markId: string) => void
  removeForPaper: (paperId: string) => void
  importTraces: (list: QuestionTrace[]) => void
  clearAll: () => void
}

/** 原文标注：一句材料原文 + 它的行文作用 + 答题用法（定位由前端按 quote 在段落中匹配） */
/** 重要性三级：core 直接得分 / normal 辅助理解 / useless 无关（划掉并注明原因） */
export const MARK_LEVELS = ['core', 'normal', 'useless'] as const
export type MarkLevel = (typeof MARK_LEVELS)[number]
export const MARK_LEVEL_LABELS: Record<MarkLevel, string> = { core: '核心', normal: '辅助', useless: '无用' }

/** 行文作用体系：AI 按此分类，编辑下拉同源（覆盖内容作用 + 结构作用 + 关键词） */
export const MARK_ROLES = [
  '案例叙事',
  '数据支撑',
  '权威观点',
  '民众声音',
  '问题呈现',
  '成绩成效',
  '对策做法',
  '原因分析',
  '意义影响',
  '危害后果',
  '背景铺垫',
  '转折',
  '递进',
  '衔接过渡',
  '总结收束',
  '核心概念',
  '高频关键词',
] as const

export interface MaterialMark {
  id: string
  /** 所属材料 idx（materials[].idx） */
  matIdx: number
  /** 材料原文重要句（连续片段，前端做空白不敏感匹配） */
  quote: string
  /** 行文作用：取 MARK_ROLES 体系（案例叙事/转折/递进/衔接过渡/核心概念…），自由文本兼容 */
  role: string
  /** 答题思路：每句必有——服务题干哪个设问、怎么用进答案 */
  use?: string
  /** 重要性：决定高亮与思路卡的颜色（core=accent / normal=蓝） */
  level?: MarkLevel
  /** 行文阶段编号（AI 产出，同阶段同号）；无则展示端按连续同作用兜底分组 */
  stage?: number
  /** 所在行文阶段的一句话概括（AI 产出，同阶段重复携带） */
  stageSummary?: string
}

export interface QuestionMarks {
  paperId: string
  qIdx: number
  origin: 'ai' | 'manual'
  marks: MaterialMark[]
  updatedAt: string
}

function upsertTrace(
  s: ExamStudyState,
  paperId: string,
  qIdx: number,
  fn: (cur: QuestionTrace) => QuestionTrace,
): Pick<ExamStudyState, 'traces'> {
  const key = traceKey(paperId, qIdx)
  const cur: QuestionTrace = s.traces[key] ?? {
    paperId,
    qIdx,
    origin: 'manual',
    points: [],
    updatedAt: new Date().toISOString(),
  }
  const next = fn(cur)
  return { traces: { ...s.traces, [key]: { ...next, updatedAt: new Date().toISOString() } } }
}

export const useExamStudyStore = create<ExamStudyState>()(
  persist(
    (set) => ({
      traces: {},
      marks: {},
      _hasHydrated: false,

      setPoints: (paperId, qIdx, points, origin) =>
        set((s) => {
          /* 证据采集（事件层，第 3 期输出端回流）：完成一次要点加工，对象为该题 trace */
          if (points.length > 0) useLearningEventStore.getState().log('exam-answer', traceKey(paperId, qIdx))
          return upsertTrace(s, paperId, qIdx, (cur) => ({ ...cur, points, origin }))
        }),

      addPoint: (paperId, qIdx, point) =>
        set((s) => {
          useLearningEventStore.getState().log('exam-answer', traceKey(paperId, qIdx))
          return upsertTrace(s, paperId, qIdx, (cur) => ({ ...cur, points: [...cur.points, point], origin: 'manual' }))
        }),

      updatePoint: (paperId, qIdx, pointId, patch) =>
        set((s) =>
          upsertTrace(s, paperId, qIdx, (cur) => ({
            ...cur,
            origin: 'manual',
            points: cur.points.map((p) => (p.id === pointId ? { ...p, ...patch } : p)),
          })),
        ),

      removePoint: (paperId, qIdx, pointId) =>
        set((s) =>
          upsertTrace(s, paperId, qIdx, (cur) => ({
            ...cur,
            origin: 'manual',
            points: cur.points.filter((p) => p.id !== pointId),
          })),
        ),

      removeMark: (paperId, qIdx, markId) =>
        set((s) => {
          const key = traceKey(paperId, qIdx)
          const cur = s.marks[key]
          if (!cur) return s
          return {
            marks: {
              ...s.marks,
              [key]: { ...cur, origin: 'manual', marks: cur.marks.filter((m) => m.id !== markId), updatedAt: new Date().toISOString() },
            },
          }
        }),

      setMarks: (paperId, qIdx, marks, origin) =>
        set((s) => {
          const key = traceKey(paperId, qIdx)
          const cur = s.marks[key]
          return {
            marks: {
              ...s.marks,
              [key]: { ...(cur ?? { paperId, qIdx }), marks, origin, updatedAt: new Date().toISOString() } as QuestionMarks,
            },
          }
        }),

      updateMark: (paperId, qIdx, markId, patch) =>
        set((s) => {
          const key = traceKey(paperId, qIdx)
          const cur = s.marks[key]
          if (!cur) return s
          return {
            marks: {
              ...s.marks,
              [key]: {
                ...cur,
                origin: 'manual',
                marks: cur.marks.map((m) => (m.id === markId ? { ...m, ...patch } : m)),
                updatedAt: new Date().toISOString(),
              },
            },
          }
        }),

      removeMaterialMarks: (paperId, matIdx) =>
        set((s) => {
          const nextMarks: Record<string, QuestionMarks> = {}
          for (const [k, rec] of Object.entries(s.marks)) {
            if (rec.paperId !== paperId) {
              nextMarks[k] = rec
              continue
            }
            const kept = rec.marks.filter((m) => m.matIdx !== matIdx)
            if (kept.length) nextMarks[k] = { ...rec, marks: kept, origin: 'manual', updatedAt: new Date().toISOString() }
          }
          return { marks: nextMarks }
        }),

      removeForPaper: (paperId) =>
        set((s) => {
          const next: Record<string, QuestionTrace> = {}
          for (const [k, v] of Object.entries(s.traces)) if (v.paperId !== paperId) next[k] = v
          const nextMarks: Record<string, QuestionMarks> = {}
          for (const [k, v] of Object.entries(s.marks)) if (v.paperId !== paperId) nextMarks[k] = v
          return { traces: next, marks: nextMarks }
        }),

      importTraces: (list) =>
        set((s) => {
          const next = { ...s.traces }
          for (const t of list) {
            if (t && typeof t.paperId === 'string' && typeof t.qIdx === 'number') next[traceKey(t.paperId, t.qIdx)] = t
          }
          return { traces: next }
        }),

      clearAll: () => set({ traces: {}, marks: {} }),
    }),
    {
      name: 'readbook:exam-study',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ traces: s.traces, marks: s.marks }),
      onRehydrateStorage: () => () => {
        useExamStudyStore.setState({ _hasHydrated: true })
      },
    },
  ),
)
