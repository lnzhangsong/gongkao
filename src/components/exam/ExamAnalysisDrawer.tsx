import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import type { ExamQuestion } from '../../lib/api'
import { type TraceExamMaterial } from '../../lib/aiExamTrace'
import { traceKey, useExamStudyStore } from '../../stores/examStudyStore'
import { ExamAnswerTrace } from './ExamAnswerTrace'
import { useIsMobileViewport } from '../../lib/useIsMobileViewport'
import { usePanelResize } from '../../lib/usePanelResize'

/**
 * 题目解析抽屉（复用拆解面板 shenlun-panel 的抽屉骨架：桌面右侧 / 移动底部）：
 * 针对本题的要点溯源/推导，每条一张叙事卡（思路 → 出处 → 加工 → 要点句）。
 * 原文标注改由材料标题行的「生成思路 ✦」入口承担，不再进本抽屉。
 * 由真题页每题「解析」入口打开，一次只开一题，portal 到 body 避开 fade-in 层叠上下文。
 */
export function ExamAnalysisDrawer({
  paperId,
  q,
  materials,
  relatedIdx,
  anchorByNum,
  onJump,
  onClose,
}: {
  paperId: string
  q: ExamQuestion
  materials: TraceExamMaterial[]
  relatedIdx: number[]
  anchorByNum: Map<number, string>
  onJump: (id: string) => void
  onClose: () => void
}) {
  /* Escape 关闭；移动端（覆盖式底部面板）锁正文滚动——桌面端为上下分栏，正文照常滚动 */
  const isMobile = useIsMobileViewport()
  const { height: panelHeight, onHandleDown } = usePanelResize()
  /* 全屏：面板拉到 90vh，拖高把手暂时失效 */
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => setFullscreen(false), [paperId, q.idx])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    if (!isMobile) return () => document.removeEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, isMobile])

  /* 题干预览：题目可能很长，默认两行截断，点击展开全文 */
  const [stemOpen, setStemOpen] = useState(false)
  /* 一键解析：令牌变化时触发要点区 AI */
  const [autoToken, setAutoToken] = useState(0)
  /* 要点编辑态：入口统一收在抽屉头「编辑」，再点一次「完成编辑」即保存入库 */
  const [traceEditing, setTraceEditing] = useState(false)
  const [running, setRunning] = useState(0)
  const onSectionBusy = (busy: boolean) => setRunning((n) => Math.max(0, n + (busy ? 1 : -1)))
  const hasTrace = Boolean(useExamStudyStore((st) => st.traces[traceKey(paperId, q.idx)]?.points.length))
  useEffect(() => setTraceEditing(false), [paperId, q.idx])

  return createPortal(
    <>
      {isMobile && <div className="shenlun-backdrop" onClick={onClose} />}
      <aside
        className="shenlun-panel exam-draw"
        role="dialog"
        aria-label={`第${q.idx}题解析`}
        style={isMobile ? undefined : { height: fullscreen ? '90vh' : panelHeight }}
      >
        {!isMobile && !fullscreen && (
          <div className="panel-resize-handle" onPointerDown={onHandleDown} aria-label="调整面板高度" />
        )}
        <header className="shenlun-head">
          <div>
            <span className="shenlun-eyebrow">
              EXAM / 第{q.idx}题 · {q.type ?? '未分类'}
            </span>
            <h3>{q.answer ? '这道题的答案怎么来的' : '这道题该怎么推导答案'}</h3>
          </div>
          <div className="draw-head-actions">
            {(hasTrace || traceEditing) && (
              <button
                type="button"
                className="text-btn"
                onClick={() => setTraceEditing((v) => !v)}
                title={traceEditing ? '保存入库并退出编辑' : '编辑要点：改写 / 删除已有条目，改动即时保存'}
              >
                {traceEditing ? '完成编辑' : '编辑'}
              </button>
            )}
            {!isMobile && (
              <button
                type="button"
                className="text-btn exam-fullscreen-btn"
                onClick={() => setFullscreen((v) => !v)}
                aria-label={fullscreen ? '退出全屏' : '全屏'}
                title={fullscreen ? '退出全屏' : '全屏（占满大半屏幕）'}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            )}
            <button className="shenlun-close" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="shenlun-body">
          <button
            type="button"
            className={`draw-stem${stemOpen ? ' open' : ''}`}
            title={stemOpen ? '收起题干' : '展开题干全文'}
            onClick={() => setStemOpen((v) => !v)}
          >
            <span className="draw-stem-caret" aria-hidden>
              {stemOpen ? '▾' : '▸'}
            </span>
            {q.stem.replace(/\n+/g, ' ')}
          </button>
          <div className="draw-run-row">
            <button
              type="button"
              className="ghost exam-btn-primary"
              disabled={running > 0}
              onClick={() => setAutoToken((t) => t + 1)}
            >
              {running > 0 ? '解析中…' : 'AI 解析本题 ✦'}
            </button>
            <span className="draw-run-hint">
              {running > 0 ? '解析中…' : '只生成本题要点，约需十几秒'}
            </span>
          </div>
          <ExamAnswerTrace
            paperId={paperId}
            q={q}
            materials={materials}
            relatedIdx={relatedIdx}
            anchorByNum={anchorByNum}
            onJump={onJump}
            defaultOpen
            autoToken={autoToken}
            editing={traceEditing}
            onToggleEditing={() => setTraceEditing((v) => !v)}
            onBusyChange={onSectionBusy}
          />
        </div>
      </aside>
      </>,
    document.body,
  )
}
