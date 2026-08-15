import type { Annotation } from '../types'

/**
 * 标注系统基于“扁平化文本偏移量”：
 * 正文段落以 '\n' 连接成一段连续文本，start/end 为其中的字符偏移。
 * 重新打开文章时，按偏移把段落切分成片段并包上标记即可恢复标注。
 */

/** 每段的全局起始偏移 */
export function paragraphStarts(content: string[]): number[] {
  const starts: number[] = []
  let acc = 0
  for (let i = 0; i < content.length; i++) {
    starts.push(acc)
    acc += content[i].length + 1 // +1 为段间 '\n'
  }
  return starts
}

export function flatText(content: string[]): string {
  return content.join('\n')
}

/** 段落元素内、某个节点偏移之前的字符数 */
function offsetInPara(paraEl: HTMLElement, node: Node, nodeOffset: number): number {
  if (node.nodeType === Node.ELEMENT_NODE) {
    // 元素边界：offset 0 视为段首，否则视为段末
    return nodeOffset === 0 ? 0 : paraEl.textContent?.length ?? 0
  }
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT)
  let acc = 0
  let current = walker.nextNode()
  while (current) {
    if (current === node) {
      return acc + Math.max(0, nodeOffset)
    }
    acc += (current as Text).data.length
    current = walker.nextNode()
  }
  return acc
}

export interface SelectionRange {
  start: number
  end: number
  text: string
}

/**
 * 从当前 window selection 计算偏移区间。
 * 仅支持单段内选择（跨段返回 null）。
 * root 为 article-body 容器；starts 由 paragraphStarts 得到。
 */
export function computeSelectionRange(
  root: HTMLElement,
  starts: number[],
): SelectionRange | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const text = sel.toString().trim()
  if (!text) return null

  const anchorNode = sel.anchorNode
  const focusNode = sel.focusNode
  if (!anchorNode || !focusNode) return null

  const anchorEl =
    anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : (anchorNode as HTMLElement)
  const focusEl =
    focusNode.nodeType === Node.TEXT_NODE ? focusNode.parentElement : (focusNode as HTMLElement)
  const anchorPara = anchorEl?.closest<HTMLElement>('[data-para]')
  const focusPara = focusEl?.closest<HTMLElement>('[data-para]')
  if (!anchorPara || !focusPara || anchorPara !== focusPara) return null
  if (!root.contains(anchorPara)) return null

  const paraIndex = Number(anchorPara.dataset.para)
  if (Number.isNaN(paraIndex)) return null

  const startLocal = offsetInPara(anchorPara, anchorNode, sel.anchorOffset)
  const endLocal = offsetInPara(anchorPara, focusNode, sel.focusOffset)
  const start = starts[paraIndex] + Math.min(startLocal, endLocal)
  const end = starts[paraIndex] + Math.max(startLocal, endLocal)
  if (end - start < 1) return null
  return { start, end, text }
}

export interface TextSegment {
  text: string
  /** 完全覆盖该段的标注 */
  annotations: Annotation[]
}

/**
 * 把单个段落按标注边界切成片段，供渲染时包 <mark>/<u>/<span>。
 */
export function splitParagraph(
  text: string,
  paraStart: number,
  annotations: Annotation[],
): TextSegment[] {
  const paraEnd = paraStart + text.length
  const hits = annotations
    .filter((a) => a.start < paraEnd && a.end > paraStart)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  if (hits.length === 0) return [{ text, annotations: [] }]

  const cuts = new Set<number>([0, text.length])
  for (const a of hits) {
    const s = a.start - paraStart
    const e = a.end - paraStart
    if (s > 0 && s < text.length) cuts.add(s)
    if (e > 0 && e < text.length) cuts.add(e)
  }
  const sorted = [...cuts].sort((x, y) => x - y)
  const segments: TextSegment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]
    const e = sorted[i + 1]
    if (e <= s) continue
    const segText = text.slice(s, e)
    const covering = hits.filter((a) => a.start <= paraStart + s && a.end >= paraStart + e)
    segments.push({ text: segText, annotations: covering })
  }
  return segments
}
