import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initAnalytics } from './lib/analytics'
import './styles/tokens.css'
import './styles/base.css'
import './styles/home.css'
import './styles/library.css'
import './styles/reading.css'
import './styles/notes.css'
import './styles/settings.css'
import './styles/admin.css'

/* 产品埋点：空闲时异步加载 PostHog（未配置 key 则整体静默禁用）。
 * 必须早于首次路由跳转触发，否则纯浏览不触发白名单事件的访客不会被计到 pageview */
initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/* 离线缓存：仅生产注册（dev 下 SW 缓存会干扰 HMR 与最新资源） */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败不影响功能，只是没有离线能力 */
    })
  })
}
