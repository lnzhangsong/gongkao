import { useEffect, useMemo, useState } from 'react'
import { addTerm, deleteTerm, fetchTerms, updateTerm, type GuiFanTerm } from '../lib/api'
import { toast } from '../components/ui/Toast'
import { alertDialog } from '../components/ui/ConfirmDialog'
import { Pagination } from '../components/ui/Pagination'
/* .exam-page/.exam-hero 容器版式定义在 exam-preview.css（真题页组件私有的，这里复用需显式引入） */
import '../styles/exam-preview.css'
import '../styles/terms.css'

/**
 * 申论规范词（/terms）：一次拉全量，前端做主题分组 + 词面/例句搜索。
 * 数据来自 guifan_terms 表（import-guifanci.mjs 从规范词合集 md 全量重建），
 * 支持本地新增/删除（与真题编辑一样仅本地 api-server 提供写接口）。
 */

const orderedThemes = (terms: GuiFanTerm[]) => {
  const counts = new Map<string, number>()
  for (const t of terms) counts.set(t.theme, (counts.get(t.theme) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

export default function TermsPage() {
  const [terms, setTerms] = useState<GuiFanTerm[] | null>(null)
  /** 列表拉取失败（服务不可用）：显示错误态 + 重试，而不是误导性的「没有匹配」 */
  const [loadError, setLoadError] = useState(false)
  const [theme, setTheme] = useState<string>('')
  const [q, setQ] = useState('')
  /* 分页：3000+ 卡全量渲染滚动/过滤会卡 */
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 60
  /* 新增表单（与真题页「新增试卷」同交互） */
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ theme: '', term: '', example: '' })
  /* 提交 busy：防双击重复提交 + 慢网络下给「处理中」反馈 */
  const [busy, setBusy] = useState(false)
  /* 行内编辑（一次只编一张卡） */
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ theme: '', term: '', example: '' })

  const load = () =>
    fetchTerms()
      .then((r) => {
        setTerms(r.terms)
        setLoadError(false)
      })
      .catch(() => {
        setTerms([])
        setLoadError(true)
      })
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const themes = useMemo(() => (terms ? orderedThemes(terms) : []), [terms])

  const filtered = useMemo(() => {
    if (!terms) return []
    const kw = q.trim()
    return terms.filter(
      (t) =>
        (!theme || t.theme === theme) &&
        (!kw || t.term.includes(kw) || t.example.includes(kw)),
    )
  }, [terms, theme, q])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)
  const changeFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  const grouped = useMemo(() => {
    const g = new Map<string, GuiFanTerm[]>()
    for (const t of pageItems) {
      if (!g.has(t.theme)) g.set(t.theme, [])
      g.get(t.theme)!.push(t)
    }
    return [...g.entries()]
  }, [pageItems])

  const submitAdd = async () => {
    const term = form.term.trim()
    if (!term) {
      void alertDialog('规范词必填')
      return
    }
    setBusy(true)
    try {
      await addTerm({ theme: form.theme.trim() || '综合其他', term, example: form.example.trim() })
      setAdding(false)
      setForm({ theme: '', term: '', example: '' })
      await load()
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (t: GuiFanTerm) => {
    setEditingId(t.id)
    setEditForm({ theme: t.theme, term: t.term, example: t.example })
  }

  const submitEdit = async () => {
    if (editingId === null) return
    const term = editForm.term.trim()
    if (!term) {
      void alertDialog('规范词必填')
      return
    }
    setBusy(true)
    try {
      await updateTerm(editingId, { theme: editForm.theme.trim(), term, example: editForm.example.trim() })
      setTerms((prev) => prev?.map((x) => (x.id === editingId ? { ...x, theme: editForm.theme.trim(), term, example: editForm.example.trim() } : x)) ?? prev)
      setEditingId(null)
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t: GuiFanTerm) => {
    try {
      await deleteTerm(t.id)
      setTerms((prev) => prev?.filter((x) => x.id !== t.id) ?? prev)
      /* 服务端删除：撤销 = 按原内容重新添加（新 id，内容不变） */
      toast(`已删除「${t.term}」`, {
        actionLabel: '撤销',
        onAction: () => {
          void addTerm({ theme: t.theme, term: t.term, example: t.example })
            .then(() => load())
            .catch(() => {})
        },
      })
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="exam-page terms-page">
      <header className="subpage-header exam-hero">
        <div>
          <div className="eyebrow">SHENLUN GUIFANCI　/　{terms ? `${terms.length} 词` : "…"}</div>
          <h1>
            规范表达，
            <br />
            <span>写进卷面。</span>
          </h1>
        </div>
        <div className="exam-hero-side">
          <p className="subpage-copy">
            申论材料里的「口语表述」，对应卷面上的「规范词」。按主题积累，做题时把大白话翻译成得分语言。
          </p>
          <input
            className="terms-search"
            type="search"
            placeholder="搜索词面或例句…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {adding ? (
            <div className="terms-new-form">
              <input
                className="exam-new-input"
                placeholder="主题（留空归入综合其他）"
                value={form.theme}
                onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value }))}
              />
              <input
                className="exam-new-input exam-new-title"
                placeholder="规范词 *"
                value={form.term}
                onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) void submitAdd()
                  if (e.key === 'Escape') setAdding(false)
                }}
              />
              <input
                className="terms-new-example"
                placeholder="例句（材料里的口语表述，可空）"
                value={form.example}
                onChange={(e) => setForm((f) => ({ ...f, example: e.target.value }))}
              />
              <button className="ghost" onClick={submitAdd} disabled={busy}>
                {busy ? '添加中…' : '添加'}
              </button>
              <button className="text-btn muted" onClick={() => setAdding(false)}>取消</button>
            </div>
          ) : (
            <button className="ghost" onClick={() => setAdding(true)}>＋ 新增规范词</button>
          )}
        </div>
      </header>

      {/* 主题筛选 chips（按条数降序，含「全部」） */}
      {terms !== null && themes.length > 0 && (
        <nav className="terms-theme-bar" aria-label="主题筛选">
          <button className={`terms-chip${theme === '' ? ' active' : ''}`} onClick={() => setTheme('')}>
            全部　{terms.length}
          </button>
          {themes.map(([name, count]) => (
            <button key={name} className={`terms-chip${theme === name ? ' active' : ''}`} onClick={() => changeFilter(() => setTheme(theme === name ? '' : name))}>
              {name}　{count}
            </button>
          ))}
        </nav>
      )}

      {loadError && terms !== null && (
        <div className="empty-state">
          <strong>规范词库暂时无法加载</strong>
          本地 API 服务可能没有启动，服务恢复后可重试。
          <div style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => void load()}>重试</button>
          </div>
        </div>
      )}

      {!loadError && terms !== null && filtered.length === 0 && (
        <p className="terms-empty">没有匹配「{q}」的规范词，换个说法试试。</p>
      )}

      <div key={terms === null ? 'loading' : 'ready'} className={terms !== null ? 'fade-in' : undefined}>
      {grouped.map(([name, list]) => (
        <section key={name}>
          <div className="content-head exam-year-head terms-theme-head">
            <h2>{name}</h2>
            <span>{list.length} 词</span>
          </div>
          <div className="terms-grid">
            {list.map((t) =>
              editingId === t.id ? (
                <article key={t.id} className="terms-card terms-card-editing">
                  <input
                    className="terms-edit-input"
                    value={editForm.theme}
                    placeholder="主题"
                    onChange={(e) => setEditForm((f) => ({ ...f, theme: e.target.value }))}
                  />
                  <input
                    className="terms-edit-input terms-edit-term"
                    value={editForm.term}
                    placeholder="规范词 *"
                    autoFocus
                    onChange={(e) => setEditForm((f) => ({ ...f, term: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy) void submitEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <textarea
                    className="terms-edit-input terms-edit-example"
                    rows={2}
                    value={editForm.example}
                    placeholder="例句（可空）"
                    onChange={(e) => setEditForm((f) => ({ ...f, example: e.target.value }))}
                  />
                  <div className="terms-edit-actions">
                    <button className="ghost" onClick={submitEdit} disabled={busy}>
                      {busy ? '保存中…' : '保存'}
                    </button>
                    <button className="text-btn muted" onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </article>
              ) : (
                <article key={t.id} className="terms-card">
                  <h4>{t.term}</h4>
                  {t.example ? <p className="terms-example">{t.example}</p> : null}
                  <span className="terms-card-tools">
                    <button className="text-btn terms-del-btn" title="修改此词" onClick={() => startEdit(t)}>
                      编辑
                    </button>
                    <button
                      className="text-btn terms-del-btn"
                      title="删除此词"
                      onClick={() => void remove(t)}
                    >
                      删除
                    </button>
                  </span>
                </article>
              ),
            )}
          </div>
        </section>
      ))}
      </div>
      <Pagination page={curPage} totalPages={totalPages} onChange={setPage} />
    </div>
  )
}
