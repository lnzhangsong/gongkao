import { useEffect, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { ExamQuestion } from '../../lib/api'
import { draftAnswerTrace, type TraceExamMaterial } from '../../lib/aiExamTrace'
import {
  DERIVE_MODES,
  DERIVE_MODE_HINTS,
  traceKey,
  useExamStudyStore,
  type AnswerPointTrace,
  type DeriveMode,
} from '../../stores/examStudyStore'
import { useAiStore, isAiConfigured } from '../../stores/aiStore'
import { MenuSelect } from '../ui/MenuSelect'
import { alertDialog } from '../ui/ConfirmDialog'

/**
 * 要点列表（题目解析抽屉第一节）：
 * 有参考答案 = 溯源（答案每句话怎么来的），无答案 = 推导（AI 从材料造参考要点）。
 * 每条要点一张叙事卡：加工方式徽标 + 要点句 + 推理链（思路 → 出处 → 加工）。
 * AI 产出先进草稿态（A3：生成 → 人工确认 → 入库）；入库后行内编辑直接写 store。
 */
export function ExamAnswerTrace({
  paperId,
  q,
  materials,
  relatedIdx,
  anchorByNum,
  onJump,
  defaultOpen = false,
  autoToken = 0,
  editing: editingProp = false,
  onToggleEditing,
  onBusyChange,
}: {
  paperId: string
  q: ExamQuestion
  /** 全卷材料（AI prompt + 来源下拉 + 跳转） */
  materials: TraceExamMaterial[]
  /** 本题相关材料编号（questionMaterials 匹配结果） */
  relatedIdx: number[]
  /** 材料编号 → 锚点 id */
  anchorByNum: Map<number, string>
  onJump: (id: string) => void
  /** 抽屉内使用时默认展开 */
  defaultOpen?: boolean
  /** 「AI 解析本题」一键令牌：变化时自动触发本区块的 AI */
  autoToken?: number
  /** 编辑态由抽屉头「编辑」按钮统一控制；关闭编辑 = 保存入库 */
  editing?: boolean
  onToggleEditing?: () => void
  /** 向抽屉上报 AI 是否进行中（主按钮 loading） */
  onBusyChange?: (busy: boolean) => void
}) {
  const trace = useExamStudyStore((s) => s.traces[traceKey(paperId, q.idx)])
  const setPoints = useExamStudyStore((s) => s.setPoints)
  const addPoint = useExamStudyStore((s) => s.addPoint)
  const updatePoint = useExamStudyStore((s) => s.updatePoint)
  const removePoint = useExamStudyStore((s) => s.removePoint)
  const aiConfigured = useAiStore((s) => isAiConfigured(s.settings))

  const [selfOpen, setSelfOpen] = useState(defaultOpen)
  const open = selfOpen
  /* AI 草稿：生成 → 行内编辑 → 确认入库 / 放弃 */
  const [draft, setDraft] = useState<AnswerPointTrace[] | null>(null)
  const [busy, setBusy] = useState(false)
  const editing = Boolean(draft) || editingProp
  const [error, setError] = useState('')
  /* 要点展示形态：导图（默认）/ 文字链 */
  const [view, setView] = useState<'map' | 'text'>('map')

  const points = draft ?? trace?.points ?? []
  const hasAnswer = Boolean(q.answer)
  const hasTrace = Boolean(trace?.points.length)

  /** AI 相关材料优先，未匹配到则给全卷 */
  const promptMaterials = relatedIdx.length > 0 ? materials.filter((m) => relatedIdx.includes(m.idx)) : materials

  useEffect(() => {
    if (autoToken > 0) void runAi()
    // 仅响应一键解析令牌
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [autoToken])

  /* AI 草稿生成后自动进入编辑态（顶部按钮变「完成编辑」），由顶部操作保存 */
  useEffect(() => {
    if (draft && !editingProp) onToggleEditing?.()
    // 仅响应草稿生成
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  /* 顶部「完成编辑」= 保存入库：把草稿写入 store */
  useEffect(() => {
    if (!editingProp && draft) {
      setPoints(paperId, q.idx, draft, 'ai')
      setDraft(null)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [editingProp])

  const runAi = async () => {
    if (busy) return
    if (!aiConfigured) {
      void alertDialog('尚未配置 AI 服务：请到 设置 → AI 服务 填入接口地址与 API Key')
      return
    }
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    try {
      setDraft(
        await draftAnswerTrace({
          question: { idx: q.idx, type: q.type, stem: q.stem, requirement: q.requirement, answer: q.answer },
          materials: promptMaterials,
        }),
      )
      setSelfOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  const startManual = () => {
    const empty: AnswerPointTrace = {
      id: `t${Math.random().toString(36).slice(2, 10)}`,
      text: '',
      mode: '摘抄',
      sourceIdx: relatedIdx[0] ?? materials[0]?.idx ?? null,
    }
    if (hasTrace) addPoint(paperId, q.idx, empty)
    else setPoints(paperId, q.idx, [empty], 'manual')
    onToggleEditing?.()
    setSelfOpen(true)
  }

  const patchRow = (id: string, patch: Partial<AnswerPointTrace>, inDraft: boolean) => {
    if (inDraft) setDraft((prev) => prev?.map((p) => (p.id === id ? { ...p, ...patch } : p)) ?? prev)
    else updatePoint(paperId, q.idx, id, patch)
  }

  const removeRow = (id: string, inDraft: boolean) => {
    if (inDraft) setDraft((prev) => prev?.filter((p) => p.id !== id) ?? prev)
    else removePoint(paperId, q.idx, id)
  }

  const materialOptions = [
    ...materials.map((m) => ({ key: String(m.idx), label: m.label || `材料${m.idx}` })),
    { key: 'none', label: '材料外' },
  ]

  return (
    <section className="draw-sec">
      <header className="draw-sec-head">
        <h3 className="draw-sec-title">
          {hasAnswer ? '答案溯源' : '要点推导'}
          {points.length > 0 && <small>{points.length} 条要点</small>}
        </h3>
        {open && points.length > 0 && (
          <div className="trace-view-toggle" role="tablist" aria-label="要点展示形态">
            <button
              type="button"
              className={view === 'map' ? 'on' : ''}
              aria-pressed={view === 'map'}
              onClick={() => setView('map')}
            >
              导图
            </button>
            <button
              type="button"
              className={view === 'text' ? 'on' : ''}
              aria-pressed={view === 'text'}
              onClick={() => setView('text')}
            >
              文字
            </button>
          </div>
        )}
      </header>

      {error && <p className="draw-error">{error}</p>}

      {open && (
        <details className="trace-mode-guide">
          <summary>加工方式怎么选？</summary>
          <ul>
            {DERIVE_MODES.map((m) => (
              <li key={m}>
                <span className={`draw-mode m${DERIVE_MODES.indexOf(m)}`}>{m}</span>
                {DERIVE_MODE_HINTS[m]}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!open ? (
        <p className="draw-hint">
          {hasAnswer
            ? 'AI 逐条讲清答案每句话怎么来的，或手动标注出处与加工。'
            : '本题无参考答案：AI 从材料推导参考要点，每条附定位方法、加工判断与原文出处。'}
          <button type="button" className="text-btn" style={{ marginLeft: 8 }} onClick={() => setSelfOpen(true)}>
            展开
          </button>
        </p>
      ) : (
        <>
          {draft && <p className="draw-hint">AI 草稿 · 顶部「完成编辑」保存入库</p>}
          <div>
            {points.map((p, i) => (
              <PointCard
                key={p.id}
                no={i + 1}
                point={p}
                view={view}
                materials={materials}
                materialOptions={materialOptions}
                anchorByNum={anchorByNum}
                onJump={onJump}
                editing={Boolean(draft) || editing}
                onChange={(patch) => patchRow(p.id, patch, Boolean(draft))}
                onRemove={() => removeRow(p.id, Boolean(draft))}
              />
            ))}
            {points.length === 0 && (
              <p className="draw-hint">
                {hasAnswer ? '还没有要点。' : '还没有推导要点。'}点上方「AI 解析本题 ✦」，或
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    startManual()
                    onToggleEditing?.()
                  }}
                >
                  手动拆解
                </button>
                逐条编写。
              </p>
            )}
          </div>
          {!draft && hasTrace && (
            <div className="draw-foot">
              <span className="draw-count">
                {trace!.origin === 'ai' ? 'AI 生成 · 已人工确认' : '手动拆解'} · 存于本地
              </span>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** 要点叙事卡：编辑态可改写；只读态是「定位 → 材料 → 加工判断 → 要点句」方法链 */
function PointCard({
  no,
  point,
  view,
  materials,
  materialOptions,
  anchorByNum,
  onJump,
  editing,
  onChange,
  onRemove,
}: {
  no: number
  point: AnswerPointTrace
  /** 只读态展示形态：导图 / 文字链 */
  view: 'map' | 'text'
  materials: TraceExamMaterial[]
  materialOptions: { key: string; label: string }[]
  anchorByNum: Map<number, string>
  onJump: (id: string) => void
  editing: boolean
  onChange: (patch: Partial<AnswerPointTrace>) => void
  onRemove: () => void
}) {
  const material = materials.find((m) => m.idx === point.sourceIdx)
  if (editing) {
    return (
      <article className="draw-card">
        <div className="draw-card-top">
          <span className="draw-no">{no}</span>
          <span className={`draw-mode m${DERIVE_MODES.indexOf(point.mode)}`} title={DERIVE_MODE_HINTS[point.mode]}>
            {point.mode}
          </span>
          <textarea
            className="draw-point-input"
            rows={2}
            value={point.text}
            placeholder="要点句（对应参考答案中的一条）"
            onChange={(e) => onChange({ text: e.target.value })}
          />
          <button type="button" className="draw-del" aria-label="删除该要点" onClick={onRemove}>
            <Trash2 size={12} />
          </button>
        </div>
        <div className="draw-edit">
          <textarea
            rows={2}
            value={point.think ?? ''}
            placeholder="思路：题干哪个词 → 定位哪则材料 → 怎么提炼出这条"
            onChange={(e) => onChange({ think: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <MenuSelect
              compact
              form
              value={point.sourceIdx != null ? String(point.sourceIdx) : 'none'}
              options={materialOptions}
              onChange={(key) => onChange({ sourceIdx: key === 'none' ? null : parseInt(key, 10) })}
              ariaLabel="来源材料"
            />
            <MenuSelect
              compact
              form
              value={point.mode}
              options={DERIVE_MODES.map((m) => ({ key: m, label: m }))}
              onChange={(key) => onChange({ mode: key as DeriveMode })}
              ariaLabel="加工方式"
            />
          </div>
          <input
            value={point.quote ?? ''}
            placeholder="原文摘句（材料里的原话）"
            onChange={(e) => onChange({ quote: e.target.value })}
          />
          <input
            value={point.note ?? ''}
            placeholder="加工说明：原文 → 答案话，经过了什么"
            onChange={(e) => onChange({ note: e.target.value })}
          />
        </div>
      </article>
    )
  }
  const anchor = point.sourceIdx != null ? anchorByNum.get(point.sourceIdx) : undefined
  /* 只读态方法链数据：定位 → 材料 → 加工判断；文字链与导图共用同一份 */
  const steps: { key: string; label: string; tone: string; node: ReactNode }[] = []
  if (point.locate || point.think) {
    steps.push({
      key: 'q',
      label: '定位',
      tone: 'n-locate',
      node: <span>{point.locate ?? point.think}</span>,
    })
  }
  if (point.sourceIdx != null || point.quote) {
    steps.push({
      key: 'm',
      label: '材料',
      tone: 'n-mat',
      node: (
        <>
          {point.sourceIdx != null &&
            (anchor ? (
              <button
                type="button"
                className="exam-jump-chip trace-src"
                onClick={() => onJump(anchor)}
                title={`跳到${material?.label ?? `材料${point.sourceIdx}`}原句`}
              >
                {material?.label || `材料${point.sourceIdx}`} ↖
              </button>
            ) : (
              <span className="exam-jump-chip trace-src">{material?.label || `材料${point.sourceIdx}`}</span>
            ))}
          {point.quote && <span className="draw-quote">「{point.quote}」</span>}
          {point.sourceIdx == null && !point.quote && <span>材料外</span>}
        </>
      ),
    })
  }
  if (point.modeWhy || point.note || point.mode) {
    steps.push({
      key: 'p',
      label: '加工',
      tone: 'n-mode',
      node: (
        <>
          <span className={`draw-mode m${DERIVE_MODES.indexOf(point.mode)}`} title={DERIVE_MODE_HINTS[point.mode]}>
            {point.mode}
          </span>
          {point.modeWhy && <span>{point.modeWhy}</span>}
          {!point.modeWhy && point.note && <span>{point.note}</span>}
        </>
      ),
    })
  }
  if (view === 'map' && steps.length > 0) {
    /* 导图视图：节点卡 + 带箭头连线，终点是要点句 */
    return (
      <article className="draw-card trace-chain">
        <div className="trace-map">
          {steps.map((s) => (
            <MapNode key={s.key} step={s} />
          ))}
          <div className="trace-map-point">
            <span className="draw-no">{no}</span>
            <p>{point.text}</p>
          </div>
        </div>
      </article>
    )
  }
  return (
    <article className="draw-card trace-chain">
      {steps.length > 0 && (
        <ol className="trace-steps">
          {steps.map((s) => (
            <li key={s.key} className="trace-step">
              <span className="trace-step-label">{s.label}</span>
              <div className="trace-step-body">{s.node}</div>
            </li>
          ))}
        </ol>
      )}
      <p className="trace-point">
        <span className="draw-no">{no}</span>
        {point.text}
      </p>
    </article>
  )
}

/** 导图节点：顶部色条小标题 + 内容体，节点间由 .trace-map 的连线元素衔接 */
function MapNode({ step }: { step: { key: string; label: string; tone: string; node: ReactNode } }) {
  return (
    <>
      <div className={`trace-map-node ${step.tone}`}>
        <span className="trace-map-cap">{step.label}</span>
        <div className="trace-map-body">{step.node}</div>
      </div>
      <span className="trace-map-link" aria-hidden="true" />
    </>
  )
}
