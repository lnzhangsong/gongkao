import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { toast } from '../components/ui/Toast'
import '../styles/auth.css'

type Mode = 'signin' | 'signup'
type Notice = { kind: 'info' | 'error'; text: string } | null

/** 登录 / 注册页（/login）。未配置 Supabase 时给出提示并保留返回入口 */
export function AuthPage() {
  const navigate = useNavigate()
  const status = useAuthStore((s) => s.status)
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const signInWithMagicLink = useAuthStore((s) => s.signInWithMagicLink)

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  /* 已登录直接进账号页（含邮箱确认链接回跳后建立会话的场景） */
  useEffect(() => {
    if (status === 'in') navigate('/account', { replace: true })
  }, [status, navigate])

  /* 子页页头：与文库/规范词等 subpage-header 同语言，文案随登录/注册切换 */
  const header = (
    <header className="subpage-header">
      <div>
        <div className="eyebrow">READBOOK ACCOUNT</div>
        <h1>
          {mode === 'signin' ? '回到读本，' : '初次见面，'}
          <br />
          <span>{mode === 'signin' ? '接着读。' : '请多指教。'}</span>
        </h1>
      </div>
      <p className="subpage-copy">
        {mode === 'signin'
          ? '登录后，阅读足迹与摘录将跟着账号走（多端同步即将支持）。'
          : '仅需邮箱和密码。所有内容功能匿名同样可用，注册只为走得更远。'}
      </p>
    </header>
  )

  if (!supabase) {
    return (
      <section className="auth-page">
        {header}
        <div className="auth-body">
          <div className="auth-card">
            <h2>账号服务未配置</h2>
            <p className="auth-muted">
              需要先配置环境变量 <code>VITE_SUPABASE_URL</code> 与 <code>VITE_SUPABASE_ANON_KEY</code>
              （参考项目 <code>.env.example</code>）。
            </p>
            <Link className="auth-back" to="/">
              返回首页
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
        toast('已登录')
        navigate('/account')
      } else {
        const { needsConfirm } = await signUp(email.trim(), password)
        if (needsConfirm) {
          setMode('signin')
          setNotice({ kind: 'info', text: '确认邮件已发送，请到邮箱点击链接完成激活后再登录。' })
        } else {
          toast('注册成功')
          navigate('/account')
        }
      }
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : '操作失败，请重试' })
    } finally {
      setBusy(false)
    }
  }

  const sendMagicLink = async () => {
    if (busy || !email.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      await signInWithMagicLink(email.trim())
      setNotice({ kind: 'info', text: '登录链接已发送到邮箱，点击链接即可免密登录。' })
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : '发送失败，请重试' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-page">
      {header}
      <div className="auth-body">
        <div className="auth-card">
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={mode === 'signin' ? 'active' : ''}
              onClick={() => {
                setMode('signin')
                setNotice(null)
              }}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => {
                setMode('signup')
                setNotice(null)
              }}
            >
              注册
            </button>
          </div>

          <form onSubmit={submit}>
            <label className="auth-field">
              <span>邮箱</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label className="auth-field">
              <span>密码</span>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
              />
            </label>
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? '请稍候…' : mode === 'signin' ? '登录' : '注册'}
            </button>
          </form>

          <button type="button" className="auth-magic" onClick={sendMagicLink} disabled={busy || !email.trim()}>
            <Mail size={14} /> 免密登录（发送魔法链接到上方邮箱）
          </button>

          {notice && <p className={notice.kind === 'error' ? 'auth-error' : 'auth-info'}>{notice.text}</p>}
          <Link className="auth-back" to="/">
            暂不登录，先逛逛
          </Link>
        </div>
      </div>
    </section>
  )
}
