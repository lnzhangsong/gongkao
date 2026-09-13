import { formatTimeOnly } from '../../lib/export'
import type { Annotation } from '../../types'

interface InlineNoteBlockProps {
  notes: Annotation[]
  openNoteIds: Set<string>
  editingNoteId: string | null
  setEditingNoteId: (id: string | null) => void
  noteDraft: string
  setNoteDraft: (v: string) => void
  startEditNote: (id: string, text: string) => void
  saveEditNote: (id: string) => void
  removeAnnotation: (id: string) => void
}

/** 段落下方展开的行内笔记（展开/编辑/删除） */
export function InlineNoteBlock({
  notes,
  openNoteIds,
  editingNoteId,
  setEditingNoteId,
  noteDraft,
  setNoteDraft,
  startEditNote,
  saveEditNote,
  removeAnnotation,
}: InlineNoteBlockProps) {
  return (
    <>
      {notes.map((n) => (
        <div className={`inline-note${openNoteIds.has(n.id) ? ' show' : ''}`} key={n.id}>
          <div className="note-head">
            <span>NOTE　/　{formatTimeOnly(n.createdAt)}</span>
            <span>
              {editingNoteId === n.id ? (
                <>
                  <button onClick={() => saveEditNote(n.id)}>保存</button>
                  <button onClick={() => setEditingNoteId(null)}>取消</button>
                </>
              ) : (
                <>
                  <button onClick={() => startEditNote(n.id, n.noteText ?? '')}>编辑</button>
                  <button onClick={() => removeAnnotation(n.id)}>删除</button>
                </>
              )}
            </span>
          </div>
          {editingNoteId === n.id ? (
            <textarea
              className="note-edit"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditingNoteId(null)}
              autoFocus
            />
          ) : (
            <div className="note-body">{n.noteText || '（未填写笔记内容）'}</div>
          )}
        </div>
      ))}
    </>
  )
}
