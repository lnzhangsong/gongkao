import { useMemo, type ReactNode } from 'react'
import { splitParagraphByMarks, type MarkRange } from '../../lib/examMarks'
import type { PointSource } from '../../lib/examPointSources'
import type { MaterialMark } from '../../stores/examStudyStore'

const CN_NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫']
const numOf = (i: number) => (i < CN_NUM.length ? CN_NUM[i] : `${i + 1}`)

/**
 * 材料段落渲染：有标注时把命中片段包上 <mark>（句后内联「」解析，从抽屉可跳转定位）。
 * 句后另挂「答案②」小标（C4 反向索引）：这句话进了答案第几条——点一下直接打开那道题的解析。
 */
export function MarkedParagraph({
  text,
  ranges,
  sourceByMarkId,
  onOpenPoint,
}: {
  text: string
  ranges: MarkRange[]
  /** 标注 id → 覆盖这句话的答案要点（C4；无则不显示反向索引） */
  sourceByMarkId?: Map<string, PointSource[]>
  onOpenPoint?: (questionIdx: number, pointId: string) => void
}) {
  const segs = useMemo(() => splitParagraphByMarks(text, ranges), [text, ranges])
  if (!ranges.length) return <p>{text}</p>
  /* 解释紧跟每句原文：句号后挂解析块（等级·行文作用·答题解释）+ 答案要点反向索引 */
  const nodes: ReactNode[] = []
  let key = 0
  let pending: MaterialMark | null = null
  const flushNote = () => {
    if (pending) {
      const sources = sourceByMarkId?.get(pending.id)
      nodes.push(<SentenceNote key={key++} mark={pending} sources={sources} onOpenPoint={onOpenPoint} />)
      pending = null
    }
  }
  for (const seg of segs) {
    if (seg.mark) {
      flushNote()
      nodes.push(
        <mark key={key++} id={`exam-mk-${seg.mark.id}`} className={`exam-mark lv-${seg.mark.level ?? 'normal'}`}>
          {seg.text}
        </mark>,
      )
      pending = seg.mark
    } else if (pending) {
      let rest: string = seg.text
      while (pending && rest) {
        const m = rest.match(/[。；！？!?]/)
        if (!m || m.index === undefined) break
        const cut = m.index + 1
        nodes.push(<span key={key++}>{rest.slice(0, cut)}</span>)
        flushNote()
        rest = rest.slice(cut)
      }
      if (rest) nodes.push(<span key={key++}>{rest}</span>)
    } else {
      nodes.push(<span key={key++}>{seg.text}</span>)
    }
  }
  flushNote()
  return <p>{nodes}</p>
}

/** 句内解析：紧跟句子原样插在正文里，不换行，「」括起来，等级与行文作用均为药丸样式 */
function SentenceNote({
  mark,
  sources,
  onOpenPoint,
}: {
  mark: MaterialMark
  sources?: PointSource[]
  onOpenPoint?: (questionIdx: number, pointId: string) => void
}) {
  const level = mark.level === 'core' ? '核心' : mark.level === 'useless' ? '无用' : '辅助'
  return (
    <>
      <span className={`exam-inline-note lv-${mark.level ?? 'normal'}`}>
        {'「'}
        <b>{level}</b>
        <i>{mark.role}</i>
        {mark.use ? `：${mark.use}` : ''}」
      </span>
      {sources?.length
        ? sources.map((s) => (
            <button
              key={s.pointId}
              type="button"
              className="exam-src-chip"
              title={`第${s.questionIdx}题要点${numOf(s.pointNo - 1)}：${s.text}`}
              onClick={() => onOpenPoint?.(s.questionIdx, s.pointId)}
            >
              答案{numOf(s.pointNo - 1)}
            </button>
          ))
        : null}
    </>
  )
}
