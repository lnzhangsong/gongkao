import { YearInput } from './YearInput'
import type { ExamDetail } from '../../lib/api'

interface ExamEditBarProps {
  draft: ExamDetail
  dirty: boolean
  saving: boolean
  savedAt: string | null
  patchDraft: (fn: (d: ExamDetail) => void) => void
  onReflowAll: () => void
  onSave: () => void
  onExit: () => void
  onDelete: () => void
}

/** 编辑态工具条：年份/级别、一键重排、保存、退出编辑、删除试卷 */
export function ExamEditBar({
  draft,
  dirty,
  saving,
  savedAt,
  patchDraft,
  onReflowAll,
  onSave,
  onExit,
  onDelete,
}: ExamEditBarProps) {
  return (
    <div className="exam-edit-bar">
      <span className="exam-edit-field">
        <label htmlFor="exam-edit-year">年份</label>
        <YearInput id="exam-edit-year" value={draft.year} onCommit={(n) => patchDraft((d) => void (d.year = n))} />
      </span>
      <span className="exam-edit-field">
        <label htmlFor="exam-edit-level">级别</label>
        <select
          id="exam-edit-level"
          className="exam-select"
          value={draft.level}
          onChange={(e) => patchDraft((d) => void (d.level = e.target.value))}
        >
          {[...new Set([draft.level, '副省级', '地市级', '行政执法'])].map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
      </span>
      {savedAt ? <span className="exam-saved">已保存 {savedAt}</span> : null}
      {dirty ? <span className="exam-warn">未保存</span> : null}
      <span className="exam-edit-actions">
        <button className="ghost" onClick={onReflowAll}>
          一键重排换行
        </button>
        <button className="ghost exam-btn-primary" onClick={onSave} disabled={saving || !dirty}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="ghost" onClick={onExit}>
          退出编辑
        </button>
        <button className="text-btn exam-del-btn" onClick={onDelete}>
          删除试卷
        </button>
      </span>
    </div>
  )
}
