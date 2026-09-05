import { Fragment } from 'react'
import type { MaterialMark } from '../../stores/examStudyStore'

/** 引句压成一行、截短，导图节点里只留轮廓（全文在正文高亮里） */
const shortQuote = (q: string, max = 34) => {
  const t = q.replace(/\s+/g, '')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * 材料行文思路导图：把该材料的标注按原文出现顺序串成节点链——
 * 每个节点 = 行文作用 + 关键句轮廓 + 答题用法，箭头表达材料推进方向；
 * 核心句（level=core）用强调色加重。完整原句仍在正文高亮中。
 */
export function ExamMaterialFlowMap({ marks }: { marks: MaterialMark[] }) {
  return (
    <div className="mat-flow">
      {marks.map((mk, i) => (
        <Fragment key={mk.id}>
          {i > 0 && <span className="mat-flow-link" aria-hidden="true" />}
          <div className={`mat-flow-node${mk.level === 'core' ? ' core' : ''}`} title={mk.use}>
            <span className="mat-flow-role">{mk.role}</span>
            <p className="mat-flow-quote">「{shortQuote(mk.quote)}」</p>
            {mk.use && <p className="mat-flow-use">{mk.use}</p>}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
