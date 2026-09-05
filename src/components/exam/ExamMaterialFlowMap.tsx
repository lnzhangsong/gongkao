import { useEffect, Fragment } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialMark } from '../../stores/examStudyStore'

/** 弹窗里展示完整引句与用法，不再截短 */
const tidy = (q: string) => q.replace(/\s+/g, ' ').trim()

/**
 * 材料行文思路导图（弹窗）：把该材料的标注按原文出现顺序串成节点链——
 * 每个节点 = 行文作用 + 关键句 + 答题用法，箭头表达材料推进方向；
 * 核心句（level=core）用强调色加重。完整原句仍在正文高亮中。
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
            <Fragment key={mk.id}>
              {i > 0 && <span className="mat-flow-link" aria-hidden="true" />}
              <div className={`mat-flow-node${mk.level === 'core' ? ' core' : ''}`}>
                <span className="mat-flow-role">{mk.role}</span>
                <p className="mat-flow-quote">「{tidy(mk.quote)}」</p>
                {mk.use && <p className="mat-flow-use">{mk.use}</p>}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
