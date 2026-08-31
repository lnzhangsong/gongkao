import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useShenlunStore, type StudyStatus } from '../stores/shenlunStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { MATERIAL_TYPE_LABELS } from '../data/material'
import type { Article } from '../types'

const STATUS_OPTIONS: { key: StudyStatus; label: string }[] = [
  { key: 'new', label: '未学' },
  { key: 'learning', label: '学习中' },
  { key: 'mastered', label: '已掌握' },
]

interface ShenlunPanelProps {
  article: Article
  onClose: () => void
  /** 定位正文：段落锚点 */
  scrollToPara: (paraIndex: number) => void
  /** 定位正文：摘录标注 */
  scrollToAnnotation: (annotationId: string) => void
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
  const summaryByPara = useMemo(
    () => new Map(summaries.map((s) => [s.paraIndex, s.summary])),
    [summaries],
  )
  const skeleton = study?.skeleton
  const patterns = materialByType.get('pattern') ?? []

  /** 由逐段大意推导骨架候选：首段=开头，中间=层次，尾段=收尾（覆盖现有骨架，可再手工调整） */
  const deriveSkeleton = () => {
    if (summaries.length === 0) return
    const body = summaries.filter((s) => s.paraIndex !== summaries[0].paraIndex && s.paraIndex !== summaries[summaries.length - 1].paraIndex)
    setSkeleton(article.id, {
      opening: summaryByPara.get(summaries[0].paraIndex) ?? '',
      bodyLayers: body.map((s) => s.summary),
      closing: summaryByPara.get(summaries[summaries.length - 1].paraIndex) ?? '',
    })
  }

  return (
    <>
      <div className="shenlun-backdrop" onClick={onClose} />
      <aside className="shenlun-panel" role="dialog" aria-label="申论拆解">
        <header className="shenlun-head">
          <div>
            <span className="shenlun-eyebrow">SHENLUN / 拆解 · 精读</span>
            <h3>{article.title}</h3>
          </div>
          <button className="shenlun-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="shenlun-body">
          {/* 学习状态 */}
          <section className="shenlun-sec">
            <div className="shenlun-sec-row">
              <span className="shenlun-label">学习状态</span>
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

          {/* 核心观点 */}
          <section className="shenlun-sec">
            <span className="shenlun-label">核心观点</span>
            <textarea
              className="shenlun-input"
              placeholder="这篇文章主张什么？"
              value={study?.coreThesis ?? ''}
              onChange={(e) => setCoreThesis(article.id, e.target.value)}
            />
          </section>

          {/* 分论点 */}
          <section className="shenlun-sec">
            <span className="shenlun-label">分论点</span>
            {(study?.subTheses ?? []).map((t, i) => (
              <div className="sub-thesis" key={i}>
                <input
                  value={t}
                  onChange={(e) => updateSubThesis(article.id, i, e.target.value)}
                />
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

          {/* 范文精读：每段大意 */}
          <section className="shenlun-sec">
            <span className="shenlun-label">
              每段大意
              <small>　逐段一句话概括，点「定位」跳到原文</small>
            </span>
            {(article.content ?? []).map((_, i) => (
              <div className="para-summary" key={i}>
                <button className="para-go" onClick={() => scrollToPara(i)} title="定位到该段">
                  {i + 1}
                </button>
                <input
                  placeholder={`第 ${i + 1} 段大意…`}
                  defaultValue={summaryByPara.get(i) ?? ''}
                  onBlur={(e) => setParagraphSummary(article.id, i, e.target.value)}
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
                  transitions: v.split('\n').map((s) => s.trim()).filter(Boolean),
                })
              }
            />
            <SkeletonField
              label="收尾"
              value={skeleton?.closing ?? ''}
              onChange={(v) => setSkeleton(article.id, { closing: v })}
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
                  <span className={`mat-group-title mat-${t}`}>{MATERIAL_TYPE_LABELS[t]} · {list.length}</span>
                  {list.map((m) => (
                    <div className="mat-card" key={m.id}>
                      <button className="mat-card-text" onClick={() => scrollToAnnotation(m.id)}>
                        “{m.text.length > 48 ? `${m.text.slice(0, 48)}…` : m.text}”
                      </button>
                      {t === 'pattern' && (
                        <input
                          className="mat-card-pattern"
                          placeholder="可迁移模板…"
                          defaultValue={m.pattern ?? ''}
                          onBlur={(e) => updateAnnotation(m.id, { pattern: e.target.value.trim() || undefined })}
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
            {materialByType.size === 0 && (
              <p className="shenlun-empty">阅读时选中文字标记为素材，会出现在这里。</p>
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

/** 骨架字段：单值（textarea）或列表（bodyLayers 逐条） */
function SkeletonField({
  label,
  value = '',
  valueList,
  onChange,
  onChangeList,
  list,
}: {
  label: string
  value?: string
  valueList?: string[]
  onChange?: (v: string) => void
  onChangeList?: (v: string[]) => void
  list?: boolean
}) {
  const [extra, setExtra] = useState('')
  if (list && onChangeList) {
    const items = valueList ?? []
    return (
      <div className="skeleton-field">
        <span className="skeleton-label">{label}</span>
        {items.map((it, i) => (
          <div className="sub-thesis" key={i}>
            <input
              value={it}
              onChange={(e) => onChangeList(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
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
        value={value}
        placeholder={`${label}方式…`}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  )
}
