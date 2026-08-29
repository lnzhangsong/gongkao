import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { formatArticleNo } from '../data'
import { formatDate } from '../data'
import { Pagination } from '../components/ui/Pagination'

const PAGE_SIZE = 20

export function AdminPage() {
  const articles = useArticleStore((s) => s.articles)
  const navigate = useNavigate()

  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const list = [...articles].sort((a, b) => (b.date < a.date ? -1 : 1))
    if (!kw) return list
    return list.filter((a) =>
      `${a.title} ${a.summary} ${a.topic} ${a.source} ${a.date}`.toLowerCase().includes(kw),
    )
  }, [articles, q])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <section className="admin-page page-section">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">ARTICLE MANAGER　/　文章库管理</div>
          <h1>
            管理你的
            <br />
            <span>文章库。</span>
          </h1>
        </div>
        <p className="subpage-copy">搜索、编辑或删除文章。新增内容请进入编辑器，导出 JSON 可备份迁移。</p>
      </header>

      <div className="toolbar">
        <div className="filters">
          {/* 计数展示，非交互（原为假按钮，点击无反应） */}
          <span className="filter-pill active">{filtered.length} 篇文章</span>
          <span className="filter-pill">
            {filtered.filter((a) => a.id.startsWith('u')).length} 本地录入
          </span>
        </div>
        <div className="toolbar-tools">
          <label className="search-box">
            <Search size={14} className="search-icon" />
            <input
              placeholder="搜索标题、主题或来源"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </label>
          <button className="ghost" onClick={() => navigate('/admin/new')}>
            <Plus size={12} /> 新建文章
          </button>
        </div>
      </div>

      <main className="admin-content">
        <div className="admin-list">
          {pageItems.map((a) => (
            <div className="admin-row" key={a.id}>
              <span className="article-no">{formatArticleNo(a.id)}</span>
              <div className="admin-row-main">
                <h3 className="article-title">{a.title}</h3>
                <span className="admin-row-meta">
                  {a.topic} · {a.source} · {formatDate(a.date)} · {a.readTime} MIN
                  <em className={a.id.startsWith('u') ? 'badge-local' : 'badge-mock'}>
                    {a.id.startsWith('u') ? '本地' : '年编'}
                  </em>
                </span>
              </div>
              <div className="admin-row-actions">
                <Link className="text-btn" to={`/reading/${a.id}`}>
                  阅读 ↗
                </Link>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="empty-state">
              <strong>没有匹配的文章</strong>
              换个关键词，或点击「新建文章」开始录入
            </div>
          )}

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </main>
    </section>
  )
}
