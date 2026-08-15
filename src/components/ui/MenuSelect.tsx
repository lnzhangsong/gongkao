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
  /** 值为空时显示的占位文案（如"跟随页面"） */
  placeholder?: string
  /** 紧凑模式（如工具条内的 SORT BY 下拉） */
  compact?: boolean
  /** 表单模式（录入页/设置页，带边框的控件外观） */
  form?: boolean
}

/** 自定义下拉：替代原生 <select>（原生在 Windows 下渲染卡顿且样式不可控） */
export function MenuSelect({ value, options, onChange, ariaLabel, placeholder, compact, form }: MenuSelectProps) {
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

  const current = options.find((o) => o.key === value)
  const label = current?.label ?? (value ? value : placeholder ?? '')

  return (
    <div className={`menu-select${compact ? ' compact' : ''}${form ? ' form' : ''}`} ref={ref}>
      <button
        type="button"
        className={`menu-select-trigger${value === '' && placeholder ? ' placeholder' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {label}
        <ChevronDown size={12} className={`menu-select-chevron${open ? ' up' : ''}`} />
      </button>
      {open && (
        <div className="menu-select-pop" role="listbox">
          {placeholder !== undefined && (
            <button
              type="button"
              className={`menu-select-item${value === '' ? ' active' : ''}`}
              role="option"
              aria-selected={value === ''}
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              {placeholder}
              {value === '' && <span className="menu-select-check">✓</span>}
            </button>
          )}
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
