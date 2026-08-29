import { describe, expect, it } from 'vitest'
import { flatText, paragraphStarts, splitParagraph } from './offsets'
import type { Annotation } from '../types'

const ann = (p: Partial<Annotation>): Annotation => ({
  id: 'x',
  articleId: 'a',
  kind: 'highlight',
  text: '',
  start: 0,
  end: 0,
  createdAt: '',
  ...p,
})

describe('paragraphStarts / flatText', () => {
  it('按段长+1 累加起始偏移', () => {
    expect(paragraphStarts(['abc', 'de', ''])).toEqual([0, 4, 7])
    expect(flatText(['abc', 'de', ''])).toBe('abc\nde\n')
  })

  it('空正文返回空数组', () => {
    expect(paragraphStarts([])).toEqual([])
  })
})

describe('splitParagraph', () => {
  const content = ['hello world']
  const starts = paragraphStarts(content)

  it('无标注时整段单片段', () => {
    expect(splitParagraph(content[0], starts[0], [])).toEqual([
      { text: 'hello world', annotations: [] },
    ])
  })

  it('按标注边界切段并标注覆盖片段', () => {
    const a = ann({ id: '1', start: starts[0] + 6, end: starts[0] + 11 })
    const segs = splitParagraph(content[0], starts[0], [a])
    expect(segs.map((s) => s.text)).toEqual(['hello ', 'world'])
    expect(segs[0].annotations).toEqual([])
    expect(segs[1].annotations).toEqual([a])
  })

  it('跨段标注只影响相交段（片段覆盖判定用全局偏移）', () => {
    // 标注覆盖整段：唯一片段带标注
    const a = ann({ id: '1', start: starts[0], end: starts[0] + content[0].length })
    const segs = splitParagraph(content[0], starts[0], [a])
    expect(segs).toEqual([{ text: 'hello world', annotations: [a] }])
  })

  it('多条标注形成多段切分', () => {
    const a1 = ann({ id: '1', start: 0, end: 5 })
    const a2 = ann({ id: '2', start: 5, end: 8 })
    const segs = splitParagraph(content[0], 0, [a2, a1])
    expect(segs.map((s) => s.text)).toEqual(['hello', ' wo', 'rld'])
    expect(segs[0].annotations.map((x) => x.id)).toEqual(['1'])
    expect(segs[1].annotations.map((x) => x.id)).toEqual(['2'])
  })

  it('与段落不相交的标注被忽略', () => {
    const a = ann({ id: '1', start: 100, end: 200 })
    expect(splitParagraph(content[0], 0, [a])).toEqual([
      { text: 'hello world', annotations: [] },
    ])
  })
})
