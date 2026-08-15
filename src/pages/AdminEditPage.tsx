import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Save, Trash2 } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { TOPICS, computeReadTime } from '../data'
import type { ArticleInput, ArticleSource, ArticleTopic } from '../types'

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

/** 文章编辑器：/admin/new 新建，/admin/edit/:id 编辑 */
export function AdminEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const getArticle = useArticleStore((s) => s.getArticle)
  const addArticle = useArticleStore((s) => s.addArticle)
  const updateArticle = useArticleStore((s) => s.updateArticle)
  const removeArticle = useArticleStore((s) => s.removeArticle)

  const editing = Boolean(id)
  const [form, setForm] = useState<ArticleInput & { contentText: string }>({
    ...EMPTY,
    contentText: '',
  })
  const [error, setError] = useState('')

  /* 编辑模式：按 id 预填表单 */
  useEffect(() => {
    if (!id) {
      setForm({ ...EMPTY, contentText: '' })
      setError('')
      return
    }
    const a = getArticle(id)
    if (a) {
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
  }, [id, getArticle])

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
    if (id) updateArticle(id, input)
    else addArticle(input)
    navigate('/admin')
  }

  const remove = () => {
    if (!id) return
    const ok = window.confirm(`确定删除《${form.title.trim() || '这篇文章'}》吗？其阅读进度与摘录也会一并删除。`)
    if (!ok) return
    removeArticle(id)
    navigate('/admin')
  }

  return (
    <section className="admin-edit-page page-section">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">ARTICLE EDITOR　/　{editing ? '编辑文章' : '新建文章'}</div>
          <h1>
            {editing ? '编辑' : '录入'}你的
            <br />
            <span>文章。</span>
          </h1>
        </div>
        <p className="subpage-copy">
          {editing ? '修改标题、正文或元信息，保存后立即生效。' : '填写标题与正文（每行一段），保存后进入文章库。'}
        </p>
      </header>

      <div className="admin-edit-back">
        <Link to="/admin" className="back">
          ← 返回文章列表
        </Link>
      </div>

      <main className="admin-edit">
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
            rows={18}
          />
          <small className="admin-hint">
            预计阅读约 {computeReadTime(form.contentText.split('\n').filter((s) => s.trim()))} 分钟
          </small>
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
          {editing && (
            <button className="ghost danger" onClick={remove}>
              <Trash2 size={12} /> 删除这篇文章
            </button>
          )}
          <button className="ghost" onClick={() => navigate('/admin')}>
            取消
          </button>
        </div>
      </main>
    </section>
  )
}
