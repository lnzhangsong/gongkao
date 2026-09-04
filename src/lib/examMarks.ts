/**
 * 原文标注定位（申论思路推导方案 §原文标注）：
 * AI 返回的 quote 是材料原文的连续片段，但可能有空白差异；
 * 这里做「空白不敏感」匹配——把段落与引句都去掉空白后找子串，
 * 再通过字符映射表映射回原段落的偏移区间。
 */
import type { MaterialMark } from '../stores/examStudyStore'

export interface QuoteHit {
  paraIndex: number
  start: number
  end: number
}

const collapse = (s: string) => s.replace(/\s+/g, '')

/** 在材料的段落数组里定位引句；找不到返回 null（渲染时跳过该标注） */
export function findQuoteInMaterial(paras: string[], quote: string): QuoteHit | null {
  const q = collapse(quote)
  if (!q) return null
  for (let pi = 0; pi < paras.length; pi++) {
    const para = paras[pi]
    // map：压缩后字符串的每个字符 → 原字符串下标
    const map: number[] = []
    let buf = ''
    for (let i = 0; i < para.length; i++) {
      if (!/\s/.test(para[i])) {
        map.push(i)
        buf += para[i]
      }
    }
    const hit = buf.indexOf(q)
    if (hit >= 0) {
      const start = map[hit]
      const end = map[Math.min(hit + q.length - 1, map.length - 1)] + 1
      return { paraIndex: pi, start, end }
    }
  }
  return null
}

export interface MarkedSegment {
  text: string
  mark?: MaterialMark
}

export interface MarkRange {
  mark: MaterialMark
  paraIndex: number
  start: number
  end: number
}

/** 把段落按命中区间切成片段（区间互不重叠时结果确定；重叠取先出现者） */
export function splitParagraphByMarks(para: string, ranges: MarkRange[]): MarkedSegment[] {
  if (!ranges.length) return [{ text: para }]
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const segs: MarkedSegment[] = []
  let pos = 0
  for (const r of sorted) {
    if (r.start < pos) continue // 跳过与前一个重叠的
    if (r.start > pos) segs.push({ text: para.slice(pos, r.start) })
    segs.push({ text: para.slice(r.start, r.end), mark: r.mark })
    pos = r.end
  }
  if (pos < para.length) segs.push({ text: para.slice(pos) })
  return segs
}
