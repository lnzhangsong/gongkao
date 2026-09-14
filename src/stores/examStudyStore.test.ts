import { describe, expect, it, beforeEach } from 'vite-plus/test'
import {
  useExamStudyStore,
  normalizePoint,
  normalizeTrace,
  type AnswerPointTrace,
  type MaterialMark,
} from './examStudyStore'

/** 答案溯源/原文标注 store：删卷清理、行级增删改 */
describe('examStudyStore', () => {
  const point = (id: string): AnswerPointTrace => ({ id, text: '要点', mode: '摘抄', sourceIdx: 1 })
  const mark = (id: string): MaterialMark => ({ id, matIdx: 1, quote: '原句', role: '案例' })

  beforeEach(() => {
    useExamStudyStore.setState({ traces: {}, marks: {} })
  })

  it('setPoints / setMarks 写入并记录来源与更新时间', () => {
    const s = useExamStudyStore.getState()
    s.setPoints('p1', 1, [point('t1')], 'ai')
    s.setMarks('p1', 1, [mark('k1')], 'manual')
    const st = useExamStudyStore.getState()
    expect(st.traces['p1#1'].points).toHaveLength(1)
    expect(st.traces['p1#1'].origin).toBe('ai')
    expect(st.marks['p1#1'].marks[0].role).toBe('案例')
  })

  it('updatePoint / removePoint / updateMark / removeMark 行级修改', () => {
    const s = useExamStudyStore.getState()
    s.setPoints('p1', 2, [point('t1'), point('t2')], 'ai')
    s.updatePoint('p1', 2, 't1', { text: '改过的话', mode: '归纳' })
    s.removePoint('p1', 2, 't2')
    s.setMarks('p1', 2, [mark('k1'), mark('k2')], 'ai')
    s.updateMark('p1', 2, 'k1', { role: '总结句' })
    s.removeMark('p1', 2, 'k2')
    const st = useExamStudyStore.getState()
    expect(st.traces['p1#2'].points).toEqual([expect.objectContaining({ text: '改过的话', mode: '归纳' })])
    expect(st.traces['p1#2'].origin).toBe('manual')
    expect(st.marks['p1#2'].marks).toEqual([expect.objectContaining({ role: '总结句' })])
  })

  it('removeForPaper 清掉整卷的溯源与标注，其他卷不受影响', () => {
    const s = useExamStudyStore.getState()
    s.setPoints('pA', 1, [point('t1')], 'ai')
    s.setMarks('pA', 1, [mark('k1')], 'ai')
    s.setPoints('pB', 1, [point('t9')], 'manual')
    s.removeForPaper('pA')
    const st = useExamStudyStore.getState()
    expect(st.traces['pA#1']).toBeUndefined()
    expect(st.marks['pA#1']).toBeUndefined()
    expect(st.traces['pB#1'].points[0].id).toBe('t9')
  })
})

/** A1 字段合并：think → locate、note → modeWhy；兼容只做在归一函数里（本地水合 / 云端拉取 / 导入 / AI 解析共用） */
describe('要点字段归一（A1）', () => {
  it('normalizePoint 合并旧字段，新字段优先，并丢掉旧键', () => {
    const merged = normalizePoint({ id: 't1', text: 'x', mode: '摘抄', sourceIdx: 2, think: '旧定位', note: '旧加工' })
    expect(merged).toEqual({ id: 't1', text: 'x', mode: '摘抄', sourceIdx: 2, locate: '旧定位', modeWhy: '旧加工' })
    const both = normalizePoint({ text: 'y', mode: '改写', sourceIdx: 1, locate: '新定位', think: '旧定位' })
    expect(both?.locate).toBe('新定位')
  })

  it('normalizePoint 补默认值：无 id / 非法 mode / 非法 sourceIdx / 非对象', () => {
    const p = normalizePoint({ text: 'z', mode: '瞎写的', sourceIdx: '三' })
    expect(p?.id).toBeTruthy()
    expect(p?.mode).toBe('归纳')
    expect(p?.sourceIdx).toBeNull()
    expect(normalizePoint(null)).toBeNull()
    expect(normalizePoint('字符串')).toBeNull()
  })

  it('normalizeTrace 校验形状，坏记录丢弃，缺 paperId/qIdx 时用键补全', () => {
    expect(normalizeTrace({ points: 'not-array' }, 'p1#2')).toBeNull()
    expect(normalizeTrace(null)).toBeNull()
    const ok = normalizeTrace({ points: [{ text: 'x', mode: '摘抄', sourceIdx: 1 }] }, 'p1#2')
    expect(ok?.paperId).toBe('p1')
    expect(ok?.qIdx).toBe(2)
    expect(ok?.origin).toBe('manual')
  })

  it('importTraces 入口即归一（旧字段、坏形状一视同仁）', () => {
    const s = useExamStudyStore.getState()
    s.importTraces([
      {
        paperId: 'p1',
        qIdx: 3,
        origin: 'ai',
        updatedAt: '2026-09-01T00:00:00.000Z',
        // 旧版数据：think / note 尚无 locate / modeWhy
        points: [{ id: 'old', text: '旧要点', mode: '摘抄', sourceIdx: 1, think: '思路', note: '加工' }],
      } as unknown as Parameters<typeof s.importTraces>[0][number],
      { paperId: 'p2', qIdx: 1, points: 'not-array' } as unknown as Parameters<typeof s.importTraces>[0][number],
    ])
    const trace = useExamStudyStore.getState().traces['p1#3']
    expect(trace.points[0].locate).toBe('思路')
    expect(trace.points[0].modeWhy).toBe('加工')
    expect(useExamStudyStore.getState().traces['p2#1']).toBeUndefined()
  })
})
