import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Search, Trash2, X } from 'lucide-react'

import { useAnnotationStore } from '../stores/annotationStore'
import { useArticleStore } from '../stores/articleStore'
import { useLearningEventStore } from '../stores/learningEventStore'
import { reviewQueue } from '../lib/reviewQueue'
import { ReviewModal } from '../components/notes/ReviewModal'
import { toast } from '../components/ui/Toast'
import { formatLocalDate } from '../data'
import { downloadJSON, downloadText, formatDateTime, monthOf } from '../lib/export'
import { Pagination } from '../components/ui/Pagination'
import type { Annotation, AnnotationKind, MaterialType } from '../types'
import { MATERIAL_TYPES, MATERIAL_TYPE_LABELS } from '../data/material'
import { buildMaterialMarkdown } from '../lib/materialExport'

const PAGE_SIZE = 30

type QuickKey = 'all' | 'recent' | 'highlight' | 'underline' | 'note' | 'memorize'

const QUICK: { key: QuickKey; label: string }[] = [
  { key: 'all', label: '全部摘录' },
  { key: 'recent', label: '最近添加' },
  { key: 'highlight', label: '我的高亮' },
  { key: 'underline', label: '我的划线' },
  { key: 'note', label: '带笔记' },
  { key: 'memorize', label: '待背记' },
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
  /** 素材类型（组内第一个带标记的标注） */
  materialType?: MaterialType
}

function groupKey(a: Annotation): string {
  return `${a.articleId}|${a.start}|${a.end}`
}

function kindLabel(kinds: Set<AnnotationKind>): string {
  return [...kinds].map((k) => KIND_LABEL[k]).join(' · ')
}

