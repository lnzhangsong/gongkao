import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { fetchShenlunBook, type BookBlock, type BookUnit, type ShenlunBook } from '../lib/api'
import { ApiLoading } from '../components/ui/ApiLoading'
import { ReaderToolsPanel } from '../components/reading/ReaderToolsPanel'
import { SelectionPopover } from '../components/reading/SelectionPopover'
import { AnnPopover } from '../components/reading/AnnPopover'
import { InlineNoteBlock } from '../components/reading/InlineNoteBlock'
import { TermText } from '../components/reading/TermHighlight'
import { useAnnotationPopover } from '../hooks/useAnnotationPopover'
import { paragraphStarts, splitParagraph, type TextSegment } from '../lib/offsets'
import { useIsNarrow } from '../lib/breakpoints'
import { useMethodStudyStore } from '../stores/methodStudyStore'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { useCycleTheme } from '../hooks/useCycleTheme'
import { useFocusMode } from '../lib/useFocusMode'
import { loadFontFamily } from '../lib/fonts'
import { MATERIAL_TYPE_LABELS } from '../data/material'
import { bookImage } from '../data/bookImages'
/* 正文排版复用阅读页（人民日报文章）的 .article-body 体系：阅读字体/字号/行高 + 段首缩进；
   划线/批注/素材标记也复用同一套标注管线（useAnnotationPopover + SelectionPopover） */
import '../styles/reading.css'
import '../styles/method.css'

/**
 * 申论方法论（/method）：《申论写作八讲》（半月谈教育 编著）整书阅读。
 * 通用方法论按 M-2 决策走独立内容线（不往真题页/AI 页塞静态卡）：
 * 数据从 /api/shenlun-book 一次拉全量（import-shenlun-book.mjs 入库），
 * 「已读」进度存本地（methodStudyStore，readbook:method-study）。
 *
 * 版式与阅读页（人民日报文章）一致，粒度为「页」：
 * - 一页 = 讲内一个顶级小节（节/独立目/讲导读），一次只渲染一页——整讲/整书都太长；
 * - 正文容器挂 article-body + --reader-* 变量，右栏复用 ReaderToolsPanel（阅读辅助菜单）；
 * - 版心同 reading-layout（900 + 280 居中，宽屏同样加宽）。
 * - 划线/下划线/笔记/素材标记复用阅读页标注管线：每页是一个合成「文章」
 *   （articleId = book:<页首单元 id>），标注进 annotationStore，摘录页/素材库通用。
 */

const CN = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 「第一讲 重新认识申论」→「重新认识申论」（讲次导航用 mono 序号另起） */
const shortTitle = (title: string) => title.replace(/^第[〇一二三四五六七八九十]+讲\s*/, '')

/** 参考答案 / 对比分析 / 作答要求段：解析性段落给轻量标签样式 */
const paraTag = (text: string): 'answer' | 'compare' | 'require' | null => {
  if (/^参考答案[:：]?\s*$/.test(text)) return 'answer'
  if (text.startsWith('答案对比分析')) return 'compare'
  if (/^要求[:：]/.test(text)) return 'require'
  return null
}

/** 列表行：题目选项（A.）、序号步骤（1. / ① / （一））、● 条目等短行 */
const LIST_LINE = /^\s*(?:[A-E][.、]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]|●|\d{1,2}[.、）)])/
const listLine = (text: string): boolean => LIST_LINE.test(text)

const IMG_ROLE_LABEL: Record<string, string> = {
  model: '模型图',
  answer: '书内答案图',
  essay: '例文',
  figure: '书内图示',
}

/* ---------- 分页：讲内按顶级小节切页 ---------- */

interface BookPage {
  /** 页 id = 页首单元 id（hash 锚点 + 合成 articleId 用，如 l04-u04） */
  id: string
  title: string
  /** intro=讲导读 · summary=整页小结 · section=普通节/目 */
  kind: 'intro' | 'summary' | 'section'
  /** 页内单元：首个是开篇单元（其标题即页题，正文不再重复渲染标题） */
  units: BookUnit[]
}

