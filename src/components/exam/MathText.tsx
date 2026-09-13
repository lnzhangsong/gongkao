import { useEffect, useMemo, useState, type ReactNode } from 'react'
import 'katex/dist/katex.min.css'
import { splitMath } from '../../lib/mathText'

/**
 * 行测题干/选项/解析里的公式渲染。
 *
 * 公式写成 `$...$`（行内）或 `$$...$$`（独立成行），切分见 src/lib/mathText.ts；
 * KaTeX 按需 import——只有页面真的出现公式时才加载，不进主 chunk
 * （practice 路由本身是 lazy 的）。
 */
type KatexModule = { default: { renderToString(tex: string, opts: Record<string, unknown>): string } }

let katexPromise: Promise<KatexModule> | null = null
const loadKatex = (): Promise<KatexModule> => (katexPromise ??= import('katex') as Promise<KatexModule>)

/** 同样的公式会出现在多题（如各级卷重复题），渲染结果按 模式+源码 缓存 */
const rendered = new Map<string, string>()

export function MathText({ text }: { text: string }): ReactNode {
  const parts = useMemo(() => splitMath(text), [text])
  const hasMath = parts.some((p) => p.math)
  const [katex, setKatex] = useState<KatexModule | null>(null)

  useEffect(() => {
    if (!hasMath || katex) return
    let alive = true
    void loadKatex()
      .then((m) => {
        if (alive) setKatex(m)
      })
      .catch(() => {
        /* KaTeX 加载失败：保持 LaTeX 源码兜底显示，不影响作答 */
      })
    return () => {
      alive = false
    }
  }, [hasMath, katex])

  if (!hasMath) return <>{text}</>

  return (
    <>
      {parts.map((p, i) => {
        if (!p.math) return <span key={i}>{p.text}</span>
        const key = `${p.display ? 'D' : 'I'}:${p.tex}`
        let html = rendered.get(key)
        if (!html && katex) {
          html = katex.default.renderToString(p.tex, { displayMode: p.display, throwOnError: false, strict: false })
          rendered.set(key, html)
        }
        if (!html) {
          /* KaTeX 还在加载：先原样显示 LaTeX 源码，避免公式位空白 */
          return (
            <code key={i} className="math-pending">
              {p.tex}
            </code>
          )
        }
        return (
          <span
            key={i}
            className={p.display ? 'math-block' : 'math-inline'}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </>
  )
}
