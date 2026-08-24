import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { ReadingPage } from './pages/ReadingPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { AdminPage } from './pages/AdminPage'
import { AdminEditPage } from './pages/AdminEditPage'
import { useThemeStore, resolveTheme } from './stores/themeStore'
import { useArticleStore } from './stores/articleStore'
import { useReaderStore } from './stores/readerStore'
import { usePrefersDark } from './lib/prefersDark'
import { LoadingScreen } from './components/LoadingScreen'

const LOADING_MIN_MS = 1400
/** 收尾阶段：进度冲到 100% 后的停留时长 */
const LOADING_FINISH_MS = 450

function App() {
  const theme = useThemeStore((s) => s.theme)
  const autoDark = useThemeStore((s) => s.autoDark)
  const prefersDark = usePrefersDark()
  /* 生效主题：autoDark 开启且系统深色时 → 夜读绿 */
  const effectiveTheme = resolveTheme(theme, autoDark, prefersDark)
  const reducedMotion = useReaderStore((s) => s.settings.reducedMotion)
  const apiReady = useArticleStore((s) => s._apiReady)
  const [minElapsed, setMinElapsed] = useState(false)
  /** loading 阶段：loading → finishing（冲 100%）→ done（移除） */
  const [phase, setPhase] = useState<'loading' | 'finishing' | 'done'>('loading')
  const mountAtRef = useRef(0)

  /* 主题应用到 html 根节点（含自动夜读解析） */
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
  }, [effectiveTheme])

  /* 减少动效 */
  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion)
  }, [reducedMotion])

  /* 启动时从 API 加载文章列表（meta，不含正文） */
  useEffect(() => {
    mountAtRef.current = Date.now()
    void useArticleStore.getState().hydrate()
    // 首屏动画最短展示时长：即使 API 秒回，也让 loading 完整呈现
    const t = window.setTimeout(() => setMinElapsed(true), LOADING_MIN_MS)
    return () => window.clearTimeout(t)
  }, [])

  /* 阶段流转：数据就绪且最短时长已到 → 进入收尾（进度冲 100%）→ 停留后移除 */
  useEffect(() => {
    if (phase === 'loading' && apiReady && minElapsed) {
      setPhase('finishing')
    }
  }, [phase, apiReady, minElapsed])

  /* 收尾：进入 finishing 后停留 LOADING_FINISH_MS 再移除 */
  useEffect(() => {
    if (phase !== 'finishing') return
    const t = window.setTimeout(() => setPhase('done'), LOADING_FINISH_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  // 首次访问：显示全屏 loading（数据就绪 + 最短时长 + 收尾完成后才切走）
  if (phase !== 'done') {
    return <LoadingScreen finishing={phase === 'finishing'} hint="正在加载文章库…" />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/reading/:articleId" element={<ReadingPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/new" element={<AdminEditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
