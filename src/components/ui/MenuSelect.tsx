import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface MenuOption {
  key: string
  label: string
}

interface MenuSelectProps {
  value: string
  options: MenuOption[]
  onChange: (key: string) => void
  ariaLabel?: string
}

/** 自定义下拉：替代原生 <select>（原生在 Windows 下渲染卡顿且样式不可控） */
export function MenuSelect({ value, options, onChange, ariaLabel }: MenuSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.key === value)?.label ?? ''

  return (
    <div className="menu-select" ref={ref}>
      <button
        type="button"
        className="menu-select-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {current}
        <ChevronDown size={12} className={`menu-select-chevron${open ? ' up' : ''}`} />
      </button>
      {open && (
        <div className="menu-select-pop" role="listbox">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              className={`menu-select-item${o.key === value ? ' active' : ''}`}
              role="option"
              aria-selected={o.key === value}
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
            >
              {o.label}
              {o.key === value && <span className="menu-select-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
