import { Fragment, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialMark } from '../../stores/examStudyStore'

const CN_NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
const numOf = (i: number) => (i < 10 ? CN_NUM[i] : `${i + 1}`)

interface StageGroup {
  role: string
  marks: MaterialMark[]
  from: number
}

/** 连续同「行文作用」的标注归为一个行文阶段，保持原文顺序 */
function groupByStage(marks: MaterialMark[]): StageGroup[] {
  const groups: StageGroup[] = []
  for (let i = 0; i < marks.length; i++) {
    const last = groups[groups.length - 1]
    if (last && last.role === marks[i].role) last.marks.push(marks[i])
    else groups.push({ role: marks[i].role, marks: [marks[i]], from: i })
  }
  return groups
}

/**
 * 材料行文思路（弹窗·提纲式）：连续同作用的句子归为阶段卡，自上而下箭头推进。
 * 每张卡 = 阶段名 + 句号范围 + 收录句子（序号 + 引句 + 答题用法）。
 * 文字为主，读完即懂材料的写作套路；核心阶段（含 core 句）强调色。
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

  const groups = groupByStage(marks)

  return createPortal(
    <div className="exam-modal-mask" onClick={onClose}>
      <div
        className="exam-modal exam-flow-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${label}行文思路`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="exam-flow-head">
          <h3>
            {label} · 行文思路 <small>{marks.length} 句 · 归为 {groups.length} 个阶段 · 自上而下顺原文推进</small>
          </h3>
          <button type="button" className="exam-flow-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="flow-outline">
          {groups.map((g, gi) => (
            <Fragment key={gi}>
              {gi > 0 && (
                <div className="flow-outline-arrow" aria-hidden="true">
                  ↓
                </div>
              )}
              <section className={`flow-outline-stage${g.marks.some((m) => m.level === 'core') ? ' core' : ''}`}>
                <header>
                  <h4>{g.role}</h4>
                  <span>
                    {numOf(g.from)}–{numOf(g.from + g.marks.length - 1)} · {g.marks.length} 句
                  </span>
                </header>
                {g.marks.map((m, i) => (
                  <div key={m.id} className="flow-outline-sent" title={m.use}>
                    <span className="flow-outline-no">{numOf(g.from + i)}</span>
                    <div>
                      <p className="flow-outline-quote">「{m.quote.replace(/\s+/g, ' ').trim()}」</p>
                      {m.use && <p className="flow-outline-use">{m.use}</p>}
                    </div>
                  </div>
                ))}
              </section>
            </Fragment>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
