import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { draftFramework, type MaterialCandidate } from '../lib/aiAssist'
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

  /* ---------- 素材候选：素材标注 × 文章 meta，按主题筛选 ---------- */
  const articleById = useMemo(
    () => new Map(articles.map((a) => [a.id, a] as const)),
    [articles],
  )
  const materials = useMemo<MaterialCandidate[]>(() => {
    const list: MaterialCandidate[] = []
    for (const a of annotations) {
      if (a.kind !== 'highlight' || !a.materialType) continue
      const art = articleById.get(a.articleId)
      if (topic && art?.topic !== topic) continue
      list.push({ annotation: a, articleTitle: art?.title ?? a.articleId, articleTopic: art?.topic })
    }
    return list.sort((x, y) => y.annotation.createdAt.localeCompare(x.annotation.createdAt))
  }, [annotations, articleById, topic])

  const sortedRecords = useMemo(
    () => Object.values(records).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [records],
  )

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

      {/* 输入区 */}
      <section className="assist-form">
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
          素材联动：{materials.length > 0 ? `当前 ${materials.length} 条候选素材将随题目一起交给 AI 挑选` : '素材库暂无候选素材（阅读时选中文字标记为素材后会出现在这里）'}
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
            <span className="assist-label">审题立意</span>
            <textarea
              rows={3}
              placeholder="AI 审题：题干关键信息、作答方向与结构策略…"
              value={draft.stance}
              onChange={(e) => setDraft({ ...draft, stance: e.target.value })}
            />
          </div>

          <div className="assist-outline">
            <span className="assist-label">
              作答框架
              <small>　每个要点可挂素材卡片，点素材跳原文</small>
            </span>
            {draft.outline.map((item) => (
              <div className="assist-item" key={item.id}>
                <textarea
                  rows={2}
                  value={item.text}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      outline: draft.outline.map((it) =>
                        it.id === item.id ? { ...it, text: e.target.value } : it,
                      ),
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
                    onClick={() =>
                      setDraft({ ...draft, outline: draft.outline.filter((it) => it.id !== item.id) })
                    }
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
          <div className="assist-record" key={r.id}>
            <div className="assist-record-main">
              <div className="assist-record-meta">
                <span className="assist-badge">{r.questionType}</span>
                {r.topic && <span className="assist-topic-tag">{r.topic}</span>}
                <span className="assist-date">{r.updatedAt.slice(0, 10)}</span>
              </div>
              <p className="assist-record-q">{r.question}</p>
              {r.stance && <p className="assist-record-stance">{r.stance}</p>}
              <p className="assist-record-count">
                {r.outline.length} 个要点 ·{' '}
                {r.outline.reduce((n, it) => n + it.materialIds.length, 0)} 条素材挂载
              </p>
            </div>
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
