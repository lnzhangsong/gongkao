import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createExam, deleteExam, fetchExam, fetchExamList, saveExam, type ExamDetail, type ExamPaperMeta } from '../lib/api'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { useThemeStore, THEMES, resolveTheme } from '../stores/themeStore'
import { usePrefersDark } from '../lib/prefersDark'
import { loadFontFamily } from '../lib/fonts'
import { useFocusMode } from '../lib/useFocusMode'
import { ReaderToolsPanel } from '../components/reading/ReaderToolsPanel'
import '../styles/exam-preview.css'

/**
 * 申论真题（/exams）：列表 + 详情
 * 详情正文直接复用阅读页排版（article-head / article-body / 阅读设置变量），
 * 题目与参考答案在正文语言之上做专门设计（mono 题头 + 答题纸式答案面板）。
 */

/** 段内硬换行拼接：返回重排后的段落数组 */
export function joinParagraphs(text: string): string[] {
  const HEAD = /^(?:材料\s*[0-9一二三四五六七八九十]+|【[^】]*】|问题\s*[一二三四五六七八九十1-9]+[：:：]?|[一二三四五六七八九十]+[、.]|\d{1,2}[、.．]|要求[（(:：]|答卷|参考答案)/
  const paras: string[] = []
  let cur = ''
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[ \t\u3000]+/g, ' ').trim()
    if (!line) {
      if (cur) paras.push(cur)
      cur = ''
      continue
    }
    if (!cur) {
      cur = line
      continue
    }
    if (HEAD.test(line) || /[。！？；…”）』」!?]$/.test(cur)) {
      paras.push(cur)
      cur = line
    } else {
      cur += line
    }
  }
  if (cur) paras.push(cur)
  return paras
}

const reflowParagraphs = (text: string) => joinParagraphs(text).join('\n\n')
const reflowInline = (text: string) => text.replace(/\s+/g, '')

/* 从题干自动读取字数限制与分值（“不超过300字”“250-300字”“（15分）”等） */
const toAsciiNum = (s: string) => parseInt(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)), 10)
const extractWordLimit = (text: string): number | null => {
  for (const [, a, b] of text.matchAll(/(?:不超过|不多于|不多于|不超过|不得超过|字数\s*(?:在|为)?|控制在)?\s*([0-9０-９]{2,4})\s*(?:[-—~至]\s*([0-9０-９]{2,4}))?\s*字/g)) {
    const hi = b ? toAsciiNum(b) : toAsciiNum(a)
    if (hi >= 20 && hi <= 5000) return hi
  }
  return null
}
const extractPoints = (text: string): number | null => {
  for (const m of text.matchAll(/(?:^|[^\d])([0-9０-９]{1,3})\s*分/g)) {
    const v = toAsciiNum(m[1])
    if (v >= 1 && v <= 100) return v
  }
  return null
}

/* 层级 → 卡片底色（与首页三卡同源的配色语言；未知层级回退纸面） */
const levelClass = (level: string): string => {
  if (level.includes('副省')) return ' exam-lv-a'
  if (level.includes('地市')) return ' exam-lv-b'
  if (level.includes('行政执法')) return ' exam-lv-c'
  return ''
}

