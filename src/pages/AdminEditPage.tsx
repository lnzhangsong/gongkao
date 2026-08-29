import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, PencilLine, Save } from 'lucide-react'
import { useArticleStore } from '../stores/articleStore'
import { confirmDialog, alertDialog } from '../components/ui/ConfirmDialog'
import { MenuSelect } from '../components/ui/MenuSelect'
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

/** 文章录入页：仅支持新建（编辑/删除已移除） */
export function AdminEditPage() {
  const navigate = useNavigate()
  const addArticle = useArticleStore((s) => s.addArticle)

  const [form, setForm] = useState<ArticleInput & { contentText: string }>({
    ...EMPTY,
    contentText: '',
  })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  /** 正文区模式：edit 编辑 / preview 预览 */
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  const paragraphs = form.contentText.split('\n').map((s) => s.trim()).filter(Boolean)
  const previewParas = paragraphs.slice(0, 30)

  const save = () => {
    const title = form.title.trim()
    if (!title) {
      setError('请填写文章标题')
      return
    }
    if (paragraphs.length === 0) {
      setError('请至少填写一段正文（每行一段）')
      return
    }
    const input: ArticleInput = {
      title,
      summary: form.summary.trim(),
      content: paragraphs,
      source: form.source,
      topic: form.topic,
      date: form.date || new Date().toISOString().slice(0, 10),
      pullquote: form.pullquote?.trim() || undefined,
      finishNote: form.finishNote?.trim() || undefined,
    }
    addArticle(input)
    setSaved(true)
    void alertDialog('文章已保存，可在文章库中查看。')
    navigate('/admin')
  }

  /** 有已填内容时离开需确认，避免误触丢稿 */
  const guardLeave = async (): Promise<boolean> => {
    const hasContent = form.title.trim() || form.contentText.trim() || form.summary.trim()
    if (!hasContent || saved) return true
    return confirmDialog('还未保存，离开将丢弃已填写的内容，确定离开？', { danger: true })
  }


  return (
    <section className="admin-edit-page page-section">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">ARTICLE EDITOR　/　新建文章</div>
          <h1>
            录入你的
            <br />
            <span>文章。</span>
          </h1>
        </div>
        <p className="subpage-copy">填写标题与正文（每行一段），保存后进入文章库。</p>
      </header>

      <div className="admin-edit-back">
        <Link
          to="/admin"
          className="back"
          onClick={async (e) => {
            const hasContent = form.title.trim() || form.contentText.trim() || form.summary.trim()
            if (!hasContent || saved) return
            e.preventDefault()
            if (await confirmDialog('还未保存，离开将丢弃已填写的内容，确定离开？', { danger: true })) {
              navigate('/admin')
            }
          }}
        >
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
            rows={2}
          />
        </label>

        <div className="admin-meta">
          <div className="admin-meta-row">
            <span>主题</span>
            <MenuSelect
              form
              value={form.topic}
              options={TOPICS.map((t) => ({ key: t, label: t }))}
              onChange={(key) => setForm({ ...form, topic: key as ArticleTopic })}
              ariaLabel="主题"
            />
          </div>
          <div className="admin-meta-row">
            <span>来源</span>
            <MenuSelect
              form
              value={form.source}
              options={[
                { key: '人民日报', label: '人民日报' },
                { key: '申论精读', label: '申论精读' },
              ]}
              onChange={(key) => setForm({ ...form, source: key as ArticleSource })}
              ariaLabel="来源"
            />
          </div>
          <label className="admin-meta-row">
            <span>日期</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
        </div>

        {/* 正文：编辑 / 预览 切换 */}
        <div className="admin-field admin-content-block">
          <div className="admin-field-head">
            <span>正文 *（每行一段）</span>
            <div className="admin-mode-toggle">
              <button
                className={mode === 'edit' ? 'active' : ''}
                onClick={() => setMode('edit')}
                aria-label="编辑模式"
              >
                <PencilLine size={12} /> 编辑
              </button>
              <button
                className={mode === 'preview' ? 'active' : ''}
                onClick={() => setMode('preview')}
                aria-label="预览模式"
              >
                <Eye size={12} /> 预览
              </button>
            </div>
          </div>

          {mode === 'edit' ? (
            <textarea
              className="admin-content-input"
              value={form.contentText}
              onChange={(e) => setForm({ ...form, contentText: e.target.value })}
              placeholder={'第一段……\n第二段……'}
              rows={18}
              autoFocus
            />
          ) : (
            <div className="admin-content-preview">
              {previewParas.length === 0 ? (
                <p className="admin-preview-empty">还没有正文，切回「编辑」开始输入。</p>
              ) : (
                previewParas.map((p, i) => (
                  <p key={i} className="admin-preview-para">
                    {p}
                  </p>
                ))
              )}
              {paragraphs.length > previewParas.length && (
                <p className="admin-preview-more">
                  … 还有 {paragraphs.length - previewParas.length} 段未显示（仅预览前 30 段）
                </p>
              )}
            </div>
          )}

          <small className="admin-hint">
            预计阅读约 {computeReadTime(paragraphs)} 分钟　/　{paragraphs.length} 段
          </small>
        </div>

        <label className="admin-field">
          <span>金句（可多句，每行一句）</span>
          <textarea
            value={form.pullquote ?? ''}
            onChange={(e) => setForm({ ...form, pullquote: e.target.value })}
            placeholder={'例如：\n基层是服务群众的最后一公里。\n减负不是减责任，而是把干部从形式主义中解放出来。'}
            rows={3}
          />
        </label>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-form-actions">
          <button className="ghost" onClick={save}>
            <Save size={12} /> 保存文章
          </button>
          <button
            className="ghost"
            onClick={async () => {
              if (await guardLeave()) navigate('/admin')
            }}
          >
            取消
          </button>
        </div>
      </main>
    </section>
  )
}
