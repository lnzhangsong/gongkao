import type { ReactNode } from 'react'
import { splitConditionLines } from '../../lib/xingcePractice'
import { MathText } from './MathText'

/**
 * 行测材料渲染器：把 groupStem 的 OCR 文本渲染成「段落 + 表格」。
 * 约定（xingce-ocr.py 产出）：连续含 " | " 的行是表格行，第一行为表头；
 * 其余行是标题/说明段落。段落里的「(1)…；(2)…」条件句拆成每行一条。
 * 文本里的 `$...$` 公式交给 MathText 渲染。
 */

/** 条件句分行渲染：题干/解析里的「(1)…；(2)…」枚举每条一行 */
export function CondLines({ text }: { text: string }) {
  return (
    <>
      {splitConditionLines(text).map((seg, i, arr) => (
        <span key={i}>
          <MathText text={seg} />
          {i < arr.length - 1 && <br />}
        </span>
      ))}
    </>
  )
}

function toRows(lines: string[]): string[][] {
  return lines.map((l) => l.split(' | ').map((c) => c.trim()))
}

export function GroupStemText({ text }: { text: string | null | undefined }) {
  if (!text) return null
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
              <th key={i}>
                <MathText text={rows[0][i] ?? ''} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((r, ri) => (
            <tr key={ri}>
              {Array.from({ length: width }, (_, i) => (
                <td key={i}>
                  <MathText text={r[i] ?? ''} />
                </td>
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
    for (const seg of splitConditionLines(line)) {
      out.push(
        <p key={`p-${out.length}`}>
          <MathText text={seg} />
        </p>,
      )
    }
  }
  flush()

  return <>{out}</>
}

/**
 * 截图渲染：value 是 JSON 数组字符串，元素为图片地址或 { src, w, h }（带尺寸时给
 * <img> 加 width/height，加载前预留布局防抖动）。空值/解析失败一律渲染 null。
 */
export function DataUrls({ value, altPrefix }: { value: string | null | undefined; altPrefix: string }) {
  if (!value) return null
  let items: unknown[] = []
  try {
    const parsed: unknown = JSON.parse(value)
    items = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    if (value.startsWith('data:')) items = [value]
    else return null
  }
  return (
    <>
      {items.map((raw, i) => {
        const it = typeof raw === 'string' ? { src: raw } : (raw as { src: string; w?: number; h?: number })
        return (
          <img
            className="practice-img"
            key={i}
            src={it.src}
            width={it.w || undefined}
            height={it.h || undefined}
            alt={items.length > 1 ? `${altPrefix}图${i + 1}` : `${altPrefix}配图`}
            loading="lazy"
          />
        )
      })}
    </>
  )
}
