import { useState } from 'react'

interface PaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
  label?: string
}

/** 简洁分页：上一页 / 页码·总数 / 下一页 + 跳转 */
export function Pagination({ page, totalPages, onChange, label }: PaginationProps) {
  const [jump, setJump] = useState('')
  if (totalPages <= 1) return null

  const go = (p: number) => {
    const clamped = Math.max(1, Math.min(totalPages, p))
    if (clamped !== page) onChange(clamped)
  }

  const doJump = () => {
    const p = parseInt(jump, 10)
    if (Number.isFinite(p) && p >= 1 && p <= totalPages) {
      onChange(p)
    }
    setJump('')
  }

  return (
    <nav className="pagination">
      <button className="page-btn" disabled={page <= 1} onClick={() => go(page - 1)} aria-label="上一页">
        ← 上一页
      </button>

      <span className="page-info">
        {page} / {totalPages}
      </span>

      <button className="page-btn" disabled={page >= totalPages} onClick={() => go(page + 1)} aria-label="下一页">
        下一页 →
      </button>

      <span className="page-jump">
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doJump()
          }}
          placeholder="页"
          aria-label="跳转到页码"
        />
        <button className="page-jump-btn" onClick={doJump} aria-label="跳转">
          跳转
        </button>
      </span>

      {label && <span className="page-label">{label}</span>}
    </nav>
  )
}
