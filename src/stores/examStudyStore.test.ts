import { describe, expect, it, beforeEach } from 'vite-plus/test'
import { useExamStudyStore, type AnswerPointTrace, type MaterialMark } from './examStudyStore'

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
