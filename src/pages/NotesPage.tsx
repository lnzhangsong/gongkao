import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Search, Trash2, X } from 'lucide-react'
import { useAnnotationStore } from '../stores/annotationStore'
import { useArticleStore } from '../stores/articleStore'
import { formatDate } from '../data'
import { downloadJSON, formatDateTime, monthOf } from '../lib/export'
import { Pagination } from '../components/ui/Pagination'
import type { Annotation, AnnotationKind } from '../types'

const PAGE_SIZE = 30

type QuickKey = 'all' | 'recent' | 'highlight' | 'underline' | 'note'

const QUICK: { key: QuickKey; label: string }[] = [
  { key: 'all', label: '全部摘录' },
  { key: 'recent', label: '最近添加' },
  { key: 'highlight', label: '我的高亮' },
  { key: 'underline', label: '我的划线' },
  { key: 'note', label: '带笔记' },
]

const KIND_LABEL: Record<AnnotationKind, string> = {
  highlight: '高亮',
  underline: '下划线',
  note: '笔记',
}

interface Row {
  ann: Annotation
  title: string
  topic: string
  source: string
  date: string
}

export function NotesPage() {
  const annotations = useAnnotationStore((s) => s.annotations)
  const remove = useAnnotationStore((s) => s.remove)
  const removeMany = useAnnotationStore((s) => s.removeMany)
  const update = useAnnotationStore((s) => s.update)
  const getArticle = useArticleStore((s) => s.getArticle)

  const [quick, setQuick] = useState<QuickKey>('all')
  const [topic, setTopic] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [editNoteId, setEditNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')

  /** 行数据：标注 + 文章信息 */
  const rows = useMemo<Row[]>(() => {
    return annotations
      .map((ann) => {
        const a = getArticle(ann.articleId)
        return {
          ann,
          title: a?.title ?? '未知文章',
          topic: a?.topic ?? '',
          source: a?.source ?? '',
          date: ann.createdAt,
        }
      })
      .sort((a, b) => (b.date < a.date ? -1 : 1))
  }, [annotations])

  /** 主题计数 */
  const topicCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.topic, (map.get(r.topic) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const sevenDays = Date.now() - 7 * 24 * 3600 * 1000
    return rows.filter((r) => {
      if (quick === 'recent' && new Date(r.ann.createdAt).getTime() < sevenDays) return false
      if (quick === 'highlight' && r.ann.kind !== 'highlight') return false
      if (quick === 'underline' && r.ann.kind !== 'underline') return false
      if (quick === 'note' && r.ann.kind !== 'note') return false
      if (topic && r.topic !== topic) return false
      if (kw) {
        const hay = `${r.ann.text} ${r.ann.noteText ?? ''} ${r.title} ${r.topic} ${r.source}`.toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [rows, quick, topic, q])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const selectedRow = rows.find((r) => r.ann.id === selectedId) ?? pageItems[0] ?? null

  /** 按月分组 */
  const groups = useMemo(() => {
    const g = new Map<string, Row[]>()
    for (const r of pageItems) {
      const m = monthOf(r.date)
      if (!g.has(m)) g.set(m, [])
      g.get(m)!.push(r)
    }
    return [...g.entries()]
  }, [pageItems])

  const toggleChecked = (id: string) => {
    setChecked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setChecked((cur) => {
      if (pageItems.every((r) => cur.has(r.ann.id))) {
        const next = new Set(cur)
        pageItems.forEach((r) => next.delete(r.ann.id))
        return next
      }
      const next = new Set(cur)
      pageItems.forEach((r) => next.add(r.ann.id))
      return next
    })
  }

  const exportSelected = () => {
    const data = checked.size > 0 ? rows.filter((r) => checked.has(r.ann.id)) : filtered
    downloadJSON(
      `readbook-notes-${new Date().toISOString().slice(0, 10)}.json`,
      data.map((r) => ({ ...r.ann, articleTitle: r.title, topic: r.topic, source: r.source })),
    )
  }

  const deleteSelected = () => {
    if (checked.size === 0) return
    removeMany([...checked])
    setChecked(new Set())
  }

  const deleteOne = (id: string) => {
    remove(id)
    if (selectedId === id) setSelectedId(null)
  }

  const saveNoteEdit = (id: string) => {
    update(id, { noteText: noteDraft.trim() })
    setEditNoteId(null)
  }

  const addTag = (id: string) => {
    const tag = tagDraft.trim().replace(/^#/, '')
    if (!tag) return
    const row = rows.find((r) => r.ann.id === id)
    if (row && !(row.ann.tags ?? []).includes(tag)) {
      update(id, { tags: [...(row.ann.tags ?? []), tag] })
    }
    setTagDraft('')
  }

  const removeTag = (id: string, tag: string) => {
    const row = rows.find((r) => r.ann.id === id)
    if (row) update(id, { tags: (row.ann.tags ?? []).filter((t) => t !== tag) })
  }

  return (
    <section className="notes-page page-section">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">YOUR PERSONAL INDEX　/　{annotations.length} NOTES</div>
          <h1>
            把读过的，
            <br />
            <span>留下来。</span>
          </h1>
        </div>
        <p className="subpage-copy">用主题、时间和搜索，快速找到真正需要的那一句。</p>
      </header>

      <main className="notes-workspace">
        {/* 左侧筛选 */}
        <aside className="notes-sidebar">
          <div className="side-label">QUICK ACCESS</div>
          <nav className="side-nav">
            {QUICK.map((item) => {
              const count =
                item.key === 'all'
                  ? rows.length
                  : item.key === 'recent'
                    ? rows.filter((r) => new Date(r.ann.createdAt).getTime() > Date.now() - 7 * 24 * 3600 * 1000).length
                    : rows.filter((r) =>
                        item.key === 'highlight'
                          ? r.ann.kind === 'highlight'
                          : item.key === 'underline'
                            ? r.ann.kind === 'underline'
                            : r.ann.kind === 'note',
                      ).length
              return (
                <button
                  key={item.key}
                  className={quick === item.key && !topic ? 'active' : ''}
                  onClick={() => {
                    setQuick(item.key)
                    setTopic('')
                    setPage(1)
                  }}
                >
                  {item.label} <small>{count}</small>
                </button>
              )
            })}
          </nav>
          <div className="side-label">TOPICS</div>
          <nav className="side-nav">
            {topicCounts.map(([t, c]) => (
              <button
                key={t}
                className={topic === t ? 'active' : ''}
                onClick={() => {
                  setTopic(t === topic ? '' : t)
                  setQuick('all')
                  setPage(1)
                }}
              >
                {t} <small>{c}</small>
              </button>
            ))}
          </nav>
        </aside>

        {/* 中间列表 */}
        <section className="notes-main">
          <div className="main-top">
            <span className="result-count">
              {filtered.length} 条摘录　/　按时间分组
            </span>
            <label className="note-search">
              <Search size={13} style={{ color: 'var(--muted)' }} />
              <input placeholder="搜索摘录、主题或来源" value={q} onChange={(e) => setQ(e.target.value)} />
              {q && (
                <button
                  className="text-btn"
                  style={{ color: 'var(--muted)', display: 'inline-flex' }}
                  onClick={() => setQ('')}
                  aria-label="清除搜索"
                >
                  <X size={12} />
                </button>
              )}
            </label>
          </div>

          <div className="batch-bar">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={pageItems.length > 0 && pageItems.every((r) => checked.has(r.ann.id))} onChange={toggleAll} style={{ accentColor: 'var(--accent)' }} />
              全选本页
            </label>
            {checked.size > 0 && <span>已选 {checked.size} 条</span>}
            <button onClick={exportSelected}>
              <Download size={11} /> 导出{checked.size > 0 ? '选中' : '当前结果'}
            </button>
            {checked.size > 0 && (
              <button className="danger" onClick={deleteSelected}>
                <Trash2 size={11} /> 删除选中
              </button>
            )}
          </div>

          {filtered.length === 0 && (
            <div className="empty-state">
              <strong>还没有摘录</strong>
              在阅读页选中文字，即可高亮、划线或添加笔记
            </div>
          )}

          {groups.map(([month, items]) => (
            <div className="note-group" key={month}>
              <div className="group-title">
                <span>{month}</span>
                <span>{items.length} NOTES</span>
              </div>
              {items.map((r, i) => (
                <div
                  className={`note-row${selectedId === r.ann.id ? ' selected' : ''}`}
                  key={r.ann.id}
                  onClick={() => setSelectedId(r.ann.id)}
                >
                  <span className="note-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked.has(r.ann.id)}
                      onChange={() => toggleChecked(r.ann.id)}
                    />
                  </span>
                  <span className="note-no">{String(i + 1).padStart(2, '0')}</span>
                  <span className="note-text">
                    {r.ann.kind === 'highlight' && (
                      <i className={`hl-swatch ${r.ann.color ?? 'yellow'}`} />
                    )}
                    {r.ann.text.length > 40 ? `${r.ann.text.slice(0, 40)}…` : r.ann.text}
                  </span>
                  <span className="note-topic">{r.topic || KIND_LABEL[r.ann.kind]}</span>
                  <span className="note-date">{formatDate(new Date(r.ann.createdAt).toISOString().slice(0, 10))}</span>
                </div>
              ))}
            </div>
          ))}

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </section>

        {/* 右侧详情 */}
        <aside className="note-detail">
          {selectedRow ? (
            <>
              <div className="detail-label">
                <span>NOTE DETAIL</span>
                <span>
                  {selectedRow.ann.kind === 'note' ? 'NOTE' : KIND_LABEL[selectedRow.ann.kind]} /{' '}
                  {rows.length}
                </span>
              </div>
              <div className="detail-content">
                <div className="detail-topic">
                  {selectedRow.ann.kind === 'highlight' && (
                    <i className={`hl-swatch ${selectedRow.ann.color ?? 'yellow'}`} />
                  )}
                  {KIND_LABEL[selectedRow.ann.kind]}　·　{selectedRow.topic}
                </div>
                <blockquote>“{selectedRow.ann.text}”</blockquote>

                {selectedRow.ann.kind === 'note' && (
                  <div className="detail-note">
                    <span className="label">我的笔记</span>
                    {editNoteId === selectedRow.ann.id ? (
                      <>
                        <textarea
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          autoFocus
                        />
                        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                          <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => saveNoteEdit(selectedRow.ann.id)}>
                            保存
                          </button>
                          <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => setEditNoteId(null)}>
                            取消
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {selectedRow.ann.noteText || '（未填写）'}
                        <button
                          className="text-btn"
                          style={{ display: 'block', marginTop: 8, color: 'var(--accent)' }}
                          onClick={() => {
                            setEditNoteId(selectedRow.ann.id)
                            setNoteDraft(selectedRow.ann.noteText ?? '')
                          }}
                        >
                          编辑笔记　↗
                        </button>
                      </>
                    )}
                  </div>
                )}

                <div className="detail-tags">
                  {(selectedRow.ann.tags ?? []).map((tag) => (
                    <span className="tag-chip" key={tag}>
                      #{tag}
                      <button onClick={() => removeTag(selectedRow.ann.id, tag)} aria-label="删除标签">
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    placeholder="+ 标签"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addTag(selectedRow.ann.id)
                    }}
                  />
                </div>

                <div className="detail-source">
                  来源：{selectedRow.source} · {selectedRow.title}
                  <br />
                  <Link to={`/reading/${selectedRow.ann.articleId}`}>打开原文　↗</Link>
                  <br />
                  保存时间：{formatDateTime(selectedRow.ann.createdAt)}
                </div>

                <div className="detail-actions">
                  <button className="danger" onClick={() => deleteOne(selectedRow.ann.id)}>
                    <Trash2 size={12} /> 删除
                  </button>
                  <button onClick={exportSelected}>
                    <Download size={12} /> 导出
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state" style={{ marginTop: 80 }}>
              <strong>选择一条摘录</strong>
              查看详情、标签与原文
            </div>
          )}
        </aside>
      </main>
    </section>
  )
}
