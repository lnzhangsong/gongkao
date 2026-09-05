import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { MaterialMark } from '../../stores/examStudyStore'

const short = (q: string, max: number) => {
  const t = q.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

const CN_NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
const numOf = (i: number) => (i < 10 ? CN_NUM[i] : `${i + 1}`)

interface StageGroup {
  role: string
  marks: MaterialMark[]
  from: number
}

/** 连续同「行文作用」的标注归为一个行文阶段，保持原文顺序 */
function groupByStage(marks: MaterialMark[]): StageGroup[] {
  const groups: StageGroup[] = []
  for (let i = 0; i < marks.length; i++) {
    const last = groups[groups.length - 1]
    if (last && last.role === marks[i].role) last.marks.push(marks[i])
    else groups.push({ role: marks[i].role, marks: [marks[i]], from: i })
  }
  return groups
}

/* ---------- 自定义节点：根 / 阶段 / 句子 ---------- */

type RootData = { label: string }
type StageData = { role: string; range: string; core: boolean }
type LeafData = { no: string; quote: string; use: string; core: boolean }
type FlowNodeType = Node<Record<string, unknown>>

function RootNodeView({ data }: NodeProps<FlowNodeType>) {
  const d = data as RootData
  return (
    <div className="rf-root-node">
      <span className="rf-root-label">{d.label}</span>
      <span className="rf-root-sub">行文思路</span>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function StageNodeView({ data }: NodeProps<FlowNodeType>) {
  const d = data as StageData
  return (
    <div className={`rf-stage-node${d.core ? ' core' : ''}`}>
      <span className="rf-stage-role">{d.role}</span>
      <small>{d.range}</small>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function LeafNodeView({ data }: NodeProps<FlowNodeType>) {
  const d = data as LeafData
  return (
    <div className={`rf-leaf-node${d.core ? ' core' : ''}`} title={d.use}>
      <span className="rf-leaf-no">{d.no}</span>
      <p className="rf-leaf-quote">「{d.quote}」</p>
      {d.use && <p className="rf-leaf-use">{d.use}</p>}
      <Handle type="target" position={Position.Left} />
    </div>
  )
}

const nodeTypes = {
  root: RootNodeView,
  stage: StageNodeView,
  leaf: LeafNodeView,
}

/* ---------- 布局：三列（根 / 阶段 / 句子），行高按内容估算，fitView 兜底 ---------- */

const LEAF_W = 260
const LEAF_H = 104
const LEAF_GAP = 10
const STAGE_H = 56
const COL_ROOT_X = 0
const COL_STAGE_X = 240
const COL_LEAF_X = 470

function buildGraph(label: string, marks: MaterialMark[]) {
  const groups = groupByStage(marks)
  const nodes: Node[] = []
  const edges: Edge[] = []

  let y = 0
  for (const g of groups) {
    const n = g.marks.length
    /* 阶段内句子多了拆两列，压总高，保证 fitView 后字号仍可读 */
    const twoCol = n > 3
    const rows = twoCol ? Math.ceil(n / 2) : n
    const top = y
    g.marks.forEach((m, i) => {
      const col = twoCol ? (i < rows ? 0 : 1) : 0
      const row = twoCol ? (col === 0 ? i : i - rows) : i
      nodes.push({
        id: `leaf-${g.from + i}`,
        type: 'leaf',
        position: { x: COL_LEAF_X + col * (LEAF_W + 28), y: top + row * (LEAF_H + LEAF_GAP) },
        data: {
          no: numOf(g.from + i),
          quote: short(m.quote, 40),
          use: short(m.use ?? '', 60),
          core: m.level === 'core',
        },
        draggable: false,
      } satisfies Node)
    })
    y = top + rows * (LEAF_H + LEAF_GAP) - LEAF_GAP
    const center = (top + y) / 2
    nodes.push({
      id: `stage-${g.from}`,
      type: 'stage',
      position: { x: COL_STAGE_X, y: center - STAGE_H / 2 },
      data: {
        role: g.role,
        range: `${numOf(g.from)}–${numOf(g.from + n - 1)} · ${n}句`,
        core: g.marks.some((m) => m.level === 'core'),
      },
      draggable: false,
    } satisfies Node)
    y += LEAF_GAP + 14
  }

  const totalH = Math.max(y - LEAF_GAP - 14, STAGE_H)
  nodes.push({
    id: 'root',
    type: 'root',
    position: { x: COL_ROOT_X, y: totalH / 2 - STAGE_H / 2 },
    data: { label },
    draggable: false,
  } satisfies Node)

  for (const g of groups) {
    edges.push({
      id: `e-root-${g.from}`,
      source: 'root',
      target: `stage-${g.from}`,
      className: 'rf-edge',
    })
    g.marks.forEach((_, i) => {
      edges.push({
        id: `e-${g.from}-${i}`,
        source: `stage-${g.from}`,
        target: `leaf-${g.from + i}`,
        className: 'rf-edge',
      })
    })
  }

  return { nodes, edges, totalH }
}

/**
 * 材料行文思路导图（弹窗·React Flow）：根（材料）→ 行文阶段 → 句子，
 * 连线由库渲染（贝塞尔曲线），支持缩放/平移，fitView 保证长材料一屏看全。
 */
export function ExamMaterialFlowModal({
  label,
  marks,
  onClose,
}: {
  label: string
  marks: MaterialMark[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { nodes, edges, totalH } = useMemo(() => buildGraph(label, marks), [label, marks])

  /* 初始视口让根节点垂直居中（100% 缩放），横排从左缘起 */
  const defaultViewport = useMemo(() => {
    const canvasH = Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.66 : 600, 620)
    return { x: 24, y: canvasH / 2 - totalH / 2, zoom: 1 }
  }, [totalH])

  return createPortal(
    <div className="exam-modal-mask" onClick={onClose}>
      <div
        className="exam-modal exam-flow-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${label}行文思路导图`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="exam-flow-head">
          <h3>
            {label} · 行文思路导图 <small>{marks.length} 句 · 自上而下顺原文推进 · 滚轮缩放</small>
          </h3>
          <button type="button" className="exam-flow-close" aria-label="关闭导图" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="rf-flow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            /* 默认 100% 保证可读；滚轮平移（Figma 式），右下角按钮/捏合缩放看全貌 */
            defaultViewport={defaultViewport}
            minZoom={0.25}
            maxZoom={1.3}
            panOnScroll
            zoomOnScroll={false}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            edgesFocusable={false}
            zoomOnDoubleClick={false}
          >
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      </div>
    </div>,
    document.body,
  )
}
