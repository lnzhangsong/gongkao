import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { useShenlunStore, type StudyStatus } from '../stores/shenlunStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { useAiAssistStore } from '../stores/aiAssistStore'
import { useAiStore, isAiConfigured } from '../stores/aiStore'
import { MATERIAL_TYPE_LABELS } from '../data/material'
import { draftStudy } from '../lib/aiPresplit'
import type { Article } from '../types'

const STATUS_OPTIONS: { key: StudyStatus; label: string }[] = [
  { key: 'new', label: '未学' },
  { key: 'learning', label: '学习中' },
  { key: 'mastered', label: '已掌握' },
]

interface ShenlunPanelProps {
  article: Article
  onClose: () => void
  /** 定位正文：段落锚点（真题页等无正文锚点的宿主可省略，定位按钮随之隐藏） */
  scrollToPara?: (paraIndex: number) => void
  /** 定位正文：摘录标注 */
  scrollToAnnotation?: (annotationId: string) => void
}

/**
 * 申论拆解 / 范文精读抽屉：
 * - 学习状态 / 星级 / 核心观点 / 分论点 / 心得
 * - 范文精读（决策 D15）：每段大意、结构骨架、本篇可迁移句式
 * - 本篇素材按类型分组，点卡片定位正文
 */
export function ShenlunPanel({ article, onClose, scrollToPara, scrollToAnnotation }: ShenlunPanelProps) {
  const study = useShenlunStore((s) => s.study[article.id])
  const setStatus = useShenlunStore((s) => s.setStatus)
  const unpin = useShenlunStore((s) => s.unpin)
  const setMastery = useShenlunStore((s) => s.setMastery)
  const setCoreThesis = useShenlunStore((s) => s.setCoreThesis)
  const addSubThesis = useShenlunStore((s) => s.addSubThesis)
  const updateSubThesis = useShenlunStore((s) => s.updateSubThesis)
  const removeSubThesis = useShenlunStore((s) => s.removeSubThesis)
  const setReviewNote = useShenlunStore((s) => s.setReviewNote)
  const setParagraphSummary = useShenlunStore((s) => s.setParagraphSummary)
  const setSkeleton = useShenlunStore((s) => s.setSkeleton)
  const updateAnnotation = useAnnotationStore((s) => s.update)

  const [subDraft, setSubDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState<string | null>(null)

  /* ---------- AI 预拆解：一键生成并直接填入（只填空缺，不覆盖手填） ---------- */
  const aiConfigured = useAiStore((s) => isAiConfigured(s.settings))
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiDone, setAiDone] = useState('')

  const runAiPresplit = async () => {
    if (aiBusy) return
    setAiBusy(true)
    setAiError('')
    setAiDone('')
    try {
      const d = await draftStudy(article)
      for (const p of d.paragraphSummaries) {
        setParagraphSummary(article.id, p.paraIndex, p.summary, { origin: 'ai' })
      }
      /* 只填空缺：核心观点 / 分论点（追加去重）/ 骨架各字段 */
      const filled: string[] = []
      if (!study?.coreThesis.trim() && d.coreThesis) {
        setCoreThesis(article.id, d.coreThesis)
        filled.push('核心观点')
      }
      const existSubs = study?.subTheses ?? []
      const newSubs = d.subTheses.filter((t) => !existSubs.includes(t))
      if (newSubs.length) {
        for (const t of newSubs) addSubThesis(article.id, t)
        filled.push('分论点')
      }
      const sk = d.skeleton
      const patch: Parameters<typeof setSkeleton>[1] = {}
      if (sk.opening && !skeleton?.opening) patch.opening = sk.opening
      if (sk.bodyLayers.length && !skeleton?.bodyLayers?.length) patch.bodyLayers = sk.bodyLayers
      if (sk.transitions?.length && !skeleton?.transitions?.length) patch.transitions = sk.transitions
      if (sk.closing && !skeleton?.closing) patch.closing = sk.closing
      if (Object.keys(patch).length) {
        setSkeleton(article.id, patch)
        filled.push('骨架')
      }
      if (d.paragraphSummaries.length) filled.push(`段意 ${d.paragraphSummaries.length} 段`)
      setAiDone(filled.length ? `已填入：${filled.join(' / ')}` : '没有新增内容（相关字段已有手填值）')
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

  const annotations = useAnnotationStore((s) => s.annotations)
  const materialByType = useMemo(() => {
    const map = new Map<string, { id: string; text: string; pattern?: string; memorized?: boolean }[]>()
    for (const a of annotations) {
      if (a.articleId !== article.id || a.kind !== 'highlight' || !a.materialType) continue
      const list = map.get(a.materialType) ?? []
      list.push({ id: a.id, text: a.text, pattern: a.pattern, memorized: a.memorized })
      map.set(a.materialType, list)
    }
    return map
  }, [annotations, article.id])

  const summaries = study?.paragraphSummaries ?? []
  const summaryByPara = useMemo(() => new Map(summaries.map((s) => [s.paraIndex, s.summary])), [summaries])
  const skeleton = study?.skeleton
  const patterns = materialByType.get('pattern') ?? []

  /* ---------- 本文题目：以本文为底本的已存申论题（AI-4 存题后回流展示） ---------- */
  const assistRecords = useAiAssistStore((s) => s.records)
  const relatedExams = useMemo(
    () =>
      Object.values(assistRecords)
        .filter((r) => r.sourceArticleId === article.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [assistRecords, article.id],
  )

  /* ---------- 防丢稿：段落大意受控 + 防抖 + 关闭时 flush ---------- */
  const [paraDrafts, setParaDrafts] = useState<Record<number, string>>({})
  const paraTimersRef = useRef<Map<number, number>>(new Map())
  const skeletonTimersRef = useRef<Map<string, number>>(new Map())
  // 初次 / 切换文章时以 store 为准同步本地草稿（用户正在输入的段不覆盖）
  const draftInitRef = useRef<string>('')
  const draftKey = `${article.id}:${summaries.length}:${summaries.map((s) => `${s.paraIndex}:${s.summary}`).join('|')}`
  useEffect(() => {
    if (draftInitRef.current === draftKey) return
    draftInitRef.current = draftKey
    const next: Record<number, string> = {}
    for (const [k, v] of summaryByPara) next[k] = v
    setParaDrafts(next)
  }, [draftKey, summaryByPara])

  const flushPara = useCallback(
    (idx: number, value: string) => {
      const timer = paraTimersRef.current.get(idx)
      if (timer) {
        window.clearTimeout(timer)
        paraTimersRef.current.delete(idx)
      }
      setParagraphSummary(article.id, idx, value)
    },
    [article.id, setParagraphSummary],
  )

  const flushAllParas = useCallback(() => {
    for (const [idx, timer] of paraTimersRef.current) {
      window.clearTimeout(timer)
      const v = paraDrafts[idx] ?? summaryByPara.get(idx) ?? ''
      setParagraphSummary(article.id, idx, v)
    }
    paraTimersRef.current.clear()
    // 句式模板与骨架的一并 flush（由子组件各自 flush，这里额外兜底清定时器）
    for (const [, timer] of skeletonTimersRef.current) window.clearTimeout(timer)
    skeletonTimersRef.current.clear()
  }, [article.id, paraDrafts, setParagraphSummary, summaryByPara])

  const handleClose = useCallback(() => {
    flushAllParas()
    onClose()
  }, [flushAllParas, onClose])

  /* ---------- AI-4 反向联想入口：去 /assist 对本文做申论考点联想 ---------- */
  const navigate = useNavigate()
  const goInferExam = useCallback(() => {
    flushAllParas()
    onClose()
    navigate(`/assist?infer=${article.id}`)
  }, [article.id, flushAllParas, navigate, onClose])

  // 卸载时兜底 flush（Esc / 路由切走等未走 handleClose 的路径）
  useEffect(() => {
    return () => {
      for (const [idx, timer] of paraTimersRef.current) {
        window.clearTimeout(timer)
        const v = paraDrafts[idx] ?? ''
        if (v.trim() || summaryByPara.get(idx)) setParagraphSummary(article.id, idx, v)
      }
      paraTimersRef.current.clear()
    }
    // 仅卸载时 flush，不随 paraDrafts 变化重建
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 由逐段大意推导骨架候选：首段=开头，中间=层次，尾段=收尾（覆盖现有骨架，可再手工调整） */
  const deriveSkeleton = () => {
    if (summaries.length === 0) return
    const body = summaries.filter(
      (s) => s.paraIndex !== summaries[0].paraIndex && s.paraIndex !== summaries[summaries.length - 1].paraIndex,
    )
    setSkeleton(article.id, {
      opening: summaryByPara.get(summaries[0].paraIndex) ?? '',
      bodyLayers: body.map((s) => s.summary),
      closing: summaryByPara.get(summaries[summaries.length - 1].paraIndex) ?? '',
    })
  }

  return (
    <>
      <div className="shenlun-backdrop" onClick={handleClose} />
      <aside className="shenlun-panel" role="dialog" aria-label="申论拆解">
        <header className="shenlun-head">
          <div>
            <span className="shenlun-eyebrow">SHENLUN / 拆解 · 精读</span>
            <h3>{article.title}</h3>
          </div>
          <button className="shenlun-close" onClick={handleClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="shenlun-body">
          {/* AI 预拆解：一键生成直接填入 */}
          <section className="shenlun-sec ai-presplit">
            <div className="shenlun-sec-row">
              <span className="shenlun-label">AI 预拆解</span>
              <div className="shenlun-sec-btns">
                <button
                  className="text-btn"
                  title="AI-4 反向联想：这篇文章能出什么申论题（到 AI 辅助页进行）"
                  onClick={goInferExam}
                >
                  考点联想 →
                </button>
                <button
                  className="text-btn"
                  disabled={aiBusy || !aiConfigured}
                  title={
                    aiConfigured
                      ? '一键生成并填入：核心观点 / 分论点 / 骨架 / 每段大意（只填空缺，不覆盖手填）'
                      : '先到设置页配置 AI 服务'
                  }
                  onClick={runAiPresplit}
                >
                  {aiBusy ? '生成中…' : '一键填入 ✦'}
                </button>
              </div>
            </div>
            {aiError && <p className="ai-presplit-error">{aiError}</p>}
            {aiDone && !aiError && <p className="ai-presplit-hint">{aiDone}</p>}
            {!aiConfigured && !aiError && !aiDone && (
              <p className="ai-presplit-hint">未配置 AI：到 设置 → AI 服务 填入接口地址与 Key 后可用。</p>
            )}
          </section>

          {/* 学习状态 */}
          <section className="shenlun-sec">
            <div className="shenlun-sec-row">
              <span className="shenlun-label">学习状态</span>
              <div className="shenlun-sec-btns">
                {study?.pinned && (
                  <button
                    className="text-btn"
                    title="状态为手动设置（钉住）。点此恢复自动推进：有实质加工内容时自动升级。"
                    onClick={() => unpin(article.id)}
                  >
                    恢复自动
                  </button>
                )}
                <div className="seg">
                  {STATUS_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      className={(study?.status ?? 'new') === o.key ? 'active' : ''}
                      onClick={() => setStatus(article.id, o.key)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="shenlun-sec-row">
              <span className="shenlun-label">掌握度</span>
              <div className="stars">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    className={(study?.mastery ?? 0) >= n ? 'active' : ''}
                    onClick={() => setMastery(article.id, (study?.mastery ?? 0) === n ? 0 : (n as 1 | 2 | 3))}
                    aria-label={`${n} 星`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 核心观点：受控 + 150ms 防抖落盘，避免每键一次 IDB 写入 */}
          <CoreThesisField articleId={article.id} value={study?.coreThesis ?? ''} onChange={setCoreThesis} />

          {/* 分论点 */}
          <section className="shenlun-sec">
            <span className="shenlun-label">分论点</span>
            {(study?.subTheses ?? []).map((t, i) => (
              <div className="sub-thesis" key={i}>
                <input value={t} onChange={(e) => updateSubThesis(article.id, i, e.target.value)} />
                <button onClick={() => removeSubThesis(article.id, i)} aria-label="删除分论点">
                  <X size={12} />
                </button>
              </div>
            ))}
            <div className="sub-thesis add">
              <input
                placeholder="+ 添加分论点，回车确认"
                value={subDraft}
                onChange={(e) => setSubDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && subDraft.trim()) {
                    addSubThesis(article.id, subDraft.trim())
                    setSubDraft('')
                  }
                }}
              />
            </div>
          </section>

          {/* 范文精读：每段大意（受控 + 防抖 + 失焦/关闭 flush） */}
          <section className="shenlun-sec">
            <span className="shenlun-label">
              每段大意
              <small>　逐段一句话概括，点「定位」跳到原文</small>
            </span>
            {(article.content ?? []).map((_, i) => (
              <div className="para-summary" key={i}>
                {scrollToPara ? (
                  <button className="para-go" onClick={() => scrollToPara(i)} title="定位到该段">
                    {i + 1}
                  </button>
                ) : (
                  <span className="para-go" title={undefined}>
                    {i + 1}
                  </span>
                )}
                <input
                  placeholder={`第 ${i + 1} 段大意…`}
                  value={paraDrafts[i] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setParaDrafts((prev) => ({ ...prev, [i]: v }))
                    const prevTimer = paraTimersRef.current.get(i)
                    if (prevTimer) window.clearTimeout(prevTimer)
                    const t = window.setTimeout(() => {
                      paraTimersRef.current.delete(i)
                      setParagraphSummary(article.id, i, v)
                    }, 300)
                    paraTimersRef.current.set(i, t)
                  }}
                  onBlur={(e) => flushPara(i, e.target.value)}
                />
              </div>
            ))}
          </section>

          {/* 范文精读：结构骨架 */}
          <section className="shenlun-sec">
            <span className="shenlun-label">
              结构骨架
              <button className="text-btn skeleton-derive" onClick={deriveSkeleton}>
                由段意推导 ↻
              </button>
            </span>
            <SkeletonField
              label="开头"
              value={skeleton?.opening ?? ''}
              onChange={(v) => setSkeleton(article.id, { opening: v })}
              debounceMs={350}
              timersRef={skeletonTimersRef}
            />
            <SkeletonField
              label="主体层次"
              list
              value=""
              valueList={skeleton?.bodyLayers ?? (study?.subTheses.length ? study.subTheses : undefined)}
              onChangeList={(v) => setSkeleton(article.id, { bodyLayers: v })}
            />
            <SkeletonField
              label="过渡"
              value={skeleton?.transitions?.join('\n') ?? ''}
              onChange={(v) =>
                setSkeleton(article.id, {
                  transitions: v
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              debounceMs={350}
              timersRef={skeletonTimersRef}
            />
            <SkeletonField
              label="收尾"
              value={skeleton?.closing ?? ''}
              onChange={(v) => setSkeleton(article.id, { closing: v })}
              debounceMs={350}
              timersRef={skeletonTimersRef}
            />
          </section>

          {/* 本篇素材（按类型分组） */}
          <section className="shenlun-sec">
            <span className="shenlun-label">本篇素材</span>
            {(['thesis', 'evidence', 'quote', 'measure', 'pattern'] as const).map((t) => {
              const list = t === 'pattern' ? patterns : (materialByType.get(t) ?? [])
              if (list.length === 0) return null
              return (
                <div className="mat-group" key={t}>
                  <span className={`mat-group-title mat-${t}`}>
                    {MATERIAL_TYPE_LABELS[t]} · {list.length}
                  </span>
                  {list.map((m) => (
                    <div className="mat-card" key={m.id}>
                      <button
                        className="mat-card-text"
                        onClick={() => scrollToAnnotation?.(m.id)}
                        style={scrollToAnnotation ? undefined : { cursor: 'default' }}
                      >
                        “{m.text.length > 48 ? `${m.text.slice(0, 48)}…` : m.text}”
                      </button>
                      {t === 'pattern' && (
                        <PatternDraftInput
                          initial={m.pattern ?? ''}
                          onSave={(v) => updateAnnotation(m.id, { pattern: v || undefined })}
                        />
                      )}
                      {(t === 'quote' || t === 'pattern') && (
                        <button
                          className={`mat-card-star${m.memorized ? ' on' : ''}`}
                          title={m.memorized ? '取消背记' : '加入背记'}
                          onClick={() =>
                            updateAnnotation(m.id, {
                              memorized: !m.memorized,
                              mastery: !m.memorized ? 0 : undefined,
                            })
                          }
                        >
                          ★
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
            {materialByType.size === 0 && <p className="shenlun-empty">阅读时选中文字标记为素材，会出现在这里。</p>}
          </section>

          {/* 本文题目：以这篇文章为底本保存的申论题（AI-4 反向出题闭环） */}
          <section className="shenlun-sec">
            <div className="shenlun-sec-row">
              <span className="shenlun-label">本文题目</span>
              {relatedExams.length > 0 && (
                <button
                  className="text-btn"
                  title="到 AI 辅助页查看与修改"
                  onClick={() => navigate(`/assist?record=${relatedExams[0].id}`)}
                >
                  去 AI 辅助 →
                </button>
              )}
            </div>
            {relatedExams.length > 0 ? (
              <div className="shenlun-exams">
                {relatedExams.map((r) => (
                  <button
                    key={r.id}
                    className="shenlun-exam"
                    title="查看完整题目"
                    onClick={() => navigate(`/assist?record=${r.id}`)}
                  >
                    <span className="shenlun-exam-type">{r.questionType}</span>
                    <span className="shenlun-exam-q">{r.question}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="shenlun-empty">还没有基于本文出题。点上方「考点联想」可反向出题，存题后显示在这里。</p>
            )}
          </section>

          {/* 心得 */}
          <section className="shenlun-sec">
            <span className="shenlun-label">学习心得</span>
            {noteDraft === null ? (
              <p className="shenlun-note" onClick={() => setNoteDraft(study?.reviewNote ?? '')}>
                {study?.reviewNote || '写下你的复盘与启发…'}
              </p>
            ) : (
              <>
                <textarea
                  className="shenlun-input"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  autoFocus
                />
                <button
                  className="shenlun-save"
                  onClick={() => {
                    setReviewNote(article.id, noteDraft.trim())
                    setNoteDraft(null)
                  }}
                >
                  保存心得
                </button>
              </>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}

function CoreThesisField({
  articleId,
  value,
  onChange,
}: {
  articleId: string
  value: string
  onChange: (id: string, v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const timerRef = useRef<number | null>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])
  const schedule = (v: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => onChange(articleId, v), 250)
  }
  return (
    <section className="shenlun-sec">
      <span className="shenlun-label">核心观点</span>
      <textarea
        className="shenlun-input"
        placeholder="这篇文章主张什么？"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          schedule(e.target.value)
        }}
        onBlur={(e) => {
          if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
          }
          onChange(articleId, e.target.value)
        }}
      />
    </section>
  )
}

function PatternDraftInput({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(initial)
  const timerRef = useRef<number | null>(null)
  useEffect(() => setDraft(initial), [initial])
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )
  return (
    <input
      className="mat-card-pattern"
      placeholder="可迁移模板…"
      value={draft}
      onChange={(e) => {
        const v = e.target.value
        setDraft(v)
        if (timerRef.current) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => onSave(v.trim()), 400)
      }}
      onBlur={(e) => {
        if (timerRef.current) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        onSave(e.target.value.trim())
      }}
    />
  )
}

/** 骨架字段：单值（textarea）或列表（bodyLayers 逐条）——单值走防抖受控，失焦/卸载 flush */
function SkeletonField({
  label,
  value = '',
  valueList,
  onChange,
  onChangeList,
  list,
  debounceMs = 300,
  timersRef,
}: {
  label: string
  value?: string
  valueList?: string[]
  onChange?: (v: string) => void
  onChangeList?: (v: string[]) => void
  list?: boolean
  debounceMs?: number
  timersRef?: React.MutableRefObject<Map<string, number>>
}) {
  const [extra, setExtra] = useState('')
  const [draft, setDraft] = useState(value)
  const timerRef = useRef<number | null>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )
  if (list && onChangeList) {
    const items = valueList ?? []
    return (
      <div className="skeleton-field">
        <span className="skeleton-label">{label}</span>
        {items.map((it, i) => (
          <div className="sub-thesis" key={i}>
            <input value={it} onChange={(e) => onChangeList(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button onClick={() => onChangeList(items.filter((_, j) => j !== i))} aria-label="删除">
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="sub-thesis add">
          <input
            placeholder={`+ ${label}层次，回车添加`}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && extra.trim()) {
                onChangeList([...items, extra.trim()])
                setExtra('')
              }
            }}
          />
          {items.length === 0 && <Plus size={12} style={{ color: 'var(--muted)' }} />}
        </div>
      </div>
    )
  }
  return (
    <div className="skeleton-field">
      <span className="skeleton-label">{label}</span>
      <textarea
        rows={2}
        value={draft}
        placeholder={`${label}方式…`}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          if (timerRef.current) window.clearTimeout(timerRef.current)
          const t = window.setTimeout(() => onChange?.(v), debounceMs)
          timerRef.current = t
          if (timersRef) timersRef.current.set(label, t)
        }}
        onBlur={(e) => {
          if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
          }
          if (timersRef) timersRef.current.delete(label)
          onChange?.(e.target.value)
        }}
      />
    </div>
  )
}
