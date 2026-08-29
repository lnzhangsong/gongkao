import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { fetchExam, fetchExamList, saveExam, type ExamDetail, type ExamPaperMeta } from '../lib/api'
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

export default function ExamPreviewPage() {
  const [papers, setPapers] = useState<ExamPaperMeta[] | null>(null)
  const [draft, setDraft] = useState<ExamDetail | null>(null)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
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

  const open = (id: string) => {
    setDraft(null)
    setEditing(false)
    setDirty(false)
    setSavedAt(null)
    fetchExam(id).then((d) => setDraft(structuredClone(d))).catch(() => setDraft(null))
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
      await saveExam(draft.id, {
        title: draft.title,
        materials: draft.materials.map((m) => ({ idx: m.idx, content: m.content })),
        questions: draft.questions.map((q) => ({
          idx: q.idx, type: q.type, stem: q.stem, requirement: q.requirement,
          wordLimit: q.wordLimit, points: q.points, answer: q.answer,
        })),
      })
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
                if (dirty && !confirm('有未保存修改，确定离开？')) return
                setDraft(null)
                setEditing(false)
                setDirty(false)
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
              <span className="exam-actions">
                {editing ? (
                  <>
                    <button className="ghost" onClick={reflowAll}>一键重排换行</button>
                    <button className="ghost exam-btn-primary" onClick={save} disabled={saving || !dirty}>
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button className="ghost" onClick={() => setEditing(false)}>退出编辑</button>
                  </>
                ) : (
                  <button className="text-btn exam-edit-btn" onClick={() => setEditing(true)}>编辑</button>
                )}
                {savedAt ? <span className="exam-saved">已保存 {savedAt}</span> : null}
                {dirty && editing ? <span className="exam-warn">未保存</span> : null}
              </span>
            </div>
          </header>

          {draft.materials.length > 0 && (
            <div
              ref={bodyRef}
              className={`article-body${settings.focusMode ? ' focus-mode' : ''}${settings.indent ? '' : ' no-indent'}`}
              style={readerVars}
            >
              {editing
                ? draft.materials.map((m) => (
                    <Fragment key={m.idx}>
                      <h3 className="exam-mat-label">{m.label}</h3>
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
                      <h3 className="exam-mat-label">{m.label}</h3>
                      {joinParagraphs(m.content).map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </Fragment>
                  ))}
            </div>
          )}

          <section className="exam-questions" style={readerVars}>
            <div className="content-head">
              <h2>作答要求</h2>
              <span>{draft.questions.length} 题</span>
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
                    <textarea
                      className="exam-ta"
                      rows={Math.min(8, Math.max(3, Math.ceil(q.stem.length / 40)))}
                      value={q.stem}
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
        </main>
      </section>
    )
  }

  // ---------- 列表 ----------
  return (
    <div className="exam-page">
      <header className="exam-hero">
        <span className="eyebrow">GUOKAO SHENLUN　/　2000–2026</span>
        <h1>
          申论<span>真题</span>
        </h1>
        <p className="subpage-copy">国考申论真题库：给定资料、作答要求与参考答案的结构化整理，可就地校对修订。</p>
        <div className="exam-hero-meta">
          data/exams.db · {papers?.length ?? '…'} 卷 · <Link to="/">返回首页</Link>
        </div>
      </header>
      {grouped.map(([year, list]) => (
        <section key={year}>
          <div className="content-head exam-year-head">
            <h2>{year}</h2>
            <span>{list.length} 卷</span>
          </div>
          <div className="exam-grid">
            {list.map((p) => (
              <button key={p.id} className="exam-card" onClick={() => open(p.id)}>
                <small>
                  {p.level}
                  {p.hasAnswer ? ' · 有答案' : ''}
                </small>
                <h4>{p.title}</h4>
                <span className="exam-card-meta">
                  {p.materialCount} 材料 · {p.questionCount} 题
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
