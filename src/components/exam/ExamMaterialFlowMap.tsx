import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialMark } from '../../stores/examStudyStore'

/** 引句压成一行、截短，节点里留轮廓即可（全文在正文高亮里） */
const shortQuote = (q: string, max = 42) => {
  const t = q.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

const CN_NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
const numOf = (i: number) => (i < 10 ? CN_NUM[i] : `${i + 1}`)

/**
 * 材料行文思路导图（弹窗）：该材料标注按原文顺序排成换行网格，
 * 每格 = 序号 + 行文作用 + 关键句 + 答题用法；核心句（level=core）强调色加重。
 * 长链读不下去，网格 + 序号保持「顺原文推进」的阅读感。
 */
export function ExamMaterialFlowModal({
  label,
  marks,
  onClose,
}: {
  label: string
  marks: MaterialMark[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="exam-modal-mask" onClick={onClose}>
      <div
        className="exam-modal exam-flow-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${label}行文思路导图`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="exam-flow-head">
          <h3>
            {label} · 行文思路导图 <small>{marks.length} 句 · 按原文顺序</small>
          </h3>
          <button type="button" className="exam-flow-close" aria-label="关闭导图" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="mat-flow">
          {marks.map((mk, i) => (
            <div key={mk.id} className={`mat-flow-node${mk.level === 'core' ? ' core' : ''}`}>
              <span className="mat-flow-cap">
                <i className="mat-flow-no">{numOf(i)}</i>
                <span className="mat-flow-role">{mk.role}</span>
              </span>
              <p className="mat-flow-quote">「{shortQuote(mk.quote)}」</p>
              {mk.use && <p className="mat-flow-use">{mk.use}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
