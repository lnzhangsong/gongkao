import { describe, expect, it } from 'vitest'
import { findQuoteInMaterial, splitParagraphByMarks } from './examMarks'
import type { MaterialMark } from '../stores/examStudyStore'

/** 原文标注定位：空白不敏感匹配 + 段落切分 */
describe('findQuoteInMaterial', () => {
  const paras = [
    '黄河奔腾生生不息，科技活水澎湃成潮。',
    '“智慧石头”只是数字孪生黄河建设的一个基础应用。近年来，黄河水利委员会初步形成了智能业务应用体系。',
  ]

  it('精确匹配返回段落与偏移区间', () => {
    const hit = findQuoteInMaterial(paras, '数字孪生黄河建设的一个基础应用')
    expect(hit).toEqual({ paraIndex: 1, start: 8, end: 23 })
  })

  it('引句含换行/多余空白时仍可匹配（空白不敏感）', () => {
    const hit = findQuoteInMaterial(paras, '数字孪生黄河 建设的\n一个基础应用')
    expect(hit?.paraIndex).toBe(1)
    expect(hit?.end).toBeGreaterThan(hit!.start)
  })

  it('找不到返回 null', () => {
    expect(findQuoteInMaterial(paras, '材料里不存在的话')).toBeNull()
    expect(findQuoteInMaterial(paras, '')).toBeNull()
  })
})

describe('splitParagraphByMarks', () => {
  const mark = (id: string): MaterialMark => ({ id, matIdx: 1, quote: '', role: '案例' })
  const para = ' Alpha Beta Gamma '

  it('按区间切段，区间外为普通片段', () => {
    const segs = splitParagraphByMarks(para, [{ mark: mark('a'), paraIndex: 0, start: 1, end: 6 }])
    expect(segs).toEqual([
      { text: ' ' },
      { text: 'Alpha', mark: segs[1].mark },
      { text: ' Beta Gamma ' },
    ])
  })

  it('无区间时原样返回', () => {
    expect(splitParagraphByMarks(para, [])).toEqual([{ text: para }])
  })

  it('重叠区间跳过后者，避免崩溃', () => {
    const segs = splitParagraphByMarks(para, [
      { mark: mark('a'), paraIndex: 0, start: 1, end: 11 },
      { mark: mark('b'), paraIndex: 0, start: 6, end: 17 },
    ])
    expect(segs.filter((s) => s.mark)).toHaveLength(1)
    expect(segs[segs.length - 1].text).toBe(' Gamma ')
  })
})