/**
 * 把一讲的单元切成页：level-2（节）开新页，其后的 level-3（目）作为小节并入；
 * 不挂在任何节下的 level-3 各自成页；讲导语（level 1）成「导读」页。
 */
function chunkPages(units: BookUnit[]): BookPage[] {
  const pages: BookPage[] = []
  let cur: BookPage | null = null
  /** 当前页的开篇层级：只有 level-2 开的页才吸收后续 level-3 */
  let openLevel = 0
  for (const u of units) {
    if (u.level === 1) {
      if (cur) pages.push(cur)
      cur = { id: u.id, title: '导读', kind: 'intro', units: [u] }
      openLevel = 1
      continue
    }
    if (!cur || openLevel !== 2 || u.level === 2) {
      if (cur) pages.push(cur)
      cur = {
        id: u.id,
        title: u.kind === 'summary' ? '小结' : (u.title ?? ''),
        kind: u.kind === 'summary' ? 'summary' : 'section',
        units: [u],
      }
      openLevel = u.level
      continue
    }
    cur.units.push(u)
  }
  if (cur) pages.push(cur)
  return pages
}

/** 原文引用句：被页内任一 ≥60 字的更长段落包含的段落（书里摘出来逐句讲的原文） */
function quoteTexts(unit: BookUnit): Set<string> {
  const ps = unit.blocks.filter((b) => b.type === 'p').map((b) => b.text ?? '')
  const set = new Set<string>()
  for (const t of ps) {
    if (t.length < 12) continue
    if (ps.some((q) => q !== t && q.length >= 60 && q.length > t.length && q.includes(t))) set.add(t)
  }
  return set
}

/** 碎片短段运行：连续 ≥3 个短段（<70 字、非列表行、非引用句）打包成紧凑组 */
function compactRunIds(unit: BookUnit, quotes: Set<string>): Set<number> {
  const ids = new Set<number>()
  let run: number[] = []
  const flush = () => {
    if (run.length >= 3) run.forEach((i) => ids.add(i))
    run = []
  }
  unit.blocks.forEach((b, i) => {
    if (b.type === 'p' && (b.text ?? '').length < 70 && !listLine(b.text ?? '') && !quotes.has(b.text ?? '')) {
      run.push(i)
    } else {
      flush()
    }
  })
  flush()
  return ids
}

const IMG_ROLES = IMG_ROLE_LABEL

/** 单页的全部可标注段落（p/sig/center 文本，按渲染顺序扁平化） */
function pageParagraphs(units: BookUnit[]): { texts: string[]; idxOf: Map<string, number> } {
  const texts: string[] = []
  const idxOf = new Map<string, number>()
  for (const u of units) {
    u.blocks.forEach((b, bi) => {
      if (b.type === 'p' || b.type === 'sig' || b.type === 'center') {
        idxOf.set(`${u.id}:${bi}`, texts.length)
        texts.push(b.text ?? '')
      }
    })
  }
  return { texts, idxOf }
}

/** 单元渲染上下文：段落切分 + 标注交互（钩子对象整体透传，签名天然对齐） */
interface UnitCtx {
  allSegments: TextSegment[][]
  paraIdxOf: (unitId: string, blockIdx: number) => number
  pendingParaIdx: number
  notesByPara: Map<number, import('../types').Annotation[]>
  ann: ReturnType<typeof useAnnotationPopover>
  cancelNote: () => void
  removeAnnotation: (id: string) => void
}

