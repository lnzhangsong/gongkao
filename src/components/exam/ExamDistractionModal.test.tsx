// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { ExamDistractionModal } from './ExamDistractionModal'
import { MARK_USE_FALLBACK } from '../../lib/aiExamTrace'

/**
 * 本卷干扰项一览（C5）：
 * 「为什么没用」是这份清单存在的理由，所以 AI 漏写时必须如实说漏写，
 * 不能把兜底文案（「辅助句：帮助理解材料脉络…」）当成理由摆出来。
 */
const reactEnv = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('ExamDistractionModal', () => {
  let container: HTMLDivElement
  let root: Root

  const groups = [
    {
      matIdx: 1,
      label: '材料一',
      marks: [
        { id: 'a', matIdx: 1, quote: '这是一句  背景铺陈', role: '背景铺垫', use: '只交代背景，本题问对策' },
        { id: 'b', matIdx: 1, quote: '这是没写理由的一句', role: '衔接过渡' },
      ],
    },
    {
      matIdx: 2,
      label: '材料二',
      marks: [{ id: 'c', matIdx: 2, quote: '兜底理由的一句', role: '背景铺垫', use: MARK_USE_FALLBACK }],
    },
  ]

  beforeEach(() => {
    reactEnv.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <ExamDistractionModal
          groups={groups}
          anchorByNum={new Map([[1, 'exam-mat-1']])}
          onJump={() => {}}
          onClose={() => {}}
        />,
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('列出每则材料的干扰句、作用与理由，并给出句数与总量', () => {
    const text = document.body.textContent ?? ''
    expect(text).toContain('本卷干扰项')
    expect(text).toContain('3 句 · 分属 2 则材料')
    expect(text).toContain('材料一')
    expect(text).toContain('2 句')
    /* portal 到 body，断言要查 body 而不是挂载容器 */
    expect(document.body.querySelectorAll('.distract-item')).toHaveLength(3)
    expect(text).toContain('只交代背景，本题问对策')
    /* 引句按空白归一展示 */
    expect(text).toContain('「这是一句 背景铺陈」')
  })

  it('AI 没写理由时如实说漏写，不拿兜底文案冒充', () => {
    const text = document.body.textContent ?? ''
    expect(text).toContain('AI 没写清为什么没用')
    expect(text).not.toContain(MARK_USE_FALLBACK)
  })

  it('有锚点的材料给「看原文」入口，没有的不给', () => {
    const btns = Array.from(document.body.querySelectorAll('.distract-mat .text-btn'))
    expect(btns).toHaveLength(1)
    expect(btns[0].textContent).toContain('看原文')
  })
})
