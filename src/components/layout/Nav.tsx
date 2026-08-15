import { NavLink, useLocation, useNavigate } from 'react-router-dom'

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
  const navigate = useNavigate()
  const isReading = pathname.startsWith('/reading')

  return (
    <nav className="nav">
      <span className="nav-left">
        {isReading && (
          <button className="nav-back" onClick={() => navigate(-1)}>
            ← 返回
          </button>
        )}
        <NavLink to="/" className="brand">
          读本<span className="brand-en">READBOOK</span>
        </NavLink>
      </span>
      <div className="nav-links">
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
      </div>
      <div className="nav-right">{today()}</div>
    </nav>
  )
}