export function NotesPage() {
  const annotations = useAnnotationStore((s) => s.annotations)
  const addAnnotation = useAnnotationStore((s) => s.add)
  const removeMany = useAnnotationStore((s) => s.removeMany)
  const update = useAnnotationStore((s) => s.update)
  const getArticle = useArticleStore((s) => s.getArticle)

  /* 筛选/搜索/页码进 URL：从阅读页返回时保留筛选，浏览器后退可回上一筛选态 */
  const [params, setParams] = useSearchParams()
  const quick = (params.get('quick') ?? 'all') as QuickKey
  const topic = params.get('topic') ?? ''
  const mat = (params.get('mat') ?? '') as MaterialType | 'none' | ''
  const q = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const applyParams = (mut: (n: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(params)
    mut(next)
    setParams(next, { replace })
  }
  const setParam = (key: string, value: string) =>
    applyParams((n) => {
      if (value) n.set(key, value)
      else n.delete(key)
      if (key !== 'page') n.delete('page')
    })

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  /* 复习翻转卡：到期队列由事件层时间戳计算（学习者数据模型第 4 期），?review=1 从首页直达 */
  const reviewParam = params.get('review') === '1'
  const [reviewOpen, setReviewOpen] = useState(reviewParam)
  const [editNoteId, setEditNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [patternDraft, setPatternDraft] = useState('')
  const patternTimerRef = useRef<number | null>(null)
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
          materialType: ann.materialType,
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

  const events = useLearningEventStore((s) => s.events)
  const eventsHydrated = useLearningEventStore((s) => s._hasHydrated)
  const dueQueue = useMemo(
    () => (eventsHydrated ? reviewQueue(annotations, events) : []),
    [annotations, events, eventsHydrated],
  )

  const rowKinds = (r: Row) => new Set(r.anns.map((a) => a.kind))

  const quickCounts = useMemo(() => {
    const m: Record<QuickKey, number> = { all: rows.length, recent: 0, highlight: 0, underline: 0, note: 0, memorize: 0 }
    const sevenDays = Date.now() - 7 * 24 * 3600 * 1000
    for (const r of rows) {
      if (new Date(r.date).getTime() > sevenDays) m.recent += 1
      const kinds = rowKinds(r)
      if (kinds.has('highlight')) m.highlight += 1
      if (kinds.has('underline')) m.underline += 1
      if (kinds.has('note')) m.note += 1
      if (r.anns.some((a) => a.memorized)) m.memorize += 1
    }
    return m
  }, [rows])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const sevenDays = Date.now() - 7 * 24 * 3600 * 1000
    return rows.filter((r) => {
      const kinds = rowKinds(r)
      if (quick === 'recent' && new Date(r.date).getTime() < sevenDays) return false
      if (quick === 'highlight' && !kinds.has('highlight')) return false
      if (quick === 'underline' && !kinds.has('underline')) return false
      if (quick === 'note' && !kinds.has('note')) return false
      if (quick === 'memorize' && !r.anns.some((a) => a.memorized === true)) return false
      if (mat === 'none' && r.materialType) return false
      if (mat && mat !== 'none' && r.materialType !== mat) return false
      if (topic && r.topic !== topic) return false
      if (kw) {
        const hay = `${r.text} ${r.notes.map((n) => n.noteText ?? '').join(' ')} ${r.title} ${r.topic} ${r.source}`.toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [rows, quick, topic, q, mat])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  /* 筛选后结果变少时钳到最后一页，避免出现「页内无内容」的假空态 */
  const curPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)

  const selectedRow = rows.find((r) => r.key === selectedKey) ?? pageItems[0] ?? null

  /* ---------- 防丢稿：批量勾选与句式模板 ---------- */
  // 筛选变化后，已选集合里不再可见的行应移除（避免「导出/删除选中」带上不可见条目）
  useEffect(() => {
    if (checked.size === 0) return
    const visible = new Set(filtered.map((r) => r.key))
    let changed = false
    for (const k of checked) if (!visible.has(k)) { changed = true; break }
    if (!changed) return
    setChecked((prev) => {
      const next = new Set<string>()
      for (const k of prev) if (visible.has(k)) next.add(k)
      return next
    })
  }, [filtered, checked])

  // 句式模板输入：受控 + 300ms 防抖 + 切行/卸载时 flush
  const patternAnn = selectedRow?.anns.find((a) => a.materialType === 'pattern')
  useEffect(() => {
    setPatternDraft(patternAnn?.pattern ?? '')
    if (patternTimerRef.current) {
      window.clearTimeout(patternTimerRef.current)
      patternTimerRef.current = null
    }
  }, [patternAnn?.id, patternAnn?.pattern])
  useEffect(() => {
    return () => {
      if (patternTimerRef.current) window.clearTimeout(patternTimerRef.current)
    }
  }, [])

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

  /** 导出 Markdown：申论素材合集格式（类型固定顺序 + 句式带模板，可直接当写作参考） */
  const exportMarkdown = () => {
    const data = checked.size > 0 ? filtered.filter((r) => checked.has(r.key)) : filtered
    downloadText(
      `readbook-materials-${new Date().toISOString().slice(0, 10)}.md`,
      buildMaterialMarkdown(data),
    )
  }

  /** 删除摘录：不弹确认，5 秒内可撤销（误触一键恢复整段标注与笔记） */
  const undoableRemove = (removed: Annotation[]) => {
    removeMany(removed.map((a) => a.id))
    toast(`已删除${removed.length > 1 ? ` ${removed.length} 条摘录` : '摘录'}`, {
      actionLabel: '撤销',
      onAction: () => {
        for (const a of removed) {
          const { id: _omit, ...rest } = a
          addAnnotation(rest)
        }
      },
    })
  }

  const deleteSelected = () => {
    if (checked.size === 0) return
    undoableRemove(selectedAnns(checked))
    setChecked(new Set())
    setSelectedKey(null)
  }

  const deleteOne = (key: string) => {
    const row = rows.find((r) => r.key === key)
    if (!row) return
    undoableRemove(row.anns)
    if (selectedKey === key) setSelectedKey(null)
  }

  const saveNoteEdit = (id: string) => {
    update(id, { noteText: noteDraft.trim() })
    setEditNoteId(null)
  }

  const addTag = (id: string) => {
    const raw = tagDraft.trim()
    if (!raw) return
    const tag = raw.replace(/^#/, '')
    if (!tag) return
    const ann = annotations.find((a) => a.id === id)
    if (ann && (ann.tags ?? []).includes(tag)) {
      toast('该标签已存在')
      return
    }
    if (ann) update(id, { tags: [...(ann.tags ?? []), tag] })
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
              const count = quickCounts[item.key]
              return (
                <button
                  key={item.key}
                  className={quick === item.key && !topic ? 'active' : ''}
                  onClick={() =>
                    applyParams((n) => {
                      if (item.key === 'all') n.delete('quick')
                      else n.set('quick', item.key)
                      n.delete('topic')
                      n.delete('page')
                    })
                  }
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
                onClick={() =>
                  applyParams((n) => {
                    if (t === topic) n.delete('topic')
                    else n.set('topic', t)
                    n.delete('quick')
                    n.delete('page')
                  })
                }
              >
                {t} <small>{c}</small>
              </button>
            ))}
          </nav>
        </aside>

        <section className="notes-main">
          <div className="main-top">
            <span className="result-count">
              {filtered.length} 条摘录　/　按时间分组
              {dueQueue.length > 0 && (
                <button className="text-btn review-entry" onClick={() => setReviewOpen(true)}>
                  　·　开始复习（{dueQueue.length} 条到期）
                </button>
              )}
            </span>
            <label className="note-search">
              <Search size={13} style={{ color: 'var(--muted)' }} />
              <input
                placeholder="搜索摘录、主题或来源"
                value={q}
                onChange={(e) =>
                  applyParams((n) => {
                    if (e.target.value) n.set('q', e.target.value)
                    else n.delete('q')
                    n.delete('page')
                  }, true)
                }
              />
              {q && (
                <button
                  className="text-btn"
                  style={{ color: 'var(--muted)', display: 'inline-flex' }}
                  onClick={() => applyParams((n) => { n.delete('q'); n.delete('page') })}
                  aria-label="清除搜索"
                >
                  <X size={12} />
                </button>
              )}
            </label>
          </div>

          {/* 素材类型筛选（含未标记素材） */}
          <div className="mat-filter">
            <button
              className={`mat-chip${!mat ? ' active' : ''}`}
              onClick={() => setParam('mat', '')}
            >
              全部
            </button>
            {MATERIAL_TYPES.map((t) => (
              <button
                key={t}
                className={`mat-chip mat-chip-${t}${mat === t ? ' active' : ''}`}
                onClick={() => setParam('mat', mat === t ? '' : t)}
              >
                {MATERIAL_TYPE_LABELS[t]}
              </button>
            ))}
            <button
              className={`mat-chip${mat === 'none' ? ' active' : ''}`}
              onClick={() => setParam('mat', mat === 'none' ? '' : 'none')}
            >
              未标记素材
            </button>
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
              {rows.length === 0 ? (
                <>
                  <strong>还没有摘录</strong>
                  在阅读页选中文字，即可高亮、划线或添加笔记
                </>
              ) : (
                <>
                  <strong>没有匹配的摘录</strong>
                  换个关键词或筛选条件试试
                </>
              )}
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
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedKey(r.key)
                      setMobileDetailOpen(true)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedKey(r.key)
                        setMobileDetailOpen(true)
                      }
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
                      {r.materialType && (
                        <i className={`mat-chip mat-chip-${r.materialType}`}>{MATERIAL_TYPE_LABELS[r.materialType]}</i>
                      )}
                      {r.anns.some((a) => a.memorized) && <i className="note-swatch memo">★</i>}
                      {r.text}
                    </span>
                    <span className="note-topic">
                      {r.topic}
                      {kinds.size > 1 && <em className="note-kinds">+{kinds.size - 1}</em>}
                    </span>
                    <span className="note-date">{formatLocalDate(r.date)}</span>
                  </div>
                )
              })}
            </div>
          ))}

          <Pagination page={curPage} totalPages={totalPages} onChange={(p) => setParam('page', String(p))} />
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

                {/* 素材类型 + 背记（金句/句式） + 句式模板 */}
                {(() => {
                  const m = selectedRow.anns.find((a) => a.materialType)
                  if (!m) return null
                  const canMemo = m.materialType === 'quote' || m.materialType === 'pattern'
                  return (
                    <div className="detail-material">
                      <span className={`mat-chip mat-chip-${m.materialType} active`}>
                        {MATERIAL_TYPE_LABELS[m.materialType!]}
                      </span>
                      {canMemo && (
                        <>
                          <button
                            className={`memo-star${m.memorized ? ' on' : ''}`}
                            onClick={() =>
                              update(m.id, { memorized: !m.memorized, mastery: !m.memorized ? 0 : undefined })
                            }
                          >
                            {m.memorized ? '★ 已入背记' : '☆ 加入背记'}
                          </button>
                          {m.memorized && (
                            <span className="mastery-dots">
                              {[0, 1, 2].map((lv) => (
                                <button
                                  key={lv}
                                  className={(m.mastery ?? 0) >= lv && (m.mastery ?? 0) > 0 ? 'on' : ''}
                                  onClick={() => update(m.id, { mastery: lv as 0 | 1 | 2 })}
                                >
                                  {lv === 0 ? '○' : lv === 1 ? '◐' : '●'}
                                </button>
                              ))}
                            </span>
                          )}
                        </>
                      )}
                      {m.materialType === 'pattern' && (
                        <input
                          className="pattern-edit"
                          placeholder="可迁移模板，如：以……之笔，绘就……画卷"
                          value={patternDraft}
                          onChange={(e) => {
                            const v = e.target.value
                            setPatternDraft(v)
                            if (patternTimerRef.current) window.clearTimeout(patternTimerRef.current)
                            patternTimerRef.current = window.setTimeout(
                              () => update(m.id, { pattern: v.trim() || undefined }),
                              300,
                            )
                          }}
                          onBlur={(e) => {
                            if (patternTimerRef.current) {
                              window.clearTimeout(patternTimerRef.current)
                              patternTimerRef.current = null
                            }
                            update(m.id, { pattern: e.target.value.trim() || undefined })
                          }}
                        />
                      )}
                    </div>
                  )
                })()}

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
                  <Link to={`/reading/${selectedRow.anns[0].articleId}?ann=${selectedRow.anns[0].id}`}>打开原文　↗</Link>
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
      {reviewOpen && dueQueue.length > 0 && <ReviewModal queue={dueQueue} onClose={() => setReviewOpen(false)} />}
    </section>
  )
}
