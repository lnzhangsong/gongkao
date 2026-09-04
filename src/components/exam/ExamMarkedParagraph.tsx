import { useMemo, type ReactNode } from 'react'
import { splitParagraphByMarks, type MarkRange } from '../../lib/examMarks'
import type { MaterialMark } from '../../stores/examStudyStore'

/** 材料段落渲染：有标注时把命中片段包上 <mark>（句后内联「」解析，从抽屉可跳转定位） */
export function MarkedParagraph({ text, ranges }: { text: string; ranges: MarkRange[] }) {
  const segs = useMemo(() => splitParagraphByMarks(text, ranges), [text, ranges])
  if (!ranges.length) return <p>{text}</p>
  /* 解释紧跟每句原文：句号后挂解析块（等级·行文作用·答题解释） */
  const nodes: ReactNode[] = []
  let key = 0
  let pending: MaterialMark | null = null
  const flushNote = () => {
    if (pending) {
      nodes.push(<SentenceNote key={key++} mark={pending} />)
      pending = null
    }
  }
  for (const seg of segs) {
    if (seg.mark) {
      flushNote()
      nodes.push(
        <mark
          key={key++}
          id={`exam-mk-${seg.mark.id}`}
          className={`exam-mark lv-${seg.mark.level ?? 'normal'}`}
        >
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
function SentenceNote({ mark }: { mark: MaterialMark }) {
  const level = mark.level === 'core' ? '核心' : mark.level === 'useless' ? '无用' : '辅助'
  return (
    <span className={`exam-inline-note lv-${mark.level ?? 'normal'}`}>
      {'「'}
      <b>{level}</b>
      <i>{mark.role}</i>
      {mark.use ? `：${mark.use}` : ''}」
    </span>
  )
}
