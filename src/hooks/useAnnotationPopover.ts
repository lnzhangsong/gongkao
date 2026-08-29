import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAnnotationStore } from '../stores/annotationStore'
import { computeSelectionRange, flatText } from '../lib/offsets'
import { NARROW_BREAKPOINT } from '../lib/breakpoints'
import type { Annotation, AnnotationKind, HighlightColor, UnderlineStyle } from '../types'

export interface PopoverState {
  x: number
  y: number
  start: number
  end: number
  text: string
  /** 上方放不下时翻到选区下方（移动端/顶部选区） */
  below?: boolean
}

interface PendingNote {
  start: number
  end: number
  text: string
}

/**
 * 划词选择 / 标注弹层 / 笔记编辑的全部交互逻辑：
 * - 选区工具栏（高亮/下划线/笔记）定位与开关（桌面 mouseup / 移动端 selectionchange）
 * - 标注管理弹层（点击已有标注：切颜色 / 切下划线样式 / 加笔记 / 删除）
 * - 段内笔记展开/编辑状态（openNoteIds / editingNoteId / noteDraft）
 *
 * bodyRef 由页面持有（正文容器同时承担聚焦淡化等职责），传入共享。
 */
export function useAnnotationPopover(
  articleId: string,
  article: { id: string; content?: string[] } | undefined,
  starts: number[],
  bodyRef: React.RefObject<HTMLDivElement | null>,
) {
  const annotations = useAnnotationStore((s) => s.annotations)
  const addAnnotation = useAnnotationStore((s) => s.add)
  const removeAnnotation = useAnnotationStore((s) => s.remove)
  const removeMany = useAnnotationStore((s) => s.removeMany)
  const updateAnnotation = useAnnotationStore((s) => s.update)

  const popoverRef = useRef<HTMLDivElement>(null)
  const annPopoverRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [annPopover, setAnnPopover] = useState<{ ids: string[]; x: number; y: number; below?: boolean } | null>(null)
  const [pendingNote, setPendingNote] = useState<PendingNote | null>(null)
  const [hlColor, setHlColor] = useState<HighlightColor>('yellow')
  const [ulStyle, setUlStyle] = useState<UnderlineStyle>('solid')
  const [openNoteIds, setOpenNoteIds] = useState<Set<string>>(new Set())
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  /** 仅取当前文章的标注（避免跨文章串标） */
  const articleAnnotations = useMemo(
    () => annotations.filter((a) => a.articleId === articleId),
    [annotations, articleId],
  )

  /* ---------- 选择弹出工具栏 ---------- */
  const hidePopover = useCallback(() => setPopover(null), [])
  const hideAnnPopover = useCallback(() => setAnnPopover(null), [])

  useEffect(() => {
    const body = () => bodyRef.current

    /** 计算选区并弹出工具栏（桌面 mouseup / 移动端 selectionchange 共用） */
    const showPopoverFromSelection = () => {
      const el = body()
      if (!el) return
      // 弹层内部交互不触发
      if (popoverRef.current?.contains(document.activeElement ?? document.body)) return
      const range = computeSelectionRange(el, starts)
      if (!range) {
        hidePopover()
        return
      }
      const selRect = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
      if (!selRect || selRect.width === 0 && selRect.height === 0) return
      const exactText = flatText(article?.content ?? []).slice(range.start, range.end)
      const bodyRect = el.getBoundingClientRect()
      // PC（宽屏）：absolute 定位相对正文容器，滚动时工具栏跟随选区
      const isNarrow = window.innerWidth <= NARROW_BREAKPOINT
      // 上方放不下（选区贴近视口顶部）时翻到选区下方
      const below = selRect.top - bodyRect.top < 140
      const GAP = 6
      if (isNarrow) {
        // 窄屏：底部面板，坐标由 CSS 接管，仅记录选区状态
        setAnnPopover(null)
        setPopover({
          x: 0,
          y: 0,
          start: range.start,
          end: range.end,
          text: exactText,
          below,
        })
        return
      }
      // PC：相对正文容器定位，工具栏 translate(-50%,-100%) 使底部贴在选区上方
      const rawX = selRect.left + selRect.width / 2 - bodyRect.left
      const bodyW = bodyRect.width
      const HALF = 170
      const clampedX = Math.min(Math.max(rawX, HALF), Math.max(bodyW - HALF, HALF))
      setAnnPopover(null)
      setPopover({
        x: clampedX,
        y: below ? selRect.bottom - bodyRect.top + GAP : selRect.top - bodyRect.top - GAP,
        start: range.start,
        end: range.end,
        text: exactText,
        below,
      })
    }

    const onMouseUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (popoverRef.current?.contains(target) || annPopoverRef.current?.contains(target)) return
      const el = body()
      if (!el || !el.contains(target)) {
        hidePopover()
        return
      }
      showPopoverFromSelection()
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popoverRef.current && !popoverRef.current.contains(t)) hidePopover()
      if (annPopoverRef.current && !annPopoverRef.current.contains(t)) hideAnnPopover()
    }
    const onScroll = () => {
      hidePopover()
      hideAnnPopover()
    }

    // 移动端：触摸选词（触屏选择手柄）不触发 mouseup，用 selectionchange 兜底
    let selTimer = 0
    const onSelectionChange = () => {
      window.clearTimeout(selTimer)
      selTimer = window.setTimeout(() => {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed) showPopoverFromSelection()
      }, 120)
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', onScroll)
      window.clearTimeout(selTimer)
    }
  }, [starts, article, bodyRef, hidePopover, hideAnnPopover])

  /** 添加标注；与现有同类型标注重叠时合并为并集区间，避免一段文字叠多条 */
  const applyMark = (
    kind: 'highlight' | 'underline',
    opts?: { color?: HighlightColor; underlineStyle?: UnderlineStyle },
  ): { id: string; x: number; y: number } | null => {
    if (!article || !popover) return null
    const { start, end, x, y } = popover
    const overlapped = articleAnnotations.filter(
      (a) => a.kind === kind && a.start < end && a.end > start,
    )
    const base = {
      articleId: article.id,
      kind,
      ...(opts?.color ? { color: opts.color } : {}),
      ...(kind === 'underline' ? { underlineStyle: opts?.underlineStyle ?? 'solid' } : {}),
    }
    let created
    if (overlapped.length > 0) {
      const s = Math.min(start, ...overlapped.map((a) => a.start))
      const e = Math.max(end, ...overlapped.map((a) => a.end))
      removeMany(overlapped.map((a) => a.id))
      created = addAnnotation({ ...base, text: flatText(article.content!).slice(s, e), start: s, end: e })
    } else {
      created = addAnnotation({ ...base, text: popover.text, start, end })
    }
    window.getSelection()?.removeAllRanges()
    hidePopover()
    return { id: created.id, x, y }
  }

  const applyHighlight = (color: HighlightColor) => {
    setHlColor(color)
    const created = applyMark('highlight', { color })
    // 加完高亮立即弹出管理菜单（含删除高亮）
    if (created) openAnnPopover([created.id], created.x, created.y)
  }

  const applyUnderline = (style?: UnderlineStyle) => {
    const s = style ?? ulStyle
    setUlStyle(s)
    const created = applyMark('underline', { underlineStyle: s })
    // 加完下划线立即弹出管理菜单（含删除下划线）
    if (created) openAnnPopover([created.id], created.x, created.y)
  }

  /** 删除正在编辑且内容为空的笔记（没填就不保留） */
  const removeEmptyDraftNote = () => {
    if (!editingNoteId) return
    const ann = articleAnnotations.find((a) => a.id === editingNoteId)
    if (ann?.kind === 'note' && !(ann.noteText ?? '').trim()) {
      removeAnnotation(ann.id)
      setEditingNoteId(null)
      setOpenNoteIds((cur) => {
        const next = new Set(cur)
        next.delete(ann.id)
        return next
      })
    }
  }

  const startNote = () => {
    if (!article || !popover) return
    setPendingNote({ start: popover.start, end: popover.end, text: popover.text })
    window.getSelection()?.removeAllRanges()
    hidePopover()
  }

  /** 打开管理菜单：默认在选区上方，上方放不下则翻到下方 */
  const openAnnPopover = (ids: string[], x: number, y: number) => {
    const bodyRect = bodyRef.current?.getBoundingClientRect()
    const below = bodyRect ? bodyRect.top + y - 100 < 0 : false
    setAnnPopover({ ids, x, y, below })
  }

  /** 点击正文中的标注，弹出管理操作（切颜色 / 加下划线 / 加笔记 / 删除） */
  const showAnnActions = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    removeEmptyDraftNote()
    const ids = (e.currentTarget.dataset.annIds ?? '').split(',').filter(Boolean)
    if (ids.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const bodyRect = bodyRef.current?.getBoundingClientRect()
    if (!bodyRect) return
    // 点击已有标注时，若「添加标注工具栏」还开着（残留选区），先关掉，避免两个 fixed 弹层重叠
    setPopover(null)
    window.getSelection()?.removeAllRanges()
    openAnnPopover(ids, rect.left + rect.width / 2 - bodyRect.left, rect.top - bodyRect.top)
  }

  /** 按类型删除该段标注（高亮/下划线/笔记单独删） */
  const deleteAnnKind = (kind: AnnotationKind) => {
    if (!annPopover) return
    const targets = annPopover.ids
      .map((id) => articleAnnotations.find((a) => a.id === id))
      .filter((a): a is Annotation => a !== undefined && a.kind === kind)
    removeMany(targets.map((a) => a.id))
    setAnnPopover(null)
    // 只关闭被删除的笔记，其他笔记保持展开
    setOpenNoteIds((cur) => {
      const next = new Set(cur)
      targets.forEach((a) => {
        if (a.kind === 'note') next.delete(a.id)
      })
      return next
    })
  }

  /** 从管理面板打开该段文字的笔记 */
  const viewAnnNote = () => {
    if (!annPopover) return
    const noteIds = annPopover.ids
      .map((id) => articleAnnotations.find((a) => a.id === id))
      .filter((a) => a?.kind === 'note')
      .map((a) => a!.id)
    if (noteIds.length > 0) {
      setOpenNoteIds((cur) => new Set([...cur, ...noteIds]))
    }
    setAnnPopover(null)
  }

  /** 管理弹出层：id 集合内是否已有某类标注 */
  const annPopoverHas = (kind: AnnotationKind) =>
    annPopover
      ? annPopover.ids.some((id) => articleAnnotations.find((a) => a.id === id)?.kind === kind)
      : false

  const annPopoverFirst = (kind: AnnotationKind) => {
    if (!annPopover) return undefined
    for (const id of annPopover.ids) {
      const a = articleAnnotations.find((x) => x.id === id)
      if (a?.kind === kind) return a
    }
    return undefined
  }

  /** 切换高亮颜色 / 下划线样式（点击已有标注后） */
  const switchAnnColor = (color: HighlightColor) => {
    const a = annPopoverFirst('highlight')
    if (a) updateAnnotation(a.id, { color })
  }

  const switchAnnUnderlineStyle = (style: UnderlineStyle) => {
    const a = annPopoverFirst('underline')
    if (a) updateAnnotation(a.id, { underlineStyle: style })
  }

  /** 在已有标注的文字上追加其他标注类型 */
  const addKindToAnn = (
    kind: 'highlight' | 'underline' | 'note',
    opts?: { color?: HighlightColor; underlineStyle?: UnderlineStyle },
  ) => {
    if (!article || !annPopover) return
    removeEmptyDraftNote()
    // 段内任意标注都可作为取区间依据（纯笔记段也能继续加高亮/下划线/笔记）
    const primary = annPopover.ids
      .map((id) => articleAnnotations.find((a) => a.id === id))
      .find(Boolean)
    if (!primary) return
    if (
      kind !== 'note' &&
      articleAnnotations.some((a) => a.kind === kind && a.start < primary.end && a.end > primary.start)
    ) {
      return
    }
    const text = flatText(article.content!).slice(primary.start, primary.end)
    if (kind === 'note') {
      // 创建笔记并直接进入编辑（聚焦文本框，可立即输入）；同时展开该段全部笔记
      const n = addAnnotation({
        articleId: article.id,
        kind: 'note',
        text,
        start: primary.start,
        end: primary.end,
        noteText: '',
      })
      const noteIds = articleAnnotations
        .filter((a) => a.kind === 'note' && a.start < primary.end && a.end > primary.start)
        .map((a) => a.id)
      setOpenNoteIds((cur) => new Set([...cur, ...noteIds, n.id]))
      setEditingNoteId(n.id)
      setNoteDraft('')
      setAnnPopover(null)
    } else {
      addAnnotation({
        articleId: article.id,
        kind,
        ...(kind === 'underline' ? { underlineStyle: opts?.underlineStyle ?? 'solid' } : {}),
        ...(kind === 'highlight' && opts?.color ? { color: opts.color } : {}),
        text,
        start: primary.start,
        end: primary.end,
      })
    }
  }

  const saveNote = () => {
    if (!article || !pendingNote) return
    const content = noteDraft.trim()
    if (!content) {
      // 内容为空：不保存笔记
      setPendingNote(null)
      setNoteDraft('')
      return
    }
    const ann = addAnnotation({
      articleId: article.id,
      kind: 'note',
      text: pendingNote.text,
      start: pendingNote.start,
      end: pendingNote.end,
      noteText: content,
    })
    setPendingNote(null)
    setNoteDraft('')
    setOpenNoteIds((cur) => new Set(cur).add(ann.id))
  }

  /** 展开/收起某段文字的全部笔记 */
  const toggleSegmentNotes = (ids: string[]) => {
    removeEmptyDraftNote()
    setOpenNoteIds((cur) => {
      const next = new Set(cur)
      const allOpen = ids.every((id) => cur.has(id))
      if (allOpen) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
    setEditingNoteId(null)
  }

  const startEditNote = (id: string, current: string) => {
    setEditingNoteId(id)
    setNoteDraft(current)
  }

  const saveEditNote = (id: string) => {
    const content = noteDraft.trim()
    if (!content) {
      removeAnnotation(id)
      setOpenNoteIds((cur) => {
        const next = new Set(cur)
        next.delete(id)
        return next
      })
    } else {
      updateAnnotation(id, { noteText: content })
    }
    setEditingNoteId(null)
    setNoteDraft('')
  }

  /** 每个 note 标注所在的段落 index（仅当前文章） */
  const noteParaIndex = useMemo(() => {
    const map: Record<string, number> = {}
    if (!article) return map
    for (const a of articleAnnotations) {
      if (a.kind !== 'note') continue
      const idx = starts.findIndex((s, i) => a.start >= s && a.start < s + article.content![i].length)
      if (idx >= 0) map[a.id] = idx
    }
    return map
  }, [articleAnnotations, article, starts])

  return {
    /** refs（弹层定位容器） */
    popoverRef,
    annPopoverRef,
    popover,
    annPopover,
    /** 当前文章的标注（页面渲染 splitParagraph 用） */
    articleAnnotations,
    pendingNote,
    setPendingNote,
    hlColor,
    ulStyle,
    openNoteIds,
    editingNoteId,
    setEditingNoteId,
    noteDraft,
    setNoteDraft,
    applyHighlight,
    applyUnderline,
    startNote,
    saveNote,
    showAnnActions,
    toggleSegmentNotes,
    startEditNote,
    saveEditNote,
    deleteAnnKind,
    viewAnnNote,
    annPopoverHas,
    annPopoverFirst,
    switchAnnColor,
    switchAnnUnderlineStyle,
    addKindToAnn,
    noteParaIndex,
  }
}
