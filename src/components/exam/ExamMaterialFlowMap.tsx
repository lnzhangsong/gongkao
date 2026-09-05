import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialMark } from '../../stores/examStudyStore'

const short = (q: string, max: number) => {
  const t = q.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

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
 * 材料行文思路导图（弹窗·树状）：左根（材料）→ 中分支（行文阶段：连续同作用的句归组，
 * 阶段自上而下即材料推进顺序）→ 右叶子（每句：序号 + 引句轮廓 + 答题用法）。
 * 连线表达从属关系；核心句（level=core）强调色加重。
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
        aria-label={`${label}行文思路导图`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="exam-flow-head">
          <h3>
            {label} · 行文思路导图 <small>{marks.length} 句 · 归为 {groups.length} 个行文阶段 · 自上而下顺原文推进</small>
          </h3>
          <button type="button" className="exam-flow-close" aria-label="关闭导图" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="flow-tree">
          <div className="flow-root">
            <span className="flow-root-label">{label}</span>
            <span className="flow-root-sub">行文思路</span>
          </div>
          <div className="flow-branches">
            {groups.map((g, gi) => (
              <div key={gi} className="flow-branch">
                <div className={`flow-stage${g.marks.some((m) => m.level === 'core') ? ' core' : ''}`}>
                  <span className="flow-stage-role">{g.role}</span>
                  <small>
                    {numOf(g.from)}–{numOf(g.from + g.marks.length - 1)} · {g.marks.length} 句
                  </small>
                </div>
                <div className="flow-leaves">
                  {g.marks.map((m, i) => (
                    <div key={m.id} className={`flow-leaf${m.level === 'core' ? ' core' : ''}`} title={m.use}>
                      <span className="flow-leaf-no">{numOf(g.from + i)}</span>
                      <p className="flow-leaf-quote">「{short(m.quote, 28)}」</p>
                      {m.use && <p className="flow-leaf-use">{short(m.use, 46)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
