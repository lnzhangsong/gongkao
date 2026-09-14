// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { ExamAnswerTrace } from './ExamAnswerTrace'
import { useExamStudyStore, type AnswerPointTrace } from '../../stores/examStudyStore'
import type { ExamQuestion } from '../../lib/api'

/**
 * 加工方式谱系概览（C1）：
 * 六类分布一眼可见（以前只有卡片上散落的 pill），点一列只读态筛出该类要点。
 * 重点锁两条容易写错的：筛选后卡片编号不跳号；点中的加工方式没了就自动取消筛选。
 */

const reactEnv = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }

const q = { idx: 1, type: '归纳概括', stem: '题干', requirement: '', answer: '参考答案' } as unknown as ExamQuestion
const materials = [{ idx: 1, label: '材料1', content: '材料内容' }]

const point = (id: string, mode: AnswerPointTrace['mode'], sourceIdx: number | null): AnswerPointTrace => ({
  id,
  text: `${id} 要点`,
  mode,
  sourceIdx,
})

describe('ExamAnswerTrace · 加工方式谱系概览（C1）', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async () => {
    await act(async () => {
      root.render(
        <ExamAnswerTrace
          paperId="p1"
          q={q}
          materials={materials}
          relatedIdx={[1]}
          anchorByNum={new Map([[1, 'material-1']])}
          onJump={() => {}}
          defaultOpen
        />,
      )
    })
  }

  const counts = () => Array.from(container.querySelectorAll('.ms-num')).map((n) => n.textContent)
  const cards = () => container.querySelectorAll('.draw-card')
  const summary = () => container.querySelector('.ms-summary')?.textContent ?? ''
  const pick = async (mode: string) => {
    const col = Array.from(container.querySelectorAll('.ms-col')).find((c) => c.textContent?.includes(mode))
    await act(async () => {
      ;(col as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  beforeEach(() => {
    reactEnv.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useExamStudyStore.setState({ traces: {}, marks: {} })
    useExamStudyStore.setState({
      traces: {
        'p1#1': {
          paperId: 'p1',
          qIdx: 1,
          origin: 'ai',
          updatedAt: '2026-09-15T00:00:00.000Z',
          points: [point('a', '摘抄', 1), point('b', '摘抄', 1), point('c', '改写', 1), point('d', '补充', null)],
        },
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useExamStudyStore.setState({ traces: {}, marks: {} })
  })

  it('按六类谱系列出条数，并说明材料内外与占比最多的一类', async () => {
    await render()
    expect(counts()).toEqual(['2', '1', '0', '0', '0', '1'])
    expect(summary()).toContain('4 条要点：3 条出自材料、1 条材料外')
    expect(summary()).toContain('最多的是「摘抄」（2 条）')
    expect(cards()).toHaveLength(4)
  })

  it('点一列筛出该类要点：编号保持全集序号，再点取消', async () => {
    await render()
    await pick('改写')
    expect(cards()).toHaveLength(1)
    /* 编号仍是全集里的第 3 条，不跳成 1 */
    expect(container.querySelector('.draw-no')?.textContent).toBe('3')
    expect(summary()).toContain('已筛出「改写」1 条')

    await pick('改写')
    expect(cards()).toHaveLength(4)
    expect(container.querySelector('.draw-no')?.textContent).toBe('1')
  })

  it('同一句原文加工出的多条要点互相标注「与第 N 条同源」（C3 小改）', async () => {
    await act(async () => {
      useExamStudyStore.setState({
        traces: {
          'p1#1': {
            paperId: 'p1',
            qIdx: 1,
            origin: 'ai',
            updatedAt: '2026-09-15T00:00:00.000Z',
            points: [
              { id: 'a', text: '第一条', mode: '摘抄', sourceIdx: 1, quote: '同一句原文' },
              { id: 'b', text: '第二条', mode: '归纳', sourceIdx: 1, quote: '同一句原文' },
              { id: 'c', text: '第三条', mode: '改写', sourceIdx: 1, quote: '另一句' },
            ],
          },
        },
      })
    })
    await render()
    const sibs = Array.from(container.querySelectorAll('.trace-sib')).map((el) => el.textContent)
    expect(sibs).toEqual(['与第 2 条同源', '与第 1 条同源'])
  })

  it('带 focusPointId 渲染时该卡片带 flash 并有可定位的 id（从材料「答案②」点进来）', async () => {
    await act(async () => {
      root.render(
        <ExamAnswerTrace
          paperId="p1"
          q={q}
          materials={materials}
          relatedIdx={[1]}
          anchorByNum={new Map([[1, 'material-1']])}
          onJump={() => {}}
          defaultOpen
          focusPointId="c"
        />,
      )
    })
    const card = container.querySelector('#trace-point-c')
    expect(card).toBeTruthy()
    expect(card?.className).toContain('flash')
    expect(container.querySelectorAll('.draw-card.flash')).toHaveLength(1)
  })

  it('筛中的加工方式被后续数据换掉后自动取消筛选（不卡在空列表）', async () => {
    await render()
    await pick('改写')
    expect(cards()).toHaveLength(1)
    await act(async () => {
      useExamStudyStore.setState({
        traces: {
          'p1#1': {
            paperId: 'p1',
            qIdx: 1,
            origin: 'ai',
            updatedAt: '2026-09-15T00:00:00.000Z',
            points: [point('a', '摘抄', 1), point('d', '补充', null)],
          },
        },
      })
    })
    expect(cards()).toHaveLength(2)
    expect(summary()).not.toContain('已筛出')
  })
})
