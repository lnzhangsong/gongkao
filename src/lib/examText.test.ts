import { describe, expect, it } from 'vitest'
import { extractPoints, extractWordLimit, joinParagraphs, questionMaterials } from './examText'

describe('joinParagraphs', () => {
  it('普通续行拼回一段，空行分段', () => {
    expect(joinParagraphs('第一行\n接第二行\n\n新的一段')).toEqual([
      '第一行接第二行',
      '新的一段',
    ])
  })

  it('段首命中标题模式时强制分段（全角空格归一为半角）', () => {
    expect(joinParagraphs('前一句没有句号\n材料二　开始新段')).toEqual([
      '前一句没有句号',
      '材料二 开始新段',
    ])
  })

  it('前句以句末标点收尾时，下一行另起一段（行内句号不切分）', () => {
    expect(joinParagraphs('完整的一句。\n下一句另起')).toEqual([
      '完整的一句。',
      '下一句另起',
    ])
    expect(joinParagraphs('行内的句号。不切分')).toEqual(['行内的句号。不切分'])
  })
})

describe('extractWordLimit', () => {
  it('识别「不超过 N 字」', () => {
    expect(extractWordLimit('概括要点。（不超过300字）')).toBe(300)
  })

  it('识别区间取上限', () => {
    expect(extractWordLimit('字数250-300字')).toBe(300)
  })

  it('全角数字', () => {
    expect(extractWordLimit('不超过３００字')).toBe(300)
  })

  it('排除过小/过大的可疑数字', () => {
    expect(extractWordLimit('共 10 字')).toBeNull()
  })

  it('无字数信息返回 null', () => {
    expect(extractWordLimit('写一篇文章。')).toBeNull()
  })
})

describe('extractPoints', () => {
  it('识别分值', () => {
    expect(extractPoints('（20分）')).toBe(20)
    expect(extractPoints('２０分')).toBe(20)
  })

  it('忽略越界数字', () => {
    expect(extractPoints('第1000分部')).toBeNull()
  })
})

describe('questionMaterials', () => {
  it('提取「给定资料N」', () => {
    expect(questionMaterials({ stem: '根据“给定资料1”谈谈看法', requirement: '' })).toEqual([1])
  })

  it('区间端点各自命中（「至材料N」不展开中段，两端独立提取）', () => {
    expect(
      questionMaterials({ stem: '材料一至材料三都提到', requirement: '' }),
    ).toEqual([1, 3])
    expect(questionMaterials({ stem: '材料1-3都提到', requirement: '' })).toEqual([1, 2, 3])
  })

  it('题干与要求合并去重', () => {
    expect(
      questionMaterials({ stem: '给定资料2', requirement: '结合资料3' }),
    ).toEqual([2, 3])
  })

  it('无引用返回空数组', () => {
    expect(questionMaterials({ stem: '自选角度写文章', requirement: '' })).toEqual([])
  })
})
