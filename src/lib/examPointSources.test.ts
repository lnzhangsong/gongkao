import { describe, expect, it } from 'vite-plus/test'
import { linkPointsToMarks, sameSourceSiblings } from './examPointSources'
import type { AnswerPointTrace, MaterialMark, QuestionMarks, QuestionTrace } from '../stores/examStudyStore'

/** 材料 → 要点反向索引（C4）：空白不敏感、只挂最贴合的一条标注、两种标注来源都算 */
describe('linkPointsToMarks', () => {
  const point = (id: string, quote: string, sourceIdx: number | null = 1): AnswerPointTrace => ({
    id,
    text: `${id} 要点`,
    mode: '摘抄',
    sourceIdx,
    quote,
  })
  const trace = (qIdx: number, points: AnswerPointTrace[], paperId = 'p1'): QuestionTrace => ({
    paperId,
    qIdx,
    origin: 'ai',
    points,
    updatedAt: '2026-09-15T00:00:00.000Z',
  })
  const mark = (id: string, quote: string, matIdx = 1): MaterialMark => ({ id, matIdx, quote, role: '案例叙事' })
  const marks = (key: string, list: MaterialMark[], paperId = 'p1'): [string, QuestionMarks] => [
    key,
    { paperId, qIdx: -1, origin: 'ai', marks: list, updatedAt: '2026-09-15T00:00:00.000Z' },
  ]

  it('把要点挂到覆盖它的那条标注上，带上题目序号与要点序号', () => {
    const out = linkPointsToMarks(
      'p1',
      { 'p1#2': trace(2, [point('a', '这句话进了答案')]) },
      Object.fromEntries([marks('p1#-1', [mark('k1', '这句话进了答案')])]),
    )
    expect(out.get('k1')).toEqual([{ questionIdx: 2, pointNo: 1, pointId: 'a', text: 'a 要点' }])
  })

  it('空白不敏感 + 片段包含：标注是整句、要点只截一段也算命中', () => {
    const out = linkPointsToMarks(
      'p1',
      { 'p1#1': trace(1, [point('a', '楼道堆物无人管')]) },
      Object.fromEntries([marks('p1#-1', [mark('k1', '据反映，楼道堆物   无人管，居民意见很大。')])]),
    )
    expect(out.get('k1')?.[0]?.pointId).toBe('a')
  })

  it('一条要点只挂最贴合的一条标注（引句跨两句时不会在正文里出现两个相同编号）', () => {
    const out = linkPointsToMarks(
      'p1',
      { 'p1#1': trace(1, [point('a', '前半句后半句')]) },
      Object.fromEntries([marks('p1#-1', [mark('k1', '前半句'), mark('k2', '前半句后半句')])]),
    )
    expect(out.has('k1')).toBe(false)
    expect(out.get('k2')).toHaveLength(1)
  })

  it('多题命中同一句时都记下来，按题目序号排；没有 quote / 材料外的要点跳过', () => {
    const out = linkPointsToMarks(
      'p1',
      {
        'p1#3': trace(3, [point('c', '同一句话')]),
        'p1#1': trace(1, [point('a', '同一句话'), point('noQuote', '', 1), point('outside', '别处的句子', null)]),
      },
      Object.fromEntries([marks('p1#-1', [mark('k1', '同一句话')])]),
    )
    expect(out.get('k1')?.map((s) => s.questionIdx)).toEqual([1, 3])
  })

  it('认不出处（标注里没有这句）就不挂；别卷的标注与要点忽略', () => {
    const out = linkPointsToMarks(
      'p1',
      { 'p1#1': trace(1, [point('a', '没被标注过的句子')]), 'p2#1': trace(1, [point('x', '别的卷')], 'p2') },
      Object.fromEntries([marks('p1#-1', [mark('k1', '另一句话')]), marks('p2#-1', [mark('kx', '别的卷')], 'p2')]),
    )
    expect(out.size).toBe(0)
  })
})

/** 同源要点（C3 小改）：同一句原文加工出的多条要点互相可见 */
describe('sameSourceSiblings', () => {
  it('同一材料同一句（空白不敏感）算同源，列出彼此的序号', () => {
    const map = sameSourceSiblings([
      { id: 'a', sourceIdx: 1, quote: '同一句' },
      { id: 'b', sourceIdx: 1, quote: '别的句子' },
      { id: 'c', sourceIdx: 1, quote: ' 同一 句 ' },
      { id: 'd', sourceIdx: 2, quote: '同一句' },
    ])
    expect(map.get('a')).toEqual([3])
    expect(map.get('c')).toEqual([1])
    expect(map.has('b')).toBe(false)
    /* 换了材料不算同源 */
    expect(map.has('d')).toBe(false)
  })

  it('没有 quote / 材料外的要点不参与；独苗不进结果', () => {
    const map = sameSourceSiblings([
      { id: 'a', sourceIdx: null, quote: '同一句' },
      { id: 'b', sourceIdx: 1 },
      { id: 'c', sourceIdx: 1, quote: '只有一条' },
    ])
    expect(map.size).toBe(0)
  })
})
