import { useEffect, useState } from 'react'
import type { ParagraphSummary } from '../../types'

/** 句式模板编辑（标注管理弹层内）：原句已存为摘录，这里填抽象化后的可迁移模板 */
export function PatternInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <div className="pattern-input">
      <input
        placeholder="填可迁移模板，如：以……之笔，绘就……画卷"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(draft.trim())
          e.stopPropagation()
        }}
      />
      <button onClick={() => onSave(draft.trim())}>存模板</button>
    </div>
  )
}

/** 段落大意：栏外序号入口点开后就地编辑/展示，AI 产出直接转正 */
export function ParaGist({
  paraIndex,
  entry,
  editing,
  onToggle,
  onSave,
  onAiDraft,
  aiBusy,
  aiReady,
}: {
  paraIndex: number
  entry?: ParagraphSummary
  editing: boolean
  onToggle: () => void
  onSave: (text: string) => void
  /** AI 起草：返回生成的句子（写入 store 并回填编辑框）；null = 失败/未配置 */
  onAiDraft?: () => Promise<string | null>
  aiBusy?: boolean
  aiReady?: boolean
}) {
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (editing) setDraft(entry?.summary ?? '')
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  if (!editing && !entry) return null
  if (editing) {
    return (
      <div className="para-gist para-gist-editor">
        <textarea
          rows={2}
          autoFocus
          value={draft}
          placeholder={`第 ${paraIndex + 1} 段大意…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onToggle()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              onSave(draft)
              onToggle()
            }
          }}
        />
        <div className="para-gist-actions">
          <span className="para-gist-hint">Esc 取消 · ⌘↵ 保存</span>
          {entry && (
            <button
              className="para-gist-btn"
              onClick={() => {
                onSave('')
                onToggle()
              }}
            >
              清除
            </button>
          )}
          <button
            className="para-gist-btn"
            disabled={!aiReady || aiBusy}
            title={aiReady ? '让 AI 起草本段大意（可再编辑）' : '先到设置页配置 AI 服务'}
            onClick={async () => {
              const text = await onAiDraft?.()
              if (text) setDraft(text)
            }}
          >
            {aiBusy ? '起草中…' : 'AI 起草'}
          </button>
          <button
            className="para-gist-btn primary"
            onClick={() => {
              onSave(draft)
              onToggle()
            }}
          >
            保存
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="para-gist" onClick={onToggle} title="点击编辑本段大意">
      <span className="para-gist-tag">大意</span>
      <span className="para-gist-text">{entry!.summary}</span>
    </div>
  )
}
