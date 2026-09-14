// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { MarkedParagraph } from './ExamMarkedParagraph'
import type { MarkRange } from '../../lib/examMarks'
import type { MaterialMark } from '../../stores/examStudyStore'
import type { PointSource } from '../../lib/examPointSources'

/**
 * 材料原文里的反向索引（C4）：句后解析块尾部挂「答案②」小标，点开对应题目的解析。
 * 以前只有单向（要点卡 → 材料锚点），读者在材料里读到关键句无从知道它进没进答案。
 */
const reactEnv = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }

const mark: MaterialMark = { id: 'k1', matIdx: 1, quote: '楼道堆物无人管', role: '问题呈现', use: '可提炼为问题要点' }
const ranges: MarkRange[] = [{ mark, paraIndex: 0, start: 0, end: 7 }]
const sources = new Map<string, PointSource[]>([
  ['k1', [{ questionIdx: 3, pointNo: 2, pointId: 't2', text: '社区治理缺位' }]],
])

describe('MarkedParagraph 反向索引（C4）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactEnv.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = async (onOpenPoint?: (q: number, id: string) => void) => {
    await act(async () => {
      root.render(
        <MarkedParagraph
          text="楼道堆物无人管，居民意见很大。"
          ranges={ranges}
          sourceByMarkId={sources}
          onOpenPoint={onOpenPoint}
        />,
      )
    })
  }

  it('句后解析块尾部显示「答案②」，标题带上题目与要点句', async () => {
    await render()
    const chip = container.querySelector('.exam-src-chip')
    expect(chip?.textContent).toBe('答案②')
    expect(chip?.getAttribute('title')).toContain('第3题要点②')
    expect(chip?.getAttribute('title')).toContain('社区治理缺位')
  })

  it('点小标回调题目序号与要点 id', async () => {
    const onOpenPoint = vi.fn()
    await render(onOpenPoint)
    await act(async () => {
      ;(container.querySelector('.exam-src-chip') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(onOpenPoint).toHaveBeenCalledWith(3, 't2')
  })

  it('没有反向索引时不渲染小标（标注本身照常解析）', async () => {
    await act(async () => {
      root.render(<MarkedParagraph text="楼道堆物无人管，居民意见很大。" ranges={ranges} />)
    })
    expect(container.querySelector('.exam-src-chip')).toBeNull()
    expect(container.textContent).toContain('可提炼为问题要点')
  })
})
