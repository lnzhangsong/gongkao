import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useNavigate, useParams, Navigate, Link } from 'react-router-dom'
import { Bookmark, Highlighter, Minus, Plus, StickyNote, Underline as UnderlineIcon } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { useThemeStore, THEMES } from '../stores/themeStore'
import { paragraphStarts, computeSelectionRange, splitParagraph, flatText } from '../lib/offsets'
import { formatDate } from '../data'
import { formatTimeOnly } from '../lib/export'
import { HL_COLORS, HL_COLOR_LABELS, type HighlightColor } from '../types'

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
  const navigate = useNavigate()

  const article = useArticleStore((s) => s.articles.find((a) => a.id === articleId))
  const getProgress = useArticleStore((s) => s.getProgress)
  const startReading = useArticleStore((s) => s.startReading)
  const saveProgress = useArticleStore((s) => s.saveProgress)
  const addReadingTime = useArticleStore((s) => s.addReadingTime)
  const toggleFavorite = useArticleStore((s) => s.toggleFavorite)

  const settings = useReaderStore((s) => s.settings)
  const setFontSize = useReaderStore((s) => s.setFontSize)
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
  const [annPopover, setAnnPopover] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  const [pendingNote, setPendingNote] = useState<PendingNote | null>(null)
  const [hlColor, setHlColor] = useState<HighlightColor>('yellow')
  const [openNoteId, setOpenNoteId] = useState<string | null>(null)
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
    if (!article) return
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
  }, [articleId])

  const percentRef = useRef(percent)
  useEffect(() => {
    percentRef.current = percent
  }, [percent])

  /* ---------- 实测阅读时长（秒）：页面可见时每秒累计，离开/切后台时落盘 ---------- */
  const pendingTimeRef = useRef(0)
  useEffect(() => {
    if (!article) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      pendingTimeRef.current += 1
      setSessionSec((s) => s + 1)
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
  const applyMark = (kind: 'highlight' | 'underline', color?: HighlightColor) => {
    if (!article || !popover) return
    const { start, end } = popover
    const overlapped = articleAnnotations.filter(
      (a) => a.kind === kind && a.start < end && a.end > start,
    )
    if (overlapped.length > 0) {
      const s = Math.min(start, ...overlapped.map((a) => a.start))
      const e = Math.max(end, ...overlapped.map((a) => a.end))
      removeMany(overlapped.map((a) => a.id))
      addAnnotation({
        articleId: article.id,
        kind,
        ...(color ? { color } : {}),
        text: flatText(article.content).slice(s, e),
        start: s,
        end: e,
      })
    } else {
      addAnnotation({
        articleId: article.id,
        kind,
        ...(color ? { color } : {}),
        text: popover.text,
        start,
        end,
      })
    }
    window.getSelection()?.removeAllRanges()
    hidePopover()
  }

  const applyHighlight = (color: HighlightColor) => {
    setHlColor(color)
    applyMark('highlight', color)
  }

  const applyUnderline = () => {
    applyMark('underline')
  }

  const startNote = () => {
    if (!article || !popover) return
    setPendingNote({ start: popover.start, end: popover.end, text: popover.text })
    window.getSelection()?.removeAllRanges()
    hidePopover()
  }

  /** 点击正文中的高亮/划线，弹出删除操作 */
  const showAnnActions = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    const ids = (e.currentTarget.dataset.annIds ?? '').split(',').filter(Boolean)
    if (ids.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const bodyRect = bodyRef.current?.getBoundingClientRect()
    if (!bodyRect) return
    setAnnPopover({
      ids,
      x: rect.left + rect.width / 2 - bodyRect.left,
      y: rect.top - bodyRect.top,
    })
  }

  const deleteAnn = () => {
    if (!annPopover) return
    removeMany(annPopover.ids)
    setAnnPopover(null)
    setOpenNoteId(null)
  }

  const saveNote = () => {
    if (!article || !pendingNote) return
    const ann = addAnnotation({
      articleId: article.id,
      kind: 'note',
      text: pendingNote.text,
      start: pendingNote.start,
      end: pendingNote.end,
      noteText: noteDraft.trim(),
    })
    setPendingNote(null)
    setNoteDraft('')
    setOpenNoteId(ann.id)
  }

  const toggleNote = (id: string) => {
    setOpenNoteId((cur) => (cur === id ? null : id))
    setEditingNoteId(null)
  }

  const startEditNote = (id: string, current: string) => {
    setEditingNoteId(id)
    setNoteDraft(current)
  }

  const saveEditNote = (id: string) => {
    updateAnnotation(id, { noteText: noteDraft.trim() })
    setEditingNoteId(null)
    setNoteDraft('')
  }

  /* 结尾金句保存为摘录 */
  const saveFinishNote = () => {
    if (!article || !article.finishNote) return
    const exists = annotations.some(
      (a) => a.articleId === article.id && a.kind === 'note' && a.start === 0 && a.end === 0,
    )
    if (exists) return
    addAnnotation({
      articleId: article.id,
      kind: 'note',
      text: article.finishNote,
      start: 0,
      end: 0,
      noteText: '',
    })
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
      <div className="reading-nav">
        <button className="back" onClick={() => navigate(-1)}>
          ← BACK TO INDEX
        </button>
        <div className="article-status">
          <span>READING　{Math.round(percent)}%</span>
          <div className="progress">
            <i style={{ width: `${percent}%` }} />
          </div>
          <span>{fmtDuration((progress?.timeSpentSec ?? 0) + sessionSec)}</span>
        </div>
      </div>

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
                      if (note) {
                        return (
                          <span
                            key={j}
                            className="note-mark"
                            onClick={() => toggleNote(note.id)}
                            role="button"
                            tabIndex={0}
                          >
                            {seg.text}
                          </span>
                        )
                      }
                      const anns = seg.annotations.filter((a) => a.kind !== 'note')
                      const cls = anns
                        .map((a) =>
                          a.kind === 'highlight'
                            ? `highlighted hl-${a.color ?? 'yellow'}`
                            : 'underlined',
                        )
                        .join(' ')
                      return (
                        <span
                          key={j}
                          className={cls}
                          data-ann-ids={anns.map((a) => a.id).join(',')}
                          onClick={showAnnActions}
                          title="点击管理此标注"
                        >
                          {seg.text}
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
                    <div className={`inline-note${openNoteId === n.id ? ' show' : ''}`} key={n.id}>
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

            <div className="finish">
              <small>READING NOTE / 01</small>
              <h3>{article.finishNote ?? article.pullquote ?? article.summary}</h3>
              <div className="finish-foot">
                <button className="save" onClick={saveFinishNote}>
                  + 保存为摘录　↗
                </button>
                <Link to="/notes" className="save" style={{ textDecoration: 'none' }}>
                  查看我的摘录　↗
                </Link>
              </div>
            </div>

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
              <button onClick={() => applyHighlight(hlColor)}>
                <Highlighter size={12} /> 高亮
              </button>
              <button onClick={applyUnderline}>
                <UnderlineIcon size={12} /> 下划线
              </button>
              <button onClick={startNote}>
                <StickyNote size={12} /> 笔记
              </button>
            </div>

            {/* 标注操作（点击高亮/划线后出现） */}
            <div
              className={`selection-popover ann-popover${annPopover ? ' show' : ''}`}
              ref={annPopoverRef}
              style={annPopover ? { left: annPopover.x, top: annPopover.y } : undefined}
            >
              <span className="ann-popover-label">已标注</span>
              <button onClick={deleteAnn}>删除标注</button>
              <button onClick={hideAnnPopover}>取消</button>
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
          <div className="side-note">
            <strong>今日金句</strong>
            <p>{article.pullquote ?? article.summary}</p>
          </div>
        </aside>
      </main>
    </section>
  )
}
