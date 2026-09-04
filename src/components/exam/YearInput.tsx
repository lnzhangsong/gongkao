import { useEffect, useState } from 'react'

/** 年份输入：输入过程中允许自由编辑（含清空），失焦时校验 2000-2100 并回写 */
export function YearInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => setRaw(String(value)), [value])
  return (
    <input
      type="number"
      className="exam-select exam-year-input"
      value={raw}
      min={2000}
      max={2100}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const n = parseInt(raw, 10)
        if (n >= 2000 && n <= 2100) onCommit(n)
        else setRaw(String(value))
      }}
    />
  )
}
