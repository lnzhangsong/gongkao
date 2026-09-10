import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAuthStatusStore } from '../stores/authStatus'
import { toast } from '../components/ui/toastStore'
import '../styles/auth.css'

type Notice = { kind: 'info' | 'error'; text: string } | null

/** 登录 / 注册页（/login）。未配置 Supabase 时给出提示并保留返回入口 */
export function AuthPage() {
  const navigate = useNavigate()
  const status = useAuthStatusStore((s) => s.status)
  const signIn = useAuthStore((s) => s.signIn)
  const signInWithMagicLink = useAuthStore((s) => s.signInWithMagicLink)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  /* 已登录直接进账号页（含邮箱确认链接回跳后建立会话的场景） */
  useEffect(() => {
    if (status === 'in') void navigate('/account', { replace: true })
  }, [status, navigate])

  /* 子页页头：与文库/规范词等 subpage-header 同语言（注册已关闭，仅登录） */
  const header = (
    <header className="subpage-header">
      <div>
        <div className="eyebrow">READBOOK ACCOUNT</div>
        <h1>
          回到读本，
          <br />
          <span>接着读。</span>
        </h1>
      </div>
      <p className="subpage-copy">登录后，阅读进度与摘录自动同步云端，多设备保持一致。</p>
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
      await signIn(email.trim(), password)
      toast('已登录')
      void navigate('/account')
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
            <button type="button" role="tab" aria-selected className="active">
              登录
            </button>
            <button type="button" role="tab" aria-selected={false} title="注册已关闭" disabled>
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
              />
            </label>
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? '请稍候…' : '登录'}
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
