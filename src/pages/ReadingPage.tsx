import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useParams, Link } from 'react-router-dom'
import { Highlighter, StickyNote, Underline as UnderlineIcon, BookPlus } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { addTerm } from '../lib/api'
import { useAnnotationStore } from '../stores/annotationStore'
import { useThemeStore, THEMES, resolveTheme } from '../stores/themeStore'
import { usePrefersDark } from '../lib/prefersDark'
import { ArticleToolsMenu } from '../components/ui/ArticleToolsMenu'
import { ReaderToolsPanel } from '../components/reading/ReaderToolsPanel'
import { TermText, hasTermCached } from '../components/reading/TermHighlight'
import { useFocusMode } from '../lib/useFocusMode'
import { useReadingTimer } from '../hooks/useReadingTimer'
import { useAnnotationPopover } from '../hooks/useAnnotationPopover'
import { paragraphStarts, splitParagraph } from '../lib/offsets'
import { loadFontFamily } from '../lib/fonts'
import { formatDate } from '../data'
import { formatTimeOnly } from '../lib/export'
import { HL_COLORS, HL_COLOR_LABELS, UNDERLINE_STYLES, UNDERLINE_STYLE_LABELS } from '../types'

/** 段落聚焦带：视口高度的比例上下限（按手感可调） */

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

  const getArticle = useArticleStore((s) => s.getArticle)
  const ensureContent = useArticleStore((s) => s.ensureContent)
  const allArticles = useArticleStore((s) => s.articles)
  const article = getArticle(articleId)

  /* 相邻篇目：按文库当前排序（date DESC, id）取前后一篇 */
  const { prevArticle, nextArticle } = useMemo(() => {
    const idx = allArticles.findIndex((a) => a.id === articleId)
    return {
      prevArticle: idx > 0 ? allArticles[idx - 1] : undefined,
      nextArticle: idx >= 0 && idx < allArticles.length - 1 ? allArticles[idx + 1] : undefined,
    }
  }, [allArticles, articleId])

  const [contentReady, setContentReady] = useState(false)
  /** 正文拉取失败（服务不可用 / 文章不存在）：显示错误态而不是无限骨架 */
  const [loadError, setLoadError] = useState(false)

  /* 正文按需拉取（meta 不含正文）；缓存命中或拉取完成后置位 */
  useEffect(() => {
    let alive = true
    if (!articleId) return
    if (article?.content?.length) {
      setContentReady(true)
      setLoadError(false)
      return
    }
    setContentReady(false)
    setLoadError(false)
    void ensureContent(articleId).then((full) => {
      if (!alive) return
      if (full?.content?.length) setContentReady(true)
      else setLoadError(true)
    })
    return () => {
      alive = false
    }
  }, [articleId, article?.content, ensureContent])
  const getProgress = useArticleStore((s) => s.getProgress)
  const startReading = useArticleStore((s) => s.startReading)
  const saveProgress = useArticleStore((s) => s.saveProgress)
  const toggleFavorite = useArticleStore((s) => s.toggleFavorite)
  const storeHydrated = useArticleStore((s) => s._hasHydrated)

  const settings = useReaderStore((s) => s.settings)
  const setFontSize = useReaderStore((s) => s.setFontSize)
  const setFontFamily = useReaderStore((s) => s.setFontFamily)
  const setReaderTheme = useReaderStore((s) => s.setReaderTheme)
  const setFocusMode = useReaderStore((s) => s.setFocusMode)
  const setTermBox = useReaderStore((s) => s.setTermBox)

  /* 进入阅读页或切换字体时，按需加载正文字体（其余字体不下载）。
     字体就绪前保持骨架，避免刷新后先系统字体后 swap 跳变 */
  const [fontReady, setFontReady] = useState(false)
  useEffect(() => {
    let alive = true
    setFontReady(false)
    /* 字体失败不阻塞正文渲染：catch 后照样放行（回退系统字体栈） */
    void loadFontFamily(settings.fontFamily)
      .catch(() => {})
      .then(() => {
        if (alive) setFontReady(true)
      })
    return () => {
      alive = false
    }
  }, [settings.fontFamily])

  const annotationsVisible = useAnnotationStore((s) => s.visible)
  const setAnnotationsVisible = useAnnotationStore((s) => s.setVisible)
  const removeAnnotation = useAnnotationStore((s) => s.remove)

  const theme = useThemeStore((s) => s.theme)
  const autoDark = useThemeStore((s) => s.autoDark)
  const setTheme = useThemeStore((s) => s.setTheme)
  const prefersDark = usePrefersDark()

  const bodyRef = useRef<HTMLDivElement>(null)
  useFocusMode(bodyRef, settings.focusMode, contentReady && fontReady)
  const [percent, setPercent] = useState(0)
  /** 窄屏（≤500px）：弹层固定在屏幕底部 */
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 900)
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const lastSavedRef = useRef(0)
  const saveTimerRef = useRef<number>(0)

  const starts = useMemo(() => (article?.content ? paragraphStarts(article.content) : []), [article])
  const progress = article ? getProgress(article.id) : undefined

  /* 划词选择 / 标注弹层 / 笔记编辑交互（拆分至 useAnnotationPopover） */
  const {
    popoverRef,
    annPopoverRef,
    popover,
    annPopover,
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
  } = useAnnotationPopover(articleId, article, starts, bodyRef)
  /* 划词存入规范词库（成功后按钮短暂变 ✓） */
  const [termSaved, setTermSaved] = useState<'idle' | 'ok' | 'dup'>('idle')
  const saveSelectionAsTerm = async () => {
    if (!popover) return
    const term = popover.text.trim().replace(/\s+/g, '')
    if (!term || term.length > 20) {
      alert('请选中 20 字以内的词语')
      return
    }
    if (hasTermCached(term)) {
      setTermSaved('dup')
      window.setTimeout(() => setTermSaved('idle'), 1500)
      return
    }
    try {
      await addTerm({ theme: '综合其他', term })
      setTermSaved('ok')
      window.setTimeout(() => setTermSaved('idle'), 1500)
    } catch (e) {
      alert(String(e))
    }
  }
  const displayAnnotations = annotationsVisible ? articleAnnotations : []

  /* 实测阅读时长（拆分至 useReadingTimer） */
  const { sessionSec } = useReadingTimer(articleId)

  /* ---------- 主题（阅读页可覆盖页面主题） ---------- */
  const pageTheme = resolveTheme(theme, autoDark, prefersDark)
  const activeTheme = settings.readerTheme || pageTheme
  /* 阅读页切换主题 = 全局切换（清除阅读页单独覆盖，整体生效） */
  const cycleTheme = () => {
    const idx = THEMES.findIndex((t) => t.name === activeTheme)
    setTheme(THEMES[(idx + 1) % THEMES.length].name)
    setReaderTheme('')
  }
  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme
    return () => {
      document.documentElement.dataset.theme = pageTheme
    }
  }, [activeTheme, pageTheme])  /* ---------- 阅读器 CSS 变量 ---------- */
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

  // 滚动监听：不依赖文章数据就绪，进入页面即注册（进度保存只用到 articleId）
  useEffect(() => {
    const onScroll = () =>
      requestAnimationFrame(() => {
        computePercent()
      })
    window.addEventListener('scroll', onScroll, { passive: true })
    const flush = () => {
      saveProgress(articleId, percentRef.current, window.scrollY)
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
  }, [articleId, computePercent])

  // 打开文章记录 + 恢复阅读位置：等文章数据与水合就绪
  useEffect(() => {
    if (!article || !storeHydrated) return
    startReading(article.id)
    const p = getProgress(article.id)
    if (p && p.lastPosition > 0) {
      requestAnimationFrame(() => window.scrollTo({ top: p.lastPosition, behavior: 'instant' }))
    } else {
      /* 新文章（如「下一篇」进入）：回到顶部 */
      window.scrollTo(0, 0)
    }
    setPercent(p?.percent ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, article, storeHydrated])

  const percentRef = useRef(percent)
  useEffect(() => {
    percentRef.current = percent
  }, [percent])

  /* 正文拉取失败（本地服务不可用 / 文章不存在）：错误态，而不是无限骨架 */
  if (loadError) {
    return (
      <section className="reading-page">
        <main className="reading-layout">
          <article>
            <header className="article-head">
              <div className="tag">READBOOK / ERROR</div>
              <h1>正文暂时无法加载</h1>
              <p className="dek">本地 API 服务可能没有启动，或该文章不存在。服务恢复后可重试。</p>
            </header>
            <div className="empty-state">
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="ghost" onClick={() => window.location.reload()}>
                  重试
                </button>
                <Link className="ghost" to="/library">
                  返回文库
                </Link>
              </div>
            </div>
          </article>
        </main>
      </section>
    )
  }

  // 正文或字体未就绪：骨架占位（meta 已就绪则渲染标题，正文/字体异步就绪）
  if (!article?.content || !contentReady || !fontReady) {
    return (
      <section className="reading-page">
        <main className="reading-layout">
          <article>
            <header className="article-head">
              <div className="tag">
                {article ? `${article.source} · ${article.topic}　/　${formatDate(article.date)}` : 'READBOOK'}
              </div>
              <h1>{article?.title ?? '加载文章…'}</h1>
              {article?.summary && <p className="dek">{article.summary}</p>}
            </header>
            <div className="article-body reading-loading" aria-hidden="true">
              {/* 段落式占位：每段 2~3 行、首行缩进、末行收窄（样式见 reading.css） */}
              {[3, 2, 3, 2].map((lines, gi) => (
                <div className="skeleton-para" key={gi}>
                  {Array.from({ length: lines }).map((_, i) => (
                    <span
                      key={i}
                      className={`skeleton-line${i === 0 ? ' first' : ''}${i === lines - 1 ? ' last' : ''}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </article>
        </main>
      </section>
    )
  }

  const p = progress
  const isFavorite = p?.favorite ?? false

  return (
    <section className="reading-page">
      <div className="scroll-progress" style={{ width: `${percent}%` }} />
      {/* 移动端：页面顶部固定的阅读辅助菜单 */}
      <ArticleToolsMenu
        fontSize={settings.fontSize}
        onFontSize={setFontSize}
        fontFamily={settings.fontFamily}
        onFontFamily={setFontFamily}
        themeLabel={THEMES.find((t) => t.name === activeTheme)?.label ?? '跟随页面'}
        onCycleTheme={cycleTheme}
        favorite={isFavorite}
        onToggleFavorite={() => toggleFavorite(article.id)}
        annotationsVisible={annotationsVisible}
        onToggleAnnotations={() => setAnnotationsVisible(!annotationsVisible)}
        focusMode={settings.focusMode}
        onToggleFocus={() => setFocusMode(!settings.focusMode)}
      />
      <main className={`reading-layout${settings.measure === 'narrow' ? ' narrow-measure' : ''}`}>
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
            {(prevArticle || nextArticle) && (
              <nav className="article-pager-top" aria-label="相邻文章">
                {prevArticle ? (
                  <Link to={`/reading/${prevArticle.id}`}>←　上一篇</Link>
                ) : (
                  <span aria-hidden="true" />
                )}
                {nextArticle ? (
                  <Link to={`/reading/${nextArticle.id}`}>下一篇　→</Link>
                ) : (
                  <span aria-hidden="true" />
                )}
              </nav>
            )}
          </header>

          <div
            className={`article-body${settings.focusMode ? ' focus-mode' : ''}${settings.indent ? '' : ' no-indent'}`}
            ref={bodyRef}
            style={bodyStyle}
          >
            {article.content.map((text, i) => {
              const paraStart = starts[i]
              const segments = splitParagraph(text, paraStart, displayAnnotations)
              const hasPending = pendingNote && paraStart <= pendingNote.start && pendingNote.start < paraStart + text.length
              const openNotes = displayAnnotations.filter((a) => a.kind === 'note' && noteParaIndex[a.id] === i)
              return (
                <Fragment key={i}>
                  <p data-para={i}>
                    {segments.map((seg, j) => {
                      if (seg.annotations.length === 0) return <TermText key={j} text={seg.text} />
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
                            <button
                              type="button"
                              className="note-star"
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleSegmentNotes(seg.annotations.filter((a) => a.kind === 'note').map((a) => a.id))
                              }}
                              title="展开/收起笔记"
                              aria-label="展开/收起笔记"
                            >
                              ✦
                            </button>
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
              className={`selection-popover${popover ? ' show' : ''}${popover?.below ? ' below' : ''}`}
              ref={popoverRef}
              style={popover && !isNarrow ? { left: popover.x, top: popover.y } : undefined}
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
              <button
                onClick={() => {
                  if (termSaved === 'idle') void saveSelectionAsTerm()
                }}
                title="把选中词存入规范词库"
              >
                <BookPlus size={12} />
                {termSaved === 'ok' ? '已入词库' : termSaved === 'dup' ? '已在词库' : '存规范词'}
              </button>
            </div>

            {/* 标注管理（点击高亮/划线后出现） */}
            <div
              className={`selection-popover ann-popover${annPopover ? ' show' : ''}${annPopover?.below ? ' below' : ''}`}
              ref={annPopoverRef}
              style={annPopover && !isNarrow ? { left: annPopover.x, top: annPopover.y } : undefined}
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

          {/* 文末相邻篇目：按文库排序取前后一篇 */}
          {(prevArticle || nextArticle) && (
            <nav className="article-pager" aria-label="相邻文章">
              {prevArticle ? (
                <Link className="pager-item prev" to={`/reading/${prevArticle.id}`}>
                  <small>←　上一篇</small>
                  <span>{prevArticle.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {nextArticle ? (
                <Link className="pager-item next" to={`/reading/${nextArticle.id}`}>
                  <small>下一篇　↗</small>
                  <span>{nextArticle.title}</span>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </article>

        <ReaderToolsPanel
          settings={settings}
          onFontSizeDelta={(delta) => setFontSize(settings.fontSize + delta)}
          onFontFamily={setFontFamily}
          activeTheme={activeTheme}
          onCycleTheme={() => {
            const idx = THEMES.findIndex((t) => t.name === activeTheme)
            // 阅读页切换主题 = 全局切换（清除阅读页单独覆盖，整体生效）
            setTheme(THEMES[(idx + 1) % THEMES.length].name)
            setReaderTheme('')
          }}
          favorite={isFavorite}
          onToggleFavorite={() => toggleFavorite(article.id)}
          annotationsVisible={annotationsVisible}
          onToggleAnnotations={() => setAnnotationsVisible(!annotationsVisible)}
          onToggleFocus={() => setFocusMode(!settings.focusMode)}
          onToggleTermBox={() => setTermBox(!settings.termBox)}
        />
      </main>
    </section>
  )
}
