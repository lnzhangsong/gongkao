import { useState } from 'react'
import { LogIn, LogOut, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useAuthStatusStore } from '../../stores/authStatus'
import { useSyncStore, syncNow } from '../../lib/cloudSync'
import { toast } from '../ui/toastStore'
import { confirmDialog } from '../ui/confirm'

/** ISO 时间 → 当地时区「今天显示 HH:mm，更早显示 M.D HH:mm」 */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return hm
  return `${d.getMonth() + 1}.${d.getDate()} ${hm}`
}

/**
 * 设置页「账号」分区（原独立页 /account 的正文，2026-09 下沉到设置页）。
 *
 * 单独成文件而不是塞进 SettingsPage：这里会牵入 authStore → supabase-js + 云同步 +
 * 各数据 store。设置页本身是懒加载路由，账号区随它一起加载，因此这些重模块不会进首屏；
 * 登录态本身走轻量的 `authStatus`，未登录时这个分区只渲染一行登录引导。
 */
export function AccountSection() {
  const navigate = useNavigate()
  const status = useAuthStatusStore((s) => s.status)
  const user = useAuthStatusStore((s) => s.user)
  const profile = useAuthStatusStore((s) => s.profile)
  const rename = useAuthStore((s) => s.rename)
  const signOut = useAuthStore((s) => s.signOut)
  const { lastSyncAt, error: syncError, syncing } = useSyncStore()

  /* 昵称输入框初值必须直接取自 profile：进设置页时 profile 往往已经就绪
     （authStore 在启动时就拉过），若初值给空串，下面这段「渲染期同步」不会触发
     （prevProfileNick 也是同一个值），输入框就会空着、保存按钮还会误判为可点。 */
  const profileNick = profile?.nickname ?? ''
  const [nickname, setNickname] = useState(profileNick)
  const [busy, setBusy] = useState(false)
  /* profile 异步就绪后同步进输入框：渲染期调整 state（替代 effect 内 setState，避免级联渲染） */
  const [prevProfileNick, setPrevProfileNick] = useState(profileNick)
  if (profileNick !== prevProfileNick) {
    setPrevProfileNick(profileNick)
    setNickname(profileNick)
  }

  /* ── 未登录：引导登录（注册已关闭，入口仍是 /login） ── */
  if (status !== 'in' || !user) {
    if (status === 'unavailable') {
      return (
        <div className="setting-row" style={{ borderBottom: 0 }}>
          <div>
            <div className="setting-title">云端账号未配置</div>
            <div className="setting-desc">
              未接入 Supabase，本站以纯本地模式运行：进度、摘录与学习记录都保存在当前设备，可用「数据与隐私」导出迁移。
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="setting-row" style={{ borderBottom: 0 }}>
        <div>
          <div className="setting-title">{status === 'init' ? '正在检查登录状态…' : '未登录'}</div>
          <div className="setting-desc">
            登录后，阅读进度、摘录标注、申论与真题学习记录自动同步到云端，多设备保持一致。
          </div>
        </div>
        <div className="setting-control">
          <button className="ghost" disabled={status === 'init'} onClick={() => void navigate('/login')} type="button">
            <LogIn size={12} /> 登录
          </button>
        </div>
      </div>
    )
  }

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
    <>
      <div className="settings-account-id">
        <div className="settings-account-avatar" aria-hidden>
          {(profile?.nickname || email).slice(0, 1).toUpperCase()}
        </div>
        <div className="settings-account-text">
          <strong>{profile?.nickname || '我的账号'}</strong>
          <span>{email}</span>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">昵称</div>
          <div className="setting-desc">用于首页问候与账号区显示</div>
        </div>
        <div className="setting-control">
          <input
            className="settings-input"
            value={nickname}
            maxLength={24}
            placeholder="给自己起个名字"
            aria-label="昵称"
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
          />
          <button className="ghost" type="button" disabled={busy || !dirty} onClick={save}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">数据同步</div>
          <div className="setting-desc">
            {syncing
              ? '同步中…'
              : syncError
                ? `同步出错：${syncError}`
                : lastSyncAt
                  ? `上次同步 ${formatTime(lastSyncAt)}`
                  : '尚未同步'}
          </div>
        </div>
        <div className="setting-control">
          <button className="ghost" type="button" disabled={syncing} onClick={manualSync}>
            <RefreshCw size={12} className={syncing ? 'spin' : undefined} /> 立即同步
          </button>
        </div>
      </div>

      <div className="setting-row danger" style={{ borderBottom: 0 }}>
        <div>
          <div className="setting-title">退出登录</div>
          <div className="setting-desc">清空本机进度、摘录、学习记录与 AI 配置（云端保留，下次登录自动恢复）</div>
        </div>
        <div className="setting-control">
          <button className="ghost" type="button" onClick={logout}>
            <LogOut size={12} /> 退出登录
          </button>
        </div>
      </div>
    </>
  )
}
