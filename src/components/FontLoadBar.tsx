import { useFontLoad } from '../lib/fonts'

/** 字体按需加载进度条：切换字体时显示，加载完成后自动收起 */
export function FontLoadBar() {
  const loading = useFontLoad((s) => s.loading)
  const progress = useFontLoad((s) => s.progress)
  const label = useFontLoad((s) => s.label)
  if (!loading) return null
  return (
    <div className="font-load-bar" role="status" aria-live="polite">
      <div className="font-load-label">正在加载字体 · {label}</div>
      <div className="font-load-track">
        <div className="font-load-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  )
}
