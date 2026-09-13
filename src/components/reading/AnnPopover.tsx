import { PatternInput } from './ParaGist'
import {
  HL_COLORS,
  HL_COLOR_LABELS,
  UNDERLINE_STYLES,
  UNDERLINE_STYLE_LABELS,
  type Annotation,
  type HighlightColor,
  type MaterialType,
  type UnderlineStyle,
} from '../../types'
import { MATERIAL_TYPES, MATERIAL_TYPE_HINTS, MATERIAL_TYPE_LABELS } from '../../data/material'

interface AnnPopoverProps {
  annPopover: { ids: string[]; x: number; y: number; below?: boolean } | null
  /** 页面侧派生的原始值（不在渲染期调用 hook 函数，避免 React Compiler 判定 ref 泄漏而跳过优化） */
  hasHighlight: boolean
  hasUnderline: boolean
  hasNote: boolean
  firstHighlight: Annotation | undefined
  firstUnderline: Annotation | undefined
  switchAnnColor: (c: HighlightColor) => void
  switchAnnUnderlineStyle: (s: UnderlineStyle) => void
  addKindToAnn: (kind: 'highlight' | 'note', opts?: Partial<Annotation>) => void
  addMaterialToAnn: (t: MaterialType) => void
  removeMaterialFromAnn: () => void
  deleteAnnKind: (kind: 'highlight' | 'underline' | 'note') => void
  viewAnnNote: () => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
}

/** 标注管理（点击高亮/划线后出现）。外层定位 div（含 annPopoverRef）由页面渲染，本组件只管内容 */
export function AnnPopover(p: AnnPopoverProps) {
  const { annPopover } = p
  const curHl = p.firstHighlight
  return (
    <>
      <span className="ann-popover-label">
        {annPopover && p.hasHighlight && '高亮'}
        {annPopover && p.hasUnderline && '下划线'}
        {annPopover && p.hasNote && '笔记'}
      </span>
      {/* 高亮色点：已有高亮则切换颜色，否则添加高亮 */}
      {annPopover && (
        <div className="hl-dots">
          {HL_COLORS.map((c) => (
            <button
              key={c}
              className={`hl-dot ${c}${p.hasHighlight && curHl?.color === c ? ' active' : ''}`}
              onClick={() => (p.hasHighlight ? p.switchAnnColor(c) : p.addKindToAnn('highlight', { color: c }))}
              title={p.hasHighlight ? `切换高亮颜色 · ${HL_COLOR_LABELS[c]}` : `添加高亮 · ${HL_COLOR_LABELS[c]}`}
              aria-label={p.hasHighlight ? `切换高亮颜色 · ${HL_COLOR_LABELS[c]}` : `添加高亮 · ${HL_COLOR_LABELS[c]}`}
            />
          ))}
        </div>
      )}
      {/* 下划线样式点：仅当存在真实下划线时显示，只能切换样式（新增走选中文字） */}
      {annPopover && p.hasUnderline && (
        <div className="ul-dots">
          {UNDERLINE_STYLES.map((st) => {
            const cur = p.firstUnderline?.underlineStyle ?? 'solid'
            return (
              <button
                key={st}
                className={`ul-dot ${st}${cur === st ? ' active' : ''}`}
                onClick={() => p.switchAnnUnderlineStyle(st)}
                title={`切换下划线 · ${UNDERLINE_STYLE_LABELS[st]}`}
                aria-label={`切换下划线 · ${UNDERLINE_STYLE_LABELS[st]}`}
              />
            )
          })}
        </div>
      )}
      {annPopover && (
        <div className="mat-row ann-mat-row">
          <span className="ann-mat-label">素材</span>
          {MATERIAL_TYPES.map((t) => (
            <button
              key={t}
              className={`mat-btn mat-btn-${t}${curHl?.materialType === t ? ' active' : ''}`}
              onClick={() => (curHl?.materialType === t ? p.removeMaterialFromAnn() : p.addMaterialToAnn(t))}
              title={
                curHl?.materialType === t
                  ? `取消「${MATERIAL_TYPE_LABELS[t]}」标记`
                  : `标记为${MATERIAL_TYPE_LABELS[t]} · ${MATERIAL_TYPE_HINTS[t]}`
              }
            >
              {MATERIAL_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      {annPopover && curHl?.materialType === 'pattern' && (
        <PatternInput
          value={curHl.pattern ?? ''}
          onSave={(v) => {
            if (curHl) p.updateAnnotation(curHl.id, { pattern: v || undefined })
          }}
        />
      )}
      {annPopover && <button onClick={() => p.addKindToAnn('note')}>加笔记</button>}
      {annPopover && p.hasNote && <button onClick={p.viewAnnNote}>查看/编辑笔记</button>}
      {annPopover && p.hasHighlight && <button onClick={() => p.deleteAnnKind('highlight')}>删除高亮</button>}
      {annPopover && p.hasUnderline && <button onClick={() => p.deleteAnnKind('underline')}>删除下划线</button>}
      {annPopover && p.hasNote && <button onClick={() => p.deleteAnnKind('note')}>删除笔记</button>}
    </>
  )
}
