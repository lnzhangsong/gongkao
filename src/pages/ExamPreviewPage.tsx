import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createExam, deleteExam, fetchExam, fetchExamList, saveExam, type ExamDetail, type ExamPaperMeta, type ExamQuestion } from '../lib/api'
import { alertDialog, confirmDialog } from '../components/ui/ConfirmDialog'
import { ApiLoading } from '../components/ui/ApiLoading'
import { useHoverPrefetch } from '../lib/hoverPrefetch'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { useCycleTheme } from '../hooks/useCycleTheme'
import { loadFontFamily } from '../lib/fonts'
import { useFocusMode } from '../lib/useFocusMode'
import { ReaderToolsPanel } from '../components/reading/ReaderToolsPanel'
import { ExamQuestionEditor } from '../components/exam/ExamQuestionEditor'
import { ExamAnalysisDrawer } from '../components/exam/ExamAnalysisDrawer'
import { draftMaterialMarks } from '../lib/aiExamTrace'
import { useAiStore, isAiConfigured } from '../stores/aiStore'
import { ExamQuestionsDrawer } from '../components/exam/ExamQuestionsDrawer'
import { MarkedParagraph } from '../components/exam/ExamMarkedParagraph'
import { YearInput } from '../components/exam/YearInput'
import { findQuoteInMaterial, type MarkRange } from '../lib/examMarks'
import { useExamStudyStore } from '../stores/examStudyStore'
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
  const { examId: routeExamId } = useParams()
  const navigate = useNavigate()
  const [papers, setPapers] = useState<ExamPaperMeta[] | null>(null)
  /** 列表拉取失败（服务不可用）：显示错误条 + 重试，而不是静默空列表 */
  const [listError, setListError] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [draft, setDraft] = useState<ExamDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newForm, setNewForm] = useState({ year: String(new Date().getFullYear() + 1), level: '地市级', title: '' })
  /* 年份输入的临时字符串：清空重输时数字不再跳变，失焦时校验回写 */
  const [yearDraft, setYearDraft] = useState(newForm.year)
  const submitCreate = async () => {
    if (creatingBusy) return
    const year = parseInt(newForm.year, 10)
    const title = newForm.title.trim() || `${year}年国家公务员考试《申论》题（${newForm.level}）`
    setCreatingBusy(true)
    try {
      const { id } = await createExam({ year, level: newForm.level, title })
      setCreating(false)
      open(id)
      setEditing(true)
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e))
    } finally {
      setCreatingBusy(false)
    }
  }

  /* 折叠的材料（阅读态点击材料标签收起/展开） */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  /* 题目解析抽屉：当前打开的题目 idx（方法论 / 读材料三问 / 答案溯源统一收在抽屉里） */
  const [analysisIdx, setAnalysisIdx] = useState<number | null>(null)
  /* 作答要求抽屉：阅读态把整段题目收进抽屉，正文只留材料 */
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const removeForPaper = useExamStudyStore((st) => st.removeForPaper)
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

  /* 列表 ↔ 详情由路由驱动（/exams 与 /exams/:examId）：浏览器后退可回列表，前进可回详情 */
  const listScrollRef = useRef(0)
  const inList = !routeExamId
  /* 详情加载：进入 /exams/:examId 或试卷 id 变化时拉取（retryTick 供错误态重试） */
  const [retryTick, setRetryTick] = useState(0)
  useEffect(() => {
    if (!routeExamId) return
    let alive = true
    setDraft(null)
    setDetailError(false)
    setLoadingDetail(true)
    setEditing(false)
    setDirty(false)
    setSavedAt(null)
    setAnalysisIdx(null)
    window.scrollTo({ top: 0 })
    fetchExam(routeExamId)
      .then((d) => {
        if (alive) setDraft(cloneDraft(d))
      })
      .catch(() => {
        if (alive) setDetailError(true)
      })
      .finally(() => {
        if (alive) setLoadingDetail(false)
      })
    return () => {
      alive = false
    }
  }, [routeExamId, retryTick])

  /* 返回列表时恢复进入前的滚动位置（晚于 App 的 ScrollToTop 执行，覆盖其回顶） */
  useEffect(() => {
    if (inList) window.scrollTo({ top: listScrollRef.current })
  }, [inList])

  /** 悬停预取详情：试卷正文较大，点进去时多半已在会话缓存（120ms 防飞掠） */
  const warmExam = (id: string) => void fetchExam(id).catch(() => {})
  const hoverWarm = useHoverPrefetch()

  const open = (id: string) => {
    listScrollRef.current = window.scrollY
    navigate(`/exams/${encodeURIComponent(id)}`)
  }

  const backToList = () => {
    navigate('/exams')
  }

  /* 编辑态有未保存修改时拦截刷新/关闭，避免长卷丢稿 */
  useEffect(() => {
    if (!editing || !dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [editing, dirty])

  /* 列表拉取失败重试 */
  const reloadList = () => {
    setListError(false)
    fetchExamList()
      .then((r) => setPapers(r.papers))
      .catch(() => {
        setPapers([])
        setListError(true)
      })
  }

  useEffect(() => {
    fetchExamList()
      .then((r) => setPapers(r.papers))
      .catch(() => {
        setPapers([])
        setListError(true)
      })
  }, [])

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

  /* 原文标注：把全卷各题圈出的重要句聚合到材料原文上。
     「行文思路」开关打开时高亮 + 每句下方内联展示 思路卡（顺材料读，不用开抽屉）；
     引句做空白不敏感匹配（AI 返回的 quote 可能与正文空白有差异），匹配不到的跳过 */
  const [inlineMarks, setInlineMarks] = useState(() => {
    try {
      return localStorage.getItem('readbook:exam-inline-marks') === '1'
    } catch {
      return false
    }
  })
  const toggleInlineMarks = () =>
    setInlineMarks((v) => {
      try {
        localStorage.setItem('readbook:exam-inline-marks', v ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !v
    })

  /* 一键生成全卷行文思路：跳过已有标注的题，逐题生成并直接入库（新增性写入，不覆盖手填） */
  const setMarks = useExamStudyStore((st) => st.setMarks)
  const removeMaterialMarks = useExamStudyStore((st) => st.removeMaterialMarks)
  const aiConfigured = useAiStore((st) => isAiConfigured(st.settings))
  const allMarks = useExamStudyStore((s) => s.marks)
  /* 该材料在任意层级（题目级/材料级）有标注 → 按钮显示「重新生成」 */
  const matHasMarks = useMemo(() => {
    const set = new Set<number>()
    if (!draft) return set
    for (const rec of Object.values(allMarks)) {
      if (rec.paperId !== draft.id) continue
      for (const m of rec.marks) set.add(m.matIdx)
    }
    return set
  }, [draft, allMarks])
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null)
  const [genError, setGenError] = useState('')
  const [matGenIdx, setMatGenIdx] = useState<number | null>(null)
  /** 单则材料生成：忽略具体题目，逐句梳理本则行文脉络；存 qIdx = -材料idx（材料级，不入任何题的解析） */
  const generateMaterialMarks = async (m: { idx: number; label: string; content: string }) => {
    if (!draft || matGenIdx != null) return
    if (!aiConfigured) {
      void alertDialog('尚未配置 AI 服务：请到 设置 → AI 服务 填入接口地址与 API Key')
      return
    }
    setMatGenIdx(m.idx)
    try {
      /* 重新生成语义：先清掉该材料所有层级（题目级 + 材料级）的旧标注 */
      removeMaterialMarks(draft.id, m.idx)
      const stems = draft.questions
        .map((q) => `${q.idx}.${q.stem.replace(/\s+/g, '').slice(0, 50)}`)
        .join('；')
      const marks = await draftMaterialMarks({
        question: {
          idx: m.idx,
          type: null,
          stem: `通读本则材料，逐句梳理它的行文脉络与关键信息。全卷题目如下（use 里可说明该句服务于哪道题）：${stems}`,
          requirement: '',
          answer: null,
        },
        materials: [m],
      })
      setMarks(draft.id, -m.idx, marks, 'ai')
    } catch (err) {
      void alertDialog(err instanceof Error ? err.message : String(err))
    } finally {
      setMatGenIdx(null)
    }
  }

  const generateAllMarks = async () => {
    if (!draft || genProgress) return
    if (!aiConfigured) {
      void alertDialog('尚未配置 AI 服务：请到 设置 → AI 服务 填入接口地址与 API Key')
      return
    }
    setGenError('')
    const qs = draft.questions.filter((q) => {
      const rec = allMarks[`${draft.id}#${q.idx}`]
      return !rec?.marks.length
    })
    if (!qs.length) {
      setGenProgress(null)
      return
    }
    setGenProgress({ done: 0, total: qs.length })
    let failed = 0
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i]
      try {
        const marks = await draftMaterialMarks({
          question: { idx: q.idx, type: q.type, stem: q.stem, requirement: q.requirement, answer: q.answer },
          materials: draft.materials,
        })
        setMarks(draft.id, q.idx, marks, 'ai')
      } catch {
        failed++
      }
      setGenProgress({ done: i + 1, total: qs.length })
    }
    setGenProgress(null)
    if (failed) setGenError(`${failed} 题生成失败，可再点一次重试（已有标注的题会跳过）`)
  }
  const markRangesByMat = useMemo(() => {
    const map = new Map<number, MarkRange[]>()
    /* 开关关闭 = 完全不渲染（干净原文）；打开 = 高亮 + 句末挂注 */
    if (!draft || !inlineMarks) return map
    for (const record of Object.values(allMarks)) {
      if (record.paperId !== draft.id) continue
      for (const mark of record.marks) {
        const mat = draft.materials.find((x) => x.idx === mark.matIdx)
        if (!mat) continue
        const hit = findQuoteInMaterial(joinParagraphs(mat.content), mark.quote)
        if (!hit) continue
        const list = map.get(mark.matIdx) ?? []
        list.push({ mark, ...hit })
        map.set(mark.matIdx, list)
      }
    }
    return map
  }, [draft, allMarks, inlineMarks])


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
        materials: draft.materials.map((m) => ({ idx: m.idx, label: m.label, content: m.content })),
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

  // ---------- 详情：加载中（spinner 等接口，内容就绪后整体淡入） ----------
  if (!draft && loadingDetail) {
    return (
      <section className="reading-page">
        <ApiLoading label="正在加载试卷…" />
      </section>
    )
  }

  // ---------- 详情：加载失败（服务不可用 / 试卷不存在） ----------
  if (routeExamId && !draft && !loadingDetail && detailError) {
    return (
      <section className="reading-page">
        <main className="reading-layout">
          <article>
            <header className="article-head">
              <div className="tag">EXAM / ERROR</div>
              <h1>试卷暂时无法加载</h1>
              <p className="dek">本地 API 服务可能没有启动，或该试卷不存在。服务恢复后可重试。</p>
            </header>
            <div className="empty-state">
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="ghost" onClick={() => setRetryTick((t) => t + 1)}>
                  重试
                </button>
                <button className="ghost" onClick={backToList}>
                  返回列表
                </button>
              </div>
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
        <main className={`reading-layout fade-in${settings.measure === 'narrow' ? ' narrow-measure' : ''}`}>
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
                  <YearInput
                    value={draft.year}
                    onCommit={(n) => patchDraft((d) => void (d.year = n))}
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
                  <button
                    className="ghost"
                    onClick={async () => {
                      if (dirty && !(await confirmDialog('有未保存修改，退出编辑将丢失这些修改，确定退出？', { danger: true }))) return
                      setEditing(false)
                    }}
                  >
                    退出编辑
                  </button>
                  <button
                    className="text-btn exam-del-btn"
                    onClick={async () => {
                      if (!(await confirmDialog(`确定删除整张试卷「${draft.title}」？其材料与题目会一并删除，且不可恢复。`, { danger: true }))) return
                      try {
                        await deleteExam(draft.id)
                        removeForPaper(draft.id)
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

          {editing && (
            <div className="exam-sec-bar">
              <span>给定资料 · {draft.materials.length} 段</span>
              <span>
                <button
                  className="text-btn exam-add-btn"
                  onClick={() => patchDraft((d) => void d.materials.push({ idx: (d.materials.at(-1)?.idx ?? 0) + 1, label: `材料${d.materials.length + 1}`, content: '' }))}
                >
                  ＋ 添加材料
                </button>
              </span>
            </div>
          )}
          {/* 快速跳转条已移除：材料顺序读，「作答要求」入口在阅读辅助面板 */}
          <div
            ref={bodyRef}
              className={`article-body${settings.focusMode ? ' focus-mode' : ''}${settings.indent ? '' : ' no-indent'}`}
              style={readerVars}
            >
              {editing
                ? draft.materials.map((m) => (
                    <Fragment key={m.idx}>
                      <h3 className="exam-mat-label">
                        <input
                          className="exam-mat-label-input"
                          value={m.label}
                          onChange={(e) => patchDraft((d) => void (d.materials.find((x) => x.idx === m.idx)!.label = e.target.value))}
                          aria-label="材料标题"
                        />
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
                        {!editing && (
                          <button
                            type="button"
                            className="text-btn exam-mat-gen"
                            disabled={matGenIdx != null}
                            title="AI 逐句梳理本则材料的行文脉络（标注显示在正文中）"
                            onClick={(e) => {
                              e.stopPropagation()
                              void generateMaterialMarks(m)
                            }}
                          >
                            {matGenIdx === m.idx
                              ? '生成中…'
                              : matHasMarks.has(m.idx)
                                ? '重新生成思路 ✦'
                                : '生成思路 ✦'}
                          </button>
                        )}
                      </h3>
                      {!collapsed.has(m.idx) &&
                        joinParagraphs(m.content).map((p, i) => (
                          <MarkedParagraph
                            key={i}
                            text={p}
                            ranges={(markRangesByMat.get(m.idx) ?? []).filter((r) => r.paraIndex === i)}
                          />
                        ))}
                    </Fragment>
                  ))}
          </div>

          <section className="exam-questions" id="exam-qs-anchor" style={readerVars}>
            {editing && (
              <div className="content-head">
                <h2>作答要求</h2>
                <span>
                  {draft.questions.length} 题
                <button
                  className="text-btn exam-add-btn"
                  onClick={() => patchDraft((d) => void d.questions.push({ idx: (d.questions.at(-1)?.idx ?? 0) + 1, type: null, stem: '', requirement: '', wordLimit: null, points: null, answer: null, answerMatched: false }))}
                >
                  　＋ 添加题目
                </button>
              </span>
            </div>
            )}
            {editing &&
              draft.questions.map((q) => (
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
                  <ExamQuestionEditor
                    q={q}
                    total={draft.questions.length}
                    patch={patchQuestion}
                    move={(key, delta) => moveItem('questions', key, delta)}
                    onDelete={() => patchDraft((d) => void (d.questions = d.questions.filter((x) => x.idx !== q.idx)))}
                  />
                </article>
              ))}
          </section>

          {/* 作答要求抽屉：阅读态题目整段收进抽屉 */}
          {!editing && questionsOpen && (
            <ExamQuestionsDrawer
              detail={draft}
              materialAnchors={materialAnchors}
              anchorByNum={anchorByNum}
              onJump={jumpTo}
              indent={settings.indent}
              onOpenAnalysis={(qIdx) => {
                setQuestionsOpen(false)
                setAnalysisIdx(qIdx)
              }}
              onClose={() => setQuestionsOpen(false)}
            />
          )}

          {/* 行文思路开着但还没有标注：一键生成全卷 */}
          {!editing && inlineMarks && markRangesByMat.size === 0 && (
            <div className="exam-inline-empty">
              <p>
                {genProgress
                  ? `正在生成全卷行文思路（${genProgress.done}/${genProgress.total} 题）…`
                  : '还没有任何标注。'}
              </p>
              <button className="ghost exam-btn-primary" disabled={Boolean(genProgress)} onClick={generateAllMarks}>
                {genProgress ? '生成中…' : '一键生成全卷行文思路 ✦'}
              </button>
              {genError && <p className="draw-error">{genError}</p>}
            </div>
          )}

          {/* 题目解析抽屉：方法论 + 读材料三问 + 答案溯源（阅读态，一次一题）。
              解析必从题目抽屉的「解析」进入，关闭时把题目抽屉带回来，避免回不去 */}
          {!editing &&
            analysisIdx != null &&
            (() => {
              const aq = draft.questions.find((x) => x.idx === analysisIdx)
              if (!aq) return null
              return (
                <ExamAnalysisDrawer
                  paperId={draft.id}
                  q={aq}
                  materials={draft.materials}
                  relatedIdx={materialAnchors.get(aq.idx) ?? []}
                  anchorByNum={anchorByNum}
                  onJump={jumpTo}
                  onClose={() => {
                    setAnalysisIdx(null)
                    setQuestionsOpen(true)
                  }}
                />
              )
            })()}
          </article>

          <ReaderToolsPanel
            settings={settings}
            onFontSizeDelta={(delta) => setFontSize(settings.fontSize + delta)}
            onFontFamily={setFontFamily}
            labelFontSize={settings.labelFontSize ?? 13}
            onLabelFontSizeDelta={(delta) => setLabelFontSize((settings.labelFontSize ?? 13) + delta)}
            activeTheme={activeTheme}
            onCycleTheme={cycleTheme}
            onToggleFocus={() => setFocusMode(!settings.focusMode)}
            onToggleTermBox={() => setTermBox(!settings.termBox)}
            examMarks={{ on: inlineMarks, onToggle: toggleInlineMarks }}
            onOpenQuestions={() => setQuestionsOpen(true)}
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
                value={yearDraft}
                onChange={(e) => setYearDraft(e.target.value)}
                onBlur={() => {
                  const n = parseInt(yearDraft, 10)
                  if (n >= 2000 && n <= 2100) setNewForm((f) => ({ ...f, year: String(n) }))
                  else setYearDraft(newForm.year)
                }}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCreate()
                }}
              />
              <button className="ghost" disabled={creatingBusy} onClick={submitCreate}>
                {creatingBusy ? '创建中…' : '创建'}
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
      {listError && (
        <div className="empty-state">
          <strong>试卷列表暂时无法加载</strong>
          本地 API 服务可能没有启动，服务恢复后可重试。
          <div style={{ marginTop: 12 }}>
            <button className="ghost" onClick={reloadList}>重试</button>
          </div>
        </div>
      )}
      {papers === null && !listError && <ApiLoading label="正在加载试卷列表…" />}
      {papers !== null && papers.length === 0 && !listError && (
        <div className="empty-state">
          <strong>还没有试卷</strong>
          点右上角「新增试卷」创建第一份真题
        </div>
      )}
      {papers !== null && papers.length > 0 && !listError && (
        <div className="fade-in">
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
                    {...hoverWarm(() => warmExam(p.id))}
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
      )}
    </div>
  )
}

/** 详情草稿浅拷贝：对象外壳克隆，字符串共享（进入编辑前确保与响应对象脱引用） */


/** 详情草稿浅拷贝：对象外壳克隆，字符串共享（进入编辑前确保与响应对象脱引用） */
function cloneDraft(d: ExamDetail): ExamDetail {
  return {
    ...d,
    materials: d.materials.map((m) => ({ ...m })),
    questions: d.questions.map((q) => ({ ...q })),
  }
}
