import { Fragment } from 'react'
import type { ExamDetail } from '../../lib/api'

interface ExamMaterialEditorProps {
  materials: ExamDetail['materials']
  /** 单题/单材料的浅层不可变补丁（编辑长卷时不深拷贝整卷） */
  patchDraft: (fn: (d: ExamDetail) => void) => void
  moveItem: (list: 'materials' | 'questions', key: number, delta: -1 | 1) => void
}

/** 编辑态：材料列表（标题/上移下移/删除/正文 textarea） */
export function ExamMaterialEditor({ materials, patchDraft, moveItem }: ExamMaterialEditorProps) {
  return (
    <>
      {materials.map((m) => (
        <Fragment key={m.idx}>
          <h3 className="exam-mat-label">
            <input
              className="exam-mat-label-input"
              value={m.label}
              onChange={(e) =>
                patchDraft((d) => void (d.materials.find((x) => x.idx === m.idx)!.label = e.target.value))
              }
              aria-label="材料标题"
            />
            <span className="exam-move-group">
              <button
                className="exam-move-btn"
                title="上移"
                disabled={m.idx === 1}
                onClick={() => moveItem('materials', m.idx, -1)}
              >
                ↑
              </button>
              <button
                className="exam-move-btn"
                title="下移"
                disabled={m.idx === materials.length}
                onClick={() => moveItem('materials', m.idx, 1)}
              >
                ↓
              </button>
            </span>
            <button
              className="text-btn exam-del-btn"
              onClick={() => patchDraft((d) => void (d.materials = d.materials.filter((x) => x.idx !== m.idx)))}
            >
              删除此段
            </button>
          </h3>
          <textarea
            className="exam-ta"
            rows={Math.min(20, Math.max(4, Math.ceil(m.content.length / 40)))}
            value={m.content}
            onChange={(e) =>
              patchDraft((d) => void (d.materials.find((x) => x.idx === m.idx)!.content = e.target.value))
            }
          />
        </Fragment>
      ))}
    </>
  )
}
