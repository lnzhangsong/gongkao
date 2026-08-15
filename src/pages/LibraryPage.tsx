import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PenLine, Search } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { TOPICS, formatDate } from '../data'
import { Pagination } from '../components/ui/Pagination'
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
  const articles = useArticleStore((s) => s.articles)
  const progress = useArticleStore((s) => s.progress)
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
    setParams(next, { replace: false })
  }

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
        if (!hay.includes(kw)) return false
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
  }, [articles, progress, q, topic, source, status, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const completedCount = articles.filter((a) => progress[a.id]?.completed).length
  const annualPct = Math.round((completedCount / Math.max(1, articles.length)) * 100)

  const open = (a: Article) => navigate(`/reading/${a.id}`)

  return (
    <section id="library" className="page-section">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">THE READING ARCHIVE　/　2024</div>
          <h1>
            找到值得
            <br />
            <span>反复阅读的文字。</span>
          </h1>
        </div>
        <p className="subpage-copy">人民日报年编与申论精读，按主题、日期和阅读状态整理。</p>
      </header>

      <div className="toolbar">
        <div className="filters" style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`filter-pill${source === f.key ? ' active' : ''}`}
              onClick={() => setParam('source', f.key === 'all' ? '' : f.key)}
            >
              {f.label}
            </button>
          ))}
          <span style={{ width: 8 }} />
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
        <div className="toolbar-tools">
          <label className="search-box">
            <Search size={14} className="search-icon" />
            <input
              placeholder="搜索文章、主题或关键词"
              value={q}
              onChange={(e) => setParam('q', e.target.value)}
            />
          </label>
          <div className="sort">
            SORT BY{' '}
            <select value={sort} onChange={(e) => setParam('sort', e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button className="ghost" onClick={() => navigate('/admin')}>
            <PenLine size={12} /> 录入文章
          </button>
        </div>
      </div>

      {/* 主题筛选 */}
      <div className="toolbar" style={{ borderBottom: '1px solid var(--line)', padding: '12px 38px' }}>
        <div className="filters" style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
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
      </div>

      <main className="library-content">
        <section className="featured">
          <article className="featured-main" onClick={() => open(articles[0])}>
            <span className="tag">TODAY'S FEATURED　/　{articles[0]?.source}</span>
            <h2>{articles[0]?.title}</h2>
            <div className="meta">
              <span>{formatDate(articles[0]?.date ?? '')}　/　{articles[0]?.readTime} MIN</span>
              <span>
                <button className="open-reading text-btn" onClick={() => open(articles[0])}>
                  继续阅读　↗
                </button>
              </span>
            </div>
          </article>
          <aside className="collection">
            <label>2024 年编</label>
            <h3>年度阅读进度</h3>
            <span className="count">
              {completedCount}
              <span> / {articles.length}</span>
            </span>
            <div className="collection-foot">
              <label>已完成 {annualPct}%</label>
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

        {pageItems.length === 0 && (
          <div className="empty-state">
            <strong>没有找到匹配的文章</strong>
            换个关键词或筛选条件试试
          </div>
        )}

        {pageItems.map((a) => {
          const p = progress[a.id]
          const statusLabel = p?.completed
            ? '已读'
            : p && p.percent > 0
              ? `在读 ${p.percent}%`
              : ''
          return (
            <button className="article-row" key={a.id} onClick={() => open(a)}>
              <span className="article-no">{a.id.slice(1).padStart(3, '0')}</span>
              <h3 className="article-title">{a.title}</h3>
              <span className="article-topic">
                {a.topic} · {a.source}
              </span>
              <span className="article-time">
                {formatDate(a.date)}
                {statusLabel && (
                  <>
                    {'　'}
                    <span className="done">{statusLabel}</span>
                  </>
                )}{' '}
                ↗
              </span>
            </button>
          )
        })}

        <Pagination
          page={page}
          totalPages={totalPages}
          onChange={(p) => setParam('page', String(p))}
        />
      </main>
    </section>
  )
}
