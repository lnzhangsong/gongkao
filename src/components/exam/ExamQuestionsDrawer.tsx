import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { joinParagraphs } from '../../lib/examText'
import type { ExamDetail, ExamQuestion } from '../../lib/api'
import { ExamQuestionView } from './ExamQuestionView'
import { useIsMobileViewport } from '../../lib/useIsMobileViewport'
import { usePanelResize } from '../../lib/usePanelResize'

/**
 * 作答要求抽屉：阅读态把整段题目收进抽屉，正文只留材料（配合行文思路标注沉浸阅读）。
 * 每题带「解析」入口 → 打开该题的思路抽屉（ExamAnalysisDrawer）。
 * 编辑态不走此抽屉（题目仍在页面内联编辑）。
 */
export function ExamQuestionsDrawer({
  detail,
  materialAnchors,
  anchorByNum,
  onJump,
  indent,
  onOpenAnalysis,
  onClose,
}: {
  detail: ExamDetail
  materialAnchors: Map<number, number[]>
  anchorByNum: Map<number, string>
  onJump: (id: string) => void
  indent: boolean
  onOpenAnalysis: (qIdx: number) => void
  onClose: () => void
}) {
  /* Escape 关闭；移动端（覆盖式底部面板）锁正文滚动——桌面端为上下分栏 */
  const isMobile = useIsMobileViewport()
  const { height: panelHeight, onHandleDown } = usePanelResize()
  const [fullscreen, setFullscreen] = useState(false)
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

  const questions = detail.questions
  const hasAnswered = questions.some((q) => q.answer)

  return createPortal(
    <>
      {isMobile && <div className="shenlun-backdrop" onClick={onClose} />}
      <aside
        className="shenlun-panel exam-draw"
        role="dialog"
        aria-label="作答要求"
        style={isMobile ? undefined : { height: fullscreen ? '90vh' : panelHeight }}
      >
        {!isMobile && !fullscreen && (
          <div className="panel-resize-handle" onPointerDown={onHandleDown} aria-label="调整面板高度" />
        )}
        <header className="shenlun-head">
          <div>
            <span className="shenlun-eyebrow">EXAM / 作答要求</span>
            <h3>
              {questions.length} 题
              {hasAnswered ? ' · 含参考答案' : ''}
            </h3>
          </div>
          <div className="draw-head-actions">
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
          {questions.map((q) => (
            <QuestionEntry
              key={q.idx}
              q={q}
              materialAnchors={materialAnchors}
              anchorByNum={anchorByNum}
              onJump={onJump}
              indent={indent}
              onOpenAnalysis={onOpenAnalysis}
            />
          ))}
          {!hasAnswered && detail.answersRaw ? (
            <details className="exam-answer">
              <summary>本题库未按题对齐 · 展开答案全文</summary>
              <div className={`exam-answer-sheet${indent ? '' : ' no-indent'}`}>
                {joinParagraphs(detail.answersRaw).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </aside>
      </>,
    document.body,
  )
}

function QuestionEntry({
  q,
  materialAnchors,
  anchorByNum,
  onJump,
  indent,
  onOpenAnalysis,
}: {
  q: ExamQuestion
  materialAnchors: Map<number, number[]>
  anchorByNum: Map<number, string>
  onJump: (id: string) => void
  indent: boolean
  onOpenAnalysis: (qIdx: number) => void
}) {
  return (
    <article className="exam-q draw-q">
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
          <button
            type="button"
            className="text-btn exam-analysis-btn"
            title="思路推导 · 答案溯源 · 原文标注"
            onClick={() => onOpenAnalysis(q.idx)}
          >
            解析
          </button>
        </span>
      </header>
      <ExamQuestionView
        q={q}
        materialAnchors={materialAnchors}
        anchorByNum={anchorByNum}
        onJump={onJump}
        indent={indent}
      />
    </article>
  )
}
