import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { Highlighter, StickyNote, Underline as UnderlineIcon, BookPlus } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { addTerm } from '../lib/api'
import { alertDialog } from '../components/ui/ConfirmDialog'
import { useAnnotationStore } from '../stores/annotationStore'
import { useThemeStore, THEMES, resolveTheme } from '../stores/themeStore'
import { ArticleToolsMenu } from '../components/ui/ArticleToolsMenu'
import { ReaderToolsPanel } from '../components/reading/ReaderToolsPanel'
import { TermText, hasTermCached } from '../components/reading/TermHighlight'
import { useFocusMode } from '../lib/useFocusMode'
import { useReadingTimer } from '../hooks/useReadingTimer'
import { useCycleTheme } from '../hooks/useCycleTheme'
import { useIsNarrow } from '../lib/breakpoints'
import { useHoverPrefetch } from '../lib/hoverPrefetch'
import { useAnnotationPopover } from '../hooks/useAnnotationPopover'
import { ShenlunPanel } from '../components/ShenlunPanel'
import { ParaGist, PatternInput } from '../components/reading/ParaGist'
import { useShenlunStore, type StudyStatus } from '../stores/shenlunStore'
import { useAiStore, isAiConfigured } from '../stores/aiStore'
import { draftParaGist } from '../lib/aiPresplit'
import { paragraphStarts, splitParagraph } from '../lib/offsets'
import { loadFontFamily } from '../lib/fonts'
import { formatDate } from '../data'
import { formatTimeOnly } from '../lib/export'
import { HL_COLORS, HL_COLOR_LABELS, UNDERLINE_STYLES, UNDERLINE_STYLE_LABELS } from '../types'
import { MATERIAL_TYPES, MATERIAL_TYPE_LABELS, MATERIAL_TYPE_HINTS } from '../data/material'

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

/** 拆解上屏开关（按文章）持久化到 localStorage；存储异常时静默退化为内存态 */
const STUDY_INLINE_KEY = 'readbook:studyInline'
function readStudyInline(articleId: string): boolean {
  try {
    return localStorage.getItem(`${STUDY_INLINE_KEY}:${articleId}`) === '1'
  } catch {
    return false
  }
}
function writeStudyInline(articleId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(`${STUDY_INLINE_KEY}:${articleId}`, '1')
    else localStorage.removeItem(`${STUDY_INLINE_KEY}:${articleId}`)
  } catch {
    /* 存储不可用（隐私模式等）：仅当前会话生效 */
  }
}

