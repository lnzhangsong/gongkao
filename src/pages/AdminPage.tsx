import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Save, Search, Trash2, X } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { TOPICS, formatDate, computeReadTime } from '../data'
import { Pagination } from '../components/ui/Pagination'
import type { ArticleInput, ArticleSource, ArticleTopic } from '../types'

const PAGE_SIZE = 20

const EMPTY: ArticleInput = {
  title: '',
  summary: '',
  content: [],
  source: '人民日报',
  topic: TOPICS[0],
  date: new Date().toISOString().slice(0, 10),
  pullquote: '',
  finishNote: '',
}

export function AdminPage() {
  const articles = useArticleStore((s) => s.articles)
  const addArticle = useArticleStore((s) => s.addArticle)
  const updateArticle = useArticleStore((s) => s.updateArticle)
  const removeArticle = useArticleStore((s) => s.removeArticle)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ArticleInput & { contentText: string }>({
    ...EMPTY,
    contentText: '',
  })
  const [error, setError] = useState('')
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

  const startNew = () => {
    setEditingId(null)
    setForm({ ...EMPTY, contentText: '' })
    setError('')
  }

  const startEdit = (id: string) => {
    const a = articles.find((x) => x.id === id)
    if (!a) return
    setEditingId(id)
    setForm({
      title: a.title,
      summary: a.summary,
      content: a.content,
      source: a.source,
      topic: a.topic,
      date: a.date,
      pullquote: a.pullquote ?? '',
      finishNote: a.finishNote ?? '',
      contentText: a.content.join('\n'),
    })
    setError('')
  }

  const save = () => {
    const title = form.title.trim()
    const content = form.contentText.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!title) {
      setError('请填写文章标题')
      return
    }
    if (content.length === 0) {
      setError('请至少填写一段正文（每行一段）')
      return
    }
    const input: ArticleInput = {
      title,
      summary: form.summary.trim(),
      content,
      source: form.source,
      topic: form.topic,
      date: form.date || new Date().toISOString().slice(0, 10),
      pullquote: form.pullquote?.trim() || undefined,
      finishNote: form.finishNote?.trim() || undefined,
    }
    if (editingId) updateArticle(editingId, input)
    else addArticle(input)
    startNew()
  }

  const remove = (id: string, title: string) => {
    const ok = window.confirm(`确定删除《${title}》吗？其阅读进度与摘录也会一并删除。`)
    if (!ok) return
    removeArticle(id)
    if (editingId === id) startNew()
  }

  return (
    <section className="admin-page page-section">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">ARTICLE MANAGER　/　本地文章库</div>
          <h1>
            管理你的
            <br />
            <span>文章库。</span>
          </h1>
        </div>
        <p className="subpage-copy">录入、编辑或删除本地文章。文章保存在当前设备，导出 JSON 可备份迁移。</p>
      </header>

      <div className="toolbar">
        <div className="filters">
          <button className="filter-pill active">{filtered.length} 篇文章</button>
          <button className="filter-pill">
            {filtered.filter((a) => a.id.startsWith('u')).length} 本地录入
          </button>
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
          <button className="ghost" onClick={startNew}>
            <Plus size={12} /> 新建文章
          </button>
        </div>
      </div>

      <main className="admin-content">
        {/* 文章列表（分页，万篇不卡） */}
        <div className="admin-list">
          {pageItems.map((a) => (
            <div className="admin-row" key={a.id}>
              <span className="article-no">{a.id.slice(1).padStart(3, '0')}</span>
              <div className="admin-row-main">
                <h3 className="article-title">{a.title}</h3>
                <span className="admin-row-meta">
                  {a.topic} · {a.source} · {formatDate(a.date)} · {a.readTime} MIN
                  <em className={a.id.startsWith('u') ? 'badge-local' : 'badge-mock'}>
                    {a.id.startsWith('u') ? '本地' : '预置'}
                  </em>
                </span>
              </div>
              <div className="admin-row-actions">
                <Link className="text-btn" to={`/reading/${a.id}`}>
                  阅读 ↗
                </Link>
                <button className="text-btn" onClick={() => startEdit(a.id)}>
                  编辑
                </button>
                <button className="text-btn danger" onClick={() => remove(a.id, a.title)}>
                  <Trash2 size={11} /> 删除
                </button>
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

        {/* 编辑表单 */}
        <aside className="admin-form">
          <div className="admin-form-head">
            <span className="detail-label">{editingId ? '编辑文章' : '新建文章'}</span>
            <span className="admin-form-head-actions">
              {editingId && (
                <button className="text-btn" onClick={startNew}>
                  <X size={12} /> 取消编辑
                </button>
              )}
            </span>
          </div>

          <label className="admin-field">
            <span>标题 *</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="文章标题"
            />
          </label>

          <label className="admin-field">
            <span>导语（摘要）</span>
            <textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="一句话概括文章内容，展示在列表与阅读页"
              rows={3}
            />
          </label>

          <div className="admin-field-row">
            <label className="admin-field">
              <span>主题</span>
              <select
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value as ArticleTopic })}
              >
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>来源</span>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value as ArticleSource })}
              >
                <option>人民日报</option>
                <option>申论精读</option>
              </select>
            </label>
            <label className="admin-field">
              <span>日期</span>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
          </div>

          <label className="admin-field">
            <span>正文 *（每行一段）</span>
            <textarea
              value={form.contentText}
              onChange={(e) => setForm({ ...form, contentText: e.target.value })}
              placeholder={'第一段……\n第二段……'}
              rows={16}
            />
            <small className="admin-hint">预计阅读约 {computeReadTime(form.contentText.split('\n').filter((s) => s.trim()))} 分钟</small>
          </label>

          <label className="admin-field">
            <span>金句（引用块）</span>
            <input
              value={form.pullquote ?? ''}
              onChange={(e) => setForm({ ...form, pullquote: e.target.value })}
              placeholder="正文中的一句话，展示为引用块"
            />
          </label>

          <label className="admin-field">
            <span>结尾摘录金句</span>
            <input
              value={form.finishNote ?? ''}
              onChange={(e) => setForm({ ...form, finishNote: e.target.value })}
              placeholder="阅读结束时展示的一句话"
            />
          </label>

          {error && <div className="admin-error">{error}</div>}

          <div className="admin-form-actions">
            <button className="ghost" onClick={save}>
              <Save size={12} /> 保存文章
            </button>
            <button className="ghost" onClick={startNew}>
              重置
            </button>
          </div>
        </aside>
      </main>
    </section>
  )
}