/* 层级 → 右下角水印单字 */
const levelMark = (level: string): string => {
  if (level.includes('副省')) return '省'
  if (level.includes('地市')) return '市'
  if (level.includes('行政执法')) return '法'
  return ''
}

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
  /* 站内确认弹窗（替代原生 confirm，样式与全站一致） */
  const [confirmBox, setConfirmBox] = useState<{ message: string; danger?: boolean; onOk: () => void } | null>(null)
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
  const setReaderTheme = useReaderStore((s) => s.setReaderTheme)
  const setFocusMode = useReaderStore((s) => s.setFocusMode)
  const theme = useThemeStore((st) => st.theme)
  const autoDark = useThemeStore((st) => st.autoDark)
  const setTheme = useThemeStore((st) => st.setTheme)
  const prefersDark = usePrefersDark()
  const activeTheme = settings.readerTheme || resolveTheme(theme, autoDark, prefersDark)
  const cycleTheme = () => {
    const idx = THEMES.findIndex((t) => t.name === activeTheme)
    setTheme(THEMES[(idx + 1) % THEMES.length].name)
    setReaderTheme('')
  }
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
      .then((d) => setDraft(structuredClone(d)))
      .catch(() => setDraft(null))
      .finally(() => setLoadingDetail(false))
  }

  const backToList = () => {
    setDraft(null)
    setEditing(false)
    setDirty(false)
    setInList(true)
  }

  const patchDraft = (fn: (d: ExamDetail) => void) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      fn(next)
      return next
    })
    setDirty(true)
  }

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

  /* 题干/要求中引用的材料编号（“给定资料N”“材料N”“资料1-4”，含中文数字） */
  const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const toNum = (num: string): number => {
    const ascii = num.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248))
    return /^[0-9]+$/.test(ascii) ? parseInt(ascii, 10) : CN_NUM[num] ?? 0
  }
  const questionMaterials = (q: { stem: string; requirement: string }): number[] => {
    const text = `${q.stem}\n${q.requirement}`
    const found = new Set<number>()
    for (const [, a, b] of text.matchAll(/(?:给定)?[材资]料?\s*([0-9０-９]+|[一二三四五六七八九十]+)(?:\s*[-—~至]\s*([0-9０-９]+|[一二三四五六七八九十]+))?/g)) {
      const start = toNum(a)
      const end = b ? toNum(b) : start
      for (let n = start; n >= 1 && n <= end && n - start < 12; n++) found.add(n)
    }
    return [...found].sort((x, y) => x - y)
  }
  /* 编号 → 对应材料（label 匹配优先，否则按位置取） */
  const materialIdByNum = (n: number): string | null => {
    if (!draft) return null
    const byLabel = draft.materials.find((m) => new RegExp(`[材资]料${n}(?![0-9])`).test(m.label) || m.label.includes(`资料${n}`))
    const target = byLabel ?? draft.materials[n - 1]
    return target ? `exam-mat-${target.idx}` : null
  }

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
      alert(String(e))
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
              onClick={() => {
                if (dirty) {
                  setConfirmBox({ message: '有未保存修改，确定离开？', onOk: backToList })
                  return
                }
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
                    onClick={() => {
                      setConfirmBox({
                        message: `确定删除整张试卷「${draft.title}」？其材料与题目会一并删除，且不可恢复。`,
                        danger: true,
                        onOk: async () => {
                          try {
                            await deleteExam(draft.id)
                            backToList()
                            setPapers((prev) => prev?.filter((p) => p.id !== draft.id) ?? prev)
                          } catch (e) {
                            alert(String(e))
                          }
                        },
                      })
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
                  <>
                    <div className="exam-q-edit-bar">
                      <span className="exam-q-edit-left">
                        第 {q.idx} 题
                        <select
                          className="exam-select"
                          value={q.type ?? ''}
                          onChange={(e) => patchDraft((d) => void (d.questions.find((x) => x.idx === q.idx)!.type = e.target.value || null))}
                        >
                          <option value="">未分类</option>
                          {['概括', '分析', '对策', '应用文', '大作文'].map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </span>
                      <span className="exam-move-group">
                        <button className="exam-move-btn" title="上移" disabled={q.idx === 1} onClick={() => moveItem('questions', q.idx, -1)}>↑</button>
                        <button className="exam-move-btn" title="下移" disabled={q.idx === draft.questions.length} onClick={() => moveItem('questions', q.idx, 1)}>↓</button>
                      </span>
                      <button
                        className="text-btn exam-del-btn"
                        onClick={() => patchDraft((d) => void (d.questions = d.questions.filter((x) => x.idx !== q.idx)))}
                      >
                        删除此题
                      </button>
                    </div>
                    <div className="exam-q-fields">
                      <span className="exam-edit-field">
                        <label>字数</label>
                        <input
                          type="number"
                          className="exam-select exam-num-input"
                          min={0}
                          value={q.wordLimit ?? ''}
                          placeholder="—"
                          onChange={(e) => patchDraft((d) => void (d.questions.find((x) => x.idx === q.idx)!.wordLimit = e.target.value === '' ? null : parseInt(e.target.value, 10)))}
                        />
                      </span>
                      <span className="exam-edit-field">
                        <label>分值</label>
                        <input
                          type="number"
                          className="exam-select exam-num-input"
                          min={0}
                          value={q.points ?? ''}
                          placeholder="—"
                          onChange={(e) => patchDraft((d) => void (d.questions.find((x) => x.idx === q.idx)!.points = e.target.value === '' ? null : parseInt(e.target.value, 10)))}
                        />
                      </span>
                      <span className="exam-q-fields-hint">字数/分值在题干失焦时自动从原文读取，可手动覆盖</span>
                    </div>
                    <textarea
                      className="exam-ta"
                      rows={Math.min(8, Math.max(3, Math.ceil(q.stem.length / 40)))}
                      value={q.stem}
                      onBlur={(e) => {
                        const stem = e.target.value
                        const wl = extractWordLimit(stem)
                        const pts = extractPoints(stem)
                        if (wl !== null || pts !== null) {
                          patchDraft((d) => {
                            const t = d.questions.find((x) => x.idx === q.idx)
                            if (!t) return
                            if (wl !== null) t.wordLimit = wl
                            if (pts !== null) t.points = pts
                          })
                        }
                      }}
                      onChange={(e) => patchDraft((d) => void (d.questions.find((x) => x.idx === q.idx)!.stem = e.target.value))}
                    />
                    <textarea
                      className="exam-ta"
                      placeholder="要求（可空）"
                      rows={Math.max(2, Math.ceil((q.requirement.length || 1) / 40))}
                      value={q.requirement}
                      onChange={(e) => patchDraft((d) => void (d.questions.find((x) => x.idx === q.idx)!.requirement = e.target.value))}
                    />
                    <textarea
                      className="exam-ta"
                      placeholder="参考答案（可空）"
                      rows={Math.min(16, Math.max(3, Math.ceil((q.answer?.length || 1) / 40)))}
                      value={q.answer ?? ''}
                      onChange={(e) => patchDraft((d) => void (d.questions.find((x) => x.idx === q.idx)!.answer = e.target.value || null))}
                    />
                  </>
                ) : (
                  <>
                    <p className="exam-q-stem">{q.stem.replace(/\n/g, '')}</p>
                    {questionMaterials(q).length > 0 && (
                      <div className="exam-q-mats">
                        {questionMaterials(q).map((n) => {
                          const anchor = materialIdByNum(n)
                          return anchor ? (
                            <button key={n} className="exam-jump-chip" onClick={() => jumpTo(anchor)}>
                              材料{n} ↖
                            </button>
                          ) : null
                        })}
                      </div>
                    )}
                    {q.requirement ? (
                      <p className="exam-q-req">
                        <span className="exam-q-req-label">要求</span>
                        {q.requirement.replace(/^要求[（(:：]?\s*/, '').replace(/\n+/g, ' ')}
                      </p>
                    ) : null}
                    {q.answer ? (
                      <details className="exam-answer">
                        <summary>
          参考答案
          {q.answerMatched ? '' : <span className="exam-ans-warn">　未按题对齐</span>}
        </summary>
                        <div className={`exam-answer-sheet${settings.indent ? '' : ' no-indent'}`}>
                          {joinParagraphs(q.answer).map((p, i) => (
                            <p key={i}>{p}</p>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </>
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
          />

          {confirmBox && (
            <div className="exam-modal-mask" onClick={() => setConfirmBox(null)}>
              <div className="exam-modal" role="alertdialog" onClick={(e) => e.stopPropagation()}>
                <p className="exam-modal-msg">{confirmBox.message}</p>
                <div className="exam-modal-actions">
                  <button className="ghost" onClick={() => setConfirmBox(null)}>取消</button>
                  <button
                    className={`ghost${confirmBox.danger ? ' exam-btn-danger' : ' exam-btn-primary'}`}
                    onClick={() => {
                      const fn = confirmBox.onOk
                      setConfirmBox(null)
                      void fn()
                    }}
                  >
                    确定
                  </button>
                </div>
              </div>
            </div>
          )}
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
                    alert(String(e))
                  }
                }}
              >
                创建
              </button>
              <button className="text-btn" onClick={() => setCreating(false)} style={{ color: 'var(--muted)' }}>
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
