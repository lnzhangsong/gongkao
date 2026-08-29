import { joinParagraphs } from '../../lib/examText'
import type { ExamQuestion } from '../../lib/api'

/** 阅读态的单道题：题干 + 关联材料跳转 + 要求 + 折叠参考答案 */
export function ExamQuestionView({
  q,
  materialAnchors,
  anchorByNum,
  onJump,
  indent,
}: {
  q: ExamQuestion
  /** 题目 idx → 材料编号数组（渲染前按 draft 统一算好，避免每题每次渲染重复正则扫描） */
  materialAnchors: Map<number, number[]>
  /** 材料编号 → 锚点 id（页面按当前 draft 解析） */
  anchorByNum: Map<number, string>
  onJump: (id: string) => void
  indent: boolean
}) {
  const mats = materialAnchors.get(q.idx) ?? []
  return (
    <>
      <p className="exam-q-stem">{q.stem.replace(/\n/g, '')}</p>
      {mats.length > 0 && (
        <div className="exam-q-mats">
          {mats.map((n) => {
            const anchor = anchorByNum.get(n)
            return anchor ? (
              <button key={n} className="exam-jump-chip" onClick={() => onJump(anchor)}>
                材料{n} ↖
              </button>
            ) : null
          })}
        </div>
      )}
      {q.requirement ? (
        <p className="exam-q-req">
          <span className="exam-q-req-label">要求</span>
          {q.requirement.replace(/^要求[（(:：]?\s*/, '').replace(/\n+/g, ' ')}
        </p>
      ) : null}
      {q.answer ? (
        <details className="exam-answer">
          <summary>
            参考答案
            {q.answerMatched ? '' : <span className="exam-ans-warn">　未按题对齐</span>}
          </summary>
          <div className={`exam-answer-sheet${indent ? '' : ' no-indent'}`}>
            {joinParagraphs(q.answer).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </details>
      ) : null}
    </>
  )
}
