import { useState } from 'react'
import { BookPlus, Highlighter, StickyNote, Underline as UnderlineIcon } from 'lucide-react'
import { addTerm } from '../../lib/api'
import { alertDialog } from '../ui/confirm'
import { useLocalWrite } from '../../hooks/useLocalWrite'
import { hasTermCached } from './termMatch'
import { HL_COLORS, HL_COLOR_LABELS, UNDERLINE_STYLES, UNDERLINE_STYLE_LABELS } from '../../types'
import { MATERIAL_TYPES, MATERIAL_TYPE_HINTS, MATERIAL_TYPE_LABELS } from '../../data/material'
import type { PopoverState } from '../../hooks/useAnnotationPopover'
import type { HighlightColor, MaterialType, UnderlineStyle } from '../../types'

interface SelectionPopoverProps {
  popover: PopoverState | null
  popoverRef: React.RefObject<HTMLDivElement | null>
  isNarrow: boolean
  hlColor: HighlightColor
  ulStyle: UnderlineStyle
  applyHighlight: (c: HighlightColor) => void
  applyUnderline: (s: UnderlineStyle) => void
  applyMaterial: (t: MaterialType) => void
  startNote: () => void
}

/* 划词存入规范词库（成功后按钮短暂变 ✓）。依赖本地 api-server 的写接口（生产只读），
   按能力探测决定是否渲染按钮，而不是点了再弹错误对话框（主阅读路径上的功能，不能裸奔失败） */
function useSaveSelectionAsTerm(popover: PopoverState | null) {
  const canSaveTerm = useLocalWrite()
  const [termSaved, setTermSaved] = useState<'idle' | 'ok' | 'dup' | 'busy'>('idle')
  const saveSelectionAsTerm = async () => {
    if (!popover || termSaved === 'busy') return
    const term = popover.text.trim().replace(/\s+/g, '')
    if (!term || term.length > 20) {
      void alertDialog('请选中 20 字以内的词语')
      return
    }
    if (hasTermCached(term)) {
      setTermSaved('dup')
      window.setTimeout(() => setTermSaved('idle'), 1500)
      return
    }
    setTermSaved('busy')
    try {
      await addTerm({ theme: '综合其他', term })
      setTermSaved('ok')
      window.setTimeout(() => setTermSaved('idle'), 1500)
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e))
    } finally {
      window.setTimeout(() => setTermSaved('idle'), 1500)
    }
  }
  return { canSaveTerm, termSaved, saveSelectionAsTerm }
}

/** 选择弹出工具栏（位于 article-body 内，坐标相对正文）— 分两行：标注行 + 素材/动作行，避免 17 个按钮挤一行 */
export function SelectionPopover(props: SelectionPopoverProps) {
  const { popover, popoverRef, isNarrow, hlColor, ulStyle, applyHighlight, applyUnderline, applyMaterial, startNote } =
    props
  const { canSaveTerm, termSaved, saveSelectionAsTerm } = useSaveSelectionAsTerm(popover)
  return (
    <div
      className={`selection-popover${popover ? ' show' : ''}${popover?.below ? ' below' : ''}`}
      ref={popoverRef}
      style={popover && !isNarrow ? { left: popover.x, top: popover.y } : undefined}
    >
      <div className="popover-row popover-row-marks">
        <div className="hl-dots">
          {HL_COLORS.map((c) => (
            <button
              key={c}
              className={`hl-dot ${c}${hlColor === c ? ' active' : ''}`}
              onClick={() => applyHighlight(c)}
              title={`高亮 · ${HL_COLOR_LABELS[c]}`}
              aria-label={`高亮 · ${HL_COLOR_LABELS[c]}`}
            />
          ))}
        </div>
        <div className="ul-dots">
          {UNDERLINE_STYLES.map((st) => (
            <button
              key={st}
              className={`ul-dot ${st}${ulStyle === st ? ' active' : ''}`}
              onClick={() => applyUnderline(st)}
              title={`下划线 · ${UNDERLINE_STYLE_LABELS[st]}`}
              aria-label={`下划线 · ${UNDERLINE_STYLE_LABELS[st]}`}
            />
          ))}
        </div>
        <button onClick={() => applyHighlight(hlColor)}>
          <Highlighter size={12} /> 高亮
        </button>
        <button onClick={() => applyUnderline(ulStyle)}>
          <UnderlineIcon size={12} /> 下划线
        </button>
        <button onClick={startNote}>
          <StickyNote size={12} /> 笔记
        </button>
      </div>
      <div className="popover-row popover-row-mats">
        <span className="popover-row-label">素材</span>
        <div className="mat-row">
          {MATERIAL_TYPES.map((t) => (
            <button
              key={t}
              className={`mat-btn mat-btn-${t}`}
              onClick={() => applyMaterial(t)}
              title={MATERIAL_TYPE_HINTS[t]}
            >
              {MATERIAL_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {canSaveTerm && (
        <button
          onClick={() => {
            if (termSaved === 'idle') void saveSelectionAsTerm()
          }}
          title="把选中词存入规范词库"
        >
          <BookPlus size={12} />
          {termSaved === 'ok'
            ? '已入词库'
            : termSaved === 'dup'
              ? '已在词库'
              : termSaved === 'busy'
                ? '存入中…'
                : '存规范词'}
        </button>
      )}
    </div>
  )
}
