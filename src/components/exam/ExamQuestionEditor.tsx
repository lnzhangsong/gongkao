import { extractPoints, extractWordLimit } from '../../lib/examText'
import type { ExamQuestion } from '../../lib/api'

/**
 * 编辑态的单道题：分类/排序/删除 + 题干、要求、参考答案三个 textarea。
 * patchDraft 由页面提供（浅层不可变更新，键入时不再整卷深拷贝）。
 */
export function ExamQuestionEditor({
  q,
  total,
  patch,
  move,
  onDelete,
}: {
  q: ExamQuestion
  total: number
  patch: (fn: (t: ExamQuestion) => void, idx: number) => void
  move: (key: number, delta: -1 | 1) => void
  onDelete: () => void
}) {
  return (
    <>
      <div className="exam-q-edit-bar">
        <span className="exam-q-edit-left">
          第 {q.idx} 题
          <select
            className="exam-select"
            value={q.type ?? ''}
            onChange={(e) => patch((t) => void (t.type = e.target.value || null), q.idx)}
          >
            <option value="">未分类</option>
            {['概括', '分析', '对策', '应用文', '大作文'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </span>
        <span className="exam-move-group">
          <button className="exam-move-btn" title="上移" disabled={q.idx === 1} onClick={() => move(q.idx, -1)}>↑</button>
          <button className="exam-move-btn" title="下移" disabled={q.idx === total} onClick={() => move(q.idx, 1)}>↓</button>
        </span>
        <button className="text-btn exam-del-btn" onClick={onDelete}>
          删除此题
        </button>
      </div>
      <div className="exam-q-fields">
        <span className="exam-edit-field">
          <label>字数</label>
          <input
            type="number"
            className="exam-select exam-num-input"
            min={0}
            value={q.wordLimit ?? ''}
            placeholder="—"
            onChange={(e) => patch((t) => void (t.wordLimit = e.target.value === '' ? null : parseInt(e.target.value, 10)), q.idx)}
          />
        </span>
        <span className="exam-edit-field">
          <label>分值</label>
          <input
            type="number"
            className="exam-select exam-num-input"
            min={0}
            value={q.points ?? ''}
            placeholder="—"
            onChange={(e) => patch((t) => void (t.points = e.target.value === '' ? null : parseInt(e.target.value, 10)), q.idx)}
          />
        </span>
        <span className="exam-q-fields-hint">字数/分值在题干失焦时自动从原文读取，可手动覆盖</span>
      </div>
      <textarea
        className="exam-ta"
        rows={Math.min(8, Math.max(3, Math.ceil(q.stem.length / 40)))}
        value={q.stem}
        onBlur={(e) => {
          const stem = e.target.value
          const wl = extractWordLimit(stem)
          const pts = extractPoints(stem)
          if (wl !== null || pts !== null) {
            patch((t) => {
              if (wl !== null) t.wordLimit = wl
              if (pts !== null) t.points = pts
            }, q.idx)
          }
        }}
        onChange={(e) => patch((t) => void (t.stem = e.target.value), q.idx)}
      />
      <textarea
        className="exam-ta"
        placeholder="要求（可空）"
        rows={Math.max(2, Math.ceil((q.requirement.length || 1) / 40))}
        value={q.requirement}
        onChange={(e) => patch((t) => void (t.requirement = e.target.value), q.idx)}
      />
      <textarea
        className="exam-ta"
        placeholder="参考答案（可空）"
        rows={Math.min(16, Math.max(3, Math.ceil((q.answer?.length || 1) / 40)))}
        value={q.answer ?? ''}
        onChange={(e) => patch((t) => void (t.answer = e.target.value || null), q.idx)}
      />
    </>
  )
}
