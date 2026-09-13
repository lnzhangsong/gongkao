// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { MathText } from './MathText'

/** KaTeX 是动态 import 的，渲染要等一拍；轮询到出现为止（最多 1s） */
async function waitFor(cond: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (cond()) return true
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  }
  return cond()
}

const reactEnv = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('MathText（公式渲染）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactEnv.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactEnv.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('把 $...$ 渲染成 KaTeX 结构', async () => {
    await act(async () => {
      root.render(<MathText text={'半径 $r=\\sqrt{2}$ 的圆'} />)
    })
    const ok = await waitFor(() => !!container.querySelector('.katex'))
    expect(ok).toBe(true)
    expect(container.textContent).toContain('半径')
    expect(container.textContent).toContain('的圆')
  })

  it('纯文本不触发 KaTeX，原样输出', async () => {
    await act(async () => {
      root.render(<MathText text={'没有公式的题干'} />)
    })
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.textContent).toBe('没有公式的题干')
  })
})
