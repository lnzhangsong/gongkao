import { useState } from 'react'

/** 年份输入：输入过程中允许自由编辑（含清空），失焦时校验 2000-2100 并回写 */
export function YearInput({ value, onCommit, id }: { value: number; onCommit: (n: number) => void; id?: string }) {
  const [raw, setRaw] = useState(String(value))
  /* 外部值变化时在渲染期同步（React 官方「调整 state」模式），避免 effect 里 setState 引发级联渲染 */
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setRaw(String(value))
  }
  return (
    <input
      type="number"
      id={id}
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
