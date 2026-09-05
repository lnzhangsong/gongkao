import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, X } from 'lucide-react'
import { MenuSelect } from '../components/ui/MenuSelect'
import '../styles/exam-preview.css'
import '../styles/assist.css'
import { TOPICS } from '../data'
import { MATERIAL_TYPE_LABELS } from '../data/material'
import { useAnnotationStore } from '../stores/annotationStore'
import { useArticleStore } from '../stores/articleStore'
import {
  useAiAssistStore,
  emptyRecord,
  QUESTION_TYPES,
  type AssistRecord,
  type QuestionType,
} from '../stores/aiAssistStore'
import { useAiStore, isAiConfigured } from '../stores/aiStore'
import { useLearningEventStore } from '../stores/learningEventStore'
import { echoCompare } from '../lib/mastery'
import { draftFramework, type MaterialCandidate } from '../lib/aiAssist'
import { inferExamCandidates, draftFullExam, type InferExamResult } from '../lib/aiExamGen'
import type { ArticleTopic } from '../types'
import { alertDialog } from '../components/ui/ConfirmDialog'

/**
 * AI 审题 + 作答框架（/assist，AI-1/AI-2）：
 * 题干 + 题型 + 主题 → 审题立意 + 按题型的框架要点；
 * 素材联动：客户端收集素材库标注（按主题筛选）进 prompt，AI 挑选后映射回标注 id 挂到要点上。
 * 产出「生成 → 人工编辑 → 保存入库」，不自动覆盖任何已有记录。
 */
