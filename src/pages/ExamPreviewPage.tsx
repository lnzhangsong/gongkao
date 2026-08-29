import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createExam, deleteExam, fetchExam, fetchExamList, saveExam, type ExamDetail, type ExamPaperMeta, type ExamQuestion } from '../lib/api'
import { alertDialog, confirmDialog } from '../components/ui/ConfirmDialog'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { useCycleTheme } from '../hooks/useCycleTheme'
import { loadFontFamily } from '../lib/fonts'
import { useFocusMode } from '../lib/useFocusMode'
import { ReaderToolsPanel } from '../components/reading/ReaderToolsPanel'
import { ExamQuestionView } from '../components/exam/ExamQuestionView'
import { ExamQuestionEditor } from '../components/exam/ExamQuestionEditor'
import {
  joinParagraphs,
  reflowParagraphs,
  reflowInline,
  questionMaterials,
  levelClass,
  levelMark,
} from '../lib/examText'
import '../styles/exam-preview.css'

/**
 * 申论真题（/exams）：列表 + 详情
 * 详情正文直接复用阅读页排版（article-head / article-body / 阅读设置变量），
 * 题目与参考答案在正文语言之上做专门设计（mono 题头 + 答题纸式答案面板）。
 * 文本工具（重排/题干抽取/材料关联）在 lib/examText.ts。
 */

