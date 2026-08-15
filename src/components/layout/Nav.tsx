import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

const LINKS = [
  { to: '/', label: 'READ', end: true },
  { to: '/library', label: 'ARCHIVE' },
  { to: '/notes', label: 'NOTES' },
  { to: '/settings', label: 'SETTINGS' },
]

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

export function Nav() {
  const { pathname } = useLocation()
  const isReading = pathname.startsWith('/reading')
  const [menuOpen, setMenuOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  /* 路由切换后自动收起移动端导航面板 */
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

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
      {!isReading && <div className="nav-links">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {l.label}
          </NavLink>
        ))}
      </div>}
      <div className="nav-right">{today()}</div>

      {/* 移动端：汉堡菜单入口（≤800px 显示；阅读页由阅读辅助菜单替代，隐藏此按钮） */}
      {!isReading && (
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
      )}

      {menuOpen && (
        <>
          <div className="nav-mobile-backdrop" onClick={() => setMenuOpen(false)} />
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
          </div>
        </>
      )}
    </nav>
  )
}