export function ReadingPage() {
  const { articleId = '' } = useParams()
  const [searchParams] = useSearchParams()
  /** 从摘录页「打开原文」跳入：?ann=<标注id>，就绪后滚动到所在段落并短暂闪烁 */
  const annAnchorId = searchParams.get('ann')

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

  /** 悬停预取相邻篇正文：读完一篇点「下一篇」时正文多半已在缓存 */
  const hoverWarm = useHoverPrefetch()

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
  const updateAnnotation = useAnnotationStore((s) => s.update)

  /* 申论拆解 / 范文精读抽屉 */
  const [shenlunOpen, setShenlunOpen] = useState(false)
  /* 拆解上屏：把拆解成果（全篇卡 + 每段大意 + 心得）内嵌到正文（打开抽屉时自动开启，可手动关）。
     按文章持久化到 localStorage——否则刷新/切回后复位 OFF，用户视角就是"点了 ON 没生效" */
  const [studyInlineFor, setStudyInlineFor] = useState(articleId)
  const [studyInline, setStudyInline] = useState(() => readStudyInline(articleId))
  if (studyInlineFor !== articleId) {
    /* 切文章：先把旧篇的开关写回，再载入新篇的开关（render 期调整，避免 effect 顺序竞态覆盖存值） */
    writeStudyInline(studyInlineFor, studyInline)
    setStudyInlineFor(articleId)
    setStudyInline(readStudyInline(articleId))
  }
  const toggleStudyInline = useCallback(() => {
    const next = !studyInline
    writeStudyInline(articleId, next)
    setStudyInline(next)
    if (next) {
      /* 拆解卡渲染在正文最顶部：用户在页面中部点 ON 时视口内毫无变化，像"没反应"，故滚回顶部 */
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    }
  }, [articleId, studyInline])
  const openShenlun = useCallback(() => {
    setShenlunOpen(true)
    setStudyInline((v) => {
      if (v) return v
      writeStudyInline(articleId, true)
      return true
    })
  }, [articleId])
  const shenlunStudy = useShenlunStore((s) => s.study[articleId])
  const shenlunStatus: StudyStatus = shenlunStudy?.status ?? 'new'
  const shenlunSummaryByPara = useMemo(
    () => new Map((shenlunStudy?.paragraphSummaries ?? []).map((s) => [s.paraIndex, s] as const)),
    [shenlunStudy],
  )
  const setParagraphSummary = useShenlunStore((s) => s.setParagraphSummary)
  /* 正文里正在就地编辑大意（strip 编辑器）的段落序号 */
  const [editingGistPara, setEditingGistPara] = useState<number | null>(null)
  /* 「AI 起草」：单段大意生成中 / 未配置 AI 时按钮置灰 */
  const aiConfigured = useAiStore((s) => isAiConfigured(s.settings))
  const [aiBusyPara, setAiBusyPara] = useState<number | null>(null)
  const draftGistWithAi = useCallback(
    async (paraIndex: number): Promise<string | null> => {
      if (!article || aiBusyPara !== null) return null
      setAiBusyPara(paraIndex)
      try {
        const text = await draftParaGist(article.title, article.content?.[paraIndex] ?? '')
        if (text) setParagraphSummary(articleId, paraIndex, text, { origin: 'ai' })
        return text || null
      } catch (err) {
        void alertDialog(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setAiBusyPara(null)
      }
    },
    [article, articleId, aiBusyPara, setParagraphSummary],
  )
  /* 全篇层面的拆解内容（观点/分论点/骨架）有任意一项非空——只有段意时全篇卡不渲染 */
  const hasOverviewData = Boolean(
    (shenlunStudy?.coreThesis ?? '').trim() ||
      (shenlunStudy?.subTheses?.length ?? 0) > 0 ||
      (shenlunStudy?.skeleton &&
        ((shenlunStudy.skeleton.opening ?? '').trim() ||
          (shenlunStudy.skeleton.bodyLayers ?? []).some((s) => s.trim()) ||
          (shenlunStudy.skeleton.transitions ?? []).some((s) => s.trim()) ||
          (shenlunStudy.skeleton.closing ?? '').trim())),
  )
  const hasStudyData = Boolean(
    shenlunStudy &&
      ((shenlunStudy.paragraphSummaries?.length ?? 0) > 0 ||
        (shenlunStudy.coreThesis ?? '').trim() ||
        (shenlunStudy.subTheses?.length ?? 0) > 0 ||
        (shenlunStudy.skeleton &&
          ((shenlunStudy.skeleton.opening ?? '').trim() ||
            (shenlunStudy.skeleton.bodyLayers ?? []).some((s) => s.trim()) ||
            (shenlunStudy.skeleton.transitions ?? []).some((s) => s.trim()) ||
            (shenlunStudy.skeleton.closing ?? '').trim())) ||
        (shenlunStudy.reviewNote ?? '').trim()),
  )
  const allAnnotations = useAnnotationStore((s) => s.annotations)
  const shenlunMaterialCount = useMemo(
    () =>
      allAnnotations.filter(
        (a) => a.articleId === articleId && a.kind === 'highlight' && a.materialType,
      ).length,
    [allAnnotations, articleId],
  )
  const scrollToPara = useCallback((paraIndex: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-para="${paraIndex}"]`)
    if (!el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'smooth' })
    /* 短文可能已滚到底、段落到不了视口顶部，闪烁提示目标段，避免"点了没反应" */
    el.classList.add('para-flash')
    window.setTimeout(() => el.classList.remove('para-flash'), 2200)
  }, [])
  const scrollToAnnotation = useCallback((annId: string) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-ann-ids*="${annId}"]`)
    if (!el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' })
    el.classList.add('ann-flash')
    window.setTimeout(() => el.classList.remove('ann-flash'), 2200)
  }, [])

  const bodyRef = useRef<HTMLDivElement>(null)
  useFocusMode(bodyRef, settings.focusMode, contentReady && fontReady)
  /* 窄屏（≤900px）：弹层固定在屏幕底部（matchMedia 驱动，免 resize 抖动） */
  const isNarrow = useIsNarrow()
  /* 进度条直接改 DOM 宽度：滚动每帧 setState 会整页重渲染（正文重新切分 + 词库匹配） */
  const progressBarRef = useRef<HTMLDivElement>(null)
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
    applyMaterial,
    addMaterialToAnn,
    removeMaterialFromAnn,
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
  const displayAnnotations = annotationsVisible ? articleAnnotations : []

  /* 段落切分与标注匹配只在正文/标注变化时重算一次：
     滚动、弹层、笔记编辑等高频 state 变化不再触发全正文 O(段落数×标注数) 重算 */
  const allSegments = useMemo(
    () =>
      (article?.content ?? []).map((text, i) => splitParagraph(text, starts[i] ?? 0, displayAnnotations)),
    [article, starts, displayAnnotations],
  )
  /** 段落 index → 该段的笔记标注（渲染行内笔记用，免去每段每次渲染全量 filter） */
  const notesByPara = useMemo(() => {
    const map = new Map<number, typeof displayAnnotations>()
    for (const a of displayAnnotations) {
      if (a.kind !== 'note') continue
      const idx = noteParaIndex[a.id]
      if (idx === undefined) continue
      const list = map.get(idx)
      if (list) list.push(a)
      else map.set(idx, [a])
    }
    return map
  }, [displayAnnotations, noteParaIndex])

  /* 实测阅读时长（拆分至 useReadingTimer） */
  const { sessionSec } = useReadingTimer(articleId)

  /* ---------- 主题（阅读页可覆盖页面主题） ---------- */
  const [activeTheme, cycleTheme] = useCycleTheme()
  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme
    return () => {
      /* 卸载时取最新 store 状态恢复（避免用过期闭包里的主题覆盖用户中途的切换） */
      const st = useThemeStore.getState()
      document.documentElement.dataset.theme = resolveTheme(st.theme, st.autoDark, window.matchMedia('(prefers-color-scheme: dark)').matches)
    }
  }, [activeTheme])

  /* ---------- 阅读器 CSS 变量 ---------- */
  const bodyStyle = useMemo<CSSProperties>(
    () => ({
      '--reader-font-size': `${settings.fontSize}px`,
      '--reader-line-height': String(settings.lineHeight),
      '--reader-font-family': fontFamilyCss(settings.fontFamily),
      '--gist-font-size': `${settings.gistFontSize}px`,
      '--gist-font-family':
        settings.gistFontFamily === 'sans'
          ? "'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif"
          : fontFamilyCss(settings.fontFamily),
    }) as CSSProperties,
    [settings.fontSize, settings.lineHeight, settings.fontFamily, settings.gistFontSize, settings.gistFontFamily],
  )

  /* ---------- 进度 ---------- */
  const computePercent = useCallback(() => {
    // 与设计稿一致：按整页滚动计算（短文章也能正确归 100%）
    const max = document.documentElement.scrollHeight - window.innerHeight
    if (max <= 0) return
    const pct = Math.min(100, Math.max(0, (window.scrollY / max) * 100))
    // 进度条直接写 DOM：避免每帧 setState 触发整篇正文重渲染
    if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`
    // 记录视口顶部附近（贴顶 100px 内）最后出现的段落：恢复时按段锚点定位
    let lastPara: number | undefined
    const paras = bodyRef.current?.querySelectorAll<HTMLElement>('[data-para]')
    if (paras) {
      paras.forEach((el) => {
        if (el.getBoundingClientRect().top <= 100) lastPara = Number(el.dataset.para)
      })
    }
    const now = Date.now()
    // 节流：至少每 1.5s 保存一次
    if (now - lastSavedRef.current > 1500) {
      lastSavedRef.current = now
      saveProgress(articleId, pct, window.scrollY, lastPara)
    }
    // 尾部保存：滚动停止 400ms 后补一次，确保最后位置落盘
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      lastSavedRef.current = Date.now()
      saveProgress(articleId, pct, window.scrollY, lastPara)
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

  /* 待执行的阅读位置恢复（等正文 + 字体就绪后执行，见下方 effect） */
  const pendingRestoreRef = useRef<{ para?: number; y: number } | null>(null)

  // 打开文章记录：记录进度，实际滚动推迟到正文渲染后（否则骨架期滚不到目标）
  useEffect(() => {
    if (!article || !storeHydrated) return
    startReading(article.id)
    const p = getProgress(article.id)
    if (annAnchorId && articleAnnotations.some((a) => a.id === annAnchorId)) {
      /* 摘录定位优先于进度恢复 */
      pendingRestoreRef.current = null
    } else if (p && (p.lastPara != null || p.lastPosition > 0)) {
      pendingRestoreRef.current = { para: p.lastPara, y: p.lastPosition }
    } else {
      /* 新文章（如「下一篇」进入）：回到顶部 */
      window.scrollTo(0, 0)
    }
    percentRef.current = p?.percent ?? 0
    if (progressBarRef.current) progressBarRef.current.style.width = `${percentRef.current}%`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, article, storeHydrated, annAnchorId])

  /* 正文 + 字体就绪后执行位置恢复 / 摘录定位。
     按段落锚点恢复：字号、行距、设备不同导致的布局差异不会让位置跑偏 */
  useEffect(() => {
    if (!contentReady || !fontReady || !article) return
    if (annAnchorId) {
      const ann = articleAnnotations.find((a) => a.id === annAnchorId)
      if (ann && ann.start >= 0) {
        const idx = starts.findIndex((s, i) => ann.start >= s && ann.start < s + article.content![i].length)
        const paraEl = idx >= 0 ? bodyRef.current?.querySelector<HTMLElement>(`[data-para="${idx}"]`) : undefined
        if (paraEl) {
          requestAnimationFrame(() => {
            window.scrollTo({ top: paraEl.getBoundingClientRect().top + window.scrollY - 16, behavior: 'instant' })
            const mark = bodyRef.current?.querySelector(`[data-ann-ids*="${annAnchorId}"]`)
            mark?.classList.add('ann-flash')
            window.setTimeout(() => mark?.classList.remove('ann-flash'), 2200)
          })
          return
        }
      }
    }
    const pr = pendingRestoreRef.current
    if (!pr) return
    pendingRestoreRef.current = null
    requestAnimationFrame(() => {
      if (pr.para != null) {
        const el = bodyRef.current?.querySelector<HTMLElement>(`[data-para="${pr.para}"]`)
        if (el) {
          window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'instant' })
          return
        }
      }
      if (pr.y > 0) window.scrollTo({ top: pr.y, behavior: 'instant' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentReady, fontReady, annAnchorId])

  const percentRef = useRef(0)

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
            {/* 等待期不放占位动画：文章头先行呈现，正文就绪后随 .fade-in 浮现 */}
            <div className="article-body article-body-pending" aria-hidden="true" />
          </article>
        </main>
      </section>
    )
  }

  const p = progress
  const isFavorite = p?.favorite ?? false

  return (
    <section className="reading-page">
      <div ref={progressBarRef} className="scroll-progress" />
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
        onOpenShenlun={openShenlun}
      />
      <main className={`reading-layout fade-in${settings.measure === 'narrow' ? ' narrow-measure' : ''}`}>
        <article data-study-inline={studyInline ? 'on' : undefined}>
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
                  <Link to={`/reading/${prevArticle.id}`} {...hoverWarm(() => void ensureContent(prevArticle.id))}>←　上一篇</Link>
                ) : (
                  <span aria-hidden="true" />
                )}
                {nextArticle ? (
                  <Link to={`/reading/${nextArticle.id}`} {...hoverWarm(() => void ensureContent(nextArticle.id))}>下一篇　→</Link>
                ) : (
                  <span aria-hidden="true" />
                )}
              </nav>
            )}
          </header>

          {/* 拆解上屏：全篇拆解卡（核心观点 / 分论点 / 结构骨架）——有全篇层面内容才渲染，纯段意时只显示段意条 */}
          {studyInline && hasOverviewData && (
            <aside className="study-overview" aria-label="全篇拆解">
              <div className="study-overview-head">
                <span className="study-overview-title">拆解 · 全篇</span>
                <button className="study-collapse" onClick={() => {
                  writeStudyInline(articleId, false)
                  setStudyInline(false)
                }} aria-label="收起拆解上屏">
                  收起
                </button>
              </div>
              {(shenlunStudy?.coreThesis ?? '').trim() && (
                <p className="study-thesis" style={{ marginTop: 8 }}>{shenlunStudy!.coreThesis}</p>
              )}
              {(shenlunStudy?.subTheses?.length ?? 0) > 0 && (
                <ol className="study-subs">
                  {shenlunStudy!.subTheses.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ol>
              )}
              {(shenlunStudy?.skeleton && (
                ((shenlunStudy.skeleton.opening ?? '').trim() ||
                  (shenlunStudy.skeleton.bodyLayers ?? []).some((s) => s.trim()) ||
                  (shenlunStudy.skeleton.transitions ?? []).some((s) => s.trim()) ||
                  (shenlunStudy.skeleton.closing ?? '').trim())
              )) && (
                <details className="study-skeleton-details">
                  <summary>结构骨架</summary>
                  <div className="study-skeleton">
                    {(shenlunStudy!.skeleton!.opening ?? '').trim() && <p><b>开头</b>{shenlunStudy!.skeleton!.opening}</p>}
                    {(shenlunStudy!.skeleton!.bodyLayers ?? []).filter((s) => s.trim()).map((l, i) => (
                      <p key={i}><b>层次{i + 1}</b>{l}</p>
                    ))}
                    {(shenlunStudy!.skeleton!.transitions ?? []).filter((s) => s.trim()).length > 0 && (
                      <p><b>过渡</b>{shenlunStudy!.skeleton!.transitions!.filter((s) => s.trim()).join(' / ')}</p>
                    )}
                    {(shenlunStudy!.skeleton!.closing ?? '').trim() && <p><b>收尾</b>{shenlunStudy!.skeleton!.closing}</p>}
                  </div>
                </details>
              )}
            </aside>
          )}

          {/* 拆解上屏：没有拆解数据时不渲染任何内容（面板开关在无数据时为置灰，不会误开） */}

          <div
            className={`article-body${settings.focusMode ? ' focus-mode' : ''}${settings.indent ? '' : ' no-indent'}`}
            ref={bodyRef}
            style={bodyStyle}
          >
            {article.content.map((text, i) => {
              const paraStart = starts[i]
              const segments = allSegments[i] ?? splitParagraph(text, paraStart, displayAnnotations)
              const hasPending = pendingNote && paraStart <= pendingNote.start && pendingNote.start < paraStart + text.length
              const openNotes = notesByPara.get(i) ?? []
              return (
                <Fragment key={i}>
                  <p data-para={i}>
                    {studyInline && (
                      <button
                        className={`para-num${shenlunSummaryByPara.get(i) ? ' has-gist' : ''}${editingGistPara === i ? ' editing' : ''}`}
                        title={shenlunSummaryByPara.get(i) ? '查看/编辑本段大意' : '写本段大意'}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setEditingGistPara(editingGistPara === i ? null : i)}
                      >
                        {i + 1}
                      </button>
                    )}
                    {segments.map((seg, j) => {
                      if (seg.annotations.length === 0) return <TermText key={j} text={seg.text} />
                      const note = seg.annotations.find((a) => a.kind === 'note')
                      const anns = seg.annotations.filter((a) => a.kind !== 'note')
                      const mat = anns.find((a) => a.kind === 'highlight' && a.materialType)?.materialType
                      const cls = [
                        note ? 'note-mark' : '',
                        ...anns.map((a) =>
                          a.kind === 'highlight'
                            ? `highlighted hl-${a.color ?? 'yellow'}`
                            : `underlined${a.underlineStyle && a.underlineStyle !== 'solid' ? ` ul-${a.underlineStyle}` : ''}`,
                        ),
                        mat ? `mat-${mat}` : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <span className="note-wrap" key={j}>
                          <span
                            className={cls}
                            role="button"
                            tabIndex={0}
                            data-ann-ids={seg.annotations.map((a) => a.id).join(',')}
                            data-mat-label={mat ? MATERIAL_TYPE_LABELS[mat] : undefined}
                            onClick={showAnnActions}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                showAnnActions(e as unknown as React.MouseEvent<HTMLSpanElement>)
                              }
                            }}
                            title="点击管理标注（回车亦可）"
                            aria-label="管理标注"
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

                  {studyInline && (
                    <ParaGist
                      paraIndex={i}
                      entry={shenlunSummaryByPara.get(i)}
                      editing={editingGistPara === i}
                      onToggle={() => setEditingGistPara(editingGistPara === i ? null : i)}
                      onSave={(text) => setParagraphSummary(articleId, i, text)}
                      onAiDraft={() => draftGistWithAi(i)}
                      aiBusy={aiBusyPara === i}
                      aiReady={aiConfigured}
                    />
                  )}

                  {hasPending && (
                    <div className="note-form show">
                      <textarea
                        placeholder="写下你的想法…（Esc 取消）"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setPendingNote(null)}
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
                </Fragment>
              )
            })}

            {article.pullquote && (
              <blockquote className="pullquote">“{article.pullquote}”</blockquote>
            )}

            {/* 选择弹出工具栏（位于 article-body 内，坐标相对正文）— 分两行：标注行 + 素材/动作行，避免 17 个按钮挤一行 */}
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
                    <button key={t} className={`mat-btn mat-btn-${t}`} onClick={() => applyMaterial(t)} title={MATERIAL_TYPE_HINTS[t]}>
                      {MATERIAL_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => {
                  if (termSaved === 'idle') void saveSelectionAsTerm()
                }}
                title="把选中词存入规范词库"
              >
                <BookPlus size={12} />
                {termSaved === 'ok' ? '已入词库' : termSaved === 'dup' ? '已在词库' : termSaved === 'busy' ? '存入中…' : '存规范词'}
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
                <div className="mat-row ann-mat-row">
                  <span className="ann-mat-label">素材</span>
                  {MATERIAL_TYPES.map((t) => {
                    const cur = annPopoverFirst('highlight')?.materialType
                    return (
                      <button
                        key={t}
                        className={`mat-btn mat-btn-${t}${cur === t ? ' active' : ''}`}
                        onClick={() => (cur === t ? removeMaterialFromAnn() : addMaterialToAnn(t))}
                        title={cur === t ? `取消「${MATERIAL_TYPE_LABELS[t]}」标记` : `标记为${MATERIAL_TYPE_LABELS[t]} · ${MATERIAL_TYPE_HINTS[t]}`}
                      >
                        {MATERIAL_TYPE_LABELS[t]}
                      </button>
                    )
                  })}
                </div>
              )}
              {annPopover && annPopoverFirst('highlight')?.materialType === 'pattern' && (
                <PatternInput
                  value={annPopoverFirst('highlight')?.pattern ?? ''}
                  onSave={(v) => {
                    const a = annPopoverFirst('highlight')
                    if (a) updateAnnotation(a.id, { pattern: v || undefined })
                  }}
                />
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

          {/* 拆解上屏：学习心得放文末 */}
          {studyInline && shenlunStudy?.reviewNote && (
            <aside className="study-note-block" aria-label="学习心得">
              <span className="study-overview-title">心得</span>
              <p>{shenlunStudy.reviewNote}</p>
            </aside>
          )}

          {/* 文末相邻篇目：按文库排序取前后一篇 */}
          {(prevArticle || nextArticle) && (
            <nav className="article-pager" aria-label="相邻文章">
              {prevArticle ? (
                <Link className="pager-item prev" to={`/reading/${prevArticle.id}`} {...hoverWarm(() => void ensureContent(prevArticle.id))}>
                  <small>←　上一篇</small>
                  <span>{prevArticle.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {nextArticle ? (
                <Link className="pager-item next" to={`/reading/${nextArticle.id}`} {...hoverWarm(() => void ensureContent(nextArticle.id))}>
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
          onCycleTheme={cycleTheme}
          favorite={isFavorite}
          onToggleFavorite={() => toggleFavorite(article.id)}
          annotationsVisible={annotationsVisible}
          onToggleAnnotations={() => setAnnotationsVisible(!annotationsVisible)}
          onToggleFocus={() => setFocusMode(!settings.focusMode)}
          onToggleTermBox={() => setTermBox(!settings.termBox)}
          shenlunStatus={shenlunStatus === 'new' ? '拆解' : shenlunStatus === 'learning' ? '学习中' : '已掌握'}
          shenlunMaterialCount={shenlunMaterialCount}
          onOpenShenlun={openShenlun}
          studyInline={studyInline}
          hasStudyData={hasStudyData}
          onToggleStudyInline={toggleStudyInline}
        />
      </main>

      {shenlunOpen && article && (
        <ShenlunPanel
          article={article}
          onClose={() => setShenlunOpen(false)}
          scrollToPara={scrollToPara}
          scrollToAnnotation={scrollToAnnotation}
        />
      )}
    </section>
  )
}
