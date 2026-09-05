import { useEffect, useMemo, useState } from 'react'
import { loadDisplayFont } from '../lib/fonts'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, PenLine, Search } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { useShenlunStore } from '../stores/shenlunStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { fetchMetaList } from '../lib/api'
import { TOPICS, formatArticleNo, formatDate } from '../data'
import { Pagination } from '../components/ui/Pagination'
import { MenuSelect } from '../components/ui/MenuSelect'
import { Ticker } from '../components/ui/Ticker'
import { ApiLoading } from '../components/ui/ApiLoading'
import { useHoverPrefetch } from '../lib/hoverPrefetch'
import type { Article, ArticleSource } from '../types'

const PAGE_SIZE = 8

type SortKey = 'latest' | 'mostRead' | 'recent'
type StatusKey = 'all' | 'unread' | 'reading' | 'done' | 'favorite'

const SOURCE_FILTERS: { key: ArticleSource | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: '人民日报', label: '人民日报' },
  { key: '申论精读', label: '申论精读' },
]

const STATUS_FILTERS: { key: StatusKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'reading', label: '在读' },
  { key: 'done', label: '已读' },
  { key: 'favorite', label: '我的收藏' },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'latest', label: '最新收录' },
  { key: 'mostRead', label: '阅读最多' },
  { key: 'recent', label: '最近阅读' },
]

