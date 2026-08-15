interface PaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
  label?: string
}

function pageList(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set<number>([1, 2, total - 1, total, current - 1, current, current + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const p of sorted) {
    if (p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
}

export function Pagination({ page, totalPages, onChange, label }: PaginationProps) {
  if (totalPages <= 1) return null
  return (
    <nav className="pagination">
      <button
        className="page-btn"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="上一页"
      >
        ←
      </button>
      {pageList(page, totalPages).map((p, i) =>
        p === '…' ? (
          <span className="page-ellipsis" key={`e${i}`}>
            ···
          </span>
        ) : (
          <button
            key={p}
            className={`page-btn${p === page ? ' current' : ''}`}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ),
      )}
      <button
        className="page-btn"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="下一页"
      >
        →
      </button>
      {label && <span className="page-label">{label}</span>}
    </nav>
  )
}
