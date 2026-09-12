import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { CircleUserRound, Menu, X } from 'lucide-react'

const LINKS = [
  { to: '/', label: 'READ', end: true },
  { to: '/library', label: 'ARCHIVE' },
  { to: '/exams', label: 'EXAMS' },
  { to: '/practice', label: 'PRACTICE' },
  { to: '/terms', label: 'TERMS' },
  { to: '/assist', label: 'ASSIST' },
  { to: '/notes', label: 'NOTES' },
  { to: '/settings', label: 'SETTINGS' },
]

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  /* 账号已并入设置页（/settings 的「账号」分区），这里的入口只做深链跳转：
     不再读登录态，导航栏因此完全不依赖 authStatus / supabase-js */
  const ACCOUNT_TO = '/settings#account'

  /* 移动端面板的每个 NavLink 自带 onClick 收起（见下方渲染），
     无需再挂「路由变化 → setState」的 effect（那也会触发级联渲染告警） */

  /* 打开时：锁定背景滚动 + 点击外部/Esc 关闭 */
  useEffect(() => {
    if (!menuOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || toggleRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <nav className="nav">
      <span className="nav-left">
        <NavLink to="/" className="brand">
          读本<span className="brand-en">READBOOK</span>
        </NavLink>
      </span>
      <div className="nav-links">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
        <NavLink to={ACCOUNT_TO} className="nav-account" aria-label="账号" title="账号（设置页）">
          <CircleUserRound size={16} />
        </NavLink>
      </div>
      <div className="nav-right">{today()}</div>
      <button
        ref={toggleRef}
        type="button"
        className="nav-mobile-toggle"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {menuOpen && (
        <>
          <div className="nav-mobile-backdrop" role="presentation" onClick={() => setMenuOpen(false)} />
          <div className="nav-mobile-panel" ref={panelRef} role="dialog" aria-label="站点导航">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) => (isActive ? 'active' : '')}
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </NavLink>
            ))}
            <NavLink
              to={ACCOUNT_TO}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setMenuOpen(false)}
            >
              <CircleUserRound size={15} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              ACCOUNT
            </NavLink>
          </div>
        </>
      )}
    </nav>
  )
}
