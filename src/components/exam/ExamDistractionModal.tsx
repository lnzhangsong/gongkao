import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MARK_USE_FALLBACK } from '../../lib/aiExamTrace'
import type { DistractionGroup } from '../../lib/examDistractions'

const CN_NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫']
const numOf = (i: number) => (i < CN_NUM.length ? CN_NUM[i] : `${i + 1}`)

/** 干扰句的「为什么没用」：AI 漏写时如实说漏写，不拿兜底文案冒充理由 */
const whyOf = (use?: string) =>
  use && use !== MARK_USE_FALLBACK ? use : 'AI 没写清为什么没用——建议对这则材料重新生成思路'

/**
 * 本卷干扰项一览（C5）：`level = useless` 的句子此前只内联埋在材料正文里（还是划线小字），
 * 而「为什么没用」正是提分价值最高的一句话。这里按材料汇总成一份清单：
 * 引句 + 行文作用 + 为什么没用，并可跳回原文对应材料。
 * 口径是「本卷」——材料级与题目级两种标注来源都收，见 examDistractions.collectDistractions。
 */
export function ExamDistractionModal({
  groups,
  anchorByNum,
  onJump,
  onClose,
}: {
  groups: DistractionGroup[]
  /** 材料编号 → 原文锚点 id（缺则不显示跳转入口） */
  anchorByNum: Map<number, string>
  onJump: (id: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const total = groups.reduce((n, g) => n + g.marks.length, 0)
  return createPortal(
    <div
      className="exam-modal-mask"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="exam-modal exam-flow-modal" role="dialog" aria-modal="true" aria-label="本卷干扰项">
        <header className="exam-flow-head">
          <h3>
            本卷干扰项{' '}
            <small>
              {total} 句 · 分属 {groups.length} 则材料 · 看似相关，采它不得分
            </small>
          </h3>
          <button type="button" className="exam-flow-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="distract-list">
          {groups.map((g) => {
            const anchor = anchorByNum.get(g.matIdx)
            return (
              <section key={g.matIdx} className="distract-group">
                <h4 className="distract-mat">
                  {g.label}
                  <span>{g.marks.length} 句</span>
                  {anchor && (
                    <button type="button" className="text-btn" onClick={() => onJump(anchor)}>
                      看原文 ↖
                    </button>
                  )}
                </h4>
                {g.marks.map((m, i) => (
                  <div key={m.id} className="distract-item">
                    <span className="distract-no" aria-hidden="true">
                      {numOf(i)}
                    </span>
                    <div>
                      <p className="distract-quote">「{m.quote.replace(/\s+/g, ' ').trim()}」</p>
                      <p className="distract-why">
                        <span className="distract-role">{m.role}</span>
                        {whyOf(m.use)}
                      </p>
                    </div>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