function UnitBlocks({ unit, ctx }: { unit: BookUnit; ctx: UnitCtx }) {
  const quotes = useMemo(() => quoteTexts(unit), [unit])
  const runIds = useMemo(() => compactRunIds(unit, quotes), [unit, quotes])

  const renderTextP = (b: BookBlock, key: string | number, paraIdx: number, extraCls?: string) => {
    const text = b.text ?? ''
    const segments = ctx.allSegments[paraIdx] ?? [{ text, annotations: [] }]
    const hasPending = ctx.pendingParaIdx === paraIdx
    const openNotes = ctx.notesByPara.get(paraIdx) ?? []
    return (
      <Fragment key={key}>
        <p data-para={paraIdx} className={extraCls}>
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
                  onClick={ctx.ann.showAnnActions}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      ctx.ann.showAnnActions(e as unknown as React.MouseEvent<HTMLSpanElement>)
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
                      ctx.ann.toggleSegmentNotes(seg.annotations.filter((a) => a.kind === 'note').map((a) => a.id))
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
              placeholder="写下你的想法…（Esc 取消）"
              value={ctx.ann.noteDraft}
              onChange={(e) => ctx.ann.setNoteDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && ctx.ann.setPendingNote(null)}
              autoFocus
            />
            <div className="note-form-actions">
              <button onClick={ctx.ann.saveNote}>保存笔记</button>
              <button className="cancel" onClick={ctx.cancelNote}>
                取消
              </button>
            </div>
          </div>
        )}
        <InlineNoteBlock
          notes={openNotes}
          openNoteIds={ctx.ann.openNoteIds}
          editingNoteId={ctx.ann.editingNoteId}
          setEditingNoteId={ctx.ann.setEditingNoteId}
          noteDraft={ctx.ann.noteDraft}
          setNoteDraft={ctx.ann.setNoteDraft}
          startEditNote={ctx.ann.startEditNote}
          saveEditNote={ctx.ann.saveEditNote}
          removeAnnotation={ctx.removeAnnotation}
        />
      </Fragment>
    )
  }

  const els: ReactNode[] = []
  let i = 0
  const blocks = unit.blocks
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.type === 'p' && runIds.has(i)) {
      /* 碎片短段组：连续短段打包成紧凑容器 */
      const group: typeof blocks = []
      const start = i
      while (i < blocks.length && blocks[i].type === 'p' && runIds.has(i)) group.push(blocks[i++])
      els.push(
        <div key={`run-${start}`} className="method-run">
          {group.map((gb, gi) => {
            const paraIdx = ctx.paraIdxOf(unit.id, start + gi)
            return renderTextP(gb, gi, paraIdx)
          })}
        </div>,
      )
      continue
    }
    if (b.type === 'img') {
      const url = b.src ? bookImage(b.src) : null
      const label = IMG_ROLES[b.role ?? 'figure'] ?? '书内图示'
      els.push(
        <figure key={`img-${i}`} className={`method-fig role-${b.role ?? 'figure'}`}>
          {url ? (
            <img src={url} alt={label} loading="lazy" width={b.w ?? undefined} height={b.h ?? undefined} />
          ) : (
            <div className="method-fig-missing">（书内图示缺文件：{b.src}）</div>
          )}
          <figcaption>{label}</figcaption>
        </figure>,
      )
    } else if (b.type === 'sig' || b.type === 'center') {
      const paraIdx = ctx.paraIdxOf(unit.id, i)
      els.push(renderTextP(b, `${b.type}-${i}`, paraIdx, b.type === 'sig' ? 'method-sig' : 'method-center'))
    } else {
      const paraIdx = ctx.paraIdxOf(unit.id, i)
      const text = b.text ?? ''
      const tag = paraTag(text)
      const extraCls = tag
        ? `method-para-tag tag-${tag}`
        : quotes.has(text)
          ? 'method-quote'
          : listLine(text)
            ? 'method-li'
            : undefined
      els.push(renderTextP(b, `p-${i}`, paraIdx, extraCls))
    }
    i++
  }
  return <>{els}</>
}

/** 讲内学习进度：导语（level 1，无独立 toggle）不计入 */
const lectureProgress = (book: ShenlunBook, lecture: number, done: Record<string, string>) => {
  const units = book.units.filter((u) => u.lecture === lecture && u.level > 1)
  return { total: units.length, read: units.filter((u) => done[u.id]).length }
}

function UnitToggle({ read, onToggle }: { read: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`method-read-toggle ${read ? 'read' : ''}`}
      onClick={onToggle}
      aria-pressed={read}
      title={read ? '标记为未读' : '标记为已读'}
    >
      <Check size={13} strokeWidth={3} />
    </button>
  )
}

