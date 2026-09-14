import { describe, expect, it } from 'vite-plus/test'
import { collectDistractions } from './examDistractions'
import type { MaterialMark, QuestionMarks } from '../stores/examStudyStore'

/** 本卷干扰项汇总（C5）：两种标注来源都收、按材料分组、同句去重、别卷不混入 */
describe('collectDistractions', () => {
  const materials = [
    { idx: 1, label: '材料一' },
    { idx: 2, label: '材料二' },
    { idx: 3, label: '' },
  ]
  const mark = (id: string, matIdx: number, quote: string, level?: MaterialMark['level']): MaterialMark => ({
    id,
    matIdx,
    quote,
    role: '背景铺垫',
    level,
  })
  const rec = (qIdx: number, marks: MaterialMark[], paperId = 'p1'): QuestionMarks => ({
    paperId,
    qIdx,
    origin: 'ai',
    marks,
    updatedAt: '2026-09-15T00:00:00.000Z',
  })

  it('材料级（qIdx = -matIdx）与题目级（qIdx = 题号）两种来源都收', () => {
    const groups = collectDistractions('p1', materials, {
      'p1#-1': rec(-1, [mark('a', 1, '背景铺陈的一句', 'useless')]),
      'p1#2': rec(2, [mark('b', 2, '跑题的一句', 'useless')]),
    })
    expect(groups.map((g) => g.matIdx)).toEqual([1, 2])
    expect(groups[0].marks[0].id).toBe('a')
    expect(groups[1].marks[0].id).toBe('b')
  })

  it('只收 useless；同句在两个层级各有一份时去重', () => {
    const groups = collectDistractions('p1', materials, {
      'p1#-1': rec(-1, [
        mark('core', 1, '核心句', 'core'),
        mark('u1', 1, '重复的一句', 'useless'),
        mark('noLevel', 1, '没等级的一句'),
      ]),
      'p1#3': rec(3, [mark('u2', 1, '重复的  一句 ', 'useless')]),
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].marks.map((m) => m.id)).toEqual(['u1'])
  })

  it('按 materials 顺序输出；别卷与未知材料编号丢弃；无 label 时补「材料N」', () => {
    const groups = collectDistractions('p1', materials, {
      'p1#1': rec(1, [
        mark('three', 3, '第三则的干扰句', 'useless'),
        mark('one', 1, '第一则的干扰句', 'useless'),
        mark('ghost', 99, '不存在的材料', 'useless'),
      ]),
      'p2#1': rec(1, [mark('other', 2, '别的卷子', 'useless')], 'p2'),
    })
    expect(groups.map((g) => g.matIdx)).toEqual([1, 3])
    expect(groups[1].label).toBe('材料3')
  })

  it('没有干扰句时返回空数组（调用方据此隐藏入口）', () => {
    expect(collectDistractions('p1', materials, {})).toEqual([])
    expect(collectDistractions('p1', materials, { 'p1#1': rec(1, [mark('c', 1, '核心', 'core')]) })).toEqual([])
  })
})
