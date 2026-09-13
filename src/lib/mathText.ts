/**
 * 行测文本里的公式切分（配合 src/components/exam/MathText.tsx 的 KaTeX 渲染）。
 *
 * 约定：`$...$` 行内公式、`$$...$$` 独立成行；`\$` 表示字面量美元号。
 * 切分逻辑单独放 lib 便于单测（组件文件只导出组件，满足 react-refresh 规则）。
 */

export type MathPart = { math: false; text: string } | { math: true; tex: string; display: boolean }

/** 非贪婪匹配，长度 0 的 `$`、跨行行内公式都不算公式 */
const MATH_RE = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g

export function splitMath(text: string): MathPart[] {
  if (!text.includes('$')) return [{ math: false, text }]
  const parts: MathPart[] = []
  let last = 0
  const pushText = (s: string) => {
    if (s) parts.push({ math: false, text: s.replace(/\\\$/g, '$') })
  }
  for (const m of text.matchAll(MATH_RE)) {
    const at = m.index ?? 0
    pushText(text.slice(last, at))
    parts.push({ math: true, tex: (m[1] ?? m[2]).trim(), display: m[1] !== undefined })
    last = at + m[0].length
  }
  pushText(text.slice(last))
  return parts
}