/** hash 解析：#lec-l04 → 讲 4 页 0；#l04-u03 → 定位到包含该单元的页 */
function selFromHash(pagesByLecture: Map<number, BookPage[]>): { l: number; p: number } {
  const h = window.location.hash
  const lec = /^#lec-l(\d{2})$/.exec(h)
  if (lec) return { l: Number(lec[1]), p: 0 }
  const unit = /^#l(\d{2})-u\d{2}$/.exec(h)
  if (unit) {
    const l = Number(unit[1])
    const pages = pagesByLecture.get(l) ?? []
    const p = pages.findIndex((pg) => pg.id === h.slice(1) || pg.units.some((u) => u.id === h.slice(1)))
    return { l, p: p >= 0 ? p : 0 }
  }
  return { l: 0, p: 0 }
}

/** hash 里的单元深链（#l04-u04），存在则初始渲染后滚过去 */
const unitFromHash = (): string | null => {
  const m = /^#(l\d{2}-u\d{2})$/.exec(window.location.hash)
  return m ? m[1] : null
}

export default function MethodPage() {
  const [book, setBook] = useState<ShenlunBook | null>(null)
  const [loadError, setLoadError] = useState(false)
  const done = useMethodStudyStore((s) => s.done)
  const toggle = useMethodStudyStore((s) => s.toggle)
  /** 当前页（讲 + 讲内页序）：一次只渲染一页；初始值来自 hash 深链，默认前言首页 */
  const [sel, setSel] = useState<{ l: number; p: number }>({ l: 0, p: 0 })
  /** 待滚动锚点：翻页后渲染完成时瞬跳过去；null = 不滚动（首次落地留在页头） */
  const pendingAnchor = useRef<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const load = () =>
    fetchShenlunBook()
      .then((b) => {
        setBook(b)
        setLoadError(false)
      })
      .catch(() => {
        setLoadError(true)
      })
  useEffect(() => {
    void load()
  }, [])

  /* 阅读设置（与阅读页/真题详情页同源）：正文字号/行高/字体走 --reader-* 变量 */
  const settings = useReaderStore((s) => s.settings)
  const setFontSize = useReaderStore((s) => s.setFontSize)
  const setFontFamily = useReaderStore((s) => s.setFontFamily)
  const setFocusMode = useReaderStore((s) => s.setFocusMode)
  const setTermBox = useReaderStore((s) => s.setTermBox)
  const [activeTheme, cycleTheme] = useCycleTheme()
  const readerVars = useMemo<CSSProperties>(
    () =>
      ({
        '--reader-font-size': `${settings.fontSize}px`,
        '--reader-line-height': String(settings.lineHeight),
        '--reader-font-family': fontFamilyCss(settings.fontFamily),
      }) as CSSProperties,
    [settings.fontSize, settings.lineHeight, settings.fontFamily],
  )
  useEffect(() => {
    void loadFontFamily(settings.fontFamily)
  }, [settings.fontFamily])

  const unitsByLecture = useMemo(() => {
    const m = new Map<number, BookUnit[]>()
    for (const u of book?.units ?? []) {
      const arr = m.get(u.lecture) ?? []
      arr.push(u)
      m.set(u.lecture, arr)
    }
    return m
  }, [book])

  const pagesByLecture = useMemo(() => {
    const m = new Map<number, BookPage[]>()
    for (const [l, units] of unitsByLecture) m.set(l, chunkPages(units))
    return m
  }, [unitsByLecture])

  const totalUnits = book?.units.filter((u) => u.level > 1).length ?? 0
  const readUnits = book ? book.units.filter((u) => u.level > 1 && done[u.id]).length : 0

  const isNarrow = useIsNarrow()

  /* 当前页（在 hooks 前派生，保证钩子参数稳定） */
  const lecture = book ? (book.lectures[sel.l] ?? book.lectures[0]) : undefined
  const pages = lecture ? (pagesByLecture.get(lecture.idx) ?? []) : []
  const page = pages[Math.min(sel.p, Math.max(pages.length - 1, 0))]
  const pageUnits = useMemo(() => page?.units ?? [], [page])
  const articleId = page ? `book:${page.id}` : 'book:loading'

  /* 划线/批注：每页是一个合成「文章」，段落偏移空间 = 页内全部文本段 */
  const { parTexts, paraIdxOf } = useMemo(() => {
    const r = pageParagraphs(pageUnits)
    return {
      parTexts: r.texts,
      paraIdxOf: (unitId: string, blockIdx: number) => r.idxOf.get(`${unitId}:${blockIdx}`) ?? 0,
    }
  }, [pageUnits])
  const starts = useMemo(() => paragraphStarts(parTexts), [parTexts])
  const article = useMemo(() => (page ? { id: articleId, content: parTexts } : undefined), [page, articleId, parTexts])
  const ann = useAnnotationPopover(articleId, article, starts, bodyRef)
  const annotationsVisible = useAnnotationStore((s) => s.visible)
  const removeAnnotation = useAnnotationStore((s) => s.remove)
  const updateAnnotation = useAnnotationStore((s) => s.update)

  const displayAnnotations = useMemo(
    () => (annotationsVisible ? ann.articleAnnotations : []),
    [annotationsVisible, ann.articleAnnotations],
  )
  const allSegments = useMemo(
    () => parTexts.map((text, i) => splitParagraph(text, starts[i] ?? 0, displayAnnotations)),
    [parTexts, starts, displayAnnotations],
  )
  const notesByPara = useMemo(() => {
    const map = new Map<number, import('../types').Annotation[]>()
    for (const a of displayAnnotations) {
      if (a.kind !== 'note') continue
      const idx = ann.noteParaIndex[a.id]
      if (idx === undefined) continue
      const list = map.get(idx)
      if (list) list.push(a)
      else map.set(idx, [a])
    }
    return map
  }, [displayAnnotations, ann.noteParaIndex])

  /* 段落聚焦：书页段落嵌在单元容器里，selector 用 'p' 匹配全部后代段落 */
  useFocusMode(bodyRef, settings.focusMode, page !== undefined, 'p')

  const pendingParaIdx = ann.pendingNote
    ? parTexts.findIndex((t, i) => starts[i] <= ann.pendingNote!.start && ann.pendingNote!.start < starts[i] + t.length)
    : -1

  const ctx: UnitCtx = {
    allSegments,
    paraIdxOf,
    pendingParaIdx,
    notesByPara,
    ann,
    cancelNote: () => ann.setPendingNote(null),
    removeAnnotation,
  }

  /* 翻页：写 hash（replaceState 不产生历史记录），渲染完成后由锚点效果瞬跳到页头 */
  const gotoPage = (l: number, p: number) => {
    const pg = pagesByLecture.get(l)?.[p]
    if (!pg) return
    pendingAnchor.current = pg.id
    history.replaceState(null, '', `#${pg.id}`)
    setSel({ l, p })
  }

  /* 渲染完成后处理待滚动锚点。behavior:'instant'：全站 scroll-behavior:smooth 的
     平滑飞行在长页上光栅跟不上，锚点必须瞬跳 */
  useEffect(() => {
    if (!book) return
    const id = pendingAnchor.current
    if (!id) return
    pendingAnchor.current = null
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }, 60)
    return () => window.clearTimeout(t)
  }, [book, sel])

  /* 书数据就绪后按 hash 定位初始页（深链 #l04-u04 / #lec-l04） */
  useEffect(() => {
    if (!book) return
    setSel(selFromHash(pagesByLecture))
    const u = unitFromHash()
    if (u) pendingAnchor.current = u
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book])

  if (loadError && !book) {
    return (
      <div className="exam-page method-page">
        <div className="api-loading">
          方法论内容加载失败（数据服务不可用）。
          <button type="button" className="link-btn" onClick={() => void load()}>
            重试
          </button>
        </div>
      </div>
    )
  }
  if (!book || !lecture || !page) {
    return (
      <div className="exam-page method-page">
        <ApiLoading label="正在加载《申论写作八讲》…" />
      </div>
    )
  }

  const { total, read } = lectureProgress(book, lecture.idx, done)
  const opener = page.units[0]

  return (
    <div className="exam-page method-page">
      <header className="subpage-header method-hero">
        <div className="method-hero-main">
          <span className="eyebrow">申论方法论 · 半月谈教育</span>
          <h1>
            写作<span>八讲</span>
          </h1>
          <p className="method-hero-meta">
            {book.author} · 2022 年版 · {totalUnits} 节 · 已读 {readUnits}
          </p>
        </div>
        <div className="method-hero-side">
          {book.cover && (
            <img className="method-cover" src={bookImage(book.cover) ?? undefined} alt={`${book.title} 封面`} />
          )}
          <p className="subpage-copy">
            练的是「方法」而非「题目」。建议先读第二讲（审题与读材料）、第三讲（四项基本训练）打底，再按题型攻第四至八讲；
            <Link to="/assist">AI 审题立意</Link>已按本书方法校准，学完就到<Link to="/exams">真题</Link>里上手练。
          </p>
        </div>
      </header>

      <div className="method-layout">
        {/* —— 正文：只渲染当前页；划线/批注/素材标记与阅读页同一套 —— */}
        <main
          ref={bodyRef}
          className={`method-reader article-body${settings.focusMode ? ' focus-mode' : ''}${
            settings.indent ? '' : ' no-indent'
          }`}
          style={readerVars}
        >
          {/* 页头 = 阅读页 article-head：tag 行 + 衬线大标题 + meta 条 */}
          <header className="article-head" id={page.id}>
            <div className="tag">
              {lecture.idx === 0 ? '半月谈教育 · 编著组　/　前言' : `半月谈教育　/　${lecture.title}`}
            </div>
            <h1>{page.title}</h1>
            <div className="article-meta">
              <span>
                {lecture.idx > 0 && `第${CN[lecture.idx] ?? lecture.idx}讲 · `}本讲进度　{read}/{total}
              </span>
              {page.kind !== 'intro' && (
                <span className="method-mark">
                  <UnitToggle read={Boolean(done[opener.id])} onToggle={() => toggle(opener.id)} />
                  {done[opener.id] ? '已读' : '标记已读'}
                </span>
              )}
            </div>
          </header>

          {page.kind === 'summary' ? (
            /* 整页小结：内容进淡染卡（页题已是「小结」，卡内不再重复 chip） */
            <div className={`method-unit method-summary ${done[page.id] ? 'read' : ''}`}>
              <div className="method-summary-body">
                {page.units.map((u) => (
                  <UnitBlocks key={u.id} unit={u} ctx={ctx} />
                ))}
              </div>
            </div>
          ) : (
            page.units.map((u, i) => {
              const isRead = Boolean(done[u.id])
              if (i === 0) {
                /* 开篇单元：标题已由页头 h1 呈现，只渲染正文 */
                return (
                  <div key={u.id} className="method-unit">
                    <UnitBlocks unit={u} ctx={ctx} />
                  </div>
                )
              }
              if (u.kind === 'summary') {
                return (
                  <div key={u.id} id={u.id} className={`method-unit method-summary ${isRead ? 'read' : ''}`}>
                    <div className="method-unit-head">
                      <span className="summary-chip">小结</span>
                      <UnitToggle read={isRead} onToggle={() => toggle(u.id)} />
                    </div>
                    <div className="method-summary-body">
                      <UnitBlocks unit={u} ctx={ctx} />
                    </div>
                  </div>
                )
              }
              return (
                <div key={u.id} id={u.id} className={`method-unit lv-${u.level} ${isRead ? 'read' : ''}`}>
                  <div className="method-unit-head">
                    <h4>{u.title}</h4>
                    <UnitToggle read={isRead} onToggle={() => toggle(u.id)} />
                  </div>
                  <UnitBlocks unit={u} ctx={ctx} />
                </div>
              )
            })
          )}
          {lecture.idx > 0 && sel.p === pages.length - 1 && (
            <div className="method-lec-end">—— 第{CN[lecture.idx] ?? lecture.idx}讲完 ——</div>
          )}

          {/* 页间翻页（跨讲连续）：阅读页相邻文章导航同款 */}
          <nav className="article-pager-top method-pager" aria-label="页间翻页">
            {sel.p > 0 || lecture.idx > 0 ? (
              <button
                type="button"
                className="method-pager-btn"
                onClick={() => {
                  if (sel.p > 0) gotoPage(lecture.idx, sel.p - 1)
                  else gotoPage(lecture.idx - 1, (pagesByLecture.get(lecture.idx - 1) ?? []).length - 1)
                }}
              >
                ←　上一页
              </button>
            ) : (
              <span aria-hidden />
            )}
            {sel.p < pages.length - 1 || lecture.idx < book.lectures.length - 1 ? (
              <button
                type="button"
                className="method-pager-btn"
                onClick={() => {
                  if (sel.p < pages.length - 1) gotoPage(lecture.idx, sel.p + 1)
                  else gotoPage(lecture.idx + 1, 0)
                }}
              >
                下一页　→
              </button>
            ) : (
              <span className="method-fin">
                全书完 · 去 <Link to="/exams">真题</Link> 里练一练
              </span>
            )}
          </nav>

          <SelectionPopover
            popover={ann.popover}
            popoverRef={ann.popoverRef}
            isNarrow={isNarrow}
            hlColor={ann.hlColor}
            ulStyle={ann.ulStyle}
            applyHighlight={ann.applyHighlight}
            applyUnderline={ann.applyUnderline}
            applyMaterial={ann.applyMaterial}
            startNote={ann.startNote}
          />

          <div
            className={`selection-popover ann-popover${ann.annPopover ? ' show' : ''}${ann.annPopover?.below ? ' below' : ''}`}
            ref={ann.annPopoverRef}
            style={ann.annPopover && !isNarrow ? { left: ann.annPopover.x, top: ann.annPopover.y } : undefined}
          >
            <AnnPopover
              annPopover={ann.annPopover}
              hasHighlight={ann.annHasHighlight}
              hasUnderline={ann.annHasUnderline}
              hasNote={ann.annHasNote}
              firstHighlight={ann.annFirstHighlight}
              firstUnderline={ann.annFirstUnderline}
              switchAnnColor={ann.switchAnnColor}
              switchAnnUnderlineStyle={ann.switchAnnUnderlineStyle}
              addKindToAnn={ann.addKindToAnn}
              addMaterialToAnn={ann.addMaterialToAnn}
              removeMaterialFromAnn={ann.removeMaterialFromAnn}
              deleteAnnKind={ann.deleteAnnKind}
              viewAnnNote={ann.viewAnnNote}
              updateAnnotation={updateAnnotation}
            />
          </div>
        </main>

        {/* —— 右栏：讲次导航（当前讲展开页列表）+ 阅读辅助 —— */}
        <aside className="method-rail">
          <nav className="method-rail-nav" aria-label="讲次导航">
            {book.lectures.map((lec) => {
              const p = lectureProgress(book, lec.idx, done)
              const isCur = sel.l === lec.idx
              return (
                <div key={lec.id} className={`method-rail-lec ${isCur ? 'active' : ''}`}>
                  <button
                    type="button"
                    className={`method-rail-item ${isCur ? 'current' : ''}`}
                    aria-current={isCur ? 'page' : undefined}
                    onClick={() => gotoPage(lec.idx, 0)}
                  >
                    <span className="rail-no">{String(lec.idx).padStart(2, '0')}</span>
                    <span className="rail-name">{lec.idx === 0 ? '前言' : shortTitle(lec.title)}</span>
                    {p.total > 0 && (
                      <span className={`rail-progress ${p.read === p.total ? 'full' : ''}`}>
                        {p.read}/{p.total}
                      </span>
                    )}
                  </button>
                  {isCur && (
                    <div className="method-rail-pages">
                      {(pagesByLecture.get(lec.idx) ?? []).map((pg, pi) => (
                        <button
                          key={pg.id}
                          type="button"
                          className={`method-rail-page ${pg.kind === 'summary' ? 'is-summary' : ''} ${
                            sel.p === pi ? 'current' : ''
                          } ${pg.kind !== 'intro' && done[pg.id] ? 'read' : ''}`}
                          onClick={() => gotoPage(lec.idx, pi)}
                        >
                          {pg.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
          <ReaderToolsPanel
            settings={settings}
            onFontSizeDelta={(d) => setFontSize(settings.fontSize + d)}
            onFontFamily={setFontFamily}
            activeTheme={activeTheme}
            onCycleTheme={cycleTheme}
            onToggleFocus={() => setFocusMode(!settings.focusMode)}
            onToggleTermBox={() => setTermBox(!settings.termBox)}
          />
        </aside>
      </div>
    </div>
  )
}
