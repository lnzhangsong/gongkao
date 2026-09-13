import { describe, expect, it } from 'vite-plus/test'
import { splitMath } from './mathText'

describe('splitMath（$...$ / $$...$$ 公式切分）', () => {
  it('无公式时原样返回', () => {
    expect(splitMath('纯文本，没有公式')).toEqual([{ math: false, text: '纯文本，没有公式' }])
  })

  it('行内公式', () => {
    expect(splitMath('半径 $r=\\sqrt{2}$ 的圆')).toEqual([
      { math: false, text: '半径 ' },
      { math: true, tex: 'r=\\sqrt{2}', display: false },
      { math: false, text: ' 的圆' },
    ])
  })

  it('独立公式 $$...$$ 标记为 display，可跨行', () => {
    expect(splitMath('$$\\frac{1}{2}\n+ 1$$')).toEqual([{ math: true, tex: '\\frac{1}{2}\n+ 1', display: true }])
  })

  it('多个公式', () => {
    const parts = splitMath('$a$ 与 $b$')
    expect(parts.map((p) => (p.math ? p.tex : p.text))).toEqual(['a', ' 与 ', 'b'])
  })

  it('单侧 $ 不成公式（不吞掉后续文本）', () => {
    expect(splitMath('价格 100$ 起')).toEqual([{ math: false, text: '价格 100$ 起' }])
  })

  it('行内公式不跨行', () => {
    expect(splitMath('$a\nb$')).toEqual([{ math: false, text: '$a\nb$' }])
  })

  it('\\$ 转义为字面量美元号', () => {
    expect(splitMath('价格 \\$5')).toEqual([{ math: false, text: '价格 $5' }])
  })
})