export function LibraryPage() {
  /* 文库大标题需要装饰字体（马善政楷书），按需加载 */
  useEffect(() => {
    void loadDisplayFont()
  }, [])
  const articles = useArticleStore((s) => s.articles)
  const progress = useArticleStore((s) => s.progress)
  const apiReady = useArticleStore((s) => s._apiReady)
  /* 学习状态 / 素材数（申论拆解徽标） */
  const shenlunStudy = useShenlunStore((s) => s.study)
  const allAnnotations = useAnnotationStore((s) => s.annotations)
  const matCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of allAnnotations) {
      if (a.kind === 'highlight' && a.materialType) m.set(a.articleId, (m.get(a.articleId) ?? 0) + 1)
    }
    return m
  }, [allAnnotations])
  const navigate = useNavigate()

  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const topic = params.get('topic') ?? ''
  const source = (params.get('source') ?? 'all') as ArticleSource | 'all'
  const status = (params.get('status') ?? 'all') as StatusKey
  const sort = (params.get('sort') ?? 'latest') as SortKey
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    /* 搜索逐字输入不推历史（否则按「后退」要逐字回退）；筛选/分页保留 push */
    setParams(next, { replace: key === 'q' })
  }

  /* 全文搜索：API /api/articles?q= 支持服务端检索正文。
     防抖 300ms 拉取命中 id 集合，与本地 meta 过滤取并集（本地录入文章仍可按标题命中） */
  const [fulltextIds, setFulltextIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    const kw = q.trim()
    if (!kw) {
      setFulltextIds(new Set())
      return
    }
    let alive = true
    const t = window.setTimeout(() => {
      fetchMetaList({ q: kw })
        .then((res) => {
          if (alive) setFulltextIds(new Set(res.articles.map((a) => a.id)))
        })
        .catch(() => {
          if (alive) setFulltextIds(new Set())
        })
    }, 300)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [q])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    let list = articles.filter((a) => {
      if (source !== 'all' && a.source !== source) return false
      if (topic && a.topic !== topic) return false
      const p = progress[a.id]
      if (status === 'unread' && p && (p.percent > 0 || p.lastReadAt)) return false
      if (status === 'reading' && (!p || p.percent <= 0 || p.completed)) return false
      if (status === 'done' && !p?.completed) return false
      if (status === 'favorite' && !p?.favorite) return false
      if (kw) {
        const hay = `${a.title} ${a.summary} ${a.topic} ${a.source}`.toLowerCase()
        if (!hay.includes(kw) && !fulltextIds.has(a.id)) return false
      }
      return true
    })
    list = [...list].sort((a, b) => {
      const pa = progress[a.id]
      const pb = progress[b.id]
      if (sort === 'latest') return b.date < a.date ? -1 : 1
      if (sort === 'mostRead') return (pb?.readCount ?? 0) - (pa?.readCount ?? 0)
      // recent
      const ta = pa?.lastReadAt ?? ''
      const tb = pb?.lastReadAt ?? ''
      if (!ta && !tb) return b.date < a.date ? -1 : 1
      if (!ta) return 1
      if (!tb) return -1
      return tb < ta ? -1 : 1
    })
    return list
  }, [articles, progress, q, topic, source, status, sort, fulltextIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  /* 筛选后结果变少时钳到最后一页，避免「页内无内容」的假空态（与 NotesPage 一致） */
  const curPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)

  const completedCount = articles.filter((a) => progress[a.id]?.completed).length
  const annualPct = Math.round((completedCount / Math.max(1, articles.length)) * 100)
  /* 年份由文章日期动态推导，避免写死 */
  const years = useMemo(
    () => [...new Set(articles.map((a) => a.date.slice(0, 4)))].sort().join(' · '),
    [articles],
  )

  const open = (a: Article) => navigate(`/reading/${a.id}`)

  /** 悬停预取正文：点进阅读页时全文多半已在缓存（120ms 防飞掠） */
  const warm = (a: Article) => void useArticleStore.getState().ensureContent(a.id)
  const hoverWarm = useHoverPrefetch()

  /* 主题筛选：移动端默认收起为一行，展开后显示全部（桌面端始终展开） */
  const [topicsExpanded, setTopicsExpanded] = useState(false)

  return (
    <section id="library" className="page-section">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">THE READING ARCHIVE　/　{years || '……'}</div>
          <h1>
            找到值得
            <br />
            <span>反复阅读的文字。</span>
          </h1>
        </div>
        <p className="subpage-copy">人民日报年编与申论精读，按主题、日期和阅读状态整理。</p>
      </header>

      <div className="toolbar">
        <div className="filter-groups">
          <div className="filter-group">
            <span className="filter-group-label">来源</span>
            <div className="filters">
              {SOURCE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`filter-pill${source === f.key ? ' active' : ''}`}
                  onClick={() => setParam('source', f.key === 'all' ? '' : f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-group-label">状态</span>
            <div className="filters">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`filter-pill${status === f.key ? ' active' : ''}`}
                  onClick={() => setParam('status', f.key === 'all' ? '' : f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="toolbar-tools">
          <label className="search-box">
            <Search size={14} className="search-icon" />
            <input
              placeholder="搜索标题、摘要或正文"
              value={q}
              onChange={(e) => setParam('q', e.target.value)}
            />
          </label>
          <div className="toolbar-tools-row">
            <div className="sort">
              SORT BY{' '}
              <MenuSelect
                compact
                value={sort}
                options={SORTS.map((s) => ({ key: s.key, label: s.label }))}
                onChange={(key) => setParam('sort', key)}
                ariaLabel="排序方式"
              />
            </div>
            <button className="ghost" onClick={() => navigate('/admin')}>
              <PenLine size={12} /> 录入文章
            </button>
          </div>
        </div>
      </div>

      {/* 主题筛选：移动端默认只显示「全部主题」+ 当前选中 + 展开按钮，避免占满首屏 */}
      <div className="toolbar topic-toolbar">
        <span className="filter-group-label topic-label">主题</span>
        <div className={`filters topic-filters${topicsExpanded ? ' expanded' : ''}`}>
          <button
            className={`filter-pill${!topic ? ' active' : ''}`}
            onClick={() => setParam('topic', '')}
          >
            全部主题
          </button>
          {TOPICS.map((t) => (
            <button
              key={t}
              className={`filter-pill${topic === t ? ' active' : ''}`}
              onClick={() => setParam('topic', t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="topic-toggle"
          onClick={() => setTopicsExpanded((v) => !v)}
          aria-expanded={topicsExpanded}
        >
          {topicsExpanded ? '收起' : '更多主题'}
          <ChevronDown size={12} className={topicsExpanded ? 'up' : ''} />
        </button>
      </div>

      <main key={apiReady ? 'ready' : 'loading'} className={`library-content${apiReady ? ' fade-in' : ''}`}>
        {!apiReady && <ApiLoading label="正在加载文章库…" />}

        <section className="featured">
          <article
            className={`featured-main${articles[0] ? '' : ' is-loading'}`}
            onClick={() => articles[0] && open(articles[0])}
            aria-disabled={!articles[0]}
          >
            <span className="tag">TODAY'S FEATURED　/　{articles[0]?.source ?? '…'}</span>
            <h2>{articles[0]?.title ?? '正在加载…'}</h2>
            <div className="meta">
              <span>{articles[0] ? `${formatDate(articles[0].date)}　/　${articles[0].readTime} MIN` : ''}</span>
              <span>
                <button
                  className="open-reading text-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (articles[0]) open(articles[0])
                  }}
                >
                  继续阅读　↗
                </button>
              </span>
            </div>
          </article>
          <aside className="collection">
            <label>{years || '年编'}</label>
            <h3>年度阅读进度</h3>
            <span className="count">
              <Ticker value={completedCount} />
              <span> / {articles.length}</span>
            </span>
            <div className="collection-foot">
              <label>
                已完成 <Ticker value={annualPct} duration={800} />%
              </label>
              <button className="text-btn" onClick={() => setParam('status', 'done')}>
                查看年编　↗
              </button>
            </div>
          </aside>
        </section>

        <div className="section-title">
          <h2>全部文章</h2>
          <span>
            {filtered.length} ARTICLES　/　{TOPICS.length} TOPICS
          </span>
        </div>

        {pageItems.length === 0 && apiReady && (
          <div className="empty-state">
            {articles.length === 0 ? (
              <>
                <strong>文章库还是空的</strong>
                等文章入库后，这里就能看到全部内容
              </>
            ) : (
              <>
                <strong>没有找到匹配的文章</strong>
                换个关键词或筛选条件试试
              </>
            )}
          </div>
        )}

        {pageItems.map((a) => {
          const p = progress[a.id]
          const isRead = p?.completed === true
          const study = shenlunStudy[a.id]
          const matCount = matCounts.get(a.id) ?? 0
          return (
            <button className="article-row" key={a.id} onClick={() => open(a)} {...hoverWarm(() => warm(a))}>
              <span className="article-no">
                {formatArticleNo(a.id)}
                {(study || matCount > 0) && (
                  <em
                    className={`study-badge${study?.status === 'mastered' ? ' mastered' : ''}`}
                    title={matCount > 0 ? `${matCount} 条素材` : undefined}
                  >
                    {study ? (study.status === 'learning' ? '学习中' : study.status === 'mastered' ? '已掌握' : '已拆解') : '已标记'}
                  </em>
                )}
              </span>
              <h3 className={`article-title${isRead ? ' is-read' : ''}`}>{a.title}</h3>
              <span className="article-topic">
                {a.topic} · {a.source}
              </span>
              <span className="article-time">{formatDate(a.date)}　↗</span>
            </button>
          )
        })}

        <Pagination
          page={curPage}
          totalPages={totalPages}
          onChange={(p) => setParam('page', String(p))}
        />
      </main>
    </section>
  )
}