export default function ExamPreviewPage() {
  const [papers, setPapers] = useState<ExamPaperMeta[] | null>(null)
  const [draft, setDraft] = useState<ExamDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newForm, setNewForm] = useState({ year: String(new Date().getFullYear() + 1), level: '地市级', title: '' })
  /* 折叠的材料（阅读态点击材料标签收起/展开） */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const toggleCollapsed = (idx: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  /* 与阅读页同源的排版设置与工具面板（字体/字号/行距/主题），正文渲染完全一致 */
  const settings = useReaderStore((s) => s.settings)
  const bodyRef = useRef<HTMLDivElement>(null)
  /* 段落聚焦：与阅读页共用同一 hook（面板「段落聚焦」开关直接生效） */
  useFocusMode(bodyRef, settings.focusMode, draft !== null)
  const setFontSize = useReaderStore((s) => s.setFontSize)
  const setLabelFontSize = useReaderStore((s) => s.setLabelFontSize)
  const setFontFamily = useReaderStore((s) => s.setFontFamily)
  const setFocusMode = useReaderStore((s) => s.setFocusMode)
  const setTermBox = useReaderStore((s) => s.setTermBox)
  const [activeTheme, cycleTheme] = useCycleTheme()
  const readerVars = useMemo<CSSProperties>(
    () =>
      ({
        '--reader-font-size': `${settings.fontSize}px`,
        '--reader-line-height': String(settings.lineHeight),
        '--reader-font-family': fontFamilyCss(settings.fontFamily),
        '--label-size': `${settings.labelFontSize ?? 13}px`,
      }) as CSSProperties,
    [settings.fontSize, settings.lineHeight, settings.fontFamily, settings.labelFontSize],
  )
  useEffect(() => {
    void loadFontFamily(settings.fontFamily)
  }, [settings.fontFamily])

  useEffect(() => {
    fetchExamList().then((r) => setPapers(r.papers)).catch(() => setPapers([]))
  }, [])

  /* 返回列表时恢复进入前的滚动位置 */
  const listScrollRef = useRef(0)
  const [inList, setInList] = useState(true)
  useEffect(() => {
    if (inList) window.scrollTo({ top: listScrollRef.current })
  }, [inList])

  const open = (id: string) => {
    listScrollRef.current = window.scrollY
    setInList(false)
    setDraft(null)
    setLoadingDetail(true)
    setEditing(false)
    setDirty(false)
    setSavedAt(null)
    window.scrollTo({ top: 0 })
    fetchExam(id)
      .then((d) => setDraft(cloneDraft(d)))
      .catch(() => setDraft(null))
      .finally(() => setLoadingDetail(false))
  }

  const backToList = () => {
    setDraft(null)
    setEditing(false)
    setDirty(false)
    setInList(true)
  }

  /* 浅层不可变更新：只拷贝对象外壳（数组 + 单项），字符串不可变无需拷贝。
     原实现 structuredClone 整卷，编辑长卷时每次键入都深拷贝数万字 */
  const patchDraft = (fn: (d: ExamDetail) => void) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next: ExamDetail = {
        ...prev,
        materials: prev.materials.map((m) => ({ ...m })),
        questions: prev.questions.map((q) => ({ ...q })),
      }
      fn(next)
      return next
    })
    setDirty(true)
  }

  /** 单题补丁：patchDraft + 按 idx 定位（题目编辑器子组件用） */
  const patchQuestion = (fn: (t: ExamQuestion) => void, idx: number) =>
    patchDraft((d) => {
      const t = d.questions.find((x) => x.idx === idx)
      if (t) fn(t)
    })

  /* 快速跳转：平滑滚动到材料/题目锚点 */
  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /* 上移/下移材料或题目（移动后按数组顺序重排 idx） */
  const moveItem = (list: 'materials' | 'questions', key: number, delta: -1 | 1) =>
    patchDraft((d) => {
      const arr = d[list]
      const i = arr.findIndex((x) => x.idx === key)
      const j = i + delta
      if (i < 0 || j < 0 || j >= arr.length) return
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      arr.forEach((x, k) => void (x.idx = k + 1))
    })

  /* 题目 idx → 关联材料编号（渲染前统一算好，避免阅读态每题每次渲染重复 matchAll） */
  const materialAnchors = useMemo(() => {
    const map = new Map<number, number[]>()
    if (!draft) return map
    for (const q of draft.questions) map.set(q.idx, questionMaterials(q))
    return map
  }, [draft])
  /* 材料编号 → 锚点 id（label 匹配优先，否则按位置取） */
  const anchorByNum = useMemo(() => {
    const map = new Map<number, string>()
    if (!draft) return map
    for (let n = 1; n <= draft.materials.length + 5; n++) {
      const byLabel = draft.materials.find((m) => new RegExp(`[材资]料${n}(?![0-9])`).test(m.label) || m.label.includes(`资料${n}`))
      const target = byLabel ?? draft.materials[n - 1]
      if (target) map.set(n, `exam-mat-${target.idx}`)
    }
    return map
  }, [draft])

  const reflowAll = () =>
    patchDraft((d) => {
      for (const m of d.materials) m.content = reflowParagraphs(m.content)
      for (const q of d.questions) {
        q.stem = reflowInline(q.stem)
        q.requirement = reflowParagraphs(q.requirement.replace(/\n+/g, '\n'))
        if (q.answer) q.answer = reflowParagraphs(q.answer)
      }
    })

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const { id: newId } = await saveExam(draft.id, {
        year: draft.year,
        level: draft.level,
        title: draft.title,
        materials: draft.materials.map((m) => ({ idx: m.idx, content: m.content })),
        questions: draft.questions.map((q) => ({
          idx: q.idx, type: q.type, stem: q.stem, requirement: q.requirement,
          wordLimit: q.wordLimit, points: q.points, answer: q.answer,
        })),
      })
      if (newId !== draft.id) setDraft((prev) => (prev ? { ...prev, id: newId } : prev))
      fetchExamList().then((r) => setPapers(r.papers)).catch(() => {})
      setDirty(false)
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const grouped = useMemo(() => {
    const g = new Map<number, ExamPaperMeta[]>()
    for (const p of papers ?? []) {
      if (!g.has(p.year)) g.set(p.year, [])
      g.get(p.year)!.push(p)
    }
    return [...g.entries()].sort((a, b) => b[0] - a[0])
  }, [papers])

  // ---------- 详情：详情骨架（阅读页段落排版 + 材料标签气口，样式见 exam-preview.css） ----------
  if (!draft && loadingDetail) {
    return (
      <section className="reading-page">
        <main className="reading-layout">
          <article>
            <header className="article-head exam-sk-head" aria-hidden="true">
              <span className="exam-sk-line exam-sk-tag" />
              <span className="exam-sk-line exam-sk-title" />
              <span className="exam-sk-line exam-sk-meta" />
            </header>
            <span className="exam-sk-line exam-sk-secbar" aria-hidden="true" />
            <div className="article-body exam-sk-body" aria-hidden="true">
              {/* 段落组之间穿插「材料N」标签占位，模拟真实详情的节奏 */}
              {[
                { paras: [3, 2, 3] },
                { paras: [3, 2] },
                { paras: [2, 3, 2] },
              ].map((mat, gi) => (
                <div key={gi}>
                  <span className="exam-sk-line exam-sk-matlabel" />
                  {mat.paras.map((lines, pi) => (
                    <div className="reading-loading" key={pi}>
                      <div className="skeleton-para">
                        {Array.from({ length: lines }).map((_, i) => (
                          <span
                            key={i}
                            className={`skeleton-line${i === 0 ? ' first' : ''}${i === lines - 1 ? ' last' : ''}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </article>
        </main>
      </section>
    )
  }

  // ---------- 详情：复用阅读页排版 ----------
  if (draft) {
    const answered = draft.questions.filter((q) => q.answer).length
    return (
      <section className="reading-page">
        <main className={`reading-layout${settings.measure === 'narrow' ? ' narrow-measure' : ''}`}>
          <article>
          <header className="article-head">
            <button
              type="button"
              className="tag exam-tag-link"
              onClick={async () => {
                if (dirty && !(await confirmDialog('有未保存修改，确定离开？'))) return
                backToList()
              }}
            >
              申论真题　/　{draft.year} · {draft.level}
            </button>
            {editing ? (
              <input
                className="exam-title-input"
                value={draft.title}
                onChange={(e) => patchDraft((d) => void (d.title = e.target.value))}
              />
            ) : (
              <h1>{draft.title}</h1>
            )}
            <div className="article-meta">
              <span>材料　{draft.materials.length}</span>
              <span>题目　{draft.questions.length}</span>
              <span>答案　{answered ? `${answered}/${draft.questions.length}` : '无'}</span>
              {draft.warnings ? <span className="exam-warn">⚠ {draft.warnings}</span> : null}
              {!editing && <button className="text-btn exam-edit-btn" onClick={() => setEditing(true)}>编辑</button>}
            </div>
            {editing && (
              <div className="exam-edit-bar">
                <span className="exam-edit-field">
                  <label>年份</label>
                  <input
                    type="number"
                    className="exam-select exam-year-input"
                    value={draft.year}
                    min={2000}
                    max={2100}
                    onChange={(e) => patchDraft((d) => void (d.year = parseInt(e.target.value, 10) || d.year))}
                  />
                </span>
                <span className="exam-edit-field">
                  <label>级别</label>
                  <select
                    className="exam-select"
                    value={draft.level}
                    onChange={(e) => patchDraft((d) => void (d.level = e.target.value))}
                  >
                    {[...new Set([draft.level, '副省级', '地市级', '行政执法'])].map((lv) => (
                      <option key={lv} value={lv}>{lv}</option>
                    ))}
                  </select>
                </span>
                {savedAt ? <span className="exam-saved">已保存 {savedAt}</span> : null}
                {dirty ? <span className="exam-warn">未保存</span> : null}
                <span className="exam-edit-actions">
                  <button className="ghost" onClick={reflowAll}>一键重排换行</button>
                  <button className="ghost exam-btn-primary" onClick={save} disabled={saving || !dirty}>
                    {saving ? '保存中…' : '保存'}
                  </button>
                  <button className="ghost" onClick={() => setEditing(false)}>退出编辑</button>
                  <button
                    className="text-btn exam-del-btn"
                    onClick={async () => {
                      if (!(await confirmDialog(`确定删除整张试卷「${draft.title}」？其材料与题目会一并删除，且不可恢复。`, { danger: true }))) return
                      try {
                        await deleteExam(draft.id)
                        backToList()
                        setPapers((prev) => prev?.filter((p) => p.id !== draft.id) ?? prev)
                      } catch (e) {
                        void alertDialog(e instanceof Error ? e.message : String(e))
                      }
                    }}
                  >
                    删除试卷
                  </button>
                </span>
              </div>
            )}
          </header>

          <div className="exam-sec-bar">
            <span>给定资料 · {draft.materials.length} 段</span>
              {editing && (
                <button
                  className="text-btn exam-add-btn"
                  onClick={() => patchDraft((d) => void d.materials.push({ idx: (d.materials.at(-1)?.idx ?? 0) + 1, label: `材料${d.materials.length + 1}`, content: '' }))}
                >
                  ＋ 添加材料
                </button>
              )}
          </div>
          {/* 快速跳转：材料锚点 + 作答要求（阅读态显示） */}
          {!editing && draft.materials.length > 0 && (
            <nav className="exam-jump" aria-label="材料快速跳转">
              {draft.materials.map((m, i) => (
                <button key={m.idx} className="exam-jump-chip" onClick={() => jumpTo(`exam-mat-${m.idx}`)}>
                  {m.label || `材料${i + 1}`}
                </button>
              ))}
              <button className="exam-jump-chip exam-jump-qs" onClick={() => jumpTo('exam-qs-anchor')}>
                作答要求 ↓
              </button>
            </nav>
          )}
          <div
            ref={bodyRef}
              className={`article-body${settings.focusMode ? ' focus-mode' : ''}${settings.indent ? '' : ' no-indent'}`}
              style={readerVars}
            >
              {editing
                ? draft.materials.map((m) => (
                    <Fragment key={m.idx}>
                      <h3 className="exam-mat-label">
                        <span>{m.label}</span>
                        <span className="exam-move-group">
                          <button className="exam-move-btn" title="上移" disabled={m.idx === 1} onClick={() => moveItem('materials', m.idx, -1)}>↑</button>
                          <button className="exam-move-btn" title="下移" disabled={m.idx === draft.materials.length} onClick={() => moveItem('materials', m.idx, 1)}>↓</button>
                        </span>
                        <button
                          className="text-btn exam-del-btn"
                          onClick={() => patchDraft((d) => void (d.materials = d.materials.filter((x) => x.idx !== m.idx)))}
                        >
                          删除此段
                        </button>
                      </h3>
                      <textarea
                        className="exam-ta"
                        rows={Math.min(20, Math.max(4, Math.ceil(m.content.length / 40)))}
                        value={m.content}
                        onChange={(e) => patchDraft((d) => void (d.materials.find((x) => x.idx === m.idx)!.content = e.target.value))}
                      />
                    </Fragment>
                  ))
                : draft.materials.map((m) => (
                    <Fragment key={m.idx}>
                      <h3
                        className={`exam-mat-label exam-mat-toggle${collapsed.has(m.idx) ? ' collapsed' : ''}`}
                        id={`exam-mat-${m.idx}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleCollapsed(m.idx)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleCollapsed(m.idx)
                          }
                        }}
                      >
                        <span>{m.label}</span>
                        <span className="exam-mat-meta">
                          {m.content.length} 字　{collapsed.has(m.idx) ? '▸' : '▾'}
                        </span>
                      </h3>
                      {!collapsed.has(m.idx) &&
                        joinParagraphs(m.content).map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                    </Fragment>
                  ))}
          </div>

          <section className="exam-questions" id="exam-qs-anchor" style={readerVars}>
            <div className="content-head">
              <h2>作答要求</h2>
              <span>
                {draft.questions.length} 题
                {editing && (
                  <button
                    className="text-btn exam-add-btn"
                    onClick={() => patchDraft((d) => void d.questions.push({ idx: (d.questions.at(-1)?.idx ?? 0) + 1, type: null, stem: '', requirement: '', wordLimit: null, points: null, answer: null, answerMatched: false }))}
                  >
                    　＋ 添加题目
                  </button>
                )}
              </span>
            </div>
            {draft.questions.map((q) => (
              <article key={q.idx} className="exam-q">
                <header className="exam-q-head">
                  <span className="exam-q-id">
                    <span className="exam-q-idx">第{q.idx}题</span>
                    {q.type ? (
                      <span className={`exam-q-type${q.type === '大作文' ? ' major' : ''}`}>{q.type}</span>
                    ) : (
                      <span className="exam-q-type">未分类</span>
                    )}
                  </span>
                  <span className="exam-q-chips">
                    {q.wordLimit ? <span>≤{q.wordLimit}字</span> : null}
                    {q.points ? <span>{q.points}分</span> : null}
                  </span>
                </header>
                {editing ? (
                  <ExamQuestionEditor
                    q={q}
                    total={draft.questions.length}
                    patch={patchQuestion}
                    move={(key, delta) => moveItem('questions', key, delta)}
                    onDelete={() => patchDraft((d) => void (d.questions = d.questions.filter((x) => x.idx !== q.idx)))}
                  />
                ) : (
                  <ExamQuestionView
                    q={q}
                    materialAnchors={materialAnchors}
                    anchorByNum={anchorByNum}
                    onJump={jumpTo}
                    indent={settings.indent}
                  />
                )}
              </article>
            ))}
            {!editing && !draft.questions.some((q) => q.answer) && draft.answersRaw ? (
              <div className="exam-raw">
                <button className="ghost" onClick={() => setShowRaw(!showRaw)}>
                  {showRaw ? '收起答案全文' : '本题库未按题对齐，展开答案全文'}
                </button>
                {showRaw && (
                  <div className="exam-answer-sheet">
                    {joinParagraphs(draft.answersRaw).map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </section>
          </article>

          <ReaderToolsPanel
            settings={settings}
            onFontSizeDelta={(delta) => setFontSize(settings.fontSize + delta)}
            onFontFamily={setFontFamily}
            labelFontSize={settings.labelFontSize ?? 13}
            onLabelFontSizeDelta={(delta) => setLabelFontSize((settings.labelFontSize ?? 13) + delta)}
            activeTheme={activeTheme}
            onCycleTheme={cycleTheme}
            favorite={false}
            onToggleFavorite={() => {}}
            annotationsVisible={false}
            onToggleAnnotations={() => {}}
            onToggleFocus={() => setFocusMode(!settings.focusMode)}
            onToggleTermBox={() => setTermBox(!settings.termBox)}
          />
        </main>
      </section>
    )
  }

  // ---------- 列表 ----------
  return (
    <div className="exam-page">
      <header className="subpage-header exam-hero">
        <div>
          <div className="eyebrow">GUOKAO SHENLUN　/　2000–2026</div>
          <h1>
            把真题，
            <br />
            <span>读成素材。</span>
          </h1>
        </div>
        <div className="exam-hero-side">
          <p className="subpage-copy">历年国考申论真题与参考答案，按年份、层级整理，和人民日报时评对照着读。</p>
          {creating ? (
            <div className="exam-new-form">
              <input
                className="exam-new-input"
                type="number"
                value={newForm.year}
                onChange={(e) => setNewForm((f) => ({ ...f, year: e.target.value }))}
                aria-label="年份"
              />
              <select
                className="exam-new-select"
                value={newForm.level}
                onChange={(e) => setNewForm((f) => ({ ...f, level: e.target.value }))}
                aria-label="层级"
              >
                {['副省级', '地市级', '行政执法', '未分级'].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <input
                className="exam-new-input exam-new-title"
                placeholder="试卷标题"
                value={newForm.title}
                onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))}
              />
              <button
                className="ghost"
                onClick={async () => {
                  const year = parseInt(newForm.year, 10)
                  const title = newForm.title.trim() || `${year}年国家公务员考试《申论》题（${newForm.level}）`
                  try {
                    const { id } = await createExam({ year, level: newForm.level, title })
                    setCreating(false)
                    open(id)
                    setEditing(true)
                  } catch (e) {
                    void alertDialog(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                创建
              </button>
              <button className="text-btn muted" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          ) : (
            <button className="ghost" onClick={() => setCreating(true)}>
              ＋ 新增试卷
            </button>
          )}
        </div>
      </header>
      {/* 首次加载：试卷卡骨架（与 .exam-card 同构，内部细线 shimmer，样式见 exam-preview.css） */}
      {papers === null && (
        <div className="exam-grid exam-grid-loading" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} className="exam-sk-card" style={{ ['--d' as string]: `${i * 0.12}s` }}>
              <span className="exam-sk-line sk-tag" style={{ ['--d' as string]: `${i * 0.12}s` }} />
              <span>
                <span className="exam-sk-line sk-title" style={{ ['--d' as string]: `${i * 0.12 + 0.05}s` }} />
                <span className="exam-sk-line sk-title w2" style={{ ['--d' as string]: `${i * 0.12 + 0.1}s`, marginTop: 10 }} />
              </span>
              <span className="exam-sk-line sk-meta" style={{ ['--d' as string]: `${i * 0.12 + 0.15}s` }} />
            </span>
          ))}
        </div>
      )}
      {grouped.map(([year, list]) => (
        <section key={year}>
          <div className="content-head exam-year-head">
            <h2>{year}</h2>
            <span>{list.length} 卷</span>
          </div>
          <div className="exam-grid">
            {list.map((p) => (
              <button
                key={p.id}
                className={`exam-card${levelClass(p.level)}`}
                title={`${p.level} · ${p.title}`}
                onClick={() => open(p.id)}
              >
                <small>{p.hasAnswer ? '有答案' : '无答案'}</small>
                <h4>{p.title}</h4>
                <span className="exam-card-meta">
                  {p.materialCount} 材料 · {p.questionCount} 题
                </span>
                <span className="exam-card-mark" aria-hidden>
                  {levelMark(p.level)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** 详情草稿浅拷贝：对象外壳克隆，字符串共享（进入编辑前确保与响应对象脱引用） */
function cloneDraft(d: ExamDetail): ExamDetail {
  return {
    ...d,
    materials: d.materials.map((m) => ({ ...m })),
    questions: d.questions.map((q) => ({ ...q })),
  }
}