export function AssistPage() {
  const aiConfigured = useAiStore((s) => isAiConfigured(s.settings))
  const annotations = useAnnotationStore((s) => s.annotations)
  const articles = useArticleStore((s) => s.articles)
  const records = useAiAssistStore((s) => s.records)
  const upsert = useAiAssistStore((s) => s.upsert)
  const remove = useAiAssistStore((s) => s.remove)

  const [question, setQuestion] = useState('')
  const [qType, setQType] = useState<QuestionType>('大作文')
  const [topic, setTopic] = useState<ArticleTopic | ''>('')
  const [busy, setBusy] = useState(false)
  /** 正在编辑的记录（生成结果或从列表点开）；保存后才落库 */
  const [draft, setDraft] = useState<AssistRecord | null>(null)
  /** 已存列表中展开详情的记录 id */
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /* ---------- 素材候选：素材标注 × 文章 meta，按主题筛选 ---------- */
  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a] as const)), [articles])
  const events = useLearningEventStore((s) => s.events)
  /* 回声排序（使用即复习）：可提取概率低的素材排前，AI 更容易挑中它们——用一次就是复习一次 */
  const materials = useMemo<MaterialCandidate[]>(() => {
    const list: MaterialCandidate[] = []
    for (const a of annotations) {
      if (a.kind !== 'highlight' || !a.materialType) continue
      const art = articleById.get(a.articleId)
      if (topic && art?.topic !== topic) continue
      list.push({ annotation: a, articleTitle: art?.title ?? a.articleId, articleTopic: art?.topic })
    }
    return list.sort((x, y) => echoCompare(x, y, events))
  }, [annotations, articleById, topic, events])

  /* ---------- AI-4 反向联想：从文章联想到命题角度（?infer=<articleId>，拆解面板入口） ---------- */
  const [searchParams, setSearchParams] = useSearchParams()
  const inferId = searchParams.get('infer') ?? ''
  const inferArticle = inferId ? articleById.get(inferId) : undefined
  const [inferBusy, setInferBusy] = useState(false)
  const [inferResult, setInferResult] = useState<InferExamResult | null>(null)
  const [inferError, setInferError] = useState('')
  /** 正在做 L2 完整出题的题干 */
  const [l2Busy, setL2Busy] = useState('')
  const formRef = useRef<HTMLElement>(null)

  const clearInfer = () => {
    if (inferId) setSearchParams({}, { replace: true })
    setInferResult(null)
    setInferError('')
  }

  const runInfer = async () => {
    if (!inferArticle || inferBusy) return
    setInferBusy(true)
    setInferError('')
    try {
      setInferResult(await inferExamCandidates(inferArticle))
    } catch (err) {
      setInferError(err instanceof Error ? err.message : String(err))
    } finally {
      setInferBusy(false)
    }
  }

  /** L1 候选 → 存题：填进正向表单（题干 + 题型），不自动生成，由用户点「生成框架」 */
  const adoptCandidate = (c: InferExamResult['candidates'][number]) => {
    setQuestion(c.question)
    setQType(c.questionType)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** L2 完整出题：生成完整题目草稿（给定资料 + 作答要求 + 参考要点），进编辑区，确认后入库 */
  const runFullExam = async (c: InferExamResult['candidates'][number]) => {
    if (!inferArticle || l2Busy) return
    setL2Busy(c.question)
    try {
      const d = await draftFullExam({
        article: inferArticle,
        question: c.question,
        questionType: c.questionType,
      })
      const rec = emptyRecord(d.question, d.questionType, inferArticle.topic)
      rec.stance = d.requirements
      rec.outline = d.referencePoints.map((text) => ({
        id: `p${Math.random().toString(36).slice(2, 9)}`,
        text,
        materialIds: [],
      }))
      rec.givenMaterial = d.givenMaterial
      rec.referencePoints = d.referencePoints
      rec.sourceArticleId = inferArticle.id
      setDraft(rec)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      void alertDialog(err instanceof Error ? err.message : String(err))
    } finally {
      setL2Busy('')
    }
  }

  const sortedRecords = useMemo(
    () => Object.values(records).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [records],
  )

  /* 从文章页拆解面板「本文题目」点进来：?record=<id> 自动展开该记录 */
  const focusRecordId = searchParams.get('record')
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusRecordId || !records[focusRecordId]) return
    setExpandedId(focusRecordId)
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // 仅在带着 ?record 进入时执行一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRecordId])

  const runGenerate = async () => {
    if (busy) return
    if (!question.trim()) {
      void alertDialog('请先填写题干')
      return
    }
    if (!aiConfigured) {
      void alertDialog('尚未配置 AI 服务：请到 设置 → AI 服务 填入接口地址与 API Key')
      return
    }
    setBusy(true)
    try {
      const d = await draftFramework({
        question: question.trim(),
        questionType: qType,
        topic: topic || undefined,
        materials,
      })
      const rec = emptyRecord(question.trim(), qType, topic || undefined)
      rec.stance = d.stance
      rec.outline = d.points.map((p) => ({
        id: `p${Math.random().toString(36).slice(2, 9)}`,
        text: p.text,
        materialIds: p.materialIds,
      }))
      setDraft(rec)
    } catch (err) {
      void alertDialog(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = () => {
    if (!draft) return
    if (!draft.question.trim()) {
      void alertDialog('题干不能为空')
      return
    }
    /* 使用即复习（证据回写）：保存的框架里挂上的每条素材 = 一次真实调用，权重最高的素材证据 */
    const ev = useLearningEventStore.getState().log
    for (const item of draft.outline) for (const mid of item.materialIds) ev('material-use', mid)
    upsert(draft)
  }

  return (
    <main className="exam-page assist-page">
      <header className="subpage-header exam-hero">
        <div>
          <span className="eyebrow">SHENLUN / AI ASSIST · 审题与框架</span>
          <h1>
            题干进，<span>架子出。</span>
          </h1>
        </div>
        <div className="exam-hero-side">
          <p className="subpage-copy">
            审题立意 + 按题型的作答要点，每个要点挂上你素材库里的卡片。AI 只搭架子、备好料，成文自己写。
          </p>
        </div>
      </header>

      {/* AI-4 反向联想：文章 → 命题角度（从阅读页拆解面板进入） */}
      {inferArticle && (
        <section className="assist-infer">
          <div className="assist-infer-head">
            <div>
              <span className="assist-label">反向联想 · 考点与出题</span>
              <p className="assist-infer-article">
                底本：<Link to={`/reading/${inferArticle.id}`}>《{inferArticle.title}》</Link>
              </p>
            </div>
            <div className="assist-infer-actions">
              <button className="assist-run" disabled={inferBusy || !aiConfigured} onClick={runInfer}>
                {inferBusy ? '联想中…' : inferResult ? '重新联想 ✦' : '联想本篇考点 ✦'}
              </button>
              <button className="ghost" onClick={clearInfer}>
                退出联想
              </button>
            </div>
          </div>
          {!aiConfigured && (
            <p className="assist-material-note">未配置 AI：到 设置 → AI 服务 填入接口地址与 Key 后可用。</p>
          )}
          {inferError && <p className="assist-material-note assist-infer-error">{inferError}</p>}
          {inferResult && (
            <>
              <p className="assist-infer-theme">
                命题主题词：<b>{inferResult.theme || '—'}</b>
                {inferResult.tags.length > 0 && (
                  <span className="assist-infer-tags">
                    {inferResult.tags.map((t) => (
                      <i key={t}>{t}</i>
                    ))}
                  </span>
                )}
              </p>
              <div className="assist-infer-list">
                {inferResult.candidates.map((c, i) => (
                  <div className="assist-infer-cand" key={i}>
                    <div className="assist-infer-cand-main">
                      <div className="assist-infer-qline">
                        <span className="assist-badge">{c.questionType}</span>
                        <p className="assist-infer-q">{c.question}</p>
                      </div>
                      {c.reason && <p className="assist-infer-reason">{c.reason}</p>}
                    </div>
                    <div className="assist-infer-cand-actions">
                      <button
                        className="ghost"
                        title="题干填入下方表单，再生成作答框架"
                        onClick={() => adoptCandidate(c)}
                      >
                        存题搭框架
                      </button>
                      <button
                        className="ghost"
                        disabled={Boolean(l2Busy) || !aiConfigured}
                        title="按真题格式生成完整题目：给定资料 + 作答要求 + 参考要点"
                        onClick={() => runFullExam(c)}
                      >
                        {l2Busy === c.question ? '出题中…' : '完整出题 ✦'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="assist-material-note">
                L1 联想免费轻量；「完整出题」以本文为底本改写给定资料（L2），产出进下方编辑区，确认后才入库。
              </p>
            </>
          )}
        </section>
      )}

      {/* 输入区 */}
      <section className="assist-form" ref={formRef}>
        <textarea
          className="assist-question"
          rows={3}
          placeholder="粘贴题干，如：给定资料提到「城市治理要像绣花一样精细」，以「精细化治理的温度与力度」为题写一篇议论文……"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="assist-form-row">
          <div className="seg assist-types" role="radiogroup" aria-label="题型">
            {QUESTION_TYPES.map((t) => (
              <button key={t} className={qType === t ? 'active' : ''} onClick={() => setQType(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="assist-topic">
            <MenuSelect
              value={topic}
              options={TOPICS.map((t) => ({ key: t, label: t }))}
              placeholder="全部主题"
              form
              onChange={(key) => setTopic(key as ArticleTopic | '')}
              ariaLabel="主题筛选（联动素材）"
            />
          </div>
          <button
            className="assist-run"
            disabled={busy || !question.trim() || !aiConfigured}
            title={aiConfigured ? '生成审题立意与作答框架' : '先到设置页配置 AI 服务'}
            onClick={runGenerate}
          >
            {busy ? '生成中…' : '生成框架 ✦'}
          </button>
        </div>
        <p className="assist-material-note">
          素材联动：
          {materials.length > 0
            ? `当前 ${materials.length} 条候选素材将随题目一起交给 AI 挑选`
            : '素材库暂无候选素材（阅读时选中文字标记为素材后会出现在这里）'}
        </p>
      </section>

      {/* 结果编辑区 */}
      {draft && (
        <section className="assist-editor">
          <div className="assist-editor-head">
            <span className="assist-badge">{draft.questionType}</span>
            <textarea
              className="assist-question-view"
              rows={2}
              value={draft.question}
              onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            />
          </div>

          <div className="assist-stance">
            <span className="assist-label">{draft.givenMaterial ? '作答要求' : '审题立意'}</span>
            <textarea
              rows={draft.givenMaterial ? 2 : 3}
              placeholder={
                draft.givenMaterial ? '作答要求：字数、文体等，真题口吻…' : 'AI 审题：题干关键信息、作答方向与结构策略…'
              }
              value={draft.stance}
              onChange={(e) => setDraft({ ...draft, stance: e.target.value })}
            />
          </div>

          {/* AI-4+ 完整出题：给定资料（底本出处可跳转对照） */}
          {draft.givenMaterial && (
            <div className="assist-stance assist-given">
              <div className="assist-given-head">
                <span className="assist-label">给定资料</span>
                {draft.sourceArticleId && (
                  <small>
                    底本
                    <Link to={`/reading/${draft.sourceArticleId}`}>
                      《{articleById.get(draft.sourceArticleId)?.title ?? '原文'}》
                    </Link>
                    · 点开对照原文
                  </small>
                )}
              </div>
              <textarea
                className="assist-given-material"
                rows={10}
                value={draft.givenMaterial}
                onChange={(e) => setDraft({ ...draft, givenMaterial: e.target.value })}
              />
            </div>
          )}

          <div className="assist-outline">
            <span className="assist-label">
              {draft.givenMaterial ? '参考要点' : '作答框架'}
              <small>
                　
                {draft.givenMaterial
                  ? 'AI 生成，供成文后对照方向（不是批改）；可编辑，每个要点可挂素材卡片'
                  : '每个要点可挂素材卡片，点素材跳原文'}
              </small>
            </span>
            {draft.outline.map((item) => (
              <div className="assist-item" key={item.id}>
                <textarea
                  rows={2}
                  value={item.text}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      outline: draft.outline.map((it) => (it.id === item.id ? { ...it, text: e.target.value } : it)),
                    })
                  }
                />
                {item.materialIds.length > 0 && (
                  <div className="assist-item-mats">
                    {item.materialIds.map((mid) => {
                      const m = materials.find((x) => x.annotation.id === mid)
                      return (
                        <MatChip
                          key={mid}
                          text={m?.annotation.text}
                          type={m?.annotation.materialType}
                          articleId={m?.annotation.articleId}
                          onRemove={() =>
                            setDraft({
                              ...draft,
                              outline: draft.outline.map((it) =>
                                it.id === item.id
                                  ? { ...it, materialIds: it.materialIds.filter((x) => x !== mid) }
                                  : it,
                              ),
                            })
                          }
                        />
                      )
                    })}
                  </div>
                )}
                <div className="assist-item-actions">
                  <MatPicker
                    materials={materials}
                    exclude={item.materialIds}
                    onPick={(annId) =>
                      setDraft({
                        ...draft,
                        outline: draft.outline.map((it) =>
                          it.id === item.id ? { ...it, materialIds: [...it.materialIds, annId] } : it,
                        ),
                      })
                    }
                  />
                  <button
                    className="assist-item-del"
                    aria-label="删除该要点"
                    onClick={() => setDraft({ ...draft, outline: draft.outline.filter((it) => it.id !== item.id) })}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            <button
              className="assist-add-item"
              onClick={() =>
                setDraft({
                  ...draft,
                  outline: [
                    ...draft.outline,
                    { id: `p${Math.random().toString(36).slice(2, 9)}`, text: '', materialIds: [] },
                  ],
                })
              }
            >
              <Plus size={13} /> 添加要点
            </button>
          </div>

          <div className="assist-editor-actions">
            <button className="assist-save" onClick={saveDraft}>
              保存记录
            </button>
            <button className="ghost" onClick={() => setDraft(null)}>
              放弃
            </button>
          </div>
        </section>
      )}

      {/* 历史记录 */}
      <section className="assist-records">
        <h2>已存框架 · {sortedRecords.length}</h2>
        {sortedRecords.length === 0 && <p className="assist-empty">还没有保存的框架记录。</p>}
        {sortedRecords.map((r) => (
          <div
            className={`assist-record${expandedId === r.id ? ' expanded' : ''}`}
            key={r.id}
            ref={focusRecordId === r.id ? scrollRef : undefined}
          >
            <button
              className="assist-record-main"
              title={expandedId === r.id ? '收起详情' : '展开查看完整内容'}
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
            >
              <div className="assist-record-meta">
                <span className="assist-badge">{r.questionType}</span>
                {r.givenMaterial && <span className="assist-topic-tag">完整题目</span>}
                {r.topic && <span className="assist-topic-tag">{r.topic}</span>}
                <span className="assist-date">{r.updatedAt.slice(0, 10)}</span>
              </div>
              <p className="assist-record-q">{r.question}</p>
              {expandedId !== r.id ? (
                <>
                  {r.stance && <p className="assist-record-stance">{r.stance}</p>}
                  <p className="assist-record-count">
                    {r.outline.length} 个要点 · {r.outline.reduce((n, it) => n + it.materialIds.length, 0)} 条素材挂载
                    {r.givenMaterial && ' · 含给定资料'} · 点击展开
                  </p>
                </>
              ) : (
                <div className="assist-record-detail">
                  {r.stance && (
                    <div className="assist-detail-sec">
                      <span className="assist-detail-label">{r.givenMaterial ? '作答要求' : '审题立意'}</span>
                      <p>{r.stance}</p>
                    </div>
                  )}
                  {/* 资料 + 要点双栏并排：左栏读材料、右栏对照要点，宽屏不浪费、窄屏自动堆叠 */}
                  {(r.givenMaterial || r.outline.length > 0) && (
                    <div className={`assist-detail-cols${r.givenMaterial && r.outline.length > 0 ? ' two' : ''}`}>
                      {r.givenMaterial && (
                        <div className="assist-detail-sec">
                          <span className="assist-detail-label">
                            给定资料
                            {r.sourceArticleId && (
                              <Link to={`/reading/${r.sourceArticleId}`} onClick={(e) => e.stopPropagation()}>
                                　底本《{articleById.get(r.sourceArticleId)?.title ?? '原文'}》
                              </Link>
                            )}
                          </span>
                          <p className="assist-detail-material">{r.givenMaterial}</p>
                        </div>
                      )}
                      {r.outline.length > 0 && (
                        <div className="assist-detail-sec">
                          <span className="assist-detail-label">{r.givenMaterial ? '参考要点' : '作答框架'}</span>
                          <ol className="assist-detail-points">
                            {r.outline.map((it) => (
                              <li key={it.id}>
                                {it.text || '（空要点）'}
                                {it.materialIds.length > 0 && (
                                  <span className="assist-detail-mats">　{it.materialIds.length} 条素材</span>
                                )}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="assist-record-count">点击收起；点「编辑」可修改内容</p>
                </div>
              )}
            </button>
            <div className="assist-record-actions">
              <button className="ghost" onClick={() => setDraft(structuredClone(r))}>
                编辑
              </button>
              <button
                className="ghost"
                aria-label="删除记录"
                onClick={() => {
                  if (draft?.id === r.id) setDraft(null)
                  remove(r.id)
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </section>
    </main>
  )
}

/** 素材小卡：显示类型 + 摘文，点击跳原文划线位置 */
function MatChip({
  text,
  type,
  articleId,
  onRemove,
}: {
  text?: string
  type?: keyof typeof MATERIAL_TYPE_LABELS
  articleId?: string
  onRemove: () => void
}) {
  const label = type ? MATERIAL_TYPE_LABELS[type] : '素材'
  const body = text ? (text.length > 24 ? `${text.slice(0, 24)}…` : text) : '（素材不在当前筛选中）'
  return (
    <span className="assist-chip">
      {articleId ? (
        <Link to={`/reading/${articleId}`} className="assist-chip-link" title={body}>
          <b>{label}</b>
          {body}
        </Link>
      ) : (
        <span className="assist-chip-link" title="该素材被删除或不在候选中">
          <b>{label}</b>
          {body}
        </span>
      )}
      <button aria-label="移除挂载" onClick={onRemove}>
        <X size={11} />
      </button>
    </span>
  )
}

/** 手动挂素材：自定义下拉（原生 select 弹层样式不可控，与主题不搭） */
function MatPicker({
  materials,
  exclude,
  onPick,
}: {
  materials: MaterialCandidate[]
  exclude: string[]
  onPick: (annotationId: string) => void
}) {
  const rest = materials.filter((m) => !exclude.includes(m.annotation.id))
  if (rest.length === 0) return null
  return (
    <div className="assist-mat-picker">
      <MenuSelect
        value=""
        placeholder="+ 挂素材"
        options={rest.slice(0, 80).map((m) => ({
          key: m.annotation.id,
          label: `[${MATERIAL_TYPE_LABELS[m.annotation.materialType!]}] ${m.annotation.text.replace(/\s+/g, '').slice(0, 20)}`,
        }))}
        onChange={onPick}
        ariaLabel="挂载素材"
      />
    </div>
  )
}
