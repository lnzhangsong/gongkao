import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useAuthStatusStore } from '../stores/authStatus'
import { useSyncStore, syncNow } from '../lib/cloudSync'
import { toast } from '../components/ui/toastStore'
import { confirmDialog } from '../components/ui/confirm'
import '../styles/auth.css'

/** ISO 时间 → 当地时区「今天显示 HH:mm，更早显示 M.D HH:mm」 */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return hm
  return `${d.getMonth() + 1}.${d.getDate()} ${hm}`
}

/** 账号页（/account）：资料展示、昵称修改、退出登录 */
export function AccountPage() {
  const navigate = useNavigate()
  const status = useAuthStatusStore((s) => s.status)
  const user = useAuthStatusStore((s) => s.user)
  const profile = useAuthStatusStore((s) => s.profile)
  const rename = useAuthStore((s) => s.rename)
  const signOut = useAuthStore((s) => s.signOut)
  const { lastSyncAt, error: syncError, syncing } = useSyncStore()

  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  /* profile 异步就绪后同步进输入框：渲染期调整 state（替代 effect 内 setState，避免级联渲染） */
  const profileNick = profile?.nickname ?? ''
  const [prevProfileNick, setPrevProfileNick] = useState(profileNick)
  if (profileNick !== prevProfileNick) {
    setPrevProfileNick(profileNick)
    setNickname(profileNick)
  }

  useEffect(() => {
    if (status === 'out') void navigate('/login', { replace: true })
  }, [status, navigate])

  if (status !== 'in' || !user) return null

  const email = user.email ?? profile?.email ?? '（无邮箱）'
  const dirty = nickname.trim() !== (profile?.nickname ?? '')

  const save = async () => {
    if (busy || !dirty) return
    setBusy(true)
    try {
      await rename(nickname.trim())
      toast('昵称已更新')
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const manualSync = async () => {
    if (syncing) return
    await syncNow()
    const err = useSyncStore.getState().error
    toast(err ? `同步失败：${err}` : '同步完成')
  }

  const logout = async () => {
    const ok = await confirmDialog(
      '退出登录会清空本机的进度、摘录、学习记录与 AI 配置（数据都在云端，下次登录自动恢复）。确认退出吗？',
    )
    if (!ok) return
    await signOut()
    toast('已退出登录')
    void navigate('/')
  }

  return (
    <section className="auth-page">
      <header className="subpage-header">
        <div>
          <div className="eyebrow">READBOOK ACCOUNT</div>
          <h1>
            欢迎回来，
            <br />
            <span>{profile?.nickname || '读者'}。</span>
          </h1>
        </div>
        <p className="subpage-copy">登录后，阅读进度、摘录标注、申论与真题学习记录自动同步到云端，多设备保持一致。</p>
      </header>
      <div className="auth-body">
        <div className="auth-card auth-account">
          <div className="auth-identity">
            <div className="auth-avatar" aria-hidden>
              {(profile?.nickname || email).slice(0, 1).toUpperCase()}
            </div>
            <div className="auth-identity-text">
              <strong>{profile?.nickname || '我的账号'}</strong>
              <span>{email}</span>
            </div>
          </div>

          <label className="auth-field">
            <span>昵称</span>
            <input
              value={nickname}
              maxLength={24}
              placeholder="给自己起个名字"
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
            />
          </label>
          <button type="button" className="auth-submit" disabled={busy || !dirty} onClick={save}>
            {busy ? '保存中…' : '保存昵称'}
          </button>

          <hr className="auth-divider" />

          <div className="auth-sync">
            <div className="auth-sync-text">
              <span>数据同步</span>
              <small>
                {syncing
                  ? '同步中…'
                  : syncError
                    ? `同步出错：${syncError}`
                    : lastSyncAt
                      ? `上次同步 ${formatTime(lastSyncAt)}`
                      : '尚未同步'}
              </small>
            </div>
            <button type="button" className="auth-sync-btn" disabled={syncing} onClick={manualSync}>
              立即同步
            </button>
          </div>

          <div className="auth-actions">
            <button type="button" className="auth-logout" onClick={logout}>
              <LogOut size={15} /> 退出登录
            </button>
            <Link className="auth-back" to="/">
              返回首页
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
