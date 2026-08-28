import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Search, Trash2, X } from 'lucide-react'

import { useAnnotationStore } from '../stores/annotationStore'
import { useArticleStore } from '../stores/articleStore'
import { formatDate } from '../data'
import { downloadJSON, downloadText, formatDateTime, monthOf } from '../lib/export'
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

/** 摘录行：同一段话（同文章同区间）的多条标注合并为一条 */
interface Row {
  key: string
  anns: Annotation[]
  text: string
  title: string
  topic: string
  source: string
  date: string
  /** 组内全部笔记标注（一段话可有多条笔记） */
  notes: Annotation[]
}

function groupKey(a: Annotation): string {
  return `${a.articleId}|${a.start}|${a.end}`
}

function kindLabel(kinds: Set<AnnotationKind>): string {
  return [...kinds].map((k) => KIND_LABEL[k]).join(' · ')
}

export function NotesPage() {
  const annotations = useAnnotationStore((s) => s.annotations)
  const removeMany = useAnnotationStore((s) => s.removeMany)
  const update = useAnnotationStore((s) => s.update)
  const getArticle = useArticleStore((s) => s.getArticle)

  const [quick, setQuick] = useState<QuickKey>('all')
  const [topic, setTopic] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [editNoteId, setEditNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  /** 移动端：详情栏收进底部抽屉，点击列表行时打开；桌面端右侧栏常驻不受影响 */
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

  /** 按同一段话合并标注为行 */
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>()
    for (const ann of annotations) {
      const a = getArticle(ann.articleId)
      const key = groupKey(ann)
      const existing = map.get(key)
      if (existing) {
        existing.anns.push(ann)
        if (ann.createdAt > existing.date) existing.date = ann.createdAt
        if (ann.kind === 'note') existing.notes.push(ann)
      } else {
        map.set(key, {
          key,
          anns: [ann],
          text: ann.text,
          title: a?.title ?? '未知文章',
          topic: a?.topic ?? '',
          source: a?.source ?? '',
          date: ann.createdAt,
          notes: ann.kind === 'note' ? [ann] : [],
        })
      }
    }
    return [...map.values()].sort((x, y) => (y.date < x.date ? -1 : 1))
  }, [annotations, getArticle])

  /** 主题计数 */
  const topicCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.topic, (m.get(r.topic) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const rowKinds = (r: Row) => new Set(r.anns.map((a) => a.kind))

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const sevenDays = Date.now() - 7 * 24 * 3600 * 1000
    return rows.filter((r) => {
      const kinds = rowKinds(r)
      if (quick === 'recent' && new Date(r.date).getTime() < sevenDays) return false
      if (quick === 'highlight' && !kinds.has('highlight')) return false
      if (quick === 'underline' && !kinds.has('underline')) return false
      if (quick === 'note' && !kinds.has('note')) return false
      if (topic && r.topic !== topic) return false
      if (kw) {
        const hay = `${r.text} ${r.notes.map((n) => n.noteText ?? '').join(' ')} ${r.title} ${r.topic} ${r.source}`.toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [rows, quick, topic, q])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const selectedRow = rows.find((r) => r.key === selectedKey) ?? pageItems[0] ?? null

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

  const toggleChecked = (key: string) => {
    setChecked((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = () => {
    setChecked((cur) => {
      if (pageItems.every((r) => cur.has(r.key))) {
        const next = new Set(cur)
        pageItems.forEach((r) => next.delete(r.key))
        return next
      }
      const next = new Set(cur)
      pageItems.forEach((r) => next.add(r.key))
      return next
    })
  }

  const selectedAnns = (keys: Set<string>) => rows.filter((r) => keys.has(r.key)).flatMap((r) => r.anns)

  const exportSelected = () => {
    const data = checked.size > 0 ? selectedAnns(checked) : filtered.flatMap((r) => r.anns)
    downloadJSON(
      `readbook-notes-${new Date().toISOString().slice(0, 10)}.json`,
      data.map((ann) => {
        const row = rows.find((r) => r.key === groupKey(ann))
        return { ...ann, articleTitle: row?.title ?? '', topic: row?.topic ?? '', source: row?.source ?? '' }
      }),
    )
  }

  /** 导出 Markdown：按主题分组的写作素材库格式（比 JSON 直接可用） */
  const exportMarkdown = () => {
    const data = checked.size > 0 ? filtered.filter((r) => checked.has(r.key)) : filtered
    const byTopic = new Map<string, Row[]>()
    for (const r of data) {
      if (!byTopic.has(r.topic)) byTopic.set(r.topic, [])
      byTopic.get(r.topic)!.push(r)
    }
    let md = `# 申论素材摘录\n\n> 导出自 读本 READBOOK　·　${formatDateTime(new Date().toISOString())}　·　共 ${data.length} 条\n`
    for (const [topic, list] of byTopic) {
      md += `\n## ${topic}\n`
      for (const r of list) {
        md += `\n### ${r.title}\n\n`
        md += `> ${r.text.replace(/\n/g, '\n> ')}\n\n`
        md += `—— ${r.source}\n`
        for (const n of r.notes) {
          if (n.noteText) md += `\n**笔记**：${n.noteText}\n`
          if ((n.tags ?? []).length > 0) md += `\n${(n.tags ?? []).map((t) => `#${t}`).join(' ')}\n`
        }
      }
    }
    downloadText(`readbook-notes-${new Date().toISOString().slice(0, 10)}.md`, md)
  }

  const deleteSelected = () => {
    if (checked.size === 0) return
    removeMany(selectedAnns(checked).map((a) => a.id))
    setChecked(new Set())
  }

  const deleteOne = (key: string) => {
    const row = rows.find((r) => r.key === key)
    if (row) removeMany(row.anns.map((a) => a.id))
    if (selectedKey === key) setSelectedKey(null)
  }

  const saveNoteEdit = (id: string) => {
    update(id, { noteText: noteDraft.trim() })
    setEditNoteId(null)
  }

  const addTag = (id: string) => {
    const tag = tagDraft.trim().replace(/^#/, '')
    if (!tag) return
    const ann = annotations.find((a) => a.id === id)
    if (ann && !(ann.tags ?? []).includes(tag)) {
      update(id, { tags: [...(ann.tags ?? []), tag] })
    }
    setTagDraft('')
  }

  const removeTag = (id: string, tag: string) => {
    const ann = annotations.find((a) => a.id === id)
    if (ann) update(id, { tags: (ann.tags ?? []).filter((t) => t !== tag) })
  }

  return (
    <section className="notes-page page-section">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">YOUR PERSONAL INDEX　/　{rows.length} NOTES</div>
          <h1>
            把读过的，
            <br />
            <span>留下来。</span>
          </h1>
        </div>
        <p className="subpage-copy">用主题、时间和搜索，快速找到真正需要的那一句。</p>
      </header>

      <main className="notes-workspace">
        <aside className="notes-sidebar">
          <div className="side-label">QUICK ACCESS</div>
          <nav className="side-nav">
            {QUICK.map((item) => {
              const count = rows.filter((r) => {
                const kinds = rowKinds(r)
                if (item.key === 'all') return true
                if (item.key === 'recent') return new Date(r.date).getTime() > Date.now() - 7 * 24 * 3600 * 1000
                return kinds.has(item.key)
              }).length
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

        <section className="notes-main">
          <div className="main-top">
            <span className="result-count">{filtered.length} 条摘录　/　按时间分组</span>
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
              <input type="checkbox" checked={pageItems.length > 0 && pageItems.every((r) => checked.has(r.key))} onChange={toggleAll} style={{ accentColor: 'var(--accent)' }} />
              全选本页
            </label>
            {checked.size > 0 && <span>已选 {checked.size} 条</span>}
            <button onClick={exportSelected}>
              <Download size={11} /> 导出{checked.size > 0 ? '选中' : '当前结果'}
            </button>
            <button onClick={exportMarkdown}>
              <Download size={11} /> Markdown
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
              {items.map((r, i) => {
                const kinds = rowKinds(r)
                return (
                  <div
                    className={`note-row${selectedKey === r.key ? ' selected' : ''}`}
                    key={r.key}
                    onClick={() => {
                      setSelectedKey(r.key)
                      setMobileDetailOpen(true)
                    }}
                  >
                    <span className="note-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked.has(r.key)}
                        onChange={() => toggleChecked(r.key)}
                      />
                    </span>
                    <span className="note-no">{String(i + 1).padStart(2, '0')}</span>
                    <span className="note-text">
                      {kinds.has('highlight') && (
                        <i className={`hl-swatch ${r.anns.find((a) => a.kind === 'highlight')?.color ?? 'yellow'}`} />
                      )}
                      {kinds.has('underline') && <i className="ul-swatch" />}
                      {kinds.has('note') && (
                        <i className="note-swatch">{r.notes.length > 1 ? `✦×${r.notes.length}` : '✦'}</i>
                      )}
                      {r.text}
                    </span>
                    <span className="note-topic">
                      {r.topic}
                      {kinds.size > 1 && <em className="note-kinds">+{kinds.size - 1}</em>}
                    </span>
                    <span className="note-date">{formatDate(new Date(r.date).toISOString().slice(0, 10))}</span>
                  </div>
                )
              })}
            </div>
          ))}

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </section>

        {/* 移动端：详情收进底部抽屉，需要先点列表行打开；桌面端此遮罩不渲染交互层 */}
        {mobileDetailOpen && (
          <div className="note-detail-backdrop" onClick={() => setMobileDetailOpen(false)} />
        )}

        <aside className={`note-detail${mobileDetailOpen ? ' mobile-open' : ''}`}>
          {selectedRow ? (
            <>
              <div className="detail-label">
                <span>NOTE DETAIL</span>
                <span className="detail-label-right">
                  {kindLabel(rowKinds(selectedRow))} / {rows.length}
                  <button
                    type="button"
                    className="note-detail-close"
                    onClick={() => setMobileDetailOpen(false)}
                    aria-label="关闭详情"
                  >
                    <X size={16} />
                  </button>
                </span>
              </div>
              <div className="detail-content">
                <div className="detail-topic">
                  {rowKinds(selectedRow).has('highlight') && (
                    <i className={`hl-swatch ${selectedRow.anns.find((a) => a.kind === 'highlight')?.color ?? 'yellow'}`} />
                  )}
                  {rowKinds(selectedRow).has('underline') && <i className="ul-swatch" />}
                  {rowKinds(selectedRow).has('note') && <i className="note-swatch">✦</i>}
                  {kindLabel(rowKinds(selectedRow))}　·　{selectedRow.topic}
                </div>
                <blockquote>“{selectedRow.text}”</blockquote>

                {selectedRow.notes.length > 0 && (
                  <div className="detail-notes">
                    <span className="label">
                      我的笔记{selectedRow.notes.length > 1 ? `（${selectedRow.notes.length}）` : ''}
                    </span>
                    {selectedRow.notes.map((n) => (
                      <div className="detail-note" key={n.id}>
                        {editNoteId === n.id ? (
                          <>
                            <textarea
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              autoFocus
                            />
                            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                              <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => saveNoteEdit(n.id)}>
                                保存
                              </button>
                              <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => setEditNoteId(null)}>
                                取消
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="detail-note-text">{n.noteText || '（未填写）'}</p>
                            <button
                              className="text-btn"
                              style={{ display: 'block', marginTop: 8, color: 'var(--accent)' }}
                              onClick={() => {
                                setEditNoteId(n.id)
                                setNoteDraft(n.noteText ?? '')
                              }}
                            >
                              编辑笔记　↗
                            </button>
                          </>
                        )}
                        <div className="detail-tags">
                          {(n.tags ?? []).map((tag) => (
                            <span className="tag-chip" key={tag}>
                              #{tag}
                              <button onClick={() => removeTag(n.id, tag)} aria-label="删除标签">
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
                              if (e.key === 'Enter') addTag(n.id)
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="detail-source">
                  来源：{selectedRow.source} · {selectedRow.title}
                  <br />
                  <Link to={`/reading/${selectedRow.anns[0].articleId}`}>打开原文　↗</Link>
                  <br />
                  保存时间：{formatDateTime(selectedRow.date)}
                </div>

                <div className="detail-actions">
                  <button className="danger" onClick={() => deleteOne(selectedRow.key)}>
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
