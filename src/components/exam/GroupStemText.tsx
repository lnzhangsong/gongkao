import type { ReactNode } from 'react'

/**
 * 行测材料渲染器：把 groupStem 的 OCR 文本渲染成「段落 + 表格」。
 * 约定（xingce-ocr.py 产出）：连续含 " | " 的行是表格行，第一行为表头；
 * 其余行是标题/说明段落。表格行数不一致时以最长行为准，缺格补空。
 */

function toRows(lines: string[]): string[][] {
  return lines.map((l) => l.split(' | ').map((c) => c.trim()))
}

export function GroupStemText({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let buf: string[] = []

  const flush = () => {
    if (!buf.length) return
    const rows = toRows(buf)
    const width = Math.max(...rows.map((r) => r.length))
    out.push(
      <table className="practice-stem-table" key={`t-${out.length}`}>
        <thead>
          <tr>
            {Array.from({ length: width }, (_, i) => (
              <th key={i}>{rows[0][i] ?? ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((r, ri) => (
            <tr key={ri}>
              {Array.from({ length: width }, (_, i) => (
                <td key={i}>{r[i] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>,
    )
    buf = []
  }

  for (const line of lines) {
    if (line.includes(' | ')) {
      buf.push(line)
      continue
    }
    flush()
    if (!line) continue
    if (line.startsWith('【') && line.endsWith('】')) {
      out.push(
        <p className="practice-stem-note" key={`n-${out.length}`}>
          {line}
        </p>,
      )
      continue
    }
    out.push(<p key={`p-${out.length}`}>{line}</p>)
  }
  flush()

  return <>{out}</>
}
