import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { Bookmark, Highlighter, Minus, Plus, StickyNote, Underline as UnderlineIcon } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { useReaderStore, fontFamilyCss, FONT_FAMILIES } from '../stores/readerStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { useThemeStore, THEMES } from '../stores/themeStore'
import { MenuSelect } from '../components/ui/MenuSelect'
import { paragraphStarts, computeSelectionRange, splitParagraph, flatText } from '../lib/offsets'
import { formatDate } from '../data'
import { formatTimeOnly } from '../lib/export'
import { HL_COLORS, HL_COLOR_LABELS, UNDERLINE_STYLES, UNDERLINE_STYLE_LABELS, type Annotation, type AnnotationKind, type HighlightColor, type ReaderSettings, type UnderlineStyle } from '../types'

interface PopoverState {
  x: number
  y: number
  start: number
  end: number
  text: string
}

interface PendingNote {
  start: number
  end: number
  text: string
}

/** 秒 → MM:SS / H:MM:SS */
function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`
}

export function ReadingPage() {
  const { articleId = '' } = useParams()

  const article = useArticleStore((s) => s.articles.find((a) => a.id === articleId))
  const getProgress = useArticleStore((s) => s.getProgress)
  const startReading = useArticleStore((s) => s.startReading)
  const saveProgress = useArticleStore((s) => s.saveProgress)
  const addReadingTime = useArticleStore((s) => s.addReadingTime)
  const toggleFavorite = useArticleStore((s) => s.toggleFavorite)
  const storeHydrated = useArticleStore((s) => s._hasHydrated)

  const settings = useReaderStore((s) => s.settings)
  const setFontSize = useReaderStore((s) => s.setFontSize)
  const setFontFamily = useReaderStore((s) => s.setFontFamily)
  const setReaderTheme = useReaderStore((s) => s.setReaderTheme)

  const annotations = useAnnotationStore((s) => s.annotations)
  const annotationsVisible = useAnnotationStore((s) => s.visible)
  const setAnnotationsVisible = useAnnotationStore((s) => s.setVisible)
  const addAnnotation = useAnnotationStore((s) => s.add)
  const removeAnnotation = useAnnotationStore((s) => s.remove)
  const removeMany = useAnnotationStore((s) => s.removeMany)
  const updateAnnotation = useAnnotationStore((s) => s.update)

  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  const bodyRef = useRef<HTMLDivElement>(null)
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
  const [percent, setPercent] = useState(0)
  const [sessionSec, setSessionSec] = useState(0)
  const lastSavedRef = useRef(0)
  const saveTimerRef = useRef<number>(0)

  const starts = useMemo(() => (article ? paragraphStarts(article.content) : []), [article])
  const progress = article ? getProgress(article.id) : undefined

  /** 仅取当前文章的标注（避免跨文章串标） */
  const articleAnnotations = useMemo(
    () => annotations.filter((a) => a.articleId === articleId),
    [annotations, articleId],
  )
  const displayAnnotations = annotationsVisible ? articleAnnotations : []

  /* ---------- 主题（阅读页可覆盖页面主题） ---------- */
  const activeTheme = settings.readerTheme || theme
  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme
    return () => {
      document.documentElement.dataset.theme = theme
    }
  }, [activeTheme, theme])  /* ---------- 阅读器 CSS 变量 ---------- */
  const bodyStyle = useMemo<CSSProperties>(
    () => ({
      '--reader-font-size': `${settings.fontSize}px`,
      '--reader-line-height': String(settings.lineHeight),
      '--reader-font-family': fontFamilyCss(settings.fontFamily),
    }) as CSSProperties,
    [settings.fontSize, settings.lineHeight, settings.fontFamily],
  )

  /* ---------- 进度 ---------- */
  const computePercent = useCallback(() => {
    // 与设计稿一致：按整页滚动计算（短文章也能正确归 100%）
    const max = document.documentElement.scrollHeight - window.innerHeight
    if (max <= 0) return
    const pct = Math.min(100, Math.max(0, (window.scrollY / max) * 100))
    setPercent(pct)
    const now = Date.now()
    // 节流：至少每 1.5s 保存一次
    if (now - lastSavedRef.current > 1500) {
      lastSavedRef.current = now
      saveProgress(articleId, pct, window.scrollY)
    }
    // 尾部保存：滚动停止 400ms 后补一次，确保最后位置落盘
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      lastSavedRef.current = Date.now()
      saveProgress(articleId, pct, window.scrollY)
    }, 400)
  }, [articleId, saveProgress])

  useEffect(() => {
    if (!article || !storeHydrated) return
    startReading(article.id)
    // 恢复上次阅读位置（即时滚动，不做平滑动画）
    const p = getProgress(article.id)
    if (p && p.lastPosition > 0) {
      requestAnimationFrame(() => window.scrollTo({ top: p.lastPosition, behavior: 'instant' }))
    }
    setPercent(p?.percent ?? 0)
    const onScroll = () => requestAnimationFrame(computePercent)
    window.addEventListener('scroll', onScroll, { passive: true })
    const flush = () => {
      saveProgress(article.id, percentRef.current, window.scrollY)
    }
    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', onHide)
      window.clearTimeout(saveTimerRef.current)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, storeHydrated])

  const percentRef = useRef(percent)
  useEffect(() => {
    percentRef.current = percent
  }, [percent])

  /* ---------- 实测阅读时长（秒）：页面可见时每秒累计；每 3 秒落盘一次，
     离开/切后台时再补一次（IDB 异步写入在页面卸载时可能被中断，周期性落盘兜底） ---------- */
  const pendingTimeRef = useRef(0)
  useEffect(() => {
    if (!article) return
    let ticks = 0
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      pendingTimeRef.current += 1
      ticks += 1
      setSessionSec((s) => s + 1)
      if (ticks >= 3) {
        ticks = 0
        if (pendingTimeRef.current > 0) {
          addReadingTime(article.id, pendingTimeRef.current)
          pendingTimeRef.current = 0
        }
      }
    }
    const timer = window.setInterval(tick, 1000)
    const flushTime = () => {
      if (pendingTimeRef.current > 0) {
        addReadingTime(article.id, pendingTimeRef.current)
        pendingTimeRef.current = 0
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushTime()
    }
    window.addEventListener('pagehide', flushTime)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', flushTime)
      document.removeEventListener('visibilitychange', onVis)
      flushTime()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId])

  /* ---------- 选择弹出工具栏 ---------- */
  const hidePopover = useCallback(() => setPopover(null), [])
  const hideAnnPopover = useCallback(() => setAnnPopover(null), [])

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (popoverRef.current?.contains(target) || annPopoverRef.current?.contains(target)) return
      const body = bodyRef.current
      if (!body || !body.contains(target)) {
        hidePopover()
        return
      }
      const range = computeSelectionRange(body, starts)
      if (!range) {
        hidePopover()
        return
      }
      const selRect = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
      const bodyRect = body.getBoundingClientRect()
      if (!selRect) return
      // 选中文字以偏移区间为准（与存储一致），不再依赖后续 selection 是否被点击清除
      const exactText = flatText(article?.content ?? []).slice(range.start, range.end)
      setPopover({
        x: selRect.left + selRect.width / 2 - bodyRect.left,
        y: selRect.top - bodyRect.top,
        start: range.start,
        end: range.end,
        text: exactText,
      })
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
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll)
    }
  }, [starts, hidePopover, hideAnnPopover])

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
      created = addAnnotation({ ...base, text: flatText(article.content).slice(s, e), start: s, end: e })
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
    const text = flatText(article.content).slice(primary.start, primary.end)
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
      const idx = starts.findIndex((s, i) => a.start >= s && a.start < s + article.content[i].length)
      if (idx >= 0) map[a.id] = idx
    }
    return map
  }, [articleAnnotations, article, starts])

  if (!article) return <Navigate to="/library" replace />

  const p = progress
  const isFavorite = p?.favorite ?? false

  return (
    <section className="reading-page">
      <div className="scroll-progress" style={{ width: `${percent}%` }} />
      <main className="reading-layout">
        <article>
          <header className="article-head">
            <div className="tag">
              {article.source} · {article.topic}　/　{formatDate(article.date)}
            </div>
            <h1>{article.title}</h1>
            <p className="dek">{article.summary}</p>
            <div className="article-meta">
              <span>阅读时间　{fmtDuration((progress?.timeSpentSec ?? 0) + sessionSec)}</span>
              <span>预计　{article.readTime} MIN</span>
              <span>文章编号　NO. {article.id.slice(1)}</span>
            </div>
          </header>

          <div className="article-body" ref={bodyRef} style={bodyStyle}>
            {article.content.map((text, i) => {
              const paraStart = starts[i]
              const segments = splitParagraph(text, paraStart, displayAnnotations)
              const hasPending = pendingNote && paraStart <= pendingNote.start && pendingNote.start < paraStart + text.length
              const openNotes = displayAnnotations.filter((a) => a.kind === 'note' && noteParaIndex[a.id] === i)
              return (
                <Fragment key={i}>
                  <p data-para={i}>
                    {segments.map((seg, j) => {
                      if (seg.annotations.length === 0) return <Fragment key={j}>{seg.text}</Fragment>
                      const note = seg.annotations.find((a) => a.kind === 'note')
                      const anns = seg.annotations.filter((a) => a.kind !== 'note')
                      const cls = [
                        note ? 'note-mark' : '',
                        ...anns.map((a) =>
                          a.kind === 'highlight'
                            ? `highlighted hl-${a.color ?? 'yellow'}`
                            : `underlined${a.underlineStyle && a.underlineStyle !== 'solid' ? ` ul-${a.underlineStyle}` : ''}`,
                        ),
                      ]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <span className="note-wrap" key={j}>
                          <span
                            className={cls}
                            data-ann-ids={seg.annotations.map((a) => a.id).join(',')}
                            onClick={showAnnActions}
                            title="点击管理标注"
                          >
                            {seg.text}
                          </span>
                          {note && (
                            <span
                              className="note-star"
                              onClick={() =>
                                toggleSegmentNotes(
                                  seg.annotations.filter((a) => a.kind === 'note').map((a) => a.id),
                                )
                              }
                              title="展开/收起笔记"
                              aria-label="展开/收起笔记"
                            >
                              ✦
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </p>

                  {hasPending && (
                    <div className="note-form show">
                      <textarea
                        placeholder="写下你的想法…"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        autoFocus
                      />
                      <div className="note-form-actions">
                        <button onClick={saveNote}>保存笔记</button>
                        <button className="cancel" onClick={() => setPendingNote(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  {openNotes.map((n) => (
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
                          style={{ width: '100%', border: '1px solid var(--line)', background: 'transparent', padding: 8, font: '12px/1.7 var(--serif)', color: 'var(--ink)', minHeight: 60, resize: 'vertical' }}
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          autoFocus
                        />
                      ) : (
                        <div className="note-body">{n.noteText || '（未填写笔记内容）'}</div>
                      )}
                    </div>
                  ))}
                </Fragment>
              )
            })}

            {article.pullquote && (
              <blockquote className="pullquote">“{article.pullquote}”</blockquote>
            )}

            {/* 选择弹出工具栏（位于 article-body 内，坐标相对正文） */}
            <div
              className={`selection-popover${popover ? ' show' : ''}`}
              ref={popoverRef}
              style={popover ? { left: popover.x, top: popover.y } : undefined}
            >
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

            {/* 标注管理（点击高亮/划线后出现） */}
            <div
              className={`selection-popover ann-popover${annPopover ? ' show' : ''}${annPopover?.below ? ' below' : ''}`}
              ref={annPopoverRef}
              style={annPopover ? { left: annPopover.x, top: annPopover.y } : undefined}
            >
              <span className="ann-popover-label">
                {annPopover && annPopoverHas('highlight') && '高亮'}
                {annPopover && annPopoverHas('underline') && '下划线'}
                {annPopover && annPopoverHas('note') && '笔记'}
              </span>
              {/* 高亮色点：已有高亮则切换颜色，否则添加高亮 */}
              {annPopover && (
                <div className="hl-dots">
                  {HL_COLORS.map((c) => {
                    const has = annPopoverHas('highlight')
                    const cur = annPopoverFirst('highlight')?.color
                    return (
                      <button
                        key={c}
                        className={`hl-dot ${c}${has && cur === c ? ' active' : ''}`}
                        onClick={() =>
                          has ? switchAnnColor(c) : addKindToAnn('highlight', { color: c })
                        }
                        title={has ? `切换高亮颜色 · ${HL_COLOR_LABELS[c]}` : `添加高亮 · ${HL_COLOR_LABELS[c]}`}
                        aria-label={has ? `切换高亮颜色 · ${HL_COLOR_LABELS[c]}` : `添加高亮 · ${HL_COLOR_LABELS[c]}`}
                      />
                    )
                  })}
                </div>
              )}
              {/* 下划线样式点：仅当存在真实下划线时显示，只能切换样式（新增走选中文字） */}
              {annPopover && annPopoverHas('underline') && (
                <div className="ul-dots">
                  {UNDERLINE_STYLES.map((st) => {
                    const cur = annPopoverFirst('underline')?.underlineStyle ?? 'solid'
                    return (
                      <button
                        key={st}
                        className={`ul-dot ${st}${cur === st ? ' active' : ''}`}
                        onClick={() => switchAnnUnderlineStyle(st)}
                        title={`切换下划线 · ${UNDERLINE_STYLE_LABELS[st]}`}
                        aria-label={`切换下划线 · ${UNDERLINE_STYLE_LABELS[st]}`}
                      />
                    )
                  })}
                </div>
              )}
              {annPopover && (
                <button onClick={() => addKindToAnn('note')}>加笔记</button>
              )}
              {annPopover && annPopoverHas('note') && (
                <button onClick={viewAnnNote}>查看/编辑笔记</button>
              )}
              {annPopover && annPopoverHas('highlight') && (
                <button onClick={() => deleteAnnKind('highlight')}>删除高亮</button>
              )}
              {annPopover && annPopoverHas('underline') && (
                <button onClick={() => deleteAnnKind('underline')}>删除下划线</button>
              )}
              {annPopover && annPopoverHas('note') && (
                <button onClick={() => deleteAnnKind('note')}>删除笔记</button>
              )}
            </div>
          </div>
        </article>

        <aside className="article-tools">
          <span className="tools-title">阅读辅助</span>
          <div className="tool">
            <span>阅读设置</span>
            <span className="tool-btns">
              <button onClick={() => setFontSize(settings.fontSize - 1)} aria-label="减小字号">
                <Minus size={12} />
              </button>
              <button onClick={() => setFontSize(settings.fontSize + 1)} aria-label="增大字号">
                <Plus size={12} />
              </button>
            </span>
          </div>
          <div className="tool">
            <span>正文字体</span>
            <MenuSelect
              value={settings.fontFamily}
              options={FONT_FAMILIES.map((f) => ({ key: f.key, label: f.label }))}
              onChange={(key) => setFontFamily(key as ReaderSettings['fontFamily'])}
              ariaLabel="正文字体"
            />
          </div>
          <div className="tool">
            <span>阅读主题</span>
            <button
              onClick={() => {
                const idx = THEMES.findIndex((t) => t.name === activeTheme)
                // 阅读页切换主题 = 全局切换（清除阅读页单独覆盖，整体生效）
                setTheme(THEMES[(idx + 1) % THEMES.length].name)
                setReaderTheme('')
              }}
            >
              {THEMES.find((t) => t.name === activeTheme)?.label ?? '跟随页面'}　↻
            </button>
          </div>
          <div className="tool">
            <span>文章操作</span>
            <button
              className={isFavorite ? 'active' : ''}
              onClick={() => toggleFavorite(article.id)}
            >
              <Bookmark size={12} style={{ verticalAlign: -2 }} /> {isFavorite ? '已收藏' : '收藏'}
            </button>
          </div>
          <div className="tool">
            <span>显示标注</span>
            <button
              className={annotationsVisible ? 'active' : ''}
              onClick={() => setAnnotationsVisible(!annotationsVisible)}
            >
              {annotationsVisible ? 'ON' : 'OFF'}
            </button>
          </div>
        </aside>
      </main>
    </section>
  )
}
